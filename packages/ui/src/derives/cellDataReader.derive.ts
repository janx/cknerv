// The arithmetic behind DATA READER (SCAN·03), written before the reader that
// spends it. Everything here is a pure function of numbers the caller already
// holds — bytes, a scroll offset, a row height, a segment list — because the
// surface that will read it lives in jsdom for its tests and has no layout:
// a virtualiser that asks `getBoundingClientRect` what row it is on cannot be
// driven by a test, and a reader that cannot be driven by a test is a reader
// nobody can pin.
//
// It also settles a disagreement that was already shipping. The DATA cluster
// and the portrait's byte rail both colour the SAME decoded segments, and they
// did it two different ways: the DOM window took `index % 6` off the
// qualitative ramp (position in the record's list), the overlay took
// `labelHash % 4` (a hash of the label, into four of the ramp's six slots). So
// one Cell's `content_type` was slot 4 in the window and slot 1 on the
// portrait, and a reader moving their eye between the two surfaces was reading
// two different claims about the same bytes. There is one rule now and it
// lives here, where a third surface — the reader itself — can ask it too.

import type { SemanticContentSegment } from '@cknerv/types';
import { QUALITATIVE_BUCKET_COLORS } from '../components/hud/hudTheme';

/** The dump's row, in bytes. Sixteen is what a hex dump has been since `od`,
 *  and it is what makes the offset gutter's last digit a column a reader can
 *  count on: every row starts at a multiple of 16, so the low nibble of an
 *  offset IS the column the byte sits in. */
export const READER_BYTES_PER_ROW = 16;

/** Rows the dump shows at the app's default viewport. The panel narrows this
 *  on a short window (`READER_MIN_VISIBLE_ROWS` is the floor); the reader is
 *  handed the number rather than measuring it, so the same arithmetic runs in
 *  a browser and in a test. */
export const READER_VISIBLE_ROWS = 24;

/** …and the floor. Eight rows is 128 bytes — still a dump rather than a
 *  peephole, and enough that the byte map beside it has something to point at.
 *  Below this the reader would be a worse window than the 32-byte preview it
 *  opens from, which is the one thing it may not be. */
export const READER_MIN_VISIBLE_ROWS = 8;

/** Rows mounted above and below the viewport. A wheel gesture moves several
 *  rows per frame and React cannot mount a row inside the same frame the
 *  browser scrolled it into view, so a virtualiser with no overscan flashes
 *  blank at the leading edge. Eight rows is one wheel notch's worth on both
 *  sides at the app's default row height. */
export const READER_OVERSCAN_ROWS = 8;

/** The offset gutter's own width: six upper-case hex digits, no `0x`.
 *
 *  Six because a CKB Cell's data never reaches 16 MiB — the consensus limit on
 *  a whole block is far under it, and the largest payload the staged set holds
 *  is 37,314 B — so the gutter can be a FIXED width and every row's offset
 *  lines up under the one above it. A gutter that grows a digit at 0x100000
 *  would shift the entire dump one column right, mid-scroll, which is the one
 *  thing a hex dump may never do.
 *
 *  The `0x` is the caller's: the gutter prints bare digits (the column is
 *  obviously hex once it has a heading), the inspector strip prints
 *  `0x${formatReaderOffset(n)}` because a value quoted inside a sentence has
 *  to say what base it is in. */
export function formatReaderOffset(byte: number): string {
  const exact = Number.isFinite(byte) ? Math.max(0, Math.trunc(byte)) : 0;
  return exact.toString(16).toUpperCase().padStart(6, '0');
}

/** FNV-1a over the label, 32-bit. Moved here from
 *  `cellSemanticMorphology.derive.ts`, which was the only caller and is now
 *  one of three: a hash that decides a colour has to be the SAME hash on every
 *  surface that colours the thing, and a private copy in the file that
 *  happened to need it first is how it stopped being that. */
export function segmentLabelHash(label: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < label.length; index += 1) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

/** Byte order, with the input's own index kept: the rule below walks segments
 *  the way the BYTES run, but every caller indexes its own array. */
