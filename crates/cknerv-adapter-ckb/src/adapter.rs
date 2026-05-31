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

use cknerv_core::Mutation;
use cknerv_server::Adapter;

use crate::poll::{poll_once, PollState};
use crate::rpc::RpcClient;

pub struct CkbDirectAdapter {
    rpc_url: Url,
    poll_interval: Duration,
    node_id: String,
    node_label: String,
    backfill_blocks: u64,
    resume_from: Option<u64>,
}

impl CkbDirectAdapter {
    pub fn new(rpc_url: Url) -> Self {
        Self {
            rpc_url,
            poll_interval: Duration::from_secs(2),
            node_id: "ckb:local".into(),
            node_label: "ckb-local".into(),
            backfill_blocks: 2000,
            resume_from: None,
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

    /// Number of recent blocks to replay at boot to seed the cell galaxy
    /// with the recent live-cell set. `0` disables backfill (legacy
    /// tip-only behavior).
    pub fn with_backfill_blocks(mut self, n: u64) -> Self {
        self.backfill_blocks = n;
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
            // Restored from persisted state: resume the forward poll from
            // the saved tip; the poll catches up the downtime gap. Skip
            // backfill so we don't re-replay (and duplicate) recent blocks.
            state.last_tip = Some(resume_tip);
        } else if self.backfill_blocks > 0 {
            match crate::backfill::run_backfill(&rpc, self.backfill_blocks, &out).await {
                Ok(tip0) => state.last_tip = Some(tip0),
                Err(e) => tracing::warn!(
                    target: "cknerv-adapter-ckb",
                    "backfill failed: {e}; starting live-only"
                ),
            }
        }

        let mut interval = tokio::time::interval(self.poll_interval);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                _ = shutdown.changed() => {
                    if *shutdown.borrow() {
                        break;
                    }
                }
                _ = interval.tick() => {
                    if let Err(e) = poll_once(&rpc, &mut state, &out).await {
                        tracing::warn!(
                            target: "cknerv-adapter-ckb",
                            "CKB poll error: {e}"
                        );
                        // Stay in the loop; transient errors should
                        // not crash the adapter.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_defaults_to_2000_backfill_blocks() {
        let adapter = CkbDirectAdapter::new(Url::parse("http://localhost:8114").unwrap());

        assert_eq!(adapter.backfill_blocks, 2000);
    }
}
