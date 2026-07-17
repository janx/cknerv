import type { Cell, CellLink } from '@cknerv/types';
import { fnv1a } from '../geometry/edgeBezier';
import type { NeighborGraph } from '../geometry/neighborGraph';
import { DEFAULT_MAX_HOPS, shortestPath } from '../geometry/pathRouter';
import { consensusMemoryTraceColor } from '../derives/consensusFlow.derive';
import type { Pulse } from './pulseRunner';

export const MAX_MEMORY_TRACE_PULSES = 8;
/** Distinct real sources resolve into the shared record one phase apart. */
export const MEMORY_TRACE_START_STAGGER_MS = 220;
/** Bound how long a short route may wait for the slowest converging route. */
export const MEMORY_TRACE_ALIGNMENT_CAP_MS = 720;
/** Deliberate recall cadence: slower than live traffic so history is legible. */
export const MEMORY_TRACE_HOP_MS_MIN = 220;
export const MEMORY_TRACE_HOP_MS_SPAN = 90;
/** A recalled route settles at full energy, then leaves no persistent mark. */
export const MEMORY_TRACE_SETTLE_MS = 420;
export const MEMORY_TRACE_FADE_MS = 1_600;
export const MEMORY_TRACE_FOCUS_FADE_IN_MS = 160;
export const MEMORY_TRACE_FOCUS_FADE_OUT_MS = 720;
export const MEMORY_TRACE_PASSIVE_OPACITY_FLOOR = 0.26;
/** Live writes remain visible during recall, but yield the active color lane. */
export const MEMORY_TRACE_LIVE_ACTIVITY_FLOOR = 0.48;
export const MEMORY_TRACE_SOURCE_REVEAL_LEAD_MS = 120;
export const MEMORY_TRACE_SOURCE_REVEAL_MS = 180;
/** Agreement knots resolve shortly after each recalled witness reaches target. */
export const MEMORY_TRACE_CELL_CONVERGENCE_MS = 260;
/** Slow phase read across the target's canonical contributor paths. */
export const MEMORY_TRACE_CELL_READ_CYCLES_PER_S = 0.38;
/** Completed routes yield to the resolved Cell without losing provenance. */
export const MEMORY_TRACE_ROUTE_HANDOFF_FLOOR = 0.36;
const MAX_MEMORY_TRACE_FOCUS_ENDPOINTS = 3;

export interface ConsensusMemoryTraceRequest {
  linkSeq: number;
  /** Optional exact retained output selected by the user. */
  targetCellId?: number;
  /** Monotonic UI nonce: incrementing replays the same retained link again. */
  nonce: number;
}

/** Stable identity for replay, cancellation, and stale-completion guards. */
export function consensusMemoryTraceRequestKey(
  request: ConsensusMemoryTraceRequest,
): string {
  return `${request.linkSeq}:${request.targetCellId ?? '*'}:${request.nonce}`;
}

export type ConsensusPulseMode = 'live' | 'memory';

/** Side-effect boundary: historical recall is display-only, never traffic. */
export const CONSENSUS_PULSE_POLICY = {
  live: { reinforce: true, flashCells: true, stampWrite: true },
  memory: { reinforce: false, flashCells: false, stampWrite: false },
} as const satisfies Record<ConsensusPulseMode, {
  reinforce: boolean;
  flashCells: boolean;
  stampWrite: boolean;
}>;

export interface ConsensusMemoryTraceOptions {
  maxHops?: number;
  maxPulses?: number;
  maxWitnessesPerParent?: number;
  /** Restrict recall to one real output instead of replaying its siblings. */
  targetCellId?: number;
}

export type ConsensusMemoryTraceSource = 'input' | 'witness' | 'none';

export interface ConsensusMemoryTraceEndpoints {
  sourceKind: ConsensusMemoryTraceSource;
  sourceIds: number[];
  retainedInputIds: number[];
  retainedOutputIds: number[];
  witnessIds: number[];
}

export interface ConsensusMemoryTracePlan {
  pulses: Pulse[];
  sourceKind: ConsensusMemoryTraceSource;
  sourceIds: number[];
  /** Exact link endpoints and parent witnesses still present in the cache. */
  retainedInputIds: number[];
  retainedOutputIds: number[];
  witnessIds: number[];
}

export interface ConsensusMemoryTraceFocusSource {
  id: number;
  startsAtSec: number;
  arrivesAtSec: number;
}

export interface ConsensusMemoryTraceFocus {
  key: string;
  sourceKind: Exclude<ConsensusMemoryTraceSource, 'none'>;
  sources: ConsensusMemoryTraceFocusSource[];
  routedSourceCount: number;
  targetIds: number[];
  startedAtSec: number;
  endsAtSec: number;
}

