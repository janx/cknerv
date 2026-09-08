import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { SemanticContentSegment } from '@cknerv/types';
import {
  READER_BYTES_PER_ROW,
  READER_OVERSCAN_ROWS,
  buildSegmentIndex,
  formatReaderInteger,
  formatReaderOffset,
  inspectSelection,
  readerBoxRows,
  readerByte,
  readerByteMapBands,
  readerKeyStep,
  readerRowWindow,
  readerMapIsFlat,
  readerShowsMap,
  segmentColorSlots,
} from '../../derives/cellDataReader.derive';
import type { CellOutputDataPhase } from '../../hooks/useCellOutputData';
import {
  HUD_COLORS,
  HUD_FONTS,
  HUD_MOTION,
  HUD_TYPE,
  QUALITATIVE_BUCKET_COLORS,
  rgba,
} from './hudTheme';
import {
  REVEAL_GHOST_OPACITY,
  SpatialPlateHeader,
  moduleTag,
  revealStageAttributes,
  revealStageStyle,
} from './primitives';

// CKBYTES · SCAN·02 — the Cell's own bytes, under the CELL SCAN square, for
// every Cell that holds any.
//
// ⚠️ SCAN·02 AND NOT SCAN·03, which it was until 2026-09-05. The count-off is
// read down a card, and MEMORY TRACE — the plate that held 02 — only appears
// when a recall arms it, so the card a reader usually meets counted 01, 03.
// The reader is on the card from the first frame for every Cell that holds a
// byte; the trace is the surface that comes and goes, so it takes the number
// that can be missing. Codes are identities rather than positions (D-17), and
// this is the one case where the identity had to move for the count-off to be
// readable at all.
//
// It was a satellite: a 660 px column that opened from a door in the DATA
// cluster and carried, besides the dump, a segment list, a READS AS line, an
// UNMAPPED count, an inspector strip that read a selection five ways, GO TO,
// two COPY commands, a toast, a keys legend, a loading bar and a CLOSE. The
// user's direction of 2026-09-05 was 「hex reader 需要精简，聚焦最核心功能，
// 缩小 UX 面积」 and 「hex reader 应该总是展示」: keep the core, shrink the
// surface, and stop making anyone open it.
//
// So the reader is a ZONE now, and it holds exactly five things:
//
//   THE READING, at the top. `CellContentMemory`: what the decode called these
//   bytes, and one row for each field it found with that field's range and
//   value. Handed in as a slot rather than built here — it is the analysis
//   plate's own window, moved, on the user's direction of 2026-09-08 (「scan01
//   中的data decode section, 能不能移动到 scan02 里面?」). It is a TABLE OF
//   CONTENTS for the dump under it, which is what makes this its home: a press
//   on one of its rows scrolls this reader to that field's first byte and
//   lights it. ⚠️ It is NOT the segment rail R2 took out of this zone — that
//   was 660 px of list, inspector, GO TO and keys legend — but one line and at
//   most seven short rows, and the dump keeps everything they do not take.
//
//   THE DUMP. Sixteen bytes a row, a five-digit offset gutter, the same
//   sixteen bytes as characters on the SAME line, coloured by the segment that
//   owns them, keyboard-navigable, with rows past the held prefix standing as
//   ghosts until the node answers.
//
//   THE SCROLLBAR, WHICH IS THE BYTE MAP (the user's R2-4 ruling). The native
//   bar is hidden and an 8 px canvas takes its place: a scale drawing of the
//   payload with every decoded segment as a band, the viewport as an ink band
//   over them, click and drag to move. Two things that were a strip and a
//   gutter are one strip that does both jobs.
//
//   ONE FOOT LINE. Three readings in priority — the byte under the pointer,
//   the selection, or the payload's own status — where a table of contents, a
//   READS AS block and a five-column inspector used to be. The reading at the
//   top of this zone lists the segments and names the decode (R2-b), and now
//   does it four pixels above the bytes instead of on another plate; this line
//   is what neither of them can say, which is what is under the pointer RIGHT
//   NOW.
//
//   ONE COPY. The selection if there is one, else the whole payload, as `0x…`.
//
// Everything else went back where it was read. There is no CLOSE — Escape
// closes the card, and a zone of a card has nothing of its own to dismiss.
//
// Three constraints shape every line of it, and all three come from the card
// rather than from the reader:
//
//   MOUNT AT FINAL GEOMETRY. The dump's height is decided by the payload and
//   the room, once, before anything is drawn — `readerBoxRows` — and rows past
//   the held prefix stand as ghosts until the node answers and then fill IN
//   PLACE. Nothing under a reader may move while it is being read.
//
//   THE NUMBERS ARE HANDED IN. The room the plate leaves and the row height
//   are props and constants, never measurements: jsdom lays nothing out, and a virtualiser
//   that asked `getBoundingClientRect` which row it was on could not be driven
//   by a test at all. The only layout fact this file reads back is
//   `scrollTop`, which is a scroll position rather than a measurement.
//
//   ONE COLOUR RULE. A segment's slot comes from `segmentColorSlots`, the same
//   function the reading over the dump and the portrait's byte rail ask, so a
//   reader moving their eye between the three surfaces is reading one claim
//   about the same bytes rather than three.
//
// HEX ONLY (the user's E4 ruling, 2026-09-04): there is no TEXT view and no
// image view. The foot line's text clause is where a reader asks what a range
// says as text, over a range they chose — which is a question about a
// selection, not a second rendering of the payload.

/** The dump's row height. `label` is the dossier's evidence register (the
 *  user's E2 ruling) and 1.5 is the line height a dump needs for its ASCII
 *  column to sit level with its hex. Exported because the panel sizes the
 *  whole zone from it before this component exists. */
export const READER_ROW_HEIGHT_PX = HUD_TYPE.label * 1.5;

