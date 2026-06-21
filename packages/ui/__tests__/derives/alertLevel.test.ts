import { describe, it, expect } from 'vitest';
import { alertLevel } from '../../src/derives/alertLevel';

const base = { ecg: 'FINE' as const, reorgDepth: 0, aheadRatio: 0, maxAhead: 0 };

describe('alertLevel', () => {
  it('nominal when all clear', () => {
    expect(alertLevel(base)).toEqual({ level: 'nominal', trigger: null });
  });
  it('warning on a shallow reorg, danger on a deep one, crit on a very deep one', () => {
    expect(alertLevel({ ...base, reorgDepth: 1 }).level).toBe('warning');
    expect(alertLevel({ ...base, reorgDepth: 3 }).level).toBe('danger');
    expect(alertLevel({ ...base, reorgDepth: 6 }).level).toBe('crit');
  });
  it('danger when ECG flatlines (sync stall)', () => {
    expect(alertLevel({ ...base, ecg: 'FLATLINE' })).toEqual({ level: 'danger', trigger: 'sync-stall' });
  });
  it('caution then danger as the fleet pulls ahead', () => {
    expect(alertLevel({ ...base, aheadRatio: 0.6, maxAhead: 1 }).level).toBe('caution');
    expect(alertLevel({ ...base, aheadRatio: 0.6, maxAhead: 5 }).level).toBe('danger');
  });
  it('takes the highest of several triggers', () => {
    expect(alertLevel({ ecg: 'FLATLINE', reorgDepth: 1, aheadRatio: 0.6, maxAhead: 1 }).level).toBe('danger');
  });
});
