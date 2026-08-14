//! Aggregate view statistics over the retained cell set.
//!
//! The HUD's cell panel needs per-lock / per-asset / per-kind breakdowns of
//! the alive retained cells. That used to be derived on the client by walking
//! the whole retained map once per snapshot — which is one of the two reasons
//! the snapshot had to carry every retained row, including the ~95% the
//! renderer never draws. The walk is unchanged; it just runs on the side that
//! already holds the rows.
//!
//! `born` / `live` / `dead` are deliberately NOT here: they ride the snapshot
//! already as `total_births` / `total_deaths`, and a second copy on the wire
//! could only ever disagree with the first.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::taxonomy::{AssetKind, LockKind, ScriptId};

use super::cells::Cell;

/// How many script families the census ranks before it stops. Whole-chain
/// sampling finds ~26 distinct lock scripts and ~25 distinct type scripts, so
/// this holds the real distribution with room to spare; the tail counters
/// below make anything past it visible rather than silently dropped.
const CENSUS_CAP: usize = 24;

/// Per-app breakdown. `Cell.tag` is an opaque string; only these four bucket
/// by name and everything else — including untagged cells — is `generic`.
/// Mirrors the client's `cellKindKey`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CellKindCounts {
    pub wallet: u64,
    pub dex: u64,
    pub cf: u64,
    pub ckbloom: u64,
    pub generic: u64,
}

/// Lock-script-family breakdown. Field names are the serde representation of
/// [`LockKind`], so the wire object is exactly the client's `Record<LockKind,
/// number>`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LockKindCounts {
    pub sighash: u64,
    pub multisig: u64,
    pub acp: u64,
    pub omnilock: u64,
    pub other: u64,
}

/// Asset-class breakdown, same contract as [`LockKindCounts`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssetKindCounts {
    pub native: u64,
    pub sudt: u64,
    pub xudt: u64,
    pub dao: u64,
    pub spore: u64,
    pub other: u64,
}

/// One script's share of the retained set, keyed by identity and by nothing
/// else. Turning an identity into a name is the semantics side's job — this
/// projection reports only what the node said, which is why the census can
/// cover every script family on the chain while `by_lock` above covers four.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScriptCount {
    pub script: ScriptId,
    pub count: u64,
}

/// Which scripts actually guard and type the retained cells, ranked by how
/// many cells each holds and cut at [`CENSUS_CAP`].
///
/// The tail counters exist so a panel can say "and N more" rather than
/// present a truncated head as the whole distribution — the failure this
/// census is here to end.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScriptCensus {
    /// Lock scripts, most cells first.
    pub locks: Vec<ScriptCount>,
    /// Cells whose lock script ranked past the cut.
    pub locks_tail_cells: u64,
    /// Distinct lock scripts in that tail.
    pub locks_tail_scripts: u64,
    /// Type scripts, most cells first. Plain cells appear in neither this list
    /// nor its tail; they are counted by `types_absent`.
    pub types: Vec<ScriptCount>,
    pub types_tail_cells: u64,
    pub types_tail_scripts: u64,
    /// Alive cells carrying no type script at all.
    pub types_absent: u64,
    /// Alive cells whose script identity is unreadable — restored from state
    /// written before identities existed, or a hash the adapter could not
    /// parse. Kept out of the ranked lists so a gap in cknerv's own records
    /// can never be displayed as if it were a script family.
    pub unidentified: u64,
}

/// Everything the cell panel derives from the retained set itself.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CellViewStats {
    /// Alive retained cells — the sampled "in view" set.
    pub in_view: u64,
    /// Alive cells carrying output data past the empty `0x`.
    pub data_bearing: u64,
    /// Summed capacity of the alive cells, in shannons.
    ///
    /// ⚠️ The client holds this as a JS number. Above 2^53 shannons (~90M CKB)
    /// its incremental upkeep and this exact sum drift in the low bits. That
    /// is pre-existing — the client's own full scan summed the same values the
    /// same way — but a seed from here is exact, so the first divergence can
    /// only appear after enough incremental churn.
    pub capacity_shannons: u64,
    pub by_kind: CellKindCounts,
    pub by_lock: LockKindCounts,
    pub by_asset: AssetKindCounts,
    /// The same alive set counted by script identity instead of by the four
    /// lock families and five asset families cknerv pins itself. Empty on a
    /// retained set restored from state written before identities existed.
    #[serde(default)]
    pub scripts: ScriptCensus,
}

