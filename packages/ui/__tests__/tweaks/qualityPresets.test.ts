import { describe, expect, it } from 'vitest';
import {
  QUALITY_PRESETS,
  getQualityRuntimeSnapshot,
  setAdaptiveQuality,
  setQualityMode,
  subscribeQualityRuntime,
} from '../../src/tweaks/qualityPresets';

describe('QUALITY_PRESETS', () => {
  it('high preserves the production DPR, stars, particles, and rails', () => {
    expect(QUALITY_PRESETS.high).toEqual({
      maxDpr: 2,
      starsCount: 2000,
      particleCapMul: 1,
      dischargeArms: 3,
      activeSamplesPerHop: 12,
      nucleusNearCap: 12,
      memorySignal: {
        coreMinPx: 24,
        compactLinePx: 0.55,
        energyScale: 1,
        expandedLineScale: 1,
      },
    });
  });

  it('med reduces transient runtime capacity without changing Galaxy membership', () => {
    expect(QUALITY_PRESETS.med.maxDpr).toBe(1.5);
    expect(QUALITY_PRESETS.med.starsCount).toBeLessThanOrEqual(700);
    expect(QUALITY_PRESETS.med.particleCapMul).toBe(0.5);
    expect(QUALITY_PRESETS.med).not.toHaveProperty('cellGalaxyMul');
    expect(QUALITY_PRESETS.med.dischargeArms).toBe(2);
    expect(QUALITY_PRESETS.med.activeSamplesPerHop).toBeGreaterThanOrEqual(10);
    expect(QUALITY_PRESETS.med.nucleusNearCap).toBe(8);
    expect(QUALITY_PRESETS.med.memorySignal).toEqual({
      coreMinPx: 24,
      compactLinePx: 0.62,
      energyScale: 0.94,
      expandedLineScale: 1.06,
    });
  });

  it('low caps DPR at one and drops visual capacity hard', () => {
    expect(QUALITY_PRESETS.low.maxDpr).toBe(1);
    expect(QUALITY_PRESETS.low.starsCount).toBeLessThanOrEqual(250);
    expect(QUALITY_PRESETS.low.particleCapMul).toBeLessThan(0.5);
    expect(QUALITY_PRESETS.low).not.toHaveProperty('cellGalaxyMul');
    expect(QUALITY_PRESETS.low.dischargeArms).toBe(1);
    expect(QUALITY_PRESETS.low.activeSamplesPerHop).toBeGreaterThanOrEqual(8);
    expect(QUALITY_PRESETS.low.nucleusNearCap).toBe(4);
    expect(QUALITY_PRESETS.low.memorySignal).toEqual({
      coreMinPx: 24,
      compactLinePx: 0.72,
      energyScale: 0.86,
      expandedLineScale: 1.15,
    });
  });

  it('never sheds memory semantics when the renderer reduces ambience', () => {
    const signals = Object.values(QUALITY_PRESETS).map(
      (preset) => preset.memorySignal,
    );

    expect(new Set(signals.map((signal) => signal.coreMinPx))).toEqual(
      new Set([24]),
    );
    expect(signals[2].compactLinePx).toBeGreaterThan(signals[1].compactLinePx);
    expect(signals[1].compactLinePx).toBeGreaterThan(signals[0].compactLinePx);
    expect(signals[2].energyScale).toBeLessThan(signals[0].energyScale);
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
