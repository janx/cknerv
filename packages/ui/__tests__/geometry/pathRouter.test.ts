import { describe, expect, it } from 'vitest';
import type { NeighborGraph } from '../../src/geometry/neighborGraph';
import { shortestPath, shortestPathsToTargets } from '../../src/geometry/pathRouter';

function mkGraph(edges: [number, number][]): NeighborGraph {
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
    edges: edges.map(([a, b]) => ({ from: Math.min(a, b), to: Math.max(a, b), d: 1 })),
  };
}

describe('shortestPath', () => {
  it('returns [source] when source equals target', () => {
    const g = mkGraph([[1, 2]]);
    expect(shortestPath(g, 1, 1)).toEqual([1]);
  });

  it('returns null when source is missing from the graph', () => {
    const g = mkGraph([[1, 2]]);
    expect(shortestPath(g, 99, 1)).toBeNull();
  });

  it('returns null when target is missing', () => {
    const g = mkGraph([[1, 2]]);
    expect(shortestPath(g, 1, 99)).toBeNull();
  });

  it('returns a 2-element path for direct neighbours', () => {
    const g = mkGraph([[1, 2]]);
    expect(shortestPath(g, 1, 2)).toEqual([1, 2]);
  });

  it('finds the shortest path through a chain', () => {
    // 1 — 2 — 3 — 4 — 5
    const g = mkGraph([[1, 2], [2, 3], [3, 4], [4, 5]]);
    expect(shortestPath(g, 1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('prefers fewer hops over Euclidean shortness', () => {
    //   1 — 2 — 3 — 4   (chain)
    //   1 ─────── 4    (direct)
    const g = mkGraph([[1, 2], [2, 3], [3, 4], [1, 4]]);
    const path = shortestPath(g, 1, 4);
    expect(path).toEqual([1, 4]);
  });

  it('returns null when target is reachable only beyond maxHops', () => {
    // Chain of 10 cells: 1 — 2 — … — 10
    const edges: [number, number][] = [];
    for (let i = 1; i < 10; i++) edges.push([i, i + 1]);
    const g = mkGraph(edges);
    expect(shortestPath(g, 1, 10, 5)).toBeNull();
    // Within cap → returns path.
    expect(shortestPath(g, 1, 10, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('handles disconnected graphs (no path) by returning null', () => {
    const g = mkGraph([[1, 2], [10, 11]]);
    expect(shortestPath(g, 1, 11)).toBeNull();
  });
});

describe('shortestPathsToTargets', () => {
  /** Multi-target results must be byte-identical to routing each pair alone. */
  function expectEquivalent(
    g: NeighborGraph,
    source: number,
    targets: number[],
    maxHops?: number,
  ) {
    const multi = shortestPathsToTargets(g, source, targets, maxHops);
    for (const target of targets) {
      const single = shortestPath(g, source, target, maxHops);
      expect(multi.get(target) ?? null).toEqual(single);
    }
    // No extra entries beyond the requested targets.
    for (const key of multi.keys()) expect(targets).toContain(key);
  }

  it('matches per-target shortestPath across mixed reachability', () => {
    //   1 — 2 — 3 — 4 — 5   chain, plus 1—4 shortcut, plus island 10—11
    const g = mkGraph([[1, 2], [2, 3], [3, 4], [4, 5], [1, 4], [10, 11]]);
    expectEquivalent(g, 1, [2, 4, 5, 11, 99, 1]);
    expectEquivalent(g, 3, [1, 5, 10]);
  });

  it('matches per-target results at the exact maxHops boundary', () => {
    const edges: [number, number][] = [];
    for (let i = 1; i < 10; i++) edges.push([i, i + 1]);
    const g = mkGraph(edges);
    // 10 is 9 hops out: absent at cap 5 and 8, present at 9 — same as single.
    expectEquivalent(g, 1, [3, 6, 10], 5);
    expectEquivalent(g, 1, [3, 6, 10], 8);
    expectEquivalent(g, 1, [3, 6, 10], 9);
  });

  it('returns an empty map when the source is missing', () => {
    const g = mkGraph([[1, 2]]);
    expect(shortestPathsToTargets(g, 99, [1, 2]).size).toBe(0);
  });

  it('serves source-as-target and skips missing targets', () => {
    const g = mkGraph([[1, 2]]);
    const multi = shortestPathsToTargets(g, 1, [1, 2, 99]);
    expect(multi.get(1)).toEqual([1]);
    expect(multi.get(2)).toEqual([1, 2]);
    expect(multi.has(99)).toBe(false);
  });

  it('one traversal serves many targets in a dense mesh', () => {
    // 6×6 grid; route from a corner to every other node.
    const edges: [number, number][] = [];
    const id = (x: number, y: number) => x * 6 + y;
    for (let x = 0; x < 6; x++) {
      for (let y = 0; y < 6; y++) {
        if (x + 1 < 6) edges.push([id(x, y), id(x + 1, y)]);
        if (y + 1 < 6) edges.push([id(x, y), id(x, y + 1)]);
      }
    }
    const g = mkGraph(edges);
    const targets = Array.from({ length: 36 }, (_, i) => i).filter((i) => i !== 0);
    expectEquivalent(g, 0, targets);
  });
});
