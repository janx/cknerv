//! Optional ckbadger-backed semantic enrichment for cknerv.
//!
//! This crate contains every ckbadger-specific HTTP DTO. It implements the
//! source-agnostic [`cknerv_server::EnrichmentSource`] boundary and never emits
//! canonical mutations.

mod dto;
mod source;

pub use source::CkbadgerEnrichmentSource;
