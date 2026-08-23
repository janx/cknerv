//! Columnar (binary) form of the cell-galaxy snapshot — P2 of the render
//! rescale plan. One contiguous little-endian buffer: a fixed header of
//! [`CELLS_COLUMNAR_HEADER_BYTES`], then per-field columns grouped by element
//! width (f64, f32, u32, u16, u8) so every column is naturally aligned for
//! zero-copy typed-array views on the client, then the dictionaries at the
//! tail.
//!
//! v5 carries everything the JSON snapshot's `cells` + `display` sections
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
//! Script identity (`lock_script` / `type_script`) is the one field pair that
//! is NOT per-row text: mainnet runs ~29 distinct `(code_hash, hash_type)`
//! pairs across the whole galaxy, so the pairs ride once in a tail dictionary
//! and each row carries two `u16` refs into it (4 bytes a row against 134 for
//! two inline hex hashes). A cell without the field spells that as ref 0,
//! which is what the JSON path's `skip_serializing_if` spells as an absent
//! key.
//!
//! Precision note: `born_at_ms`, `death_at_ms`, and `capacity` are u64 in
//! Rust but ship as f64 columns. This is wire-EQUIVALENT to the existing
//! JSON path — `JSON.parse` already lands those fields in f64 — so the
//! columnar form introduces no new loss.
//!
//! The 8 bytes at [`CELLS_COLUMNAR_REVISION_OFFSET`] are a revision slot the
//! SERVER patches in (the registry owns revisions; the projection does not
//! know its own). Both sides of the boundary read that constant, never the
//! number — a header reshuffle has to move them together.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::projection::cells::{BackfillState, Cell, CellLinkRecord, DisplayBudget, DisplayMode};
use crate::projection::cells_stats::CellViewStats;
use crate::projection::display_plane::ColumnarDisplayView;
use crate::taxonomy::{AssetKind, HashType, LockKind, ScriptId};

pub const CELLS_COLUMNAR_MAGIC: [u8; 4] = *b"CKNB";
/// Bumped whenever a column's meaning changes, including a widened enum code
/// table: a decoder that does not know code 6 must not guess. The client
/// treats a version it cannot read as "fall back to the JSON snapshot", so a
/// bump costs an old tab one slower boot, never a wrong galaxy.
///
/// 5: `asset_kind` gained codes 6 (`object`) and 7 (`identity`).
pub const CELLS_COLUMNAR_VERSION: u16 = 5;
pub const CELLS_COLUMNAR_HEADER_BYTES: usize = 72;
pub const CELLS_COLUMNAR_REVISION_OFFSET: usize = 8;
/// tag_index value meaning "no tag".
pub const CELLS_COLUMNAR_NO_TAG: u8 = 0xFF;
/// Script-ref value meaning "this cell carries no such script"; every other
/// ref is `dictionary index + 1`. Zero rather than a sentinel max so a
/// zeroed column reads as absent, which is what pre-identity rows are.
pub const CELLS_COLUMNAR_NO_SCRIPT: u16 = 0;
/// Refs are u16, so the dictionary tops out one short of the sentinel space.
/// Unreachable in practice — the dictionary holds at most two entries per
/// staged row and the stage is budgeted at 12k — but the encoder degrades
/// instead of panicking, because it runs inside the reducer's write lock.
const SCRIPT_DICTIONARY_LIMIT: usize = u16::MAX as usize - 1;

fn lock_kind_code(kind: LockKind) -> u8 {
    match kind {
        LockKind::Sighash => 0,
        LockKind::Multisig => 1,
        LockKind::Acp => 2,
        LockKind::Omnilock => 3,
        LockKind::Other => 4,
    }
}

/// Codes are the enum's declaration order, and the TS `COLUMNAR_ASSET_KINDS`
/// table holds the same names at the same indices. Exhaustive on purpose: a
/// new variant must fail to compile here rather than silently share a code.
fn asset_kind_code(kind: AssetKind) -> u8 {
    match kind {
        AssetKind::Native => 0,
        AssetKind::Sudt => 1,
        AssetKind::Xudt => 2,
        AssetKind::Dao => 3,
        AssetKind::Spore => 4,
        AssetKind::Other => 5,
        AssetKind::Object => 6,
        AssetKind::Identity => 7,
    }
}

fn hash_type_code(hash_type: HashType) -> u8 {
    match hash_type {
        HashType::Data => 0,
        HashType::Type => 1,
        HashType::Data1 => 2,
        HashType::Data2 => 3,
    }
}

