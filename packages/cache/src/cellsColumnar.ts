// Decoder for the columnar cell-galaxy snapshot — TS mirror of
// `cknerv-core::projection::cells_columnar` (see that file for the layout
// spec). One little-endian buffer: a 72-byte header, per-field columns
// grouped by element width (f64, f32, u32, u8), an ASCII string region, and
// a tail holding the tag dictionary and display provenance.
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
  LockKind,
} from '@cknerv/types';

export const CELLS_COLUMNAR_VERSION = 2;
export const CELLS_COLUMNAR_HEADER_BYTES = 72;
/** tag_index value meaning "no tag". */
export const CELLS_COLUMNAR_NO_TAG = 0xff;

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
  /** Codes into COLUMNAR_LOCK_KINDS. */
  lockKind: Uint8Array;
  /** Codes into COLUMNAR_ASSET_KINDS. */
  assetKind: Uint8Array;
  /** Codes into `tags`; CELLS_COLUMNAR_NO_TAG = untagged. */
  tagIndex: Uint8Array;
  /** 1 = cell data beyond "0x". */
  dataFlag: Uint8Array;
  /** Tag dictionary, first-seen order. */
  tags: readonly string[];
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
  const revision = Number(header.getBigUint64(8, true));
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
  const offsetsBase = u32Base + 2 * 4 * n;
  const u8Base = offsetsBase + 3 * (n + 1) * 4;
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
  const tags: string[] = [];
  const tagCount = bytes[cursor];
  cursor += 1;
  for (let i = 0; i < tagCount; i += 1) tags.push(shortString());

  let display: CellsColumnarDisplay | null = null;
  if (displayMode !== CELLS_COLUMNAR_DISPLAY_ABSENT) {
    const tail = new DataView(buffer);
    const updatedAtMs = Number(tail.getBigUint64(cursor, true));
    const asOfBlock = Number(tail.getBigUint64(cursor + 8, true));
    cursor += 16;
    const source = shortString();
    const asOfHash = shortString();
    display = {
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
  }

  const sectionsLength = new DataView(buffer).getUint32(cursor, true);
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
    lockKind: new Uint8Array(buffer, u8Base, n),
    assetKind: new Uint8Array(buffer, u8Base + n, n),
    tagIndex: new Uint8Array(buffer, u8Base + 2 * n, n),
    dataFlag: new Uint8Array(buffer, u8Base + 3 * n, n),
    tags,
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
  return {
    id: view.id[i],
    born_at_ms: view.bornAtMs[i],
    death_at_ms: Number.isNaN(death) ? null : death,
    birth_block: view.birthBlock[i],
    tag: tagCode === CELLS_COLUMNAR_NO_TAG ? null : view.tags[tagCode],
    pos_seed: [view.posX[i], view.posY[i], view.posZ[i]],
    out_point: { tx_hash: view.txHash(i), index: view.outPointIndex[i] },
    capacity: view.capacity[i],
    data_hex: view.dataHex(i),
    content_hash: view.contentHash(i),
    lock_kind: COLUMNAR_LOCK_KINDS[view.lockKind[i]] ?? 'other',
    asset_kind: COLUMNAR_ASSET_KINDS[view.assetKind[i]] ?? 'other',
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
