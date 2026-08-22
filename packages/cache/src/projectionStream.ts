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

import { cellsSnapshotFromColumnar, decodeCellsColumnar } from './cellsColumnar';
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

/** Decoder for a binary resync frame. Supplying one opts the socket into
 *  `?bin=1`; the server keeps sending JSON text to anyone who does not,
 *  because a binary frame carries no `kind` to recognise it by. A throw
 *  forces a reconnect rather than a wrong cache — and retires `bin=1` for
 *  the rest of the session, because the throw is almost always a format
 *  version this build will never learn. */
export type BinarySnapshotDecoder<Snapshot> = (
  buffer: ArrayBuffer,
) => { revision: number; snapshot: Snapshot };

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
    decodeBinarySnapshot?: BinarySnapshotDecoder<Snapshot>;
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
  /** One-way latch. Once this build has proved it cannot read the server's
   *  columnar frame, every remaining attempt in this session asks for JSON. */
  let binaryRetired = false;
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

  /**
   * Schedule the next attempt WITHOUT waiting for the transport's close
   * handshake. Live debugging caught the deadlock this guards against: a
   * server under replay load emits `lagged`, the client calls close(), and
   * the server never completes the close handshake — `onclose` never fires
   * and the stream stayed dead forever with zero retries. Reconnect
   * scheduling is idempotent (one pending timer), stale sockets are
   * detached so their late events cannot double-schedule or touch the next
   * socket, and the ordinary onclose path funnels through here too.
   */
  const scheduleReconnect = (flushFirst: boolean) => {
    if (stopped) return;
    if (reconnectTimer !== null) return;
    const stale = socket;
    if (stale) {
      stale.onclose = null;
      stale.onerror = null;
      stale.onopen = null;
      stale.onmessage = null;
      try {
        stale.close();
      } catch {
        // Best effort.
      }
      socket = null;
    }
    if (flushFirst) flushPendingDeltas();
    health.closed(needsResync);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, reconnectMs);
  };

  const health = createStreamHealthTracker(opts, () => {
    // Stale watchdog: force the retry cycle directly — a close() that never
    // completes must not leave the stream dead. Valid frames received before
    // the silence still commit.
    scheduleReconnect(true);
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
    const binary = binaryRetired ? undefined : hooks.decodeBinarySnapshot;
    const url = `${base}${sep}since=${hooks.getRevision(cache)}${binary ? '&bin=1' : ''}`;
    const ws = new WebSocket(url);
    if (binary) ws.binaryType = 'arraybuffer';
    socket = ws;
    ws.onopen = () => health.opened(needsResync);

    ws.onmessage = (msg: MessageEvent) => {
      if (binary && msg.data instanceof ArrayBuffer) {
        // The only binary frame is a resync snapshot, and it is
        // authoritative at its exact point in the ordered stream — same
        // rule as the JSON one, so older uncommitted deltas are dropped.
        let decoded: { revision: number; snapshot: Snapshot };
        try {
          decoded = binary(msg.data);
        } catch (error) {
          // A frame we cannot read is worse than no frame: drop the socket
          // and let the reconnect ask again. But asking again the SAME way
          // is how a version skew becomes a loop — the columnar format is
          // versioned, so a server this build could not decode once will not
          // become decodable on retry, and a tab holding the old SPA across a
          // deploy spent every reconnect re-downloading megabytes it was
          // always going to throw away. Retire `bin=1` for the session and
          // take the JSON snapshot instead, the same fallback the HTTP boot
          // path already has (`ui-app/src/connect.ts`).
          binaryRetired = true;
          console.warn(
            'binary snapshot frame unusable — this build cannot read the '
              + "server's columnar format; falling back to JSON for the rest "
              + 'of this stream session',
            error,
          );
          ws.close();
          return;
        }
        discardPendingDeltas();
        cache = hooks.fromSnapshot(decoded.revision, decoded.snapshot, cache);
        needsResync = false;
        health.message();
        onChange(cache);
        return;
      }
      // Same rule as the binary path: a frame we cannot read is worse than
      // no frame. Swallowing it left the cache one delta behind the server
      // forever — nothing else resyncs until a `lagged` that may never come.
      // An object whose `kind` this build does not know is NOT unusable:
      // unknown kinds stay a forward-compatible no-op below.
      let parsed: unknown = null;
      let unusable: unknown = 'frame was not text';
      if (typeof msg.data === 'string') {
        try {
          parsed = JSON.parse(msg.data);
          unusable = parsed !== null && typeof parsed === 'object'
            ? null
            : 'frame was not a JSON object';
        } catch (error) {
          unusable = error;
        }
      }
      if (unusable !== null) {
        console.warn('text frame unusable; resyncing', unusable);
        ws.close();
        return;
      }
      const frame = parsed as Frame;
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
        // Do NOT wait for the close handshake — schedule the resync attempt
        // now (see scheduleReconnect docs for the deadlock this avoids).
        scheduleReconnect(false);
      }
    };

    const onClose = () => {
      if (socket !== ws) return;
      // Commit every frame received before an ordinary transport close so
      // reconnect resumes from the newest applied revision. A lagged frame
      // already discarded the unsafe batch and reset the cursor above.
      scheduleReconnect(true);
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
      decodeBinarySnapshot: (buffer) => {
        const view = decodeCellsColumnar(buffer);
        return { revision: view.revision, snapshot: cellsSnapshotFromColumnar(view) };
      },
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
