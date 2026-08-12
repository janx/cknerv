//! Columnar (binary) form of the cell-galaxy snapshot — P2 of the render
//! rescale plan. One contiguous little-endian buffer: a fixed 48-byte header,
//! then per-field columns grouped by element width (f64, f32, u32, u8) so
//! every column is naturally aligned for zero-copy typed-array views on the
//! client, then a tiny tag dictionary at the tail.
//!
//! v1 deliberately carries only the numeric/enum fields the renderer's hot
//! path consumes. Variable-length strings (`tx_hash`, `content_hash`,
//! `data_hex`) stay on the JSON/detail path; `data_flag` preserves the one
//! bit of `data_hex` the aggregate statistics need.
//!
//! Precision note: `born_at_ms`, `death_at_ms`, and `capacity` are u64 in
//! Rust but ship as f64 columns. This is wire-EQUIVALENT to the existing
//! JSON path — `JSON.parse` already lands those fields in f64 — so the
//! columnar form introduces no new loss.
//!
//! The 8 bytes at [8..16] are a revision slot the SERVER patches in (the
//! registry owns revisions; the projection does not know its own).

use crate::projection::cells::CellGalaxySnapshot;
use crate::taxonomy::{AssetKind, LockKind};

pub const CELLS_COLUMNAR_MAGIC: [u8; 4] = *b"CKNB";
pub const CELLS_COLUMNAR_VERSION: u16 = 1;
pub const CELLS_COLUMNAR_HEADER_BYTES: usize = 48;
pub const CELLS_COLUMNAR_REVISION_OFFSET: usize = 8;
/// tag_index value meaning "no tag".
pub const CELLS_COLUMNAR_NO_TAG: u8 = 0xFF;

fn lock_kind_code(kind: LockKind) -> u8 {
    match kind {
        LockKind::Sighash => 0,
        LockKind::Multisig => 1,
        LockKind::Acp => 2,
        LockKind::Omnilock => 3,
        LockKind::Other => 4,
    }
}

fn asset_kind_code(kind: AssetKind) -> u8 {
    match kind {
        AssetKind::Native => 0,
        AssetKind::Sudt => 1,
        AssetKind::Xudt => 2,
        AssetKind::Dao => 3,
        AssetKind::Spore => 4,
        AssetKind::Other => 5,
    }
}

