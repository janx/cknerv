//! Type-erased projection registry.
//!
//! Lifted from simulator's `dashboard/projections/mod.rs`
//! (`ProjectionRegistry` + `ProjectionRunner` + the `apply` + `seq/rev`
//! discipline). cknerv-server owns the runtime so cknerv-core stays
//! sans-tokio.
//!
//! Each registered projection gets:
//!   * a `Box<dyn Projection>` (interior `RwLock` so the reducer task can
//!     write while routes snapshot),
//!   * a per-projection `broadcast::Sender<DeltaEntry>` for live fan-out,
//!   * a per-projection ring of recent deltas (for reconnect catch-up with
//!     `?since=<revision>`),
//!   * a monotonic `seq` counter — multiple deltas can share a revision
//!     (one mutation triggering both a birth + a tag, etc.), so per-delta
//!     dedup against `last_sent_seq` needs the extra granularity.
//!
//! Lock discipline matches the simulator: write the projection (under its
//! internal `RwLock`), record the deltas, then release before broadcasting,
//! so we never hold a sync lock across an `.await`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use axum::body::Bytes;
use serde_json::Value;
use tokio::sync::broadcast;

use cknerv_core::{EnrichmentEvent, EnrichmentProjection, Projection, RevisionedMutation, Ring};

/// Per-projection broadcast capacity. Matches the simulator's
/// `PROJECTION_CHANNEL_CAPACITY`.
const PROJECTION_CHANNEL_CAPACITY: usize = 4096;

/// Per-projection delta ring capacity. Reconnecting clients with a `since`
/// revision inside this ring catch up via deltas; older `since` values
/// force a snapshot.
const PROJECTION_DELTA_RING_CAP: usize = 50_000;

/// One emitted delta. Carries both a per-delta global sequence number
/// (used internally for dedup against `since`) and the revision of the
/// mutation that produced it (surfaced to the client). Multiple deltas
/// from the same mutation share `rev` but each gets a unique `seq`.
///
/// Always handed around as [`SharedDelta`]. The ring holds up to 50k of
/// these and a display delta can carry hundreds of full Cell payloads, so
/// a connecting client that deep-copied the backlog would stall the
/// server for as long as the copy took — measured at 87–750ms even when
/// it had nothing to replay. Broadcast delivery has the same shape: one
/// entry, N subscribers, N copies of the same `Value` tree.
#[derive(Clone, Debug)]
pub struct DeltaEntry {
    pub seq: u64,
    pub rev: u64,
    pub value: Value,
}

/// Reference-counted delta. Cloning is a pointer bump, which is what makes
/// ring replay and broadcast fan-out cheap.
pub type SharedDelta = Arc<DeltaEntry>;

/// Which envelope a caller needs around the serialized snapshot body. Both
/// shapes carry the revision so the client can resume from
/// `since=revision`; only the WS frame is self-describing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SnapshotEnvelope {
    /// `{"revision":N,"snapshot":…}` — the HTTP route.
    Bare,
    /// `{"kind":"snapshot","revision":N,"snapshot":…}` — the WS frame.
    Frame,
}

impl SnapshotEnvelope {
    fn kind(self) -> Option<&'static str> {
        match self {
            Self::Bare => None,
            Self::Frame => Some("snapshot"),
        }
    }
}

/// The wire envelope, serialized in ONE pass straight to text. The snapshot
/// rides as a borrow: no intermediate `serde_json::Value` is ever built.
///
/// That intermediate tree was the whole cost of this path — a 50k-cell
/// galaxy turns into ~770k `Map` entries plus as many heap `String` keys,
/// none of which any caller wants (routes and ws both serialize it right
/// back out). Skipping it is worth more than every other tuning here.
#[derive(serde::Serialize)]
struct SnapshotEnvelopeBody<'a, S: serde::Serialize> {
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<&'static str>,
    revision: u64,
    snapshot: &'a S,
}

fn serialize_envelope<S: serde::Serialize>(
    envelope: SnapshotEnvelope,
    revision: u64,
    snapshot: &S,
) -> String {
    serde_json::to_string(&SnapshotEnvelopeBody {
        kind: envelope.kind(),
        revision,
        snapshot,
    })
    .unwrap_or_else(|_| String::from("{}"))
}

/// Serialized snapshots held for the revision they were taken at.
///
/// A snapshot is expensive to produce and every client that arrives at the
/// same revision wants byte-identical output, so the second arrival should
/// pay nothing: a hit never touches the projection lock, which is the lock
/// the reducer needs. Bursts are the normal case — a page load fetches and
/// then streams, StrictMode mounts twice, several tabs open together.
///
/// Entries are dropped the moment a mutation makes them unservable, so a
/// quiet server does not sit on tens of megabytes that can never be sent
/// again. Two readers missing at once both build; the waste is one
/// duplicate serialization, and the alternative is a lock that makes them
/// wait for each other.
#[derive(Default)]
struct SnapshotCache {
    revision: Option<u64>,
    bare: Option<Bytes>,
    frame: Option<Bytes>,
    bin: Option<Bytes>,
}

