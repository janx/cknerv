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
    data_bytes: 0,
    content_hash: '0x' + '00'.repeat(32),
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

/** Since snapshots carry the stage rather than the retained map, a client
 *  mid-session has never seen most of the map — so the server ships a record
 *  with every enter, and these are the members whose records arrive here and
 *  nowhere else. */
describe('display delta — records for members the canonical lane never sent', () => {
  /** A cell older than this session: not in the snapshot, no birth delta,
   *  staged today because a transaction spent it. */
  const elder = cell(4242);

  it('an enter for a cell the cache never held resolves through the display lane', () => {
    const cache = applyCellDelta(
      cacheWithCanonical([1]),
      displayDelta({ enter_cells: [elder] }),
    );

    expect(cache.displayMembers.has(elder.id)).toBe(true);
    expect(resolveDisplayCell(cache, elder.id)).toBe(elder);
    expect(cache.displayChanges.entered).toEqual([elder.id]);
  });

  it('a later death reaches that record instead of no-oping', () => {
    const staged = applyCellDelta(
      cacheWithCanonical([1]),
      displayDelta({ enter_cells: [elder] }),
    );
    const after = applyCellDelta(staged, {
      type: 'death',
      id: elder.id,
      at_ms: 9_000,
    });

    // The corpse is what the stage is holding it for: a record frozen at the
    // moment it arrived would render alive until the next resync.
    expect(resolveDisplayCell(after, elder.id)?.death_at_ms).toBe(9_000);
    expect(after.displayChanges.updated).toEqual([elder.id]);
    expect(after.cells).toBe(staged.cells);
    // Replaying the same death is still a pure no-op.
    expect(applyCellDelta(after, { type: 'death', id: elder.id, at_ms: 9_000 }))
      .toBe(after);
  });

  it('a later tag reaches that record too', () => {
    const staged = applyCellDelta(
      emptyCellsCache(),
      displayDelta({ enter_cells: [elder] }),
    );
    const after = applyCellDelta(staged, {
      type: 'tag',
      id: elder.id,
      tag: 'dex',
    });

    expect(resolveDisplayCell(after, elder.id)?.tag).toBe('dex');
    expect(applyCellDelta(after, { type: 'tag', id: elder.id, tag: 'dex' }))
      .toBe(after);
  });

  it('a re-enter after an exit lands the record again', () => {
    const staged = applyCellDelta(
      emptyCellsCache(),
      displayDelta({ enter_cells: [elder] }),
    );
    const gone = applyCellDelta(staged, displayDelta({ exit_ids: [elder.id] }));
    expect(resolveDisplayCell(gone, elder.id)).toBeUndefined();

    const again = applyCellDelta(gone, displayDelta({ enter_cells: [elder] }));
    expect(again.displayMembers.has(elder.id)).toBe(true);
    expect(resolveDisplayCell(again, elder.id)).toBe(elder);
  });

  it('a record the cache already holds canonically is not stored twice', () => {
    // The common case: a birth entering the stage in the batch that bore it.
    const born = cell(9);
    const after = applyRevisionedCellDeltas(cacheWithCanonical([1]), [
      { revision: 2, delta: { type: 'birth', cell: born } },
      { revision: 2, delta: displayDelta({ enter_cells: [{ ...born }] }) },
    ]);

    expect(after.displayMembers.has(9)).toBe(true);
    expect(after.displayResidents.size).toBe(0);
    expect(resolveDisplayCell(after, 9)).toBe(after.cells.get(9));
    expect(after.displayChanges.entered).toEqual([9]);
    expect(after.displayChanges.updated).toEqual([]);
  });

  it('a bare id still stages, for a stream from a server that predates I3', () => {
    const cache = applyCellDelta(
      cacheWithCanonical([1]),
      displayDelta({ enter_ids: [1, 77] }),
    );

    expect([...cache.displayMembers]).toEqual([1, 77]);
    // Nothing was ever sent for 77; the render set drops it, loudly.
    expect(resolveDisplayCell(cache, 77)).toBeUndefined();
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

// The 12K member Set and the ~10K resident Map are copied behind separate
// owned flags, so a write that touches one does not defensively copy the other.
describe('the display copy is split: members and residents copy independently', () => {
  const RESIDENT = 9_007_199_254_000_001;

  // A cache staged with canonical members (2, 3) AND a resident payload
  // (RESIDENT), so each map's identity is a live signal for "was this copied
  // this batch". Id 1 is a canonical cell but NOT yet a member, so a fresh
  // members-only enter has something to add.
  function staged(): CellGalaxyCache {
    let cache = cacheWithCanonical([1, 2, 3]);
    cache = applyCellDelta(
      cache,
      displayDelta({
        enter_cells: [cell(2), cell(3), cell(RESIDENT)],
        enter_ids: [RESIDENT],
      }),
    );
    return cache;
  }

  it('a canonical-member enter copies the Set alone', () => {
    const before = staged();
    // cell(1) is canonical, identical, and not yet a member → a pure add.
    const after = applyCellDelta(
      before,
      displayDelta({ enter_cells: [cell(1)] }),
    );

    expect(after.displayMembers).not.toBe(before.displayMembers); // Set copied
    expect(after.displayResidents).toBe(before.displayResidents); // Map NOT copied
    expect(after.displayMembers.has(1)).toBe(true);
    expect(after.displayToken).not.toBe(before.displayToken); // still one turnover
  });

  it('a resident payload update copies the Map alone', () => {
    const before = staged();
    // Re-ship the already-staged resident with a changed payload: a resident
    // write on a member, so members are untouched.
    const after = applyCellDelta(
      before,
      displayDelta({ enter_cells: [cell(RESIDENT, { tag: 'dex' })] }),
    );

    expect(after.displayResidents).not.toBe(before.displayResidents); // Map copied
    expect(after.displayMembers).toBe(before.displayMembers); // Set NOT copied
    expect(after.displayResidents.get(RESIDENT)?.tag).toBe('dex');
    expect(after.displayToken).not.toBe(before.displayToken);
  });

  it('a canonical-member exit copies the Set alone', () => {
    const before = staged();
    // Id 2 is a canonical member, never a resident → the Set alone changes.
    const after = applyCellDelta(before, displayDelta({ exit_ids: [2] }));

    expect(after.displayMembers).not.toBe(before.displayMembers); // Set copied
    expect(after.displayResidents).toBe(before.displayResidents); // Map NOT copied
    expect(after.displayMembers.has(2)).toBe(false);
    expect(after.displayResidents.has(RESIDENT)).toBe(true);
  });

  it('a resident exit copies the Map (and the Set, which it also leaves)', () => {
    const before = staged();
    const after = applyCellDelta(before, displayDelta({ exit_ids: [RESIDENT] }));

    expect(after.displayResidents).not.toBe(before.displayResidents);
    expect(after.displayMembers).not.toBe(before.displayMembers);
    expect(after.displayResidents.has(RESIDENT)).toBe(false);
    expect(after.displayMembers.has(RESIDENT)).toBe(false);
  });

  it('leaves both prev maps untouched (purity)', () => {
    const before = staged();
    const membersBefore = [...before.displayMembers];
    const residentsBefore = [...before.displayResidents.keys()];
    applyCellDelta(before, displayDelta({ enter_cells: [cell(1)] }));
    applyCellDelta(before, displayDelta({ exit_ids: [RESIDENT] }));
    expect([...before.displayMembers]).toEqual(membersBefore);
    expect([...before.displayResidents.keys()]).toEqual(residentsBefore);
  });
});

// One trim of each bounded link list per batch, at finalize — not a front
// splice on every append. The end state (most-recent window, ring order) is
// identical to the per-append trim it replaces.
function linkDelta(txHash: string, block: number): CellDelta {
  return {
    type: 'link',
    tx_hash: txHash,
    block,
    from_ids: [],
    to_ids: [block],
    endpoint_anchors: [],
    parents: [],
    tag: null,
    at_ms: block * 1000,
  };
}

describe('bounded link lists trim once per batch, not per append', () => {
  it('keeps exactly the capacity most-recent links after a batch of appends', () => {
    const deltas = Array.from({ length: 10 }, (_, i) => ({
      revision: i + 1,
      delta: linkDelta(`0x${i + 1}`, i + 1),
    }));
    const after = applyRevisionedCellDeltas(emptyCellsCache(), deltas, {
      recentLinksCapacity: 3,
      linkRingCapacity: 3,
    });

    expect(after.recentLinks.length).toBe(3);
    expect(after.pulseLinks.length).toBe(3);
    // The window is the last three, in arrival order.
    expect(after.recentLinks.map((l) => l.block)).toEqual([8, 9, 10]);
    expect(after.pulseLinks.map((l) => l.block)).toEqual([8, 9, 10]);
  });

  it('trims a single-delta append too', () => {
    let cache = emptyCellsCache();
    for (let block = 1; block <= 5; block += 1) {
      cache = applyCellDelta(cache, linkDelta(`0x${block}`, block), {
        recentLinksCapacity: 2,
        linkRingCapacity: 2,
      });
    }
    expect(cache.recentLinks.map((l) => l.block)).toEqual([4, 5]);
    expect(cache.pulseLinks.map((l) => l.block)).toEqual([4, 5]);
  });
});
