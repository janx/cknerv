// Curve geometry shared between the persistent fabric mesh and the
// per-frame active-pulse drawing. Each fabric edge is a quadratic
// Bezier between the two cells with a perpendicular control-point
// offset; same edge → same control point every frame, so the active
// pulse rendered along the same Bezier sits exactly on the visible
// fibre.

/** FNV-1a string → uint32 hash. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Mix two uint32 hashes (xorshift-multiply finalise). */
function mixHash(a: number, b: number): number {
  let h = (a ^ b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hash for a fabric edge between two cell ids. Canonical (a < b). */
export function fabricEdgeSeed(a: number, b: number): number {
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  return mixHash(lo >>> 0, hi >>> 0);
}

/** Quadratic Bezier control point: midpoint plus a perpendicular
 *  offset in the xz plane. Magnitude scales with chord length so
 *  short and long fibres bend by similar visual proportions; sign
 *  comes from the hash so each edge curves the same way every frame.
 *
 *  Returns a fresh tuple each call. Callers in hot loops should use
 *  the `bezierControlInto` form below to avoid the per-edge tuple
 *  allocation. The math is duplicated rather than delegated so each
 *  function stays monomorphic in its `out` shape — SpiderMonkey IC
 *  caches deopt when the same hot inner function sees both
 *  `Array<number>` and `Float32Array` writes.
 */
export function bezierControl(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  hashSeed: number,
): [number, number, number] {
  const dx = bx - ax;
  const dz = bz - az;
  const planar = Math.sqrt(dx * dx + dz * dz);
  if (planar < 1e-6) {
    return [(ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5];
  }
  const ipx = -dz / planar;
  const ipz = dx / planar;
  const sign = (hashSeed & 1) === 0 ? 1 : -1;
  const magFrac = 0.10 + 0.10 * (((hashSeed >>> 8) & 0xff) / 0xff);
  const chord = Math.sqrt(planar * planar + (by - ay) * (by - ay));
  const off = chord * magFrac * sign;
  return [
    (ax + bx) * 0.5 + ipx * off,
    (ay + by) * 0.5,
    (az + bz) * 0.5 + ipz * off,
  ];
}

/** Allocation-free variant: writes the control point into a caller-
 *  supplied 3-element Float32Array. Hot-loop callers (setFabric)
 *  reuse a single scratch to avoid the ~6k tuple allocations per
 *  call that the array-returning form costs at fabric-rebuild time.
 *
 *  Typed as `Float32Array` (not the wider `number[] | Float32Array`)
 *  so the JIT sees a single shape on the call site and avoids the
 *  StubFoldingGuardMultipleShapes deopts that otherwise hit when
 *  the same function is called with both regular arrays and typed
 *  arrays from different parts of the codebase. */
export function bezierControlInto(
  out: Float32Array,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  hashSeed: number,
): void {
  const dx = bx - ax;
  const dz = bz - az;
  const planar = Math.sqrt(dx * dx + dz * dz);
  if (planar < 1e-6) {
    out[0] = (ax + bx) * 0.5;
    out[1] = (ay + by) * 0.5;
    out[2] = (az + bz) * 0.5;
    return;
  }
  const ipx = -dz / planar;
  const ipz = dx / planar;
  const sign = (hashSeed & 1) === 0 ? 1 : -1;
  const magFrac = 0.10 + 0.10 * (((hashSeed >>> 8) & 0xff) / 0xff);
  const chord = Math.sqrt(planar * planar + (by - ay) * (by - ay));
  const off = chord * magFrac * sign;
  out[0] = (ax + bx) * 0.5 + ipx * off;
  out[1] = (ay + by) * 0.5;
  out[2] = (az + bz) * 0.5 + ipz * off;
}

/** Sample one point on the Bezier (a, ctrl, b) at parameter t ∈ [0,1].
 *  Returns a fresh tuple each call. Pairs with `bezierAtInto` below;
 *  see the matching note on `bezierControl` for why the math is
 *  duplicated rather than delegated. */
export function bezierAt(
  ax: number, ay: number, az: number,
  cx: number, cy: number, cz: number,
  bx: number, by: number, bz: number,
  t: number,
): [number, number, number] {
  const u = 1 - t;
  return [
    u * u * ax + 2 * u * t * cx + t * t * bx,
    u * u * ay + 2 * u * t * cy + t * t * by,
    u * u * az + 2 * u * t * cz + t * t * bz,
  ];
}

/** Allocation-free variant of `bezierAt`: writes (x, y, z) into a
 *  caller-supplied 3-element Float32Array. Used by hot-loop callers
 *  (setFabric, pushActiveHop) where per-sample tuple allocation
 *  shows up as GC pressure in profiling. Monomorphic on
 *  `Float32Array` for the same JIT-stability reason as
 *  `bezierControlInto`. */
export function bezierAtInto(
  out: Float32Array,
  ax: number, ay: number, az: number,
  cx: number, cy: number, cz: number,
  bx: number, by: number, bz: number,
  t: number,
): void {
  const u = 1 - t;
  const u2 = u * u;
  const ut2 = 2 * u * t;
  const t2 = t * t;
  out[0] = u2 * ax + ut2 * cx + t2 * bx;
  out[1] = u2 * ay + ut2 * cy + t2 * by;
  out[2] = u2 * az + ut2 * cz + t2 * bz;
}
