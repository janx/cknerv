import { fnv1a } from '../geometry/edgeBezier';
import { consensusMemoryEvidenceFingerprint } from '../derives/consensusMemoryEvidence.derive';
import type { ConsensusRouteHopPulseFrame } from './consensusRouteHopPulse';

export const CONSENSUS_ROUTE_HOP_ADDRESS_LANE_COUNT = 8;
export const CONSENSUS_ROUTE_HOP_ADDRESS_SETTLED_STRENGTH = 0.48;
export const CONSENSUS_ROUTE_HOP_ADDRESS_RESOLVE_START = 0.32;
export const CONSENSUS_ROUTE_HOP_ADDRESS_RESOLVE_END = 0.72;

export type ConsensusRouteHopAddressLanes = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface ConsensusRouteHopAddressEncoding {
  fingerprint: string;
  phase: number;
  lanes: ConsensusRouteHopAddressLanes;
}

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

function unitHash(value: string): number {
  return fnv1a(value) / 0xffff_ffff;
}

function smoothUnit(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/**
 * Eight shader lanes derived from the entire canonical content hash. Salting
 * each lane avoids treating a visible substring as the identity while keeping
 * every Cell's optical checksum stable across sessions and render quality.
 */
export function deriveConsensusRouteHopAddressEncoding(
  contentHash: string,
): ConsensusRouteHopAddressEncoding {
  const body = contentHash.trim().replace(/^0x/i, '').toLowerCase()
    || 'unavailable';
  const lanes = Array.from(
    { length: CONSENSUS_ROUTE_HOP_ADDRESS_LANE_COUNT },
    (_, index) => unitHash(`cell-address:${index}:${body}`),
  ) as unknown as ConsensusRouteHopAddressLanes;
  return {
    fingerprint: consensusMemoryEvidenceFingerprint(contentHash),
    phase: unitHash(`cell-address:phase:${body}`) * Math.PI * 2,
    lanes,
  };
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
