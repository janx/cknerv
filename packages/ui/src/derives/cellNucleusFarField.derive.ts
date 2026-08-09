// cellNucleusFarField — whole-field early-out for the CellNucleus LOD walk.
//
// Nucleus identity is a zoom-in detail: under the resting overview camera
// every retained Cell sits beyond FAR_DIST, the 12 Hz O(count) selection walk
// admits nothing, and its only product is an empty `near` set. These pure
// helpers let the frame loop prove that outcome from a single bounding-sphere
// distance instead of `count` per-Cell distance checks.

/** Structural slice of a retained Cell needed for field bounds. `pos_seed`
 * is the Cell's static position in the galaxy group's local frame — the same
 * frame the LOD walk measures camera distance in — so the cached sphere is
 * unaffected by the parent group's per-frame rotation. */
export interface CellFieldBoundsSource {
  readonly pos_seed: readonly [number, number, number];
}

/** Bounding sphere over the drawn Cell prefix, cached by cells-list identity
 * plus draw count — exactly the pair the nucleus frame loop already treats as
 * its render-set change signal (`renderCellsChanged`), so this cache can
 * never be staler than the loop's own bookkeeping. */
export interface CellFieldBoundsCache {
  cells: readonly CellFieldBoundsSource[] | null;
  count: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  /** Non-finite marks "unknown" (e.g. a NaN pos_seed); the far-field
   * predicate then fails open and the ordinary walk runs. */
  radius: number;
}

export function makeCellFieldBoundsCache(): CellFieldBoundsCache {
  return {
    cells: null,
    count: -1,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    radius: Number.POSITIVE_INFINITY,
  };
}

/** Refresh the cached bounding sphere when the (list identity, draw count)
 * key moves; otherwise return the cache untouched. The rescan is O(count)
 * but runs only when the render set itself changes (block arrival, resync),
 * never on steady LOD ticks. Two passes keep the sphere tight: axis-aligned
 * box first, then the exact max distance from the box centre, so a compact
 * field does not forfeit skips to a loose radius. */
export function ensureCellFieldBounds(
  cache: CellFieldBoundsCache,
  cells: readonly CellFieldBoundsSource[],
  count: number,
): CellFieldBoundsCache {
  const scanCount = Math.min(
    Math.max(0, Math.floor(Number.isFinite(count) ? count : 0)),
    cells.length,
  );
  if (cache.cells === cells && cache.count === scanCount) return cache;
  cache.cells = cells;
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
 * drawn Cell fails the walk's distance test, so only Cells with a live
 * focus can be admitted. Camera coordinates must be the group-local values
 * the walk itself would use, sampled on the same LOD tick. Any non-finite
 * radius fails open.
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

/**
 * True when the LOD walk provably cannot admit a single Cell this tick: no
 * focus / recall / route-hop envelope is alive (interaction reveals identity
 * at any distance) and the whole field is beyond `farDist`. A skip is then
 * behaviour-equivalent to walking. The frame loop also handles the
 * far-camera-WITH-focus case itself: it walks just the envelope entries via
 * the visible-index map instead of every drawn Cell, because
 * `cellNucleusFarFieldBeyond` proves distance admits nothing else.
 */
export function cellNucleusFarFieldSkip(
  cameraLocalX: number,
  cameraLocalY: number,
  cameraLocalZ: number,
  bounds: Pick<
    CellFieldBoundsCache,
    'centerX' | 'centerY' | 'centerZ' | 'radius'
  >,
  farDist: number,
  focusEnvelopeCount: number,
  recallActive: boolean,
  routeHopActive: boolean,
): boolean {
  if (focusEnvelopeCount > 0 || recallActive || routeHopActive) return false;
  return cellNucleusFarFieldBeyond(
    cameraLocalX,
    cameraLocalY,
    cameraLocalZ,
    bounds,
    farDist,
  );
}
