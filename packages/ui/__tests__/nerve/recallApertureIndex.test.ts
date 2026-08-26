import { describe, expect, it } from 'vitest';
import {
  RECALL_APERTURE_INDEX_MAX_BUCKETS_PER_ENTRY,
  RecallApertureIndex,
  quadraticCurveXZBounds,
  type RecallApertureCurveXZ,
  type RecallApertureQueryBounds,
} from '../../src/nerve/recallApertureIndex';

function slotsFor(
  index: RecallApertureIndex,
  bounds: RecallApertureQueryBounds,
): number[] {
  return index.query(bounds).map((entry) => entry.slot).sort((a, b) => a - b);
}

function bruteOverlaps(
  curve: RecallApertureCurveXZ,
  query: RecallApertureQueryBounds,
): boolean {
  const minX = Math.min(curve.fromX, curve.ctrlX, curve.toX);
  const maxX = Math.max(curve.fromX, curve.ctrlX, curve.toX);
  const minZ = Math.min(curve.fromZ, curve.ctrlZ, curve.toZ);
  const maxZ = Math.max(curve.fromZ, curve.ctrlZ, curve.toZ);
  return maxX >= query.minX && minX <= query.maxX
    && maxZ >= query.minZ && minZ <= query.maxZ;
}

/** Stable deterministic pseudo-random values without test-runner seeding. */
function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe('RecallApertureIndex', () => {
  it('uses the quadratic control hull as a conservative XZ bound', () => {
    expect(quadraticCurveXZBounds({
      fromX: -8,
      fromZ: 5,
      ctrlX: 30,
      ctrlZ: -20,
      toX: 7,
      toZ: 12,
    })).toEqual({ minX: -8, maxX: 30, minZ: -20, maxZ: 12 });
    expect(quadraticCurveXZBounds({
      fromX: 0,
      fromZ: 0,
      ctrlX: Number.NaN,
      ctrlZ: 1,
      toX: 2,
      toZ: 2,
    })).toBeNull();
  });

  it('includes curves that only touch a query boundary', () => {
    const index = new RecallApertureIndex(10);
    index.upsert(3, 'touch-x', {
      fromX: -5, fromZ: 0,
      ctrlX: 0, ctrlZ: 2,
      toX: 5, toZ: 0,
    });
    index.upsert(7, 'outside', {
      fromX: 5.001, fromZ: 0,
      ctrlX: 8, ctrlZ: 2,
      toX: 10, toZ: 0,
    });

    expect(slotsFor(index, {
      minX: 5, maxX: 5,
      minZ: -1, maxZ: 1,
    })).toEqual([3]);
  });

  it('removes reaped keys and replaces recycled slot ownership', () => {
    const index = new RecallApertureIndex(8);
    index.upsert(4, 'old', {
      fromX: -20, fromZ: -20,
      ctrlX: -18, ctrlZ: -18,
      toX: -16, toZ: -16,
    });
    expect(index.removeKey('old')?.slot).toBe(4);
    expect(index.size).toBe(0);

    index.upsert(4, 'new', {
      fromX: 40, fromZ: 40,
      ctrlX: 42, ctrlZ: 42,
      toX: 44, toZ: 44,
    });
    expect(slotsFor(index, {
      minX: -25, maxX: -10,
      minZ: -25, maxZ: -10,
    })).toEqual([]);
    expect(slotsFor(index, {
      minX: 39, maxX: 45,
      minZ: 39, maxZ: 45,
    })).toEqual([4]);

    // Invalid replacement geometry must not leave the recycled edge indexed
    // under its previous bounds.
    expect(index.upsert(4, 'invalid', {
      fromX: Number.NaN, fromZ: 0,
      ctrlX: 0, ctrlZ: 0,
      toX: 1, toZ: 1,
    })).toBe(false);
    expect(index.size).toBe(0);
  });

  it('matches a brute-force conservative-box oracle across random curves', () => {
    const random = randomSource(0xc0ffee);
    const index = new RecallApertureIndex(17);
    const curves: RecallApertureCurveXZ[] = [];
    for (let slot = 0; slot < 750; slot += 1) {
      const fromX = random() * 800 - 400;
      const fromZ = random() * 800 - 400;
      const curve: RecallApertureCurveXZ = {
        fromX,
        fromZ,
        ctrlX: fromX + random() * 100 - 50,
        ctrlZ: fromZ + random() * 100 - 50,
        toX: fromX + random() * 100 - 50,
        toZ: fromZ + random() * 100 - 50,
      };
      curves.push(curve);
      expect(index.upsert(slot, `edge-${slot}`, curve)).toBe(true);
    }

    const reused: ReturnType<RecallApertureIndex['query']> = [];
    for (let queryIndex = 0; queryIndex < 120; queryIndex += 1) {
      const centerX = random() * 900 - 450;
      const centerZ = random() * 900 - 450;
      const halfWidth = random() * 60;
      const halfHeight = random() * 60;
      const bounds: RecallApertureQueryBounds = {
        minX: centerX - halfWidth,
        maxX: centerX + halfWidth,
        minZ: centerZ - halfHeight,
        maxZ: centerZ + halfHeight,
      };
      const expected: number[] = [];
      for (let slot = 0; slot < curves.length; slot += 1) {
        if (bruteOverlaps(curves[slot], bounds)) expected.push(slot);
      }
      const actual = index.query(bounds, reused)
        .map((entry) => entry.slot)
        .sort((a, b) => a - b);
      expect(actual, `query ${queryIndex}`).toEqual(expected);
    }
  });

  it('clears a reused output for empty and invalid queries', () => {
    const index = new RecallApertureIndex();
    const out = [{ slot: 99, key: 'stale', bounds: {
      minX: 0, maxX: 0, minZ: 0, maxZ: 0,
    } }];
    expect(index.query(null, out)).toBe(out);
    expect(out).toEqual([]);
    out.push({ slot: 99, key: 'stale', bounds: {
      minX: 0, maxX: 0, minZ: 0, maxZ: 0,
    } });
    index.query({ minX: 1, maxX: -1, minZ: 0, maxZ: 1 }, out);
    expect(out).toEqual([]);
  });

  it('handles finite coordinates whose bucket integer cannot advance', () => {
    const index = new RecallApertureIndex(1);
    const stuck = 2 ** 53;
    expect(stuck + 1).toBe(stuck);
    expect(index.upsert(8, 'unsafe-grid-integer', {
      fromX: stuck, fromZ: stuck,
      ctrlX: stuck, ctrlZ: stuck,
      toX: stuck, toZ: stuck,
    })).toBe(true);

    expect(slotsFor(index, {
      minX: stuck, maxX: stuck,
      minZ: stuck, maxZ: stuck,
    })).toEqual([8]);
    expect(slotsFor(index, {
      minX: -1, maxX: 1,
      minZ: -1, maxZ: 1,
    })).toEqual([]);
  });

  it('never loses normal buckets to an unsafe extreme query range', () => {
    const index = new RecallApertureIndex(10);
    index.upsert(1, 'ordinary', {
      fromX: -2, fromZ: -3,
      ctrlX: 0, ctrlZ: 4,
      toX: 5, toZ: 1,
    });
    index.upsert(2, 'max-finite', {
      fromX: Number.MAX_VALUE, fromZ: Number.MAX_VALUE,
      ctrlX: Number.MAX_VALUE, ctrlZ: Number.MAX_VALUE,
      toX: Number.MAX_VALUE, toZ: Number.MAX_VALUE,
    });

    expect(slotsFor(index, {
      minX: -Number.MAX_VALUE,
      maxX: Number.MAX_VALUE,
      minZ: -Number.MAX_VALUE,
      maxZ: Number.MAX_VALUE,
    })).toEqual([1, 2]);
  });

  it('keeps an over-limit hull in the bounded exact-overlap fallback', () => {
    const index = new RecallApertureIndex(1);
    const far = RECALL_APERTURE_INDEX_MAX_BUCKETS_PER_ENTRY * 100;
    expect(index.upsert(12, 'long-hull', {
      fromX: 0, fromZ: 0,
      ctrlX: far / 2, ctrlZ: 0,
      toX: far, toZ: 0,
    })).toBe(true);

    expect(slotsFor(index, {
      minX: far - 0.5, maxX: far + 0.5,
      minZ: -0.5, maxZ: 0.5,
    })).toEqual([12]);
    expect(slotsFor(index, {
      minX: far + 1, maxX: far + 2,
      minZ: -0.5, maxZ: 0.5,
    })).toEqual([]);
  });

  it('keeps fallback ownership synchronized through recycle, remove and clear', () => {
    const index = new RecallApertureIndex(1);
    const far = RECALL_APERTURE_INDEX_MAX_BUCKETS_PER_ENTRY + 10;
    index.upsert(5, 'fallback-old', {
      fromX: 0, fromZ: 0,
      ctrlX: far / 2, ctrlZ: 0,
      toX: far, toZ: 0,
    });
    index.upsert(5, 'bucketed-new', {
      fromX: 20, fromZ: 20,
      ctrlX: 21, ctrlZ: 21,
      toX: 22, toZ: 22,
    });
    expect(slotsFor(index, {
      minX: 0, maxX: 1,
      minZ: -1, maxZ: 1,
    })).toEqual([]);
    expect(slotsFor(index, {
      minX: 19, maxX: 23,
      minZ: 19, maxZ: 23,
    })).toEqual([5]);

    index.upsert(9, 'same-key', {
      fromX: 30, fromZ: 30,
      ctrlX: 31, ctrlZ: 31,
      toX: 32, toZ: 32,
    });
    index.upsert(11, 'same-key', {
      fromX: -far, fromZ: 0,
      ctrlX: 0, ctrlZ: 0,
      toX: far, toZ: 0,
    });
    expect(index.get(9)).toBeUndefined();
    expect(index.removeKey('same-key')?.slot).toBe(11);
    expect(index.removeKey('bucketed-new')?.slot).toBe(5);
    expect(index.size).toBe(0);

    index.upsert(3, 'clear-fallback', {
      fromX: -far, fromZ: 0,
      ctrlX: 0, ctrlZ: 0,
      toX: far, toZ: 0,
    });
    index.clear();
    expect(index.size).toBe(0);
    expect(slotsFor(index, {
      minX: -far, maxX: far,
      minZ: -1, maxZ: 1,
    })).toEqual([]);
    expect(index.upsert(3, 'clear-fallback', {
      fromX: 1, fromZ: 1,
      ctrlX: 2, ctrlZ: 2,
      toX: 3, toZ: 3,
    })).toBe(true);
  });
});
