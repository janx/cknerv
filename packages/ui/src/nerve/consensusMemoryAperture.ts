import type { Cell } from '@cknerv/types';
import { bezierAt, bezierControl, fabricEdgeSeed } from '../geometry/edgeBezier';
import { fabricEdgeKey } from './fabricOrder';
import {
  consensusMemoryTraceRouteForTarget,
  type ConsensusMemoryTraceFocus,
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

export interface ConsensusMemoryApertureSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
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
}

interface MutableConsensusMemoryAperture {
  segments: ConsensusMemoryApertureSegment[];
  buckets: Map<number, Map<number, number[]>>;
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
  segment: ConsensusMemoryApertureSegment,
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
): void {
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
    };
    const segmentIndex = field.segments.length;
    field.segments.push(segment);
    indexSegment(field, segmentIndex, segment);
    previous = point;
  }
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
  };
  const seenEdges = new Set<string>();
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
        if (seenEdges.has(key)) continue;
        seenEdges.add(key);
        appendRouteEdge(
          field,
          fromId,
          toId,
          routeCells[index],
          routeCells[index + 1],
        );
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

function distanceSquaredToSegment(
  x: number,
  z: number,
  segment: ConsensusMemoryApertureSegment,
): number {
  const dx = segment.bx - segment.ax;
  const dz = segment.bz - segment.az;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 1e-12) {
    const pointDx = x - segment.ax;
    const pointDz = z - segment.az;
    return pointDx * pointDx + pointDz * pointDz;
  }
  const projection = Math.max(0, Math.min(1, (
    (x - segment.ax) * dx + (z - segment.az) * dz
  ) / lengthSquared));
  const pointDx = x - (segment.ax + dx * projection);
  const pointDz = z - (segment.az + dz * projection);
  return pointDx * pointDx + pointDz * pointDz;
}

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Passive-fabric scale at one world-space sample. Outside the route aperture
 * this is exactly 1. A real lifecycle flash progressively reclaims full energy
 * so current chain truth always outranks historical inspection.
 */
export function consensusMemoryApertureScale(
  field: ConsensusMemoryAperture | null | undefined,
  x: number,
  z: number,
  strength: number,
  lifecycleFlash = 0,
): number {
  if (
    !field
    || !Number.isFinite(x)
    || !Number.isFinite(z)
    || !Number.isFinite(strength)
    || strength <= 0
  ) return 1;
  const focus = clampUnit(strength);
  const gridX = Math.floor(x / field.gridSize);
  const gridZ = Math.floor(z / field.gridSize);
  const candidates = field.buckets.get(gridX)?.get(gridZ);
  if (!candidates || candidates.length === 0) return 1;

  let nearestSquared = Infinity;
  for (const segmentIndex of candidates) {
    const segment = field.segments[segmentIndex];
    if (!segment) continue;
    nearestSquared = Math.min(
      nearestSquared,
      distanceSquaredToSegment(x, z, segment),
    );
  }
  const outerSquared = field.outerRadius * field.outerRadius;
  if (nearestSquared >= outerSquared) return 1;

  const distance = Math.sqrt(nearestSquared);
  const transition = field.outerRadius > field.innerRadius
    ? clampUnit(
      (distance - field.innerRadius) / (field.outerRadius - field.innerRadius),
    )
    : Number(distance >= field.outerRadius);
  const smoothTransition = transition * transition * (3 - 2 * transition);
  const localScale = CONSENSUS_MEMORY_APERTURE_CORE_SCALE
    + (1 - CONSENSUS_MEMORY_APERTURE_CORE_SCALE) * smoothTransition;
  let scale = 1 - focus * (1 - localScale);
  const reclaim = Number.isFinite(lifecycleFlash)
    ? clampUnit(lifecycleFlash)
    : 0;
  scale += (1 - scale) * reclaim;
  return scale;
}
