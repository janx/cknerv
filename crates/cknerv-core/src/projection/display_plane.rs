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
//! ## Mechanism / policy split
//!
//! This module is the MECHANISM. [`Stage`] holds the member set, the
//! resident payloads, the budget, the activity FIFO and the per-mutation
//! coalescing log, and exposes them as a small vocabulary of membership
//! moves (`stage_resting`, `stage_activity`, `promote_to_resting`,
//! `unstage`). [`DisplayPlane`] wires that stage to the canonical
//! handlers, the wire (delta + snapshot section) and provenance.
//!
//! Which cells deserve those slots is [`CompositionPolicy`]'s call
//! ([`composition_policy`](super::composition_policy) — classes, quotas,
//! ranks, refill queues). The rule: **"who is on stage, and what they look
//! like" belongs here; "who *should* be" belongs to the policy.** Two
//! policies are installed by this module:
//!
//! * [`CanonicalPolicy`] — prefix mode (no reservoir yet, or degraded).
//! * [`CuratedPolicy`] — composed mode, staffed by a validated
//!   [`GalaxyCompositionRecord`].
//!
//! ## Membership rules the mechanism itself owns
//!
//! * **Activity** members are the resolved endpoint ids of each landed
//!   tx (the same `from_ids`/`to_ids` that ride `CellDelta::Link`). An
//!   endpoint not already on stage is offered to the policy, which
//!   decides how it enters. The quota is a FIFO grouped by block number:
//!   past `DISPLAY_ACTIVITY_QUOTA`, oldest-block activity members are
//!   evicted first. Eviction never removes resting members. An endpoint
//!   already on stage (resting or activity) is a membership no-op.
//! * **Deaths** don't change membership: a staged corpse stays visible
//!   for its death-animation window and exits only when canonical GC
//!   removes it from the map — the vacancy then refills at the next
//!   flush. Cap eviction is a death (not a removal) and behaves the
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
//! ## Composed mode — the transitions this module drives
//!
//! A validated [`GalaxyCompositionRecord`] arriving through the internal
//! `Mutation::GalaxyReservoirReplaced` channel (design D6) installs a
//! fresh [`CuratedPolicy`] and its membership:
//!
//! * **Residents.** An admitted outpoint that is NOT in the canonical map
//!   stages under its composition id with the hydrated payload riding
//!   `enter_cells`; the stage keeps staged payloads in `residents` and
//!   off-stage candidates in `resident_pool`, indexed by outpoint so one
//!   outpoint is never staged under two ids (invariant I4).
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
//!   composition id, enter canonical id, same slot priority).
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

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::Arc;

/// The quota constant itself belongs to the policy; the tests below pin
/// its parity with the old client, so they still need it in scope.
#[cfg(test)]
use crate::enrichment::GalaxyCompositionTarget;
use crate::enrichment::{GalaxyCompositionRecord, GalaxyCompositionTopUp};
use crate::helix::helix_seed_for;
use crate::outpoint::OutPoint;
use crate::taxonomy::AssetKind;

