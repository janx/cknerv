import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import { emptyNeighborGraph } from '../../src/geometry/neighborGraph';
import { addCell, removeCell } from '../../src/nerve/incrementalGraph';

function cell(id: number, x: number, z: number, death: number | null = null): Cell {
  return { id, born_at_ms: 0, death_at_ms: death, birth_block: 1, tag: null,
    pos_seed: [x, 0, z], out_point: { tx_hash: '0x', index: 0 }, capacity: 0,
    data_hex: '0x', content_hash: '0x' + '00'.repeat(32) };
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
});
