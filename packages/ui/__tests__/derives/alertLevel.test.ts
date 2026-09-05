import { describe, it, expect } from 'vitest';
import {
  alertHoldRemainingMs,
  alertLevel,
  holdAlert,
  reorgAlertStanding,
  ALERT_MIN_DWELL_MS,
  type AlertHold,
  type AlertState,
} from '../../src/derives/alertLevel';
import { HUD_MOTION } from '../../src/components/hud/hudTheme';

const base = { ecg: 'FINE' as const, reorgDepth: 0, syncing: false };

describe('alertLevel', () => {
  it('nominal when all clear', () => {
    expect(alertLevel(base)).toEqual({ level: 'nominal', trigger: null });
  });

  it('syncing is a calm state, never danger (the restart case)', () => {
    expect(alertLevel({ ...base, syncing: true })).toEqual({ level: 'syncing', trigger: null });
    expect(alertLevel({ ecg: 'SYNCING', reorgDepth: 0, syncing: true })).toEqual({ level: 'syncing', trigger: null });
  });

  it('suppresses reorg/stall escalation while syncing (catch-up churn is expected)', () => {
    expect(alertLevel({ ecg: 'SYNCING', reorgDepth: 4, syncing: true }).level).toBe('syncing');
    expect(alertLevel({ ecg: 'FLATLINE', reorgDepth: 0, syncing: true }).level).toBe('syncing');
  });

  it('climbs one rung per depth band, and one orphaned block raises no bar', () => {
    // D-12. Depth is now ORPHANED BLOCKS rather than reorg events in a batch,
    // so this is the ramp a reader can actually walk up.
    expect(alertLevel({ ...base, reorgDepth: 1 }).level).toBe('caution');
    expect(alertLevel({ ...base, reorgDepth: 2 }).level).toBe('warning');
    expect(alertLevel({ ...base, reorgDepth: 3 }).level).toBe('danger');
    expect(alertLevel({ ...base, reorgDepth: 5 }).level).toBe('danger');
    expect(alertLevel({ ...base, reorgDepth: 6 }).level).toBe('crit');
    expect(alertLevel({ ...base, reorgDepth: 60 }).level).toBe('crit');
    // …and the depth travels in the trigger, which is what the band prints.
    expect(alertLevel({ ...base, reorgDepth: 4 }).trigger).toBe('reorg-4');
  });

  it('danger on a genuine at-tip stall, labelled "stalled" (not "sync-stall")', () => {
    expect(alertLevel({ ...base, ecg: 'FLATLINE' })).toEqual({ level: 'danger', trigger: 'stalled' });
  });

  it('caution when blocks run slow at tip', () => {
    expect(alertLevel({ ...base, ecg: 'DANGER' })).toEqual({ level: 'caution', trigger: 'slow-blocks' });
  });

  it('takes the highest of several at-tip triggers', () => {
    expect(alertLevel({ ecg: 'FLATLINE', reorgDepth: 1, syncing: false }).level).toBe('danger');
  });
});

describe('the dwell', () => {
  const state = (level: AlertState['level'], trigger: string | null = null): AlertState =>
    ({ level, trigger });
  const calm = state('nominal');

  it('is the hold rung, and says so from the table', () => {
    expect(ALERT_MIN_DWELL_MS).toBe(HUD_MOTION.hold);
    expect(ALERT_MIN_DWELL_MS).toBe(2_400);
  });

  it('keeps an alarm standing for the whole dwell', () => {
    let hold: AlertHold | null = holdAlert(null, calm, 0);
    hold = holdAlert(hold, state('warning', 'reorg-2'), 1_000);
    expect(hold.state.level).toBe('warning');

    // The delta is gone on the very next render, which is exactly what used to
    // take the band off screen inside one frame.
    hold = holdAlert(hold, calm, 1_010);
    expect(hold.state.level).toBe('warning');
    hold = holdAlert(hold, calm, 1_000 + ALERT_MIN_DWELL_MS - 1);
    expect(hold.state.level).toBe('warning');

    hold = holdAlert(hold, calm, 1_000 + ALERT_MIN_DWELL_MS);
    expect(hold.state.level).toBe('nominal');
  });

  it('never holds back an escalation', () => {
    let hold: AlertHold | null = holdAlert(null, state('warning', 'reorg-2'), 0);
    hold = holdAlert(hold, state('crit', 'reorg-9'), 100);
    expect(hold.state).toEqual(state('crit', 'reorg-9'));
    // …and the deeper alarm starts its own dwell from the moment it arrived.
    expect(alertHoldRemainingMs(hold, 100)).toBe(ALERT_MIN_DWELL_MS);
  });

  it('does not restart the clock on news that has not changed', () => {
    const first = holdAlert(null, state('danger', 'stalled'), 0);
    const again = holdAlert(first, state('danger', 'stalled'), 2_000);
    expect(again).toBe(first);
    expect(alertHoldRemainingMs(again, 2_000)).toBe(ALERT_MIN_DWELL_MS - 2_000);
  });

  it('gives a calm state no dwell of its own', () => {
    const hold = holdAlert(null, calm, 0);
    expect(alertHoldRemainingMs(hold, 0)).toBe(0);
    expect(holdAlert(hold, state('caution', 'slow-blocks'), 1).state.level).toBe('caution');
    // syncing is calm too: it is more information, not worse news.
    const syncing = holdAlert(null, state('syncing'), 0);
    expect(alertHoldRemainingMs(syncing, 0)).toBe(0);
  });

  it('lets CKB·01 read the band\'s own dwell', () => {
    expect(reorgAlertStanding(state('warning', 'reorg-2'))).toBe(true);
    expect(reorgAlertStanding(state('caution', 'reorg-1'))).toBe(true);
    expect(reorgAlertStanding(state('danger', 'stalled'))).toBe(false);
    expect(reorgAlertStanding(calm)).toBe(false);
    expect(reorgAlertStanding(null)).toBe(false);
  });
});
