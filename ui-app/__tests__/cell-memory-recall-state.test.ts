import { describe, expect, it } from 'vitest';
import {
  CELL_MEMORY_RECALL_MAX_PULSES,
  INITIAL_CELL_MEMORY_RECALL_STATE,
  cellMemoryRecallReducer,
} from '../src/cell-memory-recall-state';

describe('cell memory recall state', () => {
  it('targets the selected output and toggles an active recall off', () => {
    const active = cellMemoryRecallReducer(
      INITIAL_CELL_MEMORY_RECALL_STATE,
      { type: 'toggle', linkSeq: 18, targetCellId: 4242 },
    );

    expect(CELL_MEMORY_RECALL_MAX_PULSES).toBe(2);
    expect(active.request).toEqual({
      linkSeq: 18,
      targetCellId: 4242,
      nonce: 1,
    });

    const exited = cellMemoryRecallReducer(active, {
      type: 'toggle',
      linkSeq: 18,
      targetCellId: 4242,
    });
    expect(exited).toEqual({ request: null, nonce: 1 });

    const replayed = cellMemoryRecallReducer(exited, {
      type: 'toggle',
      linkSeq: 18,
      targetCellId: 4242,
    });
    expect(replayed.request?.nonce).toBe(2);
  });

  it('ignores a stale completion from a replaced Cell recall', () => {
    const first = cellMemoryRecallReducer(
      INITIAL_CELL_MEMORY_RECALL_STATE,
      { type: 'toggle', linkSeq: 18, targetCellId: 4242 },
    );
    const second = cellMemoryRecallReducer(first, {
      type: 'toggle',
      linkSeq: 19,
      targetCellId: 5252,
    });

    const afterStale = cellMemoryRecallReducer(second, {
      type: 'complete',
      request: first.request!,
    });
    expect(afterStale).toBe(second);

    const completed = cellMemoryRecallReducer(afterStale, {
      type: 'complete',
      request: second.request!,
    });
    expect(completed).toEqual({ request: null, nonce: 2 });
  });

  it('cancels selection without resetting replay identity', () => {
    const active = cellMemoryRecallReducer(
      INITIAL_CELL_MEMORY_RECALL_STATE,
      { type: 'toggle', linkSeq: 18, targetCellId: 4242 },
    );
    const cancelled = cellMemoryRecallReducer(active, { type: 'cancel' });

    expect(cancelled).toEqual({ request: null, nonce: 1 });
    expect(cellMemoryRecallReducer(cancelled, { type: 'cancel' })).toBe(cancelled);
  });
});
