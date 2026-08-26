// CellNucleus spatial candidates — a private position index over the exact
// drawn prefix. CellGalaxy already owns the id → stable-slot lookup, so this
// cache deliberately does not mirror it or retain anything from the resident
// tail. A field version is the caller's promise that positions at each drawn
// slot have not moved; payload-only Cell replacements therefore reuse it.

export interface CellNucleusSpatialSource {
  readonly id: number;
  readonly pos_seed: readonly [number, number, number];
}

type ZHeads = Map<number, number>;
type YRows = Map<number, ZHeads>;

export interface CellNucleusSpatialIndex {
  version: number;
  /** Drawn prefix indexed for camera-distance admission. */
  count: number;
  bucketSize: number;
  /** bx -> by -> bz -> newest slot in that bucket. */
  rows: Map<number, YRows>;
  /** Reusable intrusive bucket chains, indexed by drawn slot. */
  next: Int32Array;
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

export function makeCellNucleusSpatialIndex(): CellNucleusSpatialIndex {
  return {
    version: -1,
    count: -1,
    bucketSize: 1,
    rows: new Map(),
    next: new Int32Array(0),
    generation: 0,
  };
}

export function makeCellNucleusCandidateScratch(): CellNucleusCandidateScratch {
  return {
    indices: [],
    seen: new Set(),
  };
}

function normalizedCount(
  cells: readonly CellNucleusSpatialSource[],
  count: number,
): number {
  if (!Number.isFinite(count)) return 0;
  return Math.min(cells.length, Math.max(0, Math.floor(count)));
}

/**
 * Rebuild only when slot positions/membership move.  `cells` identity is not
 * part of the key: reducers may replace immutable payload objects in place
 * without moving their ids or `pos_seed`, and fieldVersion deliberately stays
 * still for that case.
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
  index.rows.clear();
  if (index.next.length < safeCount) {
    // Grow geometrically so ordinary one-at-a-time stage admission does not
    // replace this storage on every rebuild. The high-water allocation is one
    // packed int per drawn slot, never one boxed value per resident record.
    let capacity = Math.max(16, index.next.length);
    while (capacity < safeCount) capacity *= 2;
    index.next = new Int32Array(capacity);
  }

  // Only the drawn prefix belongs to this cache. Semantic ids and the single
  // verified beyond-prefix route hop resolve through CellGalaxy's existing
  // stable-slot map at query time.
  for (let slot = 0; slot < safeCount; slot += 1) {
    const position = cells[slot].pos_seed;
    const x = position[0];
    const y = position[1];
    const z = position[2];
    // A non-finite Cell could not pass the original detail threshold either:
    // its distance/detail become NaN.  Direct semantic ids still reach the
    // exact old calculation in CellNucleus, where they fail the same way.
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      index.next[slot] = -1;
      continue;
    }
    const bx = Math.floor(x / safeBucketSize);
    const by = Math.floor(y / safeBucketSize);
    const bz = Math.floor(z / safeBucketSize);
    let yRows = index.rows.get(bx);
    if (!yRows) {
      yRows = new Map();
      index.rows.set(bx, yRows);
    }
    let zHeads = yRows.get(by);
    if (!zHeads) {
      zHeads = new Map();
      yRows.set(by, zHeads);
    }
    index.next[slot] = zHeads.get(bz) ?? -1;
    zHeads.set(bz, slot);
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

function bucketRangeSupportsUnitWalk(min: number, max: number): boolean {
  if (
    !Number.isSafeInteger(min)
    || !Number.isSafeInteger(max)
    || min > max
  ) {
    return false;
  }
  // Explicitly retain the progress proof beside the loops. Safe integers
  // currently imply it, but this guard prevents a future bounds change from
  // turning an extreme finite camera into a non-advancing `for` loop.
  return min === max || (min + 1 > min && max - 1 < max);
}

function bucketWalkVolumeIsBounded(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
): boolean {
  const xCount = maxX - minX + 1;
  const yCount = maxY - minY + 1;
  const zCount = maxZ - minZ + 1;
  return Number.isSafeInteger(xCount)
    && Number.isSafeInteger(yCount)
    && Number.isSafeInteger(zCount)
    && xCount * yCount * zCount <= 4_096;
}

function addBucketChainCandidates(
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
  scratch.indices.length = 0;
  scratch.seen.clear();

  if (
    Number.isFinite(cameraX)
    && Number.isFinite(cameraY)
    && Number.isFinite(cameraZ)
    && Number.isFinite(radius)
    && radius > 0
    && index.count > 0
  ) {
    const radiusSq = radius * radius;
    const minBx = Math.floor((cameraX - radius) / index.bucketSize);
    const maxBx = Math.floor((cameraX + radius) / index.bucketSize);
    const minBy = Math.floor((cameraY - radius) / index.bucketSize);
    const maxBy = Math.floor((cameraY + radius) / index.bucketSize);
    const minBz = Math.floor((cameraZ - radius) / index.bucketSize);
    const maxBz = Math.floor((cameraZ + radius) / index.bucketSize);
    const safeUnitWalk = bucketRangeSupportsUnitWalk(minBx, maxBx)
      && bucketRangeSupportsUnitWalk(minBy, maxBy)
      && bucketRangeSupportsUnitWalk(minBz, maxBz)
      && bucketWalkVolumeIsBounded(
        minBx,
        maxBx,
        minBy,
        maxBy,
        minBz,
        maxBz,
      );
    if (safeUnitWalk) {
      // With the production bucketSize=radius these are at most 3³ lookups.
      for (let bx = minBx; bx <= maxBx; bx += 1) {
        const yRows = index.rows.get(bx);
        for (let by = minBy; by <= maxBy; by += 1) {
          const zHeads = yRows?.get(by);
          for (let bz = minBz; bz <= maxBz; bz += 1) {
            addBucketChainCandidates(
              index,
              cells,
              cameraX,
              cameraY,
              cameraZ,
              radiusSq,
              zHeads?.get(bz) ?? -1,
              scratch,
            );
          }
        }
      }
    } else {
      // Extreme finite coordinates can produce bucket numbers beyond the
      // safe-integer range, where `bucket += 1` may not advance. Walk only
      // occupied buckets instead, retain the same inclusive box gate, then
      // apply the exact sphere test in the shared chain helper.
      for (const [bx, yRows] of index.rows) {
        if (bx < minBx || bx > maxBx) continue;
        for (const [by, zHeads] of yRows) {
          if (by < minBy || by > maxBy) continue;
          for (const [bz, head] of zHeads) {
            if (bz < minBz || bz > maxBz) continue;
            addBucketChainCandidates(
              index,
              cells,
              cameraX,
              cameraY,
              cameraZ,
              radiusSq,
              head,
              scratch,
            );
          }
        }
      }
    }
  }

  for (const cellId of directCellIds) {
    const slot = slotByCellId.get(cellId);
    if (
      slot !== undefined
      && Number.isInteger(slot)
      && slot >= 0
      && slot < index.count
      && cells[slot]?.id === cellId
    ) {
      addCandidate(scratch, slot);
    }
  }
  scratch.indices.sort((left, right) => left - right);
  return scratch.indices;
}
