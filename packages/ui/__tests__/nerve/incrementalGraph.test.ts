import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  emptyLivingNeighborGraph,
  emptyNeighborGraph,
} from '../../src/geometry/neighborGraph';
import {
  addCell,
  removeCell,
  removeCells,
} from '../../src/nerve/incrementalGraph';

function cell(id: number, x: number, z: number, death: number | null = null): Cell {
  return { id, born_at_ms: 0, death_at_ms: death, birth_block: 1, tag: null,
    pos_seed: [x, 0, z], out_point: { tx_hash: '0x', index: 0 }, capacity: 0,
    data_hex: '0x', data_bytes: 0, content_hash: '0x' + '00'.repeat(32),
    lock_shape_seed: [1, 2], type_shape_seed: null, data_shape_seed: [3, 4] };
}

describe('addCell', () => {
  it('adds symmetric k-NN edges to the nearest live cells', () => {
    const cells = new Map<number, Cell>([
      [1, cell(1, 0, 0)], [2, cell(2, 2, 0)], [3, cell(3, 40, 0)], // 3 is far
    ]);
    const g = emptyNeighborGraph();
    g.adjacency.set(1, new Set()); g.adjacency.set(2, new Set()); g.adjacency.set(3, new Set());
    const { addedEdges } = addCell(g, 1, cells, { k: 1 });
    // nearest to 1 is 2 (dist 2 < cap 25); 3 is beyond cap
    expect(g.adjacency.get(1)!.has(2)).toBe(true);
    expect(g.adjacency.get(2)!.has(1)).toBe(true);
    expect(addedEdges.length).toBe(1);
    expect([addedEdges[0].from, addedEdges[0].to].sort()).toEqual([1, 2]);
  });

  it('adds one lifeline edge when every candidate exceeds maxEdgeLength', () => {
    const cells = new Map<number, Cell>([[1, cell(1, 0, 0)], [2, cell(2, 90, 0)]]);
    const g = emptyNeighborGraph();
    g.adjacency.set(1, new Set()); g.adjacency.set(2, new Set());
    const { addedEdges } = addCell(g, 1, cells, { k: 2 });
    expect(addedEdges.length).toBe(1); // lifeline to nearest, ignoring cap
    expect(g.adjacency.get(1)!.has(2)).toBe(true);
  });

  it('ignores dead cells as candidates and is a no-op for a dead subject', () => {
    const cells = new Map<number, Cell>([
      [1, cell(1, 0, 0)], [2, cell(2, 2, 0, 500)], // 2 is dead
    ]);
    const g = emptyNeighborGraph(); g.adjacency.set(1, new Set());
    const r = addCell(g, 1, cells, { k: 2 });
    expect(g.adjacency.get(1)!.size).toBe(0); // 2 dead -> no candidate, no edge
    expect(r.addedEdges).toEqual([]);
    // dead subject
    g.adjacency.set(2, new Set());
    expect(addCell(g, 2, cells, { k: 2 }).addedEdges).toEqual([]);
  });

  it('selects only the nearest k entries from a dense candidate field', () => {
    const cells = new Map<number, Cell>();
    cells.set(1, cell(1, 0, 0));
    for (let id = 2; id <= 100; id += 1) {
      cells.set(id, cell(id, id - 1, 0));
    }
    const g = emptyNeighborGraph();

    const { addedEdges } = addCell(g, 1, cells, {
      k: 4,
      maxEdgeLength: 200,
    });

    expect(addedEdges.map((edge) => edge.to)).toEqual([2, 3, 4, 5]);
  });
});

