// The entry index is an ACCELERATOR for `nearestGraphNode`, so most of what
// follows is differential: the grid must answer what the linear scan answers,
// node for node, including the tie-break — otherwise a pulse departs from a
// different address than the one the reference implementation names.

import { describe, expect, it } from 'vitest';
import type { NeighborGraph } from '../../src/geometry/neighborGraph';
import {
  buildOriginEntryIndex,
  createOriginEntryIndexBuilder,
  ORIGIN_ENTRY_BUCKET_SIZE,
  ORIGIN_ENTRY_BUILD_QUANTUM,
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


// ── the build is resumable ───────────────────────────────────────────
//
// Whole, the build is the longest single grain the live planner takes (18 ms
// in a burst, 47 in a trough over a 12,000-node stage) and no wall budget can
// cut it, because a budget is only ever spent BETWEEN steps. Sliced, it must
// still be the same index — which is the only thing these assert, differentially
// against the drained build the rest of this file already holds to the linear
// scan.

/** A stage with the shape block churn leaves behind: eligible nodes, the two
 *  ineligibility exceptions, deaths removed from both maps and births appended
 *  AFTER them, so the graph's iteration order is nothing like the positions. */
function churnedField(seed: number, size: number) {
  const rand = mulberry32(seed);
  const cells = mkCells([]);
  const adjacency = new Map<number, Set<number>>();
  const ids: number[] = [];
  const place = (id: number) => {
    ids.push(id);
    cells.set(id, {
      pos_seed: [
        (rand() * 2 - 1) * 60,
        (rand() * 2 - 1) * 3,
        (rand() * 2 - 1) * 54,
      ],
    });
    adjacency.set(id, new Set());
  };
  // The two id families cknerv allocates: sequential-small and 2^52.
  for (let i = 0; i < size; i++) {
    place(i % 3 === 0 ? 1000 + i * 7 : 2 ** 52 + i * 13);
  }
  // A node the churn already removed simply gains no edge — the graph must
  // stay the shape the live one has, not a repaired one.
  const edge = (a: number, b: number) => {
    const sa = adjacency.get(a);
    const sb = adjacency.get(b);
    if (sa === undefined || sb === undefined) return;
    sa.add(b);
    sb.add(a);
  };
  for (let i = 1; i < ids.length; i++) {
    edge(ids[i - 1], ids[i]);
    if (rand() < 0.4) edge(ids[i], ids[Math.floor(rand() * i)]);
  }
  // Deaths: gone from the graph, and a few left in the graph with no Cell.
  for (let i = 5; i < ids.length; i += 47) adjacency.delete(ids[i]);
  for (let i = 11; i < ids.length; i += 53) cells.delete(ids[i]);
  // Death pruning strands neighbourless keys; they are real and ineligible.
  for (let i = 17; i < ids.length; i += 61) adjacency.set(ids[i], new Set());
  // Births land at the END of the map, long after their neighbours.
  for (let i = 0; i < size / 8; i++) {
    const id = 2 ** 52 + 900000 + i * 3;
    place(id);
    edge(id, ids[Math.floor(rand() * (ids.length - 1))]);
  }
  const graph: NeighborGraph = { adjacency, edges: [] };
  const queries: Pos[] = [];
  for (let q = 0; q < 120; q++) {
    queries.push([
      (rand() * 2 - 1) * 70,
      (rand() * 2 - 1) * 6,
      (rand() * 2 - 1) * 64,
    ]);
  }
  queries.push([5000, 0, -5000], [-10000, 250, 10000], [0, 9999, 0]);
  return { cells, graph, ids, queries };
}

/** A cells map that counts its lookups and charges a fake clock for each —
 *  the injected per-cell cost, since the collect pass IS `cells.get` plus a
 *  dereference and nothing else the quantum can bound. */
class CostingCells extends Map<number, OriginEntryPositioned> {
  gets = 0;
  wallMs = 0;
  costMs = 0;
  override get(id: number): OriginEntryPositioned | undefined {
    this.gets += 1;
    this.wallMs += this.costMs;
    return super.get(id);
  }
}

describe('createOriginEntryIndexBuilder — the stage-wide build, one chunk at a time', () => {
  it('resumed at any quantum, answers exactly what the drained build answers', () => {
    const { cells, graph, ids, queries } = churnedField(20260907, 1200);
    const whole = buildOriginEntryIndex(cells, graph);
    expect(whole.size).toBeGreaterThan(1000);
    // Anchors of all three kinds: a node still carrying adjacency (the fast
    // path), one whose edges were pruned, and an id the graph never held.
    const anchors = [ids[3], ids[17], ids[47], ids[5], 7777777];

    for (const quantum of [1, 2, 3, 17, 256, ORIGIN_ENTRY_BUILD_QUANTUM, 1e9]) {
      const builder = createOriginEntryIndexBuilder(cells, graph);
      let steps = 0;
      while (!builder.step(quantum)) steps += 1;
      steps += 1;
      expect(builder.done).toBe(true);
      // A small quantum really did split it; a huge one really did not.
      if (quantum <= 256) expect(steps).toBeGreaterThan(1);
      if (quantum === 1e9) expect(steps).toBe(1);

      const resumed = builder.index();
      expect(resumed.size).toBe(whole.size);
      for (const q of queries) {
        expect(resumed.nearest(q)).toBe(whole.nearest(q));
        expect(resumed.nearest(q, ids[0])).toBe(whole.nearest(q, ids[0]));
      }
      for (const anchor of anchors) {
        for (const q of queries.slice(0, 20)) {
          expect(resumed.entryFor(anchor, q)).toBe(whole.entryFor(anchor, q));
        }
      }
    }
  });

  it('examines at most its quantum of nodes a step, costs at most that, and always advances', () => {
    // Every node eligible, so the collect cursor is readable straight off
    // `visited` and a step's cost is exactly the nodes it touched.
    const cells = new CostingCells();
    const adjacency = new Map<number, Set<number>>();
    const ids: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const id = 500 + i * 3;
      ids.push(id);
      cells.set(id, { pos_seed: [i % 37, 0, Math.floor(i / 37)] });
      adjacency.set(id, new Set());
    }
    for (let i = 1; i < ids.length; i++) {
      adjacency.get(ids[i - 1])!.add(ids[i]);
      adjacency.get(ids[i])!.add(ids[i - 1]);
    }
    const graph: NeighborGraph = { adjacency, edges: [] };
    cells.costMs = 0.01; // 10 ms for the whole walk

    const quantum = 100;
    const builder = createOriginEntryIndexBuilder(cells, graph);
    let steps = 0;
    let lastVisited = 0;
    let worstStepMs = 0;
    while (!builder.done) {
      const getsBefore = cells.gets;
      const msBefore = cells.wallMs;
      builder.step(quantum);
      steps += 1;
      const examined = cells.gets - getsBefore;
      const stepMs = cells.wallMs - msBefore;
      worstStepMs = Math.max(worstStepMs, stepMs);
      // The bound the frame budget is bought with.
      expect(examined).toBeLessThanOrEqual(quantum);
      expect(stepMs).toBeLessThanOrEqual(quantum * cells.costMs + 1e-9);
      // And it always moves: while the walk is unfinished the cursor grows by
      // the full quantum, so no frame is ever spent on nothing.
      if (builder.visited < 1000) {
        expect(builder.visited).toBe(lastVisited + quantum);
      }
      lastVisited = builder.visited;
      expect(steps).toBeLessThan(100); // termination, not a hang
    }
    expect(builder.visited).toBe(1000);
    expect(cells.gets).toBe(1000); // one lookup per node, no rewalk
    expect(steps).toBeGreaterThanOrEqual(1000 / quantum);
    // The whole walk is 10 ms; no single step carried more than its share.
    expect(worstStepMs).toBeLessThanOrEqual(quantum * cells.costMs + 1e-9);
    expect(builder.index().size).toBe(1000);
  });

  it('never hands out a partial grid: asking part-way through finishes the build first', () => {
    // The one reader that can still arrive mid-build — a rescue substituting a
    // destination on a batch no link predicted would query the grid — must pay
    // the old whole grain and get the whole answer, never a grid missing the
    // nodes the walk had not reached.
    const { cells, graph, queries } = churnedField(4242, 600);
    const whole = buildOriginEntryIndex(cells, graph);
    const builder = createOriginEntryIndexBuilder(cells, graph);
    builder.step(1);
    expect(builder.done).toBe(false);
    expect(builder.visited).toBeLessThan(whole.size);

    const early = builder.index();
    expect(builder.done).toBe(true);
    expect(early.size).toBe(whole.size);
    for (const q of queries) expect(early.nearest(q)).toBe(whole.nearest(q));
    // The same object every time, and still complete.
    expect(builder.index()).toBe(early);
  });
});
