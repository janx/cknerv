import {
  buildNeighborGraph,
  type LivingNeighborGraph,
  type NeighborAdjacency,
  type NeighborEdge,
  type NeighborGraph,
  type NeighborGraphCell,
  type NeighborGraphOptions,
  type PassiveSelection,
} from './neighborGraph';
import { buildPassiveNeighborGraph } from './passiveNeighborGraph';
import { neighborGraphBuilderStats } from './neighborGraphBuilderStats';

export const PACKED_TOPOLOGY_CELL_STRIDE = 4;
export const PACKED_PREFERRED_EDGE_STRIDE = 2;
/** One passive edge on the wire: `[from, to, distance, arborWeight]`, `NaN`
 * for no weight. */
export const PACKED_PASSIVE_EDGE_STRIDE = 4;
/** One passive edge KEY on the wire: `[from, to]`. A removal names an edge
 * the receiver already holds, so the record's other fields never ride. */
export const PACKED_PASSIVE_KEY_STRIDE = 2;
/** One passive edge's VALUES on the wire: `[distance, arborWeight]`, `NaN`
 * for no weight — the fields of a record that can move while its key stays. */
export const PACKED_PASSIVE_VALUE_STRIDE = 2;

/**
 * How far an arbor weight may move inside a held record before the record is
 * replaced.
 *
 * A record's own `w` reaches exactly two readers: `fabricTrunkTier`, which
 * takes the whole selection's weights from `PassiveSelection.weights` and so
 * never reads a record's at all, and `NeuralFabric` at the instant it ADMITS
 * an edge, where `arborBrightness` and `fabricEdgeTrunkness` are frozen into
 * a state that is never re-derived. An edge being admitted is an edge that
 * just entered the selection, and its record was built by this very patch —
 * so the grain is spent only on records nothing will read again until they
 * move for a reason of their own. Two hundredths of a weight is under a
 * fortieth of `arborBrightness`'s range even at the top of the curve, and the
 * whole point is that the drift below it is not a fact about any edge, only
 * about which tree happened to be the largest this block.
 */
export const PASSIVE_WEIGHT_GRAIN = 0.02;

/**
 * Everything a reader can see about a weight BESIDES its magnitude: whether
 * the edge carries an arbor weight at all — `arborBrightness` answers a
 * different curve without one — and whether that weight can reach the wide
 * pass, which is `fabricEdgeTrunkness`'s positive/sentinel split. A crossing
 * of either is visible however small the move, so the grain never applies to
 * one. (Spelled here rather than imported from the fabric so the worker's
 * half of this module stays free of the nerve layer; the agreement with
 * `fabricEdgeTrunkness` is pinned in the protocol's tests.) */
export function passiveWeightClass(w: number | undefined): 0 | 1 | 2 {
  if (w === undefined) return 0;
  return Number.isFinite(w) && w > 0 ? 2 : 1;
}

/** CSR adjacency preserving each Set's insertion order for deterministic
 * equal-hop routing choices. */
export interface SerializedNeighborAdjacency {
  nodeIds: Float64Array;
  adjacencyOffsets: Uint32Array;
  adjacentNodeIds: Float64Array;
}

/** Change set of one display adjacency against the session's previous
 * build, computed in the worker with the same order-strict comparison the
 * main thread's reuse probe runs — so "not in `changed`" means exactly "the
 * previous build's Set instance is still right". */
export interface SerializedNeighborAdjacencyPatch {
  /** CSR over exactly the nodes whose neighbour run differs from the
   * previous build's, new nodes included. */
  changed: SerializedNeighborAdjacency;
  /** Previous-build nodes absent from this build. */
  removedNodeIds: Float64Array;
}

/** How the display graph rides a response: whole, or as a patch against
 * the build the request's `patchBaseGeneration` named. */
export type SerializedDisplayGraph =
  | { kind: 'full'; adjacency: SerializedNeighborAdjacency }
  | { kind: 'patch'; patch: SerializedNeighborAdjacencyPatch };

/** Change set of one passive selection against the session's previous one,
 * both in canonical order (see `PassiveSelection`): the edges that entered,
 * as whole records, the keys of those that left, and the values of every
 * edge in the resulting list.
 *
 * The values ride whole because they are not stable while the keys are:
 * an arbor weight is `sqrt(subtreeSize / maxSubtreeSize)` over the whole
 * forest, so one birth or death in the largest of the 14 trees rescales
 * every weight in the selection — nearly every build. The main thread reads
 * every edge's weight on every build (the trunk tier is derived from the
 * whole drawn selection), so the current values have to arrive; as one flat
 * array they cost 16 bytes an edge, against the 32 of a record. */
