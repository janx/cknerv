//! Public mode exercises real HTTP/WS requests with the headers a reverse
//! proxy forwards. The existing server smoke tests pin local-mode refusals.

use std::{net::SocketAddr, time::Duration};

use async_trait::async_trait;
use cknerv_core::{
    CellGalaxy, CellSemanticRecord, EnrichmentSourceStatus, OutPoint, PeerSightingLookup,
    SemanticsProjection, TransactionSemanticRecord,
};
use cknerv_server::{
    BrowserAccessPolicy, CanonicalContext, CellDataReader, CellOutputData, EnrichmentSource,
    ServerBuilder, ServerHandle,
};
use futures_util::StreamExt;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

async fn serve(builder: ServerBuilder) -> (SocketAddr, ServerHandle, tokio::task::JoinHandle<()>) {
    let (router, handle) = builder.build().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (addr, handle, task)
}

#[tokio::test]
async fn public_http_and_all_streams_accept_proxy_headers_and_reconnect() {
    let (addr, handle, task) = serve(
        ServerBuilder::new()
            .browser_access(BrowserAccessPolicy::PublicReadOnly)
            .add_projection(CellGalaxy::new())
            .add_enrichment_projection(SemanticsProjection::new(None)),
    )
    .await;
    let client = reqwest::Client::new();
    for origin in [
        None,
        Some("https://nerv.example"),
        Some("https://another.example"),
    ] {
        for path in [
            "/api/health",
            "/api/entities/chain/snapshot",
            "/api/projections/cells/snapshot",
            "/api/projections/cells/snapshot.bin",
            "/api/projections/semantics/snapshot",
        ] {
            let mut request = client
                .get(format!("http://{addr}{path}"))
                .header("host", "nerv.example");
            if let Some(origin) = origin {
                request = request.header("origin", origin);
            }
            let response = request.send().await.unwrap();
            assert_eq!(response.status(), 200, "{path} / {origin:?}");
            assert!(!response
                .headers()
                .contains_key("access-control-allow-origin"));
        }
    }
    let post = client
        .post(format!("http://{addr}/api/health"))
        .header("host", "nerv.example")
        .send()
        .await
        .unwrap();
    assert_eq!(
        post.status(),
        405,
        "public mode does not introduce write routes"
    );

    for path in [
        "entities/chain",
        "projections/cells",
        "projections/semantics",
    ] {
        // A repeated handshake also exercises reconnection with a cursor
        // beyond this process's history, which must yield a fresh snapshot.
        for origin in ["https://nerv.example", "https://another.example"] {
            let mut request = format!("ws://{addr}/api/{path}/stream?since=99999")
                .into_client_request()
                .unwrap();
            request
                .headers_mut()
                .insert("host", "nerv.example".parse().unwrap());
            request
                .headers_mut()
                .insert("origin", origin.parse().unwrap());
            let (mut socket, _) = tokio_tungstenite::connect_async(request).await.unwrap();
            let frame = tokio::time::timeout(Duration::from_secs(2), socket.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap();
            let frame: serde_json::Value = serde_json::from_str(frame.to_text().unwrap()).unwrap();
            assert_eq!(frame["kind"], "snapshot", "{path}: {frame}");
            socket.close(None).await.unwrap();
        }
    }
    handle.shutdown().await;
    task.abort();
}

const PRIVATE_ERROR: &str =
    "request to http://internal-host:8114/private?token=PRIVATE_MARKER failed at /private/workdir";

struct FailingSource;

#[async_trait]
impl EnrichmentSource for FailingSource {
    fn name(&self) -> &'static str {
        "fixture"
    }
    fn capabilities(&self) -> Vec<String> {
        vec![]
    }
    async fn probe(&self, _: &CanonicalContext) -> EnrichmentSourceStatus {
        EnrichmentSourceStatus::connecting("fixture", vec![])
    }
    async fn enrich_cell(
        &self,
        _: &OutPoint,
        _: &CanonicalContext,
    ) -> anyhow::Result<Option<CellSemanticRecord>> {
        anyhow::bail!(PRIVATE_ERROR)
    }
    async fn enrich_transaction(
        &self,
        _: &str,
        _: &CanonicalContext,
    ) -> anyhow::Result<Option<TransactionSemanticRecord>> {
        anyhow::bail!(PRIVATE_ERROR)
    }
    async fn enrich_peer(
        &self,
        _: &str,
        _: &CanonicalContext,
    ) -> anyhow::Result<PeerSightingLookup> {
        anyhow::bail!(PRIVATE_ERROR)
    }
}

struct FailingCellReader;

#[async_trait]
impl CellDataReader for FailingCellReader {
    async fn read_output_data(&self, _: &OutPoint) -> anyhow::Result<Option<CellOutputData>> {
        anyhow::bail!(PRIVATE_ERROR)
    }
}

#[tokio::test]
async fn public_detail_errors_keep_status_and_code_without_upstream_details() {
    let (addr, handle, task) = serve(
        ServerBuilder::new()
            .browser_access(BrowserAccessPolicy::PublicReadOnly)
            .enrichment_source(FailingSource)
            .cell_data_reader(FailingCellReader),
    )
    .await;
    let hash = format!("0x{}", "ab".repeat(32));
    let client = reqwest::Client::new();
    for (path, status, code) in [
        (format!("cells/{hash}/0/data"), 502, "node_unreachable"),
        (
            format!("enrichment/cells/{hash}/0"),
            503,
            "enrichment_unavailable",
        ),
        (
            format!("enrichment/transactions/{hash}"),
            503,
            "enrichment_unavailable",
        ),
        (
            "enrichment/peers/QmPeer".into(),
            503,
            "enrichment_unavailable",
        ),
    ] {
        let response = client
            .get(format!("http://{addr}/api/{path}"))
            .header("host", "nerv.example")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), status);
        let text = response.text().await.unwrap();
        let body: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(body["error"], code);
        assert!(body["message"]
            .as_str()
            .unwrap()
            .contains("could not serve"));
        for private in ["internal-host", "PRIVATE_MARKER", "/private/workdir"] {
            assert!(!text.contains(private), "private diagnostic in {text}");
        }
    }
    handle.shutdown().await;
    task.abort();
}
