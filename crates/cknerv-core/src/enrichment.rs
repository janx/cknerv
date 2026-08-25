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

/// Indexed occupied-capacity explanation.  The four component counts and
/// `total_bytes` are bytes and add up exactly; `occupied_shannons` is the
/// source's own stored figure and deliberately need not agree with
/// `total_bytes * 100_000_000`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommonKnowledgeBreakdown {
    pub total_bytes: u64,
    pub capacity_field_bytes: u64,
    pub lock_script_bytes: u64,
    pub type_script_bytes: u64,
    pub data_bytes: u64,
    /// Exact occupied capacity in shannons, as the source computed it from the
    /// Cell's stored occupied capacity.  It counts bytes the byte breakdown
    /// cannot see — script args the index does not itemize — so the residual
    /// against `total_bytes * 100_000_000` is itself the evidence and never a
    /// contradiction to reject.  Absent when the source did not state one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occupied_shannons: Option<String>,
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
/// trailing [`crate::DATA_HEX_TRUNCATION_MARKER`] when truncated.
/// `total_bytes` and interpretation ranges always describe the complete
/// payload.
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

/// Where a Cell's life ended, when the source reports it spent and can name
/// the spender.  Absence means only that the source did not say so — a live
/// Cell and a dead Cell whose consumer the index never recorded both arrive
/// without this.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SemanticCellConsumption {
    /// Transaction that spent the outpoint.
    pub tx_hash: String,
    /// Block the spending transaction landed in, when the source knows it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block: Option<u64>,
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
    /// Set only when the source reports the outpoint spent by a named
    /// transaction.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub consumed: Option<SemanticCellConsumption>,
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

/// Disjoint decomposition of a [`ChainCensus`]'s live count, in the same
/// three bins the CellGalaxy composition target staffs the stage with. The
/// three counters partition `live_cells` exactly; a source that cannot prove
/// that partition must send no classes at all rather than an approximate one.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChainCensusClasses {
    /// Nervos DAO cells.
    pub dao: u64,
    /// Cells carrying a type script that is not the DAO.
    pub typed_non_dao: u64,
    /// Cells with no type script.
    pub plain: u64,
}

impl ChainCensusClasses {
    /// Checked sum of the three disjoint bins. `None` on overflow.
    pub fn total(&self) -> Option<u64> {
        self.dao
            .checked_add(self.typed_non_dao)
            .and_then(|sum| sum.checked_add(self.plain))
    }
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
    /// Present only when the source proves the partition sums to
    /// `live_cells`. Absent is a legal state: the count stands alone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub classes: Option<ChainCensusClasses>,
    /// Whole-chain twin of `CellViewStats::data_bearing` — orthogonal to
    /// `classes`, so it is never part of that partition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_bearing: Option<u64>,
}

/// Fixed CellGalaxy composition contract. The record remains enrichment-only:
/// indexed candidates are admitted only after a canonical adapter validates
/// each live outpoint, and they never enter the structural Cell projection or
/// its Birth/Death/Link/Pulse stream.
pub const GALAXY_COMPOSITION_DAO_BPS: u16 = 2_000;
pub const GALAXY_COMPOSITION_TYPED_BPS: u16 = 7_000;
pub const GALAXY_COMPOSITION_PLAIN_BPS: u16 = 1_000;

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

/// One display-safe label count over the crawler's whole verified set.
/// Individual peer identities and addresses never cross this contract.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct NetworkAtlasBucket {
    pub label: String,
    pub count: u32,
}

/// Whole-network context from an optional network crawler: what the last
/// completed round reached, and what the set it holds is made of.
///
/// Every count here carries the crawler's own field name. Three of them used
/// to be `total_known`, `last_round_attempted` and `new_nodes`, and every one
/// of those quantities was deleted at the source for blurring several separate
/// populations into one word. The replacements are not renames of a number
/// that stayed put: `verified_retained_peers` counts the peers the crawler
/// still holds a verification for, `candidate_peers` counts the peers the
/// round considered, and `new_verified_peers` counts the peers verified for
/// the first time in it. `last_round_reachable` keeps its own name because the
/// fact under it never moved.
///
/// The four counts under `candidate_peers` are one round's outcome matrix read
/// four ways, so they are bound by arithmetic rather than merely bounded:
/// `last_round_reachable + exhausted_candidates + foreign_peers` is exactly
/// `candidate_peers`, and `last_round_reachable + verified_unavailable_peers`
/// is exactly `verified_retained_peers`. `verified_unavailable_peers` cuts
/// ACROSS the first three rather than joining them — it is what is left
/// verified out of the exhausted and foreign cohorts — so it is the one number
/// here that must never be added to its neighbours.
///
/// The buckets are a census, not a sample. They used to be folded here out of
/// one bounded 64-row page of peers and captioned for it; upstream computes
/// them over every verified peer now, which is why `sample_size`,
/// `sample_reachable` and `sample_truncated` are gone, why `median_rtt_ms`
/// went with them — the only number left that a bounded page could have
/// answered, and a reading of the crawler's own distance from the fleet rather
/// than of the fleet — and why `asns` is here at all.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct NetworkAtlasRecord {
    pub source: String,
    pub as_of: ChainAnchor,
    pub updated_at_ms: u64,
    pub crawl_round: u64,
    pub crawl_finished_at_s: u64,
    pub candidate_peers: u64,
    pub last_round_reachable: u64,
    pub foreign_peers: u64,
    pub exhausted_candidates: u64,
    pub verified_unavailable_peers: u64,
    pub verified_retained_peers: u64,
    pub new_verified_peers: u64,
    /// The peers the crawler holds an index entry for right now, and the
    /// denominator every bucket below is counted against.
    ///
    /// It is upstream's `distributions.verifiedRetained` and it means the same
    /// words as `verified_retained_peers` on a DIFFERENT CLOCK: the crawler
    /// scans its node store when the request arrives, while the round reports
    /// what its outcome matrix added up to when it finished. They agree
    /// whenever nothing changed in between, and nothing promises that they
    /// must, so both are carried and neither is ever asserted against the
    /// other. The buckets belong to this one, and it is the number their
    /// caption states.
    pub indexed_peers: u32,
    #[serde(default)]
    pub countries: Vec<NetworkAtlasBucket>,
    #[serde(default)]
    pub versions: Vec<NetworkAtlasBucket>,
    /// The autonomous systems the verified set is hosted in — the axis that
    /// says whether half a network shares one operator, which is a fact no
    /// count of peers or countries can state.
    #[serde(default)]
    pub asns: Vec<NetworkAtlasBucket>,
}

