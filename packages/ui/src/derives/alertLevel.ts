import type { EcgCondition } from './ecgCondition';

// `syncing` is a benign, informational state — the node is catching up (IBD or
// behind the network). It is deliberately NOT a severity: while syncing we stay
// calm and do not raise reorg/stall alarms (those are expected churn during
// catch-up and would only cause false "DANGER" on restart). Anomalies are
// evaluated only once we're at tip.
export type AlertLevel = 'nominal' | 'syncing' | 'caution' | 'warning' | 'danger' | 'crit';
export interface AlertState { level: AlertLevel; trigger: string | null; }

export const ALERT_REORG_DANGER_DEPTH = 3;
export const ALERT_REORG_CRIT_DEPTH = 6;

const RANK: Record<AlertLevel, number> = {
  nominal: 0, syncing: 1, caution: 2, warning: 3, danger: 4, crit: 5,
};

export function alertLevel(input: {
  ecg: EcgCondition;
  reorgDepth: number; // blocks reorged this tick (0 if none)
  syncing: boolean;   // node is catching up (IBD / behind the network)
}): AlertState {
  // While catching up, everything is expected — report a calm SYNCING state and
  // suppress reorg/stall escalation. (A stale block timestamp or being behind the
  // fleet is normal during sync, not a danger.)
  if (input.syncing) return { level: 'syncing', trigger: null };

  const cands: AlertState[] = [{ level: 'nominal', trigger: null }];

  // Genuine at-tip stall: blocks stopped while we're caught up. Real anomaly.
  if (input.ecg === 'FLATLINE') cands.push({ level: 'danger', trigger: 'stalled' });
  else if (input.ecg === 'DANGER') cands.push({ level: 'caution', trigger: 'slow-blocks' });

  if (input.reorgDepth > 0) {
    const level: AlertLevel =
      input.reorgDepth >= ALERT_REORG_CRIT_DEPTH ? 'crit'
      : input.reorgDepth >= ALERT_REORG_DANGER_DEPTH ? 'danger'
      : 'warning';
    cands.push({ level, trigger: `reorg-${input.reorgDepth}` });
  }

  return cands.reduce((a, b) => (RANK[b.level] > RANK[a.level] ? b : a));
}
