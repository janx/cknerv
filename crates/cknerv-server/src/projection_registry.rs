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
    /// Columnar (binary) snapshot with the revision patched into its header
    /// slot; `None` for projections without a binary form.
    fn snapshot_bin(&self) -> Option<(u64, Vec<u8>)> {
        None
    }
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

    fn snapshot_bin(&self) -> Option<(u64, Vec<u8>)> {
        // Read the revision under the SAME projection read-lock as the
        // snapshot so the patched header cannot drift from the rows.
        let p = self.inner.read().unwrap();
        let mut bytes = p.snapshot_bin()?;
        let revision = self.revision.load(Ordering::Relaxed);
        bytes[cknerv_core::projection::cells_columnar::CELLS_COLUMNAR_REVISION_OFFSET
            ..cknerv_core::projection::cells_columnar::CELLS_COLUMNAR_REVISION_OFFSET + 8]
            .copy_from_slice(&revision.to_le_bytes());
        Some((revision, bytes))
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

/// Runner for a projection that consumes both canonical invalidation events
/// and optional enrichment events. Its revision is local to the projection:
/// canonical mutations that do not emit semantics deltas do not advance it.
pub struct EnrichmentProjectionRunner<P: EnrichmentProjection> {
    name: &'static str,
    inner: RwLock<P>,
    event_coord: Mutex<()>,
    revision: AtomicU64,
    delta_seq: AtomicU64,
    tx: broadcast::Sender<DeltaEntry>,
    ring: Ring<DeltaEntry>,
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
            let entry = DeltaEntry {
                seq,
                rev: revision,
                value,
            };
            self.ring.push(entry.clone());
            let _ = self.tx.send(entry);
        }
    }
}

impl<P: EnrichmentProjection> ProjectionRuntime for EnrichmentProjectionRunner<P> {
    fn name(&self) -> &'static str {
        self.name
    }

    fn snapshot_json(&self) -> (u64, Value) {
        let _coord = self.event_coord.lock().unwrap();
        let snapshot = self.inner.read().unwrap().snapshot();
        let value = serde_json::to_value(snapshot).unwrap_or(Value::Null);
        (self.revision.load(Ordering::Relaxed), value)
    }

    fn delta_ring_snapshot(&self) -> Vec<DeltaEntry> {
        self.ring.snapshot()
    }

    fn subscribe(&self) -> broadcast::Receiver<DeltaEntry> {
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
