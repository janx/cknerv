import { describe, it, expect } from 'vitest';
import {
  computeRuntimeStats, fpsColor, fmtCompact,
  setStats, getStatsSnapshot, subscribeStats, ZERO_STATS,
  type RenderInfoLike,
} from '../../src/tweaks/renderStatsStore';

const info: RenderInfoLike = {
  render: { calls: 300, triangles: 90000 },
  memory: { geometries: 50, textures: 20 },
  programs: { length: 10 },
};

describe('computeRuntimeStats', () => {
  it('per-frame averages + instantaneous memory/program counts', () => {
    const s = computeRuntimeStats(15, 250, info);
    expect(s.fps).toBeCloseTo(60);
    expect(s.msPerFrame).toBeCloseTo(250 / 15);
    expect(s.drawCalls).toBe(20);   // 300/15
    expect(s.triangles).toBe(6000); // 90000/15
    expect(s.geometries).toBe(50);
    expect(s.textures).toBe(20);
    expect(s.programs).toBe(10);
  });
  it('guards frames=0 / elapsed=0 (no NaN/Infinity)', () => {
    const s = computeRuntimeStats(0, 0, info);
    expect(s.fps).toBe(0);
    expect(s.msPerFrame).toBe(0);
    expect(s.drawCalls).toBe(0);
    expect(s.triangles).toBe(0);
  });
  it('programs defaults to 0 when null', () => {
    expect(computeRuntimeStats(1, 16, { ...info, programs: null }).programs).toBe(0);
  });
});

describe('fpsColor', () => {
  it('green 55+, amber 30-54, red below 30', () => {
    expect(fpsColor(60)).toBe('#86efac');
    expect(fpsColor(45)).toBe('#fbbf24');
    expect(fpsColor(20)).toBe('#f87171');
  });
});

describe('fmtCompact', () => {
  it('formats <1k / k / M and guards negatives', () => {
    expect(fmtCompact(300)).toBe('300');
    expect(fmtCompact(6000)).toBe('6.0k');
    expect(fmtCompact(90000)).toBe('90.0k');
    expect(fmtCompact(150000)).toBe('150k');
    expect(fmtCompact(2_500_000)).toBe('2.5M');
    expect(fmtCompact(-1)).toBe('—');
  });
});

describe('stats store', () => {
  it('setStats swaps the snapshot ref + notifies; getSnapshot stable until next setStats; unsub stops notifications', () => {
    const before = getStatsSnapshot();
    let notified = 0;
    const unsub = subscribeStats(() => { notified += 1; });
    const next = computeRuntimeStats(15, 250, info);
    setStats(next);
    expect(notified).toBe(1);
    expect(getStatsSnapshot()).toBe(next);       // new ref
    expect(getStatsSnapshot()).toBe(next);       // stable between updates
    expect(getStatsSnapshot()).not.toBe(before);
    unsub();
    setStats(ZERO_STATS);
    expect(notified).toBe(1);                    // no notify after unsub
  });
});
