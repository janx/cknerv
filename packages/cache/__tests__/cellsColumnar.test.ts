import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Cell, CellGalaxySnapshot, ScriptId } from '@cknerv/types';
import { DATA_HEX_TRUNCATION_MARKER } from '@cknerv/types';
import {
  CELLS_COLUMNAR_HEADER_BYTES,
  CELLS_COLUMNAR_NO_SCRIPT,
  CELLS_COLUMNAR_NO_TAG,
  CELLS_COLUMNAR_REVISION_OFFSET,
  CELLS_COLUMNAR_VERSION,
  cellsSnapshotFromColumnar,
  columnarCellAt,
  decodeCellsColumnar,
} from '../src/cellsColumnar';

/** The very bytes the Rust encoder produced. Both sides read this one file,
 *  so a layout change that lands on only one of them fails on both — which
 *  a hand-rolled TS encoder here could never catch, because it would drift
 *  along with whichever reading its author had. Regenerate with
 *  `CKNERV_REGEN_FIXTURES=1 cargo test -p cknerv-core columnar_v3`. */
function fixtureBytes(name: string): ArrayBuffer {
  const path = fileURLToPath(new URL(`../../../tests/fixtures/${name}`, import.meta.url));
  const bytes = readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function fixture(): ArrayBuffer {
  return fixtureBytes('cells_columnar_v3.bin');
}

const FIXTURE_LOCK: ScriptId = {
  code_hash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',
  hash_type: 'type',
};
const FIXTURE_TYPE: ScriptId = {
  code_hash: '0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95',
  hash_type: 'data1',
};

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
    expect(CELLS_COLUMNAR_VERSION).toBe(3);
    expect(CELLS_COLUMNAR_HEADER_BYTES).toBe(72);
    expect(view.lastPulseAtMs).toBe(777);
    expect(view.totalBirths).toBe(30);
    expect(view.totalDeaths).toBe(11);
    expect(view.cellCount).toBe(3);
    expect(view.residentCount).toBe(1);
    expect(view.rowCount).toBe(4);
  });

  /** The server patches the revision into the header AFTER the projection
   *  encoded it (`projection_registry.rs`), by absolute offset. A header
   *  reshuffle that moved the field without moving the constant would hand
   *  every reconnect a `?since=` cursor read out of another field, silently
   *  — so pin the offset itself, not just that some revision decodes. */
  it('reads the revision from the offset the server patches', () => {
    const patched = fixture();
    new DataView(patched).setBigUint64(
      CELLS_COLUMNAR_REVISION_OFFSET,
      9_007_199_254_740_991n,
      true,
    );
    expect(decodeCellsColumnar(patched).revision).toBe(9_007_199_254_740_991);
    // Every other header field must be untouched by that write.
    expect(decodeCellsColumnar(patched).lastPulseAtMs).toBe(777);
    expect(decodeCellsColumnar(fixture()).revision).toBe(0);
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

  /** Script identity is dictionary-encoded: two rows under the same lock
   *  share one entry, and a cell without one carries no key at all — which is
   *  what the JSON path emits and what `cellContentEquals` compares. */
  it('resolves script identity through the dictionary', () => {
    const view = decodeCellsColumnar(fixture());
    expect(view.scripts).toEqual([FIXTURE_LOCK, FIXTURE_TYPE]);
    expect(Array.from(view.lockScriptRef)).toEqual([1, 1, CELLS_COLUMNAR_NO_SCRIPT, CELLS_COLUMNAR_NO_SCRIPT]);
    expect(Array.from(view.typeScriptRef)).toEqual([CELLS_COLUMNAR_NO_SCRIPT, 2, CELLS_COLUMNAR_NO_SCRIPT, CELLS_COLUMNAR_NO_SCRIPT]);

    const lockOnly = columnarCellAt(view, 0);
    expect(lockOnly.lock_script).toEqual(FIXTURE_LOCK);
    expect('type_script' in lockOnly).toBe(false);

    const both = columnarCellAt(view, 1);
    expect(both.lock_script).toEqual(FIXTURE_LOCK);
    expect(both.type_script).toEqual(FIXTURE_TYPE);
    // One object per distinct script, shared by every row that carries it.
    expect(both.lock_script).toBe(lockOnly.lock_script);

    const unscripted = columnarCellAt(view, 2);
    expect('lock_script' in unscripted).toBe(false);
    expect('type_script' in unscripted).toBe(false);
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

  /** A snapshot with no display plane at all. The encoder still writes the
   *  18-byte provenance placeholder, so a decoder that consumed it only when
   *  a plane is present would read the trailing sections length out of the
   *  middle of it — the rows would decode and the tail would be garbage. */
  it('reads a snapshot whose display plane is absent', () => {
    const view = decodeCellsColumnar(fixtureBytes('cells_columnar_v3_absent.bin'));
    expect(view.display).toBeNull();
    expect(view.cellCount).toBe(3);
    expect(view.residentCount).toBe(0);
    expect(columnarCellAt(view, 0)).toMatchObject(expectedCell(1, 'wallet'));
    expect(view.scripts).toEqual([FIXTURE_LOCK, FIXTURE_TYPE]);
    // The tail past the placeholder still parses — that is the whole point.
    expect(view.recentLinks).toEqual([]);
    expect(view.backfill).toBeNull();
    expect(cellsSnapshotFromColumnar(view).display).toBeUndefined();
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

    // v2 is not read either: rust-embed ships the client with the server, so
    // the only way to see one is a proxy serving a different build, and a
    // JSON fallback beats a buffer read against the wrong layout.
    const oldVersion = good.slice(0);
    new DataView(oldVersion).setUint16(4, 2, true);
    expect(() => decodeCellsColumnar(oldVersion)).toThrow(/unsupported version 2/);

    expect(() => decodeCellsColumnar(good.slice(0, 40))).toThrow(/too small/);
    expect(() => decodeCellsColumnar(new ArrayBuffer(8))).toThrow(/too small/);
  });
});

// ── THE differential gate ────────────────────────────────────────────
// One galaxy, serialized by the server twice: `cells_columnar_v3_pair.json`
// through serde, `cells_columnar_v3_pair.bin` through the columnar encoder
// (`cells.rs::columnar_v3_pair_describes_one_galaxy_in_both_wire_forms`).
// Decoding the binary one HERE, through the very path production uses, and
// diffing every field of every cell against the JSON one is the only check
// that spans the language boundary AND the decoder. Rust's own
// encoder-vs-encoder test cannot see a column the decoder never reads; that
// is how v2 shipped without script identity, and how a non-ASCII value in a
// string column shipped as a panic.

/** Completeness anchor: one entry per `Cell` field, mirroring
 *  `cellsReducer.ts`'s `comparedCellFields`. A new field on `Cell` fails
 *  typecheck here until the gate is taught to diff it, so it cannot escape
 *  the comparison by being forgotten. */
const diffedCellFields = {
  id: true,
  born_at_ms: true,
  death_at_ms: true,
  birth_block: true,
  tag: true,
  pos_seed: true,
  out_point: true,
  capacity: true,
  data_hex: true,
  content_hash: true,
  lock_kind: true,
  asset_kind: true,
  lock_script: true,
  type_script: true,
} as const satisfies Record<keyof Cell, true>;

const CELL_FIELDS = Object.keys(diffedCellFields) as (keyof Cell)[];

/** Every field of every cell, as `{path: value}` — deep-equality on the whole
 *  object would report "these two cells differ" and leave the reader to find
 *  out where. Absent and undefined are the same thing here on purpose: the
 *  JSON path omits an unset script, and so does the decoder. */
function cellFieldEntries(label: string, cells: readonly Cell[]): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  cells.forEach((cell, index) => {
    for (const field of CELL_FIELDS) {
      if (cell[field] !== undefined) flat[`${label}[${index}].${field}`] = cell[field];
    }
  });
  return flat;
}

describe('decode(BIN) ≡ JSON', () => {
  function pair(): { fromBin: CellGalaxySnapshot; fromJson: CellGalaxySnapshot } {
    const fromBin = cellsSnapshotFromColumnar(
      decodeCellsColumnar(fixtureBytes('cells_columnar_v3_pair.bin')),
    );
    const fromJson = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL('../../../tests/fixtures/cells_columnar_v3_pair.json', import.meta.url),
        ),
        'utf8',
      ),
    ) as CellGalaxySnapshot;
    return { fromBin, fromJson };
  }

  /** A vacuous gate is worse than none: if the fixture ever stops carrying
   *  the shapes below, this fails before the diff can pass by default. */
  it('the fixture carries the shapes the gate exists to compare', () => {
    const { fromJson } = pair();
    const all = [...fromJson.cells, ...(fromJson.display?.residents ?? [])];
    expect(all.length).toBeGreaterThanOrEqual(6);
    expect(all.some((c) => c.lock_script && !c.type_script)).toBe(true);
    expect(all.some((c) => c.lock_script && c.type_script)).toBe(true);
    expect(all.some((c) => !c.lock_script && !c.type_script)).toBe(true);
    expect(all.some((c) => c.death_at_ms !== null)).toBe(true);
    expect(all.some((c) => c.tag !== null)).toBe(true);
    expect(all.some((c) => c.data_hex.endsWith(DATA_HEX_TRUNCATION_MARKER))).toBe(true);
    expect(fromJson.display?.residents.length).toBeGreaterThan(0);
  });

  it('agrees field by field on every canonical cell', () => {
    const { fromBin, fromJson } = pair();
    expect(fromBin.cells).toHaveLength(fromJson.cells.length);
    expect(cellFieldEntries('cells', fromBin.cells))
      .toEqual(cellFieldEntries('cells', fromJson.cells));
  });

  it('agrees field by field on every staged resident', () => {
    const { fromBin, fromJson } = pair();
    const binResidents = fromBin.display?.residents ?? [];
    const jsonResidents = fromJson.display?.residents ?? [];
    expect(binResidents).toHaveLength(jsonResidents.length);
    expect(cellFieldEntries('residents', binResidents))
      .toEqual(cellFieldEntries('residents', jsonResidents));
  });

  /** The non-row half of the same snapshot: counters, the display section and
   *  the JSON tail. `backfill` is compared through `?? null` because the JSON
   *  path omits the key while the tail spells it null — the reducer reads
   *  both as "no replay in progress". */
  it('agrees on the sections that are not rows', () => {
    const { fromBin, fromJson } = pair();
    expect(fromBin.last_pulse_at_ms).toBe(fromJson.last_pulse_at_ms);
    expect(fromBin.total_births).toBe(fromJson.total_births);
    expect(fromBin.total_deaths).toBe(fromJson.total_deaths);
    expect(fromBin.recent_links).toEqual(fromJson.recent_links);
    expect(fromBin.stats).toEqual(fromJson.stats);
    expect(fromBin.backfill ?? null).toEqual(fromJson.backfill ?? null);
    expect(fromBin.display?.budget).toEqual(fromJson.display?.budget);
    expect(fromBin.display?.members).toEqual(fromJson.display?.members);
    expect(fromBin.display?.provenance).toEqual(fromJson.display?.provenance);
  });
});
