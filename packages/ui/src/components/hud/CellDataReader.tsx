import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import type { Cell, SemanticContentSegment } from '@cknerv/types';
import {
  READER_BYTES_PER_ROW,
  READER_OVERSCAN_ROWS,
  buildSegmentIndex,
  formatReaderInteger,
  formatReaderOffset,
  inspectSelection,
  readerByte,
  readerByteMapBands,
  readerKeyStep,
  readerRowWindow,
  segmentColorSlots,
} from '../../derives/cellDataReader.derive';
import type { CellOutputDataPhase } from '../../hooks/useCellOutputData';
import {
  HUD_COLORS,
  HUD_FONTS,
  HUD_TYPE,
  QUALITATIVE_BUCKET_COLORS,
  rgba,
} from './hudTheme';
import {
  CloseButton,
  REVEAL_GHOST_OPACITY,
  SpatialPlateHeader,
  moduleTag,
} from './primitives';

// DATA READER · SCAN·03 — the surface the DATA cluster's RAW row opens into.
//
// The window above it is a PREVIEW: 32 bytes, no offsets, the ASCII printed on
// a line of its own so a byte and its character never sit in one row, and one
// decoded segment at a time behind a stepper. That is the right shape for a
// glance and the wrong one for reading, and for the 93 staged Cells whose
// payload outruns the held prefix it is not even a glance — the bytes are not
// in the browser at all.
//
// So this is a hex dump in the form every hex tool has had since `od`: sixteen
// bytes to a row, a fixed six-digit offset gutter, the same sixteen bytes as
// characters on the SAME line, every decoded segment listed at once as a table
// of contents, a scale map of the whole payload beside it, and a strip that
// reads whatever is selected as the little-endian integers CKB actually writes.
//
// Three constraints shape every line of it, and all three come from the card
// this row hangs under rather than from the reader:
//
//   MOUNT AT FINAL GEOMETRY. The plate's height is `visibleRows × rowHeight`
//   for a Cell of eight bytes and for one of 37,314, and rows past the held
//   prefix stand as ghosts until the node answers and then fill IN PLACE.
//   Nothing under a reader may move while it is being read.
//
//   THE NUMBERS ARE HANDED IN. `visibleRows` and the row height are props and
//   constants, never measurements: jsdom lays nothing out, and a virtualiser
//   that asked `getBoundingClientRect` which row it was on could not be driven
//   by a test at all. The only layout fact this file reads back is
//   `scrollTop`, which is a scroll position rather than a measurement.
//
//   ONE COLOUR RULE. A segment's slot comes from `segmentColorSlots`, the same
//   function the DATA window and the portrait's byte rail ask, so a reader
//   moving their eye between the three surfaces is reading one claim about the
//   same bytes rather than three.
//
// HEX ONLY (the user's E4 ruling, 2026-09-04): there is no TEXT view and no
// image view. The inspector's UTF-8 field is where a reader asks what a range
// says as text, over a range they chose — which is a question about a
// selection, not a second rendering of the payload.

/** The dump's row height. `label` is the dossier's evidence register (the
 *  user's E2 ruling) and 1.5 is the line height a dump needs for its ASCII
 *  column to sit level with its hex. Exported because the panel sizes the
 *  whole row from it before this component exists. */
export const READER_ROW_HEIGHT_PX = HUD_TYPE.label * 1.5;

