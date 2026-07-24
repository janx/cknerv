import type { NeighborGraph } from '../geometry/neighborGraph';

/** Two real adjacency rings are enough to describe a Cell's maintained
 * neighbourhood without turning inspection into another whole-graph view. */
export const CELL_INSPECTION_MAX_HOPS = 2;

/** Resting energy by graph distance from the inspected Cell.
 *
 * The selected record remains authoritative, its direct visual neighbours stay
 * clearly legible, the second ring supplies context, and every unrelated Cell
 * retains a quiet floor so inspection never pretends the rest of the ledger
 * disappeared. These hops describe the renderer's spatial fabric, not a new
 * on-chain relationship.
 */
export const CELL_INSPECTION_HOP_ENERGY = [1, 0.82, 0.42] as const;
export const CELL_INSPECTION_BACKGROUND_ENERGY = 0.12;

export interface CellInspectionField {
  readonly selectedCellId: number;
  readonly maxHops: number;
  /** Cell id → shortest real neighbour-graph distance from the selection. */
  readonly hopsByCellId: ReadonlyMap<number, number>;
}

/**
 * Build a bounded breadth-first field from the renderer's authoritative
 * neighbour graph. Only existing adjacency is traversed; an isolated or
 * already-spent selected Cell therefore gets a centre but no invented links.
 */
export function deriveCellInspectionField(
  graph: NeighborGraph,
  selectedCellId: number | null,
  maxHops = CELL_INSPECTION_MAX_HOPS,
): CellInspectionField | null {
  if (
    selectedCellId === null
    || !Number.isSafeInteger(selectedCellId)
    || selectedCellId < 0
  ) return null;

  const boundedMaxHops = Number.isFinite(maxHops)
    ? Math.max(0, Math.floor(maxHops))
    : CELL_INSPECTION_MAX_HOPS;
  const hopsByCellId = new Map<number, number>([[selectedCellId, 0]]);
  const queue: number[] = [selectedCellId];
  let cursor = 0;

  while (cursor < queue.length) {
    const cellId = queue[cursor];
    cursor += 1;
    const hop = hopsByCellId.get(cellId) ?? 0;
    if (hop >= boundedMaxHops) continue;
    const neighbours = graph.adjacency.get(cellId);
    if (!neighbours) continue;
    for (const neighbourId of neighbours) {
      if (hopsByCellId.has(neighbourId)) continue;
      hopsByCellId.set(neighbourId, hop + 1);
      queue.push(neighbourId);
    }
  }

  return {
    selectedCellId,
    maxHops: boundedMaxHops,
    hopsByCellId,
  };
}

/** Static Cell-body energy for one member of an inspection field. */
export function cellInspectionFieldScale(
  field: CellInspectionField | null,
  cellId: number,
): number {
  if (!field) return 1;
  const hop = field.hopsByCellId.get(cellId);
  if (hop === undefined) return CELL_INSPECTION_BACKGROUND_ENERGY;
  return CELL_INSPECTION_HOP_ENERGY[
    Math.min(hop, CELL_INSPECTION_HOP_ENERGY.length - 1)
  ];
}

/**
 * Energy at one point of a real graph edge. Interpolating the endpoint hop
 * energies makes the selected junction visibly feed its quieter context
 * instead of painting every retained fibre at one arbitrary edge-wide value.
 */
export function cellInspectionEdgeScaleAt(
  field: CellInspectionField | null,
  fromCellId: number,
  toCellId: number,
  edgeT: number,
): number {
  if (!field) return 1;
  const t = Number.isFinite(edgeT)
    ? Math.max(0, Math.min(1, edgeT))
    : 0.5;
  const from = cellInspectionFieldScale(field, fromCellId);
  const to = cellInspectionFieldScale(field, toCellId);
  return from + (to - from) * t;
}

/** Cross-fade two topology fields without ever introducing an intermediate
 * graph. Only their energy readings blend; every visible fibre is still one
 * edge from the authoritative neighbour graph. */
export function cellInspectionFieldTransitionScaleAt(
  fromField: CellInspectionField | null,
  toField: CellInspectionField | null,
  progress: number,
  fromCellId: number,
  toCellId: number,
  edgeT: number,
): number {
  const t = Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress))
    : 1;
  const eased = t * t * (3 - 2 * t);
  const from = cellInspectionEdgeScaleAt(
    fromField,
    fromCellId,
    toCellId,
    edgeT,
  );
  const to = cellInspectionEdgeScaleAt(
    toField,
    fromCellId,
    toCellId,
    edgeT,
  );
  return from + (to - from) * eased;
}

/** Frame-rate independent approach used by the shared Cell-body attribute. */
export function dampCellInspectionFieldScale(
  current: number,
  target: number,
  deltaSeconds: number,
): number {
  const safeCurrent = Number.isFinite(current) ? current : 1;
  const safeTarget = Number.isFinite(target)
    ? Math.max(0, Math.min(1, target))
    : 1;
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return safeCurrent;
  const next = safeCurrent
    + (safeTarget - safeCurrent) * (1 - Math.exp(-deltaSeconds * 9));
  return Math.abs(next - safeTarget) < 0.002 ? safeTarget : next;
}