export interface SerializedPassiveSelectionPatch {
  /** `PACKED_PASSIVE_EDGE_STRIDE` per edge, canonical order. */
  added: Float64Array;
  /** `PACKED_PASSIVE_KEY_STRIDE` per key, canonical order. */
  removedKeys: Float64Array;
  /** `PACKED_PASSIVE_VALUE_STRIDE` per edge of the MERGED list (previous
   * minus `removedKeys` plus `added`), in that list's canonical order. */
  values: Float64Array;
}

/** How the passive selection rides a response: the whole drawn edge list,
 * or a patch against the selection the request's `patchBaseGeneration`
 * named. Never an adjacency — nothing on the main thread reads one for the
 * passive graph (the fabric diff, the trunk tier, the bridges' host degrees,
 * the stray prune and the continuity preference all read `edges`), so the
 * 12K-entry Map the old whole form rebuilt per block served no reader. */
export type SerializedPassiveSelection =
  | { kind: 'full'; edges: Float64Array }
  | { kind: 'patch'; patch: SerializedPassiveSelectionPatch };

export interface NeighborGraphWorkerCellsDelta {
  /** Session generation this delta chains from; a mismatch (superseded or
   * dropped build, fresh worker) makes the worker answer `stale` and the
   * builder re-sends a full pack. */
  baseGeneration: number;
  /** Live cells born/revived since the base, packed `[id, x, y, z]`. */
  upserts: Float64Array;
  /** Ids that left the live topology (map removal or death transition). */
  removedIds: Float64Array;
}

export interface NeighborGraphWorkerRequest {
  kind: 'build';
  requestId: number;
  /** Full topology pack, or null when `cellsDelta` carries the change set. */
  cells: Float64Array | null;
  cellsDelta: NeighborGraphWorkerCellsDelta | null;
  /** Session generation of the build the requester currently holds — its
   * display graph AND its passive selection, which land together (0 = none,
   * or a caller that cannot patch). When it names the session's previous
   * build, the response carries patches against that build instead of the
   * whole adjacency and the whole edge list; otherwise the whole forms ride,
   * which is always correct. Independent of `cellsDelta`: a full cell pack
   * can still be answered with patches, and the chain is decided here, not
   * in the builder after the fact. */
  patchBaseGeneration: number;
  options: NeighborGraphOptions;
  includePassive: boolean;
  /** Visual-only edge cap; null selects the canonical population-derived cap. */
  passiveEdgeBudget: number | null;
  /** Live-tunable passive selection shares. The worker bundle holds its own
   * module instances (its LIVE singleton is never the panel's), so tuning
   * must ride the request; null selects the module-constant defaults. */
  passiveTuning: {
    coverageShare: number;
    trunkShare: number;
    twigShare: number;
  } | null;
  /** Repeated `[from, to]` keys retained from the current passive fabric.
   * Only consulted when the worker session has no retained selection of its
   * own (first build after a fresh worker); a stateful session prefers its
   * previous passive result. */
  preferredEdges: Float64Array | null;
}

export interface NeighborGraphWorkerSuccess {
  kind: 'built';
  requestId: number;
  /** Monotonic per-session build counter. The main thread only applies a
   * patch when generations chain without a gap; a patch is only ever sent
   * when the request's `patchBaseGeneration` was this session's previous
   * build, so it always chains. */
  generation: number;
  /** Display adjacency, whole or patched — see {@link SerializedDisplayGraph}. */
  graph: SerializedDisplayGraph;
  /** Passive selection, whole or patched — see
   * {@link SerializedPassiveSelection}. A patch rides under exactly the
   * condition the display patch does, and only when this session's previous
   * build carried a passive selection to patch against. */
  passiveGraph: SerializedPassiveSelection | null;
}

export interface NeighborGraphWorkerFailure {
  kind: 'failed';
  requestId: number;
  message: string;
}

/** The delta's base generation did not match the session — the builder must
 * re-send a full pack. Never an error: supersession makes gaps ordinary. */
export interface NeighborGraphWorkerStale {
  kind: 'stale';
  requestId: number;
}

export type NeighborGraphWorkerResponse =
  | NeighborGraphWorkerSuccess
  | NeighborGraphWorkerStale
  | NeighborGraphWorkerFailure;

/** Copy only topology inputs and omit dead Cells entirely. Complete Cell
 * payloads can contain large scripts/data blobs and must stay on the main
 * thread. */
export function packTopologyCells(
  cells: ReadonlyMap<number, NeighborGraphCell>,
): Float64Array {
  let liveCount = 0;
  for (const cell of cells.values()) {
    if (cell.death_at_ms === null) liveCount += 1;
  }
  const packed = new Float64Array(liveCount * PACKED_TOPOLOGY_CELL_STRIDE);
  let offset = 0;
  for (const cell of cells.values()) {
    if (cell.death_at_ms !== null) continue;
    packed[offset] = cell.id;
    packed[offset + 1] = cell.pos_seed[0];
    packed[offset + 2] = cell.pos_seed[1];
    packed[offset + 3] = cell.pos_seed[2];
    offset += PACKED_TOPOLOGY_CELL_STRIDE;
  }
  return packed;
}

