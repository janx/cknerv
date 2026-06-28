// Pure-reducer tests for the chain-entity slice. Lifted and trimmed from
// simulator's `cache/entities.test.ts` to cover only the chain-relevant
// branches (the RCG components / composers / OTs reducer cases stay in
// simulator).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  ChainEntry,
  Mutation,
  RevisionedMutation,
} from '@cknerv/types';

import {
  applyChainMutation,
  applyRevisionedChainMutations,
  emptyChainCache,
} from '../src/chainReducer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = (name: string) =>
  resolve(__dirname, '..', '..', '..', 'tests', 'fixtures', name);
const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(fixturePath(name), 'utf8')) as T;

function rm(rev: number, m: Mutation): RevisionedMutation {
  return { revision: rev, mutation: m };
}

describe('applyChainMutation', () => {
  it('block_mined updates tip and recent_blocks', () => {
    let c = applyChainMutation(emptyChainCache(), {
      type: 'block_mined',
      number: 100,
      hash: '0xb1',
      tx_count: 1,
      at: 1000,
    });
    expect(c.tip).toBe(100);
    expect(c.recent_blocks.length).toBe(1);
    expect(c.total_blocks).toBe(1);

    c = applyChainMutation(c, {
      type: 'block_mined',
      number: 101,
      hash: '0xb2',
      tx_count: 0,
      at: 2000,
    });
    expect(c.tip).toBe(101);
    expect(c.total_blocks).toBe(2);
  });

  it('block_mined dedupes identical (number, hash)', () => {
    let c = applyChainMutation(emptyChainCache(), {
      type: 'block_mined',
      number: 100,
      hash: '0xb1',
      tx_count: 1,
      at: 1000,
    });
    c = applyChainMutation(c, {
      type: 'block_mined',
      number: 100,
      hash: '0xb1',
      tx_count: 1,
      at: 1500,
    });
    expect(c.total_blocks).toBe(1);
  });

  it('block_mined records reorg when same number arrives with different hash', () => {
    let c = applyChainMutation(emptyChainCache(), {
      type: 'block_mined',
      number: 100,
      hash: '0xb1',
      tx_count: 1,
      at: 1000,
    });
    c = applyChainMutation(c, {
      type: 'block_mined',
      number: 100,
      hash: '0xb2',
      tx_count: 1,
      at: 1500,
    });
    expect(c.reorgs).toBe(1);
    expect(c.total_blocks).toBe(2);
  });

  it('block_mined fills the interval / tx-count rings from at-deltas', () => {
    let c = applyChainMutation(emptyChainCache(), {
      type: 'block_mined',
      number: 1,
      hash: '0xa',
      tx_count: 1,
      at: 1000,
    });
    c = applyChainMutation(c, {
      type: 'block_mined',
      number: 2,
      hash: '0xb',
      tx_count: 2,
      at: 7000,
    });
    expect(c.recent_block_intervals_ms).toEqual([6000]);
    expect(c.recent_block_tx_counts).toEqual([1, 2]);
    expect(c.last_block_ts_ms).toBe(7000);
  });

  it('accrues recent_block_sizes parallel to tx_counts (size omitted → 0)', () => {
    let c = emptyChainCache();
    c = applyChainMutation(c, { type: 'block_mined', number: 1, hash: '0x1', tx_count: 2, size: 500, at: 100 });
    c = applyChainMutation(c, { type: 'block_mined', number: 2, hash: '0x2', tx_count: 7, at: 110 }); // no size
    expect(c.recent_block_sizes).toEqual([500, 0]);
    expect(c.recent_block_tx_counts).toEqual([2, 7]);
  });

  it('tx_landed appends and increments total_txs', () => {
    let c = applyChainMutation(emptyChainCache(), {
      type: 'tx_landed',
      tx_hash: '0xtx1',
      block: 100,
      at: 1000,
      inputs: [],
      outputs: [],
    });
    c = applyChainMutation(c, {
      type: 'tx_landed',
      tx_hash: '0xtx2',
      block: 101,
      at: 1100,
      inputs: [],
      outputs: [],
    });
    expect(c.total_txs).toBe(2);
    expect(c.recent_tx_hashes.length).toBe(2);
    expect(c.recent_tx_hashes[1].tx_hash).toBe('0xtx2');
  });

  it('chain_mempool_updated overwrites the mempool snapshot', () => {
    const c = applyChainMutation(emptyChainCache(), {
      type: 'chain_mempool_updated',
      pending: 12,
      proposed: 3,
      orphan: 1,
      total_tx_size: 0x400,
      total_tx_cycles: 0x1000,
      min_fee_rate: 1000,
    });
    expect(c.mempool.pending).toBe(12);
    expect(c.mempool.proposed).toBe(3);
    expect(c.mempool.orphan).toBe(1);
    expect(c.mempool.min_fee_rate).toBe(1000);
  });

  it('chain_info_updated overwrites the chain-info snapshot', () => {
    const c = applyChainMutation(emptyChainCache(), {
      type: 'chain_info_updated',
      epoch: { number: 314, index: 300, length: 1800 },
      median_time_ms: 1700000000000,
      difficulty: '0x100',
      chain_name: 'ckb_dev',
    });
    expect(c.epoch).toEqual({ number: 314, index: 300, length: 1800 });
    expect(c.median_time_ms).toBe(1700000000000);
    expect(c.difficulty).toBe('0x100');
    expect(c.chain_name).toBe('ckb_dev');
  });

  it('cell_tagged is a no-op (projection-only)', () => {
    const before = emptyChainCache();
    const after = applyChainMutation(before, {
      type: 'cell_tagged',
      out_point: { tx_hash: '0xdef', index: 0 },
      tag: 'dex',
      at: 1200,
    });
    expect(after).toBe(before); // referentially identical — no clone
  });

  it('ignores projection-only mutations (e.g. backfill_progress) without throwing', () => {
    const prev = emptyChainCache();
    // backfill_progress rides the chain broadcast but is intentionally not in
    // the chain Mutation union; the reducer must treat it as a no-op.
    const m = { type: 'backfill_progress', done: 1, total: 2, active: true } as unknown as Mutation;
    const next = applyChainMutation(prev, m);
    expect(next).toBe(prev);
  });

  it('returns a new reference on a chain-affecting mutation (purity)', () => {
    const before = emptyChainCache();
    const after = applyChainMutation(before, {
      type: 'block_mined',
      number: 1,
      hash: '0xa',
      tx_count: 1,
      at: 1,
    });
    expect(after).not.toBe(before);
    expect(before.tip).toBe(0); // unchanged
  });

  it('chain_sync_updated sets ibd + best_known_block', () => {
    const prev = emptyChainCache();
    const next = applyChainMutation(prev, {
      type: 'chain_sync_updated',
      ibd: true,
      best_known_block: 777,
    });
    expect(next.ibd).toBe(true);
    expect(next.best_known_block).toBe(777);
    // purity
    expect(prev.ibd).toBe(false);
  });

  it('peers_updated / chain_node_info_updated are chain no-ops', () => {
    const prev = emptyChainCache();
    const a = applyChainMutation(prev, { type: 'peers_updated', peers: [] });
    const b = applyChainMutation(prev, {
      type: 'chain_node_info_updated',
      id: 'ckb:local',
      version: '0.116.1',
      connections: 2,
    });
    expect(a).toBe(prev);
    expect(b).toBe(prev);
  });
});

