import { describe, expect, it } from 'vitest';
import {
  AUTO_STARTUP_LOW_BUFFER_PIXELS,
  AUTO_STARTUP_MED_BUFFER_PIXELS,
  hasQuerySwitch,
  resolveAutoStartupQuality,
  resolveCanvasDpr,
  resolveQualityOverride,
  resolveStartupAntialias,
  shouldApplyAutoStartupQuality,
} from '../src/render-quality';

describe('render quality route helpers', () => {
  it('enables review switches only for an explicit one', () => {
    expect(hasQuerySwitch('?render-stats=1', 'render-stats')).toBe(true);
    expect(hasQuerySwitch('?adaptive-quality=1', 'adaptive-quality')).toBe(true);
    expect(hasQuerySwitch('?adaptive-quality=0', 'adaptive-quality')).toBe(false);
    expect(hasQuerySwitch('', 'adaptive-quality')).toBe(false);
  });

  it('caps high-density displays at the effective quality DPR', () => {
    expect(resolveCanvasDpr(3, 2)).toBe(2);
    expect(resolveCanvasDpr(3, 1.5)).toBe(1.5);
    expect(resolveCanvasDpr(3, 1)).toBe(1);
  });

  it('normalizes invalid and sub-one browser DPR readings', () => {
    expect(resolveCanvasDpr(Number.NaN, 2)).toBe(1);
    expect(resolveCanvasDpr(0.75, 2)).toBe(1);
  });

  it('starts AUTO below high when the opening drawing buffer is already large', () => {
    expect(resolveAutoStartupQuality(1440, 900, 1, 2)).toBe('high');
    expect(resolveAutoStartupQuality(3840, 2160, 1, 2)).toBe('med');
    expect(resolveAutoStartupQuality(1920, 1080, 2, 2)).toBe('med');
    expect(resolveAutoStartupQuality(3840, 2160, 2, 2)).toBe('low');
  });

  it('uses the High DPR ceiling and explicit pixel boundaries', () => {
    expect(resolveAutoStartupQuality(
      AUTO_STARTUP_MED_BUFFER_PIXELS, 1, 1, 2,
    )).toBe('med');
    expect(resolveAutoStartupQuality(
      AUTO_STARTUP_LOW_BUFFER_PIXELS, 1, 1, 2,
    )).toBe('low');
    // A browser DPR above High's own ceiling must not exaggerate the load.
    expect(resolveAutoStartupQuality(1_000, 1_000, 8, 2)).toBe('high');
  });

  it('keeps the deterministic high default when viewport geometry is unusable', () => {
    expect(resolveAutoStartupQuality(0, 900, 1, 2)).toBe('high');
    expect(resolveAutoStartupQuality(Number.NaN, 900, 1, 2)).toBe('high');
  });

  it('leaves MSAA on below the med startup class and off at or above it', () => {
    // On for a HIGH-class buffer (< 8 MP), where the hard edges it helps are
    // cheap to resolve.
    expect(resolveStartupAntialias(1440, 900, 1, 2)).toBe(true);
    expect(resolveStartupAntialias(1920, 1080, 1, 2)).toBe(true);
    // Off for a buffer that opens at MED or LOW (>= 8 MP), where the per-frame
    // resolve is the deadline maker and the DPR lever is already inert.
    expect(resolveStartupAntialias(3840, 2160, 1, 2)).toBe(false); // 4K@1x -> med
    expect(resolveStartupAntialias(1920, 1080, 2, 2)).toBe(false); // 1080p@2x -> med
    expect(resolveStartupAntialias(3840, 2160, 2, 2)).toBe(false); // 4K@2x -> low
  });

  it('puts the antialias boundary exactly on the med pixel class', () => {
    // Exactly 8 MP is the med class -> MSAA off; a pixel under it is high -> on.
    expect(resolveStartupAntialias(
      AUTO_STARTUP_MED_BUFFER_PIXELS, 1, 1, 2,
    )).toBe(false);
    expect(resolveStartupAntialias(
      AUTO_STARTUP_MED_BUFFER_PIXELS - 1, 1, 1, 2,
    )).toBe(true);
    // A browser DPR above High's own ceiling must not exaggerate the load.
    expect(resolveStartupAntialias(1_000, 1_000, 8, 2)).toBe(true);
    // Unusable geometry falls back to the safe HIGH default: AA stays on.
    expect(resolveStartupAntialias(0, 900, 1, 2)).toBe(true);
    expect(resolveStartupAntialias(Number.NaN, 900, 1, 2)).toBe(true);
  });

  it('does not silently adapt deterministic review Labs', () => {
    expect(shouldApplyAutoStartupQuality(false, '')).toBe(true);
    expect(shouldApplyAutoStartupQuality(true, '')).toBe(false);
    expect(shouldApplyAutoStartupQuality(
      true,
      '?adaptive-quality=1',
    )).toBe(true);
    expect(shouldApplyAutoStartupQuality(
      true,
      '?adaptive-quality=0',
    )).toBe(false);
  });

  it('accepts only explicit deterministic quality overrides', () => {
    expect(resolveQualityOverride('?quality=high')).toBe('high');
    expect(resolveQualityOverride('?quality=med')).toBe('med');
    expect(resolveQualityOverride('?quality=low')).toBe('low');
    expect(resolveQualityOverride('?quality=auto')).toBeNull();
    expect(resolveQualityOverride('?quality=')).toBeNull();
  });
});