/**
 * Everything in this reader that is not a row of bytes, in pixels.
 *
 * The reader stands beside the analysis plate and is as tall as it (the user's
 * ruling of 2026-09-05), so the dump gets the plate's height MINUS this, and
 * the caller divides the remainder into rows. Reservation math only — the
 * browser lays the real thing out — and deliberately the generous reading of
 * every term, because a chrome one pixel short is a reader one row taller than
 * the plate it was supposed to match, and a row that pushes the card down is
 * the exact defect this number exists to stop.
 *
 * Line by line, top to bottom, at the type each part prints:
 *
 *     the section's padding, top and bottom            8 + 10
 *     plate header line box (`section`, 10.5 bold)         14
 *     the header's margin-bottom                            7
 *     the loading bar and its margin               2 + 5 = 7
 *     the dump's border, top and bottom                 1 + 1
 *     inspector margin, padding and its rule        7 + 5 + 1
 *     the inspector's own two line boxes (`label`)     2 × 14
 *     the commands row's margin-top                         7
 *     a command control (input: text + padding + border)   19
 *                                                       —————
 *                                                         117
 *
 * Two terms are worth naming. The LOADING BAR is counted even though it only
 * exists while the node is being asked: a dump that lost a row the moment the
 * bar appeared would move the bytes somebody was reading, which is the one
 * thing this card forbids, so the slot is reserved in every phase. And the
 * INSPECTOR is reserved for TWO lines because it wraps: a selection reads as
 * `OFF · LEN · SEG · u8 · u16 · u32 · u64 · u128 · UTF-8`, and at this column
 * width that is more than one line of `label`.
 */
export const READER_CHROME_PX = 117;

/** A row's width in characters, and the reason the dump is a fixed measure:
 *
 *      6 offset + 2 gap + 48 hex (16×2 with its group gaps) + 2 gap + 16 ASCII
 *
 *  Share Tech Mono's advance is 0.54 em, so 74 ch is 360 px at `label` — and
 *  the card's inner width is 704, which is what leaves the rail its ~330. */
const READER_ROW_CH = 74;

/** The byte map's width. Narrow enough to be a gutter rather than a column,
 *  wide enough that a one-pixel band is still a band. */
const READER_MAP_WIDTH_PX = 14;

/** How long a command's answer stands. Long enough to read six words, short
 *  enough that it is plainly an acknowledgement and not a state. */
const READER_TOAST_MS = 2400;

/** Characters of the data hash the status line shows. Ten is what makes two
 *  different Cells look different at a glance; the whole hash is in the title,
 *  because a truncated hash is a landmark and not a value. */
const READER_HASH_HEAD = 10;

/** The inspector's text field, in characters. A selection can be the whole
 *  payload, and the strip is one line. */
const READER_UTF8_COLUMNS = 40;

/** What a segment's bytes fall to while ANOTHER segment is selected. The DATA
 *  window's own number, so the two surfaces dim alike. Bytes no segment claims
 *  never dim: they are not being contrasted with anything. */
const SEGMENT_ASIDE_OPACITY = 0.34;

/** The map's ground, its bands, and the wash over what has not arrived. Canvas
 *  alpha rather than a rule's, which is a different question from the border
 *  rungs the overlay declares — a band is a surface being painted, not a line
 *  between two blocks. */
const MAP_TRACK_ALPHA = 0.22;
const MAP_BAND_ALPHA = 0.9;
const MAP_BAND_ASIDE_ALPHA = 0.35;
const MAP_UNHELD_ALPHA = 0.82;
const MAP_VIEWPORT_ALPHA = 0.16;
const MAP_VIEWPORT_EDGE_ALPHA = 0.5;

/** The selection's wash and the caret's outline, in the window's own alphas. */
const SELECTION_WASH_ALPHA = 0.16;

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
 * bare caret is the one-byte range at it: the inspector reads a caret as a
 * byte, so there is no third state where something is selected and nothing is.
 */
interface ReaderSelection {
  caret: number;
  /** Where a Shift-extended range grows FROM. */
  anchor: number;
  start: number;
  end: number;
  /** Set only when the selection came from the table of contents. A segment
   *  selection dims its neighbours; a hand-made range does not, because the
   *  reader who dragged it is not asking about the decode. */
  segment: number | null;
}

function caretAt(byte: number): ReaderSelection {
  return { caret: byte, anchor: byte, start: byte, end: byte + 1, segment: null };
}

