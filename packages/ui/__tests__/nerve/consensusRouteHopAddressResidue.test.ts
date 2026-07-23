import { describe, expect, it } from 'vitest';
import {
  CONSENSUS_ROUTE_HOP_ADDRESS_LANE_COUNT,
  CONSENSUS_ROUTE_HOP_ADDRESS_SETTLED_STRENGTH,
  consensusRouteHopAddressResidueFrame,
  deriveConsensusRouteHopAddressEncoding,
} from '../../src/nerve/consensusRouteHopAddressResidue';
import {
  CONSENSUS_ROUTE_HOP_PULSE_SECONDS,
  consensusMemoryRouteHopPulseFrame,
} from '../../src/nerve/consensusRouteHopPulse';

const HASH = `0x${'0123456789abcdef'.repeat(4)}`;

describe('consensus route-hop content address residue', () => {
  it('derives one stable eight-lane encoding from the complete content hash', () => {
    const first = deriveConsensusRouteHopAddressEncoding(HASH);
    const repeated = deriveConsensusRouteHopAddressEncoding(HASH);

    expect(first).toEqual(repeated);
    expect(first.fingerprint).toBe('0123456·CDEF');
    expect(first.lanes).toHaveLength(CONSENSUS_ROUTE_HOP_ADDRESS_LANE_COUNT);
    expect(first.lanes.every((lane) => lane >= 0 && lane <= 1)).toBe(true);
    expect(first.phase).toBeGreaterThanOrEqual(0);
    expect(first.phase).toBeLessThan(Math.PI * 2);
  });

  it('changes the optical checksum when even the final hash nibble changes', () => {
    const original = deriveConsensusRouteHopAddressEncoding(HASH);
    const changed = deriveConsensusRouteHopAddressEncoding(
      `${HASH.slice(0, -1)}e`,
    );

    expect(changed.fingerprint).not.toBe(original.fingerprint);
    expect(changed.phase).not.toBe(original.phase);
    expect(changed.lanes).not.toEqual(original.lanes);
  });

  it('waits for edge convergence, then retains a quiet resolved address', () => {
    const early = consensusRouteHopAddressResidueFrame(
      consensusMemoryRouteHopPulseFrame(0.08),
      true,
    );
    const resolving = consensusRouteHopAddressResidueFrame(
      consensusMemoryRouteHopPulseFrame(
        CONSENSUS_ROUTE_HOP_PULSE_SECONDS * 0.625,
      ),
      true,
    );
    const settled = consensusRouteHopAddressResidueFrame(
      consensusMemoryRouteHopPulseFrame(CONSENSUS_ROUTE_HOP_PULSE_SECONDS),
      true,
    );

    expect(early).toEqual({ reveal: 0, strength: 0, state: 'hidden' });
    expect(resolving.state).toBe('resolving');
    expect(resolving.reveal).toBeGreaterThan(0.5);
    expect(resolving.strength)
      .toBeGreaterThan(CONSENSUS_ROUTE_HOP_ADDRESS_SETTLED_STRENGTH);
    expect(settled).toEqual({
      reveal: 1,
      strength: CONSENSUS_ROUTE_HOP_ADDRESS_SETTLED_STRENGTH,
      state: 'resolved',
    });
  });

  it('resolves immediately for reduced motion and disappears without a lock', () => {
    expect(consensusRouteHopAddressResidueFrame(
      consensusMemoryRouteHopPulseFrame(0, true),
      true,
    )).toEqual({
      reveal: 1,
      strength: CONSENSUS_ROUTE_HOP_ADDRESS_SETTLED_STRENGTH,
      state: 'reduced',
    });
    expect(consensusRouteHopAddressResidueFrame(
      consensusMemoryRouteHopPulseFrame(CONSENSUS_ROUTE_HOP_PULSE_SECONDS),
      false,
    )).toEqual({ reveal: 0, strength: 0, state: 'hidden' });
  });
});
