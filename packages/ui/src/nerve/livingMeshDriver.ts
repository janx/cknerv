// Pure logic for the living-mesh driver. The driver EFFECT lives in
// NeuralNetwork.tsx (Canvas-bound); everything testable lives here:
// ripple stagger, dead-end resolution, and the full
// per-diff orchestration (planMeshUpdate) that mutates the graph and builds
// the fabric instruction maps.

import type { Cell } from '@cknerv/types';
import type { NeighborGraph, NeighborEdge } from '../geometry/neighborGraph';
import type { CellsDiff } from './cellsDelta';
import { addCell, removeCell } from './incrementalGraph';
import { fabricEdgeKey } from './fabricOrder';

/** Above this estimated birth-to-existing-Cell comparison count, one spatial
 * bulk rebuild is cheaper than scanning the complete map once per birth. */
export const MAX_INCREMENTAL_BIRTH_COMPARISONS = 250_000;

export function shouldBulkRebuildRoutingGraph(
  birthCount: number,
  cellCount: number,
): boolean {
  const births = Number.isFinite(birthCount)
    ? Math.max(0, Math.floor(birthCount))
    : 0;
  const cells = Number.isFinite(cellCount)
    ? Math.max(0, Math.floor(cellCount))
    : 0;
  return births > 1
    && births * cells >= MAX_INCREMENTAL_BIRTH_COMPARISONS;
}

export function staggerBornAt(nowSec: number, index: number, _count: number, stepMs: number): number {
  return nowSec + (index * stepMs) / 1000;
}

export function deadEndFor(edgeKey: string, deadCellId: number): 'from' | 'to' {
  const lo = Number(edgeKey.slice(0, edgeKey.indexOf('|')));
  return deadCellId === lo ? 'from' : 'to';
}

export interface MeshUpdate {
  addedEdges: NeighborEdge[];
  bornAtByKey: Map<string, number>;
  dirByKey: Map<string, 1 | -1>;
  deathKeys: string[];
  deathEndByKey: Map<string, 'from' | 'to'>;
  evictKeys: string[];
}

/** Apply one cells diff to the graph (mutating it) and build the fabric
 *  instruction maps. Births add their k-NN out-edges with a staggered
 *  bornAt (ripple) and a growDir (grow from the pre-existing end toward the
 *  newborn: growDir 1 iff the newborn is the hi id). Deaths + evictions
 *  remove edges; deaths carry the dead end for retract. Pure w.r.t. its
 *  return value; the only side effect is mutating `graph`. */
export function planMeshUpdate(
  diff: CellsDiff,
  graph: NeighborGraph,
  cells: ReadonlyMap<number, Cell>,
  nowSec: number,
  opts: { k?: number; maxEdgeLength?: number },
  rippleStepMs: number,
): MeshUpdate {
  const addedEdges: NeighborEdge[] = [];
  const bornAtByKey = new Map<string, number>();
  const dirByKey = new Map<string, 1 | -1>();
  diff.born.forEach((id, i) => {
    const { addedEdges: es } = addCell(graph, id, cells, opts);
    const bornAt = staggerBornAt(nowSec, i, diff.born.length, rippleStepMs);
    for (const e of es) {
      const key = fabricEdgeKey(e.from, e.to);
      addedEdges.push(e);
      bornAtByKey.set(key, bornAt);
      dirByKey.set(key, id === Math.max(e.from, e.to) ? 1 : -1);
    }
  });
  const deathKeys: string[] = [];
  const deathEndByKey = new Map<string, 'from' | 'to'>();
  for (const id of diff.died) {
    const { removedEdgeKeys } = removeCell(graph, id);
    for (const k of removedEdgeKeys) { deathKeys.push(k); deathEndByKey.set(k, deadEndFor(k, id)); }
  }
  const evictKeys: string[] = [];
  for (const id of diff.evicted) {
    const { removedEdgeKeys } = removeCell(graph, id);
    for (const k of removedEdgeKeys) evictKeys.push(k);
  }
  return { addedEdges, bornAtByKey, dirByKey, deathKeys, deathEndByKey, evictKeys };
}
