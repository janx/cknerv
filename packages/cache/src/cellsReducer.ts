// Frontend cache for the cell-galaxy projection.
//
// Mirrors the Rust `CellGalaxy` projection's wire shape (from
// `cknerv-core::projection::cells`). The cache holds the live cell set;
// `applyCellDelta` mutates it via Birth/Death/Tag/Gc/Pulse/Stats/LinkPrune/Link.
// `fromCellsSnapshot()` hydrates from a snapshot frame.

import type {
  Cell,
  CellDelta,
  CellGalaxySnapshot,
  CellLink,
  CellLinkRecord,
  ReplayPhase,
  RevisionedCellDelta,
} from '@cknerv/types';

/** Causal evidence history retained for inspection and memory recall.
 *  Mirrors the backend's default `recent_links_cap`. */
export const DEFAULT_RECENT_LINKS_CAPACITY = 2048;

/** FIFO retention for newly-arrived links that may trigger live visual
 *  pulses. Pulses live ~0.8 s on the GPU, so 128 entries is enough even at
 *  burst rates of ~150 tx/s. Snapshot history never enters this queue. */
export const DEFAULT_LINK_RING_CAPACITY = 128;

export interface CellsReducerOptions {
  recentLinksCapacity?: number;
  linkRingCapacity?: number;
}

export interface ActiveReplayProgress {
  done: number;
  total: number;
  /** Normalized to `boot` when an older snapshot/delta omits the field. */
  phase: ReplayPhase;
}

/** Compact visual evidence captured at the exact canonical invalidation
 * boundary. Deliberately excludes the Cell payload (`data_hex`, scripts,
 * capacity, ...): renderers need only the real retained position and stable
 * content identity to show which records just lost canonical status. */
export interface CanonicalRewriteEcho {
  id: number;
  posSeed: [number, number, number];
  contentHash: string;
}

export interface CanonicalRewriteMarker {
  fromBlock: number;
  invalidatedCells: CanonicalRewriteEcho[];
}

function normalizeReplayProgress(progress: {
  done: number;
  total: number;
  phase?: ReplayPhase;
}): ActiveReplayProgress {
  return {
    done: progress.done,
    total: progress.total,
    phase: progress.phase ?? 'boot',
  };
}

function recentLinksCapacity(opts?: CellsReducerOptions): number {
  return Math.max(
    0,
    opts?.recentLinksCapacity ?? DEFAULT_RECENT_LINKS_CAPACITY,
  );
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
  /** Authoritative recent causal evidence used by inspection, identity, and
   *  memory recall. Snapshot history hydrates this FIFO in full up to the
   *  configured evidence capacity. */
  recentLinks: CellLink[];
  /** Newly-arrived Link deltas available to live pulse/highlight consumers.
   *  This short FIFO is empty after snapshot hydration, preventing historical
   *  evidence from replaying as current activity. */
  pulseLinks: CellLink[];
  /** Monotonic seq assigned to the most recent link. 0 = no link yet. */
  linksSeq: number;
  /**
   * One-shot causal invalidation marker. Its object identity changes only
   * when a `link_prune` delta arrives, allowing renderers to clear already
   * planned activity once without rejecting later replacement-chain links.
   */
  linkPrune: CanonicalRewriteMarker | null;
  /** Canonical-window counters mirrored from the backend. Unlike the bounded
   *  rendered Cell map, these survive ordinary GC/cap eviction; a controlled
   *  deep-reorg rebuild resets and reconstructs them from its replay window. */
  totalBirths: number;
  totalDeaths: number;
  /** Historical replay progress, or null during ordinary live polling. Drives the
   *  BackfillHud and (server-side) block-pulse suppression. Tx links still
   *  stream during backfill so nerves refill with cells. */
  backfill: ActiveReplayProgress | null;
}

export function emptyCellsCache(): CellGalaxyCache {
  return {
    revision: 0,
    cells: new Map(),
    lastPulseAtMs: 0,
    recentLinks: [],
    pulseLinks: [],
    linksSeq: 0,
    linkPrune: null,
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
  // Hydrate the authoritative evidence history from snapshot records,
  // assigning sequential seq numbers in chronological order. Historical
  // records deliberately do not enter `pulseLinks`: loading a page is not a
  // new chain event and must not replay old traffic.
  const records: CellLinkRecord[] = snap.recent_links ?? [];
  const sorted = [...records].sort((a, b) => a.at_ms - b.at_ms);
  const cap = recentLinksCapacity(opts);
  const capped = cap === 0 ? [] : sorted.slice(-cap);
  const recentLinks: CellLink[] = capped.map((r, i) => ({
    seq: i + 1,
    tx_hash: r.tx_hash,
    block: r.block,
    from_ids: r.from_ids,
    to_ids: r.to_ids,
    endpoint_anchors: r.endpoint_anchors,
    parents: r.parents,
    tag: r.tag,
    at_ms: r.at_ms,
  }));
  return {
    revision: rev,
    cells,
    lastPulseAtMs: snap.last_pulse_at_ms,
    recentLinks,
    pulseLinks: [],
    linksSeq: recentLinks.length,
    linkPrune: null,
    totalBirths: snap.total_births ?? 0,
    totalDeaths: snap.total_deaths ?? 0,
    backfill: snap.backfill ? normalizeReplayProgress(snap.backfill) : null,
  };
}

/** Shallow working copy whose mutable collections are fresh so in-place
 *  mutation never leaks into the caller's cache. Primitive fields ride along
 *  via spread. */
function cloneForMutation(prev: CellGalaxyCache): CellGalaxyCache {
  return {
    ...prev,
    cells: new Map(prev.cells),
    recentLinks: prev.recentLinks.slice(),
    pulseLinks: prev.pulseLinks.slice(),
  };
}

function appendBounded<T>(items: T[], item: T, capacity: number): void {
  if (capacity === 0) {
    items.length = 0;
    return;
  }
  items.push(item);
  if (items.length > capacity) {
    items.splice(0, items.length - capacity);
  }
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
    case 'link_prune': {
      // link_prune is emitted before the rollback GC. Capture a compact,
      // immutable witness while the orphan suffix is still materialized; the
      // following GC can then remove canonical records without erasing the
      // renderer's one-shot correction evidence.
      const invalidatedCells: CanonicalRewriteEcho[] = [];
      for (const cell of c.cells.values()) {
        if (cell.birth_block < d.from_block) continue;
        invalidatedCells.push({
          id: cell.id,
          posSeed: [...cell.pos_seed],
          contentHash: cell.content_hash,
        });
      }
      c.recentLinks = c.recentLinks.filter((link) => link.block < d.from_block);
      c.pulseLinks = c.pulseLinks.filter((link) => link.block < d.from_block);
      // Never rewind linksSeq: replacement-chain links must receive fresh
      // identities so stale cursors and recall requests cannot alias them.
      c.linkPrune = { fromBlock: d.from_block, invalidatedCells };
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
        endpoint_anchors: d.endpoint_anchors,
        parents: d.parents,
        tag: d.tag,
        at_ms: d.at_ms,
      };
      appendBounded(c.recentLinks, link, recentLinksCapacity(opts));
      appendBounded(c.pulseLinks, link, linkRingCapacity(opts));
      c.linksSeq = nextSeq;
      return true;
    }
    case 'backfill': {
      c.backfill = d.active ? normalizeReplayProgress(d) : null;
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
