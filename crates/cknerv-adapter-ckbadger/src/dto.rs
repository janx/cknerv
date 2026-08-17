use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkStats {
    pub sync_status: SyncStatus,
}

/// Fixed-size subset of ckbadger's indexed transaction statistics. Source
/// labels are validated by the adapter but intentionally discarded before the
/// shared wire boundary.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransactionStatsResponse {
    pub current_hour: i64,
    pub current_day: i64,
    #[serde(default)]
    pub hourly_data: Vec<TransactionStatsPoint>,
    #[serde(default)]
    pub daily_data: Vec<TransactionStatsPoint>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct TransactionStatsPoint {
    pub label: String,
    pub value: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkCrawlerSummaryResponse {
    pub enabled: bool,
    pub has_data: bool,
    pub last_round: Option<NetworkCrawlerRoundResponse>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkCrawlerRoundResponse {
    pub round_id: u64,
    pub started: u64,
    pub finished: u64,
    pub dialed: u64,
    pub reachable: u64,
    pub unreachable: u64,
    pub foreign_dropped: u64,
    pub new_nodes: u64,
    pub total_known: u64,
    pub frontier_drained: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkNodesPageResponse {
    #[serde(default)]
    pub items: Vec<NetworkNodeSummaryResponse>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkNodeSummaryResponse {
    pub peer_id: String,
    pub version: String,
    pub country: String,
    pub reachable: bool,
    pub last_seen: u64,
    pub rtt_ms: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssetEcosystemResponse {
    #[serde(default)]
    pub top_tokens: Vec<AssetEcosystemToken>,
    #[serde(default)]
    pub capacity_breakdown: Vec<AssetEcosystemCategory>,
    pub total_live_capacity_ckb: String,
    pub total_knowledge_size_ckb: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssetEcosystemToken {
    pub type_script_hash: String,
    pub name: Option<String>,
    pub symbol: Option<String>,
    pub holders_count: i64,
    pub total_capacity_ckb: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssetEcosystemCategory {
    pub category: String,
    pub capacity_ckb: String,
    pub percentage: String,
}

/// ckbadger's whole-chain live-Cell summary. The source maintains this as a
/// fixed-size record updated incrementally from birth/spend, so the response
/// is constant work and never a scan; it has no synthesized default, which is
/// why an unavailable aggregate is an HTTP status rather than a zero here.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LiveCellSummaryResponse {
    pub tip: LiveCellSummaryTip,
    pub live_cells: i64,
    #[serde(default)]
    pub classes: Option<LiveCellSummaryClasses>,
    #[serde(default)]
    pub data_bearing: Option<i64>,
}

/// The block the counts are exact at. cknerv proves this pair against its own
/// canonical evidence before admitting anything the record says.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LiveCellSummaryTip {
    pub block: i64,
    pub hash: String,
}

/// Mutually exclusive decomposition of `liveCells`. Optional as a whole: a
/// response without it still carries a usable count.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LiveCellSummaryClasses {
    pub dao: i64,
    pub typed_non_dao: i64,
    pub plain: i64,
}

/// Fixed-shape subset of ckbadger's global DAO statistics response. Fields
/// that cknerv does not publish are intentionally ignored by serde.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DaoStatisticsResponse {
    pub tip_block_number: i64,
    pub total_deposited: String,
    pub total_depositors: i32,
    pub active_deposits: i32,
    pub unclaimed_compensation: String,
    pub estimated_apc: String,
    pub pending_withdrawal_capacity: String,
    pub deposit_change_24h: Option<String>,
    pub depositors_change_24h: Option<i32>,
}

/// Bounded subset of ckbadger's static hardfork timeline. Resource links,
/// summaries, and dates are deliberately excluded from cknerv's adapter DTO.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HardforkTimelineResponse {
    pub network: String,
    pub tip_epoch: i64,
    pub tip_block: i64,
    #[serde(default)]
    pub events: Vec<HardforkEventResponse>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HardforkEventResponse {
    pub id: String,
    pub short_name: String,
    pub edition_year: i32,
    pub activation_epoch: i64,
    pub activation_block: Option<i64>,
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecentReorgResponse {
    pub has_recent_reorg: bool,
    pub reorg: Option<ReorgEventResponse>,
    pub recent_window_seconds: i64,
    pub deep_fork: DeepForkStatusResponse,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReorgEventResponse {
    pub id: i64,
    pub fork_point_number: i64,
    pub fork_point_hash: String,
    pub old_tip_number: i64,
    pub old_tip_hash: String,
    pub new_tip_number: i64,
    pub new_tip_hash: String,
    pub depth: i32,
    pub orphaned_blocks_count: i64,
    pub orphaned_txs_count: i64,
    pub event_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeepForkStatusResponse {
    pub detected: bool,
    pub db_tip: Option<i64>,
    pub db_tip_hash: Option<String>,
    pub chain_tip: Option<i64>,
    pub chain_tip_hash: Option<String>,
    pub depth: Option<i32>,
    pub fork_point: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LatestActivityResponse {
    pub tx_hash: String,
    pub block_number: i64,
    pub timestamp: String,
    pub is_cellbase: bool,
    #[serde(default)]
    pub protocol_actions: Vec<ActivityProtocolAction>,
    #[serde(default)]
    pub type_calls: Vec<ActivityScriptCall>,
    #[serde(default)]
    pub lock_calls: Vec<ActivityScriptCall>,
    #[serde(default)]
    pub participants: Vec<ActivityParticipant>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActivityProtocolAction {
    pub protocol: String,
    pub action: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActivityScriptCall {
    pub script_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActivityParticipant {
    #[serde(default)]
    pub item_deltas: Vec<ActivityItemDelta>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ActivityItemDelta {
    pub kind: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncStatus {
    pub is_syncing: bool,
    pub synced_block: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BlockResponse {
    pub number: i64,
    pub hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CellDetailResponse {
    pub tx_hash: String,
    pub output_index: i32,
    pub data_size: i64,
    pub data: Option<String>,
    pub lock_script_hash: String,
    pub type_script_hash: Option<String>,
    pub address: Option<String>,
    pub cell_type: Option<String>,
    pub created_at_block: i64,
    pub lock: ScriptResponse,
    #[serde(rename = "type")]
    pub type_script: Option<ScriptResponse>,
    pub common_knowledge_size_breakdown: CommonKnowledgeSizeBreakdown,
    #[serde(default)]
    pub data_analysis: Option<CellDataAnalysis>,
    #[serde(default)]
    pub is_dep_group: bool,
    #[serde(default)]
    pub dep_group_items: Option<Vec<DepGroupItem>>,
    #[serde(default)]
    pub code_cell_of: Option<Vec<CodeCellScript>>,
    #[serde(default)]
    pub dao_info: Option<DaoInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptResponse {
    pub code_hash: String,
    pub hash_type: String,
    pub args: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommonKnowledgeSizeBreakdown {
    pub capacity_field_bytes: i64,
    pub lock_script_bytes: i64,
    pub type_script_bytes: i64,
    pub data_bytes: i64,
    pub total_bytes: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CellDataAnalysis {
    pub deterministic: Option<CellDeterministicDecode>,
    #[serde(default)]
    pub heuristic_guesses: Vec<CellDataGuess>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CellDeterministicDecode {
    pub kind: String,
    pub summary: String,
    #[serde(default)]
    pub segments: Vec<CellDataSegment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CellDataSegment {
    pub label: String,
    pub start: i64,
    pub end: i64,
    pub meaning: String,
    pub human_value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CellDataGuess {
    pub kind: String,
    pub confidence: String,
    pub reason: String,
    pub mime_type: Option<String>,
    pub human_value: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DepGroupItem {
    pub tx_hash: String,
    pub output_index: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodeCellScript {
    pub name: String,
    pub code_hash: String,
    pub hash_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DaoInfo {
    pub dao_status: String,
    pub deposit_block_number: i64,
    pub withdraw_request_block: Option<i64>,
    pub withdraw_block: Option<i64>,
    pub compensation_ckb: Option<String>,
    pub estimated_apc: Option<String>,
}

/// One family from ckbadger's script catalogue. The catalogue carries names
/// and descriptions but no code hashes, so it cannot resolve a script on its
/// own — it is joined to `scripts/lookup` results by `name`, which is unique
/// across the catalogue.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptFamilyResponse {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub script_kind: Option<String>,
    #[serde(default)]
    pub website: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptCatalogueResponse {
    #[serde(default)]
    pub data: Vec<ScriptFamilyResponse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LookupScriptsRequest<'a> {
    pub code_hashes: Vec<&'a str>,
    pub tx_hash: &'a str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptLookupInfo {
    pub name: String,
    pub deprecated: bool,
    pub script_kind: Option<String>,
    pub decoder_type: Option<String>,
    pub resolution_state: String,
}

pub(crate) type ScriptLookupResponse = HashMap<String, ScriptLookupInfo>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TokenResponse {
    pub type_script_hash: String,
    pub standard: String,
    pub name: Option<String>,
    pub symbol: Option<String>,
    pub decimals: Option<i16>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransactionDetailResponse {
    pub hash: String,
    pub status: String,
    pub block_number: Option<i64>,
    pub block_hash: Option<String>,
    pub inputs_count: i32,
    pub outputs_count: i32,
    pub fee: String,
    pub fee_rate: Option<String>,
    pub tx_size: Option<i32>,
    pub cycles: Option<i64>,
    pub confirmations: Option<i64>,
    pub is_cellbase: bool,
    pub inputs_capacity: Option<String>,
    pub outputs_capacity: Option<String>,
    #[serde(rename = "inputsCommonKnowledgeSize")]
    pub inputs_common_knowledge_size: Option<String>,
    #[serde(rename = "outputsCommonKnowledgeSize")]
    pub outputs_common_knowledge_size: Option<String>,
    #[serde(default)]
    pub inputs: Vec<TransactionInputResponse>,
    #[serde(default)]
    pub outputs: Vec<TransactionOutputResponse>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransactionInputResponse {
    pub capacity: Option<String>,
    pub address: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransactionOutputResponse {
    pub capacity: String,
    #[serde(rename = "commonKnowledgeSize")]
    pub common_knowledge_size: i64,
    pub address: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransactionLifecycleResponse {
    pub hash: String,
    pub phase: String,
    pub proposal_id: String,
    pub proposed_in: Option<LifecycleBlockInfo>,
    pub proposed_in_uncle: Option<LifecycleUncleInfo>,
    pub committed_in: Option<LifecycleBlockInfo>,
    pub commitment_distance: Option<i64>,
    pub commitment_window: CommitmentWindow,
    pub is_cellbase: bool,
    pub confirmations: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LifecycleBlockInfo {
    pub block_number: i64,
    pub block_hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LifecycleUncleInfo {
    pub block_number: i64,
    pub block_hash: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CommitmentWindow {
    pub close: i64,
    pub far: i64,
}
