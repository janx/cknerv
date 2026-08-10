//! axum HTTP/WS routes for the chain-generic dashboard.
//!
//! Routes are intentionally scoped to chain + projection — RCG-specific
//! routes (composer / OT tables, balance poller, event log, profile)
//! stay in simulator and live behind a parallel router that
//! `axum::Router::merge`s with `cknerv-server`'s router. See
//! `ServerBuilder::build` for how callers compose.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, Query, State, WebSocketUpgrade};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use tokio::sync::watch;

use cknerv_core::{EnrichmentEvent, OutPoint};

use crate::enrichment::EnrichmentSource;
use crate::state::ServerState;

/// Composite router state: shared `ServerState` + the shutdown receiver
/// WS handlers need. axum's `with_state` takes a single `Clone` value;
/// we bundle them in this struct so handlers can extract via `State`.
#[derive(Clone)]
pub struct RouterState {
    pub state: Arc<ServerState>,
    pub shutdown_rx: watch::Receiver<bool>,
    pub enrichment_source: Option<Arc<dyn EnrichmentSource>>,
}

pub fn build_router(
    state: Arc<ServerState>,
    shutdown_rx: watch::Receiver<bool>,
    enrichment_source: Option<Arc<dyn EnrichmentSource>>,
) -> Router {
    Router::new()
        .route("/api/entities/chain/snapshot", get(entities_chain_snapshot))
        .route("/api/entities/chain/stream", get(entities_chain_stream))
        .route("/api/projections/:name/snapshot", get(projection_snapshot))
        .route(
            "/api/projections/:name/snapshot.bin",
            get(projection_snapshot_bin),
        )
        .route("/api/projections/:name/stream", get(projection_stream))
        .route(
            "/api/enrichment/cells/:tx_hash/:output_index",
            get(enrich_cell),
        )
        .route(
            "/api/enrichment/transactions/:tx_hash",
            get(enrich_transaction),
        )
        .with_state(RouterState {
            state,
            shutdown_rx,
            enrichment_source,
        })
}

async fn entities_chain_snapshot(State(s): State<RouterState>) -> Json<serde_json::Value> {
    Json(s.state.snapshot())
}

async fn entities_chain_stream(
    ws: WebSocketUpgrade,
    Query(params): Query<HashMap<String, String>>,
    State(s): State<RouterState>,
) -> impl IntoResponse {
    let since: Option<u64> = params.get("since").and_then(|s| s.parse().ok());
    let RouterState {
        state, shutdown_rx, ..
    } = s;
    ws.on_upgrade(move |socket| crate::ws::handle_chain_stream(state, socket, since, shutdown_rx))
}

async fn projection_snapshot(
    Path(name): Path<String>,
    State(s): State<RouterState>,
) -> impl IntoResponse {
    let runner = match s.state.projections.read().unwrap().lookup(&name) {
        Some(r) => r,
        None => {
            return (StatusCode::NOT_FOUND, format!("no projection: {name}")).into_response();
        }
    };
    let (revision, snapshot) = runner.snapshot_json();
    Json(serde_json::json!({
        "revision": revision,
        "snapshot": snapshot,
    }))
    .into_response()
}

/// Columnar snapshot: raw little-endian bytes (revision already patched into
/// the header by the runtime, mirrored in `x-snapshot-revision` for clients
/// that want it before parsing). 404 both for unknown projections and for
/// projections without a binary form, so old servers and non-columnar
/// projections look identical to the client's fallback probe.
async fn projection_snapshot_bin(
    Path(name): Path<String>,
    State(s): State<RouterState>,
) -> impl IntoResponse {
    let runner = match s.state.projections.read().unwrap().lookup(&name) {
        Some(r) => r,
        None => {
            return (StatusCode::NOT_FOUND, format!("no projection: {name}")).into_response();
        }
    };
    let Some((revision, bytes)) = runner.snapshot_bin() else {
        return (
            StatusCode::NOT_FOUND,
            format!("projection {name} has no columnar snapshot"),
        )
            .into_response();
    };
    (
        [
            ("content-type", "application/octet-stream".to_string()),
            ("x-snapshot-revision", revision.to_string()),
        ],
        bytes,
    )
        .into_response()
}

async fn projection_stream(
    ws: WebSocketUpgrade,
    Path(name): Path<String>,
    Query(params): Query<HashMap<String, String>>,
    State(s): State<RouterState>,
) -> impl IntoResponse {
    let runner = match s.state.projections.read().unwrap().lookup(&name) {
        Some(r) => r,
        None => {
            return (StatusCode::NOT_FOUND, format!("no projection: {name}")).into_response();
        }
    };
    let since: Option<u64> = params.get("since").and_then(|s| s.parse().ok());
    let shutdown_rx = s.shutdown_rx.clone();
    ws.on_upgrade(move |socket| {
        crate::ws::handle_projection_stream(runner, socket, since, shutdown_rx)
    })
    .into_response()
}

async fn enrich_cell(
    Path((tx_hash, output_index)): Path<(String, u32)>,
    State(router): State<RouterState>,
) -> impl IntoResponse {
    let Some(source) = router.enrichment_source else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": "enrichment_disabled",
                "message": "no enrichment source is configured"
            })),
        )
            .into_response();
    };
    let out_point = OutPoint {
        tx_hash,
        index: output_index,
    };
    let context = router.state.canonical_context();
    match source.enrich_cell(&out_point, &context).await {
        Ok(Some(record)) => {
            if !router
                .state
                .apply_enrichment(EnrichmentEvent::CellUpsert(Box::new(record.clone())))
            {
                return (
                    StatusCode::CONFLICT,
                    Json(serde_json::json!({
                        "error": "anchor_expired",
                        "message": "the canonical chain changed while enrichment was loading"
                    })),
                )
                    .into_response();
            }
            Json(serde_json::json!({ "cell": record })).into_response()
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": "cell_not_indexed",
                "message": "the enrichment source has no record for this outpoint"
            })),
        )
            .into_response(),
        Err(error) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "enrichment_unavailable",
                "message": error.to_string()
            })),
        )
            .into_response(),
    }
}

async fn enrich_transaction(
    Path(tx_hash): Path<String>,
    State(router): State<RouterState>,
) -> impl IntoResponse {
    let Some(source) = router.enrichment_source else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": "enrichment_disabled",
                "message": "no enrichment source is configured"
            })),
        )
            .into_response();
    };
    let context = router.state.canonical_context();
    match source.enrich_transaction(&tx_hash, &context).await {
        Ok(Some(record)) => {
            if !router
                .state
                .apply_enrichment(EnrichmentEvent::TransactionUpsert(Box::new(record.clone())))
            {
                return (
                    StatusCode::CONFLICT,
                    Json(serde_json::json!({
                        "error": "anchor_expired",
                        "message": "the canonical chain changed while enrichment was loading"
                    })),
                )
                    .into_response();
            }
            Json(serde_json::json!({ "transaction": record })).into_response()
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": "transaction_not_indexed",
                "message": "the enrichment source has no record for this transaction"
            })),
        )
            .into_response(),
        Err(error) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "enrichment_unavailable",
                "message": error.to_string()
            })),
        )
            .into_response(),
    }
}
