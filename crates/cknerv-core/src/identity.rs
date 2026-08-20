//! Cell identity derived from a chain outpoint.
//!
//! A cell the retained window never held still owns an address on the galaxy
//! disk: [`composition_id_for_outpoint`] maps `(tx_hash, index)` to an id
//! without consulting any reservoir, so every producer that knows the outpoint
//! derives the same id. Pair it with [`crate::helix_seed_for`] to place that
//! id on the disk.
//!
//! **Determinism is contract**: persisted galaxy compositions carry these ids
//! across restarts, so the hash and both constants must never change.

/// Tags an id as outpoint-derived; projection-sequential ids stay below it.
pub const COMPOSITION_ID_PREFIX: u64 = 1_u64 << 52;
/// Confines the hashed payload so the tag survives and the id stays inside
/// the f64 safe-integer range the TS client indexes cells by.
pub const COMPOSITION_ID_MASK: u64 = (1_u64 << 51) - 1;

/// FNV-1a over the `tx_hash` bytes followed by the little-endian index.
pub fn composition_id_for_outpoint(tx_hash: &str, index: u32) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in tx_hash.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    for byte in index.to_le_bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    COMPOSITION_ID_PREFIX | (hash & COMPOSITION_ID_MASK)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pinned vectors: a drift here silently relocates every derived cell and
    /// orphans persisted compositions.
    #[test]
    fn derived_ids_are_pinned() {
        assert_eq!(
            composition_id_for_outpoint(&format!("0x{}", "11".repeat(32)), 7),
            5_096_158_544_582_834
        );
        assert_eq!(
            composition_id_for_outpoint(&format!("0x{}", "ab".repeat(32)), 3),
            6_364_020_600_219_382
        );
    }

    #[test]
    fn derived_ids_are_tagged_safe_integers() {
        let tx_hash = format!("0x{}", "11".repeat(32));
        for index in 0..8_u32 {
            let id = composition_id_for_outpoint(&tx_hash, index);
            assert!(id >= COMPOSITION_ID_PREFIX);
            assert!(id < (1_u64 << 53));
        }
    }

    #[test]
    fn the_index_is_part_of_the_preimage() {
        let tx_hash = format!("0x{}", "11".repeat(32));
        assert_ne!(
            composition_id_for_outpoint(&tx_hash, 0),
            composition_id_for_outpoint(&tx_hash, 7)
        );
    }
}
