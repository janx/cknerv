//! Display plane — "who is on stage" for the cell galaxy (S2: prefix +
//! composed modes).
//!
//! The plane owns display MEMBERSHIP as presentation policy layered on top
//! of the canonical cell projection. It decides which cells are staged for
//! rendering, within a fixed product budget, and emits at most one
//! coalesced [`CellDelta::Display`] per mutation. It never touches
//! canonical truth (invariant I2): no counters move, the `cells` map is
//! never written, and nothing here is persisted (`CellGalaxyPersisted`
//! carries no display state — after a restore the plane is rebuilt from
//! the restored map by [`DisplayPlane::bootstrap`], always in prefix mode;
//! a reservoir refresh upgrades it later, exactly like today's
//! "composition appears when ready" UX).
//!
//! ## Membership policy — prefix / canonical mode (S1, unchanged)
//!
//! * **Resting** members are the first `budget.cells − ACTIVITY_QUOTA`
//!   live-or-corpse cells in canonical insertion order. Births beyond a
//!   full resting set do NOT enter as resting — they wait in an
//!   insertion-order understudy queue and are staged only when a resting
//!   vacancy opens (amortized cursor; the cursor never moves backward).
//! * **Activity** members are the resolved endpoint ids of each landed
//!   tx (the same `from_ids`/`to_ids` that ride `CellDelta::Link`). An
//!   endpoint not already on stage enters as activity, consuming quota.
//!   The quota is a FIFO grouped by block number: past
//!   `DISPLAY_ACTIVITY_QUOTA`, oldest-block activity members are evicted
//!   first. Eviction never removes resting members. An endpoint already
//!   on stage (resting or activity) is a membership no-op.
//! * **Deaths** don't change membership: a staged corpse stays visible
//!   for its death-animation window and exits only when canonical GC
//!   removes it from the map — the vacancy then backfills from the
//!   cursor. Cap eviction is a death (not a removal) and behaves the
//!   same way.
//! * **Reorg** mirrors canonical outcomes: members removed from the map
//!   exit (rollback *parks* orphaned births in `reorg_limbo` with NO
//!   canonical delta — a silent-removal path on the wire, which is why
//!   the plane is hooked inside the handlers rather than derived from
//!   the emitted delta stream). Revived identities re-enter through the
//!   ordinary birth/endpoint paths. Limbo settle GCs ids that already
//!   left the map at park time, so it is a plane no-op by construction.
//! * **Backfill** (historical replay): activity entries are suppressed
//!   and no per-mutation display deltas are emitted (the projection ring
//!   is cleared at the replay start anyway); membership keeps evolving
//!   silently, and the terminal `active: false` emits one coalesced
//!   delta diffing final membership against what clients last saw.
//!
//! ## Membership policy — composed mode (S2)
//!
//! A validated [`GalaxyCompositionRecord`] arriving through the internal
//! `Mutation::GalaxyReservoirReplaced` channel (design D6) switches the
//! plane to composed staffing — the server-side port of the old client's
//! `composedCellRenderList` (`packages/ui/src/geometry/cellRenderSet.ts`),
//! membership-set semantics only (the client's interleave ORDER is
//! deliberately dropped; slot assignment ignores order):
//!
//! * **Classes**: `asset_kind` dao → Dao, native → Plain, everything else
//!   → Typed (the old client's `compositionBucket`). Quotas come from the
//!   shared [`GalaxyCompositionTarget::for_total`] (30:40:30 bps) over the
//!   FULL cell budget.
//! * **Fill** (`composed_fill`, run at every refresh): each class fills
//!   from its reservoir bucket first (record rank order), with D5 outpoint
//!   dedupe at admission — an outpoint retained canonically resolves to
//!   the canonical id/cell; only genuinely off-map outpoints stage as
//!   *residents* under their composition id, payload riding
//!   `enter_cells`. Then one canonical fallback walk in insertion order
//!   admits cells into their own classes until every quota is satisfied
//!   (whole-map walk when the budget is below the old client's ≥10
//!   early-stop guard). Final per-class targets are computed on
//!   `min(budget, admitted)`; classes that run dry spill round-robin
//!   dao → typed → plain (one candidate per class per round — the old
//!   client's exact spill loop).
//! * **Activity** is in-class substitution per `docs/ckbadger.md`: an
//!   off-stage endpoint enters by displacing the lowest-priority
//!   same-class RESTING member. Priority (lowest displaced first):
//!   canonical-fallback admits before reservoir admits; within a group,
//!   latest-admitted first. The displaced member is remembered (bench)
//!   and restored when its displacer leaves the quota FIFO; an
//!   unrestorable bench (GC'd, superseded, or re-staged) falls back to
//!   the per-class refill queues. While the stage is below
//!   `min(budget, available)` an endpoint enters WITHOUT displacing
//!   (mirrors the old client, where activity always fit whenever
//!   available ≤ budget); with the stage full and no same-class resting
//!   member to displace, the entry is skipped. The quota itself stays
//!   the S1 FIFO-by-block `DISPLAY_ACTIVITY_QUOTA`.
//! * **Vacancies** (GC of a staged member, failed bench restore): refill
//!   from per-class queues seeded at refresh with the unchosen admission
//!   tail (reservoir tail first, then canonical unchosen in insertion
//!   order) and fed by post-refresh births; a dry class borrows other
//!   queues in dao → typed → plain order so the member COUNT holds even
//!   when the ratio can't (invariant I1's "when candidates suffice"
//!   proviso).
//! * **Refresh dedupe**: a record whose content matches the stored
//!   reservoir (`GalaxyCompositionRecord::content_matches` — `as_of` and
//!   `updated_at_ms` ignored) is a FULL no-op: no delta, provenance
//!   frozen — mirroring the semantics projection's dedup invariants
//!   (`projection_registry.rs` `duplicate_galaxy_composition_refresh…`).
//!   Every degrade path (reorg cut, rebuild/reset) drops the stored
//!   reservoir, which re-arms the dedup: a later content-identical record
//!   applies again.
//! * **Degrade**: a rollback whose boundary is at or below the reservoir
//!   anchor (`from_block <= as_of.block` — the same predicate the
//!   semantics projection prunes with) drops the reservoir and rebuilds
//!   prefix membership in one coalesced delta, provenance mode Canonical.
//!   `ChainRebuild`/reset drop the reservoir with everything else.
//! * **Residents are sticky** between refreshes: the server cannot
//!   observe spends of outpoints outside its retained set, so a staged
//!   resident stays until the next refresh/degrade replaces it — the
//!   same blind spot the old client had between 15-minute records. The
//!   one exception is D5's later-collision: a canonical birth claiming a
//!   staged resident's outpoint swaps the resident out in place (exit
//!   composition id, enter canonical id, same slot priority), so one
//!   outpoint is never staged under two ids (invariant I4).
//!
//! ## Determinism
//!
//! Everything on the wire is derived from mutation content and the
//! canonical container's insertion order (`CellGalaxy.cells` is a `Vec`,
//! so canonical iteration order IS insertion order). The plane still
//! keeps its own presence mirror because the canonical container has no
//! id index (membership checks would be linear scans) and `Vec`
//! positions shift under `retain`/`remove`. `enter_ids`/`exit_ids` are
//! emitted sorted, members serialize in ascending id order, residents in
//! ascending id order, and timestamps come exclusively from
//! mutation-carried values (record clock for composed provenance, the
//! mutation clock for canonical provenance — no wall clocks).
//! Nondeterministic upstream orders (e.g. `reorg_limbo` HashMap drains)
//! never reach the display wire; internal HashMaps are keyed-lookup only
//! (every wire-visible iteration goes through ordered structures).
//!
//! ## Cost
//!
//! Steady-state operations are O(churn) per mutation (touched ids only),
//! plus amortized queue compaction/skips. Full passes over the map happen
//! only at refresh (15-minute cadence), degrade, bootstrap (restore),
//! reset, and the backfill-terminal resettle — all sanctioned big events.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};

use crate::enrichment::{GalaxyCompositionRecord, GalaxyCompositionTarget};
use crate::helix::helix_seed_for;
use crate::outpoint::OutPoint;
use crate::taxonomy::AssetKind;

use super::cells::{
    Cell, CellDelta, DisplayBudget, DisplayMode, DisplayProvenance, DisplaySection,
};

/// Fixed product budget: cells on stage. Server-owned (see design doc
/// §3.1 — the client's `AUTO_CELL_DISPLAY_BUDGET` reads this from the
/// snapshot after S3).
pub const DISPLAY_CELL_BUDGET: u32 = 12_000;
/// Fixed product budget: passive nerve edges woven across the stage.
/// Carried in the snapshot for the client; the plane itself only stages
/// cells.
pub const DISPLAY_NERVE_EDGE_BUDGET: u32 = 8_000;
/// Activity quota: latest-block tx endpoints on stage. A reserved pool in
/// prefix mode; an in-class substitution bound in composed mode.
pub const DISPLAY_ACTIVITY_QUOTA: usize = 512;

/// How many stale understudy entries we tolerate before compacting the
/// prefix queue against the presence mirror. `2·present + slack` keeps
/// the compaction amortized O(1) per insertion.
const UNDERSTUDY_COMPACT_SLACK: usize = 1_024;

/// The old client's early-stop guard: below this budget the canonical
/// fallback walk admits the whole map instead of stopping at satisfied
/// quotas (`cellRenderSet.ts` `requestedCount >= 10`).
const COMPOSED_EARLY_STOP_MIN_BUDGET: usize = 10;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MemberRole {
    Resting,
    /// Entered via a tx-endpoint swap; `block` keys the eviction FIFO.
    Activity {
        block: u64,
    },
}

/// Composition class of a cell — the old client's `compositionBucket`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CompositionClass {
    Dao = 0,
    Typed = 1,
    Plain = 2,
}

const CLASS_ORDER: [CompositionClass; 3] = [
    CompositionClass::Dao,
    CompositionClass::Typed,
    CompositionClass::Plain,
];

fn class_of(kind: AssetKind) -> CompositionClass {
    match kind {
        AssetKind::Dao => CompositionClass::Dao,
        AssetKind::Native => CompositionClass::Plain,
        _ => CompositionClass::Typed,
    }
}

/// Displacement priority of a resting composed member. Ordered so the
/// MAXIMUM key is displaced first: canonical-fallback admits
/// (`FALLBACK_GROUP`) go before reservoir admits, and within a group the
/// latest admission sequence goes first.
type PriorityKey = (u8, u64);
const RESERVOIR_GROUP: u8 = 0;
const FALLBACK_GROUP: u8 = 1;

/// The resting member an activity entry displaced; restored (with its
/// original slot priority) when the displacer leaves the stage.
#[derive(Clone, Copy, Debug)]
struct BenchEntry {
    id: u64,
    key: PriorityKey,
}

