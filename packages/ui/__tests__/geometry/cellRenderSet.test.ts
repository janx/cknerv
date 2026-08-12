// Render-set tests for the display-plane journal consumer. Composition
// policy (30:40:30 quotas, interleave, outpoint dedupe, activity pins) is
// server-side now — its algorithm tests were ported to Rust in S2. What
// remains here is pure mechanism: journal patching, canonical-first
// resolution, rebuild fallbacks, the presentation clamp, and the D4
// inspection overlay pool.

import { describe, expect, it } from 'vitest';
import type { Cell, CellDelta, CellGalaxySnapshot } from '@cknerv/types';
import {
  cellRenderMap,
  cellRenderOverlay,
  createCellRenderSetState,
  OVERLAY_SLOT_POOL,
  syncCellRenderSet,
} from '../../src/geometry/cellRenderSet';
import type { CellInspectionField } from '../../src/nerve/cellInspectionField';
import {
  applyCellDelta,
  applyRevisionedCellDeltas,
  emptyCellsCache,
  fromCellsSnapshot,
  type CellGalaxyCache,
} from '@cknerv/cache';

function cell(id: number, overrides: Partial<Cell> = {}): Cell {
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
    ...overrides,
  };
}

function displayDelta(overrides: Partial<{
  enter_ids: number[];
  enter_cells: Cell[];
  exit_ids: number[];
}> = {}): CellDelta {
  return {
    type: 'display',
    enter_ids: [],
    enter_cells: [],
    exit_ids: [],
    ...overrides,
  };
}

function snapshotWithDisplay(
  canonical: Cell[],
  members: number[],
  residents: Cell[] = [],
): CellGalaxySnapshot {
  return {
    cells: canonical,
    last_pulse_at_ms: 0,
    display: {
      budget: { cells: 12_000, nerve_edges: 8_000 },
      members,
      residents,
      provenance: {
        mode: 'canonical',
        source: null,
        as_of: null,
        updated_at_ms: 0,
      },
    },
  };
}

function fallbackCacheWithCells(ids: readonly number[]): CellGalaxyCache {
  let cache = emptyCellsCache();
  for (const id of ids) {
    cache = applyCellDelta(cache, { type: 'birth', cell: cell(id) });
  }
  return cache;
}

