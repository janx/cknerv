//! End-to-end smoke: build a server, serve a real HTTP GET against the
//! chain snapshot endpoint, shut down. Catches Cargo manifest / routing
//! / state-wiring breakage that pure unit tests can't.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use cknerv_core::{
    ActivityFeedItem, ActivityFeedRecord, ActivityKindSummary, AssetEcosystemCategory,
    AssetEcosystemRecord, AssetKind, Cell, CellDelta, CellGalaxy, CellSemanticRecord, ChainAnchor,
    EnrichmentSourceState, EnrichmentSourceStatus, GalaxyCellCandidate,
    GalaxyCompositionCandidates, GalaxyCompositionRecord, GalaxyCompositionTopUp, Mutation,
    OutPoint, PeerAdvertisedEvidence, PeerProbeResult, PeerSightingAbsence, PeerSightingLookup,
    PeerSightingRecord, Projection, ReplayPhase, SemanticsProjection, TransactionSemanticRecord,
};
use cknerv_server::{
    Adapter, CanonicalContext, CellDataReader, CellOutputData, EnrichmentSource,
    GalaxyCompositionHydrator, ServerBuilder,
};
use futures_util::StreamExt;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::{self, client::IntoClientRequest};

/// A live `get_peers` id, base58 as CKB prints it. The fixture source knows
/// this one node and nothing else.
const SIGHTED_NODE_ID: &str = "QmagxSv7GNwKXQE7mi1iDjFHghjUpbqjBgqSot7PmMJqHA";
/// A node the network names and nobody outside could get an identify out of.
/// The third answer this route has to keep apart from the other two.
const ADVERTISED_NODE_ID: &str = "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco";

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

    /// One node is sighted, one is named by the network and never answered,
    /// and every other one honestly is neither. All three are answers, and
    /// the route has to keep them apart without calling any of them a
    /// failure.
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
        if node_id == ADVERTISED_NODE_ID {
            return Ok(PeerSightingLookup::advertised_unverified(
                PeerAdvertisedEvidence {
                    last_advertised_at_ms: Some(1_700_000_000_000),
                    latest_positive_observed_ms: 1_700_000_040_000,
                    furthest_result: Some(PeerProbeResult::DialRequestFailed),
                    furthest_address: Some("/ip4/198.51.100.4/tcp/8115".to_string()),
                    dialed_address_count: 2,
                    consecutive_exhausted_rounds: 3,
                    advertiser_peer_count: Some(6),
                },
            ));
        }
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
            advertiser_peer_count: Some(47),
            advertised_address_count: Some(5_727),
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
            window_ms: 3_600_000,
            kinds: vec![ActivityKindSummary {
                kind: "transfer".to_string(),
                in_window: 1,
                in_window_capped: false,
                latest: Some(ActivityFeedItem {
                    tx_hash: format!("0x{}", "22".repeat(32)),
                    block: block.number,
                    timestamp_ms: 1,
                    category: "transfer".to_string(),
                    label: None,
                    participant_count: 2,
                    amount_shannons: None,
                }),
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
                producer_key: None,
                producer_message: None,
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
                    producer_key: None,
                    producer_message: None,
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
        vec![CellDelta::Pulse {
            at_ms: 1,
            producer_key: None,
        }]
    }
}

/// The first frame a stream sends, parsed. Silence is the failure this is
/// looking for, so the timeout IS the assertion — and it is kept well under
/// the 5s application heartbeat, whose arrival must never be mistaken for an
/// answer to the catch-up request.
async fn first_frame(url: &str) -> serde_json::Value {
    first_frame_of(url.into_client_request().expect("the url is a ws url")).await
}

/// The same, for a handshake that had to be built by hand because a bare url
/// has nowhere to carry the `Origin` a browser puts on it.
async fn first_frame_of(request: tungstenite::handshake::client::Request) -> serde_json::Value {
    let (mut socket, _) = tokio_tungstenite::connect_async(request)
        .await
        .expect("the stream accepts the upgrade");
    let message = tokio::time::timeout(Duration::from_secs(2), socket.next())
        .await
        .expect("the stream met a foreign cursor with silence")
        .expect("the stream closed without sending a frame")
        .expect("the frame is readable");
    serde_json::from_str(message.to_text().expect("the frame is text")).expect("the frame is JSON")
}

