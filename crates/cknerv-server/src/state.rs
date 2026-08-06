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

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use tokio::sync::broadcast::error::RecvError;
use tokio::sync::{broadcast, mpsc, watch};

use cknerv_core::{
    Chain, ChainNode, EnrichmentEvent, EnrichmentSourceState, MempoolStats, Mutation, Peer,
    RecentBlock, RecentTx, ReplayPhase, RevisionedMutation, Ring,
};

use crate::enrichment::CanonicalContext;
use crate::projection_registry::Registry;

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
    pub(crate) mutation_tx: broadcast::Sender<RevisionedMutation>,
    pub(crate) mutation_ring: Ring<RevisionedMutation>,
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
    /// Coordination lock making (state, revision) snapshot-atomic. The
    /// reducer takes the write side around its full apply sequence
    /// (mutate + revision bump + broadcast); `snapshot()` takes the
    /// read side so it observes a state matching the revision it
    /// returns.
    pub(crate) coord: RwLock<()>,
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
            coord: RwLock::new(()),
        }
    }

    /// Subscribe to the live mutation broadcast.
    pub fn subscribe_mutations(&self) -> broadcast::Receiver<RevisionedMutation> {
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
    pub fn mutation_ring_snapshot(&self) -> Vec<RevisionedMutation> {
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
        }
    }

    /// Apply a mutation. Holds the coord write lock for the full sequence
    /// (entity-store update + revision bump + ring push + broadcast +
    /// projection fan-out) so concurrent `snapshot()` readers observe
    /// (state, revision) atomically. Returns the assigned revision.
    pub fn apply_mutation(&self, m: Mutation) -> u64 {
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
        let _coord = self.coord.write().unwrap();
        if let Mutation::BackfillProgress { active, .. } = &m {
            self.replay_active.store(*active, Ordering::Relaxed);
        }
        {
            let mut store = self.entity_store.write().unwrap();
            apply_entity_mutation(&mut store, &m);
        }
        let revision = self.revision.fetch_add(1, Ordering::Relaxed) + 1;
        let rev = RevisionedMutation {
            revision,
            mutation: m,
        };
        if let Mutation::BackfillProgress { active, .. } = &rev.mutation {
            if *active {
                self.mutation_ring.clear();
            } else {
                self.mutation_ring.clear_and_shrink();
            }
        }
        self.mutation_ring.push(rev.clone());

        // 2. Fan into projections. Each projection takes its own
        //    internal lock; the registry's read lock is released before
        //    the projection broadcasts (the broadcast itself is sync
        //    inside tokio's lock-free MPMC, so no `.await` involved).
        {
            let registry = self.projections.read().unwrap();
            for writer in registry.writers() {
                writer.apply(&rev);
            }
        }

        // 3. Broadcast the structural mutation. A broadcast with zero
        //    subscribers errors — ignore it, the ring still holds the
        //    record for catch-up.
        let _ = self.mutation_tx.send(rev);
        if canonical_evidence_changed && !self.replay_active.load(Ordering::Relaxed) {
            self.canonical_evidence_tx.send_replace(revision);
        }
        if boot_replay_completed {
            self.boot_replay_complete_tx.send_replace(true);
        }

        revision
    }

    /// Apply one optional enrichment event without touching the canonical
    /// revision or mutation stream. Anchored records are rejected if a reorg
    /// raced the source request and the claimed block/hash is no longer in
    /// the retained canonical evidence window.
    pub fn apply_enrichment(&self, event: EnrichmentEvent) -> bool {
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

        let registry = self.projections.read().unwrap();
        for writer in registry.enrichment_writers() {
            writer.apply_enrichment(&event);
        }
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
                        // more will arrive. Exit cleanly.
                        None => break,
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
                            w.apply(&rm);
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
                });
            }
        }
        Mutation::ChainNodeInfoUpdated {
            id,
            version,
            connections,
        } => {
            if let Some(existing) = store.chain_nodes.iter_mut().find(|n| n.id == *id) {
                existing.version = version.clone();
                existing.connections = *connections;
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
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        s.apply_mutation(Mutation::ChainNodeInfoUpdated {
            id: "ckb:local".into(),
            version: "0.116.1".into(),
            connections: 24,
        });
        let nodes = &s.entity_store.read().unwrap().chain_nodes;
        assert_eq!(nodes[0].version, "0.116.1");
        assert_eq!(nodes[0].connections, 24);
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

    #[test]
    fn enrichment_anchor_guard_never_changes_canonical_revision() {
        let state = ServerState::new();
        state
            .projections
            .write()
            .unwrap()
            .register_enrichment(cknerv_core::SemanticsProjection::default());
        state.apply_mutation(Mutation::BlockMined {
            number: 10,
            hash: "0xcanonical".to_string(),
            tx_count: 0,
            size: 0,
            at: 10,
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
        assert_eq!(state.snapshot()["revision"], 1);
    }
}
