//! WebSocket frame protocol for the entities + projection streams.
//!
//! Lifted verbatim from `simulator/src/dashboard/routes.rs`
//! (`handle_entities_ws`, `handle_projection_ws`, plus the shared
//! `decide_action` helper). The frame shape is the contract consumed by
//! `@cknerv/cache` in PR B5; do not drift.
//!
//! Frame kinds (entity stream):
//!   * `{"kind":"snapshot", "revision":N, "entities": <chain snap>}`
//!   * `{"kind":"delta", "revision":N, "mutations": [RevisionedMutation, ...]}`
//!   * `{"kind":"lagged", "skipped":N, "revision":lastSent}`
//!   * `{"kind":"heartbeat", "revision":lastSent}`
//!
//! Frame kinds (projection stream):
//!   * `{"kind":"snapshot", "revision":N, "snapshot": <projection snap>}`
//!   * `{"kind":"delta", "revision":N, "deltas":[{"revision":N,"delta":V}, ...]}`
//!   * `{"kind":"lagged", "skipped":N}`
//!   * `{"kind":"heartbeat", "revision":lastSent}`
//!
//! Catch-up policy:
//!   1. Subscribe FIRST so any mutation emitted while we read the ring
//!      lands in our buffer rather than being dropped.
//!   2. Snapshot the ring; pick `FullSnapshot` / `ReplayDelta` /
//!      `NothingToReplay` per [`decide_action`].
//!   3. Live loop dedupes against `last_sent_*` so the racy ring/broadcast
//!      boundary doesn't produce double-sent frames.

use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket};
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::watch;
use tokio::time::{self, Instant, MissedTickBehavior};

use cknerv_core::RevisionedMutation;

use crate::projection_registry::{DeltaEntry, ProjectionRuntime, SnapshotEnvelope};
use crate::state::ServerState;

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);

fn heartbeat_interval() -> time::Interval {
    let mut interval = time::interval_at(Instant::now() + HEARTBEAT_INTERVAL, HEARTBEAT_INTERVAL);
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    interval
}

fn heartbeat_frame(revision: u64) -> serde_json::Value {
    serde_json::json!({
        "kind": "heartbeat",
        "revision": revision,
    })
}

