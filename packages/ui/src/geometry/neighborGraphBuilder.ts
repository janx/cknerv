import {
  buildNeighborGraph,
  type LivingNeighborGraph,
  type NeighborEdge,
  type NeighborGraph,
  type NeighborGraphCell,
  type NeighborGraphOptions,
} from './neighborGraph';
import { buildPassiveNeighborGraph } from './passiveNeighborGraph';
import {
  PACKED_TOPOLOGY_CELL_STRIDE,
  applyNeighborAdjacencyPatch,
  deserializeLivingNeighborGraphInto,
  deserializeNeighborGraphWithHints,
  packPreferredEdges,
  packTopologyCells,
  unpackDeltaEdges,
  type NeighborGraphWorkerRequest,
  type NeighborGraphWorkerResponse,
} from './neighborGraphWorkerProtocol';

export const DEFAULT_TOPOLOGY_WORKER_MIN_CELLS = 512;

/** Watchdog for the single in-flight request. A worker killed silently (the
 * browser reclaiming memory) answers nothing, and the coalesced-send gate
 * turns that one lost response into a frozen topology for the rest of the
 * session — every later build waits in the queued slot forever. Generous by
 * design: even a 50K full pack on a slow machine is seconds, never half a
 * minute, so this only ever fires on a worker that is gone. */
export const TOPOLOGY_WORKER_REQUEST_TIMEOUT_MS = 30_000;

/** Dev-observable counters for paths that used to fail silently. A sync
 * fallback quietly re-runs the FULL topology build on the main thread — worth
 * seeing in a profile session, not worth a hard failure. */
export const neighborGraphBuilderStats = {
  /** Worker error / postMessage / deserialize failures → main-thread build. */
  workerFallbacks: 0,
  /** Builds below the worker threshold (expected, small fields). */
  belowThresholdBuilds: 0,
  /** In-flight requests the watchdog had to give up on (worker gone). */
  workerTimeouts: 0,
  /** Display graphs applied as an in-place patch against the graph the
   * requester held — the O(churn) steady state of a chained session. */
  patchedApplies: 0,
  /** Display graphs rebuilt from a whole adjacency (bootstrap, fresh
   * worker, or a caller that cannot patch). */
  fullApplies: 0,
  /** Whole applies forced by a generation gap — a superseded, dropped or
   * failed build between two applied ones broke the chain. Each one is a
   * full O(V) rebuild AND, for the passive graph, the probing path. */
  unchainedApplies: 0,
  /** Delta requests the session refused (`stale`): each costs a full
   * re-pack and a second worker round trip before the graph lands. */
  staleResends: 0,
};

let workerFallbackWarned = false;

function noteWorkerFallback(reason: unknown): void {
  neighborGraphBuilderStats.workerFallbacks += 1;
  if (!workerFallbackWarned) {
    workerFallbackWarned = true;
    // The reason rides the warning: this fallback costs a full synchronous
    // topology build, so "which path failed" has to be answerable from a
    // console alone.
    console.warn(
      'neighborGraphBuilder: worker path failed; building topology synchronously '
      + 'on the main thread (counted in neighborGraphBuilderStats.workerFallbacks).',
      reason,
    );
  }
}

export interface NeighborGraphBuildOptions {
  topology?: NeighborGraphOptions;
  includePassive?: boolean;
  /** Visual-only cap for the passive graph. The complete graph remains
   * untouched for routing. */
  passiveEdgeBudget?: number;
  /** Live-tunable passive selection shares (module-constant defaults). */
  passiveTuning?: {
    coverageShare: number;
    trunkShare: number;
    twigShare: number;
  };
  preferredEdges?: readonly NeighborEdge[];
  /** O(churn) topology journal since the previous APPLIED build. When valid
   * and a previous response chained, the builder sends this instead of a
   * full 50K pack; the worker patches its retained cell map. Any gap makes
   * the worker answer `stale` and the builder re-sends the full pack. */
  cellsJournal?: {
    valid: boolean;
    upserts: ReadonlyMap<
      number,
      { id: number; pos_seed: readonly [number, number, number] }
    >;
    removedIds: Iterable<number>;
  };
  /** Read at completion time. The display graph is PATCHED IN PLACE when
   * the response chains from the build it was applied from (the result's
   * `graph` is then this very object, with the eager log consumed); a whole
   * response deserializes against it instead (unchanged nodes keep their
   * Set instances, the previous graph must be discarded). The passive graph
   * always deserializes against `passiveGraph` the same way. Without this
   * option the builder asks the worker for whole graphs only. */
  reuseFrom?: () => {
    graph: LivingNeighborGraph | null;
    passiveGraph: NeighborGraph | null;
  };
}

