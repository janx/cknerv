import { describe, expect, it } from 'vitest';
import type { NeighborGraph } from '../../src/geometry/neighborGraph';
import {
  anchorProximityScore,
  nearestGraphNode,
  rescueOrigin,
  RESCUE_MIN_HOPS,
  rimEntryScore,
  shortestPath,
  shortestPathsToTargets,
  type RescuePositioned,
} from '../../src/geometry/pathRouter';

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

function mkCells(
  entries: [number, [number, number, number]][],
): Map<number, RescuePositioned> {
  return new Map(entries.map(([id, pos]) => [id, { pos_seed: pos }]));
}

/** Every consecutive pair of a rescue path must be a live adjacency edge —
 *  the frame loop extinguishes pulses on anything less. */
function expectRealEdges(g: NeighborGraph, path: number[]) {
  for (let i = 0; i < path.length - 1; i++) {
    expect(g.adjacency.get(path[i])?.has(path[i + 1])).toBe(true);
  }
}

describe('rescueOrigin', () => {
  const byId = (id: number) => id;

  it('returns null when dst is missing from the graph', () => {
    expect(rescueOrigin(mkGraph([[1, 2]]), 99, byId)).toBeNull();
  });

  it('returns null when nothing is reachable from dst', () => {
    const g: NeighborGraph = { adjacency: new Map([[1, new Set<number>()]]), edges: [] };
    expect(rescueOrigin(g, 1, byId)).toBeNull();
  });

  it('returns the tree path origin → … → dst over real edges', () => {
    // 1 — 2 — 3 — 4 — 5, dst = 1; score prefers the deep end.
    const g = mkGraph([[1, 2], [2, 3], [3, 4], [4, 5]]);
    const path = rescueOrigin(g, 1, byId);
    expect(path).toEqual([5, 4, 3, 2, 1]);
    expectRealEdges(g, path!);
  });

  it('respects the hop cap', () => {
    const edges: [number, number][] = [];
    for (let i = 1; i < 30; i++) edges.push([i, i + 1]);
    const g = mkGraph(edges);
    // Cap 5: deepest reachable node from dst=1 is 6.
    const path = rescueOrigin(g, 1, byId, { maxHops: 5 });
    expect(path).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it('prefers nodes at least minHops out even over a higher-scoring near node', () => {
    //   1 — 2 — … — deep   (deep sits exactly RESCUE_MIN_HOPS out)
    //   1 — 9              (9 is 1 hop out, higher raw score)
    // The chain is built FROM the constant rather than to a fixed length:
    // spelling it out pins the test to whatever the fabric's edge scale
    // happened to be when it was written, and RESCUE_MIN_HOPS rides that
    // scale — it buys a world distance, and the router pays in hops.
    const chain: [number, number][] = [];
    for (let i = 1; i <= RESCUE_MIN_HOPS; i += 1) chain.push([i, i + 1]);
    const deep = RESCUE_MIN_HOPS + 1;
    const g = mkGraph([...chain, [1, 9]]);
    const expected = [];
    for (let i = deep; i >= 1; i -= 1) expected.push(i);
    expect(rescueOrigin(g, 1, byId)).toEqual(expected);
  });

  it('falls back to the best near node when nothing reaches minHops', () => {
    const g = mkGraph([[1, 2], [1, 9]]);
    expect(rescueOrigin(g, 1, byId)).toEqual([9, 1]);
  });

  it('a custom minHops of 1 disables the far preference', () => {
    const g = mkGraph([[1, 2], [2, 3], [3, 4], [1, 9]]);
    expect(rescueOrigin(g, 1, byId, { minHops: 1 })).toEqual([9, 1]);
  });

  it('never routes through nodes failing the validity predicate', () => {
    //   1 — 2 — 3 — 4   (short, but 3 is invalid)
    //   1 — 5 — 6 — 4   (valid detour)
    const g = mkGraph([[1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 4]]);
    const score = (id: number) => (id === 4 ? 10 : 0);
    const path = rescueOrigin(g, 1, score, { valid: (id) => id !== 3 });
    expect(path).toEqual([4, 6, 5, 1]);
    expectRealEdges(g, path!);
    // Without the predicate the shorter branch through 3 wins.
    expect(rescueOrigin(g, 1, score)).toEqual([4, 3, 2, 1]);
  });

  it('returns null when only invalid nodes are reachable', () => {
    const g = mkGraph([[1, 2], [2, 3]]);
    expect(rescueOrigin(g, 1, () => 1, { valid: () => false })).toBeNull();
  });

  it('breaks score ties toward the lower id regardless of adjacency insertion order', () => {
    const forward = mkGraph([[1, 2], [2, 3], [1, 4], [4, 5]]);
    const reversed = mkGraph([[4, 5], [1, 4], [2, 3], [1, 2]]);
    const flat = () => 1;
    expect(rescueOrigin(forward, 1, flat)).toEqual([2, 1]);
    expect(rescueOrigin(reversed, 1, flat)).toEqual([2, 1]);
  });
});

describe('rimEntryScore', () => {
  it('prefers rim-ward nodes aligned with the destination outward radial', () => {
    const cells = mkCells([
      [1, [30, 0, 0]],    // dst: outward radial = +x
      [2, [54, 0, 0]],    // rf 0.9, aligned      → 0.9
      [3, [0, 0, 48.6]],  // rf 0.9, perpendicular → 0.45
      [4, [-54, 0, 0]],   // rf 0.9, opposite      → 0.45
      [5, [6, 0, 0]],     // rf 0.1, aligned       → 0.1
    ]);
    const score = rimEntryScore(cells, 1);
    expect(score(2)).toBeCloseTo(0.9, 9);
    expect(score(3)).toBeCloseTo(0.45, 9);
    expect(score(4)).toBeCloseTo(0.45, 9);
    expect(score(5)).toBeCloseTo(0.1, 9);
    expect(score(2)).toBeGreaterThan(score(3));
  });

  it('degrades to plain radial fraction when the destination sits at the centre', () => {
    const cells = mkCells([
      [1, [0, 0, 0]],
      [2, [54, 0, 0]],
      [3, [-27, 0, 0]],
    ]);
    const score = rimEntryScore(cells, 1);
    expect(score(2)).toBeCloseTo(0.9, 9);
    expect(score(3)).toBeCloseTo(0.45, 9);
  });

  it('scores missing cells to negative infinity and centre nodes to zero', () => {
    const cells = mkCells([[1, [30, 0, 0]], [2, [0, 0, 0]]]);
    const score = rimEntryScore(cells, 1);
    expect(score(99)).toBe(Number.NEGATIVE_INFINITY);
    expect(score(2)).toBe(0);
  });
});

describe('anchorProximityScore', () => {
  it('ranks nodes by closeness to the anchor position', () => {
    const cells = mkCells([
      [1, [10, 0, 0]],
      [2, [11, 1, 0]],
      [3, [40, 0, 0]],
    ]);
    const score = anchorProximityScore(cells, [10, 0, 0]);
    expect(score(1)).toBeGreaterThan(score(2));
    expect(score(2)).toBeGreaterThan(score(3));
    expect(score(99)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('nearestGraphNode', () => {
  it('picks the nearest node that is actually in the graph', () => {
    const cells = mkCells([
      [1, [0, 0, 0]],   // nearest overall but NOT in the graph
      [2, [5, 0, 0]],
      [3, [9, 0, 0]],
    ]);
    const g = mkGraph([[2, 3]]);
    expect(nearestGraphNode(cells, g, [1, 0, 0])).toBe(2);
  });

  it('breaks distance ties toward the lower id and returns null on an empty graph', () => {
    const cells = mkCells([
      [7, [2, 0, 0]],
      [4, [-2, 0, 0]],
    ]);
    expect(nearestGraphNode(cells, mkGraph([[4, 7]]), [0, 0, 0])).toBe(4);
    expect(nearestGraphNode(cells, mkGraph([]), [0, 0, 0])).toBeNull();
  });

  it('skips degree-0 nodes — an isolated nearest would dead-end the rescue', () => {
    const cells = mkCells([
      [1, [1, 0, 0]], // nearest, but isolated
      [2, [5, 0, 0]],
      [3, [9, 0, 0]],
    ]);
    const g = mkGraph([[2, 3]]);
    g.adjacency.set(1, new Set());
    expect(nearestGraphNode(cells, g, [0, 0, 0])).toBe(2);
  });
});

describe('rescueOrigin + rimEntryScore (integration)', () => {
  it('routes a rim entry inward along the destination radial', () => {
    // Cells strung centre → rim along +x; dst is the innermost.
    const cells = mkCells([
      [1, [10, 0, 0]],
      [2, [20, 0, 0]],
      [3, [30, 0, 0]],
      [4, [40, 0, 0]],
      [5, [50, 0, 0]],
    ]);
    const g = mkGraph([[1, 2], [2, 3], [3, 4], [4, 5]]);
    const path = rescueOrigin(g, 1, rimEntryScore(cells, 1));
    expect(path).toEqual([5, 4, 3, 2, 1]);
    expectRealEdges(g, path!);
  });
});
