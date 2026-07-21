import { describe, expect, it } from 'vitest';
import type {
  ConsensusMemoryRouteHopFocus,
  ConsensusMemoryTraceReadout,
} from '@cknerv/ui';
import {
  cellMemoryRouteAnchor,
  restoreCellMemoryRouteAnchor,
} from '../src/cell-memory-route-continuity';

function readout(key = '18:5:2'): ConsensusMemoryTraceReadout {
  return {
    key,
    targetCellId: 5,
    sourceKind: 'input',
    stage: 'reading',
    sourceCount: 1,
    arrivedSourceCount: 0,
    resolvedSourceCount: 0,
    evidence: [{
      sourceId: 1,
      ordinal: 1,
      contentHash: '0xabc',
      state: 'routing',
      sourceOutPoint: { tx_hash: '0x01', index: 0 },
      sourceBirthBlock: 10,
      route: [1, 3, 5],
      hopCount: 2,
      routeDurationMs: 500,
    }],
  };
}

describe('cell memory route continuity', () => {
  it('remembers no stale trace key and restores only from a fresh proof', () => {
    const previous: ConsensusMemoryRouteHopFocus = {
      traceKey: '18:5:1',
      sourceId: 1,
      targetCellId: 5,
      cellId: 3,
      hopIndex: 1,
    };
    const anchor = cellMemoryRouteAnchor(previous);

    expect(anchor).toEqual({
      traceIdentity: '18:5',
      sourceId: 1,
      targetCellId: 5,
      cellId: 3,
      hopIndex: 1,
    });
    expect(restoreCellMemoryRouteAnchor(anchor, null)).toBeNull();
    expect(restoreCellMemoryRouteAnchor(anchor, readout())).toEqual({
      traceKey: '18:5:2',
      sourceId: 1,
      targetCellId: 5,
      cellId: 3,
      hopIndex: 1,
    });
  });

  it('rejects a different target or a route that no longer contains the hop', () => {
    const anchor = {
      traceIdentity: '18:5',
      sourceId: 1,
      targetCellId: 5,
      cellId: 5,
      hopIndex: 2,
    };
    const otherTarget = { ...readout(), targetCellId: 6 };
    const shortened = readout();
    shortened.evidence = [{
      ...shortened.evidence[0],
      route: [1, 5],
      hopCount: 1,
    }];

    expect(restoreCellMemoryRouteAnchor(anchor, otherTarget)).toBeNull();
    expect(restoreCellMemoryRouteAnchor(anchor, readout('19:5:2'))).toBeNull();
    expect(restoreCellMemoryRouteAnchor(anchor, shortened)).toBeNull();
  });
});
