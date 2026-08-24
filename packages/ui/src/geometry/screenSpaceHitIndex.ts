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
 * so large sprites remain exact without duplicating entries across buckets. */
export class ScreenSpaceHitIndex {
  private readonly centersX: Float32Array;
  private readonly centersY: Float32Array;
  private readonly radiiSq: Float32Array;
  private readonly depths: Float32Array;
  private readonly next: Int32Array;
  private heads = new Int32Array(0);
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
  }

  insert(
    index: number,
    centerX: number,
    centerY: number,
    radius: number,
    depth: number,
  ): void {
    if (
      index < 0
      || index >= this.capacity
      || !Number.isFinite(centerX)
      || !Number.isFinite(centerY)
      || !Number.isFinite(radius)
      || radius <= 0
      || centerX + radius + this.admitPad < 0
      || centerX - radius - this.admitPad > this.width
      || centerY + radius + this.admitPad < 0
      || centerY - radius - this.admitPad > this.height
    ) return;

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
    this.maxRadius = Math.max(this.maxRadius, radius);
  }

  find(
    x: number,
    y: number,
    pads: readonly ScreenSpaceRadiusPad[] = NO_RADIUS_PADS,
  ): ScreenSpaceHit | null {
    if (this.maxRadius <= 0) return null;
    // The probe window is derived from the largest radius the scan may use,
    // so a pad has to widen it or its own entry falls outside the buckets
    // walked below.
    let probeRadius = this.maxRadius;
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
