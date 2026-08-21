//! Server state: chain-generic EntityStore + revision counter + mutation
//! pipeline + projection registry.
//!
//! Lifted from `simulator/src/dashboard/state.rs`. cknerv-server keeps only
//! the chain-side reducer arms (`BlockMined`, `TxLanded`,
//! `ChainMempoolUpdated`, `ChainInfoUpdated`); RCG entity arms stay in
//! simulator's `SimulatorAdapter` post-extraction. The simulator
//! re-attaches its RCG state to the server snapshot via a parallel
//! channel (out of scope for this crate).
//!
//! Lock discipline matches the simulator:
//!   * One coord write lock around (entity-store mutate + revision bump +
//!     ring push + broadcast) so `snapshot()` readers see (state, revision)
//!     atomically.
//!   * Projection registry write happens under its own internal lock,
//!     released before the per-projection broadcast send. We never hold a
//!     sync lock across an `.await`.

use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock, RwLock};

use serde_json::value::RawValue;
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::{broadcast, mpsc, watch};

use cknerv_core::{
    Chain, ChainNode, CompositionDemand, CompositionDemandSink, EnrichmentEvent,
    EnrichmentSourceState, MempoolStats, Mutation, ObservedScriptsSink, Peer, RecentBlock,
    RecentTx, ReplayPhase, RevisionedMutation, Ring,
};

use crate::enrichment::CanonicalContext;
use crate::health::ServerHealth;
use crate::projection_registry::{past_poison, Quarantinable, Registry};

/// One structural mutation as both readers of it want it: the typed form
/// the projections reduce, and the wire text every entity-stream client
/// sends.
///
/// The text is built on FIRST send and shared from then on. A mutation
/// nobody is watching is never serialized at all; a mutation ten clients
/// are watching is serialized once, not ten times, and a reconnect
/// replaying it out of the ring reuses those same bytes years-of-uptime
/// later. Derefs to the [`RevisionedMutation`] so `revision` / `mutation`
/// read exactly as before.
#[derive(Debug)]
pub struct SharedMutationEntry {
    revisioned: RevisionedMutation,
    wire: OnceLock<Box<RawValue>>,
}

impl SharedMutationEntry {
    fn new(revisioned: RevisionedMutation) -> Self {
        Self {
            revisioned,
            wire: OnceLock::new(),
        }
    }

    /// The mutation's wire text — what `mutations: [...]` carries in an
    /// entity delta frame. Callers embed the borrow; nobody re-renders.
    pub fn serialized(&self) -> &RawValue {
        self.wire.get_or_init(|| {
            serde_json::value::to_raw_value(&self.revisioned).unwrap_or_else(|_| {
                RawValue::from_string("null".to_string()).expect("null is JSON")
            })
        })
    }
}

impl std::ops::Deref for SharedMutationEntry {
    type Target = RevisionedMutation;

    fn deref(&self) -> &Self::Target {
        &self.revisioned
    }
}

/// Reference-counted structural mutation. The ring holds up to 50k of them
/// and every connecting client snapshots it, so entries are shared rather
/// than deep-copied — same reason the projection deltas are.
pub type SharedMutation = Arc<SharedMutationEntry>;

/// Capacity of the structural mutation ring. Sized to cover dozens of
/// minutes of real activity so a reconnecting client at a stale revision
/// can still catch up via deltas instead of pulling a full snapshot.
/// Matches simulator's `MUTATION_RING_CAP`.
const MUTATION_RING_CAP: usize = 50_000;

/// Capacity of the broadcast channel for live mutation fan-out. Slow
/// consumers exceeding this lag get a `Lagged(n)` error and resync.
/// Matches simulator's `MUTATION_CHANNEL_CAPACITY`.
const MUTATION_CHANNEL_CAPACITY: usize = 4096;

/// Bound on `Chain.recent_blocks`. Matches simulator's `RECENT_BLOCKS_CAP`.
const RECENT_BLOCKS_CAP: usize = 50;

/// Bound on `Chain.recent_tx_hashes`. Matches simulator's `RECENT_TX_CAP`.
const RECENT_TX_CAP: usize = 50;

/// Chain-generic entity store. cknerv-server owns the [`Chain`] singleton
/// (block tip / mempool / recent rings) and the list of observed chain
/// nodes (1 for single-node mainnet RPC, N for mesh / multi-node).
pub struct EntityStore {
    pub chain: Chain,
    pub chain_nodes: Vec<ChainNode>,
    /// Latest observed P2P peers. Ephemeral — never persisted.
    pub peers: Vec<Peer>,
}

impl EntityStore {
    fn new() -> Self {
        Self {
            chain: Chain::default(),
            chain_nodes: Vec::new(),
            peers: Vec::new(),
        }
    }
}

/// Server state. Wrapped in `Arc` for shared access by adapters, the
/// reducer task, and HTTP/WS routes. Public fields are exposed for the
/// route handlers + ws module; private fields are guarded behind helpers.
pub struct ServerState {
    pub(crate) entity_store: RwLock<EntityStore>,
    pub(crate) revision: AtomicU64,
    pub(crate) mutation_tx: broadcast::Sender<SharedMutation>,
    pub(crate) mutation_ring: Ring<SharedMutation>,
    /// Lightweight completion signal used by persistence. Keeping this
    /// separate from `mutation_tx` avoids cloning every historical block/tx
    /// payload into a subscriber that only needs the terminal boot marker.
    boot_replay_complete_tx: watch::Sender<bool>,
    /// Coalesced signal for changes to the canonical evidence used by
    /// optional enrichment. This lets a withheld cold-start aggregate retry
    /// as soon as a newer block anchor is available without subscribing to
    /// and cloning the full structural mutation stream.
    canonical_evidence_tx: watch::Sender<u64>,
    replay_active: AtomicBool,
    pub(crate) projections: RwLock<Registry>,
    /// The cell galaxy's live composition shortfall, published by the
    /// display plane at every flush. Empty (and never written) unless the
    /// host wired the same sink into the projection — a CKB-only
    /// deployment simply reads zeros forever.
    composition_demand: Arc<CompositionDemandSink>,
    /// Which scripts the cell galaxy is holding, published by the same
    /// projection so an optional index can name them. Same wiring rule as
    /// the demand sink: empty forever unless the host installed one.
    observed_scripts: Arc<ObservedScriptsSink>,
    /// Coordination lock making (state, revision) snapshot-atomic. The
    /// reducer takes the write side around its full apply sequence
    /// (mutate + revision bump + broadcast); `snapshot()` takes the
    /// read side so it observes a state matching the revision it
    /// returns.
    pub(crate) coord: RwLock<()>,
    /// Uptime, build stamp, and the liveness the supervisor maintains —
    /// everything `/api/health` reports that is not derived state.
    health: ServerHealth,
}

impl ServerState {
    pub fn new() -> Self {
        let (mutation_tx, _) = broadcast::channel(MUTATION_CHANNEL_CAPACITY);
        let (boot_replay_complete_tx, _) = watch::channel(false);
        let (canonical_evidence_tx, _) = watch::channel(0);
        Self {
            entity_store: RwLock::new(EntityStore::new()),
            revision: AtomicU64::new(0),
            mutation_tx,
            mutation_ring: Ring::with_capacity(MUTATION_RING_CAP),
            boot_replay_complete_tx,
            canonical_evidence_tx,
            replay_active: AtomicBool::new(false),
            projections: RwLock::new(Registry::new()),
            composition_demand: Arc::new(CompositionDemandSink::new()),
            observed_scripts: Arc::new(ObservedScriptsSink::new()),
            coord: RwLock::new(()),
            health: ServerHealth::new(),
        }
    }

    pub(crate) fn health(&self) -> &ServerHealth {
        &self.health
    }

    /// Whether a bounded historical replay is in flight. The projection
    /// pipeline reads it through the mutation stream; `/api/health` reads
    /// it here, because a server that looks frozen is usually just
    /// backfilling.
    pub fn replay_active(&self) -> bool {
        self.replay_active.load(Ordering::Relaxed)
    }

    /// The cheap vitals `/api/health` needs — revision, tip, and the tip
    /// block's own timestamp — taken together so they agree.
    ///
    /// Poison-recovering on purpose: this is the one reader whose entire
    /// job is to describe a server something else has already broken, so it
    /// must not be the next casualty. The read side of an `RwLock` is never
    /// what poisons it, and nothing here mutates.
    pub(crate) fn health_vitals(&self) -> (u64, u64, Option<u64>) {
        let _coord = past_poison(self.coord.read());
        let revision = self.revision.load(Ordering::Relaxed);
        let store = past_poison(self.entity_store.read());
        (revision, store.chain.tip, store.chain.last_block_ts_ms)
    }

    /// Record which build is running, for `/api/health`. The host supplies
    /// it — only the host binary carries the commit stamp.
    pub fn set_build_version(&self, version: &str) {
        self.health.set_build_version(version);
    }

    /// Install the sink the cell-galaxy projection publishes to, so the
    /// enrichment supervisor and the projection share one slot.
    pub fn set_composition_demand_sink(&mut self, sink: Arc<CompositionDemandSink>) {
        self.composition_demand = sink;
    }

    /// Install the sink the cell-galaxy projection publishes its observed
    /// script identities to.
    pub fn set_observed_scripts_sink(&mut self, sink: Arc<ObservedScriptsSink>) {
        self.observed_scripts = sink;
    }

    /// What the display plane is short of right now, per class.
    pub fn composition_demand(&self) -> CompositionDemand {
        self.composition_demand.read()
    }

