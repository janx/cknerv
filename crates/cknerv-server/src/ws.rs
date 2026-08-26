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
//!   2. Snapshot the ring, read the current revision beside it; pick
//!      `FullSnapshot` / `ReplayDelta` / `NothingToReplay` per
//!      [`decide_action`]. A `since` past the current revision belongs to a
//!      previous life of this process and is always snapshotted.
//!   3. Live loop dedupes against `last_sent_*` so the racy ring/broadcast
//!      boundary doesn't produce double-sent frames.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket};
use serde_json::value::RawValue;
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::watch;
use tokio::time::{self, Instant, MissedTickBehavior};

use crate::projection_registry::{DeltaEntry, ProjectionRuntime, SnapshotEnvelope};
use crate::state::{ServerState, SharedMutationEntry};

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

/// The entity stream's full-snapshot body, lifted out of the handler so the
/// shared `ws_frames.json` fixture pins the frame that actually goes out
/// rather than a restatement of it.
fn entity_snapshot_frame(snap: &serde_json::Value) -> (u64, serde_json::Value) {
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
    (revision, frame)
}

/// The entity stream carries `revision` on its lag marker so a client can
/// resume from the last frame it did receive; the projection stream's marker
/// below deliberately does not (its cursor is the per-delta seq).
fn entity_lagged_frame(skipped: u64, revision: u64) -> serde_json::Value {
    serde_json::json!({
        "kind": "lagged",
        "skipped": skipped,
        "revision": revision,
    })
}

fn projection_lagged_frame(skipped: u64) -> serde_json::Value {
    serde_json::json!({ "kind": "lagged", "skipped": skipped })
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

/// Longest gap the reconnect path will replay as one delta frame. A
/// display/link delta can carry hundreds of cell payloads, so a `since`
/// far enough below the ring tail (an overnight tab) once meant a single
/// tens-of-MB Text frame — dwarfing the cached columnar snapshot it was
/// trying to avoid. Past this many pending entries the snapshot is
/// strictly cheaper for both sides.
///
/// This is the ONLY thing that reads ring depth in production, which makes
/// it the budget both replay rings are sized from:
/// [`crate::state::MUTATION_RING_CAP`] and
/// [`crate::projection_registry::PROJECTION_DELTA_RING_CAP`] are each two
/// of these. Raising it therefore costs retained memory in two places;
/// raising a ring cap without raising this buys nothing, because entries
/// deeper than this budget can never appear in any frame.
pub(crate) const REPLAY_MAX_ENTRIES: usize = 2048;

/// Pick the catch-up action for a client arriving with `since`.
///
/// `current` is the newest revision this server has assigned, and it is NOT
/// the ring tail. The two differ routinely: a mutation the entity wire hides
/// (`Mutation::entity_wire_visible`) and a mutation a projection had no delta
/// for both consume a revision without leaving a ring entry, so a perfectly
/// caught-up client's cursor normally sits ABOVE `ring_last` — which is why
/// the ring arms below still treat `since >= last` as quiet.
///
/// A cursor past `current` is the one thing this process cannot have issued.
/// A restart closes every socket, so a tab holding such a cursor was talking
/// to a PREVIOUS life of the server, whose revisions this one has reset or is
/// re-issuing. Replaying from it would splice two timelines together (or,
/// worse, say nothing at all and leave the tab frozen with a green HUD), so
/// the client is handed the present as a full snapshot instead.
fn decide_action(
    since: u64,
    current: u64,
    ring_first: Option<u64>,
    ring_last: Option<u64>,
    pending: usize,
) -> StreamAction {
    if since > current {
        return StreamAction::FullSnapshot;
    }
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
            } else if since + 1 >= first && pending <= REPLAY_MAX_ENTRIES {
                // The next revision the client needs is in the ring AND the
                // gap is small enough that a delta frame beats a snapshot.
                StreamAction::ReplayDelta
            } else {
                StreamAction::FullSnapshot
            }
        }
    }
}

