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

/** Net Cell changes carried by one cache transition. Reducers already see the
 * exact projection deltas, so publishing this compact journal lets renderers
 * update topology without scanning and snapshotting the complete retained Map
 * a second time. `reset` marks an authoritative snapshot replacement. */
export interface CellChangeSet {
  /** Opaque identity of the Cell Map this journal applies after. A renderer
   * that skipped an intermediate React state can detect the mismatch and fall
   * back to one canonical rebuild instead of applying an unsafe partial diff. */
  readonly baseToken: object | null;
  readonly reset: boolean;
  /** True when a batch deleted at least one existing Map entry. Deletion can
   * shift the insertion-ordered render prefix, including when the same id is
   * reinserted later in the batch, so incremental prefix consumers must fall
   * back to one canonical rebuild. */
  readonly orderInvalidated: boolean;
  readonly born: readonly number[];
  readonly died: readonly number[];
  readonly evicted: readonly number[];
  /** Retained Cell objects whose final value differs from the previous cache.
   * Includes births and metadata/lifecycle replacements, but not removals. */
  readonly updated: readonly number[];
}

const EMPTY_CELL_IDS: readonly number[] = Object.freeze([] as number[]);

/** Stable no-op journal for event/counter-only cache transitions. */
export const NO_CELL_CHANGES: CellChangeSet = Object.freeze({
  baseToken: null,
  reset: false,
  orderInvalidated: false,
  born: EMPTY_CELL_IDS,
  died: EMPTY_CELL_IDS,
  evicted: EMPTY_CELL_IDS,
  updated: EMPTY_CELL_IDS,
});

const RESET_CELL_CHANGES: CellChangeSet = Object.freeze({
  ...NO_CELL_CHANGES,
  reset: true,
});

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
  /** Opaque identity that changes exactly when `cells` changes. */
  cellsToken: object;
  /** Changes from the immediately previous cache value. Browser-only reducer
   * metadata; this is not part of the Rust/TypeScript wire contract. */
  cellChanges: CellChangeSet;
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
    cellsToken: {},
    cellChanges: RESET_CELL_CHANGES,
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

/** Content equality over every `Cell` field (nested `out_point` and the
 *  `pos_seed` tuple compared element-wise; never mistake this for a
 *  reference check). Reorg/resync replays re-deliver records whose content
 *  the cache already retains as freshly parsed objects; this comparator is
 *  what lets those upserts keep the retained object identity that
 *  downstream identity-keyed consumers (WeakMap presentation caches,
 *  render-slot diffs, mesh reconciles) depend on. */
export function cellContentEquals(a: Cell, b: Cell): boolean {
  return (
    a.id === b.id
    && a.born_at_ms === b.born_at_ms
    && a.death_at_ms === b.death_at_ms
    && a.birth_block === b.birth_block
    && a.tag === b.tag
    && a.pos_seed[0] === b.pos_seed[0]
    && a.pos_seed[1] === b.pos_seed[1]
    && a.pos_seed[2] === b.pos_seed[2]
    && a.out_point.tx_hash === b.out_point.tx_hash
    && a.out_point.index === b.out_point.index
    && a.capacity === b.capacity
    && a.data_hex === b.data_hex
    && a.content_hash === b.content_hash
    && a.lock_kind === b.lock_kind
    && a.asset_kind === b.asset_kind
  );
}

