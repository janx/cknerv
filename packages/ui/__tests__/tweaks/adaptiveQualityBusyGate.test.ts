import { describe, expect, it } from 'vitest';

import {
  ADAPTIVE_SAMPLE_WINDOW_MS,
  BUSY_DOWN_GATE_SHARE,
  advanceAdaptiveQuality,
  createAdaptiveQualityState,
  mainThreadOwnsWindow,
  type AdaptiveQualityState,
} from '../../src/tweaks/adaptiveQuality';
import loadedIdle from '../fixtures/adaptiveQualityLoadedIdle.json';

interface Row {
  atMs: number;
  windowMs: number;
  frames: number;
  meanFrameMs: number;
  maxFrameMs: number;
  stalled: boolean;
  quality: 'low' | 'med' | 'high';
  smoothedFrameMs: number;
  slowEvidenceMs: number;
  locked: boolean;
}

const ROWS = loadedIdle.rows as Row[];

/** The state the page was in when the first recorded window closed. Every row
 * carries the state the controller held BEFORE it weighed that window, which
 * is what makes this a replay rather than a re-simulation. */
function stateAtFirstRow(): AdaptiveQualityState {
  const first = ROWS[0];
  return {
    ...createAdaptiveQualityState(first.quality, 0),
    smoothedFrameMs: first.smoothedFrameMs,
    slowEvidenceMs: first.slowEvidenceMs,
    locked: first.locked,
  };
}

interface Replay {
  /** The tier in force as each row was weighed, row for row. */
  quality: string[];
  /** Row indices at which the tier stepped. */
  switchesAt: number[];
  final: AdaptiveQualityState;
}

/** Walk the recorded windows through the controller's own rule. `busyShare`
 * is the share of each window's wall clock the main thread was busy for;
 * `null` means the reading does not exist, which is the code before the gate. */
function replay(busyShare: number | null): Replay {
  let state = stateAtFirstRow();
  const quality: string[] = [];
  const switchesAt: number[] = [];
  ROWS.forEach((row, index) => {
    quality.push(state.quality);
    // A stalled window is dropped by the controller before it ever reaches
    // the rule, so the replay drops it too.
    if (row.stalled) return;
    const next = advanceAdaptiveQuality(
      state,
      row.meanFrameMs,
      row.windowMs,
      busyShare === null
        ? false
        : mainThreadOwnsWindow(busyShare * row.windowMs, row.windowMs),
    );
    if (next.quality !== state.quality) switchesAt.push(index);
    state = next;
  });
  return { quality, switchesAt, final: state };
}