export interface ConsensusMemoryCellResponse {
  role: 'source' | 'target';
  /** Shared fade envelope, including a source's phased reveal. */
  strength: number;
  /** Source travel or target read-head phase, normalized to 0..1. */
  phase: number;
  /** Target witness resolution, or source departure progress. */
  convergence: number;
}

const smoothUnit = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/**
 * Focus only endpoints that actually participate in a planned route. The
 * lifetime spans the slowest pulse plus its settled afterimage, so labels and
 * passive-mesh dimming cannot outlive the visual evidence they describe.
 */
export function deriveConsensusMemoryTraceFocus(
  plan: ConsensusMemoryTracePlan,
  startedAtSec: number,
  key: string,
): ConsensusMemoryTraceFocus | null {
  if (plan.sourceKind === 'none' || plan.pulses.length === 0) return null;
  const sourceById = new Map<number, ConsensusMemoryTraceFocusSource>();
  for (const pulse of plan.pulses) {
    const id = pulse.path[0];
    const startsAtSec = startedAtSec + pulse.startDelayMs / 1000;
    const arrivesAtSec = startsAtSec
      + (pulse.path.length - 1) * pulse.hopMs / 1000;
    const existing = sourceById.get(id);
    if (!existing) {
      sourceById.set(id, { id, startsAtSec, arrivesAtSec });
      continue;
    }
    existing.startsAtSec = Math.min(existing.startsAtSec, startsAtSec);
    existing.arrivesAtSec = Math.min(existing.arrivesAtSec, arrivesAtSec);
  }
  const sources = [...sourceById.values()]
    .sort((a, b) => (
      a.startsAtSec - b.startsAtSec
      || a.arrivesAtSec - b.arrivesAtSec
      || a.id - b.id
    ))
    .slice(0, MAX_MEMORY_TRACE_FOCUS_ENDPOINTS);
  const targetIds = [...new Set(plan.pulses.map(
    (pulse) => pulse.path[pulse.path.length - 1],
  ))].slice(0, MAX_MEMORY_TRACE_FOCUS_ENDPOINTS);
  const lifetimeMs = Math.max(...plan.pulses.map((pulse) => (
    pulse.startDelayMs
      + (pulse.path.length - 1) * pulse.hopMs
      + MEMORY_TRACE_SETTLE_MS
      + MEMORY_TRACE_FADE_MS
  )));
  return {
    key,
    sourceKind: plan.sourceKind,
    sources,
    routedSourceCount: sourceById.size,
    targetIds,
    startedAtSec,
    endsAtSec: startedAtSec + lifetimeMs / 1000,
  };
}

/** Shared envelope for endpoint labels and passive-fabric de-emphasis. */
export function consensusMemoryTraceFocusStrength(
  focus: ConsensusMemoryTraceFocus | null,
  nowSec: number,
): number {
  if (!focus || !Number.isFinite(nowSec)) return 0;
  const ageMs = (nowSec - focus.startedAtSec) * 1000;
  const remainingMs = (focus.endsAtSec - nowSec) * 1000;
  if (ageMs < 0 || remainingMs <= 0) return 0;
  const fadeIn = smoothUnit(ageMs / MEMORY_TRACE_FOCUS_FADE_IN_MS);
  const fadeOut = smoothUnit(remainingMs / MEMORY_TRACE_FOCUS_FADE_OUT_MS);
  return fadeIn * fadeOut;
}

/** Reveal each real source shortly before its own phased route departs. */
export function consensusMemoryTraceSourceStrength(
  source: ConsensusMemoryTraceFocusSource,
  nowSec: number,
): number {
  if (!Number.isFinite(nowSec)) return 0;
  const revealAgeMs = (nowSec - source.startsAtSec) * 1000
    + MEMORY_TRACE_SOURCE_REVEAL_LEAD_MS;
  if (revealAgeMs <= 1e-6) return 0;
  if (revealAgeMs >= MEMORY_TRACE_SOURCE_REVEAL_MS) return 1;
  return smoothUnit(revealAgeMs / MEMORY_TRACE_SOURCE_REVEAL_MS);
}

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Translate one route focus into the Cell body's own visual state. Sources
 * expose a restrained departure read; the retained target progressively
 * resolves its real agreement constellation as witnesses arrive.
 */