function inByteOrder(
  segments: readonly SemanticContentSegment[],
): { segment: SemanticContentSegment; index: number }[] {
  return segments
    .map((segment, index) => ({ segment, index }))
    .sort((left, right) => (
      left.segment.start_byte - right.segment.start_byte
      || left.segment.end_byte - right.segment.end_byte
      || left.segment.label.localeCompare(right.segment.label)
      || left.index - right.index
    ));
}

/** The one rule three surfaces ask: which slot of `QUALITATIVE_BUCKET_COLORS`
 *  a decoded segment wears.
 *
 *  Seeded by a hash of `label/meaning` rather than by position, because a slot
 *  handed out by position is a slot that MOVES: a record whose decode gains a
 *  field renumbers every segment after it, and the same `amount` is suddenly a
 *  different colour on the same Cell. Hashing the label pins the colour to the
 *  thing rather than to its place in a list, which is the whole reason the
 *  qualitative ramp exists — a slot means nothing except "other than its
 *  neighbour", so the only thing it has to be is STABLE.
 *
 *  And then the one thing a hash cannot promise: that two neighbours differ.
 *  A spore's seven header fields hash to `5 5 3 1 0 1 0`, and the first two
 *  landing on one slot puts `total_size` and `offset_content_type` — adjacent
 *  in the byte map, adjacent in the dump, adjacent in the table of contents —
 *  in the same colour, which is exactly the reading the ramp is there to
 *  prevent. So a repeat steps one slot on. Only against the PREVIOUS segment:
 *  stepping against the whole set would turn the rule into an assignment
 *  problem whose answer changes when any segment changes, and the stability
 *  above is worth more than a guarantee about segments a reader is not looking
 *  at together.
 *
 *  Order-independent by construction. The rule walks BYTE order, but the
 *  answers come back at the caller's own indices, so the DATA window (record
 *  order), the portrait overlay (sorted) and the reader (record order) all get
 *  the same slot for the same segment. That is the difference between one rule
 *  and three implementations of one sentence. */
export function segmentColorSlots(
  segments: readonly SemanticContentSegment[],
): number[] {
  const slots = new Array<number>(segments.length).fill(0);
  let previous = -1;
  for (const { segment, index } of inByteOrder(segments)) {
    let slot = segmentLabelHash(`${segment.label}/${segment.meaning}`)
      % QUALITATIVE_BUCKET_COLORS.length;
    if (slot === previous) {
      slot = (slot + 1) % QUALITATIVE_BUCKET_COLORS.length;
    }
    slots[index] = slot;
    previous = slot;
  }
  return slots;
}

/**
 * Which segment owns each byte, once, so the dump can colour 40 rows without
 * asking 7 half-open range questions per byte.
 *
 * `-1` is "no segment names this byte" — the norm rather than the exception: a
 * spore's decode leaves the four molecule padding words and the gap before
 * `content_type` unmapped, and those bytes are real payload the reader must
 * still draw. They go out in ink.
 *
 * FIRST wins where two segments claim a byte. `contentSegmentAtByte` already
 * answers overlaps that way (`findIndex` over the record's own order), and the
 * two have to agree or the DATA window and the reader would disagree about
 * which decode a byte belongs to — the same defect this file exists to close
 * one axis over. Which segment is "first" is therefore the record's order, not
 * byte order: ckbadger emits its segments in the order its decoder found them,
 * and the earlier find is the more specific reading.
 */
export function buildSegmentIndex(
  segments: readonly SemanticContentSegment[],
  totalBytes: number,
): Int16Array {
  const length = Number.isFinite(totalBytes)
    ? Math.max(0, Math.trunc(totalBytes))
    : 0;
  const index = new Int16Array(length).fill(-1);
  for (let segment = 0; segment < segments.length; segment += 1) {
    const { start_byte: start, end_byte: end } = segments[segment];
    const from = Math.max(0, Math.trunc(start));
    const to = Math.min(length, Math.trunc(end));
    for (let byte = from; byte < to; byte += 1) {
      if (index[byte] === -1) index[byte] = segment;
    }
  }
  return index;
}

