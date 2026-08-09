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

export interface NeighborGraphWorkerRequest {
  kind: 'build';
  requestId: number;
  cells: Float64Array;
  options: NeighborGraphOptions;
  includePassive: boolean;
  /** Visual-only edge cap; null selects the canonical population-derived cap. */
  passiveEdgeBudget: number | null;
  /** Repeated `[from, to]` keys retained from the current passive fabric. */
  preferredEdges: Float64Array | null;
}

export interface NeighborGraphWorkerSuccess {
  kind: 'built';
  requestId: number;
  graph: SerializedNeighborGraph;
  passiveGraph: SerializedNeighborGraph | null;
}

export interface NeighborGraphWorkerFailure {
  kind: 'failed';
  requestId: number;
  message: string;
}

export type NeighborGraphWorkerResponse =
  | NeighborGraphWorkerSuccess
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
export function deserializeNeighborGraphInto(
  previous: NeighborGraph | null,
  serialized: SerializedNeighborGraph,
): NeighborGraph {
  if (serialized.edges.length % PACKED_TOPOLOGY_EDGE_STRIDE !== 0) {
    throw new Error('invalid packed topology edge buffer');
  }
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

  const previousEdges = previous?.edges ?? null;
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
  return { adjacency, edges };
}

/** Pure Worker entry point, also exercised directly by protocol tests. */
export function executeNeighborGraphWorkerRequest(
  request: NeighborGraphWorkerRequest,
): NeighborGraphWorkerSuccess {
  const cells = unpackTopologyCells(request.cells);
  const graph = buildNeighborGraph(cells, request.options);
  const passiveGraph = request.includePassive
    ? buildPassiveNeighborGraph(graph, {
      edgeBudget: request.passiveEdgeBudget ?? undefined,
      preferredEdges: unpackPreferredEdges(request.preferredEdges),
    })
    : null;
  return {
    kind: 'built',
    requestId: request.requestId,
    graph: serializeNeighborGraph(graph),
    passiveGraph: passiveGraph ? serializeNeighborGraph(passiveGraph) : null,
  };
}
