import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  connectEntityStream,
  emptyChainEntityCache,
} from '../src/entityStream';
import {
  connectCellsStream,
} from '../src/projectionStream';
import { emptyCellsCache, type CellGalaxyCache } from '../src/cellsReducer';
import type { Cell } from '@cknerv/types';
import type { StreamHealth } from '../src/streamHealth';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  open(): void {
    this.onopen?.({} as Event);
  }

  message(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }

  close(): void {
    this.onclose?.({} as CloseEvent);
  }
}

afterEach(() => {
  MockWebSocket.instances = [];
  vi.unstubAllGlobals();
});

function cell(id: number): Cell {
  return {
    id,
    born_at_ms: 1000 + id,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [id, 0, 0],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 100,
    data_hex: '0x',
    content_hash: `0x${'00'.repeat(32)}`,
  };
}

describe('stream connector health frames', () => {
  it('treats an entity heartbeat as freshness without reducing cache data', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const changes = vi.fn();
    const health: StreamHealth[] = [];
    const handle = connectEntityStream(
      'ws://localhost/api/entities/chain/stream',
      emptyChainEntityCache(),
      changes,
      {
        now: () => 4_200,
        onHealth: (next) => health.push(next),
      },
    );
    const socket = MockWebSocket.instances[0];

    socket.open();
    expect(health.at(-1)?.phase).toBe('connecting');
    socket.message({ kind: 'heartbeat', revision: 0 });

    expect(health.at(-1)).toMatchObject({
      phase: 'live',
      lastMessageAtMs: 4_200,
    });
    expect(changes).not.toHaveBeenCalled();
    handle.disconnect();
  });

  it('treats a projection heartbeat as freshness without fabricating a delta', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const changes = vi.fn();
    const health: StreamHealth[] = [];
    const handle = connectCellsStream(
      'ws://localhost/api/projections/cells/stream',
      emptyCellsCache(),
      changes,
      {
        now: () => 8_400,
        onHealth: (next) => health.push(next),
      },
    );
    const socket = MockWebSocket.instances[0];

    socket.open();
    socket.message({ kind: 'heartbeat', revision: 0 });

    expect(health.at(-1)).toMatchObject({
      phase: 'live',
      lastMessageAtMs: 8_400,
    });
    expect(changes).not.toHaveBeenCalled();
    handle.disconnect();
  });

  it('coalesces live projection frames at one render boundary', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const scheduled: { flush?: FrameRequestCallback } = {};
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      scheduled.flush = callback;
      return 7;
    });
    const cancelFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    const changes = vi.fn();
    const handle = connectCellsStream(
      'ws://localhost/api/projections/cells/stream',
      emptyCellsCache(),
      changes,
    );
    const socket = MockWebSocket.instances[0];

    socket.message({
      kind: 'delta',
      revision: 1,
      deltas: [{ revision: 1, delta: { type: 'birth', cell: cell(1) } }],
    });
    socket.message({
      kind: 'delta',
      revision: 2,
      deltas: [{ revision: 2, delta: { type: 'birth', cell: cell(2) } }],
    });
    socket.message({
      kind: 'delta',
      revision: 3,
      deltas: [{ revision: 3, delta: { type: 'pulse', at_ms: 3000 } }],
    });

    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(changes).not.toHaveBeenCalled();
    expect(scheduled.flush).toBeDefined();
    if (!scheduled.flush) throw new Error('projection delta flush was not scheduled');
    scheduled.flush(16);

    expect(changes).toHaveBeenCalledTimes(1);
    expect(changes.mock.calls[0][0]).toMatchObject({
      revision: 3,
      lastPulseAtMs: 3000,
    });
    expect(changes.mock.calls[0][0].cells.size).toBe(2);
    expect(cancelFrame).toHaveBeenCalledWith(7);
    handle.disconnect();
  });

  it('a resync snapshot reuses retained Cell identities for unchanged records', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const scheduled: { flush?: FrameRequestCallback } = {};
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      scheduled.flush = callback;
      return 3;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const states: CellGalaxyCache[] = [];
    const handle = connectCellsStream(
      'ws://localhost/api/projections/cells/stream',
      emptyCellsCache(),
      (next) => states.push(next),
    );
    const socket = MockWebSocket.instances[0];

    socket.message({
      kind: 'delta',
      revision: 2,
      deltas: [
        { revision: 1, delta: { type: 'birth', cell: cell(1) } },
        { revision: 2, delta: { type: 'birth', cell: cell(2) } },
      ],
    });
    if (!scheduled.flush) throw new Error('delta flush was not scheduled');
    scheduled.flush(16);

    const live = states.at(-1);
    if (!live) throw new Error('no live cache published');
    const retained = live.cells.get(1);

    // Post-lag resync: the authoritative snapshot re-delivers cell 1
    // byte-identically and cell 2 with a real content change.
    socket.message({
      kind: 'snapshot',
      revision: 9,
      snapshot: {
        cells: [cell(1), { ...cell(2), capacity: 999 }],
        last_pulse_at_ms: 0,
      },
    });

    const resynced = states.at(-1);
    if (!resynced) throw new Error('no resynced cache published');
    expect(resynced.revision).toBe(9);
    expect(resynced.cells.get(1)).toBe(retained);
    expect(resynced.cells.get(2)).not.toBe(live.cells.get(2));
    expect(resynced.cells.get(2)?.capacity).toBe(999);
    expect(resynced.cellChanges.reset).toBe(true);
    handle.disconnect();
  });
});

