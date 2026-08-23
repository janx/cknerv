//! End-to-end smoke: build a server, serve a real HTTP GET against the
//! chain snapshot endpoint, shut down. Catches Cargo manifest / routing
//! / state-wiring breakage that pure unit tests can't.

use std::time::Duration;

use async_trait::async_trait;
use cknerv_core::{
    ActivityFeedItem, ActivityFeedRecord, AssetEcosystemCategory, AssetEcosystemRecord, AssetKind,
    Cell, CellDelta, CellGalaxy, CellSemanticRecord, ChainAnchor, EnrichmentSourceState,
    EnrichmentSourceStatus, GalaxyCellCandidate, GalaxyCompositionCandidates,
    GalaxyCompositionRecord, GalaxyCompositionTopUp, Mutation, OutPoint, PeerSightingAbsence,
    PeerSightingLookup, PeerSightingRecord, Projection, ReplayPhase, SemanticsProjection,
    TransactionSemanticRecord,
};
use cknerv_server::{
    Adapter, CanonicalContext, EnrichmentSource, GalaxyCompositionHydrator, ServerBuilder,
};
use futures_util::StreamExt;
use tokio::sync::{mpsc, watch};

/// A live `get_peers` id, base58 as CKB prints it. The fixture source knows
/// this one node and nothing else.
const SIGHTED_NODE_ID: &str = "QmagxSv7GNwKXQE7mi1iDjFHghjUpbqjBgqSot7PmMJqHA";

struct CompletedBootReplayAdapter;

struct TransactionFixtureSource;

