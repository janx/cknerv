// The galaxy render set: one journal-shaped consumer of the server-authored
// display plane. "Who is on stage" is decided server-side and arrives as
// `snapshot.display` + `display` deltas; this module resolves that
// membership to retained Cell objects (canonical-first over residents) and
// patches its list at O(churn). It holds ZERO composition policy and zero
// source knowledge. The only compatibility fallback is the canonical
// insertion-order prefix used when the server ships no display plane.

import type { Cell } from '@cknerv/types';
import type { CellGalaxyCache } from '@cknerv/cache';
import type { CellInspectionField } from '../nerve/cellInspectionField';

/** One contiguous run of visible Cell slots whose immutable presentation
 * changed. Consumers can upload only these ranges instead of comparing the
 * complete display list after every cache transition. */
export interface CellRenderRange {
  start: number;
  count: number;
}

export interface CellRenderDiff {
  ranges: CellRenderRange[];
  /** True only when visible ids/order changed, not for an in-place Cell value
   * replacement such as death/tag metadata. */
  membershipChanged: boolean;
}

/** Stateful cursor for the display journal. The state is renderer-local and
 * mutates only inside `syncCellRenderSet`; published Cell arrays remain
 * immutable and retain their identity when nothing visible changed. */
export interface CellRenderSetState {
  cells: Cell[];
  indexById: Map<number, number>;
  cellsToken: object | null;
  displayToken: object | null;
  /** True when the list was last resolved from the server display plane
   * (false = canonical-prefix compatibility fallback). */
  displayPlaneActive: boolean;
  /** Resolved presentation clamp last applied (render the first N of the
   * staged list — no policy semantics). */
  displayBudget: number | null;
  topologyVersion: number;
}

export interface CellRenderSetUpdate {
  cells: Cell[];
  ranges: CellRenderRange[];
  membershipChanged: boolean;
  topologyChanged: boolean;
  topologyVersion: number;
  mode: 'unchanged' | 'incremental' | 'rebuild';
}

/** The exact cache surface the render set consumes. */
export type CellRenderCache = Pick<
  CellGalaxyCache,
  | 'cells'
  | 'cellsToken'
  | 'cellChanges'
  | 'displayMembers'
  | 'displayResidents'
  | 'displayBudget'
  | 'displayToken'
  | 'displayChanges'
>;

const EMPTY_RENDER_RANGES: CellRenderRange[] = [];

export function createCellRenderSetState(): CellRenderSetState {
  return {
    cells: [],
    indexById: new Map(),
    cellsToken: null,
    displayToken: null,
    displayPlaneActive: false,
    displayBudget: null,
    topologyVersion: 0,
  };
}

function normalizeCellDisplayBudget(visibleCount: number): number {
  if (Number.isFinite(visibleCount)) {
    return Math.max(0, Math.floor(visibleCount));
  }
  return visibleCount === Number.POSITIVE_INFINITY
    ? Number.POSITIVE_INFINITY
    : 0;
}

/** True while the presentation clamp (the manual display-limit knob) actually
 * bites: the rendered list is a truncated PREFIX of the staged membership.
 * Membership churn cannot be expressed as patches against such a window, so
 * every journal-shaped consumer of the list has to fall back to a full
 * resolve — the render set to its rebuild slice, and the topology journal
 * (whose delta feed describes the FULL membership) to a full pack. AUTO never
 * enters this regime: the server keeps membership within its own budget. */
export function cellRenderClampActive(
  cache: Pick<CellRenderCache, 'displayBudget' | 'displayMembers'>,
  visibleCount: number,
): boolean {
  if (cache.displayBudget === null) return false;
  const displayBudget = normalizeCellDisplayBudget(visibleCount);
  return Number.isFinite(displayBudget)
    && displayBudget < cache.displayMembers.size;
}

function sameCellTopology(before: Cell, after: Cell): boolean {
  return before.id === after.id
    && (before.death_at_ms === null) === (after.death_at_ms === null)
    && before.pos_seed[0] === after.pos_seed[0]
    && before.pos_seed[1] === after.pos_seed[1]
    && before.pos_seed[2] === after.pos_seed[2];
}

function sameCellRenderListTopology(
  previous: readonly Cell[],
  next: readonly Cell[],
): boolean {
  if (previous.length !== next.length) return false;
  for (let index = 0; index < next.length; index += 1) {
    if (!sameCellTopology(previous[index], next[index])) return false;
  }
  return true;
}

function cellRenderIndex(cells: readonly Cell[]): Map<number, number> {
  const indexById = new Map<number, number>();
  for (let index = 0; index < cells.length; index += 1) {
    indexById.set(cells[index].id, index);
  }
  return indexById;
}

