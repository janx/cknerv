import type { CellGalaxySnapshot, CellLink, CellLinkRecord } from '@cknerv/types';
import type { CellGalaxyCache } from '@cknerv/cache';
import {
  buildNeighborGraph,
  planPulses,
  planConsensusMemoryTrace,
  type ConsensusMemoryTraceRequest,
} from '@cknerv/ui';

export type ProtocolEventStage = 'network' | 'carrier' | 'commit' | 'settled';

export const PROTOCOL_EVENT_REVIEW_PERIOD_S = 8;
/** Recall begins only after the observed write has settled into memory. */
export const PROTOCOL_EVENT_MEMORY_TRACE_AT_S = 5.72;
/** Two sources make convergence legible without turning recall into traffic. */
export const PROTOCOL_EVENT_MEMORY_TRACE_PULSES = 2;

/** Stable inspection points inside each semantic window. */
export const PROTOCOL_EVENT_STAGE_TIME_S: Record<ProtocolEventStage, number> = {
  network: 0.3,
  carrier: 1.1,
  commit: 3.4,
  settled: 6.2,
};

const PROTOCOL_EVENT_REVIEW_EPOCH_MS = 1_720_000_000_000;
const PROTOCOL_EVENT_REVIEW_MAX_S = PROTOCOL_EVENT_REVIEW_PERIOD_S - 0.05;

/** One deterministic block identity per review cycle. */
export function protocolEventReviewNonce(serial: number): number {
  const index = Math.max(0, Math.trunc(serial) - 1);
  return PROTOCOL_EVENT_REVIEW_EPOCH_MS
    + index * PROTOCOL_EVENT_REVIEW_PERIOD_S * 1000;
}

/** Stable request used by the review lab; renderer and evidence stay production. */
export function protocolEventMemoryTraceRequest(
  enabled: boolean,
  elapsedS: number,
  serial: number,
  links: readonly CellLink[],
): ConsensusMemoryTraceRequest | null {
  const link = links.at(-1);
  if (!enabled || elapsedS < PROTOCOL_EVENT_MEMORY_TRACE_AT_S || !link) {
    return null;
  }
  return {
    linkSeq: link.seq,
    nonce: Math.max(1, Math.trunc(serial)),
  };
}

/** Pick a real observed link whose witness-to-output route reads at a glance. */
export function protocolEventMemoryTraceTemplates(
  cache: CellGalaxyCache,
  templates: readonly CellLinkRecord[],
): CellLinkRecord[] {
  const graph = buildNeighborGraph(cache.cells, { k: 3, maxEdgeLength: 28 });
  let best: CellLinkRecord | null = null;
  let bestSourceTier = 0;
  let bestSourceExcess = Number.POSITIVE_INFINITY;
  let bestHops = Number.POSITIVE_INFINITY;

  templates.forEach((template, index) => {
    const plan = planConsensusMemoryTrace(
      { ...template, seq: index + 1 },
      cache.cells,
      graph,
      {
        maxHops: 24,
        maxPulses: PROTOCOL_EVENT_MEMORY_TRACE_PULSES,
        maxWitnessesPerParent: 2,
      },
    );
    if (plan.pulses.length === 0) return;
    const sourceCount = new Set(plan.pulses.map((pulse) => pulse.path[0])).size;
    const sourceTier = Math.min(2, sourceCount);
    const sourceExcess = Math.abs(2 - sourceCount);
    // The live review keeps one observed write pulse; recall gets a separate
    // route budget and spends it on real sources converging on that record.
    // Prefer a multi-source example, then the most compact readable topology.
    const hops = Math.max(...plan.pulses.map((pulse) => pulse.path.length - 1));
    if (
      sourceTier > bestSourceTier
      || (sourceTier === bestSourceTier && sourceExcess < bestSourceExcess)
      || (
        sourceTier === bestSourceTier
        && sourceExcess === bestSourceExcess
        && hops <= bestHops
      )
    ) {
      best = template;
      bestSourceTier = sourceTier;
      bestSourceExcess = sourceExcess;
      bestHops = hops;
    }
  });

  return best ? [best] : [];
}

export interface ProtocolEventMemoryTraceFrame {
  center: [number, number, number];
  radius: number;
  sourceIds: number[];
  targetIds: number[];
}

/** Bounds the actual routed Cell positions for an honest review camera frame. */
export function protocolEventMemoryTraceFrame(
  cache: CellGalaxyCache,
): ProtocolEventMemoryTraceFrame | null {
  const link = cache.recentLinks.at(-1);
  if (!link) return null;
  const graph = buildNeighborGraph(cache.cells, { k: 3, maxEdgeLength: 28 });
  const plan = planConsensusMemoryTrace(link, cache.cells, graph, {
    maxHops: 24,
    maxPulses: PROTOCOL_EVENT_MEMORY_TRACE_PULSES,
    maxWitnessesPerParent: 2,
  });
  if (plan.pulses.length === 0) return null;

  const sourceIds = [...new Set(plan.pulses.map((pulse) => pulse.path[0]))];
  const targetIds = [...new Set(plan.pulses.map(
    (pulse) => pulse.path[pulse.path.length - 1],
  ))];
  const routeIds = new Set(plan.pulses.flatMap((pulse) => pulse.path));
  const routeCells = [...routeIds].flatMap((id) => {
    const cell = cache.cells.get(id);
    return cell ? [cell] : [];
  });
  if (routeCells.length === 0) return null;

  const min = [...routeCells[0].pos_seed] as [number, number, number];
  const max = [...routeCells[0].pos_seed] as [number, number, number];
  for (const cell of routeCells.slice(1)) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], cell.pos_seed[axis]);
      max[axis] = Math.max(max[axis], cell.pos_seed[axis]);
    }
  }
  const center: [number, number, number] = [
    (min[0] + max[0]) * 0.5,
    (min[1] + max[1]) * 0.5,
    (min[2] + max[2]) * 0.5,
  ];
  const radius = routeCells.reduce((largest, cell) => Math.max(
    largest,
    Math.hypot(
      cell.pos_seed[0] - center[0],
      cell.pos_seed[1] - center[1],
      cell.pos_seed[2] - center[2],
    ),
  ), 0) * 1.12;

  return { center, radius, sourceIds, targetIds };
}

