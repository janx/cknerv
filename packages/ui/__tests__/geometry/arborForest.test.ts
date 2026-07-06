import { describe, it, expect } from 'vitest';
import { buildArborForest } from '../../src/geometry/arborForest';

/** Minimal cell stub — the arbor only needs positions. */
function cell(x: number, y = 0, z = 0) {
  return { pos_seed: [x, y, z] as [number, number, number] };
}

/** Build a symmetric adjacency from an undirected edge list. */
function adj(edges: [number, number][]) {
  const m = new Map<number, Set<number>>();
  const add = (a: number, b: number) => {
    let s = m.get(a);
    if (!s) { s = new Set(); m.set(a, s); }
    s.add(b);
  };
  for (const [a, b] of edges) { add(a, b); add(b, a); }
  return m;
}

/** Canonical edge key, matching neighborGraph's `${lo}:${hi}`. */
const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

describe('buildArborForest', () => {
  it('returns an empty map for an empty graph', () => {
    const w = buildArborForest(new Map(), new Map());
    expect(w.size).toBe(0);
  });

  it('weights a single-seed path by subtree size — trunk near the root, twig at the tip', () => {
    // 0—1—2—3—4 on a line. One seed → root at the smallest id (0).
    const cells = new Map([0, 1, 2, 3, 4].map((i) => [i, cell(i)] as const));
    const adjacency = adj([[0, 1], [1, 2], [2, 3], [3, 4]]);

    const w = buildArborForest(cells, adjacency, { seedCount: 1 });

    // Every tree edge present, none missing, nothing extra.
    expect(w.size).toBe(4);
    for (const k of ['0:1', '1:2', '2:3', '3:4']) expect(w.has(k)).toBe(true);

    // Trunkness strictly decreases outward from the root.
    expect(w.get('0:1')!).toBeGreaterThan(w.get('1:2')!);
    expect(w.get('1:2')!).toBeGreaterThan(w.get('2:3')!);
    expect(w.get('2:3')!).toBeGreaterThan(w.get('3:4')!);

    // Normalized: the biggest-subtree edge is 1, all within (0,1].
    expect(w.get('0:1')!).toBeCloseTo(1, 5);
    for (const v of w.values()) { expect(v).toBeGreaterThan(0); expect(v).toBeLessThanOrEqual(1); }
  });

  it('produces a spanning FOREST with one fewer edge per extra seed', () => {
    // Same path, two seeds → two roots → N-2 = 3 tree edges.
    const cells = new Map([0, 1, 2, 3, 4].map((i) => [i, cell(i)] as const));
    const adjacency = adj([[0, 1], [1, 2], [2, 3], [3, 4]]);

    const w = buildArborForest(cells, adjacency, { seedCount: 2 });
    expect(w.size).toBe(3);
  });

  it('only ever weights edges that exist in the graph', () => {
    const cells = new Map([0, 1, 2, 3, 4].map((i) => [i, cell(i * 3)] as const));
    const adjacency = adj([[0, 1], [1, 2], [2, 3], [3, 4], [0, 2]]);
    const graphKeys = new Set(['0:1', '1:2', '2:3', '3:4', '0:2']);

    const w = buildArborForest(cells, adjacency, { seedCount: 1 });
    for (const k of w.keys()) expect(graphKeys.has(k)).toBe(true);
  });

  it('is deterministic — identical inputs give identical output', () => {
    const mk = () => new Map([0, 1, 2, 3, 4, 5].map((i) => [i, cell(i, (i * 7) % 5)] as const));
    const edges: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [1, 4]];
    const a = buildArborForest(mk(), adj(edges), { seedCount: 2 });
    const b = buildArborForest(mk(), adj(edges), { seedCount: 2 });
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });
});