export function consensusMemoryCellResponse(
  focus: ConsensusMemoryTraceFocus | null,
  cellId: number,
  nowSec: number,
): ConsensusMemoryCellResponse | null {
  if (!focus || !Number.isFinite(cellId) || !Number.isFinite(nowSec)) return null;
  const focusStrength = consensusMemoryTraceFocusStrength(focus, nowSec);
  if (focus.targetIds.includes(cellId)) {
    const elapsed = Math.max(0, nowSec - focus.startedAtSec);
    const rawPhase = elapsed * MEMORY_TRACE_CELL_READ_CYCLES_PER_S;
    const phase = rawPhase - Math.floor(rawPhase);
    const convergence = focus.sources.length === 0
      ? 0
      : focus.sources.reduce((total, source) => total + smoothUnit(
        (nowSec - source.arrivesAtSec) * 1000 / MEMORY_TRACE_CELL_CONVERGENCE_MS,
      ), 0) / focus.sources.length;
    return { role: 'target', strength: focusStrength, phase, convergence };
  }

  const source = focus.sources.find((candidate) => candidate.id === cellId);
  if (!source) return null;
  const travelSeconds = Math.max(0.001, source.arrivesAtSec - source.startsAtSec);
  const phase = clampUnit((nowSec - source.startsAtSec) / travelSeconds);
  return {
    role: 'source',
    strength: focusStrength * consensusMemoryTraceSourceStrength(source, nowSec),
    phase,
    convergence: phase,
  };
}

/** Transfer focal energy from completed evidence paths into the retained Cell. */
export function consensusMemoryRouteHandoffScale(convergence: number): number {
  const resolved = Number.isFinite(convergence) ? clampUnit(convergence) : 0;
  return 1 - resolved * (1 - MEMORY_TRACE_ROUTE_HANDOFF_FLOOR);
}

/** Global passive-line opacity; active live and recalled paths stay untouched. */
export function consensusMemoryPassiveOpacity(strength: number): number {
  const focus = Number.isFinite(strength)
    ? Math.max(0, Math.min(1, strength))
    : 0;
  return 1 - focus * (1 - MEMORY_TRACE_PASSIVE_OPACITY_FLOOR);
}

/**
 * Preserve live chain truth while an explicit historical route is inspected.
 * Cell flashes and write seals remain full-strength; only competing route
 * ribbons and packet heads yield visual priority to the recalled evidence.
 */
export function consensusMemoryLiveActivityScale(strength: number): number {
  const focus = Number.isFinite(strength)
    ? Math.max(0, Math.min(1, strength))
    : 0;
  return 1 - focus * (1 - MEMORY_TRACE_LIVE_ACTIVITY_FLOOR);
}

/** Memory evidence keeps full energy; only simultaneous live ribbons yield. */
export function consensusMemoryPulseActivityScale(
  mode: ConsensusPulseMode,
  strength: number,
): number {
  return mode === 'live' ? consensusMemoryLiveActivityScale(strength) : 1;
}

/** Post-arrival route energy for the display-only consensus-memory afterimage. */
export function consensusMemoryTraceResonance(ageMs: number): number {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
  if (ageMs <= MEMORY_TRACE_SETTLE_MS) return 1;
  const fadeT = Math.min(
    1,
    (ageMs - MEMORY_TRACE_SETTLE_MS) / MEMORY_TRACE_FADE_MS,
  );
  const smooth = fadeT * fadeT * (3 - 2 * fadeT);
  return 1 - smooth;
}

const uniqueRetained = (
  ids: readonly number[],
  cells: ReadonlyMap<number, Cell>,
): number[] => [...new Set(ids)].filter((id) => cells.has(id));

/**
 * Resolve honest recall sources. Exact consumed inputs win while their short
 * death tail remains. Afterwards, live sibling outputs from the same parent
 * transactions act as lineage witnesses; they are never labeled as inputs.
 */
export function deriveConsensusMemoryTraceEndpoints(
  link: CellLink,
  cells: ReadonlyMap<number, Cell>,
  maxWitnessesPerParent: number = 2,
): ConsensusMemoryTraceEndpoints {
  const retainedInputIds = uniqueRetained(link.from_ids, cells);
  const retainedOutputIds = uniqueRetained(link.to_ids, cells);
  const witnessIds: number[] = [];
  const parentSet = new Set(link.parents);
  const perParent = new Map<string, number>();
  const witnessCap = Math.max(0, Math.floor(maxWitnessesPerParent));

  if (retainedInputIds.length === 0 && parentSet.size > 0 && witnessCap > 0) {
    for (const [id, cell] of cells) {
      if (cell.death_at_ms !== null || link.to_ids.includes(id)) continue;
      const parent = cell.out_point.tx_hash;
      if (!parentSet.has(parent)) continue;
      const used = perParent.get(parent) ?? 0;
      if (used >= witnessCap) continue;
      witnessIds.push(id);
      perParent.set(parent, used + 1);
    }
  }

  const sourceKind: ConsensusMemoryTraceSource = retainedInputIds.length > 0
    ? 'input'
    : witnessIds.length > 0
      ? 'witness'
      : 'none';
  return {
    sourceKind,
    sourceIds: sourceKind === 'input' ? retainedInputIds : witnessIds,
    retainedInputIds,
    retainedOutputIds,
    witnessIds,
  };
}

