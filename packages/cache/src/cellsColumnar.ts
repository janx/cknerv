// Decoder for the columnar cell-galaxy snapshot — TS mirror of
// `cknerv-core::projection::cells_columnar` (see that file for the layout
// spec). One little-endian buffer: a 72-byte header, per-field columns
// grouped by element width (f64, f32, u32, u16, u8), an ASCII string region,
// and a tail holding the tag dictionary, the script dictionary and the
// display provenance — in that order, each variable-length, all three read
// with one cursor.
//
// Numeric decoding is ZERO-COPY: every column is a typed-array view over the
// fetched ArrayBuffer, and the header orders groups widest-first so each view
// lands on a naturally aligned offset.
//
// Strings are decoded ONCE for the whole region and then sliced by offset.
// That is the measured reason the wire carries hex text rather than packed
// 32-byte hashes: re-hexing 100k hashes costs ~68ms of main thread even with
// a lookup table, while one decode plus fixed slicing costs ~4.7ms.

import type {
  AssetKind,
  Cell,
  CellGalaxySnapshot,
  CellLinkRecord,
  CellViewStats,
  HashType,
  LockKind,
  ScriptId,
} from '@cknerv/types';

export const CELLS_COLUMNAR_VERSION = 5;
export const CELLS_COLUMNAR_HEADER_BYTES = 72;
/** Byte offset of the u64 revision the SERVER patches into the header after
 *  the projection encoded it (`projection_registry.rs`). Mirrored here so a
 *  header reshuffle has to move both sides at once — a stale offset would
 *  hand every reconnect a `?since=` cursor from the middle of another
 *  field. */
export const CELLS_COLUMNAR_REVISION_OFFSET = 8;
/** tag_index value meaning "no tag". */
export const CELLS_COLUMNAR_NO_TAG = 0xff;
/** Script-ref value meaning "this cell carries no such script"; every other
 *  ref is `dictionary index + 1`. */
export const CELLS_COLUMNAR_NO_SCRIPT = 0;

/** `display_mode` byte: absent / canonical / composed. */
export const CELLS_COLUMNAR_DISPLAY_ABSENT = 0;
export const CELLS_COLUMNAR_DISPLAY_CANONICAL = 1;
export const CELLS_COLUMNAR_DISPLAY_COMPOSED = 2;

/** Enum code tables — index = wire code. MUST match the Rust
 *  `lock_kind_code` / `asset_kind_code` mappings (declaration order of the
 *  `#[serde(rename_all = "snake_case")]` enums). */
export const COLUMNAR_LOCK_KINDS: readonly LockKind[] = [
  'sighash',
  'multisig',
  'acp',
  'omnilock',
  'other',
];
export const COLUMNAR_ASSET_KINDS: readonly AssetKind[] = [
  'native',
  'sudt',
  'xudt',
  'dao',
  'spore',
  'other',
  'object',
  'identity',
];
/** Same contract for the script dictionary's `hash_type` byte — MUST match
 *  the Rust `hash_type_code` mapping. */
export const COLUMNAR_HASH_TYPES: readonly HashType[] = [
  'data',
  'type',
  'data1',
  'data2',
];

/** Zero-copy columnar view over one snapshot buffer. Row `i` of every column
 *  describes the same cell as `snapshot.cells[i]` on the JSON path. */
