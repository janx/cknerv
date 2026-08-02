export interface ConsensusMemoryCoreEnergy {
  /** Moving read-head energy while routed evidence is still unresolved. */
  reading: number;
  /** Stable agreement energy retained by the Cell once evidence converges. */
  retained: number;
}

export interface ConsensusMemoryAmbientFlowFrame {
  /** Wrapped LineMaterial distance offset for one deterministic Cell phase. */
  dashOffset: number;
  /** Bounded multiplier applied to the semantic stream-flow opacity. */
  opacityScale: number;
}

/** Model-space cadence: deliberately slower than packets and trace read-heads. */
export const CONSENSUS_MEMORY_AMBIENT_FLOW_SPEED = 0.035;
/** One sparse highlight followed by a long unlit interval. */
export const CONSENSUS_MEMORY_AMBIENT_FLOW_PERIOD = 1;

/** A faint moving read remains so the stored structure keeps its provenance. */
export const CONSENSUS_MEMORY_CORE_READ_FLOOR = 0.1;
/** Non-linear release lets the Cell outlast the collapsing route aperture. */
export const CONSENSUS_MEMORY_CORE_RELEASE_EXPONENT = 0.5;

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

const smoothUnit = (value: number): number => {
  const clamped = clampUnit(value);
  return clamped * clamped * (3 - 2 * clamped);
};

const wrapUnit = (value: number): number => {
  const finite = Number.isFinite(value) ? value : 0;
  return ((finite % 1) + 1) % 1;
};

/**
 * Persistent, non-data-bearing energy for the detail portrait. Live Cells
 * drift and breathe; reduced-motion and spent Cells retain a deterministic
 * still glint so the structural line never disappears.
 */
export function consensusMemoryAmbientFlowFrame(
  elapsedS: number,
  stablePhase: number,
  live: boolean,
  reducedMotion: boolean,
): ConsensusMemoryAmbientFlowFrame {
  const phase = wrapUnit(stablePhase);
  const elapsed = Number.isFinite(elapsedS) ? Math.max(0, elapsedS) : 0;
  const moving = live && !reducedMotion;
  const distance = phase * CONSENSUS_MEMORY_AMBIENT_FLOW_PERIOD
    + (moving ? elapsed * CONSENSUS_MEMORY_AMBIENT_FLOW_SPEED : 0);
  const wrappedDistance = (
    (distance % CONSENSUS_MEMORY_AMBIENT_FLOW_PERIOD)
    + CONSENSUS_MEMORY_AMBIENT_FLOW_PERIOD
  ) % CONSENSUS_MEMORY_AMBIENT_FLOW_PERIOD;

  if (!live) {
    return { dashOffset: -wrappedDistance, opacityScale: 0.18 };
  }
  if (reducedMotion) {
    return { dashOffset: -wrappedDistance, opacityScale: 0.62 };
  }

  const breath = 0.84 + Math.sin(elapsed * 0.38 + phase * Math.PI * 2) * 0.16;
  return { dashOffset: -wrappedDistance, opacityScale: breath };
}

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
