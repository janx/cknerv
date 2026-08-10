//! CkbDirectAdapter — `cknerv_server::Adapter` impl that wraps an
//! `RpcClient` + polling loop and emits `Mutation`s into the server's
//! pipeline.
//!
//! Boot sequence: emit `ChainNodeRegistered` once, then enter the
//! periodic poll loop. Transient RPC errors are logged via `tracing` and
//! the loop continues — only a `shutdown` signal exits the loop.

use anyhow::Result;
use async_trait::async_trait;
use std::time::Duration;
use tokio::sync::{mpsc, watch};
use url::Url;

use cknerv_core::{Mutation, RecentBlock, DEFAULT_REORG_WINDOW_BLOCKS};
use cknerv_server::Adapter;

use crate::network::poll_network_once;
use crate::poll::PollState;
use crate::rpc::RpcClient;

pub struct CkbDirectAdapter {
    rpc_url: Url,
    poll_interval: Duration,
    network_poll_interval: Duration,
    node_id: String,
    node_label: String,
    /// Target size of the retained live-Cell reservoir. The default boot path
    /// discovers as many canonical blocks as needed to satisfy this target.
    cell_target: usize,
    /// Optional one-run hard window override (`--backfill-blocks`). `None`
    /// keeps target-driven discovery; `Some(0)` preserves live-only boot.
    backfill_blocks: Option<u64>,
    reorg_window_blocks: u64,
    resume_from: Option<u64>,
    resume_anchors: Vec<RecentBlock>,
    /// Forward-gap (blocks) above which the poll treats an advance as a
    /// catch-up — replaying every missing block through a calm progress
    /// envelope (pulses suppressed) instead of animating the gap as live
    /// traffic. A normal poll advances 1–2 blocks, so this sits well above that
    /// but below any real downtime gap.
    catchup_threshold: u64,
}

impl CkbDirectAdapter {
    pub fn new(rpc_url: Url) -> Self {
        Self {
            rpc_url,
            poll_interval: Duration::from_secs(2),
            network_poll_interval: Duration::from_secs(4),
            node_id: "ckb:local".into(),
            node_label: "ckb-local".into(),
            cell_target: cknerv_core::projection::cells::CELL_CAP,
            backfill_blocks: None,
            reorg_window_blocks: DEFAULT_REORG_WINDOW_BLOCKS as u64,
            resume_from: None,
            resume_anchors: Vec::new(),
            catchup_threshold: 25,
        }
    }

    pub fn with_node(mut self, id: impl Into<String>, label: impl Into<String>) -> Self {
        self.node_id = id.into();
        self.node_label = label.into();
        self
    }

    pub fn with_poll_interval(mut self, d: Duration) -> Self {
        self.poll_interval = d;
        self
    }

    pub fn with_network_poll_interval(mut self, d: Duration) -> Self {
        self.network_poll_interval = d;
        self
    }

    /// Target number of live Cells the adapter should hydrate before entering
    /// ordinary polling. This is a data-reservoir budget, independent from the
    /// exact reorg journal and the browser's current display limit.
    pub fn with_cell_target(mut self, n: usize) -> Self {
        self.cell_target = n;
        self
    }

    /// One-run hard limit for boot/rebuild discovery. `0` disables historical
    /// boot replay (legacy tip-only behavior). Without this override the
    /// adapter scans until `cell_target` live outputs or genesis.
    pub fn with_backfill_blocks(mut self, n: u64) -> Self {
        self.backfill_blocks = Some(n);
        self
    }

    /// Canonical hash history retained for exact reorg reconciliation. The
    /// poller always keeps at least two blocks; deeper changes fall back to a
    /// controlled target-driven rebuild.
    pub fn with_reorg_window_blocks(mut self, n: u64) -> Self {
        self.reorg_window_blocks = n;
        self
    }

    /// If `Some(tip)`, the adapter resumes the forward poll from `tip`
    /// (skipping the boot backfill) — used when persisted state has been
    /// restored, so the downtime gap is caught up by the normal poll
    /// rather than re-replayed.
    pub fn with_resume_from(mut self, tip: Option<u64>) -> Self {
        self.resume_from = tip;
        self
    }

    /// Canonical hash anchors saved alongside a restored cursor. Supplying
    /// these makes the first poll able to detect a reorg that happened while
    /// cknerv was offline; a height-only cursor cannot distinguish that case.
    pub fn with_resume_anchors(mut self, anchors: Vec<RecentBlock>) -> Self {
        self.resume_anchors = anchors;
        self
    }