/// A stream handshake that names the page asking for it.
fn stream_request(url: &str, origin: &str) -> tungstenite::handshake::client::Request {
    let mut request = url.into_client_request().expect("the url is a ws url");
    request.headers_mut().insert(
        "origin",
        origin.parse().expect("the origin is a header value"),
    );
    request
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
    // The slot that held one number for a relationship with two ends is not
    // on the wire at all — not as a null, not as a zero. It counted PEERS
    // this node knew; what upstream answers with counts peers that know THIS
    // node, so there was never a way to fill it that did not print the
    // sentence backwards.
    assert!(
        body["sighting"].get("known_peers_count").is_none(),
        "body: {body}"
    );
    // What replaced it, in two units that cannot be swapped: peers that named
    // this node, and ADDRESSES this node named. A peer is advertised under
    // every alias anybody saw it at, so the second runs several times the
    // first and neither may be printed under the other's label.
    assert_eq!(body["sighting"]["advertiser_peer_count"], 47);
    assert_eq!(body["sighting"]["advertised_address_count"], 5_727);

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
    assert!(body.get("advertised").is_none(), "body: {body}");

    // And a node the network names that never answered is a third answer
    // again — an absence, but one with the crawler's own evidence under it.
    // Collapsing it into the line above would tell a pilot nobody has ever
    // heard of a peer whose addresses the crawler is dialing every round.
    let advertised = reqwest::get(format!(
        "http://{addr}/api/enrichment/peers/{ADVERTISED_NODE_ID}"
    ))
    .await
    .expect("peer enrichment succeeds");
    assert_eq!(advertised.status(), 200);
    let body: serde_json::Value = advertised.json().await.unwrap();
    assert_eq!(body["state"], "unsighted");
    assert_eq!(body["reason"], "advertised_unverified");
    assert_eq!(body["advertised"]["furthest_result"], "dial_request_failed");
    assert_eq!(body["advertised"]["consecutive_exhausted_rounds"], 3);
    // The rung has somewhere it happened, a denominator, and the one weight
    // this cohort carries — how much of the network still repeats the address.
    assert_eq!(
        body["advertised"]["furthest_address"],
        "/ip4/198.51.100.4/tcp/8115"
    );
    assert_eq!(body["advertised"]["dialed_address_count"], 2);
    assert_eq!(body["advertised"]["advertiser_peer_count"], 6);
    assert_eq!(
        body["advertised"]["last_advertised_at_ms"],
        1_700_000_000_000_u64
    );
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
        collection_seed: None,
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

/// A Cell data source that answers from a table rather than from a node.
///
/// Holds one deliberately unreadable outpoint too, because the route's whole
/// job is telling "chain truth has no such output" apart from "chain truth
/// could not be asked", and only a source that can do both proves it.
struct FixtureCellDataReader {
    outputs: HashMap<OutPoint, CellOutputData>,
    unreadable: OutPoint,
    /// How many times the source was actually consulted. The malformed-hash
    /// arm is supposed to be decided before this ever moves.
    reads: Arc<AtomicUsize>,
}

impl FixtureCellDataReader {
    fn new(reads: Arc<AtomicUsize>) -> Self {
        let mut outputs = HashMap::new();
        outputs.insert(
            live_out_point(),
            CellOutputData {
                bytes: LIVE_CELL_BYTES.to_vec(),
                data_hash: format!("0x{}", "ab".repeat(32)),
                live: true,
            },
        );
        outputs.insert(
            dead_out_point(),
            CellOutputData {
                bytes: DEAD_CELL_BYTES.to_vec(),
                data_hash: format!("0x{}", "cd".repeat(32)),
                live: false,
            },
        );
        outputs.insert(
            oversized_out_point(),
            CellOutputData {
                bytes: vec![0x7f; cknerv_server::CELL_DATA_MAX_BYTES + 1],
                data_hash: format!("0x{}", "ef".repeat(32)),
                live: true,
            },
        );
        Self {
            outputs,
            unreadable: unreadable_out_point(),
            reads,
        }
    }
}

#[async_trait]
impl CellDataReader for FixtureCellDataReader {
    async fn read_output_data(
        &self,
        out_point: &OutPoint,
    ) -> anyhow::Result<Option<CellOutputData>> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        if *out_point == self.unreadable {
            return Err(anyhow::anyhow!("connection refused"));
        }
        Ok(self.outputs.get(out_point).cloned())
    }
}

