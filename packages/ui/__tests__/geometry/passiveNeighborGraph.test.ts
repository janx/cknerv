import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import { buildNeighborGraph } from '../../src/geometry/neighborGraph';
import {
  buildPassiveNeighborGraph,
  PASSIVE_EDGE_BUDGET,
  PASSIVE_EDGES_PER_CELL,
  PASSIVE_TRUNK_SHARE,
  passiveEdgeBudget,
} from '../../src/geometry/passiveNeighborGraph';

function cell(id: number): Cell {
  const ring = id % 5;
  const angle = id * 2.399963229728653;
  const r = 5 + ring * 3 + Math.sin(id * 0.73) * 2;
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [Math.cos(angle) * r, Math.sin(id) * 2, Math.sin(angle) * r],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 0,
    data_hex: '0x',
    content_hash: `0x${'00'.repeat(32)}`,
  };
}

describe('buildPassiveNeighborGraph', () => {
  const cells = new Map(
    Array.from({ length: 240 }, (_, id) => [id, cell(id)] as const),
  );
  const full = buildNeighborGraph(cells, { k: 7, maxEdgeLength: 30 });

  it('keeps about one resting fibre per Cell before the screen cap', () => {
    const passive = buildPassiveNeighborGraph(full);

    expect(passive.edges).toHaveLength(passiveEdgeBudget(cells.size));
    expect(passive.edges.length).toBeGreaterThanOrEqual(cells.size - 1);
    expect(passive.adjacency.size).toBe(full.adjacency.size);
    const covered = [...passive.adjacency.values()]
      .filter((edges) => edges.size > 0).length;
    expect(covered / cells.size).toBeGreaterThan(0.9);
    for (const edge of passive.edges) {
      expect(passive.adjacency.get(edge.from)?.has(edge.to)).toBe(true);
      expect(passive.adjacency.get(edge.to)?.has(edge.from)).toBe(true);
    }
  });

  it('keeps broad Cell coverage when a manual field reaches the screen cap', () => {
    const capped = buildPassiveNeighborGraph(full, {
      edgeBudget: Math.round(cells.size * (8 / 9)),
    });
    const covered = [...capped.adjacency.values()]
      .filter((edges) => edges.size > 0).length;

    expect(covered / cells.size).toBeGreaterThan(0.85);
  });

  it('selects hierarchical branches and capillaries deterministically', () => {
    const options = { edgeBudget: 80 };
    const a = buildPassiveNeighborGraph(full, options);
    const b = buildPassiveNeighborGraph(full, options);
    const keys = (graph: typeof a) => graph.edges.map((edge) => `${edge.from}:${edge.to}`);

    expect(keys(a)).toEqual(keys(b));
    expect(a.edges).toHaveLength(80);
    expect(a.edges.filter((edge) => edge.w !== undefined).length)
      .toBeGreaterThanOrEqual(Math.round(80 * PASSIVE_TRUNK_SHARE));
    const fullKeys = new Set(full.edges.map((edge) => `${edge.from}:${edge.to}`));
    expect(keys(a).every((key) => fullKeys.has(key))).toBe(true);
  });

  it('scales with visible Cells before converging on a fixed screen cap', () => {
    expect(passiveEdgeBudget(6_000)).toBe(Math.round(6_000 * PASSIVE_EDGES_PER_CELL));
    expect(passiveEdgeBudget(9_000)).toBe(PASSIVE_EDGE_BUDGET);
    expect(passiveEdgeBudget(14_000)).toBe(PASSIVE_EDGE_BUDGET);
    expect(passiveEdgeBudget(20_000)).toBe(PASSIVE_EDGE_BUDGET);
    expect(passiveEdgeBudget(14_000) / passiveEdgeBudget(6_000)).toBeLessThan(1.4);
  });

  it('preserves surviving old branches across ordinary Cell churn', () => {
    const previous = buildPassiveNeighborGraph(full, { edgeBudget: 80 });
    const changedCells = new Map(cells);
    changedCells.delete(17);
    changedCells.set(999, cell(999));
    const changedFull = buildNeighborGraph(changedCells, {
      k: 7,
      maxEdgeLength: 30,
    });
    const next = buildPassiveNeighborGraph(changedFull, {
      edgeBudget: 80,
      preferredEdges: previous.edges,
    });
    const availableKeys = new Set(
      changedFull.edges.map((edge) => `${edge.from}:${edge.to}`),
    );
    const survivingKeys = previous.edges
      .map((edge) => `${edge.from}:${edge.to}`)
      .filter((key) => availableKeys.has(key));
    const nextKeys = new Set(next.edges.map((edge) => `${edge.from}:${edge.to}`));

    expect(next.edges).toHaveLength(80);
    expect(survivingKeys.every((key) => nextKeys.has(key))).toBe(true);
  });

  it('can expose the complete graph for diagnostics', () => {
    const complete = buildPassiveNeighborGraph(full, { includeAll: true });
    expect(new Set(complete.edges.map((edge) => `${edge.from}:${edge.to}`)))
      .toEqual(new Set(full.edges.map((edge) => `${edge.from}:${edge.to}`)));
  });
});
