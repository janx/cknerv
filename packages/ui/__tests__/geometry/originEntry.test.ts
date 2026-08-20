// The entry index is an ACCELERATOR for `nearestGraphNode`, so most of what
// follows is differential: the grid must answer what the linear scan answers,
// node for node, including the tie-break — otherwise a pulse departs from a
// different address than the one the reference implementation names.

import { describe, expect, it } from 'vitest';
import type { NeighborGraph } from '../../src/geometry/neighborGraph';
import {
  buildOriginEntryIndex,
  ORIGIN_ENTRY_BUCKET_SIZE,
  type OriginEntryPositioned,
} from '../../src/geometry/originEntry';
import { nearestGraphNode } from '../../src/geometry/pathRouter';

type Pos = [number, number, number];

function mkCells(
  entries: ReadonlyArray<[number, Pos]>,
): Map<number, OriginEntryPositioned> {
  return new Map(entries.map(([id, pos]) => [id, { pos_seed: pos }]));
}

function mkGraph(edges: ReadonlyArray<[number, number]>): NeighborGraph {
  const adjacency = new Map<number, Set<number>>();
  function add(a: number, b: number) {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  }
  for (const [a, b] of edges) add(a, b);
  return {
    adjacency,
    edges: edges.map(([a, b]) => ({
      from: Math.min(a, b),
      to: Math.max(a, b),
      d: 1,
    })),
  };
}

/** Deterministic PRNG — a fixture that only sometimes reproduces cannot
 *  prove an equivalence. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bucket sides spanning three orders of magnitude around the shipped one:
 *  a side well under one node spacing, the real one, and a side that puts
 *  the whole field in a single bucket. Correctness may not depend on any
 *  of it — the side is a cost knob. */
const BUCKET_SIDES = [0.5, 3, ORIGIN_ENTRY_BUCKET_SIZE, 37, 500];

