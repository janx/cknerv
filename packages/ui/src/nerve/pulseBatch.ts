// Pure batch helpers extracted from NeuralNetwork's pulse-planning + block-tick
// effects. Kept free of React / simClock / window so the wiring logic is
// unit-testable (the effects themselves can't be observed in the jsdom
// <Canvas> harness — r3f v8 never mounts Canvas children at 0×0). The effects
// call these and stamp the clock; these decide WHICH links fire and WHEN the
// per-block counter ticks.

import type { Cell, CellLink } from '@cknerv/types';
import type { NeighborGraph } from '../geometry/neighborGraph';
import {
  anchorProximityScore,
  nearestGraphNode,
  rescueOrigin,
  rimEntryScore,
} from '../geometry/pathRouter';
import { consensusPacketColor } from '../derives/consensusFlow.derive';
import { advanceLinkCursor } from './linkCursor';
import {
  collectLinkSourceIndex,
  planPulses,
  pulseTiming,
  type Pulse,
  type PulsePlanningOptions,
} from './pulseRunner';
import type { PulseStatsSink, RescueCounter, RescueKind } from './pulseStats';

/** Per-batch planning ceiling. The active-pulse render pool clamps at 128,
 * so planning past it is pure main-thread waste on tx-heavy blocks — the
 * routing BFS per source was the dominant block-content-dependent cost.
 * Same bounded-work family as MAX_PULSES_PER_LINK and the courier layer's
 * in-flight cap; dropped links are accounted as 'batch-budget'. Rescue
 * pulses are exempt: ≤1 per block, bounded by block cadence, and the whole
 * point is that a starved block still lights. */
export const MAX_PULSES_PER_BATCH = 128;

/** The stats surface `planLinkBatch` needs (superset of `PulseStatsSink`:
 *  `planPulses` writes drop reasons via the sink, we roll each link's
 *  outcome up per block via `observeLink`, and the rescue pass records its
 *  origin honesty via `bumpRescue`). */
export interface PulseBatchStats extends PulseStatsSink {
  observeLink(block: number, lit: boolean): void;
  bumpRescue(kind: RescueCounter, n?: number): void;
}

/**
 * Block-guarantee rescue: one pulse for a link of a block whose every link
 * dropped. The destination is the link's first routable output (falling
 * back to the in-graph cell nearest the newborn's anchored position — the
 * pulse then lands beside the truth instead of nowhere). The origin walks
 * the honesty ladder: input anchors present → the node nearest the consumed
 * coin's true position (`anchored`); none → rim entry along the
 * destination's outward radial (`rim` — value declared to arrive from
 * outside the retained window). Selection is dst-rooted, so the path is
 * real edges end-to-end. Pure; returns null only when nothing is routable
 * around the destination at all.
 */
function planRescuePulse(
  link: CellLink,
  cells: ReadonlyMap<number, Cell>,
  graph: NeighborGraph,
  stats: PulseBatchStats,
): Pulse | null {
  let dst: number | null = null;
  for (const id of link.to_ids) {
    if (graph.adjacency.has(id) && cells.has(id)) {
      dst = id;
      break;
    }
  }
  let substituted = false;
  if (dst === null) {
    const outAnchor = link.endpoint_anchors.find((a) =>
      link.to_ids.includes(a.id),
    );
    if (!outAnchor) return null;
    dst = nearestGraphNode(cells, graph, outAnchor.pos_seed);
    if (dst === null) return null;
    substituted = true;
  }
  const inputAnchor = link.endpoint_anchors.find((a) =>
    link.from_ids.includes(a.id),
  );
  const rescue: RescueKind = inputAnchor ? 'anchored' : 'rim';
  const score = inputAnchor
    ? anchorProximityScore(cells, inputAnchor.pos_seed)
    : rimEntryScore(cells, dst);
  const path = rescueOrigin(graph, dst, score);
  if (!path || path.length < 2) return null;
  if (substituted) stats.bumpRescue('dst-substituted');
  const { startDelayMs, hopMs } = pulseTiming(link, path[0], dst);
  return {
    linkSeq: link.seq,
    linkBlock: link.block,
    path,
    bornAtMs: link.at_ms,
    color: consensusPacketColor(link.tx_hash, link.tag),
    startDelayMs,
    hopMs,
    rescue,
  };
}

