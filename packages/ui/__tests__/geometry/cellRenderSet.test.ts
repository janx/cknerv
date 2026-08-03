import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  cellRenderList,
  cellRenderMap,
  sameCellRenderTopology,
} from '../../src/geometry/cellRenderSet';
import type { CellInspectionField } from '../../src/nerve/cellInspectionField';

function cell(id: number): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [id, 0, 0],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 0,
    data_hex: '0x',
    content_hash: `0x${'00'.repeat(32)}`,
  };
}

describe('cellRenderList', () => {
  const cells = new Map(
    Array.from({ length: 10 }, (_, id) => [id, cell(id)] as const),
  );

  it('uses the bounded cache prefix when no semantic Cell is selected', () => {
    expect(cellRenderList(cells, 4, null, null).map(({ id }) => id))
      .toEqual([0, 1, 2, 3]);
    expect(cellRenderList(cells, Number.NaN, null, null)).toEqual([]);
  });

  it('stops iterating once the resting display budget is filled', () => {
    let visited = 0;
    const instrumented = new Map(cells);
    const values = instrumented.values.bind(instrumented);
    instrumented.values = function* instrumentedValues() {
      for (const value of values()) {
        visited += 1;
        yield value;
      }
    } as typeof instrumented.values;

    expect(cellRenderList(instrumented, 4, null, null).map(({ id }) => id))
      .toEqual([0, 1, 2, 3]);
    expect(visited).toBe(4);
  });

  it('pins a selected Cell without scanning the hidden tail when no field is active', () => {
    let visited = 0;
    const instrumented = new Map(cells);
    const values = instrumented.values.bind(instrumented);
    instrumented.values = function* instrumentedValues() {
      for (const value of values()) {
        visited += 1;
        yield value;
      }
    } as typeof instrumented.values;

    expect(cellRenderList(instrumented, 4, 9, null).map(({ id }) => id))
      .toEqual([0, 1, 2, 9]);
    expect(visited).toBe(4);
  });

  it('pins selected graph context without exceeding the shared budget', () => {
    const field: CellInspectionField = {
      selectedCellId: 9,
      maxHops: 2,
      hopsByCellId: new Map([[9, 0], [8, 1], [7, 2]]),
    };
    const rendered = cellRenderList(cells, 4, 9, field);
    const renderedMap = cellRenderMap(rendered);

    expect(rendered).toHaveLength(4);
    expect(renderedMap.size).toBe(4);
    expect([...renderedMap.keys()]).toEqual(expect.arrayContaining([7, 8, 9]));
  });
});

describe('sameCellRenderTopology', () => {
  it('ignores payload-only changes but detects structural display changes', () => {
    const previous = cellRenderMap([cell(1), cell(2)]);

    expect(sameCellRenderTopology(previous, [
      { ...cell(1), tag: 'dex' },
      cell(2),
    ])).toBe(true);
    expect(sameCellRenderTopology(previous, [cell(2), cell(1)])).toBe(false);
    expect(sameCellRenderTopology(previous, [
      { ...cell(1), death_at_ms: 5000 },
      cell(2),
    ])).toBe(false);
    expect(sameCellRenderTopology(previous, [
      { ...cell(1), pos_seed: [99, 0, 0] },
      cell(2),
    ])).toBe(false);
  });
});
