//! Adapter smoke: mock RPC returns canned tip/block/info/pool; adapter
//! emits ChainNodeRegistered + tip-advance BlockMined + TxLanded
//! correctly + respects shutdown.

use std::time::Duration;
use tokio::sync::{mpsc, watch};

use cknerv_adapter_ckb::CkbDirectAdapter;
use cknerv_core::Mutation;
use cknerv_server::Adapter;

mod mock_rpc;

/// Collect every mutation the adapter emits until the deadline elapses
/// or no mutation arrives within `idle` of the previous one — whichever
/// comes first. Shuts the adapter down cleanly afterwards.
async fn drive_for(
    adapter: CkbDirectAdapter,
    deadline: Duration,
    idle: Duration,
) -> Vec<Mutation> {
    let (tx, mut rx) = mpsc::channel::<Mutation>(64);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let task = tokio::spawn(async move { adapter.run(tx, shutdown_rx).await });

    let mut emitted = Vec::new();
    let end = std::time::Instant::now() + deadline;
    while std::time::Instant::now() < end {
        match tokio::time::timeout(idle, rx.recv()).await {
            Ok(Some(m)) => emitted.push(m),
            Ok(None) => break, // sender dropped
            Err(_) => continue, // idle window, keep looking
        }
    }

    let _ = shutdown_tx.send(true);
    let _ = tokio::time::timeout(Duration::from_secs(2), task).await;
    emitted
}

#[tokio::test]
async fn adapter_registers_node_and_polls_chain_info() {
    let (rpc_url, _handle) = mock_rpc::start(mock_rpc::CannedResponses::default()).await;

    let adapter = CkbDirectAdapter::new(rpc_url)
        .with_node("ckb:test", "ckb-test")
        .with_poll_interval(Duration::from_millis(40));

    let emitted = drive_for(adapter, Duration::from_millis(300), Duration::from_millis(60)).await;

    assert!(
        emitted.iter().any(|m| matches!(
            m,
            Mutation::ChainNodeRegistered { id, label, .. }
                if id == "ckb:test" && label == "ckb-test"
        )),
        "ChainNodeRegistered not emitted with the expected id/label; emitted: {emitted:#?}"
    );
    assert!(
        emitted
            .iter()
            .any(|m| matches!(m, Mutation::ChainInfoUpdated { .. })),
        "ChainInfoUpdated not emitted; emitted: {emitted:#?}"
    );
    assert!(
        emitted
            .iter()
            .any(|m| matches!(m, Mutation::ChainMempoolUpdated { .. })),
        "ChainMempoolUpdated not emitted; emitted: {emitted:#?}"
    );
}

#[tokio::test]
async fn adapter_emits_block_on_tip_advance() {
    let mut canned = mock_rpc::CannedResponses::default();
    canned.tip = 1;
    canned.blocks.insert(1, mock_rpc::simple_block(1, "0xblock1"));
    let (rpc_url, _handle) = mock_rpc::start(canned).await;

    let adapter = CkbDirectAdapter::new(rpc_url).with_poll_interval(Duration::from_millis(30));

    let emitted = drive_for(adapter, Duration::from_millis(300), Duration::from_millis(60)).await;

    assert!(
        emitted
            .iter()
            .any(|m| matches!(m, Mutation::BlockMined { number: 1, hash, .. } if hash == "0xblock1")),
        "BlockMined(1) not emitted; emitted: {emitted:#?}"
    );
    assert!(
        emitted
            .iter()
            .any(|m| matches!(m, Mutation::TxLanded { block: 1, .. })),
        "TxLanded for block 1 not emitted; emitted: {emitted:#?}"
    );
}

#[tokio::test]
async fn adapter_respects_shutdown() {
    let (rpc_url, _handle) = mock_rpc::start(mock_rpc::CannedResponses::default()).await;

    let adapter = CkbDirectAdapter::new(rpc_url).with_poll_interval(Duration::from_millis(20));

    let (tx, _rx) = mpsc::channel::<Mutation>(64);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let task = tokio::spawn(async move { adapter.run(tx, shutdown_rx).await });

    tokio::time::sleep(Duration::from_millis(80)).await;
    let _ = shutdown_tx.send(true);

    let result = tokio::time::timeout(Duration::from_secs(1), task).await;
    assert!(
        result.is_ok(),
        "adapter did not exit within 1s of shutdown signal"
    );
}