impl SnapshotCache {
    fn slot(&mut self, envelope: Option<SnapshotEnvelope>) -> &mut Option<Bytes> {
        match envelope {
            Some(SnapshotEnvelope::Bare) => &mut self.bare,
            Some(SnapshotEnvelope::Frame) => &mut self.frame,
            None => &mut self.bin,
        }
    }

    fn get(&mut self, envelope: Option<SnapshotEnvelope>, revision: u64) -> Option<Bytes> {
        if self.revision != Some(revision) {
            return None;
        }
        self.slot(envelope).clone()
    }

    fn put(&mut self, envelope: Option<SnapshotEnvelope>, revision: u64, bytes: Bytes) {
        if self.revision != Some(revision) {
            *self = Self {
                revision: Some(revision),
                ..Default::default()
            };
        }
        *self.slot(envelope) = Some(bytes);
    }

    fn clear(&mut self) {
        if self.revision.is_some() {
            *self = Self::default();
        }
    }
}

/// Test shim: the snapshot body back as a `Value`, for assertions that want
/// to index into it. Deliberately NOT on the trait — materializing a
/// `Value` is precisely what the production path exists to avoid, so it
/// must stay unreachable from route code.
#[cfg(test)]
pub(crate) trait ProjectionRuntimeTestExt {
    fn snapshot_json(&self) -> (u64, Value);
}

#[cfg(test)]
impl<T: ProjectionRuntime + ?Sized> ProjectionRuntimeTestExt for T {
    fn snapshot_json(&self) -> (u64, Value) {
        let (revision, text) = self.snapshot_envelope(SnapshotEnvelope::Bare);
        let mut envelope: Value = serde_json::from_slice(&text).expect("snapshot envelope is JSON");
        (revision, envelope["snapshot"].take())
    }
}

/// Read-side handle exposed to HTTP/WS routes.
pub trait ProjectionRuntime: Send + Sync {
    fn name(&self) -> &'static str;
    /// Serialize the projection snapshot inside `envelope`. Returns
    /// `(revision, JSON text)` so the client can resume the stream from
    /// `since=revision`. Reference-counted: repeat callers at one revision
    /// share the bytes rather than each getting a copy.
    fn snapshot_envelope(&self, envelope: SnapshotEnvelope) -> (u64, Bytes);
    /// Columnar (binary) snapshot with the revision patched into its header
    /// slot; `None` for projections without a binary form.
    fn snapshot_bin(&self) -> Option<(u64, Bytes)> {
        None
    }
    /// Snapshot the delta ring (oldest → newest).
    fn delta_ring_snapshot(&self) -> Vec<SharedDelta>;
    /// Subscribe to the live delta channel.
    fn subscribe(&self) -> broadcast::Receiver<SharedDelta>;
    /// Persistable state — `Value::Null` for projections that opt out of
    /// cross-run persistence.
    fn save_state(&self) -> Value;
    /// Restore from a previously saved value. Errors are returned to the
    /// caller, who may then drop the saved value and continue empty.
    fn load_state(&self, v: Value) -> Result<(), String>;
}

/// Write-side handle the reducer uses to fan a mutation into each
/// projection.
pub trait ApplyMutation: Send + Sync {
    fn apply(&self, rm: &RevisionedMutation);
}

/// Write-side handle for the optional, non-canonical enrichment stream.
pub trait ApplyEnrichment: Send + Sync {
    fn apply_enrichment(&self, event: &EnrichmentEvent);
}

/// Concrete adapter: wraps a `Projection` with the per-projection
/// broadcast + ring. The runtime task lives in `state.rs`; this struct
/// provides the read-side handles.
pub struct ProjectionRunner<P: Projection> {
    name: &'static str,
    inner: RwLock<P>,
    revision: AtomicU64,
    /// Monotonic per-delta sequence. Used as the cursor for catch-up dedup
    /// in `handle_projection_stream` so multiple deltas from a single
    /// mutation (sharing `rev`) each get a unique skip key.
    delta_seq: AtomicU64,
    tx: broadcast::Sender<SharedDelta>,
    ring: Ring<SharedDelta>,
    snapshots: Mutex<SnapshotCache>,
}

impl<P: Projection> ProjectionRunner<P> {
    fn new(projection: P) -> Self {
        let (tx, _) = broadcast::channel(PROJECTION_CHANNEL_CAPACITY);
        let name = projection.name();
        Self {
            name,
            inner: RwLock::new(projection),
            revision: AtomicU64::new(0),
            delta_seq: AtomicU64::new(0),
            tx,
            ring: Ring::with_capacity(PROJECTION_DELTA_RING_CAP),
            snapshots: Mutex::new(SnapshotCache::default()),
        }
    }

