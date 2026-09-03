// The Cell data lookup, driven against the SHAPE M2 wrote into the route.
//
// Every response here carries the headers `cell_output_data` sets on a 200 —
// `x-cell-data-bytes`, `x-cell-data-hash`, `x-cell-status`, the quoted ETag
// and the immutable cache-control — and every failure carries the
// `{"error","message"}` body the same handler writes. A contract change on the
// server therefore breaks these assertions instead of reaching the reader.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CELL_DATA_MEMO_BYTES,
  clearCellDataMemo,
  fetchCellOutputData,
  recallCellOutputData,
  rememberCellOutputData,
  type CellOutputData,
} from '../src/cellDataClient';

const TX_HASH = `0x${'ab'.repeat(32)}`;
const OUT_POINT = { tx_hash: TX_HASH, index: 3 };
const DATA_HASH = `0x${'cd'.repeat(32)}`;
const MIB = 1024 * 1024;

/** A 200 exactly as the route writes one, with room to spoil one header. */
function dataResponse(
  bytes: Uint8Array,
  overrides: Record<string, string | null> = {},
): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/octet-stream',
    'content-length': String(bytes.length),
    'x-cell-data-bytes': String(bytes.length),
    'x-cell-data-hash': DATA_HASH,
    'x-cell-status': 'live',
    etag: `"${DATA_HASH}"`,
    'cache-control': 'public, max-age=31536000, immutable',
  };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) delete headers[name];
    else headers[name] = value;
  }
  // Copied into a fresh array on the way in: a `Response` body has to be
  // backed by a plain `ArrayBuffer`, and re-wrapping keeps this helper's
  // parameter the ordinary `Uint8Array` every caller below already holds.
  return new Response(new Uint8Array(bytes), { status: 200, headers });
}

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function record(size: number, overrides: Partial<CellOutputData> = {}): CellOutputData {
  return { bytes: new Uint8Array(size), totalBytes: size, dataHash: DATA_HASH, live: true, ...overrides };
}

beforeEach(() => clearCellDataMemo());
afterEach(() => {
  vi.unstubAllGlobals();
  clearCellDataMemo();
});

