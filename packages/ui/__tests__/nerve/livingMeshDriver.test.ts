import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  emptyNeighborGraph,
  type NeighborEdge,
  type NeighborGraph,
} from '../../src/geometry/neighborGraph';
import { fabricEdgeKey } from '../../src/nerve/fabricOrder';
import {
  staggerBornAt,
  deadEndFor,
  planDisplayMeshDiff,
  planMeshUpdate,
  planSelectionDeltaUpdate,
  selectionStrayEdgeKeys,
} from '../../src/nerve/livingMeshDriver';

function cell(id: number, x: number, z: number): Cell {
  return { id, born_at_ms: 0, death_at_ms: null, birth_block: 1, tag: null,
    pos_seed: [x, 0, z], out_point: { tx_hash: '0x', index: 0 }, capacity: 0,
    data_hex: '0x', data_bytes: 0, content_hash: '0x' + '00'.repeat(32),
    lock_shape_seed: [1, 2], type_shape_seed: null, data_shape_seed: [3, 4] };
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
  it('admits every birth in a large batch, however big (no deferral cliff)', () => {
    // A batch this size over a full stage once tripped the comparison ceiling
    // and skipped eager admission entirely, leaving the newborns unroutable
    // (endpoint-missing) until the worker landed. One bucketed grid admits the
    // whole batch, so each newborn is in the graph and routable at once.
    const cells = new Map<number, Cell>();
    for (let id = 1; id <= 60; id += 1) {
      cells.set(id, cell(id, (id % 6) * 3, Math.floor(id / 6) * 3));
    }
    const born = Array.from({ length: 30 }, (_, i) => i + 1);
    const g = emptyNeighborGraph();
    const u = planMeshUpdate(
      { born, died: [], evicted: [] }, g, cells, 10, { k: 4 }, 60,
    );
    for (const id of born) expect(g.adjacency.get(id)!.size).toBeGreaterThan(0);
    expect(u.addedEdges.length).toBeGreaterThan(0);
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

describe('planDisplayMeshDiff (display journal → lifecycle diff)', () => {
  function stagedGraph(heldIds: readonly number[]): NeighborGraph {
    const graph = emptyNeighborGraph();
    for (const id of heldIds) graph.adjacency.set(id, new Set());
    return graph;
  }
  function stage(entries: readonly Cell[]): (id: number) => Cell | undefined {
    const byId = new Map(entries.map((c) => [c.id, c]));
    return (id) => byId.get(id);
  }
  const dead = (id: number, at = 5): Cell => ({ ...cell(id, 0, 0), death_at_ms: at });

  it('admits a live entrant the graph does not hold yet', () => {
    const diff = planDisplayMeshDiff(
      { entered: [7], exited: [], updated: [] },
      stagedGraph([1]),
      stage([cell(1, 0, 0), cell(7, 1, 0)]),
    );
    expect(diff).toEqual({ born: [7], died: [], evicted: [] });
  });

  it('does not re-admit a member the graph already holds', () => {
    const diff = planDisplayMeshDiff(
      { entered: [1], exited: [], updated: [1] },
      stagedGraph([1]),
      stage([cell(1, 0, 0)]),
    );
    expect(diff).toEqual({ born: [], died: [], evicted: [] });
  });

  it('retracts a staged member that died (death arrives as a canonical update)', () => {
    const diff = planDisplayMeshDiff(
      { entered: [], exited: [], updated: [1] },
      stagedGraph([1]),
      stage([dead(1)]),
    );
    expect(diff).toEqual({ born: [], died: [1], evicted: [] });
  });

  it('evicts a member that left the stage alive — no retract', () => {
    const diff = planDisplayMeshDiff(
      { entered: [], exited: [1], updated: [] },
      stagedGraph([1]),
      stage([cell(1, 0, 0)]),
    );
    expect(diff).toEqual({ born: [], died: [], evicted: [1] });
  });

  // The curated queues drop the dead, so a member killed this batch can leave
  // membership in the SAME batch. Which channel reported it must not decide
  // whether its fibres retract or simply go.
  it('retracts a member dropped BECAUSE it died, not just gc it', () => {
    const diff = planDisplayMeshDiff(
      { entered: [], exited: [1], updated: [] },
      stagedGraph([1]),
      stage([dead(1)]),
    );
    expect(diff).toEqual({ born: [], died: [1], evicted: [] });
  });

  it('lets admission outrank exit for an id listed in both', () => {
    const diff = planDisplayMeshDiff(
      { entered: [1], exited: [1], updated: [] },
      stagedGraph([1]),
      stage([cell(1, 0, 0)]),
    );
    expect(diff).toEqual({ born: [], died: [], evicted: [] });
  });

  it('ignores ids the graph never held and the stage cannot resolve', () => {
    const diff = planDisplayMeshDiff(
      { entered: [9], exited: [8], updated: [7] },
      stagedGraph([1]),
      stage([cell(1, 0, 0)]),
    );
    expect(diff).toEqual({ born: [], died: [], evicted: [] });
  });

  it('feeds planMeshUpdate a removal batch that retracts the right fibre', () => {
    const graph = emptyNeighborGraph();
    graph.adjacency.set(1, new Set([5]));
    graph.adjacency.set(5, new Set([1]));
    graph.edges.push({ from: 1, to: 5, d: 2 });
    const diff = planDisplayMeshDiff(
      { entered: [], exited: [], updated: [1] },
      graph,
      stage([dead(1), cell(5, 2, 0)]),
    );
    const update = planMeshUpdate(diff, graph, new Map(), 10, { k: 4 }, 60);
    expect(update.deathKeys).toEqual(['1|5']);
    expect(update.deathEndByKey.get('1|5')).toBe('from');
    expect(update.evictKeys).toEqual([]);
    expect(graph.adjacency.has(1)).toBe(false);
  });
});

// The worker's selection delta and the periodic prune are the ONLY places the
// geometry layer's edge vocabulary (`${from}:${to}`) reaches the fabric, whose
// map is keyed `lo|hi`. The fabric skips an unknown key in silence, so a
// mistranslation is invisible at the seam and fatal downstream: removals never
// decay, and a prune comparing the two vocabularies finds every live edge
// stray. These pin the translation itself.
describe('worker selection delta → fabric instructions', () => {
  /** What the geometry/worker side writes for the same edge. */
  const graphKey = (from: number, to: number): string => `${from}:${to}`;

  it('names removals in the vocabulary the fabric edge map is keyed by', () => {
    const update = planSelectionDeltaUpdate(
      { added: [], removed: [{ from: 4, to: 9, d: 1 }, { from: 2, to: 3, d: 1 }] },
      12,
    );
    expect(update.killKeys).toEqual([fabricEdgeKey(4, 9), fabricEdgeKey(2, 3)]);
    for (const key of update.killKeys) {
      expect(key).not.toBe(graphKey(4, 9));
      expect(key).not.toBe(graphKey(2, 3));
    }
  });

  it('canonicalises a removal the worker reports high-id first', () => {
    const update = planSelectionDeltaUpdate(
      { added: [], removed: [{ from: 9, to: 4, d: 1 }] },
      12,
    );
    expect(update.killKeys).toEqual([fabricEdgeKey(4, 9)]);
  });

  it('roots every added edge with birth hints under the same key', () => {
    const update = planSelectionDeltaUpdate(
      { added: [{ from: 7, to: 3, d: 1 }], removed: [] },
      12.5,
    );
    expect([...update.bornAtByKey.keys()]).toEqual([fabricEdgeKey(3, 7)]);
    expect(update.bornAtByKey.get(fabricEdgeKey(3, 7))).toBeCloseTo(12.5, 6);
    expect(update.dirByKey.get(fabricEdgeKey(3, 7))).toBe(1);
  });

  it('finds no stray when every live edge is still in the selection', () => {
    const selection = [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
    ];
    const live = [fabricEdgeKey(1, 2), fabricEdgeKey(2, 3)];
    expect(selectionStrayEdgeKeys(selection, live)).toEqual([]);
  });

  it('prunes exactly the live edges the selection dropped', () => {
    const selection = [{ from: 1, to: 2 }];
    const live = [fabricEdgeKey(1, 2), fabricEdgeKey(2, 3), fabricEdgeKey(5, 9)];
    expect(selectionStrayEdgeKeys(selection, live)).toEqual([
      fabricEdgeKey(2, 3),
      fabricEdgeKey(5, 9),
    ]);
  });

  it('matches a selection edge whatever order the worker reports it in', () => {
    expect(
      selectionStrayEdgeKeys([{ from: 9, to: 5 }], [fabricEdgeKey(5, 9)]),
    ).toEqual([]);
  });
});