/** The DATA window's control grammar, in the word-width the commands need.
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

/** One entry in the table of contents. Selected wears the plate's accent on
 *  its leading edge — the same lit-edge idiom the plates themselves wear. */
function segmentButtonStyle(selected: boolean): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: '8px minmax(0,1fr) auto',
    columnGap: 6,
    alignItems: 'baseline',
    textAlign: 'left',
    minWidth: 0,
    margin: 0,
    padding: '2px 4px',
    border: 0,
    borderLeft: `1px solid ${selected ? HUD_COLORS.cyanWire : 'transparent'}`,
    background: selected ? rgba(HUD_COLORS.cyanWire, 0.06) : 'transparent',
    color: HUD_COLORS.ink,
    fontFamily: HUD_FONTS.mono,
    fontSize: HUD_TYPE.label,
    letterSpacing: 0.35,
    cursor: 'pointer',
  };
}

/** The strip's key, in the tech voice the whole card names a reading in. */
const inspectKeyStyle: CSSProperties = {
  marginRight: 5,
  fontFamily: HUD_FONTS.tech,
  fontSize: HUD_TYPE.micro,
  letterSpacing: 1.4,
  color: HUD_COLORS.dim,
};

export interface CellDataReaderProps {
  /** Whose bytes these are. Read for identity only: a new subject clears the
   *  selection and returns the dump to its top, so nothing carries over from
   *  the Cell before it. */
  cell: Cell;
  segments: readonly SemanticContentSegment[];
  decode: { kind: string; summary: string } | null;
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
  /** Where to open. The DATA window's stepper hands a segment's first byte
   *  over when it steps past the preview. */
  openAtByte: number | null;
  visibleRows: number;
  reduced: boolean;
  onClose: () => void;
}

