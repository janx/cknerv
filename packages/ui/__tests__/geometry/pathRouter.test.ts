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

// ── typed-array engine vs the Set/Map reference ──────────────────────
//
// The searches above run on an epoch-stamped typed-array scratch with a
// per-node neighbour cache. Results must be byte-identical to the Set/Map
// walk they replaced — same paths, same first-discovery parents, same
// tie-breaks — so the reference implementations are kept here verbatim and
// the engine is checked against them over seeded graphs, hundreds of random
// requests, both id families, and graphs mutated between searches.

import type { Cell } from '@cknerv/types';
import { buildNeighborGraph } from '../../src/geometry/neighborGraph';
import {
  createRouteScratch,
  DEFAULT_MAX_HOPS,
  RESCUE_MAX_HOPS,
  type RouteScratch,
} from '../../src/geometry/pathRouter';
import { addCell, removeCells } from '../../src/nerve/incrementalGraph';

function referenceShortestPathsToTargets(
  graph: NeighborGraph,
  source: number,
  targets: readonly number[],
  maxHops: number = DEFAULT_MAX_HOPS,
): Map<number, number[]> {
  const found = new Map<number, number[]>();
  const remaining = new Set<number>();
  for (const target of targets) {
    if (target === source) {
      found.set(target, [source]);
      continue;
    }
    if (graph.adjacency.has(target)) remaining.add(target);
  }
  if (!graph.adjacency.has(source) || remaining.size === 0) return found;
  const visited = new Set<number>([source]);
  const parent = new Map<number, number>();
  let frontier: number[] = [source];
  for (let depth = 0; depth < maxHops; depth++) {
    const next: number[] = [];
    for (const cur of frontier) {
      const neighbours = graph.adjacency.get(cur);
      if (!neighbours) continue;
      for (const nb of neighbours) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        parent.set(nb, cur);
        if (remaining.delete(nb)) {
          const path = [nb];
          let walk: number | undefined = nb;
          while (walk !== undefined && walk !== source) {
            walk = parent.get(walk);
            if (walk !== undefined) path.push(walk);
          }
          path.reverse();
          found.set(nb, path);
          if (remaining.size === 0) return found;
        }
        next.push(nb);
      }
    }
    if (next.length === 0) return found;
    frontier = next;
  }
  return found;
}

