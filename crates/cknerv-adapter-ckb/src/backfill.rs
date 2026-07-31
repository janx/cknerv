//! Target-driven historical Cell hydration.
//!
//! A fixed recent-block count cannot guarantee a useful Cell reservoir:
//! output density and churn vary by network and over time. The default boot
//! path therefore walks canonical blocks from the anchored tip backwards,
//! tracking spent outpoints until it has found `target_cells` outputs that
//! are still live at that tip (or reaches genesis). Fetched blocks are kept as
//! compact translated mutations, then applied once in ascending order so the
//! ordinary chain/projection reducers remain the single canonical path.
//!
//! `--backfill-blocks` remains an optional one-run hard scan limit. It is a
//! diagnostic escape hatch, not the default reservoir policy.

use std::collections::HashSet;

use anyhow::{anyhow, Result};
use futures::stream::{self, StreamExt};
use tokio::sync::mpsc;

use cknerv_core::entity::RECENT_INTERVAL_CAP;
use cknerv_core::{is_cellbase_input, Mutation, OutPoint, ReplayPhase};

use crate::block_fetch::{fetch_and_translate_replay_with_size, FetchedBlock};
use crate::rpc::RpcClient;

/// How many block fetches are in flight at once. `buffered` preserves the
/// descending discovery order even when requests complete out of order.
const FETCH_CONCURRENCY: usize = 8;

/// Discovery progress has no known block total yet. Publish an occasional
/// zero-total marker so connected dashboards remain visibly in boot/rebuild
/// mode without flooding the mutation stream.
const DISCOVERY_PROGRESS_EVERY: u64 = 256;

/// Ordered replay progress cadence.
const REPLAY_PROGRESS_EVERY: u64 = 25;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct HydrationPolicy {
    pub target_cells: usize,
    /// `None` scans until the Cell target or genesis. `Some(n)` limits the
    /// discovery to the most recent `n` blocks.
    pub block_limit: Option<u64>,
}

impl HydrationPolicy {
    pub(crate) fn adaptive(target_cells: usize) -> Self {
        Self {
            target_cells,
            block_limit: None,
        }
    }

    pub(crate) fn with_block_limit(target_cells: usize, block_limit: u64) -> Self {
        Self {
            target_cells,
            block_limit: Some(block_limit),
        }
    }

    /// A controlled rebuild must establish at least the current tip even when
    /// the CLI's diagnostic override or target is zero (boot uses zero as
    /// live-only).
    pub(crate) fn for_rebuild(self) -> Self {
        Self {
            block_limit: match self.block_limit {
                Some(limit) => Some(limit.max(1)),
                None if self.target_cells == 0 => Some(1),
                None => None,
            },
            ..self
        }
    }
}

pub(crate) struct BackfillOutcome {
    pub tip: u64,
    pub anchors: Vec<(u64, String)>,
}

struct DiscoveredWindow {
    tip: u64,
    from_block: u64,
    available: usize,
    complete: bool,
    blocks_descending: Vec<(u64, FetchedBlock)>,
}

/// Discover and replay a boot hydration window at the node's current tip.
pub(crate) async fn run_hydration(
    rpc: &RpcClient,
    policy: HydrationPolicy,
    out: &mpsc::Sender<Mutation>,
) -> Result<BackfillOutcome> {
    let tip = rpc.get_tip_block_number().await?;
    hydrate_at_tip(rpc, tip, policy, ReplayPhase::Boot, false, out).await
}

/// Discover and replay a canonical window anchored at `tip`. When `reset` is
/// true, the existing derived window is discarded only after discovery and
/// canonical validation have succeeded, so transient RPC gaps leave the old
/// visible state intact.
pub(crate) async fn hydrate_at_tip(
    rpc: &RpcClient,
    tip: u64,
    policy: HydrationPolicy,
    phase: ReplayPhase,
    reset: bool,
    out: &mpsc::Sender<Mutation>,
) -> Result<BackfillOutcome> {
    let _ = out
        .send(Mutation::BackfillProgress {
            done: 0,
            total: 0,
            active: true,
            phase,
        })
        .await;

    let discovered = match discover_window(rpc, tip, policy, out, phase).await {
        Ok(discovered) => discovered,
        Err(error) => {
            let _ = out
                .send(Mutation::BackfillProgress {
                    done: 0,
                    total: 0,
                    active: false,
                    phase,
                })
                .await;
            return Err(error);
        }
    };

    tracing::info!(
        target: "cknerv-adapter-ckb",
        phase = ?phase,
        from_block = discovered.from_block,
        tip = discovered.tip,
        blocks = discovered.blocks_descending.len(),
        available_live_cells = discovered.available,
        target_live_cells = policy.target_cells,
        target_complete = discovered.complete,
        "cell hydration window discovered"
    );

    replay_discovered(discovered, policy, phase, reset, out).await
}

