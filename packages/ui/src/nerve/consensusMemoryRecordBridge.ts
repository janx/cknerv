import {
  consensusMemoryTraceFocusStrength,
  type ConsensusMemoryTraceFocus,
} from './consensusMemoryTrace';
import {
  consensusMemoryTraceShapeKey,
  deriveConsensusMemoryTraceReleaseFocus,
} from './consensusMemoryTraceContinuity';

/** Long enough to read as a handoff, short enough to keep recall responsive. */
export const CONSENSUS_MEMORY_RECORD_BRIDGE_MAX_SECONDS = 0.52;
export const CONSENSUS_MEMORY_RECORD_BRIDGE_MIN_SECONDS = 0.24;
export const CONSENSUS_MEMORY_RECORD_BRIDGE_ENTRY_DELAY_SECONDS = 0.1;
export const CONSENSUS_MEMORY_RECORD_PARK_SECONDS = 8;
export const CONSENSUS_MEMORY_RECORD_PARK_SETTLE_SECONDS = 0.52;
export const CONSENSUS_MEMORY_RECORD_PARK_STRENGTH = 0.18;

/**
 * Audit-only identity for two independent record layers. Deliberately carries
 * no Cell ids, route, or edge: a record switch is not transaction lineage.
 */
export interface ConsensusMemoryRecordBridge {
  fromShapeKey: string;
  toShapeKey: string;
  startedAtSec: number;
  endsAtSec: number;
}

export interface ConsensusMemoryRecordBridgePresentation {
  bridge: ConsensusMemoryRecordBridge;
  departingFocus: ConsensusMemoryTraceFocus;
  arrivingFocus: ConsensusMemoryTraceFocus;
}

/**
 * Condense a finishing recall into a quiet endpoint memory while another Cell
 * is being inspected. Routes keep their original identity but receive no new
 * lifetime or cross-record edge; the normal packet afterimage may finish.
 */
export function deriveConsensusMemoryRecordParkFocus(
  focus: ConsensusMemoryTraceFocus | null,
  nowSec: number,
  options: { reducedMotion?: boolean } = {},
): ConsensusMemoryTraceFocus | null {
  if (
    options.reducedMotion
    || !focus
    || !Number.isFinite(nowSec)
    || focus.visualContinuity?.mode === 'park'
  ) return null;
  const startStrength = consensusMemoryTraceFocusStrength(focus, nowSec);
  if (startStrength <= 0.001) return null;
  const endsAtSec = nowSec + CONSENSUS_MEMORY_RECORD_PARK_SECONDS;
  return {
    ...focus,
    endsAtSec,
    evidenceFocusSourceId: null,
    routeHopFocus: null,
    visualContinuity: {
      mode: 'park',
      floorStrength: Math.min(
        startStrength,
        CONSENSUS_MEMORY_RECORD_PARK_STRENGTH,
      ),
      startStrength,
      startedAtSec: nowSec,
      settlesAtSec: nowSec + CONSENSUS_MEMORY_RECORD_PARK_SETTLE_SECONDS,
      endsAtSec,
    },
  };
}

/**
 * Keep the old verified composition on its own release envelope and let the
 * new verified composition emerge on a separate entry envelope. The result
 * never merges either record's routes and therefore cannot invent a causal
 * edge between their endpoints.
 */
export function deriveConsensusMemoryRecordBridge(
  previous: ConsensusMemoryTraceFocus | null,
  next: ConsensusMemoryTraceFocus | null,
  nowSec: number,
  options: { reducedMotion?: boolean } = {},
): ConsensusMemoryRecordBridgePresentation | null {
  if (
    options.reducedMotion
    || !previous
    || !next
    || !Number.isFinite(nowSec)
  ) return null;

  const fromShapeKey = consensusMemoryTraceShapeKey(previous);
  const toShapeKey = consensusMemoryTraceShapeKey(next);
  if (!fromShapeKey || !toShapeKey || fromShapeKey === toShapeKey) return null;

  const previousStrength = consensusMemoryTraceFocusStrength(previous, nowSec);
  if (previousStrength <= 0.001) return null;
  const releaseFocus = deriveConsensusMemoryTraceReleaseFocus(previous, nowSec);
  if (!releaseFocus) return null;

  const scaledDuration = CONSENSUS_MEMORY_RECORD_BRIDGE_MIN_SECONDS
    + (CONSENSUS_MEMORY_RECORD_BRIDGE_MAX_SECONDS
      - CONSENSUS_MEMORY_RECORD_BRIDGE_MIN_SECONDS) * previousStrength;
  const existingReleaseRemaining = previous.visualContinuity?.mode === 'release'
    ? Math.max(0, previous.endsAtSec - nowSec)
    : Number.POSITIVE_INFINITY;
  const duration = Math.min(scaledDuration, existingReleaseRemaining);
  if (!(duration > 0.001)) return null;
  const endsAtSec = nowSec + duration;
  const departingFocus: ConsensusMemoryTraceFocus = {
    ...releaseFocus,
    endsAtSec,
    visualContinuity: {
      mode: 'release',
      floorStrength: previousStrength,
      startedAtSec: nowSec,
      endsAtSec,
    },
  };
  const entryDelay = Math.min(
    CONSENSUS_MEMORY_RECORD_BRIDGE_ENTRY_DELAY_SECONDS,
    duration * 0.25,
  );
  const bridge: ConsensusMemoryRecordBridge = {
    fromShapeKey,
    toShapeKey,
    startedAtSec: nowSec,
    endsAtSec,
  };
  return {
    bridge,
    departingFocus,
    arrivingFocus: {
      ...next,
      visualContinuity: {
        mode: 'entry',
        floorStrength: 0,
        startedAtSec: nowSec + entryDelay,
        endsAtSec,
      },
    },
  };
}
