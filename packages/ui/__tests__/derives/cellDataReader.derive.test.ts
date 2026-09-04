import { describe, expect, it } from 'vitest';
import type { SemanticContentSegment } from '@cknerv/types';
import { QUALITATIVE_BUCKET_COLORS } from '../../src/components/hud/hudTheme';
import { contentSegmentAtByte } from '../../src/derives/cellContentMemory.derive';
import {
  READER_BESIDE_CARD_PX,
  READER_BESIDE_MAX_ROWS,
  READER_BYTES_PER_ROW,
  READER_CARD_MARGIN_PX,
  READER_MAX_VISIBLE_ROWS,
  READER_MIN_VISIBLE_ROWS,
  READER_OVERSCAN_ROWS,
  READER_VIEWPORT_ALLOWANCE_PX,
  READER_VISIBLE_ROWS,
  buildSegmentIndex,
  formatReaderInteger,
  formatReaderOffset,
  inspectSelection,
  readerByte,
  readerByteMapBands,
  readerBelowRows,
  readerBesideRows,
  readerKeyStep,
  readerPlacement,
  readerRowWindow,
  readerRowsUnderScan,
  segmentColorSlots,
  segmentLabelHash,
} from '../../src/derives/cellDataReader.derive';
import {
  READER_CHROME_PX,
  READER_ROW_HEIGHT_PX,
} from '../../src/components/hud/CellDataReader';

function segment(
  label: string,
  start: number,
  end: number,
  meaning: string,
  value = '',
): SemanticContentSegment {
  return { label, start_byte: start, end_byte: end, meaning, value };
}

/** The largest payload the staged set holds, and the one every number in this
 *  file's window arithmetic is measured against: 37,314 B of spore, decoded
 *  into a seven-field molecule header and one enormous `content` blob. Labels
 *  and ranges are ckbadger's own, read off the live Cell at
 *  `0xbd5bccf2…#0`. */
const SPORE_37K: SemanticContentSegment[] = [
  segment('total_size', 0, 4, 'Molecule table total size (u32 LE)', '37314'),
  segment('offset_content_type', 4, 8, 'Offset to content_type bytes field', '16'),
  segment('offset_content', 8, 12, 'Offset to content bytes field', '29'),
  segment('offset_cluster_id', 12, 16, 'Offset to optional cluster_id bytes field', '37278'),
  segment('content_type', 20, 29, 'Spore content MIME type', 'image/png'),
  segment('content', 33, 37278, 'Spore binary payload', '37245 bytes'),
  segment('cluster_id', 37282, 37314, 'Cluster id bytes', '0xf02badaa…'),
];
const SPORE_37K_BYTES = 37_314;

/** A second spore, three orders of magnitude apart in size, whose decode uses
 *  the SAME seven labels. Two Cells, one vocabulary — which is exactly the
 *  case the colour rule has to answer identically. */
const SPORE_8K: SemanticContentSegment[] = [
  segment('total_size', 0, 4, 'Molecule table total size (u32 LE)', '8896'),
  segment('offset_content_type', 4, 8, 'Offset to content_type bytes field', '16'),
  segment('offset_content', 8, 12, 'Offset to content bytes field', '81'),
  segment('offset_cluster_id', 12, 16, 'Offset to optional cluster_id bytes field', '8860'),
  segment('content_type', 20, 81, 'Spore content MIME type', 'image/png;ipfs=Qm…'),
  segment('content', 85, 8860, 'Spore binary payload', '8775 bytes'),
  segment('cluster_id', 8864, 8896, 'Cluster id bytes', '0x2438b749…'),
];

const XUDT_89: SemanticContentSegment[] = [
  segment('amount', 0, 16, 'XUDT amount in little-endian u128', '2544240236569'),
  segment('extension_data', 16, 89, 'Additional payload bytes beyond canonical UDT amount', '73 bytes'),
];

const DOTBIT_126: SemanticContentSegment[] = [
  segment('account_hash', 0, 32, 'DAS account hash prefix', '0xf31b05ca…'),
  segment('account_id', 32, 52, 'Unique 20-byte DAS account id', '0xc75d70e0…'),
  segment('next_account_id', 52, 72, 'Linked-list pointer to next account', '0xc75e53ac…'),
  segment('expired_at', 72, 80, 'Account expiration timestamp (seconds)', '2041-11-04T15:16:59+00:00'),
  segment('trailing_payload', 80, 126, 'Remaining bytes in account cell payload', '46 bytes'),
];