describe('applyRevisionedChainMutations', () => {
  it('applies a batch and produces the expected final cache', () => {
    const after = applyRevisionedChainMutations(emptyChainCache(), [
      rm(1, { type: 'block_mined', number: 5, hash: '0xb', tx_count: 0, at: 1 }),
      rm(2, {
        type: 'tx_landed',
        tx_hash: '0xtx',
        block: 5,
        at: 2,
        inputs: [],
        outputs: [],
      }),
    ]);
    expect(after.tip).toBe(5);
    expect(after.total_txs).toBe(1);
  });

  it('returns the previous cache when no mutations affect chain', () => {
    const before = emptyChainCache();
    const after = applyRevisionedChainMutations(before, [
      rm(1, {
        type: 'cell_tagged',
        out_point: { tx_hash: '0x0', index: 0 },
        tag: 'dex',
        at: 1,
      }),
    ]);
    expect(after).toBe(before);
  });

  it('returns the previous cache for an empty batch', () => {
    const before = emptyChainCache();
    expect(applyRevisionedChainMutations(before, [])).toBe(before);
  });
});

describe('cross-language wire-shape parity', () => {
  it('snapshot_chain.json hydrates and exposes documented invariants', () => {
    const snap = fixture<ChainEntry>('snapshot_chain.json');
    // tip mirrors the recent_blocks tail.
    expect(snap.tip).toBe(100);
    expect(snap.recent_blocks[snap.recent_blocks.length - 1].number).toBe(100);
    expect(snap.total_blocks).toBeGreaterThanOrEqual(snap.recent_blocks.length);
  });

  it('all mutation_samples.json variants pipe through applyChainMutation without throwing', () => {
    const samples = fixture<Record<string, Mutation>>('mutation_samples.json');
    let c = emptyChainCache();
    for (const m of Object.values(samples)) {
      c = applyChainMutation(c, m);
    }
    // After replaying every variant once we should have a non-empty chain.
    expect(c.tip).toBe(1);
    expect(c.total_blocks).toBe(1);
    expect(c.total_txs).toBe(1);
    expect(c.mempool.min_fee_rate).toBe(1000);
  });
});
