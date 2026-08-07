// Eager incremental maintenance of the spatial neighbour graph. Mutates a
// NeighborGraph in place (it is the live graphRef) and returns the edge
// delta for the fabric to animate. addCell adds a newborn's real k-NN
// out-edges (symmetric); the symmetric in-edges an existing cell would gain
// are left to periodic reconciliation (buildNeighborGraph). Operates on
// LIVE cells only (death_at_ms == null), matching the canonical builder.

import type { Cell } from '@cknerv/types';
import type { NeighborGraph, NeighborEdge } from '../geometry/neighborGraph';
import { fabricEdgeKey } from './fabricOrder';

const DEFAULT_K = 4;
const MAX_EDGE_LENGTH = 25; // mirror neighborGraph.ts

function distSq(a: Cell, b: Cell): number {
  const dx = a.pos_seed[0] - b.pos_seed[0];
  const dy = a.pos_seed[1] - b.pos_seed[1];
  const dz = a.pos_seed[2] - b.pos_seed[2];
  return dx * dx + dy * dy + dz * dz;
}

function addEdge(graph: NeighborGraph, a: number, b: number, d: number): NeighborEdge | null {
  if (a === b) return null;
  let sa = graph.adjacency.get(a); if (!sa) { sa = new Set(); graph.adjacency.set(a, sa); }
  if (sa.has(b)) return null;
  let sb = graph.adjacency.get(b); if (!sb) { sb = new Set(); graph.adjacency.set(b, sb); }
  const lo = a < b ? a : b, hi = a < b ? b : a;
  const edge: NeighborEdge = { from: lo, to: hi, d };
  sa.add(b); sb.add(a); graph.edges.push(edge);
  return edge;
}

export function addCell(
  graph: NeighborGraph,
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
    else if (!graph.adjacency.has(cellId)) graph.adjacency.set(cellId, new Set());
    return { addedEdges };
  }
  for (let i = 0; i < Math.min(k, near.length); i++) {
    const e = addEdge(graph, cellId, near[i].id, Math.sqrt(near[i].dSq));
    if (e) addedEdges.push(e);
  }
  return { addedEdges };
}

export function removeCell(
  graph: NeighborGraph,
  cellId: number,
): { removedEdgeKeys: string[] } {
  return removeCells(graph, [cellId])[0] ?? { removedEdgeKeys: [] };
}

export interface RemovedCellEdges {
  removedEdgeKeys: string[];
}

/**
 * Remove one lifecycle batch while filtering the complete edge array once.
 *
 * Results retain `cellIds` order. Adjacency is detached in that same order, so
 * when both endpoints of one edge disappear in a batch the first Cell owns the
 * returned edge key exactly as repeated `removeCell` calls did. The expensive
 * dense edge storage is compacted only after every adjacency change, reducing
 * block application from O(removed Cells × graph edges) to O(graph edges plus
 * removed degrees).
 */
export function removeCells(
  graph: NeighborGraph,
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
        graph.adjacency.get(neighbourId)?.delete(cellId);
        removedEdgeKeys.push(fabricEdgeKey(cellId, neighbourId));
      }
      graph.adjacency.delete(cellId);
    }
    if (removedEdgeKeys.length > 0) removedAnyEdge = true;
    removedIds.add(cellId);
    removals.push({ removedEdgeKeys });
  }

  if (removedAnyEdge) {
    graph.edges = graph.edges.filter(
      (edge) => !removedIds.has(edge.from) && !removedIds.has(edge.to),
    );
  }

  return removals;
}
