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
  DisplayProvenance,
  ReplayPhase,
  RevisionedCellDelta,
} from '@cknerv/types';
import {
  adjustCellsStats,
  aggregateCellsStats,
  cloneCellsStats,
  emptyCellsStats,
  type CellsStats,
} from './cellsStats';

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
  /** EVERY id deleted from the Map this batch — alive evictions (also listed
   * in `evicted`) and already-dead records reaped after their death display
   * window. Mirror stores (e.g. the columnar CellField) need the complete
   * removal set; the older lists deliberately don't carry dead-record GC. */
  readonly removed: readonly number[];
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
  removed: EMPTY_CELL_IDS,
});

const RESET_CELL_CHANGES: CellChangeSet = Object.freeze({
  ...NO_CELL_CHANGES,
  reset: true,
});

/** Server-owned display-plane budgets mirrored from `snapshot.display`.
 *  camelCase view over the snake_case wire `DisplayBudget`. */
export interface DisplayBudgetView {
  cells: number;
  nerveEdges: number;
}

/** Net display-plane changes carried by one cache transition, mirroring
 * `CellChangeSet`'s journal shape and reset semantics. The render pipeline
 * consumes ONLY this journal for stage membership — one journal-shaped code
 * path, zero source knowledge, O(churn) end to end.
 *
 * `updated` lists payload replacements of on-stage cells: canonical
 * `cellChanges.updated` ids that are currently staged members (death/tag of
 * a member) plus residents re-shipped via `enter_cells` while already
 * members. Ids also in `entered` are excluded — the enter itself carries the
 * final payload. */
export interface DisplayChangeSet {
  /** Opaque identity of the display membership this journal applies AFTER
   * the previous cache. A renderer that skipped an intermediate state
   * detects the mismatch and falls back to one canonical rebuild. */
  readonly baseToken: object | null;
  readonly reset: boolean;
  readonly entered: readonly number[];
  readonly exited: readonly number[];
  readonly updated: readonly number[];
}

/** Stable no-op journal for transitions that touch nothing on stage. */
export const NO_DISPLAY_CHANGES: DisplayChangeSet = Object.freeze({
  baseToken: null,
  reset: false,
  entered: EMPTY_CELL_IDS,
  exited: EMPTY_CELL_IDS,
  updated: EMPTY_CELL_IDS,
});

