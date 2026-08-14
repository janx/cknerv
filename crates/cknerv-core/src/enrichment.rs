//! Optional, source-agnostic enrichment records for dashboard projections.
//!
//! Structural chain truth continues to arrive as [`crate::Mutation`].  The
//! types in this module describe indexed context that an optional local source
//! (for example ckbadger) can attach to an already-observed outpoint or
//! transaction.  Enrichment is deliberately additive: none of these records
//! can create, spend, or otherwise replace a canonical Cell.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::{Cell, Mutation, OutPoint, Projection};

/// A canonical block used to prove what chain an indexed observation belongs
/// to.  Consumers must treat an enrichment as stale when this anchor is no
/// longer canonical.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChainAnchor {
    pub block: u64,
    pub hash: String,
}

/// Runtime state of an optional enrichment source.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EnrichmentSourceState {
    #[default]
    Disabled,
    Connecting,
    Syncing,
    Ready,
    Stale,
    Incompatible,
    Error,
}

/// Health and freshness of the currently configured enrichment source.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct EnrichmentSourceStatus {
    pub source: String,
    pub status: EnrichmentSourceState,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indexed_tip: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lag_blocks: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub validated_anchor: Option<ChainAnchor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_success_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl EnrichmentSourceStatus {
    pub fn disabled() -> Self {
        Self {
            source: "none".to_string(),
            status: EnrichmentSourceState::Disabled,
            capabilities: Vec::new(),
            indexed_tip: None,
            lag_blocks: None,
            validated_anchor: None,
            last_success_at_ms: None,
            message: None,
        }
    }

    pub fn connecting(source: impl Into<String>, capabilities: Vec<String>) -> Self {
        Self {
            source: source.into(),
            status: EnrichmentSourceState::Connecting,
            capabilities,
            indexed_tip: None,
            lag_blocks: None,
            validated_anchor: None,
            last_success_at_ms: None,
            message: None,
        }
    }
}

impl Default for EnrichmentSourceStatus {
    fn default() -> Self {
        Self::disabled()
    }
}

/// One display-safe scalar decoded by an enrichment source.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SemanticAttribute {
    pub key: String,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
}

/// A generic protocol/data facet.  Source-specific DTOs are normalized to
/// this typed list before crossing into cknerv-core; arbitrary JSON never
/// enters the projection contract.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SemanticFacet {
    pub namespace: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(default)]
    pub attributes: Vec<SemanticAttribute>,
}

/// Raw script identity plus an optional index-provided family label.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SemanticScript {
    pub script_hash: String,
    pub code_hash: String,
    pub hash_type: String,
    pub args: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deprecated: Option<bool>,
}

/// Optional fungible/non-fungible asset label attached to a Cell.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SemanticAsset {
    pub type_script_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub standard: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decimals: Option<u8>,
}

/// Indexed occupied-capacity explanation.  Values are bytes, not shannons.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommonKnowledgeBreakdown {
    pub total_bytes: u64,
    pub capacity_field_bytes: u64,
    pub lock_script_bytes: u64,
    pub type_script_bytes: u64,
    pub data_bytes: u64,
}

/// One exact byte range inside a deterministic Cell-data interpretation.
/// Ranges are half-open (`start_byte..end_byte`) and refer to the complete
/// payload, even when [`SemanticCellContent::data_hex`] carries only a bounded
/// prefix.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SemanticContentSegment {
    pub label: String,
    pub start_byte: u64,
    pub end_byte: u64,
    pub meaning: String,
    pub value: String,
}

/// A source-provided deterministic interpretation of canonical Cell data.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SemanticContentDecode {
    pub kind: String,
    pub summary: String,
    #[serde(default)]
    pub segments: Vec<SemanticContentSegment>,
}

/// One explicitly non-deterministic interpretation of canonical Cell data.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SemanticContentGuess {
    pub kind: String,
    pub confidence: String,
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

/// Display-safe content evidence for one canonical Cell. `data_hex` is an
/// optional bounded prefix and follows the canonical Cell convention of a
/// trailing `…` when truncated. `total_bytes` and interpretation ranges always
/// describe the complete payload.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SemanticCellContent {
    pub total_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_hex: Option<String>,
    pub data_complete: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deterministic: Option<SemanticContentDecode>,
    #[serde(default)]
    pub heuristics: Vec<SemanticContentGuess>,
}

/// Additive context for one canonical outpoint.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CellSemanticRecord {
    pub out_point: OutPoint,
    pub source: String,
    pub as_of: ChainAnchor,
    pub observed_at_block: u64,
    pub updated_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lock_script: Option<SemanticScript>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_script: Option<SemanticScript>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset: Option<SemanticAsset>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub common_knowledge: Option<CommonKnowledgeBreakdown>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<SemanticCellContent>,
    #[serde(default)]
    pub facets: Vec<SemanticFacet>,
}

/// One participant's indexed value deltas inside a transaction.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransactionParticipantSemantic {
    pub address: String,
    /// Signed shannon delta when every input/output attributed to this address
    /// exposed an exact capacity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capacity_delta: Option<String>,
    /// Signed occupied-byte delta when the source can attribute it exactly.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub common_knowledge_delta: Option<String>,
    #[serde(default)]
    pub facets: Vec<SemanticFacet>,
}

/// Indexed interpretation of a transaction that cknerv has already observed
/// canonically.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransactionSemanticRecord {
    pub tx_hash: String,
    pub block: u64,
    pub source: String,
    pub as_of: ChainAnchor,
    pub updated_at_ms: u64,
    #[serde(default)]
    pub actions: Vec<SemanticFacet>,
    #[serde(default)]
    pub participants: Vec<TransactionParticipantSemantic>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fee: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cycles: Option<u64>,
}

/// Exact indexed global counts, kept distinct from cknerv's bounded retained
/// Cell reservoir.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChainCensus {
    pub source: String,
    pub as_of: ChainAnchor,
    pub updated_at_ms: u64,
    pub live_cells: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_cells: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dead_cells: Option<u64>,
}