describe('syncCellRenderSet — display plane', () => {
  it('resolves staged members canonical-first on the bootstrap rebuild', () => {
    const resident = cell(501);
    const cache = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1), cell(2)], [1, 2, 501], [resident]),
    );
    const state = createCellRenderSetState();
    const update = syncCellRenderSet(state, cache, 12_000);

    expect(update.mode).toBe('rebuild');
    expect(update.cells.map(({ id }) => id)).toEqual([1, 2, 501]);
    expect(update.cells[0]).toBe(cache.cells.get(1));
    expect(update.cells[2]).toBe(cache.displayResidents.get(501));
  });

  it('skips member ids that resolve to nothing instead of crashing', () => {
    const cache = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1)], [1, 999]),
    );
    const state = createCellRenderSetState();
    const update = syncCellRenderSet(state, cache, 12_000);
    expect(update.cells.map(({ id }) => id)).toEqual([1]);
  });

  it('applies enters incrementally as appended slots', () => {
    const before = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1), cell(2)], [1, 2]),
    );
    const state = createCellRenderSetState();
    const initial = syncCellRenderSet(state, before, 12_000);

    const after = applyRevisionedCellDeltas(before, [
      { revision: 2, delta: { type: 'birth', cell: cell(9) } },
      { revision: 2, delta: displayDelta({ enter_ids: [9] }) },
    ]);
    const update = syncCellRenderSet(state, after, 12_000);

    expect(update.mode).toBe('incremental');
    expect(update.cells.map(({ id }) => id)).toEqual([1, 2, 9]);
    expect(update.ranges).toEqual([{ start: 2, count: 1 }]);
    expect(update.membershipChanged).toBe(true);
    expect(update.topologyChanged).toBe(true);
    expect(update.topologyVersion).toBe(initial.topologyVersion + 1);
  });

  it('applies resident enters through enter_cells payloads', () => {
    const before = fromCellsSnapshot(1, snapshotWithDisplay([cell(1)], [1]));
    const state = createCellRenderSetState();
    syncCellRenderSet(state, before, 12_000);

    const resident = cell(700);
    const after = applyCellDelta(
      before,
      displayDelta({ enter_cells: [resident] }),
    );
    const update = syncCellRenderSet(state, after, 12_000);

    expect(update.mode).toBe('incremental');
    expect(update.cells.map(({ id }) => id)).toEqual([1, 700]);
    expect(update.cells[1]).toBe(after.displayResidents.get(700));
  });

  it('applies exits by swap-from-tail without disturbing other slots', () => {
    const before = fromCellsSnapshot(
      1,
      snapshotWithDisplay(
        [cell(1), cell(2), cell(3), cell(4)],
        [1, 2, 3, 4],
      ),
    );
    const state = createCellRenderSetState();
    syncCellRenderSet(state, before, 12_000);

    const after = applyCellDelta(before, displayDelta({ exit_ids: [2] }));
    const update = syncCellRenderSet(state, after, 12_000);

    expect(update.mode).toBe('incremental');
    expect(update.cells.map(({ id }) => id)).toEqual([1, 4, 3]);
    expect(update.ranges).toEqual([{ start: 1, count: 1 }]);
    expect(update.membershipChanged).toBe(true);
    // The index stays exact after the swap-removal.
    for (const [index, entry] of update.cells.entries()) {
      expect(state.indexById.get(entry.id)).toBe(index);
    }
  });

  it('patches staged payload replacements in place and versions topology precisely', () => {
    const before = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1), cell(2), cell(3)], [1, 2, 3]),
    );
    const state = createCellRenderSetState();
    const initial = syncCellRenderSet(state, before, 12_000);

    const tagged = applyCellDelta(before, { type: 'tag', id: 2, tag: 'dex' });
    const tagUpdate = syncCellRenderSet(state, tagged, 12_000);
    expect(tagUpdate.mode).toBe('incremental');
    expect(tagUpdate.ranges).toEqual([{ start: 1, count: 1 }]);
    expect(tagUpdate.cells[1]).toBe(tagged.cells.get(2));
    expect(tagUpdate.topologyChanged).toBe(false);
    expect(tagUpdate.topologyVersion).toBe(initial.topologyVersion);

    const dead = applyCellDelta(tagged, { type: 'death', id: 2, at_ms: 5000 });
    const deathUpdate = syncCellRenderSet(state, dead, 12_000);
    expect(deathUpdate.mode).toBe('incremental');
    expect(deathUpdate.ranges).toEqual([{ start: 1, count: 1 }]);
    expect(deathUpdate.topologyChanged).toBe(true);
    expect(deathUpdate.topologyVersion).toBe(initial.topologyVersion + 1);
  });

  it('ignores canonical churn of off-stage cells without touching the list', () => {
    const before = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1), cell(2)], [1, 2]),
    );
    const state = createCellRenderSetState();
    const initial = syncCellRenderSet(state, before, 12_000);

    const after = applyCellDelta(before, { type: 'birth', cell: cell(99) });
    let visited = 0;
    const values = after.cells.values.bind(after.cells);
    after.cells.values = function* instrumentedValues() {
      for (const value of values()) {
        visited += 1;
        yield value;
      }
    } as typeof after.cells.values;
    const update = syncCellRenderSet(state, after, 12_000);

    expect(update.mode).toBe('incremental');
    expect(update.cells).toBe(initial.cells);
    expect(update.ranges).toEqual([]);
    expect(update.membershipChanged).toBe(false);
    expect(update.topologyVersion).toBe(initial.topologyVersion);
    expect(visited).toBe(0);
  });

  it('a byte-identical display replay leaves the sync unchanged', () => {
    const delta = displayDelta({ enter_ids: [1] });
    const once = applyCellDelta(
      fromCellsSnapshot(1, snapshotWithDisplay([cell(1), cell(2)], [2])),
      delta,
    );
    const state = createCellRenderSetState();
    syncCellRenderSet(state, once, 12_000);

    const replayed = applyCellDelta(once, displayDelta({ enter_ids: [1] }));
    expect(replayed).toBe(once);
    expect(syncCellRenderSet(state, replayed, 12_000).mode).toBe('unchanged');
  });

  it('rebuilds once when React skipped a journal generation', () => {
    const start = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1), cell(2), cell(3)], [1]),
    );
    const state = createCellRenderSetState();
    syncCellRenderSet(state, start, 12_000);

    const skipped = applyCellDelta(start, displayDelta({ enter_ids: [2] }));
    const latest = applyCellDelta(skipped, displayDelta({ enter_ids: [3] }));
    const update = syncCellRenderSet(state, latest, 12_000);

    expect(update.mode).toBe('rebuild');
    expect(update.cells.map(({ id }) => id)).toEqual([1, 2, 3]);
  });

  it('rebuilds when a snapshot resets the plane', () => {
    const first = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1), cell(2)], [1, 2]),
    );
    const state = createCellRenderSetState();
    syncCellRenderSet(state, first, 12_000);

    const resync = fromCellsSnapshot(
      9,
      snapshotWithDisplay([cell(1), cell(5)], [5, 1]),
      {},
      first,
    );
    const update = syncCellRenderSet(state, resync, 12_000);

    expect(update.mode).toBe('rebuild');
    expect(update.cells.map(({ id }) => id)).toEqual([5, 1]);
  });

  it('incremental patching converges to the same membership as a rebuild', () => {
    const start = fromCellsSnapshot(
      1,
      snapshotWithDisplay(
        [cell(1), cell(2), cell(3), cell(4)],
        [1, 2, 3],
      ),
    );
    const cursor = createCellRenderSetState();
    syncCellRenderSet(cursor, start, 12_000);

    const after = applyRevisionedCellDeltas(start, [
      { revision: 2, delta: { type: 'birth', cell: cell(9) } },
      { revision: 3, delta: { type: 'death', id: 1, at_ms: 5000 } },
      {
        revision: 4,
        delta: displayDelta({
          enter_ids: [4, 9],
          enter_cells: [cell(700)],
          exit_ids: [2],
        }),
      },
    ]);
    const incremental = syncCellRenderSet(cursor, after, 12_000);
    expect(incremental.mode).toBe('incremental');

    const fresh = createCellRenderSetState();
    const rebuilt = syncCellRenderSet(fresh, after, 12_000);
    expect(rebuilt.mode).toBe('rebuild');

    // Same set, same resolved objects; the incremental order may deviate
    // (swap-from-tail) — order has no consumer downstream of the stable
    // slot layer.
    const sortIds = (cells: readonly Cell[]) =>
      cells.map(({ id }) => id).sort((a, b) => a - b);
    expect(sortIds(incremental.cells)).toEqual(sortIds(rebuilt.cells));
    const byId = cellRenderMap(rebuilt.cells);
    for (const entry of incremental.cells) {
      expect(entry).toBe(byId.get(entry.id));
    }
  });

  it('the presentation clamp renders the first N of the staged list', () => {
    const cache = fromCellsSnapshot(
      1,
      snapshotWithDisplay(
        [cell(1), cell(2), cell(3), cell(4)],
        [1, 2, 3, 4],
      ),
    );
    const state = createCellRenderSetState();
    const clamped = syncCellRenderSet(state, cache, 2);
    expect(clamped.mode).toBe('rebuild');
    expect(clamped.cells.map(({ id }) => id)).toEqual([1, 2]);

    // While the clamp bites, churn resolves through the rebuild slice.
    const after = applyCellDelta(cache, displayDelta({ exit_ids: [1] }));
    const next = syncCellRenderSet(state, after, 2);
    expect(next.mode).toBe('rebuild');
    expect(next.cells.map(({ id }) => id)).toEqual([2, 3]);

    // Raising the clamp back above membership restores the journal path.
    const relaxed = syncCellRenderSet(state, after, 12_000);
    expect(relaxed.cells.map(({ id }) => id)).toEqual([2, 3, 4]);
    const grown = applyRevisionedCellDeltas(after, [
      { revision: 5, delta: { type: 'birth', cell: cell(9) } },
      { revision: 5, delta: displayDelta({ enter_ids: [9] }) },
    ]);
    expect(syncCellRenderSet(state, grown, 12_000).mode).toBe('incremental');
  });
});