/// Borrowing frame bodies for the delta streams. The payloads they carry
/// were serialized once, upstream — a projection delta when the reducer
/// emitted it, a mutation on its first send — so building a frame is
/// concatenation: no tree walk, no copy of the payload, however many
/// clients are attached and however deep a reconnect replays.
///
/// The only thing serialized per frame is the envelope around them, which
/// is where the field order below comes from. Do not swap these back for
/// `json!`: that macro takes `to_value` of everything handed to it, which
/// re-parses a `RawValue` into the very tree this path exists to avoid.
#[derive(serde::Serialize)]
struct ProjectionReplayEntry<'a> {
    revision: u64,
    delta: &'a RawValue,
}

#[derive(serde::Serialize)]
struct ProjectionDeltaFrame<'a> {
    kind: &'static str,
    revision: u64,
    deltas: Vec<ProjectionReplayEntry<'a>>,
}

#[derive(serde::Serialize)]
struct EntityDeltaFrame<'a> {
    kind: &'static str,
    revision: u64,
    mutations: Vec<&'a RawValue>,
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
    // The coord read lock is what makes (revision, ring) one observation:
    // `apply_mutation` holds the write side across the bump and the push, so
    // the revision read here can never be older than the ring beside it.
    let (current_revision, ring_snapshot) = {
        let _coord = state.coord.read().unwrap();
        (
            state.revision.load(Ordering::Relaxed),
            state.mutation_ring_snapshot(),
        )
    };

    let ring_first = ring_snapshot.first().map(|r| r.revision);
    let ring_last = ring_snapshot.last().map(|r| r.revision);
    let pending = ring_snapshot.iter().filter(|r| r.revision > since).count();

    let mut last_sent_revision = since;
    let action = decide_action(since, current_revision, ring_first, ring_last, pending);

    match action {
        StreamAction::FullSnapshot => {
            let (revision, frame) = entity_snapshot_frame(&state.snapshot());
            last_sent_revision = revision;
            if socket.send(Message::Text(frame.to_string())).await.is_err() {
                return;
            }
        }
        StreamAction::ReplayDelta => {
            let pending: Vec<&SharedMutationEntry> = ring_snapshot
                .iter()
                .map(|r| r.as_ref())
                .filter(|r| r.revision > since)
                .collect();
            if let Some(last) = pending.last() {
                last_sent_revision = last.revision;
            }
            if !pending.is_empty() {
                let frame = EntityDeltaFrame {
                    kind: "delta",
                    revision: last_sent_revision,
                    mutations: pending.iter().map(|r| r.serialized()).collect(),
                };
                let text = serde_json::to_string(&frame).expect("replay frame is JSON");
                if socket.send(Message::Text(text)).await.is_err() {
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
                    let frame = EntityDeltaFrame {
                        kind: "delta",
                        revision: rev.revision,
                        mutations: vec![rev.serialized()],
                    };
                    let text = serde_json::to_string(&frame).expect("delta frame is JSON");
                    if socket.send(Message::Text(text)).await.is_err() {
                        break;
                    }
                }
                Err(RecvError::Lagged(n)) => {
                    let frame = entity_lagged_frame(n, last_sent_revision);
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
    // Read AFTER the ring: `apply` stores the revision before it pushes the
    // deltas, so this ordering is the one that cannot observe a ring tail
    // ahead of the revision and mistake a caught-up client for a foreign one.
    let current_revision = runner.revision();

    let ring_first = ring_snapshot.first().map(|d| d.rev);
    let ring_last = ring_snapshot.last().map(|d| d.rev);
    let pending = ring_snapshot.iter().filter(|d| d.rev > since).count();

    let mut last_sent_seq: u64 = 0;
    let mut last_sent_revision = since;
    let action = decide_action(since, current_revision, ring_first, ring_last, pending);

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
                let frame = ProjectionDeltaFrame {
                    kind: "delta",
                    revision: last_sent_revision,
                    deltas: deltas
                        .iter()
                        .map(|d| ProjectionReplayEntry {
                            revision: d.rev,
                            delta: &d.value,
                        })
                        .collect(),
                };
                let text = serde_json::to_string(&frame).expect("replay frame is JSON");
                if socket.send(Message::Text(text)).await.is_err() {
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
                    let frame = ProjectionDeltaFrame {
                        kind: "delta",
                        revision: entry.rev,
                        deltas: vec![ProjectionReplayEntry {
                            revision: entry.rev,
                            delta: &entry.value,
                        }],
                    };
                    let text = serde_json::to_string(&frame).expect("delta frame is JSON");
                    if socket.send(Message::Text(text)).await.is_err() {
                        break;
                    }
                }
                Err(RecvError::Lagged(n)) => {
                    let frame = projection_lagged_frame(n);
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
    use cknerv_core::{CellDelta, Mutation, Peer, PeerDirection, RevisionedMutation};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    /// A projection standing in for the production ones, so the envelope the
    /// fixture pins comes out of the real registry path. Only the ENVELOPE is
    /// this fixture's subject — the payloads inside it are pinned by
    /// `cell_delta_samples.json` and the snapshot fixtures.
    struct FrameFixtureProjection;

    impl cknerv_core::Projection for FrameFixtureProjection {
        type Snapshot = serde_json::Value;
        type Delta = CellDelta;

        fn name(&self) -> &'static str {
            "frames"
        }

        fn snapshot(&self) -> serde_json::Value {
            serde_json::json!({ "cells": [], "last_pulse_at_ms": 1_700_000_006_000u64 })
        }

        fn apply_mutation(&mut self, _m: &Mutation) -> Vec<CellDelta> {
            vec![CellDelta::Pulse {
                at_ms: 1_700_000_006_000,
            }]
        }
    }

    /// Every frame envelope both streams can send, written from the real
    /// frame types so a reshaped envelope lands in the file and the TS
    /// connectors' twin (`streamConnectors.test.ts`) fails on it.
    ///
    /// Regenerate with
    /// `CKNERV_REGEN_FIXTURES=1 cargo test -p cknerv-server ws_frame_envelopes`.
    #[test]
    fn ws_frame_envelopes_are_authored_by_the_senders() {
        let state = crate::state::ServerState::new();
        state.apply_mutation(Mutation::BlockMined {
            number: 100,
            hash: "0xblock100".into(),
            tx_count: 2,
            size: 1_024,
            at: 1_700_000_000_000,
            producer_key: None,
            producer_message: None,
        });
        let mutation = state
            .mutation_ring_snapshot()
            .pop()
            .expect("the ring kept the mutation");
        let (_, entity_snapshot) = entity_snapshot_frame(&state.snapshot());
        let entity_delta = EntityDeltaFrame {
            kind: "delta",
            revision: mutation.revision,
            mutations: vec![mutation.serialized()],
        };

        let mut registry = crate::projection_registry::Registry::new();
        registry.register(FrameFixtureProjection);
        let runtime = registry.lookup("frames").expect("frames runtime");
        let writer = registry
            .writers()
            .into_iter()
            .next()
            .expect("frames writer");
        writer.apply(&RevisionedMutation {
            revision: 1,
            mutation: Mutation::ChainReorganized { from_block: 1 },
        });
        let (_, projection_snapshot) = runtime.snapshot_envelope(SnapshotEnvelope::Frame);
        let ring = runtime.delta_ring_snapshot();
        let projection_delta = ProjectionDeltaFrame {
            kind: "delta",
            revision: ring[0].rev,
            deltas: ring
                .iter()
                .map(|d| ProjectionReplayEntry {
                    revision: d.rev,
                    delta: &d.value,
                })
                .collect(),
        };

        let frames = serde_json::json!({
            "entity": {
                "snapshot": entity_snapshot,
                "delta": serde_json::to_value(&entity_delta).expect("entity delta frame"),
                "lagged": entity_lagged_frame(12, mutation.revision),
                "heartbeat": heartbeat_frame(mutation.revision),
            },
            "projection": {
                "snapshot": serde_json::from_slice::<serde_json::Value>(&projection_snapshot)
                    .expect("projection snapshot frame is JSON"),
                "delta": serde_json::to_value(&projection_delta)
                    .expect("projection delta frame"),
                "lagged": projection_lagged_frame(34),
                "heartbeat": heartbeat_frame(ring[0].rev),
            },
        });

        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/ws_frames.json");
        let mut encoded = serde_json::to_string_pretty(&frames).expect("serialize frames");
        encoded.push('\n');
        if std::env::var("CKNERV_REGEN_FIXTURES").is_ok() {
            std::fs::write(&path, &encoded).expect("write ws_frames.json");
        }
        let committed = std::fs::read_to_string(&path).expect("read ws_frames.json");
        assert_eq!(
            encoded, committed,
            "ws_frames.json drifted from the frames these handlers send; regenerate \
             with CKNERV_REGEN_FIXTURES=1 cargo test -p cknerv-server ws_frame_envelopes \
             and run the TS connectors test in the same change"
        );
    }

    /// The client arms its stale watchdog at `STREAM_STALE_AFTER_MS`
    /// (`ui-app/src/App.tsx`), which must clear at least three heartbeats —
    /// one lost frame on a healthy link cannot be allowed to read as death.
    /// The twin assert lives in `ui-app/__tests__/runtime-config.test.ts`.
    #[test]
    fn heartbeat_leaves_the_client_watchdog_three_beats_of_slack() {
        assert_eq!(HEARTBEAT_INTERVAL.as_secs(), 5);
    }

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
        let (_, frame) = entity_snapshot_frame(&state.snapshot());
        assert_eq!(frame["entities"]["peers"][0]["node_id"], "QmA");
    }

    #[test]
    fn decide_action_empty_ring_fresh_client() {
        assert_eq!(
            decide_action(0, 0, None, None, 0),
            StreamAction::NothingToReplay
        );
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
        // A backfill cleared the ring under a server that has long since
        // passed revision 5: nothing to replay from, so resnap.
        assert_eq!(
            decide_action(5, 12, None, None, 0),
            StreamAction::FullSnapshot
        );
    }

    #[test]
    fn decide_action_caught_up() {
        assert_eq!(
            decide_action(10, 10, Some(1), Some(10), 0),
            StreamAction::NothingToReplay
        );
    }

    /// The cursor of a caught-up client normally sits ABOVE the ring tail:
    /// revisions are consumed by mutations the entity wire hides and by
    /// mutations a projection emitted no delta for, and neither leaves a ring
    /// entry. Treating "past the ring tail" as evidence of a foreign timeline
    /// would hand a resync — for the cells projection, several megabytes of
    /// columnar snapshot — to every ordinary reconnect on a quiet chain.
    #[test]
    fn decide_action_a_caught_up_client_above_a_sparse_ring_stays_quiet() {
        assert_eq!(
            decide_action(1_000, 1_000, Some(1), Some(950), 0),
            StreamAction::NothingToReplay
        );
    }

    /// The deploy cliff: the tab held revision 50_000 from the server life
    /// that just exited, and the one that replaced it is at 12. Silence here
    /// used to freeze the tab's HUD at a dead tip while the transport read
    /// perfectly healthy.
    #[test]
    fn decide_action_a_cursor_from_a_previous_server_life_is_snapshotted() {
        assert_eq!(
            decide_action(50_000, 12, Some(1), Some(12), 0),
            StreamAction::FullSnapshot
        );
        // Same client, arriving before the new process has applied anything.
        assert_eq!(
            decide_action(50_000, 0, None, None, 0),
            StreamAction::FullSnapshot
        );
    }

    #[test]
    fn decide_action_replayable() {
        assert_eq!(
            decide_action(5, 10, Some(1), Some(10), 5),
            StreamAction::ReplayDelta
        );
    }

    #[test]
    fn decide_action_gap_too_wide() {
        assert_eq!(
            decide_action(5, 200, Some(100), Some(200), 100),
            StreamAction::FullSnapshot
        );
    }

    /// The rings exist to serve `decide_action`, and nothing else in
    /// production reads their depth. So the two caps are not independent
    /// numbers to be tuned — they are this budget, doubled. The disease
    /// this pins against is the one that produced them: `REPLAY_MAX_ENTRIES`
    /// was introduced long after `MUTATION_RING_CAP` /
    /// `PROJECTION_DELTA_RING_CAP` were set at 50_000, and nobody went back
    /// to re-derive them, so 47,952 slots per ring held entries that no
    /// frame could ever carry.
    #[test]
    fn the_rings_are_sized_from_the_replay_budget_they_serve() {
        assert_eq!(crate::state::MUTATION_RING_CAP, 2 * REPLAY_MAX_ENTRIES);
        assert_eq!(
            crate::projection_registry::PROJECTION_DELTA_RING_CAP,
            2 * REPLAY_MAX_ENTRIES
        );

        // The headroom is real, not decorative: a client sitting exactly at
        // the ring floor still replays rather than resyncing, because the
        // gap it has to cover is half of what the ring retains.
        assert_eq!(
            decide_action(
                1,
                crate::state::MUTATION_RING_CAP as u64,
                Some(1),
                Some(crate::state::MUTATION_RING_CAP as u64),
                REPLAY_MAX_ENTRIES,
            ),
            StreamAction::ReplayDelta
        );
    }

    #[test]
    fn decide_action_replayable_but_over_entry_budget_snapshots() {
        // The ring covers the gap, but replaying it as one frame would
        // dwarf the cached snapshot — the budget flips it to FullSnapshot.
        assert_eq!(
            decide_action(5, 60_000, Some(1), Some(60_000), REPLAY_MAX_ENTRIES + 1),
            StreamAction::FullSnapshot
        );
        assert_eq!(
            decide_action(5, 60_000, Some(1), Some(60_000), REPLAY_MAX_ENTRIES),
            StreamAction::ReplayDelta
        );
    }

    #[test]
    fn projection_delta_frame_borrows_without_reshaping_the_wire() {
        let value = serde_json::json!({ "type": "pulse", "at_ms": 1 });
        let raw = serde_json::value::to_raw_value(&value).expect("raw delta");
        let frame = ProjectionDeltaFrame {
            kind: "delta",
            revision: 7,
            deltas: vec![ProjectionReplayEntry {
                revision: 7,
                delta: &raw,
            }],
        };
        let parsed: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&frame).expect("serialize"))
                .expect("parse");
        assert_eq!(
            parsed,
            serde_json::json!({
                "kind": "delta",
                "revision": 7,
                "deltas": [{ "revision": 7, "delta": value }],
            })
        );
    }

    /// A delta that counts every request to serialize it, and whose field
    /// order (`z` before `a`) survives only while nothing round-trips it
    /// through a `serde_json::Value` — a map would re-sort the two.
    #[derive(Clone)]
    struct WitnessDelta {
        serializations: Arc<AtomicU64>,
    }

    impl serde::Serialize for WitnessDelta {
        fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            use serde::ser::SerializeStruct;
            self.serializations.fetch_add(1, Ordering::Relaxed);
            let mut delta = serializer.serialize_struct("WitnessDelta", 2)?;
            delta.serialize_field("z", &1u64)?;
            delta.serialize_field("a", &2u64)?;
            delta.end()
        }
    }

    struct WitnessProjection {
        serializations: Arc<AtomicU64>,
    }

    impl cknerv_core::Projection for WitnessProjection {
        type Snapshot = u64;
        type Delta = WitnessDelta;

        fn name(&self) -> &'static str {
            "witness"
        }

        fn snapshot(&self) -> u64 {
            0
        }

        fn apply_mutation(&mut self, _m: &Mutation) -> Vec<WitnessDelta> {
            vec![WitnessDelta {
                serializations: self.serializations.clone(),
            }]
        }
    }

    /// The cost of a delta must not scale with the audience. Three live
    /// clients plus a reconnect replaying the ring all send the SAME
    /// bytes, produced once when the reducer emitted the delta.
    ///
    /// Two independent pins, because either one alone can be satisfied by
    /// a design that still re-renders: the counter proves the typed delta
    /// is visited exactly once no matter how many frames go out, and the
    /// verbatim byte comparison proves what the frames carry is that one
    /// visit's output rather than a re-serialized tree (which would come
    /// back with `a` before `z`, and could not be read off the entry as
    /// text at all).
    #[test]
    fn one_projection_delta_is_serialized_once_for_every_client() {
        let serializations = Arc::new(AtomicU64::new(0));
        let mut registry = crate::projection_registry::Registry::new();
        registry.register(WitnessProjection {
            serializations: serializations.clone(),
        });
        let runtime = registry.lookup("witness").expect("witness runtime");
        let writer = registry
            .writers()
            .into_iter()
            .next()
            .expect("witness writer");
        let mut clients: Vec<_> = (0..3).map(|_| runtime.subscribe()).collect();

        writer.apply(&RevisionedMutation {
            revision: 1,
            mutation: Mutation::ChainReorganized { from_block: 1 },
        });

        assert_eq!(
            serializations.load(Ordering::Relaxed),
            1,
            "the reducer serializes the delta once, before anyone asks for it"
        );
        let ring = runtime.delta_ring_snapshot();
        let stored = ring[0].value.get().to_string();
        assert_eq!(
            stored, r#"{"z":1,"a":2}"#,
            "the ring holds the projection's own bytes, not a re-sorted tree"
        );

        for client in &mut clients {
            let entry = client.try_recv().expect("every client gets the delta");
            let frame = ProjectionDeltaFrame {
                kind: "delta",
                revision: entry.rev,
                deltas: vec![ProjectionReplayEntry {
                    revision: entry.rev,
                    delta: &entry.value,
                }],
            };
            assert_eq!(
                serde_json::to_string(&frame).expect("frame is JSON"),
                format!(
                    r#"{{"kind":"delta","revision":1,"deltas":[{{"revision":1,"delta":{stored}}}]}}"#
                )
            );
        }

        let replay = ProjectionDeltaFrame {
            kind: "delta",
            revision: 1,
            deltas: ring
                .iter()
                .map(|d| ProjectionReplayEntry {
                    revision: d.rev,
                    delta: &d.value,
                })
                .collect(),
        };
        serde_json::to_string(&replay).expect("replay frame is JSON");
        assert_eq!(
            serializations.load(Ordering::Relaxed),
            1,
            "three live frames and a ring replay still cost one serialization"
        );
    }

    /// Same rule on the entity stream, where the text is built lazily on
    /// first send: everyone who wants the mutation — the second live
    /// client, a reconnect replaying the ring — borrows the one buffer,
    /// which is what `ptr::eq` on the returned text is asserting.
    #[test]
    fn one_entity_mutation_is_serialized_once_for_every_client() {
        let state = crate::state::ServerState::new();
        let mut first = state.subscribe_mutations();
        let mut second = state.subscribe_mutations();
        state.apply_mutation(Mutation::BlockMined {
            number: 7,
            hash: "0xblock7".into(),
            tx_count: 1,
            size: 42,
            at: 1_000,
            producer_key: None,
            producer_message: None,
        });

        let live = first.try_recv().expect("first client gets the mutation");
        let echoed = second.try_recv().expect("second client gets the mutation");
        let replayed = state
            .mutation_ring_snapshot()
            .pop()
            .expect("the ring keeps it for reconnects");

        let text = live.serialized();
        assert!(
            std::ptr::eq(text, live.serialized()),
            "the text is memoized, not rebuilt per call"
        );
        assert!(
            std::ptr::eq(text, echoed.serialized()) && std::ptr::eq(text, replayed.serialized()),
            "a second client and a ring replay must borrow the first send's bytes"
        );

        let frame = EntityDeltaFrame {
            kind: "delta",
            revision: live.revision,
            mutations: vec![text],
        };
        let rendered = serde_json::to_string(&frame).expect("frame is JSON");
        assert_eq!(
            rendered,
            format!(
                r#"{{"kind":"delta","revision":1,"mutations":[{}]}}"#,
                text.get()
            ),
            "the mutation goes out verbatim inside the envelope"
        );
        let parsed: serde_json::Value = serde_json::from_str(&rendered).expect("frame parses");
        assert_eq!(parsed["mutations"][0]["revision"], 1);
        assert_eq!(parsed["mutations"][0]["mutation"]["type"], "block_mined");
        assert_eq!(parsed["mutations"][0]["mutation"]["hash"], "0xblock7");
    }
}