/// Composed-mode staffing state. `Some` ⇔ provenance mode Composed.
struct ComposedState {
    /// The validated reservoir this membership was composed from. Held
    /// internally only — never on the wire. Drives the content dedupe and
    /// the reorg degrade predicate.
    reservoir: GalaxyCompositionRecord,
    /// Per-class chosen counts frozen at refresh: the ratio the vacancy
    /// refill prefers to restore.
    class_targets: [usize; 3],
    /// Staged members currently on stage by class (resting + activity).
    class_counts: [usize; 3],
    /// Class of every staged member.
    class_of_member: HashMap<u64, CompositionClass>,
    /// Staged residents' payloads (composition id → node-hydrated Cell).
    residents: HashMap<u64, Cell>,
    /// Off-stage reservoir candidates' payloads (backfill/bench pool).
    resident_pool: HashMap<u64, Cell>,
    /// Every reservoir-origin outpoint currently represented by a
    /// composition id (staged or pooled) — D5 later-collision detection
    /// at canonical birth time.
    resident_outpoints: HashMap<OutPoint, u64>,
    /// Resting members by displacement priority, per class. The maximum
    /// key is displaced first.
    resting_priority: [BTreeMap<PriorityKey, u64>; 3],
    priority_of: HashMap<u64, PriorityKey>,
    next_seq: u64,
    /// Per-class vacancy refill queues: unchosen admission tail at
    /// refresh (reservoir tail first, then canonical unchosen in
    /// insertion order), then post-refresh births. Entries may be stale
    /// (GC'd / superseded / already staged) — skipped at pop.
    class_queues: [VecDeque<u64>; 3],
    /// Activity member id → the resting member it displaced.
    bench: HashMap<u64, BenchEntry>,
    /// Staged residents whose payload changed at a refresh that kept
    /// membership identical — re-ride `enter_cells` once so delta
    /// followers converge with fresh snapshots.
    resident_reenter: BTreeSet<u64>,
}

impl ComposedState {
    fn queue(&mut self, class: CompositionClass) -> &mut VecDeque<u64> {
        &mut self.class_queues[class as usize]
    }
}

/// See the module docs. Owned by `CellGalaxy`; every canonical handler
/// reports births/removals/endpoints as they happen and `apply_mutation`
/// calls [`DisplayPlane::flush`] exactly once at the end — which is what
/// structurally guarantees "at most one `Display` delta per mutation".
pub(crate) struct DisplayPlane {
    budget: DisplayBudget,
    activity_quota: usize,
    /// budget.cells − activity_quota (prefix mode's resting pool).
    resting_target: usize,

    /// Staged members. BTreeMap so snapshot/wire order is deterministic
    /// (ascending id) without per-mutation sorting of the full set.
    members: BTreeMap<u64, MemberRole>,
    resting_count: usize,
    activity_count: usize,
    /// Activity FIFO grouped by block: oldest block evicts first; ids
    /// within a group keep arrival order. Every id here is a member with
    /// `MemberRole::Activity`.
    activity_groups: BTreeMap<u64, Vec<u64>>,

    /// Mirror of the canonical cells-map key set (id → composition
    /// class), maintained by the same note_* hooks that drive
    /// membership. Needed because the canonical container (`Vec<Cell>`)
    /// has no id index; the class rides along for composed staffing.
    present: HashMap<u64, CompositionClass>,
    /// Prefix-mode insertion-order backfill candidates ("understudies").
    /// May contain stale ids (skipped at pop) and rebirth duplicates
    /// (skipped when they surface already-resting). Unused while
    /// composed; rebuilt from the map at degrade.
    understudies: VecDeque<u64>,

    /// Composed staffing state; `None` = prefix mode.
    composed: Option<ComposedState>,

    /// Per-mutation coalescing log: id → was-member at first touch this
    /// mutation. Diffed against final membership at flush.
    touched: HashMap<u64, bool>,
    /// Tx endpoints reported this mutation, in arrival order.
    pending_activity: Vec<(u64, u64)>, // (block, id)

    provenance: DisplayProvenance,
    /// Ride provenance on the next emitted delta (armed at construction
    /// for the first fill, and by every mode/reservoir change).
    provenance_pending: bool,
    /// Force a delta even when the membership diff is empty — a mode or
    /// reservoir change must reach delta followers so they stay in
    /// agreement with fresh snapshots.
    provenance_force: bool,
    /// Latest mutation-carried timestamp; canonical-mode provenance
    /// stamps (first fill, degrade, reset) use it. Composed provenance
    /// uses the record's own clock instead.
    last_at_ms: u64,

    backfill_active: bool,
    /// Membership as clients last saw it when the replay began; the
    /// terminal resettle diffs against this.
    backfill_baseline: Option<BTreeSet<u64>>,
    /// Armed by [`Self::backfill_ended`]; consumed by the next flush.
    resettle_pending: bool,
}

impl DisplayPlane {
    pub(crate) fn new() -> Self {
        Self::with_limits(
            DisplayBudget {
                cells: DISPLAY_CELL_BUDGET,
                nerve_edges: DISPLAY_NERVE_EDGE_BUDGET,
            },
            DISPLAY_ACTIVITY_QUOTA,
        )
    }

    /// Test seam: shrink the budgets so quota/FIFO/composition behavior
    /// is exercisable without minting thousands of cells.
    pub(crate) fn with_limits(budget: DisplayBudget, activity_quota: usize) -> Self {
        let cells = budget.cells as usize;
        debug_assert!(cells >= activity_quota, "budget must cover the quota");
        Self {
            budget,
            activity_quota,
            resting_target: cells.saturating_sub(activity_quota),
            members: BTreeMap::new(),
            resting_count: 0,
            activity_count: 0,
            activity_groups: BTreeMap::new(),
            present: HashMap::new(),
            understudies: VecDeque::new(),
            composed: None,
            touched: HashMap::new(),
            pending_activity: Vec::new(),
            provenance: DisplayProvenance {
                mode: DisplayMode::Canonical,
                source: None,
                as_of: None,
                updated_at_ms: 0,
            },
            provenance_pending: true,
            provenance_force: false,
            last_at_ms: 0,
            backfill_active: false,
            backfill_baseline: None,
            resettle_pending: false,
        }
    }

    // ── hooks (called by CellGalaxy handlers mid-mutation) ───────────

    /// A cell entered the canonical map (fresh birth, reorg revival, or
    /// rollback resurrection). Idempotent: in-place resurrections of an
    /// id that never left the map are no-ops. In composed mode this is
    /// also the D5 later-collision point: a birth claiming an outpoint
    /// held by a reservoir entry supersedes it (a STAGED resident swaps
    /// out in place; a pooled candidate is simply dropped).
    pub(crate) fn note_birth(&mut self, cell: &Cell) {
        let id = cell.id;
        let class = class_of(cell.asset_kind);
        if self.present.insert(id, class).is_some() {
            return;
        }
        let Some(mut cs) = self.composed.take() else {
            self.understudies.push_back(id);
            self.maybe_compact_understudies();
            return;
        };
        if let Some(rid) = cs.resident_outpoints.remove(&cell.out_point) {
            if let Some(payload) = cs.residents.remove(&rid) {
                // D5 later-collision swap: the canonical cell takes over
                // the resident's slot (same class — same outpoint means
                // same content) so one outpoint is never staged twice.
                let rclass = class_of(payload.asset_kind);
                let key = cs
                    .priority_of
                    .remove(&rid)
                    .expect("staged resident is always a resting member");
                cs.resting_priority[rclass as usize].remove(&key);
                cs.class_of_member.remove(&rid);
                cs.class_counts[rclass as usize] -= 1;
                self.members.remove(&rid);
                self.touched.entry(rid).or_insert(true);
                self.resting_count -= 1;

                self.members.insert(id, MemberRole::Resting);
                self.touched.entry(id).or_insert(false);
                self.resting_count += 1;
                cs.class_of_member.insert(id, class);
                cs.class_counts[class as usize] += 1;
                cs.resting_priority[class as usize].insert(key, id);
                cs.priority_of.insert(id, key);
                self.composed = Some(cs);
                return;
            }
            // Pooled candidate superseded by the canonical birth; its
            // queue entry goes stale and is skipped at pop.
            cs.resident_pool.remove(&rid);
        }
        cs.queue(class).push_back(id);
        self.composed = Some(cs);
    }

    /// A cell left the canonical map — this must cover EVERY removal
    /// path (GC sweep, reorg parking, reset). Staged members exit here;
    /// the vacancy backfills at the next flush.
    pub(crate) fn note_removed(&mut self, id: u64) {
        if self.present.remove(&id).is_none() {
            return;
        }
        let Some(role) = self.members.remove(&id) else {
            // A stale understudy/queue entry (if any) is skipped at pop.
            return;
        };
        self.touched.entry(id).or_insert(true);
        match role {
            MemberRole::Resting => {
                self.resting_count -= 1;
                if let Some(mut cs) = self.composed.take() {
                    let class = cs
                        .class_of_member
                        .remove(&id)
                        .expect("staged member has a class");
                    cs.class_counts[class as usize] -= 1;
                    if let Some(key) = cs.priority_of.remove(&id) {
                        cs.resting_priority[class as usize].remove(&key);
                    }
                    self.composed = Some(cs);
                    // The class vacancy refills at the next flush.
                }
            }
            MemberRole::Activity { block } => {
                self.activity_count -= 1;
                self.remove_from_activity_group(block, id);
                if self.composed.is_some() {
                    self.composed_activity_exited(id);
                }
            }
        }
    }

    /// The resolved endpoint ids of a landed tx, in `from` then `to`
    /// order — the same ids that ride `CellDelta::Link`. Staged at
    /// flush; suppressed while a historical replay is active.
    pub(crate) fn note_activity(&mut self, block: u64, ids: impl IntoIterator<Item = u64>) {
        for id in ids {
            self.pending_activity.push((block, id));
        }
    }

    /// `reset_for_rebuild` mirror: everything exits (one coalesced
    /// delta), all internal state clears. Dropping a live reservoir is a
    /// mode transition, so provenance (mode Canonical again) rides the
    /// exit-all delta and the content dedup re-arms; a prefix-mode reset
    /// leaves provenance untouched exactly as in S1.
    pub(crate) fn note_reset(&mut self) {
        for id in self.members.keys() {
            self.touched.entry(*id).or_insert(true);
        }
        self.members.clear();
        self.resting_count = 0;
        self.activity_count = 0;
        self.activity_groups.clear();
        self.present.clear();
        self.understudies.clear();
        self.pending_activity.clear();
        if self.composed.take().is_some() {
            self.provenance = DisplayProvenance {
                mode: DisplayMode::Canonical,
                source: None,
                as_of: None,
                updated_at_ms: self.last_at_ms,
            };
            self.provenance_pending = true;
            self.provenance_force = true;
        }
    }

    /// A historical replay opened: remember what clients currently see
    /// (the resettle diffs against it) and go silent.
    pub(crate) fn backfill_started(&mut self) {
        if self.backfill_active {
            return;
        }
        self.backfill_active = true;
        self.resettle_pending = false;
        self.backfill_baseline = Some(self.members.keys().copied().collect());
    }

    /// The replay closed (complete or not — canonical clears its
    /// backfill state either way): the next flush emits one coalesced
    /// resettle delta.
    pub(crate) fn backfill_ended(&mut self) {
        if !self.backfill_active {
            return;
        }
        self.backfill_active = false;
        self.resettle_pending = true;
    }

