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
    recent_block_sizes: [],
    last_block_ts_ms: null,
    ibd: false,
    best_known_block: 0,
  };
}

/** Shallow-clone the chain entry. The 5 ring arrays stay ALIASED to the
 *  previous cache on purpose: consumers memoize on ring identity (e.g. the
 *  cadence ECG on `recent_block_intervals_ms`), so a mempool/sync-only batch
 *  must not hand them fresh-but-equal arrays. Every in-place ring write in
 *  `applyToChain` goes through `ownRing` below, which copies each ring at
 *  most once per batch before the first write. */
function cloneChain(c: ChainEntry): ChainEntry {
  return { ...c };
}

/** The five bounded history rings on `ChainEntry`. */
type ChainRingKey =
  | 'recent_blocks'
  | 'recent_tx_hashes'
  | 'recent_block_intervals_ms'
  | 'recent_block_tx_counts'
  | 'recent_block_sizes';

/** Copy-on-write guard for in-place ring mutation (push/shift). Replacing a
 *  ring with a fresh array (filter / `[]`) must instead mark it via
 *  `ringReplaced` so a later push in the same batch skips the redundant copy. */
function ownRing(
  chain: ChainEntry,
  key: ChainRingKey,
  owned: Set<ChainRingKey>,
): void {
  if (owned.has(key)) return;
  owned.add(key);
  (chain[key] as unknown[]) = (chain[key] as unknown[]).slice();
}

function ringReplaced(owned: Set<ChainRingKey>, ...keys: ChainRingKey[]): void {
  for (const key of keys) owned.add(key);
}

/** True iff this mutation needs a chain-table change. `cell_tagged` and
 *  `cell_hydration_completed` are projection-only and produce no entity-table
 *  side effect.
 *  `chain_node_registered` updates `EntityStore.chain_nodes` (a separate
 *  slice from `ChainEntry`); this reducer is `ChainEntry`-only so it
 *  reports false here. Consumers maintaining the chain-nodes list
 *  handle the variant in a sibling reducer. */
function touchesChain(m: Mutation): boolean {
  switch (m.type) {
    case 'block_mined':
    case 'chain_reorganized':
    case 'chain_rebuild':
    case 'tx_landed':
    case 'chain_mempool_updated':
    case 'chain_info_updated':
    case 'chain_sync_updated':
      return true;
    case 'cell_tagged':
    case 'cell_hydration_completed':
    case 'chain_node_registered':
    case 'peers_updated':
    case 'chain_node_info_updated':
      return false;
    default: {
      // Projection-only mutations (e.g. `backfill_progress`) ride the chain
      // mutation broadcast but are intentionally absent from the TS chain
      // `Mutation` union. This arm must stay a safe no-op (never throw) so
      // such frames are ignored at runtime rather than crashing boot.
      const _exhaustive: never = m;
      void _exhaustive;
      return false;
    }
  }
}

/** In-place mutation; caller is responsible for cloning before calling and
 *  supplies the batch's copy-on-write ring ledger. */
