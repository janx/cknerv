import { describe, expect, it } from 'vitest';

import { computeRollingStats } from '../../src/components/CkbNetworkHud';
import type { ChainEntry } from '@cknerv/types';

function makeChain(overrides: Partial<ChainEntry> = {}): ChainEntry {
  return {
    tip: 0,
    recent_blocks: [],
    recent_tx_hashes: [],
    total_blocks: 0,
    total_txs: 0,
    mempool: {
      pending: 0,
      proposed: 0,
      orphan: 0,
      total_tx_size: 0,
      total_tx_cycles: 0,
      min_fee_rate: 0,
    },
    epoch: { number: 0, index: 0, length: 0 },
    median_time_ms: 0,
    difficulty: '0x0',
    chain_name: '',
    reorgs: 0,
    recent_block_intervals_ms: [],
    recent_block_tx_counts: [],
    last_block_ts_ms: null,
    ...overrides,
  };
}

describe('computeRollingStats', () => {
  it('returns zeros / null when rings are empty', () => {
    const out = computeRollingStats(makeChain());
    expect(out.tps).toBe(0);
    expect(out.intervalAvgMs).toBe(0);
    expect(out.intervalLastMs).toBeNull();
  });

  it('derives TPS from total tx count over total interval seconds', () => {
    // 3 intervals of 5s each = 15s window, with 6 + 4 + 5 = 15 txs in
    // those windows => 1.0 tps. The first tx_count sample lacks a
    // preceding interval and must be excluded by the alignment slice.
    const chain = makeChain({
      recent_block_intervals_ms: [5000, 5000, 5000],
      recent_block_tx_counts: [99 /* dropped */, 6, 4, 5],
    });
    const out = computeRollingStats(chain);
    expect(out.tps).toBeCloseTo(1.0, 6);
  });

  it('derives intervalAvgMs from the interval ring', () => {
    const chain = makeChain({
      recent_block_intervals_ms: [4000, 6000, 5000],
      recent_block_tx_counts: [1, 1, 1],
    });
    const out = computeRollingStats(chain);
    expect(out.intervalAvgMs).toBe(5000);
    expect(out.intervalLastMs).toBe(5000);
  });

  it('handles tx_counts shorter than intervals (single block + one interval)', () => {
    // Only one interval recorded; alignment slice must not negative-index.
    const chain = makeChain({
      recent_block_intervals_ms: [3000],
      recent_block_tx_counts: [10],
    });
    const out = computeRollingStats(chain);
    // Alignment: take last 1 of [10] = [10], totalSec = 3, tps = 10/3.
    expect(out.tps).toBeCloseTo(10 / 3, 6);
    expect(out.intervalLastMs).toBe(3000);
  });
});
