//! Composition policy — "who SHOULD be on stage" for the cell galaxy.
//!
//! The [`DisplayPlane`](super::display_plane::DisplayPlane) owns the
//! *mechanism* of staging: the member set, resident payloads, the budget,
//! the activity FIFO, the coalesced delta, and the synchronous reaction to
//! canonical births/removals/GC/reorg. It deliberately knows nothing about
//! *why* a given cell deserves a slot.
//!
//! Everything that answers "why" lives here: the composition classes, the
//! 30:40:30 quota, admission ordering and dedupe, the displacement
//! ratchet, and the refill queues. The dividing line, stated as a rule:
//!
//! > **"who is on stage, and what they look like" belongs to the stage;
//! > "who *should* be" belongs to the policy.**
//!
//! Two implementations:
//!
//! * [`CanonicalPolicy`] — prefix mode. Insertion order, class-blind: the
//!   first `budget − quota` live-or-corpse cells rest, the remainder wait
//!   in an insertion-order understudy queue.
//! * [`CuratedPolicy`] — composed mode. A validated
//!   [`GalaxyCompositionRecord`] staffs the stage by class at
//!   [`GalaxyCompositionTarget`] ratios, with canonical fallback,
//!   round-robin spill, in-class activity substitution, and per-class
//!   refill queues.
//!
//! ## Synchronous by construction
//!
//! The stage must be self-consistent within a *single* mutation — a
//! snapshot taken right after it and the delta emitted by it have to
//! agree. So every policy answer is synchronous: `fill_vacancies` and
//! `admit_activity` stage their picks through the `&mut Stage` handed to
//! them and return with the stage settled. A policy that needs candidates
//! it does not have yet must degrade gracefully (stage fewer members)
//! rather than promise a member it will produce later.
//!
//! ## Determinism
//!
//! Policy state that reaches the wire is ordered: `resting_priority` is a
//! `BTreeMap` keyed by [`PriorityKey`], the refill queues are `VecDeque`s
//! seeded in admission order, and the class walk is the fixed
//! [`CLASS_ORDER`]. The `HashMap`s here (`class_of_member`, `priority_of`,
//! `bench`) are keyed-lookup only — they are never iterated.

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

use crate::enrichment::{GalaxyCompositionRecord, GalaxyCompositionTarget};
use crate::outpoint::OutPoint;
use crate::taxonomy::AssetKind;

use super::cells::Cell;
use super::display_plane::{MemberRole, Stage};

/// How many stale understudy entries we tolerate before compacting the
/// prefix queue against the stage's presence mirror. `2·present + slack`
/// keeps the compaction amortized O(1) per insertion.
const UNDERSTUDY_COMPACT_SLACK: usize = 1_024;

/// The old client's early-stop guard: below this budget the canonical
/// fallback walk admits the whole map instead of stopping at satisfied
/// quotas (`cellRenderSet.ts` `requestedCount >= 10`).
const COMPOSED_EARLY_STOP_MIN_BUDGET: usize = 10;

/// Composition class of a cell — the old client's `compositionBucket`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CompositionClass {
    Dao = 0,
    Typed = 1,
    Plain = 2,
}

/// The spill / borrow preference order. Every wire-visible class walk goes
/// through it.
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

/// The staffing decisions a [`DisplayPlane`](super::display_plane::DisplayPlane)
/// delegates. Implementors never touch membership directly — they act
/// through the `&mut Stage` they are handed, which keeps the coalescing
/// log, the counters and the wire ordering in one place.
pub(crate) trait CompositionPolicy {
    /// The reservoir this policy staffed from, if any. Read by the plane
    /// for the refresh content-dedupe and the reorg degrade predicate.
    fn reservoir(&self) -> Option<&GalaxyCompositionRecord> {
        None
    }

    /// A cell entered the canonical map: remember it as a future
    /// candidate. (The plane has already mirrored it into the stage, so
    /// `stage.kind_of(id)` resolves.)
    fn note_candidate(&mut self, stage: &Stage, id: u64);

    /// A member left the stage — canonical removal or activity-quota
    /// eviction. The stage bookkeeping is already settled; this settles
    /// the policy's, and may re-stage a member it had benched.
    fn note_exit(&mut self, stage: &mut Stage, id: u64, role: MemberRole);

