/** Seconds the probe spends on one landmark: a short travel to it, then a
 *  dwell while it reads. The whole six-landmark walk is 1.8s — the reveal is
 *  a discovery, not a loading bar, and every downstream gate is expressed in
 *  steps or in scan percent so this number is the only dial. */
export const PROBE_STEP_S = 0.30;  // travel(0.09) + dwell(0.21) per landmark
const TRAVEL_FRAC = 0.30;

export interface ProbeState {
  activeIndex: number; lockT: number; traveling: boolean;
  reveal: number; pct: number; classified: boolean;
  status: 'unidentified' | 'analyzing' | 'classified';
}

// The marker probe runs ONCE from the scan epoch, walking each landmark, then
// HOLDS the classified end-state indefinitely — it does not loop/replay. (There
// is no modulo: elapsed is clamped and, past the last landmark, we return the
// frozen classified frame.) reduced-motion also freezes classified.
export function probeScan(epochMs: number, nowMs: number, count: number, reduced: boolean): ProbeState {
  const n = Math.max(1, count);
  const classified: ProbeState = { activeIndex: n - 1, lockT: 1, traveling: false, reveal: n, pct: 100, classified: true, status: 'classified' };
  if (reduced) return classified;
  const elapsed = Math.max(0, (nowMs - epochMs) / 1000);
  if (elapsed >= n * PROBE_STEP_S) return classified;   // scan complete → hold, no replay
  const idx = Math.floor(elapsed / PROBE_STEP_S);
  const local = (elapsed - idx * PROBE_STEP_S) / PROBE_STEP_S;
  const traveling = local < TRAVEL_FRAC;
  const reveal = idx + (local > 0.55 ? 1 : 0);
  const pct = Math.min(99, Math.round(((idx + local) / n) * 100));
  return { activeIndex: idx, lockT: traveling ? 0 : (local - TRAVEL_FRAC) / (1 - TRAVEL_FRAC), traveling, reveal, pct, classified: false, status: reveal === 0 ? 'unidentified' : 'analyzing' };
}
