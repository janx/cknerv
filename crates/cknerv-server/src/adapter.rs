//! Adapter trait: data sources push `Mutation`s into the server.
//!
//! Implementations live elsewhere (cknerv-adapter-ckb, cknerv-adapter-ckbadger,
//! and ckb-rcg/simulator/.../sim_adapter.rs after B7). The server
//! `tokio::spawn`s each registered adapter and fans their mutations into the
//! entity store + projection pipeline.

use async_trait::async_trait;
use tokio::sync::{mpsc, watch};

use cknerv_core::Mutation;

/// Source of chain-generic Mutations. Run-to-completion async task; the
/// server signals shutdown via the `watch::Receiver<bool>` parameter so
/// adapters can drain cleanly before bus teardown.
///
/// Conventions:
///   * `run` should `select!` against `shutdown.changed()` so a
///     `ServerHandle::shutdown()` flips it to `true` and the adapter
///     drops its `Sender` clone promptly (otherwise the mpsc channel
///     never closes and the reducer task hangs on `recv`).
///   * Sending on `out` after `shutdown == true` is a no-op the runtime
///     will swallow — the adapter does not need to coordinate with the
///     reducer task itself.
///   * `Err` returned from `run` is logged by `cknerv-server` but does
///     not crash the server; other adapters keep running.
#[async_trait]
pub trait Adapter: Send + Sync + 'static {
    /// Human-readable identifier, e.g. "ckb-direct", "ckbadger", "simulator".
    /// Used in log lines; not user-facing on the wire.
    fn name(&self) -> &'static str;

    /// Run the adapter to completion. Push `Mutation`s into `out` as they
    /// become available. Exit cleanly when `shutdown` flips to `true`.
    async fn run(
        &self,
        out: mpsc::Sender<Mutation>,
        shutdown: watch::Receiver<bool>,
    ) -> anyhow::Result<()>;
}