const DAO_8: SemanticContentSegment[] = [
  segment('dao_state', 0, 8, 'DAO state marker', 'deposit'),
];

/** FNV-1a, 32-bit, written out again rather than imported.
 *
 *  A test that asks the implementation what it computes and then asserts that
 *  answer has asked nothing. This is the published algorithm — pinned against
 *  its own canonical vectors below — so the expectations in this file are
 *  derived from THE RULE, and a change to the derive's hash fails here instead
 *  of quietly repainting every decoded Cell in the HUD. */
function fnv1a(text: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

/** …and the slot rule on top of it, likewise spelled out: hash `label/meaning`
 *  into the qualitative ramp, walk BYTE order, step one slot on where a
 *  segment would repeat its predecessor's. */
function expectedSlots(segments: readonly SemanticContentSegment[]): number[] {
  const slots = new Array<number>(segments.length).fill(-1);
  const order = segments
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => (
      left.entry.start_byte - right.entry.start_byte
      || left.entry.end_byte - right.entry.end_byte
      || left.entry.label.localeCompare(right.entry.label)
    ));
  let previous = -1;
  for (const { entry, index } of order) {
    const raw = fnv1a(`${entry.label}/${entry.meaning}`)
      % QUALITATIVE_BUCKET_COLORS.length;
    const slot = raw === previous
      ? (raw + 1) % QUALITATIVE_BUCKET_COLORS.length
      : raw;
    slots[index] = slot;
    previous = slot;
  }
  return slots;
}

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

/** `n` little-endian bytes of `value`, the way every integer CKB writes into
 *  Cell data is written. */
function leBytes(value: bigint, width: number): number[] {
  const out: number[] = [];
  let rest = value;
  for (let index = 0; index < width; index += 1) {
    out.push(Number(rest & 0xffn));
    rest >>= 8n;
  }
  return out;
}

describe('the offset gutter', () => {
  it('is five upper-case hex digits wide at every offset a Cell can reach', () => {
    expect(formatReaderOffset(0)).toBe('00000');
    expect(formatReaderOffset(READER_BYTES_PER_ROW * 10)).toBe('000A0');
    expect(formatReaderOffset(0x91c0)).toBe('091C0');
    expect(formatReaderOffset(SPORE_37K_BYTES - 1)).toBe('091C1');

    // Five digits reach 0xFFFFF — a mebibyte — and CKB's block limit keeps
    // every payload far under it, so the gutter never has to grow. The width
    // is the point: every row's offset has to sit in the same columns as the
    // row above it, or the dump shifts sideways mid-scroll.
    const widths = new Set([0, 1, 4095, 0x91c0, 0xfffff]
      .map((offset) => formatReaderOffset(offset).length));
    expect([...widths]).toEqual([5]);
  });
});

