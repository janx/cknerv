import { describe, expect, it } from 'vitest';
import {
  consensusMemoryTraceFocusStrength,
  type ConsensusMemoryTraceFocus,
} from '../../src/nerve/consensusMemoryTrace';
import {
  CONSENSUS_MEMORY_RECORD_BRIDGE_ENTRY_DELAY_SECONDS,
  CONSENSUS_MEMORY_RECORD_BRIDGE_MAX_SECONDS,
  CONSENSUS_MEMORY_RECORD_PARK_SETTLE_SECONDS,
  CONSENSUS_MEMORY_RECORD_PARK_STRENGTH,
  deriveConsensusMemoryRecordBridge,
  deriveConsensusMemoryRecordParkFocus,
} from '../../src/nerve/consensusMemoryRecordBridge';

function focus(
  key: string,
  startedAtSec: number,
  path: readonly number[],
): ConsensusMemoryTraceFocus {
  const sourceId = path[0];
  const targetId = path[path.length - 1];
  return {
    key,
    sourceKind: 'input',
    sources: [{
      id: sourceId,
      contentHash: `0x${sourceId}`,
      outPoint: { tx_hash: `0x${sourceId}`, index: 0 },
      birthBlock: sourceId,
      startsAtSec: startedAtSec,
      arrivesAtSec: startedAtSec + 0.5,
      routes: [{
        targetId,
        path,
        color: [0.2, 0.8, 1],
        hopCount: path.length - 1,
        hopMs: 250,
        startsAtSec: startedAtSec,
        arrivesAtSec: startedAtSec + 0.5,
      }],
    }],
    routedSourceCount: 1,
    targetIds: [targetId],
    startedAtSec,
    endsAtSec: startedAtSec + 5,
    evidenceFocusSourceId: sourceId,
    routeHopFocus: {
      traceKey: key,
      sourceId,
      targetCellId: targetId,
      cellId: path[1],
      hopIndex: 1,
    },
  };
}

describe('consensus memory record bridge', () => {
  it('stages independent record layers without fabricating a route between them', () => {
    const previous = focus('18:5:1', 1, [1, 3, 5]);
    const next = focus('19:9:1', 2, [7, 8, 9]);
    next.evidenceFocusSourceId = null;
    next.routeHopFocus = null;
    const presentation = deriveConsensusMemoryRecordBridge(
      previous,
      next,
      2,
    )!;

    expect(presentation.bridge.endsAtSec - presentation.bridge.startedAtSec)
      .toBeCloseTo(CONSENSUS_MEMORY_RECORD_BRIDGE_MAX_SECONDS);
    expect(presentation.departingFocus.sources[0].routes[0].path)
      .toEqual([1, 3, 5]);
    expect(presentation.arrivingFocus.sources[0].routes[0].path)
      .toEqual([7, 8, 9]);
    expect(presentation.bridge).not.toHaveProperty('path');
    expect(presentation.bridge).not.toHaveProperty('cellIds');
    expect(presentation.arrivingFocus.routeHopFocus).toBeNull();
    expect(presentation.arrivingFocus.visualContinuity).toMatchObject({
      mode: 'entry',
      startedAtSec: 2 + CONSENSUS_MEMORY_RECORD_BRIDGE_ENTRY_DELAY_SECONDS,
    });
  });

  it('lets the old record recede before the new record fully enters', () => {
    const presentation = deriveConsensusMemoryRecordBridge(
      focus('18:5:1', 1, [1, 3, 5]),
      focus('19:9:1', 2, [7, 8, 9]),
      2,
    )!;
    const midpoint = (
      presentation.bridge.startedAtSec + presentation.bridge.endsAtSec
    ) / 2;

    expect(consensusMemoryTraceFocusStrength(
      presentation.departingFocus,
      2,
    )).toBeCloseTo(1);
    expect(consensusMemoryTraceFocusStrength(
      presentation.arrivingFocus,
      2 + CONSENSUS_MEMORY_RECORD_BRIDGE_ENTRY_DELAY_SECONDS / 2,
    )).toBe(0);
    expect(consensusMemoryTraceFocusStrength(
      presentation.departingFocus,
      midpoint,
    )).toBeCloseTo(0.5);
    expect(consensusMemoryTraceFocusStrength(
      presentation.arrivingFocus,
      midpoint,
    )).toBeGreaterThan(0);
    expect(consensusMemoryTraceFocusStrength(
      presentation.departingFocus,
      presentation.bridge.endsAtSec,
    )).toBe(0);
    expect(consensusMemoryTraceFocusStrength(
      presentation.arrivingFocus,
      presentation.bridge.endsAtSec,
    )).toBeCloseTo(1);
  });

  it('leaves same-route replay continuity and reduced motion untouched', () => {
    const previous = focus('18:5:1', 1, [1, 3, 5]);
    const replay = focus('18:5:2', 2, [1, 3, 5]);

    expect(deriveConsensusMemoryRecordBridge(previous, replay, 2)).toBeNull();
    expect(deriveConsensusMemoryRecordBridge(
      previous,
      focus('19:9:1', 2, [7, 8, 9]),
      2,
      { reducedMotion: true },
    )).toBeNull();
  });

  it('parks only the old endpoints while a different Cell is inspected', () => {
    const previous = focus('18:5:1', 1, [1, 3, 5]);
    const parkedAtSec = 2;
    const parked = deriveConsensusMemoryRecordParkFocus(
      previous,
      parkedAtSec,
    )!;

    expect(parked.sources[0].routes[0].path).toEqual([1, 3, 5]);
    expect(parked.evidenceFocusSourceId).toBeNull();
    expect(parked.routeHopFocus).toBeNull();
    expect(parked.visualContinuity?.mode).toBe('park');
    expect(consensusMemoryTraceFocusStrength(parked, parkedAtSec))
      .toBeCloseTo(1);
    expect(consensusMemoryTraceFocusStrength(
      parked,
      parkedAtSec + CONSENSUS_MEMORY_RECORD_PARK_SETTLE_SECONDS,
    )).toBeCloseTo(CONSENSUS_MEMORY_RECORD_PARK_STRENGTH);
    expect(consensusMemoryTraceFocusStrength(parked, parked.endsAtSec)).toBe(0);
    expect(deriveConsensusMemoryRecordParkFocus(
      previous,
      parkedAtSec,
      { reducedMotion: true },
    )).toBeNull();
  });
});
