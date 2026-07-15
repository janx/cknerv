import { describe, expect, it } from 'vitest';
import {
  QUALITY_PRESETS,
  getQualityRuntimeSnapshot,
  setAdaptiveQuality,
  setQualityMode,
  subscribeQualityRuntime,
} from '../../src/tweaks/qualityPresets';

describe('QUALITY_PRESETS', () => {
  it('high preserves the production DPR, stars, particles, cells, and rails', () => {
    expect(QUALITY_PRESETS.high).toEqual({
      maxDpr: 2,
      starsCount: 2000,
      particleCapMul: 1,
      cellGalaxyMul: 1,
      dischargeArms: 3,
      fabricSamplesPerEdge: 4,
      activeSamplesPerHop: 12,
      nucleusNearCap: 12,
    });
  });

  it('med reduces every scalable runtime capacity without collapsing the field', () => {
    expect(QUALITY_PRESETS.med.maxDpr).toBe(1.5);
    expect(QUALITY_PRESETS.med.starsCount).toBeLessThanOrEqual(700);
    expect(QUALITY_PRESETS.med.particleCapMul).toBe(0.5);
    expect(QUALITY_PRESETS.med.cellGalaxyMul).toBeGreaterThan(0.5);
    expect(QUALITY_PRESETS.med.dischargeArms).toBe(2);
    expect(QUALITY_PRESETS.med.fabricSamplesPerEdge).toBe(2);
    expect(QUALITY_PRESETS.med.activeSamplesPerHop).toBeGreaterThanOrEqual(10);
    expect(QUALITY_PRESETS.med.nucleusNearCap).toBe(8);
  });

  it('low caps DPR at one and drops visual capacity hard', () => {
    expect(QUALITY_PRESETS.low.maxDpr).toBe(1);
    expect(QUALITY_PRESETS.low.starsCount).toBeLessThanOrEqual(250);
    expect(QUALITY_PRESETS.low.particleCapMul).toBeLessThan(0.5);
    expect(QUALITY_PRESETS.low.cellGalaxyMul).toBeLessThan(0.5);
    expect(QUALITY_PRESETS.low.dischargeArms).toBe(1);
    expect(QUALITY_PRESETS.low.fabricSamplesPerEdge).toBe(1);
    // Protocol writes retain most of their curvature budget while passive
    // fabric collapses to one segment: semantic signal wins over ambience.
    expect(QUALITY_PRESETS.low.activeSamplesPerHop).toBeGreaterThanOrEqual(8);
    expect(QUALITY_PRESETS.low.nucleusNearCap).toBe(4);
  });
});

describe('quality runtime ownership', () => {
  it('manual mode wins immediately and blocks stale adaptive writes', () => {
    let notifications = 0;
    const unsubscribe = subscribeQualityRuntime(() => { notifications += 1; });

    setQualityMode('low');
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      mode: 'low', effective: 'low', source: 'manual',
    });
    setAdaptiveQuality('high');
    expect(getQualityRuntimeSnapshot().effective).toBe('low');

    setQualityMode('auto');
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      mode: 'auto', effective: 'low', source: 'adaptive',
    });
    setAdaptiveQuality('med');
    expect(getQualityRuntimeSnapshot().effective).toBe('med');
    expect(notifications).toBeGreaterThanOrEqual(3);

    unsubscribe();
    // Restore module state for tests that mount production components later.
    setAdaptiveQuality('high');
  });
});
