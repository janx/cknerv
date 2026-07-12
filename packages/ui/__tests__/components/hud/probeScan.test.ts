import { describe, it, expect } from 'vitest';
import { probeScan, PROBE_STEP_S } from '../../../src/components/hud/probeScan';

describe('probeScan', () => {
  const N = 6;
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