export function unpackTopologyCells(
  packed: Float64Array,
): Map<number, NeighborGraphCell> {
  if (packed.length % PACKED_TOPOLOGY_CELL_STRIDE !== 0) {
    throw new Error('invalid packed topology Cell buffer');
  }
  // Yield the Map in id order so a full-pack request's source Map is canonical.
  // A delta session accumulates its own Map in arrival order; buildNeighborGraph
  // now sorts its working list either way, so this is belt-and-suspenders that
  // keeps the source Map itself id-ordered for any direct reader (adjacency
  // serialization, debug dumps) and matches what a sorted delta session sees.
  const stride = PACKED_TOPOLOGY_CELL_STRIDE;
  const order = Array.from({ length: packed.length / stride }, (_, i) => i).sort(
    (a, b) => packed[a * stride] - packed[b * stride],
  );
  const cells = new Map<number, NeighborGraphCell>();
  for (const i of order) {
    const offset = i * stride;
    const id = packed[offset];
    cells.set(id, {
      id,
      death_at_ms: null,
      pos_seed: [packed[offset + 1], packed[offset + 2], packed[offset + 3]],
    });
  }
  return cells;
}

export function packPreferredEdges(
  edges: readonly NeighborEdge[],
): Float64Array {
  const packed = new Float64Array(edges.length * PACKED_PREFERRED_EDGE_STRIDE);
  let offset = 0;
  for (const edge of edges) {
    packed[offset] = edge.from;
    packed[offset + 1] = edge.to;
    offset += PACKED_PREFERRED_EDGE_STRIDE;
  }
  return packed;
}

function unpackPreferredEdges(packed: Float64Array | null): NeighborEdge[] {
  if (packed === null) return [];
  if (packed.length % PACKED_PREFERRED_EDGE_STRIDE !== 0) {
    throw new Error('invalid packed preferred-edge buffer');
  }
  const edges: NeighborEdge[] = [];
  for (let offset = 0; offset < packed.length; offset += PACKED_PREFERRED_EDGE_STRIDE) {
    edges.push({ from: packed[offset], to: packed[offset + 1], d: 0 });
  }
  return edges;
}

// ── serialize ───────────────────────────────────────────────────────────

/** CSR over a subset of the adjacency, in `nodeIds` order (all nodes when
 * `nodeIds` is null), preserving each Set's iteration order. */
function serializeAdjacencyRuns(
  adjacency: ReadonlyMap<number, ReadonlySet<number>>,
  nodeIds: readonly number[] | null,
): SerializedNeighborAdjacency {
  const count = nodeIds === null ? adjacency.size : nodeIds.length;
  const ids = new Float64Array(count);
  const adjacencyOffsets = new Uint32Array(count + 1);
  let adjacentNodeCount = 0;
  if (nodeIds === null) {
    for (const neighbours of adjacency.values()) {
      adjacentNodeCount += neighbours.size;
    }
  } else {
    for (const id of nodeIds) adjacentNodeCount += adjacency.get(id)!.size;
  }
  const adjacentNodeIds = new Float64Array(adjacentNodeCount);
  let nodeIndex = 0;
  let adjacentNodeIndex = 0;
  const writeRun = (id: number, neighbours: ReadonlySet<number>): void => {
    ids[nodeIndex] = id;
    adjacencyOffsets[nodeIndex] = adjacentNodeIndex;
    for (const neighbourId of neighbours) {
      adjacentNodeIds[adjacentNodeIndex] = neighbourId;
      adjacentNodeIndex += 1;
    }
    nodeIndex += 1;
  };
  if (nodeIds === null) {
    for (const [id, neighbours] of adjacency) writeRun(id, neighbours);
  } else {
    for (const id of nodeIds) writeRun(id, adjacency.get(id)!);
  }
  adjacencyOffsets[nodeIndex] = adjacentNodeIndex;
  return { nodeIds: ids, adjacencyOffsets, adjacentNodeIds };
}

export function serializeNeighborAdjacency(
  graph: NeighborAdjacency,
): SerializedNeighborAdjacency {
  return serializeAdjacencyRuns(graph.adjacency, null);
}

/** Same order-strict comparison as {@link reusableNeighbourSet}, between two
 * live Sets: true iff `next` is exactly `before` (members AND order). */
function sameNeighbourRun(
  before: ReadonlySet<number> | undefined,
  next: ReadonlySet<number>,
): boolean {
  if (before === undefined || before.size !== next.size) return false;
  const iterator = before.values();
  for (const neighbourId of next) {
    if (iterator.next().value !== neighbourId) return false;
  }
  return true;
}

/** Worker-side diff of the new adjacency against the session's previous
 * one. The changed set uses the SAME order-strict comparison the main
 * thread's reuse probe runs, so "unchanged" here is exactly "the main
 * thread may keep its previous Set instance without probing". */
