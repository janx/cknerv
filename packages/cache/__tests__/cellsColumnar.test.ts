import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DATA_HEX_TRUNCATION_MARKER } from '@cknerv/types';
import {
  CELLS_COLUMNAR_HEADER_BYTES,
  CELLS_COLUMNAR_NO_TAG,
  CELLS_COLUMNAR_VERSION,
  cellsSnapshotFromColumnar,
  columnarCellAt,
  decodeCellsColumnar,
} from '../src/cellsColumnar';

/** The very bytes the Rust encoder produced. Both sides read this one file,
 *  so a layout change that lands on only one of them fails on both — which
 *  a hand-rolled TS encoder here could never catch, because it would drift
 *  along with whichever reading its author had. Regenerate with
 *  `CKNERV_REGEN_FIXTURES=1 cargo test -p cknerv-core columnar_v2`. */
function fixture(): ArrayBuffer {
  const path = fileURLToPath(
    new URL('../../../tests/fixtures/cells_columnar_v2.bin', import.meta.url),
  );
  const bytes = readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Mirrors the Rust fixture's `cell(id, tag)` helper. */
function expectedCell(id: number, tag: string | null) {
  return {
    id,
    born_at_ms: 1_000 + id,
    death_at_ms: id % 2 === 0 ? null : 2_000 + id,
    birth_block: 42 + id,
    tag,
    out_point: { tx_hash: `0x${id.toString(16).padStart(64, '0')}`, index: id },
    capacity: 6_100_000_000 + id,
    data_hex: id % 3 === 0
      ? '0x'
      : id % 3 === 1 ? `0xdeadbeef${DATA_HEX_TRUNCATION_MARKER}` : '0xdeadbeef',
    content_hash: `0x${(id * 7).toString(16).padStart(64, '0')}`,
    lock_kind: id % 2 === 0 ? 'sighash' : 'omnilock',
    asset_kind: id % 2 === 0 ? 'native' : 'dao',
  };
}

describe('decodeCellsColumnar', () => {
  it('reads the header the Rust encoder wrote', () => {
    const view = decodeCellsColumnar(fixture());
    expect(CELLS_COLUMNAR_VERSION).toBe(2);
    expect(CELLS_COLUMNAR_HEADER_BYTES).toBe(72);
    expect(view.lastPulseAtMs).toBe(777);
    expect(view.totalBirths).toBe(30);
    expect(view.totalDeaths).toBe(11);
    expect(view.cellCount).toBe(3);
    expect(view.residentCount).toBe(1);
    expect(view.rowCount).toBe(4);
  });

  it('materializes every row, canonical and resident alike', () => {
    const view = decodeCellsColumnar(fixture());
    for (const [row, [id, tag]] of (
      [[1, 'wallet'], [2, null], [3, 'dex'], [9, 'wallet']] as const
    ).entries()) {
      const cell = columnarCellAt(view, row);
      expect(cell).toMatchObject(expectedCell(id, tag));
      // Positions are the derived ones; the encoder no longer recomputes
      // them, so a wrong column would show up as a wrong triple here.
      expect(cell.pos_seed.every(Number.isFinite)).toBe(true);
    }
    expect(view.tags).toEqual(['wallet', 'dex']);
    expect(view.tagIndex[1]).toBe(CELLS_COLUMNAR_NO_TAG);
    expect(Array.from(view.dataFlag)).toEqual([1, 1, 0, 0]);  // id 3 and id 9 are both "0x"
  });

  /** Row 0 is upstream-truncated. The marker is one ASCII byte precisely so
   *  that it costs one char here — a multi-byte one would slide every later
   *  value in the shared region out from under its offset. */
  it('slices a truncated data_hex without shifting the values after it', () => {
    const view = decodeCellsColumnar(fixture());
    expect(view.dataHex(0)).toBe(`0xdeadbeef${DATA_HEX_TRUNCATION_MARKER}`);
    expect(view.dataHex(1)).toBe('0xdeadbeef');
    expect(view.dataHex(2)).toBe('0x');
    expect(view.dataHex(3)).toBe('0x');
  });

  it('carries the display plane: members, budgets and provenance', () => {
    const { display } = decodeCellsColumnar(fixture());
    expect(display).not.toBeNull();
    expect(display!.mode).toBe('composed');
    expect(display!.budgetCells).toBe(12_000);
    expect(display!.budgetNerveEdges).toBe(8_000);
    expect(Array.from(display!.members)).toEqual([1, 3, 9]);
    expect(display!.source).toBe('ckbadger');
    expect(display!.asOfBlock).toBe(4_242);
    expect(display!.asOfHash).toBe(`0x${(0xabc).toString(16).padStart(64, '0')}`);
    expect(display!.updatedAtMs).toBe(1_700_000_000_123);
  });

  it('rebuilds the JSON-path snapshot shape from the columns', () => {
    const snapshot = cellsSnapshotFromColumnar(decodeCellsColumnar(fixture()));
    expect(snapshot.cells).toHaveLength(3);
    expect(snapshot.cells[0]).toMatchObject(expectedCell(1, 'wallet'));
    expect(snapshot.last_pulse_at_ms).toBe(777);
    expect(snapshot.total_births).toBe(30);
    expect(snapshot.recent_links).toEqual([]);
    expect(snapshot.backfill).toBeNull();
    // Residents leave the row block and land in the display section, which
    // is where every downstream consumer looks for them.
    expect(snapshot.display?.members).toEqual([1, 3, 9]);
    expect(snapshot.display?.residents).toHaveLength(1);
    expect(snapshot.display?.residents[0]).toMatchObject(expectedCell(9, 'wallet'));
    expect(snapshot.display?.provenance).toMatchObject({
      mode: 'composed',
      source: 'ckbadger',
      updated_at_ms: 1_700_000_000_123,
    });
  });

  it('rejects malformed buffers so the caller can fall back to JSON', () => {
    const good = fixture();
    const badMagic = good.slice(0);
    new Uint8Array(badMagic)[0] = 0;
    expect(() => decodeCellsColumnar(badMagic)).toThrow(/bad magic/);

    const badVersion = good.slice(0);
    new DataView(badVersion).setUint16(4, 99, true);
    expect(() => decodeCellsColumnar(badVersion)).toThrow(/version/);

    expect(() => decodeCellsColumnar(good.slice(0, 40))).toThrow(/too small/);
    expect(() => decodeCellsColumnar(new ArrayBuffer(8))).toThrow(/too small/);
  });
});
