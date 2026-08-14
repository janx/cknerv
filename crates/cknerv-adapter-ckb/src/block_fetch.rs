//! Fetch a block by number, translate its transactions into
//! cknerv_core::Mutation::BlockMined + TxLanded events.
//!
//! Algorithm mirrors `simulator/src/telemetry/chain_poll.rs::fetch_block`
//! so cknerv-adapter-ckb and simulator emit byte-identical Mutations for
//! the same on-chain block (cells, hashes, capacities, content hashes).

use anyhow::{anyhow, Result};
use ckb_types::{packed, prelude::*};
use serde_json::Value;

use cknerv_core::{Mutation, OutPoint, TxOutputInfo};

use crate::content_hash::compute_content_hash;
use crate::rpc::RpcClient;

/// One fully-translated canonical block plus the header linkage needed by
/// the live poller to reject a mixed-fork fetch.
pub struct FetchedBlock {
    pub hash: String,
    pub parent_hash: String,
    pub mutations: Vec<Mutation>,
}

/// Truncation cap that matches simulator's `truncate_hex` so wire bytes
/// agree. Source bytes (= 2× hex chars without the `0x` prefix).
const DATA_HEX_CAP_BYTES: usize = 1024;

/// Fetch + translate block `number`. Returns mutations in emit order:
/// 1. `BlockMined { number, hash, tx_count, size, at }`
/// 2. for each tx (including cellbase): `TxLanded { tx_hash, block, inputs, outputs, at }`
///
/// Returns `Ok(None)` if the block isn't visible yet (RPC race), letting the
/// poll loop retry on the next tick.
pub async fn fetch_and_translate(rpc: &RpcClient, number: u64) -> Result<Option<FetchedBlock>> {
    fetch_and_translate_with_time(rpc, number, BlockTimeSource::Observed, true).await
}

/// Fetch + translate a block that is being replayed rather than observed at
/// the live tip. Historical catch-up/reorg/rebuild blocks must retain their
/// header timestamps; stamping a fast replay with wall-clock receipt times
/// collapses the cadence ring to 0–2ms and makes the HUD report a permanent
/// false stall once replay completes.
pub(crate) async fn fetch_and_translate_replay(
    rpc: &RpcClient,
    number: u64,
) -> Result<Option<FetchedBlock>> {
    fetch_and_translate_replay_with_size(rpc, number, true).await
}

/// Replay fetch with optional canonical serialized-size recovery. Only the
/// latest rolling metrics window needs exact block sizes during a deep boot
/// hydration; skipping the full JSON -> typed BlockView clone for older
/// blocks substantially reduces discovery allocations without changing Cell
/// or transaction mutations.
pub(crate) async fn fetch_and_translate_replay_with_size(
    rpc: &RpcClient,
    number: u64,
    include_size: bool,
) -> Result<Option<FetchedBlock>> {
    fetch_and_translate_with_time(rpc, number, BlockTimeSource::Header, include_size).await
}

#[derive(Clone, Copy)]
enum BlockTimeSource {
    Observed,
    Header,
}

async fn fetch_and_translate_with_time(
    rpc: &RpcClient,
    number: u64,
    time_source: BlockTimeSource,
    include_size: bool,
) -> Result<Option<FetchedBlock>> {
    let Some(block) = rpc.get_block_by_number(number).await? else {
        return Ok(None);
    };
    let observed_at = now_ms();
    let at = block_time_ms(&block, time_source, observed_at);
    let size = if include_size {
        serialized_block_size(&block)
    } else {
        0
    };
    let hash = header_hash(&block, number)?.to_string();
    let parent_hash = header_parent_hash(&block, number)?.to_string();
    let mutations = translate_block(&block, number, at, size)?;
    Ok(Some(FetchedBlock {
        hash,
        parent_hash,
        mutations,
    }))
}

fn block_time_ms(block: &Value, source: BlockTimeSource, observed_at: u64) -> u64 {
    match source {
        BlockTimeSource::Observed => observed_at,
        BlockTimeSource::Header => header_timestamp_ms(block).unwrap_or(observed_at),
    }
}

