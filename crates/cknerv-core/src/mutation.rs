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

use crate::entity::EpochInfo;
use crate::outpoint::{OutPoint, TxOutputInfo};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Mutation {
    // ── chain ──────────────────────────────────────────────────────
    BlockMined {
        number: u64,
        hash: String,
        tx_count: u32,
        at: u64,
    },
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

    /// Boot-time backfill progress. Projection-only: the cell-galaxy
    /// projection surfaces it as a `CellDelta::Backfill` progress HUD and
    /// suppresses pulse/link effects while `active`; the `Chain` entity
    /// no-ops it. `active` is true for in-progress updates, false on the
    /// terminal "done" signal. Intentionally absent from the TS chain
    /// `Mutation` union — the SPA consumes it via the cells stream.
    BackfillProgress {
        done: u64,
        total: u64,
        active: bool,
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
        };
        let v = serde_json::to_value(&m).expect("serialize");
        assert_eq!(v["type"], "backfill_progress");
        assert_eq!(v["done"], 250);
        assert_eq!(v["total"], 1000);
        assert_eq!(v["active"], true);
        // Round-trips back to the same variant.
        let back: Mutation = serde_json::from_value(v).expect("deserialize");
        assert_eq!(back, m);
    }
}
