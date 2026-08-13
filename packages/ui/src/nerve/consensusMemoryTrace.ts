import type { Cell, CellLink, OutPoint } from '@cknerv/types';
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
/** Non-selected evidence remains faintly legible as structural context. */
export const MEMORY_TRACE_EVIDENCE_PASSIVE_SCALE = 0.16;
/** Unbound target structure yields without disappearing during evidence focus. */
export const MEMORY_TRACE_EVIDENCE_CONTEXT_SCALE = 0.28;
const MAX_MEMORY_TRACE_FOCUS_ENDPOINTS = 3;

export interface ConsensusMemoryTraceRequest {
  linkSeq: number;
  /** Optional exact retained output selected by the user. */
  targetCellId?: number;
  /** Monotonic UI nonce: incrementing replays the same retained link again. */
  nonce: number;
}

/** Why a requested memory trace left the active renderer. */
export type ConsensusMemoryTraceOutcome = 'complete' | 'unavailable';

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

/** One cell this transaction spent, named from the link's own durable
 *  evidence. Survives the cell it describes: anchors outlive the record. */
export interface ConsensusMemoryConsumedInput {
  id: number;
  contentHash: string;
  /** Where the spent cell sat. The anchor's copy, not the map's. */
  posSeed: readonly [number, number, number];
  /** Whether the same cell is still resolvable in the view this recall was
   *  planned against — i.e. whether a route could pass through it. */
  retained: boolean;
}

export interface ConsensusMemoryTraceEndpoints {
  sourceKind: ConsensusMemoryTraceSource;
  sourceIds: number[];
  /** What the transaction consumed, independent of what is still in view. */
  consumedInputs: ConsensusMemoryConsumedInput[];
  retainedInputIds: number[];
  retainedOutputIds: number[];
  witnessIds: number[];
}

export interface ConsensusMemoryTracePlan {
  pulses: Pulse[];
  sourceKind: ConsensusMemoryTraceSource;
  sourceIds: number[];
  consumedInputs: ConsensusMemoryConsumedInput[];
  /** Immutable source identities captured when the display-only route is planned. */
  sourceEvidence: ConsensusMemorySourceEvidence[];
  /** Exact link endpoints and parent witnesses still present in the cache. */
  retainedInputIds: number[];
  retainedOutputIds: number[];
  witnessIds: number[];
}

/**
 * Display-only envelope for same-trace replay and independent-record handoff.
 * It can retain or stage an already verified focus, but cannot add endpoints,
 * routes, or semantic readout that were absent from that focus.
 */
export interface ConsensusMemoryVisualContinuity {
  mode: 'floor' | 'hold' | 'release' | 'entry' | 'park';
  floorStrength: number;
  startStrength?: number;
  startedAtSec?: number;
  settlesAtSec?: number;
  endsAtSec: number;
}

export interface ConsensusMemoryTraceFocusSource {
  id: number;
  contentHash: string;
  outPoint: OutPoint;
  birthBlock: number;
  startsAtSec: number;
  arrivesAtSec: number;
  routes: ConsensusMemoryTraceRoute[];
  visualContinuity?: ConsensusMemoryVisualContinuity;
}

export interface ConsensusMemoryTraceRoute {
  targetId: number;
  /** Exact Cell ids visited by this retained route, including endpoints. */
  path: readonly number[];
  /** Exact display-only carrier lane planned for this retained route. */
  color: Pulse['color'];
  hopCount: number;
  hopMs: number;
  startsAtSec: number;
  arrivesAtSec: number;
}

export interface ConsensusMemorySourceEvidence {
  id: number;
  contentHash: string;
  outPoint: OutPoint;
  birthBlock: number;
}

export interface ConsensusMemoryTraceFocus {
  key: string;
  /** Retained evidence identity that this focus visualizes. */
  linkSeq: number;
  /** Canonical source height, retained through continuity afterimages. */
  linkBlock: number;
  sourceKind: Exclude<ConsensusMemoryTraceSource, 'none'>;
  sources: ConsensusMemoryTraceFocusSource[];
  /** What the transaction consumed. Carried beside the routed sources because
   *  the two answer different questions and only rarely name the same cells. */
  consumedInputs: ConsensusMemoryConsumedInput[];
  routedSourceCount: number;
  targetIds: number[];
  startedAtSec: number;
  endsAtSec: number;
  /** UI-only evidence isolation; always references one routed real source. */
  evidenceFocusSourceId: number | null;
  /** UI-only inspection of one exact Cell retained in one exact route. */
  routeHopFocus: ConsensusMemoryRouteHopFocus | null;
  /** Display-only replay bridge; never changes route/readout lifetime. */
  visualContinuity?: ConsensusMemoryVisualContinuity;
}

