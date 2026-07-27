//! Cell taxonomy enums — how a cell is guarded (lock) and what it holds (asset).
//! Plain serde types (cknerv-core has no ckb dependency); the adapter does the
//! `packed::Script` → enum classification (see cknerv-adapter-ckb::script_taxonomy).
//! `Other` is the default so cells from pre-taxonomy persisted snapshots (which
//! lack these fields) load as `Other` rather than failing.

use serde::{Deserialize, Serialize};

/// Lock-script category (by well-known code_hash).
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum LockKind {
    Sighash,
    Multisig,
    Acp,
    Omnilock,
    #[default]
    Other,
}

/// Asset class (by type-script; `Native` = no type script).
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AssetKind {
    Native,
    Sudt,
    Xudt,
    Dao,
    Spore,
    #[default]
    Other,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_to_snake_case_strings() {
        assert_eq!(
            serde_json::to_string(&LockKind::Sighash).unwrap(),
            "\"sighash\""
        );
        assert_eq!(
            serde_json::to_string(&LockKind::Omnilock).unwrap(),
            "\"omnilock\""
        );
        assert_eq!(
            serde_json::to_string(&AssetKind::Native).unwrap(),
            "\"native\""
        );
        assert_eq!(
            serde_json::to_string(&AssetKind::Spore).unwrap(),
            "\"spore\""
        );
    }

    #[test]
    fn defaults_to_other() {
        assert_eq!(LockKind::default(), LockKind::Other);
        assert_eq!(AssetKind::default(), AssetKind::Other);
    }

    #[test]
    fn round_trips() {
        for v in [
            LockKind::Sighash,
            LockKind::Multisig,
            LockKind::Acp,
            LockKind::Omnilock,
            LockKind::Other,
        ] {
            let s = serde_json::to_string(&v).unwrap();
            assert_eq!(serde_json::from_str::<LockKind>(&s).unwrap(), v);
        }
        for v in [
            AssetKind::Native,
            AssetKind::Sudt,
            AssetKind::Xudt,
            AssetKind::Dao,
            AssetKind::Spore,
            AssetKind::Other,
        ] {
            let s = serde_json::to_string(&v).unwrap();
            assert_eq!(serde_json::from_str::<AssetKind>(&s).unwrap(), v);
        }
    }
}