/**
 * Everything in this reader that is not a row of bytes, in pixels.
 *
 * The reader stands under the CELL SCAN square and its bottom is the analysis
 * plate's bottom, so the dump gets `plate − 288 − this`, and
 * `readerRowsUnderScan` divides the remainder into rows. Reservation math only
 * — the browser lays the real thing out — and deliberately the generous
 * reading of every term, because a chrome one pixel short is a reader one row
 * taller than the space it was given, and a zone that pushes the card's bottom
 * down is the exact defect this number exists to stop.
 *
 * Line by line, top to bottom, at the type each part prints:
 *
 *     the section's padding, top and bottom             8 + 10 = 18
 *     the header row (its tallest item is the COPY
 *       button: micro 7.5 + 3 + 3 padding + 1 + 1 border)      16
 *     the header's margin-bottom                                6
 *     the dump's border, top and bottom                 1 + 1 =  2
 *     the foot line's margin-top                                4
 *     the foot line's own box (one `micro` line, fixed)         16
 *                                                            —————
 *                                                               62
 *
 * ⚠️ THE READING IS NOT IN THIS NUMBER, and must never be added to it. The band
 * between the header and the dump is sized by the RECORD rather than by the
 * reader — `cellContentReadingLayout` in `CellContentMemory.tsx` sums it from
 * the rows the decode will bring — and the panel hands it in as its own term,
 * added to this one before the remainder is divided into rows. A reader that
 * counted it here as well would take the same height out of the dump twice.
 *
 * It was 117 for the satellite, and every one of the terms that is gone is a
 * thing the user asked to remove: the loading bar (7), the inspector's rule,
 * padding and TWO wrapped lines of `label` (41), and the commands row with its
 * GO TO input (26). What is left is a header, a border, and one line.
 */
export const READER_CHROME_PX = 62;

/** A row's width in characters, and the reason the dump is a fixed measure:
 *
 *      5 offset + 2 gap + 48 hex (16×2 with its group gaps) + 2 gap + 16 ASCII
 *
 *  Share Tech Mono's advance is 0.54 em, so 73 ch is 355 px at `label` (9 px).
 *  The gutter lost a digit with `formatReaderOffset` (five digits reach
 *  1 MiB, which no CKB payload does), and the dump's declared measure follows
 *  it — the row is the width of what it prints, not of what it used to. */
const READER_ROW_CH = 73;

/** The byte map's width, which is also the scrollbar's (R2-4: they are one
 *  thing). Eight pixels is what a scrollbar is — narrow enough to read as the
 *  bar it replaces rather than as a second column, wide enough that a
 *  one-pixel band is still visible and a pointer can hit it. */
const READER_MAP_WIDTH_PX = 8;

/**
 * The reader's width, in pixels.
 *
 *     the dump          73 ch × 0.54 em × 9 px                355
 *     its own padding-right, where the native bar used to be    8
 *     the seam to the map                                       6
 *     the scrollbar-map                                         8
 *     the section's padding, left and right          12 + 10 = 22
 *     the section's border, left and right             1 + 1 =  2
 *                                                            —————
 *                                                             401 → 408
 *
 * Rounded up to 408 so the row never wants the pixel the browser's own
 * rounding of `ch` takes — a dump one pixel narrow wraps its ASCII column onto
 * a second line, which is the one thing a hex row may not do.
 *
 * The number the CARD spends is 408 − 280 − 8 = 120: the reader is wider than
 * the CELL SCAN square it stands under, and that overhang is the notch it
 * reaches toward the Cell (the user's R2-6 ruling). Exported so the panel can
 * derive the notch and the card's width from ONE statement of it rather than
 * from three constants that can disagree.
 */
export const READER_WIDTH_PX = 408;

/** How long COPY says what it did. Long enough to read one word, short enough
 *  that it is plainly an acknowledgement and not a state. */
const READER_COPY_MS = HUD_MOTION.hold;

/** Characters of the data hash the status line shows. Ten is what makes two
 *  different Cells look different at a glance; a truncated hash is a landmark
 *  and not a value, so there is no `title` offering the rest as one. */
const READER_HASH_HEAD = 10;

/** Characters of a selection's text the foot line prints. The line is ONE line
 *  under a 408 px zone and shares it with the offset, the length and the
 *  integer; the whole decoded run is in the line's `title`. */
const READER_UTF8_COLUMNS = 24;

/** What a segment's bytes fall to while ANOTHER segment is focused. The DATA
 *  cluster's own number, so the two surfaces dim alike. Bytes no segment
 *  claims never dim: they are not being contrasted with anything. */
const SEGMENT_ASIDE_OPACITY = 0.34;

/** The map's ground, its bands, the wash over what has not arrived, and the
 *  viewport band. Canvas alpha rather than a rule's, which is a different
 *  question from the border rungs the overlay declares — a band is a surface
 *  being painted, not a line between two blocks. */
const MAP_TRACK_ALPHA = 0.22;
const MAP_BAND_ALPHA = 0.9;
const MAP_BAND_ASIDE_ALPHA = 0.35;
const MAP_UNHELD_ALPHA = 0.82;
const MAP_VIEWPORT_ALPHA = 0.16;
const MAP_VIEWPORT_EDGE_ALPHA = 0.5;

/** The mark a band draws when it is the whole strip (`readerMapIsFlat`). Four
 *  of the strip's eight pixels wide, so it reads as a mark ON the track rather
 *  than as a short band of it. */
const MAP_FLAT_DOT_PX = 4;

/** The selection's wash, in the window's own alpha. */
const SELECTION_WASH_ALPHA = 0.16;

/** The class the injected theme stylesheet hides the native scrollbar with.
 *
 *  A class rather than an inline style because `scrollbar-width` has a
 *  pseudo-element twin — `::-webkit-scrollbar` — that no inline style can
 *  reach, and the bar has to be gone in both dialects or the map would sit
 *  beside a second, redundant bar. The rules live in `hudTheme.ts` beside the
 *  three other scrollbar rules the HUD already writes. */
