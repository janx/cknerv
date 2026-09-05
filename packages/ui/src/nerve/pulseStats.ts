// Dev instrumentation: counts WHY System-A nerve pulses (the fabric wavefront)
// do / don't fire per transaction-link, and rolls that up per block. Pure
// module singleton — same idiom as `simClock` / `galaxyFrame`: read and mutated
// directly, reset by tests. Always-on (a handful of integer increments per
// link — negligible). The WINDOW hook that surfaces this lives in ui-app, so
// the library stays free of `window` / env coupling.

/** Per-link terminal outcome. `fired` is the success bucket; the rest are the
 *  reasons one link produced zero pulses. `no-origin` = the link named no
 *  consumed input to depart from (cellbase, or a record persisted before
 *  inputs were anchored). `backfill` = suppressed during catch-up (never
 *  reached path planning). */
export type DropReason =
  | 'fired'
  | 'no-outputs'
  | 'no-origin'
  | 'all-paths-failed'
  | 'batch-budget'
  | 'backfill';

/** Counters the retired sibling-proxy origin left behind. Nothing bumps them
 *  any more — a pulse departs from the consumed cell's own anchor, so there
 *  is no parent bucket to miss and no surviving relative to look for. They
 *  stay in the exposed snapshot reading 0 so a baseline captured before the
 *  rewrite still diffs field by field against one captured after. */
export type RetiredDropReason = 'no-parents' | 'no-source';

/** Every key the exposed `linkReasons` block carries — live reasons plus the
 *  retired ones. Only a {@link DropReason} can be bumped. */
export type LinkReasonCounter = DropReason | RetiredDropReason;

/** Origin honesty of a planned pulse, one bump per pulse: `origin-retained`
 *  left a cell the server still held (the anchor carries its content),
 *  `origin-derived` left an address the server derived from the outpoint
 *  alone. The split is the direct measure of how far outside the retained
 *  window the chain's spends reach. */
export type OriginKind = 'origin-retained' | 'origin-derived';

/** Why one source→dst routing attempt produced no path (explains
 *  `all-paths-failed`). `endpoint-missing` = an endpoint absent from the
 *  neighbour graph = the stale/throttled-graph race. */
export type PathFail = 'endpoint-missing' | 'no-path';

/** Origin honesty of a block-guarantee rescue pulse: `anchored` departed
 *  from beside the consumed coin's true position (the link carried input
 *  anchors); `rim` declared the origin outside the retained window and
 *  entered from the tissue rim. */
export type RescueKind = 'anchored' | 'rim';

/** Rescue-pass bookkeeping. The two kinds count fired rescues (the honesty
 *  mix); `dst-substituted` = none of the link's outputs were routable so the
 *  pulse landed beside the newborn's anchored position; `failed` = a rescue
 *  ATTEMPT found nothing routable (defensive — should stay 0). A still-dark
 *  block is retried on each later batch slice, so one stubborn block can
 *  bump `failed` once per slice, not once overall. */
export type RescueCounter = RescueKind | 'dst-substituted' | 'failed';

/** Per-recall terminal outcome. `recalled` is the success bucket; the rest are
 *  the reasons one user-driven recall produced no route. Recall plans on the
 *  staged graph, so `no-source` counts links whose endpoints have ALL left the
 *  stage — the cost worth measuring before deciding whether an anchored
 *  free-space route is worth building. */
export type RecallOutcome =
  | 'recalled'
  | 'link-missing'
  | 'no-source'
  | 'no-route';

/** Write side, so `planPulses` stays decoupled from the singleton. */
export interface PulseStatsSink {
  bump(reason: DropReason, n?: number): void;
  bumpPath(reason: PathFail, n?: number): void;
  bumpOrigin(kind: OriginKind, n?: number): void;
}