/// Fixed CellGalaxy composition contract. The record remains enrichment-only:
/// indexed candidates are admitted only after a canonical adapter validates
/// each live outpoint, and they never enter the structural Cell projection or
/// its Birth/Death/Link/Pulse stream.
pub const GALAXY_COMPOSITION_DAO_BPS: u16 = 3_000;
pub const GALAXY_COMPOSITION_TYPED_BPS: u16 = 4_000;
pub const GALAXY_COMPOSITION_PLAIN_BPS: u16 = 3_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct GalaxyCompositionTarget {
    pub dao: usize,
    pub typed: usize,
    pub plain: usize,
}

impl GalaxyCompositionTarget {
    pub fn for_total(total: usize) -> Self {
        let dao = total.saturating_mul(GALAXY_COMPOSITION_DAO_BPS as usize) / 10_000;
        let typed = total.saturating_mul(GALAXY_COMPOSITION_TYPED_BPS as usize) / 10_000;
        Self {
            dao,
            typed,
            plain: total.saturating_sub(dao).saturating_sub(typed),
        }
    }

    pub fn total(self) -> usize {
        self.dao
            .saturating_add(self.typed)
            .saturating_add(self.plain)
    }
}

/// One ckbadger-discovered live-outpoint candidate. Capacity and birth height
/// are discovery hints only; a canonical hydrator must re-read the live Cell
/// and reject mismatches before it can cross the shared wire boundary.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GalaxyCellCandidate {
    pub out_point: OutPoint,
    pub capacity: u64,
    pub birth_block: u64,
}

/// Source-private handoff from indexed discovery to canonical validation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GalaxyCompositionCandidates {
    pub source: String,
    pub as_of: ChainAnchor,
    pub updated_at_ms: u64,
    pub target: GalaxyCompositionTarget,
    pub dao: Vec<GalaxyCellCandidate>,
    pub typed: Vec<GalaxyCellCandidate>,
    pub plain: Vec<GalaxyCellCandidate>,
}

/// Canonically validated background Cell set used to compose the resting
/// galaxy. It is deliberately separate from `CellGalaxySnapshot`: replacing
/// this record cannot synthesize chain activity or disturb live nerve routing.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct GalaxyCompositionRecord {
    pub source: String,
    pub as_of: ChainAnchor,
    pub updated_at_ms: u64,
    #[serde(default)]
    pub dao: Vec<Cell>,
    #[serde(default)]
    pub typed: Vec<Cell>,
    #[serde(default)]
    pub plain: Vec<Cell>,
}

impl GalaxyCompositionRecord {
    /// Content equality ignoring the per-refresh freshness metadata
    /// (`as_of`, `updated_at_ms`), which advance on every successful
    /// revalidation regardless of whether the composed Cell set changed.
    /// A refresh whose content matches the previously broadcast record is
    /// a duplicate for wire purposes: subscribers key off the Cell
    /// content, and the client reducer likewise keeps its previous record
    /// (frozen anchors included) when content is unchanged.
    pub fn content_matches(&self, other: &Self) -> bool {
        self.source == other.source
            && self.dao == other.dao
            && self.typed == other.typed
            && self.plain == other.plain
    }
}

/// An ADDITIVE handoff for the curated display composition: cells found
/// for the classes the stage said it was short of.
///
/// Deliberately not a [`GalaxyCompositionRecord`]. A record is a whole
/// replacement — it re-derives the entire membership and carries the
/// content-dedupe and degrade semantics that go with that. A top-up
/// only ever adds, so reusing the replace shape would make both the
/// dedupe and the degrade predicate meaningless.
///
/// Plain is absent by design (D5): plain slots stay fed by the canonical
/// fallback stream, which is what keeps recent chain births and deaths
/// visible in the resting field.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct GalaxyCompositionTopUp {
    pub source: String,
    pub as_of: ChainAnchor,
    pub updated_at_ms: u64,
    #[serde(default)]
    pub dao: Vec<Cell>,
    #[serde(default)]
    pub typed: Vec<Cell>,
}

impl GalaxyCompositionTopUp {
    pub fn is_empty(&self) -> bool {
        self.dao.is_empty() && self.typed.is_empty()
    }

    pub fn len(&self) -> usize {
        self.dao.len() + self.typed.len()
    }
}

/// One exact capacity bucket from a bounded indexed ecosystem sample.
/// Capacity is encoded in shannons so adapters cannot leak display-unit
/// rounding into the shared wire contract.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssetEcosystemCategory {
    pub category: String,
    pub capacity_shannons: String,
    /// Share of total live capacity in basis points (`10_000 == 100%`).
    pub share_bps: u16,
}

/// One bounded, index-ranked asset from an ecosystem sample.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssetEcosystemLeader {
    pub type_script_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    pub holders_count: u64,
    pub total_capacity_shannons: String,
}

/// Bounded whole-chain asset/capacity context from an optional indexed
/// source. `as_of` proves chain compatibility; this record never changes the
/// canonical Cell reservoir or its locally observed counters.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssetEcosystemRecord {
    pub source: String,
    pub as_of: ChainAnchor,
    pub updated_at_ms: u64,
    pub total_live_capacity_shannons: String,
    pub total_knowledge_bytes: u64,
    #[serde(default)]
    pub capacity_breakdown: Vec<AssetEcosystemCategory>,
    #[serde(default)]
    pub top_assets: Vec<AssetEcosystemLeader>,
}

