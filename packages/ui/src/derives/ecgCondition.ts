// SYNCING = node is catching up (IBD / behind the network). It is NOT an alarm —
// the block cadence simply doesn't apply while we replay history, and a stale
// last-block timestamp must never read as a "stall". FLATLINE is reserved for a
// genuine at-tip stall (blocks stopped while we're caught up).
//
// CKB is PoW: inter-block times are ~Exponential(1/μ), CV=1, so single long/short
// intervals — and even a windowed rate that wobbles ±1/√N — are normal. We do NOT
// grade health against the protocol target (epoch_duration/length ≈ 8s): the chain
// routinely beats slower than that, which would peg a target-anchored band at a
// chronic CAUTION. Instead we anchor to the chain's OWN realized rate — a baseline
// mean over the older window — and ask whether the recent window has shifted off it.
// The mean of N exponentials has SD = μ/√N, so z = √N·(recentMean/baseline − 1) is
// the slow-side deviation in σ. CAUTION/DANGER fire at 3σ/4σ with hysteresis. A
// steady-but-slow chain reads FINE; only a genuine recent regime shift escalates.
export type EcgCondition = 'FINE' | 'CAUTION' | 'DANGER' | 'FLATLINE' | 'SYNCING';

export const ECG_WINDOW = 30;            // intervals averaged for the AVG readout
export const ECG_TEST_WINDOW = 20;       // recent intervals tested against the baseline ("now")
export const ECG_BASELINE_WINDOW = 40;   // older intervals defining the chain's realized rate
export const ECG_MIN_SAMPLES = 8;        // min intervals in each window before we judge
export const ECG_SIGMA_CAUTION = 3;      // enter CAUTION at +3σ above the realized baseline
export const ECG_SIGMA_DANGER = 4;       // enter DANGER at +4σ
export const ECG_SIGMA_HYST = 0.5;       // leave a hotter state 0.5σ below its enter level
// FLATLINE = genuine at-tip stall. It tests the residual gap/baseMean; measured on 1y of mainnet
// (μ≈10s) that residual is fatter-tailed than e^-k — baseMean is a noisy 40-sample mean and steps
// across epoch boundaries mid-window — so 8x fired ~5x/day with zero real stalls. 15x ≈ 1 false
// alarm/month at ~2.5min detection latency.
export const ECG_FLATLINE_FACTOR = 15;   // gap > 15x realized baseline -> flatline
// CKB consensus targets ~4h epochs (EPOCH_DURATION_TARGET = 14400s); the realized
// block time ≈ this / epoch.length, so epoch.length (≈1800 on mainnet) gives μ ≈ 8s.
// This target is the FLATLINE fallback + the panel's TGT readout — not the health band.
export const EPOCH_DURATION_TARGET_MS = 14_400_000;
export const DEFAULT_TARGET_MS = 8000; // fallback expected block time

/** Protocol-intended block time: epoch duration target / blocks per epoch. */
export function expectedBlockMs(epochLength: number): number {
  if (!(epochLength > 0)) return DEFAULT_TARGET_MS;
  return Math.min(60000, Math.max(1000, EPOCH_DURATION_TARGET_MS / epochLength));
}

function recentValid(intervalsMs: number[], n: number): number[] {
  return intervalsMs.filter((x) => Number.isFinite(x) && x > 0).slice(-n);
}

/** Mean of the last n finite, positive intervals; null when none. */
export function windowMeanMs(intervalsMs: number[], n: number = ECG_WINDOW): number | null {
  const v = recentValid(intervalsMs, n);
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

export interface EcgInput {
  intervalsMs: number[];
  targetMs: number;
  msSinceLast: number;
  syncing?: boolean;
  prev?: EcgCondition;
}

export function ecgCondition({ intervalsMs, targetMs, msSinceLast, syncing = false, prev }: EcgInput): EcgCondition {
  if (syncing) return 'SYNCING'; // catching up — cadence/flatline don't apply

  const valid = intervalsMs.filter((x) => Number.isFinite(x) && x > 0);
  const test = valid.slice(-ECG_TEST_WINDOW);
  // baseline = the older intervals before the test window (so "now" is compared to
  // the chain's prior rhythm, not to itself), capped at ECG_BASELINE_WINDOW.
  const baseline = valid.slice(0, valid.length - test.length).slice(-ECG_BASELINE_WINDOW);
  const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const baseMean = baseline.length > 0 ? avg(baseline) : null;

  // True at-tip stall: an unambiguous emergency, flagged even before a baseline
  // exists. Scaled to the realized rate when known (a slow chain legitimately has
  // longer gaps), else the protocol target.
  const stallRef = baseMean ?? (targetMs > 0 ? targetMs : null);
  if (stallRef != null && msSinceLast > stallRef * ECG_FLATLINE_FACTOR) return 'FLATLINE';

  // Too little history to know this chain's rhythm → stay calm (a cold start or a
  // short window is not evidence of anything; PoW cadence is high-variance).
  if (baseMean == null || baseline.length < ECG_MIN_SAMPLES || test.length < ECG_MIN_SAMPLES) return 'FINE';

  const z = Math.sqrt(test.length) * (avg(test) / baseMean - 1);

  const cautionExit = ECG_SIGMA_CAUTION - ECG_SIGMA_HYST; // 2.5
  const dangerExit = ECG_SIGMA_DANGER - ECG_SIGMA_HYST;   // 3.5

  // Escalation always uses enter thresholds; de-escalation uses the lower exits.
  if (prev === 'DANGER') {
    if (z >= dangerExit) return 'DANGER';
    return z >= cautionExit ? 'CAUTION' : 'FINE';
  }
  if (prev === 'CAUTION') {
    if (z >= ECG_SIGMA_DANGER) return 'DANGER';
    return z >= cautionExit ? 'CAUTION' : 'FINE';
  }
  if (z >= ECG_SIGMA_DANGER) return 'DANGER';
  if (z >= ECG_SIGMA_CAUTION) return 'CAUTION';
  return 'FINE';
}
