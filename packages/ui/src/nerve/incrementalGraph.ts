// Eager incremental maintenance of the spatial neighbour graph. Mutates a
// graph in place (it is the live graphRef) and returns the edge delta for
// the fabric to animate. addCell adds a newborn's real k-NN out-edges
// (symmetric); the symmetric in-edges an existing cell would gain are left
// to periodic reconciliation (buildNeighborGraph). Operates on LIVE cells
// only (death_at_ms == null), matching the canonical builder.
//
// INVARIANT (copy on write): an adjacency `Set` instance is never changed in
// place once it sits in `graph.adjacency` — every change REPLACES the node's
// Set. The worker deserializers already reuse an instance only when the node
// is proven unchanged, so across the whole system "same Set instance" means
// "same neighbours, same order", and the route search's per-node neighbour
// cache (`geometry/pathRouter.ts`) keys on exactly that. Iteration order is
// preserved by the copy: `new Set(old)` keeps insertion order, an append
// lands last, a delete leaves the rest in place — the same order an in-place
// mutation would have produced.
//
// Every replacement is also LOGGED when the graph carries an eager log
// (`LivingNeighborGraph.eagerBase`): the instance displaced by the first
// touch of a node since the last worker apply. The worker's next patch is a
// diff against the graph as it stood before these edits, and the apply puts
// that instance back for every node the patch does not name — which is what
// lets the apply be O(churn) and still land exactly on the worker's build.

import type { Cell } from '@cknerv/types';
import type {
  NeighborAdjacency,
  NeighborEdge,
} from '../geometry/neighborGraph';
import { fabricEdgeKey } from './fabricOrder';

const DEFAULT_K = 4;
const MAX_EDGE_LENGTH = 25; // mirror neighborGraph.ts

/** What the eager mutators operate on. Every graph carries adjacency; the
 *  dense edge list is kept compacted only where one exists (a whole
 *  `NeighborGraph` — the synchronous builder's output and test fixtures),
 *  and the eager log is written only where one exists (the display graph,
 *  a `LivingNeighborGraph`). The display graph carries no edge list
 *  precisely so a death costs O(degree) here rather than a filter over the
 *  whole field's edges. */
export type MutableNeighborGraph = NeighborAdjacency & {
  edges?: NeighborEdge[];
  eagerBase?: Map<number, Set<number> | undefined>;
};

/** Publish a node's replacement Set (or its removal, `undefined`), logging
 *  the instance it displaces on the node's FIRST touch since the last
 *  worker apply — later touches keep that first entry, because it is the
 *  instance the worker's previous build holds. */
function publish(
  graph: MutableNeighborGraph,
  id: number,
  next: Set<number> | undefined,
): void {
  const log = graph.eagerBase;
  if (log !== undefined && !log.has(id)) log.set(id, graph.adjacency.get(id));
  if (next === undefined) graph.adjacency.delete(id);
  else graph.adjacency.set(id, next);
}

/** Publish `id`'s neighbour set as a fresh instance with `add` appended —
 *  the copy-on-write step of every edge insertion. */
function withNeighbour(graph: MutableNeighborGraph, id: number, add: number): void {
  const previous = graph.adjacency.get(id);
  const next = previous === undefined ? new Set<number>() : new Set(previous);
  next.add(add);
  publish(graph, id, next);
}

function addEdge(
  graph: MutableNeighborGraph,
  a: number,
  b: number,
  d: number,
): NeighborEdge | null {
  if (a === b) return null;
  const sa = graph.adjacency.get(a);
  if (sa !== undefined && sa.has(b)) return null;
  const lo = a < b ? a : b, hi = a < b ? b : a;
  const edge: NeighborEdge = { from: lo, to: hi, d };
  withNeighbour(graph, a, b);
  withNeighbour(graph, b, a);
  if (graph.edges !== undefined) graph.edges.push(edge);
  return edge;
}