describe('a window the main thread owns cannot spend a tier', () => {
  it('is a share of the window, not a frame count', () => {
    expect(BUSY_DOWN_GATE_SHARE).toBe(0.6);
    // Strictly past the share: a window exactly at it is still the
    // renderer's, so the rule needs evidence to name the main thread.
    expect(mainThreadOwnsWindow(450, 750)).toBe(false);
    expect(mainThreadOwnsWindow(451, 750)).toBe(true);
    expect(mainThreadOwnsWindow(700, 750)).toBe(true);
    // No reading at all, or a nonsense one, is not a CPU-bound verdict.
    expect(mainThreadOwnsWindow(0, 750)).toBe(false);
    expect(mainThreadOwnsWindow(700, 0)).toBe(false);
    expect(mainThreadOwnsWindow(Number.NaN, 750)).toBe(false);
    expect(mainThreadOwnsWindow(700, Number.NaN)).toBe(false);
  });

  it('replays the loaded idle window exactly as the page walked it', () => {
    // The oracle: 106 real windows off a page with 24 busy loops beside it.
    // Without a busy reading the rule must reproduce the tier the page was
    // actually in, row for row, and the two steps it actually took.
    const before = replay(null);
    expect(before.quality).toEqual(ROWS.map((row) => row.quality));
    expect(before.switchesAt).toEqual([0, 42]);
    expect(before.final.quality).toBe('low');
    expect(before.final.locked).toBe(true);
  });

  it('keeps the tier through the same window once the main thread is measured', () => {
    const after = replay(loadedIdle.busyShare);
    expect(after.switchesAt).toEqual([]);
    expect(after.final.quality).toBe('high');
    // Held, not dropped: the window still ends calibration, and the average
    // still carries what the frames really cost.
    expect(after.final.locked).toBe(true);
    expect(after.final.smoothedFrameMs).toBeCloseTo(replay(null).final.smoothedFrameMs, 6);
    // The evidence stands where the first gated window left it — it did not
    // grow through 70 s of CPU-bound windows, and it was not reset either.
    expect(after.final.slowEvidenceMs).toBe(ROWS[0].slowEvidenceMs);
  });

  it('decides a GPU-bound window exactly as it did before the gate', () => {
    // The same 106 windows with a main thread that is not the limit: 3 ms of
    // busy in a 750 ms window is 0.4 %, and every decision must be identical.
    let state = stateAtFirstRow();
    const gated: string[] = [];
    ROWS.forEach((row) => {
      gated.push(state.quality);
      if (row.stalled) return;
      state = advanceAdaptiveQuality(
        state,
        row.meanFrameMs,
        row.windowMs,
        mainThreadOwnsWindow(3 * row.frames, row.windowMs),
      );
    });
    const before = replay(null);
    expect(gated).toEqual(before.quality);
    expect(state.quality).toBe(before.final.quality);
    expect(state.slowEvidenceMs).toBe(before.final.slowEvidenceMs);
  });

  it('holds the evidence rather than dropping the window', () => {
    // Two windows short of the hold, then one the main thread owned, then one
    // that is the renderer's: the tier goes on the last one, because the
    // gated window neither spent the evidence nor threw it away.
    const slow = 40;
    let state = createAdaptiveQualityState('high', 0);
    for (let index = 0; index < 6; index += 1) {
      state = advanceAdaptiveQuality(state, slow, ADAPTIVE_SAMPLE_WINDOW_MS, false);
    }
    expect(state.quality).toBe('high');
    const evidence = state.slowEvidenceMs;
    expect(evidence).toBeGreaterThan(0);

    const gated = advanceAdaptiveQuality(state, slow, ADAPTIVE_SAMPLE_WINDOW_MS, true);
    expect(gated.quality).toBe('high');
    expect(gated.slowEvidenceMs).toBe(evidence);
    // …and everything but the evidence clock advanced as it would have: the
    // average is still the truth about how long those frames took.
    const ungated = advanceAdaptiveQuality(state, slow, ADAPTIVE_SAMPLE_WINDOW_MS, false);
    expect(gated.smoothedFrameMs).toBe(ungated.smoothedFrameMs);
    // The window still counts as time the tier held, so a page on a busy
    // machine locks the tier it opened at instead of calibrating for ever.
    expect(gated.stableMs).toBe(state.stableMs + ADAPTIVE_SAMPLE_WINDOW_MS);
    expect(gated.calibrationMs).toBe(state.calibrationMs + ADAPTIVE_SAMPLE_WINDOW_MS);

    const spent = advanceAdaptiveQuality(gated, slow, ADAPTIVE_SAMPLE_WINDOW_MS, false);
    expect(spent.quality).toBe('med');
  });

  it('lets a fast window decay the evidence whoever owned the frames', () => {
    let state = createAdaptiveQualityState('high', 0);
    for (let index = 0; index < 4; index += 1) {
      state = advanceAdaptiveQuality(state, 40, ADAPTIVE_SAMPLE_WINDOW_MS, false);
    }
    const evidence = state.slowEvidenceMs;
    expect(evidence).toBeGreaterThan(0);
    // Two fast windows, both CPU-bound. The first is still slow EVIDENCE (the
    // 1.5 s average has not come down yet) and the gate holds it where it
    // stands; the second brings the average under the deadband and the usual
    // double decay runs, gate or no gate — there is nothing to hold back.
    const held = advanceAdaptiveQuality(state, 8, ADAPTIVE_SAMPLE_WINDOW_MS, true);
    expect(held.slowEvidenceMs).toBe(evidence);
    const decayed = advanceAdaptiveQuality(held, 8, ADAPTIVE_SAMPLE_WINDOW_MS, true);
    expect(decayed.slowEvidenceMs).toBeLessThan(evidence);
  });
});
