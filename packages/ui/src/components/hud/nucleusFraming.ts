// Pure framing helpers for the cell-detail nucleus portrait. Kept free of
// three.js so they are unit-testable (prior lesson: extract pure logic).

/** Farthest branch-vertex distance from the origin, over a flat
 *  [x,y,z, x,y,z, …] segment array. Bounds the nucleus for framing. */
export function nucleusBoundingRadius(segments: number[]): number {
  let max = 0;
  for (let i = 0; i + 2 < segments.length; i += 3) {
    const x = segments[i], y = segments[i + 1], z = segments[i + 2];
    const r2 = x * x + y * y + z * z;
    if (r2 > max) max = r2;
  }
  return Math.sqrt(max);
}

/** Scale factor that maps a nucleus of the given bounding radius to a
 *  target world radius (default 1.0). Positions AND point sizes are
 *  pre-multiplied by this at build time so the portrait frames every
 *  hash-distinct nucleus consistently. Guards a degenerate zero radius. */
export function framingScale(radius: number, targetWorldRadius = 1.0): number {
  return radius > 1e-6 ? targetWorldRadius / radius : 1;
}