function cellRenderRanges(indices: ReadonlySet<number>): CellRenderRange[] {
  if (indices.size === 0) return EMPTY_RENDER_RANGES;
  const sorted = [...indices].sort((a, b) => a - b);
  const ranges: CellRenderRange[] = [];
  let start = sorted[0];
  let previous = start;
  for (let index = 1; index < sorted.length; index += 1) {
    const slot = sorted[index];
    if (slot === previous + 1) {
      previous = slot;
      continue;
    }
    ranges.push({ start, count: previous - start + 1 });
    start = slot;
    previous = slot;
  }
  ranges.push({ start, count: previous - start + 1 });
  return ranges;
}

/** Canonical-first resolution of a staged member id. Post-reorg overlap may
 * keep a resident payload beside a canonical record with the same id — the
 * canonical retained object always wins. */
export function resolveStagedCell(
  cache: Pick<CellGalaxyCache, 'cells' | 'displayResidents'>,
  id: number,
): Cell | undefined {
  return cache.cells.get(id) ?? cache.displayResidents.get(id);
}

export function cellRenderMap(cells: readonly Cell[]): Map<number, Cell> {
  return new Map(cells.map((cell) => [cell.id, cell]));
}

/** Compare two resolved display lists by immutable Cell identity and
 * coalesce adjacent changes into upload-friendly ranges. Full comparison is
 * retained as the canonical fallback for snapshots, skipped journals, and
 * display-budget changes. */
export function diffCellRenderSlots(
  previous: readonly Cell[],
  next: readonly Cell[],
): CellRenderDiff {
  const ranges: CellRenderRange[] = [];
  let rangeStart = -1;
  let membershipChanged = previous.length !== next.length;

  for (let index = 0; index < next.length; index += 1) {
    const before = previous[index];
    const after = next[index];
    if (before?.id !== after.id) membershipChanged = true;
    if (before !== after) {
      if (rangeStart < 0) rangeStart = index;
    } else if (rangeStart >= 0) {
      ranges.push({ start: rangeStart, count: index - rangeStart });
      rangeStart = -1;
    }
  }
  if (rangeStart >= 0) {
    ranges.push({ start: rangeStart, count: next.length - rangeStart });
  }
  return { ranges, membershipChanged };
}

/** Resolve the authoritative display list from scratch: staged members in
 * enter order (canonical-first resolution) under a display plane, or the
 * canonical insertion-order prefix as the no-display-plane fallback. Both
 * honour the presentation clamp by slicing at write time. */
function rebuildCellRenderSet(
  state: CellRenderSetState,
  cache: CellRenderCache,
  displayBudget: number,
): CellRenderSetUpdate {
  const previous = state.cells;
  const displayPlaneActive = cache.displayBudget !== null;
  const resolved: Cell[] = [];
  if (displayPlaneActive) {
    const count = Math.min(cache.displayMembers.size, displayBudget);
    if (count > 0) {
      for (const id of cache.displayMembers) {
        const cell = resolveStagedCell(cache, id);
        if (!cell) continue;
        resolved.push(cell);
        if (resolved.length >= count) break;
      }
    }
  } else {
    const count = Math.min(cache.cells.size, displayBudget);
    if (count > 0) {
      for (const cell of cache.cells.values()) {
        resolved.push(cell);
        if (resolved.length >= count) break;
      }
    }
  }

  const diff = diffCellRenderSlots(previous, resolved);
  const topologyChanged = !sameCellRenderListTopology(previous, resolved);
  const cells = (
    previous.length !== resolved.length || diff.ranges.length > 0
  ) ? resolved : previous;

  state.cells = cells;
  if (diff.membershipChanged) state.indexById = cellRenderIndex(cells);
  state.cellsToken = cache.cellsToken;
  state.displayToken = cache.displayToken;
  state.displayPlaneActive = displayPlaneActive;
  state.displayBudget = displayBudget;
  if (topologyChanged) state.topologyVersion += 1;

  return {
    cells,
    ranges: diff.ranges,
    membershipChanged: diff.membershipChanged,
    topologyChanged,
    topologyVersion: state.topologyVersion,
    mode: 'rebuild',
  };
}

/** Advance one render-set cursor from the reducer's immediately preceding
 * cache value. Under a server display plane the display journal drives the
 * list: `entered` appends, `exited` removes by swap-from-tail (list order
 * has no consumer — the stable-slot layer downstream decouples GPU slots
 * from list order), `updated` patches indexed slots. The rebuild fallback
 * runs ONLY for reset/skipped-journal/token mismatch, a structural input
 * change, or an active presentation clamp. Without a display plane the
 * canonical prefix path applies the cache journal exactly as before. */