    /// Serve `envelope` from the cache when it is current. Checked before
    /// the projection lock is taken, so a hit costs one atomic load and one
    /// uncontended mutex.
    fn cached(&self, envelope: Option<SnapshotEnvelope>) -> Option<(u64, Bytes)> {
        let revision = self.revision.load(Ordering::Relaxed);
        let hit = self.snapshots.lock().unwrap().get(envelope, revision)?;
        Some((revision, hit))
    }

    fn remember(&self, envelope: Option<SnapshotEnvelope>, revision: u64, bytes: &Bytes) {
        self.snapshots
            .lock()
            .unwrap()
            .put(envelope, revision, bytes.clone());
    }
}

impl<P: Projection> ProjectionRuntime for ProjectionRunner<P> {
    fn name(&self) -> &'static str {
        self.name
    }

    fn snapshot_envelope(&self, envelope: SnapshotEnvelope) -> (u64, Bytes) {
        if let Some(hit) = self.cached(Some(envelope)) {
            return hit;
        }
        // The read lock covers TAKING the snapshot, never WRITING it out.
        // The reducer's fan-out waits on this lock while holding the coord
        // write lock, so anything left inside this scope stalls the whole
        // server — including endpoints that have nothing to do with this
        // projection. Revision and state are still read together, so the
        // pair a client resumes from stays consistent.
        let (revision, snap) = {
            let p = self.inner.read().unwrap();
            (self.revision.load(Ordering::Relaxed), p.snapshot())
        };
        let bytes = Bytes::from(serialize_envelope(envelope, revision, &snap).into_bytes());
        self.remember(Some(envelope), revision, &bytes);
        (revision, bytes)
    }

    fn snapshot_bin(&self) -> Option<(u64, Bytes)> {
        if let Some(hit) = self.cached(None) {
            return Some(hit);
        }
        // Read the revision under the SAME projection read-lock as the
        // snapshot so the patched header cannot drift from the rows.
        let (revision, mut bytes) = {
            let p = self.inner.read().unwrap();
            (self.revision.load(Ordering::Relaxed), p.snapshot_bin()?)
        };
        bytes[cknerv_core::projection::cells_columnar::CELLS_COLUMNAR_REVISION_OFFSET
            ..cknerv_core::projection::cells_columnar::CELLS_COLUMNAR_REVISION_OFFSET + 8]
            .copy_from_slice(&revision.to_le_bytes());
        let bytes = Bytes::from(bytes);
        self.remember(None, revision, &bytes);
        Some((revision, bytes))
    }

    fn delta_ring_snapshot(&self) -> Vec<SharedDelta> {
        self.ring.snapshot()
    }

    fn subscribe(&self) -> broadcast::Receiver<SharedDelta> {
        self.tx.subscribe()
    }

    fn save_state(&self) -> Value {
        self.inner.read().unwrap().save()
    }

    fn load_state(&self, v: Value) -> Result<(), String> {
        self.inner.write().unwrap().load(v)
    }
}

impl<P: Projection> ApplyMutation for ProjectionRunner<P> {
    fn apply(&self, rm: &RevisionedMutation) {
        if let cknerv_core::Mutation::BackfillProgress { active, .. } = &rm.mutation {
            if *active {
                self.ring.clear();
            } else {
                self.ring.clear_and_shrink();
            }
        }
        // Collect deltas under the projection's own write lock. The lock
        // is released before broadcasting so a slow subscriber can't
        // wedge the reducer task. (Same discipline as simulator.)
        let deltas = {
            let mut p = self.inner.write().unwrap();
            p.apply_mutation(&rm.mutation)
        };
        // Always advance our revision to match the EntityStore's. Even
        // if no deltas were emitted, the revision moves forward so a
        // client at `since=N-1` knows we processed mutation N. Cached
        // snapshots die with the revision they described — holding one no
        // client can be served is pure resident memory.
        self.revision.store(rm.revision, Ordering::Relaxed);
        self.snapshots.lock().unwrap().clear();
        for d in deltas {
            let value = serde_json::to_value(&d).unwrap_or(Value::Null);
            let seq = self.delta_seq.fetch_add(1, Ordering::Relaxed) + 1;
            let entry: SharedDelta = Arc::new(DeltaEntry {
                seq,
                rev: rm.revision,
                value,
            });
            self.ring.push(entry.clone());
            // A broadcast with zero live subscribers errors — ignore it,
            // the ring still has the record for catch-up.
            let _ = self.tx.send(entry);
        }
    }
}

/// Runner for a projection that consumes both canonical invalidation events
/// and optional enrichment events. Its revision is local to the projection:
/// canonical mutations that do not emit semantics deltas do not advance it.
pub struct EnrichmentProjectionRunner<P: EnrichmentProjection> {
    name: &'static str,
    inner: RwLock<P>,
    event_coord: Mutex<()>,
    revision: AtomicU64,
    delta_seq: AtomicU64,
    tx: broadcast::Sender<SharedDelta>,
    ring: Ring<SharedDelta>,
}