const READER_DUMP_CLASS = 'cknerv-cell-bytes-dump';

/** A decoded segment's label, said the way the card says every wire enum. */
function readableKind(value: string): string {
  return value.replaceAll('_', ' ').toUpperCase();
}

/** A range of the payload as `0x…` hex, which is the form every other tool a
 *  reader might paste it into expects. */
function hexRun(bytes: Uint8Array, from: number, to: number): string {
  let text = '0x';
  for (let index = from; index < Math.min(to, bytes.length); index += 1) {
    text += bytes[index].toString(16).padStart(2, '0');
  }
  return text;
}

/**
 * What the reader has selected.
 *
 * One object rather than four pieces of state, because the four move together
 * and a half-applied selection — a caret that moved without its anchor, a
 * range that outlived the segment it came from — is a reading nobody asked
 * for. `[start, end)` is half-open like every byte range on this card, and a
 * bare caret is the one-byte range at it: the foot line reads a caret as a
 * byte, so there is no third state where something is selected and nothing is.
 */
interface ReaderSelection {
  caret: number;
  /** Where a Shift-extended range grows FROM. */
  anchor: number;
  start: number;
  end: number;
  /** Set only when the selection arrived through `focus` — a click on a row of
   *  the reading above. A segment selection dims its neighbours; a hand-made
   *  range does not, because the reader who dragged it is not asking about the
   *  decode. */
  segment: number | null;
}

function caretAt(byte: number): ReaderSelection {
  return { caret: byte, anchor: byte, start: byte, end: byte + 1, segment: null };
}

/** The reading's control grammar, in the word-width COPY needs.
 *
 *  Copied rather than imported: `navButtonStyle` is private to
 *  `CellContentMemory.tsx` and lifting it into `primitives.tsx` would mean
 *  editing that file, which is not this one's to edit. The grammar is what
 *  matters and it is stated here exactly — a cyan outline over a cyan wash, in
 *  the tech voice at the chip rung. */