/// Block until `rx` observes `true`. Used by long-lived WS handlers in
/// `select!` to break out of their main recv loop on shutdown signal.
pub async fn wait_for_shutdown(rx: &mut watch::Receiver<bool>) {
    if *rx.borrow() {
        return;
    }
    while rx.changed().await.is_ok() {
        if *rx.borrow() {
            return;
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum StreamAction {
    /// Send a full `snapshot` frame; client replaces local cache.
    FullSnapshot,
    /// Send a `delta` frame containing ring entries with revision > since.
    ReplayDelta,
    /// No catch-up needed (`since` is at or past the ring's tail).
    NothingToReplay,
}

fn decide_action(since: u64, ring_first: Option<u64>, ring_last: Option<u64>) -> StreamAction {
    match (ring_first, ring_last) {
        (None, _) | (_, None) => {
            // Empty ring. If the client has nothing yet (since=0) and the
            // server has emitted no mutations, we're trivially in sync —
            // the snapshot is empty and there's nothing to replay.
            // Otherwise the only way to recover is a full snapshot.
            if since == 0 {
                StreamAction::NothingToReplay
            } else {
                StreamAction::FullSnapshot
            }
        }
        (Some(first), Some(last)) => {
            if since >= last {
                StreamAction::NothingToReplay
            } else if since + 1 >= first {
                // The next revision the client needs is in the ring.
                StreamAction::ReplayDelta
            } else {
                StreamAction::FullSnapshot
            }
        }
    }
}

pub async fn handle_chain_stream(
    state: Arc<ServerState>,
    mut socket: WebSocket,
    since: Option<u64>,
    mut shutdown: watch::Receiver<bool>,
) {
    let since = since.unwrap_or(0);
    if *shutdown.borrow() {
        return;
    }
    // Subscribe BEFORE the ring snapshot so any mutation emitted while
    // we read the ring lands in our rx queue.
    let mut rx = state.subscribe_mutations();
    let ring_snapshot = {
        let _coord = state.coord.read().unwrap();
        state.mutation_ring_snapshot()
    };

    let ring_first = ring_snapshot.first().map(|r| r.revision);
    let ring_last = ring_snapshot.last().map(|r| r.revision);

    let mut last_sent_revision = since;
    let action = decide_action(since, ring_first, ring_last);

    match action {
        StreamAction::FullSnapshot => {
            let snap = state.snapshot();
            let revision = snap.get("revision").and_then(|v| v.as_u64()).unwrap_or(0);
            let frame = serde_json::json!({
                "kind": "snapshot",
                "revision": revision,
                "entities": {
                    "chain": snap.get("chain").cloned().unwrap_or(serde_json::Value::Null),
                    "chain_nodes": snap.get("chain_nodes").cloned()
                        .unwrap_or(serde_json::Value::Array(vec![])),
                    "peers": snap.get("peers").cloned()
                        .unwrap_or(serde_json::Value::Array(vec![])),
                },
            });
            last_sent_revision = revision;
            if socket.send(Message::Text(frame.to_string())).await.is_err() {
                return;
            }
        }
        StreamAction::ReplayDelta => {
            let mutations: Vec<&RevisionedMutation> = ring_snapshot
                .iter()
                .map(|r| r.as_ref())
                .filter(|r| r.revision > since)
                .collect();
            if let Some(last) = mutations.last() {
                last_sent_revision = last.revision;
            }
            if !mutations.is_empty() {
                let frame = serde_json::json!({
                    "kind": "delta",
                    "revision": last_sent_revision,
                    "mutations": mutations,
                });
                if socket.send(Message::Text(frame.to_string())).await.is_err() {
                    return;
                }
            }
        }
        StreamAction::NothingToReplay => {}
    }

    // Live loop with dedupe. Application heartbeats let browser clients
    // distinguish a quiet chain from a half-open transport.
    let mut heartbeat = heartbeat_interval();
    loop {
        tokio::select! {
            _ = wait_for_shutdown(&mut shutdown) => break,
            _ = heartbeat.tick() => {
                let frame = heartbeat_frame(last_sent_revision);
                if socket.send(Message::Text(frame.to_string())).await.is_err() {
                    break;
                }
            }
            recv = rx.recv() => match recv {
                Ok(rev) => {
                    if rev.revision <= last_sent_revision {
                        continue;
                    }
                    last_sent_revision = rev.revision;
                    let frame = serde_json::json!({
                        "kind": "delta",
                        "revision": rev.revision,
                        "mutations": [rev.as_ref()],
                    });
                    if socket.send(Message::Text(frame.to_string())).await.is_err() {
                        break;
                    }
                }
                Err(RecvError::Lagged(n)) => {
                    let frame = serde_json::json!({
                        "kind": "lagged",
                        "skipped": n,
                        "revision": last_sent_revision,
                    });
                    if socket.send(Message::Text(frame.to_string())).await.is_err() {
                        break;
                    }
                    // Don't close on lag — the client sees the lagged
                    // marker, decides what to do, and may reconnect
                    // with a fresh `since`.
                }
                Err(RecvError::Closed) => break,
            }
        }
    }
}

pub async fn handle_projection_stream(
    runner: Arc<dyn ProjectionRuntime>,
    mut socket: WebSocket,
    since: Option<u64>,
    binary_snapshot: bool,
    mut shutdown: watch::Receiver<bool>,
) {
    let since = since.unwrap_or(0);
    if *shutdown.borrow() {
        return;
    }
    // Protocol mirrors the entities stream but the cursor is per-delta
    // `seq` internally — multiple deltas can share `rev` (one mutation
    // triggering both a birth + a tag) so we dedup on seq while still
    // exposing rev to the client.
    let mut rx = runner.subscribe();
    let ring_snapshot = runner.delta_ring_snapshot();

    let ring_first = ring_snapshot.first().map(|d| d.rev);
    let ring_last = ring_snapshot.last().map(|d| d.rev);

    let mut last_sent_seq: u64 = 0;
    let mut last_sent_revision = since;
    let action = decide_action(since, ring_first, ring_last);

    match action {
        StreamAction::FullSnapshot => {
            // A resync at this size is the one frame worth sending as
            // bytes: the columnar form is half the payload and skips the
            // client's parse entirely. Only for clients that asked —
            // `kind` lives in the JSON envelope, so a binary frame is
            // self-describing only to a reader expecting one.
            let binary = if binary_snapshot {
                runner.snapshot_bin()
            } else {
                None
            };
            let sent = match binary {
                Some((rev, bytes)) => {
                    last_sent_revision = rev;
                    socket.send(Message::Binary(bytes.to_vec())).await
                }
                None => {
                    // The runtime hands back the finished frame text, so a
                    // large snapshot is serialized once instead of once
                    // into a `Value` and again out of it.
                    let (rev, frame) = runner.snapshot_envelope(SnapshotEnvelope::Frame);
                    last_sent_revision = rev;
                    // One copy to satisfy `Message::Text`'s owned `String`;
                    // the expensive half is what the runtime cached.
                    let frame = String::from_utf8(frame.to_vec()).expect("snapshot frame is UTF-8");
                    socket.send(Message::Text(frame)).await
                }
            };
            if sent.is_err() {
                return;
            }
            let rev = last_sent_revision;
            // After a full snapshot the client's effective revision is
            // `rev`. Drop any stream entries with rev <= rev (their
            // effects are already in the snapshot).
            for d in &ring_snapshot {
                if d.rev <= rev && d.seq > last_sent_seq {
                    last_sent_seq = d.seq;
                }
            }
        }
        StreamAction::ReplayDelta => {
            let deltas: Vec<&DeltaEntry> = ring_snapshot
                .iter()
                .map(|d| d.as_ref())
                .filter(|d| d.rev > since)
                .collect();
            if let Some(last) = deltas.last() {
                last_sent_seq = last.seq;
                last_sent_revision = last.rev;
            }
            if !deltas.is_empty() {
                let payload: Vec<serde_json::Value> = deltas
                    .iter()
                    .map(|d| serde_json::json!({ "revision": d.rev, "delta": d.value }))
                    .collect();
                let last_rev = deltas.last().unwrap().rev;
                let frame = serde_json::json!({
                    "kind": "delta",
                    "revision": last_rev,
                    "deltas": payload,
                });
                if socket.send(Message::Text(frame.to_string())).await.is_err() {
                    return;
                }
            }
        }
        StreamAction::NothingToReplay => {
            // Set last_sent_seq to the ring's tail so we skip entries
            // already in the ring (the client implicitly has them via
            // `since`).
            if let Some(last) = ring_snapshot.last() {
                last_sent_seq = last.seq;
            }
        }
    }

    let mut heartbeat = heartbeat_interval();
    loop {
        tokio::select! {
            _ = wait_for_shutdown(&mut shutdown) => break,
            _ = heartbeat.tick() => {
                let frame = heartbeat_frame(last_sent_revision);
                if socket.send(Message::Text(frame.to_string())).await.is_err() {
                    break;
                }
            }
            recv = rx.recv() => match recv {
                Ok(entry) => {
                    if entry.seq <= last_sent_seq {
                        continue;
                    }
                    last_sent_seq = entry.seq;
                    last_sent_revision = entry.rev;
                    let frame = serde_json::json!({
                        "kind": "delta",
                        "revision": entry.rev,
                        "deltas": [{ "revision": entry.rev, "delta": entry.value }],
                    });
                    if socket.send(Message::Text(frame.to_string())).await.is_err() {
                        break;
                    }
                }
                Err(RecvError::Lagged(n)) => {
                    let frame = serde_json::json!({ "kind": "lagged", "skipped": n });
                    if socket.send(Message::Text(frame.to_string())).await.is_err() {
                        break;
                    }
                }
                Err(RecvError::Closed) => break,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cknerv_core::{Mutation, Peer, PeerDirection};
    use std::sync::Arc;

    #[test]
    fn snapshot_frame_includes_peers() {
        let state = Arc::new(crate::state::ServerState::new());
        state.apply_mutation(Mutation::PeersUpdated {
            peers: vec![Peer {
                node_id: "QmA".into(),
                addr: "1.2.3.4:8115".into(),
                direction: PeerDirection::Outbound,
                version: "0.116.1".into(),
                latency_ms: Some(20),
                best_known: Some(50),
                connected_ms: 1000,
            }],
        });
        // Reproduce the FullSnapshot frame body the handler builds.
        let snap = state.snapshot();
        let frame = serde_json::json!({
            "kind": "snapshot",
            "revision": snap.get("revision").and_then(|v| v.as_u64()).unwrap_or(0),
            "entities": {
                "chain": snap.get("chain").cloned().unwrap_or(serde_json::Value::Null),
                "chain_nodes": snap.get("chain_nodes").cloned()
                    .unwrap_or(serde_json::Value::Array(vec![])),
                "peers": snap.get("peers").cloned()
                    .unwrap_or(serde_json::Value::Array(vec![])),
            },
        });
        assert_eq!(frame["entities"]["peers"][0]["node_id"], "QmA");
    }

    #[test]
    fn decide_action_empty_ring_fresh_client() {
        assert_eq!(decide_action(0, None, None), StreamAction::NothingToReplay);
    }

    #[test]
    fn heartbeat_reports_the_last_confirmed_revision() {
        assert_eq!(
            heartbeat_frame(42),
            serde_json::json!({ "kind": "heartbeat", "revision": 42 })
        );
    }

    #[test]
    fn decide_action_empty_ring_stale_client() {
        assert_eq!(decide_action(5, None, None), StreamAction::FullSnapshot);
    }

    #[test]
    fn decide_action_caught_up() {
        assert_eq!(
            decide_action(10, Some(1), Some(10)),
            StreamAction::NothingToReplay
        );
    }

    #[test]
    fn decide_action_replayable() {
        assert_eq!(
            decide_action(5, Some(1), Some(10)),
            StreamAction::ReplayDelta
        );
    }

    #[test]
    fn decide_action_gap_too_wide() {
        assert_eq!(
            decide_action(5, Some(100), Some(200)),
            StreamAction::FullSnapshot
        );
    }
}