async fn discover_window(
    rpc: &RpcClient,
    tip: u64,
    policy: HydrationPolicy,
    out: &mpsc::Sender<Mutation>,
    phase: ReplayPhase,
) -> Result<DiscoveredWindow> {
    let chain_blocks = tip.saturating_add(1);
    let scan_blocks = policy.block_limit.unwrap_or(chain_blocks).min(chain_blocks);
    if scan_blocks == 0 {
        return Err(anyhow!("cell hydration block limit is zero"));
    }
    let floor_limit = tip.saturating_sub(scan_blocks.saturating_sub(1));

    let mut stream = stream::iter((floor_limit..=tip).rev())
        .map(|number| async move {
            let exact_size = tip.saturating_sub(number) < RECENT_INTERVAL_CAP as u64;
            (
                number,
                fetch_and_translate_replay_with_size(rpc, number, exact_size).await,
            )
        })
        .buffered(FETCH_CONCURRENCY);

    let mut spent = HashSet::<OutPoint>::new();
    let mut available = 0usize;
    let mut expected_hash: Option<String> = None;
    let mut blocks_descending = Vec::new();
    let mut scanned = 0u64;

    while let Some((number, fetched)) = stream.next().await {
        let block =
            fetched?.ok_or_else(|| anyhow!("canonical hydration block {number} is not visible"))?;

        if let Some(expected) = expected_hash.as_deref() {
            if block.hash != expected {
                return Err(anyhow!(
                    "canonical hydration linkage mismatch at block {number}: expected {expected}, fetched {}",
                    block.hash
                ));
            }
        }
        expected_hash = Some(block.parent_hash.clone());

        observe_live_outputs(&block, &mut spent, &mut available);
        blocks_descending.push((number, block));
        scanned += 1;

        if policy.target_cells > 0 && available >= policy.target_cells {
            break;
        }
        if scanned.is_multiple_of(DISCOVERY_PROGRESS_EVERY) {
            let _ = out
                .send(Mutation::BackfillProgress {
                    done: scanned,
                    total: 0,
                    active: true,
                    phase,
                })
                .await;
        }
    }

    let (from_block, oldest) = blocks_descending
        .last()
        .ok_or_else(|| anyhow!("cell hydration discovered no canonical blocks"))?;
    let from_block = *from_block;
    let cached_tip_hash = blocks_descending
        .first()
        .map(|(_, block)| block.hash.as_str())
        .expect("non-empty hydration window");
    let current_tip_hash = rpc
        .get_block_hash(tip)
        .await?
        .ok_or_else(|| anyhow!("canonical hydration tip {tip} disappeared"))?;
    if current_tip_hash != cached_tip_hash {
        return Err(anyhow!(
            "canonical hydration tip changed during discovery: started {cached_tip_hash}, now {current_tip_hash}"
        ));
    }

    // `oldest` is intentionally read here to pin its parent linkage before
    // ownership moves into ordered replay.
    let _oldest_parent = oldest.parent_hash.as_str();
    let complete = available >= policy.target_cells || from_block == 0;
    Ok(DiscoveredWindow {
        tip,
        from_block,
        available,
        complete,
        blocks_descending,
    })
}

/// Update the live-output estimate for one block while walking backwards.
/// Inputs for the entire block are recorded before outputs so an intra-block
/// dependency (if accepted by a source) is classified correctly as spent.
fn observe_live_outputs(
    block: &FetchedBlock,
    spent: &mut HashSet<OutPoint>,
    available: &mut usize,
) {
    for mutation in &block.mutations {
        if let Mutation::TxLanded { inputs, .. } = mutation {
            for input in inputs {
                if !is_cellbase_input(input) {
                    spent.insert(input.clone());
                }
            }
        }
    }

    for mutation in &block.mutations {
        if let Mutation::TxLanded {
            tx_hash, outputs, ..
        } = mutation
        {
            for (index, _) in outputs.iter().enumerate() {
                let out_point = OutPoint {
                    tx_hash: tx_hash.clone(),
                    index: u32::try_from(index).unwrap_or(u32::MAX),
                };
                if !spent.remove(&out_point) {
                    *available = available.saturating_add(1);
                }
            }
        }
    }
}