describe('syncCellRenderSet — no-display-plane fallback (canonical prefix)', () => {
  it('renders the bounded canonical insertion-order prefix', () => {
    const state = createCellRenderSetState();
    const cache = fallbackCacheWithCells([0, 1, 2, 3, 4]);
    const update = syncCellRenderSet(state, cache, 3);
    expect(update.mode).toBe('rebuild');
    expect(update.cells.map(({ id }) => id)).toEqual([0, 1, 2]);
  });

  it('ignores hidden births without iterating or replacing the visible prefix', () => {
    const state = createCellRenderSetState();
    const before = fallbackCacheWithCells([0, 1, 2, 3, 4]);
    const initial = syncCellRenderSet(state, before, 3);
    const visible = initial.cells;
    const topologyVersion = initial.topologyVersion;
    const after = applyCellDelta(before, { type: 'birth', cell: cell(5) });
    let visited = 0;
    const values = after.cells.values.bind(after.cells);
    after.cells.values = function* instrumentedValues() {
      for (const value of values()) {
        visited += 1;
        yield value;
      }
    } as typeof after.cells.values;

    const update = syncCellRenderSet(state, after, 3);

    expect(update.mode).toBe('incremental');
    expect(update.cells).toBe(visible);
    expect(update.ranges).toEqual([]);
    expect(update.membershipChanged).toBe(false);
    expect(update.topologyVersion).toBe(topologyVersion);
    expect(visited).toBe(0);
  });

  it('patches only visible metadata/lifecycle slots and versions topology precisely', () => {
    const state = createCellRenderSetState();
    const start = fallbackCacheWithCells([0, 1, 2, 3]);
    const initial = syncCellRenderSet(state, start, 3);

    const tagged = applyCellDelta(start, { type: 'tag', id: 1, tag: 'dex' });
    const tagUpdate = syncCellRenderSet(state, tagged, 3);
    expect(tagUpdate.mode).toBe('incremental');
    expect(tagUpdate.ranges).toEqual([{ start: 1, count: 1 }]);
    expect(tagUpdate.cells[0]).toBe(initial.cells[0]);
    expect(tagUpdate.cells[1]).toBe(tagged.cells.get(1));
    expect(tagUpdate.topologyChanged).toBe(false);
    expect(tagUpdate.topologyVersion).toBe(initial.topologyVersion);

    const dead = applyCellDelta(tagged, { type: 'death', id: 1, at_ms: 5000 });
    const deathUpdate = syncCellRenderSet(state, dead, 3);
    expect(deathUpdate.ranges).toEqual([{ start: 1, count: 1 }]);
    expect(deathUpdate.topologyChanged).toBe(true);
    expect(deathUpdate.topologyVersion).toBe(initial.topologyVersion + 1);
  });

  it('appends births incrementally while the display budget has room', () => {
    const state = createCellRenderSetState();
    const before = fallbackCacheWithCells([0, 1]);
    syncCellRenderSet(state, before, 4);
    const after = applyCellDelta(before, { type: 'birth', cell: cell(2) });

    const update = syncCellRenderSet(state, after, 4);

    expect(update.mode).toBe('incremental');
    expect(update.cells.map(({ id }) => id)).toEqual([0, 1, 2]);
    expect(update.ranges).toEqual([{ start: 2, count: 1 }]);
    expect(update.membershipChanged).toBe(true);
    expect(update.topologyChanged).toBe(true);
  });

  it('rebuilds canonically after GC invalidates insertion order', () => {
    const state = createCellRenderSetState();
    const before = fallbackCacheWithCells([0, 1, 2, 3, 4]);
    syncCellRenderSet(state, before, 3);
    const after = applyCellDelta(before, { type: 'gc', ids: [0] });
    let visited = 0;
    const values = after.cells.values.bind(after.cells);
    after.cells.values = function* instrumentedValues() {
      for (const value of values()) {
        visited += 1;
        yield value;
      }
    } as typeof after.cells.values;

    const update = syncCellRenderSet(state, after, 3);

    expect(after.cellChanges.orderInvalidated).toBe(true);
    expect(update.mode).toBe('rebuild');
    expect(update.cells.map(({ id }) => id)).toEqual([1, 2, 3]);
    expect(update.ranges).toEqual([{ start: 0, count: 3 }]);
    expect(visited).toBe(3);
  });

  it('rebuilds once when React skips a journal generation', () => {
    const state = createCellRenderSetState();
    const start = fallbackCacheWithCells([0, 1, 2, 3]);
    syncCellRenderSet(state, start, 3);
    const skipped = applyCellDelta(start, { type: 'birth', cell: cell(4) });
    const latest = applyCellDelta(skipped, { type: 'tag', id: 1, tag: 'dex' });

    const recovered = syncCellRenderSet(state, latest, 3);
    expect(recovered.mode).toBe('rebuild');
    expect(recovered.cells.map(({ id }) => id)).toEqual([0, 1, 2]);
  });

  it('a display plane arriving via snapshot flips the regime with one rebuild', () => {
    const state = createCellRenderSetState();
    const fallback = fallbackCacheWithCells([0, 1, 2]);
    syncCellRenderSet(state, fallback, 12_000);

    const staffed = fromCellsSnapshot(
      5,
      snapshotWithDisplay([cell(0), cell(1), cell(2)], [2, 0]),
      {},
      fallback,
    );
    const update = syncCellRenderSet(state, staffed, 12_000);
    expect(update.mode).toBe('rebuild');
    expect(update.cells.map(({ id }) => id)).toEqual([2, 0]);
  });
});