describe('the one rule that colours a decoded segment', () => {
  it('hashes the label with FNV-1a and nothing else', () => {
    // The published vectors. If these move, the hash moved, and every Cell in
    // the HUD changed colour.
    expect(segmentLabelHash('')).toBe(0x811c_9dc5);
    expect(segmentLabelHash('a')).toBe(0xe40c_292c);
    expect(segmentLabelHash('foobar')).toBe(0xbf9c_f968);
    expect(segmentLabelHash('content_type/Spore content MIME type'))
      .toBe(fnv1a('content_type/Spore content MIME type'));
  });

  it('gives the same label the same slot on two different Cells', () => {
    // Two spores 28 KB apart, decoded with the same seven labels. A colour
    // that is a fact about the LABEL says the same thing about both; the
    // `index % 6` this replaced would have too, but only because the two
    // records happen to list their segments in the same order — and the
    // portrait's `labelHash % 4` disagreed with both.
    expect(segmentColorSlots(SPORE_8K)).toEqual(segmentColorSlots(SPORE_37K));
    expect(segmentColorSlots(SPORE_37K)).toEqual(expectedSlots(SPORE_37K));
  });

  it('never lets two neighbouring segments share a slot', () => {
    const slots = segmentColorSlots(SPORE_37K);
    const neighbours = slots
      .slice(1)
      .map((slot, index) => (slot === slots[index] ? index : -1))
      .filter((index) => index >= 0);
    expect(neighbours).toEqual([]);

    // …and the step really fired here rather than the hash happening to be
    // kind: `total_size` and `offset_content_type` both hash to slot 5, and
    // the second one moved.
    const raw = SPORE_37K.map((entry) => (
      fnv1a(`${entry.label}/${entry.meaning}`) % QUALITATIVE_BUCKET_COLORS.length
    ));
    expect(raw[0]).toBe(raw[1]);
    expect(slots[0]).toBe(raw[0]);
    expect(slots[1]).toBe((raw[1] + 1) % QUALITATIVE_BUCKET_COLORS.length);
  });

  it('answers the same for a record listed in any order', () => {
    // The DATA window hands over the record's own order, the portrait sorts by
    // byte first, and the reader hands over the record's order again. One rule
    // means one answer per segment whichever way it is asked, so the rule
    // walks byte order internally and returns slots at the CALLER's indices.
    const shuffled = [4, 0, 6, 2, 5, 1, 3].map((index) => SPORE_37K[index]);
    const shuffledSlots = segmentColorSlots(shuffled);
    const straightSlots = segmentColorSlots(SPORE_37K);
    expect(shuffled.map((entry, index) => [entry.label, shuffledSlots[index]]))
      .toEqual([4, 0, 6, 2, 5, 1, 3]
        .map((index) => [SPORE_37K[index].label, straightSlots[index]]));
  });

  it('hands out slots the qualitative ramp actually has', () => {
    for (const record of [SPORE_37K, XUDT_89, DOTBIT_126, DAO_8]) {
      const slots = segmentColorSlots(record);
      expect(slots).toHaveLength(record.length);
      expect(slots).toEqual(expectedSlots(record));
      expect(slots.filter((slot) => (
        !Number.isInteger(slot)
        || slot < 0
        || slot >= QUALITATIVE_BUCKET_COLORS.length
      ))).toEqual([]);
    }
    expect(segmentColorSlots([])).toEqual([]);
  });
});

describe('which segment owns a byte', () => {
  it('maps every mapped byte and leaves the rest at −1', () => {
    const index = buildSegmentIndex(XUDT_89, 89);

    expect(index).toBeInstanceOf(Int16Array);
    expect(index).toHaveLength(89);
    expect(index[0]).toBe(0);
    expect(index[15]).toBe(0);
    expect(index[16]).toBe(1);
    expect(index[88]).toBe(1);

    // The spore's molecule padding is real payload no segment names, and the
    // reader draws it in ink rather than pretending it is not there.
    const spore = buildSegmentIndex(SPORE_37K, SPORE_37K_BYTES);
    expect([...spore.slice(16, 20)]).toEqual([-1, -1, -1, -1]);
    expect(spore[20]).toBe(4);
    expect(spore[37_281]).toBe(-1);
    expect(spore[37_282]).toBe(6);
  });

  it('gives an overlapped byte to the first segment that claims it', () => {
    // The same overlap `contentSegmentAtByte` already resolves, and it has to
    // resolve the same way: the DATA window asks that function per byte, the
    // reader asks this index, and a Cell whose two surfaces disagreed about
    // which decode owns byte 0 would be the defect this file exists to close.
    const overlapping = [
      segment('body', 0, 5, 'printable body', 'Hello'),
      segment('terminator', 5, 6, 'zero terminator', '0'),
      segment('whole_value', 0, 6, 'alternate deterministic view', 'Hello\\0'),
    ];
    const index = buildSegmentIndex(overlapping, 6);

    expect([...index]).toEqual([0, 0, 0, 0, 0, 1]);
    expect([...index]).toEqual(
      Array.from({ length: 6 }, (_, byte) => contentSegmentAtByte(overlapping, byte) ?? -1),
    );
  });

  it('never runs past the bytes it was given', () => {
    // A record whose decode claims more bytes than the Cell holds is a record
    // the morphology validator rejects — but the index is handed segments and
    // a length by three different callers, so it clamps rather than trusting.
    const index = buildSegmentIndex([segment('over', 4, 999, 'past the end')], 8);
    expect([...index]).toEqual([-1, -1, -1, -1, 0, 0, 0, 0]);
    expect(buildSegmentIndex(SPORE_37K, 0)).toHaveLength(0);
  });
});

