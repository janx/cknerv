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
//
// THE BUILD IS RESUMABLE, because it is one batch-sized grain otherwise. The
// collect pass is ~95 % of the cost and it is memory traffic, not arithmetic:
// one `cells.get` per graph key plus a second dereference to `pos_seed`, i.e.
// ~24,000 scattered touches over a 12,000-node stage, on a map the block churn
// has long since reordered away from the allocation order. Measured whole it is
// 1.4–3.7 ms on an idle desktop and 18–47 ms on a throttled laptop — the
// longest single step the live planner takes, and one no wall budget can cut,
// since a budget is only ever spent BETWEEN steps. So `createOriginEntryIndexBuilder`
// walks the stage under a work quantum and the planner spends one chunk a frame,
// while `buildOriginEntryIndex` is that same builder drained in one call and is
// byte-for-byte the index it always was.
//
// Two invariants make the slicing safe. NO READER EVER SEES A PARTIAL GRID:
// `index()` is the only way to reach one and it finishes the build first, so a
// query arriving mid-build costs the old single grain and never a wrong answer.
// And the collected arrays are PREALLOCATED to the graph's node count (growing
// only if the Map itself grows under the walk, which a sliced build allows and
// a drained one cannot), so the build stops churning ~3 MB of doubling
// `number[]` per block — the allocation peak a scavenge used to be charged to.

import type { NeighborAdjacency } from './neighborGraph';

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

/** Graph nodes one {@link OriginEntryIndexBuilder.step} may examine. The live
 *  planner spends one chunk a frame, so this is the grain the frame budget can
 *  finally cut the grid down to: at ~1.5 µs a node on a throttled laptop (the
 *  47 ms trough reading over a 12,000-node stage) a chunk is ~3 ms, against a
 *  whole-build grain no budget could touch. Smaller would only buy a finer
 *  grain at the price of more frames before the batch may plan at all, and a
 *  batch's departure slack — 2.2 s, ~130 frames — is what pays for those.
 *
 *  It is a COST knob only: the index a resumed build produces is the index a
 *  drained one produces, at any quantum, which the tests assert differentially
 *  rather than argue. */
export const ORIGIN_ENTRY_BUILD_QUANTUM = 2048;

/** Fuel a collected node costs: a Map walk step, a `cells.get` into a
 *  scattered Cell and a second dereference to `pos_seed`. */
const COLLECT_COST = 8;

/** Fuel one typed-array element of the bucket passes costs. The bench puts
 *  those passes ~37x below the collect pass per element (0.10 ms for 24,600
 *  elements against 1.80 ms for 12,000 nodes), so charging them at an eighth
 *  is deliberately conservative: it can only end a step early. */
const PACK_COST = 1;

const PHASE_COLLECT = 0;
const PHASE_COUNT = 1;
const PHASE_PREFIX = 2;
const PHASE_SCATTER = 3;
const PHASE_DONE = 4;

/**
 * The build of one {@link OriginEntryIndex} as a resumable machine, so a
 * stage-wide rebuild is a sequence of bounded grains instead of one.
 *
 * The index is only reachable through {@link OriginEntryIndexBuilder.index},
 * which finishes the build first — a caller can never read a half-built grid,
 * and the worst case of asking early is the single grain this exists to split.
 */
export interface OriginEntryIndexBuilder {
  /** The whole stage has been walked and bucketed. */
  readonly done: boolean;
  /** Graph nodes examined so far — the collect cursor, for the gauges. */
  readonly visited: number;
  /**
   * Advance by at most `quantum` graph nodes of collecting (and the
   * proportionally cheaper bucket work), then return {@link done}. Always
   * makes progress while work remains; a non-finite quantum drains.
   */
  step(quantum?: number): boolean;
  /** The finished index, draining whatever is left of the build first. */
  index(): OriginEntryIndex;
}

const EMPTY_I32 = new Int32Array(0);

/**
 * Open a resumable build of the entry index over `graph`'s eligible nodes.
 *
 * LIFETIME: one build per `planLinkBatch`, then one query per origin. The
 * index snapshots eligible positions as it walks and keeps the `cells` /
 * `graph` references for the adjacency fast path, so it is only valid for
 * the batch it was built for — both churn every block, and a cached index
 * would answer with a stage that no longer exists. A SLICED build spans
 * frames, so the snapshot is taken across a window rather than at an instant:
 * the Map iterator skips a node deleted before it is reached and visits one
 * inserted behind it, which is the same staleness the batch already accepts
 * for the rest of its life (and why the frame loop validates every hop).
 */