describe('buildOriginEntryIndex — equivalence with the linear scan', () => {
  it('answers a randomized field exactly as nearestGraphNode does, at every bucket side', () => {
    // 400 nodes over the tissue field's own extent, with the eligibility
    // exceptions the live graph really produces mixed in: degree-0 keys left
    // by death pruning, and graph keys whose Cell has already left the map.
    const rand = mulberry32(20260820);
    const cells = mkCells([]);
    const edges: [number, number][] = [];
    const ids: number[] = [];
    for (let i = 0; i < 400; i++) {
      const id = 1000 + i * 7;
      ids.push(id);
      cells.set(id, {
        pos_seed: [
          (rand() * 2 - 1) * 60,
          (rand() * 2 - 1) * 3,
          (rand() * 2 - 1) * 54,
        ],
      });
    }
    for (let i = 1; i < ids.length; i++) {
      edges.push([ids[i - 1], ids[i]]);
      if (rand() < 0.4) edges.push([ids[i], ids[Math.floor(rand() * i)]]);
    }
    const graph = mkGraph(edges);
    // Every 13th node loses its edges; every 17th loses its Cell. Both are
    // ineligible, and both must be ineligible in the SAME way on both paths.
    for (let i = 0; i < ids.length; i += 13) graph.adjacency.set(ids[i], new Set());
    for (let i = 0; i < ids.length; i += 17) cells.delete(ids[i]);
    // A node the graph never heard of, to prove the grid is built from the
    // graph's keys rather than the cells map's.
    cells.set(99991, { pos_seed: [0, 0, 0] });

    const queries: Pos[] = [];
    for (let q = 0; q < 200; q++) {
      queries.push([
        (rand() * 2 - 1) * 70,
        (rand() * 2 - 1) * 6,
        (rand() * 2 - 1) * 64,
      ]);
    }
    // Positions no eligible node is anywhere near: a derived origin can land
    // outside the staged field's own extent, and the ring walk must reach it
    // from outside rather than give up at the grid edge.
    queries.push([5000, 0, -5000], [-10000, 250, 10000], [0, 9999, 0], [61, 0, 55]);

    for (const bucketSize of BUCKET_SIDES) {
      const index = buildOriginEntryIndex(cells, graph, { bucketSize });
      for (const q of queries) {
        expect(index.nearest(q)).toBe(nearestGraphNode(cells, graph, q));
      }
    }
  });

  it('agrees on a lattice whose ties and bucket boundaries are exact', () => {
    // Floating-point fixtures never produce an exact tie, and exactly-tied
    // distances are where the id tie-break and the ring floor's strictness
    // both live. Integer spacing puts nodes ON bucket boundaries and query
    // points exactly equidistant from four of them at once.
    const rand = mulberry32(7);
    const cells = mkCells([]);
    const lattice: number[] = [];
    const shuffled = Array.from({ length: 100 }, (_, i) => 500 - i);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    let n = 0;
    for (let gx = 0; gx < 10; gx++) {
      for (let gz = 0; gz < 10; gz++) {
        const id = shuffled[n++];
        lattice.push(id);
        cells.set(id, { pos_seed: [gx * 2, 0, gz * 2] });
      }
    }
    const graph = mkGraph(lattice.slice(1).map((id, i) => [lattice[i], id]));

    const coords = [-3, -1, 0, 1, 3, 5, 7, 9, 11, 18, 21];
    for (const bucketSize of [2, 4, 8]) {
      const index = buildOriginEntryIndex(cells, graph, { bucketSize });
      for (const x of coords) {
        for (const z of coords) {
          const q: Pos = [x, 0, z];
          expect(index.nearest(q)).toBe(nearestGraphNode(cells, graph, q));
        }
      }
    }
  });

  it('finishes the ring past its first hit — the nearest node sits one bucket over', () => {
    // The classic early-stop bug: the query sits at the far edge of its own
    // bucket, so the node it contains is 39x farther than the one just
    // across the boundary. Stopping at the first non-empty bucket returns 2.
    const cells = mkCells([
      [1, [0, 0, 0]],
      [2, [8.1, 0, 0]],
      [3, [16.1, 0, 0]],
    ]);
    const graph = mkGraph([[1, 2], [2, 3]]);
    const index = buildOriginEntryIndex(cells, graph, {
      bucketSize: ORIGIN_ENTRY_BUCKET_SIZE,
    });
    const q: Pos = [15.9, 0, 0];
    expect(index.nearest(q)).toBe(3);
    expect(index.nearest(q)).toBe(nearestGraphNode(cells, graph, q));
  });

  it('breaks ties toward the lower id even across bucket boundaries', () => {
    const cells = mkCells([
      [7, [0, 0, 0]],
      [4, [16, 0, 0]],
    ]);
    const graph = mkGraph([[4, 7]]);
    const index = buildOriginEntryIndex(cells, graph, { bucketSize: 8 });
    expect(index.nearest([8, 0, 0])).toBe(4);
    expect(index.nearest([8, 0, 0])).toBe(nearestGraphNode(cells, graph, [8, 0, 0]));
  });

  it('buckets by XZ but measures in three dimensions', () => {
    // Same bucket, different heights: the far-in-Y node must lose. Y is
    // small on the real field, but "ignored for bucketing" must not leak
    // into "ignored for distance".
    const cells = mkCells([
      [1, [1, 40, 1]],
      [2, [2, 0, 2]],
    ]);
    const graph = mkGraph([[1, 2]]);
    const index = buildOriginEntryIndex(cells, graph);
    expect(index.nearest([0, 0, 0])).toBe(2);
    expect(index.nearest([0, 40, 0])).toBe(1);
  });

  it('holds only degree-bearing nodes present in the cells map, and answers null when it holds none', () => {
    const cells = mkCells([
      [1, [1, 0, 0]],   // nearest overall, but isolated
      [2, [5, 0, 0]],
      [3, [9, 0, 0]],
      [4, [2, 0, 0]],   // nearer than 2, but its Cell is gone
    ]);
    const graph = mkGraph([[2, 3], [4, 3]]);
    graph.adjacency.set(1, new Set());
    cells.delete(4);
    const index = buildOriginEntryIndex(cells, graph);
    expect(index.size).toBe(2);
    expect(index.nearest([0, 0, 0])).toBe(2);

    const empty = buildOriginEntryIndex(cells, mkGraph([]));
    expect(empty.size).toBe(0);
    expect(empty.nearest([0, 0, 0])).toBeNull();

    const one = buildOriginEntryIndex(cells, mkGraph([[2, 3]]));
    expect(one.nearest([1000, 0, 1000])).toBe(3);
  });
});

