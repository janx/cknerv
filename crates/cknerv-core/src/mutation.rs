//! Chain-generic mutations emitted by Adapter implementations.
//!
//! Lifted verbatim from simulator's post-Phase-A `ChainMutation` enum
//! (`simulator/src/dashboard/mutations.rs`), with the simulator's outer
//! `Mutation::Chain(...)` wrapper dropped: cknerv-core doesn't know
//! about RCG and has no second namespace to disambiguate against.
//! Simulator re-adds its own wrapper post-extraction.
//!
//! Wire shape is byte-stable: `#[serde(tag = "type", rename_all =
//! "snake_case")]` produces the same `{"type": "block_mined", ...}` frames
//! that the simulator's `ChainMutation` emits today. The wire-shape
//! fixture in `tests/fixtures/mutation_samples.json` (cknerv repo root)
//! pins this.

use serde::{Deserialize, Serialize};

use crate::entity::{EpochInfo, Peer};
use crate::outpoint::{OutPoint, TxOutputInfo};

/// Why the adapter is replaying canonical blocks instead of following the
/// ordinary live tip. Kept chain-generic so projections and UI consumers can
/// explain the operation without knowing which source adapter produced it.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReplayPhase {
    /// Initial recent-window replay used to seed an empty projection.
    #[default]
    Boot,
    /// The observed chain advanced while cknerv was offline or behind.
    Catchup,
    /// A proven canonical suffix is being rolled back and replaced.
    Reorg,
    /// No bounded common ancestor was found; derived state is rebuilt.
    Rebuild,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Mutation {
    // ── chain ──────────────────────────────────────────────────────
    BlockMined {
        number: u64,
        hash: String,
        tx_count: u32,
        /// Serialized block size in bytes. `#[serde(default)]` so frames from
        /// the external simulator (which doesn't emit it yet) still decode → 0.
        #[serde(default)]
        size: u64,
        at: u64,
    },
    /// Invalidates the previously-observed canonical suffix beginning at
    /// `from_block`. Adapters emit this before replaying replacement blocks
    /// after finding a common ancestor. Keeping the boundary chain-generic
    /// lets projections roll back immediately even when the observed node's
    /// tip regresses and no replacement block exists at the old tip yet.
    ChainReorganized { from_block: u64 },
    /// The adapter could not prove a common ancestor within its bounded
    /// canonical-history window. Consumers must discard chain-derived state
    /// that cannot be safely rolled back; the adapter then replays the
    /// canonical window beginning at `from_block`.
    ///
    /// This is deliberately distinct from [`Mutation::ChainReorganized`]:
    /// `ChainReorganized` preserves the proven prefix and performs an exact
    /// journal rollback, while `ChainRebuild` establishes a fresh bounded
    /// observation window.
    ChainRebuild { from_block: u64 },
    TxLanded {
        tx_hash: String,
        block: u64,
        at: u64,
        #[serde(default)]
        inputs: Vec<OutPoint>,
        #[serde(default)]
        outputs: Vec<TxOutputInfo>,
    },

    // ── chain (snapshots) ──────────────────────────────────────────
    /// Replaces the latest mempool snapshot wholesale (overwrite, not merge).
    /// Struct variant (not newtype) so the JSON wire shape stays
    /// `{"type":"chain_mempool_updated","pending":…,"proposed":…,…}` —
    /// serde's `tag = "type"` requires this for consumers to pattern-match
    /// the discriminant.
    ChainMempoolUpdated {
        pending: u64,
        proposed: u64,
        orphan: u64,
        total_tx_size: u64,
        total_tx_cycles: u64,
        min_fee_rate: u64,
    },
    /// Replaces the latest blockchain-info snapshot wholesale.
    ChainInfoUpdated {
        epoch: EpochInfo,
        median_time_ms: u64,
        difficulty: String,
        chain_name: String,
    },

    /// Opaque tag for the cell at `out_point`. cknerv-core's cell galaxy
    /// stores it as a string and ships it to consumers; meaning is the
    /// emitter's concern. Simulator emits this from its RCG reducer when
    /// it observes both a `TxLanded(tx_hash)` and an
    /// `OtSettleChanged → Settled` for the same tx (in either order).
    CellTagged {
        out_point: OutPoint,
        tag: String,
        at: u64,
    },

    /// Register a chain node into the cknerv-server's `chain_nodes`
    /// list. Idempotent: re-registering the same `id` updates `label`
    /// and `is_miner` if changed, otherwise no-op. Single-node adapters
    /// (CkbDirectAdapter) emit this once at startup; multi-node profiles
    /// (mesh) emit once per node.
    ChainNodeRegistered {
        id: String,
        label: String,
        is_miner: bool,
        at: u64,
    },

    /// Historical replay progress (boot backfill, downtime catch-up, exact
    /// canonical reorg, or controlled deep-reorg rebuild). Projection-only:
    /// the cell-galaxy projection surfaces it as a `CellDelta::Backfill`
    /// progress HUD and suppresses block-pulse effects while `active`; tx
    /// links still stream so nerves refill with cells. The `Chain` entity
    /// no-ops it. `active` is true for in-progress updates, false on the
    /// terminal "done" signal.
    /// Intentionally absent from the TS chain `Mutation` union — the SPA
    /// consumes it via the cells stream. It still rides the chain mutation
    /// broadcast like any mutation, but both the server `Chain` reducer and
    /// the SPA chain reducer ignore it; the SPA acts on it only via the cells
    /// projection stream (`CellDelta::Backfill`).
    BackfillProgress {
        done: u64,
        total: u64,
        active: bool,
        /// Defaults to boot when reading frames produced before replay causes
        /// were exposed on the wire.
        #[serde(default)]
        phase: ReplayPhase,
    },

    /// Marks a bounded Cell reservoir as fully hydrated for `target` live
    /// records. Adapters emit this immediately before the terminal boot or
    /// rebuild replay marker, after reaching the target or chain genesis.
    /// Projection metadata only: this does not synthesize an on-chain event.
    CellHydrationCompleted {
        target: u64,
        available: u64,
        from_block: u64,
        at_tip: u64,
    },

    /// Full snapshot of the observed node's current P2P peers. Replaces
    /// the server's `peers` list wholesale; consumers diff successive
    /// snapshots for join/drop animation.
    PeersUpdated { peers: Vec<Peer> },

    /// Local node sync status from `sync_state`.
    ChainSyncUpdated { ibd: bool, best_known_block: u64 },

    /// Identity refresh for an already-registered chain node, from
    /// `local_node_info`. Separate from `ChainNodeRegistered` because
    /// registration happens at boot before identity is first polled.
    ChainNodeInfoUpdated {
        id: String,
        version: String,
        connections: u64,
    },
}