const LIVE_CELL_BYTES: &[u8] = &[0x73, 0x70, 0x6f, 0x72, 0x65, 0x00, 0xff, 0x10];
const DEAD_CELL_BYTES: &[u8] = &[0xe8, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];

fn live_out_point() -> OutPoint {
    OutPoint {
        tx_hash: format!("0x{}", "1a".repeat(32)),
        index: 0,
    }
}

fn dead_out_point() -> OutPoint {
    OutPoint {
        tx_hash: format!("0x{}", "2b".repeat(32)),
        index: 3,
    }
}

fn oversized_out_point() -> OutPoint {
    OutPoint {
        tx_hash: format!("0x{}", "3c".repeat(32)),
        index: 0,
    }
}

fn unreadable_out_point() -> OutPoint {
    OutPoint {
        tx_hash: format!("0x{}", "4d".repeat(32)),
        index: 1,
    }
}

fn unknown_out_point() -> OutPoint {
    OutPoint {
        tx_hash: format!("0x{}", "5e".repeat(32)),
        index: 9,
    }
}

/// Boot a server whose only extra wiring is a Cell data source, and hand back
/// its address plus the counter that says how often the source was asked.
async fn serve_cell_data() -> (
    std::net::SocketAddr,
    Arc<AtomicUsize>,
    cknerv_server::ServerHandle,
    tokio::task::JoinHandle<()>,
) {
    let reads = Arc::new(AtomicUsize::new(0));
    let (router, handle) = ServerBuilder::new()
        .cell_data_reader(FixtureCellDataReader::new(reads.clone()))
        .build()
        .expect("build");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    (addr, reads, handle, server_task)
}

fn cell_data_url(addr: std::net::SocketAddr, out_point: &OutPoint) -> String {
    format!(
        "http://{addr}/api/cells/{}/{}/data",
        out_point.tx_hash, out_point.index
    )
}

fn header<'a>(response: &'a reqwest::Response, name: &str) -> &'a str {
    response
        .headers()
        .get(name)
        .unwrap_or_else(|| panic!("response carries {name}: {:?}", response.headers()))
        .to_str()
        .expect("header is ASCII")
}

#[tokio::test]
async fn a_live_cell_answers_with_its_whole_payload_and_every_header() {
    let (addr, reads, handle, server_task) = serve_cell_data().await;
    let out_point = live_out_point();

    let response = reqwest::get(cell_data_url(addr, &out_point))
        .await
        .expect("GET succeeds");
    assert_eq!(response.status(), 200);
    assert_eq!(
        header(&response, "content-type"),
        "application/octet-stream"
    );
    assert_eq!(
        header(&response, "content-length"),
        LIVE_CELL_BYTES.len().to_string()
    );
    assert_eq!(
        response.headers().get_all("content-length").iter().count(),
        1,
        "we state the length ourselves, so the transport must not state it a second time"
    );
    assert_eq!(
        header(&response, "x-cell-data-bytes"),
        LIVE_CELL_BYTES.len().to_string()
    );
    assert_eq!(
        header(&response, "x-cell-data-hash"),
        format!("0x{}", "ab".repeat(32))
    );
    assert_eq!(header(&response, "x-cell-status"), "live");
    assert_eq!(
        header(&response, "etag"),
        format!("\"0x{}\"", "ab".repeat(32))
    );
    assert_eq!(
        header(&response, "cache-control"),
        "public, max-age=31536000, immutable",
        "the bytes at an outpoint cannot change, which is what makes `immutable` honest"
    );
    let body = response.bytes().await.expect("body");
    assert_eq!(body.as_ref(), LIVE_CELL_BYTES);

    // Back to back through the same permits: a semaphore that leaked one
    // would answer the first request and hang on the second forever.
    let again = tokio::time::timeout(
        Duration::from_secs(5),
        reqwest::get(cell_data_url(addr, &out_point)),
    )
    .await
    .expect("the second request is not waiting on a permit that never came back")
    .expect("GET succeeds");
    assert_eq!(again.status(), 200);
    assert_eq!(reads.load(Ordering::SeqCst), 2);

    handle.shutdown().await;
    server_task.abort();
}

