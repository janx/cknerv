// Pure batch helpers extracted from NeuralNetwork's pulse-planning + block-tick
// effects. Kept free of React / simClock / window so the wiring logic is
// unit-testable (the effects themselves can't be observed in the jsdom
// <Canvas> harness — r3f v8 never mounts Canvas children at 0×0). The effects
// call these and stamp the clock; these decide WHICH links fire and WHEN the
// per-block counter ticks.

import type { Cell, CellLink } from '@cknerv/types';
import type { NeighborAdjacency } from '../geometry/neighborGraph';
import {
  buildOriginEntryIndex,
  type OriginEntryIndex,
} from '../geometry/originEntry';
import {
  anchorProximityScore,
  rescueOrigin,
  rimEntryScore,
  type RouteScratch,
} from '../geometry/pathRouter';
import { consensusPacketColor } from '../derives/consensusFlow.derive';
import { advanceLinkCursor } from './linkCursor';
import {
  planPulses,
  pulseTiming,
  PULSE_START_JITTER_MS,
  type Pulse,
  type PulseOrigin,
  type PulsePlanningOptions,
} from './pulseRunner';
import { BLOCK_HIGHLIGHT_DELAY_S } from '../ui/topologyConstants';
import type { PulseStatsSink, RescueCounter, RescueKind } from './pulseStats';

/** Per-batch planning ceiling. The active-pulse render pool clamps at 128,
 * so planning past it is pure main-thread waste on tx-heavy blocks — the
 * routing BFS per source was the dominant block-content-dependent cost.
 * Same bounded-work family as MAX_PULSES_PER_LINK and the courier layer's
 * in-flight cap; dropped links are accounted as 'batch-budget'. Rescue
 * pulses are exempt: ≤1 per block, bounded by block cadence, and the whole
 * point is that a starved block still lights. */
export const MAX_PULSES_PER_BATCH = 128;

/** Rescue candidate links retained per dark block. The retry loop tries
 * them in seq order until one routes; each failed attempt pays a BFS (plus
 * one entry-index query when the destination has to be substituted), so an
 * unroutable block must cost a bounded amount, not ring-capacity × BFS. */
export const MAX_RESCUE_ATTEMPTS = 8;

/** The stats surface `planLinkBatch` needs (superset of `PulseStatsSink`:
 *  `planPulses` writes drop reasons and origin kinds via the sink, we roll
 *  each link's outcome up per block via `observeLink`, and the rescue pass
 *  records which rung of the honesty ladder it used via `bumpRescue`). */
export interface PulseBatchStats extends PulseStatsSink {
  observeLink(block: number, lit: boolean): void;
  bumpRescue(kind: RescueCounter, n?: number): void;
  bumpRingEvicted(n?: number): void;
}

/**
 * Block-guarantee rescue: one pulse for a link of a block whose every link
 * dropped. The destination is the link's first routable output (falling
 * back to the in-graph cell nearest the newborn's anchored position — the
 * pulse then lands beside the truth instead of nowhere). The origin walks
 * the honesty ladder: input anchors present → the node nearest the consumed
 * coin's true position, carrying the same by-value ghost the main path would
 * have (`anchored`); none → rim entry along the destination's outward radial
 * (`rim` — value declared to arrive from outside the retained window, and the
 * one pulse kind that names no origin). Selection is dst-rooted, so the path
 * is real edges end-to-end. Pure; returns null only when nothing is routable
 * around the destination at all.
 */
