import { describe, expect, it } from 'vitest';
import type { AssetKind, Cell, GalaxyCompositionRecord } from '@cknerv/types';
import {
  cellRenderList,
  cellRenderMap,
  createCellRenderSetState,
  currentActivityCellIds,
  sameCellRenderTopology,
  syncCellRenderSet,
} from '../../src/geometry/cellRenderSet';
import type { CellInspectionField } from '../../src/nerve/cellInspectionField';
import { applyCellDelta, emptyCellsCache } from '@cknerv/cache';

function cell(id: number, assetKind?: AssetKind): Cell {
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
    asset_kind: assetKind,
  };
}

function composition(
  dao: Cell[],
  typed: Cell[],
  plain: Cell[],
): GalaxyCompositionRecord {
  return {
    source: 'ckbadger',
    as_of: { block: 10, hash: '0xblock10' },
    updated_at_ms: 1,
    dao,
    typed,
    plain,
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

  it('composes the 6000-cell resting field at exactly 30:40:30', () => {
    const record = composition(
      Array.from({ length: 1_800 }, (_, index) => cell(10_000 + index, 'dao')),
      Array.from({ length: 2_400 }, (_, index) => cell(20_000 + index, 'xudt')),
      Array.from({ length: 1_800 }, (_, index) => cell(30_000 + index, 'native')),
    );

    const rendered = cellRenderList(new Map(), 6_000, null, null, record);
    const counts = rendered.reduce((acc, entry) => {
      if (entry.asset_kind === 'dao') acc.dao += 1;
      else if (entry.asset_kind === 'native') acc.plain += 1;
      else acc.typed += 1;
      return acc;
    }, { dao: 0, typed: 0, plain: 0 });

    expect(rendered).toHaveLength(6_000);
    expect(counts).toEqual({ dao: 1_800, typed: 2_400, plain: 1_800 });
  });

  it('pins newest canonical activity inside its class quota', () => {
    const record = composition(
      [cell(101, 'dao'), cell(102, 'dao'), cell(103, 'dao')],
      [cell(201, 'xudt'), cell(202, 'xudt'), cell(203, 'xudt'), cell(204, 'xudt')],
      [cell(301, 'native'), cell(302, 'native'), cell(303, 'native')],
    );
    const active = cell(999, 'xudt');
    const canonical = new Map([[active.id, active]]);

    const rendered = cellRenderList(canonical, 10, null, null, record, [active.id]);

    expect(rendered.map(({ id }) => id)).toContain(active.id);
    expect(rendered.filter(({ asset_kind }) => asset_kind === 'dao')).toHaveLength(3);
    expect(rendered.filter(({ asset_kind }) => asset_kind === 'native')).toHaveLength(3);
    expect(rendered.filter(({ asset_kind }) => asset_kind === 'xudt')).toHaveLength(4);
    expect(canonical.size).toBe(1);
    expect(canonical.get(active.id)).toBe(active);
  });

  it('prefers a canonical Cell over an indexed copy of the same outpoint', () => {
    const indexed = cell(101, 'dao');
    const canonical = { ...cell(1, 'dao'), out_point: indexed.out_point };
    const record = composition(
      [indexed, cell(102, 'dao'), cell(103, 'dao')],
      [cell(201, 'xudt'), cell(202, 'xudt'), cell(203, 'xudt'), cell(204, 'xudt')],
      [cell(301, 'native'), cell(302, 'native'), cell(303, 'native')],
    );

    const rendered = cellRenderList(
      new Map([[canonical.id, canonical]]),
      10,
      null,
      null,
      record,
    );

    expect(rendered.map(({ id }) => id)).toContain(canonical.id);
    expect(rendered.map(({ id }) => id)).not.toContain(indexed.id);
  });

  it('extracts activity endpoints only from the newest block', () => {
    const pulseLinks = [
      { block: 9, from_ids: [1], to_ids: [2] },
      { block: 10, from_ids: [3], to_ids: [4] },
      { block: 10, from_ids: [4], to_ids: [5] },
    ] as Parameters<typeof currentActivityCellIds>[0]['pulseLinks'];

    expect(currentActivityCellIds({ pulseLinks })).toEqual([4, 5, 3]);
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
