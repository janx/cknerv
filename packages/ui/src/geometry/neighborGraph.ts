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

import type { Cell } from '@cknerv/types';
import { buildArborForest } from './arborForest';

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

/** Side length (world units) of one cell in the spatial-hash grid
 *  used to accelerate the k-NN search. */
const BUCKET_SIZE = 6;

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

export interface NeighborGraph {
  /** Cell id → set of neighbour cell ids. Symmetric. */
  adjacency: Map<number, Set<number>>;
  /** Deduplicated edge list, canonical (from < to). */
  edges: NeighborEdge[];
}

export interface NeighborGraphOptions {
  k?: number;
  maxEdgeLength?: number;
}

export function emptyNeighborGraph(): NeighborGraph {
  return { adjacency: new Map(), edges: [] };
}

function distSq(a: Cell, b: Cell): number {
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
  byId: ReadonlyMap<number, Cell>,
): NeighborEdge {
  const a = byId.get(aId)!;
  const b = byId.get(bId)!;
  const lo = aId < bId ? aId : bId;
  const hi = aId < bId ? bId : aId;
  return { from: lo, to: hi, d: Math.sqrt(distSq(a, b)) };
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
  cells: ReadonlyMap<number, Cell>,
  optionsOrK: NeighborGraphOptions | number = DEFAULT_K,
): NeighborGraph {
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
  const cellArr = [...cells.values()].filter((c) => c.death_at_ms == null);
  const n = cellArr.length;
  if (n === 0) return emptyNeighborGraph();
  if (n === 1) {
    return { adjacency: new Map([[cellArr[0].id, new Set()]]), edges: [] };
  }

  const byId = new Map<number, Cell>(cellArr.map((c) => [c.id, c]));

  // Pre-allocated parallel scratch buffers for top-k. Avoids the
  // per-iteration object alloc that the previous implementation hit
  // ~N²/k times.
  const SCRATCH_CAP = Math.max(64, k * 16);
  const scratchId = new Int32Array(SCRATCH_CAP);
  const scratchDSq = new Float32Array(SCRATCH_CAP);

  // 2D spatial-hash bucketing cells by xz coords. k-NN scans only the
  // 9-bucket neighbourhood per cell. Numeric key avoids per-cell and
  // per-bucket-scan string allocations.
  const buckets = new Map<number, Cell[]>();
  for (const c of cellArr) {
    const bx = Math.floor(c.pos_seed[0] / BUCKET_SIZE);
    const bz = Math.floor(c.pos_seed[2] / BUCKET_SIZE);
    const key = bucketKeyNum(bx, bz);
    let arr = buckets.get(key);
    if (!arr) { arr = []; buckets.set(key, arr); }
    arr.push(c);
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

  for (let i = 0; i < cellArr.length; i++) {
    const a = cellArr[i];
    const bx = Math.floor(a.pos_seed[0] / BUCKET_SIZE);
    const bz = Math.floor(a.pos_seed[2] / BUCKET_SIZE);

    // Collect candidates from bucket + neighbours, expanding radius
    // if we don't see enough yet.
    let candidateCount = 0;
    let radius = 1;
    while (candidateCount < k + 1 && radius <= 16) {
      candidateCount = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const arr = buckets.get(bucketKeyNum(bx + dx, bz + dz));
          if (!arr) continue;
          for (const c of arr) {
            if (c.id === a.id) continue;
            if (candidateCount >= SCRATCH_CAP) {
              candidateCount = SCRATCH_CAP;
              break;
            }
            scratchId[candidateCount] = c.id;
            scratchDSq[candidateCount] = distSq(a, c);
            candidateCount += 1;
          }
        }
      }
      if (candidateCount >= k + 1) break;
      radius += 1;
    }
    if (candidateCount === 0) {
      // Isolated cell still needs an entry so consumers can reason
      // about "this cell exists but has no neighbours."
      adjOf(a.id);
      continue;
    }

    // Partial selection sort: pull the k smallest dSq's to the front.
    // For k=3 and ~30 candidates this is faster than a full sort.
    const take = Math.min(k, candidateCount);
    for (let m = 0; m < take; m++) {
      let bestIdx = m;
      let bestDSq = scratchDSq[m];
      for (let j = m + 1; j < candidateCount; j++) {
        if (scratchDSq[j] < bestDSq) {
          bestDSq = scratchDSq[j];
          bestIdx = j;
        }
      }
      if (bestIdx !== m) {
        const tmpId = scratchId[m];
        const tmpD = scratchDSq[m];
        scratchId[m] = scratchId[bestIdx];
        scratchDSq[m] = scratchDSq[bestIdx];
        scratchId[bestIdx] = tmpId;
        scratchDSq[bestIdx] = tmpD;
      }
      const otherId = scratchId[m];
      // Drop edges longer than the cap — these are halo outliers
      // that would render as long curves through the empty rim.
      const d = Math.sqrt(scratchDSq[m]);
      if (d > maxEdgeLength) continue;
      addEdge(a.id, otherId, d);
    }
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
    }
    if (bestId < 0) continue;
    const d = Math.sqrt(bestDSq);
    addEdge(a.id, bestId, d);
  }

  // 3. Component stitch. Degree≥1 is not enough for the init view:
  // two dense but far-apart clusters can both look locally healthy
  // while the whole field is still disconnected. Add one nearest-pair
  // bridge from each remaining component into the connected set.
  const unvisited = new Set<number>(cellArr.map((c) => c.id));
  const components: number[][] = [];
  while (unvisited.size > 0) {
    const start = unvisited.values().next().value as number;
    const component: number[] = [];
    const queue = [start];
    unvisited.delete(start);
    while (queue.length > 0) {
      const id = queue.shift()!;
      component.push(id);
      for (const nb of adjacency.get(id) ?? []) {
        if (!unvisited.has(nb)) continue;
        unvisited.delete(nb);
        queue.push(nb);
      }
    }
    components.push(component);
  }

  if (components.length > 1) {
    components.sort((a, b) => b.length - a.length || minId(a) - minId(b));
    const stitched = new Set<number>(components[0]);
    for (const component of components.slice(1)) {
      let bestFrom = -1;
      let bestTo = -1;
      let bestDSq = Infinity;
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
        }
      }
      if (bestFrom >= 0 && bestTo >= 0) {
        addEdge(bestFrom, bestTo, Math.sqrt(bestDSq));
      }
      for (const id of component) stitched.add(id);
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
  for (const c of cellArr) {
    if (visited.has(c.id)) continue;
    visited.add(c.id);
    queue.length = 0;
    queue.push(c.id);
    for (let q = 0; q < queue.length; q++) {
      const id = queue[q];
      const origin = byId.get(id)!;
      const neighbours = [...(adjacency.get(id) ?? [])]
        .filter((nb) => !visited.has(nb))
        .sort((a, b) => {
          const da = distSq(origin, byId.get(a)!);
          const db = distSq(origin, byId.get(b)!);
          return da - db || a - b;
        });
      for (const nb of neighbours) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        queue.push(nb);
        const key = edgeKey(id, nb);
        skeletonKeys.add(key);
        skeletonEdges.push(edgeFromIds(id, nb, byId));
      }
    }
  }

  const denseEdges = edges
    .filter((e) => !skeletonKeys.has(edgeKey(e.from, e.to)))
    .sort((a, b) => a.d - b.d || a.from - b.from || a.to - b.to);
  const finalEdges = [...skeletonEdges, ...denseEdges];

  // Grown-arbor VISUAL overlay: weight the spanning-forest edges by subtree
  // size so the fabric's brightness hierarchy reads as real trunks→twigs.
  // Derives only — adjacency/connectivity above are already final.
  const arborWeights = buildArborForest(byId, adjacency);
  for (const e of finalEdges) {
    const w = arborWeights.get(`${e.from}:${e.to}`);
    if (w !== undefined) e.w = w;
  }
  return { adjacency, edges: finalEdges };
}