/**
 * Plan pulses for all newly-arrived links since `lastSeq`, recording drop
 * reasons + per-block rollup into `stats`. Pure: returns the planned pulses
 * (flat, in link order) + the advanced cursor. During backfill this returns
 * no pulses (links suppressed) but still advances the cursor and bumps
 * `backfill` by the suppressed count — exactly the effect's behavior, minus
 * the per-pulse `startSec` stamp + ref push the caller applies.
 *
 * THE BLOCK GUARANTEE: when a live block's slice in this batch carried ≥1
 * non-cellbase link (`parents.length > 0`) and none of them produced a
 * pulse, exactly one rescue pulse is planned for it. The rescue for block N
 * is planned at N's boundary — before block N+1's first `observeLink` — so
 * the stats rollup's monotonic-block assumption holds and the rescued block
 * counts as lit, never as with-links-but-dark. `lastGuaranteedBlock` is the
 * caller-threaded watermark (max height with ≥1 fired-or-rescued pulse):
 * a later batch slice of an already-guaranteed height never re-rescues.
 * Already-lit blocks plan byte-identically to the pre-rescue behaviour.
 */
export function planLinkBatch(
  pulseLinks: CellLink[],
  lastSeq: number,
  backfillActive: boolean,
  cells: ReadonlyMap<number, Cell>,
  graph: NeighborGraph,
  opts: PulsePlanningOptions,
  stats: PulseBatchStats,
  lastGuaranteedBlock: number,
): { planned: Pulse[]; nextSeq: number; lastGuaranteedBlock: number } {
  const { toFire, nextSeq, suppressed } = advanceLinkCursor(
    pulseLinks,
    lastSeq,
    backfillActive,
  );
  if (suppressed > 0) stats.bump('backfill', suppressed);
  const planned: Pulse[] = [];
  let guaranteed = lastGuaranteedBlock;
  if (toFire.length > 0) {
    // One shared Cell-map prescan for the whole batch replaces the full-map
    // walk planPulses used to run per link. Built only for links that will
    // actually fire (backfill-suppressed links never pay it).
    const batchOpts: PulsePlanningOptions = {
      ...opts,
      sourceIndex: collectLinkSourceIndex(toFire, cells),
    };
    // Per-open-block rescue state, flushed at each block boundary so the
    // rescue's `observeLink` stays monotonic with the per-link ones.
    let curBlock = -1;
    let curLit = false;
    let curCandidates: CellLink[] = [];
    const flushBlock = () => {
      if (curBlock === -1) return;
      if (curLit) {
        if (curBlock > guaranteed) guaranteed = curBlock;
        return;
      }
      if (curBlock <= lastGuaranteedBlock) return; // lit in an earlier slice
      if (curCandidates.length === 0) return; // cellbase-only: stays silent
      for (const link of curCandidates) {
        const rescued = planRescuePulse(link, cells, graph, stats);
        if (rescued) {
          planned.push(rescued);
          stats.observeLink(curBlock, true);
          stats.bumpRescue(rescued.rescue!);
          if (curBlock > guaranteed) guaranteed = curBlock;
          return;
        }
      }
      stats.bumpRescue('failed');
    };
    for (const link of toFire) {
      if (link.block !== curBlock) {
        flushBlock();
        curBlock = link.block;
        curLit = false;
        curCandidates = [];
      }
      if (link.parents.length > 0) curCandidates.push(link);
      if (planned.length >= MAX_PULSES_PER_BATCH) {
        stats.bump('batch-budget');
        stats.observeLink(link.block, false);
        continue;
      }
      const p = planPulses(link, cells, graph, batchOpts, link.at_ms, stats);
      if (p.length > 0) curLit = true;
      stats.observeLink(link.block, p.length > 0);
      for (const pulse of p) planned.push(pulse);
    }
    flushBlock();
  }
  return { planned, nextSeq, lastGuaranteedBlock: guaranteed };
}

/**
 * Place a live nerve batch on the shared protocol-event clock. Generic
 * consumers keep the default zero delay; the dashboard supplies its
 * peer-network-to-Cell-field handoff delay.
 */
export function scheduleLivePulseStartSec(
  nowSec: number,
  livePulseDelayS: number,
): number {
  const safeDelayS = Number.isFinite(livePulseDelayS)
    ? Math.max(0, livePulseDelayS)
    : 0;
  return nowSec + safeDelayS;
}

/**
 * Remove already-planned packets whose source transaction was rolled back.
 * Generic over Pulse subtypes so the renderer can preserve its ActivePulse
 * timing fields while applying the same canonical block boundary.
 */
export function prunePulsesFromBlock<T extends Pulse>(
  pulses: readonly T[],
  fromBlock: number,
): T[] {
  return pulses.filter((pulse) => pulse.linkBlock < fromBlock);
}

/**
 * Tick the per-block counter when `at` strictly advances past `lastSeen`,
 * skipping the bootstrap value (`lastSeen === 0` — the initial pulse delta,
 * not a new block during this session). Returns the new `lastSeen`.
 */
export function tickBlockIfAdvanced(
  at: number,
  lastSeen: number,
  stats: { observeBlockTick(): void },
): number {
  if (at > lastSeen) {
    if (lastSeen !== 0) stats.observeBlockTick();
    return at;
  }
  return lastSeen;
}
