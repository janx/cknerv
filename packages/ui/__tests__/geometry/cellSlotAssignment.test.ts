import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  createCellSlotState,
  syncCellSlots,
  type CellSlotState,
} from '../../src/geometry/cellSlotAssignment';

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
    content_hash: `0x${id}`,
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
});
