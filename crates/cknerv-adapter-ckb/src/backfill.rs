//! Boot-time historical backfill.
//!
//! Replays the last `blocks` blocks (`tip-blocks+1 ..= tip`) through the
//! same `translate_block` path the live poll uses, so the cell galaxy
//! opens populated with the recent live-cell set. Blocks are fetched
//! concurrently but applied in strict ascending order (a death must find
//! its in-window birth). Each block's mutations are stamped with the
//! block header's real timestamp (not `now_ms()`), keeping cell ages and
//! the chain interval/TPS rings realistic. Emits `BackfillProgress`
//! envelopes around + during the replay; returns the anchor tip so the
//! caller can seed `PollState.last_tip` and resume forward from there.

use anyhow::Result;
use futures::stream::{self, StreamExt};
use tokio::sync::mpsc;

use cknerv_core::Mutation;

use crate::block_fetch::{header_timestamp_ms, translate_block};
use crate::rpc::RpcClient;

/// How many block fetches are in flight at once. `buffered` preserves
/// input order, so results still apply ascending.
const FETCH_CONCURRENCY: usize = 8;

/// Emit a progress envelope every this many applied blocks (plus a
/// terminal one), to avoid spamming the cells stream.
const PROGRESS_EVERY: u64 = 25;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Replay blocks `lo..=hi` (inclusive) through the same `translate_block`
/// path the live poll uses, wrapped in a `BackfillProgress` envelope so the
/// projection suppresses block pulses and the SPA shows progress. Blocks are
/// fetched concurrently but applied in strict ascending order (a death must
/// find its in-window birth). `lo > hi` is a no-op. Used by both the boot
/// backfill ([`run_backfill`]) and the live poll's catch-up branch.
pub(crate) async fn replay_window(
    rpc: &RpcClient,
    lo: u64,
    hi: u64,
    out: &mpsc::Sender<Mutation>,
) -> Result<()> {
    if lo > hi {
        return Ok(());
    }
    let total = hi - lo + 1;

    let _ = out
        .send(Mutation::BackfillProgress { done: 0, total, active: true })
        .await;

    let mut stream = stream::iter(lo..=hi)
        .map(|n| async move { (n, rpc.get_block_by_number(n).await) })
        .buffered(FETCH_CONCURRENCY);

    let mut done: u64 = 0;
    while let Some((n, fetched)) = stream.next().await {
        match fetched {
            Ok(Some(block)) => {
                let at = header_timestamp_ms(&block).unwrap_or_else(now_ms);
                match translate_block(&block, n, at) {
                    Ok(muts) => {
                        for m in muts {
                            let _ = out.send(m).await;
                        }
                    }
                    Err(e) => tracing::warn!(
                        target: "cknerv-adapter-ckb",
                        "backfill block {n} translate failed: {e}; skipping"
                    ),
                }
            }
            Ok(None) => tracing::warn!(
                target: "cknerv-adapter-ckb",
                "backfill block {n} not found; skipping"
            ),
            Err(e) => tracing::warn!(
                target: "cknerv-adapter-ckb",
                "backfill block {n} fetch failed: {e}; skipping"
            ),
        }
        done += 1;
        if done % PROGRESS_EVERY == 0 && done != total {
            let _ = out
                .send(Mutation::BackfillProgress { done, total, active: true })
                .await;
        }
    }

    let _ = out
        .send(Mutation::BackfillProgress { done: total, total, active: false })
        .await;
    Ok(())
}

/// Run the boot backfill: replay the most recent `blocks` blocks. Returns the
/// anchor tip (`tip0`) observed at the start so the caller seeds
/// `PollState.last_tip` and the forward poll resumes at `tip0 + 1`.
/// `blocks == 0` is a no-op that still returns the current tip.
pub(crate) async fn run_backfill(
    rpc: &RpcClient,
    blocks: u64,
    out: &mpsc::Sender<Mutation>,
) -> Result<u64> {
    let tip0 = rpc.get_tip_block_number().await?;
    if blocks == 0 {
        return Ok(tip0);
    }
    let lo = tip0.saturating_sub(blocks - 1);
    replay_window(rpc, lo, tip0, out).await?;
    Ok(tip0)
}