/**
 * Stable HUD → scene address for one Cell inside a retained route proof.
 * Every field is revalidated against the authoritative frame-level focus
 * before it may affect WebGL, so stale UI state cannot illuminate another
 * trace, route, Cell, or segment.
 */
export interface ConsensusMemoryRouteHopFocus {
  traceKey: string;
  sourceId: number;
  targetCellId: number;
  cellId: number;
  hopIndex: number;
}

export interface ConsensusMemoryCellResponse {
  role: 'source' | 'target';
  /** Shared fade envelope, including a source's phased reveal. */
  strength: number;
  /** Source travel or target read-head phase, normalized to 0..1. */
  phase: number;
  /** Target witness resolution, or source departure progress. */
  convergence: number;
  /** Exact per-source agreement progress, in stable routed-source order. */
  evidence?: readonly ConsensusMemoryEvidenceResponse[];
  /** Routed source currently isolated by the explanatory UI, if any. */
  evidenceFocusSourceId?: number | null;
}

export interface ConsensusMemoryEvidenceResponse {
  sourceId: number;
  ordinal: number;
  contentHash: string;
  convergence: number;
}

export interface ConsensusMemoryTargetResponse {
  targetCellId: number;
  response: ConsensusMemoryCellResponse;
}

/** Shared imperative lane for frame-level target visuals across Canvas roots. */
export interface ConsensusMemoryCellResponseRef {
  current: ConsensusMemoryTargetResponse | null;
}

export type ConsensusMemoryTraceStage = 'reading' | 'converging' | 'locked';
export type ConsensusMemoryEvidenceState = 'routing' | 'arrived' | 'resolved';

export interface ConsensusMemoryTraceEvidence {
  sourceId: number;
  ordinal: number;
  contentHash: string;
  state: ConsensusMemoryEvidenceState;
  sourceOutPoint: OutPoint;
  sourceBirthBlock: number;
  route: readonly number[];
  hopCount: number;
  /** Deterministic replay travel time on this graph route, not network latency. */
  routeDurationMs: number;
}

/**
 * Low-frequency semantic twin of the target Cell's frame-level response.
 * Consumers such as the DOM HUD can subscribe to stage/count changes without
 * copying route timing or re-rendering at the WebGL frame rate.
 */
export interface ConsensusMemoryTraceReadout {
  key: string;
  targetCellId: number;
  sourceKind: Exclude<ConsensusMemoryTraceSource, 'none'>;
  stage: ConsensusMemoryTraceStage;
  sourceCount: number;
  arrivedSourceCount: number;
  resolvedSourceCount: number;
  /** What the transaction consumed, whether or not any of it still routes.
   *  A witness-carried recall would otherwise never name its real inputs. */
  consumedInputs: ConsensusMemoryConsumedInput[];
  /** Stable evidence ledger used by the HUD and canonical knot bindings. */
  evidence: readonly ConsensusMemoryTraceEvidence[];
}

const smoothUnit = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

function consensusMemoryVisualContinuityFloor(
  continuity: ConsensusMemoryVisualContinuity | undefined,
  nowSec: number,
): number {
  if (!continuity || nowSec >= continuity.endsAtSec) return 0;
  const strength = Number.isFinite(continuity.floorStrength)
    ? clampUnit(continuity.floorStrength)
    : 0;
  if (continuity.mode === 'park') {
    const startedAtSec = continuity.startedAtSec;
    const settlesAtSec = continuity.settlesAtSec;
    if (
      startedAtSec === undefined
      || settlesAtSec === undefined
      || !Number.isFinite(startedAtSec)
      || !Number.isFinite(settlesAtSec)
      || !(settlesAtSec > startedAtSec)
    ) return strength;
    const startStrength = Number.isFinite(continuity.startStrength)
      ? clampUnit(continuity.startStrength ?? 1)
      : 1;
    const settle = smoothUnit(
      (nowSec - startedAtSec) / (settlesAtSec - startedAtSec),
    );
    return startStrength + (strength - startStrength) * settle;
  }
  if (continuity.mode !== 'release') return strength;
  const startedAtSec = continuity.startedAtSec;
  if (startedAtSec === undefined || !Number.isFinite(startedAtSec)) return 0;
  const duration = continuity.endsAtSec - startedAtSec;
  if (!(duration > 0)) return 0;
  return strength * (1 - smoothUnit((nowSec - startedAtSec) / duration));
}

