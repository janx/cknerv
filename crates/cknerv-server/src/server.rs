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
//!   5. Arm a one-shot boot-replay persistence checkpoint, and — when a
//!      canonical composition hydrator was configured — a one-shot
//!      restore of the last remembered CellGalaxy composition.
//!   6. Spawn each adapter; each one drops a `Sender` clone into the
//!      shared mpsc; the reducer multiplexes them.
//!   7. Spawn the supervisor over all of the above, so a task that dies
//!      outside shutdown says so on `/api/health` instead of leaving a
//!      server that heartbeats state it can no longer advance.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use tokio::sync::{mpsc, watch};

use cknerv_core::{
    CompositionDemandSink, EnrichmentEvent, Mutation, ObservedScriptsSink, Projection,
};

use crate::adapter::Adapter;
use crate::cell_data::CellDataReader;
use crate::composition_store::CompositionStore;
use crate::enrichment::{EnrichmentSource, GalaxyCompositionHydrator};
use crate::health::TaskRole;
use crate::projection_registry::Registry;
use crate::routes::CellDataGate;
use crate::state::ServerState;

/// Capacity of the merged adapter → reducer mpsc. Matches simulator's
/// `MUTATION_CHANNEL_CAPACITY` so a single slow reducer cycle doesn't
/// reject mutations from a fast adapter; the broadcast bus downstream
/// uses the same capacity.
const MUTATION_PIPELINE_CAPACITY: usize = 4096;

const ENRICHMENT_PIPELINE_CAPACITY: usize = 256;
/// Type-erased projection registration callback. Boxed so a single
/// `Vec<...>` can hold many heterogeneous projections.
type ProjectionInstaller = Box<dyn FnOnce(&mut Registry) + Send>;

/// Type-erased adapter spawn callback. Mirrors simulator's existing
/// `BoxFuture`-style wiring; the runner takes ownership of the adapter
/// so the `tokio::spawn`ed task isn't tied to the builder's lifetime.
trait AdapterRunner: Send + 'static {
    /// The adapter's own name, needed before it is consumed by `spawn` so
    /// the supervisor can say which one died.
    fn name(&self) -> &'static str;

    fn spawn(
        self: Box<Self>,
        out: mpsc::Sender<Mutation>,
        shutdown: watch::Receiver<bool>,
    ) -> tokio::task::JoinHandle<anyhow::Result<()>>;
}

struct AdapterBox<A: Adapter>(A);

impl<A: Adapter> AdapterRunner for AdapterBox<A> {
    fn name(&self) -> &'static str {
        Adapter::name(&self.0)
    }

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
    galaxy_composition_hydrator: Option<Arc<dyn GalaxyCompositionHydrator>>,
    cell_data_reader: Option<Arc<dyn CellDataReader>>,
    composition_demand: Option<Arc<CompositionDemandSink>>,
    observed_scripts: Option<Arc<ObservedScriptsSink>>,
    workdir: Option<PathBuf>,
    restore_persisted: bool,
    build_version: Option<String>,
}

