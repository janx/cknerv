import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import { buildNeighborGraph } from '../../src/geometry/neighborGraph';
import { shortestPath } from '../../src/geometry/pathRouter';
import { buildPassiveNeighborGraph } from '../../src/geometry/passiveNeighborGraph';
import {
  deserializeNeighborGraph,
  deserializeNeighborGraphInto,
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
      edgeBudget: 4,
      preferredEdges,
    });

    const response = executeNeighborGraphWorkerRequest({
      kind: 'build',
      requestId: 42,
      cells: packTopologyCells(cells),
      options,
      includePassive: true,
      passiveEdgeBudget: 4,
      preferredEdges: packPreferredEdges(preferredEdges),
    });

    expect(response.requestId).toBe(42);
    expect(deserializeNeighborGraph(response.graph)).toEqual(expectedGraph);
    expect(response.passiveGraph).not.toBeNull();
    expect(deserializeNeighborGraph(response.passiveGraph!))
      .toEqual(expectedPassive);
  });

  describe('patch deserialization (deserializeNeighborGraphInto)', () => {
    it('reuses every Set and edge when the payload is unchanged', () => {
      const graph = buildNeighborGraph(fixtureCells(), { k: 2, maxEdgeLength: 8 });
      const serialized = serializeNeighborGraph(graph);
      const base = deserializeNeighborGraph(serialized);
      const patched = deserializeNeighborGraphInto(base, serialized);

      expect(patched).not.toBe(base);
      expect(patched).toEqual(base);
      for (const [id, neighbours] of base.adjacency) {
        expect(patched.adjacency.get(id)).toBe(neighbours);
      }
      for (let index = 0; index < base.edges.length; index += 1) {
        expect(patched.edges[index]).toBe(base.edges[index]);
      }
    });

    it('patches only changed nodes and deep-equals a fresh deserialize', () => {
      const cells = fixtureCells();
      const before = buildNeighborGraph(cells, { k: 2, maxEdgeLength: 8 });
      const base = deserializeNeighborGraph(serializeNeighborGraph(before));

      // One new cell near the 1–4 cluster changes a few nodes' adjacency and
      // appends edges; distant nodes keep their exact runs.
      cells.set(9, cell(9, 1, 1));
      const after = buildNeighborGraph(cells, { k: 2, maxEdgeLength: 8 });
      const serializedAfter = serializeNeighborGraph(after);
      const fresh = deserializeNeighborGraph(serializedAfter);
      const patched = deserializeNeighborGraphInto(base, serializedAfter);

      expect(patched).toEqual(fresh);
      let reusedSets = 0;
      for (const [id, neighbours] of patched.adjacency) {
        if (base.adjacency.get(id) === neighbours) reusedSets += 1;
        expect([...neighbours]).toEqual([...(fresh.adjacency.get(id) ?? [])]);
      }
      expect(reusedSets).toBeGreaterThan(0);
      expect(reusedSets).toBeLessThan(patched.adjacency.size);
    });

    it('rejects a previous Set whose members match but whose order differs', () => {
      const graph = buildNeighborGraph(fixtureCells(), { k: 2, maxEdgeLength: 8 });
      const serialized = serializeNeighborGraph(graph);
      const base = deserializeNeighborGraph(serialized);
      // Reverse one node's Set order in the "previous" graph.
      const someNode = [...base.adjacency.entries()]
        .find(([, neighbours]) => neighbours.size >= 2);
      expect(someNode).toBeDefined();
      const [nodeId, neighbours] = someNode!;
      base.adjacency.set(nodeId, new Set([...neighbours].reverse()));

      const patched = deserializeNeighborGraphInto(base, serialized);
      expect(patched.adjacency.get(nodeId)).not.toBe(base.adjacency.get(nodeId));
      // CSR order wins — deterministic equal-hop routing depends on it.
      expect([...patched.adjacency.get(nodeId)!])
        .toEqual([...(deserializeNeighborGraph(serialized).adjacency.get(nodeId)!)]);
    });
  });
});