    /// A resident candidate was superseded by a canonical birth of the
    /// same outpoint (invariant I4 — one outpoint is never staged under
    /// two ids). `replacement` is `Some(canonical id)` when the resident
    /// held a slot the canonical cell just took over in place, `None`
    /// when the superseded candidate was merely pooled.
    fn note_superseded(&mut self, stage: &Stage, resident_id: u64, replacement: Option<u64>);

    /// Fill resting vacancies. Called at every flush; must leave the
    /// stage settled.
    fn fill_vacancies(&mut self, stage: &mut Stage);

    /// An off-stage, canonical-present tx endpoint asks for a slot. The
    /// policy decides whether it enters and, if the stage is full, who
    /// gives way.
    fn admit_activity(&mut self, stage: &mut Stage, block: u64, id: u64);

    /// Staged members per class — a test seam for the composition
    /// invariants (I1's ratio).
    #[cfg(test)]
    fn class_counts(&self) -> [usize; 3] {
        [0; 3]
    }
}

// ══ canonical / prefix mode ═════════════════════════════════════════════

/// Prefix staffing: canonical insertion order, no classes, no ratios.
/// Births beyond a full resting set wait in an insertion-order understudy
/// queue and are staged only when a vacancy opens (amortized cursor; the
/// cursor never moves backward).
pub(crate) struct CanonicalPolicy {
    /// budget.cells − activity_quota — prefix mode's resting pool size.
    resting_target: usize,
    /// Insertion-order backfill candidates. May contain stale ids
    /// (skipped at pop) and rebirth duplicates (skipped when they surface
    /// already-resting).
    understudies: VecDeque<u64>,
}

impl CanonicalPolicy {
    pub(crate) fn new(budget_cells: usize, activity_quota: usize) -> Self {
        Self {
            resting_target: budget_cells.saturating_sub(activity_quota),
            understudies: VecDeque::new(),
        }
    }

    /// Degrade rebuild: prefix membership recomputed from the canonical
    /// container (first `resting_target` live-or-corpse cells in insertion
    /// order, remainder understudies), standing activity members
    /// re-admitted beyond the prefix. All changes flow through the stage's
    /// touched log so the flush emits one coalesced diff.
    pub(crate) fn rebuild(&mut self, stage: &mut Stage, cells: &[Cell]) {
        let standing_activity = stage.standing_activity();
        stage.exit_all_members();
        self.understudies.clear();

        for cell in cells.iter().take(self.resting_target) {
            stage.stage_resting(cell.id);
        }
        for cell in cells.iter().skip(self.resting_target) {
            self.understudies.push_back(cell.id);
        }
        for (block, id) in standing_activity {
            if stage.is_member(id) || !stage.is_present(id) {
                continue;
            }
            stage.stage_activity(block, id);
        }
    }

    /// Drop stale queue entries once they dominate. Amortized O(1) per
    /// insertion: right after a compaction the queue is ⊆ present, so it
    /// takes ≥ present + slack fresh pushes to trigger again.
    fn maybe_compact(&mut self, stage: &Stage) {
        if self.understudies.len() > stage.present_count() * 2 + UNDERSTUDY_COMPACT_SLACK {
            self.understudies.retain(|id| stage.is_present(*id));
        }
    }
}

impl CompositionPolicy for CanonicalPolicy {
    fn note_candidate(&mut self, stage: &Stage, id: u64) {
        self.understudies.push_back(id);
        self.maybe_compact(stage);
    }

    fn note_exit(&mut self, _stage: &mut Stage, _id: u64, _role: MemberRole) {
        // Prefix mode keeps no per-member bookkeeping: the vacancy is
        // simply refilled from the cursor at the next flush.
    }

    fn note_superseded(&mut self, _stage: &Stage, _resident_id: u64, _replacement: Option<u64>) {
        // Unreachable: prefix mode never stages residents.
    }

    /// Advance the insertion-order cursor to fill resting vacancies.
    /// Candidates that left the map are skipped; a candidate already on
    /// stage as activity is PROMOTED in place (membership unchanged, no
    /// wire noise, activity slot freed) — it is, after all, the next cell
    /// in canonical insertion order.
    fn fill_vacancies(&mut self, stage: &mut Stage) {
        while stage.resting_count() < self.resting_target {
            let Some(id) = self.understudies.pop_front() else {
                break;
            };
            if !stage.is_present(id) {
                continue; // removed while waiting in the queue
            }
            match stage.role_of(id) {
                Some(MemberRole::Activity { .. }) => stage.promote_to_resting(id),
                Some(MemberRole::Resting) => {
                    // Duplicate queue entry from a removal+rebirth cycle.
                }
                None => stage.stage_resting(id),
            }
        }
    }

