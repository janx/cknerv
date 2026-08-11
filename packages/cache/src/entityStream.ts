// WebSocket client for cknerv-server's `/api/entities/chain/stream`
// endpoint (or any path with the same frame protocol).
//
// Frame protocol (matches cknerv-server `ws::handle_chain_stream`):
//   `{"kind":"snapshot", "revision":N, "entities":{"chain":<ChainEntry>,
//                                  "chain_nodes":[...], "peers":[...]}}`
//   `{"kind":"delta", "revision":N, "mutations":[RevisionedMutation, ...]}`
//   `{"kind":"lagged", "skipped":N, "revision":lastSent}`
//
// Auto-reconnects on close/error. On a `lagged` frame the cache's
// revision is zeroed so the server has to ship a fresh snapshot.

import type {
  ChainEntry,
  ChainNode,
  Mutation,
  Peer,
  RevisionedMutation,
} from '@cknerv/types';

import {
  applyRevisionedChainMutations,
  emptyChainCache,
} from './chainReducer';
import {
  createStreamHealthTracker,
  type StreamHealthOptions,
} from './streamHealth';

/** Materialized client-side chain entity cache. Subscribers receive a
 *  fresh `ChainCache` value on every change so React selectors with
 *  referential equality re-render. */
export interface ChainCache {
  revision: number;
  chain: ChainEntry;
  chainNodes: ChainNode[];
  peers: Peer[];
}

export function emptyChainEntityCache(): ChainCache {
  return {
    revision: 0,
    chain: emptyChainCache(),
    chainNodes: [],
    peers: [],
  };
}

interface EntitiesPayload {
  chain: ChainEntry;
  chain_nodes?: ChainNode[];
  peers?: Peer[];
}

type EntitiesFrame =
  | { kind: 'snapshot'; revision: number; entities: EntitiesPayload }
  | { kind: 'delta'; revision: number; mutations: RevisionedMutation[] }
  | { kind: 'lagged'; skipped: number; revision?: number }
  | { kind: 'heartbeat'; revision?: number };

export function fromEntitiesSnapshot(rev: number, p: EntitiesPayload): ChainCache {
  return {
    revision: rev,
    chain: p.chain,
    chainNodes: p.chain_nodes ?? [],
    peers: p.peers ?? [],
  };
}

/** Fold node/peer-targeting mutations (not handled by the ChainEntry
 *  reducer) into the chainNodes + peers slices. Returns the same arrays
 *  when nothing changed so referential equality is preserved. */
function applyNodePeerDeltas(
  chainNodes: ChainNode[],
  peers: Peer[],
  rms: RevisionedMutation[],
): { chainNodes: ChainNode[]; peers: Peer[] } {
  let nodes = chainNodes;
  let nextPeers = peers;
  for (const { mutation: m } of rms) {
    if (m.type === 'peers_updated') {
      // Intentional alias: the WS frame is freshly parsed and discarded
      // after reduction, so we adopt its array rather than copying. Do not
      // "fix" this into a defensive copy — the same-reference-when-unchanged
      // contract above (and its regression test) depends on minimal churn.
      nextPeers = m.peers;
    } else if (m.type === 'chain_node_registered') {
      const i = nodes.findIndex((n) => n.id === m.id);
      // The adapter re-registers on every poll; an unchanged row must keep
      // the array identity so downstream memos (node ids → icosahedra layout
      // → P2P topology) don't rebuild on a no-op frame.
      if (
        i >= 0
        && nodes[i].label === m.label
        && nodes[i].is_miner === m.is_miner
      ) continue;
      const row: ChainNode = {
        id: m.id,
        label: m.label,
        is_miner: m.is_miner,
        version: i >= 0 ? nodes[i].version : '',
        connections: i >= 0 ? nodes[i].connections : 0,
      };
      nodes = i >= 0
        ? nodes.map((n, j) => (j === i ? row : n))
        : [...nodes, row];
    } else if (m.type === 'chain_node_info_updated') {
      const i = nodes.findIndex((n) => n.id === m.id);
      if (
        i >= 0
        && (nodes[i].version !== m.version
          || nodes[i].connections !== m.connections)
      ) {
        nodes = nodes.map((n, j) =>
          j === i ? { ...n, version: m.version, connections: m.connections } : n,
        );
      }
    }
  }
  return { chainNodes: nodes, peers: nextPeers };
}