export function collectNeighborAdjacencyPatch(
  previous: NeighborAdjacency,
  next: NeighborAdjacency,
): SerializedNeighborAdjacencyPatch {
  const changed: number[] = [];
  for (const [id, neighbours] of next.adjacency) {
    if (!sameNeighbourRun(previous.adjacency.get(id), neighbours)) {
      changed.push(id);
    }
  }
  const removed: number[] = [];
  for (const id of previous.adjacency.keys()) {
    if (!next.adjacency.has(id)) removed.push(id);
  }
  return {
    changed: serializeAdjacencyRuns(next.adjacency, changed),
    removedNodeIds: Float64Array.from(removed),
  };
}

// ── passive selection: serialize ────────────────────────────────────────

/** Canonical edge order — `from` ascending, then `to` — as
 * `buildPassiveNeighborGraph` emits it and `PassiveSelection` keeps it. */
function compareEdgeKeys(
  aFrom: number,
  aTo: number,
  bFrom: number,
  bTo: number,
): number {
  return aFrom - bFrom || aTo - bTo;
}

export function packPassiveEdges(edges: readonly NeighborEdge[]): Float64Array {
  const packed = new Float64Array(edges.length * PACKED_PASSIVE_EDGE_STRIDE);
  let offset = 0;
  for (const edge of edges) {
    packed[offset] = edge.from;
    packed[offset + 1] = edge.to;
    packed[offset + 2] = edge.d;
    packed[offset + 3] = edge.w ?? Number.NaN;
    offset += PACKED_PASSIVE_EDGE_STRIDE;
  }
  return packed;
}

function packPassiveKeys(edges: readonly NeighborEdge[]): Float64Array {
  const packed = new Float64Array(edges.length * PACKED_PASSIVE_KEY_STRIDE);
  let offset = 0;
  for (const edge of edges) {
    packed[offset] = edge.from;
    packed[offset + 1] = edge.to;
    offset += PACKED_PASSIVE_KEY_STRIDE;
  }
  return packed;
}

function packPassiveValues(edges: readonly NeighborEdge[]): Float64Array {
  const packed = new Float64Array(edges.length * PACKED_PASSIVE_VALUE_STRIDE);
  let offset = 0;
  for (const edge of edges) {
    packed[offset] = edge.d;
    packed[offset + 1] = edge.w ?? Number.NaN;
    offset += PACKED_PASSIVE_VALUE_STRIDE;
  }
  return packed;
}

/**
 * Worker-side diff of the new passive selection against the session's
 * previous one: one merge walk over the two canonically ordered lists, no
 * keys built, plus the new list's values. Both lists come from
 * `buildPassiveNeighborGraph`, which sorts its selection and admits each key
 * once; the walk re-checks the new list's order as it goes, because a merge
 * over an unordered list would produce a wrong diff in silence, and a thrown
 * build lands in the builder's counted fallback instead.
 */
export function collectPassiveSelectionPatch(
  previous: readonly NeighborEdge[],
  next: readonly NeighborEdge[],
): SerializedPassiveSelectionPatch {
  const added: NeighborEdge[] = [];
  const removed: NeighborEdge[] = [];
  let previousIndex = 0;
  let nextIndex = 0;
  while (previousIndex < previous.length && nextIndex < next.length) {
    const before = previous[previousIndex];
    const after = next[nextIndex];
    const order = compareEdgeKeys(before.from, before.to, after.from, after.to);
    if (order === 0) {
      previousIndex += 1;
      nextIndex += 1;
    } else if (order < 0) {
      removed.push(before);
      previousIndex += 1;
    } else {
      added.push(after);
      nextIndex += 1;
    }
  }
  for (; previousIndex < previous.length; previousIndex += 1) {
    removed.push(previous[previousIndex]);
  }
  for (; nextIndex < next.length; nextIndex += 1) added.push(next[nextIndex]);
  for (let index = 1; index < next.length; index += 1) {
    const a = next[index - 1];
    const b = next[index];
    if (compareEdgeKeys(a.from, a.to, b.from, b.to) >= 0) {
      throw new Error('passive selection is not in canonical order');
    }
  }
  return {
    added: packPassiveEdges(added),
    removedKeys: packPassiveKeys(removed),
    values: packPassiveValues(next),
  };
}

// ── deserialize ─────────────────────────────────────────────────────────

function validateAdjacencyRuns(serialized: SerializedNeighborAdjacency): void {
  if (
    serialized.adjacencyOffsets.length !== serialized.nodeIds.length + 1
    || serialized.adjacencyOffsets.at(-1) !== serialized.adjacentNodeIds.length
  ) {
    throw new Error('invalid packed topology adjacency buffer');
  }
}

/** Order-strict reuse probe: the previous Set is reusable only when its
 * iteration order matches the CSR run exactly — the CSR preserves Set
 * insertion order, and equal-hop routing determinism rides on it. */