#[async_trait]
impl EnrichmentSource for TransactionFixtureSource {
    fn name(&self) -> &'static str {
        "fixture"
    }

    fn capabilities(&self) -> Vec<String> {
        vec![
            "transaction_detail".to_string(),
            "asset_ecosystem".to_string(),
            "activity_feed".to_string(),
            "peer_sighting".to_string(),
        ]
    }

    async fn probe(&self, context: &CanonicalContext) -> EnrichmentSourceStatus {
        let validated_anchor = context.recent_blocks.last().map(|block| ChainAnchor {
            block: block.number,
            hash: block.hash.clone(),
        });
        EnrichmentSourceStatus {
            source: self.name().to_string(),
            status: if validated_anchor.is_some() {
                EnrichmentSourceState::Ready
            } else {
                EnrichmentSourceState::Connecting
            },
            capabilities: self.capabilities(),
            indexed_tip: Some(context.tip),
            lag_blocks: Some(0),
            validated_anchor,
            last_success_at_ms: Some(1),
            message: None,
        }
    }

    async fn enrich_cell(
        &self,
        _out_point: &OutPoint,
        _context: &CanonicalContext,
    ) -> anyhow::Result<Option<CellSemanticRecord>> {
        Ok(None)
    }

    async fn enrich_transaction(
        &self,
        tx_hash: &str,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<TransactionSemanticRecord>> {
        let Some(block) = context.recent_blocks.last() else {
            return Ok(None);
        };
        Ok(Some(TransactionSemanticRecord {
            tx_hash: tx_hash.to_string(),
            block: block.number,
            source: self.name().to_string(),
            as_of: ChainAnchor {
                block: block.number,
                hash: block.hash.clone(),
            },
            updated_at_ms: 1,
            actions: Vec::new(),
            participants: Vec::new(),
            fee: Some("1000".to_string()),
            cycles: Some(123),
        }))
    }

    async fn enrich_asset_ecosystem(
        &self,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<AssetEcosystemRecord>> {
        let Some(block) = context.recent_blocks.last() else {
            return Ok(None);
        };
        Ok(Some(AssetEcosystemRecord {
            source: self.name().to_string(),
            as_of: ChainAnchor {
                block: block.number,
                hash: block.hash.clone(),
            },
            updated_at_ms: 1,
            total_live_capacity_shannons: "100000000000000".to_string(),
            total_knowledge_bytes: 12_345,
            capacity_breakdown: vec![AssetEcosystemCategory {
                category: "dao".to_string(),
                capacity_shannons: "25000000000000".to_string(),
                share_bps: 2_500,
            }],
            top_assets: Vec::new(),
        }))
    }

    /// One node is sighted and every other one honestly is not. Both are
    /// answers, and the route has to keep them apart without calling either
    /// a failure.
    async fn enrich_peer(
        &self,
        node_id: &str,
        context: &CanonicalContext,
    ) -> anyhow::Result<PeerSightingLookup> {
        let Some(block) = context.recent_blocks.last() else {
            return Ok(PeerSightingLookup::unsighted(
                PeerSightingAbsence::NeverSighted,
            ));
        };
        if node_id != SIGHTED_NODE_ID {
            return Ok(PeerSightingLookup::unsighted(
                PeerSightingAbsence::NeverSighted,
            ));
        }
        Ok(PeerSightingLookup::sighted(PeerSightingRecord {
            source: self.name().to_string(),
            as_of: ChainAnchor {
                block: block.number,
                hash: block.hash.clone(),
            },
            updated_at_ms: 1,
            node_id: node_id.to_string(),
            country: "DE".to_string(),
            asn: "AS24940 Hetzner".to_string(),
            client_version: "0.209.0".to_string(),
            protocols: vec!["/ckb/syn".to_string()],
            first_seen_ms: 1_650_000_000_000,
            last_seen_ms: 1_700_000_000_000,
            last_reachable_at_ms: Some(1_699_999_000_000),
            reachable: true,
            rtt_ms: Some(41),
            known_peers_count: 45,
        }))
    }

    async fn enrich_activity_feed(
        &self,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<ActivityFeedRecord>> {
        let Some(block) = context.recent_blocks.last() else {
            return Ok(None);
        };
        Ok(Some(ActivityFeedRecord {
            source: self.name().to_string(),
            as_of: ChainAnchor {
                block: block.number,
                hash: block.hash.clone(),
            },
            updated_at_ms: 1,
            activities: vec![ActivityFeedItem {
                tx_hash: format!("0x{}", "22".repeat(32)),
                block: block.number,
                timestamp_ms: 1,
                category: "transfer".to_string(),
                label: None,
                participant_count: 2,
            }],
        }))
    }
}

#[async_trait]
impl Adapter for CompletedBootReplayAdapter {
    fn name(&self) -> &'static str {
        "completed-boot-replay"
    }

    async fn run(
        &self,
        out: mpsc::Sender<Mutation>,
        mut shutdown: watch::Receiver<bool>,
    ) -> anyhow::Result<()> {
        let _ = out
            .send(Mutation::BlockMined {
                number: 7,
                hash: "0x7".into(),
                tx_count: 0,
                size: 0,
                at: 7,
            })
            .await;
        let _ = out
            .send(Mutation::BackfillProgress {
                done: 1,
                total: 1,
                active: false,
                phase: ReplayPhase::Boot,
            })
            .await;
        let _ = shutdown.changed().await;
        Ok(())
    }
}

/// Two blocks and no replay marker. Nothing here clears a ring, so both the
/// mutation ring and the projection delta ring still hold their entries when
/// a reconnecting client arrives — the state in which a cursor from a
/// previous server life used to be answered with silence.
struct TwoBlockAdapter;

#[async_trait]
impl Adapter for TwoBlockAdapter {
    fn name(&self) -> &'static str {
        "two-block"
    }

    async fn run(
        &self,
        out: mpsc::Sender<Mutation>,
        mut shutdown: watch::Receiver<bool>,
    ) -> anyhow::Result<()> {
        for number in 1..=2u64 {
            let _ = out
                .send(Mutation::BlockMined {
                    number,
                    hash: format!("0x{number}"),
                    tx_count: 0,
                    size: 0,
                    at: number,
                })
                .await;
        }
        let _ = shutdown.changed().await;
        Ok(())
    }
}

/// A projection that answers every mutation with a delta, so its ring is
/// provably non-empty by the time the test connects. That matters: an EMPTY
/// ring already resnapped a non-zero cursor, so a projection that stayed
/// quiet would let this test pass against the very bug it is pinning.
struct EveryMutationPulses;

impl Projection for EveryMutationPulses {
    type Snapshot = serde_json::Value;
    type Delta = CellDelta;

