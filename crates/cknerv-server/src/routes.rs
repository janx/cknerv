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
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use tokio::sync::{watch, Semaphore};

use cknerv_core::{EnrichmentEvent, OutPoint};

use crate::cell_data::{CellDataReader, CELL_DATA_IN_FLIGHT, CELL_DATA_MAX_BYTES};
use crate::enrichment::EnrichmentSource;
use crate::projection_registry::SnapshotEnvelope;
use crate::state::ServerState;

/// A year, the largest interval HTTP caching conventionally states. Paired
/// with `immutable` it tells the browser never to revalidate, which is only
/// honest because an outpoint's bytes cannot change — see
/// [`crate::cell_data`].
const CELL_DATA_CACHE_CONTROL: &str = "public, max-age=31536000, immutable";

/// Composite router state: shared `ServerState` + the shutdown receiver
/// WS handlers need. axum's `with_state` takes a single `Clone` value;
/// we bundle them in this struct so handlers can extract via `State`.
#[derive(Clone)]
pub struct RouterState {
    pub state: Arc<ServerState>,
    pub shutdown_rx: watch::Receiver<bool>,
    pub enrichment_source: Option<Arc<dyn EnrichmentSource>>,
    pub cell_data: Option<Arc<CellDataGate>>,
}

/// A configured [`CellDataReader`] plus the only thing bounding it.
///
/// The permits live with the reader rather than with the handler because
/// they are a property of the SOURCE — one node, asked one Cell at a time by
/// one pair of eyes — and not of the route. A server built without a reader
/// has no gate at all, which is what makes the route's absence total rather
/// than a handler that answers with an apology.
pub struct CellDataGate {
    pub reader: Arc<dyn CellDataReader>,
    pub permits: Semaphore,
}

impl CellDataGate {
    pub fn new(reader: Arc<dyn CellDataReader>) -> Self {
        Self {
            reader,
            permits: Semaphore::new(CELL_DATA_IN_FLIGHT),
        }
    }
}

pub fn build_router(
    state: Arc<ServerState>,
    shutdown_rx: watch::Receiver<bool>,
    enrichment_source: Option<Arc<dyn EnrichmentSource>>,
    cell_data: Option<Arc<CellDataGate>>,
) -> Router {
    Router::new()
        .route("/api/health", get(health))
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
        .route("/api/enrichment/peers/:node_id", get(enrich_peer))
        .route(
            "/api/cells/:tx_hash/:output_index/data",
            get(cell_output_data),
        )
        .with_state(RouterState {
            state,
            shutdown_rx,
            enrichment_source,
            cell_data,
        })
}

