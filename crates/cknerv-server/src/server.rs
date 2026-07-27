//! `ServerBuilder` + `ServerHandle` — public composition surface.
//!
//! `ServerBuilder` accepts adapters + projections + optional workdir,
//! and returns an `axum::Router` (for the caller to host with
//! `axum::serve` or merge into a larger router) plus a `ServerHandle`
//! that owns the spawned background tasks and exposes a `shutdown`
//! method.
//!
//! Boot sequencing:
//!   1. Build empty `ServerState`.
//!   2. Register every projection (under the registry's write lock).
//!   3. Load persisted state if a workdir was provided — must happen
//!      BEFORE adapters spawn, so the first arriving mutation doesn't
//!      conflict with a stale snapshot.
//!   4. Spawn the reducer task: drains `mutation_rx`, applies into
//!      `ServerState`.
//!   5. Spawn each adapter; each one drops a `Sender` clone into the
//!      shared mpsc; the reducer multiplexes them.

use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use tokio::sync::{mpsc, watch};

use cknerv_core::{Mutation, Projection};

use crate::adapter::Adapter;
use crate::projection_registry::Registry;
use crate::state::ServerState;

/// Capacity of the merged adapter → reducer mpsc. Matches simulator's
/// `MUTATION_CHANNEL_CAPACITY` so a single slow reducer cycle doesn't
/// reject mutations from a fast adapter; the broadcast bus downstream
/// uses the same capacity.
const MUTATION_PIPELINE_CAPACITY: usize = 4096;

/// Type-erased projection registration callback. Boxed so a single
/// `Vec<...>` can hold many heterogeneous projections.
type ProjectionInstaller = Box<dyn FnOnce(&mut Registry) + Send>;

/// Type-erased adapter spawn callback. Mirrors simulator's existing
/// `BoxFuture`-style wiring; the runner takes ownership of the adapter
/// so the `tokio::spawn`ed task isn't tied to the builder's lifetime.
trait AdapterRunner: Send + 'static {
    fn spawn(
        self: Box<Self>,
        out: mpsc::Sender<Mutation>,
        shutdown: watch::Receiver<bool>,
    ) -> tokio::task::JoinHandle<anyhow::Result<()>>;
}

struct AdapterBox<A: Adapter>(A);

impl<A: Adapter> AdapterRunner for AdapterBox<A> {
    fn spawn(
        self: Box<Self>,
        out: mpsc::Sender<Mutation>,
        shutdown: watch::Receiver<bool>,
    ) -> tokio::task::JoinHandle<anyhow::Result<()>> {
        let AdapterBox(adapter) = *self;
        let name = Adapter::name(&adapter);
        tokio::spawn(async move {
            let result = adapter.run(out, shutdown).await;
            if let Err(ref e) = result {
                tracing::error!(
                    target: "cknerv-server",
                    "adapter `{name}` exited with error: {e}"
                );
            }
            result
        })
    }
}

pub struct ServerBuilder {
    adapters: Vec<Box<dyn AdapterRunner>>,
    projections: Vec<ProjectionInstaller>,
    workdir: Option<PathBuf>,
}

impl ServerBuilder {
    pub fn new() -> Self {
        Self {
            adapters: Vec::new(),
            projections: Vec::new(),
            workdir: None,
        }
    }

    pub fn add_adapter<A: Adapter>(mut self, adapter: A) -> Self {
        self.adapters.push(Box::new(AdapterBox(adapter)));
        self
    }

    pub fn add_projection<P>(mut self, projection: P) -> Self
    where
        P: Projection,
    {
        self.projections
            .push(Box::new(move |reg: &mut Registry| reg.register(projection)));
        self
    }

    pub fn workdir(mut self, p: PathBuf) -> Self {
        self.workdir = Some(p);
        self
    }