describe('entity stream delta batching', () => {
  it('coalesces live entity frames at one render boundary and skips no-op frames', () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const scheduled: { flush?: FrameRequestCallback } = {};
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      scheduled.flush = callback;
      return 11;
    });
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const changes = vi.fn();
    const initial = emptyChainEntityCache();
    initial.chainNodes = [
      { id: 'ckb:local', label: 'ckb-local', is_miner: false, version: '0.116.1', connections: 8 },
    ];
    const handle = connectEntityStream(
      'ws://localhost/api/entities/chain/stream',
      initial,
      changes,
    );
    const socket = MockWebSocket.instances[0];

    socket.message({
      kind: 'delta',
      revision: 1,
      mutations: [
        { revision: 1, mutation: { type: 'block_mined', number: 1, hash: '0xb1', tx_count: 0, at: 1000 } },
      ],
    });
    socket.message({
      kind: 'delta',
      revision: 2,
      mutations: [
        { revision: 2, mutation: { type: 'tx_landed', tx_hash: '0xt1', block: 1 } },
      ],
    });

    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(changes).not.toHaveBeenCalled();
    if (!scheduled.flush) throw new Error('entity delta flush was not scheduled');
    scheduled.flush(16);

    expect(changes).toHaveBeenCalledTimes(1);
    expect(changes.mock.calls[0][0]).toMatchObject({ revision: 2 });
    expect(changes.mock.calls[0][0].chain.tip).toBe(1);

    // An unchanged node-info poll re-broadcast advances only the revision
    // cursor; it must not reach React at all.
    scheduled.flush = undefined;
    socket.message({
      kind: 'delta',
      revision: 3,
      mutations: [
        { revision: 3, mutation: { type: 'chain_node_info_updated', id: 'ckb:local', version: '0.116.1', connections: 8 } },
      ],
    });
    const noopFlush = (scheduled as { flush?: FrameRequestCallback }).flush;
    if (!noopFlush) throw new Error('no-op delta flush was not scheduled');
    noopFlush(32);
    expect(changes).toHaveBeenCalledTimes(1);
    handle.disconnect();
  });
});

describe('close-handshake deadlock hardening', () => {
  /** A server under replay load may NEVER complete the close handshake:
   * close() here fires no events at all, like the live deadlock. */
  class SilentCloseWebSocket {
    static instances: SilentCloseWebSocket[] = [];
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    closeCalls = 0;

    constructor(readonly url: string) {
      SilentCloseWebSocket.instances.push(this);
    }

    open(): void {
      this.onopen?.({} as Event);
    }

    message(payload: unknown): void {
      this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
    }

    close(): void {
      this.closeCalls += 1;
    }
  }

  afterEach(() => {
    SilentCloseWebSocket.instances = [];
    vi.useRealTimers();
  });

  it('reconnects after a projection lagged frame even if onclose never fires', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', SilentCloseWebSocket);
    const handle = connectCellsStream(
      'ws://localhost/api/projections/cells/stream',
      emptyCellsCache(),
      () => {},
      {},
    );
    const first = SilentCloseWebSocket.instances[0];
    first.open();
    first.message({ kind: 'lagged', skipped: 3 });

    expect(first.closeCalls).toBeGreaterThan(0);
    // No close event ever arrives; the retry must be self-scheduled.
    vi.advanceTimersByTime(2100);
    expect(SilentCloseWebSocket.instances).toHaveLength(2);
    // The resync attempt starts from revision 0.
    expect(SilentCloseWebSocket.instances[1].url).toContain('since=0');
    // Late events from the detached first socket must be inert (no double
    // scheduling, no third socket).
    first.onclose?.({} as CloseEvent);
    vi.advanceTimersByTime(2100);
    expect(SilentCloseWebSocket.instances).toHaveLength(2);
    handle.disconnect();
  });

  it('reconnects after an entity lagged frame even if onclose never fires', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', SilentCloseWebSocket);
    const handle = connectEntityStream(
      'ws://localhost/api/entities/chain/stream',
      emptyChainEntityCache(),
      () => {},
      {},
    );
    const first = SilentCloseWebSocket.instances[0];
    first.open();
    first.message({ kind: 'lagged', skipped: 1 });

    vi.advanceTimersByTime(2100);
    expect(SilentCloseWebSocket.instances).toHaveLength(2);
    expect(SilentCloseWebSocket.instances[1].url).toContain('since=0');
    handle.disconnect();
  });

  it('stale watchdog forces the retry cycle without a close event', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', SilentCloseWebSocket);
    const handle = connectCellsStream(
      'ws://localhost/api/projections/cells/stream',
      emptyCellsCache(),
      () => {},
      { staleAfterMs: 5_000 },
    );
    const first = SilentCloseWebSocket.instances[0];
    first.open();
    // Total silence: the watchdog fires at 5s and must self-schedule the
    // retry even though close() completes nothing.
    vi.advanceTimersByTime(5_100);
    expect(first.closeCalls).toBeGreaterThan(0);
    vi.advanceTimersByTime(2_100);
    expect(SilentCloseWebSocket.instances.length).toBeGreaterThanOrEqual(2);
    handle.disconnect();
  });
});
