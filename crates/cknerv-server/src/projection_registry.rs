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
use std::sync::{Arc, RwLock};

use serde_json::Value;
use tokio::sync::broadcast;

use cknerv_core::{Projection, RevisionedMutation, Ring};

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
#[derive(Clone, Debug)]
pub struct DeltaEntry {
    pub seq: u64,
    pub rev: u64,
    pub value: Value,
}

/// Read-side handle exposed to HTTP/WS routes.
pub trait ProjectionRuntime: Send + Sync {
    fn name(&self) -> &'static str;
    /// Snapshot the projection. Returns `(revision, JSON value)` so the
    /// client can resume the stream from `since=revision`.
    fn snapshot_json(&self) -> (u64, Value);
    /// Snapshot the delta ring (oldest → newest).
    fn delta_ring_snapshot(&self) -> Vec<DeltaEntry>;
    /// Subscribe to the live delta channel.
    fn subscribe(&self) -> broadcast::Receiver<DeltaEntry>;
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
    tx: broadcast::Sender<DeltaEntry>,
    ring: Ring<DeltaEntry>,
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
        }
    }
}

impl<P: Projection> ProjectionRuntime for ProjectionRunner<P> {
    fn name(&self) -> &'static str {
        self.name
    }

    fn snapshot_json(&self) -> (u64, Value) {
        let p = self.inner.read().unwrap();
        let snap = p.snapshot();
        let value = serde_json::to_value(&snap).unwrap_or(Value::Null);
        (self.revision.load(Ordering::Relaxed), value)
    }

    fn delta_ring_snapshot(&self) -> Vec<DeltaEntry> {
        self.ring.snapshot()
    }

    fn subscribe(&self) -> broadcast::Receiver<DeltaEntry> {
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
        // Collect deltas under the projection's own write lock. The lock
        // is released before broadcasting so a slow subscriber can't
        // wedge the reducer task. (Same discipline as simulator.)
        let deltas = {
            let mut p = self.inner.write().unwrap();
            p.apply_mutation(&rm.mutation)
        };
        // Always advance our revision to match the EntityStore's. Even
        // if no deltas were emitted, the revision moves forward so a
        // client at `since=N-1` knows we processed mutation N.
        self.revision.store(rm.revision, Ordering::Relaxed);
        for d in deltas {
            let value = serde_json::to_value(&d).unwrap_or(Value::Null);
            let seq = self.delta_seq.fetch_add(1, Ordering::Relaxed) + 1;
            let entry = DeltaEntry {
                seq,
                rev: rm.revision,
                value,
            };
            self.ring.push(entry.clone());
            // A broadcast with zero live subscribers errors — ignore it,
            // the ring still has the record for catch-up.
            let _ = self.tx.send(entry);
        }
    }
}

/// Holds the registered projections. Routes look up by name via `lookup`;
/// the reducer task drains `writers()` per mutation.
pub struct Registry {
    read_runtimes: Vec<Arc<dyn ProjectionRuntime>>,
    writers: Vec<Arc<dyn ApplyMutation>>,
}

impl Registry {
    pub fn new() -> Self {
        Self {
            read_runtimes: Vec::new(),
            writers: Vec::new(),
        }
    }

    pub fn register<P: Projection>(&mut self, projection: P) {
        let runner = Arc::new(ProjectionRunner::new(projection));
        self.read_runtimes
            .push(runner.clone() as Arc<dyn ProjectionRuntime>);
        self.writers
            .push(runner.clone() as Arc<dyn ApplyMutation>);
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

    /// Save every registered projection's state into a `{name → value}`
    /// JSON object. Used by the preserved-workdir shutdown hook.
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
