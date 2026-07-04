// Dev instrumentation: counts WHY System-A nerve pulses (the fabric wavefront)
// do / don't fire per transaction-link, and rolls that up per block. Pure
// module singleton — same idiom as `simClock` / `galaxyFrame`: read and mutated
// directly, reset by tests. Always-on (a handful of integer increments per
// link — negligible). The WINDOW hook that surfaces this lives in ui-app, so
// the library stays free of `window` / env coupling.

/** Per-link terminal outcome. `fired` is the success bucket; the rest are the
 *  reasons one link produced zero pulses. `backfill` = suppressed during
 *  catch-up (never reached path planning). */
export type DropReason =
  | 'fired'
  | 'no-outputs'
  | 'no-parents'
  | 'no-source'
  | 'all-paths-failed'
  | 'backfill';

/** Why one source→dst routing attempt produced no path (explains
 *  `all-paths-failed`). `endpoint-missing` = an endpoint absent from the
 *  neighbour graph = the stale/throttled-graph race. */
export type PathFail = 'endpoint-missing' | 'no-path';

/** Write side, so `planPulses` stays decoupled from the singleton. */
export interface PulseStatsSink {
  bump(reason: DropReason, n?: number): void;
  bumpPath(reason: PathFail, n?: number): void;
}

export interface PulseStatsSnapshot {
  linkReasons: Record<DropReason, number>;
  pathFails: Record<PathFail, number>;
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
}

function zeroReasons(): Record<DropReason, number> {
  return {
    fired: 0,
    'no-outputs': 0,
    'no-parents': 0,
    'no-source': 0,
    'all-paths-failed': 0,
    backfill: 0,
  };
}
function zeroPathFails(): Record<PathFail, number> {
  return { 'endpoint-missing': 0, 'no-path': 0 };
}

interface PulseStatsState extends PulseStatsSink {
  linkReasons: Record<DropReason, number>;
  pathFails: Record<PathFail, number>;
  blocksTotal: number;
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
      this.linkReasons['no-parents'] +
      this.linkReasons['no-source'] +
      this.linkReasons['all-paths-failed'];
    return {
      linkReasons: { ...this.linkReasons },
      pathFails: { ...this.pathFails },
      blocksTotal: this.blocksTotal,
      blocksWithLinks,
      blocksLit,
      blocksSilent: Math.max(0, this.blocksTotal - blocksLit),
      blocksNoLinks: Math.max(0, this.blocksTotal - blocksWithLinks),
      blocksLinksButDark: Math.max(0, blocksWithLinks - blocksLit),
      firedRatePct:
        terminal === 0 ? 0 : (this.linkReasons.fired / terminal) * 100,
    };
  },

  reset() {
    this.linkReasons = zeroReasons();
    this.pathFails = zeroPathFails();
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
