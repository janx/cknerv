import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  buildNeighborGraph,
  emptyLivingNeighborGraph,
  type LivingNeighborGraph,
  type NeighborAdjacency,
  type NeighborGraphCell,
} from '../../src/geometry/neighborGraph';
import { shortestPath } from '../../src/geometry/pathRouter';
import { buildPassiveNeighborGraph } from '../../src/geometry/passiveNeighborGraph';
import { addCell, removeCells } from '../../src/nerve/incrementalGraph';
import {
  applyNeighborAdjacencyPatch,
  collectNeighborAdjacencyPatch,
  createNeighborGraphWorkerSession,
  deserializeLivingNeighborGraphInto,
  deserializeNeighborAdjacency,
  deserializeNeighborGraph,
  deserializeNeighborGraphInto,
  deserializeNeighborGraphWithHints,
  executeNeighborGraphWorkerRequest,
  neighborGraphResponseTransferList,
  packPreferredEdges,
  packTopologyCells,
  serializeNeighborAdjacency,
  serializeNeighborGraph,
  unpackDeltaEdges,
  unpackTopologyCells,
  type NeighborGraphWorkerRequest,
  type NeighborGraphWorkerSuccess,
} from '../../src/geometry/neighborGraphWorkerProtocol';

function cell(
  id: number,
  x: number,
  z: number,
  deathAt: number | null = null,
  y: number = id * 0.01,
): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: deathAt,
    birth_block: 1,
    tag: null,
    pos_seed: [x, y, z],
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

/** The whole display adjacency of a response, whichever form it took. */
function fullAdjacency(response: NeighborGraphWorkerSuccess): NeighborAdjacency {
  if (response.graph.kind !== 'full') {
    throw new Error('expected a whole display graph');
  }
  return deserializeNeighborAdjacency(response.graph.adjacency);
}

/** Order-strict node-by-node equality, with a readable failure. */
function expectSameAdjacency(
  actual: NeighborAdjacency,
  expected: NeighborAdjacency,
  label: string,
): void {
  expect(actual.adjacency.size, `${label}: node count`).toBe(expected.adjacency.size);
  for (const [id, neighbours] of expected.adjacency) {
    expect([...(actual.adjacency.get(id) ?? [])], `${label}: node ${id}`)
      .toEqual([...neighbours]);
  }
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

  it('round-trips an adjacency-only CSR in Set order', () => {
    const graph = buildNeighborGraph(fixtureCells(), { k: 2, maxEdgeLength: 8 });
    const restored = deserializeNeighborAdjacency(serializeNeighborAdjacency(graph));
    expectSameAdjacency(restored, graph, 'adjacency round trip');
    expect('edges' in restored).toBe(false);
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
      patchBaseGeneration: 0,
      options,
      includePassive: true,
      passiveEdgeBudget: 4,
      passiveTuning: null,
      preferredEdges: packPreferredEdges(preferredEdges),
    });

    expect(response.requestId).toBe(42);
    // The display graph rides adjacency-only: same nodes, same runs, no
    // edge list at all.
    expect(response.graph.kind).toBe('full');
    expectSameAdjacency(fullAdjacency(response), expectedGraph, 'display');
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

  it('deserializeLivingNeighborGraphInto reuses value-identical Sets and starts an empty eager log', () => {
    const cells = fixtureCells();
    const before = buildNeighborGraph(cells, { k: 2, maxEdgeLength: 8 });
    const base = deserializeLivingNeighborGraphInto(null, serializeNeighborAdjacency(before));
    base.eagerBase.set(1, undefined); // a stale log entry must not survive a whole rebuild
    cells.set(9, cell(9, 1, 1));
    const after = buildNeighborGraph(cells, { k: 2, maxEdgeLength: 8 });
    const rebuilt = deserializeLivingNeighborGraphInto(base, serializeNeighborAdjacency(after));

    expect(rebuilt).not.toBe(base);
    expectSameAdjacency(rebuilt, after, 'whole rebuild');
    expect(rebuilt.eagerBase.size).toBe(0);
    let reused = 0;
    for (const [id, neighbours] of rebuilt.adjacency) {
      if (base.adjacency.get(id) === neighbours) reused += 1;
    }
    expect(reused).toBeGreaterThan(0);
    expect(reused).toBeLessThan(rebuilt.adjacency.size);
  });
});

