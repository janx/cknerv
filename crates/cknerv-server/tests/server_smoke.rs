//! End-to-end smoke: build a server, serve a real HTTP GET against the
//! chain snapshot endpoint, shut down. Catches Cargo manifest / routing
//! / state-wiring breakage that pure unit tests can't.

use std::time::Duration;

use cknerv_server::ServerBuilder;

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
    use cknerv_core::CellGalaxy;

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
