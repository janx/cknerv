// Spatial k-NN neighbour graph over the cells field. Pure module —
// the renderer + pulse router both consume the result.
//
// Rule: an edge exists between two cells iff one is among the other's
// k spatial-nearest cells (or vice-versa, since the relation is
// asymmetric). k-NN candidates longer than MAX_EDGE_LENGTH are
// dropped, which leaves halo outliers with no edges at all. A
// lifeline pass guarantees every cell ends with ≥1 edge, then a
// component-stitch pass adds the minimum extra long fibres needed to
// make the whole field one connected neural network.

import { buildArborForestSteps } from './arborForest';

/** Default k for the nearest-neighbour query. k=4 gives the main
 *  galaxy disc generous local connectivity while still feeling
 *  sparse — every interior cell ends up with ~6-8 unique edges
 *  after symmetry merging. */
export const DEFAULT_K = 4;

/** Maximum chord length (world units) for a k-NN edge to be kept.
 *  Edges longer than this are dropped — they're almost always halo
 *  outliers, and rendering them as long curves crossing the empty
 *  rim of the disc makes the graph look like cables in space rather
 *  than neural tissue. Long lifeline/component-stitch edges are added
 *  later as sparse exceptions so every cell remains reachable. */
const MAX_EDGE_LENGTH = 25;

/** Target occupancy of one spatial-hash bucket, in cells.
 *
 *  The bucket side is derived from this and the field's measured density
 *  rather than fixed, because a fixed side makes the search cost scale
 *  with the FIELD's density instead of with `k`: at a 6-unit side the
 *  12,000-cell galaxy puts a median of 623 cells in the 3x3 neighbourhood
 *  a k=5 query has to look at, and the 50,000-cell reservoir puts ~2,600
 *  there. Sizing the bucket so a 3x3 neighbourhood holds ~9x this many
 *  keeps the scan proportional to k at every population.
 *
 *  It is a COST knob only. The search below expands its ring until the
 *  k-th distance is provably inside the scanned region, so the graph it
 *  returns is the same graph for any bucket side — which is asserted
 *  directly in the tests. */
const BUCKET_TARGET_OCCUPANCY = 4;

/** Upper bound on bucket-grid coordinates, from {@link bucketKeyNum}'s
 *  packing. The derived side is floored so the field cannot exceed it. */
const BUCKET_COORD_LIMIT = 8000;

/** Edge between two cell ids. Canonical order: from < to. */
export interface NeighborEdge {
  from: number;
  to: number;
  /** Euclidean distance (xz primary, y is small Gaussian). */
  d: number;
  /** Arbor "trunkness" ∈ (0,1] when this edge is part of the grown spanning
   *  forest (weight = normalized subtree size); `undefined` for the extra
   *  cross-link edges (rendered at the twig floor). Purely a VISUAL hierarchy
   *  hint — connectivity/routing ignore it. */
  w?: number;
}

/** The routing view of a graph: cell id → set of neighbour cell ids,
 *  symmetric. Every route search, entry index, mesh diff and recall reads
 *  exactly this and nothing more.
 *
 *  INVARIANT (copy on write): a `Set` instance sitting in `adjacency` is
 *  never edited in place — a change REPLACES the instance — so across the
 *  whole system "same Set instance" means "same neighbours, same order".
 *  The route search's per-node neighbour cache (`pathRouter.ts`) keys on
 *  exactly that. */
export interface NeighborAdjacency {
  adjacency: Map<number, Set<number>>;
}

/** Adjacency plus the dense edge list with distances and arbor weights:
 *  what the builder produces and what the passive selection is drawn from. */
export interface NeighborGraph extends NeighborAdjacency {
  /** Deduplicated edge list, canonical (from < to). */
  edges: NeighborEdge[];
}

/** The main thread's display graph. Adjacency only — the worker ships no
 *  edge list for it and nothing on the main thread reads one — plus the undo
 *  log of the eager living mesh (`nerve/incrementalGraph.ts`).
 *
 *  `eagerBase` holds, for every node whose Set the eager mutators replaced
 *  since the last worker apply, the instance that stood there before the
 *  FIRST replacement (`undefined` = the node was absent). A worker patch is
 *  a diff against the worker's previous build, which is this graph as it was
 *  BEFORE those eager edits; so for every node the patch leaves alone the
 *  apply restores the logged instance, then clears the log. That is what
 *  makes an O(churn) patch exact: the eager mesh may disagree with the worker
 *  on an equal-distance tie-break, or retract a death the worker has not
 *  heard of yet, and without the log such a node would keep an edge the
 *  authoritative build does not have. */