impl CellViewStats {
    fn admit(&mut self, cell: &Cell) {
        self.in_view += 1;
        self.capacity_shannons = self.capacity_shannons.saturating_add(cell.capacity);
        // Mirrors the client's `data_hex !== '0x' && data_hex.length > 2`.
        if cell.data_hex != "0x" && cell.data_hex.len() > 2 {
            self.data_bearing += 1;
        }
        match cell.lock_kind {
            LockKind::Sighash => self.by_lock.sighash += 1,
            LockKind::Multisig => self.by_lock.multisig += 1,
            LockKind::Acp => self.by_lock.acp += 1,
            LockKind::Omnilock => self.by_lock.omnilock += 1,
            LockKind::Other => self.by_lock.other += 1,
        }
        match cell.asset_kind {
            AssetKind::Native => self.by_asset.native += 1,
            AssetKind::Sudt => self.by_asset.sudt += 1,
            AssetKind::Xudt => self.by_asset.xudt += 1,
            AssetKind::Dao => self.by_asset.dao += 1,
            AssetKind::Spore => self.by_asset.spore += 1,
            AssetKind::Other => self.by_asset.other += 1,
        }
        match cell.tag.as_deref() {
            Some("wallet") => self.by_kind.wallet += 1,
            Some("dex") => self.by_kind.dex += 1,
            Some("cf") => self.by_kind.cf += 1,
            Some("ckbloom") => self.by_kind.ckbloom += 1,
            _ => self.by_kind.generic += 1,
        }
    }
}

/// Running tallies for the script census. Kept beside [`CellViewStats`]
/// rather than inside it because a census is a map while everything else
/// there is a counter, and the wire wants the map already ranked and cut.
#[derive(Default)]
struct ScriptTally {
    locks: HashMap<ScriptId, u64>,
    types: HashMap<ScriptId, u64>,
    types_absent: u64,
    unidentified: u64,
}

impl ScriptTally {
    fn admit(&mut self, cell: &Cell) {
        if cell.lock_script.is_unset() {
            self.unidentified += 1;
        } else {
            *self.locks.entry(cell.lock_script).or_default() += 1;
        }
        match cell.type_script {
            Some(script) if !script.is_unset() => *self.types.entry(script).or_default() += 1,
            Some(_) => self.unidentified += 1,
            None => self.types_absent += 1,
        }
    }

    fn finish(self) -> ScriptCensus {
        let (locks, locks_tail_cells, locks_tail_scripts) = rank_and_cut(self.locks);
        let (types, types_tail_cells, types_tail_scripts) = rank_and_cut(self.types);
        ScriptCensus {
            locks,
            locks_tail_cells,
            locks_tail_scripts,
            types,
            types_tail_cells,
            types_tail_scripts,
            types_absent: self.types_absent,
            unidentified: self.unidentified,
        }
    }
}

/// Rank one tally by cell count and cut it at [`CENSUS_CAP`], returning what
/// the cut dropped. Ties break on the code hash so the same retained set
/// always produces the same list — a census that reshuffled between snapshots
/// would make the panel's bars flicker for no chain reason.
fn rank_and_cut(tally: HashMap<ScriptId, u64>) -> (Vec<ScriptCount>, u64, u64) {
    let mut ranked: Vec<ScriptCount> = tally
        .into_iter()
        .map(|(script, count)| ScriptCount { script, count })
        .collect();
    ranked.sort_unstable_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| a.script.code_hash.cmp(&b.script.code_hash))
    });
    let tail_scripts = ranked.len().saturating_sub(CENSUS_CAP);
    let tail_cells: u64 = ranked.iter().skip(CENSUS_CAP).map(|entry| entry.count).sum();
    ranked.truncate(CENSUS_CAP);
    (ranked, tail_cells, tail_scripts as u64)
}

