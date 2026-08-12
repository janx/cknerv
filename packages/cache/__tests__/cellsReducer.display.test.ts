// Display-plane store tests: server-authored stage membership riding the
// cells projection. The store must mirror the canonical reducer's
// immutability/token/journal disciplines exactly — byte-identical replays
// are pure no-ops, journals chain by token, snapshots reset.

import { describe, expect, it } from 'vitest';

import type {
  Cell,
  CellDelta,
  CellGalaxySnapshot,
  DisplayProvenance,
} from '@cknerv/types';

import {
  applyCellDelta,
  applyRevisionedCellDeltas,
  emptyCellsCache,
  fromCellsSnapshot,
  NO_DISPLAY_CHANGES,
  resolveDisplayCell,
  type CellGalaxyCache,
} from '../src/cellsReducer';

function cell(id: number, overrides: Partial<Cell> = {}): Cell {
  return {
    id,
    born_at_ms: 1000 + id,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [id, 0, 0],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 100,
    data_hex: '0x',
    content_hash: '0x' + '00'.repeat(32),
    ...overrides,
  };
}

function displayDelta(overrides: Partial<{
  enter_ids: number[];
  enter_cells: Cell[];
  exit_ids: number[];
  provenance: DisplayProvenance | null;
}> = {}): CellDelta {
  return {
    type: 'display',
    enter_ids: [],
    enter_cells: [],
    exit_ids: [],
    ...overrides,
  };
}

const composedProvenance: DisplayProvenance = {
  mode: 'composed',
  source: 'ckbadger',
  as_of: { block: 42, hash: '0xblock42' },
  updated_at_ms: 7_000,
};

function cacheWithCanonical(ids: readonly number[]): CellGalaxyCache {
  let cache = emptyCellsCache();
  for (const id of ids) {
    cache = applyCellDelta(cache, { type: 'birth', cell: cell(id) });
  }
  return cache;
}

describe('display delta — membership and residents', () => {
  it('enter_ids join members and journal as entered', () => {
    const before = cacheWithCanonical([1, 2]);
    const after = applyCellDelta(before, displayDelta({ enter_ids: [1, 2] }));

    expect([...after.displayMembers]).toEqual([1, 2]);
    expect(after.displayToken).not.toBe(before.displayToken);
    expect(after.displayChanges.baseToken).toBe(before.displayToken);
    expect(after.displayChanges.entered).toEqual([1, 2]);
    expect(after.displayChanges.exited).toEqual([]);
    expect(after.displayChanges.updated).toEqual([]);
    // The canonical plane is untouched by a pure membership patch.
    expect(after.cells).toBe(before.cells);
    expect(after.cellsToken).toBe(before.cellsToken);
  });

  it('enter_cells land residents and journal as entered', () => {
    const before = cacheWithCanonical([1]);
    const resident = cell(9_007_199_254_000_001);
    const after = applyCellDelta(
      before,
      displayDelta({ enter_ids: [1], enter_cells: [resident] }),
    );

    expect(after.displayMembers.has(resident.id)).toBe(true);
    expect(after.displayResidents.get(resident.id)).toBe(resident);
    expect([...after.displayChanges.entered].sort((a, b) => a - b)).toEqual(
      [1, resident.id],
    );
    // Residents never leak into the canonical retained map.
    expect(after.cells.has(resident.id)).toBe(false);
  });

  it('exits leave members, drop resident payloads, and journal as exited', () => {
    const resident = cell(501);
    let cache = cacheWithCanonical([1, 2]);
    cache = applyCellDelta(
      cache,
      displayDelta({ enter_ids: [1, 2], enter_cells: [resident] }),
    );
    const before = cache;
    const after = applyCellDelta(before, displayDelta({ exit_ids: [2, 501] }));

    expect([...after.displayMembers]).toEqual([1]);
    expect(after.displayResidents.has(501)).toBe(false);
    expect([...after.displayChanges.exited].sort((a, b) => a - b))
      .toEqual([2, 501]);
    expect(after.displayChanges.entered).toEqual([]);
    expect(after.displayChanges.baseToken).toBe(before.displayToken);
  });

  it('immutability: previous display maps are never mutated', () => {
    const before = applyCellDelta(
      cacheWithCanonical([1]),
      displayDelta({ enter_ids: [1] }),
    );
    const membersBefore = [...before.displayMembers];
    applyCellDelta(before, displayDelta({ enter_ids: [1], exit_ids: [1] }));
    expect([...before.displayMembers]).toEqual(membersBefore);
  });
});