/// One crawler-known node, as the scene may stage it.
///
/// Its identity is real and nothing else here is: the id, the address, the
/// version and the labels are the crawler's own observations, while where
/// this node ends up standing — and every edge drawn to it — is scene
/// placement with no claim on the network's shape.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct RosterNode {
    /// Base58: the id vocabulary the whole app already shares with the local
    /// node's peer list and with `/api/enrichment/peers/:node_id`, not the
    /// hex the crawler is keyed by.
    pub node_id: String,
    /// The primary address the crawler holds for this node.
    pub addr: String,
    pub version: String,
    /// A crawler with no geolocation or ASN for a node says `"Unknown"`, and
    /// that answer crosses unchanged rather than thinning into an absent
    /// field: "nobody knows" is a label, not a gap.
    pub country: String,
    pub asn: String,
    pub reachable: bool,
    /// Milliseconds, like every other cknerv wire clock, although the crawler
    /// counts seconds.
    pub last_seen_ms: u64,
    /// The crawler's own dial, from the crawler's vantage. Display-only: it
    /// measures a link cknerv does not have, and is never a distance.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rtt_ms: Option<u32>,
}

/// The bounded sample of crawler-known nodes the scene may stage.
///
/// The twin of [`NetworkAtlasRecord`] from the other side: the atlas counts
/// the crawler's whole known set and names nobody, and this names a bounded
/// few and counts nothing. Every identity in it is real; everything
/// relational still is not, because a crawler observes nodes rather than the
/// links between them.
///
/// Entries are ordered by `node_id`, so the same known set stages as the same
/// set in the same order round after round. Empty `entries` is a crawler that
/// finished a round knowing nobody — which is a report, and not the same
/// thing as having no crawler at all.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct NetworkRosterRecord {
    pub source: String,
    pub as_of: ChainAnchor,
    pub updated_at_ms: u64,
    pub crawl_round: u64,
    /// The crawler knows more nodes than this roster names.
    pub truncated: bool,
    #[serde(default)]
    pub entries: Vec<RosterNode>,
}

/// How one node looked the last time an optional network crawler reached it.
///
/// This is the only enrichment record that does not describe a chain object:
/// it describes an observation of a *node*, made from a different vantage and
/// a different clock than the local RPC link. It therefore carries its own
/// observation stamp (`last_seen_ms`) as well as the canonical anchor the
/// lookup was validated against — a consumer must date every row it draws
/// from here rather than blending it with live link telemetry.
///
/// It is resolved lazily, one node at a time, and never enters the streamed
/// semantics projection: the set of peers is the network's, not the chain's.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PeerSightingRecord {
    pub source: String,
    pub as_of: ChainAnchor,
    pub updated_at_ms: u64,
    /// The node id as cknerv asked with — the same base58 string the local
    /// node's peer list carries, not the source's internal encoding of it.
    pub node_id: String,
    pub country: String,
    pub asn: String,
    pub client_version: String,
    #[serde(default)]
    pub protocols: Vec<String>,
    pub first_seen_ms: u64,
    pub last_seen_ms: u64,
    /// Absent when the crawler has never completed a dial to this node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_reachable_at_ms: Option<u64>,
    pub reachable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rtt_ms: Option<u32>,
    /// How many peers this node holds in its own address book — the OUTBOUND
    /// direction, and the one count no source can currently answer.
    ///
    /// ckbadger deleted `knownPeers` from its peer route. What replaced it is
    /// `advertisers[]`, the peers that named THIS node: the same relationship
    /// read from the other end. Filling this slot from that list would print
    /// the sentence backwards, so it is left empty until both directions can
    /// be labelled for what they are, and the CROWD row stands down while it
    /// is. Absent means "nobody can say", never "zero".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub known_peers_count: Option<u32>,
}

/// How far one of the crawler's dials got, in upstream's own vocabulary.
///
/// An ORDINAL axis rather than a set of labels: each name is strictly further
/// through the handshake than the one before it, from a dial that never
/// opened to a peer that identified itself on this chain. That is what makes
/// "the furthest any of its addresses got" a meaningful answer to "why is
/// this peer not verified" — and it is why the two middle rungs must not be
/// collapsed. `noAuthenticatedSessionBeforeDeadline` says nothing answered on
/// the wire; `authenticatedSessionWithoutIdentifyBeforeDeadline` says
/// something answered, completed a secure handshake, and then never said who
/// it was. To an operator those are different problems with different fixes.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum PeerProbeResult {
    /// The crawler named a result this build has no word for. Ranked lowest
    /// deliberately: any result this build CAN name is a better answer than
    /// one it cannot, and this only surfaces when every observation on the
    /// peer was unreadable.
    Unknown,
    /// The dial never opened — no route, refused, or malformed address.
    DialRequestFailed,
    /// Nothing completed a secure handshake before the round gave up.
    NoAuthenticatedSessionBeforeDeadline,
    /// A secure session opened and the peer never identified itself.
    AuthenticatedSessionWithoutIdentifyBeforeDeadline,
    /// The peer identified itself in a shape the crawler could not read.
    MalformedIdentify,
    /// The peer identified itself, on another chain.
    ForeignNetwork,
    /// The peer identified itself, on this chain. A peer whose furthest probe
    /// is this one normally has a verified record, so seeing it beside an
    /// absence means upstream held an identify it did not keep.
    SameNetworkIdentified,
}

