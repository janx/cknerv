use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkStats {
    pub sync_status: SyncStatus,
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
