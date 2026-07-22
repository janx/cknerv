import type { Cell } from '@cknerv/types';
import { bezierAt, bezierControl, fabricEdgeSeed } from '../geometry/edgeBezier';
import { fabricEdgeKey } from './fabricOrder';
import {
  MEMORY_TRACE_FADE_MS,
  MEMORY_TRACE_SETTLE_MS,
  MEMORY_TRACE_SOURCE_REVEAL_MS,
  consensusMemoryTraceRouteForTarget,
  type ConsensusMemoryTraceFocus,
  type ConsensusMemoryTraceRoute,
} from './consensusMemoryTrace';

/** Full passive-fabric attenuation at the centre of a recalled route. */
export const CONSENSUS_MEMORY_APERTURE_CORE_SCALE = 0.20;
/** Keep the darkest part narrow enough to read as clearance, not a tunnel. */
export const CONSENSUS_MEMORY_APERTURE_INNER_RADIUS = 2.5;
/** Nearby visual noise yields; unrelated parts of the galaxy stay untouched. */
export const CONSENSUS_MEMORY_APERTURE_OUTER_RADIUS = 9;
/** Route curves are tessellated only for distance queries, never for drawing. */
const CONSENSUS_MEMORY_APERTURE_SAMPLE_SPACING = 6;
const CONSENSUS_MEMORY_APERTURE_MAX_SAMPLES_PER_EDGE = 16;
const CONSENSUS_MEMORY_APERTURE_GRID_SIZE =
  CONSENSUS_MEMORY_APERTURE_OUTER_RADIUS;
const CONSENSUS_MEMORY_APERTURE_OPEN_SECONDS =
  MEMORY_TRACE_SOURCE_REVEAL_MS / 1_000;

export interface ConsensusMemoryApertureTraversal {
  /** Exact wavefront time at this tessellated segment's two endpoints. */
  opensAtStartSec: number;
  opensAtEndSec: number;
  /** Exact source→target progress at the same two endpoints. */
  routeProgressStart: number;
  routeProgressEnd: number;
  /** One real hop, used only to feather the targetward closure front. */
  routeProgressFeather: number;
  /** Existing post-arrival settle and resonance-fade boundaries. */
  collapseStartsAtSec: number;
  collapseEndsAtSec: number;
}

export interface ConsensusMemoryApertureSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** One curve may carry several real sources at distinct trace times. */
  traversals: readonly ConsensusMemoryApertureTraversal[];
}

type ConsensusMemoryApertureZBuckets = ReadonlyMap<
  number,
  readonly number[]
>;

/**
 * A CPU-side lookup field around exact, already-verified trace curves.
 * It carries no renderable geometry and cannot introduce a new route.
 */
export interface ConsensusMemoryAperture {
  segments: readonly ConsensusMemoryApertureSegment[];
  buckets: ReadonlyMap<number, ConsensusMemoryApertureZBuckets>;
  edgeCount: number;
  gridSize: number;
  innerRadius: number;
  outerRadius: number;
  temporalStartsAtSec: number;
  temporalEndsAtSec: number;
}

interface MutableConsensusMemoryApertureSegment
  extends Omit<ConsensusMemoryApertureSegment, 'traversals'> {
  traversals: ConsensusMemoryApertureTraversal[];
}

interface MutableConsensusMemoryAperture {
  segments: MutableConsensusMemoryApertureSegment[];
  buckets: Map<number, Map<number, number[]>>;
  temporalStartsAtSec: number;
  temporalEndsAtSec: number;
}

const finitePosition = (cell: Cell | undefined): cell is Cell => (
  cell !== undefined
  && Number.isFinite(cell.pos_seed[0])
  && Number.isFinite(cell.pos_seed[1])
  && Number.isFinite(cell.pos_seed[2])
);

