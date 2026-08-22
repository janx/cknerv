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

/** Windows of the given frame time until the published tier changes. */
function windowsToStepDown(frameMs: number, max = 60): number {
  const before = getQualityRuntimeSnapshot().effective;
  for (let count = 1; count <= max; count += 1) {
    sampleWindow(frameMs);
    if (getQualityRuntimeSnapshot().effective !== before) return count;
  }
  throw new Error('the controller never stepped down');
}

describe('AdaptiveQualityController', () => {
  it('locks the opening tier and keeps sampling for the page\'s life', () => {
    render(<AdaptiveQualityController />);

    const windows = windowsToLock(16);
    const switches = getQualityRuntimeSnapshot().switches;
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      mode: 'auto', effective: 'high', locked: true,
    });
    // Warmup (4 s) plus the 10 s stable window, and nothing beyond it: two
    // windows of slack for the priming frame that opens the first one.
    expect(windows).toBeGreaterThanOrEqual(Math.floor(14_000 / WINDOW_MS));
    expect(windows).toBeLessThanOrEqual(Math.ceil(14_000 / WINDOW_MS) + 2);

    // The lock ends calibration, not measurement: the clock is still read
    // every frame. What a fast page gets for it is nothing — there is no
    // way back up to reach for.
    const reads = clockReads;
    sampleWindows(16, 4);
    expect(clockReads).toBeGreaterThan(reads);
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      effective: 'high', locked: true, switches,
    });
  });

  it('steps the locked tier down when the page slows for good', () => {
    render(<AdaptiveQualityController />);
    windowsToLock(16);
    const switches = getQualityRuntimeSnapshot().switches;

    sampleWindows(16, 8);
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      effective: 'high', locked: true, switches,
    });

    // 40 ms is past DOWN_FRAME_MS.high from the first window, so the doubled
    // 10 s hold lands the step around window 14 — published once, one tier.
    const windows = windowsToStepDown(40);
    expect(windows).toBeGreaterThan(12);
    expect(windows).toBeLessThanOrEqual(18);
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      mode: 'auto', effective: 'med', locked: true, switches: switches + 1,
    });
  });

  it('re-arms warmup when replay finishes after the lock, keeping the lock', () => {
    const hydrationActiveRef = { current: false };
    render(<AdaptiveQualityController hydrationActiveRef={hydrationActiveRef} />);
    windowsToLock(16);
    const switches = getQualityRuntimeSnapshot().switches;

    hydrationActiveRef.current = true;
    sampleWindows(120, 6);
    hydrationActiveRef.current = false;

    // A catch-up storm is not renderer evidence at any point in a page's
    // life: frames rendered under replay move nothing by themselves.
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      effective: 'high', locked: true, switches,
    });

    // The restart that follows re-arms the 4 s warmup (~6 windows) and keeps
    // the lock, so the first real downshift after it still owes the doubled
    // 10 s hold (~14 more). A restart that dropped the lock would have spent
    // the tier at the single hold, around window 14.
    const windows = windowsToStepDown(40);
    expect(windows).toBeGreaterThan(17);
    expect(windows).toBeLessThanOrEqual(24);
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      effective: 'med', locked: true, switches: switches + 1,
    });
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
