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
//! * **The tip window** is a standing reserve of the `tip_quota` YOUNGEST
//!   live canonical cells — `birth_block` descending, admission sequence
//!   ascending as the tiebreak — maintained from the canonical stream
//!   alone and settled at every flush. A younger birth displaces the
//!   window's oldest member (its own group only: the curated ratchet and
//!   its bench are never touched by tip churn); a window death refills
//!   from the next-youngest live cell, NOT from an admission-ordered
//!   queue. A candidate already on stage as activity is promoted in place.
//!   Composed mode gives it [`DISPLAY_TIP_WINDOW`] seats beside the
//!   curated field; prefix mode gives it the whole resting field, which is
//!   the "no reservoir ⇒ the stage IS the newest live cells" product rule.
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
//!   frozen. The guard lives HERE and nowhere else: the registry's own
//!   duplicate-refresh case no longer exists, so
//!   `refresh_dedupes_identical_content_and_rearms_after_degrade` below is
//!   the whole of it. Every degrade path (reorg cut, rebuild/reset) drops
//!   the stored reservoir, which re-arms the dedup: a later
//!   content-identical record applies again.
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
//! plus amortized queue compaction/skips. The recency index costs one
//! `BTreeMap` insert per birth and one removal per exit, and a settle
//! moves at most `tip_quota` seats — so a mutation birthing B cells churns
//! at most `min(tip_quota, B)` of them, and the enter/exit pair for each
//! coalesces in the touched log exactly like any other membership move.
//! Full passes over the map happen only at refresh (15-minute cadence),
//! degrade, bootstrap (restore), reset, and the backfill-terminal
//! resettle — all sanctioned big events.

use std::cmp::Reverse;
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
/// The tip window: stage slots held by the RECENCY law rather than by the
/// composition — the youngest live canonical cells, standing membership,
/// sliding with the chain tip forever.
///
/// This is the standing form of a guarantee the activity quota only ever
/// gave transiently. An activity member is a tx endpoint passing through a
/// 512-slot FIFO a few blocks deep; a tip member is on stage *because it is
/// among the newest cells that exist*, and it leaves only when something
/// younger arrives or it dies. Without it the resting field is admission-
/// ordered — a fresh birth queues behind every retained-but-unstaged cell —
/// so the stage shows the chain as of whenever it was last recomposed.
///
/// Composed mode holds exactly this many; prefix mode gives the window the
/// WHOLE resting field (`budget - activity_quota`), which is the "no
/// ckbadger ⇒ the stage IS the latest live cells" product rule.
pub const DISPLAY_TIP_WINDOW: usize = 1_200;
/// What the composition policy staffs in composed mode: the budget less
/// the recency law's standing reserve. The 20:70:10 class quota is measured
/// on THIS, not on the full budget, so the class law and the freshness law
/// never claim one slot twice.
///
/// It is also the size a curated composition should be discovered at — the
/// adapter's `MAX_GALAXY_COMPOSITION_TARGET` imports it rather than
/// recomputing it, and so does the enrichment supervisor's burst threshold.
pub const DISPLAY_CURATED_FIELD: usize = DISPLAY_CELL_BUDGET as usize - DISPLAY_TIP_WINDOW;

/// Where a live canonical cell sits in the recency order, YOUNGEST FIRST:
/// `birth_block` descending, with the stage's own admission sequence
/// ascending as the deterministic tiebreak. The MINIMUM key is the newest
/// cell the server knows about; the MAXIMUM is the oldest.
///
/// The tiebreak direction is not arbitrary. Backfill walks the anchored tip
/// BACKWARDS (`backfill.rs`), so within the boot replay earlier admission
/// already means younger — the tiebreak agrees with the primary key rather
/// than fighting it, and a restored stage is the newest cells it holds
/// without any special case. Within one live block it is simply tx order.
pub(crate) type RecencyKey = (Reverse<u64>, u64);

