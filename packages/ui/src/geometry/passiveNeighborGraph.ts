import { fabricEdgeSeed } from './edgeBezier';
import type { NeighborEdge, NeighborGraph } from './neighborGraph';

/** Small-field connectivity ratio: enough resting fibres for the spanning
 * arbor plus capillary redundancy. It sizes the budget only while the field
 * is small — perceived density scales with TOTAL on-screen edges over the
 * fixed galaxy disk, not with edges per Cell, so large fields are bounded by
 * the screen-composition budget below (explicit product decision,
 * 2026-08-11: the 4/3-ratio-at-every-scale model read as felt, not nerves). */
export const PASSIVE_EDGES_PER_CELL = 4 / 3;
/** The aesthetic screen-composition budget: the resting fibre count the
 * galaxy disk carries at the reference "neural" density, independent of how
 * many Cells render. Restores the original fixed screen cap; live-tunable
 * within [NERVE_SCREEN_BUDGET_MIN, NERVE_SCREEN_BUDGET_MAX]. */
export const NERVE_SCREEN_BUDGET = 8_000;
export const NERVE_SCREEN_BUDGET_MIN = 6_000;
export const NERVE_SCREEN_BUDGET_MAX = 20_000;
/** Absolute passive-layer ceiling = the largest reachable screen budget.
 * Bounds GPU allocation classes; manual 50K fields still keep the fixed
 * screen budget, so nothing above the knob domain is ever requested. */
export const PASSIVE_EDGE_CEILING = NERVE_SCREEN_BUDGET_MAX;
/** Most screen energy belongs to coherent carrying branches. */
export const PASSIVE_TRUNK_SHARE = 0.72;
/** A minority of lower-order arbor edges break up clean top-weight contours. */
export const PASSIVE_TWIG_SHARE = 0.18;
/** Over-budget fields (spanning forest larger than the budget) spend this
 * share of the budget on a hash-scattered forest subset: partial coverage
 * must read as uniform airiness across the disk — scattered capillaries
 * weaving through bare "dust" Cells — never as one fully-wired canopy region
 * beside a bare remainder (the graph-order pathology of dense fields). */
export const PASSIVE_COVERAGE_SHARE = 0.55;

export interface PassiveNeighborGraphOptions {
  /** Override used by focused diagnostics/tests. Default is derived from N. */
  edgeBudget?: number;
  /** Render the complete routing graph for an explicit diagnostic view. */
  includeAll?: boolean;
  /** Still-valid resting edges from the previous frame. Preserving them turns
   * ordinary Cell churn into local growth instead of a whole-field reshuffle. */
  preferredEdges?: readonly NeighborEdge[];
  /** Live-tunable selection shares (defaults are the module constants). */
  coverageShare?: number;
  trunkShare?: number;
  twigShare?: number;
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

function clampShare(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
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

/** Passive-fibre budget for a visible Cell population: the 4/3 connectivity
 * ratio while the field is small, capped by the (live-tunable) fixed
 * screen-composition budget once the field outgrows it. */
export function passiveEdgeBudget(
  nodeCount: number,
  screenBudget = NERVE_SCREEN_BUDGET,
): number {
  if (!Number.isFinite(nodeCount) || nodeCount <= 1) return 0;
  const cap = Number.isFinite(screenBudget)
    ? Math.max(1, Math.min(PASSIVE_EDGE_CEILING, Math.round(screenBudget)))
    : NERVE_SCREEN_BUDGET;
  return Math.min(
    cap,
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
 * routing. The full graph stays connected for pulse planning; this layer is
 * a bounded screen-composition drawing. Small fields keep every connected
 * Cell attached (the budget exceeds their spanning forest); fields larger
 * than the screen budget accept scattered partial coverage by design.
 *
 * Selection is deterministic and hierarchical:
 *  1. still-valid prior edges — re-admitted first so an ordinary block frees
 *     only the slots of edges that died, not the whole forest (continuity);
 *  2. spanning-forest edges — all of them when they fit (cold build / small
 *     field), otherwise a hash-scattered share fills the remainder (uniform
 *     airiness, never a wired-solid region);
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

  const trunkShare = clampShare(options.trunkShare, PASSIVE_TRUNK_SHARE);
  const twigShare = clampShare(options.twigShare, PASSIVE_TWIG_SHARE);
  const coverageShare = clampShare(
    options.coverageShare,
    PASSIVE_COVERAGE_SHARE,
  );

  const arbor = graph.edges.filter((edge) => edge.w !== undefined);
  const crosslinks = graph.edges.filter((edge) => edge.w === undefined);
  const trunkBudget = Math.min(
    arbor.length,
    Math.round(budget * trunkShare),
  );
  const twigBudget = Math.min(
    arbor.length - trunkBudget,
    Math.round(budget * twigShare),
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
  // The penalty saturates at 3.6x the graph's median edge — the length at
  // which an edge stops being local — which is where /100 put it while the
  // truncated k-NN search made that median 5.47. On the corrected fabric the
  // median is 1.89, and /100 would have quietly shrunk this from a 0.055
  // nudge against a [0,1] hash to a 0.019 one: a tie-break that no longer
  // breaks anything. The cables it exists to deprioritize are still there —
  // lifeline and component-stitch edges still run to 27 world units.
  const extras = [...crosslinks]
    .sort((a, b) =>
      (edgeHash(b) - Math.min(b.d / 34, 0.2))
      - (edgeHash(a) - Math.min(a.d / 34, 0.2))
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

  // Continuity first: re-admit still-valid previously-drawn edges before
  // coverage competes for slots, so an ordinary Cell birth/death frees only
  // the dead edges' slots instead of reshuffling the whole coverage forest.
  // The forest is the BFS skeleton, whose parent assignment is queue-order
  // dependent, so it reshuffles a large fraction per block even when
  // membership moves ~1%; taking coverage first therefore evicted-and-regrew
  // ~an eighth of the drawn edges every block. A cold build (no
  // preferredEdges) is a no-op here, so coverage below still fills everything
  // exactly as before.
  for (const previous of options.preferredEdges ?? []) {
    const current = availableByKey.get(edgeKey(previous));
    if (current) keep(current);
  }

  // Small fields: the budget exceeds the spanning forest (4/3 ratio), so
  // every connected Cell still lands on a visible arbor — continuity above
  // only re-took edges that are still present, so coverage here reaches the
  // rest before decorative cross-links fill the remainder.
  //
  // Over-budget fields (forest > budget): full coverage is impossible, and
  // admitting the forest in graph order would wire one coherent region
  // solid while the rest goes bare (canopy-beside-dust). Spend only a
  // share of the budget on coverage, selected by stable per-edge hash —
  // spatially uniform scatter, deterministic across rebuilds, minimal
  // churn (an edge keeps its rank while it lives). Bare Cells are the
  // accepted "dust" between capillaries; trunks below supply the long
  // coherent strands.
  if (coverage.length <= budget) {
    for (const edge of coverage) keep(edge);
  } else {
    const coverageBudget = Math.round(budget * coverageShare);
    const scattered = [...coverage].sort((a, b) =>
      edgeHash(b) - edgeHash(a)
      || canonicalEdgeOrder(a, b));
    for (let i = 0; i < coverageBudget && i < scattered.length; i += 1) {
      keep(scattered[i]);
    }
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
