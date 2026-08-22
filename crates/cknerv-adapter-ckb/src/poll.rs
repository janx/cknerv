//! Periodic tip + chain-info + mempool polling.
//!
//! Emits chain-info / mempool mutations on change; validates the last
//! canonical hash, emits `ChainReorganized` on divergence, then emits
//! BlockMined + TxLanded while advancing. Pushes directly into
//! cknerv-server's `mpsc::Sender<Mutation>`.

use std::collections::BTreeMap;

use anyhow::{anyhow, Result};
use serde_json::Value;
use tokio::sync::mpsc;

use cknerv_core::{EpochInfo, MempoolStats, Mutation, ReplayPhase};

use crate::backfill::{hydrate_at_tip, BackfillOutcome, HydrationPolicy};
use crate::block_fetch::{fetch_and_translate, fetch_and_translate_replay};
use crate::rpc::RpcClient;

/// Even when historical backfill is disabled, retain enough history to prove
/// and exactly replay the common one-block reorg case. One additional parent
/// anchor is retained by [`PollState::prune_canonical_history`].
const MIN_REORG_WINDOW_BLOCKS: u64 = 2;

/// Poll cycles that re-run a boot hydration the adapter could not complete at
/// startup, before it accepts the historical live-only fallback. The discovery
/// walk already absorbs single-block flakiness; these cover a whole attempt
/// lost to a transport failure or to a reorg at the anchored tip. Bounded, so a
/// node that can never satisfy the walk still gets a live stage instead of an
/// empty one.
const BOOT_HYDRATION_RETRY_ATTEMPTS: u32 = 3;

/// Mutable state threaded across `poll_once` invocations.
#[derive(Default)]
pub struct PollState {
    /// Highest canonical height synchronized by the poller. This is normally
    /// the last emitted `BlockMined`.
    pub last_tip: Option<u64>,
    /// Canonical hashes observed by this adapter. The poller validates the
    /// hash at `last_tip` every cycle; a mismatch causes a backward walk over
    /// these anchors to find the highest common ancestor.
    canonical_blocks: BTreeMap<u64, String>,
    /// True after a canonical suffix was invalidated until every replacement
    /// block through the observed tip has been emitted. Prevents a transient
    /// fetch gap from turning the remainder into a capped downtime catch-up.
    replaying_reorg: bool,
    /// True while an ordinary downtime catch-up has only partially emitted.
    /// Keeps the cause stable across transient block-visibility gaps even if
    /// the remaining gap falls below the initial catch-up threshold.
    catching_up: bool,
    /// Boot hydration attempts the poller still owes. Startup hydration is
    /// single-shot; without this the first failure would leave the stage empty
    /// for the life of the process.
    hydration_attempts_left: u32,
    pub last_chain_info: Option<(EpochInfo, u64, String, String)>,
    pub last_mempool: Option<MempoolStats>,
}

impl PollState {
    /// Seed canonical anchors restored from persisted chain state or produced
    /// by boot backfill. Later entries at the same height win.
    pub fn seed_canonical<I>(&mut self, anchors: I)
    where
        I: IntoIterator<Item = (u64, String)>,
    {
        self.canonical_blocks.extend(anchors);
    }

    pub fn canonical_hash(&self, number: u64) -> Option<&str> {
        self.canonical_blocks.get(&number).map(String::as_str)
    }

    /// Ask the poller to re-run a boot hydration that failed at startup. Until
    /// the attempts are spent the poller re-discovers the window instead of
    /// following the tip, so a landing hydration never has to discard a live
    /// sliver it would otherwise duplicate.
    pub(crate) fn arm_hydration_retry(&mut self) {
        self.hydration_attempts_left = BOOT_HYDRATION_RETRY_ATTEMPTS;
    }

    /// Adopt a freshly discovered canonical window as the poller's cursor.
    fn adopt_hydrated_window(&mut self, hydrated: BackfillOutcome, reorg_window_blocks: u64) {
        self.canonical_blocks.clear();
        self.seed_canonical(hydrated.anchors);
        self.last_tip = Some(hydrated.tip);
        self.prune_canonical_history(reorg_window_blocks);
        self.replaying_reorg = false;
        self.catching_up = false;
    }