#[tokio::test]
async fn a_spent_cell_still_answers_with_its_bytes() {
    let (addr, _reads, handle, server_task) = serve_cell_data().await;

    let response = reqwest::get(cell_data_url(addr, &dead_out_point()))
        .await
        .expect("GET succeeds");
    assert_eq!(response.status(), 200);
    assert_eq!(
        header(&response, "x-cell-status"),
        "dead",
        "a spent output's data is as true as a live one's; the header says which question was asked"
    );
    assert_eq!(
        header(&response, "x-cell-data-hash"),
        format!("0x{}", "cd".repeat(32))
    );
    let body = response.bytes().await.expect("body");
    assert_eq!(body.as_ref(), DEAD_CELL_BYTES);

    handle.shutdown().await;
    server_task.abort();
}

#[tokio::test]
async fn a_matching_etag_answers_304_with_the_same_cache_headers() {
    let (addr, _reads, handle, server_task) = serve_cell_data().await;
    let etag = format!("\"0x{}\"", "ab".repeat(32));

    let response = reqwest::Client::new()
        .get(cell_data_url(addr, &live_out_point()))
        .header("if-none-match", &etag)
        .send()
        .await
        .expect("GET succeeds");
    assert_eq!(response.status(), 304);
    assert_eq!(header(&response, "etag"), etag);
    assert_eq!(
        header(&response, "cache-control"),
        "public, max-age=31536000, immutable"
    );
    assert!(
        response.bytes().await.expect("body").is_empty(),
        "a 304 carries no payload"
    );

    handle.shutdown().await;
    server_task.abort();
}

#[tokio::test]
async fn an_unknown_outpoint_is_404_and_an_unreadable_node_is_502() {
    let (addr, _reads, handle, server_task) = serve_cell_data().await;

    let unknown = reqwest::get(cell_data_url(addr, &unknown_out_point()))
        .await
        .expect("GET succeeds");
    assert_eq!(unknown.status(), 404);
    let body: serde_json::Value = unknown.json().await.unwrap();
    assert_eq!(body["error"], "cell_unknown");

    let unreadable = reqwest::get(cell_data_url(addr, &unreadable_out_point()))
        .await
        .expect("GET succeeds");
    assert_eq!(
        unreadable.status(),
        502,
        "a node that could not be asked is a gateway failure, not a missing Cell"
    );
    let body: serde_json::Value = unreadable.json().await.unwrap();
    assert_eq!(body["error"], "node_unreachable");
    assert_eq!(
        body["message"],
        "the node could not serve this Cell's output data"
    );

    handle.shutdown().await;
    server_task.abort();
}

#[tokio::test]
async fn a_malformed_tx_hash_never_reaches_the_source() {
    let (addr, reads, handle, server_task) = serve_cell_data().await;

    for tx_hash in [
        "0xnothex",
        "0x1a1a",
        &"1a".repeat(32),
        &format!("0x{}", "1a".repeat(33)),
    ] {
        let response = reqwest::get(format!("http://{addr}/api/cells/{tx_hash}/0/data"))
            .await
            .expect("GET succeeds");
        assert_eq!(response.status(), 400, "tx_hash {tx_hash}");
        let body: serde_json::Value = response.json().await.unwrap();
        assert_eq!(body["error"], "invalid_out_point", "tx_hash {tx_hash}");
    }
    assert_eq!(
        reads.load(Ordering::SeqCst),
        0,
        "a hash of the wrong shape is a bug in the caller, not a question for the chain"
    );

    handle.shutdown().await;
    server_task.abort();
}

