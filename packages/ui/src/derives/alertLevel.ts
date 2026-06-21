import type { EcgCondition } from './ecgCondition';

export type AlertLevel = 'nominal' | 'caution' | 'warning' | 'danger' | 'crit';
export interface AlertState { level: AlertLevel; trigger: string | null; }

export const ALERT_AHEAD_CAUTION = 0.5;       // >50% of peers ahead of us
export const ALERT_AHEAD_DANGER_BLOCKS = 3;   // ...and by >= 3 blocks -> danger
export const ALERT_REORG_DANGER_DEPTH = 3;
export const ALERT_REORG_CRIT_DEPTH = 6;

const RANK: Record<AlertLevel, number> = { nominal: 0, caution: 1, warning: 2, danger: 3, crit: 4 };

export function alertLevel(input: {
  ecg: EcgCondition;
  reorgDepth: number; // blocks reorged this tick (0 if none)
  aheadRatio: number; // fraction of peers ahead of our tip
  maxAhead: number;   // largest peer-ahead gap (blocks)
}): AlertState {
  const cands: AlertState[] = [{ level: 'nominal', trigger: null }];

  if (input.ecg === 'FLATLINE') cands.push({ level: 'danger', trigger: 'sync-stall' });
  else if (input.ecg === 'DANGER') cands.push({ level: 'caution', trigger: 'slow-blocks' });

  if (input.reorgDepth > 0) {
    const level: AlertLevel =
      input.reorgDepth >= ALERT_REORG_CRIT_DEPTH ? 'crit'
      : input.reorgDepth >= ALERT_REORG_DANGER_DEPTH ? 'danger'
      : 'warning';
    cands.push({ level, trigger: `reorg-${input.reorgDepth}` });
  }

  if (input.aheadRatio > ALERT_AHEAD_CAUTION) {
    cands.push(input.maxAhead >= ALERT_AHEAD_DANGER_BLOCKS
      ? { level: 'danger', trigger: 'behind-fleet' }
      : { level: 'caution', trigger: 'behind-fleet' });
  }

  return cands.reduce((a, b) => (RANK[b.level] > RANK[a.level] ? b : a));
}
