import { describe, expect, it } from 'vitest';
import {
  consensusMemoryEvidenceFocusScale,
  type ConsensusMemoryRouteHopFocus,
} from '../../src/nerve/consensusMemoryTrace';
import {
  CONSENSUS_MEMORY_SOURCE_HANDOFF_SECONDS,
  advanceConsensusMemorySourceHandoffTime,
  consensusMemorySourceHandoffEvidenceScale,
  consensusMemorySourceHandoffLockScale,
  consensusMemorySourceHandoffPhase,
  consensusMemorySourceHandoffProgress,
  consensusMemorySourceHandoffRouteFlareScale,
  deriveConsensusMemorySourceHandoff,
  reconcileConsensusMemorySourceHandoff,
} from '../../src/nerve/consensusMemorySourceHandoff';

const targetFocus = (
  sourceId: number,
  hopIndex: number,
): ConsensusMemoryRouteHopFocus => ({
  traceKey: '18:4242:1',
  sourceId,
  targetCellId: 4242,
  cellId: 4242,
  hopIndex,
});

describe('consensus memory source handoff', () => {
  it('crossfades only verified sources that meet at the same maintained record', () => {
    const from = targetFocus(11, 4);
    const to = targetFocus(12, 17);

    expect(deriveConsensusMemorySourceHandoff(from, to, 8)).toEqual({
      from,
      to,
      startedAtSec: 8,
      endsAtSec: 8 + CONSENSUS_MEMORY_SOURCE_HANDOFF_SECONDS,
    });
    expect(deriveConsensusMemorySourceHandoff(from, from, 8)).toBeNull();
    expect(deriveConsensusMemorySourceHandoff(from, {
      ...to,
      targetCellId: 99,
      cellId: 99,
    }, 8)).toBeNull();
    expect(deriveConsensusMemorySourceHandoff({
      ...from,
      cellId: 98,
      hopIndex: 3,
    }, to, 8)).toBeNull();
    expect(deriveConsensusMemorySourceHandoff(from, to, 8, {
      reducedMotion: true,
    })).toBeNull();
  });

  it('hands evidence emphasis from the old source to the new one continuously', () => {
    const handoff = deriveConsensusMemorySourceHandoff(
      targetFocus(11, 4),
      targetFocus(12, 17),
      8,
    )!;
    const middle = 8 + CONSENSUS_MEMORY_SOURCE_HANDOFF_SECONDS / 2;
    const passive = consensusMemoryEvidenceFocusScale(11, 12);

    expect(consensusMemorySourceHandoffPhase(handoff, 8)).toBe(0);
    expect(consensusMemorySourceHandoffProgress(handoff, middle)).toBeCloseTo(0.5);
    expect(consensusMemorySourceHandoffPhase(handoff, handoff.endsAtSec)).toBe(1);
    expect(consensusMemorySourceHandoffEvidenceScale(11, 12, handoff, 8)).toBe(1);
    expect(consensusMemorySourceHandoffEvidenceScale(12, 12, handoff, 8))
      .toBe(passive);
    expect(consensusMemorySourceHandoffEvidenceScale(11, 12, handoff, middle))
      .toBeCloseTo((1 + passive) / 2);
    expect(consensusMemorySourceHandoffEvidenceScale(12, 12, handoff, middle))
      .toBeCloseTo((1 + passive) / 2);
    expect(consensusMemorySourceHandoffEvidenceScale(
      11,
      12,
      handoff,
      handoff.endsAtSec,
    )).toBe(passive);
    expect(consensusMemorySourceHandoffEvidenceScale(
      12,
      12,
      handoff,
      handoff.endsAtSec,
    )).toBe(1);
  });

  it('survives canonical lock objects being republished during the handoff', () => {
    const from = targetFocus(11, 4);
    const to = targetFocus(12, 17);
    const started = reconcileConsensusMemorySourceHandoff(
      from,
      to,
      null,
      8,
    );
    const refreshed = reconcileConsensusMemorySourceHandoff(
      to,
      { ...to },
      started.handoff,
      9,
    );

    expect(started.changed).toBe(true);
    expect(started.handoff).not.toBeNull();
    expect(refreshed.changed).toBe(false);
    expect(refreshed.handoff).toBe(started.handoff);
    expect(reconcileConsensusMemorySourceHandoff(
      refreshed.lock,
      { ...to },
      refreshed.handoff,
      9,
      { reducedMotion: true },
    )).toMatchObject({
      handoff: null,
      changed: true,
    });
  });

  it('caps each visual frame so a throttled renderer cannot skip the handoff', () => {
    const handoff = deriveConsensusMemorySourceHandoff(
      targetFocus(11, 4),
      targetFocus(12, 17),
      8,
    )!;

    expect(advanceConsensusMemorySourceHandoffTime(handoff, 8, 2))
      .toBeCloseTo(8.1);
    expect(advanceConsensusMemorySourceHandoffTime(
      handoff,
      handoff.endsAtSec - 0.02,
      2,
    )).toBe(handoff.endsAtSec);
    expect(advanceConsensusMemorySourceHandoffTime(handoff, 8.2, -1))
      .toBe(8.2);
  });

  it('collapses the old route into the target while unfolding the new route', () => {
    const handoff = deriveConsensusMemorySourceHandoff(
      targetFocus(11, 4),
      targetFocus(12, 17),
      8,
    )!;
    const middle = 8 + CONSENSUS_MEMORY_SOURCE_HANDOFF_SECONDS / 2;

    expect(consensusMemorySourceHandoffLockScale('from', handoff, 8)).toBe(1);
    expect(consensusMemorySourceHandoffLockScale('to', handoff, 8)).toBe(0);
    expect(consensusMemorySourceHandoffLockScale('from', handoff, middle))
      .toBeCloseTo(0.5);
    expect(consensusMemorySourceHandoffLockScale('to', handoff, middle))
      .toBeCloseTo(0.5);
    expect(consensusMemorySourceHandoffRouteFlareScale(
      'from',
      0,
      5,
      handoff,
      8,
    )).toBe(0);
    expect(consensusMemorySourceHandoffRouteFlareScale(
      'to',
      4,
      5,
      handoff,
      handoff.endsAtSec,
    )).toBe(0);

    const oldSourceEdge = consensusMemorySourceHandoffRouteFlareScale(
      'from', 0, 5, handoff, middle,
    );
    const oldTargetEdge = consensusMemorySourceHandoffRouteFlareScale(
      'from', 4, 5, handoff, middle,
    );
    const newSourceEdge = consensusMemorySourceHandoffRouteFlareScale(
      'to', 0, 5, handoff, middle,
    );
    const newTargetEdge = consensusMemorySourceHandoffRouteFlareScale(
      'to', 4, 5, handoff, middle,
    );
    expect(oldTargetEdge).toBeGreaterThan(oldSourceEdge);
    expect(newTargetEdge).toBeGreaterThan(newSourceEdge);
  });
});