describe('the rows the dump mounts', () => {
  const ROW_HEIGHT = 13.5;
  const window = (scrollTop: number) => readerRowWindow(
    scrollTop,
    ROW_HEIGHT,
    SPORE_37K_BYTES,
    READER_VISIBLE_ROWS,
    READER_OVERSCAN_ROWS,
  );

  it('sizes the spacer from the payload and not from the prefix in hand', () => {
    // 37,314 B is 2,333 rows whether or not the node has answered yet: the
    // scrollbar tells the truth about the Cell, and the rows past the held
    // prefix are drawn as ghosts.
    expect(window(0).rowCount)
      .toBe(Math.ceil(SPORE_37K_BYTES / READER_BYTES_PER_ROW));
    expect(window(0).rowCount).toBe(2333);
  });

  it('mounts the viewport and one overscan band on each side, and no more', () => {
    expect(window(0)).toEqual({ firstRow: 0, lastRow: 40, rowCount: 2333 });

    const middle = window(1000 * ROW_HEIGHT);
    expect(middle.firstRow).toBe(1000 - READER_OVERSCAN_ROWS);
    expect(middle.lastRow - middle.firstRow)
      .toBe(READER_VISIBLE_ROWS + READER_OVERSCAN_ROWS * 2);
  });

  it('stops at the last row instead of mounting rows that do not exist', () => {
    const bottom = window((2333 - READER_VISIBLE_ROWS) * ROW_HEIGHT);
    expect(bottom.firstRow).toBe(2333 - READER_VISIBLE_ROWS - READER_OVERSCAN_ROWS);
    expect(bottom.lastRow).toBe(2333);

    // A browser that overscrolls, or a stale `scrollTop` after the payload
    // shrank, still lands on a row that is there.
    const past = window(1e9);
    expect(past.firstRow).toBe(2332);
    expect(past.lastRow).toBe(2333);
  });

  it('has nothing to mount for a Cell with no data', () => {
    expect(readerRowWindow(0, ROW_HEIGHT, 0, READER_VISIBLE_ROWS, READER_OVERSCAN_ROWS))
      .toEqual({ firstRow: 0, lastRow: 0, rowCount: 0 });
  });
});

describe('one byte, in the two columns a dump prints it in', () => {
  it('spells the hex in two digits and the text in one printable character', () => {
    expect(readerByte(0x00)).toEqual({ hex: '00', ascii: '·', printable: false });
    expect(readerByte(0x0f)).toEqual({ hex: '0F', ascii: '·', printable: false });
    expect(readerByte(0x20)).toEqual({ hex: '20', ascii: ' ', printable: true });
    expect(readerByte(0x41)).toEqual({ hex: '41', ascii: 'A', printable: true });
    expect(readerByte(0x7e)).toEqual({ hex: '7E', ascii: '~', printable: true });
  });

  it('draws no letter for a byte that is not text', () => {
    // `0x7F` is DEL and `0xE9` is the middle of a UTF-8 sequence, not `é`. A
    // dump that rendered high bytes as Latin-1 would be inventing a text the
    // Cell does not contain — the inspector's UTF-8 field is where a reader
    // asks that question, over a range they chose.
    expect(readerByte(0x7f).printable).toBe(false);
    expect(readerByte(0xe9)).toEqual({ hex: 'E9', ascii: '·', printable: false });
    expect(readerByte(0xff)).toEqual({ hex: 'FF', ascii: '·', printable: false });
  });
});

