import { describe, expect, it } from 'vitest';
import {
  CONSENSUS_ROUTE_HOP_PULSE_SECONDS,
  advanceConsensusMemoryRouteHopPulse,
  consensusMemoryRouteHopPulseFrame,
  consensusMemoryRouteHopPulseKey,
} from '../../src/nerve/consensusRouteHopPulse';

const focus = {
  traceKey: '18:4242:1',
  sourceId: 11,
  targetCellId: 4242,
  cellId: 99,
  hopIndex: 1,
};

describe('consensus route-hop lock pulse', () => {
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
});