export interface CellsColumnarView {
  revision: number;
  lastPulseAtMs: number;
  totalBirths: number;
  totalDeaths: number;
  /** Canonical rows. Rows `[0, cellCount)` are the canonical map. */
  cellCount: number;
  /** Resident rows. Rows `[cellCount, rowCount)` are staged residents. */
  residentCount: number;
  /** Canonical + resident rows; the length of every column below. */
  rowCount: number;
  id: Float64Array;
  bornAtMs: Float64Array;
  /** NaN = alive (JSON `death_at_ms: null`). */
  deathAtMs: Float64Array;
  /** Shannons, same f64 precision as the JSON path. */
  capacity: Float64Array;
  posX: Float32Array;
  posY: Float32Array;
  posZ: Float32Array;
  birthBlock: Uint32Array;
  outPointIndex: Uint32Array;
  dataBytes: Uint32Array;
  lockShapeSeed0: Uint32Array;
  lockShapeSeed1: Uint32Array;
  typeShapeSeed0: Uint32Array;
  typeShapeSeed1: Uint32Array;
  dataShapeSeed0: Uint32Array;
  dataShapeSeed1: Uint32Array;
  /** Codes into COLUMNAR_LOCK_KINDS. */
  lockKind: Uint8Array;
  /** Codes into COLUMNAR_ASSET_KINDS. */
  assetKind: Uint8Array;
  /** Codes into `tags`; CELLS_COLUMNAR_NO_TAG = untagged. */
  tagIndex: Uint8Array;
  /** 1 = cell data beyond "0x". */
  dataFlag: Uint8Array;
  /** Refs into `scripts`, offset by one; CELLS_COLUMNAR_NO_SCRIPT = the cell
   *  carries no lock identity, which is what the JSON path spells as an
   *  absent `lock_script` key. */
  lockScriptRef: Uint16Array;
  /** Same for `type_script`; absent on a plain cell. */
  typeScriptRef: Uint16Array;
  /** Tag dictionary, first-seen order. */
  tags: readonly string[];
  /** Script dictionary, first-seen order. Mainnet runs ~29 distinct pairs
   *  across the whole galaxy, so rows share these objects rather than each
   *  materializing its own — every consumer treats a `Cell` as immutable. */
  scripts: readonly ScriptId[];
  /** Row `i`'s `out_point.tx_hash`. */
  txHash(row: number): string;
  contentHash(row: number): string;
  dataHex(row: number): string;
  /** Null when the server ships no display plane at all. */
  display: CellsColumnarDisplay | null;
  /** The non-row sections, decoded from the trailing JSON: tx links nest
   *  variable-length id arrays per record, so they are not columnar. */
  recentLinks: CellLinkRecord[];
  backfill: CellGalaxySnapshot['backfill'];
  /** Aggregate view statistics over the server's FULL retained set. Null from
   *  a server that predates the segment; the reducer then falls back to
   *  scanning the rows it received. */
  stats: CellViewStats | null;
}

export interface CellsColumnarDisplay {
  mode: 'canonical' | 'composed';
  budgetCells: number;
  budgetNerveEdges: number;
  /** Staged member ids, ascending. */
  members: Float64Array;
  source: string | null;
  asOfBlock: number | null;
  asOfHash: string | null;
  updatedAtMs: number;
}

function fail(reason: string): never {
  throw new Error(`cells columnar snapshot: ${reason}`);
}

/** Read `code` out of a wire dictionary or code table, or FAIL.
 *
 *  A code this build's table does not hold means the encoder and the decoder
 *  no longer agree about an enum — a variant was added, or the declaration
 *  order moved. Aliasing it to a valid neighbour (`?? 'other'`, `?? 'data'`)
 *  does not degrade gracefully: it MINTS a different classification, and for
 *  a script a different `ScriptId`, which is the key the script-identity join
 *  and `cellContentEquals` compare. The galaxy then looks plausible and is
 *  wrong, and BIN and JSON disagree about the same cell.
 *
 *  Throwing is affordable because every caller decodes inside the binary
 *  path, whose contract is "any throw ⇒ use the JSON snapshot": the HTTP boot
 *  falls back per request, and the stream latches the fallback for the whole
 *  session. Words instead of a wrong galaxy. */
function codeAt<T>(
  table: readonly T[],
  code: number,
  field: string,
  row?: number,
): T {
  const value = table[code];
  if (value === undefined) {
    const at = row === undefined ? '' : ` at row ${row}`;
    fail(`${field} code ${code} outside 0..${table.length - 1}${at}`);
  }
  return value;
}

/** Decode a columnar snapshot buffer into typed-array column views.
 *  Throws on malformed input — callers treat any throw as "fall back to the
 *  JSON snapshot path". */