    /// Subscribe to the live mutation broadcast.
    pub fn subscribe_mutations(&self) -> broadcast::Receiver<SharedMutation> {
        self.mutation_tx.subscribe()
    }

    pub(crate) fn subscribe_boot_replay_completion(&self) -> watch::Receiver<bool> {
        self.boot_replay_complete_tx.subscribe()
    }

    pub(crate) fn subscribe_canonical_evidence(&self) -> watch::Receiver<u64> {
        self.canonical_evidence_tx.subscribe()
    }

    /// Snapshot of the mutation ring contents (oldest → newest revision).
    /// Cheap clone — the ring's lock is held only for the iteration.
    pub fn mutation_ring_snapshot(&self) -> Vec<SharedMutation> {
        self.mutation_ring.snapshot()
    }

    /// Coordinated read: returns the current Chain entity + chain_nodes
    /// + revision atomically.
    pub fn snapshot(&self) -> serde_json::Value {
        let _coord = self.coord.read().unwrap();
        let revision = self.revision.load(Ordering::Relaxed);
        let store = self.entity_store.read().unwrap();
        serde_json::json!({
            "revision": revision,
            "chain": store.chain,
            "chain_nodes": store.chain_nodes,
            "peers": store.peers,
        })
    }

    /// Canonical evidence available to optional enrichment sources. The
    /// retained recent block hashes are the only anchors an external index is
    /// allowed to validate against.
    pub fn canonical_context(&self) -> CanonicalContext {
        let _coord = self.coord.read().unwrap();
        let store = self.entity_store.read().unwrap();
        CanonicalContext {
            tip: store.chain.tip,
            epoch_number: store.chain.epoch.number,
            chain_name: store.chain.chain_name.clone(),
            recent_blocks: store.chain.recent_blocks.clone(),
            recent_transactions: store.chain.recent_tx_hashes.clone(),
            replay_active: self.replay_active.load(Ordering::Relaxed),
            observed_scripts: self.observed_scripts.read(),
        }
    }

    /// Apply a mutation. Holds the coord write lock for the full sequence
    /// (entity-store update + revision bump + ring push + broadcast +
    /// projection fan-out) so concurrent `snapshot()` readers observe
    /// (state, revision) atomically. Returns the assigned revision.
    // The coord lock guards `()`: WRITE-ness is the mutual exclusion
    // itself (snapshot readers hold the read side), not data access.
    #[allow(clippy::readonly_write_lock)]
    pub fn apply_mutation(&self, m: Mutation) -> u64 {
        let coord = self.coord.write().unwrap();
        self.apply_mutation_locked(&coord, m)
    }

    /// The apply sequence body. The caller MUST hold the coord write
    /// guard it passes (the parameter exists so callers that need
    /// validation to be atomic with the revision assignment — the
    /// enrichment reducer's D6 reservoir synthesis — can run both under
    /// one acquisition without re-entering the non-reentrant lock).
    fn apply_mutation_locked(
        &self,
        _coord: &std::sync::RwLockWriteGuard<'_, ()>,
        m: Mutation,
    ) -> u64 {
        let boot_replay_completed = matches!(
            &m,
            Mutation::BackfillProgress {
                active: false,
                phase: ReplayPhase::Boot,
                ..
            }
        );
        let canonical_evidence_changed = matches!(
            &m,
            Mutation::BlockMined { .. }
                | Mutation::ChainReorganized { .. }
                | Mutation::ChainRebuild { .. }
                | Mutation::BackfillProgress { .. }
        );

        // 1. Apply the mutation to the entity store (chain-side arms
        //    only; `CellTagged` is projection-only). Done under the
        //    coord write lock so the snapshot read side sees a
        //    consistent (state, revision) pair.
        if let Mutation::BackfillProgress { active, .. } = &m {
            self.replay_active.store(*active, Ordering::Relaxed);
        }
        {
            let mut store = self.entity_store.write().unwrap();
            apply_entity_mutation(&mut store, &m);
        }
        let revision = self.revision.fetch_add(1, Ordering::Relaxed) + 1;
        let rev: SharedMutation = Arc::new(SharedMutationEntry::new(RevisionedMutation {
            revision,
            mutation: m,
        }));
        if let Mutation::BackfillProgress { active, .. } = &rev.mutation {
            if *active {
                self.mutation_ring.clear();
            } else {
                self.mutation_ring.clear_and_shrink();
            }
        }
        // Server-internal variants never reach the entity wire (R5): no
        // ring entry, no broadcast. The consumed revision simply never
        // appears on the entity stream — safe, because `decide_action`
        // (ws.rs) compares `since` against ring boundaries without
        // assuming contiguous revisions, and the TS client tracks only
        // the max revision it has seen.
        let entity_wire_visible = rev.mutation.entity_wire_visible();
        if entity_wire_visible {
            self.mutation_ring.push(rev.clone());
        }

        // 2. Fan into projections. Each projection takes its own
        //    internal lock; the registry's read lock is released before
        //    the projection broadcasts (the broadcast itself is sync
        //    inside tokio's lock-free MPMC, so no `.await` involved).
        //    Each apply is contained: this loop runs INSIDE the coord
        //    write guard, and an escaping panic would poison it.
        {
            let registry = self.projections.read().unwrap();
            for writer in registry.writers() {
                contained(writer.as_ref(), "a mutation", || writer.apply(&rev));
            }
        }

        // 3. Broadcast the structural mutation. A broadcast with zero
        //    subscribers errors — ignore it, the ring still holds the
        //    record for catch-up.
        if entity_wire_visible {
            let _ = self.mutation_tx.send(rev);
        }
        if canonical_evidence_changed && !self.replay_active.load(Ordering::Relaxed) {
            self.canonical_evidence_tx.send_replace(revision);
        }
        if boot_replay_completed {
            self.boot_replay_complete_tx.send_replace(true);
        }

        revision
    }

    /// Apply one optional enrichment event. Most events never touch the
    /// canonical revision or mutation stream; the two composition events
    /// are the exception (D6) — see
    /// [`Self::apply_galaxy_composition`]. Anchored records are
    /// rejected if a reorg raced the source request and the claimed
    /// block/hash is no longer in the retained canonical evidence window.
    pub fn apply_enrichment(&self, event: EnrichmentEvent) -> bool {
        if matches!(
            event,
            EnrichmentEvent::GalaxyCompositionReplace(_)
                | EnrichmentEvent::GalaxyCompositionTopUp(_)
        ) {
            return self.apply_galaxy_composition(event);
        }
        let _coord = self.coord.read().unwrap();
        let store = self.entity_store.read().unwrap();

        let event = match event {
            EnrichmentEvent::SourceStatus(mut status) => {
                if status.validated_anchor.as_ref().is_some_and(|anchor| {
                    !store
                        .chain
                        .recent_blocks
                        .iter()
                        .any(|block| block.number == anchor.block && block.hash == anchor.hash)
                }) {
                    status.status = EnrichmentSourceState::Syncing;
                    status.validated_anchor = None;
                    status.message = Some(
                        "source anchor is outside the retained canonical evidence window"
                            .to_string(),
                    );
                }
                EnrichmentEvent::SourceStatus(status)
            }
            anchored if !event_anchor_is_current(&anchored, &store.chain.recent_blocks) => {
                tracing::warn!(
                    target: "cknerv-server",
                    "discarded enrichment event with a non-canonical or expired anchor"
                );
                return false;
            }
            other => other,
        };
        drop(store);

        if let EnrichmentEvent::SourceStatus(status) = &event {
            self.health.record_enrichment_status(status);
        }

        let registry = self.projections.read().unwrap();
        for writer in registry.enrichment_writers() {
            contained(writer.as_ref(), "an enrichment event", || {
                writer.apply_enrichment(&event)
            });
        }
        true
    }

    /// D6 reservoir channel: validated composition input — a whole
    /// record, or an additive top-up — is installed into the CANONICAL
    /// mutation stream (as the server-internal
    /// `Mutation::GalaxyReservoirReplaced` /
    /// `GalaxyReservoirToppedUp`) so the cells projection's display plane
    /// can stage it at a real revision. This is the input's ONLY
    /// destination — semantics deliberately ignores both events, so the
    /// same membership can never reach the browser through two contracts.
    ///
    /// Lock dance: every other enrichment event validates and fans out
    /// under the coord READ lock, but this one must reach
    /// `apply_mutation`'s write side. `RwLock` is not reentrant, so
    /// instead of read-validate → drop → re-lock (which would open a
    /// TOCTOU where a reorg lands between validation and installation —
    /// a window today's read path structurally excludes), we take ONE
    /// coord write acquisition covering both anchor validation and the
    /// canonical apply sequence (via `apply_mutation_locked`). Lock order
    /// stays coord → entity_store → projections → per-runner locks,
    /// identical to `apply_mutation`; nothing downstream re-acquires
    /// coord, so there is no deadlock. Top-ups arrive on a much shorter
    /// cadence than the old 15-minute refresh, but each one carries at
    /// most a few hundred cells and the plane's work is O(supplied), so
    /// the write side still sees far less than an ordinary block does.
    // See apply_mutation: the coord write guard IS the exclusion.
    #[allow(clippy::readonly_write_lock)]
    fn apply_galaxy_composition(&self, event: EnrichmentEvent) -> bool {
        let coord = self.coord.write().unwrap();
        {
            let store = self.entity_store.read().unwrap();
            if !event_anchor_is_current(&event, &store.chain.recent_blocks) {
                tracing::warn!(
                    target: "cknerv-server",
                    "discarded enrichment event with a non-canonical or expired anchor"
                );
                return false;
            }
        }
        let mutation = match event {
            EnrichmentEvent::GalaxyCompositionReplace(record) => {
                Mutation::GalaxyReservoirReplaced { record }
            }
            EnrichmentEvent::GalaxyCompositionTopUp(top_up) => {
                Mutation::GalaxyReservoirToppedUp { top_up }
            }
            _ => unreachable!("caller matched the variants"),
        };
        self.apply_mutation_locked(&coord, mutation);
        true
    }

