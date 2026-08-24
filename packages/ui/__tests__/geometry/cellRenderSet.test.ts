// Render-set tests for the display-plane journal consumer. Composition
// policy (20:70:10 quotas, interleave, outpoint dedupe, activity pins) is
// server-side now — its algorithm tests were ported to Rust in S2. What
// remains here is pure mechanism: journal patching, canonical-first
// resolution, rebuild fallbacks, the presentation clamp, and the D4
// selected-cell overlay pool.

import { describe, expect, it, vi } from 'vitest';
import type { Cell, CellDelta, CellGalaxySnapshot } from '@cknerv/types';
import {
  cellRenderClampActive,
  cellRenderMap,
  cellRenderOverlay,
  cellRenderOverlayChanged,
  cellRenderSetChanged,
  createCellRenderMapState,
  createCellRenderSetState,
  OVERLAY_SLOT_POOL,
  syncCellRenderMap,
  syncCellRenderSet,
  type CellRenderSetState,
} from '../../src/geometry/cellRenderSet';
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
    data_bytes: 0,
    content_hash: `0x${'00'.repeat(32)}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
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
    // The precondition every consumer that WALKS the list stands on: this
    // delta gives them nothing to walk.
    expect(cellRenderSetChanged(update)).toBe(false);
    expect(cellRenderSetChanged(null)).toBe(false);

    // A payload replacement on stage does move it, membership or not.
    const tagged = applyCellDelta(after, { type: 'tag', id: 1, tag: 'dex' });
    const tagUpdate = syncCellRenderSet(state, tagged, 12_000);
    expect(tagUpdate.membershipChanged).toBe(false);
    expect(cellRenderSetChanged(tagUpdate)).toBe(true);
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

  /** The clamp is not the render set's business alone: the topology journal
   *  is fed from the FULL staged membership, so while the clamp bites, its
   *  deltas would patch a worker baseline the truncated window never reached
   *  (NeuralNetwork invalidates the journal on exactly this predicate). */
  it('names the clamp regime for every consumer of the truncated list', () => {
    const cache = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1), cell(2), cell(3)], [1, 2, 3]),
    );
    expect(cellRenderClampActive(cache, 2)).toBe(true);
    // At or above the staged membership the list is complete, clamp or not.
    expect(cellRenderClampActive(cache, 3)).toBe(false);
    expect(cellRenderClampActive(cache, Number.POSITIVE_INFINITY)).toBe(false);
    // No display plane: the canonical-prefix regime has its own coverage
    // check, and `displayMembers` is not its membership.
    expect(cellRenderClampActive(fallbackCacheWithCells([0, 1, 2]), 1))
      .toBe(false);
  });
});

describe('syncCellRenderSet — membership diff', () => {
  it('reports the ids that arrived and departed on an incremental patch', () => {
    const before = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1), cell(2), cell(3)], [1, 2, 3]),
    );
    const state = createCellRenderSetState();
    const bootstrap = syncCellRenderSet(state, before, 12_000);
    // The bootstrap rebuild is one big arrival — everything the stage
    // resolves at open counts as entering it.
    expect([...bootstrap.entered]).toEqual([1, 2, 3]);
    expect([...bootstrap.exited]).toEqual([]);

    const after = applyRevisionedCellDeltas(before, [
      { revision: 2, delta: { type: 'birth', cell: cell(9) } },
      { revision: 2, delta: displayDelta({ enter_ids: [9], exit_ids: [2] }) },
    ]);
    const update = syncCellRenderSet(state, after, 12_000);

    expect(update.mode).toBe('incremental');
    expect([...update.entered]).toEqual([9]);
    expect([...update.exited]).toEqual([2]);
  });

  it('nets out an id one batch removes and re-adds', () => {
    const before = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1), cell(2)], [1, 2]),
    );
    const state = createCellRenderSetState();
    syncCellRenderSet(state, before, 12_000);

    const after = applyRevisionedCellDeltas(before, [
      { revision: 2, delta: displayDelta({ exit_ids: [2] }) },
      { revision: 2, delta: displayDelta({ enter_ids: [2] }) },
    ]);
    const update = syncCellRenderSet(state, after, 12_000);

    // The stage never lost it, so nothing downstream may animate it away.
    expect([...update.entered]).toEqual([]);
    expect([...update.exited]).toEqual([]);
    expect(update.cells.map(({ id }) => id)).toEqual([1, 2]);
  });

  it('an id claimed on both sides of one journal is neither', () => {
    // One delta past the snapshot, so the journal chain (not a reset) is
    // what the sync below is actually reading.
    const before = applyCellDelta(
      fromCellsSnapshot(1, snapshotWithDisplay([cell(1), cell(2)], [1, 2])),
      { type: 'birth', cell: cell(3) },
    );
    const state = createCellRenderSetState();
    syncCellRenderSet(state, before, 12_000);

    // The cache nets its own batches, so this shape only reaches the render
    // set from a journal it did not author — the diff must survive it.
    const update = syncCellRenderSet(
      state,
      {
        ...before,
        displayToken: {},
        displayChanges: {
          baseToken: before.displayToken,
          reset: false,
          entered: [2],
          exited: [2],
          updated: [],
        },
      },
      12_000,
    );

    expect(update.mode).toBe('incremental');
    expect([...update.entered]).toEqual([]);
    expect([...update.exited]).toEqual([]);
    expect(update.cells.map(({ id }) => id).sort()).toEqual([1, 2]);
  });

  it('recovers the diff from the index maps when the journal is lost', () => {
    const start = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1), cell(2), cell(3)], [1, 2]),
    );
    const state = createCellRenderSetState();
    syncCellRenderSet(state, start, 12_000);

    const skipped = applyCellDelta(start, displayDelta({ exit_ids: [1] }));
    const latest = applyCellDelta(skipped, displayDelta({ enter_ids: [3] }));
    const update = syncCellRenderSet(state, latest, 12_000);

    expect(update.mode).toBe('rebuild');
    expect([...update.entered]).toEqual([3]);
    expect([...update.exited]).toEqual([1]);
  });

  it('a reorder alone is neither an arrival nor a departure', () => {
    const first = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1), cell(2)], [1, 2]),
    );
    const state = createCellRenderSetState();
    syncCellRenderSet(state, first, 12_000);

    // A snapshot reset re-stages the same membership in the other order.
    const reordered = fromCellsSnapshot(
      2,
      snapshotWithDisplay([cell(1), cell(2)], [2, 1]),
    );
    const update = syncCellRenderSet(state, reordered, 12_000);

    expect(update.mode).toBe('rebuild');
    expect(update.membershipChanged).toBe(true);
    expect([...update.entered]).toEqual([]);
    expect([...update.exited]).toEqual([]);
  });

  it('an unchanged sync reports no membership movement at all', () => {
    const cache = fromCellsSnapshot(1, snapshotWithDisplay([cell(1)], [1]));
    const state = createCellRenderSetState();
    syncCellRenderSet(state, cache, 12_000);
    const update = syncCellRenderSet(state, cache, 12_000);
    expect(update.mode).toBe('unchanged');
    expect([...update.entered]).toEqual([]);
    expect([...update.exited]).toEqual([]);
  });

  it('the canonical-prefix fallback reports its appended births', () => {
    const state = createCellRenderSetState();
    const before = fallbackCacheWithCells([1, 2]);
    expect([...syncCellRenderSet(state, before, 12_000).entered])
      .toEqual([1, 2]);

    const after = applyCellDelta(before, { type: 'birth', cell: cell(7) });
    const update = syncCellRenderSet(state, after, 12_000);
    expect(update.mode).toBe('incremental');
    expect([...update.entered]).toEqual([7]);
    expect([...update.exited]).toEqual([]);
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

describe('cellRenderOverlay (D4 selected-cell pool)', () => {
  const stagedIndex = new Map<number, number>([[1, 0], [2, 1]]);

  it('returns the off-stage selected cell and nothing when staged', () => {
    const cache = fallbackCacheWithCells([1, 2, 3]);
    expect(
      cellRenderOverlay(cache, stagedIndex, 3).map(({ id }) => id),
    ).toEqual([3]);
    expect(cellRenderOverlay(cache, stagedIndex, 1)).toEqual([]);
    expect(cellRenderOverlay(cache, stagedIndex, null)).toEqual([]);
  });

  it('returns nothing for a selection no retained record resolves', () => {
    const cache = fallbackCacheWithCells([1, 2]);
    expect(cellRenderOverlay(cache, stagedIndex, 99)).toEqual([]);
  });

  it('resolves a resident selection through the display plane', () => {
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
    const overlay = cellRenderOverlay(cache, new Map(), 501);
    expect(overlay).toHaveLength(1);
    expect(overlay[0]).toBe(cache.displayResidents.get(501));
  });

  it('never draws anything with an exhausted slot pool', () => {
    const cache = fallbackCacheWithCells([1]);
    expect(cellRenderOverlay(cache, new Map(), 1, 0)).toEqual([]);
    expect(cellRenderOverlay(cache, new Map(), 1, OVERLAY_SLOT_POOL))
      .toHaveLength(1);
  });

  it('re-resolving the same selection is not a change', () => {
    const cache = fallbackCacheWithCells([1, 2, 3]);
    const before = cellRenderOverlay(cache, stagedIndex, 3);
    // The pool is re-resolved on every delta; the drawn list only has to
    // move when the resolved record does.
    expect(cellRenderOverlayChanged(
      before,
      cellRenderOverlay(cache, stagedIndex, 3),
    )).toBe(false);
    expect(cellRenderOverlayChanged(before, [])).toBe(true);
    expect(cellRenderOverlayChanged([], [])).toBe(false);

    // An off-stage record replaced under a held selection has to reach the
    // buffers — same id, different object.
    const refreshed = applyCellDelta(cache, { type: 'tag', id: 3, tag: 'dex' });
    expect(cellRenderOverlayChanged(
      before,
      cellRenderOverlay(refreshed, stagedIndex, 3),
    )).toBe(true);
  });
});

/** The slot index is renderer-local and single-writer, so a patch writes it
 *  in place instead of photocopying 12K entries per block. What that costs
 *  is the free undo a clone used to provide: these pin that the in-place
 *  index still matches its published list after every path, including the
 *  one that abandons a half-applied patch. */
describe('syncCellRenderSet — the in-place slot index', () => {
  const expectIndexMirrors = (
    state: CellRenderSetState,
    cells: readonly Cell[],
  ) => {
    expect(state.indexById.size).toBe(cells.length);
    for (const [slot, entry] of cells.entries()) {
      expect(state.indexById.get(entry.id)).toBe(slot);
    }
  };

  it('follows a birth, a death and a departure through one cursor', () => {
    const start = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1), cell(2), cell(3), cell(4)], [1, 2, 3, 4]),
    );
    const state = createCellRenderSetState();
    expectIndexMirrors(state, syncCellRenderSet(state, start, 12_000).cells);

    const grown = applyRevisionedCellDeltas(start, [
      { revision: 2, delta: { type: 'birth', cell: cell(9) } },
      { revision: 2, delta: displayDelta({ enter_ids: [9] }) },
    ]);
    const birth = syncCellRenderSet(state, grown, 12_000);
    expect(birth.mode).toBe('incremental');
    expectIndexMirrors(state, birth.cells);

    const died = applyCellDelta(grown, { type: 'death', id: 3, at_ms: 5000 });
    const death = syncCellRenderSet(state, died, 12_000);
    expect(death.mode).toBe('incremental');
    expect(death.cells[2]).toBe(died.cells.get(3));
    expectIndexMirrors(state, death.cells);

    const left = applyCellDelta(died, displayDelta({ exit_ids: [2] }));
    const exit = syncCellRenderSet(state, left, 12_000);
    expect(exit.mode).toBe('incremental');
    expect(exit.cells.map(({ id }) => id)).toEqual([1, 9, 3, 4]);
    expectIndexMirrors(state, exit.cells);
  });

  it('leaves nothing of the first patch behind for the second', () => {
    const start = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1), cell(2), cell(3)], [1, 2, 3]),
    );
    const state = createCellRenderSetState();
    syncCellRenderSet(state, start, 12_000);

    // Two patches on one cursor, each swapping a departure out of the middle
    // and appending an arrival: the second reads the index the first wrote.
    const first = applyRevisionedCellDeltas(start, [
      { revision: 2, delta: { type: 'birth', cell: cell(8) } },
      { revision: 2, delta: displayDelta({ exit_ids: [1], enter_ids: [8] }) },
    ]);
    const one = syncCellRenderSet(state, first, 12_000);
    expect(one.mode).toBe('incremental');
    expectIndexMirrors(state, one.cells);

    const second = applyRevisionedCellDeltas(first, [
      { revision: 3, delta: { type: 'birth', cell: cell(9) } },
      { revision: 3, delta: displayDelta({ exit_ids: [2], enter_ids: [9] }) },
    ]);
    const two = syncCellRenderSet(state, second, 12_000);
    expect(two.mode).toBe('incremental');
    expect([...two.exited]).toEqual([2]);
    expect([...two.entered]).toEqual([9]);
    expectIndexMirrors(state, two.cells);
    // Every surviving id still resolves to the slot it actually occupies.
    for (const entry of two.cells) {
      expect(two.cells[state.indexById.get(entry.id) as number]).toBe(entry);
    }
  });

  it('rewinds a half-applied patch before the rebuild reads it', () => {
    // The unresolved-enter warning is once per session and this file spends
    // it earlier; silence the channel either way.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const before = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1), cell(2), cell(3), cell(4)], [1, 2, 3, 4]),
    );
    const state = createCellRenderSetState();
    syncCellRenderSet(state, before, 12_000);

    // One patch, two halves: the exit lands on the index, then an enter no
    // record resolves aborts to a rebuild — which recovers the membership
    // diff from that same index. A half-applied index would swallow the
    // departure and nothing downstream would fade cell 2 out.
    const after = applyCellDelta(
      before,
      displayDelta({ exit_ids: [2], enter_ids: [777] }),
    );
    const update = syncCellRenderSet(state, after, 12_000);

    expect(update.mode).toBe('rebuild');
    expect(update.cells.map(({ id }) => id)).toEqual([1, 3, 4]);
    expect([...update.exited]).toEqual([2]);
    expect([...update.entered]).toEqual([]);
    expectIndexMirrors(state, update.cells);
    warn.mockRestore();
  });
});

/** The id→Cell view the display topology builder packs. It used to be a
 *  fresh 12K-entry Map per membership-changing block; it is now patched from
 *  the same update that moved the list. */
describe('syncCellRenderMap', () => {
  const expectMapMirrors = (
    map: ReadonlyMap<number, Cell>,
    cells: readonly Cell[],
  ) => {
    expect(map.size).toBe(cells.length);
    for (const entry of cells) expect(map.get(entry.id)).toBe(entry);
  };

  it('hands back the very same map while the list holds still', () => {
    const cache = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1), cell(2)], [1, 2]),
    );
    const cursor = createCellRenderSetState();
    const mapState = createCellRenderMapState();
    const bootstrap = syncCellRenderSet(cursor, cache, 12_000);
    const map = syncCellRenderMap(mapState, bootstrap);
    expectMapMirrors(map, bootstrap.cells);

    const replay = syncCellRenderSet(cursor, cache, 12_000);
    expect(replay.mode).toBe('unchanged');
    expect(syncCellRenderMap(mapState, replay)).toBe(map);

    // Same membership, new value: still a patch, never a rebuild.
    const tagged = applyCellDelta(cache, { type: 'tag', id: 2, tag: 'dex' });
    const update = syncCellRenderSet(cursor, tagged, 12_000);
    expect(update.mode).toBe('incremental');
    expect(syncCellRenderMap(mapState, update)).toBe(map);
    expect(map.get(2)).toBe(tagged.cells.get(2));
    expectMapMirrors(map, update.cells);
  });

  it('patches arrivals, departures and deaths into the map it already has', () => {
    const start = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1), cell(2), cell(3)], [1, 2, 3]),
    );
    const cursor = createCellRenderSetState();
    const mapState = createCellRenderMapState();
    const map = syncCellRenderMap(
      mapState,
      syncCellRenderSet(cursor, start, 12_000),
    );

    const after = applyRevisionedCellDeltas(start, [
      { revision: 2, delta: { type: 'birth', cell: cell(9) } },
      { revision: 2, delta: { type: 'death', id: 3, at_ms: 5000 } },
      {
        revision: 2,
        delta: displayDelta({
          enter_ids: [9],
          enter_cells: [cell(700)],
          exit_ids: [1],
        }),
      },
    ]);
    const update = syncCellRenderSet(cursor, after, 12_000);
    expect(update.mode).toBe('incremental');

    const patched = syncCellRenderMap(mapState, update);
    expect(patched).toBe(map);
    expectMapMirrors(patched, update.cells);
    expect(patched.has(1)).toBe(false);
    expect(patched.get(3)).toBe(after.cells.get(3));
    expect(patched.get(700)).toBe(after.displayResidents.get(700));
  });

  it('converges on the rebuild path too', () => {
    const start = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1), cell(2), cell(3)], [1, 2]),
    );
    const cursor = createCellRenderSetState();
    const mapState = createCellRenderMapState();
    syncCellRenderMap(mapState, syncCellRenderSet(cursor, start, 12_000));

    // A snapshot reset re-stages a different membership: the update is a
    // rebuild, but its ranges/departures still describe the same base.
    const resync = fromCellsSnapshot(
      9,
      snapshotWithDisplay([cell(2), cell(3)], [3, 2]),
      {},
      start,
    );
    const update = syncCellRenderSet(cursor, resync, 12_000);
    expect(update.mode).toBe('rebuild');
    const patched = syncCellRenderMap(mapState, update);
    expectMapMirrors(patched, update.cells);
    expect(patched.has(1)).toBe(false);
  });

  it('rebuilds rather than mispatch a generation it never saw', () => {
    const start = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1), cell(2), cell(3)], [1, 2]),
    );
    const cursor = createCellRenderSetState();
    const mapState = createCellRenderMapState();
    const map = syncCellRenderMap(
      mapState,
      syncCellRenderSet(cursor, start, 12_000),
    );

    // The cursor advances twice; the map is only shown the second update,
    // whose ranges describe a list it never held.
    const grown = applyRevisionedCellDeltas(start, [
      { revision: 2, delta: displayDelta({ enter_ids: [3] }) },
    ]);
    const skipped = syncCellRenderSet(cursor, grown, 12_000);
    expect(skipped.mode).toBe('incremental');
    const thinned = applyCellDelta(grown, displayDelta({ exit_ids: [1] }));
    const latest = syncCellRenderSet(cursor, thinned, 12_000);

    const rebuilt = syncCellRenderMap(mapState, latest);
    expect(rebuilt).not.toBe(map);
    expectMapMirrors(rebuilt, latest.cells);
    expect(rebuilt.has(1)).toBe(false);
  });
});
