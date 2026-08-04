//! Optional, source-agnostic enrichment records for dashboard projections.
//!
//! Structural chain truth continues to arrive as [`crate::Mutation`].  The
//! types in this module describe indexed context that an optional local source
//! (for example ckbadger) can attach to an already-observed outpoint or
//! transaction.  Enrichment is deliberately additive: none of these records
//! can create, spend, or otherwise replace a canonical Cell.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::{Mutation, OutPoint, Projection};

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
    ActivityFeedReplace(ActivityFeedRecord),
    NetworkAtlasReplace(NetworkAtlasRecord),
    NetworkAtlasClear,
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
    pub activity_feed: Option<ActivityFeedRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub network_atlas: Option<NetworkAtlasRecord>,
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
    ActivityFeedReplace {
        activity_feed: ActivityFeedRecord,
    },
    NetworkAtlasReplace {
        network_atlas: NetworkAtlasRecord,
    },
    NetworkAtlasClear,
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
    activity_feed: Option<ActivityFeedRecord>,
    network_atlas: Option<NetworkAtlasRecord>,
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
            activity_feed: None,
            network_atlas: None,
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
        self.activity_feed = None;
        self.network_atlas = None;
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
            activity_feed: self.activity_feed.clone(),
            network_atlas: self.network_atlas.clone(),
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
                    .activity_feed
                    .as_ref()
                    .is_some_and(|feed| feed.as_of.block >= *from_block)
                {
                    self.activity_feed = None;
                }
                if self
                    .network_atlas
                    .as_ref()
                    .is_some_and(|atlas| atlas.as_of.block >= *from_block)
                {
                    self.network_atlas = None;
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
                self.source = source.clone();
                let mut deltas = Vec::new();
                if source.status == EnrichmentSourceState::Incompatible {
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
            EnrichmentEvent::ActivityFeedReplace(activity_feed) => {
                self.activity_feed = Some(activity_feed.clone());
                vec![SemanticsDelta::ActivityFeedReplace {
                    activity_feed: activity_feed.clone(),
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
    fn reorg_prunes_aggregate_records_at_the_invalidated_anchor() {
        let mut projection = SemanticsProjection::new(Some(("ckbadger", vec![])));
        projection.apply_enrichment(&EnrichmentEvent::AssetEcosystemReplace(ecosystem(10)));
        projection.apply_enrichment(&EnrichmentEvent::DaoStateReplace(dao_state(10)));
        projection.apply_enrichment(&EnrichmentEvent::ActivityFeedReplace(activity_feed(10)));
        projection.apply_enrichment(&EnrichmentEvent::NetworkAtlasReplace(network_atlas(10)));

        projection.apply_mutation(&Mutation::ChainReorganized { from_block: 10 });

        assert!(projection.snapshot().asset_ecosystem.is_none());
        assert!(projection.snapshot().dao_state.is_none());
        assert!(projection.snapshot().activity_feed.is_none());
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