export function fromCellsSnapshot(
  rev: number,
  snap: CellGalaxySnapshot,
  opts: CellsReducerOptions = {},
  /** Previous cache, when this snapshot replaces live state (lagged resync,
   *  reconnect fallback). Membership, insertion order, token, and the reset
   *  journal stay authoritative from the snapshot; only the per-Cell object
   *  identity of content-identical records is reused so identity-keyed
   *  downstream caches survive the reset. */
  prev?: Pick<CellGalaxyCache, 'cells'>,
): CellGalaxyCache {
  const cells = new Map<number, Cell>();
  for (const c of snap.cells) {
    const retained = prev?.cells.get(c.id);
    cells.set(
      c.id,
      retained !== undefined && cellContentEquals(retained, c) ? retained : c,
    );
  }
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
    cellsToken: {},
    cellChanges: RESET_CELL_CHANGES,
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

/** Copy-on-write cache draft. Projection frames contain many deltas that do
 *  not touch Cell membership (pulse/stats/link/backfill). Keeping `cells`
 *  referentially stable for those frames lets renderers skip their expensive
 *  topology/static-buffer paths, while the first real Cell mutation in a
 *  batch still takes exactly one defensive Map copy. */
interface CellGalaxyDraft {
  value: CellGalaxyCache;
  cellsOwned: boolean;
  recentLinksOwned: boolean;
  pulseLinksOwned: boolean;
  touchedCellIds: Set<number>;
  cellOrderInvalidated: boolean;
}

function createDraft(prev: CellGalaxyCache): CellGalaxyDraft {
  return {
    value: { ...prev, cellChanges: NO_CELL_CHANGES },
    cellsOwned: false,
    recentLinksOwned: false,
    pulseLinksOwned: false,
    touchedCellIds: new Set(),
    cellOrderInvalidated: false,
  };
}

function touchCell(draft: CellGalaxyDraft, id: number): void {
  draft.touchedCellIds.add(id);
}

/** Derive the same net lifecycle semantics as comparing the previous and final
 * Maps, but inspect only ids touched by this reducer batch. Intermediate
 * birth/death/gc combinations therefore collapse exactly as the old full-map
 * diff did. */
function summarizeCellChanges(
  previous: ReadonlyMap<number, Cell>,
  next: ReadonlyMap<number, Cell>,
  touchedCellIds: ReadonlySet<number>,
  baseToken: object,
  orderInvalidated: boolean,
): CellChangeSet {
  if (previous === next) return NO_CELL_CHANGES;

  const born: number[] = [];
  const died: number[] = [];
  const evicted: number[] = [];
  const updated: number[] = [];
  for (const id of touchedCellIds) {
    const hadBefore = previous.has(id);
    const hasAfter = next.has(id);
    const before = previous.get(id);
    const after = next.get(id);

    if (!hadBefore && hasAfter) born.push(id);
    else if (
      hadBefore
      && hasAfter
      && before?.death_at_ms === null
      && after?.death_at_ms !== null
    ) died.push(id);
    else if (
      hadBefore
      && !hasAfter
      && before?.death_at_ms === null
    ) evicted.push(id);

    if (hasAfter && (!hadBefore || before !== after)) updated.push(id);
  }

  return {
    baseToken,
    reset: false,
    orderInvalidated,
    born,
    died,
    evicted,
    updated,
  };
}

function writableCells(draft: CellGalaxyDraft): Map<number, Cell> {
  if (!draft.cellsOwned) {
    draft.value.cells = new Map(draft.value.cells);
    draft.value.cellsToken = {};
    draft.cellsOwned = true;
  }
  return draft.value.cells;
}

function writableRecentLinks(draft: CellGalaxyDraft): CellLink[] {
  if (!draft.recentLinksOwned) {
    draft.value.recentLinks = draft.value.recentLinks.slice();
    draft.recentLinksOwned = true;
  }
  return draft.value.recentLinks;
}

function writablePulseLinks(draft: CellGalaxyDraft): CellLink[] {
  if (!draft.pulseLinksOwned) {
    draft.value.pulseLinks = draft.value.pulseLinks.slice();
    draft.pulseLinksOwned = true;
  }
  return draft.value.pulseLinks;
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
  draft: CellGalaxyDraft,
  d: CellDelta,
  opts: CellsReducerOptions,
): boolean {
  const c = draft.value;
  switch (d.type) {
    case 'birth': {
      // Reorg suffix rewrites and reconnect catch-up can replay a birth whose
      // content this cache already retains. A byte-identical upsert is a pure
      // no-op: the retained object keeps its identity, no journal entry is
      // published, and (when the whole batch is no-op) `cells`/`cellsToken`
      // stay referentially stable. Any real field difference still replaces.
      const existing = c.cells.get(d.cell.id);
      if (existing !== undefined && cellContentEquals(existing, d.cell)) {
        return false;
      }
      touchCell(draft, d.cell.id);
      writableCells(draft).set(d.cell.id, d.cell);
      return true;
    }
    case 'death': {
      const existing = c.cells.get(d.id);
      if (!existing) return false;
      // Replayed death already recorded at this exact timestamp: no-op.
      if (existing.death_at_ms === d.at_ms) return false;
      touchCell(draft, d.id);
      writableCells(draft).set(d.id, { ...existing, death_at_ms: d.at_ms });
      return true;
    }
    case 'tag': {
      const existing = c.cells.get(d.id);
      if (!existing) return false;
      // Replayed tag with the value already applied: no-op.
      if (existing.tag === d.tag) return false;
      touchCell(draft, d.id);
      writableCells(draft).set(d.id, { ...existing, tag: d.tag });
      return true;
    }
    case 'gc': {
      // Replayed GC for ids this cache never retained (or already removed)
      // must not cost a defensive Map copy or a token turnover.
      const present = d.ids.filter((id) => c.cells.has(id));
      if (present.length === 0) return false;
      for (const id of present) touchCell(draft, id);
      const cells = writableCells(draft);
      for (const id of present) {
        if (cells.delete(id)) draft.cellOrderInvalidated = true;
      }
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
      draft.recentLinksOwned = true;
      draft.pulseLinksOwned = true;
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
      appendBounded(
        writableRecentLinks(draft),
        link,
        recentLinksCapacity(opts),
      );
      appendBounded(
        writablePulseLinks(draft),
        link,
        linkRingCapacity(opts),
      );
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
  const draft = createDraft(prev);
  if (!mutateCellDelta(draft, d, opts)) return prev;
  draft.value.cellChanges = summarizeCellChanges(
    prev.cells,
    draft.value.cells,
    draft.touchedCellIds,
    prev.cellsToken,
    draft.cellOrderInvalidated,
  );
  return draft.value;
}

export function applyRevisionedCellDeltas(
  prev: CellGalaxyCache,
  deltas: RevisionedCellDelta[],
  opts: CellsReducerOptions = {},
): CellGalaxyCache {
  if (deltas.length === 0) return prev;
  // One copy-on-write draft for the whole batch. A flood of N Cell deltas
  // costs one Map copy; a batch containing only event/counter deltas costs no
  // Map copy at all.
  const draft = createDraft(prev);
  let changed = false;
  let maxRev = prev.revision;
  for (const rd of deltas) {
    if (mutateCellDelta(draft, rd.delta, opts)) changed = true;
    if (rd.revision > maxRev) maxRev = rd.revision;
  }
  if (!changed && maxRev === prev.revision) return prev;
  draft.value.revision = maxRev;
  draft.value.cellChanges = summarizeCellChanges(
    prev.cells,
    draft.value.cells,
    draft.touchedCellIds,
    prev.cellsToken,
    draft.cellOrderInvalidated,
  );
  return draft.value;
}
