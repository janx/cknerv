import { fabricEdgeSeed } from './edgeBezier';
import type { NeighborEdge, NeighborGraph } from './neighborGraph';

/** Dense k-NN links are useful for routing, but drawing every one makes a
 * large field read as uniform synthetic hair. The passive layer keeps one
 * connected skeleton, carrying arbor branches and a small deterministic
 * sample of local cross-links. */
export const PASSIVE_CROSSLINK_FRACTION = 0.08;
/** Only the actual arbor's carrying branches join the connected skeleton.
 * Its low-weight terminal twigs duplicate the skeleton without adding form. */
export const PASSIVE_ARBOR_WEIGHT_MIN = 0.18;

function edgeKey(edge: NeighborEdge): string {
  return `${edge.from}:${edge.to}`;
}

function sampledCrosslink(edge: NeighborEdge, fraction: number): boolean {
  if (fraction <= 0) return false;
  if (fraction >= 1) return true;
  return fabricEdgeSeed(edge.from, edge.to) / 0xffff_ffff < fraction;
}

/**
 * Derive a sparse passive rendering graph without changing the authoritative
 * routing graph. `buildNeighborGraph` guarantees that its first N-1 edges are
 * a connected skeleton; high-weight arbor edges add its independently grown
 * carrying hierarchy. The remaining local k-NN edges are visual texture, so
 * only a stable hash sample survives.
 */
export function buildPassiveNeighborGraph(
  graph: NeighborGraph,
  crosslinkFraction = PASSIVE_CROSSLINK_FRACTION,
): NeighborGraph {
  const nodeCount = graph.adjacency.size;
  if (nodeCount <= 1 || graph.edges.length === 0) {
    return {
      adjacency: new Map(
        [...graph.adjacency.keys()].map((id) => [id, new Set<number>()]),
      ),
      edges: [],
    };
  }

  const skeletonCount = Math.min(nodeCount - 1, graph.edges.length);
  const kept: NeighborEdge[] = [];
  const keptKeys = new Set<string>();
  const keep = (edge: NeighborEdge) => {
    const key = edgeKey(edge);
    if (keptKeys.has(key)) return;
    keptKeys.add(key);
    kept.push(edge);
  };

  for (let i = 0; i < skeletonCount; i += 1) keep(graph.edges[i]);
  for (let i = skeletonCount; i < graph.edges.length; i += 1) {
    const edge = graph.edges[i];
    if (
      (edge.w !== undefined && edge.w >= PASSIVE_ARBOR_WEIGHT_MIN)
      || sampledCrosslink(edge, crosslinkFraction)
    ) {
      keep(edge);
    }
  }

  const adjacency = new Map<number, Set<number>>();
  for (const id of graph.adjacency.keys()) adjacency.set(id, new Set());
  for (const edge of kept) {
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }
  return { adjacency, edges: kept };
}
