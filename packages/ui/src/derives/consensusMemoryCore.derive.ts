export interface ConsensusMemoryCoreEnergy {
  /** Moving read-head energy while routed evidence is still unresolved. */
  reading: number;
  /** Stable agreement energy retained by the Cell once evidence converges. */
  retained: number;
}

/** A faint moving read remains so the stored structure keeps its provenance. */
export const CONSENSUS_MEMORY_CORE_READ_FLOOR = 0.1;
/** Non-linear release lets the Cell outlast the collapsing route aperture. */
export const CONSENSUS_MEMORY_CORE_RELEASE_EXPONENT = 0.5;

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

const smoothUnit = (value: number): number => {
  const clamped = clampUnit(value);
  return clamped * clamped * (3 - 2 * clamped);
};

/**
 * Hand visual priority from a moving historical read into the Cell's existing
 * agreement structure. Retained energy releases more slowly than the route
 * aperture, but still becomes exactly zero when the explicit recall ends; it
 * is a display-only read state, never a persistent write mark.
 */
export function consensusMemoryCoreEnergy(
  strength: number,
  convergence: number,
): ConsensusMemoryCoreEnergy {
  const recall = Number.isFinite(strength) ? clampUnit(strength) : 0;
  const resolved = Number.isFinite(convergence)
    ? smoothUnit(convergence)
    : 0;
  return {
    reading: recall * (
      1 - resolved * (1 - CONSENSUS_MEMORY_CORE_READ_FLOOR)
    ),
    retained: recall ** CONSENSUS_MEMORY_CORE_RELEASE_EXPONENT * resolved,
  };
}
