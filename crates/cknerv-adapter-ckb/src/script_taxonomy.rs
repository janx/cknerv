//! Network-agnostic classification of CKB lock/type scripts into taxonomy enums.
//! Well-known code_hashes are globally unique, so one combined table (mainnet +
//! testnet) classifies without knowing the chain — which also means backfilled
//! cells (parsed before chain_name is known) classify correctly.
//! Match on the (code_hash, hash_type) pair — xUDT mainnet is data1, testnet type.

use cknerv_core::{AssetKind, LockKind};
use ckb_types::{packed, prelude::*};

// hash_type discriminants
const TYPE: u8 = 1;
const DATA1: u8 = 2;

/// Classify a lock script. Unknown → `Other`.
pub fn classify_lock(lock: &packed::Script) -> LockKind {
    let code_hash = hex::encode(lock.code_hash().raw_data());
    let ht = u8::from(lock.hash_type());
    match (code_hash.as_str(), ht) {
        ("9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", TYPE) => LockKind::Sighash,
        ("5c5069eb0857efc65e1bca0c07df34c31663b3622fd3876c876320fc9634e2a8", TYPE) => LockKind::Multisig,
        ("d369597ff47f29fbc0d47d2e3775370d1250b85140c670e4718af712983a2354", TYPE)
        | ("3419a1c09eb2567f6552ee7a8ecffd64155cffe0f1796e6e61ec088d740c1356", TYPE) => LockKind::Acp,
        ("9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26", TYPE)
        | ("f329effd1c475a2978453c8600e1eaf0bc2087ee093c3ee64cc96ec6847752cb", TYPE) => LockKind::Omnilock,
        _ => LockKind::Other,
    }
}

/// Classify a type script. `None` → `Native`; unknown → `Other`.
pub fn classify_asset(type_: Option<&packed::Script>) -> AssetKind {
    let Some(t) = type_ else { return AssetKind::Native };
    let code_hash = hex::encode(t.code_hash().raw_data());
    let ht = u8::from(t.hash_type());
    match (code_hash.as_str(), ht) {
        ("82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e", TYPE) => AssetKind::Dao,
        ("5e7a36a77e68eecc013dfa2fe6a23f3b6c344b04005808694ae6dd45eea4cfd5", TYPE)
        | ("c5e5dcf215925f7ef4dfaf5f4b4f105bc321c02776d6e7d52a1db3fcd9d011a4", TYPE) => AssetKind::Sudt,
        ("50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95", DATA1)
        | ("25c29dc317811a6f6f3985a7a9ebc4838bd388d19d0feeecf0bcd60f6c0975bb", TYPE) => AssetKind::Xudt,
        ("4a4dce1df3dffff7f8b2cd7dff7303df3b6150c9788cb75dcf6747247132b9f5", DATA1)
        | ("7366a61534fa7c7e6225ecc0d828ea3b5366adec2b58206f2ee84995fe030075", DATA1)
        | ("bbad126377d45f90a8ee120da988a2d7332c78ba8fd679aab478a19d6c133494", DATA1)
        | ("598d793defef36e2eeba54a9b45130e4ca92822e1d193671f490950c3b856080", DATA1)
        | ("685a60219309029d01310311dba953d67029170ca4848a4ff638e57002130a0d", DATA1)
        | ("0bbe768b519d8ea7b96d58f1182eb7e6ef96c541fbd9526975077ee09f049058", DATA1)
        | ("0b1f412fbae26853ff7d082d422c2bdd9e2ff94ee8aaec11240a5b34cc6e890f", TYPE)
        | ("cfba73b58b6f30e70caed8a999748781b164ef9a1e218424a6fb55ebf641cb33", TYPE) => AssetKind::Spore,
        _ => AssetKind::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(classify_lock(&script("9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", TYPE)), LockKind::Sighash);
        assert_eq!(classify_lock(&script("5c5069eb0857efc65e1bca0c07df34c31663b3622fd3876c876320fc9634e2a8", TYPE)), LockKind::Multisig);
        assert_eq!(classify_lock(&script("d369597ff47f29fbc0d47d2e3775370d1250b85140c670e4718af712983a2354", TYPE)), LockKind::Acp); // mainnet
        assert_eq!(classify_lock(&script("3419a1c09eb2567f6552ee7a8ecffd64155cffe0f1796e6e61ec088d740c1356", TYPE)), LockKind::Acp); // testnet
        assert_eq!(classify_lock(&script("9b819793a64463aed77c615d6cb226eea5487ccfc0783043a587254cda2b6f26", TYPE)), LockKind::Omnilock);
    }

    #[test]
    fn classifies_assets_incl_xudt_hashtype_trap() {
        assert_eq!(classify_asset(None), AssetKind::Native);
        assert_eq!(classify_asset(Some(&script("82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e", TYPE))), AssetKind::Dao);
        assert_eq!(classify_asset(Some(&script("5e7a36a77e68eecc013dfa2fe6a23f3b6c344b04005808694ae6dd45eea4cfd5", TYPE))), AssetKind::Sudt);
        assert_eq!(classify_asset(Some(&script("50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95", DATA1))), AssetKind::Xudt);
        assert_eq!(classify_asset(Some(&script("25c29dc317811a6f6f3985a7a9ebc4838bd388d19d0feeecf0bcd60f6c0975bb", TYPE))), AssetKind::Xudt);
        assert_eq!(classify_asset(Some(&script("4a4dce1df3dffff7f8b2cd7dff7303df3b6150c9788cb75dcf6747247132b9f5", DATA1))), AssetKind::Spore);
    }

    #[test]
    fn unknown_or_wrong_hashtype_is_other() {
        assert_eq!(classify_lock(&script("0000000000000000000000000000000000000000000000000000000000000000", TYPE)), LockKind::Other);
        assert_eq!(classify_lock(&script("9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", DATA1)), LockKind::Other);
        assert_eq!(classify_asset(Some(&script("50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95", TYPE))), AssetKind::Other);
    }
}
