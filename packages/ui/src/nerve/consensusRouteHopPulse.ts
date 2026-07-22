import type { ConsensusMemoryRouteHopFocus } from './consensusMemoryTrace';

/** One shared lock-response beat for the HUD ledger and the spatial glyph. */
export const CONSENSUS_ROUTE_HOP_PULSE_SECONDS = 0.48;
export const CONSENSUS_ROUTE_HOP_PULSE_MS =
  CONSENSUS_ROUTE_HOP_PULSE_SECONDS * 1_000;
export const CONSENSUS_ROUTE_HOP_PULSE_MAX_FRAME_SECONDS = 0.1;

export type ConsensusRouteHopPulseState = 'active' | 'settled' | 'reduced';

export interface ConsensusRouteHopPulseFrame {
  progress: number;
  strength: number;
  state: ConsensusRouteHopPulseState;
}

/** Stable identity shared by every visual surface bound to one exact lock. */
export function consensusMemoryRouteHopPulseKey(
  focus: ConsensusMemoryRouteHopFocus | null,
): string | null {
  if (!focus) return null;
  return [
    focus.traceKey,
    focus.sourceId,
    focus.targetCellId,
    focus.hopIndex,
    focus.cellId,
  ].join(':');
}

function smoothstep01(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/** Keep one long render hitch from consuming the entire optical response. */
export function advanceConsensusMemoryRouteHopPulse(
  elapsedSeconds: number,
  rawDeltaSeconds: number,
): number {
  const elapsed = Number.isFinite(elapsedSeconds)
    ? Math.max(0, elapsedSeconds)
    : CONSENSUS_ROUTE_HOP_PULSE_SECONDS;
  const delta = Number.isFinite(rawDeltaSeconds)
    ? Math.min(
      CONSENSUS_ROUTE_HOP_PULSE_MAX_FRAME_SECONDS,
      Math.max(0, rawDeltaSeconds),
    )
    : 0;
  return Math.min(CONSENSUS_ROUTE_HOP_PULSE_SECONDS, elapsed + delta);
}

/**
 * Fast optical acknowledgement followed by a long, quiet decay. The envelope
 * is deterministic so DOM keyframes and the WebGL echo read as one event.
 */
export function consensusMemoryRouteHopPulseFrame(
  elapsedSeconds: number,
  reducedMotion = false,
): ConsensusRouteHopPulseFrame {
  if (reducedMotion) {
    return { progress: 1, strength: 0, state: 'reduced' };
  }
  const elapsed = Number.isFinite(elapsedSeconds)
    ? Math.max(0, elapsedSeconds)
    : CONSENSUS_ROUTE_HOP_PULSE_SECONDS;
  const progress = Math.min(
    1,
    elapsed / CONSENSUS_ROUTE_HOP_PULSE_SECONDS,
  );
  if (progress >= 1) {
    return { progress: 1, strength: 0, state: 'settled' };
  }
  const attackEnd = 0.18;
  const attack = smoothstep01(progress / attackEnd);
  const decay = 1 - smoothstep01(
    (progress - attackEnd) / (1 - attackEnd),
  );
  return {
    progress,
    strength: attack * decay,
    state: 'active',
  };
}
