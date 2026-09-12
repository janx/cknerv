import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  buildNeighborGraph,
  emptyLivingNeighborGraph,
  type LivingNeighborGraph,
  type NeighborAdjacency,
  type NeighborEdge,
  type NeighborGraphCell,
  type PassiveSelection,
} from '../../src/geometry/neighborGraph';
import { shortestPath } from '../../src/geometry/pathRouter';
import { buildPassiveNeighborGraph } from '../../src/geometry/passiveNeighborGraph';
import { addCell, removeCells } from '../../src/nerve/incrementalGraph';
import { fabricEdgeTrunkness } from '../../src/nerve/fabricTrunkClass';
import {
  resetNeighborGraphBuilderStats,
  snapshotNeighborGraphBuilderStats,
} from '../../src/geometry/neighborGraphBuilderStats';
import {
  applyNeighborAdjacencyPatch,
  PASSIVE_WEIGHT_GRAIN,
  applyPassiveSelectionPatch,
  passiveWeightClass,
  collectNeighborAdjacencyPatch,
  collectPassiveSelectionPatch,
  createNeighborGraphWorkerSession,
  deserializeLivingNeighborGraphInto,
  deserializeNeighborAdjacency,
  deserializePassiveSelection,
  executeNeighborGraphWorkerRequest,
  neighborGraphResponseTransferList,
  packPassiveEdges,
  packPreferredEdges,
  packTopologyCells,
  serializeNeighborAdjacency,
  unpackPassiveEdges,
  unpackTopologyCells,
  type NeighborGraphWorkerRequest,
  type NeighborGraphWorkerSuccess,
  type SerializedPassiveSelectionPatch,
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

/** The whole passive selection of a response that carried one whole. */
function fullPassive(response: NeighborGraphWorkerSuccess): PassiveSelection {
  if (response.passiveGraph?.kind !== 'full') {
    throw new Error('expected a whole passive selection');
  }
  return deserializePassiveSelection(response.passiveGraph);
}

const edgeKeyOf = (edge: { from: number; to: number }) => `${edge.from}:${edge.to}`;

/** Canonical order: `from` ascending, then `to`, each key once. */
function expectCanonicalOrder(edges: readonly NeighborEdge[], label: string): void {
  for (let index = 1; index < edges.length; index += 1) {
    const a = edges[index - 1];
    const b = edges[index];
    expect(a.from < b.from || (a.from === b.from && a.to < b.to), `${label}: ${edgeKeyOf(a)} before ${edgeKeyOf(b)}`)
      .toBe(true);
  }
}

/**
 * A patched selection against the whole one the mirror built.
 *
 * Keys, order and distances are exact — a patch that lost an edge or moved
 * one is a wrong selection. The WEIGHTS a reader takes are exact too, and
 * they are the parallel array, not the records. A record's own `w` is allowed
 * to sit up to {@link PASSIVE_WEIGHT_GRAIN} behind: it is read only where the
 * fabric admits an edge, and holding a replacement-free record there is the
 * whole of T12 (see `passiveWeightChain.test.ts` for what that costs the tier
 * and the admissions over sixteen chained blocks — nothing).
 */
function expectSamePassive(
  held: PassiveSelection,
  truth: PassiveSelection,
  label: string,
): void {
  expect(held.edges.map(edgeKeyOf), `${label}: passive vs mirror keys`)
    .toEqual(truth.edges.map(edgeKeyOf));
  expect(held.edges.map((e) => e.d), `${label}: passive vs mirror distances`)
    .toEqual(truth.edges.map((e) => e.d));
  for (let index = 0; index < truth.edges.length; index += 1) {
    const want = truth.edges[index].w;
    const where = `${label}: ${edgeKeyOf(truth.edges[index])}`;
    expect(held.weights?.[index] ?? Number.NaN, `${where} tier weight`)
      .toBe(want ?? Number.NaN);
    const holding = held.edges[index].w;
    expect(passiveWeightClass(holding), `${where} record class`)
      .toBe(passiveWeightClass(want));
    if (want !== undefined && holding !== undefined) {
      expect(Math.abs(holding - want), `${where} record drift`)
        .toBeLessThanOrEqual(PASSIVE_WEIGHT_GRAIN);
    }
  }
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

  it('round-trips an adjacency-only CSR in Set order, with the routes it decides', () => {
    const graph = buildNeighborGraph(fixtureCells(), { k: 2, maxEdgeLength: 8 });
    const restored = deserializeNeighborAdjacency(serializeNeighborAdjacency(graph));
    expectSameAdjacency(restored, graph, 'adjacency round trip');
    expect('edges' in restored).toBe(false);
    for (const [from, to] of [[1, 7], [2, 6], [5, 3]]) {
      expect(shortestPath(restored, from, to))
        .toEqual(shortestPath(graph, from, to));
    }
  });

  it('round-trips the passive selection as records: order, distances and arbor weights, no adjacency', () => {
    const graph = buildNeighborGraph(fixtureCells(), { k: 2, maxEdgeLength: 8 });
    const selection = buildPassiveNeighborGraph(graph, { edgeBudget: 5 });
    const restored = deserializePassiveSelection({ edges: packPassiveEdges(selection.edges) });
    expect(restored.edges).toEqual(selection.edges);
    expect('adjacency' in restored).toBe(false);
    expectCanonicalOrder(restored.edges, 'round trip');
    // Weighted and unweighted records both survive the trip exactly.
    const mixed: NeighborEdge[] = [
      { from: 1, to: 2, d: 1.25, w: 0.5 },
      { from: 1, to: 3, d: 2.5 },
      { from: 2, to: 3, d: 0.75, w: 1 },
    ];
    expect(unpackPassiveEdges(packPassiveEdges(mixed))).toEqual(mixed);
    // A whole list that is not in canonical order is rejected on arrival:
    // the in-place merge below depends on the order, so it is a contract.
    const reversed = packPassiveEdges([...selection.edges].reverse());
    expect(() => deserializePassiveSelection({ edges: reversed }))
      .toThrow(/canonical order/);
    expect(() => unpackPassiveEdges(new Float64Array(3)))
      .toThrow(/invalid packed passive edge buffer/);
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
    // The passive graph rides edges-only: the same records the main-thread
    // selection holds, and no adjacency at all.
    expect(fullPassive(response).edges).toEqual(expectedPassive.edges);
    expect(response.passiveGraph).not.toHaveProperty('nodeIds');
  });

  it('deserializeLivingNeighborGraphInto rejects a previous Set whose members match but whose order differs', () => {
    const graph = buildNeighborGraph(fixtureCells(), { k: 2, maxEdgeLength: 8 });
    const serialized = serializeNeighborAdjacency(graph);
    const base = deserializeLivingNeighborGraphInto(null, serialized);
    // Reverse one node's Set order in the "previous" graph.
    const someNode = [...base.adjacency.entries()]
      .find(([, neighbours]) => neighbours.size >= 2);
    expect(someNode).toBeDefined();
    const [nodeId, neighbours] = someNode!;
    base.adjacency.set(nodeId, new Set([...neighbours].reverse()));

    const rebuilt = deserializeLivingNeighborGraphInto(base, serialized);
    expect(rebuilt.adjacency.get(nodeId)).not.toBe(base.adjacency.get(nodeId));
    // CSR order wins — deterministic equal-hop routing depends on it.
    expect([...rebuilt.adjacency.get(nodeId)!])
      .toEqual([...(deserializeNeighborAdjacency(serialized).adjacency.get(nodeId)!)]);
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

  it('answers with a passive patch exactly when it answers with a display patch and its previous build had a selection', () => {
    const session = createNeighborGraphWorkerSession();
    const ids = Array.from({ length: 40 }, (_, i) => i + 1);
    const execute = (requestId: number, patchBaseGeneration: number, includePassive: boolean) => {
      const response = session.execute({
        ...request(ids, requestId, patchBaseGeneration),
        includePassive,
      });
      if (response.kind !== 'built') throw new Error('expected built');
      return response;
    };
    // No selection requested: nothing rides.
    const first = execute(1, 0, false);
    expect(first.passiveGraph).toBeNull();
    // The display chains, but the previous build had no selection to patch
    // against: the selection rides whole.
    const second = execute(2, 1, true);
    expect(second.graph.kind).toBe('patch');
    expect(second.passiveGraph?.kind).toBe('full');
    // Both chain.
    const third = execute(3, 2, true);
    expect(third.graph.kind).toBe('patch');
    expect(third.passiveGraph?.kind).toBe('patch');
    // Names a build that is no longer the previous one: both ride whole.
    const fourth = execute(4, 2, true);
    expect(fourth.graph.kind).toBe('full');
    expect(fourth.passiveGraph?.kind).toBe('full');
    // A caller that cannot patch (0): both ride whole.
    const fifth = execute(5, 0, true);
    expect(fifth.graph.kind).toBe('full');
    expect(fifth.passiveGraph?.kind).toBe('full');
    // The selection is dropped for a build, then requested again: the
    // display still chains, the selection has no base and rides whole.
    const sixth = execute(6, 5, false);
    expect(sixth.graph.kind).toBe('patch');
    expect(sixth.passiveGraph).toBeNull();
    const seventh = execute(7, 6, true);
    expect(seventh.graph.kind).toBe('patch');
    expect(seventh.passiveGraph?.kind).toBe('full');
  });

  it('reports a display patch and a passive patch that reproduce a whole build', () => {
    const session = createNeighborGraphWorkerSession();
    const ids = Array.from({ length: 40 }, (_, i) => i + 1);
    const first = session.execute(request(ids, 1));
    if (first.kind !== 'built') throw new Error('expected built');
    expect(first.generation).toBe(1);
    expect(first.passiveGraph?.kind).toBe('full');

    const ids2 = [...ids.filter((id) => id !== 17), 99];
    const second = session.execute(request(ids2, 2, first.generation));
    if (second.kind !== 'built') throw new Error('expected built');
    expect(second.generation).toBe(2);
    if (second.graph.kind !== 'patch') throw new Error('expected patch');
    if (second.passiveGraph?.kind !== 'patch') throw new Error('expected passive patch');

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

    // Passive oracle: the held selection merged with the patch IS the
    // session's own selection for this build — which a mirror session fed
    // the same two builds and asked for whole forms hands over whole (the
    // selection depends on the graph, the options and the session's own
    // previous selection, never on the form it rides in).
    const mirror = createNeighborGraphWorkerSession();
    mirror.execute(request(ids, 1));
    const wholeSecond = mirror.execute(request(ids2, 2, 0));
    if (wholeSecond.kind !== 'built') throw new Error('expected built');
    const held = fullPassive(first);
    const beforeKeys = held.edges.map(edgeKeyOf);
    const delta = applyPassiveSelectionPatch(held, second.passiveGraph.patch);
    expect(held.edges).toEqual(fullPassive(wholeSecond).edges);
    expectCanonicalOrder(held.edges, 'patched selection');
    // ...and the delta the fabric is handed reproduces the same set from
    // the previous keys.
    const keys = new Set(beforeKeys);
    for (const edge of delta.removed) keys.delete(edgeKeyOf(edge));
    for (const edge of delta.added) keys.add(edgeKeyOf(edge));
    expect([...keys].sort()).toEqual(held.edges.map(edgeKeyOf).sort());
    expect(delta.added.length + delta.removed.length).toBeGreaterThan(0);
    expect(delta.added.length + delta.removed.length).toBeLessThan(held.edges.length);
  });

  it('transfers every buffer of either form: never an edge list for the display graph, never an adjacency for the passive one', () => {
    const session = createNeighborGraphWorkerSession();
    const ids = Array.from({ length: 40 }, (_, i) => i + 1);
    const first = session.execute(request(ids, 1));
    if (first.kind !== 'built' || first.graph.kind !== 'full') throw new Error('x');
    if (first.passiveGraph?.kind !== 'full') throw new Error('x');
    const fullTransfer = neighborGraphResponseTransferList(first);
    // display CSR (3) + passive edge list (1).
    expect(fullTransfer).toHaveLength(4);
    expect(fullTransfer).toContain(first.graph.adjacency.adjacentNodeIds.buffer);
    expect(fullTransfer).toContain(first.passiveGraph.edges.buffer);

    const second = session.execute(request([...ids, 41], 2, 1));
    if (second.kind !== 'built' || second.graph.kind !== 'patch') throw new Error('x');
    if (second.passiveGraph?.kind !== 'patch') throw new Error('x');
    const patchTransfer = neighborGraphResponseTransferList(second);
    // patch CSR (3) + removed ids (1) + passive added (1) + passive
    // removed keys (1) + passive values (1).
    expect(patchTransfer).toHaveLength(7);
    expect(patchTransfer).toContain(second.graph.patch.removedNodeIds.buffer);
    expect(patchTransfer).toContain(second.passiveGraph.patch.added.buffer);
    expect(patchTransfer).toContain(second.passiveGraph.patch.removedKeys.buffer);
    expect(patchTransfer).toContain(second.passiveGraph.patch.values.buffer);
    for (const buffer of patchTransfer) expect(buffer).toBeInstanceOf(ArrayBuffer);
    const patchBytes = second.graph.patch.changed.nodeIds.byteLength
      + second.graph.patch.changed.adjacencyOffsets.byteLength
      + second.graph.patch.changed.adjacentNodeIds.byteLength
      + second.graph.patch.removedNodeIds.byteLength;
    const fullBytes = first.graph.adjacency.nodeIds.byteLength
      + first.graph.adjacency.adjacencyOffsets.byteLength
      + first.graph.adjacency.adjacentNodeIds.byteLength;
    expect(patchBytes).toBeLessThan(fullBytes);
    // The values of the whole merged list ride with the patch (16 bytes an
    // edge), so a patch is bounded above by half a whole list plus churn.
    const passivePatchBytes = second.passiveGraph.patch.added.byteLength
      + second.passiveGraph.patch.removedKeys.byteLength
      + second.passiveGraph.patch.values.byteLength;
    expect(passivePatchBytes).toBeLessThan(first.passiveGraph.edges.byteLength);
  });
});

describe('passive selection patch', () => {
  const edge = (from: number, to: number, w?: number, d = 1): NeighborEdge =>
    (w === undefined ? { from, to, d } : { from, to, d, w });
  const sameKey = (a: NeighborEdge, b: NeighborEdge) => a.from === b.from && a.to === b.to;
  /** A patch against `held` as the worker would compute it for the list
   *  `held − removed + added` (values from that merged list, or `values`
   *  when a test wants to move them). */
  const patchOf = (
    held: readonly NeighborEdge[],
    added: NeighborEdge[],
    removed: NeighborEdge[],
    values?: NeighborEdge[],
  ): SerializedPassiveSelectionPatch => {
    const merged = values ?? [
      ...held.filter((e) => !removed.some((r) => sameKey(e, r))),
      ...added,
    ].sort((a, b) => a.from - b.from || a.to - b.to);
    // A malformed patch (a removal that misses, an addition that collides)
    // still carries the value count its counts imply, so the apply reaches
    // the check under test rather than the coverage check.
    const count = held.length - removed.length + added.length;
    return {
      added: packPassiveEdges(added),
      removedKeys: Float64Array.from(removed.flatMap((e) => [e.from, e.to])),
      values: merged.length === count
        ? Float64Array.from(merged.flatMap((e) => [e.d, e.w ?? Number.NaN]))
        : new Float64Array(count * 2),
    };
  };

  it('names the edges that entered as records, those that left as keys, and the merged list\'s values, in canonical order', () => {
    const previous = [edge(1, 2, 0.5), edge(1, 3), edge(2, 4), edge(5, 6)];
    const next = [edge(1, 2, 0.7), edge(1, 7), edge(2, 4), edge(3, 4, 0.25)];
    const patch = collectPassiveSelectionPatch(previous, next);
    expect(unpackPassiveEdges(patch.added)).toEqual([edge(1, 7), edge(3, 4, 0.25)]);
    expect([...patch.removedKeys]).toEqual([1, 3, 5, 6]);
    expect([...patch.values]).toEqual([1, 0.7, 1, Number.NaN, 1, Number.NaN, 1, 0.25]);
  });

  it('is empty (bar the values) for an identical selection and rejects one out of canonical order', () => {
    const selection = [edge(1, 2), edge(1, 3), edge(2, 3)];
    const patch = collectPassiveSelectionPatch(selection, selection);
    expect(patch.added).toHaveLength(0);
    expect(patch.removedKeys).toHaveLength(0);
    expect(patch.values).toHaveLength(6);
    expect(() => collectPassiveSelectionPatch(selection, [edge(1, 3), edge(1, 2)]))
      .toThrow(/canonical order/);
    expect(() => collectPassiveSelectionPatch(selection, [edge(1, 2), edge(1, 2)]))
      .toThrow(/canonical order/);
  });

  // L2-3 priced pass 3 at 5,195-5,563 replaced records of 8,000 per chained
  // block, entirely from a probe — the apply itself returned the count and
  // then dropped it on the floor. `topology.rewritten` is where a live window
  // reads the same number.
  it('reports what pass 3 replaced to the topology counters, as a sum and as the last apply', () => {
    resetNeighborGraphBuilderStats();
    const held: PassiveSelection = {
      edges: [edge(1, 2, 0.5), edge(1, 3), edge(2, 3, 0.2), edge(3, 4)],
    };
    applyPassiveSelectionPatch(held, patchOf(held.edges, [], [], [
      edge(1, 2, 0.7), edge(1, 3, 0.1), edge(2, 3), edge(3, 4),
    ]));
    expect(snapshotNeighborGraphBuilderStats().rewritten).toBe(3);
    expect(snapshotNeighborGraphBuilderStats().rewrittenLast).toBe(3);
    // A build that moved one value leaves the sum climbing and the last
    // reading at that build's own count, never at the window's.
    applyPassiveSelectionPatch(held, patchOf(held.edges, [], [], [
      edge(1, 2, 0.7), edge(1, 3, 0.1), edge(2, 3), edge(3, 4, 0.9),
    ]));
    expect(snapshotNeighborGraphBuilderStats().rewritten).toBe(4);
    expect(snapshotNeighborGraphBuilderStats().rewrittenLast).toBe(1);
    // A build that confirmed every value says so rather than staying silent.
    applyPassiveSelectionPatch(held, patchOf(held.edges, [], [], [
      edge(1, 2, 0.7), edge(1, 3, 0.1), edge(2, 3), edge(3, 4, 0.9),
    ]));
    expect(snapshotNeighborGraphBuilderStats().rewritten).toBe(4);
    expect(snapshotNeighborGraphBuilderStats().rewrittenLast).toBe(0);
    resetNeighborGraphBuilderStats();
    expect(snapshotNeighborGraphBuilderStats().rewritten).toBe(0);
    expect(snapshotNeighborGraphBuilderStats().rewrittenLast).toBe(0);
  });

  it('keeps a record whose weight only drifted, and still hands the tier the exact weight', () => {
    // `w = sqrt(subtreeSize / maxSubtreeSize)` rescales on nearly every build,
    // and the two readers of a held record's weight cannot see a drift this
    // small: the tier reads the array below, and the fabric reads a record
    // only at the moment it admits the edge.
    const held: PassiveSelection = {
      edges: [edge(1, 2, 0.5), edge(1, 3, 0.25), edge(2, 3)],
    };
    const before = [...held.edges];
    const delta = applyPassiveSelectionPatch(held, patchOf(held.edges, [], [], [
      edge(1, 2, 0.5 + PASSIVE_WEIGHT_GRAIN * 0.9),
      edge(1, 3, 0.25 - PASSIVE_WEIGHT_GRAIN / 2),
      edge(2, 3),
    ]));
    expect(delta.rewritten).toBe(0);
    expect(held.edges[0]).toBe(before[0]);
    expect(held.edges[1]).toBe(before[1]);
    expect(held.edges[2]).toBe(before[2]);
    // …and the exact values are there for the tier, every index, every build.
    expect([...held.weights!.subarray(0, 3)]).toEqual([
      0.5 + PASSIVE_WEIGHT_GRAIN * 0.9,
      0.25 - PASSIVE_WEIGHT_GRAIN / 2,
      Number.NaN,
    ]);
  });

  it('replaces a record whenever a reader could see the difference', () => {
    const moved = (from: NeighborEdge, to: NeighborEdge): number => {
      const held: PassiveSelection = { edges: [from, edge(9, 10)] };
      return applyPassiveSelectionPatch(
        held,
        patchOf(held.edges, [], [], [to, edge(9, 10)]),
      ).rewritten;
    };
    // Past the grain.
    expect(moved(edge(1, 2, 0.5), edge(1, 2, 0.5 + PASSIVE_WEIGHT_GRAIN * 1.01))).toBe(1);
    // A distance, however still the weight.
    expect(moved(edge(1, 2, 0.5), edge(1, 2, 0.5, 7))).toBe(1);
    // An arbor gained or lost — `arborBrightness` answers a different curve
    // without one, so the size of the move is beside the point.
    expect(moved(edge(1, 2), edge(1, 2, 0.001))).toBe(1);
    expect(moved(edge(1, 2, 0.001), edge(1, 2))).toBe(1);
    // A weight that carries no arbor is not the same as no weight, and is not
    // the same as one that does: both crossings are visible.
    expect(moved(edge(1, 2, 0), edge(1, 2))).toBe(1);
    expect(moved(edge(1, 2, 0), edge(1, 2, 0.001))).toBe(1);
  });

  it('spends its grain on the class the trunk tier actually reads', () => {
    // The rule above is only honest if "carries an arbor" means what
    // `fabricEdgeTrunkness` means by it; this is that agreement, spelled out.
    for (const w of [undefined, -1, 0, 1e-9, 0.001, 0.5, 1, Number.NaN]) {
      const promoted = fabricEdgeTrunkness(w) > 0;
      expect(passiveWeightClass(w)).toBe(w === undefined ? 0 : (promoted ? 2 : 1));
    }
  });

  it('replaces exactly the surviving records whose values moved and keeps every other object', () => {
    const held: PassiveSelection = {
      edges: [edge(1, 2, 0.5), edge(1, 3), edge(2, 3, 0.2), edge(3, 4)],
    };
    const before = [...held.edges];
    // A rescaled weight, a weight gained, a weight lost, and one untouched.
    const delta = applyPassiveSelectionPatch(held, patchOf(held.edges, [], [], [
      edge(1, 2, 0.7), edge(1, 3, 0.1), edge(2, 3), edge(3, 4),
    ]));
    expect(delta.added).toHaveLength(0);
    expect(delta.removed).toHaveLength(0);
    expect(delta.rewritten).toBe(3);
    expect(held.edges).toEqual([edge(1, 2, 0.7), edge(1, 3, 0.1), edge(2, 3), edge(3, 4)]);
    expect(held.edges[0]).not.toBe(before[0]);
    expect(held.edges[1]).not.toBe(before[1]);
    expect(held.edges[2]).not.toBe(before[2]);
    expect(held.edges[3]).toBe(before[3]);
    // The replaced records were not edited: a holder of the old record
    // still reads the weight it was handed.
    expect(before[0].w).toBe(0.5);
    // An added record carries this build's values and is confirmed, not
    // rewritten; a moved distance is a moved value like any other.
    const grown = applyPassiveSelectionPatch(held, patchOf(held.edges, [edge(2, 4, 0.3)], [], [
      edge(1, 2, 0.7), edge(1, 3, 0.1), edge(2, 3), edge(2, 4, 0.3), edge(3, 4, undefined, 9),
    ]));
    expect(grown.rewritten).toBe(1);
    expect(held.edges[3]).toBe(grown.added[0]);
    expect(held.edges[4]).toEqual(edge(3, 4, undefined, 9));
    expect(held.edges[4]).not.toBe(before[3]);
  });

  it('merges in place: same array, surviving records kept, dropped records handed back, canonical order', () => {
    const cells = fixtureCells();
    const options = { k: 2, maxEdgeLength: 8 };
    const before = buildPassiveNeighborGraph(
      buildNeighborGraph(cells, options),
      { edgeBudget: 6 },
    );
    cells.set(9, cell(9, 1, 1));
    cells.delete(7);
    const after = buildPassiveNeighborGraph(
      buildNeighborGraph(cells, options),
      { edgeBudget: 6, preferredEdges: before.edges },
    );
    const patch = collectPassiveSelectionPatch(before.edges, after.edges);

    const held = deserializePassiveSelection({ edges: packPassiveEdges(before.edges) });
    const array = held.edges;
    const survivors = new Map(held.edges.map((e) => [edgeKeyOf(e), e]));
    const delta = applyPassiveSelectionPatch(held, patch);

    expect(held.edges).toBe(array);
    expect(held.edges).toEqual(after.edges);
    expectCanonicalOrder(held.edges, 'merged');
    expect(delta.added.length).toBe(patch.added.length / 4);
    expect(delta.removed.length).toBe(patch.removedKeys.length / 2);
    expect(delta.added.length + delta.removed.length).toBeGreaterThan(0);
    // Every surviving key keeps its record unless its values moved, in
    // which case it has a fresh one — counted exactly.
    let kept = 0;
    let moved = 0;
    for (const e of held.edges) {
      const survivor = survivors.get(edgeKeyOf(e));
      if (survivor === undefined) {
        expect(delta.added).toContain(e);
      } else if (survivor.d === e.d && survivor.w === e.w) {
        expect(e).toBe(survivor);
        kept += 1;
      } else {
        expect(e).not.toBe(survivor);
        moved += 1;
      }
    }
    expect(kept + moved).toBeGreaterThan(0);
    expect(delta.rewritten).toBe(moved);
    for (const e of delta.removed) expect(survivors.get(edgeKeyOf(e))).toBe(e);
  });

  it('rejects a patch that does not fit the held list and leaves it untouched', () => {
    const held: PassiveSelection = { edges: [edge(1, 2), edge(1, 3), edge(2, 3)] };
    const snapshot = [...held.edges];
    expect(() => applyPassiveSelectionPatch(held, patchOf(held.edges, [], [edge(4, 5)])))
      .toThrow(/does not hold/);
    expect(() => applyPassiveSelectionPatch(held, patchOf(held.edges, [], [edge(0, 1)])))
      .toThrow(/does not hold/);
    expect(() => applyPassiveSelectionPatch(held, patchOf(held.edges, [edge(1, 3)], [])))
      .toThrow(/already holds/);
    expect(() => applyPassiveSelectionPatch(held, patchOf(held.edges, [edge(3, 4), edge(2, 4)], [])))
      .toThrow(/canonical order/);
    expect(() => applyPassiveSelectionPatch(held, patchOf(held.edges, [], [edge(2, 3), edge(1, 2)])))
      .toThrow(/canonical order/);
    expect(() => applyPassiveSelectionPatch(held, {
      ...patchOf(held.edges, [], []),
      removedKeys: new Float64Array(3),
    })).toThrow(/invalid packed passive key buffer/);
    expect(() => applyPassiveSelectionPatch(held, {
      ...patchOf(held.edges, [edge(3, 4)], []),
      values: new Float64Array(6),
    })).toThrow(/values do not cover/);
    expect(held.edges).toEqual(snapshot);
    for (let i = 0; i < snapshot.length; i += 1) expect(held.edges[i]).toBe(snapshot[i]);

    // A removal plus additions at both ends and in the middle land in order.
    const delta = applyPassiveSelectionPatch(
      held,
      patchOf(held.edges, [edge(0, 9), edge(1, 4), edge(7, 8)], [edge(1, 3)]),
    );
    expect(held.edges.map(edgeKeyOf)).toEqual(['0:9', '1:2', '1:4', '2:3', '7:8']);
    expect(delta.removed).toEqual([edge(1, 3)]);
    expect(delta.removed[0]).toBe(snapshot[1]);
    expect(delta.rewritten).toBe(0);
    expect(held.edges[1]).toBe(snapshot[0]);
    expect(held.edges[3]).toBe(snapshot[2]);
    // Removing everything and adding nothing empties the list in place.
    const emptied = applyPassiveSelectionPatch(held, patchOf(held.edges, [], [...held.edges]));
    expect(held.edges).toHaveLength(0);
    expect(emptied.removed).toHaveLength(5);
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
    // The passive oracle: a session fed the very requests the real one gets
    // (superseded ones included — they advance the continuity preference;
    // deltas as deltas — the arbor weights read the retained map's order),
    // only ever asked for whole forms. Its selection is the real session's.
    const mirror = createNeighborGraphWorkerSession();
    let mirrorTruth: PassiveSelection | null = null;
    const runBoth = (request: NeighborGraphWorkerRequest): NeighborGraphWorkerSuccess => {
      const response = session.execute(request);
      const mirrored = mirror.execute({
        ...request,
        requestId: 5000 + request.requestId,
        patchBaseGeneration: 0,
      });
      if (response.kind !== 'built') throw new Error(`unexpected ${response.kind}`);
      if (mirrored.kind !== 'built') throw new Error(`mirror: ${mirrored.kind}`);
      mirrorTruth = fullPassive(mirrored);
      return response;
    };
    const pack = (map: Map<number, Cell>) =>
      packTopologyCells(map as ReadonlyMap<number, NeighborGraphCell>);
    const passiveOff = {
      includePassive: false,
      passiveEdgeBudget: null,
      passiveTuning: null,
      preferredEdges: null,
    } as const;
    // Over-budget regime, as the 12K stage is: the forest exceeds the budget,
    // so the selection scatters and churns on every build.
    const passiveOn = {
      includePassive: true,
      passiveEdgeBudget: 400,
      passiveTuning: null,
      preferredEdges: null,
    } as const;

    let living: LivingNeighborGraph = emptyLivingNeighborGraph();
    let held: PassiveSelection | null = null;
    let applied = 0;
    let requestId = 1;
    const journalUpserts = new Map<number, Cell>();
    const journalRemoved = new Set<number>();
    let restoredTotal = 0;
    let patchApplies = 0;
    let fullApplies = 0;
    let passivePatchApplies = 0;
    let passiveChurn = 0;

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
      return applied === 0
        ? runBoth({
          kind: 'build', requestId: requestId++, cells: pack(sessionCells),
          cellsDelta: null, patchBaseGeneration: 0, options, ...passiveOn,
        })
        : runBoth({
          kind: 'build', requestId: requestId++, cells: null,
          cellsDelta: { baseGeneration: applied, upserts, removedIds },
          patchBaseGeneration: applied, options, ...passiveOn,
        });
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
      // The passive selection rides in the same form as the display graph
      // (every build here carries one), lands on the mirror's whole
      // selection record for record, and the delta handed to the fabric is
      // exactly the difference from the list held before.
      if (response.passiveGraph === null) throw new Error(`${label}: no selection`);
      expect(response.passiveGraph.kind, `${label}: passive form`).toBe(response.graph.kind);
      const truthPassive = mirrorTruth!;
      if (response.passiveGraph.kind === 'patch') {
        if (held === null) throw new Error(`${label}: patch without a base`);
        const beforeKeys = new Set(held.edges.map(edgeKeyOf));
        const array = held.edges;
        const delta = applyPassiveSelectionPatch(held, response.passiveGraph.patch);
        expect(held.edges, `${label}: same array`).toBe(array);
        for (const edge of delta.removed) {
          expect(beforeKeys.delete(edgeKeyOf(edge)), `${label}: removed ${edgeKeyOf(edge)} was held`).toBe(true);
        }
        for (const edge of delta.added) {
          expect(beforeKeys.has(edgeKeyOf(edge)), `${label}: added ${edgeKeyOf(edge)} was not held`).toBe(false);
          beforeKeys.add(edgeKeyOf(edge));
        }
        expect([...beforeKeys].sort(), `${label}: delta reproduces the list`)
          .toEqual(held.edges.map(edgeKeyOf).sort());
        passivePatchApplies += 1;
        passiveChurn += delta.added.length + delta.removed.length;
      } else {
        held = deserializePassiveSelection(response.passiveGraph);
      }
      expectSamePassive(held, truthPassive, label);
      expectCanonicalOrder(held.edges, label);
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
        // the next response must come back whole and unchained. The mirror
        // sees it too: it moved the session's continuity preference.
        runBoth({
          kind: 'build', requestId: requestId++, cells: pack(sessionCells),
          cellsDelta: null, patchBaseGeneration: 0, options, ...passiveOn,
        });
        for (const id of journalRemoved) sessionCells.delete(id);
        for (const c of journalUpserts.values()) sessionCells.set(c.id, c);
        journalRemoved.clear();
        journalUpserts.clear();
        const response = runBoth({
          kind: 'build', requestId: requestId++, cells: pack(sessionCells),
          cellsDelta: null, patchBaseGeneration: applied, options, ...passiveOn,
        });
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
    // The passive merge did real work too: every chained build patched the
    // held list, and the selection moved under the churn.
    expect(passivePatchApplies).toBe(patchApplies);
    expect(passiveChurn).toBeGreaterThan(0);
  });
});
