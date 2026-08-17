// Incremental cache.stats upkeep vs the reference full-scan aggregate.
// Every transition below asserts the invariant the reducer promises:
// cache.stats always equals aggregateCellsStats(cells, totalBirths, totalDeaths).

import { describe, expect, it } from 'vitest';
import type { Cell, CellDelta, RevisionedCellDelta } from '@cknerv/types';

import {
  applyCellDelta,
  applyRevisionedCellDeltas,
  emptyCellsCache,
  fromCellsSnapshot,
  type CellGalaxyCache,
} from '../src/cellsReducer';
import { aggregateCellsStats } from '../src/cellsStats';

function cell(id: number, overrides: Partial<Cell> = {}): Cell {
  return {
    id,
    born_at_ms: 1000 + id,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [id, 0, id],
    out_point: { tx_hash: `0xtx${id}`, index: 0 },
    capacity: 100 + id,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: '0x' + '00'.repeat(32),
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
    ...overrides,
  };
}

function expectStatsInvariant(cache: CellGalaxyCache): void {
  expect(cache.stats).toEqual(
    aggregateCellsStats(cache.cells, cache.totalBirths, cache.totalDeaths),
  );
}

function step(cache: CellGalaxyCache, delta: CellDelta): CellGalaxyCache {
  const next = applyCellDelta(cache, delta);
  expectStatsInvariant(next);
  return next;
}

describe('incremental cells stats', () => {
  it('tracks births, deaths, tags, gc, and counter deltas step by step', () => {
    let cache = emptyCellsCache();
    expectStatsInvariant(cache);

    cache = step(cache, { type: 'birth', cell: cell(1, { tag: 'wallet', data_hex: '0xdeadbeef', data_bytes: 4 }) });
    cache = step(cache, { type: 'birth', cell: cell(2, { lock_kind: 'multisig', asset_kind: 'dao', capacity: 5000 }) });
    cache = step(cache, { type: 'birth', cell: cell(3, { tag: 'dex' }) });
    expect(cache.stats.inView).toBe(3);
    expect(cache.stats.dataBearing).toBe(1);
    expect(cache.stats.byKind.wallet).toBe(1);
    expect(cache.stats.byLock.multisig).toBe(1);
    expect(cache.stats.byAsset.dao).toBe(1);

    // Content replacement of a live cell swaps its contribution.
    cache = step(cache, { type: 'birth', cell: cell(1, { tag: 'cf', capacity: 900, data_hex: '0x' }) });
    expect(cache.stats.byKind.wallet).toBe(0);
    expect(cache.stats.byKind.cf).toBe(1);
    expect(cache.stats.dataBearing).toBe(0);

    // Death removes the contribution; a replayed identical death is a no-op.
    cache = step(cache, { type: 'death', id: 2, at_ms: 7777 });
    expect(cache.stats.inView).toBe(2);
    const afterDeath = applyCellDelta(cache, { type: 'death', id: 2, at_ms: 7777 });
    expect(afterDeath).toBe(cache);

    // Tag change on a LIVE cell moves kind buckets; on a DEAD cell it is
    // invisible to the aggregate either way.
    cache = step(cache, { type: 'tag', id: 3, tag: 'ckbloom' });
    expect(cache.stats.byKind.dex).toBe(0);
    expect(cache.stats.byKind.ckbloom).toBe(1);
    cache = step(cache, { type: 'tag', id: 2, tag: 'wallet' });
    expect(cache.stats.byKind.wallet).toBe(0);

    // GC of the dead record changes nothing; GC of a live record (cap
    // eviction) subtracts it.
    cache = step(cache, { type: 'gc', ids: [2] });
    expect(cache.stats.inView).toBe(2);
    cache = step(cache, { type: 'gc', ids: [3] });
    expect(cache.stats.inView).toBe(1);

    // Canonical counters ride the stats delta and stay identity-stable
    // when nothing changes.
    cache = step(cache, { type: 'stats', total_births: 40, total_deaths: 15 });
    expect(cache.stats.born).toBe(40);
    expect(cache.stats.live).toBe(25);
    const statsBefore = cache.stats;
    cache = step(cache, { type: 'pulse', at_ms: 123456 });
    expect(cache.stats).toBe(statsBefore);
  });

  it('collapses intermediate combinations inside one batch like the journal', () => {
    let cache = emptyCellsCache();
    cache = applyRevisionedCellDeltas(cache, [
      { revision: 1, delta: { type: 'birth', cell: cell(1) } },
      { revision: 2, delta: { type: 'birth', cell: cell(2, { tag: 'wallet' }) } },
    ]);
    expectStatsInvariant(cache);

    const batch: RevisionedCellDelta[] = [
      // Born and GC'd within the same batch: net zero.
      { revision: 3, delta: { type: 'birth', cell: cell(9, { capacity: 12345 }) } },
      { revision: 4, delta: { type: 'gc', ids: [9] } },
      // Dies and is replaced (revival) in the same batch.
      { revision: 5, delta: { type: 'death', id: 1, at_ms: 5000 } },
      { revision: 6, delta: { type: 'birth', cell: cell(1, { tag: 'dex' }) } },
      { revision: 7, delta: { type: 'stats', total_births: 12, total_deaths: 3 } },
    ];
    cache = applyRevisionedCellDeltas(cache, batch);
    expectStatsInvariant(cache);
    expect(cache.stats.inView).toBe(2);
    expect(cache.stats.byKind.dex).toBe(1);
    expect(cache.stats.born).toBe(12);
  });

  it('replayed byte-identical births keep the stats object identity', () => {
    let cache = emptyCellsCache();
    const record = cell(5, { tag: 'wallet' });
    cache = applyRevisionedCellDeltas(cache, [
      { revision: 1, delta: { type: 'birth', cell: record } },
    ]);
    const stats = cache.stats;
    const replayed = applyRevisionedCellDeltas(cache, [
      { revision: 1, delta: { type: 'birth', cell: { ...record, pos_seed: [...record.pos_seed] as Cell['pos_seed'] } } },
    ]);
    expect(replayed.stats).toBe(stats);
    expectStatsInvariant(replayed);
  });

  it('snapshot hydration aggregates once, including dead records', () => {
    const cache = fromCellsSnapshot(9, {
      cells: [
        cell(1, { tag: 'wallet', capacity: 700 }),
        cell(2, { death_at_ms: 4000 }),
        cell(3, { asset_kind: 'spore', data_hex: '0x01', data_bytes: 1 }),
      ],
      last_pulse_at_ms: 0,
      total_births: 30,
      total_deaths: 11,
    });
    expectStatsInvariant(cache);
    expect(cache.stats.inView).toBe(2);
    expect(cache.stats.capacityShannons).toBe(700 + 103);
    expect(cache.stats.byAsset.spore).toBe(1);
    expect(cache.stats.born).toBe(30);
  });
});
