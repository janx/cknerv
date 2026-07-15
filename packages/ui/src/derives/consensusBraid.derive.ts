import * as THREE from 'three';
import type { CellVisualDescriptor } from './cellVisual.derive';

export const CONSENSUS_BRAID_TAU = Math.PI * 2;

export const CONSENSUS_BRAID_FIELDS = [
  'capacity',
  'asset',
  'lock',
  'data',
  'state',
  'born',
] as const;

export type ConsensusBraidField = (typeof CONSENSUS_BRAID_FIELDS)[number];

export const CONSENSUS_BRAID_PALETTE = {
  deepCyan: [0.035, 0.28, 0.62],
  gold: [0.86, 0.61, 0.25],
  paleGold: [1, 0.84, 0.5],
  cyan: [0.1, 0.82, 1],
  violet: [0.4, 0.2, 1],
  pale: [0.72, 0.96, 1],
  retire: [0.94, 0.12, 0.46],
} as const;

export interface ConsensusBraidSpec {
  a: number;
  b: number;
  c: number;
  phase: number;
  offset: number;
}

export function consensusBraidFrequencies(
  assetClass: number,
): readonly [number, number, number] {
  const asset = Math.round(assetClass);
  if (asset === 1) return [2, 3, 5];
  if (asset === 2) return [3, 4, 7];
  if (asset === 3) return [1, 3, 5];
  if (asset === 4) return [3, 5, 6];
  if (asset === 5) return [2, 5, 7];
  return [2, 3, 4];
}

export function consensusBraidStrandCount(lockClass: number): number {
  return 3 + Math.min(2, Math.round(lockClass / 2));
}

/** Intended agreement-node count used by the full A portrait. */
export function consensusBraidAgreementTarget(
  visual: CellVisualDescriptor,
): number {
  const contributorPairs = Math.max(0, consensusBraidStrandCount(visual.lockClass) - 1);
  return contributorPairs * (1 + Math.round(visual.payload * 2));
}

/** Birth block becomes a stable packet phase, wrapping only for precision. */
export function consensusBraidBirthPhase(birthBlock: number): number {
  const wrapped = ((Math.trunc(birthBlock) % 4096) + 4096) % 4096;
  return wrapped / 4096 * CONSENSUS_BRAID_TAU;
}

export interface ConsensusBraidLayerOpacity {
  ribbon: number;
  streamGlow: number;
  streamCore: number;
  stitchGlow: number;
  stitchCore: number;
  agreementGlow: number;
  agreementCore: number;
  knotGlow: number;
  knotCore: number;
  packet: number;
}

/** Readable A grammar: one on-chain field emphasizes one visual layer. */
export function consensusBraidLayerOpacity(
  focusField: ConsensusBraidField | null,
  strandCount: number,
): ConsensusBraidLayerOpacity {
  const normal: ConsensusBraidLayerOpacity = {
    ribbon: Math.max(0.25, 0.38 - (strandCount - 3) * 0.05),
    streamGlow: 0.045,
    streamCore: 0.74 - (strandCount - 3) * 0.1,
    stitchGlow: 0.055,
    stitchCore: 0.72,
    agreementGlow: 0.13,
    agreementCore: 0.96,
    knotGlow: 0.18,
    knotCore: 0.98,
    packet: 0.9,
  };
  if (focusField === 'capacity') {
    return {
      ribbon: 0.56,
      streamGlow: 0.025,
      streamCore: 0.22,
      stitchGlow: 0.018,
      stitchCore: 0.12,
      agreementGlow: 0.025,
      agreementCore: 0.16,
      knotGlow: 0.06,
      knotCore: 0.2,
      packet: 0.16,
    };
  }
  if (focusField === 'asset') {
    return {
      ribbon: 0.14,
      streamGlow: 0.1,
      streamCore: 0.98,
      stitchGlow: 0.02,
      stitchCore: 0.16,
      agreementGlow: 0.025,
      agreementCore: 0.18,
      knotGlow: 0.07,
      knotCore: 0.24,
      packet: 0.16,
    };
  }
  if (focusField === 'lock') {
    return {
      ribbon: 0.42,
      streamGlow: 0.07,
      streamCore: 0.86,
      stitchGlow: 0.035,
      stitchCore: 0.28,
      agreementGlow: 0.025,
      agreementCore: 0.18,
      knotGlow: 0.06,
      knotCore: 0.22,
      packet: 0.18,
    };
  }
  if (focusField === 'data') {
    return {
      ribbon: 0.1,
      streamGlow: 0.025,
      streamCore: 0.2,
      stitchGlow: 0.12,
      stitchCore: 0.92,
      agreementGlow: 0.2,
      agreementCore: 1,
      knotGlow: 0.3,
      knotCore: 1,
      packet: 0.96,
    };
  }
  if (focusField === 'born') {
    return {
      ribbon: 0.08,
      streamGlow: 0.02,
      streamCore: 0.14,
      stitchGlow: 0.018,
      stitchCore: 0.12,
      agreementGlow: 0.025,
      agreementCore: 0.16,
      knotGlow: 0.06,
      knotCore: 0.2,
      packet: 1,
    };
  }
  // STATE reads the integrity of the whole structure, so it intentionally
  // preserves the complete balance; ConsensusMemory adds a restrained pulse.
  return normal;
}

/** Canonical A mapping shared by the portrait and the galaxy LOD. */
export function consensusBraidSpecs(
  visual: CellVisualDescriptor,
): ConsensusBraidSpec[] {
  const [a, b, c] = consensusBraidFrequencies(visual.assetClass);
  const count = consensusBraidStrandCount(visual.lockClass);
  return Array.from({ length: count }, (_, strand) => ({
    a,
    b,
    c,
    phase: visual.seeds[strand % 4] * CONSENSUS_BRAID_TAU,
    offset: (strand - (count - 1) * 0.5) * 0.23,
  }));
}

export function consensusBraidPoint(
  spec: ConsensusBraidSpec,
  t: number,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  return target.set(
    Math.sin(spec.a * t + spec.phase + spec.offset) * 0.48,
    Math.sin(spec.b * t + spec.phase * 0.61 - spec.offset * 0.72) * 0.37,
    Math.sin(spec.c * t - spec.phase * 0.43 + spec.offset * 0.5) * 0.29,
  );
}

export function consensusBraidContributorColor(
  strand: number,
  spectral: number,
): readonly [number, number, number] {
  const mix = (
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    amount: number,
  ): readonly [number, number, number] => [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
  if (strand % 3 === 0) {
    return mix(
      CONSENSUS_BRAID_PALETTE.gold,
      CONSENSUS_BRAID_PALETTE.paleGold,
      spectral * 0.2,
    );
  }
  if (strand % 3 === 1) {
    return mix(
      CONSENSUS_BRAID_PALETTE.cyan,
      CONSENSUS_BRAID_PALETTE.pale,
      spectral * 0.16,
    );
  }
  return mix(
    CONSENSUS_BRAID_PALETTE.violet,
    CONSENSUS_BRAID_PALETTE.cyan,
    0.3 + spectral * 0.34,
  );
}
