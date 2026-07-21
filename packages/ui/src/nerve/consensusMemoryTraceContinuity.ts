import {
  MEMORY_TRACE_FOCUS_FADE_IN_MS,
  MEMORY_TRACE_FOCUS_FADE_OUT_MS,
  MEMORY_TRACE_SOURCE_REVEAL_LEAD_MS,
  MEMORY_TRACE_SOURCE_REVEAL_MS,
  consensusMemoryTraceFocusStrength,
  consensusMemoryTraceSourceStrength,
  validateConsensusMemoryRouteHopFocus,
  type ConsensusMemoryRouteHopFocus,
  type ConsensusMemoryTraceFocus,
  type ConsensusMemoryTraceFocusSource,
} from './consensusMemoryTrace';

export const CONSENSUS_MEMORY_TRACE_RELEASE_SECONDS =
  MEMORY_TRACE_FOCUS_FADE_OUT_MS / 1_000;

export interface ConsensusMemoryTraceReleaseEnvelope {
  startedAtSec: number;
  endsAtSec: number;
}

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

const smoothUnit = (value: number): number => {
  const t = clampUnit(value);
  return t * t * (3 - 2 * t);
};

/** Ignore only the monotonic replay nonce; retain link + target identity. */
export function consensusMemoryTraceIdentityKey(traceKey: string): string {
  const nonceSeparator = traceKey.lastIndexOf(':');
  return nonceSeparator > 0 ? traceKey.slice(0, nonceSeparator) : traceKey;
}

/** Stable visual identity: exact retained sources, targets, and routed Cells. */
export function consensusMemoryTraceShapeKey(
  focus: ConsensusMemoryTraceFocus | null,
): string | null {
  if (!focus) return null;
  return [
    consensusMemoryTraceIdentityKey(focus.key),
    focus.sourceKind,
    focus.targetIds.join(','),
    ...focus.sources.map((source) => [
      source.id,
      source.contentHash,
      ...source.routes.map((route) => (
        `${route.targetId}:${route.path.join('.')}`
      )),
    ].join(':')),
  ].join('|');
}

export function deriveConsensusMemoryTraceReleaseEnvelope(
  startedAtSec: number,
  options: { reducedMotion?: boolean } = {},
): ConsensusMemoryTraceReleaseEnvelope | null {
  if (options.reducedMotion || !Number.isFinite(startedAtSec)) return null;
  return {
    startedAtSec,
    endsAtSec: startedAtSec + CONSENSUS_MEMORY_TRACE_RELEASE_SECONDS,
  };
}

export function consensusMemoryTraceReleaseStrength(
  release: ConsensusMemoryTraceReleaseEnvelope | null | undefined,
  nowSec: number,
): number {
  if (!release || !Number.isFinite(nowSec)) return 1;
  const duration = release.endsAtSec - release.startedAtSec;
  if (!(duration > 0)) return 0;
  return 1 - smoothUnit((nowSec - release.startedAtSec) / duration);
}

/**
 * Freeze the last verified endpoint composition and let the whole trace recede
 * through one shared envelope. This is visual retention only: the caller must
 * clear readout/request state immediately.
 */
export function deriveConsensusMemoryTraceReleaseFocus(
  focus: ConsensusMemoryTraceFocus | null,
  nowSec: number,
  options: { reducedMotion?: boolean } = {},
): ConsensusMemoryTraceFocus | null {
  if (!focus || !Number.isFinite(nowSec)) return null;
  const release = deriveConsensusMemoryTraceReleaseEnvelope(nowSec, options);
  const strength = consensusMemoryTraceFocusStrength(focus, nowSec);
  if (!release || strength <= 0.001) return null;
  return {
    ...focus,
    sources: focus.sources.map((source) => ({
      ...source,
      visualContinuity: {
        mode: 'hold',
        floorStrength: consensusMemoryTraceSourceStrength(source, nowSec),
        endsAtSec: release.endsAtSec,
      },
    })),
    endsAtSec: release.endsAtSec,
    visualContinuity: {
      mode: 'release',
      floorStrength: strength,
      startedAtSec: release.startedAtSec,
      endsAtSec: release.endsAtSec,
    },
  };
}

function sourceNativeFullAtSec(source: ConsensusMemoryTraceFocusSource): number {
  return source.startsAtSec
    + (MEMORY_TRACE_SOURCE_REVEAL_MS - MEMORY_TRACE_SOURCE_REVEAL_LEAD_MS)
      / 1_000;
}

/**
 * Rebind a replay to the exact same visual route without returning its
 * endpoints to zero. The fresh route clock remains authoritative; temporary
 * floors expire as soon as its own focus/source envelopes reach full strength.
 */
export function deriveConsensusMemoryTraceReentryFocus(
  next: ConsensusMemoryTraceFocus,
  previous: ConsensusMemoryTraceFocus | null,
  nowSec: number,
  options: { reducedMotion?: boolean } = {},
): ConsensusMemoryTraceFocus {
  if (
    options.reducedMotion
    || !previous
    || !Number.isFinite(nowSec)
    || consensusMemoryTraceShapeKey(previous) !== consensusMemoryTraceShapeKey(next)
  ) return next;

  const previousStrength = consensusMemoryTraceFocusStrength(previous, nowSec);
  if (previousStrength <= 0.001) return next;

  const previousSources = new Map(previous.sources.map((source) => [source.id, source]));
  const sources = next.sources.map((source) => {
    const previousSource = previousSources.get(source.id);
    if (!previousSource) return source;
    const floorStrength = consensusMemoryTraceSourceStrength(previousSource, nowSec);
    if (floorStrength <= 0.001) return source;
    return {
      ...source,
      visualContinuity: {
        mode: 'floor' as const,
        floorStrength,
        endsAtSec: Math.max(
          next.startedAtSec + MEMORY_TRACE_FOCUS_FADE_IN_MS / 1_000,
          sourceNativeFullAtSec(source),
        ),
      },
    };
  });

  const retainedSourceId = previous.evidenceFocusSourceId;
  const evidenceFocusSourceId = retainedSourceId !== null
    && sources.some((source) => source.id === retainedSourceId)
    ? retainedSourceId
    : null;
  const routeHopFocus = previous.routeHopFocus
    ? validateConsensusMemoryRouteHopFocus(next, {
      ...previous.routeHopFocus,
      traceKey: next.key,
    })
    : null;

  return {
    ...next,
    sources,
    evidenceFocusSourceId,
    routeHopFocus,
    visualContinuity: {
      mode: 'floor',
      floorStrength: previousStrength,
      endsAtSec: next.startedAtSec + MEMORY_TRACE_FOCUS_FADE_IN_MS / 1_000,
    },
  };
}

/**
 * During the one React commit where a replay has a fresh trace key but the
 * host still holds the predecessor lock, use the already-revalidated carried
 * hop. Native traces never promote a hover focus into a spatial lock.
 */
export function consensusMemoryTraceVisualRouteHopFocus(
  focus: ConsensusMemoryTraceFocus | null,
  displayedLock: ConsensusMemoryRouteHopFocus | null,
): ConsensusMemoryRouteHopFocus | null {
  const displayed = validateConsensusMemoryRouteHopFocus(focus, displayedLock);
  if (displayed) return displayed;
  return focus?.visualContinuity
    ? validateConsensusMemoryRouteHopFocus(focus, focus.routeHopFocus)
    : null;
}