export interface LivingNeighborGraph extends NeighborAdjacency {
  eagerBase: Map<number, Set<number> | undefined>;
}

export function emptyLivingNeighborGraph(): LivingNeighborGraph {
  return { adjacency: new Map(), eagerBase: new Map() };
}

/** The main thread's passive graph: the DRAWN edge list and nothing else.
 *  Every reader of it there — the fabric diff and its trunk tier, the
 *  bridges' host degrees, the periodic stray prune, the continuity
 *  preference — reads `edges`; none reads an adjacency, so the worker ships
 *  none and none is built. (`buildPassiveNeighborGraph` still returns a whole
 *  `NeighborGraph`, which is one of these by structure — the synchronous
 *  fallback hands it over as is.)
 *
 *  INVARIANT (canonical order): `edges` is sorted by `from`, then `to`, and
 *  holds each key once — the order the worker's selection emits and the
 *  order the fabric admits a whole selection in (slot order, cohort
 *  stagger). A chained build patches the list IN PLACE as a sorted merge,
 *  so the order survives every build; a whole list is validated on arrival.
 *
 *  INVARIANT (records are values): a `NeighborEdge` in `edges` is never
 *  edited — a build that moves an edge's distance or weight REPLACES the
 *  record. The fabric's deferred cohorts keep a record across builds and
 *  read, at admission, the weight it was queued with. */
export interface PassiveSelection {
  edges: NeighborEdge[];
}

export function emptyPassiveSelection(): PassiveSelection {
  return { edges: [] };
}

export interface NeighborGraphOptions {
  k?: number;
  maxEdgeLength?: number;
}

/** Minimal Cell shape required by topology construction. Keeping this seam
 * compact lets the browser Worker reconstruct only id/lifecycle/position
 * data instead of cloning complete Cell payloads across threads. */
export interface NeighborGraphCell {
  id: number;
  death_at_ms: number | null;
  pos_seed: readonly [number, number, number];
}

/** Stable source surface shared by readonly Maps and immutable Cell arrays. */
export interface NeighborGraphCells {
  values(): IterableIterator<NeighborGraphCell>;
}

export function emptyNeighborGraph(): NeighborGraph {
  return { adjacency: new Map(), edges: [] };
}

function distSq(a: NeighborGraphCell, b: NeighborGraphCell): number {
  const dx = a.pos_seed[0] - b.pos_seed[0];
  const dy = a.pos_seed[1] - b.pos_seed[1];
  const dz = a.pos_seed[2] - b.pos_seed[2];
  return dx * dx + dy * dy + dz * dz;
}

function minId(ids: number[]): number {
  let min = Infinity;
  for (const id of ids) {
    if (id < min) min = id;
  }
  return min;
}

function edgeKey(a: number, b: number): string {
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  return `${lo}:${hi}`;
}

function edgeFromIds(
  aId: number,
  bId: number,
  byId: ReadonlyMap<number, NeighborGraphCell>,
): NeighborEdge {
  const a = byId.get(aId)!;
  const b = byId.get(bId)!;
  const lo = aId < bId ? aId : bId;
  const hi = aId < bId ? bId : aId;
  return { from: lo, to: hi, d: Math.sqrt(distSq(a, b)) };
}

/** Stable resumable equivalent of Array.sort for recovery. */
function* stableSortSteps<T>(
  values: T[],
  compare: (a: T, b: T) => number,
): Generator<void, T[], void> {
  const scratch = new Array<T>(values.length);
  let moves = 0;
  for (let width = 1; width < values.length; width *= 2) {
    for (let left = 0; left < values.length; left += width * 2) {
      const mid = Math.min(left + width, values.length);
      const end = Math.min(left + width * 2, values.length);
      let a = left;
      let b = mid;
      for (let out = left; out < end; out += 1) {
        scratch[out] = b >= end || (a < mid && compare(values[a], values[b]) <= 0)
          ? values[a++] : values[b++];
        moves += 1;
        if ((moves & 63) === 0) yield;
      }
    }
    for (let index = 0; index < values.length; index += 1) {
      values[index] = scratch[index];
      moves += 1;
      if ((moves & 63) === 0) yield;
    }
  }
  return values;
}