describe('removeCell', () => {
  it('removes the cell and its edges, returning canonical keys', () => {
    const g = emptyNeighborGraph();
    g.adjacency.set(1, new Set([2, 3])); g.adjacency.set(2, new Set([1])); g.adjacency.set(3, new Set([1]));
    g.edges.push({ from: 1, to: 2, d: 1 }, { from: 1, to: 3, d: 1 });
    const { removedEdgeKeys } = removeCell(g, 1);
    expect(g.adjacency.has(1)).toBe(false);
    expect(g.adjacency.get(2)!.has(1)).toBe(false);
    expect(g.edges.length).toBe(0);
    expect(removedEdgeKeys.sort()).toEqual(['1|2', '1|3']);
  });

  it('removes a lifecycle batch while preserving first-removed edge ownership', () => {
    const g = emptyNeighborGraph();
    g.adjacency.set(1, new Set([2, 4]));
    g.adjacency.set(2, new Set([1, 3]));
    g.adjacency.set(3, new Set([2, 4]));
    g.adjacency.set(4, new Set([1, 3, 5]));
    g.adjacency.set(5, new Set([4]));
    g.edges.push(
      { from: 1, to: 2, d: 1 },
      { from: 2, to: 3, d: 1 },
      { from: 3, to: 4, d: 1 },
      { from: 1, to: 4, d: 1 },
      { from: 4, to: 5, d: 1 },
    );

    const removals = removeCells(g, [2, 3]);

    expect(removals).toEqual([
      { removedEdgeKeys: ['1|2', '2|3'] },
      { removedEdgeKeys: ['3|4'] },
    ]);
    expect(g.edges).toEqual([
      { from: 1, to: 4, d: 1 },
      { from: 4, to: 5, d: 1 },
    ]);
    expect(g.adjacency.has(2)).toBe(false);
    expect(g.adjacency.has(3)).toBe(false);
    expect([...g.adjacency.get(1)!]).toEqual([4]);
    expect([...g.adjacency.get(4)!]).toEqual([1, 5]);
  });
});

describe('copy on write — a published adjacency Set is replaced, never edited', () => {
  // The route search caches each node's neighbour slots against the Set
  // instance it read them from, so "same instance" must mean "same
  // neighbours". Every mutator here replaces the instances it changes and
  // leaves every other instance alone.
  it('addCell replaces the Sets of the newborn and each new neighbour, nothing else', () => {
    const cells = new Map<number, Cell>([
      [1, cell(1, 0, 0)], [2, cell(2, 2, 0)], [3, cell(3, 4, 0)], [4, cell(4, 60, 0)],
    ]);
    const g = emptyNeighborGraph();
    g.adjacency.set(2, new Set([3])); g.adjacency.set(3, new Set([2])); g.adjacency.set(4, new Set());
    const before2 = g.adjacency.get(2)!;
    const before3 = g.adjacency.get(3)!;
    const before4 = g.adjacency.get(4)!;
    addCell(g, 1, cells, { k: 2 });
    expect([...g.adjacency.get(1)!]).toEqual([2, 3]);
    expect(g.adjacency.get(2)).not.toBe(before2);
    expect([...g.adjacency.get(2)!]).toEqual([3, 1]); // order kept, append last
    expect([...before2]).toEqual([3]); // the old instance is untouched
    expect(g.adjacency.get(3)).not.toBe(before3);
    expect([...before3]).toEqual([2]);
    expect(g.adjacency.get(4)).toBe(before4); // out of range: untouched
  });

  it('removeCells replaces each surviving neighbour\'s Set, keeps the rest, and preserves order', () => {
    const g = emptyNeighborGraph();
    g.adjacency.set(1, new Set([2, 4]));
    g.adjacency.set(2, new Set([1, 3]));
    g.adjacency.set(3, new Set([2, 4]));
    g.adjacency.set(4, new Set([1, 3, 5]));
    g.adjacency.set(5, new Set([4]));
    const before1 = g.adjacency.get(1)!;
    const before4 = g.adjacency.get(4)!;
    const before5 = g.adjacency.get(5)!;
    removeCells(g, [2, 3]);
    expect(g.adjacency.get(1)).not.toBe(before1);
    expect([...before1]).toEqual([2, 4]);
    expect([...g.adjacency.get(1)!]).toEqual([4]);
    expect(g.adjacency.get(4)).not.toBe(before4);
    expect([...before4]).toEqual([1, 3, 5]);
    expect([...g.adjacency.get(4)!]).toEqual([1, 5]);
    expect(g.adjacency.get(5)).toBe(before5); // never adjacent to the dead: untouched
  });
});

