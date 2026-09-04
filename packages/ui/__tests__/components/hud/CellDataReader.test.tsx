// CKBYTES · SCAN·02, driven at a fixed viewport.
//
// Every number this file asserts is one the reader was HANDED — `visibleRows`,
// the row height, `totalBytes`, a `scrollTop`, a `clientY` — because jsdom lays
// nothing out and a reader that measured itself could not be driven here at
// all. That is the same property that makes the assertions worth something:
// they are about arithmetic the browser will run identically, not about a
// layout this environment approximates.

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SemanticContentSegment } from '@cknerv/types';

import CellDataReader, {
  READER_ROW_HEIGHT_PX,
  READER_WIDTH_PX,
  type CellDataReaderFocus,
} from '../../../src/components/hud/CellDataReader';
import {
  READER_MAX_VISIBLE_ROWS,
  READER_OVERSCAN_ROWS,
  READER_VISIBLE_ROWS,
  readerRowsUnderScan,
} from '../../../src/derives/cellDataReader.derive';
import { REVEAL_GHOST_OPACITY } from '../../../src/components/hud/primitives';

afterEach(() => { cleanup(); });

/** The largest payload on the staged plane: a 37,314-byte dob/0 spore. */
const SPORE_BYTES = 37_314;

function segment(
  label: string,
  start: number,
  end: number,
  value = 'x',
): SemanticContentSegment {
  return { label, start_byte: start, end_byte: end, meaning: `${label} field`, value };
}

/** A spore's decode, in the byte order the molecule writes it. */
const SPORE_SEGMENTS: SemanticContentSegment[] = [
  segment('total_size', 0, 4, '37314'),
  segment('offset_content_type', 4, 8, '16'),
  segment('offset_content', 8, 12, '26'),
  segment('offset_cluster_id', 12, 16, '37282'),
  segment('content_type', 16, 26, 'image/png'),
  segment('content', 26, 37_282, 'PNG image data'),
  segment('cluster_id', 37_282, 37_314, '0x9f3c…'),
];

function bytesOf(size: number, seed = 3): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (index * 7 + seed) & 0xff;
  return bytes;
}

function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

interface ReaderOverrides {
  segments?: readonly SemanticContentSegment[];
  bytes?: Uint8Array;
  heldBytes?: number;
  totalBytes?: number;
  phase?: 'held' | 'loading' | 'ready' | 'error';
  message?: string | null;
  dataHash?: string | null;
  live?: boolean | null;
  visibleRows?: number;
  focus?: CellDataReaderFocus | null;
  onFocusChange?: (segment: number | null) => void;
}

function reader(overrides: ReaderOverrides = {}) {
  const bytes = overrides.bytes ?? bytesOf(SPORE_BYTES);
  const onFocusChange = overrides.onFocusChange ?? vi.fn();
  const view = render(
    <CellDataReader
      segments={overrides.segments ?? SPORE_SEGMENTS}
      bytes={bytes}
      heldBytes={overrides.heldBytes ?? bytes.length}
      totalBytes={overrides.totalBytes ?? bytes.length}
      phase={overrides.phase ?? 'held'}
      message={overrides.message ?? null}
      dataHash={overrides.dataHash ?? null}
      live={overrides.live ?? null}
      visibleRows={overrides.visibleRows ?? READER_VISIBLE_ROWS}
      focus={overrides.focus ?? null}
      onFocusChange={onFocusChange}
    />,
  );
  return { ...view, onFocusChange };
}

function root(container: HTMLElement): HTMLElement {
  const element = container.querySelector('[data-cell-data-reader="true"]');
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

function dumpOf(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-cell-data-reader-dump]') as HTMLElement;
}

function footOf(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-cell-data-reader-foot]') as HTMLElement;
}

/** The foot line as the sentence a reader sees, with its mode. */
function footReads(container: HTMLElement): { mode: string | null; text: string } {
  const foot = footOf(container);
  return {
    mode: foot.getAttribute('data-cell-data-reader-foot-mode'),
    text: foot.textContent ?? '',
  };
}

