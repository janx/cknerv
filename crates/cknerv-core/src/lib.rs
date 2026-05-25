//! cknerv-core — chain-generic visualization primitives for CKB.
//!
//! See [`helix`] for the deterministic cell positioning function
//! (`helix_seed_for`) that must stay byte-parity with the TS twin in
//! `@cknerv/ui/src/helix.ts`. The shared fixture in
//! `tests/fixtures/helix_seed.json` (root of the cknerv repo) is the
//! source of truth for both sides.

pub mod helix;
pub mod rng;

pub use helix::{helix_seed_f64, helix_seed_for};