function reusableNeighbourSet(
  previous: Set<number> | undefined,
  adjacentNodeIds: Float64Array,
  start: number,
  end: number,
): Set<number> | null {
  if (previous === undefined || previous.size !== end - start) return null;
  let cursor = start;
  for (const neighbourId of previous) {
    if (adjacentNodeIds[cursor] !== neighbourId) return null;
    cursor += 1;
  }
  return previous;
}

function neighbourSetFromRun(
  adjacentNodeIds: Float64Array,
  start: number,
  end: number,
): Set<number> {
  const neighbours = new Set<number>();
  for (let adjacentIndex = start; adjacentIndex < end; adjacentIndex += 1) {
    neighbours.add(adjacentNodeIds[adjacentIndex]);
  }
  return neighbours;
}

/**
 * Whole-adjacency deserialize with value reuse: every node whose CSR run is
 * order-identical to `previous`'s Set adopts that instance, everything else
 * gets a fresh Set. Reuse is decided purely by value comparison, so the
 * result always deep-equals a fresh deserialize; it is a NEW Map and the
 * previous one must be discarded by the caller (they now share instances).
 */
function deserializeAdjacencyInto(
  previous: ReadonlyMap<number, Set<number>> | null,
  serialized: SerializedNeighborAdjacency,
): Map<number, Set<number>> {
  validateAdjacencyRuns(serialized);
  const adjacency = new Map<number, Set<number>>();
  for (let index = 0; index < serialized.nodeIds.length; index += 1) {
    const nodeId = serialized.nodeIds[index];
    const start = serialized.adjacencyOffsets[index];
    const end = serialized.adjacencyOffsets[index + 1];
    if (end < start || end > serialized.adjacentNodeIds.length) {
      throw new Error('invalid packed topology adjacency offsets');
    }
    const reused = previous
      ? reusableNeighbourSet(
        previous.get(nodeId),
        serialized.adjacentNodeIds,
        start,
        end,
      )
      : null;
    adjacency.set(
      nodeId,
      reused ?? neighbourSetFromRun(serialized.adjacentNodeIds, start, end),
    );
  }
  return adjacency;
}

export function deserializeNeighborAdjacency(
  serialized: SerializedNeighborAdjacency,
): NeighborAdjacency {
  return { adjacency: deserializeAdjacencyInto(null, serialized) };
}

/** Whole display graph from a `full` response: a new graph whose unchanged
 * nodes keep `previous`'s Set instances (value-probed), with an empty eager
 * log — the previous graph and its log are superseded wholesale. */
export function deserializeLivingNeighborGraphInto(
  previous: NeighborAdjacency | null,
  serialized: SerializedNeighborAdjacency,
): LivingNeighborGraph {
  return {
    adjacency: deserializeAdjacencyInto(previous?.adjacency ?? null, serialized),
    eagerBase: new Map(),
  };
}

/**
 * Apply a display patch to the graph it was computed against, IN PLACE, in
 * O(patch + eager touches):
 *
 *  1. every changed node takes its authoritative run — keeping the instance
 *     already under the id when it reads exactly as the run (the eager mesh
 *     often grows precisely the edge the worker then confirms), else a fresh
 *     Set;
 *  2. removed nodes go;
 *  3. every OTHER node the eager mesh touched since the last apply goes back
 *     to the instance it displaced (see `LivingNeighborGraph.eagerBase`):
 *     the worker compared against its previous build, i.e. against exactly
 *     that instance, and reported it unchanged.
 *
 * The result equals the worker's build node for node, members and order.
 * Every Set instance that stays is one the worker proved unchanged, so the
 * copy-on-write contract holds; the Map is the same object, which keeps the
 * graph that batches still planning captured at request time consistent
 * with the graph the frame loop validates their hops against.
 */
export function applyNeighborAdjacencyPatch(
  graph: LivingNeighborGraph,
  patch: SerializedNeighborAdjacencyPatch,
): LivingNeighborGraph {
  const { changed, removedNodeIds } = patch;
  validateAdjacencyRuns(changed);
  const { adjacency, eagerBase } = graph;
  for (let index = 0; index < changed.nodeIds.length; index += 1) {
    const nodeId = changed.nodeIds[index];
    const start = changed.adjacencyOffsets[index];
    const end = changed.adjacencyOffsets[index + 1];
    if (end < start || end > changed.adjacentNodeIds.length) {
      throw new Error('invalid packed topology adjacency offsets');
    }
    const current = adjacency.get(nodeId);
    if (
      reusableNeighbourSet(current, changed.adjacentNodeIds, start, end) === null
    ) {
      adjacency.set(
        nodeId,
        neighbourSetFromRun(changed.adjacentNodeIds, start, end),
      );
    }
    eagerBase.delete(nodeId);
  }
  for (const nodeId of removedNodeIds) {
    adjacency.delete(nodeId);
    eagerBase.delete(nodeId);
  }
  for (const [nodeId, before] of eagerBase) {
    if (before === undefined) adjacency.delete(nodeId);
    else adjacency.set(nodeId, before);
  }
  eagerBase.clear();
  return graph;
}

