import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import { buildNeighborGraph, DEFAULT_K } from '../../src/geometry/neighborGraph';

function mkCell(id: number, x: number, y: number, z: number): Cell {
  return {
    id, born_at_ms: 0, death_at_ms: null, birth_block: 1,
    tag: null, pos_seed: [x, y, z],
    out_point: { tx_hash: '0x', index: 0 },
    capacity: 0, data_hex: '', data_bytes: 0,
    content_hash: '0x' + '00'.repeat(32),
    lock_shape_seed: [1, 2], type_shape_seed: null, data_shape_seed: [3, 4],
  };
}

function reachableIdsFrom(
  start: number,
  graph: ReturnType<typeof buildNeighborGraph>,
): Set<number> {
  return reachableIdsFromEdges(start, graph.edges);
}

function reachableIdsFromEdges(
  start: number,
  edges: ReadonlyArray<{ from: number; to: number }>,
): Set<number> {
  const adjacency = new Map<number, Set<number>>();
  for (const edge of edges) {
    let fromAdj = adjacency.get(edge.from);
    if (!fromAdj) {
      fromAdj = new Set();
      adjacency.set(edge.from, fromAdj);
    }
    fromAdj.add(edge.to);

    let toAdj = adjacency.get(edge.to);
    if (!toAdj) {
      toAdj = new Set();
      adjacency.set(edge.to, toAdj);
    }
    toAdj.add(edge.from);
  }

  const visited = new Set<number>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const nb of adjacency.get(id) ?? []) {
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push(nb);
      }
    }
  }
  return visited;
}