    fn name(&self) -> &'static str {
        "pulses"
    }

    fn snapshot(&self) -> serde_json::Value {
        serde_json::json!({ "pulses": true })
    }

    fn apply_mutation(&mut self, _m: &Mutation) -> Vec<CellDelta> {
        vec![CellDelta::Pulse { at_ms: 1 }]
    }
}

/// The first frame a stream sends, parsed. Silence is the failure this is
/// looking for, so the timeout IS the assertion — and it is kept well under
/// the 5s application heartbeat, whose arrival must never be mistaken for an
/// answer to the catch-up request.
async fn first_frame(url: &str) -> serde_json::Value {
    let (mut socket, _) = tokio_tungstenite::connect_async(url)
        .await
        .expect("the stream accepts the upgrade");
    let message = tokio::time::timeout(Duration::from_secs(2), socket.next())
        .await
        .expect("the stream met a foreign cursor with silence")
        .expect("the stream closed without sending a frame")
        .expect("the frame is readable");
    serde_json::from_str(message.to_text().expect("the frame is text")).expect("the frame is JSON")
}

/// An adapter that returns the instant it is spawned — a source that died
/// on its first RPC call, or was never able to start one.
struct StillbornAdapter;

#[async_trait]
impl Adapter for StillbornAdapter {
    fn name(&self) -> &'static str {
        "stillborn"
    }

    async fn run(
        &self,
        _out: mpsc::Sender<Mutation>,
        _shutdown: watch::Receiver<bool>,
    ) -> anyhow::Result<()> {
        Ok(())
    }
}

