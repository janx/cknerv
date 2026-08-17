import { describe, expect, it } from 'vitest';

import {
  createPopulationBloomPool,
  membershipBatchIsCut,
  populationBloomLife,
  populationBloomStats,
  spawnMembershipBlooms,
  spawnPopulationBloom,
} from '../../src/geometry/populationFieldBlooms';

const DURATION = 1.4;

function positionsAt(id: number): readonly [number, number, number] {
  return [id, id * 2, id * 3];
}

describe('populationBloomPool', () => {
  it('starts with every slot dead rather than at the origin', () => {
    const pool = createPopulationBloomPool(4);

    for (let slot = 0; slot < pool.capacity; slot += 1) {
      expect(populationBloomLife(pool, slot, 0, DURATION)).toBeLessThan(0);
    }
    expect(populationBloomStats(pool, 0, DURATION).live).toBe(0);
  });

  it('ages a bloom from zero to one and then out', () => {
    const pool = createPopulationBloomPool(4);
    spawnPopulationBloom(pool, 1, 2, 3, 1, 10, DURATION);

    expect(populationBloomLife(pool, 0, 10, DURATION)).toBeCloseTo(0, 6);
    expect(populationBloomLife(pool, 0, 10 + DURATION / 2, DURATION))
      .toBeCloseTo(0.5, 6);
    expect(populationBloomLife(pool, 0, 10 + DURATION, DURATION))
      .toBeCloseTo(1, 6);
    expect(populationBloomStats(pool, 10 + DURATION, DURATION).live).toBe(0);
  });

  it('allocates around a ring without ever growing', () => {
    const pool = createPopulationBloomPool(3);
    const before = pool.positions.byteLength;

    for (let i = 0; i < 10; i += 1) {
      spawnPopulationBloom(pool, i, i, i, 1, i * 10, DURATION);
    }

    expect(pool.positions.byteLength).toBe(before);
    expect(pool.spawned).toBe(10);
    // Every spawn was spaced past the duration, so nothing live was ever
    // overwritten.
    expect(pool.clamped).toBe(0);
  });

  it('counts an overwrite of a still-live bloom without hiding it', () => {
    const pool = createPopulationBloomPool(2);
    spawnPopulationBloom(pool, 0, 0, 0, 1, 0, DURATION);
    spawnPopulationBloom(pool, 1, 1, 1, 1, 0, DURATION);

    // The ring is full of live blooms; the next spawn has to take one.
    spawnPopulationBloom(pool, 2, 2, 2, 1, 0.1, DURATION);

    expect(pool.clamped).toBe(1);
    expect(populationBloomStats(pool, 0.1, DURATION).clamped).toBe(1);
  });
});

describe('spawnMembershipBlooms', () => {
  const base = {
    changeCount: 2,
    coalesced: false,
    resolveEntry: positionsAt,
    resolveExit: positionsAt,
    nowSec: 5,
    durationSec: DURATION,
  };

  it('marks both directions of an ordinary rotation of the stage', () => {
    const pool = createPopulationBloomPool(8);

    const landed = spawnMembershipBlooms(pool, {
      ...base,
      entered: [1],
      exited: [2],
    });

    expect(landed).toBe(2);
    expect(populationBloomStats(pool, 5, DURATION).live).toBe(2);
    // Exit first, entry second: a dissolve and a condense are different
    // marks, and the kinds must not be swapped.
    expect(pool.kind[0]).toBe(-1);
    expect(pool.kind[1]).toBe(1);
  });

  it('places each bloom at the transitioning Cell it belongs to', () => {
    const pool = createPopulationBloomPool(8);

    spawnMembershipBlooms(pool, { ...base, entered: [7], exited: [], changeCount: 1 });

    expect([pool.positions[0], pool.positions[1], pool.positions[2]])
      .toEqual([7, 14, 21]);
  });

  it('declines a transition it cannot place', () => {
    const pool = createPopulationBloomPool(8);

    const landed = spawnMembershipBlooms(pool, {
      ...base,
      entered: [1],
      exited: [2],
      resolveEntry: () => null,
      resolveExit: () => null,
    });

    expect(landed).toBe(0);
    expect(pool.spawned).toBe(0);
  });

  it('drops a whole coalesced batch rather than marking part of it', () => {
    const pool = createPopulationBloomPool(8);

    const landed = spawnMembershipBlooms(pool, {
      ...base,
      entered: [1, 2],
      exited: [3],
      changeCount: 3,
      coalesced: true,
    });

    expect(landed).toBe(0);
    expect(pool.spawned).toBe(0);
    // Suppression is visible on the dev counter, not silent.
    expect(pool.suppressed).toBe(3);
  });

  it('reads a wholesale resettle as a cut, by its size alone', () => {
    const pool = createPopulationBloomPool(8);
    const many = Array.from({ length: pool.capacity + 1 }, (_, i) => i + 1);

    const landed = spawnMembershipBlooms(pool, {
      ...base,
      entered: many,
      exited: [],
      changeCount: many.length,
    });

    expect(landed).toBe(0);
    expect(pool.suppressed).toBe(many.length);
  });

  it('still marks a batch exactly at the churn boundary', () => {
    const pool = createPopulationBloomPool(8);
    const many = Array.from({ length: pool.capacity }, (_, i) => i + 1);

    const landed = spawnMembershipBlooms(pool, {
      ...base,
      entered: many,
      exited: [],
      changeCount: many.length,
    });

    expect(landed).toBe(pool.capacity);
    expect(pool.suppressed).toBe(0);
  });

  it('never lets a batch wrap the ring and eat its own dissolves', () => {
    // Exits are written before entries. A threshold above the ring size would
    // let the entries of one batch overwrite the exits of that same batch, and
    // the boundary would read as one-way condensation — Cells arriving out of
    // the medium and never returning to it.
    const pool = createPopulationBloomPool(8);
    const exits = [1, 2, 3, 4, 5];
    const entries = [6, 7, 8, 9, 10];

    spawnMembershipBlooms(pool, {
      ...base,
      entered: entries,
      exited: exits,
      changeCount: exits.length + entries.length,
    });

    expect(pool.clamped).toBe(0);
    const kinds = Array.from(pool.kind.slice(0, pool.capacity));
    expect(kinds.filter((kind) => kind === -1)).toHaveLength(0);
    // 10 changes into an 8-slot ring is a cut, so nothing lands at all —
    // rather than 5 condenses and 3 surviving dissolves.
    expect(pool.spawned).toBe(0);
  });

  it('marks both directions evenly for a batch the ring can hold', () => {
    const pool = createPopulationBloomPool(8);

    spawnMembershipBlooms(pool, {
      ...base,
      entered: [10, 11, 12],
      exited: [1, 2, 3],
      changeCount: 6,
    });

    const kinds = Array.from(pool.kind.slice(0, 6));
    expect(kinds.filter((kind) => kind === -1)).toHaveLength(3);
    expect(kinds.filter((kind) => kind === 1)).toHaveLength(3);
    expect(pool.clamped).toBe(0);
  });

  it('exposes the cut rule directly', () => {
    const pool = createPopulationBloomPool(8);
    expect(membershipBatchIsCut(pool, 8)).toBe(false);
    expect(membershipBatchIsCut(pool, 9)).toBe(true);
  });

  it('counts nothing as suppressed when nothing changed', () => {
    const pool = createPopulationBloomPool(8);

    spawnMembershipBlooms(pool, {
      ...base,
      entered: [],
      exited: [],
      changeCount: 0,
      coalesced: true,
    });

    expect(pool.suppressed).toBe(0);
  });
});
