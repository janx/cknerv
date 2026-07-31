//! End-to-end smoke: build a server, serve a real HTTP GET against the
//! chain snapshot endpoint, shut down. Catches Cargo manifest / routing
//! / state-wiring breakage that pure unit tests can't.

use std::time::Duration;

use async_trait::async_trait;
use cknerv_core::{CellGalaxy, Mutation, ReplayPhase};
use cknerv_server::{Adapter, ServerBuilder};
use tokio::sync::{mpsc, watch};

struct CompletedBootReplayAdapter;

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