/// Poll `/api/health` until `settled` accepts it, or give up. The
/// supervisor samples on its own cadence, so the flip is near-immediate but
/// not synchronous with the death.
async fn health_until(
    addr: std::net::SocketAddr,
    settled: impl Fn(&serde_json::Value) -> bool,
) -> serde_json::Value {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let body: serde_json::Value = reqwest::get(format!("http://{addr}/api/health"))
                .await
                .expect("GET /api/health succeeds")
                .json()
                .await
                .expect("health body is JSON");
            if settled(&body) {
                return body;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("health never reached the expected state")
}

fn tmpdir() -> std::path::PathBuf {
    let mut path = std::env::temp_dir();
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    path.push(format!("cknerv-server-checkpoint-{nonce}"));
    std::fs::create_dir_all(&path).unwrap();
    path
}

/// The shape a monitor reads. Served by a healthy server with an adapter
/// still running, so every liveness field is a real `true`.
#[tokio::test]
async fn health_route_reports_liveness_and_freshness() {
    let (router, handle) = ServerBuilder::new()
        .add_projection(CellGalaxy::new())
        .add_adapter(CompletedBootReplayAdapter)
        .build_version("deadbee@2026-08-15")
        .build()
        .expect("build");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    // Settle on the adapter's block so the freshness fields have something
    // to describe.
    let body = health_until(addr, |body| body["tip"] == 7).await;

    assert_eq!(body["build_version"], "deadbee@2026-08-15");
    assert_eq!(body["degraded"], false);
    assert_eq!(body["reducer_alive"], true);
    assert_eq!(body["replay_active"], false);
    assert!(body["uptime_s"].is_u64(), "body: {body}");
    assert!(body["revision"].as_u64().is_some_and(|r| r > 0), "{body}");
    assert!(body["tip_age_ms"].is_u64(), "body: {body}");
    assert!(body["mutation_ring_len"].is_u64(), "body: {body}");
    assert_eq!(
        body["adapters"],
        serde_json::json!([{ "name": "completed-boot-replay", "alive": true, "exited_at_ms": null }])
    );
    assert_eq!(
        body["projections"],
        serde_json::json!([{
            "name": "cells",
            "revision": body["revision"],
            "quarantined": false,
            "quarantine_reason": null,
        }])
    );
    assert_eq!(body["quarantined_projections"], serde_json::json!([]));
    // No enrichment source is configured, and the report says that rather
    // than inventing a health for it.
    assert_eq!(
        body["enrichment"],
        serde_json::json!({
            "reducer_alive": null,
            "supervisor_alive": null,
            "source": null,
            "status": null,
            "lag_blocks": null,
            "last_success_at_ms": null,
        })
    );

    handle.shutdown().await;
    server_task.abort();
}

/// With a source configured, health carries what the last probe found —
/// captured off the event pipeline as it passes, so answering costs nothing
/// and never serializes the semantics projection to find out.
#[tokio::test]
async fn health_carries_the_configured_enrichment_source() {
    let (router, handle) = ServerBuilder::new()
        .add_adapter(CompletedBootReplayAdapter)
        .add_enrichment_projection(SemanticsProjection::default())
        .enrichment_source(TransactionFixtureSource)
        .build()
        .expect("build");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    let body = health_until(addr, |body| body["enrichment"]["source"] == "fixture").await;
    assert_eq!(body["enrichment"]["reducer_alive"], true);
    assert_eq!(body["enrichment"]["supervisor_alive"], true);
    // Whichever state the first probe reached, it is a real one.
    assert!(body["enrichment"]["status"].is_string(), "body: {body}");
    assert_eq!(body["degraded"], false);

    handle.shutdown().await;
    server_task.abort();
}

/// An adapter that exits takes the reducer with it — every sender is gone,
/// so `mutation_rx` closes and the reducer's loop ends "cleanly". Nothing
/// used to notice: the process kept serving frozen state with live
/// heartbeats. Now the supervisor does, and says so.
#[tokio::test]
async fn health_reports_a_dead_adapter_and_the_reducer_it_starved() {
    let (router, handle) = ServerBuilder::new()
        .add_projection(CellGalaxy::new())
        .add_adapter(StillbornAdapter)
        .build()
        .expect("build");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    let body = health_until(addr, |body| body["degraded"] == true).await;
    assert_eq!(body["adapters"][0]["name"], "stillborn");
    assert_eq!(body["adapters"][0]["alive"], false);
    assert!(
        body["adapters"][0]["exited_at_ms"]
            .as_u64()
            .is_some_and(|at| at > 0),
        "a death is stamped: {body}"
    );
    assert_eq!(body["reducer_alive"], false);

    // …and the server it describes is still answering everything else.
    let snapshot = reqwest::get(format!("http://{addr}/api/entities/chain/snapshot"))
        .await
        .expect("GET succeeds");
    assert_eq!(snapshot.status(), 200);

    handle.shutdown().await;
    server_task.abort();
}

#[tokio::test]
async fn server_boots_and_serves_chain_snapshot() {
    let (router, handle) = ServerBuilder::new().build().expect("build");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    // Give the server a moment to bind. (The TcpListener is already
    // bound; this is just so axum::serve has a tick to wire its
    // accept loop.)
    tokio::time::sleep(Duration::from_millis(50)).await;

    let resp = reqwest::get(format!("http://{}/api/entities/chain/snapshot", addr))
        .await
        .expect("GET succeeds");
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.expect("JSON parse");
    assert!(
        body.is_object(),
        "snapshot body should be an object: {body}"
    );
    assert!(
        body.get("chain").is_some(),
        "snapshot should contain chain entity data: {body}"
    );
    assert!(
        body.get("revision").is_some(),
        "snapshot should carry a revision cursor: {body}"
    );

    handle.shutdown().await;
    server_task.abort();
}

/// A restart closes every socket but not every tab. The one that comes back
/// is still holding the revision it reached against the server that exited —
/// a number the new process has reset past. Both stream families used to read
/// that as "caught up" and say nothing at all: a live transport, a green HUD,
/// and a chain frozen at a tip that no longer exists.
#[tokio::test]
async fn a_cursor_from_a_previous_server_life_is_answered_with_a_snapshot() {
    let (router, handle) = ServerBuilder::new()
        .add_projection(EveryMutationPulses)
        .add_adapter(TwoBlockAdapter)
        .build()
        .expect("build");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    // Both blocks applied: the rings hold revisions 1 and 2, and 2 is the
    // newest revision this life of the server has ever assigned.
    health_until(addr, |body| body["revision"] == 2).await;

    let since = 50_000_000u64;
    let chain = first_frame(&format!(
        "ws://{addr}/api/entities/chain/stream?since={since}"
    ))
    .await;
    assert_eq!(chain["kind"], "snapshot", "chain frame: {chain}");
    assert_eq!(chain["revision"], 2, "chain frame: {chain}");
    assert_eq!(chain["entities"]["chain"]["tip"], 2, "chain frame: {chain}");

    let projection = first_frame(&format!(
        "ws://{addr}/api/projections/pulses/stream?since={since}"
    ))
    .await;
    assert_eq!(
        projection["kind"], "snapshot",
        "projection frame: {projection}"
    );
    assert_eq!(projection["revision"], 2, "projection frame: {projection}");
    assert_eq!(
        projection["snapshot"]["pulses"], true,
        "projection frame: {projection}"
    );

    handle.shutdown().await;
    server_task.abort();
}

#[tokio::test]
async fn unknown_projection_returns_404() {
    let (router, handle) = ServerBuilder::new().build().expect("build");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    tokio::time::sleep(Duration::from_millis(50)).await;

    let resp = reqwest::get(format!("http://{}/api/projections/nope/snapshot", addr))
        .await
        .expect("GET succeeds");
    assert_eq!(resp.status(), 404);

    handle.shutdown().await;
    server_task.abort();
}

#[tokio::test]
async fn disabled_enrichment_route_is_an_isolated_404() {
    let (router, handle) = ServerBuilder::new().build().expect("build");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    tokio::time::sleep(Duration::from_millis(50)).await;

    let resp = reqwest::get(format!(
        "http://{addr}/api/enrichment/cells/0x{}/0",
        "00".repeat(32)
    ))
    .await
    .expect("GET succeeds");
    assert_eq!(resp.status(), 404);

    let transaction = reqwest::get(format!(
        "http://{addr}/api/enrichment/transactions/0x{}",
        "11".repeat(32)
    ))
    .await
    .expect("GET succeeds");
    assert_eq!(transaction.status(), 404);

    let peer = reqwest::get(format!(
        "http://{addr}/api/enrichment/peers/{SIGHTED_NODE_ID}"
    ))
    .await
    .expect("GET succeeds");
    assert_eq!(peer.status(), 404);
    let peer_body: serde_json::Value = peer.json().await.unwrap();
    assert_eq!(peer_body["error"], "enrichment_disabled");

    let canonical = reqwest::get(format!("http://{addr}/api/entities/chain/snapshot"))
        .await
        .expect("canonical route remains available");
    assert_eq!(canonical.status(), 200);

    handle.shutdown().await;
    server_task.abort();
}

#[tokio::test]
async fn lazy_transaction_enrichment_updates_only_semantics_projection() {
    let (router, handle) = ServerBuilder::new()
        .add_adapter(CompletedBootReplayAdapter)
        .add_enrichment_projection(SemanticsProjection::default())
        .enrichment_source(TransactionFixtureSource)
        .build()
        .expect("build");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    tokio::time::sleep(Duration::from_millis(50)).await;

    let canonical_before: serde_json::Value =
        reqwest::get(format!("http://{addr}/api/entities/chain/snapshot"))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    let tx_hash = format!("0x{}", "11".repeat(32));
    let response = reqwest::get(format!(
        "http://{addr}/api/enrichment/transactions/{tx_hash}"
    ))
    .await
    .expect("transaction enrichment succeeds");
    assert_eq!(response.status(), 200);
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["transaction"]["tx_hash"], tx_hash);

    let semantics: serde_json::Value =
        reqwest::get(format!("http://{addr}/api/projections/semantics/snapshot"))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    assert_eq!(semantics["snapshot"]["transactions"][0]["fee"], "1000");
    let canonical_after: serde_json::Value =
        reqwest::get(format!("http://{addr}/api/entities/chain/snapshot"))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    assert_eq!(canonical_after["revision"], canonical_before["revision"]);

    handle.shutdown().await;
    server_task.abort();
}

