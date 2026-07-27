//! Minimal axum JSON-RPC mock server for cknerv-adapter-ckb tests.
//!
//! Returns canned responses for the five RPC methods cknerv-adapter-ckb
//! actually calls. The shapes here have to satisfy our own parsers (raw
//! JSON `Value` access) and — for outputs — `ckb_jsonrpc_types::Script`
//! deserialization, which is what `block_fetch` uses to compute content
//! hashes.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use axum::{extract::State, routing::post, Json, Router};
use serde_json::{json, Value};
use url::Url;

pub struct CannedResponses {
    pub tip: u64,
    pub blocks: HashMap<u64, Value>,
    /// Heights whose hash is canonical but whose full block is temporarily
    /// unavailable, modelling the node RPC visibility race seen by the poller.
    pub unavailable_blocks: HashSet<u64>,
    /// Packed `EpochNumberWithFraction` u64 (see
    /// `cknerv_adapter_ckb::poll::parse_epoch_packed`).
    pub epoch_packed: u64,
    pub mempool_pending: u64,
    /// Raw `get_peers` result (array of RemoteNode). Defaults to empty so
    /// existing tests still get a valid (empty) peer snapshot.
    pub peers: Value,
    /// Raw `sync_state` result.
    pub sync_state: Value,
    /// `local_node_info.version` reported to the network poll.
    pub node_version: String,
    /// `local_node_info.connections` (decimal; serialized as hex).
    pub node_connections: u64,
}

impl Default for CannedResponses {
    fn default() -> Self {
        Self {
            tip: 0,
            blocks: HashMap::new(),
            unavailable_blocks: HashSet::new(),
            // length=1800, index=0, number=1
            epoch_packed: (1800u64 << 40) | 1u64,
            mempool_pending: 0,
            peers: json!([]),
            sync_state: json!({ "ibd": false, "best_known_block_number": "0x0" }),
            node_version: "0.117.0".to_string(),
            node_connections: 0,
        }
    }
}

/// Construct a minimal valid block JSON for the given (number, hash).
/// Has one cellbase tx with one output. Field set is the slice
/// `block_fetch::translate_block` reads — everything outside that slice
/// is dropped from the canned response.
pub fn simple_block(number: u64, hash: &str) -> Value {
    let parent_hash = if number == 0 {
        "0x0000000000000000000000000000000000000000000000000000000000000000".to_string()
    } else {
        format!("0xblock{}", number - 1)
    };
    simple_block_with_parent(number, hash, &parent_hash)
}

pub fn simple_block_with_parent(number: u64, hash: &str, parent_hash: &str) -> Value {
    json!({
        "header": {
            "hash": hash,
            "parent_hash": parent_hash,
            "number": format!("0x{:x}", number),
            "timestamp": format!("0x{:x}", 1_700_000_000_000u64 + number * 8_000)
        },
        "transactions": [
            {
                "hash": format!("0x{:064x}", number),
                "inputs": [{
                    "previous_output": {
                        "tx_hash": "0x0000000000000000000000000000000000000000000000000000000000000000",
                        "index": "0xffffffff"
                    },
                    "since": "0x0"
                }],
                "outputs": [{
                    "capacity": "0xae0bc7e000",
                    "lock": {
                        "code_hash": "0x0000000000000000000000000000000000000000000000000000000000000000",
                        "hash_type": "data",
                        "args": "0x"
                    },
                    "type": null
                }],
                "outputs_data": ["0x"]
            }
        ]
    })
}

pub async fn start(canned: CannedResponses) -> (Url, tokio::task::JoinHandle<()>) {
    let (url, handle, _state) = start_mutable(canned).await;
    (url, handle)
}

pub async fn start_mutable(
    mut canned: CannedResponses,
) -> (
    Url,
    tokio::task::JoinHandle<()>,
    Arc<Mutex<CannedResponses>>,
) {
    canned
        .blocks
        .entry(0)
        .or_insert_with(|| simple_block(0, "0xblock0"));
    let state = Arc::new(Mutex::new(canned));
    let app = Router::new()
        .route("/", post(handle))
        .with_state(state.clone());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("local_addr");
    let url = Url::parse(&format!("http://{}", addr)).expect("URL");

    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    (url, handle, state)
}

async fn handle(
    State(canned): State<Arc<Mutex<CannedResponses>>>,
    Json(req): Json<Value>,
) -> Json<Value> {
    let method = req
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let id = req.get("id").cloned().unwrap_or(json!(0));

    let canned = canned.lock().unwrap();
    let result = match method.as_str() {
        "get_tip_block_number" => json!(format!("0x{:x}", canned.tip)),
        "get_block_hash" => {
            let params = req
                .get("params")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let num_str = params.first().and_then(|v| v.as_str()).unwrap_or("0x0");
            let num = u64::from_str_radix(num_str.trim_start_matches("0x"), 16).unwrap_or(0);
            canned
                .blocks
                .get(&num)
                .map_or(Value::Null, |block| block["header"]["hash"].clone())
        }
        "get_block_by_number" => {
            let params = req
                .get("params")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let num_str = params.first().and_then(|v| v.as_str()).unwrap_or("0x0");
            let num = u64::from_str_radix(num_str.trim_start_matches("0x"), 16).unwrap_or(0);
            if canned.unavailable_blocks.contains(&num) {
                Value::Null
            } else {
                canned.blocks.get(&num).cloned().unwrap_or(Value::Null)
            }
        }
        "get_blockchain_info" => json!({
            "alerts": [],
            "chain": "ckb_dev",
            "difficulty": "0x100",
            "epoch": format!("0x{:x}", canned.epoch_packed),
            "is_initial_block_download": false,
            "median_time": "0x18d6f1c2c00"
        }),
        "tx_pool_info" => json!({
            "last_txs_updated_at": "0x0",
            "min_fee_rate": "0x3e8",
            "max_tx_verify_cycles": "0x0",
            "orphan": "0x0",
            "pending": format!("0x{:x}", canned.mempool_pending),
            "proposed": "0x0",
            "tip_hash": "0x0000000000000000000000000000000000000000000000000000000000000000",
            "tip_number": format!("0x{:x}", canned.tip),
            "total_tx_cycles": "0x0",
            "total_tx_size": "0x0",
            "tx_size_limit": "0x0",
            "verify_queue_size": "0x0"
        }),
        "local_node_info" => json!({
            "active": true,
            "addresses": [],
            "connections": format!("0x{:x}", canned.node_connections),
            "node_id": "QmTest",
            "protocols": [],
            "version": canned.node_version
        }),
        "get_peers" => canned.peers.clone(),
        "sync_state" => canned.sync_state.clone(),
        _ => {
            return Json(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {"code": -32601, "message": format!("method not found: {method}")}
            }));
        }
    };

    Json(json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    }))
}
