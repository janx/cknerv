// Path finding through the spatial neighbour graph. A pulse travels
// hop-by-hop from a source cell to a target cell along the graph's
// edges. We use plain BFS — every edge has unit weight (we only care
// about hop count, not Euclidean distance), capped at MAX_HOPS so a
// pulse from one halo edge to the other doesn't grind the visual.

import { FIELD_HALF_X, FIELD_HALF_Z } from '../helix';
import type { NeighborGraph } from './neighborGraph';

/** Maximum hops a pulse will travel. Has to be high enough that
 *  paths spanning distant tissue lobes can complete; short hop caps
 *  trap successful pulses inside one local cluster.
 *
 *  This is a REACH budget spent in a currency the router cannot see:
 *  BFS weights every edge as one hop regardless of its length, so the
 *  world distance a budget buys is set entirely by how long the fabric's
 *  edges are. The fabric's k-NN search used to answer from a truncated,
 *  direction-biased slice of each neighbourhood, which made its edges
 *  ~2.9x longer than the true nearest neighbours; 40 hops was calibrated
 *  against those. With the search corrected the same 40 hops reach a
 *  third as far, and pulses that used to arrive now die in flight.
 *
 *  Measured on the corrected graph over random source/target pairs, at
 *  the 12,000-Cell stage and the 50,000-Cell reservoir:
 *
 *    maxHops    40      60      80
 *    12,000   96.4%  100.0%  100.0%
 *    50,000   70.0%   99.3%  100.0%
 *
 *  80 is the first value that completes every pair at both populations,
 *  and it matches the measured hop inflation (median 11 -> 23 hops at
 *  12,000, 15 -> 28 at 50,000) rather than merely covering it. A failed
 *  route costs the same BFS either way — the frontier empties on the
 *  graph, not on the cap. */
export const DEFAULT_MAX_HOPS = 80;

/**
 * Shortest hop-count path from `source` to `target` through the
 * neighbour graph. Returns null if no path exists within `maxHops`,
 * or if either endpoint is missing from the graph.
 *
 * Path includes both endpoints, so a direct neighbour pair returns
 * `[source, target]` of length 2 (= 1 hop).
 */
/**
 * Shortest paths from one `source` to EVERY requested target in a single BFS
 * traversal. Byte-identical per-target results to calling `shortestPath` once
 * per target — the expansion order (and therefore each first-discovery parent
 * chain) does not depend on the target set — but the frontier is walked once
 * instead of once per target, which is what a multi-output tx costs today.
 * Unreachable / missing / beyond-maxHops targets are simply absent from the
 * returned map. Stops as soon as every reachable requested target is found.
 */
export function shortestPathsToTargets(
  graph: NeighborGraph,
  source: number,
  targets: readonly number[],
  maxHops: number = DEFAULT_MAX_HOPS,
): Map<number, number[]> {
  const found = new Map<number, number[]>();
  const remaining = new Set<number>();
  for (const target of targets) {
    if (target === source) {
      found.set(target, [source]);
      continue;
    }
    if (graph.adjacency.has(target)) remaining.add(target);
  }
  if (!graph.adjacency.has(source) || remaining.size === 0) return found;

  const visited = new Set<number>([source]);
  const parent = new Map<number, number>();
  let frontier: number[] = [source];
  for (let depth = 0; depth < maxHops; depth++) {
    const next: number[] = [];
    for (const cur of frontier) {
      const neighbours = graph.adjacency.get(cur);
      if (!neighbours) continue;
      for (const nb of neighbours) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        parent.set(nb, cur);
        if (remaining.delete(nb)) {
          const path = [nb];
          let walk: number | undefined = nb;
          while (walk !== undefined && walk !== source) {
            walk = parent.get(walk);
            if (walk !== undefined) path.push(walk);
          }
          path.reverse();
          found.set(nb, path);
          if (remaining.size === 0) return found;
        }
        next.push(nb);
      }
    }
    if (next.length === 0) return found;
    frontier = next;
  }
  return found;
}

// ── rescue-origin selection (block-guarantee pulses) ─────────────────
//
// When every link of a non-empty block dropped, the rescue pass fires one
// pulse for the block's best link — but the honest origin may not exist
// anywhere in the system (a spend of coins born before the retained
// window). Instead of picking an origin point and praying a route exists,
// selection is DST-ROOTED: BFS outward from the destination and pick the
// reachable node that maximizes a caller-supplied score. Every hop of the
// returned path is a real adjacency edge by construction, which is what
// survives the frame loop's per-hop edge gate.

