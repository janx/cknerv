export interface ScreenSpaceHit {
  index: number;
  centerX: number;
  centerY: number;
  radiusSq: number;
  depth: number;
}

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

  begin(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
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
      || centerX + radius < 0
      || centerX - radius > this.width
      || centerY + radius < 0
      || centerY - radius > this.height
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

  find(x: number, y: number): ScreenSpaceHit | null {
    if (this.maxRadius <= 0) return null;
    const originBx = Math.max(
      0,
      Math.min(this.columns - 1, Math.floor(x / this.bucketSize)),
    );
    const originBy = Math.max(
      0,
      Math.min(this.rows - 1, Math.floor(y / this.bucketSize)),
    );
    const bucketRadius = Math.ceil(this.maxRadius / this.bucketSize);
    const minBx = Math.max(0, originBx - bucketRadius);
    const maxBx = Math.min(this.columns - 1, originBx + bucketRadius);
    const minBy = Math.max(0, originBy - bucketRadius);
    const maxBy = Math.min(this.rows - 1, originBy + bucketRadius);
    let bestIndex = -1;
    let bestDistanceSq = Infinity;
    let bestDepth = Infinity;

    for (let by = minBy; by <= maxBy; by += 1) {
      for (let bx = minBx; bx <= maxBx; bx += 1) {
        let index = this.heads[by * this.columns + bx];
        while (index >= 0) {
          const dx = this.centersX[index] - x;
          const dy = this.centersY[index] - y;
          const distanceSq = dx * dx + dy * dy;
          if (
            distanceSq <= this.radiiSq[index]
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
      radiusSq: this.radiiSq[bestIndex],
      depth: this.depths[bestIndex],
    };
  }
}