describe('cellRenderOverlay (D4 inspection pool)', () => {
  const stagedIndex = new Map<number, number>([[1, 0], [2, 1]]);

  it('returns the off-stage selected cell and nothing when staged', () => {
    const cache = fallbackCacheWithCells([1, 2, 3]);
    expect(
      cellRenderOverlay(cache, stagedIndex, 3, null).map(({ id }) => id),
    ).toEqual([3]);
    expect(cellRenderOverlay(cache, stagedIndex, 1, null)).toEqual([]);
    expect(cellRenderOverlay(cache, stagedIndex, null, null)).toEqual([]);
  });

  it('appends off-stage field members in ascending hop order', () => {
    const cache = fallbackCacheWithCells([1, 2, 3, 4, 5, 6]);
    const field: CellInspectionField = {
      selectedCellId: 3,
      maxHops: 2,
      hopsByCellId: new Map([[3, 0], [5, 2], [4, 1], [2, 1], [99, 1]]),
    };
    const overlay = cellRenderOverlay(cache, stagedIndex, 3, field);
    // Selected first; staged member 2 excluded; unresolvable 99 skipped;
    // members ordered by hop.
    expect(overlay.map(({ id }) => id)).toEqual([3, 4, 5]);
  });

  it('ignores a stale field belonging to a different selection', () => {
    const cache = fallbackCacheWithCells([1, 2, 3, 4]);
    const field: CellInspectionField = {
      selectedCellId: 4,
      maxHops: 2,
      hopsByCellId: new Map([[4, 0], [3, 1]]),
    };
    expect(
      cellRenderOverlay(cache, stagedIndex, 3, field).map(({ id }) => id),
    ).toEqual([3]);
  });

  it('resolves resident members through the display plane', () => {
    const resident = cell(501);
    const cache = applyCellDelta(
      fallbackCacheWithCells([1]),
      {
        type: 'display',
        enter_ids: [],
        enter_cells: [resident],
        exit_ids: [],
      },
    );
    const overlay = cellRenderOverlay(cache, new Map(), 501, null);
    expect(overlay).toHaveLength(1);
    expect(overlay[0]).toBe(cache.displayResidents.get(501));
  });

  it('caps the overlay at the reserved slot pool', () => {
    const ids = Array.from({ length: OVERLAY_SLOT_POOL + 50 }, (_, i) => i + 10);
    const cache = fallbackCacheWithCells([1, ...ids]);
    const field: CellInspectionField = {
      selectedCellId: 1,
      maxHops: 1,
      hopsByCellId: new Map([[1, 0], ...ids.map((id) => [id, 1] as const)]),
    };
    const overlay = cellRenderOverlay(cache, new Map(), 1, field);
    expect(overlay).toHaveLength(OVERLAY_SLOT_POOL);
    expect(overlay[0].id).toBe(1);
  });
});