function indexSegment(
  field: MutableConsensusMemoryAperture,
  segmentIndex: number,
  segment: MutableConsensusMemoryApertureSegment,
): void {
  const minGridX = Math.floor(
    (Math.min(segment.ax, segment.bx) - CONSENSUS_MEMORY_APERTURE_OUTER_RADIUS)
      / CONSENSUS_MEMORY_APERTURE_GRID_SIZE,
  );
  const maxGridX = Math.floor(
    (Math.max(segment.ax, segment.bx) + CONSENSUS_MEMORY_APERTURE_OUTER_RADIUS)
      / CONSENSUS_MEMORY_APERTURE_GRID_SIZE,
  );
  const minGridZ = Math.floor(
    (Math.min(segment.az, segment.bz) - CONSENSUS_MEMORY_APERTURE_OUTER_RADIUS)
      / CONSENSUS_MEMORY_APERTURE_GRID_SIZE,
  );
  const maxGridZ = Math.floor(
    (Math.max(segment.az, segment.bz) + CONSENSUS_MEMORY_APERTURE_OUTER_RADIUS)
      / CONSENSUS_MEMORY_APERTURE_GRID_SIZE,
  );

  for (let gridX = minGridX; gridX <= maxGridX; gridX++) {
    let zBuckets = field.buckets.get(gridX);
    if (!zBuckets) {
      zBuckets = new Map<number, number[]>();
      field.buckets.set(gridX, zBuckets);
    }
    for (let gridZ = minGridZ; gridZ <= maxGridZ; gridZ++) {
      let candidates = zBuckets.get(gridZ);
      if (!candidates) {
        candidates = [];
        zBuckets.set(gridZ, candidates);
      }
      candidates.push(segmentIndex);
    }
  }
}

function appendRouteEdge(
  field: MutableConsensusMemoryAperture,
  fromId: number,
  toId: number,
  from: Cell,
  to: Cell,
): number[] {
  const seed = fabricEdgeSeed(fromId, toId);
  const control = bezierControl(
    from.pos_seed[0], from.pos_seed[1], from.pos_seed[2],
    to.pos_seed[0], to.pos_seed[1], to.pos_seed[2],
    seed,
  );
  const chord = Math.hypot(
    to.pos_seed[0] - from.pos_seed[0],
    to.pos_seed[1] - from.pos_seed[1],
    to.pos_seed[2] - from.pos_seed[2],
  );
  const sampleCount = Math.max(
    2,
    Math.min(
      CONSENSUS_MEMORY_APERTURE_MAX_SAMPLES_PER_EDGE,
      Math.ceil(chord / CONSENSUS_MEMORY_APERTURE_SAMPLE_SPACING),
    ),
  );
  let previous = from.pos_seed;
  const segmentIndices: number[] = [];
  for (let index = 1; index <= sampleCount; index++) {
    const point = bezierAt(
      from.pos_seed[0], from.pos_seed[1], from.pos_seed[2],
      control[0], control[1], control[2],
      to.pos_seed[0], to.pos_seed[1], to.pos_seed[2],
      index / sampleCount,
    );
    const segment = {
      ax: previous[0],
      az: previous[2],
      bx: point[0],
      bz: point[2],
      traversals: [],
    };
    const segmentIndex = field.segments.length;
    field.segments.push(segment);
    segmentIndices.push(segmentIndex);
    indexSegment(field, segmentIndex, segment);
    previous = point;
  }
  return segmentIndices;
}

function appendRouteTraversal(
  field: MutableConsensusMemoryAperture,
  segmentIndices: readonly number[],
  route: ConsensusMemoryTraceRoute,
  hopIndex: number,
): void {
  const sampleCount = segmentIndices.length;
  const hopSeconds = route.hopMs / 1_000;
  const collapseStartsAtSec = route.arrivesAtSec
    + MEMORY_TRACE_SETTLE_MS / 1_000;
  const collapseEndsAtSec = collapseStartsAtSec
    + MEMORY_TRACE_FADE_MS / 1_000;
  const routeProgressFeather = 1 / route.hopCount;
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const segment = field.segments[segmentIndices[sampleIndex]];
    if (!segment) continue;
    const edgeProgressStart = sampleIndex / sampleCount;
    const edgeProgressEnd = (sampleIndex + 1) / sampleCount;
    const traversal: ConsensusMemoryApertureTraversal = {
      opensAtStartSec: route.startsAtSec
        + (hopIndex + edgeProgressStart) * hopSeconds,
      opensAtEndSec: route.startsAtSec
        + (hopIndex + edgeProgressEnd) * hopSeconds,
      routeProgressStart: (hopIndex + edgeProgressStart) / route.hopCount,
      routeProgressEnd: (hopIndex + edgeProgressEnd) / route.hopCount,
      routeProgressFeather,
      collapseStartsAtSec,
      collapseEndsAtSec,
    };
    segment.traversals.push(traversal);
    field.temporalStartsAtSec = Math.min(
      field.temporalStartsAtSec,
      traversal.opensAtStartSec,
    );
    field.temporalEndsAtSec = Math.max(
      field.temporalEndsAtSec,
      traversal.collapseEndsAtSec,
    );
  }
}