export interface NeighborGraphBuildResult {
  /** Adjacency only: the display graph carries no edge list. */
  graph: LivingNeighborGraph;
  passiveGraph: NeighborGraph | null;
  /** Passive-selection delta vs the PREVIOUS applied build, available when
   * the worker session's generations chained without a gap. Null means the
   * consumer must treat `passiveGraph` as a full replacement. */
  passiveDelta: {
    added: NeighborEdge[];
    removed: NeighborEdge[];
  } | null;
}

export interface NeighborGraphBuilder {
  /** Resolves `null` when a newer request supersedes this build. */
  build(
    cells: ReadonlyMap<number, NeighborGraphCell>,
    options?: NeighborGraphBuildOptions,
  ): Promise<NeighborGraphBuildResult | null>;
  cancel(): void;
  /** End the Worker and its retained session while the builder stays usable —
   * the next build lazily spawns a fresh one. Unmount uses this: `dispose` is
   * terminal, and React Strict Mode replays setup→cleanup→setup against the
   * same builder instance. */
  releaseWorker(): void;
  dispose(): void;
}

interface ActiveBuild {
  requestId: number;
  resolve: (result: NeighborGraphBuildResult | null) => void;
  reject: (reason: unknown) => void;
  fallback: () => NeighborGraphBuildResult;
  /** Delta-or-full request, packed at SEND time — a build superseded while
   * still queued never pays for packing at all. */
  buildRequest: () => NeighborGraphWorkerRequest;
  /** Fresh full pack answering the worker's `stale` reply. */
  fullRequest: () => NeighborGraphWorkerRequest;
  reuseFrom: NeighborGraphBuildOptions['reuseFrom'];
}

export interface NeighborGraphBuilderOptions {
  minWorkerCells?: number;
  workerFactory?: () => Worker;
}

function buildSynchronously(
  cells: ReadonlyMap<number, NeighborGraphCell>,
  options: NeighborGraphBuildOptions,
): NeighborGraphBuildResult {
  const graph = buildNeighborGraph(cells, options.topology);
  return {
    // The dense edge list serves the passive selection below and nothing
    // else on this thread; the display graph drops it.
    graph: { adjacency: graph.adjacency, eagerBase: new Map() },
    passiveGraph: options.includePassive
      ? buildPassiveNeighborGraph(graph, {
        edgeBudget: options.passiveEdgeBudget,
        coverageShare: options.passiveTuning?.coverageShare,
        trunkShare: options.passiveTuning?.trunkShare,
        twigShare: options.passiveTuning?.twigShare,
        preferredEdges: options.preferredEdges,
      })
      : null,
    passiveDelta: null,
  };
}

function defaultWorkerFactory(): Worker {
  return new Worker(
    new URL('./neighborGraph.worker.ts', import.meta.url),
    { type: 'module', name: 'cknerv-neighbor-graph' },
  );
}

/** Latest-only topology builder over one long-lived Worker, with COALESCED
 * sends: at most one request is inside the worker at a time, and the newest
 * superseding build waits in a single queued slot until the in-flight
 * response frees the worker. Without that gate every superseded request
 * still executed a full k-NN build worker-side (only its RESULT was
 * abandoned), so backfill/reorg churn queued seconds of stale compute and
 * the latest graph landed late. */
