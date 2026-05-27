//! BLAKE2b-256 of serialized CellOutput + raw data.
//!
//! Mirror of simulator's `compute_cell_content_hash` in
//! `simulator/src/telemetry/chain_poll.rs`; must be byte-identical so
//! cells emitted by cknerv-adapter-ckb and simulator agree on which
//! cell is which (CellLifeAvatar GoL seeds are content_hash-driven).
//!
//! Algorithm: `BLAKE2b-256(CellOutput.as_slice() ++ raw_data)` with the
//! `ckb-default-hash` personalization that `ckb_hash::blake2b_256` applies.
//! Returns 0x-prefixed 66-char string (same wire form
//! `TxOutputInfo.content_hash` carries downstream).

use ckb_hash::blake2b_256;
use ckb_types::{packed, prelude::*};

/// Compute `BLAKE2b-256(serialized_cell_output || raw_data)`.
/// Returns `"0x"` + 64 hex chars.
pub fn compute_content_hash(cell_output: &packed::CellOutput, data: &[u8]) -> String {
    let mut buf = Vec::with_capacity(cell_output.as_slice().len() + data.len());
    buf.extend_from_slice(cell_output.as_slice());
    buf.extend_from_slice(data);
    let hash = blake2b_256(&buf);
    format!("0x{}", hex::encode(hash))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ckb_types::core::Capacity;

    #[test]
    fn parity_with_simulator_golden_fixture() {
        // Same fixture as simulator's `cell_content_hash_matches_ckb_canonical`
        // test in `simulator/src/telemetry/chain_poll.rs`. Any drift here
        // means cknerv-adapter-ckb and simulator would seed different
        // CellLifeAvatar visuals for the same cell.
        let code_hash_bytes: [u8; 32] = [
            0x9b, 0xd7, 0xe0, 0x6f, 0x3e, 0xcf, 0x4b, 0xe0, 0xf2, 0xfc, 0xd2, 0x18, 0x8b, 0x23,
            0xf1, 0xb9, 0xfc, 0xc8, 0x8e, 0x5d, 0x4b, 0x65, 0xa8, 0x63, 0x7b, 0x17, 0x72, 0x3b,
            0xbd, 0xa3, 0xcc, 0xe8,
        ];
        let lock = packed::Script::new_builder()
            .code_hash(packed::Byte32::from_slice(&code_hash_bytes).unwrap())
            .hash_type(packed::Byte::new(1)) // type
            .args(packed::Bytes::default())
            .build();
        let capacity: packed::Uint64 = 12_345_000_000_u64.pack();
        let cell_output = packed::CellOutput::new_builder()
            .capacity(capacity)
            .lock(lock)
            .build();
        let data: Vec<u8> = vec![0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03];

        let got = compute_content_hash(&cell_output, &data);

        // Golden anchor — pinned identically to simulator's test. Drift
        // here means cknerv and simulator disagree on a cell's identity.
        assert_eq!(
            got,
            "0x30796fed129dc23603c862e5bb9fb1c801d9cc1a33557a04cf4b2cc9708acf9f"
        );
    }

    #[test]
    fn zero_capacity_empty_data_is_stable() {
        let output = packed::CellOutput::new_builder()
            .capacity(Capacity::shannons(0).pack())
            .build();
        let h1 = compute_content_hash(&output, &[]);
        let h2 = compute_content_hash(&output, &[]);
        assert_eq!(h1, h2);
        assert!(h1.starts_with("0x"));
        assert_eq!(h1.len(), 66);
    }
}
