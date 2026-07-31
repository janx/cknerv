//! Projection trait: derived views computed from the mutation stream.
//!
//! A **projection** is a derived view computed from the structural
//! mutation stream. The cell-galaxy birth/death/tag reducer is the
//! canonical example: rather than every browser tab independently
//! replaying every `BlockMined` mutation to rebuild the cell field,
//! the cknerv-server runs the reducer once and ships snapshots + deltas.
//!
//! The plumbing here is intentionally minimal — one trait — because
//! future projections (OT timeline, propagation graph, …) follow the
//! same shape: `(Snapshot, Delta) -> wire frames`. The runtime
//! (registry, broadcast channels, delta-seq plumbing) lives in
//! `cknerv-server` (PR B4); cknerv-core stays sans-tokio.

use serde::Serialize;
use serde_json::Value;

use crate::mutation::Mutation;

pub mod cells;

/// A typed projection of the entity store. Implementors maintain their
/// own internal state (initialized in `new`), apply incoming mutations,
/// and expose a JSON-serializable snapshot + delta stream.
///
/// Conventions:
///   * `apply_mutation` may emit zero, one, or many deltas per mutation.
///     Multi-delta is rare but legal (e.g. one mutation triggering both
///     a birth and a tag in the cell galaxy).
///   * `snapshot()` is called under the server's coord read lock — it
///     must be cheap-ish and lock-free internally (the projection's own
///     state isn't shared with the reducer, so this is naturally true).
///   * `save()`/`load()` are used by the preserved-workdir checkpoint/boot
///     path to persist the projection's full internal state across restarts.
///     The default impls write/read nothing (suitable for
///     projections that are cheap to recompute from the mutation stream);
///     projections with non-trivial accumulated state (cell galaxy) override.
pub trait Projection: Send + Sync + 'static {
    /// JSON-serializable snapshot type.
    type Snapshot: Serialize + Send + 'static;
    /// JSON-serializable per-change delta type sent on the WS stream.
    type Delta: Serialize + Clone + Send + 'static;

    /// Path segment under `/api/projections/`. Used to construct routes
    /// and to disambiguate per-projection broadcast channels.
    fn name(&self) -> &'static str;

    /// Capture the current state as a serializable snapshot.
    fn snapshot(&self) -> Self::Snapshot;

    /// Apply a mutation, returning zero or more deltas to broadcast.
    fn apply_mutation(&mut self, m: &Mutation) -> Vec<Self::Delta>;

    /// Serialize the projection's full internal state for cross-run
    /// persistence. Default: emit `Null`, meaning "nothing to save".
    fn save(&self) -> Value {
        Value::Null
    }

    /// Restore from a previously saved value. Default: ignore the input
    /// (matches the `Null` save default). Returns an error if the value
    /// shape doesn't match — the caller may then start fresh.
    fn load(&mut self, _v: Value) -> Result<(), String> {
        Ok(())
    }
}