describe('display delta — byte-replay no-op stability', () => {
  it('replaying an applied membership patch returns the same reference', () => {
    const resident = cell(501);
    const delta = displayDelta({
      enter_ids: [1],
      enter_cells: [resident],
      provenance: composedProvenance,
    });
    const once = applyCellDelta(cacheWithCanonical([1]), delta);
    // A structurally identical payload (fresh parse) must also no-op.
    const replay: CellDelta = {
      type: 'display',
      enter_ids: [1],
      enter_cells: [{ ...resident, pos_seed: [...resident.pos_seed] }],
      exit_ids: [],
      provenance: { ...composedProvenance, as_of: { ...composedProvenance.as_of! } },
    };
    expect(applyCellDelta(once, replay)).toBe(once);
  });

  it('exit of a non-member and enter of a member are pure no-ops', () => {
    const once = applyCellDelta(
      cacheWithCanonical([1]),
      displayDelta({ enter_ids: [1] }),
    );
    expect(applyCellDelta(once, displayDelta({ exit_ids: [77] }))).toBe(once);
    expect(applyCellDelta(once, displayDelta({ enter_ids: [1] }))).toBe(once);
  });

  it('a content-identical resident re-ship keeps the retained object identity', () => {
    const resident = cell(501, { tag: 'wallet' });
    const once = applyCellDelta(
      emptyCellsCache(),
      displayDelta({ enter_cells: [resident] }),
    );
    const reShipped = applyCellDelta(
      once,
      displayDelta({ enter_cells: [{ ...resident }] }),
    );
    expect(reShipped).toBe(once);
    expect(reShipped.displayResidents.get(501)).toBe(resident);
  });
});

describe('display delta — resident payload updates', () => {
  it('re-shipping a changed payload for a staged resident journals as updated', () => {
    const resident = cell(501, { capacity: 100 });
    const before = applyCellDelta(
      emptyCellsCache(),
      displayDelta({ enter_cells: [resident] }),
    );
    const refreshed = { ...resident, capacity: 250 };
    const after = applyCellDelta(
      before,
      displayDelta({ enter_cells: [refreshed] }),
    );

    expect(after.displayResidents.get(501)).toBe(refreshed);
    expect(after.displayToken).not.toBe(before.displayToken);
    expect(after.displayChanges.updated).toEqual([501]);
    expect(after.displayChanges.entered).toEqual([]);
  });

  it('canonical-first resolution: canonical wins over a same-id resident', () => {
    const resident = cell(1, { capacity: 999 });
    let cache = cacheWithCanonical([1]);
    cache = applyCellDelta(cache, displayDelta({ enter_cells: [resident] }));

    // Both stay stored; canonical wins on lookup.
    expect(cache.displayResidents.get(1)).toBe(resident);
    expect(resolveDisplayCell(cache, 1)).toBe(cache.cells.get(1));
    expect(resolveDisplayCell(cache, 1)?.capacity).toBe(100);
  });

  it('resolveDisplayCell falls back to the resident for off-canonical members', () => {
    const resident = cell(501);
    const cache = applyCellDelta(
      emptyCellsCache(),
      displayDelta({ enter_cells: [resident] }),
    );
    expect(resolveDisplayCell(cache, 501)).toBe(resident);
    expect(resolveDisplayCell(cache, 502)).toBeUndefined();
  });
});

