//! Boot-time historical backfill.
//!
//! Replays the last `blocks` blocks (`tip-blocks+1 ..= tip`) through the
//! same `translate_block` path the live poll uses, so the cell galaxy
//! opens populated with the recent live-cell set. Blocks are fetched
//! concurrently but applied in strict ascending order (a death must find
//! its in-window birth). Each block's mutations are stamped with the
//! block header's real timestamp (not `now_ms()`), keeping cell ages and
//! the chain interval/TPS rings realistic. Emits `BackfillProgress`
//! envelopes around + during the replay; returns the anchor tip and observed
//! block hashes so the live poll can validate canonical continuity.

use anyhow::Result;
use futures::stream::{self, StreamExt};
use tokio::sync::mpsc;

use cknerv_core::{Mutation, ReplayPhase};

use crate::block_fetch::{
    header_hash, header_parent_hash, header_timestamp_ms, serialized_block_size, translate_block,
};
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
/// find its in-window birth). `lo > hi` is a no-op. Used by boot backfill
/// ([`run_backfill`]); live replay uses the poller's phase-aware path.
pub(crate) async fn replay_window(
    rpc: &RpcClient,
    lo: u64,
    hi: u64,
    expected_parent: Option<&str>,
    out: &mpsc::Sender<Mutation>,
) -> Result<Vec<(u64, String)>> {
    if lo > hi {
        return Ok(Vec::new());
    }
    let total = hi - lo + 1;
    let mut anchors = Vec::with_capacity(total as usize);

    let _ = out
        .send(Mutation::BackfillProgress {
            done: 0,
            total,
            active: true,
            phase: ReplayPhase::Boot,
        })
        .await;

    let mut stream = stream::iter(lo..=hi)
        .map(|n| async move { (n, rpc.get_block_by_number(n).await) })
        .buffered(FETCH_CONCURRENCY);

    let mut done: u64 = 0;
    let mut previous_hash = expected_parent.map(str::to_owned);
    while let Some((n, fetched)) = stream.next().await {
        match fetched {
            Ok(Some(block)) => {
                let hash = match header_hash(&block, n) {
                    Ok(hash) => hash.to_string(),
                    Err(e) => {
                        tracing::warn!(
                            target: "cknerv-adapter-ckb",
                            "backfill block {n} anchor failed: {e}; stopping at canonical boundary"
                        );
                        break;
                    }
                };
                if let Some(expected_parent) = previous_hash.as_deref() {
                    match header_parent_hash(&block, n) {
                        Ok(parent_hash) if parent_hash == expected_parent => {}
                        Ok(parent_hash) => {
                            tracing::warn!(
                                target: "cknerv-adapter-ckb",
                                "backfill block {n} parent mismatch: expected {expected_parent}, \
                                 fetched {parent_hash}; stopping for live reconciliation"
                            );
                            break;
                        }
                        Err(e) => {
                            tracing::warn!(
                                target: "cknerv-adapter-ckb",
                                "backfill block {n} parent missing: {e}; stopping for live \
                                 reconciliation"
                            );
                            break;
                        }
                    }
                }

                let at = header_timestamp_ms(&block).unwrap_or_else(now_ms);
                let size = serialized_block_size(&block);
                match translate_block(&block, n, at, size) {
                    Ok(muts) => {
                        for m in muts {
                            let _ = out.send(m).await;
                        }
                        previous_hash = Some(hash.clone());
                        anchors.push((n, hash));
                    }
                    Err(e) => {
                        tracing::warn!(
                            target: "cknerv-adapter-ckb",
                            "backfill block {n} translate failed: {e}; stopping at canonical \
                             boundary"
                        );
                        break;
                    }
                }
            }
            Ok(None) => {
                tracing::warn!(
                    target: "cknerv-adapter-ckb",
                    "backfill block {n} not found; stopping for live retry"
                );
                break;
            }
            Err(e) => {
                tracing::warn!(
                    target: "cknerv-adapter-ckb",
                    "backfill block {n} fetch failed: {e}; stopping for live retry"
                );
                break;
            }
        }
        done += 1;
        if done % PROGRESS_EVERY == 0 && done != total {
            let _ = out
                .send(Mutation::BackfillProgress {
                    done,
                    total,
                    active: true,
                    phase: ReplayPhase::Boot,
                })
                .await;
        }
    }

    let _ = out
        .send(Mutation::BackfillProgress {
            done,
            total,
            active: false,
            phase: ReplayPhase::Boot,
        })
        .await;
    Ok(anchors)
}

pub(crate) struct BackfillOutcome {
    pub tip: u64,
    pub anchors: Vec<(u64, String)>,
}

/// Run the boot backfill: replay the most recent `blocks` blocks. Returns the
/// anchor tip (`tip0`) and hashes observed during replay plus the immediate
/// pre-window parent so the caller seeds both `PollState.last_tip` and enough
/// canonical proof to roll back the first retained block.
/// `blocks == 0` is a no-op that still returns the current tip.
pub(crate) async fn run_backfill(
    rpc: &RpcClient,
    blocks: u64,
    out: &mpsc::Sender<Mutation>,
) -> Result<BackfillOutcome> {
    let tip0 = rpc.get_tip_block_number().await?;
    if blocks == 0 {
        return Ok(BackfillOutcome {
            tip: tip0,
            anchors: Vec::new(),
        });
    }
    let lo = tip0.saturating_sub(blocks - 1);
    // Keep the canonical parent immediately before the replay window. The
    // poller needs that extra proof to roll back the first retained block
    // without escalating to a full controlled rebuild.
    let parent_anchor = if lo == 0 {
        None
    } else {
        let number = lo - 1;
        let hash = rpc.get_block_hash(number).await?.ok_or_else(|| {
            anyhow::anyhow!(
                "canonical backfill parent {number} missing while node tip is {tip0}"
            )
        })?;
        Some((number, hash))
    };
    let replayed = replay_window(
        rpc,
        lo,
        tip0,
        parent_anchor.as_ref().map(|(_, hash)| hash.as_str()),
        out,
    )
    .await?;
    let tip = replayed
        .last()
        .map(|(number, _)| *number)
        .unwrap_or_else(|| lo.saturating_sub(1));
    let mut anchors = Vec::with_capacity(replayed.len() + usize::from(parent_anchor.is_some()));
    anchors.extend(parent_anchor);
    anchors.extend(replayed);
    Ok(BackfillOutcome { tip, anchors })
}
