import { beforeEach, describe, expect, it } from 'vitest';

import { resetSimClock, simClock, tickSimClock } from '../../src/tweaks/simClock';

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
});
