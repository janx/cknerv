//! Columnar (binary) form of the cell-galaxy snapshot — P2 of the render
//! rescale plan. One contiguous little-endian buffer: a fixed 48-byte header,
//! then per-field columns grouped by element width (f64, f32, u32, u8) so
//! every column is naturally aligned for zero-copy typed-array views on the
//! client, then a tiny tag dictionary at the tail.
//!
//! v2 carries everything the JSON snapshot's `cells` + `display` sections
//! do. Rows are the canonical cells followed by the staged resident
//! payloads — one column set, split at `n_cells` — plus the staged member
//! ids, the budgets and the provenance.
//!
//! Strings (`tx_hash`, `content_hash`, `data_hex`) ride as ASCII in ONE
//! blob with per-field `u32` offset tables. They are not packed as binary
//! hashes, which would be half the bytes: measured in V8, re-hexing 100k
//! 32-byte values costs 68ms of main thread even with a lookup table,
//! while decoding one blob and slicing it by offset costs 4.7ms. The wire
//! is not the scarce resource here — the client's main thread is.
//!
//! Precision note: `born_at_ms`, `death_at_ms`, and `capacity` are u64 in
//! Rust but ship as f64 columns. This is wire-EQUIVALENT to the existing
//! JSON path — `JSON.parse` already lands those fields in f64 — so the
//! columnar form introduces no new loss.
//!
//! The 8 bytes at [8..16] are a revision slot the SERVER patches in (the
//! registry owns revisions; the projection does not know its own).

use crate::projection::cells::{BackfillState, Cell, CellLinkRecord, DisplayBudget, DisplayMode};
use crate::projection::cells_stats::CellViewStats;
use crate::projection::display_plane::ColumnarDisplayView;
use crate::taxonomy::{AssetKind, LockKind};

pub const CELLS_COLUMNAR_MAGIC: [u8; 4] = *b"CKNB";
pub const CELLS_COLUMNAR_VERSION: u16 = 2;
pub const CELLS_COLUMNAR_HEADER_BYTES: usize = 72;
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

/// Scalars the header carries beside the columns. Grouped so three
/// same-typed counters cannot silently swap places at a call site.
#[derive(Clone, Copy, Debug)]
pub struct CellsColumnarHeader {
    pub last_pulse_at_ms: u64,
    pub total_births: u64,
    pub total_deaths: u64,
}

/// `display_mode` byte. Distinguishes "no display plane at all" (a server
/// that predates it, or a projection that has none) from a plane that is
/// present and canonical — the client's fallback branches on exactly that.
pub const CELLS_COLUMNAR_DISPLAY_ABSENT: u8 = 0;
pub const CELLS_COLUMNAR_DISPLAY_CANONICAL: u8 = 1;
pub const CELLS_COLUMNAR_DISPLAY_COMPOSED: u8 = 2;

/// The parts of the snapshot that are not rows. Tx links nest three id
/// arrays and a list of endpoint anchors per record, so columnarizing them
/// would cost more in offset tables than it saves; at ~2k records they
/// parse in single-digit milliseconds as JSON. The bulk is columnar
/// because it is 60k uniform rows — the tail is JSON because it is not.
pub struct CellsColumnarTail<'a> {
    pub recent_links: &'a [CellLinkRecord],
    pub backfill: Option<BackfillState>,
    /// Aggregate view statistics over the FULL retained set — deliberately
    /// independent of which rows this buffer carries.
    pub stats: CellViewStats,
}

/// The three ASCII string columns, laid out FIELD-major in one region:
/// every `tx_hash`, then every `content_hash`, then every `data_hex`.
///
/// Field-major is what makes the client's slice cheap. Offsets are
/// absolute into the region and each field carries an N+1 sentinel, so a
/// value is exactly `region[off[i]..off[i + 1]]` — with row-major
/// interleaving that subtraction would span two other fields.
#[derive(Default)]
struct StringTables {
    tx_hash: Vec<u8>,
    content_hash: Vec<u8>,
    data_hex: Vec<u8>,
    tx_hash_offsets: Vec<u32>,
    content_hash_offsets: Vec<u32>,
    data_hex_offsets: Vec<u32>,
}