#[tokio::test]
async fn registered_projection_snapshot_returns_200() {
    let (router, handle) = ServerBuilder::new()
        .add_projection(CellGalaxy::new())
        .build()
        .expect("build");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    tokio::time::sleep(Duration::from_millis(50)).await;

    let resp = reqwest::get(format!("http://{}/api/projections/cells/snapshot", addr))
        .await
        .expect("GET succeeds");
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.expect("JSON parse");
    assert!(body.get("revision").is_some(), "body: {body}");
    assert!(body.get("snapshot").is_some(), "body: {body}");

    handle.shutdown().await;
    server_task.abort();
}

#[tokio::test]
async fn completed_boot_replay_is_checkpointed_without_shutdown() {
    let workdir = tmpdir();
    let persisted = cknerv_server::persistence::persisted_path(&workdir);
    let (_router, handle) = ServerBuilder::new()
        .add_projection(CellGalaxy::new())
        .add_adapter(CompletedBootReplayAdapter)
        .workdir(workdir.clone())
        .build()
        .expect("build");

    tokio::time::timeout(Duration::from_secs(2), async {
        while !persisted.is_file() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("boot replay checkpoint should be written");

    let saved: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&persisted).unwrap()).unwrap();
    assert_eq!(saved["entities"]["chain"]["tip"], 7);
    assert!(saved["projections"]["cells"].is_object());

    handle.shutdown().await;
    std::fs::remove_dir_all(workdir).unwrap();
}