export function applyEntityDelta(
  prev: ChainCache,
  rms: RevisionedMutation[],
): ChainCache {
  if (rms.length === 0) return prev;
  const nextChain = applyRevisionedChainMutations(prev.chain, rms);
  const { chainNodes, peers } = applyNodePeerDeltas(prev.chainNodes, prev.peers, rms);
  let maxRev = prev.revision;
  for (const rm of rms) if (rm.revision > maxRev) maxRev = rm.revision;
  return { revision: maxRev, chain: nextChain, chainNodes, peers };
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

export interface EntityStreamOptions extends StreamHealthOptions {
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

/** Hidden tabs stop delivering animation frames; a short timeout keeps the
 *  cache advancing there. Matches projectionStream's delta batcher. */
const DELTA_BATCH_FALLBACK_MS = 50;

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
  let needsResync = false;
  // Delta frames coalesce to one reducer apply + one onChange per animation
  // frame (mirrors projectionStream): the server ships one frame per
  // mutation, and per-frame React commits are pure overhead.
  let pendingMutations: RevisionedMutation[] = [];
  let cancelDeltaFlush: (() => void) | null = null;

  const flushPendingDeltas = () => {
    const cancel = cancelDeltaFlush;
    cancelDeltaFlush = null;
    cancel?.();
    if (stopped || pendingMutations.length === 0) return;
    const mutations = pendingMutations;
    pendingMutations = [];
    const prev = cache;
    cache = applyEntityDelta(prev, mutations);
    // Revision-only advances (e.g. an unchanged poll re-broadcast) update the
    // internal `?since=` cursor but carry no observable state: skip the React
    // publish entirely so no-op frames cost nothing downstream.
    if (
      cache.chain === prev.chain
      && cache.chainNodes === prev.chainNodes
      && cache.peers === prev.peers
    ) return;
    onChange(cache);
  };

  const discardPendingDeltas = () => {
    pendingMutations = [];
    const cancel = cancelDeltaFlush;
    cancelDeltaFlush = null;
    cancel?.();
  };

  const scheduleDeltaFlush = () => {
    if (cancelDeltaFlush !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      const frameId = requestAnimationFrame(flushPendingDeltas);
      const timeoutId = setTimeout(flushPendingDeltas, DELTA_BATCH_FALLBACK_MS);
      cancelDeltaFlush = () => {
        cancelAnimationFrame(frameId);
        clearTimeout(timeoutId);
      };
      return;
    }
    const timeoutId = setTimeout(flushPendingDeltas, 0);
    cancelDeltaFlush = () => clearTimeout(timeoutId);
  };

  /** Same close-handshake-deadlock hardening as the projection stream: a
   * server under replay load may never complete the close handshake after a
   * `lagged` close or a stale-watchdog close, so retries must not depend on
   * `onclose`. Idempotent (one pending timer); the stale socket is detached
   * so its late events cannot double-schedule or touch the next socket. */
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
    scheduleReconnect(true);
  });

  const open = () => {
    if (stopped) return;
    health.startAttempt(needsResync);
    const base = resolveWsUrl(streamUrl);
    const sep = base.includes('?') ? '&' : '?';
    const url = `${base}${sep}since=${cache.revision}`;
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => health.opened(needsResync);

    ws.onmessage = (msg: MessageEvent) => {
      let frame: EntitiesFrame;
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
        cache = fromEntitiesSnapshot(frame.revision, frame.entities);
        needsResync = false;
        health.message();
        onChange(cache);
      } else if (frame.kind === 'delta') {
        needsResync = false;
        health.message();
        if (frame.mutations.length > 0) {
          pendingMutations.push(...frame.mutations);
          scheduleDeltaFlush();
        }
      } else if (frame.kind === 'lagged') {
        // Stream lost mutations; force a re-snapshot on reconnect by
        // zeroing our revision, and schedule that reconnect DIRECTLY —
        // waiting for the close handshake deadlocks under replay load.
        discardPendingDeltas();
        needsResync = true;
        health.resyncing();
        cache = { ...cache, revision: 0 };
        scheduleReconnect(false);
      }
    };

    const onClose = () => {
      // Browsers commonly fire `error` then `close` for the same broken
      // socket; scheduleReconnect's single-timer guard collapses them, and
      // the identity check ignores late events from detached sockets.
      if (socket !== ws) return;
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

// Re-export the frame shape for callers that want to drive the
// reducer from their own transport (e.g. tests, sse-style replay).
export type { Mutation };