/// Distinct `(code_hash, hash_type)` pairs in first-seen row order, with the
/// refs the rows carry. First-seen order (not sorted) keeps the encode one
/// pass, and the client only ever indexes it.
#[derive(Default)]
struct ScriptDictionary {
    entries: Vec<ScriptId>,
    index: HashMap<ScriptId, u16>,
}

impl ScriptDictionary {
    /// Ref for `script`, interning it on first sight. Absence is the caller's
    /// call — the JSON path spells it two different ways (an unset lock id, a
    /// `None` type script) and both arrive here as `None`.
    fn intern(&mut self, script: Option<ScriptId>) -> u16 {
        let Some(script) = script else {
            return CELLS_COLUMNAR_NO_SCRIPT;
        };
        if let Some(&found) = self.index.get(&script) {
            return found;
        }
        if self.entries.len() >= SCRIPT_DICTIONARY_LIMIT {
            report_script_dictionary_overflow();
            return CELLS_COLUMNAR_NO_SCRIPT;
        }
        self.entries.push(script);
        let reference = self.entries.len() as u16;
        self.index.insert(script, reference);
        reference
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
    /// which these three are: hex text plus
    /// [`crate::DATA_HEX_TRUNCATION_MARKER`], single-byte for this reason.
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
            offsets.push(blob.len() as u32);
            if !push_ascii_lossy(blob, value) {
                report_non_ascii_column(value);
            }
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

/// One warning per process: a non-ASCII value means a producer changed, not
/// that this snapshot is special, and every connected client re-encodes.
static NON_ASCII_WARNED: AtomicBool = AtomicBool::new(false);

/// Append `value`, replacing each non-ASCII BYTE with `?`. Returns whether
/// the value was already clean. Replacing per byte rather than per char is
/// what keeps the blob byte-length-identical, so the value reads wrong but
/// every later slice still reads right.
fn push_ascii_lossy(blob: &mut Vec<u8>, value: &str) -> bool {
    if value.is_ascii() {
        blob.extend_from_slice(value.as_bytes());
        return true;
    }
    blob.extend(value.bytes().map(|b| if b.is_ascii() { b } else { b'?' }));
    false
}

/// A non-ASCII column value is a producer bug — loud where it can still be
/// fixed, survivable where it cannot. This runs inside the reducer's write
/// lock on the path every binary snapshot takes, so a release build warns
/// and ships sanitized bytes instead of poisoning the lock for the process.
fn report_non_ascii_column(value: &str) {
    debug_assert!(false, "columnar string column is not ASCII: {value:?}");
    if !NON_ASCII_WARNED.swap(true, Ordering::Relaxed) {
        tracing::warn!(
            target: "cknerv-core",
            value = %value.escape_debug(),
            "columnar string column carried non-ASCII; sanitized it byte-wise \
             so the snapshot stays decodable"
        );
    }
}

static SCRIPT_OVERFLOW_WARNED: AtomicBool = AtomicBool::new(false);

/// Same discipline as the non-ASCII path: a full dictionary means the stage
/// budget grew past what a u16 ref can address, which is a layout decision to
/// revisit, not a reason to poison the reducer's lock. The rows past the limit
/// report their script as absent — the census in the tail still counts them.
fn report_script_dictionary_overflow() {
    debug_assert!(false, "columnar script dictionary overflowed u16 refs");
    if !SCRIPT_OVERFLOW_WARNED.swap(true, Ordering::Relaxed) {
        tracing::warn!(
            target: "cknerv-core",
            limit = SCRIPT_DICTIONARY_LIMIT,
            "columnar script dictionary is full; later rows ship without \
             script identity"
        );
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

    // Tag and script dictionaries: distinct values in first-seen order (low
    // cardinality both), resolved in one pass so the column writes below are
    // plain lookups.
    let mut tags: Vec<&str> = Vec::new();
    let mut tag_indices: Vec<u8> = Vec::with_capacity(n);
    let mut scripts = ScriptDictionary::default();
    let mut lock_refs: Vec<u16> = Vec::with_capacity(n);
    let mut type_refs: Vec<u16> = Vec::with_capacity(n);
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
        // An unset lock id is the JSON path's absent key, so it must not
        // reach the dictionary; a `Some` type script does even when unset,
        // because that is what the JSON path emits.
        lock_refs.push(scripts.intern((!cell.lock_script.is_unset()).then_some(cell.lock_script)));
        type_refs.push(scripts.intern(cell.type_script));
        strings.push(cell);
    }
    let strings = strings.finish();

    let fixed = n * (4 * 8 + 3 * 4 + 9 * 4 + 2 * 2 + 4) + members.len() * 8 + 3 * (n + 1) * 4;
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
    for cell in rows() {
        buf.extend_from_slice(&cell.data_bytes.to_le_bytes());
    }
    for word in 0..2 {
        for cell in rows() {
            buf.extend_from_slice(&cell.lock_shape_seed[word].to_le_bytes());
        }
    }
    // The type-script ref below is the absence authority. Zero words keep the
    // numeric columns dense for a plain cell without inventing a type seed.
    for word in 0..2 {
        for cell in rows() {
            buf.extend_from_slice(
                &cell
                    .type_shape_seed
                    .map_or(0, |seed| seed[word])
                    .to_le_bytes(),
            );
        }
    }
    for word in 0..2 {
        for cell in rows() {
            buf.extend_from_slice(&cell.data_shape_seed[word].to_le_bytes());
        }
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
    // —— u16 columns —— (script dictionary refs; the u32 group above ends
    // 4-byte aligned, so these views land aligned on the client too)
    for reference in lock_refs.iter().chain(type_refs.iter()) {
        buf.extend_from_slice(&reference.to_le_bytes());
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
        buf.push(u8::from(cell.data_bytes > 0));
    }

    // —— string region (field-major: tx hashes, content hashes, data) ——
    buf.extend_from_slice(&strings.tx_hash);
    buf.extend_from_slice(&strings.content_hash);
    buf.extend_from_slice(&strings.data_hex);

    // —— tail: tag dictionary + script dictionary + provenance ——
    // Read strictly in this order: the sections are variable-length, so the
    // client walks them with one cursor and every one of them must be
    // written unconditionally.
    let tail_offset = buf.len() as u32;
    buf[64..68].copy_from_slice(&tail_offset.to_le_bytes());
    buf.push(tags.len() as u8);
    for tag in tags {
        push_short_string(&mut buf, tag);
    }
    buf.extend_from_slice(&(scripts.entries.len() as u16).to_le_bytes());
    for script in &scripts.entries {
        buf.push(hash_type_code(script.hash_type));
        push_short_string(&mut buf, &script.code_hash_hex());
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
        // An absent display plane still writes the 18-byte placeholder: the
        // sections length that follows is found by walking the tail, not by
        // an offset, so a section that appears only sometimes would slide it.
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

/// Path of a fixture shared with the TS side.
#[cfg(test)]
fn shared_fixture_path(name: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures")
        .join(name)
}

/// Compare `encoded` against the committed fixture, or rewrite it when
/// `CKNERV_REGEN_FIXTURES` is set. Both sides of the language boundary read
/// these very bytes, so a layout change landing on only one of them fails on
/// both. `pub(crate)` because the JSON/BIN pair is written from the `cells`
/// tests, which own the galaxy helpers, while the layout fixtures are written
/// from here.
#[cfg(test)]
pub(crate) fn assert_matches_fixture(name: &str, encoded: &[u8]) {
    let path = shared_fixture_path(name);
    if std::env::var("CKNERV_REGEN_FIXTURES").is_ok() {
        std::fs::write(&path, encoded).expect("write fixture");
    }
    let fixture = std::fs::read(&path).expect("read fixture");
    assert_eq!(
        encoded, fixture,
        "wire form drifted from {name}; regenerate it and update the TS \
         decoder in the same change"
    );
}

/// The text twin, so a mismatch prints readable JSON instead of two byte
/// arrays.
#[cfg(test)]
pub(crate) fn assert_matches_text_fixture(name: &str, encoded: &str) {
    let path = shared_fixture_path(name);
    if std::env::var("CKNERV_REGEN_FIXTURES").is_ok() {
        std::fs::write(&path, encoded).expect("write fixture");
    }
    let fixture = std::fs::read_to_string(&path).expect("read fixture");
    assert_eq!(
        encoded, fixture,
        "wire form drifted from {name}; regenerate it and update the TS \
         decoder in the same change"
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::helix::helix_seed_for;
    use crate::outpoint::{OutPoint, DATA_HEX_TRUNCATION_MARKER};
    use crate::projection::cells::Cell;
    use crate::projection::display_plane::ColumnarDisplayView;

    /// The two script identities the fixture rows share. Two rows guarded by
    /// the same lock must resolve to ONE dictionary entry — that dedup is the
    /// whole reason the pairs are not inline — and the type script differs in
    /// `hash_type` so the code table is exercised beyond its zero.
    const FIXTURE_LOCK_CODE_HASH: &str =
        "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8";
    const FIXTURE_TYPE_CODE_HASH: &str =
        "0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95";

    fn fixture_lock_script() -> ScriptId {
        ScriptId::parse(FIXTURE_LOCK_CODE_HASH, "type").expect("well-formed lock code hash")
    }

    fn fixture_type_script() -> ScriptId {
        ScriptId::parse(FIXTURE_TYPE_CODE_HASH, "data1").expect("well-formed type code hash")
    }

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
            // Three data shapes, one of them upstream-truncated: the marker
            // rides the string blob, so the fixture must carry a row that
            // has one.
            data_hex: match id % 3 {
                0 => "0x".into(),
                1 => format!("0xdeadbeef{DATA_HEX_TRUNCATION_MARKER}"),
                _ => "0xdeadbeef".into(),
            },
            data_bytes: if id.is_multiple_of(3) { 0 } else { 4 },
            content_hash: format!("0x{:064x}", id * 7),
            lock_shape_seed: [id as u32 * 11, id as u32 * 13],
            type_shape_seed: (id % 3 == 2).then_some([id as u32 * 17, id as u32 * 19]),
            data_shape_seed: [id as u32 * 23, id as u32 * 29],
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
            // Three script shapes on the same `id % 3` key as the data
            // above: lock-only, lock+type, and a cell carrying neither.
            lock_script: if id.is_multiple_of(3) {
                Default::default()
            } else {
                fixture_lock_script()
            },
            type_script: (id % 3 == 2).then(fixture_type_script),
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
        data_bytes: usize,
        lock_seed: usize,
        type_seed: usize,
        data_seed: usize,
        tx_offsets: usize,
        script_refs: usize,
        lock: usize,
        strings: usize,
    }

    fn offsets(n: usize, m: usize) -> Offsets {
        let id = CELLS_COLUMNAR_HEADER_BYTES;
        let members = id + 4 * 8 * n;
        let pos = members + 8 * m;
        let u32s = pos + 3 * 4 * n;
        let data_bytes = u32s + 2 * 4 * n;
        let lock_seed = data_bytes + 4 * n;
        let type_seed = lock_seed + 2 * 4 * n;
        let data_seed = type_seed + 2 * 4 * n;
        let tx_offsets = u32s + 9 * 4 * n;
        let script_refs = tx_offsets + 3 * (n + 1) * 4;
        let lock = script_refs + 2 * 2 * n;
        Offsets {
            id,
            death: id + 2 * 8 * n,
            members,
            pos,
            data_bytes,
            lock_seed,
            type_seed,
            data_seed,
            tx_offsets,
            script_refs,
            lock,
            strings: lock + 4 * n,
        }
    }

    fn u32_at(buf: &[u8], at: usize) -> u32 {
        u32::from_le_bytes(buf[at..at + 4].try_into().unwrap())
    }

    fn u16_at(buf: &[u8], at: usize) -> u16 {
        u16::from_le_bytes(buf[at..at + 2].try_into().unwrap())
    }

    /// Walk the tail to the provenance block the way the client has to: both
    /// dictionaries in front of it are variable-length, so there is no offset
    /// to jump to.
    fn provenance_at(buf: &[u8]) -> usize {
        let mut cursor = u32_at(buf, 64) as usize;
        let tags = buf[cursor] as usize;
        cursor += 1;
        for _ in 0..tags {
            cursor += 1 + buf[cursor] as usize;
        }
        let scripts = u16_at(buf, cursor) as usize;
        cursor += 2;
        for _ in 0..scripts {
            cursor += 2 + buf[cursor + 1] as usize; // hash-type code + string
        }
        cursor
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
        // The revision slot the SERVER patches. The projection leaves it
        // zero; the registry writes eight bytes at exactly this offset, so a
        // header reshuffle that moved the field without moving the constant
        // would overwrite whatever landed here instead.
        let revision_slot = CELLS_COLUMNAR_REVISION_OFFSET;
        assert_eq!(
            u64::from_le_bytes(buf[revision_slot..revision_slot + 8].try_into().unwrap()),
            0
        );
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

        // v4 component-shape columns. Tuple words are separate SoA columns;
        // absent type seeds are zero-filled, with the script ref below still
        // authoritative for absence.
        assert_eq!(
            (0..n)
                .map(|row| u32_at(&buf, at.data_bytes + row * 4))
                .collect::<Vec<_>>(),
            [4, 4, 0, 4]
        );
        assert_eq!(u32_at(&buf, at.lock_seed), 11);
        assert_eq!(u32_at(&buf, at.lock_seed + n * 4), 13);
        assert_eq!(u32_at(&buf, at.type_seed), 0);
        assert_eq!(u32_at(&buf, at.type_seed + 4), 34);
        assert_eq!(u32_at(&buf, at.type_seed + n * 4 + 4), 38);
        assert_eq!(u32_at(&buf, at.data_seed), 23);
        assert_eq!(u32_at(&buf, at.data_seed + n * 4), 29);

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

    /// Script identity is dictionary-encoded: two rows under the same lock
    /// resolve to ONE entry, an absent script is ref 0, and the refs are two
    /// u16 columns rather than two hex hashes a row.
    #[test]
    fn script_identity_rides_a_dictionary_and_two_u16_refs() {
        let rows = [cell(1, None), cell(2, None), cell(3, None)];
        let buf = encode_cells_columnar(&rows, header(), None, empty_tail());
        let n = rows.len();
        let at = offsets(n, 0);

        let lock_ref = |row: usize| u16_at(&buf, at.script_refs + row * 2);
        let type_ref = |row: usize| u16_at(&buf, at.script_refs + (n + row) * 2);
        // id 1 lock-only, id 2 lock+type sharing that same lock, id 3 neither.
        assert_eq!([lock_ref(0), lock_ref(1), lock_ref(2)], [1, 1, 0]);
        assert_eq!([type_ref(0), type_ref(1), type_ref(2)], [0, 2, 0]);

        let mut cursor = u32_at(&buf, 64) as usize;
        cursor += 1; // empty tag dictionary
        assert_eq!(u16_at(&buf, cursor), 2, "one entry per distinct script");
        cursor += 2;
        assert_eq!(buf[cursor], 1, "lock hash_type = type");
        let length = buf[cursor + 1] as usize;
        assert_eq!(
            std::str::from_utf8(&buf[cursor + 2..cursor + 2 + length]).unwrap(),
            FIXTURE_LOCK_CODE_HASH
        );
        cursor += 2 + length;
        assert_eq!(buf[cursor], 2, "type hash_type = data1");
        let length = buf[cursor + 1] as usize;
        assert_eq!(
            std::str::from_utf8(&buf[cursor + 2..cursor + 2 + length]).unwrap(),
            FIXTURE_TYPE_CODE_HASH
        );
        assert_eq!(cursor + 2 + length, provenance_at(&buf));
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
        assert!(
            region.is_ascii(),
            "the client reads these byte offsets as char offsets"
        );

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

    /// The release-path guarantee behind the offset table: a value that is
    /// not ASCII degrades to `?` bytes instead of aborting the encode, and it
    /// degrades BYTE-wise so nothing after it in the shared blob shifts.
    /// Drives the writer directly because `StringTables::push` layers a debug
    /// assert on top — the producer bug must still be loud where it is fixable.
    #[test]
    fn a_non_ascii_column_value_is_sanitized_not_fatal() {
        let mut blob = Vec::new();
        assert!(push_ascii_lossy(&mut blob, "0xdead"));
        let start = blob.len();
        assert!(!push_ascii_lossy(&mut blob, "0xbeef…"));
        let end = blob.len();
        assert!(push_ascii_lossy(&mut blob, "0xcafe"));

        assert_eq!(&blob[start..end], b"0xbeef???");
        assert_eq!(end - start, "0xbeef…".len(), "offsets must not shift");
        assert_eq!(std::str::from_utf8(&blob[end..]).unwrap(), "0xcafe");
        assert!(blob.is_ascii());
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

        let tail = provenance_at(&buf);
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
    /// reads the very same bytes (`packages/cache/__tests__`). Regenerate with
    /// `CKNERV_REGEN_FIXTURES=1 cargo test -p cknerv-core columnar_v5`.
    #[test]
    fn columnar_v5_matches_the_shared_fixture() {
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
        assert_matches_fixture("cells_columnar_v5.bin", &encoded);
    }

    /// The display-absent shape, as its own fixture. The provenance
    /// placeholder is written either way, so a decoder that consumes it only
    /// when a plane is present reads the sections length out of the middle of
    /// it — which is exactly the desync this fixture exists to catch.
    #[test]
    fn columnar_v5_display_absent_matches_the_shared_fixture() {
        let rows = [cell(1, Some("wallet")), cell(2, None), cell(3, Some("dex"))];
        let encoded = encode_cells_columnar(&rows, header(), None, empty_tail());
        assert_matches_fixture("cells_columnar_v5_absent.bin", &encoded);
    }

    #[test]
    fn empty_snapshot_is_header_plus_empty_tail() {
        let buf = encode_cells_columnar(&[], header(), None, empty_tail());
        let tail = u32_at(&buf, 64) as usize;
        assert_eq!(tail, CELLS_COLUMNAR_HEADER_BYTES + 3 * 4);
        assert_eq!(buf[tail], 0, "empty tag dictionary");
        assert_eq!(u16_at(&buf, tail + 1), 0, "empty script dictionary");
    }
}
