//! Cell galaxy projection — server-side UTXO mirror.
//!
//! Births and deaths are driven by real chain outpoints carried in
//! `Mutation::TxLanded`: every output spawns a cell (positioned
//! deterministically along a hybrid Crab+Milky-Way spiral via
//! [`crate::helix::helix_seed_for`]); every consumed input kills the cell
//! that represents that outpoint. `BlockMined` only handles cap
//! enforcement, pulse throttling and GC. Tagging is chain-generic: the
//! projection consumes `Mutation::CellTagged { out_point, tag, .. }` and
//! looks up the cell via `outpoint_index`.
//!
//! Tag values are opaque strings on the wire (`"wallet" | "dex" | "cf" |
//! "ckbloom"` in the simulator's RCG layer). The cell-galaxy projection
//! has no awareness of their meaning; palette/lookup lives at the SPA.
//!
//! **Determinism is contract**: [`crate::helix::helix_seed_for`] MUST
//! produce the same xyz as the TS implementation for every id,
//! byte-identical when both reduce to f32. This is anchored by a JSON
//! fixture (`tests/fixtures/helix_seed.json`) that both languages compare
//! against — see `crates/cknerv-core/tests/helix_parity.rs`.

use serde::{Deserialize, Serialize};

use crate::helix::helix_seed_for;
use crate::mutation::{Mutation, ReplayPhase};
use crate::outpoint::{is_cellbase_input, OutPoint, TxOutputInfo};
use crate::projection::Projection;
use crate::{AssetKind, LockKind};

// ── visual / behavior constants — mirror cellGalaxy.ts ───────────────
pub const CELL_CAP: usize = 5000;
pub const DEFAULT_RECENT_LINKS_CAP: usize = 2048;
/// Canonical block journals retained for exact reorg rollback. The CLI ties
/// this to its configured backfill window so rollback and controlled rebuild
/// cover the same recent-chain horizon.
pub const DEFAULT_REORG_WINDOW_BLOCKS: usize = 2000;
const PULSE_THROTTLE_MS: u64 = 800;
const DEATH_DURATION_MS: u64 = 600;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CellGalaxyConfig {
    pub cell_cap: usize,
    pub recent_links_cap: usize,
    pub reorg_window_blocks: usize,
}

