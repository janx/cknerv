export const PROBE_STEP_S = 0.72;   // travel(0.22) + dwell(0.5) per landmark
export const PROBE_HOLD_S = 1.4;    // classified hold before re-run
const TRAVEL_FRAC = 0.30;

export interface ProbeState {
  activeIndex: number; lockT: number; traveling: boolean;
  reveal: number; pct: number; classified: boolean;
  status: 'unidentified' | 'analyzing' | 'classified';
}

export function probeScan(epochMs: number, nowMs: number, count: number, reduced: boolean): ProbeState {
  const n = Math.max(1, count);
  if (reduced) return { activeIndex: n - 1, lockT: 1, traveling: false, reveal: n, pct: 100, classified: true, status: 'classified' };
  const cycle = n * PROBE_STEP_S + PROBE_HOLD_S;
  const tc = (((nowMs - epochMs) / 1000) % cycle + cycle) % cycle;
  if (tc >= n * PROBE_STEP_S) return { activeIndex: n - 1, lockT: 1, traveling: false, reveal: n, pct: 100, classified: true, status: 'classified' };
  const idx = Math.floor(tc / PROBE_STEP_S);
  const local = (tc - idx * PROBE_STEP_S) / PROBE_STEP_S;
  const traveling = local < TRAVEL_FRAC;
  const reveal = idx + (local > 0.55 ? 1 : 0);
  const pct = Math.min(99, Math.round(((idx + local) / n) * 100));
  return { activeIndex: idx, lockT: traveling ? 0 : (local - TRAVEL_FRAC) / (1 - TRAVEL_FRAC), traveling, reveal, pct, classified: false, status: reveal === 0 ? 'unidentified' : 'analyzing' };
}
