import {
  consensusMemoryEvidenceFocusScale,
  consensusMemoryRouteHopFocusEqual,
  type ConsensusMemoryRouteHopFocus,
} from './consensusMemoryTrace';

export const CONSENSUS_MEMORY_SOURCE_HANDOFF_SECONDS = 0.78;
export const CONSENSUS_MEMORY_SOURCE_HANDOFF_MAX_FRAME_SECONDS = 0.1;

export interface ConsensusMemorySourceHandoff {
  from: ConsensusMemoryRouteHopFocus;
  to: ConsensusMemoryRouteHopFocus;
  startedAtSec: number;
  endsAtSec: number;
}

export type ConsensusMemorySourceHandoffSide = 'from' | 'to';

export interface ConsensusMemorySourceHandoffState {
  lock: ConsensusMemoryRouteHopFocus | null;
  handoff: ConsensusMemorySourceHandoff | null;
  changed: boolean;
}

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

const smoothUnit = (value: number): number => {
  const t = clampUnit(value);
  return t * t * (3 - 2 * t);
};

/**
 * A signature switch may crossfade only two verified routes into the same
 * maintained record. Different targets still snap so the visual never draws
 * a relationship that is absent from the retained trace.
 */
export function deriveConsensusMemorySourceHandoff(
  previous: ConsensusMemoryRouteHopFocus | null,
  next: ConsensusMemoryRouteHopFocus | null,
  startedAtSec: number,
  options: { reducedMotion?: boolean } = {},
): ConsensusMemorySourceHandoff | null {
  if (
    options.reducedMotion
    || !previous
    || !next
    || !Number.isFinite(startedAtSec)
    || previous.sourceId === next.sourceId
    || previous.traceKey !== next.traceKey
    || previous.targetCellId !== next.targetCellId
    || previous.cellId !== previous.targetCellId
    || next.cellId !== next.targetCellId
  ) return null;

  return {
    from: previous,
    to: next,
    startedAtSec,
    endsAtSec: startedAtSec + CONSENSUS_MEMORY_SOURCE_HANDOFF_SECONDS,
  };
}

/**
 * Retain an active handoff when the reducer republishes the same canonical
 * lock as a fresh object. Only a semantic lock change may restart or clear the
 * transition; otherwise routine trace-readout refreshes would erase it before
 * the next rendered frame.
 */
export function reconcileConsensusMemorySourceHandoff(
  previousLock: ConsensusMemoryRouteHopFocus | null,
  nextLock: ConsensusMemoryRouteHopFocus | null,
  currentHandoff: ConsensusMemorySourceHandoff | null,
  startedAtSec: number,
  options: { reducedMotion?: boolean } = {},
): ConsensusMemorySourceHandoffState {
  if (consensusMemoryRouteHopFocusEqual(previousLock, nextLock)) {
    const handoff = options.reducedMotion ? null : currentHandoff;
    return {
      lock: nextLock,
      handoff,
      changed: handoff !== currentHandoff,
    };
  }
  return {
    lock: nextLock,
    handoff: deriveConsensusMemorySourceHandoff(
      previousLock,
      nextLock,
      startedAtSec,
      options,
    ),
    changed: true,
  };
}

export function consensusMemorySourceHandoffPhase(
  handoff: ConsensusMemorySourceHandoff | null,
  nowSec: number,
): number {
  if (!handoff || !Number.isFinite(nowSec)) return 1;
  const duration = handoff.endsAtSec - handoff.startedAtSec;
  if (!(duration > 0)) return 1;
  return clampUnit((nowSec - handoff.startedAtSec) / duration);
}

export function consensusMemorySourceHandoffProgress(
  handoff: ConsensusMemorySourceHandoff | null,
  nowSec: number,
): number {
  return smoothUnit(consensusMemorySourceHandoffPhase(handoff, nowSec));
}

/** Keep a handoff legible under a throttled tab or an overloaded GPU. */
export function advanceConsensusMemorySourceHandoffTime(
  handoff: ConsensusMemorySourceHandoff | null,
  currentTimeSec: number,
  rawDeltaSec: number,
): number {
  if (!handoff) return currentTimeSec;
  const current = Number.isFinite(currentTimeSec)
    ? Math.max(handoff.startedAtSec, currentTimeSec)
    : handoff.startedAtSec;
  const delta = Number.isFinite(rawDeltaSec)
    ? Math.max(0, Math.min(
      CONSENSUS_MEMORY_SOURCE_HANDOFF_MAX_FRAME_SECONDS,
      rawDeltaSec,
    ))
    : 0;
  return Math.min(handoff.endsAtSec, current + delta);
}

export function consensusMemorySourceHandoffActive(
  handoff: ConsensusMemorySourceHandoff | null,
  focusedSourceId: number | null,
  nowSec: number,
): handoff is ConsensusMemorySourceHandoff {
  return !!handoff
    && focusedSourceId === handoff.to.sourceId
    && consensusMemorySourceHandoffPhase(handoff, nowSec) < 1;
}

/** Fade endpoint labels, route resonance, and agreement signatures together. */
export function consensusMemorySourceHandoffEvidenceScale(
  candidateSourceId: number | null,
  focusedSourceId: number | null,
  handoff: ConsensusMemorySourceHandoff | null,
  nowSec: number,
): number {
  const settled = consensusMemoryEvidenceFocusScale(
    candidateSourceId,
    focusedSourceId,
  );
  if (!consensusMemorySourceHandoffActive(
    handoff,
    focusedSourceId,
    nowSec,
  )) return settled;

  const progress = consensusMemorySourceHandoffProgress(handoff, nowSec);
  if (candidateSourceId === handoff.from.sourceId) {
    const passive = consensusMemoryEvidenceFocusScale(
      candidateSourceId,
      handoff.to.sourceId,
    );
    return 1 + (passive - 1) * progress;
  }
  if (candidateSourceId === handoff.to.sourceId) {
    const passive = consensusMemoryEvidenceFocusScale(
      candidateSourceId,
      handoff.from.sourceId,
    );
    return passive + (1 - passive) * progress;
  }
  return settled;
}

/** Crossfade the exact locked edges without doubling their full brightness. */
export function consensusMemorySourceHandoffLockScale(
  side: ConsensusMemorySourceHandoffSide,
  handoff: ConsensusMemorySourceHandoff | null,
  nowSec: number,
): number {
  const progress = consensusMemorySourceHandoffProgress(handoff, nowSec);
  return side === 'from' ? 1 - progress : progress;
}

/**
 * A transient route-wide afterimage: the old lineage collapses source→target
 * while the new lineage unfolds target→source. The sine envelope is zero at
 * both ends, so it joins the normal locked-edge rendering without a pop.
 */
export function consensusMemorySourceHandoffRouteFlareScale(
  side: ConsensusMemorySourceHandoffSide,
  segmentIndex: number,
  segmentCount: number,
  handoff: ConsensusMemorySourceHandoff | null,
  nowSec: number,
): number {
  const phase = consensusMemorySourceHandoffPhase(handoff, nowSec);
  if (!handoff || phase <= 0 || phase >= 1 || segmentCount <= 0) return 0;
  const index = Math.max(0, Math.min(segmentCount - 1, segmentIndex));
  const alongRoute = segmentCount <= 1 ? 0 : index / (segmentCount - 1);
  const distanceFromOrigin = side === 'from'
    ? alongRoute
    : 1 - alongRoute;
  const reach = smoothUnit(phase * 1.4 - distanceFromOrigin * 0.4);
  const directional = side === 'from' ? 1 - reach : reach;
  return Math.sin(Math.PI * phase) * directional;
}
