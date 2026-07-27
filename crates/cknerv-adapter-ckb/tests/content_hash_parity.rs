//! Parity check for `compute_content_hash`.
//!
//! Two strategies layered together:
//! 1. **Canonical-value assertion** (also in `src/content_hash.rs`):
//!    the exact fixture and golden hash used by simulator's
//!    `cell_content_hash_matches_ckb_canonical` test in
//!    `simulator/src/telemetry/chain_poll.rs`. If either side drifts,
//!    one of the two tests fails.
//! 2. **Shape + determinism + collision-resistance** on independent
//!    inputs, asserting the helper is a function and the output is wire-
//!    shaped (0x-prefixed, 66 chars).
//!
//! Full byte-equality against simulator's emit on a real chain is
//! verified in C3 smoke (same chain, both adapters running, diff their
//! outputs). For C1 these guarantees plus the simulator-mirrored golden
//! hash are sufficient.

use ckb_types::{core::Capacity, packed, prelude::*};

use cknerv_adapter_ckb::content_hash::compute_content_hash;

#[test]
fn parity_with_simulator_golden_fixture() {
    // Same fixture as simulator's chain_poll test; same expected hash.
    let code_hash_bytes: [u8; 32] = [
        0x9b, 0xd7, 0xe0, 0x6f, 0x3e, 0xcf, 0x4b, 0xe0, 0xf2, 0xfc, 0xd2, 0x18, 0x8b, 0x23, 0xf1,
        0xb9, 0xfc, 0xc8, 0x8e, 0x5d, 0x4b, 0x65, 0xa8, 0x63, 0x7b, 0x17, 0x72, 0x3b, 0xbd, 0xa3,
        0xcc, 0xe8,
    ];
    let lock = packed::Script::new_builder()
        .code_hash(packed::Byte32::from_slice(&code_hash_bytes).unwrap())
        .hash_type(packed::Byte::new(1))
        .args(packed::Bytes::default())
        .build();
    let capacity: packed::Uint64 = 12_345_000_000_u64.pack();
    let cell_output = packed::CellOutput::new_builder()
        .capacity(capacity)
        .lock(lock)
        .build();
    let data: Vec<u8> = vec![0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03];

    let got = compute_content_hash(&cell_output, &data);
    assert_eq!(
        got, "0x30796fed129dc23603c862e5bb9fb1c801d9cc1a33557a04cf4b2cc9708acf9f",
        "content_hash drift would break CellLifeAvatar GoL seed parity with simulator"
    );
}

#[test]
fn zero_capacity_empty_data_has_stable_hash() {
    let output = packed::CellOutput::new_builder()
        .capacity(Capacity::shannons(0).pack())
        .build();
    let h1 = compute_content_hash(&output, &[]);
    let h2 = compute_content_hash(&output, &[]);
    assert!(h1.starts_with("0x"));
    assert_eq!(h1.len(), 66, "expected 0x + 64 hex chars");
    assert_eq!(h1, h2, "compute_content_hash must be a pure function");
}

#[test]
fn different_capacities_yield_different_hashes() {
    let a = packed::CellOutput::new_builder()
        .capacity(Capacity::shannons(100).pack())
        .build();
    let b = packed::CellOutput::new_builder()
        .capacity(Capacity::shannons(200).pack())
        .build();
    assert_ne!(compute_content_hash(&a, &[]), compute_content_hash(&b, &[]));
}

#[test]
fn different_data_yields_different_hashes() {
    let output = packed::CellOutput::new_builder()
        .capacity(Capacity::shannons(0).pack())
        .build();
    assert_ne!(
        compute_content_hash(&output, &[0xde, 0xad]),
        compute_content_hash(&output, &[0xbe, 0xef])
    );
}
