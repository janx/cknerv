//! Adapter smoke: mock RPC returns canned tip/block/info/pool; adapter
//! emits ChainNodeRegistered + canonical BlockMined + TxLanded, reconciles
//! reorgs, and respects shutdown.

use std::time::Duration;
use tokio::sync::{mpsc, watch};

use cknerv_adapter_ckb::{
    poll::{poll_once, poll_once_with_reorg_window, PollState},
    rpc::RpcClient,
    CkbDirectAdapter,
};
use cknerv_core::{Mutation, PeerDirection, ReplayPhase};
use cknerv_server::Adapter;
use serde_json::json;

mod mock_rpc;

/// Collect every mutation the adapter emits until the deadline elapses
/// or no mutation arrives within `idle` of the previous one — whichever
/// comes first. Shuts the adapter down cleanly afterwards.
async fn drive_for(adapter: CkbDirectAdapter, deadline: Duration, idle: Duration) -> Vec<Mutation> {
    let (tx, mut rx) = mpsc::channel::<Mutation>(64);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let task = tokio::spawn(async move { adapter.run(tx, shutdown_rx).await });

    let mut emitted = Vec::new();
    let end = std::time::Instant::now() + deadline;
    while std::time::Instant::now() < end {
        match tokio::time::timeout(idle, rx.recv()).await {
            Ok(Some(m)) => emitted.push(m),
            Ok(None) => break,  // sender dropped
            Err(_) => continue, // idle window, keep looking
        }
    }

    let _ = shutdown_tx.send(true);
    let _ = tokio::time::timeout(Duration::from_secs(2), task).await;
    emitted
}

async fn poll_cycle(
    rpc: &RpcClient,
    state: &mut PollState,
    tx: &mpsc::Sender<Mutation>,
    rx: &mut mpsc::Receiver<Mutation>,
) -> Vec<Mutation> {
    poll_cycle_with(rpc, state, tx, rx, 25, 0).await
}

async fn poll_cycle_with(
    rpc: &RpcClient,
    state: &mut PollState,
    tx: &mpsc::Sender<Mutation>,
    rx: &mut mpsc::Receiver<Mutation>,
    catchup_threshold: u64,
    catchup_cap: u64,
) -> Vec<Mutation> {
    poll_once(rpc, state, tx, catchup_threshold, catchup_cap)
        .await
        .expect("poll cycle");
    let mut emitted = Vec::new();
    while let Ok(mutation) = rx.try_recv() {
        emitted.push(mutation);
    }
    emitted
}

async fn poll_cycle_with_windows(
    rpc: &RpcClient,
    state: &mut PollState,
    tx: &mpsc::Sender<Mutation>,
    rx: &mut mpsc::Receiver<Mutation>,
    catchup_threshold: u64,
    catchup_cap: u64,
    reorg_window_blocks: u64,
) -> Vec<Mutation> {
    poll_once_with_reorg_window(
        rpc,
        state,
        tx,
        catchup_threshold,
        catchup_cap,
        reorg_window_blocks,
    )
    .await
    .expect("poll cycle");
    let mut emitted = Vec::new();
    while let Ok(mutation) = rx.try_recv() {
        emitted.push(mutation);
    }
    emitted
}

