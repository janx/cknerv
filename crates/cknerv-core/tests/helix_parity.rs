//! Cross-language parity test for `helix_seed`.
//!
//! The fixture in `tests/fixtures/helix_seed.json` (cknerv repo root) is
//! the single source of truth; both Rust (this test) and TypeScript
//! (in `packages/ui/__tests__/helix-parity.test.ts`) must produce
//! byte-identical f32 output for every id (0..N).
//!
//! Fixture shape: `Vec<[f32; 3]>` — index = cell id, value = expected
//! f32 xyz. If this test drifts and the TS one doesn't (or vice versa),
//! the bytecode that runs the wallet preview will not match what the
//! server commits — the entire `helix_seed` parity guarantee is broken.

use std::path::PathBuf;

use cknerv_core::helix::helix_seed_for;

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("tests")
        .join("fixtures")
        .join("helix_seed.json")
}

/// Regenerates `tests/fixtures/helix_seed.json` from the current helix
/// parameters. IGNORED by default — run ONLY after an intended change to the
/// helix distribution, then re-run both parity tests (Rust here + the TS twin
/// in `packages/ui/__tests__/helix-parity.test.ts`) to confirm they still agree:
///
///   cargo test -p cknerv-core --test helix_parity regenerate_fixture -- --ignored --exact
///
/// The fixture stores each f32 value promoted to f64 (its exact f64 expansion) —
/// i.e. the values are already f32-truncated, matching how the fixture was first
/// generated; both parity tests narrow to f32 for the byte-exact comparison.
#[test]
#[ignore = "regenerates the parity fixture; run only after an intended helix change"]
fn regenerate_fixture() {
    let data: Vec<[f64; 3]> = (0..1000)
        .map(|id| {
            let p = helix_seed_for(id as u64);
            [p[0] as f64, p[1] as f64, p[2] as f64]
        })
        .collect();
    let json = serde_json::to_string(&data).expect("serialize fixture");
    std::fs::write(fixture_path(), json).expect("write fixture");
    eprintln!("regenerated {} ({} entries)", fixture_path().display(), data.len());
}

#[test]
fn helix_seed_matches_fixture() {
    let path = fixture_path();
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    let expected: Vec<[f32; 3]> =
        serde_json::from_str(&raw).expect("parse helix_seed.json as Vec<[f32; 3]>");
    assert_eq!(expected.len(), 1000, "fixture must have 1000 entries");

    for (id, exp) in expected.iter().enumerate() {
        let got = helix_seed_for(id as u64);
        // Bit-exact comparison: this is f32, but we compare as u32 bit
        // patterns to catch NaN payload differences and the f64 -> f32
        // narrowing edge cases that `==` would tolerate.
        assert_eq!(
            got[0].to_bits(),
            exp[0].to_bits(),
            "id={id} x: got {} expected {}",
            got[0],
            exp[0],
        );
        assert_eq!(
            got[1].to_bits(),
            exp[1].to_bits(),
            "id={id} y: got {} expected {}",
            got[1],
            exp[1],
        );
        assert_eq!(
            got[2].to_bits(),
            exp[2].to_bits(),
            "id={id} z: got {} expected {}",
            got[2],
            exp[2],
        );
    }
}
