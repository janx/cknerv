// SYNCING = node is catching up (IBD / behind the network). It is NOT an alarm —
// the block cadence simply doesn't apply while we replay history, and a stale
// last-block timestamp must never read as a "stall". FLATLINE is reserved for a
// genuine at-tip stall (blocks stopped while we're caught up).
export type EcgCondition = 'FINE' | 'CAUTION' | 'DANGER' | 'FLATLINE' | 'SYNCING';

export const ECG_FLATLINE_FACTOR = 6; // no block for 6x target -> flatline
export const ECG_CAUTION_RATIO = 1.4; // recent avg up to 1.4x target = healthy
export const ECG_DANGER_RATIO = 2.5;
const ECG_WINDOW = 8;

export function ecgCondition(
  intervalsMs: number[],
  targetMs: number,
  msSinceLast: number,
  syncing = false,
): EcgCondition {
  if (syncing) return 'SYNCING'; // catching up — cadence/flatline don't apply
  if (!(targetMs > 0)) return 'FINE';
  if (msSinceLast > targetMs * ECG_FLATLINE_FACTOR) return 'FLATLINE';
  const recent = intervalsMs.filter((v) => Number.isFinite(v) && v > 0).slice(-ECG_WINDOW);
  if (recent.length === 0) return 'FINE';
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const ratio = avg / targetMs;
  if (ratio <= ECG_CAUTION_RATIO) return 'FINE';
  if (ratio <= ECG_DANGER_RATIO) return 'CAUTION';
  return 'DANGER';
}