/**
 * Visual-only arrival envelope for a newly selected, independently verified
 * record. It never changes the route clock or readout lifetime; it only keeps
 * the new record quiet while the previous record leaves the scene.
 */
export function consensusMemoryTraceEntryScale(
  focus: ConsensusMemoryTraceFocus | null,
  nowSec: number,
): number {
  const continuity = focus?.visualContinuity;
  if (continuity?.mode !== 'entry') return 1;
  if (!Number.isFinite(nowSec)) return 0;
  const startedAtSec = continuity.startedAtSec;
  if (startedAtSec === undefined || !Number.isFinite(startedAtSec)) return 1;
  if (nowSec >= continuity.endsAtSec) return 1;
  const duration = continuity.endsAtSec - startedAtSec;
  if (!(duration > 0) || nowSec <= startedAtSec) return 0;
  return smoothUnit((nowSec - startedAtSec) / duration);
}

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
  const evidenceById = new Map(
    plan.sourceEvidence.map((source) => [source.id, source]),
  );
  const sourceById = new Map<number, ConsensusMemoryTraceFocusSource>();
  for (const pulse of plan.pulses) {
    const id = pulse.path[0];
    const sourceEvidence = evidenceById.get(id);
    if (!sourceEvidence) continue;
    const startsAtSec = startedAtSec + pulse.startDelayMs / 1000;
    const arrivesAtSec = startsAtSec
      + (pulse.path.length - 1) * pulse.hopMs / 1000;
    const route: ConsensusMemoryTraceRoute = {
      targetId: pulse.path[pulse.path.length - 1],
      path: [...pulse.path],
      color: [...pulse.color],
      hopCount: pulse.path.length - 1,
      hopMs: pulse.hopMs,
      startsAtSec,
      arrivesAtSec,
    };
    const existing = sourceById.get(id);
    if (!existing) {
      sourceById.set(id, {
        id,
        contentHash: sourceEvidence.contentHash,
        outPoint: { ...sourceEvidence.outPoint },
        birthBlock: sourceEvidence.birthBlock,
        startsAtSec,
        arrivesAtSec,
        routes: [route],
      });
      continue;
    }
    existing.startsAtSec = Math.min(existing.startsAtSec, startsAtSec);
    existing.arrivesAtSec = Math.min(existing.arrivesAtSec, arrivesAtSec);
    existing.routes.push(route);
  }
  if (sourceById.size === 0) return null;
  const sources = [...sourceById.values()]
    .map((source) => ({
      ...source,
      routes: source.routes.sort((a, b) => (
        a.startsAtSec - b.startsAtSec
        || a.arrivesAtSec - b.arrivesAtSec
        || a.targetId - b.targetId
      )),
    }))
    .sort((a, b) => (
      a.startsAtSec - b.startsAtSec
      || a.arrivesAtSec - b.arrivesAtSec
      || a.id - b.id
    ))
    .slice(0, MAX_MEMORY_TRACE_FOCUS_ENDPOINTS);
  const targetIds = [...new Set(sources.flatMap(
    (source) => source.routes.map((route) => route.targetId),
  ))].slice(0, MAX_MEMORY_TRACE_FOCUS_ENDPOINTS);
  const lifetimeMs = Math.max(...plan.pulses.map((pulse) => (
    pulse.startDelayMs
      + (pulse.path.length - 1) * pulse.hopMs
      + MEMORY_TRACE_SETTLE_MS
      + MEMORY_TRACE_FADE_MS
  )));
  const originPulse = plan.pulses[0];
  return {
    key,
    linkSeq: originPulse.linkSeq,
    linkBlock: originPulse.linkBlock,
    sourceKind: plan.sourceKind,
    sources,
    consumedInputs: plan.consumedInputs,
    routedSourceCount: sourceById.size,
    targetIds,
    startedAtSec,
    endsAtSec: startedAtSec + lifetimeMs / 1000,
    evidenceFocusSourceId: null,
    routeHopFocus: null,
  };
}

/** Derive one canonical hop address from the exact low-frequency HUD proof. */
export function deriveConsensusMemoryRouteHopFocus(
  readout: ConsensusMemoryTraceReadout | null,
  sourceId: number,
  hopIndex: number,
): ConsensusMemoryRouteHopFocus | null {
  if (
    !readout
    || !Number.isFinite(sourceId)
    || !Number.isInteger(hopIndex)
  ) return null;
  const evidence = readout.evidence.find((source) => source.sourceId === sourceId);
  if (!evidence || hopIndex < 0 || hopIndex >= evidence.route.length) return null;
  const cellId = evidence.route[hopIndex];
  const targetCellId = evidence.route.at(-1);
  if (
    !Number.isFinite(cellId)
    || typeof targetCellId !== 'number'
    || !Number.isFinite(targetCellId)
  ) return null;
  return {
    traceKey: readout.key,
    sourceId: evidence.sourceId,
    targetCellId,
    cellId,
    hopIndex,
  };
}

