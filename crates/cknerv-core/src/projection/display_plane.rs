//! Display plane — "who is on stage" for the cell galaxy (S1: prefix mode).
//!
//! The plane owns display MEMBERSHIP as presentation policy layered on top
//! of the canonical cell projection. It decides which canonical cells are
//! staged for rendering, within a fixed product budget, and emits at most
//! one coalesced [`CellDelta::Display`] per mutation. It never touches
//! canonical truth (invariant I2): no counters move, the `cells` map is
//! never written, and nothing here is persisted (`CellGalaxyPersisted`
//! carries no display state — after a restore the plane is rebuilt from
//! the restored map by [`DisplayPlane::bootstrap`]).
//!
//! ## Membership policy (prefix / canonical mode)
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
//!
//!   This reserved-pool scheme (resting target + fixed activity pool) is
//!   deliberate for S1. Composed mode (S2) replaces it with in-class
//!   quota substitution per `docs/ckbadger.md`: activity endpoints swap
//!   against same-class members inside the 30:40:30 composition quotas
//!   instead of drawing from a reserved pool.
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
//! ## Determinism
//!
//! Everything on the wire is derived from mutation content and the
//! canonical container's insertion order (`CellGalaxy.cells` is a `Vec`,
//! so canonical iteration order IS insertion order). The plane still
//! keeps its own insertion-order queue + presence mirror because the
//! canonical container has no id index (membership checks would be
//! linear scans) and `Vec` positions shift under `retain`/`remove`.
//! `enter_ids`/`exit_ids` are emitted sorted, members serialize in
//! ascending id order, and timestamps come exclusively from
//! mutation-carried `at` values (no wall clocks). Nondeterministic
//! upstream orders (e.g. `reorg_limbo` HashMap drains) never reach the
//! display wire.
//!
//! ## Cost
//!
//! Every operation is O(churn) per mutation (touched ids only), plus an
//! amortized-O(1) understudy compaction. Full passes over membership
//! happen only at bootstrap (restore), reset, and the backfill-terminal
//! resettle — all replay-boundary events.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};

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
/// Reserved activity pool: latest-block tx endpoints on stage.
pub const DISPLAY_ACTIVITY_QUOTA: usize = 512;

/// How many stale understudy entries we tolerate before compacting the
/// queue against the presence mirror. `2·present + slack` keeps the
/// compaction amortized O(1) per insertion.
const UNDERSTUDY_COMPACT_SLACK: usize = 1_024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MemberRole {
    Resting,
    /// Entered via a tx-endpoint swap; `block` keys the eviction FIFO.
    Activity {
        block: u64,
    },
}

/// See the module docs. Owned by `CellGalaxy`; every canonical handler
/// reports births/removals/endpoints as they happen and `apply_mutation`
/// calls [`DisplayPlane::flush`] exactly once at the end — which is what
/// structurally guarantees "at most one `Display` delta per mutation".
pub(crate) struct DisplayPlane {
    budget: DisplayBudget,
    activity_quota: usize,
    /// budget.cells − activity_quota.
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

    /// Mirror of the canonical cells-map key set, maintained by the same
    /// note_* hooks that drive membership. Needed because the canonical
    /// container (`Vec<Cell>`) has no id index.
    present: HashSet<u64>,
    /// Insertion-order backfill candidates ("understudies"): ids that
    /// were born while the resting set was full, in canonical insertion
    /// order. May contain stale ids (removed while waiting — skipped at
    /// pop) and, after a removal+rebirth, duplicates (the extra entry is
    /// skipped when it surfaces already-resting).
    understudies: VecDeque<u64>,

    /// Per-mutation coalescing log: id → was-member at first touch this
    /// mutation. Diffed against final membership at flush.
    touched: HashMap<u64, bool>,
    /// Tx endpoints reported this mutation, in arrival order.
    pending_activity: Vec<(u64, u64)>, // (block, id)

    provenance: DisplayProvenance,
    /// Set once the wire has learned a non-empty membership; the first
    /// emitted delta rides provenance (mode Canonical, updated_at_ms
    /// from the mutation clock).
    first_fill_done: bool,
    /// Latest mutation-carried timestamp; used only for provenance on
    /// mutations that carry no `at` themselves.
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

