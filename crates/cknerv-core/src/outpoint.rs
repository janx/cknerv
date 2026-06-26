//! Chain outpoint and tx-output payload types.
//!
//! These mirror the corresponding CKB JSON-RPC shapes but live here so
//! cknerv-core has no dependency on `ckb-jsonrpc-types`. Adapters that
//! talk to a CKB node convert from the RPC types into these at the
//! wire boundary; downstream projections (CellGalaxy) operate on these
//! exclusively.
//!
//! Wire shape is preserved byte-for-byte from the simulator's pre-extraction
//! `crate::telemetry::types` so existing TS clients keep parsing without
//! changes.

use serde::{Deserialize, Serialize};

use crate::{AssetKind, LockKind};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct OutPoint {
    pub tx_hash: String,
    pub index: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct TxOutputInfo {
    pub capacity: u64,
    /// Hex-encoded output data, capped at 1024 source bytes (= 2050
    /// characters including the `0x` prefix). When the source data
    /// exceeds the cap the suffix `…` is appended so consumers can
    /// detect truncation.
    pub data_hex: String,
    /// CKB-canonical BLAKE2b-256 of `CellOutput.as_slice() ++ raw_data_bytes`
    /// using the `ckb-default-hash` personalization. Stable across reloads
    /// and identical to what the chain itself computes for this cell.
    /// 66 chars including the `0x` prefix.
    pub content_hash: String,
    /// How this cell is guarded — derived from the lock script's
    /// well-known `code_hash` at parse time. `#[serde(default)]` keeps
    /// pre-taxonomy persisted snapshots loadable (→ `LockKind::Other`).
    #[serde(default)]
    pub lock_kind: LockKind,
    /// What this cell holds — derived from the (optional) type script.
    /// `#[serde(default)]` keeps pre-taxonomy snapshots loadable
    /// (→ `AssetKind::Other`).
    #[serde(default)]
    pub asset_kind: AssetKind,
}

/// Minimal output shape used by adapters that haven't computed a
/// `content_hash` yet. Kept here so cknerv-core's wire types are complete;
/// the cells projection consumes the richer `TxOutputInfo`.
///
/// Lives alongside `TxOutputInfo` for callers (e.g. mainnet RPC adapters)
/// that may want to ship the raw output before content-hash computation
/// is wired up. Today the cells projection only consumes `TxOutputInfo`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CellOutput {
    pub capacity: u64,
    pub data_hex: String,
}

/// Cellbase tx's only "input" — never a real outpoint we can consume,
/// so the projection skips death-lookup for it.
pub const CELLBASE_TX_HASH: &str =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
pub const CELLBASE_INDEX: u32 = 0xffff_ffff;

pub fn is_cellbase_input(op: &OutPoint) -> bool {
    op.tx_hash == CELLBASE_TX_HASH && op.index == CELLBASE_INDEX
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cellbase_sentinel_recognized() {
        let op = OutPoint {
            tx_hash: CELLBASE_TX_HASH.to_string(),
            index: CELLBASE_INDEX,
        };
        assert!(is_cellbase_input(&op));
    }

    #[test]
    fn real_outpoint_not_cellbase() {
        let op = OutPoint {
            tx_hash: "0x1111111111111111111111111111111111111111111111111111111111111111"
                .to_string(),
            index: 0,
        };
        assert!(!is_cellbase_input(&op));
    }

    #[test]
    fn zero_hash_with_real_index_not_cellbase() {
        let op = OutPoint {
            tx_hash: CELLBASE_TX_HASH.to_string(),
            index: 0,
        };
        assert!(!is_cellbase_input(&op));
    }
}