/// Mutation paired with the EntityStore revision that produced it.
/// `cknerv-server` (PR B4) consumes a stream of these.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RevisionedMutation {
    pub revision: u64,
    pub mutation: Mutation,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backfill_progress_wire_shape_is_snake_case() {
        let m = Mutation::BackfillProgress {
            done: 250,
            total: 1000,
            active: true,
            phase: ReplayPhase::Catchup,
        };
        let v = serde_json::to_value(&m).expect("serialize");
        assert_eq!(v["type"], "backfill_progress");
        assert_eq!(v["done"], 250);
        assert_eq!(v["total"], 1000);
        assert_eq!(v["active"], true);
        assert_eq!(v["phase"], "catchup");
        // Round-trips back to the same variant.
        let back: Mutation = serde_json::from_value(v).expect("deserialize");
        assert_eq!(back, m);
    }

    #[test]
    fn legacy_backfill_progress_defaults_to_boot() {
        let back: Mutation = serde_json::from_value(serde_json::json!({
            "type": "backfill_progress",
            "done": 1,
            "total": 2,
            "active": true
        }))
        .expect("deserialize legacy frame");
        assert_eq!(
            back,
            Mutation::BackfillProgress {
                done: 1,
                total: 2,
                active: true,
                phase: ReplayPhase::Boot,
            }
        );
    }

    #[test]
    fn cell_hydration_completed_wire_shape_is_snake_case() {
        let m = Mutation::CellHydrationCompleted {
            target: 20_000,
            available: 20_017,
            from_block: 123,
            at_tip: 456,
        };
        let v = serde_json::to_value(&m).expect("serialize");
        assert_eq!(v["type"], "cell_hydration_completed");
        assert_eq!(v["target"], 20_000);
        assert_eq!(v["available"], 20_017);
        assert_eq!(v["from_block"], 123);
        assert_eq!(v["at_tip"], 456);
        assert_eq!(serde_json::from_value::<Mutation>(v).unwrap(), m);
    }

    #[test]
    fn chain_reorganized_wire_shape_is_snake_case() {
        let m = Mutation::ChainReorganized { from_block: 42 };
        let v = serde_json::to_value(&m).expect("serialize");
        assert_eq!(v["type"], "chain_reorganized");
        assert_eq!(v["from_block"], 42);
        assert_eq!(serde_json::from_value::<Mutation>(v).unwrap(), m);
    }

    #[test]
    fn chain_rebuild_wire_shape_is_snake_case() {
        let m = Mutation::ChainRebuild { from_block: 7 };
        let v = serde_json::to_value(&m).expect("serialize");
        assert_eq!(v["type"], "chain_rebuild");
        assert_eq!(v["from_block"], 7);
        assert_eq!(serde_json::from_value::<Mutation>(v).unwrap(), m);
    }

    #[test]
    fn peers_updated_wire_shape() {
        use crate::entity::{Peer, PeerDirection};
        let m = Mutation::PeersUpdated {
            peers: vec![Peer {
                node_id: "QmA".into(),
                addr: "1.2.3.4:8115".into(),
                direction: PeerDirection::Outbound,
                version: "0.116.1".into(),
                latency_ms: Some(31),
                best_known: Some(100),
                connected_ms: 1000,
            }],
        };
        let v = serde_json::to_value(&m).expect("serialize");
        assert_eq!(v["type"], "peers_updated");
        assert_eq!(v["peers"][0]["node_id"], "QmA");
        let back: Mutation = serde_json::from_value(v).expect("deserialize");
        assert_eq!(back, m);
    }

    #[test]
    fn chain_sync_and_node_info_wire_shape() {
        let s = Mutation::ChainSyncUpdated {
            ibd: true,
            best_known_block: 42,
        };
        let sv = serde_json::to_value(&s).expect("ser");
        assert_eq!(sv["type"], "chain_sync_updated");
        assert_eq!(sv["ibd"], true);
        assert_eq!(serde_json::from_value::<Mutation>(sv).unwrap(), s);

        let n = Mutation::ChainNodeInfoUpdated {
            id: "ckb:local".into(),
            version: "0.116.1".into(),
            connections: 24,
        };
        let nv = serde_json::to_value(&n).expect("ser");
        assert_eq!(nv["type"], "chain_node_info_updated");
        assert_eq!(serde_json::from_value::<Mutation>(nv).unwrap(), n);
    }
}
