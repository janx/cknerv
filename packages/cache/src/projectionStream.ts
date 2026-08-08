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
  RevisionedSemanticsDelta,
  SemanticsDelta,
  SemanticsSnapshot,
} from '@cknerv/types';

import {
  applyRevisionedCellDeltas,
  emptyCellsCache,
  fromCellsSnapshot,
  type CellGalaxyCache,
} from './cellsReducer';
import {
  applyRevisionedSemanticsDeltas,
  emptySemanticsCache,
  fromSemanticsSnapshot,
  type SemanticsCache,
} from './semanticsReducer';
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

/** RAF is the natural batching boundary for render-facing projection state.
 *  The timeout keeps an inactive/hidden document from leaving its reconnect
 *  cursor behind indefinitely while RAF is suspended. */
const DELTA_BATCH_FALLBACK_MS = 50;

/**
 * Generic projection-stream connect helper. The caller supplies:
 *  - `fromSnapshot(rev, payload, prev)` → fresh Cache value. `prev` is the
 *    cache the snapshot replaces, so resync snapshots can reuse the object
 *    identity of content-identical retained records instead of handing every
 *    record a fresh identity.
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
    fromSnapshot: (revision: number, payload: Snapshot, prev: Cache) => Cache;
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
  let pendingDeltas: { revision: number; delta: Delta }[] = [];
  let cancelDeltaFlush: (() => void) | null = null;

  const flushPendingDeltas = () => {
    const cancel = cancelDeltaFlush;
    cancelDeltaFlush = null;
    cancel?.();
    if (stopped || pendingDeltas.length === 0) return;
    const deltas = pendingDeltas;
    pendingDeltas = [];
    cache = hooks.applyDeltas(cache, deltas);
    onChange(cache);
  };

  const discardPendingDeltas = () => {
    pendingDeltas = [];
    const cancel = cancelDeltaFlush;
    cancelDeltaFlush = null;
    cancel?.();
  };

  const scheduleDeltaFlush = () => {
    if (cancelDeltaFlush !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      const frameId = requestAnimationFrame(flushPendingDeltas);
      const timeoutId = setTimeout(
        flushPendingDeltas,
        DELTA_BATCH_FALLBACK_MS,
      );
      cancelDeltaFlush = () => {
        cancelAnimationFrame(frameId);
        clearTimeout(timeoutId);
      };
      return;
    }
    const timeoutId = setTimeout(flushPendingDeltas, 0);
    cancelDeltaFlush = () => clearTimeout(timeoutId);
  };

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
        // A snapshot is authoritative at its exact point in the ordered
        // stream. Any uncommitted older deltas must not apply after it.
        discardPendingDeltas();
        cache = hooks.fromSnapshot(frame.revision, frame.snapshot, cache);
        needsResync = false;
        health.message();
        onChange(cache);
      } else if (frame.kind === 'delta') {
        needsResync = false;
        health.message();
        if (frame.deltas.length > 0) {
          pendingDeltas.push(...frame.deltas);
          scheduleDeltaFlush();
        }
      } else if (frame.kind === 'lagged') {
        discardPendingDeltas();
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
      // Commit every frame received before an ordinary transport close so
      // reconnect resumes from the newest applied revision. A lagged frame
      // already discarded the unsafe batch and reset the cursor above.
      flushPendingDeltas();
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
      discardPendingDeltas();
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
      fromSnapshot: (rev, payload, prev) =>
        fromCellsSnapshot(rev, payload, opts, prev),
      applyDeltas: (prev, deltas) =>
        applyRevisionedCellDeltas(prev, deltas as RevisionedCellDelta[], opts),
      getRevision: (c) => c.revision,
      markLagged: (c) => ({ ...c, revision: 0 }),
    },
    onChange,
    opts,
  );
}

/** Optional semantics projection connector. Callers decide whether to create
 * it from runtime config; the required chain/cells boot path never depends on
 * this stream. */
export function connectSemanticsStream(
  streamUrl: string,
  initial: SemanticsCache | undefined,
  onChange: (next: SemanticsCache) => void,
  opts: ProjectionStreamOptions = {},
): ProjectionStreamHandle {
  return connectProjectionStream<SemanticsCache, SemanticsSnapshot, SemanticsDelta>(
    streamUrl,
    initial ?? emptySemanticsCache(),
    {
      fromSnapshot: fromSemanticsSnapshot,
      applyDeltas: (prev, deltas) =>
        applyRevisionedSemanticsDeltas(
          prev,
          deltas as RevisionedSemanticsDelta[],
        ),
      getRevision: (cache) => cache.revision,
      markLagged: (cache) => ({ ...cache, revision: 0 }),
    },
    onChange,
    opts,
  );
}
