import type { ConsensusRouteHopPulseFrame } from './consensusRouteHopPulse';

export const CONSENSUS_ROUTE_HOP_ADDRESS_SETTLED_STRENGTH = 0.48;
export const CONSENSUS_ROUTE_HOP_ADDRESS_RESOLVE_START = 0.32;
export const CONSENSUS_ROUTE_HOP_ADDRESS_RESOLVE_END = 0.72;

export type ConsensusRouteHopAddressResidueState =
  | 'hidden'
  | 'resolving'
  | 'resolved'
  | 'reduced';

export interface ConsensusRouteHopAddressResidueFrame {
  reveal: number;
  strength: number;
  state: ConsensusRouteHopAddressResidueState;
}

function smoothUnit(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/**
 * The checksum resolves only after the edge response is already converging,
 * then remains as a quiet static fact for as long as this Cell stays locked.
 */
export function consensusRouteHopAddressResidueFrame(
  pulse: ConsensusRouteHopPulseFrame,
  hasCanonicalLock: boolean,
): ConsensusRouteHopAddressResidueFrame {
  if (!hasCanonicalLock) {
    return { reveal: 0, strength: 0, state: 'hidden' };
  }
  if (pulse.state === 'reduced') {
    return {
      reveal: 1,
      strength: CONSENSUS_ROUTE_HOP_ADDRESS_SETTLED_STRENGTH,
      state: 'reduced',
    };
  }
  if (pulse.state === 'settled') {
    return {
      reveal: 1,
      strength: CONSENSUS_ROUTE_HOP_ADDRESS_SETTLED_STRENGTH,
      state: 'resolved',
    };
  }
  const reveal = smoothUnit(
    (pulse.progress - CONSENSUS_ROUTE_HOP_ADDRESS_RESOLVE_START)
      / (
        CONSENSUS_ROUTE_HOP_ADDRESS_RESOLVE_END
        - CONSENSUS_ROUTE_HOP_ADDRESS_RESOLVE_START
      ),
  );
  if (reveal <= 0.001) {
    return { reveal: 0, strength: 0, state: 'hidden' };
  }
  return {
    reveal,
    strength: reveal * (
      CONSENSUS_ROUTE_HOP_ADDRESS_SETTLED_STRENGTH
      + pulse.strength * 0.34
    ),
    state: 'resolving',
  };
}