    /// Rebuild after a persisted-state restore: prefix mode, resting
    /// membership re-derived from the restored map in insertion order
    /// (the reservoir is never persisted — a live refresh upgrades the
    /// plane later). Emits no delta — there are no clients before boot
    /// completes, and every snapshot taken after `load()` already
    /// carries this fill.
    pub(crate) fn bootstrap(&mut self, cells: &[Cell]) {
        self.members.clear();
        self.resting_count = 0;
        self.activity_count = 0;
        self.activity_groups.clear();
        self.present.clear();
        self.understudies.clear();
        self.composed = None;
        self.touched.clear();
        self.pending_activity.clear();
        self.backfill_active = false;
        self.backfill_baseline = None;
        self.resettle_pending = false;
        self.provenance = DisplayProvenance {
            mode: DisplayMode::Canonical,
            source: None,
            as_of: None,
            updated_at_ms: 0,
        };
        self.provenance_pending = true;
        self.provenance_force = false;

        for cell in cells {
            if self
                .present
                .insert(cell.id, class_of(cell.asset_kind))
                .is_none()
            {
                self.understudies.push_back(cell.id);
            }
        }
        self.fill_resting_vacancies();
        self.touched.clear();
        if !self.members.is_empty() {
            // Deterministic restore clock: the newest event time carried
            // by the restored cells themselves (same derivation the
            // backfill-terminal cap enforcement uses).
            let at_ms = cells
                .iter()
                .map(|cell| cell.death_at_ms.unwrap_or(cell.born_at_ms))
                .max()
                .unwrap_or(0);
            self.provenance_pending = false;
            self.provenance.updated_at_ms = at_ms;
            self.last_at_ms = at_ms;
        }
    }

    // ── composed mode: reservoir refresh / degrade ───────────────────

    /// `refresh_transition` (D6 arrival): recompose the stage from a
    /// validated reservoir. A content-identical record (per
    /// [`GalaxyCompositionRecord::content_matches`]) is a FULL no-op —
    /// no delta, provenance frozen. Otherwise membership is recomputed
    /// (old-client `composedCellRenderList` set semantics), standing
    /// activity members re-layer via in-class substitution, and the one
    /// coalesced Display delta (enter_ids + enter_cells + exit_ids +
    /// provenance) is emitted by the flush that follows this call.
    ///
    /// `outpoint_index`/`cells` are the canonical resolver at the call
    /// boundary: the map's outpoint → id index and the insertion-order
    /// container (D5 dedupe + fallback walk).
    pub(crate) fn reservoir_replaced(
        &mut self,
        record: &GalaxyCompositionRecord,
        outpoint_index: &HashMap<OutPoint, u64>,
        cells: &[Cell],
    ) {
        if let Some(cs) = &self.composed {
            if cs.reservoir.content_matches(record) {
                // Duplicate revalidation: broadcast nothing and keep the
                // stored record exactly as previously applied, so fresh
                // snapshots match delta subscribers and the reorg-degrade
                // predicate evaluates identically everywhere. Every
                // degrade path nulls the stored reservoir, re-arming this.
                return;
            }
        }

        let budget = self.budget.cells as usize;
        let by_id: HashMap<u64, &Cell> = cells.iter().map(|c| (c.id, c)).collect();

        // ── admission (port of composedCellRenderList, membership set) ──
        struct Admit<'a> {
            id: u64,
            class: CompositionClass,
            resident: Option<&'a Cell>,
        }
        let mut buckets: [Vec<Admit>; 3] = [Vec::new(), Vec::new(), Vec::new()];
        let mut reservoir_len = [0usize; 3];
        let mut admitted_ids: HashSet<u64> = HashSet::new();
        let mut admitted_ops: HashSet<&OutPoint> = HashSet::new();

        // 1. Reservoir buckets in ranked order, D5 resolution at
        //    admission: an outpoint retained canonically uses the
        //    canonical id/cell; a class-mismatched resolution is skipped
        //    (the old client's `admit(cell, expected)` guard); dedupe by
        //    both id and outpoint.
        for (expected, bucket) in [
            (CompositionClass::Dao, &record.dao),
            (CompositionClass::Typed, &record.typed),
            (CompositionClass::Plain, &record.plain),
        ] {
            for rc in bucket {
                let (id, class, resident) = match outpoint_index
                    .get(&rc.out_point)
                    .and_then(|cid| by_id.get(cid))
                {
                    Some(canonical) => (canonical.id, class_of(canonical.asset_kind), None),
                    None => (rc.id, class_of(rc.asset_kind), Some(rc)),
                };
                if class != expected {
                    continue;
                }
                if admitted_ids.contains(&id) || admitted_ops.contains(&rc.out_point) {
                    continue;
                }
                admitted_ids.insert(id);
                admitted_ops.insert(&rc.out_point);
                buckets[class as usize].push(Admit {
                    id,
                    class,
                    resident,
                });
                reservoir_len[class as usize] += 1;
            }
        }

        // 2. Canonical fallback walk in insertion order, admitting cells
        //    into their own classes, stopping once every full-budget
        //    quota is satisfied (never stopping below the old client's
        //    ≥10 guard so tiny budgets admit the whole map).
        let full_targets = (budget >= COMPOSED_EARLY_STOP_MIN_BUDGET)
            .then(|| GalaxyCompositionTarget::for_total(budget));
        let quotas_satisfied = |b: &[Vec<Admit>; 3]| {
            full_targets.is_some_and(|t| {
                b[0].len() >= t.dao && b[1].len() >= t.typed && b[2].len() >= t.plain
            })
        };
        if !quotas_satisfied(&buckets) {
            for cell in cells {
                if admitted_ids.contains(&cell.id) || admitted_ops.contains(&cell.out_point) {
                    continue;
                }
                let class = class_of(cell.asset_kind);
                admitted_ids.insert(cell.id);
                admitted_ops.insert(&cell.out_point);
                buckets[class as usize].push(Admit {
                    id: cell.id,
                    class,
                    resident: None,
                });
                if quotas_satisfied(&buckets) {
                    break;
                }
            }
        }

        // 3. Final targets on min(budget, admitted), per-class prefix
        //    slices, then the old client's round-robin spill
        //    (dao → typed → plain, one per class per round).
        let available = buckets.iter().map(Vec::len).sum::<usize>();
        let count = budget.min(available);
        let targets = GalaxyCompositionTarget::for_total(count);
        let mut chosen = [
            targets.dao.min(buckets[0].len()),
            targets.typed.min(buckets[1].len()),
            targets.plain.min(buckets[2].len()),
        ];
        let mut chosen_total: usize = chosen.iter().sum();
        while chosen_total < count {
            let mut progressed = false;
            for c in 0..3 {
                if chosen[c] < buckets[c].len() {
                    chosen[c] += 1;
                    chosen_total += 1;
                    progressed = true;
                    if chosen_total == count {
                        break;
                    }
                }
            }
            if !progressed {
                break;
            }
        }

        // 4. Build the new composed state from the chosen prefixes.
        let mut cs = ComposedState {
            reservoir: record.clone(),
            class_targets: chosen,
            class_counts: [0; 3],
            class_of_member: HashMap::new(),
            residents: HashMap::new(),
            resident_pool: HashMap::new(),
            resident_outpoints: HashMap::new(),
            resting_priority: [BTreeMap::new(), BTreeMap::new(), BTreeMap::new()],
            priority_of: HashMap::new(),
            next_seq: 0,
            class_queues: [VecDeque::new(), VecDeque::new(), VecDeque::new()],
            bench: HashMap::new(),
            resident_reenter: BTreeSet::new(),
        };
        let old_residents = self
            .composed
            .take()
            .map(|old| old.residents)
            .unwrap_or_default();
        let mut new_members: BTreeMap<u64, ()> = BTreeMap::new();
        for c in 0..3 {
            for (i, admit) in buckets[c].iter().take(chosen[c]).enumerate() {
                let group = if i < reservoir_len[c] {
                    RESERVOIR_GROUP
                } else {
                    FALLBACK_GROUP
                };
                let key: PriorityKey = (group, cs.next_seq);
                cs.next_seq += 1;
                new_members.insert(admit.id, ());
                cs.class_of_member.insert(admit.id, admit.class);
                cs.class_counts[c] += 1;
                cs.resting_priority[c].insert(key, admit.id);
                cs.priority_of.insert(admit.id, key);
                if let Some(payload) = admit.resident {
                    cs.residents.insert(admit.id, payload.clone());
                    cs.resident_outpoints
                        .insert(payload.out_point.clone(), admit.id);
                    // A staged resident whose payload changed while its
                    // membership held must re-ride enter_cells once.
                    if self.members.contains_key(&admit.id)
                        && old_residents
                            .get(&admit.id)
                            .is_some_and(|old| old != payload)
                    {
                        cs.resident_reenter.insert(admit.id);
                    }
                }
            }
            // Unchosen admission tail seeds the class refill queue, in
            // admission order; unchosen residents park in the pool.
            for admit in buckets[c].iter().skip(chosen[c]) {
                cs.class_queues[c].push_back(admit.id);
                if let Some(payload) = admit.resident {
                    cs.resident_pool.insert(admit.id, payload.clone());
                    cs.resident_outpoints
                        .insert(payload.out_point.clone(), admit.id);
                }
            }
        }
        // Never-admitted canonical cells queue after the admission tails,
        // in insertion order (the fallback walk would have reached them
        // next).
        for cell in cells {
            if !admitted_ids.contains(&cell.id) {
                cs.class_queues[class_of(cell.asset_kind) as usize].push_back(cell.id);
            }
        }

        // 5. Diff membership: exits first (touched coalescing pairs them
        //    with re-enters), then installs.
        let standing_activity: Vec<(u64, u64)> = self
            .activity_groups
            .iter()
            .flat_map(|(block, ids)| ids.iter().map(move |id| (*block, *id)))
            .collect();
        let old_ids: Vec<u64> = self.members.keys().copied().collect();
        for id in old_ids {
            if !new_members.contains_key(&id) {
                self.members.remove(&id);
                self.touched.entry(id).or_insert(true);
            }
        }
        for id in new_members.keys() {
            if self.members.insert(*id, MemberRole::Resting).is_none() {
                self.touched.entry(*id).or_insert(false);
            }
        }
        self.resting_count = self.members.len();
        self.activity_count = 0;
        self.activity_groups.clear();
        self.composed = Some(cs);

        // 6. Re-layer standing activity endpoints (FIFO order) via the
        //    ordinary in-class substitution. An endpoint inside the new
        //    fill simply stays resting (its quota slot dissolves).
        for (block, id) in standing_activity {
            if self.members.contains_key(&id) || !self.present.contains_key(&id) {
                continue;
            }
            self.composed_activity_enter(block, id);
        }