/** Exact identity comparison shared by HUD preview, lock, and scene focus. */
export function consensusMemoryRouteHopFocusEqual(
  left: ConsensusMemoryRouteHopFocus | null,
  right: ConsensusMemoryRouteHopFocus | null,
): boolean {
  if (left === right) return true;
  return !!left
    && !!right
    && left.traceKey === right.traceKey
    && left.sourceId === right.sourceId
    && left.targetCellId === right.targetCellId
    && left.cellId === right.cellId
    && left.hopIndex === right.hopIndex;
}

export interface ConsensusMemoryRouteHopWindow {
  startIndex: number;
  endIndex: number;
  indices: number[];
  hiddenBefore: number;
  hiddenAfter: number;
}

export type ConsensusMemoryRouteHopRole = 'source' | 'transit' | 'target';

/**
 * Exact route-relative meaning for one locked Cell. Only the endpoints carry
 * causal meaning; intermediate Cells are display carriers chosen by the
 * neighbour-graph router and must never be presented as transaction lineage.
 */
export interface ConsensusMemoryRouteHopInspection {
  cellId: number;
  hopIndex: number;
  role: ConsensusMemoryRouteHopRole;
  previousCellId: number | null;
  nextCellId: number | null;
  distanceFromSource: number;
  distanceToTarget: number;
  progress: number;
}

export interface ConsensusMemoryRouteHopSpatialFocus {
  focus: ConsensusMemoryRouteHopFocus;
  role: ConsensusMemoryRouteHopRole;
  cell: Cell;
  previousCell: Cell | null;
  nextCell: Cell | null;
  routeColor: Pulse['color'];
}

export type ConsensusMemoryRouteHopTransitionKind =
  | 'stationary'
  | 'adjacent'
  | 'discontinuous';

export interface ConsensusMemoryRouteHopTangent {
  from: Cell;
  to: Cell;
}

/**
 * Only consecutive addresses on the same verified route may animate as one
 * spatial handoff. Everything else snaps, rather than drawing a shortcut that
 * does not exist in the retained route.
 */
export function classifyConsensusMemoryRouteHopTransition(
  from: ConsensusMemoryRouteHopFocus,
  to: ConsensusMemoryRouteHopFocus,
): ConsensusMemoryRouteHopTransitionKind {
  const sameRoute = from.traceKey === to.traceKey
    && from.sourceId === to.sourceId
    && from.targetCellId === to.targetCellId;
  if (!sameRoute) return 'discontinuous';
  if (
    from.hopIndex === to.hopIndex
    && from.cellId === to.cellId
  ) return 'stationary';
  return Math.abs(from.hopIndex - to.hopIndex) === 1
    ? 'adjacent'
    : 'discontinuous';
}

/**
 * Resolve the strongest real local route direction available for one glyph.
 * Transit uses previous→next; endpoints use their one retained segment.
 */
export function deriveConsensusMemoryRouteHopTangent(
  spatial: ConsensusMemoryRouteHopSpatialFocus,
): ConsensusMemoryRouteHopTangent | null {
  const from = spatial.previousCell ?? spatial.cell;
  const to = spatial.nextCell ?? spatial.cell;
  return from.id === to.id ? null : { from, to };
}

/** A latch is earned only by crossing the final verified route segment. */
export function isConsensusMemoryRouteHopTargetArrival(
  from: ConsensusMemoryRouteHopSpatialFocus,
  to: ConsensusMemoryRouteHopSpatialFocus,
): boolean {
  return from.role !== 'target'
    && to.role === 'target'
    && classifyConsensusMemoryRouteHopTransition(
      from.focus,
      to.focus,
    ) === 'adjacent';
}

/**
 * Motion preferences and queued departures can suppress the visual ceremony;
 * neither changes the underlying fact that the target record exists.
 */
export function shouldAnimateConsensusMemoryRouteHopTargetLatch(
  from: ConsensusMemoryRouteHopSpatialFocus | null,
  to: ConsensusMemoryRouteHopSpatialFocus,
  options: {
    reducedMotion?: boolean;
    hasQueuedHandoff?: boolean;
  } = {},
): boolean {
  return !options.reducedMotion
    && !options.hasQueuedHandoff
    && !!from
    && isConsensusMemoryRouteHopTargetArrival(from, to);
}