/** Pack two integer bucket coords (after bucket-size division) into one
 *  number for use as a Map key. The previous string-key formulation
 *  (`${bx}\x00${bz}`) showed up as a hot allocation in profiling
 *  (~13k strings per buildNeighborGraph at N≈1500 due to the 9-bucket
 *  scan inside the per-cell loop). The pack assumes |bucket coord| <
 *  16384, which holds for any plausible galaxy size. */
function bucketKeyNum(bx: number, bz: number): number {
  return ((bx + 16384) << 16) | (bz + 16384);
}

/**
 * Build the spatial neighbour graph over a snapshot of cells.
 *
 *  1. For each cell, find the `k` nearest other cells (Euclidean).
 *  2. Add each pair as an undirected edge (deduplicated via the
 *     adjacency Set; no separate edgeMap needed).
 *  3. Add sparse long lifeline/component-stitch edges so all cells form
 *     one connected graph.
 *
 * O(N²) per call worst case; in practice the spatial-hash bucket scan
 * keeps it close to O(N · k). Callers should rebuild only when the
 * cell SET (membership) actually changes — pulse / link / death / tag
 * deltas leave the graph identical.
 */
export function buildNeighborGraph(
  cells: NeighborGraphCells,
  optionsOrK: NeighborGraphOptions | number = DEFAULT_K,
): NeighborGraph {
  const steps = buildNeighborGraphSteps(cells, optionsOrK);
  while (true) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** Canonical builder as a resumable cursor. The synchronous API above drains
 * this exact algorithm; Worker-failure recovery advances it between browser
 * tasks, so the two paths cannot drift in ties, ordering, or 53-bit ids. */
export function* buildNeighborGraphSteps(
  cells: NeighborGraphCells,
  optionsOrK: NeighborGraphOptions | number = DEFAULT_K,
): Generator<void, NeighborGraph, void> {
  const k =
    typeof optionsOrK === 'number'
      ? optionsOrK
      : optionsOrK.k ?? DEFAULT_K;
  const maxEdgeLength =
    typeof optionsOrK === 'number'
      ? MAX_EDGE_LENGTH
      : optionsOrK.maxEdgeLength ?? MAX_EDGE_LENGTH;
  // Dead-but-not-yet-gc'd cells (death_at_ms set, still in the map)
  // must contribute NO adjacency and NO edges: death retracts a cell's
  // fibres, and a later reconciliation rebuild must not resurrect them.
  const cellArr: NeighborGraphCell[] = [];
  let collected = 0;
  for (const cell of cells.values()) {
    if (cell.death_at_ms == null) cellArr.push(cell);
    collected += 1;
    if ((collected & 63) === 0) yield;
  }
  // Build in id order, not Map-insertion order. The k-NN adjacency is already
  // order-invariant (top-k ranks by (dSq, id)), but the render-priority BFS
  // skeleton's root pick, the lifeline/component-stitch tie-breaks, and the
  // output adjacency Map all otherwise inherit the caller's insertion order.
  // Sorting the working list once makes the whole build a pure function of the
  // cell SET, so a full-pack rebuild and a delta-patched worker session grow
  // the SAME tree over the same cells — a topology supersession then applies as
  // a small diff instead of flushing the whole fabric.
  yield* stableSortSteps(cellArr, (a, b) => a.id - b.id);
  const n = cellArr.length;
  if (n === 0) return emptyNeighborGraph();
  if (n === 1) {
    return { adjacency: new Map([[cellArr[0].id, new Set()]]), edges: [] };
  }

  const byId = new Map<number, NeighborGraphCell>();
  for (let index = 0; index < cellArr.length; index += 1) {
    const cell = cellArr[index];
    byId.set(cell.id, cell);
    if ((index & 63) === 63) yield;
  }

  // Bounded top-k, held in two parallel buffers kept sorted ascending by
  // (dSq, id). k is small (3-7 in every caller), so an insertion into a
  // k-slot array beats a heap and allocates nothing per candidate. Ids
  // must be Float64: galaxy-composition Cells carry 2^52-range ids that
  // an Int32Array would wrap into phantom nodes.
  //
  // This REPLACES a fixed 80-slot candidate scratch that the bucket scan
  // filled and then hard-stopped on. That scratch was not a budget, it
  // was a truncation: it took whatever the dx/dz raster reached first,
  // always starting at the same corner, so in the dense core the "k
  // nearest" were the k nearest OF THE SAME RELATIVE DIRECTION, cell
  // after cell. Measured on the 12,000-cell galaxy at k=5, it agreed
  // with the true k nearest 14.0% of the time and left the field with a
  // mean neighbour direction of 0.464 (0 is unbiased) — a fabric that
  // repeated one motif everywhere it was dense and only became honest
  // where the field thinned enough to fit inside 80.
  const topId = new Float64Array(k);
  const topDSq = new Float64Array(k);
  let topN = 0;

  // 2D spatial-hash bucketing cells by xz coords. The side is derived
  // from the field's own extent and count so the scan cost tracks k
  // rather than the population; see BUCKET_TARGET_OCCUPANCY.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of cellArr) {
    const x = c.pos_seed[0];
    const z = c.pos_seed[2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    collected += 1;
    if ((collected & 63) === 0) yield;
  }
  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;
  const extent = Math.max(spanX, spanZ);
  const area = Math.max(spanX, 1e-6) * Math.max(spanZ, 1e-6);
  // Two density readings, and the side takes whichever is coarser.
  //
  // The areal one is the honest estimate for a field that fills a patch.
  // It is NOT enough on its own: a collinear or near-collinear field has
  // an area near zero and would get a side near zero with it, so the ring
  // walk below has to cross thousands of empty buckets to reach a
  // neighbour that is right there. The linear reading is what that field
  // actually costs — spacing along its one occupied dimension — and
  // taking the max means a degenerate field is bucketed by its real
  // spacing while a filled one still gets the areal side.
  const arealSide = Math.sqrt((BUCKET_TARGET_OCCUPANCY * area) / n);
  const linearSide = (BUCKET_TARGET_OCCUPANCY * extent) / n;
  const bucketSize = Math.max(
    arealSide,
    linearSide,
    extent / BUCKET_COORD_LIMIT,
    1e-6,
  );
  // Past this ring every bucket is off the field, so nothing can widen
  // the search further even when maxEdgeLength would allow it.
  const maxRing = Math.ceil(extent / bucketSize) + 1;

  const buckets = new Map<number, NeighborGraphCell[]>();
  for (const c of cellArr) {
    const bx = Math.floor(c.pos_seed[0] / bucketSize);
    const bz = Math.floor(c.pos_seed[2] / bucketSize);
    const key = bucketKeyNum(bx, bz);
    let arr = buckets.get(key);
    if (!arr) { arr = []; buckets.set(key, arr); }
    arr.push(c);
    collected += 1;
    if ((collected & 63) === 0) yield;
  }

  // 1. k-NN per cell against bucket neighbourhood, widening radius
  // when local density is too low. Adjacency is created lazily —
  // pre-populating an empty Set per cell would alloc N×Set objects
  // upfront, most of which the typical k-NN loop fills anyway, so we
  // get them via getOrInit at first use.
  const adjacency = new Map<number, Set<number>>();
  const edges: NeighborEdge[] = [];

  function adjOf(id: number): Set<number> {
    let s = adjacency.get(id);
    if (s === undefined) { s = new Set(); adjacency.set(id, s); }
    return s;
  }

  function addEdge(
    fromId: number,
    toId: number,
    d: number,
  ): boolean {
    if (fromId === toId) return false;
    const fromAdj = adjOf(fromId);
    if (fromAdj.has(toId)) return false;
    const lo = fromId < toId ? fromId : toId;
    const hi = fromId < toId ? toId : fromId;
    edges.push({ from: lo, to: hi, d });
    fromAdj.add(toId);
    adjOf(toId).add(fromId);
    return true;
  }

  /** Offer one candidate to the running top-k. Ordered by (dSq, id): the
   *  id tie-break makes the result independent of Map iteration order,
   *  so the worker and the main thread build the same graph from the
   *  same cells however they happened to accumulate them. */
  function consider(id: number, dSq: number): void {
    if (
      topN === k &&
      (dSq > topDSq[k - 1] || (dSq === topDSq[k - 1] && id > topId[k - 1]))
    ) {
      return;
    }
    let slot = topN < k ? topN : k - 1;
    while (
      slot > 0 &&
      (topDSq[slot - 1] > dSq ||
        (topDSq[slot - 1] === dSq && topId[slot - 1] > id))
    ) {
      topDSq[slot] = topDSq[slot - 1];
      topId[slot] = topId[slot - 1];
      slot -= 1;
    }
    topDSq[slot] = dSq;
    topId[slot] = id;
    if (topN < k) topN += 1;
  }

  for (let i = 0; i < cellArr.length; i++) {
    const a = cellArr[i];
    const bx = Math.floor(a.pos_seed[0] / bucketSize);
    const bz = Math.floor(a.pos_seed[2] / bucketSize);
    topN = 0;

    const scanBucket = function* (gx: number, gz: number): Generator<void, void, void> {
      const arr = buckets.get(bucketKeyNum(gx, gz));
      if (!arr) return;
      for (let m = 0; m < arr.length; m++) {
        const c = arr[m];
        if (c.id === a.id) continue;
        consider(c.id, distSq(a, c));
        if ((m & 63) === 63) yield;
      }
    };

    // Widen a ring at a time until the k-th neighbour found so far is
    // provably nearer than anything still unscanned. Rings 0..r cover
    // every bucket within r*bucketSize of the query in xz, so a point
    // outside them is farther than that in xz and therefore farther in
    // full 3D too — which makes the stop below EXACT rather than a
    // heuristic, and makes the bucket side a pure cost knob.
    for (let ring = 0; ring <= maxRing; ring++) {
      if (ring === 0) {
        yield* scanBucket(bx, bz);
      } else {
        // Perimeter only — the interior was scanned by earlier rings.
        for (let dx = -ring; dx <= ring; dx++) {
          yield* scanBucket(bx + dx, bz - ring);
          yield* scanBucket(bx + dx, bz + ring);
        }
        for (let dz = -ring + 1; dz <= ring - 1; dz++) {
          yield* scanBucket(bx - ring, bz + dz);
          yield* scanBucket(bx + ring, bz + dz);
        }
      }
      const covered = ring * bucketSize;
      if (topN === k && topDSq[k - 1] <= covered * covered) break;
      // Nothing beyond this ring can survive the length cap anyway.
      if (covered >= maxEdgeLength) break;
    }

    if (topN === 0) {
      // Isolated cell still needs an entry so consumers can reason
      // about "this cell exists but has no neighbours."
      adjOf(a.id);
      yield;
      continue;
    }

    for (let m = 0; m < topN; m++) {
      // Drop edges longer than the cap — these are halo outliers
      // that would render as long curves through the empty rim.
      const d = Math.sqrt(topDSq[m]);
      if (d > maxEdgeLength) continue;
      addEdge(a.id, topId[m], d);
    }
    yield;
  }

  // 2. Lifeline pass. After k-NN any cell whose every candidate
  // exceeded MAX_EDGE_LENGTH (halo outliers, the rim of the field)
  // still has empty adjacency. Give each such cell exactly one edge
  // to its globally nearest other cell, ignoring the length cap.
  // Linear scan over cellArr per outlier is cheap because outliers are
  // a few percent of the field and the outer O(N²) factor matches the
  // k-NN bucket scan itself.
  for (let i = 0; i < cellArr.length; i++) {
    const a = cellArr[i];
    const aAdj = adjOf(a.id);
    if (aAdj.size > 0) continue;
    let bestId = -1;
    let bestDSq = Infinity;
    for (let j = 0; j < cellArr.length; j++) {
      if (j === i) continue;
      const dSq = distSq(a, cellArr[j]);
      if (dSq < bestDSq) {
        bestDSq = dSq;
        bestId = cellArr[j].id;
      }
      if ((j & 63) === 63) yield;
    }
    if (bestId < 0) continue;
    const d = Math.sqrt(bestDSq);
    addEdge(a.id, bestId, d);
  }

  // 3. Component stitch. Degree≥1 is not enough for the init view:
  // two dense but far-apart clusters can both look locally healthy
  // while the whole field is still disconnected. Add one nearest-pair
  // bridge from each remaining component into the connected set.
  const unvisited = new Set<number>();
  for (let index = 0; index < cellArr.length; index += 1) {
    unvisited.add(cellArr[index].id);
    if ((index & 63) === 63) yield;
  }
  const components: number[][] = [];
  while (unvisited.size > 0) {
    const start = unvisited.values().next().value as number;
    const component: number[] = [];
    const queue = [start];
    unvisited.delete(start);
    // Cursor traversal keeps this pass linear. Array.shift() moves the whole
    // remaining queue and turns a connected 20K graph into an accidental
    // O(N²) main-thread pause during canonical reconciliation.
    for (let head = 0; head < queue.length; head += 1) {
      const id = queue[head];
      component.push(id);
      for (const nb of adjacency.get(id) ?? []) {
        if (!unvisited.has(nb)) continue;
        unvisited.delete(nb);
        queue.push(nb);
      }
      if ((head & 63) === 63) yield;
    }
    components.push(component);
  }

  if (components.length > 1) {
    yield* stableSortSteps(components, (a, b) => b.length - a.length || minId(a) - minId(b));
    const stitched = new Set<number>();
    for (let index = 0; index < components[0].length; index += 1) {
      stitched.add(components[0][index]);
      if ((index & 63) === 63) yield;
    }
    for (let componentIndex = 1; componentIndex < components.length; componentIndex += 1) {
      const component = components[componentIndex];
      let bestFrom = -1;
      let bestTo = -1;
      let bestDSq = Infinity;
      let comparisons = 0;
      for (const fromId of stitched) {
        const from = byId.get(fromId)!;
        for (const toId of component) {
          const to = byId.get(toId)!;
          const dSq = distSq(from, to);
          if (dSq < bestDSq) {
            bestDSq = dSq;
            bestFrom = fromId;
            bestTo = toId;
          }
          comparisons += 1;
          if ((comparisons & 63) === 0) yield;
        }
      }
      if (bestFrom >= 0 && bestTo >= 0) {
        addEdge(bestFrom, bestTo, Math.sqrt(bestDSq));
      }
      for (let index = 0; index < component.length; index += 1) {
        stitched.add(component[index]);
        if ((index & 63) === 63) yield;
      }
    }
  }

  // 4. Render-priority skeleton. NeuralFabric has a fixed segment cap,
  // so a large graph cannot rely on dense k-NN insertion order: if the
  // renderer only has room for a prefix, that prefix must still touch
  // every cell. Derive a spanning tree from the final adjacency and put
  // it before the dense local extras.
  const skeletonEdges: NeighborEdge[] = [];
  const skeletonKeys = new Set<string>();
  const visited = new Set<number>();
  const queue: number[] = [];
  for (let cellIndex = 0; cellIndex < cellArr.length; cellIndex += 1) {
    const c = cellArr[cellIndex];
    if ((cellIndex & 63) === 63) yield;
    if (visited.has(c.id)) continue;
    visited.add(c.id);
    queue.length = 0;
    queue.push(c.id);
    for (let q = 0; q < queue.length; q++) {
      const id = queue[q];
      const origin = byId.get(id)!;
      const neighbours: number[] = [];
      let neighbourScans = 0;
      for (const nb of adjacency.get(id) ?? []) {
        if (!visited.has(nb)) neighbours.push(nb);
        neighbourScans += 1;
        if ((neighbourScans & 63) === 0) yield;
      }
      yield* stableSortSteps(neighbours, (a, b) => {
        const da = distSq(origin, byId.get(a)!);
        const db = distSq(origin, byId.get(b)!);
        return da - db || a - b;
      });
      for (let neighbourIndex = 0; neighbourIndex < neighbours.length; neighbourIndex += 1) {
        const nb = neighbours[neighbourIndex];
        if ((neighbourIndex & 63) === 63) yield;
        if (visited.has(nb)) continue;
        visited.add(nb);
        queue.push(nb);
        const key = edgeKey(id, nb);
        skeletonKeys.add(key);
        skeletonEdges.push(edgeFromIds(id, nb, byId));
      }
      if ((q & 127) === 127) yield;
    }
  }

  const denseEdges: NeighborEdge[] = [];
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    if (!skeletonKeys.has(edgeKey(edge.from, edge.to))) denseEdges.push(edge);
    if ((index & 63) === 63) yield;
  }
  yield* stableSortSteps(denseEdges, (a, b) => a.d - b.d || a.from - b.from || a.to - b.to);
  const finalEdges: NeighborEdge[] = [];
  for (let index = 0; index < skeletonEdges.length; index += 1) {
    finalEdges.push(skeletonEdges[index]);
    if ((index & 63) === 63) yield;
  }
  for (let index = 0; index < denseEdges.length; index += 1) {
    finalEdges.push(denseEdges[index]);
    if ((index & 63) === 63) yield;
  }

  // Grown-arbor VISUAL overlay: weight the spanning-forest edges by subtree
  // size so the fabric's brightness hierarchy reads as real trunks→twigs.
  // Derives only — adjacency/connectivity above are already final.
  const arborWeights = yield* buildArborForestSteps(byId, adjacency);
  collected = 0;
  for (const e of finalEdges) {
    const w = arborWeights.get(`${e.from}:${e.to}`);
    if (w !== undefined) e.w = w;
    collected += 1;
    if ((collected & 63) === 0) yield;
  }
  return { adjacency, edges: finalEdges };
}