describe('the selection, read as one number and as text', () => {
  it('reads a UDT amount as the little-endian u128 the standard writes', () => {
    const amount = bytes(...leBytes(1000n, 16));
    const reading = inspectSelection(amount, 0, 16, buildSegmentIndex(XUDT_89, 16));

    expect(amount[0]).toBe(0xe8);
    expect(amount[1]).toBe(0x03);
    expect(reading.integer).toBe(1000n);
    expect(formatReaderInteger(reading.integer ?? 0n)).toBe('1,000');
    expect(reading.offset).toBe(0);
    expect(reading.length).toBe(16);
    expect(reading.segment).toBe(0);
  });

  it('reads a DAO cell as the u64 its eight bytes are', () => {
    const dao = bytes(...leBytes(12_345_678n, 8));
    const reading = inspectSelection(dao, 0, 8, buildSegmentIndex(DAO_8, 8));

    // Eight bytes selected is a u64 asked for, and the ONE number it gets is
    // that one. The u8, u16 and u32 that used to be printed beside it read the
    // same offset at widths nobody chose (R2-3).
    expect(reading.integer).toBe(12_345_678n);
    expect(reading.length).toBe(8);
    expect(reading.segment).toBe(0);
  });

  it('follows the width the reader selected, not a fixed ladder', () => {
    // The whole of R2-3 in three lines: the same bytes, three selections,
    // three different numbers — each one the width that was asked for.
    const amount = bytes(...leBytes(2_544_240_236_569n, 16));
    const index = buildSegmentIndex(XUDT_89, 16);

    expect(inspectSelection(amount, 0, 1, index).integer).toBe(0x19n);
    expect(inspectSelection(amount, 0, 4, index).integer).toBe(0x6089_1819n);
    expect(inspectSelection(amount, 0, 16, index).integer)
      .toBe(2_544_240_236_569n);
    expect(formatReaderInteger(inspectSelection(amount, 0, 16, index).integer ?? 0n))
      .toBe('2,544,240,236,569');
  });

  it('reads a width no fixed size covers, because there are no fixed sizes', () => {
    const nine = bytes(1, 2, 3, 4, 5, 6, 7, 8, 9);
    const reading = inspectSelection(nine, 0, 9, new Int16Array(9).fill(-1));

    expect(reading.length).toBe(9);
    expect(reading.integer).toBe(166_599_134_359_138_271_745n);
    expect(reading.segment).toBeNull();
  });

  it('stops reading a selection as a number past sixteen bytes', () => {
    // u128 is the widest number CKB writes anywhere, and a spore's `content`
    // is not an integer however hard the arithmetic tries.
    const long = bytes(...new Array<number>(17).fill(0xff));
    expect(inspectSelection(long, 0, 16, new Int16Array(17).fill(-1)).integer)
      .toBe((1n << 128n) - 1n);
    expect(inspectSelection(long, 0, 17, new Int16Array(17).fill(-1)).integer)
      .toBeNull();
  });

  it('shows text as text, and everything that is not text as one mark', () => {
    const text = bytes(0x69, 0x6d, 0x61, 0x67, 0x65, 0x2f, 0x70, 0x6e, 0x67);
    expect(inspectSelection(text, 0, 9, new Int16Array(9).fill(-1)).utf8)
      .toBe('image/png');

    // A control byte, a DEL and a byte that is no valid UTF-8 sequence all
    // collapse to the interpunct — a segment full of zero padding has to read
    // as padding rather than as an empty string.
    const mixed = bytes(0x4f, 0x4b, 0x00, 0x09, 0x7f, 0xff, 0x21);
    expect(inspectSelection(mixed, 0, 7, new Int16Array(7).fill(-1)).utf8)
      .toBe('OK····!');
  });

  it('has no direction: the anchor may be either end', () => {
    const payload = bytes(...leBytes(1000n, 16));
    const index = buildSegmentIndex(XUDT_89, 16);
    expect(inspectSelection(payload, 12, 4, index))
      .toEqual(inspectSelection(payload, 4, 12, index));
    expect(inspectSelection(payload, 12, 4, index).offset).toBe(4);
    expect(inspectSelection(payload, 12, 4, index).length).toBe(8);
  });

  it('says nothing it cannot read off the bytes it was handed', () => {
    const two = bytes(0x01, 0x02);
    // A selection wider than the payload is clamped to the payload, so what
    // comes back is the two bytes there are rather than a read past the end.
    expect(inspectSelection(two, 0, 8, new Int16Array(2).fill(-1)).length).toBe(2);
    expect(inspectSelection(two, 0, 8, new Int16Array(2).fill(-1)).integer)
      .toBe(0x0201n);

    // Zero bytes are not the number zero: `LE 0` is a value some Cell really
    // holds, and a caret with nothing under it has not read one.
    const empty = inspectSelection(new Uint8Array(0), 0, 0, new Int16Array(0));
    expect(empty).toEqual({
      offset: 0, length: 0, segment: null, integer: null, utf8: '',
    });
  });
});

