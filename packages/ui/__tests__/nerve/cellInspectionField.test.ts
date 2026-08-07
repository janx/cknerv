import { describe, expect, it } from 'vitest';
import type { NeighborGraph } from '../../src/geometry/neighborGraph';
import {
  CELL_INSPECTION_BACKGROUND_ENERGY,
  CELL_INSPECTION_BODY_TRANSITION_SECONDS,
  CELL_INSPECTION_HOP_ENERGY,
  CELL_INSPECTION_NAVIGATION_MAX_HOP,
  cellInspectionDirectNavigationRole,
  cellInspectionBodyTransitionBlend,
  cellInspectionEdgeScaleAt,
  cellInspectionFieldScale,
  cellInspectionFieldTransitionScaleAt,
  cellInspectionNavigationTarget,
  dampCellInspectionFieldScale,
  deriveCellInspectionField,
} from '../../src/nerve/cellInspectionField';

function graph(edges: [number, number][]): NeighborGraph {
  const adjacency = new Map<number, Set<number>>();
  for (const [from, to] of edges) {
    const fromSet = adjacency.get(from) ?? new Set<number>();
    const toSet = adjacency.get(to) ?? new Set<number>();
    fromSet.add(to);
    toSet.add(from);
    adjacency.set(from, fromSet);
    adjacency.set(to, toSet);
  }
  return {
    adjacency,
    edges: edges.map(([from, to]) => ({ from, to, d: 1 })),
  };
}

