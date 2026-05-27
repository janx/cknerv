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

/// Truncation cap that matches simulator's `truncate_hex` so wire bytes
/// agree. Source bytes (= 2× hex chars without the `0x` prefix).
const DATA_HEX_CAP_BYTES: usize = 1024;

/// Fetch + translate block `number`. Returns mutations in emit order:
/// 1. `BlockMined { number, hash, tx_count, at }`
/// 2. for each tx (including cellbase): `TxLanded { tx_hash, block, inputs, outputs, at }`
///
/// Returns `Ok(vec![])` if the block isn't visible yet (RPC race),
/// letting the poll loop retry on the next tick.
pub async fn fetch_and_translate(rpc: &RpcClient, number: u64) -> Result<Vec<Mutation>> {
    let Some(block) = rpc.get_block_by_number(number).await? else {
        return Ok(vec![]);
    };
    let at = now_ms();
    translate_block(&block, number, at)
}

/// Pure translation helper — split out so tests can exercise it without
/// a live RPC. The `at` timestamp is injected so deterministic fixtures
/// produce deterministic output.
pub fn translate_block(block: &Value, number: u64, at: u64) -> Result<Vec<Mutation>> {
    let header_hash = block["header"]["hash"]
        .as_str()
        .ok_or_else(|| anyhow!("block {number}: missing header.hash"))?
        .to_string();

    let txs = block["transactions"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let tx_count = u32::try_from(txs.len())
        .map_err(|_| anyhow!("block {number}: tx_count exceeds u32"))?;

    let mut out = Vec::with_capacity(1 + txs.len());
    out.push(Mutation::BlockMined {
        number,
        hash: header_hash,
        tx_count,
        at,
    });

    for t in txs {
        let tx_hash = t["hash"]
            .as_str()
            .ok_or_else(|| anyhow!("block {number}: tx missing hash"))?
            .to_string();

        let inputs = parse_inputs(&t, &tx_hash)?;
        let outputs = parse_outputs(&t, &tx_hash)?;

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
    let inputs_json = tx["inputs"].as_array().cloned().unwrap_or_default();
    let mut inputs = Vec::with_capacity(inputs_json.len());
    for (j, inp) in inputs_json.iter().enumerate() {
        let prev = &inp["previous_output"];
        let prev_tx_hash = prev["tx_hash"]
            .as_str()
            .ok_or_else(|| {
                anyhow!("tx {tx_hash} input[{j}]: missing previous_output.tx_hash")
            })?
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
    let outputs_json = tx["outputs"].as_array().cloned().unwrap_or_default();
    let outputs_data = tx["outputs_data"].as_array().cloned().unwrap_or_default();
    let mut outputs = Vec::with_capacity(outputs_json.len());
    for (i, o) in outputs_json.iter().enumerate() {
        let capacity = parse_hex_u64(
            &o["capacity"],
            &format!("tx {tx_hash} output[{i}].capacity"),
        )?;
        let raw_data_str = outputs_data
            .get(i)
            .and_then(|d| d.as_str())
            .ok_or_else(|| anyhow!("tx {tx_hash} output[{i}]: missing outputs_data entry"))?;
        let raw_data_body = raw_data_str.strip_prefix("0x").unwrap_or(raw_data_str);
        let raw_data_bytes = hex::decode(raw_data_body)
            .map_err(|e| anyhow!("tx {tx_hash} output[{i}]: outputs_data not valid hex: {e}"))?;

        // Lock + (optional) type → ckb_jsonrpc_types::Script → packed::Script
        let lock_json: ckb_jsonrpc_types::Script = serde_json::from_value(o["lock"].clone())
            .map_err(|e| anyhow!("tx {tx_hash} output[{i}].lock: {e}"))?;
        let type_json: Option<ckb_jsonrpc_types::Script> = match o.get("type") {
            Some(serde_json::Value::Null) | None => None,
            Some(v) => Some(
                serde_json::from_value(v.clone())
                    .map_err(|e| anyhow!("tx {tx_hash} output[{i}].type: {e}"))?,
            ),
        };
        let lock: packed::Script = lock_json.into();
        let type_: Option<packed::Script> = type_json.map(|t| t.into());
        let capacity_packed: packed::Uint64 = capacity.pack();
        let cell_output = packed::CellOutput::new_builder()
            .capacity(capacity_packed)
            .lock(lock)
            .type_(type_.pack())
            .build();
        let content_hash = compute_content_hash(&cell_output, &raw_data_bytes);

        let data_hex = truncate_hex(raw_data_str, DATA_HEX_CAP_BYTES);
        outputs.push(TxOutputInfo {
            capacity,
            data_hex,
            content_hash,
        });
    }
    Ok(outputs)
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
        let muts = translate_block(&block, 7, 42).expect("translate ok");
        assert!(muts.len() >= 2, "expected BlockMined + at least one TxLanded");
        match &muts[0] {
            Mutation::BlockMined {
                number,
                hash,
                tx_count,
                at,
            } => {
                assert_eq!(*number, 7);
                assert_eq!(hash, "0xblock7");
                assert_eq!(*tx_count, 1);
                assert_eq!(*at, 42);
            }
            other => panic!("expected BlockMined first, got {other:?}"),
        }
    }

    #[test]
    fn translate_block_emits_tx_landed_with_cellbase_input() {
        let block = cellbase_block_json(7, "0xblock7");
        let muts = translate_block(&block, 7, 42).expect("translate ok");
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
    fn truncate_hex_short_passthrough() {
        assert_eq!(truncate_hex("0xdeadbeef", 1024), "0xdeadbeef");
    }

    #[test]
    fn truncate_hex_caps_long_input() {
        assert_eq!(truncate_hex("0xaabbccddeeff0011", 4), "0xaabbccdd…");
    }

    #[test]
    fn translate_block_bails_on_missing_capacity() {
        let mut block = cellbase_block_json(1, "0xb");
        block["transactions"][0]["outputs"][0]
            .as_object_mut()
            .unwrap()
            .remove("capacity");
        let err = translate_block(&block, 1, 0).unwrap_err();
        let msg = format!("{err}");
        assert!(
            msg.contains("capacity"),
            "expected error mentioning capacity, got: {msg}"
        );
    }
}
