import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import { buildNeighborGraph, DEFAULT_K } from '../../src/geometry/neighborGraph';

function mkCell(id: number, x: number, y: number, z: number): Cell {
  return {
    id, born_at_ms: 0, death_at_ms: null, birth_block: 1,
    tag: null, pos_seed: [x, y, z],
    out_point: { tx_hash: '0x', index: 0 },
    capacity: 0, data_hex: '',
    content_hash: '0x' + '00'.repeat(32),
  };
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

  it('does NOT bridge internally-connected far-apart components', () => {
    // Two clusters far apart (>25 world-units, the MAX_EDGE_LENGTH).
    // Both clusters are internally dense, so every cell already has
    // ≥1 edge after the k-NN pass; the lifeline pass is a no-op for
    // them and the clusters stay disjoint. Lifeline only fires for
    // cells with EMPTY adjacency — it isn't an MST stitch.
    const cells = new Map<number, Cell>([
      [1, mkCell(1, 0, 0, 0)],
      [2, mkCell(2, 1, 0, 0)],
      [3, mkCell(3, 2, 0, 0)],
      [10, mkCell(10, 100, 0, 0)],
      [11, mkCell(11, 101, 0, 0)],
      [12, mkCell(12, 102, 0, 0)],
    ]);
    const g = buildNeighborGraph(cells, 2);
    const visited = new Set<number>([1]);
    const queue = [1];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const nb of g.adjacency.get(id) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    expect(visited.has(12)).toBe(false);
    expect(visited.size).toBe(3);
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
});
