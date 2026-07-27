import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  connectEntityStream,
  emptyChainEntityCache,
} from '../src/entityStream';
import {
  connectCellsStream,
} from '../src/projectionStream';
import { emptyCellsCache } from '../src/cellsReducer';
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
});