#[tokio::test]
async fn peer_sighting_route_separates_a_sighting_from_a_silence() {
    let (router, handle) = ServerBuilder::new()
        .add_adapter(CompletedBootReplayAdapter)
        .add_enrichment_projection(SemanticsProjection::default())
        .enrichment_source(TransactionFixtureSource)
        .build()
        .expect("build");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    tokio::time::sleep(Duration::from_millis(50)).await;

    let sighted = reqwest::get(format!(
        "http://{addr}/api/enrichment/peers/{SIGHTED_NODE_ID}"
    ))
    .await
    .expect("peer enrichment succeeds");
    assert_eq!(sighted.status(), 200);
    let body: serde_json::Value = sighted.json().await.unwrap();
    assert_eq!(body["state"], "sighted");
    assert_eq!(body["sighting"]["node_id"], SIGHTED_NODE_ID);
    assert_eq!(body["sighting"]["last_seen_ms"], 1_700_000_000_000_u64);
    assert_eq!(body["sighting"]["known_peers_count"], 45);

    // A node the crawler never saw is a 200 that says so: the plate has
    // something true to print, and a 404 would have thrown it away.
    let unsighted = reqwest::get(format!("http://{addr}/api/enrichment/peers/QmNobody"))
        .await
        .expect("peer enrichment succeeds");
    assert_eq!(unsighted.status(), 200);
    let body: serde_json::Value = unsighted.json().await.unwrap();
    assert_eq!(body["state"], "unsighted");
    assert_eq!(body["reason"], "never_sighted");
    assert!(body.get("sighting").is_none(), "body: {body}");

    // The lookup describes a network node, not a chain object: nothing of it
    // reaches the semantics projection.
    let semantics: serde_json::Value =
        reqwest::get(format!("http://{addr}/api/projections/semantics/snapshot"))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    assert!(
        semantics["snapshot"].get("peer_sightings").is_none(),
        "semantics: {semantics}"
    );

    handle.shutdown().await;
    server_task.abort();
}

/// Stands in for the local node during a warm boot: everything the restore
/// offers is still live except the `0xde…` outpoints, which were spent
/// while the process was down.
struct StillLiveNode;

fn hydrated(candidate: &GalaxyCellCandidate, id: u64, asset_kind: AssetKind) -> Cell {
    Cell {
        id,
        born_at_ms: 0,
        death_at_ms: None,
        birth_block: candidate.birth_block,
        tag: None,
        pos_seed: cknerv_core::helix_seed_for(id),
        out_point: candidate.out_point.clone(),
        capacity: candidate.capacity,
        data_hex: "0x".into(),
        data_bytes: 0,
        content_hash: format!("0x{id:064x}"),
        lock_shape_seed: [id as u32, 1],
        type_shape_seed: None,
        data_shape_seed: [id as u32, 2],
        lock_kind: Default::default(),
        asset_kind,
        lock_script: Default::default(),
        type_script: None,
    }
}

