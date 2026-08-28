// CellNucleus spatial candidates — a private position index over the exact
// drawn prefix, kept behind the far-field bounds gate. CellGalaxy already owns
// the id → stable-slot lookup, so this cache deliberately does not mirror it
// or retain anything from the resident tail. A field version is the caller's
// promise that positions at each drawn slot have not moved; payload-only Cell
// replacements therefore reuse it.
//
// Order of work on a LOD tick (`collectCellNucleusCandidateIndices`):
//   1. the O(1) bounding-sphere gate — when the whole drawn field is beyond
//      the admission radius (every production pose short of a hand dolly) no
//      drawn slot can pass the distance test, so the spatial index is neither
//      built nor refreshed and only the semantic-id lane runs;
//   2. otherwise the flat bucket grid is (re)built for the current field
//      version and the 3³ buckets around the camera are walked.
// A stale index is never queried: its key is checked on every tick that
// reaches it, and a tick the gate answers never reads it at all.

import {
  cellNucleusFarFieldBeyond,
  ensureCellFieldBounds,
  makeCellFieldBoundsCache,
  type CellFieldBoundsCache,
} from './cellNucleusFarField.derive';

export interface CellNucleusSpatialSource {
  readonly id: number;
  readonly pos_seed: readonly [number, number, number];
}

/** Bucket coordinates beyond this magnitude do not get a dense grid. The
 * limit keeps every stored coordinate a plain int32 and every grid span a
 * safe integer; a real field sits ten orders of magnitude inside it. */
const DENSE_BUCKET_COORD_LIMIT = 1 << 30;
/** Largest bucket box laid out as a dense head grid (4 MB of int32 at the
 * cap). The production field is ~14 × 4 × 12 buckets; a field that does not
 * fit is indexed exactly through the overflow chain instead. */
const CELL_NUCLEUS_MAX_DENSE_BUCKETS = 1 << 18;
/** Sentinel bucket coordinate for a slot whose position is not finite. */
const NON_FINITE_BUCKET = 0x7fffffff;
/** The gate is a proof, so it carries a hair of slack against the
 * floating-point gap between "sphere distance minus radius" and the walk's
 * own per-slot distance test: inside this band the index is built and the
 * exact test decides, which is what happened before the gate existed. */
export const CELL_NUCLEUS_FAR_FIELD_GATE_SLACK = 1e-6;

export interface CellNucleusSpatialIndex {
  version: number;
  /** Drawn prefix indexed for camera-distance admission. */
  count: number;
  bucketSize: number;
  /** True when `heads` covers the drawn field's bucket box; false when the
   * box could not be laid out densely (no finite slot, or coordinates past
   * the dense limits), in which case every finite slot sits on the
   * overflow chain and the query stays exact by walking it. */
  dense: boolean;
  /** Inclusive bucket-space corner and spans of the dense box. */
  minBx: number;
  minBy: number;
  minBz: number;
  spanX: number;
  spanY: number;
  spanZ: number;
  /** Flat `spanX * spanY * spanZ` grid: newest slot per bucket, -1 empty. */
  heads: Int32Array;
  /** Reusable intrusive bucket chains, indexed by drawn slot. */
  next: Int32Array;
  /** Newest slot outside the dense grid, -1 when none. */
  overflowHead: number;
  /** Per-slot bucket coordinates (3 per slot) so a rebuild reads each drawn
   * record exactly once and links from typed memory. */
  bucketCoords: Int32Array;
  /** Testable rebuild generation; steady LOD queries never move it. */
  generation: number;
}

/** The stable-slot owner is allowed to expose only Map#get. Keeping the
 * contract this small also makes stale/missing lookup behavior testable. */
export interface CellNucleusSlotLookup {
  get(cellId: number): number | undefined;
}

export interface CellNucleusCandidateScratch {
  readonly indices: number[];
  readonly seen: Set<number>;
}

/** Everything one CellNucleus keeps between LOD ticks: the bounds gate, the
 * lazily built index, and the candidate scratch they both write into. */
export interface CellNucleusLodCandidateCache {
  readonly bounds: CellFieldBoundsCache;
  readonly index: CellNucleusSpatialIndex;
  readonly scratch: CellNucleusCandidateScratch;
}

export function makeCellNucleusSpatialIndex(): CellNucleusSpatialIndex {
  return {
    version: -1,
    count: -1,
    bucketSize: 1,
    dense: false,
    minBx: 0,
    minBy: 0,
    minBz: 0,
    spanX: 0,
    spanY: 0,
    spanZ: 0,
    heads: new Int32Array(0),
    next: new Int32Array(0),
    overflowHead: -1,
    bucketCoords: new Int32Array(0),
    generation: 0,
  };
}