// --- Birth admission grid --------------------------------------------------
//
// A birth's k nearest are answered from a bucketed XZ grid over the staged map
// instead of a full scan per birth. The grid is built ONCE per generation
// (planMeshUpdate) and shared across every birth in the batch, turning a
// batch's cost from O(births × N) — up to 250K comparisons at 20 births, with
// a hard cliff above which admission was skipped entirely — into
// O(N + 9 × occupancy × births).
//
// SAME RESULT AS THE FULL SCAN. The ring walk widens a bucket ring at a time
// until the k-th neighbour found is provably nearer than anything unscanned:
// rings 0..r cover every bucket within r×bucketSize of the query in xz, so a
// point outside them is farther than that in xz and therefore in full 3D too
// (the same EXACT stop `buildNeighborGraph` relies on). The bucket side is
// thus a pure COST knob, and the selection it feeds is the identical
// (dSq, scanOrder) top-k the full scan chose — ties and the lifeline included.
// `scanOrder` is each live cell's index in `cells.values()` (the grid is
// filled in that order); skipping `self` shifts every later candidate by one
// but preserves their RELATIVE order, which is all a tie-break compares.

const BIRTH_BUCKET_TARGET_OCCUPANCY = 4; // mirror neighborGraph.ts
const BIRTH_BUCKET_COORD_LIMIT = 8000;

function birthBucketKey(bx: number, bz: number): number {
  return ((bx + 16384) << 16) | (bz + 16384);
}

/** A bucketed spatial index over the staged map's LIVE cells, in
 *  `cells.values()` order (the array index is the scan-order tie-break key).
 *  Built once per birth batch and shared by every `addCell` in it. */
export interface BirthAdmissionGrid {
  bucketSize: number;
  maxRing: number;
  ids: Float64Array;
  xs: Float64Array;
  ys: Float64Array;
  zs: Float64Array;
  buckets: Map<number, number[]>;
}

/** Build the birth-admission grid over `cells`. One pass measures the field
 *  and packs the live scalars in iteration order; a second buckets them by xz.
 *  Ids must be Float64: galaxy-composition Cells carry 2^52-range ids an
 *  Int32Array would wrap into phantom nodes. */