/** Hop ceiling for rescue routes. Deliberately below DEFAULT_MAX_HOPS: a
 *  rescue pulse is one deliberate inbound flow, not a cascade — ~48 hops
 *  ≈ 1.6 s at HOP_MS_BASE. Held at 0.6 of DEFAULT_MAX_HOPS across the
 *  fabric's rescale, so the rescue keeps reaching the same distance into
 *  the tissue that it was tuned to reach. */
export const RESCUE_MAX_HOPS = 48;

/** Prefer origins at least this many hops out when any exist, so the
 *  travel reads as an arrival rather than a twitch beside the newborn.
 *  Distance is the point, so this rides the fabric's scale too: 3 hops
 *  spanned ~16 world units on the old long-edged graph and would span
 *  ~6 on the corrected one. */
export const RESCUE_MIN_HOPS = 6;

/** Minimal position shape the rescue scores need. Both `Cell` and
 *  `NeighborGraphCell` satisfy it structurally. */
export interface RescuePositioned {
  pos_seed: readonly [number, number, number];
}

export interface RescueOriginOptions {
  maxHops?: number;
  minHops?: number;
  /** Nodes failing this predicate are neither origins NOR intermediate
   *  hops — the BFS refuses to traverse them. The renderer's per-hop gate
   *  extinguishes a pulse whose hop endpoints are missing from the cells
   *  map, so the caller passes cells-membership here and the whole path is
   *  renderable at plan time by construction. */
  valid?: (id: number) => boolean;
}

/**
 * BFS outward from `dst`, score every reachable valid node, and return the
 * highest-scoring origin's tree path `origin → … → dst`. Nodes at least
 * `minHops` out are preferred as a set (when any exist) even over a
 * higher-scoring closer node. Returns null when `dst` is absent from the
 * graph or no valid node is reachable from it.
 *
 * Deterministic for a given graph CONTENT regardless of adjacency-set
 * insertion order: equal scores break toward the lower node id.
 */
