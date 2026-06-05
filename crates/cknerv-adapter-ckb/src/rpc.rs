//! Lightweight JSON-RPC client over reqwest.
//!
//! Returns raw `serde_json::Value` rather than `ckb_jsonrpc_types`'s
//! strict structs so the adapter is forgiving of new fields the CKB
//! node may add in future versions (and so the test mock doesn't have
//! to populate every field of every nested type just to satisfy serde).
//! Parsing happens in `block_fetch` and `poll`, where we extract only
//! the slice of fields cknerv consumes.

use anyhow::{anyhow, Result};
use serde::Serialize;
use serde_json::Value;
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
            return Err(anyhow!(
                "RPC error {code}: {message} (method={method})"
            ));
        }
        let result = resp
            .get_mut("result")
            .map(std::mem::take)
            .ok_or_else(|| anyhow!("malformed RPC response for {method}: missing result"))?;
        Ok(result)
    }

    pub async fn get_tip_block_number(&self) -> Result<u64> {
        let v = self.call("get_tip_block_number", Value::Array(vec![])).await?;
        let s = v.as_str().ok_or_else(|| {
            anyhow!("get_tip_block_number: expected hex string, got {v}")
        })?;
        u64::from_str_radix(s.trim_start_matches("0x"), 16)
            .map_err(|e| anyhow!("get_tip_block_number: bad hex {s:?}: {e}"))
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
}