/// Encode the snapshot's cells as one columnar buffer. Row order is the
/// snapshot's `cells` order, so row `i` of every column describes the same
/// cell as `snapshot.cells[i]` on the JSON path — the live parity gate
/// compares them field by field.
pub fn encode_cells_columnar(snapshot: &CellGalaxySnapshot) -> Vec<u8> {
    let n = snapshot.cells.len();

    // Tag dictionary: distinct tags in first-seen order (low cardinality),
    // resolved in one pass so the column write below is a plain lookup.
    let mut tags: Vec<&str> = Vec::new();
    let mut tag_indices: Vec<u8> = Vec::with_capacity(n);
    for cell in &snapshot.cells {
        let index = match cell.tag.as_deref() {
            None => CELLS_COLUMNAR_NO_TAG,
            Some(tag) => match tags.iter().position(|t| *t == tag) {
                Some(found) => found as u8,
                None => {
                    assert!(
                        tags.len() < CELLS_COLUMNAR_NO_TAG as usize,
                        "tag dictionary overflow"
                    );
                    tags.push(tag);
                    (tags.len() - 1) as u8
                }
            },
        };
        tag_indices.push(index);
    }

    let columns_bytes = n * (4 * 8 + 3 * 4 + 2 * 4 + 4);
    let mut buf = Vec::with_capacity(CELLS_COLUMNAR_HEADER_BYTES + columns_bytes + 64);

    // —— header ——
    buf.extend_from_slice(&CELLS_COLUMNAR_MAGIC);
    buf.extend_from_slice(&CELLS_COLUMNAR_VERSION.to_le_bytes());
    buf.extend_from_slice(&0u16.to_le_bytes()); // flags
    buf.extend_from_slice(&0u64.to_le_bytes()); // revision slot (server-patched)
    buf.extend_from_slice(&snapshot.last_pulse_at_ms.to_le_bytes());
    buf.extend_from_slice(&snapshot.total_births.to_le_bytes());
    buf.extend_from_slice(&snapshot.total_deaths.to_le_bytes());
    buf.extend_from_slice(&(n as u32).to_le_bytes());
    buf.extend_from_slice(&0u32.to_le_bytes()); // tag_dict_offset back-patched
    debug_assert_eq!(buf.len(), CELLS_COLUMNAR_HEADER_BYTES);

    // —— f64 columns ——
    for cell in &snapshot.cells {
        buf.extend_from_slice(&(cell.id as f64).to_le_bytes());
    }
    for cell in &snapshot.cells {
        buf.extend_from_slice(&(cell.born_at_ms as f64).to_le_bytes());
    }
    for cell in &snapshot.cells {
        let death = cell.death_at_ms.map_or(f64::NAN, |ms| ms as f64);
        buf.extend_from_slice(&death.to_le_bytes());
    }
    for cell in &snapshot.cells {
        buf.extend_from_slice(&(cell.capacity as f64).to_le_bytes());
    }
    // —— f32 columns ——
    for axis in 0..3 {
        for cell in &snapshot.cells {
            buf.extend_from_slice(&cell.pos_seed[axis].to_le_bytes());
        }
    }
    // —— u32 columns ——
    for cell in &snapshot.cells {
        buf.extend_from_slice(&(cell.birth_block as u32).to_le_bytes());
    }
    for cell in &snapshot.cells {
        buf.extend_from_slice(&cell.out_point.index.to_le_bytes());
    }
    // —— u8 columns ——
    for cell in &snapshot.cells {
        buf.push(lock_kind_code(cell.lock_kind));
    }
    for cell in &snapshot.cells {
        buf.push(asset_kind_code(cell.asset_kind));
    }
    buf.extend_from_slice(&tag_indices);
    for cell in &snapshot.cells {
        let has_data = cell.data_hex.len() > 2;
        buf.push(u8::from(has_data));
    }

    // —— tag dictionary tail ——
    let tag_dict_offset = buf.len() as u32;
    buf[44..48].copy_from_slice(&tag_dict_offset.to_le_bytes());
    buf.push(tags.len() as u8);
    for tag in tags {
        let bytes = tag.as_bytes();
        assert!(
            bytes.len() <= u8::MAX as usize,
            "tag too long for dictionary"
        );
        buf.push(bytes.len() as u8);
        buf.extend_from_slice(bytes);
    }
    buf
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::outpoint::OutPoint;
    use crate::projection::cells::Cell;

    fn cell(id: u64, tag: Option<&str>) -> Cell {
        Cell {
            id,
            born_at_ms: 1_000 + id,
            death_at_ms: if id.is_multiple_of(2) {
                None
            } else {
                Some(2_000 + id)
            },
            birth_block: 42 + id,
            tag: tag.map(str::to_owned),
            pos_seed: [id as f32, -1.5, 0.25 * id as f32],
            out_point: OutPoint {
                tx_hash: format!("0x{id:064x}"),
                index: id as u32,
            },
            capacity: 61_00000000 + id,
            data_hex: if id.is_multiple_of(3) {
                "0x".into()
            } else {
                "0xdeadbeef".into()
            },
            content_hash: format!("0x{:064x}", id * 7),
            lock_kind: if id.is_multiple_of(2) {
                LockKind::Sighash
            } else {
                LockKind::Omnilock
            },
            asset_kind: if id.is_multiple_of(2) {
                AssetKind::Native
            } else {
                AssetKind::Dao
            },
        }
    }

    fn snapshot(cells: Vec<Cell>) -> CellGalaxySnapshot {
        CellGalaxySnapshot {
            cells,
            last_pulse_at_ms: 777,
            recent_links: Vec::new(),
            total_births: 30,
            total_deaths: 11,
            backfill: None,
            display: None,
        }
    }

    #[test]
    fn header_columns_and_dictionary_round_trip() {
        let snap = snapshot(vec![
            cell(1, Some("wallet")),
            cell(2, None),
            cell(3, Some("dex")),
            cell(4, Some("wallet")),
        ]);
        let buf = encode_cells_columnar(&snap);
        assert_eq!(&buf[0..4], b"CKNB");
        assert_eq!(u16::from_le_bytes([buf[4], buf[5]]), CELLS_COLUMNAR_VERSION);
        assert_eq!(u64::from_le_bytes(buf[16..24].try_into().unwrap()), 777);
        assert_eq!(u64::from_le_bytes(buf[24..32].try_into().unwrap()), 30);
        assert_eq!(u64::from_le_bytes(buf[32..40].try_into().unwrap()), 11);
        let n = u32::from_le_bytes(buf[40..44].try_into().unwrap()) as usize;
        assert_eq!(n, 4);

        // id column at 48; death column NaN for alive rows.
        let id0 = f64::from_le_bytes(buf[48..56].try_into().unwrap());
        assert_eq!(id0, 1.0);
        let death_base = 48 + 2 * 8 * n;
        let death0 = f64::from_le_bytes(buf[death_base..death_base + 8].try_into().unwrap());
        assert_eq!(death0, 2_001.0); // id 1 is odd → dead at 2000+1
        let death1 = f64::from_le_bytes(buf[death_base + 8..death_base + 16].try_into().unwrap());
        assert!(death1.is_nan()); // id 2 alive

        // tag dictionary: first-seen order [wallet, dex]; indices 0,FF,1,0.
        let dict_offset = u32::from_le_bytes(buf[44..48].try_into().unwrap()) as usize;
        assert_eq!(buf[dict_offset], 2);
        assert_eq!(&buf[dict_offset + 2..dict_offset + 8], b"wallet");
        let tag_col = 48 + 4 * 8 * n + 3 * 4 * n + 2 * 4 * n + 2 * n;
        assert_eq!(buf[tag_col], 0);
        assert_eq!(buf[tag_col + 1], CELLS_COLUMNAR_NO_TAG);
        assert_eq!(buf[tag_col + 2], 1);
        assert_eq!(buf[tag_col + 3], 0);

        // data flags: id 1 (0xdeadbeef) → 1, id 3 (0x) → 0.
        let data_col = tag_col + n;
        assert_eq!(buf[data_col], 1);
        assert_eq!(buf[data_col + 2], 0);
    }

    #[test]
    fn empty_snapshot_is_header_plus_empty_dictionary() {
        let buf = encode_cells_columnar(&snapshot(Vec::new()));
        assert_eq!(buf.len(), CELLS_COLUMNAR_HEADER_BYTES + 1);
        assert_eq!(buf[CELLS_COLUMNAR_HEADER_BYTES], 0);
    }
}
