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
    /// How the network knows this node: its own base58 peer id
    /// (`local_node_info.node_id`), the same vocabulary `get_peers` names
    /// every other node in. Distinct from [`ChainNode::id`], which is
    /// cknerv's stable local key for the endpoint (`"ckb:local"`) and means
    /// nothing outside this process. `None` when the node reported no id —
    /// and when the state was restored from a save written before this
    /// field existed, which is the same honest silence.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub p2p_node_id: Option<String>,
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

/// Cap on the rolling block-interval / tx-count rings used by pulse telemetry.
/// ~6s blocks × 60 entries covers a ~6 minute window — wide enough to absorb
/// mesh jitter without chasing every tick.
pub const RECENT_INTERVAL_CAP: usize = 60;

/// Cap on [`Chain::producer_window`] — how many attributed blocks the
/// producer tally counts.
///
/// Deliberately far wider than [`RECENT_INTERVAL_CAP`], because the two
/// windows answer different kinds of question. Cadence is a per-block fact
/// and 60 blocks is plenty of it; a share is a *distribution*, and a
/// distribution over 60 blocks is mostly binomial noise — a producer holding
/// a tenth of the work would swing between 2 and 10 blocks from one window to
/// the next. 240 blocks (~32 minutes at mainnet cadence) resolves the small
/// producers well enough to be worth printing while still turning over fast
/// enough to notice a pool arriving or leaving. A first guess, tunable.
pub const PRODUCER_WINDOW_CAP: usize = 240;

/// Cap on a retained [`BlockProducer::message`], counted in Unicode scalar
/// values. Longer declarations keep their leading `PRODUCER_MESSAGE_CAP_CHARS`
/// characters and gain a trailing [`crate::DATA_HEX_TRUNCATION_MARKER`], the
/// same convention (and the same single-byte marker) `data_hex` uses.
///
/// The declaration is attacker-controlled free-form bytes: any miner on the
/// network writes it into its own cellbase, and from there it lands in a
/// persisted state file and is re-served in every chain snapshot. The longest
/// message observed on mainnet is 34 characters, so 256 leaves an order of
/// magnitude of headroom and still bounds the whole retained window at a few
/// tens of KB in the worst case a chain could construct.
///
/// ⚠️ Counted in CHARACTERS, not bytes, because two reducers in two languages
/// have to enforce this identically: Rust's `chars()` and JS code-point
/// iteration agree exactly, while a UTF-8 *byte* cap needs boundary arithmetic
/// on the JS side that could drift from Rust's without either side failing.
/// Bytes stay bounded regardless — at most four times this.
pub const PRODUCER_MESSAGE_CAP_CHARS: usize = 256;

