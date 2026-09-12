// Pure batch helpers extracted from NeuralNetwork's pulse-planning + block-tick
// effects. Kept free of React / simClock / window so the wiring logic is
// unit-testable (the effects themselves can't be observed in the jsdom
// <Canvas> harness — r3f v8 never mounts Canvas children at 0×0). The effects
// call these and stamp the clock; these decide WHICH links fire and WHEN the
// per-block counter ticks.

import type { Cell, CellLink } from '@cknerv/types';
import type { NeighborAdjacency } from '../geometry/neighborGraph';
import {
  createOriginEntryIndexBuilder,
  type OriginEntryIndex,
  type OriginEntryIndexBuilder,
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
  createLinkPulsePlanner,
  pulseTiming,
  PULSE_START_JITTER_MS,
  type LinkPulsePlanner,
  type Pulse,
  type PulseOrigin,
  type PulsePlanningOptions,
} from './pulseRunner';
import { BLOCK_HIGHLIGHT_DELAY_S } from '../ui/topologyConstants';
import type {
  PlannerStepKind,
  PulseStatsSink,
  RescueCounter,
  RescueKind,
} from './pulseStats';

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
 * one unit and returns the pulses it produced, in the exact order the one-shot
 * planner appended them; draining it IS `planLinkBatch`.
 *
 * THE UNIT IS ONE ROUTE SEARCH. A search over the ~12,000-node stage is the
 * smallest work the planner cannot subdivide — 2–7 ms warm, ~9 ms on the first
 * traversal of a freshly published graph — and the frame-sliced live driver
 * checks its wall budget BETWEEN steps, so whatever a step holds is the grain
 * the budget cannot cut. So: a link is planned ONE ORIGIN per step (a link may
 * carry `MAX_ORIGINS_PER_LINK` of them), and a finished block's rescue pass is
 * ONE CANDIDATE per step (a dark block may hold `MAX_RESCUE_ATTEMPTS`, each
 * paying a scored BFS of its own). The batch's entry grid is not a search at
 * all but a stage-wide walk, and the only grain bigger than a search, so it is
 * spread over as many steps as it takes at `ORIGIN_ENTRY_BUILD_QUANTUM` nodes
 * each (the memo stays lazy; the steps merely fill it early when an anchored
 * link guarantees it will be read). Nothing else changes: `observeLink` still
 * fires once per link in link order, on the step that finishes it, and every
 * pulse of a link is still emitted before the next link's first.
 */
export interface LinkBatchPlanner {
  /** Every link has been planned and the last block flushed. */
  readonly done: boolean;
  /** Links not yet planned. */
  readonly pending: number;
  /** Block-guarantee watermark so far; the batch's result once `done`. */
  readonly lastGuaranteedBlock: number;
  /** What the last {@link step} did — the gauge the frame-sliced driver reads
   *  to name its longest step. A step that drove a link's planner reads
   *  `link` even when that link closed on arrival with no origin to search
   *  from; such a step costs nothing and can never be a frame's longest. */
  readonly lastStepKind: PlannerStepKind;
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
  //
  // The build is RESUMABLE (`grid` steps below spend one chunk each), and
  // `entryIndex` is the only way to a queryable grid: it finishes whatever is
  // left before answering. So a reader never sees a partial grid, and the one
  // path that can still reach a whole-build grain — a rescue substituting a
  // destination on a batch no link predicted would query the grid — pays
  // exactly what it always paid, under its own `rescue` label.
  let originIndex: OriginEntryIndex | null = null;
  let originBuilder: OriginEntryIndexBuilder | null = null;
  const entryBuilder = (): OriginEntryIndexBuilder =>
    (originBuilder ??= createOriginEntryIndexBuilder(cells, graph));
  const entryIndex = () => (originIndex ??= entryBuilder().index());
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
  // The rescue pass's own cursor: -1 while no pass is open, otherwise the next
  // candidate to try. A failed attempt keeps the block open and yields the
  // frame — each attempt pays a scored full-stage BFS of its own.
  let rescueAt = -1;
  // The link being planned, one origin per step, and the pulses it has emitted
  // so far. Its verdict (`curLit`, `observeLink`, the batch budget) is read
  // when the last origin closes it, never mid-link.
  let openLink: CellLink | null = null;
  let openPlanner: LinkPulsePlanner | null = null;
  let openPulses = 0;
  // What the last step held, for the driver's per-frame worst-grain gauge.
  let lastStepKind: PlannerStepKind = 'other';

  /** Drop the open block's state; the next step opens the following block. */
  const endBlock = (): void => {
    curBlock = -1;
    curLit = false;
    curCandidates = [];
    rescueAt = -1;
  };