export function makeCellNucleusCandidateScratch(): CellNucleusCandidateScratch {
  return {
    indices: [],
    seen: new Set(),
  };
}

export function makeCellNucleusLodCandidateCache(): CellNucleusLodCandidateCache {
  return {
    bounds: makeCellFieldBoundsCache(),
    index: makeCellNucleusSpatialIndex(),
    scratch: makeCellNucleusCandidateScratch(),
  };
}

function normalizedCount(
  cells: readonly CellNucleusSpatialSource[],
  count: number,
): number {
  if (!Number.isFinite(count)) return 0;
  return Math.min(cells.length, Math.max(0, Math.floor(count)));
}

/** Grow geometrically so ordinary one-at-a-time stage admission does not
 * replace typed storage on every rebuild; steady-state rebuilds allocate
 * nothing. */
function ensureInt32Capacity(storage: Int32Array, needed: number): Int32Array {
  if (storage.length >= needed) return storage;
  let capacity = Math.max(16, storage.length);
  while (capacity < needed) capacity *= 2;
  return new Int32Array(capacity);
}

/**
 * Rebuild only when slot positions/membership move.  `cells` identity is not
 * part of the key: reducers may replace immutable payload objects in place
 * without moving their ids or `pos_seed`, and fieldVersion deliberately stays
 * still for that case.
 *
 * Two passes over typed memory: the first reads every drawn record once and
 * stores its bucket coordinates while measuring the field's bucket box; the
 * second links slots into the flat head grid (or the overflow chain when the
 * box cannot be dense). Only the drawn prefix belongs to this cache —
 * semantic ids and the single verified beyond-prefix route hop resolve
 * through CellGalaxy's existing stable-slot map at query time.
 */
export function ensureCellNucleusSpatialIndex(
  index: CellNucleusSpatialIndex,
  cells: readonly CellNucleusSpatialSource[],
  count: number,
  version: number,
  bucketSize: number,
): CellNucleusSpatialIndex {
  const safeCount = normalizedCount(cells, count);
  const safeBucketSize = Number.isFinite(bucketSize) && bucketSize > 0
    ? bucketSize
    : 1;
  if (
    index.version === version
    && index.count === safeCount
    && index.bucketSize === safeBucketSize
  ) {
    return index;
  }

  index.version = version;
  index.count = safeCount;
  index.bucketSize = safeBucketSize;
  index.generation += 1;
  index.overflowHead = -1;
  index.next = ensureInt32Capacity(index.next, safeCount);
  index.bucketCoords = ensureInt32Capacity(index.bucketCoords, safeCount * 3);
  const next = index.next;
  const coords = index.bucketCoords;

  let minBx = Number.POSITIVE_INFINITY;
  let minBy = Number.POSITIVE_INFINITY;
  let minBz = Number.POSITIVE_INFINITY;
  let maxBx = Number.NEGATIVE_INFINITY;
  let maxBy = Number.NEGATIVE_INFINITY;
  let maxBz = Number.NEGATIVE_INFINITY;
  let dense = true;
  let finiteSlots = 0;
  for (let slot = 0; slot < safeCount; slot += 1) {
    const position = cells[slot].pos_seed;
    const x = position[0];
    const y = position[1];
    const z = position[2];
    const offset = slot * 3;
    // A non-finite Cell could not pass the original detail threshold either:
    // its distance/detail become NaN.  Direct semantic ids still reach the
    // exact old calculation in CellNucleus, where they fail the same way.
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      next[slot] = -1;
      coords[offset] = NON_FINITE_BUCKET;
      continue;
    }
    finiteSlots += 1;
    const bx = Math.floor(x / safeBucketSize);
    const by = Math.floor(y / safeBucketSize);
    const bz = Math.floor(z / safeBucketSize);
    if (
      bx < -DENSE_BUCKET_COORD_LIMIT || bx > DENSE_BUCKET_COORD_LIMIT
      || by < -DENSE_BUCKET_COORD_LIMIT || by > DENSE_BUCKET_COORD_LIMIT
      || bz < -DENSE_BUCKET_COORD_LIMIT || bz > DENSE_BUCKET_COORD_LIMIT
    ) {
      // Extreme finite coordinates: the coordinate would not survive int32
      // storage, so the whole field takes the exact overflow chain instead.
      dense = false;
      coords[offset] = 0;
      coords[offset + 1] = 0;
      coords[offset + 2] = 0;
      continue;
    }
    coords[offset] = bx;
    coords[offset + 1] = by;
    coords[offset + 2] = bz;
    if (bx < minBx) minBx = bx;
    if (bx > maxBx) maxBx = bx;
    if (by < minBy) minBy = by;
    if (by > maxBy) maxBy = by;
    if (bz < minBz) minBz = bz;
    if (bz > maxBz) maxBz = bz;
  }

  let spanX = 0;
  let spanY = 0;
  let spanZ = 0;
  if (dense && finiteSlots > 0) {
    spanX = maxBx - minBx + 1;
    spanY = maxBy - minBy + 1;
    spanZ = maxBz - minBz + 1;
    dense = spanX <= CELL_NUCLEUS_MAX_DENSE_BUCKETS
      && spanY <= CELL_NUCLEUS_MAX_DENSE_BUCKETS
      && spanZ <= CELL_NUCLEUS_MAX_DENSE_BUCKETS
      && spanX * spanY * spanZ <= CELL_NUCLEUS_MAX_DENSE_BUCKETS;
  } else {
    dense = false;
  }
  index.dense = dense;

  if (dense) {
    const volume = spanX * spanY * spanZ;
    index.minBx = minBx;
    index.minBy = minBy;
    index.minBz = minBz;
    index.spanX = spanX;
    index.spanY = spanY;
    index.spanZ = spanZ;
    index.heads = ensureInt32Capacity(index.heads, volume);
    const heads = index.heads;
    heads.fill(-1, 0, volume);
    for (let slot = 0; slot < safeCount; slot += 1) {
      const offset = slot * 3;
      const bx = coords[offset];
      if (bx === NON_FINITE_BUCKET) continue;
      const bucket = (bx - minBx)
        + spanX * ((coords[offset + 1] - minBy)
          + spanY * (coords[offset + 2] - minBz));
      next[slot] = heads[bucket];
      heads[bucket] = slot;
    }
  } else {
    index.minBx = 0;
    index.minBy = 0;
    index.minBz = 0;
    index.spanX = 0;
    index.spanY = 0;
    index.spanZ = 0;
    for (let slot = 0; slot < safeCount; slot += 1) {
      if (coords[slot * 3] === NON_FINITE_BUCKET) continue;
      next[slot] = index.overflowHead;
      index.overflowHead = slot;
    }
  }
  return index;
}

