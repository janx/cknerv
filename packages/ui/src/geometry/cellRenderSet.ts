import type { Cell } from '@cknerv/types';
import type { CellInspectionField } from '../nerve/cellInspectionField';

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
  const allCells = Array.from(cells.values());
  const count = Math.min(
    allCells.length,
    Math.max(0, Math.floor(visibleCount)),
  );
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
    const prior = entry.value;
    if (
      prior.id !== cell.id
      || (prior.death_at_ms === null) !== (cell.death_at_ms === null)
      || prior.pos_seed[0] !== cell.pos_seed[0]
      || prior.pos_seed[1] !== cell.pos_seed[1]
      || prior.pos_seed[2] !== cell.pos_seed[2]
    ) return false;
  }
  return previousCells.next().done === true;
}
