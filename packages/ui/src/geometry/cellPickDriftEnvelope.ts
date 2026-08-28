import type * as THREE from 'three';

/**
 * How far the screen-space hit index can be trusted after the camera moved —
 * measured from the index's own contents rather than from the viewport's
 * worst corner and a worst-case nearest cell.
 *
 * Every admitted entry is recorded in the index's view space as image-plane
 * coordinates and inverse depth, `u = x/viewZ`, `v = y/viewZ`, `w = 1/viewZ`,
 * and only the extremes of those three are kept: six numbers. When the live
 * camera differs from the indexed one by the rigid transform `T` (indexed view
 * → live view, i.e. `liveView⁻¹ · indexedView`), a point's new image-plane
 * position is a rational function of `(u, v, w)` whose numerator is quadratic
 * in one coordinate and affine in the other two, and whose denominator — the
 * depth ratio — is affine. Over the box those extremes span, the numerator's
 * maximum is attained at a corner of the affine pair and at an endpoint or
 * the vertex of the remaining parabola, so the exact maximum over the WHOLE
 * box costs a dozen evaluations. Divided by the box's minimum depth ratio
 * that is a sound upper bound on the screen drift of every indexed centre, and
 * the same depth ratio bounds how much every disc radius (∝ 1/viewZ) can have
 * changed.
 *
 * The box is a superset of the entries, so the bound is never below the true
 * maximum; it is loose only by however far the box's corners sit from real
 * cells. A handful of re-projected sentinel cells could not give that
 * guarantee: for an orbit the drift field peaks where large image-plane
 * offset and large depth COMBINE, and the cell with the largest offset and
 * the cell with the largest depth are generally not that cell.
 */
export class CellPickDriftEnvelope {
  minU = Infinity;
  maxU = -Infinity;
  minV = Infinity;
  maxV = -Infinity;
  minW = Infinity;
  maxW = -Infinity;

  reset(): void {
    this.minU = Infinity;
    this.maxU = -Infinity;
    this.minV = Infinity;
    this.maxV = -Infinity;
    this.minW = Infinity;
    this.maxW = -Infinity;
  }

  /** True until an entry has been included. */
  get empty(): boolean {
    return !(this.minU <= this.maxU);
  }

  /** Adopt extremes tracked elsewhere — a rebuild loop keeps them in locals
   *  so it passes no double through a call per entry — as `include` would
   *  have accumulated them. An inverted range (nothing tracked) leaves the
   *  envelope empty. */
  set(
    minU: number,
    maxU: number,
    minV: number,
    maxV: number,
    minW: number,
    maxW: number,
  ): void {
    this.minU = minU;
    this.maxU = maxU;
    this.minV = minV;
    this.maxV = maxV;
    this.minW = minW;
    this.maxW = maxW;
  }

  /** Record one admitted entry by its view-space position; `viewZ` is the
   *  positive distance in front of the camera. */
  include(viewX: number, viewY: number, viewZ: number): void {
    if (!(viewZ > 0)) return;
    const w = 1 / viewZ;
    const u = viewX * w;
    const v = viewY * w;
    if (u < this.minU) this.minU = u;
    if (u > this.maxU) this.maxU = u;
    if (v < this.minV) this.minV = v;
    if (v > this.maxV) this.maxV = v;
    if (w < this.minW) this.minW = w;
    if (w > this.maxW) this.maxW = w;
  }

  /**
   * Upper bound, in screen px, on how far any indexed disc centre has moved
   * PLUS how much any disc radius has changed, once the indexed view is
   * replaced by `viewDelta · indexedView`. `focalX`/`focalY` are the
   * projection's px-per-image-plane-unit (`halfW · P[0][0]`, `halfH · P[1][1]`)
   * and `maxRadiusPx` the largest radius any query may see. Infinity when the
   * envelope is empty or the box reaches the camera plane — the honest answer
   * either way, and one the caller treats as "rebuild".
   */
  driftPx(
    viewDelta: THREE.Matrix4,
    focalX: number,
    focalY: number,
    maxRadiusPx: number,
  ): number {
    if (this.empty) return Infinity;
    const e = viewDelta.elements;
    // Column-major: e[column * 4 + row].
    const r00 = e[0];
    const r10 = e[1];
    const r20 = e[2];
    const r01 = e[4];
    const r11 = e[5];
    const r21 = e[6];
    const r02 = e[8];
    const r12 = e[9];
    const r22 = e[10];
    const tx = e[12];
    const ty = e[13];
    const tz = e[14];
    const u0 = this.minU;
    const u1 = this.maxU;
    const v0 = this.minV;
    const v1 = this.maxV;
    const w0 = this.minW;
    const w1 = this.maxW;

    // Depth ratio liveViewZ / indexedViewZ = r22 − r20·u − r21·v − tz·w,
    // affine, so its extremes over the box are sums of per-axis extremes.
    const depthMin = r22
      - Math.max(r20 * u0, r20 * u1)
      - Math.max(r21 * v0, r21 * v1)
      - Math.max(tz * w0, tz * w1);
    if (!(depthMin > 0)) return Infinity;
    const depthMax = r22
      - Math.min(r20 * u0, r20 * u1)
      - Math.min(r21 * v0, r21 * v1)
      - Math.min(tz * w0, tz * w1);

    // Image-plane x drift numerator, quadratic in u, affine in (v, w):
    //   r20·u² + (r21·v + tz·w + r00 − r22)·u + (r01·v + tx·w − r02)
    let numeratorX = 0;
    for (let corner = 0; corner < 4; corner += 1) {
      const v = (corner & 1) === 0 ? v0 : v1;
      const w = (corner & 2) === 0 ? w0 : w1;
      const peak = quadraticAbsMax(
        r20,
        r21 * v + tz * w + (r00 - r22),
        r01 * v + tx * w - r02,
        u0,
        u1,
      );
      if (peak > numeratorX) numeratorX = peak;
    }
    // Image-plane y drift numerator, quadratic in v, affine in (u, w):
    //   r21·v² + (r20·u + tz·w + r11 − r22)·v + (r10·u + ty·w − r12)
    let numeratorY = 0;
    for (let corner = 0; corner < 4; corner += 1) {
      const u = (corner & 1) === 0 ? u0 : u1;
      const w = (corner & 2) === 0 ? w0 : w1;
      const peak = quadraticAbsMax(
        r21,
        r20 * u + tz * w + (r11 - r22),
        r10 * u + ty * w - r12,
        v0,
        v1,
      );
      if (peak > numeratorY) numeratorY = peak;
    }
    const driftX = (focalX * numeratorX) / depthMin;
    const driftY = (focalY * numeratorY) / depthMin;
    // A radius scales by the inverse depth ratio: |r/D − r| ≤ r·|1 − D|/Dmin.
    const radiusDrift = (
      maxRadiusPx * Math.max(Math.abs(1 - depthMin), Math.abs(1 - depthMax))
    ) / depthMin;
    return Math.sqrt(driftX * driftX + driftY * driftY) + radiusDrift;
  }
}

/** max |a·x² + b·x + c| over [x0, x1]: the endpoints, and the vertex when it
 *  lies inside. */
function quadraticAbsMax(
  a: number,
  b: number,
  c: number,
  x0: number,
  x1: number,
): number {
  let peak = Math.max(
    Math.abs((a * x0 + b) * x0 + c),
    Math.abs((a * x1 + b) * x1 + c),
  );
  if (a !== 0) {
    const vertex = -b / (2 * a);
    if (vertex > x0 && vertex < x1) {
      peak = Math.max(peak, Math.abs((a * vertex + b) * vertex + c));
    }
  }
  return peak;
}
