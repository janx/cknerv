// Bootstrap fetch helpers for the cknerv backend. Same-origin —
// `cknerv-cli`'s axum server hosts both the API routes and the SPA
// bundle on a single port, so an empty `API_BASE` resolves correctly
// against `window.location.origin`.

import {
  cellsSnapshotFromColumnar,
  decodeCellsColumnar,
  STREAM_RECONNECT_MS,
  type StreamHealth,
} from '@cknerv/cache';
import type {
  CellGalaxySnapshot,
  ChainEntry,
  ChainNode,
  Peer,
} from '@cknerv/types';
import {
  beginBootPhase,
  beginBootRequest,
  completeBootRequest,
  completeBootPhase,
  deriveNodeStreamHealth,
  failBootPhase,
  failBootRequest,
  nodeStreamHealthLifecycleChanged,
  reportBootRequestProgress,
  reportBootRequestResponse,
  type NodeStreamHealth,
} from '@cknerv/ui';

const API_BASE = '';

/** Wire shape of `/api/entities/chain/snapshot`. The chain-entities
 *  endpoint returns the Chain entity + chain_nodes inline rather than
 *  wrapping in a `snapshot` field (see cknerv-server `ServerState::snapshot`). */
export interface ChainSnapshotResponse {
  revision: number;
  chain: ChainEntry;
  chain_nodes?: ChainNode[];
  peers?: Peer[];
}

/** Wire shape of `/api/projections/:name/snapshot`. Projection endpoints
 *  wrap the snapshot payload in a `snapshot` field for parity with the
 *  WebSocket frame protocol. */
export interface ProjectionSnapshotResponse<T> {
  revision: number;
  snapshot: T;
}

interface BootstrapFetchOptions {
  now?: () => number;
}