export function syncCellRenderSet(
  state: CellRenderSetState,
  cache: CellRenderCache,
  visibleCount: number,
): CellRenderSetUpdate {
  const displayBudget = normalizeCellDisplayBudget(visibleCount);
  const displayPlaneActive = cache.displayBudget !== null;
  const structuralInputsMatch = state.displayBudget === displayBudget
    && state.displayPlaneActive === displayPlaneActive;

  if (
    state.cellsToken === cache.cellsToken
    && state.displayToken === cache.displayToken
    && structuralInputsMatch
  ) {
    return {
      cells: state.cells,
      ranges: EMPTY_RENDER_RANGES,
      membershipChanged: false,
      topologyChanged: false,
      topologyVersion: state.topologyVersion,
      mode: 'unchanged',
    };
  }

  if (!displayPlaneActive) {
    return syncFallbackPrefix(state, cache, displayBudget, structuralInputsMatch);
  }

  // While the presentation clamp bites, this path's slot patches cannot
  // express membership churn against the truncated window — resolve through
  // the rebuild slice instead (see `cellRenderClampActive`).
  const clampActive = cellRenderClampActive(cache, visibleCount);
  const displayChanges = cache.displayChanges;
  const cellChanges = cache.cellChanges;
  const canonicalChainIntact = state.cellsToken === cache.cellsToken
    || (!cellChanges.reset && cellChanges.baseToken === state.cellsToken);
  const displayChainIntact = state.displayToken === cache.displayToken
    || (!displayChanges.reset && displayChanges.baseToken === state.displayToken);
  if (
    !structuralInputsMatch
    || clampActive
    || state.cellsToken === null
    || cellChanges.reset
    || displayChanges.reset
    || !canonicalChainIntact
    || !displayChainIntact
  ) {
    return rebuildCellRenderSet(state, cache, displayBudget);
  }

  const dirtySlots = new Set<number>();
  let cells = state.cells;
  let indexById = state.indexById;
  let cellsOwned = false;
  let indexOwned = false;
  let membershipChanged = false;
  let topologyChanged = false;

  const writableCells = () => {
    if (!cellsOwned) {
      cells = cells.slice();
      cellsOwned = true;
    }
    return cells;
  };
  const writableIndex = () => {
    if (!indexOwned) {
      indexById = new Map(indexById);
      indexOwned = true;
    }
    return indexById;
  };

  // Exits leave the list by swap-from-tail: the moved cell's slot dirties
  // and the freed tail slot disappears from the draw range.
  for (const id of displayChanges.exited) {
    const slot = indexById.get(id);
    if (slot === undefined) continue;
    const list = writableCells();
    const index = writableIndex();
    index.delete(id);
    const last = list.length - 1;
    if (slot !== last) {
      const moved = list[last];
      list[slot] = moved;
      index.set(moved.id, slot);
      dirtySlots.add(slot);
    }
    list.pop();
    membershipChanged = true;
    topologyChanged = true;
  }

  // Payload replacements of on-stage cells (death/tag of a member, resident
  // refresh) patch their indexed slot in place.
  for (const id of displayChanges.updated) {
    const slot = indexById.get(id);
    if (slot === undefined) continue;
    const after = resolveStagedCell(cache, id);
    if (!after) {
      return rebuildCellRenderSet(state, cache, displayBudget);
    }
    const before = cells[slot];
    if (before === after) continue;
    writableCells()[slot] = after;
    dirtySlots.add(slot);
    if (!sameCellTopology(before, after)) topologyChanged = true;
  }

  for (const id of displayChanges.entered) {
    if (indexById.has(id)) continue;
    const cell = resolveStagedCell(cache, id);
    if (!cell) {
      // An enter referencing an unknown record violates the same-stream
      // ordering contract; recover through one canonical rebuild.
      return rebuildCellRenderSet(state, cache, displayBudget);
    }
    const slot = cells.length;
    writableCells().push(cell);
    writableIndex().set(id, slot);
    dirtySlots.add(slot);
    membershipChanged = true;
    topologyChanged = true;
  }

  state.cells = cells;
  state.indexById = indexById;
  state.cellsToken = cache.cellsToken;
  state.displayToken = cache.displayToken;
  if (topologyChanged) state.topologyVersion += 1;

  return {
    cells,
    ranges: cellRenderRanges(dirtySlots),
    membershipChanged,
    topologyChanged,
    topologyVersion: state.topologyVersion,
    mode: 'incremental',
  };
}

/** No-display-plane compatibility fallback: the canonical insertion-order
 * prefix of the display budget, journal-driven via `cellChanges` exactly as
 * the historical no-composition path. Selection/inspection visibility is the
 * overlay pool's job in both regimes, so this path carries no pinning. */
