// Decoder for the columnar cell-galaxy snapshot — TS mirror of
// `cknerv-core::projection::cells_columnar` (see that file for the layout
// spec). One little-endian buffer: 48-byte header, then per-field columns
// grouped by element width (f64, f32, u32, u8), then a tag dictionary.
//
// Decoding is ZERO-COPY: every column is a typed-array view over the fetched
// ArrayBuffer. The header places the f64 group at byte 48 and orders groups
// widest-first, so every view lands on a naturally aligned offset.

import type { AssetKind, LockKind } from '@cknerv/types';

export const CELLS_COLUMNAR_VERSION = 1;
export const CELLS_COLUMNAR_HEADER_BYTES = 48;
/** tag_index value meaning "no tag". */
export const CELLS_COLUMNAR_NO_TAG = 0xff;

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
  const rowCount = header.getUint32(40, true);
  const tagDictOffset = header.getUint32(44, true);

  const n = rowCount;
  const f64Base = CELLS_COLUMNAR_HEADER_BYTES;
  const f32Base = f64Base + 4 * 8 * n;
  const u32Base = f32Base + 3 * 4 * n;
  const u8Base = u32Base + 2 * 4 * n;
  const columnsEnd = u8Base + 4 * n;
  if (tagDictOffset !== columnsEnd) {
    fail(`tag dictionary offset ${tagDictOffset} != columns end ${columnsEnd}`);
  }
  if (buffer.byteLength <= columnsEnd) {
    fail(`buffer truncated (${buffer.byteLength} <= ${columnsEnd})`);
  }

  const tags: string[] = [];
  {
    const bytes = new Uint8Array(buffer);
    const utf8 = new TextDecoder();
    let cursor = tagDictOffset;
    const count = bytes[cursor];
    cursor += 1;
    for (let i = 0; i < count; i += 1) {
      const length = bytes[cursor];
      cursor += 1;
      if (cursor + length > buffer.byteLength) fail('tag dictionary truncated');
      tags.push(utf8.decode(new Uint8Array(buffer, cursor, length)));
      cursor += length;
    }
  }

  return {
    revision,
    lastPulseAtMs,
    totalBirths,
    totalDeaths,
    rowCount,
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
  };
}

/** Row `i` materialized into JSON-path field shapes — for parity checks and
 *  tests, NOT for bulk consumption (that would defeat the columns). Strings
 *  absent from the columnar form (`tx_hash`, `content_hash`, `data_hex`) are
 *  not included. */
export function columnarCellAt(view: CellsColumnarView, i: number): {
  id: number;
  born_at_ms: number;
  death_at_ms: number | null;
  birth_block: number;
  tag: string | null;
  pos_seed: [number, number, number];
  out_point_index: number;
  capacity: number;
  has_data: boolean;
  lock_kind: LockKind;
  asset_kind: AssetKind;
} {
  const death = view.deathAtMs[i];
  const tagCode = view.tagIndex[i];
  return {
    id: view.id[i],
    born_at_ms: view.bornAtMs[i],
    death_at_ms: Number.isNaN(death) ? null : death,
    birth_block: view.birthBlock[i],
    tag: tagCode === CELLS_COLUMNAR_NO_TAG ? null : view.tags[tagCode],
    pos_seed: [view.posX[i], view.posY[i], view.posZ[i]],
    out_point_index: view.outPointIndex[i],
    capacity: view.capacity[i],
    has_data: view.dataFlag[i] === 1,
    lock_kind: COLUMNAR_LOCK_KINDS[view.lockKind[i]] ?? 'other',
    asset_kind: COLUMNAR_ASSET_KINDS[view.assetKind[i]] ?? 'other',
  };
}
