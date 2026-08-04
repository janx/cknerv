//! End-to-end smoke: build a server, serve a real HTTP GET against the
//! chain snapshot endpoint, shut down. Catches Cargo manifest / routing
//! / state-wiring breakage that pure unit tests can't.

use std::time::Duration;

use async_trait::async_trait;
use cknerv_core::{
    AssetEcosystemCategory, AssetEcosystemRecord, CellGalaxy, CellSemanticRecord, ChainAnchor,
    EnrichmentSourceState, EnrichmentSourceStatus, Mutation, OutPoint, ReplayPhase,
    SemanticsProjection, TransactionSemanticRecord,
};
use cknerv_server::{Adapter, CanonicalContext, EnrichmentSource, ServerBuilder};
use tokio::sync::{mpsc, watch};

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