function syncFallbackPrefix(
  state: CellRenderSetState,
  cache: CellRenderCache,
  displayBudget: number,
  structuralInputsMatch: boolean,
): CellRenderSetUpdate {
  const changes = cache.cellChanges;
  if (
    !structuralInputsMatch
    || state.cellsToken === null
    || changes.reset
    || changes.orderInvalidated
    || changes.baseToken !== state.cellsToken
  ) {
    return rebuildCellRenderSet(state, cache, displayBudget);
  }

  const targetCount = Math.min(cache.cells.size, displayBudget);
  const dirtySlots = new Set<number>();
  let cells = state.cells;
  let indexById = state.indexById;
  let cellsOwned = false;
  let indexOwned = false;
  let membershipChanged = false;
  let topologyChanged = false;

  const writableCells = () => {
    if (!cellsOwned) {
      cells = cells.slice();
      cellsOwned = true;
    }
    return cells;
  };
  const writableIndex = () => {
    if (!indexOwned) {
      indexById = new Map(indexById);
      indexOwned = true;
    }
    return indexById;
  };

  for (const id of changes.updated) {
    const slot = indexById.get(id);
    if (slot === undefined) continue;
    const after = cache.cells.get(id);
    if (!after) {
      return rebuildCellRenderSet(state, cache, displayBudget);
    }
    const before = cells[slot];
    if (before === after) continue;
    writableCells()[slot] = after;
    dirtySlots.add(slot);
    if (!sameCellTopology(before, after)) topologyChanged = true;
  }

  if (cells.length < targetCount) {
    for (const id of changes.born) {
      if (cells.length >= targetCount) break;
      if (indexById.has(id)) continue;
      const cell = cache.cells.get(id);
      if (!cell) continue;
      const slot = cells.length;
      writableCells().push(cell);
      writableIndex().set(id, slot);
      dirtySlots.add(slot);
      membershipChanged = true;
      topologyChanged = true;
    }
  }

  // A missing slot means the journal cannot explain the authoritative prefix
  // (for example, a skipped external-store state).
  if (cells.length !== targetCount) {
    return rebuildCellRenderSet(state, cache, displayBudget);
  }

  state.cells = cells;
  state.indexById = indexById;
  state.cellsToken = cache.cellsToken;
  state.displayToken = cache.displayToken;
  if (topologyChanged) state.topologyVersion += 1;

  return {
    cells,
    ranges: cellRenderRanges(dirtySlots),
    membershipChanged,
    topologyChanged,
    topologyVersion: state.topologyVersion,
    mode: 'incremental',
  };
}

// ── inspection-field overlay pool (design D4) ───────────────────────────
// The only client-side "membership intervention" left is an interaction
// transient: the selected cell and its inspection-field members may sit
// off-stage. They render as overlay entries APPENDED after the staged list —
// client-transient, never entering the shared display membership, never
// entering the passive display graph. Buffer allocations reserve
// `OVERLAY_SLOT_POOL` slots past the display budget for them.

export const OVERLAY_SLOT_POOL = 256;

const EMPTY_OVERLAY: Cell[] = [];

/** Resolve the bounded overlay list for a selection. Entries are the
 * selected cell first, then inspection-field members in ascending hop
 * order, each resolved canonical-first and skipped when already staged. */
export function cellRenderOverlay(
  cache: Pick<CellGalaxyCache, 'cells' | 'displayResidents'>,
  stagedIndex: ReadonlyMap<number, number>,
  selectedCellId: number | null,
  field: CellInspectionField | null,
  pool = OVERLAY_SLOT_POOL,
): Cell[] {
  if (selectedCellId === null || pool <= 0) return EMPTY_OVERLAY;
  const overlay: Cell[] = [];
  const seen = new Set<number>();
  const admit = (id: number): boolean => {
    if (overlay.length >= pool) return false;
    if (seen.has(id) || stagedIndex.has(id)) return true;
    const cell = resolveStagedCell(cache, id);
    if (!cell) return true;
    seen.add(id);
    overlay.push(cell);
    return true;
  };
  admit(selectedCellId);
  if (field?.selectedCellId === selectedCellId) {
    const fieldMembers: Array<[number, number]> = [];
    for (const [id, hop] of field.hopsByCellId) {
      if (!Number.isFinite(hop) || hop <= 0 || hop > field.maxHops) continue;
      fieldMembers.push([id, hop]);
    }
    fieldMembers.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (const [id] of fieldMembers) {
      if (!admit(id)) break;
    }
  }
  return overlay.length === 0 ? EMPTY_OVERLAY : overlay;
}