/// Prefix mode's recency window: the WHOLE resting field. With no reservoir
/// there is no composition to staff and no class law to honour, so the only
/// membership question left is "which cells are the newest" — requirement 3,
/// stated as arithmetic.
fn prefix_tip_quota(budget: &DisplayBudget, activity_quota: usize) -> usize {
    (budget.cells as usize).saturating_sub(activity_quota)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MemberRole {
    /// A standing member the [`CompositionPolicy`] staffs — the *field*.
    Resting,
    /// A standing member the RECENCY law holds: one of the youngest
    /// `tip_quota` live canonical cells. Never in the policy's accounting;
    /// displaced only by a younger cell, or by its own death.
    Tip,
    /// Entered via a tx-endpoint swap; `block` keys the eviction FIFO.
    Activity { block: u64 },
}

/// The stage: who is on stage, what they look like, and the bookkeeping
/// that makes one coalesced delta per mutation possible. Class-blind and
/// ratio-blind by construction — every "should" question is the
/// [`CompositionPolicy`]'s, which acts on the stage through the
/// membership moves below.
pub(crate) struct Stage {
    budget: DisplayBudget,
    activity_quota: usize,
    /// Slots the recency law holds. Set by whoever installs the policy:
    /// `budget - activity_quota` in prefix mode (the window IS the resting
    /// field), [`DISPLAY_TIP_WINDOW`] in composed mode.
    tip_quota: usize,

    /// Staged members. BTreeMap so snapshot/wire order is deterministic
    /// (ascending id) without per-mutation sorting of the full set.
    members: BTreeMap<u64, MemberRole>,
    /// STANDING members: `Resting` + `Tip`. Everything that is not a
    /// transient activity entry, which is what every "is the stage full of
    /// real membership" question has always meant.
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

    /// Recency key of every id in `present`, assigned once at arrival.
    /// Exactly co-extensive with `present` (asserted at flush): residents
    /// are never in it, because the tip window is canonical-stream-only.
    recency_of: HashMap<u64, RecencyKey>,
    /// Monotonic admission sequence — the recency tiebreak, and the reason
    /// the window is deterministic under equal birth heights.
    next_recency_seq: u64,
    /// The tip window itself: recency key → id, youngest first. The MAXIMUM
    /// entry is the member a younger arrival displaces.
    tip: BTreeMap<RecencyKey, u64>,
    /// Ids the recency law MAY claim, youngest first: present, and not held
    /// by a standing slot (`Resting` or `Tip`). An `Activity` member is in
    /// here on purpose — a transient endpoint young enough for the window is
    /// promoted in place rather than entering twice.
    ///
    /// Kept as an ordered complement rather than scanned out of a full
    /// recency index: `fill` and `displace` are then `first_key_value` /
    /// `last_key_value`, so a settle costs O(churn · log n) instead of
    /// walking the whole staged prefix on every flush.
    tip_pool: BTreeMap<RecencyKey, u64>,

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
    fn new(budget: DisplayBudget, activity_quota: usize, tip_quota: usize) -> Self {
        Self {
            budget,
            activity_quota,
            tip_quota,
            members: BTreeMap::new(),
            resting_count: 0,
            activity_count: 0,
            activity_groups: BTreeMap::new(),
            present: HashMap::new(),
            recency_of: HashMap::new(),
            next_recency_seq: 0,
            tip: BTreeMap::new(),
            tip_pool: BTreeMap::new(),
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

    pub(crate) fn tip_quota(&self) -> usize {
        self.tip_quota
    }

    /// Hand the recency law a different number of slots. Only ever called
    /// while installing a policy; an over-full window is trimmed by the next
    /// settle, so growing and shrinking are both safe here.
    fn set_tip_quota(&mut self, tip_quota: usize) {
        self.tip_quota = tip_quota.min(self.budget_cells());
    }

    /// Slots the composition policy staffs: the budget less the recency
    /// law's standing reserve. EVERY quota, target and fullness question the
    /// policy asks is scoped to this, never to the whole budget — the tip
    /// window sits beside the curated field, not inside it.
    pub(crate) fn field_cells(&self) -> usize {
        self.budget_cells().saturating_sub(self.tip_quota)
    }

    /// Members the policy owns: everyone on stage except the tip window's
    /// own reserve. Equal to the sum of its per-class counts.
    pub(crate) fn field_member_count(&self) -> usize {
        self.members.len().saturating_sub(self.tip.len())
    }

    /// The largest FIELD membership the stage can currently hold:
    /// `min(field, everything stageable the tip window is not holding)`.
    /// Below it a new member fits without anyone giving way.
    pub(crate) fn field_dynamic_target(&self) -> usize {
        self.field_cells().min(
            (self.present.len() + self.residents.len() + self.resident_pool.len())
                .saturating_sub(self.tip.len()),
        )
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

    /// Stage an off-stage id as a resting FIELD member. A pooled resident
    /// payload (an id that is not canonical) comes on stage with it.
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
        self.refresh_tip_candidacy(id);
    }

    /// Stage an off-stage id as an activity member of `block`, consuming
    /// a quota slot.
    pub(crate) fn stage_activity(&mut self, block: u64, id: u64) {
        debug_assert!(!self.members.contains_key(&id), "{id} is already staged");
        self.members.insert(id, MemberRole::Activity { block });
        self.touched.entry(id).or_insert(false);
        self.activity_count += 1;
        self.activity_groups.entry(block).or_default().push(id);
        self.refresh_tip_candidacy(id);
    }

    /// Convert an activity member into a resting FIELD one in place:
    /// membership is unchanged (no wire noise) and its quota slot is freed.
    pub(crate) fn promote_to_resting(&mut self, id: u64) {
        let Some(MemberRole::Activity { block }) = self.members.get(&id).copied() else {
            debug_assert!(false, "{id} is not an activity member");
            return;
        };
        self.members.insert(id, MemberRole::Resting);
        self.activity_count -= 1;
        self.resting_count += 1;
        self.remove_from_activity_group(block, id);
        self.refresh_tip_candidacy(id);
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
            MemberRole::Tip => {
                self.resting_count -= 1;
                self.leave_tip(id);
            }
            MemberRole::Activity { block } => {
                self.activity_count -= 1;
                self.remove_from_activity_group(block, id);
            }
        }
        self.refresh_tip_candidacy(id);
        Some(role)
    }

    // ── the recency window's own moves ───────────────────────────────

    /// The youngest id the recency law may claim, if any.
    pub(crate) fn youngest_tip_candidate(&self) -> Option<(RecencyKey, u64)> {
        self.tip_pool.first_key_value().map(|(k, v)| (*k, *v))
    }

    /// The oldest member of the window — the one a younger arrival
    /// displaces.
    pub(crate) fn oldest_tip(&self) -> Option<(RecencyKey, u64)> {
        self.tip.last_key_value().map(|(k, v)| (*k, *v))
    }

    pub(crate) fn tip_count(&self) -> usize {
        self.tip.len()
    }

    /// Stage an off-stage canonical id as a member of the recency window.
    pub(crate) fn stage_tip(&mut self, id: u64) {
        debug_assert!(!self.members.contains_key(&id), "{id} is already staged");
        let Some(&key) = self.recency_of.get(&id) else {
            debug_assert!(false, "{id} has no recency key — residents never tip");
            return;
        };
        self.members.insert(id, MemberRole::Tip);
        self.touched.entry(id).or_insert(false);
        self.resting_count += 1;
        self.tip.insert(key, id);
        self.refresh_tip_candidacy(id);
    }

    /// Convert an activity member into a tip member in place: membership is
    /// unchanged (no wire noise) and its FIFO slot is freed. Returns the
    /// block that keyed the slot, so the caller can settle the policy's
    /// accounting for a member that just left its field.
    pub(crate) fn promote_to_tip(&mut self, id: u64) -> Option<u64> {
        let Some(MemberRole::Activity { block }) = self.members.get(&id).copied() else {
            debug_assert!(false, "{id} is not an activity member");
            return None;
        };
        let Some(&key) = self.recency_of.get(&id) else {
            debug_assert!(false, "{id} has no recency key — residents never tip");
            return None;
        };
        self.members.insert(id, MemberRole::Tip);
        self.activity_count -= 1;
        self.resting_count += 1;
        self.remove_from_activity_group(block, id);
        self.tip.insert(key, id);
        self.refresh_tip_candidacy(id);
        Some(block)
    }

    /// Release the oldest member of the window: it leaves the stage
    /// entirely (the field's refill queues may still hold a claim on it,
    /// exactly as they do for any member that ever leaves).
    pub(crate) fn release_oldest_tip(&mut self) -> Option<u64> {
        let (_, id) = self.oldest_tip()?;
        self.unstage(id);
        Some(id)
    }

    fn leave_tip(&mut self, id: u64) {
        if let Some(key) = self.recency_of.get(&id) {
            self.tip.remove(key);
        }
    }

    /// Restate whether `id` is claimable by the recency law: a present cell
    /// that no STANDING slot is already holding. Called after every move
    /// that can change a role, so `tip_pool` cannot drift out of agreement
    /// with `members` the way a hand-maintained complement would.
    fn refresh_tip_candidacy(&mut self, id: u64) {
        let Some(&key) = self.recency_of.get(&id) else {
            return; // a resident, or gone from the map
        };
        match self.members.get(&id) {
            Some(MemberRole::Resting | MemberRole::Tip) => {
                self.tip_pool.remove(&key);
            }
            Some(MemberRole::Activity { .. }) | None => {
                self.tip_pool.insert(key, id);
            }
        }
    }

    /// Rebuild the candidate pool from scratch — for the moves that rewrite
    /// membership wholesale instead of one id at a time (exit-all, composed
    /// install). O(present · log present), and only ever at a sanctioned big
    /// event.
    fn rebuild_tip_pool(&mut self) {
        let pool: BTreeMap<RecencyKey, u64> = self
            .recency_of
            .iter()
            .filter(|(id, _)| {
                !matches!(
                    self.members.get(id),
                    Some(MemberRole::Resting) | Some(MemberRole::Tip)
                )
            })
            .map(|(id, key)| (*key, *id))
            .collect();
        self.tip_pool = pool;
    }

    // ── mechanism-owned bookkeeping ──────────────────────────────────

    /// Mirror a canonical arrival, giving it its place in the recency order.
    /// Returns the previous kind when the id was already present (an
    /// in-place resurrection — a no-op, and its recency key deliberately
    /// stands: the identity never left the map, so its birth height did not
    /// move either).
    fn note_present(&mut self, cell: &Cell) -> Option<AssetKind> {
        let previous = self.present.insert(cell.id, cell.asset_kind);
        if previous.is_none() {
            let key = (Reverse(cell.birth_block), self.next_recency_seq);
            self.next_recency_seq += 1;
            self.recency_of.insert(cell.id, key);
            self.refresh_tip_candidacy(cell.id);
        }
        previous
    }

    /// Mirror a canonical removal, withdrawing the id from the recency
    /// order ENTIRELY — its key, its candidacy, and its seat in the window
    /// if it held one.
    ///
    /// All three in one step on purpose. The caller unstages the member
    /// right after this, and every structure the window keeps is keyed by
    /// the recency key: dropping the key first and the seat second leaves
    /// the seat unreachable, and an unreachable seat counts against the
    /// quota forever, so the window silently stops refilling.
    fn forget_present(&mut self, id: u64) -> Option<AssetKind> {
        let previous = self.present.remove(&id);
        if previous.is_some() {
            if let Some(key) = self.recency_of.remove(&id) {
                self.tip_pool.remove(&key);
                self.tip.remove(&key);
            }
        }
        previous
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
        self.tip.clear();
        self.rebuild_tip_pool();
    }

    /// Forget the whole canonical mirror (reset / restore).
    fn forget_all_presence(&mut self) {
        self.present.clear();
        self.recency_of.clear();
        self.tip_pool.clear();
        self.tip.clear();
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

        // The composition decided the FIELD. The recency window is rebuilt
        // from whatever the field did not take, by the settle that follows.
        self.tip.clear();
        self.rebuild_tip_pool();
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
    /// The recency window's size in COMPOSED mode. Prefix mode hands the
    /// window the whole resting field instead, so this is only consulted
    /// when a reservoir is staffing the stage.
    tip_window: usize,

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
            DISPLAY_TIP_WINDOW,
        )
    }

    /// Test seam: shrink the budgets so quota/FIFO/composition behavior
    /// is exercisable without minting thousands of cells. `tip_window` is
    /// the composed-mode recency reserve — pass 0 to isolate composition
    /// behavior from the recency law, exactly as `activity_quota` shrinks
    /// the FIFO rather than pretending 512 endpoints exist.
    pub(crate) fn with_limits(
        budget: DisplayBudget,
        activity_quota: usize,
        tip_window: usize,
    ) -> Self {
        debug_assert!(
            budget.cells as usize >= activity_quota,
            "budget must cover the quota"
        );
        debug_assert!(
            budget.cells as usize >= tip_window + activity_quota,
            "budget must cover the tip window and the quota together"
        );
        let stage = Stage::new(
            budget,
            activity_quota,
            prefix_tip_quota(&budget, activity_quota),
        );
        let policy = Self::prefix_policy();
        Self {
            stage,
            policy,
            tip_window,
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

    fn prefix_policy() -> Box<dyn CompositionPolicy + Send + Sync> {
        Box::new(CanonicalPolicy::new())
    }

    /// Hand the stage back to prefix staffing: the recency window takes the
    /// whole resting field, which is exactly the "no reservoir ⇒ the stage
    /// IS the newest live cells" rule.
    fn install_prefix_policy(&mut self) {
        self.policy = Self::prefix_policy();
        self.stage.set_tip_quota(prefix_tip_quota(
            &self.stage.budget,
            self.stage.activity_quota(),
        ));
    }

    /// Settle the standing recency window: after this the window holds the
    /// `tip_quota` youngest live canonical cells that no field slot is
    /// already holding — which is what makes "the T youngest cells that
    /// exist are on stage" true, since a cell the field holds is on stage
    /// anyway.
    ///
    /// Three moves, all bounded by the window size: release members a
    /// shrunk quota no longer has room for, fill free slots from the
    /// candidate pool, and displace the oldest member whenever a younger
    /// candidate is standing outside. A candidate already on stage as a
    /// transient endpoint is PROMOTED in place — no wire noise, its FIFO
    /// slot freed, and the field it was occupying settled through the same
    /// `note_exit` an eviction would have used (so a composed-mode bench
    /// comes back exactly as it does today).
    fn settle_tip(&mut self) {
        while self.stage.tip_count() > self.stage.tip_quota() {
            if self.stage.release_oldest_tip().is_none() {
                break;
            }
        }
        loop {
            let Some((candidate_key, candidate)) = self.stage.youngest_tip_candidate() else {
                break;
            };
            if self.stage.tip_count() >= self.stage.tip_quota() {
                // Full window: only a strictly younger cell may come in, and
                // only by taking the oldest member's slot.
                let Some((oldest_key, _)) = self.stage.oldest_tip() else {
                    break; // quota 0 — the window is switched off
                };
                if candidate_key >= oldest_key {
                    break; // the window already holds the youngest there are
                }
                if self.stage.release_oldest_tip().is_none() {
                    break;
                }
            }
            match self.stage.role_of(candidate) {
                Some(MemberRole::Activity { .. }) => {
                    if let Some(block) = self.stage.promote_to_tip(candidate) {
                        self.policy.note_exit(
                            &mut self.stage,
                            candidate,
                            MemberRole::Activity { block },
                        );
                    }
                }
                None => self.stage.stage_tip(candidate),
                Some(MemberRole::Resting | MemberRole::Tip) => {
                    debug_assert!(false, "{candidate} is standing — not a tip candidate");
                    break;
                }
            }
        }
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
        if role == MemberRole::Tip {
            // The recency law's own member: the policy never counted it, so
            // there is nothing of its to settle. The window refills from the
            // next-youngest live cell at the flush that follows.
            return;
        }
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
        self.install_prefix_policy();
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
        self.install_prefix_policy();
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
        self.settle_tip();
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

        // The recency window's reserve comes off the top: the composition
        // is composed for the FIELD, and the 20:70:10 class law is measured
        // on that field for as long as this policy is installed.
        self.stage.set_tip_quota(self.tip_window);
        let (policy, fill) =
            CuratedPolicy::compose(record, outpoint_index, cells, self.stage.field_cells());
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
    pub(crate) fn chain_reorganized(&mut self, from_block: u64) {
        let anchored_below = self
            .policy
            .reservoir()
            .is_some_and(|stored| from_block <= stored.as_of.block);
        if !anchored_below {
            return;
        }
        self.stage.clear_residents();
        self.install_prefix_policy();
        CanonicalPolicy::rebuild(&mut self.stage);
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
    ///
    /// Canonical enters leave here as bare ids and reach the wire as
    /// records: `CellGalaxy::carry_enter_records` swaps each one for the
    /// map's copy (invariant I3). Read an `enter_ids` from this function as
    /// "who entered", never as "what the client is expected to already
    /// know".
    pub(crate) fn flush(&mut self, at_ms: Option<u64>) -> Option<CellDelta> {
        if let Some(at) = at_ms {
            self.last_at_ms = at;
        }

        // 1. The standing recency window first — its slots are not the
        //    policy's to fill — then the policy's own vacancy fill. Both run
        //    even during backfill (membership evolves silently).
        self.settle_tip();
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
            // An evicted endpoint young enough for the window SETTLES
            // there instead of leaving the stage; an old cell that merely
            // pulsed leaves exactly as it always has. Unrestorable benches
            // leave field vacancies inside this same mutation — repair both
            // before emitting.
            self.settle_tip();
            self.policy.fill_vacancies(&mut self.stage);
        }

        debug_assert_eq!(
            self.stage.recency_of.len(),
            self.stage.present.len(),
            "the recency index and the presence mirror must name one set"
        );
        debug_assert_eq!(
            self.stage.tip_pool.len() + self.stage.resting_count,
            self.stage.present.len() + self.stage.residents.len(),
            "tip candidates + standing members must account for every present \
             cell and every staged resident"
        );
        debug_assert!(
            self.stage.tip.len() <= self.stage.tip_quota,
            "the recency window never exceeds its quota"
        );
        debug_assert!(
            self.stage
                .tip
                .values()
                .all(|id| self.stage.members.get(id) == Some(&MemberRole::Tip)),
            "every seat in the recency window names one of its own members"
        );
        debug_assert!(
            self.stage.members.len() <= self.stage.budget_cells(),
            "the stage never exceeds its budget"
        );

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

        // Split enters into canonical names vs resident payloads. A
        // resident's payload lives here (the map does not hold it); a
        // canonical enter leaves as a bare id and the projection swaps in
        // the record from the map before the delta reaches the wire
        // (`CellGalaxy::carry_enter_records`, invariant I3 — every enter
        // carries its record). The plane deliberately keeps no canonical
        // payloads: a second copy of the map would have to be re-synced on
        // every death and every tag to stay shippable.
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

    /// Members the recency law holds, ascending id.
    #[cfg(test)]
    pub(crate) fn tip_ids_sorted(&self) -> Vec<u64> {
        let mut ids: Vec<u64> = self.stage.tip.values().copied().collect();
        ids.sort_unstable();
        ids
    }

    #[cfg(test)]
    pub(crate) fn is_tip_member(&self, id: u64) -> bool {
        matches!(self.stage.role_of(id), Some(MemberRole::Tip))
    }

    /// A standing member the POLICY holds — the curated field, as opposed
    /// to the recency window beside it.
    #[cfg(test)]
    pub(crate) fn is_field_resting(&self, id: u64) -> bool {
        matches!(self.stage.role_of(id), Some(MemberRole::Resting))
    }

    #[cfg(test)]
    pub(crate) fn tip_quota(&self) -> usize {
        self.stage.tip_quota()
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
    use crate::rng::Mulberry32;

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

    /// The stage's two standing laws divide its seats exactly once, and the
    /// class ratio is measured on the composition's share of them. Stated
    /// by name so the product contract is a sentence rather than an
    /// inference from a subtraction.
    #[test]
    fn the_window_and_the_curated_field_divide_the_budget_exactly() {
        assert_eq!(DISPLAY_TIP_WINDOW, 1_200);
        assert_eq!(DISPLAY_CURATED_FIELD, 10_800);
        assert_eq!(
            DISPLAY_TIP_WINDOW + DISPLAY_CURATED_FIELD,
            DISPLAY_CELL_BUDGET as usize,
            "every seat belongs to exactly one law"
        );
        assert_eq!(
            GalaxyCompositionTarget::for_total(DISPLAY_CURATED_FIELD),
            GalaxyCompositionTarget {
                dao: 2_160,
                typed: 7_560,
                plain: 1_080,
            },
            "20:70:10 is measured on the curated field, not on the budget"
        );
        // The window is disclosed by STAGE·07 and rides no wire field, so
        // the browser keeps its own copy beside the budget's:
        // `DISPLAY_TIP_WINDOW` and `DISPLAY_ACTIVITY_QUOTA` in
        // `packages/ui/src/tweaks/cellDisplay.ts`, each naming this test.
        assert_eq!(DISPLAY_ACTIVITY_QUOTA, 512);
    }

    /// A plane with the recency window switched OFF. Every composition
    /// case below is a port of the old client's membership algorithm, and
    /// the tip window is a law that runs beside it rather than inside it —
    /// mixing the two would stop these cases from pinning either.
    fn small_plane(cells: u32, quota: usize) -> DisplayPlane {
        tip_plane(cells, quota, 0)
    }

    /// A plane whose composed mode reserves `tip` slots for the recency
    /// window. Prefix mode always gives the window the whole resting field,
    /// so `small_plane` exercises that too — this seam is about the CURATED
    /// field, which is `cells - tip`.
    fn tip_plane(cells: u32, quota: usize, tip: usize) -> DisplayPlane {
        DisplayPlane::with_limits(
            DisplayBudget {
                cells,
                nerve_edges: 8,
            },
            quota,
            tip,
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
            collection_seed: None,
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

    /// Prefix mode's resting field IS the recency window, so it takes the
    /// `cells − quota` YOUNGEST births — which, at one birth height, is the
    /// first `cells − quota` in arrival order, because the sequence
    /// tiebreak agrees with the backfill's tip-backwards walk. The first
    /// emitted delta rides Canonical provenance stamped with the mutation
    /// clock.
    #[test]
    fn prefix_fill_stages_the_youngest_births() {
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

        // A birth of the SAME height does not displace anyone — the window
        // already holds cells that are its equal and arrived first…
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

    /// The window's refill skips candidates that left the map, and a
    /// candidate already on stage as ACTIVITY is promoted in place instead
    /// of double-entering — no wire noise, and its FIFO slot is freed.
    #[test]
    fn tip_refill_skips_stale_candidates_and_promotes_staged_activity() {
        let mut plane = small_plane(8, 2);
        for id in 0..9 {
            birth(&mut plane, id);
        }
        plane.flush(Some(1_000)); // window 0..5, candidates [6, 7, 8]
        plane.note_activity(10, [7]);
        plane.flush(Some(1_100)); // 7 on stage as activity

        // 6 dies and is GC'd while still waiting off stage.
        plane.note_removed(6);
        let (enter, exit, _) = delta_parts(plane.flush(Some(1_200)));
        assert!(enter.is_empty() && exit.is_empty(), "6 was never staged");

        // A window member exits → 6 is gone, so the next-youngest candidate
        // is 7, already on stage as activity → promoted in place: the only
        // visible change is the exit.
        plane.note_removed(0);
        let (enter, exit, _) = delta_parts(plane.flush(Some(1_300)));
        assert!(enter.is_empty());
        assert_eq!(exit, vec![0]);
        assert_eq!(plane.member_ids_sorted(), vec![1, 2, 3, 4, 5, 7]);
        assert_eq!(plane.resting_len(), 6);
        assert_eq!(plane.activity_len(), 0, "promotion freed the quota slot");
        assert!(!plane.is_activity_member(7));

        // The next vacancy takes the last candidate there is.
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

    // ═══ T5 the tip window ═══════════════════════════════════════════

    /// A canonical cell born at a chosen height — the recency window's
    /// primary ranking key, and the only thing that distinguishes an old
    /// cell from a new one here.
    fn cell_at(id: u64, block: u64) -> Cell {
        Cell {
            birth_block: block,
            ..cell_with(id, &format!("0x{id}"), AssetKind::Other, 0)
        }
    }

    fn birth_at(plane: &mut DisplayPlane, id: u64, block: u64) {
        plane.note_birth(&cell_at(id, block));
    }

    /// A full-scan mirror of the recency order, kept by the test from the
    /// same events the plane sees. Deliberately dumb: it sorts everything
    /// every time, so it can disagree with the incremental index the plane
    /// maintains — which is the whole point of checking against it.
    #[derive(Default)]
    struct RecencyOracle {
        /// id → (birth height, admission sequence), for ids in the map.
        keys: BTreeMap<u64, (u64, u64)>,
        next_seq: u64,
    }

    impl RecencyOracle {
        fn born(&mut self, id: u64, block: u64) {
            if self.keys.contains_key(&id) {
                return; // in-place resurrection: the identity never left
            }
            self.keys.insert(id, (block, self.next_seq));
            self.next_seq += 1;
        }

        fn removed(&mut self, id: u64) {
            self.keys.remove(&id);
        }

        /// Youngest first: height descending, admission sequence ascending.
        fn ranked(&self) -> Vec<u64> {
            let mut rows: Vec<(u64, u64, u64)> = self
                .keys
                .iter()
                .map(|(id, (block, seq))| (*block, *seq, *id))
                .collect();
            rows.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
            rows.into_iter().map(|(_, _, id)| id).collect()
        }
    }

    /// THE law, both halves.
    ///
    /// Mechanically: the window holds the `tip_quota` youngest cells that no
    /// FIELD slot is already standing on. Which gives the product claim the
    /// requirement is actually written in — every one of the `tip_quota`
    /// youngest live cells is on stage, whichever slot happens to hold it.
    fn assert_tip_law(plane: &DisplayPlane, oracle: &RecencyOracle) {
        let quota = plane.tip_quota();
        let ranked = oracle.ranked();
        let expected: Vec<u64> = {
            let mut ids: Vec<u64> = ranked
                .iter()
                .copied()
                .filter(|id| !plane.is_field_resting(*id))
                .take(quota)
                .collect();
            ids.sort_unstable();
            ids
        };
        assert_eq!(
            plane.tip_ids_sorted(),
            expected,
            "the window is not the youngest claimable cells"
        );
        let members: BTreeSet<u64> = plane.member_ids_sorted().into_iter().collect();
        for id in ranked.iter().take(quota) {
            assert!(
                members.contains(id),
                "the {quota} youngest live cells must all be staged; {id} is not"
            );
        }
    }

    /// Soak: a randomized mutation sequence — births at wandering heights,
    /// deaths, endpoint pulses — checked after EVERY flush against a mirror
    /// that recomputes the answer from scratch. The incremental index has
    /// several places it could silently drift (a removal that forgets a
    /// seat, a promotion that forgets a candidate); a full-scan oracle is
    /// the only check that does not share those assumptions.
    #[test]
    fn the_window_holds_the_youngest_live_cells_through_any_mutation_sequence() {
        let mut rng = Mulberry32::new(0x5eed_1234);
        let mut plane = small_plane(24, 6); // prefix window: 18
        let mut oracle = RecencyOracle::default();
        let mut live: Vec<u64> = Vec::new();
        let mut next_id = 0u64;
        let mut block = 1_000u64;

        for step in 0..600u64 {
            match (rng.next_f64() * 10.0) as u32 {
                // Births, sometimes several, at a height that mostly climbs
                // but occasionally lands behind the tip (a late relay, a
                // backfill tail).
                0..=4 => {
                    block = if rng.next_f64() < 0.15 {
                        block.saturating_sub((rng.next_f64() * 40.0) as u64)
                    } else {
                        block + 1
                    };
                    for _ in 0..=(rng.next_f64() * 3.0) as u32 {
                        let id = next_id;
                        next_id += 1;
                        birth_at(&mut plane, id, block);
                        oracle.born(id, block);
                        live.push(id);
                    }
                }
                // A canonical removal (GC, cap eviction, reorg park).
                5..=7 => {
                    if !live.is_empty() {
                        let victim = live.remove((rng.next_f64() * live.len() as f64) as usize);
                        plane.note_removed(victim);
                        oracle.removed(victim);
                    }
                }
                // A tx endpoint pulses.
                _ => {
                    if !live.is_empty() {
                        let id = live[(rng.next_f64() * live.len() as f64) as usize];
                        plane.note_activity(block, [id]);
                    }
                }
            }
            plane.flush(Some(10_000 + step));
            assert_tip_law(&plane, &oracle);
            assert!(
                plane.member_ids_sorted().len() <= 24,
                "step {step}: the stage outgrew its budget"
            );
        }
        assert!(
            plane.tip_ids_sorted().len() == 18,
            "the soak has to actually fill the window"
        );
    }

    /// The same soak with a curated policy staffing the field beside the
    /// window: the law must hold when most of the map is spoken for by the
    /// composition and only what it declines is claimable.
    #[test]
    fn the_window_holds_the_youngest_claimable_cells_beside_a_curated_field() {
        let mut rng = Mulberry32::new(0xc0ff_ee01);
        let mut plane = tip_plane(24, 4, 6); // curated field 18, window 6
        let mut oracle = RecencyOracle::default();
        let mut live: Vec<u64> = Vec::new();
        let mut next_id = 0u64;
        let mut block = 500u64;

        // Seed a map, then compose the field from it (empty reservoir → a
        // pure canonical fallback fill, so every field member is a cell the
        // window could otherwise have claimed).
        let seed: Vec<Cell> = (0..40)
            .map(|i| {
                let kind = if i % 7 == 0 {
                    AssetKind::Dao
                } else if i % 3 == 0 {
                    AssetKind::Xudt
                } else {
                    AssetKind::Native
                };
                let mut cell = cell_with(i, &format!("0x{i}"), kind, 0);
                cell.birth_block = 400 + i;
                cell
            })
            .collect();
        for cell in &seed {
            plane.note_birth(cell);
            oracle.born(cell.id, cell.birth_block);
            live.push(cell.id);
            next_id = cell.id + 1;
        }
        plane.flush(Some(900));
        plane.reservoir_replaced(
            &record(10, vec![], vec![], vec![]),
            &outpoint_index(&seed),
            &seed,
        );
        plane.flush(Some(1_000));
        assert_eq!(plane.mode(), DisplayMode::Composed);
        assert_tip_law(&plane, &oracle);

        for step in 0..400u64 {
            match (rng.next_f64() * 10.0) as u32 {
                0..=4 => {
                    block += 1;
                    let id = next_id;
                    next_id += 1;
                    birth_at(&mut plane, id, block);
                    oracle.born(id, block);
                    live.push(id);
                }
                5..=7 => {
                    if !live.is_empty() {
                        let victim = live.remove((rng.next_f64() * live.len() as f64) as usize);
                        plane.note_removed(victim);
                        oracle.removed(victim);
                    }
                }
                _ => {
                    if !live.is_empty() {
                        let id = live[(rng.next_f64() * live.len() as f64) as usize];
                        plane.note_activity(block, [id]);
                    }
                }
            }
            plane.flush(Some(10_000 + step));
            assert_tip_law(&plane, &oracle);
            assert!(
                plane.class_counts().iter().sum::<usize>() <= 18,
                "step {step}: the curated field outgrew the budget less the window"
            );
            assert!(
                plane.member_ids_sorted().len() <= 24,
                "step {step}: the stage outgrew its budget"
            );
        }
    }

    /// One in, one out: a birth younger than the window's trailing edge
    /// takes exactly that member's seat — not the oldest cell in the map,
    /// which was never on stage to begin with.
    #[test]
    fn a_birth_displaces_exactly_the_oldest_window_member() {
        let mut plane = small_plane(6, 2); // window 4
        for (id, block) in [(0u64, 10u64), (1, 11), (2, 12), (3, 13), (4, 14)] {
            birth_at(&mut plane, id, block);
        }
        let (enter, exit, _) = delta_parts(plane.flush(Some(1_000)));
        assert_eq!(enter, vec![1, 2, 3, 4], "the four youngest, id 0 left out");
        assert!(exit.is_empty());

        birth_at(&mut plane, 5, 15);
        let (enter, exit, _) = delta_parts(plane.flush(Some(1_100)));
        assert_eq!(enter, vec![5]);
        assert_eq!(exit, vec![1], "the trailing edge — never the older id 0");
        assert_eq!(plane.member_ids_sorted(), vec![2, 3, 4, 5]);

        // An arrival that is not younger than the trailing edge changes
        // nothing at all: a late relay does not get to slide the window.
        birth_at(&mut plane, 6, 9);
        assert!(
            plane.flush(Some(1_200)).is_none(),
            "an old arrival leaves the window exactly as it was"
        );
    }

    /// ⭐ The F2 fix. The seat a death opens goes to the next-YOUNGEST live
    /// cell, not to the head of an admission queue.
    ///
    /// The distinction is the whole feature. A live-following server admits
    /// cells oldest-first, so an admission-ordered refill hands every
    /// vacancy to the oldest thing it is still holding, and the stage
    /// drifts backwards in time for as long as it runs.
    #[test]
    fn a_window_death_refills_with_the_next_youngest_not_the_admission_backlog() {
        let mut plane = small_plane(6, 2); // window 4
        for (id, block) in [(0u64, 10u64), (1, 11), (2, 12), (3, 13), (4, 14), (5, 15)] {
            birth_at(&mut plane, id, block);
        }
        plane.flush(Some(1_000));
        assert_eq!(plane.member_ids_sorted(), vec![2, 3, 4, 5]);

        plane.note_removed(3);
        let (enter, exit, _) = delta_parts(plane.flush(Some(1_100)));
        assert_eq!(
            enter,
            vec![1],
            "the seat went to the next-youngest (block 11), not to id 0 at the queue head"
        );
        assert_eq!(exit, vec![3]);
    }

    /// Requirement 3, verbatim: with no reservoir the ENTIRE stage is the
    /// recency window, and it keeps sliding after boot instead of freezing
    /// on whatever the backfill happened to reach.
    #[test]
    fn prefix_mode_slides_the_whole_stage_with_the_chain_tip() {
        // The resting field IS the window here: 4 seats.
        let mut plane = small_plane(6, 2);
        // Boot: the backfill walks the anchored tip BACKWARDS, so admission
        // order already descends in height (audit finding F1).
        for (id, block) in [(0u64, 100u64), (1, 99), (2, 98), (3, 97), (4, 96), (5, 95)] {
            birth_at(&mut plane, id, block);
        }
        plane.flush(Some(1_000));
        assert_eq!(
            plane.member_ids_sorted(),
            vec![0, 1, 2, 3],
            "boot stages the newest four the backfill reached"
        );
        assert_eq!(
            plane.resting_len(),
            4,
            "…every one of them standing, none of them transient"
        );

        // Post-boot: a birth at the live tip. Nothing died, no vacancy
        // opened — it enters BECAUSE it is newer, and the trailing edge
        // lets go. This is the freeze the old prefix could not thaw.
        birth_at(&mut plane, 6, 101);
        let (enter, exit, _) = delta_parts(plane.flush(Some(1_100)));
        assert_eq!(enter, vec![6]);
        assert_eq!(exit, vec![3], "the trailing edge, block 97");
        assert_eq!(plane.resting_len(), 4);

        // …and it keeps sliding, block after block.
        for (id, block) in [(7u64, 102u64), (8, 103)] {
            birth_at(&mut plane, id, block);
            plane.flush(Some(1_100 + block));
        }
        assert_eq!(
            plane.member_ids_sorted(),
            vec![0, 6, 7, 8],
            "the stage is the four newest cells on the chain, still"
        );
    }

    /// A composed stage whose field is fully staffed and whose window is
    /// full, with one endpoint on the FIFO holding a curated member on the
    /// bench. Used by the two interplay cases below.
    fn composed_stage_with_a_bench() -> DisplayPlane {
        // Budget 8 = a curated field of 6 + a window of 2; quota 1.
        let mut plane = tip_plane(8, 1, 2);
        let kinds = [
            AssetKind::Dao,    // 0
            AssetKind::Xudt,   // 1
            AssetKind::Xudt,   // 2
            AssetKind::Xudt,   // 3
            AssetKind::Xudt,   // 4
            AssetKind::Xudt,   // 5  ← the typed the field's quota leaves out
            AssetKind::Native, // 6
            AssetKind::Native, // 7
            AssetKind::Native, // 8
        ];
        let canonical: Vec<Cell> = kinds
            .iter()
            .enumerate()
            .map(|(i, kind)| {
                let mut cell = cell_with(i as u64, &format!("0x{i}"), *kind, 0);
                cell.birth_block = 50 + i as u64;
                cell
            })
            .collect();
        seed_canonical(&mut plane, &canonical, 500);
        // Empty reservoir → a pure canonical fallback fill over the FIELD:
        // targets(6) = {1,4,1} ⇒ dao [0], typed [1,2,3,4], plain [6].
        // Unchosen: typed 5 (block 55), plain 7 (57) and 8 (58) — and the
        // window takes the two YOUNGEST of those three.
        plane.reservoir_replaced(
            &record(10, vec![], vec![], vec![]),
            &outpoint_index(&canonical),
            &canonical,
        );
        plane.flush(Some(1_000));
        assert_eq!(plane.class_counts(), [1, 4, 1]);
        assert_eq!(plane.tip_ids_sorted(), vec![7, 8]);
        assert_eq!(plane.member_ids_sorted(), vec![0, 1, 2, 3, 4, 6, 7, 8]);

        // Typed endpoint 5 (block 55) is older than the window's trailing
        // edge (block 57), so the window does not want it: it enters the
        // FIFO the way it always has, displacing the latest typed admit (4)
        // onto the bench.
        plane.note_activity(60, [5]);
        let (enter, exit, _) = delta_parts(plane.flush(Some(2_000)));
        assert_eq!(enter, vec![5]);
        assert_eq!(exit, vec![4]);
        assert!(plane.is_activity_member(5));
        assert_eq!(plane.class_counts(), [1, 4, 1]);
        plane
    }

    /// Window churn is the window's own business: a younger birth takes a
    /// window seat and NOTHING about the curated field moves — no class
    /// count, no ratchet victim, and the benched member stays benched.
    #[test]
    fn window_churn_never_touches_a_curated_member_or_its_bench() {
        let mut plane = composed_stage_with_a_bench();
        let field_before: Vec<u64> = plane
            .member_ids_sorted()
            .into_iter()
            .filter(|id| plane.is_field_resting(*id))
            .collect();

        birth_at(&mut plane, 9, 100);
        let (enter, exit, _) = delta_parts(plane.flush(Some(3_000)));
        assert_eq!(enter, vec![9]);
        assert_eq!(exit, vec![7], "the window's own trailing edge gave way");

        assert_eq!(
            plane.class_counts(),
            [1, 4, 1],
            "the class law did not feel the window move"
        );
        assert_eq!(
            plane
                .member_ids_sorted()
                .into_iter()
                .filter(|id| plane.is_field_resting(*id))
                .collect::<Vec<_>>(),
            field_before,
            "every curated member kept its seat"
        );
        assert!(
            plane.is_activity_member(5),
            "the displacer is still standing"
        );
        assert!(
            !plane.member_ids_sorted().contains(&4),
            "and its bench is still benched"
        );
        assert_eq!(plane.tip_ids_sorted(), vec![8, 9]);
    }

    /// ⭐ The FIFO interplay. An endpoint the window did not want gets a
    /// transient seat; when the window's trailing edge falls back past it —
    /// here because the window's youngest member is GC'd — the endpoint
    /// SETTLES into the window instead of waiting to be evicted.
    ///
    /// Settling is a role change in place, so nothing rides the wire for
    /// it; what does ride is the consequence, which is that the field slot
    /// the endpoint was borrowing goes back to the member it displaced. The
    /// bench discipline is the eviction path's, reused exactly.
    #[test]
    fn an_endpoint_the_window_claims_settles_and_gives_its_bench_back() {
        let mut plane = composed_stage_with_a_bench();

        // The window's youngest member is GC'd. Its seat is now the oldest
        // the window can offer, and endpoint 5 (block 55) qualifies.
        plane.note_removed(8);
        let (enter, exit, _) = delta_parts(plane.flush(Some(3_000)));
        assert_eq!(exit, vec![8]);
        assert_eq!(
            enter,
            vec![4],
            "the benched curated member came back — that is the settle's whole wire trace"
        );

        assert!(plane.is_tip_member(5), "5 settled into the window");
        assert!(
            !plane.is_activity_member(5),
            "…and gave the FIFO its slot back"
        );
        assert_eq!(plane.activity_len(), 0);
        assert_eq!(
            plane.class_counts(),
            [1, 4, 1],
            "the field is whole again, at the same ratio"
        );
        assert!(plane.is_field_resting(4), "restored as a curated member");
        assert_eq!(plane.tip_ids_sorted(), vec![5, 7]);
    }

    /// An old cell that merely pulsed leaves exactly as it always has: the
    /// window never wanted it, the FIFO evicts it on age, and the curated
    /// member it displaced is restored by the same bench path.
    #[test]
    fn an_endpoint_the_window_does_not_want_leaves_with_its_bench_restored() {
        let mut plane = composed_stage_with_a_bench();

        // A second endpoint, also older than the window's edge, overflows
        // the one-slot quota and evicts 5.
        plane.note_activity(61, [4]);
        let (enter, exit, _) = delta_parts(plane.flush(Some(3_000)));
        assert_eq!(exit, vec![5], "evicted on age, not claimed by the window");
        assert_eq!(
            enter,
            vec![4],
            "and its bench came back — as the new displacer"
        );

        assert!(!plane.is_tip_member(5));
        assert_eq!(
            plane.tip_ids_sorted(),
            vec![7, 8],
            "the window did not move"
        );
        assert_eq!(plane.class_counts(), [1, 4, 1]);
        assert_eq!(
            plane.member_ids_sorted().len(),
            8,
            "the stage is still exactly full"
        );
    }

    /// Reorg: a rolled-back birth is a SILENT canonical removal, and the
    /// recency index has to lose it with the rollback — seat, candidacy and
    /// rank. The cells it displaced are the youngest again and come back.
    #[test]
    fn a_rolled_back_birth_leaves_the_window_with_its_rollback() {
        let mut plane = small_plane(6, 2); // window 4
        for (id, block) in [(0u64, 10u64), (1, 11), (2, 12), (3, 13)] {
            birth_at(&mut plane, id, block);
        }
        plane.flush(Some(1_000));
        assert_eq!(plane.member_ids_sorted(), vec![0, 1, 2, 3]);

        birth_at(&mut plane, 4, 14);
        birth_at(&mut plane, 5, 15);
        let (enter, exit, _) = delta_parts(plane.flush(Some(1_100)));
        assert_eq!(enter, vec![4, 5]);
        assert_eq!(exit, vec![0, 1]);

        // The reorg parks both births.
        plane.note_removed(4);
        plane.note_removed(5);
        let (enter, exit, _) = delta_parts(plane.flush(Some(1_200)));
        assert_eq!(exit, vec![4, 5]);
        assert_eq!(
            enter,
            vec![0, 1],
            "the cells they displaced are the youngest live ones again"
        );
        assert_eq!(plane.member_ids_sorted(), vec![0, 1, 2, 3]);

        // The replacement chain revives one at the height it now has: it
        // re-enters through the ordinary birth path and ranks afresh.
        birth_at(&mut plane, 4, 14);
        let (enter, exit, _) = delta_parts(plane.flush(Some(1_300)));
        assert_eq!(enter, vec![4]);
        assert_eq!(exit, vec![0]);
    }

    // ═══ S2 composed mode ════════════════════════════════════════════

    /// Quota math against the shared constant: 20:70:10 with the
    /// remainder folded into plain.
    #[test]
    fn for_total_matches_the_shared_quota_constant() {
        assert_eq!(
            GalaxyCompositionTarget::for_total(6_000),
            GalaxyCompositionTarget {
                dao: 1_200,
                typed: 4_200,
                plain: 600,
            }
        );
        assert_eq!(
            GalaxyCompositionTarget::for_total(12_000),
            GalaxyCompositionTarget {
                dao: 2_400,
                typed: 8_400,
                plain: 1_200,
            }
        );
        // Remainder-to-plain (floor(0.20·n) + floor(0.70·n) + rest).
        assert_eq!(
            GalaxyCompositionTarget::for_total(7),
            GalaxyCompositionTarget {
                dao: 1,
                typed: 4,
                plain: 2,
            }
        );
    }

    /// Golden case 1 — the 6000-cell resting field composed at exactly
    /// 20:70:10: empty canonical map, full reservoir → every record cell
    /// stages as a resident and the class split is exactly 1200/4200/600.
    #[test]
    fn golden_full_reservoir_composes_exactly_20_70_10() {
        let mut plane = small_plane(6_000, 8);
        let dao: Vec<Cell> = (0..1_200)
            .map(|i| cell_with(10_000 + i, &format!("0xd{i}"), AssetKind::Dao, 0))
            .collect();
        let typed: Vec<Cell> = (0..4_200)
            .map(|i| cell_with(20_000 + i, &format!("0xt{i}"), AssetKind::Xudt, 0))
            .collect();
        let plain: Vec<Cell> = (0..600)
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
        assert_eq!(plane.class_counts(), [1_200, 4_200, 600]);
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

        // Expected set (budget 10 → targets {2,7,1}; dao 101 resolves to
        // canonical 1, so quota dao is [1, 102], typed takes all four it
        // has, plain [301], and the 3-slot spill adds dao 103 then plain
        // 302 and 303): {1, 102, 103, 201..204, 301..303}.
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
    /// algorithm: canonical field ids 0..24 (kind pattern id%7→dao,
    /// id%3→typed, else plain), one resident per reservoir class, budget
    /// 12 → targets {2,8,2}; the fallback walk runs to id 24 and stops
    /// with every quota satisfied. Expected membership:
    /// dao [1001, 0] · typed [2001, 3, 6, 9, 12, 15, 18, 24] · plain [3001, 1].
    ///
    /// The field is 25 wide, not 24, because the typed quota now needs an
    /// eighth typed cell to be satisfiable at all: at 24 the walk would
    /// run out of map instead of stopping on quota, and the early-stop
    /// guard this case exists to pin would go untested.
    #[test]
    fn golden_sparse_reservoir_fills_from_canonical_fallback() {
        let mut plane = small_plane(12, 2);
        let canonical = canonical_field(25);
        seed_canonical(&mut plane, &canonical, 500);

        let rec = record(
            10,
            vec![cell_with(1_001, "0xrd", AssetKind::Dao, 0)],
            vec![cell_with(2_001, "0xrt", AssetKind::Xudt, 0)],
            vec![cell_with(3_001, "0xrp", AssetKind::Native, 0)],
        );
        plane.reservoir_replaced(&rec, &outpoint_index(&canonical), &canonical);
        plane.flush(Some(1_000));

        let expected: BTreeSet<u64> = [1_001, 0, 2_001, 3, 6, 9, 12, 15, 18, 24, 3_001, 1].into();
        assert_eq!(member_set(&plane), expected);
        assert_eq!(plane.class_counts(), [2, 8, 2]);
        assert_eq!(plane.resident_ids_sorted(), vec![1_001, 2_001, 3_001]);
    }

    /// Golden case 4 — the old client's spill loop is a ROUND-ROBIN over
    /// dao → typed → plain (one candidate per class per round), not a
    /// sequential drain (cellRenderSet.ts spill loop). dao tail
    /// [d3, d4, d5], typed short by 2, plain tail [p2..p5]: the 2-slot
    /// shortfall takes d3 then p2 — a drain would have taken d3 then d4
    /// and never reached plain.
    ///
    /// The typed supply is 5 rather than 2 on purpose. Under the wider
    /// typed quota a two-cell typed bucket leaves a five-slot shortfall,
    /// and five slots drain past the dao tail into plain either way —
    /// round-robin and drain agree, and the case stops discriminating.
    /// Keeping typed nearly full keeps the shortfall smaller than the
    /// dao tail, which is the only condition under which the two spill
    /// orders differ.
    #[test]
    fn golden_spill_is_round_robin_dao_typed_plain() {
        let mut plane = small_plane(10, 2);
        let dao: Vec<Cell> = (1..=5)
            .map(|i| cell_with(100 + i, &format!("0xd{i}"), AssetKind::Dao, 0))
            .collect();
        let typed: Vec<Cell> = (1..=5)
            .map(|i| cell_with(200 + i, &format!("0xt{i}"), AssetKind::Xudt, 0))
            .collect();
        let plain: Vec<Cell> = (1..=5)
            .map(|i| cell_with(300 + i, &format!("0xp{i}"), AssetKind::Native, 0))
            .collect();
        let rec = record(10, dao, typed, plain);
        plane.reservoir_replaced(&rec, &HashMap::new(), &[]);
        plane.flush(Some(1_000));

        // targets(10) = {2,7,1}; chosen dao 2, typed 5, plain 1 = 8;
        // spill round 1: dao 103, then plain 302 → 10.
        let expected: BTreeSet<u64> = [101, 102, 103, 201, 202, 203, 204, 205, 301, 302].into();
        assert_eq!(member_set(&plane), expected);
        assert_eq!(plane.class_counts(), [3, 5, 2]);
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
        plane.chain_reorganized(10);
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
        plane.chain_reorganized(11);
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
                                           // Canonical: 2 dao, 5 typed, 2 plain — the fifth typed is the
                                           // one the quota leaves off stage.
        let canonical = vec![
            cell_with(0, "0xa", AssetKind::Dao, 0),
            cell_with(1, "0xb", AssetKind::Dao, 0),
            cell_with(2, "0xc", AssetKind::Xudt, 0),
            cell_with(3, "0xd", AssetKind::Xudt, 0),
            cell_with(4, "0xe", AssetKind::Native, 0),
            cell_with(5, "0xf", AssetKind::Native, 0),
            cell_with(6, "0xg", AssetKind::Xudt, 0),
            cell_with(8, "0xi", AssetKind::Xudt, 0),
            cell_with(9, "0xj", AssetKind::Xudt, 0),
        ];
        seed_canonical(&mut plane, &canonical, 500);
        // Budget 6 < 10 → whole-map admission; targets(6) = {1,4,1} ⇒
        // dao [0] typed [2,3,6,8] plain [4] → members {0,2,3,4,6,8},
        // all Fallback admits in walk order. Typed 9, dao 1 and plain 5
        // are the off-stage remainder.
        let rec = record(10, vec![], vec![], vec![]);
        plane.reservoir_replaced(&rec, &outpoint_index(&canonical), &canonical);
        plane.flush(Some(1_000));
        assert_eq!(member_set(&plane), [0, 2, 3, 4, 6, 8].into());
        assert_eq!(plane.class_counts(), [1, 4, 1]);

        // Off-stage typed endpoint 9 enters: displaces the LATEST
        // fallback-admitted typed resting member (8), not 2.
        plane.note_activity(20, [9]);
        let (enter, exit, _) = delta_parts(plane.flush(Some(2_000)));
        assert_eq!(enter, vec![9]);
        assert_eq!(exit, vec![8]);
        assert!(plane.is_activity_member(9));
        assert_eq!(plane.class_counts(), [1, 4, 1], "in-class swap holds I1");

        // A later-block endpoint overflows the 1-slot quota: 9 evicts
        // and its benched member 8 returns — one coalesced swap. The
        // new endpoint (a plain birth, 7) displaces in ITS class.
        let extra = cell_with(7, "0xh", AssetKind::Native, 0);
        plane.note_birth(&extra);
        plane.note_activity(21, [7]);
        let (enter, exit, _) = delta_parts(plane.flush(Some(3_000)));
        assert_eq!(enter, vec![7, 8]);
        assert_eq!(exit, vec![4, 9]); // 4 = the only plain fallback admit; 9 = quota eviction
        assert!(plane.is_activity_member(7));
        assert!(!plane.is_activity_member(8), "restored as resting");
        assert_eq!(plane.class_counts(), [1, 4, 1]);
        assert_eq!(member_set(&plane), [0, 2, 3, 6, 7, 8].into());
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
        // available 5 > budget 4; targets(4)={0,2,2}: typed [2001, 0],
        // plain [1] + spill: dao 2 → members {2001, 0, 1, 2}.
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
        // = {0,2,2}: typed [1,2], plain [3], spill takes dao 0).
        // Standing activity 2 is INSIDE the fill → promoted to resting,
        // quota emptied.
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

        // Refresh 2 (content differs: a typed resident): the typed
        // quota is [902, 1] — the resident ranks ahead of the canonical
        // walk — so the new fill is {902, 1, 3, 0} and canonical typed 2
        // is pushed off into the class queue. Standing activity 4 is
        // OUTSIDE the new fill → it re-displaces in class against it,
        // taking the FALLBACK admit 1 rather than the reservoir admit
        // 902, and keeps its activity role; the old bench (2) is
        // superseded by the recomposition.
        let rec2 = record(
            20,
            vec![],
            vec![cell_with(902, "0xrt", AssetKind::Xudt, 0)],
            vec![],
        );
        plane.reservoir_replaced(&rec2, &outpoint_index(&canonical), &canonical);
        let (enter_ids, enter_cells, exit, provenance) = full_delta_parts(plane.flush(Some(3_000)));
        assert!(enter_ids.is_empty());
        assert_eq!(
            enter_cells.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![902]
        );
        assert_eq!(exit, vec![1]);
        assert_eq!(
            provenance
                .expect("refresh rides provenance")
                .as_of
                .map(|a| a.block),
            Some(20)
        );
        assert_eq!(member_set(&plane), [0, 3, 4, 902].into());
        assert!(
            plane.is_activity_member(4),
            "activity role survives refresh"
        );
        assert_eq!(plane.class_counts(), [1, 2, 1]);
    }

    // ═══ T2 demand ═══════════════════════════════════════════════════

    fn with_sink(plane: &mut DisplayPlane) -> Arc<CompositionDemandSink> {
        let sink = Arc::new(CompositionDemandSink::new());
        plane.set_demand_sink(sink.clone());
        sink
    }

    /// The mainnet pathology this iteration exists to fix, reproduced in
    /// the shipped configuration: 12,000 seats of which the recency window
    /// standingly holds 1,200, so the composition is measured on the 10,800
    /// curated field. A 6K reservoir plus a retained map that is ~99% plain
    /// composes to roughly 1.8K/2.8K/6.1K instead of 2160/7560/1080,
    /// because dao and typed simply run out of candidates.
    ///
    /// Demand must be measured against the IDEAL quota. Against
    /// `class_targets` — what this refresh actually landed on — it would
    /// read zero forever and the lopsided stage would look healthy.
    #[test]
    fn demand_measures_the_ideal_quota_not_the_ratio_this_refresh_landed_on() {
        let mut plane = tip_plane(12_000, 512, DISPLAY_TIP_WINDOW);
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

        // The 6K reservoir, at the old 30:40:30 split it happens to
        // arrive in — the shortfall is measured against the quota, not
        // against whatever shape the refresh landed on.
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
        // the FIELD through the spill.
        assert_eq!(plane.class_counts(), [1_848, 2_812, 6_140]);
        assert_eq!(
            plane.class_counts().iter().sum::<usize>(),
            DISPLAY_CURATED_FIELD,
            "the field is full — the shortfall is in the RATIO, not the count"
        );
        assert_eq!(
            plane.member_ids_sorted().len(),
            12_000,
            "and the window's 1,200 stand beside it: the stage is exactly full"
        );

        let demand = sink.read();
        assert!(demand.curated);
        assert_eq!(demand.dao, 2_160 - 1_848);
        assert_eq!(demand.typed, 7_560 - 2_812);
        assert_eq!(demand.total(), 5_060);
        assert!(!demand.is_empty());
    }

    /// Demand is a function of what is staged, so closing the gap closes
    /// the demand — and plain never appears in it at all (D5).
    #[test]
    fn demand_tracks_staged_counts_and_ignores_plain() {
        let mut plane = small_plane(10, 2);
        let sink = with_sink(&mut plane);
        // targets(10) = {2,7,1}. Give dao its full 2 and typed 6 of 7,
        // plain plenty.
        let rec = record(
            10,
            (1..=2)
                .map(|i| cell_with(100 + i, &format!("0xd{i}"), AssetKind::Dao, 0))
                .collect(),
            (1..=6)
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
            [2, 6, 2],
            "typed short by one, plain over"
        );
        assert_eq!(
            sink.read(),
            CompositionDemand {
                curated: true,
                dao: 0,
                typed: 1,
            },
            "dao is satisfied; plain is over quota and still never asked for"
        );

        // Spending a staged typed widens the gap by exactly one.
        plane.note_input_unresolved(&OutPoint {
            tx_hash: "0xt1".into(),
            index: 0,
        });
        plane.flush(Some(2_000));
        assert_eq!(sink.read().typed, 2);
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

        plane.chain_reorganized(10);
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
        // targets(10) = {2,7,1}. An all-plain canonical map composes to
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

        // Two dao arrive. Plain sits nine over its quota of one, so it
        // yields twice — latest-admitted first (member 9, then 8).
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

        // targets(4) = {0,2,2}: plain is at quota and dao is already
        // over its (zero) share, held there by the spill. Even so, offer
        // more dao — nothing may be displaced for it.
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
        let mut plane = small_plane(10, 2); // targets(10) = {2,7,1}
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

        // Five dao offered against a quota of two.
        let supply = top_up(
            20,
            (1..=5)
                .map(|i| cell_with(9_000 + i, &format!("0xs{i}"), AssetKind::Dao, 0))
                .collect(),
            vec![],
        );
        plane.reservoir_topped_up(&supply, &outpoint_index(&canonical));
        plane.flush(Some(2_000));
        assert_eq!(plane.class_counts(), [2, 0, 8], "exactly the dao quota");
        assert_eq!(member_set(&plane).len(), 10);
    }

    /// Drives the supervisor's bounded top-up loop until the stage stops
    /// moving, asserting the ratchet's invariants on every round: dao and
    /// typed only ever climb, plain only ever falls, the stage is always
    /// exactly full, and neither curated class overshoots its quota.
    /// Returns the number of rounds the ratchet took to settle.
    fn drive_ratchet(
        plane: &mut DisplayPlane,
        sink: &Arc<CompositionDemandSink>,
        index: &HashMap<OutPoint, u64>,
        supplied: &mut u64,
        base_block: u64,
    ) -> u64 {
        const PER_CLASS_PER_TICK: usize = 256;
        let quota = GalaxyCompositionTarget::for_total(DISPLAY_CURATED_FIELD);
        let mut previous = plane.class_counts();
        let mut rounds = 0u64;
        loop {
            rounds += 1;
            assert!(rounds < 40, "should settle in ~20 rounds, not spin");
            let demand = sink.read();
            let dao: Vec<Cell> = (0..demand.dao.min(PER_CLASS_PER_TICK))
                .map(|_| {
                    *supplied += 1;
                    let n = *supplied;
                    cell_with(500_000 + n, &format!("0xsd{n}"), AssetKind::Dao, 0)
                })
                .collect();
            let typed: Vec<Cell> = (0..demand.typed.min(PER_CLASS_PER_TICK))
                .map(|_| {
                    *supplied += 1;
                    let n = *supplied;
                    cell_with(500_000 + n, &format!("0xst{n}"), AssetKind::Xudt, 0)
                })
                .collect();
            plane.reservoir_topped_up(&top_up(base_block + rounds, dao, typed), index);
            plane.flush(Some(base_block * 100 + rounds * 10));

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
                DISPLAY_CURATED_FIELD,
                "round {rounds}: the curated field is always exactly full"
            );
            assert_eq!(
                plane.member_ids_sorted().len(),
                12_000,
                "round {rounds}: field + recency window = the whole stage"
            );
            assert!(
                now[0] <= quota.dao && now[1] <= quota.typed,
                "never overshoots"
            );
            // Nothing moved: nobody is left who is both over quota and
            // allowed to yield. That is the ratchet's fixed point.
            if now == previous {
                return rounds;
            }
            previous = now;
        }
    }

    /// ⭐ The one-way ratchet, in two acts — on the CURATED FIELD, which
    /// is the 12,000-seat stage less the recency window's standing 1,200.
    ///
    /// Act 1 — starting from the live mainnet shape, bounded rounds of
    /// supply climb monotonically until plain has nothing left it is
    /// ALLOWED to yield. Victims come only from the canonical-fallback
    /// group, and this reservoir's own 1,800 plain candidates are curated
    /// members — 720 more than the whole 1,080 plain quota. So plain
    /// floors at 1,800 rather than 1,080; the field is exactly full
    /// throughout, which makes those 720 slots plain will not give up
    /// exactly the 720 typed the field ends up short. The residue is
    /// arithmetic, not a defect, and it stays published as demand.
    ///
    /// Act 2 — a refresh whose plain share does not EXCEED the quota
    /// removes that floor, and the same bounded rounds land exactly on
    /// 2160/7560/1080. The adapter composes at the FIELD's size, so the
    /// plain it really discovers sits exactly ON the quota; this smaller
    /// record is the same case with room to spare.
    ///
    /// Throughout, the recency window holds its own 1,200 beside the field
    /// and the ratchet never touches them: tip churn moves no class count,
    /// and a plain member the ratchet releases is claimed by the window
    /// only if it is one of the newest cells there are — which is the
    /// freshness law doing exactly its job with a seat the class law just
    /// gave up.
    #[test]
    fn bounded_rounds_climb_monotonically_and_the_ratchet_floors_on_curated_plain() {
        let mut plane = tip_plane(12_000, 512, DISPLAY_TIP_WINDOW);
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
        assert_eq!(plane.class_counts(), [1_848, 2_812, 6_140]);

        // Bounded rounds, exactly as the supervisor will drive them:
        // fetch at most 256 per class per tick, sized by the published
        // demand, until the stage stops moving.
        let mut supplied = 0u64;
        let rounds = drive_ratchet(&mut plane, &sink, &index, &mut supplied, 20);

        assert_eq!(
            plane.class_counts(),
            [2_160, 6_840, 1_800],
            "dao made its quota; plain would not go below its curated members"
        );
        assert_eq!(
            sink.read(),
            CompositionDemand {
                curated: true,
                dao: 0,
                typed: 720,
            },
            "the residue stays a STANDING demand, not a closed one"
        );
        assert_eq!(
            plane.class_counts()[2]
                - GalaxyCompositionTarget::for_total(DISPLAY_CURATED_FIELD).plain,
            sink.read().typed,
            "plain's curated surplus IS the typed shortfall, slot for slot"
        );
        assert!(rounds >= 8, "the bound really did spread it over rounds");

        // Act 2 — a reservoir shaped the way the quota asks for it. Plain
        // brings 540 curated members instead of 1,800, so the floor is
        // below the quota and the ratchet runs clean.
        let quota = GalaxyCompositionTarget::for_total(5_400);
        let shaped = record(
            500,
            (0..quota.dao)
                .map(|i| cell_with(60_000 + i as u64, &format!("0xqd{i}"), AssetKind::Dao, 0))
                .collect(),
            (0..quota.typed)
                .map(|i| cell_with(70_000 + i as u64, &format!("0xqt{i}"), AssetKind::Xudt, 0))
                .collect(),
            (0..quota.plain)
                .map(|i| cell_with(80_000 + i as u64, &format!("0xqp{i}"), AssetKind::Native, 0))
                .collect(),
        );
        plane.reservoir_replaced(&shaped, &index, &canonical);
        plane.flush(Some(50_000));
        let rounds = drive_ratchet(&mut plane, &sink, &index, &mut supplied, 1_000);

        assert_eq!(
            plane.class_counts(),
            [2_160, 7_560, 1_080],
            "20:70:10 of the curated field, reached"
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
        // targets(4) = {0,2,2}: typed [1], plain [301, 2] + spill: dao
        // [0]; the plain refill queue holds the unchosen canonical 3.
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
        // targets(4) = {0,2,2}: plain stages [301, 302]; the plain queue
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
        // targets(4)={0,2,2}: typed [1], plain [2,3] + spill: dao [0];
        // queue plain holds [4].
        assert_eq!(member_set(&plane), [0, 1, 2, 3].into());

        plane.note_removed(3);
        let (enter, exit, _) = delta_parts(plane.flush(Some(2_000)));
        assert_eq!(enter, vec![4], "class queue refills the plain vacancy");
        assert_eq!(exit, vec![3]);
        assert_eq!(plane.class_counts(), [1, 1, 2]);
    }
}
