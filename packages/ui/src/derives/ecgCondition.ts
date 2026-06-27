// SYNCING = node is catching up (IBD / behind the network). It is NOT an alarm —
// the block cadence simply doesn't apply while we replay history, and a stale
// last-block timestamp must never read as a "stall". FLATLINE is reserved for a
// genuine at-tip stall (blocks stopped while we're caught up).
//
// CKB is PoW: inter-block times are ~Exponential(1/μ), so single long/short
// intervals are normal. We classify health from the *windowed mean* against a
// Poisson confidence band, not from individual intervals. The mean of N
// exponentials has SD = μ/√N, so z = √N·(mean/μ − 1) is the slow-side deviation
// in σ. CAUTION/DANGER fire at 2σ/3σ with hysteresis to stop boundary flicker.
export type EcgCondition = 'FINE' | 'CAUTION' | 'DANGER' | 'FLATLINE' | 'SYNCING';

export const ECG_WINDOW = 30;          // intervals averaged for the σ test
export const ECG_SIGMA_CAUTION = 2;    // enter CAUTION at +2σ
export const ECG_SIGMA_DANGER = 3;     // enter DANGER at +3σ
export const ECG_SIGMA_HYST = 0.4;     // leave a hotter state 0.4σ below its enter level
export const ECG_FLATLINE_FACTOR = 8;  // gap > 8x target (~0.03% survival) -> flatline
export const EPOCH_DURATION_TARGET_MS = 14_400_000; // CKB ~4h epoch target
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
  if (!(targetMs > 0)) return 'FINE';
  if (msSinceLast > targetMs * ECG_FLATLINE_FACTOR) return 'FLATLINE';

  const v = recentValid(intervalsMs, ECG_WINDOW);
  if (v.length === 0) return 'FINE';
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const z = Math.sqrt(v.length) * (mean / targetMs - 1);

  const cautionExit = ECG_SIGMA_CAUTION - ECG_SIGMA_HYST; // 1.6
  const dangerExit = ECG_SIGMA_DANGER - ECG_SIGMA_HYST;   // 2.6

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