/// What the crawler holds about a peer it has never verified.
///
/// The crawler's peer set is a gradient of evidence, and this is the rung
/// below a sighting: other peers advertised addresses for this node, the
/// crawler dialed them, and no dial ended in an identify it could keep. It is
/// an ordinary state rather than an edge — a node behind NAT dials out and
/// cannot be dialed back, so cknerv can hold a live link to a peer the
/// crawler will never verify.
///
/// Every field here is evidence the crawler actually has. There is no
/// `country`, no `client_version` and no `rtt_ms`, because upstream refuses
/// to fabricate metadata for a peer it never reached, and neither does this.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PeerAdvertisedEvidence {
    /// When the network last named this peer to the crawler. The report's own
    /// clock: an unverified peer has no sighting to be stamped by, and an
    /// undated statement about the network is the one thing the DOSSIER never
    /// prints.
    pub last_advertised_at_ms: u64,
    /// The furthest any of this peer's addresses got in the last completed
    /// round. Absent when no round has completed with this peer in it — which
    /// is a different statement again: nobody has tried yet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub furthest_result: Option<PeerProbeResult>,
    /// Completed rounds in a row that ended with no verification. Zero for a
    /// peer that has only just started failing.
    pub consecutive_exhausted_rounds: u32,
}

/// Why a peer lookup came back without a sighting.
///
/// Each variant is a different true statement, and none of them is a failure:
/// an operational fault is an error, not an absence.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PeerSightingAbsence {
    /// The configured source has no network crawler at all, so no node was
    /// ever going to be found through it.
    NoCrawler,
    /// The id the local node reports for this peer cannot be turned into the
    /// key the source is indexed by, so nothing was asked.
    UnreadableNodeId,
    /// The source answered, and it holds nothing at all under this id — not
    /// a sighting, and not even an address somebody advertised. Under the
    /// route this used to be read from, it meant only "no verified record";
    /// it is now the stronger statement, because the same route answers for
    /// every peer anyone has merely named.
    NeverSighted,
    /// The source holds addresses for this node that other peers advertised,
    /// and no verification of it. The network names this peer; nobody outside
    /// could get an identify out of it. [`PeerAdvertisedEvidence`] carries the
    /// crawler's own word for how far the dials got.
    AdvertisedUnverified,
}

/// The result of one lazy per-peer crawler lookup.
///
/// Deliberately not an `Option`: "the crawler has never seen this node" is a
/// real observation about the network — arguably the most interesting one a
/// dashboard can print about a peer — and it must not be flattened into the
/// same nothing that a missing chain object produces.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum PeerSightingLookup {
    Sighted {
        sighting: Box<PeerSightingRecord>,
    },
    Unsighted {
        reason: PeerSightingAbsence,
        /// What the crawler holds about a peer it never verified. Present
        /// only with [`PeerSightingAbsence::AdvertisedUnverified`], which is
        /// the one absence that has evidence behind it.
        ///
        /// This rides beside the reason rather than becoming a third lookup
        /// state because it is not a sighting and must never be read as one:
        /// none of a sighting's fields — where the node is, what it runs, how
        /// long the network has carried it — exists for a peer nobody
        /// authenticated, and a shape that could be mistaken for a record is
        /// a shape somebody will eventually draw a record's rows from.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        advertised: Option<PeerAdvertisedEvidence>,
    },
}

impl PeerSightingLookup {
    pub fn unsighted(reason: PeerSightingAbsence) -> Self {
        Self::Unsighted {
            reason,
            advertised: None,
        }
    }

    /// The absence that carries evidence: the network names this peer, and
    /// the crawler never got an identify out of it.
    pub fn advertised_unverified(evidence: PeerAdvertisedEvidence) -> Self {
        Self::Unsighted {
            reason: PeerSightingAbsence::AdvertisedUnverified,
            advertised: Some(evidence),
        }
    }

    pub fn sighted(record: PeerSightingRecord) -> Self {
        Self::Sighted {
            sighting: Box::new(record),
        }
    }
}

/// One of the whole-chain aggregates the semantics projection holds a
/// single copy of.
///
/// Every one is re-fetched on its own fixed cadence and re-stamped with a
/// fresh `as_of` / `updated_at_ms` whether or not the answer moved. An arm
/// that publishes each refresh unconditionally therefore publishes
/// mutually-superseding copies of the same record forever — a revision, a
/// replay-ring entry and a broadcast frame per copy — on a chain that is
/// doing nothing at all.
///
/// Two producers learned this separately: [`NetworkRosterRecord`] gates on
/// `crawl_round` in the arm below, and
/// [`GalaxyCompositionRecord::content_matches`] compares content in the
/// display plane. Everything added after them forgot, the census most
/// recently — two hundred lines from the roster's documented gate, in this
/// same file. That is why the rule is a trait rather than a habit: a new
/// aggregate cannot reach `apply_enrichment` without answering both halves
/// of it, and nothing writes one of these holders except [`accept_refresh`]
/// and the clears that empty them.
pub trait ChainAggregate: Clone + PartialEq {
    /// How long an unchanged answer may stay off the wire.
    ///
    /// `None` means silence is free: no browser derive ages this record
    /// against a wall clock, so a stamp frozen at the last real change can
    /// never become a verdict about the source's health. Anything a HUD
    /// derive dims on age must name a floor instead — see
    /// [`floor_under_client_patience`].
    const REFRESH_FLOOR_MS: Option<u64>;

    /// The fetch clock this record carries, which is the same one the
    /// browser subtracts from `now` when it decides whether to print STALE.
    fn updated_at_ms(&self) -> u64;

    /// Take `published`'s freshness stamps, so what remains to compare is
    /// content.
    ///
    /// The stamps are enumerated here rather than the content fields
    /// deliberately: a record that grows a field gets it compared for free,
    /// where an enumeration of content would silently start swallowing real
    /// changes. `packages/cache/src/semanticsReducer.ts` ignores exactly the
    /// same two keys (`IGNORED_ANCHOR_KEYS`) for exactly this reason, and
    /// its comment carries the audit of what is content and not freshness:
    /// `statistics_block`, `detected_at_ms`, `timestamp_ms`,
    /// `crawl_finished_at_s`, `observed_at_block`.
    fn adopt_freshness(&mut self, published: &Self);