impl<P: EnrichmentProjection> EnrichmentProjectionRunner<P> {
    fn new(projection: P) -> Self {
        let (tx, _) = broadcast::channel(PROJECTION_CHANNEL_CAPACITY);
        let name = projection.name();
        Self {
            name,
            inner: RwLock::new(projection),
            event_coord: Mutex::new(()),
            revision: AtomicU64::new(0),
            delta_seq: AtomicU64::new(0),
            tx,
            ring: Ring::with_capacity(PROJECTION_DELTA_RING_CAP),
        }
    }

    fn publish(&self, deltas: Vec<P::Delta>) {
        if deltas.is_empty() {
            return;
        }
        for delta in deltas {
            // Enrichment owns its cursor, so each independently applicable
            // delta gets a revision. A reconnect can never resume midway
            // through a multi-delta event and accidentally skip its tail.
            let revision = self.revision.fetch_add(1, Ordering::Relaxed) + 1;
            let value = serde_json::to_value(&delta).unwrap_or(Value::Null);
            let seq = self.delta_seq.fetch_add(1, Ordering::Relaxed) + 1;
            let entry: SharedDelta = Arc::new(DeltaEntry {
                seq,
                rev: revision,
                value,
            });
            self.ring.push(entry.clone());
            let _ = self.tx.send(entry);
        }
    }
}

impl<P: EnrichmentProjection> ProjectionRuntime for EnrichmentProjectionRunner<P> {
    fn name(&self) -> &'static str {
        self.name
    }

    fn snapshot_envelope(&self, envelope: SnapshotEnvelope) -> (u64, Bytes) {
        // Same rule as the canonical runner: serialize outside every lock.
        // Here the event coordinator matters too — it is what an incoming
        // enrichment event has to take. No snapshot cache: enrichment
        // snapshots are aggregates measured in kilobytes, so the cache
        // would cost a lock on the event path to save nothing worth
        // saving.
        let (revision, snapshot) = {
            let _coord = self.event_coord.lock().unwrap();
            let snapshot = self.inner.read().unwrap().snapshot();
            (self.revision.load(Ordering::Relaxed), snapshot)
        };
        (
            revision,
            Bytes::from(serialize_envelope(envelope, revision, &snapshot).into_bytes()),
        )
    }

    fn delta_ring_snapshot(&self) -> Vec<SharedDelta> {
        self.ring.snapshot()
    }

    fn subscribe(&self) -> broadcast::Receiver<SharedDelta> {
        self.tx.subscribe()
    }

    fn save_state(&self) -> Value {
        let _coord = self.event_coord.lock().unwrap();
        self.inner.read().unwrap().save()
    }

    fn load_state(&self, value: Value) -> Result<(), String> {
        let _coord = self.event_coord.lock().unwrap();
        self.inner.write().unwrap().load(value)
    }
}

impl<P: EnrichmentProjection> ApplyMutation for EnrichmentProjectionRunner<P> {
    fn apply(&self, rm: &RevisionedMutation) {
        let _coord = self.event_coord.lock().unwrap();
        let deltas = self.inner.write().unwrap().apply_mutation(&rm.mutation);
        self.publish(deltas);
    }
}

impl<P: EnrichmentProjection> ApplyEnrichment for EnrichmentProjectionRunner<P> {
    fn apply_enrichment(&self, event: &EnrichmentEvent) {
        let _coord = self.event_coord.lock().unwrap();
        let deltas = self.inner.write().unwrap().apply_enrichment(event);
        self.publish(deltas);
    }
}

/// Holds the registered projections. Routes look up by name via `lookup`;
/// the reducer task drains `writers()` per mutation.
pub struct Registry {
    read_runtimes: Vec<Arc<dyn ProjectionRuntime>>,
    writers: Vec<Arc<dyn ApplyMutation>>,
    enrichment_writers: Vec<Arc<dyn ApplyEnrichment>>,
}

impl Registry {
    pub fn new() -> Self {
        Self {
            read_runtimes: Vec::new(),
            writers: Vec::new(),
            enrichment_writers: Vec::new(),
        }
    }

    pub fn register<P: Projection>(&mut self, projection: P) {
        let runner = Arc::new(ProjectionRunner::new(projection));
        self.read_runtimes
            .push(runner.clone() as Arc<dyn ProjectionRuntime>);
        self.writers.push(runner.clone() as Arc<dyn ApplyMutation>);
    }

    pub fn register_enrichment<P: EnrichmentProjection>(&mut self, projection: P) {
        let runner = Arc::new(EnrichmentProjectionRunner::new(projection));
        self.read_runtimes
            .push(runner.clone() as Arc<dyn ProjectionRuntime>);
        self.writers.push(runner.clone() as Arc<dyn ApplyMutation>);
        self.enrichment_writers
            .push(runner as Arc<dyn ApplyEnrichment>);
    }

    pub fn lookup(&self, name: &str) -> Option<Arc<dyn ProjectionRuntime>> {
        self.read_runtimes
            .iter()
            .find(|r| r.name() == name)
            .cloned()
    }

    pub fn writers(&self) -> Vec<Arc<dyn ApplyMutation>> {
        self.writers.clone()
    }