function planRescuePulse(
  link: CellLink,
  cells: ReadonlyMap<number, Cell>,
  graph: NeighborAdjacency,
  stats: PulseBatchStats,
  entryIndex: () => OriginEntryIndex,
  routeScratch: RouteScratch | undefined,
): Pulse | null {
  // Degree-0 nodes are real in the live graph (death pruning can strand a
  // neighbourless key) — an isolated dst would dead-end the rescue while a
  // routable sibling output sits right there.
  let dst: number | null = null;
  for (const id of link.to_ids) {
    if ((graph.adjacency.get(id)?.size ?? 0) > 0 && cells.has(id)) {
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
    dst = entryIndex().nearest(outAnchor.pos_seed);
    if (dst === null) return null;
    substituted = true;
  }
  // Same membership rule the main path uses: an anchor is input-side iff its
  // id is not one of this tx's newborns. It admits the identity-only anchors
  // of inputs that were never retained, which `from_ids` deliberately omits.
  const inputAnchor = link.endpoint_anchors.find(
    (a) => !link.to_ids.includes(a.id),
  );
  const rescue: RescueKind = inputAnchor ? 'anchored' : 'rim';
  const score = inputAnchor
    ? anchorProximityScore(cells, inputAnchor.pos_seed)
    : rimEntryScore(cells, dst);
  // The cells-membership predicate keeps every hop renderable at plan time:
  // the frame loop extinguishes a pulse whose hop endpoints are missing
  // from the cells map, and this pulse is its block's only light.
  const path = rescueOrigin(graph, dst, score, {
    valid: (id) => cells.has(id),
    scratch: routeScratch,
  });
  if (!path || path.length < 2) return null;
  if (substituted) stats.bumpRescue('dst-substituted');
  stats.bumpRescue(rescue);
  // An anchored rescue names the very cell the main path would have departed,
  // so it carries the same by-value ghost — and `rescueOrigin` maximized
  // proximity to that address, so the ghost hop is short by construction.
  const origin: PulseOrigin | undefined = inputAnchor
    ? {
      pos: [
        inputAnchor.pos_seed[0],
        inputAnchor.pos_seed[1],
        inputAnchor.pos_seed[2],
      ],
      anchorId: inputAnchor.id,
      resolved: inputAnchor.resolved,
    }
    : undefined;
  if (origin) {
    stats.bumpOrigin(origin.resolved ? 'origin-retained' : 'origin-derived');
  }
  // A rim rescue names no consumed cell, so its animation falls back to the
  // routed source node — the seeding every pulse used before origins existed.
  const { startDelayMs, hopMs } = pulseTiming(
    link,
    origin?.anchorId ?? path[0],
    dst,
  );
  return {
    linkSeq: link.seq,
    linkBlock: link.block,
    path,
    bornAtMs: link.at_ms,
    color: consensusPacketColor(link.tx_hash, link.tag),
    startDelayMs,
    hopMs,
    ...(origin ? { origin } : {}),
    rescue,
  };
}

/**
 * Open a link batch: advance the cursor past every link this batch consumes
 * and record the cursor-level stats (ring eviction, backfill suppression).
 * Returns the links that fire, in link order. Cheap and synchronous — the
 * cursor must move the instant a delta is seen so the next delta never
 * re-plans the same links, however long the planning of these is deferred.
 */
export function openLinkBatch(
  pulseLinks: CellLink[],
  lastSeq: number,
  backfillActive: boolean,
  stats: PulseBatchStats,
): { toFire: CellLink[]; nextSeq: number } {
  const { toFire, nextSeq, suppressed, evictedGap } = advanceLinkCursor(
    pulseLinks,
    lastSeq,
    backfillActive,
  );
  // Live links evicted from the bounded ring before the cursor saw them —
  // silent block-guarantee loss, so count it. The caller rebases the cursor
  // whenever the archive is re-sequenced (`linksEpoch`), so a hydration
  // never reads as a gap; backfill storms are expected churn, not loss.
  if (!backfillActive && evictedGap > 0) stats.bumpRingEvicted(evictedGap);
  if (suppressed > 0) stats.bump('backfill', suppressed);
  return { toFire, nextSeq };
}

/**
 * The planning of one opened batch as a resumable machine. Each `step` plans
 * one unit — the entry grid when the batch will need one, then a link at a
 * time, then the closing rescue pass — and returns the pulses it produced,
 * in the exact order the one-shot planner appended them; draining it IS
 * `planLinkBatch`. The unit is a link because a link is the smallest work
 * the stats observe (`observeLink` per link, in link order), and it bounds
 * one step at two route searches plus, at a block boundary, one rescue
 * pass. The grid gets a step of its own so the first slice of a batch is
 * not the grid AND a link: the memo stays lazy, the step merely fills it
 * early when an anchored link guarantees it will be read.
 */
export interface LinkBatchPlanner {
  /** Every link has been planned and the last block flushed. */
  readonly done: boolean;
  /** Links not yet planned. */
  readonly pending: number;
  /** Block-guarantee watermark so far; the batch's result once `done`. */
  readonly lastGuaranteedBlock: number;
  step(): Pulse[];
  /**
   * Reorg: links at or above `fromBlock` are stale evidence. Unplanned ones
   * are dropped, an open block at or above it forfeits its rescue, and both
   * watermarks rewind below the boundary — exactly what the one-shot planner
   * followed by `prunePulsesFromBlock` would have left behind, minus pulses
   * that would only have been pruned again.
   */
  prune(fromBlock: number): void;
}

export function createLinkBatchPlanner(
  toFire: readonly CellLink[],
  cells: ReadonlyMap<number, Cell>,
  graph: NeighborAdjacency,
  opts: PulsePlanningOptions,
  stats: PulseBatchStats,
  lastGuaranteedBlock: number,
): LinkBatchPlanner {
  const links = toFire.slice();
  let next = 0;
  let closed = false;
  // An input-side anchor (not one of the link's newborns) is exactly what
  // `planPulses` will ask the entry grid about; without one nothing pays.
  let prepared = !links.some((link) =>
    link.to_ids.length > 0
    && link.endpoint_anchors.some((a) => !link.to_ids.includes(a.id)));
  // One entry index for the whole batch, built on first use. Origin
  // planning and the rescue's destination substitution share this single
  // memo: the grid is stage-wide, while most blocks carry only a cellbase
  // link, which names no origin — so a batch that never queries it must
  // not pay the build (backfill-suppressed links never pay it either).
  let originIndex: OriginEntryIndex | null = null;
  const entryIndex = () =>
    (originIndex ??= buildOriginEntryIndex(cells, graph));
  const batchOpts: PulsePlanningOptions = { ...opts, entryIndex };
  // Normal pulses admitted under MAX_PULSES_PER_BATCH. Tracked apart from
  // the planned count so rescues are budget-NEUTRAL, not merely exempt — a
  // mid-batch rescue must not steal the next block's last budget slot.
  let budgeted = 0;
  // The entry watermark and the running one. Deliberately two values: the
  // rescue's "lit in an earlier slice" test reads the ENTRY watermark, so
  // after a reorg prune a replayed lower height is not suppressed by a
  // higher block that lit earlier in this same batch.
  let entryWatermark = lastGuaranteedBlock;
  let guaranteed = lastGuaranteedBlock;
  // Per-open-block rescue state, flushed at each block boundary so the
  // rescue's `observeLink` stays monotonic with the per-link ones.
  let curBlock = -1;
  let curLit = false;
  let curCandidates: CellLink[] = [];

  const flushBlock = (): Pulse | null => {
    if (curBlock === -1) return null;
    if (curLit) {
      if (curBlock > guaranteed) guaranteed = curBlock;
      return null;
    }
    if (curBlock <= entryWatermark) return null; // lit in an earlier slice
    if (curCandidates.length === 0) return null; // cellbase-only: stays silent
    for (const link of curCandidates) {
      const rescued = planRescuePulse(
        link,
        cells,
        graph,
        stats,
        entryIndex,
        opts.routeScratch,
      );
      if (rescued) {
        stats.observeLink(curBlock, true);
        if (curBlock > guaranteed) guaranteed = curBlock;
        return rescued;
      }
    }
    stats.bumpRescue('failed');
    return null;
  };

  return {
    get done() {
      return closed;
    },
    get pending() {
      return links.length - next;
    },
    get lastGuaranteedBlock() {
      return guaranteed;
    },
    step(): Pulse[] {
      if (closed) return [];
      if (!prepared) {
        prepared = true;
        entryIndex();
        return [];
      }
      if (next >= links.length) {
        closed = true;
        const rescued = flushBlock();
        return rescued ? [rescued] : [];
      }
      const link = links[next++];
      const out: Pulse[] = [];
      if (link.block !== curBlock) {
        const rescued = flushBlock();
        if (rescued) out.push(rescued);
        curBlock = link.block;
        curLit = false;
        curCandidates = [];
      }
      // Rescue candidates are only needed while the block is still dark;
      // the attempt cap bounds the retry loop's worst case (each failed
      // attempt pays a BFS).
      if (
        !curLit
        && link.parents.length > 0
        && curBlock > entryWatermark
        && curCandidates.length < MAX_RESCUE_ATTEMPTS
      ) {
        curCandidates.push(link);
      }
      if (budgeted >= MAX_PULSES_PER_BATCH) {
        stats.bump('batch-budget');
        stats.observeLink(link.block, false);
        return out;
      }
      const p = planPulses(link, cells, graph, batchOpts, link.at_ms, stats);
      if (p.length > 0) {
        curLit = true;
        curCandidates = [];
      }
      stats.observeLink(link.block, p.length > 0);
      budgeted += p.length;
      for (const pulse of p) out.push(pulse);
      return out;
    },
    prune(fromBlock: number): void {
      // Links are in block order, so the stale ones are a suffix.
      let keep = links.length;
      while (keep > next && links[keep - 1].block >= fromBlock) keep -= 1;
      links.length = keep;
      if (curBlock >= fromBlock) {
        // The open block was rolled back: nothing of it may still rescue.
        curBlock = -1;
        curLit = false;
        curCandidates = [];
      }
      entryWatermark = Math.min(entryWatermark, fromBlock - 1);
      guaranteed = Math.min(guaranteed, fromBlock - 1);
    },
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
 *
 * This is the one-shot driver of {@link createLinkBatchPlanner}: opening
 * the batch and draining the planner in one task. The live overlay drives
 * the same planner a slice per frame instead (`livePulseQueue.ts`).
 */
export function planLinkBatch(
  pulseLinks: CellLink[],
  lastSeq: number,
  backfillActive: boolean,
  cells: ReadonlyMap<number, Cell>,
  graph: NeighborAdjacency,
  opts: PulsePlanningOptions,
  stats: PulseBatchStats,
  lastGuaranteedBlock: number,
): { planned: Pulse[]; nextSeq: number; lastGuaranteedBlock: number } {
  const { toFire, nextSeq } = openLinkBatch(
    pulseLinks,
    lastSeq,
    backfillActive,
    stats,
  );
  const planned: Pulse[] = [];
  let guaranteed = lastGuaranteedBlock;
  if (toFire.length > 0) {
    const planner = createLinkBatchPlanner(
      toFire,
      cells,
      graph,
      opts,
      stats,
      lastGuaranteedBlock,
    );
    while (!planner.done) {
      for (const pulse of planner.step()) planned.push(pulse);
    }
    guaranteed = planner.lastGuaranteedBlock;
  }
  return { planned, nextSeq, lastGuaranteedBlock: guaranteed };
}

/**
 * Delay from the raw peer-network block pulse until this block's packets
 * leave the cells it consumed. A packet departs the address of a cell that
 * is dying, so the departure is phase-locked to that corpse's fade: the fade
 * starts at `BLOCK_HIGHLIGHT_DELAY_S` after the block reaches the local
 * field, and each pulse then adds its own jitter in [0, PULSE_START_JITTER_MS).
 * Subtracting the jitter's midpoint puts the MEDIAN departure exactly on the
 * fade onset, with the band straddling it, rather than every packet leaving
 * after the dimming has begun.
 *
 * It used to be `BEAM_GROW_DUR_S` — carrier contact, 1.35 s before the fade —
 * which had the corpse at full brightness while its packet was already tens
 * of hops away, and landed arrivals on outputs not yet born.
 */
export function livePulseDepartureDelayS(localReceiveDelayS: number): number {
  const receiveDelayS = Number.isFinite(localReceiveDelayS)
    ? Math.max(0, localReceiveDelayS)
    : 0;
  return receiveDelayS
    + BLOCK_HIGHLIGHT_DELAY_S
    - PULSE_START_JITTER_MS / 2000;
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
 * Bounded active-pulse pool with guarantee-aware shedding: the oldest
 * NON-rescue pulses go first, so a block's only pulse (its rescue) is not
 * silently evicted by a cascade storm; rescues shed only among themselves
 * once nothing else is left. Returns the same array reference when under
 * the cap so the caller's mutable pool identity is preserved.
 */
export function evictPulseOverflow<T extends Pulse>(
  pulses: T[],
  max: number,
): T[] {
  const overflow = pulses.length - max;
  if (overflow <= 0) return pulses;
  let plain = 0;
  for (const pulse of pulses) {
    if (pulse.rescue === undefined) plain += 1;
  }
  // Explicit per-class drop budgets: plain pulses absorb the overflow
  // first; only the remainder (an all-but-rescues pool) touches rescues.
  let dropPlain = Math.min(overflow, plain);
  let dropRescue = overflow - dropPlain;
  return pulses.filter((pulse) => {
    if (pulse.rescue === undefined) {
      dropPlain -= 1;
      return dropPlain < 0;
    }
    dropRescue -= 1;
    return dropRescue < 0;
  });
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