function addCandidate(
  scratch: CellNucleusCandidateScratch,
  slot: number,
): void {
  if (scratch.seen.has(slot)) return;
  scratch.seen.add(slot);
  scratch.indices.push(slot);
}

function addChainCandidates(
  index: CellNucleusSpatialIndex,
  cells: readonly CellNucleusSpatialSource[],
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  radiusSq: number,
  head: number,
  scratch: CellNucleusCandidateScratch,
): void {
  let slot = head;
  while (slot >= 0) {
    const position = cells[slot].pos_seed;
    const dx = position[0] - cameraX;
    const dy = position[1] - cameraY;
    const dz = position[2] - cameraZ;
    if (dx * dx + dy * dy + dz * dz < radiusSq) {
      addCandidate(scratch, slot);
    }
    slot = index.next[slot];
  }
}

/** Explicit semantic ids at any distance, validated against the drawn
 * prefix: a missing or stale lookup hit must not admit the wrong occupant. */
function addDirectCandidates(
  cells: readonly CellNucleusSpatialSource[],
  count: number,
  slotByCellId: CellNucleusSlotLookup,
  directCellIds: Iterable<number>,
  scratch: CellNucleusCandidateScratch,
): void {
  for (const cellId of directCellIds) {
    const slot = slotByCellId.get(cellId);
    if (
      slot !== undefined
      && Number.isInteger(slot)
      && slot >= 0
      && slot < count
      && cells[slot]?.id === cellId
    ) {
      addCandidate(scratch, slot);
    }
  }
}

function resetScratch(scratch: CellNucleusCandidateScratch): void {
  scratch.indices.length = 0;
  scratch.seen.clear();
}

/**
 * Return every drawn slot strictly inside `radius`, plus explicit semantic
 * ids at any distance.  Results are slot-sorted so the stable final LOD sort
 * keeps the former full-prefix scan's exact tie order.
 *
 * With bucketSize=radius, a camera query addresses at most 3^3 buckets.  The
 * exact sphere test is retained here; CellNucleus repeats the small candidate
 * distance calculation because it also needs the square root for rendering.
 */