function applyToChain(
  chain: ChainEntry,
  m: Mutation,
  owned: Set<ChainRingKey>,
): void {
  switch (m.type) {
    case 'chain_reorganized': {
      const canonicalTip = m.from_block === 0 ? 0 : m.from_block - 1;
      chain.tip = Math.min(chain.tip, canonicalTip);
      chain.reorgs += 1;
      chain.recent_blocks = chain.recent_blocks.filter(
        (block) => block.number < m.from_block,
      );
      chain.recent_tx_hashes = chain.recent_tx_hashes.filter(
        (tx) => tx.block < m.from_block,
      );
      // These rings do not carry block numbers, so retaining them could mix
      // orphan timing/throughput samples with the replacement suffix.
      chain.recent_block_intervals_ms = [];
      chain.recent_block_tx_counts = [];
      chain.recent_block_sizes = [];
      chain.last_block_ts_ms = null;
      ringReplaced(
        owned,
        'recent_blocks',
        'recent_tx_hashes',
        'recent_block_intervals_ms',
        'recent_block_tx_counts',
        'recent_block_sizes',
      );
      return;
    }
    case 'chain_rebuild': {
      chain.tip = m.from_block === 0 ? 0 : m.from_block - 1;
      chain.reorgs += 1;
      chain.recent_blocks = [];
      chain.recent_tx_hashes = [];
      chain.recent_block_intervals_ms = [];
      chain.recent_block_tx_counts = [];
      chain.recent_block_sizes = [];
      chain.last_block_ts_ms = null;
      ringReplaced(
        owned,
        'recent_blocks',
        'recent_tx_hashes',
        'recent_block_intervals_ms',
        'recent_block_tx_counts',
        'recent_block_sizes',
      );
      return;
    }
    case 'block_mined': {
      const exactDup = chain.recent_blocks.some(
        (b) => b.number === m.number && b.hash === m.hash,
      );
      const reorg =
        !exactDup &&
        chain.recent_blocks.some(
          (b) => b.number === m.number && b.hash !== m.hash,
        );
      if (exactDup) return;
      if (reorg) {
        chain.tip = m.number;
        chain.recent_blocks = chain.recent_blocks.filter(
          (block) => block.number < m.number,
        );
        chain.recent_tx_hashes = chain.recent_tx_hashes.filter(
          (tx) => tx.block < m.number,
        );
        chain.recent_block_intervals_ms = [];
        chain.recent_block_tx_counts = [];
        chain.recent_block_sizes = [];
        chain.last_block_ts_ms = null;
        ringReplaced(
          owned,
          'recent_blocks',
          'recent_tx_hashes',
          'recent_block_intervals_ms',
          'recent_block_tx_counts',
          'recent_block_sizes',
        );
      } else if (m.number > chain.tip) {
        chain.tip = m.number;
      }
      chain.total_blocks += 1;
      if (reorg) chain.reorgs += 1;
      const prevTs = chain.last_block_ts_ms ?? null;
      if (prevTs !== null && m.at >= prevTs) {
        ownRing(chain, 'recent_block_intervals_ms', owned);
        chain.recent_block_intervals_ms.push(m.at - prevTs);
        while (chain.recent_block_intervals_ms.length > 60) {
          chain.recent_block_intervals_ms.shift();
        }
      }
      chain.last_block_ts_ms = m.at;
      ownRing(chain, 'recent_block_tx_counts', owned);
      chain.recent_block_tx_counts.push(m.tx_count);
      while (chain.recent_block_tx_counts.length > 60) {
        chain.recent_block_tx_counts.shift();
      }
      ownRing(chain, 'recent_block_sizes', owned);
      chain.recent_block_sizes.push(m.size ?? 0);
      while (chain.recent_block_sizes.length > 60) {
        chain.recent_block_sizes.shift();
      }
      ownRing(chain, 'recent_blocks', owned);
      chain.recent_blocks.push({ number: m.number, hash: m.hash });
      while (chain.recent_blocks.length > 50) chain.recent_blocks.shift();
      return;
    }
    case 'tx_landed': {
      chain.total_txs += 1;
      ownRing(chain, 'recent_tx_hashes', owned);
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
    case 'cell_hydration_completed': {
      // cell-galaxy persistence metadata only
      return;
    }
    case 'chain_node_registered': {
      // chain-nodes list lives on EntityStore (a separate slice from
      // ChainEntry); this reducer is ChainEntry-only and treats it as
      // a no-op.
      return;
    }
    case 'chain_sync_updated': {
      chain.ibd = m.ibd;
      chain.best_known_block = m.best_known_block;
      return;
    }
    case 'peers_updated':
    case 'chain_node_info_updated': {
      // chain-nodes / peers live on ChainCache (entityStream), not on
      // ChainEntry; no-op here.
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
  applyToChain(next, m, new Set());
  return next;
}

/** Apply a sequence of revisioned chain mutations. Lazy-clones the chain
 *  on the first touch and reuses the clone across the batch — single
 *  shallow copy per batch, never per-mutation. Rings copy on first write
 *  only, so untouched rings keep their previous identity. */
export function applyRevisionedChainMutations(
  prev: ChainEntry,
  rms: RevisionedMutation[],
): ChainEntry {
  if (rms.length === 0) return prev;
  let chain: ChainEntry | null = null;
  const owned = new Set<ChainRingKey>();
  for (const rm of rms) {
    if (!touchesChain(rm.mutation)) continue;
    if (chain === null) chain = cloneChain(prev);
    applyToChain(chain, rm.mutation, owned);
  }
  return chain ?? prev;
}
