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
//!   5. Arm a one-shot boot-replay persistence checkpoint.
//!   6. Spawn each adapter; each one drops a `Sender` clone into the
//!      shared mpsc; the reducer multiplexes them.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::Router;
use tokio::sync::{mpsc, watch};

use cknerv_core::{EnrichmentEvent, Mutation, Projection};

use crate::adapter::Adapter;
use crate::enrichment::EnrichmentSource;
use crate::projection_registry::Registry;
use crate::state::ServerState;

/// Capacity of the merged adapter → reducer mpsc. Matches simulator's
/// `MUTATION_CHANNEL_CAPACITY` so a single slow reducer cycle doesn't
/// reject mutations from a fast adapter; the broadcast bus downstream
/// uses the same capacity.
const MUTATION_PIPELINE_CAPACITY: usize = 4096;

const ENRICHMENT_PIPELINE_CAPACITY: usize = 256;
const ENRICHMENT_PROBE_INTERVAL: Duration = Duration::from_secs(5);
const ENRICHMENT_STATUS_REFRESH: Duration = Duration::from_secs(60);
const ENRICHMENT_ECOSYSTEM_REFRESH: Duration = Duration::from_secs(30);

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
    enrichment_projections: Vec<ProjectionInstaller>,
    enrichment_source: Option<Arc<dyn EnrichmentSource>>,
    workdir: Option<PathBuf>,
    restore_persisted: bool,
}

impl ServerBuilder {
    pub fn new() -> Self {
        Self {
            adapters: Vec::new(),
            projections: Vec::new(),
            enrichment_projections: Vec::new(),
            enrichment_source: None,
            workdir: None,
            restore_persisted: true,
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

    /// Register a projection that consumes the independent enrichment stream
    /// in addition to canonical reorg/rebuild invalidations.
    pub fn add_enrichment_projection<P>(mut self, projection: P) -> Self
    where
        P: cknerv_core::EnrichmentProjection,
    {
        self.enrichment_projections
            .push(Box::new(move |registry: &mut Registry| {
                registry.register_enrichment(projection)
            }));
        self
    }

    /// Configure one optional read-only enrichment source. Omitting this call
    /// leaves every canonical route and projection fully operational.
    pub fn enrichment_source<S>(mut self, source: S) -> Self
    where
        S: EnrichmentSource,
    {
        self.enrichment_source = Some(Arc::new(source));
        self
    }

    pub fn workdir(mut self, p: PathBuf) -> Self {
        self.workdir = Some(p);
        self
    }

    /// Control whether an existing persisted snapshot is hydrated before
    /// adapters start. Callers can disable restoration when lightweight
    /// metadata shows that a derived reservoir no longer satisfies the
    /// configured target; the next boot checkpoint atomically replaces it.
    pub fn restore_persisted(mut self, restore: bool) -> Self {
        self.restore_persisted = restore;
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
            for install in self.enrichment_projections {
                install(&mut registry);
            }
        }

        // 2. Hydrate from disk if a workdir was provided. Must happen
        //    BEFORE adapters spawn so the first arriving mutation
        //    doesn't conflict with a stale snapshot.
        if self.restore_persisted {
            if let Some(workdir) = self.workdir.as_ref() {
                let _ = crate::persistence::load(state.clone(), workdir);
            }
        }

        // 3. Pipeline channels.
        let (mutation_tx, mutation_rx) = mpsc::channel::<Mutation>(MUTATION_PIPELINE_CAPACITY);
        let (enrichment_tx, enrichment_rx) =
            mpsc::channel::<EnrichmentEvent>(ENRICHMENT_PIPELINE_CAPACITY);
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let save_lock = Arc::new(Mutex::new(()));

        // 4. Spawn the reducer.
        let reducer_handle = state
            .clone()
            .spawn_reducer(mutation_rx, shutdown_rx.clone());
        let enrichment_reducer_handle = state
            .clone()
            .spawn_enrichment_reducer(enrichment_rx, shutdown_rx.clone());

        // The optional source is supervised independently. Probe failures are
        // expressed as source status and never signal canonical shutdown.
        let enrichment_source = self.enrichment_source.clone();
        let enrichment_source_handle = enrichment_source.as_ref().map(|source| {
            let source = source.clone();
            let source_state = state.clone();
            let source_out = enrichment_tx.clone();
            let mut source_shutdown = shutdown_rx.clone();
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(ENRICHMENT_PROBE_INTERVAL);
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                let mut last_status = None;
                let mut last_publish = Instant::now()
                    .checked_sub(ENRICHMENT_STATUS_REFRESH)
                    .unwrap_or_else(Instant::now);
                let mut last_ecosystem_refresh: Option<Instant> = None;
                loop {
                    tokio::select! {
                        _ = interval.tick() => {
                            let context = source_state.canonical_context();
                            let status = source.probe(&context).await;
                            let changed = last_status.as_ref().is_none_or(|previous| {
                                status_materially_changed(previous, &status)
                            });
                            if changed || last_publish.elapsed() >= ENRICHMENT_STATUS_REFRESH {
                                if source_out
                                    .send(EnrichmentEvent::SourceStatus(status.clone()))
                                    .await
                                    .is_err()
                                {
                                    break;
                                }
                                last_status = Some(status.clone());
                                last_publish = Instant::now();
                            }
                            let ecosystem_ready = status.validated_anchor.is_some()
                                && matches!(
                                    status.status,
                                    cknerv_core::EnrichmentSourceState::Ready
                                        | cknerv_core::EnrichmentSourceState::Stale
                                )
                                && status
                                    .capabilities
                                    .iter()
                                    .any(|capability| capability == "asset_ecosystem");
                            let ecosystem_due = last_ecosystem_refresh
                                .is_none_or(|last| last.elapsed() >= ENRICHMENT_ECOSYSTEM_REFRESH);
                            if !ecosystem_ready {
                                last_ecosystem_refresh = None;
                            } else if ecosystem_due {
                                last_ecosystem_refresh = Some(Instant::now());
                                match source.enrich_asset_ecosystem(&context).await {
                                    Ok(Some(asset_ecosystem)) => {
                                        if source_out
                                            .send(EnrichmentEvent::AssetEcosystemReplace(
                                                asset_ecosystem,
                                            ))
                                            .await
                                            .is_err()
                                        {
                                            break;
                                        }
                                    }
                                    Ok(None) => {}
                                    Err(error) => tracing::warn!(
                                        target: "cknerv-server",
                                        "optional asset-ecosystem refresh failed: {error}"
                                    ),
                                }
                            }
                        }
                        changed = source_shutdown.changed() => {
                            if changed.is_err() || *source_shutdown.borrow() {
                                break;
                            }
                        }
                    }
                }
            })
        });