/**
 * Keep a fixed-size reading lens centred on one canonical route hop. Near an
 * endpoint the window shifts instead of shrinking, so long routes do not
 * jitter between three, four, and five visible Cells while stepping.
 */
export function deriveConsensusMemoryRouteHopWindow(
  routeLength: number,
  hopIndex: number,
  radius = 2,
): ConsensusMemoryRouteHopWindow | null {
  if (
    !Number.isInteger(routeLength)
    || routeLength <= 0
    || !Number.isInteger(hopIndex)
    || hopIndex < 0
    || hopIndex >= routeLength
    || !Number.isFinite(radius)
  ) return null;
  const safeRadius = Math.max(0, Math.floor(radius));
  const windowSize = Math.min(routeLength, safeRadius * 2 + 1);
  const startIndex = Math.max(
    0,
    Math.min(routeLength - windowSize, hopIndex - safeRadius),
  );
  const endIndex = startIndex + windowSize - 1;
  return {
    startIndex,
    endIndex,
    indices: Array.from(
      { length: windowSize },
      (_, offset) => startIndex + offset,
    ),
    hiddenBefore: startIndex,
    hiddenAfter: routeLength - endIndex - 1,
  };
}

/** Revalidate and explain one canonical route hop without inventing lineage. */
export function deriveConsensusMemoryRouteHopInspection(
  readout: ConsensusMemoryTraceReadout | null,
  focus: ConsensusMemoryRouteHopFocus | null,
): ConsensusMemoryRouteHopInspection | null {
  if (!focus) return null;
  const canonical = deriveConsensusMemoryRouteHopFocus(
    readout,
    focus.sourceId,
    focus.hopIndex,
  );
  if (!consensusMemoryRouteHopFocusEqual(canonical, focus)) return null;
  const route = readout?.evidence.find(
    ({ sourceId }) => sourceId === focus.sourceId,
  )?.route;
  if (!route) return null;
  const lastIndex = route.length - 1;
  const role: ConsensusMemoryRouteHopRole = focus.hopIndex === 0
    ? 'source'
    : focus.hopIndex === lastIndex
      ? 'target'
      : 'transit';
  return {
    cellId: focus.cellId,
    hopIndex: focus.hopIndex,
    role,
    previousCellId: focus.hopIndex > 0
      ? route[focus.hopIndex - 1] ?? null
      : null,
    nextCellId: focus.hopIndex < lastIndex
      ? route[focus.hopIndex + 1] ?? null
      : null,
    distanceFromSource: focus.hopIndex,
    distanceToTarget: lastIndex - focus.hopIndex,
    progress: lastIndex > 0 ? focus.hopIndex / lastIndex : 0,
  };
}

/**
 * Bind one verified lock to real projection records for its spatial glyph.
 * Missing neighbours merely shorten the local context; a missing locked Cell
 * suppresses the marker instead of fabricating a scene position.
 */
export function deriveConsensusMemoryRouteHopSpatialFocus(
  focus: ConsensusMemoryTraceFocus | null,
  candidate: ConsensusMemoryRouteHopFocus | null,
  cells: ReadonlyMap<number, Cell>,
): ConsensusMemoryRouteHopSpatialFocus | null {
  const canonical = validateConsensusMemoryRouteHopFocus(focus, candidate);
  if (!focus || !canonical) return null;
  const source = focus.sources.find(({ id }) => id === canonical.sourceId);
  const route = source
    ? consensusMemoryTraceRouteForTarget(source, canonical.targetCellId)
    : null;
  const cell = cells.get(canonical.cellId);
  if (!route || !cell) return null;
  const lastIndex = route.path.length - 1;
  const role: ConsensusMemoryRouteHopRole = canonical.hopIndex === 0
    ? 'source'
    : canonical.hopIndex === lastIndex
      ? 'target'
      : 'transit';
  return {
    focus: canonical,
    role,
    cell,
    previousCell: canonical.hopIndex > 0
      ? cells.get(route.path[canonical.hopIndex - 1]) ?? null
      : null,
    nextCell: canonical.hopIndex < lastIndex
      ? cells.get(route.path[canonical.hopIndex + 1]) ?? null
      : null,
    routeColor: route.color,
  };
}

