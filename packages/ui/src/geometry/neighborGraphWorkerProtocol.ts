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
  if (serialized.edges.length % PACKED_TOPOLOGY_EDGE_STRIDE !== 0) {
    throw new Error('invalid packed topology edge buffer');
  }
  if (
    serialized.adjacencyOffsets.length !== serialized.nodeIds.length + 1
    || serialized.adjacencyOffsets.at(-1) !== serialized.adjacentNodeIds.length
  ) {
    throw new Error('invalid packed topology adjacency buffer');
  }
  const adjacency = new Map<number, Set<number>>();
  for (let index = 0; index < serialized.nodeIds.length; index += 1) {
    const neighbours = new Set<number>();
    const start = serialized.adjacencyOffsets[index];
    const end = serialized.adjacencyOffsets[index + 1];
    if (end < start || end > serialized.adjacentNodeIds.length) {
      throw new Error('invalid packed topology adjacency offsets');
    }
    for (let adjacentIndex = start; adjacentIndex < end; adjacentIndex += 1) {
      neighbours.add(serialized.adjacentNodeIds[adjacentIndex]);
    }
    adjacency.set(serialized.nodeIds[index], neighbours);
  }

  const edges: NeighborEdge[] = [];
  for (
    let offset = 0;
    offset < serialized.edges.length;
    offset += PACKED_TOPOLOGY_EDGE_STRIDE
  ) {
    const from = serialized.edges[offset];
    const to = serialized.edges[offset + 1];
    const weight = serialized.edges[offset + 3];
    const edge: NeighborEdge = {
      from,
      to,
      d: serialized.edges[offset + 2],
    };
    if (!Number.isNaN(weight)) edge.w = weight;
    edges.push(edge);
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
