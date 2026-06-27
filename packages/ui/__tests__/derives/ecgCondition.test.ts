import { describe, it, expect } from 'vitest';
import {
  ecgCondition, expectedBlockMs, windowMeanMs,
  EPOCH_DURATION_TARGET_MS, DEFAULT_TARGET_MS,
} from '../../src/derives/ecgCondition';

const MU = 8000;
const rep = (v: number, n: number): number[] => Array.from({ length: n }, () => v);

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

  it('FINE when the windowed mean sits within ~2σ of target', () => {
    expect(ecgCondition({ ...base, intervalsMs: rep(8800, 30) })).toBe('FINE'); // z~0.55
  });
  it('CAUTION at z in [2,3) — sustained ~1.45x target', () => {
    expect(ecgCondition({ ...base, intervalsMs: rep(11600, 30) })).toBe('CAUTION'); // z~2.46
  });
  it('DANGER at z >= 3 — sustained ~1.6x target', () => {
    expect(ecgCondition({ ...base, intervalsMs: rep(13000, 30) })).toBe('DANGER'); // z~3.42
  });

  it('does NOT alarm on exponential jitter with mean ~= target', () => {
    // 24 very-short + 6 very-long, mean exactly target. Single intervals up to 3x.
    const noisy = [...rep(4000, 24), ...rep(24000, 6)]; // mean 8000
    expect(ecgCondition({ ...base, intervalsMs: noisy })).toBe('FINE');
  });

  it('FLATLINE when the current gap exceeds 8x target (and not syncing)', () => {
    expect(ecgCondition({ ...base, intervalsMs: rep(8000, 30), msSinceLast: MU * 8.5 })).toBe('FLATLINE');
    // exactly 8x is not yet flatline (strict >)
    expect(ecgCondition({ ...base, intervalsMs: rep(8000, 30), msSinceLast: MU * 8 })).toBe('FINE');
  });

  it('SYNCING overrides flatline/danger', () => {
    expect(ecgCondition({ ...base, intervalsMs: rep(13000, 30), syncing: true })).toBe('SYNCING');
    expect(ecgCondition({ ...base, intervalsMs: rep(8000, 30), msSinceLast: MU * 9, syncing: true })).toBe('SYNCING');
  });

  it('FINE on empty history / non-positive target', () => {
    expect(ecgCondition({ ...base, intervalsMs: [] })).toBe('FINE');
    expect(ecgCondition({ ...base, intervalsMs: rep(99000, 30), targetMs: 0 })).toBe('FINE');
  });

  it('applies hysteresis on de-escalation via prev', () => {
    const mid = rep(11944, 30); // z ~ 2.74 — between caution-exit(1.6) and danger(3)
    expect(ecgCondition({ ...base, intervalsMs: mid })).toBe('CAUTION');                  // fresh: <3
    expect(ecgCondition({ ...base, intervalsMs: mid, prev: 'DANGER' })).toBe('DANGER');   // holds >=2.6

    const low = rep(10633, 30); // z ~ 1.8 — between caution-exit(1.6) and caution-enter(2)
    expect(ecgCondition({ ...base, intervalsMs: low })).toBe('FINE');                     // fresh: <2
    expect(ecgCondition({ ...base, intervalsMs: low, prev: 'CAUTION' })).toBe('CAUTION'); // holds >=1.6
  });

  it('treats an inert prev (FLATLINE/SYNCING/FINE) as a fresh classification', () => {
    // only DANGER/CAUTION carry hysteresis; any other prev falls through to enter thresholds
    expect(ecgCondition({ ...base, intervalsMs: rep(11600, 30), prev: 'FLATLINE' })).toBe('CAUTION'); // z~2.46
    expect(ecgCondition({ ...base, intervalsMs: rep(8800, 30), prev: 'SYNCING' })).toBe('FINE');      // z~0.55
  });
});