    /// Serialize the Chain entity + chain_nodes + revision into a JSON
    /// blob suitable for cross-run persistence. Captured atomically
    /// under the coord write lock so the revision counter and entity
    /// store agree.
    pub fn save_entities(&self) -> serde_json::Value {
        let _coord = self.coord.write().unwrap();
        let revision = self.revision.load(Ordering::Relaxed);
        let store = self.entity_store.read().unwrap();
        serde_json::json!({
            "revision": revision,
            "chain": &store.chain,
            "chain_nodes": &store.chain_nodes,
        })
    }

    /// Restore the Chain entity + chain_nodes + revision from a
    /// previously saved blob. Held under the coord write lock so
    /// concurrent `snapshot()` callers don't observe a half-restored
    /// state. Returns an error and leaves the state untouched if the
    /// input shape is wrong.
    pub fn load_entities(&self, v: serde_json::Value) -> Result<(), String> {
        let parsed: EntitiesPersisted = serde_json::from_value(v)
            .map_err(|e| format!("entities persisted-state decode: {e}"))?;
        let _coord = self.coord.write().unwrap();
        self.revision.store(parsed.revision, Ordering::Relaxed);
        let mut store = self.entity_store.write().unwrap();
        store.chain = parsed.chain;
        store.chain_nodes = parsed.chain_nodes;
        Ok(())
    }

    /// Spawn the reducer task. Drains mutations from `mutation_rx` and
    /// applies each via `apply_mutation`. Exits when `mutation_rx`
    /// closes (all adapters dropped their senders) or when `shutdown`
    /// flips to `true`.
    pub fn spawn_reducer(
        self: Arc<Self>,
        mut mutation_rx: mpsc::Receiver<Mutation>,
        mut shutdown: watch::Receiver<bool>,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = shutdown.changed() => {
                        if *shutdown.borrow() {
                            break;
                        }
                    }
                    maybe = mutation_rx.recv() => match maybe {
                        Some(m) => { self.apply_mutation(m); }
                        // All adapters dropped their sender — nothing
                        // more will arrive. The loop has nothing left to
                        // do, but outside shutdown this is a death, not a
                        // clean exit: the server keeps answering with
                        // state that can no longer advance. Say so here,
                        // and let the supervisor flip health for it.
                        None => {
                            // …unless shutdown is already in flight, where
                            // adapters dropping their senders is exactly
                            // what is supposed to happen.
                            if !*shutdown.borrow() {
                                tracing::error!(
                                    target: "cknerv-server",
                                    "every adapter dropped its sender — the reducer has \
                                     nothing left to drain and derived state is frozen \
                                     from here"
                                );
                            }
                            break;
                        }
                    }
                }
            }
        })
    }

    /// Spawn the independent optional-enrichment reducer. Closing or failing
    /// this pipeline has no effect on canonical adapter processing.
    pub fn spawn_enrichment_reducer(
        self: Arc<Self>,
        mut enrichment_rx: mpsc::Receiver<EnrichmentEvent>,
        mut shutdown: watch::Receiver<bool>,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = shutdown.changed() => {
                        if *shutdown.borrow() {
                            break;
                        }
                    }
                    maybe = enrichment_rx.recv() => match maybe {
                        Some(event) => { self.apply_enrichment(event); }
                        None => break,
                    }
                }
            }
        })
    }

    /// Spawn a parallel projection runtime task subscribed to the
    /// mutation broadcast. Not used in the default wiring (`spawn_reducer`
    /// fans projections inline), but provided for adapters that want a
    /// separate task for back-pressure isolation. On `Lagged` it flips
    /// `shutdown` to `true` — a desynced projection's derived state is
    /// structurally wrong (matches simulator's `spawn_runtime` policy).
    pub fn spawn_projection_runtime(
        self: Arc<Self>,
        shutdown_tx: watch::Sender<bool>,
    ) -> tokio::task::JoinHandle<()> {
        let mut rx = self.subscribe_mutations();
        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(rm) => {
                        let writers = {
                            let registry = self.projections.read().unwrap();
                            registry.writers()
                        };
                        for w in &writers {
                            contained(w.as_ref(), "a mutation", || w.apply(&rm));
                        }
                    }
                    Err(RecvError::Closed) => break,
                    Err(RecvError::Lagged(n)) => {
                        tracing::error!(
                            target: "cknerv-server",
                            "projection runtime lagged {n} mutations — derived \
                             state has desynced; signalling shutdown"
                        );
                        let _ = shutdown_tx.send(true);
                        break;
                    }
                }
            }
        })
    }
}

/// Apply one projection with its panic contained, and skip it entirely
/// once it has used that up.
///
/// The canonical fan-out runs inside the coord WRITE guard. An escaping
/// panic poisons that guard, and from then on every route that reads it —
/// snapshot, stream, persistence — panics too, on a process that stays up
/// and keeps heartbeating. One bad expect in one projection would take the
/// whole server with it while leaving it looking alive. So the unwind stops
/// one frame short of the guard.
///
/// What survives is deliberately narrow. The projection that panicked is
/// quarantined: never applied again, frozen at the last state it reached,
/// named on `/api/health`. Every other projection is applied as if nothing
/// happened, because nothing did happen to them — they are independent
/// reducers over the same mutation. Entity-store apply stays fail-loud and
/// uncontained: that one IS the canonical state, and half-applying it is
/// not a thing to keep serving.
fn contained<W>(projection: &W, stream: &str, apply: impl FnOnce())
where
    W: Quarantinable + ?Sized,
{
    if projection.quarantine_reason().is_some() {
        return;
    }
    let Err(payload) = std::panic::catch_unwind(AssertUnwindSafe(apply)) else {
        return;
    };
    let reason = panic_text(payload.as_ref());
    tracing::error!(
        target: "cknerv-server",
        "projection `{}` panicked applying {stream} — quarantined at its last good \
         state; every other projection and every route keeps serving. reason: {reason}",
        projection.projection_name(),
    );
    projection.quarantine(Arc::from(reason));
}

/// The panic message, for the log line and the health report. `panic!` and
/// `expect` leave a `String`; `panic!("literal")` leaves a `&str`.
fn panic_text(payload: &(dyn std::any::Any + Send)) -> &str {
    payload
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
        .unwrap_or("panicked with a payload that is not a message")
}

fn event_anchor_is_current(event: &EnrichmentEvent, recent_blocks: &[RecentBlock]) -> bool {
    let anchor = match event {
        EnrichmentEvent::CellUpsert(record) => Some(&record.as_of),
        EnrichmentEvent::TransactionUpsert(record) => Some(&record.as_of),
        EnrichmentEvent::CensusReplace(census) => Some(&census.as_of),
        EnrichmentEvent::AssetEcosystemReplace(asset_ecosystem) => Some(&asset_ecosystem.as_of),
        EnrichmentEvent::DaoStateReplace(dao_state) => Some(&dao_state.as_of),
        EnrichmentEvent::ProtocolEraReplace(protocol_era) => Some(&protocol_era.as_of),
        EnrichmentEvent::ForkWatchReplace(fork_watch) => Some(&fork_watch.as_of),
        EnrichmentEvent::ActivityFeedReplace(activity_feed) => Some(&activity_feed.as_of),
        EnrichmentEvent::TransactionHorizonReplace(transaction_horizon) => {
            Some(&transaction_horizon.as_of)
        }
        EnrichmentEvent::NetworkAtlasReplace(network_atlas) => Some(&network_atlas.as_of),
        EnrichmentEvent::ScriptRegistryReplace(script_registry) => Some(&script_registry.as_of),
        EnrichmentEvent::GalaxyCompositionReplace(composition) => Some(&composition.as_of),
        EnrichmentEvent::GalaxyCompositionTopUp(top_up) => Some(&top_up.as_of),
        EnrichmentEvent::SourceStatus(_)
        | EnrichmentEvent::NetworkAtlasClear
        | EnrichmentEvent::Clear => None,
    };
    anchor.is_none_or(|anchor| {
        recent_blocks
            .iter()
            .any(|block| block.number == anchor.block && block.hash == anchor.hash)
    })
}

impl Default for ServerState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(serde::Deserialize)]
struct EntitiesPersisted {
    #[serde(default)]
    revision: u64,
    #[serde(default)]
    chain: Chain,
    #[serde(default)]
    chain_nodes: Vec<ChainNode>,
}