export function rescueOrigin(
  graph: NeighborGraph,
  dst: number,
  score: (id: number) => number,
  options: RescueOriginOptions = {},
): number[] | null {
  const maxHops = options.maxHops ?? RESCUE_MAX_HOPS;
  const minHops = options.minHops ?? RESCUE_MIN_HOPS;
  const valid = options.valid;
  if (!graph.adjacency.has(dst)) return null;

  // parent.get(n) = the neighbour one hop closer to dst, so the origin's
  // parent chain IS the pulse path in travel order — no reverse needed.
  const parent = new Map<number, number>();
  const visited = new Set<number>([dst]);
  let frontier: number[] = [dst];
  let bestAny = -1;
  let bestAnyScore = Number.NEGATIVE_INFINITY;
  let bestFar = -1;
  let bestFarScore = Number.NEGATIVE_INFINITY;
  for (let depth = 1; depth <= maxHops; depth++) {
    const next: number[] = [];
    for (const cur of frontier) {
      const neighbours = graph.adjacency.get(cur);
      if (!neighbours) continue;
      for (const nb of neighbours) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        if (valid && !valid(nb)) continue; // never traverse THROUGH it either
        parent.set(nb, cur);
        next.push(nb);
        const s = score(nb);
        if (s > bestAnyScore || (s === bestAnyScore && nb < bestAny)) {
          bestAny = nb;
          bestAnyScore = s;
        }
        if (
          depth >= minHops
          && (s > bestFarScore || (s === bestFarScore && nb < bestFar))
        ) {
          bestFar = nb;
          bestFarScore = s;
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  const origin = bestFar !== -1 ? bestFar : bestAny;
  if (origin === -1) return null;

  const path = [origin];
  let walk: number | undefined = origin;
  while (walk !== undefined && walk !== dst) {
    walk = parent.get(walk);
    if (walk !== undefined) path.push(walk);
  }
  return path;
}

/**
 * L2 rim-entry score: prefer the most rim-ward node in the destination's
 * outward radial direction. Radial fraction is measured on the tissue
 * ellipse (`FIELD_HALF_X/Z` — the helix module is the sole rim authority),
 * alignment as the cosine against dst's outward radial, floored at 0 so
 * opposite-side rim nodes score as mere mid-field:
 *
 *   score(n) = rf(n) × (0.5 + 0.5 · max(0, cos(θ(n) − θ(dst))))
 *
 * A dst at the exact ellipse centre has no radial; score degrades to rf.
 */
export function rimEntryScore(
  cells: ReadonlyMap<number, RescuePositioned>,
  dstId: number,
): (id: number) => number {
  let dirX = 0;
  let dirZ = 0;
  const dst = cells.get(dstId);
  if (dst) {
    const ex = dst.pos_seed[0] / FIELD_HALF_X;
    const ez = dst.pos_seed[2] / FIELD_HALF_Z;
    const len = Math.hypot(ex, ez);
    if (len > 1e-9) {
      dirX = ex / len;
      dirZ = ez / len;
    }
  }
  const hasDir = dirX !== 0 || dirZ !== 0;
  return (id) => {
    const cell = cells.get(id);
    if (!cell) return Number.NEGATIVE_INFINITY;
    const ex = cell.pos_seed[0] / FIELD_HALF_X;
    const ez = cell.pos_seed[2] / FIELD_HALF_Z;
    const rf = Math.hypot(ex, ez);
    if (rf < 1e-9 || !hasDir) return rf;
    const cos = (ex * dirX + ez * dirZ) / rf;
    return rf * (0.5 + 0.5 * Math.max(0, cos));
  };
}

/**
 * L1 anchored score: prefer the node nearest a link's input anchor — the
 * true position of the consumed coin (`endpoint_anchors` carries its
 * `pos_seed` even after the cell left every client map).
 */
export function anchorProximityScore(
  cells: ReadonlyMap<number, RescuePositioned>,
  anchorPos: readonly [number, number, number],
): (id: number) => number {
  return (id) => {
    const cell = cells.get(id);
    if (!cell) return Number.NEGATIVE_INFINITY;
    const dx = cell.pos_seed[0] - anchorPos[0];
    const dy = cell.pos_seed[1] - anchorPos[1];
    const dz = cell.pos_seed[2] - anchorPos[2];
    return -(dx * dx + dy * dy + dz * dz);
  };
}

/**
 * Defensive fallback for the rescue destination: the in-graph cell nearest
 * a position (a newborn's output anchor). Only consulted when none of a
 * link's `to_ids` made it into the graph — the pulse then lands beside the
 * newborn's true position instead of nowhere. Degree-0 nodes are skipped
 * (the live graph really holds them after death pruning; an isolated
 * destination would fail the whole rescue while a connected node sits
 * marginally farther). Ties break toward the lower id. Returns null on an
 * empty graph.
 */
export function nearestGraphNode(
  cells: ReadonlyMap<number, RescuePositioned>,
  graph: NeighborGraph,
  pos: readonly [number, number, number],
): number | null {
  let best = -1;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const [id, neighbours] of graph.adjacency) {
    if (neighbours.size === 0) continue;
    const cell = cells.get(id);
    if (!cell) continue;
    const dx = cell.pos_seed[0] - pos[0];
    const dy = cell.pos_seed[1] - pos[1];
    const dz = cell.pos_seed[2] - pos[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestDistSq || (d === bestDistSq && id < best)) {
      best = id;
      bestDistSq = d;
    }
  }
  return best === -1 ? null : best;
}

export function shortestPath(
  graph: NeighborGraph,
  source: number,
  target: number,
  maxHops: number = DEFAULT_MAX_HOPS,
): number[] | null {
  if (source === target) return [source];
  if (!graph.adjacency.has(source) || !graph.adjacency.has(target)) {
    return null;
  }

  // Standard BFS with a parent map so we can reconstruct the path.
  const visited = new Set<number>([source]);
  const parent = new Map<number, number>();
  let frontier: number[] = [source];
  for (let depth = 0; depth < maxHops; depth++) {
    const next: number[] = [];
    for (const cur of frontier) {
      const neighbours = graph.adjacency.get(cur);
      if (!neighbours) continue;
      for (const nb of neighbours) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        parent.set(nb, cur);
        if (nb === target) {
          // Reconstruct path target → source then reverse.
          const path = [target];
          let walk: number | undefined = target;
          while (walk !== undefined && walk !== source) {
            walk = parent.get(walk);
            if (walk !== undefined) path.push(walk);
          }
          path.reverse();
          return path;
        }
        next.push(nb);
      }
    }
    if (next.length === 0) return null;
    frontier = next;
  }
  return null;
}
