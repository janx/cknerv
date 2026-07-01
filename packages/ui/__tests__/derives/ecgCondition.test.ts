import { describe, it, expect } from 'vitest';
import {
  ecgCondition, expectedBlockMs, windowMeanMs,
  EPOCH_DURATION_TARGET_MS, DEFAULT_TARGET_MS,
} from '../../src/derives/ecgCondition';

const MU = 8000;
const rep = (v: number, n: number): number[] => Array.from({ length: n }, () => v);
// An established baseline of 40 intervals at `b`, then a recent window of 20 at `r`.
// z = √20 · (r/b − 1): the recent window's slow-side deviation from the baseline.
const shift = (b: number, r: number): number[] => [...rep(b, 40), ...rep(r, 20)];

describe('expectedBlockMs', () => {
  it('derives ~8s from a typical mainnet epoch length', () => {
    expect(expectedBlockMs(1800)).toBe(EPOCH_DURATION_TARGET_MS / 1800); // 8000
  });
  it('falls back to the default when epoch length is unknown', () => {
    expect(expectedBlockMs(0)).toBe(DEFAULT_TARGET_MS);
    expect(expectedBlockMs(-5)).toBe(DEFAULT_TARGET_MS);
  });
  it('clamps to [1000, 60000]', () => {
    expect(expectedBlockMs(200000)).toBe(1000); // would be 72ms
    expect(expectedBlockMs(50)).toBe(60000);    // would be 288000ms
  });
});

describe('windowMeanMs', () => {
  it('averages the last n valid intervals', () => {
    expect(windowMeanMs([8000, 8000, 8000])).toBe(8000);
    expect(windowMeanMs([8000, -1, NaN, 12000])).toBe(10000); // filters invalid
    expect(windowMeanMs(rep(1000, 40), 30)).toBe(1000);
  });
  it('returns null on empty/all-invalid input', () => {
    expect(windowMeanMs([])).toBeNull();
    expect(windowMeanMs([-1, NaN])).toBeNull();
  });
});

describe('ecgCondition', () => {
  const base = { targetMs: MU, msSinceLast: 1000, syncing: false } as const;

  it('stays FINE when blocks run uniformly slower than the protocol target', () => {
    // The crux of R2: a steady cadence is healthy even at 1.5x the 8s target — the
    // chain simply beats slower, which is not an anomaly. (Old logic flagged this.)
    expect(ecgCondition({ ...base, intervalsMs: rep(12000, 60) })).toBe('FINE');
  });

  it('judges the same slow window against the chain\'s own baseline, not the target', () => {
    // recent 20 blocks at 14s:
    //   vs an 8s established baseline → z=√20·0.75≈3.35 → a real regime shift (CAUTION)
    //   vs a 14s established baseline → z=0 → just the chain's own rate (FINE)
    expect(ecgCondition({ ...base, intervalsMs: shift(8000, 14000) })).toBe('CAUTION');
    expect(ecgCondition({ ...base, intervalsMs: shift(14000, 14000) })).toBe('FINE');
  });

  it('escalates to DANGER when the recent window runs far above baseline', () => {
    // recent 20 at 16s vs 8s baseline → z=√20·1.0≈4.47 → DANGER
    expect(ecgCondition({ ...base, intervalsMs: shift(8000, 16000) })).toBe('DANGER');
  });

  it('does NOT alarm on exponential jitter when the underlying rate is stable', () => {
    // wild single-interval variance (2s and 14s) but recent rate == baseline rate.
    const jitter = [...rep(2000, 20), ...rep(14000, 20), ...rep(2000, 10), ...rep(14000, 10)];
    expect(ecgCondition({ ...base, intervalsMs: jitter })).toBe('FINE');
  });

  it('FLATLINEs on a gap past 8x the realized baseline, scaling with a slow chain', () => {
    // realized baseline 10s → flatline only past 80s, not at the 64s an 8s target implies
    expect(ecgCondition({ ...base, intervalsMs: rep(10000, 40), msSinceLast: 70000 })).toBe('FINE');
    expect(ecgCondition({ ...base, intervalsMs: rep(10000, 40), msSinceLast: 85000 })).toBe('FLATLINE');
  });

  it('SYNCING overrides flatline/danger', () => {
    expect(ecgCondition({ ...base, intervalsMs: shift(8000, 16000), syncing: true })).toBe('SYNCING');
    expect(ecgCondition({ ...base, intervalsMs: rep(8000, 40), msSinceLast: MU * 20, syncing: true })).toBe('SYNCING');
  });

  it('stays FINE without enough history to establish a baseline', () => {
    // cold start: a few slow intervals and no older window → no honest reference → FINE
    expect(ecgCondition({ ...base, intervalsMs: [] })).toBe('FINE');
    expect(ecgCondition({ ...base, intervalsMs: rep(20000, 10) })).toBe('FINE');
  });

  it('FINE on a non-positive target once a realized baseline exists', () => {
    expect(ecgCondition({ ...base, intervalsMs: rep(99000, 60), targetMs: 0 })).toBe('FINE');
  });

  it('applies hysteresis on de-escalation via prev', () => {
    const danger = shift(8000, 14600); // z≈3.69 — between danger-exit(3.5) and danger-enter(4)
    expect(ecgCondition({ ...base, intervalsMs: danger })).toBe('CAUTION');                 // fresh: <4
    expect(ecgCondition({ ...base, intervalsMs: danger, prev: 'DANGER' })).toBe('DANGER');  // holds >=3.5

    const caution = shift(8000, 12800); // z≈2.68 — between caution-exit(2.5) and caution-enter(3)
    expect(ecgCondition({ ...base, intervalsMs: caution })).toBe('FINE');                       // fresh: <3
    expect(ecgCondition({ ...base, intervalsMs: caution, prev: 'CAUTION' })).toBe('CAUTION');   // holds >=2.5
  });

  it('treats an inert prev (FLATLINE/SYNCING) as a fresh classification', () => {
    // only DANGER/CAUTION carry hysteresis; any other prev falls through to enter thresholds
    expect(ecgCondition({ ...base, intervalsMs: shift(8000, 14000), prev: 'FLATLINE' })).toBe('CAUTION'); // z~3.35
    expect(ecgCondition({ ...base, intervalsMs: rep(12000, 60), prev: 'SYNCING' })).toBe('FINE');
  });
});