export function queryCellNucleusCandidateIndices(
  index: CellNucleusSpatialIndex,
  cells: readonly CellNucleusSpatialSource[],
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  radius: number,
  slotByCellId: CellNucleusSlotLookup,
  directCellIds: Iterable<number>,
  scratch: CellNucleusCandidateScratch,
): readonly number[] {
  resetScratch(scratch);

  if (
    Number.isFinite(cameraX)
    && Number.isFinite(cameraY)
    && Number.isFinite(cameraZ)
    && Number.isFinite(radius)
    && radius > 0
    && index.count > 0
  ) {
    const radiusSq = radius * radius;
    if (index.dense) {
      // Clamp the camera's bucket range to the dense box. Every loop bound is
      // then a safe integer inside the grid, so an extreme finite camera
      // simply misses instead of driving a non-advancing `for`.
      const size = index.bucketSize;
      const loX = Math.max(Math.floor((cameraX - radius) / size), index.minBx);
      const hiX = Math.min(
        Math.floor((cameraX + radius) / size),
        index.minBx + index.spanX - 1,
      );
      const loY = Math.max(Math.floor((cameraY - radius) / size), index.minBy);
      const hiY = Math.min(
        Math.floor((cameraY + radius) / size),
        index.minBy + index.spanY - 1,
      );
      const loZ = Math.max(Math.floor((cameraZ - radius) / size), index.minBz);
      const hiZ = Math.min(
        Math.floor((cameraZ + radius) / size),
        index.minBz + index.spanZ - 1,
      );
      if (loX <= hiX && loY <= hiY && loZ <= hiZ) {
        const heads = index.heads;
        const spanX = index.spanX;
        const spanXY = spanX * index.spanY;
        for (let bz = loZ; bz <= hiZ; bz += 1) {
          const zBase = (bz - index.minBz) * spanXY;
          for (let by = loY; by <= hiY; by += 1) {
            const rowBase = zBase + (by - index.minBy) * spanX;
            for (let bx = loX; bx <= hiX; bx += 1) {
              addChainCandidates(
                index,
                cells,
                cameraX,
                cameraY,
                cameraZ,
                radiusSq,
                heads[rowBase + (bx - index.minBx)],
                scratch,
              );
            }
          }
        }
      }
    }
    // Slots the dense grid could not hold are tested exactly, one by one.
    // Empty in production; the whole field when the box is not dense.
    addChainCandidates(
      index,
      cells,
      cameraX,
      cameraY,
      cameraZ,
      radiusSq,
      index.overflowHead,
      scratch,
    );
  }

  addDirectCandidates(cells, index.count, slotByCellId, directCellIds, scratch);
  scratch.indices.sort((left, right) => left - right);
  return scratch.indices;
}

/**
 * The production LOD tick: bounds gate first, index only when the camera is
 * inside the field's admission envelope, semantic ids always.
 *
 * When the gate proves every drawn slot is at least `radius` (+ slack) from
 * the camera, the spatial lane's answer is known to be empty, so the index is
 * neither built nor refreshed — a version change costs one O(count) bounds
 * rescan (only when a tick observes it) instead of a grid rebuild — and the
 * stale index waits for the first tick that gets inside. Focus, hover, recall
 * and route-hop ids are not a veto on the gate: they never depended on the
 * spatial lane, and the direct lane runs on every tick regardless.
 */
export function collectCellNucleusCandidateIndices(
  cache: CellNucleusLodCandidateCache,
  cells: readonly CellNucleusSpatialSource[],
  count: number,
  version: number,
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  radius: number,
  slotByCellId: CellNucleusSlotLookup,
  directCellIds: Iterable<number>,
): readonly number[] {
  const safeCount = normalizedCount(cells, count);
  const bounds = ensureCellFieldBounds(cache.bounds, cells, safeCount, version);
  if (
    cellNucleusFarFieldBeyond(
      cameraX,
      cameraY,
      cameraZ,
      bounds,
      radius + CELL_NUCLEUS_FAR_FIELD_GATE_SLACK,
    )
  ) {
    const scratch = cache.scratch;
    resetScratch(scratch);
    addDirectCandidates(cells, safeCount, slotByCellId, directCellIds, scratch);
    scratch.indices.sort((left, right) => left - right);
    return scratch.indices;
  }
  const index = ensureCellNucleusSpatialIndex(
    cache.index,
    cells,
    safeCount,
    version,
    radius,
  );
  return queryCellNucleusCandidateIndices(
    index,
    cells,
    cameraX,
    cameraY,
    cameraZ,
    radius,
    slotByCellId,
    directCellIds,
    cache.scratch,
  );
}