describe('eager log — the instance displaced by the FIRST touch since the last worker apply', () => {
  // The display graph carries `eagerBase`; a worker patch is a diff against
  // the graph as it stood before these edits, so the apply needs exactly the
  // instance each touched node held then — and nothing for nodes the mesh
  // never touched.
  it('addCell logs the newborn as absent and each new neighbour\'s previous instance, once', () => {
    const cells = new Map<number, Cell>([
      [1, cell(1, 0, 0)], [2, cell(2, 2, 0)], [3, cell(3, 4, 0)], [4, cell(4, 60, 0)],
    ]);
    const g = emptyLivingNeighborGraph();
    g.adjacency.set(2, new Set([3])); g.adjacency.set(3, new Set([2])); g.adjacency.set(4, new Set());
    const before2 = g.adjacency.get(2)!;
    const before3 = g.adjacency.get(3)!;
    addCell(g, 1, cells, { k: 2 });
    expect([...g.eagerBase.keys()].sort()).toEqual([1, 2, 3]);
    expect(g.eagerBase.get(1)).toBeUndefined();
    expect(g.eagerBase.has(1)).toBe(true);
    expect(g.eagerBase.get(2)).toBe(before2);
    expect(g.eagerBase.get(3)).toBe(before3);
    expect(g.eagerBase.has(4)).toBe(false);

    // A second touch of node 2 keeps the FIRST logged instance.
    cells.set(5, cell(5, 2.5, 0));
    addCell(g, 5, cells, { k: 1 });
    expect(g.adjacency.get(2)!.has(5)).toBe(true);
    expect(g.eagerBase.get(2)).toBe(before2);
    expect(g.eagerBase.get(5)).toBeUndefined();
    expect(g.eagerBase.has(5)).toBe(true);
  });

  it('removeCells logs the dead node\'s instance and each surviving neighbour\'s, once', () => {
    const g = emptyLivingNeighborGraph();
    g.adjacency.set(1, new Set([2, 4]));
    g.adjacency.set(2, new Set([1, 3]));
    g.adjacency.set(3, new Set([2, 4]));
    g.adjacency.set(4, new Set([1, 3, 5]));
    g.adjacency.set(5, new Set([4]));
    const before = new Map(g.adjacency);
    removeCells(g, [2, 3]);
    expect([...g.eagerBase.keys()].sort()).toEqual([1, 2, 3, 4]);
    for (const id of [1, 2, 3, 4]) expect(g.eagerBase.get(id)).toBe(before.get(id));
    expect(g.eagerBase.has(5)).toBe(false);
    // Node 1 lost 2 and node 4 lost 3: one touch each, one log entry each.
    expect([...g.adjacency.get(4)!]).toEqual([1, 5]);
  });

  it('a graph without an edge list never grows one, and one with a list keeps it compacted', () => {
    const cells = new Map<number, Cell>([[1, cell(1, 0, 0)], [2, cell(2, 2, 0)]]);
    const living = emptyLivingNeighborGraph();
    living.adjacency.set(2, new Set());
    addCell(living, 1, cells, { k: 1 });
    expect('edges' in living).toBe(false);
    removeCells(living, [1]);
    expect('edges' in living).toBe(false);
    expect(living.adjacency.has(1)).toBe(false);

    const whole = emptyNeighborGraph();
    whole.adjacency.set(2, new Set());
    addCell(whole, 1, cells, { k: 1 });
    expect(whole.edges).toEqual([{ from: 1, to: 2, d: 2 }]);
    removeCells(whole, [1]);
    expect(whole.edges).toEqual([]);
    expect('eagerBase' in whole).toBe(false);
  });
});
