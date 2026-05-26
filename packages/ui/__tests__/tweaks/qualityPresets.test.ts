import { describe, expect, it } from 'vitest';

import { QUALITY_PRESETS } from '../../src/tweaks/qualityPresets';

describe('QUALITY_PRESETS', () => {
  it('high is full fidelity', () => {
    expect(QUALITY_PRESETS.high).toEqual({
      antialias: true,
      postfx: true,
      starsCount: 1400,
      particleCapMul: 1.0,
      cellGalaxyMul: 1.0,
      canopyVeilMul: 1.0,
      dischargeArms: 3,
    });
  });

  it('med drops postfx and halves stars', () => {
    expect(QUALITY_PRESETS.med.postfx).toBe(false);
    expect(QUALITY_PRESETS.med.starsCount).toBeLessThanOrEqual(700);
    expect(QUALITY_PRESETS.med.particleCapMul).toBe(0.5);
    expect(QUALITY_PRESETS.med.canopyVeilMul).toBe(0.55);
    expect(QUALITY_PRESETS.med.dischargeArms).toBe(2);
  });

  it('low disables AA and postfx, drops counts hard', () => {
    expect(QUALITY_PRESETS.low.antialias).toBe(false);
    expect(QUALITY_PRESETS.low.postfx).toBe(false);
    expect(QUALITY_PRESETS.low.starsCount).toBeLessThanOrEqual(250);
    expect(QUALITY_PRESETS.low.particleCapMul).toBeLessThan(0.5);
    expect(QUALITY_PRESETS.low.canopyVeilMul).toBe(0.35);
    expect(QUALITY_PRESETS.low.dischargeArms).toBe(1);
  });
});
