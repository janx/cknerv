//! Periodic tip + chain-info + mempool polling.
//!
//! Emits chain-info / mempool mutations on change; emits BlockMined +
//! TxLanded on tip advance. Mirrors the simulator's chain_poll behavior,
//! adapted to push directly into cknerv-server's `mpsc::Sender<Mutation>`.

use anyhow::{anyhow, Result};
use serde_json::Value;
use tokio::sync::mpsc;

use cknerv_core::{EpochInfo, MempoolStats, Mutation};

use crate::block_fetch::fetch_and_translate;
use crate::rpc::RpcClient;

/// Mutable state threaded across `poll_once` invocations.
#[derive(Default)]
pub struct PollState {
    /// Last tip we've successfully emitted a `BlockMined` for. `None`
    /// until the first poll observes a node tip; on first poll we
    /// anchor to `tip - 1` so we emit one `BlockMined` for the current
    /// tip rather than replaying history from genesis.
    pub last_tip: Option<u64>,
    pub last_chain_info: Option<(EpochInfo, u64, String, String)>,
    pub last_mempool: Option<MempoolStats>,
}

/// Run one poll cycle. Emits mutations into `out` based on changes
/// observed since `state.last_*`. Updates `state` in place. Errors from
/// individual sub-fetches (tip, chain-info, mempool) propagate so the
/// caller can log + retry next interval; transient RPC errors do NOT
/// crash the adapter.
pub async fn poll_once(
    rpc: &RpcClient,
    state: &mut PollState,
    out: &mpsc::Sender<Mutation>,
) -> Result<()> {
    // 1. Tip + block walk
    let tip = rpc.get_tip_block_number().await?;
    let prev = state.last_tip.unwrap_or_else(|| tip.saturating_sub(1));
    if tip > prev {
        for n in (prev + 1)..=tip {
            let muts = fetch_and_translate(rpc, n).await?;
            if muts.is_empty() {
                // Block not yet visible (RPC race); break and retry next interval.
                break;
            }
            for m in muts {
                let _ = out.send(m).await;
            }
            state.last_tip = Some(n);
        }
    } else if state.last_tip.is_none() {
        // First poll, but tip hasn't moved past our anchor — just record
        // the anchor so the next genuine advance triggers a single emit.
        state.last_tip = Some(prev);
    }

    // 2. Chain info
    match rpc.get_blockchain_info().await {
        Ok(info) => {
            if let Some(new_info) = parse_chain_info(&info)? {
                let (epoch, median_time_ms, difficulty, chain_name) = new_info.clone();
                if state.last_chain_info.as_ref() != Some(&new_info) {
                    let _ = out
                        .send(Mutation::ChainInfoUpdated {
                            epoch,
                            median_time_ms,
                            difficulty,
                            chain_name,
                        })
                        .await;
                    state.last_chain_info = Some(new_info);
                }
            }
        }
        Err(e) => return Err(e),
    }

    // 3. Mempool
    match rpc.tx_pool_info().await {
        Ok(pool) => {
            let stats = parse_mempool(&pool)?;
            if state.last_mempool.as_ref() != Some(&stats) {
                let _ = out
                    .send(Mutation::ChainMempoolUpdated {
                        pending: stats.pending,
                        proposed: stats.proposed,
                        orphan: stats.orphan,
                        total_tx_size: stats.total_tx_size,
                        total_tx_cycles: stats.total_tx_cycles,
                        min_fee_rate: stats.min_fee_rate,
                    })
                    .await;
                state.last_mempool = Some(stats);
            }
        }
        Err(e) => return Err(e),
    }

    Ok(())
}

/// Decode the `epoch` packed `EpochNumberWithFraction` u64.
/// Layout (LSB→MSB): number 24b | index 16b | length 16b | reserved 8b.
pub(crate) fn parse_epoch_packed(packed: u64) -> (u64, u64, u64) {
    let number = packed & 0xff_ffff;
    let index = (packed >> 24) & 0xffff;
    let length = (packed >> 40) & 0xffff;
    (number, index, length)
}

