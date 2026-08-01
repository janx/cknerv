import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import { buildNeighborGraph } from '../../src/geometry/neighborGraph';
import {
  buildPassiveNeighborGraph,
  PASSIVE_ARBOR_WEIGHT_MIN,
  PASSIVE_CROSSLINK_FRACTION,
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

function reachable(graph: ReturnType<typeof buildNeighborGraph>, start: number): Set<number> {
  const seen = new Set([start]);
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    for (const next of graph.adjacency.get(queue[head]) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

describe('buildPassiveNeighborGraph', () => {
  const cells = new Map(
    Array.from({ length: 240 }, (_, id) => [id, cell(id)] as const),
  );
  const full = buildNeighborGraph(cells, { k: 7, maxEdgeLength: 30 });

  it('keeps every displayed Cell connected while removing dense visual hair', () => {
    const passive = buildPassiveNeighborGraph(full);

    expect(reachable(passive, 0).size).toBe(cells.size);
    expect(passive.adjacency.size).toBe(full.adjacency.size);
    expect(passive.edges.length).toBeGreaterThanOrEqual(cells.size - 1);
    expect(passive.edges.length).toBeLessThan(full.edges.length * 0.72);
    for (const edge of passive.edges) {
      expect(passive.adjacency.get(edge.from)?.has(edge.to)).toBe(true);
      expect(passive.adjacency.get(edge.to)?.has(edge.from)).toBe(true);
    }
  });

  it('retains carrying arbor branches and samples cross-links deterministically', () => {
    const a = buildPassiveNeighborGraph(full, PASSIVE_CROSSLINK_FRACTION);
    const b = buildPassiveNeighborGraph(full, PASSIVE_CROSSLINK_FRACTION);
    const keys = (graph: typeof a) => graph.edges.map((edge) => `${edge.from}:${edge.to}`);

    expect(keys(a)).toEqual(keys(b));
    const passiveKeys = new Set(keys(a));
    for (const edge of full.edges) {
      if (edge.w !== undefined && edge.w >= PASSIVE_ARBOR_WEIGHT_MIN) {
        expect(passiveKeys.has(`${edge.from}:${edge.to}`)).toBe(true);
      }
    }
  });

  it('can expose the complete graph for diagnostics', () => {
    const complete = buildPassiveNeighborGraph(full, 1);
    expect(new Set(complete.edges.map((edge) => `${edge.from}:${edge.to}`)))
      .toEqual(new Set(full.edges.map((edge) => `${edge.from}:${edge.to}`)));
  });
});
