//! Cell galaxy projection — server-side UTXO mirror.
//!
//! Births and deaths are driven by real chain outpoints carried in
//! `Mutation::TxLanded`: every output spawns a cell (positioned
//! deterministically inside an irregular organic field via
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

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::enrichment::ChainAnchor;
use crate::helix::helix_seed_for;
use crate::mutation::{Mutation, ReplayPhase};
use crate::outpoint::{is_cellbase_input, OutPoint, ShapeSeed, TxOutputInfo};
use crate::projection::cells_stats::{
    aggregate_cell_view_stats, aggregate_script_census, CellViewStats, ObservedScriptsSink,
    ScriptCensus,
};
use crate::projection::composition_policy::CompositionDemandSink;
use crate::projection::display_plane::DisplayPlane;
use crate::projection::Projection;
use crate::{AssetKind, LockKind, ScriptId};

// ── visual / behavior constants ──────────────────────────────────────
// These are calibrated against the client's cell layer
// (`packages/ui/src/geometry/cellPositions.ts`), but only the cap mirrors
// it one-for-one (`INSTANCE_CAPACITY`). The corpse hold below deliberately
// does NOT equal any single client number: it must strictly DOMINATE the
// client's entire death rite, which is a sum of two client constants plus
// an offset the server never sees.
pub const CELL_CAP: usize = 50_000;
pub const DEFAULT_RECENT_LINKS_CAP: usize = 2048;
/// Canonical block journals retained for exact reorg rollback. This stays
/// intentionally smaller than the historical replay window: deeper changes
/// use the projection's controlled rebuild path instead of retaining every
/// boot-time birth/death snapshot indefinitely. The caller may override this
/// chain-generic default when its canonical evidence policy differs.
pub const DEFAULT_REORG_WINDOW_BLOCKS: usize = 48;
const PULSE_THROTTLE_MS: u64 = 800;
/// How long a dead cell is retained past its death timestamp, i.e. how long
/// the browser is guaranteed to still have the corpse it is mourning.
///
/// The client's rite does not begin at the death timestamp: withering starts
/// `BLOCK_HIGHLIGHT_DELAY_S` later (`packages/ui/src/ui/topologyConstants.ts`)
/// and then runs for `DEATH_DURATION_MS`
/// (`packages/ui/src/geometry/cellPositions.ts`), so the corpse is on screen
/// well past death. That sum and this hold are pinned against each other in
/// the shared fixture `tests/fixtures/death_rite.json`: the TS side asserts
/// the sum of the real constants equals `client_rite_ms`, the Rust side
/// (`a_corpse_outlives_the_client_rite_before_it_is_reaped`) asserts this
/// constant equals `corpse_hold_ms` and that the hold dominates the rite. The
/// margin has to stay positive: GC is also the moment the display plane exits
/// the member, so a hold shorter than the rite makes the corpse vanish
/// mid-wither — routinely, not rarely, because `gc_cells` runs on every
/// mined block and fast cadence (testnet, backfill bursts) puts many blocks
/// inside one rite. Whichever client constant moves next, move the fixture
/// and this one too.
///
/// Bounded cost: the retained set carries at most `deaths_per_second × 4.5 s`
/// corpses, so even a chain retiring a thousand cells a second spends 4500 of
/// the 50 000-cell reservoir on them.
const CORPSE_HOLD_MS: u64 = 4_500;

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

/// Positions are computed and stored as `f32` but have always ridden the
/// wire WIDENED to `f64` — an accident of the old snapshot path, which built
/// a `serde_json::Value` first (`Value::from(v as f64)`) before printing it.
/// Delta frames still take that route, so the widening is pinned here
/// explicitly: whichever serializer a frame goes through, one position emits
/// one text. Without it a direct-to-text snapshot prints the shortest `f32`
/// form (`19.188807`) while the delta beside it prints the widened `f64`
/// (`19.188806533813477`) — same position, two JS numbers, and every
/// downstream equality check on the pair starts lying.
fn serialize_pos_seed<S: serde::Serializer>(
    pos_seed: &[f32; 3],
    serializer: S,
) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeTuple;
    let mut tuple = serializer.serialize_tuple(pos_seed.len())?;
    for axis in pos_seed {
        tuple.serialize_element(&(*axis as f64))?;
    }
    tuple.end()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
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
    #[serde(serialize_with = "serialize_pos_seed")]
    pub pos_seed: [f32; 3],
    pub out_point: OutPoint,
    pub capacity: u64,
    pub data_hex: String,
    /// Full output-data length before the display-safe prefix was truncated.
    #[serde(default)]
    pub data_bytes: u32,
    /// CKB-canonical BLAKE2b-256 of the serialized CellOutput + raw data.
    /// Stable identifier for the cell's on-chain content; backs the
    /// per-cell `CellLifeAvatar` seed. 66 chars (0x-prefixed).
    pub content_hash: String,
    /// Independent immutable component fingerprints. They seed renderer-owned
    /// morphology without asking core to interpret scripts or data.
    #[serde(default)]
    pub lock_shape_seed: ShapeSeed,
    #[serde(default)]
    pub type_shape_seed: Option<ShapeSeed>,
    #[serde(default)]
    pub data_shape_seed: ShapeSeed,
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
    /// *Which* lock script guards it. The `_kind` fields above are cknerv's
    /// own coarse classification, which the renderer and the composition
    /// policy read; this is the script's actual identity, which is what the
    /// script census counts and what an index can turn into a name. Unset on
    /// cells restored from state written before it existed, and omitted from
    /// the wire while unset so a pre-identity snapshot stays byte-identical.
    #[serde(default, skip_serializing_if = "ScriptId::is_unset")]
    pub lock_script: ScriptId,
    /// Which type script it carries, or `None` for a plain cell.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_script: Option<ScriptId>,
    /// Fingerprint of the COLLECTION this cell belongs to — the one seed on
    /// the wire that is meant to COLLIDE. The `lock`/`type`/`data` seeds
    /// separate cells; this one gathers them, so a renderer can draw two
    /// Nervapes as family rather than as two strangers who happen to be green.
    ///
    /// `None` wherever the chain does not say: a plain cell, a family that
    /// keeps membership in a registry, or a spore that belongs to no cluster.
    /// Same persisted-compat contract as `asset_kind` above — cells restored
    /// from state written before this field existed load as `None` and learn
    /// their kin the next time a producer reads them. Nothing has to be
    /// migrated: the galaxy composition re-reads every curated cell through
    /// the hydrator at boot, and block-following refreshes the rest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collection_seed: Option<ShapeSeed>,
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
    #[serde(serialize_with = "serialize_pos_seed")]
    pub pos_seed: [f32; 3],
    pub content_hash: String,
    /// False when the anchor was derived from the outpoint alone because the
    /// bounded projection never held that cell: the id and its position are
    /// exact, the content is unknown (`content_hash` is empty) and the id is
    /// absent from `from_ids`. Consumed-evidence surfaces must exclude these.
    /// Records persisted before derived anchors existed were all retained-map
    /// clones, so the serde default is the truth for every one of them.
    #[serde(default = "anchor_resolved_default")]
    pub resolved: bool,
}

/// Old persisted anchors predate identity-only derivation and were all
/// clones of a retained `Cell`.
fn anchor_resolved_default() -> bool {
    true
}

impl From<&Cell> for CellLinkEndpointAnchor {
    fn from(cell: &Cell) -> Self {
        Self {
            id: cell.id,
            // Position is derived identity, not historical evidence. Always
            // resolve it through the current layout contract so a restored
            // legacy Cell cannot freeze a causal anchor in an obsolete shape.
            pos_seed: helix_seed_for(cell.id),
            content_hash: cell.content_hash.clone(),
            resolved: true,
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
    /// Aggregate view statistics over the retained set, computed here so the
    /// client does not have to hold every retained row just to walk it once.
    /// Always covers the FULL retained set, never the emitted subset — the
    /// panel's numbers must not move when the snapshot's scope does.
    #[serde(default)]
    pub stats: CellViewStats,
    /// Historical replay progress; present only while seeding or rebuilding.
    /// Omitted from the wire when `None` so existing snapshot fixtures are
    /// unaffected.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backfill: Option<BackfillState>,
    /// Display-plane membership ("who is on stage"). Presentation policy,
    /// never canonical truth — no counters, no persistence. Omitted from
    /// the wire while `None` (contract-only stage; the server starts
    /// staffing the plane in S1), matching the `backfill` precedent so
    /// older snapshots and fixtures stay readable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display: Option<DisplaySection>,
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

// ── display plane — wire contract ────────────────────────────────────
// The display plane answers "who is on stage": a server-owned membership
// of at most `budget.cells` ids drawn from the canonical retained set
// plus curated residents. INVARIANT: display membership is presentation
// policy, never canonical truth — it moves no counters and is never
// persisted (`CellGalaxyPersisted` carries no display state).

/// Fixed product budgets for the display plane. Server-owned so the
/// composition constants (12K cells / 8K nerve screen budget) can be
/// retuned without a frontend release. Bounds what is staged for
/// rendering — presentation policy, never canonical truth.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct DisplayBudget {
    pub cells: u32,
    pub nerve_edges: u32,
}

/// Which policy currently authors the display-plane membership.
/// `Canonical` fills from the canonical retained set; `Composed` blends
/// a curated reservoir (e.g. ckbadger) with canonical fill. The mode
/// only changes who the server puts on stage — never the wire shape and
/// never canonical truth.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DisplayMode {
    Canonical,
    Composed,
}

/// Where the current display-plane membership came from and how fresh
/// it is. `source` and `as_of` are `None` in canonical mode and
/// serialize as explicit `null` (mirroring the TS `| null` twins, same
/// convention as [`Cell::death_at_ms`]). Presentation provenance only —
/// it asserts nothing about canonical truth.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct DisplayProvenance {
    pub mode: DisplayMode,
    pub source: Option<String>,
    pub as_of: Option<ChainAnchor>,
    pub updated_at_ms: u64,
}