/// Aggregate one retained set. Dead cells contribute nothing — the same skip
/// the client's reference scan makes, so a cell inside its death-animation
/// tail is retained and drawn but counted by neither side.
pub fn aggregate_cell_view_stats(cells: &[Cell]) -> CellViewStats {
    let mut stats = CellViewStats::default();
    let mut tally = ScriptTally::default();
    for cell in cells {
        if cell.death_at_ms.is_some() {
            continue;
        }
        stats.admit(cell);
        tally.admit(cell);
    }
    stats.scripts = tally.finish();
    stats
}

/// The census alone, for the block-cadence delta that keeps the panel's bars
/// tracking the chain between snapshots. One pass over the retained set with
/// two small maps; at the 50,000-cell cap that is a low-single-digit
/// millisecond scan, which is why it runs per block and never per
/// transaction.
pub fn aggregate_script_census(cells: &[Cell]) -> ScriptCensus {
    let mut tally = ScriptTally::default();
    for cell in cells {
        if cell.death_at_ms.is_none() {
            tally.admit(cell);
        }
    }
    tally.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::outpoint::OutPoint;
    use crate::HashType;

    fn cell(id: u64, tag: Option<&str>) -> Cell {
        Cell {
            id,
            born_at_ms: 0,
            death_at_ms: None,
            birth_block: 1,
            tag: tag.map(str::to_string),
            pos_seed: [0.0, 0.0, 0.0],
            out_point: OutPoint {
                tx_hash: format!("0x{id}"),
                index: 0,
            },
            capacity: 100,
            data_hex: "0x".to_string(),
            content_hash: format!("0x{id}"),
            lock_kind: LockKind::Other,
            asset_kind: AssetKind::Other,
            lock_script: Default::default(),
            type_script: None,
        }
    }

    #[test]
    fn empty_set_aggregates_to_zero() {
        assert_eq!(aggregate_cell_view_stats(&[]), CellViewStats::default());
    }

    #[test]
    fn dead_cells_contribute_nothing() {
        let mut dead = cell(1, Some("wallet"));
        dead.death_at_ms = Some(5);
        let stats = aggregate_cell_view_stats(&[dead, cell(2, Some("dex"))]);
        assert_eq!(stats.in_view, 1);
        assert_eq!(stats.capacity_shannons, 100);
        assert_eq!(stats.by_kind.wallet, 0);
        assert_eq!(stats.by_kind.dex, 1);
    }

    #[test]
    fn only_the_four_known_tags_leave_the_generic_bucket() {
        let cells = vec![
            cell(1, Some("wallet")),
            cell(2, Some("dex")),
            cell(3, Some("cf")),
            cell(4, Some("ckbloom")),
            cell(5, Some("something-else")),
            cell(6, None),
        ];
        let stats = aggregate_cell_view_stats(&cells);
        assert_eq!(
            stats.by_kind,
            CellKindCounts {
                wallet: 1,
                dex: 1,
                cf: 1,
                ckbloom: 1,
                generic: 2,
            }
        );
    }

    #[test]
    fn empty_data_is_not_data_bearing() {
        let mut bare = cell(1, None);
        bare.data_hex = "0x".to_string();
        let mut carrying = cell(2, None);
        carrying.data_hex = "0xab".to_string();
        let stats = aggregate_cell_view_stats(&[bare, carrying]);
        assert_eq!(stats.data_bearing, 1);
    }

    #[test]
    fn taxonomy_buckets_land_in_their_own_fields() {
        let mut a = cell(1, None);
        a.lock_kind = LockKind::Sighash;
        a.asset_kind = AssetKind::Dao;
        let mut b = cell(2, None);
        b.lock_kind = LockKind::Omnilock;
        b.asset_kind = AssetKind::Native;
        let stats = aggregate_cell_view_stats(&[a, b]);
        assert_eq!(stats.by_lock.sighash, 1);
        assert_eq!(stats.by_lock.omnilock, 1);
        assert_eq!(stats.by_lock.other, 0);
        assert_eq!(stats.by_asset.dao, 1);
        assert_eq!(stats.by_asset.native, 1);
    }

    fn script(byte: u8, hash_type: HashType) -> ScriptId {
        ScriptId {
            code_hash: [byte; 32],
            hash_type,
        }
    }

    fn scripted(id: u64, lock: ScriptId, type_script: Option<ScriptId>) -> Cell {
        let mut c = cell(id, None);
        c.lock_script = lock;
        c.type_script = type_script;
        c
    }

    #[test]
    fn census_counts_scripts_cknerv_cannot_classify() {
        // Every one of these is `LockKind::Other` / `AssetKind::Other` — the
        // classification that used to be the whole answer. The census tells
        // them apart anyway, which is the entire point of carrying identity.
        let joyid = script(0xaa, HashType::Type);
        let bit_lock = script(0xbb, HashType::Type);
        let bit_income = script(0xcc, HashType::Data1);
        let census = aggregate_script_census(&[
            scripted(1, joyid, Some(bit_income)),
            scripted(2, joyid, None),
            scripted(3, joyid, Some(bit_income)),
            scripted(4, bit_lock, None),
        ]);

        // Ranked by cells held, not by order of appearance.
        assert_eq!(
            census.locks,
            vec![
                ScriptCount {
                    script: joyid,
                    count: 3
                },
                ScriptCount {
                    script: bit_lock,
                    count: 1
                },
            ]
        );
        assert_eq!(
            census.types,
            vec![ScriptCount {
                script: bit_income,
                count: 2
            }]
        );
        // Plain cells are counted, not silently dropped from the total.
        assert_eq!(census.types_absent, 2);
        assert_eq!(census.unidentified, 0);
        assert_eq!(census.locks_tail_cells, 0);
        assert_eq!(census.locks_tail_scripts, 0);
    }

    #[test]
    fn census_keeps_unreadable_identities_out_of_the_families() {
        // A cell restored from pre-identity state: cknerv does not know what
        // guards it. Counting it as a family would invent one.
        let dead = {
            let mut c = scripted(2, script(0xaa, HashType::Type), None);
            c.death_at_ms = Some(1);
            c
        };
        let census = aggregate_script_census(&[cell(1, None), dead]);
        assert_eq!(census.unidentified, 1);
        assert!(census.locks.is_empty());
        // The dead cell contributes nothing at all, identity or not.
        assert_eq!(census.types_absent, 1);
    }

    #[test]
    fn census_cut_reports_the_tail_it_dropped() {
        // 27 families, holding 27 cells down to 1. Byte 0 is skipped: an
        // all-zero code hash is the unset id, not a family.
        let families = CENSUS_CAP + 3;
        let mut cells = Vec::new();
        for family in 1..=families {
            let lock = script(family as u8, HashType::Type);
            for copy in 0..(families + 1 - family) {
                cells.push(scripted((family * 1000 + copy) as u64, lock, None));
            }
        }
        let census = aggregate_script_census(&cells);
        assert_eq!(census.locks.len(), CENSUS_CAP);
        assert_eq!(census.locks_tail_scripts, 3);
        // The three cut families held 3, 2 and 1 cells.
        assert_eq!(census.locks_tail_cells, 6);
        // Ranked head is strictly descending, so the cut kept the biggest.
        assert!(census.locks.windows(2).all(|w| w[0].count >= w[1].count));
    }

    #[test]
    fn serializes_with_the_field_names_the_client_indexes_by() {
        let stats = aggregate_cell_view_stats(&[cell(1, Some("wallet"))]);
        let json = serde_json::to_value(stats).unwrap();
        assert_eq!(json["in_view"], 1);
        assert_eq!(json["data_bearing"], 0);
        assert_eq!(json["capacity_shannons"], 100);
        assert_eq!(json["by_kind"]["wallet"], 1);
        assert_eq!(json["by_kind"]["generic"], 0);
        assert_eq!(json["by_lock"]["other"], 1);
        assert_eq!(json["by_asset"]["other"], 1);
    }
}
