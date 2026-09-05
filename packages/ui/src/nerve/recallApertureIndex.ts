/**
 * Incremental XZ index for the passive fabric curves a recall aperture may
 * reach. The renderer owns stable numeric slots, so the slot is both the
 * lookup identity and the cheapest value for an animation frame to consume.
 *
 * Curves are inserted into every uniform-grid bucket their conservative
 * quadratic bounding box overlaps. Queries still test the stored box exactly:
 * bucket overlap admits false positives, but can never hide a curve that the
 * aperture's union bounds could reach.
 */

export const RECALL_APERTURE_INDEX_GRID_SIZE = 24;
/** One ordinary edge may register this many uniform-grid cells at most.
 * Larger hulls stay indexed once in the exact-overlap fallback instead of
 * allocating a grid-sized collection for one pathological record. */
export const RECALL_APERTURE_INDEX_MAX_BUCKETS_PER_ENTRY = 4_096;

export interface RecallApertureCurveXZ {
  fromX: number;
  fromZ: number;
  ctrlX: number;
  ctrlZ: number;
  toX: number;
  toZ: number;
}

export interface RecallApertureQueryBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RecallApertureIndexEntry {
  slot: number;
  key: string;
  bounds: RecallApertureQueryBounds;
}

interface IndexedRecallApertureEntry extends RecallApertureIndexEntry {
  bucketXs: number[];
  bucketZs: number[];
}

interface GridRange {
  min: number;
  max: number;
  span: number;
  /** Every integer in [min, max] is exactly representable and advancing by
   * one is guaranteed to make progress. */
  safeProgress: boolean;
}

function finiteBounds(bounds: RecallApertureQueryBounds): boolean {
  return Number.isFinite(bounds.minX)
    && Number.isFinite(bounds.maxX)
    && Number.isFinite(bounds.minZ)
    && Number.isFinite(bounds.maxZ)
    && bounds.minX <= bounds.maxX
    && bounds.minZ <= bounds.maxZ;
}

function overlaps(
  a: RecallApertureQueryBounds,
  b: RecallApertureQueryBounds,
): boolean {
  return a.maxX >= b.minX && a.minX <= b.maxX
    && a.maxZ >= b.minZ && a.minZ <= b.maxZ;
}

// Write the grid range into `out` with no allocation, so `upsert` (which needs
// an x and a z range every call) reuses two scratch objects instead of two
// fresh ones per edge. Kept identical to the allocating `gridRange`.
function gridRangeInto(
  minCoordinate: number,
  maxCoordinate: number,
  gridSize: number,
  out: GridRange,
): GridRange {
  const min = Math.floor(minCoordinate / gridSize);
  const max = Math.floor(maxCoordinate / gridSize);
  const span = max - min + 1;
  const safeProgress = Number.isSafeInteger(min)
    && Number.isSafeInteger(max)
    && Number.isSafeInteger(span)
    && span > 0
    && (span === 1 || min + 1 > min)
    && min + (span - 1) === max;
  out.min = min;
  out.max = max;
  out.span = span;
  out.safeProgress = safeProgress;
  return out;
}

function gridRange(
  minCoordinate: number,
  maxCoordinate: number,
  gridSize: number,
): GridRange {
  return gridRangeInto(minCoordinate, maxCoordinate, gridSize, {
    min: 0,
    max: 0,
    span: 0,
    safeProgress: false,
  });
}

function entryBucketCountIsBounded(x: GridRange, z: GridRange): boolean {
  if (!x.safeProgress || !z.safeProgress) return false;
  if (x.span > RECALL_APERTURE_INDEX_MAX_BUCKETS_PER_ENTRY) return false;
  return z.span <= Math.floor(
    RECALL_APERTURE_INDEX_MAX_BUCKETS_PER_ENTRY / x.span,
  );
}

/**
 * A quadratic Bezier is a convex combination of its endpoints and control
 * point for every t in [0, 1]. Their XZ hull is therefore a conservative box:
 * it may be wider than the exact extrema, but the curve can never leave it.
 */
export function quadraticCurveXZBounds(
  curve: RecallApertureCurveXZ,
): RecallApertureQueryBounds | null {
  const bounds: RecallApertureQueryBounds = {
    minX: Math.min(curve.fromX, curve.ctrlX, curve.toX),
    maxX: Math.max(curve.fromX, curve.ctrlX, curve.toX),
    minZ: Math.min(curve.fromZ, curve.ctrlZ, curve.toZ),
    maxZ: Math.max(curve.fromZ, curve.ctrlZ, curve.toZ),
  };
  return finiteBounds(bounds) ? bounds : null;
}