// ── passive selection: deserialize ──────────────────────────────────────

/** Unpack a `PACKED_PASSIVE_EDGE_STRIDE` edge list into records, in wire
 * order (shared by the whole form, the patch and the tests). */
export function unpackPassiveEdges(packed: Float64Array): NeighborEdge[] {
  if (packed.length % PACKED_PASSIVE_EDGE_STRIDE !== 0) {
    throw new Error('invalid packed passive edge buffer');
  }
  const edges: NeighborEdge[] = [];
  for (let offset = 0; offset < packed.length; offset += PACKED_PASSIVE_EDGE_STRIDE) {
    const edge: NeighborEdge = {
      from: packed[offset],
      to: packed[offset + 1],
      d: packed[offset + 2],
    };
    const weight = packed[offset + 3];
    if (!Number.isNaN(weight)) edge.w = weight;
    edges.push(edge);
  }
  return edges;
}

/** Every key strictly ascending in canonical order — the precondition of
 * both merges below. `stride` is where the key sits in each record. */
function assertCanonicalKeyOrder(
  packed: Float64Array,
  stride: number,
  what: string,
): void {
  for (let offset = stride; offset < packed.length; offset += stride) {
    if (
      compareEdgeKeys(
        packed[offset - stride],
        packed[offset - stride + 1],
        packed[offset],
        packed[offset + 1],
      ) >= 0
    ) {
      throw new Error(`${what} is not in canonical order`);
    }
  }
}

/** Whole passive selection from a `full` response: fresh records, order
 * validated. The previous selection is superseded wholesale. */
export function deserializePassiveSelection(
  serialized: { edges: Float64Array },
): PassiveSelection {
  assertCanonicalKeyOrder(
    serialized.edges,
    PACKED_PASSIVE_EDGE_STRIDE,
    'passive selection',
  );
  const edges = unpackPassiveEdges(serialized.edges);
  const weights = new Float64Array(edges.length);
  for (let index = 0; index < edges.length; index += 1) {
    weights[index] = serialized.edges[
      index * PACKED_PASSIVE_EDGE_STRIDE + 3
    ];
  }
  return { edges, weights };
}

/** The selection's weight buffer, big enough for this build. Growth-only: a
 *  buffer a wider selection left behind is kept and only `[0, length)` is ever
 *  written or read, so no build inherits another's values. */
function ensurePassiveWeights(
  selection: PassiveSelection,
  length: number,
): Float64Array {
  const held = selection.weights;
  if (held !== undefined && held.length >= length) return held;
  const grown = new Float64Array(length);
  selection.weights = grown;
  return grown;
}

/** What one passive patch did to the held list, in the list's own records. */
export interface PassiveSelectionDelta {
  /** The records now in the list for the edges that entered. */
  added: NeighborEdge[];
  /** The very records the list dropped — `d` and `w` intact, though the
   * wire carried only their keys. */
  removed: NeighborEdge[];
  /** Surviving edges whose values moved: each got a fresh record (records
   * are immutable values — the fabric's deferred cohorts hold them across
   * builds and read the weight they were queued with). */
  rewritten: number;
}

/**
 * Apply a passive patch to the selection it was computed against, IN PLACE:
 * a sorted merge over the held list, then the list's values — O(edges +
 * churn), with no Map or Set built, and a record allocated only for an edge
 * that entered or whose values moved (see `SerializedPassiveSelectionPatch`
 * for why the latter is most of the arbor on most builds; every record the
 * merge keeps is one the worker's values confirm unchanged).
 *
 * Validates before it mutates, so a rejected patch leaves the selection
 * untouched: the buffers must be canonically ordered, every removed key must
 * name an edge the selection holds, no added key may already be in it, and
 * the values must cover exactly the merged list — anything else means the
 * patch was not computed against this list, and the builder's fallback
 * rebuilds rather than letting the fabric drift.
 */
