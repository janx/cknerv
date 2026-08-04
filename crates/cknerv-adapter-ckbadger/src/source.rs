use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::RwLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context};
use async_trait::async_trait;
use reqwest::StatusCode;
use url::Url;

use cknerv_core::{
    ActivityFeedItem, ActivityFeedRecord, AssetEcosystemCategory, AssetEcosystemLeader,
    AssetEcosystemRecord, CellSemanticRecord, ChainAnchor, CommonKnowledgeBreakdown,
    EnrichmentSourceState, EnrichmentSourceStatus, OutPoint, SemanticAsset, SemanticAttribute,
    SemanticFacet, SemanticScript, TransactionParticipantSemantic, TransactionSemanticRecord,
};
use cknerv_server::{CanonicalContext, EnrichmentSource};

use crate::dto::{
    AssetEcosystemResponse, BlockResponse, CellDataAnalysis, CellDetailResponse,
    CommonKnowledgeSizeBreakdown, DaoInfo, LatestActivityResponse, LookupScriptsRequest,
    NetworkStats, ScriptLookupInfo, ScriptLookupResponse, ScriptResponse, TokenResponse,
    TransactionDetailResponse, TransactionLifecycleResponse,
};

const CAPABILITIES: &[&str] = &[
    "cell_detail",
    "script_identity",
    "data_analysis",
    "asset_identity",
    "asset_ecosystem",
    "activity_feed",
    "transaction_detail",
    "transaction_lifecycle",
];
const DEFAULT_MAX_LAG_BLOCKS: u64 = 12;
const MAX_ECOSYSTEM_CATEGORIES: usize = 16;
const MAX_ECOSYSTEM_ASSETS: usize = 16;
const ACTIVITY_FEED_LIMIT: usize = 8;
const MAX_ACTIVITY_PARTICIPANTS: usize = 512;
const MAX_ACTIVITY_NESTED_ITEMS: usize = 512;
const MAX_ACTIVITY_LABEL_CHARS: usize = 96;
const SHANNONS_PER_CKB: u128 = 100_000_000;
const MAX_WIRE_SAFE_U64: u64 = 9_007_199_254_740_991;

/// Read-only client for a direct or orchestrator-proxied ckbadger API base.
pub struct CkbadgerEnrichmentSource {
    api_base: Url,
    client: reqwest::Client,
    max_lag_blocks: u64,
    validated_anchor: RwLock<Option<ChainAnchor>>,
}

impl CkbadgerEnrichmentSource {
    pub fn new(mut api_base: Url) -> anyhow::Result<Self> {
        if !api_base.path().ends_with('/') {
            let path = format!("{}/", api_base.path());
            api_base.set_path(&path);
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(4))
            .build()
            .context("build ckbadger HTTP client")?;
        Ok(Self {
            api_base,
            client,
            max_lag_blocks: DEFAULT_MAX_LAG_BLOCKS,
            validated_anchor: RwLock::new(None),
        })
    }

    pub fn with_max_lag_blocks(mut self, max_lag_blocks: u64) -> Self {
        self.max_lag_blocks = max_lag_blocks;
        self
    }

    pub fn api_base(&self) -> &Url {
        &self.api_base
    }

    fn endpoint(&self, relative: &str) -> anyhow::Result<Url> {
        self.api_base
            .join(relative)
            .with_context(|| format!("join ckbadger endpoint {relative:?}"))
    }

    fn status(&self, state: EnrichmentSourceState) -> EnrichmentSourceStatus {
        EnrichmentSourceStatus {
            source: self.name().to_string(),
            status: state,
            capabilities: self.capabilities(),
            indexed_tip: None,
            lag_blocks: None,
            validated_anchor: None,
            last_success_at_ms: None,
            message: None,
        }
    }

    fn clear_anchor(&self) {
        *self.validated_anchor.write().unwrap() = None;
    }

    fn current_anchor(&self, context: &CanonicalContext) -> anyhow::Result<ChainAnchor> {
        let anchor = self
            .validated_anchor
            .read()
            .unwrap()
            .clone()
            .ok_or_else(|| anyhow!("ckbadger has no validated canonical anchor"))?;
        if !context
            .recent_blocks
            .iter()
            .any(|block| block.number == anchor.block && block.hash == anchor.hash)
        {
            self.clear_anchor();
            return Err(anyhow!(
                "ckbadger anchor expired after a canonical chain change"
            ));
        }
        Ok(anchor)
    }

    async fn transaction_lifecycle(&self, tx_hash: &str) -> Option<TransactionLifecycleResponse> {
        let url = match self.endpoint(&format!("transactions/{tx_hash}/lifecycle")) {
            Ok(url) => url,
            Err(error) => {
                tracing::debug!(target: "cknerv-adapter-ckbadger", "{error}");
                return None;
            }
        };
        match self.client.get(url).send().await {
            Ok(response) if response.status().is_success() => response
                .json()
                .await
                .map_err(|error| {
                    tracing::debug!(
                        target: "cknerv-adapter-ckbadger",
                        "ckbadger transaction lifecycle decode failed: {error}"
                    );
                })
                .ok(),
            Ok(response) => {
                tracing::debug!(
                    target: "cknerv-adapter-ckbadger",
                    status = %response.status(),
                    "ckbadger transaction lifecycle unavailable"
                );
                None
            }
            Err(error) => {
                tracing::debug!(
                    target: "cknerv-adapter-ckbadger",
                    "ckbadger transaction lifecycle failed: {error}"
                );
                None
            }
        }
    }

    async fn script_lookups(&self, cell: &CellDetailResponse) -> ScriptLookupResponse {
        let mut hashes = vec![cell.lock.code_hash.as_str()];
        if let Some(type_script) = cell.type_script.as_ref() {
            if type_script.code_hash != cell.lock.code_hash {
                hashes.push(type_script.code_hash.as_str());
            }
        }
        let request = LookupScriptsRequest {
            code_hashes: hashes,
            tx_hash: &cell.tx_hash,
        };
        let url = match self.endpoint("scripts/lookup") {
            Ok(url) => url,
            Err(error) => {
                tracing::debug!(target: "cknerv-adapter-ckbadger", "{error}");
                return HashMap::new();
            }
        };
        match self.client.post(url).json(&request).send().await {
            Ok(response) if response.status().is_success() => {
                response.json().await.unwrap_or_else(|error| {
                    tracing::debug!(
                        target: "cknerv-adapter-ckbadger",
                        "ckbadger script lookup decode failed: {error}"
                    );
                    HashMap::new()
                })
            }
            Ok(response) => {
                tracing::debug!(
                    target: "cknerv-adapter-ckbadger",
                    status = %response.status(),
                    "ckbadger script lookup unavailable"
                );
                HashMap::new()
            }
            Err(error) => {
                tracing::debug!(
                    target: "cknerv-adapter-ckbadger",
                    "ckbadger script lookup failed: {error}"
                );
                HashMap::new()
            }
        }
    }

    async fn token_asset(&self, cell: &CellDetailResponse) -> Option<SemanticAsset> {
        match self.fetch_token_asset(cell).await {
            Ok(asset) => asset,
            Err(error) => {
                tracing::debug!(
                    target: "cknerv-adapter-ckbadger",
                    "ckbadger token identity unavailable: {error}"
                );
                None
            }
        }
    }