export function decodeCellsColumnar(buffer: ArrayBuffer): CellsColumnarView {
  if (buffer.byteLength < CELLS_COLUMNAR_HEADER_BYTES + 1) {
    fail(`buffer too small (${buffer.byteLength} bytes)`);
  }
  const header = new DataView(buffer, 0, CELLS_COLUMNAR_HEADER_BYTES);
  if (
    header.getUint8(0) !== 0x43 // C
    || header.getUint8(1) !== 0x4b // K
    || header.getUint8(2) !== 0x4e // N
    || header.getUint8(3) !== 0x42 // B
  ) {
    fail('bad magic');
  }
  const version = header.getUint16(4, true);
  if (version !== CELLS_COLUMNAR_VERSION) {
    fail(`unsupported version ${version}`);
  }
  const revision = Number(header.getBigUint64(CELLS_COLUMNAR_REVISION_OFFSET, true));
  const lastPulseAtMs = Number(header.getBigUint64(16, true));
  const totalBirths = Number(header.getBigUint64(24, true));
  const totalDeaths = Number(header.getBigUint64(32, true));
  const cellCount = header.getUint32(40, true);
  const residentCount = header.getUint32(44, true);
  const memberCount = header.getUint32(48, true);
  const budgetCells = header.getUint32(52, true);
  const budgetNerveEdges = header.getUint32(56, true);
  const displayMode = header.getUint8(60);
  const tailOffset = header.getUint32(64, true);

  const n = cellCount + residentCount;
  const f64Base = CELLS_COLUMNAR_HEADER_BYTES;
  const membersBase = f64Base + 4 * 8 * n;
  const f32Base = membersBase + 8 * memberCount;
  const u32Base = f32Base + 3 * 4 * n;
  const offsetsBase = u32Base + 9 * 4 * n;
  const u16Base = offsetsBase + 3 * (n + 1) * 4;
  const u8Base = u16Base + 2 * 2 * n;
  const stringsBase = u8Base + 4 * n;
  if (tailOffset < stringsBase || tailOffset > buffer.byteLength) {
    fail(`tail offset ${tailOffset} outside [${stringsBase}, ${buffer.byteLength}]`);
  }

  const offsets = new Uint32Array(buffer, offsetsBase, 3 * (n + 1));
  // One decode for every string in the snapshot; `substring` on the result
  // is a cheap sliced string in V8, and the offsets are region-relative
  // byte offsets which are also char offsets because the region is ASCII.
  const region = new TextDecoder().decode(
    new Uint8Array(buffer, stringsBase, tailOffset - stringsBase),
  );
  const sliceAt = (field: number, row: number): string => {
    if (row < 0 || row >= n) fail(`row ${row} out of range`);
    const table = field * (n + 1);
    return region.substring(offsets[table + row], offsets[table + row + 1]);
  };

  const bytes = new Uint8Array(buffer);
  const utf8 = new TextDecoder();
  let cursor = tailOffset;
  const shortString = (): string => {
    const length = bytes[cursor];
    cursor += 1;
    if (cursor + length > buffer.byteLength) fail('tail string truncated');
    const value = utf8.decode(new Uint8Array(buffer, cursor, length));
    cursor += length;
    return value;
  };
  const tail = new DataView(buffer);
  const tags: string[] = [];
  const tagCount = bytes[cursor];
  cursor += 1;
  for (let i = 0; i < tagCount; i += 1) tags.push(shortString());

  const scripts: ScriptId[] = [];
  const scriptCount = tail.getUint16(cursor, true);
  cursor += 2;
  for (let i = 0; i < scriptCount; i += 1) {
    const hashType = codeAt(COLUMNAR_HASH_TYPES, bytes[cursor], 'hash_type');
    cursor += 1;
    scripts.push({ code_hash: shortString(), hash_type: hashType });
  }

  // The provenance block is written whether or not there IS a display plane
  // (an absent one writes zeros and two empty strings), because the sections
  // length below is found by walking this tail rather than by an offset.
  // Consuming it conditionally reads that length out of the middle of it.
  const updatedAtMs = Number(tail.getBigUint64(cursor, true));
  const asOfBlock = Number(tail.getBigUint64(cursor + 8, true));
  cursor += 16;
  const source = shortString();
  const asOfHash = shortString();
  const display: CellsColumnarDisplay | null =
    displayMode === CELLS_COLUMNAR_DISPLAY_ABSENT ? null : {
      mode: displayMode === CELLS_COLUMNAR_DISPLAY_COMPOSED ? 'composed' : 'canonical',
      budgetCells,
      budgetNerveEdges,
      members: new Float64Array(buffer, membersBase, memberCount),
      // Canonical provenance carries neither, and the wire spells that as
      // empty rather than absent — restore the `| null` the JSON twin has.
      source: source === '' ? null : source,
      asOfHash: asOfHash === '' ? null : asOfHash,
      asOfBlock: asOfHash === '' ? null : asOfBlock,
      updatedAtMs,
    };

  const sectionsLength = tail.getUint32(cursor, true);
  cursor += 4;
  if (cursor + sectionsLength > buffer.byteLength) fail('tail sections truncated');
  const sections = JSON.parse(
    utf8.decode(new Uint8Array(buffer, cursor, sectionsLength)),
  ) as {
    recent_links?: CellLinkRecord[];
    backfill?: CellGalaxySnapshot['backfill'];
    stats?: CellViewStats;
  };

  return {
    revision,
    lastPulseAtMs,
    totalBirths,
    totalDeaths,
    cellCount,
    residentCount,
    rowCount: n,
    id: new Float64Array(buffer, f64Base, n),
    bornAtMs: new Float64Array(buffer, f64Base + 8 * n, n),
    deathAtMs: new Float64Array(buffer, f64Base + 16 * n, n),
    capacity: new Float64Array(buffer, f64Base + 24 * n, n),
    posX: new Float32Array(buffer, f32Base, n),
    posY: new Float32Array(buffer, f32Base + 4 * n, n),
    posZ: new Float32Array(buffer, f32Base + 8 * n, n),
    birthBlock: new Uint32Array(buffer, u32Base, n),
    outPointIndex: new Uint32Array(buffer, u32Base + 4 * n, n),
    dataBytes: new Uint32Array(buffer, u32Base + 8 * n, n),
    lockShapeSeed0: new Uint32Array(buffer, u32Base + 12 * n, n),
    lockShapeSeed1: new Uint32Array(buffer, u32Base + 16 * n, n),
    typeShapeSeed0: new Uint32Array(buffer, u32Base + 20 * n, n),
    typeShapeSeed1: new Uint32Array(buffer, u32Base + 24 * n, n),
    dataShapeSeed0: new Uint32Array(buffer, u32Base + 28 * n, n),
    dataShapeSeed1: new Uint32Array(buffer, u32Base + 32 * n, n),
    lockKind: new Uint8Array(buffer, u8Base, n),
    assetKind: new Uint8Array(buffer, u8Base + n, n),
    tagIndex: new Uint8Array(buffer, u8Base + 2 * n, n),
    dataFlag: new Uint8Array(buffer, u8Base + 3 * n, n),
    lockScriptRef: new Uint16Array(buffer, u16Base, n),
    typeScriptRef: new Uint16Array(buffer, u16Base + 2 * n, n),
    tags,
    scripts,
    txHash: (row) => sliceAt(0, row),
    contentHash: (row) => sliceAt(1, row),
    dataHex: (row) => sliceAt(2, row),
    display,
    recentLinks: sections.recent_links ?? [],
    backfill: sections.backfill ?? null,
    stats: sections.stats ?? null,
  };
}

