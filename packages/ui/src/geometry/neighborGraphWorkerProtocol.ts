import {
  buildNeighborGraph,
  type LivingNeighborGraph,
  type NeighborAdjacency,
  type NeighborEdge,
  type NeighborGraph,
  type NeighborGraphCell,
  type NeighborGraphOptions,
} from './neighborGraph';
import { buildPassiveNeighborGraph } from './passiveNeighborGraph';

export const PACKED_TOPOLOGY_CELL_STRIDE = 4;
export const PACKED_TOPOLOGY_EDGE_STRIDE = 4;
export const PACKED_PREFERRED_EDGE_STRIDE = 2;

/** CSR adjacency preserving each Set's insertion order for deterministic
 * equal-hop routing choices. */
export interface SerializedNeighborAdjacency {
  nodeIds: Float64Array;
  adjacencyOffsets: Uint32Array;
  adjacentNodeIds: Float64Array;
}

/** Adjacency plus the dense edge list: the PASSIVE graph's wire form. The
 * display graph never carries `edges` — at ~36K edges × 4 doubles that was
 * a 1.15 MB buffer per build rebuilt into as many fresh objects on the main
 * thread, and nothing there reads a display edge. */
export interface SerializedNeighborGraph extends SerializedNeighborAdjacency {
  /** Repeated `[from, to, distance, arborWeight]`; `NaN` means no weight. */
  edges: Float64Array;
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
  /** Session generation of the display graph the requester currently holds
   * (0 = none, or a caller that cannot patch). When it names the session's
   * previous build, the response carries a patch against that build instead
   * of the whole adjacency; otherwise the whole adjacency rides, which is
   * always correct. Independent of `cellsDelta`: a full cell pack can still
   * be answered with a patch, and the chain is decided here, not in the
   * builder after the fact. */
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
  /** Monotonic per-session build counter. The main thread only trusts the
   * incremental hints below when generations chain without a gap; otherwise
   * it falls back to the full order-strict probe, which is always correct. */
  generation: number;
  /** Display adjacency, whole or patched — see {@link SerializedDisplayGraph}.
   * A patch is only ever sent when the request's `patchBaseGeneration` was
   * this session's previous build, so it always chains. */
  graph: SerializedDisplayGraph;
  passiveGraph: SerializedNeighborGraph | null;
  /** Ids (passive graph) whose adjacency differs from this session's PREVIOUS
   * passive graph — compared in the worker with the same order-strict probe
   * the main thread would run. Null = no previous build in this session.
   * Without it the passive deserialize runs the O(V) probing path on every
   * block. */
  passiveChangedNodeIds: Float64Array | null;
  /** Passive-selection delta vs this session's previous selection, packed
   * `[from, to, d, w(NaN=none)]` / `[from, to]`. Null when no previous
   * selection exists (consumer must treat passiveGraph as a full set). */
  passiveAdded: Float64Array | null;
  passiveRemoved: Float64Array | null;
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
  const cells = new Map<number, NeighborGraphCell>();
  for (let offset = 0; offset < packed.length; offset += PACKED_TOPOLOGY_CELL_STRIDE) {
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

export function serializeNeighborGraph(
  graph: NeighborGraph,
): SerializedNeighborGraph {
  const edges = new Float64Array(graph.edges.length * PACKED_TOPOLOGY_EDGE_STRIDE);
  let edgeOffset = 0;
  for (const edge of graph.edges) {
    edges[edgeOffset] = edge.from;
    edges[edgeOffset + 1] = edge.to;
    edges[edgeOffset + 2] = edge.d;
    edges[edgeOffset + 3] = edge.w ?? Number.NaN;
    edgeOffset += PACKED_TOPOLOGY_EDGE_STRIDE;
  }
  return { ...serializeNeighborAdjacency(graph), edges };
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

/** Ids whose passive adjacency differs from the previous build's (the
 * passive graph still deserializes whole, so only the id list rides). */
function collectChangedNodeIds(
  previous: NeighborAdjacency,
  next: NeighborAdjacency,
): Float64Array {
  const changed: number[] = [];
  for (const [id, neighbours] of next.adjacency) {
    if (!sameNeighbourRun(previous.adjacency.get(id), neighbours)) {
      changed.push(id);
    }
  }
  return Float64Array.from(changed);
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

/** Positional edge-record value-reuse: an edge record whose four values
 * sit at the same index in the previous list keeps its object identity.
 * Passive lists are canonically sorted and small, so per-block churn shifts
 * only a suffix. */
function reuseEdgeRecords(
  previousEdges: readonly NeighborEdge[] | null,
  serialized: SerializedNeighborGraph,
): NeighborEdge[] {
  if (serialized.edges.length % PACKED_TOPOLOGY_EDGE_STRIDE !== 0) {
    throw new Error('invalid packed topology edge buffer');
  }
  const edges: NeighborEdge[] = [];
  let edgeIndex = 0;
  for (
    let offset = 0;
    offset < serialized.edges.length;
    offset += PACKED_TOPOLOGY_EDGE_STRIDE
  ) {
    const from = serialized.edges[offset];
    const to = serialized.edges[offset + 1];
    const d = serialized.edges[offset + 2];
    const weight = serialized.edges[offset + 3];
    const hasWeight = !Number.isNaN(weight);
    const candidate = previousEdges !== null && edgeIndex < previousEdges.length
      ? previousEdges[edgeIndex]
      : undefined;
    if (
      candidate !== undefined
      && candidate.from === from
      && candidate.to === to
      && candidate.d === d
      && (hasWeight ? candidate.w === weight : candidate.w === undefined)
    ) {
      edges.push(candidate);
    } else {
      const edge: NeighborEdge = { from, to, d };
      if (hasWeight) edge.w = weight;
      edges.push(edge);
    }
    edgeIndex += 1;
  }
  return edges;
}

export function deserializeNeighborGraph(
  serialized: SerializedNeighborGraph,
): NeighborGraph {
  return deserializeNeighborGraphInto(null, serialized);
}

/**
 * Deserialize a whole graph (adjacency + edges — the passive graph), reusing
 * the previous graph's per-node Sets and positionally unchanged edge records
 * wherever the payload is value-identical. The returned graph is a new
 * object and the previous one must be discarded by the caller.
 */
export function deserializeNeighborGraphInto(
  previous: NeighborGraph | null,
  serialized: SerializedNeighborGraph,
): NeighborGraph {
  const edges = reuseEdgeRecords(previous?.edges ?? null, serialized);
  return {
    adjacency: deserializeAdjacencyInto(previous?.adjacency ?? null, serialized),
    edges,
  };
}

/**
 * Hint-guided variant of `deserializeNeighborGraphInto` for the passive
 * graph: nodes absent from `changedNodeIds` adopt the previous graph's Set
 * instance WITHOUT the per-neighbour probe (the worker already ran the
 * identical order-strict comparison against the same previous build).
 * Callers must only pass hints whose generation chains from the previously
 * applied response; with null hints this is exactly the probing deserialize.
 */
export function deserializeNeighborGraphWithHints(
  previous: NeighborGraph | null,
  serialized: SerializedNeighborGraph,
  changedNodeIds: Float64Array | null,
): NeighborGraph {
  if (previous === null || changedNodeIds === null) {
    return deserializeNeighborGraphInto(previous, serialized);
  }
  validateAdjacencyRuns(serialized);
  const changed = new Set(changedNodeIds);
  const adjacency = new Map<number, Set<number>>();
  for (let index = 0; index < serialized.nodeIds.length; index += 1) {
    const nodeId = serialized.nodeIds[index];
    const start = serialized.adjacencyOffsets[index];
    const end = serialized.adjacencyOffsets[index + 1];
    if (end < start || end > serialized.adjacentNodeIds.length) {
      throw new Error('invalid packed topology adjacency offsets');
    }
    if (!changed.has(nodeId)) {
      const before = previous.adjacency.get(nodeId);
      // Defensive: a missing/mis-sized previous Set means the hint cannot
      // be honored for this node; rebuilding is always correct.
      if (before !== undefined && before.size === end - start) {
        adjacency.set(nodeId, before);
        continue;
      }
    }
    adjacency.set(
      nodeId,
      neighbourSetFromRun(serialized.adjacentNodeIds, start, end),
    );
  }
  // Edge records keep the positional value-reuse of the probing path,
  // without paying for that path's adjacency rebuild.
  return { adjacency, edges: reuseEdgeRecords(previous.edges, serialized) };
}

// ── passive delta packing ───────────────────────────────────────────────

const PACKED_DELTA_EDGE_STRIDE = 4;

function packEdgeList(edges: readonly NeighborEdge[]): Float64Array {
  const packed = new Float64Array(edges.length * PACKED_DELTA_EDGE_STRIDE);
  let offset = 0;
  for (const edge of edges) {
    packed[offset] = edge.from;
    packed[offset + 1] = edge.to;
    packed[offset + 2] = edge.d;
    packed[offset + 3] = edge.w ?? Number.NaN;
    offset += PACKED_DELTA_EDGE_STRIDE;
  }
  return packed;
}

/** Unpack a `[from,to,d,w]` delta edge list (shared by tests + consumers). */
export function unpackDeltaEdges(packed: Float64Array | null): NeighborEdge[] {
  if (packed === null) return [];
  if (packed.length % PACKED_DELTA_EDGE_STRIDE !== 0) {
    throw new Error('invalid packed delta edge buffer');
  }
  const edges: NeighborEdge[] = [];
  for (let offset = 0; offset < packed.length; offset += PACKED_DELTA_EDGE_STRIDE) {
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

function edgeSetKey(edge: NeighborEdge): string {
  return `${edge.from}:${edge.to}`;
}

// ── session ─────────────────────────────────────────────────────────────

export interface NeighborGraphWorkerSession {
  execute(
    request: NeighborGraphWorkerRequest,
  ): NeighborGraphWorkerSuccess | NeighborGraphWorkerStale;
}

/** Stateful worker session: retains the previous build so each response can
 * carry incremental hints (display patch, passive changed nodes, passive
 * selection delta) computed OFF the main thread, and reuses its own
 * previous passive selection as the continuity preference instead of
 * having the main thread pack it back. */
export function createNeighborGraphWorkerSession(): NeighborGraphWorkerSession {
  let generation = 0;
  let lastGraph: NeighborGraph | null = null;
  let lastPassiveGraph: NeighborGraph | null = null;
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
      // whole adjacency, which is always correct.
      const displayGraph: SerializedDisplayGraph =
        lastGraph !== null
        && request.patchBaseGeneration > 0
        && request.patchBaseGeneration === generation
          ? { kind: 'patch', patch: collectNeighborAdjacencyPatch(lastGraph, graph) }
          : { kind: 'full', adjacency: serializeNeighborAdjacency(graph) };
      const passiveChangedNodeIds =
        passiveGraph !== null && lastPassiveGraph !== null
          ? collectChangedNodeIds(lastPassiveGraph, passiveGraph)
          : null;

      let passiveAdded: Float64Array | null = null;
      let passiveRemoved: Float64Array | null = null;
      if (passiveGraph !== null && lastPassiveEdges !== null) {
        const beforeByKey = new Map(
          lastPassiveEdges.map((edge) => [edgeSetKey(edge), edge]),
        );
        const added: NeighborEdge[] = [];
        const afterKeys = new Set<string>();
        for (const edge of passiveGraph.edges) {
          const key = edgeSetKey(edge);
          afterKeys.add(key);
          if (!beforeByKey.has(key)) added.push(edge);
        }
        const removed: NeighborEdge[] = [];
        for (const edge of lastPassiveEdges) {
          if (!afterKeys.has(edgeSetKey(edge))) removed.push(edge);
        }
        passiveAdded = packEdgeList(added);
        passiveRemoved = packEdgeList(removed);
      }

      generation += 1;
      lastGraph = graph;
      lastPassiveGraph = passiveGraph;
      lastPassiveEdges = passiveGraph ? [...passiveGraph.edges] : null;

      return {
        kind: 'built',
        requestId: request.requestId,
        generation,
        graph: displayGraph,
        passiveGraph: passiveGraph ? serializeNeighborGraph(passiveGraph) : null,
        passiveChangedNodeIds,
        passiveAdded,
        passiveRemoved,
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
  if (response.passiveChangedNodeIds) {
    transfer.push(response.passiveChangedNodeIds.buffer);
  }
  if (response.passiveAdded) transfer.push(response.passiveAdded.buffer);
  if (response.passiveRemoved) transfer.push(response.passiveRemoved.buffer);
  if (response.passiveGraph) {
    pushRuns(response.passiveGraph);
    transfer.push(response.passiveGraph.edges.buffer);
  }
  return transfer;
}
