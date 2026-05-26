// Pure reducer over chain-generic `Mutation` values — TS twin of the
// chain-relevant branches of simulator's `DashboardState::apply_mutation`.
//
// Lifted from `simulator/ui/src/cache/entities.ts`; the entity-side
// reducer that handles RCG mutations (components, composers, OTs,
// ckbloom peer-id) stays in simulator. This module only knows about
// chain mutations and the singleton `ChainEntry`.

import type { ChainEntry, Mutation, RevisionedMutation } from '@cknerv/types';

/** Construct a fresh, empty chain-entity cache. */
export function emptyChainCache(): ChainEntry {
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
  };
}

/** Shallow-clone the chain entry. Used internally so the reducer never
 *  mutates its input. The 4 ring arrays are sliced so writes in
 *  `applyToChain` don't leak into the caller. */
function cloneChain(c: ChainEntry): ChainEntry {
  return {
    ...c,
    recent_blocks: c.recent_blocks.slice(),
    recent_tx_hashes: c.recent_tx_hashes.slice(),
    recent_block_intervals_ms: c.recent_block_intervals_ms.slice(),
    recent_block_tx_counts: c.recent_block_tx_counts.slice(),
  };
}

/** True iff this mutation needs a chain-table change. `cell_tagged` is
 *  projection-only and produces no entity-table side effect. */
function touchesChain(m: Mutation): boolean {
  switch (m.type) {
    case 'block_mined':
    case 'tx_landed':
    case 'chain_mempool_updated':
    case 'chain_info_updated':
      return true;
    case 'cell_tagged':
      return false;
    default: {
      const _exhaustive: never = m;
      void _exhaustive;
      return false;
    }
  }
}

/** In-place mutation; caller is responsible for cloning before calling. */
function applyToChain(chain: ChainEntry, m: Mutation): void {
  switch (m.type) {
    case 'block_mined': {
      if (m.number > chain.tip) chain.tip = m.number;
      const exactDup = chain.recent_blocks.some(
        (b) => b.number === m.number && b.hash === m.hash,
      );
      const reorg =
        !exactDup &&
        chain.recent_blocks.some(
          (b) => b.number === m.number && b.hash !== m.hash,
        );
      if (!exactDup) {
        chain.total_blocks += 1;
        if (reorg) chain.reorgs += 1;
        const prevTs = chain.last_block_ts_ms ?? null;
        if (prevTs !== null && m.at >= prevTs) {
          chain.recent_block_intervals_ms.push(m.at - prevTs);
          while (chain.recent_block_intervals_ms.length > 60) {
            chain.recent_block_intervals_ms.shift();
          }
        }
        chain.last_block_ts_ms = m.at;
        chain.recent_block_tx_counts.push(m.tx_count);
        while (chain.recent_block_tx_counts.length > 60) {
          chain.recent_block_tx_counts.shift();
        }
      }
      chain.recent_blocks.push({ number: m.number, hash: m.hash });
      while (chain.recent_blocks.length > 50) chain.recent_blocks.shift();
      return;
    }
    case 'tx_landed': {
      chain.total_txs += 1;
      chain.recent_tx_hashes.push({ tx_hash: m.tx_hash, block: m.block });
      while (chain.recent_tx_hashes.length > 50) chain.recent_tx_hashes.shift();
      return;
    }
    case 'chain_mempool_updated': {
      chain.mempool = {
        pending: m.pending,
        proposed: m.proposed,
        orphan: m.orphan,
        total_tx_size: m.total_tx_size,
        total_tx_cycles: m.total_tx_cycles,
        min_fee_rate: m.min_fee_rate,
      };
      return;
    }
    case 'chain_info_updated': {
      chain.epoch = { ...m.epoch };
      chain.median_time_ms = m.median_time_ms;
      chain.difficulty = m.difficulty;
      chain.chain_name = m.chain_name;
      return;
    }
    case 'cell_tagged': {
      // projection-only; no chain-table update
      return;
    }
    default: {
      const _exhaustive: never = m;
      void _exhaustive;
      return;
    }
  }
}

/** Apply a single chain mutation to a chain-entity cache, returning the
 *  new cache. **Pure**: never mutates `prev`. */
export function applyChainMutation(
  prev: ChainEntry,
  m: Mutation,
): ChainEntry {
  if (!touchesChain(m)) return prev;
  const next = cloneChain(prev);
  applyToChain(next, m);
  return next;
}

/** Apply a sequence of revisioned chain mutations. Lazy-clones the chain
 *  on the first touch and reuses the clone across the batch — single
 *  shallow copy per batch, never per-mutation. */
export function applyRevisionedChainMutations(
  prev: ChainEntry,
  rms: RevisionedMutation[],
): ChainEntry {
  if (rms.length === 0) return prev;
  let chain: ChainEntry | null = null;
  for (const rm of rms) {
    if (!touchesChain(rm.mutation)) continue;
    if (chain === null) chain = cloneChain(prev);
    applyToChain(chain, rm.mutation);
  }
  return chain ?? prev;
}
