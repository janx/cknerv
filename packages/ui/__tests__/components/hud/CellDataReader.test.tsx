// DATA READER · SCAN·03, driven at a fixed viewport.
//
// Every number this file asserts is one the reader was HANDED — `visibleRows`,
// the row height, `totalBytes`, a `scrollTop` — because jsdom lays nothing out
// and a reader that measured itself could not be driven here at all. That is
// the same property that makes the assertions worth something: they are about
// arithmetic the browser will run identically, not about a layout this
// environment approximates.

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cell, SemanticContentSegment } from '@cknerv/types';

import CellDataReader, {
  READER_ROW_HEIGHT_PX,
} from '../../../src/components/hud/CellDataReader';
import {
  READER_OVERSCAN_ROWS,
  READER_VISIBLE_ROWS,
} from '../../../src/derives/cellDataReader.derive';
import { REVEAL_GHOST_OPACITY } from '../../../src/components/hud/primitives';

afterEach(() => { cleanup(); });

/** The largest payload on the staged plane: a 37,314-byte dob/0 spore. */
const SPORE_BYTES = 37_314;

function cell(overrides: Partial<Cell> = {}): Cell {
  return {
    id: 4_102_993,
    born_at_ms: 1,
    death_at_ms: null,
    birth_block: 16_204_800,
    tag: null,
    pos_seed: [0.1, 0.2, 0.3],
    out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: 0 },
    capacity: 1_000_00000000,
    data_hex: '0x00',
    data_bytes: SPORE_BYTES,
    content_hash: `0x${'cd'.repeat(32)}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: [3, 4],
    data_shape_seed: [5, 6],
    ...overrides,
  };
}

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
  cell?: Cell;
  segments?: readonly SemanticContentSegment[];
  decode?: { kind: string; summary: string } | null;
  bytes?: Uint8Array;
  heldBytes?: number;
  totalBytes?: number;
  phase?: 'held' | 'loading' | 'ready' | 'error';
  message?: string | null;
  dataHash?: string | null;
  live?: boolean | null;
  openAtByte?: number | null;
  visibleRows?: number;
  reduced?: boolean;
  onClose?: () => void;
}

function reader(overrides: ReaderOverrides = {}) {
  const bytes = overrides.bytes ?? bytesOf(SPORE_BYTES);
  const onClose = overrides.onClose ?? vi.fn();
  const view = render(
    <CellDataReader
      cell={overrides.cell ?? cell()}
      segments={overrides.segments ?? SPORE_SEGMENTS}
      decode={overrides.decode === undefined
        ? { kind: 'spore_cell', summary: 'Spore Cell carrying image/png content' }
        : overrides.decode}
      bytes={bytes}
      heldBytes={overrides.heldBytes ?? bytes.length}
      totalBytes={overrides.totalBytes ?? bytes.length}
      phase={overrides.phase ?? 'held'}
      message={overrides.message ?? null}
      dataHash={overrides.dataHash ?? null}
      live={overrides.live ?? null}
      openAtByte={overrides.openAtByte ?? null}
      visibleRows={overrides.visibleRows ?? READER_VISIBLE_ROWS}
      reduced={overrides.reduced ?? false}
      onClose={onClose}
    />,
  );
  return { ...view, onClose };
}

function root(container: HTMLElement): HTMLElement {
  const element = container.querySelector('[data-cell-data-reader="true"]');
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

function dumpOf(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-cell-data-reader-dump]') as HTMLElement;
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

/** The inspector strip as a key → value table. */
function inspectorReadings(container: HTMLElement): Record<string, string> {
  const strip = container.querySelector('[data-cell-data-reader-inspect]');
  const table: Record<string, string> = {};
  for (const field of Array.from(strip?.children ?? [])) {
    const parts = Array.from(field.children);
    if (parts.length !== 2) continue;
    table[parts[0].textContent ?? ''] = parts[1].textContent ?? '';
  }
  return table;
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

  it('gutters every row at its own offset, six digits wide', () => {
    const { container } = reader();
    const row = container.querySelector('[data-cell-data-reader-row="10"]');
    expect(row?.firstElementChild?.textContent).toBe('0000A0');
    expect(container.querySelector('[data-cell-data-reader-row="0"]')
      ?.firstElementChild?.textContent).toBe('000000');
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

  it('takes a segment click as the selection, the scroll and the reading', () => {
    const { container } = reader();
    const dump = dumpOf(container);
    scrollTo(dump, 100 * READER_ROW_HEIGHT_PX);

    const contentType = container
      .querySelector('[data-cell-data-reader-segment="4"]') as HTMLElement;
    fireEvent.click(contentType);

    expect(contentType.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-cell-data-reader-segment="5"]')
      ?.getAttribute('aria-pressed')).toBe('false');
    // `content_type` starts at byte 16, which is row 1, and the row goes to
    // the top of the dump — overscan puts row 0 back on screen.
    expect(root(container).getAttribute('data-cell-data-reader-first-row')).toBe('0');
    expect(root(container).getAttribute('data-cell-data-reader-selection')).toBe('16:26');

    // Its own bytes are lit; every OTHER segment's fall away; the reading
    // names the segment rather than the byte.
    expect(byteCell(container, 16).style.opacity).toBe('1');
    expect(byteCell(container, 16).style.textShadow).not.toBe('');
    expect(byteCell(container, 0).style.opacity).toBe('0.34');
    expect(inspectorReadings(container).SEG).toBe('CONTENT TYPE');
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
    expect(inspectorReadings(container).LEN).toBe('3 B');
  });

  it('reads sixteen little-endian bytes as the amount a UDT writes', () => {
    // `e8 03 00 00 …` is 1,000 — a u128 LE amount, which is what an sUDT Cell
    // holds and what nobody can read out of a hex grid by eye.
    const amount = new Uint8Array(16);
    amount[0] = 0xe8;
    amount[1] = 0x03;
    const { container } = reader({
      bytes: amount,
      totalBytes: 16,
      segments: [segment('amount', 0, 16, '1000')],
      decode: { kind: 'sudt_cell', summary: 'Simple UDT amount' },
      cell: cell({ data_bytes: 16 }),
    });

    fireEvent.click(byteCell(container, 0));

    const readings = inspectorReadings(container);
    expect(readings['u128 LE']).toBe('1,000');
    expect(readings['u64 LE']).toBe('1,000');
    expect(readings.u8).toBe('232');
    expect(readings.OFF).toBe('0x000000');
  });

  it('reads a selected run as the text it is', () => {
    const text = '{"dna":"a1b2"}';
    const bytes = textBytes(text);
    const { container } = reader({
      bytes,
      totalBytes: bytes.length,
      segments: [segment('content', 0, bytes.length, text)],
      decode: { kind: 'dob_document', summary: 'dob/0 JSON document' },
      cell: cell({ data_bytes: bytes.length }),
    });

    fireEvent.click(byteCell(container, 0));
    fireEvent.click(byteCell(container, 5), { shiftKey: true });

    expect(root(container).getAttribute('data-cell-data-reader-selection')).toBe('0:6');
    expect(inspectorReadings(container)['UTF-8']).toBe(text.slice(0, 6));
  });

  it('says nothing is selected until something is', () => {
    const { container } = reader();
    const strip = container.querySelector('[data-cell-data-reader-inspect]');
    expect(strip?.textContent).toContain('SELECT A BYTE, A RANGE OR A SEGMENT');
    expect(root(container).hasAttribute('data-cell-data-reader-selection')).toBe(false);
  });

  it('stands the rows past the held prefix as ghosts, and fills them in place', () => {
    const whole = bytesOf(96);
    const { container, rerender } = reader({
      bytes: whole.slice(0, 32),
      heldBytes: 32,
      totalBytes: 96,
      phase: 'loading',
      segments: [],
      decode: null,
      cell: cell({ data_bytes: 96 }),
    });

    const before = rowsOf(container);
    expect(container.querySelectorAll('[data-cell-data-reader-ghost]'))
      .toHaveLength((96 - 32) * 2);
    expect(byteCell(container, 40).textContent).toBe('··');
    expect(byteCell(container, 40).style.opacity).toBe(String(REVEAL_GHOST_OPACITY));
    expect(container.querySelector('[data-cell-data-reader-bar]')).not.toBeNull();

    rerender(
      <CellDataReader
        cell={cell({ data_bytes: 96 })}
        segments={[]}
        decode={null}
        bytes={whole}
        heldBytes={96}
        totalBytes={96}
        phase="ready"
        message={null}
        dataHash={`0x${'ef'.repeat(32)}`}
        live
        openAtByte={null}
        visibleRows={READER_VISIBLE_ROWS}
        reduced={false}
        onClose={vi.fn()}
      />,
    );

    // Nothing moved: the same rows, in the same places, with ink where the
    // ghosts were.
    expect(rowsOf(container)).toEqual(before);
    expect(container.querySelectorAll('[data-cell-data-reader-ghost]')).toHaveLength(0);
    expect(byteCell(container, 40).textContent).toBe(
      whole[40].toString(16).toUpperCase().padStart(2, '0'),
    );
    expect(container.querySelector('[data-cell-data-reader-bar]')).toBeNull();
    expect(root(container).getAttribute('data-cell-data-reader-phase')).toBe('ready');
    expect(root(container).getAttribute('data-cell-data-reader-hash'))
      .toBe(`0x${'ef'.repeat(32)}`);
  });

  it('jumps to a hex offset, and refuses one that is not', () => {
    const { container } = reader();
    const input = container
      .querySelector('[data-cell-data-reader-goto]') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '0x91C0' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // 0x91C0 is 37,312 — the first byte of the last row of the payload.
    expect(root(container).getAttribute('data-cell-data-reader-selection'))
      .toBe('37312:37313');
    expect(rowsOf(container)).toContain(2332);

    fireEvent.change(input, { target: { value: 'zz' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(container.querySelector('[data-cell-data-reader-toast]')?.textContent)
      .toBe('HEX OFFSET, E.G. 0x1F0');

    fireEvent.change(input, { target: { value: '0xFFFFFF' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(container.querySelector('[data-cell-data-reader-toast]')?.textContent)
      .toBe('BEYOND 37,314 B');
  });

  it('opens where the stepper sent it', () => {
    const { container } = reader({ openAtByte: 37_282 });
    expect(root(container).getAttribute('data-cell-data-reader-selection'))
      .toBe('37282:37283');
    expect(rowsOf(container)).toContain(2330);
  });

  it('names the byte under the pointer without redrawing the dump', () => {
    const { container } = reader();
    const dump = dumpOf(container);

    fireEvent.mouseOver(byteCell(container, 20));

    expect(dump.title).toBe('0x000014 · byte 20 · CONTENT TYPE');
  });

  it('spells the keys out, because no face the HUD ships carries an arrow up', () => {
    const { container } = reader();
    const keys = container.querySelector('[data-cell-data-reader-keys]');
    expect(keys?.textContent).toBe('ARROWS MOVE · SHIFT EXTENDS · PGUP PGDN · HOME END');
    expect(keys?.textContent).not.toContain('↑');
    expect(container.textContent).not.toContain('↑');
  });

  it('has no HEX or TEXT view to switch between', () => {
    // The user's E4 ruling: the reader is hex, full stop. A toggle is a
    // control, so this asks for controls rather than for the words — `TEXT`
    // legitimately appears in the inspector's own hint sentence.
    const { container } = reader();
    const controls = Array.from(container.querySelectorAll('button'))
      .map((button) => button.textContent?.trim());
    expect(controls).not.toContain('HEX');
    expect(controls).not.toContain('TEXT');
    expect(controls).toContain('COPY HEX');
  });

  it('says a Cell with no decode has none, and maps every byte in ink', () => {
    const { container } = reader({
      bytes: bytesOf(48),
      totalBytes: 48,
      segments: [],
      decode: null,
      cell: cell({ data_bytes: 48 }),
    });

    expect(container.querySelector('[data-cell-data-reader-no-segments]')?.textContent)
      .toBe('NO DECODED SEGMENTS');
    expect(container.querySelector('[data-cell-data-reader-segment="0"]')).toBeNull();
    expect(container.querySelector('[data-cell-data-reader-reads]')).toBeNull();
  });

  it('counts the bytes no segment claims', () => {
    const { container } = reader({
      bytes: bytesOf(64),
      totalBytes: 64,
      segments: [segment('header', 0, 16, 'h')],
      cell: cell({ data_bytes: 64 }),
    });
    expect(container.querySelector('[data-cell-data-reader-unmapped]')?.textContent)
      .toBe('UNMAPPED · 48 B in ink');
  });

  it('states what it is holding, and where it came from', () => {
    const { container } = reader({
      bytes: bytesOf(96),
      totalBytes: 96,
      phase: 'ready',
      dataHash: `0x${'ef'.repeat(32)}`,
      live: false,
      cell: cell({ data_bytes: 96 }),
    });
    const state = container.querySelector('[data-cell-data-reader-state]');
    expect(state?.textContent).toContain('96 B · COMPLETE · NODE · 0xefefefef');
  });

  it('reports a node that could not be asked as a limit, not as an alarm', () => {
    const { container } = reader({
      bytes: bytesOf(1024),
      heldBytes: 1024,
      totalBytes: SPORE_BYTES,
      phase: 'error',
      message: 'connection refused',
    });
    const state = container
      .querySelector('[data-cell-data-reader-state]') as HTMLElement;
    expect(state.textContent).toContain('connection refused');
    // `dim`, the ink a limit on what we saw is written in — never `danger`.
    expect(state.style.color).toBe('rgb(124, 135, 148)');
    // The rows the browser does hold stay readable under the line.
    expect(byteCell(container, 0).hasAttribute('data-cell-data-reader-ghost'))
      .toBe(false);
  });

  it('closes on its own control', () => {
    const { container, onClose } = reader();
    const close = container.querySelector('[aria-label="close"]') as HTMLElement;
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
