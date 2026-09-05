import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  emptyLivingNeighborGraph,
  emptyNeighborGraph,
} from '../../src/geometry/neighborGraph';
import {
  addCell,
  buildBirthAdmissionGrid,
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

/** The selection as it stood before the parallel-scalar rewrite: one
 *  candidate record per live cell inside the cap, the same worst-eviction
 *  rule, the same closing sort. What `addCell` must still choose, in order. */
function referenceNearest(
  self: Cell,
  cells: ReadonlyMap<number, Cell>,
  k: number,
  maxLen: number,
): { ids: number[]; dSq: number[]; lifeline: { id: number; dSq: number } | null } {
  const maxLenSq = maxLen * maxLen;
  const near: { id: number; dSq: number; order: number }[] = [];
  let lifeline: { id: number; dSq: number } | null = null;
  let order = 0;
  for (const [id, c] of cells) {
    if (id === self.id || c.death_at_ms != null) continue;
    const dx = self.pos_seed[0] - c.pos_seed[0];
    const dy = self.pos_seed[1] - c.pos_seed[1];
    const dz = self.pos_seed[2] - c.pos_seed[2];
    const dSq = dx * dx + dy * dy + dz * dz;
    if (lifeline === null || dSq < lifeline.dSq) lifeline = { id, dSq };
    if (dSq <= maxLenSq && k > 0) {
      const candidate = { id, dSq, order };
      if (near.length < k) {
        near.push(candidate);
      } else {
        let worst = 0;
        for (let i = 1; i < near.length; i += 1) {
          if (
            near[i].dSq > near[worst].dSq
            || (near[i].dSq === near[worst].dSq && near[i].order > near[worst].order)
          ) worst = i;
        }
        if (dSq < near[worst].dSq) near[worst] = candidate;
      }
    }
    order += 1;
  }
  near.sort((a, b) => a.dSq - b.dSq || a.order - b.order);
  return {
    ids: near.slice(0, k).map((n) => n.id),
    dSq: near.slice(0, k).map((n) => n.dSq),
    lifeline,
  };
}

/** Deterministic PRNG (mulberry32) so a failure names its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('addCell — allocate-on-insert selection equals the record-based one', () => {
  it('chooses the same neighbours in the same order, ties and lifelines included, over random fields', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const random = rng(seed);
      // A coarse lattice forces exact distance ties; a few dead cells and
      // a spread of k and cap exercise every branch (empty, partial, full,
      // lifeline-only, isolated).
      const size = 2 + Math.floor(random() * 60);
      const cells = new Map<number, Cell>();
      for (let id = 1; id <= size; id += 1) {
        const x = Math.floor(random() * 7) * 3;
        const z = Math.floor(random() * 7) * 3;
        const dead = random() < 0.15 ? 1 : null;
        cells.set(id, cell(id, x, z, dead));
      }
      const subjectId = 1 + Math.floor(random() * size);
      const k = Math.floor(random() * 6);
      const maxLen = random() < 0.2 ? 0.5 : [4, 7, 25, 200][Math.floor(random() * 4)];
      const subject = cells.get(subjectId)!;
      if (subject.death_at_ms != null) continue;

      const expected = referenceNearest(subject, cells, k, maxLen);
      const g = emptyNeighborGraph();
      const { addedEdges } = addCell(g, subjectId, cells, { k, maxEdgeLength: maxLen });

      const label = `seed ${seed} (n=${size}, subject=${subjectId}, k=${k}, cap=${maxLen})`;
      if (expected.ids.length === 0) {
        if (expected.lifeline) {
          expect(addedEdges.map((e) => e.to === subjectId ? e.from : e.to), label)
            .toEqual([expected.lifeline.id]);
          expect(addedEdges[0].d, label).toBe(Math.sqrt(expected.lifeline.dSq));
        } else {
          expect(addedEdges, label).toEqual([]);
          expect(g.adjacency.has(subjectId), label).toBe(true);
        }
        continue;
      }
      expect(addedEdges.map((e) => e.to === subjectId ? e.from : e.to), label)
        .toEqual(expected.ids);
      expect(addedEdges.map((e) => e.d), label)
        .toEqual(expected.dSq.map((d) => Math.sqrt(d)));
      // Adjacency order is insertion order, so it carries the same ranking.
      expect([...g.adjacency.get(subjectId)!], label).toEqual(expected.ids);
    }
  });

  it('keeps the eager log and the copy-on-write rule under the scalar selection', () => {
    const cells = new Map<number, Cell>([
      [1, cell(1, 0, 0)], [2, cell(2, 2, 0)], [3, cell(3, 4, 0)], [4, cell(4, 60, 0)],
    ]);
    const g = emptyLivingNeighborGraph();
    g.adjacency.set(2, new Set([3])); g.adjacency.set(3, new Set([2])); g.adjacency.set(4, new Set());
    const before2 = g.adjacency.get(2)!;
    addCell(g, 1, cells, { k: 2 });
    expect([...g.eagerBase.keys()].sort()).toEqual([1, 2, 3]);
    expect(g.eagerBase.get(2)).toBe(before2);
    expect([...before2]).toEqual([3]);
    expect([...g.adjacency.get(2)!]).toEqual([3, 1]);
  });
});

describe('addCell — the bucketed grid answers each birth exactly as the full scan', () => {
  // The grid replaced the per-birth full scan. Its result must be identical:
  // the k nearest within the cap by (dSq, scanOrder), and the global-nearest
  // lifeline when nothing is within the cap. referenceNearest above IS the
  // pre-change full scan, so these assert grid == scan directly.
  it('a shared grid over the staged map matches the full scan for every birth in a batch', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const random = rng(seed * 101);
      // A coarse lattice + small jitter: exact ties at and across bucket
      // boundaries, plus generic spreads and rim outliers, in one field.
      const size = 120 + Math.floor(random() * 200);
      const cells = new Map<number, Cell>();
      for (let id = 1; id <= size; id += 1) {
        const x = Math.floor(random() * 12) * 4 + Math.floor(random() * 3);
        const z = Math.floor(random() * 12) * 4 + Math.floor(random() * 3);
        cells.set(id, cell(id, x, z));
      }
      const k = 1 + Math.floor(random() * 5);
      const maxLen = [4, 7, 25, 200][Math.floor(random() * 4)];
      // A batch of births answered from ONE shared grid — the production path.
      const born: number[] = [];
      for (let id = 1; id <= size; id += 1) if (random() < 0.25) born.push(id);
      const grid = buildBirthAdmissionGrid(cells);

      for (const id of born) {
        const expected = referenceNearest(cells.get(id)!, cells, k, maxLen);
        const g = emptyNeighborGraph();
        const { addedEdges } = addCell(g, id, cells, {
          k, maxEdgeLength: maxLen, grid,
        });
        const label = `seed ${seed} id ${id} (n=${size}, k=${k}, cap=${maxLen})`;
        const got = addedEdges.map((e) => (e.to === id ? e.from : e.to));
        if (expected.ids.length === 0) {
          if (expected.lifeline) {
            expect(got, label).toEqual([expected.lifeline.id]);
            expect(addedEdges[0].d, label).toBe(Math.sqrt(expected.lifeline.dSq));
          } else {
            expect(addedEdges, label).toEqual([]);
          }
          continue;
        }
        expect(got, label).toEqual(expected.ids);
        expect(addedEdges.map((e) => e.d), label)
          .toEqual(expected.dSq.map((d) => Math.sqrt(d)));
        // Adjacency insertion order carries the same (dSq, scanOrder) ranking.
        expect([...g.adjacency.get(id)!], label).toEqual(expected.ids);
      }
    }
  });

  it('widens across empty rings to the true nearest, cluster and rim alike', () => {
    // A tight cluster far from a rim outlier, so the query must not be fooled
    // by a bucket boundary and the outlier must widen past empty rings.
    const cells = new Map<number, Cell>([
      [1, cell(1, 0, 0)], [2, cell(2, 1, 0)], [3, cell(3, 0, 1)],
      [4, cell(4, 200, 0)], // beyond the cap from every cluster cell
    ]);
    const grid = buildBirthAdmissionGrid(cells);

    const gA = emptyNeighborGraph();
    addCell(gA, 1, cells, { k: 2, maxEdgeLength: 25, grid });
    expect([...gA.adjacency.get(1)!].sort((a, b) => a - b)).toEqual([2, 3]);

    // Everything is > 25 from cell 4, so it takes one lifeline edge to its
    // globally nearest — cell 2 at distance 199, found only by widening.
    const gB = emptyNeighborGraph();
    const { addedEdges } = addCell(gB, 4, cells, { k: 4, maxEdgeLength: 25, grid });
    expect(addedEdges.length).toBe(1);
    expect([...gB.adjacency.get(4)!]).toEqual([2]);
    expect(addedEdges[0].d).toBe(199);
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
