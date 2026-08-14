//! Source-agnostic boundary for optional indexed context.
//!
//! Canonical adapters continue to emit [`cknerv_core::Mutation`] values.
//! Enrichment sources can only describe already-observed chain objects and
//! enter the server through a separate [`cknerv_core::EnrichmentEvent`]
//! channel.

use async_trait::async_trait;

use cknerv_core::{
    ActivityFeedRecord, AssetEcosystemRecord, CellSemanticRecord, CompositionDemand,
    DaoStateRecord, EnrichmentSourceStatus, ForkWatchRecord, GalaxyCompositionCandidates,
    GalaxyCompositionRecord, GalaxyCompositionTopUp, NetworkAtlasRecord, OutPoint,
    ProtocolEraRecord, RecentBlock, RecentTx, ScriptId, ScriptRegistryRecord,
    TransactionHorizonRecord, TransactionSemanticRecord,
};

/// Bounded canonical evidence supplied to an enrichment source when it
/// validates its indexed view or resolves a lazy detail request.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CanonicalContext {
    pub tip: u64,
    pub epoch_number: u64,
    pub chain_name: String,
    pub recent_blocks: Vec<RecentBlock>,
    pub recent_transactions: Vec<RecentTx>,
    pub replay_active: bool,
    /// Which scripts the canonical Cell set is currently holding, from the
    /// projection's own census. A source uses it to name what is actually on
    /// this galaxy rather than to enumerate what exists on the chain; empty
    /// before the first census, which means "nothing to name yet".
    pub observed_scripts: Vec<ScriptId>,
}

/// Source-agnostic validation seam between indexed discovery and structural
/// chain truth. A source may rank outpoints, but only a canonical adapter can
/// turn them into displayable Cells. The resulting record remains outside the
/// canonical mutation/projection stream.
#[async_trait]
pub trait GalaxyCompositionHydrator: Send + Sync + 'static {
    async fn hydrate_galaxy_composition(
        &self,
        candidates: GalaxyCompositionCandidates,
    ) -> anyhow::Result<GalaxyCompositionRecord>;

    /// Validate an ADDITIVE supply through the same trust fence: every
    /// candidate is re-read against the local node, and anything spent
    /// or reclassified since discovery is dropped. `candidates.target`
    /// carries how many of each class the display plane asked for; the
    /// plain bucket is unused (D5).
    async fn hydrate_galaxy_top_up(
        &self,
        candidates: GalaxyCompositionCandidates,
    ) -> anyhow::Result<GalaxyCompositionTopUp>;
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

    /// Refresh one bounded whole-chain asset/capacity sample. Sources without
    /// an efficient aggregate endpoint leave this unsupported; implementations
    /// must never synthesize it with a per-Cell crawl.
    async fn enrich_asset_ecosystem(
        &self,
        _context: &CanonicalContext,
    ) -> anyhow::Result<Option<AssetEcosystemRecord>> {
        Ok(None)
    }

    /// Refresh fixed-shape, whole-chain Nervos DAO statistics. Sources without
    /// an efficient aggregate endpoint leave this unsupported.
    async fn enrich_dao_state(
        &self,
        _context: &CanonicalContext,
    ) -> anyhow::Result<Option<DaoStateRecord>> {
        Ok(None)
    }

    /// Refresh fixed-shape protocol-edition context. Sources without a
    /// bounded current/upcoming-edition endpoint leave this unsupported.
    async fn enrich_protocol_era(
        &self,
        _context: &CanonicalContext,
    ) -> anyhow::Result<Option<ProtocolEraRecord>> {
        Ok(None)
    }

    /// Refresh fixed-work recent/deep-fork context. This supplements canonical
    /// reorg handling and must never drive rollback itself.
    async fn enrich_fork_watch(
        &self,
        _context: &CanonicalContext,
    ) -> anyhow::Result<Option<ForkWatchRecord>> {
        Ok(None)
    }

    /// Refresh one explicitly bounded sample of recent indexed activity.
    /// Sources without a fixed-size endpoint leave this unsupported; this must
    /// not be implemented as transaction-by-transaction background lookups.
    async fn enrich_activity_feed(
        &self,
        _context: &CanonicalContext,
    ) -> anyhow::Result<Option<ActivityFeedRecord>> {
        Ok(None)
    }

    /// Refresh bounded hourly/daily indexed transaction counts. Sources
    /// without a fixed-size summary endpoint leave this unsupported.
    async fn enrich_transaction_horizon(
        &self,
        _context: &CanonicalContext,
    ) -> anyhow::Result<Option<TransactionHorizonRecord>> {
        Ok(None)
    }

    /// Refresh crawler context from an explicitly bounded node page. Sources
    /// without a bounded network endpoint leave this unsupported.
    async fn enrich_network_atlas(
        &self,
        _context: &CanonicalContext,
    ) -> anyhow::Result<Option<NetworkAtlasRecord>> {
        Ok(None)
    }

    /// Name the scripts `context.observed_scripts` reports, so the Cell
    /// panel can call a family by its name instead of by its code hash.
    /// Sources without a script index leave this unsupported; the dashboard
    /// then falls back to the handful of families cknerv pins itself.
    async fn enrich_script_registry(
        &self,
        _context: &CanonicalContext,
    ) -> anyhow::Result<Option<ScriptRegistryRecord>> {
        Ok(None)
    }

    /// Refresh a bounded, canonically validated CellGalaxy background. Indexed
    /// sources discover/rank candidates; implementations without a canonical
    /// hydrator must leave this unsupported.
    async fn enrich_galaxy_composition(
        &self,
        _context: &CanonicalContext,
    ) -> anyhow::Result<Option<GalaxyCompositionRecord>> {
        Ok(None)
    }

    /// Find more cells for the classes the display composition says it is
    /// short of — additive, never a replacement. Sources answer by walking
    /// DEEPER into their own ranking rather than re-reading the head, so
    /// the cost is proportional to the shortfall instead of to the size of
    /// the whole composition. `None` means "nothing further to add".
    async fn enrich_galaxy_top_up(
        &self,
        _context: &CanonicalContext,
        _demand: CompositionDemand,
    ) -> anyhow::Result<Option<GalaxyCompositionTopUp>> {
        Ok(None)
    }
}
