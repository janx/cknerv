// The reader's supply line, driven against the route M2 wrote and the client
// M3 shipped. The assertion this whole file exists for is the FIRST one: for
// 10,263 of the 10,356 staged Cells the prefix the browser already holds IS
// the payload, and opening the reader on one of them must not put a request on
// the wire. Everything below it is about the 93 that are not.

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCellDataMemo, rememberCellOutputData } from '@cknerv/cache';

import {
  useCellOutputData,
  useReaderPlacement,
  useReaderRows,
  type CellOutputDataInput,
} from '../../src/hooks/useCellOutputData';
import {
  READER_BESIDE_CARD_PX,
  READER_CARD_MARGIN_PX,
  READER_MIN_VISIBLE_ROWS,
  READER_VISIBLE_ROWS,
  readerBesideRows,
} from '../../src/derives/cellDataReader.derive';
import {
  READER_CHROME_PX,
  READER_ROW_HEIGHT_PX,
} from '../../src/components/hud/CellDataReader';

const TX_HASH = `0x${'ab'.repeat(32)}`;
const OTHER_TX = `0x${'cd'.repeat(32)}`;
const DATA_HASH = `0x${'ef'.repeat(32)}`;

/** A 200 exactly as `cell_output_data` writes one.
 *
 *  ⚠️ The body is re-wrapped: TS 5.9's `BodyInit` wants an
 *  `ArrayBufferView<ArrayBuffer>` and a plain `Uint8Array` is
 *  `Uint8Array<ArrayBufferLike>`, so a fixture that handed its own array
 *  straight to `Response` would not compile (M3's note). */
function dataResponse(bytes: Uint8Array, live = true): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes.length),
      'x-cell-data-bytes': String(bytes.length),
      'x-cell-data-hash': DATA_HASH,
      'x-cell-status': live ? 'live' : 'dead',
      etag: `"${DATA_HASH}"`,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A payload whose bytes are distinguishable from the prefix's. */
function payload(size: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (seed + index) & 0xff;
  return bytes;
}

function open(overrides: Partial<CellOutputDataInput> = {}) {
  const initial: CellOutputDataInput = {
    outPoint: { tx_hash: TX_HASH, index: 3 },
    enabled: true,
    held: payload(1024, 1),
    totalBytes: 4096,
    ...overrides,
  };
  const view = renderHook(
    (props: CellOutputDataInput) => useCellOutputData(props),
    { initialProps: initial },
  );
  return { view, initial };
}

/** Let the fetch promise and the state update it schedules both settle. */
async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => clearCellDataMemo());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearCellDataMemo();
});

describe('useCellOutputData', () => {
  it('reads a complete prefix without asking the node anything', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const held = payload(40, 7);

    const { view } = open({ held, totalBytes: 40 });
    await settle();

    expect(view.result.current.phase).toBe('held');
    expect(view.result.current.bytes).toBe(held);
    expect(view.result.current.heldBytes).toBe(40);
    expect(view.result.current.dataHash).toBeNull();
    expect(view.result.current.live).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('holds the prefix while the node answers, then draws all of it', async () => {
    const whole = payload(4096, 1);
    const fetchMock = vi.fn().mockResolvedValue(dataResponse(whole));
    vi.stubGlobal('fetch', fetchMock);

    const { view } = open({ held: whole.slice(0, 1024), totalBytes: 4096 });

    expect(view.result.current.phase).toBe('loading');
    expect(view.result.current.heldBytes).toBe(1024);
    expect(view.result.current.message).toBeNull();

    await settle();

    expect(view.result.current.phase).toBe('ready');
    expect(view.result.current.bytes).toEqual(whole);
    expect(view.result.current.heldBytes).toBe(4096);
    expect(view.result.current.dataHash).toBe(DATA_HASH);
    expect(view.result.current.live).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0]))
      .toBe(`/api/cells/${TX_HASH}/3/data`);
  });

  it('remembers what came back, so the second open needs no request', async () => {
    const whole = payload(4096, 1);
    const fetchMock = vi.fn().mockResolvedValue(dataResponse(whole));
    vi.stubGlobal('fetch', fetchMock);

    const first = open({ held: whole.slice(0, 1024), totalBytes: 4096 });
    await settle();
    expect(first.view.result.current.phase).toBe('ready');
    first.view.unmount();

    const second = open({ held: whole.slice(0, 1024), totalBytes: 4096 });
    // Synchronously ready on the FIRST render: a re-open that flashed a frame
    // of ghost rows before an effect replaced them would be a flicker, and the
    // card's whole discipline is that ink changes and geometry does not.
    expect(second.view.result.current.phase).toBe('ready');
    expect(second.view.result.current.bytes).toEqual(whole);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('answers from the session memo without touching the network at all', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const whole = payload(2048, 9);
    rememberCellOutputData(
      { tx_hash: TX_HASH, index: 3 },
      { bytes: whole, totalBytes: 2048, dataHash: DATA_HASH, live: false },
    );

    const { view } = open({ held: whole.slice(0, 512), totalBytes: 2048 });

    expect(view.result.current.phase).toBe('ready');
    expect(view.result.current.live).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks for nothing while the reader is closed', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { view } = open({ enabled: false });

    expect(view.result.current.phase).toBe('loading');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts the request in flight when the reader moves to another Cell', async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_url: string, init: { signal: AbortSignal }) => {
      signals.push(init.signal);
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);

    const { view, initial } = open();
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    view.rerender({ ...initial, outPoint: { tx_hash: OTHER_TX, index: 0 } });

    expect(signals[0].aborted).toBe(true);
    expect(signals).toHaveLength(2);
    expect(String(fetchMock.mock.calls[1][0]))
      .toBe(`/api/cells/${OTHER_TX}/0/data`);
  });

  it('aborts when the reader closes, and asks again when it reopens', async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_url: string, init: { signal: AbortSignal }) => {
      signals.push(init.signal);
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);

    const { view, initial } = open();
    view.rerender({ ...initial, enabled: false });
    expect(signals[0].aborted).toBe(true);

    view.rerender({ ...initial, enabled: true });
    expect(signals).toHaveLength(2);

    view.unmount();
    expect(signals[1].aborted).toBe(true);
  });

  it('says the node could not be asked, in the node\'s own words', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      { error: 'node_unreachable', message: 'connection refused' },
      502,
    ));
    vi.stubGlobal('fetch', fetchMock);

    const { view } = open();
    await settle();

    expect(view.result.current.phase).toBe('error');
    expect(view.result.current.message).toBe('connection refused');
    // The prefix is still on screen: an error is one line in the status, and
    // the rows the browser DOES hold stay readable under it.
    expect(view.result.current.heldBytes).toBe(1024);
  });

  it('reads a 404 as an absence of bytes rather than as a fault', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      { error: 'cell_unknown', message: 'no such output' },
      404,
    ));
    vi.stubGlobal('fetch', fetchMock);

    const { view } = open();
    await settle();

    expect(view.result.current.phase).toBe('error');
    expect(view.result.current.message).toBe('NO BYTES FOR THIS OUTPOINT AT THE NODE');
  });
});