/** Move a locked inspector by one exact retained hop without wrapping. */
export function stepConsensusMemoryRouteHopFocus(
  readout: ConsensusMemoryTraceReadout | null,
  current: ConsensusMemoryRouteHopFocus | null,
  delta: number,
): ConsensusMemoryRouteHopFocus | null {
  if (!current || !Number.isFinite(delta)) return null;
  const canonical = deriveConsensusMemoryRouteHopFocus(
    readout,
    current.sourceId,
    current.hopIndex,
  );
  if (!consensusMemoryRouteHopFocusEqual(canonical, current)) return null;
  const evidence = readout?.evidence.find(
    ({ sourceId }) => sourceId === current.sourceId,
  );
  if (!evidence) return null;
  const direction = delta < 0 ? -1 : delta > 0 ? 1 : 0;
  const hopIndex = Math.max(
    0,
    Math.min(evidence.route.length - 1, current.hopIndex + direction),
  );
  return deriveConsensusMemoryRouteHopFocus(readout, current.sourceId, hopIndex);
}

/**
 * Rebind a HUD hop address to the authoritative route clock. Returning a
 * canonical copy prevents caller-supplied ids from reaching scene geometry.
 */
export function validateConsensusMemoryRouteHopFocus(
  focus: ConsensusMemoryTraceFocus | null,
  candidate: ConsensusMemoryRouteHopFocus | null,
): ConsensusMemoryRouteHopFocus | null {
  if (!focus || !candidate || candidate.traceKey !== focus.key) return null;
  const source = focus.sources.find(({ id }) => id === candidate.sourceId);
  if (!source) return null;
  const route = consensusMemoryTraceRouteForTarget(source, candidate.targetCellId);
  if (
    !route
    || !Number.isInteger(candidate.hopIndex)
    || candidate.hopIndex < 0
    || candidate.hopIndex >= route.path.length
    || route.path[candidate.hopIndex] !== candidate.cellId
  ) return null;
  return {
    traceKey: focus.key,
    sourceId: source.id,
    targetCellId: route.targetId,
    cellId: route.path[candidate.hopIndex],
    hopIndex: candidate.hopIndex,
  };
}

/** Exact adjacent edge indices for an inspected route Cell (one or two). */
export function consensusMemoryRouteHopAdjacentSegments(
  candidate: ConsensusMemoryRouteHopFocus | null,
  path: readonly number[],
): number[] {
  if (
    !candidate
    || path.length < 2
    || path[0] !== candidate.sourceId
    || path.at(-1) !== candidate.targetCellId
    || path[candidate.hopIndex] !== candidate.cellId
  ) return [];
  const segments: number[] = [];
  if (candidate.hopIndex > 0) segments.push(candidate.hopIndex - 1);
  if (candidate.hopIndex < path.length - 1) segments.push(candidate.hopIndex);
  return segments;
}

/** Shared fade-aware emphasis for the exact Cell selected in the route ledger. */
export function consensusMemoryRouteHopCellFocus(
  focus: ConsensusMemoryTraceFocus | null,
  cellId: number,
  nowSec: number,
): number {
  if (focus?.routeHopFocus?.cellId !== cellId) return 0;
  return consensusMemoryTraceFocusStrength(focus, nowSec);
}

/** Exact retained route from one real source into a particular target Cell. */
export function consensusMemoryTraceRouteForTarget(
  source: ConsensusMemoryTraceFocusSource,
  targetCellId: number,
): ConsensusMemoryTraceRoute | null {
  return source.routes.find((route) => route.targetId === targetCellId) ?? null;
}

/**
 * Shared evidence-isolation scale for real sources, routes, and agreement
 * knots. A null candidate represents target structure without a direct
 * evidence binding, which remains visible as quieter context.
 */
export function consensusMemoryEvidenceFocusScale(
  candidateSourceId: number | null,
  focusedSourceId: number | null,
): number {
  if (focusedSourceId === null || !Number.isFinite(focusedSourceId)) return 1;
  if (candidateSourceId !== null && candidateSourceId === focusedSourceId) return 1;
  return candidateSourceId === null
    ? MEMORY_TRACE_EVIDENCE_CONTEXT_SCALE
    : MEMORY_TRACE_EVIDENCE_PASSIVE_SCALE;
}