#[tokio::test]
async fn adapter_registers_node_and_polls_chain_info() {
    let (rpc_url, _handle) = mock_rpc::start(mock_rpc::CannedResponses::default()).await;

    let adapter = CkbDirectAdapter::new(rpc_url)
        .with_node("ckb:test", "ckb-test")
        .with_backfill_blocks(0)
        .with_poll_interval(Duration::from_millis(40));

    let emitted = drive_for(
        adapter,
        Duration::from_millis(300),
        Duration::from_millis(60),
    )
    .await;

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
    let mut canned = mock_rpc::CannedResponses {
        tip: 1,
        ..Default::default()
    };
    canned
        .blocks
        .insert(1, mock_rpc::simple_block(1, "0xblock1"));
    let (rpc_url, _handle) = mock_rpc::start(canned).await;

    let adapter = CkbDirectAdapter::new(rpc_url)
        .with_backfill_blocks(0)
        .with_poll_interval(Duration::from_millis(30));

    let emitted = drive_for(
        adapter,
        Duration::from_millis(300),
        Duration::from_millis(60),
    )
    .await;

    assert!(
        emitted.iter().any(
            |m| matches!(m, Mutation::BlockMined { number: 1, hash, .. } if hash == "0xblock1")
        ),
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
async fn poll_detects_same_height_hash_replacement() {
    let mut canned = mock_rpc::CannedResponses {
        tip: 1,
        ..Default::default()
    };
    canned
        .blocks
        .insert(1, mock_rpc::simple_block(1, "0xblock1"));
    let (rpc_url, _handle, canned) = mock_rpc::start_mutable(canned).await;
    let rpc = RpcClient::new(rpc_url);
    let (tx, mut rx) = mpsc::channel(64);
    let mut state = PollState::default();

    let first = poll_cycle(&rpc, &mut state, &tx, &mut rx).await;
    assert!(first
        .iter()
        .any(|m| matches!(m, Mutation::BlockMined { number: 1, hash, .. } if hash == "0xblock1")));

    {
        let mut canned = canned.lock().unwrap();
        canned.blocks.insert(
            1,
            mock_rpc::simple_block_with_parent(1, "0xfork1", "0xblock0"),
        );
    }
    let replacement = poll_cycle(&rpc, &mut state, &tx, &mut rx).await;
    let canonical: Vec<(String, u64)> = replacement
        .iter()
        .filter_map(|mutation| match mutation {
            Mutation::ChainReorganized { from_block } => Some(("reorg".to_string(), *from_block)),
            Mutation::BlockMined { number, hash, .. } => Some((hash.clone(), *number)),
            _ => None,
        })
        .collect();

    assert_eq!(
        canonical,
        vec![("reorg".to_string(), 1), ("0xfork1".to_string(), 1),]
    );
    assert!(replacement.iter().any(|mutation| matches!(
        mutation,
        Mutation::BackfillProgress {
            phase: ReplayPhase::Reorg,
            active: true,
            ..
        }
    )));
    assert_eq!(state.canonical_hash(1), Some("0xfork1"));
}

#[tokio::test]
async fn poll_invalidates_suffix_immediately_when_tip_regresses() {
    let mut canned = mock_rpc::CannedResponses {
        tip: 1,
        ..Default::default()
    };
    canned
        .blocks
        .insert(1, mock_rpc::simple_block(1, "0xblock1"));
    let (rpc_url, _handle, canned) = mock_rpc::start_mutable(canned).await;
    let rpc = RpcClient::new(rpc_url);
    let (tx, mut rx) = mpsc::channel(64);
    let mut state = PollState::default();

    let _ = poll_cycle(&rpc, &mut state, &tx, &mut rx).await;
    {
        let mut canned = canned.lock().unwrap();
        canned.tip = 3;
        for number in 2..=3 {
            canned.blocks.insert(
                number,
                mock_rpc::simple_block(number, &format!("0xblock{number}")),
            );
        }
    }
    let _ = poll_cycle(&rpc, &mut state, &tx, &mut rx).await;
    assert_eq!(state.last_tip, Some(3));

    canned.lock().unwrap().tip = 1;
    let regression = poll_cycle(&rpc, &mut state, &tx, &mut rx).await;

    assert!(matches!(
        regression.as_slice(),
        [
            Mutation::ChainReorganized { from_block: 2 },
            Mutation::BackfillProgress {
                done: 0,
                total: 0,
                active: true,
                phase: ReplayPhase::Reorg
            }
        ]
    ));
    assert_eq!(state.last_tip, Some(1));
    assert!(state.canonical_hash(2).is_none());
    assert!(state.canonical_hash(3).is_none());
}

#[tokio::test]
async fn poll_finds_common_ancestor_when_reorg_tip_keeps_growing() {
    let mut canned = mock_rpc::CannedResponses {
        tip: 1,
        ..Default::default()
    };
    canned
        .blocks
        .insert(1, mock_rpc::simple_block(1, "0xblock1"));
    let (rpc_url, _handle, canned) = mock_rpc::start_mutable(canned).await;
    let rpc = RpcClient::new(rpc_url);
    let (tx, mut rx) = mpsc::channel(64);
    let mut state = PollState::default();

    let _ = poll_cycle(&rpc, &mut state, &tx, &mut rx).await;
    {
        let mut canned = canned.lock().unwrap();
        canned.tip = 3;
        canned
            .blocks
            .insert(2, mock_rpc::simple_block(2, "0xblock2"));
        canned
            .blocks
            .insert(3, mock_rpc::simple_block(3, "0xblock3"));
    }
    let _ = poll_cycle(&rpc, &mut state, &tx, &mut rx).await;

    {
        let mut canned = canned.lock().unwrap();
        canned.tip = 4;
        canned.blocks.insert(
            2,
            mock_rpc::simple_block_with_parent(2, "0xfork2", "0xblock1"),
        );
        canned.blocks.insert(
            3,
            mock_rpc::simple_block_with_parent(3, "0xfork3", "0xfork2"),
        );
        canned.blocks.insert(
            4,
            mock_rpc::simple_block_with_parent(4, "0xfork4", "0xfork3"),
        );
    }
    let replay = poll_cycle(&rpc, &mut state, &tx, &mut rx).await;
    let canonical: Vec<(u64, String)> = replay
        .iter()
        .filter_map(|mutation| match mutation {
            Mutation::ChainReorganized { from_block } => Some((*from_block, "reorg".to_string())),
            Mutation::BlockMined { number, hash, .. } => Some((*number, hash.clone())),
            _ => None,
        })
        .collect();

    assert_eq!(
        canonical,
        vec![
            (2, "reorg".to_string()),
            (2, "0xfork2".to_string()),
            (3, "0xfork3".to_string()),
            (4, "0xfork4".to_string()),
        ]
    );
    assert_eq!(state.last_tip, Some(4));
}

#[tokio::test]
async fn poll_reconciles_reorg_from_restored_hash_anchors() {
    let mut canned = mock_rpc::CannedResponses {
        tip: 4,
        ..Default::default()
    };
    canned
        .blocks
        .insert(1, mock_rpc::simple_block(1, "0xblock1"));
    canned.blocks.insert(
        2,
        mock_rpc::simple_block_with_parent(2, "0xfork2", "0xblock1"),
    );
    canned.blocks.insert(
        3,
        mock_rpc::simple_block_with_parent(3, "0xfork3", "0xfork2"),
    );
    canned.blocks.insert(
        4,
        mock_rpc::simple_block_with_parent(4, "0xfork4", "0xfork3"),
    );
    let (rpc_url, _handle) = mock_rpc::start(canned).await;
    let rpc = RpcClient::new(rpc_url);
    let (tx, mut rx) = mpsc::channel(64);
    let mut state = PollState::default();
    state.last_tip = Some(3);
    state.seed_canonical([
        (1, "0xblock1".to_string()),
        (2, "0xblock2".to_string()),
        (3, "0xblock3".to_string()),
    ]);

    let replay = poll_cycle(&rpc, &mut state, &tx, &mut rx).await;
    let canonical: Vec<(u64, String)> = replay
        .iter()
        .filter_map(|mutation| match mutation {
            Mutation::ChainReorganized { from_block } => Some((*from_block, "reorg".to_string())),
            Mutation::BlockMined { number, hash, .. } => Some((*number, hash.clone())),
            _ => None,
        })
        .collect();

    assert_eq!(
        canonical,
        vec![
            (2, "reorg".to_string()),
            (2, "0xfork2".to_string()),
            (3, "0xfork3".to_string()),
            (4, "0xfork4".to_string()),
        ]
    );
    assert_eq!(state.last_tip, Some(4));
}

#[tokio::test]
async fn poll_rebuilds_when_every_restored_anchor_is_orphaned() {
    let mut canned = mock_rpc::CannedResponses {
        tip: 4,
        ..Default::default()
    };
    canned.blocks.insert(
        1,
        mock_rpc::simple_block_with_parent(1, "0xfork1", "0xblock0"),
    );
    canned.blocks.insert(
        2,
        mock_rpc::simple_block_with_parent(2, "0xfork2", "0xfork1"),
    );
    canned.blocks.insert(
        3,
        mock_rpc::simple_block_with_parent(3, "0xfork3", "0xfork2"),
    );
    canned.blocks.insert(
        4,
        mock_rpc::simple_block_with_parent(4, "0xfork4", "0xfork3"),
    );
    let (rpc_url, _handle) = mock_rpc::start(canned).await;
    let rpc = RpcClient::new(rpc_url);
    let (tx, mut rx) = mpsc::channel(128);
    let mut state = PollState::default();
    state.last_tip = Some(3);
    state.seed_canonical([
        (1, "0xblock1".to_string()),
        (2, "0xblock2".to_string()),
        (3, "0xblock3".to_string()),
    ]);

    let rebuild = poll_cycle_with(&rpc, &mut state, &tx, &mut rx, 25, 2).await;
    let canonical: Vec<(u64, String)> = rebuild
        .iter()
        .filter_map(|mutation| match mutation {
            Mutation::ChainRebuild { from_block } => Some((*from_block, "rebuild".to_string())),
            Mutation::BlockMined { number, hash, .. } => Some((*number, hash.clone())),
            _ => None,
        })
        .collect();

    assert_eq!(
        canonical,
        vec![
            (3, "rebuild".to_string()),
            (3, "0xfork3".to_string()),
            (4, "0xfork4".to_string()),
        ]
    );
    assert_eq!(state.canonical_hash(2), Some("0xfork2"));
    assert_eq!(state.last_tip, Some(4));
}

#[tokio::test]
async fn poll_bounds_canonical_anchors_independently_of_replay_window() {
    let mut canned = mock_rpc::CannedResponses {
        tip: 1,
        ..Default::default()
    };
    for number in 1..=10 {
        canned.blocks.insert(
            number,
            mock_rpc::simple_block(number, &format!("0xblock{number}")),
        );
    }
    let (rpc_url, _handle, canned) = mock_rpc::start_mutable(canned).await;
    let rpc = RpcClient::new(rpc_url);
    let (tx, mut rx) = mpsc::channel(128);
    let mut state = PollState::default();

    let _ = poll_cycle_with_windows(&rpc, &mut state, &tx, &mut rx, 25, 10, 2).await;
    for tip in 2..=10 {
        canned.lock().unwrap().tip = tip;
        let _ = poll_cycle_with_windows(&rpc, &mut state, &tx, &mut rx, 25, 10, 2).await;
    }

    // Two exactly rollbackable blocks plus their common-parent proof.
    assert_eq!(state.canonical_hash(7), None);
    assert_eq!(state.canonical_hash(8), Some("0xblock8"));
    assert_eq!(state.canonical_hash(9), Some("0xblock9"));
    assert_eq!(state.canonical_hash(10), Some("0xblock10"));
}

#[tokio::test]
async fn poll_rebuilds_recent_window_when_reorg_is_deeper_than_retained_anchors() {
    let mut canned = mock_rpc::CannedResponses {
        tip: 1,
        ..Default::default()
    };
    for number in 1..=6 {
        canned.blocks.insert(
            number,
            mock_rpc::simple_block(number, &format!("0xblock{number}")),
        );
    }
    let (rpc_url, _handle, canned) = mock_rpc::start_mutable(canned).await;
    let rpc = RpcClient::new(rpc_url);
    let (tx, mut rx) = mpsc::channel(128);
    let mut state = PollState::default();

    let _ = poll_cycle_with(&rpc, &mut state, &tx, &mut rx, 25, 2).await;
    for tip in 2..=6 {
        canned.lock().unwrap().tip = tip;
        let _ = poll_cycle_with(&rpc, &mut state, &tx, &mut rx, 25, 2).await;
    }
    assert_eq!(state.canonical_hash(3), None);

    {
        let mut canned = canned.lock().unwrap();
        canned.blocks.insert(
            4,
            mock_rpc::simple_block_with_parent(4, "0xfork4", "0xblock3"),
        );
        canned.blocks.insert(
            5,
            mock_rpc::simple_block_with_parent(5, "0xfork5", "0xfork4"),
        );
        canned.blocks.insert(
            6,
            mock_rpc::simple_block_with_parent(6, "0xfork6", "0xfork5"),
        );
    }

    let rebuild = poll_cycle_with(&rpc, &mut state, &tx, &mut rx, 25, 2).await;
    let canonical: Vec<(u64, String)> = rebuild
        .iter()
        .filter_map(|mutation| match mutation {
            Mutation::ChainRebuild { from_block } => Some((*from_block, "rebuild".to_string())),
            Mutation::ChainReorganized { from_block } => Some((*from_block, "reorg".to_string())),
            Mutation::BlockMined { number, hash, .. } => Some((*number, hash.clone())),
            _ => None,
        })
        .collect();

    assert_eq!(
        canonical,
        vec![
            (5, "rebuild".to_string()),
            (5, "0xfork5".to_string()),
            (6, "0xfork6".to_string()),
        ]
    );
    assert!(rebuild.iter().any(|mutation| matches!(
        mutation,
        Mutation::BackfillProgress {
            done: 0,
            total: 2,
            active: true,
            phase: ReplayPhase::Rebuild
        }
    )));
    assert!(rebuild.iter().any(|mutation| matches!(
        mutation,
        Mutation::BackfillProgress {
            done: 2,
            total: 2,
            active: false,
            phase: ReplayPhase::Rebuild
        }
    )));
    assert_eq!(state.last_tip, Some(6));
    assert_eq!(state.canonical_hash(4), Some("0xfork4"));
    assert_eq!(state.canonical_hash(5), Some("0xfork5"));
    assert_eq!(state.canonical_hash(6), Some("0xfork6"));
}

#[tokio::test]
async fn interrupted_deep_rebuild_resumes_without_a_second_reset() {
    let mut canned = mock_rpc::CannedResponses {
        tip: 1,
        ..Default::default()
    };
    for number in 1..=6 {
        canned.blocks.insert(
            number,
            mock_rpc::simple_block(number, &format!("0xblock{number}")),
        );
    }
    let (rpc_url, _handle, canned) = mock_rpc::start_mutable(canned).await;
    let rpc = RpcClient::new(rpc_url);
    let (tx, mut rx) = mpsc::channel(128);
    let mut state = PollState::default();

    let _ = poll_cycle_with(&rpc, &mut state, &tx, &mut rx, 25, 2).await;
    for tip in 2..=6 {
        canned.lock().unwrap().tip = tip;
        let _ = poll_cycle_with(&rpc, &mut state, &tx, &mut rx, 25, 2).await;
    }
    {
        let mut canned = canned.lock().unwrap();
        canned.blocks.insert(
            4,
            mock_rpc::simple_block_with_parent(4, "0xfork4", "0xblock3"),
        );
        canned.blocks.insert(
            5,
            mock_rpc::simple_block_with_parent(5, "0xfork5", "0xfork4"),
        );
        canned.blocks.insert(
            6,
            mock_rpc::simple_block_with_parent(6, "0xfork6", "0xfork5"),
        );
        canned.unavailable_blocks.insert(6);
    }

    let partial = poll_cycle_with(&rpc, &mut state, &tx, &mut rx, 25, 2).await;
    assert_eq!(
        partial
            .iter()
            .filter(|mutation| matches!(mutation, Mutation::ChainRebuild { .. }))
            .count(),
        1
    );
    assert!(partial
        .iter()
        .any(|mutation| matches!(mutation, Mutation::BlockMined { number: 5, .. })));
    assert_eq!(state.last_tip, Some(5));

    canned.lock().unwrap().unavailable_blocks.remove(&6);
    let retry = poll_cycle_with(&rpc, &mut state, &tx, &mut rx, 25, 2).await;

    assert!(!retry
        .iter()
        .any(|mutation| matches!(mutation, Mutation::ChainRebuild { .. })));
    assert!(retry.iter().any(|mutation| matches!(
        mutation,
        Mutation::BackfillProgress {
            done: 0,
            total: 1,
            active: true,
            phase: ReplayPhase::Rebuild
        }
    )));
    assert!(retry
        .iter()
        .any(|mutation| matches!(mutation, Mutation::BlockMined { number: 6, .. })));
    assert_eq!(state.last_tip, Some(6));
}

#[tokio::test]
async fn interrupted_reorg_replay_is_never_capped_on_retry() {
    let mut canned = mock_rpc::CannedResponses {
        tip: 1,
        ..Default::default()
    };
    canned
        .blocks
        .insert(1, mock_rpc::simple_block(1, "0xblock1"));
    let (rpc_url, _handle, canned) = mock_rpc::start_mutable(canned).await;
    let rpc = RpcClient::new(rpc_url);
    let (tx, mut rx) = mpsc::channel(128);
    let mut state = PollState::default();

    let _ = poll_cycle_with(&rpc, &mut state, &tx, &mut rx, 25, 10).await;
    {
        let mut canned = canned.lock().unwrap();
        canned.tip = 6;
        for number in 2..=6 {
            canned.blocks.insert(
                number,
                mock_rpc::simple_block(number, &format!("0xblock{number}")),
            );
        }
    }
    let _ = poll_cycle_with(&rpc, &mut state, &tx, &mut rx, 25, 10).await;

    {
        let mut canned = canned.lock().unwrap();
        canned.blocks.insert(
            2,
            mock_rpc::simple_block_with_parent(2, "0xfork2", "0xblock1"),
        );
        canned.blocks.insert(
            3,
            mock_rpc::simple_block_with_parent(3, "0xfork3", "0xfork2"),
        );
        canned.blocks.insert(
            4,
            mock_rpc::simple_block_with_parent(4, "0xfork4", "0xfork3"),
        );
        canned.unavailable_blocks.insert(4);
        canned.blocks.insert(
            5,
            mock_rpc::simple_block_with_parent(5, "0xfork5", "0xfork4"),
        );
        canned.blocks.insert(
            6,
            mock_rpc::simple_block_with_parent(6, "0xfork6", "0xfork5"),
        );
    }
    let partial = poll_cycle_with(&rpc, &mut state, &tx, &mut rx, 2, 2).await;
    assert!(partial
        .iter()
        .any(|mutation| matches!(mutation, Mutation::ChainReorganized { from_block: 2 })));
    assert!(partial.iter().any(|mutation| matches!(
        mutation,
        Mutation::BackfillProgress {
            phase: ReplayPhase::Reorg,
            active: true,
            ..
        }
    )));
    assert_eq!(state.last_tip, Some(3));

    canned.lock().unwrap().unavailable_blocks.remove(&4);
    let retry = poll_cycle_with(&rpc, &mut state, &tx, &mut rx, 2, 2).await;
    let replayed: Vec<u64> = retry
        .iter()
        .filter_map(|mutation| match mutation {
            Mutation::BlockMined { number, .. } => Some(*number),
            _ => None,
        })
        .collect();

    assert_eq!(replayed, vec![4, 5, 6]);
    assert_eq!(state.last_tip, Some(6));
}

#[tokio::test]
async fn catchup_envelope_closes_when_parent_validation_fails() {
    let mut canned = mock_rpc::CannedResponses {
        tip: 4,
        ..Default::default()
    };
    canned
        .blocks
        .insert(1, mock_rpc::simple_block(1, "0xblock1"));
    canned.blocks.insert(
        2,
        mock_rpc::simple_block_with_parent(2, "0xblock2", "0xwrong-parent"),
    );
    let (rpc_url, _handle) = mock_rpc::start(canned).await;
    let rpc = RpcClient::new(rpc_url);
    let (tx, mut rx) = mpsc::channel(64);
    let mut state = PollState::default();
    state.last_tip = Some(1);
    state.seed_canonical([(1, "0xblock1".to_string())]);

    let error = poll_once(&rpc, &mut state, &tx, 1, 10)
        .await
        .expect_err("mixed-fork parent must fail");
    assert!(error.to_string().contains("parent mismatch"));

    let mut progress = Vec::new();
    while let Ok(mutation) = rx.try_recv() {
        if let Mutation::BackfillProgress {
            done,
            total,
            active,
            phase,
        } = mutation
        {
            progress.push((done, total, active, phase));
        }
    }
    assert_eq!(
        progress,
        vec![
            (0, 3, true, ReplayPhase::Catchup),
            (0, 3, false, ReplayPhase::Catchup)
        ]
    );
}

#[tokio::test]
async fn interrupted_catchup_keeps_its_phase_until_the_gap_completes() {
    let mut canned = mock_rpc::CannedResponses {
        tip: 5,
        ..Default::default()
    };
    for number in 1..=5 {
        canned.blocks.insert(
            number,
            mock_rpc::simple_block(number, &format!("0xblock{number}")),
        );
    }
    canned.unavailable_blocks.insert(4);
    let (rpc_url, _handle, canned) = mock_rpc::start_mutable(canned).await;
    let rpc = RpcClient::new(rpc_url);
    let (tx, mut rx) = mpsc::channel(64);
    let mut state = PollState::default();
    state.last_tip = Some(1);
    state.seed_canonical([(1, "0xblock1".to_string())]);

    let partial = poll_cycle_with(&rpc, &mut state, &tx, &mut rx, 1, 10).await;
    assert_eq!(state.last_tip, Some(3));
    assert!(partial.iter().any(|mutation| matches!(
        mutation,
        Mutation::BackfillProgress {
            done: 2,
            total: 4,
            active: true,
            phase: ReplayPhase::Catchup
        }
    )));

    canned.lock().unwrap().unavailable_blocks.remove(&4);
    // The remaining two-block gap is below this threshold. It must still use
    // the in-flight catch-up phase instead of silently switching to live mode.
    let completed = poll_cycle_with(&rpc, &mut state, &tx, &mut rx, 99, 10).await;
    assert!(completed.iter().any(|mutation| matches!(
        mutation,
        Mutation::BackfillProgress {
            done: 2,
            total: 2,
            active: false,
            phase: ReplayPhase::Catchup
        }
    )));
    assert_eq!(state.last_tip, Some(5));
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
    let mut canned = mock_rpc::CannedResponses {
        tip: 5,
        ..Default::default()
    };
    for n in 1..=5 {
        canned
            .blocks
            .insert(n, mock_rpc::simple_block(n, &format!("0xblock{n}")));
    }
    let (rpc_url, _handle) = mock_rpc::start(canned).await;

    let adapter = CkbDirectAdapter::new(rpc_url)
        .with_backfill_blocks(5)
        .with_poll_interval(Duration::from_millis(50));

    let emitted = drive_for(
        adapter,
        Duration::from_millis(400),
        Duration::from_millis(90),
    )
    .await;

    // Progress envelope opens active and closes inactive at done==total.
    assert!(
        emitted
            .iter()
            .any(|m| matches!(m, Mutation::BackfillProgress { active: true, .. })),
        "expected an active BackfillProgress; emitted: {emitted:#?}"
    );
    assert!(
        emitted.iter().any(|m| matches!(
            m,
            Mutation::BackfillProgress {
                done: 5,
                total: 5,
                active: false,
                phase: ReplayPhase::Boot
            }
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
    assert_eq!(
        nums,
        vec![1, 2, 3, 4, 5],
        "backfill emits ascending, once each; got {nums:?}"
    );
}

#[tokio::test]
async fn adapter_backfill_stops_at_first_visibility_gap_instead_of_skipping() {
    let mut canned = mock_rpc::CannedResponses {
        tip: 5,
        ..Default::default()
    };
    for number in 1..=5 {
        canned.blocks.insert(
            number,
            mock_rpc::simple_block(number, &format!("0xblock{number}")),
        );
    }
    canned.unavailable_blocks.insert(3);
    let (rpc_url, _handle) = mock_rpc::start(canned).await;

    let adapter = CkbDirectAdapter::new(rpc_url)
        .with_backfill_blocks(5)
        .with_poll_interval(Duration::from_millis(40));
    let emitted = drive_for(
        adapter,
        Duration::from_millis(250),
        Duration::from_millis(60),
    )
    .await;

    let numbers: Vec<u64> = emitted
        .iter()
        .filter_map(|mutation| match mutation {
            Mutation::BlockMined { number, .. } => Some(*number),
            _ => None,
        })
        .collect();
    assert_eq!(numbers, vec![1, 2]);
    assert!(emitted.iter().any(|mutation| matches!(
        mutation,
        Mutation::BackfillProgress {
            done: 2,
            total: 5,
            active: false,
            phase: ReplayPhase::Boot
        }
    )));
}

#[tokio::test]
async fn adapter_resume_skips_backfill_and_resumes_from_saved_tip() {
    let mut canned = mock_rpc::CannedResponses {
        tip: 10,
        ..Default::default()
    };
    // Only the gap blocks (saved_tip+1 ..= tip) should be polled forward.
    for n in 8..=10 {
        canned
            .blocks
            .insert(n, mock_rpc::simple_block(n, &format!("0xblock{n}")));
    }
    let (rpc_url, _handle) = mock_rpc::start(canned).await;

    let adapter = CkbDirectAdapter::new(rpc_url)
        .with_backfill_blocks(1000) // would normally backfill, but resume wins
        .with_resume_from(Some(8))
        .with_poll_interval(Duration::from_millis(40));

    let emitted = drive_for(
        adapter,
        Duration::from_millis(300),
        Duration::from_millis(70),
    )
    .await;

    // No backfill envelopes when resuming.
    assert!(
        !emitted
            .iter()
            .any(|m| matches!(m, Mutation::BackfillProgress { .. })),
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
    assert_eq!(
        nums,
        vec![9, 10],
        "resume polls forward from saved tip; got {nums:?}"
    );
}

#[tokio::test]
async fn adapter_resume_large_gap_runs_catchup_envelope() {
    // Saved tip 8, node now at 12 → gap 4. With threshold 2 (< gap) the poll
    // takes the catch-up branch: a BackfillProgress envelope brackets the
    // window, blocks 9..=12 replay ascending, and last_tip jumps to 12.
    let mut canned = mock_rpc::CannedResponses {
        tip: 12,
        ..Default::default()
    };
    // Include the saved canonical anchor (8) so the first resumed poll can
    // validate that the persisted cursor is still on the node's main chain.
    for n in 8..=12 {
        canned
            .blocks
            .insert(n, mock_rpc::simple_block(n, &format!("0xblock{n}")));
    }
    let (rpc_url, _handle) = mock_rpc::start(canned).await;

    let adapter = CkbDirectAdapter::new(rpc_url)
        .with_backfill_blocks(1000) // catch-up cap; far above the gap → lo = 9
        .with_catchup_threshold(2)
        .with_resume_from(Some(8))
        .with_poll_interval(Duration::from_millis(40));

    let emitted = drive_for(
        adapter,
        Duration::from_millis(300),
        Duration::from_millis(70),
    )
    .await;

    // Envelope opens active and closes inactive at done==total==4.
    assert!(
        emitted
            .iter()
            .any(|m| matches!(m, Mutation::BackfillProgress { active: true, .. })),
        "expected an active BackfillProgress on a large-gap resume; emitted: {emitted:#?}"
    );
    assert!(
        emitted.iter().any(|m| matches!(
            m,
            Mutation::BackfillProgress {
                done: 4,
                total: 4,
                active: false,
                phase: ReplayPhase::Catchup
            }
        )),
        "expected a terminal BackfillProgress; emitted: {emitted:#?}"
    );
    // Catch-up replays the gap window ascending, once each; last_tip jumps to
    // 12 so the forward poll does not re-emit it.
    let nums: Vec<u64> = emitted
        .iter()
        .filter_map(|m| match m {
            Mutation::BlockMined { number, .. } => Some(*number),
            _ => None,
        })
        .collect();
    assert_eq!(
        nums,
        vec![9, 10, 11, 12],
        "catch-up replays the gap window ascending; got {nums:?}"
    );

    // A catch-up can replay thousands of blocks in milliseconds. Its mutation
    // timestamps must come from each block header, not from the local replay
    // loop, or the chain cadence collapses to ~0ms and the HUD stays STALLED.
    let replayed_times: Vec<(u64, u64)> = emitted
        .iter()
        .filter_map(|m| match m {
            Mutation::BlockMined { number, at, .. } => Some((*number, *at)),
            _ => None,
        })
        .collect();
    assert_eq!(
        replayed_times,
        (9..=12)
            .map(|number| (number, 1_700_000_000_000 + number * 8_000))
            .collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn adapter_polls_network_and_emits_peer_sync_and_node_info() {
    // Drive the real adapter loop (which owns the network-poll select arm)
    // against canned get_peers / sync_state / local_node_info responses.
    // Going through `run()` exercises the wiring end-to-end; `poll_network_once`
    // and the `network` module are `pub(crate)`, so a direct call isn't even
    // reachable from an integration test — the full loop is the right seam.
    let canned = mock_rpc::CannedResponses {
        peers: json!([
            {
                "node_id": "QmPeerX",
                "version": "0.116.1",
                "is_outbound": true,
                "addresses": [
                    { "address": "/ip4/1.2.3.4/tcp/8115", "score": "0x64" }
                ],
                "last_ping_duration": "0x1f",
                "connected_duration": "0x3e8",
                "sync_state": { "best_known_header_number": "0x64" }
            }
        ]),
        sync_state: json!({ "ibd": false, "best_known_block_number": "0x64" }),
        node_version: "0.116.1".to_string(),
        node_connections: 0x8,
        ..Default::default()
    };
    let (rpc_url, _handle) = mock_rpc::start(canned).await;

    let adapter = CkbDirectAdapter::new(rpc_url)
        .with_node("ckb:test", "ckb-test")
        .with_backfill_blocks(0)
        .with_poll_interval(Duration::from_millis(40))
        .with_network_poll_interval(Duration::from_millis(30));

    let emitted = drive_for(
        adapter,
        Duration::from_millis(300),
        Duration::from_millis(60),
    )
    .await;

    // PeersUpdated: one outbound peer with a decoded latency (0x1f == 31ms).
    assert!(
        emitted.iter().any(|m| matches!(
            m,
            Mutation::PeersUpdated { peers }
                if peers.len() == 1
                    && peers[0].node_id == "QmPeerX"
                    && peers[0].direction == PeerDirection::Outbound
                    && peers[0].addr == "1.2.3.4:8115"
                    && peers[0].latency_ms == Some(31)
                    && peers[0].best_known == Some(100)
        )),
        "PeersUpdated not emitted with the expected peer; emitted: {emitted:#?}"
    );

    // ChainSyncUpdated: ibd false, best_known_block 0x64 == 100.
    assert!(
        emitted.iter().any(|m| matches!(
            m,
            Mutation::ChainSyncUpdated {
                ibd: false,
                best_known_block: 100
            }
        )),
        "ChainSyncUpdated not emitted with ibd=false/best=100; emitted: {emitted:#?}"
    );

    // ChainNodeInfoUpdated: id == adapter node id, version, connections 0x8 == 8.
    assert!(
        emitted.iter().any(|m| matches!(
            m,
            Mutation::ChainNodeInfoUpdated { id, version, connections: 8 }
                if id == "ckb:test" && version == "0.116.1"
        )),
        "ChainNodeInfoUpdated not emitted with id/version/connections; emitted: {emitted:#?}"
    );
}
