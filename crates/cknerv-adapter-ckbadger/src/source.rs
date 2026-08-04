use std::collections::{BTreeMap, HashMap};
use std::sync::RwLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context};
use async_trait::async_trait;
use reqwest::StatusCode;
use url::Url;

use cknerv_core::{
    CellSemanticRecord, ChainAnchor, CommonKnowledgeBreakdown, EnrichmentSourceState,
    EnrichmentSourceStatus, OutPoint, SemanticAsset, SemanticAttribute, SemanticFacet,
    SemanticScript, TransactionParticipantSemantic, TransactionSemanticRecord,
};
use cknerv_server::{CanonicalContext, EnrichmentSource};

use crate::dto::{
    BlockResponse, CellDataAnalysis, CellDetailResponse, CommonKnowledgeSizeBreakdown, DaoInfo,
    LookupScriptsRequest, NetworkStats, ScriptLookupInfo, ScriptLookupResponse, ScriptResponse,
    TokenResponse, TransactionDetailResponse, TransactionLifecycleResponse,
};

const CAPABILITIES: &[&str] = &[
    "cell_detail",
    "script_identity",
    "data_analysis",
    "asset_identity",
    "transaction_detail",
    "transaction_lifecycle",
];
const DEFAULT_MAX_LAG_BLOCKS: u64 = 12;

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
}