    pub fn enrichment_writers(&self) -> Vec<Arc<dyn ApplyEnrichment>> {
        self.enrichment_writers.clone()
    }

    /// Save every registered projection's state into a `{name → value}`
    /// JSON object. Used by preserved-workdir checkpoints and shutdown.
    pub fn save_all(&self) -> Value {
        let mut map = serde_json::Map::new();
        for r in &self.read_runtimes {
            map.insert(r.name().to_string(), r.save_state());
        }
        Value::Object(map)
    }

    /// Restore every registered projection from a `{name → value}` JSON
    /// object produced by `save_all`. Missing keys are fine (the
    /// projection just stays empty). Per-projection load errors are
    /// logged and the projection is left in its empty state.
    pub fn load_all(&self, v: &Value) {
        let map = match v.as_object() {
            Some(m) => m,
            None => {
                tracing::warn!(
                    target: "cknerv-server",
                    "projection state was not a JSON object — discarding"
                );
                return;
            }
        };
        for r in &self.read_runtimes {
            if let Some(entry) = map.get(r.name()) {
                if entry.is_null() {
                    continue;
                }
                if let Err(e) = r.load_state(entry.clone()) {
                    tracing::warn!(
                        target: "cknerv-server",
                        "projection `{}` load failed: {e} — starting empty",
                        r.name()
                    );
                }
            }
        }
    }
}

