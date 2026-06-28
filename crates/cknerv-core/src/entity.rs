//! Chain-generic entity types.
//!
//! `Chain` is the singleton chain-state entity carried in cknerv's snapshot
//! frames. Field names + JSON shape mirror what the simulator emitted from
//! its post-Phase-A `DashboardState::chain` serializer (see
//! `simulator/src/dashboard/state.rs` ChainEntry → JSON conversion). The
//! wire-shape fixtures in `tests/fixtures/snapshot_chain.json` pin this.
//!
//! Notable wire differences vs the simulator's in-memory `ChainEntry`:
//! - `recent_blocks` is a `Vec<RecentBlock>` (named struct) here, where
//!   simulator stored a `VecDeque<(u64, String)>` and translated to
//!   `{number, hash}` objects in its custom JSON serializer. The wire
//!   shape matches; the in-memory shape is friendlier for cknerv consumers
//!   that don't need the eviction-ring discipline.
//! - `recent_tx_hashes` similarly becomes `Vec<RecentTx>` with the same
//!   `{tx_hash, block}` JSON keys the simulator emitted.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct MempoolStats {
    #[serde(default)]
    pub pending: u64,
    #[serde(default)]
    pub proposed: u64,
    #[serde(default)]
    pub orphan: u64,
    #[serde(default)]
    pub total_tx_size: u64,
    #[serde(default)]
    pub total_tx_cycles: u64,
    #[serde(default)]
    pub min_fee_rate: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct EpochInfo {
    pub number: u64,
    pub index: u64,
    pub length: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecentBlock {
    pub number: u64,
    pub hash: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecentTx {
    pub tx_hash: String,
    pub block: u64,
}

/// One chain endpoint cknerv is observing. 0..N: mainnet single RPC = 1,
/// mesh / multi-node = N. The list shape lets downstream adapters tag
/// per-node provenance on `BlockMined` / `TxRelayed` mutations later.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChainNode {
    pub id: String,
    pub label: String,
    pub is_miner: bool,
    /// Client version of the observed node (`local_node_info.version`).
    #[serde(default)]
    pub version: String,
    /// Active peer connection count (`local_node_info.connections`).
    #[serde(default)]
    pub connections: u64,
}

/// Direction of a P2P connection relative to the observed local node.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PeerDirection {
    Inbound,
    Outbound,
}

/// One real P2P peer the observed node is connected to (chain-generic).
/// Populated by the CKB adapter from `get_peers`; rendered as a node in
/// the peer constellation. `latency_ms` and `best_known` are optional
/// because a freshly-connected peer may have no ping sample or reported
/// sync header yet.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Peer {
    /// Stable peer identity; drives the deterministic angular position.
    pub node_id: String,
    /// Display address, best-scored "ip:port" when resolvable.
    pub addr: String,
    pub direction: PeerDirection,
    pub version: String,
    /// Round-trip latency (ms) from the node's last ping, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    /// Peer's best-known header height, if reported.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub best_known: Option<u64>,
    /// How long (ms) the connection has been established.
    pub connected_ms: u64,
}

/// Cap on the rolling block-interval / tx-count rings used to derive the
/// `TPS (60s)` and `INTERVAL avg` HUD readings. ~6s blocks × 60 entries
/// covers a ~6 minute window — wide enough to absorb mesh jitter without
/// chasing every tick.
pub const RECENT_INTERVAL_CAP: usize = 60;

