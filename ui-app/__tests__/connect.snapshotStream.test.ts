import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getBootSequence,
  resetBootSequenceForTest,
  subscribeBootSequence,
  type BootPhaseId,
  type BootPhaseSnapshot,
} from '@cknerv/ui';

// The columnar decoder is real wire-format work; what this file is about is
// the streaming, the phase bracket and the fallback, so the two decode
// symbols are the only thing swapped out.
const decode = vi.hoisted(() => ({
  decodeCellsColumnar: vi.fn(),
  cellsSnapshotFromColumnar: vi.fn(),
}));

vi.mock('@cknerv/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cknerv/cache')>()),
  ...decode,
}));

import { fetchCellsSnapshot } from '../src/connect';

const BIN_URL = '/api/projections/cells/snapshot.bin';
const JSON_URL = '/api/projections/cells/snapshot';
const JSON_BODY = '{"revision":12,"snapshot":{"cells":"json"}}';

function streamed(
  chunks: readonly Uint8Array[],
  options: { status?: number; length?: number | null } = {},
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const headers = new Headers();
  const declared = options.length === undefined
    ? chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
    : options.length;
  if (declared !== null) headers.set('content-length', String(declared));
  return new Response(body, { status: options.status ?? 200, headers });
}

function jsonStreamed(text: string, status = 200): Response {
  return streamed([new TextEncoder().encode(text)], { status });
}

function phase(id: BootPhaseId): BootPhaseSnapshot {
  const found = getBootSequence().phases.find((entry) => entry.id === id);
  if (!found) throw new Error(`no ${id} phase`);
  return found;
}

/** Every progress report the store published, in order. */
function recordProgress(): Array<{ received: number; total: number | null }> {
  const trail: Array<{ received: number; total: number | null }> = [];
  subscribeBootSequence(() => {
    const snapshot = phase('snapshot');
    if (snapshot.receivedBytes === undefined) return;
    const last = trail[trail.length - 1];
    const entry = {
      received: snapshot.receivedBytes,
      total: snapshot.totalBytes ?? null,
    };
    if (last && last.received === entry.received && last.total === entry.total) return;
    trail.push(entry);
  });
  return trail;
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetBootSequenceForTest();
  decode.decodeCellsColumnar.mockReset();
  decode.cellsSnapshotFromColumnar.mockReset();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockRestore();
});

describe('fetchCellsSnapshot streaming', () => {
  it('reports exact byte progress and brackets the decode', async () => {
    const chunks = [new Uint8Array(400), new Uint8Array(600), new Uint8Array(24)];
    vi.stubGlobal('fetch', vi.fn(async () => streamed(chunks)));
    decode.decodeCellsColumnar.mockReturnValue({ revision: 91 });
    decode.cellsSnapshotFromColumnar.mockReturnValue({ cells: 'columnar' });
    const trail = recordProgress();

    const result = await fetchCellsSnapshot();

    expect(result).toEqual({ revision: 91, snapshot: { cells: 'columnar' } });
    expect(trail.map((entry) => entry.received)).toEqual([0, 400, 1000, 1024]);
    expect(trail.every((entry) => entry.total === 1024)).toBe(true);
    expect(phase('snapshot').state).toBe('done');
    expect(phase('decode').state).toBe('done');
    // The decoder saw every byte, exactly once.
    const decoded = decode.decodeCellsColumnar.mock.calls[0][0] as ArrayBuffer;
    expect(decoded.byteLength).toBe(1024);
  });

  it('stays indeterminate when the response carries no length', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamed([new Uint8Array(8)], { length: null })));
    decode.decodeCellsColumnar.mockReturnValue({ revision: 1 });
    decode.cellsSnapshotFromColumnar.mockReturnValue({ cells: [] });
    const trail = recordProgress();

    await fetchCellsSnapshot();

    expect(trail.every((entry) => entry.total === null)).toBe(true);
    expect(trail[trail.length - 1].received).toBe(8);
  });

  it('reports once when the environment has no streaming body', async () => {
    const bytes = new Uint8Array([7, 7, 7, 7]);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      body: null,
      headers: new Headers({ 'content-length': '4' }),
      arrayBuffer: async () => bytes.buffer,
    } as unknown as Response)));
    decode.decodeCellsColumnar.mockReturnValue({ revision: 4 });
    decode.cellsSnapshotFromColumnar.mockReturnValue({ cells: [] });
    const trail = recordProgress();

    await fetchCellsSnapshot();

    expect(trail).toEqual([{ received: 4, total: 4 }]);
    expect(phase('snapshot').state).toBe('done');
  });

  it('falls back to JSON when the columnar route is not served', async () => {
    const fetchMock = vi.fn(async (url: string) => (
      url === BIN_URL ? new Response(null, { status: 404 }) : jsonStreamed(JSON_BODY)
    ));
    vi.stubGlobal('fetch', fetchMock);
    const trail = recordProgress();

    const result = await fetchCellsSnapshot();

    expect(result).toEqual({ revision: 12, snapshot: { cells: 'json' } });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([BIN_URL, JSON_URL]);
    // A 404 is a served answer, not a fault: same silence as before.
    expect(warn).not.toHaveBeenCalled();
    // The JSON route is the bigger download of the two, so it reports too.
    const bytes = new TextEncoder().encode(JSON_BODY).byteLength;
    expect(trail[trail.length - 1]).toEqual({ received: bytes, total: bytes });
    expect(phase('snapshot').state).toBe('done');
    expect(phase('decode').state).toBe('done');
  });

  it('falls back to JSON when the columnar bytes do not decode', async () => {
    const fetchMock = vi.fn(async (url: string) => (
      url === BIN_URL
        ? streamed([new Uint8Array(64)])
        : jsonStreamed('{"revision":3,"snapshot":{"cells":"json"}}')
    ));
    vi.stubGlobal('fetch', fetchMock);
    decode.decodeCellsColumnar.mockImplementation(() => {
      throw new Error('unknown columnar version');
    });
    const result = await fetchCellsSnapshot();

    expect(result).toEqual({ revision: 3, snapshot: { cells: 'json' } });
    expect(warn).toHaveBeenCalledOnce();
    // Snapshot completed on the columnar bytes and stays completed; decode
    // died mid-phase there and is closed by the route that succeeded.
    expect(phase('snapshot').state).toBe('done');
    expect(phase('decode').state).toBe('done');
  });

  it('faults the download when both routes are dead', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (
      url === BIN_URL
        ? new Response(null, { status: 500 })
        : new Response(null, { status: 503 })
    )));

    await expect(fetchCellsSnapshot()).rejects.toThrow('cells snapshot: 503');
    expect(phase('snapshot').state).toBe('failed');
    expect(phase('snapshot').detail).toBe('cells snapshot: 503');
    expect(getBootSequence().complete).toBe(false);
  });

  it('faults the parse when the fallback body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (
      url === BIN_URL
        ? new Response(null, { status: 404 })
        : jsonStreamed('<!doctype html>')
    )));

    await expect(fetchCellsSnapshot()).rejects.toThrow();
    expect(phase('snapshot').state).toBe('done');
    expect(phase('decode').state).toBe('failed');
    expect(phase('decode').detail).toBeTruthy();
  });
});
