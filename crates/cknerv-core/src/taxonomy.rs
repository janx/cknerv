//! Cell taxonomy — how a cell is guarded (lock), what it holds (asset), and
//! which script says so.
//!
//! Two different questions live here and they are answered by different types.
//! [`LockKind`] / [`AssetKind`] are the *structural* answer: a small fixed
//! vocabulary the renderer and the display-plane composition policy read, and
//! the adapter derives it from a handful of well-known code hashes it pins
//! itself (see cknerv-adapter-ckb::script_taxonomy). [`ScriptId`] is the
//! *identity* answer: exactly which script this is, carried verbatim from the
//! node so nothing downstream has to recognize it to report it. Naming a
//! `ScriptId` is somebody else's job — CKB has far more script families than
//! cknerv could pin, and an index that tracks them is what turns an identity
//! into a name.
//!
//! Plain serde types (cknerv-core has no ckb dependency). `Other` is the
//! default so cells from pre-taxonomy persisted snapshots (which lack these
//! fields) load as `Other` rather than failing.

use serde::{Deserialize, Deserializer, Serialize, Serializer};

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
///
/// `Object` is a digital object — a crafted, individually-minted artifact
/// (Spore Cluster, M-NFT, COTA, CKBFS). `Identity` is a cell that names
/// somebody (`.bit`, did:ckb). Both were `Other` until the stage started
/// sampling them, at which point a third of the galaxy rendered as
/// "unrecognized".
///
/// APPEND ONLY, AND ONLY AFTER `Other`. Declaration order *is* the columnar
/// wire code (`projection::cells_columnar::asset_kind_code`, mirrored by the
/// TS `COLUMNAR_ASSET_KINDS` table at the matching index), so inserting a
/// variant renumbers every later one and silently re-colors every cell in
/// every buffer already in flight. Appending costs a
/// `CELLS_COLUMNAR_VERSION` bump and nothing else.
///
/// Persisted snapshots need no migration in either direction: a file written
/// before these variants existed can only contain the old serde names, and
/// `#[serde(default)]` on the carrying field already covers a file with no
/// asset kind at all.
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
    Object,
    Identity,
}

/// How a script's `code_hash` is to be matched, in CKB's own vocabulary.
/// Part of a script's identity: the same 32 bytes under a different hash type
/// is a different script.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash, Default)]
#[serde(rename_all = "snake_case")]
pub enum HashType {
    #[default]
    Data,
    Type,
    Data1,
    Data2,
}

impl HashType {
    /// Parses CKB's JSON-RPC spelling. An unrecognized spelling is `Data`,
    /// matching the chain's own zero discriminant.
    pub fn parse(value: &str) -> Self {
        match value {
            "type" => Self::Type,
            "data1" => Self::Data1,
            "data2" => Self::Data2,
            _ => Self::Data,
        }
    }
}

/// One script's identity: the `(code_hash, hash_type)` pair, which is what
/// makes two cells guarded by the same code the same *kind* of cell.
///
/// Held unclassified on purpose. cknerv pins four lock families and seven
/// asset families; mainnet runs dozens more, and collapsing every one it cannot pin
/// into "other" is what made the Cell panel report two thirds of the galaxy as
/// unrecognized. Carrying the pair costs 33 inline bytes per script and lets a
/// name arrive later, from an index, without the Cell projection having to
/// know anything about that index.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
pub struct ScriptId {
    pub code_hash: [u8; 32],
    pub hash_type: HashType,
}

impl ScriptId {
    /// Accepts CKB's `0x`-prefixed 32-byte hex. A malformed hash is `None`
    /// rather than a panic: this parses adapter input, and a cell cknerv
    /// cannot identify is still a cell it must show.
    pub fn parse(code_hash: &str, hash_type: &str) -> Option<Self> {
        let body = code_hash.strip_prefix("0x").unwrap_or(code_hash);
        if body.len() != 64 {
            return None;
        }
        let mut bytes = [0u8; 32];
        for (i, byte) in bytes.iter_mut().enumerate() {
            *byte = u8::from_str_radix(body.get(i * 2..i * 2 + 2)?, 16).ok()?;
        }
        Some(Self {
            code_hash: bytes,
            hash_type: HashType::parse(hash_type),
        })
    }