    fn admit_activity(&mut self, stage: &mut Stage, block: u64, id: u64) {
        stage.stage_activity(block, id);
    }
}

// ══ curated / composed mode ═════════════════════════════════════════════

/// The membership a [`CuratedPolicy::compose`] decided on, handed to the
/// stage to install. Ids only plus payloads — the classes and ranks stay
/// behind in the policy.
pub(crate) struct CompositionFill {
    /// Chosen members in admission order, with a hydrated payload for
    /// every admit that is NOT in the canonical map (a *resident*).
    pub(crate) members: Vec<(u64, Option<Cell>)>,
    /// Unchosen resident candidates, parked off stage for later vacancies.
    pub(crate) pool: Vec<(u64, Cell)>,
}

/// Composed staffing: classes, quotas, ranks, refill queues.
pub(crate) struct CuratedPolicy {
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
}

impl CuratedPolicy {
    /// Port of the old client's `composedCellRenderList`
    /// (`packages/ui/src/geometry/cellRenderSet.ts`), membership-set
    /// semantics only (the client's interleave ORDER is deliberately
    /// dropped; slot assignment ignores order).
    ///
    /// * **Classes**: `asset_kind` dao → Dao, native → Plain, everything
    ///   else → Typed. Quotas come from the shared
    ///   [`GalaxyCompositionTarget::for_total`] (30:40:30 bps) over the
    ///   FULL cell budget.
    /// * **Fill**: each class fills from its reservoir bucket first
    ///   (record rank order), with D5 outpoint dedupe at admission — an
    ///   outpoint retained canonically resolves to the canonical id/cell;
    ///   only genuinely off-map outpoints stage as *residents*. Then one
    ///   canonical fallback walk in insertion order admits cells into
    ///   their own classes until every quota is satisfied (whole-map walk
    ///   when the budget is below the old client's ≥10 early-stop guard).
    ///   Final per-class targets are computed on `min(budget, admitted)`;
    ///   classes that run dry spill round-robin dao → typed → plain (one
    ///   candidate per class per round — the old client's exact spill
    ///   loop).
    ///
    /// `outpoint_index`/`cells` are the canonical resolver at the call
    /// boundary: the map's outpoint → id index and the insertion-order
    /// container.
    pub(crate) fn compose(
        record: &GalaxyCompositionRecord,
        outpoint_index: &HashMap<OutPoint, u64>,
        cells: &[Cell],
        budget: usize,
    ) -> (Self, CompositionFill) {
        let by_id: HashMap<u64, &Cell> = cells.iter().map(|c| (c.id, c)).collect();

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

        // 4. Rank the chosen prefixes and seed the refill queues from the
        //    unchosen tails.
        let mut policy = Self {
            reservoir: record.clone(),
            class_targets: chosen,
            class_counts: [0; 3],
            class_of_member: HashMap::new(),
            resting_priority: [BTreeMap::new(), BTreeMap::new(), BTreeMap::new()],
            priority_of: HashMap::new(),
            next_seq: 0,
            class_queues: [VecDeque::new(), VecDeque::new(), VecDeque::new()],
            bench: HashMap::new(),
        };
        let mut fill = CompositionFill {
            members: Vec::with_capacity(chosen.iter().sum()),
            pool: Vec::new(),
        };
        for c in 0..3 {
            for (i, admit) in buckets[c].iter().take(chosen[c]).enumerate() {
                let group = if i < reservoir_len[c] {
                    RESERVOIR_GROUP
                } else {
                    FALLBACK_GROUP
                };
                let key: PriorityKey = (group, policy.next_seq);
                policy.next_seq += 1;
                policy.class_of_member.insert(admit.id, admit.class);
                policy.class_counts[c] += 1;
                policy.resting_priority[c].insert(key, admit.id);
                policy.priority_of.insert(admit.id, key);
                fill.members.push((admit.id, admit.resident.cloned()));
            }
            // Unchosen admission tail seeds the class refill queue, in
            // admission order; unchosen residents park in the pool.
            for admit in buckets[c].iter().skip(chosen[c]) {
                policy.class_queues[c].push_back(admit.id);
                if let Some(payload) = admit.resident {
                    fill.pool.push((admit.id, payload.clone()));
                }
            }
        }
        // Never-admitted canonical cells queue after the admission tails,
        // in insertion order (the fallback walk would have reached them
        // next).
        for cell in cells {
            if !admitted_ids.contains(&cell.id) {
                policy.class_queues[class_of(cell.asset_kind) as usize].push_back(cell.id);
            }
        }

        (policy, fill)
    }