function rowsOf(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('[data-cell-data-reader-row]'))
    .map((row) => Number(row.getAttribute('data-cell-data-reader-row')));
}

function byteCell(container: HTMLElement, index: number): HTMLElement {
  const element = container.querySelector(`[data-cell-data-reader-byte="${index}"]`);
  expect(element, `byte ${index} is not mounted`).not.toBeNull();
  return element as HTMLElement;
}

/** Scroll the way a wheel does: the element moves, then it says so. */
function scrollTo(dump: HTMLElement, top: number): void {
  dump.scrollTop = top;
  fireEvent.scroll(dump);
}

describe('CellDataReader', () => {
  it('mounts the visible rows and their overscan, and no more of 2,333', () => {
    const { container } = reader();

    expect(root(container).getAttribute('data-cell-data-reader-rows')).toBe('2333');
    const rows = rowsOf(container);
    expect(rows).toHaveLength(READER_VISIBLE_ROWS + 2 * READER_OVERSCAN_ROWS);
    expect(rows[0]).toBe(0);
    expect(rows[rows.length - 1]).toBe(39);
    // 2,333 rows of sixteen hex cells and sixteen characters would be 74,656
    // nodes; the DOM holds forty rows' worth.
    expect(container.querySelectorAll('[data-cell-data-reader-byte]'))
      .toHaveLength(40 * 16);
  });

  it('gutters every row at its own offset, five digits wide', () => {
    // Five reaches 0xFFFFF, and no CKB payload does. Six was a guess made
    // before anybody asked how big the number could be, and under a 408 px
    // zone the column it cost is a column the row needs.
    const { container } = reader();
    const row = container.querySelector('[data-cell-data-reader-row="10"]');
    expect(row?.firstElementChild?.textContent).toBe('000A0');
    expect(container.querySelector('[data-cell-data-reader-row="0"]')
      ?.firstElementChild?.textContent).toBe('00000');
  });

  it('re-windows the rows when the dump is scrolled', () => {
    const { container } = reader();
    const dump = dumpOf(container);

    scrollTo(dump, 100 * READER_ROW_HEIGHT_PX);

    const rows = rowsOf(container);
    expect(rows[0]).toBe(100 - READER_OVERSCAN_ROWS);
    expect(rows).toHaveLength(READER_VISIBLE_ROWS + 2 * READER_OVERSCAN_ROWS);
    expect(root(container).getAttribute('data-cell-data-reader-first-row'))
      .toBe(String(100 - READER_OVERSCAN_ROWS));
  });

  it('moves the caret by a row on ArrowDown and extends it on Shift', () => {
    const { container } = reader();
    const dump = dumpOf(container);

    fireEvent.click(byteCell(container, 32));
    expect(root(container).getAttribute('data-cell-data-reader-selection')).toBe('32:33');

    fireEvent.keyDown(dump, { key: 'ArrowDown' });
    expect(root(container).getAttribute('data-cell-data-reader-selection')).toBe('48:49');

    fireEvent.keyDown(dump, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(dump, { key: 'ArrowRight', shiftKey: true });
    // Extended FROM the anchor the caret was dropped at, not from where it
    // happens to be now.
    expect(root(container).getAttribute('data-cell-data-reader-selection')).toBe('48:51');
    expect(footReads(container).text).toContain('+3 B');
  });

  it('stands the rows past the held prefix as ghosts, and fills them in place', () => {
    const whole = bytesOf(96);
    const { container, rerender } = reader({
      bytes: whole.slice(0, 32),
      heldBytes: 32,
      totalBytes: 96,
      phase: 'loading',
      segments: [],
    });

    const before = rowsOf(container);
    expect(container.querySelectorAll('[data-cell-data-reader-ghost]'))
      .toHaveLength((96 - 32) * 2);
    expect(byteCell(container, 40).textContent).toBe('··');
    expect(byteCell(container, 40).style.opacity).toBe(String(REVEAL_GHOST_OPACITY));

    rerender(
      <CellDataReader
        segments={[]}
        bytes={whole}
        heldBytes={96}
        totalBytes={96}
        phase="ready"
        message={null}
        dataHash={`0x${'ef'.repeat(32)}`}
        live
        visibleRows={READER_VISIBLE_ROWS}
        focus={null}
      />,
    );

    // Nothing moved: the same rows, in the same places, with ink where the
    // ghosts were.
    expect(rowsOf(container)).toEqual(before);
    expect(container.querySelectorAll('[data-cell-data-reader-ghost]')).toHaveLength(0);
    expect(byteCell(container, 40).textContent).toBe(
      whole[40].toString(16).toUpperCase().padStart(2, '0'),
    );
    expect(root(container).getAttribute('data-cell-data-reader-phase')).toBe('ready');
    expect(root(container).getAttribute('data-cell-data-reader-hash'))
      .toBe(`0x${'ef'.repeat(32)}`);
  });

  it('spells nothing with an arrow, because no face the HUD ships carries one', () => {
    // `↑` is carried by no face the HUD ships or could ship — the JetBrains
    // Mono subset has `← → ↓ ↗` and nothing above them.
    const { container } = reader();
    expect(container.textContent).not.toContain('↑');
  });

  it('has no HEX or TEXT view to switch between, and nothing to close', () => {
    // The user's E4 ruling: the reader is hex, full stop. And there is no
    // CLOSE — a zone of a card has nothing of its own to dismiss; Escape
    // closes the card.
    const { container } = reader();
    const controls = Array.from(container.querySelectorAll('button'))
      .map((button) => button.textContent?.trim());
    expect(controls).toEqual(['COPY']);
    expect(container.querySelector('[aria-label="close"]')).toBeNull();
  });

  it('kept nothing the user asked it to put back', () => {
    // The rail, the inspector strip, GO TO, COPY SEL, the toast, the keys
    // legend and the loading bar are gone, and R2-b's panel tests select on
    // what is left — so their absence is pinned here rather than discovered
    // there.
    const { container } = reader({ phase: 'loading', heldBytes: 16 });
    for (const gone of [
      'segment', 'inspect', 'goto', 'keys', 'toast', 'bar', 'commands',
      'state', 'reads', 'unmapped', 'no-segments',
    ]) {
      expect(
        container.querySelector(`[data-cell-data-reader-${gone}]`),
        `data-cell-data-reader-${gone} is still mounted`,
      ).toBeNull();
    }
    // …and what is left, all of it, on one Cell.
    for (const kept of ['dump', 'map', 'foot', 'copy']) {
      expect(
        container.querySelector(`[data-cell-data-reader-${kept}]`),
        `data-cell-data-reader-${kept} is missing`,
      ).not.toBeNull();
    }
  });

  it('takes a focus as the first row, the selection and the glow', () => {
    const { container } = reader({
      focus: { start: 16, end: 26, segment: 4, nonce: 1 },
    });

    // `content_type` starts at byte 16, which is row 1, and the row goes to
    // the top of the dump — overscan puts row 0 back on screen.
    expect(root(container).getAttribute('data-cell-data-reader-first-row')).toBe('0');
    expect(root(container).getAttribute('data-cell-data-reader-selection')).toBe('16:26');

    // Its own bytes are lit; every OTHER segment's fall away; bytes no segment
    // claims are not being contrasted with anything and stay in ink.
    expect(byteCell(container, 16).style.opacity).toBe('1');
    expect(byteCell(container, 16).style.textShadow).not.toBe('');
    expect(byteCell(container, 0).style.opacity).toBe('0.34');
  });

  it('re-applies a focus on its nonce, so the same row can be clicked twice', () => {
    // §4's trap: a reader who scrolled away and clicked the same row again is
    // asking to be taken back, and an effect keyed on the range would not fire.
    const props = {
      segments: SPORE_SEGMENTS,
      bytes: bytesOf(SPORE_BYTES),
      heldBytes: SPORE_BYTES,
      totalBytes: SPORE_BYTES,
      phase: 'held' as const,
      message: null,
      dataHash: null,
      live: null,
      visibleRows: READER_VISIBLE_ROWS,
    };
    const focus = { start: 16, end: 26, segment: 4 };
    const { container, rerender } = render(
      <CellDataReader {...props} focus={{ ...focus, nonce: 1 }} />,
    );

    scrollTo(dumpOf(container), 900 * READER_ROW_HEIGHT_PX);
    expect(root(container).getAttribute('data-cell-data-reader-first-row'))
      .not.toBe('0');

    rerender(<CellDataReader {...props} focus={{ ...focus, nonce: 2 }} />);
    expect(root(container).getAttribute('data-cell-data-reader-first-row')).toBe('0');
  });

  it('hands the focus back when a byte is clicked', () => {
    const { container, onFocusChange } = reader({
      focus: { start: 16, end: 26, segment: 4, nonce: 1 },
    });
    expect(byteCell(container, 0).style.opacity).toBe('0.34');

    fireEvent.click(byteCell(container, 0));

    expect(onFocusChange).toHaveBeenCalledWith(null);
    expect(root(container).getAttribute('data-cell-data-reader-selection')).toBe('0:1');
    // Nothing is a segment any more, so nothing is dimmed against it.
    expect(byteCell(container, 20).style.opacity).toBe('1');
  });

  it('hands the focus back when a key moves the caret', () => {
    const { container, onFocusChange } = reader({
      focus: { start: 16, end: 26, segment: 4, nonce: 1 },
    });
    fireEvent.keyDown(dumpOf(container), { key: 'ArrowDown' });
    expect(onFocusChange).toHaveBeenCalledWith(null);
  });

  it('names the byte under the pointer in the foot line, without redrawing the dump', () => {
    const { container } = reader();
    const rowBefore = container.querySelector('[data-cell-data-reader-row="0"]');

    fireEvent.mouseOver(byteCell(container, 20));

    expect(footReads(container)).toEqual({
      mode: 'hover',
      text: '0x00014 · byte 20 · CONTENT TYPE',
    });
    // The same node, not a re-rendered one: a hover through state would spend
    // a frame on forty rows for every byte the pointer crossed.
    expect(container.querySelector('[data-cell-data-reader-row="0"]'))
      .toBe(rowBefore);

    // A neighbouring segment is named as itself, not as the one before it.
    fireEvent.mouseOver(byteCell(container, 100));
    expect(footReads(container).text).toBe('0x00064 · byte 100 · CONTENT');

    // …and the pointer leaving hands the line back to the status.
    fireEvent.mouseLeave(dumpOf(container));
    expect(footReads(container).mode).toBe('status');
  });

  it('names an unmapped byte as unmapped', () => {
    const { container } = reader({
      bytes: bytesOf(64),
      totalBytes: 64,
      segments: [segment('header', 0, 16, 'h')],
    });
    fireEvent.mouseOver(byteCell(container, 32));
    expect(footReads(container)).toEqual({
      mode: 'hover',
      text: '0x00020 · byte 32 · unmapped',
    });
  });

  it('reads a selection as one little-endian integer of its own width', () => {
    // `e8 03 00 00 …` is 1,000 — a u128 LE amount, which is what an sUDT Cell
    // holds and what nobody can read out of a hex grid by eye.
    const amount = new Uint8Array(16);
    amount[0] = 0xe8;
    amount[1] = 0x03;
    const { container } = reader({
      bytes: amount,
      totalBytes: 16,
      segments: [segment('amount', 0, 16, '1000')],
    });

    fireEvent.click(byteCell(container, 0));
    fireEvent.click(byteCell(container, 15), { shiftKey: true });

    expect(root(container).getAttribute('data-cell-data-reader-selection')).toBe('0:16');
    expect(footReads(container).mode).toBe('selection');
    expect(footReads(container).text).toContain('0x00000 +16 B · LE 1,000');
  });

  it('reads a selected run as the text it is, and keeps the rest in the title', () => {
    const text = '{"name":"Lightning Explorer Badge","dna":"a1b2"}';
    const bytes = textBytes(text);
    const { container } = reader({
      bytes,
      totalBytes: bytes.length,
      segments: [segment('content', 0, bytes.length, text)],
    });

    fireEvent.click(byteCell(container, 0));
    fireEvent.click(byteCell(container, bytes.length - 1), { shiftKey: true });

    // Twenty-four characters on the line, all of it in the title: the line is
    // ONE line under a 408 px zone and shares it with three other clauses.
    expect(footReads(container).text)
      .toContain(`"${text.slice(0, 24)}…"`);
    expect(footOf(container).title).toBe(text);
    // Past sixteen bytes there is no integer to print: a spore's content is
    // not a number however hard the arithmetic tries.
    expect(footReads(container).text).not.toContain('LE');
  });

  it('states what it is holding, and where it came from', () => {
    const held = reader({ bytes: bytesOf(96), totalBytes: 96 });
    expect(footReads(held.container))
      .toEqual({ mode: 'status', text: '96 B · COMPLETE · HELD' });
    cleanup();

    const node = reader({
      bytes: bytesOf(96),
      totalBytes: 96,
      phase: 'ready',
      dataHash: `0x${'ef'.repeat(32)}`,
      live: false,
    });
    expect(footReads(node.container).text)
      .toBe('96 B · COMPLETE · NODE · 0xefefefef…');
    expect(footOf(node.container).title)
      .toContain('READ FROM THE TRANSACTION THAT CREATED IT');
  });

  it('says what it is still waiting for while the node is being asked', () => {
    const { container } = reader({
      bytes: bytesOf(1024),
      heldBytes: 1024,
      totalBytes: SPORE_BYTES,
      phase: 'loading',
    });
    expect(footReads(container))
      .toEqual({ mode: 'status', text: 'READING 37,314 B · 1,024 B HELD' });
  });

  it('reports a node that could not be asked as a limit, not as an alarm', () => {
    const { container } = reader({
      bytes: bytesOf(1024),
      heldBytes: 1024,
      totalBytes: SPORE_BYTES,
      phase: 'error',
      message: 'connection refused',
    });
    const foot = footOf(container);
    expect(footReads(container))
      .toEqual({ mode: 'status', text: '1,024 / 37,314 B · connection refused' });
    // `dim`, the ink a limit on what we saw is written in — never `danger`.
    expect(foot.style.color).toBe('rgb(124, 135, 148)');
    // The rows the browser does hold stay readable under the line.
    expect(byteCell(container, 0).hasAttribute('data-cell-data-reader-ghost'))
      .toBe(false);
  });

  it('scrolls the dump from a pointer on the scrollbar-map', () => {
    // The map IS the scrollbar (R2-4). The fraction is taken over the height
    // this component ASKED for, which is the only form of it jsdom can drive —
    // every rect it reports is zero.
    //
    // ⭐ jsdom implements no `PointerEvent` constructor, so
    // `fireEvent.pointerDown` falls back to a bare `Event` that carries no
    // coordinate at all. A `MouseEvent` NAMED `pointerdown` reaches React's
    // `onPointerDown` (React listens by event type) and does carry `clientY`,
    // which is what a browser would deliver.
    const on = (map: HTMLElement, type: string, clientY: number) => {
      fireEvent(map, new MouseEvent(type, { clientY, bubbles: true }));
    };
    const { container } = reader();
    const dump = dumpOf(container);
    const map = container.querySelector('[data-cell-data-reader-map]') as HTMLElement;
    const viewHeight = READER_VISIBLE_ROWS * READER_ROW_HEIGHT_PX;
    const rowCount = Math.ceil(SPORE_BYTES / 16);

    on(map, 'pointerdown', viewHeight / 2);

    const halfway = 0.5 * rowCount * READER_ROW_HEIGHT_PX - viewHeight / 2;
    expect(dump.scrollTop).toBe(halfway);
    expect(root(container).getAttribute('data-cell-data-reader-first-row'))
      .toBe(String(Math.max(
        0,
        Math.floor(halfway / READER_ROW_HEIGHT_PX) - READER_OVERSCAN_ROWS,
      )));

    // …and the drag continues while the button is down, which is what makes an
    // 8 px strip usable at all.
    on(map, 'pointermove', 0);
    expect(dump.scrollTop).toBe(0);

    // A move after the pointer is up is not a drag.
    on(map, 'pointerup', 0);
    on(map, 'pointermove', viewHeight);
    expect(dump.scrollTop).toBe(0);
  });

  it('copies what is selected, and says it did', async () => {
    // Typed parameter list, so `mock.calls[0][0]` is not an empty tuple.
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText }, configurable: true,
    });
    const { container } = reader({ bytes: bytesOf(48), totalBytes: 48 });
    const copy = container
      .querySelector('[data-cell-data-reader-copy]') as HTMLButtonElement;

    // Nothing selected: the whole payload.
    fireEvent.click(copy);
    await vi.waitFor(() => expect(copy.textContent).toBe('COPIED'));
    expect(writeText.mock.calls[0][0]).toHaveLength(2 + 48 * 2);

    fireEvent.click(byteCell(container, 0));
    fireEvent.click(byteCell(container, 3), { shiftKey: true });
    fireEvent.click(copy);
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1][0]).toBe('0x03 0a 11 18'.replaceAll(' ', ''));
  });

  it('says so on its own face when the clipboard refuses, and grows no toast', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async (_text: string) => { throw new Error('blocked'); }) },
      configurable: true,
    });
    const { container } = reader({ bytes: bytesOf(48), totalBytes: 48 });
    const copy = container
      .querySelector('[data-cell-data-reader-copy]') as HTMLButtonElement;

    fireEvent.click(copy);
    await vi.waitFor(() => expect(copy.textContent).toBe('BLOCKED'));
    expect(container.querySelector('[data-cell-data-reader-toast]')).toBeNull();
  });

  // The user's D-7 ruling of 2026-09-05: the framed box ends at the last row it
  // has bytes for, and the plate's remainder under it is plain plate ground.
  // Before it, a sixteen-byte Cell drew one row inside a twenty-seven-row
  // frame — measured live, 7 of the box's 367 pixel rows carried ink. The
  // floor under it is two rows (the ruling of 2026-09-05): at six, the same
  // Cell still measured 13 ink pixel rows of 166.
  describe('the box ends at the last row', () => {
    const mapOf = (container: HTMLElement) => container
      .querySelector('[data-cell-data-reader-map]');

    it('gives a sixteen-byte Cell two rows and no map', () => {
      // One row of payload, the floor's two rows of box, and a scale drawing
      // of one segment over one row is a solid bar saying nothing.
      const { container } = reader({
        bytes: bytesOf(16),
        totalBytes: 16,
        segments: [segment('amount', 0, 16, '1000')],
        visibleRows: 27,
      });

      expect(dumpOf(container).style.height).toBe(`${2 * READER_ROW_HEIGHT_PX}px`);
      expect(mapOf(container)).toBeNull();
      // …and no track reserved for the map it does not draw.
      expect((dumpOf(container).parentElement as HTMLElement).style.gridTemplateColumns)
        .toBe('minmax(0,1fr)');
    });

    it('gives a forty-byte Cell three rows — the floor stops binding', () => {
      // Three rows of payload stand in three rows of box: past the floor the
      // box is the payload's own height and nothing else.
      const { container } = reader({
        bytes: bytesOf(40),
        totalBytes: 40,
        segments: [segment('body', 0, 40, 'b')],
        visibleRows: 27,
      });

      expect(dumpOf(container).style.height).toBe(`${3 * READER_ROW_HEIGHT_PX}px`);
      expect(mapOf(container)).toBeNull();
    });

    it('gives a 300-byte Cell nineteen rows and draws its map', () => {
      const { container } = reader({
        bytes: bytesOf(300),
        totalBytes: 300,
        segments: [segment('head', 0, 32, 'h'), segment('body', 32, 300, 'b')],
        visibleRows: 27,
      });

      expect(dumpOf(container).style.height).toBe(`${19 * READER_ROW_HEIGHT_PX}px`);
      expect(mapOf(container)).not.toBeNull();
      expect((mapOf(container) as HTMLElement).style.height)
        .toBe(`${19 * READER_ROW_HEIGHT_PX}px`);
    });

    it('keeps the plate\'s room as the box\'s ceiling, and the 64-row valve behind it', () => {
      // A 37 KB spore against a plate with room for 27 rows takes 27, and the
      // ceiling in `readerRowsUnderScan` is what stops a taller plate ever
      // asking for two thousand.
      const { container } = reader({ visibleRows: 27 });

      expect(dumpOf(container).style.height).toBe(`${27 * READER_ROW_HEIGHT_PX}px`);
      expect(root(container).getAttribute('data-cell-data-reader-rows')).toBe('2333');
      expect(readerRowsUnderScan(4000, 288, 62, READER_ROW_HEIGHT_PX))
        .toBe(READER_MAX_VISIBLE_ROWS);
    });

    it('draws the map for a payload the narrow box cannot hold', () => {
      // The map is the scrollbar as well as the drawing (R2-4). Under the
      // narrow card the box is six rows, so a ten-row Cell genuinely scrolls
      // — and a dump that scrolls with its native bar hidden and no map beside
      // it would have no way to say it has more.
      const { container } = reader({
        bytes: bytesOf(160),
        totalBytes: 160,
        segments: [segment('body', 0, 160, 'b')],
        visibleRows: 6,
      });

      expect(dumpOf(container).style.height).toBe(`${6 * READER_ROW_HEIGHT_PX}px`);
      expect(mapOf(container)).not.toBeNull();
    });

    it('draws a single whole-payload band as a dot, not as a fill', () => {
      // C7: one segment over the whole payload gives the drawing nothing to
      // say, and a solid lavender bar says it at full volume. The strip is
      // still the scrollbar, so the band becomes a mark and the viewport rides
      // over it. Recorded off a real 2D context — the suite's global stub
      // swallows `fillRect` — and read as geometry rather than as colour.
      const fills: { x: number; y: number; w: number; h: number }[] = [];
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = (() => ({
        fillStyle: '',
        globalAlpha: 1,
        clearRect: () => {},
        fillRect: (x: number, y: number, w: number, h: number) => {
          fills.push({ x, y, w, h });
        },
      })) as unknown as typeof original;
      try {
        const { container } = reader({
          bytes: bytesOf(512),
          totalBytes: 512,
          segments: [segment('body', 0, 512, 'b')],
          visibleRows: 27,
        });
        const map = mapOf(container) as HTMLCanvasElement;
        expect(map).not.toBeNull();
        const height = map.height;
        const width = map.width;
        // The ground is the one fill that covers the whole strip; nothing
        // painted after it may.
        const fullHeight = fills.filter((fill) => fill.h >= height && fill.w >= width);
        expect(fullHeight).toHaveLength(1);
        // …and the band is a small square, centred on the track.
        const dot = fills.find((fill) => fill.w > 0 && fill.w < width && fill.h === fill.w);
        expect(dot).toBeDefined();
        expect(dot?.x).toBe(Math.round((width - (dot?.w ?? 0)) / 2));
      } finally {
        HTMLCanvasElement.prototype.getContext = original;
      }
    });

    it('puts the foot line under the last row, not under the plate', () => {
      // The foot is the reader's one line and it follows the frame: 4 px under
      // the box's bottom border, wherever the box ends.
      const { container } = reader({
        bytes: bytesOf(16),
        totalBytes: 16,
        segments: [segment('amount', 0, 16, '1000')],
        visibleRows: 27,
      });
      const box = dumpOf(container).parentElement as HTMLElement;
      const foot = footOf(container);

      expect(foot.previousElementSibling).toBe(box);
      expect(foot.style.marginTop).toBe('4px');
    });
  });

  it('declares the width the card spends on it', () => {
    // 408 = the 73-character row plus its 8 px gutter, a 6 px seam, the 8 px
    // scrollbar-map, the section's padding and its border. The panel derives
    // the notch and the card's width from this one statement (R2-b), so it is
    // pinned where it is written.
    expect(READER_WIDTH_PX).toBe(408);
    expect(READER_WIDTH_PX - 280 - 8).toBe(120);
  });
});
