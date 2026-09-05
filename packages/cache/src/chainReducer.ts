// Pure reducer over chain-generic `Mutation` values — TS twin of the
// chain-relevant branches of simulator's `DashboardState::apply_mutation`.
//
// Lifted from `simulator/ui/src/cache/entities.ts`; the entity-side
// reducer that handles RCG mutations (components, composers, OTs,
// ckbloom peer-id) stays in simulator. This module only knows about
// chain mutations and the singleton `ChainEntry`.

import { DATA_HEX_TRUNCATION_MARKER } from '@cknerv/types';
import type {
  BlockProducer,
  ChainEntry,
  Mutation,
  RevisionedMutation,
} from '@cknerv/types';

/** How many recent blocks the three cadence rings keep. Twin of
 *  `RECENT_INTERVAL_CAP` in `crates/cknerv-core/src/entity.rs`, which trims
 *  the same rings server-side: the snapshot arrives already cut to this
 *  window and every block after it is cut here, so a drift between the two
 *  would silently change the cadence strip's window mid-session. */
export const RECENT_INTERVAL_CAP = 60;

/** How many attributed blocks the producer tally counts. Twin of
 *  `PRODUCER_WINDOW_CAP` in `crates/cknerv-core/src/entity.rs`, and it has to
 *  stay one number for the same reason the cadence cap does: the snapshot
 *  arrives cut to this window and every block after it is cut here. Far wider
 *  than the cadence rings on purpose — cadence is a per-block fact, a share is
 *  a distribution, and a distribution over 60 blocks is mostly noise. */
export const PRODUCER_WINDOW_CAP = 240;

/** Cap on a retained `BlockProducer.message`, in Unicode scalar values. Twin
 *  of `PRODUCER_MESSAGE_CAP_CHARS` in `crates/cknerv-core/src/entity.rs`.
 *  Characters rather than bytes so this reducer and the Rust one can agree
 *  exactly without either doing UTF-8 boundary arithmetic. */
export const PRODUCER_MESSAGE_CAP_CHARS = 256;

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
    last_reorg_depth: 0,
    recent_block_intervals_ms: [],
    recent_block_tx_counts: [],
    recent_block_sizes: [],
    last_block_ts_ms: null,
    ibd: false,
    best_known_block: 0,
    producers: [],
    producer_window: [],
    producer_window_blocks: 0,
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

/** The bounded history rings on `ChainEntry` — arrays of values, for which a
 *  `slice()` is a complete copy. */
type ChainRingKey =
  | 'recent_blocks'
  | 'recent_tx_hashes'
  | 'recent_block_intervals_ms'
  | 'recent_block_tx_counts'
  | 'recent_block_sizes'
  | 'producer_window';

/** Everything the batch's copy-on-write ledger tracks. `producers` is in here
 *  but deliberately NOT a `ChainRingKey`: a `slice()` of it would still hand
 *  the previous cache's row objects to the writer, so it has its own guard and
 *  the type stops it from being copied the shallow way by mistake. */
type ChainOwnedKey = ChainRingKey | 'producers';

/** Copy-on-write guard for in-place ring mutation (push/shift). Replacing a
 *  ring with a fresh array (filter / `[]`) must instead mark it via
 *  `ringReplaced` so a later push in the same batch skips the redundant copy. */
function ownRing(
  chain: ChainEntry,
  key: ChainRingKey,
  owned: Set<ChainOwnedKey>,
): void {
  if (owned.has(key)) return;
  owned.add(key);
  (chain[key] as unknown[]) = (chain[key] as unknown[]).slice();
}

function ringReplaced(owned: Set<ChainOwnedKey>, ...keys: ChainOwnedKey[]): void {
  for (const key of keys) owned.add(key);
}

/** Copy-on-write guard for `producers`. Its ROWS are mutated in place (a
 *  block bumps one producer's count), so unlike the number rings a `slice()`
 *  would still hand the previous cache's objects to the writer. Each row is
 *  copied once per batch; the list is six rows on mainnet. */
