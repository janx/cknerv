import { describe, expect, it } from 'vitest';
import {
  CONTEXT_DAMP_RATE,
  CONTEXT_DAMP_SNAP,
  dampContextEnergy,
} from '../../src/nerve/contextDamp';

describe('context-energy damper', () => {
  it('eases toward a lowered target without overshoot and releases to baseline', () => {
    const target = 0.46;
    const entering = dampContextEnergy(1, target, 1 / 60);
    const releasing = dampContextEnergy(target, 1, 1 / 60);

    expect(entering).toBeGreaterThan(target);
    expect(entering).toBeLessThan(1);
    expect(releasing).toBeGreaterThan(target);
    expect(releasing).toBeLessThanOrEqual(1);
    expect(dampContextEnergy(target, 1, 0)).toBe(target);
  });

  it('is frame-rate independent: two half steps land where one full step does', () => {
    const target = 0.3;
    const full = dampContextEnergy(1, target, 1 / 30);
    const half = dampContextEnergy(
      dampContextEnergy(1, target, 1 / 60),
      target,
      1 / 60,
    );

    expect(half).toBeCloseTo(full, 6);
  });

  it('snaps exactly onto the target once within the snap threshold', () => {
    const target = 0.5;
    let value = 1;
    for (let step = 0; step < 240; step += 1) {
      value = dampContextEnergy(value, target, 1 / 60);
    }
    expect(value).toBe(target);
    expect(CONTEXT_DAMP_SNAP).toBeGreaterThan(0);
    expect(CONTEXT_DAMP_RATE).toBeGreaterThan(0);
  });

  it('clamps non-finite and out-of-range inputs instead of propagating them', () => {
    expect(dampContextEnergy(Number.NaN, 0.5, 1 / 60)).toBeLessThanOrEqual(1);
    expect(dampContextEnergy(1, Number.NaN, 1 / 60)).toBe(1);
    expect(dampContextEnergy(1, 2, 1 / 60)).toBe(1);
    expect(dampContextEnergy(0.5, 0.5, Number.NaN)).toBe(0.5);
  });
});