/// One distinct block producer inside [`Chain`]'s rolling window, carrying
/// the count that makes its share meaningful.
///
/// Chain-generic: `key` is whatever opaque identity the source adapter put on
/// `Mutation::BlockMined`, and nothing here parses it. (The CKB adapter sends
/// the script hash of the cellbase witness lock.)
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct BlockProducer {
    /// The adapter's opaque producer identity. Group and count by it.
    pub key: String,
    /// What this producer declared on its most recent block **in the
    /// window**. Self-declared and trivially spoofable, so consumers must
    /// render it as a claim and not as a measurement; a producer may also
    /// declare something different on every block, and the last declaration
    /// inside the window is the one kept. A bounded prefix — see
    /// [`PRODUCER_MESSAGE_CAP_CHARS`]. Empty when the producer declared
    /// nothing readable.
    pub message: String,
    /// How many blocks of the window this producer holds — the numerator of
    /// its share. The denominator is [`Chain::producer_window_blocks`]: never
    /// `producers.len()`, and never [`PRODUCER_WINDOW_CAP`], which the window
    /// has not reached while it is still warming.
    pub blocks: u32,
    /// Envelope timestamp of this producer's most recent block in the window.
    /// Exact for as long as the row exists, because eviction only ever takes
    /// the oldest end and a row is dropped the moment its last block leaves.
    pub last_seen_ms: u64,
}

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
    /// Distinct producers of the blocks in `producer_window`, in the order
    /// they first appear in it. A materialized tally: the window below is the
    /// fact, this is the sum over it. Small — six on mainnet today — and a
    /// producer leaves the moment its last block does.
    #[serde(default)]
    pub producers: Vec<BlockProducer>,
    /// The window itself: one entry per block in it, oldest first, each an
    /// index into `producers`. Capped at [`PRODUCER_WINDOW_CAP`].
    ///
    /// Membership is *attributed blocks only* — a block whose producer the
    /// adapter could not read (genesis, an unreadable witness) takes no slot
    /// here and is counted in no share. That keeps
    /// `sum(producers[].blocks) == producer_window_blocks` exactly true, so a
    /// share can never be computed against a window it was not measured over.
    ///
    /// ⚠️ This ring rides the wire rather than staying server-side, and it has
    /// to. Two reducers maintain this window from the same mutation stream —
    /// cknerv-server's and its twin in `packages/cache/src/chainReducer.ts` —
    /// and a client is handed the chain entity exactly once per connection and
    /// then only `BlockMined` deltas for the rest of the session. Evicting the
    /// oldest block from a tally means knowing *which* producer made it, which
    /// a tally cannot answer; without the ring the client's window would
    /// silently freeze at connect time while the readout claimed to be live.
    /// Persistence needs it for the same reason: a boot that restores state
    /// SKIPS the backfill (`cknerv-cli/src/server.rs`), so a window that did
    /// not survive the save would start cold exactly there.
    ///
    /// Indices rather than keys: a 66-character hash repeated 240 times costs
    /// 16KB of wire and save file to say what ~700 bytes says.
    #[serde(default)]
    pub producer_window: Vec<u32>,
    /// How many blocks `producers` actually counts — the denominator of every
    /// share, carried explicitly so no consumer has to reconstruct it. Below
    /// [`PRODUCER_WINDOW_CAP`] the whole time the window is warming, and back
    /// to zero after a reorg drops it.
    #[serde(default)]
    pub producer_window_blocks: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The client trims the same three rings itself as block mutations
    /// arrive (`RECENT_INTERVAL_CAP` in `packages/cache/src/chainReducer.ts`,
    /// which carries the mirror-image assert). A cap that drifts apart makes
    /// the cadence strip read one window on a snapshot and another after a
    /// minute of live blocks.
    #[test]
    fn recent_interval_cap_matches_its_client_mirror() {
        assert_eq!(RECENT_INTERVAL_CAP, 60);
    }

    /// Same treatment for the producer window's two caps, and for the same
    /// reason: the snapshot arrives already cut to them and every block after
    /// it is cut by the client's own copy of this reducer
    /// (`packages/cache/src/chainReducer.ts`). A one-sided retune would show
    /// one window on the snapshot and a different one a minute later, with
    /// nothing failing anywhere.
    #[test]
    fn producer_window_caps_match_their_client_mirror() {
        assert_eq!(PRODUCER_WINDOW_CAP, 240);
        assert_eq!(PRODUCER_MESSAGE_CAP_CHARS, 256);
    }

    /// A producer window written before these fields existed — every save on
    /// disk today — still loads, as an empty window rather than a failed
    /// restore. That is what lets this change stay on the current persistence
    /// schema instead of discarding everyone's state.
    #[test]
    fn chain_without_a_producer_window_loads_empty() {
        let c: Chain = serde_json::from_value(serde_json::json!({
            "tip": 42,
            "recent_blocks": [{ "number": 42, "hash": "0x2a" }]
        }))
        .expect("a pre-field save still loads");
        assert_eq!(c.tip, 42);
        assert!(c.producers.is_empty());
        assert!(c.producer_window.is_empty());
        assert_eq!(c.producer_window_blocks, 0);

        // And the window is always emitted, so a client never has to guess
        // whether an absent denominator means zero or means unknown.
        let v = serde_json::to_value(&c).expect("serialize");
        assert!(v.get("producers").is_some());
        assert!(v.get("producer_window").is_some());
        assert_eq!(v["producer_window_blocks"], 0);
    }

    #[test]
    fn block_producer_round_trips_snake_case() {
        let p = BlockProducer {
            key: "0xfc20a8c81a461efaf91585c631db784749d066f709d30243095efda7a7fdcfd9".into(),
            message: "0.209.0 (7e31f75 2026-07-30)".into(),
            blocks: 113,
            last_seen_ms: 1_756_000_000_000,
        };
        let v = serde_json::to_value(&p).expect("serialize");
        assert_eq!(v["blocks"], 113);
        assert_eq!(v["last_seen_ms"], 1_756_000_000_000u64);
        assert_eq!(v["message"], "0.209.0 (7e31f75 2026-07-30)");
        assert_eq!(
            serde_json::from_value::<BlockProducer>(v).expect("deserialize"),
            p
        );
    }

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
            p2p_node_id: Some("QmP61JintcHEXkVFq8RGBKA8L7Fq1rfMRvj4eQQn7YsCwd".into()),
        };
        let v = serde_json::to_value(&n).expect("serialize");
        assert_eq!(v["version"], "0.116.1");
        assert_eq!(v["connections"], 24);
        assert_eq!(
            v["p2p_node_id"],
            "QmP61JintcHEXkVFq8RGBKA8L7Fq1rfMRvj4eQQn7YsCwd"
        );
    }

    /// A node restored from a save written before the network identity was
    /// carried — and a node that never reported one — read the same: absent,
    /// never a fabricated id, and never a failed load.
    #[test]
    fn chain_node_without_a_network_identity_round_trips_absent() {
        let n: ChainNode = serde_json::from_value(serde_json::json!({
            "id": "ckb:local",
            "label": "ckb-local",
            "is_miner": false,
            "version": "0.116.1",
            "connections": 24
        }))
        .expect("a pre-field save still loads");
        assert_eq!(n.p2p_node_id, None);
        let v = serde_json::to_value(&n).expect("serialize");
        assert!(
            v.get("p2p_node_id").is_none(),
            "an unknown network identity must be omitted, not emitted empty"
        );
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
