import type { CellVisualDescriptor } from './cellVisual.derive';

export type ConsensusMemoryCoreSemantic = readonly [
  asset: number,
  lock: number,
  payload: number,
  mass: number,
];

export interface ConsensusMemoryCoreIdentity {
  /** Normalized on-chain fields consumed by the far retained-core shader. */
  semantic: ConsensusMemoryCoreSemantic;
  /** Stable content-hash word controlling gaps without depending on draw order. */
  hashSeed: number;
}

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Preserve the canonical A field mapping at far distance. The detailed braid
 * carries full topology; this compact signature only keeps those distinctions
 * legible once the Cell collapses into a point sprite.
 */
export function consensusMemoryCoreIdentity(
  visual: CellVisualDescriptor,
): ConsensusMemoryCoreIdentity {
  return {
    semantic: [
      clampUnit(visual.assetClass / 5),
      clampUnit(visual.lockClass / 4),
      clampUnit(visual.payload),
      clampUnit((visual.mass - 0.84) / 0.36),
    ],
    hashSeed: clampUnit(visual.seeds[2]),
  };
}
