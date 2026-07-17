import type { Cell, CellLink } from '@cknerv/types';
import { fnv1a } from '../geometry/edgeBezier';
import type { NeighborGraph } from '../geometry/neighborGraph';
import { DEFAULT_MAX_HOPS, shortestPath } from '../geometry/pathRouter';
import { consensusMemoryTraceColor } from '../derives/consensusFlow.derive';
import type { Pulse } from './pulseRunner';

export const MAX_MEMORY_TRACE_PULSES = 8;
export const MEMORY_TRACE_START_STAGGER_MS = 180;
/** Deliberate recall cadence: slower than live traffic so history is legible. */
export const MEMORY_TRACE_HOP_MS_MIN = 220;
export const MEMORY_TRACE_HOP_MS_SPAN = 90;
/** A recalled route settles at full energy, then leaves no persistent mark. */
export const MEMORY_TRACE_SETTLE_MS = 420;
export const MEMORY_TRACE_FADE_MS = 1_600;
export const MEMORY_TRACE_FOCUS_FADE_IN_MS = 160;
export const MEMORY_TRACE_FOCUS_FADE_OUT_MS = 720;
export const MEMORY_TRACE_PASSIVE_OPACITY_FLOOR = 0.26;
const MAX_MEMORY_TRACE_FOCUS_ENDPOINTS = 2;

export interface ConsensusMemoryTraceRequest {
  linkSeq: number;
  /** Monotonic UI nonce: incrementing replays the same retained link again. */
  nonce: number;
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

export interface ConsensusMemoryTraceFocus {
  key: string;
  sourceKind: Exclude<ConsensusMemoryTraceSource, 'none'>;
  sourceIds: number[];
  targetIds: number[];
  startedAtSec: number;
  endsAtSec: number;
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
  const sourceIds = [...new Set(plan.pulses.map((pulse) => pulse.path[0]))]
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
    sourceIds,
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

/** Global passive-line opacity; active live and recalled paths stay untouched. */
export function consensusMemoryPassiveOpacity(strength: number): number {
  const focus = Number.isFinite(strength)
    ? Math.max(0, Math.min(1, strength))
    : 0;
  return 1 - focus * (1 - MEMORY_TRACE_PASSIVE_OPACITY_FLOOR);
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
): boolean {
  const endpoints = deriveConsensusMemoryTraceEndpoints(link, cells);
  return endpoints.sourceKind !== 'none'
    && endpoints.retainedOutputIds.length > 0;
}

function memoryTraceTiming(
  link: CellLink,
  sourceId: number,
  targetId: number,
): { startDelayMs: number; hopMs: number } {
  const seed = fnv1a(`memory:${link.tx_hash}\x00${sourceId}\x00${targetId}`);
  const stagger = (seed & 0xffff) / 0x10000;
  const speed = ((seed >>> 16) & 0xffff) / 0x10000;
  return {
    startDelayMs: stagger * MEMORY_TRACE_START_STAGGER_MS,
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
  const maxHops = options.maxHops ?? DEFAULT_MAX_HOPS;
  const maxPulses = Math.max(
    0,
    Math.floor(options.maxPulses ?? MAX_MEMORY_TRACE_PULSES),
  );
  const color = consensusMemoryTraceColor(link.tx_hash);
  const pulses: Pulse[] = [];

  outer: for (const sourceId of endpoints.sourceIds) {
    if (!graph.adjacency.has(sourceId)) continue;
    for (const targetId of endpoints.retainedOutputIds) {
      if (pulses.length >= maxPulses) break outer;
      if (sourceId === targetId || !graph.adjacency.has(targetId)) continue;
      const path = shortestPath(graph, sourceId, targetId, maxHops);
      if (!path || path.length < 2) continue;
      const timing = memoryTraceTiming(link, sourceId, targetId);
      pulses.push({
        path,
        bornAtMs: link.at_ms,
        color,
        startDelayMs: timing.startDelayMs,
        hopMs: timing.hopMs,
      });
    }
  }

  return { pulses, ...endpoints };
}