impl StringTables {
    fn with_capacity(rows: usize) -> Self {
        Self {
            tx_hash: Vec::with_capacity(rows * 66),
            content_hash: Vec::with_capacity(rows * 66),
            data_hex: Vec::with_capacity(rows * 4),
            tx_hash_offsets: Vec::with_capacity(rows + 1),
            content_hash_offsets: Vec::with_capacity(rows + 1),
            data_hex_offsets: Vec::with_capacity(rows + 1),
        }
    }

    /// Offsets are BYTE offsets used by the client as CHAR offsets after
    /// one `TextDecoder` pass. That holds only while every value is ASCII,
    /// which these three are (hex text) — asserted rather than assumed,
    /// because one non-ASCII byte would silently shift every later slice.
    fn push(&mut self, cell: &Cell) {
        for (blob, offsets, value) in [
            (
                &mut self.tx_hash,
                &mut self.tx_hash_offsets,
                cell.out_point.tx_hash.as_str(),
            ),
            (
                &mut self.content_hash,
                &mut self.content_hash_offsets,
                cell.content_hash.as_str(),
            ),
            (
                &mut self.data_hex,
                &mut self.data_hex_offsets,
                cell.data_hex.as_str(),
            ),
        ] {
            assert!(
                value.is_ascii(),
                "columnar string offsets are byte offsets used as char offsets"
            );
            offsets.push(blob.len() as u32);
            blob.extend_from_slice(value.as_bytes());
        }
    }

    /// Rebase each field's offsets onto the concatenated region and close
    /// them with the sentinel that makes the last value sliceable.
    fn finish(mut self) -> Self {
        let tx_len = self.tx_hash.len() as u32;
        let content_len = self.content_hash.len() as u32;
        self.tx_hash_offsets.push(tx_len);
        for offset in &mut self.content_hash_offsets {
            *offset += tx_len;
        }
        self.content_hash_offsets.push(tx_len + content_len);
        for offset in &mut self.data_hex_offsets {
            *offset += tx_len + content_len;
        }
        self.data_hex_offsets
            .push(tx_len + content_len + self.data_hex.len() as u32);
        self
    }

    fn region_len(&self) -> usize {
        self.tx_hash.len() + self.content_hash.len() + self.data_hex.len()
    }
}