/** Resolve a shareable fixed review time from `?at=` or `?stage=`. */
export function protocolEventReviewTarget(search: string): number | null {
  const params = new URLSearchParams(search);
  const requestedAt = params.get('at');
  if (requestedAt !== null) {
    const at = Number(requestedAt);
    if (Number.isFinite(at)) {
      return Math.max(0, Math.min(PROTOCOL_EVENT_REVIEW_MAX_S, at));
    }
  }
  const requestedStage = params.get('stage') as ProtocolEventStage | null;
  return requestedStage && requestedStage in PROTOCOL_EVENT_STAGE_TIME_S
    ? PROTOCOL_EVENT_STAGE_TIME_S[requestedStage]
    : null;
}

/** Keep the lab legible while preserving real Cell identities and positions. */
export function protocolEventLabSnapshot(
  snapshot: CellGalaxySnapshot,
  limit = 720,
): CellGalaxySnapshot {
  const live = snapshot.cells.filter((cell) => cell.death_at_ms === null);
  const candidates = live.length > 0 ? live : snapshot.cells;
  const boundedLimit = Math.max(0, limit);
  const cellById = new Map(candidates.map((cell) => [cell.id, cell]));
  const cellsByBirthTx = new Map<string, typeof candidates>();
  for (const cell of candidates) {
    const txHash = cell.out_point.tx_hash;
    const siblings = cellsByBirthTx.get(txHash);
    if (siblings) siblings.push(cell);
    else cellsByBirthTx.set(txHash, [cell]);
  }

  // Production pulse planning does not route from the consumed inputs: those
  // Cells are correctly absent from a live snapshot. It routes from surviving
  // siblings born by each parent transaction into the observed outputs. Anchor
  // the review field around exactly those real, currently routable Cells.
  const selectedIds = new Set<number>();
  const observedLinks: NonNullable<CellGalaxySnapshot['recent_links']> = [];
  const recentLinks = snapshot.recent_links ?? [];
  for (let index = recentLinks.length - 1; index >= 0 && observedLinks.length < 24; index -= 1) {
    const link = recentLinks[index];
    const linkIds = new Set<number>();
    for (const id of link.to_ids) if (cellById.has(id)) linkIds.add(id);
    for (const parent of link.parents) {
      for (const source of (cellsByBirthTx.get(parent) ?? []).slice(0, 2)) {
        if (!link.to_ids.includes(source.id)) linkIds.add(source.id);
      }
    }
    const hasOutput = link.to_ids.some((id) => linkIds.has(id));
    const hasSource = [...linkIds].some((id) => !link.to_ids.includes(id));
    const additional = [...linkIds].filter((id) => !selectedIds.has(id)).length;
    if (!hasOutput || !hasSource || selectedIds.size + additional > boundedLimit) continue;
    for (const id of linkIds) selectedIds.add(id);
    observedLinks.unshift(link);
  }

  // Fill the remaining budget with the newest real live Cells while retaining
  // their original snapshot order for deterministic rendering semantics.
  for (let index = candidates.length - 1; index >= 0 && selectedIds.size < boundedLimit; index -= 1) {
    selectedIds.add(candidates[index].id);
  }
  const cells = candidates.filter((cell) => selectedIds.has(cell.id));
  const cellMap = new Map(cells.map((cell) => [cell.id, cell]));
  const reviewGraph = buildNeighborGraph(cellMap, { k: 3, maxEdgeLength: 28 });
  const routableLinks = observedLinks.filter((link, index) => planPulses(
    { ...link, seq: index + 1 },
    cellMap,
    reviewGraph,
    { maxHops: 24, maxPulsesPerLink: 3, maxSourcesPerParent: 2 },
  ).length > 0).slice(-8);
  return {
    ...snapshot,
    cells,
    last_pulse_at_ms: 0,
    recent_links: routableLinks,
  };
}

/**
 * Advance one deterministic review pulse without inventing Cell contents. The
 * cache keeps its real Cell Map and replays one observed causal edge at the lab
 * clock so production network, shockwave, route, and write-seal code execute
 * together. With no observed edge, it advances only the block pulse.
 */
export function advanceProtocolEventLab(
  cache: CellGalaxyCache,
  nonce: number,
  templates: readonly CellLinkRecord[] = cache.recentLinks,
): CellGalaxyCache {
  const nextSeq = cache.linksSeq + 1;
  if (templates.length === 0) {
    return {
      ...cache,
      revision: cache.revision + 1,
      lastPulseAtMs: nonce,
    };
  }

  const templateIndex = Math.abs(Math.trunc(nonce / 1000)) % templates.length;
  const observed = templates[templateIndex];
  const link = {
    ...observed,
    seq: nextSeq,
    at_ms: nonce,
  };

  return {
    ...cache,
    revision: cache.revision + 1,
    lastPulseAtMs: nonce,
    recentLinks: [...cache.recentLinks.slice(-23), link],
    linksSeq: nextSeq,
  };
}

export function protocolEventStage(elapsedS: number): ProtocolEventStage {
  if (elapsedS < 0.65) return 'network';
  if (elapsedS < 1.6) return 'carrier';
  if (elapsedS < 5.6) return 'commit';
  return 'settled';
}
