//! Compact renderer seeds derived from complete CKB Cell components.
//!
//! These are presentation fingerprints, not identity or security hashes. The
//! full canonical digest is still computed first; the wire carries its first
//! 64 bits as two big-endian `u32` words so JavaScript never loses precision.

use ckb_hash::blake2b_256;
use ckb_types::{packed, prelude::Entity};
use cknerv_core::ShapeSeed;

fn digest_seed(digest: [u8; 32]) -> ShapeSeed {
    [
        u32::from_be_bytes(digest[0..4].try_into().expect("four digest bytes")),
        u32::from_be_bytes(digest[4..8].try_into().expect("four digest bytes")),
    ]
}

/// Seed of the complete Molecule-serialized Script, including args.
pub fn script_shape_seed(script: &packed::Script) -> ShapeSeed {
    digest_seed(blake2b_256(script.as_slice()))
}

/// Seed of the complete, untruncated output data.
pub fn data_shape_seed(data: &[u8]) -> ShapeSeed {
    digest_seed(blake2b_256(data))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ckb_types::prelude::*;

    fn script(args: &[u8]) -> packed::Script {
        packed::Script::new_builder()
            .code_hash(packed::Byte32::from_slice(&[0x42; 32]).unwrap())
            .hash_type(packed::Byte::new(1))
            .args(args.to_vec().pack())
            .build()
    }

    #[test]
    fn complete_script_args_and_data_are_independent() {
        let lock_a = script(&[1, 2, 3]);
        let lock_b = script(&[1, 2, 4]);

        assert_eq!(script_shape_seed(&lock_a), script_shape_seed(&lock_a));
        assert_ne!(script_shape_seed(&lock_a), script_shape_seed(&lock_b));
        assert_ne!(data_shape_seed(&[1, 2, 3]), data_shape_seed(&[1, 2, 4]));
        assert_eq!(data_shape_seed(&[]), [0x44f4_c697, 0x44d5_f8c5]);
        assert_eq!(script_shape_seed(&lock_a), [0xadd6_4bf4, 0x6831_6f32]);
    }

    #[test]
    fn digest_words_are_big_endian() {
        let mut digest = [0u8; 32];
        digest[..8].copy_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(digest_seed(digest), [0x0102_0304, 0x0506_0708]);
    }
}
