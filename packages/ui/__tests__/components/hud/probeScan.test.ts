import { describe, it, expect } from 'vitest';
import { probeScan, PROBE_STEP_S } from '../../../src/components/hud/probeScan';

describe('probeScan', () => {
  const N = 6;
  // The step length is the panel's ONE speed dial: the interval's stop
  // timeout, the enrichment stages and every content gate are written as
  // multiples of it, so pinning it here pins the whole reveal's pace.
  it('walks a landmark in 300ms — six of them inside two seconds', () => {
    expect(PROBE_STEP_S).toBe(0.30);
    expect(PROBE_STEP_S * N * 1000).toBeCloseTo(1800, 6);
    // Enrichment adds two steps after the lattice locks; the panel stops its
    // clock one tick later, so the whole open sequence fits under 2.5s.
    expect((N + 2) * PROBE_STEP_S * 1000 + 80).toBeCloseTo(2480, 6);
  });
  it('keeps the travel/dwell shape at the faster pace', () => {
    // A third of each step travels to the landmark, the rest dwells on it.
    const travelling = probeScan(0, PROBE_STEP_S * 0.2 * 1000, N, false);
    expect(travelling.traveling).toBe(true);
    expect(travelling.lockT).toBe(0);
    const dwelling = probeScan(0, PROBE_STEP_S * 0.8 * 1000, N, false);
    expect(dwelling.traveling).toBe(false);
    expect(dwelling.lockT).toBeGreaterThan(0.5);
    // The landmark resolves past the dwell's midpoint, not on arrival.
    expect(probeScan(0, PROBE_STEP_S * 0.5 * 1000, N, false).reveal).toBe(0);
    expect(probeScan(0, PROBE_STEP_S * 0.6 * 1000, N, false).reveal).toBe(1);
  });
  it('starts unidentified at the first landmark', () => {
    const s = probeScan(0, 0, N, false);
    expect(s.activeIndex).toBe(0); expect(s.reveal).toBe(0); expect(s.status).toBe('unidentified');
  });
  it('advances the active landmark over time', () => {
    const s = probeScan(0, PROBE_STEP_S * 2.5 * 1000, N, false);
    expect(s.activeIndex).toBe(2); expect(s.status).toBe('analyzing');
  });
  it('reaches classified after all landmarks + hold', () => {
    const s = probeScan(0, (PROBE_STEP_S * N + 0.5) * 1000, N, false);
    expect(s.classified).toBe(true); expect(s.reveal).toBe(N); expect(s.pct).toBe(100);
  });
  it('reduced motion freezes fully classified', () => {
    const s = probeScan(0, 0, N, true);
    expect(s.classified).toBe(true); expect(s.reveal).toBe(N);
  });
  it('runs once then HOLDS classified — no replay/loop long after the scan', () => {
    const s = probeScan(0, (PROBE_STEP_S * N + 999) * 1000, N, false);
    expect(s.classified).toBe(true); expect(s.reveal).toBe(N); expect(s.status).toBe('classified');
  });
  it('clamps negative elapsed to the start (no NaN / negative index)', () => {
    const s = probeScan(1000, 0, N, false); // now < epoch
    expect(s.activeIndex).toBe(0); expect(Number.isFinite(s.pct)).toBe(true);
  });
});
