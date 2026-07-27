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

use crate::state::ServerState;

/// Composite router state: shared `ServerState` + the shutdown receiver
/// WS handlers need. axum's `with_state` takes a single `Clone` value;
/// we bundle them in this struct so handlers can extract via `State`.
#[derive(Clone)]
pub struct RouterState {
    pub state: Arc<ServerState>,
    pub shutdown_rx: watch::Receiver<bool>,
}

pub fn build_router(state: Arc<ServerState>, shutdown_rx: watch::Receiver<bool>) -> Router {
    Router::new()
        .route("/api/entities/chain/snapshot", get(entities_chain_snapshot))
        .route("/api/entities/chain/stream", get(entities_chain_stream))
        .route("/api/projections/:name/snapshot", get(projection_snapshot))
        .route("/api/projections/:name/stream", get(projection_stream))
        .with_state(RouterState { state, shutdown_rx })
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
    let RouterState { state, shutdown_rx } = s;
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
