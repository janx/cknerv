import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import { buildNeighborGraph } from '../../src/geometry/neighborGraph';
import {
  buildPassiveNeighborGraph,
  NERVE_SCREEN_BUDGET,
  PASSIVE_EDGE_CEILING,
  PASSIVE_EDGES_PER_CELL,
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
    data_bytes: 0,
    content_hash: `0x${'00'.repeat(32)}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
  };
}

describe('nerve screen budget', () => {
  it('matches the budget the server carries in the snapshot', () => {
    // Twin of `DISPLAY_NERVE_EDGE_BUDGET` in
    // `crates/cknerv-core/src/projection/display_plane.rs` (asserted there by
    // `display_budgets_match_their_client_mirrors`). The plane stages cells
    // only; this number is the fibre half of the same product budget, and the
    // two travel together in `snapshot.display.budget`.
    expect(NERVE_SCREEN_BUDGET).toBe(8_000);
  });
});

describe('buildPassiveNeighborGraph', () => {
  const cells = new Map(
    Array.from({ length: 240 }, (_, id) => [id, cell(id)] as const),
  );
  const full = buildNeighborGraph(cells, { k: 7, maxEdgeLength: 30 });

  it('keeps every connected Cell on a visible arbor plus cross-links', () => {
    const passive = buildPassiveNeighborGraph(full);

    expect(passive.edges).toHaveLength(passiveEdgeBudget(cells.size));
    expect(passive.edges.length).toBeGreaterThanOrEqual(cells.size - 1);
    expect(passive.adjacency.size).toBe(full.adjacency.size);
    const covered = [...passive.adjacency.values()]
      .filter((edges) => edges.size > 0).length;
    expect(covered).toBe(cells.size);
    expect(passive.edges.length).toBeGreaterThan(cells.size);
    expect(passive.edges.some((edge) => edge.w !== undefined)).toBe(true);
    expect(passive.edges.some((edge) => edge.w === undefined)).toBe(true);
    for (const edge of passive.edges) {
      expect(passive.adjacency.get(edge.from)?.has(edge.to)).toBe(true);
      expect(passive.adjacency.get(edge.to)?.has(edge.from)).toBe(true);
    }
  });

  it('scatters partial coverage uniformly when the forest exceeds the budget', () => {
    // Over-budget regime: full coverage is impossible by design. The
    // spanning forest must not be admitted in graph order (which wires one
    // coherent region solid and leaves the rest bare) — a hash-scattered
    // share keeps the bare "dust" spread across the field.
    const edgeBudget = Math.round(cells.size * (8 / 9));
    const capped = buildPassiveNeighborGraph(full, { edgeBudget });
    const covered = [...capped.adjacency.values()]
      .filter((edges) => edges.size > 0).length;

    expect(capped.edges).toHaveLength(edgeBudget);
    // Bare Cells exist (partial coverage), but most of the field stays on
    // visible fibres at this near-full budget.
    expect(covered / cells.size).toBeGreaterThan(0.6);
    expect(covered / cells.size).toBeLessThan(1);

    // The scatter must not be the graph-order forest prefix: an id-ordered
    // prefix concentrates coverage on the lowest ids; hash scatter reaches
    // deep into the id range even at a small coverage share.
    const low = buildPassiveNeighborGraph(full, { edgeBudget, coverageShare: 0.3 });
    const coveredIds = [...low.adjacency.entries()]
      .filter(([, edges]) => edges.size > 0)
      .map(([id]) => id);
    const highIds = coveredIds.filter((id) => id >= cells.size / 2).length;
    expect(highIds / coveredIds.length).toBeGreaterThan(0.25);
  });

  it('selects a deterministic subset of authoritative graph edges', () => {
    const options = { edgeBudget: 80 };
    const a = buildPassiveNeighborGraph(full, options);
    const b = buildPassiveNeighborGraph(full, options);
    const keys = (graph: typeof a) => graph.edges.map((edge) => `${edge.from}:${edge.to}`);

    expect(keys(a)).toEqual(keys(b));
    expect(a.edges).toHaveLength(80);
    const fullKeys = new Set(full.edges.map((edge) => `${edge.from}:${edge.to}`));
    expect(keys(a).every((key) => fullKeys.has(key))).toBe(true);
  });

  it('caps the budget at the fixed screen composition, ratio-sized below it', () => {
    // Explicit product decision (2026-08-11): perceived density scales with
    // TOTAL on-screen edges over the fixed galaxy disk, so the budget is a
    // fixed screen constant once the field outgrows it — a bigger field
    // means airier coverage, never a denser mat.
    expect(passiveEdgeBudget(240)).toBe(Math.round(240 * PASSIVE_EDGES_PER_CELL));
    expect(passiveEdgeBudget(6_000)).toBe(8_000); // ratio and cap coincide
    expect(passiveEdgeBudget(12_000)).toBe(8_000); // the fixed AUTO field
    expect(passiveEdgeBudget(50_000)).toBe(8_000); // manual fields too
    // A raised live-tuning knob lifts the cap up to the ceiling; the 4/3
    // connectivity ratio still bounds small fields.
    expect(passiveEdgeBudget(12_000, 20_000)).toBe(16_000);
    expect(passiveEdgeBudget(50_000, 20_000)).toBe(PASSIVE_EDGE_CEILING);
    expect(passiveEdgeBudget(50_000, 99_999)).toBe(PASSIVE_EDGE_CEILING);
  });

  it('preserves surviving old branches after guaranteeing current coverage', () => {
    const edgeBudget = passiveEdgeBudget(cells.size);
    const previous = buildPassiveNeighborGraph(full, { edgeBudget });
    const changedCells = new Map(cells);
    changedCells.delete(17);
    changedCells.set(999, cell(999));
    const changedFull = buildNeighborGraph(changedCells, {
      k: 7,
      maxEdgeLength: 30,
    });
    const next = buildPassiveNeighborGraph(changedFull, {
      edgeBudget,
      preferredEdges: previous.edges,
    });
    const availableKeys = new Set(
      changedFull.edges.map((edge) => `${edge.from}:${edge.to}`),
    );
    const survivingKeys = previous.edges
      .map((edge) => `${edge.from}:${edge.to}`)
      .filter((key) => availableKeys.has(key));
    const nextKeys = new Set(next.edges.map((edge) => `${edge.from}:${edge.to}`));

    expect(next.edges).toHaveLength(edgeBudget);
    const retained = survivingKeys.filter((key) => nextKeys.has(key)).length;
    expect(retained / survivingKeys.length).toBeGreaterThan(0.75);
    expect([...next.adjacency.values()].every((edges) => edges.size > 0))
      .toBe(true);
  });

  it('can expose the complete graph for diagnostics', () => {
    const complete = buildPassiveNeighborGraph(full, { includeAll: true });
    expect(new Set(complete.edges.map((edge) => `${edge.from}:${edge.to}`)))
      .toEqual(new Set(full.edges.map((edge) => `${edge.from}:${edge.to}`)));
  });
});
