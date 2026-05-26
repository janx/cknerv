// Path finding through the spatial neighbour graph. A pulse travels
// hop-by-hop from a source cell to a target cell along the graph's
// edges. We use plain BFS — every edge has unit weight (we only care
// about hop count, not Euclidean distance), capped at MAX_HOPS so a
// pulse from one halo edge to the other doesn't grind the visual.

import type { NeighborGraph } from './neighborGraph';

/** Maximum hops a pulse will travel. Has to be high enough that
 *  paths spanning the disc — from one spiral arm to the opposite —
 *  can complete; the cell field in galaxy shape has its hub-and-
 *  spoke topology centred in the dense core, so short hop caps
 *  trap every successful pulse near the centre. 40 covers ~75% of
 *  random source/target pairs in a 1500-cell field; pulses past
 *  that get dropped, which is rarer than the previous limit. */
export const DEFAULT_MAX_HOPS = 40;

/**
 * Shortest hop-count path from `source` to `target` through the
 * neighbour graph. Returns null if no path exists within `maxHops`,
 * or if either endpoint is missing from the graph.
 *
 * Path includes both endpoints, so a direct neighbour pair returns
 * `[source, target]` of length 2 (= 1 hop).
 */
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
