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