export interface PulseStatsSnapshot {
  linkReasons: Record<LinkReasonCounter, number>;
  pathFails: Record<PathFail, number>;
  /** Origin honesty of the pulses actually planned (main path + anchored
   *  rescues). A rim rescue names no cell and bumps neither. */
  origins: Record<OriginKind, number>;
  /** User-driven historical recalls, by terminal outcome. */
  recallOutcomes: Record<RecallOutcome, number>;
  /** Block-guarantee rescue outcomes (the origin honesty mix). */
  rescues: Record<RescueCounter, number>;
  /** Live links evicted from the bounded pulse ring before the cursor
   *  consumed them (a seq gap) — silent guarantee loss if ever nonzero. */
  ringEvicted: number;
  /** Live-plan driver gauges (the frame-sliced pulse queue). `forcedByDeadline`
   *  counts frames that drained a batch past the per-frame budget because its
   *  departure deadline had arrived (the tail T10 bounds); `maxStepMs` is the
   *  longest single planner step wall-time observed in the window, in ms (the
   *  slice's worst grain). Both zero on reset. */
  forcedByDeadline: number;
  maxStepMs: number;
  /** All blocks observed (one per `pulse` delta), incl. empty ones. */
  blocksTotal: number;
  /** Blocks that emitted ≥1 tx-link. */
  blocksWithLinks: number;
  /** Blocks for which ≥1 pulse fired. */
  blocksLit: number;
  /** blocksTotal − blocksLit. */
  blocksSilent: number;
  /** blocksTotal − blocksWithLinks (truly empty — deferred territory). */
  blocksNoLinks: number;
  /** blocksWithLinks − blocksLit (had txs, every pulse dropped — Phase-2 target). */
  blocksLinksButDark: number;
  /** fired / (all planPulses terminal outcomes), as a percentage. */
  firedRatePct: number;
  /** recalled / (all recall outcomes), as a percentage. */
  recalledRatePct: number;
}

function zeroReasons(): Record<LinkReasonCounter, number> {
  return {
    fired: 0,
    'no-outputs': 0,
    'no-origin': 0,
    'batch-budget': 0,
    'all-paths-failed': 0,
    backfill: 0,
    // Retired, kept at 0 for baseline continuity — see RetiredDropReason.
    'no-parents': 0,
    'no-source': 0,
  };
}
function zeroOrigins(): Record<OriginKind, number> {
  return { 'origin-retained': 0, 'origin-derived': 0 };
}
function zeroPathFails(): Record<PathFail, number> {
  return { 'endpoint-missing': 0, 'no-path': 0 };
}
function zeroRescues(): Record<RescueCounter, number> {
  return { anchored: 0, rim: 0, 'dst-substituted': 0, failed: 0 };
}
function zeroRecallOutcomes(): Record<RecallOutcome, number> {
  return { recalled: 0, 'link-missing': 0, 'no-source': 0, 'no-route': 0 };
}

interface PulseStatsState extends PulseStatsSink {
  linkReasons: Record<LinkReasonCounter, number>;
  pathFails: Record<PathFail, number>;
  origins: Record<OriginKind, number>;
  recallOutcomes: Record<RecallOutcome, number>;
  rescues: Record<RescueCounter, number>;
  ringEvicted: number;
  forcedByDeadline: number;
  maxStepMs: number;
  blocksTotal: number;
  bumpRecall(outcome: RecallOutcome, n?: number): void;
  bumpRescue(kind: RescueCounter, n?: number): void;
  bumpRingEvicted(n?: number): void;
  /** One frame drained a batch past the budget on its departure deadline. */
  observeForcedByDeadline(): void;
  /** Fold one frame's longest planner step into the window's running max. */
  observeStepMs(ms: number): void;
  // Internal block-rollup state. `link.block` is monotonic non-decreasing, so
  // we close the current block when a strictly different block id arrives.
  _curBlock: number;
  _curBlockLit: boolean;
  _closedWithLinks: number;
  _closedLit: number;
  observeLink(block: number, lit: boolean): void;
  observeBlockTick(): void;
  snapshot(): PulseStatsSnapshot;
  reset(): void;
}