#[tokio::test]
async fn a_payload_over_the_valve_is_413() {
    let (addr, _reads, handle, server_task) = serve_cell_data().await;

    let response = reqwest::get(cell_data_url(addr, &oversized_out_point()))
        .await
        .expect("GET succeeds");
    assert_eq!(response.status(), 413);
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["error"], "cell_data_too_large");

    handle.shutdown().await;
    server_task.abort();
}

#[tokio::test]
async fn a_server_without_a_cell_data_reader_is_an_isolated_404() {
    let (router, handle) = ServerBuilder::new().build().expect("build");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    tokio::time::sleep(Duration::from_millis(50)).await;

    let response = reqwest::get(cell_data_url(addr, &live_out_point()))
        .await
        .expect("GET succeeds");
    assert_eq!(response.status(), 404);
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["error"], "cell_data_unavailable");

    let canonical = reqwest::get(format!("http://{addr}/api/entities/chain/snapshot"))
        .await
        .expect("canonical route remains available");
    assert_eq!(canonical.status(), 200);

    handle.shutdown().await;
    server_task.abort();
}

/// The browser guard on the plain routes. A page cannot set `Origin` itself,
/// so a request that carries a foreign one is a page that is not ours; a
/// request that carries a foreign `Host` is the shape DNS rebinding arrives
/// in, the address being loopback while the name is not. Neither may read
/// the node's telemetry, and the clients that are not browsers at all — no
/// origin, addressed to loopback — must go on being answered.
#[tokio::test]
async fn a_foreign_origin_or_host_is_refused_on_the_plain_routes() {
    let (router, handle) = ServerBuilder::new().build().expect("build");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    tokio::time::sleep(Duration::from_millis(50)).await;

    let client = reqwest::Client::new();
    let url = format!("http://{addr}/api/health");

    let foreign_host = client
        .get(&url)
        .header("host", "evil.example:7001")
        .send()
        .await
        .expect("GET succeeds");
    assert_eq!(foreign_host.status(), 403);
    let body: serde_json::Value = foreign_host.json().await.unwrap();
    assert_eq!(body["error"], "forbidden_host");

    let foreign_origin = client
        .get(&url)
        .header("origin", "https://evil.example")
        .send()
        .await
        .expect("GET succeeds");
    assert_eq!(foreign_origin.status(), 403);
    let body: serde_json::Value = foreign_origin.json().await.unwrap();
    assert_eq!(body["error"], "forbidden_origin");

    // The dashboard's own request, and the dev proxy's: origin and host are
    // both loopback under different names.
    let dev_proxy = client
        .get(&url)
        .header("origin", "http://localhost:5173")
        .send()
        .await
        .expect("GET succeeds");
    assert_eq!(dev_proxy.status(), 200);

    // curl, a monitor, this test harness: no origin at all.
    let no_origin = reqwest::get(&url).await.expect("GET succeeds");
    assert_eq!(no_origin.status(), 200);

    handle.shutdown().await;
    server_task.abort();
}

/// The same guard on the upgrade, which is the reason it exists: browsers
/// apply no CORS to a WebSocket, so a foreign page's `new WebSocket(...)`
/// would otherwise be answered with every frame the stream has.
#[tokio::test]
async fn a_foreign_origin_cannot_open_a_stream_and_a_loopback_page_can() {
    let (router, handle) = ServerBuilder::new().build().expect("build");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    tokio::time::sleep(Duration::from_millis(50)).await;

    let since = 50_000_000u64;
    let url = format!("ws://{addr}/api/entities/chain/stream?since={since}");

    let refusal = tokio_tungstenite::connect_async(stream_request(&url, "https://evil.example"))
        .await
        .expect_err("a foreign page is refused the upgrade");
    match refusal {
        tungstenite::Error::Http(response) => assert_eq!(response.status(), 403),
        other => panic!("the upgrade failed for some other reason: {other}"),
    }

    // The dev proxy forwards the Vite origin verbatim; a cursor from nowhere
    // is answered with a snapshot, so the frame proves the handshake got past
    // the guard rather than merely completing.
    let frame = first_frame_of(stream_request(&url, "http://localhost:5173")).await;
    assert_eq!(frame["kind"], "snapshot", "chain frame: {frame}");

    handle.shutdown().await;
    server_task.abort();
}
