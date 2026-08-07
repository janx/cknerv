import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  connectEntityStream,
  emptyChainEntityCache,
} from '../src/entityStream';
import {
  connectCellsStream,
} from '../src/projectionStream';
import { emptyCellsCache } from '../src/cellsReducer';
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
