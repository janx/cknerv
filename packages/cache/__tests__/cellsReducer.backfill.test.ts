import { describe, it, expect } from 'vitest';
import {
  applyCellDelta,
  emptyCellsCache,
  fromCellsSnapshot,
} from '../src/cellsReducer';

describe('cells backfill progress', () => {
  it('empty cache has no backfill', () => {
    expect(emptyCellsCache().backfill).toBeNull();
  });

  it('hydrates backfill from snapshot', () => {
    const c = fromCellsSnapshot(1, {
      cells: [],
      last_pulse_at_ms: 0,
      backfill: { done: 7, total: 10 },
    });
    expect(c.backfill).toEqual({ done: 7, total: 10 });
  });

  it('active backfill delta sets state, inactive clears it', () => {
    let c = emptyCellsCache();
    c = applyCellDelta(c, { type: 'backfill', done: 3, total: 10, active: true });
    expect(c.backfill).toEqual({ done: 3, total: 10 });
    c = applyCellDelta(c, { type: 'backfill', done: 10, total: 10, active: false });
    expect(c.backfill).toBeNull();
  });
});
