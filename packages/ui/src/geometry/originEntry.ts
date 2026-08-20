// Fabric entry for a world POSITION. A metabolic pulse departs from the
// address of a cell that died, and an address is a position — the cell
// itself may hold no adjacency any more, or have left every client map.
// Planning therefore asks "which live staged node does this position enter
// the fabric at" once per origin and many times per batch, which the linear
// scan (`nearestGraphNode`) answers by walking the whole 12,000-node stage
// every call.
//
// Eligibility is `nearestGraphNode`'s rule verbatim: a node counts iff it
// has degree > 0 in the graph AND is present in the cells map. Degree-0 keys
// are real after death pruning and an isolated entry would dead-end the
// route; a graph key with no Cell cannot be rendered as a hop. Equivalence
// with the linear scan — including the smaller-id tie-break — is asserted
// directly in the tests, so this module is an accelerator and never a second
// opinion.

import type { NeighborGraph } from './neighborGraph';

/** Bucket side in world units, ~4x the fabric's median edge (1.89 world
 *  units after the k-NN search was corrected — the same calibration
 *  `HOP_MS_BASE` is pinned to). One bucket therefore spans a few edges in
 *  every direction, so the answer is almost always inside the query's own
 *  bucket plus its ring of eight.
 *
 *  It is a COST knob only. The ring walk widens until the next ring's floor
 *  distance provably cannot beat the best hit so far, so the node returned
 *  is the same node for any side — asserted against the linear scan across
 *  several sides rather than argued. */
export const ORIGIN_ENTRY_BUCKET_SIZE = 8;

/** Ceiling on the bucket grid's allocation. The grid is rebuilt per batch,
 *  so a freak field extent must not be able to size an array off the width
 *  of the stage; the side doubles until the grid fits, which only makes the
 *  walk coarser. */
const MAX_BUCKETS = 1 << 16;

/** Minimal position shape the index reads. `Cell` and `NeighborGraphCell`
 *  both satisfy it structurally, same seam as `RescuePositioned`. */
export interface OriginEntryPositioned {
  pos_seed: readonly [number, number, number];
}

export interface OriginEntryOptions {
  /** Bucket side override — cost only, see {@link ORIGIN_ENTRY_BUCKET_SIZE}. */
  bucketSize?: number;
}

export interface OriginEntryIndex {
  /** Eligible nodes held: graph degree > 0 AND present in the cells map. */
  readonly size: number;
  /**
   * Nearest eligible node to a world position, or null when the index holds
   * none. Distance is 3D (Y is ignored for bucketing but counted in the
   * metric); ties break toward the lower id. `excludeId` drops one id from
   * consideration — the anchor's own node is never its own entry.
   */
  nearest(
    pos: readonly [number, number, number],
    excludeId?: number,
  ): number | null;
  /**
   * Entry node for an anchor at `pos`. When the anchor id still carries
   * adjacency (a dying resident the graph has not pruned yet) the entry is
   * its nearest eligible neighbour, so the pulse departs along a real —
   * retracting — edge without a grid query at all. Otherwise the grid
   * answers, with the anchor itself excluded: `path[0]` must be a live
   * staged cell, and the anchor is by definition the one that died.
   */
  entryFor(
    anchorId: number,
    pos: readonly [number, number, number],
  ): number | null;
}

/**
 * Build the per-batch entry index over `graph`'s eligible nodes.
 *
 * LIFETIME: one build per `planLinkBatch`, then one query per origin. The
 * index snapshots eligible positions at build time and keeps the `cells` /
 * `graph` references for the adjacency fast path, so it is only valid for
 * the batch it was built for — both churn every block, and a cached index
 * would answer with a stage that no longer exists.
 */
