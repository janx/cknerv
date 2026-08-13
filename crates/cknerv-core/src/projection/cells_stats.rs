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

use serde::{Deserialize, Serialize};

use crate::taxonomy::{AssetKind, LockKind};

use super::cells::Cell;

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

/// Everything the cell panel derives from the retained set itself.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
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

/// Aggregate one retained set. Dead cells contribute nothing — the same skip
/// the client's reference scan makes, so a cell inside its death-animation
/// tail is retained and drawn but counted by neither side.
pub fn aggregate_cell_view_stats(cells: &[Cell]) -> CellViewStats {
    let mut stats = CellViewStats::default();
    for cell in cells {
        if cell.death_at_ms.is_some() {
            continue;
        }
        stats.admit(cell);
    }
    stats
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::outpoint::OutPoint;

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