async fn replay_discovered(
    mut discovered: DiscoveredWindow,
    policy: HydrationPolicy,
    phase: ReplayPhase,
    reset: bool,
    out: &mpsc::Sender<Mutation>,
) -> Result<BackfillOutcome> {
    if reset {
        let _ = out
            .send(Mutation::ChainRebuild {
                from_block: discovered.from_block,
            })
            .await;
    }

    let total = u64::try_from(discovered.blocks_descending.len()).unwrap_or(u64::MAX);
    let _ = out
        .send(Mutation::BackfillProgress {
            done: 0,
            total,
            active: true,
            phase,
        })
        .await;

    let parent_anchor = discovered
        .blocks_descending
        .last()
        .and_then(|(number, block)| {
            number
                .checked_sub(1)
                .map(|parent| (parent, block.parent_hash.clone()))
        });
    discovered.blocks_descending.reverse();

    let mut anchors = Vec::with_capacity(
        discovered.blocks_descending.len() + usize::from(parent_anchor.is_some()),
    );
    anchors.extend(parent_anchor);

    let mut done = 0u64;
    for (number, block) in discovered.blocks_descending {
        let hash = block.hash;
        for mutation in block.mutations {
            let _ = out.send(mutation).await;
        }
        anchors.push((number, hash));
        done = done.saturating_add(1);
        if done.is_multiple_of(REPLAY_PROGRESS_EVERY) && done != total {
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

    // `usize::MAX` is used only by the legacy fixed-window poll helpers. It
    // means "do not stop on a Cell target", so it must not be persisted as a
    // genuine hydration guarantee when that window happens to reach genesis.
    if discovered.complete && policy.target_cells != usize::MAX {
        let _ = out
            .send(Mutation::CellHydrationCompleted {
                target: u64::try_from(policy.target_cells).unwrap_or(u64::MAX),
                available: u64::try_from(discovered.available).unwrap_or(u64::MAX),
                from_block: discovered.from_block,
                at_tip: discovered.tip,
            })
            .await;
    }
    let _ = out
        .send(Mutation::BackfillProgress {
            done,
            total,
            active: false,
            phase,
        })
        .await;

    Ok(BackfillOutcome {
        tip: discovered.tip,
        anchors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cknerv_core::TxOutputInfo;

    fn output() -> TxOutputInfo {
        TxOutputInfo {
            capacity: 1,
            data_hex: "0x".to_string(),
            content_hash: format!("0x{}", "00".repeat(32)),
            lock_kind: Default::default(),
            asset_kind: Default::default(),
        }
    }

    fn tx(tx_hash: &str, inputs: Vec<OutPoint>, outputs: usize) -> Mutation {
        Mutation::TxLanded {
            tx_hash: tx_hash.to_string(),
            block: 0,
            at: 0,
            inputs,
            outputs: (0..outputs).map(|_| output()).collect(),
        }
    }

    fn fetched(mutations: Vec<Mutation>) -> FetchedBlock {
        FetchedBlock {
            hash: "0xblock".to_string(),
            parent_hash: "0xparent".to_string(),
            mutations,
        }
    }

    #[test]
    fn reverse_observation_counts_only_outputs_live_at_the_anchor_tip() {
        let old = OutPoint {
            tx_hash: "0xold".to_string(),
            index: 0,
        };
        let newer = fetched(vec![tx("0xnew", vec![old.clone()], 2)]);
        let older = fetched(vec![tx("0xold", Vec::new(), 2)]);
        let mut spent = HashSet::new();
        let mut available = 0;

        observe_live_outputs(&newer, &mut spent, &mut available);
        assert_eq!(available, 2);
        observe_live_outputs(&older, &mut spent, &mut available);

        // Two newer outputs + old output index 1 survive. Old index 0 was
        // consumed by the newer transaction and is not counted.
        assert_eq!(available, 3);
        assert!(spent.is_empty());
    }

    #[test]
    fn rebuild_policy_never_produces_an_empty_canonical_window() {
        assert_eq!(
            HydrationPolicy::with_block_limit(10, 0)
                .for_rebuild()
                .block_limit,
            Some(1)
        );
        assert_eq!(
            HydrationPolicy::adaptive(10).for_rebuild().block_limit,
            None
        );
        assert_eq!(
            HydrationPolicy::adaptive(0).for_rebuild().block_limit,
            Some(1)
        );
    }
}