    /// Override the catch-up gap threshold (blocks). Default 25.
    pub fn with_catchup_threshold(mut self, n: u64) -> Self {
        self.catchup_threshold = n;
        self
    }
}

#[async_trait]
impl Adapter for CkbDirectAdapter {
    fn name(&self) -> &'static str {
        "ckb-direct"
    }

    async fn run(
        &self,
        out: mpsc::Sender<Mutation>,
        mut shutdown: watch::Receiver<bool>,
    ) -> Result<()> {
        // 1. Register the chain node once at startup.
        let _ = out
            .send(Mutation::ChainNodeRegistered {
                id: self.node_id.clone(),
                label: self.node_label.clone(),
                is_miner: false,
                at: now_ms(),
            })
            .await;

        // 2. Enter the poll loop. Skip behavior matches simulator's
        //    chain_poll: a slow tick doesn't queue up — we move on to
        //    the next interval rather than burst-firing missed cycles.
        let rpc = RpcClient::new(self.rpc_url.clone());
        let mut state = PollState::default();

        // Boot backfill: seed the recent live-cell set, then resume the
        // forward poll from the anchor tip. On failure, fall through to
        // the legacy tip-1 anchor (poll loop handles last_tip == None).
        if let Some(resume_tip) = self.resume_from {
            // Restored from persisted state: resume the forward poll from the
            // saved tip. A small gap replays live; a large one is caught up
            // calmly by poll_once's catch-up branch (complete gap, pulses
            // suppressed). Skip boot hydration either way so we don't replay
            // (and duplicate) blocks at/below the saved tip.
            state.last_tip = Some(resume_tip);
            state.seed_canonical(
                self.resume_anchors
                    .iter()
                    .map(|block| (block.number, block.hash.clone())),
            );
        } else if self.backfill_blocks != Some(0) && self.cell_target > 0 {
            let policy = self.hydration_policy();
            match crate::backfill::run_hydration(&rpc, policy, &out).await {
                Ok(backfill) => {
                    state.last_tip = Some(backfill.tip);
                    state.seed_canonical(backfill.anchors);
                }
                Err(e) => tracing::warn!(
                    target: "cknerv-adapter-ckb",
                    "cell hydration failed: {e}; starting live-only"
                ),
            }
        }

        let mut interval = tokio::time::interval(self.poll_interval);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        let mut net_interval = tokio::time::interval(self.network_poll_interval);
        net_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                _ = shutdown.changed() => {
                    if *shutdown.borrow() {
                        break;
                    }
                }
                _ = interval.tick() => {
                    if let Err(e) = crate::poll::poll_once_with_hydration(
                        &rpc,
                        &mut state,
                        &out,
                        self.catchup_threshold,
                        self.hydration_policy(),
                        self.reorg_window_blocks,
                    ).await {
                        tracing::warn!(
                            target: "cknerv-adapter-ckb",
                            "CKB poll error: {e}"
                        );
                        // Stay in the loop; transient errors should
                        // not crash the adapter.
                    }
                }
                _ = net_interval.tick() => {
                    if let Err(e) = poll_network_once(&rpc, &self.node_id, &out).await {
                        tracing::warn!(
                            target: "cknerv-adapter-ckb",
                            "CKB network poll error: {e}"
                        );
                    }
                }
            }
        }
        Ok(())
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl CkbDirectAdapter {
    fn hydration_policy(&self) -> crate::backfill::HydrationPolicy {
        match self.backfill_blocks {
            Some(limit) => {
                crate::backfill::HydrationPolicy::with_block_limit(self.cell_target, limit)
            }
            None => crate::backfill::HydrationPolicy::adaptive(self.cell_target),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_defaults_to_target_driven_hydration() {
        let adapter = CkbDirectAdapter::new(Url::parse("http://localhost:8114").unwrap());

        // The default hydration target tracks the projection's CELL_CAP.
        assert_eq!(adapter.cell_target, cknerv_core::projection::cells::CELL_CAP);
        assert_eq!(adapter.cell_target, 50_000);
        assert_eq!(adapter.backfill_blocks, None);
        assert_eq!(
            adapter.reorg_window_blocks,
            DEFAULT_REORG_WINDOW_BLOCKS as u64
        );
    }
}