/// Encode the galaxy as one columnar buffer.
///
/// Rows are `cells` followed by `display.residents`, one column set split
/// at `n_cells`, so a client rebuilds the canonical map and the staged
/// resident payloads from the same columns. Row `i < n_cells` describes
/// the same cell as `snapshot.cells[i]` on the JSON path — the parity gate
/// compares them field by field.
///
/// Takes borrows rather than a `CellGalaxySnapshot`: going through one
/// would clone every `Cell`, every resident payload and every recent link
/// just to read them once.
pub fn encode_cells_columnar(
    cells: &[Cell],
    header: CellsColumnarHeader,
    display: Option<&ColumnarDisplayView<'_>>,
    tail: CellsColumnarTail<'_>,
) -> Vec<u8> {
    let residents: &[&Cell] = display.map_or(&[], |view| view.residents.as_slice());
    let members: &[u64] = display.map_or(&[], |view| view.members.as_slice());
    let n_cells = cells.len();
    let n = n_cells + residents.len();
    let rows = || cells.iter().chain(residents.iter().copied());

    // Tag dictionary: distinct tags in first-seen order (low cardinality),
    // resolved in one pass so the column write below is a plain lookup.
    let mut tags: Vec<&str> = Vec::new();
    let mut tag_indices: Vec<u8> = Vec::with_capacity(n);
    let mut strings = StringTables::with_capacity(n);
    for cell in rows() {
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
        strings.push(cell);
    }
    let strings = strings.finish();

    let fixed = n * (4 * 8 + 3 * 4 + 2 * 4 + 4) + members.len() * 8 + 3 * (n + 1) * 4;
    let mut buf =
        Vec::with_capacity(CELLS_COLUMNAR_HEADER_BYTES + fixed + strings.region_len() + 128);

    let (mode, budget, provenance) = match display {
        Some(view) => (
            match view.provenance.mode {
                DisplayMode::Canonical => CELLS_COLUMNAR_DISPLAY_CANONICAL,
                DisplayMode::Composed => CELLS_COLUMNAR_DISPLAY_COMPOSED,
            },
            view.budget,
            Some(view.provenance),
        ),
        None => (
            CELLS_COLUMNAR_DISPLAY_ABSENT,
            DisplayBudget {
                cells: 0,
                nerve_edges: 0,
            },
            None,
        ),
    };

    // —— header ——
    buf.extend_from_slice(&CELLS_COLUMNAR_MAGIC);
    buf.extend_from_slice(&CELLS_COLUMNAR_VERSION.to_le_bytes());
    buf.extend_from_slice(&0u16.to_le_bytes()); // flags
    buf.extend_from_slice(&0u64.to_le_bytes()); // revision slot (server-patched)
    buf.extend_from_slice(&header.last_pulse_at_ms.to_le_bytes());
    buf.extend_from_slice(&header.total_births.to_le_bytes());
    buf.extend_from_slice(&header.total_deaths.to_le_bytes());
    buf.extend_from_slice(&(n_cells as u32).to_le_bytes());
    buf.extend_from_slice(&(residents.len() as u32).to_le_bytes());
    buf.extend_from_slice(&(members.len() as u32).to_le_bytes());
    buf.extend_from_slice(&budget.cells.to_le_bytes());
    buf.extend_from_slice(&budget.nerve_edges.to_le_bytes());
    buf.push(mode);
    buf.extend_from_slice(&[0u8; 3]); // reserved
    buf.extend_from_slice(&0u32.to_le_bytes()); // tail_offset, back-patched
    buf.extend_from_slice(&0u32.to_le_bytes()); // reserved
    debug_assert_eq!(buf.len(), CELLS_COLUMNAR_HEADER_BYTES);

    // —— f64 columns —— (row block first, then the member id list, so the
    // whole 8-byte group stays naturally aligned for typed-array views)
    for cell in rows() {
        buf.extend_from_slice(&(cell.id as f64).to_le_bytes());
    }
    for cell in rows() {
        buf.extend_from_slice(&(cell.born_at_ms as f64).to_le_bytes());
    }
    for cell in rows() {
        let death = cell.death_at_ms.map_or(f64::NAN, |ms| ms as f64);
        buf.extend_from_slice(&death.to_le_bytes());
    }
    for cell in rows() {
        buf.extend_from_slice(&(cell.capacity as f64).to_le_bytes());
    }
    for id in members {
        buf.extend_from_slice(&(*id as f64).to_le_bytes());
    }
    // —— f32 columns ——
    for axis in 0..3 {
        for cell in rows() {
            buf.extend_from_slice(&cell.pos_seed[axis].to_le_bytes());
        }
    }
    // —— u32 columns ——
    for cell in rows() {
        buf.extend_from_slice(&(cell.birth_block as u32).to_le_bytes());
    }
    for cell in rows() {
        buf.extend_from_slice(&cell.out_point.index.to_le_bytes());
    }
    for offsets in [
        &strings.tx_hash_offsets,
        &strings.content_hash_offsets,
        &strings.data_hex_offsets,
    ] {
        for offset in offsets {
            buf.extend_from_slice(&offset.to_le_bytes());
        }
    }
    // —— u8 columns ——
    for cell in rows() {
        buf.push(lock_kind_code(cell.lock_kind));
    }
    for cell in rows() {
        buf.push(asset_kind_code(cell.asset_kind));
    }
    buf.extend_from_slice(&tag_indices);
    for cell in rows() {
        buf.push(u8::from(cell.data_hex.len() > 2));
    }

    // —— string region (field-major: tx hashes, content hashes, data) ——
    buf.extend_from_slice(&strings.tx_hash);
    buf.extend_from_slice(&strings.content_hash);
    buf.extend_from_slice(&strings.data_hex);

    // —— tail: tag dictionary + provenance ——
    let tail_offset = buf.len() as u32;
    buf[64..68].copy_from_slice(&tail_offset.to_le_bytes());
    buf.push(tags.len() as u8);
    for tag in tags {
        push_short_string(&mut buf, tag);
    }
    match provenance {
        Some(provenance) => {
            buf.extend_from_slice(&provenance.updated_at_ms.to_le_bytes());
            buf.extend_from_slice(
                &provenance
                    .as_of
                    .as_ref()
                    .map_or(0, |at| at.block)
                    .to_le_bytes(),
            );
            push_short_string(&mut buf, provenance.source.as_deref().unwrap_or(""));
            push_short_string(
                &mut buf,
                provenance.as_of.as_ref().map_or("", |at| at.hash.as_str()),
            );
        }
        None => {
            buf.extend_from_slice(&0u64.to_le_bytes());
            buf.extend_from_slice(&0u64.to_le_bytes());
            push_short_string(&mut buf, "");
            push_short_string(&mut buf, "");
        }
    }

    // —— non-row sections, as JSON ——
    let sections = serde_json::json!({
        "recent_links": tail.recent_links,
        "backfill": tail.backfill,
        "stats": tail.stats,
    });
    let sections = serde_json::to_vec(&sections).unwrap_or_else(|_| b"{}".to_vec());
    buf.extend_from_slice(&(sections.len() as u32).to_le_bytes());
    buf.extend_from_slice(&sections);
    buf
}

