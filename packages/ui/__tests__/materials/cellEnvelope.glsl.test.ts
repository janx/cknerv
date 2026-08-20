// Shape lock for the two chain-lifecycle curves.
//
// The GLSL in `BIRTH_DEATH_GLSL` is what the screen actually runs; the TS
// functions are a structural mirror of it, kept line for line so a reviewer
// can diff the two blocks in one file. No test can compare them across the
// language boundary — so these assertions pin the mirror to the GESTURE
// (emerge, spring, settle · hold, cool, crumble) instead of to its numbers.
// A curve edit that keeps the shape passes; one that turns either gesture
// back into a pop does not.

import { describe, expect, it } from 'vitest';
import {
  BIRTH_DEATH_GLSL,
  BIRTH_OVERSHOOT_AT,
  BIRTH_OVERSHOOT_GAIN,
  birthEase,
  DEATH_SCALE_KNEE,
  deathEase,
  deathScale,
} from '../../src/materials/cellEnvelope.glsl';

const STEPS = 2000;
const ramp = (i: number): number => i / STEPS;

describe('birthEase', () => {
  it('leaves no residue at either end of the ramp', () => {
    // An unborn cell and a settled cell are both exact: the curve may not
    // park a newborn at 0.999 of its resting size forever.
    expect(birthEase(0)).toBe(0);
    expect(birthEase(1)).toBe(1);
  });

  it('spends its first half emerging, not expanding', () => {
    expect(birthEase(0.2)).toBeLessThan(0.05);
    // Sub-linear through the midpoint: most of the growth is still to come.
    expect(birthEase(0.5)).toBeLessThan(0.5);
    expect(birthEase(0.6)).toBeLessThan(0.7);
  });

  it('springs past resting size exactly once, late in the ramp', () => {
    let peak = -Infinity;
    let peakAt = -1;
    for (let i = 0; i <= STEPS; i += 1) {
      const value = birthEase(ramp(i));
      if (value > peak) {
        peak = value;
        peakAt = ramp(i);
      }
    }

    expect(peak).toBeCloseTo(1 + BIRTH_OVERSHOOT_GAIN, 6);
    expect(peakAt).toBe(BIRTH_OVERSHOOT_AT);
    // Late enough to read as a spring, early enough to leave settle room.
    expect(peakAt).toBeGreaterThanOrEqual(0.6);
    expect(peakAt).toBeLessThanOrEqual(0.95);

    const rose: number[] = [];
    const fell: number[] = [];
    for (let i = 1; i <= STEPS; i += 1) {
      const previous = birthEase(ramp(i - 1));
      const current = birthEase(ramp(i));
      if (ramp(i) <= peakAt) {
        if (current < previous) rose.push(ramp(i));
      } else if (current > previous) {
        fell.push(ramp(i));
      }
    }
    // One peak means one direction change: monotone up to it, down after.
    expect(rose).toEqual([]);
    expect(fell).toEqual([]);
  });

  it('never inverts the sprite and never blows past the overshoot', () => {
    const out: number[] = [];
    for (let i = 0; i <= STEPS; i += 1) {
      const value = birthEase(ramp(i));
      if (value < 0 || value > 1 + BIRTH_OVERSHOOT_GAIN) out.push(ramp(i));
    }
    expect(out).toEqual([]);
  });
});

describe('deathScale', () => {
  it('holds full size through the cooling phase', () => {
    // Exactly 1, not nearly: the corpse cools and gutters at the size it
    // died with. Anything less here is a deflating balloon.
    for (let i = 0; ramp(i) <= DEATH_SCALE_KNEE; i += 1) {
      expect(deathScale(ramp(i))).toBe(1);
    }
    expect(deathEase(DEATH_SCALE_KNEE)).toBe(0);
  });

  it('weights the whole loss into the tail of the ramp', () => {
    // Past the knee the collapse is still gentle — 60% of the window gone
    // and the body has surrendered under a tenth of itself.
    expect(deathScale(0.6)).toBeGreaterThan(0.9);
    expect(deathScale(0.8)).toBeLessThan(0.5);
  });

  it('crumbles monotonically to exactly nothing', () => {
    const rose: number[] = [];
    const negative: number[] = [];
    for (let i = 1; i <= STEPS; i += 1) {
      const current = deathScale(ramp(i));
      if (current > deathScale(ramp(i - 1))) rose.push(ramp(i));
      if (current < 0) negative.push(ramp(i));
    }
    expect(rose).toEqual([]);
    expect(negative).toEqual([]);
    expect(deathScale(1)).toBe(0);
  });
});

describe('BIRTH_DEATH_GLSL', () => {
  it('runs the same curve the mirror computes, from the same constants', () => {
    expect(BIRTH_DEATH_GLSL).toContain(
      `float t = r / ${BIRTH_OVERSHOOT_AT.toFixed(2)};`,
    );
    expect(BIRTH_DEATH_GLSL).toContain(
      'float grow = smoothstep(0.0, 1.0, t * t);',
    );
    expect(BIRTH_DEATH_GLSL).toContain(
      `float settle = smoothstep(${BIRTH_OVERSHOOT_AT.toFixed(2)}, 1.0, r);`,
    );
    expect(BIRTH_DEATH_GLSL).toContain(
      `return grow + ${BIRTH_OVERSHOOT_GAIN.toFixed(2)} * (grow - settle);`,
    );
    expect(BIRTH_DEATH_GLSL).toContain(
      `float crumble = smoothstep(${DEATH_SCALE_KNEE.toFixed(1)}, 1.0, r);`,
    );
    expect(BIRTH_DEATH_GLSL).toContain('return crumble * crumble;');
  });

  it('has retired the two one-line pops it replaced', () => {
    expect(BIRTH_DEATH_GLSL).not.toContain('pow(1.0 - r, 3.0)');
    expect(BIRTH_DEATH_GLSL).not.toContain('pow(r, 3.0)');
  });
});