function ownProducers(chain: ChainEntry, owned: Set<ChainOwnedKey>): void {
  if (owned.has('producers')) return;
  owned.add('producers');
  chain.producers = chain.producers.map((p) => ({ ...p }));
}

/** Twin of `cap_declared_message` in `crates/cknerv-server/src/state.rs`.
 *  The declaration is free-form bytes any miner writes into its own block, so
 *  it arrives bounded with the same single-character marker `data_hex` uses —
 *  a clipped message must never read as a short one. */
function capDeclaredMessage(message: string): string {
  const chars = Array.from(message);
  if (chars.length <= PRODUCER_MESSAGE_CAP_CHARS) return message;
  return (
    chars.slice(0, PRODUCER_MESSAGE_CAP_CHARS).join('') +
    DATA_HEX_TRUNCATION_MARKER
  );
}

/** Drop the producer window. Called wherever the three cadence rings are
 *  cleared, and for the same reason: a reorg abandons a canonical suffix, and
 *  a share measured over it is not a share of this chain. `producer_window_blocks`
 *  rides the wire, so a window that restarts at 1 says so rather than quietly
 *  counting blocks the chain no longer has. */
function clearProducerWindow(chain: ChainEntry, owned: Set<ChainOwnedKey>): void {
  chain.producers = [];
  chain.producer_window = [];
  chain.producer_window_blocks = 0;
  ringReplaced(owned, 'producers', 'producer_window');
}

/** Fold one attributed block into the rolling producer window — twin of
 *  `record_block_producer` in `crates/cknerv-server/src/state.rs`, and it has
 *  to stay a twin: the server cuts the snapshot with its copy and this one
 *  cuts every block after it.
 *
 *  The window is the last `PRODUCER_WINDOW_CAP` blocks THAT NAMED A PRODUCER.
 *  A block the adapter could not attribute takes no slot and moves no
 *  denominator — the caller simply does not call this — which keeps
 *  `sum(producers[].blocks) === producer_window.length === producer_window_blocks`
 *  exactly true, so a share can never be divided by a window it was not
 *  measured over. */