    fn prune_canonical_history(&mut self, reorg_window_blocks: u64) {
        let Some(latest) = self
            .last_tip
            .or_else(|| self.canonical_blocks.keys().next_back().copied())
        else {
            return;
        };
        let retained = reorg_window_blocks
            .max(MIN_REORG_WINDOW_BLOCKS)
            .saturating_add(1);
        let retain_from = latest.saturating_sub(retained.saturating_sub(1));
        self.canonical_blocks
            .retain(|number, _| *number >= retain_from);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CanonicalChange {
    Unchanged,
    Reorganize { from_block: u64 },
    Rebuild,
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
    catchup_threshold: u64,
    catchup_cap: u64,
) -> Result<()> {
    poll_once_with_policy(
        rpc,
        state,
        out,
        catchup_threshold,
        HydrationPolicy::with_block_limit(usize::MAX, catchup_cap).for_rebuild(),
        catchup_cap,
    )
    .await
}

/// Run one poll cycle with independent deep-rebuild and exact-reorg horizons.
/// [`poll_once`] preserves the historical fixed-window rebuild policy for
/// external callers; the production adapter uses a target-driven policy so its
/// Cell hydration depth does not enlarge the birth/death undo journal.
pub async fn poll_once_with_reorg_window(
    rpc: &RpcClient,
    state: &mut PollState,
    out: &mpsc::Sender<Mutation>,
    catchup_threshold: u64,
    catchup_cap: u64,
    reorg_window_blocks: u64,
) -> Result<()> {
    poll_once_with_policy(
        rpc,
        state,
        out,
        catchup_threshold,
        HydrationPolicy::with_block_limit(usize::MAX, catchup_cap).for_rebuild(),
        reorg_window_blocks,
    )
    .await
}

/// Production poll path: catch-up always replays every missing canonical
/// block, while an unprovably deep reorg rebuilds a target-sized Cell
/// reservoir rather than falling back to a fixed recent-block guess.
pub(crate) async fn poll_once_with_hydration(
    rpc: &RpcClient,
    state: &mut PollState,
    out: &mpsc::Sender<Mutation>,
    catchup_threshold: u64,
    hydration_policy: HydrationPolicy,
    reorg_window_blocks: u64,
) -> Result<()> {
    poll_once_with_policy(
        rpc,
        state,
        out,
        catchup_threshold,
        hydration_policy.for_rebuild(),
        reorg_window_blocks,
    )
    .await
}

async fn poll_once_with_policy(
    rpc: &RpcClient,
    state: &mut PollState,
    out: &mpsc::Sender<Mutation>,
    catchup_threshold: u64,
    hydration_policy: HydrationPolicy,
    reorg_window_blocks: u64,
) -> Result<()> {
    // 1. Tip + block walk
    let tip = rpc.get_tip_block_number().await?;
    sync_canonical_blocks(
        rpc,
        state,
        out,
        tip,
        catchup_threshold,
        hydration_policy,
        reorg_window_blocks,
    )
    .await?;

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

async fn sync_canonical_blocks(
    rpc: &RpcClient,
    state: &mut PollState,
    out: &mpsc::Sender<Mutation>,
    tip: u64,
    catchup_threshold: u64,
    hydration_policy: HydrationPolicy,
    reorg_window_blocks: u64,
) -> Result<()> {
    if state.hydration_attempts_left > 0 {
        // A boot hydration failed at startup. Re-discover the window at the
        // *current* tip — the anchor that failed is stale by now — instead of
        // settling into live-only for the life of the process. `reset` stays
        // false because this branch owns the cursor until a window lands: no
        // canonical block has been emitted, so there is nothing to discard and
        // no way to double-apply a hydration that eventually succeeds.
        //
        // `hydration_policy` is already `for_rebuild()`-normalized, which is
        // the identity for every policy that reaches boot hydration (that path
        // requires a non-zero Cell target and a non-zero block limit).
        state.hydration_attempts_left = state.hydration_attempts_left.saturating_sub(1);
        match hydrate_at_tip(rpc, tip, hydration_policy, ReplayPhase::Boot, false, out).await {
            Ok(hydrated) => {
                state.hydration_attempts_left = 0;
                state.adopt_hydrated_window(hydrated, reorg_window_blocks);
                return Ok(());
            }
            Err(error) if state.hydration_attempts_left > 0 => {
                tracing::warn!(
                    target: "cknerv-adapter-ckb",
                    attempts_left = state.hydration_attempts_left,
                    "cell hydration retry failed: {error}; retrying on the next poll"
                );
                // Chain info and mempool polling continue around this branch.
                return Ok(());
            }
            Err(error) => tracing::warn!(
                target: "cknerv-adapter-ckb",
                "cell hydration retry failed: {error}; starting live-only"
            ),
        }
    }

    if state.last_tip.is_none() {
        // Preserve the legacy live-only boot behavior: establish the block
        // immediately before the current tip as an anchor, then emit only the
        // current tip. Unlike the former height-only cursor, retain its hash so
        // a same-height replacement is visible on the next cycle.
        let anchor = tip.saturating_sub(1);
        if let Some(hash) = rpc.get_block_hash(anchor).await? {
            state.canonical_blocks.insert(anchor, hash);
        }
        state.last_tip = Some(anchor);
    }

    match find_canonical_change(rpc, state, tip).await? {
        CanonicalChange::Unchanged => {}
        CanonicalChange::Reorganize { from_block } => {
            let _ = out.send(Mutation::ChainReorganized { from_block }).await;
            state.canonical_blocks.split_off(&from_block);
            state.last_tip = Some(from_block.saturating_sub(1));
            state.replaying_reorg = true;
            state.catching_up = false;

            // A regressed tip can invalidate a suffix before any replacement
            // block exists. Keep the replay HUD active while waiting for that
            // canonical suffix; a non-empty range is announced by
            // `emit_canonical_range` below.
            if tip < from_block {
                let _ = out
                    .send(Mutation::BackfillProgress {
                        done: 0,
                        total: 0,
                        active: true,
                        phase: ReplayPhase::Reorg,
                    })
                    .await;
            }
        }
        CanonicalChange::Rebuild => {
            state.catching_up = false;
            return rebuild_canonical_window(
                rpc,
                state,
                out,
                tip,
                hydration_policy,
                reorg_window_blocks,
            )
            .await;
        }
    }

    let prev = state
        .last_tip
        .expect("sync_canonical_blocks initializes last_tip");
    if tip <= prev {
        state.prune_canonical_history(reorg_window_blocks);
        return Ok(());
    }

    let gap = tip - prev;
    let (lo, phase) = if state.replaying_reorg {
        // Reorg replay must begin at the actual invalidation boundary. Applying
        // the normal catch-up cap here would skip canonical transactions that
        // are required to undo/replace the orphan suffix.
        (prev + 1, Some(ReplayPhase::Reorg))
    } else if state.catching_up {
        (prev + 1, Some(ReplayPhase::Catchup))
    } else if gap > catchup_threshold {
        // Never skip the middle of a downtime gap: doing so can retain Cells
        // spent in omitted blocks and omit births that are still live. Large
        // gaps use a calm replay envelope but remain canonically complete.
        state.catching_up = true;
        (prev + 1, Some(ReplayPhase::Catchup))
    } else {
        (prev + 1, None)
    };

    let result = emit_canonical_range(rpc, state, out, lo, tip, phase, reorg_window_blocks).await;
    if result.is_ok() && state.last_tip == Some(tip) {
        state.replaying_reorg = false;
        state.catching_up = false;
    }
    result
}

async fn rebuild_canonical_window(
    rpc: &RpcClient,
    state: &mut PollState,
    out: &mpsc::Sender<Mutation>,
    tip: u64,
    hydration_policy: HydrationPolicy,
    reorg_window_blocks: u64,
) -> Result<()> {
    // Discovery and linkage validation happen before `ChainRebuild` is sent,
    // so a transient visibility gap leaves the currently visible state intact
    // and the next poll can retry cleanly.
    let rebuilt =
        hydrate_at_tip(rpc, tip, hydration_policy, ReplayPhase::Rebuild, true, out).await?;
    state.adopt_hydrated_window(rebuilt, reorg_window_blocks);
    Ok(())
}

/// Classify the current cursor as canonical, exactly rollbackable, or deeper
/// than the bounded anchor window.
async fn find_canonical_change(
    rpc: &RpcClient,
    state: &mut PollState,
    tip: u64,
) -> Result<CanonicalChange> {
    let Some(prev) = state.last_tip else {
        return Ok(CanonicalChange::Unchanged);
    };

    if tip >= prev {
        let Some(local_hash) = state.canonical_blocks.get(&prev).cloned() else {
            // Legacy resume cursors persisted only a height. Seed the missing
            // hash once; new persisted states provide anchors and therefore do
            // not take this compatibility path.
            if let Some(remote_hash) = rpc.get_block_hash(prev).await? {
                state.canonical_blocks.insert(prev, remote_hash);
            }
            return Ok(CanonicalChange::Unchanged);
        };
        let remote_hash = rpc
            .get_block_hash(prev)
            .await?
            .ok_or_else(|| anyhow!("canonical block {prev} missing while node tip is {tip}"))?;
        if local_hash == remote_hash {
            return Ok(CanonicalChange::Unchanged);
        }
    }

    // A lower tip is itself a suffix invalidation, even when its current tip
    // hash still matches. A hash mismatch at an equal/higher tip also lands
    // here. Walk known anchors backward and choose the highest match.
    let search_tip = tip.min(prev);
    let anchors: Vec<(u64, String)> = state
        .canonical_blocks
        .range(..=search_tip)
        .rev()
        .map(|(number, hash)| (*number, hash.clone()))
        .collect();
    if anchors.is_empty() {
        return Ok(CanonicalChange::Rebuild);
    }

    for (number, local_hash) in anchors {
        let remote_hash = rpc
            .get_block_hash(number)
            .await?
            .ok_or_else(|| anyhow!("canonical block {number} missing while node tip is {tip}"))?;
        if local_hash == remote_hash {
            return Ok(CanonicalChange::Reorganize {
                from_block: number.saturating_add(1),
            });
        }
    }

    Ok(CanonicalChange::Rebuild)
}

async fn emit_canonical_range(
    rpc: &RpcClient,
    state: &mut PollState,
    out: &mpsc::Sender<Mutation>,
    lo: u64,
    hi: u64,
    phase: Option<ReplayPhase>,
    reorg_window_blocks: u64,
) -> Result<()> {
    if lo > hi {
        return Ok(());
    }

    let total = hi - lo + 1;
    if let Some(phase) = phase {
        let _ = out
            .send(Mutation::BackfillProgress {
                done: 0,
                total,
                active: true,
                phase,
            })
            .await;
    }

    let mut done = 0;
    let result: Result<()> = async {
        for number in lo..=hi {
            let fetched = if phase.is_some() {
                fetch_and_translate_replay(rpc, number).await?
            } else {
                fetch_and_translate(rpc, number).await?
            };
            let Some(block) = fetched else {
                // The tip can become visible before get_block_by_number catches
                // up. Leave the cursor at the last fully-emitted block and
                // retry.
                break;
            };

            if number > 0 {
                let parent_height = number - 1;
                let expected_parent = match state.canonical_blocks.get(&parent_height) {
                    Some(hash) => hash.clone(),
                    None => {
                        let hash = rpc.get_block_hash(parent_height).await?.ok_or_else(|| {
                            anyhow!("canonical parent {parent_height} missing for block {number}")
                        })?;
                        state.canonical_blocks.insert(parent_height, hash.clone());
                        hash
                    }
                };
                if block.parent_hash != expected_parent {
                    return Err(anyhow!(
                        "block {number} parent mismatch during poll: expected {expected_parent}, \
                         fetched {}; retrying canonical reconciliation",
                        block.parent_hash
                    ));
                }
            }

            for mutation in block.mutations {
                let _ = out.send(mutation).await;
            }
            state.canonical_blocks.insert(number, block.hash);
            state.last_tip = Some(number);
            state.prune_canonical_history(reorg_window_blocks);
            done += 1;

            if let Some(phase) = phase.filter(|_| done % 25 == 0 && done != total) {
                let _ = out
                    .send(Mutation::BackfillProgress {
                        done,
                        total,
                        active: true,
                        phase,
                    })
                    .await;
            }
        }
        Ok(())
    }
    .await;

    if let Some(phase) = phase {
        let complete = result.is_ok() && state.last_tip == Some(hi);
        let _ = out
            .send(Mutation::BackfillProgress {
                done,
                total,
                // A temporarily unavailable block is not completion. Keep the
                // phase visible and resume it on the next poll. Hard errors
                // close this attempt before the retry reopens it.
                active: result.is_ok() && !complete,
                phase,
            })
            .await;
    }
    result
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
        .map_err(|e| {
            anyhow!("get_blockchain_info.median_time: bad hex {median_time_str:?}: {e}")
        })?;

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
