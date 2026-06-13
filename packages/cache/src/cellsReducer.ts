// Frontend cache for the cell-galaxy projection.
//
// Mirrors the Rust `CellGalaxy` projection's wire shape (from
// `cknerv-core::projection::cells`). The cache holds the live cell set;
// `applyCellDelta` mutates it via Birth/Death/Tag/Gc/Pulse/Stats/Link.
// `fromCellsSnapshot()` hydrates from a snapshot frame.

import type {
  Cell,
  CellDelta,
  CellGalaxySnapshot,
  CellLink,
  CellLinkRecord,
  RevisionedCellDelta,
} from '@cknerv/types';

/** FIFO retention for nerve-pulse causal edges. Pulses live ~0.8 s on
 *  the GPU, so 128 entries is plenty even at burst rates of ~150 tx/s. */
export const DEFAULT_LINK_RING_CAPACITY = 128;

export interface CellsReducerOptions {
  linkRingCapacity?: number;
}

function linkRingCapacity(opts?: CellsReducerOptions): number {
  return Math.max(0, opts?.linkRingCapacity ?? DEFAULT_LINK_RING_CAPACITY);
}

export interface CellGalaxyCache {
  revision: number;
  /** Map keyed by cell.id for O(1) lookup. Iteration order matches insertion
   *  order, which the visual layer relies on (newest cells last → tag-newest
   *  semantics). */
  cells: Map<number, Cell>;
  lastPulseAtMs: number;
  /** Recent causal edges (input cells → output cells of one tx). FIFO,
   *  capped at LINK_RING_CAPACITY. NervePulses tracks its own consumed-up-to
   *  seq cursor and processes anything with a higher seq. */
  recentLinks: CellLink[];
  /** Monotonic seq assigned to the most recent link. 0 = no link yet. */
  linksSeq: number;
  /** Cumulative on-chain counters mirrored from the backend. CellsHud reads
   *  these for its TOTAL / DEAD / ALIVE rows so the panel reflects chain
   *  reality rather than what's currently rendered in the galaxy. */
  totalBirths: number;
  totalDeaths: number;
  /** Boot-time backfill progress, or null when not seeding. Drives the
   *  BackfillHud and (server-side) block-pulse suppression. Tx links still
   *  stream during backfill so nerves refill with cells. */
  backfill: { done: number; total: number } | null;
}

export function emptyCellsCache(): CellGalaxyCache {
  return {
    revision: 0,
    cells: new Map(),
    lastPulseAtMs: 0,
    recentLinks: [],
    linksSeq: 0,
    totalBirths: 0,
    totalDeaths: 0,
    backfill: null,
  };
}

export function fromCellsSnapshot(
  rev: number,
  snap: CellGalaxySnapshot,
  opts: CellsReducerOptions = {},
): CellGalaxyCache {
  const cells = new Map<number, Cell>();
  for (const c of snap.cells) cells.set(c.id, c);
  // Hydrate recentLinks from the snapshot's historical link records,
  // assigning sequential seq numbers in chronological order. The
  // backend ships these so the frontend tx DAG can be reconstructed
  // on first paint without orphaning cells alive at page load.
  const records: CellLinkRecord[] = snap.recent_links ?? [];
  const sorted = [...records].sort((a, b) => a.at_ms - b.at_ms);
  const cap = linkRingCapacity(opts);
  const capped = cap === 0 ? [] : sorted.slice(-cap);
  const recentLinks: CellLink[] = capped.map((r, i) => ({
    seq: i + 1,
    tx_hash: r.tx_hash,
    block: r.block,
    from_ids: r.from_ids,
    to_ids: r.to_ids,
    parents: r.parents,
    tag: r.tag,
    at_ms: r.at_ms,
  }));
  return {
    revision: rev,
    cells,
    lastPulseAtMs: snap.last_pulse_at_ms,
    recentLinks,
    linksSeq: recentLinks.length,
    totalBirths: snap.total_births ?? 0,
    totalDeaths: snap.total_deaths ?? 0,
    backfill: snap.backfill ?? null,
  };
}