describe('the byte map', () => {
  const HEIGHT = 324;

  it('draws every segment the decode found, however small its share', () => {
    const slots = segmentColorSlots(SPORE_37K);
    const bands = readerByteMapBands(SPORE_37K, slots, SPORE_37K_BYTES, HEIGHT);

    expect(bands).toHaveLength(SPORE_37K.length);
    // `cluster_id` is 32 bytes at the end of 37,314 — 0.28 px at this height,
    // which rounds to nothing. A segment the decode FOUND has to appear.
    const clusterId = bands[bands.length - 1];
    expect(clusterId.y1 - clusterId.y0).toBeGreaterThanOrEqual(1);
    expect(clusterId.y1).toBe(HEIGHT);
    expect(bands.filter((band) => band.y1 - band.y0 < 1)).toEqual([]);
  });

  it('keeps every band on the map', () => {
    const slots = segmentColorSlots(SPORE_37K);
    const bands = readerByteMapBands(SPORE_37K, slots, SPORE_37K_BYTES, HEIGHT);

    expect(bands.filter((band) => (
      band.y0 < 0 || band.y1 > HEIGHT || band.y0 >= band.y1
    ))).toEqual([]);
  });

  it('is a scale drawing: the blob is the map and the header is the first pixel', () => {
    const slots = segmentColorSlots(SPORE_37K);
    const bands = readerByteMapBands(SPORE_37K, slots, SPORE_37K_BYTES, HEIGHT);
    const content = bands[5];

    // 37,245 of 37,314 bytes. A reader glancing at this should see one
    // enormous blob with a tail, not seven tidy stripes implying seven
    // comparable parts.
    expect(content.y1 - content.y0).toBeGreaterThan(HEIGHT * 0.99);
    expect(bands[0]).toEqual({ y0: 0, y1: 1, slot: slots[0] });
  });

  it('comes back in byte order, wearing the shared slots', () => {
    const shuffled = [6, 3, 0, 5, 1, 4, 2].map((index) => SPORE_37K[index]);
    const slots = segmentColorSlots(shuffled);
    const bands = readerByteMapBands(shuffled, slots, SPORE_37K_BYTES, HEIGHT);

    expect(bands.map((band) => band.y0))
      .toEqual([...bands.map((band) => band.y0)].sort((a, b) => a - b));
    expect(bands.map((band) => band.slot))
      .toEqual(segmentColorSlots(SPORE_37K));
  });

  it('draws nothing where there is nothing to draw', () => {
    expect(readerByteMapBands(SPORE_37K, segmentColorSlots(SPORE_37K), 0, HEIGHT))
      .toEqual([]);
    expect(readerByteMapBands(SPORE_37K, segmentColorSlots(SPORE_37K), SPORE_37K_BYTES, 0))
      .toEqual([]);
    expect(readerByteMapBands([], [], SPORE_37K_BYTES, HEIGHT)).toEqual([]);
  });
});

describe('the key map', () => {
  it('moves the caret by a byte, a row and a page', () => {
    expect(readerKeyStep('ArrowLeft', READER_VISIBLE_ROWS)).toBe(-1);
    expect(readerKeyStep('ArrowRight', READER_VISIBLE_ROWS)).toBe(1);
    expect(readerKeyStep('ArrowUp', READER_VISIBLE_ROWS)).toBe(-READER_BYTES_PER_ROW);
    expect(readerKeyStep('ArrowDown', READER_VISIBLE_ROWS)).toBe(READER_BYTES_PER_ROW);
    expect(readerKeyStep('PageDown', READER_VISIBLE_ROWS))
      .toBe(READER_BYTES_PER_ROW * READER_VISIBLE_ROWS);
    expect(readerKeyStep('PageUp', 8)).toBe(-READER_BYTES_PER_ROW * 8);
    expect(readerKeyStep('Home', READER_VISIBLE_ROWS)).toBe('home');
    expect(readerKeyStep('End', READER_VISIBLE_ROWS)).toBe('end');
  });

  it('never turns a page into a no-op', () => {
    // A PageDown that moves nothing reads as a key the reader swallowed.
    expect(readerKeyStep('PageDown', 0)).toBe(READER_BYTES_PER_ROW);
    expect(readerKeyStep('PageDown', -4)).toBe(READER_BYTES_PER_ROW);
  });

  it('claims no key it does not own — Shift included', () => {
    // Whether a step MOVES the caret or EXTENDS the selection from the anchor
    // is a fact about the reader's selection state, not about the key. The map
    // is not told about modifiers and cannot be; the caller reads
    // `event.shiftKey` and decides, and Shift's own keydown does nothing.
    expect(readerKeyStep('Shift', READER_VISIBLE_ROWS)).toBeNull();
    expect(readerKeyStep('Tab', READER_VISIBLE_ROWS)).toBeNull();
    expect(readerKeyStep('Escape', READER_VISIBLE_ROWS)).toBeNull();
    expect(readerKeyStep('a', READER_VISIBLE_ROWS)).toBeNull();
    expect(readerKeyStep('', READER_VISIBLE_ROWS)).toBeNull();
  });
});

