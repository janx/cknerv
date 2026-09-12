import { beforeEach, describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  createCellSlotState,
  syncCellSlots,
  type CellSlotState,
} from '../../src/geometry/cellSlotAssignment';
import {
  resetCellSlotStats,
  snapshotCellSlotStats,
} from '../../src/geometry/cellSlotStats';

function cell(id: number, tag: string | null = null): Cell {
  return {
    id,
    born_at_ms: 1000 + id,
    death_at_ms: null,
    birth_block: 1,
    tag,
    pos_seed: [id, 0, -id],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 100,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: `0x${id}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
  };
}

/** Invariant: slots are dense, complete, and duplicate-free vs the list. */
function expectMirrorsMembership(state: CellSlotState, list: Cell[]): void {
  expect(state.count).toBe(list.length);
  expect(state.cells.length).toBe(list.length);
  const wanted = new Map(list.map((c) => [c.id, c]));
  const seen = new Set<number>();
  for (let slot = 0; slot < state.count; slot += 1) {
    const occupant = state.cells[slot];
    expect(seen.has(occupant.id)).toBe(false);
    seen.add(occupant.id);
    expect(wanted.get(occupant.id)).toBe(occupant);
    expect(state.slotOf.get(occupant.id)).toBe(slot);
  }
}

describe('syncCellSlots', () => {
  it('assigns fresh slots in list order on first sync', () => {
    const state = createCellSlotState();
    const list = [cell(1), cell(2), cell(3)];
    const sync = syncCellSlots(state, list);
    expect(sync.count).toBe(3);
    expect(sync.membershipChanged).toBe(true);
    expect(sync.ranges).toEqual([{ start: 0, count: 3 }]);
    expectMirrorsMembership(state, list);
  });

  it('produces ZERO dirty slots for a pure reorder', () => {
    const state = createCellSlotState();
    const a = [cell(1), cell(2), cell(3), cell(4), cell(5)];
    syncCellSlots(state, a);
    // Head-insertion reshuffle — the exact per-block pattern that used to
    // rewrite the full prefix.
    const reordered = [a[4], a[2], a[0], a[3], a[1]];
    const sync = syncCellSlots(state, reordered);
    expect(sync.ranges).toEqual([]);
    expect(sync.membershipChanged).toBe(false);
    expect(sync.count).toBe(5);
  });

  it('dirties only the replaced slot on an in-place value change', () => {
    const state = createCellSlotState();
    const a = [cell(1), cell(2), cell(3)];
    syncCellSlots(state, a);
    const replaced = { ...a[1], tag: 'dex' };
    const sync = syncCellSlots(state, [a[0], replaced, a[2]]);
    expect(sync.ranges).toEqual([{ start: 1, count: 1 }]);
    expect(sync.membershipChanged).toBe(false);
    expect(state.cells[1]).toBe(replaced);
  });

  it('front removal moves one tail cell instead of shifting the prefix', () => {
    const state = createCellSlotState();
    const a = [cell(1), cell(2), cell(3), cell(4), cell(5)];
    syncCellSlots(state, a);
    const sync = syncCellSlots(state, [a[1], a[2], a[3], a[4]]);
    // Slot 0 (departed cell 1) receives the tail cell; slots 1-3 untouched.
    expect(sync.ranges).toEqual([{ start: 0, count: 1 }]);
    expect(sync.membershipChanged).toBe(true);
    expect(sync.count).toBe(4);
    expect(state.cells[0]).toBe(a[4]);
    expectMirrorsMembership(state, [a[1], a[2], a[3], a[4]]);
  });

  it('fills freed slots with new arrivals before appending', () => {
    const state = createCellSlotState();
    const a = [cell(1), cell(2), cell(3)];
    syncCellSlots(state, a);
    const born = cell(9);
    const sync = syncCellSlots(state, [a[0], a[2], born]);
    // Cell 2's slot (1) is refilled by the newborn — count stays 3.
    expect(sync.count).toBe(3);
    expect(state.cells[1]).toBe(born);
    expect(sync.ranges).toEqual([{ start: 1, count: 1 }]);
    expectMirrorsMembership(state, [a[0], a[2], born]);
  });

  it('handles removal of a trailing run without leaving holes', () => {
    const state = createCellSlotState();
    const a = [cell(1), cell(2), cell(3), cell(4), cell(5)];
    syncCellSlots(state, a);
    const sync = syncCellSlots(state, [a[0], a[1]]);
    expect(sync.count).toBe(2);
    expect(sync.ranges).toEqual([]);
    expectMirrorsMembership(state, [a[0], a[1]]);
  });

  /** The published snapshot is the one copy in this module that cannot be
   *  traded away for a reference. `state.cells` is mutated in place by every
   *  sync, and the screen-space hit index rebuilds on the published array's
   *  identity — so a shared reference would both leak live mutation and
   *  freeze the raycast index against stale contents. */
  it('publishes a copy that turns over exactly when the slots did', () => {
    const state = createCellSlotState();
    const a = [cell(1), cell(2), cell(3)];
    const first = syncCellSlots(state, a).cells;
    expect(first).not.toBe(state.cells);
    expect(first).not.toBe(a);
    expect(first.map(({ id }) => id)).toEqual([1, 2, 3]);

    // A pure reorder moves nothing: the same snapshot stands, so the hit
    // index built on it stays valid.
    expect(syncCellSlots(state, [a[2], a[0], a[1]]).cells).toBe(first);

    // A value replacement moves a slot, so the snapshot has to turn over —
    // and the retired one must still read as it did when it was handed out.
    const replaced = cell(2, 'dex');
    const next = syncCellSlots(state, [a[0], replaced, a[2]]).cells;
    expect(next).not.toBe(first);
    expect(first[1]).toBe(a[1]);
    expect(next[1]).toBe(replaced);

    // And the live slot array keeps moving underneath, which is exactly what
    // the snapshot exists to stand apart from.
    syncCellSlots(state, [a[0]]);
    expect(next).toHaveLength(3);
    expect(state.cells).toHaveLength(1);
  });

  it('mirrors membership exactly through a randomized churn soak', () => {
    let seed = 4242;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const state = createCellSlotState();
    const pool = new Map<number, Cell>();
    // Shadow GPU buffer: updated ONLY through reported dirty ranges. Any
    // content change the ranges fail to cover shows up as a mismatch —
    // exactly the stale-attribute bug class this module must never ship.
    let shadow: (Cell | undefined)[] = [];
    let nextId = 1;
    for (let round = 0; round < 200; round += 1) {
      // Births.
      const births = Math.floor(rand() * 6);
      for (let b = 0; b < births; b += 1) {
        pool.set(nextId, cell(nextId));
        nextId += 1;
      }
      // Removals (front-biased, like cap eviction).
      const ids = [...pool.keys()];
      const removals = Math.floor(rand() * 3);
      for (let r = 0; r < removals && ids.length > 0; r += 1) {
        const pick = rand() < 0.6
          ? ids[Math.floor(rand() * Math.min(4, ids.length))]
          : ids[Math.floor(rand() * ids.length)];
        pool.delete(pick);
      }
      // Value replacement.
      if (pool.size > 0 && rand() < 0.4) {
        const ids2 = [...pool.keys()];
        const pick = ids2[Math.floor(rand() * ids2.length)];
        pool.set(pick, { ...pool.get(pick)!, tag: `t${round}` });
      }
      // Shuffled list order every round.
      const list = [...pool.values()].sort(() => rand() - 0.5);
      const sync = syncCellSlots(state, list);
      expectMirrorsMembership(state, list);
      for (const range of sync.ranges) {
        for (let slot = range.start; slot < range.start + range.count; slot += 1) {
          shadow[slot] = state.cells[slot];
        }
      }
      shadow.length = sync.count;
      for (let slot = 0; slot < sync.count; slot += 1) {
        expect(shadow[slot]).toBe(state.cells[slot]);
      }
      // Dirty ranges must cover every slot whose occupant changed:
      // verified indirectly by the mirror check; also ensure ranges are
      // sorted and non-overlapping.
      let cursor = -1;
      for (const range of sync.ranges) {
        expect(range.start).toBeGreaterThan(cursor);
        expect(range.count).toBeGreaterThan(0);
        cursor = range.start + range.count - 1;
      }
    }
  });

  it('separates a payload replacement from a relocation', () => {
    const state = createCellSlotState();
    const list = [cell(1), cell(2), cell(3)];
    expect(syncCellSlots(state, list).positionsChanged).toBe(true);

    // A tag, a death, an enrichment refresh: a new record in the same place.
    // The slots dirty and upload; nothing that depends on WHERE the drawn
    // cells are has to be recomputed.
    const tagged = [list[0], cell(2, 'dex'), list[2]];
    const payload = syncCellSlots(state, tagged);
    expect(payload.ranges).toEqual([{ start: 1, count: 1 }]);
    expect(payload.membershipChanged).toBe(false);
    expect(payload.positionsChanged).toBe(false);

    // A replacement that carries a different pos_seed IS a relocation, even
    // though the id kept its slot.
    const moved = { ...tagged[1], pos_seed: [9, 9, 9] as [number, number, number] };
    expect(syncCellSlots(state, [tagged[0], moved, tagged[2]]).positionsChanged)
      .toBe(true);

    // And so is a departure, which hands the slot to somebody else.
    const departed = syncCellSlots(state, [tagged[0], tagged[2]]);
    expect(departed.membershipChanged).toBe(true);
    expect(departed.positionsChanged).toBe(true);

    // A sync that changes nothing reports nothing.
    const resting = syncCellSlots(state, [tagged[0], tagged[2]]);
    expect(resting.ranges).toEqual([]);
    expect(resting.positionsChanged).toBe(false);
  });

  it('keeps incremental fallback atomic when a journal is stale', () => {
    const state = createCellSlotState();
    const original = [cell(1), cell(2)];
    syncCellSlots(state, original);
    const published = state.published;
    const replacement = cell(1, 'updated');
    const next = [replacement, original[1]];

    const sync = syncCellSlots(state, next, {
      previousCells: original,
      removedIds: [999],
      upserts: [replacement],
    });

    // Validation fails before the mutable slots are touched, then the
    // canonical path still sees and publishes the payload replacement.
    expect(sync.ranges).toEqual([{ start: 0, count: 1 }]);
    expect(sync.cells).not.toBe(published);
    expect(sync.cells[0]).toBe(replacement);
    expect(published[0]).toBe(original[0]);
  });

  it('removes both an interior and tail slot without leaving reverse-map entries', () => {
    const state = createCellSlotState();
    const original = [cell(1), cell(2), cell(3), cell(4), cell(5)];
    syncCellSlots(state, original);
    const next = [original[0], original[2], original[3]];

    const sync = syncCellSlots(state, next, {
      previousCells: original,
      removedIds: [2, 5],
      upserts: [],
    });

    expect(sync.count).toBe(3);
    expect(state.slotOf.size).toBe(state.count);
    expect(state.slotOf.has(2)).toBe(false);
    expect(state.slotOf.has(5)).toBe(false);
    expectMirrorsMembership(state, next);
  });

  it('keeps safe-integer ids and immutable published snapshots on the incremental path', () => {
    const state = createCellSlotState();
    const high = 2 ** 52;
    const original = [cell(high), cell(high + 1), cell(high + 2)];
    const first = syncCellSlots(state, original).cells;
    const replacement = cell(high + 1, 'wide-id');
    const born = cell(high + 3);
    const next = [original[0], replacement, born];

    const sync = syncCellSlots(state, next, {
      previousCells: original,
      removedIds: [high + 2],
      upserts: [replacement, born],
    });

    expect(sync.cells).not.toBe(first);
    expect(first.map(({ id }) => id)).toEqual([high, high + 1, high + 2]);
    expect(new Set(sync.cells.map(({ id }) => id))).toEqual(
      new Set([high, high + 1, high + 3]),
    );
    expect(state.slotOf.get(high + 3)).toBeDefined();
    expectMirrorsMembership(state, next);
  });
});

// ⭐ WHICH PATH A SYNC TOOK IS NOT VISIBLE FROM OUTSIDE IT. The incremental
// walk touches the ids the journal names; the canonical one walks every drawn
// slot — and they publish the same `CellSlotSync`, so a live session could
// only ever infer which ran from the wall clock. L2-6 / L3-1 measure the gap
// between them (200 gets against 12,400), and this counter is what a live
// window can read it off.
describe('cellSlotStats', () => {
  beforeEach(() => {
    resetCellSlotStats();
  });

  it('separates the journal walk from the whole-list walk', () => {
    const state = createCellSlotState();
    const a = [cell(1), cell(2), cell(3)];
    syncCellSlots(state, a);
    expect(snapshotCellSlotStats().canonical).toBe(1);
    expect(snapshotCellSlotStats().incremental).toBe(0);

    const born = cell(9);
    const next = [a[0], a[2], born];
    syncCellSlots(state, next, {
      previousCells: a,
      removedIds: [2],
      upserts: [born],
    });
    expect(snapshotCellSlotStats().incremental).toBe(1);
    expect(snapshotCellSlotStats().canonical).toBe(1);

    // A hint against a list this state never mirrored is refused, and the
    // canonical walk that answers instead is counted as one.
    const stranger = cell(11);
    syncCellSlots(state, [...next, stranger], {
      previousCells: a,
      removedIds: [],
      upserts: [stranger],
    });
    expect(snapshotCellSlotStats().canonical).toBe(2);
    expect(snapshotCellSlotStats().incremental).toBe(1);
  });

  it('counts the published copies, which is what a sync allocates', () => {
    const state = createCellSlotState();
    const a = [cell(1), cell(2), cell(3)];
    syncCellSlots(state, a);
    expect(snapshotCellSlotStats().publishedCopies).toBe(1);
    // A pure reorder changes no slot, so the published array is the previous
    // one and nothing was copied.
    syncCellSlots(state, [a[2], a[0], a[1]]);
    expect(snapshotCellSlotStats().canonical).toBe(2);
    expect(snapshotCellSlotStats().publishedCopies).toBe(1);
  });

  it('zeroes on reset', () => {
    const state = createCellSlotState();
    syncCellSlots(state, [cell(1)]);
    resetCellSlotStats();
    expect(snapshotCellSlotStats()).toEqual({
      canonical: 0,
      incremental: 0,
      publishedCopies: 0,
    });
  });
});