export function applyPassiveSelectionPatch(
  selection: PassiveSelection,
  patch: SerializedPassiveSelectionPatch,
): PassiveSelectionDelta {
  const { edges } = selection;
  const { removedKeys, values } = patch;
  if (removedKeys.length % PACKED_PASSIVE_KEY_STRIDE !== 0) {
    throw new Error('invalid packed passive key buffer');
  }
  assertCanonicalKeyOrder(removedKeys, PACKED_PASSIVE_KEY_STRIDE, 'passive patch removals');
  assertCanonicalKeyOrder(patch.added, PACKED_PASSIVE_EDGE_STRIDE, 'passive patch additions');
  const added = unpackPassiveEdges(patch.added);
  const removedCount = removedKeys.length / PACKED_PASSIVE_KEY_STRIDE;
  if (
    values.length
    !== (edges.length - removedCount + added.length) * PACKED_PASSIVE_VALUE_STRIDE
  ) {
    throw new Error('passive patch values do not cover the merged selection');
  }

  // The next removed key, held in locals: the walks below compare it against
  // every edge, and are cheapest reading the buffer once per removal.
  let keyIndex = 0;
  let nextKeyFrom = removedCount > 0 ? removedKeys[0] : Number.NaN;
  let nextKeyTo = removedCount > 0 ? removedKeys[1] : Number.NaN;
  const advanceKey = (): void => {
    keyIndex += 1;
    const offset = keyIndex * PACKED_PASSIVE_KEY_STRIDE;
    nextKeyFrom = keyIndex < removedCount ? removedKeys[offset] : Number.NaN;
    nextKeyTo = keyIndex < removedCount ? removedKeys[offset + 1] : Number.NaN;
  };

  // Dry run of both merges: every removal must hit, no addition may collide
  // with a surviving edge.
  let addIndex = 0;
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    if (edge.from === nextKeyFrom && edge.to === nextKeyTo) {
      advanceKey();
      continue;
    }
    while (
      addIndex < added.length
      && compareEdgeKeys(added[addIndex].from, added[addIndex].to, edge.from, edge.to) < 0
    ) {
      addIndex += 1;
    }
    if (
      addIndex < added.length
      && added[addIndex].from === edge.from
      && added[addIndex].to === edge.to
    ) {
      throw new Error('passive patch adds an edge the selection already holds');
    }
  }
  if (keyIndex !== removedCount) {
    throw new Error('passive patch removes an edge the selection does not hold');
  }

  // Pass 1: compact the removals out, in place.
  const removed: NeighborEdge[] = [];
  let write = 0;
  keyIndex = -1;
  advanceKey();
  for (let read = 0; read < edges.length; read += 1) {
    const edge = edges[read];
    if (edge.from === nextKeyFrom && edge.to === nextKeyTo) {
      removed.push(edge);
      advanceKey();
      continue;
    }
    edges[write] = edge;
    write += 1;
  }
  // Pass 2: merge the additions in from the back, so every surviving record
  // moves at most once and the list ends in canonical order.
  const kept = write;
  edges.length = kept + added.length;
  let survivor = kept - 1;
  let addition = added.length - 1;
  for (let slot = edges.length - 1; addition >= 0; slot -= 1) {
    const next = added[addition];
    if (
      survivor >= 0
      && compareEdgeKeys(edges[survivor].from, edges[survivor].to, next.from, next.to) > 0
    ) {
      edges[slot] = edges[survivor];
      survivor -= 1;
    } else {
      edges[slot] = next;
      addition -= 1;
    }
  }
  // Pass 3: the values. The exact weights land in the parallel array, every
  // index, every build — that is what the width tier reads. A RECORD is
  // replaced, never edited, only when a reader could see the difference: its
  // distance moved, its weight crossed a class, or its weight moved by more
  // than the grain. An added record already carries this build's values, so
  // it is confirmed here, not rewritten.
  const weights = ensurePassiveWeights(selection, edges.length);
  let rewritten = 0;
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    const d = values[index * PACKED_PASSIVE_VALUE_STRIDE];
    const w = values[index * PACKED_PASSIVE_VALUE_STRIDE + 1];
    weights[index] = w;
    const next = Number.isNaN(w) ? undefined : w;
    if (
      edge.d === d
      && passiveWeightClass(edge.w) === passiveWeightClass(next)
      && (next === undefined
        || Math.abs((edge.w as number) - next) <= PASSIVE_WEIGHT_GRAIN)
    ) continue;
    const replacement: NeighborEdge = { from: edge.from, to: edge.to, d };
    if (next !== undefined) replacement.w = next;
    edges[index] = replacement;
    rewritten += 1;
  }
  // The count the caller returns to the fabric is also the one number that
  // says how much of this landing was the arbor rescale; without it here the
  // reading exists only inside an off-line probe.
  neighborGraphBuilderStats.rewritten += rewritten;
  neighborGraphBuilderStats.rewrittenLast = rewritten;
  return { added, removed, rewritten };
}

// ── session ─────────────────────────────────────────────────────────────

export interface NeighborGraphWorkerSession {
  execute(
    request: NeighborGraphWorkerRequest,
  ): NeighborGraphWorkerSuccess | NeighborGraphWorkerStale;
}

/** Stateful worker session: retains the previous build so each response can
 * carry patches (display adjacency, passive selection) computed OFF the
 * main thread, and reuses its own previous passive selection as the
 * continuity preference instead of having the main thread pack it back. */