export const pulseStats: PulseStatsState = {
  linkReasons: zeroReasons(),
  pathFails: zeroPathFails(),
  origins: zeroOrigins(),
  recallOutcomes: zeroRecallOutcomes(),
  rescues: zeroRescues(),
  ringEvicted: 0,
  forcedByDeadline: 0,
  maxStepMs: 0,
  blocksTotal: 0,
  _curBlock: -1,
  _curBlockLit: false,
  _closedWithLinks: 0,
  _closedLit: 0,

  bump(reason, n = 1) {
    this.linkReasons[reason] += n;
  },
  bumpPath(reason, n = 1) {
    this.pathFails[reason] += n;
  },
  bumpOrigin(kind, n = 1) {
    this.origins[kind] += n;
  },
  bumpRecall(outcome, n = 1) {
    this.recallOutcomes[outcome] += n;
  },
  bumpRescue(kind, n = 1) {
    this.rescues[kind] += n;
  },
  bumpRingEvicted(n = 1) {
    this.ringEvicted += n;
  },
  observeForcedByDeadline() {
    this.forcedByDeadline += 1;
  },
  observeStepMs(ms) {
    if (ms > this.maxStepMs) this.maxStepMs = ms;
  },

  observeLink(block, lit) {
    if (block !== this._curBlock) {
      if (this._curBlock !== -1) {
        this._closedWithLinks += 1;
        if (this._curBlockLit) this._closedLit += 1;
      }
      this._curBlock = block;
      this._curBlockLit = false;
    }
    if (lit) this._curBlockLit = true;
  },

  observeBlockTick() {
    this.blocksTotal += 1;
  },

  snapshot() {
    const openWithLinks = this._curBlock !== -1 ? 1 : 0;
    const openLit = this._curBlock !== -1 && this._curBlockLit ? 1 : 0;
    const blocksWithLinks = this._closedWithLinks + openWithLinks;
    const blocksLit = this._closedLit + openLit;
    const terminal =
      this.linkReasons.fired +
      this.linkReasons['no-outputs'] +
      this.linkReasons['no-origin'] +
      this.linkReasons['no-parents'] +
      this.linkReasons['no-source'] +
      this.linkReasons['all-paths-failed'] +
      this.linkReasons['batch-budget'];
    const recallTotal =
      this.recallOutcomes.recalled +
      this.recallOutcomes['link-missing'] +
      this.recallOutcomes['no-source'] +
      this.recallOutcomes['no-route'];
    return {
      linkReasons: { ...this.linkReasons },
      pathFails: { ...this.pathFails },
      origins: { ...this.origins },
      recallOutcomes: { ...this.recallOutcomes },
      rescues: { ...this.rescues },
      ringEvicted: this.ringEvicted,
      forcedByDeadline: this.forcedByDeadline,
      maxStepMs: this.maxStepMs,
      blocksTotal: this.blocksTotal,
      blocksWithLinks,
      blocksLit,
      blocksSilent: Math.max(0, this.blocksTotal - blocksLit),
      blocksNoLinks: Math.max(0, this.blocksTotal - blocksWithLinks),
      blocksLinksButDark: Math.max(0, blocksWithLinks - blocksLit),
      firedRatePct:
        terminal === 0 ? 0 : (this.linkReasons.fired / terminal) * 100,
      recalledRatePct:
        recallTotal === 0
          ? 0
          : (this.recallOutcomes.recalled / recallTotal) * 100,
    };
  },

  reset() {
    this.linkReasons = zeroReasons();
    this.pathFails = zeroPathFails();
    this.origins = zeroOrigins();
    this.recallOutcomes = zeroRecallOutcomes();
    this.rescues = zeroRescues();
    this.ringEvicted = 0;
    this.forcedByDeadline = 0;
    this.maxStepMs = 0;
    this.blocksTotal = 0;
    this._curBlock = -1;
    this._curBlockLit = false;
    this._closedWithLinks = 0;
    this._closedLit = 0;
  },
};

export function snapshotPulseStats(): PulseStatsSnapshot {
  return pulseStats.snapshot();
}
export function resetPulseStats(): void {
  pulseStats.reset();
}