describe('the integers the strip prints', () => {
  it('groups them, in one locale, with an ASCII comma', () => {
    // Pinned to `en-US` for the reason the rest of the card's formatters pin
    // it: grouping drifts with the viewer's runtime, and several locales group
    // with a narrow no-break space that no shipped face carries.
    expect(formatReaderInteger(1000)).toBe('1,000');
    expect(formatReaderInteger(0)).toBe('0');
    expect(formatReaderInteger(255)).toBe('255');
    expect(formatReaderInteger(2_544_240_236_569n)).toBe('2,544,240,236,569');
    expect(formatReaderInteger(1000).includes(',')).toBe(true);
    expect(formatReaderInteger(1000).codePointAt(1)).toBe(0x2c);
  });

  it('never answers a question about a field with an exponent', () => {
    const maxU128 = (1n << 128n) - 1n;
    expect(formatReaderInteger(maxU128))
      .toBe('340,282,366,920,938,463,463,374,607,431,768,211,455');
    expect(formatReaderInteger(1e21)).not.toContain('e');
    expect(formatReaderInteger(maxU128).replaceAll(',', ''))
      .toBe(maxU128.toString());
  });
});

// ——— How tall the reader is ——————————————————————————————————————————————
//
// M5 (2026-09-04) measured the reader as a full-width row under the card and
// found the card 1,348 px tall in the app's own 1600×1100 window: the analysis
// plate of a full spore dossier is ~910 px on its own, so the row began at the
// fold, most of it sat below it, and nothing on the page scrolls. M4c stood it
// beside the plate instead. The user's ruling of 2026-09-05 moves it again and
// for good: it stands UNDER the 280 px CELL SCAN square, always, and its bottom
// is the plate's bottom — so the dump is what the plate leaves after the square
// and the reader's own chrome.

/** The plate M5 measured, and the one every number here is taken against. */
const SPORE_PLATE_PX = 910;

/** The square and the seam over the reader, which the PANEL hands in
 *  (`PORTRAIT_COLUMN_PX + CARD_SEAM_PX`). Restated here rather than imported
 *  because importing the 2,400-line card into a derive's test to borrow two
 *  integers is what the derive itself refuses to do. */
const ABOVE_READER_PX = 288;

describe('readerRowsUnderScan', () => {
  it('gives the dump what the plate leaves under the square', () => {
    // The ruling as arithmetic. Everything above the reader belongs to the
    // specimen square; everything the reader is not a row of bytes is its
    // chrome; the rest is dump, and the reader can never be taller than the
    // plate beside it.
    const rows = readerRowsUnderScan(
      SPORE_PLATE_PX,
      ABOVE_READER_PX,
      READER_CHROME_PX,
      READER_ROW_HEIGHT_PX,
    );
    expect(rows).toBe(Math.floor(
      (SPORE_PLATE_PX - ABOVE_READER_PX - READER_CHROME_PX) / READER_ROW_HEIGHT_PX,
    ));
    expect(ABOVE_READER_PX + READER_CHROME_PX + rows * READER_ROW_HEIGHT_PX)
      .toBeLessThanOrEqual(SPORE_PLATE_PX);
  });

  it('reads the three dossiers the plan measured', () => {
    // A spore's plate with its segment rows, an identity dossier, and a bare
    // CKB-only card. R2-c measures all three live; these are the arithmetic
    // those measurements will be checked against.
    const rowsAt = (plate: number) => readerRowsUnderScan(
      plate,
      ABOVE_READER_PX,
      READER_CHROME_PX,
      READER_ROW_HEIGHT_PX,
    );
    expect(rowsAt(905)).toBe(41);
    expect(rowsAt(800)).toBe(33);
    expect(rowsAt(470)).toBe(8);
    // Every row is sixteen bytes, which is the number a reader actually cares
    // about: a spore dossier stands 656 B of payload at once.
    expect(rowsAt(905) * READER_BYTES_PER_ROW).toBe(656);
  });

  it('answers an unmeasured plate with the declared count, not with the floor', () => {
    // Zero is "nobody has laid this out yet" — the frame before the
    // ResizeObserver's first callback, and every jsdom test — and not a plate
    // of no height.
    expect(rowsUnderScan(0)).toBe(READER_VISIBLE_ROWS);
    expect(rowsUnderScan(Number.NaN)).toBe(READER_VISIBLE_ROWS);
  });

  it('keeps the floor under a short plate and the valve over a tall one', () => {
    // Six rows is the user's R2-5 ruling: a bare card's plate leaves about
    // 120 px, and a floor of eight over it would make the reader taller than
    // the space it was given — the one thing this placement exists to prevent.
    expect(rowsUnderScan(ABOVE_READER_PX + READER_CHROME_PX + 40))
      .toBe(READER_MIN_VISIBLE_ROWS);
    expect(READER_MIN_VISIBLE_ROWS).toBe(6);
    expect(rowsUnderScan(4000)).toBe(READER_MAX_VISIBLE_ROWS);
    expect(READER_MAX_VISIBLE_ROWS * READER_BYTES_PER_ROW).toBe(1024);
  });
});

