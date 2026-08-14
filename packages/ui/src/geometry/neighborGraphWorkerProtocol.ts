import {
  buildNeighborGraph,
  type NeighborEdge,
  type NeighborGraph,
  type NeighborGraphCell,
  type NeighborGraphOptions,
} from './neighborGraph';
import { buildPassiveNeighborGraph } from './passiveNeighborGraph';

export const PACKED_TOPOLOGY_CELL_STRIDE = 4;
export const PACKED_TOPOLOGY_EDGE_STRIDE = 4;
export const PACKED_PREFERRED_EDGE_STRIDE = 2;

export interface SerializedNeighborGraph {
  nodeIds: Float64Array;
  /** CSR adjacency preserving each Set's insertion order for deterministic
   * equal-hop routing choices. */
  adjacencyOffsets: Uint32Array;
  adjacentNodeIds: Float64Array;
  /** Repeated `[from, to, distance, arborWeight]`; `NaN` means no weight. */
  edges: Float64Array;
}

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
  graph: SerializedNeighborGraph;
  passiveGraph: SerializedNeighborGraph | null;
  /** Ids (new graph) whose adjacency differs from this session's PREVIOUS
   * graph — compared in the worker with the same order-strict probe the main
   * thread would run. Null = no previous build in this session. */
  changedNodeIds: Float64Array | null;
  /** Same, for the passive graph — without it the passive deserialize runs
   * the O(V) probing path on every block. */
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

export function serializeNeighborGraph(
  graph: NeighborGraph,
): SerializedNeighborGraph {
  const nodeIds = new Float64Array(graph.adjacency.size);
  const adjacencyOffsets = new Uint32Array(graph.adjacency.size + 1);
  let adjacentNodeCount = 0;
  for (const neighbours of graph.adjacency.values()) {
    adjacentNodeCount += neighbours.size;
  }
  const adjacentNodeIds = new Float64Array(adjacentNodeCount);
  let nodeIndex = 0;
  let adjacentNodeIndex = 0;
  for (const [id, neighbours] of graph.adjacency) {
    nodeIds[nodeIndex] = id;
    adjacencyOffsets[nodeIndex] = adjacentNodeIndex;
    for (const neighbourId of neighbours) {
      adjacentNodeIds[adjacentNodeIndex] = neighbourId;
      adjacentNodeIndex += 1;
    }
    nodeIndex += 1;
  }
  adjacencyOffsets[nodeIndex] = adjacentNodeIndex;

  const edges = new Float64Array(graph.edges.length * PACKED_TOPOLOGY_EDGE_STRIDE);
  let edgeOffset = 0;
  for (const edge of graph.edges) {
    edges[edgeOffset] = edge.from;
    edges[edgeOffset + 1] = edge.to;
    edges[edgeOffset + 2] = edge.d;
    edges[edgeOffset + 3] = edge.w ?? Number.NaN;
    edgeOffset += PACKED_TOPOLOGY_EDGE_STRIDE;
  }
  return { nodeIds, adjacencyOffsets, adjacentNodeIds, edges };
}

