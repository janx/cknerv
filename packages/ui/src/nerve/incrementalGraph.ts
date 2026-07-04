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

  // O(N) scan for the k nearest LIVE others.
  const near: { id: number; dSq: number }[] = [];
  let lifeline: { id: number; dSq: number } | null = null;
  for (const [id, c] of cells) {
    if (id === cellId || c.death_at_ms != null) continue;
    const dSq = distSq(self, c);
    if (lifeline === null || dSq < lifeline.dSq) lifeline = { id, dSq };
    if (dSq <= maxLenSq) near.push({ id, dSq });
  }
  near.sort((a, b) => a.dSq - b.dSq);

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
  const nbrs = graph.adjacency.get(cellId);
  const removedEdgeKeys: string[] = [];
  if (nbrs) {
    for (const n of nbrs) {
      graph.adjacency.get(n)?.delete(cellId);
      removedEdgeKeys.push(fabricEdgeKey(cellId, n));
    }
    graph.adjacency.delete(cellId);
  }
  if (removedEdgeKeys.length > 0) {
    const kill = new Set(removedEdgeKeys);
    graph.edges = graph.edges.filter((e) => !kill.has(fabricEdgeKey(e.from, e.to)));
  }
  return { removedEdgeKeys };
}