export function createNeighborGraphBuilder(
  builderOptions: NeighborGraphBuilderOptions = {},
): NeighborGraphBuilder {
  const minWorkerCells = Math.max(
    0,
    Math.floor(
      builderOptions.minWorkerCells ?? DEFAULT_TOPOLOGY_WORKER_MIN_CELLS,
    ),
  );
  const workerFactory = builderOptions.workerFactory ?? defaultWorkerFactory;
  let worker: Worker | null = null;
  let active: ActiveBuild | null = null;
  /** Request currently being computed inside the worker (posted, response
   * not yet received). May belong to `active` or to a superseded build —
   * either way the worker is busy and new sends must wait in
   * `pendingSend`. */
  let inFlightRequestId: number | null = null;
  /** Send-closure for `active` while the worker is busy. Exactly one slot:
   * a newer build replaces it (the replaced build already resolved null),
   * so the worker only ever sees the request that was newest when it
   * became free. */
  let pendingSend: (() => void) | null = null;
  let nextRequestId = 1;
  let disposed = false;
  /** Generation of the last worker response actually APPLIED on this side.
   * Incremental hints are trusted only when the next response chains from
   * it; a superseded/dropped response breaks the chain and downgrades one
   * build to the always-correct probing path. Zero means "no chain": the
   * next request is a full pack, which re-bases the session wholesale. */
  let lastAppliedGeneration = 0;
  /** Mirror of the session's own passive-selection memory (it keeps the
   * previous selection as the continuity preference). While it holds one,
   * `preferredEdges` is dead weight on the wire — the session never reads
   * the field. */
  let sessionHoldsPassiveEdges = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const clearWatchdog = () => {
    if (watchdog === null) return;
    clearTimeout(watchdog);
    watchdog = null;
  };

  const terminateWorker = () => {
    inFlightRequestId = null;
    clearWatchdog();
    // The generation chain and the continuity memory belong to the SESSION:
    // a fresh worker starts at generation 0 with no retained cells, so every
    // delta against the old baseline is meaningless (the session would
    // answer `stale` and cost a needless round trip).
    lastAppliedGeneration = 0;
    sessionHoldsPassiveEdges = false;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = null;
  };

  // The worker survives across builds (its session retains the previous
  // graph so responses carry incremental hints, and per-build spawn + JIT
  // re-warm disappear). Superseding an in-flight request only abandons the
  // RESULT: responses are keyed by requestId, and a stale response advances
  // nothing on this side. Termination is reserved for dispose and failures.
  const cancel = () => {
    pendingSend = null;
    if (active) {
      active.resolve(null);
      active = null;
    }
  };

  const releaseWorker = () => {
    cancel();
    terminateWorker();
  };

  /** Worker-path failure: resolve the active build through the synchronous
   * fallback and drop the worker (its queue and session die with it). */
  const failWorker = (reason: unknown) => {
    noteWorkerFallback(reason);
    const current = active;
    active = null;
    pendingSend = null;
    terminateWorker();
    if (!current) return;
    try {
      current.resolve(current.fallback());
    } catch (error) {
      current.reject(error);
    }
  };

  /** Post a request with the transfer list its own buffers imply. */
  const postToWorker = (outgoing: NeighborGraphWorkerRequest): void => {
    const transfer: Transferable[] = [];
    if (outgoing.cells) transfer.push(outgoing.cells.buffer);
    if (outgoing.cellsDelta) {
      transfer.push(
        outgoing.cellsDelta.upserts.buffer,
        outgoing.cellsDelta.removedIds.buffer,
      );
    }
    if (outgoing.preferredEdges) {
      transfer.push(outgoing.preferredEdges.buffer);
    }
    worker!.postMessage(outgoing, transfer);
    inFlightRequestId = outgoing.requestId;
    // Armed on every send (including the stale-resend, which re-enters the
    // worker under the same requestId) and cleared by the matching response
    // or by termination, so exactly one timer can be pending.
    clearWatchdog();
    watchdog = setTimeout(() => {
      watchdog = null;
      neighborGraphBuilderStats.workerTimeouts += 1;
      failWorker(new Error(
        `neighbor graph worker did not answer request ${outgoing.requestId} `
        + `within ${TOPOLOGY_WORKER_REQUEST_TIMEOUT_MS}ms`,
      ));
    }, TOPOLOGY_WORKER_REQUEST_TIMEOUT_MS);
  };

  const flushPendingSend = () => {
    if (inFlightRequestId !== null) return;
    const dispatch = pendingSend;
    pendingSend = null;
    dispatch?.();
  };

  const handleResponse = (
    event: MessageEvent<NeighborGraphWorkerResponse>,
  ) => {
    const response = event.data;
    if (response.requestId === inFlightRequestId) {
      inFlightRequestId = null;
      clearWatchdog();
    }
    if (response.kind === 'built') {
      // Mirrors the session's own `lastPassiveEdges` assignment, which
      // happens whether or not this build was superseded.
      sessionHoldsPassiveEdges = response.passiveGraph !== null;
    }
    const current = active;
    if (!current || response.requestId !== current.requestId) {
      // A superseded build's response: its only remaining job was to free
      // the worker for the newest waiting request. A failure among them
      // still breaks the chain — the session may have thrown halfway
      // through applying a delta, leaving a retained baseline no later
      // delta may be trusted against.
      if (response.kind === 'failed') lastAppliedGeneration = 0;
      flushPendingSend();
      return;
    }
    if (response.kind === 'failed') {
      failWorker(response.message);
      return;
    }
    if (response.kind === 'stale') {
      // Ordinary after a superseded/dropped build: re-send a freshly
      // packed full request under the same requestId (full requests
      // never go stale).
      neighborGraphBuilderStats.staleResends += 1;
      try {
        postToWorker(current.fullRequest());
      } catch (error) {
        failWorker(error);
      }
      return;
    }
    try {
      const reuse = current.reuseFrom?.() ?? null;
      const chained = response.generation === lastAppliedGeneration + 1;
      let graph: LivingNeighborGraph;
      if (response.graph.kind === 'patch') {
        // The session only patches against the generation the request
        // named, and the request named the one applied here — so a patch
        // chains by construction, and the graph it targets is the one
        // `reuseFrom` returns. Anything else is a protocol violation and
        // must not be applied to a base it was not computed against.
        if (!chained || reuse?.graph == null) {
          throw new Error('display graph patch without its base graph');
        }
        neighborGraphBuilderStats.patchedApplies += 1;
        graph = applyNeighborAdjacencyPatch(reuse.graph, response.graph.patch);
      } else {
        neighborGraphBuilderStats.fullApplies += 1;
        if (!chained && lastAppliedGeneration !== 0) {
          neighborGraphBuilderStats.unchainedApplies += 1;
        }
        graph = deserializeLivingNeighborGraphInto(
          reuse?.graph ?? null,
          response.graph.adjacency,
        );
      }
      const result: NeighborGraphBuildResult = {
        graph,
        passiveGraph: response.passiveGraph
          ? deserializeNeighborGraphWithHints(
            reuse?.passiveGraph ?? null,
            response.passiveGraph,
            chained ? response.passiveChangedNodeIds : null,
          )
          : null,
        passiveDelta:
          chained
          && response.passiveAdded !== null
          && response.passiveRemoved !== null
            ? {
              added: unpackDeltaEdges(response.passiveAdded),
              removed: unpackDeltaEdges(response.passiveRemoved),
            }
            : null,
      };
      lastAppliedGeneration = response.generation;
      active = null;
      current.resolve(result);
    } catch (error) {
      failWorker(error);
    }
  };

  return {
    build(cells, options = {}) {
      if (disposed) return Promise.resolve(null);
      cancel();
      // The retained map's size upper-bounds live cells closely enough for
      // the worker threshold; the full O(N) pack happens only when a full
      // request is actually needed.
      const canUseWorker = (
        cells.size >= minWorkerCells
        && (
          builderOptions.workerFactory !== undefined
          || typeof Worker !== 'undefined'
        )
      );
      const fallback = () => buildSynchronously(cells, options);
      if (!canUseWorker) {
        neighborGraphBuilderStats.belowThresholdBuilds += 1;
        // This build lands on the main thread, but the caller already
        // consumed its journal window for it — a window the surviving worker
        // session never sees. Keeping the chain would let the NEXT delta
        // patch a baseline that skipped it (cells removed here linger as
        // ghost nodes until the next unrelated chain break), so the chain
        // restarts with a full pack.
        lastAppliedGeneration = 0;
        return Promise.resolve().then(fallback);
      }

      try {
        if (worker === null) {
          worker = workerFactory();
          // One persistent dispatcher: responses are routed by requestId,
          // so handlers survive across builds instead of being re-bound
          // (and nulled) per request.
          worker.onmessage = handleResponse;
          worker.onerror = (event) => failWorker(event);
          worker.onmessageerror = (event) => failWorker(event);
        }
      } catch (error) {
        noteWorkerFallback(error);
        terminateWorker();
        return Promise.resolve().then(fallback);
      }

      const requestId = nextRequestId;
      nextRequestId += 1;
      // Every packed buffer is TRANSFERRED, which detaches it here — so each
      // request packs its own. Sharing one pack across the delta request and
      // the stale-resend below would post a detached buffer, and the throw
      // lands in the silent fallback (a full synchronous rebuild).
      //
      // Continuity edges ride only when the session has none of its own: it
      // prefers its previous passive selection and ignores the field
      // otherwise, so packing 8K edges per build bought nothing. Evaluated at
      // SEND time, which is also when the mirrored flag is exact (the single
      // in-flight gate means no response can land between the two).
      const packEdges = () => (
        options.includePassive && !sessionHoldsPassiveEdges
          ? packPreferredEdges(options.preferredEdges ?? [])
          : null
      );
      const baseRequest = {
        kind: 'build' as const,
        requestId,
        options: options.topology ?? {},
        includePassive: options.includePassive ?? false,
        passiveEdgeBudget: options.passiveEdgeBudget ?? null,
        passiveTuning: options.passiveTuning ?? null,
      };
      // The display graph the caller holds is the one applied from
      // `lastAppliedGeneration`; naming it lets the session answer with a
      // patch against exactly that build. Evaluated at SEND time like the
      // continuity edges (the single in-flight gate means no apply can land
      // between packing and posting), and zero for a caller without
      // `reuseFrom` — it has no graph to patch, so it must be sent a whole one.
      const patchBase = () => (
        options.reuseFrom !== undefined ? lastAppliedGeneration : 0
      );
      const fullRequest = (): NeighborGraphWorkerRequest => ({
        ...baseRequest,
        patchBaseGeneration: patchBase(),
        preferredEdges: packEdges(),
        cells: packTopologyCells(cells),
        cellsDelta: null,
      });
      const journal = options.cellsJournal;
      const deltaRequest = (): NeighborGraphWorkerRequest | null => {
        if (!journal?.valid || lastAppliedGeneration === 0) return null;
        const upserts = new Float64Array(
          journal.upserts.size * PACKED_TOPOLOGY_CELL_STRIDE,
        );
        let offset = 0;
        for (const cell of journal.upserts.values()) {
          upserts[offset] = cell.id;
          upserts[offset + 1] = cell.pos_seed[0];
          upserts[offset + 2] = cell.pos_seed[1];
          upserts[offset + 3] = cell.pos_seed[2];
          offset += PACKED_TOPOLOGY_CELL_STRIDE;
        }
        return {
          ...baseRequest,
          patchBaseGeneration: patchBase(),
          preferredEdges: packEdges(),
          cells: null,
          cellsDelta: {
            baseGeneration: lastAppliedGeneration,
            upserts,
            removedIds: Float64Array.from(journal.removedIds),
          },
        };
      };
      return new Promise<NeighborGraphBuildResult | null>((resolve, reject) => {
        const build: ActiveBuild = {
          requestId,
          resolve,
          reject,
          fallback,
          buildRequest: () => deltaRequest() ?? fullRequest(),
          fullRequest,
          reuseFrom: options.reuseFrom,
        };
        active = build;
        const dispatch = () => {
          if (active !== build) return;
          try {
            postToWorker(build.buildRequest());
          } catch (error) {
            failWorker(error);
          }
        };
        if (inFlightRequestId === null) {
          dispatch();
        } else {
          // Worker busy: wait in the single queued slot. Whatever response
          // arrives next — including one for a superseded build — frees
          // the worker and flushes this send.
          pendingSend = dispatch;
        }
      });
    },
    cancel,
    releaseWorker,
    dispose() {
      disposed = true;
      releaseWorker();
    },
  };
}