/**
 * Rebuildable uniform grid over persistent passive-fabric slots.
 *
 * - admit/reap/recycle: proportional to the curve box's covered buckets;
 * - aperture query: covered buckets plus their candidate entries;
 * - no animation-frame walk over the complete edge population.
 */
export class RecallApertureIndex {
  private readonly buckets = new Map<number, Map<number, Set<number>>>();
  /** Pathological but finite hulls live once here. The set is bounded by the
   * index's edge population, rather than by coordinate span. */
  private readonly unbucketedSlots = new Set<number>();
  private readonly entriesBySlot = new Map<number, IndexedRecallApertureEntry>();
  private readonly slotByKey = new Map<string, number>();
  private readonly seenEpochBySlot = new Map<number, number>();
  private queryEpoch = 0;
  // Two scratch ranges reused by `upsert` (never nested), so a per-edge insert
  // allocates no GridRange objects. `query` keeps the allocating `gridRange`.
  private readonly upsertXRange: GridRange =
    { min: 0, max: 0, span: 0, safeProgress: false };
  private readonly upsertZRange: GridRange =
    { min: 0, max: 0, span: 0, safeProgress: false };

  constructor(readonly gridSize = RECALL_APERTURE_INDEX_GRID_SIZE) {
    if (!Number.isFinite(gridSize) || gridSize <= 0) {
      throw new Error('RecallApertureIndex gridSize must be finite and positive');
    }
  }

  get size(): number {
    return this.entriesBySlot.size;
  }

  get(slot: number): RecallApertureIndexEntry | undefined {
    return this.entriesBySlot.get(slot);
  }

  clear(): void {
    this.buckets.clear();
    this.unbucketedSlots.clear();
    this.entriesBySlot.clear();
    this.slotByKey.clear();
    this.seenEpochBySlot.clear();
    this.queryEpoch = 0;
  }

  upsert(slot: number, key: string, curve: RecallApertureCurveXZ): boolean {
    if (!Number.isInteger(slot) || slot < 0) return false;
    this.remove(slot);
    const previousSlot = this.slotByKey.get(key);
    if (previousSlot !== undefined) this.remove(previousSlot);
    const bounds = quadraticCurveXZBounds(curve);
    if (!bounds) return false;

    const xRange = gridRangeInto(
      bounds.minX, bounds.maxX, this.gridSize, this.upsertXRange,
    );
    const zRange = gridRangeInto(
      bounds.minZ, bounds.maxZ, this.gridSize, this.upsertZRange,
    );
    const entry: IndexedRecallApertureEntry = {
      slot,
      key,
      bounds,
      bucketXs: [],
      bucketZs: [],
    };

    if (!entryBucketCountIsBounded(xRange, zRange)) {
      this.unbucketedSlots.add(slot);
      this.entriesBySlot.set(slot, entry);
      this.slotByKey.set(key, slot);
      return true;
    }

    // Pre-size the two bucket lanes to the exact covered-bucket count (bounded
    // above by `entryBucketCountIsBounded`), so the fill below is index writes
    // rather than a growing push.
    const bucketCount = xRange.span * zRange.span;
    const bucketXs = new Array<number>(bucketCount);
    const bucketZs = new Array<number>(bucketCount);
    let bucket = 0;
    // Offset iteration is bounded above and never relies on a large bucket
    // coordinate accepting `++`. `gridRange` proved every sum exact first.
    for (let xOffset = 0; xOffset < xRange.span; xOffset += 1) {
      const gridX = xRange.min + xOffset;
      let zBuckets = this.buckets.get(gridX);
      if (!zBuckets) {
        zBuckets = new Map<number, Set<number>>();
        this.buckets.set(gridX, zBuckets);
      }
      for (let zOffset = 0; zOffset < zRange.span; zOffset += 1) {
        const gridZ = zRange.min + zOffset;
        let slots = zBuckets.get(gridZ);
        if (!slots) {
          slots = new Set<number>();
          zBuckets.set(gridZ, slots);
        }
        slots.add(slot);
        bucketXs[bucket] = gridX;
        bucketZs[bucket] = gridZ;
        bucket += 1;
      }
    }
    entry.bucketXs = bucketXs;
    entry.bucketZs = bucketZs;

    this.entriesBySlot.set(slot, entry);
    this.slotByKey.set(key, slot);
    return true;
  }

