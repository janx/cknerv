import { describe, expect, it } from 'vitest';
import {
  CELLS_COLUMNAR_NO_TAG,
  columnarCellAt,
  decodeCellsColumnar,
} from '../src/cellsColumnar';

interface FixtureRow {
  id: number;
  born: number;
  death: number | null;
  capacity: number;
  pos: [number, number, number];
  birthBlock: number;
  outIndex: number;
  lock: number;
  asset: number;
  tag: string | null;
  hasData: boolean;
}

/** Hand-built encoder mirroring the Rust layout spec — intentionally an
 *  independent construction so a shared misreading can't cancel out. The
 *  live parity gate is the true cross-language check. */
function encodeFixture(
  rows: FixtureRow[],
  header: { revision: number; lastPulse: number; births: number; deaths: number },
): ArrayBuffer {
  const n = rows.length;
  const tags: string[] = [];
  const tagCode = (tag: string | null): number => {
    if (tag === null) return CELLS_COLUMNAR_NO_TAG;
    const found = tags.indexOf(tag);
    if (found >= 0) return found;
    tags.push(tag);
    return tags.length - 1;
  };
  const tagCodes = rows.map((row) => tagCode(row.tag));
  const utf8 = new TextEncoder();
  const encodedTags = tags.map((tag) => utf8.encode(tag));
  const dictBytes = 1 + encodedTags.reduce((sum, t) => sum + 1 + t.length, 0);
  const columnsEnd = 48 + n * (4 * 8 + 3 * 4 + 2 * 4 + 4);
  const buffer = new ArrayBuffer(columnsEnd + dictBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  bytes.set([0x43, 0x4b, 0x4e, 0x42], 0); // "CKNB"
  view.setUint16(4, 1, true);
  view.setUint16(6, 0, true);
  view.setBigUint64(8, BigInt(header.revision), true);
  view.setBigUint64(16, BigInt(header.lastPulse), true);
  view.setBigUint64(24, BigInt(header.births), true);
  view.setBigUint64(32, BigInt(header.deaths), true);
  view.setUint32(40, n, true);
  view.setUint32(44, columnsEnd, true);

  rows.forEach((row, i) => {
    view.setFloat64(48 + 8 * i, row.id, true);
    view.setFloat64(48 + 8 * (n + i), row.born, true);
    view.setFloat64(48 + 8 * (2 * n + i), row.death ?? Number.NaN, true);
    view.setFloat64(48 + 8 * (3 * n + i), row.capacity, true);
    const f32Base = 48 + 32 * n;
    view.setFloat32(f32Base + 4 * i, row.pos[0], true);
    view.setFloat32(f32Base + 4 * (n + i), row.pos[1], true);
    view.setFloat32(f32Base + 4 * (2 * n + i), row.pos[2], true);
    const u32Base = f32Base + 12 * n;
    view.setUint32(u32Base + 4 * i, row.birthBlock, true);
    view.setUint32(u32Base + 4 * (n + i), row.outIndex, true);
    const u8Base = u32Base + 8 * n;
    bytes[u8Base + i] = row.lock;
    bytes[u8Base + n + i] = row.asset;
    bytes[u8Base + 2 * n + i] = tagCodes[i];
    bytes[u8Base + 3 * n + i] = row.hasData ? 1 : 0;
  });

  let cursor = columnsEnd;
  bytes[cursor] = encodedTags.length;
  cursor += 1;
  for (const tag of encodedTags) {
    bytes[cursor] = tag.length;
    cursor += 1;
    bytes.set(tag, cursor);
    cursor += tag.length;
  }
  return buffer;
}

const ROWS: FixtureRow[] = [
  {
    // 2^52-range composition id: must survive the f64 column exactly.
    id: 4_503_599_627_370_497,
    born: 1_754_700_000_123,
    death: null,
    capacity: 6_100_000_000,
    pos: [0.25, -1.5, 3.75],
    birthBlock: 17_000_000,
    outIndex: 3,
    lock: 0,
    asset: 0,
    tag: 'wallet',
    hasData: false,
  },
  {
    id: 7,
    born: 1_754_700_001_000,
    death: 1_754_700_002_000,
    capacity: 14_200_000_000,
    pos: [-2, 0.5, 0],
    birthBlock: 17_000_001,
    outIndex: 0,
    lock: 3,
    asset: 3,
    tag: null,
    hasData: true,
  },
  {
    id: 8,
    born: 1_754_700_003_000,
    death: null,
    capacity: 100,
    pos: [1, 2, 3],
    birthBlock: 17_000_002,
    outIndex: 12,
    lock: 4,
    asset: 5,
    tag: 'wallet',
    hasData: false,
  },
];

const HEADER = { revision: 4321, lastPulse: 1_754_700_003_500, births: 30, deaths: 11 };

describe('decodeCellsColumnar', () => {
  it('decodes header, columns, and tag dictionary zero-copy', () => {
    const buffer = encodeFixture(ROWS, HEADER);
    const view = decodeCellsColumnar(buffer);

    expect(view.revision).toBe(4321);
    expect(view.lastPulseAtMs).toBe(1_754_700_003_500);
    expect(view.totalBirths).toBe(30);
    expect(view.totalDeaths).toBe(11);
    expect(view.rowCount).toBe(3);
    expect(view.tags).toEqual(['wallet']);
    // Zero-copy: columns are views over the SAME buffer, not copies.
    expect(view.id.buffer).toBe(buffer);
    expect(view.dataFlag.buffer).toBe(buffer);

    expect(Array.from(view.id)).toEqual(ROWS.map((r) => r.id));
    expect(view.deathAtMs[0]).toBeNaN();
    expect(view.deathAtMs[1]).toBe(1_754_700_002_000);
    expect(Array.from(view.birthBlock)).toEqual(ROWS.map((r) => r.birthBlock));
    expect(Array.from(view.tagIndex)).toEqual([0, CELLS_COLUMNAR_NO_TAG, 0]);
  });

  it('materializes rows into JSON-path field shapes', () => {
    const view = decodeCellsColumnar(encodeFixture(ROWS, HEADER));

    expect(columnarCellAt(view, 0)).toEqual({
      id: 4_503_599_627_370_497,
      born_at_ms: 1_754_700_000_123,
      death_at_ms: null,
      birth_block: 17_000_000,
      tag: 'wallet',
      pos_seed: [0.25, -1.5, 3.75],
      out_point_index: 3,
      capacity: 6_100_000_000,
      has_data: false,
      lock_kind: 'sighash',
      asset_kind: 'native',
    });
    expect(columnarCellAt(view, 1)).toMatchObject({
      death_at_ms: 1_754_700_002_000,
      tag: null,
      has_data: true,
      lock_kind: 'omnilock',
      asset_kind: 'dao',
    });
    expect(columnarCellAt(view, 2)).toMatchObject({
      lock_kind: 'other',
      asset_kind: 'other',
      tag: 'wallet',
    });
  });

  it('decodes an empty snapshot', () => {
    const view = decodeCellsColumnar(encodeFixture([], HEADER));
    expect(view.rowCount).toBe(0);
    expect(view.tags).toEqual([]);
    expect(view.id.length).toBe(0);
  });

  it('rejects malformed buffers instead of misreading them', () => {
    const good = encodeFixture(ROWS, HEADER);

    const badMagic = good.slice(0);
    new Uint8Array(badMagic)[0] = 0x58;
    expect(() => decodeCellsColumnar(badMagic)).toThrow(/bad magic/);

    const badVersion = good.slice(0);
    new DataView(badVersion).setUint16(4, 9, true);
    expect(() => decodeCellsColumnar(badVersion)).toThrow(/version/);

    const truncated = good.slice(0, 60);
    expect(() => decodeCellsColumnar(truncated)).toThrow();

    expect(() => decodeCellsColumnar(new ArrayBuffer(8))).toThrow(/too small/);
  });
});
