import { describe, expect, it } from 'vitest';
import {
  CONSENSUS_ROUTE_HOP_EDGE_ARRIVAL_PROGRESS,
  CONSENSUS_ROUTE_HOP_PULSE_FRAME_PRIORITY,
  CONSENSUS_ROUTE_HOP_PULSE_SECONDS,
  advanceConsensusMemoryRouteHopPulse,
  advanceConsensusMemoryRouteHopPulseClock,
  consensusMemoryRouteHopPulseFrame,
  consensusMemoryRouteHopPulseKey,
  deriveConsensusMemoryRouteHopPulseEdges,
} from '../../src/nerve/consensusRouteHopPulse';

const focus = {
  traceKey: '18:4242:1',
  sourceId: 11,
  targetCellId: 4242,
  cellId: 99,
  hopIndex: 1,
};

describe('consensus route-hop lock pulse', () => {
  it('publishes the shared clock before default-priority frame consumers', () => {
    expect(CONSENSUS_ROUTE_HOP_PULSE_FRAME_PRIORITY).toBeLessThan(0);
  });

  it('binds every surface to the full canonical lock identity', () => {
    expect(consensusMemoryRouteHopPulseKey(focus))
      .toBe('18:4242:1:11:4242:1:99');
    expect(consensusMemoryRouteHopPulseKey({
      ...focus,
      hopIndex: 2,
      cellId: 4242,
    })).not.toBe(consensusMemoryRouteHopPulseKey(focus));
    expect(consensusMemoryRouteHopPulseKey(null)).toBeNull();
  });

  it('uses one fast-attack, quiet-decay envelope for DOM and WebGL', () => {
    const start = consensusMemoryRouteHopPulseFrame(0);
    const peak = consensusMemoryRouteHopPulseFrame(
      CONSENSUS_ROUTE_HOP_PULSE_SECONDS * 0.18,
    );
    const decay = consensusMemoryRouteHopPulseFrame(
      CONSENSUS_ROUTE_HOP_PULSE_SECONDS * 0.5,
    );
    const end = consensusMemoryRouteHopPulseFrame(
      CONSENSUS_ROUTE_HOP_PULSE_SECONDS,
    );

    expect(start).toEqual({ progress: 0, strength: 0, state: 'active' });
    expect(peak.progress).toBeCloseTo(0.18);
    expect(peak.strength).toBeCloseTo(1);
    expect(decay.strength).toBeGreaterThan(0);
    expect(decay.strength).toBeLessThan(peak.strength);
    expect(end).toEqual({ progress: 1, strength: 0, state: 'settled' });
    expect(consensusMemoryRouteHopPulseFrame(Number.POSITIVE_INFINITY))
      .toEqual(end);
  });

  it('suppresses motion while retaining an auditable reduced state', () => {
    expect(consensusMemoryRouteHopPulseFrame(0, true)).toEqual({
      progress: 1,
      strength: 0,
      state: 'reduced',
    });
  });

  it('cannot skip the visible response on one stalled render frame', () => {
    expect(advanceConsensusMemoryRouteHopPulse(0, 2)).toBe(0.1);
    expect(advanceConsensusMemoryRouteHopPulse(0.1, -1)).toBe(0.1);
    expect(advanceConsensusMemoryRouteHopPulse(
      CONSENSUS_ROUTE_HOP_PULSE_SECONDS - 0.02,
      0.1,
    )).toBe(CONSENSUS_ROUTE_HOP_PULSE_SECONDS);
  });

  it('advances one shared clock and restarts only for a different lock', () => {
    const first = advanceConsensusMemoryRouteHopPulseClock(
      null,
      focus,
      0.02,
    );
    const continued = advanceConsensusMemoryRouteHopPulseClock(
      first,
      { ...focus },
      0.03,
    );
    const changed = advanceConsensusMemoryRouteHopPulseClock(
      continued,
      { ...focus, hopIndex: 2, cellId: 4242 },
      0.02,
    );

    expect(first?.elapsedSeconds).toBeCloseTo(0.02);
    expect(continued?.elapsedSeconds).toBeCloseTo(0.05);
    expect(changed?.elapsedSeconds).toBeCloseTo(0.02);
    expect(changed?.key).not.toBe(continued?.key);
    expect(advanceConsensusMemoryRouteHopPulseClock(
      changed,
      null,
      0.02,
    )).toBeNull();
  });

  it('uses the shared clock to expose the reduced-motion state', () => {
    const clock = advanceConsensusMemoryRouteHopPulseClock(
      null,
      focus,
      0.02,
      true,
    );
    expect(clock?.frame).toEqual({
      progress: 1,
      strength: 0,
      state: 'reduced',
    });
    expect(clock?.elapsedSeconds).toBe(CONSENSUS_ROUTE_HOP_PULSE_SECONDS);
  });

  it('reuses a settled clock instead of allocating idle frame state', () => {
    let completed = advanceConsensusMemoryRouteHopPulseClock(
      null,
      focus,
      0.1,
    );
    for (let frame = 0; frame < 4; frame += 1) {
      completed = advanceConsensusMemoryRouteHopPulseClock(
        completed,
        focus,
        0.1,
      );
    }
    const reused = advanceConsensusMemoryRouteHopPulseClock(
      completed,
      focus,
      0.02,
    );
    expect(reused).toBe(completed);
  });

  it('converges over both real adjacent edges of a transit Cell', () => {
    const frame = consensusMemoryRouteHopPulseFrame(
      CONSENSUS_ROUTE_HOP_PULSE_SECONDS * 0.36,
    );
    const edges = deriveConsensusMemoryRouteHopPulseEdges(
      focus,
      [11, 99, 4242],
      frame,
    );

    expect(edges).toHaveLength(2);
    expect(edges.map((edge) => ({
      segmentIndex: edge.segmentIndex,
      endpoints: [edge.fromCellId, edge.toCellId],
      direction: edge.direction,
    }))).toEqual([
      { segmentIndex: 0, endpoints: [11, 99], direction: 1 },
      { segmentIndex: 1, endpoints: [99, 4242], direction: -1 },
    ]);
    expect(edges[0].frontT).toBe(edges[1].frontT);
    expect(edges[0].frontT).toBeGreaterThan(0);
    expect(edges[0].frontT).toBeLessThan(1);
  });

  it('uses one inward edge at route endpoints and arrives before decay ends', () => {
    const active = consensusMemoryRouteHopPulseFrame(
      CONSENSUS_ROUTE_HOP_PULSE_SECONDS
        * CONSENSUS_ROUTE_HOP_EDGE_ARRIVAL_PROGRESS,
    );
    const sourceEdges = deriveConsensusMemoryRouteHopPulseEdges(
      { ...focus, cellId: 11, hopIndex: 0 },
      [11, 99, 4242],
      active,
    );
    const targetEdges = deriveConsensusMemoryRouteHopPulseEdges(
      { ...focus, cellId: 4242, hopIndex: 2 },
      [11, 99, 4242],
      active,
    );

    expect(sourceEdges).toEqual([{
      segmentIndex: 0,
      fromCellId: 11,
      toCellId: 99,
      direction: -1,
      frontT: 1,
    }]);
    expect(targetEdges).toEqual([{
      segmentIndex: 1,
      fromCellId: 99,
      toCellId: 4242,
      direction: 1,
      frontT: 1,
    }]);
  });

  it('rejects stale paths and non-active response frames', () => {
    expect(deriveConsensusMemoryRouteHopPulseEdges(
      focus,
      [11, 100, 4242],
      consensusMemoryRouteHopPulseFrame(0.12),
    )).toEqual([]);
    expect(deriveConsensusMemoryRouteHopPulseEdges(
      focus,
      [11, 99, 4242],
      consensusMemoryRouteHopPulseFrame(CONSENSUS_ROUTE_HOP_PULSE_SECONDS),
    )).toEqual([]);
    expect(deriveConsensusMemoryRouteHopPulseEdges(
      focus,
      [11, 99, 4242],
      consensusMemoryRouteHopPulseFrame(0.12, true),
    )).toEqual([]);
  });
});