    fn queue(&mut self, class: CompositionClass) -> &mut VecDeque<u64> {
        &mut self.class_queues[class as usize]
    }

    /// Record a member as resting under `class` with a fresh
    /// fallback-group rank (the lowest priority — displaced first).
    fn rank_fallback(&mut self, id: u64, class: CompositionClass) {
        let key: PriorityKey = (FALLBACK_GROUP, self.next_seq);
        self.next_seq += 1;
        self.resting_priority[class as usize].insert(key, id);
        self.priority_of.insert(id, key);
    }

    /// Stage one member from `class`'s refill queue, popping until one
    /// lands (skipping stale entries; promoting an entry already staged as
    /// activity in place, which frees quota without filling the count).
    /// Returns whether a member was staged.
    fn pop_stage_one(&mut self, stage: &mut Stage, class: CompositionClass) -> bool {
        while let Some(id) = self.queue(class).pop_front() {
            match stage.role_of(id) {
                Some(MemberRole::Activity { .. }) => {
                    // Promote in place (no wire noise, quota slot freed);
                    // the count deficit stands, keep popping.
                    stage.promote_to_resting(id);
                    let member_class = *self
                        .class_of_member
                        .get(&id)
                        .expect("staged member has a class");
                    self.rank_fallback(id, member_class);
                    if let Some(chained) = self.bench.remove(&id) {
                        self.class_queues[member_class as usize].push_front(chained.id);
                    }
                    continue;
                }
                Some(MemberRole::Resting) => continue, // stale duplicate
                None => {}
            }
            // Stage under the candidate's CURRENT class — rebirth cycles
            // keep content, but never trust a stale queue lane over the
            // live facts.
            let Some(class_now) = stage.kind_of(id).map(class_of) else {
                continue; // stale: GC'd canonical id or a superseded resident
            };
            stage.stage_resting(id);
            self.class_of_member.insert(id, class_now);
            self.class_counts[class_now as usize] += 1;
            self.rank_fallback(id, class_now);
            return true;
        }
        false
    }
}

impl CompositionPolicy for CuratedPolicy {
    fn reservoir(&self) -> Option<&GalaxyCompositionRecord> {
        Some(&self.reservoir)
    }

    fn note_candidate(&mut self, stage: &Stage, id: u64) {
        let class = stage.kind_of(id).map(class_of).expect("candidate is known");
        self.queue(class).push_back(id);
    }

    fn note_exit(&mut self, stage: &mut Stage, id: u64, role: MemberRole) {
        let class = self
            .class_of_member
            .remove(&id)
            .expect("staged member has a class");
        self.class_counts[class as usize] -= 1;
        match role {
            MemberRole::Resting => {
                if let Some(key) = self.priority_of.remove(&id) {
                    self.resting_priority[class as usize].remove(&key);
                }
                // The class vacancy refills at the next flush.
            }
            MemberRole::Activity { .. } => self.restore_bench(stage, id, class),
        }
    }

    fn note_superseded(&mut self, stage: &Stage, resident_id: u64, replacement: Option<u64>) {
        let Some(class) = self.class_of_member.remove(&resident_id) else {
            // A pooled candidate: its queue entry goes stale and is
            // skipped at pop.
            return;
        };
        self.class_counts[class as usize] -= 1;
        let key = self
            .priority_of
            .remove(&resident_id)
            .expect("staged resident is always a resting member");
        self.resting_priority[class as usize].remove(&key);
        let Some(id) = replacement else {
            return;
        };
        // The canonical cell takes over the resident's slot (same class —
        // same outpoint means same content) so one outpoint is never
        // staged twice.
        let class = stage
            .kind_of(id)
            .map(class_of)
            .expect("replacement is known");
        self.class_of_member.insert(id, class);
        self.class_counts[class as usize] += 1;
        self.resting_priority[class as usize].insert(key, id);
        self.priority_of.insert(id, key);
    }

