import { describe, expect, it } from 'vitest';
import {
  MEMORY_TRACE_FOCUS_FADE_IN_MS,
  consensusMemoryTraceFocusStrength,
  consensusMemoryTraceSourceStrength,
  type ConsensusMemoryTraceFocus,
} from '../../src/nerve/consensusMemoryTrace';
import {
  CONSENSUS_MEMORY_TRACE_RELEASE_SECONDS,
  consensusMemoryTraceIdentityKey,
  consensusMemoryTraceVisualRouteHopFocus,
  consensusMemoryTraceReleaseStrength,
  deriveConsensusMemoryTraceReentryFocus,
  deriveConsensusMemoryTraceReleaseEnvelope,
  deriveConsensusMemoryTraceReleaseFocus,
} from '../../src/nerve/consensusMemoryTraceContinuity';

function focus(
  key: string,
  startedAtSec: number,
  path: readonly number[] = [1, 3, 5],
): ConsensusMemoryTraceFocus {
  const sourceStartsAtSec = startedAtSec;
  const sourceArrivesAtSec = startedAtSec + 0.5;
  return {
    key,
    sourceKind: 'input',
    sources: [{
      id: 1,
      contentHash: '0xabc',
      outPoint: { tx_hash: '0x01', index: 0 },
      birthBlock: 10,
      startsAtSec: sourceStartsAtSec,
      arrivesAtSec: sourceArrivesAtSec,
      routes: [{
        targetId: 5,
        path,
        color: [0.2, 0.8, 1],
        hopCount: path.length - 1,
        hopMs: 250,
        startsAtSec: sourceStartsAtSec,
        arrivesAtSec: sourceArrivesAtSec,
      }],
    }],
    routedSourceCount: 1,
    targetIds: [5],
    startedAtSec,
    endsAtSec: startedAtSec + 5,
    evidenceFocusSourceId: 1,
    routeHopFocus: {
      traceKey: key,
      sourceId: 1,
      targetCellId: 5,
      cellId: path[1],
      hopIndex: 1,
    },
  };
}

describe('consensus memory trace continuity', () => {
  it('drops only a replay nonce from the stable trace identity', () => {
    expect(consensusMemoryTraceIdentityKey('18:5:2')).toBe('18:5');
    expect(consensusMemoryTraceIdentityKey('standalone')).toBe('standalone');
  });

  it('releases one verified focus and its route packets through the same envelope', () => {
    const active = focus('18:5:1', 1);
    const released = deriveConsensusMemoryTraceReleaseFocus(active, 2)!;
    const envelope = deriveConsensusMemoryTraceReleaseEnvelope(2)!;
    const midpoint = 2 + CONSENSUS_MEMORY_TRACE_RELEASE_SECONDS / 2;

    expect(released).not.toBe(active);
    expect(released.endsAtSec).toBeCloseTo(envelope.endsAtSec);
    expect(consensusMemoryTraceFocusStrength(released, 2)).toBeCloseTo(1);
    expect(consensusMemoryTraceFocusStrength(released, midpoint)).toBeCloseTo(0.5);
    expect(consensusMemoryTraceSourceStrength(released.sources[0], midpoint))
      .toBeCloseTo(1);
    expect(consensusMemoryTraceReleaseStrength(envelope, midpoint)).toBeCloseTo(0.5);
    expect(consensusMemoryTraceFocusStrength(released, envelope.endsAtSec)).toBe(0);
    expect(consensusMemoryTraceReleaseStrength(envelope, envelope.endsAtSec)).toBe(0);
  });

  it('rebinds a same-route replay without resetting endpoint or locked-hop visuals', () => {
    const released = deriveConsensusMemoryTraceReleaseFocus(
      focus('18:5:1', 1),
      2,
    )!;
    const reenteredAtSec = 2.2;
    const next = focus('18:5:2', reenteredAtSec);
    const previousStrength = consensusMemoryTraceFocusStrength(
      released,
      reenteredAtSec,
    );
    const previousSourceStrength = consensusMemoryTraceSourceStrength(
      released.sources[0],
      reenteredAtSec,
    );
    const reentered = deriveConsensusMemoryTraceReentryFocus(
      next,
      released,
      reenteredAtSec,
    );

    expect(consensusMemoryTraceFocusStrength(reentered, reenteredAtSec))
      .toBeCloseTo(previousStrength);
    expect(consensusMemoryTraceFocusStrength(reentered, reenteredAtSec - 0.01))
      .toBeCloseTo(previousStrength);
    expect(consensusMemoryTraceSourceStrength(reentered.sources[0], reenteredAtSec))
      .toBeCloseTo(previousSourceStrength);
    expect(reentered.evidenceFocusSourceId).toBe(1);
    expect(reentered.routeHopFocus).toMatchObject({
      traceKey: '18:5:2',
      sourceId: 1,
      targetCellId: 5,
      cellId: 3,
      hopIndex: 1,
    });
    expect(consensusMemoryTraceVisualRouteHopFocus(reentered, {
      ...reentered.routeHopFocus!,
      traceKey: '18:5:1',
    })).toEqual(reentered.routeHopFocus);
    expect(consensusMemoryTraceFocusStrength(
      reentered,
      reenteredAtSec + MEMORY_TRACE_FOCUS_FADE_IN_MS / 1_000,
    )).toBeCloseTo(1);
  });

  it('does not carry a stale hop or opacity floor onto different route geometry', () => {
    const released = deriveConsensusMemoryTraceReleaseFocus(
      focus('18:5:1', 1),
      2,
    )!;
    const next = focus('19:5:2', 2.2, [1, 4, 5]);

    expect(deriveConsensusMemoryTraceReentryFocus(next, released, 2.2)).toBe(next);
    expect(consensusMemoryTraceVisualRouteHopFocus(next, null)).toBeNull();
    expect(deriveConsensusMemoryTraceReleaseFocus(next, 2.2, {
      reducedMotion: true,
    })).toBeNull();
    expect(deriveConsensusMemoryTraceReleaseEnvelope(2.2, {
      reducedMotion: true,
    })).toBeNull();
  });
});
