import { describe, expect, it } from 'vitest';
import {
  buildCellNearestIndex,
  cellIdsWithinRadiusFromIndex,
  nearestCellIdsFromIndex,
  sharedCellNearestIndex,
} from '../../src/derives/peers.derive';

function cell(id: number) {
  return {
    id,
    pos_seed: [
      ((id * 37) % 91) - 45,
      0,
      ((id * 53) % 83) - 41,
    ] as [number, number, number],
  };
}

describe('sharedCellNearestIndex incremental maintenance', () => {
  it('chains journals and stays equivalent to a fresh rebuild', () => {
    let seed = 991;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const map = new Map<number, ReturnType<typeof cell>>();
    let nextId = 1;
    let token: object = { boot: true };
    // Seed sync (rebuild path).
    for (let i = 0; i < 400; i += 1) {
      map.set(nextId, cell(nextId));
      nextId += 1;
    }
    let index = sharedCellNearestIndex(token, map);
    for (let round = 0; round < 60; round += 1) {
      const born: number[] = [];
      const removed: number[] = [];
      const births = Math.floor(rand() * 4);
      for (let b = 0; b < births; b += 1) {
        map.set(nextId, cell(nextId));
        born.push(nextId);
        nextId += 1;
      }
      const ids = [...map.keys()];
      const removals = Math.floor(rand() * 3);
      for (let r = 0; r < removals && ids.length > 0; r += 1) {
        // Front-biased like cap eviction.
        const pick = ids[Math.floor(rand() * Math.min(5, ids.length))];
        if (map.delete(pick)) removed.push(pick);
      }
      const baseToken = token;
      token = { round };
      index = sharedCellNearestIndex(token, map, {
        reset: false,
        baseToken,
        born,
        removed,
      });

      const oracle = buildCellNearestIndex(map.values());
      for (let probe = 0; probe < 6; probe += 1) {
        const px = rand() * 90 - 45;
        const pz = rand() * 82 - 41;
        const radius = 4 + rand() * 14;
        const incremental = cellIdsWithinRadiusFromIndex(px, pz, radius, index);
        const fresh = cellIdsWithinRadiusFromIndex(px, pz, radius, oracle);
        // Same membership and same distances; survivor order equals
        // retained-map order on both sides.
        expect(incremental.map((h) => h.id)).toEqual(fresh.map((h) => h.id));
        const near = nearestCellIdsFromIndex([px, pz], 0, index, 5);
        const nearFresh = nearestCellIdsFromIndex([px, pz], 0, oracle, 5);
        expect(new Set(near)).toEqual(new Set(nearFresh));
      }
    }
  });

  it('falls back to a rebuild on a journal gap', () => {
    const map = new Map<number, ReturnType<typeof cell>>();
    for (let i = 1; i <= 50; i += 1) map.set(i, cell(i));
    const first = { a: 1 };
    sharedCellNearestIndex(first, map);
    map.delete(3);
    // Journal chains from an UNKNOWN token → must rebuild, and the removed
    // cell must be gone (a chained sync would have needed the journal).
    const index = sharedCellNearestIndex({ b: 2 }, map, {
      reset: false,
      baseToken: { unrelated: true },
      born: [],
      removed: [3],
    });
    const all = cellIdsWithinRadiusFromIndex(0, 0, 1000, index);
    expect(all.some((h) => h.id === 3)).toBe(false);
    expect(all).toHaveLength(49);
  });
});
