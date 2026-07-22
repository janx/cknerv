import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS } from '../../src/tweaks/qualityPresets';
import {
  pointSpriteDeviceViewportHeight,
  resolvePointSpritePixelRatio,
} from '../../src/materials/pointSpritePresentation';

describe('point sprite presentation', () => {
  it('preserves CSS-space size across every quality DPR', () => {
    const cssHeight = 900;
    for (const preset of Object.values(QUALITY_PRESETS)) {
      const deviceHeight = pointSpriteDeviceViewportHeight(
        cssHeight,
        preset.maxDpr,
      );
      expect(deviceHeight / preset.maxDpr).toBe(cssHeight);
    }
  });

  it('sanitizes unusable renderer readings', () => {
    expect(resolvePointSpritePixelRatio(Number.NaN)).toBe(1);
    expect(resolvePointSpritePixelRatio(0)).toBe(1);
    expect(pointSpriteDeviceViewportHeight(Number.NaN, 2)).toBe(2);
  });
});
