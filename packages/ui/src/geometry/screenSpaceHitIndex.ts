export interface ScreenSpaceHit {
  index: number;
  centerX: number;
  centerY: number;
  radiusSq: number;
  depth: number;
}

/** A query-time radius override for one already-indexed entry, so a handful
 * of discs can change size without re-projecting the field that surrounds
 * them. The pad radius must be at least the entry's indexed radius: the probe
 * window widens by it and the entry keeps the bucket its centre put it in, so
 * a pad can only grow a disc the index already holds — it can never shrink
 * one, and it can never admit one the insert rejected. */
export interface ScreenSpaceRadiusPad {
  /** Entry index the pad applies to; -1 leaves the slot unused. */
  index: number;
  radius: number;
}

const NO_RADIUS_PADS: readonly ScreenSpaceRadiusPad[] = [];

/** Allocation-stable CSS-pixel grid for point/sprite hit testing. Each item is
 * stored in its centre bucket; queries widen by the largest admitted radius,
 * so large sprites remain exact without duplicating entries across buckets.
 *
 * Three ways in, in ascending cost: a query-time {@link ScreenSpaceRadiusPad}
 * changes a disc for one `find` and stores nothing; {@link patchEntry} writes
 * a new radius into an entry whose centre has not moved, keeping its bucket
 * and its chain; a `begin` + `insert` pass re-projects the field. */
export class ScreenSpaceHitIndex {
  private readonly centersX: Float32Array;
  private readonly centersY: Float32Array;
  private readonly radiiSq: Float32Array;
  private readonly depths: Float32Array;
  private readonly next: Int32Array;
  /** The build each slot was last admitted in, compared against `generation`.
   *  A membership record that costs one store on admission and no clearing at
   *  all, so `begin` stays one fill however large the capacity is. */
  private readonly admittedAt: Int32Array;
  private heads = new Int32Array(0);
  /** Bumped by `begin`; starts at 1 so a never-admitted slot's 0 reads false. */
  private generation = 0;
  private columns = 0;
  private rows = 0;
  private width = 0;
  private height = 0;
  private maxRadius = 0;
  private admitPad = 0;

  constructor(
    readonly capacity: number,
    readonly bucketSize = 32,
  ) {
    this.centersX = new Float32Array(capacity);
    this.centersY = new Float32Array(capacity);
    this.radiiSq = new Float32Array(capacity);
    this.depths = new Float32Array(capacity);
    this.next = new Int32Array(capacity);
    this.admittedAt = new Int32Array(capacity);
  }