function commandButtonStyle(): CSSProperties {
  return {
    margin: 0,
    padding: '3px 7px',
    border: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.28)}`,
    background: rgba(HUD_COLORS.cyanWire, 0.06),
    color: HUD_COLORS.cyanWire,
    fontFamily: HUD_FONTS.tech,
    fontSize: HUD_TYPE.micro,
    letterSpacing: 1.4,
    lineHeight: 1,
    cursor: 'pointer',
  };
}

/**
 * Where the reading sent the reader.
 *
 * `nonce` is what makes it a GESTURE rather than a value. Clicking the same
 * segment row twice has to scroll back to it twice — a reader who wandered off
 * and clicked the row again is asking to be taken back — and an effect keyed
 * on the range would fire once and never again. So the panel bumps the nonce
 * on every click and this component applies the focus when the nonce changes.
 */
export interface CellDataReaderFocus {
  start: number;
  end: number;
  /** Which segment, so its bytes can glow and the others fall away. Null for a
   *  range that names no segment. */
  segment: number | null;
  nonce: number;
}

/**
 * ⚠️ ONE READER PER CELL. The caller MUST key this component by the Cell's id.
 *
 * A selection, a scroll position and a copy acknowledgement all belong to the
 * bytes they were made over, and carrying any of them onto a different Cell's
 * payload would be the reader pointing at a byte nobody selected. The reader
 * used to take the whole `Cell` and reset itself in an effect on `cell.id`;
 * it does not need the Cell for anything else, and a `key` says the same thing
 * where React can act on it — it resets the scroll, the caret, the applied
 * focus nonce and the COPY label in one stroke, which the effect had to do by
 * hand and could only do for the state it remembered to name.
 */
export interface CellDataReaderProps {
  /** The record's decoded segments, in record order. They colour the bytes and
   *  name the one under the pointer; the LIST of them is the reading's, in the
   *  band over the dump, which is where a click on one comes from. */
  segments: readonly SemanticContentSegment[];
  /** What the browser is holding. Shorter than `totalBytes` until the node
   *  answers, and the rows past it are drawn as ghosts. */
  bytes: Uint8Array;
  heldBytes: number;
  /** `Cell.data_bytes` — the payload's true length. Every row count comes from
   *  here and never from `bytes.length`. */
  totalBytes: number;
  phase: CellOutputDataPhase;
  message: string | null;
  dataHash: string | null;
  live: boolean | null;
  /** Rows of ROOM the analysis plate leaves under the CELL SCAN square — a
   *  ceiling, not the box's height. The box takes the payload's own height
   *  inside it (`readerBoxRows`). */
  visibleRows: number;
  /** A segment row of the reading was clicked. Null means nothing is being
   *  pointed at, which is also the state a byte click returns it to. */
  focus: CellDataReaderFocus | null;
  /** Called with `null` when the reader's own selection stops being the focus
   *  — a byte click or a key move — so the reading's row unpresses. */
  onFocusChange?: (segment: number | null) => void;
  /** THE READING, mounted in the band between the header and the dump: the
   *  rows that say what these bytes decode to (`CellContentMemory`, through
   *  the card's own leaf, so the window keeps the card's state and its stage
   *  clock).
   *
   *  A SLOT and not a record, because everything the window needs — the
   *  source, the phase, the pressed row, the walk — is the card's, and a
   *  reader that took all of it to hand it straight back would be a second
   *  place the card's wiring is written down. Absent for the ~98% of Cells
   *  nobody indexed: no reading renders for them, so no slot mounts, so there
   *  is no phantom 6 px between the header and the dump. */
  reading?: ReactNode;
  /** Whether the walk has reached the BYTES. The frame, the header and the
   *  reading are lit from the first frame — a plate that draws itself is not
   *  evidence, and the reading stages on its own clock inside the slot — and
   *  this stages the dump and the foot line together, at
   *  `CONTENT_DECODED_AT`, the instant the reading finishes decoding.
   *
   *  ⚠️ OMITTED IS NOT `true`. It means NOBODY IS STAGING THIS READER — the
   *  tuning lab, a test of the bare zone — and such a reader draws its bytes
   *  lit, as it always has, with no reveal state to report. A card that walks
   *  this zone passes the boolean every frame, so `resolved` and `scanning`
   *  are what a walk says about the bytes rather than what a reader with no
   *  walk would have to claim about itself. */
  revealed?: boolean;
}

export default function CellDataReader({
  segments,
  bytes,
  heldBytes,
  totalBytes,
  phase,
  message,
  dataHash,
  live,
  visibleRows,
  focus,
  onFocusChange,
  reading,
  revealed,
}: CellDataReaderProps) {
  // A walk owns the bytes, or nobody does. `staged` is which of those it is —
  // the attributes and the reveal state belong to a walk and are absent when
  // there is none — and `bytesLit` is what the reader draws, which is LIT
  // either way unless a walk says the bytes are still on their way.
  const staged = revealed !== undefined;
  const bytesLit = revealed ?? true;
  const dumpRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<HTMLCanvasElement | null>(null);
  const footRef = useRef<HTMLDivElement | null>(null);
  /** The byte under the pointer. A REF and not state: forty rows re-rendering
   *  per byte the pointer crosses would spend a frame each, and the only thing
   *  a hover changes is one line of text. */
  const hoverRef = useRef<number | null>(null);
  const draggingMap = useRef(false);
  const appliedFocus = useRef<number | null>(null);
  const copyTimer = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [copied, setCopied] = useState<'COPIED' | 'BLOCKED' | null>(null);

  const rowHeight = READER_ROW_HEIGHT_PX;
  // The box ends at the last row, and `visibleRows` is the ROOM the analysis
  // plate leaves rather than the height the frame takes (the user's D-7 ruling
  // of 2026-09-05). Everything below reads the box: the viewport's height, the
  // window of rows mounted in it, the map's height, the page a key step moves.
  // The plate's remainder under the frame is plain plate ground — the zone
  // still stretches to the plate's bottom, the frame no longer does.
  const boxRows = readerBoxRows(totalBytes, visibleRows);
  const viewHeight = boxRows * rowHeight;
  const { firstRow, lastRow, rowCount } = readerRowWindow(
    scrollTop,
    rowHeight,
    totalBytes,
    boxRows,
    READER_OVERSCAN_ROWS,
  );
  const showsMap = readerShowsMap(totalBytes, boxRows);

  const slots = useMemo(() => segmentColorSlots(segments), [segments]);
  const segmentIndex = useMemo(
    () => buildSegmentIndex(segments, totalBytes),
    [segments, totalBytes],
  );
  const segmentColor = useCallback(
    (index: number): string => QUALITATIVE_BUCKET_COLORS[
      (slots[index] ?? 0) % QUALITATIVE_BUCKET_COLORS.length
    ],
    [slots],
  );

  // ——— Scrolling ————————————————————————————————————————————————————————
  // The dump's scroll position is React state as well as a DOM property. It
  // has to be both: a wheel moves the element and the handler catches up, but
  // a focus, a map drag and a caret step move it from here — and setting
  // `scrollTop` fires no event, so nothing would re-window the rows.

  const scrollDumpTo = useCallback((top: number) => {
    const ceiling = Math.max(0, rowCount * rowHeight - viewHeight);
    const next = Math.max(0, Math.min(ceiling, top));
    const dump = dumpRef.current;
    if (dump) dump.scrollTop = next;
    setScrollTop(next);
  }, [rowCount, rowHeight, viewHeight]);

  const scrollRowToTop = useCallback((row: number) => {
    scrollDumpTo(row * rowHeight);
  }, [rowHeight, scrollDumpTo]);

  /** Keep a byte in view without moving further than it takes. A caret step
   *  that recentred the dump would throw away the reader's place on every
   *  arrow press. */
  const keepByteInView = useCallback((byte: number) => {
    const top = Math.floor(byte / READER_BYTES_PER_ROW) * rowHeight;
    const current = dumpRef.current?.scrollTop ?? scrollTop;
    if (top < current) scrollDumpTo(top);
    else if (top + rowHeight > current + viewHeight) {
      scrollDumpTo(top + rowHeight - viewHeight);
    }
  }, [rowHeight, scrollDumpTo, scrollTop, viewHeight]);

  // ——— Selection ————————————————————————————————————————————————————————

  const moveCaret = useCallback((byte: number, extend: boolean) => {
    const clamped = Math.max(0, Math.min(Math.max(0, totalBytes - 1), byte));
    setSelection((current) => {
      if (!extend || current === null) return caretAt(clamped);
      const anchor = current.anchor;
      return {
        caret: clamped,
        anchor,
        start: Math.min(anchor, clamped),
        end: Math.max(anchor, clamped) + 1,
        segment: null,
      };
    });
    hoverRef.current = null;
    keepByteInView(clamped);
    // The reader's own gesture outranks the reading's: whatever row is pressed
    // in the band above is no longer what is being pointed at down here.
    onFocusChange?.(null);
  }, [keepByteInView, onFocusChange, totalBytes]);

  // The reading's hand-off, applied on the NONCE rather than on the range
  // (§4's trap): re-clicking the same row after the reader scrolled away has
  // to take it back there, and an effect keyed on `start`/`end` would not fire.
  const focusNonce = focus?.nonce ?? null;
  useEffect(() => {
    if (focus === null || focusNonce === null) return;
    if (appliedFocus.current === focusNonce) return;
    appliedFocus.current = focusNonce;
    const last = Math.max(0, totalBytes - 1);
    const start = Math.max(0, Math.min(last, Math.trunc(focus.start)));
    const end = Math.max(start + 1, Math.min(totalBytes, Math.trunc(focus.end)));
    hoverRef.current = null;
    setSelection({ caret: start, anchor: start, start, end, segment: focus.segment });
    scrollRowToTop(Math.floor(start / READER_BYTES_PER_ROW));
    // `focus` itself is deliberately not a dependency: the nonce IS its
    // identity, and re-running on a new object with the same nonce would
    // re-scroll a reader who had moved on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  useEffect(() => () => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
  }, []);

  const byteFromEvent = (target: EventTarget | null): number | null => {
    if (!(target instanceof Element)) return null;
    const hit = target.closest('[data-cell-data-reader-byte],[data-cell-data-reader-char]');
    if (!hit) return null;
    const raw = hit.getAttribute('data-cell-data-reader-byte')
      ?? hit.getAttribute('data-cell-data-reader-char');
    if (raw === null) return null;
    const index = Number(raw);
    return Number.isInteger(index) ? index : null;
  };

  // ——— Keys ————————————————————————————————————————————————————————————

  const onDumpKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = readerKeyStep(event.key, boxRows);
    if (step === null) return;
    event.preventDefault();
    const from = selection?.caret ?? 0;
    if (step === 'home') { moveCaret(0, event.shiftKey); return; }
    if (step === 'end') { moveCaret(totalBytes - 1, event.shiftKey); return; }
    moveCaret(from + step, event.shiftKey);
  };

  // ——— The foot line ————————————————————————————————————————————————————
  //
  // Painted through a ref rather than rendered, for the reason the hover is a
  // ref: this one line changes on every byte the pointer crosses, and a line
  // that re-rendered the component would re-render forty rows of dump with it.
  // React never wrote these children, so it never diffs them away; an effect
  // repaints after every render that COULD have changed what they say.
  //
  // Built with `createElement`/`textContent` rather than with markup, because
  // a segment's label is ckbadger's string and an `innerHTML` that interpolated
  // it would be a wire value reaching the DOM as markup.

  const inspection = useMemo(
    () => (selection === null
      ? null
      : inspectSelection(bytes, selection.start, selection.end, segmentIndex)),
    [bytes, segmentIndex, selection],
  );

  const paintFoot = useCallback(() => {
    const foot = footRef.current;
    if (!foot) return;
    const parts: HTMLElement[] = [];
    const say = (text: string, color?: string): void => {
      const span = document.createElement('span');
      span.textContent = text;
      if (color !== undefined) span.style.color = color;
      parts.push(span);
    };

    const hovered = hoverRef.current;
    let mode: 'status' | 'hover' | 'selection' = 'status';
    let title = '';

    if (hovered !== null) {
      // The byte under the pointer, which is the one thing only this surface
      // can say and the reason the segment list could go.
      mode = 'hover';
      const owner = segmentIndex[hovered] ?? -1;
      say(`0x${formatReaderOffset(hovered)}`, HUD_COLORS.ink);
      say(` · byte ${formatReaderInteger(hovered)} · `);
      if (owner === -1) say('unmapped');
      else say(readableKind(segments[owner]?.label ?? ''), segmentColor(owner));
    } else if (selection !== null && inspection !== null) {
      mode = 'selection';
      say(`0x${formatReaderOffset(selection.start)}`, HUD_COLORS.ink);
      say(` +${formatReaderInteger(inspection.length)} B`);
      if (inspection.integer !== null) {
        say(' · LE ');
        say(formatReaderInteger(inspection.integer), HUD_COLORS.goldInk);
      }
      if (inspection.utf8.length > 0) {
        const clipped = inspection.utf8.length > READER_UTF8_COLUMNS
          ? `${inspection.utf8.slice(0, READER_UTF8_COLUMNS)}…`
          : inspection.utf8;
        say(` · "${clipped}"`);
        title = inspection.utf8;
      }
    } else if (phase === 'error') {
      // Not `danger`. A node that could not be asked is a fact about the scope
      // of our knowledge, not a condition of the Cell — the same ruling the
      // analysis plate's own DATA fact already carries. The whole line is
      // `dim`, so the message needs no colour of its own.
      say(`${formatReaderInteger(heldBytes)}`, HUD_COLORS.ink);
      say(` / ${formatReaderInteger(totalBytes)} B · `);
      say(message ?? 'NO BYTES FROM THE NODE');
    } else if (phase === 'loading') {
      say('READING ');
      say(`${formatReaderInteger(totalBytes)} B`, HUD_COLORS.ink);
      say(' · ');
      say(`${formatReaderInteger(heldBytes)} B`, HUD_COLORS.ink);
      say(' HELD');
    } else {
      say(`${formatReaderInteger(totalBytes)} B`, HUD_COLORS.ink);
      say(' · ');
      // The one word here that is a state rather than a reading: the payload
      // on screen IS the payload.
      say('COMPLETE', HUD_COLORS.nominal);
      if (phase === 'ready' && dataHash) {
        say(` · NODE · ${dataHash.slice(0, READER_HASH_HEAD)}…`);
        title = live === null
          ? dataHash
          : `${dataHash} · ${live
            ? 'READ FROM THE LIVE CELL'
            : 'READ FROM THE TRANSACTION THAT CREATED IT'}`;
      } else {
        say(' · HELD');
      }
    }

    foot.replaceChildren(...parts);
    foot.setAttribute('data-cell-data-reader-foot-mode', mode);
    if (title.length > 0) foot.title = title;
    else foot.removeAttribute('title');
  }, [
    dataHash,
    heldBytes,
    inspection,
    live,
    message,
    phase,
    segmentColor,
    segmentIndex,
    segments,
    selection,
    totalBytes,
  ]);

  useEffect(() => { paintFoot(); }, [paintFoot]);

  // ——— The scrollbar-map ————————————————————————————————————————————————
  // Painted rather than laid out: 2,333 rows of payload compressed into a few
  // hundred pixels is a scale drawing, and a scale drawing made of DOM nodes
  // would be hundreds of elements saying one thing.

  const bands = useMemo(
    () => readerByteMapBands(segments, slots, totalBytes, viewHeight),
    [segments, slots, totalBytes, viewHeight],
  );
  const activeSegment = selection?.segment ?? null;
  const activeBands = useMemo(() => {
    if (activeSegment === null) return [];
    const segment = segments[activeSegment];
    if (!segment) return [];
    return readerByteMapBands(
      [segment],
      [slots[activeSegment] ?? 0],
      totalBytes,
      viewHeight,
    );
  }, [activeSegment, segments, slots, totalBytes, viewHeight]);

  useEffect(() => {
    const canvas = mapRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    // jsdom hands back a partial 2D context and a real browser can refuse one
    // outright; either way the strip still scrolls the dump, so a missing
    // context is a no-op rather than a throw.
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(READER_MAP_WIDTH_PX * ratio));
    const height = Math.max(1, Math.round(viewHeight * ratio));
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = rgba(HUD_COLORS.dim, MAP_TRACK_ALPHA);
    context.fillRect(0, 0, width, height);

    // LONGEST FIRST. A spore's `content` band covers the seven header fields
    // under it at this scale, and painting in byte order would bury every one
    // of them; painting the tall bands first leaves the short ones on top,
    // which is the only way a one-pixel band is ever seen.
    const paint = (band: { y0: number; y1: number; slot: number }, alpha: number) => {
      context.globalAlpha = alpha;
      context.fillStyle = QUALITATIVE_BUCKET_COLORS[
        band.slot % QUALITATIVE_BUCKET_COLORS.length
      ];
      const top = Math.round(band.y0 * ratio);
      const bottom = Math.max(top + 1, Math.round(band.y1 * ratio));
      context.fillRect(0, top, width, bottom - top);
    };
    // ONE BAND OVER THE WHOLE STRIP IS A MARK, NOT A FILL. A payload whose
    // only decoded segment covers all of it has nothing for the drawing to
    // say, and a solid lavender bar says it at full volume. The scrollbar half
    // of the strip still has work — that is why the map is drawn at all here —
    // so the band becomes a dot at the middle of the run it names, and the
    // viewport band below still rides over it.
    const dot = (band: { y0: number; y1: number; slot: number }) => {
      context.fillStyle = QUALITATIVE_BUCKET_COLORS[
        band.slot % QUALITATIVE_BUCKET_COLORS.length
      ];
      const size = Math.max(2, Math.round(MAP_FLAT_DOT_PX * ratio));
      const middle = Math.round(((band.y0 + band.y1) / 2) * ratio);
      context.fillRect(
        Math.round((width - size) / 2),
        Math.max(0, middle - Math.round(size / 2)),
        size,
        size,
      );
    };
    const ordered = [...bands].sort((a, b) => (b.y1 - b.y0) - (a.y1 - a.y0));
    const aside = activeSegment === null ? MAP_BAND_ALPHA : MAP_BAND_ASIDE_ALPHA;
    if (readerMapIsFlat(bands, viewHeight)) {
      context.globalAlpha = MAP_BAND_ALPHA;
      dot(bands[0]);
    } else {
      for (const band of ordered) paint(band, aside);
      for (const band of activeBands) paint(band, MAP_BAND_ALPHA);
    }
    context.globalAlpha = 1;

    // What has not arrived is dark, in the same order the dump says it: the
    // map is the payload, so the part of it nobody is holding has to look
    // like the part of it nobody is holding.
    if (totalBytes > 0 && heldBytes < totalBytes) {
      const edge = Math.round((heldBytes / totalBytes) * height);
      context.fillStyle = rgba(HUD_COLORS.stageGround, MAP_UNHELD_ALPHA);
      context.fillRect(0, edge, width, height - edge);
    }

    // The viewport last, over everything, because it is where the reader is —
    // and because this strip is also the scrollbar, it is the thumb.
    const span = Math.max(1, rowCount * rowHeight);
    const top = Math.round((scrollTop / span) * height);
    const bottom = Math.min(
      height,
      Math.max(top + 2, Math.round(((scrollTop + viewHeight) / span) * height)),
    );
    context.fillStyle = rgba(HUD_COLORS.ink, MAP_VIEWPORT_ALPHA);
    context.fillRect(0, top, width, bottom - top);
    // Its edges are drawn as fills rather than as a stroke: the repo's jsdom
    // 2D stub carries no `strokeRect` at all, and a fill also lands the
    // hairline on the pixel it is asked for instead of half on either side.
    const hair = Math.max(1, Math.round(ratio));
    context.fillStyle = rgba(HUD_COLORS.ink, MAP_VIEWPORT_EDGE_ALPHA);
    context.fillRect(0, top, width, hair);
    context.fillRect(0, bottom - hair, width, hair);
  }, [
    activeBands,
    activeSegment,
    bands,
    heldBytes,
    rowCount,
    rowHeight,
    scrollTop,
    totalBytes,
    viewHeight,
  ]);

  /** Where on the payload the pointer is, over the height this component ASKED
   *  for rather than the height a layout pass reports — the same rule the
   *  virtualiser lives by, and the only form of it jsdom can drive. */
  const scrollFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const top = event.currentTarget.getBoundingClientRect().top;
      const fraction = Math.max(
        0,
        Math.min(1, (event.clientY - top) / Math.max(1, viewHeight)),
      );
      scrollDumpTo(fraction * rowCount * rowHeight - viewHeight / 2);
    },
    [rowCount, rowHeight, scrollDumpTo, viewHeight],
  );

  const onMapPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    draggingMap.current = true;
    // Capture, so a drag that leaves the 8 px strip keeps scrolling instead of
    // stopping the moment the pointer wanders — which on a strip this narrow
    // is immediately. Guarded: jsdom and an older browser may not have it, and
    // the drag still works without it while the pointer stays on the strip.
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* no capture */ }
    scrollFromPointer(event);
  };

  const onMapPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!draggingMap.current) return;
    scrollFromPointer(event);
  };

  const endMapDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    draggingMap.current = false;
    try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* none held */ }
  };

  // ——— COPY ————————————————————————————————————————————————————————————

  const onCopy = async () => {
    const [from, to] = selection === null
      ? [0, bytes.length]
      : [selection.start, Math.min(selection.end, bytes.length)];
    let said: 'COPIED' | 'BLOCKED' = 'COPIED';
    try {
      await navigator.clipboard.writeText(hexRun(bytes, from, to));
    } catch {
      // Headless browsers, insecure origins and a permission the reader never
      // granted all land here. A command that cannot be carried out says so on
      // its own face; it never throws under a card, and it never grows a toast.
      said = 'BLOCKED';
    }
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    setCopied(said);
    copyTimer.current = window.setTimeout(() => setCopied(null), READER_COPY_MS);
  };

  // ——— The dump ————————————————————————————————————————————————————————

  const rows = [];
  for (let row = firstRow; row < lastRow; row += 1) {
    const start = row * READER_BYTES_PER_ROW;
    const hex = [];
    const ascii = [];
    for (let column = 0; column < READER_BYTES_PER_ROW; column += 1) {
      const index = start + column;
      // The last row of a payload that is not a multiple of sixteen: the
      // columns stay, so the row under it lines up.
      if (index >= totalBytes) {
        hex.push(<span key={index} style={{ display: 'inline-block', width: '2ch' }} />);
        ascii.push(<span key={index} style={{ display: 'inline-block', width: '1ch' }} />);
        continue;
      }
      const gap = column === 7 ? '2ch' : column === READER_BYTES_PER_ROW - 1 ? 0 : '1ch';
      // Everything past what the browser holds is a ghost — while the node is
      // still answering AND after it has failed to. Drawing `bytes[i]` there
      // would print a zero somebody could mistake for the Cell's own.
      const present = index < heldBytes && index < bytes.length;
      const owner = segmentIndex[index] ?? -1;
      const color = owner === -1 ? HUD_COLORS.ink : segmentColor(owner);
      const aside = activeSegment !== null && owner !== -1 && owner !== activeSegment;
      const hot = activeSegment !== null && owner === activeSegment;
      const selected = selection !== null
        && index >= selection.start && index < selection.end;
      const caret = selection?.caret === index;
      const wash = selected ? rgba(HUD_COLORS.ink, SELECTION_WASH_ALPHA) : undefined;
      if (!present) {
        hex.push(
          <span
            key={index}
            data-cell-data-reader-byte={index}
            data-cell-data-reader-ghost="true"
            style={{
              display: 'inline-block',
              width: '2ch',
              marginRight: gap,
              color: HUD_COLORS.dim,
              opacity: REVEAL_GHOST_OPACITY,
            }}
          >
            ··
          </span>,
        );
        ascii.push(
          <span
            key={index}
            data-cell-data-reader-char={index}
            data-cell-data-reader-ghost="true"
            style={{
              display: 'inline-block',
              width: '1ch',
              color: HUD_COLORS.dim,
              opacity: REVEAL_GHOST_OPACITY,
            }}
          >
            ·
          </span>,
        );
        continue;
      }
      const glyph = readerByte(bytes[index]);
      hex.push(
        <span
          key={index}
          data-cell-data-reader-byte={index}
          style={{
            display: 'inline-block',
            width: '2ch',
            marginRight: gap,
            color,
            opacity: aside ? SEGMENT_ASIDE_OPACITY : 1,
            background: wash,
            outline: caret ? `1px solid ${HUD_COLORS.cyanWire}` : undefined,
            outlineOffset: caret ? -1 : undefined,
            textShadow: hot ? `0 0 5px ${color}` : undefined,
            cursor: 'text',
          }}
        >
          {glyph.hex}
        </span>,
      );
      ascii.push(
        <span
          key={index}
          data-cell-data-reader-char={index}
          style={{
            display: 'inline-block',
            width: '1ch',
            color: glyph.printable ? color : HUD_COLORS.dim,
            opacity: aside ? SEGMENT_ASIDE_OPACITY : 1,
            background: wash,
            cursor: 'text',
          }}
        >
          {glyph.ascii}
        </span>,
      );
    }
    rows.push(
      <div
        key={row}
        data-cell-data-reader-row={row}
        style={{
          position: 'absolute',
          top: row * rowHeight,
          left: 4,
          right: 0,
          height: rowHeight,
          display: 'flex',
          alignItems: 'center',
          whiteSpace: 'pre',
        }}
      >
        <span style={{ width: '5ch', color: HUD_COLORS.dim }}>
          {formatReaderOffset(start)}
        </span>
        <span style={{ display: 'flex', marginLeft: '2ch' }}>{hex}</span>
        <span style={{ display: 'flex', marginLeft: '2ch' }}>{ascii}</span>
      </div>,
    );
  }

  return (
    <div
      data-cell-data-reader="true"
      data-cell-data-reader-phase={phase}
      data-cell-data-reader-rows={rowCount}
      data-cell-data-reader-first-row={firstRow}
      data-cell-data-reader-hash={dataHash ?? undefined}
      data-cell-data-reader-selection={selection === null
        ? undefined
        : `${selection.start}:${selection.end}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        color: HUD_COLORS.ink,
        fontFamily: HUD_FONTS.mono,
      }}
    >
      <SpatialPlateHeader
        en="CKBYTES"
        cjk="字节元"
        accent={HUD_COLORS.cyanWire}
        titleColor={HUD_COLORS.cyanInk}
        marginBottom={6}
        status={(
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
            whiteSpace: 'nowrap',
          }}
          >
            {/* The only command left. What it copies follows what is selected,
                so it needs no second button to say which.

                It is also a control OVER GHOSTED CONTENT while the walk is
                still on its way to the bytes, so it ghosts with them: a lit
                COPY over a dark dump offers to put on the clipboard a payload
                the card has not finished saying it holds. The module tag
                beside it stays lit, because a plate's own number is not
                evidence about the Cell — it is how the card is counted off. */}
            <button
              type="button"
              data-cell-data-reader-copy="true"
              disabled={!bytesLit}
              onClick={() => void onCopy()}
              style={{ ...commandButtonStyle(), ...revealStageStyle(bytesLit) }}
            >
              {copied ?? 'COPY'}
            </button>
            {moduleTag('SCAN·02')}
          </span>
        )}
      />

      {/* THE READING, over the bytes it reads.

          Mounted only when there IS one: a Cell nobody indexed has no reading,
          and a slot rendered empty for it would be six pixels of nothing
          between the header and the dump on ~98% of the cards this zone opens
          on. The window inside stages itself on the card's clock — it is lit
          before the bytes are, which is the order the card is read in: what
          these bytes are, then the bytes. */}
      {reading != null ? (
        <div
          data-cell-data-reader-reading="true"
          style={{ minWidth: 0, marginBottom: 6 }}
        >
          {reading}
        </div>
      ) : null}

      {/* ONE STAGE FOR THE BYTES. The dump, its map and the foot line light
          together, at the instant the reading finishes decoding — they are one
          claim (here are the bytes, here is the one under your pointer) and a
          foot line that lit before the rows it reads would be a caption under
          a ghost. The frame, the header and the reading are NOT in here: a
          plate that draws itself is not evidence, and the reading has a walk of
          its own. The reveal state rides this wrapper rather than the section,
          so what the attribute names is the thing that actually stages — and a
          reader nobody walks reports no state at all, because "there is no
          walk" and "the walk finished" are different answers and only one of
          them is evidence. The wrapper itself is in every frame either way:
          mount at final geometry. */}
      <div
        data-cell-data-reader-reveal-state={staged
          ? (bytesLit ? 'resolved' : 'scanning')
          : undefined}
        {...(staged ? revealStageAttributes(bytesLit) : {})}
        style={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          minHeight: 0,
          ...(staged ? revealStageStyle(bytesLit) : null),
        }}
      >
        {/* The dump and its bar. Two tracks when the map is drawn, one when it
            is not — a hidden map that still held its 8 px track and its seam
            would leave a fourteen-pixel gutter of nothing between the frame's
            edge and the zone's, which is the same complaint one rank smaller. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: showsMap
            ? `minmax(0,1fr) ${READER_MAP_WIDTH_PX}px`
            : 'minmax(0,1fr)',
          columnGap: 6,
          alignItems: 'start',
          minWidth: 0,
        }}
        >
          <div
            ref={dumpRef}
            className={READER_DUMP_CLASS}
            data-cell-data-reader-dump="true"
            aria-label="Cell output data, sixteen bytes to a row"
            tabIndex={0}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            onKeyDown={onDumpKeyDown}
            onClick={(event) => {
              const index = byteFromEvent(event.target);
              if (index === null) return;
              moveCaret(index, event.shiftKey);
              dumpRef.current?.focus({ preventScroll: true });
            }}
            onMouseOver={(event) => {
              const index = byteFromEvent(event.target);
              if (index === null) return;
              hoverRef.current = index;
              paintFoot();
            }}
            onMouseLeave={() => {
              if (hoverRef.current === null) return;
              hoverRef.current = null;
              paintFoot();
            }}
            style={{
              position: 'relative',
              width: `calc(${READER_ROW_CH}ch + 8px)`,
              height: viewHeight,
              paddingRight: 8,
              overflowY: 'auto',
              overflowX: 'hidden',
              // A wheel that runs out of dump stops there rather than taking the
              // scene's camera with it.
              overscrollBehavior: 'contain',
              border: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.12)}`,
              background: rgba(HUD_COLORS.stageGround, 0.38),
              fontFamily: HUD_FONTS.mono,
              fontSize: HUD_TYPE.label,
              letterSpacing: 0.35,
              lineHeight: 1.5,
            }}
          >
            {/* The spacer carries the whole payload's height, so the map beside
                it tells the truth about a 37 KB Cell while forty rows exist. */}
            <div style={{ position: 'relative', height: rowCount * rowHeight }}>
              {rows}
            </div>
          </div>

          {showsMap && (
            <canvas
              ref={mapRef}
              data-cell-data-reader-map="true"
              aria-hidden="true"
              onPointerDown={onMapPointerDown}
              onPointerMove={onMapPointerMove}
              onPointerUp={endMapDrag}
              onPointerCancel={endMapDrag}
              style={{
                display: 'block',
                width: READER_MAP_WIDTH_PX,
                height: viewHeight,
                background: HUD_COLORS.trackGround,
                cursor: 'pointer',
                touchAction: 'none',
              }}
            />
          )}
        </div>

        {/* One line, and the whole of what the rail, the READS AS block and the
            inspector strip used to say between them. Its children are written by
            `paintFoot` and never by React — see the comment over it. */}
        <div
          ref={footRef}
          data-cell-data-reader-foot="true"
          style={{
            height: 16,
            marginTop: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: HUD_FONTS.mono,
            fontSize: HUD_TYPE.micro,
            letterSpacing: 0.6,
            lineHeight: '16px',
            color: HUD_COLORS.dim,
          }}
        />
      </div>
    </div>
  );
}