/** Row `i` materialized into a JSON-path `Cell`. This is how the reducer
 *  rebuilds its map — measured at ~17ms for 50k rows, against ~123ms just to
 *  `JSON.parse` the equivalent snapshot. */
export function columnarCellAt(view: CellsColumnarView, i: number): Cell {
  const death = view.deathAtMs[i];
  const tagCode = view.tagIndex[i];
  // A ref past the dictionary can only come from a buffer this build does not
  // understand. Reading it as ABSENT was as much of an invention as reading it
  // as the wrong script: `cellContentEquals` compares these keys, so a cell
  // that JSON says is scripted and BIN says is bare is not a degraded read, it
  // is a different cell. Zero still means absent; anything past the end fails.
  const lockRef = view.lockScriptRef[i];
  const typeRef = view.typeScriptRef[i];
  const lockScript = lockRef === CELLS_COLUMNAR_NO_SCRIPT
    ? undefined
    : codeAt(view.scripts, lockRef - 1, 'lock_script ref', i);
  const typeScript = typeRef === CELLS_COLUMNAR_NO_SCRIPT
    ? undefined
    : codeAt(view.scripts, typeRef - 1, 'type_script ref', i);
  return {
    id: view.id[i],
    born_at_ms: view.bornAtMs[i],
    death_at_ms: Number.isNaN(death) ? null : death,
    birth_block: view.birthBlock[i],
    tag: tagCode === CELLS_COLUMNAR_NO_TAG
      ? null
      : codeAt(view.tags, tagCode, 'tag', i),
    pos_seed: [view.posX[i], view.posY[i], view.posZ[i]],
    out_point: { tx_hash: view.txHash(i), index: view.outPointIndex[i] },
    capacity: view.capacity[i],
    data_hex: view.dataHex(i),
    data_bytes: view.dataBytes[i],
    content_hash: view.contentHash(i),
    lock_shape_seed: [view.lockShapeSeed0[i], view.lockShapeSeed1[i]],
    type_shape_seed: typeScript === undefined
      ? null
      : [view.typeShapeSeed0[i], view.typeShapeSeed1[i]],
    data_shape_seed: [view.dataShapeSeed0[i], view.dataShapeSeed1[i]],
    lock_kind: codeAt(COLUMNAR_LOCK_KINDS, view.lockKind[i], 'lock_kind', i),
    asset_kind: codeAt(COLUMNAR_ASSET_KINDS, view.assetKind[i], 'asset_kind', i),
    // Absent stays ABSENT rather than becoming an undefined-valued key: the
    // JSON twin omits these entirely, and `cellContentEquals` compares them,
    // so a key that exists on one path and not the other would false-negative
    // identity for every scripted cell on every lagged resync.
    ...(lockScript === undefined ? {} : { lock_script: lockScript }),
    ...(typeScript === undefined ? {} : { type_script: typeScript }),
  };
}

