import { HUD_MOTION } from '../components/hud/hudTheme';
import type { ConsensusMemoryRouteHopFocus } from './consensusMemoryTrace';

/** One shared lock-response beat for the HUD ledger and the spatial glyph.
 *
 *  It is `HUD_MOTION.enter` and not a beat of its own: a hop locking is a
 *  thing ARRIVING — the mark travels from unlocked to locked and there is a
 *  distance in it to read — which is exactly what that rung is for. It was
 *  480 ms, a number nothing else in the HUD wore, on a custom bezier 0.02
 *  from the card's; both fold into the ladder (E1). */
export const CONSENSUS_ROUTE_HOP_PULSE_MS = HUD_MOTION.enter;
export const CONSENSUS_ROUTE_HOP_PULSE_SECONDS =
  CONSENSUS_ROUTE_HOP_PULSE_MS / 1_000;
export const CONSENSUS_ROUTE_HOP_PULSE_MAX_FRAME_SECONDS = 0.1;
/** Publish before default-priority marker/material frame consumers. */
export const CONSENSUS_ROUTE_HOP_PULSE_FRAME_PRIORITY = -1;

export type ConsensusRouteHopPulseState = 'active' | 'settled' | 'reduced';

export interface ConsensusRouteHopPulseFrame {
  progress: number;
  strength: number;
  state: ConsensusRouteHopPulseState;
}

/** One raw-frame clock shared by the Cell glyph and its real adjacent edges. */
export interface ConsensusMemoryRouteHopPulseClock {
  key: string;
  focus: ConsensusMemoryRouteHopFocus;
  elapsedSeconds: number;
  frame: ConsensusRouteHopPulseFrame;
}

export interface ConsensusMemoryRouteHopPulseEdge {
  segmentIndex: number;
  fromCellId: number;
  toCellId: number;
  /** Travel direction on the route-order Bezier; -1 keeps its geometry intact. */
  direction: 1 | -1;
  frontT: number;
}

/** The inward edge wave reaches the locked Cell before the optical tail ends. */
export const CONSENSUS_ROUTE_HOP_EDGE_ARRIVAL_PROGRESS = 0.62;

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

/**
 * Advance one lock response independently of the simulation clock. A changed
 * canonical key starts a fresh response; clearing the lock clears the clock.
 */
export function advanceConsensusMemoryRouteHopPulseClock(
  current: ConsensusMemoryRouteHopPulseClock | null,
  focus: ConsensusMemoryRouteHopFocus | null,
  rawDeltaSeconds: number,
  reducedMotion = false,
): ConsensusMemoryRouteHopPulseClock | null {
  const key = consensusMemoryRouteHopPulseKey(focus);
  if (!focus || !key) return null;
  const settledState: ConsensusRouteHopPulseState = reducedMotion
    ? 'reduced'
    : 'settled';
  if (
    current?.key === key
    && current.elapsedSeconds >= CONSENSUS_ROUTE_HOP_PULSE_SECONDS
    && current.frame.state === settledState
  ) return current;
  if (reducedMotion) {
    return {
      key,
      focus,
      elapsedSeconds: CONSENSUS_ROUTE_HOP_PULSE_SECONDS,
      frame: consensusMemoryRouteHopPulseFrame(0, true),
    };
  }
  const elapsedSeconds = advanceConsensusMemoryRouteHopPulse(
    current?.key === key ? current.elapsedSeconds : 0,
    rawDeltaSeconds,
  );
  return {
    key,
    focus,
    elapsedSeconds,
    frame: consensusMemoryRouteHopPulseFrame(elapsedSeconds),
  };
}

/**
 * Plan only the one or two retained route edges touching the locked Cell.
 * Both wavefronts travel inward, so a transit Cell reads as address agreement
 * converging from its immediate route neighbours rather than a new packet.
 */
export function deriveConsensusMemoryRouteHopPulseEdges(
  focus: ConsensusMemoryRouteHopFocus | null,
  path: readonly number[],
  frame: ConsensusRouteHopPulseFrame,
): ConsensusMemoryRouteHopPulseEdge[] {
  if (
    !focus
    || frame.state !== 'active'
    || frame.strength <= 0.001
    || path.length < 2
    || path[0] !== focus.sourceId
    || path.at(-1) !== focus.targetCellId
    || path[focus.hopIndex] !== focus.cellId
  ) return [];

  const frontT = smoothstep01(
    frame.progress / CONSENSUS_ROUTE_HOP_EDGE_ARRIVAL_PROGRESS,
  );
  const edges: ConsensusMemoryRouteHopPulseEdge[] = [];
  if (focus.hopIndex > 0) {
    edges.push({
      segmentIndex: focus.hopIndex - 1,
      fromCellId: path[focus.hopIndex - 1],
      toCellId: focus.cellId,
      direction: 1,
      frontT,
    });
  }
  if (focus.hopIndex < path.length - 1) {
    edges.push({
      segmentIndex: focus.hopIndex,
      fromCellId: focus.cellId,
      toCellId: path[focus.hopIndex + 1],
      direction: -1,
      frontT,
    });
  }
  return edges;
}
