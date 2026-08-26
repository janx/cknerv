// Chain-generic entity wire types — TS mirror of `cknerv-core::entity`.
//
// Field shape is byte-stable with the Rust snapshot serializer; the
// fixture in `tests/fixtures/snapshot_chain.json` pins the shape on
// both sides.

export interface RecentBlock {
  number: number;
  hash: string;
}

export interface RecentTx {
  tx_hash: string;
  block: number;
}

export interface MempoolStats {
  pending: number;
  proposed: number;
  orphan: number;
  total_tx_size: number;
  total_tx_cycles: number;
  min_fee_rate: number;
}

export interface EpochInfo {
  number: number;
  index: number;
  length: number;
}

/** One distinct block producer inside `ChainEntry`'s rolling window — TS twin
 *  of `cknerv-core::BlockProducer`.
 *
 *  Chain-generic: `key` is whatever opaque identity the source adapter put on
 *  `BlockMined`. Group and count by it; never parse it. */
export interface BlockProducer {
  key: string;
  /** What this producer declared on its most recent block IN THE WINDOW.
   *  Self-declared and trivially spoofable — render it as a claim, not as a
   *  measurement. A producer may declare something different on every block
   *  and the last one in the window wins. A bounded prefix: longer than
   *  `PRODUCER_MESSAGE_CAP_CHARS` and it ends in `DATA_HEX_TRUNCATION_MARKER`.
   *  `''` when the producer declared nothing readable. */
  message: string;
  /** Blocks of the window this producer holds — the numerator of its share.
   *  The denominator is `ChainEntry.producer_window_blocks`, never
   *  `producers.length` and never the cap. */
  blocks: number;
  /** Envelope timestamp of this producer's most recent block in the window. */
  last_seen_ms: number;
}

export interface ChainEntry {
  tip: number;
  recent_blocks: RecentBlock[];
  recent_tx_hashes: RecentTx[];
  /** Cumulative block count since boot — uncapped, unlike
   *  recent_blocks.length which is bounded by the recent-ring window. */
  total_blocks: number;
  /** Cumulative TxLanded count since boot. */
  total_txs: number;
  /** Latest mempool snapshot (`tx_pool_info`) from the canonical miner node. */
  mempool: MempoolStats;
  /** Latest epoch from `get_blockchain_info`. */
  epoch: EpochInfo;
  median_time_ms: number;
  difficulty: string;
  chain_name: string;
  /** Block re-orgs observed since boot (number-with-different-hash collisions). */
  reorgs: number;
  /** ms intervals between consecutive blocks (capped on the backend). Drives
   *  the "INTERVAL avg / last" HUD readout. */
  recent_block_intervals_ms: number[];
  /** Per-block tx counts (parallel to recent_block_intervals_ms). Drives
   *  pulse telemetry. */
  recent_block_tx_counts: number[];
  /** Per-block serialized sizes (bytes), parallel to recent_block_tx_counts. */
  recent_block_sizes: number[];
  /** Wall-clock ms of the latest BlockMined envelope (omitted until first block). */
  last_block_ts_ms?: number | null;
  /** True while the node is in initial-block-download (`sync_state.ibd`). */
  ibd: boolean;
  /** Network best-known block height (`sync_state.best_known_block_number`). */
  best_known_block: number;
  /** Distinct producers of the blocks in `producer_window`, in the order they
   *  first appear in it. A materialized tally over the window below. */
  producers: BlockProducer[];
  /** The window itself: one entry per block in it, oldest first, each an index
   *  into `producers`. Capped at `PRODUCER_WINDOW_CAP`.
   *
   *  Membership is ATTRIBUTED BLOCKS ONLY — a block whose producer the adapter
   *  could not read takes no slot and is counted in no share, which keeps
   *  `sum(producers[].blocks) === producer_window_blocks` exactly true.
   *
   *  The ring is on the wire because this cache maintains the same window the
   *  server does, from the same `block_mined` deltas, and a client sees the
   *  chain entity once per connection. Evicting the oldest block from a tally
   *  means knowing which producer made it, which a tally cannot say. */
  producer_window: number[];
  /** How many blocks `producers` actually counts — the denominator of every
   *  share, carried so no consumer has to reconstruct it. Below the cap the
   *  whole time the window is warming, and zero after a reorg drops it. */
  producer_window_blocks: number;
}

/** One chain endpoint cknerv is observing. 0..N: mainnet single RPC = 1,
 *  mesh / multi-node = N. The list shape lets downstream adapters tag
 *  per-node provenance on `BlockMined` / `TxRelayed` mutations later. */
export interface ChainNode {
  id: string;
  label: string;
  is_miner: boolean;
  /** Client version of the observed node. */
  version: string;
  /** Active peer connection count. */
  connections: number;
  /** How the network knows this node: its own base58 peer id
   *  (`local_node_info.node_id`), the same vocabulary every `Peer.node_id`
   *  is written in. `id` above is cknerv's local key for the endpoint and
   *  means nothing outside the server. Omitted by a node that reported no
   *  identity, and by every server older than this field. */
  p2p_node_id?: string | null;
}

export type PeerDirection = 'inbound' | 'outbound';

/** One real P2P peer of the observed node — TS twin of `cknerv-core::Peer`. */
export interface Peer {
  node_id: string;
  addr: string;
  direction: PeerDirection;
  version: string;
  /** Last-ping round-trip latency (ms); omitted until first ping. */
  latency_ms?: number | null;
  /** Peer best-known header height; omitted if unknown. */
  best_known?: number | null;
  connected_ms: number;
}