export function deserializeNeighborGraph(
  serialized: SerializedNeighborGraph,
): NeighborGraph {
  return deserializeNeighborGraphInto(null, serialized);
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

/**
 * Deserialize a worker CSR result, reusing the previous graph's per-node
 * neighbour Sets (and positionally unchanged edge records) wherever the new
 * payload is value-identical. Between consecutive per-block display builds
 * almost every node is untouched, so the old path's fresh Set per node plus
 * fresh object per edge — the dominant main-thread cost of a worker
 * completion — collapses to O(changed). Reuse is decided purely by value
 * comparison, so the result always deep-equals a fresh deserialize; the
 * returned graph is a new object and the previous one must be discarded by
 * the caller (they may now share Set instances).
 */
/** Positional edge-record value-reuse of the probing path, shared by the
 *  full deserializer and the hint-guided one — the hinted path must not pay
 *  for a throwaway adjacency (a fresh Set per node, discarded by the caller)
 *  just to keep previous edge object identities. */
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

export function deserializeNeighborGraphInto(
  previous: NeighborGraph | null,
  serialized: SerializedNeighborGraph,
): NeighborGraph {
  const edges = reuseEdgeRecords(previous?.edges ?? null, serialized);
  if (
    serialized.adjacencyOffsets.length !== serialized.nodeIds.length + 1
    || serialized.adjacencyOffsets.at(-1) !== serialized.adjacentNodeIds.length
  ) {
    throw new Error('invalid packed topology adjacency buffer');
  }
  const previousAdjacency = previous?.adjacency ?? null;
  const adjacency = new Map<number, Set<number>>();
  for (let index = 0; index < serialized.nodeIds.length; index += 1) {
    const nodeId = serialized.nodeIds[index];
    const start = serialized.adjacencyOffsets[index];
    const end = serialized.adjacencyOffsets[index + 1];
    if (end < start || end > serialized.adjacentNodeIds.length) {
      throw new Error('invalid packed topology adjacency offsets');
    }
    const reused = previousAdjacency
      ? reusableNeighbourSet(
        previousAdjacency.get(nodeId),
        serialized.adjacentNodeIds,
        start,
        end,
      )
      : null;
    if (reused !== null) {
      adjacency.set(nodeId, reused);
      continue;
    }
    const neighbours = new Set<number>();
    for (let adjacentIndex = start; adjacentIndex < end; adjacentIndex += 1) {
      neighbours.add(serialized.adjacentNodeIds[adjacentIndex]);
    }
    adjacency.set(nodeId, neighbours);
  }

  return { adjacency, edges };
}

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

/** Worker-side diff of the new graph against the session's previous one,
 * using the SAME order-strict comparison the main thread's reuse probe runs
 * — so "unchanged" here is exactly "the main thread may adopt its previous
 * Set instance without probing". */
function collectChangedNodeIds(
  previous: NeighborGraph,
  next: NeighborGraph,
): Float64Array {
  const changed: number[] = [];
  for (const [id, neighbours] of next.adjacency) {
    const before = previous.adjacency.get(id);
    if (before === undefined || before.size !== neighbours.size) {
      changed.push(id);
      continue;
    }
    const iterator = before.values();
    let same = true;
    for (const neighbourId of neighbours) {
      if (iterator.next().value !== neighbourId) {
        same = false;
        break;
      }
    }
    if (!same) changed.push(id);
  }
  return Float64Array.from(changed);
}

export interface NeighborGraphWorkerSession {
  execute(
    request: NeighborGraphWorkerRequest,
  ): NeighborGraphWorkerSuccess | NeighborGraphWorkerStale;
}

/** Stateful worker session: retains the previous build so each response can
 * carry incremental hints (changed nodes, passive-selection delta) computed
 * OFF the main thread, and reuses its own previous passive selection as the
 * continuity preference instead of having the main thread pack it back. */
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

      const changedNodeIds = lastGraph !== null
        ? collectChangedNodeIds(lastGraph, graph)
        : null;
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
        graph: serializeNeighborGraph(graph),
        passiveGraph: passiveGraph ? serializeNeighborGraph(passiveGraph) : null,
        changedNodeIds,
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

/**
 * Hint-guided variant of `deserializeNeighborGraphInto`: nodes absent from
 * `changedNodeIds` adopt the previous graph's Set instance WITHOUT the
 * per-neighbour probe (the worker already ran the identical order-strict
 * comparison against the same previous build). Callers must only pass hints
 * whose generation chains from the previously applied response; with null
 * hints this is exactly the probing deserialize.
 */
export function deserializeNeighborGraphWithHints(
  previous: NeighborGraph | null,
  serialized: SerializedNeighborGraph,
  changedNodeIds: Float64Array | null,
): NeighborGraph {
  if (previous === null || changedNodeIds === null) {
    return deserializeNeighborGraphInto(previous, serialized);
  }
  if (
    serialized.adjacencyOffsets.length !== serialized.nodeIds.length + 1
    || serialized.adjacencyOffsets.at(-1) !== serialized.adjacentNodeIds.length
  ) {
    throw new Error('invalid packed topology adjacency buffer');
  }
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
    const neighbours = new Set<number>();
    for (let adjacentIndex = start; adjacentIndex < end; adjacentIndex += 1) {
      neighbours.add(serialized.adjacentNodeIds[adjacentIndex]);
    }
    adjacency.set(nodeId, neighbours);
  }
  // Edge records keep the positional value-reuse of the probing path,
  // without paying for that path's adjacency rebuild.
  return { adjacency, edges: reuseEdgeRecords(previous.edges, serialized) };
}