describe('collectNeighborAdjacencyPatch', () => {
  const adjacencyOf = (entries: [number, number[]][]): NeighborAdjacency => ({
    adjacency: new Map(entries.map(([id, ns]) => [id, new Set(ns)])),
  });

  it('names changed nodes (order-strict), new nodes, and removed nodes — nothing else', () => {
    const previous = adjacencyOf([[1, [2, 3]], [2, [1]], [3, [1, 4]], [4, [3]]]);
    const next = adjacencyOf([
      [1, [2, 3]], // untouched
      [2, [1, 5]], // grew
      [3, [4, 1]], // same members, different order: changed
      [5, [2]], // new
      // 4 removed
    ]);
    const patch = collectNeighborAdjacencyPatch(previous, next);
    expect([...patch.changed.nodeIds]).toEqual([2, 3, 5]);
    expect([...patch.changed.adjacencyOffsets]).toEqual([0, 2, 4, 5]);
    expect([...patch.changed.adjacentNodeIds]).toEqual([1, 5, 4, 1, 2]);
    expect([...patch.removedNodeIds]).toEqual([4]);
  });

  it('is empty for identical adjacency', () => {
    const graph = buildNeighborGraph(fixtureCells(), { k: 2, maxEdgeLength: 8 });
    const patch = collectNeighborAdjacencyPatch(graph, graph);
    expect(patch.changed.nodeIds).toHaveLength(0);
    expect(patch.removedNodeIds).toHaveLength(0);
  });
});