  remove(slot: number): RecallApertureIndexEntry | undefined {
    const entry = this.entriesBySlot.get(slot);
    if (!entry) return undefined;
    for (let index = 0; index < entry.bucketXs.length; index += 1) {
      const gridX = entry.bucketXs[index];
      const gridZ = entry.bucketZs[index];
      const zBuckets = this.buckets.get(gridX);
      const slots = zBuckets?.get(gridZ);
      if (!zBuckets || !slots) continue;
      slots.delete(slot);
      if (slots.size === 0) zBuckets.delete(gridZ);
      if (zBuckets.size === 0) this.buckets.delete(gridX);
    }
    this.unbucketedSlots.delete(slot);
    this.entriesBySlot.delete(slot);
    if (this.slotByKey.get(entry.key) === slot) this.slotByKey.delete(entry.key);
    this.seenEpochBySlot.delete(slot);
    return entry;
  }

  removeKey(key: string): RecallApertureIndexEntry | undefined {
    const slot = this.slotByKey.get(key);
    return slot === undefined ? undefined : this.remove(slot);
  }

  /**
   * Append every box-overlapping entry exactly once. `out` is cleared first so
   * the renderer can reuse one array for the whole animation lifetime.
   */
  query(
    bounds: RecallApertureQueryBounds | null | undefined,
    out: RecallApertureIndexEntry[] = [],
  ): RecallApertureIndexEntry[] {
    out.length = 0;
    if (!bounds || !finiteBounds(bounds) || this.entriesBySlot.size === 0) {
      return out;
    }

    this.queryEpoch += 1;
    if (this.queryEpoch >= Number.MAX_SAFE_INTEGER) {
      this.seenEpochBySlot.clear();
      this.queryEpoch = 1;
    }
    const epoch = this.queryEpoch;
    const xRange = gridRange(bounds.minX, bounds.maxX, this.gridSize);
    const zRange = gridRange(bounds.minZ, bounds.maxZ, this.gridSize);

    if (xRange.safeProgress && xRange.span <= this.buckets.size) {
      for (let offset = 0; offset < xRange.span; offset += 1) {
        const gridX = xRange.min + offset;
        const zBuckets = this.buckets.get(gridX);
        if (zBuckets) {
          this.visitZBuckets(zBuckets, zRange, bounds, epoch, out);
        }
      }
    } else {
      for (const [gridX, zBuckets] of this.buckets) {
        // Unsafe query bucket coordinates cannot drive or safely narrow an
        // integer loop. Visit the finite map instead; exact bbox overlap below
        // removes false positives without risking a missed edge.
        if (
          xRange.safeProgress
          && (gridX < xRange.min || gridX > xRange.max)
        ) continue;
        this.visitZBuckets(zBuckets, zRange, bounds, epoch, out);
      }
    }
    this.visitBucket(this.unbucketedSlots, bounds, epoch, out);
    return out;
  }

  private visitZBuckets(
    zBuckets: Map<number, Set<number>>,
    range: GridRange,
    bounds: RecallApertureQueryBounds,
    epoch: number,
    out: RecallApertureIndexEntry[],
  ): void {
    if (range.safeProgress && range.span <= zBuckets.size) {
      for (let offset = 0; offset < range.span; offset += 1) {
        const gridZ = range.min + offset;
        this.visitBucket(zBuckets.get(gridZ), bounds, epoch, out);
      }
      return;
    }
    for (const [gridZ, slots] of zBuckets) {
      if (
        range.safeProgress
        && (gridZ < range.min || gridZ > range.max)
      ) continue;
      this.visitBucket(slots, bounds, epoch, out);
    }
  }

  private visitBucket(
    slots: Set<number> | undefined,
    bounds: RecallApertureQueryBounds,
    epoch: number,
    out: RecallApertureIndexEntry[],
  ): void {
    if (!slots) return;
    for (const slot of slots) {
      if (this.seenEpochBySlot.get(slot) === epoch) continue;
      this.seenEpochBySlot.set(slot, epoch);
      const entry = this.entriesBySlot.get(slot);
      if (entry && overlaps(entry.bounds, bounds)) out.push(entry);
    }
  }
}