/// Snapshot section describing the display plane. `members` is
/// set-semantics (client slot assignment ignores order; the server keeps
/// a deterministic order for tests/replay) and mixes canonical ids with
/// resident ids; `residents` carries full payloads only for members
/// outside the canonical retained set. Display membership is
/// presentation policy, never canonical truth: it feeds no counters and
/// is excluded from persistence.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct DisplaySection {
    pub budget: DisplayBudget,
    pub members: Vec<u64>,
    pub residents: Vec<Cell>,
    pub provenance: DisplayProvenance,
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
    /// Remove retained cells without a death animation. Emitted by the
    /// death-tail sweep, by `reset_for_rebuild`, and — deferred — for
    /// rolled-back births that never re-appeared on a replacement chain
    /// (`settle_reorg_limbo`). A reorg rollback itself no longer GCs the
    /// orphaned births: their identities are parked and revived in place
    /// when the replacement suffix re-includes the same outpoint, so
    /// survivors never round-trip through removal on the client.
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
    /// Refreshed count of which scripts guard and type the retained set.
    ///
    /// Its own delta rather than a field on `Stats`, because the two have
    /// different cadences and different costs: `Stats` fires per transaction
    /// and carries two integers, while this needs a pass over the retained
    /// set and so runs at most once per block, never during replay, and only
    /// when the distribution actually moved. The client cannot derive it —
    /// the snapshot carries the stage, and this counts the galaxy.
    ScriptCensus {
        census: ScriptCensus,
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
    /// Display-plane membership patch ("who is on stage"). `enter_cells`
    /// carry the full record of every member joining the stage — invariant
    /// I3, *the wire never asks the client to remember*: a snapshot ships
    /// the staged rows and nothing else, so a client's record coverage is
    /// "staged at connect ∪ what the wire has handed it since", never the
    /// server's whole retained map. `exit_ids` leave the stage.
    /// `enter_ids` is the pre-I3 bare-id form — an enter whose record the
    /// client was assumed to already hold. This build never emits one
    /// (`carry_enter_records` converts them all); the field stays on the
    /// wire, and the client's tolerance lane with it, so a stream from an
    /// older server still stages what it names. `provenance` rides along
    /// only when mode/source health changes and is omitted from the wire
    /// when `None`. Display membership is presentation policy, never
    /// canonical truth: this delta moves no counters, persists nothing,
    /// and implies no birth/death semantics.
    Display {
        enter_ids: Vec<u64>,
        enter_cells: Vec<Cell>,
        exit_ids: Vec<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provenance: Option<DisplayProvenance>,
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
    /// Maps a cell id to its slot in `cells`. Purely derived (never
    /// persisted, never on the wire): it replaces the linear `find(|c|
    /// c.id == id)` scans that used to run once per spent input inside
    /// the reducer's global write lock — a 1000-input block against a
    /// 50k reservoir stalled the whole server for hundreds of ms, and
    /// boot hydration replayed every spend, making the whole replay
    /// quadratic.
    ///
    /// `cells` stays a `Vec` because its ORDER is observable: the
    /// columnar snapshot's row order, the JSON snapshot's cell order and
    /// the display plane's insertion-order priorities all read it. So
    /// this index mirrors positions rather than owning the cells, and
    /// every site that compacts or reorders the vec has to put it back in
    /// step — `gc_cells` (retain), `rollback_from` (mid-vec remove),
    /// `reset_for_rebuild` (clear) and `restore_from` (wholesale
    /// replace). Test builds assert the mirror after every mutation; see
    /// [`Self::assert_cell_index_consistent`].
    id_to_slot: std::collections::HashMap<u64, usize>,
    /// Last census put on the wire, so a block that did not move the
    /// distribution ships nothing. Derived state: a restart recomputes it
    /// from the restored cells at the first live block.
    last_script_census: ScriptCensus,
    /// Where the observed script identities are published for the optional
    /// index to name. Absent unless the server installed one.
    observed_scripts: Option<Arc<ObservedScriptsSink>>,
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
    /// Identities parked by a reorg rollback, keyed by the orphaned
    /// outpoint. The replacement chain usually re-includes the same
    /// transactions, so [`Self::handle_tx_landed`] first looks here and
    /// revives the original id (→ same derived position, same birth time)
    /// instead of allocating a fresh one — the client then sees an
    /// in-place upsert, not a phantom death + birth at a new position.
    /// Whatever never re-appears gets the GC that `rollback_from`
    /// deferred, at [`Self::settle_reorg_limbo`] time. Never persisted: a
    /// restart mid-reorg degrades to fresh ids, and reconnecting clients
    /// resnapshot anyway. Bounded by one reorg window's births, same
    /// order as `block_births`.
    reorg_limbo: std::collections::HashMap<OutPoint, Cell>,
    /// Settle watermark for rollbacks that are not followed by a
    /// `ReplayPhase::Reorg` envelope (defensive; the CKB adapter always
    /// envelopes). Holds the pre-rollback tip: once a live block lands
    /// strictly beyond it, every replaced height has replayed and
    /// leftover parked identities retire via the deferred GC.
    limbo_backstop_height: Option<u64>,
    /// `Some` while a historical replay is in progress. Gates block pulse
    /// emission (see `handle_block_mined`) and is surfaced in the snapshot
    /// for clients connecting mid-backfill. Tx links still emit during
    /// backfill so the neural fabric refills along with cells.
    backfill: Option<BackfillState>,
    /// Largest configured live-Cell target for which this reservoir was
    /// completely hydrated. Zero identifies legacy or explicitly bounded
    /// replay state that is not known to satisfy `config.cell_cap`.
    hydrated_cell_target: usize,
    /// Oldest canonical block included by the last complete hydration.
    hydration_floor: Option<u64>,
    /// Display-plane membership ("who is on stage"). Presentation policy
    /// layered on the canonical state above: the handlers report
    /// births/removals/tx-endpoints as they happen and `apply_mutation`
    /// flushes at most one coalesced `CellDelta::Display` per mutation.
    /// Never persisted (invariant I2) — rebuilt by `restore_from`.
    display: DisplayPlane,
}

/// Persisted form of [`CellGalaxy`]. Written at preserved-workdir checkpoints
/// and shutdown, then restored on the next boot so the cell field doesn't
/// reset to empty on every restart.
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
    /// Added compatibly: older state defaults to zero and is automatically
    /// rebuilt when the configured reservoir target is larger.
    #[serde(default)]
    pub hydrated_cell_target: usize,
    #[serde(default)]
    pub hydration_floor: Option<u64>,
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

    /// Publish the display plane's composition shortfall to `sink`, so a
    /// supplier outside the projection can close it. Without this the
    /// plane never computes or publishes demand.
    /// Install the seam the optional index reads to learn which scripts are
    /// worth asking about. Nothing about naming enters this projection.
    pub fn with_observed_scripts_sink(mut self, sink: Arc<ObservedScriptsSink>) -> Self {
        self.observed_scripts = Some(sink);
        self
    }

    /// Aggregate the retained set, publishing the observed identities on the
    /// way past. Snapshots are also where a restored galaxy first announces
    /// what it is holding: a boot that spends minutes in replay emits no
    /// census delta, and the index should not have to wait out the replay to
    /// learn there is anything to name.
    fn view_stats(&self) -> CellViewStats {
        let stats = aggregate_cell_view_stats(&self.cells);
        if let Some(sink) = self.observed_scripts.as_ref() {
            sink.publish(&stats.scripts);
        }
        stats
    }

    pub fn with_composition_demand_sink(mut self, sink: Arc<CompositionDemandSink>) -> Self {
        self.display.set_demand_sink(sink);
        self
    }

    /// Test seam mirroring [`DisplayPlane::with_limits`]: a galaxy whose
    /// stage is smaller than its map. That gap is the ordinary mainnet
    /// shape — 12k staged out of ~50k retained — and reaching it honestly
    /// would mean minting twelve thousand cells per test.
    #[cfg(test)]
    pub(crate) fn with_display_limits(
        budget: DisplayBudget,
        activity_quota: usize,
        tip_window: usize,
    ) -> Self {
        Self {
            display: DisplayPlane::with_limits(budget, activity_quota, tip_window),
            ..Self::new()
        }
    }

    pub fn with_config(config: CellGalaxyConfig) -> Self {
        Self {
            config,
            cells: Vec::new(),
            next_id: 0,
            outpoint_index: std::collections::HashMap::new(),
            id_to_slot: std::collections::HashMap::new(),
            last_script_census: ScriptCensus::default(),
            observed_scripts: None,
            block_hashes: std::collections::BTreeMap::new(),
            block_births: std::collections::BTreeMap::new(),
            block_deaths: std::collections::BTreeMap::new(),
            last_pulse_at_ms: 0,
            recent_links: Vec::new(),
            total_births: 0,
            total_deaths: 0,
            pending_births_tag: std::collections::HashMap::new(),
            reorg_limbo: std::collections::HashMap::new(),
            limbo_backstop_height: None,
            backfill: None,
            hydrated_cell_target: 0,
            hydration_floor: None,
            display: DisplayPlane::new(),
        }
    }

    // ── canonical container primitives ───────────────────────────────
    // Every write to `cells` goes through one of these so `id_to_slot`
    // cannot drift. Nothing here touches iteration order.

    /// Resolve a cell id to its slot. O(1) replacement for the
    /// `iter().position(|c| c.id == id)` / `iter_mut().find(...)` scans.
    ///
    /// The slot is re-verified against the container before it is handed
    /// out: one integer compare turns any index drift into the same
    /// "not found" the scans produced, instead of mutating a bystander
    /// cell. `debug_assert` makes the drift itself loud in dev builds.
    fn slot_of(&self, id: u64) -> Option<usize> {
        let slot = *self.id_to_slot.get(&id)?;
        let holds_it = self.cells.get(slot).is_some_and(|cell| cell.id == id);
        debug_assert!(
            holds_it,
            "id_to_slot[{id}] = {slot} does not hold that cell"
        );
        holds_it.then_some(slot)
    }

    /// Append a cell, keeping the index in step. `or_insert` mirrors the
    /// first-match semantics of the scans this replaces; ids are unique
    /// in the container by construction (a revived identity replaces its
    /// slot in place — see `rollback_from` — rather than duplicating),
    /// so the entry is always vacant on the live path.
    fn push_cell(&mut self, cell: Cell) {
        let slot = self.cells.len();
        self.id_to_slot.entry(cell.id).or_insert(slot);
        self.cells.push(cell);
    }

    /// Remove the cell at `slot`, keeping the index in step. The tail
    /// repair walks exactly the suffix `Vec::remove` already memmoves, so
    /// it stays inside that removal's own cost class. Only `rollback_from`
    /// removes from the middle, and the births it parks are the newest
    /// cells — i.e. the shortest possible suffix.
    fn remove_cell_at(&mut self, slot: usize) -> Cell {
        let cell = self.cells.remove(slot);
        self.id_to_slot.remove(&cell.id);
        for (offset, later) in self.cells[slot..].iter().enumerate() {
            self.id_to_slot.insert(later.id, slot + offset);
        }
        cell
    }

    /// Rebuild the index from scratch. For the retain-style compactions,
    /// where incremental repair would cost more than the pass itself:
    /// O(N) once per block that actually retired something, the same
    /// class as the retain.
    fn reindex_cells(&mut self) {
        self.id_to_slot.clear();
        self.id_to_slot.reserve(self.cells.len());
        for (slot, cell) in self.cells.iter().enumerate() {
            self.id_to_slot.entry(cell.id).or_insert(slot);
        }
    }

    /// Test-only structural invariant: the index mirrors the container
    /// exactly — same cardinality (which also pins id uniqueness) and
    /// every cell indexed at the slot that actually holds it. Asserted
    /// after every mutation in test builds so a new compaction site that
    /// forgets to reindex fails loudly instead of silently killing the
    /// wrong cell.
    #[cfg(test)]
    fn assert_cell_index_consistent(&self) {
        assert_eq!(
            self.id_to_slot.len(),
            self.cells.len(),
            "id_to_slot cardinality drifted from cells"
        );
        for (slot, cell) in self.cells.iter().enumerate() {
            assert_eq!(
                self.id_to_slot.get(&cell.id).copied(),
                Some(slot),
                "cell {} lives at slot {slot} but is not indexed there",
                cell.id
            );
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
            hydrated_cell_target: self.hydrated_cell_target,
            hydration_floor: self.hydration_floor,
        }
    }

    /// Refresh every persisted copy of the pure id→position derivation. Layout
    /// changes are visual migrations, not chain-state migrations: existing
    /// workdirs should adopt them immediately without a schema bump or prune.
    fn refresh_derived_positions(&mut self) {
        for cell in &mut self.cells {
            cell.pos_seed = helix_seed_for(cell.id);
        }
        for deaths in self.block_deaths.values_mut() {
            for cell in deaths {
                cell.pos_seed = helix_seed_for(cell.id);
            }
        }
        for link in &mut self.recent_links {
            for anchor in &mut link.endpoint_anchors {
                anchor.pos_seed = helix_seed_for(anchor.id);
            }
        }
    }

    /// Hydrate from a previously persisted state. Replaces every field.
    pub fn restore_from(&mut self, p: CellGalaxyPersisted) {
        self.cells = p.cells;
        // Wholesale container replacement — the id index is derived, so it
        // is rebuilt here rather than persisted alongside.
        self.reindex_cells();
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
        // Deliberately not persisted: parked reorg identities only matter to
        // clients that watched the rollback live, and none survive a server
        // restart. A restart mid-reorg replays the suffix with fresh ids.
        self.reorg_limbo.clear();
        self.limbo_backstop_height = None;
        self.hydrated_cell_target = p.hydrated_cell_target;
        self.hydration_floor = p.hydration_floor;
        self.refresh_derived_positions();
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

        // Display state is deliberately not persisted: rebuild the resting
        // membership from the restored map (insertion order). No delta —
        // every snapshot served after load() already carries this fill.
        self.display.bootstrap(&self.cells);
    }

    /// The rows a snapshot carries: the retained cells the display plane has
    /// staged. On mainnet that is roughly a quarter of the retained set, and
    /// the renderer never draws the rest.
    ///
    /// Members the map does not hold canonically are staged residents, and
    /// those ride the display section with their own payloads — so the union
    /// a client reconstructs is complete membership either way. Dead rows
    /// that are still staged come along: their death animation is exactly
    /// what the stage is holding them for.
    ///
    /// NOT a knob, on the same reasoning as `cell_cap`. A `galaxy.snapshot_
    /// scope` line in an existing cknerv.toml is silently ignored (serde
    /// tolerates unknown keys). Shipping the full retained set is not a mode
    /// worth keeping alive: nothing on the client reads a row it never
    /// stages, the aggregate statistics segment already carries what the
    /// panel needs about the rest, and one binary always serves the client
    /// embedded in it, so there is no version skew for a scope flag to
    /// bridge. Going back means reverting the commit, not flipping a line.
    fn staged_rows(&self) -> Vec<Cell> {
        self.cells
            .iter()
            .filter(|cell| self.display.is_staged(cell.id))
            .cloned()
            .collect()
    }

    /// Invariant I3, the delta twin of [`Self::staged_rows`]: **every
    /// entering member carries its record**, so the wire never asks a
    /// client to remember a cell it was never sent.
    ///
    /// The plane decides WHO enters; only the projection holds the map, so
    /// attaching WHAT the wire carries for them belongs here. The plane
    /// names canonical enters by id (it keeps no canonical payloads — that
    /// would be a second copy of the map to keep in step with every death
    /// and every tag); this pass swaps each of those ids for the record as
    /// the map holds it *now*, death timestamp included, which is why it
    /// runs after the mutation's canonical handlers rather than inside the
    /// plane.
    ///
    /// The old rule shipped a bare id whenever the map held the cell, on
    /// the premise that the client already had the record. Snapshots
    /// carrying only staged rows killed that premise: a client's coverage
    /// is staged-at-connect ∪ births-since-connect, and every block stages
    /// old cells by id (spent inputs are activity endpoints, evictions
    /// refill from the prefix, composed mode promotes). Those members
    /// landed on a client with no record: unrendered, and their deaths
    /// no-ops — a resting stage that thinned all session and healed only
    /// on resync.
    ///
    /// Cost: one cloned record per enter that used to be bare — ~500 B of
    /// JSON for a plain cell, ~620 B typed, up to ~1.6 KB for one carrying
    /// the data cap. Bounded per mutation by the activity quota, not by the
    /// block: a consolidation sweep staging thousands of spent inputs
    /// evicts all but `DISPLAY_ACTIVITY_QUOTA` of them inside the same
    /// flush, and the touched log coalesces an enter-then-exit away. So the
    /// ceiling is a few hundred KB in one delta of a monstrous block, and
    /// tens of KB in an ordinary one. Snapshots are unchanged.
    fn carry_enter_records(&self, delta: &mut CellDelta) {
        let CellDelta::Display {
            enter_ids,
            enter_cells,
            ..
        } = delta
        else {
            return;
        };
        if enter_ids.is_empty() {
            return;
        }
        enter_cells.reserve(enter_ids.len());
        for id in std::mem::take(enter_ids) {
            match self.slot_of(id) {
                Some(slot) => enter_cells.push(self.cells[slot].clone()),
                // Unreachable by construction: an enter is either a staged
                // resident (payload already in `enter_cells`) or an id the
                // plane's presence mirror took from this map. A mirror that
                // ever drifted would degrade to the pre-I3 wire form here
                // rather than drop a member off the stage.
                None => {
                    debug_assert!(false, "staged member {id} has no record in the map");
                    enter_ids.push(id);
                }
            }
        }
        // The plane emits `enter_cells` sorted by id; keep that after the
        // canonical records join them, so the bytes stay deterministic.
        enter_cells.sort_unstable_by_key(|cell| cell.id);
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
        // The stage empties with the map: every member exits in one
        // coalesced Display delta (flushed by `apply_mutation` alongside
        // the Gc(all) below).
        self.display.note_reset();
        let mut ids = self.cells.iter().map(|cell| cell.id).collect::<Vec<_>>();
        // Parked reorg identities live outside `cells`; retire them with the
        // same reset GC so no client retains a cell this rebuild abandons.
        ids.extend(self.reorg_limbo.drain().map(|(_, cell)| cell.id));
        self.limbo_backstop_height = None;
        self.cells.clear();
        self.id_to_slot.clear();
        self.outpoint_index.clear();
        self.block_hashes.clear();
        self.block_births.clear();
        self.block_deaths.clear();
        self.recent_links.clear();
        self.pending_births_tag.clear();
        self.total_births = 0;
        self.total_deaths = 0;
        self.backfill = None;
        self.hydrated_cell_target = 0;
        self.hydration_floor = None;

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

    /// Drop dead cells whose corpse hold has expired. Returns the ids of Cells
    /// removed from the retained set so consumers can discard their local
    /// records. This is the sole consumer of [`CORPSE_HOLD_MS`], and it serves
    /// the live and the replay/backfill paths alike — one tail, no per-mode
    /// variant.
    fn gc_cells(&mut self, now_ms: u64) -> Vec<u64> {
        let tail = CORPSE_HOLD_MS;
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
        if !removed_ids.is_empty() {
            // The retain compacted the container: every slot from the
            // first removal onward shifted. Rebuild once — a quiet block
            // (nothing retired) pays nothing.
            self.reindex_cells();
        }
        // Membership, asked once. The guard below runs per retired outpoint,
        // and putting a `Vec::contains` there made the sweep quadratic in the
        // size of its own batch — which is exactly the wrong shape for the
        // batch that matters: a replay terminal retires the whole expired
        // reservoir at once, and the corpse hold sizes those batches.
        let removed: std::collections::HashSet<u64> = removed_ids.iter().copied().collect();
        for op in removed_outpoints {
            if let Some(id) = self.outpoint_index.get(&op) {
                if removed.contains(id) {
                    self.outpoint_index.remove(&op);
                }
            }
        }

        removed_ids
    }

    /// Remove causal records that no longer lead to a retained Cell. This is
    /// more expensive than Cell-tail GC because it computes the transitive
    /// parent closure across the retained link graph.
    fn prune_recent_links(&mut self) {
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
    }

    /// Full steady-state GC. Historical replay uses [`Self::gc_cells`] per
    /// block and runs causal-link pruning once at its terminal barrier: the
    /// FIFO cap already bounds replay memory, while recomputing a transitive
    /// closure for every historical block makes large reservoirs quadratic.
    fn gc(&mut self, now_ms: u64) -> Vec<u64> {
        let removed_ids = self.gc_cells(now_ms);
        self.prune_recent_links();
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
            // Even a journal-less rollback invalidates a reservoir anchored
            // at or beyond the boundary (degrade → canonical mode; the
            // flush emits the coalesced transition delta).
            self.display.chain_reorganized(number);
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

        let orphan_tip = *heights.last().expect("checked non-empty above");
        let mut counters_touched = false;
        for height in heights.into_iter().rev() {
            // Unwind each height in LIFO of the order it was applied. An
            // outpoint has to exist before it can be spent, so within one
            // block births land before deaths — and the undo therefore takes
            // that block's DEATHS first. This only shows for an outpoint born
            // AND spent inside the same rolled-back block (routine in DEX and
            // mint batches): undoing its death first finds the corpse row it
            // still occupies and resurrects in place, so the birth pass below
            // parks that single identity. Parking first instead left the
            // resurrection with nothing to update — it appended a second,
            // phantom row (and shipped its Birth) for an identity already
            // sitting in `reorg_limbo`, which the replacement chain's revival
            // then duplicated.
            //
            // Every other height is untouched by the order: its births and
            // deaths name disjoint outpoints, the birth pass emits no deltas
            // of its own, and removals preserve relative order while
            // resurrections append — so the delta stream and the final
            // container sequence are identical either way.
            if let Some(deaths) = self.block_deaths.remove(&height) {
                for mut cell in deaths.into_iter().rev() {
                    cell.death_at_ms = None;
                    let id = cell.id;
                    // Re-derive pos_seed from id (see snapshot()): the stored death
                    // snapshot froze it at the original birth's helix, so recompute
                    // so a resurrected cell matches the current helix too.
                    cell.pos_seed = helix_seed_for(id);
                    // In-place at the same slot when the corpse is still
                    // retained (keeps ids unique in the container and the
                    // index untouched); otherwise a fresh append.
                    if let Some(pos) = self.slot_of(id) {
                        self.cells[pos] = cell.clone();
                    } else {
                        self.push_cell(cell.clone());
                    }
                    self.outpoint_index.insert(cell.out_point.clone(), id);
                    // Resurrections re-enter the map; note_birth is
                    // idempotent for the in-place-update case above.
                    self.display.note_birth(&cell);
                    deltas.push(CellDelta::Birth { cell });
                    // Mirror image of the birth-rollback below: every recorded
                    // death bumped `total_deaths` exactly once. The
                    // resurrection emits a Birth delta to the frontend (so the
                    // cell reappears) but it is NOT a fresh birth — only the
                    // death is undone, so `total_births` stays put.
                    self.total_deaths -= 1;
                    counters_touched = true;
                }
            }

            if let Some(births) = self.block_births.remove(&height) {
                for outpoint in births {
                    // `outpoint_index` is the fast path but is NOT
                    // authoritative for retention: `enforce_cap` drops an
                    // outpoint the moment the cell stops being spendable,
                    // while the cell itself stays in the container for its
                    // corpse hold. A birth being rolled back may already be
                    // in that state, so an index miss falls back to the scan
                    // rather than skipping the park. (An outpoint is
                    // created once on any real chain, so the container
                    // holds at most one cell per outpoint and the two
                    // paths resolve the same slot.) A spend from this same
                    // block already handed the outpoint back to the index in
                    // the death pass above, so that case keeps the O(1)
                    // path instead of paying a container scan per mint.
                    let indexed_slot = self
                        .outpoint_index
                        .remove(&outpoint)
                        .and_then(|id| self.slot_of(id))
                        .filter(|slot| self.cells[*slot].out_point == outpoint);
                    let found = indexed_slot
                        .or_else(|| self.cells.iter().position(|c| c.out_point == outpoint));
                    if let Some(pos) = found {
                        // Park the identity instead of emitting a GC. The
                        // replacement chain usually re-includes the same tx
                        // (same outpoint ⇒ same content — the tx hash covers
                        // outputs and data), and the client can only keep the
                        // cell alive in place if it never saw a removal.
                        // Survivors are matched by outpoint in
                        // `handle_tx_landed`; the rest get this deferred GC
                        // at `settle_reorg_limbo` time.
                        let cell = self.remove_cell_at(pos);
                        // Parking is a SILENT removal on the canonical
                        // delta stream (no Gc — the client keeps the cell
                        // alive in place awaiting revival), but the plane
                        // must mirror the map: a staged member exits now
                        // and re-enters through the ordinary birth/
                        // endpoint paths if the replacement suffix
                        // revives it.
                        self.display.note_removed(cell.id);
                        self.reorg_limbo.insert(outpoint, cell);
                    }
                    // Strict 1:1 with the original `handle_tx_landed` increment:
                    // every recorded birth bumped `total_births` exactly once,
                    // regardless of whether the cell is still in `self.cells`
                    // now (eviction or post-death-tail GC may have removed it).
                    // So decrement per recorded outpoint, not per actually
                    // removed cell, to keep the counter aligned with the
                    // canonical-chain reality after the reorg. Parked cells
                    // decrement too: their revival in `handle_tx_landed`
                    // re-increments, so a survivor nets zero.
                    self.total_births -= 1;
                    counters_touched = true;
                }
            }

            self.block_hashes.remove(&height);
        }

        // Arm the envelope-less settle backstop (see `handle_block_mined`).
        // `max` keeps the widest horizon when a second rollback lands while
        // an earlier limbo is still waiting for its replacement suffix.
        if !self.reorg_limbo.is_empty() {
            self.limbo_backstop_height = Some(
                self.limbo_backstop_height
                    .map_or(orphan_tip, |w| w.max(orphan_tip)),
            );
        }

        // Composed-mode degrade (covers the explicit `ChainReorganized`
        // mutation AND the implicit hash-mismatch rollback): a boundary at
        // or below the reservoir anchor drops the reservoir and rebuilds
        // canonical prefix membership from the rolled-back map. Ordered
        // AFTER the park/resurrect passes above so the plane rebuilds from
        // the post-rollback presence mirror; the reorg exits and the mode
        // transition coalesce into the mutation's single Display delta.
        self.display.chain_reorganized(number);

        if counters_touched {
            deltas.push(CellDelta::Stats {
                total_births: self.total_births,
                total_deaths: self.total_deaths,
            });
        }

        deltas
    }

    /// Retire every parked reorg identity whose outpoint never re-appeared
    /// on the replacement chain. Survivors were consumed by
    /// [`Self::handle_tx_landed`]; whatever is still parked once the
    /// replacement suffix has replayed is genuinely absent from the
    /// canonical chain and gets the GC that `rollback_from` deferred.
    fn settle_reorg_limbo(&mut self) -> Option<CellDelta> {
        self.limbo_backstop_height = None;
        if self.reorg_limbo.is_empty() {
            return None;
        }
        let ids = self.reorg_limbo.drain().map(|(_, cell)| cell.id).collect();
        Some(CellDelta::Gc { ids })
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

        // Envelope-less settle backstop (defensive: the CKB adapter always
        // wraps a reorg replay in a `ReplayPhase::Reorg` envelope, which
        // settles at its terminal instead — enveloped replays skip this via
        // the `backfill` gate). A live block strictly beyond the pre-rollback
        // tip means every replaced height has already replayed its txs
        // (per-block mutation order is BlockMined first, then that block's
        // TxLanded), so anything still parked either never re-appeared or
        // moved beyond the old tip — both retire the parked identity.
        if self.backfill.is_none()
            && self
                .limbo_backstop_height
                .is_some_and(|watermark| number > watermark)
        {
            deltas.extend(self.settle_reorg_limbo());
        }

        // A Cell alive at an intermediate historical prefix may still be
        // spent later in the same ordered replay. Enforcing the cap here can
        // evict an older output that survives at the final tip, then leave the
        // reservoir under-filled after the temporary output is spent. Defer
        // cap enforcement until the terminal replay marker; ordinary live
        // blocks keep the existing death-tail animation.
        if self.backfill.is_none() {
            let cap_killed = self.enforce_cap(at_ms);
            for id in cap_killed {
                deltas.push(CellDelta::Death { id, at_ms });
            }
        }

        // Pulse throttle. Suppressed during backfill so the boot replay
        // doesn't fire a shockwave per replayed block.
        if self.backfill.is_none()
            && at_ms.saturating_sub(self.last_pulse_at_ms) >= PULSE_THROTTLE_MS
        {
            self.last_pulse_at_ms = at_ms;
            deltas.push(CellDelta::Pulse { at_ms });
        }

        // Script census, on the same "live block, not replay" gate as the
        // pulse. Emitted only when the distribution actually moved: births
        // and deaths mostly land inside families that are already on the
        // list, so a quiet block ships nothing.
        if self.backfill.is_none() {
            let census = aggregate_script_census(&self.cells);
            if census != self.last_script_census {
                if let Some(sink) = self.observed_scripts.as_ref() {
                    sink.publish(&census);
                }
                self.last_script_census = census.clone();
                deltas.push(CellDelta::ScriptCensus { census });
            }
        }

        // GC dead cells past [`CORPSE_HOLD_MS`]. This is the moment a staged
        // corpse's display window closes: the plane exits it and backfills
        // the resting vacancy at flush time — which is why the hold has to
        // outlast the client's whole death rite, not just its fade.
        let gc_removed = if self.backfill.is_some() {
            self.gc_cells(at_ms)
        } else {
            self.gc(at_ms)
        };
        if !gc_removed.is_empty() {
            for id in &gc_removed {
                self.display.note_removed(*id);
            }
            deltas.push(CellDelta::Gc { ids: gc_removed });
        }

        #[cfg(test)]
        self.assert_cell_index_consistent();
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
            let Some(id) = self.outpoint_index.remove(inp) else {
                // Nothing canonical here — usually a spend of a cell
                // outside the retained window. It is also the only signal
                // that a staged display resident (an outpoint the map
                // deliberately does not hold) just died, so the plane
                // gets a look before we move on.
                let rid = self.display.note_input_unresolved(inp);
                // The cell is gone but its address is not: the disk is the
                // universal address space of cell identities, so a spend we
                // never retained still names an exact place to depart from.
                // A retired resident's probed id wins over the derivation —
                // that is where it rendered. Identity only: no content, and
                // deliberately absent from `from_ids` / `dead_ids` (which
                // mean resolved deaths) and from `note_activity` (a derived
                // id is not a stageable cell).
                let anchor_id = rid.unwrap_or_else(|| {
                    crate::identity::composition_id_for_outpoint(&inp.tx_hash, inp.index)
                });
                endpoint_anchors.push(CellLinkEndpointAnchor {
                    id: anchor_id,
                    pos_seed: helix_seed_for(anchor_id),
                    content_hash: String::new(),
                    resolved: false,
                });
                continue;
            };
            // O(1) through `id_to_slot`. This ran as a full container scan
            // per spent input under the reducer's global write lock: a
            // busy block against a full reservoir stalled every reader for
            // hundreds of ms, and boot hydration replays every spend.
            let mut death_snapshot = None;
            if let Some(slot) = self.slot_of(id) {
                let cell = &mut self.cells[slot];
                if cell.death_at_ms.is_none() {
                    death_snapshot = Some(cell.clone());
                    cell.death_at_ms = Some(at_ms);
                    deltas.push(CellDelta::Death { id, at_ms });
                    self.total_deaths += 1;
                    dead_ids.push(id);
                }
            }
            if let Some(cell) = death_snapshot {
                endpoint_anchors.push(CellLinkEndpointAnchor::from(&cell));
                self.block_deaths.entry(block).or_default().push(cell);
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
            let outpoint = OutPoint {
                tx_hash: tx_hash.to_string(),
                index: i as u32,
            };
            // Reorg-survivor revival: a replacement-chain replay that
            // re-creates an outpoint parked by `rollback_from` keeps the
            // original id (→ same helix position) and birth time, so the
            // re-emitted Birth is an in-place upsert — byte-identical when
            // the tx kept its height — instead of a phantom death + birth
            // pair. Same tx_hash implies same output content on a real
            // chain (the hash covers outputs and data); the field guard is
            // a fail-open defense against synthetic sources. Steady-state
            // cost is the `is_empty` check: the limbo only fills during a
            // reorg window.
            let parked = if self.reorg_limbo.is_empty() {
                None
            } else {
                match self.reorg_limbo.remove(&outpoint) {
                    Some(prev)
                        if prev.capacity == out.capacity
                            && prev.content_hash == out.content_hash
                            && prev.lock_kind == out.lock_kind
                            && prev.asset_kind == out.asset_kind =>
                    {
                        Some(prev)
                    }
                    Some(prev) => {
                        // Content mismatch at a reused outpoint: retire the
                        // parked identity now and fall through to a fresh
                        // allocation.
                        deltas.push(CellDelta::Gc { ids: vec![prev.id] });
                        None
                    }
                    None => None,
                }
            };
            let (id, born_at_ms, parked_tag) = match parked {
                Some(prev) => (prev.id, prev.born_at_ms, prev.tag),
                None => {
                    let id = self.next_id;
                    self.next_id += 1;
                    (id, at_ms, None)
                }
            };
            let pos_seed = helix_seed_for(id);
            let preset_tag = self.pending_births_tag.remove(&outpoint).or(parked_tag);
            if link_tag.is_none() {
                if let Some(t) = preset_tag.as_ref() {
                    link_tag = Some(t.clone());
                }
            }
            let cell = Cell {
                id,
                born_at_ms,
                death_at_ms: None,
                birth_block: block,
                tag: preset_tag,
                pos_seed,
                out_point: outpoint.clone(),
                capacity: out.capacity,
                data_hex: out.data_hex.clone(),
                data_bytes: out.data_bytes,
                content_hash: out.content_hash.clone(),
                lock_shape_seed: out.lock_shape_seed,
                type_shape_seed: out.type_shape_seed,
                data_shape_seed: out.data_shape_seed,
                lock_kind: out.lock_kind,
                asset_kind: out.asset_kind,
                lock_script: out.lock_script,
                type_script: out.type_script,
                collection_seed: out.collection_seed,
            };
            deltas.push(CellDelta::Birth { cell: cell.clone() });
            self.total_births += 1;
            self.outpoint_index.insert(outpoint, id);
            self.block_births
                .entry(block)
                .or_default()
                .push(cell.out_point.clone());
            endpoint_anchors.push(CellLinkEndpointAnchor::from(&cell));
            self.display.note_birth(&cell);
            self.push_cell(cell);
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
            // Display-plane activity hook (D3): the resolved endpoint
            // ids of this tx — exactly what rides the Link delta below —
            // enter the stage progressively if not already on it.
            self.display.note_activity(
                block,
                dead_ids.iter().copied().chain(birthed_ids.iter().copied()),
            );
            // The client tells an input anchor from an output anchor by
            // `!to_ids.contains(id)`, which only holds because the three id
            // families never overlap: outputs are projection-sequential
            // (`next_id`, < 2^52), derived and resident ids carry the
            // composition prefix (>= 2^52), and a resolved input id is never
            // re-born in the same tx (a tx cannot spend its own output;
            // reorg revival keys on the outpoint). Assert the partition here
            // so a future id allocator cannot break the rule silently.
            debug_assert!(
                endpoint_anchors.iter().all(|anchor| {
                    dead_ids.contains(&anchor.id)
                        || birthed_ids.contains(&anchor.id)
                        || anchor.id >= crate::identity::COMPOSITION_ID_PREFIX
                }),
                "an endpoint anchor escaped the id families the client discriminates on"
            );
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
        #[cfg(test)]
        self.assert_cell_index_consistent();
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
        // O(1) through `id_to_slot`, same reason as the death pass.
        let Some(slot) = self.slot_of(id) else {
            // Stale index entry — moot.
            return Vec::new();
        };
        let cell = &mut self.cells[slot];
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

/// The mutation-carried event clock, when the variant has one. The
/// display plane uses this (never a wall clock) for its provenance
/// timestamp; variants without a clock fall back to the plane's last
/// seen value — still deterministic, still mutation-derived.
fn mutation_at_ms(m: &Mutation) -> Option<u64> {
    match m {
        Mutation::BlockMined { at, .. }
        | Mutation::TxLanded { at, .. }
        | Mutation::CellTagged { at, .. } => Some(*at),
        Mutation::GalaxyReservoirReplaced { record } => Some(record.updated_at_ms),
        Mutation::GalaxyReservoirToppedUp { top_up } => Some(top_up.updated_at_ms),
        _ => None,
    }
}

impl Projection for CellGalaxy {
    type Snapshot = CellGalaxySnapshot;
    type Delta = CellDelta;

    fn name(&self) -> &'static str {
        "cells"
    }

    fn snapshot_bin(&self) -> Option<Vec<u8>> {
        let rows = self.staged_rows();
        // Straight from projection state: the columnar form reads only
        // numeric columns, so routing it through `snapshot()` would clone
        // every Cell (three heap strings apiece), every staged resident
        // payload and every recent link just to drop them one call later.
        Some(crate::projection::cells_columnar::encode_cells_columnar(
            &rows,
            crate::projection::cells_columnar::CellsColumnarHeader {
                last_pulse_at_ms: self.last_pulse_at_ms,
                total_births: self.total_births,
                total_deaths: self.total_deaths,
            },
            Some(&self.display.columnar_view()),
            crate::projection::cells_columnar::CellsColumnarTail {
                recent_links: &self.recent_links,
                backfill: self.backfill,
                stats: self.view_stats(),
            },
        ))
    }

    fn snapshot(&self) -> CellGalaxySnapshot {
        CellGalaxySnapshot {
            // `pos_seed` is served as stored, not recomputed. It is a pure
            // function of the id and every path that can hold a stale one
            // already refreshes it: births derive it (`handle_tx_landed`),
            // and a restore rewrites every persisted copy
            // (`refresh_derived_positions`) — which is the only way an old
            // layout can reach a new binary, since changing the helix means
            // changing the binary. Recomputing here instead cost a
            // rejection-sampling walk per row on every snapshot, ~59k of
            // them per connect on mainnet, to arrive at the value already
            // sitting in the field. `emitted_positions_are_the_derived_ones`
            // keeps the claim honest.
            cells: self.staged_rows(),
            last_pulse_at_ms: self.last_pulse_at_ms,
            recent_links: self.recent_links.clone(),
            total_births: self.total_births,
            total_deaths: self.total_deaths,
            stats: self.view_stats(),
            backfill: self.backfill,
            display: Some(self.display.section()),
        }
    }

    fn apply_mutation(&mut self, m: &Mutation) -> Vec<CellDelta> {
        let mut deltas = match m {
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
                let was_active = self.backfill.is_some();
                self.backfill = active.then_some(BackfillState {
                    done: *done,
                    total: *total,
                    phase: *phase,
                });
                // Display plane goes silent for the replay (activity
                // suppressed, deltas coalesced) and resettles once at the
                // terminal — the flush below this match emits the single
                // coalesced Display delta.
                if *active {
                    if !was_active {
                        self.display.backfill_started();
                    }
                } else if was_active {
                    self.display.backfill_ended();
                }
                let mut deltas = vec![CellDelta::Backfill {
                    done: *done,
                    total: *total,
                    active: *active,
                    phase: *phase,
                }];
                if !active && was_active {
                    // A replay envelope that closed with full coverage is
                    // the canonical settle point for parked reorg
                    // identities: the whole replacement suffix has replayed,
                    // so whatever is still parked never re-appeared. An
                    // incomplete close (hard error mid-replay, done < total)
                    // keeps the limbo for the retry cycle that reopens the
                    // envelope; the `handle_block_mined` backstop still
                    // bounds its lifetime.
                    if *done == *total {
                        deltas.extend(self.settle_reorg_limbo());
                    }
                    let at_ms = self
                        .cells
                        .iter()
                        .map(|cell| cell.death_at_ms.unwrap_or(cell.born_at_ms))
                        .max()
                        .unwrap_or(0);
                    deltas.extend(
                        self.enforce_cap(at_ms)
                            .into_iter()
                            .map(|id| CellDelta::Death { id, at_ms }),
                    );
                    self.prune_recent_links();
                }
                deltas
            }
            Mutation::CellHydrationCompleted {
                target, from_block, ..
            } => {
                self.hydrated_cell_target = usize::try_from(*target).unwrap_or(usize::MAX);
                self.hydration_floor = Some(*from_block);
                Vec::new()
            }
            Mutation::GalaxyReservoirReplaced { record } => {
                // D6 arrival: the node-hydrated reservoir (trust fence
                // closed upstream) reaches ONLY the display plane —
                // never the cells map, counters, or persistence
                // (invariant I2). The canonical outpoint index + the
                // insertion-order container act as the D5 resolver at
                // this call boundary; the flush below emits the one
                // coalesced `refresh_transition` Display delta.
                self.display
                    .reservoir_replaced(record, &self.outpoint_index, &self.cells);
                Vec::new()
            }
            Mutation::GalaxyReservoirToppedUp { top_up } => {
                // Same D6 fence, additive: cells found for the classes
                // the plane published a shortfall for. Membership only —
                // the cells map, the counters and persistence are as
                // untouched here as they are on a refresh.
                self.display
                    .reservoir_topped_up(top_up, &self.outpoint_index);
                Vec::new()
            }
            _ => Vec::new(),
        };
        // Single display-plane settle point: at most ONE coalesced
        // `CellDelta::Display` per mutation, appended after the canonical
        // deltas so every enter carries the record as this mutation leaves
        // it — a spend staged as an activity endpoint rides out already
        // holding its own death timestamp (invariant I3).
        if let Some(mut display_delta) = self.display.flush(mutation_at_ms(m)) {
            self.carry_enter_records(&mut display_delta);
            deltas.push(display_delta);
        }
        // Every container-touching path funnels through here (the direct
        // `handle_*` entry points tests use assert for themselves), so any
        // compaction that forgets to reindex fails on the next mutation.
        #[cfg(test)]
        self.assert_cell_index_consistent();
        deltas
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
    use crate::enrichment::GalaxyCompositionRecord;
    use crate::outpoint::{CELLBASE_INDEX, CELLBASE_TX_HASH};
    use crate::projection::composition_policy::CompositionDemand;

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
            data_bytes: data.strip_prefix("0x").unwrap_or(data).len() as u32 / 2,
            // Deterministic synthetic hash per-output for tests. Real chain
            // path computes BLAKE2b in chain_poll; tests only need the
            // field to be present and distinguishable.
            content_hash: format!("0x{:064x}", (cap as u128) ^ data.len() as u128),
            lock_shape_seed: [cap as u32, 1],
            type_shape_seed: None,
            data_shape_seed: [data.len() as u32, 2],
            lock_kind: LockKind::Other,
            asset_kind: AssetKind::Other,
            lock_script: Default::default(),
            type_script: None,
            collection_seed: None,
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
    fn script_census_rides_blocks_and_only_when_the_distribution_moves() {
        fn census_of(deltas: &[CellDelta]) -> Option<&ScriptCensus> {
            deltas.iter().find_map(|d| match d {
                CellDelta::ScriptCensus { census } => Some(census),
                _ => None,
            })
        }
        fn block(g: &mut CellGalaxy, number: u64, at: u64) -> Vec<CellDelta> {
            g.apply_mutation(&Mutation::BlockMined {
                number,
                hash: format!("0xblock{number}"),
                tx_count: 1,
                size: 0,
                at,
            })
        }

        let joyid = crate::ScriptId {
            code_hash: [0xaa; 32],
            hash_type: crate::HashType::Type,
        };
        let mut g = CellGalaxy::new();
        let mut output = out(1, "a");
        output.lock_script = joyid;
        g.apply_mutation(&Mutation::TxLanded {
            tx_hash: "0xtx".into(),
            block: 1,
            at: 1_000,
            inputs: vec![],
            outputs: vec![output],
        });

        // Landing a transaction does not pay for a census — that pass is on
        // the block, not on every tx.
        let first = block(&mut g, 1, 2_000);
        let census = census_of(&first).expect("first live block publishes the census");
        assert_eq!(census.locks.len(), 1);
        assert_eq!(census.locks[0].script, joyid);
        assert_eq!(census.locks[0].count, 1);

        // A block that leaves the distribution alone ships nothing.
        assert!(census_of(&block(&mut g, 2, 3_000)).is_none());
    }

    #[test]
    fn script_census_stays_quiet_through_replay() {
        let mut g = CellGalaxy::new();
        g.apply_mutation(&Mutation::BackfillProgress {
            done: 1,
            total: 10,
            active: true,
            phase: ReplayPhase::Boot,
        });
        let mut output = out(1, "a");
        output.lock_script = crate::ScriptId {
            code_hash: [0xbb; 32],
            hash_type: crate::HashType::Type,
        };
        g.apply_mutation(&Mutation::TxLanded {
            tx_hash: "0xtx".into(),
            block: 1,
            at: 1_000,
            inputs: vec![],
            outputs: vec![output],
        });
        let deltas = g.apply_mutation(&Mutation::BlockMined {
            number: 1,
            hash: "0xblock".into(),
            tx_count: 1,
            size: 0,
            at: 2_000,
        });
        // Boot replays thousands of blocks; a full pass per replayed block is
        // exactly the cost the live-block gate exists to avoid.
        assert!(deltas
            .iter()
            .all(|d| !matches!(d, CellDelta::ScriptCensus { .. })));
        // The snapshot still carries it, so a client connecting mid-replay is
        // not left without one.
        assert_eq!(g.snapshot().stats.scripts.locks.len(), 1);
    }

    #[test]
    fn replay_defers_cap_so_final_live_survivors_fill_the_target() {
        let mut g = CellGalaxy::with_config(CellGalaxyConfig {
            cell_cap: 2,
            recent_links_cap: DEFAULT_RECENT_LINKS_CAP,
            reorg_window_blocks: DEFAULT_REORG_WINDOW_BLOCKS,
        });
        g.apply_mutation(&Mutation::BackfillProgress {
            done: 0,
            total: 3,
            active: true,
            phase: ReplayPhase::Boot,
        });

        g.apply_mutation(&Mutation::BlockMined {
            number: 1,
            hash: "0xb1".into(),
            tx_count: 1,
            size: 0,
            at: 1_000,
        });
        g.apply_mutation(&Mutation::TxLanded {
            tx_hash: "0xmint".into(),
            block: 1,
            at: 1_000,
            inputs: vec![],
            outputs: vec![out(1, "a"), out(2, "b")],
        });
        g.apply_mutation(&Mutation::BlockMined {
            number: 2,
            hash: "0xb2".into(),
            tx_count: 1,
            size: 0,
            at: 1_100,
        });
        g.apply_mutation(&Mutation::TxLanded {
            tx_hash: "0xsurvivor".into(),
            block: 2,
            at: 1_100,
            inputs: vec![],
            outputs: vec![out(3, "c")],
        });

        // At this prefix three Cells are alive. The next block spends mint#1;
        // enforcing the cap before that transaction would wrongly evict the
        // older mint#0 survivor and leave only one final live Cell.
        let block = g.apply_mutation(&Mutation::BlockMined {
            number: 3,
            hash: "0xb3".into(),
            tx_count: 1,
            size: 0,
            at: 1_200,
        });
        assert!(!block
            .iter()
            .any(|delta| matches!(delta, CellDelta::Death { .. })));
        g.apply_mutation(&Mutation::TxLanded {
            tx_hash: "0xspend".into(),
            block: 3,
            at: 1_200,
            inputs: vec![op("0xmint", 1)],
            outputs: vec![],
        });
        g.apply_mutation(&Mutation::BackfillProgress {
            done: 3,
            total: 3,
            active: false,
            phase: ReplayPhase::Boot,
        });

        let alive: Vec<OutPoint> = g
            .snapshot()
            .cells
            .into_iter()
            .filter(|cell| cell.death_at_ms.is_none())
            .map(|cell| cell.out_point)
            .collect();
        assert_eq!(alive, vec![op("0xmint", 0), op("0xsurvivor", 0)]);
    }

    #[test]
    fn replay_defers_expensive_link_pruning_until_the_terminal_barrier() {
        let mut g = make_galaxy();
        g.apply_mutation(&Mutation::BackfillProgress {
            done: 0,
            total: 3,
            active: true,
            phase: ReplayPhase::Boot,
        });
        g.apply_mutation(&Mutation::BlockMined {
            number: 1,
            hash: "0xb1".into(),
            tx_count: 1,
            size: 0,
            at: 1_000,
        });
        g.apply_mutation(&Mutation::TxLanded {
            tx_hash: "0xobsolete".into(),
            block: 1,
            at: 1_000,
            inputs: vec![],
            outputs: vec![out(1, "a")],
        });
        g.apply_mutation(&Mutation::TxLanded {
            tx_hash: "0xspend".into(),
            block: 2,
            at: 2_000,
            inputs: vec![op("0xobsolete", 0)],
            outputs: vec![],
        });
        // Past the corpse hold — replay shares the live tail exactly, so the
        // sweep must have run here even inside the backfill envelope.
        g.apply_mutation(&Mutation::BlockMined {
            number: 3,
            hash: "0xb3".into(),
            tx_count: 0,
            size: 0,
            at: 2_000 + CORPSE_HOLD_MS + 1,
        });

        assert!(g.cells.is_empty(), "Cell-tail GC still runs during replay");
        assert_eq!(g.recent_links.len(), 1, "link closure is deferred");

        g.apply_mutation(&Mutation::BackfillProgress {
            done: 3,
            total: 3,
            active: false,
            phase: ReplayPhase::Boot,
        });
        assert!(g.recent_links.is_empty());
    }

    #[test]
    fn hydration_completion_metadata_persists_and_rebuild_resets_it() {
        let mut g = make_galaxy();
        g.apply_mutation(&Mutation::CellHydrationCompleted {
            target: 10_000,
            available: 10_017,
            from_block: 42,
            at_tip: 99,
        });
        let persisted = g.to_persisted();
        assert_eq!(persisted.hydrated_cell_target, 10_000);
        assert_eq!(persisted.hydration_floor, Some(42));

        let mut restored = make_galaxy();
        restored.restore_from(persisted);
        assert_eq!(restored.hydrated_cell_target, 10_000);
        assert_eq!(restored.hydration_floor, Some(42));

        restored.apply_mutation(&Mutation::ChainRebuild { from_block: 80 });
        assert_eq!(restored.hydrated_cell_target, 0);
        assert_eq!(restored.hydration_floor, None);
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
    fn content_and_component_shape_inputs_are_propagated_to_birthed_cells() {
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
        for (birth, output) in births.iter().zip(&outputs) {
            assert_eq!(birth.data_bytes, output.data_bytes);
            assert_eq!(birth.lock_shape_seed, output.lock_shape_seed);
            assert_eq!(birth.type_shape_seed, output.type_shape_seed);
            assert_eq!(birth.data_shape_seed, output.data_shape_seed);
        }
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

    /// The two halves of the death contract, as pinned in
    /// `tests/fixtures/death_rite.json`. `client_rite_ms` is the sum the SPA
    /// actually spends mourning a corpse — `BLOCK_HIGHLIGHT_DELAY_S × 1000 +
    /// DEATH_DURATION_MS` — asserted against the real exported constants by
    /// `packages/ui/__tests__/geometry/deathRiteFixture.test.ts`.
    /// `corpse_hold_ms` is [`CORPSE_HOLD_MS`], asserted below. Whichever side
    /// a retune touches, exactly one of the two tests fails and names this
    /// fixture.
    #[derive(serde::Deserialize)]
    struct DeathRiteFixture {
        client_rite_ms: u64,
        corpse_hold_ms: u64,
    }

    fn death_rite_fixture() -> DeathRiteFixture {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/death_rite.json"
        );
        let raw = std::fs::read_to_string(path).expect("read tests/fixtures/death_rite.json");
        serde_json::from_str(&raw).expect("parse tests/fixtures/death_rite.json")
    }

    /// The client's death rite ends at death + `client_rite_ms` (delivery
    /// choreography, then a withering). The corpse hold has to outlast it with
    /// margin to spare, on the live path and on the replay path alike — the
    /// two share `gc_cells`, there is no per-mode tail. Both numbers live in
    /// `tests/fixtures/death_rite.json`; this test owns the Rust half of it.
    #[test]
    fn a_corpse_outlives_the_client_rite_before_it_is_reaped() {
        let rite = death_rite_fixture();
        assert_eq!(
            CORPSE_HOLD_MS, rite.corpse_hold_ms,
            "CORPSE_HOLD_MS drifted from tests/fixtures/death_rite.json"
        );
        assert!(
            rite.corpse_hold_ms > rite.client_rite_ms,
            "the hold ({} ms) must outlast the client rite ({} ms) — a corpse \
             reaped mid-rite vanishes while the browser is still withering it",
            rite.corpse_hold_ms,
            rite.client_rite_ms
        );

        let mut g = make_galaxy();
        g.handle_tx_landed("0xa", 1, 1_000, &[], &[out(100, "0x")]);
        g.handle_tx_landed("0xb", 2, 2_000, &[op("0xa", 0)], &[]);
        let death_at = g
            .cells
            .iter()
            .find(|c| c.id == 0)
            .and_then(|c| c.death_at_ms)
            .expect("the consumed cell is dead");
        assert_eq!(death_at, 2_000);

        // The last frame the client draws for this corpse is still inside the
        // hold, with room to spare.
        g.gc(death_at + rite.client_rite_ms);
        assert!(
            g.cells.iter().any(|c| c.id == 0),
            "the corpse must survive its own withering"
        );

        // Still 100 ms shy of the hold, i.e. 250 ms after the last frame the
        // client draws for this corpse.
        g.gc(death_at + CORPSE_HOLD_MS - 100);
        assert!(
            g.cells.iter().any(|c| c.id == 0),
            "the corpse must survive its own withering"
        );
        assert!(
            !g.outpoint_index.contains_key(&op("0xa", 0)),
            "held for the visual only — the outpoint stopped being spendable at death"
        );

        // 100 ms past the hold: reaped, and its id is reported so clients
        // drop their local record.
        let removed = g.gc(death_at + CORPSE_HOLD_MS + 100);
        assert_eq!(removed, vec![0]);
        assert!(g.cells.iter().all(|c| c.id != 0));
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
        assert!(
            link.4.iter().all(|anchor| anchor.resolved),
            "every endpoint here came from a retained cell"
        );
        assert_eq!(link.5, vec!["0xa".to_string()]); // parent tx hash
        assert!(link.6.is_none());
        assert_eq!(link.7, 2_000);
        // Persisted record was appended too.
        assert_eq!(g.recent_links.len(), 2); // "0xa" + "0xb"
        let last = g.recent_links.last().unwrap();
        assert_eq!(last.tx_hash, "0xb");
        assert_eq!(last.parents, vec!["0xa".to_string()]);
        assert_eq!(last.endpoint_anchors, link.4);

        // Full input Cells disappear once the corpse hold expires, while
        // the authoritative transaction evidence remains available.
        g.gc(2_000 + CORPSE_HOLD_MS + 1);
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

    /// Every anchor written before derived ones existed was a clone of a
    /// retained `Cell`, so the missing key means resolved — no schema bump,
    /// and a restored workdir keeps telling the truth about its history.
    #[test]
    fn an_anchor_persisted_without_the_field_loads_as_resolved() {
        let legacy = serde_json::json!({
            "id": 7,
            "pos_seed": [1.0, 2.0, 3.0],
            "content_hash": "0xabc",
        });
        let anchor: CellLinkEndpointAnchor =
            serde_json::from_value(legacy).expect("legacy anchor deserializes");
        assert!(anchor.resolved);
    }

    /// The link's anchors, in death-pass-then-birth-pass order.
    fn link_anchors(deltas: &[CellDelta]) -> Vec<CellLinkEndpointAnchor> {
        deltas
            .iter()
            .find_map(|d| match d {
                CellDelta::Link {
                    endpoint_anchors, ..
                } => Some(endpoint_anchors.clone()),
                _ => None,
            })
            .expect("expected a Link delta")
    }

    /// The mainnet-common spend: an input this bounded projection never
    /// held. It still names an exact address on the disk, so the link
    /// carries an identity-only anchor for it — while `from_ids` (resolved
    /// deaths) stays empty.
    #[test]
    fn an_unresolved_input_is_anchored_by_its_outpoint() {
        let mut g = make_galaxy();
        let cold = op("0xcold", 3);
        let deltas = g.handle_tx_landed(
            "0xb",
            2,
            2_000,
            std::slice::from_ref(&cold),
            &[out(150, "0x")],
        );
        let anchors = link_anchors(&deltas);

        let derived = crate::identity::composition_id_for_outpoint(&cold.tx_hash, cold.index);
        assert_eq!(
            anchors.iter().map(|a| a.id).collect::<Vec<_>>(),
            vec![derived, 0],
            "the input anchor precedes the output one"
        );
        assert!(!anchors[0].resolved);
        assert_eq!(anchors[0].pos_seed, helix_seed_for(derived));
        assert!(
            anchors[0].content_hash.is_empty(),
            "a derived anchor proves identity, never content"
        );
        assert!(anchors[1].resolved, "the birthed output is a real cell");

        // Decision 5: derived ids are not deaths and not cells.
        let from_ids = deltas
            .iter()
            .find_map(|d| match d {
                CellDelta::Link { from_ids, .. } => Some(from_ids.clone()),
                _ => None,
            })
            .expect("expected a Link delta");
        assert!(from_ids.is_empty(), "nothing canonical died here");
        assert_eq!(g.total_deaths, 0);
        assert!(g.cells.iter().all(|cell| cell.id != derived));

        // …and the display plane's activity hook never sees one: a derived
        // id is not a stageable cell, so it must not reach the stage even
        // once the pending activity drains at flush.
        g.apply_mutation(&mined(2, "0xblock2", 2_100));
        let members = g.snapshot().display.expect("display section").members;
        assert!(!members.contains(&derived));
    }

    /// Probe divergence: a staged resident's id was allocated against the
    /// admitted set, so it can differ from the outpoint's own derivation.
    /// The anchor takes the resident's id — that is where the cell actually
    /// rendered — and the retirement is unchanged.
    #[test]
    fn a_spent_resident_is_anchored_where_it_rendered() {
        // Real residents are allocated by probing the admitted set, so their
        // ids always carry the composition prefix; the test ids follow suit
        // or the id-family assertion in the link constructor is meaningless.
        let rid = crate::identity::COMPOSITION_ID_PREFIX + 900;
        let mut g = make_galaxy();
        g.apply_mutation(&landed("0xa", 1, 1_000, vec![], vec![out(1, "0x")]));
        g.apply_mutation(&reservoir(1, (rid, rid + 1, rid + 2)));
        g.apply_mutation(&mined(1, "0xblock1", 1_100));
        let staged = g.snapshot().display.expect("display section");
        assert!(
            staged.members.contains(&rid),
            "the dao resident is on stage"
        );

        // `reservoir_record` gives a resident the outpoint `0xr<id>:0`,
        // which the canonical index deliberately does not hold.
        let spent = op(&format!("0xr{rid}"), 0);
        let deltas = g.handle_tx_landed(
            "0xb",
            2,
            2_000,
            std::slice::from_ref(&spent),
            &[out(150, "0x")],
        );
        let anchors = link_anchors(&deltas);
        assert_eq!(anchors[0].id, rid);
        assert!(!anchors[0].resolved);
        assert_eq!(anchors[0].pos_seed, helix_seed_for(rid));
        assert_ne!(
            anchors[0].id,
            crate::identity::composition_id_for_outpoint(&spent.tx_hash, spent.index),
            "the resident's own id wins over the derivation"
        );

        // Retirement is exactly what it was before the anchor existed.
        g.apply_mutation(&mined(2, "0xblock2", 2_100));
        let after = g.snapshot().display.expect("display section");
        assert!(!after.members.contains(&rid));
        assert!(after.residents.iter().all(|cell| cell.id != rid));
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
        // Only the reward output. The cellbase sentinel is not a spend, so
        // it earns no identity anchor either — this is the one honest
        // no-origin case.
        assert_eq!(
            link.1.iter().map(|anchor| anchor.id).collect::<Vec<_>>(),
            vec![0],
        );
        assert!(link.1[0].resolved);
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
        // Mint through apply_mutation so the display plane settles with
        // the birth mutation itself; the CellTagged deltas below then
        // carry Tag alone, as on the real wire path.
        g.apply_mutation(&Mutation::TxLanded {
            tx_hash: "0xtx".into(),
            block: 1,
            at: 1_000,
            inputs: vec![],
            outputs: vec![out(100, "0x")],
        });
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
    fn restore_refreshes_every_persisted_copy_of_derived_position() {
        let mut source = make_galaxy();
        source.handle_tx_landed("0xa", 1, 1_000, &[], &[out(100, "0x"), out(200, "0xdead")]);
        source.handle_tx_landed("0xb", 2, 2_000, &[op("0xa", 0)], &[out(50, "0xff")]);

        let stale = [999.0, -999.0, 777.0];
        let mut persisted = source.to_persisted();
        for cell in &mut persisted.cells {
            cell.pos_seed = stale;
        }
        for (_, deaths) in &mut persisted.block_deaths {
            for cell in deaths {
                cell.pos_seed = stale;
            }
        }
        for link in &mut persisted.recent_links {
            for anchor in &mut link.endpoint_anchors {
                anchor.pos_seed = stale;
            }
        }

        let mut restored = make_galaxy();
        restored.restore_from(persisted);

        for cell in &restored.cells {
            assert_eq!(cell.pos_seed, helix_seed_for(cell.id));
        }
        for deaths in restored.block_deaths.values() {
            for cell in deaths {
                assert_eq!(cell.pos_seed, helix_seed_for(cell.id));
            }
        }
        for link in &restored.recent_links {
            for anchor in &link.endpoint_anchors {
                assert_eq!(anchor.pos_seed, helix_seed_for(anchor.id));
            }
        }

        // What emission does with a position is no longer part of this
        // test: it serves what is stored, and the restore above is what
        // makes stored current. Re-deriving on the way out instead cost a
        // rejection-sampling walk per row — 100ms per snapshot at mainnet
        // size, which was the entire remaining cost of the columnar path —
        // to defend against an in-memory corruption no code path performs.
        // `emitted_positions_are_the_derived_ones` walks the paths that do
        // exist and requires the wire to agree with the derivation.
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
        // The orphaned birth is parked, not GC'd: the replacement suffix
        // usually re-includes the same tx, and the deferred GC only fires
        // for outpoints that never re-appear (`settle_reorg_limbo`).
        assert!(
            !deltas.iter().any(|d| matches!(d, CellDelta::Gc { .. })),
            "rollback must defer the orphan-birth GC; got {deltas:?}"
        );
        assert!(g.reorg_limbo.contains_key(&op("0xorphan", 0)));
        assert_eq!(g.limbo_backstop_height, Some(2));
        assert!(deltas
            .iter()
            .any(|d| matches!(d, CellDelta::Birth { cell } if cell.out_point == base)));
    }

    /// Apply a block that mints an outpoint and spends it in the same block —
    /// the routine DEX/mint-batch shape — and hand back the minted outpoint
    /// plus its identity. Height 2, hash `0xbbb`, on top of a `0xbase` cell
    /// at height 1.
    fn galaxy_with_a_same_block_mint_and_burn() -> (CellGalaxy, OutPoint, u64) {
        let mut g = make_galaxy();
        g.handle_block_mined(1, "0xaaa", 1, 1_000);
        g.handle_tx_landed("0xbase", 1, 1_000, &[], &[out(100, "0x")]);

        g.handle_block_mined(2, "0xbbb", 2, 2_000);
        g.handle_tx_landed("0xmint", 2, 2_000, &[], &[out(200, "0xdd")]);
        let minted = op("0xmint", 0);
        let minted_id = g.outpoint_index[&minted];
        g.handle_tx_landed(
            "0xburn",
            2,
            2_050,
            std::slice::from_ref(&minted),
            &[out(150, "0xee")],
        );
        assert!(
            g.cells
                .iter()
                .any(|c| c.id == minted_id && c.death_at_ms.is_some()),
            "the mint is a corpse in its own block before the rollback"
        );
        (g, minted, minted_id)
    }

    #[test]
    fn a_cell_born_and_spent_in_one_rolled_back_block_parks_exactly_once() {
        let (mut g, minted, minted_id) = galaxy_with_a_same_block_mint_and_burn();

        // Same-height replacement block: the whole of height 2 unwinds.
        let rollback = g.handle_block_mined(2, "0xccc", 0, 3_000);

        // The identity leaves the canonical container entirely — it belongs
        // to a block that never happened.
        assert!(
            g.cells.iter().all(|c| c.out_point != minted),
            "the rolled-back mint must not keep a row; got {:?}",
            g.cells.iter().map(|c| &c.out_point).collect::<Vec<_>>()
        );
        assert!(!g.outpoint_index.contains_key(&minted));

        // …and it parks under its own outpoint exactly once, alive, ready for
        // the replacement suffix to revive in place.
        assert_eq!(
            g.reorg_limbo.get(&minted).map(|cell| cell.id),
            Some(minted_id),
            "the mint parks under its own outpoint"
        );
        assert!(
            g.reorg_limbo[&minted].death_at_ms.is_none(),
            "the park undoes the same block's spend before it undoes the birth"
        );

        // The bug this pins: the identity sat in `reorg_limbo` AND as a live
        // container row at the same time, so the replacement's revival
        // appended a duplicate.
        let parked: std::collections::HashSet<u64> =
            g.reorg_limbo.values().map(|cell| cell.id).collect();
        assert!(
            g.cells.iter().all(|c| !parked.contains(&c.id)),
            "no identity may be parked and resident at once"
        );
        g.assert_cell_index_consistent();

        // Parking stays silent, and the one Birth the unwind emits is the
        // park handshake for the mint (the same one a cross-height rollback
        // emits): the client keeps that identity alive in place until the
        // replacement either revives it or `settle_reorg_limbo` retires it.
        assert!(
            !rollback.iter().any(|d| matches!(d, CellDelta::Gc { .. })),
            "rollback must defer every park's GC; got {rollback:?}"
        );
        let births: Vec<u64> = rollback
            .iter()
            .filter_map(|d| match d {
                CellDelta::Birth { cell } => Some(cell.id),
                _ => None,
            })
            .collect();
        assert_eq!(
            births,
            vec![minted_id],
            "exactly one Birth, and it is the parked identity's — not a \
             phantom row's; got {rollback:?}"
        );

        // Counters return to the pre-block reality: one birth (the base
        // cell), no deaths.
        assert_eq!(g.total_births, 1);
        assert_eq!(g.total_deaths, 0);
    }

    #[test]
    fn a_replacement_re_including_a_same_block_mint_revives_it_once() {
        let (mut g, minted, minted_id) = galaxy_with_a_same_block_mint_and_burn();
        g.handle_block_mined(2, "0xccc", 2, 3_000);
        let next_id_before = g.next_id;

        // The replacement re-includes the mint: the parked identity revives in
        // place instead of duplicating the row the old unwind left behind.
        let replay = g.handle_tx_landed("0xmint", 2, 3_100, &[], &[out(200, "0xdd")]);
        assert!(replay
            .iter()
            .any(|d| matches!(d, CellDelta::Birth { cell } if cell.id == minted_id)));
        assert_eq!(g.next_id, next_id_before, "no fresh identity allocated");
        assert_eq!(
            g.cells.iter().filter(|c| c.id == minted_id).count(),
            1,
            "the revived mint holds exactly one row"
        );
        assert!(g
            .cells
            .iter()
            .any(|c| c.id == minted_id && c.death_at_ms.is_none()));
        assert!(!g.reorg_limbo.contains_key(&minted));
        assert_eq!(g.outpoint_index.get(&minted), Some(&minted_id));
        g.assert_cell_index_consistent();

        // …and the replacement's own spend still resolves to that one row.
        let respend = g.handle_tx_landed(
            "0xburn",
            2,
            3_150,
            std::slice::from_ref(&minted),
            &[out(150, "0xee")],
        );
        assert!(respend
            .iter()
            .any(|d| matches!(d, CellDelta::Death { id, .. } if *id == minted_id)));
        assert_eq!(
            g.cells
                .iter()
                .filter(|c| c.id == minted_id && c.death_at_ms.is_some())
                .count(),
            1
        );
        g.assert_cell_index_consistent();
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
        assert!(
            g.reorg_limbo.contains_key(&op("0xorphan", 0)),
            "orphan birth parks for the incoming replacement suffix"
        );
    }

    #[test]
    fn reorg_replay_revives_identity_for_a_re_included_outpoint() {
        let mut g = make_galaxy();
        g.handle_block_mined(1, "0xaaa", 1, 1_000);
        g.handle_tx_landed("0xbase", 1, 1_000, &[], &[out(100, "0x")]);
        g.handle_block_mined(2, "0xbbb", 1, 2_000);
        g.handle_tx_landed("0xtx", 2, 2_000, &[], &[out(200, "0xdd")]);
        let original = g
            .cells
            .iter()
            .find(|c| c.out_point == op("0xtx", 0))
            .expect("orphan-to-be output")
            .clone();
        let next_id_before = g.next_id;
        assert_eq!(g.total_births, 2);

        // Same-height replacement block: the rollback parks the birth…
        let rollback = g.handle_block_mined(2, "0xccc", 1, 3_000);
        assert!(
            !rollback.iter().any(|d| matches!(d, CellDelta::Gc { .. })),
            "rollback must defer the orphan-birth GC; got {rollback:?}"
        );
        assert_eq!(g.total_births, 1);

        // …and the replayed identical tx revives the identity in place. The
        // Birth is byte-identical to the original cell (same id → same
        // derived position, original born_at_ms preserved), which the
        // client-side reducer treats as a pure no-op upsert.
        let replay = g.handle_tx_landed("0xtx", 2, 3_000, &[], &[out(200, "0xdd")]);
        let reborn = replay
            .iter()
            .find_map(|d| match d {
                CellDelta::Birth { cell } => Some(cell),
                _ => None,
            })
            .expect("replayed birth");
        assert_eq!(reborn, &original);
        assert_eq!(g.next_id, next_id_before, "no fresh identity allocated");
        assert!(g.reorg_limbo.is_empty());
        assert_eq!(g.outpoint_index.get(&op("0xtx", 0)), Some(&original.id));
        assert_eq!(g.total_births, 2, "survivor nets zero across the reorg");
        assert!(g
            .block_births
            .get(&2)
            .is_some_and(|births| births.contains(&op("0xtx", 0))));
    }

    #[test]
    fn enveloped_reorg_replay_revives_identity_when_the_tx_moves_heights() {
        let mut g = make_galaxy();
        g.handle_block_mined(1, "0xaaa", 1, 1_000);
        g.handle_tx_landed("0xbase", 1, 1_000, &[], &[out(100, "0x")]);
        g.handle_block_mined(2, "0xbbb", 1, 2_000);
        g.handle_tx_landed("0xtx", 2, 2_000, &[], &[out(200, "0xdd")]);
        let original_id = g
            .cells
            .iter()
            .find(|c| c.out_point == op("0xtx", 0))
            .expect("orphan-to-be output")
            .id;

        g.apply_mutation(&Mutation::ChainReorganized { from_block: 2 });
        g.apply_mutation(&Mutation::BackfillProgress {
            done: 0,
            total: 2,
            active: true,
            phase: ReplayPhase::Reorg,
        });
        // Replacement chain: empty block at 2, the tx re-included at 3. The
        // enveloped replay must NOT trip the live-block backstop while
        // heights beyond the old tip stream in.
        g.handle_block_mined(2, "0xccc", 0, 3_000);
        let mined = g.handle_block_mined(3, "0xddd", 1, 3_100);
        assert!(
            !mined.iter().any(|d| matches!(d, CellDelta::Gc { .. })),
            "enveloped replay must not settle at a live-looking block"
        );
        assert!(!g.reorg_limbo.is_empty());

        let replay = g.handle_tx_landed("0xtx", 3, 3_100, &[], &[out(200, "0xdd")]);
        let reborn = replay
            .iter()
            .find_map(|d| match d {
                CellDelta::Birth { cell } => Some(cell),
                _ => None,
            })
            .expect("replayed birth");
        assert_eq!(reborn.id, original_id);
        assert_eq!(reborn.birth_block, 3, "honest height update");
        assert_eq!(reborn.born_at_ms, 2_000, "original birth time preserved");

        let terminal = g.apply_mutation(&Mutation::BackfillProgress {
            done: 2,
            total: 2,
            active: false,
            phase: ReplayPhase::Reorg,
        });
        assert!(!terminal.iter().any(|d| matches!(d, CellDelta::Gc { .. })));
        assert!(g.reorg_limbo.is_empty());
        assert!(g.limbo_backstop_height.is_none());
    }

    #[test]
    fn unreplayed_orphan_birth_gc_defers_to_the_replay_terminal() {
        let mut g = make_galaxy();
        g.handle_block_mined(1, "0xaaa", 1, 1_000);
        g.handle_tx_landed("0xbase", 1, 1_000, &[], &[out(100, "0x")]);
        g.handle_block_mined(2, "0xbbb", 1, 2_000);
        g.handle_tx_landed("0xorphan", 2, 2_000, &[], &[out(200, "0xdd")]);
        let orphan_id = g
            .cells
            .iter()
            .find(|c| c.out_point == op("0xorphan", 0))
            .expect("orphan output")
            .id;

        g.apply_mutation(&Mutation::ChainReorganized { from_block: 2 });
        g.apply_mutation(&Mutation::BackfillProgress {
            done: 0,
            total: 1,
            active: true,
            phase: ReplayPhase::Reorg,
        });
        // Replacement block does not re-include the orphan tx.
        g.handle_block_mined(2, "0xccc", 0, 3_000);
        let terminal = g.apply_mutation(&Mutation::BackfillProgress {
            done: 1,
            total: 1,
            active: false,
            phase: ReplayPhase::Reorg,
        });
        assert!(
            terminal
                .iter()
                .any(|d| matches!(d, CellDelta::Gc { ids } if ids == &vec![orphan_id])),
            "terminal must retire the unreplayed identity; got {terminal:?}"
        );
        assert!(g.reorg_limbo.is_empty());
        assert!(g.limbo_backstop_height.is_none());
        assert!(g.cells.iter().all(|c| c.id != orphan_id));
    }

    #[test]
    fn incomplete_replay_terminal_keeps_parked_identities_for_the_retry() {
        let mut g = make_galaxy();
        g.handle_block_mined(1, "0xaaa", 1, 1_000);
        g.handle_tx_landed("0xbase", 1, 1_000, &[], &[out(100, "0x")]);
        g.handle_block_mined(2, "0xbbb", 1, 2_000);
        g.handle_tx_landed("0xtx", 2, 2_000, &[], &[out(200, "0xdd")]);

        g.apply_mutation(&Mutation::ChainReorganized { from_block: 2 });
        g.apply_mutation(&Mutation::BackfillProgress {
            done: 0,
            total: 5,
            active: true,
            phase: ReplayPhase::Reorg,
        });
        // Hard error closed the envelope before covering the suffix: the
        // poller's next cycle reopens it, so the limbo must survive.
        let closed = g.apply_mutation(&Mutation::BackfillProgress {
            done: 2,
            total: 5,
            active: false,
            phase: ReplayPhase::Reorg,
        });
        assert!(!closed.iter().any(|d| matches!(d, CellDelta::Gc { .. })));
        assert!(!g.reorg_limbo.is_empty());
        assert_eq!(g.limbo_backstop_height, Some(2));
    }

    #[test]
    fn implicit_replacement_settles_leftover_limbo_at_the_next_live_block() {
        let mut g = make_galaxy();
        g.handle_block_mined(1, "0xaaa", 1, 1_000);
        g.handle_tx_landed("0xbase", 1, 1_000, &[], &[out(100, "0x")]);
        g.handle_block_mined(2, "0xbbb", 2, 2_000);
        g.handle_tx_landed("0xta", 2, 2_000, &[], &[out(200, "0xdd")]);
        g.handle_tx_landed("0xtb", 2, 2_100, &[], &[out(300, "0xee")]);
        let id_a = g.outpoint_index[&op("0xta", 0)];
        let id_b = g.outpoint_index[&op("0xtb", 0)];

        // Same-height replacement (no envelope): parks both, replays only A.
        g.handle_block_mined(2, "0xccc", 1, 3_000);
        let replay = g.handle_tx_landed("0xta", 2, 3_000, &[], &[out(200, "0xdd")]);
        assert!(replay
            .iter()
            .any(|d| matches!(d, CellDelta::Birth { cell } if cell.id == id_a)));

        // The first live block beyond the old tip retires the leftover.
        let mined = g.handle_block_mined(3, "0xddd", 0, 4_000);
        assert!(
            mined
                .iter()
                .any(|d| matches!(d, CellDelta::Gc { ids } if ids == &vec![id_b])),
            "backstop must retire only the unreplayed identity; got {mined:?}"
        );
        assert!(g.reorg_limbo.is_empty());
        assert!(g.limbo_backstop_height.is_none());
        assert!(g.cells.iter().any(|c| c.id == id_a));
        assert!(g.cells.iter().all(|c| c.id != id_b));
    }

    #[test]
    fn a_second_rollback_reparks_revived_identities_without_duplication() {
        let mut g = make_galaxy();
        g.handle_block_mined(1, "0xaaa", 1, 1_000);
        g.handle_tx_landed("0xbase", 1, 1_000, &[], &[out(100, "0x")]);
        g.handle_block_mined(2, "0xbbb", 1, 2_000);
        g.handle_tx_landed("0xtx", 2, 2_000, &[], &[out(200, "0xdd")]);
        let id = g.outpoint_index[&op("0xtx", 0)];

        g.handle_block_mined(2, "0xccc", 1, 3_000);
        g.handle_tx_landed("0xtx", 2, 3_000, &[], &[out(200, "0xdd")]);

        // The revived birth was re-journaled, so a second replacement at the
        // same height parks the same identity again — exactly once.
        g.handle_block_mined(2, "0xddd", 1, 4_000);
        assert_eq!(g.reorg_limbo.len(), 1);
        assert_eq!(g.reorg_limbo[&op("0xtx", 0)].id, id);
        assert!(g.cells.iter().all(|c| c.id != id));

        let replay = g.handle_tx_landed("0xtx", 2, 4_100, &[], &[out(200, "0xdd")]);
        assert!(replay
            .iter()
            .any(|d| matches!(d, CellDelta::Birth { cell } if cell.id == id)));
        let settled = g.handle_block_mined(3, "0xeee", 0, 5_000);
        assert!(
            !settled.iter().any(|d| matches!(d, CellDelta::Gc { .. })),
            "everything revived — nothing left to retire"
        );
        assert_eq!(g.cells.iter().filter(|c| c.id == id).count(), 1);
    }

    #[test]
    fn limbo_content_mismatch_fails_open_to_a_fresh_identity() {
        let mut g = make_galaxy();
        g.handle_block_mined(1, "0xaaa", 1, 1_000);
        g.handle_tx_landed("0xbase", 1, 1_000, &[], &[out(100, "0x")]);
        g.handle_block_mined(2, "0xbbb", 1, 2_000);
        g.handle_tx_landed("0xtx", 2, 2_000, &[], &[out(200, "0xdd")]);
        let old_id = g.outpoint_index[&op("0xtx", 0)];
        g.handle_block_mined(2, "0xccc", 1, 3_000);
        let fresh_id = g.next_id;

        // Impossible on a real chain (tx_hash covers output content); a
        // synthetic source diverging here must not revive the identity.
        let replay = g.handle_tx_landed("0xtx", 2, 3_000, &[], &[out(300, "0xdd")]);
        assert!(replay
            .iter()
            .any(|d| matches!(d, CellDelta::Gc { ids } if ids == &vec![old_id])));
        assert!(replay
            .iter()
            .any(|d| matches!(d, CellDelta::Birth { cell } if cell.id == fresh_id)));
        assert!(g.reorg_limbo.is_empty());
    }

    #[test]
    fn reset_for_rebuild_retires_parked_identities() {
        let mut g = make_galaxy();
        g.handle_block_mined(1, "0xaaa", 1, 1_000);
        g.handle_tx_landed("0xbase", 1, 1_000, &[], &[out(100, "0x")]);
        g.handle_block_mined(2, "0xbbb", 1, 2_000);
        g.handle_tx_landed("0xorphan", 2, 2_000, &[], &[out(200, "0xdd")]);
        let orphan_id = g.outpoint_index[&op("0xorphan", 0)];
        g.apply_mutation(&Mutation::ChainReorganized { from_block: 2 });
        assert!(!g.reorg_limbo.is_empty());

        let deltas = g.apply_mutation(&Mutation::ChainRebuild { from_block: 20 });
        let gc_ids = deltas
            .iter()
            .find_map(|d| match d {
                CellDelta::Gc { ids } => Some(ids.clone()),
                _ => None,
            })
            .expect("reset GC");
        assert!(
            gc_ids.contains(&orphan_id),
            "parked identity joins the reset GC"
        );
        assert!(g.reorg_limbo.is_empty());
        assert!(g.limbo_backstop_height.is_none());
    }

    #[test]
    fn parked_identities_do_not_persist() {
        let mut g = make_galaxy();
        g.handle_block_mined(1, "0xaaa", 1, 1_000);
        g.handle_tx_landed("0xbase", 1, 1_000, &[], &[out(100, "0x")]);
        g.handle_block_mined(2, "0xbbb", 1, 2_000);
        g.handle_tx_landed("0xtx", 2, 2_000, &[], &[out(200, "0xdd")]);
        g.apply_mutation(&Mutation::ChainReorganized { from_block: 2 });
        assert!(!g.reorg_limbo.is_empty());

        let mut restored = CellGalaxy::new();
        restored.restore_from(g.to_persisted());
        assert!(restored.reorg_limbo.is_empty());
        assert!(restored.limbo_backstop_height.is_none());

        // Documented degradation: a post-restart replay births a fresh
        // identity (reconnecting clients resnapshot, so nothing dangles).
        let fresh_id = restored.next_id;
        let replay = restored.handle_tx_landed("0xtx", 2, 4_000, &[], &[out(200, "0xdd")]);
        assert!(replay
            .iter()
            .any(|d| matches!(d, CellDelta::Birth { cell } if cell.id == fresh_id)));
        assert_eq!(restored.total_births, 2);
    }

    #[test]
    fn id_index_tracks_the_container_through_gc_rollback_and_revival() {
        // Every compaction site in one sequence: retain (`gc_cells`),
        // mid-vec remove (reorg park), append-after-gc (resurrection) and
        // wholesale replace (`restore_from`). The structural mirror is
        // asserted after each mutation by the test hook; what this test
        // adds is that the O(1) death and tag lookups still land on the
        // cell the old linear scans landed on once slots have shifted.
        let mut g = make_galaxy();
        g.handle_block_mined(1, "0xb1", 1, 1_000);
        g.handle_tx_landed(
            "0xgen",
            1,
            1_000,
            &[],
            &[
                out(100, "0xa"),
                out(200, "0xb"),
                out(300, "0xc"),
                out(400, "0xd"),
            ],
        );
        let gen_ids: Vec<u64> = (0..4).map(|i| g.outpoint_index[&op("0xgen", i)]).collect();

        // Deaths mark in place: no compaction, every slot stays put.
        g.handle_block_mined(2, "0xb2", 1, 2_000);
        g.handle_tx_landed(
            "0xspend",
            2,
            2_000,
            &[op("0xgen", 0), op("0xgen", 1)],
            &[out(500, "0xe"), out(600, "0xf")],
        );
        let spend_ids: Vec<u64> = (0..2)
            .map(|i| g.outpoint_index[&op("0xspend", i)])
            .collect();
        assert_eq!(g.cells.len(), 6, "corpses stay for the corpse hold");

        // Retain compaction: both corpses fall past the hold, so every
        // surviving slot shifts down by two.
        g.handle_block_mined(3, "0xb3", 0, 2_000 + CORPSE_HOLD_MS + 1);
        assert_eq!(
            g.cells.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![gen_ids[2], gen_ids[3], spend_ids[0], spend_ids[1]]
        );
        // A stale index would tag a shifted bystander here.
        g.apply_mutation(&Mutation::CellTagged {
            out_point: op("0xspend", 1),
            tag: "dex".to_string(),
            at: 2_000 + CORPSE_HOLD_MS + 101,
        });
        assert_eq!(
            g.cells
                .iter()
                .filter(|c| c.tag.is_some())
                .map(|c| c.id)
                .collect::<Vec<_>>(),
            vec![spend_ids[1]]
        );

        // Replacement at height 2: parks both spend births (mid-vec
        // removes, tail repair) and resurrects the two gc'd corpses —
        // appends, since their old slots are long gone.
        g.handle_block_mined(2, "0xb2prime", 1, 2_000 + CORPSE_HOLD_MS + 1_001);
        assert_eq!(g.reorg_limbo.len(), 2);
        assert_eq!(
            g.cells.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![gen_ids[2], gen_ids[3], gen_ids[1], gen_ids[0]],
            "deaths are undone newest-first and land after the survivors"
        );

        // The replacement suffix re-lands the same tx: the parked ids
        // revive and the re-spends must find the resurrected cells at
        // their NEW slots.
        let replay = g.handle_tx_landed(
            "0xspend",
            2,
            2_000 + CORPSE_HOLD_MS + 1_101,
            &[op("0xgen", 0), op("0xgen", 1)],
            &[out(500, "0xe"), out(600, "0xf")],
        );
        assert_eq!(
            replay
                .iter()
                .filter_map(|d| match d {
                    CellDelta::Death { id, .. } => Some(*id),
                    _ => None,
                })
                .collect::<Vec<_>>(),
            vec![gen_ids[0], gen_ids[1]],
            "the O(1) death lookup follows the resurrected cells' new slots"
        );
        assert_eq!(
            replay
                .iter()
                .filter_map(|d| match d {
                    CellDelta::Birth { cell } => Some(cell.id),
                    _ => None,
                })
                .collect::<Vec<_>>(),
            spend_ids,
            "parked identities revive rather than allocating fresh ids"
        );

        // Wholesale replace: the index is derived, never persisted.
        let mut restored = CellGalaxy::new();
        restored.restore_from(g.to_persisted());
        restored.assert_cell_index_consistent();
        assert_eq!(
            restored.cells.iter().map(|c| c.id).collect::<Vec<_>>(),
            g.cells.iter().map(|c| c.id).collect::<Vec<_>>(),
            "restore preserves container order, so the rebuilt index mirrors it"
        );
        let tagged = restored.apply_mutation(&Mutation::CellTagged {
            out_point: op("0xgen", 2),
            tag: "cf".to_string(),
            at: 2_000 + CORPSE_HOLD_MS + 2_000,
        });
        assert!(
            tagged
                .iter()
                .any(|d| matches!(d, CellDelta::Tag { id, .. } if *id == gen_ids[2])),
            "the rebuilt index resolves tags through the restored container; got {tagged:?}"
        );
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
            data_bytes: 0,
            content_hash: format!("0x{:064x}", 0),
            lock_shape_seed: [1, 2],
            type_shape_seed: None,
            data_shape_seed: [3, 4],
            lock_kind: LockKind::Other,
            asset_kind: AssetKind::Other,
            lock_script: Default::default(),
            type_script: None,
            collection_seed: None,
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
            hydrated_cell_target: 0,
            hydration_floor: None,
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
            hydrated_cell_target: 0,
            hydration_floor: None,
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

    // ── display plane (S1, prefix mode) ──────────────────────────────

    use crate::projection::display_plane::{
        DISPLAY_ACTIVITY_QUOTA, DISPLAY_CELL_BUDGET, DISPLAY_NERVE_EDGE_BUDGET,
    };

    const RESTING_TARGET: usize = DISPLAY_CELL_BUDGET as usize - DISPLAY_ACTIVITY_QUOTA;

    fn mined(number: u64, hash: &str, at: u64) -> Mutation {
        Mutation::BlockMined {
            number,
            hash: hash.into(),
            tx_count: 1,
            size: 0,
            at,
        }
    }

    fn landed(
        tx: &str,
        block: u64,
        at: u64,
        inputs: Vec<OutPoint>,
        outputs: Vec<TxOutputInfo>,
    ) -> Mutation {
        Mutation::TxLanded {
            tx_hash: tx.into(),
            block,
            at,
            inputs,
            outputs,
        }
    }

    fn display_delta_count(deltas: &[CellDelta]) -> usize {
        deltas
            .iter()
            .filter(|d| matches!(d, CellDelta::Display { .. }))
            .count()
    }

    /// Extract THE display delta of a mutation as (entered ids, exited
    /// ids, provenance), pinning on the way: at most one delta per
    /// mutation, every enter carries its record (invariant I3 — nothing
    /// leaves as a bare id), and no resident payload rides a prefix-mode
    /// delta (residents are the only enters with composition ids).
    #[allow(clippy::type_complexity)]
    fn display_delta(
        deltas: &[CellDelta],
    ) -> Option<(Vec<u64>, &Vec<u64>, Option<&DisplayProvenance>)> {
        display_delta_full(deltas).map(|(enter_ids, enter_cells, exit_ids, provenance)| {
            assert!(
                enter_ids.is_empty(),
                "an enter must carry its record, not a bare id: {enter_ids:?}"
            );
            let entered: Vec<u64> = enter_cells.iter().map(|cell| cell.id).collect();
            assert!(
                entered
                    .iter()
                    .all(|id| *id < crate::identity::COMPOSITION_ID_PREFIX),
                "prefix mode never ships resident payloads: {entered:?}"
            );
            (entered, exit_ids, provenance)
        })
    }

    /// Composed-aware variant: the full (enter_ids, enter_cells,
    /// exit_ids, provenance) of THE display delta, still pinning "at
    /// most one per mutation".
    #[allow(clippy::type_complexity)]
    fn display_delta_full(
        deltas: &[CellDelta],
    ) -> Option<(&Vec<u64>, &Vec<Cell>, &Vec<u64>, Option<&DisplayProvenance>)> {
        assert!(
            display_delta_count(deltas) <= 1,
            "at most one Display delta per mutation; got {deltas:?}"
        );
        deltas.iter().find_map(|d| match d {
            CellDelta::Display {
                enter_ids,
                enter_cells,
                exit_ids,
                provenance,
            } => Some((enter_ids, enter_cells, exit_ids, provenance.as_ref())),
            _ => None,
        })
    }

    /// Structural invariants: the presence mirror tracks the map
    /// exactly, every member is exactly one of canonical or resident
    /// (I4 at the id level), and the budget holds.
    fn assert_display_invariants(g: &CellGalaxy) {
        let mut map_ids: Vec<u64> = g.cells.iter().map(|c| c.id).collect();
        map_ids.sort_unstable();
        assert_eq!(
            g.display.present_ids_sorted(),
            map_ids,
            "presence mirror diverged from the canonical map — a removal path went unhooked"
        );
        let section = g.snapshot().display.expect("display section");
        let map_set: std::collections::HashSet<u64> = map_ids.iter().copied().collect();
        let resident_ids: std::collections::HashSet<u64> =
            section.residents.iter().map(|c| c.id).collect();
        for id in &resident_ids {
            assert!(
                !map_set.contains(id),
                "resident {id} duplicates a canonical id"
            );
        }
        for id in &section.members {
            assert!(
                map_set.contains(id) || resident_ids.contains(id),
                "member {id} is neither canonical nor resident"
            );
        }
        assert!(section.members.len() <= DISPLAY_CELL_BUDGET as usize);
    }

    /// Pin 1 — bootstrap fill: the resting field IS the recency window, so
    /// one tx's first (budget − quota) births fill it and the overflow
    /// births of that same tx enter as ACTIVITY (D3) — they are the same
    /// age, and the window is already full of them.
    ///
    /// A LATER birth is a different matter: it is younger than everything
    /// standing, so it takes a window seat and the window's OLDEST member
    /// gives it up. The resting prefix used to close behind the first
    /// mutation and never open again; now it slides with the tip.
    #[test]
    fn display_bootstrap_fills_the_window_and_a_later_birth_slides_it() {
        let mut g = make_galaxy();
        let outs: Vec<TxOutputInfo> = (0..RESTING_TARGET + 3)
            .map(|i| out(100 + i as u64, "0x"))
            .collect();
        let deltas = g.apply_mutation(&landed("0xbulk", 1, 1_000, vec![], outs));
        let (enter, exit, provenance) = display_delta(&deltas).expect("bootstrap fill delta");
        // First RESTING_TARGET ids fill the resting set; the 3 overflow
        // births enter as activity endpoints of their own birth tx.
        assert_eq!(enter, (0..(RESTING_TARGET as u64 + 3)).collect::<Vec<_>>());
        assert!(exit.is_empty());
        let provenance = provenance.expect("first fill rides provenance");
        assert_eq!(provenance.mode, DisplayMode::Canonical);
        assert_eq!(provenance.source, None);
        assert_eq!(provenance.as_of, None);
        assert_eq!(provenance.updated_at_ms, 1_000);
        assert_eq!(g.display.resting_len(), RESTING_TARGET);
        assert_eq!(g.display.activity_len(), 3);
        assert!(g.display.is_activity_member(RESTING_TARGET as u64));

        // A later birth: the newest cell on the chain, so it STANDS —
        // and the oldest member of the window is the one that leaves.
        let late_id = RESTING_TARGET as u64 + 3;
        let oldest = RESTING_TARGET as u64 - 1;
        let deltas = g.apply_mutation(&landed("0xlate", 2, 2_000, vec![], vec![out(7, "0x")]));
        let (enter, exit, provenance) = display_delta(&deltas).expect("late birth enters");
        assert_eq!(enter, vec![late_id]);
        assert_eq!(
            exit,
            &vec![oldest],
            "the window's oldest member gave up the seat — one in, one out"
        );
        assert!(
            provenance.is_none(),
            "provenance rides only when it changes"
        );
        assert!(
            !g.display.is_activity_member(late_id),
            "the newest cell on the chain stands; it does not merely pulse"
        );
        assert_eq!(g.display.resting_len(), RESTING_TARGET);

        let section = g.snapshot().display.expect("display always present");
        assert_eq!(section.members.len(), RESTING_TARGET + 3);
        assert_eq!(section.budget.cells, DISPLAY_CELL_BUDGET);
        assert_eq!(section.budget.nerve_edges, DISPLAY_NERVE_EDGE_BUDGET);
        assert!(section.residents.is_empty());
        assert_display_invariants(&g);
    }

    /// Pin 2 — a staged endpoint (even a fresh corpse) is a membership
    /// no-op. The tx's own output is the newest cell there is, so it takes
    /// a window seat; the seat it takes belongs to the window's oldest
    /// member, never to the consumed one, which keeps its corpse hold.
    #[test]
    fn display_endpoint_already_staged_is_membership_noop() {
        let mut g = make_galaxy();
        let outs: Vec<TxOutputInfo> = (0..RESTING_TARGET)
            .map(|i| out(1 + i as u64, "0x"))
            .collect();
        g.apply_mutation(&landed("0xbulk", 1, 1_000, vec![], outs));

        // Spend member 5 producing one output: endpoints are [5, new].
        // 5 is staged (and now a corpse) → no-op; the new cell stands in
        // the recency window.
        let new_id = RESTING_TARGET as u64;
        let oldest = RESTING_TARGET as u64 - 1;
        let deltas = g.apply_mutation(&landed(
            "0xswap",
            2,
            2_000,
            vec![op("0xbulk", 5)],
            vec![out(9, "0x")],
        ));
        let (enter, exit, _) = display_delta(&deltas).expect("endpoint entry");
        assert_eq!(enter, vec![new_id]);
        assert_eq!(
            exit,
            &vec![oldest],
            "the window's oldest gave way to the newest — not the corpse"
        );
        assert!(
            g.display.member_ids_sorted().contains(&5),
            "the consumed member keeps its seat"
        );
        assert!(!g.display.is_activity_member(new_id));
        assert_display_invariants(&g);
    }

    /// Pin 3 — death: the member stays (corpse window); canonical GC →
    /// exit, and the recency window refills the seat with the next-youngest
    /// live cell (promoting an already-staged activity member without wire
    /// churn when that is who it is).
    #[test]
    fn display_corpse_stays_until_gc_then_the_window_refills_with_promotion() {
        let mut g = make_galaxy();
        let outs: Vec<TxOutputInfo> = (0..RESTING_TARGET + 1)
            .map(|i| out(1 + i as u64, "0x"))
            .collect();
        g.apply_mutation(&landed("0xbulk", 1, 1_000, vec![], outs));
        let over_id = RESTING_TARGET as u64; // beyond the prefix → activity
        assert!(g.display.is_activity_member(over_id));

        // Pure spend (no outputs → no Link → no endpoint entries): the
        // death alone changes nothing on stage.
        let death_a = 2_000;
        g.apply_mutation(&mined(2, "0xb2", death_a));
        let deltas = g.apply_mutation(&landed(
            "0xspend",
            2,
            death_a,
            vec![op("0xbulk", 0)],
            vec![],
        ));
        assert!(
            display_delta(&deltas).is_none(),
            "corpse keeps its seat — no membership change, no delta"
        );
        assert!(g.display.member_ids_sorted().contains(&0));

        // Mid-rite: the client has not even STARTED withering this corpse
        // (that begins at death + 2350 ms) and blocks keep arriving. The
        // member must still be staged, or the browser loses the cell it is
        // about to mourn — the exact failure the old 600 ms tail produced.
        let mid_rite = death_a + 700;
        assert!(mid_rite < death_a + CORPSE_HOLD_MS);
        let deltas = g.apply_mutation(&mined(3, "0xb3", mid_rite));
        assert!(
            display_delta(&deltas).is_none(),
            "the corpse hold spans the whole client rite — no exit yet"
        );
        assert!(g.display.member_ids_sorted().contains(&0));
        assert!(g.cells.iter().any(|c| c.id == 0), "corpse still retained");

        // GC past the corpse hold: 0 exits; the window's next-youngest
        // candidate (over_id) is already staged as activity → promoted in
        // place, so the only wire change is the exit.
        let deltas = g.apply_mutation(&mined(4, "0xb4", death_a + CORPSE_HOLD_MS + 1));
        let (enter, exit, _) = display_delta(&deltas).expect("gc exit");
        assert!(enter.is_empty());
        assert_eq!(exit, &vec![0]);
        assert_eq!(g.display.resting_len(), RESTING_TARGET);
        assert_eq!(g.display.activity_len(), 0, "promotion freed the slot");
        assert!(!g.display.is_activity_member(over_id));

        // Candidates exhausted: the next GC leaves the stage underfull…
        // Eviction order is unchanged by the longer hold — a dead member
        // still leaves at ITS gc, in death order, just later.
        let death_b = death_a + CORPSE_HOLD_MS + 300;
        g.apply_mutation(&mined(5, "0xb5", death_b));
        g.apply_mutation(&landed(
            "0xspend2",
            5,
            death_b,
            vec![op("0xbulk", 1)],
            vec![],
        ));
        let deltas = g.apply_mutation(&mined(6, "0xb6", death_b + CORPSE_HOLD_MS + 1));
        let (enter, exit, _) = display_delta(&deltas).expect("second gc exit");
        assert!(enter.is_empty(), "no backfill candidates left");
        assert_eq!(exit, &vec![1]);

        // …and the next birth takes the seat as a standing window member.
        let fresh_id = over_id + 1;
        let deltas = g.apply_mutation(&landed(
            "0xfresh",
            6,
            death_b + CORPSE_HOLD_MS + 100,
            vec![],
            vec![out(9, "0x")],
        ));
        let (enter, exit, _) = display_delta(&deltas).expect("vacancy refill");
        assert_eq!(enter, vec![fresh_id]);
        assert!(exit.is_empty());
        assert!(!g.display.is_activity_member(fresh_id));
        assert_eq!(g.display.resting_len(), RESTING_TARGET);
        assert_display_invariants(&g);
    }

    /// Pin 4a — reorg rollback: parked births exit (the park is SILENT on the
    /// canonical stream); limbo settle GCs ids that already left the
    /// stage, so it is a display no-op.
    #[test]
    fn display_reorg_rollback_and_limbo_settle_keep_members_within_map() {
        let mut g = make_galaxy();
        g.apply_mutation(&mined(1, "0xb1", 1_000));
        g.apply_mutation(&landed("0xbase", 1, 1_000, vec![], vec![out(100, "0x")]));
        g.apply_mutation(&mined(2, "0xb2", 2_000));
        g.apply_mutation(&landed(
            "0xtx",
            2,
            2_000,
            vec![],
            vec![out(200, "0xdd"), out(300, "0xee")],
        ));
        assert_eq!(g.display.member_ids_sorted(), vec![0, 1, 2]);
        assert_display_invariants(&g);

        let deltas = g.apply_mutation(&Mutation::ChainReorganized { from_block: 2 });
        let (enter, exit, _) = display_delta(&deltas).expect("park exits");
        assert!(enter.is_empty());
        assert_eq!(exit, &vec![1, 2]);
        assert_display_invariants(&g);

        // Replacement block never re-includes the tx; the backstop block
        // settles the limbo with a canonical Gc — both ids already left
        // the stage at park time, so no display delta rides along.
        g.apply_mutation(&mined(2, "0xb2r", 3_000));
        let deltas = g.apply_mutation(&mined(3, "0xb3", 4_000));
        assert!(deltas
            .iter()
            .any(|d| matches!(d, CellDelta::Gc { ids } if ids.len() == 2)));
        assert!(display_delta(&deltas).is_none());
        assert_eq!(g.display.member_ids_sorted(), vec![0]);
        assert_display_invariants(&g);
    }

    /// Pin 4b — a revived identity re-enters through the ordinary birth +
    /// endpoint paths — no special casing beyond the invariant.
    #[test]
    fn display_reorg_revival_re_enters_the_stage() {
        let mut g = make_galaxy();
        g.apply_mutation(&mined(1, "0xb1", 1_000));
        g.apply_mutation(&landed("0xbase", 1, 1_000, vec![], vec![out(100, "0x")]));
        g.apply_mutation(&mined(2, "0xb2", 2_000));
        g.apply_mutation(&landed(
            "0xtx",
            2,
            2_000,
            vec![],
            vec![out(200, "0xdd"), out(300, "0xee")],
        ));
        g.apply_mutation(&Mutation::ChainReorganized { from_block: 2 });
        assert_eq!(g.display.member_ids_sorted(), vec![0]);

        g.apply_mutation(&mined(2, "0xb2r", 3_000));
        let deltas = g.apply_mutation(&landed(
            "0xtx",
            2,
            3_000,
            vec![],
            vec![out(200, "0xdd"), out(300, "0xee")],
        ));
        let (enter, exit, _) = display_delta(&deltas).expect("revival re-enters");
        assert_eq!(enter, vec![1, 2]);
        assert!(exit.is_empty());
        assert_display_invariants(&g);

        // Everything revived — the settle block has nothing to retire
        // and the stage is untouched.
        let deltas = g.apply_mutation(&mined(3, "0xb3", 4_000));
        assert!(display_delta(&deltas).is_none());
        assert_eq!(g.display.member_ids_sorted(), vec![0, 1, 2]);
        assert_display_invariants(&g);
    }

    /// Pin 5 — reset_for_rebuild empties the plane with one coalesced
    /// exit-all delta alongside the canonical Gc(all).
    #[test]
    fn display_reset_for_rebuild_exits_everything_in_one_coalesced_delta() {
        let mut g = make_galaxy();
        g.apply_mutation(&landed(
            "0xa",
            1,
            1_000,
            vec![],
            vec![out(1, "0x"), out(2, "0x"), out(3, "0x")],
        ));
        let deltas = g.apply_mutation(&Mutation::ChainRebuild { from_block: 9 });
        let (enter, exit, provenance) = display_delta(&deltas).expect("exit-all");
        assert!(enter.is_empty());
        assert_eq!(exit, &vec![0, 1, 2]);
        assert!(provenance.is_none(), "mode unchanged — no provenance ride");
        assert!(g.snapshot().display.expect("section").members.is_empty());
        assert_display_invariants(&g);
    }

    /// Pin 6 — backfill: per-mutation display deltas are suppressed while the
    /// replay runs; the terminal emits exactly one coalesced delta with
    /// the final membership (activity suppressed throughout).
    #[test]
    fn display_backfill_suppresses_per_mutation_deltas_and_resettles_once() {
        let mut g = make_galaxy();
        g.apply_mutation(&Mutation::BackfillProgress {
            done: 0,
            total: 2,
            active: true,
            phase: ReplayPhase::Boot,
        });
        let streamed = [
            g.apply_mutation(&mined(1, "0xb1", 1_000)),
            g.apply_mutation(&landed(
                "0xa",
                1,
                1_000,
                vec![],
                vec![out(1, "0x"), out(2, "0x")],
            )),
            g.apply_mutation(&mined(2, "0xb2", 2_000)),
            g.apply_mutation(&landed(
                "0xb",
                2,
                2_000,
                vec![op("0xa", 0)],
                vec![out(3, "0x")],
            )),
        ];
        for deltas in &streamed {
            assert_eq!(display_delta_count(deltas), 0, "suppressed during replay");
        }

        let terminal = g.apply_mutation(&Mutation::BackfillProgress {
            done: 2,
            total: 2,
            active: false,
            phase: ReplayPhase::Boot,
        });
        let (enter, exit, provenance) = display_delta(&terminal).expect("terminal resettle");
        assert_eq!(enter, vec![0, 1, 2]);
        assert!(exit.is_empty());
        assert!(
            provenance.is_some(),
            "the wire first learns membership at the resettle"
        );
        assert_eq!(
            g.snapshot().display.expect("section").members,
            vec![0, 1, 2]
        );
        assert_eq!(
            g.display.activity_len(),
            0,
            "replay-time endpoints must not stage as activity"
        );
        assert_display_invariants(&g);
    }

    /// Shared mutation script for the replay-consistency and determinism
    /// tests. Deliberately crosses every membership-changing path:
    /// backfill fill + terminal resettle, GC exit + backfill, reorg park,
    /// revival, a second park, limbo drain into a rebuild reset (HashMap
    /// drain order — must never leak into display bytes), and a fresh
    /// refill.
    fn display_scenario() -> Vec<Mutation> {
        vec![
            Mutation::BackfillProgress {
                done: 0,
                total: 3,
                active: true,
                phase: ReplayPhase::Boot,
            },
            mined(1, "0xb1", 1_000),
            landed(
                "0xa",
                1,
                1_000,
                vec![],
                vec![out(1, "0x"), out(2, "0x"), out(3, "0x"), out(4, "0x")],
            ),
            mined(2, "0xb2", 2_000),
            landed("0xb", 2, 2_000, vec![op("0xa", 0)], vec![out(5, "0x")]),
            Mutation::BackfillProgress {
                done: 3,
                total: 3,
                active: false,
                phase: ReplayPhase::Boot,
            },
            mined(3, "0xb3", 2_700), // GCs the corpse of a#0
            landed("0xc", 3, 2_800, vec![], vec![out(6, "0x"), out(7, "0x")]),
            Mutation::ChainReorganized { from_block: 3 }, // parks c's births
            mined(3, "0xb3r", 3_000),
            landed("0xc", 3, 3_000, vec![], vec![out(6, "0x"), out(7, "0x")]), // revives them
            mined(4, "0xb4", 4_000), // settle: limbo empty
            mined(5, "0xb5", 5_000),
            Mutation::ChainReorganized { from_block: 3 }, // re-parks the revived pair
            Mutation::ChainRebuild { from_block: 50 },    // reset drains the limbo
            landed("0xd", 50, 50_000, vec![], vec![out(8, "0x")]),
        ]
    }

    /// One off-map reservoir resident per class, at a given anchor.
    /// Content is keyed by the id triple, so records with the same ids
    /// content-match across anchors (the dedup shape) and records with
    /// different ids do not.
    fn reservoir_record(block: u64, ids: (u64, u64, u64)) -> GalaxyCompositionRecord {
        let resident = |id: u64, kind| Cell {
            id,
            born_at_ms: 0,
            death_at_ms: None,
            birth_block: 0,
            tag: None,
            pos_seed: helix_seed_for(id),
            out_point: op(&format!("0xr{id}"), 0),
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
            collection_seed: None,
        };
        GalaxyCompositionRecord {
            source: "ckbadger".into(),
            as_of: ChainAnchor {
                block,
                hash: format!("0xanchor{block}"),
            },
            updated_at_ms: block * 1_000,
            dao: vec![resident(ids.0, AssetKind::Dao)],
            typed: vec![resident(ids.1, AssetKind::Xudt)],
            plain: vec![resident(ids.2, AssetKind::Native)],
        }
    }

    fn reservoir(block: u64, ids: (u64, u64, u64)) -> Mutation {
        Mutation::GalaxyReservoirReplaced {
            record: reservoir_record(block, ids),
        }
    }

    /// Additive supply carrying one dao and one typed resident.
    fn top_up(block: u64, ids: (u64, u64)) -> Mutation {
        let record = reservoir_record(block, (ids.0, ids.1, 0));
        Mutation::GalaxyReservoirToppedUp {
            top_up: cknerv_core_top_up(record),
        }
    }

    fn cknerv_core_top_up(record: GalaxyCompositionRecord) -> crate::GalaxyCompositionTopUp {
        crate::GalaxyCompositionTopUp {
            source: record.source,
            as_of: record.as_of,
            updated_at_ms: record.updated_at_ms,
            dao: record.dao,
            typed: record.typed,
        }
    }

    /// Composed-mode mutation script crossing every S2 path: refresh
    /// transition (canonical→composed with residents), activity/vacancy
    /// churn, content dedup, an off-map resident SPEND (T1), an additive
    /// TOP-UP (T3/T4), corpse GC,
    /// a D5 later-collision birth (the tx re-creating a staged
    /// resident's outpoint), a reorg ABOVE the
    /// anchor (composition kept), a reorg AT the anchor (degrade →
    /// canonical, park-everything), a rebuild reset, and a fresh
    /// composition after it.
    fn composed_display_scenario() -> Vec<Mutation> {
        vec![
            mined(1, "0xb1", 1_000),
            landed(
                "0xa",
                1,
                1_000,
                vec![],
                vec![out(1, "0x"), out(2, "0x"), out(3, "0x")],
            ),
            reservoir(1, (500_000, 500_001, 500_002)),
            mined(2, "0xb2", 2_000),
            landed("0xb", 2, 2_000, vec![op("0xa", 0)], vec![out(5, "0x")]),
            reservoir(2, (500_000, 500_001, 500_002)), // content dedup no-op
            // T1: an input the canonical index cannot resolve, spending
            // the DAO resident's outpoint → it exits the stage.
            landed("0xspend", 2, 2_100, vec![op("0xr500000", 0)], vec![]),
            // T3/T4: supply answering the dao shortfall the spend widened.
            top_up(2, (510_000, 510_001)),
            mined(3, "0xb3", 2_700), // GCs the corpse of a#0
            // D5 later-collision: this tx's #0 output IS the typed
            // resident's outpoint → in-place swap.
            landed("0xr500001", 3, 2_800, vec![], vec![out(9, "0x")]),
            Mutation::ChainReorganized { from_block: 3 }, // above anchor 2 → composition kept
            mined(3, "0xb3r", 3_000),
            Mutation::ChainReorganized { from_block: 1 }, // at/below anchor → degrade
            Mutation::ChainRebuild { from_block: 50 },
            landed("0xd", 50, 50_000, vec![], vec![out(8, "0x")]),
            reservoir(60, (600_000, 600_001, 600_002)),
        ]
    }

    /// A client, as `packages/cache/src/cellsReducer.ts` keeps one: the
    /// records it was handed (canonically, and by the display lane) and
    /// who it believes is on stage. Boots from a snapshot — which since R1
    /// carries the staged rows and nothing else — and then only ever
    /// learns what the deltas tell it.
    #[derive(Default)]
    struct ShadowClient {
        /// Canonical records: snapshot rows + `Birth`, patched by
        /// `Death`/`Tag`, dropped by `Gc`.
        cells: std::collections::BTreeMap<u64, Cell>,
        /// Records delivered by the display lane, for members this client
        /// does not already hold canonically. Dropped at exit.
        staged_records: std::collections::BTreeMap<u64, Cell>,
        members: std::collections::BTreeSet<u64>,
    }

    impl ShadowClient {
        fn connect(snapshot: &CellGalaxySnapshot) -> Self {
            let section = snapshot
                .display
                .as_ref()
                .expect("display section always present");
            Self {
                cells: snapshot
                    .cells
                    .iter()
                    .map(|cell| (cell.id, cell.clone()))
                    .collect(),
                staged_records: section
                    .residents
                    .iter()
                    .map(|cell| (cell.id, cell.clone()))
                    .collect(),
                members: section.members.iter().copied().collect(),
            }
        }

        /// Canonical-first, exactly like `resolveDisplayCell`.
        fn resolve(&self, id: u64) -> Option<&Cell> {
            self.cells.get(&id).or_else(|| self.staged_records.get(&id))
        }

        fn apply(&mut self, delta: &CellDelta) {
            match delta {
                CellDelta::Birth { cell } => {
                    self.cells.insert(cell.id, cell.clone());
                }
                CellDelta::Death { id, at_ms } => {
                    // Both homes, as the reducer does: a record that
                    // arrived on the display lane still has to hear that
                    // its cell died.
                    if let Some(cell) = self.cells.get_mut(id) {
                        cell.death_at_ms = Some(*at_ms);
                    }
                    if let Some(cell) = self.staged_records.get_mut(id) {
                        cell.death_at_ms = Some(*at_ms);
                    }
                }
                CellDelta::Tag { id, tag } => {
                    if let Some(cell) = self.cells.get_mut(id) {
                        cell.tag = Some(tag.clone());
                    }
                    if let Some(cell) = self.staged_records.get_mut(id) {
                        cell.tag = Some(tag.clone());
                    }
                }
                CellDelta::Gc { ids } => {
                    for id in ids {
                        self.cells.remove(id);
                    }
                }
                CellDelta::Display {
                    enter_ids,
                    enter_cells,
                    exit_ids,
                    ..
                } => {
                    for id in exit_ids {
                        self.members.remove(id);
                        self.staged_records.remove(id);
                    }
                    for id in enter_ids {
                        self.members.insert(*id);
                    }
                    for cell in enter_cells {
                        self.members.insert(cell.id);
                        // A record this client already holds canonically
                        // (a birth entering in its own batch) is the same
                        // record; keeping a second copy would mirror the
                        // whole stage.
                        if self.cells.get(&cell.id) != Some(cell) {
                            self.staged_records.insert(cell.id, cell.clone());
                        }
                    }
                }
                _ => {}
            }
        }
    }

    /// Shared assertion (invariant I3 + I5): a client that connected at
    /// step 0 and then only followed deltas holds, at every step, exactly
    /// what a client connecting fresh at that step would be handed — same
    /// membership, and the same record for every member. That is the whole
    /// claim of "the wire never asks the client to remember": the snapshot
    /// carries the stage, so any member whose record the deltas failed to
    /// deliver is a cell this client can never draw.
    ///
    /// Inside an active replay window per-mutation deltas are suppressed BY
    /// DESIGN (the runner clears the ring; reconnecting clients get a
    /// FullSnapshot), so the shadow simply stays frozen until the terminal
    /// resettle re-converges it.
    fn assert_display_replay_consistency(scenario: Vec<Mutation>) {
        let mut g = make_galaxy();
        let mut shadow = ShadowClient::connect(&g.snapshot());
        for (step, mutation) in scenario.into_iter().enumerate() {
            let deltas = g.apply_mutation(&mutation);
            let snapshot = g.snapshot();
            if snapshot.backfill.is_some() {
                assert!(
                    display_delta_full(&deltas).is_none(),
                    "step {step}: no display delta may leak mid-replay"
                );
                assert_display_invariants(&g);
                continue;
            }
            for delta in &deltas {
                shadow.apply(delta);
            }
            let section = snapshot.display.expect("display section");
            assert_eq!(
                shadow.members.iter().copied().collect::<Vec<_>>(),
                section.members,
                "step {step}: delta-replayed membership diverged from the snapshot"
            );
            // What a client connecting right now would receive, by id.
            let fresh: std::collections::BTreeMap<u64, &Cell> = snapshot
                .cells
                .iter()
                .chain(section.residents.iter())
                .map(|cell| (cell.id, cell))
                .collect();
            for id in &section.members {
                let held = shadow.resolve(*id).unwrap_or_else(|| {
                    panic!("step {step}: staged member {id} resolves to no record on a client that followed every delta")
                });
                assert_eq!(
                    Some(held),
                    fresh.get(id).copied(),
                    "step {step}: member {id}'s replayed record diverged from the one a fresh connect is handed"
                );
            }
            assert_display_invariants(&g);
        }
    }

    /// Pin 7 (⭐) — replay consistency (invariant I5), prefix mode.
    #[test]
    fn display_deltas_replay_to_snapshot_membership() {
        assert_display_replay_consistency(display_scenario());
    }

    /// Pin 7b (⭐) — replay consistency (invariant I5), composed mode:
    /// the shadow additionally ingests `enter_cells` residents and the
    /// residents section must replay exactly across refresh, dedup,
    /// D5 collision, reorg-above-anchor, degrade, and rebuild.
    #[test]
    fn display_deltas_replay_to_snapshot_membership_composed() {
        assert_display_replay_consistency(composed_display_scenario());
    }

    /// Pin 8 — determinism: the same mutation sequence produces byte-identical
    /// display deltas and sections across runs (HashMap drain orders in
    /// canonical code must never reach the display wire) — in both modes.
    #[test]
    fn display_membership_is_deterministic_across_identical_runs() {
        let run = |scenario: fn() -> Vec<Mutation>| {
            let mut g = make_galaxy();
            let mut wire: Vec<String> = Vec::new();
            for mutation in scenario() {
                for delta in g.apply_mutation(&mutation) {
                    if matches!(delta, CellDelta::Display { .. }) {
                        wire.push(serde_json::to_string(&delta).expect("serialize delta"));
                    }
                }
                wire.push(
                    serde_json::to_string(&g.snapshot().display.expect("section"))
                        .expect("serialize section"),
                );
            }
            wire
        };
        assert_eq!(run(display_scenario), run(display_scenario));
        assert_eq!(
            run(composed_display_scenario),
            run(composed_display_scenario)
        );
    }

    /// Pin 10 — the reservoir mutation arm end-to-end: refresh
    /// transition with resident payloads + Composed provenance; a
    /// content-identical record at a fresher anchor is a FULL no-op; a
    /// rollback at the anchor coalesces its canonical exits with the
    /// degrade transition (mode back to Canonical) in ONE delta; and the
    /// dedup re-arms afterwards.
    #[test]
    fn display_reservoir_refresh_dedups_degrades_and_rearms() {
        let mut g = make_galaxy();
        g.apply_mutation(&mined(1, "0xb1", 1_000));
        g.apply_mutation(&landed(
            "0xa",
            1,
            1_000,
            vec![],
            vec![out(1, "0x"), out(2, "0x")],
        ));

        // Refresh transition: canonical members stay, residents enter
        // with payloads, provenance flips to Composed with the record's
        // anchor + clock.
        let deltas = g.apply_mutation(&reservoir(1, (500_000, 500_001, 500_002)));
        let (enter_ids, enter_cells, exit, provenance) =
            display_delta_full(&deltas).expect("refresh transition delta");
        assert!(
            enter_ids.is_empty(),
            "canonical members were already staged"
        );
        assert_eq!(
            enter_cells.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![500_000, 500_001, 500_002]
        );
        assert!(exit.is_empty());
        let provenance = provenance.expect("mode transition rides provenance");
        assert_eq!(provenance.mode, DisplayMode::Composed);
        assert_eq!(provenance.source.as_deref(), Some("ckbadger"));
        assert_eq!(provenance.as_of.as_ref().map(|a| a.block), Some(1));
        assert_eq!(provenance.updated_at_ms, 1_000);
        let section = g.snapshot().display.expect("section");
        assert_eq!(section.members, vec![0, 1, 500_000, 500_001, 500_002]);
        assert_eq!(
            section.residents.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![500_000, 500_001, 500_002]
        );
        assert_eq!(section.provenance.mode, DisplayMode::Composed);
        assert_display_invariants(&g);

        // Content-identical revalidation at a fresher anchor: FULL no-op
        // — no delta, provenance (anchor included) frozen.
        let deltas = g.apply_mutation(&reservoir(2, (500_000, 500_001, 500_002)));
        assert_eq!(
            display_delta_count(&deltas),
            0,
            "content dedup emits nothing"
        );
        let section = g.snapshot().display.expect("section");
        assert_eq!(section.provenance.as_of.as_ref().map(|a| a.block), Some(1));
        assert_eq!(section.provenance.updated_at_ms, 1_000);

        // Rollback at the anchor: the parked canonical members AND the
        // dropped residents exit in ONE coalesced delta riding
        // mode-Canonical provenance.
        let deltas = g.apply_mutation(&Mutation::ChainReorganized { from_block: 1 });
        let (enter_ids, enter_cells, exit, provenance) =
            display_delta_full(&deltas).expect("degrade delta");
        assert!(enter_ids.is_empty() && enter_cells.is_empty());
        assert_eq!(exit, &vec![0, 1, 500_000, 500_001, 500_002]);
        let provenance = provenance.expect("degrade rides provenance");
        assert_eq!(provenance.mode, DisplayMode::Canonical);
        assert_eq!(provenance.source, None);
        assert_eq!(provenance.as_of, None);
        assert!(g.snapshot().display.expect("section").residents.is_empty());
        assert_display_invariants(&g);

        // Re-arm: the SAME content applies again after the degrade.
        let deltas = g.apply_mutation(&reservoir(5, (500_000, 500_001, 500_002)));
        let (_, enter_cells, _, provenance) =
            display_delta_full(&deltas).expect("re-armed refresh applies");
        assert_eq!(enter_cells.len(), 3);
        assert_eq!(
            provenance
                .expect("mode transition")
                .as_of
                .as_ref()
                .map(|a| a.block),
            Some(5)
        );
        assert_display_invariants(&g);
    }

    /// T2 — the sink survives the whole projection path: a reservoir
    /// arriving as an ordinary mutation makes the display plane publish
    /// what it is short of, and a degrade takes it back to silence.
    #[test]
    fn composition_demand_reaches_the_sink_through_apply_mutation() {
        let sink = Arc::new(CompositionDemandSink::new());
        let mut g = CellGalaxy::new().with_composition_demand_sink(sink.clone());
        g.apply_mutation(&mined(1, "0xb1", 1_000));
        g.apply_mutation(&landed(
            "0xa",
            1,
            1_000,
            vec![],
            vec![out(1, "0x"), out(2, "0x")],
        ));
        assert_eq!(
            sink.read(),
            CompositionDemand::default(),
            "prefix staffing asks for nothing"
        );

        // Three residents against the curated field — the 12,000-cell
        // budget less the recency window's 1,200 — so the shortfall is
        // almost the entire quota of 2160/7560/1080.
        g.apply_mutation(&reservoir(1, (500_000, 500_001, 500_002)));
        let demand = sink.read();
        assert!(demand.curated);
        assert_eq!(demand.dao, 2_160 - 1, "one dao staged of the field's 2160");
        assert_eq!(demand.typed, 7_560 - 3, "one resident + the two canonical");

        g.apply_mutation(&Mutation::ChainReorganized { from_block: 1 });
        assert_eq!(
            sink.read(),
            CompositionDemand::default(),
            "a degraded stage has nobody to satisfy"
        );
    }

    /// T1 — the ONLY way the server can learn a staged resident died:
    /// a tx input the canonical outpoint index cannot resolve. The
    /// resident must exit within that same mutation, and canonical truth
    /// must not move an inch (invariant I2 — no Death delta, no counter).
    #[test]
    fn display_resident_spend_exits_without_touching_canonical_truth() {
        let mut g = make_galaxy();
        g.apply_mutation(&mined(1, "0xb1", 1_000));
        g.apply_mutation(&landed(
            "0xa",
            1,
            1_000,
            vec![],
            vec![out(1, "0x"), out(2, "0x")],
        ));
        g.apply_mutation(&reservoir(1, (500_000, 500_001, 500_002)));
        let section = g.snapshot().display.expect("section");
        assert_eq!(section.members, vec![0, 1, 500_000, 500_001, 500_002]);
        let deaths_before = g.snapshot().total_deaths;
        let cells_before: Vec<u64> = g.cells.iter().map(|c| c.id).collect();

        // A block spends the typed resident's outpoint. The index misses
        // (the cell was never in the retained map) — before T1 this was
        // simply skipped and the resident haunted the stage until the
        // next 15-minute refresh.
        g.apply_mutation(&mined(2, "0xb2", 2_000));
        let deltas = g.apply_mutation(&landed(
            "0xspend",
            2,
            2_000,
            vec![op("0xr500001", 0)],
            vec![],
        ));
        let (enter_ids, enter_cells, exit_ids, provenance) =
            display_delta_full(&deltas).expect("the spend exits the resident");
        assert_eq!(exit_ids, &vec![500_001]);
        assert!(enter_ids.is_empty() && enter_cells.is_empty());
        assert!(provenance.is_none(), "membership change, not a mode change");
        assert!(
            !deltas
                .iter()
                .any(|d| matches!(d, CellDelta::Death { .. } | CellDelta::Birth { .. })),
            "an off-map spend is not canonical news: {deltas:?}"
        );
        assert_eq!(
            g.snapshot().total_deaths,
            deaths_before,
            "the death counter belongs to canonical truth alone"
        );
        assert_eq!(
            g.cells.iter().map(|c| c.id).collect::<Vec<_>>(),
            cells_before,
            "the canonical map is untouched"
        );

        let section = g.snapshot().display.expect("section");
        assert_eq!(section.members, vec![0, 1, 500_000, 500_002]);
        assert_eq!(
            section.residents.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![500_000, 500_002]
        );
        assert_eq!(
            section.provenance.mode,
            DisplayMode::Composed,
            "one spent sample does not degrade the composition"
        );
        assert_display_invariants(&g);

        // Replaying it (a reorg re-landing the same tx) stays a no-op.
        let deltas = g.apply_mutation(&landed(
            "0xspend",
            2,
            2_000,
            vec![op("0xr500001", 0)],
            vec![],
        ));
        assert_eq!(display_delta_count(&deltas), 0);
        assert_display_invariants(&g);
    }

    /// Pin 11 — a refresh landing mid-replay stays silent and the
    /// terminal resettle presents it whole: canonical and resident enters
    /// alike ride enter_cells with their records (a client that sat
    /// through the replay was told nothing until now, so the resettle is
    /// the only thing it has), Composed provenance rides the resettle.
    #[test]
    fn display_reservoir_refresh_during_backfill_lands_at_the_resettle() {
        let mut g = make_galaxy();
        g.apply_mutation(&Mutation::BackfillProgress {
            done: 0,
            total: 2,
            active: true,
            phase: ReplayPhase::Boot,
        });
        g.apply_mutation(&mined(1, "0xb1", 1_000));
        g.apply_mutation(&landed(
            "0xa",
            1,
            1_000,
            vec![],
            vec![out(1, "0x"), out(2, "0x")],
        ));
        let deltas = g.apply_mutation(&reservoir(1, (500_000, 500_001, 500_002)));
        assert_eq!(display_delta_count(&deltas), 0, "silent during replay");

        let terminal = g.apply_mutation(&Mutation::BackfillProgress {
            done: 2,
            total: 2,
            active: false,
            phase: ReplayPhase::Boot,
        });
        let (enter_ids, enter_cells, exit, provenance) =
            display_delta_full(&terminal).expect("terminal resettle");
        assert!(enter_ids.is_empty(), "no enter leaves as a bare id");
        assert_eq!(
            enter_cells.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![0, 1, 500_000, 500_001, 500_002]
        );
        assert!(exit.is_empty());
        assert_eq!(
            provenance.expect("resettle announces the mode").mode,
            DisplayMode::Composed
        );
        assert_display_invariants(&g);
    }

    /// Display state is rebuilt from the restored map on load — resting
    /// prefix in insertion order, no delta, snapshot immediately staffed.
    #[test]
    fn display_rebuilds_from_restored_state_without_deltas() {
        let mut g = make_galaxy();
        g.apply_mutation(&landed(
            "0xa",
            1,
            1_000,
            vec![],
            vec![out(1, "0x"), out(2, "0x")],
        ));
        g.apply_mutation(&landed(
            "0xb",
            2,
            2_000,
            vec![op("0xa", 0)],
            vec![out(3, "0x")],
        ));

        let mut restored = make_galaxy();
        restored.load(g.save()).expect("load");
        let section = restored.snapshot().display.expect("post-load fill");
        assert_eq!(section.members, g.display.member_ids_sorted());
        assert_display_invariants(&restored);
        // The plane starts a fresh first-fill epoch only for the wire —
        // no delta is owed for the bootstrap itself.
        let deltas = restored.apply_mutation(&Mutation::CellTagged {
            out_point: op("0xa", 1),
            tag: "dex".into(),
            at: 3_000,
        });
        assert_eq!(display_delta_count(&deltas), 0);
    }

    /// Emission serves `pos_seed` as stored instead of recomputing it, which
    /// is only safe while every path that can produce a Cell derives it. This
    /// walks the ones that exist — birth, reorg revival, restore of a
    /// deliberately stale workdir, and a composed resident — and requires
    /// what reaches the wire to equal the derivation on all three surfaces
    /// (JSON cells, link anchors, columnar column).
    #[test]
    fn emitted_positions_are_the_derived_ones() {
        let mut g = make_galaxy();
        g.apply_mutation(&landed(
            "0xa",
            1,
            1_000,
            vec![],
            vec![out(1, "0x"), out(2, "0x")],
        ));
        g.apply_mutation(&landed(
            "0xb",
            2,
            2_000,
            vec![op("0xa", 0)],
            vec![out(3, "0x")],
        ));
        g.apply_mutation(&reservoir(2, (900, 901, 902)));

        // A workdir written by an older layout: every stored copy is wrong
        // until the restore refreshes it.
        let mut persisted = g.to_persisted();
        for cell in &mut persisted.cells {
            cell.pos_seed = [-1.0, -2.0, -3.0];
        }
        for link in &mut persisted.recent_links {
            for anchor in &mut link.endpoint_anchors {
                anchor.pos_seed = [-1.0, -2.0, -3.0];
            }
        }
        let mut restored = make_galaxy();
        restored.restore_from(persisted);
        restored.apply_mutation(&reservoir(2, (900, 901, 902)));

        for galaxy in [&g, &restored] {
            let snapshot = galaxy.snapshot();
            assert!(!snapshot.cells.is_empty());
            for cell in &snapshot.cells {
                assert_eq!(cell.pos_seed, helix_seed_for(cell.id), "cell {}", cell.id);
            }
            for link in &snapshot.recent_links {
                for anchor in &link.endpoint_anchors {
                    assert_eq!(anchor.pos_seed, helix_seed_for(anchor.id));
                }
            }
            let display = snapshot.display.as_ref().expect("display section");
            assert!(!display.residents.is_empty());
            for resident in &display.residents {
                assert_eq!(resident.pos_seed, helix_seed_for(resident.id));
            }

            // …and the columnar columns, which read the same stored field.
            let bytes = galaxy.snapshot_bin().expect("columnar snapshot");
            // v2 rows are canonical cells then residents, with the member id
            // list sitting between the f64 block and the positions.
            let n = snapshot.cells.len() + display.residents.len();
            let base = crate::projection::cells_columnar::CELLS_COLUMNAR_HEADER_BYTES
                + 4 * 8 * n
                + 8 * display.members.len();
            for (row, cell) in snapshot.cells.iter().chain(&display.residents).enumerate() {
                let expected = helix_seed_for(cell.id);
                for (axis, want) in expected.iter().enumerate() {
                    let at = base + (axis * n + row) * 4;
                    let got = f32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
                    assert_eq!(got, *want, "cell {} axis {axis}", cell.id);
                }
            }
        }
    }

    /// A galaxy whose retained set is strictly larger than its stage. The
    /// production plane holds 12k, so a test that wants off-stage rows either
    /// mints 12k cells or shrinks the stage; shrinking is the honest one,
    /// because the ratio is what matters, not the absolute size.
    fn galaxy_with_offstage_rows(mut g: CellGalaxy) -> CellGalaxy {
        g.display = DisplayPlane::with_limits(
            DisplayBudget {
                cells: 2,
                nerve_edges: 8,
            },
            1,
            0,
        );
        g.apply_mutation(&landed(
            "0xa",
            1,
            1_000,
            vec![],
            vec![out(1, "0x"), out(2, "0x"), out(3, "0x")],
        ));
        g.apply_mutation(&landed(
            "0xb",
            2,
            2_000,
            vec![],
            vec![out(4, "0x"), out(5, "0x")],
        ));
        g
    }

    /// The reduction itself: a snapshot drops retained rows nobody stages.
    #[test]
    fn a_snapshot_ships_only_what_the_stage_holds() {
        let g = galaxy_with_offstage_rows(make_galaxy());
        let snap = g.snapshot();
        assert!(
            snap.cells.len() < g.cells.len(),
            "the emitted set must be smaller than the retained one (kept {} of {})",
            snap.cells.len(),
            g.cells.len()
        );
        for cell in &snap.cells {
            assert!(
                g.display.is_staged(cell.id),
                "cell {} shipped without being on stage",
                cell.id
            );
        }
    }

    /// The invariant a client depends on: every member resolves, from the
    /// emitted rows or from the resident payloads, with nothing left dangling.
    #[test]
    fn every_member_resolves_from_rows_or_residents() {
        let g = galaxy_with_offstage_rows(make_galaxy());
        let snap = g.snapshot();
        let section = snap.display.as_ref().expect("display section");
        let emitted: std::collections::HashSet<u64> = snap.cells.iter().map(|c| c.id).collect();
        let residents: std::collections::HashSet<u64> =
            section.residents.iter().map(|c| c.id).collect();
        assert!(!section.members.is_empty(), "the stage must be staffed");
        for id in &section.members {
            assert!(
                emitted.contains(id) || residents.contains(id),
                "member {id} resolves to neither an emitted row nor a resident"
            );
        }
    }

    /// The statistics segment describes the galaxy, not the rows that ship.
    /// Without this the panel would quietly start reporting the stage.
    #[test]
    fn statistics_describe_the_galaxy_not_the_rows_that_ship() {
        let g = galaxy_with_offstage_rows(make_galaxy());
        let snap = g.snapshot();
        let alive = g.cells.iter().filter(|c| c.death_at_ms.is_none()).count();
        assert_eq!(snap.stats.in_view as usize, alive);
        assert!(
            snap.stats.in_view as usize > snap.cells.len(),
            "the fixture must count more cells than it ships, or this proves nothing"
        );
    }

    /// The two wire forms must agree on which rows ride along; a client that
    /// boots from the columnar buffer and one that boots from JSON otherwise
    /// start from different galaxies.
    #[test]
    fn both_wire_forms_ship_the_same_rows() {
        let g = galaxy_with_offstage_rows(make_galaxy());
        let snap = g.snapshot();
        let bin = g.snapshot_bin().expect("columnar snapshot");
        // cell_count sits at byte 40 (residents 44, members 48).
        let cell_count = u32::from_le_bytes(bin[40..44].try_into().unwrap()) as usize;
        let members = u32::from_le_bytes(bin[48..52].try_into().unwrap()) as usize;
        let residents = u32::from_le_bytes(bin[44..48].try_into().unwrap()) as usize;
        let section = snap.display.as_ref().expect("display section");
        assert_eq!(cell_count, snap.cells.len());
        assert_eq!(members, section.members.len());
        assert_eq!(residents, section.residents.len());
    }

    /// Pin 9, inverted for v2 — the columnar snapshot now carries the
    /// display plane, so staffing it has to move the bytes. v1 asserted the
    /// opposite; a client that reads membership out of the binary form
    /// would silently keep a stale stage forever if this stopped holding.
    #[test]
    fn snapshot_bin_carries_the_display_section() {
        let mut g = make_galaxy();
        g.apply_mutation(&landed(
            "0xa",
            1,
            1_000,
            vec![],
            vec![out(1, "0x"), out(2, "0x")],
        ));
        let before = g.snapshot_bin().expect("columnar snapshot");

        g.apply_mutation(&reservoir(1, (900, 901, 902)));
        let after = g.snapshot_bin().expect("columnar snapshot");
        assert_ne!(before, after, "a composed stage must reach the binary form");

        let section = g.snapshot().display.expect("display section");
        let residents = u32::from_le_bytes(after[44..48].try_into().unwrap()) as usize;
        let members = u32::from_le_bytes(after[48..52].try_into().unwrap()) as usize;
        assert_eq!(residents, section.residents.len());
        assert_eq!(members, section.members.len());
        assert_eq!(
            after[60],
            crate::projection::cells_columnar::CELLS_COLUMNAR_DISPLAY_COMPOSED
        );
    }

    /// One galaxy, both wire forms, committed side by side. The Rust test
    /// below only pins that these bytes are what this binary produces; the
    /// gate that matters is on the TS side, where the binary form is decoded
    /// through the real decode path and field-diffed against the JSON one.
    /// An encoder-vs-encoder test (the one below this) cannot see a column
    /// the decoder never reads — that is how the missing script columns
    /// survived a green suite.
    ///
    /// Regenerate both with
    /// `CKNERV_REGEN_FIXTURES=1 cargo test -p cknerv-core columnar_v6`.
    #[test]
    fn columnar_v6_pair_describes_one_galaxy_in_both_wire_forms() {
        use crate::outpoint::DATA_HEX_TRUNCATION_MARKER;
        use crate::projection::cells_columnar::{
            assert_matches_fixture, assert_matches_text_fixture,
        };

        let lock = crate::ScriptId::parse(
            "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
            "type",
        )
        .expect("well-formed lock code hash");
        let type_script = crate::ScriptId::parse(
            "0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95",
            "data1",
        )
        .expect("well-formed type code hash");
        // Synthetic code hashes: the well-known ones are the CKB adapter's to
        // know, and what has to cross here is the CODE, not the identity.
        let script = |byte: u8, hash_type: &str| {
            crate::ScriptId::parse(
                &format!("0x{:064x}", u128::from(byte) * 0x0101_0101),
                hash_type,
            )
            .expect("well-formed code hash")
        };

        let mut g = make_galaxy();
        // Lock-only, lock+type sharing that lock, and a cell with no script
        // identity at all — the three shapes the ref column has to spell.
        let mut lock_only = out(61_00000000, "0x");
        lock_only.lock_kind = LockKind::Sighash;
        lock_only.lock_script = lock;
        // Upstream-truncated data, so the marker rides the string blob here
        // too and a non-ASCII one would take the whole gate down.
        let mut lock_and_type = out(
            120_00000000,
            &format!("0xdeadbeef{DATA_HEX_TRUNCATION_MARKER}"),
        );
        lock_and_type.lock_kind = LockKind::Sighash;
        lock_and_type.asset_kind = AssetKind::Xudt;
        lock_and_type.lock_script = lock;
        lock_and_type.type_script = Some(type_script);
        lock_and_type.type_shape_seed = Some([0x50bd_8d66, 0x80b8_b9cf]);
        let unidentified = out(90_00000000, "0xbeef");
        // One cell per enum code the three shapes above do not reach. Every
        // lock kind, asset kind and hash type has to CROSS the boundary: a
        // code the decoder's table does not hold is now a decode error, and
        // an unpinned code is exactly the one a reordering would break in
        // silence. The assertions below hold this sample total.
        let mut multisig_sudt = out(70_00000000, "0x01");
        multisig_sudt.lock_kind = LockKind::Multisig;
        multisig_sudt.asset_kind = AssetKind::Sudt;
        multisig_sudt.lock_script = script(0x11, "data");
        multisig_sudt.type_script = Some(script(0x22, "data"));
        multisig_sudt.type_shape_seed = Some([0x2222_2222, 0x2222_2222]);
        let mut acp_spore = out(75_00000000, "0x02");
        acp_spore.lock_kind = LockKind::Acp;
        acp_spore.asset_kind = AssetKind::Spore;
        acp_spore.lock_script = script(0x33, "data2");
        acp_spore.type_script = Some(script(0x44, "data2"));
        acp_spore.type_shape_seed = Some([0x4444_4444, 0x4444_4444]);
        // Kinship has to cross the boundary too, and the shape that matters is
        // two cells of DIFFERENT asset kinds sharing one seed: on mainnet that
        // is a Spore Cluster container and a spore inside it, which is the one
        // case a per-kind encoding would quietly get wrong.
        acp_spore.collection_seed = Some([0xc0_11ec_71, 0x0_1dee_d5]);
        // Native means "no type script", so this one says its kind and
        // carries nothing to say it with — which is the pairing the wire has
        // to keep separable from a cell with no identity at all.
        let mut omnilock_native = out(66_00000000, "0x");
        omnilock_native.lock_kind = LockKind::Omnilock;
        omnilock_native.asset_kind = AssetKind::Native;
        omnilock_native.lock_script = script(0x55, "type");
        // The two youngest asset codes. Appended after the cells above so the
        // outpoint indices tx2 spends stay where they were.
        let mut sighash_object = out(72_00000000, "0x03");
        sighash_object.lock_kind = LockKind::Sighash;
        sighash_object.asset_kind = AssetKind::Object;
        sighash_object.lock_script = lock;
        sighash_object.type_script = Some(script(0x66, "data1"));
        sighash_object.type_shape_seed = Some([0x6666_6666, 0x6666_6666]);
        sighash_object.collection_seed = Some([0xc0_11ec_71, 0x0_1dee_d5]);
        let mut sighash_identity = out(73_00000000, "0x04");
        sighash_identity.lock_kind = LockKind::Sighash;
        sighash_identity.asset_kind = AssetKind::Identity;
        sighash_identity.lock_script = lock;
        sighash_identity.type_script = Some(script(0x77, "type"));
        sighash_identity.type_shape_seed = Some([0x7777_7777, 0x7777_7777]);
        g.apply_mutation(&landed(
            "0xtx1",
            7,
            1_000,
            vec![],
            vec![
                lock_only,
                lock_and_type,
                unidentified,
                multisig_sudt,
                acp_spore,
                omnilock_native,
                sighash_object,
                sighash_identity,
            ],
        ));
        g.apply_mutation(&Mutation::CellTagged {
            out_point: op("0xtx1", 0),
            tag: "wallet".into(),
            at: 1_100,
        });
        // A death, so the binary form's NaN and the JSON form's null have to
        // agree about the same cell. The second input was never retained, so
        // the same tx also carries an identity-only anchor — the tail's
        // `recent_links` must spell `resolved` on both kinds or the browser
        // reads a derived anchor as consumed evidence.
        g.apply_mutation(&landed(
            "0xtx2",
            8,
            2_000,
            vec![op("0xtx1", 2), op("0xcold", 1)],
            vec![out(80_00000000, "0x")],
        ));
        // Residents ride behind the canonical rows; script them too, or the
        // gate would only prove the columns work for the first block.
        let mut record = reservoir_record(8, (900, 901, 902));
        record.dao[0].lock_script = lock;
        record.typed[0].lock_script = lock;
        record.typed[0].type_script = Some(type_script);
        record.typed[0].type_shape_seed = Some([0x50bd_8d66, 0x80b8_b9cf]);
        g.apply_mutation(&Mutation::GalaxyReservoirReplaced { record });
        g.apply_mutation(&mined(8, "0xblock8", 2_100));

        // Total by construction: a new variant fails to COMPILE here, and
        // then fails the set assertion below until a cell above carries it.
        // These names are the wire spellings, which is what the TS decoder's
        // `COLUMNAR_*` tables hold at the matching index.
        fn lock_kind_name(kind: LockKind) -> &'static str {
            match kind {
                LockKind::Sighash => "sighash",
                LockKind::Multisig => "multisig",
                LockKind::Acp => "acp",
                LockKind::Omnilock => "omnilock",
                LockKind::Other => "other",
            }
        }
        fn asset_kind_name(kind: AssetKind) -> &'static str {
            match kind {
                AssetKind::Native => "native",
                AssetKind::Sudt => "sudt",
                AssetKind::Xudt => "xudt",
                AssetKind::Dao => "dao",
                AssetKind::Spore => "spore",
                AssetKind::Other => "other",
                AssetKind::Object => "object",
                AssetKind::Identity => "identity",
            }
        }
        fn hash_type_name(hash_type: crate::HashType) -> &'static str {
            match hash_type {
                crate::HashType::Data => "data",
                crate::HashType::Type => "type",
                crate::HashType::Data1 => "data1",
                crate::HashType::Data2 => "data2",
            }
        }

        let snapshot = g.snapshot();
        let rows: Vec<&Cell> = snapshot
            .cells
            .iter()
            .chain(snapshot.display.iter().flat_map(|d| d.residents.iter()))
            .collect();
        let named = |mut have: Vec<&'static str>| {
            have.sort_unstable();
            have.dedup();
            have
        };
        assert_eq!(
            named(rows.iter().map(|c| lock_kind_name(c.lock_kind)).collect()),
            named(vec!["sighash", "multisig", "acp", "omnilock", "other"]),
            "every LockKind code must ride this fixture across the boundary"
        );
        assert_eq!(
            named(rows.iter().map(|c| asset_kind_name(c.asset_kind)).collect()),
            named(vec![
                "native", "sudt", "xudt", "dao", "spore", "other", "object", "identity"
            ]),
            "every AssetKind code must ride this fixture across the boundary"
        );
        assert_eq!(
            named(
                rows.iter()
                    .flat_map(|c| [Some(c.lock_script).filter(|s| !s.is_unset()), c.type_script])
                    .flatten()
                    .map(|s| hash_type_name(s.hash_type))
                    .collect()
            ),
            named(vec!["data", "type", "data1", "data2"]),
            "every HashType code must ride this fixture's script dictionary"
        );

        let json = serde_json::to_string_pretty(&snapshot).expect("serialize snapshot");
        assert_matches_text_fixture("cells_columnar_v6_pair.json", &json);
        assert_matches_fixture(
            "cells_columnar_v6_pair.bin",
            &g.snapshot_bin().expect("columnar snapshot"),
        );
    }

    /// The columnar path must not go through `CellGalaxySnapshot` — that is
    /// the whole point of taking rows by reference — but it must still emit
    /// exactly what that path would have. Row-for-row equality against a
    /// materialized snapshot keeps both true at once.
    #[test]
    fn snapshot_bin_matches_the_rows_of_the_json_snapshot() {
        let mut g = make_galaxy();
        g.apply_mutation(&landed(
            "0xa",
            1,
            1_000,
            vec![],
            vec![out(1, "0x"), out(2, "0xdeadbeef")],
        ));
        g.apply_mutation(&Mutation::CellTagged {
            out_point: op("0xa", 0),
            tag: "dex".into(),
            at: 1_100,
        });
        let snapshot = g.snapshot();
        assert_eq!(
            g.snapshot_bin().expect("columnar snapshot"),
            crate::projection::cells_columnar::encode_cells_columnar(
                &snapshot.cells,
                crate::projection::cells_columnar::CellsColumnarHeader {
                    last_pulse_at_ms: snapshot.last_pulse_at_ms,
                    total_births: snapshot.total_births,
                    total_deaths: snapshot.total_deaths,
                },
                Some(&g.display.columnar_view()),
                crate::projection::cells_columnar::CellsColumnarTail {
                    recent_links: &snapshot.recent_links,
                    backfill: snapshot.backfill,
                    stats: snapshot.stats,
                },
            )
        );
    }

    // ── the compositional gate: a snapshot and the deltas after it ────

    /// A stream frame's payload, as the runner ships it: several deltas can
    /// share one revision (a tx births, kills and restages in one go).
    #[derive(Serialize)]
    struct FixtureDelta {
        revision: u64,
        delta: CellDelta,
    }

    /// The member whose record exists on a client for one reason only:
    /// its enter carried it. Named in the fixture so the TS twin asserts
    /// the same two cells this side does.
    #[derive(Serialize)]
    struct FixtureWitness {
        id: u64,
        death_at_ms: u64,
    }

    #[derive(Serialize)]
    struct FixtureWitnesses {
        /// Staged by its own spend — an ordinary block's activity endpoint,
        /// older than the connect that never carried it.
        corpse: FixtureWitness,
        /// Staged ALIVE by a vacancy refill, spent blocks later: the death
        /// has to reach a record the canonical lane never delivered.
        refilled: FixtureWitness,
    }

    #[derive(Serialize)]
    struct StagedRecordsFixture {
        revision: u64,
        snapshot: CellGalaxySnapshot,
        deltas: Vec<FixtureDelta>,
        /// What a client connecting after the last delta is handed. A
        /// follower of the deltas must hold exactly this.
        final_revision: u64,
        final_snapshot: CellGalaxySnapshot,
        witnesses: FixtureWitnesses,
    }

    /// ⭐ The gate R1 left open: **a snapshot plus the deltas that follow
    /// it keeps every staged member resolvable.**
    ///
    /// Since snapshots carry the stage rather than the retained map, a
    /// client's records are staged-at-connect ∪ what the wire hands it
    /// after. This scenario stages cells that were in neither — the two
    /// `witnesses` — through the paths every mainnet block uses, and pins
    /// that a delta follower ends up holding what a fresh connect is
    /// handed. The fixture it writes is replayed by the TS reducer in
    /// `packages/cache/__tests__/stagedRecords.test.ts`, so the claim is
    /// checked against the real client, not a Rust idea of one.
    ///
    /// Regenerate with
    /// `CKNERV_REGEN_FIXTURES=1 cargo test -p cknerv-core staged_records`.
    #[test]
    fn staged_records_survive_a_snapshot_and_the_deltas_after_it() {
        use crate::projection::cells_columnar::assert_matches_text_fixture;

        // A stage smaller than the map — mainnet's ordinary shape.
        let mut g = CellGalaxy::with_display_limits(
            DisplayBudget {
                cells: 8,
                nerve_edges: 8,
            },
            4,
            0,
        );

        // Block 1: ten cells, eight seats. Two of these never reach the
        // stage, so no snapshot from here on carries them.
        g.apply_mutation(&mined(1, "0xblock1", 1_000));
        let outs: Vec<TxOutputInfo> = (0..10).map(|i| out(100 + i, "0x")).collect();
        g.apply_mutation(&landed("0xa", 1, 1_000, vec![], outs));

        // The client connects here.
        let connect_revision = 2;
        let snapshot = g.snapshot();
        let staged_at_connect: std::collections::BTreeSet<u64> = snapshot
            .display
            .as_ref()
            .expect("display section")
            .members
            .iter()
            .copied()
            .collect();
        let unstaged: Vec<u64> = (0..10)
            .filter(|id| !staged_at_connect.contains(id))
            .collect();
        assert_eq!(
            unstaged.len(),
            2,
            "the scenario needs cells the connect snapshot never carried"
        );
        let corpse = unstaged[0];
        let refilled = unstaged[1];
        let mut shadow = ShadowClient::connect(&snapshot);
        assert!(
            shadow.resolve(corpse).is_none() && shadow.resolve(refilled).is_none(),
            "the witnesses must be strangers to this client"
        );

        let mut deltas: Vec<FixtureDelta> = Vec::new();
        let mut revision = connect_revision;
        let step = |g: &mut CellGalaxy,
                    shadow: &mut ShadowClient,
                    deltas: &mut Vec<FixtureDelta>,
                    revision: &mut u64,
                    mutation: Mutation| {
            *revision += 1;
            for delta in g.apply_mutation(&mutation) {
                shadow.apply(&delta);
                deltas.push(FixtureDelta {
                    revision: *revision,
                    delta,
                });
            }
            // Every step, the whole claim: a delta follower holds what a
            // fresh connect would be handed.
            let fresh = g.snapshot();
            let section = fresh.display.as_ref().expect("display section");
            assert_eq!(
                shadow.members.iter().copied().collect::<Vec<_>>(),
                section.members,
                "revision {revision}: membership diverged"
            );
            let handed: std::collections::BTreeMap<u64, &Cell> = fresh
                .cells
                .iter()
                .chain(section.residents.iter())
                .map(|cell| (cell.id, cell))
                .collect();
            for id in &section.members {
                let held = shadow.resolve(*id).unwrap_or_else(|| {
                    panic!("revision {revision}: staged member {id} resolves to no record")
                });
                assert_eq!(Some(held), handed.get(id).copied());
            }
        };

        // Block 2: a transaction spends the first stranger. Its death and
        // its staging are the same mutation — the corpse arrives already
        // dead, which is the only reason its death rite can run at all.
        step(
            &mut g,
            &mut shadow,
            &mut deltas,
            &mut revision,
            mined(2, "0xblock2", 2_000),
        );
        step(
            &mut g,
            &mut shadow,
            &mut deltas,
            &mut revision,
            landed(
                "0xb",
                2,
                2_000,
                vec![op("0xa", corpse as u32)],
                vec![out(200, "0x")],
            ),
        );
        assert!(shadow.members.contains(&corpse), "the spend staged it");
        assert_eq!(
            shadow.resolve(corpse).expect("corpse record").death_at_ms,
            Some(2_000),
            "a corpse the client learned of on its enter still has to be dead"
        );

        // Block 3: kill every cell the recency window ranks AHEAD of the
        // strangers. The window refills youngest-first, so the second
        // stranger — the oldest cell in the map — is reachable only once
        // nothing younger is left off stage. Killing them opens the seats
        // and empties the queue in front of it at the same time.
        step(
            &mut g,
            &mut shadow,
            &mut deltas,
            &mut revision,
            mined(3, "0xblock3", 3_000),
        );
        let ahead: Vec<OutPoint> = (0..corpse).map(|i| op("0xa", i as u32)).collect();
        step(
            &mut g,
            &mut shadow,
            &mut deltas,
            &mut revision,
            landed("0xc", 3, 3_000, ahead, vec![out(300, "0x")]),
        );

        // Block 4: past the corpse hold, so the GC sweep runs and the
        // window refills — with the second stranger, alive.
        step(
            &mut g,
            &mut shadow,
            &mut deltas,
            &mut revision,
            mined(4, "0xblock4", 8_000),
        );
        assert!(
            shadow.members.contains(&refilled),
            "the vacancy refill staged the second stranger"
        );
        assert_eq!(
            shadow
                .resolve(refilled)
                .expect("refilled record")
                .death_at_ms,
            None
        );

        // Block 5: spend it. Nothing but the `death` delta says so, and the
        // only copy of that record came in on a display enter.
        step(
            &mut g,
            &mut shadow,
            &mut deltas,
            &mut revision,
            mined(5, "0xblock5", 9_000),
        );
        step(
            &mut g,
            &mut shadow,
            &mut deltas,
            &mut revision,
            landed(
                "0xd",
                5,
                9_000,
                vec![op("0xa", refilled as u32)],
                vec![out(500, "0x")],
            ),
        );
        assert_eq!(
            shadow
                .resolve(refilled)
                .expect("refilled record")
                .death_at_ms,
            Some(9_000),
            "the death has to reach a record the canonical lane never sent"
        );

        // Block 6: composed mode — residents arrive with their payloads and
        // canonical members are promoted into curated seats. The third way
        // a cell reaches the stage without a birth of its own.
        step(
            &mut g,
            &mut shadow,
            &mut deltas,
            &mut revision,
            reservoir(6, (900, 901, 902)),
        );
        assert!(
            g.display.resident_ids_sorted().len() == 3,
            "the record's three residents are on stage"
        );

        let final_snapshot = g.snapshot();
        let fixture = StagedRecordsFixture {
            revision: connect_revision,
            snapshot,
            deltas,
            final_revision: revision,
            final_snapshot,
            witnesses: FixtureWitnesses {
                corpse: FixtureWitness {
                    id: corpse,
                    death_at_ms: 2_000,
                },
                refilled: FixtureWitness {
                    id: refilled,
                    death_at_ms: 9_000,
                },
            },
        };
        let json = serde_json::to_string_pretty(&fixture).expect("serialize fixture") + "\n";
        assert_matches_text_fixture("display_staged_records.json", &json);
    }
}
