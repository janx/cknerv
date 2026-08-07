import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  emptyNeighborGraph,
  type NeighborEdge,
  type NeighborGraph,
} from '../../src/geometry/neighborGraph';
import { fabricEdgeKey } from '../../src/nerve/fabricOrder';
import {
  MAX_INCREMENTAL_BIRTH_COMPARISONS,
  staggerBornAt,
  deadEndFor,
  planMeshUpdate,
  shouldBulkRebuildRoutingGraph,
} from '../../src/nerve/livingMeshDriver';

function cell(id: number, x: number, z: number): Cell {
  return { id, born_at_ms: 0, death_at_ms: null, birth_block: 1, tag: null,
    pos_seed: [x, 0, z], out_point: { tx_hash: '0x', index: 0 }, capacity: 0,
    data_hex: '0x', content_hash: '0x' + '00'.repeat(32) };
}

describe('livingMeshDriver helpers', () => {
  it('staggers bornAt by arrival index (ripple)', () => {
    expect(staggerBornAt(10, 0, 4, 60)).toBeCloseTo(10, 6);
    expect(staggerBornAt(10, 2, 4, 60)).toBeCloseTo(10 + 0.12, 6); // 2*60ms
  });
  it('maps the dead cell to the from/to end of a canonical key', () => {
    expect(deadEndFor('3|7', 3)).toBe('from');
    expect(deadEndFor('3|7', 7)).toBe('to');
  });
  it('switches large birth batches to one routing-graph rebuild', () => {
    expect(shouldBulkRebuildRoutingGraph(1, 1_000_000)).toBe(false);
    expect(shouldBulkRebuildRoutingGraph(12, 20_000)).toBe(false);
    expect(shouldBulkRebuildRoutingGraph(13, 20_000)).toBe(true);
    expect(MAX_INCREMENTAL_BIRTH_COMPARISONS).toBe(250_000);
  });
});

describe('planMeshUpdate (orchestration)', () => {
  it('births add staggered edges with dir; deaths produce kill keys with deadEnd', () => {
    const cells = new Map<number, Cell>([
      [1, cell(1, 0, 0)], [5, cell(5, 2, 0)], [9, cell(9, 2.2, 0)],
    ]);
    const g = emptyNeighborGraph();
    g.adjacency.set(1, new Set([5])); g.adjacency.set(5, new Set([1]));
    g.edges.push({ from: 1, to: 5, d: 2 });
    const diff = { born: [9], died: [1], evicted: [] };
    const u = planMeshUpdate(diff, g, cells, 10, { k: 1 }, 60);
    // 9's nearest is 5 -> edge 5|9; 9 is the hi id -> growDir 1; born index 0 -> bornAt == now
    expect(u.addedEdges.map((e) => fabricEdgeKey(e.from, e.to))).toEqual(['5|9']);
    expect(u.bornAtByKey.get('5|9')).toBeCloseTo(10, 6);
    expect(u.dirByKey.get('5|9')).toBe(1);
    // death of 1 -> its edge 1|5 killed; 1 is the lo id -> deadEnd 'from'
    expect(u.deathKeys).toEqual(['1|5']);
    expect(u.deathEndByKey.get('1|5')).toBe('from');
    expect(u.evictKeys).toEqual([]);
    // graph was mutated: 1 gone, 9 present and linked to 5
    expect(g.adjacency.has(1)).toBe(false);
    expect(g.adjacency.get(9)!.has(5)).toBe(true);
  });

  it('evictions produce gc kill keys (no deadEnd)', () => {
    const cells = new Map<number, Cell>([[1, cell(1, 0, 0)], [5, cell(5, 2, 0)]]);
    const g = emptyNeighborGraph();
    g.adjacency.set(1, new Set([5])); g.adjacency.set(5, new Set([1]));
    g.edges.push({ from: 1, to: 5, d: 2 });
    const u = planMeshUpdate({ born: [], died: [], evicted: [1] }, g, cells, 10, { k: 4 }, 60);
    expect(u.evictKeys).toEqual(['1|5']);
    expect(u.deathKeys).toEqual([]);
  });

  it('filters dense edge storage once for a mixed lifecycle batch', () => {
    const adjacency = new Map<number, Set<number>>([
      [1, new Set([2, 4])],
      [2, new Set([1, 3])],
      [3, new Set([2, 4])],
      [4, new Set([1, 3, 5])],
      [5, new Set([4])],
    ]);
    let edges: NeighborEdge[] = [
      { from: 1, to: 2, d: 1 },
      { from: 2, to: 3, d: 1 },
      { from: 3, to: 4, d: 1 },
      { from: 1, to: 4, d: 1 },
      { from: 4, to: 5, d: 1 },
    ];
    let edgeArrayReplacements = 0;
    const graph = { adjacency } as NeighborGraph;
    Object.defineProperty(graph, 'edges', {
      configurable: true,
      enumerable: true,
      get: () => edges,
      set: (next: NeighborEdge[]) => {
        edgeArrayReplacements += 1;
        edges = next;
      },
    });
    const cells = new Map<number, Cell>([
      [1, cell(1, 0, 0)],
      [2, cell(2, 1, 0)],
      [3, cell(3, 2, 0)],
      [4, cell(4, 3, 0)],
      [5, cell(5, 4, 0)],
    ]);

    const update = planMeshUpdate(
      { born: [], died: [2, 3], evicted: [4] },
      graph,
      cells,
      10,
      { k: 4 },
      60,
    );

    expect(edgeArrayReplacements).toBe(1);
    expect(update.deathKeys).toEqual(['1|2', '2|3', '3|4']);
    expect(update.deathEndByKey).toEqual(new Map([
      ['1|2', 'to'],
      ['2|3', 'from'],
      ['3|4', 'from'],
    ]));
    expect(update.evictKeys).toEqual(['1|4', '4|5']);
    expect(edges).toEqual([]);
  });
});
