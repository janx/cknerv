import { beforeEach, describe, expect, it } from 'vitest';

import {
  createSimClock,
  resetSimClock,
  simClock,
  tickSimClock,
} from '../../src/tweaks/simClock';

describe('simClock', () => {
  beforeEach(() => {
    resetSimClock();
  });

  it('starts at elapsedSec = 0', () => {
    expect(simClock.elapsedSec).toBe(0);
  });

  it('advances by rawDelta * timeScale per tick', () => {
    tickSimClock(0.016, 1);
    expect(simClock.elapsedSec).toBeCloseTo(0.016);
    tickSimClock(0.016, 0.5);
    expect(simClock.elapsedSec).toBeCloseTo(0.024);
  });

  it('skips advance entirely when paused (timeScale 0)', () => {
    tickSimClock(0.016, 1);
    tickSimClock(0.5, 0);
    tickSimClock(0.016, 1);
    expect(simClock.elapsedSec).toBeCloseTo(0.032);
  });

  it('reset returns to 0', () => {
    tickSimClock(10, 1);
    expect(simClock.elapsedSec).toBeCloseTo(10);
    resetSimClock();
    expect(simClock.elapsedSec).toBe(0);
  });

  it('advances and resets an isolated clock without touching production time', () => {
    tickSimClock(2, 1);
    const local = createSimClock(4);
    expect(tickSimClock(0.5, 2, local)).toBe(1);
    expect(local.elapsedSec).toBe(5);
    expect(simClock.elapsedSec).toBe(2);
    resetSimClock(local, 1.25);
    expect(local.elapsedSec).toBe(1.25);
    expect(simClock.elapsedSec).toBe(2);
  });

  it('returns the exact final remainder when bounded by a review target', () => {
    const local = createSimClock(0.95);
    expect(tickSimClock(1 / 60, 4, local, 1)).toBeCloseTo(0.05);
    expect(local.elapsedSec).toBe(1);
    expect(tickSimClock(1 / 60, 4, local, 1)).toBe(0);
  });
});
