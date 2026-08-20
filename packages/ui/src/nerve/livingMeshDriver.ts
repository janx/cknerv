// Pure logic for the living-mesh driver. The driver EFFECT lives in
// NeuralNetwork.tsx (Canvas-bound); everything testable lives here:
// ripple stagger, dead-end resolution, the full
// per-diff orchestration (planMeshUpdate) that mutates the graph and builds
// the fabric instruction maps, and the worker-selection-delta translation that
// addresses the fabric in the only edge vocabulary it answers to.

import type { Cell } from '@cknerv/types';
import type { NeighborGraph, NeighborEdge } from '../geometry/neighborGraph';
import { addCell, removeCells } from './incrementalGraph';
import { fabricEdgeKey } from './fabricOrder';

/** Lifecycle subset consumed from the cache reducer's compact Cell journal. */
export interface CellsDiff {
  readonly born: readonly number[];
  readonly died: readonly number[];
  readonly evicted: readonly number[];
}

/** Lifecycle subset of one display-plane membership journal. */
export interface DisplayMembershipDiff {
  readonly entered: readonly number[];
  readonly exited: readonly number[];
  readonly updated: readonly number[];
}

/**
 * Map one display-plane membership journal onto the living-mesh diff the eager
 * driver applies to the display graph. Mirrors `feedDisplayGraphJournal`'s
 * admission rule, so the eager mutation and the journal the worker receives
 * describe the same change set:
 *
 *   - a live member the graph does not hold yet is BORN,
 *   - a member that has died is DIED — its fibres retract,
 *   - a member that merely left the stage is EVICTED — its fibres just go.
 *
 * `entered` and `updated` are both admission channels: a canonical update is
 * how a member that entered dead (or unresolved) later becomes live, and it is
 * also how a staged member's death reaches this journal. Admission outranks
 * exit for an id listed in both, matching the journal's remove-then-upsert
 * order.
 *
 * ⚠️ A member the plane drops BECAUSE it died arrives on `exited`, not
 * `updated` — the curated queues do not hoard the dead. Retract-vs-gc is
 * therefore decided by the cell's own lifecycle, never by which channel
 * reported it; otherwise the same death animates differently depending on
 * whether the plane happened to re-stage that slot in the same batch.
 *
 * Pure: reads `graph.adjacency` for membership only.
 */
export function planDisplayMeshDiff(
  changes: DisplayMembershipDiff,
  graph: NeighborGraph,
  resolve: (id: number) => Cell | undefined,
): CellsDiff {
  const exiting = new Set(changes.exited);
  const born: number[] = [];
  const died: number[] = [];
  const decided = new Set<number>();
  const admit = (id: number): void => {
    if (decided.has(id)) return;
    decided.add(id);
    exiting.delete(id);
    const held = graph.adjacency.has(id);
    const cell = resolve(id);
    if (cell === undefined || cell.death_at_ms !== null) {
      if (held) died.push(id);
      return;
    }
    if (!held) born.push(id);
  };
  for (const id of changes.entered) admit(id);
  for (const id of changes.updated) admit(id);

  const evicted: number[] = [];
  for (const id of exiting) {
    if (!graph.adjacency.has(id)) continue;
    const cell = resolve(id);
    if (cell !== undefined && cell.death_at_ms !== null) died.push(id);
    else evicted.push(id);
  }
  return { born, died, evicted };
}

/** Above this estimated birth-to-existing-Cell comparison count, one spatial
 * bulk rebuild is cheaper than scanning the complete map once per birth. */
export const MAX_INCREMENTAL_BIRTH_COMPARISONS = 250_000;

/** Whether a birth batch should be left to the worker rebuild instead of being
 * admitted one cell at a time. Each eager admission scans the staged map for
 * its k nearest, so a big batch costs births × cells comparisons on the main
 * thread — and the rebuild that supersedes it is already in flight. */
export function shouldDeferBirthsToBulkRebuild(
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

/** One completed worker build's passive-selection delta against the previous
 *  applied build, in the geometry layer's own edge vocabulary. */
export interface SelectionDelta {
  readonly added: readonly NeighborEdge[];
  readonly removed: readonly NeighborEdge[];
}

/** Fabric instructions for one selection delta: keys to kill, and the birth
 *  hints for the edges being grown. */
export interface SelectionDeltaUpdate {
  killKeys: string[];
  bornAtByKey: Map<string, number>;
  dirByKey: Map<string, 1 | -1>;
}

/**
 * Translate a worker selection delta into fabric instructions.
 *
 * ⚠️ The two layers key an edge DIFFERENTLY: the geometry/worker side writes
 * `${from}:${to}` (`neighborGraph.edgeKey`), while the fabric's edge map is
 * keyed by `fabricEdgeKey` (`lo|hi`). A key in the wrong vocabulary matches
 * nothing, and every fabric handle skips an unknown key in silence — so a
 * removed edge handed over in graph vocabulary never enters its decay at all.
 * Every crossing of that boundary goes through here, so the translation is
 * written once and tested once.
 */
export function planSelectionDeltaUpdate(
  delta: SelectionDelta,
  nowSec: number,
): SelectionDeltaUpdate {
  const killKeys: string[] = [];
  for (const edge of delta.removed) {
    killKeys.push(fabricEdgeKey(edge.from, edge.to));
  }
  const bornAtByKey = new Map<string, number>();
  const dirByKey = new Map<string, 1 | -1>();
  for (const edge of delta.added) {
    const key = fabricEdgeKey(edge.from, edge.to);
    bornAtByKey.set(key, nowSec);
    dirByKey.set(key, 1);
  }
  return { killKeys, bornAtByKey, dirByKey };
}

/**
 * Live fabric keys the authoritative selection no longer contains — the
 * periodic reconcile's prune set. The vocabulary hazard above is worse here
 * and silent in the other direction: compared against graph-vocabulary keys
 * NOTHING matches, so every live edge reads as a stray and the prune gc's the
 * entire fabric.
 */
export function selectionStrayEdgeKeys(
  selectionEdges: readonly { from: number; to: number }[],
  liveKeys: readonly string[],
): string[] {
  const selection = new Set<string>();
  for (const edge of selectionEdges) {
    selection.add(fabricEdgeKey(edge.from, edge.to));
  }
  return liveKeys.filter((key) => !selection.has(key));
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
  const removedCells = removeCells(graph, [...diff.died, ...diff.evicted]);
  for (let index = 0; index < diff.died.length; index += 1) {
    const id = diff.died[index];
    const { removedEdgeKeys } = removedCells[index];
    for (const k of removedEdgeKeys) { deathKeys.push(k); deathEndByKey.set(k, deadEndFor(k, id)); }
  }
  const evictKeys: string[] = [];
  for (let index = 0; index < diff.evicted.length; index += 1) {
    const { removedEdgeKeys } = removedCells[diff.died.length + index];
    for (const k of removedEdgeKeys) evictKeys.push(k);
  }
  return { addedEdges, bornAtByKey, dirByKey, deathKeys, deathEndByKey, evictKeys };
}