/// Apply a mutation to the [`EntityStore`]. Dispatches:
///   * `Chain`-touching variants to [`apply_chain_mutation`].
///   * `ChainNodeRegistered` to an idempotent upsert against
///     `EntityStore.chain_nodes`.
///   * `CellTagged` is projection-only — no entity-store update.
fn apply_entity_mutation(store: &mut EntityStore, m: &Mutation) {
    match m {
        Mutation::ChainNodeRegistered {
            id,
            label,
            is_miner,
            ..
        } => {
            if let Some(existing) = store.chain_nodes.iter_mut().find(|n| n.id == *id) {
                existing.label = label.clone();
                existing.is_miner = *is_miner;
            } else {
                store.chain_nodes.push(ChainNode {
                    id: id.clone(),
                    label: label.clone(),
                    is_miner: *is_miner,
                    version: String::new(),
                    connections: 0,
                    // Registration happens before the node has been asked
                    // anything about itself; the identity arrives with the
                    // first info poll.
                    p2p_node_id: None,
                });
            }
        }
        Mutation::ChainNodeInfoUpdated {
            id,
            version,
            connections,
            p2p_node_id,
        } => {
            if let Some(existing) = store.chain_nodes.iter_mut().find(|n| n.id == *id) {
                existing.version = version.clone();
                existing.connections = *connections;
                existing.p2p_node_id = p2p_node_id.clone();
            }
        }
        Mutation::PeersUpdated { peers } => {
            store.peers = peers.clone();
        }
        _ => apply_chain_mutation(&mut store.chain, m),
    }
}

