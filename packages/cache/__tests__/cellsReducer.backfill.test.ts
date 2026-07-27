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
    expect(c.backfill).toEqual({ done: 7, total: 10, phase: 'boot' });
  });

  it('preserves an explicit replay phase from a snapshot', () => {
    const c = fromCellsSnapshot(1, {
      cells: [],
      last_pulse_at_ms: 0,
      backfill: { done: 0, total: 0, phase: 'reorg' },
    });
    expect(c.backfill).toEqual({ done: 0, total: 0, phase: 'reorg' });
  });

  it('normalizes legacy deltas to boot and preserves explicit phases', () => {
    let c = emptyCellsCache();
    c = applyCellDelta(c, { type: 'backfill', done: 3, total: 10, active: true });
    expect(c.backfill).toEqual({ done: 3, total: 10, phase: 'boot' });
    c = applyCellDelta(c, {
      type: 'backfill',
      done: 4,
      total: 10,
      active: true,
      phase: 'catchup',
    });
    expect(c.backfill).toEqual({ done: 4, total: 10, phase: 'catchup' });
    c = applyCellDelta(c, {
      type: 'backfill',
      done: 10,
      total: 10,
      active: false,
      phase: 'catchup',
    });
    expect(c.backfill).toBeNull();
  });
});
