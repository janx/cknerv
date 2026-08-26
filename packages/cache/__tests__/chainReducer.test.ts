// Pure-reducer tests for the chain-entity slice. Lifted and trimmed from
// simulator's `cache/entities.test.ts` to cover only the chain-relevant
// branches (the RCG components / composers / OTs reducer cases stay in
// simulator).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DATA_HEX_TRUNCATION_MARKER } from '@cknerv/types';
import type {
  ChainEntry,
  Mutation,
  RevisionedMutation,
} from '@cknerv/types';

import {
  applyChainMutation,
  applyRevisionedChainMutations,
  emptyChainCache,
  PRODUCER_MESSAGE_CAP_CHARS,
  PRODUCER_WINDOW_CAP,
  RECENT_INTERVAL_CAP,
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

  it('chain_reorganized prunes the orphan suffix and lowers the tip', () => {
    let c = emptyChainCache();
    for (let number = 1; number <= 3; number += 1) {
      c = applyChainMutation(c, {
        type: 'block_mined',
        number,
        hash: `0x${number}`,
        tx_count: 1,
        size: 100,
        at: number * 1000,
      });
      c = applyChainMutation(c, {
        type: 'tx_landed',
        tx_hash: `0xtx${number}`,
        block: number,
        at: number * 1000,
        inputs: [],
        outputs: [],
      });
    }

    c = applyChainMutation(c, {
      type: 'chain_reorganized',
      from_block: 2,
    });

    expect(c.tip).toBe(1);
    expect(c.reorgs).toBe(1);
    expect(c.recent_blocks).toEqual([{ number: 1, hash: '0x1' }]);
    expect(c.recent_tx_hashes).toEqual([
      { tx_hash: '0xtx1', block: 1 },
    ]);
    expect(c.recent_block_tx_counts).toEqual([]);
    expect(c.total_blocks).toBe(3);
    expect(c.total_txs).toBe(3);
  });

  it('chain_rebuild clears every canonical ring before bounded replay', () => {
    let c = emptyChainCache();
    for (let number = 10; number <= 12; number += 1) {
      c = applyChainMutation(c, {
        type: 'block_mined',
        number,
        hash: `0xorphan${number}`,
        tx_count: 1,
        size: 100,
        at: number * 1000,
      });
      c = applyChainMutation(c, {
        type: 'tx_landed',
        tx_hash: `0xtx${number}`,
        block: number,
        at: number * 1000,
        inputs: [],
        outputs: [],
      });
    }

    c = applyChainMutation(c, {
      type: 'chain_rebuild',
      from_block: 20,
    });

    expect(c.tip).toBe(19);
    expect(c.reorgs).toBe(1);
    expect(c.recent_blocks).toEqual([]);
    expect(c.recent_tx_hashes).toEqual([]);
    expect(c.recent_block_intervals_ms).toEqual([]);
    expect(c.recent_block_tx_counts).toEqual([]);
    expect(c.recent_block_sizes).toEqual([]);
    expect(c.last_block_ts_ms).toBeNull();
    expect(c.total_blocks).toBe(3);
    expect(c.total_txs).toBe(3);
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

  it('cell_hydration_completed is a no-op (projection metadata only)', () => {
    const before = emptyChainCache();
    const after = applyChainMutation(before, {
      type: 'cell_hydration_completed',
      target: 20_000,
      available: 20_017,
      from_block: 123,
      at_tip: 456,
    });
    expect(after).toBe(before);
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

describe('unknown wire variants', () => {
  // A server ahead of this build (or a projection-only mutation deliberately
  // absent from the TS union) can put a mutation type on the wire that no
  // case here matches. Every reducer in this package owes the same contract:
  // a silent no-op, never a throw and never an undefined cache.
  const future = {
    type: 'from_the_future',
    payload: 7,
  } as unknown as Mutation;

  it('applyChainMutation returns the previous entry untouched', () => {
    const seeded = applyChainMutation(emptyChainCache(), {
      type: 'block_mined',
      number: 5,
      hash: '0xb',
      tx_count: 0,
      at: 1,
    });
    expect(applyChainMutation(seeded, future)).toBe(seeded);
  });

  it('known mutations after an unknown one in the same batch still land', () => {
    const before = emptyChainCache();
    expect(applyRevisionedChainMutations(before, [rm(1, future)])).toBe(before);

    const after = applyRevisionedChainMutations(before, [
      rm(1, future),
      rm(2, { type: 'block_mined', number: 5, hash: '0xb', tx_count: 0, at: 1 }),
    ]);
    expect(after.tip).toBe(5);
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

  it('snapshot_chain.json carries a producer window with its denominator', () => {
    const snap = fixture<ChainEntry>('snapshot_chain.json');
    // The tally, the ring it is a tally OF, and the denominator every share is
    // divided by all describe the same blocks — the whole point of shipping
    // the denominator rather than letting each consumer reconstruct one.
    const counted = snap.producers.reduce((sum, p) => sum + p.blocks, 0);
    expect(snap.producer_window_blocks).toBe(snap.producer_window.length);
    expect(counted).toBe(snap.producer_window_blocks);
    for (const slot of snap.producer_window) {
      expect(snap.producers[slot]).toBeDefined();
    }
  });

  it('the cadence rings are cut at the same window the server cuts them', () => {
    // Twin of `RECENT_INTERVAL_CAP` in `crates/cknerv-core/src/entity.rs`
    // (asserted there by `recent_interval_cap_matches_its_client_mirror`).
    // The snapshot arrives already trimmed to this window and live blocks are
    // trimmed here, so a one-sided retune changes the cadence strip's window
    // partway through a session.
    expect(RECENT_INTERVAL_CAP).toBe(60);
    let chain = emptyChainCache();
    for (let n = 1; n <= RECENT_INTERVAL_CAP + 5; n += 1) {
      chain = applyChainMutation(chain, {
        type: 'block_mined',
        number: n,
        hash: `0xb${n}`,
        tx_count: 1,
        size: 512,
        at: n * 1000,
      });
    }
    expect(chain.recent_block_intervals_ms).toHaveLength(RECENT_INTERVAL_CAP);
    expect(chain.recent_block_tx_counts).toHaveLength(RECENT_INTERVAL_CAP);
    expect(chain.recent_block_sizes).toHaveLength(RECENT_INTERVAL_CAP);
  });

  /** A block that names a producer. */
  const minedBy = (
    number: number,
    key: string,
    message: string,
  ): Mutation => ({
    type: 'block_mined',
    number,
    hash: `0xb${number}`,
    tx_count: 0,
    at: number * 1000,
    producer_key: key,
    producer_message: message,
  });

  /** The window's structural promise, the same one the Rust reducer's tests
   *  assert after every push: the denominator a share is divided by is the
   *  number of blocks the tally actually covers, and each of those blocks is
   *  credited to exactly one producer still in the list. */
  const expectSelfConsistentWindow = (chain: ChainEntry): void => {
    const counted = chain.producers.reduce((sum, p) => sum + p.blocks, 0);
    expect(chain.producer_window_blocks).toBe(chain.producer_window.length);
    expect(counted).toBe(chain.producer_window_blocks);
    for (const slot of chain.producer_window) {
      expect(chain.producers[slot]).toBeDefined();
    }
    for (const p of chain.producers) expect(p.blocks).toBeGreaterThan(0);
  };

  it('the producer window is cut at the same cap the server cuts it', () => {
    // Twin of `PRODUCER_WINDOW_CAP` in `crates/cknerv-core/src/entity.rs`
    // (asserted there by `producer_window_caps_match_their_client_mirror`).
    // A client is handed the chain entity once per connection and then only
    // block_mined deltas, so this reducer owns the window for the rest of the
    // session; a one-sided retune would print one window on the snapshot and a
    // different one a minute later.
    expect(PRODUCER_WINDOW_CAP).toBe(240);
    expect(PRODUCER_MESSAGE_CAP_CHARS).toBe(256);

    let chain = applyChainMutation(
      emptyChainCache(),
      minedBy(1, '0xtransient', 'first and only'),
    );
    expect(chain.producer_window_blocks).toBe(1);
    for (let n = 2; n <= PRODUCER_WINDOW_CAP + 20; n += 1) {
      chain = applyChainMutation(chain, minedBy(n, '0xsteady', '0.209.0'));
    }
    expectSelfConsistentWindow(chain);
    expect(chain.producer_window_blocks).toBe(PRODUCER_WINDOW_CAP);
    // The one-block producer aged out and left with its last block.
    expect(chain.producers).toHaveLength(1);
    expect(chain.producers[0].key).toBe('0xsteady');
    expect(chain.producers[0].blocks).toBe(PRODUCER_WINDOW_CAP);
  });

  it('a block that names nobody enters neither half of the fraction', () => {
    let chain = applyChainMutation(
      emptyChainCache(),
      minedBy(1, '0xminer', '0.209.0'),
    );
    chain = applyChainMutation(chain, {
      type: 'block_mined',
      number: 2,
      hash: '0xb2',
      tx_count: 0,
      at: 2000,
    });
    expectSelfConsistentWindow(chain);
    expect(chain.total_blocks).toBe(2);
    expect(chain.producer_window_blocks).toBe(1);
  });

  it('the last declaration in the window is the one kept, bounded', () => {
    let chain = applyChainMutation(
      emptyChainCache(),
      minedBy(1, '0xminer', '0.209.0 (d166e28 2026-07-29)'),
    );
    chain = applyChainMutation(
      chain,
      minedBy(2, '0xminer', '0.209.0 (d166e28 2026-07-29) bpool'),
    );
    expect(chain.producers).toHaveLength(1);
    expect(chain.producers[0].blocks).toBe(2);
    expect(chain.producers[0].message).toBe('0.209.0 (d166e28 2026-07-29) bpool');
    expect(chain.producers[0].last_seen_ms).toBe(2000);

    // Free-form bytes any miner on the network writes: bounded here exactly as
    // the Rust reducer bounds them, cut on a character and marked as clipped.
    chain = applyChainMutation(
      chain,
      minedBy(3, '0xloud', '\u5b57'.repeat(PRODUCER_MESSAGE_CAP_CHARS + 5)),
    );
    const loud = chain.producers.find((p) => p.key === '0xloud');
    expect(loud).toBeDefined();
    expect(Array.from(loud?.message ?? '')).toHaveLength(
      PRODUCER_MESSAGE_CAP_CHARS + 1,
    );
    expect(loud?.message.endsWith(DATA_HEX_TRUNCATION_MARKER)).toBe(true);
  });

  it('every reorg path drops the producer window with the other rings', () => {
    const invalidations: Mutation[] = [
      { type: 'chain_reorganized', from_block: 2 },
      { type: 'chain_rebuild', from_block: 2 },
      // A replacement block at a number already seen with another hash.
      {
        type: 'block_mined',
        number: 2,
        hash: '0xreplacement2',
        tx_count: 0,
        at: 2500,
      },
    ];
    for (const invalidate of invalidations) {
      let chain = applyChainMutation(
        emptyChainCache(),
        minedBy(1, '0xminer', '0.209.0'),
      );
      chain = applyChainMutation(chain, minedBy(2, '0xminer', '0.209.0'));
      expect(chain.producer_window_blocks).toBe(2);

      chain = applyChainMutation(chain, invalidate);
      expectSelfConsistentWindow(chain);
      expect(chain.producer_window_blocks).toBe(0);
      expect(chain.producers).toEqual([]);

      chain = applyChainMutation(chain, minedBy(3, '0xreplacer', '0.209.0'));
      expectSelfConsistentWindow(chain);
      expect(chain.producer_window_blocks).toBe(1);
    }
  });

  it('folding a producer into the window never mutates the previous cache', () => {
    const seeded = applyChainMutation(
      emptyChainCache(),
      minedBy(1, '0xminer', '0.209.0'),
    );
    const before = JSON.parse(JSON.stringify(seeded)) as ChainEntry;
    const after = applyChainMutation(seeded, minedBy(2, '0xminer', '0.209.0'));
    expect(seeded).toEqual(before);
    expect(seeded.producers[0].blocks).toBe(1);
    expect(after.producers[0].blocks).toBe(2);
    expect(after.producers).not.toBe(seeded.producers);
    expect(after.producers[0]).not.toBe(seeded.producers[0]);
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

  /** `backfill_progress` is on the entity wire and deliberately NOT in this
   *  reducer: the SPA reads replay progress off the cells projection stream
   *  (`CellDelta.backfill`). The silence is the design, so pin it — the
   *  `default:` arm that produces it is the same arm a genuinely new variant
   *  would fall into, and the only thing separating "correctly ignored" from
   *  "silently swallowed" is a test that says which one this is. */
  it('ignores backfill_progress without touching the chain entry', () => {
    const samples = fixture<Record<string, Mutation>>('mutation_samples.json');
    const before = emptyChainCache();
    const sample = samples.BackfillProgress;
    expect((sample as unknown as { type: string }).type).toBe('backfill_progress');
    // Identity, not merely equality: a no-op must not even clone.
    expect(applyChainMutation(before, sample)).toBe(before);
  });
});

describe('ring identity preservation', () => {
  function seeded(): ChainEntry {
    let c = applyChainMutation(emptyChainCache(), {
      type: 'block_mined', number: 1, hash: '0xb1', tx_count: 2, at: 1_000,
    });
    c = applyChainMutation(c, {
      type: 'tx_landed', tx_hash: '0xt1', block: 1, at: 1_100, inputs: [], outputs: [],
    });
    return c;
  }

  it('sync/mempool-only batches keep every ring identity', () => {
    const prev = seeded();
    const next = applyRevisionedChainMutations(prev, [
      rm(10, { type: 'chain_sync_updated', ibd: false, best_known_block: 7 }),
      rm(11, {
        type: 'chain_mempool_updated',
        pending: 1, proposed: 0, orphan: 0,
        total_tx_size: 100, total_tx_cycles: 10, min_fee_rate: 1000,
      }),
    ]);
    expect(next).not.toBe(prev);
    expect(next.best_known_block).toBe(7);
    expect(next.recent_blocks).toBe(prev.recent_blocks);
    expect(next.recent_tx_hashes).toBe(prev.recent_tx_hashes);
    expect(next.recent_block_intervals_ms).toBe(prev.recent_block_intervals_ms);
    expect(next.recent_block_tx_counts).toBe(prev.recent_block_tx_counts);
    expect(next.recent_block_sizes).toBe(prev.recent_block_sizes);
  });

  it('tx_landed copies only the tx ring', () => {
    const prev = seeded();
    const next = applyRevisionedChainMutations(prev, [
      rm(12, { type: 'tx_landed', tx_hash: '0xt2', block: 1, at: 1_200, inputs: [], outputs: [] }),
    ]);
    expect(next.recent_tx_hashes).not.toBe(prev.recent_tx_hashes);
    expect(prev.recent_tx_hashes).toHaveLength(1); // prev untouched
    expect(next.recent_tx_hashes).toHaveLength(2);
    expect(next.recent_blocks).toBe(prev.recent_blocks);
    expect(next.recent_block_intervals_ms).toBe(prev.recent_block_intervals_ms);
    expect(next.recent_block_tx_counts).toBe(prev.recent_block_tx_counts);
    expect(next.recent_block_sizes).toBe(prev.recent_block_sizes);
  });

  it('block_mined leaves the tx ring identity untouched and never leaks into prev', () => {
    const prev = seeded();
    const prevBlocks = prev.recent_blocks.slice();
    const next = applyRevisionedChainMutations(prev, [
      rm(13, { type: 'block_mined', number: 2, hash: '0xb2', tx_count: 1, at: 2_000 }),
    ]);
    expect(next.recent_tx_hashes).toBe(prev.recent_tx_hashes);
    expect(next.recent_blocks).not.toBe(prev.recent_blocks);
    expect(prev.recent_blocks).toEqual(prevBlocks); // prev untouched
    expect(next.recent_block_intervals_ms).not.toBe(prev.recent_block_intervals_ms);
    expect(next.recent_block_intervals_ms).toEqual([1_000]);
  });
});