/** Cheap HUD gate; graph routability is resolved by the planner on recall. */
export function canRecallConsensusMemory(
  link: CellLink,
  cells: ReadonlyMap<number, Cell>,
  targetCellId?: number,
): boolean {
  const endpoints = deriveConsensusMemoryTraceEndpoints(link, cells);
  const retainedOutputIds = targetCellId === undefined
    ? endpoints.retainedOutputIds
    : endpoints.retainedOutputIds.filter((id) => id === targetCellId);
  return endpoints.sourceKind !== 'none'
    && retainedOutputIds.length > 0;
}

function memoryTraceTiming(
  link: CellLink,
  sourceId: number,
  targetId: number,
): { hopMs: number } {
  const seed = fnv1a(`memory:${link.tx_hash}\x00${sourceId}\x00${targetId}`);
  const speed = ((seed >>> 16) & 0xffff) / 0x10000;
  return {
    hopMs: MEMORY_TRACE_HOP_MS_MIN + speed * MEMORY_TRACE_HOP_MS_SPAN,
  };
}

/**
 * Plan a historical recall from exact retained transaction inputs to outputs.
 * Once inputs leave their death-animation tail, surviving sibling outputs from
 * the recorded parent transactions provide an explicitly labeled witness path.
 */
export function planConsensusMemoryTrace(
  link: CellLink,
  cells: ReadonlyMap<number, Cell>,
  graph: NeighborGraph,
  options: ConsensusMemoryTraceOptions = {},
): ConsensusMemoryTracePlan {
  const endpoints = deriveConsensusMemoryTraceEndpoints(
    link,
    cells,
    options.maxWitnessesPerParent,
  );
  const retainedOutputIds = options.targetCellId === undefined
    ? endpoints.retainedOutputIds
    : endpoints.retainedOutputIds.filter((id) => id === options.targetCellId);
  const plannedEndpoints = { ...endpoints, retainedOutputIds };
  const maxHops = options.maxHops ?? DEFAULT_MAX_HOPS;
  const maxPulses = Math.max(
    0,
    Math.floor(options.maxPulses ?? MAX_MEMORY_TRACE_PULSES),
  );
  const color = consensusMemoryTraceColor(link.tx_hash);
  const candidates: Array<{
    path: number[];
    sourceId: number;
    hopMs: number;
    travelMs: number;
  }> = [];

  // Target-major iteration spends the visual budget on source diversity: one
  // shared record receives every available witness before a second output is
  // considered. This reads as convergence instead of one source fan-out.
  outer: for (const targetId of plannedEndpoints.retainedOutputIds) {
    for (const sourceId of endpoints.sourceIds) {
      if (candidates.length >= maxPulses) break outer;
      if (!graph.adjacency.has(sourceId)) continue;
      if (sourceId === targetId || !graph.adjacency.has(targetId)) continue;
      const path = shortestPath(graph, sourceId, targetId, maxHops);
      if (!path || path.length < 2) continue;
      const { hopMs } = memoryTraceTiming(link, sourceId, targetId);
      candidates.push({
        path, sourceId, hopMs, travelMs: (path.length - 1) * hopMs,
      });
    }
  }

  const sourceFirstSeen = new Map<number, number>();
  const sourceLongestTravel = new Map<number, number>();
  candidates.forEach((candidate, index) => {
    if (!sourceFirstSeen.has(candidate.sourceId)) {
      sourceFirstSeen.set(candidate.sourceId, index);
    }
    sourceLongestTravel.set(candidate.sourceId, Math.max(
      sourceLongestTravel.get(candidate.sourceId) ?? 0,
      candidate.travelMs,
    ));
  });
  const routedSources = [...sourceFirstSeen.keys()].sort((a, b) => (
    (sourceLongestTravel.get(b) ?? 0) - (sourceLongestTravel.get(a) ?? 0)
    || (sourceFirstSeen.get(a) ?? 0) - (sourceFirstSeen.get(b) ?? 0)
  ));
  const sourcePhase = new Map(routedSources.map((id, index) => [id, index]));
  const longestTravelMs = candidates.reduce(
    (longest, candidate) => Math.max(longest, candidate.travelMs),
    0,
  );
  const pulses: Pulse[] = candidates.map((candidate) => ({
    path: candidate.path,
    bornAtMs: link.at_ms,
    color,
    // Short routes wait for the slowest one (within a hard bound), then each
    // distinct real source resolves one phase later than the previous source.
    startDelayMs: Math.min(
      MEMORY_TRACE_ALIGNMENT_CAP_MS,
      Math.max(0, longestTravelMs - candidate.travelMs),
    ) + (sourcePhase.get(candidate.sourceId) ?? 0) * MEMORY_TRACE_START_STAGGER_MS,
    hopMs: candidate.hopMs,
  }));

  return { pulses, ...plannedEndpoints };
}