function validRouteTiming(route: ConsensusMemoryTraceRoute): boolean {
  if (
    !Number.isFinite(route.startsAtSec)
    || !Number.isFinite(route.arrivesAtSec)
    || !Number.isFinite(route.hopMs)
    || route.hopMs <= 0
  ) return false;
  const expectedArrival = route.startsAtSec
    + route.hopCount * route.hopMs / 1_000;
  return Math.abs(expectedArrival - route.arrivesAtSec) <= 1e-3;
}

/**
 * Build a clearance field exclusively from complete retained route proofs.
 * A malformed route or one missing any Cell is skipped as a whole: partial
 * paths must never imply consensus geometry that is no longer in the cache.
 */
export function deriveConsensusMemoryAperture(
  focus: ConsensusMemoryTraceFocus | null | undefined,
  cells: ReadonlyMap<number, Cell>,
): ConsensusMemoryAperture | null {
  if (!focus) return null;
  const field: MutableConsensusMemoryAperture = {
    segments: [],
    buckets: new Map(),
    temporalStartsAtSec: Infinity,
    temporalEndsAtSec: -Infinity,
  };
  const seenEdges = new Set<string>();
  const orientedEdgeSegments = new Map<string, readonly number[]>();
  const targetIds = new Set(focus.targetIds);

  for (const source of focus.sources) {
    for (const targetId of targetIds) {
      const route = consensusMemoryTraceRouteForTarget(source, targetId);
      if (!route) continue;
      const path = route.path;
      if (
        path.length < 2
        || path[0] !== source.id
        || path[path.length - 1] !== targetId
        || route.hopCount !== path.length - 1
        || new Set(path).size !== path.length
        || !validRouteTiming(route)
      ) continue;

      const routeCells: Cell[] = [];
      let valid = true;
      for (const cellId of path) {
        const cell = cells.get(cellId);
        if (!Number.isFinite(cellId) || !finitePosition(cell)) {
          valid = false;
          break;
        }
        routeCells.push(cell);
      }
      if (!valid) continue;

      for (let index = 0; index < path.length - 1; index++) {
        const fromId = path[index];
        const toId = path[index + 1];
        if (fromId === toId) continue;
        const key = fabricEdgeKey(fromId, toId);
        seenEdges.add(key);
        const orientedKey = `${fromId}>${toId}`;
        let segmentIndices = orientedEdgeSegments.get(orientedKey);
        if (!segmentIndices) {
          segmentIndices = appendRouteEdge(
            field,
            fromId,
            toId,
            routeCells[index],
            routeCells[index + 1],
          );
          orientedEdgeSegments.set(orientedKey, segmentIndices);
        }
        appendRouteTraversal(field, segmentIndices, route, index);
      }
    }
  }

  if (seenEdges.size === 0 || field.segments.length === 0) return null;
  return {
    ...field,
    edgeCount: seenEdges.size,
    gridSize: CONSENSUS_MEMORY_APERTURE_GRID_SIZE,
    innerRadius: CONSENSUS_MEMORY_APERTURE_INNER_RADIUS,
    outerRadius: CONSENSUS_MEMORY_APERTURE_OUTER_RADIUS,
  };
}

function projectionOntoSegment(
  x: number,
  z: number,
  segment: ConsensusMemoryApertureSegment,
): number {
  const dx = segment.bx - segment.ax;
  const dz = segment.bz - segment.az;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 1e-12) return 0;
  return Math.max(0, Math.min(1, (
    (x - segment.ax) * dx + (z - segment.az) * dz
  ) / lengthSquared));
}

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));
const smoothUnit = (value: number): number => {
  const clamped = clampUnit(value);
  return clamped * clamped * (3 - 2 * clamped);
};