export function buildBirthAdmissionGrid(
  cells: ReadonlyMap<number, Cell>,
): BirthAdmissionGrid {
  let liveCount = 0;
  for (const c of cells.values()) if (c.death_at_ms == null) liveCount += 1;
  const ids = new Float64Array(liveCount);
  const xs = new Float64Array(liveCount);
  const ys = new Float64Array(liveCount);
  const zs = new Float64Array(liveCount);
  const buckets = new Map<number, number[]>();
  if (liveCount === 0) {
    return { bucketSize: 1, maxRing: 0, ids, xs, ys, zs, buckets };
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let i = 0;
  for (const c of cells.values()) {
    if (c.death_at_ms != null) continue;
    const x = c.pos_seed[0];
    const z = c.pos_seed[2];
    ids[i] = c.id;
    xs[i] = x;
    ys[i] = c.pos_seed[1];
    zs[i] = z;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    i += 1;
  }
  // Bucket side derived from the field's own density so the scan cost tracks k
  // rather than the population; the areal reading is honest for a filled field,
  // the linear one rescues a near-collinear field whose area is ~0. It is a
  // cost knob only — the ring stop makes the result side-independent.
  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;
  const extent = Math.max(spanX, spanZ);
  const area = Math.max(spanX, 1e-6) * Math.max(spanZ, 1e-6);
  const arealSide = Math.sqrt(
    (BIRTH_BUCKET_TARGET_OCCUPANCY * area) / liveCount,
  );
  const linearSide = (BIRTH_BUCKET_TARGET_OCCUPANCY * extent) / liveCount;
  const bucketSize = Math.max(
    arealSide,
    linearSide,
    extent / BIRTH_BUCKET_COORD_LIMIT,
    1e-6,
  );
  const maxRing = Math.ceil(extent / bucketSize) + 1;
  for (let j = 0; j < liveCount; j += 1) {
    const bx = Math.floor(xs[j] / bucketSize);
    const bz = Math.floor(zs[j] / bucketSize);
    const key = birthBucketKey(bx, bz);
    let arr = buckets.get(key);
    if (arr === undefined) { arr = []; buckets.set(key, arr); }
    arr.push(j);
  }
  return { bucketSize, maxRing, ids, xs, ys, zs, buckets };
}

export function addCell(
  graph: MutableNeighborGraph,
  cellId: number,
  cells: ReadonlyMap<number, Cell>,
  opts?: { k?: number; maxEdgeLength?: number; grid?: BirthAdmissionGrid },
): { addedEdges: NeighborEdge[] } {
  const self = cells.get(cellId);
  if (!self || self.death_at_ms != null) return { addedEdges: [] };
  const k = opts?.k ?? DEFAULT_K;
  const maxLen = opts?.maxEdgeLength ?? MAX_EDGE_LENGTH;
  const maxLenSq = maxLen * maxLen;
  // A shared grid is the batch path; a lone call (a test, or a stray caller)
  // builds its own over `cells` — same selection, one generation of scan.
  const grid = opts?.grid ?? buildBirthAdmissionGrid(cells);
  const { bucketSize, maxRing, ids, xs, ys, zs, buckets } = grid;

  const selfX = self.pos_seed[0];
  const selfY = self.pos_seed[1];
  const selfZ = self.pos_seed[2];

  // Bounded top-k held sorted ascending by (dSq, scanOrder), plus the global
  // nearest (the lifeline) tracked ungated. k is small (3–7 in every caller),
  // so an insertion into a k-slot array beats a heap and allocates nothing per
  // candidate. `scanOrder` is the candidate's index in the grid's scalars.
  const topId = new Float64Array(k);
  const topDSq = new Float64Array(k);
  const topOrder = new Int32Array(k);
  let topN = 0;
  let hasLifeline = false;
  let lifelineId = 0;
  let lifelineDSq = 0;
  let lifelineOrder = 0;

  const consider = (order: number): void => {
    const dx = selfX - xs[order];
    const dy = selfY - ys[order];
    const dz = selfZ - zs[order];
    const dSq = dx * dx + dy * dy + dz * dz;
    // Lifeline: the global min by (dSq, scanOrder), ties toward the earlier
    // scan position — exactly the strict-less full scan's first-encountered.
    if (
      !hasLifeline
      || dSq < lifelineDSq
      || (dSq === lifelineDSq && order < lifelineOrder)
    ) {
      hasLifeline = true;
      lifelineId = ids[order];
      lifelineDSq = dSq;
      lifelineOrder = order;
    }
    if (k === 0 || dSq > maxLenSq) return; // top-k is cap-gated
    if (
      topN === k
      && (
        dSq > topDSq[k - 1]
        || (dSq === topDSq[k - 1] && order >= topOrder[k - 1])
      )
    ) return;
    let slot = topN < k ? topN : k - 1;
    while (
      slot > 0
      && (
        topDSq[slot - 1] > dSq
        || (topDSq[slot - 1] === dSq && topOrder[slot - 1] > order)
      )
    ) {
      topDSq[slot] = topDSq[slot - 1];
      topId[slot] = topId[slot - 1];
      topOrder[slot] = topOrder[slot - 1];
      slot -= 1;
    }
    topDSq[slot] = dSq;
    topId[slot] = ids[order];
    topOrder[slot] = order;
    if (topN < k) topN += 1;
  };

  const bx = Math.floor(selfX / bucketSize);
  const bz = Math.floor(selfZ / bucketSize);
  const scanBucket = (gx: number, gz: number): void => {
    const arr = buckets.get(birthBucketKey(gx, gz));
    if (arr === undefined) return;
    for (let m = 0; m < arr.length; m += 1) {
      const order = arr[m];
      if (ids[order] === cellId) continue; // self is in the grid; never a candidate
      consider(order);
    }
  };

  for (let ring = 0; ring <= maxRing; ring += 1) {
    if (ring === 0) {
      scanBucket(bx, bz);
    } else {
      // Perimeter only — the interior was scanned by earlier rings.
      for (let dx = -ring; dx <= ring; dx += 1) {
        scanBucket(bx + dx, bz - ring);
        scanBucket(bx + dx, bz + ring);
      }
      for (let dz = -ring + 1; dz <= ring - 1; dz += 1) {
        scanBucket(bx - ring, bz + dz);
        scanBucket(bx + ring, bz + dz);
      }
    }
    const covered = ring * bucketSize;
    const coveredSq = covered * covered;
    // The k-th within-cap neighbour is settled once it is inside the scanned
    // region; past the cap no within-cap neighbour can remain unscanned.
    const kSettled = k === 0
      || (topN === k && topDSq[k - 1] <= coveredSq)
      || covered >= maxLen;
    if (!kSettled) continue;
    // A within-cap neighbour exists → the lifeline is never read; stop.
    if (k > 0 && topN > 0) break;
    // Otherwise keep widening until the global-nearest lifeline is provably
    // found (its bucket is scanned no later than covered² ≥ its distance).
    if (hasLifeline && lifelineDSq <= coveredSq) break;
  }

  const addedEdges: NeighborEdge[] = [];
  if (topN === 0) {
    // rim outlier: one lifeline edge to the globally nearest, ignoring cap
    if (hasLifeline) {
      const e = addEdge(graph, cellId, lifelineId, Math.sqrt(lifelineDSq));
      if (e) addedEdges.push(e);
    } else if (!graph.adjacency.has(cellId)) publish(graph, cellId, new Set());
    return { addedEdges };
  }
  for (let m = 0; m < topN; m += 1) {
    const e = addEdge(graph, cellId, topId[m], Math.sqrt(topDSq[m]));
    if (e) addedEdges.push(e);
  }
  return { addedEdges };
}

export function removeCell(
  graph: MutableNeighborGraph,
  cellId: number,
): { removedEdgeKeys: string[] } {
  return removeCells(graph, [cellId])[0] ?? { removedEdgeKeys: [] };
}

export interface RemovedCellEdges {
  removedEdgeKeys: string[];
}

/**
 * Remove one lifecycle batch in O(removed degrees) on the adjacency.
 *
 * Results retain `cellIds` order. Adjacency is detached in that same order, so
 * when both endpoints of one edge disappear in a batch the first Cell owns the
 * returned edge key exactly as repeated `removeCell` calls did. Where the
 * graph carries a dense edge list it is compacted once, after every adjacency
 * change (O(graph edges) — which is why the display graph carries none).
 */
export function removeCells(
  graph: MutableNeighborGraph,
  cellIds: readonly number[],
): RemovedCellEdges[] {
  if (cellIds.length === 0) return [];

  const removedIds = new Set<number>();
  const removals: RemovedCellEdges[] = [];
  let removedAnyEdge = false;

  for (const cellId of cellIds) {
    const nbrs = graph.adjacency.get(cellId);
    const removedEdgeKeys: string[] = [];
    if (nbrs) {
      for (const neighbourId of nbrs) {
        const theirs = graph.adjacency.get(neighbourId);
        if (theirs !== undefined && theirs.has(cellId)) {
          // Copy on write: the neighbour's published Set is replaced, never
          // edited — see the module invariant.
          const next = new Set(theirs);
          next.delete(cellId);
          publish(graph, neighbourId, next);
        }
        removedEdgeKeys.push(fabricEdgeKey(cellId, neighbourId));
      }
      publish(graph, cellId, undefined);
    }
    if (removedEdgeKeys.length > 0) removedAnyEdge = true;
    removedIds.add(cellId);
    removals.push({ removedEdgeKeys });
  }

  if (removedAnyEdge && graph.edges !== undefined) {
    graph.edges = graph.edges.filter(
      (edge) => !removedIds.has(edge.from) && !removedIds.has(edge.to),
    );
  }

  return removals;
}