    /// Whether this refresh says the same thing the published copy does.
    fn content_matches(&self, published: &Self) -> bool {
        let mut probe = self.clone();
        probe.adopt_freshness(published);
        probe == *published
    }
}

/// The floor for a record whose HUD derive dims its panel once
/// `now - updated_at_ms` passes `stale_after_ms`: half of that patience.
///
/// Every one of these capabilities refreshes at a third of its own client
/// threshold, so a floor at half publishes every SECOND refresh and the
/// stamp a browser reads is never older than two refresh periods against a
/// patience of three — one full refresh period of margin, uniformly,
/// without this file having to know any capability's cadence. A source that
/// misses a refresh spends that margin, which is the correct outcome: a
/// panel one missed refresh away from dimming is a panel that should dim.
const fn floor_under_client_patience(stale_after_ms: u64) -> u64 {
    stale_after_ms / 2
}

// What each HUD derive spends before it prints STALE over a record.
// Mirrored from `packages/ui/src/derives/`, one file per line:
// `ACTIVITY_FEED_STALE_AFTER_MS` (activityFeed), `ASSET_ECOSYSTEM_…`
// (assetEcosystem), `DAO_STATE_…` (daoState), `NETWORK_ATLAS_…`
// (networkAtlas), `TRANSACTION_HORIZON_…` (transactionHorizon),
// `PROTOCOL_ERA_…` (protocolEra). Lowering one of those without lowering
// its twin here is what turns a floor into a false STALE, which is why the
// test below names both numbers.
const ACTIVITY_FEED_CLIENT_PATIENCE_MS: u64 = 45_000;
const ASSET_ECOSYSTEM_CLIENT_PATIENCE_MS: u64 = 90_000;
const DAO_STATE_CLIENT_PATIENCE_MS: u64 = 180_000;
const NETWORK_ATLAS_CLIENT_PATIENCE_MS: u64 = 180_000;
const TRANSACTION_HORIZON_CLIENT_PATIENCE_MS: u64 = 180_000;
const PROTOCOL_ERA_CLIENT_PATIENCE_MS: u64 = 900_000;

macro_rules! chain_aggregate {
    ($record:ty, $floor:expr) => {
        impl ChainAggregate for $record {
            const REFRESH_FLOOR_MS: Option<u64> = $floor;

            fn updated_at_ms(&self) -> u64 {
                self.updated_at_ms
            }

            fn adopt_freshness(&mut self, published: &Self) {
                self.as_of = published.as_of.clone();
                self.updated_at_ms = published.updated_at_ms;
            }
        }
    };
}

// The census has no wall-clock verdict anywhere in the browser: it is aged
// in BLOCKS against the canonical tip (`CENSUS_STALE_BLOCKS = 24` in
// `cellPopulationField.derive.ts`) and its panel prints `AS OF #block`. On
// a chain that is moving, `live_cells` moves with it and every refresh is
// news on its own merits; on a chain that is not, the height a frozen
// anchor names is still the current one. Silence is free in both cases.
chain_aggregate!(ChainCensus, None);
// Fork watch has no browser reader at all — the default dashboard
// deliberately does not route it, and `ui-app/__tests__/App.hudOverlay`
// asserts that absence. It is also the record most likely to say the same
// thing for days at a time.
chain_aggregate!(ForkWatchRecord, None);
// The script registry is a name lookup joined on `code_hash`; no panel
// prints its anchor and nothing ages it. It changes when the census
// discovers an identity this galaxy had not seen, and that is content.
chain_aggregate!(ScriptRegistryRecord, None);
chain_aggregate!(
    ActivityFeedRecord,
    Some(floor_under_client_patience(
        ACTIVITY_FEED_CLIENT_PATIENCE_MS
    ))
);
chain_aggregate!(
    AssetEcosystemRecord,
    Some(floor_under_client_patience(
        ASSET_ECOSYSTEM_CLIENT_PATIENCE_MS
    ))
);
chain_aggregate!(
    DaoStateRecord,
    Some(floor_under_client_patience(DAO_STATE_CLIENT_PATIENCE_MS))
);
chain_aggregate!(
    NetworkAtlasRecord,
    Some(floor_under_client_patience(
        NETWORK_ATLAS_CLIENT_PATIENCE_MS
    ))
);
chain_aggregate!(
    TransactionHorizonRecord,
    Some(floor_under_client_patience(
        TRANSACTION_HORIZON_CLIENT_PATIENCE_MS
    ))
);
chain_aggregate!(
    ProtocolEraRecord,
    Some(floor_under_client_patience(PROTOCOL_ERA_CLIENT_PATIENCE_MS))
);