/// Chain-state singleton. Adapters produce this via the `ChainUpdated`
/// mutation path (Phase C); the cknerv-server reducer assembles the
/// snapshot frame consumers see.
///
/// Field shape is byte-stable with what simulator's
/// `DashboardState.chain` serializer emitted today (see
/// `tests/fixtures/snapshot_chain.json` for the canonical form).
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Chain {
    #[serde(default)]
    pub tip: u64,
    #[serde(default)]
    pub chain_name: String,
    #[serde(default)]
    pub epoch: EpochInfo,
    #[serde(default)]
    pub mempool: MempoolStats,
    #[serde(default)]
    pub recent_blocks: Vec<RecentBlock>,
    #[serde(default)]
    pub recent_tx_hashes: Vec<RecentTx>,
    /// Cumulative number of distinct blocks seen since boot. Unlike
    /// `recent_blocks.len()` this isn't capped by the recent-ring window.
    #[serde(default)]
    pub total_blocks: u64,
    /// Cumulative number of TxLanded events seen since boot.
    #[serde(default)]
    pub total_txs: u64,
    #[serde(default)]
    pub median_time_ms: u64,
    #[serde(default)]
    pub difficulty: String,
    /// Number of times a previously-seen block number was observed with a
    /// different hash since boot. Surfaces re-orgs on the HUD.
    #[serde(default)]
    pub reorgs: u64,
    /// ms intervals between consecutive blocks observed since boot, capped
    /// at [`RECENT_INTERVAL_CAP`]. Consumers derive "INTERVAL avg" /
    /// "INTERVAL last" from this ring without keeping their own clock.
    #[serde(default)]
    pub recent_block_intervals_ms: Vec<u64>,
    /// Per-block tx counts, parallel to `recent_block_intervals_ms`.
    #[serde(default)]
    pub recent_block_tx_counts: Vec<u32>,
    /// Per-block serialized sizes (bytes), parallel to `recent_block_tx_counts`.
    #[serde(default)]
    pub recent_block_sizes: Vec<u64>,
    /// Wall-clock ms timestamp of the most recent BlockMined envelope —
    /// the anchor used to compute the next interval. None until the first
    /// block lands.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_block_ts_ms: Option<u64>,
    /// Whether the node is in initial-block-download (`sync_state.ibd`).
    #[serde(default)]
    pub ibd: bool,
    /// Network best-known block height (`sync_state.best_known_block_number`).
    #[serde(default)]
    pub best_known_block: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peer_round_trips_snake_case_direction() {
        let p = Peer {
            node_id: "QmPeer".into(),
            addr: "1.2.3.4:8115".into(),
            direction: PeerDirection::Outbound,
            version: "0.116.1".into(),
            latency_ms: Some(42),
            best_known: Some(13_402_118),
            connected_ms: 250_000,
        };
        let v = serde_json::to_value(&p).expect("serialize");
        assert_eq!(v["direction"], "outbound");
        assert_eq!(v["latency_ms"], 42);
        let back: Peer = serde_json::from_value(v).expect("deserialize");
        assert_eq!(back, p);
    }

    #[test]
    fn peer_omits_none_optionals() {
        let p = Peer {
            node_id: "QmPeer".into(),
            addr: "1.2.3.4:8115".into(),
            direction: PeerDirection::Inbound,
            version: "0.116.1".into(),
            latency_ms: None,
            best_known: None,
            connected_ms: 0,
        };
        let v = serde_json::to_value(&p).expect("serialize");
        assert_eq!(v["direction"], "inbound");
        assert!(
            v.get("latency_ms").is_none(),
            "None latency must be omitted"
        );
        assert!(v.get("best_known").is_none());
    }

    #[test]
    fn chain_node_carries_identity_fields() {
        let n = ChainNode {
            id: "ckb:local".into(),
            label: "ckb-local".into(),
            is_miner: false,
            version: "0.116.1".into(),
            connections: 24,
        };
        let v = serde_json::to_value(&n).expect("serialize");
        assert_eq!(v["version"], "0.116.1");
        assert_eq!(v["connections"], 24);
    }

    #[test]
    fn chain_sync_fields_default_and_serialize() {
        // Defaults present (serde default) when absent on input...
        let c: Chain = serde_json::from_value(serde_json::json!({})).expect("default");
        assert!(!c.ibd);
        assert_eq!(c.best_known_block, 0);
        // ...and always emitted on output.
        let v = serde_json::to_value(&c).expect("serialize");
        assert!(v.get("ibd").is_some());
        assert!(v.get("best_known_block").is_some());
    }
}
