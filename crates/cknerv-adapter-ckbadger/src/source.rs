use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context};
use async_trait::async_trait;
use reqwest::StatusCode;
use url::Url;

use cknerv_core::{
    CellSemanticRecord, ChainAnchor, CommonKnowledgeBreakdown, EnrichmentSourceState,
    EnrichmentSourceStatus, OutPoint, SemanticAttribute, SemanticFacet, SemanticScript,
};
use cknerv_server::{CanonicalContext, EnrichmentSource};

use crate::dto::{
    BlockResponse, CellDataAnalysis, CellDetailResponse, DaoInfo, LookupScriptsRequest,
    NetworkStats, ScriptLookupInfo, ScriptLookupResponse, ScriptResponse,
};

const CAPABILITIES: &[&str] = &["cell_detail", "script_identity", "data_analysis"];
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

    fn to_record(
        &self,
        cell: CellDetailResponse,
        anchor: ChainAnchor,
        lookups: &ScriptLookupResponse,
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
        let common_knowledge = Some(CommonKnowledgeBreakdown {
            total_bytes: nonnegative(
                cell.common_knowledge_size_breakdown.total_bytes,
                "totalBytes",
            )?,
            capacity_field_bytes: nonnegative(
                cell.common_knowledge_size_breakdown.capacity_field_bytes,
                "capacityFieldBytes",
            )?,
            lock_script_bytes: nonnegative(
                cell.common_knowledge_size_breakdown.lock_script_bytes,
                "lockScriptBytes",
            )?,
            type_script_bytes: nonnegative(
                cell.common_knowledge_size_breakdown.type_script_bytes,
                "typeScriptBytes",
            )?,
            data_bytes: nonnegative(cell.common_knowledge_size_breakdown.data_bytes, "dataBytes")?,
        });
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
            asset: None,
            common_knowledge,
            facets,
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
        let lookups = self.script_lookups(&cell).await;
        self.to_record(cell, anchor, &lookups).map(Some)
    }
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
                get(|| async {
                    Json(serde_json::json!({
                        "txHash": "0x1111111111111111111111111111111111111111111111111111111111111111",
                        "outputIndex": 1,
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

        let record = source
            .enrich_cell(
                &OutPoint {
                    tx_hash: "0x1111111111111111111111111111111111111111111111111111111111111111"
                        .to_string(),
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
        assert!(record.facets.iter().any(|facet| facet.kind == "dao"));
        assert!(record.facets.iter().any(|facet| facet.kind == "dao_cell"));

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
}