export interface ReaderRowWindow {
  /** First row mounted, inclusive. */
  firstRow: number;
  /** One past the last row mounted. Half-open, like every byte range on this
   *  card: `for (let r = firstRow; r < lastRow; r += 1)` is the whole window,
   *  and `lastRow - firstRow` is how many rows the DOM is holding. */
  lastRow: number;
  /** Rows the whole payload has — `ceil(totalBytes / 16)`, which is what the
   *  scroll spacer is sized from. Read off `Cell.data_bytes` and NEVER off the
   *  prefix the browser is holding: a Cell whose bytes have not arrived yet
   *  still has all of its rows, drawn as ghosts. */
  rowCount: number;
}

/**
 * Which rows of the dump are mounted at a given scroll offset.
 *
 * The largest staged payload is 37,314 B = 2,333 rows, and 2,333 rows of
 * sixteen hex cells and sixteen ASCII cells is 74,656 DOM nodes — an order of
 * magnitude past what the card can mount and still open in a frame. So the
 * dump is one absolutely-positioned window inside a spacer of the full height:
 * the scrollbar tells the truth about the payload's size, and the DOM only
 * ever holds `visibleRows + 2 · overscan` rows.
 *
 * Everything it needs is a parameter. `rowHeight` in particular: the reader
 * knows it as `HUD_TYPE.label * 1.5`, but a derive that reached for the rung
 * itself would be a derive that cannot be asked "what if the row were 20 px",
 * and — the load-bearing half — a derive the jsdom tests could not drive,
 * because jsdom lays nothing out and every height it would measure is zero.
 */
export function readerRowWindow(
  scrollTop: number,
  rowHeight: number,
  totalBytes: number,
  visibleRows: number,
  overscan: number,
): ReaderRowWindow {
  const bytes = Number.isFinite(totalBytes)
    ? Math.max(0, Math.trunc(totalBytes))
    : 0;
  const rowCount = Math.ceil(bytes / READER_BYTES_PER_ROW);
  if (rowCount === 0) return { firstRow: 0, lastRow: 0, rowCount: 0 };
  const height = Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 1;
  const overscanRows = Number.isFinite(overscan)
    ? Math.max(0, Math.trunc(overscan))
    : 0;
  const span = Math.max(1, Math.trunc(visibleRows)) + overscanRows * 2;
  const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const firstRow = Math.min(
    rowCount - 1,
    Math.max(0, Math.floor(top / height) - overscanRows),
  );
  return { firstRow, lastRow: Math.min(rowCount, firstRow + span), rowCount };
}

export interface ReaderByte {
  /** Two upper-case hex digits, always — `0F`, never `F`. */
  hex: string;
  /** The byte's own character, or the interpunct the whole HUD spells an
   *  absence with. */
  ascii: string;
  printable: boolean;
}

/** One byte, as the two columns a dump prints it in.
 *
 *  Printable is `0x20–0x7E` and nothing else — the window `decodeCellDataHex`
 *  already uses for the preview's ASCII line, and deliberately narrower than
 *  "what a font could draw": high bytes are not Latin-1 here, they are the
 *  second half of a UTF-8 sequence or a length prefix or PNG pixels, and
 *  rendering them as accented letters would be the reader inventing a text
 *  that is not there. The inspector's UTF-8 field is where a reader asks that
 *  question, over a range they chose. */
export function readerByte(value: number): ReaderByte {
  const byte = Number.isFinite(value) ? Math.trunc(value) & 0xff : 0;
  const printable = byte >= 0x20 && byte <= 0x7e;
  return {
    hex: byte.toString(16).toUpperCase().padStart(2, '0'),
    ascii: printable ? String.fromCharCode(byte) : '·',
    printable,
  };
}

export interface ReaderInspection {
  /** Low end of the selection. */
  offset: number;
  length: number;
  /** Segment owning the byte at `offset`, or null where none does. */
  segment: number | null;
  u8?: number;
  u16?: number;
  u32?: number;
  u64?: bigint;
  u128?: bigint;
  /** A selection whose width is not one of the fixed ones, read whole. Present
   *  only for `2 < length ≤ 16` with `length` not in `{4, 8, 16}` — a 9-byte
   *  range is `u72 LE`, and the caller names it from `length * 8`. */
  range?: bigint;
  utf8: string;
}

