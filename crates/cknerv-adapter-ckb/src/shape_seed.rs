//! Compact renderer seeds derived from complete CKB Cell components.
//!
//! These are presentation fingerprints, not identity or security hashes. The
//! full canonical digest is still computed first; the wire carries its first
//! 64 bits as two big-endian `u32` words so JavaScript never loses precision.

use ckb_hash::blake2b_256;
use ckb_types::{packed, prelude::Entity};
use cknerv_core::{AssetKind, ShapeSeed};

use crate::script_taxonomy::{classify_asset, is_m_nft_collection_member, is_spore_cluster};

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

/// A spore cluster id and an M-NFT class id, in bytes.
const CLUSTER_ID_BYTES: usize = 32;
const M_NFT_CLASS_ID_BYTES: usize = 24;
/// `SporeData` is `content_type: Bytes, content: Bytes, cluster_id: BytesOpt`.
const SPORE_DATA_FIELDS: usize = 3;

/// Seed of the COLLECTION this cell belongs to, or `None`.
///
/// Every other seed on the wire is per-cell and therefore an individuality
/// channel; this one is deliberately SHARED, and it is the only field a
/// renderer can use to draw two cells as kin. Two cells answer with the same
/// seed exactly when the chain says they belong to the same collection.
///
/// Which families answer, and why the rest do not:
///
/// - **Spore items** name their cluster in their own cell data, and the
///   container names itself in its type args — so a cluster cell and its
///   spores share one seed and the container visibly belongs to its family.
/// - **M-NFT** items and class cells share the 24-byte class-id args prefix,
///   the same id the curated sampler asks ckbadger for by name.
/// - **Tokens** (xudt/sudt) are left out on purpose: a token's collection IS
///   its type script, which every holder already carries identically, so a
///   second channel saying the same thing would be noise.
/// - **COTA** keeps item identity in an off-chain SMT under one registry, and
///   **`.bit`** is a single-script family — neither has per-cell collection
///   bytes to read, and inventing one would be a guess.
///
/// `data` must be the FULL output data. The `data_hex` that rides the wire is
/// capped at 1,024 bytes and `cluster_id` sits after `content` in the table,
/// so a client can never recover this itself — which is the whole reason the
/// field exists.
pub fn collection_seed(type_script: Option<&packed::Script>, data: &[u8]) -> Option<ShapeSeed> {
    let script = type_script?;
    let kind = classify_asset(Some(script));
    if kind == AssetKind::Spore {
        return spore_cluster_id(data).map(|id| digest_seed(blake2b_256(id)));
    }
    if kind != AssetKind::Object {
        return None;
    }
    let code_hash = hex::encode(script.code_hash().raw_data());
    let hash_type = u8::from(script.hash_type());
    let args = script.args().raw_data();
    if is_spore_cluster(&code_hash, hash_type) {
        // The container's args ARE the id its members carry in their data.
        return (args.len() == CLUSTER_ID_BYTES).then(|| digest_seed(blake2b_256(&args)));
    }
    if is_m_nft_collection_member(&code_hash, hash_type) {
        return (args.len() >= M_NFT_CLASS_ID_BYTES)
            .then(|| digest_seed(blake2b_256(&args[..M_NFT_CLASS_ID_BYTES])));
    }
    None
}

/// The cluster id inside a spore's own cell data, or `None`.
///
/// Hand-rolled rather than taken as a schema dependency, the same call the
/// ckbadger adapter made for Script serialization: a molecule TABLE is a
/// `full_size` u32 followed by one u32 start offset per field, all
/// little-endian, and each field runs to the next offset (the last to
/// `full_size`). A `BytesOpt` spells absence as an EMPTY field slice; a
/// present one is a `Bytes`, its own u32 length then the raw payload.
///
/// Every malformed shape answers `None` and never an error. A spore that
/// belongs to no cluster is SOLE, not broken, and the two are indistinguishable
/// from here — this runs on every output of every block, so a foreign payload
/// under a spore code hash must cost nothing more than a missing seed.
fn spore_cluster_id(data: &[u8]) -> Option<&[u8]> {
    let full_size = le_u32(data, 0)? as usize;
    if full_size != data.len() {
        return None;
    }
    // The first field's offset is also the header length, so it counts the
    // fields: `full_size` plus one offset each.
    let header = le_u32(data, 4)? as usize;
    if !header.is_multiple_of(4) || header / 4 != SPORE_DATA_FIELDS + 1 {
        return None;
    }
    let start = le_u32(data, 4 * SPORE_DATA_FIELDS)? as usize;
    // `cluster_id` is last, so it runs to `full_size`. Equal offsets are the
    // empty slice that `BytesOpt` spells as `None`.
    let field = data.get(start..full_size)?;
    if le_u32(field, 0)? as usize != CLUSTER_ID_BYTES {
        return None;
    }
    field.get(4..4 + CLUSTER_ID_BYTES)
}

