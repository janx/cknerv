import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import { buildNeighborGraph } from '../../src/geometry/neighborGraph';
import { shortestPath } from '../../src/geometry/pathRouter';
import { buildPassiveNeighborGraph } from '../../src/geometry/passiveNeighborGraph';
import {
  deserializeNeighborGraph,
  executeNeighborGraphWorkerRequest,
  packPreferredEdges,
  packTopologyCells,
  serializeNeighborGraph,
  unpackTopologyCells,
} from '../../src/geometry/neighborGraphWorkerProtocol';

function cell(
  id: number,
  x: number,
  z: number,
  deathAt: number | null = null,
): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: deathAt,
    birth_block: 1,
    tag: null,
    pos_seed: [x, id * 0.01, z],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 1,
    data_hex: `0x${'ff'.repeat(256)}`,
    content_hash: `0x${id}`,
  };
}

function fixtureCells(): Map<number, Cell> {
  return new Map([
    [1, cell(1, 0, 0)],
    [2, cell(2, 2, 0)],
    [3, cell(3, 0, 2)],
    [4, cell(4, 2, 2)],
    [5, cell(5, 6, 1)],
    [6, cell(6, 9, 3)],
    [7, cell(7, 4, 8)],
    [8, cell(8, 20, 20, 100)],
  ]);
}

describe('neighbor graph Worker protocol', () => {
  it('packs only the minimal topology fields for live Cells', () => {
    const cells = fixtureCells();
    const packed = packTopologyCells(cells);
    const unpacked = unpackTopologyCells(packed);

    expect(packed).toHaveLength(7 * 4);
    expect([...unpacked.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(unpacked.get(1)).toEqual({
      id: 1,
      death_at_ms: null,
      pos_seed: [0, 0.01, 0],
    });
    expect(JSON.stringify([...unpacked.values()])).not.toContain('data_hex');
  });

  it('round-trips graph nodes, ordered edges, distances, and arbor weights', () => {
    const graph = buildNeighborGraph(fixtureCells(), { k: 2, maxEdgeLength: 8 });
    const restored = deserializeNeighborGraph(serializeNeighborGraph(graph));
    expect(restored).toEqual(graph);
    for (const [id, neighbours] of graph.adjacency) {
      expect([...(restored.adjacency.get(id) ?? [])]).toEqual([...neighbours]);
    }
    for (const [from, to] of [[1, 7], [2, 6], [5, 3]]) {
      expect(shortestPath(restored, from, to))
        .toEqual(shortestPath(graph, from, to));
    }
  });

  it('builds the same full and preferred passive graphs as the main-thread path', () => {
    const cells = fixtureCells();
    const options = { k: 2, maxEdgeLength: 8 };
    const expectedGraph = buildNeighborGraph(cells, options);
    const preferredEdges = expectedGraph.edges.slice(-3);
    const expectedPassive = buildPassiveNeighborGraph(expectedGraph, {
      preferredEdges,
    });

    const response = executeNeighborGraphWorkerRequest({
      kind: 'build',
      requestId: 42,
      cells: packTopologyCells(cells),
      options,
      includePassive: true,
      preferredEdges: packPreferredEdges(preferredEdges),
    });

    expect(response.requestId).toBe(42);
    expect(deserializeNeighborGraph(response.graph)).toEqual(expectedGraph);
    expect(response.passiveGraph).not.toBeNull();
    expect(deserializeNeighborGraph(response.passiveGraph!))
      .toEqual(expectedPassive);
  });
});