/** The reader's own rows against a plate, with the card's numbers fixed. */
function rowsUnderScan(plateHeightPx: number): number {
  return readerRowsUnderScan(
    plateHeightPx,
    ABOVE_READER_PX,
    READER_CHROME_PX,
    READER_ROW_HEIGHT_PX,
  );
}

describe('readerPlacement', () => {
  it('gives the reader its own column exactly when the wider card fits', () => {
    // The card is `min(1396, 100vw - 28)` wide, so the column fits when the
    // window has 1,396 px left after its own margin — one pixel under that and
    // the card would be squeezed by its `maxWidth` and the 660 column would
    // start eating the analysis plate.
    expect(READER_BESIDE_CARD_PX).toBe(1396);
    expect(readerPlacement(1024)).toBe('below');
    expect(readerPlacement(1423)).toBe('below');
    expect(readerPlacement(1424)).toBe('beside');
    expect(readerPlacement(1920)).toBe('beside');
    expect(READER_BESIDE_CARD_PX + READER_CARD_MARGIN_PX).toBe(1424);
  });

  it('asks about whatever card it is handed, and answers nothing on a nonsense window', () => {
    expect(readerPlacement(1024, 800)).toBe('beside');
    expect(readerPlacement(Number.NaN)).toBe('below');
  });
});

describe('readerBesideRows (M4c, on its way out)', () => {
  it('is the same arithmetic with nothing above the reader', () => {
    // "Beside" meant the reader started at the plate's top edge instead of
    // under a 288 px square, which is `readerRowsUnderScan` with `above` = 0.
    // Stated as a delegation rather than as a second copy, so the floor, the
    // ceiling and the unmeasured-plate answer cannot disagree between the
    // placement that is leaving and the one arriving. R2-b takes the panel off
    // this and the function goes with the call.
    for (const plate of [0, Number.NaN, 200, SPORE_PLATE_PX, 4000]) {
      expect(readerBesideRows(plate, READER_CHROME_PX, READER_ROW_HEIGHT_PX))
        .toBe(readerRowsUnderScan(plate, 0, READER_CHROME_PX, READER_ROW_HEIGHT_PX));
    }
    expect(READER_BESIDE_MAX_ROWS).toBe(READER_MAX_VISIBLE_ROWS);
  });
});

describe('readerBelowRows', () => {
  it('is the M5 finding as arithmetic', () => {
    // 1,100 px of window, 910 of plate, the reader's chrome and the room the
    // card never had: nothing is left, and the fallback settles at its floor
    // instead of mounting 24 rows below the fold.
    expect(readerBelowRows(1100, SPORE_PLATE_PX, READER_CHROME_PX, READER_ROW_HEIGHT_PX))
      .toBe(READER_MIN_VISIBLE_ROWS);
    // A window tall enough for a row under that plate gets one.
    expect(readerBelowRows(1800, SPORE_PLATE_PX, READER_CHROME_PX, READER_ROW_HEIGHT_PX))
      .toBe(READER_VISIBLE_ROWS);
  });

  it('falls back to the old allowance while the plate is unmeasured', () => {
    expect(readerBelowRows(768, 0, READER_CHROME_PX, READER_ROW_HEIGHT_PX))
      .toBe(Math.floor((768 - READER_VIEWPORT_ALLOWANCE_PX) / READER_ROW_HEIGHT_PX));
    expect(readerBelowRows(768, 0, READER_CHROME_PX, READER_ROW_HEIGHT_PX)).toBe(18);
    expect(readerBelowRows(4000, 0, READER_CHROME_PX, READER_ROW_HEIGHT_PX))
      .toBe(READER_VISIBLE_ROWS);
    expect(readerBelowRows(120, 0, READER_CHROME_PX, READER_ROW_HEIGHT_PX))
      .toBe(READER_MIN_VISIBLE_ROWS);
  });
});
