import { describe, expect, it } from 'vitest';
import type { Cell, CellLink } from '@cknerv/types';
import { deriveCellCausalLens } from '../../src/derives/cellCausalLens.derive';
import {
  cellCausalArcPoint,
  deriveCellCausalLensLayout,
  sampleCellCausalArc,
} from '../../src/geometry/cellCausalLens';

const hash = (pair: string): string => `0x${pair.repeat(32)}`;

function cell(id: number, pos: [number, number, number]): Cell {
  return {
    id,
    born_at_ms: id,
    death_at_ms: null,
    birth_block: 90,
    tag: null,
    pos_seed: pos,
    out_point: { tx_hash: hash('ab'), index: id },
    capacity: 6_100_000_000,
    data_hex: '0x',
    content_hash: hash('cd'),
  };
}

const selected = cell(9, [2, 0, -3]);
const causalLink: CellLink = {
  seq: 4,
  tx_hash: selected.out_point.tx_hash,
  block: selected.birth_block,
  from_ids: [1, 2, 3],
  to_ids: [7, 8, 9, 10],
  parents: [],
  tag: null,
  at_ms: 100,
};

const records = new Map<number, Cell>([
  [1, cell(1, [-8, 0, 2])],
  [2, cell(2, [-5, 1, -6])],
  [3, cell(3, [-2, -1, 7])],
  [7, cell(7, [9, 0, 4])],
  [8, cell(8, [7, 1, -8])],
  [9, selected],
  [10, cell(10, [12, -1, -2])],
]);

describe('deriveCellCausalLensLayout', () => {
  it('routes retained inputs into a raised tx hub and the hub into outputs', () => {
    const lens = deriveCellCausalLens(selected, [causalLink], records);
    const layout = deriveCellCausalLensLayout(lens);

    expect(layout.hub).toEqual([2, 4.6, -3]);
    expect(layout.arcs.filter((arc) => arc.role === 'input')).toHaveLength(3);
    expect(layout.arcs.filter((arc) => arc.role.endsWith('output')))
      .toHaveLength(4);
    expect(layout.arcs.find((arc) => arc.role === 'selected-output')?.to)
      .toEqual(selected.pos_seed);
    expect(layout.arcs.map((arc) => [
      arc.role,
      arc.endpointId,
      arc.navigationTargetId,
      arc.laneIndex,
      arc.laneCount,
    ])).toEqual([
      ['input', 1, 1, 0, 3],
      ['input', 2, 2, 1, 3],
      ['input', 3, 3, 2, 3],
      ['sibling-output', 7, 7, 0, 4],
      ['sibling-output', 8, 8, 1, 4],
      ['selected-output', 9, null, 2, 4],
      ['sibling-output', 10, 10, 3, 4],
    ]);
    expect(layout.arcs.every((arc) => (
      arc.role === 'input'
        ? arc.to.every((value, index) => value === layout.hub[index])
        : arc.from.every((value, index) => value === layout.hub[index])
    ))).toBe(true);
  });

  it('keeps every carrier in its radial plane and layers transaction order', () => {
    const lens = deriveCellCausalLens(selected, [causalLink], records);
    const layout = deriveCellCausalLensLayout(lens);

    for (const arc of layout.arcs) {
      const endpoint = arc.role === 'input' ? arc.from : arc.to;
      const endpointX = endpoint[0] - layout.hub[0];
      const endpointZ = endpoint[2] - layout.hub[2];
      const controlX = arc.control[0] - layout.hub[0];
      const controlZ = arc.control[2] - layout.hub[2];
      expect(endpointX * controlZ - endpointZ * controlX).toBeCloseTo(0, 8);
    }

    const inputs = layout.arcs.filter((arc) => arc.role === 'input');
    const siblings = layout.arcs.filter(
      (arc) => arc.role === 'sibling-output',
    );
    const shoulderLift = (arc: (typeof layout.arcs)[number]) => (
      arc.control[1] - Math.max(arc.from[1], arc.to[1])
    );
    const inputShoulders = inputs.map(shoulderLift);
    const siblingShoulders = siblings.map(shoulderLift);
    expect(inputShoulders).toEqual(
      [...inputShoulders].sort((a, b) => a - b),
    );
    expect(siblingShoulders).toEqual(
      [...siblingShoulders].sort((a, b) => a - b),
    );
    expect(Math.min(...inputShoulders)).toBeGreaterThan(
      Math.max(...siblingShoulders),
    );
    expect(siblings.map((arc) => arc.laneIndex)).toEqual([0, 1, 3]);
  });

  it('always keeps the selected output while applying presentation caps', () => {
    const lens = deriveCellCausalLens(selected, [causalLink], records);
    const layout = deriveCellCausalLensLayout(lens, {
      maxInputs: 1,
      maxSiblings: 1,
    });

    expect(layout.arcs.map((arc) => arc.key)).toEqual([
      'input:1',
      'output:7',
      'output:9',
    ]);
    expect(layout.hiddenInputCount).toBe(2);
    expect(layout.hiddenSiblingCount).toBe(2);
  });

  it('never invents geometry for missing endpoint records', () => {
    const partial = deriveCellCausalLens(
      selected,
      [causalLink],
      new Map([[1, records.get(1)!], [9, selected]]),
    );
    const layout = deriveCellCausalLensLayout(partial);

    expect(partial.status).toBe('partial');
    expect(layout.arcs.map((arc) => arc.key)).toEqual([
      'input:1',
      'output:9',
    ]);
  });

  it('renders only the tx → selected identity tether without retained history', () => {
    const unavailable = deriveCellCausalLens(selected, [], records);
    expect(deriveCellCausalLensLayout(unavailable).arcs.map((arc) => ({
      key: arc.key,
      role: arc.role,
      navigationTargetId: arc.navigationTargetId,
    }))).toEqual([{
      key: 'output:9',
      role: 'selected-output',
      navigationTargetId: null,
    }]);
  });
});

describe('cell causal arc sampling', () => {
  it('preserves exact endpoints while expanding a quadratic arc into segments', () => {
    const lens = deriveCellCausalLens(selected, [causalLink], records);
    const arc = deriveCellCausalLensLayout(lens).arcs[0];
    const positions = sampleCellCausalArc(arc, 5);

    expect(positions).toHaveLength(5 * 6);
    expect(positions.slice(0, 3)).toEqual(arc.from);
    expect(positions.slice(-3)).toEqual(arc.to);
    expect(cellCausalArcPoint(arc, -1)).toEqual(arc.from);
    expect(cellCausalArcPoint(arc, 2)).toEqual(arc.to);
  });
});
