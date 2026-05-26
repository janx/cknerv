import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import { aggregateCellsStats } from '../../src/derives/cellsStats.derive';

function mkCell(
  id: number,
  capacity: number,
  tag: Cell['tag'],
  alive: boolean,
): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: alive ? null : 1000,
    birth_block: 0,
    tag,
    pos_seed: [0, 0, 0],
    out_point: { tx_hash: '0x0', index: 0 },
    capacity,
    data_hex: '0x',
    content_hash: '0x' + '00'.repeat(32),
  };
}

function mkCells(...cells: Cell[]): Map<number, Cell> {
  return new Map(cells.map((c) => [c.id, c]));
}

describe('aggregateCellsStats', () => {
  it('returns zeros for an empty map and zero counters', () => {
    const stats = aggregateCellsStats(new Map(), 0, 0);
    expect(stats.born).toBe(0);
    expect(stats.live).toBe(0);
    expect(stats.dead).toBe(0);
    expect(stats.capacityShannons).toBe(0);
    expect(stats.byKind).toEqual({ wallet: 0, dex: 0, cf: 0, ckbloom: 0, generic: 0 });
  });

  it('born/live/dead come from the backend counters, not the local map', () => {
    // Local map is intentionally sparser than the backend totals — this is
    // exactly the CELL_CAP scenario where the projection has evicted alive
    // cells but the chain counters are intact.
    const cells = mkCells(mkCell(1, 100, 'wallet', true));
    const stats = aggregateCellsStats(cells, 10, 3);
    expect(stats.born).toBe(10);
    expect(stats.live).toBe(7);
    expect(stats.dead).toBe(3);
  });

  it('byKind buckets tag === null into generic (alive only)', () => {
    const cells = mkCells(
      mkCell(1, 100, null, true),
      mkCell(2, 100, 'dex', true),
      mkCell(3, 100, 'cf', true),
      mkCell(4, 100, 'dex', false), // dying — excluded from byKind
    );
    const stats = aggregateCellsStats(cells, 0, 0);
    expect(stats.byKind.generic).toBe(1);
    expect(stats.byKind.dex).toBe(1);
    expect(stats.byKind.cf).toBe(1);
    expect(stats.byKind.wallet).toBe(0);
    expect(stats.byKind.ckbloom).toBe(0);
  });

  it('capacityShannons sums alive cells only', () => {
    const cells = mkCells(
      mkCell(1, 100, 'wallet', true),
      mkCell(2, 9999, 'wallet', false),
      mkCell(3, 250, 'dex', true),
    );
    const stats = aggregateCellsStats(cells, 0, 0);
    expect(stats.capacityShannons).toBe(350);
  });
});