        // Persist the first usable derived snapshot as soon as boot replay
        // closes. This task listens to a lightweight watch signal rather than
        // the mutation broadcast, so historical Tx payloads are not cloned a
        // second time merely to detect the terminal progress marker.
        let checkpoint_handle = self.workdir.as_ref().map(|workdir| {
            let mut replay_complete = state.subscribe_boot_replay_completion();
            let mut checkpoint_shutdown = shutdown_rx.clone();
            let checkpoint_state = state.clone();
            let checkpoint_workdir = workdir.clone();
            let checkpoint_lock = save_lock.clone();
            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        changed = replay_complete.changed() => {
                            if changed.is_err() || *replay_complete.borrow() {
                                break;
                            }
                        }
                        changed = checkpoint_shutdown.changed() => {
                            if changed.is_err() || *checkpoint_shutdown.borrow() {
                                return;
                            }
                        }
                    }
                }

                let result = tokio::task::spawn_blocking(move || {
                    let _guard = checkpoint_lock.lock().unwrap();
                    crate::persistence::save(&checkpoint_state, &checkpoint_workdir)
                })
                .await;
                match result {
                    Ok(Ok(())) => tracing::info!(
                        target: "cknerv-server",
                        "boot replay checkpoint persisted"
                    ),
                    Ok(Err(e)) => tracing::warn!(
                        target: "cknerv-server",
                        "failed to persist boot replay checkpoint: {e}"
                    ),
                    Err(e) => tracing::warn!(
                        target: "cknerv-server",
                        "boot replay checkpoint task failed: {e}"
                    ),
                }
            })
        });

        // 6. Spawn adapters. Drop the local `mutation_tx` clone after
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

        let router = crate::routes::build_router(state.clone(), shutdown_rx, enrichment_source);
        let handle = ServerHandle {
            state,
            workdir: self.workdir,
            save_lock,
            shutdown_tx,
            adapter_handles,
            reducer_handle,
            enrichment_reducer_handle,
            enrichment_source_handle,
            checkpoint_handle,
        };

        Ok((router, handle))
    }
}

fn status_materially_changed(
    previous: &cknerv_core::EnrichmentSourceStatus,
    current: &cknerv_core::EnrichmentSourceStatus,
) -> bool {
    previous.source != current.source
        || previous.status != current.status
        || previous.capabilities != current.capabilities
        || previous.indexed_tip != current.indexed_tip
        || previous.lag_blocks != current.lag_blocks
        || previous.validated_anchor != current.validated_anchor
        || previous.message != current.message
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
    save_lock: Arc<Mutex<()>>,
    shutdown_tx: watch::Sender<bool>,
    adapter_handles: Vec<tokio::task::JoinHandle<anyhow::Result<()>>>,
    reducer_handle: tokio::task::JoinHandle<()>,
    enrichment_reducer_handle: tokio::task::JoinHandle<()>,
    enrichment_source_handle: Option<tokio::task::JoinHandle<()>>,
    checkpoint_handle: Option<tokio::task::JoinHandle<()>>,
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
            let _guard = self.save_lock.lock().unwrap();
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
        if let Some(handle) = self.enrichment_source_handle {
            let abort = handle.abort_handle();
            if tokio::time::timeout(Duration::from_secs(2), handle)
                .await
                .is_err()
            {
                tracing::warn!(
                    target: "cknerv-server",
                    "enrichment source did not exit within 2s; aborting"
                );
                abort.abort();
            }
        }
        if let Some(handle) = self.checkpoint_handle {
            let abort = handle.abort_handle();
            if tokio::time::timeout(std::time::Duration::from_secs(2), handle)
                .await
                .is_err()
            {
                tracing::warn!(
                    target: "cknerv-server",
                    "boot replay checkpoint did not exit within 2s; aborting"
                );
                abort.abort();
            }
        }
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
        let abort = self.enrichment_reducer_handle.abort_handle();
        if tokio::time::timeout(Duration::from_secs(2), self.enrichment_reducer_handle)
            .await
            .is_err()
        {
            tracing::warn!(
                target: "cknerv-server",
                "enrichment reducer did not exit within 2s; aborting"
            );
            abort.abort();
        }
    }
}