    /// Build the server. Returns an `axum::Router` for the caller to
    /// host or merge into a parent router, plus a `ServerHandle` for
    /// shutdown.
    ///
    /// The router uses chain-generic paths (`/api/entities/chain/...`,
    /// `/api/projections/...`). To run the server, the caller binds a
    /// `TcpListener` and calls `axum::serve(listener, router)`. The
    /// router can also be `Router::merge`d into a parent if the caller
    /// wants to host extra RCG-specific routes alongside.
    pub fn build(self) -> anyhow::Result<(Router, ServerHandle)> {
        // 1. Empty state + projection registration.
        let state = Arc::new(ServerState::new());
        {
            let mut registry = state.projections.write().unwrap();
            for install in self.projections {
                install(&mut registry);
            }
        }

        // 2. Hydrate from disk if a workdir was provided. Must happen
        //    BEFORE adapters spawn so the first arriving mutation
        //    doesn't conflict with a stale snapshot.
        if let Some(workdir) = self.workdir.as_ref() {
            let _ = crate::persistence::load(state.clone(), workdir);
        }

        // 3. Pipeline channels.
        let (mutation_tx, mutation_rx) = mpsc::channel::<Mutation>(MUTATION_PIPELINE_CAPACITY);
        let (shutdown_tx, shutdown_rx) = watch::channel(false);

        // 4. Spawn the reducer.
        let reducer_handle = state
            .clone()
            .spawn_reducer(mutation_rx, shutdown_rx.clone());

        // 5. Spawn adapters. Drop the local `mutation_tx` clone after
        //    fanning out — when every adapter exits and drops its
        //    clone, `mutation_rx.recv()` returns `None` and the reducer
        //    exits naturally even if no one called shutdown.
        let mut adapter_handles = Vec::new();
        for adapter in self.adapters {
            let tx = mutation_tx.clone();
            let sd = shutdown_rx.clone();
            adapter_handles.push(adapter.spawn(tx, sd));
        }
        drop(mutation_tx);

        let router = crate::routes::build_router(state.clone(), shutdown_rx);
        let handle = ServerHandle {
            state,
            workdir: self.workdir,
            shutdown_tx,
            adapter_handles,
            reducer_handle,
        };

        Ok((router, handle))
    }
}

impl Default for ServerBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Owning handle for the server's spawned tasks. Drop without calling
/// `shutdown()` and the tasks keep running until their channels close
/// naturally (adapters drop their `Sender` → reducer's `recv()`
/// returns `None`). `shutdown()` is the prompt path.
pub struct ServerHandle {
    state: Arc<ServerState>,
    workdir: Option<PathBuf>,
    shutdown_tx: watch::Sender<bool>,
    adapter_handles: Vec<tokio::task::JoinHandle<anyhow::Result<()>>>,
    reducer_handle: tokio::task::JoinHandle<()>,
}

impl ServerHandle {
    /// Shared `ServerState`. Useful for tests and for callers that want
    /// to attach extra routes that read the same chain entity.
    pub fn state(&self) -> Arc<ServerState> {
        self.state.clone()
    }

    /// If a workdir was configured, persist the current state to
    /// `<workdir>/cknerv-state.json` (atomic write). Returns the error
    /// if persistence failed. No-op (returns `Ok(())`) if no workdir
    /// was configured.
    pub fn save(&self) -> std::io::Result<()> {
        if let Some(workdir) = self.workdir.as_ref() {
            crate::persistence::save(&self.state, workdir)?;
        }
        Ok(())
    }

    /// Signal shutdown to every adapter + the reducer, then await them
    /// with a 2s timeout each (matches simulator's
    /// `dashboard::ServerHandle::stop` cadence). Idempotent on the
    /// watch channel — repeated calls have no further effect.
    pub async fn shutdown(self) {
        let _ = self.shutdown_tx.send(true);
        for h in self.adapter_handles {
            let abort = h.abort_handle();
            if tokio::time::timeout(std::time::Duration::from_secs(2), h)
                .await
                .is_err()
            {
                tracing::warn!(
                    target: "cknerv-server",
                    "adapter did not exit within 2s of shutdown signal; aborting"
                );
                abort.abort();
            }
        }
        let abort = self.reducer_handle.abort_handle();
        if tokio::time::timeout(std::time::Duration::from_secs(2), self.reducer_handle)
            .await
            .is_err()
        {
            tracing::warn!(
                target: "cknerv-server",
                "reducer did not exit within 2s of shutdown signal; aborting"
            );
            abort.abort();
        }
    }
}
