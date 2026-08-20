import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useFrameMock = vi.fn();

vi.mock('@react-three/fiber', () => ({
  useFrame: (cb: () => void) => useFrameMock(cb),
}));

vi.mock('leva', () => ({
  useControls: () => ({ quality: 'auto' }),
}));

import AdaptiveQualityController from '../../src/tweaks/AdaptiveQualityController';
import { ADAPTIVE_SAMPLE_WINDOW_MS } from '../../src/tweaks/adaptiveQuality';
import {
  getQualityRuntimeSnapshot,
  setAdaptiveQuality,
  setQualityMode,
} from '../../src/tweaks/qualityPresets';

const WINDOW_MS = ADAPTIVE_SAMPLE_WINDOW_MS + 1;

let now = 0;
let clockReads = 0;

beforeEach(() => {
  now = 1_000;
  clockReads = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => {
    clockReads += 1;
    return now;
  });
  setQualityMode('auto');
  setAdaptiveQuality('high');
  useFrameMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function frame(): void {
  const calls = useFrameMock.mock.calls;
  (calls[calls.length - 1][0] as () => void)();
}

/** One sampling window's worth of frames at the given average frame time. */
function sampleWindow(frameMs: number): void {
  const count = Math.max(1, Math.round(WINDOW_MS / frameMs));
  for (let index = 0; index < count; index += 1) {
    now += WINDOW_MS / count;
    frame();
  }
}

function sampleWindows(frameMs: number, count: number): void {
  for (let index = 0; index < count; index += 1) sampleWindow(frameMs);
}

/** Windows the controller needs to lock: warmup, then the stable window. */
function windowsToLock(frameMs: number, max = 60): number {
  for (let count = 1; count <= max; count += 1) {
    sampleWindow(frameMs);
    if (getQualityRuntimeSnapshot().locked) return count;
  }
  throw new Error('the controller never locked');
}

describe('AdaptiveQualityController', () => {
  it('locks the opening tier and then stops reading the clock', () => {
    render(<AdaptiveQualityController />);

    const windows = windowsToLock(16);
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      mode: 'auto', effective: 'high', locked: true,
    });
    // Warmup (4 s) plus the 10 s stable window, and nothing beyond it: two
    // windows of slack for the priming frame that opens the first one.
    expect(windows).toBeGreaterThanOrEqual(Math.floor(14_000 / WINDOW_MS));
    expect(windows).toBeLessThanOrEqual(Math.ceil(14_000 / WINDOW_MS) + 2);

    const reads = clockReads;
    sampleWindows(16, 4);
    expect(clockReads).toBe(reads);
  });

  it('does not reopen calibration when replay finishes after the lock', () => {
    const hydrationActiveRef = { current: false };
    render(<AdaptiveQualityController hydrationActiveRef={hydrationActiveRef} />);
    windowsToLock(16);
    const switches = getQualityRuntimeSnapshot().switches;
    const reads = clockReads;

    hydrationActiveRef.current = true;
    sampleWindows(120, 6);
    hydrationActiveRef.current = false;
    sampleWindows(120, 30);

    // Locked until reload: a catch-up storm heavy enough to downshift twice
    // during calibration cannot move the tier or restart the sampler.
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      effective: 'high', locked: true, switches,
    });
    expect(clockReads).toBe(reads);
  });

  it('restarts calibration when replay finishes before the lock', () => {
    const hydrationActiveRef = { current: false };
    render(<AdaptiveQualityController hydrationActiveRef={hydrationActiveRef} />);
    sampleWindows(16, 10); // past warmup, part-way through the stable window

    hydrationActiveRef.current = true;
    frame();
    hydrationActiveRef.current = false;
    frame(); // the restart frame itself only rearms the warmup

    sampleWindows(16, 12);
    expect(getQualityRuntimeSnapshot().locked).toBe(false);
    sampleWindows(16, 10);
    expect(getQualityRuntimeSnapshot().locked).toBe(true);
  });
});
