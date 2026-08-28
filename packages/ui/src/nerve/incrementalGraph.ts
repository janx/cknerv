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

function distSq(a: Cell, b: Cell): number {
  const dx = a.pos_seed[0] - b.pos_seed[0];
  const dy = a.pos_seed[1] - b.pos_seed[1];
  const dz = a.pos_seed[2] - b.pos_seed[2];
  return dx * dx + dy * dy + dz * dz;
}

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

export function addCell(
  graph: MutableNeighborGraph,
  cellId: number,
  cells: ReadonlyMap<number, Cell>,
  opts?: { k?: number; maxEdgeLength?: number },
): { addedEdges: NeighborEdge[] } {
  const self = cells.get(cellId);
  if (!self || self.death_at_ms != null) return { addedEdges: [] };
  const k = opts?.k ?? DEFAULT_K;
  const maxLen = opts?.maxEdgeLength ?? MAX_EDGE_LENGTH;
  const maxLenSq = maxLen * maxLen;

  // O(N × k) fixed-size selection for the k nearest LIVE others. The former
  // collect-all + full sort path allocated and sorted thousands of candidates
  // once per birth, which amplified high-output blocks into seconds of work.
  const near: { id: number; dSq: number; order: number }[] = [];
  let lifeline: { id: number; dSq: number } | null = null;
  let order = 0;
  for (const [id, c] of cells) {
    if (id === cellId || c.death_at_ms != null) continue;
    const dSq = distSq(self, c);
    if (lifeline === null || dSq < lifeline.dSq) lifeline = { id, dSq };
    if (dSq <= maxLenSq && k > 0) {
      const candidate = { id, dSq, order };
      if (near.length < k) {
        near.push(candidate);
      } else {
        let worst = 0;
        for (let i = 1; i < near.length; i += 1) {
          if (
            near[i].dSq > near[worst].dSq
            || (
              near[i].dSq === near[worst].dSq
              && near[i].order > near[worst].order
            )
          ) worst = i;
        }
        if (dSq < near[worst].dSq) near[worst] = candidate;
      }
    }
    order += 1;
  }
  near.sort((a, b) => a.dSq - b.dSq || a.order - b.order);

  const addedEdges: NeighborEdge[] = [];
  if (near.length === 0) {
    // rim outlier: one lifeline edge to the globally nearest, ignoring cap
    if (lifeline) { const e = addEdge(graph, cellId, lifeline.id, Math.sqrt(lifeline.dSq)); if (e) addedEdges.push(e); }
    else if (!graph.adjacency.has(cellId)) publish(graph, cellId, new Set());
    return { addedEdges };
  }
  for (let i = 0; i < Math.min(k, near.length); i++) {
    const e = addEdge(graph, cellId, near[i].id, Math.sqrt(near[i].dSq));
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