impl Default for CellGalaxyConfig {
    fn default() -> Self {
        Self {
            cell_cap: CELL_CAP,
            recent_links_cap: DEFAULT_RECENT_LINKS_CAP,
            reorg_window_blocks: DEFAULT_REORG_WINDOW_BLOCKS,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Cell {
    pub id: u64,
    pub born_at_ms: u64,
    pub death_at_ms: Option<u64>,
    pub birth_block: u64,
    /// Free-form tag assigned by an external emitter. Known values in the
    /// simulator: `"wallet" | "dex" | "cf" | "ckbloom"`. The
    /// `#[serde(alias)]` accepts the legacy `otp_kind` key so persisted-
    /// state files written before this rename load cleanly.
    #[serde(alias = "otp_kind")]
    pub tag: Option<String>,
    pub pos_seed: [f32; 3],
    pub out_point: OutPoint,
    pub capacity: u64,
    pub data_hex: String,
    /// CKB-canonical BLAKE2b-256 of the serialized CellOutput + raw data.
    /// Stable identifier for the cell's on-chain content; backs the
    /// per-cell `CellLifeAvatar` seed. 66 chars (0x-prefixed).
    pub content_hash: String,
    /// How this cell is guarded (lock-script category). Copied from the
    /// birthing `TxOutputInfo`; `#[serde(default)]` keeps pre-taxonomy
    /// persisted snapshots loadable (→ `LockKind::Other`).
    #[serde(default)]
    pub lock_kind: LockKind,
    /// What this cell holds (asset class). Copied from the birthing
    /// `TxOutputInfo`; `#[serde(default)]` keeps pre-taxonomy snapshots
    /// loadable (→ `AssetKind::Other`).
    #[serde(default)]
    pub asset_kind: AssetKind,
}

/// Transient historical-replay progress. `None` during ordinary live polling.
/// Not persisted (a restart reconciles from the chain).
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct BackfillState {
    pub done: u64,
    pub total: u64,
    /// Missing on snapshots produced before replay causes were exposed.
    #[serde(default)]
    pub phase: ReplayPhase,
}

/// Immutable evidence captured when a transaction link is observed.
///
/// The full [`Cell`] may leave the bounded live projection shortly after it is
/// consumed. This compact anchor keeps only what the causal scene needs to
/// render the real endpoint and identify its maintained content.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CellLinkEndpointAnchor {
    pub id: u64,
    pub pos_seed: [f32; 3],
    pub content_hash: String,
}

impl From<&Cell> for CellLinkEndpointAnchor {
    fn from(cell: &Cell) -> Self {
        Self {
            id: cell.id,
            pos_seed: cell.pos_seed,
            content_hash: cell.content_hash.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CellGalaxySnapshot {
    pub cells: Vec<Cell>,
    pub last_pulse_at_ms: u64,
    /// Recent tx-link history, capped at `RECENT_LINKS_CAP` and pruned
    /// in `gc` once a link's outputs are all dead. Lets the frontend
    /// rebuild the full tx DAG on bootstrap instead of orphaning cells
    /// whose `link` deltas pre-date the WebSocket connection.
    #[serde(default)]
    pub recent_links: Vec<CellLinkRecord>,
    /// Canonical births represented by the current observation history.
    /// Unaffected by `CELL_CAP` evictions and post-death-tail GC; exact reorg
    /// rollback decrements it, while a controlled deep-reorg rebuild resets
    /// and reconstructs it from the configured recent-chain window.
    #[serde(default)]
    pub total_births: u64,
    /// Real chain deaths represented by the current observation history.
    /// `CELL_CAP` evictions are *not* counted — those cells remain alive on
    /// chain and only leave this bounded projection.
    #[serde(default)]
    pub total_deaths: u64,
    /// Historical replay progress; present only while seeding or rebuilding.
    /// Omitted from the wire when `None` so existing snapshot fixtures are
    /// unaffected.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backfill: Option<BackfillState>,
}

/// Persistent record of one tx's causal edge. Carries everything the
/// frontend needs to wire up a tx node (incl. parent tx hashes) so it
/// doesn't have to look up dead input cells (which by then are gone
/// from `cells`).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CellLinkRecord {
    pub tx_hash: String,
    pub block: u64,
    pub from_ids: Vec<u64>,
    pub to_ids: Vec<u64>,
    /// Compact input/output evidence in `from_ids` then `to_ids` order.
    /// Unlike the live Cell set, these anchors survive the death-animation GC.
    pub endpoint_anchors: Vec<CellLinkEndpointAnchor>,
    /// Unique tx_hashes of the input cells' birth txs. Computed at
    /// emission time from the input outpoints, so it survives later
    /// gc of those input cells.
    pub parents: Vec<String>,
    /// See [`Cell::tag`] — opaque emitter-assigned label, propagated from
    /// the producing tx's resolved OT. `#[serde(alias)]` keeps legacy
    /// persisted-state files loadable.
    #[serde(alias = "otp_kind")]
    pub tag: Option<String>,
    pub at_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CellDelta {
    Birth {
        cell: Cell,
    },
    Death {
        id: u64,
        at_ms: u64,
    },
    Tag {
        id: u64,
        tag: String,
    },
    Gc {
        ids: Vec<u64>,
    },
    Pulse {
        at_ms: u64,
    },
    /// Authoritative push of the cumulative on-chain counters. Emitted by
    /// any handler that changes `total_births` / `total_deaths` (real
    /// birth/death events from `handle_tx_landed`, or counter-undo from
    /// `rollback_from`). `CELL_CAP` evictions never emit this.
    Stats {
        total_births: u64,
        total_deaths: u64,
    },
    /// Historical replay progress passthrough. `active` is true while boot,
    /// catch-up, reorg, or rebuild replay is in progress and false on
    /// completion. The SPA shows a cause-specific HUD and the projection
    /// suppresses block pulse deltas while active so replay does not fire one
    /// shockwave per historical block. Tx link deltas still stream so nerves
    /// refill with cells.
    Backfill {
        done: u64,
        total: u64,
        active: bool,
        phase: ReplayPhase,
    },
    /// Canonical invalidation boundary for causal evidence during a reorg.
    /// Consumers must discard every retained or queued link whose block is
    /// greater than or equal to `from_block`. The boundary is emitted even
    /// when this projection's own bounded link history has no matching entry:
    /// a client may retain a different evidence window.
    LinkPrune {
        from_block: u64,
    },
    /// Causal edge for one tx: the input cells (now dead) it consumed
    /// and the output cells (now alive) it produced. Front-end fans
    /// out a "nerve pulse" particle along each (from, to) pair so
    /// users can see the tx propagate through the cell field.
    /// Emitted alongside the matching Death + Birth deltas; consumers
    /// use `endpoint_anchors` for durable evidence geometry and the live
    /// entity cache only for richer inspection/navigation.
    Link {
        tx_hash: String,
        block: u64,
        from_ids: Vec<u64>,
        to_ids: Vec<u64>,
        endpoint_anchors: Vec<CellLinkEndpointAnchor>,
        /// Unique tx_hashes from the input outpoints — same as
        /// `CellLinkRecord.parents`. Lets the frontend construct
        /// parent edges in its tx DAG without having to look up dead
        /// input cells.
        #[serde(default)]
        parents: Vec<String>,
        tag: Option<String>,
        at_ms: u64,
    },
}

/// The cell projection. Owns its state outright; the registry's
/// `RwLock<Self>` makes it safe to mutate from the runtime task while
/// snapshot reads are happening.
pub struct CellGalaxy {
    config: CellGalaxyConfig,
    cells: Vec<Cell>,
    next_id: u64,
    /// Maps `tx_hash#index` (the outpoint we want to spend) to the cell
    /// id that currently represents that UTXO. O(1) death lookup on
    /// input-spend; rebuilt lazily by `gc()` when entries fall out.
    /// Also used by `apply_cell_tagged` to resolve the cell to tag.
    outpoint_index: std::collections::HashMap<OutPoint, u64>,
    /// Bounded block hash journal for detecting canonical replacement at a
    /// height. Its horizon is `config.reorg_window_blocks`.
    block_hashes: std::collections::BTreeMap<u64, String>,
    /// Bounded per-block output journal. Used to remove cells born in
    /// orphaned blocks when the chain poller reports a replacement block.
    block_births: std::collections::BTreeMap<u64, Vec<OutPoint>>,
    /// Bounded per-block input journal. Each entry is the pre-death cell
    /// snapshot so rollback can resurrect UTXOs spent by an orphaned block.
    block_deaths: std::collections::BTreeMap<u64, Vec<Cell>>,
    last_pulse_at_ms: u64,
    /// Tx-link history shipped in snapshots so a fresh frontend can
    /// rebuild the full tx DAG without orphaning cells whose `link`
    /// deltas pre-date the WebSocket connection. Pruned in `gc` once a
    /// link's outputs are all dead; bounded by `RECENT_LINKS_CAP`.
    recent_links: Vec<CellLinkRecord>,
    /// Canonical-window birth/death counters. See [`CellGalaxySnapshot`]
    /// for the semantics; `enforce_cap` deliberately does not touch them.
    total_births: u64,
    total_deaths: u64,
    /// Transient stash of tags that arrived before the corresponding cells
    /// were birthed. Populated by [`Self::apply_cell_tagged`] when the
    /// outpoint isn't yet in `outpoint_index`; drained by
    /// [`Self::handle_tx_landed`] at birth time so the new cell + its
    /// `CellLinkRecord` both carry the tag (this restores per-app pulse
    /// coloring on the SPA, which reads `CellLinkRecord.tag` to pick the
    /// pulse color).
    ///
    /// The common case for the reducer's sync-paired branch is: the
    /// `CellTagged` mutation arrives BEFORE the `TxLanded` mutation in
    /// the same batch (the reducer flips the emit order on sync pair) so
    /// the stash is short-lived. The late-arrival case (`TxLanded` first,
    /// then `OtSettled` later) bypasses the stash entirely — the
    /// post-birth tag is applied in place and emits `CellDelta::Tag`,
    /// but the link record remains `tag: None` (acceptable degradation).
    ///
    /// Bounded upstream by the reducer's 5-min pairing TTL, so even
    /// pathological out-of-order cases stay finite.
    pending_births_tag: std::collections::HashMap<OutPoint, String>,
    /// `Some` while a historical replay is in progress. Gates block pulse
    /// emission (see `handle_block_mined`) and is surfaced in the snapshot
    /// for clients connecting mid-backfill. Tx links still emit during
    /// backfill so the neural fabric refills along with cells.
    backfill: Option<BackfillState>,
}

/// Persisted form of [`CellGalaxy`]. Written under preserved-workdir
/// shutdown, restored on the next boot so the cell field doesn't reset
/// to empty on every restart.
///
/// Forward-compat: pre-PR-A3 workdirs serialized a `pending_tag_window`
/// field here. Serde silently ignores unknown fields on deserialize, so
/// those persisted blobs load cleanly — the late-bind state is dropped
/// (correct: pending tag work from the previous run is no longer
/// meaningful; pairing is now done in the reducer, not the projection).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CellGalaxyPersisted {
    pub cells: Vec<Cell>,
    pub next_id: u64,
    pub outpoint_index: Vec<(OutPoint, u64)>,
    #[serde(default)]
    pub block_hashes: Vec<(u64, String)>,
    #[serde(default)]
    pub block_births: Vec<(u64, Vec<OutPoint>)>,
    #[serde(default)]
    pub block_deaths: Vec<(u64, Vec<Cell>)>,
    pub last_pulse_at_ms: u64,
    #[serde(default)]
    pub recent_links: Vec<CellLinkRecord>,
    #[serde(default)]
    pub total_births: u64,
    #[serde(default)]
    pub total_deaths: u64,
    /// Pre-birth tag stash. Serde-default keeps old workdirs loadable
    /// (pre-fix persisted blobs lack this field; they load as empty).
    #[serde(default)]
    pub pending_births_tag: Vec<(OutPoint, String)>,
}

impl Default for CellGalaxy {
    fn default() -> Self {
        Self::new()
    }
}

impl CellGalaxy {
    pub fn new() -> Self {
        Self::with_config(CellGalaxyConfig::default())
    }

    pub fn with_config(config: CellGalaxyConfig) -> Self {
        Self {
            config,
            cells: Vec::new(),
            next_id: 0,
            outpoint_index: std::collections::HashMap::new(),
            block_hashes: std::collections::BTreeMap::new(),
            block_births: std::collections::BTreeMap::new(),
            block_deaths: std::collections::BTreeMap::new(),
            last_pulse_at_ms: 0,
            recent_links: Vec::new(),
            total_births: 0,
            total_deaths: 0,
            pending_births_tag: std::collections::HashMap::new(),
            backfill: None,
        }
    }

    /// Serialize the projection's state into a persistable form.
    pub fn to_persisted(&self) -> CellGalaxyPersisted {
        CellGalaxyPersisted {
            cells: self.cells.clone(),
            next_id: self.next_id,
            outpoint_index: self
                .outpoint_index
                .iter()
                .map(|(k, v)| (k.clone(), *v))
                .collect(),
            block_hashes: self
                .block_hashes
                .iter()
                .map(|(k, v)| (*k, v.clone()))
                .collect(),
            block_births: self
                .block_births
                .iter()
                .map(|(k, v)| (*k, v.clone()))
                .collect(),
            block_deaths: self
                .block_deaths
                .iter()
                .map(|(k, v)| (*k, v.clone()))
                .collect(),
            last_pulse_at_ms: self.last_pulse_at_ms,
            recent_links: self.recent_links.clone(),
            total_births: self.total_births,
            total_deaths: self.total_deaths,
            pending_births_tag: self
                .pending_births_tag
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
        }
    }

    /// Hydrate from a previously persisted state. Replaces every field.
    pub fn restore_from(&mut self, p: CellGalaxyPersisted) {
        self.cells = p.cells;
        self.next_id = p.next_id;
        self.outpoint_index = p.outpoint_index.into_iter().collect();
        self.block_hashes = p.block_hashes.into_iter().collect();
        self.block_births = p.block_births.into_iter().collect();
        self.block_deaths = p.block_deaths.into_iter().collect();
        self.last_pulse_at_ms = p.last_pulse_at_ms;
        self.recent_links = p.recent_links;
        self.total_births = p.total_births;
        self.total_deaths = p.total_deaths;
        self.pending_births_tag = p.pending_births_tag.into_iter().collect();
        self.prune_reorg_journal();

        // Legacy persistence (pre-counter) lacks the two fields and
        // `#[serde(default)]` falls them to 0. `next_id` survived from old
        // versions and is exactly the cumulative birth counter (monotonic,
        // unaffected by GC / cap eviction). Seed from it so the freshly-
        // migrated projection doesn't report TOTAL=0 while `cells` holds
        // hundreds of inherited entries.
        //
        // Deaths can't be recovered precisely — pre-restart deaths whose
        // tail expired are gone from `cells`, and cap-evicted alive cells
        // were also removed. The defensible derived seed is
        //   deaths = next_id − (cells alive in collection),
        // which matches the projection's own bookkeeping (anything not in
        // the alive subset is treated as dead). Going forward, real
        // `handle_tx_landed` deltas keep counters in sync; this seed only
        // runs on legacy state where both counters arrived as zero.
        if self.total_births == 0 && self.next_id > 0 && !self.cells.is_empty() {
            let alive_now = self
                .cells
                .iter()
                .filter(|c| c.death_at_ms.is_none())
                .count() as u64;
            // alive_now ≤ cells.len() ≤ next_id by construction (every cell
            // was assigned id < next_id at birth), so the subtraction is
            // always non-negative — no defensive guard.
            self.total_births = self.next_id;
            self.total_deaths = self.next_id - alive_now;
        }
    }

    fn enforce_cap(&mut self, at_ms: u64) -> Vec<u64> {
        let alive = self
            .cells
            .iter()
            .filter(|c| c.death_at_ms.is_none())
            .count();
        if alive <= self.config.cell_cap {
            return Vec::new();
        }
        let mut overflow = alive - self.config.cell_cap;
        let mut killed = Vec::new();
        let mut to_remove: Vec<OutPoint> = Vec::new();
        for cell in self.cells.iter_mut() {
            if overflow == 0 {
                break;
            }
            if cell.death_at_ms.is_some() {
                continue;
            }
            if cell.tag.is_some() {
                continue;
            }
            cell.death_at_ms = Some(at_ms);
            to_remove.push(cell.out_point.clone());
            killed.push(cell.id);
            overflow -= 1;
        }
        for op in to_remove {
            self.outpoint_index.remove(&op);
        }
        killed
    }

    /// Keep the rollback journals inside the configured recent-chain window.
    /// All three maps are pruned from the same numeric floor so a retained
    /// block hash never loses the births/deaths needed to undo that block.
    fn prune_reorg_journal(&mut self) {
        let latest = self
            .block_hashes
            .keys()
            .next_back()
            .copied()
            .into_iter()
            .chain(self.block_births.keys().next_back().copied())
            .chain(self.block_deaths.keys().next_back().copied())
            .max();
        let Some(latest) = latest else {
            return;
        };
        let capacity = u64::try_from(self.config.reorg_window_blocks.max(1)).unwrap_or(u64::MAX);
        let retain_from = latest.saturating_sub(capacity.saturating_sub(1));
        self.block_hashes.retain(|height, _| *height >= retain_from);
        self.block_births.retain(|height, _| *height >= retain_from);
        self.block_deaths.retain(|height, _| *height >= retain_from);
    }

    fn reorg_journal_floor(&self) -> Option<u64> {
        self.block_hashes
            .keys()
            .next()
            .copied()
            .into_iter()
            .chain(self.block_births.keys().next().copied())
            .chain(self.block_deaths.keys().next().copied())
            .min()
    }

    /// Establish a fresh bounded canonical observation window after a reorg
    /// deeper than the retained undo journal. `next_id` and the last live
    /// pulse timestamp deliberately survive: IDs must not alias visual work
    /// queued before the reset, and replayed historical blocks must not move
    /// the pulse clock backward.
    fn reset_for_rebuild(&mut self) -> Vec<CellDelta> {
        let ids = self.cells.iter().map(|cell| cell.id).collect::<Vec<_>>();
        self.cells.clear();
        self.outpoint_index.clear();
        self.block_hashes.clear();
        self.block_births.clear();
        self.block_deaths.clear();
        self.recent_links.clear();
        self.pending_births_tag.clear();
        self.total_births = 0;
        self.total_deaths = 0;
        self.backfill = None;

        let mut deltas = vec![CellDelta::LinkPrune { from_block: 0 }];
        if !ids.is_empty() {
            deltas.push(CellDelta::Gc { ids });
        }
        deltas.push(CellDelta::Stats {
            total_births: 0,
            total_deaths: 0,
        });
        deltas
    }

    /// Drop dead cells past the death-animation tail and expired pending
    /// entries. Returns the ids of cells GC'd from the live set so consumers
    /// know to drop them from their local cache.
    fn gc(&mut self, now_ms: u64) -> Vec<u64> {
        let tail = DEATH_DURATION_MS;
        let mut removed_ids = Vec::new();
        let mut removed_outpoints: Vec<OutPoint> = Vec::new();
        self.cells.retain(|c| {
            let keep = match c.death_at_ms {
                None => true,
                Some(at) => now_ms <= at + tail,
            };
            if !keep {
                removed_ids.push(c.id);
                removed_outpoints.push(c.out_point.clone());
            }
            keep
        });
        for op in removed_outpoints {
            if let Some(id) = self.outpoint_index.get(&op) {
                if removed_ids.contains(id) {
                    self.outpoint_index.remove(&op);
                }
            }
        }

        // Prune link records whose outputs are all dead AND whose tx
        // isn't referenced as a parent by any surviving link. The
        // recursive reference check keeps the ancestor chain intact:
        // if descendant link D has parents=[A], we keep A around so
        // D's frontend tx-DAG-build can wire the parent edge correctly.
        if !self.recent_links.is_empty() {
            let alive_ids: std::collections::HashSet<u64> =
                self.cells.iter().map(|c| c.id).collect();
            let mut keep: std::collections::HashSet<String> = self
                .recent_links
                .iter()
                .filter(|link| link.to_ids.iter().any(|id| alive_ids.contains(id)))
                .map(|link| link.tx_hash.clone())
                .collect();
            // Iteratively pull in parents of every kept link until the
            // set stabilises (depth-bounded by chain length).
            loop {
                let mut grew = false;
                for link in &self.recent_links {
                    if keep.contains(&link.tx_hash) {
                        for p in &link.parents {
                            if !keep.contains(p) {
                                keep.insert(p.clone());
                                grew = true;
                            }
                        }
                    }
                }
                if !grew {
                    break;
                }
            }
            self.recent_links
                .retain(|link| keep.contains(&link.tx_hash));
        }

        removed_ids
    }

    fn rollback_from(&mut self, number: u64) -> Vec<CellDelta> {
        if self
            .reorg_journal_floor()
            .is_some_and(|floor| number < floor)
        {
            return self.reset_for_rebuild();
        }

        let heights: Vec<u64> = self
            .block_hashes
            .range(number..)
            .map(|(height, _)| *height)
            .collect();
        if heights.is_empty() {
            self.recent_links.retain(|link| link.block < number);
            return vec![CellDelta::LinkPrune { from_block: number }];
        }

        // The frontend may retain a different evidence window than this
        // bounded backend FIFO, so publish the canonical rollback boundary
        // even when no local link matches it.
        let mut deltas = vec![CellDelta::LinkPrune { from_block: number }];

        // Drop every record at or beyond the replacement boundary. Comparing
        // the boundary directly also protects against an out-of-order record
        // whose height was not present in `block_hashes`.
        self.recent_links.retain(|link| link.block < number);

        let mut counters_touched = false;
        for height in heights.into_iter().rev() {
            let mut gc_ids = Vec::new();
            if let Some(births) = self.block_births.remove(&height) {
                for outpoint in births {
                    self.outpoint_index.remove(&outpoint);
                    if let Some(pos) = self.cells.iter().position(|c| c.out_point == outpoint) {
                        let cell = self.cells.remove(pos);
                        gc_ids.push(cell.id);
                    }
                    // Strict 1:1 with the original `handle_tx_landed` increment:
                    // every recorded birth bumped `total_births` exactly once,
                    // regardless of whether the cell is still in `self.cells`
                    // now (eviction or post-death-tail GC may have removed it).
                    // So decrement per recorded outpoint, not per actually
                    // removed cell, to keep the counter aligned with the
                    // canonical-chain reality after the reorg.
                    self.total_births -= 1;
                    counters_touched = true;
                }
            }
            if !gc_ids.is_empty() {
                deltas.push(CellDelta::Gc { ids: gc_ids });
            }

            if let Some(deaths) = self.block_deaths.remove(&height) {
                for mut cell in deaths.into_iter().rev() {
                    cell.death_at_ms = None;
                    let id = cell.id;
                    // Re-derive pos_seed from id (see snapshot()): the stored death
                    // snapshot froze it at the original birth's helix, so recompute
                    // so a resurrected cell matches the current helix too.
                    cell.pos_seed = helix_seed_for(id);
                    if let Some(pos) = self.cells.iter().position(|c| c.id == id) {
                        self.cells[pos] = cell.clone();
                    } else {
                        self.cells.push(cell.clone());
                    }
                    self.outpoint_index.insert(cell.out_point.clone(), id);
                    deltas.push(CellDelta::Birth { cell });
                    // Mirror image of the birth-rollback above: every recorded
                    // death bumped `total_deaths` exactly once. The
                    // resurrection emits a Birth delta to the frontend (so the
                    // cell reappears) but it is NOT a fresh birth — only the
                    // death is undone, so `total_births` stays put.
                    self.total_deaths -= 1;
                    counters_touched = true;
                }
            }

            self.block_hashes.remove(&height);
        }
        if counters_touched {
            deltas.push(CellDelta::Stats {
                total_births: self.total_births,
                total_deaths: self.total_deaths,
            });
        }

        deltas
    }

    fn handle_block_mined(
        &mut self,
        number: u64,
        hash: &str,
        _tx_count: u32,
        at_ms: u64,
    ) -> Vec<CellDelta> {
        let mut deltas: Vec<CellDelta> = Vec::new();
        if self
            .block_hashes
            .get(&number)
            .is_some_and(|known| known != hash)
        {
            deltas.extend(self.rollback_from(number));
        }
        self.block_hashes.insert(number, hash.to_string());
        self.prune_reorg_journal();

        // Cap enforcement (kill oldest *generic* alive if alive > 5000).
        // Real birth/death is now driven entirely by tx_landed; block_mined
        // just updates the pulse + GCs.
        let cap_killed = self.enforce_cap(at_ms);
        for id in cap_killed {
            deltas.push(CellDelta::Death { id, at_ms });
        }

        // Pulse throttle. Suppressed during backfill so the boot replay
        // doesn't fire a shockwave per replayed block.
        if self.backfill.is_none()
            && at_ms.saturating_sub(self.last_pulse_at_ms) >= PULSE_THROTTLE_MS
        {
            self.last_pulse_at_ms = at_ms;
            deltas.push(CellDelta::Pulse { at_ms });
        }

        // GC dead cells past the death-animation tail.
        let gc_removed = self.gc(at_ms);
        if !gc_removed.is_empty() {
            deltas.push(CellDelta::Gc { ids: gc_removed });
        }

        deltas
    }

    fn handle_tx_landed(
        &mut self,
        tx_hash: &str,
        block: u64,
        at_ms: u64,
        inputs: &[OutPoint],
        outputs: &[TxOutputInfo],
    ) -> Vec<CellDelta> {
        let mut deltas: Vec<CellDelta> = Vec::new();

        // 1. Death pass — for each input, kill the matching cell.
        let mut dead_ids: Vec<u64> = Vec::with_capacity(inputs.len());
        let mut endpoint_anchors: Vec<CellLinkEndpointAnchor> =
            Vec::with_capacity(inputs.len() + outputs.len());
        for inp in inputs {
            if is_cellbase_input(inp) {
                continue;
            }
            let dead_id = self.outpoint_index.remove(inp);
            if let Some(id) = dead_id {
                let mut death_snapshot = None;
                for cell in self.cells.iter_mut() {
                    if cell.id == id && cell.death_at_ms.is_none() {
                        death_snapshot = Some(cell.clone());
                        cell.death_at_ms = Some(at_ms);
                        deltas.push(CellDelta::Death { id, at_ms });
                        self.total_deaths += 1;
                        dead_ids.push(id);
                        break;
                    }
                }
                if let Some(cell) = death_snapshot {
                    endpoint_anchors.push(CellLinkEndpointAnchor::from(&cell));
                    self.block_deaths.entry(block).or_default().push(cell);
                }
            }
        }

        // 2. Birth pass — one cell per output. For each output, check
        //    `pending_births_tag` for a pre-birth tag stashed by an
        //    earlier `apply_cell_tagged` (the reducer emits `CellTagged`
        //    BEFORE `TxLanded` on sync pairing, so the stash is the
        //    common path for tagged cells). The first non-None tag also
        //    becomes the link record's tag, so per-tx pulses regain
        //    their per-app color on the SPA.
        let mut birthed_ids: Vec<u64> = Vec::with_capacity(outputs.len());
        let mut link_tag: Option<String> = None;
        for (i, out) in outputs.iter().enumerate() {
            let id = self.next_id;
            self.next_id += 1;
            let pos_seed = helix_seed_for(id);
            let outpoint = OutPoint {
                tx_hash: tx_hash.to_string(),
                index: i as u32,
            };
            let preset_tag = self.pending_births_tag.remove(&outpoint);
            if link_tag.is_none() {
                if let Some(t) = preset_tag.as_ref() {
                    link_tag = Some(t.clone());
                }
            }
            let cell = Cell {
                id,
                born_at_ms: at_ms,
                death_at_ms: None,
                birth_block: block,
                tag: preset_tag,
                pos_seed,
                out_point: outpoint.clone(),
                capacity: out.capacity,
                data_hex: out.data_hex.clone(),
                content_hash: out.content_hash.clone(),
                lock_kind: out.lock_kind,
                asset_kind: out.asset_kind,
            };
            deltas.push(CellDelta::Birth { cell: cell.clone() });
            self.total_births += 1;
            self.outpoint_index.insert(outpoint, id);
            self.block_births
                .entry(block)
                .or_default()
                .push(cell.out_point.clone());
            endpoint_anchors.push(CellLinkEndpointAnchor::from(&cell));
            self.cells.push(cell);
            birthed_ids.push(id);
        }

        // 3. Tagging is no longer performed here for the general case.
        //    Upstream emitters pair `TxLanded(tx_hash)` with the matching
        //    domain event (in the simulator: `OtSettleChanged → Settled`,
        //    in either order) and emit a `Mutation::CellTagged` once both
        //    halves arrive. That mutation is dispatched to
        //    `apply_cell_tagged` below.
        //
        //    Sync-pair case (the common path): the emitter sends
        //    `CellTagged` BEFORE `TxLanded` in the same batch, so the
        //    `apply_cell_tagged` call stashes the tag in
        //    `pending_births_tag` BEFORE this birth loop runs. The birth
        //    loop above drains the stash and bakes the tag into both
        //    the new `Cell` and (via `link_tag`) the `CellLinkRecord`
        //    below. No separate `CellDelta::Tag` is emitted in this
        //    case — the birth delta carries the tag.
        //
        //    Async case (rare): `TxLanded` arrives before the OT side,
        //    so cells are born `tag: None` and the link record is also
        //    `tag: None`. The later `apply_cell_tagged` then updates
        //    `Cell.tag` in place and emits `CellDelta::Tag`. The link
        //    record's tag remains `None` (acceptable degradation; the
        //    SPA's per-tx pulse color for these txs falls back to
        //    generic amber, which is fine).

        // 4. Link delta + persisted record — one entry per tx with at
        //    least one output. Cellbase emits with empty from_ids /
        //    parents so the frontend tx DAG still gets a node for the
        //    cellbase reward cell. Parents are derived from the input
        //    outpoints (post-cellbase-filter), de-duplicated.
        if !birthed_ids.is_empty() {
            let mut parent_seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
            let mut parents: Vec<String> = Vec::new();
            for inp in inputs {
                if is_cellbase_input(inp) {
                    continue;
                }
                if inp.tx_hash == tx_hash {
                    continue; // self-loop guard (defensive)
                }
                if parent_seen.insert(inp.tx_hash.as_str()) {
                    parents.push(inp.tx_hash.clone());
                }
            }
            // `link_tag` is `Some(tag)` iff at least one output had a
            // pre-birth tag stash (the sync-pair case). All outputs in
            // a single tx share the same app tag, so the first
            // non-None tag is canonical for the link.
            let record = CellLinkRecord {
                tx_hash: tx_hash.to_string(),
                block,
                from_ids: dead_ids.clone(),
                to_ids: birthed_ids.clone(),
                endpoint_anchors: endpoint_anchors.clone(),
                parents: parents.clone(),
                tag: link_tag.clone(),
                at_ms,
            };
            self.recent_links.push(record);
            // Trim FIFO if past the soft cap. The gc sweep usually keeps
            // us well under, this is a safety net for pathological loads.
            if self.recent_links.len() > self.config.recent_links_cap {
                let overflow = self.recent_links.len() - self.config.recent_links_cap;
                self.recent_links.drain(0..overflow);
            }
            deltas.push(CellDelta::Link {
                tx_hash: tx_hash.to_string(),
                block,
                from_ids: dead_ids,
                to_ids: birthed_ids,
                endpoint_anchors,
                parents,
                tag: link_tag,
                at_ms,
            });
        }

        // Counters were touched iff a Birth or Death delta fired in this tx.
        // Emit one consolidated Stats so the frontend's TOTAL / DEAD rows stay
        // in lockstep with the per-cell deltas above — no double-counting on
        // the wire (Birth/Death deltas don't carry totals themselves).
        if deltas
            .iter()
            .any(|d| matches!(d, CellDelta::Birth { .. } | CellDelta::Death { .. }))
        {
            deltas.push(CellDelta::Stats {
                total_births: self.total_births,
                total_deaths: self.total_deaths,
            });
        }

        self.prune_reorg_journal();
        deltas
    }

    /// Tag the cell at `out_point` with `tag`. Resolves the cell id
    /// through `outpoint_index` (the same map used for death lookup).
    /// Idempotent: re-tag with the same value emits no delta.
    ///
    /// Pre-birth case: if the outpoint isn't yet in `outpoint_index`,
    /// stash the tag in `pending_births_tag` so [`Self::handle_tx_landed`]
    /// can bake it into the eventual `Cell` and `CellLinkRecord` at
    /// birth time. This is the sync-pair path the upstream reducer
    /// relies on: it emits `CellTagged` BEFORE `TxLanded` in the same
    /// batch, so the stash lasts only until the matching birth runs in
    /// this batch. The birth bakes the tag into the `Cell.tag` (no
    /// separate `Tag` delta is needed) and into `CellLinkRecord.tag`
    /// (so the SPA's per-tx pulse color is correct).
    ///
    /// Replaces the old "silently drop unknown outpoint" semantics:
    /// silent drops killed `CellLinkRecord.tag` (always None post-A3),
    /// which broke per-app pulse coloring on the SPA.
    fn apply_cell_tagged(&mut self, out_point: &OutPoint, tag: &str) -> Vec<CellDelta> {
        let Some(&id) = self.outpoint_index.get(out_point) else {
            // Pre-birth: stash for `handle_tx_landed` to consume at
            // birth time. Sync-paired `CellTagged` mutations from the
            // reducer arrive immediately before the matching
            // `TxLanded` in the same batch, so the stash is short-lived.
            self.pending_births_tag
                .insert(out_point.clone(), tag.to_string());
            return Vec::new();
        };
        let Some(cell) = self.cells.iter_mut().find(|c| c.id == id) else {
            // Stale index entry — moot.
            return Vec::new();
        };
        if cell.tag.as_deref() == Some(tag) {
            return Vec::new();
        }
        cell.tag = Some(tag.to_string());
        vec![CellDelta::Tag {
            id,
            tag: tag.to_string(),
        }]
    }
}

impl Projection for CellGalaxy {
    type Snapshot = CellGalaxySnapshot;
    type Delta = CellDelta;

    fn name(&self) -> &'static str {
        "cells"
    }

    fn snapshot(&self) -> CellGalaxySnapshot {
        CellGalaxySnapshot {
            // pos_seed is a PURE function of the cell id (helix_seed_for), so
            // recompute it fresh here instead of serving the value frozen at the
            // cell's birth. Without this, a helix change only reshapes cells born
            // AFTER the change — persisted/restored cells keep their old position
            // and the galaxy stays half-old. Recomputing on emit makes a helix
            // tune apply retroactively to every live cell on the next snapshot.
            // Cheap: one PRNG walk per cell, only on (re)connect.
            cells: self
                .cells
                .iter()
                .map(|c| Cell {
                    pos_seed: helix_seed_for(c.id),
                    ..c.clone()
                })
                .collect(),
            last_pulse_at_ms: self.last_pulse_at_ms,
            recent_links: self.recent_links.clone(),
            total_births: self.total_births,
            total_deaths: self.total_deaths,
            backfill: self.backfill,
        }
    }

    fn apply_mutation(&mut self, m: &Mutation) -> Vec<CellDelta> {
        match m {
            Mutation::BlockMined {
                number,
                hash,
                tx_count,
                size: _,
                at,
            } => self.handle_block_mined(*number, hash, *tx_count, *at),
            Mutation::ChainReorganized { from_block } => self.rollback_from(*from_block),
            Mutation::ChainRebuild { .. } => self.reset_for_rebuild(),
            Mutation::TxLanded {
                tx_hash,
                block,
                at,
                inputs,
                outputs,
            } => self.handle_tx_landed(tx_hash, *block, *at, inputs, outputs),
            Mutation::CellTagged { out_point, tag, .. } => self.apply_cell_tagged(out_point, tag),
            Mutation::BackfillProgress {
                done,
                total,
                active,
                phase,
            } => {
                self.backfill = active.then_some(BackfillState {
                    done: *done,
                    total: *total,
                    phase: *phase,
                });
                vec![CellDelta::Backfill {
                    done: *done,
                    total: *total,
                    active: *active,
                    phase: *phase,
                }]
            }
            _ => Vec::new(),
        }
    }

    fn save(&self) -> serde_json::Value {
        serde_json::to_value(self.to_persisted()).unwrap_or(serde_json::Value::Null)
    }

    fn load(&mut self, v: serde_json::Value) -> Result<(), String> {
        let persisted: CellGalaxyPersisted = serde_json::from_value(v)
            .map_err(|e| format!("cell-galaxy persisted-state decode: {e}"))?;
        self.restore_from(persisted);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::outpoint::{CELLBASE_INDEX, CELLBASE_TX_HASH};

    fn make_galaxy() -> CellGalaxy {
        CellGalaxy::new()
    }

    fn op(tx: &str, idx: u32) -> OutPoint {
        OutPoint {
            tx_hash: tx.to_string(),
            index: idx,
        }
    }

    fn out(cap: u64, data: &str) -> TxOutputInfo {
        TxOutputInfo {
            capacity: cap,
            data_hex: data.to_string(),
            // Deterministic synthetic hash per-output for tests. Real chain
            // path computes BLAKE2b in chain_poll; tests only need the
            // field to be present and distinguishable.
            content_hash: format!("0x{:064x}", (cap as u128) ^ data.len() as u128),
            lock_kind: LockKind::Other,
            asset_kind: AssetKind::Other,
        }
    }

    #[test]
    fn backfill_progress_sets_then_clears_state_and_emits_delta() {
        let mut g = make_galaxy();
        // active:true → snapshot reports it, delta emitted.
        let d1 = g.apply_mutation(&Mutation::BackfillProgress {
            done: 25,
            total: 100,
            active: true,
            phase: ReplayPhase::Reorg,
        });
        assert!(
            matches!(
                d1.as_slice(),
                [CellDelta::Backfill {
                    done: 25,
                    total: 100,
                    active: true,
                    phase: ReplayPhase::Reorg
                }]
            ),
            "expected a single active Backfill delta; got {d1:?}"
        );
        assert_eq!(
            g.snapshot().backfill,
            Some(BackfillState {
                done: 25,
                total: 100,
                phase: ReplayPhase::Reorg
            })
        );
        // active:false → snapshot clears.
        let d2 = g.apply_mutation(&Mutation::BackfillProgress {
            done: 100,
            total: 100,
            active: false,
            phase: ReplayPhase::Reorg,
        });
        assert!(matches!(
            d2.as_slice(),
            [CellDelta::Backfill { active: false, .. }]
        ));
        assert_eq!(g.snapshot().backfill, None);
    }

    #[test]
    fn configurable_cell_cap_evicts_above_custom_limit() {
        let mut g = CellGalaxy::with_config(CellGalaxyConfig {
            cell_cap: 2,
            recent_links_cap: DEFAULT_RECENT_LINKS_CAP,
            reorg_window_blocks: DEFAULT_REORG_WINDOW_BLOCKS,
        });
        let births = g.apply_mutation(&Mutation::TxLanded {
            tx_hash: "0xmint".into(),
            block: 1,
            at: 1_000,
            inputs: vec![],
            outputs: vec![out(1, "a"), out(2, "b"), out(3, "c")],
        });
        assert_eq!(
            births
                .iter()
                .filter(|d| matches!(d, CellDelta::Birth { .. }))
                .count(),
            3
        );

        let deltas = g.apply_mutation(&Mutation::BlockMined {
            number: 1,
            hash: "0xblock".into(),
            tx_count: 1,
            size: 0,
            at: 2_000,
        });

        assert_eq!(
            deltas
                .iter()
                .filter(|d| matches!(d, CellDelta::Death { .. }))
                .count(),
            1
        );
        assert_eq!(
            g.snapshot()
                .cells
                .iter()
                .filter(|c| c.death_at_ms.is_none())
                .count(),
            2
        );
    }

    #[test]
    fn configurable_recent_link_cap_trims_fifo() {
        let mut g = CellGalaxy::with_config(CellGalaxyConfig {
            cell_cap: CELL_CAP,
            recent_links_cap: 2,
            reorg_window_blocks: DEFAULT_REORG_WINDOW_BLOCKS,
        });
        for n in 0..3 {
            g.apply_mutation(&Mutation::TxLanded {
                tx_hash: format!("0xtx{n}"),
                block: n + 1,
                at: 1_000 + n,
                inputs: vec![],
                outputs: vec![out(n + 1, "x")],
            });
        }

        let links: Vec<String> = g
            .snapshot()
            .recent_links
            .iter()
            .map(|link| link.tx_hash.clone())
            .collect();
        assert_eq!(links, vec!["0xtx1".to_string(), "0xtx2".to_string()]);
    }

    #[test]
    fn backfill_delta_wire_shape_is_snake_case() {
        let d = CellDelta::Backfill {
            done: 1,
            total: 2,
            active: true,
            phase: ReplayPhase::Rebuild,
        };
        let v = serde_json::to_value(&d).expect("serialize");
        assert_eq!(v["type"], "backfill");
        assert_eq!(v["done"], 1);
        assert_eq!(v["total"], 2);
        assert_eq!(v["active"], true);
        assert_eq!(v["phase"], "rebuild");
    }

    #[test]
    fn legacy_backfill_snapshot_state_defaults_to_boot() {
        let state: BackfillState = serde_json::from_value(serde_json::json!({
            "done": 3,
            "total": 9
        }))
        .expect("deserialize legacy backfill state");
        assert_eq!(state.phase, ReplayPhase::Boot);
    }

    #[test]
    fn link_prune_delta_wire_shape_is_snake_case() {
        let d = CellDelta::LinkPrune { from_block: 42 };
        let v = serde_json::to_value(&d).expect("serialize");
        assert_eq!(v["type"], "link_prune");
        assert_eq!(v["from_block"], 42);
    }

    #[test]
    fn pulse_suppressed_while_backfilling_but_links_and_births_refill() {
        let mut g = make_galaxy();
        g.apply_mutation(&Mutation::BackfillProgress {
            done: 0,
            total: 10,
            active: true,
            phase: ReplayPhase::Boot,
        });

        // A landed tx during backfill: births and causal links both emit so
        // a fresh UI can refill the neural fabric along with the cells.
        let tx = g.handle_tx_landed("0xbf", 1, 1_000, &[], &[out(100, "0x"), out(200, "0x")]);
        assert!(
            tx.iter().any(|d| matches!(d, CellDelta::Birth { .. })),
            "births must still stream during backfill"
        );
        assert!(
            tx.iter().any(|d| matches!(d, CellDelta::Link { .. })),
            "Link deltas must refill nerves during backfill"
        );
        assert_eq!(
            g.recent_links.len(),
            1,
            "recent_links must grow during backfill"
        );
        assert_eq!(
            g.snapshot().recent_links.len(),
            1,
            "snapshot must carry backfilled links"
        );

        // A block during backfill: no Pulse delta.
        let blk = g.handle_block_mined(1, "0xh1", 1, 1_000);
        assert!(
            !blk.iter().any(|d| matches!(d, CellDelta::Pulse { .. })),
            "Pulse deltas must be suppressed during backfill"
        );

        // After backfill ends, pulse + link resume.
        g.apply_mutation(&Mutation::BackfillProgress {
            done: 10,
            total: 10,
            active: false,
            phase: ReplayPhase::Boot,
        });
        let tx2 = g.handle_tx_landed("0xlive", 2, 5_000, &[], &[out(100, "0x")]);
        assert!(
            tx2.iter().any(|d| matches!(d, CellDelta::Link { .. })),
            "Link continues post-backfill"
        );
        let blk2 = g.handle_block_mined(2, "0xh2", 1, 5_000);
        assert!(
            blk2.iter().any(|d| matches!(d, CellDelta::Pulse { .. })),
            "Pulse resumes post-backfill"
        );
    }

    #[test]
    fn tx_landed_births_one_cell_per_output() {
        let mut g = make_galaxy();
        let outputs = vec![out(100, "0x"), out(200, "0xdead"), out(300, "0xbeef")];
        let deltas = g.handle_tx_landed("0xtx1", 1, 1_000, &[], &outputs);
        let births: Vec<&Cell> = deltas
            .iter()
            .filter_map(|d| match d {
                CellDelta::Birth { cell } => Some(cell),
                _ => None,
            })
            .collect();
        assert_eq!(births.len(), 3);
        for (i, c) in births.iter().enumerate() {
            assert_eq!(c.out_point.tx_hash, "0xtx1");
            assert_eq!(c.out_point.index, i as u32);
            assert_eq!(c.capacity, outputs[i].capacity);
            assert_eq!(c.data_hex, outputs[i].data_hex);
            assert_eq!(c.birth_block, 1);
            assert!(c.death_at_ms.is_none());
            assert!(c.tag.is_none());
        }
        assert_eq!(g.outpoint_index.len(), 3);
    }

    #[test]
    fn content_hash_is_propagated_to_birthed_cells() {
        let mut g = make_galaxy();
        let outputs = vec![out(100, "0xdeadbeef"), out(200, "0xcafebabe")];
        let deltas = g.handle_tx_landed("0xtx2", 2, 2_000, &[], &outputs);
        let births: Vec<&Cell> = deltas
            .iter()
            .filter_map(|d| match d {
                CellDelta::Birth { cell } => Some(cell),
                _ => None,
            })
            .collect();
        assert_eq!(births.len(), 2);
        assert_eq!(births[0].content_hash, outputs[0].content_hash);
        assert_eq!(births[1].content_hash, outputs[1].content_hash);
        assert_ne!(births[0].content_hash, births[1].content_hash);
    }

    #[test]
    fn tx_landed_kills_consumed_inputs() {
        let mut g = make_galaxy();
        g.handle_tx_landed("0xa", 1, 1_000, &[], &[out(100, "0x")]);
        let deltas = g.handle_tx_landed("0xb", 2, 2_000, &[op("0xa", 0)], &[out(200, "0x")]);
        let deaths: Vec<u64> = deltas
            .iter()
            .filter_map(|d| match d {
                CellDelta::Death { id, .. } => Some(*id),
                _ => None,
            })
            .collect();
        assert_eq!(deaths, vec![0]);
        let cell0 = g.cells.iter().find(|c| c.id == 0).unwrap();
        assert_eq!(cell0.death_at_ms, Some(2_000));
        assert!(!g.outpoint_index.contains_key(&op("0xa", 0)));
        assert!(g.outpoint_index.contains_key(&op("0xb", 0)));
    }

    #[test]
    fn tx_landed_emits_link_with_ids_and_durable_endpoint_anchors() {
        let mut g = make_galaxy();
        // Seed two parent cells we'll consume.
        g.handle_tx_landed("0xa", 1, 1_000, &[], &[out(100, "0x"), out(200, "0x")]);
        // Now spend both as inputs and produce two outputs.
        let deltas = g.handle_tx_landed(
            "0xb",
            2,
            2_000,
            &[op("0xa", 0), op("0xa", 1)],
            &[out(150, "0x"), out(150, "0x")],
        );
        let link = deltas
            .iter()
            .find_map(|d| match d {
                CellDelta::Link {
                    tx_hash,
                    block,
                    from_ids,
                    to_ids,
                    endpoint_anchors,
                    parents,
                    tag,
                    at_ms,
                } => Some((
                    tx_hash.clone(),
                    *block,
                    from_ids.clone(),
                    to_ids.clone(),
                    endpoint_anchors.clone(),
                    parents.clone(),
                    tag.clone(),
                    *at_ms,
                )),
                _ => None,
            })
            .expect("expected a Link delta");
        assert_eq!(link.0, "0xb");
        assert_eq!(link.1, 2);
        assert_eq!(link.2, vec![0, 1]); // ids of the two consumed cells
        assert_eq!(link.3, vec![2, 3]); // ids of the two birthed cells
        assert_eq!(
            link.4.iter().map(|anchor| anchor.id).collect::<Vec<_>>(),
            vec![0, 1, 2, 3],
        );
        assert_eq!(link.4[0].pos_seed, helix_seed_for(0));
        assert_eq!(link.4[0].content_hash, out(100, "0x").content_hash);
        assert_eq!(link.4[3].pos_seed, helix_seed_for(3));
        assert_eq!(link.4[3].content_hash, out(150, "0x").content_hash);
        assert_eq!(link.5, vec!["0xa".to_string()]); // parent tx hash
        assert!(link.6.is_none());
        assert_eq!(link.7, 2_000);
        // Persisted record was appended too.
        assert_eq!(g.recent_links.len(), 2); // "0xa" + "0xb"
        let last = g.recent_links.last().unwrap();
        assert_eq!(last.tx_hash, "0xb");
        assert_eq!(last.parents, vec!["0xa".to_string()]);
        assert_eq!(last.endpoint_anchors, link.4);

        // Full input Cells disappear after the death-animation tail, while
        // the authoritative transaction evidence remains available.
        g.gc(2_601);
        assert!(g.cells.iter().all(|cell| cell.id >= 2));
        let retained = g.recent_links.last().unwrap();
        assert_eq!(
            retained
                .endpoint_anchors
                .iter()
                .map(|anchor| anchor.id)
                .collect::<Vec<_>>(),
            vec![0, 1, 2, 3],
        );
    }

    #[test]
    fn tx_landed_emits_link_for_cellbase_with_empty_parents() {
        // Cellbase txs now also emit a Link delta — with empty
        // `from_ids` / `parents` — so the frontend tx DAG gets a node
        // for the cellbase reward cell (no orphan synthesis needed).
        let mut g = make_galaxy();
        let cellbase = OutPoint {
            tx_hash: CELLBASE_TX_HASH.to_string(),
            index: CELLBASE_INDEX,
        };
        let deltas = g.handle_tx_landed(
            "0xcoinbase",
            1,
            1_000,
            &[cellbase],
            &[out(1_000_000_000, "0x")],
        );
        let link_count = deltas
            .iter()
            .filter(|d| matches!(d, CellDelta::Link { .. }))
            .count();
        assert_eq!(link_count, 1);
        let link = deltas
            .iter()
            .find_map(|d| match d {
                CellDelta::Link {
                    from_ids,
                    endpoint_anchors,
                    parents,
                    ..
                } => Some((from_ids.clone(), endpoint_anchors.clone(), parents.clone())),
                _ => None,
            })
            .unwrap();
        assert!(link.0.is_empty(), "cellbase has no consumed inputs");
        assert_eq!(
            link.1.iter().map(|anchor| anchor.id).collect::<Vec<_>>(),
            vec![0],
        );
        assert!(link.2.is_empty(), "cellbase has no parent txs");
        assert_eq!(g.recent_links.len(), 1);
    }

    #[test]
    fn cellbase_input_skipped() {
        let mut g = make_galaxy();
        let cellbase = OutPoint {
            tx_hash: CELLBASE_TX_HASH.to_string(),
            index: CELLBASE_INDEX,
        };
        let deltas = g.handle_tx_landed(
            "0xcoinbase",
            1,
            1_000,
            &[cellbase],
            &[out(1_000_000_000, "0x")],
        );
        assert!(deltas.iter().all(|d| !matches!(d, CellDelta::Death { .. })));
        assert_eq!(g.cells.len(), 1);
    }

    #[test]
    fn tx_landed_with_no_pre_birth_tag_emits_no_tag_delta() {
        // The projection is chain-generic: tagging arrives separately
        // via `Mutation::CellTagged`. A bare TxLanded with no
        // pre-birth tag stash produces a birth with `tag = None` and
        // a link record with `tag = None` — this is the late-arrival
        // (async) case where the OT side hasn't settled yet. The
        // reducer will follow up with `CellTagged` later, which
        // `apply_cell_tagged` then surfaces as a `CellDelta::Tag`.
        let mut g = make_galaxy();
        let deltas = g.handle_tx_landed("0xtx_dex", 1, 1_000, &[], &[out(200, "0x")]);
        let tag_count = deltas
            .iter()
            .filter(|d| matches!(d, CellDelta::Tag { .. }))
            .count();
        assert_eq!(
            tag_count, 0,
            "handle_tx_landed must not emit Tag deltas — tagging is via CellTagged",
        );
        assert!(g.cells[0].tag.is_none());
        let link_tag = deltas.iter().find_map(|d| match d {
            CellDelta::Link { tag, .. } => Some(tag.clone()),
            _ => None,
        });
        assert_eq!(
            link_tag,
            Some(None),
            "Link.tag is None when no pre-birth tag stash exists",
        );
    }

    #[test]
    fn cell_tagged_mutation_tags_cell_via_outpoint_index() {
        let mut g = make_galaxy();
        g.handle_tx_landed("0xtx", 1, 1_000, &[], &[out(100, "0x"), out(200, "0x")]);
        // Tag the first output.
        let deltas = g.apply_mutation(&Mutation::CellTagged {
            out_point: op("0xtx", 0),
            tag: "dex".to_string(),
            at: 2_000,
        });
        let tags: Vec<u64> = deltas
            .iter()
            .filter_map(|d| match d {
                CellDelta::Tag { id, .. } => Some(*id),
                _ => None,
            })
            .collect();
        assert_eq!(tags, vec![0], "cell_tagged tags via outpoint index");
        let tagged = g.cells.iter().find(|c| c.id == 0).unwrap();
        assert_eq!(tagged.tag.as_deref(), Some("dex"));
        // The other output stays untagged.
        let other = g.cells.iter().find(|c| c.id == 1).unwrap();
        assert!(other.tag.is_none());
    }

    #[test]
    fn cell_tagged_idempotent_re_tag_is_noop() {
        let mut g = make_galaxy();
        g.handle_tx_landed("0xtx", 1, 1_000, &[], &[out(100, "0x")]);
        let first = g.apply_mutation(&Mutation::CellTagged {
            out_point: op("0xtx", 0),
            tag: "dex".to_string(),
            at: 2_000,
        });
        assert_eq!(first.len(), 1, "first tag emits one delta");
        let second = g.apply_mutation(&Mutation::CellTagged {
            out_point: op("0xtx", 0),
            tag: "dex".to_string(),
            at: 2_001,
        });
        assert!(
            second.is_empty(),
            "re-tag with same value emits no delta; got: {second:?}"
        );
    }

    #[test]
    fn cell_tagged_missing_outpoint_stashes_for_birth() {
        let mut g = make_galaxy();
        // No tx landed; outpoint is unknown → tag is stashed in
        // `pending_births_tag` (no delta yet) so the eventual
        // `handle_tx_landed` can apply it at birth time.
        let deltas = g.apply_mutation(&Mutation::CellTagged {
            out_point: op("0xnope", 0),
            tag: "dex".to_string(),
            at: 1_000,
        });
        assert!(deltas.is_empty(), "pre-birth tag → no delta yet");
        assert_eq!(
            g.pending_births_tag
                .get(&op("0xnope", 0))
                .map(|s| s.as_str()),
            Some("dex"),
            "tag must be stashed for the future birth"
        );
    }

    /// Sync-pair path: `CellTagged` arrives BEFORE `TxLanded` in the
    /// same batch (the reducer's emit order on sync pairing). The
    /// pre-birth tag is stashed in `pending_births_tag`, then the
    /// birth pass drains the stash and bakes the tag into both the
    /// new `Cell` and the `CellLinkRecord`. This restores per-app
    /// pulse coloring on the SPA (which reads `CellLinkRecord.tag`).
    #[test]
    fn cell_tagged_before_tx_landed_paints_cell_and_link_at_birth() {
        let mut g = make_galaxy();
        // CellTagged arrives first — the cell doesn't exist yet, so
        // it gets stashed.
        let pre_deltas = g.apply_mutation(&Mutation::CellTagged {
            out_point: op("0xtx_sync", 0),
            tag: "dex".to_string(),
            at: 990,
        });
        let pre_deltas_2 = g.apply_mutation(&Mutation::CellTagged {
            out_point: op("0xtx_sync", 1),
            tag: "dex".to_string(),
            at: 990,
        });
        assert!(
            pre_deltas.is_empty() && pre_deltas_2.is_empty(),
            "pre-birth CellTagged emits no delta; tag is stashed"
        );
        assert_eq!(g.pending_births_tag.len(), 2, "two pending tags stashed");

        // TxLanded — birth pass drains the stash and tags inline.
        let deltas = g.handle_tx_landed(
            "0xtx_sync",
            1,
            1_000,
            &[],
            &[out(100, "0x"), out(200, "0x")],
        );
        assert!(
            g.pending_births_tag.is_empty(),
            "stash drained at birth time"
        );

        let births: Vec<&Cell> = deltas
            .iter()
            .filter_map(|d| match d {
                CellDelta::Birth { cell } => Some(cell),
                _ => None,
            })
            .collect();
        assert_eq!(births.len(), 2);
        for cell in &births {
            assert_eq!(
                cell.tag.as_deref(),
                Some("dex"),
                "birth cell carries pre-stashed tag"
            );
        }

        // No standalone Tag delta on the sync path — the tag is baked
        // into the Birth delta.
        let tag_count = deltas
            .iter()
            .filter(|d| matches!(d, CellDelta::Tag { .. }))
            .count();
        assert_eq!(
            tag_count, 0,
            "sync-paired tag bakes into Birth, no separate Tag delta"
        );

        // Link delta carries the tag (restored from A3 regression).
        let link_tag = deltas
            .iter()
            .find_map(|d| match d {
                CellDelta::Link { tag, .. } => Some(tag.clone()),
                _ => None,
            })
            .flatten();
        assert_eq!(
            link_tag.as_deref(),
            Some("dex"),
            "CellLinkRecord.tag must be Some on sync-paired path",
        );
        // The persisted link record (used by snapshot/replay) also
        // carries the tag.
        let recorded_tag = g
            .recent_links
            .iter()
            .find(|l| l.tx_hash == "0xtx_sync")
            .and_then(|l| l.tag.clone());
        assert_eq!(recorded_tag.as_deref(), Some("dex"));
    }

    /// Async (late-arrival) path: `TxLanded` arrives BEFORE
    /// `CellTagged`. The cell is born `tag: None` and the link
    /// record stays `tag: None`. When `CellTagged` lands later,
    /// `apply_cell_tagged` updates `Cell.tag` in place and emits
    /// `CellDelta::Tag`, but the link record's tag is NOT
    /// retroactively rewritten (acceptable degradation: per-tx pulse
    /// color falls back to generic amber on the SPA).
    #[test]
    fn cell_tagged_after_tx_landed_tags_cell_but_not_link() {
        let mut g = make_galaxy();
        let deltas = g.handle_tx_landed("0xtx_async", 1, 1_000, &[], &[out(100, "0x")]);
        let link_tag = deltas
            .iter()
            .find_map(|d| match d {
                CellDelta::Link { tag, .. } => Some(tag.clone()),
                _ => None,
            })
            .flatten();
        assert_eq!(link_tag, None, "pre-tag birth has no link tag");
        assert!(g.cells[0].tag.is_none());

        // Late-arrival CellTagged.
        let post_deltas = g.apply_mutation(&Mutation::CellTagged {
            out_point: op("0xtx_async", 0),
            tag: "dex".to_string(),
            at: 2_000,
        });
        let post_tag = post_deltas.iter().find_map(|d| match d {
            CellDelta::Tag { tag, .. } => Some(tag.clone()),
            _ => None,
        });
        assert_eq!(
            post_tag.as_deref(),
            Some("dex"),
            "late-arrival path emits Tag delta"
        );
        assert_eq!(g.cells[0].tag.as_deref(), Some("dex"));

        // Link record stays untagged — late tag does NOT rewrite the
        // historical CellLinkRecord. This is the acceptable
        // degradation noted in the project memory.
        let recorded = g
            .recent_links
            .iter()
            .find(|l| l.tx_hash == "0xtx_async")
            .expect("link record exists");
        assert_eq!(
            recorded.tag, None,
            "late-arrival path leaves CellLinkRecord.tag = None"
        );
    }

    #[test]
    fn save_load_round_trip_preserves_state() {
        let mut g = make_galaxy();
        g.handle_tx_landed("0xa", 1, 1_000, &[], &[out(100, "0x"), out(200, "0xdead")]);
        g.handle_tx_landed(
            "0xb",
            2,
            2_000,
            &[op("0xa", 0)],
            &[out(50, "0x"), out(50, "0xff")],
        );
        let v = g.save();
        let mut g2 = make_galaxy();
        g2.load(v).expect("load should succeed");
        assert_eq!(g2.cells.len(), g.cells.len());
        assert_eq!(g2.next_id, g.next_id);
        assert_eq!(g2.outpoint_index.len(), g.outpoint_index.len());
        assert_eq!(g2.last_pulse_at_ms, g.last_pulse_at_ms);
        assert_eq!(
            g2.recent_links, g.recent_links,
            "causal links and their endpoint evidence must survive persistence"
        );
        // Outpoint index entries match.
        for (op, id) in &g.outpoint_index {
            assert_eq!(g2.outpoint_index.get(op), Some(id));
        }
        // The cell with id 0 should be dead in both.
        let c0_a = g.cells.iter().find(|c| c.id == 0).unwrap();
        let c0_b = g2.cells.iter().find(|c| c.id == 0).unwrap();
        assert_eq!(c0_a.death_at_ms, c0_b.death_at_ms);
    }

    #[test]
    fn reorg_rolls_back_orphaned_births_and_restores_spent_inputs() {
        let mut g = make_galaxy();
        g.handle_block_mined(1, "0xaaa", 1, 1_000);
        g.handle_tx_landed("0xbase", 1, 1_000, &[], &[out(100, "0x")]);
        let base = op("0xbase", 0);
        assert_eq!(g.cells.len(), 1);
        assert!(g.cells[0].death_at_ms.is_none());

        g.handle_block_mined(2, "0xbbb", 1, 1_100);
        g.handle_tx_landed(
            "0xorphan",
            2,
            1_100,
            std::slice::from_ref(&base),
            &[out(200, "0x")],
        );
        assert_eq!(g.cells.len(), 2);
        assert!(g
            .cells
            .iter()
            .any(|c| c.out_point == base && c.death_at_ms.is_some()));
        assert!(g
            .cells
            .iter()
            .any(|c| c.out_point.tx_hash == "0xorphan" && c.death_at_ms.is_none()));

        let deltas = g.handle_block_mined(2, "0xccc", 1, 1_200);
        assert_eq!(g.cells.len(), 1);
        assert_eq!(g.cells[0].out_point, base);
        assert!(g.cells[0].death_at_ms.is_none());
        assert!(g.outpoint_index.contains_key(&base));
        assert!(matches!(
            deltas.first(),
            Some(CellDelta::LinkPrune { from_block: 2 })
        ));
        assert!(
            g.recent_links.iter().all(|link| link.block < 2),
            "orphaned causal evidence must leave the canonical snapshot"
        );
        assert!(deltas
            .iter()
            .any(|d| matches!(d, CellDelta::Gc { ids } if !ids.is_empty())));
        assert!(deltas
            .iter()
            .any(|d| matches!(d, CellDelta::Birth { cell } if cell.out_point == base)));
    }

    #[test]
    fn explicit_chain_reorganized_rolls_back_before_replacement_arrives() {
        let mut g = make_galaxy();
        g.handle_block_mined(1, "0xaaa", 1, 1_000);
        g.handle_tx_landed("0xbase", 1, 1_000, &[], &[out(100, "0x")]);
        g.handle_block_mined(2, "0xbbb", 1, 1_100);
        g.handle_tx_landed("0xorphan", 2, 1_100, &[op("0xbase", 0)], &[out(200, "0x")]);

        let deltas = g.apply_mutation(&Mutation::ChainReorganized { from_block: 2 });

        assert!(matches!(
            deltas.first(),
            Some(CellDelta::LinkPrune { from_block: 2 })
        ));
        assert_eq!(g.cells.len(), 1);
        assert_eq!(g.cells[0].out_point, op("0xbase", 0));
        assert!(g.cells[0].death_at_ms.is_none());
        assert!(!g.block_hashes.contains_key(&2));
    }

    #[test]
    fn reorg_journal_is_bounded_and_oversized_persistence_is_trimmed_on_restore() {
        let mut source = CellGalaxy::with_config(CellGalaxyConfig {
            cell_cap: CELL_CAP,
            recent_links_cap: DEFAULT_RECENT_LINKS_CAP,
            reorg_window_blocks: 10,
        });
        for block in 1..=4 {
            source.handle_block_mined(block, &format!("0xblock{block}"), 1, block * 1_000);
            let inputs = if block == 1 {
                Vec::new()
            } else {
                vec![op(&format!("0xtx{}", block - 1), 0)]
            };
            source.handle_tx_landed(
                &format!("0xtx{block}"),
                block,
                block * 1_000,
                &inputs,
                &[out(100, "0x")],
            );
        }
        assert_eq!(source.block_hashes.len(), 4);

        let mut restored = CellGalaxy::with_config(CellGalaxyConfig {
            cell_cap: CELL_CAP,
            recent_links_cap: DEFAULT_RECENT_LINKS_CAP,
            reorg_window_blocks: 2,
        });
        restored.restore_from(source.to_persisted());

        assert_eq!(
            restored.block_hashes.keys().copied().collect::<Vec<_>>(),
            vec![3, 4]
        );
        assert_eq!(
            restored.block_births.keys().copied().collect::<Vec<_>>(),
            vec![3, 4]
        );
        assert_eq!(
            restored.block_deaths.keys().copied().collect::<Vec<_>>(),
            vec![3, 4]
        );
        let persisted = restored.to_persisted();
        assert_eq!(persisted.block_hashes.len(), 2);
        assert_eq!(persisted.block_births.len(), 2);
        assert_eq!(persisted.block_deaths.len(), 2);
    }

    #[test]
    fn chain_rebuild_clears_unsafe_state_without_reusing_cell_ids() {
        let mut g = CellGalaxy::with_config(CellGalaxyConfig {
            cell_cap: CELL_CAP,
            recent_links_cap: DEFAULT_RECENT_LINKS_CAP,
            reorg_window_blocks: 2,
        });
        g.handle_block_mined(1, "0xblock1", 1, 1_000);
        g.handle_tx_landed("0xtx1", 1, 1_000, &[], &[out(100, "0x")]);
        g.handle_block_mined(2, "0xblock2", 1, 2_000);
        g.handle_tx_landed("0xtx2", 2, 2_000, &[], &[out(100, "0x")]);
        let next_id = g.next_id;

        let deltas = g.apply_mutation(&Mutation::ChainRebuild { from_block: 20 });

        assert!(matches!(
            deltas.first(),
            Some(CellDelta::LinkPrune { from_block: 0 })
        ));
        assert!(deltas
            .iter()
            .any(|delta| matches!(delta, CellDelta::Gc { ids } if ids.len() == 2)));
        assert!(deltas.iter().any(|delta| matches!(
            delta,
            CellDelta::Stats {
                total_births: 0,
                total_deaths: 0
            }
        )));
        assert!(g.cells.is_empty());
        assert!(g.outpoint_index.is_empty());
        assert!(g.block_hashes.is_empty());
        assert!(g.block_births.is_empty());
        assert!(g.block_deaths.is_empty());
        assert!(g.recent_links.is_empty());
        assert_eq!(g.total_births, 0);
        assert_eq!(g.total_deaths, 0);
        assert_eq!(g.next_id, next_id);

        let replay = g.handle_tx_landed("0xcanonical", 20, 20_000, &[], &[out(100, "0x")]);
        assert!(replay
            .iter()
            .any(|delta| matches!(delta, CellDelta::Birth { cell } if cell.id == next_id)));
    }

    #[test]
    fn reorg_below_the_retained_journal_floor_escalates_to_safe_reset() {
        let mut g = CellGalaxy::with_config(CellGalaxyConfig {
            cell_cap: CELL_CAP,
            recent_links_cap: DEFAULT_RECENT_LINKS_CAP,
            reorg_window_blocks: 2,
        });
        for block in 1..=4 {
            g.handle_block_mined(block, &format!("0xblock{block}"), 1, block * 1_000);
            g.handle_tx_landed(
                &format!("0xtx{block}"),
                block,
                block * 1_000,
                &[],
                &[out(100, "0x")],
            );
        }
        assert_eq!(g.reorg_journal_floor(), Some(3));

        let deltas = g.apply_mutation(&Mutation::ChainReorganized { from_block: 2 });

        assert!(matches!(
            deltas.first(),
            Some(CellDelta::LinkPrune { from_block: 0 })
        ));
        assert!(g.cells.is_empty());
        assert!(g.block_hashes.is_empty());
    }

    #[test]
    fn reorg_emits_link_prune_even_when_backend_evidence_fifo_is_empty() {
        let mut g = CellGalaxy::with_config(CellGalaxyConfig {
            cell_cap: CELL_CAP,
            recent_links_cap: 0,
            reorg_window_blocks: DEFAULT_REORG_WINDOW_BLOCKS,
        });
        g.handle_block_mined(1, "0xaaa", 1, 1_000);
        g.handle_tx_landed("0xbase", 1, 1_000, &[], &[out(100, "0x")]);
        g.handle_block_mined(2, "0xbbb", 1, 1_100);
        g.handle_tx_landed("0xorphan", 2, 1_100, &[op("0xbase", 0)], &[out(100, "0x")]);
        assert!(g.recent_links.is_empty());

        let deltas = g.handle_block_mined(2, "0xccc", 1, 1_200);
        assert!(matches!(
            deltas.first(),
            Some(CellDelta::LinkPrune { from_block: 2 })
        ));
    }

    #[test]
    fn load_rejects_garbage_with_error() {
        let mut g = make_galaxy();
        g.handle_tx_landed("0xa", 1, 1_000, &[], &[out(100, "0x")]);
        let res = g.load(serde_json::json!({"not": "the right shape"}));
        assert!(res.is_err());
        // State preserved on rejection.
        assert_eq!(g.cells.len(), 1);
    }

    #[test]
    fn stats_counters_track_chain_births_and_deaths() {
        let mut g = make_galaxy();
        assert_eq!(g.total_births, 0);
        assert_eq!(g.total_deaths, 0);

        // Two outputs → +2 births, 0 deaths.
        let deltas = g.handle_tx_landed("0xtx1", 1, 1_000, &[], &[out(100, "0x"), out(200, "0x")]);
        assert_eq!(g.total_births, 2);
        assert_eq!(g.total_deaths, 0);
        // Stats delta is emitted at most once per tx, after the per-cell deltas.
        let stats_count = deltas
            .iter()
            .filter(|d| matches!(d, CellDelta::Stats { .. }))
            .count();
        assert_eq!(stats_count, 1);
        let last = deltas.last().unwrap();
        assert!(matches!(
            last,
            CellDelta::Stats {
                total_births: 2,
                total_deaths: 0
            }
        ));

        // Spend one of those + emit a third → +1 birth, +1 death.
        g.handle_tx_landed("0xtx2", 2, 1_100, &[op("0xtx1", 0)], &[out(300, "0x")]);
        assert_eq!(g.total_births, 3);
        assert_eq!(g.total_deaths, 1);
    }

    #[test]
    fn stats_skipped_when_tx_only_pulses_or_tags() {
        let mut g = make_galaxy();
        // No inputs, no outputs → no Birth, no Death, no Stats.
        let deltas = g.handle_tx_landed("0xnoop", 1, 1_000, &[], &[]);
        assert!(deltas.iter().all(|d| !matches!(d, CellDelta::Stats { .. })));
        assert_eq!(g.total_births, 0);
        assert_eq!(g.total_deaths, 0);
    }

    #[test]
    fn cap_eviction_does_not_inflate_death_counter() {
        // Exceed CELL_CAP by ~5 and verify the forced-eviction Deaths emitted
        // by `enforce_cap` do NOT touch the chain-death counter. Those cells
        // are still alive on chain — only the projection's in-memory cap is
        // exceeded.
        let mut g = make_galaxy();
        let needed = CELL_CAP + 5;
        // One tx with N outputs is the cheapest way to mint N cells.
        let outs: Vec<_> = (0..needed).map(|_| out(100, "0x")).collect();
        g.handle_tx_landed("0xbulk", 1, 1_000, &[], &outs);
        assert_eq!(g.total_births, needed as u64);
        assert_eq!(g.total_deaths, 0);

        // Fire a block to trigger enforce_cap. It will mark 5 generic cells
        // dead and emit Death deltas, but those must NOT be counted as real
        // chain deaths.
        let deltas = g.handle_block_mined(2, "0xbbb", 1, 1_100);
        let evicted = deltas
            .iter()
            .filter(|d| matches!(d, CellDelta::Death { .. }))
            .count();
        assert!(evicted >= 1, "expected at least one cap-eviction Death");
        assert_eq!(g.total_deaths, 0, "cap evictions must not count as deaths");
        // And no Stats delta should ride along with cap evictions either.
        assert!(deltas.iter().all(|d| !matches!(d, CellDelta::Stats { .. })));
    }

    #[test]
    fn reorg_undoes_counter_increments() {
        let mut g = make_galaxy();
        g.handle_block_mined(1, "0xaaa", 1, 1_000);
        g.handle_tx_landed("0xbase", 1, 1_000, &[], &[out(100, "0x")]);
        let base = op("0xbase", 0);

        g.handle_block_mined(2, "0xbbb", 1, 1_100);
        g.handle_tx_landed(
            "0xorphan",
            2,
            1_100,
            std::slice::from_ref(&base),
            &[out(200, "0x")],
        );
        // 2 births (base + orphan), 1 death (base consumed).
        assert_eq!(g.total_births, 2);
        assert_eq!(g.total_deaths, 1);

        // Reorg replaces block 2: orphan's birth is undone, base's death is
        // undone. Counters return to (1, 0).
        let deltas = g.handle_block_mined(2, "0xccc", 1, 1_200);
        assert_eq!(g.total_births, 1);
        assert_eq!(g.total_deaths, 0);
        assert!(deltas.iter().any(|d| matches!(
            d,
            CellDelta::Stats {
                total_births: 1,
                total_deaths: 0
            }
        )));
    }

    #[test]
    fn restore_from_legacy_state_seeds_counters_from_next_id() {
        // Simulate a persisted state from BEFORE the counter fields existed:
        // both counters default to 0, but `next_id` and `cells` reflect a
        // populated projection (this is what `#[serde(default)]` produces
        // when the on-disk JSON lacks the new fields).
        let alive_a = Cell {
            id: 0,
            born_at_ms: 0,
            death_at_ms: None,
            birth_block: 0,
            tag: None,
            pos_seed: [0.0, 0.0, 0.0],
            out_point: op("0xa", 0),
            capacity: 100,
            data_hex: "0x".to_string(),
            content_hash: format!("0x{:064x}", 0),
            lock_kind: LockKind::Other,
            asset_kind: AssetKind::Other,
        };
        let alive_b = Cell {
            id: 1,
            out_point: op("0xb", 0),
            ..alive_a.clone()
        };
        let dying = Cell {
            id: 2,
            death_at_ms: Some(500),
            out_point: op("0xc", 0),
            ..alive_a.clone()
        };
        let persisted = CellGalaxyPersisted {
            cells: vec![alive_a, alive_b, dying],
            next_id: 100, // 100 births ever, only 3 still in the collection
            outpoint_index: Vec::new(),
            block_hashes: Vec::new(),
            block_births: Vec::new(),
            block_deaths: Vec::new(),
            last_pulse_at_ms: 0,
            recent_links: Vec::new(),
            total_births: 0, // legacy: field absent → defaulted to 0
            total_deaths: 0,
            pending_births_tag: Vec::new(),
        };
        let mut g = make_galaxy();
        g.restore_from(persisted);
        // Seed: total_births = next_id, total_deaths = next_id − alive_in_cells.
        // 2 cells are alive (alive_a, alive_b), 1 is dying.
        assert_eq!(g.total_births, 100);
        assert_eq!(g.total_deaths, 98); // 100 − 2 alive

        // Subsequent persistence round-trips preserve the seeded values
        // (no re-seeding on later loads since counters are now non-zero).
        let p2 = g.to_persisted();
        let mut g2 = make_galaxy();
        g2.restore_from(p2);
        assert_eq!(g2.total_births, 100);
        assert_eq!(g2.total_deaths, 98);
    }

    #[test]
    fn restore_from_empty_state_does_not_seed() {
        // Brand-new persisted state: 0 births, 0 cells, next_id=0. No seed.
        let persisted = CellGalaxyPersisted {
            cells: Vec::new(),
            next_id: 0,
            outpoint_index: Vec::new(),
            block_hashes: Vec::new(),
            block_births: Vec::new(),
            block_deaths: Vec::new(),
            last_pulse_at_ms: 0,
            recent_links: Vec::new(),
            total_births: 0,
            total_deaths: 0,
            pending_births_tag: Vec::new(),
        };
        let mut g = make_galaxy();
        g.restore_from(persisted);
        assert_eq!(g.total_births, 0);
        assert_eq!(g.total_deaths, 0);
    }

    /// Forward-compat: pre-PR-A3 persisted blobs include
    /// `pending_tag_window: [...]`. Serde ignores unknown fields by
    /// default, so deserialization succeeds and the late-bind state is
    /// silently dropped (the new code keeps pairing in the reducer, so
    /// the dropped data is semantically irrelevant). This pins the
    /// invariant: if a future PR adds `#[serde(deny_unknown_fields)]` to
    /// `CellGalaxyPersisted`, the canary fires and old workdirs would
    /// otherwise fail to load.
    #[test]
    fn cell_galaxy_persisted_silently_ignores_legacy_pending_tag_window() {
        let legacy = serde_json::json!({
            "cells": [],
            "next_id": 0,
            "outpoint_index": [],
            "block_hashes": [],
            "block_births": [],
            "block_deaths": [],
            "pending_tag_window": [
                {
                    "tx_hash": "0xstale",
                    "cell_ids": [7, 8, 9],
                    "expires_at_ms": 1_000
                }
            ],
            "last_pulse_at_ms": 0,
            "recent_links": [],
            "total_births": 0,
            "total_deaths": 0
        });
        let parsed: CellGalaxyPersisted = serde_json::from_value(legacy)
            .expect("legacy persisted blob with pending_tag_window must deserialize");
        // The dropped field has no surviving field on the struct, but
        // the rest is preserved.
        assert_eq!(parsed.cells.len(), 0);
        assert_eq!(parsed.next_id, 0);
    }

    /// Persistence forward-compat: workdirs from before the OtpKind→tag
    /// rename have `"otp_kind"` keys in their `<workdir>/persisted-state.json`.
    /// The `#[serde(alias = "otp_kind")]` annotation on `Cell.tag` and
    /// `CellLinkRecord.tag` keeps them loadable. If a future PR removes those
    /// aliases, this test catches the silent regression before old workdirs
    /// fail to populate `tag` on every cell.
    #[test]
    fn cell_deserializes_legacy_otp_kind_field() {
        let legacy_cell = serde_json::json!({
            "id": 1,
            "born_at_ms": 0,
            "death_at_ms": null,
            "birth_block": 0,
            "otp_kind": "dex",
            "pos_seed": [0.0, 0.0, 0.0],
            "out_point": { "tx_hash": "0x", "index": 0 },
            "capacity": 100,
            "data_hex": "0x",
            "content_hash": format!("0x{:064x}", 0),
        });
        let cell: Cell = serde_json::from_value(legacy_cell)
            .expect("legacy cell with otp_kind key must deserialize via #[serde(alias)]");
        assert_eq!(cell.tag.as_deref(), Some("dex"));

        let legacy_link = serde_json::json!({
            "tx_hash": "0x",
            "block": 1,
            "from_ids": [],
            "to_ids": [],
            "endpoint_anchors": [],
            "parents": [],
            "otp_kind": "dex",
            "at_ms": 1000,
        });
        let link: CellLinkRecord = serde_json::from_value(legacy_link)
            .expect("legacy link with otp_kind key must deserialize via #[serde(alias)]");
        assert_eq!(link.tag.as_deref(), Some("dex"));
    }

    #[test]
    fn snapshot_carries_chain_counters() {
        let mut g = make_galaxy();
        g.handle_tx_landed("0xtx", 1, 1_000, &[], &[out(100, "0x"), out(200, "0x")]);
        g.handle_tx_landed("0xtx2", 2, 1_100, &[op("0xtx", 0)], &[]);
        let snap = g.snapshot();
        assert_eq!(snap.total_births, 2);
        assert_eq!(snap.total_deaths, 1);
    }

    #[test]
    fn cell_data_hex_round_trips() {
        let mut g = make_galaxy();
        let big = "0x".to_string() + &"ab".repeat(2048);
        let deltas = g.handle_tx_landed("0xtx", 1, 1_000, &[], &[out(100, &big)]);
        let cell = match &deltas[0] {
            CellDelta::Birth { cell } => cell,
            _ => panic!("expected Birth delta"),
        };
        assert_eq!(cell.data_hex, big);
    }
}