/// A `u8`-length-prefixed string. Every user here is a tag, a source name
/// or a block hash — all far inside 255 bytes, and an overrun would
/// silently truncate, so it panics instead.
fn push_short_string(buf: &mut Vec<u8>, value: &str) {
    let bytes = value.as_bytes();
    assert!(
        bytes.len() <= u8::MAX as usize,
        "string too long for the tail"
    );
    buf.push(bytes.len() as u8);
    buf.extend_from_slice(bytes);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::helix::helix_seed_for;
    use crate::outpoint::OutPoint;
    use crate::projection::cells::Cell;
    use crate::projection::display_plane::ColumnarDisplayView;

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
            pos_seed: helix_seed_for(id),
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

    fn empty_tail() -> CellsColumnarTail<'static> {
        CellsColumnarTail {
            recent_links: &[],
            backfill: None,
            stats: CellViewStats::default(),
        }
    }

    fn header() -> CellsColumnarHeader {
        CellsColumnarHeader {
            last_pulse_at_ms: 777,
            total_births: 30,
            total_deaths: 11,
        }
    }

    /// Column starts for `n` rows and `m` members, mirroring the layout the
    /// TS decoder computes. Keeping the arithmetic in one place is what
    /// makes an accidental reshuffle fail loudly here first.
    struct Offsets {
        id: usize,
        death: usize,
        members: usize,
        pos: usize,
        tx_offsets: usize,
        lock: usize,
        strings: usize,
    }

    fn offsets(n: usize, m: usize) -> Offsets {
        let id = CELLS_COLUMNAR_HEADER_BYTES;
        let members = id + 4 * 8 * n;
        let pos = members + 8 * m;
        let u32s = pos + 3 * 4 * n;
        let tx_offsets = u32s + 2 * 4 * n;
        let lock = tx_offsets + 3 * (n + 1) * 4;
        Offsets {
            id,
            death: id + 2 * 8 * n,
            members,
            pos,
            tx_offsets,
            lock,
            strings: lock + 4 * n,
        }
    }

    fn u32_at(buf: &[u8], at: usize) -> u32 {
        u32::from_le_bytes(buf[at..at + 4].try_into().unwrap())
    }

    #[test]
    fn header_columns_and_dictionary_round_trip() {
        let rows = [
            cell(1, Some("wallet")),
            cell(2, None),
            cell(3, Some("dex")),
            cell(4, Some("wallet")),
        ];
        let buf = encode_cells_columnar(&rows, header(), None, empty_tail());
        assert_eq!(&buf[0..4], b"CKNB");
        assert_eq!(u16::from_le_bytes([buf[4], buf[5]]), CELLS_COLUMNAR_VERSION);
        assert_eq!(u64::from_le_bytes(buf[16..24].try_into().unwrap()), 777);
        assert_eq!(u64::from_le_bytes(buf[24..32].try_into().unwrap()), 30);
        assert_eq!(u64::from_le_bytes(buf[32..40].try_into().unwrap()), 11);
        let n = u32_at(&buf, 40) as usize;
        assert_eq!(n, 4);
        assert_eq!(u32_at(&buf, 44), 0, "no residents without a display plane");
        assert_eq!(u32_at(&buf, 48), 0, "no members either");
        assert_eq!(buf[60], CELLS_COLUMNAR_DISPLAY_ABSENT);

        let at = offsets(n, 0);
        assert_eq!(
            f64::from_le_bytes(buf[at.id..at.id + 8].try_into().unwrap()),
            1.0
        );
        let death0 = f64::from_le_bytes(buf[at.death..at.death + 8].try_into().unwrap());
        assert_eq!(death0, 2_001.0); // id 1 is odd → dead at 2000+1
        let death1 = f64::from_le_bytes(buf[at.death + 8..at.death + 16].try_into().unwrap());
        assert!(death1.is_nan()); // id 2 alive

        // tag dictionary: first-seen order [wallet, dex]; indices 0,FF,1,0.
        let tail = u32_at(&buf, 64) as usize;
        assert_eq!(buf[tail], 2);
        assert_eq!(&buf[tail + 2..tail + 8], b"wallet");
        let tag_col = at.lock + 2 * n;
        assert_eq!(buf[tag_col], 0);
        assert_eq!(buf[tag_col + 1], CELLS_COLUMNAR_NO_TAG);
        assert_eq!(buf[tag_col + 2], 1);
        assert_eq!(buf[tag_col + 3], 0);

        // data flags: id 1 (0xdeadbeef) → 1, id 3 (0x) → 0.
        let data_col = tag_col + n;
        assert_eq!(buf[data_col], 1);
        assert_eq!(buf[data_col + 2], 0);
    }

    /// Strings are field-major with absolute offsets and an N+1 sentinel,
    /// so `region[off[i]..off[i + 1]]` is exactly one value — the property
    /// the client's single-decode-then-slice depends on.
    #[test]
    fn string_columns_slice_by_offset() {
        let rows = [cell(1, None), cell(2, Some("wallet")), cell(3, None)];
        let buf = encode_cells_columnar(&rows, header(), None, empty_tail());
        let n = rows.len();
        let at = offsets(n, 0);
        // Offsets are REGION-relative: the client decodes the region once
        // and slices it, so it never has to know where in the buffer it sat.
        let region = std::str::from_utf8(&buf[at.strings..u32_at(&buf, 64) as usize]).unwrap();

        for (field, want) in [
            (
                0usize,
                rows.iter()
                    .map(|c| c.out_point.tx_hash.clone())
                    .collect::<Vec<_>>(),
            ),
            (1, rows.iter().map(|c| c.content_hash.clone()).collect()),
            (2, rows.iter().map(|c| c.data_hex.clone()).collect()),
        ] {
            let table = at.tx_offsets + field * (n + 1) * 4;
            for (row, expected) in want.iter().enumerate() {
                let from = u32_at(&buf, table + row * 4);
                let to = u32_at(&buf, table + (row + 1) * 4);
                assert_eq!(&region[from as usize..to as usize], expected);
            }
        }
    }

    /// Residents ride as rows after the canonical ones, members as their own
    /// id list — one column set, split at `n_cells`.
    #[test]
    fn the_display_plane_rides_as_rows_members_and_provenance() {
        use crate::enrichment::ChainAnchor;
        use crate::projection::cells::{DisplayBudget, DisplayMode, DisplayProvenance};

        let rows = [cell(1, None), cell(2, None)];
        let resident = cell(9, None);
        let provenance = DisplayProvenance {
            mode: DisplayMode::Composed,
            source: Some("ckbadger".into()),
            as_of: Some(ChainAnchor {
                block: 4_242,
                hash: "0xanchor".into(),
            }),
            updated_at_ms: 1_234,
        };
        let view = ColumnarDisplayView {
            budget: DisplayBudget {
                cells: 12_000,
                nerve_edges: 8_000,
            },
            provenance: &provenance,
            members: vec![1, 9],
            residents: vec![&resident],
        };
        let buf = encode_cells_columnar(&rows, header(), Some(&view), empty_tail());

        assert_eq!(u32_at(&buf, 40), 2, "canonical rows");
        assert_eq!(u32_at(&buf, 44), 1, "resident rows");
        assert_eq!(u32_at(&buf, 48), 2, "members");
        assert_eq!(u32_at(&buf, 52), 12_000);
        assert_eq!(u32_at(&buf, 56), 8_000);
        assert_eq!(buf[60], CELLS_COLUMNAR_DISPLAY_COMPOSED);

        let n = 3;
        let at = offsets(n, 2);
        let row_id = |row: usize| {
            f64::from_le_bytes(
                buf[at.id + row * 8..at.id + row * 8 + 8]
                    .try_into()
                    .unwrap(),
            )
        };
        assert_eq!([row_id(0), row_id(1), row_id(2)], [1.0, 2.0, 9.0]);
        let member = |i: usize| {
            f64::from_le_bytes(
                buf[at.members + i * 8..at.members + i * 8 + 8]
                    .try_into()
                    .unwrap(),
            )
        };
        assert_eq!([member(0), member(1)], [1.0, 9.0]);

        let mut tail = u32_at(&buf, 64) as usize;
        tail += 1 + buf[tail] as usize; // empty tag dictionary
        assert_eq!(
            u64::from_le_bytes(buf[tail..tail + 8].try_into().unwrap()),
            1_234
        );
        assert_eq!(
            u64::from_le_bytes(buf[tail + 8..tail + 16].try_into().unwrap()),
            4_242
        );
        let source_len = buf[tail + 16] as usize;
        assert_eq!(&buf[tail + 17..tail + 17 + source_len], b"ckbadger");
        let anchor = tail + 17 + source_len;
        let anchor_len = buf[anchor] as usize;
        assert_eq!(&buf[anchor + 1..anchor + 1 + anchor_len], b"0xanchor");

        // Row 2 is a resident, and its position column is the derived one.
        assert_eq!(
            f32::from_le_bytes(buf[at.pos + 2 * 4..at.pos + 2 * 4 + 4].try_into().unwrap()),
            resident.pos_seed[0]
        );
    }

    /// The cross-language gate. Rust writes this buffer, the TS decoder
    /// reads the very same bytes (`packages/cache/__tests__`), so a layout
    /// change that only lands on one side fails on both. Regenerate with
    /// `CKNERV_REGEN_FIXTURES=1 cargo test -p cknerv-core columnar_v2`.
    #[test]
    fn columnar_v2_matches_the_shared_fixture() {
        use crate::enrichment::ChainAnchor;
        use crate::projection::cells::{DisplayBudget, DisplayMode, DisplayProvenance};

        let rows = [cell(1, Some("wallet")), cell(2, None), cell(3, Some("dex"))];
        let resident = cell(9, Some("wallet"));
        let provenance = DisplayProvenance {
            mode: DisplayMode::Composed,
            source: Some("ckbadger".into()),
            as_of: Some(ChainAnchor {
                block: 4_242,
                hash: format!("0x{:064x}", 0xabcu64),
            }),
            updated_at_ms: 1_700_000_000_123,
        };
        let view = ColumnarDisplayView {
            budget: DisplayBudget {
                cells: 12_000,
                nerve_edges: 8_000,
            },
            provenance: &provenance,
            members: vec![1, 3, 9],
            residents: vec![&resident],
        };
        let encoded = encode_cells_columnar(&rows, header(), Some(&view), empty_tail());

        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/cells_columnar_v2.bin"
        );
        if std::env::var("CKNERV_REGEN_FIXTURES").is_ok() {
            std::fs::write(path, &encoded).expect("write fixture");
        }
        let fixture = std::fs::read(path).expect("read fixture");
        assert_eq!(
            encoded, fixture,
            "columnar layout drifted from the shared fixture; regenerate it \
             and update the TS decoder in the same change"
        );
    }

    #[test]
    fn empty_snapshot_is_header_plus_empty_tail() {
        let buf = encode_cells_columnar(&[], header(), None, empty_tail());
        let tail = u32_at(&buf, 64) as usize;
        assert_eq!(tail, CELLS_COLUMNAR_HEADER_BYTES + 3 * 4);
        assert_eq!(buf[tail], 0, "empty tag dictionary");
    }
}
