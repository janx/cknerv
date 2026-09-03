//! One Cell output's complete data, read straight from a CKB node.
//!
//! The implementation of [`cknerv_server::CellDataReader`] for the chain
//! itself. Two calls, in a fixed order, because a CKB node answers the
//! question in two halves:
//!
//!   1. `get_live_cell(out_point, true)` — an unspent output hands back its
//!      whole data plus the node's own `data.hash`, so the common case is one
//!      round trip and the hash is the node's rather than ours;
//!   2. `get_transaction(tx_hash)` — a spent output is no longer a cell, but
//!      the transaction that created it is still committed, and its
//!      `outputs_data[index]` is the same payload it always was. The data
//!      hash is then computed the way the chain computes it.
//!
//! This is the only place in the adapter that reads a Cell's data for its own
//! sake rather than to derive something from it, so it is also the only place
//! that returns the payload uncapped: the block follower trims `data_hex` to
//! 1 KiB because ten thousand staged Cells cannot each carry 37 KB, and this
//! is asked about exactly one Cell at a time.
//!
//! Never batched, never retried, never cached. The batch would swallow the
//! per-outpoint error the route needs to tell a dead node from a dead cell; a
//! retry would double the load a semaphore was placed there to bound; and a
//! cache here would be a second copy of what the browser already caches
//! forever, since an outpoint's bytes cannot change.

use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use ckb_types::{packed, prelude::*};
use serde_json::Value;
use url::Url;

use cknerv_core::OutPoint;
use cknerv_server::{CellDataReader, CellOutputData};

use crate::rpc::RpcClient;

pub struct CkbCellDataReader {
    rpc: RpcClient,
}

impl CkbCellDataReader {
    pub fn new(rpc_url: Url) -> Self {
        Self {
            rpc: RpcClient::new(rpc_url),
        }
    }
}

#[async_trait]
impl CellDataReader for CkbCellDataReader {
    async fn read_output_data(&self, out_point: &OutPoint) -> Result<Option<CellOutputData>> {
        let live = self
            .rpc
            .get_live_cell(out_point, true)
            .await
            .with_context(|| format!("read live Cell data for {out_point:?}"))?;
        if let Some(result) = live {
            return parse_live_cell_data(&result, out_point).map(Some);
        }

        // Not live means spent OR never real, and the node says "unknown" to
        // both. Only the creating transaction separates them.
        let transaction = self
            .rpc
            .get_transaction(&out_point.tx_hash)
            .await
            .with_context(|| format!("read spent Cell data for {out_point:?}"))?;
        let Some(transaction) = transaction else {
            return Ok(None);
        };
        parse_spent_cell_data(&transaction, out_point)
    }
}

/// The live half: the node already holds the bytes and has already hashed
/// them, so both are passed through rather than recomputed. A live cell that
/// is missing either is a malformed answer, not an absent Cell — the caller
/// asked for data and the node said it had a live cell, so silence here would
/// be reported to the browser as "no such output", which is untrue.
fn parse_live_cell_data(result: &Value, out_point: &OutPoint) -> Result<CellOutputData> {
    let data = result
        .get("cell")
        .and_then(|cell| cell.get("data"))
        .filter(|data| !data.is_null())
        .with_context(|| format!("live Cell {out_point:?} omitted cell.data"))?;
    let content = data
        .get("content")
        .and_then(Value::as_str)
        .with_context(|| format!("live Cell {out_point:?} omitted cell.data.content"))?;
    let data_hash = data
        .get("hash")
        .and_then(Value::as_str)
        .with_context(|| format!("live Cell {out_point:?} omitted cell.data.hash"))?;
    Ok(CellOutputData {
        bytes: decode_hex_data(content, out_point)?,
        data_hash: data_hash.to_string(),
        live: true,
    })
}

/// The spent half. Three distinct `None`s, all of them "chain truth knows no
/// such output" rather than "we could not ask":
///
///   * a transaction that is `pending` or `proposed` — a mempool answer, and
///     the mempool is not the chain. Its outputs do not exist yet, and if the
///     transaction is later rejected they never will;
///   * a transaction the node holds without a body (`rejected`, `unknown`),
///     which is the same non-existence stated a different way;
///   * an index past the end of `outputs_data`.
///
/// A committed transaction whose body is missing or malformed IS an error:
/// the node contradicted itself, and that is a fact about the node.
fn parse_spent_cell_data(
    transaction: &Value,
    out_point: &OutPoint,
) -> Result<Option<CellOutputData>> {
    let status = transaction
        .get("tx_status")
        .and_then(|status| status.get("status"))
        .and_then(Value::as_str);
    if status != Some("committed") {
        return Ok(None);
    }
    let outputs_data = transaction
        .get("transaction")
        .filter(|body| !body.is_null())
        .and_then(|body| body.get("outputs_data"))
        .and_then(Value::as_array)
        .with_context(|| {
            format!("committed transaction for {out_point:?} omitted transaction.outputs_data")
        })?;
    let Some(content) = outputs_data.get(out_point.index as usize) else {
        return Ok(None);
    };
    let content = content.as_str().ok_or_else(|| {
        anyhow!("committed transaction for {out_point:?}: outputs_data entry is not a string")
    })?;
    let bytes = decode_hex_data(content, out_point)?;
    // The chain's own rule, not ours: empty data hashes to the ZERO hash
    // rather than to the BLAKE2b of an empty slice. `calc_data_hash` is what
    // the node itself calls, so a dead Cell's hash here is byte-identical to
    // the one the live path would have passed through.
    let data_hash = packed::CellOutput::calc_data_hash(&bytes);
    Ok(Some(CellOutputData {
        bytes,
        data_hash: format!("0x{}", hex::encode(data_hash.as_slice())),
        live: false,
    }))
}

fn decode_hex_data(content: &str, out_point: &OutPoint) -> Result<Vec<u8>> {
    let body = content.strip_prefix("0x").unwrap_or(content);
    hex::decode(body).with_context(|| format!("Cell {out_point:?}: output data is not valid hex"))
}
