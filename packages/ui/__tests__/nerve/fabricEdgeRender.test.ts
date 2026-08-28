import { describe, expect, it } from 'vitest';
import {
  fabricEdgeRenderState,
  fabricEdgeRenderStateInto,
  makeEdgeRenderScratch,
  GROWTH_MS,
  DECAY_MS,
  DEATH_RETRACT_MS,
  type EdgeLifecycle,
} from '../../src/nerve/fabricEdgeRender';

const base = { bornAt: 0, dyingAt: null, deathKind: null, deadEnd: null, growDir: 1 as const };

describe('fabricEdgeRenderState growth', () => {
  it('is stable at defaults once grown', () => {
    const r = fabricEdgeRenderState(base, GROWTH_MS / 1000 + 1);
    expect(r).toMatchObject({ visible: true, alphaMul: 1, tStart: 0, tEnd: 1, animating: false });
  });
  it('extends the tip from the from-end while growing (growDir 1)', () => {
    const r = fabricEdgeRenderState(base, GROWTH_MS / 1000 / 2); // p=0.5
    expect(r.tStart).toBe(0);
    expect(r.tEnd).toBeCloseTo(0.5, 3);
    expect(r.animating).toBe(true);
  });
  it('extends from the to-end when growDir is -1', () => {
    const r = fabricEdgeRenderState({ ...base, growDir: -1 }, GROWTH_MS / 1000 / 2);
    expect(r.tEnd).toBe(1);
    expect(r.tStart).toBeCloseTo(0.5, 3);
  });
  it('is not yet visible before a staggered bornAt', () => {
    const r = fabricEdgeRenderState({ ...base, bornAt: 5 }, 4); // now < bornAt
    expect(r.visible).toBe(false);
    expect(r.animating).toBe(true);
  });
});

describe('fabricEdgeRenderState gc fade', () => {
  it('fades alpha with full length, reaps after DECAY_MS', () => {
    const half = fabricEdgeRenderState({ ...base, dyingAt: 0, deathKind: 'gc' }, DECAY_MS / 1000 / 2);
    expect(half.tEnd).toBe(1);
    expect(half.alphaMul).toBeCloseTo(0.5, 2);
    expect(fabricEdgeRenderState({ ...base, dyingAt: 0, deathKind: 'gc' }, DECAY_MS / 1000 + 0.1).reap).toBe(true);
  });
});

describe('fabricEdgeRenderState death retract', () => {
  it('recedes the dead FROM end and flashes, reaps after DEATH_RETRACT_MS', () => {
    const st = { ...base, dyingAt: 0, deathKind: 'death' as const, deadEnd: 'from' as const };
    const mid = fabricEdgeRenderState(st, DEATH_RETRACT_MS / 1000 / 2);
    expect(mid.tStart).toBeCloseTo(0.5, 2); // from-end receded halfway
    expect(mid.tEnd).toBe(1);
    expect(mid.flash).toBeGreaterThan(0);
    expect(fabricEdgeRenderState(st, DEATH_RETRACT_MS / 1000 + 0.1).reap).toBe(true);
  });
  it('recedes the dead TO end', () => {
    const st = { ...base, dyingAt: 0, deathKind: 'death' as const, deadEnd: 'to' as const };
    const mid = fabricEdgeRenderState(st, DEATH_RETRACT_MS / 1000 / 2);
    expect(mid.tStart).toBe(0);
    expect(mid.tEnd).toBeCloseTo(0.5, 2);
  });
});

describe('fabricEdgeRenderStateInto — the warm walk\'s scratch form', () => {
  const lifecycles: EdgeLifecycle[] = [
    base,
    { ...base, growDir: -1 },
    { ...base, bornAt: 5 },
    { ...base, dyingAt: 0, deathKind: 'gc' },
    { ...base, dyingAt: 0, deathKind: 'death', deadEnd: 'from' },
    { ...base, dyingAt: 0, deathKind: 'death', deadEnd: 'to' },
    { ...base, dyingAt: 10, deathKind: 'death', deadEnd: 'from' },
    { ...base, dyingAt: 10, deathKind: 'gc' },
  ];
  const clocks = [
    -1, 0, 0.001, 0.3, GROWTH_MS / 2000, GROWTH_MS / 1000, GROWTH_MS / 1000 + 1,
    DEATH_RETRACT_MS / 2000, DEATH_RETRACT_MS / 1000, DEATH_RETRACT_MS / 1000 + 0.1,
    DECAY_MS / 2000, DECAY_MS / 1000, DECAY_MS / 1000 + 0.1, 4, 9, 11, 60,
  ];

  it('writes exactly what the allocating form returns, into the same object', () => {
    const scratch = makeEdgeRenderScratch();
    for (const st of lifecycles) {
      for (const now of clocks) {
        const fresh = fabricEdgeRenderState(st, now);
        const written = fabricEdgeRenderStateInto(scratch, st, now);
        expect(written).toBe(scratch);
        expect(written).toEqual(fresh);
      }
    }
  });

  it('a reused scratch never carries a previous edge\'s field', () => {
    // Every branch assigns all seven fields: after a flashing retract, a
    // stable edge reads flash 0 and reap false; after a reap, growth reads
    // visible again.
    const scratch = makeEdgeRenderScratch();
    fabricEdgeRenderStateInto(scratch, { ...base, dyingAt: 0, deathKind: 'death', deadEnd: 'from' }, 0.1);
    expect(scratch.flash).toBeGreaterThan(0);
    fabricEdgeRenderStateInto(scratch, base, 5);
    expect(scratch).toEqual({ visible: true, alphaMul: 1, tStart: 0, tEnd: 1, flash: 0, reap: false, animating: false });
    fabricEdgeRenderStateInto(scratch, { ...base, dyingAt: 0, deathKind: 'gc' }, 60);
    expect(scratch.reap).toBe(true);
    expect(scratch.visible).toBe(false);
    fabricEdgeRenderStateInto(scratch, base, GROWTH_MS / 2000);
    expect(scratch.reap).toBe(false);
    expect(scratch.visible).toBe(true);
  });
});

describe('fabricEdgeRenderState future-dated death (defensive decayMs clamp)', () => {
  // A defensively future-dated dyingAt (> nowSec) makes the raw
  // decayMs negative. Unclamped that overdrives the flash
  // (exp(-neg/τ) > 1) and produces a negative/inverted retract
  // interval. The Math.max(0, …) clamp bounds both sub-branches.
  it('bounds a future-dated death edge — no overdriven flash or inverted interval', () => {
    const st = { ...base, dyingAt: 10, deathKind: 'death' as const, deadEnd: 'from' as const };
    const r = fabricEdgeRenderState(st, 9); // nowSec < dyingAt
    expect(r.flash).toBeLessThanOrEqual(1);
    expect(r.tStart).toBeGreaterThanOrEqual(0);
    expect(r.tStart).toBeLessThanOrEqual(1);
    expect(r.tEnd).toBeGreaterThanOrEqual(0);
    expect(r.tEnd).toBeLessThanOrEqual(1);
    expect(r.tEnd).toBeGreaterThanOrEqual(r.tStart);
  });
  it('bounds a future-dated gc edge — alphaMul stays <= 1', () => {
    const st = { ...base, dyingAt: 10, deathKind: 'gc' as const };
    const r = fabricEdgeRenderState(st, 9); // nowSec < dyingAt
    expect(r.alphaMul).toBeLessThanOrEqual(1);
  });
});