/// Fixed-shape, whole-chain Nervos DAO context from an optional index. Values
/// remain exact integer shannons; the source's own statistics block is kept
/// separate from the canonical compatibility anchor.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct DaoStateRecord {
    pub source: String,
    pub as_of: ChainAnchor,
    pub statistics_block: u64,
    pub updated_at_ms: u64,
    pub total_deposited_shannons: String,
    pub total_depositors: u32,
    pub active_deposits: u32,
    pub pending_withdrawal_shannons: String,
    pub unclaimed_compensation_shannons: String,
    /// Estimated annual percentage compensation in basis points.
    pub estimated_apc_bps: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deposit_change_24h_shannons: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depositors_change_24h: Option<i32>,
}

/// Upper bound on registry entries admitted from a source. The catalogue it
/// is built from has 66 script families and the census it answers is cut at
/// 24 per role, so this is generous; it exists because a wire contract with
/// no bound is a wire contract a source can flood.
pub const MAX_SCRIPT_REGISTRY_ENTRIES: usize = 256;

/// A name for one script identity, from an index that tracks far more script
/// families than cknerv pins itself.
///
/// This is the other half of the Cell projection's script census: that side
/// counts identities and refuses to name them, this side names them and
/// counts nothing. They meet in the browser, joined on `code_hash` +
/// `hash_type`, which is why neither has to trust the other's scope.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScriptNameRecord {
    pub code_hash: String,
    pub hash_type: String,
    /// The family name as the index spells it — "Default Lock", "JoyID".
    pub name: String,
    /// The index's own one-line description, when it published one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// `"lock"` / `"type"` when the index classifies the family's role.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub website: Option<String>,
    #[serde(default)]
    pub deprecated: bool,
}

/// Names for the scripts the canonical set is currently holding.
///
/// Bounded by what cknerv observed rather than by what the index knows: the
/// question being answered is "what is on my galaxy", not "what exists on
/// CKB", so an index with a thousand families still produces a record sized
/// by the census.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScriptRegistryRecord {
    pub source: String,
    pub as_of: ChainAnchor,
    pub updated_at_ms: u64,
    #[serde(default)]
    pub entries: Vec<ScriptNameRecord>,
    /// Observed identities the index had no name for. Counted, not listed:
    /// the panel already holds those code hashes from the census, and this
    /// only has to say that asking produced nothing.
    #[serde(default)]
    pub unresolved: u32,
}

/// One normalized CKB edition activation from an optional protocol index.
/// The short display name is source-owned context; activation coordinates
/// remain exact chain positions.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProtocolEra {
    pub name: String,
    pub edition_year: u16,
    pub activation_epoch: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activation_block: Option<u64>,
}

/// Fixed-shape protocol-era context from an optional index. The record keeps
/// only the newest activated edition and earliest upcoming edition, never the
/// source's full resource catalogue. `as_of` proves compatibility with the
/// canonical chain while indexed tip fields describe the source snapshot.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProtocolEraRecord {
    pub source: String,
    pub as_of: ChainAnchor,
    pub updated_at_ms: u64,
    pub network: String,
    pub indexed_tip_block: u64,
    pub indexed_tip_epoch: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current: Option<ProtocolEra>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upcoming: Option<ProtocolEra>,
}

/// Classification of one indexed canonical-fork event.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ForkWatchEventKind {
    Reorg,
    Deep,
}

/// Fixed summary of the newest fork event while it remains inside the
/// source's explicitly stated recent window.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ForkWatchReorg {
    pub detected_at_ms: u64,
    pub fork_point: u64,
    pub old_tip: u64,
    pub new_tip: u64,
    pub depth: u32,
    pub orphaned_blocks: u64,
    pub orphaned_transactions: u64,
    pub kind: ForkWatchEventKind,
}

/// Active deep-fork disagreement reported by an optional index. `indexed_tip`
/// is the source's persisted database view; `chain_tip` is its live-node view.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ForkWatchDeepFork {
    pub detected_at_ms: u64,
    pub fork_point: u64,
    pub indexed_tip: u64,
    pub chain_tip: u64,
    pub depth: u32,
}

/// Fixed-work fork monitor from an optional index. It supplements, but never
/// changes, cknerv's canonical reorg detection and cumulative reorg counter.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ForkWatchRecord {
    pub source: String,
    pub as_of: ChainAnchor,
    pub updated_at_ms: u64,
    pub recent_window_seconds: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recent_reorg: Option<ForkWatchReorg>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deep_fork: Option<ForkWatchDeepFork>,
}

/// One compact transaction signature from a bounded recent-activity feed.
/// The category and label are display-safe adapter normalizations; raw source
/// JSON and participant addresses never cross the shared contract.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActivityFeedItem {
    pub tx_hash: String,
    pub block: u64,
    pub timestamp_ms: u64,
    pub category: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub participant_count: u32,
}

/// A small, index-ranked view of the newest canonical transaction activity.
/// This is a sample, not a transaction count or historical activity census.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActivityFeedRecord {
    pub source: String,
    pub as_of: ChainAnchor,
    pub updated_at_ms: u64,
    #[serde(default)]
    pub activities: Vec<ActivityFeedItem>,
}

/// Bounded indexed transaction-count context. Hourly and daily buckets are
/// ordered oldest-to-newest and intentionally carry counts only: source-local
/// presentation labels do not cross the shared wire contract, and no timezone
/// is inferred from their absence. Current-hour/day values retain their
/// explicitly indexed, source-defined bucket meaning.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransactionHorizonRecord {
    pub source: String,
    pub as_of: ChainAnchor,
    pub updated_at_ms: u64,
    pub current_hour: u64,
    pub current_day: u64,
    #[serde(default)]
    pub hourly_counts: Vec<u64>,
    #[serde(default)]
    pub daily_counts: Vec<u64>,
}

/// One display-safe label count derived from a bounded network-node sample.
/// Individual peer identities and addresses never cross this contract.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct NetworkAtlasBucket {
    pub label: String,
    pub count: u32,
}