export function buildOriginEntryIndex(
  cells: ReadonlyMap<number, OriginEntryPositioned>,
  graph: NeighborGraph,
  options: OriginEntryOptions = {},
): OriginEntryIndex {
  const ids: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const [id, neighbours] of graph.adjacency) {
    if (neighbours.size === 0) continue;
    const cell = cells.get(id);
    if (cell === undefined) continue;
    const x = cell.pos_seed[0];
    const z = cell.pos_seed[2];
    ids.push(id);
    xs.push(x);
    ys.push(cell.pos_seed[1]);
    zs.push(z);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const n = ids.length;

  // Grid origin is the field's own corner, not the world origin: the ring
  // walk's distance floor is stated in bucket sides from the QUERY's bucket,
  // and that holds for any lattice offset as long as one lattice is used.
  const originX = n === 0 ? 0 : minX;
  const originZ = n === 0 ? 0 : minZ;
  const spanX = n === 0 ? 0 : maxX - minX;
  const spanZ = n === 0 ? 0 : maxZ - minZ;
  let bucketSize =
    options.bucketSize !== undefined && options.bucketSize > 0
      ? options.bucketSize
      : ORIGIN_ENTRY_BUCKET_SIZE;
  let nx = Math.floor(spanX / bucketSize) + 1;
  let nz = Math.floor(spanZ / bucketSize) + 1;
  while (nx * nz > MAX_BUCKETS) {
    bucketSize *= 2;
    nx = Math.floor(spanX / bucketSize) + 1;
    nz = Math.floor(spanZ / bucketSize) + 1;
  }

  // CSR bucket layout: one Int32Array of bucket starts plus one of node
  // slots, so the whole grid is two allocations instead of a Map of arrays
  // rebuilt every block.
  const starts = new Int32Array(nx * nz + 1);
  const bucketOf = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const gx = Math.floor((xs[i] - originX) / bucketSize);
    const gz = Math.floor((zs[i] - originZ) / bucketSize);
    const b = gz * nx + gx;
    bucketOf[i] = b;
    starts[b + 1] += 1;
  }
  for (let b = 0; b < nx * nz; b++) starts[b + 1] += starts[b];
  const slots = new Int32Array(n);
  const cursor = starts.slice(0, nx * nz);
  for (let i = 0; i < n; i++) {
    slots[cursor[bucketOf[i]]] = i;
    cursor[bucketOf[i]] += 1;
  }

  function nearest(
    pos: readonly [number, number, number],
    excludeId?: number,
  ): number | null {
    if (n === 0) return null;
    const px = pos[0];
    const py = pos[1];
    const pz = pos[2];
    // Deliberately UNCLAMPED: a query outside the field keeps its true
    // lattice coordinates, which is what makes the ring floor below a
    // sound bound for it too.
    const qx = Math.floor((px - originX) / bucketSize);
    const qz = Math.floor((pz - originZ) / bucketSize);
    let best = -1;
    let bestDistSq = Number.POSITIVE_INFINITY;
    const scan = (gx: number, gz: number): void => {
      const b = gz * nx + gx;
      const end = starts[b + 1];
      for (let s = starts[b]; s < end; s++) {
        const i = slots[s];
        const id = ids[i];
        if (id === excludeId) continue;
        const dx = xs[i] - px;
        const dy = ys[i] - py;
        const dz = zs[i] - pz;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestDistSq || (d === bestDistSq && id < best)) {
          best = id;
          bestDistSq = d;
        }
      }
    };

    // First ring that touches the grid at all — a far-outside query must
    // not pay one loop turn per empty ring on the way in.
    const rStart = Math.max(
      0,
      -qx,
      qx - (nx - 1),
      -qz,
      qz - (nz - 1),
    );
    const rEnd = Math.max(
      Math.abs(qx),
      Math.abs(qx - (nx - 1)),
      Math.abs(qz),
      Math.abs(qz - (nz - 1)),
    );
    for (let r = rStart; r <= rEnd; r++) {
      const x0 = qx - r;
      const x1 = qx + r;
      const z0 = qz - r;
      const z1 = qz + r;
      const cx0 = Math.max(0, x0);
      const cx1 = Math.min(nx - 1, x1);
      if (cx0 <= cx1) {
        if (z0 >= 0 && z0 < nz) for (let gx = cx0; gx <= cx1; gx++) scan(gx, z0);
        if (r > 0 && z1 >= 0 && z1 < nz) {
          for (let gx = cx0; gx <= cx1; gx++) scan(gx, z1);
        }
      }
      // Rows already covered the ring's corners, so the columns run open.
      const iz0 = Math.max(0, z0 + 1);
      const iz1 = Math.min(nz - 1, z1 - 1);
      if (iz0 <= iz1) {
        if (x0 >= 0 && x0 < nx) for (let gz = iz0; gz <= iz1; gz++) scan(x0, gz);
        if (r > 0 && x1 >= 0 && x1 < nx) {
          for (let gz = iz0; gz <= iz1; gz++) scan(x1, gz);
        }
      }
      // A hit does not end the walk: the query sits anywhere inside its own
      // bucket, so a neighbouring bucket can hold a nearer node. Ring r+1's
      // buckets are at least r sides away, and the comparison is STRICT so
      // an exact tie out there still gets its chance at the lower id.
      if (best !== -1) {
        const ringFloor = r * bucketSize;
        if (bestDistSq < ringFloor * ringFloor) break;
      }
    }
    return best === -1 ? null : best;
  }

  function entryFor(
    anchorId: number,
    pos: readonly [number, number, number],
  ): number | null {
    const adjacency = graph.adjacency.get(anchorId);
    if (adjacency !== undefined) {
      let best = -1;
      let bestDistSq = Number.POSITIVE_INFINITY;
      for (const nb of adjacency) {
        if (nb === anchorId) continue;
        // Same eligibility as the grid, so an entry is an entry however it
        // was found: a caller's BFS reads the returned id as a graph source
        // and the frame loop reads it as a renderable hop.
        if ((graph.adjacency.get(nb)?.size ?? 0) === 0) continue;
        const cell = cells.get(nb);
        if (cell === undefined) continue;
        const dx = cell.pos_seed[0] - pos[0];
        const dy = cell.pos_seed[1] - pos[1];
        const dz = cell.pos_seed[2] - pos[2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestDistSq || (d === bestDistSq && nb < best)) {
          best = nb;
          bestDistSq = d;
        }
      }
      if (best !== -1) return best;
    }
    return nearest(pos, anchorId);
  }

  return { size: n, nearest, entryFor };
}