/** Little-endian read of `size` bytes at `from`, or null past the end. */
function readLE(bytes: Uint8Array, from: number, size: number): bigint | null {
  if (from < 0 || from + size > bytes.length) return null;
  let value = 0n;
  for (let index = size - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[from + index]);
  }
  return value;
}

/** The longest run the inspector decodes as text. A selection can be the whole
 *  37 KB payload, and a strip that tries to print it would spend the frame
 *  decoding a string nothing can show. */
const READER_UTF8_LIMIT = 256;

/** Everything the inspector strip says about one selection.
 *
 *  Two readings, and they answer different questions on purpose:
 *
 *  The FIXED widths are read at `offset`, whatever the selection's length —
 *  `u8/u16/u32/u64/u128 LE`, each present when that many bytes exist after the
 *  caret. That is what a data inspector is: a reader who puts the caret on
 *  byte 0 of an xUDT Cell wants to know what the u128 there says, and having
 *  to select exactly sixteen bytes first would make the strip a calculator
 *  rather than a reading. Little-endian and only little-endian, because CKB is
 *  — the UDT amount, the DAO field, every Molecule offset — and offering both
 *  ends would invite reading the wrong one.
 *
 *  The RANGE reading answers the other question: what does the width I
 *  actually selected say. Present only when the selection is not already a
 *  fixed width, so the strip never prints the same number under two names.
 *
 *  `utf8` is non-fatal — a decoder that threw would leave the strip blank over
 *  exactly the bytes a reader most wants a guess about — and every control
 *  character, `DEL`, and the replacement character the decoder emits for a bad
 *  sequence collapse to the interpunct, so a segment full of zero padding
 *  reads as padding rather than as an empty string. */
export function inspectSelection(
  bytes: Uint8Array,
  start: number,
  end: number,
  segmentIndex: Int16Array,
): ReaderInspection {
  const clamp = (value: number): number => (
    Number.isFinite(value)
      ? Math.min(bytes.length, Math.max(0, Math.trunc(value)))
      : 0
  );
  // A selection has two ends and no direction: the caller's anchor may be
  // either one of them, and the reader extends in both.
  const low = Math.min(clamp(start), clamp(end));
  const high = Math.max(clamp(start), clamp(end));
  const owner = low < segmentIndex.length ? segmentIndex[low] : -1;
  const inspection: ReaderInspection = {
    offset: low,
    length: high - low,
    segment: owner === -1 ? null : owner,
    utf8: '',
  };

  const u8 = readLE(bytes, low, 1);
  if (u8 !== null) inspection.u8 = Number(u8);
  const u16 = readLE(bytes, low, 2);
  if (u16 !== null) inspection.u16 = Number(u16);
  const u32 = readLE(bytes, low, 4);
  if (u32 !== null) inspection.u32 = Number(u32);
  const u64 = readLE(bytes, low, 8);
  if (u64 !== null) inspection.u64 = u64;
  const u128 = readLE(bytes, low, 16);
  if (u128 !== null) inspection.u128 = u128;

  const width = high - low;
  if (width > 2 && width <= 16 && width !== 4 && width !== 8 && width !== 16) {
    const range = readLE(bytes, low, width);
    if (range !== null) inspection.range = range;
  }

  if (width > 0) {
    const text = new TextDecoder('utf-8', { fatal: false })
      .decode(bytes.subarray(low, Math.min(high, low + READER_UTF8_LIMIT)));
    inspection.utf8 = text.replace(/[\u0000-\u001f\u007f\ufffd]/g, '·');
  }
  return inspection;
}

export interface ReaderByteMapBand {
  /** Top edge, in pixels down the map. */
  y0: number;
  /** Bottom edge, exclusive. Never equal to `y0`. */
  y1: number;
  slot: number;
}