/** Shallow working copy whose `cells` Map and `recentLinks` array are fresh
 *  so in-place mutation never leaks into the caller's cache. Primitive fields
 *  ride along via spread. */
function cloneForMutation(prev: CellGalaxyCache): CellGalaxyCache {
  return { ...prev, cells: new Map(prev.cells), recentLinks: prev.recentLinks.slice() };
}

/** Apply one delta to `c` **in place**. Returns true iff something changed
 *  (death/tag of a missing cell are no-ops). Shared by the pure single-delta
 *  `applyCellDelta` and the batched `applyRevisionedCellDeltas`. */
function mutateCellDelta(
  c: CellGalaxyCache,
  d: CellDelta,
  opts: CellsReducerOptions,
): boolean {
  switch (d.type) {
    case 'birth': {
      c.cells.set(d.cell.id, d.cell);
      return true;
    }
    case 'death': {
      const existing = c.cells.get(d.id);
      if (!existing) return false;
      c.cells.set(d.id, { ...existing, death_at_ms: d.at_ms });
      return true;
    }
    case 'tag': {
      const existing = c.cells.get(d.id);
      if (!existing) return false;
      c.cells.set(d.id, { ...existing, tag: d.tag });
      return true;
    }
    case 'gc': {
      for (const id of d.ids) c.cells.delete(id);
      return true;
    }
    case 'pulse': {
      c.lastPulseAtMs = d.at_ms;
      return true;
    }
    case 'stats': {
      c.totalBirths = d.total_births;
      c.totalDeaths = d.total_deaths;
      return true;
    }
    case 'link': {
      const nextSeq = c.linksSeq + 1;
      const link: CellLink = {
        seq: nextSeq,
        tx_hash: d.tx_hash,
        block: d.block,
        from_ids: d.from_ids,
        to_ids: d.to_ids,
        parents: d.parents,
        tag: d.tag,
        at_ms: d.at_ms,
      };
      const cap = linkRingCapacity(opts);
      if (cap === 0) {
        c.recentLinks = [];
      } else {
        c.recentLinks.push(link);
        if (c.recentLinks.length > cap) {
          c.recentLinks.splice(0, c.recentLinks.length - cap);
        }
      }
      c.linksSeq = nextSeq;
      return true;
    }
    case 'backfill': {
      c.backfill = d.active ? { done: d.done, total: d.total } : null;
      return true;
    }
    default: {
      const _exhaustive: never = d;
      void _exhaustive;
      return false;
    }
  }
}

/** Apply a single delta to a cells cache. **Pure**; returns a new cache, or
 *  the same reference when the delta is a no-op (preserves referential
 *  equality for React selectors). */
export function applyCellDelta(
  prev: CellGalaxyCache,
  d: CellDelta,
  opts: CellsReducerOptions = {},
): CellGalaxyCache {
  const next = cloneForMutation(prev);
  return mutateCellDelta(next, d, opts) ? next : prev;
}

export function applyRevisionedCellDeltas(
  prev: CellGalaxyCache,
  deltas: RevisionedCellDelta[],
  opts: CellsReducerOptions = {},
): CellGalaxyCache {
  if (deltas.length === 0) return prev;
  // One clone for the whole batch — every delta mutates this single working
  // copy, so a flood of N deltas costs one Map copy, not N.
  const next = cloneForMutation(prev);
  let changed = false;
  let maxRev = prev.revision;
  for (const rd of deltas) {
    if (mutateCellDelta(next, rd.delta, opts)) changed = true;
    if (rd.revision > maxRev) maxRev = rd.revision;
  }
  if (!changed && maxRev === prev.revision) return prev;
  next.revision = maxRev;
  return next;
}
