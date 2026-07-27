// WebSocket client for cknerv-server's
// `/api/projections/:name/stream` endpoint. Generalized to any
// projection that follows the same wire protocol — the caller
// supplies a `reducer` that produces a fresh cache from a snapshot
// payload + a delta-application function for incremental updates.
//
// Frame protocol (matches cknerv-server `ws::handle_projection_stream`):
//   `{"kind":"snapshot", "revision":N, "snapshot":<payload>}`
//   `{"kind":"delta", "revision":N, "deltas":[{"revision":N,"delta":V}, ...]}`
//   `{"kind":"lagged", "skipped":N}`

import type {
  CellDelta,
  CellGalaxySnapshot,
  RevisionedCellDelta,
} from '@cknerv/types';

import {
  applyRevisionedCellDeltas,
  emptyCellsCache,
  fromCellsSnapshot,
  type CellGalaxyCache,
} from './cellsReducer';
import {
  createStreamHealthTracker,
  type StreamHealthOptions,
} from './streamHealth';

function resolveWsUrl(url: string): string {
  if (url.startsWith('ws://') || url.startsWith('wss://')) return url;
  if (typeof window === 'undefined') return url;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${proto}//${window.location.host}${path}`;
}

export interface ProjectionStreamOptions extends StreamHealthOptions {
  reconnectMs?: number;
  recentLinksCapacity?: number;
  linkRingCapacity?: number;
}

export interface ProjectionStreamHandle {
  disconnect: () => void;
}

/**
 * Generic projection-stream connect helper. The caller supplies:
 *  - `fromSnapshot(rev, payload)` → fresh Cache value
 *  - `applyDeltas(prev, [{revision, delta}, ...])` → next Cache value
 *  - `getRevision(cache)` → current revision (for ?since= reconnect cursor)
 *  - `markLagged(cache)` → cache with revision reset to 0 (force resnap)
 *
 * Returns a handle whose `disconnect()` tears down the socket.
 */
export function connectProjectionStream<Cache, Snapshot, Delta>(
  streamUrl: string,
  initial: Cache,
  hooks: {
    fromSnapshot: (revision: number, payload: Snapshot) => Cache;
    applyDeltas: (
      prev: Cache,
      deltas: { revision: number; delta: Delta }[],
    ) => Cache;
    getRevision: (cache: Cache) => number;
    markLagged: (cache: Cache) => Cache;
  },
  onChange: (next: Cache) => void,
  opts: ProjectionStreamOptions = {},
): ProjectionStreamHandle {
  const reconnectMs = opts.reconnectMs ?? 2000;
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let cache: Cache = initial;
  let needsResync = false;

  const health = createStreamHealthTracker(opts, () => {
    try {
      socket?.close();
    } catch {
      // Best effort; onclose/retry still handles ordinary failures.
    }
  });

  type Frame =
    | { kind: 'snapshot'; revision: number; snapshot: Snapshot }
    | { kind: 'delta'; revision: number; deltas: { revision: number; delta: Delta }[] }
    | { kind: 'lagged'; skipped: number }
    | { kind: 'heartbeat'; revision?: number };

  const open = () => {
    if (stopped) return;
    health.startAttempt(needsResync);
    const base = resolveWsUrl(streamUrl);
    const sep = base.includes('?') ? '&' : '?';
    const url = `${base}${sep}since=${hooks.getRevision(cache)}`;
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => health.opened(needsResync);

    ws.onmessage = (msg: MessageEvent) => {
      let frame: Frame;
      try {
        frame = typeof msg.data === 'string' ? JSON.parse(msg.data) : (null as never);
      } catch {
        return;
      }
      if (!frame || typeof frame !== 'object') return;
      if (frame.kind === 'heartbeat') {
        health.message(needsResync);
      } else if (frame.kind === 'snapshot') {
        cache = hooks.fromSnapshot(frame.revision, frame.snapshot);
        needsResync = false;
        health.message();
        onChange(cache);
      } else if (frame.kind === 'delta') {
        cache = hooks.applyDeltas(cache, frame.deltas);
        needsResync = false;
        health.message();
        onChange(cache);
      } else if (frame.kind === 'lagged') {
        needsResync = true;
        health.resyncing();
        cache = hooks.markLagged(cache);
        try {
          ws.close();
        } catch {
          // Best effort.
        }
      }
    };

    const onClose = () => {
      if (stopped) return;
      if (reconnectTimer !== null) return;
      health.closed(needsResync);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        open();
      }, reconnectMs);
    };
    ws.onclose = onClose;
    ws.onerror = onClose;
  };

  open();

  return {
    disconnect: () => {
      stopped = true;
      health.stop();
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.onopen = null;
        socket.onmessage = null;
        try {
          socket.close();
        } catch {
          // Best effort.
        }
        socket = null;
      }
    },
  };
}

/**
 * Convenience wrapper around `connectProjectionStream` for the
 * built-in `CellGalaxy` projection — wires the cellsReducer up to a
 * named projection stream URL.
 */
export function connectCellsStream(
  streamUrl: string,
  initial: CellGalaxyCache | undefined,
  onChange: (next: CellGalaxyCache) => void,
  opts: ProjectionStreamOptions = {},
): ProjectionStreamHandle {
  return connectProjectionStream<
    CellGalaxyCache,
    CellGalaxySnapshot,
    CellDelta
  >(
    streamUrl,
    initial ?? emptyCellsCache(),
    {
      fromSnapshot: (rev, payload) => fromCellsSnapshot(rev, payload, opts),
      applyDeltas: (prev, deltas) =>
        applyRevisionedCellDeltas(prev, deltas as RevisionedCellDelta[], opts),
      getRevision: (c) => c.revision,
      markLagged: (c) => ({ ...c, revision: 0 }),
    },
    onChange,
    opts,
  );
}