export async function fetchChainSnapshot(
  options: BootstrapFetchOptions = {},
): Promise<ChainSnapshotResponse> {
  const now = options.now ?? performance.now.bind(performance);
  const attempt = beginBootRequest('chain', 'chain-json', now());
  try {
    const resp = await fetch(`${API_BASE}/api/entities/chain/snapshot`);
    if (!resp.ok) {
      reportBootRequestResponse('chain', attempt, now(), parseContentLength(resp));
      throw new Error(`chain snapshot: ${resp.status}`);
    }
    const body = await readSnapshotBody(resp, 'chain', attempt, now);
    completeBootRequest('chain', attempt, now());
    const parsed = JSON.parse(new TextDecoder().decode(body)) as ChainSnapshotResponse;
    return parsed;
  } catch (error) {
    failBootRequest('chain', attempt, now(), error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/** A header is a denominator only if it parses to a real byte count. Anything
 *  else is indeterminate — never zero, because a zero denominator is exactly
 *  the invented percentage the readout refuses to show. */
function parseContentLength(resp: Response): number | null {
  const encoding = resp.headers.get('content-encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') return null;
  const header = resp.headers.get('content-length');
  if (header === null) return null;
  const total = Number(header);
  return Number.isFinite(total) && total > 0 ? total : null;
}

/** Read a snapshot body to bytes, reporting the byte count as it arrives.
 *
 * This is the only continuous measure in the boot sequence and it is exact:
 * the snapshot routes send a real `content-length` and no `content-encoding`,
 * so received/total is the true share of the download rather than an eased
 * guess. An environment without a streaming body still resolves — it just
 * reports once, at the end, which is the pre-existing behaviour plus a tick. */
async function readSnapshotBody(
  resp: Response,
  kind: 'chain' | 'cells',
  attempt: number,
  now: () => number,
): Promise<ArrayBuffer> {
  const total = parseContentLength(resp);
  reportBootRequestResponse(kind, attempt, now(), total);
  if (!resp.body) {
    const whole = await resp.arrayBuffer();
    reportBootRequestProgress(kind, attempt, now(), whole.byteLength);
    return whole;
  }
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  // Headers are in, so the transfer has a size and a starting point; say so
  // before the first chunk rather than after it.
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    received += value.byteLength;
    reportBootRequestProgress(kind, attempt, now(), received);
  }
  // One exact-size allocation: the columnar decoder reads an ArrayBuffer, and
  // a chunk's own buffer may be a window into a larger pooled one.
  const body = new ArrayBuffer(received);
  const view = new Uint8Array(body);
  let offset = 0;
  for (const chunk of chunks) {
    view.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** The cell galaxy, columnar when the server offers it.
 *
 * The columnar form is the same snapshot in a shape the main thread mostly
 * does not have to parse. Measured end to end against a live mainnet
 * server: 23.4MB and 73.9ms to `JSON.parse`, against 11.9MB and 43.7ms to
 * decode plus rebuild — and a 501-row field-by-field diff of the two
 * results, both hashes included, with no mismatches. Anything at all going
 * wrong — an older server that 404s the route, an unknown format
 * version, a truncated buffer — falls back to JSON, because a slower boot
 * is a cost and a failed boot is a bug.
 *
 * This download is also the longest thing the visitor waits through — the
 * whole of it happens before React exists — so both routes stream their body
 * and report bytes into the boot record, which the static shell in
 * `index.html` is reading meanwhile. Both routes, because the fallback is the
 * bigger download: the slow path is where the count matters most. */
export async function fetchCellsSnapshot(
  options: BootstrapFetchOptions = {},
): Promise<ProjectionSnapshotResponse<CellGalaxySnapshot>> {
  const now = options.now ?? performance.now.bind(performance);
  // The phase covers the request, not just its bytes: on a slow link the
  // wait for headers is a real part of it and the readout may not go blank.
  beginBootPhase('snapshot');
  const binaryAttempt = beginBootRequest('cells', 'cells-binary', now());
  let binaryFailureWasExpected = false;
  try {
    const resp = await fetch(`${API_BASE}/api/projections/cells/snapshot.bin`);
    if (!resp.ok) {
      binaryFailureWasExpected = true;
      reportBootRequestResponse('cells', binaryAttempt, now(), parseContentLength(resp));
      throw new Error(`cells binary snapshot: ${resp.status}`);
    }
    const body = await readSnapshotBody(resp, 'cells', binaryAttempt, now);
    completeBootRequest('cells', binaryAttempt, now());
    completeBootPhase('snapshot');
    beginBootPhase('decode');
    const view = decodeCellsColumnar(body);
    const snapshot = cellsSnapshotFromColumnar(view);
    completeBootPhase('decode');
    return { revision: view.revision, snapshot };
  } catch (error) {
    failBootRequest('cells', binaryAttempt, now(), error instanceof Error ? error.message : String(error));
    if (!binaryFailureWasExpected) {
      console.warn('columnar cells snapshot unusable; falling back to JSON', error);
    }
  }
  // Which line a failure below is charged to: until the bytes are in the
  // fault belongs to the download, after that to the parse. Either write is a
  // no-op against a phase that already finished, so a fallback can never
  // demote what the columnar route got through.
  let faultedPhase: 'snapshot' | 'decode' = 'snapshot';
  const jsonAttempt = beginBootRequest('cells', 'cells-json', now());
  try {
    const resp = await fetch(`${API_BASE}/api/projections/cells/snapshot`);
    if (!resp.ok) {
      reportBootRequestResponse('cells', jsonAttempt, now(), parseContentLength(resp));
      throw new Error(`cells snapshot: ${resp.status}`);
    }
    const body = await readSnapshotBody(resp, 'cells', jsonAttempt, now);
    completeBootRequest('cells', jsonAttempt, now());
    completeBootPhase('snapshot');
    faultedPhase = 'decode';
    beginBootPhase('decode');
    // The reader consumed the body, so `resp.json()` is no longer available.
    const parsed = JSON.parse(
      new TextDecoder().decode(body),
    ) as ProjectionSnapshotResponse<CellGalaxySnapshot>;
    completeBootPhase('decode');
    return parsed;
  } catch (error) {
    failBootRequest('cells', jsonAttempt, now(), error instanceof Error ? error.message : String(error));
    // Both routes are dead. The bootstrap catch renders the error text; this
    // marks the line so a banner already on screen carries the fault too.
    failBootPhase(
      faultedPhase,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

// ——— The hop the browser has no socket for ————————————————————————————————
//
// Every transport above is the browser's own, and all of them stay perfectly
// live while the node behind the server is gone: cknerv keeps its sockets open
// and heartbeats a tip that has stopped moving. So the most likely real fault
// of a local-first tool had no vocabulary at all, and surfaced two and a half
// minutes later as a chain STALL — a node outage reported as a chain fault,
// late (report E, E-7).
//
// `/api/health` is the answer and it is already there. This is a POLL and not
// a stream on purpose: the endpoint is designed to answer while the process is
// unwell (no projection lock, no snapshot, poisoned locks read through), and a
// socket is exactly the thing that stops telling you anything when the server
// is the problem. One GET every `STREAM_RECONNECT_MS` costs the same as the
// reconnect the sockets are already doing at that cadence, and no dependency.

/** The shortest a poll may be given before it is abandoned, however fast the
 *  cadence above it. The deadline itself is twice the poll interval — a probe
 *  that has not answered by the time the next one is due has already stopped
 *  being a reading of now — and this floor keeps a busy local server answering
 *  in a second or two from being called dead by an impatient cadence. */
const HEALTH_POLL_TIMEOUT_FLOOR_MS = 4_000;

/** Wire shape of `GET /api/health`, narrowed to the four fields the node
 *  channel reads. The endpoint reports a dozen more; the page is probing
 *  vitals, not consuming a projection, so it names only what it asks. */
interface HealthResponse {
  degraded?: boolean;
  adapters?: Array<{ name?: string; alive?: boolean }>;
  tip_age_ms?: number | null;
  /** The server's own one-field roster of views it has stopped building. */
  quarantined_projections?: string[];
}

/**
 * Poll the server's own health and publish the node's hop as a channel.
 *
 * `onHealth(null)` means "I have nothing to say" — the request failed, so the
 * server is unreachable, and the SOCKETS own that story. Publishing a fault
 * here for it would put two banners on one emergency, and the one that knows
 * least would be shouting.
 *
 * Every poll carries its own deadline, because this endpoint's whole purpose
 * is the case where THE SERVER IS THE PROBLEM. A process that still accepts
 * the connection and never answers it is the shape that failure most often
 * takes, and a `fetch` with no signal on it waits out the browser's own
 * default — minutes — during which nothing is published and the node channel
 * goes on showing a reading that stopped being true. The deadline turns that
 * silence back into the answer the catch below already knows how to give.
 */
export function connectNodeHealth(
  onHealth: (health: NodeStreamHealth | null) => void,
  opts: { pollMs?: number; now?: () => number } = {},
): { disconnect: () => void } {
  const pollMs = Math.max(250, opts.pollMs ?? STREAM_RECONNECT_MS);
  const timeoutMs = Math.max(HEALTH_POLL_TIMEOUT_FLOOR_MS, pollMs * 2);
  const now = opts.now ?? Date.now;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The request on the wire, so `disconnect` can drop it rather than leave
   *  the page holding a socket for an answer nobody will read. */
  let inFlight: AbortController | null = null;
  /** The last reading TAKEN, published or not. The stamp inside it moves on
   *  every poll and has no rendered output while the node is live, so a poll
   *  that only restamps updates this and publishes nothing; the next poll
   *  that actually changes the channel's sentence carries the current stamp
   *  with it. Same rule, same reason, as the three socket trackers'
   *  `lifecycleChanged` in `@cknerv/cache`. */
  let published: NodeStreamHealth | null = null;
  let everPublished = false;
  const publish = (next: NodeStreamHealth | null) => {
    if (everPublished && !nodeStreamHealthLifecycleChanged(published, next)) {
      published = next;
      return;
    }
    published = next;
    everPublished = true;
    onHealth(next);
  };
  const poll = async (): Promise<void> => {
    const controller = new AbortController();
    inFlight = controller;
    // An own controller and an own timer rather than `AbortSignal.timeout`:
    // this is the same `setTimeout` the cadence below runs on, so a test that
    // owns the clock owns the deadline too.
    const deadline = setTimeout(() => { controller.abort(); }, timeoutMs);
    try {
      const resp = await fetch(`${API_BASE}/api/health`, {
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`health: ${resp.status}`);
      const body = (await resp.json()) as HealthResponse;
      if (stopped) return;
      publish(deriveNodeStreamHealth({
        degraded: body.degraded === true,
        adapters: (body.adapters ?? []).map((adapter) => ({
          name: adapter.name ?? '',
          // An adapter the body did not describe is not evidence that it died.
          alive: adapter.alive !== false,
        })),
        tipAgeMs: typeof body.tip_age_ms === 'number' ? body.tip_age_ms : null,
        // A body that names no roster is not a body reporting a quarantine.
        // The reading is `degraded` gating a NAMED list, so an older server
        // that never learned the field is read as well rather than as mute.
        quarantinedProjections: (body.quarantined_projections ?? [])
          .filter((name): name is string => typeof name === 'string'),
      }, now()));
    } catch {
      // An abandoned request and a refused one are the same reading: the
      // server did not answer, so this channel has nothing to say.
      if (!stopped) publish(null);
    } finally {
      clearTimeout(deadline);
      if (inFlight === controller) inFlight = null;
      if (!stopped) timer = setTimeout(() => { void poll(); }, pollMs);
    }
  };
  void poll();
  return {
    disconnect: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      // The request already on the wire goes with the cadence. `stopped`
      // alone would keep its answer from being published, and would still
      // leave the browser holding the connection until the server or the
      // deadline let go of it.
      inFlight?.abort();
      inFlight = null;
    },
  };
}