    async fn fetch_token_asset(
        &self,
        cell: &CellDetailResponse,
    ) -> anyhow::Result<Option<SemanticAsset>> {
        let Some((type_script_hash, amount)) = udt_asset_request(cell)? else {
            return Ok(None);
        };
        let url = self.endpoint(&format!("tokens/{type_script_hash}"))?;
        let response = self
            .client
            .get(url)
            .send()
            .await
            .context("fetch ckbadger token identity")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger token identity returned HTTP {}",
                response.status()
            ));
        }
        let token: TokenResponse = response
            .json()
            .await
            .context("decode ckbadger token identity")?;
        if token.type_script_hash != type_script_hash {
            return Err(anyhow!("ckbadger returned a different token identity"));
        }
        let decimals = token
            .decimals
            .map(u8::try_from)
            .transpose()
            .context("ckbadger returned invalid token decimals")?;
        Ok(Some(SemanticAsset {
            type_script_hash,
            standard: nonempty(token.standard),
            name: token.name.and_then(nonempty),
            symbol: token.symbol.and_then(nonempty),
            amount: Some(amount),
            decimals,
        }))
    }

    fn to_record(
        &self,
        cell: CellDetailResponse,
        anchor: ChainAnchor,
        lookups: &ScriptLookupResponse,
        asset: Option<SemanticAsset>,
    ) -> anyhow::Result<CellSemanticRecord> {
        let created_at_block = u64::try_from(cell.created_at_block)
            .map_err(|_| anyhow!("ckbadger returned a negative Cell creation block"))?;
        if created_at_block > anchor.block {
            return Err(anyhow!(
                "ckbadger Cell was created at block {created_at_block}, ahead of validated anchor {}",
                anchor.block
            ));
        }
        let output_index = u32::try_from(cell.output_index)
            .map_err(|_| anyhow!("ckbadger returned a negative Cell output index"))?;
        let lock_script = Some(map_script(cell.lock, cell.lock_script_hash, lookups));
        let type_script = cell
            .type_script
            .zip(cell.type_script_hash)
            .map(|(script, script_hash)| map_script(script, script_hash, lookups));
        let common_knowledge = Some(map_common_knowledge(cell.common_knowledge_size_breakdown)?);
        let mut facets = data_facets(cell.data_analysis);
        if cell.is_dep_group {
            let mut attributes = Vec::new();
            if let Some(items) = cell.dep_group_items {
                attributes.push(SemanticAttribute {
                    key: "members".to_string(),
                    value: items.len().to_string(),
                    unit: None,
                });
                for (index, item) in items.into_iter().take(8).enumerate() {
                    attributes.push(SemanticAttribute {
                        key: format!("member_{index}"),
                        value: format!("{}:{}", item.tx_hash, item.output_index),
                        unit: None,
                    });
                }
            }
            facets.push(SemanticFacet {
                namespace: "ckb".to_string(),
                kind: "dep_group".to_string(),
                state: None,
                attributes,
            });
        }
        if let Some(scripts) = cell.code_cell_of {
            facets.extend(scripts.into_iter().map(|script| SemanticFacet {
                namespace: "ckb".to_string(),
                kind: "code_cell".to_string(),
                state: Some(script.name),
                attributes: vec![
                    SemanticAttribute {
                        key: "code_hash".to_string(),
                        value: script.code_hash,
                        unit: None,
                    },
                    SemanticAttribute {
                        key: "hash_type".to_string(),
                        value: script.hash_type,
                        unit: None,
                    },
                ],
            }));
        }
        if let Some(dao) = cell.dao_info {
            facets.push(dao_facet(dao)?);
        }
        Ok(CellSemanticRecord {
            out_point: OutPoint {
                tx_hash: cell.tx_hash,
                index: output_index,
            },
            source: self.name().to_string(),
            as_of: anchor,
            observed_at_block: created_at_block,
            updated_at_ms: now_ms(),
            address: cell.address,
            cell_type: cell.cell_type,
            lock_script,
            type_script,
            asset,
            common_knowledge,
            facets,
        })
    }

    fn to_transaction_record(
        &self,
        transaction: TransactionDetailResponse,
        lifecycle: Option<TransactionLifecycleResponse>,
        anchor: ChainAnchor,
    ) -> anyhow::Result<TransactionSemanticRecord> {
        if transaction.status != "committed" {
            return Err(anyhow!(
                "ckbadger transaction detail is not committed: {}",
                transaction.status
            ));
        }
        let block = transaction
            .block_number
            .ok_or_else(|| anyhow!("ckbadger committed transaction has no block number"))
            .and_then(|value| nonnegative(value, "transaction blockNumber"))?;
        if block > anchor.block {
            return Err(anyhow!(
                "ckbadger transaction was committed at block {block}, ahead of validated anchor {}",
                anchor.block
            ));
        }
        let block_hash = transaction
            .block_hash
            .as_deref()
            .ok_or_else(|| anyhow!("ckbadger committed transaction has no block hash"))?;
        if !is_hash32(block_hash) {
            return Err(anyhow!(
                "ckbadger committed transaction has an invalid block hash"
            ));
        }
        unsigned_decimal(&transaction.fee, "transaction fee")?;

        let participants = transaction_participants(&transaction)?;
        let mut actions = vec![transaction_io_facet(&transaction)?];
        if let Some(lifecycle) = lifecycle {
            actions.push(transaction_lifecycle_facet(&transaction, lifecycle)?);
        }
        let cycles = transaction
            .cycles
            .filter(|value| *value > 0)
            .map(|value| {
                u64::try_from(value).context("ckbadger returned invalid transaction cycles")
            })
            .transpose()?;

        Ok(TransactionSemanticRecord {
            tx_hash: transaction.hash,
            block,
            source: self.name().to_string(),
            as_of: anchor,
            updated_at_ms: now_ms(),
            actions,
            participants,
            fee: Some(transaction.fee),
            cycles,
        })
    }
}