describe('display journal — canonical updated intersection', () => {
  it('death of a staged member pierces through as display updated', () => {
    let cache = cacheWithCanonical([1, 2]);
    cache = applyCellDelta(cache, displayDelta({ enter_ids: [1, 2] }));
    const staged = cache;
    const after = applyCellDelta(staged, { type: 'death', id: 1, at_ms: 5000 });

    expect(after.displayChanges.updated).toEqual([1]);
    expect(after.displayChanges.entered).toEqual([]);
    expect(after.displayChanges.exited).toEqual([]);
    // Membership itself did not move, so the display token is stable and the
    // journal chains on the unchanged token.
    expect(after.displayToken).toBe(staged.displayToken);
    expect(after.displayChanges.baseToken).toBe(staged.displayToken);
  });

  it('canonical churn of off-stage cells keeps the frozen no-op journal', () => {
    let cache = cacheWithCanonical([1, 2]);
    cache = applyCellDelta(cache, displayDelta({ enter_ids: [1] }));
    const after = applyCellDelta(cache, { type: 'death', id: 2, at_ms: 5000 });
    expect(after.displayChanges).toBe(NO_DISPLAY_CHANGES);

    const born = applyCellDelta(after, { type: 'birth', cell: cell(3) });
    expect(born.displayChanges).toBe(NO_DISPLAY_CHANGES);
  });

  it('a birth entering the stage in the same batch lists only as entered', () => {
    const staged = applyCellDelta(
      cacheWithCanonical([1]),
      displayDelta({ enter_ids: [1] }),
    );
    const after = applyRevisionedCellDeltas(staged, [
      { revision: 2, delta: { type: 'birth', cell: cell(9) } },
      { revision: 2, delta: displayDelta({ enter_ids: [9] }) },
    ]);

    expect(after.displayChanges.entered).toEqual([9]);
    expect(after.displayChanges.updated).toEqual([]);
  });

  it('death and stage exit of a GCed member collapse inside one batch', () => {
    let cache = cacheWithCanonical([1, 2]);
    cache = applyCellDelta(cache, displayDelta({ enter_ids: [1, 2] }));
    const before = cache;
    const after = applyRevisionedCellDeltas(before, [
      { revision: 5, delta: { type: 'gc', ids: [2] } },
      { revision: 5, delta: displayDelta({ exit_ids: [2] }) },
    ]);

    expect(after.displayChanges.exited).toEqual([2]);
    expect(after.displayChanges.updated).toEqual([]);
    expect(after.displayMembers.has(2)).toBe(false);
  });

  it('enter and exit of the same id in one batch nets to a chained empty journal', () => {
    const before = applyCellDelta(
      cacheWithCanonical([1, 2]),
      displayDelta({ enter_ids: [1] }),
    );
    const after = applyRevisionedCellDeltas(before, [
      { revision: 2, delta: displayDelta({ enter_ids: [2] }) },
      { revision: 3, delta: displayDelta({ exit_ids: [2] }) },
    ]);

    // The maps were copied (token turned over), so the journal must chain
    // even though the net membership change is empty.
    expect(after.displayToken).not.toBe(before.displayToken);
    expect(after.displayChanges).not.toBe(NO_DISPLAY_CHANGES);
    expect(after.displayChanges.baseToken).toBe(before.displayToken);
    expect(after.displayChanges.entered).toEqual([]);
    expect(after.displayChanges.exited).toEqual([]);
  });

  it('chains display journal tokens across consecutive membership batches', () => {
    const first = applyCellDelta(
      cacheWithCanonical([1, 2]),
      displayDelta({ enter_ids: [1] }),
    );
    const second = applyCellDelta(first, displayDelta({ enter_ids: [2] }));
    expect(first.displayChanges.baseToken).not.toBe(null);
    expect(second.displayChanges.baseToken).toBe(first.displayToken);
    expect(second.displayToken).not.toBe(first.displayToken);
  });
});

