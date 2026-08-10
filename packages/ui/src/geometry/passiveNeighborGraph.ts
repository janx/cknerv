import { INSTANCE_CAPACITY } from './cellPositions';
import { fabricEdgeSeed } from './edgeBezier';
import type { NeighborEdge, NeighborGraph } from './neighborGraph';

/** Admit enough resting fibres to keep every connected Cell on the visible
 * arbor and still retain capillary cross-links. This ratio is the stable
 * visual identity of the nervous system: the nerve budget follows the visible
 * Cell count at every quality tier (explicit product decision, 2026-08-10),
 * so a denser Cell field always reads equally neural — quality changes how
 * many Cells AND nerves render together, never their proportion. */
export const PASSIVE_EDGES_PER_CELL = 4 / 3;
/** Absolute nerve ceiling at the full renderer field: enough for the
 * spanning arbor plus cross-links over every instanced Cell slot. The old
 * fixed 8,000 screen cap survives as the LOW tier's derived budget
 * (6,000 Cells × 4/3), not as a global ceiling. */
export const PASSIVE_EDGE_CEILING = Math.round(
  INSTANCE_CAPACITY * PASSIVE_EDGES_PER_CELL,
);
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

/** Select a deterministic spanning forest from the authoritative graph order.
 * `buildNeighborGraph` puts its connectivity skeleton first, so this retains
 * that local shape without coupling the passive view to builder internals.
 * The union check also keeps this correct for synthetic/custom graphs. */
function spanningCoverageEdges(graph: NeighborGraph): NeighborEdge[] {
  const parent = new Map<number, number>();
  for (const id of graph.adjacency.keys()) parent.set(id, id);

  const find = (id: number): number => {
    if (!parent.has(id)) parent.set(id, id);
    let root = parent.get(id)!;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = id;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };

  const coverage: NeighborEdge[] = [];
  for (const edge of graph.edges) {
    const fromRoot = find(edge.from);
    const toRoot = find(edge.to);
    if (fromRoot === toRoot) continue;
    parent.set(toRoot, fromRoot);
    coverage.push(edge);
  }
  return coverage;
}

/** Ratio-constant passive-fibre budget for a visible Cell population,
 *  bounded only by the full-field ceiling. */
export function passiveEdgeBudget(nodeCount: number): number {
  if (!Number.isFinite(nodeCount) || nodeCount <= 1) return 0;
  return Math.min(
    PASSIVE_EDGE_CEILING,
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
 * bounded arbor drawing that keeps every Cell attached: each tier's ratio-
 * derived budget exceeds its own field's spanning forest.
 *
 * Selection is deterministic and hierarchical:
 *  1. a spanning forest keeps every connected Cell on a visible nerve;
 *  2. still-valid prior edges preserve local visual continuity;
 *  3. hierarchy-ranked branches and hash-scattered cross-links fill the cap.
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
  const coverage = spanningCoverageEdges(graph);
  const kept: NeighborEdge[] = [];
  const keptKeys = new Set<string>();
  const keep = (edge: NeighborEdge) => {
    if (kept.length >= budget) return;
    const key = edgeKey(edge);
    if (keptKeys.has(key)) return;
    keptKeys.add(key);
    kept.push(edge);
  };

  // Connectivity is the visual contract. Every tier's budget exceeds its
  // own field's spanning forest (4/3 ratio > 1 edge per Cell), so every
  // connected Cell is visibly attached before continuity and decorative
  // cross-links compete for the remainder.
  for (const edge of coverage) keep(edge);
  for (const previous of options.preferredEdges ?? []) {
    const current = availableByKey.get(edgeKey(previous));
    if (current) keep(current);
  }

  // The initial and incremental builds share the same hierarchy fill order.
  for (const edge of trunks) keep(edge);
  for (const edge of twigs) keep(edge);
  for (const edge of extras) keep(edge);
  // Tiny/synthetic graphs may contain only arbor edges.
  for (const edge of byHierarchy) keep(edge);

  kept.sort(canonicalEdgeOrder);
  return graphFromEdges(graph, kept);
}
