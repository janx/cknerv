// cellNucleusFarField — whole-field early-out for the CellNucleus LOD tick.
//
// Nucleus identity is a zoom-in detail: under the resting overview camera
// every retained Cell sits beyond FAR_DIST, so camera-distance admission can
// only ever produce an empty `near` set. These pure helpers let the LOD tick
// prove that outcome from a single bounding-sphere distance — the gate in
// front of the spatial index in `cellNucleusSpatialLod.derive.ts`, which is
// therefore neither built nor refreshed while the proof holds.

/** Structural slice of a retained Cell needed for field bounds. `pos_seed`
 * is the Cell's static position in the galaxy group's local frame — the same
 * frame the LOD walk measures camera distance in — so the cached sphere is
 * unaffected by the parent group's per-frame rotation. */
export interface CellFieldBoundsSource {
  readonly pos_seed: readonly [number, number, number];
}

/** Bounding sphere over the drawn Cell prefix, cached by the slot layer's
 * position version plus draw count. The list republishes for any payload
 * change — a tag, a death, an enrichment refresh — while the sphere depends
 * on WHERE the drawn cells are and nothing else, so list identity would pay
 * a full rescan per delta for an answer that cannot have moved. */
export interface CellFieldBoundsCache {
  /** Position version this sphere was measured at; -1 before the first
   * scan, which no version can equal. */
  version: number;
  count: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  /** Non-finite marks "unknown" (e.g. a NaN pos_seed); the far-field
   * predicate then fails open and the spatial index runs. */
  radius: number;
}

export function makeCellFieldBoundsCache(): CellFieldBoundsCache {
  return {
    version: -1,
    count: -1,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    radius: Number.POSITIVE_INFINITY,
  };
}

/** Refresh the cached bounding sphere when the (position version, draw
 * count) key moves; otherwise return the cache untouched. The rescan is
 * O(count) but runs only when the drawn cells actually move (membership
 * churn, resync), never on steady LOD ticks and never for a payload delta.
 * Two passes keep the sphere tight: axis-aligned box first, then the exact
 * max distance from the box centre, so a compact field does not forfeit
 * skips to a loose radius. */
export function ensureCellFieldBounds(
  cache: CellFieldBoundsCache,
  cells: readonly CellFieldBoundsSource[],
  count: number,
  version: number,
): CellFieldBoundsCache {
  const scanCount = Math.min(
    Math.max(0, Math.floor(Number.isFinite(count) ? count : 0)),
    cells.length,
  );
  if (cache.version === version && cache.count === scanCount) return cache;
  cache.version = version;
  cache.count = scanCount;
  cache.centerX = 0;
  cache.centerY = 0;
  cache.centerZ = 0;
  cache.radius = 0;
  if (scanCount === 0) return cache;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < scanCount; index += 1) {
    const seed = cells[index].pos_seed;
    const x = seed[0];
    const y = seed[1];
    const z = seed[2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      cache.radius = Number.POSITIVE_INFINITY;
      return cache;
    }
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  let maxDistSq = 0;
  for (let index = 0; index < scanCount; index += 1) {
    const seed = cells[index].pos_seed;
    const dx = seed[0] - centerX;
    const dy = seed[1] - centerY;
    const dz = seed[2] - centerZ;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > maxDistSq) maxDistSq = distSq;
  }
  cache.centerX = centerX;
  cache.centerY = centerY;
  cache.centerZ = centerZ;
  cache.radius = Math.sqrt(maxDistSq);
  return cache;
}

/**
 * True when even the nearest possible Cell — the bounding sphere's closest
 * surface point — is at least `farDist` away, the walk's own per-Cell
 * rejection distance (`distSq >= FAR_DIST_SQ`). Under this condition every
 * drawn Cell fails the distance test, so the spatial index has nothing to
 * say and only explicit semantic ids (focus, hover, recall, route hop) can be
 * admitted — the direct lane the LOD tick runs regardless of this answer.
 * Camera coordinates must be the group-local values the walk itself would
 * use, sampled on the same LOD tick. Any non-finite radius fails open.
 */
export function cellNucleusFarFieldBeyond(
  cameraLocalX: number,
  cameraLocalY: number,
  cameraLocalZ: number,
  bounds: Pick<
    CellFieldBoundsCache,
    'centerX' | 'centerY' | 'centerZ' | 'radius'
  >,
  farDist: number,
): boolean {
  if (!Number.isFinite(bounds.radius)) return false;
  const dx = cameraLocalX - bounds.centerX;
  const dy = cameraLocalY - bounds.centerY;
  const dz = cameraLocalZ - bounds.centerZ;
  const cameraDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return cameraDist - bounds.radius >= farDist;
}