describe('fetchCellOutputData', () => {
  it('asks the node route for one output under its own outpoint', async () => {
    const payload = Uint8Array.from([0xe8, 0x03, 0x00, 0x00]);
    const fetchMock = vi.fn().mockResolvedValue(dataResponse(payload));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCellOutputData(OUT_POINT, {
      baseUrl: 'http://127.0.0.1:17001/',
    })).resolves.toEqual({
      bytes: payload,
      totalBytes: 4,
      dataHash: DATA_HASH,
      live: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:17001/api/cells/${TX_HASH}/3/data`,
      { signal: undefined },
    );
  });

  it('defaults to the page it is served from, and escapes what it was handed', async () => {
    // A tx_hash is `0x` + 64 hex by the time the route accepts it, so the
    // escaping is not for the happy path: it is what keeps a mistyped or
    // hostile outpoint from becoming a DIFFERENT route. The server still
    // answers this one with its 400, which is the point — the request lands
    // on the data handler and is rejected there.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      { error: 'invalid_out_point', message: 'tx_hash must be 0x followed by 64 hex characters' },
      400,
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCellOutputData({ tx_hash: '0xabc/../projections', index: 0 }))
      .rejects.toThrow('tx_hash must be 0x followed by 64 hex characters');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cells/0xabc%2F..%2Fprojections/0/data',
      { signal: undefined },
    );
  });

  it('reads both of the route\'s absences as the same thing: no bytes to show', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(
        { error: 'cell_unknown', message: 'no such output exists on this chain' },
        404,
      ))
      .mockResolvedValueOnce(jsonResponse(
        { error: 'cell_data_unavailable', message: 'no node is configured to read Cell data' },
        404,
      ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCellOutputData(OUT_POINT)).resolves.toBeNull();
    await expect(fetchCellOutputData(OUT_POINT)).resolves.toBeNull();
  });

  it('surfaces a fault with the message the server sent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(
      {
        error: 'cell_data_too_large',
        message: 'this output holds 3145728 bytes; the route serves at most 2097152',
      },
      413,
    )));

    await expect(fetchCellOutputData(OUT_POINT))
      .rejects.toThrow('this output holds 3145728 bytes; the route serves at most 2097152');
  });

  it('falls back to the status when a fault carries no message', async () => {
    // Nothing on this server answers a 502 in plain text; a proxy in front of
    // it does, and so does a dev server handing back its own error page.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 })));

    await expect(fetchCellOutputData(OUT_POINT))
      .rejects.toThrow('Cell data failed with HTTP 502');
  });

  it('reads a spent output as dead without treating it as any less true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      dataResponse(Uint8Array.from([1, 2, 3]), { 'x-cell-status': 'dead' }),
    ));

    const data = await fetchCellOutputData(OUT_POINT);
    expect(data?.live).toBe(false);
    expect(data?.bytes).toEqual(Uint8Array.from([1, 2, 3]));
  });

  it('refuses a payload shorter than the length it was promised', async () => {
    // The one failure the reader could not see for itself: short bytes still
    // draw as rows, and the missing tail would read as a Cell that ends where
    // the connection did.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      dataResponse(new Uint8Array(64), { 'x-cell-data-bytes': '37314' }),
    ));

    await expect(fetchCellOutputData(OUT_POINT))
      .rejects.toThrow('Cell data arrived short: 64 of 37314 bytes');
  });

  it('refuses a 200 that carries none of the route\'s own headers', async () => {
    // An SPA dev server answering `index.html` for an unknown path is a 200
    // with a body and no `x-cell-*` anything. Inventing a hash and a status
    // for it would put a fiction under the reader's caption.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(dataResponse(new Uint8Array(4), { 'x-cell-data-bytes': null }))
      .mockResolvedValueOnce(dataResponse(new Uint8Array(4), { 'x-cell-data-hash': null }))
      .mockResolvedValueOnce(dataResponse(new Uint8Array(4), { 'x-cell-status': null }))
      .mockResolvedValueOnce(dataResponse(new Uint8Array(4), { 'x-cell-data-bytes': 'some' }))
      .mockResolvedValueOnce(dataResponse(new Uint8Array(4), { 'x-cell-status': 'maybe' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCellOutputData(OUT_POINT))
      .rejects.toThrow('Cell data answered without x-cell-data-bytes');
    await expect(fetchCellOutputData(OUT_POINT))
      .rejects.toThrow('Cell data answered without x-cell-data-hash');
    await expect(fetchCellOutputData(OUT_POINT))
      .rejects.toThrow('Cell data answered without x-cell-status');
    await expect(fetchCellOutputData(OUT_POINT))
      .rejects.toThrow('Cell data declared an unreadable length: some');
    await expect(fetchCellOutputData(OUT_POINT))
      .rejects.toThrow('Cell data answered with an unknown status: maybe');
  });

  it('carries an empty payload rather than calling it an absence', async () => {
    // 829 native residents hold no data at all, and the route answers them
    // with zero bytes and the ZERO data hash. That is a Cell whose data is
    // empty, not a Cell nobody could find.
    const zeroHash = `0x${'00'.repeat(32)}`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      dataResponse(new Uint8Array(0), { 'x-cell-data-hash': zeroHash }),
    ));

    await expect(fetchCellOutputData(OUT_POINT)).resolves.toEqual({
      bytes: new Uint8Array(0),
      totalBytes: 0,
      dataHash: zeroHash,
      live: true,
    });
  });

  it('passes the abort signal through and lets the rejection surface', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchCellOutputData(OUT_POINT, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('Aborted');
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/cells/${TX_HASH}/3/data`,
      { signal: controller.signal },
    );
  });

  it('neither reads nor writes the memo — holding bytes is the caller\'s call', async () => {
    const held = record(8, { dataHash: '0xheld' });
    rememberCellOutputData(OUT_POINT, held);
    const fetchMock = vi.fn().mockResolvedValue(dataResponse(Uint8Array.from([9])));
    vi.stubGlobal('fetch', fetchMock);

    // A memo hit does not short-circuit the request…
    const fetched = await fetchCellOutputData(OUT_POINT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetched?.dataHash).toBe(DATA_HASH);
    // …and the answer does not overwrite what the caller chose to hold.
    expect(recallCellOutputData(OUT_POINT)).toBe(held);
  });
});