impl Default for Registry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cknerv_core::projection::cells_columnar::CELLS_COLUMNAR_HEADER_BYTES;
    use cknerv_core::{
        helix_seed_for, Cell, CellGalaxy, ChainAnchor, EnrichmentEvent, EnrichmentSourceState,
        EnrichmentSourceStatus, GalaxyCompositionRecord, Mutation, OutPoint, SemanticsProjection,
        TxOutputInfo,
    };

    fn output(capacity: u64) -> TxOutputInfo {
        TxOutputInfo {
            capacity,
            data_hex: "0x".to_string(),
            content_hash: format!("0x{}", "00".repeat(32)),
            lock_kind: Default::default(),
            asset_kind: Default::default(),
            lock_script: Default::default(),
            type_script: None,
        }
    }

    fn galaxy_cell(id: u64) -> Cell {
        Cell {
            id,
            born_at_ms: 0,
            death_at_ms: None,
            birth_block: 1,
            tag: None,
            pos_seed: helix_seed_for(id),
            out_point: OutPoint {
                tx_hash: format!("0x{id:064x}"),
                index: 0,
            },
            capacity: id,
            data_hex: "0x".into(),
            content_hash: format!("0x{:064x}", id + 1),
            lock_kind: Default::default(),
            asset_kind: Default::default(),
            lock_script: Default::default(),
            type_script: None,
        }
    }

    /// Same composed content at every block; only the freshness metadata
    /// (`as_of`, `updated_at_ms`) advances — the shape of a periodic
    /// revalidation of an unchanged Cell set.
    fn galaxy_composition(block: u64) -> GalaxyCompositionRecord {
        GalaxyCompositionRecord {
            source: "ckbadger".into(),
            as_of: ChainAnchor {
                block,
                hash: format!("0xblock{block}"),
            },
            updated_at_ms: block,
            dao: vec![galaxy_cell(1)],
            typed: vec![galaxy_cell(2)],
            plain: vec![galaxy_cell(3)],
        }
    }

    /// Replay and fan-out must hand out the SAME entries, not copies. The
    /// ring holds up to 50k deltas and a display delta can carry hundreds
    /// of Cell payloads, so a client that deep-copied the backlog stalled
    /// the server just by connecting — even with nothing to replay.
    #[test]
    fn replaying_the_ring_shares_entries_instead_of_copying_them() {
        let mut registry = Registry::new();
        registry.register(CellGalaxy::new());
        let runtime = registry.lookup("cells").expect("cells runtime");
        let writer = registry.writers().into_iter().next().unwrap();
        let mut subscriber = runtime.subscribe();

        writer.apply(&RevisionedMutation {
            revision: 1,
            mutation: Mutation::TxLanded {
                tx_hash: "0xtx".to_string(),
                block: 1,
                at: 1_000,
                inputs: vec![],
                outputs: vec![output(100)],
            },
        });

        let first = runtime.delta_ring_snapshot();
        let second = runtime.delta_ring_snapshot();
        assert!(!first.is_empty(), "the fixture must emit deltas");
        assert_eq!(first.len(), second.len());
        assert!(
            first.iter().zip(&second).all(|(a, b)| Arc::ptr_eq(a, b)),
            "two readers of the ring must share its entries"
        );

        let live = subscriber.try_recv().expect("broadcast entry");
        assert!(
            first.iter().any(|entry| Arc::ptr_eq(entry, &live)),
            "a subscriber must receive the ring's entry, not a copy of it"
        );
    }

    /// Counts how often the projection was actually asked for a snapshot,
    /// so a cache hit is provable rather than inferred from timing.
    struct CountingProjection {
        taken: Arc<AtomicU64>,
    }

    impl Projection for CountingProjection {
        type Snapshot = u64;
        type Delta = u64;

        fn name(&self) -> &'static str {
            "counting"
        }

        fn snapshot(&self) -> u64 {
            self.taken.fetch_add(1, Ordering::Relaxed) + 1
        }

        fn snapshot_bin(&self) -> Option<Vec<u8>> {
            Some(vec![0u8; CELLS_COLUMNAR_HEADER_BYTES])
        }

        fn apply_mutation(&mut self, _m: &Mutation) -> Vec<u64> {
            Vec::new()
        }
    }

    /// Clients arrive in bursts at one revision — a page load fetching then
    /// streaming, StrictMode mounting twice, several tabs at once — and each
    /// of them wants byte-identical output. The second one should pay
    /// nothing, and the bytes must die with the revision they describe so a
    /// quiet server is not sitting on a snapshot nobody can be served.
    #[test]
    fn a_snapshot_is_serialized_once_per_revision_and_retired_with_it() {
        let taken = Arc::new(AtomicU64::new(0));
        let mut registry = Registry::new();
        registry.register(CountingProjection {
            taken: taken.clone(),
        });
        let runtime = registry.lookup("counting").expect("counting runtime");
        let writer = registry.writers().into_iter().next().unwrap();

        let (first_revision, first) = runtime.snapshot_envelope(SnapshotEnvelope::Bare);
        let (again_revision, again) = runtime.snapshot_envelope(SnapshotEnvelope::Bare);
        assert_eq!((first_revision, &first), (again_revision, &again));
        assert_eq!(
            taken.load(Ordering::Relaxed),
            1,
            "the second caller at one revision must not re-take the snapshot"
        );

        // Envelopes are separate slots: the frame is a different shape, so
        // serving it from the bare entry would ship a client the wrong one.
        let (_, frame) = runtime.snapshot_envelope(SnapshotEnvelope::Frame);
        assert_ne!(frame, first);
        assert_eq!(taken.load(Ordering::Relaxed), 2);

        let (_, bin) = runtime.snapshot_bin().expect("columnar snapshot");
        let (_, bin_again) = runtime.snapshot_bin().expect("columnar snapshot");
        assert_eq!(bin, bin_again);

        writer.apply(&RevisionedMutation {
            revision: 7,
            mutation: Mutation::ChainReorganized { from_block: 1 },
        });
        let (revision, after) = runtime.snapshot_envelope(SnapshotEnvelope::Bare);
        assert_eq!(revision, 7);
        assert_ne!(after, first, "a stale revision must not be served");
        assert_eq!(taken.load(Ordering::Relaxed), 3);
    }

    /// A projection whose snapshot parks the calling thread *while it
    /// serializes*, so a test can hold serialization open and see who else
    /// is stuck behind it.
    struct ParkingProjection {
        entered: Arc<std::sync::Barrier>,
        release: Arc<std::sync::Barrier>,
    }

    struct ParkingSnapshot {
        entered: Arc<std::sync::Barrier>,
        release: Arc<std::sync::Barrier>,
    }

    impl serde::Serialize for ParkingSnapshot {
        fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            self.entered.wait();
            self.release.wait();
            serializer.serialize_u64(1)
        }
    }

    impl Projection for ParkingProjection {
        type Snapshot = ParkingSnapshot;
        type Delta = u64;

        fn name(&self) -> &'static str {
            "parking"
        }

        fn snapshot(&self) -> ParkingSnapshot {
            ParkingSnapshot {
                entered: self.entered.clone(),
                release: self.release.clone(),
            }
        }

        fn apply_mutation(&mut self, _m: &Mutation) -> Vec<u64> {
            Vec::new()
        }
    }

    /// Serializing a snapshot must not hold the projection lock, because
    /// the reducer waits on that lock while holding the coord write lock —
    /// so a slow write-out freezes endpoints that have nothing to do with
    /// this projection. The proof is direct: park inside serialization and
    /// require a mutation to land anyway.
    #[test]
    fn a_parked_serialization_does_not_hold_up_the_reducer() {
        use std::sync::mpsc;
        use std::time::Duration;

        let entered = Arc::new(std::sync::Barrier::new(2));
        let release = Arc::new(std::sync::Barrier::new(2));
        let mut registry = Registry::new();
        registry.register(ParkingProjection {
            entered: entered.clone(),
            release: release.clone(),
        });
        let runtime = registry.lookup("parking").expect("parking runtime");
        let writer = registry.writers().into_iter().next().unwrap();

        let reader =
            std::thread::spawn(move || runtime.snapshot_envelope(SnapshotEnvelope::Bare).0);
        entered.wait(); // serialization is now in flight

        let (landed_tx, landed_rx) = mpsc::channel();
        let applier = std::thread::spawn(move || {
            writer.apply(&RevisionedMutation {
                revision: 1,
                mutation: Mutation::ChainReorganized { from_block: 1 },
            });
            let _ = landed_tx.send(());
        });
        let landed = landed_rx.recv_timeout(Duration::from_secs(5)).is_ok();

        release.wait();
        reader.join().expect("reader thread");
        applier.join().expect("applier thread");
        assert!(
            landed,
            "the reducer waited on snapshot serialization — the read lock is being held too long"
        );
    }

    /// The envelope is hand-rolled now — one serde pass straight to text,
    /// no intermediate `Value`. The guard against that drifting is a
    /// differential: feed the same mutations to a bare projection, take the
    /// `to_value` snapshot this path used to build, and require the emitted
    /// text to parse back to exactly it.
    #[test]
    fn snapshot_envelope_matches_the_value_path_it_replaced() {
        use cknerv_core::Projection;

        let mutations = [
            Mutation::BlockMined {
                number: 1,
                hash: "0xblock1".to_string(),
                tx_count: 1,
                size: 0,
                at: 1_000,
            },
            Mutation::TxLanded {
                tx_hash: "0xtx".to_string(),
                block: 1,
                at: 1_000,
                inputs: vec![],
                outputs: vec![output(100), output(200)],
            },
            // A composed reservoir puts resident payloads in the display
            // section — the heaviest part of a live snapshot, and the part
            // this refactor must not disturb.
            Mutation::GalaxyReservoirReplaced {
                record: galaxy_composition(1),
            },
        ];

        let mut registry = Registry::new();
        registry.register(CellGalaxy::new());
        let runtime = registry.lookup("cells").expect("cells runtime");
        let writer = registry.writers().into_iter().next().unwrap();
        let mut direct = CellGalaxy::new();
        for (index, mutation) in mutations.iter().enumerate() {
            writer.apply(&RevisionedMutation {
                revision: index as u64 + 1,
                mutation: mutation.clone(),
            });
            direct.apply_mutation(mutation);
        }

        let body = serde_json::to_value(direct.snapshot()).expect("snapshot serializes");
        assert!(
            !body["cells"].as_array().expect("cells").is_empty()
                && !body["display"]["residents"]
                    .as_array()
                    .expect("residents")
                    .is_empty(),
            "the fixture must exercise both canonical cells and resident payloads"
        );

        // Both sides are compared as text re-parsed by the SAME parser.
        // serde_json's default float parser is not round-trip exact, so
        // comparing a parsed value against a `to_value` one reports an ULP
        // of parser drift as if it were a wire change; routing both through
        // `from_str` cancels it and leaves only real differences. (Key
        // ORDER does change — struct declaration order instead of the
        // `Value` map's alphabetical — which is why this compares parsed
        // trees rather than raw bytes.)
        let reparse =
            |text: &[u8]| -> Value { serde_json::from_slice(text).expect("envelope is JSON") };
        let old_path = |kind: Option<&str>| {
            let mut envelope = serde_json::Map::new();
            if let Some(kind) = kind {
                envelope.insert("kind".into(), Value::from(kind));
            }
            envelope.insert("revision".into(), Value::from(3u64));
            envelope.insert("snapshot".into(), body.clone());
            reparse(
                serde_json::to_string(&Value::Object(envelope))
                    .unwrap()
                    .as_bytes(),
            )
        };

        let (revision, bare) = runtime.snapshot_envelope(SnapshotEnvelope::Bare);
        assert_eq!(revision, 3);
        assert_eq!(reparse(&bare), old_path(None));

        let (frame_revision, frame) = runtime.snapshot_envelope(SnapshotEnvelope::Frame);
        assert_eq!(frame_revision, 3);
        assert_eq!(reparse(&frame), old_path(Some("snapshot")));
    }

    #[test]
    fn replay_progress_compacts_projection_delta_ring() {
        let mut registry = Registry::new();
        registry.register(CellGalaxy::new());
        let runtime = registry.lookup("cells").expect("cells runtime");
        let writer = registry.writers().into_iter().next().expect("cells writer");

        for revision in 1..=3 {
            writer.apply(&RevisionedMutation {
                revision,
                mutation: Mutation::TxLanded {
                    tx_hash: format!("0xtx{revision}"),
                    block: revision,
                    at: revision,
                    inputs: vec![],
                    outputs: vec![output(revision)],
                },
            });
        }
        assert!(runtime.delta_ring_snapshot().len() > 3);

        writer.apply(&RevisionedMutation {
            revision: 4,
            mutation: Mutation::BackfillProgress {
                done: 25,
                total: 100,
                active: true,
                phase: cknerv_core::ReplayPhase::Boot,
            },
        });
        let ring = runtime.delta_ring_snapshot();
        assert_eq!(ring.len(), 1);
        assert_eq!(ring[0].rev, 4);
        assert_eq!(ring[0].value["type"], "backfill");
    }

    #[test]
    fn cell_reorg_stream_orders_link_prune_before_rollback_deltas() {
        let mut registry = Registry::new();
        registry.register(CellGalaxy::new());
        let runtime = registry.lookup("cells").expect("cells runtime");
        let writer = registry.writers().into_iter().next().expect("cells writer");
        let apply = |revision, mutation| {
            writer.apply(&RevisionedMutation { revision, mutation });
        };

        apply(
            1,
            Mutation::BlockMined {
                number: 1,
                hash: "0xblock-1".to_string(),
                tx_count: 1,
                size: 0,
                at: 1_000,
            },
        );
        apply(
            2,
            Mutation::TxLanded {
                tx_hash: "0xbase".to_string(),
                block: 1,
                at: 1_000,
                inputs: vec![],
                outputs: vec![output(100)],
            },
        );
        apply(
            3,
            Mutation::BlockMined {
                number: 2,
                hash: "0xorphan-block".to_string(),
                tx_count: 1,
                size: 0,
                at: 1_100,
            },
        );
        apply(
            4,
            Mutation::TxLanded {
                tx_hash: "0xorphan-tx".to_string(),
                block: 2,
                at: 1_100,
                inputs: vec![OutPoint {
                    tx_hash: "0xbase".to_string(),
                    index: 0,
                }],
                outputs: vec![output(100)],
            },
        );
        apply(
            5,
            Mutation::BlockMined {
                number: 2,
                hash: "0xcanonical-block".to_string(),
                tx_count: 0,
                size: 0,
                at: 1_200,
            },
        );

        let reorg: Vec<_> = runtime
            .delta_ring_snapshot()
            .into_iter()
            .filter(|entry| entry.rev == 5)
            .collect();
        assert_eq!(
            reorg.first().map(|entry| &entry.value),
            Some(&serde_json::json!({
                "type": "link_prune",
                "from_block": 2
            }))
        );
        assert!(
            reorg.iter().skip(1).any(|entry| {
                matches!(
                    entry.value.get("type").and_then(Value::as_str),
                    Some("gc" | "birth" | "stats")
                )
            }),
            "rollback Cell deltas must follow the causal invalidation"
        );

        let (_, snapshot) = runtime.snapshot_json();
        assert!(snapshot["recent_links"]
            .as_array()
            .expect("recent_links array")
            .iter()
            .all(|link| link["block"].as_u64().is_some_and(|block| block < 2)));
    }

    #[test]
    fn enrichment_projection_owns_an_independent_revision() {
        let mut registry = Registry::new();
        registry.register_enrichment(SemanticsProjection::new(Some(("ckbadger", vec![]))));
        let runtime = registry.lookup("semantics").expect("semantics runtime");
        let canonical = registry.writers().into_iter().next().unwrap();
        let enrichment = registry.enrichment_writers().into_iter().next().unwrap();

        canonical.apply(&RevisionedMutation {
            revision: 41,
            mutation: Mutation::BlockMined {
                number: 9,
                hash: "0xblock9".to_string(),
                tx_count: 0,
                size: 0,
                at: 9,
            },
        });
        assert_eq!(runtime.snapshot_json().0, 0);

        let mut status = EnrichmentSourceStatus::connecting("ckbadger", vec![]);
        status.status = EnrichmentSourceState::Ready;
        enrichment.apply_enrichment(&EnrichmentEvent::SourceStatus(status));
        assert_eq!(runtime.snapshot_json().0, 1);

        canonical.apply(&RevisionedMutation {
            revision: 42,
            mutation: Mutation::ChainReorganized { from_block: 9 },
        });
        let (revision, snapshot) = runtime.snapshot_json();
        assert_eq!(revision, 3);
        assert_eq!(snapshot["source"]["status"], "syncing");
        let ring = runtime.delta_ring_snapshot();
        assert_eq!(ring[1].rev, 2);
        assert_eq!(ring[1].value["type"], "prune");
        assert_eq!(ring[2].rev, 3);
        assert_eq!(ring[2].value["type"], "source_status");
    }

    /// Composition refreshes are display-plane input: they reach the cells
    /// projection through the canonical stream, so the semantics runtime
    /// must stay completely still — no delta, no revision, nothing in the
    /// ring — however often the source revalidates.
    #[test]
    fn galaxy_composition_refresh_never_moves_the_semantics_cursor() {
        let mut registry = Registry::new();
        registry.register_enrichment(SemanticsProjection::new(Some((
            "ckbadger",
            vec!["galaxy_composition".into()],
        ))));
        let runtime = registry.lookup("semantics").expect("semantics runtime");
        let enrichment = registry.enrichment_writers().into_iter().next().unwrap();
        let (revision_before, snapshot_before) = runtime.snapshot_json();

        for block in [10, 12, 14] {
            enrichment.apply_enrichment(&EnrichmentEvent::GalaxyCompositionReplace(
                galaxy_composition(block),
            ));
        }

        let (revision, snapshot) = runtime.snapshot_json();
        assert_eq!(revision, revision_before);
        assert_eq!(snapshot, snapshot_before);
        assert!(runtime.delta_ring_snapshot().is_empty());
    }
}