const RESET_DISPLAY_CHANGES: DisplayChangeSet = Object.freeze({
  ...NO_DISPLAY_CHANGES,
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
  /** Aggregate statistics over the retained Cell map, maintained
   *  incrementally per batch (O(touched ids), never a full-map scan) and
   *  identity-stable across batches that change nothing it reports. Always
   *  equals `aggregateCellsStats(cells, totalBirths, totalDeaths)`. */
  stats: CellsStats;
  // ── display plane ("who is on stage") — server-authored membership.
  // Presentation policy, never canonical truth: it feeds no counters and is
  // excluded from persistence. Absent section (old server) ⇒ null budget /
  // provenance and empty membership; the ui falls back to a canonical prefix.
  /** Staged membership ids in enter order (insertion-ordered Set). Mixes
   *  canonical ids with resident ids; resolve canonical-first at read time
   *  (`resolveDisplayCell`). */
  displayMembers: Set<number>;
  /** Full payloads for staged members outside the canonical retained set.
   *  A resident id that also appears in the canonical map (post-reorg
   *  overlap) keeps both records — canonical wins on lookup. */
  displayResidents: Map<number, Cell>;
  /** Server-owned product budgets, or null when the server ships no display
   *  plane. */
  displayBudget: DisplayBudgetView | null;
  displayProvenance: DisplayProvenance | null;
  /** Opaque identity that changes exactly when `displayMembers` or
   *  `displayResidents` change. Provenance-only transitions keep it. */
  displayToken: object;
  /** Display journal from the immediately previous cache value. Browser-only
   * reducer metadata; not part of the wire contract. */
  displayChanges: DisplayChangeSet;
}

/** Canonical-first resolution of a staged member id. The canonical retained
 *  record always wins over a resident payload with the same id (post-reorg
 *  overlap keeps both stored). */
export function resolveDisplayCell(
  cache: Pick<CellGalaxyCache, 'cells' | 'displayResidents'>,
  id: number,
): Cell | undefined {
  return cache.cells.get(id) ?? cache.displayResidents.get(id);
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
    stats: emptyCellsStats(),
    displayMembers: new Set(),
    displayResidents: new Map(),
    displayBudget: null,
    displayProvenance: null,
    displayToken: {},
    displayChanges: RESET_DISPLAY_CHANGES,
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

/** Compile-time completeness anchor for `cellContentEquals`: one entry per
 *  `Cell` field. Adding a field to `Cell` without teaching the comparator
 *  (and this list) fails typecheck here instead of silently treating changed
 *  records as content-identical; a removed or renamed field fails as an
 *  excess key. */
const comparedCellFields = {
  id: true,
  born_at_ms: true,
  death_at_ms: true,
  birth_block: true,
  tag: true,
  pos_seed: true,
  out_point: true,
  capacity: true,
  data_hex: true,
  content_hash: true,
  lock_kind: true,
  asset_kind: true,
} as const satisfies Record<keyof Cell, true>;
void comparedCellFields;

export function fromCellsSnapshot(
  rev: number,
  snap: CellGalaxySnapshot,
  opts: CellsReducerOptions = {},
  /** Previous cache, when this snapshot replaces live state (lagged resync,
   *  reconnect fallback). Membership, insertion order, token, and the reset
   *  journal stay authoritative from the snapshot; only the per-Cell object
   *  identity of content-identical records is reused so identity-keyed
   *  downstream caches survive the reset. */
  prev?: Pick<CellGalaxyCache, 'cells'>
    & Partial<Pick<CellGalaxyCache, 'displayResidents'>>,
): CellGalaxyCache {
  const cells = new Map<number, Cell>();
  for (const c of snap.cells) {
    const retained = prev?.cells.get(c.id);
    cells.set(
      c.id,
      retained !== undefined && cellContentEquals(retained, c) ? retained : c,
    );
  }
  // Seed the display plane from the snapshot's display section. An absent
  // section (old server) leaves budget/provenance null and membership empty —
  // the ui renders its canonical-prefix fallback instead.
  const display = snap.display;
  const displayMembers = new Set<number>(display?.members ?? []);
  const displayResidents = new Map<number, Cell>();
  for (const c of display?.residents ?? []) {
    const retained = prev?.displayResidents?.get(c.id) ?? prev?.cells.get(c.id);
    displayResidents.set(
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
    stats: aggregateCellsStats(
      cells,
      snap.total_births ?? 0,
      snap.total_deaths ?? 0,
    ),
    displayMembers,
    displayResidents,
    displayBudget: display
      ? {
        cells: display.budget.cells,
        nerveEdges: display.budget.nerve_edges,
      }
      : null,
    displayProvenance: display?.provenance ?? null,
    displayToken: {},
    displayChanges: RESET_DISPLAY_CHANGES,
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
  /** Display maps copy-on-write flag — one flag covers members + residents
   * so both copies (and one displayToken turnover) happen together. */
  displayOwned: boolean;
  touchedCellIds: Set<number>;
  /** Ids whose display MEMBERSHIP this batch may have changed. */
  touchedDisplayIds: Set<number>;
  /** Already-staged residents whose payload this batch re-shipped. */
  residentUpdatedIds: Set<number>;
  cellOrderInvalidated: boolean;
}

function createDraft(prev: CellGalaxyCache): CellGalaxyDraft {
  return {
    value: {
      ...prev,
      cellChanges: NO_CELL_CHANGES,
      displayChanges: NO_DISPLAY_CHANGES,
    },
    cellsOwned: false,
    recentLinksOwned: false,
    pulseLinksOwned: false,
    displayOwned: false,
    touchedCellIds: new Set(),
    touchedDisplayIds: new Set(),
    residentUpdatedIds: new Set(),
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
  const removed: number[] = [];
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
    if (hadBefore && !hasAfter) removed.push(id);
  }

  return {
    baseToken,
    reset: false,
    orderInvalidated,
    born,
    died,
    evicted,
    updated,
    removed,
  };
}

/** Advance the incremental stats across one batch: per touched id, swap the
 * initial contribution for the final one, then mirror the (possibly updated)
 * canonical counters. Identity-stable when nothing it reports changed, so
 * memoized HUD consumers can bail on non-Cell batches. */
function nextCellsStats(
  prevStats: CellsStats,
  previousCells: ReadonlyMap<number, Cell>,
  nextCells: ReadonlyMap<number, Cell>,
  touchedCellIds: ReadonlySet<number>,
  totalBirths: number,
  totalDeaths: number,
): CellsStats {
  const totalsChanged =
    prevStats.born !== totalBirths || prevStats.dead !== totalDeaths;
  if (previousCells === nextCells && !totalsChanged) return prevStats;
  const stats = cloneCellsStats(prevStats);
  if (previousCells !== nextCells) {
    for (const id of touchedCellIds) {
      adjustCellsStats(stats, previousCells.get(id), nextCells.get(id));
    }
  }
  stats.born = totalBirths;
  stats.live = totalBirths - totalDeaths;
  stats.dead = totalDeaths;
  return stats;
}

function writableCells(draft: CellGalaxyDraft): Map<number, Cell> {
  if (!draft.cellsOwned) {
    draft.value.cells = new Map(draft.value.cells);
    draft.value.cellsToken = {};
    draft.cellsOwned = true;
  }
  return draft.value.cells;
}

function writableDisplay(draft: CellGalaxyDraft): void {
  if (!draft.displayOwned) {
    draft.value.displayMembers = new Set(draft.value.displayMembers);
    draft.value.displayResidents = new Map(draft.value.displayResidents);
    draft.value.displayToken = {};
    draft.displayOwned = true;
  }
}

function displayProvenanceEquals(
  a: DisplayProvenance | null,
  b: DisplayProvenance,
): boolean {
  return (
    a !== null
    && a.mode === b.mode
    && a.source === b.source
    && a.updated_at_ms === b.updated_at_ms
    && (a.as_of === null) === (b.as_of === null)
    && (
      a.as_of === null
      || b.as_of === null
      || (a.as_of.block === b.as_of.block && a.as_of.hash === b.as_of.hash)
    )
  );
}

/** Derive the display journal for one batch. `entered`/`exited` are the net
 * membership diff over ids this batch touched; `updated` merges already-
 * staged residents whose payload was re-shipped with canonical `updated` ids
 * that are staged members — excluding ids that just entered (the enter
 * already carries the final payload). Returns the frozen no-op journal only
 * when the display maps kept their identity AND nothing on stage changed, so
 * a chained (possibly empty) journal always accompanies a displayToken
 * turnover. */
function summarizeDisplayChanges(
  previousMembers: ReadonlySet<number>,
  nextMembers: ReadonlySet<number>,
  touchedDisplayIds: ReadonlySet<number>,
  residentUpdatedIds: ReadonlySet<number>,
  canonicalUpdated: readonly number[],
  baseToken: object,
  displayTouched: boolean,
): DisplayChangeSet {
  const entered: number[] = [];
  const exited: number[] = [];
  for (const id of touchedDisplayIds) {
    const before = previousMembers.has(id);
    const after = nextMembers.has(id);
    if (!before && after) entered.push(id);
    else if (before && !after) exited.push(id);
  }
  const enteredSet = entered.length > 0 ? new Set(entered) : null;
  const updated: number[] = [];
  for (const id of residentUpdatedIds) {
    if (nextMembers.has(id) && !enteredSet?.has(id)) updated.push(id);
  }
  for (const id of canonicalUpdated) {
    if (!nextMembers.has(id)) continue;
    if (enteredSet?.has(id)) continue;
    if (residentUpdatedIds.has(id)) continue;
    updated.push(id);
  }
  if (
    !displayTouched
    && entered.length === 0
    && exited.length === 0
    && updated.length === 0
  ) return NO_DISPLAY_CHANGES;
  return { baseToken, reset: false, entered, exited, updated };
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
    case 'display': {
      // Server-authored stage membership patch. Byte-identical replays
      // (reconnect catch-up, replay-ring re-delivery) must be pure no-ops:
      // no map copy, no token turnover, no journal entry.
      let changed = false;
      for (const cell of d.enter_cells) {
        const isMember = c.displayMembers.has(cell.id);
        const retained = c.displayResidents.get(cell.id);
        const identical =
          retained !== undefined && cellContentEquals(retained, cell);
        if (isMember && identical) continue;
        writableDisplay(draft);
        c.displayResidents.set(
          cell.id,
          retained !== undefined && identical ? retained : cell,
        );
        if (isMember) {
          draft.residentUpdatedIds.add(cell.id);
        } else {
          c.displayMembers.add(cell.id);
          draft.touchedDisplayIds.add(cell.id);
        }
        changed = true;
      }
      for (const id of d.enter_ids) {
        if (c.displayMembers.has(id)) continue;
        writableDisplay(draft);
        c.displayMembers.add(id);
        draft.touchedDisplayIds.add(id);
        changed = true;
      }
      for (const id of d.exit_ids) {
        if (!c.displayMembers.has(id) && !c.displayResidents.has(id)) continue;
        writableDisplay(draft);
        if (c.displayMembers.delete(id)) draft.touchedDisplayIds.add(id);
        c.displayResidents.delete(id);
        changed = true;
      }
      if (
        d.provenance !== undefined
        && d.provenance !== null
        && !displayProvenanceEquals(c.displayProvenance, d.provenance)
      ) {
        // Presentation provenance only — the displayToken deliberately does
        // NOT advance (membership/residents unchanged); the new cache object
        // itself is the change signal for provenance consumers.
        c.displayProvenance = d.provenance;
        changed = true;
      }
      return changed;
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
  draft.value.displayChanges = summarizeDisplayChanges(
    prev.displayMembers,
    draft.value.displayMembers,
    draft.touchedDisplayIds,
    draft.residentUpdatedIds,
    draft.value.cellChanges.updated,
    prev.displayToken,
    draft.displayOwned,
  );
  draft.value.stats = nextCellsStats(
    prev.stats,
    prev.cells,
    draft.value.cells,
    draft.touchedCellIds,
    draft.value.totalBirths,
    draft.value.totalDeaths,
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
  draft.value.displayChanges = summarizeDisplayChanges(
    prev.displayMembers,
    draft.value.displayMembers,
    draft.touchedDisplayIds,
    draft.residentUpdatedIds,
    draft.value.cellChanges.updated,
    prev.displayToken,
    draft.displayOwned,
  );
  draft.value.stats = nextCellsStats(
    prev.stats,
    prev.cells,
    draft.value.cells,
    draft.touchedCellIds,
    draft.value.totalBirths,
    draft.value.totalDeaths,
  );
  return draft.value;
}
