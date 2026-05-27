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
}

impl CkbDirectAdapter {
    pub fn new(rpc_url: Url) -> Self {
        Self {
            rpc_url,
            poll_interval: Duration::from_secs(2),
            node_id: "ckb:local".into(),
            node_label: "ckb-local".into(),
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