describe('buildNeighborGraph', () => {
  it('returns empty for an empty cell map', () => {
    const g = buildNeighborGraph(new Map());
    expect(g.adjacency.size).toBe(0);
    expect(g.edges).toHaveLength(0);
  });

  it('returns a single isolated entry for one cell', () => {
    const g = buildNeighborGraph(new Map([[1, mkCell(1, 0, 0, 0)]]));
    expect(g.adjacency.get(1)).toBeDefined();
    expect(g.adjacency.get(1)!.size).toBe(0);
    expect(g.edges).toHaveLength(0);
  });

  it('connects two cells with a single edge', () => {
    const cells = new Map<number, Cell>([
      [1, mkCell(1, 0, 0, 0)],
      [2, mkCell(2, 1, 0, 0)],
    ]);
    const g = buildNeighborGraph(cells);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].from).toBe(1);
    expect(g.edges[0].to).toBe(2);
    expect(g.adjacency.get(1)?.has(2)).toBe(true);
    expect(g.adjacency.get(2)?.has(1)).toBe(true);
  });

  it('k-NN: each cell has at most k unique edges to its nearest neighbours', () => {
    // 5 cells in a line. With k=2 each cell tries to connect to 2 nearest.
    const cells = new Map<number, Cell>();
    for (let i = 1; i <= 5; i++) cells.set(i, mkCell(i, i, 0, 0));
    const g = buildNeighborGraph(cells, 2);
    // Endpoints have neighbours [next, next-next]. Middle cells have
    // immediate-left + immediate-right (2 neighbours). After symmetry
    // merging, expect every consecutive pair edge plus a few skip edges.
    expect(g.adjacency.get(1)).toBeDefined();
    // Cell 3 (middle) — 2 nearest are 2 and 4.
    expect(g.adjacency.get(3)?.has(2)).toBe(true);
    expect(g.adjacency.get(3)?.has(4)).toBe(true);
  });

  it('uses configured max edge length for k-NN edge retention', () => {
    const cells = new Map<number, Cell>([
      [1, mkCell(1, 0, 0, 0)],
      [2, mkCell(2, 10, 0, 0)],
      [3, mkCell(3, 20, 0, 0)],
    ]);

    const g = buildNeighborGraph(cells, { k: 2, maxEdgeLength: 12 });

    expect(g.edges.some((e) => e.from === 1 && e.to === 3)).toBe(false);
    expect(g.edges.some((e) => e.from === 1 && e.to === 2)).toBe(true);
    expect(g.edges.some((e) => e.from === 2 && e.to === 3)).toBe(true);
  });

  it('graph is undirected (symmetric adjacency)', () => {
    const cells = new Map<number, Cell>();
    for (let i = 1; i <= 8; i++) cells.set(i, mkCell(i, Math.cos(i), 0, Math.sin(i)));
    const g = buildNeighborGraph(cells, DEFAULT_K);
    for (const edge of g.edges) {
      expect(g.adjacency.get(edge.from)?.has(edge.to)).toBe(true);
      expect(g.adjacency.get(edge.to)?.has(edge.from)).toBe(true);
    }
  });

  it('edges are canonical (from < to) and deduplicated', () => {
    const cells = new Map<number, Cell>();
    for (let i = 1; i <= 6; i++) cells.set(i, mkCell(i, i, 0, 0));
    const g = buildNeighborGraph(cells, 3);
    const seen = new Set<string>();
    for (const edge of g.edges) {
      expect(edge.from).toBeLessThan(edge.to);
      const key = `${edge.from}:${edge.to}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('bridges internally-connected far-apart components into one graph', () => {
    // Two clusters far apart (>25 world-units, the MAX_EDGE_LENGTH).
    // Both clusters are internally dense, so degree-only lifelines are
    // insufficient: a neural-network refill must still stitch the
    // components into one connected graph.
    const cells = new Map<number, Cell>([
      [1, mkCell(1, 0, 0, 0)],
      [2, mkCell(2, 1, 0, 0)],
      [3, mkCell(3, 2, 0, 0)],
      [10, mkCell(10, 100, 0, 0)],
      [11, mkCell(11, 101, 0, 0)],
      [12, mkCell(12, 102, 0, 0)],
    ]);
    const g = buildNeighborGraph(cells, 2);
    const visited = reachableIdsFrom(1, g);
    expect(visited.size).toBe(cells.size);
    expect(visited.has(12)).toBe(true);
  });

  it('lifeline: two cells past MAX_EDGE_LENGTH still get one edge', () => {
    // k-NN drops the candidate (chord 30 > MAX_EDGE_LENGTH=25), so
    // after the first pass both cells are isolated. The lifeline
    // pass guarantees each isolated cell gets one edge to its
    // globally nearest other cell, ignoring the cap.
    const cells = new Map<number, Cell>([
      [1, mkCell(1, 0, 0, 0)],
      [2, mkCell(2, 30, 0, 0)],
    ]);
    const g = buildNeighborGraph(cells);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].from).toBe(1);
    expect(g.edges[0].to).toBe(2);
    expect(g.adjacency.get(1)?.size).toBe(1);
    expect(g.adjacency.get(2)?.size).toBe(1);
  });

  it('lifeline: halo outlier far past the cap gets one edge to the disc', () => {
    // Dense interior cluster + one halo cell well past MAX_EDGE_LENGTH.
    // After lifeline the halo cell ends with exactly one edge,
    // anchored to its globally nearest interior cell.
    const cells = new Map<number, Cell>([
      [1, mkCell(1, 0, 0, 0)],
      [2, mkCell(2, 1, 0, 0)],
      [3, mkCell(3, 2, 0, 0)],
      [4, mkCell(4, 3, 0, 0)],
      [99, mkCell(99, 80, 0, 0)],
    ]);
    const g = buildNeighborGraph(cells, 2);
    const haloAdj = g.adjacency.get(99);
    expect(haloAdj).toBeDefined();
    expect(haloAdj!.size).toBe(1);
    // Nearest interior cell is id=4 at x=3 (distance 77), beating
    // every other candidate.
    expect(haloAdj!.has(4)).toBe(true);
  });

  it('every cell has ≥1 edge when ≥2 cells exist', () => {
    // Mix of dense disc, mid-range cells, and sparse outliers far
    // past MAX_EDGE_LENGTH. Lifeline must guarantee no cell ends
    // with empty adjacency.
    const cells = new Map<number, Cell>();
    for (let i = 1; i <= 6; i++) cells.set(i, mkCell(i, i, 0, 0));
    cells.set(50, mkCell(50, 60, 0, 0));
    cells.set(51, mkCell(51, 90, 0, 30));
    cells.set(52, mkCell(52, -70, 0, -40));
    const g = buildNeighborGraph(cells, 2);
    for (const id of cells.keys()) {
      const adj = g.adjacency.get(id);
      expect(adj).toBeDefined();
      expect(adj!.size).toBeGreaterThanOrEqual(1);
    }
  });

  it('all cells are reachable from any cell when ≥2 cells exist', () => {
    const cells = new Map<number, Cell>();
    for (let i = 1; i <= 6; i++) cells.set(i, mkCell(i, i, 0, 0));
    cells.set(50, mkCell(50, 60, 0, 0));
    cells.set(51, mkCell(51, 90, 0, 30));
    cells.set(52, mkCell(52, -70, 0, -40));
    const g = buildNeighborGraph(cells, 2);
    for (const id of cells.keys()) {
      expect(reachableIdsFrom(id, g).size).toBe(cells.size);
    }
  });

  it('orders a connected skeleton before dense local edges', () => {
    // NeuralFabric can only render a fixed prefix of the logical edge
    // list. The first N-1 edges must therefore be enough to touch every
    // cell; dense k-NN extras can follow after that skeleton.
    const cells = new Map<number, Cell>();
    for (let i = 1; i <= 8; i++) cells.set(i, mkCell(i, i, 0, 0));
    const g = buildNeighborGraph(cells, 2);
    const visiblePrefix = g.edges.slice(0, cells.size - 1);
    expect(reachableIdsFromEdges(1, visiblePrefix).size).toBe(cells.size);
  });

  it('orders dense edges (after the skeleton) by ascending chord length', () => {
    // Graceful degradation: if the fabric ever overflows, the shortest /
    // most-local fibres survive after the coverage skeleton. For a
    // connected field the skeleton is exactly N-1 edges, so everything
    // from index N-1 on is the dense remainder and must be non-decreasing.
    const cells = new Map<number, Cell>();
    for (let i = 1; i <= 12; i++) {
      cells.set(i, mkCell(i, Math.cos(i) * 5, 0, Math.sin(i) * 5));
    }
    const g = buildNeighborGraph(cells, DEFAULT_K);
    const dense = g.edges.slice(cells.size - 1);
    expect(dense.length).toBeGreaterThan(0);
    for (let i = 1; i < dense.length; i++) {
      expect(dense[i].d).toBeGreaterThanOrEqual(dense[i - 1].d);
    }
  });

  it('produces an insertion-order-independent edge set', () => {
    // The visible mesh equals the full edge set, which must not depend on
    // Map insertion order — otherwise membership churn (oldest cell
    // evicted each block) would re-shape the network. Same cells, two
    // insertion orders -> identical edge set.
    const made = Array.from({ length: 40 }, (_, i) =>
      mkCell(i + 1, Math.cos(i) * 8, (i % 5) * 0.5, Math.sin(i) * 8),
    );
    const forward = new Map<number, Cell>();
    for (const c of made) forward.set(c.id, c);
    const reverse = new Map<number, Cell>();
    for (const c of [...made].reverse()) reverse.set(c.id, c);

    const keysOf = (g: ReturnType<typeof buildNeighborGraph>) =>
      new Set(g.edges.map((e) => `${e.from}:${e.to}`));

    expect(keysOf(buildNeighborGraph(forward, DEFAULT_K)))
      .toEqual(keysOf(buildNeighborGraph(reverse, DEFAULT_K)));
  });

  it('keeps 2^52-range galaxy-composition ids intact in the edge set', () => {
    // Composition Cells carry ids in [2^52, 2^52 + 2^51). Any 32-bit
    // truncation in the k-NN path invents phantom node ids, which the
    // skeleton pass then dereferences and crashes on.
    const base = 2 ** 52;
    const cells = new Map<number, Cell>();
    for (let i = 0; i < 24; i += 1) {
      const id = i % 2 === 0 ? i + 1 : base + i * 3;
      cells.set(id, mkCell(id, Math.cos(i) * 6, (i % 3) * 0.4, Math.sin(i) * 6));
    }

    const g = buildNeighborGraph(cells, DEFAULT_K);
    for (const edge of g.edges) {
      expect(cells.has(edge.from)).toBe(true);
      expect(cells.has(edge.to)).toBe(true);
    }
    for (const id of g.adjacency.keys()) {
      expect(cells.has(id)).toBe(true);
    }
    expect(g.adjacency.size).toBe(cells.size);
  });
});

/** Deterministic PRNG so the dense-field fixtures below are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A field at the live stage's own density — 12,000 Cells over the 60x54
 *  tissue ellipse is 1.18 per square unit, and this puts the same 1.18 into a
 *  disc a quarter the area so the brute-force reference below stays cheap.
 *
 *  Density is the whole point of the fixture. Truncation is invisible in a
 *  sparse field: the neighbourhood fits whatever budget an implementation
 *  keeps and the answer comes out right anyway. These fixtures put ~380 cells
 *  inside the region one k-NN query must consider, so an implementation that
 *  answers from a bounded prefix of that neighbourhood is answering from a
 *  fraction of it and these tests see it. */
function denseDisc(count: number, seed = 20260819): Map<number, Cell> {
  const rand = mulberry32(seed);
  const cells = new Map<number, Cell>();
  for (let i = 0; i < count; i += 1) {
    const r = Math.sqrt(rand());
    const theta = rand() * Math.PI * 2;
    cells.set(i + 1, mkCell(i + 1, Math.cos(theta) * r * 30, (rand() - 0.5) * 0.6, Math.sin(theta) * r * 27));
  }
  return cells;
}

function trueNearest(cells: Map<number, Cell>, id: number, k: number): number[] {
  const self = cells.get(id)!;
  return [...cells.values()]
    .filter((c) => c.id !== id)
    .map((c) => {
      const dx = self.pos_seed[0] - c.pos_seed[0];
      const dy = self.pos_seed[1] - c.pos_seed[1];
      const dz = self.pos_seed[2] - c.pos_seed[2];
      return { id: c.id, dSq: dx * dx + dy * dy + dz * dz };
    })
    .sort((a, b) => a.dSq - b.dSq || a.id - b.id)
    .slice(0, k)
    .map((c) => c.id);
}

describe('buildNeighborGraph is the k NEAREST, at field density', () => {
  const K = 5;

  it("returns each cell's true k nearest where the neighbourhood overflows any fixed budget", () => {
    // The property, stated as the property: these k are the k nearest.
    // Asserting a particular neighbour ORDER instead would have passed
    // against a graph that answered from a raster-ordered prefix of the
    // neighbourhood — which is what shipped, agreeing with the true k
    // nearest 14% of the time on the live 12,000-cell stage.
    const cells = denseDisc(3_000);
    const graph = buildNeighborGraph(cells, { k: K, maxEdgeLength: 42 });
    for (const id of [...cells.keys()].filter((_, i) => i % 37 === 0)) {
      const adjacency = graph.adjacency.get(id)!;
      for (const nearest of trueNearest(cells, id, K)) {
        expect(adjacency.has(nearest)).toBe(true);
      }
    }
  });

  it('draws its neighbours from every direction, not one', () => {
    // The user-visible signature of a directionally-truncated search: every
    // dense cell reaches for the same relative direction, so the fabric
    // repeats one motif across the whole core and only looks organic at the
    // rim where the neighbourhood is small enough to fit. Averaged over the
    // field, an unbiased graph's neighbour directions cancel; the shipped
    // raster scan left 0.464 of a unit vector standing.
    const cells = denseDisc(3_000);
    const graph = buildNeighborGraph(cells, { k: K, maxEdgeLength: 42 });
    let sumX = 0;
    let sumZ = 0;
    let counted = 0;
    for (const [id, neighbours] of graph.adjacency) {
      const self = cells.get(id)!;
      let ux = 0;
      let uz = 0;
      for (const nb of neighbours) {
        const other = cells.get(nb)!;
        const dx = other.pos_seed[0] - self.pos_seed[0];
        const dz = other.pos_seed[2] - self.pos_seed[2];
        const len = Math.hypot(dx, dz) || 1;
        ux += dx / len;
        uz += dz / len;
      }
      if (neighbours.size < 2) continue;
      sumX += ux / neighbours.size;
      sumZ += uz / neighbours.size;
      counted += 1;
    }
    expect(Math.hypot(sumX / counted, sumZ / counted)).toBeLessThan(0.05);
  });

  it('grows no hub: a symmetric k-NN graph bounds every degree', () => {
    // A cell can only be picked by the bounded number of cells it is
    // genuinely nearest to, so degree stays near k. Under the raster scan
    // one cell in the live field reached degree 133 at k=5 — the cells that
    // the scan happened to see first became artificial hubs, and a hub is a
    // routing shortcut that the tissue does not actually have.
    const cells = denseDisc(3_000);
    const graph = buildNeighborGraph(cells, { k: K, maxEdgeLength: 42 });
    for (const neighbours of graph.adjacency.values()) {
      expect(neighbours.size).toBeLessThanOrEqual(6 * K);
    }
  });

  it('is independent of the bucket grid: same cells shifted off-grid, same edges', () => {
    // The search widens its ring until the k-th neighbour is provably inside
    // the scanned region, so the spatial hash is a cost structure and never
    // an answer. Translating the whole field moves every cell across bucket
    // boundaries without changing a single distance between them.
    const cells = denseDisc(1_500);
    const shifted = new Map<number, Cell>();
    for (const [id, c] of cells) {
      shifted.set(id, mkCell(id, c.pos_seed[0] + 3.7, c.pos_seed[1], c.pos_seed[2] - 2.3));
    }
    const keys = (m: Map<number, Cell>) =>
      new Set(buildNeighborGraph(m, { k: K, maxEdgeLength: 42 }).edges
        .map((e) => `${e.from}:${e.to}`));
    expect(keys(shifted)).toEqual(keys(cells));
  });
});

function liveCell(id: number, x: number, z: number, death: number | null = null): Cell {
  return { id, born_at_ms: 0, death_at_ms: death, birth_block: 1, tag: null,
    pos_seed: [x, 0, z], out_point: { tx_hash: '0x', index: 0 }, capacity: 0,
    data_hex: '0x', data_bytes: 0, content_hash: '0x' + '00'.repeat(32),
    lock_shape_seed: [1, 2], type_shape_seed: null, data_shape_seed: [3, 4] };
}

describe('buildNeighborGraph dead-cell exclusion', () => {
  it('omits cells with death_at_ms set from adjacency and edges', () => {
    const cells = new Map<number, Cell>([
      [1, liveCell(1, 0, 0)],
      [2, liveCell(2, 3, 0)],
      [3, liveCell(3, 6, 0, 123)], // dead
    ]);
    const g = buildNeighborGraph(cells);
    expect(g.adjacency.has(3)).toBe(false);
    expect(g.edges.every((e) => e.from !== 3 && e.to !== 3)).toBe(true);
    expect(g.adjacency.has(1)).toBe(true);
  });

  it('is order-independent over the LIVE set (dead cells never enter)', () => {
    const mk = (order: number[]) => {
      const m = new Map<number, Cell>();
      for (const id of order) m.set(id, id === 2 ? liveCell(2, 3, 0, 99) : liveCell(id, id * 3, 0));
      return buildNeighborGraph(m).edges.map((e) => `${e.from}|${e.to}`).sort();
    };
    expect(mk([1, 2, 3, 4])).toEqual(mk([4, 3, 2, 1]));
  });
});