/// Apply a chain-side mutation to the [`Chain`] entity. Lifted verbatim
/// from `simulator/src/dashboard/state.rs::apply_chain_mutation` (post
/// Phase A `ChainMutation` arms), adapted to cknerv-core's flat
/// [`Mutation`] enum.
///
/// `CellTagged` is projection-only: the cell-galaxy projection consumes
/// it via its own `apply_mutation` to set `Cell.tag`. The entity store
/// has no equivalent field to update — entity-side is a no-op.
fn apply_chain_mutation(chain: &mut Chain, m: &Mutation) {
    use cknerv_core::entity::RECENT_INTERVAL_CAP;

    match m {
        Mutation::ChainReorganized { from_block } => {
            let canonical_tip = from_block.saturating_sub(1);
            chain.tip = chain.tip.min(canonical_tip);
            chain.reorgs = chain
                .reorgs
                .checked_add(1)
                .expect("chain.reorgs overflowed u64 — see total_blocks comment");
            chain
                .recent_blocks
                .retain(|block| block.number < *from_block);
            chain.recent_tx_hashes.retain(|tx| tx.block < *from_block);
            // The rolling metric rings do not carry block numbers. Clear them
            // rather than mix orphan samples with the replacement suffix.
            chain.recent_block_intervals_ms.clear();
            chain.recent_block_tx_counts.clear();
            chain.recent_block_sizes.clear();
            chain.last_block_ts_ms = None;
        }
        Mutation::ChainRebuild { from_block } => {
            // No common ancestor was provable inside the retained rollback
            // window. Drop every canonical ring before the adapter replays a
            // fresh bounded window; lifetime observed counters remain
            // cumulative, matching ordinary reorg replacement semantics.
            chain.tip = from_block.saturating_sub(1);
            chain.reorgs = chain
                .reorgs
                .checked_add(1)
                .expect("chain.reorgs overflowed u64 — see total_blocks comment");
            chain.recent_blocks.clear();
            chain.recent_tx_hashes.clear();
            chain.recent_block_intervals_ms.clear();
            chain.recent_block_tx_counts.clear();
            chain.recent_block_sizes.clear();
            chain.last_block_ts_ms = None;
        }
        Mutation::BlockMined {
            number,
            hash,
            tx_count,
            size,
            at,
        } => {
            let exact_dup = chain
                .recent_blocks
                .iter()
                .any(|b| b.number == *number && b.hash == *hash);
            let reorg = !exact_dup
                && chain
                    .recent_blocks
                    .iter()
                    .any(|b| b.number == *number && b.hash != *hash);
            if exact_dup {
                return;
            }
            if reorg {
                chain.tip = *number;
                chain.recent_blocks.retain(|block| block.number < *number);
                chain.recent_tx_hashes.retain(|tx| tx.block < *number);
                chain.recent_block_intervals_ms.clear();
                chain.recent_block_tx_counts.clear();
                chain.recent_block_sizes.clear();
                chain.last_block_ts_ms = None;
            } else if *number > chain.tip {
                chain.tip = *number;
            }
            chain.total_blocks = chain.total_blocks.checked_add(1).expect(
                "chain.total_blocks overflowed u64 — the server has \
                     observed 18 quintillion distinct blocks, which is \
                     structurally impossible on any real chain",
            );
            if reorg {
                chain.reorgs = chain
                    .reorgs
                    .checked_add(1)
                    .expect("chain.reorgs overflowed u64 — see total_blocks comment");
            }
            if let Some(prev_ts) = chain.last_block_ts_ms {
                if *at >= prev_ts {
                    chain.recent_block_intervals_ms.push(*at - prev_ts);
                    while chain.recent_block_intervals_ms.len() > RECENT_INTERVAL_CAP {
                        chain.recent_block_intervals_ms.remove(0);
                    }
                }
            }
            chain.last_block_ts_ms = Some(*at);
            chain.recent_block_tx_counts.push(*tx_count);
            while chain.recent_block_tx_counts.len() > RECENT_INTERVAL_CAP {
                chain.recent_block_tx_counts.remove(0);
            }
            chain.recent_block_sizes.push(*size);
            while chain.recent_block_sizes.len() > RECENT_INTERVAL_CAP {
                chain.recent_block_sizes.remove(0);
            }
            chain.recent_blocks.push(RecentBlock {
                number: *number,
                hash: hash.clone(),
            });
            while chain.recent_blocks.len() > RECENT_BLOCKS_CAP {
                chain.recent_blocks.remove(0);
            }
        }
        Mutation::TxLanded { tx_hash, block, .. } => {
            chain.total_txs = chain
                .total_txs
                .checked_add(1)
                .expect("chain.total_txs overflowed u64 — see total_blocks comment");
            chain.recent_tx_hashes.push(RecentTx {
                tx_hash: tx_hash.clone(),
                block: *block,
            });
            while chain.recent_tx_hashes.len() > RECENT_TX_CAP {
                chain.recent_tx_hashes.remove(0);
            }
        }
        Mutation::ChainMempoolUpdated {
            pending,
            proposed,
            orphan,
            total_tx_size,
            total_tx_cycles,
            min_fee_rate,
        } => {
            chain.mempool = MempoolStats {
                pending: *pending,
                proposed: *proposed,
                orphan: *orphan,
                total_tx_size: *total_tx_size,
                total_tx_cycles: *total_tx_cycles,
                min_fee_rate: *min_fee_rate,
            };
        }
        Mutation::ChainInfoUpdated {
            epoch,
            median_time_ms,
            difficulty,
            chain_name,
        } => {
            chain.epoch = epoch.clone();
            chain.median_time_ms = *median_time_ms;
            chain.difficulty = difficulty.clone();
            chain.chain_name = chain_name.clone();
        }
        Mutation::CellTagged { .. } | Mutation::CellHydrationCompleted { .. } => {
            // Projection-only: cell-galaxy consumes via its own
            // `apply_mutation`. Entity-store is a no-op.
        }
        Mutation::BackfillProgress { .. } => {
            // Projection-only: the cell-galaxy projection consumes it.
            // The Chain entity has no field to update.
        }
        Mutation::ChainNodeRegistered { .. } => {
            // Handled by the outer dispatcher (`apply_entity_mutation`)
            // against `EntityStore.chain_nodes`. The `Chain` entity has
            // no field to update for node registration.
        }
        Mutation::ChainSyncUpdated {
            ibd,
            best_known_block,
        } => {
            chain.ibd = *ibd;
            chain.best_known_block = *best_known_block;
        }
        Mutation::PeersUpdated { .. } | Mutation::ChainNodeInfoUpdated { .. } => {
            // Handled by the outer `apply_entity_mutation` against
            // EntityStore.peers / chain_nodes. The Chain entity has no
            // field to update here.
        }
        Mutation::GalaxyReservoirReplaced { .. } | Mutation::GalaxyReservoirToppedUp { .. } => {
            // SERVER-INTERNAL projection-only variants (D6): consumed by
            // the cells projection's display plane. They never appear on
            // the entity wire (`entity_wire_visible()` filters them from
            // the ring + broadcast) and there is no entity state to
            // update — display membership is presentation policy, never
            // canonical truth.
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projection_registry::{ProjectionRuntimeTestExt, SnapshotEnvelope};

    /// The block this projection cannot survive.
    const LANDMINE_BLOCK: u64 = 66;
    /// What it writes into itself on the way down, so a test can tell the
    /// half-applied state apart from the last good one.
    const HALF_APPLIED: u64 = 999;

    /// A projection that panics mid-apply, after dirtying itself.
    ///
    /// `applies` counts every mutation it was handed — quarantine is then
    /// provable by the count standing still, not just by a flag saying so.
    struct LandmineProjection {
        applies: Arc<AtomicU64>,
        state: u64,
    }

    impl cknerv_core::Projection for LandmineProjection {
        type Snapshot = u64;
        type Delta = u64;

        fn name(&self) -> &'static str {
            "landmine"
        }

        fn snapshot(&self) -> u64 {
            self.state
        }

        fn save(&self) -> serde_json::Value {
            serde_json::json!({ "state": self.state })
        }

        fn apply_mutation(&mut self, m: &Mutation) -> Vec<u64> {
            self.applies.fetch_add(1, Ordering::Relaxed);
            if matches!(
                m,
                Mutation::BlockMined {
                    number: LANDMINE_BLOCK,
                    ..
                }
            ) {
                self.state = HALF_APPLIED;
                panic!("deliberate test panic inside a projection apply");
            }
            self.state += 1;
            Vec::new()
        }
    }

    fn block(number: u64) -> Mutation {
        Mutation::BlockMined {
            number,
            hash: format!("0xblock{number}"),
            tx_count: 0,
            size: 0,
            at: number * 1_000,
        }
    }

    /// A panic inside one projection's apply used to poison the coord write
    /// lock, and from there every route on the server — snapshot, stream,
    /// persistence — for as long as the process stayed up. It is contained
    /// now: the projection that panicked is frozen and named, everything
    /// else carries on.
    ///
    /// (The deliberate panic prints a backtrace to stderr. That is the
    /// panic hook doing its job, not this test failing.)
    #[test]
    fn a_panicking_projection_is_quarantined_and_takes_nothing_with_it() {
        let state = ServerState::new();
        let applies = Arc::new(AtomicU64::new(0));
        {
            let mut projections = state.projections.write().unwrap();
            projections.register(cknerv_core::CellGalaxy::default());
            projections.register(LandmineProjection {
                applies: applies.clone(),
                state: 0,
            });
        }
        let landmine = state
            .projections
            .read()
            .unwrap()
            .lookup("landmine")
            .expect("landmine runtime");
        let cells = state
            .projections
            .read()
            .unwrap()
            .lookup("cells")
            .expect("cells runtime");

        // One clean block, and a snapshot taken at it: that is the last
        // good state, and the cache is now holding its bytes.
        state.apply_mutation(block(1));
        let (good_revision, good_bytes) = landmine.snapshot_envelope(SnapshotEnvelope::Bare);
        assert_eq!(good_revision, 1);

        // The landmine block. `apply_mutation` must RETURN.
        assert_eq!(state.apply_mutation(block(LANDMINE_BLOCK)), 2);

        // The coord lock survived, so the whole read surface still answers.
        assert_eq!(state.snapshot()["chain"]["tip"], LANDMINE_BLOCK);
        assert_eq!(state.save_entities()["revision"], 2);
        assert_eq!(state.canonical_context().tip, LANDMINE_BLOCK);
        // …and the healthy projection was applied as if nothing happened.
        assert_eq!(cells.revision(), 2);

        // The landmine is frozen where it was, serving its last cached
        // snapshot at the revision that produced it.
        let reason = landmine.quarantine_reason().expect("quarantined");
        assert!(reason.contains("deliberate test panic"), "reason: {reason}");
        assert_eq!(landmine.revision(), 1);
        assert_eq!(
            landmine.snapshot_envelope(SnapshotEnvelope::Bare),
            (good_revision, good_bytes)
        );
        // An envelope the cache does not hold has to go through the
        // projection's own lock — the one the panic poisoned. It answers
        // (with the frozen, half-applied state) instead of panicking, which
        // is the whole point of recovering the guard.
        let (frame_revision, frame) = landmine.snapshot_envelope(SnapshotEnvelope::Frame);
        assert_eq!(frame_revision, 1);
        assert!(
            String::from_utf8_lossy(&frame).contains(&format!("\"snapshot\":{HALF_APPLIED}")),
            "frame: {}",
            String::from_utf8_lossy(&frame)
        );
        // Half-applied state must not outlive the process that broke it.
        assert!(landmine.save_state().is_null());

        // It is never handed another mutation; the healthy one keeps going.
        let applies_at_quarantine = applies.load(Ordering::Relaxed);
        state.apply_mutation(block(3));
        assert_eq!(applies.load(Ordering::Relaxed), applies_at_quarantine);
        assert_eq!(cells.revision(), 3);
        assert_eq!(landmine.revision(), 1);

        // And health says exactly this.
        let report =
            serde_json::to_value(crate::health::report(&state)).expect("health report is JSON");
        assert_eq!(report["degraded"], true);
        assert_eq!(
            report["quarantined_projections"],
            serde_json::json!(["landmine"])
        );
        assert_eq!(report["revision"], 3);
        let quarantined = report["projections"]
            .as_array()
            .expect("projections array")
            .iter()
            .find(|projection| projection["name"] == "landmine")
            .expect("landmine is reported");
        assert_eq!(quarantined["revision"], 1);
        assert!(quarantined["quarantine_reason"]
            .as_str()
            .is_some_and(|reason| reason.contains("deliberate test panic")));
    }

    /// The entities stream snapshots this ring on every connect, exactly
    /// like the projection stream does with its deltas — so it has to share
    /// entries too, or a reconnect copies 50k mutations to read a handful.
    #[test]
    fn the_mutation_ring_shares_entries_with_every_reader() {
        let state = ServerState::new();
        state.apply_mutation(Mutation::BlockMined {
            number: 1,
            hash: "0xblock1".into(),
            tx_count: 0,
            size: 0,
            at: 1_000,
        });

        let first = state.mutation_ring_snapshot();
        let second = state.mutation_ring_snapshot();
        assert_eq!(first.len(), 1);
        assert!(
            first.iter().zip(&second).all(|(a, b)| Arc::ptr_eq(a, b)),
            "two readers of the ring must share its entries"
        );
    }

    /// The projection and the supervisor have to be looking at the SAME
    /// slot — a demand nobody can read is worse than no demand at all.
    #[test]
    fn the_installed_demand_sink_is_the_one_the_server_reads() {
        let mut state = ServerState::new();
        assert_eq!(
            state.composition_demand(),
            CompositionDemand::default(),
            "unwired: zeros forever, which is what a CKB-only host wants"
        );

        let sink = Arc::new(CompositionDemandSink::new());
        state.set_composition_demand_sink(sink.clone());
        sink.publish(CompositionDemand {
            curated: true,
            dao: 1_777,
            typed: 1_994,
        });
        assert_eq!(
            state.composition_demand(),
            CompositionDemand {
                curated: true,
                dao: 1_777,
                typed: 1_994,
            }
        );
    }

    #[test]
    fn block_mined_updates_tip_and_recent() {
        let s = ServerState::new();
        let rev = s.apply_mutation(Mutation::BlockMined {
            number: 5,
            hash: "0x5".into(),
            tx_count: 2,
            size: 0,
            at: 1_000,
        });
        assert_eq!(rev, 1);
        let snap = s.snapshot();
        assert_eq!(snap["chain"]["tip"], 5);
        assert_eq!(snap["chain"]["total_blocks"], 1);
        assert_eq!(snap["chain"]["recent_blocks"][0]["number"], 5);
        assert_eq!(snap["chain"]["recent_blocks"][0]["hash"], "0x5");
    }

    #[test]
    fn block_mined_accrues_recent_block_sizes_parallel_to_tx_counts() {
        let s = ServerState::new();
        s.apply_mutation(Mutation::BlockMined {
            number: 1,
            hash: "0x1".into(),
            tx_count: 2,
            size: 500,
            at: 100,
        });
        s.apply_mutation(Mutation::BlockMined {
            number: 2,
            hash: "0x2".into(),
            tx_count: 7,
            size: 1200,
            at: 110,
        });
        let snap = s.snapshot();
        assert_eq!(
            snap["chain"]["recent_block_sizes"],
            serde_json::json!([500, 1200])
        );
        assert_eq!(
            snap["chain"]["recent_block_tx_counts"],
            serde_json::json!([2, 7])
        );
    }

    #[test]
    fn duplicate_block_does_not_double_count() {
        let s = ServerState::new();
        s.apply_mutation(Mutation::BlockMined {
            number: 3,
            hash: "0xa".into(),
            tx_count: 0,
            size: 0,
            at: 100,
        });
        s.apply_mutation(Mutation::BlockMined {
            number: 3,
            hash: "0xa".into(),
            tx_count: 0,
            size: 0,
            at: 200,
        });
        let snap = s.snapshot();
        assert_eq!(snap["chain"]["total_blocks"], 1);
    }

    #[test]
    fn reorg_increments_counter() {
        let s = ServerState::new();
        s.apply_mutation(Mutation::BlockMined {
            number: 3,
            hash: "0xa".into(),
            tx_count: 0,
            size: 0,
            at: 100,
        });
        s.apply_mutation(Mutation::BlockMined {
            number: 3,
            hash: "0xb".into(),
            tx_count: 0,
            size: 0,
            at: 200,
        });
        let snap = s.snapshot();
        assert_eq!(snap["chain"]["reorgs"], 1);
        assert_eq!(snap["chain"]["total_blocks"], 2);
    }

    #[test]
    fn explicit_reorg_prunes_orphan_suffix_and_lowers_tip() {
        let s = ServerState::new();
        for number in 1..=3 {
            s.apply_mutation(Mutation::BlockMined {
                number,
                hash: format!("0x{number}"),
                tx_count: 1,
                size: 100,
                at: number * 1_000,
            });
            s.apply_mutation(Mutation::TxLanded {
                tx_hash: format!("0xtx{number}"),
                block: number,
                at: number * 1_000,
                inputs: vec![],
                outputs: vec![],
            });
        }

        s.apply_mutation(Mutation::ChainReorganized { from_block: 2 });
        let snap = s.snapshot();

        assert_eq!(snap["chain"]["tip"], 1);
        assert_eq!(snap["chain"]["reorgs"], 1);
        assert_eq!(
            snap["chain"]["recent_blocks"],
            serde_json::json!([{ "number": 1, "hash": "0x1" }])
        );
        assert_eq!(
            snap["chain"]["recent_tx_hashes"],
            serde_json::json!([{ "tx_hash": "0xtx1", "block": 1 }])
        );
        assert_eq!(
            snap["chain"]["recent_block_tx_counts"],
            serde_json::json!([])
        );
        // Lifetime observed counters stay cumulative; only canonical windows
        // and the current tip are rewritten.
        assert_eq!(snap["chain"]["total_blocks"], 3);
        assert_eq!(snap["chain"]["total_txs"], 3);
    }

    #[test]
    fn deep_reorg_rebuild_clears_canonical_windows_before_replay() {
        let s = ServerState::new();
        for number in 10..=12 {
            s.apply_mutation(Mutation::BlockMined {
                number,
                hash: format!("0xorphan{number}"),
                tx_count: 1,
                size: 100,
                at: number * 1_000,
            });
            s.apply_mutation(Mutation::TxLanded {
                tx_hash: format!("0xtx{number}"),
                block: number,
                at: number * 1_000,
                inputs: vec![],
                outputs: vec![],
            });
        }

        s.apply_mutation(Mutation::ChainRebuild { from_block: 20 });
        let reset = s.snapshot();
        assert_eq!(reset["chain"]["tip"], 19);
        assert_eq!(reset["chain"]["reorgs"], 1);
        assert_eq!(reset["chain"]["recent_blocks"], serde_json::json!([]));
        assert_eq!(reset["chain"]["recent_tx_hashes"], serde_json::json!([]));
        assert_eq!(
            reset["chain"]["recent_block_intervals_ms"],
            serde_json::json!([])
        );
        assert_eq!(reset["chain"]["total_blocks"], 3);
        assert_eq!(reset["chain"]["total_txs"], 3);

        s.apply_mutation(Mutation::BlockMined {
            number: 20,
            hash: "0xcanonical20".into(),
            tx_count: 0,
            size: 80,
            at: 20_000,
        });
        let replayed = s.snapshot();
        assert_eq!(replayed["chain"]["tip"], 20);
        assert_eq!(
            replayed["chain"]["recent_blocks"],
            serde_json::json!([{ "number": 20, "hash": "0xcanonical20" }])
        );
    }

    #[test]
    fn tx_landed_updates_recent_tx_hashes() {
        let s = ServerState::new();
        s.apply_mutation(Mutation::TxLanded {
            tx_hash: "0xtx".into(),
            block: 7,
            at: 100,
            inputs: vec![],
            outputs: vec![],
        });
        let snap = s.snapshot();
        assert_eq!(snap["chain"]["total_txs"], 1);
        assert_eq!(snap["chain"]["recent_tx_hashes"][0]["tx_hash"], "0xtx");
        assert_eq!(snap["chain"]["recent_tx_hashes"][0]["block"], 7);
    }

    #[test]
    fn revision_is_monotonic() {
        let s = ServerState::new();
        for i in 0..10 {
            let rev = s.apply_mutation(Mutation::BlockMined {
                number: i,
                hash: format!("0x{i}"),
                tx_count: 0,
                size: 0,
                at: i * 10,
            });
            assert_eq!(rev, i + 1);
        }
    }

    #[test]
    fn replay_progress_is_a_mutation_ring_compaction_barrier() {
        let state = ServerState::new();
        for number in 1..=10 {
            state.apply_mutation(Mutation::BlockMined {
                number,
                hash: format!("0x{number}"),
                tx_count: 0,
                size: 0,
                at: number,
            });
        }
        assert_eq!(state.mutation_ring_snapshot().len(), 10);

        let barrier_revision = state.apply_mutation(Mutation::BackfillProgress {
            done: 25,
            total: 100,
            active: true,
            phase: ReplayPhase::Boot,
        });
        let ring = state.mutation_ring_snapshot();
        assert_eq!(ring.len(), 1);
        assert_eq!(ring[0].revision, barrier_revision);

        state.apply_mutation(Mutation::BlockMined {
            number: 11,
            hash: "0x11".into(),
            tx_count: 0,
            size: 0,
            at: 11,
        });
        assert_eq!(state.mutation_ring_snapshot().len(), 2);
        state.apply_mutation(Mutation::BackfillProgress {
            done: 100,
            total: 100,
            active: false,
            phase: ReplayPhase::Boot,
        });
        assert_eq!(state.mutation_ring_snapshot().len(), 1);
    }

    #[test]
    fn cell_tagged_is_no_op_for_entity_store() {
        use cknerv_core::OutPoint;
        let s = ServerState::new();
        let baseline = s.snapshot();
        s.apply_mutation(Mutation::CellTagged {
            out_point: OutPoint {
                tx_hash: "0xtx".into(),
                index: 0,
            },
            tag: "foo".into(),
            at: 100,
        });
        let after = s.snapshot();
        // chain entity is unchanged; only revision moves.
        assert_eq!(baseline["chain"], after["chain"]);
        assert_eq!(after["revision"], 1);
    }

    #[test]
    fn peers_updated_replaces_peer_list() {
        use cknerv_core::{Peer, PeerDirection};
        let s = ServerState::new();
        s.apply_mutation(Mutation::PeersUpdated {
            peers: vec![Peer {
                node_id: "QmA".into(),
                addr: "1.2.3.4:8115".into(),
                direction: PeerDirection::Outbound,
                version: "0.116.1".into(),
                latency_ms: Some(20),
                best_known: Some(50),
                connected_ms: 1000,
            }],
        });
        let snap = s.snapshot();
        assert_eq!(snap["peers"].as_array().unwrap().len(), 1);
        assert_eq!(snap["peers"][0]["node_id"], "QmA");

        // A second snapshot replaces (does not append).
        s.apply_mutation(Mutation::PeersUpdated { peers: vec![] });
        assert_eq!(s.snapshot()["peers"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn chain_sync_updated_sets_fields() {
        let s = ServerState::new();
        s.apply_mutation(Mutation::ChainSyncUpdated {
            ibd: true,
            best_known_block: 777,
        });
        let snap = s.snapshot();
        assert_eq!(snap["chain"]["ibd"], true);
        assert_eq!(snap["chain"]["best_known_block"], 777);
    }

    #[test]
    fn canonical_context_exposes_the_direct_chain_epoch() {
        let s = ServerState::new();
        s.apply_mutation(Mutation::ChainInfoUpdated {
            epoch: cknerv_core::EpochInfo {
                number: 12_300,
                index: 42,
                length: 1_800,
            },
            median_time_ms: 1,
            difficulty: "0x1".into(),
            chain_name: "ckb".into(),
        });

        let context = s.canonical_context();

        assert_eq!(context.epoch_number, 12_300);
        assert_eq!(context.chain_name, "ckb");
    }

    #[test]
    fn chain_node_info_updated_enriches_registered_node() {
        let s = ServerState::new();
        s.apply_mutation(Mutation::ChainNodeRegistered {
            id: "ckb:local".into(),
            label: "ckb-local".into(),
            is_miner: false,
            at: 1,
        });
        // Registration knows cknerv's key for the endpoint; only the info
        // poll can learn the name the network knows it by.
        assert_eq!(
            s.entity_store.read().unwrap().chain_nodes[0].p2p_node_id,
            None
        );
        s.apply_mutation(Mutation::ChainNodeInfoUpdated {
            id: "ckb:local".into(),
            version: "0.116.1".into(),
            connections: 24,
            p2p_node_id: Some("QmP61JintcHEXkVFq8RGBKA8L7Fq1rfMRvj4eQQn7YsCwd".into()),
        });
        let nodes = &s.entity_store.read().unwrap().chain_nodes;
        assert_eq!(nodes[0].version, "0.116.1");
        assert_eq!(nodes[0].connections, 24);
        assert_eq!(nodes[0].id, "ckb:local", "the local key is never rewritten");
        assert_eq!(
            nodes[0].p2p_node_id.as_deref(),
            Some("QmP61JintcHEXkVFq8RGBKA8L7Fq1rfMRvj4eQQn7YsCwd")
        );
    }

    #[test]
    fn chain_node_registered_appends_and_updates() {
        let state = ServerState::new();

        // First registration: appends to chain_nodes
        state.apply_mutation(Mutation::ChainNodeRegistered {
            id: "ckb:mainnet".into(),
            label: "ckb-mainnet".into(),
            is_miner: false,
            at: 1000,
        });
        {
            let nodes = &state.entity_store.read().unwrap().chain_nodes;
            assert_eq!(nodes.len(), 1);
            assert_eq!(nodes[0].id, "ckb:mainnet");
            assert_eq!(nodes[0].label, "ckb-mainnet");
            assert!(!nodes[0].is_miner);
        }

        // Re-register with updated label + is_miner: in-place mutation,
        // no row added.
        state.apply_mutation(Mutation::ChainNodeRegistered {
            id: "ckb:mainnet".into(),
            label: "ckb-mainnet-renamed".into(),
            is_miner: true,
            at: 2000,
        });
        {
            let nodes = &state.entity_store.read().unwrap().chain_nodes;
            assert_eq!(nodes.len(), 1, "no duplicate row");
            assert_eq!(nodes[0].label, "ckb-mainnet-renamed");
            assert!(nodes[0].is_miner);
        }

        // Different id: appends as separate row.
        state.apply_mutation(Mutation::ChainNodeRegistered {
            id: "ckb:secondary".into(),
            label: "ckb-secondary".into(),
            is_miner: false,
            at: 3000,
        });
        {
            let nodes = &state.entity_store.read().unwrap().chain_nodes;
            assert_eq!(nodes.len(), 2);
        }

        // Chain entity is untouched by node registration.
        let snap = state.snapshot();
        assert_eq!(snap["chain"]["tip"], 0);
        assert_eq!(snap["chain_nodes"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn save_load_round_trips_chain() {
        let s = ServerState::new();
        s.apply_mutation(Mutation::BlockMined {
            number: 99,
            hash: "0xblk99".into(),
            tx_count: 4,
            size: 0,
            at: 1_000,
        });
        let saved = s.save_entities();

        let s2 = ServerState::new();
        s2.load_entities(saved).expect("load");
        let snap = s2.snapshot();
        assert_eq!(snap["chain"]["tip"], 99);
        assert_eq!(snap["chain"]["total_blocks"], 1);
        assert_eq!(snap["revision"], 1);
    }

    /// A save written before nodes carried a network identity still loads,
    /// and loads as silence rather than as a failure: cross-restart
    /// compatibility is the constraint the field was added under.
    #[test]
    fn a_pre_identity_save_restores_with_an_unnamed_node() {
        let s = ServerState::new();
        s.load_entities(serde_json::json!({
            "revision": 7,
            "chain": {},
            "chain_nodes": [{
                "id": "ckb:local",
                "label": "ckb-local",
                "is_miner": false,
                "version": "0.116.1",
                "connections": 24
            }]
        }))
        .expect("an older save is still readable");
        let nodes = &s.entity_store.read().unwrap().chain_nodes;
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].p2p_node_id, None);
    }

    /// …and once a poll has learned it, the identity survives the restart it
    /// was saved across.
    #[test]
    fn a_known_network_identity_survives_save_and_load() {
        let s = ServerState::new();
        s.apply_mutation(Mutation::ChainNodeRegistered {
            id: "ckb:local".into(),
            label: "ckb-local".into(),
            is_miner: false,
            at: 1,
        });
        s.apply_mutation(Mutation::ChainNodeInfoUpdated {
            id: "ckb:local".into(),
            version: "0.116.1".into(),
            connections: 24,
            p2p_node_id: Some("QmP61JintcHEXkVFq8RGBKA8L7Fq1rfMRvj4eQQn7YsCwd".into()),
        });

        let s2 = ServerState::new();
        s2.load_entities(s.save_entities()).expect("load");
        let snap = s2.snapshot();
        assert_eq!(
            snap["chain_nodes"][0]["p2p_node_id"],
            "QmP61JintcHEXkVFq8RGBKA8L7Fq1rfMRvj4eQQn7YsCwd"
        );
    }

    /// Anchor-stale enrichment is rejected; anchored semantics records
    /// stay off the canonical channel — EXCEPT the composition record,
    /// which (D6) synthesizes the internal `GalaxyReservoirReplaced`
    /// mutation and therefore advances the canonical revision while
    /// still never touching canonical cell state.
    #[test]
    fn enrichment_stays_off_the_canonical_channel_except_the_reservoir() {
        let state = ServerState::new();
        {
            let mut projections = state.projections.write().unwrap();
            projections.register(cknerv_core::CellGalaxy::default());
            projections.register_enrichment(cknerv_core::SemanticsProjection::default());
        }
        state.apply_mutation(Mutation::BlockMined {
            number: 10,
            hash: "0xcanonical".to_string(),
            tx_count: 0,
            size: 0,
            at: 1_000,
        });
        let record = cknerv_core::CellSemanticRecord {
            out_point: cknerv_core::OutPoint {
                tx_hash: "0xcell".to_string(),
                index: 0,
            },
            source: "test".to_string(),
            as_of: cknerv_core::ChainAnchor {
                block: 10,
                hash: "0xorphan".to_string(),
            },
            observed_at_block: 10,
            updated_at_ms: 10,
            address: None,
            cell_type: None,
            lock_script: None,
            type_script: None,
            asset: None,
            common_knowledge: None,
            content: None,
            facets: Vec::new(),
        };

        assert!(!state.apply_enrichment(EnrichmentEvent::CellUpsert(Box::new(record.clone()))));
        let runtime = state
            .projections
            .read()
            .unwrap()
            .lookup("semantics")
            .unwrap();
        assert!(runtime.snapshot_json().1["cells"]
            .as_array()
            .unwrap()
            .is_empty());

        let mut canonical = record;
        canonical.as_of.hash = "0xcanonical".to_string();
        assert!(state.apply_enrichment(EnrichmentEvent::CellUpsert(Box::new(canonical))));
        assert_eq!(
            runtime.snapshot_json().1["cells"].as_array().unwrap().len(),
            1
        );
        // Semantics upserts never advance the canonical revision.
        assert_eq!(state.snapshot()["revision"], 1);

        let cells_runtime = state.projections.read().unwrap().lookup("cells").unwrap();
        let pulse_before = cells_runtime.snapshot_json().1["last_pulse_at_ms"].clone();
        assert!(
            state.apply_enrichment(EnrichmentEvent::GalaxyCompositionReplace(
                cknerv_core::GalaxyCompositionRecord {
                    source: "test".to_string(),
                    as_of: cknerv_core::ChainAnchor {
                        block: 10,
                        hash: "0xcanonical".to_string(),
                    },
                    updated_at_ms: 1_001,
                    dao: Vec::new(),
                    typed: Vec::new(),
                    plain: Vec::new(),
                }
            ))
        );
        // The composition rode the canonical channel (D6): one internal
        // mutation, one revision — but canonical cell state (the pulse
        // clock stands in for it) is untouched, and the display plane
        // switched to composed staffing.
        assert_eq!(
            cells_runtime.snapshot_json().1["last_pulse_at_ms"],
            pulse_before
        );
        assert_eq!(state.snapshot()["revision"], 2);
        assert_eq!(
            cells_runtime.snapshot_json().1["display"]["provenance"]["mode"],
            "composed"
        );

        // A stale-anchored composition is rejected under the SAME write
        // acquisition that would install it — no revision consumed.
        assert!(
            !state.apply_enrichment(EnrichmentEvent::GalaxyCompositionReplace(
                cknerv_core::GalaxyCompositionRecord {
                    source: "test".to_string(),
                    as_of: cknerv_core::ChainAnchor {
                        block: 10,
                        hash: "0xorphan".to_string(),
                    },
                    updated_at_ms: 1_002,
                    dao: Vec::new(),
                    typed: Vec::new(),
                    plain: Vec::new(),
                }
            ))
        );
        assert_eq!(state.snapshot()["revision"], 2);
    }

    /// The same landmine on the optional stream. Its runner has no
    /// snapshot cache to fall back on, so its read path IS the recovered
    /// guard.
    struct LandmineSemantics {
        applies: Arc<AtomicU64>,
        state: u64,
    }

    impl cknerv_core::Projection for LandmineSemantics {
        type Snapshot = u64;
        type Delta = u64;

        fn name(&self) -> &'static str {
            "landmine-semantics"
        }

        fn snapshot(&self) -> u64 {
            self.state
        }

        fn apply_mutation(&mut self, _m: &Mutation) -> Vec<u64> {
            Vec::new()
        }
    }

    impl cknerv_core::EnrichmentProjection for LandmineSemantics {
        fn apply_enrichment(&mut self, _event: &EnrichmentEvent) -> Vec<u64> {
            self.applies.fetch_add(1, Ordering::Relaxed);
            self.state = HALF_APPLIED;
            panic!("deliberate test panic inside an enrichment apply");
        }
    }

    /// The optional stream gets the same containment. Its own coordinator
    /// mutex is what the panic poisons here, and the projection has to keep
    /// answering through it — there is no cache on this runner to hide
    /// behind.
    #[test]
    fn a_panicking_enrichment_projection_is_quarantined_the_same_way() {
        let state = ServerState::new();
        let applies = Arc::new(AtomicU64::new(0));
        {
            let mut projections = state.projections.write().unwrap();
            projections.register_enrichment(LandmineSemantics {
                applies: applies.clone(),
                state: 0,
            });
        }
        let landmine = state
            .projections
            .read()
            .unwrap()
            .lookup("landmine-semantics")
            .expect("landmine runtime");

        let status = cknerv_core::EnrichmentSourceStatus::connecting("test", Vec::new());
        assert!(state.apply_enrichment(EnrichmentEvent::SourceStatus(status.clone())));
        assert!(landmine.quarantine_reason().is_some());

        // The snapshot route still answers, through the coordinator mutex
        // the panic poisoned.
        let (_, body) = landmine.snapshot_envelope(SnapshotEnvelope::Bare);
        assert!(String::from_utf8_lossy(&body).contains(&format!("\"snapshot\":{HALF_APPLIED}")));

        // Nothing reaches it again, on either stream, and the canonical
        // side is untouched by any of it.
        assert!(state.apply_enrichment(EnrichmentEvent::SourceStatus(status)));
        assert_eq!(applies.load(Ordering::Relaxed), 1);
        assert_eq!(state.apply_mutation(block(1)), 1);
        assert_eq!(state.snapshot()["chain"]["tip"], 1);
    }

    fn hydrated_reservoir_cell(id: u64, kind: cknerv_core::AssetKind) -> cknerv_core::Cell {
        cknerv_core::Cell {
            id,
            born_at_ms: 0,
            death_at_ms: None,
            birth_block: 0,
            tag: None,
            pos_seed: cknerv_core::helix_seed_for(id),
            out_point: cknerv_core::OutPoint {
                tx_hash: format!("0xr{id}"),
                index: 0,
            },
            capacity: 61_00000000,
            data_hex: "0x".into(),
            data_bytes: 0,
            content_hash: format!("0x{id:064x}"),
            lock_shape_seed: [id as u32, 1],
            type_shape_seed: None,
            data_shape_seed: [id as u32, 2],
            lock_kind: Default::default(),
            asset_kind: kind,
            lock_script: Default::default(),
            type_script: None,
        }
    }

    fn reservoir_record(block: u64, hash: &str) -> cknerv_core::GalaxyCompositionRecord {
        cknerv_core::GalaxyCompositionRecord {
            source: "ckbadger".to_string(),
            as_of: cknerv_core::ChainAnchor {
                block,
                hash: hash.to_string(),
            },
            updated_at_ms: 5_000,
            dao: vec![hydrated_reservoir_cell(
                500_000,
                cknerv_core::AssetKind::Dao,
            )],
            typed: vec![hydrated_reservoir_cell(
                500_001,
                cknerv_core::AssetKind::Xudt,
            )],
            plain: vec![hydrated_reservoir_cell(
                500_002,
                cknerv_core::AssetKind::Native,
            )],
        }
    }

    /// Supply carrying outpoints the stage does NOT already hold — an
    /// id already represented is declined by design (invariant I4).
    fn top_up_payload(block: u64, hash: &str) -> cknerv_core::GalaxyCompositionTopUp {
        cknerv_core::GalaxyCompositionTopUp {
            source: "ckbadger".to_string(),
            as_of: cknerv_core::ChainAnchor {
                block,
                hash: hash.to_string(),
            },
            updated_at_ms: 6_000,
            dao: vec![
                hydrated_reservoir_cell(600_000, cknerv_core::AssetKind::Dao),
                hydrated_reservoir_cell(600_001, cknerv_core::AssetKind::Dao),
            ],
            typed: vec![hydrated_reservoir_cell(
                600_002,
                cknerv_core::AssetKind::Xudt,
            )],
        }
    }

    /// T3 — the top-up rides the same internal channel as a replace, and
    /// obeys the same three rules: it never reaches the entity wire, it
    /// closes the published demand, and an anchor a reorg invalidated is
    /// discarded without consuming a revision.
    #[test]
    fn galaxy_top_up_closes_demand_over_the_internal_channel_only() {
        let sink = Arc::new(CompositionDemandSink::new());
        let mut state = ServerState::new();
        state.set_composition_demand_sink(sink.clone());
        {
            let mut projections = state.projections.write().unwrap();
            projections.register(
                cknerv_core::CellGalaxy::default().with_composition_demand_sink(sink.clone()),
            );
        }
        state.apply_mutation(Mutation::BlockMined {
            number: 10,
            hash: "0xblock10".into(),
            tx_count: 0,
            size: 0,
            at: 1_000,
        });
        assert!(
            state.apply_enrichment(EnrichmentEvent::GalaxyCompositionReplace(reservoir_record(
                10,
                "0xblock10"
            )))
        );
        let before = state.composition_demand();
        assert!(before.curated && before.dao > 0, "the stage is asking");

        let mut rx = state.subscribe_mutations();
        let revision_before = state.revision.load(Ordering::Relaxed);
        assert!(
            state.apply_enrichment(EnrichmentEvent::GalaxyCompositionTopUp(top_up_payload(
                10,
                "0xblock10"
            )))
        );
        assert_eq!(
            state.revision.load(Ordering::Relaxed),
            revision_before + 1,
            "the internal mutation consumes a revision"
        );
        let after = state.composition_demand();
        assert_eq!(after.dao, before.dao - 2, "two dao supplied");
        assert_eq!(after.typed, before.typed - 1, "one typed supplied");

        // …and nothing about it is visible outside.
        assert!(
            state
                .mutation_ring_snapshot()
                .iter()
                .all(|rm| !matches!(rm.mutation, Mutation::GalaxyReservoirToppedUp { .. })),
            "the entity ring must never contain the top-up tag"
        );
        assert!(
            matches!(
                rx.try_recv(),
                Err(tokio::sync::broadcast::error::TryRecvError::Empty)
            ),
            "the entity broadcast must never carry the top-up tag"
        );
        let cells_snap = state
            .projections
            .read()
            .unwrap()
            .lookup("cells")
            .unwrap()
            .snapshot_json()
            .1;
        assert!(
            cells_snap["cells"].as_array().unwrap().is_empty(),
            "supply must never enter the canonical cells map (I2)"
        );

        // An anchor the chain no longer has is discarded outright — and
        // it must not consume a revision on the way out.
        let revision_before = state.revision.load(Ordering::Relaxed);
        let stale = state.composition_demand();
        assert!(
            !state.apply_enrichment(EnrichmentEvent::GalaxyCompositionTopUp(top_up_payload(
                9, "0xblock9"
            )))
        );
        assert_eq!(
            state.revision.load(Ordering::Relaxed),
            revision_before,
            "a rejected top-up consumes nothing"
        );
        assert_eq!(state.composition_demand(), stale, "and changes nothing");
    }

    /// R5 pin: `GalaxyReservoirReplaced` NEVER reaches the entity wire.
    /// Its revision is consumed but neither the mutation ring nor the
    /// live broadcast carries the tag, and the next visible mutation
    /// flows normally across the gap (the ws replay check tolerates
    /// non-contiguous revisions).
    #[test]
    fn galaxy_reservoir_mutation_never_reaches_the_entity_wire() {
        let state = ServerState::new();
        state.apply_mutation(Mutation::BlockMined {
            number: 10,
            hash: "0xblock10".into(),
            tx_count: 0,
            size: 0,
            at: 1_000,
        });
        let mut rx = state.subscribe_mutations();

        let revision = state.apply_mutation(Mutation::GalaxyReservoirReplaced {
            record: reservoir_record(10, "0xblock10"),
        });
        assert_eq!(revision, 2, "the internal mutation consumes a revision");
        assert!(
            state
                .mutation_ring_snapshot()
                .iter()
                .all(|rm| rm.mutation.entity_wire_visible()
                    && !matches!(rm.mutation, Mutation::GalaxyReservoirReplaced { .. })),
            "the entity ring must never contain the internal tag"
        );
        assert!(
            matches!(
                rx.try_recv(),
                Err(tokio::sync::broadcast::error::TryRecvError::Empty)
            ),
            "the entity broadcast must never carry the internal tag"
        );

        // The next visible mutation broadcasts at revision 3 — the gap at
        // revision 2 never surfaces as a frame.
        let next = state.apply_mutation(Mutation::BlockMined {
            number: 11,
            hash: "0xblock11".into(),
            tx_count: 0,
            size: 0,
            at: 2_000,
        });
        assert_eq!(next, 3);
        let got = rx.try_recv().expect("visible mutation broadcasts");
        assert_eq!(got.revision, 3);
        assert!(matches!(got.mutation, Mutation::BlockMined { .. }));
        let ring: Vec<u64> = state
            .mutation_ring_snapshot()
            .iter()
            .map(|rm| rm.revision)
            .collect();
        assert_eq!(ring, vec![1, 3], "ring skips the internal revision");
    }

    /// D6: one enrichment event installs the reservoir into the cells
    /// projection (display plane, via the canonical channel) and nowhere
    /// else — semantics stays empty and the entity wire sees nothing.
    #[test]
    fn galaxy_composition_installs_the_reservoir_and_nothing_else() {
        let state = ServerState::new();
        {
            let mut projections = state.projections.write().unwrap();
            projections.register(cknerv_core::CellGalaxy::default());
            projections.register_enrichment(cknerv_core::SemanticsProjection::new(Some((
                "ckbadger",
                vec!["galaxy_composition".into()],
            ))));
        }
        state.apply_mutation(Mutation::BlockMined {
            number: 10,
            hash: "0xblock10".into(),
            tx_count: 0,
            size: 0,
            at: 1_000,
        });
        let mut rx = state.subscribe_mutations();

        assert!(
            state.apply_enrichment(EnrichmentEvent::GalaxyCompositionReplace(reservoir_record(
                10,
                "0xblock10"
            )))
        );

        // Cells projection: composed display plane with resident
        // payloads, at the canonical revision the synthesis consumed.
        let cells_runtime = state.projections.read().unwrap().lookup("cells").unwrap();
        let (cells_rev, cells_snap) = cells_runtime.snapshot_json();
        assert_eq!(cells_rev, 2);
        assert_eq!(cells_snap["display"]["provenance"]["mode"], "composed");
        assert_eq!(cells_snap["display"]["provenance"]["source"], "ckbadger");
        assert_eq!(
            cells_snap["display"]["residents"].as_array().unwrap().len(),
            3
        );
        assert_eq!(
            cells_snap["display"]["members"].as_array().unwrap().len(),
            3
        );
        assert!(
            cells_snap["cells"].as_array().unwrap().is_empty(),
            "the reservoir must never enter the canonical cells map (I2)"
        );

        // Semantics: untouched. The record has exactly one destination.
        let semantics_runtime = state
            .projections
            .read()
            .unwrap()
            .lookup("semantics")
            .unwrap();
        let (semantics_rev, semantics_snap) = semantics_runtime.snapshot_json();
        assert_eq!(semantics_rev, 0);
        assert!(semantics_snap.get("galaxy_composition").is_none());

        // Entity wire: nothing.
        assert!(matches!(
            rx.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ));
        assert!(state
            .mutation_ring_snapshot()
            .iter()
            .all(|rm| rm.mutation.entity_wire_visible()));
    }
}