function traversalStrengthAt(
  traversal: ConsensusMemoryApertureTraversal,
  projection: number,
  nowSec: number,
): number {
  const opensAtSec = traversal.opensAtStartSec
    + (traversal.opensAtEndSec - traversal.opensAtStartSec) * projection;
  const opening = smoothUnit(
    (nowSec - opensAtSec) / CONSENSUS_MEMORY_APERTURE_OPEN_SECONDS,
  );
  if (opening <= 0 || nowSec >= traversal.collapseEndsAtSec) return 0;
  if (nowSec <= traversal.collapseStartsAtSec) return opening;

  const collapseDuration = traversal.collapseEndsAtSec
    - traversal.collapseStartsAtSec;
  if (!(collapseDuration > 0)) return 0;
  const collapseProgress = smoothUnit(
    (nowSec - traversal.collapseStartsAtSec) / collapseDuration,
  );
  const routeProgress = traversal.routeProgressStart
    + (traversal.routeProgressEnd - traversal.routeProgressStart) * projection;
  const feather = Math.max(1e-6, traversal.routeProgressFeather);
  // Advance one feather beyond the target by the end so even the final Cell
  // releases cleanly; during the fade the retained aperture recedes in exact
  // source→target route order rather than dissolving everywhere at once.
  const closureFront = collapseProgress * (1 + feather);
  const retained = 1 - smoothUnit((closureFront - routeProgress) / feather);
  return opening * retained;
}

function segmentTemporalStrength(
  segment: ConsensusMemoryApertureSegment,
  projection: number,
  nowSec: number | undefined,
): number {
  if (nowSec === undefined) return 1;
  let strongest = 0;
  for (const traversal of segment.traversals) {
    strongest = Math.max(
      strongest,
      traversalStrengthAt(traversal, projection, nowSec),
    );
  }
  return strongest;
}

/** True only while a route aperture can still change under the trace clock. */
export function consensusMemoryApertureAnimating(
  field: ConsensusMemoryAperture | null | undefined,
  nowSec: number,
): boolean {
  return !!field
    && Number.isFinite(nowSec)
    && nowSec >= field.temporalStartsAtSec
    && nowSec <= field.temporalEndsAtSec;
}

/**
 * Passive-fabric scale at one world-space sample. Outside the route aperture
 * this is exactly 1. When `nowSec` is supplied, a point opens only after the
 * real evidence wavefront reaches it and later closes source→target on the
 * existing settle/resonance clock. A real lifecycle flash progressively
 * reclaims full energy so current chain truth always outranks history.
 */
export function consensusMemoryApertureScale(
  field: ConsensusMemoryAperture | null | undefined,
  x: number,
  z: number,
  strength: number,
  nowSec?: number,
  lifecycleFlash = 0,
): number {
  if (
    !field
    || !Number.isFinite(x)
    || !Number.isFinite(z)
    || !Number.isFinite(strength)
    || (nowSec !== undefined && !Number.isFinite(nowSec))
    || strength <= 0
  ) return 1;
  const focus = clampUnit(strength);
  const gridX = Math.floor(x / field.gridSize);
  const gridZ = Math.floor(z / field.gridSize);
  const candidates = field.buckets.get(gridX)?.get(gridZ);
  if (!candidates || candidates.length === 0) return 1;

  let strongestEffect = 0;
  const outerSquared = field.outerRadius * field.outerRadius;
  for (const segmentIndex of candidates) {
    const segment = field.segments[segmentIndex];
    if (!segment) continue;
    const projection = projectionOntoSegment(x, z, segment);
    const pointX = segment.ax + (segment.bx - segment.ax) * projection;
    const pointZ = segment.az + (segment.bz - segment.az) * projection;
    const pointDx = x - pointX;
    const pointDz = z - pointZ;
    const distanceSquared = pointDx * pointDx + pointDz * pointDz;
    if (distanceSquared >= outerSquared) continue;
    const temporalStrength = segmentTemporalStrength(
      segment,
      projection,
      nowSec,
    );
    if (temporalStrength <= 0) continue;
    const distance = Math.sqrt(distanceSquared);
    const transition = field.outerRadius > field.innerRadius
      ? clampUnit(
        (distance - field.innerRadius)
          / (field.outerRadius - field.innerRadius),
      )
      : Number(distance >= field.outerRadius);
    const spatialStrength = 1 - smoothUnit(transition);
    strongestEffect = Math.max(
      strongestEffect,
      (1 - CONSENSUS_MEMORY_APERTURE_CORE_SCALE)
        * spatialStrength
        * temporalStrength,
    );
  }
  if (strongestEffect <= 0) return 1;
  let scale = 1 - focus * strongestEffect;
  const reclaim = Number.isFinite(lifecycleFlash)
    ? clampUnit(lifecycleFlash)
    : 0;
  scale += (1 - scale) * reclaim;
  return scale;
}
