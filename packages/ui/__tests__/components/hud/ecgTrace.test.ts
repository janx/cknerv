import { describe, it, expect } from 'vitest';
import { reconstructArrivals, beatProfile, drawStripChart, windowMax, alignedFracs } from '../../../src/components/hud/ecgTrace';

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

describe('windowMax', () => {
  it('returns the max with a floor of 1', () => {
    expect(windowMax([100, 500, 200])).toBe(500);
    expect(windowMax([])).toBe(1);
    expect(windowMax([0, 0])).toBe(1);
    expect(windowMax([NaN, 300])).toBe(300);
  });
});

describe('alignedFracs', () => {
  it('aligns newest-first and normalizes by window max', () => {
    // sizes/txCounts newest LAST; result newest FIRST
    const r = alignedFracs([100, 200, 400], [1, 5, 10], 3);
    expect(r[0]).toEqual({ sizeFrac: 1, txFrac: 1 });            // newest: 400/400, 10/10
    expect(r[1].sizeFrac).toBeCloseTo(0.5);                       // 200/400
    expect(r[2].sizeFrac).toBeCloseTo(0.25);                      // 100/400
  });
  it('defaults to 0.5 when arrays are shorter than nBeats', () => {
    const r = alignedFracs([400], [10], 3);
    expect(r[0]).toEqual({ sizeFrac: 1, txFrac: 1 });
    expect(r[1]).toEqual({ sizeFrac: 0.5, txFrac: 0.5 });
    expect(r[2]).toEqual({ sizeFrac: 0.5, txFrac: 0.5 });
  });
});

describe('drawStripChart (mock 2D context)', () => {
  function fakeCtx() {
    const calls = { stroke: 0, fillRect: 0, ys: [] as number[] };
    const ctx = {
      calls,
      clearRect() {}, beginPath() {},
      moveTo(_x: number, y: number) { calls.ys.push(y); },
      lineTo(_x: number, y: number) { calls.ys.push(y); },
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

  it('plots only finite, on-canvas y-coords through the divergent size/tx scaling path', () => {
    const ctx = fakeCtx() as ReturnType<typeof fakeCtx>;
    const now = 1_000_000;
    const lastTs = now - 2000;
    // four beats on-screen (8s apart in a 64s window); three carry real, wildly
    // divergent size/tx (incl. a 0 tx and a 50k-byte block) so the scaling math is
    // exercised — the mock's lineTo is a no-op, so without this a NaN y (which would
    // silently blank the real trace) would go uncaught.
    const arrivals = reconstructArrivals([8000, 8000, 8000], lastTs);
    drawStripChart(ctx, {
      ...base,
      arrivals,
      nowMs: now,
      targetMs: 8000,
      gapMs: now - lastTs,
      sizes: [200, 50_000, 1000],
      txCounts: [0, 250, 12],
    });
    expect(ctx.calls.ys.length).toBeGreaterThan(10); // grid + trace plotted
    for (const y of ctx.calls.ys) {
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(base.height);
    }
  });
});
