import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  cellRenderList,
  cellRenderMap,
  createCellRenderSetState,
  sameCellRenderTopology,
  syncCellRenderSet,
} from '../../src/geometry/cellRenderSet';
import type { CellInspectionField } from '../../src/nerve/cellInspectionField';
import { applyCellDelta, emptyCellsCache } from '@cknerv/cache';

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

describe('syncCellRenderSet', () => {
  function cacheWithCells(ids: readonly number[]) {
    let cache = emptyCellsCache();
    for (const id of ids) {
      cache = applyCellDelta(cache, { type: 'birth', cell: cell(id) });
    }
    return cache;
  }

  it('ignores hidden births without iterating or replacing the visible prefix', () => {
    const state = createCellRenderSetState();
    const before = cacheWithCells([0, 1, 2, 3, 4]);
    const initial = syncCellRenderSet(state, before, 3, null, null);
    const visible = initial.cells;
    const topologyVersion = initial.topologyVersion;
    const after = applyCellDelta(before, {
      type: 'birth',
      cell: cell(5),
    });
    let visited = 0;
    const values = after.cells.values.bind(after.cells);
    after.cells.values = function* instrumentedValues() {
      for (const value of values()) {
        visited += 1;
        yield value;
      }
    } as typeof after.cells.values;

    const update = syncCellRenderSet(state, after, 3, null, null);

    expect(update.mode).toBe('incremental');
    expect(update.cells).toBe(visible);
    expect(update.ranges).toEqual([]);
    expect(update.membershipChanged).toBe(false);
    expect(update.topologyVersion).toBe(topologyVersion);
    expect(visited).toBe(0);
  });

  it('patches only visible metadata/lifecycle slots and versions topology precisely', () => {
    const state = createCellRenderSetState();
    const start = cacheWithCells([0, 1, 2, 3]);
    const initial = syncCellRenderSet(state, start, 3, null, null);

    const tagged = applyCellDelta(start, { type: 'tag', id: 1, tag: 'dex' });
    const tagUpdate = syncCellRenderSet(state, tagged, 3, null, null);
    expect(tagUpdate.mode).toBe('incremental');
    expect(tagUpdate.ranges).toEqual([{ start: 1, count: 1 }]);
    expect(tagUpdate.cells[0]).toBe(initial.cells[0]);
    expect(tagUpdate.cells[1]).toBe(tagged.cells.get(1));
    expect(tagUpdate.topologyChanged).toBe(false);
    expect(tagUpdate.topologyVersion).toBe(initial.topologyVersion);

    const dead = applyCellDelta(tagged, { type: 'death', id: 1, at_ms: 5000 });
    const deathUpdate = syncCellRenderSet(state, dead, 3, null, null);
    expect(deathUpdate.ranges).toEqual([{ start: 1, count: 1 }]);
    expect(deathUpdate.topologyChanged).toBe(true);
    expect(deathUpdate.topologyVersion).toBe(initial.topologyVersion + 1);
  });

  it('appends births incrementally while the display budget has room', () => {
    const state = createCellRenderSetState();
    const before = cacheWithCells([0, 1]);
    syncCellRenderSet(state, before, 4, null, null);
    const after = applyCellDelta(before, {
      type: 'birth',
      cell: cell(2),
    });

    const update = syncCellRenderSet(state, after, 4, null, null);

    expect(update.mode).toBe('incremental');
    expect(update.cells.map(({ id }) => id)).toEqual([0, 1, 2]);
    expect(update.ranges).toEqual([{ start: 2, count: 1 }]);
    expect(update.membershipChanged).toBe(true);
    expect(update.topologyChanged).toBe(true);
  });

  it('rebuilds canonically after GC invalidates insertion order', () => {
    const state = createCellRenderSetState();
    const before = cacheWithCells([0, 1, 2, 3, 4]);
    syncCellRenderSet(state, before, 3, null, null);
    const after = applyCellDelta(before, { type: 'gc', ids: [0] });
    let visited = 0;
    const values = after.cells.values.bind(after.cells);
    after.cells.values = function* instrumentedValues() {
      for (const value of values()) {
        visited += 1;
        yield value;
      }
    } as typeof after.cells.values;

    const update = syncCellRenderSet(state, after, 3, null, null);

    expect(after.cellChanges.orderInvalidated).toBe(true);
    expect(update.mode).toBe('rebuild');
    expect(update.cells.map(({ id }) => id)).toEqual([1, 2, 3]);
    expect(update.ranges).toEqual([{ start: 0, count: 3 }]);
    expect(visited).toBe(3);
  });

  it('rebuilds when React skips a journal or a selected birth needs pinning', () => {
    const state = createCellRenderSetState();
    const start = cacheWithCells([0, 1, 2, 3]);
    syncCellRenderSet(state, start, 3, 9, null);
    const skipped = applyCellDelta(start, {
      type: 'birth',
      cell: cell(4),
    });
    const latest = applyCellDelta(skipped, { type: 'tag', id: 1, tag: 'dex' });

    const recovered = syncCellRenderSet(state, latest, 3, 9, null);
    expect(recovered.mode).toBe('rebuild');
    expect(recovered.cells.map(({ id }) => id)).toEqual([0, 1, 2]);

    const selected = applyCellDelta(latest, {
      type: 'birth',
      cell: cell(9),
    });
    const pinned = syncCellRenderSet(state, selected, 3, 9, null);
    expect(pinned.mode).toBe('rebuild');
    expect(pinned.cells.map(({ id }) => id)).toEqual([0, 1, 9]);
  });
});
