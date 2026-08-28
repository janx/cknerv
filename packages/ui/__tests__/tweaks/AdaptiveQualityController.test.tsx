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

/** Windows the controller needs to spend the locked tier on 40 ms frames.
 * 40 ms is past DOWN_FRAME_MS.high from its first window, so this is the
 * doubled 10 s hold in windows, plus the priming frame: the existing tests
 * above pin it between 13 and 18. */
function lockedStepDownWindows(): number {
  render(<AdaptiveQualityController />);
  windowsToLock(16);
  sampleWindows(16, 8);
  const windows = windowsToStepDown(40);
  cleanup();
  setQualityMode('auto');
  setAdaptiveQuality('high');
  return windows;
}

describe('AdaptiveQualityController motion windows', () => {
  it('is unchanged by a motion ref that never fires', () => {
    // Equivalence pin: with the ref present and false, today's behaviour to
    // the window — the flag is the whole difference the tests below measure.
    const bare = lockedStepDownWindows();
    const motionActiveRef = { current: false };
    render(<AdaptiveQualityController motionActiveRef={motionActiveRef} />);
    windowsToLock(16);
    sampleWindows(16, 8);
    expect(windowsToStepDown(40)).toBe(bare);
  });

  it('counts a drag as evidence when nothing flags it (the finding)', () => {
    // Today's behaviour, pinned before the exclusion is exercised: 15 s of
    // 40 ms frames — a hand on the camera at 25 fps — spends the locked
    // tier. Measured live 2026-08-28 as MED -> LOW, kept for the session.
    const motionActiveRef = { current: false };
    render(<AdaptiveQualityController motionActiveRef={motionActiveRef} />);
    windowsToLock(16);
    const switches = getQualityRuntimeSnapshot().switches;

    sampleWindows(40, 20);
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      effective: 'med', locked: true, switches: switches + 1,
    });
  });

  it('drops the same drag from the sample after the lock, and keeps listening', () => {
    const motionActiveRef = { current: false };
    render(<AdaptiveQualityController motionActiveRef={motionActiveRef} />);
    windowsToLock(16);
    const switches = getQualityRuntimeSnapshot().switches;
    const reads = clockReads;

    // The identical 15 s of 40 ms frames, inside a motion window.
    motionActiveRef.current = true;
    sampleWindows(40, 20);
    motionActiveRef.current = false;

    // Skipped exactly as replay is skipped: not sampled, not even clocked.
    expect(clockReads).toBe(reads);
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      effective: 'high', locked: true, switches,
    });

    // Nothing of the drag lingers once the hand lets go: the average never
    // saw a 40 ms window, so at-rest frames carry no evidence forward.
    sampleWindows(16, 8);
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      effective: 'high', locked: true, switches,
    });

    // The sampler is still alive, and on the post-lock hold — not on a
    // re-armed warmup: a replay-style restart would have pushed this past
    // window 17 (see the hydration test above).
    const windows = windowsToStepDown(40);
    expect(windows).toBeGreaterThan(12);
    expect(windows).toBeLessThanOrEqual(18);
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      mode: 'auto', effective: 'med', locked: true, switches: switches + 1,
    });
  });

  it('drops a drag from the sample before the lock, costing calibration nothing', () => {
    const motionActiveRef = { current: false };
    render(<AdaptiveQualityController motionActiveRef={motionActiveRef} />);
    sampleWindows(16, 7); // warmup spent (six samples), no stability yet
    const switches = getQualityRuntimeSnapshot().switches;

    // Unflagged, 40 ms completes the 5 s calibration hold at the seventh
    // window (pinned in adaptiveQuality.test.ts); twelve of them, flagged,
    // move nothing — not the tier, not the lock.
    motionActiveRef.current = true;
    sampleWindows(40, 12);
    motionActiveRef.current = false;
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      effective: 'high', locked: false, switches,
    });

    // Neither stability nor calibration time advanced through the drag: the
    // lock lands on the full 10 s stable window from here, as if the drag had
    // not happened — and at the opening tier.
    const windows = windowsToLock(16);
    expect(windows).toBeGreaterThanOrEqual(Math.floor(10_000 / WINDOW_MS));
    expect(windows).toBeLessThanOrEqual(Math.ceil(10_000 / WINDOW_MS) + 2);
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      effective: 'high', locked: true, switches,
    });
  });

  it('turns repeated short drags into a lost tier only when they are counted', () => {
    // The review machine's shape: 4 s drags at 30 ms with a 1.5 s rest
    // between them. Counted, the 1.5 s average rides each drag over the
    // 22 ms deadband and the rests are too short for the 2x decay to clear
    // it, so evidence compounds across drags until the 10 s hold falls.
    const cycle = (motionActiveRef: { current: boolean }, flagged: boolean) => {
      motionActiveRef.current = flagged;
      sampleWindows(30, 5);
      motionActiveRef.current = false;
      sampleWindows(16, 2);
    };

    const counted = { current: false };
    render(<AdaptiveQualityController motionActiveRef={counted} />);
    windowsToLock(16);
    let switches = getQualityRuntimeSnapshot().switches;
    let cycles = 0;
    while (getQualityRuntimeSnapshot().effective === 'high') {
      cycle(counted, false);
      cycles += 1;
      if (cycles > 8) throw new Error('counted drags never stepped down');
    }
    expect(cycles).toBeLessThanOrEqual(6);
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      effective: 'med', locked: true, switches: switches + 1,
    });
    cleanup();
    setQualityMode('auto');
    setAdaptiveQuality('high');

    // Flagged, the same hand for twice as long moves nothing.
    const flagged = { current: false };
    render(<AdaptiveQualityController motionActiveRef={flagged} />);
    windowsToLock(16);
    switches = getQualityRuntimeSnapshot().switches;
    for (let index = 0; index < 2 * cycles; index += 1) cycle(flagged, true);
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      effective: 'high', locked: true, switches,
    });
  });

  it('leaves the replay restart in place when replay ends inside a drag', () => {
    const hydrationActiveRef = { current: false };
    const motionActiveRef = { current: false };
    render(
      <AdaptiveQualityController
        hydrationActiveRef={hydrationActiveRef}
        motionActiveRef={motionActiveRef}
      />,
    );
    windowsToLock(16);
    const switches = getQualityRuntimeSnapshot().switches;

    hydrationActiveRef.current = true;
    sampleWindows(120, 6);
    // Replay ends while the hand is still on the camera.
    motionActiveRef.current = true;
    hydrationActiveRef.current = false;
    sampleWindows(40, 5);
    motionActiveRef.current = false;
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      effective: 'high', locked: true, switches,
    });

    // The replay rule kept its restart: the re-armed 4 s warmup precedes
    // the doubled hold, so the step lands where the hydration test above
    // puts it, not at the bare post-lock count.
    const windows = windowsToStepDown(40);
    expect(windows).toBeGreaterThan(17);
    expect(windows).toBeLessThanOrEqual(24);
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      effective: 'med', locked: true, switches: switches + 1,
    });
  });
});