#[async_trait]
impl EnrichmentSource for CkbadgerEnrichmentSource {
    fn name(&self) -> &'static str {
        "ckbadger"
    }

    fn capabilities(&self) -> Vec<String> {
        CAPABILITIES
            .iter()
            .map(|value| (*value).to_string())
            .collect()
    }

    async fn probe(&self, context: &CanonicalContext) -> EnrichmentSourceStatus {
        let mut status = self.status(EnrichmentSourceState::Connecting);
        if context.replay_active || context.recent_blocks.is_empty() {
            self.clear_anchor();
            status.status = EnrichmentSourceState::Syncing;
            status.message = Some(if context.replay_active {
                "waiting for canonical replay to complete".to_string()
            } else {
                "waiting for canonical block evidence".to_string()
            });
            return status;
        }

        let network_url = match self.endpoint("statistics/network") {
            Ok(url) => url,
            Err(error) => {
                self.clear_anchor();
                status.status = EnrichmentSourceState::Error;
                status.message = Some(error.to_string());
                return status;
            }
        };
        let network: NetworkStats = match self.client.get(network_url).send().await {
            Ok(response) if response.status().is_success() => match response.json().await {
                Ok(network) => network,
                Err(error) => {
                    self.clear_anchor();
                    status.status = EnrichmentSourceState::Error;
                    status.message = Some(format!("decode ckbadger network status: {error}"));
                    return status;
                }
            },
            Ok(response) => {
                self.clear_anchor();
                status.status = EnrichmentSourceState::Error;
                status.message = Some(format!(
                    "ckbadger network status returned HTTP {}",
                    response.status()
                ));
                return status;
            }
            Err(error) => {
                self.clear_anchor();
                status.status = EnrichmentSourceState::Error;
                status.message = Some(format!("connect to ckbadger: {error}"));
                return status;
            }
        };

        let indexed_tip = match u64::try_from(network.sync_status.synced_block) {
            Ok(tip) => tip,
            Err(_) => {
                self.clear_anchor();
                status.status = EnrichmentSourceState::Error;
                status.message = Some("ckbadger returned a negative indexed tip".to_string());
                return status;
            }
        };
        status.indexed_tip = Some(indexed_tip);
        status.lag_blocks = Some(context.tip.saturating_sub(indexed_tip));

        let Some(canonical) = context
            .recent_blocks
            .iter()
            .filter(|block| block.number <= indexed_tip)
            .max_by_key(|block| block.number)
        else {
            self.clear_anchor();
            status.status = EnrichmentSourceState::Syncing;
            status.message =
                Some("ckbadger tip is behind cknerv's retained block-hash evidence".to_string());
            return status;
        };
        let block_url = match self.endpoint(&format!("blocks/{}", canonical.number)) {
            Ok(url) => url,
            Err(error) => {
                self.clear_anchor();
                status.status = EnrichmentSourceState::Error;
                status.message = Some(error.to_string());
                return status;
            }
        };
        let indexed_block: BlockResponse = match self.client.get(block_url).send().await {
            Ok(response) if response.status().is_success() => match response.json().await {
                Ok(block) => block,
                Err(error) => {
                    self.clear_anchor();
                    status.status = EnrichmentSourceState::Error;
                    status.message = Some(format!("decode ckbadger block anchor: {error}"));
                    return status;
                }
            },
            Ok(response) => {
                self.clear_anchor();
                status.status = EnrichmentSourceState::Error;
                status.message = Some(format!(
                    "ckbadger block anchor returned HTTP {}",
                    response.status()
                ));
                return status;
            }
            Err(error) => {
                self.clear_anchor();
                status.status = EnrichmentSourceState::Error;
                status.message = Some(format!("fetch ckbadger block anchor: {error}"));
                return status;
            }
        };
        if indexed_block.number != canonical.number as i64 || indexed_block.hash != canonical.hash {
            self.clear_anchor();
            status.status = EnrichmentSourceState::Incompatible;
            status.message = Some(format!(
                "block {} hash differs between CKB and ckbadger",
                canonical.number
            ));
            return status;
        }

        let anchor = ChainAnchor {
            block: canonical.number,
            hash: canonical.hash.clone(),
        };
        *self.validated_anchor.write().unwrap() = Some(anchor.clone());
        status.validated_anchor = Some(anchor);
        status.last_success_at_ms = Some(now_ms());
        let lag = status.lag_blocks.unwrap_or(0);
        status.status = if network.sync_status.is_syncing {
            EnrichmentSourceState::Syncing
        } else if lag > self.max_lag_blocks {
            EnrichmentSourceState::Stale
        } else {
            EnrichmentSourceState::Ready
        };
        if status.status == EnrichmentSourceState::Stale {
            status.message = Some(format!("ckbadger is {lag} blocks behind CKB"));
        }
        status
    }

    async fn enrich_cell(
        &self,
        out_point: &OutPoint,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<CellSemanticRecord>> {
        if !is_hash32(&out_point.tx_hash) {
            return Err(anyhow!(
                "Cell transaction hash must be 0x-prefixed 32-byte hex"
            ));
        }
        let requested_index = i32::try_from(out_point.index)
            .context("Cell output index is outside ckbadger's API range")?;
        let anchor = self.current_anchor(context)?;
        let url = self.endpoint(&format!("cells/{}/{}", out_point.tx_hash, out_point.index))?;
        let response = self
            .client
            .get(url)
            .send()
            .await
            .context("fetch ckbadger Cell detail")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger Cell detail returned HTTP {}",
                response.status()
            ));
        }
        let cell: CellDetailResponse = response
            .json()
            .await
            .context("decode ckbadger Cell detail")?;
        if cell.tx_hash != out_point.tx_hash || cell.output_index != requested_index {
            return Err(anyhow!("ckbadger returned a different outpoint"));
        }
        let (lookups, asset) = tokio::join!(self.script_lookups(&cell), self.token_asset(&cell));
        self.to_record(cell, anchor, &lookups, asset).map(Some)
    }

    async fn enrich_transaction(
        &self,
        tx_hash: &str,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<TransactionSemanticRecord>> {
        if !is_hash32(tx_hash) {
            return Err(anyhow!("transaction hash must be 0x-prefixed 32-byte hex"));
        }
        let anchor = self.current_anchor(context)?;
        let detail_url = self.endpoint(&format!("transactions/{tx_hash}/detail"))?;
        let response = self
            .client
            .get(detail_url)
            .send()
            .await
            .context("fetch ckbadger transaction detail")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger transaction detail returned HTTP {}",
                response.status()
            ));
        }
        let transaction: TransactionDetailResponse = response
            .json()
            .await
            .context("decode ckbadger transaction detail")?;
        if transaction.hash != tx_hash {
            return Err(anyhow!("ckbadger returned a different transaction"));
        }
        let lifecycle = self.transaction_lifecycle(tx_hash).await;
        self.to_transaction_record(transaction, lifecycle, anchor)
            .map(Some)
    }

    async fn enrich_asset_ecosystem(
        &self,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<AssetEcosystemRecord>> {
        let anchor = self.current_anchor(context)?;
        let url = self.endpoint("statistics/asset-ecosystem")?;
        let response = self
            .client
            .get(url)
            .send()
            .await
            .context("fetch ckbadger asset ecosystem")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger asset ecosystem returned HTTP {}",
                response.status()
            ));
        }
        let ecosystem: AssetEcosystemResponse = response
            .json()
            .await
            .context("decode ckbadger asset ecosystem")?;
        map_asset_ecosystem(ecosystem, anchor).map(Some)
    }

    async fn enrich_activity_feed(
        &self,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<ActivityFeedRecord>> {
        let anchor = self.current_anchor(context)?;
        let mut url = self.endpoint("activities/latest")?;
        url.query_pairs_mut()
            .append_pair("limit", &ACTIVITY_FEED_LIMIT.to_string());
        let response = self
            .client
            .get(url)
            .send()
            .await
            .context("fetch ckbadger latest activities")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger latest activities returned HTTP {}",
                response.status()
            ));
        }
        let activities: Vec<LatestActivityResponse> = response
            .json()
            .await
            .context("decode ckbadger latest activities")?;
        map_activity_feed(activities, anchor).map(Some)
    }
}

fn map_activity_feed(
    activities: Vec<LatestActivityResponse>,
    anchor: ChainAnchor,
) -> anyhow::Result<ActivityFeedRecord> {
    if activities.len() > ACTIVITY_FEED_LIMIT {
        return Err(anyhow!(
            "ckbadger latest activities exceeded the requested limit"
        ));
    }

    let mut tx_hashes = HashSet::new();
    let mut previous_block = None;
    let mut mapped = Vec::with_capacity(activities.len());
    for activity in activities {
        if activity.is_cellbase {
            return Err(anyhow!(
                "ckbadger latest activities unexpectedly included cellbase"
            ));
        }
        if !is_hash32(&activity.tx_hash) {
            return Err(anyhow!(
                "ckbadger latest activities returned an invalid transaction hash"
            ));
        }
        if !tx_hashes.insert(activity.tx_hash.clone()) {
            return Err(anyhow!(
                "ckbadger latest activities returned a duplicate transaction"
            ));
        }
        let block = nonnegative(activity.block_number, "activity blockNumber")?;
        wire_safe_u64(block, "activity blockNumber")?;
        if previous_block.is_some_and(|previous| block > previous) {
            return Err(anyhow!(
                "ckbadger latest activities were not ordered newest first"
            ));
        }
        previous_block = Some(block);
        // The chain may advance between the source probe and this bounded
        // request. Keep validating response order, but publish only the safe
        // suffix already covered by the validated anchor. A later probe will
        // admit the leading entries once their block hash is proven.
        if block > anchor.block {
            continue;
        }
        let timestamp_ms = unsigned_decimal(&activity.timestamp, "activity timestamp")?;
        let timestamp_ms =
            u64::try_from(timestamp_ms).context("ckbadger activity timestamp is outside u64")?;
        wire_safe_u64(timestamp_ms, "activity timestamp")?;
        if activity.participants.len() > MAX_ACTIVITY_PARTICIPANTS {
            return Err(anyhow!("ckbadger activity returned too many participants"));
        }
        let participant_count = u32::try_from(activity.participants.len())
            .context("ckbadger activity participant count is outside u32")?;
        let (category, label) = classify_activity(&activity)?;
        mapped.push(ActivityFeedItem {
            tx_hash: activity.tx_hash,
            block,
            timestamp_ms,
            category,
            label,
            participant_count,
        });
    }

    Ok(ActivityFeedRecord {
        source: "ckbadger".to_string(),
        as_of: anchor,
        updated_at_ms: now_ms(),
        activities: mapped,
    })
}

