import type { Cell } from '@cknerv/types';
import type { CellGalaxyCache } from '@cknerv/cache';
import type { CellInspectionField } from '../nerve/cellInspectionField';

/** One contiguous run of visible Cell slots whose immutable presentation
 * changed. Consumers can upload only these ranges instead of comparing the
 * complete display prefix after every cache transition. */
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

/** Stateful cursor for the reducer journal. The state is renderer-local and
 * mutates only inside `syncCellRenderSet`; published Cell arrays remain
 * immutable and retain their identity when a change lands outside the visible
 * prefix. */
export interface CellRenderSetState {
  cells: Cell[];
  indexById: Map<number, number>;
  cellsToken: object | null;
  displayBudget: number | null;
  selectedCellId: number | null;
  inspectionField: CellInspectionField | null;
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

const EMPTY_RENDER_RANGES: CellRenderRange[] = [];

export function createCellRenderSetState(): CellRenderSetState {
  return {
    cells: [],
    indexById: new Map(),
    cellsToken: null,
    displayBudget: null,
    selectedCellId: null,
    inspectionField: null,
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

/**
 * Preserve cache order while moving the bounded semantic neighbourhood into
 * the visible prefix. CellGalaxy and NeuralNetwork both consume this exact
 * permutation so a passive fibre never terminates at a quality-hidden Cell.
 */
export function pinCellInspectionFieldInVisiblePrefix(
  cells: Cell[],
  visibleCount: number,
  selectedCellId: number | null,
  field: CellInspectionField | null,
): Cell[] {
  const count = Math.min(
    cells.length,
    Math.max(0, Math.floor(visibleCount)),
  );
  if (
    selectedCellId === null
    || count === 0
    || count >= cells.length
  ) return cells;

  const selectedIndex = cells.findIndex(
    (cell) => cell.id === selectedCellId,
  );
  if (selectedIndex < 0) return cells;

  const priorityIds = [selectedCellId];
  if (field?.selectedCellId === selectedCellId) {
    const fieldMembers: Array<{ id: number; hop: number; order: number }> = [];
    for (let order = 0; order < cells.length; order += 1) {
      const cell = cells[order];
      const hop = field.hopsByCellId.get(cell.id);
      if (
        hop === undefined
        || !Number.isFinite(hop)
        || hop <= 0
        || hop > field.maxHops
      ) continue;
      fieldMembers.push({ id: cell.id, hop, order });
    }
    fieldMembers.sort((a, b) => a.hop - b.hop || a.order - b.order);
    for (const member of fieldMembers) priorityIds.push(member.id);
  }

  const pinnedIds = priorityIds.slice(0, count);
  const pinnedSet = new Set(pinnedIds);
  const visibleIds = new Set(
    cells.slice(0, count).map((cell) => cell.id),
  );
  const missingIds = pinnedIds.filter((id) => !visibleIds.has(id));
  if (missingIds.length === 0) return cells;

  const replacementSlots: number[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    if (!pinnedSet.has(cells[i].id)) replacementSlots.push(i);
  }

  const pinned = cells.slice();
  const indexById = new Map<number, number>();
  for (let i = 0; i < pinned.length; i += 1) {
    indexById.set(pinned[i].id, i);
  }

  for (let i = 0; i < missingIds.length; i += 1) {
    const sourceIndex = indexById.get(missingIds[i]);
    const targetIndex = replacementSlots[i];
    if (sourceIndex === undefined || targetIndex === undefined) break;
    const displacedId = pinned[targetIndex].id;
    const insertedId = pinned[sourceIndex].id;
    [pinned[targetIndex], pinned[sourceIndex]] = [
      pinned[sourceIndex],
      pinned[targetIndex],
    ];
    indexById.set(insertedId, targetIndex);
    indexById.set(displacedId, sourceIndex);
  }

  return pinned;
}

export function pinSelectedCellInVisiblePrefix(
  cells: Cell[],
  visibleCount: number,
  selectedCellId: number | null,
): Cell[] {
  return pinCellInspectionFieldInVisiblePrefix(
    cells,
    visibleCount,
    selectedCellId,
    null,
  );
}

/** Build the one authoritative display subset shared by Cells and fibres. */
export function cellRenderList(
  cells: ReadonlyMap<number, Cell>,
  visibleCount: number,
  selectedCellId: number | null,
  field: CellInspectionField | null,
): Cell[] {
  const requestedCount = normalizeCellDisplayBudget(visibleCount);
  const count = Math.min(
    cells.size,
    requestedCount,
  );
  if (count === 0) return [];

  // The resting field and a selection without an active topology field need
  // only the visible prefix. Stop at the display budget instead of
  // materialising every retained Cell during backfill or a live delta.
  if (field?.selectedCellId !== selectedCellId) {
    const visible: Cell[] = [];
    for (const cell of cells.values()) {
      visible.push(cell);
      if (visible.length === count) break;
    }
    if (selectedCellId === null) return visible;
    const selected = cells.get(selectedCellId);
    if (!selected || visible.some((cell) => cell.id === selectedCellId)) {
      return visible;
    }
    visible[count - 1] = selected;
    return visible;
  }

  const allCells = Array.from(cells.values());
  return pinCellInspectionFieldInVisiblePrefix(
    allCells,
    count,
    selectedCellId,
    field,
  ).slice(0, count);
}

export function cellRenderMap(cells: readonly Cell[]): Map<number, Cell> {
  return new Map(cells.map((cell) => [cell.id, cell]));
}

/** Compare two resolved display prefixes by immutable Cell identity and
 * coalesce adjacent changes into upload-friendly ranges. Full comparison is
 * retained as the canonical fallback for snapshots, skipped journals, GC,
 * display-budget changes, and semantic pinning changes. */
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

function rebuildCellRenderSet(
  state: CellRenderSetState,
  cache: Pick<CellGalaxyCache, 'cells' | 'cellsToken'>,
  displayBudget: number,
  selectedCellId: number | null,
  inspectionField: CellInspectionField | null,
): CellRenderSetUpdate {
  const previous = state.cells;
  const resolved = cellRenderList(
    cache.cells,
    displayBudget,
    selectedCellId,
    inspectionField,
  );
  const diff = diffCellRenderSlots(previous, resolved);
  const topologyChanged = !sameCellRenderListTopology(previous, resolved);
  const cells = (
    previous.length !== resolved.length || diff.ranges.length > 0
  ) ? resolved : previous;

  state.cells = cells;
  if (diff.membershipChanged) state.indexById = cellRenderIndex(cells);
  state.cellsToken = cache.cellsToken;
  state.displayBudget = displayBudget;
  state.selectedCellId = selectedCellId;
  state.inspectionField = inspectionField;
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

/** Advance one visible-prefix cursor from the reducer's immediately preceding
 * Cell Map. Births append while capacity remains, hidden births are ignored,
 * and retained metadata/lifecycle replacements patch only their indexed
 * slots. Any ambiguous ordering/input transition uses `cellRenderList` once,
 * preserving the canonical insertion-order and semantic-pinning contract. */
export function syncCellRenderSet(
  state: CellRenderSetState,
  cache: Pick<
    CellGalaxyCache,
    'cells' | 'cellsToken' | 'cellChanges'
  >,
  visibleCount: number,
  selectedCellId: number | null,
  inspectionField: CellInspectionField | null,
): CellRenderSetUpdate {
  const displayBudget = normalizeCellDisplayBudget(visibleCount);
  const structuralInputsMatch = state.displayBudget === displayBudget
    && state.selectedCellId === selectedCellId
    && state.inspectionField === inspectionField;

  if (state.cellsToken === cache.cellsToken && structuralInputsMatch) {
    return {
      cells: state.cells,
      ranges: EMPTY_RENDER_RANGES,
      membershipChanged: false,
      topologyChanged: false,
      topologyVersion: state.topologyVersion,
      mode: 'unchanged',
    };
  }

  const changes = cache.cellChanges;
  if (
    !structuralInputsMatch
    || state.cellsToken === null
    || changes.reset
    || changes.orderInvalidated
    || changes.baseToken !== state.cellsToken
  ) {
    return rebuildCellRenderSet(
      state,
      cache,
      displayBudget,
      selectedCellId,
      inspectionField,
    );
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
      return rebuildCellRenderSet(
        state,
        cache,
        displayBudget,
        selectedCellId,
        inspectionField,
      );
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
  // (for example, a skipped external-store state). A newly materialized
  // selected Cell also has to be pinned canonically rather than appended past
  // a full display budget.
  if (
    cells.length !== targetCount
    || (
      targetCount > 0
      && selectedCellId !== null
      && cache.cells.has(selectedCellId)
      && !indexById.has(selectedCellId)
    )
  ) {
    return rebuildCellRenderSet(
      state,
      cache,
      displayBudget,
      selectedCellId,
      inspectionField,
    );
  }

  state.cells = cells;
  state.indexById = indexById;
  state.cellsToken = cache.cellsToken;
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

/** Whether a newly resolved display list would produce the same neighbour
 *  topology as the previous one. Tags and other payload fields deliberately
 *  do not participate: graph construction depends only on ordered membership,
 *  live/dead status, and position. */
export function sameCellRenderTopology(
  previous: ReadonlyMap<number, Cell>,
  next: readonly Cell[],
): boolean {
  if (previous.size !== next.length) return false;
  const previousCells = previous.values();
  for (const cell of next) {
    const entry = previousCells.next();
    if (entry.done) return false;
    if (!sameCellTopology(entry.value, cell)) return false;
  }
  return previousCells.next().done === true;
}
