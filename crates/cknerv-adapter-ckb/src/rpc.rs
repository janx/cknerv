//! Lightweight JSON-RPC client over reqwest.
//!
//! Returns raw `serde_json::Value` rather than `ckb_jsonrpc_types`'s
//! strict structs so the adapter is forgiving of new fields the CKB
//! node may add in future versions (and so the test mock doesn't have
//! to populate every field of every nested type just to satisfy serde).
//! Parsing happens in `block_fetch` and `poll`, where we extract only
//! the slice of fields cknerv consumes.

use anyhow::{anyhow, Result};
use cknerv_core::OutPoint;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use url::Url;

pub struct RpcClient {
    base_url: Url,
    http: reqwest::Client,
    id_counter: AtomicU64,
}

#[derive(Serialize)]
struct Req<'a> {
    jsonrpc: &'static str,
    method: &'a str,
    params: Value,
    id: u64,
}

impl RpcClient {
    pub fn new(base_url: Url) -> Self {
        Self {
            base_url,
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("reqwest client"),
            id_counter: AtomicU64::new(0),
        }
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.id_counter.fetch_add(1, Ordering::SeqCst);
        let req = Req {
            jsonrpc: "2.0",
            method,
            params,
            id,
        };
        let resp_bytes = self
            .http
            .post(self.base_url.clone())
            .json(&req)
            .send()
            .await?
            .bytes()
            .await?;
        let mut resp: Value = serde_json::from_slice(&resp_bytes).map_err(|e| {
            anyhow!(
                "parse RPC response for {method}: {e}; body: {}",
                String::from_utf8_lossy(&resp_bytes)
            )
        })?;
        if let Some(err) = resp.get("error").cloned().filter(|v| !v.is_null()) {
            let code = err.get("code").and_then(|v| v.as_i64()).unwrap_or(0);
            let message = err
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            return Err(anyhow!("RPC error {code}: {message} (method={method})"));
        }
        let result = resp
            .get_mut("result")
            .map(std::mem::take)
            .ok_or_else(|| anyhow!("malformed RPC response for {method}: missing result"))?;
        Ok(result)
    }

    pub async fn get_tip_block_number(&self) -> Result<u64> {
        let v = self
            .call("get_tip_block_number", Value::Array(vec![]))
            .await?;
        let s = v
            .as_str()
            .ok_or_else(|| anyhow!("get_tip_block_number: expected hex string, got {v}"))?;
        u64::from_str_radix(s.trim_start_matches("0x"), 16)
            .map_err(|e| anyhow!("get_tip_block_number: bad hex {s:?}: {e}"))
    }

    /// Return the canonical block hash at `number`, or `None` when the node
    /// has no canonical block at that height (for example above its current
    /// tip). This is substantially cheaper than fetching a full block and is
    /// used by the poller to validate its last emitted canonical anchor.
    pub async fn get_block_hash(&self, number: u64) -> Result<Option<String>> {
        let params = serde_json::json!([format!("0x{:x}", number)]);
        let v = self.call("get_block_hash", params).await?;
        if v.is_null() {
            return Ok(None);
        }
        let hash = v
            .as_str()
            .ok_or_else(|| anyhow!("get_block_hash: expected string or null, got {v}"))?;
        Ok(Some(hash.to_string()))
    }

    /// `get_block_by_number` with verbosity `0x2` so we receive a fully
    /// parsed `BlockView` (`transactions`/`inputs`/`outputs` arrays vs.
    /// raw molecule bytes).
    pub async fn get_block_by_number(&self, number: u64) -> Result<Option<Value>> {
        let params = serde_json::json!([format!("0x{:x}", number), "0x2"]);
        let v = self.call("get_block_by_number", params).await?;
        if v.is_null() {
            Ok(None)
        } else {
            Ok(Some(v))
        }
    }

    pub async fn get_blockchain_info(&self) -> Result<Value> {
        self.call("get_blockchain_info", Value::Array(vec![])).await
    }

    pub async fn tx_pool_info(&self) -> Result<Value> {
        self.call("tx_pool_info", Value::Array(vec![])).await
    }

    pub async fn local_node_info(&self) -> Result<Value> {
        self.call("local_node_info", Value::Array(vec![])).await
    }

    pub async fn get_peers(&self) -> Result<Value> {
        self.call("get_peers", Value::Array(vec![])).await
    }

    pub async fn sync_state(&self) -> Result<Value> {
        self.call("sync_state", Value::Array(vec![])).await
    }

    /// Batch `get_live_cell` while preserving request order. Individual RPC
    /// errors and non-live outpoints become `None`; transport or malformed
    /// batch responses fail the refresh so callers can retain their last good
    /// composition instead of publishing a partial transport accident.
    pub async fn get_live_cells(
        &self,
        out_points: &[OutPoint],
        with_data: bool,
    ) -> Result<Vec<Option<Value>>> {
        if out_points.is_empty() {
            return Ok(Vec::new());
        }

        let first_id = self
            .id_counter
            .fetch_add(out_points.len() as u64, Ordering::SeqCst);
        let requests: Vec<_> = out_points
            .iter()
            .enumerate()
            .map(|(offset, out_point)| Req {
                jsonrpc: "2.0",
                method: "get_live_cell",
                params: serde_json::json!([{
                    "tx_hash": out_point.tx_hash,
                    "index": format!("0x{:x}", out_point.index),
                }, with_data]),
                id: first_id + offset as u64,
            })
            .collect();
        let resp_bytes = self
            .http
            .post(self.base_url.clone())
            .json(&requests)
            .send()
            .await?
            .bytes()
            .await?;
        let responses: Vec<Value> = serde_json::from_slice(&resp_bytes).map_err(|error| {
            anyhow!(
                "parse get_live_cell batch response: {error}; body: {}",
                String::from_utf8_lossy(&resp_bytes)
            )
        })?;
        let mut by_id = HashMap::with_capacity(responses.len());
        for mut response in responses {
            let Some(id) = response.get("id").and_then(Value::as_u64) else {
                return Err(anyhow!(
                    "malformed get_live_cell batch response: missing id"
                ));
            };
            if by_id.insert(id, std::mem::take(&mut response)).is_some() {
                return Err(anyhow!(
                    "malformed get_live_cell batch response: duplicate id {id}"
                ));
            }
        }

        let mut ordered = Vec::with_capacity(out_points.len());
        for offset in 0..out_points.len() {
            let id = first_id + offset as u64;
            let response = by_id
                .remove(&id)
                .ok_or_else(|| anyhow!("get_live_cell batch response omitted id {id}"))?;
            if response.get("error").is_some_and(|value| !value.is_null()) {
                ordered.push(None);
                continue;
            }
            let result = response
                .get("result")
                .cloned()
                .ok_or_else(|| anyhow!("get_live_cell batch id {id}: missing result"))?;
            if result.get("status").and_then(Value::as_str) != Some("live") {
                ordered.push(None);
                continue;
            }
            ordered.push(Some(result));
        }
        Ok(ordered)
    }
}
