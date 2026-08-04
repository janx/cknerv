//! Source-agnostic boundary for optional indexed context.
//!
//! Canonical adapters continue to emit [`cknerv_core::Mutation`] values.
//! Enrichment sources can only describe already-observed chain objects and
//! enter the server through a separate [`cknerv_core::EnrichmentEvent`]
//! channel.

use async_trait::async_trait;

use cknerv_core::{
    CellSemanticRecord, EnrichmentSourceStatus, OutPoint, RecentBlock, RecentTx,
    TransactionSemanticRecord,
};

/// Bounded canonical evidence supplied to an enrichment source when it
/// validates its indexed view or resolves a lazy detail request.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CanonicalContext {
    pub tip: u64,
    pub chain_name: String,
    pub recent_blocks: Vec<RecentBlock>,
    pub recent_transactions: Vec<RecentTx>,
    pub replay_active: bool,
}

/// Optional read-only source of indexed semantics.
///
/// Implementations own all source-specific DTOs and compatibility checks.
/// They must validate an indexed block hash against `CanonicalContext` before
/// returning enrichment records.
#[async_trait]
pub trait EnrichmentSource: Send + Sync + 'static {
    fn name(&self) -> &'static str;

    fn capabilities(&self) -> Vec<String>;

    /// Probe reachability, indexing lag, and canonical-chain compatibility.
    /// Operational failures are represented in the returned status so the
    /// optional source can fail without affecting the canonical pipeline.
    async fn probe(&self, context: &CanonicalContext) -> EnrichmentSourceStatus;

    /// Resolve additive detail for one selected canonical Cell.
    async fn enrich_cell(
        &self,
        out_point: &OutPoint,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<CellSemanticRecord>>;

    /// Resolve additive detail for one transaction reached through a selected
    /// canonical Cell. Implementations must not turn this into an unbounded
    /// background scan.
    async fn enrich_transaction(
        &self,
        _tx_hash: &str,
        _context: &CanonicalContext,
    ) -> anyhow::Result<Option<TransactionSemanticRecord>> {
        Ok(None)
    }
}