export function createNeighborGraphWorkerSession(): NeighborGraphWorkerSession {
  let generation = 0;
  let lastGraph: NeighborGraph | null = null;
  /** The previous build's passive selection, canonical order. It doubles as
   * the continuity preference and as the base of the next passive patch. */
  let lastPassiveEdges: NeighborEdge[] | null = null;
  let lastCells: Map<number, NeighborGraphCell> | null = null;

  return {
    execute(request) {
      let cells: Map<number, NeighborGraphCell>;
      if (request.cells !== null) {
        cells = unpackTopologyCells(request.cells);
      } else if (request.cellsDelta !== null && lastCells !== null) {
        if (request.cellsDelta.baseGeneration !== generation) {
          return { kind: 'stale', requestId: request.requestId };
        }
        const delta = request.cellsDelta;
        for (const id of delta.removedIds) lastCells.delete(id);
        if (delta.upserts.length % PACKED_TOPOLOGY_CELL_STRIDE !== 0) {
          throw new Error('invalid packed topology delta buffer');
        }
        for (
          let offset = 0;
          offset < delta.upserts.length;
          offset += PACKED_TOPOLOGY_CELL_STRIDE
        ) {
          const id = delta.upserts[offset];
          lastCells.set(id, {
            id,
            death_at_ms: null,
            pos_seed: [
              delta.upserts[offset + 1],
              delta.upserts[offset + 2],
              delta.upserts[offset + 3],
            ],
          });
        }
        cells = lastCells;
      } else {
        return { kind: 'stale', requestId: request.requestId };
      }
      lastCells = cells;
      const graph = buildNeighborGraph(cells, request.options);
      const passiveGraph = request.includePassive
        ? buildPassiveNeighborGraph(graph, {
          edgeBudget: request.passiveEdgeBudget ?? undefined,
          coverageShare: request.passiveTuning?.coverageShare,
          trunkShare: request.passiveTuning?.trunkShare,
          twigShare: request.passiveTuning?.twigShare,
          preferredEdges:
            lastPassiveEdges ?? unpackPreferredEdges(request.preferredEdges),
        })
        : null;

      // A patch is exact only against the build the requester holds. The
      // requester names it by generation; anything else (fresh session, a
      // superseded build in between, a caller that cannot patch) gets the
      // whole forms, which are always correct. One decision for both
      // graphs: they were applied together from that generation.
      const patchable =
        lastGraph !== null
        && request.patchBaseGeneration > 0
        && request.patchBaseGeneration === generation;
      const displayGraph: SerializedDisplayGraph = patchable
        ? { kind: 'patch', patch: collectNeighborAdjacencyPatch(lastGraph!, graph) }
        : { kind: 'full', adjacency: serializeNeighborAdjacency(graph) };
      let passiveSelection: SerializedPassiveSelection | null = null;
      if (passiveGraph !== null) {
        passiveSelection = patchable && lastPassiveEdges !== null
          ? {
            kind: 'patch',
            patch: collectPassiveSelectionPatch(lastPassiveEdges, passiveGraph.edges),
          }
          : { kind: 'full', edges: packPassiveEdges(passiveGraph.edges) };
      }

      generation += 1;
      lastGraph = graph;
      // The selection's own array: the builder returns it sorted and nothing
      // in the session writes to it afterwards.
      lastPassiveEdges = passiveGraph ? passiveGraph.edges : null;

      return {
        kind: 'built',
        requestId: request.requestId,
        generation,
        graph: displayGraph,
        passiveGraph: passiveSelection,
      };
    },
  };
}

/** Stateless entry point retained for tests and one-shot use. A one-shot
 * session cannot satisfy a delta request (no retained cells), so this only
 * accepts full-pack requests. */
export function executeNeighborGraphWorkerRequest(
  request: NeighborGraphWorkerRequest,
): NeighborGraphWorkerSuccess {
  const response = createNeighborGraphWorkerSession().execute(request);
  if (response.kind !== 'built') {
    throw new Error('one-shot worker request requires a full cell pack');
  }
  return response;
}

/** Every transferable buffer a response carries, for `postMessage`. */
export function neighborGraphResponseTransferList(
  response: NeighborGraphWorkerSuccess,
): Transferable[] {
  const transfer: Transferable[] = [];
  const pushRuns = (runs: SerializedNeighborAdjacency): void => {
    transfer.push(
      runs.nodeIds.buffer,
      runs.adjacencyOffsets.buffer,
      runs.adjacentNodeIds.buffer,
    );
  };
  if (response.graph.kind === 'full') {
    pushRuns(response.graph.adjacency);
  } else {
    pushRuns(response.graph.patch.changed);
    transfer.push(response.graph.patch.removedNodeIds.buffer);
  }
  if (response.passiveGraph !== null) {
    if (response.passiveGraph.kind === 'full') {
      transfer.push(response.passiveGraph.edges.buffer);
    } else {
      transfer.push(
        response.passiveGraph.patch.added.buffer,
        response.passiveGraph.patch.removedKeys.buffer,
        response.passiveGraph.patch.values.buffer,
      );
    }
  }
  return transfer;
}