use super::cells::{
    Cell, CellDelta, DisplayBudget, DisplayMode, DisplayProvenance, DisplaySection,
};
use super::composition_policy::{
    CanonicalPolicy, CompositionDemandSink, CompositionFill, CompositionPolicy, CuratedPolicy,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MemberRole {
    Resting,
    /// Entered via a tx-endpoint swap; `block` keys the eviction FIFO.
    Activity {
        block: u64,
    },
}

/// The stage: who is on stage, what they look like, and the bookkeeping
/// that makes one coalesced delta per mutation possible. Class-blind and
/// ratio-blind by construction — every "should" question is the
/// [`CompositionPolicy`]'s, which acts on the stage through the
/// membership moves below.
pub(crate) struct Stage {
    budget: DisplayBudget,
    activity_quota: usize,

    /// Staged members. BTreeMap so snapshot/wire order is deterministic
    /// (ascending id) without per-mutation sorting of the full set.
    members: BTreeMap<u64, MemberRole>,
    resting_count: usize,
    activity_count: usize,
    /// Activity FIFO grouped by block: oldest block evicts first; ids
    /// within a group keep arrival order. Every id here is a member with
    /// `MemberRole::Activity`.
    activity_groups: BTreeMap<u64, Vec<u64>>,

    /// Mirror of the canonical cells-map key set (id → asset kind),
    /// maintained by the same note_* hooks that drive membership. Needed
    /// because the canonical container (`Vec<Cell>`) has no id index; the
    /// kind rides along as the raw canonical fact the policy classifies.
    present: HashMap<u64, AssetKind>,

    /// Staged residents' payloads (composition id → node-hydrated Cell) —
    /// members that are NOT in the canonical map.
    residents: HashMap<u64, Cell>,
    /// Off-stage resident candidates' payloads (refill/bench pool).
    resident_pool: HashMap<u64, Cell>,
    /// Every reservoir-origin outpoint currently represented by a
    /// composition id (staged or pooled) — D5 later-collision detection
    /// at canonical birth time.
    resident_outpoints: HashMap<OutPoint, u64>,
    /// Staged residents whose payload changed at a refresh that kept
    /// membership identical — re-ride `enter_cells` once so delta
    /// followers converge with fresh snapshots.
    resident_reenter: BTreeSet<u64>,

    /// Per-mutation coalescing log: id → was-member at first touch this
    /// mutation. Diffed against final membership at flush.
    touched: HashMap<u64, bool>,
}

impl Stage {
    fn new(budget: DisplayBudget, activity_quota: usize) -> Self {
        Self {
            budget,
            activity_quota,
            members: BTreeMap::new(),
            resting_count: 0,
            activity_count: 0,
            activity_groups: BTreeMap::new(),
            present: HashMap::new(),
            residents: HashMap::new(),
            resident_pool: HashMap::new(),
            resident_outpoints: HashMap::new(),
            resident_reenter: BTreeSet::new(),
            touched: HashMap::new(),
        }
    }

    // ── facts the policy reads ───────────────────────────────────────

    pub(crate) fn budget_cells(&self) -> usize {
        self.budget.cells as usize
    }

    pub(crate) fn activity_quota(&self) -> usize {
        self.activity_quota
    }

    /// The largest member count the stage can currently hold:
    /// `min(budget, everything stageable)`. Below it a new member fits
    /// without anyone giving way.
    pub(crate) fn dynamic_target(&self) -> usize {
        self.budget_cells()
            .min(self.present.len() + self.residents.len() + self.resident_pool.len())
    }

    pub(crate) fn member_count(&self) -> usize {
        self.members.len()
    }

    pub(crate) fn resting_count(&self) -> usize {
        self.resting_count
    }

    pub(crate) fn role_of(&self, id: u64) -> Option<MemberRole> {
        self.members.get(&id).copied()
    }

    pub(crate) fn is_member(&self, id: u64) -> bool {
        self.members.contains_key(&id)
    }

    pub(crate) fn is_present(&self, id: u64) -> bool {
        self.present.contains_key(&id)
    }

    pub(crate) fn present_count(&self) -> usize {
        self.present.len()
    }

    /// Canonical facts about a stageable id: the asset kind of the
    /// canonical cell, or of a resident's hydrated payload. `None` means
    /// the id is stale — GC'd or superseded.
    pub(crate) fn kind_of(&self, id: u64) -> Option<AssetKind> {
        self.present
            .get(&id)
            .copied()
            .or_else(|| self.residents.get(&id).map(|cell| cell.asset_kind))
            .or_else(|| self.resident_pool.get(&id).map(|cell| cell.asset_kind))
    }

    /// Whether a not-currently-staged id still has something to stage:
    /// a canonical cell or a pooled resident payload.
    pub(crate) fn is_stageable(&self, id: u64) -> bool {
        self.present.contains_key(&id) || self.resident_pool.contains_key(&id)
    }

    // ── membership moves the policy makes ────────────────────────────

    /// Stage an off-stage id as resting. A pooled resident payload (an id
    /// that is not canonical) comes on stage with it.
    pub(crate) fn stage_resting(&mut self, id: u64) {
        debug_assert!(!self.members.contains_key(&id), "{id} is already staged");
        if !self.present.contains_key(&id) {
            if let Some(payload) = self.resident_pool.remove(&id) {
                self.residents.insert(id, payload);
            }
        }
        self.members.insert(id, MemberRole::Resting);
        self.touched.entry(id).or_insert(false);
        self.resting_count += 1;
    }

    /// Stage an off-stage id as an activity member of `block`, consuming
    /// a quota slot.
    pub(crate) fn stage_activity(&mut self, block: u64, id: u64) {
        debug_assert!(!self.members.contains_key(&id), "{id} is already staged");
        self.members.insert(id, MemberRole::Activity { block });
        self.touched.entry(id).or_insert(false);
        self.activity_count += 1;
        self.activity_groups.entry(block).or_default().push(id);
    }

    /// Convert an activity member into a resting one in place: membership
    /// is unchanged (no wire noise) and its quota slot is freed.
    pub(crate) fn promote_to_resting(&mut self, id: u64) {
        let Some(MemberRole::Activity { block }) = self.members.get(&id).copied() else {
            debug_assert!(false, "{id} is not an activity member");
            return;
        };
        self.members.insert(id, MemberRole::Resting);
        self.activity_count -= 1;
        self.resting_count += 1;
        self.remove_from_activity_group(block, id);
    }

    /// Take a member off stage. A staged resident's payload parks in the
    /// pool so a later restore can re-ship it.
    pub(crate) fn unstage(&mut self, id: u64) -> Option<MemberRole> {
        let role = self.members.remove(&id)?;
        self.touched.entry(id).or_insert(true);
        match role {
            MemberRole::Resting => {
                self.resting_count -= 1;
                if let Some(payload) = self.residents.remove(&id) {
                    self.resident_pool.insert(id, payload);
                }
            }
            MemberRole::Activity { block } => {
                self.activity_count -= 1;
                self.remove_from_activity_group(block, id);
            }
        }
        Some(role)
    }

    // ── mechanism-owned bookkeeping ──────────────────────────────────

    /// Mirror a canonical arrival. Returns the previous kind when the id
    /// was already present (an in-place resurrection — a no-op).
    fn note_present(&mut self, cell: &Cell) -> Option<AssetKind> {
        self.present.insert(cell.id, cell.asset_kind)
    }

    /// Mirror a canonical removal. Returns `None` when the id was not in
    /// the map (nothing to do).
    fn forget_present(&mut self, id: u64) -> Option<AssetKind> {
        self.present.remove(&id)
    }

    /// D5 later-collision probe: the composition id representing
    /// `out_point`, if any. Claimed (removed from the index) by the call.
    fn take_resident_for_outpoint(&mut self, out_point: &OutPoint) -> Option<u64> {
        self.resident_outpoints.remove(out_point)
    }

    fn is_staged_resident(&self, id: u64) -> bool {
        self.residents.contains_key(&id)
    }

    /// Forget a resident payload entirely (superseded by a canonical
    /// birth of the same outpoint, or spent — it must never restage).
    fn discard_resident(&mut self, id: u64) {
        self.residents.remove(&id);
        self.resident_pool.remove(&id);
    }

    /// Park a supplied off-map cell where the policy can reach it,
    /// returning the id it is reachable under. `None` when the stage
    /// already represents that outpoint or that id — invariant I4 holds
    /// for supply exactly as it does for a refresh.
    fn offer_resident(&mut self, cell: &Cell) -> Option<u64> {
        if self.resident_outpoints.contains_key(&cell.out_point) {
            return None;
        }
        if self.present.contains_key(&cell.id) || self.members.contains_key(&cell.id) {
            return None;
        }
        self.resident_outpoints
            .insert(cell.out_point.clone(), cell.id);
        self.resident_pool.insert(cell.id, cell.clone());
        Some(cell.id)
    }

    /// Drop an offered candidate the policy declined and that no refill
    /// queue holds — it would otherwise sit in the pool unreachable.
    fn withdraw_offer(&mut self, id: u64) {
        if let Some(cell) = self.resident_pool.remove(&id) {
            self.resident_outpoints.remove(&cell.out_point);
        }
    }

    /// Activity members in FIFO order (oldest block first).
    pub(crate) fn standing_activity(&self) -> Vec<(u64, u64)> {
        self.activity_groups
            .iter()
            .flat_map(|(block, ids)| ids.iter().map(move |id| (*block, *id)))
            .collect()
    }

    fn activity_over_quota(&self) -> bool {
        self.activity_count > self.activity_quota
    }

    /// Evict the oldest-block activity member, returning it with the
    /// block that keyed its FIFO slot. Only activity structures are
    /// drained — resting members are never evicted for activity.
    fn evict_oldest_activity(&mut self) -> Option<(u64, u64)> {
        loop {
            let mut entry = self.activity_groups.first_entry()?;
            let block = *entry.key();
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
            return Some((block, id));
        }
    }

    /// Everyone leaves, through the touched log (the flush coalesces the
    /// exits with whatever re-enters). Presence and payloads are the
    /// caller's to settle.
    pub(crate) fn exit_all_members(&mut self) {
        for id in self.members.keys() {
            self.touched.entry(*id).or_insert(true);
        }
        self.members.clear();
        self.resting_count = 0;
        self.activity_count = 0;
        self.activity_groups.clear();
    }

    /// Forget the whole canonical mirror (reset / restore).
    fn forget_all_presence(&mut self) {
        self.present.clear();
    }

    /// Drop every resident payload — a degrade back to canonical staffing
    /// (residents only exist while a reservoir does).
    fn clear_residents(&mut self) {
        self.residents.clear();
        self.resident_pool.clear();
        self.resident_outpoints.clear();
        self.resident_reenter.clear();
    }

    /// Install a freshly composed membership: diff it against what is on
    /// stage (exits first so the touched log pairs them with re-enters),
    /// then take over the resident payloads. Every installed member is
    /// resting; standing activity is re-layered by the caller.
    fn install_composed(&mut self, fill: CompositionFill) {
        let old_residents = std::mem::take(&mut self.residents);
        self.resident_pool.clear();
        self.resident_outpoints.clear();
        self.resident_reenter.clear();

        let mut new_members: BTreeMap<u64, ()> = BTreeMap::new();
        for (id, payload) in &fill.members {
            new_members.insert(*id, ());
            if let Some(payload) = payload {
                // A staged resident whose payload changed while its
                // membership held must re-ride enter_cells once.
                if self.members.contains_key(id)
                    && old_residents.get(id).is_some_and(|old| old != payload)
                {
                    self.resident_reenter.insert(*id);
                }
            }
        }

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

        for (id, payload) in fill.members {
            if let Some(payload) = payload {
                self.resident_outpoints
                    .insert(payload.out_point.clone(), id);
                self.residents.insert(id, payload);
            }
        }
        for (id, payload) in fill.pool {
            self.resident_outpoints
                .insert(payload.out_point.clone(), id);
            self.resident_pool.insert(id, payload);
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

    /// Every staged resident payload, ascending id — the snapshot's
    /// resident section.
    fn staged_residents_sorted(&self) -> Vec<Cell> {
        let mut cells: Vec<Cell> = self
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

    /// Staged-resident payload for emission: the stored hydrated cell
    /// with its position re-derived from the id (`helix_seed_for`), the
    /// same recompute-on-emit rule every canonical snapshot cell obeys.
    fn resident_payload(&self, id: u64) -> Option<Cell> {
        let cell = self.residents.get(&id)?;
        Some(Cell {
            pos_seed: helix_seed_for(id),
            ..cell.clone()
        })
    }
}

/// Borrowed display plane for the columnar wire form. Ids and payload
/// references only; nothing here is cloned.
pub struct ColumnarDisplayView<'a> {
    pub budget: DisplayBudget,
    pub provenance: &'a DisplayProvenance,
    /// Staged member ids, ascending.
    pub members: Vec<u64>,
    /// Staged resident payloads, ascending id — the rows that follow the
    /// canonical ones in the row block.
    pub residents: Vec<&'a Cell>,
}

/// See the module docs. Owned by `CellGalaxy`; every canonical handler
/// reports births/removals/endpoints as they happen and `apply_mutation`
/// calls [`DisplayPlane::flush`] exactly once at the end — which is what
/// structurally guarantees "at most one `Display` delta per mutation".
pub(crate) struct DisplayPlane {
    stage: Stage,
    /// Who *should* be on stage. `CanonicalPolicy` = prefix mode,
    /// `CuratedPolicy` = composed mode.
    policy: Box<dyn CompositionPolicy + Send + Sync>,

    /// Tx endpoints reported this mutation, in arrival order.
    pending_activity: Vec<(u64, u64)>, // (block, id)

    /// Where the policy's shortfall is published for an outside supplier
    /// to act on. `None` — the default, and the only state a CKB-only
    /// deployment ever sees — means nobody is listening and the plane
    /// behaves exactly as it did before demand existed.
    demand_sink: Option<Arc<CompositionDemandSink>>,

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
        debug_assert!(
            budget.cells as usize >= activity_quota,
            "budget must cover the quota"
        );
        let stage = Stage::new(budget, activity_quota);
        let policy = Self::prefix_policy(&stage);
        Self {
            stage,
            policy,
            pending_activity: Vec::new(),
            demand_sink: None,
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

    /// Attach the sink the policy publishes its shortfall to. Wired once
    /// at construction; the same sink goes to whoever can supply cells.
    pub(crate) fn set_demand_sink(&mut self, sink: Arc<CompositionDemandSink>) {
        self.demand_sink = Some(sink);
    }

    fn prefix_policy(stage: &Stage) -> Box<dyn CompositionPolicy + Send + Sync> {
        Box::new(CanonicalPolicy::new(
            stage.budget_cells(),
            stage.activity_quota(),
        ))
    }

    // ── hooks (called by CellGalaxy handlers mid-mutation) ───────────

    /// A cell entered the canonical map (fresh birth, reorg revival, or
    /// rollback resurrection). Idempotent: in-place resurrections of an
    /// id that never left the map are no-ops. This is also the D5
    /// later-collision point: a birth claiming an outpoint held by a
    /// reservoir entry supersedes it (a STAGED resident swaps out in
    /// place — same slot, same class; a pooled candidate is dropped).
    pub(crate) fn note_birth(&mut self, cell: &Cell) {
        if self.stage.note_present(cell).is_some() {
            return;
        }
        if let Some(rid) = self.stage.take_resident_for_outpoint(&cell.out_point) {
            if self.stage.is_staged_resident(rid) {
                self.stage.unstage(rid);
                self.stage.discard_resident(rid);
                self.stage.stage_resting(cell.id);
                self.policy
                    .note_resident_retired(&self.stage, rid, Some(cell.id));
                return;
            }
            self.stage.discard_resident(rid);
            self.policy.note_resident_retired(&self.stage, rid, None);
        }
        self.policy.note_candidate(&self.stage, cell.id);
    }

    /// A cell left the canonical map — this must cover EVERY removal
    /// path (GC sweep, reorg parking, reset). Staged members exit here;
    /// the vacancy backfills at the next flush.
    pub(crate) fn note_removed(&mut self, id: u64) {
        if self.stage.forget_present(id).is_none() {
            return;
        }
        // A stale refill-queue entry (if any) is skipped at pop.
        let Some(role) = self.stage.unstage(id) else {
            return;
        };
        self.policy.note_exit(&mut self.stage, id, role);
    }

    /// A tx input that resolved to nothing canonical. Almost always an
    /// ordinary spend of a cell outside the retained window — but it is
    /// also the ONLY way the server learns that a staged resident died,
    /// because a resident is by definition an outpoint the canonical map
    /// does not hold, so `handle_tx_landed`'s index lookup can never see
    /// it. A hit retires the resident: it leaves the stage (or the
    /// candidate pool) and its composition id can never stage again. The
    /// vacancy refills from the policy at the next flush.
    ///
    /// Not reversed by a reorg (design D6): a rollback revives canonical
    /// cells through the ordinary birth path, but a retired resident
    /// stays retired. Showing one fewer of the cells we *could* have
    /// shown is a different sample; showing a cell that has been spent is
    /// a lie — the two errors are not symmetric, and the next top-up
    /// fills the slot anyway.
    ///
    /// Returns the retired resident's id when the outpoint was ours. That
    /// id was probed against the admitted set at composition time, so it
    /// may diverge from the outpoint's own derivation — the caller anchors
    /// the consumed input on this one, which is where the cell actually
    /// rendered.
    pub(crate) fn note_input_unresolved(&mut self, out_point: &OutPoint) -> Option<u64> {
        let rid = self.stage.take_resident_for_outpoint(out_point)?; // usually not ours
        if self.stage.is_staged_resident(rid) {
            self.stage.unstage(rid);
        }
        self.stage.discard_resident(rid);
        self.policy.note_resident_retired(&self.stage, rid, None);
        Some(rid)
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
        let was_composed = self.policy.reservoir().is_some();
        self.stage.exit_all_members();
        self.stage.forget_all_presence();
        self.stage.clear_residents();
        self.pending_activity.clear();
        self.policy = Self::prefix_policy(&self.stage);
        if was_composed {
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
        self.backfill_baseline = Some(self.stage.members.keys().copied().collect());
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
        self.stage.exit_all_members();
        self.stage.forget_all_presence();
        self.stage.clear_residents();
        self.stage.touched.clear();
        self.policy = Self::prefix_policy(&self.stage);
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
            if self.stage.note_present(cell).is_none() {
                self.policy.note_candidate(&self.stage, cell.id);
            }
        }
        self.policy.fill_vacancies(&mut self.stage);
        self.stage.touched.clear();
        if !self.stage.members.is_empty() {
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
    /// no delta, provenance frozen. Otherwise a fresh
    /// [`CuratedPolicy`] decides the new membership, standing activity
    /// members re-layer via its in-class substitution, and the one
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
        if self
            .policy
            .reservoir()
            .is_some_and(|stored| stored.content_matches(record))
        {
            // Duplicate revalidation: broadcast nothing and keep the
            // stored record exactly as previously applied, so fresh
            // snapshots match delta subscribers and the reorg-degrade
            // predicate evaluates identically everywhere. Every degrade
            // path nulls the stored reservoir, re-arming this.
            return;
        }

        let (policy, fill) =
            CuratedPolicy::compose(record, outpoint_index, cells, self.stage.budget_cells());
        let standing_activity = self.stage.standing_activity();
        self.stage.install_composed(fill);
        self.policy = Box::new(policy);

        // Re-layer standing activity endpoints (FIFO order) through the
        // new policy. An endpoint inside the new fill simply stays
        // resting (its quota slot dissolves).
        for (block, id) in standing_activity {
            if self.stage.is_member(id) || !self.stage.is_present(id) {
                continue;
            }
            self.policy.admit_activity(&mut self.stage, block, id);
        }

        // Provenance: composed, stamped with the record's own clock.
        self.provenance = DisplayProvenance {
            mode: DisplayMode::Composed,
            source: Some(record.source.clone()),
            as_of: Some(record.as_of.clone()),
            updated_at_ms: record.updated_at_ms,
        };
        self.provenance_pending = true;
        self.provenance_force = true;
    }

    /// Additive supply (D6 arrival, `Mutation::GalaxyReservoirToppedUp`):
    /// cells found for the classes this stage said it was short of.
    ///
    /// Unlike a refresh this recomputes nothing. Each supplied cell is
    /// resolved the same way a refresh resolves its reservoir — an
    /// outpoint the canonical map holds becomes that canonical member,
    /// anything else becomes a resident under its composition id — and
    /// then offered to the policy, which decides how many fit and who
    /// gives way. A supply arriving while the plane is in prefix mode
    /// (a degrade raced the tick) is declined in full and dropped.
    ///
    /// `outpoint_index` is the canonical resolver at the call boundary.
    pub(crate) fn reservoir_topped_up(
        &mut self,
        top_up: &GalaxyCompositionTopUp,
        outpoint_index: &HashMap<OutPoint, u64>,
    ) {
        let mut offered: Vec<u64> = Vec::with_capacity(top_up.len());
        let mut seen: HashSet<u64> = HashSet::new();
        let mut parked: HashSet<u64> = HashSet::new();
        for cell in top_up.dao.iter().chain(top_up.typed.iter()) {
            match outpoint_index.get(&cell.out_point) {
                Some(&canonical_id) => {
                    // Retained canonically after the tick fetched it: use
                    // the canonical identity, never a second id for one
                    // outpoint (invariant I4). A supplier that repeats an
                    // outpoint offers it once.
                    if !self.stage.is_member(canonical_id) && seen.insert(canonical_id) {
                        offered.push(canonical_id);
                    }
                }
                None => {
                    if let Some(id) = self.stage.offer_resident(cell) {
                        parked.insert(id);
                        seen.insert(id);
                        offered.push(id);
                    }
                }
            }
        }
        let declined = self.policy.supply(&mut self.stage, &offered);
        for id in declined {
            if parked.contains(&id) {
                self.stage.withdraw_offer(id);
            }
        }
    }

    /// Reorg hook (explicit `ChainReorganized` or an implicit
    /// hash-mismatch rollback): a boundary at or below the reservoir
    /// anchor invalidates the composition — drop it, rebuild prefix
    /// membership from the (already rolled back) canonical container,
    /// and ride mode-Canonical provenance on the coalesced delta. The
    /// content dedup re-arms (a later identical record applies again).
    pub(crate) fn chain_reorganized(&mut self, from_block: u64, cells: &[Cell]) {
        let anchored_below = self
            .policy
            .reservoir()
            .is_some_and(|stored| from_block <= stored.as_of.block);
        if !anchored_below {
            return;
        }
        self.stage.clear_residents();
        let mut policy =
            CanonicalPolicy::new(self.stage.budget_cells(), self.stage.activity_quota());
        policy.rebuild(&mut self.stage, cells);
        self.policy = Box::new(policy);
        self.provenance = DisplayProvenance {
            mode: DisplayMode::Canonical,
            source: None,
            as_of: None,
            updated_at_ms: self.last_at_ms,
        };
        self.provenance_pending = true;
        self.provenance_force = true;
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
        self.policy.fill_vacancies(&mut self.stage);

        // 2. Activity entries — suppressed during historical replay
        //    (calm catch-up; the terminal resettle presents the final
        //    membership in one piece).
        if self.backfill_active {
            self.pending_activity.clear();
        } else {
            let pending = std::mem::take(&mut self.pending_activity);
            for (block, id) in pending {
                if self.stage.is_member(id) || !self.stage.is_present(id) {
                    continue; // already on stage / defensive: unknown id
                }
                self.policy.admit_activity(&mut self.stage, block, id);
            }
            // 3. Quota: evict oldest-block activity members first. In
            //    composed mode an eviction restores the member the leaver
            //    displaced.
            while self.stage.activity_over_quota() {
                let Some((block, id)) = self.stage.evict_oldest_activity() else {
                    break;
                };
                self.policy
                    .note_exit(&mut self.stage, id, MemberRole::Activity { block });
            }
            // Unrestorable benches leave resting vacancies inside this
            // same mutation — repair before emitting. (A prefix-mode
            // second pass is a no-op: activity never displaces resting.)
            self.policy.fill_vacancies(&mut self.stage);
        }

        // 4. Publish what the policy is still short of. After the fills,
        //    so it reflects everything this mutation could close on its
        //    own; before the backfill return, so a long replay keeps the
        //    number honest.
        if let Some(sink) = &self.demand_sink {
            sink.publish(self.policy.demand(&self.stage));
        }

        if self.backfill_active {
            self.stage.touched.clear();
            return None;
        }

        let (enter, exit_ids) = if self.resettle_pending {
            self.resettle_pending = false;
            self.stage.touched.clear();
            let baseline = self.backfill_baseline.take().unwrap_or_default();
            // Both sides iterate ordered sets → sorted output.
            let enter: Vec<u64> = self
                .stage
                .members
                .keys()
                .filter(|id| !baseline.contains(id))
                .copied()
                .collect();
            let exit: Vec<u64> = baseline
                .iter()
                .filter(|id| !self.stage.members.contains_key(id))
                .copied()
                .collect();
            (enter, exit)
        } else {
            let mut ids: Vec<(u64, bool)> = std::mem::take(&mut self.stage.touched)
                .into_iter()
                .collect();
            // The touched log is a HashMap — sort so iteration order can
            // never leak into wire bytes.
            ids.sort_unstable_by_key(|(id, _)| *id);
            let mut enter = Vec::new();
            let mut exit = Vec::new();
            for (id, was) in ids {
                let now = self.stage.is_member(id);
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

        let resident_reenter = std::mem::take(&mut self.stage.resident_reenter);

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
                self.stage.is_present(id),
                self.stage.is_staged_resident(id),
                "member {id} must be exactly one of canonical or resident"
            );
            match self.stage.resident_payload(id) {
                Some(cell) => {
                    carried.insert(id);
                    enter_cells.push(cell);
                }
                None => enter_ids.push(id),
            }
        }
        for id in resident_reenter {
            if !carried.contains(&id) {
                if let Some(cell) = self.stage.resident_payload(id) {
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

    /// The display plane as the columnar encoder needs it: borrows only,
    /// so building a binary snapshot never clones a resident payload.
    /// Membership and resident order match [`Self::section`] exactly
    /// (ascending id both times) — the two wire forms describe one stage.
    pub(crate) fn columnar_view(&self) -> ColumnarDisplayView<'_> {
        let mut residents: Vec<&Cell> = self.stage.residents.values().collect();
        residents.sort_unstable_by_key(|cell| cell.id);
        ColumnarDisplayView {
            budget: self.stage.budget,
            provenance: &self.provenance,
            members: self.stage.members.keys().copied().collect(),
            residents,
        }
    }

    /// Snapshot section: members in the plane's deterministic order
    /// (ascending id), staged resident payloads (ascending id, position
    /// re-derived like every canonical snapshot cell), current
    /// provenance, fixed budget.
    /// Whether this id is on stage. Used by the staged snapshot scope to
    /// decide which retained rows are worth shipping.
    pub(crate) fn is_staged(&self, id: u64) -> bool {
        self.stage.is_member(id)
    }

    pub(crate) fn section(&self) -> DisplaySection {
        DisplaySection {
            budget: self.stage.budget,
            members: self.stage.members.keys().copied().collect(),
            residents: self.stage.staged_residents_sorted(),
            provenance: self.provenance.clone(),
        }
    }

    // ── test accessors ───────────────────────────────────────────────

    #[cfg(test)]
    pub(crate) fn member_ids_sorted(&self) -> Vec<u64> {
        self.stage.members.keys().copied().collect()
    }

    #[cfg(test)]
    pub(crate) fn present_ids_sorted(&self) -> Vec<u64> {
        let mut ids: Vec<u64> = self.stage.present.keys().copied().collect();
        ids.sort_unstable();
        ids
    }

    #[cfg(test)]
    pub(crate) fn resting_len(&self) -> usize {
        self.stage.resting_count
    }

    #[cfg(test)]
    pub(crate) fn activity_len(&self) -> usize {
        self.stage.activity_count
    }

    #[cfg(test)]
    pub(crate) fn is_activity_member(&self, id: u64) -> bool {
        matches!(self.stage.role_of(id), Some(MemberRole::Activity { .. }))
    }

    #[cfg(test)]
    pub(crate) fn mode(&self) -> DisplayMode {
        self.provenance.mode
    }

    #[cfg(test)]
    pub(crate) fn resident_ids_sorted(&self) -> Vec<u64> {
        let mut ids: Vec<u64> = self.stage.residents.keys().copied().collect();
        ids.sort_unstable();
        ids
    }

    #[cfg(test)]
    pub(crate) fn class_counts(&self) -> [usize; 3] {
        self.policy.class_counts()
    }

    #[cfg(test)]
    pub(crate) fn queued_len(&self) -> usize {
        self.policy.queued_len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::enrichment::ChainAnchor;
    use crate::projection::composition_policy::CompositionDemand;

    /// Both budgets are the product's, not the server's, and the browser
    /// keeps its own copy for the boot path that runs before a snapshot has
    /// arrived: `AUTO_CELL_DISPLAY_BUDGET` in
    /// `packages/ui/src/tweaks/cellDisplay.ts` and `NERVE_SCREEN_BUDGET` in
    /// `packages/ui/src/geometry/passiveNeighborGraph.ts`. Each of those has
    /// the mirror-image assert naming this test, so a retune that lands on
    /// one side fails on the other.
    #[test]
    fn display_budgets_match_their_client_mirrors() {
        assert_eq!(DISPLAY_CELL_BUDGET, 12_000);
        assert_eq!(DISPLAY_NERVE_EDGE_BUDGET, 8_000);
    }

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

    fn top_up(block: u64, dao: Vec<Cell>, typed: Vec<Cell>) -> GalaxyCompositionTopUp {
        GalaxyCompositionTopUp {
            source: "ckbadger".into(),
            as_of: ChainAnchor {
                block,
                hash: format!("0xblock{block}"),
            },
            updated_at_ms: block * 10,
            dao,
            typed,
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

    // ═══ T2 demand ═══════════════════════════════════════════════════

    fn with_sink(plane: &mut DisplayPlane) -> Arc<CompositionDemandSink> {
        let sink = Arc::new(CompositionDemandSink::new());
        plane.set_demand_sink(sink.clone());
        sink
    }

    /// The mainnet pathology this iteration exists to fix, reproduced at
    /// full budget: a 6K reservoir plus a retained map that is ~99% plain
    /// composes to roughly 1.8K/2.8K/7.3K instead of 3600/4800/3600,
    /// because dao and typed simply run out of candidates.
    ///
    /// Demand must be measured against the IDEAL quota. Against
    /// `class_targets` — what this refresh actually landed on — it would
    /// read zero forever and the lopsided stage would look healthy.
    #[test]
    fn demand_measures_the_ideal_quota_not_the_ratio_this_refresh_landed_on() {
        let mut plane = small_plane(12_000, 512);
        let sink = with_sink(&mut plane);

        // Retained canonical window, mainnet-shaped: a handful of dao,
        // a few hundred typed, everything else plain.
        let mut canonical: Vec<Cell> = Vec::new();
        for i in 0..48 {
            canonical.push(cell_with(
                1_000_000 + i,
                &format!("0xcd{i}"),
                AssetKind::Dao,
                0,
            ));
        }
        for i in 0..412 {
            canonical.push(cell_with(
                2_000_000 + i,
                &format!("0xct{i}"),
                AssetKind::Xudt,
                0,
            ));
        }
        for i in 0..8_000 {
            canonical.push(cell_with(
                3_000_000 + i,
                &format!("0xcp{i}"),
                AssetKind::Native,
                0,
            ));
        }
        seed_canonical(&mut plane, &canonical, 500);
        assert_eq!(
            sink.read(),
            CompositionDemand::default(),
            "a prefix stage asks for nothing"
        );

        // The 6K reservoir, at its 30:40:30 split.
        let rec = record(
            10,
            (0..1_800)
                .map(|i| cell_with(10_000 + i, &format!("0xrd{i}"), AssetKind::Dao, 0))
                .collect(),
            (0..2_400)
                .map(|i| cell_with(20_000 + i, &format!("0xrt{i}"), AssetKind::Xudt, 0))
                .collect(),
            (0..1_800)
                .map(|i| cell_with(30_000 + i, &format!("0xrp{i}"), AssetKind::Native, 0))
                .collect(),
        );
        plane.reservoir_replaced(&rec, &outpoint_index(&canonical), &canonical);
        plane.flush(Some(1_000));

        // dao/typed take everything they have; plain absorbs the rest of
        // the budget through the spill.
        assert_eq!(plane.class_counts(), [1_848, 2_812, 7_340]);
        assert_eq!(
            plane.class_counts().iter().sum::<usize>(),
            12_000,
            "the stage is full — the shortfall is in the RATIO, not the count"
        );

        let demand = sink.read();
        assert!(demand.curated);
        assert_eq!(demand.dao, 3_600 - 1_848);
        assert_eq!(demand.typed, 4_800 - 2_812);
        assert_eq!(demand.total(), 3_740);
        assert!(!demand.is_empty());
    }

    /// Demand is a function of what is staged, so closing the gap closes
    /// the demand — and plain never appears in it at all (D5).
    #[test]
    fn demand_tracks_staged_counts_and_ignores_plain() {
        let mut plane = small_plane(10, 2);
        let sink = with_sink(&mut plane);
        // targets(10) = {3,4,3}. Give dao 2 and typed 4, plain plenty.
        let rec = record(
            10,
            (1..=2)
                .map(|i| cell_with(100 + i, &format!("0xd{i}"), AssetKind::Dao, 0))
                .collect(),
            (1..=4)
                .map(|i| cell_with(200 + i, &format!("0xt{i}"), AssetKind::Xudt, 0))
                .collect(),
            (1..=9)
                .map(|i| cell_with(300 + i, &format!("0xp{i}"), AssetKind::Native, 0))
                .collect(),
        );
        plane.reservoir_replaced(&rec, &HashMap::new(), &[]);
        plane.flush(Some(1_000));
        assert_eq!(
            plane.class_counts(),
            [2, 4, 4],
            "dao short by one, plain over"
        );
        assert_eq!(
            sink.read(),
            CompositionDemand {
                curated: true,
                dao: 1,
                typed: 0,
            },
            "typed is satisfied; plain is over quota and still never asked for"
        );

        // Spending a staged dao widens the gap by exactly one.
        plane.note_input_unresolved(&OutPoint {
            tx_hash: "0xd1".into(),
            index: 0,
        });
        plane.flush(Some(2_000));
        assert_eq!(sink.read().dao, 2);
    }

    /// Falling back to canonical staffing — degrade, or a rebuild reset —
    /// zeroes the demand: there is nobody left to satisfy.
    #[test]
    fn leaving_composed_mode_zeroes_the_demand() {
        let mut plane = small_plane(10, 2);
        let sink = with_sink(&mut plane);
        let canonical = canonical_field(4);
        seed_canonical(&mut plane, &canonical, 500);
        let rec = record(
            10,
            vec![cell_with(1_001, "0xrd", AssetKind::Dao, 0)],
            vec![cell_with(2_001, "0xrt", AssetKind::Xudt, 0)],
            vec![cell_with(3_001, "0xrp", AssetKind::Native, 0)],
        );
        plane.reservoir_replaced(&rec, &outpoint_index(&canonical), &canonical);
        plane.flush(Some(1_000));
        assert!(sink.read().curated && !sink.read().is_empty());

        plane.chain_reorganized(10, &canonical);
        plane.flush(Some(1_100));
        assert_eq!(sink.read(), CompositionDemand::default(), "degrade");

        // And again through a rebuild reset from a fresh composition.
        plane.reservoir_replaced(&rec, &outpoint_index(&canonical), &canonical);
        plane.flush(Some(1_200));
        assert!(sink.read().curated);
        plane.note_reset();
        plane.flush(Some(1_300));
        assert_eq!(sink.read(), CompositionDemand::default(), "reset");
    }

    /// The sink is an observer. Wiring one must not shift a single byte
    /// of what the plane emits — the CKB-only path leaves it unwired.
    #[test]
    fn publishing_demand_does_not_disturb_the_wire() {
        let script = |plane: &mut DisplayPlane| {
            let canonical = canonical_field(24);
            seed_canonical(plane, &canonical, 500);
            let rec = record(
                10,
                vec![cell_with(1_001, "0xrd", AssetKind::Dao, 0)],
                vec![cell_with(2_001, "0xrt", AssetKind::Xudt, 0)],
                vec![cell_with(3_001, "0xrp", AssetKind::Native, 0)],
            );
            plane.reservoir_replaced(&rec, &outpoint_index(&canonical), &canonical);
            let mut log: Vec<String> = Vec::new();
            for step in 0..8u64 {
                plane.note_activity(20 + step, [step % 24]);
                if step == 3 {
                    plane.note_input_unresolved(&OutPoint {
                        tx_hash: "0xrt".into(),
                        index: 0,
                    });
                }
                if step == 5 {
                    plane.note_removed(step);
                }
                let delta = plane.flush(Some(1_000 + step * 10));
                log.push(serde_json::to_string(&delta).unwrap());
                log.push(serde_json::to_string(&plane.section()).unwrap());
            }
            log
        };

        let mut bare = small_plane(12, 2);
        let quiet = script(&mut bare);
        let mut wired = small_plane(12, 2);
        let sink = with_sink(&mut wired);
        let observed = script(&mut wired);

        assert_eq!(
            quiet, observed,
            "the sink is write-only, never a feedback loop"
        );
        assert!(sink.read().curated, "…and it did publish");
    }

    // ═══ T4 supply + the one-way ratchet ═════════════════════════════

    /// Supplied cells that a plain over-allocation makes room for. The
    /// displaced plain member is a canonical-fallback admit, and it goes
    /// back to the FRONT of its own queue so the next plain vacancy
    /// takes it first.
    #[test]
    fn supply_displaces_an_over_quota_fallback_member() {
        let mut plane = small_plane(10, 2);
        // targets(10) = {3,4,3}. An all-plain canonical map composes to
        // 10 plain members, every one a fallback admit.
        let canonical: Vec<Cell> = (0..10)
            .map(|id| cell_with(id, &format!("0xc{id}"), AssetKind::Native, 0))
            .collect();
        seed_canonical(&mut plane, &canonical, 500);
        plane.reservoir_replaced(
            &record(10, vec![], vec![], vec![]),
            &outpoint_index(&canonical),
            &canonical,
        );
        plane.flush(Some(1_000));
        assert_eq!(
            plane.class_counts(),
            [0, 0, 10],
            "plain owns the whole stage"
        );

        // Two dao arrive. Plain is 7 over quota, so it yields twice —
        // latest-admitted first (9, then 8).
        let supply = top_up(
            20,
            vec![
                cell_with(9_001, "0xs1", AssetKind::Dao, 0),
                cell_with(9_002, "0xs2", AssetKind::Dao, 0),
            ],
            vec![],
        );
        plane.reservoir_topped_up(&supply, &outpoint_index(&canonical));
        let (enter_ids, enter_cells, exit, _) = full_delta_parts(plane.flush(Some(2_000)));
        assert!(enter_ids.is_empty(), "supplied cells are off-map residents");
        assert_eq!(
            enter_cells.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![9_001, 9_002]
        );
        assert_eq!(exit, vec![8, 9], "the two latest plain fallback admits");
        assert_eq!(plane.class_counts(), [2, 0, 8]);
        assert_eq!(member_set(&plane).len(), 10, "the stage stays exactly full");

        // A plain vacancy restores a displaced member ahead of any other
        // candidate. Displacement takes the LOWEST-priority member first
        // (9 before 8) and each one goes to the front, so the queue ends
        // up ordered by descending priority: 8 comes back before 9.
        plane.note_removed(0);
        let (enter, exit, _) = delta_parts(plane.flush(Some(3_000)));
        assert_eq!(exit, vec![0]);
        assert_eq!(
            enter,
            vec![8],
            "the higher-ranked of the two displaced returns first"
        );
        plane.note_removed(1);
        let (enter, _, _) = delta_parts(plane.flush(Some(3_100)));
        assert_eq!(enter, vec![9], "then the other one");
    }

    /// The ratchet: a curated member is never traded for another curated
    /// member. Once a class holds nothing but reservoir admits it yields
    /// nobody, and the supply stops instead of churning.
    #[test]
    fn supply_never_displaces_a_curated_member() {
        let mut plane = small_plane(4, 1);
        // A reservoir that fills the whole stage: every member is a
        // RESERVOIR admit, so nobody may give way.
        let rec = record(
            10,
            vec![cell_with(1_001, "0xrd", AssetKind::Dao, 0)],
            vec![cell_with(2_001, "0xrt", AssetKind::Xudt, 0)],
            vec![
                cell_with(3_001, "0xrp1", AssetKind::Native, 0),
                cell_with(3_002, "0xrp2", AssetKind::Native, 0),
            ],
        );
        plane.reservoir_replaced(&rec, &HashMap::new(), &[]);
        plane.flush(Some(1_000));
        assert_eq!(member_set(&plane), [1_001, 2_001, 3_001, 3_002].into());
        assert_eq!(plane.class_counts(), [1, 1, 2]);

        // targets(4) = {1,1,2}: plain is at quota, dao is at quota. Even
        // so, offer more dao — nothing may be displaced for it.
        let supply = top_up(
            20,
            vec![cell_with(9_001, "0xs1", AssetKind::Dao, 0)],
            vec![],
        );
        plane.reservoir_topped_up(&supply, &HashMap::new());
        assert!(
            plane.flush(Some(2_000)).is_none(),
            "no room, no trade, no churn"
        );
        assert_eq!(plane.class_counts(), [1, 1, 2]);
        assert!(!member_set(&plane).contains(&9_001));
        assert!(
            !plane.resident_ids_sorted().contains(&9_001),
            "the declined candidate is let go, not left in the pool"
        );
    }

    /// Supply stops at the ideal quota — it fills the gap, it does not
    /// overshoot into someone else's share.
    #[test]
    fn supply_stops_at_the_ideal_quota() {
        let mut plane = small_plane(10, 2); // targets(10) = {3,4,3}
        let canonical: Vec<Cell> = (0..10)
            .map(|id| cell_with(id, &format!("0xc{id}"), AssetKind::Native, 0))
            .collect();
        seed_canonical(&mut plane, &canonical, 500);
        plane.reservoir_replaced(
            &record(10, vec![], vec![], vec![]),
            &outpoint_index(&canonical),
            &canonical,
        );
        plane.flush(Some(1_000));

        // Five dao offered against a quota of three.
        let supply = top_up(
            20,
            (1..=5)
                .map(|i| cell_with(9_000 + i, &format!("0xs{i}"), AssetKind::Dao, 0))
                .collect(),
            vec![],
        );
        plane.reservoir_topped_up(&supply, &outpoint_index(&canonical));
        plane.flush(Some(2_000));
        assert_eq!(plane.class_counts(), [3, 0, 7], "exactly the dao quota");
        assert_eq!(member_set(&plane).len(), 10);
    }

    /// ⭐ Convergence. Starting from the live mainnet shape and feeding
    /// bounded rounds of supply, the ratio must climb to 3600/4800/3600
    /// and MUST NOT oscillate on the way — every round is a monotone step
    /// and the member count never moves.
    #[test]
    fn bounded_rounds_converge_monotonically_to_the_quota() {
        let mut plane = small_plane(12_000, 512);
        let sink = with_sink(&mut plane);
        let mut canonical: Vec<Cell> = Vec::new();
        for i in 0..48 {
            canonical.push(cell_with(
                1_000_000 + i,
                &format!("0xcd{i}"),
                AssetKind::Dao,
                0,
            ));
        }
        for i in 0..412 {
            canonical.push(cell_with(
                2_000_000 + i,
                &format!("0xct{i}"),
                AssetKind::Xudt,
                0,
            ));
        }
        for i in 0..8_000 {
            canonical.push(cell_with(
                3_000_000 + i,
                &format!("0xcp{i}"),
                AssetKind::Native,
                0,
            ));
        }
        seed_canonical(&mut plane, &canonical, 500);
        let rec = record(
            10,
            (0..1_800)
                .map(|i| cell_with(10_000 + i, &format!("0xrd{i}"), AssetKind::Dao, 0))
                .collect(),
            (0..2_400)
                .map(|i| cell_with(20_000 + i, &format!("0xrt{i}"), AssetKind::Xudt, 0))
                .collect(),
            (0..1_800)
                .map(|i| cell_with(30_000 + i, &format!("0xrp{i}"), AssetKind::Native, 0))
                .collect(),
        );
        let index = outpoint_index(&canonical);
        plane.reservoir_replaced(&rec, &index, &canonical);
        plane.flush(Some(1_000));
        assert_eq!(plane.class_counts(), [1_848, 2_812, 7_340]);

        // Bounded rounds, exactly as the supervisor will drive them:
        // fetch at most 256 per class per tick, sized by the published
        // demand, until the demand closes.
        const PER_CLASS_PER_TICK: usize = 256;
        let mut previous = plane.class_counts();
        let mut supplied = 0u64;
        let mut rounds = 0;
        while !sink.read().is_empty() {
            rounds += 1;
            assert!(rounds < 40, "should converge in ~15 rounds, not spin");
            let demand = sink.read();
            let dao: Vec<Cell> = (0..demand.dao.min(PER_CLASS_PER_TICK))
                .map(|_| {
                    supplied += 1;
                    cell_with(
                        500_000 + supplied,
                        &format!("0xsd{supplied}"),
                        AssetKind::Dao,
                        0,
                    )
                })
                .collect();
            let typed: Vec<Cell> = (0..demand.typed.min(PER_CLASS_PER_TICK))
                .map(|_| {
                    supplied += 1;
                    cell_with(
                        500_000 + supplied,
                        &format!("0xst{supplied}"),
                        AssetKind::Xudt,
                        0,
                    )
                })
                .collect();
            plane.reservoir_topped_up(&top_up(20 + rounds, dao, typed), &index);
            plane.flush(Some(2_000 + rounds * 10));

            let now = plane.class_counts();
            assert!(
                now[0] >= previous[0],
                "dao round {rounds}: {previous:?} -> {now:?}"
            );
            assert!(
                now[1] >= previous[1],
                "typed round {rounds}: {previous:?} -> {now:?}"
            );
            assert!(
                now[2] <= previous[2],
                "plain round {rounds}: {previous:?} -> {now:?}"
            );
            assert_eq!(
                now.iter().sum::<usize>(),
                12_000,
                "round {rounds}: the stage is always exactly full"
            );
            assert!(now[0] <= 3_600 && now[1] <= 4_800, "never overshoots");
            previous = now;
        }
        assert_eq!(
            plane.class_counts(),
            [3_600, 4_800, 3_600],
            "30:40:30, reached"
        );
        assert!(sink.read().is_empty());
        assert!(rounds >= 8, "the bound really did spread it over rounds");
    }

    // ═══ T1 precise spend detection ══════════════════════════════════

    /// A staged resident's outpoint is spent on chain. The server can
    /// never see this through the canonical map (a resident is by
    /// definition off-map), so the unresolved-input hook is the only
    /// signal — and it must retire the resident and refill IN CLASS.
    #[test]
    fn spending_a_staged_resident_exits_it_and_refills_in_class() {
        let mut plane = small_plane(4, 1);
        let canonical = vec![
            cell_with(0, "0xa", AssetKind::Dao, 0),
            cell_with(1, "0xb", AssetKind::Xudt, 0),
            cell_with(2, "0xc", AssetKind::Native, 0),
            cell_with(3, "0xd", AssetKind::Native, 0),
        ];
        seed_canonical(&mut plane, &canonical, 500);
        // targets(4) = {1,1,2}: dao [0], typed [1], plain [301, 2];
        // the plain refill queue holds the unchosen canonical 3.
        let rec = record(
            10,
            vec![],
            vec![],
            vec![cell_with(301, "0xp1", AssetKind::Native, 0)],
        );
        plane.reservoir_replaced(&rec, &outpoint_index(&canonical), &canonical);
        plane.flush(Some(1_000));
        assert_eq!(member_set(&plane), [0, 1, 2, 301].into());
        assert_eq!(plane.resident_ids_sorted(), vec![301]);

        plane.note_input_unresolved(&OutPoint {
            tx_hash: "0xp1".into(),
            index: 0,
        });
        let (enter, exit, _) = delta_parts(plane.flush(Some(2_000)));
        assert_eq!(exit, vec![301], "the spent resident leaves the stage");
        assert_eq!(enter, vec![3], "and its slot refills from the SAME class");
        assert_eq!(member_set(&plane), [0, 1, 2, 3].into());
        assert!(plane.resident_ids_sorted().is_empty());
        assert_eq!(plane.class_counts(), [1, 1, 2], "the ratio is preserved");
    }

    /// Spending a candidate that is only POOLED changes nothing on the
    /// wire, but it must never be staged afterwards — a later vacancy
    /// skips it and takes the next queue entry instead.
    #[test]
    fn spending_a_pooled_candidate_keeps_it_off_the_stage_for_good() {
        let mut plane = small_plane(4, 1);
        let canonical = vec![
            cell_with(0, "0xa", AssetKind::Dao, 0),
            cell_with(1, "0xb", AssetKind::Xudt, 0),
            cell_with(2, "0xc", AssetKind::Native, 0),
        ];
        seed_canonical(&mut plane, &canonical, 500);
        // targets(4) = {1,1,2}: plain stages [301, 302]; the plain queue
        // holds [303 (pooled resident), 2 (canonical)].
        let rec = record(
            10,
            vec![],
            vec![],
            vec![
                cell_with(301, "0xp1", AssetKind::Native, 0),
                cell_with(302, "0xp2", AssetKind::Native, 0),
                cell_with(303, "0xp3", AssetKind::Native, 0),
            ],
        );
        plane.reservoir_replaced(&rec, &outpoint_index(&canonical), &canonical);
        plane.flush(Some(1_000));
        assert_eq!(member_set(&plane), [0, 1, 301, 302].into());

        // The pooled candidate is spent: no membership change at all.
        plane.note_input_unresolved(&OutPoint {
            tx_hash: "0xp3".into(),
            index: 0,
        });
        assert!(
            plane.flush(Some(2_000)).is_none(),
            "retiring an off-stage candidate is invisible"
        );

        // Now a STAGED plain resident is spent. The refill must skip the
        // retired 303 and take canonical 2 — 303 can never come back.
        plane.note_input_unresolved(&OutPoint {
            tx_hash: "0xp2".into(),
            index: 0,
        });
        let (enter, exit, _) = delta_parts(plane.flush(Some(3_000)));
        assert_eq!(exit, vec![302]);
        assert_eq!(enter, vec![2], "the retired candidate is skipped");
        assert_eq!(member_set(&plane), [0, 1, 2, 301].into());
        assert!(!member_set(&plane).contains(&303));
    }

    /// The hook fires on EVERY unresolved input — the overwhelming
    /// majority of which are ordinary spends outside the retained
    /// window. Unknown outpoints and repeat spends must both be exact
    /// no-ops.
    #[test]
    fn unresolved_inputs_that_are_not_ours_are_no_ops() {
        let mut plane = small_plane(4, 1);
        let canonical = vec![
            cell_with(0, "0xa", AssetKind::Dao, 0),
            cell_with(1, "0xb", AssetKind::Xudt, 0),
            cell_with(2, "0xc", AssetKind::Native, 0),
            cell_with(3, "0xd", AssetKind::Native, 0),
        ];
        seed_canonical(&mut plane, &canonical, 500);
        let rec = record(
            10,
            vec![],
            vec![],
            vec![cell_with(301, "0xp1", AssetKind::Native, 0)],
        );
        plane.reservoir_replaced(&rec, &outpoint_index(&canonical), &canonical);
        plane.flush(Some(1_000));
        let before = member_set(&plane);

        // An outpoint nobody on stage holds.
        plane.note_input_unresolved(&OutPoint {
            tx_hash: "0xnothing".into(),
            index: 7,
        });
        // A canonical member's outpoint reached here would be a caller
        // bug (the index would have resolved it) — it must still not
        // disturb the stage.
        plane.note_input_unresolved(&OutPoint {
            tx_hash: "0xa".into(),
            index: 0,
        });
        assert!(plane.flush(Some(2_000)).is_none());
        assert_eq!(member_set(&plane), before);

        // Same outpoint twice, and again after it already settled.
        plane.note_input_unresolved(&OutPoint {
            tx_hash: "0xp1".into(),
            index: 0,
        });
        plane.note_input_unresolved(&OutPoint {
            tx_hash: "0xp1".into(),
            index: 0,
        });
        let (enter, exit, _) = delta_parts(plane.flush(Some(3_000)));
        assert_eq!(exit, vec![301], "one exit, not two");
        assert_eq!(enter, vec![3]);
        plane.note_input_unresolved(&OutPoint {
            tx_hash: "0xp1".into(),
            index: 0,
        });
        assert!(plane.flush(Some(4_000)).is_none(), "idempotent");
        assert_eq!(member_set(&plane), [0, 1, 2, 3].into());
    }

    /// GC of a staged composed member refills the class from the refresh
    /// queues (reservoir tail first), keeping count and ratio.
    /// On a live chain every birth pushes a curated refill candidate and a
    /// full stage pops none, so the queues only ever grow — and the map
    /// evicts those ids long before anyone would have staged them. Left
    /// alone that is an unbounded backlog of entries that can never be
    /// used. Compaction has to bound it WITHOUT changing who gets staged.
    #[test]
    fn curated_refill_queues_stay_bounded_under_churn() {
        let mut plane = small_plane(8, 2);
        let cells = canonical_field(12);
        seed_canonical(&mut plane, &cells, 1_000);
        plane.reservoir_replaced(
            &record(1, vec![], vec![], vec![]),
            &outpoint_index(&cells),
            &cells,
        );
        plane.flush(Some(1_000));
        let staged = member_set(&plane);

        // Churn: births that reach the map and leave it again, which is
        // what makes a queue entry unusable.
        let mut id = 1_000u64;
        for _ in 0..40 {
            let batch: Vec<u64> = (0..40)
                .map(|_| {
                    id += 1;
                    id
                })
                .collect();
            for &new_id in &batch {
                plane.note_birth(&cell_with(
                    new_id,
                    &format!("0xc{new_id}"),
                    AssetKind::Native,
                    0,
                ));
            }
            for &new_id in &batch {
                plane.note_removed(new_id);
            }
            plane.flush(Some(1_000));
        }

        assert_eq!(
            member_set(&plane),
            staged,
            "compaction must not disturb who is on stage"
        );
        assert!(
            plane.queued_len() <= plane.present_ids_sorted().len() * 2 + 1_024 + 40,
            "1,600 dead candidates must not still be queued (queued {})",
            plane.queued_len()
        );

        // …and the survivors still refill in order: free a slot and the
        // next live candidate takes it.
        let victim = *staged.iter().next().expect("a staged member");
        plane.note_removed(victim);
        plane.flush(Some(1_100));
        assert_eq!(plane.member_ids_sorted().len(), staged.len());
    }

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
