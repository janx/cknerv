// WebSocket client for cknerv-server's `/api/entities/chain/stream`
// endpoint (or any path with the same frame protocol).
//
// Frame protocol (matches cknerv-server `ws::handle_chain_stream`):
//   `{"kind":"snapshot", "revision":N, "entities":{"chain":<ChainEntry>,
//                                                 "chain_nodes":[...]}}`
//   `{"kind":"delta", "revision":N, "mutations":[RevisionedMutation, ...]}`
//   `{"kind":"lagged", "skipped":N, "revision":lastSent}`
//
// Auto-reconnects on close/error. On a `lagged` frame the cache's
// revision is zeroed so the server has to ship a fresh snapshot.

import type {
  ChainEntry,
  ChainNode,
  Mutation,
  RevisionedMutation,
} from '@cknerv/types';

import {
  applyRevisionedChainMutations,
  emptyChainCache,
} from './chainReducer';

/** Materialized client-side chain entity cache. Subscribers receive a
 *  fresh `ChainCache` value on every change so React selectors with
 *  referential equality re-render. */
export interface ChainCache {
  revision: number;
  chain: ChainEntry;
  chainNodes: ChainNode[];
}

export function emptyChainEntityCache(): ChainCache {
  return {
    revision: 0,
    chain: emptyChainCache(),
    chainNodes: [],
  };
}

interface EntitiesPayload {
  chain: ChainEntry;
  chain_nodes?: ChainNode[];
}

type EntitiesFrame =
  | { kind: 'snapshot'; revision: number; entities: EntitiesPayload }
  | { kind: 'delta'; revision: number; mutations: RevisionedMutation[] }
  | { kind: 'lagged'; skipped: number; revision?: number };

function fromEntitiesPayload(rev: number, p: EntitiesPayload): ChainCache {
  return {
    revision: rev,
    chain: p.chain,
    chainNodes: p.chain_nodes ?? [],
  };
}

function applyDeltaToCache(
  prev: ChainCache,
  rms: RevisionedMutation[],
): ChainCache {
  if (rms.length === 0) return prev;
  const nextChain = applyRevisionedChainMutations(prev.chain, rms);
  let maxRev = prev.revision;
  for (const rm of rms) {
    if (rm.revision > maxRev) maxRev = rm.revision;
  }
  return {
    revision: maxRev,
    chain: nextChain,
    chainNodes: prev.chainNodes,
  };
}

/**
 * Resolve a relative or `ws(s)://`-qualified URL to a WebSocket URL.
 * `'/api/entities/chain/stream'` → `'ws://<host>/api/entities/chain/stream'`
 * so the Vite dev proxy routes it correctly. Pass an explicit
 * `ws://host:port/...` URL in non-browser contexts (Node, tests).
 */
function resolveWsUrl(url: string): string {
  if (url.startsWith('ws://') || url.startsWith('wss://')) return url;
  if (typeof window === 'undefined') return url;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${proto}//${window.location.host}${path}`;
}

export interface EntityStreamOptions {
  /** Optional override for `Map<string,*>` fetch URL the bootstrap call
   *  would otherwise infer from `streamUrl`. Default: replace `/stream`
   *  with `/snapshot`. */
  snapshotUrl?: string;
  /** Reconnect delay on close/error. Default 2000 ms. */
  reconnectMs?: number;
  /** Optional logger; defaults to console.warn for unexpected payloads. */
  onWarn?: (message: string) => void;
}

export interface EntityStreamHandle {
  /** Disconnect and stop reconnect attempts. */
  disconnect: () => void;
}

/**
 * Open a WebSocket to `streamUrl` (relative or absolute ws://) and
 * apply incoming frames to the chain-entity cache. Calls `onChange(cache)`
 * on every cache update. Auto-reconnects on close/error.
 *
 * The optional `initial` argument seeds the cache (default: empty).
 * On reconnect the cache's current revision is sent as `?since=` so
 * the server can replay deltas instead of re-sending a full snapshot.
 */
export function connectEntityStream(
  streamUrl: string,
  initial: ChainCache | undefined,
  onChange: (next: ChainCache) => void,
  opts: EntityStreamOptions = {},
): EntityStreamHandle {
  const reconnectMs = opts.reconnectMs ?? 2000;
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let cache: ChainCache = initial ?? emptyChainEntityCache();

  const open = () => {
    if (stopped) return;
    const base = resolveWsUrl(streamUrl);
    const sep = base.includes('?') ? '&' : '?';
    const url = `${base}${sep}since=${cache.revision}`;
    const ws = new WebSocket(url);
    socket = ws;

    ws.onmessage = (msg: MessageEvent) => {
      let frame: EntitiesFrame;
      try {
        frame = typeof msg.data === 'string' ? JSON.parse(msg.data) : (null as never);
      } catch {
        return;
      }
      if (!frame || typeof frame !== 'object') return;
      if (frame.kind === 'snapshot') {
        cache = fromEntitiesPayload(frame.revision, frame.entities);
        onChange(cache);
      } else if (frame.kind === 'delta') {
        cache = applyDeltaToCache(cache, frame.mutations);
        onChange(cache);
      } else if (frame.kind === 'lagged') {
        // Stream lost mutations; force a re-snapshot on reconnect by
        // zeroing our revision. Then drop the connection.
        cache = { ...cache, revision: 0 };
        try {
          ws.close();
        } catch {
          // Best effort.
        }
      }
    };

    const onClose = () => {
      if (stopped) return;
      // Browsers commonly fire `error` then `close` for the same broken
      // socket; without this guard each outage would schedule two timers
      // and reconnect twice in parallel.
      if (reconnectTimer !== null) return;
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
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
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

// Re-export the frame shape for callers that want to drive the
// reducer from their own transport (e.g. tests, sse-style replay).
export type { Mutation };