/// Bounded context from an optional network crawler. The crawl summary can
/// describe the source's whole known set, while countries, versions, and RTT
/// are derived only from the explicitly limited latest-node sample.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct NetworkAtlasRecord {
    pub source: String,
    pub as_of: ChainAnchor,
    pub updated_at_ms: u64,
    pub crawl_round: u64,
    pub crawl_finished_at_s: u64,
    pub total_known: u64,
    pub last_round_dialed: u64,
    pub last_round_reachable: u64,
    pub new_nodes: u64,
    pub frontier_drained: bool,
    pub sample_size: u32,
    pub sample_reachable: u32,
    pub sample_truncated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub median_rtt_ms: Option<u32>,
    #[serde(default)]
    pub countries: Vec<NetworkAtlasBucket>,
    #[serde(default)]
    pub versions: Vec<NetworkAtlasBucket>,
}

/// Source events entering the semantics projection.  They use a separate
/// server-side pipeline from canonical [`crate::Mutation`] values.
#[derive(Clone, Debug, PartialEq)]
pub enum EnrichmentEvent {
    SourceStatus(EnrichmentSourceStatus),
    CellUpsert(Box<CellSemanticRecord>),
    TransactionUpsert(Box<TransactionSemanticRecord>),
    CensusReplace(ChainCensus),
    AssetEcosystemReplace(AssetEcosystemRecord),
    DaoStateReplace(DaoStateRecord),
    ProtocolEraReplace(ProtocolEraRecord),
    ForkWatchReplace(ForkWatchRecord),
    ActivityFeedReplace(ActivityFeedRecord),
    TransactionHorizonReplace(TransactionHorizonRecord),
    NetworkAtlasReplace(NetworkAtlasRecord),
    NetworkAtlasClear,
    ScriptRegistryReplace(Box<ScriptRegistryRecord>),
    GalaxyCompositionReplace(GalaxyCompositionRecord),
    /// Additive supply for the curated composition, in answer to the
    /// display plane's published shortfall.
    GalaxyCompositionTopUp(GalaxyCompositionTopUp),
    Clear,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct SemanticsSnapshot {
    pub source: EnrichmentSourceStatus,
    pub cells: Vec<CellSemanticRecord>,
    pub transactions: Vec<TransactionSemanticRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub census: Option<ChainCensus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_ecosystem: Option<AssetEcosystemRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dao_state: Option<DaoStateRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol_era: Option<ProtocolEraRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fork_watch: Option<ForkWatchRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity_feed: Option<ActivityFeedRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transaction_horizon: Option<TransactionHorizonRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub network_atlas: Option<NetworkAtlasRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script_registry: Option<ScriptRegistryRecord>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SemanticsDelta {
    SourceStatus {
        source: EnrichmentSourceStatus,
    },
    CellUpsert {
        cell: Box<CellSemanticRecord>,
    },
    CellRemove {
        out_point: OutPoint,
    },
    TransactionUpsert {
        transaction: Box<TransactionSemanticRecord>,
    },
    TransactionRemove {
        tx_hash: String,
    },
    CensusReplace {
        census: ChainCensus,
    },
    AssetEcosystemReplace {
        asset_ecosystem: AssetEcosystemRecord,
    },
    DaoStateReplace {
        dao_state: DaoStateRecord,
    },
    ProtocolEraReplace {
        protocol_era: ProtocolEraRecord,
    },
    ForkWatchReplace {
        fork_watch: ForkWatchRecord,
    },
    ActivityFeedReplace {
        activity_feed: ActivityFeedRecord,
    },
    TransactionHorizonReplace {
        transaction_horizon: TransactionHorizonRecord,
    },
    NetworkAtlasReplace {
        network_atlas: NetworkAtlasRecord,
    },
    NetworkAtlasClear,
    ScriptRegistryReplace {
        script_registry: Box<ScriptRegistryRecord>,
    },
    Prune {
        from_block: u64,
    },
    Clear,
}

/// Projection extension for a second, explicitly non-canonical input stream.
pub trait EnrichmentProjection: Projection {
    fn apply_enrichment(&mut self, event: &EnrichmentEvent) -> Vec<Self::Delta>;
}

/// Bounded optional semantic index exposed as `/api/projections/semantics`.
/// It is intentionally not persisted; a configured source rehydrates it.
pub struct SemanticsProjection {
    source: EnrichmentSourceStatus,
    cells: HashMap<OutPoint, (u64, CellSemanticRecord)>,
    transactions: HashMap<String, (u64, TransactionSemanticRecord)>,
    census: Option<ChainCensus>,
    asset_ecosystem: Option<AssetEcosystemRecord>,
    dao_state: Option<DaoStateRecord>,
    protocol_era: Option<ProtocolEraRecord>,
    fork_watch: Option<ForkWatchRecord>,
    activity_feed: Option<ActivityFeedRecord>,
    transaction_horizon: Option<TransactionHorizonRecord>,
    network_atlas: Option<NetworkAtlasRecord>,
    script_registry: Option<ScriptRegistryRecord>,
    next_sequence: u64,
    cell_cap: usize,
    transaction_cap: usize,
}

impl SemanticsProjection {
    pub fn new(configured_source: Option<(&str, Vec<String>)>) -> Self {
        let source = configured_source
            .map_or_else(EnrichmentSourceStatus::disabled, |(name, caps)| {
                EnrichmentSourceStatus::connecting(name, caps)
            });
        Self {
            source,
            cells: HashMap::new(),
            transactions: HashMap::new(),
            census: None,
            asset_ecosystem: None,
            dao_state: None,
            protocol_era: None,
            fork_watch: None,
            activity_feed: None,
            transaction_horizon: None,
            network_atlas: None,
            script_registry: None,
            next_sequence: 0,
            cell_cap: 512,
            transaction_cap: 2048,
        }
    }

    pub fn with_caps(mut self, cell_cap: usize, transaction_cap: usize) -> Self {
        self.cell_cap = cell_cap.max(1);
        self.transaction_cap = transaction_cap.max(1);
        self
    }

    fn next_sequence(&mut self) -> u64 {
        self.next_sequence = self.next_sequence.saturating_add(1);
        self.next_sequence
    }

    fn enforce_cell_cap(&mut self) -> Vec<OutPoint> {
        let mut removed = Vec::new();
        while self.cells.len() > self.cell_cap {
            let Some(oldest) = self
                .cells
                .iter()
                .min_by_key(|(_, (sequence, _))| *sequence)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            self.cells.remove(&oldest);
            removed.push(oldest);
        }
        removed
    }

    fn enforce_transaction_cap(&mut self) -> Vec<String> {
        let mut removed = Vec::new();
        while self.transactions.len() > self.transaction_cap {
            let Some(oldest) = self
                .transactions
                .iter()
                .min_by_key(|(_, (sequence, _))| *sequence)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            self.transactions.remove(&oldest);
            removed.push(oldest);
        }
        removed
    }

    fn clear_records(&mut self) {
        self.cells.clear();
        self.transactions.clear();
        self.census = None;
        self.asset_ecosystem = None;
        self.dao_state = None;
        self.protocol_era = None;
        self.fork_watch = None;
        self.activity_feed = None;
        self.transaction_horizon = None;
        self.network_atlas = None;
        self.script_registry = None;
    }

    fn invalidate_source_anchor(&mut self, message: &str) -> Option<SemanticsDelta> {
        if self.source.status == EnrichmentSourceState::Disabled {
            return None;
        }
        self.source.status = EnrichmentSourceState::Syncing;
        self.source.validated_anchor = None;
        self.source.message = Some(message.to_string());
        Some(SemanticsDelta::SourceStatus {
            source: self.source.clone(),
        })
    }
}

impl Default for SemanticsProjection {
    fn default() -> Self {
        Self::new(None)
    }
}

impl Projection for SemanticsProjection {
    type Snapshot = SemanticsSnapshot;
    type Delta = SemanticsDelta;

    fn name(&self) -> &'static str {
        "semantics"
    }

    fn snapshot(&self) -> Self::Snapshot {
        let mut cells: Vec<_> = self
            .cells
            .values()
            .map(|(_, value)| value.clone())
            .collect();
        cells.sort_by(|a, b| {
            a.out_point
                .tx_hash
                .cmp(&b.out_point.tx_hash)
                .then(a.out_point.index.cmp(&b.out_point.index))
        });
        let mut transactions: Vec<_> = self
            .transactions
            .values()
            .map(|(_, value)| value.clone())
            .collect();
        transactions.sort_by(|a, b| a.tx_hash.cmp(&b.tx_hash));
        SemanticsSnapshot {
            source: self.source.clone(),
            cells,
            transactions,
            census: self.census.clone(),
            asset_ecosystem: self.asset_ecosystem.clone(),
            dao_state: self.dao_state.clone(),
            protocol_era: self.protocol_era.clone(),
            fork_watch: self.fork_watch.clone(),
            activity_feed: self.activity_feed.clone(),
            transaction_horizon: self.transaction_horizon.clone(),
            network_atlas: self.network_atlas.clone(),
            script_registry: self.script_registry.clone(),
        }
    }

    fn apply_mutation(&mut self, mutation: &Mutation) -> Vec<Self::Delta> {
        match mutation {
            Mutation::ChainReorganized { from_block } => {
                self.cells
                    .retain(|_, (_, record)| record.as_of.block < *from_block);
                self.transactions.retain(|_, (_, record)| {
                    record.block < *from_block && record.as_of.block < *from_block
                });
                if self
                    .census
                    .as_ref()
                    .is_some_and(|census| census.as_of.block >= *from_block)
                {
                    self.census = None;
                }
                if self
                    .asset_ecosystem
                    .as_ref()
                    .is_some_and(|ecosystem| ecosystem.as_of.block >= *from_block)
                {
                    self.asset_ecosystem = None;
                }
                if self
                    .dao_state
                    .as_ref()
                    .is_some_and(|dao| dao.as_of.block >= *from_block)
                {
                    self.dao_state = None;
                }
                if self
                    .protocol_era
                    .as_ref()
                    .is_some_and(|era| era.as_of.block >= *from_block)
                {
                    self.protocol_era = None;
                }
                if self
                    .fork_watch
                    .as_ref()
                    .is_some_and(|watch| watch.as_of.block >= *from_block)
                {
                    self.fork_watch = None;
                }
                if self
                    .activity_feed
                    .as_ref()
                    .is_some_and(|feed| feed.as_of.block >= *from_block)
                {
                    self.activity_feed = None;
                }
                if self
                    .transaction_horizon
                    .as_ref()
                    .is_some_and(|horizon| horizon.as_of.block >= *from_block)
                {
                    self.transaction_horizon = None;
                }
                if self
                    .network_atlas
                    .as_ref()
                    .is_some_and(|atlas| atlas.as_of.block >= *from_block)
                {
                    self.network_atlas = None;
                }
                // A script's name does not depend on the tip, but the record
                // proving it came from a compatible index does. Dropped on
                // the same rule as every other anchored record, and the next
                // refresh re-proves it.
                if self
                    .script_registry
                    .as_ref()
                    .is_some_and(|registry| registry.as_of.block >= *from_block)
                {
                    self.script_registry = None;
                }
                let mut deltas = vec![SemanticsDelta::Prune {
                    from_block: *from_block,
                }];
                if let Some(status) = self.invalidate_source_anchor(
                    "canonical chain changed; waiting for source revalidation",
                ) {
                    deltas.push(status);
                }
                deltas
            }
            Mutation::ChainRebuild { .. } => {
                self.clear_records();
                let mut deltas = vec![SemanticsDelta::Clear];
                if let Some(status) = self.invalidate_source_anchor(
                    "canonical state rebuilt; waiting for source revalidation",
                ) {
                    deltas.push(status);
                }
                deltas
            }
            _ => Vec::new(),
        }
    }
}

impl EnrichmentProjection for SemanticsProjection {
    fn apply_enrichment(&mut self, event: &EnrichmentEvent) -> Vec<Self::Delta> {
        match event {
            EnrichmentEvent::SourceStatus(source) => {
                let was_incompatible = self.source.status == EnrichmentSourceState::Incompatible;
                self.source = source.clone();
                let mut deltas = Vec::new();
                if source.status == EnrichmentSourceState::Incompatible && !was_incompatible {
                    self.clear_records();
                    deltas.push(SemanticsDelta::Clear);
                }
                deltas.push(SemanticsDelta::SourceStatus {
                    source: source.clone(),
                });
                deltas
            }
            EnrichmentEvent::CellUpsert(cell) => {
                let sequence = self.next_sequence();
                self.cells
                    .insert(cell.out_point.clone(), (sequence, cell.as_ref().clone()));
                let mut deltas = vec![SemanticsDelta::CellUpsert { cell: cell.clone() }];
                deltas.extend(
                    self.enforce_cell_cap()
                        .into_iter()
                        .map(|out_point| SemanticsDelta::CellRemove { out_point }),
                );
                deltas
            }
            EnrichmentEvent::TransactionUpsert(transaction) => {
                let sequence = self.next_sequence();
                self.transactions.insert(
                    transaction.tx_hash.clone(),
                    (sequence, transaction.as_ref().clone()),
                );
                let mut deltas = vec![SemanticsDelta::TransactionUpsert {
                    transaction: transaction.clone(),
                }];
                deltas.extend(
                    self.enforce_transaction_cap()
                        .into_iter()
                        .map(|tx_hash| SemanticsDelta::TransactionRemove { tx_hash }),
                );
                deltas
            }
            EnrichmentEvent::CensusReplace(census) => {
                self.census = Some(census.clone());
                vec![SemanticsDelta::CensusReplace {
                    census: census.clone(),
                }]
            }
            EnrichmentEvent::AssetEcosystemReplace(asset_ecosystem) => {
                self.asset_ecosystem = Some(asset_ecosystem.clone());
                vec![SemanticsDelta::AssetEcosystemReplace {
                    asset_ecosystem: asset_ecosystem.clone(),
                }]
            }
            EnrichmentEvent::DaoStateReplace(dao_state) => {
                self.dao_state = Some(dao_state.clone());
                vec![SemanticsDelta::DaoStateReplace {
                    dao_state: dao_state.clone(),
                }]
            }
            EnrichmentEvent::ProtocolEraReplace(protocol_era) => {
                self.protocol_era = Some(protocol_era.clone());
                vec![SemanticsDelta::ProtocolEraReplace {
                    protocol_era: protocol_era.clone(),
                }]
            }
            EnrichmentEvent::ForkWatchReplace(fork_watch) => {
                self.fork_watch = Some(fork_watch.clone());
                vec![SemanticsDelta::ForkWatchReplace {
                    fork_watch: fork_watch.clone(),
                }]
            }
            EnrichmentEvent::ActivityFeedReplace(activity_feed) => {
                self.activity_feed = Some(activity_feed.clone());
                vec![SemanticsDelta::ActivityFeedReplace {
                    activity_feed: activity_feed.clone(),
                }]
            }
            EnrichmentEvent::TransactionHorizonReplace(transaction_horizon) => {
                self.transaction_horizon = Some(transaction_horizon.clone());
                vec![SemanticsDelta::TransactionHorizonReplace {
                    transaction_horizon: transaction_horizon.clone(),
                }]
            }
            EnrichmentEvent::NetworkAtlasReplace(network_atlas) => {
                self.network_atlas = Some(network_atlas.clone());
                vec![SemanticsDelta::NetworkAtlasReplace {
                    network_atlas: network_atlas.clone(),
                }]
            }
            EnrichmentEvent::NetworkAtlasClear => {
                self.network_atlas = None;
                vec![SemanticsDelta::NetworkAtlasClear]
            }
            EnrichmentEvent::ScriptRegistryReplace(script_registry) => {
                self.script_registry = Some(*script_registry.clone());
                vec![SemanticsDelta::ScriptRegistryReplace {
                    script_registry: script_registry.clone(),
                }]
            }
            EnrichmentEvent::GalaxyCompositionReplace(_)
            | EnrichmentEvent::GalaxyCompositionTopUp(_) => {
                // Composition input is display-plane input, not a semantic
                // record: the server reducer installs it into the canonical
                // stream as `Mutation::GalaxyReservoirReplaced` /
                // `GalaxyReservoirToppedUp` and the cells projection stages
                // it. Content dedup, reorg degrade, the ratchet, and the
                // resulting wire deltas all live there — semantics
                // deliberately holds nothing.
                Vec::new()
            }
            EnrichmentEvent::Clear => {
                self.clear_records();
                vec![SemanticsDelta::Clear]
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cell(block: u64, suffix: &str) -> CellSemanticRecord {
        CellSemanticRecord {
            out_point: OutPoint {
                tx_hash: format!("0x{suffix}"),
                index: 0,
            },
            source: "ckbadger".into(),
            as_of: ChainAnchor {
                block,
                hash: format!("0xblock{block}"),
            },
            observed_at_block: block.saturating_sub(1),
            updated_at_ms: block,
            address: None,
            cell_type: None,
            lock_script: None,
            type_script: None,
            asset: None,
            common_knowledge: None,
            content: None,
            facets: Vec::new(),
        }
    }

    fn ecosystem(block: u64) -> AssetEcosystemRecord {
        AssetEcosystemRecord {
            source: "ckbadger".into(),
            as_of: ChainAnchor {
                block,
                hash: format!("0xblock{block}"),
            },
            updated_at_ms: block,
            total_live_capacity_shannons: "100000000000000".into(),
            total_knowledge_bytes: 12_345,
            capacity_breakdown: vec![AssetEcosystemCategory {
                category: "dao".into(),
                capacity_shannons: "25000000000000".into(),
                share_bps: 2_500,
            }],
            top_assets: Vec::new(),
        }
    }

    fn activity_feed(block: u64) -> ActivityFeedRecord {
        ActivityFeedRecord {
            source: "ckbadger".into(),
            as_of: ChainAnchor {
                block,
                hash: format!("0xblock{block}"),
            },
            updated_at_ms: block,
            activities: vec![ActivityFeedItem {
                tx_hash: "0xactivity".into(),
                block,
                timestamp_ms: block,
                category: "script".into(),
                label: Some("Example Script".into()),
                participant_count: 1,
            }],
        }
    }

    fn transaction_horizon(block: u64) -> TransactionHorizonRecord {
        TransactionHorizonRecord {
            source: "ckbadger".into(),
            as_of: ChainAnchor {
                block,
                hash: format!("0xblock{block}"),
            },
            updated_at_ms: block,
            current_hour: 12,
            current_day: 345,
            hourly_counts: vec![7, 9, 12],
            daily_counts: vec![300, 321, 345],
        }
    }

    fn dao_state(block: u64) -> DaoStateRecord {
        DaoStateRecord {
            source: "ckbadger".into(),
            as_of: ChainAnchor {
                block,
                hash: format!("0xblock{block}"),
            },
            statistics_block: block.saturating_sub(1),
            updated_at_ms: block,
            total_deposited_shannons: "837703738002110308".into(),
            total_depositors: 16_740,
            active_deposits: 22_659,
            pending_withdrawal_shannons: "77523020877862416".into(),
            unclaimed_compensation_shannons: "81345902996799859".into(),
            estimated_apc_bps: 201,
            deposit_change_24h_shannons: Some("141530599353229".into()),
            depositors_change_24h: Some(5),
        }
    }

    fn protocol_era(block: u64) -> ProtocolEraRecord {
        ProtocolEraRecord {
            source: "ckbadger".into(),
            as_of: ChainAnchor {
                block,
                hash: format!("0xblock{block}"),
            },
            updated_at_ms: block,
            network: "mainnet".into(),
            indexed_tip_block: block,
            indexed_tip_epoch: 12_300,
            current: Some(ProtocolEra {
                name: "Meepo".into(),
                edition_year: 2024,
                activation_epoch: 12_293,
                activation_block: Some(block.saturating_sub(1)),
            }),
            upcoming: None,
        }
    }

    fn fork_watch(block: u64) -> ForkWatchRecord {
        ForkWatchRecord {
            source: "ckbadger".into(),
            as_of: ChainAnchor {
                block,
                hash: format!("0xblock{block}"),
            },
            updated_at_ms: block,
            recent_window_seconds: 86_400,
            recent_reorg: Some(ForkWatchReorg {
                detected_at_ms: block,
                fork_point: block.saturating_sub(3),
                old_tip: block.saturating_sub(1),
                new_tip: block,
                depth: 2,
                orphaned_blocks: 2,
                orphaned_transactions: 7,
                kind: ForkWatchEventKind::Deep,
            }),
            deep_fork: Some(ForkWatchDeepFork {
                detected_at_ms: block,
                fork_point: block.saturating_sub(3),
                indexed_tip: block.saturating_sub(1),
                chain_tip: block,
                depth: 2,
            }),
        }
    }

    fn network_atlas(block: u64) -> NetworkAtlasRecord {
        NetworkAtlasRecord {
            source: "ckbadger".into(),
            as_of: ChainAnchor {
                block,
                hash: format!("0xblock{block}"),
            },
            updated_at_ms: block,
            crawl_round: 7,
            crawl_finished_at_s: block,
            total_known: 42,
            last_round_dialed: 12,
            last_round_reachable: 9,
            new_nodes: 3,
            frontier_drained: true,
            sample_size: 2,
            sample_reachable: 1,
            sample_truncated: true,
            median_rtt_ms: Some(24),
            countries: vec![NetworkAtlasBucket {
                label: "SG".into(),
                count: 2,
            }],
            versions: vec![NetworkAtlasBucket {
                label: "0.119.0".into(),
                count: 2,
            }],
        }
    }

    fn galaxy_cell(id: u64, asset_kind: crate::AssetKind) -> Cell {
        Cell {
            id,
            born_at_ms: 0,
            death_at_ms: None,
            birth_block: 1,
            tag: None,
            pos_seed: crate::helix_seed_for(id),
            out_point: OutPoint {
                tx_hash: format!("0x{id:064x}"),
                index: 0,
            },
            capacity: id,
            data_hex: "0x".into(),
            content_hash: format!("0x{:064x}", id + 1),
            lock_kind: crate::LockKind::Sighash,
            asset_kind,
            lock_script: Default::default(),
            type_script: None,
        }
    }

    fn galaxy_composition(block: u64) -> GalaxyCompositionRecord {
        GalaxyCompositionRecord {
            source: "ckbadger".into(),
            as_of: ChainAnchor {
                block,
                hash: format!("0xblock{block}"),
            },
            updated_at_ms: block,
            dao: vec![galaxy_cell(1, crate::AssetKind::Dao)],
            typed: vec![galaxy_cell(2, crate::AssetKind::Xudt)],
            plain: vec![galaxy_cell(3, crate::AssetKind::Native)],
        }
    }

    #[test]
    fn galaxy_composition_target_is_exact_30_40_30() {
        assert_eq!(
            GalaxyCompositionTarget::for_total(6_000),
            GalaxyCompositionTarget {
                dao: 1_800,
                typed: 2_400,
                plain: 1_800,
            }
        );
        assert_eq!(GalaxyCompositionTarget::for_total(7).total(), 7);
    }

    /// The composition record is display-plane input, not semantics: the
    /// server reducer routes it to the canonical stream and the cells
    /// projection stages it (dedup, degrade, and wire deltas all live
    /// there). Semantics must hold nothing and emit nothing, or the same
    /// membership would reach the browser through two contracts.
    #[test]
    fn galaxy_composition_is_not_a_semantic_record() {
        let mut projection =
            SemanticsProjection::new(Some(("ckbadger", vec!["galaxy_composition".into()])));
        let before = projection.snapshot();

        let deltas = projection.apply_enrichment(&EnrichmentEvent::GalaxyCompositionReplace(
            galaxy_composition(10),
        ));

        assert!(deltas.is_empty());
        assert_eq!(projection.snapshot(), before);
    }

    #[test]
    fn reorg_prunes_only_records_at_or_above_boundary() {
        let mut projection = SemanticsProjection::new(Some(("ckbadger", vec![])));
        projection.apply_enrichment(&EnrichmentEvent::CellUpsert(Box::new(cell(9, "old"))));
        projection.apply_enrichment(&EnrichmentEvent::CellUpsert(Box::new(cell(10, "new"))));

        let deltas = projection.apply_mutation(&Mutation::ChainReorganized { from_block: 10 });

        assert_eq!(projection.snapshot().cells.len(), 1);
        assert_eq!(projection.snapshot().cells[0].out_point.tx_hash, "0xold");
        assert!(matches!(
            deltas[0],
            SemanticsDelta::Prune { from_block: 10 }
        ));
        assert_eq!(
            projection.snapshot().source.status,
            EnrichmentSourceState::Syncing
        );
    }

    #[test]
    fn incompatible_source_clears_cached_records() {
        let mut projection = SemanticsProjection::new(Some(("ckbadger", vec![])));
        projection.apply_enrichment(&EnrichmentEvent::CellUpsert(Box::new(cell(9, "cell"))));
        let mut status = EnrichmentSourceStatus::connecting("ckbadger", vec![]);
        status.status = EnrichmentSourceState::Incompatible;

        let deltas = projection.apply_enrichment(&EnrichmentEvent::SourceStatus(status));

        assert!(projection.snapshot().cells.is_empty());
        assert!(matches!(deltas[0], SemanticsDelta::Clear));
    }

    #[test]
    fn repeated_incompatible_status_keeps_fresh_deep_fork_diagnostics() {
        let mut projection = SemanticsProjection::new(Some(("ckbadger", vec![])));
        let mut status = EnrichmentSourceStatus::connecting("ckbadger", vec![]);
        status.status = EnrichmentSourceState::Incompatible;
        projection.apply_enrichment(&EnrichmentEvent::SourceStatus(status.clone()));
        projection.apply_enrichment(&EnrichmentEvent::ForkWatchReplace(fork_watch(10)));

        let deltas = projection.apply_enrichment(&EnrichmentEvent::SourceStatus(status));

        assert!(projection.snapshot().fork_watch.is_some());
        assert_eq!(deltas.len(), 1);
        assert!(matches!(deltas[0], SemanticsDelta::SourceStatus { .. }));
    }

    #[test]
    fn reorg_prunes_aggregate_records_at_the_invalidated_anchor() {
        let mut projection = SemanticsProjection::new(Some(("ckbadger", vec![])));
        projection.apply_enrichment(&EnrichmentEvent::AssetEcosystemReplace(ecosystem(10)));
        projection.apply_enrichment(&EnrichmentEvent::DaoStateReplace(dao_state(10)));
        projection.apply_enrichment(&EnrichmentEvent::ProtocolEraReplace(protocol_era(10)));
        projection.apply_enrichment(&EnrichmentEvent::ForkWatchReplace(fork_watch(10)));
        projection.apply_enrichment(&EnrichmentEvent::ActivityFeedReplace(activity_feed(10)));
        projection.apply_enrichment(&EnrichmentEvent::TransactionHorizonReplace(
            transaction_horizon(10),
        ));
        projection.apply_enrichment(&EnrichmentEvent::NetworkAtlasReplace(network_atlas(10)));

        projection.apply_mutation(&Mutation::ChainReorganized { from_block: 10 });

        assert!(projection.snapshot().asset_ecosystem.is_none());
        assert!(projection.snapshot().dao_state.is_none());
        assert!(projection.snapshot().protocol_era.is_none());
        assert!(projection.snapshot().fork_watch.is_none());
        assert!(projection.snapshot().activity_feed.is_none());
        assert!(projection.snapshot().transaction_horizon.is_none());
        assert!(projection.snapshot().network_atlas.is_none());
    }

    #[test]
    fn crawler_disable_clears_only_the_network_atlas() {
        let mut projection = SemanticsProjection::new(Some(("ckbadger", vec![])));
        projection.apply_enrichment(&EnrichmentEvent::AssetEcosystemReplace(ecosystem(10)));
        projection.apply_enrichment(&EnrichmentEvent::NetworkAtlasReplace(network_atlas(10)));

        let deltas = projection.apply_enrichment(&EnrichmentEvent::NetworkAtlasClear);

        assert!(projection.snapshot().network_atlas.is_none());
        assert!(projection.snapshot().asset_ecosystem.is_some());
        assert!(matches!(deltas[0], SemanticsDelta::NetworkAtlasClear));
    }

    #[test]
    fn cap_evicts_oldest_enrichment_without_touching_newer_records() {
        let mut projection = SemanticsProjection::default().with_caps(1, 1);
        projection.apply_enrichment(&EnrichmentEvent::CellUpsert(Box::new(cell(1, "first"))));
        let deltas =
            projection.apply_enrichment(&EnrichmentEvent::CellUpsert(Box::new(cell(2, "second"))));

        let snapshot = projection.snapshot();
        assert_eq!(snapshot.cells.len(), 1);
        assert_eq!(snapshot.cells[0].out_point.tx_hash, "0xsecond");
        assert!(matches!(
            &deltas[1],
            SemanticsDelta::CellRemove { out_point } if out_point.tx_hash == "0xfirst"
        ));
    }
}
