import { fabricEdgeSeed } from './edgeBezier';
import type { NeighborEdge, NeighborGraph } from './neighborGraph';

/** Hard screen-composition budget. This is large enough for the displayed
 * tissue to read as a neural network, but remains far below the complete k-NN
 * graph that previously collapsed dense views into uniform hair. */
export const PASSIVE_EDGE_BUDGET = 8_000;
/** Keep roughly one resting fibre per visible Cell until the screen cap. */
export const PASSIVE_EDGES_PER_CELL = 1.0;
/** Most screen energy belongs to coherent carrying branches. */
export const PASSIVE_TRUNK_SHARE = 0.72;
/** A minority of lower-order arbor edges break up clean top-weight contours. */
export const PASSIVE_TWIG_SHARE = 0.18;

export interface PassiveNeighborGraphOptions {
  /** Override used by focused diagnostics/tests. Default is derived from N. */
  edgeBudget?: number;
  /** Render the complete routing graph for an explicit diagnostic view. */
  includeAll?: boolean;
  /** Still-valid resting edges from the previous frame. Preserving them turns
   * ordinary Cell churn into local growth instead of a whole-field reshuffle. */
  preferredEdges?: readonly NeighborEdge[];
}

function edgeKey(edge: NeighborEdge): string {
  return `${edge.from}:${edge.to}`;
}

function edgeHash(edge: NeighborEdge): number {
  return fabricEdgeSeed(edge.from, edge.to) / 0xffff_ffff;
}

function canonicalEdgeOrder(a: NeighborEdge, b: NeighborEdge): number {
  return a.from - b.from || a.to - b.to;
}

/** Stable, sub-linear passive-fibre budget for a visible Cell population. */
export function passiveEdgeBudget(nodeCount: number): number {
  if (!Number.isFinite(nodeCount) || nodeCount <= 1) return 0;
  return Math.min(
    PASSIVE_EDGE_BUDGET,
    Math.max(1, Math.round(nodeCount * PASSIVE_EDGES_PER_CELL)),
  );
}

function graphFromEdges(
  graph: NeighborGraph,
  edges: NeighborEdge[],
): NeighborGraph {
  const adjacency = new Map<number, Set<number>>();
  for (const id of graph.adjacency.keys()) adjacency.set(id, new Set());
  for (const edge of edges) {
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }
  return { adjacency, edges };
}

/**
 * Derive the resting biological silhouette without changing authoritative
 * routing. The full graph stays connected for pulse planning; this layer is a
 * bounded arbor drawing and may intentionally leave quiet Cells unconnected.
 *
 * Selection is deterministic and hierarchical:
 *  1. highest-subtree arbor edges form coherent trunks;
 *  2. hash-scattered lower arbor edges form irregular terminal growth;
 *  3. a small hash sample of non-arbor links supplies capillary cross-links.
 */
export function buildPassiveNeighborGraph(
  graph: NeighborGraph,
  options: PassiveNeighborGraphOptions = {},
): NeighborGraph {
  const nodeCount = graph.adjacency.size;
  if (nodeCount <= 1 || graph.edges.length === 0) {
    return graphFromEdges(graph, []);
  }
  if (options.includeAll) {
    return graphFromEdges(graph, [...graph.edges]);
  }

  const requestedBudget = options.edgeBudget ?? passiveEdgeBudget(nodeCount);
  const budget = Math.min(
    graph.edges.length,
    Math.max(0, Math.floor(requestedBudget)),
  );
  if (budget === 0) return graphFromEdges(graph, []);

  const arbor = graph.edges.filter((edge) => edge.w !== undefined);
  const crosslinks = graph.edges.filter((edge) => edge.w === undefined);
  const trunkBudget = Math.min(
    arbor.length,
    Math.round(budget * PASSIVE_TRUNK_SHARE),
  );
  const twigBudget = Math.min(
    arbor.length - trunkBudget,
    Math.round(budget * PASSIVE_TWIG_SHARE),
  );

  const byHierarchy = [...arbor].sort((a, b) =>
    (b.w ?? 0) - (a.w ?? 0)
    || edgeHash(b) - edgeHash(a)
    || canonicalEdgeOrder(a, b));
  const trunks = byHierarchy.slice(0, trunkBudget);

  // Weight the stable random score by subtree size. This admits uneven tips
  // without turning the edge budget into uncorrelated white-noise hairs.
  const twigs = byHierarchy
    .slice(trunkBudget)
    .sort((a, b) =>
      edgeHash(b) * (0.35 + 0.65 * (b.w ?? 0))
      - edgeHash(a) * (0.35 + 0.65 * (a.w ?? 0))
      || canonicalEdgeOrder(a, b))
    .slice(0, twigBudget);

  // Cross-links are ranked by stable hash, with a mild short-edge preference
  // so they read as local membranes rather than cables across tissue voids.
  const extras = [...crosslinks]
    .sort((a, b) =>
      (edgeHash(b) - Math.min(b.d / 100, 0.2))
      - (edgeHash(a) - Math.min(a.d / 100, 0.2))
      || canonicalEdgeOrder(a, b));

  const availableByKey = new Map(graph.edges.map((edge) => [edgeKey(edge), edge]));
  const kept: NeighborEdge[] = [];
  const keptKeys = new Set<string>();
  const keep = (edge: NeighborEdge) => {
    if (kept.length >= budget) return;
    const key = edgeKey(edge);
    if (keptKeys.has(key)) return;
    keptKeys.add(key);
    kept.push(edge);
  };

  for (const previous of options.preferredEdges ?? []) {
    const current = availableByKey.get(edgeKey(previous));
    if (current) keep(current);
  }

  // The initial build follows the hierarchy quotas. Later builds begin with
  // surviving previous edges, then use this same order only to heal gaps.
  for (const edge of trunks) keep(edge);
  for (const edge of twigs) keep(edge);
  for (const edge of extras) keep(edge);
  // Tiny/synthetic graphs may contain only arbor edges.
  for (const edge of byHierarchy) keep(edge);

  kept.sort(canonicalEdgeOrder);
  return graphFromEdges(graph, kept);
}
