import type { EcgCondition } from './ecgCondition';
import { HUD_MOTION } from '../components/hud/hudTheme';

// `syncing` is a benign, informational state — the node is catching up (IBD or
// behind the network). It is deliberately NOT a severity: while syncing we stay
// calm and do not raise reorg/stall alarms (those are expected churn during
// catch-up and would only cause false "DANGER" on restart). Anomalies are
// evaluated only once we're at tip.
export type AlertLevel = 'nominal' | 'syncing' | 'caution' | 'warning' | 'danger' | 'crit';
export interface AlertState { level: AlertLevel; trigger: string | null; }

/**
 * The reorg ramp, in ORPHANED BLOCKS (D-12, the user's ruling).
 *
 * It reads as a ramp now because the input finally is one. `reorgDepth` used
 * to be `chain.reorgs − the previous render's chain.reorgs`, i.e. how many
 * reorg EVENTS landed in one batch — always 1 for a real reorg — so `danger`
 * and `crit` needed three or six forks to arrive in a single frame and had
 * never once been drawn (report E, E-8). Meanwhile every one-block reorg raised
 * the full 警告 bar: 109 sub-second amber blinks in one recorded session.
 *
 * So one orphaned block is a CAUTION — true, worth colouring, not worth a band
 * across the top of the instrument — and the bar starts at two.
 */
export const ALERT_REORG_CAUTION_DEPTH = 1;
export const ALERT_REORG_WARNING_DEPTH = 2;
export const ALERT_REORG_DANGER_DEPTH = 3;
export const ALERT_REORG_CRIT_DEPTH = 6;

/**
 * The floor under how long any alert stands: `HUD_MOTION.hold`, the rung whose
 * whole meaning is "a state kept alive after its cause is over".
 *
 * A reorg is an EVENT and every other input here is a CONDITION, and the alarm
 * was built for conditions: the depth was recomputed from a delta that an
 * effect caught up after the commit, so the band existed for exactly one
 * render and vanished on the next mempool tick — sub-second, on mainnet. An
 * alarm nobody can finish reading is not an alarm, and it is worse than none,
 * because a reader learns the band flickers and stops looking at it.
 */
export const ALERT_MIN_DWELL_MS = HUD_MOTION.hold;

const RANK: Record<AlertLevel, number> = {
  nominal: 0, syncing: 1, caution: 2, warning: 3, danger: 4, crit: 5,
};

/** Above the calm two. `syncing` outranks `nominal` because it is more
 *  information, not because it is worse news. */
export function isAlert(level: AlertLevel): boolean {
  return RANK[level] >= RANK.caution;
}

export function alertLevel(input: {
  ecg: EcgCondition;
  reorgDepth: number; // blocks ORPHANED by the reorg being reported (0 if none)
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

  if (input.reorgDepth >= ALERT_REORG_CAUTION_DEPTH) {
    const level: AlertLevel =
      input.reorgDepth >= ALERT_REORG_CRIT_DEPTH ? 'crit'
      : input.reorgDepth >= ALERT_REORG_DANGER_DEPTH ? 'danger'
      : input.reorgDepth >= ALERT_REORG_WARNING_DEPTH ? 'warning'
      : 'caution';
    cands.push({ level, trigger: `reorg-${input.reorgDepth}` });
  }

  return cands.reduce((a, b) => (RANK[b.level] > RANK[a.level] ? b : a));
}

/** What is on screen, and since when. */
export interface AlertHold { state: AlertState; sinceMs: number; }

/** Whether the standing alert is a reorg's — the fact CKB·01's REORGS reading
 *  colours on, so the tally and the band go quiet together instead of the
 *  tally flickering for one render while the band holds. It is asked of the
 *  HELD state, which is the whole point: the same dwell, read twice. */
export function reorgAlertStanding(state: AlertState | null): boolean {
  return state?.trigger?.startsWith('reorg-') === true;
}

/**
 * Hold an alert for `ALERT_MIN_DWELL_MS`, and never hold back an escalation.
 *
 * Pure, and the clock is handed in, so the dwell is a table a test can walk
 * rather than a wall-clock race. Four rules, in the order a reader would rank
 * them:
 *
 *  1. Worse news goes up immediately. A dwell that delayed an escalation would
 *     be the instrument withholding the thing it exists to say.
 *  2. The same news does not restart the clock — otherwise a condition that
 *     stays true is never allowed to end.
 *  3. Calmer news waits out the remainder of the dwell.
 *  4. And a calm state has no dwell of its own: nothing is being held, so the
 *     next reading takes effect at once.
 */
export function holdAlert(
  hold: AlertHold | null,
  next: AlertState,
  nowMs: number,
): AlertHold {
  if (hold === null) return { state: next, sinceMs: nowMs };
  if (next.level === hold.state.level && next.trigger === hold.state.trigger) {
    return hold;
  }
  if (RANK[next.level] > RANK[hold.state.level]) return { state: next, sinceMs: nowMs };
  if (!isAlert(hold.state.level)) return { state: next, sinceMs: nowMs };
  if (nowMs - hold.sinceMs >= ALERT_MIN_DWELL_MS) return { state: next, sinceMs: nowMs };
  return hold;
}

/** How much longer this hold has to stand, or `0` when it is free to change.
 *  The caller schedules exactly this rather than polling a clock: a dwell is a
 *  deadline, and a 1 Hz tick would round it up by up to a second. */
export function alertHoldRemainingMs(hold: AlertHold | null, nowMs: number): number {
  if (hold === null || !isAlert(hold.state.level)) return 0;
  return Math.max(0, hold.sinceMs + ALERT_MIN_DWELL_MS - nowMs);
}
