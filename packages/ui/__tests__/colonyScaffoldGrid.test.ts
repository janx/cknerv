// A scaffold MISS is one synchronous 33–100 ms task inside App's render
// (L5-1), and what it spends the time on is a k-nearest pass that allocated
// V_s − 1 objects and ran a full comparator sort PER NODE: 68,906 objects and
// ~554,000 comparisons at V_s = 263. The pass is a uniform XZ bucket grid now.
//
// Two things have to hold, and this file is both: the grid returns exactly what
// the sort returned (distance ascending, index ascending on a tie — V8's sort
// is stable, so that was the old order too), and the topology built over it is
// the topology the oracle recorded from the code before the grid landed.
import { describe, expect, it } from 'vitest';
import oracle from './fixtures/colonyScaffold.json';
import { scaffoldCases, SCAFFOLD_SEEDS } from './helpers/colonyScaffoldCases';
import {
  buildColonyScaffoldGrid,
  colonyNearest,
  COLONY_KNN,
  COLONY_RADIUS,
  COLONY_Y,
  dist2,
  inferredTopology,
} from '../src/derives/networkTopology.derive';
import type { NetworkNode, Vec3 } from '../src/types';

function fnv(parts: string[]): string {
  let low = 0x811c9dc5;
  let high = 0x01000193;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) {
      const code = part.charCodeAt(i);
      low = Math.imul(low ^ code, 0x01000193) >>> 0;
      high = Math.imul(high ^ code, 0x85ebca6b) >>> 0;
    }
  }
  return `${low.toString(16).padStart(8, '0')}${high.toString(16).padStart(8, '0')}`;
}

/** The pass as it was written: every other node into an array, one comparator
 *  sort, the first k. V8's sort is stable, so equal distances came back in
 *  ascending index order. */
function sortedNearest(
  nodes: readonly NetworkNode[], localI: number, k: number,
): number[] {
  const ds: { j: number; d: number }[] = [];
  for (let j = 0; j < nodes.length; j++) {
    if (j !== localI) ds.push({ j, d: dist2(nodes[localI].pos, nodes[j].pos) });
  }
  ds.sort((a, b) => a.d - b.d);
  return ds.slice(0, k).map((o) => o.j);
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

function field(rand: () => number, n: number, spread: number): NetworkNode[] {
  return Array.from({ length: n }, (_, i): NetworkNode => {
    const pos: Vec3 = [
      (rand() * 2 - 1) * spread,
      COLONY_Y + (rand() * 2 - 1) * 3,
      (rand() * 2 - 1) * spread,
    ];
    return { id: `n:${i}`, kind: 'inferred', pos };
  });
}

describe('the colony scaffold’s nearest-neighbour pass', () => {
  it('answers what a full sort of every other node answers', () => {
    for (const [label, n, spread] of [
      ['the colony at its live size', 263, COLONY_RADIUS],
      ['a sparse cloud', 40, COLONY_RADIUS],
      ['a crowd inside one bucket', 30, 3],
      ['two nodes', 2, COLONY_RADIUS],
      ['one node', 1, COLONY_RADIUS],
    ] as const) {
      const rand = mulberry32(0x5caf01d + n);
      const nodes = field(rand, n, spread);
      const grid = buildColonyScaffoldGrid(nodes);
      const out = new Int32Array(COLONY_KNN);
      for (let i = 0; i < nodes.length; i++) {
        const count = colonyNearest(grid, nodes, i, COLONY_KNN, out);
        expect([...out.subarray(0, count)], `${label} @ ${i}`)
          .toEqual(sortedNearest(nodes, i, COLONY_KNN));
      }
    }
  });

  it('keeps the sort’s tie order, which is the lower index', () => {
    // Three nodes at the same distance from the query, in a ring the grid
    // reaches in bucket order rather than index order. The answer is the one
    // a stable sort gave: index ascending.
    const nodes: NetworkNode[] = [
      { id: 'q', kind: 'inferred', pos: [0, COLONY_Y, 0] },
      { id: 'a', kind: 'inferred', pos: [0, COLONY_Y, 20] },
      { id: 'b', kind: 'inferred', pos: [20, COLONY_Y, 0] },
      { id: 'c', kind: 'inferred', pos: [0, COLONY_Y, -20] },
      { id: 'd', kind: 'inferred', pos: [-20, COLONY_Y, 0] },
      { id: 'far', kind: 'inferred', pos: [60, COLONY_Y, 60] },
    ];
    const grid = buildColonyScaffoldGrid(nodes);
    const out = new Int32Array(4);
    expect(colonyNearest(grid, nodes, 0, 4, out)).toBe(4);
    expect([...out]).toEqual([1, 2, 3, 4]);
    expect([...out]).toEqual(sortedNearest(nodes, 0, 4));
  });

  it('reaches past an empty ring for a node the cloud left alone', () => {
    // An outlier whose four nearest are many buckets away: the walk has to
    // keep widening until the bound it has searched covers its own fourth best.
    const rand = mulberry32(0xa11a5);
    const nodes = field(rand, 60, 20);
    nodes.push({ id: 'outlier', kind: 'inferred', pos: [300, COLONY_Y, -240] });
    const grid = buildColonyScaffoldGrid(nodes);
    const out = new Int32Array(COLONY_KNN);
    const i = nodes.length - 1;
    const count = colonyNearest(grid, nodes, i, COLONY_KNN, out);
    expect([...out.subarray(0, count)]).toEqual(sortedNearest(nodes, i, COLONY_KNN));
  });
});

describe('the colony topology over fifty seeds and three rosters', () => {
  it('is node for node and edge for edge what the sort built', () => {
    const rows = scaffoldCases().map((c) => ({
      case: c.name,
      seeds: SCAFFOLD_SEEDS.map((seed) => {
        const t = inferredTopology(
          c.peers, seed, 'ckb:local', undefined, c.roster, null, c.producers,
        );
        return {
          seed,
          nodes: t.nodes.length,
          edges: t.edges.length,
          nodeDigest: fnv(t.nodes.map((n) =>
            `${n.id}|${n.kind}|${Number(n.pos[0].toPrecision(12))},`
            + `${Number(n.pos[1].toPrecision(12))},${Number(n.pos[2].toPrecision(12))};`)),
          edgeDigest: fnv(t.edges.map((e) =>
            `${e.a}|${e.b}|${e.kind}|${Number(e.weight.toPrecision(12))};`)),
        };
      }),
    }));
    expect(rows).toEqual(oracle.cases);
  });
});