fn parse_chain_info(result: &Value) -> Result<Option<(EpochInfo, u64, String, String)>> {
    let packed_str = result["epoch"]
        .as_str()
        .ok_or_else(|| anyhow!("get_blockchain_info.epoch: missing or non-string"))?;
    let packed = u64::from_str_radix(packed_str.trim_start_matches("0x"), 16)
        .map_err(|e| anyhow!("get_blockchain_info.epoch: bad hex {packed_str:?}: {e}"))?;
    let (number, index, length) = parse_epoch_packed(packed);
    let epoch = EpochInfo {
        number,
        index,
        length,
    };

    let median_time_str = result["median_time"]
        .as_str()
        .ok_or_else(|| anyhow!("get_blockchain_info.median_time: missing or non-string"))?;
    let median_time_ms = u64::from_str_radix(median_time_str.trim_start_matches("0x"), 16)
        .map_err(|e| anyhow!("get_blockchain_info.median_time: bad hex {median_time_str:?}: {e}"))?;

    let difficulty = result["difficulty"]
        .as_str()
        .ok_or_else(|| anyhow!("get_blockchain_info.difficulty: missing or non-string"))?
        .to_string();
    let chain_name = result["chain"]
        .as_str()
        .ok_or_else(|| anyhow!("get_blockchain_info.chain: missing or non-string"))?
        .to_string();

    Ok(Some((epoch, median_time_ms, difficulty, chain_name)))
}

fn parse_mempool(result: &Value) -> Result<MempoolStats> {
    Ok(MempoolStats {
        pending: parse_hex_u64(&result["pending"], "tx_pool_info.pending")?,
        proposed: parse_hex_u64(&result["proposed"], "tx_pool_info.proposed")?,
        orphan: parse_hex_u64(&result["orphan"], "tx_pool_info.orphan")?,
        total_tx_size: parse_hex_u64(&result["total_tx_size"], "tx_pool_info.total_tx_size")?,
        total_tx_cycles: parse_hex_u64(&result["total_tx_cycles"], "tx_pool_info.total_tx_cycles")?,
        min_fee_rate: parse_hex_u64(&result["min_fee_rate"], "tx_pool_info.min_fee_rate")?,
    })
}

fn parse_hex_u64(v: &Value, field: &str) -> Result<u64> {
    let s = v
        .as_str()
        .ok_or_else(|| anyhow!("{field}: missing or non-string"))?;
    u64::from_str_radix(s.trim_start_matches("0x"), 16)
        .map_err(|e| anyhow!("{field}: bad hex {s:?}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_epoch_packed_canonical_layout() {
        // length=1800 (0x708), index=300 (0x12c), number=314 (0x13a)
        let packed = (1800u64 << 40) | (300u64 << 24) | 314u64;
        assert_eq!(parse_epoch_packed(packed), (314, 300, 1800));
    }

    #[test]
    fn parse_chain_info_extracts_all_fields() {
        let packed = (1800u64 << 40) | (300u64 << 24) | 314u64;
        let result = serde_json::json!({
            "epoch": format!("0x{packed:x}"),
            "median_time": "0x18d6f1c2c00",
            "difficulty": "0x100",
            "chain": "ckb_dev",
            "alerts": [],
            "is_initial_block_download": false
        });
        let (epoch, median_time_ms, difficulty, chain_name) = parse_chain_info(&result)
            .expect("parse must succeed")
            .expect("Some(...)");
        assert_eq!(epoch.number, 314);
        assert_eq!(epoch.index, 300);
        assert_eq!(epoch.length, 1800);
        assert_eq!(median_time_ms, 0x18d6f1c2c00);
        assert_eq!(difficulty, "0x100");
        assert_eq!(chain_name, "ckb_dev");
    }

    #[test]
    fn parse_mempool_extracts_all_fields() {
        let result = serde_json::json!({
            "pending":         "0x0c",
            "proposed":        "0x03",
            "orphan":          "0x01",
            "total_tx_size":   "0x400",
            "total_tx_cycles": "0x1000",
            "min_fee_rate":    "0x3e8"
        });
        let m = parse_mempool(&result).expect("parse ok");
        assert_eq!(m.pending, 12);
        assert_eq!(m.proposed, 3);
        assert_eq!(m.orphan, 1);
        assert_eq!(m.total_tx_size, 0x400);
        assert_eq!(m.total_tx_cycles, 0x1000);
        assert_eq!(m.min_fee_rate, 1000);
    }

    #[test]
    fn parse_mempool_missing_field_bails() {
        let result = serde_json::json!({ "pending": "0x05" });
        assert!(parse_mempool(&result).is_err());
    }
}