  /** `admitPadPx` widens ONLY the off-screen rejection in `insert`, by the
   * most any later radius pad can add. Stored radii are untouched, so an
   * unpadded query still cannot see the entries it keeps — but a padded one
   * can, which is what makes the pad answer exactly as a re-insert would. */
  begin(width: number, height: number, admitPadPx = 0): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.admitPad = Number.isFinite(admitPadPx) ? Math.max(0, admitPadPx) : 0;
    this.columns = Math.max(1, Math.ceil(this.width / this.bucketSize));
    this.rows = Math.max(1, Math.ceil(this.height / this.bucketSize));
    const bucketCount = this.columns * this.rows;
    if (this.heads.length !== bucketCount) {
      this.heads = new Int32Array(bucketCount);
    }
    this.heads.fill(-1);
    this.maxRadius = 0;
    this.generation += 1;
  }

  /** Whether this build admitted the slot — the record a patch has to consult
   *  before it writes, since a rejected slot's stored centre belongs to some
   *  earlier build. */
  admitted(index: number): boolean {
    return index >= 0
      && index < this.capacity
      && this.admittedAt[index] === this.generation;
  }

  /** `insert`'s rejection, asked as a question so a patch can find out whether
   *  the values it is about to write would change an entry's membership
   *  BEFORE it writes them. */
  private admits(centerX: number, centerY: number, radius: number): boolean {
    return Number.isFinite(centerX)
      && Number.isFinite(centerY)
      && Number.isFinite(radius)
      && radius > 0
      && centerX + radius + this.admitPad >= 0
      && centerX - radius - this.admitPad <= this.width
      && centerY + radius + this.admitPad >= 0
      && centerY - radius - this.admitPad <= this.height;
  }

  /** The largest radius admitted since `begin`; zero for an empty index. */
  get maxRadiusPx(): number {
    return this.maxRadius;
  }

  /** Staging for `insertEntry`: centre x, centre y, radius, depth. A hot
   *  rebuild loop writes these four lanes and passes only the index, so no
   *  double crosses a call boundary the engine might not inline — a boxed
   *  argument per entry is the difference between a rebuild that allocates
   *  nothing and one that leaves a megabyte behind. */
  readonly entry = new Float64Array(4);

  /** Returns whether the entry was admitted, so a caller can keep its own
   *  record of exactly the entries the index holds. */
  insert(
    index: number,
    centerX: number,
    centerY: number,
    radius: number,
    depth: number,
  ): boolean {
    const entry = this.entry;
    entry[0] = centerX;
    entry[1] = centerY;
    entry[2] = radius;
    entry[3] = depth;
    return this.insertEntry(index);
  }

  /** `insert` for the values staged in `entry`. */
  insertEntry(index: number): boolean {
    const entry = this.entry;
    const centerX = entry[0];
    const centerY = entry[1];
    const radius = entry[2];
    const depth = entry[3];
    if (
      index < 0
      || index >= this.capacity
      || !this.admits(centerX, centerY, radius)
    ) return false;

    const bx = Math.max(
      0,
      Math.min(this.columns - 1, Math.floor(centerX / this.bucketSize)),
    );
    const by = Math.max(
      0,
      Math.min(this.rows - 1, Math.floor(centerY / this.bucketSize)),
    );
    const bucket = by * this.columns + bx;
    this.centersX[index] = centerX;
    this.centersY[index] = centerY;
    this.radiiSq[index] = radius * radius;
    this.depths[index] = depth;
    this.next[index] = this.heads[bucket];
    this.heads[bucket] = index;
    this.admittedAt[index] = this.generation;
    this.maxRadius = Math.max(this.maxRadius, radius);
    return true;
  }

  /** `patchEntry` for the values passed in. */
  patch(
    index: number,
    centerX: number,
    centerY: number,
    radius: number,
    depth: number,
  ): boolean {
    const entry = this.entry;
    entry[0] = centerX;
    entry[1] = centerY;
    entry[2] = radius;
    entry[3] = depth;
    return this.patchEntry(index);
  }

  /** Re-state ONE entry the caller has re-projected through this index's own
   *  snapshot — its matrices, its viewport — because the entry's RADIUS moved
   *  and nothing else did. The entry keeps the bucket its centre put it in and
   *  its place in that bucket's chain, so a patch is three stores and no walk,
   *  and the field around it is never re-projected.
   *
   *  Returns false having written nothing when the values would MOVE the
   *  entry: a centre that is not the one indexed, or a radius that flips the
   *  admit verdict. Either is chain surgery, and either leaves the caller's
   *  drift envelope describing a membership the index no longer has — so the
   *  answer to both is a rebuild, which is the caller's to run.
   *
   *  `maxRadiusPx` only ever GROWS here: the largest admitted radius cannot be
   *  recovered when the entry that held it shrinks, short of walking the field.
   *  A too-large one is conservative in both places it is read — `find` scans
   *  strictly more buckets and still tests every candidate against its own
   *  exact radius, and a drift bound widened by it can only rebuild sooner. */
  patchEntry(index: number): boolean {
    if (index < 0 || index >= this.capacity) return false;
    const entry = this.entry;
    const centerX = entry[0];
    const centerY = entry[1];
    const radius = entry[2];
    const admits = this.admits(centerX, centerY, radius);
    if (admits !== (this.admittedAt[index] === this.generation)) return false;
    // Rejected before and rejected after: the index does not hold this slot,
    // there is nothing in it to repair, and its stored centre is not this
    // build's to compare against.
    if (!admits) return true;
    // Compare what the index STORED, not what the caller computed: the centre
    // lanes are Float32Array, so a re-projection that reproduces the double
    // exactly still has to be rounded before it can equal the entry.
    if (
      Math.fround(centerX) !== this.centersX[index]
      || Math.fround(centerY) !== this.centersY[index]
    ) return false;
    this.radiiSq[index] = radius * radius;
    this.depths[index] = entry[3];
    if (radius > this.maxRadius) this.maxRadius = radius;
    return true;
  }

  /**
   * The nearest entry whose disc covers the point, tie-broken by depth.
   *
   * `minRadiusPx` is a FLOOR every entry is measured against for this one
   * query, and it is how one index answers two instruments. A mouse asks for
   * the pixel it is on and gets the disc the geometry actually draws; a
   * finger asks with a floor and gets the nearest entry within it, which is
   * the only honest answer available when the contact patch is wider than
   * the things under it. Nothing is stored, nothing is re-projected, and the
   * two answers can differ from one event to the next off the same build —
   * which they must, because the reader may be holding a stylus in one hand
   * and pressing with the other.
   */
  find(
    x: number,
    y: number,
    pads: readonly ScreenSpaceRadiusPad[] = NO_RADIUS_PADS,
    minRadiusPx = 0,
  ): ScreenSpaceHit | null {
    const minRadius = Number.isFinite(minRadiusPx) ? Math.max(0, minRadiusPx) : 0;
    const minRadiusSq = minRadius * minRadius;
    // A floor can make a field hittable that no drawn radius would: an entry
    // is only worth finding at all if SOMETHING gives it area.
    if (this.maxRadius <= 0 && minRadius <= 0) return null;
    // The probe window is derived from the largest radius the scan may use,
    // so a pad — or the floor — has to widen it or its own entry falls
    // outside the buckets walked below.
    let probeRadius = Math.max(this.maxRadius, minRadius);
    for (let p = 0; p < pads.length; p += 1) {
      const pad = pads[p];
      if (pad.index >= 0 && pad.radius > probeRadius) probeRadius = pad.radius;
    }
    const originBx = Math.max(
      0,
      Math.min(this.columns - 1, Math.floor(x / this.bucketSize)),
    );
    const originBy = Math.max(
      0,
      Math.min(this.rows - 1, Math.floor(y / this.bucketSize)),
    );
    const bucketRadius = Math.ceil(probeRadius / this.bucketSize);
    const minBx = Math.max(0, originBx - bucketRadius);
    const maxBx = Math.min(this.columns - 1, originBx + bucketRadius);
    const minBy = Math.max(0, originBy - bucketRadius);
    const maxBy = Math.min(this.rows - 1, originBy + bucketRadius);
    let bestIndex = -1;
    let bestDistanceSq = Infinity;
    let bestDepth = Infinity;
    let bestRadiusSq = 0;

    for (let by = minBy; by <= maxBy; by += 1) {
      for (let bx = minBx; bx <= maxBx; bx += 1) {
        let index = this.heads[by * this.columns + bx];
        while (index >= 0) {
          const dx = this.centersX[index] - x;
          const dy = this.centersY[index] - y;
          const distanceSq = dx * dx + dy * dy;
          // Pads are consulted in the SAME bucket walk the indexed radii are,
          // so a padded entry keeps the scan position that decides ties.
          let radiusSq = this.radiiSq[index];
          for (let p = 0; p < pads.length; p += 1) {
            const pad = pads[p];
            if (pad.index === index) {
              radiusSq = pad.radius * pad.radius;
              break;
            }
          }
          // The floor is the last word, over the stored radius and over a
          // pad: a pad only ever grows a disc, so raising an already-padded
          // one to the floor cannot shrink anything.
          if (radiusSq < minRadiusSq) radiusSq = minRadiusSq;
          if (
            distanceSq <= radiusSq
            && (
              distanceSq < bestDistanceSq - 0.5
              || (
                Math.abs(distanceSq - bestDistanceSq) <= 0.5
                && this.depths[index] < bestDepth
              )
            )
          ) {
            bestIndex = index;
            bestDistanceSq = distanceSq;
            bestDepth = this.depths[index];
            bestRadiusSq = radiusSq;
          }
          index = this.next[index];
        }
      }
    }

    if (bestIndex < 0) return null;
    return {
      index: bestIndex,
      centerX: this.centersX[bestIndex],
      centerY: this.centersY[bestIndex],
      radiusSq: bestRadiusSq,
      depth: this.depths[bestIndex],
    };
  }
}