    /// `0x`-prefixed lowercase hex, the form every other cknerv hash takes.
    pub fn code_hash_hex(&self) -> String {
        let mut out = String::with_capacity(66);
        out.push_str("0x");
        for byte in self.code_hash {
            out.push_str(&format!("{byte:02x}"));
        }
        out
    }

    /// True for the all-zero code hash, which is what a cell whose script
    /// cknerv could not parse carries. Kept out of script census output so a
    /// parse gap cannot masquerade as a script family.
    pub fn is_unset(&self) -> bool {
        self.code_hash == [0u8; 32]
    }
}

/// Wire form: `{"code_hash": "0x…", "hash_type": "type"}`. Stored as bytes in
/// memory (33 inline bytes on every retained Cell) and widened to hex only at
/// the boundary, where it is read.
#[derive(Serialize, Deserialize)]
#[serde(rename = "ScriptId")]
struct ScriptIdWire {
    code_hash: String,
    hash_type: HashType,
}

impl Serialize for ScriptId {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        ScriptIdWire {
            code_hash: self.code_hash_hex(),
            hash_type: self.hash_type,
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for ScriptId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let wire = ScriptIdWire::deserialize(deserializer)?;
        let hash_type = wire.hash_type;
        Ok(Self::parse(&wire.code_hash, "").map_or(
            // An unreadable hash degrades to the unset id rather than failing
            // the whole snapshot: persisted state predating this field, and a
            // truncated hash, both mean "identity unknown".
            Self {
                code_hash: [0u8; 32],
                hash_type,
            },
            |id| Self {
                code_hash: id.code_hash,
                hash_type,
            },
        ))
    }
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
        assert_eq!(
            serde_json::to_string(&AssetKind::Object).unwrap(),
            "\"object\""
        );
        assert_eq!(
            serde_json::to_string(&AssetKind::Identity).unwrap(),
            "\"identity\""
        );
    }

    #[test]
    fn defaults_to_other() {
        assert_eq!(LockKind::default(), LockKind::Other);
        assert_eq!(AssetKind::default(), AssetKind::Other);
    }

    #[test]
    fn script_id_parses_and_round_trips_through_the_wire() {
        let hex = "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8";
        let id = ScriptId::parse(hex, "type").expect("well-formed code hash");
        assert_eq!(id.code_hash_hex(), hex);
        assert_eq!(id.hash_type, HashType::Type);
        assert!(!id.is_unset());

        let json = serde_json::to_string(&id).unwrap();
        assert!(json.contains(hex), "{json}");
        assert_eq!(serde_json::from_str::<ScriptId>(&json).unwrap(), id);

        // The same bytes under a different hash type is a different script.
        assert_ne!(ScriptId::parse(hex, "data1").unwrap(), id);
        // Unrecognized spellings take the chain's own zero discriminant.
        assert_eq!(HashType::parse("nonsense"), HashType::Data);
    }

    #[test]
    fn unreadable_script_ids_degrade_instead_of_failing() {
        // A cell cknerv cannot identify is still a cell it must show.
        assert!(ScriptId::parse("0x1234", "type").is_none());
        assert!(ScriptId::parse(&"z".repeat(64), "type").is_none());
        assert!(ScriptId::default().is_unset());

        let salvaged: ScriptId =
            serde_json::from_str(r#"{"code_hash":"0xtruncated","hash_type":"type"}"#).unwrap();
        assert!(salvaged.is_unset());
        assert_eq!(salvaged.hash_type, HashType::Type);
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
            AssetKind::Object,
            AssetKind::Identity,
        ] {
            let s = serde_json::to_string(&v).unwrap();
            assert_eq!(serde_json::from_str::<AssetKind>(&s).unwrap(), v);
        }
    }
}
