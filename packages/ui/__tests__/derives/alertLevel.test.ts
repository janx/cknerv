import { describe, it, expect } from 'vitest';
import { alertLevel } from '../../src/derives/alertLevel';

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

  it('warning on a shallow reorg, danger on a deep one, crit on a very deep one (at tip)', () => {
    expect(alertLevel({ ...base, reorgDepth: 1 }).level).toBe('warning');
    expect(alertLevel({ ...base, reorgDepth: 3 }).level).toBe('danger');
    expect(alertLevel({ ...base, reorgDepth: 6 }).level).toBe('crit');
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