/** Rebuild the JSON-path snapshot shape from the columns.
 *
 * Deliberately produces exactly what `fetchCellsSnapshot` used to return, so
 * every consumer downstream — reducer, stats, links, detail — is untouched.
 * The win is not a new data path, it is a cheaper way to arrive at the same
 * one: measured in V8, ~123ms to `JSON.parse` the equivalent snapshot
 * against ~17ms to build these objects from columns, plus ~5ms for all the
 * strings in one decode. */
export function cellsSnapshotFromColumnar(view: CellsColumnarView): CellGalaxySnapshot {
  const cells: Cell[] = new Array(view.cellCount);
  for (let row = 0; row < view.cellCount; row += 1) cells[row] = columnarCellAt(view, row);
  const residents: Cell[] = new Array(view.residentCount);
  for (let i = 0; i < view.residentCount; i += 1) {
    residents[i] = columnarCellAt(view, view.cellCount + i);
  }
  return {
    cells,
    last_pulse_at_ms: view.lastPulseAtMs,
    recent_links: view.recentLinks,
    total_births: view.totalBirths,
    total_deaths: view.totalDeaths,
    // Carried through so the columnar boot path seeds the panel from the
    // server's aggregate too. This is the path that actually runs in
    // production, and the one that will stop carrying every retained row.
    ...(view.stats === null ? {} : { stats: view.stats }),
    backfill: view.backfill,
    display: view.display === null ? undefined : {
      budget: {
        cells: view.display.budgetCells,
        nerve_edges: view.display.budgetNerveEdges,
      },
      members: Array.from(view.display.members),
      residents,
      provenance: {
        mode: view.display.mode,
        source: view.display.source,
        as_of: view.display.asOfHash === null || view.display.asOfBlock === null
          ? null
          : { block: view.display.asOfBlock, hash: view.display.asOfHash },
        updated_at_ms: view.display.updatedAtMs,
      },
    },
  };
}