fn classify_activity(
    activity: &LatestActivityResponse,
) -> anyhow::Result<(String, Option<String>)> {
    let nested_items = activity
        .protocol_actions
        .len()
        .checked_add(activity.type_calls.len())
        .and_then(|count| count.checked_add(activity.lock_calls.len()))
        .and_then(|count| {
            activity
                .participants
                .iter()
                .try_fold(count, |total, participant| {
                    total.checked_add(participant.item_deltas.len())
                })
        })
        .ok_or_else(|| anyhow!("ckbadger activity nested item count overflows"))?;
    if nested_items > MAX_ACTIVITY_NESTED_ITEMS {
        return Err(anyhow!("ckbadger activity returned too many nested items"));
    }

    let mut protocol_label = None;
    let mut protocol_category = None;
    for action in &activity.protocol_actions {
        let protocol = bounded_activity_label(&action.protocol, "activity protocol")?
            .ok_or_else(|| anyhow!("ckbadger activity returned an empty protocol"))?;
        let action = bounded_activity_label(&action.action, "activity action")?
            .ok_or_else(|| anyhow!("ckbadger activity returned an empty action"))?;
        if protocol_label.is_none() || protocol.eq_ignore_ascii_case("dao") {
            protocol_category = Some(if protocol.eq_ignore_ascii_case("dao") {
                "dao"
            } else {
                "protocol"
            });
            protocol_label = Some(format!("{protocol} · {action}"));
        }
    }
    if let Some(category) = protocol_category {
        return Ok((category.to_string(), protocol_label));
    }

    let mut item_category = None;
    for participant in &activity.participants {
        for item in &participant.item_deltas {
            let kind = item.kind.trim();
            if !matches!(kind, "token" | "object" | "identity") {
                return Err(anyhow!(
                    "ckbadger activity returned unsupported item kind {kind:?}"
                ));
            }
            item_category.get_or_insert_with(|| kind.to_string());
        }
    }
    if let Some(category) = item_category {
        return Ok((category, None));
    }

    let mut script_label = None;
    for call in activity.type_calls.iter().chain(&activity.lock_calls) {
        if let Some(name) = call.script_name.as_deref() {
            let name = bounded_activity_label(name, "activity script name")?;
            if script_label.is_none() {
                script_label = name;
            }
        }
    }
    if !activity.type_calls.is_empty() || !activity.lock_calls.is_empty() {
        return Ok(("script".to_string(), script_label));
    }

    Ok(("transfer".to_string(), None))
}

fn bounded_activity_label(value: &str, field: &str) -> anyhow::Result<Option<String>> {
    let value = value.trim();
    if value.chars().count() > MAX_ACTIVITY_LABEL_CHARS {
        return Err(anyhow!("ckbadger returned an overlong {field}"));
    }
    Ok((!value.is_empty()).then(|| value.to_string()))
}

fn map_asset_ecosystem(
    ecosystem: AssetEcosystemResponse,
    anchor: ChainAnchor,
) -> anyhow::Result<AssetEcosystemRecord> {
    if ecosystem.capacity_breakdown.len() > MAX_ECOSYSTEM_CATEGORIES {
        return Err(anyhow!(
            "ckbadger asset ecosystem returned too many capacity categories"
        ));
    }
    if ecosystem.top_tokens.len() > MAX_ECOSYSTEM_ASSETS {
        return Err(anyhow!(
            "ckbadger asset ecosystem returned too many top assets"
        ));
    }

    let total_live_capacity = ckb_decimal_to_shannons(
        &ecosystem.total_live_capacity_ckb,
        "asset ecosystem totalLiveCapacityCkb",
    )?;
    let total_knowledge_shannons = ckb_decimal_to_shannons(
        &ecosystem.total_knowledge_size_ckb,
        "asset ecosystem totalKnowledgeSizeCkb",
    )?;
    if total_knowledge_shannons % SHANNONS_PER_CKB != 0 {
        return Err(anyhow!(
            "ckbadger asset ecosystem returned fractional knowledge bytes"
        ));
    }
    if total_knowledge_shannons > total_live_capacity {
        return Err(anyhow!(
            "ckbadger asset ecosystem knowledge exceeds total live capacity"
        ));
    }
    let total_knowledge_bytes = u64::try_from(total_knowledge_shannons / SHANNONS_PER_CKB)
        .context("ckbadger asset ecosystem knowledge size is outside u64")?;
    wire_safe_u64(
        total_knowledge_bytes,
        "asset ecosystem total knowledge bytes",
    )?;

    let mut category_keys = HashSet::<String>::new();
    let mut category_capacity_sum = 0u128;
    let mut category_share_sum = 0u32;
    let mut capacity_breakdown = Vec::with_capacity(ecosystem.capacity_breakdown.len());
    for category in ecosystem.capacity_breakdown {
        let key = nonempty(category.category)
            .ok_or_else(|| anyhow!("ckbadger asset ecosystem returned an empty category"))?;
        if !category_keys.insert(key.clone()) {
            return Err(anyhow!(
                "ckbadger asset ecosystem returned duplicate category {key}"
            ));
        }
        let capacity = ckb_decimal_to_shannons(
            &category.capacity_ckb,
            "asset ecosystem category capacityCkb",
        )?;
        category_capacity_sum = category_capacity_sum
            .checked_add(capacity)
            .ok_or_else(|| anyhow!("ckbadger asset ecosystem category capacity overflows"))?;
        let share_bps =
            percentage_to_bps(&category.percentage, "asset ecosystem category percentage")?;
        category_share_sum = category_share_sum
            .checked_add(u32::from(share_bps))
            .ok_or_else(|| anyhow!("ckbadger asset ecosystem category share overflows"))?;
        capacity_breakdown.push(AssetEcosystemCategory {
            category: key,
            capacity_shannons: capacity.to_string(),
            share_bps,
        });
    }
    if category_capacity_sum > total_live_capacity {
        return Err(anyhow!(
            "ckbadger asset ecosystem categories exceed total live capacity"
        ));
    }
    if category_share_sum > 10_000 {
        return Err(anyhow!(
            "ckbadger asset ecosystem category shares exceed 100%"
        ));
    }

    let mut asset_hashes = HashSet::<String>::new();
    let mut top_assets = Vec::with_capacity(ecosystem.top_tokens.len());
    for asset in ecosystem.top_tokens {
        if !is_hash32(&asset.type_script_hash) {
            return Err(anyhow!(
                "ckbadger asset ecosystem returned an invalid type-script hash"
            ));
        }
        if !asset_hashes.insert(asset.type_script_hash.clone()) {
            return Err(anyhow!(
                "ckbadger asset ecosystem returned a duplicate top asset"
            ));
        }
        let capacity = ckb_decimal_to_shannons(
            &asset.total_capacity_ckb,
            "asset ecosystem token totalCapacityCkb",
        )?;
        if capacity > total_live_capacity {
            return Err(anyhow!(
                "ckbadger asset ecosystem asset capacity exceeds total live capacity"
            ));
        }
        let holders_count = nonnegative(asset.holders_count, "asset ecosystem holdersCount")?;
        wire_safe_u64(holders_count, "asset ecosystem holdersCount")?;
        top_assets.push(AssetEcosystemLeader {
            type_script_hash: asset.type_script_hash,
            name: asset.name.and_then(nonempty),
            symbol: asset.symbol.and_then(nonempty),
            holders_count,
            total_capacity_shannons: capacity.to_string(),
        });
    }

    Ok(AssetEcosystemRecord {
        source: "ckbadger".to_string(),
        as_of: anchor,
        updated_at_ms: now_ms(),
        total_live_capacity_shannons: total_live_capacity.to_string(),
        total_knowledge_bytes,
        capacity_breakdown,
        top_assets,
    })
}

struct ParticipantCapacity {
    delta: i128,
    complete: bool,
}

fn transaction_participants(
    transaction: &TransactionDetailResponse,
) -> anyhow::Result<Vec<TransactionParticipantSemantic>> {
    let mut participants = BTreeMap::<String, ParticipantCapacity>::new();
    for input in &transaction.inputs {
        accumulate_participant_capacity(
            &mut participants,
            input.address.as_deref(),
            input.capacity.as_deref(),
            -1,
            "transaction input capacity",
        )?;
    }
    for output in &transaction.outputs {
        accumulate_participant_capacity(
            &mut participants,
            output.address.as_deref(),
            Some(&output.capacity),
            1,
            "transaction output capacity",
        )?;
    }
    Ok(participants
        .into_iter()
        .map(|(address, capacity)| TransactionParticipantSemantic {
            address,
            capacity_delta: capacity.complete.then(|| capacity.delta.to_string()),
            common_knowledge_delta: None,
            facets: Vec::new(),
        })
        .collect())
}