/// Install a refreshed aggregate into the holder it replaces, and say
/// whether the wire has to hear about it.
///
/// A duplicate leaves the holder untouched rather than quietly re-stamping
/// it. That is what keeps the SNAPSHOT a late-connecting client reads and
/// the deltas a connected one received telling the same story: both hold
/// the record as it stood at the last refresh that was actually published,
/// anchor included. Re-stamping in place would make the two disagree about
/// a refresh neither of them ever saw described.
fn accept_refresh<T: ChainAggregate>(held: &mut Option<T>, incoming: &T) -> bool {
    if let Some(published) = held.as_ref() {
        if incoming.content_matches(published) {
            let floor_passed = T::REFRESH_FLOOR_MS.is_some_and(|floor| {
                incoming
                    .updated_at_ms()
                    .saturating_sub(published.updated_at_ms())
                    >= floor
            });
            if !floor_passed {
                return false;
            }
        }
    }
    *held = Some(incoming.clone());
    true
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
    NetworkRosterReplace(Box<NetworkRosterRecord>),
    NetworkRosterClear,
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
    pub network_roster: Option<NetworkRosterRecord>,
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
    NetworkRosterReplace {
        network_roster: Box<NetworkRosterRecord>,
    },
    NetworkRosterClear,
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
    network_roster: Option<NetworkRosterRecord>,
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
            network_roster: None,
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
        self.network_roster = None;
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
            network_roster: self.network_roster.clone(),
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
                if self
                    .network_roster
                    .as_ref()
                    .is_some_and(|roster| roster.as_of.block >= *from_block)
                {
                    self.network_roster = None;
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
            // Every aggregate arm from here down — the eight below, plus the
            // script registry past the roster — shares one gate,
            // [`accept_refresh`]: a refresh that says what the published copy
            // already says is not news, and stays off the wire until that
            // record's floor says a browser would otherwise start calling it
            // stale. Nothing else writes these holders except a clear, which
            // empties them.
            EnrichmentEvent::CensusReplace(census) => {
                if !accept_refresh(&mut self.census, census) {
                    return Vec::new();
                }
                vec![SemanticsDelta::CensusReplace {
                    census: census.clone(),
                }]
            }
            EnrichmentEvent::AssetEcosystemReplace(asset_ecosystem) => {
                if !accept_refresh(&mut self.asset_ecosystem, asset_ecosystem) {
                    return Vec::new();
                }
                vec![SemanticsDelta::AssetEcosystemReplace {
                    asset_ecosystem: asset_ecosystem.clone(),
                }]
            }
            EnrichmentEvent::DaoStateReplace(dao_state) => {
                if !accept_refresh(&mut self.dao_state, dao_state) {
                    return Vec::new();
                }
                vec![SemanticsDelta::DaoStateReplace {
                    dao_state: dao_state.clone(),
                }]
            }
            EnrichmentEvent::ProtocolEraReplace(protocol_era) => {
                if !accept_refresh(&mut self.protocol_era, protocol_era) {
                    return Vec::new();
                }
                vec![SemanticsDelta::ProtocolEraReplace {
                    protocol_era: protocol_era.clone(),
                }]
            }
            EnrichmentEvent::ForkWatchReplace(fork_watch) => {
                if !accept_refresh(&mut self.fork_watch, fork_watch) {
                    return Vec::new();
                }
                vec![SemanticsDelta::ForkWatchReplace {
                    fork_watch: fork_watch.clone(),
                }]
            }
            EnrichmentEvent::ActivityFeedReplace(activity_feed) => {
                if !accept_refresh(&mut self.activity_feed, activity_feed) {
                    return Vec::new();
                }
                vec![SemanticsDelta::ActivityFeedReplace {
                    activity_feed: activity_feed.clone(),
                }]
            }
            EnrichmentEvent::TransactionHorizonReplace(transaction_horizon) => {
                if !accept_refresh(&mut self.transaction_horizon, transaction_horizon) {
                    return Vec::new();
                }
                vec![SemanticsDelta::TransactionHorizonReplace {
                    transaction_horizon: transaction_horizon.clone(),
                }]
            }
            EnrichmentEvent::NetworkAtlasReplace(network_atlas) => {
                if !accept_refresh(&mut self.network_atlas, network_atlas) {
                    return Vec::new();
                }
                vec![SemanticsDelta::NetworkAtlasReplace {
                    network_atlas: network_atlas.clone(),
                }]
            }
            EnrichmentEvent::NetworkAtlasClear => {
                self.network_atlas = None;
                vec![SemanticsDelta::NetworkAtlasClear]
            }
            EnrichmentEvent::NetworkRosterReplace(network_roster) => {
                // A crawl round is the only thing that can change a roster,
                // and a roster is two orders of magnitude larger than the
                // aggregates beside it: re-publishing the same round on every
                // refresh would push hundreds of unchanged rows through the
                // replay ring and evict live deltas to say nothing.
                //
                // The gate lives here rather than in the source because this
                // is the only layer that knows whether its copy still exists.
                // A roster dropped by a reorg or a rebuild is therefore
                // published again at the very next refresh, instead of the
                // stage waiting out a whole crawl round for a set it already
                // had.
                //
                // This is [`ChainAggregate`]'s rule in a stricter form, not an
                // exception to it: the round is a cheap proof that the content
                // is unchanged, and no browser derive ages a roster, so the
                // gate needs no refresh floor underneath it.
                if self
                    .network_roster
                    .as_ref()
                    .is_some_and(|held| held.crawl_round == network_roster.crawl_round)
                {
                    return Vec::new();
                }
                self.network_roster = Some(network_roster.as_ref().clone());
                vec![SemanticsDelta::NetworkRosterReplace {
                    network_roster: network_roster.clone(),
                }]
            }
            EnrichmentEvent::NetworkRosterClear => {
                self.network_roster = None;
                vec![SemanticsDelta::NetworkRosterClear]
            }
            EnrichmentEvent::ScriptRegistryReplace(script_registry) => {
                if !accept_refresh(&mut self.script_registry, script_registry.as_ref()) {
                    return Vec::new();
                }
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

    /// What this projection can ever ship is the reason the browser cache
    /// can set its own retention at 4× and call it pure defense
    /// (`MAX_RETAINED_CELLS` / `MAX_RETAINED_TRANSACTIONS` in
    /// `packages/cache/src/semanticsReducer.ts`, whose comment cites these
    /// two fields and whose test asserts the 4× relationship). Raising a cap
    /// here without raising the client's turns that defense into eviction on
    /// a healthy stream.
    #[test]
    fn default_caps_are_what_the_client_sizes_its_defense_against() {
        let projection = SemanticsProjection::default();
        assert_eq!(projection.cell_cap, 512);
        assert_eq!(projection.transaction_cap, 2_048);
    }

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
            consumed: None,
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

    fn census(block: u64) -> ChainCensus {
        ChainCensus {
            source: "ckbadger".into(),
            as_of: ChainAnchor {
                block,
                hash: format!("0xblock{block}"),
            },
            updated_at_ms: block,
            live_cells: 1_471_222,
            total_cells: None,
            dead_cells: None,
            classes: Some(ChainCensusClasses {
                dao: 22_676,
                typed_non_dao: 475_891,
                plain: 972_655,
            }),
            data_bearing: Some(266_346),
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
            candidate_peers: 12,
            last_round_reachable: 8,
            foreign_peers: 1,
            exhausted_candidates: 3,
            verified_unavailable_peers: 1,
            verified_retained_peers: 9,
            new_verified_peers: 3,
            indexed_peers: 9,
            countries: vec![
                NetworkAtlasBucket {
                    label: "SG".into(),
                    count: 6,
                },
                NetworkAtlasBucket {
                    label: "US".into(),
                    count: 3,
                },
            ],
            versions: vec![NetworkAtlasBucket {
                label: "0.209.0".into(),
                count: 9,
            }],
            asns: vec![NetworkAtlasBucket {
                label: "AS16509 Amazon.com, Inc.".into(),
                count: 9,
            }],
        }
    }

    fn script_registry(block: u64) -> ScriptRegistryRecord {
        ScriptRegistryRecord {
            source: "ckbadger".into(),
            as_of: ChainAnchor {
                block,
                hash: format!("0xblock{block}"),
            },
            updated_at_ms: block,
            entries: vec![ScriptNameRecord {
                code_hash: "0xcode".into(),
                hash_type: "type".into(),
                name: "Default Lock".into(),
                description: None,
                kind: Some("lock".into()),
                website: None,
                deprecated: false,
            }],
            unresolved: 2,
        }
    }

    /// The same answer, asked again at `at_ms`. Every aggregate spells its
    /// fetch clock `updated_at_ms`, which is the whole reason a re-fetch of
    /// an unchanged fact is not automatically an unchanged record.
    macro_rules! restamped {
        ($record:expr, $at_ms:expr) => {{
            let mut record = $record;
            record.updated_at_ms = $at_ms;
            record
        }};
    }

    /// One full round of aggregate refreshes: every capability answering at
    /// canonical anchor `block` with fetch clock `at_ms`. Returns how many
    /// deltas reached the wire.
    fn refresh_round(projection: &mut SemanticsProjection, block: u64, at_ms: u64) -> usize {
        [
            EnrichmentEvent::CensusReplace(restamped!(census(block), at_ms)),
            EnrichmentEvent::AssetEcosystemReplace(restamped!(ecosystem(block), at_ms)),
            EnrichmentEvent::DaoStateReplace(restamped!(dao_state(block), at_ms)),
            EnrichmentEvent::ProtocolEraReplace(restamped!(protocol_era(block), at_ms)),
            EnrichmentEvent::ForkWatchReplace(restamped!(fork_watch(block), at_ms)),
            EnrichmentEvent::ActivityFeedReplace(restamped!(activity_feed(block), at_ms)),
            EnrichmentEvent::TransactionHorizonReplace(restamped!(
                transaction_horizon(block),
                at_ms
            )),
            EnrichmentEvent::NetworkAtlasReplace(restamped!(network_atlas(block), at_ms)),
            EnrichmentEvent::ScriptRegistryReplace(Box::new(restamped!(
                script_registry(block),
                at_ms
            ))),
        ]
        .iter()
        .map(|event| projection.apply_enrichment(event).len())
        .sum()
    }

    fn network_roster(block: u64, round: u64) -> NetworkRosterRecord {
        NetworkRosterRecord {
            source: "ckbadger".into(),
            as_of: ChainAnchor {
                block,
                hash: format!("0xblock{block}"),
            },
            updated_at_ms: block,
            crawl_round: round,
            truncated: false,
            entries: vec![RosterNode {
                node_id: "QmagxSv7GNwKXQE7mi1iDjFHghjUpbqjBgqSot7PmMJqHA".into(),
                addr: "/ip4/203.0.113.7/tcp/8115".into(),
                version: "0.209.0".into(),
                country: "DE".into(),
                asn: "AS24940 Hetzner Online GmbH".into(),
                reachable: true,
                last_seen_ms: 1_699_999_940_000,
                rtt_ms: Some(41),
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
            data_bytes: 0,
            content_hash: format!("0x{:064x}", id + 1),
            lock_shape_seed: [id as u32, 1],
            type_shape_seed: None,
            data_shape_seed: [id as u32, 2],
            lock_kind: crate::LockKind::Sighash,
            asset_kind,
            lock_script: Default::default(),
            type_script: None,
            collection_seed: None,
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
    fn galaxy_composition_target_is_exact_20_70_10() {
        assert_eq!(
            GalaxyCompositionTarget::for_total(6_000),
            GalaxyCompositionTarget {
                dao: 1_200,
                typed: 4_200,
                plain: 600,
            }
        );
        assert_eq!(GalaxyCompositionTarget::for_total(7).total(), 7);
    }

    /// The product contract at the shipped cell budget, pinned exactly.
    #[test]
    fn galaxy_composition_target_at_the_full_budget() {
        assert_eq!(
            GalaxyCompositionTarget::for_total(12_000),
            GalaxyCompositionTarget {
                dao: 2_400,
                typed: 8_400,
                plain: 1_200,
            }
        );
        assert_eq!(
            GalaxyCompositionTarget::for_total(12_000).total(),
            12_000,
            "the remainder-to-plain rule keeps the quota exactly the budget"
        );
        // Rounding lands entirely in plain: floor(0.20·7) + floor(0.70·7)
        // + the rest.
        assert_eq!(
            GalaxyCompositionTarget::for_total(7),
            GalaxyCompositionTarget {
                dao: 1,
                typed: 4,
                plain: 2,
            }
        );
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
        projection.apply_enrichment(&EnrichmentEvent::NetworkRosterReplace(Box::new(
            network_roster(10, 7),
        )));
        projection.apply_enrichment(&EnrichmentEvent::CensusReplace(census(10)));

        projection.apply_mutation(&Mutation::ChainReorganized { from_block: 10 });

        assert!(projection.snapshot().census.is_none());
        assert!(projection.snapshot().asset_ecosystem.is_none());
        assert!(projection.snapshot().dao_state.is_none());
        assert!(projection.snapshot().protocol_era.is_none());
        assert!(projection.snapshot().fork_watch.is_none());
        assert!(projection.snapshot().activity_feed.is_none());
        assert!(projection.snapshot().transaction_horizon.is_none());
        assert!(projection.snapshot().network_atlas.is_none());
        assert!(projection.snapshot().network_roster.is_none());
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
    fn crawler_disable_retires_the_sighted_nodes_it_had_named() {
        let mut projection = SemanticsProjection::new(Some(("ckbadger", vec![])));
        projection.apply_enrichment(&EnrichmentEvent::AssetEcosystemReplace(ecosystem(10)));
        projection.apply_enrichment(&EnrichmentEvent::NetworkRosterReplace(Box::new(
            network_roster(10, 7),
        )));

        let deltas = projection.apply_enrichment(&EnrichmentEvent::NetworkRosterClear);

        assert!(projection.snapshot().network_roster.is_none());
        assert!(projection.snapshot().asset_ecosystem.is_some());
        assert!(matches!(deltas[0], SemanticsDelta::NetworkRosterClear));
    }

    #[test]
    fn a_roster_from_a_round_already_held_is_not_news() {
        let mut projection = SemanticsProjection::new(Some(("ckbadger", vec![])));
        projection.apply_enrichment(&EnrichmentEvent::NetworkRosterReplace(Box::new(
            network_roster(10, 7),
        )));

        // Same round at a newer anchor: nothing about the staged set changed,
        // and hundreds of unchanged rows must not walk the replay ring to say
        // so. The held record keeps the anchor it was actually proved at.
        let deltas = projection.apply_enrichment(&EnrichmentEvent::NetworkRosterReplace(Box::new(
            network_roster(20, 7),
        )));

        assert!(deltas.is_empty());
        assert_eq!(
            projection.snapshot().network_roster,
            Some(network_roster(10, 7))
        );

        let deltas = projection.apply_enrichment(&EnrichmentEvent::NetworkRosterReplace(Box::new(
            network_roster(20, 8),
        )));

        assert!(matches!(
            deltas[0],
            SemanticsDelta::NetworkRosterReplace { .. }
        ));
        assert_eq!(
            projection.snapshot().network_roster,
            Some(network_roster(20, 8))
        );
    }

    #[test]
    fn a_roster_a_reorg_dropped_is_published_again_at_the_same_round() {
        // Why the round gate lives here and not in the source: only this
        // layer knows whether its copy still exists. A source remembering
        // which round it last handed out would leave the stage without
        // sighted nodes until the crawler finished another one.
        let mut projection = SemanticsProjection::new(Some(("ckbadger", vec![])));
        projection.apply_enrichment(&EnrichmentEvent::NetworkRosterReplace(Box::new(
            network_roster(10, 7),
        )));
        projection.apply_mutation(&Mutation::ChainReorganized { from_block: 10 });
        assert!(projection.snapshot().network_roster.is_none());

        let deltas = projection.apply_enrichment(&EnrichmentEvent::NetworkRosterReplace(Box::new(
            network_roster(11, 7),
        )));

        assert!(matches!(
            deltas[0],
            SemanticsDelta::NetworkRosterReplace { .. }
        ));
        assert_eq!(
            projection.snapshot().network_roster,
            Some(network_roster(11, 7))
        );
    }

    #[test]
    fn a_census_survives_a_reorg_that_predates_its_anchor() {
        let mut projection = SemanticsProjection::new(Some(("ckbadger", vec![])));
        projection.apply_enrichment(&EnrichmentEvent::CensusReplace(census(10)));

        projection.apply_mutation(&Mutation::ChainReorganized { from_block: 11 });

        assert_eq!(projection.snapshot().census, Some(census(10)));
    }

    #[test]
    fn a_re_counted_census_replaces_the_held_record() {
        let mut projection = SemanticsProjection::new(Some(("ckbadger", vec![])));
        projection.apply_enrichment(&EnrichmentEvent::CensusReplace(census(10)));

        let mut counted = census(20);
        counted.live_cells += 1;
        counted.classes.as_mut().expect("classes").plain += 1;
        let deltas = projection.apply_enrichment(&EnrichmentEvent::CensusReplace(counted.clone()));

        assert_eq!(projection.snapshot().census, Some(counted));
        assert!(matches!(deltas[0], SemanticsDelta::CensusReplace { .. }));
    }

    /// A re-anchored census carrying the SAME count is a fetch timestamp,
    /// not news. The held copy keeps the anchor it was actually published
    /// at, so the snapshot a late client reads and the deltas a connected
    /// one received describe one record rather than two.
    #[test]
    fn a_census_that_says_what_the_last_one_said_is_not_news() {
        let mut projection = SemanticsProjection::new(Some(("ckbadger", vec![])));
        projection.apply_enrichment(&EnrichmentEvent::CensusReplace(census(10)));

        let deltas = projection.apply_enrichment(&EnrichmentEvent::CensusReplace(census(20)));

        assert!(deltas.is_empty());
        assert_eq!(projection.snapshot().census, Some(census(10)));
    }

    /// The whole point, stated once. On a chain that is doing nothing, a
    /// full round of enrichment refreshes has to leave the wire silent.
    /// Before this gate the same round cost nine deltas — nine revisions,
    /// nine replay-ring entries and nine broadcast frames to every attached
    /// client — each superseded by the identical round seconds later,
    /// forever.
    #[test]
    fn an_idle_refresh_round_leaves_the_wire_silent() {
        let mut projection = SemanticsProjection::new(Some(("ckbadger", vec![])));

        assert_eq!(
            refresh_round(&mut projection, 10, 1_000_000),
            9,
            "the first round of answers is all news"
        );

        // The same answers at the same tip, ten seconds later: only the
        // fetch clock moved, and no floor is anywhere near spent.
        assert_eq!(refresh_round(&mut projection, 10, 1_005_000), 0);
        assert_eq!(refresh_round(&mut projection, 10, 1_010_000), 0);

        // Past the tightest floor in the table — the activity feed's, 22.5s
        // under a panel that dims at 45s — exactly that one record
        // re-stamps, and everything else stays quiet.
        assert_eq!(refresh_round(&mut projection, 10, 1_030_000), 1);
    }

    /// An unchanged answer is not silent forever: it re-stamps on its floor,
    /// once, and the floor re-arms from the refresh that was PUBLISHED
    /// rather than from the last one asked for. Otherwise a fast poll would
    /// keep pushing the deadline out and the panel would dim anyway.
    #[test]
    fn an_unchanged_aggregate_re_stamps_once_its_floor_has_passed() {
        let floor = AssetEcosystemRecord::REFRESH_FLOOR_MS.expect("the ecosystem panel ages");
        let mut projection = SemanticsProjection::new(Some(("ckbadger", vec![])));
        let first = restamped!(ecosystem(10), 1_000_000);
        projection.apply_enrichment(&EnrichmentEvent::AssetEcosystemReplace(first));

        let inside = restamped!(ecosystem(10), 1_000_000 + floor - 1);
        assert!(projection
            .apply_enrichment(&EnrichmentEvent::AssetEcosystemReplace(inside))
            .is_empty());

        let on_the_floor = restamped!(ecosystem(10), 1_000_000 + floor);
        let deltas = projection.apply_enrichment(&EnrichmentEvent::AssetEcosystemReplace(
            on_the_floor.clone(),
        ));
        assert!(matches!(
            deltas[0],
            SemanticsDelta::AssetEcosystemReplace { .. }
        ));
        assert_eq!(
            projection.snapshot().asset_ecosystem,
            Some(on_the_floor),
            "the re-stamp is what the browser now ages against"
        );

        // Re-armed from the publish, not from the poll: one floor past the
        // FIRST refresh is not one floor past the last published one.
        let after = restamped!(ecosystem(10), 1_000_000 + floor + 1);
        assert!(projection
            .apply_enrichment(&EnrichmentEvent::AssetEcosystemReplace(after))
            .is_empty());
    }

    /// A refresh floor is what keeps a dedupe from becoming a lie. Each HUD
    /// derive dims its panel once `now - updated_at_ms` passes its own
    /// threshold — `DaoStateReadout` prints "STALE · UPDATED Xs AGO" off
    /// exactly that subtraction — so an unchanged answer must re-stamp well
    /// inside that patience. Half of it lands on every second refresh,
    /// because each capability polls at a third of its own threshold, which
    /// leaves one whole refresh period of margin.
    ///
    /// Both numbers are named here on purpose: lowering a
    /// `*_STALE_AFTER_MS` in `packages/ui/src/derives/` without lowering its
    /// twin above is what would turn this gate into a false STALE verdict,
    /// and this is the test that says so.
    #[test]
    fn every_floor_is_half_the_patience_its_panel_spends() {
        for (capability, floor, patience) in [
            (
                "activity_feed",
                ActivityFeedRecord::REFRESH_FLOOR_MS,
                ACTIVITY_FEED_CLIENT_PATIENCE_MS,
            ),
            (
                "asset_ecosystem",
                AssetEcosystemRecord::REFRESH_FLOOR_MS,
                ASSET_ECOSYSTEM_CLIENT_PATIENCE_MS,
            ),
            (
                "dao_state",
                DaoStateRecord::REFRESH_FLOOR_MS,
                DAO_STATE_CLIENT_PATIENCE_MS,
            ),
            (
                "network_atlas",
                NetworkAtlasRecord::REFRESH_FLOOR_MS,
                NETWORK_ATLAS_CLIENT_PATIENCE_MS,
            ),
            (
                "transaction_horizon",
                TransactionHorizonRecord::REFRESH_FLOOR_MS,
                TRANSACTION_HORIZON_CLIENT_PATIENCE_MS,
            ),
            (
                "protocol_era",
                ProtocolEraRecord::REFRESH_FLOOR_MS,
                PROTOCOL_ERA_CLIENT_PATIENCE_MS,
            ),
        ] {
            let floor =
                floor.unwrap_or_else(|| panic!("{capability} is aged on a browser wall clock"));
            assert_eq!(floor, floor_under_client_patience(patience), "{capability}");
            assert!(
                floor * 2 <= patience,
                "{capability}: two floors must fit inside the panel's patience"
            );
        }
        assert_eq!(ActivityFeedRecord::REFRESH_FLOOR_MS, Some(22_500));

        // No wall clock anywhere in the browser reaches these three, so an
        // unchanged answer stays off the wire for as long as it stays
        // unchanged: the census is aged in BLOCKS against the canonical tip,
        // fork watch is not routed into the dashboard at all, and the script
        // registry is a name lookup joined on `code_hash`.
        assert_eq!(ChainCensus::REFRESH_FLOOR_MS, None);
        assert_eq!(ForkWatchRecord::REFRESH_FLOOR_MS, None);
        assert_eq!(ScriptRegistryRecord::REFRESH_FLOOR_MS, None);
    }

    /// The comparison enumerates the FRESHNESS fields, never the content
    /// ones, so a record that grows a field is compared on it for free. The
    /// audit of what is freshness and what only looks like it is shared with
    /// `packages/cache/src/semanticsReducer.ts`: a DAO record's
    /// `statistics_block` is the height its numbers were computed at, and
    /// moving it is a different answer even when every shannon matches.
    #[test]
    fn a_stamp_that_only_looks_like_freshness_is_still_content() {
        let mut projection = SemanticsProjection::new(Some(("ckbadger", vec![])));
        let first = restamped!(dao_state(10), 1_000_000);
        projection.apply_enrichment(&EnrichmentEvent::DaoStateReplace(first.clone()));

        let mut recomputed = restamped!(dao_state(10), 1_000_100);
        recomputed.statistics_block += 1;
        let deltas =
            projection.apply_enrichment(&EnrichmentEvent::DaoStateReplace(recomputed.clone()));

        assert!(matches!(deltas[0], SemanticsDelta::DaoStateReplace { .. }));
        assert!(!recomputed.content_matches(&first));
    }

    #[test]
    fn census_classes_sum_through_a_checked_total() {
        assert_eq!(
            census(10).classes.expect("classes").total(),
            Some(census(10).live_cells)
        );
        assert_eq!(
            ChainCensusClasses {
                dao: u64::MAX,
                typed_non_dao: 1,
                plain: 0,
            }
            .total(),
            None
        );
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
