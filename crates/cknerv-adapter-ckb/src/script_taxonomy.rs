//! Network-agnostic classification of CKB lock/type scripts into taxonomy enums.
//! Well-known code_hashes are globally unique, so one combined table (mainnet +
//! testnet) classifies without knowing the chain — which also means backfilled
//! cells (parsed before chain_name is known) classify correctly.
//! Match on the (code_hash, hash_type) pair — xUDT mainnet is data1, testnet type.
//!
//! Every hash below was read back from a registry rather than recalled: each
//! one was posted to a running ckbadger's `POST /scripts/lookup`, which
//! answers with the family name, the canonical hash_type and a live-cell
//! count. That is the only reason to trust the table, and it is how the two
//! mis-pins it used to carry were found — Spore Cluster and `.bit Cell` both
//! sat in the Spore arm and rendered 1,059 mainnet cells as dob items.
//!
//! Mainnet-only where the family is new here. The lookup service indexes one
//! chain, so a testnet hash comes back unknown and cannot be verified the
//! same way; the testnet alternates that remain are the spore-ecosystem ones
//! this table already carried.
//!
//! Known but deliberately unpinned, because no verified hash was in hand for
//! them at the time: Unique Cell, Bitcoin SPV, and the `xudt_compatible`
//! token contracts (wCKB, ccBTC, Stable++, iCKB), which fall to `Other`.

use ckb_types::packed;
use cknerv_core::{AssetKind, HashType, LockKind, ScriptId};

// hash_type discriminants
const TYPE: u8 = 1;
const DATA1: u8 = 2;
const DATA2: u8 = 4;

// Families whose cells name the COLLECTION they belong to in bytes the node
// hands us. Named here rather than left inline because `collection_seed`
// matches on the same hashes: one crate, one pin per family.
pub(crate) const SPORE_CLUSTER_MAINNET: &str =
    "7366a61534fa7c7e6225ecc0d828ea3b5366adec2b58206f2ee84995fe030075";
pub(crate) const SPORE_CLUSTER_TESTNET_V1: &str =
    "598d793defef36e2eeba54a9b45130e4ca92822e1d193671f490950c3b856080";
pub(crate) const SPORE_CLUSTER_TESTNET_V2: &str =
    "0bbe768b519d8ea7b96d58f1182eb7e6ef96c541fbd9526975077ee09f049058";
pub(crate) const M_NFT_ITEM: &str =
    "2b24f0d644ccbdd77bbf86b27c8cca02efa0ad051e447c212636d9ee7acaaec9";
pub(crate) const M_NFT_CLASS: &str =
    "d51e6eaf48124c601f41abe173f1da550b4cbca9c6a166781906a287abbb3d9a";
const M_NFT_ISSUER: &str = "24b04faf80ded836efc05247778eec4ec02548dab6e2012c0107374aa3f68b81";

/// A Spore Cluster cell — the container that owns a family of spores. Its
/// type args are the cluster id its members name from inside their own data.
pub(crate) fn is_spore_cluster(code_hash: &str, hash_type: u8) -> bool {
    hash_type == DATA1
        && matches!(
            code_hash,
            SPORE_CLUSTER_MAINNET | SPORE_CLUSTER_TESTNET_V1 | SPORE_CLUSTER_TESTNET_V2
        )
}

/// An M-NFT item or the class cell that defines it. Both carry the 24-byte
/// class id as their args prefix — the item appends a 4-byte token index,
/// the class stops there — so one rule reads the collection out of either.
/// The issuer cell is deliberately not here: an issuer publishes classes, it
/// is not itself a collection, and its args are 20 bytes anyway.
pub(crate) fn is_m_nft_collection_member(code_hash: &str, hash_type: u8) -> bool {
    hash_type == TYPE && matches!(code_hash, M_NFT_ITEM | M_NFT_CLASS)
}

/// The script's identity, carried through unclassified. Everything below this
/// line recognizes a handful of families; this recognizes nothing and is
/// therefore complete — which is what lets a script cknerv has never heard of
/// still be counted, and later named by an index.
pub fn script_id(script: &packed::Script) -> ScriptId {
    let mut code_hash = [0u8; 32];
    code_hash.copy_from_slice(&script.code_hash().raw_data());
    ScriptId {
        code_hash,
        hash_type: match u8::from(script.hash_type()) {
            TYPE => HashType::Type,
            DATA1 => HashType::Data1,
            DATA2 => HashType::Data2,
            _ => HashType::Data,
        },
    }
}