fn accumulate_participant_capacity(
    participants: &mut BTreeMap<String, ParticipantCapacity>,
    address: Option<&str>,
    capacity: Option<&str>,
    sign: i128,
    field: &str,
) -> anyhow::Result<()> {
    let parsed = capacity
        .map(|value| signed_capacity(value, field))
        .transpose()?;
    let Some(address) = address.filter(|value| !value.is_empty()) else {
        return Ok(());
    };
    let participant = participants
        .entry(address.to_string())
        .or_insert(ParticipantCapacity {
            delta: 0,
            complete: true,
        });
    let Some(capacity) = parsed else {
        participant.complete = false;
        return Ok(());
    };
    let signed = capacity
        .checked_mul(sign)
        .ok_or_else(|| anyhow!("ckbadger {field} overflows signed capacity"))?;
    participant.delta = participant
        .delta
        .checked_add(signed)
        .ok_or_else(|| anyhow!("ckbadger participant capacity delta overflows"))?;
    Ok(())
}

fn transaction_io_facet(transaction: &TransactionDetailResponse) -> anyhow::Result<SemanticFacet> {
    let inputs = nonnegative(
        i64::from(transaction.inputs_count),
        "transaction inputsCount",
    )?;
    let outputs = nonnegative(
        i64::from(transaction.outputs_count),
        "transaction outputsCount",
    )?;
    if inputs as usize != transaction.inputs.len() || outputs as usize != transaction.outputs.len()
    {
        return Err(anyhow!(
            "ckbadger transaction I/O counts do not match the detail arrays"
        ));
    }
    let mut attributes = vec![
        attribute("inputs", inputs.to_string(), None),
        attribute("outputs", outputs.to_string(), None),
        attribute("cellbase", transaction.is_cellbase.to_string(), None),
    ];
    if let Some(block_hash) = transaction.block_hash.as_ref() {
        attributes.push(attribute("block_hash", block_hash.clone(), None));
    }
    if let Some(fee_rate) = transaction.fee_rate.as_ref() {
        unsigned_decimal(fee_rate, "transaction feeRate")?;
        attributes.push(attribute("fee_rate", fee_rate.clone(), Some("shannons/kB")));
    }
    if let Some(size) = transaction.tx_size {
        attributes.push(attribute(
            "size",
            nonnegative(i64::from(size), "transaction txSize")?.to_string(),
            Some("bytes"),
        ));
    }
    if let Some(confirmations) = transaction.confirmations {
        attributes.push(attribute(
            "confirmations",
            nonnegative(confirmations, "transaction confirmations")?.to_string(),
            None,
        ));
    }
    for (key, value, unit) in [
        (
            "inputs_capacity",
            transaction.inputs_capacity.as_ref(),
            "shannons",
        ),
        (
            "outputs_capacity",
            transaction.outputs_capacity.as_ref(),
            "shannons",
        ),
        (
            "inputs_common_knowledge",
            transaction.inputs_common_knowledge_size.as_ref(),
            "bytes",
        ),
        (
            "outputs_common_knowledge",
            transaction.outputs_common_knowledge_size.as_ref(),
            "bytes",
        ),
    ] {
        if let Some(value) = value {
            unsigned_decimal(value, key)?;
            attributes.push(attribute(key, value.clone(), Some(unit)));
        }
    }
    let observed_output_knowledge = transaction.outputs.iter().try_fold(0u64, |sum, output| {
        let value = nonnegative(
            output.common_knowledge_size,
            "transaction output commonKnowledgeSize",
        )?;
        sum.checked_add(value)
            .ok_or_else(|| anyhow!("ckbadger output common knowledge sum overflows"))
    })?;
    if transaction.outputs_common_knowledge_size.is_none() {
        attributes.push(attribute(
            "outputs_common_knowledge",
            observed_output_knowledge.to_string(),
            Some("bytes"),
        ));
    }
    Ok(SemanticFacet {
        namespace: "ckb".to_string(),
        kind: "transaction_io".to_string(),
        state: Some(transaction.status.clone()),
        attributes,
    })
}

fn transaction_lifecycle_facet(
    transaction: &TransactionDetailResponse,
    lifecycle: TransactionLifecycleResponse,
) -> anyhow::Result<SemanticFacet> {
    if lifecycle.hash != transaction.hash {
        return Err(anyhow!(
            "ckbadger lifecycle returned a different transaction"
        ));
    }
    if lifecycle.phase != "committed" || lifecycle.is_cellbase != transaction.is_cellbase {
        return Err(anyhow!(
            "ckbadger lifecycle disagrees with transaction detail"
        ));
    }
    let committed = lifecycle
        .committed_in
        .ok_or_else(|| anyhow!("ckbadger committed lifecycle has no commit block"))?;
    let detail_block = transaction
        .block_number
        .ok_or_else(|| anyhow!("ckbadger committed transaction has no block number"))?;
    let detail_hash = transaction
        .block_hash
        .as_deref()
        .ok_or_else(|| anyhow!("ckbadger committed transaction has no block hash"))?;
    if committed.block_number != detail_block || committed.block_hash != detail_hash {
        return Err(anyhow!(
            "ckbadger lifecycle commit anchor disagrees with transaction detail"
        ));
    }
    let mut attributes = vec![
        attribute("proposal_id", lifecycle.proposal_id, None),
        attribute(
            "committed_block",
            nonnegative(committed.block_number, "lifecycle committed block")?.to_string(),
            None,
        ),
    ];
    if let Some(proposed) = lifecycle.proposed_in {
        if !is_hash32(&proposed.block_hash) {
            return Err(anyhow!("ckbadger lifecycle has an invalid proposal hash"));
        }
        attributes.push(attribute(
            "proposed_block",
            nonnegative(proposed.block_number, "lifecycle proposed block")?.to_string(),
            None,
        ));
    }
    if let Some(uncle) = lifecycle.proposed_in_uncle {
        if !is_hash32(&uncle.block_hash) {
            return Err(anyhow!("ckbadger lifecycle has an invalid uncle hash"));
        }
        attributes.push(attribute(
            "proposed_uncle_block",
            nonnegative(uncle.block_number, "lifecycle proposal uncle block")?.to_string(),
            None,
        ));
    }
    if let Some(distance) = lifecycle.commitment_distance {
        attributes.push(attribute(
            "commitment_distance",
            nonnegative(distance, "lifecycle commitment distance")?.to_string(),
            Some("blocks"),
        ));
    }
    attributes.push(attribute(
        "window_close",
        nonnegative(lifecycle.commitment_window.close, "lifecycle window close")?.to_string(),
        Some("blocks"),
    ));
    attributes.push(attribute(
        "window_far",
        nonnegative(lifecycle.commitment_window.far, "lifecycle window far")?.to_string(),
        Some("blocks"),
    ));
    if let Some(confirmations) = lifecycle.confirmations {
        attributes.push(attribute(
            "confirmations",
            nonnegative(confirmations, "lifecycle confirmations")?.to_string(),
            None,
        ));
    }
    Ok(SemanticFacet {
        namespace: "ckb".to_string(),
        kind: "transaction_lifecycle".to_string(),
        state: Some(lifecycle.phase),
        attributes,
    })
}

fn attribute(
    key: impl Into<String>,
    value: impl Into<String>,
    unit: Option<&str>,
) -> SemanticAttribute {
    SemanticAttribute {
        key: key.into(),
        value: value.into(),
        unit: unit.map(str::to_string),
    }
}

fn unsigned_decimal(value: &str, field: &str) -> anyhow::Result<u128> {
    value
        .parse::<u128>()
        .with_context(|| format!("ckbadger returned invalid {field}"))
}

fn fixed_decimal_to_scaled(value: &str, scale: usize, field: &str) -> anyhow::Result<u128> {
    let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
    if whole.is_empty()
        || !whole.as_bytes().iter().all(u8::is_ascii_digit)
        || !fraction.as_bytes().iter().all(u8::is_ascii_digit)
        || value.matches('.').count() > 1
    {
        return Err(anyhow!("ckbadger returned invalid {field}"));
    }
    let (kept_fraction, extra_fraction) = if fraction.len() > scale {
        fraction.split_at(scale)
    } else {
        (fraction, "")
    };
    if extra_fraction.bytes().any(|digit| digit != b'0') {
        return Err(anyhow!("ckbadger returned over-precise {field}"));
    }
    let factor = 10u128
        .checked_pow(u32::try_from(scale).context("decimal scale exceeds u32")?)
        .ok_or_else(|| anyhow!("decimal scale overflows"))?;
    let whole = whole
        .parse::<u128>()
        .with_context(|| format!("ckbadger returned invalid {field}"))?;
    let mut padded_fraction = kept_fraction.to_string();
    padded_fraction.extend(std::iter::repeat_n('0', scale - kept_fraction.len()));
    let fraction = if padded_fraction.is_empty() {
        0
    } else {
        padded_fraction
            .parse::<u128>()
            .with_context(|| format!("ckbadger returned invalid {field}"))?
    };
    whole
        .checked_mul(factor)
        .and_then(|value| value.checked_add(fraction))
        .ok_or_else(|| anyhow!("ckbadger {field} overflows"))
}