impl ServerBuilder {
    pub fn new() -> Self {
        Self {
            adapters: Vec::new(),
            projections: Vec::new(),
            enrichment_projections: Vec::new(),
            enrichment_source: None,
            galaxy_composition_hydrator: None,
            cell_data_reader: None,
            composition_demand: None,
            observed_scripts: None,
            workdir: None,
            restore_persisted: true,
            build_version: None,
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

    /// Hand the server the canonical hydrator on its own, so the last
    /// remembered CellGalaxy composition can be revalidated and staged at
    /// boot instead of the stage waiting out a fresh discovery.
    ///
    /// Deliberately separate from [`Self::enrichment_source`]: restoring
    /// needs nothing but the node — the outpoints are already known, and
    /// what has to be decided about them (is this still live, is it still
    /// this capacity, is it still this class) only the node can answer.
    /// Omitting the call leaves the file unread and every boot composing
    /// from discovery, which is what a first boot does anyway.
    pub fn galaxy_composition_hydrator<H>(mut self, hydrator: H) -> Self
    where
        H: GalaxyCompositionHydrator,
    {
        self.galaxy_composition_hydrator = Some(Arc::new(hydrator));
        self
    }

    /// Hand the server something that can read one Cell's complete output
    /// data, which arms `GET /api/cells/:tx_hash/:output_index/data`.
    ///
    /// Deliberately separate from every other seam here, and unconditional at
    /// the call site: chain bytes are canonical, so this belongs to the node
    /// and not to an index, and a dashboard reading a Cell in CKB-only mode
    /// must be able to see the whole payload. Omitting the call leaves the
    /// route answering `404 cell_data_unavailable`, which is what a host
    /// without a node to ask should say.
    pub fn cell_data_reader<R>(mut self, reader: R) -> Self
    where
        R: CellDataReader,
    {
        self.cell_data_reader = Some(Arc::new(reader));
        self
    }

    /// Share the cell galaxy's composition-demand sink with the server,
    /// so the enrichment supervisor can see what the display plane is
    /// short of. Pass the SAME `Arc` given to
    /// `CellGalaxy::with_composition_demand_sink`; omitting the call
    /// leaves demand unread and every supply path idle.
    pub fn composition_demand_sink(mut self, sink: Arc<CompositionDemandSink>) -> Self {
        self.composition_demand = Some(sink);
        self
    }

    /// The other half of `CellGalaxy::with_observed_scripts_sink`: without
    /// both calls the enrichment side is handed an empty observed set and
    /// names nothing.
    pub fn observed_scripts_sink(mut self, sink: Arc<ObservedScriptsSink>) -> Self {
        self.observed_scripts = Some(sink);
        self
    }

    pub fn workdir(mut self, p: PathBuf) -> Self {
        self.workdir = Some(p);
        self
    }

    /// Which build is running, for `/api/health`. Only the host binary is
    /// compiled with the commit stamp, so it hands the same string here
    /// that it serves in the SPA's runtime config; omitting the call leaves
    /// the field null.
    pub fn build_version(mut self, version: impl Into<String>) -> Self {
        self.build_version = Some(version.into());
        self
    }

    /// Control whether an existing persisted snapshot is hydrated before
    /// adapters start. Callers can disable restoration when lightweight
    /// metadata shows that a derived reservoir no longer satisfies the
    /// configured target; the next boot checkpoint atomically replaces it.
    ///
    /// The remembered CellGalaxy composition
    /// ([`Self::galaxy_composition_hydrator`]) obeys this too: it is the
    /// same claim about the same life, and a boot that rebuilds one of
    /// them while restoring the other is a boot that agrees with itself
    /// about nothing.
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
        let mut state = ServerState::new();
        if let Some(sink) = self.composition_demand {
            state.set_composition_demand_sink(sink);
        }
        if let Some(sink) = self.observed_scripts {
            state.set_observed_scripts_sink(sink);
        }
        let state = Arc::new(state);
        if let Some(version) = self.build_version.as_deref() {
            state.set_build_version(version);
        }
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
        // Bounded aggregate refreshes use their own due times and limited
        // concurrency so a slow capability cannot delay source health.
        //
        // The composition store is the stage's memory between runs: the
        // supervisor writes a composition to it the moment one is proved,
        // and the restore task below reads it back at the next boot. Both
        // halves need a workdir and nothing else.
        let composition_store = self
            .workdir
            .as_ref()
            .map(|workdir| Arc::new(CompositionStore::new(workdir)));
        let enrichment_source = self.enrichment_source.clone();
        let enrichment_source_handle = enrichment_source.as_ref().map(|source| {
            crate::enrichment_supervisor::spawn(
                source.clone(),
                state.clone(),
                enrichment_tx.clone(),
                shutdown_rx.clone(),
                composition_store.clone(),
            )
        });

        // 5b. The stage's warm boot. Runs entirely beside canonical boot:
        //     it waits for canonical evidence rather than holding anything
        //     up, revalidates every remembered outpoint through the node,
        //     and delivers what survives on the same event channel a fresh
        //     composition uses — so the reducer, the display plane and the
        //     registry cannot tell the two apart, which is the point. Every
        //     way it can fail ends in the boot it would otherwise have had.
        //
        //     Rides `restore_persisted` with the canonical state rather
        //     than carrying a switch of its own. That flag is the server
        //     saying "this process is resuming a life it already had", and
        //     it is the same claim the remembered composition makes; when
        //     the caller withdraws it — a changed Cell target, an explicit
        //     replay override — canonical state is rebuilt from the chain
        //     and the stage rebuilds with it. Two memories on two switches
        //     is how a boot ends up half restored and half rebuilt.
        let composition_restore_handle = self
            .galaxy_composition_hydrator
            .filter(|_| self.restore_persisted)
            .zip(self.workdir.clone())
            .map(|(hydrator, workdir)| {
                crate::composition_store::spawn_restore(
                    hydrator,
                    state.clone(),
                    workdir,
                    enrichment_tx.clone(),
                    shutdown_rx.clone(),
                )
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
        let mut watched = vec![(
            state.health().watch(TaskRole::Reducer, "reducer"),
            reducer_handle.abort_handle(),
        )];
        // The enrichment pair is watched only when a source is configured.
        // Without one nothing can ever send, so its reducer exits the
        // moment `build` drops the local sender — by design, and reporting
        // that as a death would leave every CKB-only deployment permanently
        // "degraded" over a pipeline it never asked for.
        if let Some(handle) = enrichment_source_handle.as_ref() {
            watched.push((
                state
                    .health()
                    .watch(TaskRole::EnrichmentReducer, "enrichment-reducer"),
                enrichment_reducer_handle.abort_handle(),
            ));
            watched.push((
                state
                    .health()
                    .watch(TaskRole::EnrichmentSource, "enrichment-source"),
                handle.abort_handle(),
            ));
        }
        for adapter in self.adapters {
            let name = adapter.name();
            let tx = mutation_tx.clone();
            let sd = shutdown_rx.clone();
            let handle = adapter.spawn(tx, sd);
            watched.push((
                state.health().watch(TaskRole::Adapter, name),
                handle.abort_handle(),
            ));
            adapter_handles.push(handle);
        }
        drop(mutation_tx);

        // 7. Supervise them. Nothing above notices its own death: the
        //    handles are awaited only in `shutdown()`, so without this a
        //    dead adapter (or a reducer whose senders all dropped) leaves a
        //    server heartbeating state that can no longer advance.
        let supervisor_handle = crate::health::spawn_supervisor(watched, shutdown_rx.clone());

        // The gate is built here rather than in the router so the permits
        // are created once per server life, not once per request path.
        let cell_data = self
            .cell_data_reader
            .map(|reader| Arc::new(CellDataGate::new(reader)));
        let router =
            crate::routes::build_router(state.clone(), shutdown_rx, enrichment_source, cell_data);
        let handle = ServerHandle {
            state,
            workdir: self.workdir,
            save_lock,
            shutdown_tx,
            adapter_handles,
            reducer_handle,
            enrichment_reducer_handle,
            enrichment_source_handle,
            composition_restore_handle,
            checkpoint_handle,
            supervisor_handle,
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
    save_lock: Arc<Mutex<()>>,
    shutdown_tx: watch::Sender<bool>,
    adapter_handles: Vec<tokio::task::JoinHandle<anyhow::Result<()>>>,
    reducer_handle: tokio::task::JoinHandle<()>,
    enrichment_reducer_handle: tokio::task::JoinHandle<()>,
    enrichment_source_handle: Option<tokio::task::JoinHandle<()>>,
    composition_restore_handle: Option<tokio::task::JoinHandle<()>>,
    checkpoint_handle: Option<tokio::task::JoinHandle<()>>,
    supervisor_handle: tokio::task::JoinHandle<()>,
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
        // The supervisor goes first: everything below is about to exit on
        // purpose, and it must not be awake to call that a death.
        let abort = self.supervisor_handle.abort_handle();
        if tokio::time::timeout(Duration::from_secs(2), self.supervisor_handle)
            .await
            .is_err()
        {
            tracing::warn!(
                target: "cknerv-server",
                "task supervisor did not exit within 2s; aborting"
            );
            abort.abort();
        }
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
        if let Some(handle) = self.composition_restore_handle {
            let abort = handle.abort_handle();
            if tokio::time::timeout(Duration::from_secs(2), handle)
                .await
                .is_err()
            {
                tracing::warn!(
                    target: "cknerv-server",
                    "composition restore did not exit within 2s; aborting"
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