/// Classify a lock script. Unknown → `Other`.
pub fn classify_lock(lock: &packed::Script) -> LockKind {
    let code_hash = hex::encode(lock.code_hash().raw_data());
    let ht = u8::from(lock.hash_type());
    match (code_hash.as_str(), ht) {
        ("9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", TYPE) => {
            LockKind::Sighash
        }
        ("5c5069eb0857efc65e1bca0c07df34c31663b3622fd3876c876320fc9634e2a8", TYPE) => {
            LockKind::Multisig
        }
        ("d369597ff47f29fbc0d47d2e3775370d1250b85140c670e4718af712983a2354", TYPE)
        | ("3419a1c09eb2567f6552ee7a8ecffd64155cffe0f1796e6e61ec088d740c1356", TYPE) => {
            LockKind::Acp
        }
        ("9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26", TYPE)
        | ("f329effd1c475a2978453c8600e1eaf0bc2087ee093c3ee64cc96ec6847752cb", TYPE) => {
            LockKind::Omnilock
        }
        _ => LockKind::Other,
    }
}

/// Classify a type script. `None` → `Native`; unknown → `Other`.
///
/// `Object` and `Identity` are structural, not decorative: a third of the
/// curated stage is digital objects and identity cells, and before they had
/// their own classes they all arrived as `Other` — one salmon accent whose
/// meaning is "cknerv does not recognize this".
pub fn classify_asset(type_: Option<&packed::Script>) -> AssetKind {
    let Some(t) = type_ else {
        return AssetKind::Native;
    };
    let code_hash = hex::encode(t.code_hash().raw_data());
    let ht = u8::from(t.hash_type());
    match (code_hash.as_str(), ht) {
        ("82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e", TYPE) => {
            AssetKind::Dao
        }
        ("5e7a36a77e68eecc013dfa2fe6a23f3b6c344b04005808694ae6dd45eea4cfd5", TYPE)
        | ("c5e5dcf215925f7ef4dfaf5f4b4f105bc321c02776d6e7d52a1db3fcd9d011a4", TYPE) => {
            AssetKind::Sudt
        }
        ("50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95", DATA1)
        | ("25c29dc317811a6f6f3985a7a9ebc4838bd388d19d0feeecf0bcd60f6c0975bb", TYPE) => {
            AssetKind::Xudt
        }
        // Spore ITEMS only. The cluster that owns them, and the `.bit Cell`
        // family that borrows the cluster's decoder, used to sit in this arm
        // and rendered as dob green; they are a container and an identity,
        // not a dob.
        ("4a4dce1df3dffff7f8b2cd7dff7303df3b6150c9788cb75dcf6747247132b9f5", DATA1)
        | ("bbad126377d45f90a8ee120da988a2d7332c78ba8fd679aab478a19d6c133494", DATA1)
        | ("685a60219309029d01310311dba953d67029170ca4848a4ff638e57002130a0d", DATA1) => {
            AssetKind::Spore
        }
        // Digital objects: individually minted, individually owned artifacts.
        // Spore Cluster (mainnet + the two testnet deployments).
        (SPORE_CLUSTER_MAINNET, DATA1)
        | (SPORE_CLUSTER_TESTNET_V1, DATA1)
        | (SPORE_CLUSTER_TESTNET_V2, DATA1)
        // M-NFT item, class and issuer.
        | (M_NFT_ITEM, TYPE)
        | (M_NFT_CLASS, TYPE)
        | (M_NFT_ISSUER, TYPE)
        // COTA, and the single registry cell that anchors it.
        | ("1122a4fb54697cf2e6e3a96c9d80fd398a936559b90954c6e88eb7ba0cf652df", TYPE)
        | ("90ca618be6c15f5857d3cbd09f9f24ca6770af047ba9ee70989ec3b229419ac7", TYPE)
        // CKBFS — both deployed versions carry live cells.
        | ("31e6376287d223b8c0410d562fb422f04d1d617b2947596a14c3d2efb7218d3a", DATA1)
        | ("b5d13ffe0547c78021c01fe24dce2e959a1ed8edbca3cb93dd2e9f57fb56d695", DATA1) => {
            AssetKind::Object
        }
        // Identity: cells whose job is to name somebody.
        // .bit — account, the cell family, income aggregation, reverse
        // records, and the two time-oracle cells the protocol needs to read.
        ("4f170a048198408f4f4d36bdbcddcebe7a0ae85244d3ab08fd40a80cbfc70918", TYPE)
        | ("cfba73b58b6f30e70caed8a999748781b164ef9a1e218424a6fb55ebf641cb33", TYPE)
        | ("0b1f412fbae26853ff7d082d422c2bdd9e2ff94ee8aaec11240a5b34cc6e890f", TYPE)
        | ("ebafc1ebe95b88cac426f984ed5fce998089ecad0cd2f8b17755c9de4cb02162", TYPE)
        | ("ebc9e13658f6df13593cf59b7e9cd159602b6c3c7d54b14dea43bae600ebae11", TYPE)
        | ("9e537bf5b8ec044ca3f53355e879f3fd8832217e4a9b41d9994cf0c547241a79", TYPE)
        | ("3a468d53352eb855521dabed0dc7036929bfe72766ad58f801edfbae564f7b43", TYPE)
        // did:ckb.
        | ("4a06164dc34dccade5afe3e847a97b6db743e79f5477fa3295acf02849c5984a", TYPE) => {
            AssetKind::Identity
        }
        _ => AssetKind::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ckb_types::prelude::*; // molecule builder traits for the test helper

    fn script(code_hash_hex: &str, ht: u8) -> packed::Script {
        let bytes = hex::decode(code_hash_hex).unwrap();
        packed::Script::new_builder()
            .code_hash(packed::Byte32::from_slice(&bytes).unwrap())
            .hash_type(packed::Byte::new(ht))
            .args(packed::Bytes::default())
            .build()
    }

    #[test]
    fn classifies_known_locks_both_networks() {
        assert_eq!(
            classify_lock(&script(
                "9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
                TYPE
            )),
            LockKind::Sighash
        );
        assert_eq!(
            classify_lock(&script(
                "5c5069eb0857efc65e1bca0c07df34c31663b3622fd3876c876320fc9634e2a8",
                TYPE
            )),
            LockKind::Multisig
        );
        assert_eq!(
            classify_lock(&script(
                "d369597ff47f29fbc0d47d2e3775370d1250b85140c670e4718af712983a2354",
                TYPE
            )),
            LockKind::Acp
        ); // mainnet
        assert_eq!(
            classify_lock(&script(
                "3419a1c09eb2567f6552ee7a8ecffd64155cffe0f1796e6e61ec088d740c1356",
                TYPE
            )),
            LockKind::Acp
        ); // testnet
        assert_eq!(
            classify_lock(&script(
                "9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26",
                TYPE
            )),
            LockKind::Omnilock
        );
    }

    #[test]
    fn classifies_assets_incl_xudt_hashtype_trap() {
        assert_eq!(classify_asset(None), AssetKind::Native);
        assert_eq!(
            classify_asset(Some(&script(
                "82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e",
                TYPE
            ))),
            AssetKind::Dao
        );
        assert_eq!(
            classify_asset(Some(&script(
                "5e7a36a77e68eecc013dfa2fe6a23f3b6c344b04005808694ae6dd45eea4cfd5",
                TYPE
            ))),
            AssetKind::Sudt
        );
        assert_eq!(
            classify_asset(Some(&script(
                "50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95",
                DATA1
            ))),
            AssetKind::Xudt
        );
        assert_eq!(
            classify_asset(Some(&script(
                "25c29dc317811a6f6f3985a7a9ebc4838bd388d19d0feeecf0bcd60f6c0975bb",
                TYPE
            ))),
            AssetKind::Xudt
        );
        assert_eq!(
            classify_asset(Some(&script(
                "4a4dce1df3dffff7f8b2cd7dff7303df3b6150c9788cb75dcf6747247132b9f5",
                DATA1
            ))),
            AssetKind::Spore
        );
    }

    /// One per pinned arm, and the two regressions this table used to carry.
    /// Every hash here was confirmed against a live ckbadger
    /// `POST /scripts/lookup` before it was written down.
    #[test]
    fn classifies_objects_and_identities() {
        // Spore Cluster is a container of dobs, not a dob. It answered
        // "Spore" for as long as it lived in the Spore arm.
        let cluster = script(
            "7366a61534fa7c7e6225ecc0d828ea3b5366adec2b58206f2ee84995fe030075",
            DATA1,
        );
        assert_eq!(classify_asset(Some(&cluster)), AssetKind::Object);
        assert_ne!(classify_asset(Some(&cluster)), AssetKind::Spore);
        // `.bit Cell` borrows the spore-cluster decoder, which is how it
        // ended up in the Spore arm. It is an identity.
        let bit_cell = script(
            "cfba73b58b6f30e70caed8a999748781b164ef9a1e218424a6fb55ebf641cb33",
            TYPE,
        );
        assert_eq!(classify_asset(Some(&bit_cell)), AssetKind::Identity);
        assert_ne!(classify_asset(Some(&bit_cell)), AssetKind::Spore);
        // A spore ITEM stays a spore — the shipped dob accent is the point.
        assert_eq!(
            classify_asset(Some(&script(
                "4a4dce1df3dffff7f8b2cd7dff7303df3b6150c9788cb75dcf6747247132b9f5",
                DATA1
            ))),
            AssetKind::Spore
        );
        assert_eq!(
            classify_asset(Some(&script(
                "2b24f0d644ccbdd77bbf86b27c8cca02efa0ad051e447c212636d9ee7acaaec9",
                TYPE
            ))),
            AssetKind::Object
        ); // M-NFT
        assert_eq!(
            classify_asset(Some(&script(
                "d51e6eaf48124c601f41abe173f1da550b4cbca9c6a166781906a287abbb3d9a",
                TYPE
            ))),
            AssetKind::Object
        ); // M-NFT Class
        assert_eq!(
            classify_asset(Some(&script(
                "24b04faf80ded836efc05247778eec4ec02548dab6e2012c0107374aa3f68b81",
                TYPE
            ))),
            AssetKind::Object
        ); // M-NFT Issuer
        assert_eq!(
            classify_asset(Some(&script(
                "1122a4fb54697cf2e6e3a96c9d80fd398a936559b90954c6e88eb7ba0cf652df",
                TYPE
            ))),
            AssetKind::Object
        ); // COTA
        assert_eq!(
            classify_asset(Some(&script(
                "90ca618be6c15f5857d3cbd09f9f24ca6770af047ba9ee70989ec3b229419ac7",
                TYPE
            ))),
            AssetKind::Object
        ); // COTA Registry
        assert_eq!(
            classify_asset(Some(&script(
                "b5d13ffe0547c78021c01fe24dce2e959a1ed8edbca3cb93dd2e9f57fb56d695",
                DATA1
            ))),
            AssetKind::Object
        ); // CKBFS v2
        assert_eq!(
            classify_asset(Some(&script(
                "31e6376287d223b8c0410d562fb422f04d1d617b2947596a14c3d2efb7218d3a",
                DATA1
            ))),
            AssetKind::Object
        ); // CKBFS v1
        assert_eq!(
            classify_asset(Some(&script(
                "4f170a048198408f4f4d36bdbcddcebe7a0ae85244d3ab08fd40a80cbfc70918",
                TYPE
            ))),
            AssetKind::Identity
        ); // .bit Account
        assert_eq!(
            classify_asset(Some(&script(
                "ebafc1ebe95b88cac426f984ed5fce998089ecad0cd2f8b17755c9de4cb02162",
                TYPE
            ))),
            AssetKind::Identity
        ); // .bit Income Cell
        assert_eq!(
            classify_asset(Some(&script(
                "ebc9e13658f6df13593cf59b7e9cd159602b6c3c7d54b14dea43bae600ebae11",
                TYPE
            ))),
            AssetKind::Identity
        ); // .bit Reverse Record
        assert_eq!(
            classify_asset(Some(&script(
                "9e537bf5b8ec044ca3f53355e879f3fd8832217e4a9b41d9994cf0c547241a79",
                TYPE
            ))),
            AssetKind::Identity
        ); // .bit Time Info
        assert_eq!(
            classify_asset(Some(&script(
                "3a468d53352eb855521dabed0dc7036929bfe72766ad58f801edfbae564f7b43",
                TYPE
            ))),
            AssetKind::Identity
        ); // .bit Time Index State
        assert_eq!(
            classify_asset(Some(&script(
                "4a06164dc34dccade5afe3e847a97b6db743e79f5477fa3295acf02849c5984a",
                TYPE
            ))),
            AssetKind::Identity
        ); // did:ckb
    }

    /// The hash_type half of the pair guards the new arms too — a Spore
    /// Cluster hash under `type` is not a Spore Cluster.
    #[test]
    fn new_arms_still_require_the_right_hashtype() {
        assert_eq!(
            classify_asset(Some(&script(
                "7366a61534fa7c7e6225ecc0d828ea3b5366adec2b58206f2ee84995fe030075",
                TYPE
            ))),
            AssetKind::Other
        );
        assert_eq!(
            classify_asset(Some(&script(
                "4f170a048198408f4f4d36bdbcddcebe7a0ae85244d3ab08fd40a80cbfc70918",
                DATA1
            ))),
            AssetKind::Other
        );
    }

    #[test]
    fn unknown_or_wrong_hashtype_is_other() {
        assert_eq!(
            classify_lock(&script(
                "0000000000000000000000000000000000000000000000000000000000000000",
                TYPE
            )),
            LockKind::Other
        );
        assert_eq!(
            classify_lock(&script(
                "9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
                DATA1
            )),
            LockKind::Other
        );
        assert_eq!(
            classify_asset(Some(&script(
                "50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95",
                TYPE
            ))),
            AssetKind::Other
        );
    }
}