describe('display provenance transitions', () => {
  it('applies provenance without turning over the display token', () => {
    const before = applyCellDelta(
      cacheWithCanonical([1]),
      displayDelta({ enter_ids: [1] }),
    );
    const after = applyCellDelta(
      before,
      displayDelta({ provenance: composedProvenance }),
    );

    expect(after).not.toBe(before);
    expect(after.displayProvenance).toEqual(composedProvenance);
    expect(after.displayToken).toBe(before.displayToken);
    expect(after.displayChanges).toBe(NO_DISPLAY_CHANGES);
  });

  it('an identical provenance replay is a pure no-op', () => {
    const once = applyCellDelta(
      emptyCellsCache(),
      displayDelta({ provenance: composedProvenance }),
    );
    const replay = applyCellDelta(
      once,
      displayDelta({ provenance: { ...composedProvenance } }),
    );
    expect(replay).toBe(once);
  });

  it('a null provenance rider changes nothing', () => {
    const once = applyCellDelta(
      emptyCellsCache(),
      displayDelta({ provenance: composedProvenance }),
    );
    expect(applyCellDelta(once, displayDelta({ provenance: null }))).toBe(once);
  });
});

describe('snapshot seeding', () => {
  const resident = cell(501, { tag: 'wallet' });

  function snapshotWithDisplay(): CellGalaxySnapshot {
    return {
      cells: [cell(1), cell(2)],
      last_pulse_at_ms: 0,
      display: {
        budget: { cells: 12_000, nerve_edges: 8_000 },
        members: [1, 2, 501],
        residents: [resident],
        provenance: composedProvenance,
      },
    };
  }

  it('seeds members, residents, budget, and provenance from snapshot.display', () => {
    const cache = fromCellsSnapshot(3, snapshotWithDisplay());

    expect([...cache.displayMembers]).toEqual([1, 2, 501]);
    expect(cache.displayResidents.get(501)).toEqual(resident);
    expect(cache.displayBudget).toEqual({ cells: 12_000, nerveEdges: 8_000 });
    expect(cache.displayProvenance).toEqual(composedProvenance);
    expect(cache.displayChanges.reset).toBe(true);
  });

  it('an absent display section leaves the plane empty with null budget', () => {
    const cache = fromCellsSnapshot(3, {
      cells: [cell(1)],
      last_pulse_at_ms: 0,
    });

    expect(cache.displayMembers.size).toBe(0);
    expect(cache.displayResidents.size).toBe(0);
    expect(cache.displayBudget).toBe(null);
    expect(cache.displayProvenance).toBe(null);
    expect(cache.displayChanges.reset).toBe(true);
  });

  it('a resync snapshot reuses content-identical retained resident objects', () => {
    const live = applyCellDelta(
      cacheWithCanonical([1, 2]),
      displayDelta({ enter_ids: [1, 2], enter_cells: [resident] }),
    );
    const retained = live.displayResidents.get(501);
    const resync = fromCellsSnapshot(9, snapshotWithDisplay(), {}, live);

    expect(resync.displayResidents.get(501)).toBe(retained);
    expect(resync.displayChanges.reset).toBe(true);
    expect(resync.displayToken).not.toBe(live.displayToken);
  });

  it('a snapshot replaces live display membership authoritatively', () => {
    const live = applyCellDelta(
      cacheWithCanonical([1]),
      displayDelta({ enter_ids: [1], enter_cells: [cell(600)] }),
    );
    const resync = fromCellsSnapshot(9, snapshotWithDisplay(), {}, live);

    expect(resync.displayMembers.has(600)).toBe(false);
    expect(resync.displayResidents.has(600)).toBe(false);
    expect([...resync.displayMembers]).toEqual([1, 2, 501]);
  });
});
