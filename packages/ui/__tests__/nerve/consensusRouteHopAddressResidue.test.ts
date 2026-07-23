import { describe, expect, it } from 'vitest';
import {
  CONSENSUS_ROUTE_HOP_ADDRESS_SETTLED_STRENGTH,
  consensusRouteHopAddressResidueFrame,
} from '../../src/nerve/consensusRouteHopAddressResidue';
import {
  CONSENSUS_ROUTE_HOP_PULSE_SECONDS,
  consensusMemoryRouteHopPulseFrame,
} from '../../src/nerve/consensusRouteHopPulse';

describe('consensus route-hop content address residue', () => {
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