describe('buildOriginEntryIndex().entryFor', () => {
  it('leaves along the dying cell\'s own edge, not toward the nearest node', () => {
    // 50 is retracting but still adjacent to 1 and 2; node 3 is nearer to its
    // address than either and is where a plain grid query would send the
    // pulse — the fast path must prefer a real edge over proximity.
    const cells = mkCells([
      [50, [0, 0, 0]],
      [1, [10, 0, 0]],
      [2, [6, 0, 0]],
      [3, [1, 0, 0]],
    ]);
    const graph = mkGraph([[50, 1], [50, 2], [3, 1]]);
    const index = buildOriginEntryIndex(cells, graph);
    expect(index.entryFor(50, [0, 0, 0])).toBe(2);
    expect(index.nearest([0, 0, 0])).toBe(50);
  });

  it('skips neighbours that lost their Cell or every edge', () => {
    const cells = mkCells([
      [50, [0, 0, 0]],
      [1, [9, 0, 0]],
      [2, [3, 0, 0]],   // nearest neighbour, still edged, but its Cell is gone
      [3, [5, 0, 0]],   // next nearest, still mapped, but stranded at degree 0
      [4, [100, 0, 0]],
    ]);
    const graph = mkGraph([[1, 50], [2, 4]]);
    graph.adjacency.get(50)!.add(2).add(3);
    graph.adjacency.set(3, new Set());
    cells.delete(2);
    const index = buildOriginEntryIndex(cells, graph);
    expect(index.entryFor(50, [0, 0, 0])).toBe(1);
  });

  it('breaks equidistant neighbours toward the lower id', () => {
    const cells = mkCells([
      [50, [0, 0, 0]],
      [9, [4, 0, 0]],
      [6, [-4, 0, 0]],
    ]);
    const graph = mkGraph([[50, 9], [50, 6], [6, 9]]);
    const index = buildOriginEntryIndex(cells, graph);
    expect(index.entryFor(50, [0, 0, 0])).toBe(6);
  });

  it('falls back to the grid when the anchor has no adjacency left', () => {
    const cells = mkCells([
      [1, [3, 0, 0]],
      [2, [10, 0, 0]],
    ]);
    const graph = mkGraph([[1, 2]]);
    const index = buildOriginEntryIndex(cells, graph);
    const ghost: Pos = [0, 0, 0];
    expect(index.entryFor(70707, ghost)).toBe(1);
    expect(index.entryFor(70707, ghost)).toBe(nearestGraphNode(cells, graph, ghost));
  });

  it('falls back to the grid when adjacency yields no live candidate, and never returns the anchor', () => {
    // 5 is still a degree-bearing node with a Cell, so it is in the grid and
    // it IS the nearest node to its own address — the exclusion is the only
    // thing keeping it from being its own entry, and path[0] has to be a
    // cell that is still alive.
    const cells = mkCells([
      [5, [0, 0, 0]],
      [1, [3, 0, 0]],
      [2, [10, 0, 0]],
    ]);
    const graph = mkGraph([[5, 99], [1, 2]]);
    const index = buildOriginEntryIndex(cells, graph);
    expect(index.nearest([0, 0, 0])).toBe(5);
    expect(index.entryFor(5, [0, 0, 0])).toBe(1);
  });

  it('returns null when nothing anywhere is eligible', () => {
    const index = buildOriginEntryIndex(mkCells([]), mkGraph([[1, 2]]));
    expect(index.entryFor(1, [0, 0, 0])).toBeNull();
  });
});
