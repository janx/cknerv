import type { Cell } from '@cknerv/types';
import {
  consensusMemoryEvidenceBindings,
  consensusMemoryEvidenceColor,
} from './consensusMemoryEvidence.derive';
import {
  consensusMemoryTraceRouteForTarget,
  type ConsensusMemoryTraceFocus,
} from '../nerve/consensusMemoryTrace';

export const CONSENSUS_ROUTE_HOP_AGREEMENT_CAP = 3;
const AGREEMENT_KNOT_COUNT = 12;
const ARRIVAL_WINDOW_START = 0.18;
const ARRIVAL_WINDOW_END = 0.62;
const SINGLE_ARRIVAL_PROGRESS = 0.36;

export interface ConsensusRouteHopAgreementTick {
  sourceId: number;
  ordinal: number;
  contentHash: string;
  routeArrivesAtSec: number;
  /** Target-specific angular address, in radians. */
  angle: number;
  /** Real arrival timing replayed inside the latch's normalized timeline. */
  arrivalProgress: number;
  color: readonly [number, number, number];
}

export interface ConsensusRouteHopAgreementPlan {
  targetCellId: number;
  routedSourceCount: number;
  visibleSourceCount: number;
  hiddenSourceCount: number;
  ticks: readonly ConsensusRouteHopAgreementTick[];
}

function emptyAgreementPlan(targetCellId: number): ConsensusRouteHopAgreementPlan {
  return {
    targetCellId,
    routedSourceCount: 0,
    visibleSourceCount: 0,
    hiddenSourceCount: 0,
    ticks: [],
  };
}

/**
 * Bind the currently retained evidence set to a sparse target constellation.
 * Hash identity chooses each angular address; real route arrival gaps choose
 * when each tick resolves during the target latch replay.
 */
export function deriveConsensusRouteHopAgreementPlan(
  focus: ConsensusMemoryTraceFocus | null,
  target: Cell,
  capacity = CONSENSUS_ROUTE_HOP_AGREEMENT_CAP,
): ConsensusRouteHopAgreementPlan {
  if (!focus || !focus.targetIds.includes(target.id)) {
    return emptyAgreementPlan(target.id);
  }
  const routed = focus.sources.flatMap((source) => {
    const route = consensusMemoryTraceRouteForTarget(source, target.id);
    return route ? [{ source, route }] : [];
  });
  const routedSourceCount = focus.targetIds.length === 1
    ? Math.max(routed.length, focus.routedSourceCount)
    : routed.length;
  const safeCapacity = Number.isFinite(capacity)
    ? Math.max(
        0,
        Math.min(CONSENSUS_ROUTE_HOP_AGREEMENT_CAP, Math.trunc(capacity)),
      )
    : 0;
  const visible = routed.slice(0, safeCapacity);
  if (visible.length === 0) {
    return {
      ...emptyAgreementPlan(target.id),
      routedSourceCount,
      hiddenSourceCount: routedSourceCount,
    };
  }

  const bindings = consensusMemoryEvidenceBindings(
    target.content_hash,
    visible.map(({ source }, index) => ({
      sourceId: source.id,
      ordinal: index + 1,
      contentHash: source.contentHash,
    })),
    AGREEMENT_KNOT_COUNT,
  );
  const firstArrival = Math.min(...visible.map(({ route }) => route.arrivesAtSec));
  const lastArrival = Math.max(...visible.map(({ route }) => route.arrivesAtSec));
  const arrivalSpan = lastArrival - firstArrival;
  const ticks = visible.map(({ source, route }, index) => {
    const binding = bindings[index];
    const arrivalProgress = arrivalSpan > 1e-6
      ? ARRIVAL_WINDOW_START
        + (route.arrivesAtSec - firstArrival) / arrivalSpan
          * (ARRIVAL_WINDOW_END - ARRIVAL_WINDOW_START)
      : SINGLE_ARRIVAL_PROGRESS;
    return {
      sourceId: source.id,
      ordinal: index + 1,
      contentHash: source.contentHash,
      routeArrivesAtSec: route.arrivesAtSec,
      angle: binding
        ? binding.knotIndex / AGREEMENT_KNOT_COUNT * Math.PI * 2 - Math.PI / 2
        : -Math.PI / 2,
      arrivalProgress,
      color: consensusMemoryEvidenceColor(binding?.evidenceIndex ?? index),
    };
  });

  return {
    targetCellId: target.id,
    routedSourceCount,
    visibleSourceCount: ticks.length,
    hiddenSourceCount: Math.max(0, routedSourceCount - ticks.length),
    ticks,
  };
}