pub(crate) fn header_hash(block: &Value, number: u64) -> Result<&str> {
    block["header"]["hash"]
        .as_str()
        .ok_or_else(|| anyhow!("block {number}: missing header.hash"))
}

pub(crate) fn header_parent_hash(block: &Value, number: u64) -> Result<&str> {
    block["header"]["parent_hash"]
        .as_str()
        .ok_or_else(|| anyhow!("block {number}: missing header.parent_hash"))
}

/// Canonical serialized block size (bytes), recovered by round-tripping the
/// verbosity-0x2 JSON block back into packed form. Returns 0 if the value
/// isn't a complete BlockView (e.g. partial test fixtures) — callers treat 0
/// as "unknown" (uniform-width beat).
pub fn serialized_block_size(block: &Value) -> u64 {
    serde_json::from_value::<ckb_jsonrpc_types::BlockView>(block.clone())
        .map(|bv| {
            let core: ckb_types::core::BlockView = bv.into();
            core.data().as_slice().len() as u64
        })
        .unwrap_or(0)
}

/// Pure translation helper — split out so tests can exercise it without
/// a live RPC. The `at` timestamp is injected so deterministic fixtures
/// produce deterministic output.
pub fn translate_block(block: &Value, number: u64, at: u64, size: u64) -> Result<Vec<Mutation>> {
    let header_hash = header_hash(block, number)?.to_string();

    let txs = block["transactions"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let tx_count =
        u32::try_from(txs.len()).map_err(|_| anyhow!("block {number}: tx_count exceeds u32"))?;

    let mut out = Vec::with_capacity(1 + txs.len());
    out.push(Mutation::BlockMined {
        number,
        hash: header_hash,
        tx_count,
        size,
        at,
    });

    for t in txs {
        let tx_hash = t["hash"]
            .as_str()
            .ok_or_else(|| anyhow!("block {number}: tx missing hash"))?
            .to_string();

        let inputs = parse_inputs(t, &tx_hash)?;
        let outputs = parse_outputs(t, &tx_hash)?;

        out.push(Mutation::TxLanded {
            tx_hash,
            block: number,
            at,
            inputs,
            outputs,
        });
    }

    Ok(out)
}

fn parse_inputs(tx: &Value, tx_hash: &str) -> Result<Vec<OutPoint>> {
    let inputs_json = tx["inputs"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let mut inputs = Vec::with_capacity(inputs_json.len());
    for (j, inp) in inputs_json.iter().enumerate() {
        let prev = &inp["previous_output"];
        let prev_tx_hash = prev["tx_hash"]
            .as_str()
            .ok_or_else(|| anyhow!("tx {tx_hash} input[{j}]: missing previous_output.tx_hash"))?
            .to_string();
        let index = parse_hex_u32(
            &prev["index"],
            &format!("tx {tx_hash} input[{j}].previous_output.index"),
        )?;
        inputs.push(OutPoint {
            tx_hash: prev_tx_hash,
            index,
        });
    }
    Ok(inputs)
}

fn parse_outputs(tx: &Value, tx_hash: &str) -> Result<Vec<TxOutputInfo>> {
    let outputs_json = tx["outputs"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let outputs_data = tx["outputs_data"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let mut outputs = Vec::with_capacity(outputs_json.len());
    for (i, o) in outputs_json.iter().enumerate() {
        let raw_data_str = outputs_data
            .get(i)
            .and_then(|d| d.as_str())
            .ok_or_else(|| anyhow!("tx {tx_hash} output[{i}]: missing outputs_data entry"))?;
        outputs.push(parse_output_info(
            o,
            raw_data_str,
            &format!("tx {tx_hash} output[{i}]"),
        )?);
    }
    Ok(outputs)
}

pub(crate) fn parse_output_info(
    output: &Value,
    raw_data_str: &str,
    context: &str,
) -> Result<TxOutputInfo> {
    let capacity = parse_hex_u64(&output["capacity"], &format!("{context}.capacity"))?;
    let raw_data_body = raw_data_str.strip_prefix("0x").unwrap_or(raw_data_str);
    let raw_data_bytes = hex::decode(raw_data_body)
        .map_err(|error| anyhow!("{context}: output data is not valid hex: {error}"))?;

    let lock_json: ckb_jsonrpc_types::Script = serde_json::from_value(output["lock"].clone())
        .map_err(|error| anyhow!("{context}.lock: {error}"))?;
    let type_json: Option<ckb_jsonrpc_types::Script> = match output.get("type") {
        Some(Value::Null) | None => None,
        Some(value) => Some(
            serde_json::from_value(value.clone())
                .map_err(|error| anyhow!("{context}.type: {error}"))?,
        ),
    };
    let lock: packed::Script = lock_json.into();
    let type_: Option<packed::Script> = type_json.map(Into::into);
    let lock_kind = crate::script_taxonomy::classify_lock(&lock);
    let asset_kind = crate::script_taxonomy::classify_asset(type_.as_ref());
    let lock_script = crate::script_taxonomy::script_id(&lock);
    let type_script = type_.as_ref().map(crate::script_taxonomy::script_id);
    let cell_output = packed::CellOutput::new_builder()
        .capacity(capacity)
        .lock(lock)
        .type_(type_.pack())
        .build();

    Ok(TxOutputInfo {
        capacity,
        data_hex: truncate_hex(raw_data_str, DATA_HEX_CAP_BYTES),
        content_hash: compute_content_hash(&cell_output, &raw_data_bytes),
        lock_kind,
        asset_kind,
        lock_script,
        type_script,
    })
}

fn parse_hex_u64(v: &Value, field: &str) -> Result<u64> {
    let s = v
        .as_str()
        .ok_or_else(|| anyhow!("{field}: missing or non-string"))?;
    u64::from_str_radix(s.trim_start_matches("0x"), 16)
        .map_err(|e| anyhow!("{field}: bad hex {s:?}: {e}"))
}

fn parse_hex_u32(v: &Value, field: &str) -> Result<u32> {
    let s = v
        .as_str()
        .ok_or_else(|| anyhow!("{field}: missing or non-string"))?;
    u32::from_str_radix(s.trim_start_matches("0x"), 16)
        .map_err(|e| anyhow!("{field}: bad hex {s:?}: {e}"))
}

/// Same `truncate_hex` policy as simulator's chain_poll. Caps the
/// hex-encoded data at `byte_cap` source bytes; appends a `…` (UTF-8
/// ellipsis) when truncation occurs so consumers can detect it.
fn truncate_hex(s: &str, byte_cap: usize) -> String {
    let body = s.strip_prefix("0x").unwrap_or(s);
    let char_cap = byte_cap * 2;
    if body.len() <= char_cap {
        s.to_string()
    } else {
        format!("0x{}…", &body[..char_cap])
    }
}

/// Parse the block header's `timestamp` (CKB ships it as a hex-encoded
/// ms-since-epoch string). Returns `None` when absent or unparseable so
/// callers can fall back to wall-clock time.
pub fn header_timestamp_ms(block: &Value) -> Option<u64> {
    let s = block["header"]["timestamp"].as_str()?;
    u64::from_str_radix(s.trim_start_matches("0x"), 16).ok()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cellbase_block_json(number: u64, hash: &str) -> Value {
        // Minimal block with a single cellbase tx (one phantom input + one output).
        serde_json::json!({
            "header": {
                "hash": hash,
                "number": format!("0x{:x}", number),
            },
            "transactions": [{
                "hash": format!("0x{:064x}", 0xc0ffee_u64 ^ number),
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
            }]
        })
    }

    #[test]
    fn translate_block_emits_block_mined_first() {
        let block = cellbase_block_json(7, "0xblock7");
        let muts = translate_block(&block, 7, 42, 0).expect("translate ok");
        assert!(
            muts.len() >= 2,
            "expected BlockMined + at least one TxLanded"
        );
        match &muts[0] {
            Mutation::BlockMined {
                number,
                hash,
                tx_count,
                size,
                at,
            } => {
                assert_eq!(*number, 7);
                assert_eq!(hash, "0xblock7");
                assert_eq!(*tx_count, 1);
                assert_eq!(*size, 0);
                assert_eq!(*at, 42);
            }
            other => panic!("expected BlockMined first, got {other:?}"),
        }
    }

    #[test]
    fn translate_block_emits_tx_landed_with_cellbase_input() {
        let block = cellbase_block_json(7, "0xblock7");
        let muts = translate_block(&block, 7, 42, 0).expect("translate ok");
        match &muts[1] {
            Mutation::TxLanded {
                block,
                inputs,
                outputs,
                ..
            } => {
                assert_eq!(*block, 7);
                assert_eq!(inputs.len(), 1, "cellbase has its phantom input preserved");
                assert!(
                    cknerv_core::is_cellbase_input(&inputs[0]),
                    "phantom input should be recognized as cellbase"
                );
                assert_eq!(outputs.len(), 1);
                assert_eq!(outputs[0].capacity, 0xae0bc7e000);
                assert!(outputs[0].content_hash.starts_with("0x"));
                assert_eq!(outputs[0].content_hash.len(), 66);
            }
            other => panic!("expected TxLanded second, got {other:?}"),
        }
    }

    #[test]
    fn header_timestamp_ms_parses_hex_and_handles_missing() {
        let block = serde_json::json!({
            "header": { "hash": "0xh", "timestamp": "0x18d6f1c2c00" }
        });
        assert_eq!(header_timestamp_ms(&block), Some(0x18d6f1c2c00));

        let no_ts = serde_json::json!({ "header": { "hash": "0xh" } });
        assert_eq!(header_timestamp_ms(&no_ts), None);
    }

    #[test]
    fn block_time_uses_header_only_for_replay() {
        let block = serde_json::json!({
            "header": { "hash": "0xh", "timestamp": "0x1234" }
        });
        assert_eq!(block_time_ms(&block, BlockTimeSource::Observed, 99), 99);
        assert_eq!(block_time_ms(&block, BlockTimeSource::Header, 99), 0x1234);

        let no_ts = serde_json::json!({ "header": { "hash": "0xh" } });
        assert_eq!(block_time_ms(&no_ts, BlockTimeSource::Header, 99), 99);
    }

    #[test]
    fn truncate_hex_short_passthrough() {
        assert_eq!(truncate_hex("0xdeadbeef", 1024), "0xdeadbeef");
    }

    #[test]
    fn truncate_hex_caps_long_input() {
        assert_eq!(truncate_hex("0xaabbccddeeff0011", 4), "0xaabbccdd…");
    }

    #[test]
    fn serialized_block_size_round_trips_a_real_block() {
        // Build a minimal real block, JSON-encode it the way the node would, and
        // assert the helper recovers the canonical packed size.
        let block = ckb_types::core::BlockBuilder::default().build();
        let expected = block.data().as_slice().len() as u64;
        let json =
            serde_json::to_value(ckb_jsonrpc_types::BlockView::from(block)).expect("to json");
        assert_eq!(serialized_block_size(&json), expected);
    }

    #[test]
    fn serialized_block_size_is_zero_on_garbage() {
        assert_eq!(serialized_block_size(&serde_json::json!({})), 0);
    }

    #[test]
    fn translate_block_bails_on_missing_capacity() {
        let mut block = cellbase_block_json(1, "0xb");
        block["transactions"][0]["outputs"][0]
            .as_object_mut()
            .unwrap()
            .remove("capacity");
        let err = translate_block(&block, 1, 0, 0).unwrap_err();
        let msg = format!("{err}");
        assert!(
            msg.contains("capacity"),
            "expected error mentioning capacity, got: {msg}"
        );
    }
}