fn le_u32(bytes: &[u8], at: usize) -> Option<u32> {
    let word = bytes.get(at..at + 4)?;
    Some(u32::from_le_bytes(word.try_into().expect("four bytes")))
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

    // ——— live goldens ———
    //
    // Every byte below was read off mainnet on 2026-08-23, never recalled.
    // The spore is the Nervape item ckbadger's
    // `/api/v1/spore/objects/0x041e9872…` reports in cluster `0xd5852c19…`;
    // its cell data is `outputs_data[8]` of its mint tx
    // `0xb0f45a8b9bd6d49dc7b3b7ec91c00cd99fdf3950cb4918b83a36d1aaf1559c27`
    // (`get_transaction`), and `outputs[0]` of that very tx is the Spore
    // Cluster cell riding through, whose type args are that same cluster id —
    // which is what makes the container-shares-its-family rule true rather
    // than assumed. The M-NFT class id is the collection
    // `/api/v1/assets/objects/0x8f67efed…00000014/items` enumerates; its items
    // carry it as a 28-byte args prefix (`outputs[16]` of
    // `0xcad471ef912d24004589f32db5e91a760bb50d08ebb9cadaeb6af59556f26002`)
    // and the class cell the indexer returns for that exact 24-byte args
    // carries it alone. The tests use the pinned bytes; nothing here calls out.
    const NERVAPE_SPORE_DATA: &str = "7500000010000000190000005100000005000000646f622f3034000000\
        7b226964223a323733302c22646e61223a22373262353031383966363136613031343363646330333565393234\
        6635623538227d20000000d5852c19fa4fa394d64915cafe026cdeb702ce53cf2b839c6ace501e8dead41c";
    const NERVAPE_CLUSTER_ID: &str =
        "d5852c19fa4fa394d64915cafe026cdeb702ce53cf2b839c6ace501e8dead41c";
    /// Digest of the 32 raw cluster bytes — shared by the cluster cell and
    /// every spore inside it.
    const NERVAPE_COLLECTION_SEED: ShapeSeed = [0xc5eb_230e, 0xcdd6_2018];
    const M_NFT_CLASS_ID: &str = "8f67efedd50c61c9dd332defd4051f08a02d797700000014";
    const M_NFT_COLLECTION_SEED: ShapeSeed = [0x30cc_40c1, 0x974f_8c2b];

    const SPORE_ITEM_CODE_HASH: &str =
        "4a4dce1df3dffff7f8b2cd7dff7303df3b6150c9788cb75dcf6747247132b9f5";

    fn typed(code_hash: &str, hash_type: u8, args: &[u8]) -> packed::Script {
        packed::Script::new_builder()
            .code_hash(packed::Byte32::from_slice(&hex::decode(code_hash).unwrap()).unwrap())
            .hash_type(packed::Byte::new(hash_type))
            .args(args.to_vec().pack())
            .build()
    }

    fn spore_item(spore_id: &[u8]) -> packed::Script {
        typed(SPORE_ITEM_CODE_HASH, 2, spore_id) // data1
    }

    /// The molecule reader against the real bytes: the id it recovers is the
    /// one ckbadger independently reports for this spore.
    #[test]
    fn a_live_spore_names_its_cluster_from_its_own_data() {
        let data = hex::decode(NERVAPE_SPORE_DATA).unwrap();
        assert_eq!(data.len(), 117, "the whole SporeData table, untruncated");
        assert_eq!(
            spore_cluster_id(&data).map(hex::encode).as_deref(),
            Some(NERVAPE_CLUSTER_ID)
        );
        assert_eq!(
            collection_seed(Some(&spore_item(&[0x04; 32])), &data),
            Some(NERVAPE_COLLECTION_SEED)
        );
    }

    /// The payoff: the container and its members answer with ONE seed, from
    /// two different byte sources — the cluster's type args and the spore's
    /// cell data. Two spores of the cluster agree with each other despite
    /// having different per-item type scripts, which is the whole point.
    #[test]
    fn the_cluster_cell_and_its_spores_share_one_seed() {
        let data = hex::decode(NERVAPE_SPORE_DATA).unwrap();
        let cluster = typed(
            crate::script_taxonomy::SPORE_CLUSTER_MAINNET,
            2, // data1
            &hex::decode(NERVAPE_CLUSTER_ID).unwrap(),
        );
        assert_eq!(
            collection_seed(Some(&cluster), b"the container's own data is irrelevant"),
            Some(NERVAPE_COLLECTION_SEED)
        );
        let sibling = spore_item(&[0x99; 32]);
        let item = spore_item(&[0x04; 32]);
        assert_ne!(
            script_shape_seed(&sibling),
            script_shape_seed(&item),
            "per-item type scripts differ — that is the individuality channel"
        );
        assert_eq!(
            collection_seed(Some(&sibling), &data),
            collection_seed(Some(&item), &data),
            "…and the collection channel still says they are kin"
        );
    }

    /// One rule reads the class id out of an item (24-byte prefix of 28) and
    /// out of the class cell that defines it (24 bytes exactly).
    #[test]
    fn m_nft_items_and_their_class_cell_share_one_seed() {
        let class_id = hex::decode(M_NFT_CLASS_ID).unwrap();
        let mut item_args = class_id.clone();
        item_args.extend_from_slice(&[0, 0, 0, 0]); // token index 0
        let item = typed(crate::script_taxonomy::M_NFT_ITEM, 1, &item_args);
        let class = typed(crate::script_taxonomy::M_NFT_CLASS, 1, &class_id);
        assert_eq!(
            collection_seed(Some(&item), b""),
            Some(M_NFT_COLLECTION_SEED)
        );
        assert_eq!(
            collection_seed(Some(&class), b""),
            collection_seed(Some(&item), b"")
        );

        // A different class under the same issuer is a different collection.
        let mut other = class_id.clone();
        other[23] = 0x01;
        let other_item = typed(crate::script_taxonomy::M_NFT_ITEM, 1, &other);
        assert_ne!(
            collection_seed(Some(&other_item), b""),
            Some(M_NFT_COLLECTION_SEED)
        );
    }

    /// The families that carry no per-cell collection bytes say so.
    #[test]
    fn families_without_collection_bytes_answer_none() {
        let data = hex::decode(NERVAPE_SPORE_DATA).unwrap();
        assert_eq!(collection_seed(None, &data), None, "a plain cell");
        // xUDT: the type script IS the shared identity; no second channel.
        let xudt = typed(
            "50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95",
            2,
            &[7; 32],
        );
        assert_eq!(collection_seed(Some(&xudt), &data), None);
        // COTA and `.bit` are Object/Identity but keep membership elsewhere.
        let cota = typed(
            "1122a4fb54697cf2e6e3a96c9d80fd398a936559b90954c6e88eb7ba0cf652df",
            1,
            &[7; 20],
        );
        assert_eq!(collection_seed(Some(&cota), &data), None);
        let bit = typed(
            "4f170a048198408f4f4d36bdbcddcebe7a0ae85244d3ab08fd40a80cbfc70918",
            1,
            &[7; 20],
        );
        assert_eq!(collection_seed(Some(&bit), &data), None);
        // An M-NFT issuer publishes classes; it is not itself a collection.
        let issuer = typed(
            "24b04faf80ded836efc05247778eec4ec02548dab6e2012c0107374aa3f68b81",
            1,
            &[7; 20],
        );
        assert_eq!(collection_seed(Some(&issuer), &data), None);
    }

    /// A spore with no cluster is SOLE, and every way the bytes can be wrong
    /// reads exactly the same — never an error, never a guessed id.
    #[test]
    fn a_sole_spore_and_a_malformed_one_both_read_as_no_collection() {
        let item = spore_item(&[0x04; 32]);
        let mut sole = Vec::new();
        // A three-field table whose last field is the empty BytesOpt.
        let content_type = b"dob/0";
        let content = b"{}";
        let header = 4 + 4 * SPORE_DATA_FIELDS;
        let type_at = header;
        let content_at = type_at + 4 + content_type.len();
        let cluster_at = content_at + 4 + content.len();
        sole.extend_from_slice(&(cluster_at as u32).to_le_bytes()); // full_size
        for offset in [type_at, content_at, cluster_at] {
            sole.extend_from_slice(&(offset as u32).to_le_bytes());
        }
        sole.extend_from_slice(&(content_type.len() as u32).to_le_bytes());
        sole.extend_from_slice(content_type);
        sole.extend_from_slice(&(content.len() as u32).to_le_bytes());
        sole.extend_from_slice(content);
        assert_eq!(spore_cluster_id(&sole), None, "empty BytesOpt = sole");
        assert_eq!(collection_seed(Some(&item), &sole), None);

        let full = hex::decode(NERVAPE_SPORE_DATA).unwrap();
        for (case, bytes) in [
            ("empty", Vec::new()),
            ("shorter than the header", full[..8].to_vec()),
            ("truncated mid-table", full[..full.len() - 1].to_vec()),
            ("a foreign payload", b"not molecule at all".to_vec()),
            ("all zeroes", vec![0u8; 117]),
        ] {
            assert_eq!(collection_seed(Some(&item), &bytes), None, "{case}");
        }
    }
}
