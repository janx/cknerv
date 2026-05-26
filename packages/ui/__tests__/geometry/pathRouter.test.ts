import { describe, expect, it } from 'vitest';
import type { NeighborGraph } from '../../src/geometry/neighborGraph';
import { shortestPath } from '../../src/geometry/pathRouter';

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