function referenceRescueOrigin(
  graph: NeighborGraph,
  dst: number,
  score: (id: number) => number,
  options: { maxHops?: number; minHops?: number; valid?: (id: number) => boolean } = {},
): number[] | null {
  const maxHops = options.maxHops ?? RESCUE_MAX_HOPS;
  const minHops = options.minHops ?? RESCUE_MIN_HOPS;
  const valid = options.valid;
  if (!graph.adjacency.has(dst)) return null;
  const parent = new Map<number, number>();
  const visited = new Set<number>([dst]);
  let frontier: number[] = [dst];
  let bestAny = -1;
  let bestAnyScore = Number.NEGATIVE_INFINITY;
  let bestFar = -1;
  let bestFarScore = Number.NEGATIVE_INFINITY;
  for (let depth = 1; depth <= maxHops; depth++) {
    const next: number[] = [];
    for (const cur of frontier) {
      const neighbours = graph.adjacency.get(cur);
      if (!neighbours) continue;
      for (const nb of neighbours) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        if (valid && !valid(nb)) continue;
        parent.set(nb, cur);
        next.push(nb);
        const s = score(nb);
        if (s > bestAnyScore || (s === bestAnyScore && nb < bestAny)) {
          bestAny = nb;
          bestAnyScore = s;
        }
        if (
          depth >= minHops
          && (s > bestFarScore || (s === bestFarScore && nb < bestFar))
        ) {
          bestFar = nb;
          bestFarScore = s;
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  const origin = bestFar !== -1 ? bestFar : bestAny;
  if (origin === -1) return null;
  const path = [origin];
  let walk: number | undefined = origin;
  while (walk !== undefined && walk !== dst) {
    walk = parent.get(walk);
    if (walk !== undefined) path.push(walk);
  }
  return path;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededCell(id: number, pos: [number, number, number]): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: pos,
    out_point: { tx_hash: '0x', index: 0 },
    capacity: 0,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: '0x' + '00'.repeat(32),
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
  };
}

/** A staged field through the real builder: k-NN edges, lifelines and
 *  component stitches — the graph shape the engine actually walks. */
function seededField(
  rand: () => number,
  n: number,
  idOf: (i: number) => number,
): { cells: Map<number, Cell>; graph: NeighborGraph; ids: number[] } {
  const cells = new Map<number, Cell>();
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const id = idOf(i);
    let x = 0;
    let z = 0;
    do {
      x = (rand() * 2 - 1) * 60;
      z = (rand() * 2 - 1) * 54;
    } while ((x / 60) ** 2 + (z / 54) ** 2 > 1);
    cells.set(id, seededCell(id, [x, (rand() * 2 - 1) * 3, z]));
    ids.push(id);
  }
  return { cells, graph: buildNeighborGraph(cells, { k: 4 }), ids };
}

function expectSameRoutes(
  a: Map<number, number[]>,
  b: Map<number, number[]>,
): void {
  expect([...b.entries()]).toEqual([...a.entries()]);
}

const ID_FAMILIES: ReadonlyArray<[string, (i: number) => number]> = [
  ['sequential ids', (i) => 1 + i * 3],
  ['2^52-family ids', (i) => 2 ** 52 + i * 7],
  ['mixed families', (i) => (i % 4 === 0 ? 1 + i * 3 : 2 ** 52 + i * 7)],
];

describe('typed-array search engine — byte-identical to the Set/Map reference', () => {
  it.each(ID_FAMILIES)(
    'shortestPathsToTargets over a seeded builder graph, %s',
    (_label, idOf) => {
      const rand = mulberry32(0x5eed + idOf(1));
      const { graph, ids } = seededField(rand, 1500, idOf);
      const scratch = createRouteScratch(16); // grows many times over
      const pick = () => ids[Math.floor(rand() * ids.length)];
      const missing = (k: number) => 999_999_991 + k;
      for (let q = 0; q < 400; q++) {
        const source = rand() < 0.03 ? missing(q) : pick();
        const targets: number[] = [];
        const count = 1 + Math.floor(rand() * 3);
        for (let t = 0; t < count; t++) {
          const roll = rand();
          targets.push(
            roll < 0.05 ? missing(t)
              : roll < 0.08 ? source
                : pick(),
          );
        }
        if (rand() < 0.1) targets.push(targets[0]); // duplicates
        const maxHops = rand() < 0.7
          ? DEFAULT_MAX_HOPS
          : [1, 2, 3, 5, 8, 13][Math.floor(rand() * 6)];
        expectSameRoutes(
          referenceShortestPathsToTargets(graph, source, targets, maxHops),
          shortestPathsToTargets(graph, source, targets, maxHops, scratch),
        );
        // The single-target search is the same engine asked for one target.
        expect(shortestPath(graph, source, targets[0], maxHops, scratch))
          .toEqual(
            referenceShortestPathsToTargets(graph, source, [targets[0]], maxHops)
              .get(targets[0]) ?? null,
          );
      }
    },
  );

  it.each(ID_FAMILIES)('rescueOrigin with validity and score ties, %s', (_label, idOf) => {
    const rand = mulberry32(0x7e5c + idOf(2));
    const { cells, graph, ids } = seededField(rand, 900, idOf);
    const scratch = createRouteScratch();
    // Every 9th node is invalid (left the cells map), and scores are coarse
    // so exact ties are common: the lower-id tie-break has to agree.
    const valid = (id: number) => idOf(Math.floor((id - idOf(0)) / (idOf(1) - idOf(0)))) === id
      && (Math.floor((id - idOf(0)) / (idOf(1) - idOf(0))) % 9) !== 0;
    const score = (id: number) => {
      const cell = cells.get(id);
      return cell ? Math.round(Math.hypot(cell.pos_seed[0], cell.pos_seed[2]) / 10) : Number.NEGATIVE_INFINITY;
    };
    for (let q = 0; q < 120; q++) {
      const dst = q % 17 === 0 ? 999_999_991 : ids[Math.floor(rand() * ids.length)];
      const options = {
        maxHops: rand() < 0.5 ? RESCUE_MAX_HOPS : 4 + Math.floor(rand() * 20),
        minHops: rand() < 0.5 ? RESCUE_MIN_HOPS : Math.floor(rand() * 4),
        ...(rand() < 0.6 ? { valid } : {}),
      };
      expect(rescueOrigin(graph, dst, score, { ...options, scratch }))
        .toEqual(referenceRescueOrigin(graph, dst, score, options));
    }
  });

  it('follows copy-on-write graph mutations between searches on one scratch', () => {
    // The neighbour cache keys on the adjacency Set instance, and the eager
    // living-mesh mutators replace instances rather than editing them. Route
    // before and after several rounds of births and deaths, same scratch:
    // every answer must be the reference's answer on the graph AS IT IS.
    const rand = mulberry32(0xc0de);
    const { cells, graph, ids } = seededField(rand, 800, (i) => 2 ** 52 + i * 5);
    const scratch = createRouteScratch();
    let live = ids.slice();
    let nextId = 2 ** 52 + 800 * 5;
    const check = (count: number) => {
      for (let q = 0; q < count; q++) {
        const source = live[Math.floor(rand() * live.length)];
        const targets = [
          live[Math.floor(rand() * live.length)],
          live[Math.floor(rand() * live.length)],
        ];
        expectSameRoutes(
          referenceShortestPathsToTargets(graph, source, targets),
          shortestPathsToTargets(graph, source, targets, DEFAULT_MAX_HOPS, scratch),
        );
        const dst = live[Math.floor(rand() * live.length)];
        const score = (id: number) => -(cells.get(id)?.pos_seed[0] ?? Infinity);
        expect(rescueOrigin(graph, dst, score, { valid: (id) => cells.has(id), scratch }))
          .toEqual(referenceRescueOrigin(graph, dst, score, { valid: (id) => cells.has(id) }));
      }
    };
    check(60);
    for (let round = 0; round < 5; round++) {
      // Deaths: remove 20 random live nodes (edges retract in place).
      const dying: number[] = [];
      for (let i = 0; i < 20; i++) {
        const victim = live[Math.floor(rand() * live.length)];
        if (!dying.includes(victim)) dying.push(victim);
      }
      removeCells(graph, dying);
      for (const id of dying) cells.delete(id);
      live = live.filter((id) => !dying.includes(id));
      // Births: admit 20 newborns beside random survivors.
      for (let i = 0; i < 20; i++) {
        const near = cells.get(live[Math.floor(rand() * live.length)])!;
        const id = nextId;
        nextId += 5;
        cells.set(id, seededCell(id, [
          near.pos_seed[0] + (rand() - 0.5) * 2,
          near.pos_seed[1],
          near.pos_seed[2] + (rand() - 0.5) * 2,
        ]));
        addCell(graph, id, cells, { k: 4 });
        live.push(id);
      }
      check(60);
    }
  });

  it('one scratch serves two unrelated graphs that reuse the same ids', () => {
    const scratch = createRouteScratch();
    const chain = mkGraph([[1, 2], [2, 3], [3, 4], [4, 5]]);
    const star = mkGraph([[1, 5], [5, 2], [5, 3], [5, 4]]);
    expect(shortestPath(chain, 1, 5, DEFAULT_MAX_HOPS, scratch)).toEqual([1, 2, 3, 4, 5]);
    expect(shortestPath(star, 1, 5, DEFAULT_MAX_HOPS, scratch)).toEqual([1, 5]);
    expect(shortestPath(chain, 1, 5, DEFAULT_MAX_HOPS, scratch)).toEqual([1, 2, 3, 4, 5]);
    expect(shortestPath(star, 1, 4, DEFAULT_MAX_HOPS, scratch)).toEqual([1, 5, 4]);
  });

  it('compacts the slot registry once it dwarfs the live graph, without changing answers', () => {
    // A 9,500-leaf star is walked whole by one search (slots are assigned
    // on sight), so the registry fills; a tiny graph afterwards trips the
    // compaction (registry > 2 × live + slack) and must still answer right,
    // and so must the star once its caches are rebuilt from scratch.
    const edges: [number, number][] = [];
    for (let i = 2; i <= 9501; i++) edges.push([1, i]);
    const star = mkGraph(edges);
    const scratch = createRouteScratch();
    expect(shortestPath(star, 2, 9501, DEFAULT_MAX_HOPS, scratch)).toEqual([2, 1, 9501]);
    expect(scratch.slotCount).toBe(9501);
    const small = mkGraph([[7, 8], [8, 9]]);
    expect(shortestPath(small, 7, 9, DEFAULT_MAX_HOPS, scratch)).toEqual([7, 8, 9]);
    expect(scratch.slotCount).toBe(3);
    expect(shortestPath(star, 40, 41, DEFAULT_MAX_HOPS, scratch)).toEqual([40, 1, 41]);
    expect(shortestPathsToTargets(star, 1, [3, 9501, 2], DEFAULT_MAX_HOPS, scratch))
      .toEqual(new Map([[2, [1, 2]], [3, [1, 3]], [9501, [1, 9501]]]));
  });

  it('touches no scratch on the cheap early returns', () => {
    const g = mkGraph([[1, 2]]);
    const scratch: RouteScratch = createRouteScratch();
    expect(shortestPathsToTargets(g, 99, [1, 2], DEFAULT_MAX_HOPS, scratch).size).toBe(0);
    expect(shortestPathsToTargets(g, 1, [99], DEFAULT_MAX_HOPS, scratch).size).toBe(0);
    expect(shortestPathsToTargets(g, 1, [1], DEFAULT_MAX_HOPS, scratch).get(1)).toEqual([1]);
    expect(rescueOrigin(g, 99, () => 1, { scratch })).toBeNull();
    expect(scratch.epoch).toBe(0);
    expect(scratch.slotCount).toBe(0);
  });
});