fn still_live(bucket: &[GalaxyCellCandidate], asset_kind: AssetKind) -> Vec<Cell> {
    bucket
        .iter()
        .filter(|candidate| !candidate.out_point.tx_hash.starts_with("0xde"))
        .map(|candidate| {
            // Same derivation the real hydrator uses, so three buckets
            // cannot hand three different cells one id.
            let id = cknerv_core::composition_id_for_outpoint(
                &candidate.out_point.tx_hash,
                candidate.out_point.index,
            );
            hydrated(candidate, id, asset_kind)
        })
        .collect()
}

#[async_trait]
impl GalaxyCompositionHydrator for StillLiveNode {
    async fn hydrate_galaxy_composition(
        &self,
        candidates: GalaxyCompositionCandidates,
    ) -> anyhow::Result<GalaxyCompositionRecord> {
        Ok(GalaxyCompositionRecord {
            source: candidates.source.clone(),
            as_of: candidates.as_of.clone(),
            updated_at_ms: candidates.updated_at_ms,
            dao: still_live(&candidates.dao, AssetKind::Dao),
            typed: still_live(&candidates.typed, AssetKind::Xudt),
            plain: still_live(&candidates.plain, AssetKind::Native),
        })
    }

    async fn hydrate_galaxy_top_up(
        &self,
        _candidates: GalaxyCompositionCandidates,
    ) -> anyhow::Result<GalaxyCompositionTopUp> {
        unreachable!("the restore never tops up")
    }
}

fn remembered_cell(tx_prefix: &str, id: u64, asset_kind: AssetKind) -> Cell {
    hydrated(
        &GalaxyCellCandidate {
            out_point: OutPoint {
                tx_hash: format!("0x{tx_prefix}{id:062x}"),
                index: 0,
            },
            capacity: 500 + id,
            birth_block: 3,
        },
        id,
        asset_kind,
    )
}

/// The warm boot, end to end through the real wiring: a record left on
/// disk by a previous run is revalidated through the canonical hydrator
/// and staged over the ordinary composition channel, with no enrichment
/// source configured at all. What the stage ends up holding is what the
/// node just re-affirmed — the spent DAO cell does not come back — and
/// the provenance says where it came from.
#[tokio::test]
async fn a_remembered_composition_stages_the_galaxy_with_no_source_configured() {
    let workdir = tmpdir();
    let remembered = GalaxyCompositionRecord {
        source: "ckbadger".into(),
        as_of: ChainAnchor {
            block: 3,
            hash: "0x3".into(),
        },
        updated_at_ms: 5_000,
        dao: vec![
            remembered_cell("ab", 1, AssetKind::Dao),
            remembered_cell("de", 2, AssetKind::Dao),
        ],
        typed: vec![remembered_cell("ab", 3, AssetKind::Xudt)],
        plain: vec![remembered_cell("ab", 4, AssetKind::Native)],
    };
    std::fs::write(
        workdir.join("galaxy-composition.json"),
        serde_json::to_vec(&serde_json::json!({
            "schema_version": 1,
            "record": remembered,
        }))
        .unwrap(),
    )
    .unwrap();

    let (router, handle) = ServerBuilder::new()
        .add_projection(CellGalaxy::new())
        .add_adapter(CompletedBootReplayAdapter)
        .galaxy_composition_hydrator(StillLiveNode)
        .workdir(workdir.clone())
        .build()
        .expect("build");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    let snapshot = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let body: serde_json::Value =
                reqwest::get(format!("http://{addr}/api/projections/cells/snapshot"))
                    .await
                    .expect("GET succeeds")
                    .json()
                    .await
                    .expect("JSON parse");
            if body["snapshot"]["display"]["provenance"]["mode"] == "composed" {
                break body["snapshot"].clone();
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the remembered composition should stage the galaxy");

    let provenance = &snapshot["display"]["provenance"];
    assert_eq!(
        provenance["source"], "ckbadger (restored)",
        "a restored record names itself, so a content-identical fresh one is never read as a duplicate"
    );
    assert_eq!(
        provenance["as_of"]["block"], 7,
        "installed under a block this server can prove, not the one it was curated at"
    );
    let residents = snapshot["display"]["residents"]
        .as_array()
        .expect("residents");
    assert_eq!(residents.len(), 3, "the spent DAO cell stayed dead");

    handle.shutdown().await;
    server_task.abort();
    std::fs::remove_dir_all(workdir).unwrap();
}
