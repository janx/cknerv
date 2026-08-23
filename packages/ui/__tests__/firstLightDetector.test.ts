// The frame-loop half of the boot record, tested where the frame loop is not:
// R3F callbacks cannot run under jsdom, so the rule lives in a pure detector
// and `BootFrameSentinel` is the three lines that feed it.
import { describe, expect, it } from 'vitest';
import {
  FIRST_LIGHT_MAX_FRAME_SECONDS,
  FIRST_LIGHT_STEADY_FRAMES,
  createFirstLightDetector,
  type FirstLightDetector,
} from '../src/boot/firstLightDetector';

/** Derived from the constants, never restated: a hard-coded 0.0399 stops
 *  meaning "just under" the moment the threshold moves. */
const STEADY = FIRST_LIGHT_MAX_FRAME_SECONDS / 2;
const JUST_UNDER = FIRST_LIGHT_MAX_FRAME_SECONDS - Number.EPSILON;
const SLOW = FIRST_LIGHT_MAX_FRAME_SECONDS * 4;

/** Feed n frames, answering with the latch state after the last one. */
function run(
  detector: FirstLightDetector,
  frames: number,
  deltaSeconds = STEADY,
  populated = true,
): boolean {
  let lit = false;
  for (let i = 0; i < frames; i += 1) {
    lit = detector.frame(deltaSeconds, populated);
  }
  return lit;
}

describe('createFirstLightDetector', () => {
  it('starts dark and lights on the Nth consecutive steady populated frame', () => {
    const detector = createFirstLightDetector();

    expect(detector.lit).toBe(false);
    expect(run(detector, FIRST_LIGHT_STEADY_FRAMES - 1)).toBe(false);
    expect(detector.lit).toBe(false);
    // The frame that completes the run is the one that reports it, so the
    // caller can treat the first `true` as the event.
    expect(detector.frame(STEADY, true)).toBe(true);
    expect(detector.lit).toBe(true);
  });

  it('restarts the run after one slow frame', () => {
    const detector = createFirstLightDetector();

    run(detector, FIRST_LIGHT_STEADY_FRAMES - 1);
    expect(detector.frame(SLOW, true)).toBe(false);
    // A boot that flashed one frame and froze has not lit anything: the whole
    // run has to happen again after the stall.
    expect(run(detector, FIRST_LIGHT_STEADY_FRAMES - 1)).toBe(false);
    expect(detector.frame(STEADY, true)).toBe(true);
  });

  it('restarts the run on an unpopulated frame, however fast', () => {
    const detector = createFirstLightDetector();

    run(detector, FIRST_LIGHT_STEADY_FRAMES - 1);
    // An empty stage renders at any framerate you like; nothing is lit.
    expect(detector.frame(STEADY, false)).toBe(false);
    expect(run(detector, FIRST_LIGHT_STEADY_FRAMES - 1)).toBe(false);
    expect(detector.frame(STEADY, true)).toBe(true);
  });

  it('never lights on an empty stage alone', () => {
    const detector = createFirstLightDetector();

    expect(run(detector, FIRST_LIGHT_STEADY_FRAMES * 4, STEADY, false))
      .toBe(false);
    expect(detector.lit).toBe(false);
  });

  it('never lights on a slow loop alone', () => {
    const detector = createFirstLightDetector();

    expect(run(detector, FIRST_LIGHT_STEADY_FRAMES * 4, SLOW)).toBe(false);
    expect(detector.lit).toBe(false);
  });

  it('holds the threshold exactly: at it is a miss, under it is a hit', () => {
    const atThreshold = createFirstLightDetector();
    expect(
      run(atThreshold, FIRST_LIGHT_STEADY_FRAMES, FIRST_LIGHT_MAX_FRAME_SECONDS),
    ).toBe(false);

    const underThreshold = createFirstLightDetector();
    expect(run(underThreshold, FIRST_LIGHT_STEADY_FRAMES, JUST_UNDER))
      .toBe(true);
  });

  it('treats an unusable delta as a stall, not as an instant frame', () => {
    const detector = createFirstLightDetector();

    run(detector, FIRST_LIGHT_STEADY_FRAMES - 1);
    // A clock that was reset or paused publishes NaN; `NaN < threshold` is
    // false, which is the answer this phase wants.
    expect(detector.frame(Number.NaN, true)).toBe(false);
    expect(run(detector, FIRST_LIGHT_STEADY_FRAMES - 1)).toBe(false);
    expect(detector.frame(STEADY, true)).toBe(true);
  });

  it('stays lit through every later stall and empty frame', () => {
    const detector = createFirstLightDetector();

    run(detector, FIRST_LIGHT_STEADY_FRAMES);
    expect(detector.lit).toBe(true);
    // Frame time is the quality controller's business from here on; first
    // light is a thing that happened, and it does not un-happen.
    expect(detector.frame(SLOW, false)).toBe(true);
    expect(detector.frame(Number.NaN, false)).toBe(true);
    expect(detector.lit).toBe(true);
  });

  it('gives each detector its own run — no module state', () => {
    const first = createFirstLightDetector();
    const second = createFirstLightDetector();

    run(first, FIRST_LIGHT_STEADY_FRAMES);
    expect(first.lit).toBe(true);
    expect(second.lit).toBe(false);
    expect(run(second, FIRST_LIGHT_STEADY_FRAMES - 1)).toBe(false);
  });
});