fn ckb_decimal_to_shannons(value: &str, field: &str) -> anyhow::Result<u128> {
    fixed_decimal_to_scaled(value, 8, field)
}

fn percentage_to_bps(value: &str, field: &str) -> anyhow::Result<u16> {
    let bps = fixed_decimal_to_scaled(value, 2, field)?;
    if bps > 10_000 {
        return Err(anyhow!("ckbadger returned {field} above 100%"));
    }
    u16::try_from(bps).with_context(|| format!("ckbadger returned invalid {field}"))
}

fn signed_capacity(value: &str, field: &str) -> anyhow::Result<i128> {
    value
        .parse::<i128>()
        .with_context(|| format!("ckbadger returned invalid {field}"))
        .and_then(|value| {
            (value >= 0)
                .then_some(value)
                .ok_or_else(|| anyhow!("ckbadger returned negative {field}"))
        })
}

fn nonempty(value: impl Into<String>) -> Option<String> {
    let value = value.into();
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn udt_asset_request(cell: &CellDetailResponse) -> anyhow::Result<Option<(String, String)>> {
    let Some(decoded) = cell
        .data_analysis
        .as_ref()
        .and_then(|analysis| analysis.deterministic.as_ref())
        .filter(|decoded| decoded.kind == "udt_amount")
    else {
        return Ok(None);
    };
    let amount = decoded
        .segments
        .iter()
        .find(|segment| segment.label == "amount")
        .map(|segment| segment.human_value.clone())
        .ok_or_else(|| anyhow!("ckbadger UDT decode has no amount segment"))?;
    unsigned_decimal(&amount, "UDT amount")?;
    let type_script_hash = cell
        .type_script_hash
        .clone()
        .ok_or_else(|| anyhow!("ckbadger UDT decode has no type-script hash"))?;
    if !is_hash32(&type_script_hash) {
        return Err(anyhow!(
            "ckbadger UDT decode has an invalid type-script hash"
        ));
    }
    Ok(Some((type_script_hash, amount)))
}

fn map_common_knowledge(
    breakdown: CommonKnowledgeSizeBreakdown,
) -> anyhow::Result<CommonKnowledgeBreakdown> {
    let mapped = CommonKnowledgeBreakdown {
        total_bytes: nonnegative(breakdown.total_bytes, "totalBytes")?,
        capacity_field_bytes: nonnegative(breakdown.capacity_field_bytes, "capacityFieldBytes")?,
        lock_script_bytes: nonnegative(breakdown.lock_script_bytes, "lockScriptBytes")?,
        type_script_bytes: nonnegative(breakdown.type_script_bytes, "typeScriptBytes")?,
        data_bytes: nonnegative(breakdown.data_bytes, "dataBytes")?,
    };
    let component_total = mapped
        .capacity_field_bytes
        .checked_add(mapped.lock_script_bytes)
        .and_then(|value| value.checked_add(mapped.type_script_bytes))
        .and_then(|value| value.checked_add(mapped.data_bytes))
        .ok_or_else(|| anyhow!("ckbadger common-knowledge breakdown overflows"))?;
    if component_total != mapped.total_bytes {
        return Err(anyhow!(
            "ckbadger common-knowledge breakdown totals {} bytes, expected {}",
            component_total,
            mapped.total_bytes
        ));
    }
    Ok(mapped)
}

fn map_script(
    script: ScriptResponse,
    script_hash: String,
    lookups: &ScriptLookupResponse,
) -> SemanticScript {
    let lookup = lookups.get(&script.code_hash);
    SemanticScript {
        script_hash,
        code_hash: script.code_hash,
        hash_type: script.hash_type,
        args: script.args,
        name: lookup.map(|info| info.name.clone()),
        family: lookup.and_then(script_family),
        deprecated: lookup.map(|info| info.deprecated),
    }
}

fn script_family(info: &ScriptLookupInfo) -> Option<String> {
    info.decoder_type
        .clone()
        .or_else(|| info.script_kind.clone())
        .or_else(|| (info.resolution_state != "resolved").then(|| info.resolution_state.clone()))
}

fn data_facets(analysis: Option<CellDataAnalysis>) -> Vec<SemanticFacet> {
    let Some(analysis) = analysis else {
        return Vec::new();
    };
    let mut facets = Vec::new();
    if let Some(decoded) = analysis.deterministic {
        facets.push(SemanticFacet {
            namespace: "cell_data".to_string(),
            kind: decoded.kind,
            state: Some(decoded.summary),
            attributes: decoded
                .segments
                .into_iter()
                .map(|segment| SemanticAttribute {
                    key: segment.label,
                    value: segment.human_value,
                    unit: None,
                })
                .collect(),
        });
    }
    facets.extend(analysis.heuristic_guesses.into_iter().map(|guess| {
        let mut attributes = vec![SemanticAttribute {
            key: "reason".to_string(),
            value: guess.reason,
            unit: None,
        }];
        if let Some(mime_type) = guess.mime_type {
            attributes.push(SemanticAttribute {
                key: "mime_type".to_string(),
                value: mime_type,
                unit: None,
            });
        }
        if let Some(value) = guess.human_value {
            attributes.push(SemanticAttribute {
                key: "value".to_string(),
                value,
                unit: None,
            });
        }
        SemanticFacet {
            namespace: "cell_data".to_string(),
            kind: guess.kind,
            state: Some(guess.confidence),
            attributes,
        }
    }));
    facets
}

fn dao_facet(dao: DaoInfo) -> anyhow::Result<SemanticFacet> {
    let mut attributes = vec![SemanticAttribute {
        key: "deposit_block".to_string(),
        value: nonnegative(dao.deposit_block_number, "depositBlockNumber")?.to_string(),
        unit: Some("block".to_string()),
    }];
    if let Some(block) = dao.withdraw_request_block {
        attributes.push(SemanticAttribute {
            key: "withdraw_request_block".to_string(),
            value: nonnegative(block, "withdrawRequestBlock")?.to_string(),
            unit: Some("block".to_string()),
        });
    }
    if let Some(block) = dao.withdraw_block {
        attributes.push(SemanticAttribute {
            key: "withdraw_block".to_string(),
            value: nonnegative(block, "withdrawBlock")?.to_string(),
            unit: Some("block".to_string()),
        });
    }
    if let Some(compensation) = dao.compensation_ckb {
        attributes.push(SemanticAttribute {
            key: "compensation".to_string(),
            value: compensation,
            unit: Some("CKB".to_string()),
        });
    }
    if let Some(apc) = dao.estimated_apc {
        attributes.push(SemanticAttribute {
            key: "estimated_apc".to_string(),
            value: apc,
            unit: None,
        });
    }
    Ok(SemanticFacet {
        namespace: "ckb".to_string(),
        kind: "dao".to_string(),
        state: Some(dao.dao_status),
        attributes,
    })
}

fn nonnegative(value: i64, field: &str) -> anyhow::Result<u64> {
    u64::try_from(value).with_context(|| format!("ckbadger returned negative {field}"))
}

fn wire_safe_u64(value: u64, field: &str) -> anyhow::Result<u64> {
    (value <= MAX_WIRE_SAFE_U64)
        .then_some(value)
        .ok_or_else(|| anyhow!("ckbadger returned {field} outside the JSON safe-integer range"))
}

fn is_hash32(value: &str) -> bool {
    value.len() == 66
        && value.starts_with("0x")
        && value.as_bytes()[2..].iter().all(u8::is_ascii_hexdigit)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::{get, post};
    use axum::{Json, Router};
    use cknerv_core::RecentBlock;

    const TX_HASH: &str = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const ASSET_TX_HASH: &str =
        "0x3333333333333333333333333333333333333333333333333333333333333333";
    const ASSET_TYPE_HASH: &str =
        "0x2222222222222222222222222222222222222222222222222222222222222222";
    const TX_BLOCK_HASH: &str =
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    async fn spawn_mock_api(block_hash: &str) -> (Url, tokio::task::JoinHandle<()>) {
        let response_hash = block_hash.to_string();
        let app = Router::new()
            .route(
                "/api/v1/statistics/network",
                get(|| async {
                    Json(serde_json::json!({
                        "syncStatus": {
                            "isSyncing": false,
                            "syncedBlock": 100
                        }
                    }))
                }),
            )
            .route(
                "/api/v1/blocks/:number",
                get(move || {
                    let hash = response_hash.clone();
                    async move {
                        Json(serde_json::json!({
                            "number": 100,
                            "hash": hash
                        }))
                    }
                }),
            )
            .route(
                "/api/v1/statistics/asset-ecosystem",
                get(|| async {
                    Json(serde_json::json!({
                        "topTokens": [{
                            "typeScriptHash": ASSET_TYPE_HASH,
                            "name": "Nervos Test Token",
                            "symbol": "NTT",
                            "holdersCount": 42,
                            "totalCapacityCkb": "1234.50000000"
                        }],
                        "capacityBreakdown": [
                            {
                                "category": "dao",
                                "capacityCkb": "250000.00000000",
                                "percentage": "25.00"
                            },
                            {
                                "category": "tokens",
                                "capacityCkb": "10000.50000000",
                                "percentage": "1.00"
                            },
                            {
                                "category": "other",
                                "capacityCkb": "739999.50000000",
                                "percentage": "74.00"
                            }
                        ],
                        "totalLiveCapacityCkb": "1000000.00000000",
                        "totalKnowledgeSizeCkb": "12345"
                    }))
                }),
            )
            .route(
                "/api/v1/activities/latest",
                get(|| async {
                    Json(serde_json::json!([
                        {
                            "txHash": format!("0x{}", "44".repeat(32)),
                            "blockNumber": 100,
                            "txIndex": 2,
                            "timestamp": "1700000000000",
                            "isCellbase": false,
                            "protocolActions": [{
                                "protocol": "dao",
                                "action": "deposit",
                                "metadata": {}
                            }],
                            "typeCalls": [],
                            "lockCalls": [],
                            "participants": [{
                                "address": "ckt1dao",
                                "ckbDelta": "-10000000000",
                                "usedDelta": "102",
                                "itemDeltas": [],
                                "tags": 1
                            }]
                        },
                        {
                            "txHash": format!("0x{}", "55".repeat(32)),
                            "blockNumber": 99,
                            "txIndex": 1,
                            "timestamp": "1699999999000",
                            "isCellbase": false,
                            "protocolActions": [],
                            "typeCalls": [],
                            "lockCalls": [],
                            "participants": [{
                                "address": "ckt1token",
                                "ckbDelta": "0",
                                "usedDelta": "0",
                                "itemDeltas": [{
                                    "kind": "token",
                                    "typeScriptHash": ASSET_TYPE_HASH,
                                    "delta": "42"
                                }],
                                "tags": 2
                            }]
                        },
                        {
                            "txHash": format!("0x{}", "66".repeat(32)),
                            "blockNumber": 98,
                            "txIndex": 1,
                            "timestamp": "1699999998000",
                            "isCellbase": false,
                            "protocolActions": [],
                            "typeCalls": [{
                                "typeCodeHash": format!("0x{}", "77".repeat(32)),
                                "typeHashType": "type",
                                "typeArgs": "0x",
                                "scriptHash": format!("0x{}", "88".repeat(32)),
                                "scriptName": ".bit Time Info"
                            }],
                            "lockCalls": [],
                            "participants": []
                        }
                    ]))
                }),
            )
            .route(
                "/api/v1/cells/:tx_hash/:output_index",
                get(|axum::extract::Path((tx_hash, output_index)): axum::extract::Path<(String, i32)>| async move {
                    if tx_hash == ASSET_TX_HASH {
                        return Json(serde_json::json!({
                            "txHash": ASSET_TX_HASH,
                            "outputIndex": output_index,
                            "lockScriptHash": "0xlockscript",
                            "typeScriptHash": ASSET_TYPE_HASH,
                            "address": "ckt1qyqasset",
                            "createdAtBlock": 93,
                            "lock": {
                                "codeHash": "0xlockcode",
                                "hashType": "type",
                                "args": "0x01"
                            },
                            "type": {
                                "codeHash": "0x4444444444444444444444444444444444444444444444444444444444444444",
                                "hashType": "type",
                                "args": "0x02"
                            },
                            "commonKnowledgeSizeBreakdown": {
                                "capacityFieldBytes": 8,
                                "lockScriptBytes": 54,
                                "typeScriptBytes": 34,
                                "dataBytes": 16,
                                "totalBytes": 112
                            },
                            "dataAnalysis": {
                                "deterministic": {
                                    "kind": "udt_amount",
                                    "summary": "xUDT amount",
                                    "segments": [{
                                        "label": "amount",
                                        "humanValue": "12345000000"
                                    }]
                                },
                                "heuristicGuesses": []
                            },
                            "isDepGroup": false
                        }));
                    }
                    Json(serde_json::json!({
                        "txHash": TX_HASH,
                        "outputIndex": output_index,
                        "lockScriptHash": "0xlockscript",
                        "typeScriptHash": "0xtypescript",
                        "address": "ckt1qyqexample",
                        "cellType": "dao",
                        "createdAtBlock": 92,
                        "lock": {
                            "codeHash": "0xlockcode",
                            "hashType": "type",
                            "args": "0x01"
                        },
                        "type": {
                            "codeHash": "0xdaocode",
                            "hashType": "type",
                            "args": "0x"
                        },
                        "commonKnowledgeSizeBreakdown": {
                            "capacityFieldBytes": 8,
                            "lockScriptBytes": 54,
                            "typeScriptBytes": 33,
                            "dataBytes": 7,
                            "totalBytes": 102
                        },
                        "dataAnalysis": {
                            "deterministic": {
                                "kind": "dao_cell",
                                "summary": "DAO deposit",
                                "segments": [{
                                    "label": "deposit_block",
                                    "humanValue": "92"
                                }]
                            },
                            "heuristicGuesses": []
                        },
                        "isDepGroup": false,
                        "daoInfo": {
                            "daoStatus": "deposit",
                            "depositBlockNumber": 92
                        }
                    }))
                }),
            )
            .route(
                "/api/v1/tokens/:type_hash",
                get(|axum::extract::Path(type_hash): axum::extract::Path<String>| async move {
                    Json(serde_json::json!({
                        "typeScriptHash": type_hash,
                        "standard": "xUDT",
                        "name": "Nervos Test Token",
                        "symbol": "NTT",
                        "decimals": 8
                    }))
                }),
            )
            .route(
                "/api/v1/scripts/lookup",
                post(|| async {
                    Json(serde_json::json!({
                        "0xlockcode": {
                            "name": "Default Lock",
                            "deprecated": false,
                            "scriptKind": "lock",
                            "decoderType": null,
                            "resolutionState": "resolved"
                        },
                        "0xdaocode": {
                            "name": "Nervos DAO",
                            "deprecated": false,
                            "scriptKind": "type",
                            "decoderType": "dao",
                            "resolutionState": "resolved"
                        }
                    }))
                }),
            )
            .route(
                "/api/v1/transactions/:tx_hash/detail",
                get(|| async {
                    Json(serde_json::json!({
                        "hash": TX_HASH,
                        "status": "committed",
                        "blockNumber": 92,
                        "blockHash": TX_BLOCK_HASH,
                        "inputsCount": 2,
                        "outputsCount": 2,
                        "fee": "1000",
                        "feeRate": "5000",
                        "txSize": 200,
                        "cycles": 12345,
                        "confirmations": 9,
                        "isCellbase": false,
                        "inputsCapacity": "30000000000",
                        "outputsCapacity": "29999999000",
                        "inputsCommonKnowledgeSize": "122",
                        "outputsCommonKnowledgeSize": "150",
                        "inputs": [
                            { "capacity": "10000000000", "address": "ckt1alice" },
                            { "capacity": "20000000000", "address": "ckt1bob" }
                        ],
                        "outputs": [
                            {
                                "capacity": "14999999000",
                                "commonKnowledgeSize": 70,
                                "address": "ckt1alice"
                            },
                            {
                                "capacity": "15000000000",
                                "commonKnowledgeSize": 80,
                                "address": "ckt1carol"
                            }
                        ]
                    }))
                }),
            )
            .route(
                "/api/v1/transactions/:tx_hash/lifecycle",
                get(|| async {
                    Json(serde_json::json!({
                        "hash": TX_HASH,
                        "phase": "committed",
                        "proposalId": "0x11111111111111111111",
                        "proposedIn": {
                            "blockNumber": 90,
                            "blockHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
                        },
                        "proposedInUncle": null,
                        "committedIn": {
                            "blockNumber": 92,
                            "blockHash": TX_BLOCK_HASH
                        },
                        "commitmentDistance": 2,
                        "commitmentWindow": { "close": 2, "far": 10 },
                        "isCellbase": false,
                        "confirmations": 9
                    }))
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (
            Url::parse(&format!("http://{address}/api/v1")).unwrap(),
            handle,
        )
    }

    fn context() -> CanonicalContext {
        CanonicalContext {
            tip: 101,
            chain_name: "ckb".to_string(),
            recent_blocks: vec![RecentBlock {
                number: 100,
                hash: "0xblock100".to_string(),
            }],
            recent_transactions: Vec::new(),
            replay_active: false,
        }
    }

    #[test]
    fn api_base_is_normalized_before_relative_joins() {
        let source =
            CkbadgerEnrichmentSource::new(Url::parse("http://127.0.0.1:8101/api/v1").unwrap())
                .unwrap();

        assert_eq!(
            source.endpoint("statistics/network").unwrap().as_str(),
            "http://127.0.0.1:8101/api/v1/statistics/network"
        );
    }

    #[test]
    fn unresolved_script_state_remains_visible_as_family() {
        let lookup = ScriptLookupInfo {
            name: "Unknown".to_string(),
            deprecated: false,
            script_kind: None,
            decoder_type: None,
            resolution_state: "ambiguous".to_string(),
        };

        assert_eq!(script_family(&lookup).as_deref(), Some("ambiguous"));
    }

    #[tokio::test]
    async fn probe_validates_hash_before_serving_rich_cell_context() {
        let (api_base, server) = spawn_mock_api("0xblock100").await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();

        let status = source.probe(&context()).await;
        assert_eq!(status.status, EnrichmentSourceState::Ready);
        assert_eq!(status.lag_blocks, Some(1));
        assert_eq!(status.validated_anchor.as_ref().unwrap().block, 100);
        assert!(status
            .capabilities
            .contains(&"transaction_detail".to_string()));
        assert!(status.capabilities.contains(&"asset_identity".to_string()));
        assert!(status.capabilities.contains(&"asset_ecosystem".to_string()));
        assert!(status.capabilities.contains(&"activity_feed".to_string()));

        let ecosystem = source
            .enrich_asset_ecosystem(&context())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(ecosystem.as_of.block, 100);
        assert_eq!(ecosystem.total_live_capacity_shannons, "100000000000000");
        assert_eq!(ecosystem.total_knowledge_bytes, 12_345);
        assert_eq!(ecosystem.capacity_breakdown[0].share_bps, 2_500);
        assert_eq!(ecosystem.top_assets[0].holders_count, 42);
        assert_eq!(
            ecosystem.top_assets[0].total_capacity_shannons,
            "123450000000"
        );

        let activity_feed = source
            .enrich_activity_feed(&context())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(activity_feed.as_of.block, 100);
        assert_eq!(activity_feed.activities.len(), 3);
        assert_eq!(activity_feed.activities[0].category, "dao");
        assert_eq!(
            activity_feed.activities[0].label.as_deref(),
            Some("dao · deposit")
        );
        assert_eq!(activity_feed.activities[1].category, "token");
        assert_eq!(activity_feed.activities[2].category, "script");
        assert_eq!(
            activity_feed.activities[2].label.as_deref(),
            Some(".bit Time Info")
        );

        let record = source
            .enrich_cell(
                &OutPoint {
                    tx_hash: TX_HASH.to_string(),
                    index: 1,
                },
                &context(),
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            record.lock_script.as_ref().unwrap().name.as_deref(),
            Some("Default Lock")
        );
        assert_eq!(
            record.type_script.as_ref().unwrap().family.as_deref(),
            Some("dao")
        );
        assert_eq!(record.common_knowledge.as_ref().unwrap().total_bytes, 102);
        assert!(record.asset.is_none());
        assert!(record.facets.iter().any(|facet| facet.kind == "dao"));
        assert!(record.facets.iter().any(|facet| facet.kind == "dao_cell"));

        let asset_record = source
            .enrich_cell(
                &OutPoint {
                    tx_hash: ASSET_TX_HASH.to_string(),
                    index: 0,
                },
                &context(),
            )
            .await
            .unwrap()
            .unwrap();
        let asset = asset_record.asset.as_ref().unwrap();
        assert_eq!(asset.type_script_hash, ASSET_TYPE_HASH);
        assert_eq!(asset.standard.as_deref(), Some("xUDT"));
        assert_eq!(asset.name.as_deref(), Some("Nervos Test Token"));
        assert_eq!(asset.symbol.as_deref(), Some("NTT"));
        assert_eq!(asset.amount.as_deref(), Some("12345000000"));
        assert_eq!(asset.decimals, Some(8));

        let transaction = source
            .enrich_transaction(TX_HASH, &context())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(transaction.block, 92);
        assert_eq!(transaction.fee.as_deref(), Some("1000"));
        assert_eq!(transaction.cycles, Some(12345));
        assert!(transaction
            .actions
            .iter()
            .any(|facet| facet.kind == "transaction_lifecycle"));
        assert_eq!(
            transaction
                .participants
                .iter()
                .find(|participant| participant.address == "ckt1alice")
                .and_then(|participant| participant.capacity_delta.as_deref()),
            Some("4999999000")
        );
        assert_eq!(
            transaction
                .participants
                .iter()
                .find(|participant| participant.address == "ckt1bob")
                .and_then(|participant| participant.capacity_delta.as_deref()),
            Some("-20000000000")
        );

        server.abort();
    }

    #[tokio::test]
    async fn mismatched_block_hash_marks_source_incompatible() {
        let (api_base, server) = spawn_mock_api("0xother-chain").await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();

        let status = source.probe(&context()).await;
        assert_eq!(status.status, EnrichmentSourceState::Incompatible);
        assert!(status.validated_anchor.is_none());

        server.abort();
    }

    #[test]
    fn inconsistent_common_knowledge_breakdown_is_rejected() {
        let error = map_common_knowledge(CommonKnowledgeSizeBreakdown {
            capacity_field_bytes: 8,
            lock_script_bytes: 54,
            type_script_bytes: 33,
            data_bytes: 7,
            total_bytes: 101,
        })
        .unwrap_err();

        assert!(error.to_string().contains("totals 102 bytes, expected 101"));
    }

    #[test]
    fn fixed_ckb_decimals_convert_without_floating_point() {
        assert_eq!(
            ckb_decimal_to_shannons("57763209638.48791674", "capacity").unwrap(),
            5_776_320_963_848_791_674
        );
        assert_eq!(percentage_to_bps("14.50", "share").unwrap(), 1_450);
        assert!(ckb_decimal_to_shannons("1.000000001", "capacity").is_err());
        assert!(percentage_to_bps("100.01", "share").is_err());
    }

    #[test]
    fn activity_feed_filters_only_the_unanchored_leading_prefix() {
        fn transfer(block: i64, byte: &str) -> LatestActivityResponse {
            LatestActivityResponse {
                tx_hash: format!("0x{}", byte.repeat(32)),
                block_number: block,
                timestamp: "1700000000000".to_string(),
                is_cellbase: false,
                protocol_actions: Vec::new(),
                type_calls: Vec::new(),
                lock_calls: Vec::new(),
                participants: Vec::new(),
            }
        }

        let feed = map_activity_feed(
            vec![transfer(101, "11"), transfer(100, "22")],
            ChainAnchor {
                block: 100,
                hash: "0xblock100".to_string(),
            },
        )
        .unwrap();

        assert_eq!(feed.activities.len(), 1);
        assert_eq!(feed.activities[0].block, 100);
        assert_eq!(feed.activities[0].tx_hash, format!("0x{}", "22".repeat(32)));
    }
}