describe('Cell inspection information field', () => {
  it('keeps only two real adjacency rings around the selected Cell', () => {
    const field = deriveCellInspectionField(
      graph([[1, 2], [2, 3], [3, 4], [2, 5]]),
      1,
    );

    expect([...field!.hopsByCellId]).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
      [5, 2],
    ]);
    expect(field!.hopsByCellId.has(4)).toBe(false);
  });

  it('does not invent neighbours for an isolated or retired selection', () => {
    const field = deriveCellInspectionField(graph([[2, 3]]), 9);

    expect([...field!.hopsByCellId]).toEqual([[9, 0]]);
    expect(cellInspectionFieldScale(field, 9)).toBe(1);
    expect(cellInspectionFieldScale(field, 2))
      .toBe(CELL_INSPECTION_BACKGROUND_ENERGY);
  });

  it('assigns distinct selected, direct, contextual, and background energy', () => {
    const field = deriveCellInspectionField(
      graph([[1, 2], [2, 3], [3, 4]]),
      1,
    );

    expect(cellInspectionFieldScale(field, 1))
      .toBe(CELL_INSPECTION_HOP_ENERGY[0]);
    expect(cellInspectionFieldScale(field, 2))
      .toBe(CELL_INSPECTION_HOP_ENERGY[1]);
    expect(cellInspectionFieldScale(field, 3))
      .toBe(CELL_INSPECTION_HOP_ENERGY[2]);
    expect(cellInspectionFieldScale(field, 4))
      .toBe(CELL_INSPECTION_BACKGROUND_ENERGY);
    expect(cellInspectionFieldScale(null, 4)).toBe(1);
  });

  it('keeps the wider ledger field readable during inspection', () => {
    expect(CELL_INSPECTION_HOP_ENERGY).toEqual([1, 0.9, 0.72]);
    expect(CELL_INSPECTION_BACKGROUND_ENERGY).toBe(0.46);
    expect(CELL_INSPECTION_BACKGROUND_ENERGY).toBeGreaterThanOrEqual(0.4);
  });

  it('limits topology navigation to the root and real direct neighbours', () => {
    const field = deriveCellInspectionField(
      graph([[1, 2], [2, 3], [3, 4]]),
      1,
    );

    expect(CELL_INSPECTION_NAVIGATION_MAX_HOP).toBe(1);
    expect(cellInspectionNavigationTarget(field, 1)).toBe(true);
    expect(cellInspectionNavigationTarget(field, 2)).toBe(true);
    expect(cellInspectionNavigationTarget(field, 3)).toBe(false);
    expect(cellInspectionNavigationTarget(field, 4)).toBe(false);
    expect(cellInspectionNavigationTarget(null, 4)).toBe(true);
  });

  it('marks only direct neighbours with the shader navigation role', () => {
    const field = deriveCellInspectionField(
      graph([[1, 2], [2, 3]]),
      1,
    );

    expect(cellInspectionDirectNavigationRole(field, 1)).toBe(0);
    expect(cellInspectionDirectNavigationRole(field, 2)).toBe(1);
    expect(cellInspectionDirectNavigationRole(field, 3)).toBe(0);
    expect(cellInspectionDirectNavigationRole(null, 2)).toBe(0);
  });

  it('grades a retained fibre between its endpoint hop energies', () => {
    const field = deriveCellInspectionField(graph([[1, 2], [2, 3]]), 1);

    expect(cellInspectionEdgeScaleAt(field, 1, 2, 0)).toBe(1);
    expect(cellInspectionEdgeScaleAt(field, 1, 2, 1))
      .toBe(CELL_INSPECTION_HOP_ENERGY[1]);
    expect(cellInspectionEdgeScaleAt(field, 1, 2, 0.5))
      .toBeCloseTo((1 + CELL_INSPECTION_HOP_ENERGY[1]) / 2);
    expect(cellInspectionEdgeScaleAt(null, 1, 2, 0.5)).toBe(1);
  });

  it('cross-fades topology energy while retaining the same real edge', () => {
    const first = deriveCellInspectionField(graph([[1, 2], [2, 3]]), 1);
    const second = deriveCellInspectionField(graph([[1, 2], [2, 3]]), 3);
    const from = cellInspectionEdgeScaleAt(first, 1, 2, 0.25);
    const to = cellInspectionEdgeScaleAt(second, 1, 2, 0.25);

    expect(cellInspectionFieldTransitionScaleAt(
      first,
      second,
      0,
      1,
      2,
      0.25,
    )).toBe(from);
    expect(cellInspectionFieldTransitionScaleAt(
      first,
      second,
      0.5,
      1,
      2,
      0.25,
    )).toBeCloseTo((from + to) / 2);
    expect(cellInspectionFieldTransitionScaleAt(
      first,
      second,
      1,
      1,
      2,
      0.25,
    )).toBe(to);
  });

  it('eases toward the field without overshoot and releases to baseline', () => {
    const entering = dampCellInspectionFieldScale(
      1,
      CELL_INSPECTION_BACKGROUND_ENERGY,
      1 / 60,
    );
    const releasing = dampCellInspectionFieldScale(
      CELL_INSPECTION_BACKGROUND_ENERGY,
      1,
      1 / 60,
    );

    expect(entering).toBeGreaterThan(CELL_INSPECTION_BACKGROUND_ENERGY);
    expect(entering).toBeLessThan(1);
    expect(releasing).toBeGreaterThan(CELL_INSPECTION_BACKGROUND_ENERGY);
    expect(releasing).toBeLessThanOrEqual(1);
    expect(dampCellInspectionFieldScale(
      CELL_INSPECTION_BACKGROUND_ENERGY,
      1,
      0,
    )).toBe(CELL_INSPECTION_BACKGROUND_ENERGY);
  });

  it('matches repeated body damping with one closed-form GPU blend', () => {
    const stepSeconds = 1 / 60;
    const steps = 12;
    let repeated = 1;
    for (let index = 0; index < steps; index += 1) {
      repeated = dampCellInspectionFieldScale(
        repeated,
        CELL_INSPECTION_BACKGROUND_ENERGY,
        stepSeconds,
      );
    }
    const blend = cellInspectionBodyTransitionBlend(stepSeconds * steps);
    const closedForm = 1 + (
      CELL_INSPECTION_BACKGROUND_ENERGY - 1
    ) * blend;

    expect(closedForm).toBeCloseTo(repeated, 6);
    expect(cellInspectionBodyTransitionBlend(0)).toBe(0);
    expect(cellInspectionBodyTransitionBlend(
      CELL_INSPECTION_BODY_TRANSITION_SECONDS,
    )).toBe(1);
  });

  it('rejects invalid selections instead of creating synthetic field roots', () => {
    const g = graph([[1, 2]]);

    expect(deriveCellInspectionField(g, null)).toBeNull();
    expect(deriveCellInspectionField(g, -1)).toBeNull();
    expect(deriveCellInspectionField(g, Number.NaN)).toBeNull();
  });
});