/** The window, set the way a browser sets it: a property nobody can assign
 *  in jsdom without redefining it, and an event nobody fires without saying so. */
function resizeWindow(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

afterEach(() => { resizeWindow(1024, 768); });

describe('useReaderPlacement', () => {
  it('stands the reader beside the plate exactly when the card still fits', () => {
    // jsdom's own window is 1024 wide, which is far under the 1,396 the card
    // measures with a reader column — so the fallback row is what a test that
    // says nothing about the window gets, and every panel test written before
    // the column keeps passing unchanged.
    const { result } = renderHook(() => useReaderPlacement());
    expect(result.current).toBe('below');

    // One pixel under the card's own `maxWidth: calc(100vw - 28px)` clamp…
    act(() => { resizeWindow(READER_BESIDE_CARD_PX + READER_CARD_MARGIN_PX - 1, 1100); });
    expect(result.current).toBe('below');

    // …and exactly on it.
    act(() => { resizeWindow(READER_BESIDE_CARD_PX + READER_CARD_MARGIN_PX, 1100); });
    expect(result.current).toBe('beside');

    // The app's own viewport, where M5 measured the row falling past the fold.
    act(() => { resizeWindow(1600, 1100); });
    expect(result.current).toBe('beside');

    // And back: a window narrowed under the card returns the row.
    act(() => { resizeWindow(900, 1100); });
    expect(result.current).toBe('below');
  });
});

describe('useReaderRows', () => {
  it('measures the beside column against the plate and the row against the window', () => {
    // Unmeasured — jsdom lays nothing out, and the plate is honestly 0 — so
    // both placements answer with the number the reader has always opened at.
    const beside = renderHook(() => useReaderRows('beside', 0));
    expect(beside.result.current).toBe(READER_VISIBLE_ROWS);
    const below = renderHook(() => useReaderRows('below', 0));
    expect(below.result.current).toBe(18);

    // A real spore dossier's plate, the one M5 measured at ~910 px. Beside it
    // the reader fills the plate; under it there is nothing left of an 1,100 px
    // window and the floor is what the fallback settles at.
    const tall = renderHook(() => useReaderRows('beside', 910));
    expect(tall.result.current).toBe(
      readerBesideRows(910, READER_CHROME_PX, READER_ROW_HEIGHT_PX),
    );
    expect(tall.result.current).toBeGreaterThan(READER_VISIBLE_ROWS);

    act(() => { resizeWindow(1600, 1100); });
    const cramped = renderHook(() => useReaderRows('below', 910));
    expect(cramped.result.current).toBe(READER_MIN_VISIBLE_ROWS);
  });

  it('re-reads the window when it is resized, and only then', () => {
    const { result } = renderHook(() => useReaderRows('below', 0));
    expect(result.current).toBe(18);

    act(() => { resizeWindow(1024, 4000); });
    expect(result.current).toBe(READER_VISIBLE_ROWS);

    act(() => { resizeWindow(1024, 600); });
    expect(result.current).toBe(READER_MIN_VISIBLE_ROWS);
  });
});