/**
 * The byte map's bands: where each decoded segment lands on a strip as tall as
 * the dump, in the slot `segmentColorSlots` gave it.
 *
 * The map is a scale drawing of the payload, which at a spore's proportions
 * means the seven header fields share the first pixel and `content` is the
 * other 323. That is the true shape and the map's whole job — a reader glancing
 * at it should see "this Cell is one enormous blob with a tail", not seven
 * tidy stripes that imply seven comparable parts.
 *
 * But a band that rounds to zero pixels is a band that is not drawn at all,
 * and `cluster_id` — 32 bytes at the very end of 37,314 — rounds to zero. A
 * segment the decode FOUND has to appear, so every band is at least one pixel
 * and the last one is pushed up against the bottom edge rather than off it.
 * Floor on the top edge and ceil on the bottom, so a band never covers fewer
 * bytes than it has.
 *
 * Bands come out in byte order because that is the order they are painted in,
 * and painting them in the record's order would let a later segment's colour
 * land under an earlier one's on an overlap.
 */
export function readerByteMapBands(
  segments: readonly SemanticContentSegment[],
  slots: readonly number[],
  totalBytes: number,
  heightPx: number,
): ReaderByteMapBand[] {
  const total = Number.isFinite(totalBytes)
    ? Math.max(0, Math.trunc(totalBytes))
    : 0;
  const height = Number.isFinite(heightPx) ? Math.trunc(heightPx) : 0;
  if (total === 0 || height <= 0) return [];
  const bands: ReaderByteMapBand[] = [];
  for (const { segment, index } of inByteOrder(segments)) {
    const start = Math.min(total, Math.max(0, Math.trunc(segment.start_byte)));
    const end = Math.min(total, Math.max(start, Math.trunc(segment.end_byte)));
    if (end <= start) continue;
    const y0 = Math.min(height - 1, Math.floor((start / total) * height));
    const y1 = Math.min(height, Math.max(y0 + 1, Math.ceil((end / total) * height)));
    bands.push({ y0, y1, slot: slots[index] ?? 0 });
  }
  return bands;
}

/**
 * What a key does to the caret, in bytes, or which end of the payload it jumps
 * to. `null` for every key the dump does not claim — the caller passes those
 * through rather than swallowing them, so Tab still leaves the dump and Escape
 * still closes the card.
 *
 * Shift is not asked about here on purpose. Whether a step MOVES the caret or
 * EXTENDS the selection from the anchor is a fact about the reader's selection
 * state, not about the key, and a step function that returned two different
 * things for the same key would have to be told about an anchor it has no
 * business holding. The caller reads `event.shiftKey` and decides.
 */
export function readerKeyStep(
  key: string,
  visibleRows: number,
): number | 'home' | 'end' | null {
  // A page is never zero rows: a PageDown that moves nothing reads as a key
  // the reader swallowed.
  const page = Math.max(1, Math.trunc(visibleRows)) * READER_BYTES_PER_ROW;
  switch (key) {
    case 'ArrowUp': return -READER_BYTES_PER_ROW;
    case 'ArrowDown': return READER_BYTES_PER_ROW;
    case 'ArrowLeft': return -1;
    case 'ArrowRight': return 1;
    case 'PageUp': return -page;
    case 'PageDown': return page;
    case 'Home': return 'home';
    case 'End': return 'end';
    default: return null;
  }
}

/** An integer the inspector prints, grouped — `340,282,366,920,938,463,463`.
 *
 *  Locale pinned to `en-US` for the reason the rest of the card's formatters
 *  pin it: grouping drifts with the viewer's runtime, and a HUD that says what
 *  a u128 holds must say the same thing on every machine. It also keeps the
 *  separator an ASCII comma — a narrow no-break space is what several locales
 *  group with, and no face the HUD ships carries one.
 *
 *  A `number` goes through `BigInt` rather than printing itself, because a
 *  Number over 1e21 prints as `1e+21` and a hex reader that answers "what does
 *  this field say" with an exponent has not answered. Nothing this reader
 *  hands over gets there — u8/u16/u32 are all it passes as numbers — but the
 *  door costs one conversion to close for good. */
export function formatReaderInteger(value: bigint | number): string {
  if (typeof value === 'bigint') return value.toLocaleString('en-US');
  const exact = Number.isFinite(value) ? Math.trunc(value) : 0;
  return BigInt(exact).toLocaleString('en-US');
}