export default function CellDataReader({
  cell,
  segments,
  decode,
  bytes,
  heldBytes,
  totalBytes,
  phase,
  message,
  dataHash,
  live,
  openAtByte,
  visibleRows,
  reduced,
  onClose,
}: CellDataReaderProps) {
  const dumpRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<HTMLCanvasElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [gotoText, setGotoText] = useState('');
  const [toast, setToast] = useState<{ text: string; bad: boolean } | null>(null);
  const toastTimer = useRef<number | null>(null);

  const rowHeight = READER_ROW_HEIGHT_PX;
  const viewHeight = visibleRows * rowHeight;
  const { firstRow, lastRow, rowCount } = readerRowWindow(
    scrollTop,
    rowHeight,
    totalBytes,
    visibleRows,
    READER_OVERSCAN_ROWS,
  );

  const slots = useMemo(() => segmentColorSlots(segments), [segments]);
  const segmentIndex = useMemo(
    () => buildSegmentIndex(segments, totalBytes),
    [segments, totalBytes],
  );
  const unmappedBytes = useMemo(() => {
    let count = 0;
    for (let index = 0; index < segmentIndex.length; index += 1) {
      if (segmentIndex[index] === -1) count += 1;
    }
    return count;
  }, [segmentIndex]);
  const segmentColor = useCallback(
    (index: number): string => QUALITATIVE_BUCKET_COLORS[
      (slots[index] ?? 0) % QUALITATIVE_BUCKET_COLORS.length
    ],
    [slots],
  );

  // ——— Scrolling ————————————————————————————————————————————————————————
  // The dump's scroll position is React state as well as a DOM property. It
  // has to be both: a wheel moves the element and the handler catches up, but
  // GO TO, a segment click and a caret step move it from here — and setting
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

  // A new Cell is a new subject: the selection and the scroll belong to the
  // bytes that are leaving, not to the ones arriving.
  useEffect(() => {
    setSelection(null);
    const dump = dumpRef.current;
    if (dump) dump.scrollTop = 0;
    setScrollTop(0);
  }, [cell.id]);

  // The stepper's hand-off. `openAtByte` is a segment's first byte, so the row
  // goes to the TOP rather than merely into view: the reader was sent here to
  // read forward from it.
  useEffect(() => {
    if (openAtByte === null) return;
    const byte = Math.max(
      0,
      Math.min(Math.max(0, totalBytes - 1), Math.trunc(openAtByte)),
    );
    setSelection(caretAt(byte));
    scrollRowToTop(Math.floor(byte / READER_BYTES_PER_ROW));
  }, [cell.id, openAtByte, scrollRowToTop, totalBytes]);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  const say = useCallback((text: string, bad: boolean) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast({ text, bad });
    toastTimer.current = window.setTimeout(() => setToast(null), READER_TOAST_MS);
  }, []);

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
    keepByteInView(clamped);
  }, [keepByteInView, totalBytes]);

  const selectSegment = useCallback((index: number) => {
    const segment = segments[index];
    if (!segment) return;
    const start = Math.max(0, Math.min(totalBytes, segment.start_byte));
    const end = Math.max(start, Math.min(totalBytes, segment.end_byte));
    setSelection({ caret: start, anchor: start, start, end, segment: index });
    scrollRowToTop(Math.floor(start / READER_BYTES_PER_ROW));
  }, [scrollRowToTop, segments, totalBytes]);

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
    const step = readerKeyStep(event.key, visibleRows);
    if (step === null) return;
    event.preventDefault();
    const from = selection?.caret ?? 0;
    if (step === 'home') { moveCaret(0, event.shiftKey); return; }
    if (step === 'end') { moveCaret(totalBytes - 1, event.shiftKey); return; }
    moveCaret(from + step, event.shiftKey);
  };

  // ——— The byte map ————————————————————————————————————————————————————
  // Painted rather than laid out: 2,333 rows of payload compressed into 324
  // pixels is a scale drawing, and a scale drawing made of DOM nodes would be
  // hundreds of elements saying one thing.

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
    // outright; either way the map is decoration over a list that says the
    // same thing in words, so a missing context is a no-op rather than a throw.
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
    const ordered = [...bands].sort((a, b) => (b.y1 - b.y0) - (a.y1 - a.y0));
    const aside = activeSegment === null ? MAP_BAND_ALPHA : MAP_BAND_ASIDE_ALPHA;
    for (const band of ordered) paint(band, aside);
    for (const band of activeBands) paint(band, MAP_BAND_ALPHA);
    context.globalAlpha = 1;

    // What has not arrived is dark, in the same order the dump says it: the
    // map is the payload, so the part of it nobody is holding has to look
    // like the part of it nobody is holding.
    if (totalBytes > 0 && heldBytes < totalBytes) {
      const edge = Math.round((heldBytes / totalBytes) * height);
      context.fillStyle = rgba(HUD_COLORS.stageGround, MAP_UNHELD_ALPHA);
      context.fillRect(0, edge, width, height - edge);
    }

    // The viewport last, over everything, because it is where the reader is.
    const span = Math.max(1, rowCount * rowHeight);
    const top = Math.round((scrollTop / span) * height);
    const bottom = Math.min(
      height,
      Math.max(top + 2, Math.round(((scrollTop + viewHeight) / span) * height)),
    );
    context.fillStyle = rgba(HUD_COLORS.ink, MAP_VIEWPORT_ALPHA);
    context.fillRect(0, top, width, bottom - top);
    // Its edges are drawn as fills rather than as a stroke: one primitive
    // fewer to depend on, and a hairline that lands on the pixel it is asked
    // for instead of half on either side of it.
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

  const onMapClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    // `offsetY` over the height this component ASKED for, never the height a
    // layout pass reports: the same rule the virtualiser lives by.
    const fraction = Math.max(0, Math.min(1, event.nativeEvent.offsetY / viewHeight));
    scrollDumpTo(fraction * rowCount * rowHeight - viewHeight / 2);
  };

  // ——— Commands ————————————————————————————————————————————————————————

  const copy = async (text: string, said: string) => {
    try {
      await navigator.clipboard.writeText(text);
      say(said, false);
    } catch {
      // Headless browsers, insecure origins and a permission the reader never
      // granted all land here. A command that cannot be carried out says so;
      // it never throws under a card.
      say('CLIPBOARD BLOCKED HERE', true);
    }
  };

  const onGotoKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const raw = gotoText.trim().replace(/^0x/i, '');
    if (!/^[0-9a-f]+$/i.test(raw)) { say('HEX OFFSET, E.G. 0x1F0', true); return; }
    const offset = Number.parseInt(raw, 16);
    if (!Number.isInteger(offset) || offset >= totalBytes) {
      say(`BEYOND ${formatReaderInteger(totalBytes)} B`, true);
      return;
    }
    setSelection(caretAt(offset));
    scrollRowToTop(Math.floor(offset / READER_BYTES_PER_ROW));
  };

  // ——— The status line ——————————————————————————————————————————————————

  const numberInk: CSSProperties = { color: HUD_COLORS.ink };
  const hashTitle = [
    dataHash,
    live === null ? null : live
      ? 'READ FROM THE LIVE CELL'
      : 'READ FROM THE TRANSACTION THAT CREATED IT',
  ].filter((part): part is string => part !== null).join(' · ');

  let stateLine: ReactNode;
  if (phase === 'error') {
    // Not `danger`. A node that could not be asked is a fact about the scope
    // of our knowledge, not a condition of the Cell — the same ruling the
    // window's own byte count already carries.
    stateLine = <span>{message ?? 'NO BYTES FROM THE NODE'}</span>;
  } else if (phase === 'loading') {
    stateLine = (
      <span>
        READING <span style={numberInk}>{formatReaderInteger(totalBytes)} B</span>
        {' FROM NODE · '}
        <span style={numberInk}>{formatReaderInteger(heldBytes)} B</span> HELD
      </span>
    );
  } else {
    stateLine = (
      <span title={hashTitle.length > 0 ? hashTitle : undefined}>
        <span style={numberInk}>{formatReaderInteger(totalBytes)} B</span>
        {' · '}
        {/* The one word here that is a state rather than a reading: the
            payload on screen IS the payload. */}
        <span style={{ color: HUD_COLORS.nominal }}>COMPLETE</span>
        {phase === 'ready' && dataHash
          ? <>{' · NODE · '}{dataHash.slice(0, READER_HASH_HEAD)}…</>
          : ' · HELD'}
      </span>
    );
  }

  // ——— The inspector strip —————————————————————————————————————————————

  const inspection = selection === null
    ? null
    : inspectSelection(bytes, selection.start, selection.end, segmentIndex);
  const readings: { key: string; value: string; color: string; title?: string }[] = [];
  if (inspection !== null && selection !== null) {
    readings.push({
      key: 'OFF',
      value: `0x${formatReaderOffset(selection.start)}`,
      color: HUD_COLORS.goldInk,
    });
    readings.push({
      key: 'LEN',
      value: `${formatReaderInteger(selection.end - selection.start)} B`,
      color: HUD_COLORS.goldInk,
    });
    if (inspection.segment !== null) {
      readings.push({
        key: 'SEG',
        value: readableKind(segments[inspection.segment]?.label ?? ''),
        color: segmentColor(inspection.segment),
      });
    }
    const fixed: [string, number | bigint | undefined][] = [
      ['u8', inspection.u8],
      ['u16 LE', inspection.u16],
      ['u32 LE', inspection.u32],
      ['u64 LE', inspection.u64],
      ['u128 LE', inspection.u128],
    ];
    for (const [name, value] of fixed) {
      if (value === undefined) continue;
      readings.push({
        key: name,
        value: formatReaderInteger(value),
        color: HUD_COLORS.goldInk,
      });
    }
    if (inspection.range !== undefined) {
      readings.push({
        key: `u${inspection.length * 8} LE`,
        value: formatReaderInteger(inspection.range),
        color: HUD_COLORS.goldInk,
      });
    }
    readings.push({
      key: 'UTF-8',
      value: inspection.utf8,
      color: HUD_COLORS.ink,
      title: inspection.utf8,
    });
  }

  // ——— The dump ————————————————————————————————————————————————————————

  const rows: ReactNode[] = [];
  for (let row = firstRow; row < lastRow; row += 1) {
    const start = row * READER_BYTES_PER_ROW;
    const hex: ReactNode[] = [];
    const ascii: ReactNode[] = [];
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
        <span style={{ width: '6ch', color: HUD_COLORS.dim }}>
          {formatReaderOffset(start)}
        </span>
        <span style={{ display: 'flex', marginLeft: '2ch' }}>{hex}</span>
        <span style={{ display: 'flex', marginLeft: '2ch' }}>{ascii}</span>
      </div>,
    );
  }

  const heldFraction = totalBytes > 0
    ? Math.max(0, Math.min(1, heldBytes / totalBytes))
    : 1;

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
      style={{ minWidth: 0, color: HUD_COLORS.ink, fontFamily: HUD_FONTS.mono }}
    >
      <SpatialPlateHeader
        en="DATA READER"
        cjk="字节元"
        accent={HUD_COLORS.cyanWire}
        titleColor={HUD_COLORS.cyanInk}
        status={(
          <span
            data-cell-data-reader-state="true"
            style={{
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: 6,
              minWidth: 0,
              whiteSpace: 'nowrap',
              fontFamily: HUD_FONTS.mono,
              fontSize: HUD_TYPE.micro,
              letterSpacing: 0.6,
              color: HUD_COLORS.dim,
            }}
          >
            {stateLine}
            {moduleTag('SCAN·03')}
            {/* Anchored to the plate the panel wraps around this content, the
                way every other card's close is anchored to its own plate. */}
            <CloseButton onClose={onClose} title="Close the reader" />
          </span>
        )}
      />

      {phase === 'loading' ? (
        <div
          data-cell-data-reader-bar="true"
          style={{ height: 2, marginBottom: 5, background: HUD_COLORS.trackGround }}
        >
          {/* How much of the payload is in hand — a measured fraction rather
              than an indeterminate sweep, because a bar that fills on a timer
              says something about the node nobody measured. It moves once,
              when the answer lands, and not at all under reduced motion. */}
          <span
            style={{
              display: 'block',
              height: '100%',
              width: `${heldFraction * 100}%`,
              background: HUD_COLORS.cyanWire,
              transition: reduced ? undefined : 'width 260ms ease',
            }}
          />
        </div>
      ) : null}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0,1fr)',
        columnGap: 12,
        alignItems: 'start',
        minWidth: 0,
      }}
      >
        <div
          ref={dumpRef}
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
            // Written straight to the node rather than through state: a hover
            // that re-rendered forty rows of the dump would spend a frame per
            // byte the pointer crossed, and React never touches a `title` it
            // was not given.
            const owner = segmentIndex[index] ?? -1;
            const named = owner === -1
              ? ''
              : ` · ${readableKind(segments[owner]?.label ?? '')}`;
            const dump = dumpRef.current;
            if (dump) {
              dump.title = `0x${formatReaderOffset(index)} · byte ${formatReaderInteger(index)}${named}`;
            }
          }}
          style={{
            position: 'relative',
            width: `calc(${READER_ROW_CH}ch + 8px)`,
            height: viewHeight,
            paddingRight: 8,
            overflowY: 'auto',
            overflowX: 'hidden',
            // A wheel that runs out of dump stops there. The trace plate's
            // ledger sits under this row and would otherwise take the rest.
            overscrollBehavior: 'contain',
            border: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.12)}`,
            background: rgba(HUD_COLORS.stageGround, 0.38),
            fontFamily: HUD_FONTS.mono,
            fontSize: HUD_TYPE.label,
            letterSpacing: 0.35,
            lineHeight: 1.5,
          }}
        >
          {/* The spacer carries the whole payload's height, so the scrollbar
              tells the truth about a 37 KB Cell while forty rows exist. */}
          <div style={{ position: 'relative', height: rowCount * rowHeight }}>
            {rows}
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: `${READER_MAP_WIDTH_PX}px minmax(0,1fr)`,
          columnGap: 10,
          alignItems: 'start',
          minWidth: 0,
        }}
        >
          <canvas
            ref={mapRef}
            data-cell-data-reader-map="true"
            aria-hidden="true"
            onClick={onMapClick}
            style={{
              display: 'block',
              width: READER_MAP_WIDTH_PX,
              height: viewHeight,
              background: HUD_COLORS.trackGround,
              cursor: 'pointer',
            }}
          />

          <div style={{ minWidth: 0 }}>
            {segments.length > 0 ? (
              <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                <div style={{
                  marginBottom: 2,
                  fontFamily: HUD_FONTS.tech,
                  fontSize: HUD_TYPE.micro,
                  letterSpacing: 1.4,
                  color: HUD_COLORS.dim,
                }}
                >
                  SEGMENTS · {formatReaderInteger(segments.length)}
                </div>
                {segments.map((segment, index) => (
                  <button
                    key={`${segment.label}:${segment.start_byte}:${index}`}
                    type="button"
                    data-cell-data-reader-segment={index}
                    aria-pressed={activeSegment === index}
                    title={segment.meaning}
                    onClick={() => selectSegment(index)}
                    style={segmentButtonStyle(activeSegment === index)}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 6,
                        height: 6,
                        marginTop: 1,
                        background: segmentColor(index),
                      }}
                    />
                    <span style={{
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: activeSegment === index
                        ? HUD_COLORS.ink
                        : HUD_COLORS.cyanInk,
                    }}
                    >
                      {readableKind(segment.label)}
                    </span>
                    <span style={{
                      whiteSpace: 'nowrap',
                      fontSize: HUD_TYPE.micro,
                      color: HUD_COLORS.dim,
                    }}
                    >
                      [{segment.start_byte}..{segment.end_byte}) ·{' '}
                      {formatReaderInteger(segment.end_byte - segment.start_byte)} B
                    </span>
                    <span
                      title={segment.value}
                      style={{
                        gridColumn: '2 / 4',
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: HUD_TYPE.micro,
                        color: HUD_COLORS.dim,
                      }}
                    >
                      {segment.value}
                    </span>
                  </button>
                ))}
                {unmappedBytes > 0 ? (
                  <div
                    data-cell-data-reader-unmapped={unmappedBytes}
                    style={{
                      marginTop: 4,
                      fontSize: HUD_TYPE.micro,
                      letterSpacing: 0.6,
                      color: HUD_COLORS.dim,
                    }}
                  >
                    UNMAPPED · {formatReaderInteger(unmappedBytes)} B in ink
                  </div>
                ) : null}
              </div>
            ) : (
              <div
                data-cell-data-reader-no-segments="true"
                style={{
                  fontSize: HUD_TYPE.micro,
                  letterSpacing: 0.6,
                  color: HUD_COLORS.dim,
                }}
              >
                NO DECODED SEGMENTS
              </div>
            )}

            {decode ? (
              <div
                data-cell-data-reader-reads="true"
                style={{
                  marginTop: 6,
                  paddingTop: 5,
                  borderTop: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.16)}`,
                  fontSize: HUD_TYPE.micro,
                  letterSpacing: 0.6,
                  lineHeight: 1.45,
                  color: HUD_COLORS.dim,
                  minWidth: 0,
                }}
              >
                READS AS{' '}
                <span style={{ color: HUD_COLORS.nominal }}>
                  {readableKind(decode.kind)}
                </span>
                <span style={{
                  display: 'block',
                  marginTop: 2,
                  fontSize: HUD_TYPE.label,
                  letterSpacing: 0,
                  color: HUD_COLORS.ink,
                  overflowWrap: 'anywhere',
                }}
                >
                  {decode.summary}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div
        data-cell-data-reader-inspect="true"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: '3px 14px',
          marginTop: 7,
          paddingTop: 5,
          borderTop: `1px solid ${rgba(HUD_COLORS.cyanWire, 0.16)}`,
          fontSize: HUD_TYPE.label,
          minWidth: 0,
        }}
      >
        {readings.length === 0 ? (
          <span style={{
            fontSize: HUD_TYPE.micro,
            letterSpacing: 0.6,
            color: HUD_COLORS.dim,
          }}
          >
            SELECT A BYTE, A RANGE OR A SEGMENT · THE STRIP READS THE SELECTION
            AS INTEGERS AND TEXT
          </span>
        ) : readings.map((reading) => (
          <span key={reading.key} style={{ minWidth: 0, whiteSpace: 'nowrap' }}>
            <span style={inspectKeyStyle}>{reading.key}</span>
            <span
              title={reading.title}
              style={{
                display: 'inline-block',
                maxWidth: reading.key === 'UTF-8'
                  ? `${READER_UTF8_COLUMNS}ch`
                  : undefined,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                verticalAlign: 'bottom',
                fontVariantNumeric: 'tabular-nums',
                color: reading.color,
              }}
            >
              {reading.value}
            </span>
          </span>
        ))}
      </div>

      <div
        data-cell-data-reader-commands="true"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '6px 10px',
          marginTop: 7,
          fontSize: HUD_TYPE.micro,
          letterSpacing: 0.6,
          color: HUD_COLORS.dim,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{
            fontFamily: HUD_FONTS.tech,
            fontSize: HUD_TYPE.micro,
            letterSpacing: 1.4,
          }}
          >
            GO TO
          </span>
          <input
            data-cell-data-reader-goto="true"
            aria-label="go to byte offset (hex)"
            value={gotoText}
            onChange={(event) => setGotoText(event.target.value)}
            onKeyDown={onGotoKeyDown}
            style={{
              width: '8ch',
              margin: 0,
              padding: '2px 4px',
              border: `1px solid ${rgba(HUD_COLORS.dim, 0.3)}`,
              background: HUD_COLORS.trackGround,
              color: HUD_COLORS.ink,
              fontFamily: HUD_FONTS.mono,
              fontSize: HUD_TYPE.label,
              letterSpacing: 0.35,
            }}
          />
        </span>
        <button
          type="button"
          data-cell-data-reader-copy="hex"
          onClick={() => void copy(
            hexRun(bytes, 0, bytes.length),
            `COPIED ${formatReaderInteger(bytes.length)} B`,
          )}
          style={commandButtonStyle()}
        >
          COPY HEX
        </button>
        <button
          type="button"
          data-cell-data-reader-copy="selection"
          onClick={() => {
            if (selection === null) { say('NOTHING SELECTED', true); return; }
            void copy(
              hexRun(bytes, selection.start, selection.end),
              `COPIED ${formatReaderInteger(selection.end - selection.start)} B`,
            );
          }}
          style={commandButtonStyle()}
        >
          COPY SEL
        </button>
        {toast ? (
          <span
            data-cell-data-reader-toast="true"
            style={{ color: toast.bad ? HUD_COLORS.caution : HUD_COLORS.nominal }}
          >
            {toast.text}
          </span>
        ) : null}
        {/* In words. `↑` is carried by no face the HUD ships or could ship —
            the JetBrains Mono subset has `← → ↓ ↗` and nothing above them —
            so an arrow legend would be four glyphs resolving out of whatever
            the reader's machine happened to have. */}
        <span
          data-cell-data-reader-keys="true"
          style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}
        >
          ARROWS MOVE · SHIFT EXTENDS · PGUP PGDN · HOME END
        </span>
      </div>
    </div>
  );
}