    /// Test seam: shrink the budgets so quota/FIFO behavior is
    /// exercisable without minting thousands of cells.
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
            present: HashSet::new(),
            understudies: VecDeque::new(),
            touched: HashMap::new(),
            pending_activity: Vec::new(),
            provenance: DisplayProvenance {
                mode: DisplayMode::Canonical,
                source: None,
                as_of: None,
                updated_at_ms: 0,
            },
            first_fill_done: false,
            last_at_ms: 0,
            backfill_active: false,
            backfill_baseline: None,
            resettle_pending: false,
        }
    }

    // ── hooks (called by CellGalaxy handlers mid-mutation) ───────────

    /// A cell entered the canonical map (fresh birth, reorg revival, or
    /// rollback resurrection). Idempotent: in-place resurrections of an
    /// id that never left the map are no-ops.
    pub(crate) fn note_birth(&mut self, id: u64) {
        if self.present.insert(id) {
            self.understudies.push_back(id);
            self.maybe_compact_understudies();
        }
    }

    /// A cell left the canonical map — this must cover EVERY removal
    /// path (GC sweep, reorg parking, reset). Staged members exit here;
    /// the vacancy backfills at the next flush.
    pub(crate) fn note_removed(&mut self, id: u64) {
        if !self.present.remove(&id) {
            return;
        }
        if let Some(role) = self.members.remove(&id) {
            self.touched.entry(id).or_insert(true);
            match role {
                MemberRole::Resting => self.resting_count -= 1,
                MemberRole::Activity { block } => {
                    self.activity_count -= 1;
                    self.remove_from_activity_group(block, id);
                }
            }
        }
        // A stale understudy entry (if any) is skipped at pop time.
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
    /// delta), all internal state clears. Provenance is unchanged — the
    /// mode is still Canonical.
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

    /// Rebuild after a persisted-state restore: resting membership is
    /// re-derived from the restored map in insertion order. Emits no
    /// delta — there are no clients before boot completes, and every
    /// snapshot taken after `load()` already carries this fill.
    pub(crate) fn bootstrap(&mut self, cells: &[Cell]) {
        self.members.clear();
        self.resting_count = 0;
        self.activity_count = 0;
        self.activity_groups.clear();
        self.present.clear();
        self.understudies.clear();
        self.touched.clear();
        self.pending_activity.clear();
        self.backfill_active = false;
        self.backfill_baseline = None;
        self.resettle_pending = false;

        for cell in cells {
            if self.present.insert(cell.id) {
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
            self.first_fill_done = true;
            self.provenance.updated_at_ms = at_ms;
            self.last_at_ms = at_ms;
        }
    }

    // ── flush (called once per mutation by apply_mutation) ───────────

    /// Settle this mutation's membership consequences and emit the one
    /// coalesced `Display` delta, if membership changed. `at_ms` is the
    /// mutation-carried timestamp when it has one.
    pub(crate) fn flush(&mut self, at_ms: Option<u64>) -> Option<CellDelta> {
        if let Some(at) = at_ms {
            self.last_at_ms = at;
        }

        // 1. Resting backfill from the insertion-order cursor. Runs even
        //    during backfill (membership evolves silently).
        self.fill_resting_vacancies();

        // 2. Activity entries — suppressed during historical replay
        //    (calm catch-up; the terminal resettle presents the final
        //    membership in one piece).
        if self.backfill_active {
            self.pending_activity.clear();
        } else {
            let pending = std::mem::take(&mut self.pending_activity);
            for (block, id) in pending {
                if self.members.contains_key(&id) || !self.present.contains(&id) {
                    continue; // already on stage / defensive: unknown id
                }
                self.touched.entry(id).or_insert(false);
                self.members.insert(id, MemberRole::Activity { block });
                self.activity_count += 1;
                self.activity_groups.entry(block).or_default().push(id);
            }
            // 3. Quota: evict oldest-block activity members first. Only
            //    activity structures are drained — resting members are
            //    never evicted for activity.
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
            }
        }

        if self.backfill_active {
            self.touched.clear();
            return None;
        }

        let (enter_ids, exit_ids) = if self.resettle_pending {
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

        if enter_ids.is_empty() && exit_ids.is_empty() {
            return None;
        }
        let provenance = if self.first_fill_done {
            None
        } else {
            self.first_fill_done = true;
            self.provenance.updated_at_ms = self.last_at_ms;
            Some(self.provenance.clone())
        };
        Some(CellDelta::Display {
            enter_ids,
            enter_cells: Vec::new(), // prefix mode has no residents
            exit_ids,
            provenance,
        })
    }

    /// Snapshot section: members in the plane's deterministic order
    /// (ascending id), current provenance, fixed budget. `residents` is
    /// always empty in prefix mode.
    pub(crate) fn section(&self) -> DisplaySection {
        DisplaySection {
            budget: self.budget,
            members: self.members.keys().copied().collect(),
            residents: Vec::new(),
            provenance: self.provenance.clone(),
        }
    }

    // ── internals ────────────────────────────────────────────────────

    /// Advance the insertion-order cursor to fill resting vacancies.
    /// Candidates that left the map are skipped; a candidate already on
    /// stage as activity is PROMOTED in place (membership unchanged, no
    /// wire noise, activity slot freed) — it is, after all, the next
    /// cell in canonical insertion order.
    fn fill_resting_vacancies(&mut self) {
        while self.resting_count < self.resting_target {
            let Some(id) = self.understudies.pop_front() else {
                break;
            };
            if !self.present.contains(&id) {
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

    /// Drop stale queue entries once they dominate. Amortized O(1) per
    /// insertion: right after a compaction the queue is ⊆ present, so it
    /// takes ≥ present + slack fresh pushes to trigger again.
    fn maybe_compact_understudies(&mut self) {
        if self.understudies.len() > self.present.len() * 2 + UNDERSTUDY_COMPACT_SLACK {
            let present = &self.present;
            self.understudies.retain(|id| present.contains(id));
        }
    }

    // ── test accessors ───────────────────────────────────────────────

    #[cfg(test)]
    pub(crate) fn member_ids_sorted(&self) -> Vec<u64> {
        self.members.keys().copied().collect()
    }

    #[cfg(test)]
    pub(crate) fn present_ids_sorted(&self) -> Vec<u64> {
        let mut ids: Vec<u64> = self.present.iter().copied().collect();
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
}

#[cfg(test)]
mod tests {
    use super::*;

    fn small_plane(cells: u32, quota: usize) -> DisplayPlane {
        DisplayPlane::with_limits(
            DisplayBudget {
                cells,
                nerve_edges: 8,
            },
            quota,
        )
    }

    fn delta_parts(delta: Option<CellDelta>) -> (Vec<u64>, Vec<u64>, Option<DisplayProvenance>) {
        match delta {
            Some(CellDelta::Display {
                enter_ids,
                enter_cells,
                exit_ids,
                provenance,
            }) => {
                assert!(enter_cells.is_empty(), "prefix mode has no residents");
                (enter_ids, exit_ids, provenance)
            }
            None => (Vec::new(), Vec::new(), None),
            other => panic!("expected a Display delta, got {other:?}"),
        }
    }

    /// Resting fill takes the first `cells − quota` births in insertion
    /// order; overflow births wait as understudies. The first emitted
    /// delta rides Canonical provenance stamped with the mutation clock.
    #[test]
    fn prefix_fill_stages_first_births_in_insertion_order() {
        let mut plane = small_plane(8, 2); // resting target 6
        for id in 0..9 {
            plane.note_birth(id);
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
        plane.note_birth(9);
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
            plane.note_birth(id);
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
            plane.note_birth(id);
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
        plane.note_birth(0);
        plane.flush(Some(500)); // clients know {0}

        plane.backfill_started();
        for id in 1..8 {
            plane.note_birth(id);
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
        use crate::outpoint::OutPoint;
        let cell = |id: u64, born: u64| Cell {
            id,
            born_at_ms: born,
            death_at_ms: None,
            birth_block: 1,
            tag: None,
            pos_seed: [0.0; 3],
            out_point: OutPoint {
                tx_hash: format!("0x{id}"),
                index: 0,
            },
            capacity: 100,
            data_hex: "0x".into(),
            content_hash: format!("0x{id:064x}"),
            lock_kind: Default::default(),
            asset_kind: Default::default(),
        };
        let mut plane = small_plane(8, 2);
        plane.bootstrap(&[cell(3, 700), cell(9, 900), cell(4, 800)]);
        assert!(plane.flush(None).is_none(), "bootstrap emits no delta");
        let section = plane.section();
        assert_eq!(section.members, vec![3, 4, 9]);
        assert!(section.residents.is_empty());
        assert_eq!(section.provenance.updated_at_ms, 900);
        assert_eq!(section.budget.cells, 8);
    }
}