/** Shared envelope for endpoint labels and passive-fabric de-emphasis. */
export function consensusMemoryTraceFocusStrength(
  focus: ConsensusMemoryTraceFocus | null,
  nowSec: number,
): number {
  if (!focus || !Number.isFinite(nowSec)) return 0;
  const ageMs = (nowSec - focus.startedAtSec) * 1000;
  const remainingMs = (focus.endsAtSec - nowSec) * 1000;
  const continuityStrength = consensusMemoryVisualContinuityFloor(
    focus.visualContinuity,
    nowSec,
  );
  if (remainingMs <= 0) return 0;
  // A React effect may stamp the new replay a fraction of a render frame
  // ahead of SimClockTicker. Keep the verified predecessor visible across
  // that clock boundary instead of producing one black frame.
  if (ageMs < 0) {
    return focus.visualContinuity?.mode === 'entry'
      ? 0
      : continuityStrength;
  }
  const fadeIn = smoothUnit(ageMs / MEMORY_TRACE_FOCUS_FADE_IN_MS);
  const fadeOut = smoothUnit(remainingMs / MEMORY_TRACE_FOCUS_FADE_OUT_MS);
  if (focus.visualContinuity?.mode === 'release') return continuityStrength;
  if (focus.visualContinuity?.mode === 'park') {
    return continuityStrength * fadeOut;
  }
  const nativeStrength = fadeIn * fadeOut;
  return focus.visualContinuity?.mode === 'entry'
    ? nativeStrength * consensusMemoryTraceEntryScale(focus, nowSec)
    : Math.max(nativeStrength, continuityStrength);
}

/** Reveal each real source shortly before its own phased route departs. */
export function consensusMemoryTraceSourceStrength(
  source: ConsensusMemoryTraceFocusSource,
  nowSec: number,
): number {
  if (!Number.isFinite(nowSec)) return 0;
  const revealAgeMs = (nowSec - source.startsAtSec) * 1000
    + MEMORY_TRACE_SOURCE_REVEAL_LEAD_MS;
  const nativeStrength = revealAgeMs <= 1e-6
    ? 0
    : revealAgeMs >= MEMORY_TRACE_SOURCE_REVEAL_MS
      ? 1
      : smoothUnit(revealAgeMs / MEMORY_TRACE_SOURCE_REVEAL_MS);
  const continuityStrength = consensusMemoryVisualContinuityFloor(
    source.visualContinuity,
    nowSec,
  );
  return source.visualContinuity?.mode === 'hold'
    || source.visualContinuity?.mode === 'release'
    ? continuityStrength
    : Math.max(nativeStrength, continuityStrength);
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
    const evidence = focus.sources.flatMap((source) => {
      const route = consensusMemoryTraceRouteForTarget(source, cellId);
      return route ? [{ source, route }] : [];
    }).map(({ source, route }, index) => ({
      sourceId: source.id,
      ordinal: index + 1,
      contentHash: source.contentHash,
      convergence: smoothUnit(
        (nowSec - route.arrivesAtSec) * 1000
          / MEMORY_TRACE_CELL_CONVERGENCE_MS,
      ),
    }));
    const convergence = evidence.length === 0
      ? 0
      : evidence.reduce((total, source) => total + source.convergence, 0)
        / evidence.length;
    return {
      role: 'target',
      strength: focusStrength,
      phase,
      convergence,
      evidence,
      evidenceFocusSourceId: focus.evidenceFocusSourceId,
    };
  }

  const source = focus.sources.find((candidate) => candidate.id === cellId);
  if (!source) return null;
  const travelSeconds = Math.max(0.001, source.arrivesAtSec - source.startsAtSec);
  const phase = clampUnit((nowSec - source.startsAtSec) / travelSeconds);
  return {
    role: 'source',
    strength: focusStrength
      * consensusMemoryTraceSourceStrength(source, nowSec)
      * consensusMemoryEvidenceFocusScale(source.id, focus.evidenceFocusSourceId),
    phase,
    convergence: phase,
    evidenceFocusSourceId: focus.evidenceFocusSourceId,
  };
}

/**
 * Project the same routed arrival clock used by the Cell shader into a compact
 * explanatory state. "Reading" lasts until evidence reaches the target;
 * "converging" spans the real per-source agreement transition; "locked" is
 * emitted only once every routed source has fully resolved.
 */
