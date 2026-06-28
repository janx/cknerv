//! Adapter contract: `Adapter::run` exits cleanly when the `shutdown`
//! watch flips to `true`. Pins the cooperative-shutdown discipline the
//! server depends on; an adapter that ignored the signal would leak
//! its task on every server stop.

use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::{mpsc, watch};

use cknerv_core::Mutation;
use cknerv_server::Adapter;

struct CountdownAdapter {
    ticks: u32,
}

#[async_trait]
impl Adapter for CountdownAdapter {
    fn name(&self) -> &'static str {
        "countdown-test"
    }
    async fn run(
        &self,
        out: mpsc::Sender<Mutation>,
        mut shutdown: watch::Receiver<bool>,
    ) -> anyhow::Result<()> {
        let mut remaining = self.ticks;
        loop {
            tokio::select! {
                _ = shutdown.changed() => {
                    if *shutdown.borrow() { break; }
                }
                _ = tokio::time::sleep(Duration::from_millis(10)) => {
                    if remaining == 0 { break; }
                    remaining -= 1;
                    let _ = out
                        .send(Mutation::BlockMined {
                            number: remaining as u64,
                            hash: "0xtest".into(),
                            tx_count: 0,
                            size: 0,
                            at: 0,
                        })
                        .await;
                }
            }
        }
        Ok(())
    }
}

#[tokio::test]
async fn adapter_run_to_completion_respects_shutdown() {
    let (tx, _rx) = mpsc::channel(16);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let handle = tokio::spawn(async move {
        let a = CountdownAdapter { ticks: 1000 };
        a.run(tx, shutdown_rx).await.unwrap();
    });

    // Give it ~30ms to tick, then shutdown.
    tokio::time::sleep(Duration::from_millis(30)).await;
    let _ = shutdown_tx.send(true);

    let result = tokio::time::timeout(Duration::from_millis(500), handle).await;
    assert!(
        result.is_ok(),
        "adapter did not exit within 500ms of shutdown signal"
    );
}

#[tokio::test]
async fn adapter_runs_to_natural_completion_without_shutdown() {
    // The adapter exits naturally after exhausting its ticks even if
    // shutdown is never signaled. Pins the "drop sender on exit"
    // discipline the reducer relies on for clean teardown.
    let (tx, _rx) = mpsc::channel(16);
    let (_shutdown_tx, shutdown_rx) = watch::channel(false);

    let handle = tokio::spawn(async move {
        let a = CountdownAdapter { ticks: 3 };
        a.run(tx, shutdown_rx).await.unwrap();
    });

    let result = tokio::time::timeout(Duration::from_millis(500), handle).await;
    assert!(
        result.is_ok(),
        "adapter did not finish ticking within 500ms"
    );
}
