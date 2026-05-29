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
        .with_backfill_blocks(0)
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

    let adapter = CkbDirectAdapter::new(rpc_url)
        .with_backfill_blocks(0)
        .with_poll_interval(Duration::from_millis(30));

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

    let adapter = CkbDirectAdapter::new(rpc_url)
        .with_backfill_blocks(0)
        .with_poll_interval(Duration::from_millis(20));

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

#[tokio::test]
async fn adapter_backfills_recent_blocks_in_ascending_order() {
    let mut canned = mock_rpc::CannedResponses::default();
    canned.tip = 5;
    for n in 1..=5 {
        canned.blocks.insert(n, mock_rpc::simple_block(n, &format!("0xblock{n}")));
    }
    let (rpc_url, _handle) = mock_rpc::start(canned).await;

    let adapter = CkbDirectAdapter::new(rpc_url)
        .with_backfill_blocks(5)
        .with_poll_interval(Duration::from_millis(50));

    let emitted = drive_for(adapter, Duration::from_millis(400), Duration::from_millis(90)).await;

    // Progress envelope opens active and closes inactive at done==total.
    assert!(
        emitted.iter().any(|m| matches!(m, Mutation::BackfillProgress { active: true, .. })),
        "expected an active BackfillProgress; emitted: {emitted:#?}"
    );
    assert!(
        emitted.iter().any(|m| matches!(
            m,
            Mutation::BackfillProgress { done: 5, total: 5, active: false }
        )),
        "expected a terminal BackfillProgress; emitted: {emitted:#?}"
    );

    // tip0 = 5, blocks = 5 → lo = 1; blocks 1..=5 emitted once each, ascending.
    // last_tip is seeded to 5, so the forward poll does not re-emit block 5.
    let nums: Vec<u64> = emitted
        .iter()
        .filter_map(|m| match m {
            Mutation::BlockMined { number, .. } => Some(*number),
            _ => None,
        })
        .collect();
    assert_eq!(nums, vec![1, 2, 3, 4, 5], "backfill emits ascending, once each; got {nums:?}");
}

#[tokio::test]
async fn adapter_resume_skips_backfill_and_resumes_from_saved_tip() {
    let mut canned = mock_rpc::CannedResponses::default();
    canned.tip = 10;
    // Only the gap blocks (saved_tip+1 ..= tip) should be polled forward.
    for n in 8..=10 {
        canned.blocks.insert(n, mock_rpc::simple_block(n, &format!("0xblock{n}")));
    }
    let (rpc_url, _handle) = mock_rpc::start(canned).await;

    let adapter = CkbDirectAdapter::new(rpc_url)
        .with_backfill_blocks(1000) // would normally backfill, but resume wins
        .with_resume_from(Some(8))
        .with_poll_interval(Duration::from_millis(40));

    let emitted = drive_for(adapter, Duration::from_millis(300), Duration::from_millis(70)).await;

    // No backfill envelopes when resuming.
    assert!(
        !emitted.iter().any(|m| matches!(m, Mutation::BackfillProgress { .. })),
        "resume must skip backfill; emitted: {emitted:#?}"
    );
    // Forward poll resumes from saved tip 8 → processes 9 and 10 only.
    let nums: Vec<u64> = emitted
        .iter()
        .filter_map(|m| match m {
            Mutation::BlockMined { number, .. } => Some(*number),
            _ => None,
        })
        .collect();
    assert_eq!(nums, vec![9, 10], "resume polls forward from saved tip; got {nums:?}");
}
