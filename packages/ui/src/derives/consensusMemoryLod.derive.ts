/**
 * Shared handoff between the compact retained record on the Cell point and
 * the expanded A braid. Keeping both sides on one smoothstep makes the
 * semantic signal continuous instead of additively doubling at mid distance.
 */
export const CONSENSUS_MEMORY_HANDOFF_START = 0.38;
export const CONSENSUS_MEMORY_HANDOFF_END = 1;

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothUnit(value: number): number {
  const clamped = clampUnit(value);
  return clamped * clamped * (3 - 2 * clamped);
}

export function consensusMemoryExpandedVisibility(detail: number): number {
  const finiteDetail = Number.isFinite(detail) ? detail : 0;
  return smoothUnit(
    (finiteDetail - CONSENSUS_MEMORY_HANDOFF_START)
      / (CONSENSUS_MEMORY_HANDOFF_END - CONSENSUS_MEMORY_HANDOFF_START),
  );
}

export function consensusMemoryCompactVisibility(detail: number): number {
  return 1 - consensusMemoryExpandedVisibility(detail);
}
