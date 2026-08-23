//! cknerv-server — axum HTTP/WS server + Adapter trait for cknerv.
//!
//! The server owns the chain-generic dashboard pipeline lifted from
//! `simulator/src/dashboard/`: an EntityStore for the [`cknerv_core::Chain`]
//! singleton, a monotonic revision counter, a bounded mutation ring for
//! reconnect catch-up, a broadcast channel for live fan-out, and a
//! projection registry that dispatches each mutation into every registered
//! [`cknerv_core::Projection`] (e.g. `CellGalaxy`).
//!
//! Canonical data sources implement the [`Adapter`] trait; the server
//! `tokio::spawn`s each registered adapter and merges their mutation streams
//! into the reducer task. Optional indexed context implements
//! [`EnrichmentSource`] and uses a separate event pipeline with independent
//! projection revisions. Phase B7 wires the simulator's existing telemetry
//! bus through a `SimulatorAdapter`.
//!
//! Routes hosted (matching what `@cknerv/cache` consumes in PR B5):
//!   * `GET /api/health` — uptime, tip freshness, task liveness, and any
//!     projection a contained panic has quarantined.
//!   * `GET /api/entities/chain/snapshot` — full Chain entity snapshot.
//!   * `GET /api/entities/chain/stream`   — WS stream of `RevisionedMutation`s,
//!     resumable via `?since=<revision>`.
//!   * `GET /api/projections/:name/snapshot` — projection snapshot by name.
//!   * `GET /api/projections/:name/stream`   — WS delta stream by name,
//!     resumable via `?since=<revision>`.
//!   * `GET /api/enrichment/cells/:tx_hash/:output_index` — optional lazy
//!     indexed context for one selected canonical Cell.
//!   * `GET /api/enrichment/transactions/:tx_hash` — optional lazy indexed
//!     context for that Cell's origin transaction.
//!   * `GET /api/enrichment/peers/:node_id` — optional lazy crawler sighting
//!     for one peer the local node is linked to.

pub mod adapter;
mod composition_store;
pub mod enrichment;
mod enrichment_supervisor;
mod health;
pub mod persistence;
pub mod projection_registry;
pub mod routes;
pub mod server;
pub mod state;
pub mod ws;

pub use adapter::Adapter;
pub use enrichment::{CanonicalContext, EnrichmentSource, GalaxyCompositionHydrator};
pub use persistence::{peek_restored_chain_cursor, peek_restored_tip, RestoredChainCursor};
pub use server::{ServerBuilder, ServerHandle};
pub use state::ServerState;
