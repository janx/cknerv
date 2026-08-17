import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import { buildNeighborGraph } from '../../src/geometry/neighborGraph';
import { shortestPath } from '../../src/geometry/pathRouter';
import { buildPassiveNeighborGraph } from '../../src/geometry/passiveNeighborGraph';
import {
  createNeighborGraphWorkerSession,
  deserializeNeighborGraph,
  deserializeNeighborGraphInto,
  deserializeNeighborGraphWithHints,
  executeNeighborGraphWorkerRequest,
  packPreferredEdges,
  packTopologyCells,
  serializeNeighborGraph,
  unpackDeltaEdges,
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
    data_bytes: 256,
    content_hash: `0x${id}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
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
      cellsDelta: null,
      options,
      includePassive: true,
      passiveEdgeBudget: 4,
      passiveTuning: null,
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

describe('createNeighborGraphWorkerSession (stateful increments)', () => {
  function packedCells(ids: number[]): Float64Array {
    const packed = new Float64Array(ids.length * 4);
    ids.forEach((id, i) => {
      packed[i * 4] = id;
      packed[i * 4 + 1] = (id % 7) * 3;
      packed[i * 4 + 2] = 0;
      packed[i * 4 + 3] = (id % 5) * 2;
    });
    return packed;
  }
  const request = (ids: number[], requestId: number) => ({
    kind: 'build' as const,
    requestId,
    cells: packedCells(ids),
    cellsDelta: null,
    options: { k: 3 },
    includePassive: true,
    passiveEdgeBudget: null,
    passiveTuning: null,
    preferredEdges: null,
  });

  it('reports changed nodes and passive deltas that reproduce a full build', () => {
    const session = createNeighborGraphWorkerSession();
    const ids = Array.from({ length: 40 }, (_, i) => i + 1);
    const first = session.execute(request(ids, 1));
    if (first.kind !== 'built') throw new Error('expected built');
    expect(first.generation).toBe(1);
    expect(first.changedNodeIds).toBeNull();
    expect(first.passiveAdded).toBeNull();

    const ids2 = [...ids.filter((id) => id !== 17), 99];
    const second = session.execute(request(ids2, 2));
    if (second.kind !== 'built') throw new Error('expected built');
    expect(second.generation).toBe(2);
    expect(second.changedNodeIds).not.toBeNull();

    // Oracle: hints must reproduce exactly what the probing path builds.
    const firstGraph = deserializeNeighborGraph(first.graph);
    const viaHints = deserializeNeighborGraphWithHints(
      firstGraph,
      second.graph,
      second.changedNodeIds,
    );
    const viaProbe = deserializeNeighborGraph(second.graph);
    expect(viaHints.adjacency.size).toBe(viaProbe.adjacency.size);
    for (const [id, neighbours] of viaProbe.adjacency) {
      expect([...viaHints.adjacency.get(id)!]).toEqual([...neighbours]);
    }
    // Unchanged nodes adopt the previous Set instance without a probe.
    const changed = new Set(second.changedNodeIds!);
    let adopted = 0;
    for (const [id, neighbours] of viaHints.adjacency) {
      if (!changed.has(id) && firstGraph.adjacency.get(id) === neighbours) {
        adopted += 1;
      }
    }
    expect(adopted).toBeGreaterThan(0);

    // Edge records: value-identical to the probing path, and every
    // positionally-unchanged record keeps its previous object identity
    // (the hinted path shares the probing path's reuse loop instead of
    // paying for a throwaway adjacency rebuild).
    expect(viaHints.edges).toEqual(viaProbe.edges);
    viaHints.edges.forEach((edge, i) => {
      const prev = firstGraph.edges[i];
      if (
        prev !== undefined
        && prev.from === edge.from
        && prev.to === edge.to
        && prev.d === edge.d
        && prev.w === edge.w
      ) {
        expect(edge).toBe(prev);
      }
    });

    // Passive delta oracle: previous selection + delta === new selection.
    const before = new Set(
      deserializeNeighborGraph(first.passiveGraph!).edges.map(
        (edge) => `${edge.from}:${edge.to}`,
      ),
    );
    for (const edge of unpackDeltaEdges(second.passiveRemoved)) {
      before.delete(`${edge.from}:${edge.to}`);
    }
    for (const edge of unpackDeltaEdges(second.passiveAdded)) {
      before.add(`${edge.from}:${edge.to}`);
    }
    const after = new Set(
      deserializeNeighborGraph(second.passiveGraph!).edges.map(
        (edge) => `${edge.from}:${edge.to}`,
      ),
    );
    expect([...before].sort()).toEqual([...after].sort());
  });
});

describe('worker session cells-delta requests', () => {
  function packedCellsOf(ids: number[]): Float64Array {
    const packed = new Float64Array(ids.length * 4);
    ids.forEach((id, i) => {
      packed[i * 4] = id;
      packed[i * 4 + 1] = ((id * 37) % 91) - 45;
      packed[i * 4 + 2] = 0;
      packed[i * 4 + 3] = ((id * 53) % 83) - 41;
    });
    return packed;
  }
  const base = {
    kind: 'build' as const,
    options: { k: 3 },
    includePassive: false,
    passiveEdgeBudget: null,
    passiveTuning: null,
    preferredEdges: null,
  };

  it('patches the retained cells and matches a fresh full build', () => {
    const session = createNeighborGraphWorkerSession();
    const ids = Array.from({ length: 60 }, (_, i) => i + 1);
    const first = session.execute({
      ...base,
      requestId: 1,
      cells: packedCellsOf(ids),
      cellsDelta: null,
    });
    if (first.kind !== 'built') throw new Error('expected built');

    // Delta: remove 5, add 99.
    const second = session.execute({
      ...base,
      requestId: 2,
      cells: null,
      cellsDelta: {
        baseGeneration: first.generation,
        upserts: packedCellsOf([99]),
        removedIds: Float64Array.from([5]),
      },
    });
    if (second.kind !== 'built') throw new Error('expected built');
    const viaDelta = deserializeNeighborGraph(second.graph);
    const oracle = executeNeighborGraphWorkerRequest({
      ...base,
      requestId: 3,
      cells: packedCellsOf([...ids.filter((id) => id !== 5), 99]),
      cellsDelta: null,
    });
    const fresh = deserializeNeighborGraph(oracle.graph);
    expect(viaDelta.adjacency.size).toBe(fresh.adjacency.size);
    for (const [id, neighbours] of fresh.adjacency) {
      expect([...viaDelta.adjacency.get(id)!].sort()).toEqual(
        [...neighbours].sort(),
      );
    }
  });

  it('answers stale on a generation gap so the builder re-sends full', () => {
    const session = createNeighborGraphWorkerSession();
    const first = session.execute({
      ...base,
      requestId: 1,
      cells: packedCellsOf([1, 2, 3, 4, 5, 6, 7, 8]),
      cellsDelta: null,
    });
    if (first.kind !== 'built') throw new Error('expected built');
    const stale = session.execute({
      ...base,
      requestId: 2,
      cells: null,
      cellsDelta: {
        baseGeneration: first.generation + 7,
        upserts: new Float64Array(0),
        removedIds: new Float64Array(0),
      },
    });
    expect(stale.kind).toBe('stale');
  });
});