  /** One origin of the link in flight; closes the link on its last origin. */
  const stepOpenLink = (): Pulse[] => {
    const planner = openPlanner!;
    const link = openLink!;
    const pulses = planner.step();
    openPulses += pulses.length;
    if (planner.done) {
      if (openPulses > 0) {
        curLit = true;
        curCandidates = [];
      }
      stats.observeLink(link.block, openPulses > 0);
      budgeted += openPulses;
      openLink = null;
      openPlanner = null;
      openPulses = 0;
    }
    return pulses;
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
    get lastStepKind() {
      return lastStepKind;
    },
    step(): Pulse[] {
      if (closed) {
        lastStepKind = 'other';
        return [];
      }
      if (!prepared) {
        // The stage-wide grid, ONE CHUNK a step. Whole, it is the longest
        // grain the live planner takes (18 ms in a burst, 47 in a trough over
        // a 12,000-node stage) and the budget cannot cut it, because a budget
        // is only ever spent between steps. Nothing is planned and nothing
        // queries the grid until the build finishes — the batch waits the few
        // extra frames out of its 2.2 s of departure slack, and no pulse moves.
        lastStepKind = 'grid';
        if (entryBuilder().step()) prepared = true;
        return [];
      }
      // A link in flight owns the step: its remaining origins are planned
      // before the boundary is even looked at, so a link's pulses can never be
      // split around the rescue of the block it belongs to.
      if (openPlanner !== null) {
        lastStepKind = 'link';
        return stepOpenLink();
      }
      const atEnd = next >= links.length;
      // A finished block's rescue pass is a step of its OWN, one CANDIDATE at
      // a time, so a scored rescue BFS never shares a step with a link's route
      // search or with a second attempt. curBlock resets once the pass ends;
      // the next step opens the following block (or, at the end, closes the
      // batch). The pulse ORDER is unchanged: block N's rescue is still
      // emitted after N's last link and before N+1's first, and the candidates
      // are still tried in link order, first one that routes wins.
      if (curBlock !== -1 && (atEnd || links[next].block !== curBlock)) {
        if (rescueAt === -1) {
          // The free verdicts, taken once, before any candidate is opened.
          if (curLit && curBlock > guaranteed) guaranteed = curBlock;
          if (
            curLit
            || curBlock <= entryWatermark // lit in an earlier slice
            || curCandidates.length === 0 // cellbase-only: stays silent
          ) {
            lastStepKind = 'other'; // the free verdict opens no search
            endBlock();
            if (atEnd) closed = true;
            return [];
          }
          rescueAt = 0;
        }
        lastStepKind = 'rescue';
        const rescued = planRescuePulse(
          curCandidates[rescueAt++],
          cells,
          graph,
          stats,
          entryIndex,
          opts.routeScratch,
        );
        if (rescued) {
          stats.observeLink(curBlock, true);
          if (curBlock > guaranteed) guaranteed = curBlock;
          endBlock();
          if (atEnd) closed = true;
          return [rescued];
        }
        if (rescueAt < curCandidates.length) return []; // one attempt a frame
        stats.bumpRescue('failed');
        endBlock();
        if (atEnd) closed = true;
        return [];
      }
      if (atEnd) {
        lastStepKind = 'other';
        closed = true;
        return [];
      }
      const link = links[next++];
      if (link.block !== curBlock) {
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
        lastStepKind = 'other'; // refused by the batch budget, never searched
        stats.bump('batch-budget');
        stats.observeLink(link.block, false);
        return [];
      }
      lastStepKind = 'link';
      openLink = link;
      openPulses = 0;
      openPlanner = createLinkPulsePlanner(
        link,
        cells,
        graph,
        batchOpts,
        link.at_ms,
        stats,
      );
      // A link with no origin at all is `done` on arrival: it closes in this
      // same step, exactly as the one-task planner's single call did.
      return stepOpenLink();
    },
    prune(fromBlock: number): void {
      // Links are in block order, so the stale ones are a suffix.
      let keep = links.length;
      while (keep > next && links[keep - 1].block >= fromBlock) keep -= 1;
      links.length = keep;
      // A link of a rolled-back block that was mid-flight (some origins
      // planned, some not) forfeits the rest: its admitted pulses are the
      // caller's to prune, and planning the remaining origins would admit NEW
      // packets for evidence that no longer exists. It reports nothing either
      // — the block's whole rollup goes with it.
      if (openLink !== null && openLink.block >= fromBlock) {
        openLink = null;
        openPlanner = null;
        openPulses = 0;
      }
      if (curBlock >= fromBlock) {
        // The open block was rolled back: nothing of it may still rescue,
        // including a rescue pass already part-way through its candidates.
        endBlock();
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
 * The departure delay a live batch is stamped with, resolved AT PLAN TIME.
 *
 * The dashboard's delay is a continuous function of which peer produced the
 * block, so as a prop it turned the canopy's whole overlay element over on
 * about four blocks in five and re-rendered every fibre under it (report
 * L6-2). It therefore arrives by ref — the `cellDetailViewFocusRef` /
 * `localReceiveDelaySRef` precedent — and the ref is read HERE, when the
 * batch opens, which is the same instant the prop was read before: App writes
 * the ref during the render that carries the block, and effects run after it.
 *
 * The prop stays for consumers that hold a constant delay and have no ref to
 * hand (the protocol-event Lab), and a consumer that passes neither keeps the
 * generic immediate departure.
 */
export function resolveLivePulseDelayS(
  ref: { readonly current: number } | undefined,
  prop: number,
): number {
  return ref === undefined ? prop : ref.current;
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