    /// Refill: first restore each class toward its frozen refresh target,
    /// then top the stage up to `min(budget, available)` borrowing across
    /// classes in the spill preference order (dao → typed → plain,
    /// round-robin) so the member COUNT holds even when the ratio can't
    /// (invariant I1's "when candidates suffice" proviso).
    fn fill_vacancies(&mut self, stage: &mut Stage) {
        let dynamic_target = stage.dynamic_target();
        for class in CLASS_ORDER {
            while self.class_counts[class as usize] < self.class_targets[class as usize]
                && stage.member_count() < dynamic_target
            {
                if !self.pop_stage_one(stage, class) {
                    break;
                }
            }
        }
        'top_up: while stage.member_count() < dynamic_target {
            let mut progressed = false;
            for class in CLASS_ORDER {
                if stage.member_count() >= dynamic_target {
                    break 'top_up;
                }
                if self.pop_stage_one(stage, class) {
                    progressed = true;
                }
            }
            if !progressed {
                break;
            }
        }
    }

    /// In-class substitution per `docs/ckbadger.md`: an off-stage endpoint
    /// enters by displacing the lowest-priority same-class RESTING member.
    /// While the stage is below `min(budget, available)` it enters WITHOUT
    /// displacing (mirrors the old client, where activity always fit
    /// whenever available ≤ budget); with the stage full and no same-class
    /// resting member to displace, the entry is skipped.
    fn admit_activity(&mut self, stage: &mut Stage, block: u64, id: u64) {
        let class = stage
            .kind_of(id)
            .map(class_of)
            .expect("caller verified canonical presence");
        let dynamic_target = stage.dynamic_target();
        let enter = if stage.member_count() < dynamic_target {
            true
        } else if let Some((&key, &victim)) =
            self.resting_priority[class as usize].iter().next_back()
        {
            // Displace the lowest-priority same-class resting member:
            // fallback admits before reservoir admits, latest-admitted
            // first within a group.
            self.resting_priority[class as usize].remove(&key);
            self.priority_of.remove(&victim);
            self.class_of_member.remove(&victim);
            self.class_counts[class as usize] -= 1;
            // A displaced resident keeps its payload off stage so a later
            // restore can re-ship it.
            stage.unstage(victim);
            self.bench.insert(id, BenchEntry { id: victim, key });
            true
        } else {
            // Stage full and the class has no resting member to displace
            // (all-activity class) — skip the entry, deterministic.
            false
        };
        if enter {
            stage.stage_activity(block, id);
            self.class_of_member.insert(id, class);
            self.class_counts[class as usize] += 1;
        }
    }

    #[cfg(test)]
    fn class_counts(&self) -> [usize; 3] {
        self.class_counts
    }
}

impl CuratedPolicy {
    /// An activity member left the stage (quota eviction or canonical
    /// removal): restore the resting member it displaced, when possible.
    /// The membership bookkeeping for the leaver itself is the stage's
    /// job; this settles the bench.
    fn restore_bench(&mut self, stage: &mut Stage, id: u64, class: CompositionClass) {
        let Some(bench) = self.bench.remove(&id) else {
            return;
        };
        let b = bench.id;
        match stage.role_of(b) {
            Some(MemberRole::Activity { .. }) => {
                // The benched member re-entered on its own as an endpoint:
                // promote it back to its resting slot (quota slot freed,
                // no wire noise). Its own bench (if any) dissolves — that
                // candidate becomes the class's top refill candidate
                // instead.
                stage.promote_to_resting(b);
                self.resting_priority[class as usize].insert(bench.key, b);
                self.priority_of.insert(b, bench.key);
                if let Some(chained) = self.bench.remove(&b) {
                    self.class_queues[class as usize].push_front(chained.id);
                }
            }
            Some(MemberRole::Resting) => {
                // Already resting again through another path — the vacancy
                // stands and the refill queues cover it.
            }
            None => {
                if !stage.is_stageable(b) {
                    // The benched member is gone (GC'd / superseded) — the
                    // vacancy refills from the class queues at flush.
                    return;
                }
                // Ordinary restore at the original slot priority; a
                // resident's payload re-ships via enter_cells.
                stage.stage_resting(b);
                self.class_of_member.insert(b, class);
                self.class_counts[class as usize] += 1;
                self.resting_priority[class as usize].insert(bench.key, b);
                self.priority_of.insert(b, bench.key);
            }
        }
    }
}