export function consensusMemoryTraceReadout(
  focus: ConsensusMemoryTraceFocus | null,
  targetCellId: number,
  nowSec: number,
): ConsensusMemoryTraceReadout | null {
  if (
    !focus
    || !focus.targetIds.includes(targetCellId)
    || !Number.isFinite(nowSec)
    || nowSec < focus.startedAtSec
    || nowSec >= focus.endsAtSec
  ) return null;

  const resolutionSec = MEMORY_TRACE_CELL_CONVERGENCE_MS / 1000;
  const routedSources = focus.sources.flatMap((source) => {
    const route = consensusMemoryTraceRouteForTarget(source, targetCellId);
    return route ? [{ source, route }] : [];
  });
  const evidence = routedSources.map(({ source, route }, index) => ({
    sourceId: source.id,
    ordinal: index + 1,
    contentHash: source.contentHash,
    state: nowSec >= route.arrivesAtSec + resolutionSec
      ? 'resolved' as const
      : nowSec >= route.arrivesAtSec
        ? 'arrived' as const
        : 'routing' as const,
    sourceOutPoint: { ...source.outPoint },
    sourceBirthBlock: source.birthBlock,
    route: route.path,
    hopCount: route.hopCount,
    routeDurationMs: route.hopCount * route.hopMs,
  }));
  const arrivedSourceCount = evidence.filter(
    (source) => source.state !== 'routing',
  ).length;
  const resolvedSourceCount = evidence.filter(
    (source) => source.state === 'resolved',
  ).length;
  const locked = routedSources.length > 0
    && resolvedSourceCount === routedSources.length;
  const stage: ConsensusMemoryTraceStage = locked
    ? 'locked'
    : arrivedSourceCount > 0
      ? 'converging'
      : 'reading';

  return {
    key: focus.key,
    targetCellId,
    sourceKind: focus.sourceKind,
    stage,
    sourceCount: routedSources.length,
    arrivedSourceCount,
    resolvedSourceCount,
    consumedInputs: focus.consumedInputs,
    evidence,
  };
}

/** Transfer focal energy from completed evidence paths into the retained Cell. */
export function consensusMemoryRouteHandoffScale(convergence: number): number {
  const resolved = Number.isFinite(convergence) ? clampUnit(convergence) : 0;
  return 1 - resolved * (1 - MEMORY_TRACE_ROUTE_HANDOFF_FLOOR);
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
 * What this transaction actually consumed, read from the link's own durable
 * evidence rather than from whatever cells happen to still be around.
 *
 * A spent cell leaves the view almost immediately — its death animation ends,
 * the stage drops it, the retained window eventually gc's it — so asking the
 * cell map "which inputs are still here" answers `none` for essentially every
 * historical link. The link record anticipated exactly that: `endpoint_anchors`
 * captured each endpoint's identity at the moment the transaction landed, and
 * keeps it for as long as the record itself survives.
 *
 * `retained` reports whether the same cell is ALSO resolvable in the view this
 * recall is planned against — i.e. whether a route could pass through it. That
 * is a separate question from what was consumed, and conflating the two is why
 * the true inputs used to go unnamed.
 *
 * Ordered by `from_ids`, so the reading matches the transaction's own input
 * order. Ids without an anchor are dropped: they come from records written
 * before anchors existed, and inventing an identity for them would be worse
 * than admitting the record is silent.
 */
export function deriveConsensusMemoryConsumedInputs(
  link: CellLink,
  cells: ReadonlyMap<number, Cell>,
): ConsensusMemoryConsumedInput[] {
  const anchors = link.endpoint_anchors;
  if (!anchors || anchors.length === 0) return [];
  const anchorById = new Map(anchors.map((anchor) => [anchor.id, anchor]));
  const seen = new Set<number>();
  const consumed: ConsensusMemoryConsumedInput[] = [];
  for (const id of link.from_ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const anchor = anchorById.get(id);
    if (!anchor) continue;
    consumed.push({
      id,
      contentHash: anchor.content_hash,
      posSeed: [anchor.pos_seed[0], anchor.pos_seed[1], anchor.pos_seed[2]],
      retained: cells.has(id),
    });
  }
  return consumed;
}

/**
 * Resolve honest recall sources. Exact consumed inputs win while they are
 * still routable. Afterwards, live sibling outputs from the same parent
 * transactions carry the route as lineage witnesses; they are never labeled as
 * inputs.
 *
 * The witness branch is a ROUTING fallback, not an evidence fallback: what the
 * transaction consumed is answered separately by `consumedInputs`, which the
 * cell map cannot take away.
 */
export function deriveConsensusMemoryTraceEndpoints(
  link: CellLink,
  cells: ReadonlyMap<number, Cell>,
  maxWitnessesPerParent: number = 2,
): ConsensusMemoryTraceEndpoints {
  const consumedInputs = deriveConsensusMemoryConsumedInputs(link, cells);
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
    consumedInputs,
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
  const sourceEvidence = endpoints.sourceIds.flatMap((id) => {
    const source = cells.get(id);
    return source ? [{
      id,
      contentHash: source.content_hash,
      outPoint: { ...source.out_point },
      birthBlock: source.birth_block,
    }] : [];
  });
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
    linkSeq: link.seq,
    linkBlock: link.block,
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

  return { pulses, sourceEvidence, ...plannedEndpoints };
}
