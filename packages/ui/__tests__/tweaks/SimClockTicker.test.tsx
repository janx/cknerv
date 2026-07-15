import { describe, expect, it, vi } from 'vitest';
import { createSimClock, simClock } from '../../src/tweaks/simClock';

const useFrameMock = vi.fn();
const scopeMock = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));

vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: (state: unknown, delta: number) => void, priority?: number) => (
    useFrameMock(cb, priority)
  ),
}));

vi.mock('leva', () => ({
  useControls: () => ({ paused: false, timeScale: 1 }),
}));

vi.mock('../../src/tweaks/SimClockScope', () => ({
  useSimClockScope: () => scopeMock.current,
}));

import SimClockTicker from '../../src/tweaks/SimClockTicker';

describe('SimClockTicker', () => {
  it('ticks an isolated fixed-step scope before ordinary frame consumers', () => {
    const productionElapsed = simClock.elapsedSec;
    const local = createSimClock(0.95);
    const frameDeltaSecRef = { current: -1 };
    scopeMock.current = {
      clock: local,
      paused: false,
      timeScale: 4,
      fixedDeltaSec: 1 / 60,
      maxElapsedSec: 1,
      frameDeltaSecRef,
    };
    useFrameMock.mockClear();
    SimClockTicker();
    expect(useFrameMock.mock.calls[0][1]).toBe(-1000);
    const frame = useFrameMock.mock.calls[0][0];
    frame({}, 0.5);
    expect(local.elapsedSec).toBe(1);
    expect(frameDeltaSecRef.current).toBeCloseTo(0.05);
    expect(simClock.elapsedSec).toBe(productionElapsed);
  });
});