export function createOriginEntryIndexBuilder(
  cells: ReadonlyMap<number, OriginEntryPositioned>,
  graph: NeighborAdjacency,
  options: OriginEntryOptions = {},
): OriginEntryIndexBuilder {
  // Preallocated to the graph's node count: the eligible set is a subset of
  // it, so the common build never copies. `ids` is a Float64Array because a
  // cell id spans the sequential-small and 2^52 families and both are exact
  // doubles — the same value the boxed array held, so every comparison and
  // every tie-break below reads identically.
  let capacity = graph.adjacency.size;
  let ids = new Float64Array(capacity);
  let xs = new Float64Array(capacity);
  let ys = new Float64Array(capacity);
  let zs = new Float64Array(capacity);
  let n = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  // The cursor over the stage. A Map iterator survives insertion and deletion
  // under it, which is what makes it resumable across frames at all.
  const walk = graph.adjacency.entries();

  let originX = 0;
  let originZ = 0;
  let bucketSize = ORIGIN_ENTRY_BUCKET_SIZE;
  let nx = 1;
  let nz = 1;
  let buckets = 1;
  let starts: Int32Array = EMPTY_I32;
  let bucketOf: Int32Array = EMPTY_I32;
  let slots: Int32Array = EMPTY_I32;
  let cursor: Int32Array = EMPTY_I32;

  let phase = PHASE_COLLECT;
  let at = 0;
  let view: OriginEntryIndex | null = null;

  /** Only reachable when the Map grew under a sliced walk. */
  function grow(): void {
    const next = capacity === 0 ? 64 : capacity * 2;
    const wider = (from: Float64Array): Float64Array<ArrayBuffer> => {
      const to = new Float64Array(next);
      to.set(from);
      return to;
    };
    ids = wider(ids);
    xs = wider(xs);
    ys = wider(ys);
    zs = wider(zs);
    capacity = next;
  }

  /** Grid origin is the field's own corner, not the world origin: the ring
   *  walk's distance floor is stated in bucket sides from the QUERY's bucket,
   *  and that holds for any lattice offset as long as one lattice is used. */
  function layout(): void {
    originX = n === 0 ? 0 : minX;
    originZ = n === 0 ? 0 : minZ;
    const spanX = n === 0 ? 0 : maxX - minX;
    const spanZ = n === 0 ? 0 : maxZ - minZ;
    bucketSize =
      options.bucketSize !== undefined && options.bucketSize > 0
        ? options.bucketSize
        : ORIGIN_ENTRY_BUCKET_SIZE;
    nx = Math.floor(spanX / bucketSize) + 1;
    nz = Math.floor(spanZ / bucketSize) + 1;
    while (nx * nz > MAX_BUCKETS) {
      bucketSize *= 2;
      nx = Math.floor(spanX / bucketSize) + 1;
      nz = Math.floor(spanZ / bucketSize) + 1;
    }
    buckets = nx * nz;
    // CSR bucket layout: one Int32Array of bucket starts plus one of node
    // slots, so the whole grid is two allocations instead of a Map of arrays
    // rebuilt every block. Both are bulk zero-fills, not per-element JS work,
    // which is why the quantum does not charge for them.
    starts = new Int32Array(buckets + 1);
    bucketOf = new Int32Array(n);
  }

  function step(quantum: number = ORIGIN_ENTRY_BUILD_QUANTUM): boolean {
    let fuel = Math.max(1, quantum) * COLLECT_COST;
    while (fuel > 0 && phase !== PHASE_DONE) {
      if (phase === PHASE_COLLECT) {
        while (fuel > 0) {
          const entry = walk.next();
          if (entry.done === true) {
            layout();
            phase = PHASE_COUNT;
            at = 0;
            break;
          }
          // Charged per node EXAMINED, not per node kept: the Map step and the
          // `cells.get` are the cost, and a skipped node has already paid them.
          fuel -= COLLECT_COST;
          const id = entry.value[0];
          if (entry.value[1].size === 0) continue;
          const cell = cells.get(id);
          if (cell === undefined) continue;
          const pos = cell.pos_seed;
          const x = pos[0];
          const z = pos[2];
          if (n === capacity) grow();
          ids[n] = id;
          xs[n] = x;
          ys[n] = pos[1];
          zs[n] = z;
          n += 1;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
      } else if (phase === PHASE_COUNT) {
        while (fuel > 0 && at < n) {
          const gx = Math.floor((xs[at] - originX) / bucketSize);
          const gz = Math.floor((zs[at] - originZ) / bucketSize);
          const b = gz * nx + gx;
          bucketOf[at] = b;
          starts[b + 1] += 1;
          at += 1;
          fuel -= PACK_COST;
        }
        if (at >= n) {
          phase = PHASE_PREFIX;
          at = 0;
        }
      } else if (phase === PHASE_PREFIX) {
        while (fuel > 0 && at < buckets) {
          starts[at + 1] += starts[at];
          at += 1;
          fuel -= PACK_COST;
        }
        if (at >= buckets) {
          slots = new Int32Array(n);
          cursor = starts.slice(0, buckets);
          phase = PHASE_SCATTER;
          at = 0;
        }
      } else {
        while (fuel > 0 && at < n) {
          const b = bucketOf[at];
          slots[cursor[b]] = at;
          cursor[b] += 1;
          at += 1;
          fuel -= PACK_COST;
        }
        if (at >= n) phase = PHASE_DONE;
      }
    }
    return phase === PHASE_DONE;
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

  return {
    get done() {
      return phase === PHASE_DONE;
    },
    get visited() {
      return n;
    },
    step,
    index(): OriginEntryIndex {
      while (phase !== PHASE_DONE) step(Number.POSITIVE_INFINITY);
      return (view ??= { size: n, nearest, entryFor });
    },
  };
}

/**
 * Build the per-batch entry index over `graph`'s eligible nodes in one call —
 * {@link createOriginEntryIndexBuilder} drained. Callers that can afford to
 * spread the walk across frames take the builder instead; this is the answer
 * either of them produces, and the tests hold the two to each other.
 */
export function buildOriginEntryIndex(
  cells: ReadonlyMap<number, OriginEntryPositioned>,
  graph: NeighborAdjacency,
  options: OriginEntryOptions = {},
): OriginEntryIndex {
  return createOriginEntryIndexBuilder(cells, graph, options).index();
}
