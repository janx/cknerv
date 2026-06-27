import { describe, it, expect } from 'vitest';
import { reconstructArrivals, beatProfile, drawStripChart } from '../../../src/components/hud/ecgTrace';

describe('reconstructArrivals', () => {
  it('returns [] when there is no last arrival', () => {
    expect(reconstructArrivals([100, 200], null)).toEqual([]);
    expect(reconstructArrivals([], undefined)).toEqual([]);
  });
  it('reverse-cumsums intervals back from the last arrival (ascending)', () => {
    expect(reconstructArrivals([], 1000)).toEqual([1000]);
    expect(reconstructArrivals([100, 200], 1000)).toEqual([700, 800, 1000]);
  });
  it('skips invalid intervals', () => {
    expect(reconstructArrivals([NaN, 200], 1000)).toEqual([800, 1000]);
  });
});

describe('beatProfile', () => {
  it('is zero outside the beat window', () => {
    expect(beatProfile(-1)).toBe(0);
    expect(beatProfile(5)).toBe(0);
  });
  it('peaks at the R deflection', () => {
    expect(beatProfile(0.17)).toBeGreaterThan(0.9);
    expect(beatProfile(0.17)).toBeGreaterThan(beatProfile(0.02));
  });
  it('has a small positive P bump', () => {
    expect(beatProfile(0.02)).toBeGreaterThan(0);
    expect(beatProfile(0.02)).toBeLessThan(0.3);
  });
});

describe('drawStripChart (mock 2D context)', () => {
  function fakeCtx() {
    const calls = { stroke: 0, fillRect: 0 };
    const ctx = {
      calls,
      clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
      stroke() { calls.stroke++; }, fillRect() { calls.fillRect++; },
      setLineDash() {}, createLinearGradient() { return { addColorStop() {} }; },
      lineWidth: 0, strokeStyle: '', fillStyle: '', lineJoin: '', shadowBlur: 0, shadowColor: '',
    };
    return ctx as unknown as CanvasRenderingContext2D & { calls: typeof calls };
  }
  const base = { width: 300, height: 58, color: '#27FF5A' };

  it('terminates and skips the tick loop when targetMs <= 0 (no infinite loop)', () => {
    const ctx = fakeCtx() as ReturnType<typeof fakeCtx>;
    drawStripChart(ctx, { ...base, arrivals: [1000], nowMs: 5000, targetMs: 0, gapMs: 4000 });
    // only grid + trace stroked (no ticks); proves it returned rather than hanging
    expect(ctx.calls.stroke).toBeGreaterThan(0);
    expect(ctx.calls.stroke).toBeLessThan(15);
  });

  it('does not iterate off-screen ticks during a long stall', () => {
    const ctx = fakeCtx() as ReturnType<typeof fakeCtx>;
    const now = 10_000_000;
    drawStripChart(ctx, { ...base, arrivals: [now - 3_600_000], nowMs: now, targetMs: 8000, gapMs: 3_600_000 });
    // a naive loop would stroke ~450 ticks; the windowed seed keeps it to grid + ~span beats + trace
    expect(ctx.calls.stroke).toBeLessThan(40);
  });

  it('draws on-screen target ticks once a beat is overdue', () => {
    const ctx = fakeCtx() as ReturnType<typeof fakeCtx>;
    const now = 1_000_000;
    // gap (12s) exceeds target (8s) -> one expected-beat tick falls inside the window
    drawStripChart(ctx, { ...base, arrivals: [now - 12000], nowMs: now, targetMs: 8000, gapMs: 12000 });
    expect(ctx.calls.stroke).toBeGreaterThan(10); // grid is 10 strokes; tick + trace add more
  });
});