/// Liveness, in the shape an operator or a monitor reads it. Deliberately
/// answerable while the server is broken: no projection lock, no snapshot,
/// nothing here can panic on a lock some other failure poisoned.
async fn health(State(s): State<RouterState>) -> impl IntoResponse {
    Json(crate::health::report(&s.state))
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
    // Already-serialized text: the envelope is built in one pass by the
    // runtime, so nothing here re-encodes a `Value`.
    let (_, body) = runner.snapshot_envelope(SnapshotEnvelope::Bare);
    ([("content-type", "application/json")], body).into_response()
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
    // Opt-in: a client that can decode the columnar form says so, because a
    // binary frame carries no `kind` to recognise it by.
    let binary_snapshot = params.get("bin").is_some_and(|value| value == "1");
    let shutdown_rx = s.shutdown_rx.clone();
    ws.on_upgrade(move |socket| {
        crate::ws::handle_projection_stream(runner, socket, since, binary_snapshot, shutdown_rx)
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

/// How the network's own crawler last saw one peer, resolved on demand.
///
/// Three different true answers, in three different shapes:
///   * no source configured — `404 enrichment_disabled`, byte-for-byte what
///     the Cell and transaction routes answer, so a CKB-only dashboard reads
///     the whole plate as absent rather than as broken;
///   * the source answered and has no sighting — `200` carrying `unsighted`
///     and the reason. Never having been seen from outside is a fact about
///     the node, not a failure of the lookup, and a 404 here would bury it;
///   * a sighting — `200` carrying the record.
///
/// Unlike the Cell route, nothing is pushed into the semantics projection:
/// the record describes a network node rather than a chain object, so it has
/// no projection slot to age in and no anchor conflict to lose a record to.
/// The source still validates its canonical anchor around the fetch — a
/// chain change mid-flight surfaces as unavailable, never as an absence.
async fn enrich_peer(
    Path(node_id): Path<String>,
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
    match source.enrich_peer(&node_id, &context).await {
        Ok(lookup) => Json(lookup).into_response(),
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

/// One Cell's complete output data, read from chain truth on demand.
///
/// The canonical route the enrichment routes are not: no index is consulted,
/// no anchor is validated, nothing is pushed into a projection, and the route
/// is present in every mode — a CKB-only dashboard reads a Cell's bytes the
/// same way a ckbadger-backed one does. What arrives here is an outpoint, and
/// an outpoint names the same payload forever, so the answer is stamped
/// `immutable` and an `etag` and never has to be revalidated.
///
/// Six answers, each a different true thing:
///
///   * no reader configured — `404 cell_data_unavailable`, in the enrichment
///     routes' `{"error","message"}` shape so one client-side reader of that
///     shape covers every route on this server;
///   * a `tx_hash` that is not `0x` + 64 hex — `400 invalid_out_point`,
///     decided here so a typed URL never becomes a node round-trip;
///   * chain truth knows no such output — `404 cell_unknown`;
///   * chain truth could not be asked — `502 node_unreachable`, a gateway
///     failure because that is precisely what it is: this server was fine and
///     the thing behind it was not;
///   * more bytes than [`CELL_DATA_MAX_BYTES`] — `413 cell_data_too_large`;
///   * the bytes, as an octet stream, with the length, the data hash and the
///     live/dead status in headers so the client can check what it received
///     against what was promised without parsing the body.
async fn cell_output_data(
    Path((tx_hash, output_index)): Path<(String, u32)>,
    headers: HeaderMap,
    State(router): State<RouterState>,
) -> impl IntoResponse {
    let Some(gate) = router.cell_data else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": "cell_data_unavailable",
                "message": "no node is configured to read Cell data"
            })),
        )
            .into_response();
    };
    if !is_out_point_tx_hash(&tx_hash) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "invalid_out_point",
                "message": "tx_hash must be 0x followed by 64 hex characters"
            })),
        )
            .into_response();
    }
    let out_point = OutPoint {
        tx_hash,
        index: output_index,
    };

    // Held for the whole read: the permit is what keeps a reload storm from
    // competing with the canonical poll for the same node. `acquire` only
    // fails on a CLOSED semaphore, and nothing closes this one; if that ever
    // changes, a read the source could serve should still be served, just
    // unmetered — never refused over our own bookkeeping.
    let _permit = gate.permits.acquire().await.ok();
    let data = match gate.reader.read_output_data(&out_point).await {
        Ok(Some(data)) => data,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({
                    "error": "cell_unknown",
                    "message": "no such output exists on this chain"
                })),
            )
                .into_response();
        }
        Err(error) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({
                    "error": "node_unreachable",
                    "message": error.to_string()
                })),
            )
                .into_response();
        }
    };
    if data.bytes.len() > CELL_DATA_MAX_BYTES {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(serde_json::json!({
                "error": "cell_data_too_large",
                "message": format!(
                    "this output holds {} bytes; the route serves at most {CELL_DATA_MAX_BYTES}",
                    data.bytes.len()
                )
            })),
        )
            .into_response();
    }

    // The data hash IS the validator, so it is also the ETag: two responses
    // carrying the same hash carry the same bytes, by construction rather
    // than by convention.
    let etag = format!("\"{}\"", data.data_hash);
    if headers
        .get(axum::http::header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == etag)
    {
        // Only the caching headers: a 304 carries no body, and the headers
        // that describe one would be describing something we are not sending.
        // The client holding this ETag was handed all of them with the 200.
        return (
            StatusCode::NOT_MODIFIED,
            [
                ("etag", etag),
                ("cache-control", CELL_DATA_CACHE_CONTROL.to_string()),
            ],
        )
            .into_response();
    }

    (
        [
            ("content-type", "application/octet-stream".to_string()),
            ("content-length", data.bytes.len().to_string()),
            ("x-cell-data-bytes", data.bytes.len().to_string()),
            ("x-cell-data-hash", data.data_hash),
            (
                "x-cell-status",
                if data.live { "live" } else { "dead" }.to_string(),
            ),
            ("etag", etag),
            ("cache-control", CELL_DATA_CACHE_CONTROL.to_string()),
        ],
        data.bytes,
    )
        .into_response()
}

/// A CKB transaction hash on the wire: `0x` followed by exactly 64 hex
/// digits. Checked before the source is touched, because a hash of the wrong
/// shape is a bug in whoever built the URL and not a question about the
/// chain — answering it with a 404 would tell the browser the outpoint does
/// not exist, which is a claim nobody made.
fn is_out_point_tx_hash(tx_hash: &str) -> bool {
    let Some(body) = tx_hash.strip_prefix("0x") else {
        return false;
    };
    body.len() == 64 && body.bytes().all(|byte| byte.is_ascii_hexdigit())
}
