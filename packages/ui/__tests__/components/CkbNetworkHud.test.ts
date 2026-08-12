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
    recent_block_sizes: [],
    last_block_ts_ms: null,
    ibd: false,
    best_known_block: 0,
    ...overrides,
  };
}

describe('computeRollingStats', () => {
  it('returns zero / null when the interval ring is empty', () => {
    const out = computeRollingStats(makeChain());
    expect(out.intervalAvgMs).toBe(0);
    expect(out.intervalLastMs).toBeNull();
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
});