describe('cell data session memo', () => {
  it('answers a re-opened Cell with the payload it was handed', () => {
    const data = record(37_314);
    expect(recallCellOutputData(OUT_POINT)).toBeNull();
    rememberCellOutputData(OUT_POINT, data);
    expect(recallCellOutputData(OUT_POINT)).toBe(data);
  });

  it('keeps two outputs of one transaction apart', () => {
    const first = record(4, { dataHash: '0xfirst' });
    const second = record(4, { dataHash: '0xsecond' });
    rememberCellOutputData({ tx_hash: TX_HASH, index: 0 }, first);
    rememberCellOutputData({ tx_hash: TX_HASH, index: 1 }, second);

    expect(recallCellOutputData({ tx_hash: TX_HASH, index: 0 })).toBe(first);
    expect(recallCellOutputData({ tx_hash: TX_HASH, index: 1 })).toBe(second);
  });

  it('evicts the oldest payload when the newest one does not fit', () => {
    const a = record(3 * MIB);
    const b = record(3 * MIB);
    const c = record(3 * MIB);
    rememberCellOutputData({ tx_hash: TX_HASH, index: 1 }, a);
    rememberCellOutputData({ tx_hash: TX_HASH, index: 2 }, b);
    // 9 MiB will not sit under an 8 MiB cap, so the first one out is the
    // first one in.
    rememberCellOutputData({ tx_hash: TX_HASH, index: 3 }, c);

    expect(recallCellOutputData({ tx_hash: TX_HASH, index: 1 })).toBeNull();
    expect(recallCellOutputData({ tx_hash: TX_HASH, index: 2 })).toBe(b);
    expect(recallCellOutputData({ tx_hash: TX_HASH, index: 3 })).toBe(c);
  });

  it('counts a recall as use, so the Cell being read outlives the one that was not', () => {
    const a = record(3 * MIB);
    const b = record(3 * MIB);
    const c = record(3 * MIB);
    rememberCellOutputData({ tx_hash: TX_HASH, index: 1 }, a);
    rememberCellOutputData({ tx_hash: TX_HASH, index: 2 }, b);
    expect(recallCellOutputData({ tx_hash: TX_HASH, index: 1 })).toBe(a);
    rememberCellOutputData({ tx_hash: TX_HASH, index: 3 }, c);

    // `a` was the oldest by arrival and the youngest by use; least RECENTLY
    // used is what the cap spends, so `b` is the one that goes.
    expect(recallCellOutputData({ tx_hash: TX_HASH, index: 1 })).toBe(a);
    expect(recallCellOutputData({ tx_hash: TX_HASH, index: 2 })).toBeNull();
    expect(recallCellOutputData({ tx_hash: TX_HASH, index: 3 })).toBe(c);
  });

  it('re-remembering one outpoint does not spend the cap twice', () => {
    const a = record(3 * MIB);
    rememberCellOutputData({ tx_hash: TX_HASH, index: 1 }, a);
    rememberCellOutputData({ tx_hash: TX_HASH, index: 1 }, a);
    rememberCellOutputData({ tx_hash: TX_HASH, index: 2 }, record(3 * MIB));

    // Two entries, 6 MiB, both under the cap — unless the replacement was
    // counted as a second 3 MiB, in which case the first is already gone.
    expect(recallCellOutputData({ tx_hash: TX_HASH, index: 1 })).toBe(a);
    expect(recallCellOutputData({ tx_hash: TX_HASH, index: 2 })).not.toBeNull();
  });

  it('refuses a payload bigger than the whole cap, and keeps what it holds', () => {
    const held = record(3 * MIB);
    rememberCellOutputData({ tx_hash: TX_HASH, index: 1 }, held);
    rememberCellOutputData({ tx_hash: TX_HASH, index: 2 }, record(CELL_DATA_MEMO_BYTES + 1));

    // Evicting a session's worth of instant re-opens to hold one Cell is the
    // wrong trade, and nothing is lost: the browser's HTTP cache still has it.
    expect(recallCellOutputData({ tx_hash: TX_HASH, index: 2 })).toBeNull();
    expect(recallCellOutputData({ tx_hash: TX_HASH, index: 1 })).toBe(held);
  });
});