function recordBlockProducer(
  chain: ChainEntry,
  key: string,
  message: string,
  at: number,
  owned: Set<ChainOwnedKey>,
): void {
  ownProducers(chain, owned);
  ownRing(chain, 'producer_window', owned);

  let index = chain.producers.findIndex((p) => p.key === key);
  if (index === -1) {
    chain.producers.push({ key, message: '', blocks: 0, last_seen_ms: 0 });
    index = chain.producers.length - 1;
  }

  const row = chain.producers[index];
  row.blocks += 1;
  // A producer may declare something different on every block; the last
  // declaration inside the window is the one kept.
  row.message = capDeclaredMessage(message);
  row.last_seen_ms = at;
  chain.producer_window.push(index);

  while (chain.producer_window.length > PRODUCER_WINDOW_CAP) {
    const evicted = chain.producer_window.shift() as number;
    chain.producers[evicted].blocks -= 1;
  }

  // A producer with nothing left in the window is not in the window. Dropping
  // its row renumbers every row after it, so the ring is remapped in the same
  // pass — the two are one edit and must never become two.
  if (chain.producers.some((p) => p.blocks === 0)) {
    const remap = new Array<number>(chain.producers.length).fill(0);
    const kept: BlockProducer[] = [];
    chain.producers.forEach((producer, old) => {
      if (producer.blocks === 0) return;
      remap[old] = kept.length;
      kept.push(producer);
    });
    chain.producers = kept;
    chain.producer_window = chain.producer_window.map((slot) => remap[slot]);
  }

  chain.producer_window_blocks = chain.producer_window.length;
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

/**
 * How many blocks a re-org orphaned.
 *
 * The wire says WHERE the replacement suffix starts (`from_block`); the depth
 * is how much of what we had is being thrown away, which is every block from
 * there to the tip inclusive. So a single replaced block — by far the common
 * case, and the only one the old `reorgs - previous` delta could ever report —
 * is depth ONE, not zero: the ramp's rungs are counts of orphaned blocks, and
 * a reorg that orphaned nothing is not a reorg.
 *
 * Floored at 1 for the same reason. A `from_block` past our own tip means the
 * server saw a fork on a suffix we had not received yet; nothing of ours is
 * orphaned, but a reorg still happened and the HUD may not be told "0".
 */
function reorgDepth(tip: number, fromBlock: number): number {
  return Math.max(1, tip - fromBlock + 1);
}

/** In-place mutation; caller is responsible for cloning before calling and
 *  supplies the batch's copy-on-write ring ledger. */
function applyToChain(
  chain: ChainEntry,
  m: Mutation,
  owned: Set<ChainOwnedKey>,
): void {
  switch (m.type) {
    case 'chain_reorganized': {
      const canonicalTip = m.from_block === 0 ? 0 : m.from_block - 1;
      chain.last_reorg_depth = reorgDepth(chain.tip, m.from_block);
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
      clearProducerWindow(chain, owned);
      return;
    }
    case 'chain_rebuild': {
      // A rebuild counts in `reorgs`, so it measures its depth the same way.
      // The two are one fact wearing two words: the server is discarding a
      // suffix, and how long that suffix was is the reader's business whether
      // the discard came from a fork or from a memory reset.
      chain.last_reorg_depth = reorgDepth(chain.tip, m.from_block);
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
      clearProducerWindow(chain, owned);
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
        clearProducerWindow(chain, owned);
      } else if (m.number > chain.tip) {
        chain.tip = m.number;
      }
      chain.total_blocks += 1;
      if (reorg) {
        // One block arriving at a height we already hold with another hash:
        // exactly one block orphaned, and the tip was that height.
        chain.last_reorg_depth = 1;
        chain.reorgs += 1;
      }
      const prevTs = chain.last_block_ts_ms ?? null;
      if (prevTs !== null && m.at >= prevTs) {
        ownRing(chain, 'recent_block_intervals_ms', owned);
        chain.recent_block_intervals_ms.push(m.at - prevTs);
        while (chain.recent_block_intervals_ms.length > RECENT_INTERVAL_CAP) {
          chain.recent_block_intervals_ms.shift();
        }
      }
      chain.last_block_ts_ms = m.at;
      ownRing(chain, 'recent_block_tx_counts', owned);
      chain.recent_block_tx_counts.push(m.tx_count);
      while (chain.recent_block_tx_counts.length > RECENT_INTERVAL_CAP) {
        chain.recent_block_tx_counts.shift();
      }
      ownRing(chain, 'recent_block_sizes', owned);
      chain.recent_block_sizes.push(m.size ?? 0);
      while (chain.recent_block_sizes.length > RECENT_INTERVAL_CAP) {
        chain.recent_block_sizes.shift();
      }
      ownRing(chain, 'recent_blocks', owned);
      chain.recent_blocks.push({ number: m.number, hash: m.hash });
      while (chain.recent_blocks.length > 50) chain.recent_blocks.shift();
      // The key is the identity; the declared message is decoration the
      // producer wrote about itself. The adapter reads both from one witness
      // and sends them together, but a frame carrying only a key still names a
      // producer — losing the attribution over a missing decoration would be
      // the wrong half to keep.
      if (m.producer_key) {
        recordBlockProducer(
          chain,
          m.producer_key,
          m.producer_message ?? '',
          m.at,
          owned,
        );
      }
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
  const owned = new Set<ChainOwnedKey>();
  for (const rm of rms) {
    if (!touchesChain(rm.mutation)) continue;
    if (chain === null) chain = cloneChain(prev);
    applyToChain(chain, rm.mutation, owned);
  }
  return chain ?? prev;
}