describe('applyNeighborAdjacencyPatch', () => {
  /** A living graph holding exactly the worker's build, as the builder's
   *  whole-graph path leaves it. */
  function livingFrom(graph: NeighborAdjacency): LivingNeighborGraph {
    return deserializeLivingNeighborGraphInto(null, serializeNeighborAdjacency(graph));
  }

  it('lands exactly on the next build, in place, keeping every unchanged Set instance', () => {
    const cells = fixtureCells();
    const options = { k: 2, maxEdgeLength: 8 };
    const before = buildNeighborGraph(cells, options);
    const living = livingFrom(before);
    const instancesBefore = new Map(living.adjacency);

    cells.set(9, cell(9, 1, 1));
    cells.delete(7);
    const after = buildNeighborGraph(cells, options);
    const patch = collectNeighborAdjacencyPatch(before, after);
    const changed = new Set(patch.changed.nodeIds);

    const result = applyNeighborAdjacencyPatch(living, patch);
    expect(result).toBe(living);
    expectSameAdjacency(living, after, 'patched');
    expect(living.adjacency.has(7)).toBe(false);
    for (const [id, instance] of instancesBefore) {
      if (id === 7 || changed.has(id)) continue;
      expect(living.adjacency.get(id), `node ${id} instance`).toBe(instance);
    }
    expect(changed.size).toBeGreaterThan(0);
    expect(changed.size).toBeLessThan(after.adjacency.size);
  });

  it('keeps an eager instance for a changed node whose run already reads exactly as the worker built it', () => {
    // k=1: X(0,0)–W(0.5,0) link each other; the newborn N(-1,0) is nearest
    // to X, and X's own nearest stays W — so the worker appends N to X's Set
    // LAST (N is the last cell in the pack and X never picks N itself),
    // which is precisely the order the eager append produced.
    const options = { k: 1, maxEdgeLength: 8 };
    const cells = new Map<number, Cell>([
      [2, cell(2, 0, 0, null, 0)],
      [3, cell(3, 0.5, 0, null, 0)],
    ]);
    const before = buildNeighborGraph(cells, options);
    const living = livingFrom(before);
    cells.set(9, cell(9, -1, 0, null, 0));
    addCell(living, 9, cells, options);
    const eagerX = living.adjacency.get(2)!;
    const eagerN = living.adjacency.get(9)!;
    expect([...eagerX]).toEqual([3, 9]);

    const after = buildNeighborGraph(cells, options);
    expect([...after.adjacency.get(2)!]).toEqual([3, 9]);
    applyNeighborAdjacencyPatch(living, collectNeighborAdjacencyPatch(before, after));
    expectSameAdjacency(living, after, 'eager-matching patch');
    expect(living.adjacency.get(2)).toBe(eagerX);
    expect(living.adjacency.get(9)).toBe(eagerN);
    expect(living.eagerBase.size).toBe(0);
  });

  it('restores a death retracted while the build was in flight, with the original instances (the whole-graph path\'s semantics)', () => {
    // Build G1; the worker then computes a patch from an UNCHANGED cell set
    // (it never heard of the death); meanwhile the eager mesh retracted the
    // dead cell's fibres. The applied graph must be the worker's build —
    // the corpse and its neighbours' Sets come back, as the old CSR rebuild
    // brought them back — and it must come back as the very instances the
    // previous apply published, so nothing downstream sees a new Set for an
    // unchanged node.
    const cells = fixtureCells();
    const options = { k: 2, maxEdgeLength: 8 };
    const before = buildNeighborGraph(cells, options);
    const living = livingFrom(before);
    const dead = 4;
    const neighboursOfDead = [...living.adjacency.get(dead)!];
    const originals = new Map(
      [dead, ...neighboursOfDead].map((id) => [id, living.adjacency.get(id)!]),
    );
    removeCells(living, [dead]);
    expect(living.adjacency.has(dead)).toBe(false);
    expect(living.eagerBase.get(dead)).toBe(originals.get(dead));

    const unchanged = buildNeighborGraph(cells, options);
    const patch = collectNeighborAdjacencyPatch(before, unchanged);
    expect(patch.changed.nodeIds).toHaveLength(0);
    applyNeighborAdjacencyPatch(living, patch);

    expectSameAdjacency(living, unchanged, 'resurrected');
    for (const [id, instance] of originals) {
      expect(living.adjacency.get(id), `node ${id}`).toBe(instance);
    }
    expect(living.eagerBase.size).toBe(0);
  });

  it('drops an eager newborn the worker never admitted', () => {
    const cells = fixtureCells();
    const options = { k: 2, maxEdgeLength: 8 };
    const before = buildNeighborGraph(cells, options);
    const living = livingFrom(before);
    const withNewborn = new Map(cells);
    withNewborn.set(9, cell(9, 1, 1));
    addCell(living, 9, withNewborn, options);
    expect(living.adjacency.has(9)).toBe(true);
    expect(living.eagerBase.has(9)).toBe(true);
    expect(living.eagerBase.get(9)).toBeUndefined();

    applyNeighborAdjacencyPatch(
      living,
      collectNeighborAdjacencyPatch(before, buildNeighborGraph(cells, options)),
    );
    expectSameAdjacency(living, before, 'newborn dropped');
    expect(living.eagerBase.size).toBe(0);
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
  const request = (
    ids: number[],
    requestId: number,
    patchBaseGeneration = 0,
  ): NeighborGraphWorkerRequest => ({
    kind: 'build',
    requestId,
    cells: packedCells(ids),
    cellsDelta: null,
    patchBaseGeneration,
    options: { k: 3 },
    includePassive: true,
    passiveEdgeBudget: null,
    passiveTuning: null,
    preferredEdges: null,
  });

  it('answers with a display patch exactly when the request names its previous build', () => {
    const session = createNeighborGraphWorkerSession();
    const ids = Array.from({ length: 40 }, (_, i) => i + 1);
    const first = session.execute(request(ids, 1, 0));
    if (first.kind !== 'built') throw new Error('expected built');
    expect(first.generation).toBe(1);
    expect(first.graph.kind).toBe('full');

    // Names generation 1 = the session's previous build → patch.
    const second = session.execute(request(ids, 2, 1));
    if (second.kind !== 'built') throw new Error('expected built');
    expect(second.generation).toBe(2);
    expect(second.graph.kind).toBe('patch');

    // Names a build that is no longer the previous one → whole graph.
    const third = session.execute(request(ids, 3, 1));
    if (third.kind !== 'built') throw new Error('expected built');
    expect(third.graph.kind).toBe('full');

    // A caller that cannot patch (0) always gets the whole graph.
    const fourth = session.execute(request(ids, 4, 0));
    if (fourth.kind !== 'built') throw new Error('expected built');
    expect(fourth.graph.kind).toBe('full');

    // A fresh session has no previous build to patch against.
    const fresh = createNeighborGraphWorkerSession().execute(request(ids, 5, 1));
    if (fresh.kind !== 'built') throw new Error('expected built');
    expect(fresh.graph.kind).toBe('full');
  });

  it('reports a display patch and passive deltas that reproduce a full build', () => {
    const session = createNeighborGraphWorkerSession();
    const ids = Array.from({ length: 40 }, (_, i) => i + 1);
    const first = session.execute(request(ids, 1));
    if (first.kind !== 'built') throw new Error('expected built');
    expect(first.generation).toBe(1);
    expect(first.passiveChangedNodeIds).toBeNull();
    expect(first.passiveAdded).toBeNull();

    const ids2 = [...ids.filter((id) => id !== 17), 99];
    const second = session.execute(request(ids2, 2, first.generation));
    if (second.kind !== 'built') throw new Error('expected built');
    expect(second.generation).toBe(2);
    if (second.graph.kind !== 'patch') throw new Error('expected patch');

    // Oracle: the patch applied to the first build reproduces exactly what
    // a whole deserialize of the second build gives, node for node.
    const living = deserializeLivingNeighborGraphInto(
      null,
      (first.graph as { kind: 'full'; adjacency: never }).adjacency,
    );
    const instances = new Map(living.adjacency);
    applyNeighborAdjacencyPatch(living, second.graph.patch);
    const whole = fullAdjacency(executeNeighborGraphWorkerRequest(request(ids2, 3)));
    expectSameAdjacency(living, whole, 'patched vs whole');
    expect(living.adjacency.has(17)).toBe(false);
    expect([...second.graph.patch.removedNodeIds]).toEqual([17]);
    // Unchanged nodes keep the previous Set instance.
    const changed = new Set(second.graph.patch.changed.nodeIds);
    let kept = 0;
    for (const [id, neighbours] of living.adjacency) {
      if (!changed.has(id)) {
        expect(neighbours).toBe(instances.get(id));
        kept += 1;
      }
    }
    expect(kept).toBeGreaterThan(0);
    // The patch is a small fraction of the whole graph.
    expect(changed.size).toBeLessThan(living.adjacency.size);

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

    // Passive hints still reproduce the probing path.
    const firstPassive = deserializeNeighborGraph(first.passiveGraph!);
    const viaHints = deserializeNeighborGraphWithHints(
      firstPassive,
      second.passiveGraph!,
      second.passiveChangedNodeIds,
    );
    expect(viaHints).toEqual(deserializeNeighborGraph(second.passiveGraph!));
  });

  it('transfers every buffer of either display form and never an edge list for the display graph', () => {
    const session = createNeighborGraphWorkerSession();
    const ids = Array.from({ length: 40 }, (_, i) => i + 1);
    const first = session.execute(request(ids, 1));
    if (first.kind !== 'built' || first.graph.kind !== 'full') throw new Error('x');
    const fullTransfer = neighborGraphResponseTransferList(first);
    // display CSR (3) + passive CSR (3) + passive edges (1); no hints yet.
    expect(fullTransfer).toHaveLength(7);
    expect(fullTransfer).toContain(first.graph.adjacency.adjacentNodeIds.buffer);

    const second = session.execute(request([...ids, 41], 2, 1));
    if (second.kind !== 'built' || second.graph.kind !== 'patch') throw new Error('x');
    const patchTransfer = neighborGraphResponseTransferList(second);
    // patch CSR (3) + removed (1) + passive changed (1) + added (1) +
    // removed (1) + passive CSR (3) + passive edges (1).
    expect(patchTransfer).toHaveLength(11);
    expect(patchTransfer).toContain(second.graph.patch.removedNodeIds.buffer);
    for (const buffer of patchTransfer) expect(buffer).toBeInstanceOf(ArrayBuffer);
    const patchBytes = second.graph.patch.changed.nodeIds.byteLength
      + second.graph.patch.changed.adjacencyOffsets.byteLength
      + second.graph.patch.changed.adjacentNodeIds.byteLength
      + second.graph.patch.removedNodeIds.byteLength;
    const fullBytes = first.graph.adjacency.nodeIds.byteLength
      + first.graph.adjacency.adjacencyOffsets.byteLength
      + first.graph.adjacency.adjacentNodeIds.byteLength;
    expect(patchBytes).toBeLessThan(fullBytes);
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
    patchBaseGeneration: 0,
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
    const viaDelta = fullAdjacency(second);
    const oracle = executeNeighborGraphWorkerRequest({
      ...base,
      requestId: 3,
      cells: packedCellsOf([...ids.filter((id) => id !== 5), 99]),
      cellsDelta: null,
    });
    const fresh = fullAdjacency(oracle);
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

/**
 * The equivalence that makes the O(churn) apply safe, driven exactly as
 * NeuralNetwork drives it: eager births/deaths through the real living-mesh
 * mutators BEFORE each build, a journal delta to the session, deaths landing
 * while a build is in flight (journaled for the next one), revivals of dead
 * ids at their old address, and a superseded build breaking the chain. The
 * lattice layout makes equal-distance ties common, so the eager mesh and the
 * worker routinely disagree on a k-th neighbour — the case the eager log
 * exists for. After EVERY apply the living graph must equal the worker's
 * own build node for node and in order.
 */
describe('applyNeighborAdjacencyPatch under living-mesh churn (lattice, ties)', () => {
  function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('lands on the worker build after every apply, and exercised the eager log', () => {
    const rnd = mulberry32(7);
    const options = { k: 3, maxEdgeLength: 4 };
    const side = 24;
    // Shuffled ids over the lattice: id order (the worker's tie-break) and
    // map order (the eager mesh's) disagree almost everywhere.
    const ids = Array.from({ length: side * side }, (_, i) => i + 1);
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rnd() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const cells = new Map<number, Cell>();
    const graveyard = new Map<number, Cell>();
    ids.forEach((id, i) => {
      cells.set(id, cell(id, i % side, Math.floor(i / side), null, 0));
    });
    let nextId = ids.length + 1;

    // What the session holds (journal-driven, same operation order as the
    // session applies them) vs `cells`, the main thread's map.
    const sessionCells = new Map(cells);
    const session = createNeighborGraphWorkerSession();
    const pack = (map: Map<number, Cell>) =>
      packTopologyCells(map as ReadonlyMap<number, NeighborGraphCell>);
    const passiveOff = {
      includePassive: false,
      passiveEdgeBudget: null,
      passiveTuning: null,
      preferredEdges: null,
    } as const;

    let living: LivingNeighborGraph = emptyLivingNeighborGraph();
    let applied = 0;
    let requestId = 1;
    const journalUpserts = new Map<number, Cell>();
    const journalRemoved = new Set<number>();
    let restoredTotal = 0;
    let patchApplies = 0;
    let fullApplies = 0;

    const die = (count: number) => {
      const live = [...cells.keys()];
      const died: number[] = [];
      for (let i = 0; i < count && live.length > 0; i += 1) {
        const id = live[Math.floor(rnd() * live.length)];
        const c = cells.get(id);
        if (!c) continue;
        cells.delete(id);
        graveyard.set(id, c);
        died.push(id);
        journalRemoved.add(id);
        journalUpserts.delete(id);
      }
      removeCells(living, died);
    };
    const bear = (count: number, revive: boolean) => {
      const born: number[] = [];
      for (let i = 0; i < count; i += 1) {
        let c: Cell;
        const corpse = revive ? [...graveyard.values()][0] : undefined;
        if (corpse) {
          graveyard.delete(corpse.id);
          c = corpse;
        } else {
          c = cell(nextId, Math.floor(rnd() * side), Math.floor(rnd() * side), null, 0);
          nextId += 1;
        }
        cells.set(c.id, c);
        journalUpserts.set(c.id, c);
        journalRemoved.delete(c.id);
        born.push(c.id);
      }
      for (const id of born) addCell(living, id, cells, options);
    };
    const execute = (): NeighborGraphWorkerSuccess => {
      const removedIds = Float64Array.from(journalRemoved);
      const upserts = new Float64Array(journalUpserts.size * 4);
      let offset = 0;
      for (const c of journalUpserts.values()) {
        upserts[offset] = c.id;
        upserts[offset + 1] = c.pos_seed[0];
        upserts[offset + 2] = c.pos_seed[1];
        upserts[offset + 3] = c.pos_seed[2];
        offset += 4;
      }
      for (const id of journalRemoved) sessionCells.delete(id);
      for (const c of journalUpserts.values()) sessionCells.set(c.id, c);
      journalRemoved.clear();
      journalUpserts.clear();
      const response = applied === 0
        ? session.execute({
          kind: 'build', requestId: requestId++, cells: pack(sessionCells),
          cellsDelta: null, patchBaseGeneration: 0, options, ...passiveOff,
        })
        : session.execute({
          kind: 'build', requestId: requestId++, cells: null,
          cellsDelta: { baseGeneration: applied, upserts, removedIds },
          patchBaseGeneration: applied, options, ...passiveOff,
        });
      if (response.kind !== 'built') throw new Error(`unexpected ${response.kind}`);
      return response;
    };
    const apply = (response: NeighborGraphWorkerSuccess, label: string) => {
      if (response.graph.kind === 'patch') {
        const changed = new Set(response.graph.patch.changed.nodeIds);
        const removed = new Set(response.graph.patch.removedNodeIds);
        for (const id of living.eagerBase.keys()) {
          if (!changed.has(id) && !removed.has(id)) restoredTotal += 1;
        }
        living = applyNeighborAdjacencyPatch(living, response.graph.patch);
        patchApplies += 1;
      } else {
        living = deserializeLivingNeighborGraphInto(living, response.graph.adjacency);
        fullApplies += 1;
      }
      applied = response.generation;
      const truth = fullAdjacency(executeNeighborGraphWorkerRequest({
        kind: 'build', requestId: 999, cells: pack(sessionCells), cellsDelta: null,
        patchBaseGeneration: 0, options, ...passiveOff,
      }));
      expectSameAdjacency(living, truth, label);
      expect(living.eagerBase.size, `${label}: log cleared`).toBe(0);
      for (const [id, neighbours] of living.adjacency) {
        for (const nb of neighbours) {
          expect(living.adjacency.get(nb)?.has(id), `${label}: ${id}-${nb} symmetric`).toBe(true);
        }
      }
    };

    apply(execute(), 'bootstrap');
    for (let step = 1; step <= 24; step += 1) {
      die(1 + Math.floor(rnd() * 3));
      bear(1 + Math.floor(rnd() * 3), step % 5 === 0);
      if (step % 7 === 0) {
        // A superseded build: the session advances, nothing is applied, so
        // the next response must come back whole and unchained.
        session.execute({
          kind: 'build', requestId: requestId++, cells: pack(sessionCells),
          cellsDelta: null, patchBaseGeneration: 0, options, ...passiveOff,
        });
        for (const id of journalRemoved) sessionCells.delete(id);
        for (const c of journalUpserts.values()) sessionCells.set(c.id, c);
        journalRemoved.clear();
        journalUpserts.clear();
        const response = session.execute({
          kind: 'build', requestId: requestId++, cells: pack(sessionCells),
          cellsDelta: null, patchBaseGeneration: applied, options, ...passiveOff,
        });
        if (response.kind !== 'built') throw new Error('x');
        expect(response.graph.kind).toBe('full');
        apply(response, `step ${step} (chain break)`);
        continue;
      }
      const response = execute();
      expect(response.graph.kind).toBe('patch');
      if (step % 3 === 0) {
        // A death lands while the build is in flight: retracted eagerly now,
        // journaled for the next build, unknown to this response.
        die(1);
      }
      apply(response, `step ${step}`);
    }
    expect(patchApplies).toBeGreaterThan(15);
    expect(fullApplies).toBeGreaterThanOrEqual(3);
    // The log did real work: nodes the eager mesh touched that the worker
    // reported unchanged were put back from the log.
    expect(restoredTotal).toBeGreaterThan(0);
  });
});