        // 7. Provenance: composed, stamped with the record's own clock.
        self.provenance = DisplayProvenance {
            mode: DisplayMode::Composed,
            source: Some(record.source.clone()),
            as_of: Some(record.as_of.clone()),
            updated_at_ms: record.updated_at_ms,
        };
        self.provenance_pending = true;
        self.provenance_force = true;
        // Prefix bookkeeping is rebuilt from the map at degrade.
        self.understudies.clear();
    }

    /// Reorg hook (explicit `ChainReorganized` or an implicit
    /// hash-mismatch rollback): a boundary at or below the reservoir
    /// anchor invalidates the composition — drop it, rebuild prefix
    /// membership from the (already rolled back) canonical container,
    /// and ride mode-Canonical provenance on the coalesced delta. The
    /// content dedup re-arms (a later identical record applies again).
    pub(crate) fn chain_reorganized(&mut self, from_block: u64, cells: &[Cell]) {
        let anchored_below = self
            .composed
            .as_ref()
            .is_some_and(|cs| from_block <= cs.reservoir.as_of.block);
        if !anchored_below {
            return;
        }
        self.composed = None;
        self.rebuild_prefix_membership(cells);
        self.provenance = DisplayProvenance {
            mode: DisplayMode::Canonical,
            source: None,
            as_of: None,
            updated_at_ms: self.last_at_ms,
        };
        self.provenance_pending = true;
        self.provenance_force = true;
    }

    /// Degrade helper: prefix-mode membership recomputed from the
    /// canonical container (S1 semantics — first `resting_target`
    /// live-or-corpse cells in insertion order, remainder understudies),
    /// standing activity members re-admitted beyond the prefix. All
    /// changes flow through the touched log so the flush emits one
    /// coalesced diff.
    fn rebuild_prefix_membership(&mut self, cells: &[Cell]) {
        let standing_activity: Vec<(u64, u64)> = self
            .activity_groups
            .iter()
            .flat_map(|(block, ids)| ids.iter().map(move |id| (*block, *id)))
            .collect();
        let old_ids: Vec<u64> = self.members.keys().copied().collect();
        for id in old_ids {
            self.touched.entry(id).or_insert(true);
        }
        self.members.clear();
        self.resting_count = 0;
        self.activity_count = 0;
        self.activity_groups.clear();
        self.understudies.clear();

        for cell in cells.iter().take(self.resting_target) {
            self.members.insert(cell.id, MemberRole::Resting);
            self.touched.entry(cell.id).or_insert(false);
            self.resting_count += 1;
        }
        for cell in cells.iter().skip(self.resting_target) {
            self.understudies.push_back(cell.id);
        }
        for (block, id) in standing_activity {
            if self.members.contains_key(&id) || !self.present.contains_key(&id) {
                continue;
            }
            self.members.insert(id, MemberRole::Activity { block });
            self.touched.entry(id).or_insert(false);
            self.activity_count += 1;
            self.activity_groups.entry(block).or_default().push(id);
        }
    }

    // ── flush (called once per mutation by apply_mutation) ───────────

    /// Settle this mutation's membership consequences and emit the one
    /// coalesced `Display` delta, if membership (or provenance) changed.
    /// `at_ms` is the mutation-carried timestamp when it has one.
    pub(crate) fn flush(&mut self, at_ms: Option<u64>) -> Option<CellDelta> {
        if let Some(at) = at_ms {
            self.last_at_ms = at;
        }

        // 1. Vacancy fill. Runs even during backfill (membership evolves
        //    silently).
        if self.composed.is_some() {
            self.fill_composed_vacancies();
        } else {
            self.fill_resting_vacancies();
        }

        // 2. Activity entries — suppressed during historical replay
        //    (calm catch-up; the terminal resettle presents the final
        //    membership in one piece).
        if self.backfill_active {
            self.pending_activity.clear();
        } else {
            let pending = std::mem::take(&mut self.pending_activity);
            for (block, id) in pending {
                if self.members.contains_key(&id) || !self.present.contains_key(&id) {
                    continue; // already on stage / defensive: unknown id
                }
                if self.composed.is_some() {
                    self.composed_activity_enter(block, id);
                } else {
                    self.touched.entry(id).or_insert(false);
                    self.members.insert(id, MemberRole::Activity { block });
                    self.activity_count += 1;
                    self.activity_groups.entry(block).or_default().push(id);
                }
            }
            // 3. Quota: evict oldest-block activity members first. Only
            //    activity structures are drained — resting members are
            //    never evicted for activity. In composed mode an eviction
            //    restores the member the leaver displaced.
            while self.activity_count > self.activity_quota {
                let Some(mut entry) = self.activity_groups.first_entry() else {
                    break;
                };
                let ids = entry.get_mut();
                if ids.is_empty() {
                    entry.remove();
                    continue;
                }
                let id = ids.remove(0);
                if ids.is_empty() {
                    entry.remove();
                }
                self.touched.entry(id).or_insert(true);
                self.members.remove(&id);
                self.activity_count -= 1;
                if self.composed.is_some() {
                    self.composed_activity_exited(id);
                }
            }
            // Unrestorable benches leave resting vacancies inside this
            // same mutation — repair before emitting.
            if self.composed.is_some() {
                self.fill_composed_vacancies();
            }
        }

        if self.backfill_active {
            self.touched.clear();
            return None;
        }

        let (enter, exit_ids) = if self.resettle_pending {
            self.resettle_pending = false;
            self.touched.clear();
            let baseline = self.backfill_baseline.take().unwrap_or_default();
            // Both sides iterate ordered sets → sorted output.
            let enter: Vec<u64> = self
                .members
                .keys()
                .filter(|id| !baseline.contains(id))
                .copied()
                .collect();
            let exit: Vec<u64> = baseline
                .iter()
                .filter(|id| !self.members.contains_key(id))
                .copied()
                .collect();
            (enter, exit)
        } else {
            let mut ids: Vec<(u64, bool)> = std::mem::take(&mut self.touched).into_iter().collect();
            // The touched log is a HashMap — sort so iteration order can
            // never leak into wire bytes.
            ids.sort_unstable_by_key(|(id, _)| *id);
            let mut enter = Vec::new();
            let mut exit = Vec::new();
            for (id, was) in ids {
                let now = self.members.contains_key(&id);
                if was == now {
                    continue; // coalesced away (e.g. park + revive)
                }
                if now {
                    enter.push(id);
                } else {
                    exit.push(id);
                }
            }
            (enter, exit)
        };

        let resident_reenter: BTreeSet<u64> = self
            .composed
            .as_mut()
            .map(|cs| std::mem::take(&mut cs.resident_reenter))
            .unwrap_or_default();

        if enter.is_empty()
            && exit_ids.is_empty()
            && resident_reenter.is_empty()
            && !self.provenance_force
        {
            return None;
        }

        // Split enters into canonical references vs resident payloads
        // (I3: an id is shipped as payload iff it is NOT in the map).
        let mut enter_ids: Vec<u64> = Vec::new();
        let mut enter_cells: Vec<Cell> = Vec::new();
        let mut carried: HashSet<u64> = HashSet::new();
        for id in enter {
            debug_assert_ne!(
                self.present.contains_key(&id),
                self.resident_payload(id).is_some(),
                "member {id} must be exactly one of canonical or resident"
            );
            match self.resident_payload(id) {
                Some(cell) => {
                    carried.insert(id);
                    enter_cells.push(cell);
                }
                None => enter_ids.push(id),
            }
        }
        for id in resident_reenter {
            if !carried.contains(&id) {
                if let Some(cell) = self.resident_payload(id) {
                    enter_cells.push(cell);
                }
            }
        }
        enter_cells.sort_unstable_by_key(|cell| cell.id);

        let provenance = if self.provenance_pending {
            self.provenance_pending = false;
            if self.provenance.mode == DisplayMode::Canonical {
                // Canonical provenance (first fill / degrade / reset) is
                // stamped with the mutation clock at emission; composed
                // provenance keeps the record's own clock.
                self.provenance.updated_at_ms = self.last_at_ms;
            }
            Some(self.provenance.clone())
        } else {
            None
        };
        self.provenance_force = false;
        Some(CellDelta::Display {
            enter_ids,
            enter_cells,
            exit_ids,
            provenance,
        })
    }

    /// Snapshot section: members in the plane's deterministic order
    /// (ascending id), staged resident payloads (ascending id, position
    /// re-derived like every canonical snapshot cell), current
    /// provenance, fixed budget.
    pub(crate) fn section(&self) -> DisplaySection {
        let residents = match &self.composed {
            None => Vec::new(),
            Some(cs) => {
                let mut cells: Vec<Cell> = cs
                    .residents
                    .values()
                    .map(|cell| Cell {
                        pos_seed: helix_seed_for(cell.id),
                        ..cell.clone()
                    })
                    .collect();
                cells.sort_unstable_by_key(|cell| cell.id);
                cells
            }
        };
        DisplaySection {
            budget: self.budget,
            members: self.members.keys().copied().collect(),
            residents,
            provenance: self.provenance.clone(),
        }
    }

    // ── internals ────────────────────────────────────────────────────

    /// Staged-resident payload for emission: the stored hydrated cell
    /// with its position re-derived from the id (`helix_seed_for`), the
    /// same recompute-on-emit rule every canonical snapshot cell obeys.
    fn resident_payload(&self, id: u64) -> Option<Cell> {
        let cs = self.composed.as_ref()?;
        let cell = cs.residents.get(&id)?;
        Some(Cell {
            pos_seed: helix_seed_for(id),
            ..cell.clone()
        })
    }

    /// In-class substitution (composed mode). The caller has verified
    /// the id is canonical-present and off stage.
    fn composed_activity_enter(&mut self, block: u64, id: u64) {
        let Some(mut cs) = self.composed.take() else {
            return;
        };
        let class = *self
            .present
            .get(&id)
            .expect("caller verified canonical presence");
        let dynamic_target = (self.budget.cells as usize)
            .min(self.present.len() + cs.residents.len() + cs.resident_pool.len());
        let mut enter = false;
        if self.members.len() < dynamic_target {
            // Stage below min(budget, available): enter without
            // displacing — the old client admitted activity outright
            // whenever available ≤ budget.
            enter = true;
        } else if let Some((&key, &victim)) = cs.resting_priority[class as usize].iter().next_back()
        {
            // Displace the lowest-priority same-class resting member:
            // fallback admits before reservoir admits, latest-admitted
            // first within a group.
            cs.resting_priority[class as usize].remove(&key);
            cs.priority_of.remove(&victim);
            cs.class_of_member.remove(&victim);
            cs.class_counts[class as usize] -= 1;
            self.members.remove(&victim);
            self.touched.entry(victim).or_insert(true);
            self.resting_count -= 1;
            if let Some(payload) = cs.residents.remove(&victim) {
                // A displaced resident keeps its payload off stage so a
                // later restore can re-ship it.
                cs.resident_pool.insert(victim, payload);
            }
            cs.bench.insert(id, BenchEntry { id: victim, key });
            enter = true;
        }
        // else: stage full and the class has no resting member to
        // displace (all-activity class) — skip the entry, deterministic.
        if enter {
            self.members.insert(id, MemberRole::Activity { block });
            self.touched.entry(id).or_insert(false);
            self.activity_count += 1;
            self.activity_groups.entry(block).or_default().push(id);
            cs.class_of_member.insert(id, class);
            cs.class_counts[class as usize] += 1;
        }
        self.composed = Some(cs);
    }

    /// An activity member left the stage (quota eviction or canonical
    /// removal): restore the resting member it displaced, when possible.
    /// The membership/touched/count bookkeeping for the leaver itself is
    /// the caller's job; this settles the composed side tables + bench.
    fn composed_activity_exited(&mut self, id: u64) {
        let Some(mut cs) = self.composed.take() else {
            return;
        };
        let class = cs
            .class_of_member
            .remove(&id)
            .expect("staged member has a class");
        cs.class_counts[class as usize] -= 1;
        if let Some(bench) = cs.bench.remove(&id) {
            let b = bench.id;
            if let Some(MemberRole::Activity { block }) = self.members.get(&b).copied() {
                // The benched member re-entered on its own as an
                // endpoint: promote it back to its resting slot (quota
                // slot freed, no wire noise). Its own bench (if any)
                // dissolves — that candidate becomes the class's top
                // refill candidate instead.
                self.members.insert(b, MemberRole::Resting);
                self.activity_count -= 1;
                self.resting_count += 1;
                self.remove_from_activity_group(block, b);
                cs.resting_priority[class as usize].insert(bench.key, b);
                cs.priority_of.insert(b, bench.key);
                if let Some(chained) = cs.bench.remove(&b) {
                    cs.class_queues[class as usize].push_front(chained.id);
                }
            } else if self.members.contains_key(&b) {
                // Already resting again through another path — the
                // vacancy stands and the refill queues cover it.
            } else if self.present.contains_key(&b) {
                // Ordinary canonical restore, original slot priority.
                self.members.insert(b, MemberRole::Resting);
                self.touched.entry(b).or_insert(false);
                self.resting_count += 1;
                cs.class_of_member.insert(b, class);
                cs.class_counts[class as usize] += 1;
                cs.resting_priority[class as usize].insert(bench.key, b);
                cs.priority_of.insert(b, bench.key);
            } else if let Some(payload) = cs.resident_pool.remove(&b) {
                // Resident restore: payload re-ships via enter_cells.
                self.members.insert(b, MemberRole::Resting);
                self.touched.entry(b).or_insert(false);
                self.resting_count += 1;
                cs.residents.insert(b, payload);
                cs.class_of_member.insert(b, class);
                cs.class_counts[class as usize] += 1;
                cs.resting_priority[class as usize].insert(bench.key, b);
                cs.priority_of.insert(b, bench.key);
            }
            // else: the benched member is gone (GC'd / superseded) — the
            // vacancy refills from the class queues at flush.
        }
        self.composed = Some(cs);
    }

    /// Composed vacancy refill: first restore each class toward its
    /// frozen refresh target, then top the stage up to
    /// min(budget, available) borrowing across classes in the spill
    /// preference order (dao → typed → plain, round-robin).
    fn fill_composed_vacancies(&mut self) {
        let Some(mut cs) = self.composed.take() else {
            return;
        };
        let dynamic_target = (self.budget.cells as usize)
            .min(self.present.len() + cs.residents.len() + cs.resident_pool.len());
        for class in CLASS_ORDER {
            while cs.class_counts[class as usize] < cs.class_targets[class as usize]
                && self.members.len() < dynamic_target
            {
                if !self.pop_stage_one(&mut cs, class) {
                    break;
                }
            }
        }
        'top_up: while self.members.len() < dynamic_target {
            let mut progressed = false;
            for class in CLASS_ORDER {
                if self.members.len() >= dynamic_target {
                    break 'top_up;
                }
                if self.pop_stage_one(&mut cs, class) {
                    progressed = true;
                }
            }
            if !progressed {
                break;
            }
        }
        self.composed = Some(cs);
    }

    /// Pop `class`'s refill queue until one member is staged as resting
    /// (skipping stale entries; promoting an entry already staged as
    /// activity in place, which frees quota without filling the count).
    /// Returns whether a member was staged.
    fn pop_stage_one(&mut self, cs: &mut ComposedState, class: CompositionClass) -> bool {
        while let Some(id) = cs.queue(class).pop_front() {
            match self.members.get(&id).copied() {
                Some(MemberRole::Activity { block }) => {
                    // Promote in place (no wire noise, quota slot freed);
                    // the count deficit stands, keep popping.
                    self.members.insert(id, MemberRole::Resting);
                    self.activity_count -= 1;
                    self.resting_count += 1;
                    self.remove_from_activity_group(block, id);
                    let member_class = *cs
                        .class_of_member
                        .get(&id)
                        .expect("staged member has a class");
                    let key: PriorityKey = (FALLBACK_GROUP, cs.next_seq);
                    cs.next_seq += 1;
                    cs.resting_priority[member_class as usize].insert(key, id);
                    cs.priority_of.insert(id, key);
                    if let Some(chained) = cs.bench.remove(&id) {
                        cs.class_queues[member_class as usize].push_front(chained.id);
                    }
                    continue;
                }
                Some(MemberRole::Resting) => continue, // stale duplicate
                None => {}
            }
            if let Some(&class_now) = self.present.get(&id) {
                // Canonical candidate (staged under its CURRENT class —
                // rebirth cycles keep content, but never trust a stale
                // queue lane over the live map).
                self.stage_resting(cs, id, class_now, None);
                return true;
            }
            if let Some(payload) = cs.resident_pool.remove(&id) {
                let rclass = class_of(payload.asset_kind);
                self.stage_resting(cs, id, rclass, Some(payload));
                return true;
            }
            // Stale: GC'd canonical id or a superseded resident — skip.
        }
        false
    }

    fn stage_resting(
        &mut self,
        cs: &mut ComposedState,
        id: u64,
        class: CompositionClass,
        resident: Option<Cell>,
    ) {
        self.members.insert(id, MemberRole::Resting);
        self.touched.entry(id).or_insert(false);
        self.resting_count += 1;
        let key: PriorityKey = (FALLBACK_GROUP, cs.next_seq);
        cs.next_seq += 1;
        cs.class_of_member.insert(id, class);
        cs.class_counts[class as usize] += 1;
        cs.resting_priority[class as usize].insert(key, id);
        cs.priority_of.insert(id, key);
        if let Some(payload) = resident {
            cs.residents.insert(id, payload);
        }
    }

    /// Advance the prefix-mode insertion-order cursor to fill resting
    /// vacancies. Candidates that left the map are skipped; a candidate
    /// already on stage as activity is PROMOTED in place (membership
    /// unchanged, no wire noise, activity slot freed) — it is, after
    /// all, the next cell in canonical insertion order.
    fn fill_resting_vacancies(&mut self) {
        while self.resting_count < self.resting_target {
            let Some(id) = self.understudies.pop_front() else {
                break;
            };
            if !self.present.contains_key(&id) {
                continue; // removed while waiting in the queue
            }
            match self.members.get(&id).copied() {
                Some(MemberRole::Activity { block }) => {
                    self.members.insert(id, MemberRole::Resting);
                    self.resting_count += 1;
                    self.activity_count -= 1;
                    self.remove_from_activity_group(block, id);
                }
                Some(MemberRole::Resting) => {
                    // Duplicate queue entry from a removal+rebirth cycle.
                }
                None => {
                    self.touched.entry(id).or_insert(false);
                    self.members.insert(id, MemberRole::Resting);
                    self.resting_count += 1;
                }
            }
        }
    }

    fn remove_from_activity_group(&mut self, block: u64, id: u64) {
        if let Some(ids) = self.activity_groups.get_mut(&block) {
            ids.retain(|entry| *entry != id);
            if ids.is_empty() {
                self.activity_groups.remove(&block);
            }
        }
    }

    /// Drop stale prefix-queue entries once they dominate. Amortized
    /// O(1) per insertion: right after a compaction the queue is ⊆
    /// present, so it takes ≥ present + slack fresh pushes to trigger
    /// again.
    fn maybe_compact_understudies(&mut self) {
        if self.understudies.len() > self.present.len() * 2 + UNDERSTUDY_COMPACT_SLACK {
            let present = &self.present;
            self.understudies.retain(|id| present.contains_key(id));
        }
    }

    // ── test accessors ───────────────────────────────────────────────

    #[cfg(test)]
    pub(crate) fn member_ids_sorted(&self) -> Vec<u64> {
        self.members.keys().copied().collect()
    }

    #[cfg(test)]
    pub(crate) fn present_ids_sorted(&self) -> Vec<u64> {
        let mut ids: Vec<u64> = self.present.keys().copied().collect();
        ids.sort_unstable();
        ids
    }

    #[cfg(test)]
    pub(crate) fn resting_len(&self) -> usize {
        self.resting_count
    }

    #[cfg(test)]
    pub(crate) fn activity_len(&self) -> usize {
        self.activity_count
    }

    #[cfg(test)]
    pub(crate) fn is_activity_member(&self, id: u64) -> bool {
        matches!(self.members.get(&id), Some(MemberRole::Activity { .. }))
    }

    #[cfg(test)]
    pub(crate) fn mode(&self) -> DisplayMode {
        self.provenance.mode
    }

    #[cfg(test)]
    pub(crate) fn resident_ids_sorted(&self) -> Vec<u64> {
        match &self.composed {
            None => Vec::new(),
            Some(cs) => {
                let mut ids: Vec<u64> = cs.residents.keys().copied().collect();
                ids.sort_unstable();
                ids
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn class_counts(&self) -> [usize; 3] {
        self.composed
            .as_ref()
            .map(|cs| cs.class_counts)
            .unwrap_or([0; 3])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::enrichment::ChainAnchor;

    fn small_plane(cells: u32, quota: usize) -> DisplayPlane {
        DisplayPlane::with_limits(
            DisplayBudget {
                cells,
                nerve_edges: 8,
            },
            quota,
        )
    }

    /// Minimal canonical cell. `tx` seeds a unique outpoint; asset kind
    /// picks the composition class.
    fn cell_with(id: u64, tx: &str, kind: AssetKind, born: u64) -> Cell {
        Cell {
            id,
            born_at_ms: born,
            death_at_ms: None,
            birth_block: 1,
            tag: None,
            pos_seed: [0.0; 3],
            out_point: OutPoint {
                tx_hash: tx.to_string(),
                index: 0,
            },
            capacity: 100,
            data_hex: "0x".into(),
            content_hash: format!("0x{id:064x}"),
            lock_kind: Default::default(),
            asset_kind: kind,
        }
    }

    fn cell(id: u64) -> Cell {
        cell_with(id, &format!("0x{id}"), AssetKind::Other, 0)
    }

    fn birth(plane: &mut DisplayPlane, id: u64) {
        plane.note_birth(&cell(id));
    }

    fn record(
        block: u64,
        dao: Vec<Cell>,
        typed: Vec<Cell>,
        plain: Vec<Cell>,
    ) -> GalaxyCompositionRecord {
        GalaxyCompositionRecord {
            source: "ckbadger".into(),
            as_of: ChainAnchor {
                block,
                hash: format!("0xblock{block}"),
            },
            updated_at_ms: block * 10,
            dao,
            typed,
            plain,
        }
    }

    /// Canonical field mirroring the TS suite's `canonicalField(n)` kind
    /// pattern: id%7==0 → dao, else id%3==0 → typed(xudt), else
    /// plain(native).
    fn canonical_field(count: u64) -> Vec<Cell> {
        (0..count)
            .map(|id| {
                let kind = if id % 7 == 0 {
                    AssetKind::Dao
                } else if id % 3 == 0 {
                    AssetKind::Xudt
                } else {
                    AssetKind::Native
                };
                cell_with(id, &format!("0x{id}"), kind, 0)
            })
            .collect()
    }

    fn outpoint_index(cells: &[Cell]) -> HashMap<OutPoint, u64> {
        cells
            .iter()
            .map(|cell| (cell.out_point.clone(), cell.id))
            .collect()
    }

    /// Feed a canonical field into a plane (present mirror + prefix
    /// fill), clearing the wire log so the next flush isolates the
    /// behavior under test.
    fn seed_canonical(plane: &mut DisplayPlane, cells: &[Cell], at: u64) {
        for cell in cells {
            plane.note_birth(cell);
        }
        plane.flush(Some(at));
    }

    fn delta_parts(delta: Option<CellDelta>) -> (Vec<u64>, Vec<u64>, Option<DisplayProvenance>) {
        match delta {
            Some(CellDelta::Display {
                enter_ids,
                enter_cells,
                exit_ids,
                provenance,
            }) => {
                assert!(enter_cells.is_empty(), "this seam expects no residents");
                (enter_ids, exit_ids, provenance)
            }
            None => (Vec::new(), Vec::new(), None),
            other => panic!("expected a Display delta, got {other:?}"),
        }
    }

    #[allow(clippy::type_complexity)]
    fn full_delta_parts(
        delta: Option<CellDelta>,
    ) -> (Vec<u64>, Vec<Cell>, Vec<u64>, Option<DisplayProvenance>) {
        match delta {
            Some(CellDelta::Display {
                enter_ids,
                enter_cells,
                exit_ids,
                provenance,
            }) => (enter_ids, enter_cells, exit_ids, provenance),
            None => (Vec::new(), Vec::new(), Vec::new(), None),
            other => panic!("expected a Display delta, got {other:?}"),
        }
    }

    fn member_set(plane: &DisplayPlane) -> BTreeSet<u64> {
        plane.member_ids_sorted().into_iter().collect()
    }

    // ═══ S1 prefix-mode pins (unchanged behavior) ════════════════════

    /// Resting fill takes the first `cells − quota` births in insertion
    /// order; overflow births wait as understudies. The first emitted
    /// delta rides Canonical provenance stamped with the mutation clock.
    #[test]
    fn prefix_fill_stages_first_births_in_insertion_order() {
        let mut plane = small_plane(8, 2); // resting target 6
        for id in 0..9 {
            birth(&mut plane, id);
        }
        let (enter, exit, provenance) = delta_parts(plane.flush(Some(1_000)));
        assert_eq!(enter, vec![0, 1, 2, 3, 4, 5]);
        assert!(exit.is_empty());
        let provenance = provenance.expect("first fill rides provenance");
        assert_eq!(provenance.mode, DisplayMode::Canonical);
        assert_eq!(provenance.source, None);
        assert_eq!(provenance.as_of, None);
        assert_eq!(provenance.updated_at_ms, 1_000);

        // Later births beyond the full resting set do not enter…
        birth(&mut plane, 9);
        let (enter, exit, provenance) = delta_parts(plane.flush(Some(1_100)));
        assert!(enter.is_empty() && exit.is_empty() && provenance.is_none());
        // …and provenance never rides again in prefix mode.
        assert_eq!(plane.member_ids_sorted(), vec![0, 1, 2, 3, 4, 5]);
    }

    /// Activity entries: endpoints enter progressively, an already-staged
    /// endpoint is a membership no-op, the quota is FIFO by block, and
    /// eviction never touches resting members.
    #[test]
    fn activity_quota_is_fifo_by_block_and_spares_resting_members() {
        let mut plane = small_plane(8, 2); // resting 0..5
        for id in 0..9 {
            birth(&mut plane, id);
        }
        plane.flush(Some(1_000));

        // Endpoint already staged as resting → no-op.
        plane.note_activity(10, [2]);
        let (enter, exit, _) = delta_parts(plane.flush(Some(1_010)));
        assert!(enter.is_empty() && exit.is_empty());

        // Two beyond-prefix endpoints fill the quota.
        plane.note_activity(10, [6]);
        let (enter, _, _) = delta_parts(plane.flush(Some(1_020)));
        assert_eq!(enter, vec![6]);
        plane.note_activity(11, [7]);
        let (enter, _, _) = delta_parts(plane.flush(Some(1_030)));
        assert_eq!(enter, vec![7]);
        // Re-announcing a staged activity endpoint is a no-op (its FIFO
        // slot keeps the original block).
        plane.note_activity(12, [6]);
        let (enter, exit, _) = delta_parts(plane.flush(Some(1_040)));
        assert!(enter.is_empty() && exit.is_empty());

        // A third endpoint overflows the quota: the oldest BLOCK (10,
        // holding id 6) evicts first — never a resting member, even
        // though ids 0..5 are older than every activity member.
        plane.note_activity(12, [8]);
        let (enter, exit, _) = delta_parts(plane.flush(Some(1_050)));
        assert_eq!(enter, vec![8]);
        assert_eq!(exit, vec![6]);
        assert_eq!(plane.member_ids_sorted(), vec![0, 1, 2, 3, 4, 5, 7, 8]);
        assert_eq!(plane.resting_len(), 6);
        assert_eq!(plane.activity_len(), 2);
    }

    /// Vacancy backfill walks the insertion-order cursor: stale (removed)
    /// candidates are skipped; a candidate staged as activity is promoted
    /// in place instead of double-entering, freeing its quota slot.
    #[test]
    fn cursor_skips_stale_candidates_and_promotes_staged_activity() {
        let mut plane = small_plane(8, 2);
        for id in 0..9 {
            birth(&mut plane, id);
        }
        plane.flush(Some(1_000)); // resting 0..5, understudies [6, 7, 8]
        plane.note_activity(10, [7]);
        plane.flush(Some(1_100)); // 7 on stage as activity

        // 6 dies and is GC'd while still waiting in the queue.
        plane.note_removed(6);
        let (enter, exit, _) = delta_parts(plane.flush(Some(1_200)));
        assert!(enter.is_empty() && exit.is_empty(), "6 was never staged");

        // A resting member exits → cursor pops 6 (stale, skipped), then
        // 7 (activity → promoted, no wire noise): the only visible
        // change is the exit.
        plane.note_removed(0);
        let (enter, exit, _) = delta_parts(plane.flush(Some(1_300)));
        assert!(enter.is_empty());
        assert_eq!(exit, vec![0]);
        assert_eq!(plane.member_ids_sorted(), vec![1, 2, 3, 4, 5, 7]);
        assert_eq!(plane.resting_len(), 6);
        assert_eq!(plane.activity_len(), 0, "promotion freed the quota slot");
        assert!(!plane.is_activity_member(7));

        // Next vacancy stages the remaining understudy as resting.
        plane.note_removed(1);
        let (enter, exit, _) = delta_parts(plane.flush(Some(1_400)));
        assert_eq!(enter, vec![8]);
        assert_eq!(exit, vec![1]);
    }

    /// While a replay is active: activity entries are suppressed and no
    /// deltas are emitted even though resting membership keeps evolving;
    /// the terminal flush emits exactly one coalesced diff against what
    /// clients last saw.
    #[test]
    fn backfill_suppresses_activity_and_resettles_once() {
        let mut plane = small_plane(8, 2);
        birth(&mut plane, 0);
        plane.flush(Some(500)); // clients know {0}

        plane.backfill_started();
        for id in 1..8 {
            birth(&mut plane, id);
        }
        plane.note_activity(3, [7]);
        assert!(plane.flush(Some(1_000)).is_none(), "silent during replay");
        plane.note_removed(0);
        assert!(plane.flush(Some(1_100)).is_none(), "silent during replay");

        plane.backfill_ended();
        let (enter, exit, provenance) = delta_parts(plane.flush(None));
        assert_eq!(enter, vec![1, 2, 3, 4, 5, 6]);
        assert_eq!(exit, vec![0]);
        assert!(
            provenance.is_none(),
            "first fill already announced pre-replay"
        );
        assert!(
            !plane.is_activity_member(7),
            "replay-time activity suppressed"
        );
        assert_eq!(plane.activity_len(), 0);
    }

    /// Bootstrap from a restored map emits nothing; the section carries
    /// the fill and a provenance clock derived from the cells.
    #[test]
    fn bootstrap_fills_silently_from_restored_cells() {
        let cell = |id: u64, born: u64| cell_with(id, &format!("0x{id}"), AssetKind::Other, born);
        let mut plane = small_plane(8, 2);
        plane.bootstrap(&[cell(3, 700), cell(9, 900), cell(4, 800)]);
        assert!(plane.flush(None).is_none(), "bootstrap emits no delta");
        let section = plane.section();
        assert_eq!(section.members, vec![3, 4, 9]);
        assert!(section.residents.is_empty());
        assert_eq!(section.provenance.updated_at_ms, 900);
        assert_eq!(section.budget.cells, 8);
    }

    // ═══ S2 composed mode ════════════════════════════════════════════

    /// Quota math parity with the shared constant: 30:40:30 with the
    /// remainder folded into plain.
    #[test]
    fn for_total_parity_with_old_client_targets() {
        assert_eq!(
            GalaxyCompositionTarget::for_total(6_000),
            GalaxyCompositionTarget {
                dao: 1_800,
                typed: 2_400,
                plain: 1_800,
            }
        );
        assert_eq!(
            GalaxyCompositionTarget::for_total(12_000),
            GalaxyCompositionTarget {
                dao: 3_600,
                typed: 4_800,
                plain: 3_600,
            }
        );
        // Remainder-to-plain (floor(0.3·n) + floor(0.4·n) + rest).
        assert_eq!(
            GalaxyCompositionTarget::for_total(7),
            GalaxyCompositionTarget {
                dao: 2,
                typed: 2,
                plain: 3,
            }
        );
    }

    /// Golden case 1 — mirrors cellRenderSet.test.ts "composes the
    /// 6000-cell resting field at exactly 30:40:30": empty canonical
    /// map, full reservoir → every record cell stages as a resident and
    /// the class split is exactly 1800/2400/1800.
    #[test]
    fn golden_full_reservoir_composes_exactly_30_40_30() {
        let mut plane = small_plane(6_000, 8);
        let dao: Vec<Cell> = (0..1_800)
            .map(|i| cell_with(10_000 + i, &format!("0xd{i}"), AssetKind::Dao, 0))
            .collect();
        let typed: Vec<Cell> = (0..2_400)
            .map(|i| cell_with(20_000 + i, &format!("0xt{i}"), AssetKind::Xudt, 0))
            .collect();
        let plain: Vec<Cell> = (0..1_800)
            .map(|i| cell_with(30_000 + i, &format!("0xp{i}"), AssetKind::Native, 0))
            .collect();
        let rec = record(10, dao.clone(), typed.clone(), plain.clone());

        plane.reservoir_replaced(&rec, &HashMap::new(), &[]);
        let (enter_ids, enter_cells, exit, provenance) = full_delta_parts(plane.flush(Some(1_000)));
        assert!(enter_ids.is_empty(), "no canonical map — all residents");
        assert!(exit.is_empty());
        assert_eq!(enter_cells.len(), 6_000);
        let expected: BTreeSet<u64> = dao
            .iter()
            .chain(typed.iter())
            .chain(plain.iter())
            .map(|c| c.id)
            .collect();
        assert_eq!(member_set(&plane), expected);
        assert_eq!(plane.class_counts(), [1_800, 2_400, 1_800]);
        let provenance = provenance.expect("mode transition rides provenance");
        assert_eq!(provenance.mode, DisplayMode::Composed);
        assert_eq!(provenance.source.as_deref(), Some("ckbadger"));
        assert_eq!(provenance.as_of.as_ref().map(|a| a.block), Some(10));
        assert_eq!(provenance.updated_at_ms, 100);
        assert_eq!(plane.resident_ids_sorted().len(), 6_000);
    }

    /// Golden case 2 — mirrors cellRenderSet.test.ts "prefers a
    /// canonical Cell over an indexed copy of the same outpoint" (D5 at
    /// refresh): the reservoir dao entry shares its outpoint with
    /// canonical id 1 → the member is the canonical id; the composition
    /// id never appears.
    #[test]
    fn golden_d5_prefers_canonical_over_indexed_copy_of_same_outpoint() {
        let mut plane = small_plane(10, 2);
        let canonical = vec![cell_with(1, "0xshared", AssetKind::Dao, 0)];
        seed_canonical(&mut plane, &canonical, 500);

        let rec = record(
            10,
            vec![
                cell_with(101, "0xshared", AssetKind::Dao, 0), // same outpoint as canonical 1
                cell_with(102, "0xd2", AssetKind::Dao, 0),
                cell_with(103, "0xd3", AssetKind::Dao, 0),
            ],
            vec![
                cell_with(201, "0xt1", AssetKind::Xudt, 0),
                cell_with(202, "0xt2", AssetKind::Xudt, 0),
                cell_with(203, "0xt3", AssetKind::Xudt, 0),
                cell_with(204, "0xt4", AssetKind::Xudt, 0),
            ],
            vec![
                cell_with(301, "0xp1", AssetKind::Native, 0),
                cell_with(302, "0xp2", AssetKind::Native, 0),
                cell_with(303, "0xp3", AssetKind::Native, 0),
            ],
        );
        plane.reservoir_replaced(&rec, &outpoint_index(&canonical), &canonical);
        let (enter_ids, enter_cells, exit, _) = full_delta_parts(plane.flush(Some(1_000)));

        // Expected set (old client, budget 10 → targets {3,4,3}; dao
        // resolves [1, 102, 103]): {1, 102, 103, 201..204, 301..303}.
        let expected: BTreeSet<u64> = [1, 102, 103, 201, 202, 203, 204, 301, 302, 303].into();
        assert_eq!(member_set(&plane), expected);
        assert!(
            !member_set(&plane).contains(&101),
            "indexed copy resolved away"
        );
        // Canonical member 1 was already on stage (prefix fill) so only
        // the residents enter; 1 simply stays.
        assert!(enter_ids.is_empty());
        assert!(exit.is_empty());
        let entered: BTreeSet<u64> = enter_cells.iter().map(|c| c.id).collect();
        assert_eq!(
            entered,
            [102, 103, 201, 202, 203, 204, 301, 302, 303].into()
        );
        assert_eq!(
            plane.resident_ids_sorted(),
            vec![102, 103, 201, 202, 203, 204, 301, 302, 303]
        );
    }

    /// Golden case 3 — mirrors the structure of cellRenderSet.test.ts
    /// "matches the reference when sparse classes force the canonical
    /// fallback", minus selection/activity (server has no selection;
    /// activity is layered separately). Hand-derived from the reference
    /// algorithm: canonical field ids 0..23 (kind pattern id%7→dao,
    /// id%3→typed, else plain), one resident per reservoir class, budget
    /// 12 → targets {3,4,5}; the fallback walk admits ids 0..9 and stops
    /// with every quota satisfied. Expected membership:
    /// dao [1001, 0, 7] · typed [2001, 3, 6, 9] · plain [3001, 1, 2, 4, 5].
    #[test]
    fn golden_sparse_reservoir_fills_from_canonical_fallback() {
        let mut plane = small_plane(12, 2);
        let canonical = canonical_field(24);
        seed_canonical(&mut plane, &canonical, 500);

        let rec = record(
            10,
            vec![cell_with(1_001, "0xrd", AssetKind::Dao, 0)],
            vec![cell_with(2_001, "0xrt", AssetKind::Xudt, 0)],
            vec![cell_with(3_001, "0xrp", AssetKind::Native, 0)],
        );
        plane.reservoir_replaced(&rec, &outpoint_index(&canonical), &canonical);
        plane.flush(Some(1_000));

        let expected: BTreeSet<u64> = [1_001, 0, 7, 2_001, 3, 6, 9, 3_001, 1, 2, 4, 5].into();
        assert_eq!(member_set(&plane), expected);
        assert_eq!(plane.class_counts(), [3, 4, 5]);
        assert_eq!(plane.resident_ids_sorted(), vec![1_001, 2_001, 3_001]);
    }

    /// Golden case 4 — the old client's spill loop is a ROUND-ROBIN over
    /// dao → typed → plain (one candidate per class per round), not a
    /// sequential drain (cellRenderSet.ts spill loop). dao tail [d4, d5],
    /// typed short by 2, plain tail [p4, p5]: the 2-slot shortfall takes
    /// d4 then p4 — a drain would have taken d4 then d5.
    #[test]
    fn golden_spill_is_round_robin_dao_typed_plain() {
        let mut plane = small_plane(10, 2);
        let dao: Vec<Cell> = (1..=5)
            .map(|i| cell_with(100 + i, &format!("0xd{i}"), AssetKind::Dao, 0))
            .collect();
        let typed: Vec<Cell> = (1..=2)
            .map(|i| cell_with(200 + i, &format!("0xt{i}"), AssetKind::Xudt, 0))
            .collect();
        let plain: Vec<Cell> = (1..=5)
            .map(|i| cell_with(300 + i, &format!("0xp{i}"), AssetKind::Native, 0))
            .collect();
        let rec = record(10, dao, typed, plain);
        plane.reservoir_replaced(&rec, &HashMap::new(), &[]);
        plane.flush(Some(1_000));

        // targets(10) = {3,4,3}; chosen dao 3, typed 2, plain 3 = 8;
        // spill round 1: dao 104, plain 304 → 10.
        let expected: BTreeSet<u64> = [101, 102, 103, 104, 201, 202, 301, 302, 303, 304].into();
        assert_eq!(member_set(&plane), expected);
        assert_eq!(plane.class_counts(), [4, 2, 4]);
    }

    /// D5 later-collision: a canonical birth claiming a STAGED
    /// resident's outpoint swaps the resident out in place (exit
    /// composition id, enter canonical id) inside one coalesced delta.
    #[test]
    fn later_canonical_birth_swaps_out_staged_resident() {
        let mut plane = small_plane(6, 2);
        let rec = record(
            10,
            vec![cell_with(1_001, "0xrd", AssetKind::Dao, 0)],
            vec![cell_with(2_001, "0xrt", AssetKind::Xudt, 0)],
            vec![cell_with(3_001, "0xrp", AssetKind::Native, 0)],
        );
        plane.reservoir_replaced(&rec, &HashMap::new(), &[]);
        plane.flush(Some(1_000));
        assert_eq!(member_set(&plane), [1_001, 2_001, 3_001].into());

        // Canonical birth re-creates the typed resident's outpoint.
        plane.note_birth(&cell_with(7, "0xrt", AssetKind::Xudt, 2_000));
        let (enter_ids, enter_cells, exit, _) = full_delta_parts(plane.flush(Some(2_000)));
        assert_eq!(enter_ids, vec![7]);
        assert!(enter_cells.is_empty());
        assert_eq!(exit, vec![2_001]);
        assert_eq!(member_set(&plane), [1_001, 7, 3_001].into());
        assert_eq!(plane.resident_ids_sorted(), vec![1_001, 3_001]);
        assert_eq!(
            plane.class_counts(),
            [1, 1, 1],
            "in-place swap keeps the ratio"
        );
    }

    /// A displaced (benched) resident whose outpoint is later born
    /// canonically is superseded in the pool: the composition id can
    /// never restage (I4), the failed bench restore falls back to the
    /// class refill queue, and the member count holds.
    #[test]
    fn superseded_bench_falls_back_to_class_queue() {
        let mut plane = small_plane(3, 1);
        let canonical = vec![
            cell_with(0, "0xa", AssetKind::Xudt, 0),
            cell_with(5, "0xe", AssetKind::Native, 0),
            cell_with(6, "0xf", AssetKind::Native, 0),
        ];
        seed_canonical(&mut plane, &canonical, 500);
        // Budget 3 < 10 → whole-map walk; targets(3) = {0,1,2}: typed
        // [0], plain [301, 302] (residents); queue plain [5, 6].
        let rec = record(
            10,
            vec![],
            vec![],
            vec![
                cell_with(301, "0xp1", AssetKind::Native, 0),
                cell_with(302, "0xp2", AssetKind::Native, 0),
            ],
        );
        plane.reservoir_replaced(&rec, &outpoint_index(&canonical), &canonical);
        plane.flush(Some(1_000));
        assert_eq!(member_set(&plane), [0, 301, 302].into());

        // Plain endpoint 9 displaces the latest reservoir plain (302),
        // which parks in the pool as its bench.
        plane.note_birth(&cell_with(9, "0xg", AssetKind::Native, 1_500));
        plane.note_activity(20, [9]);
        let (enter, exit, _) = delta_parts(plane.flush(Some(2_000)));
        assert_eq!(enter, vec![9]);
        assert_eq!(exit, vec![302]);

        // The benched resident's outpoint is born canonically → the
        // pooled candidate is superseded (dropped).
        plane.note_birth(&cell_with(11, "0xp2", AssetKind::Native, 2_100));
        plane.flush(Some(2_100));

        // A newer endpoint evicts 9 from the 1-slot quota. Its bench
        // (302) is unrestorable — superseded — so the plain vacancy
        // refills from the class queue (canonical 5) instead. The
        // composition id 302 never reappears.
        plane.note_activity(21, [11]);
        let (enter_ids, enter_cells, exit, _) = full_delta_parts(plane.flush(Some(3_000)));
        assert_eq!(enter_ids, vec![5, 11]);
        assert!(enter_cells.is_empty());
        assert_eq!(exit, vec![9, 301]); // 301 displaced by 11; 9 evicted
        assert_eq!(member_set(&plane), [0, 5, 11].into());
        assert!(!member_set(&plane).contains(&302));
        assert_eq!(plane.class_counts(), [0, 1, 2]);
    }

    /// Refresh dedupe: a content-identical record (fresh anchor) is a
    /// FULL no-op — no delta, provenance frozen at the previously applied
    /// anchor. A degrade (reorg at/below the anchor) re-arms it: the same
    /// content applies again afterwards.
    #[test]
    fn refresh_dedupes_identical_content_and_rearms_after_degrade() {
        let mut plane = small_plane(6, 2);
        let canonical = canonical_field(4);
        seed_canonical(&mut plane, &canonical, 500);
        let content = |block| {
            record(
                block,
                vec![cell_with(1_001, "0xrd", AssetKind::Dao, 0)],
                vec![cell_with(2_001, "0xrt", AssetKind::Xudt, 0)],
                vec![cell_with(3_001, "0xrp", AssetKind::Native, 0)],
            )
        };
        let index = outpoint_index(&canonical);
        plane.reservoir_replaced(&content(10), &index, &canonical);
        plane.flush(Some(1_000));
        assert_eq!(plane.mode(), DisplayMode::Composed);
        let members_before = member_set(&plane);
        let provenance_before = plane.section().provenance;
        assert_eq!(provenance_before.as_of.as_ref().map(|a| a.block), Some(10));

        // Content-identical revalidation at a newer anchor: full no-op.
        plane.reservoir_replaced(&content(12), &index, &canonical);
        assert!(plane.flush(Some(1_100)).is_none(), "dedup emits nothing");
        assert_eq!(plane.section().provenance, provenance_before);
        assert_eq!(member_set(&plane), members_before);

        // Reorg at the stored anchor: degrade to canonical…
        plane.chain_reorganized(10, &canonical);
        let (_, _, _, provenance) = full_delta_parts(plane.flush(Some(1_200)));
        let provenance = provenance.expect("degrade rides provenance");
        assert_eq!(provenance.mode, DisplayMode::Canonical);
        assert_eq!(provenance.source, None);
        assert_eq!(provenance.as_of, None);
        assert_eq!(plane.mode(), DisplayMode::Canonical);
        assert!(plane.resident_ids_sorted().is_empty());

        // …and the SAME content must broadcast again (re-armed).
        plane.reservoir_replaced(&content(14), &index, &canonical);
        let (_, _, _, provenance) = full_delta_parts(plane.flush(Some(1_300)));
        let provenance = provenance.expect("re-armed refresh rides provenance");
        assert_eq!(provenance.mode, DisplayMode::Composed);
        assert_eq!(provenance.as_of.as_ref().map(|a| a.block), Some(14));
        assert_eq!(member_set(&plane), members_before);
    }

    /// A reorg ABOVE the reservoir anchor leaves the composition alone.
    #[test]
    fn reorg_above_anchor_keeps_the_reservoir() {
        let mut plane = small_plane(6, 2);
        let canonical = canonical_field(4);
        seed_canonical(&mut plane, &canonical, 500);
        let rec = record(
            10,
            vec![],
            vec![cell_with(2_001, "0xrt", AssetKind::Xudt, 0)],
            vec![],
        );
        plane.reservoir_replaced(&rec, &outpoint_index(&canonical), &canonical);
        plane.flush(Some(1_000));
        plane.chain_reorganized(11, &canonical);
        assert!(plane.flush(Some(1_100)).is_none());
        assert_eq!(plane.mode(), DisplayMode::Composed);
    }

    /// In-class activity substitution: an off-stage endpoint displaces
    /// the lowest-priority same-class resting member (fallback admits
    /// before reservoir admits, latest-admitted first); eviction restores
    /// the displaced member; class totals hold throughout (I1).
    #[test]
    fn composed_activity_displaces_in_class_and_restores_on_eviction() {
        let mut plane = small_plane(6, 1); // quota 1 → immediate FIFO churn
                                           // Canonical: 2 dao, 2 typed, 2 plain + one extra off-stage typed.
        let canonical = vec![
            cell_with(0, "0xa", AssetKind::Dao, 0),
            cell_with(1, "0xb", AssetKind::Dao, 0),
            cell_with(2, "0xc", AssetKind::Xudt, 0),
            cell_with(3, "0xd", AssetKind::Xudt, 0),
            cell_with(4, "0xe", AssetKind::Native, 0),
            cell_with(5, "0xf", AssetKind::Native, 0),
            cell_with(6, "0xg", AssetKind::Xudt, 0),
        ];
        seed_canonical(&mut plane, &canonical, 500);
        // Budget 6 < 10 → whole-map admission; targets(6) = {1,2,3}⇒
        // dao [0] typed [2,3] plain [4,5] + spill round-robin: dao 1 →
        // members {0,1,2,3,4,5}, all Fallback admits in walk order.
        let rec = record(10, vec![], vec![], vec![]);
        plane.reservoir_replaced(&rec, &outpoint_index(&canonical), &canonical);
        plane.flush(Some(1_000));
        assert_eq!(member_set(&plane), [0, 1, 2, 3, 4, 5].into());
        assert_eq!(plane.class_counts(), [2, 2, 2]);

        // Off-stage typed endpoint 6 enters: displaces the LATEST
        // fallback-admitted typed resting member (3), not 2.
        plane.note_activity(20, [6]);
        let (enter, exit, _) = delta_parts(plane.flush(Some(2_000)));
        assert_eq!(enter, vec![6]);
        assert_eq!(exit, vec![3]);
        assert!(plane.is_activity_member(6));
        assert_eq!(plane.class_counts(), [2, 2, 2], "in-class swap holds I1");

        // A later-block endpoint overflows the 1-slot quota: 6 evicts
        // and its benched member 3 returns — one coalesced swap. The
        // new endpoint (dao 1 is on stage; use plain 7) displaces in
        // ITS class.
        let extra = cell_with(7, "0xh", AssetKind::Native, 0);
        plane.note_birth(&extra);
        plane.note_activity(21, [7]);
        let (enter, exit, _) = delta_parts(plane.flush(Some(3_000)));
        assert_eq!(enter, vec![3, 7]);
        assert_eq!(exit, vec![5, 6]); // 5 = latest plain fallback admit; 6 = quota eviction
        assert!(plane.is_activity_member(7));
        assert!(!plane.is_activity_member(3), "restored as resting");
        assert_eq!(plane.class_counts(), [2, 2, 2]);
        assert_eq!(member_set(&plane), [0, 1, 2, 3, 4, 7].into());
    }

    /// Displacement priority: canonical-fallback admits are displaced
    /// before reservoir admits even when the reservoir admit is newer in
    /// class order.
    #[test]
    fn displacement_takes_fallback_admits_before_reservoir_admits() {
        let mut plane = small_plane(4, 1);
        // Reservoir stages typed resident 2001; canonical walk admits
        // typed 0 as fallback. Budget 4 < 10 → full walk.
        let canonical = vec![
            cell_with(0, "0xa", AssetKind::Xudt, 0),
            cell_with(1, "0xb", AssetKind::Native, 0),
            cell_with(2, "0xc", AssetKind::Dao, 0),
            cell_with(3, "0xd", AssetKind::Xudt, 0),
        ];
        seed_canonical(&mut plane, &canonical, 500);
        let rec = record(
            10,
            vec![],
            vec![cell_with(2_001, "0xrt", AssetKind::Xudt, 0)],
            vec![],
        );
        plane.reservoir_replaced(&rec, &outpoint_index(&canonical), &canonical);
        plane.flush(Some(1_000));
        // available 5 > budget 4; targets(4)={1,1,2}: dao [2], typed
        // [2001], plain [1] + spill: typed 0 → members {2001, 0, 1, 2}.
        assert_eq!(member_set(&plane), [0, 1, 2, 2_001].into());

        // Typed endpoint 3 displaces the FALLBACK typed member 0, never
        // the reservoir resident 2001.
        plane.note_activity(20, [3]);
        let (enter, exit, _) = delta_parts(plane.flush(Some(2_000)));
        assert_eq!(enter, vec![3]);
        assert_eq!(exit, vec![0]);
        assert!(member_set(&plane).contains(&2_001));
    }

    /// A refresh re-layers standing activity members: an endpoint inside
    /// the new fill dissolves into a resting slot (quota freed); one
    /// outside it re-displaces against the NEW fill in its class; old
    /// benches are superseded by the recomposition.
    #[test]
    fn refresh_relayers_standing_activity_members() {
        let mut plane = small_plane(4, 2);
        let canonical = vec![
            cell_with(0, "0xa", AssetKind::Dao, 0),
            cell_with(1, "0xb", AssetKind::Xudt, 0),
            cell_with(2, "0xc", AssetKind::Xudt, 0),
            cell_with(3, "0xd", AssetKind::Native, 0),
            cell_with(4, "0xe", AssetKind::Xudt, 0),
        ];
        seed_canonical(&mut plane, &canonical, 500); // prefix resting {0, 1}
        plane.note_activity(10, [2]);
        plane.flush(Some(600)); // 2 on stage as activity

        // Refresh 1 (empty reservoir): fill = {0, 1, 2, 3} (targets(4)
        // = {1,1,2}, spill takes typed 2). Standing activity 2 is INSIDE
        // the fill → promoted to resting, quota emptied.
        let rec1 = record(10, vec![], vec![], vec![]);
        plane.reservoir_replaced(&rec1, &outpoint_index(&canonical), &canonical);
        plane.flush(Some(1_000));
        assert_eq!(member_set(&plane), [0, 1, 2, 3].into());
        assert!(!plane.is_activity_member(2), "in-fill endpoint dissolves");
        assert_eq!(plane.activity_len(), 0);

        // Off-stage typed endpoint 4 displaces the latest typed admit (2).
        plane.note_activity(11, [4]);
        let (enter, exit, _) = delta_parts(plane.flush(Some(2_000)));
        assert_eq!(enter, vec![4]);
        assert_eq!(exit, vec![2]);
        assert!(plane.is_activity_member(4));

        // Refresh 2 (content differs: a dao resident): new fill =
        // {901, 0, 1, 3}. Standing activity 4 is OUTSIDE it → it
        // re-displaces in class against the NEW fill (victim: typed 1),
        // keeping its activity role; the old bench (2) is superseded.
        let rec2 = record(
            20,
            vec![cell_with(901, "0xrd", AssetKind::Dao, 0)],
            vec![],
            vec![],
        );
        plane.reservoir_replaced(&rec2, &outpoint_index(&canonical), &canonical);
        let (enter_ids, enter_cells, exit, provenance) = full_delta_parts(plane.flush(Some(3_000)));
        assert!(enter_ids.is_empty());
        assert_eq!(
            enter_cells.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![901]
        );
        assert_eq!(exit, vec![1]);
        assert_eq!(
            provenance
                .expect("refresh rides provenance")
                .as_of
                .map(|a| a.block),
            Some(20)
        );
        assert_eq!(member_set(&plane), [0, 3, 4, 901].into());
        assert!(
            plane.is_activity_member(4),
            "activity role survives refresh"
        );
        assert_eq!(plane.class_counts(), [2, 1, 1]);
    }

    /// GC of a staged composed member refills the class from the refresh
    /// queues (reservoir tail first), keeping count and ratio.
    #[test]
    fn composed_gc_vacancy_refills_from_class_queue() {
        let mut plane = small_plane(4, 1);
        let canonical = vec![
            cell_with(0, "0xa", AssetKind::Dao, 0),
            cell_with(1, "0xb", AssetKind::Xudt, 0),
            cell_with(2, "0xc", AssetKind::Native, 0),
            cell_with(3, "0xd", AssetKind::Native, 0),
            cell_with(4, "0xe", AssetKind::Native, 0),
        ];
        seed_canonical(&mut plane, &canonical, 500);
        let rec = record(10, vec![], vec![], vec![]);
        plane.reservoir_replaced(&rec, &outpoint_index(&canonical), &canonical);
        plane.flush(Some(1_000));
        // targets(4)={1,1,2}: dao [0], typed [1], plain [2,3]; queue
        // plain holds [4].
        assert_eq!(member_set(&plane), [0, 1, 2, 3].into());

        plane.note_removed(3);
        let (enter, exit, _) = delta_parts(plane.flush(Some(2_000)));
        assert_eq!(enter, vec![4], "class queue refills the plain vacancy");
        assert_eq!(exit, vec![3]);
        assert_eq!(plane.class_counts(), [1, 1, 2]);
    }
}
