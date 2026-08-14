import {
  buildNeighborGraph,
  type NeighborEdge,
  type NeighborGraph,
  type NeighborGraphCell,
  type NeighborGraphOptions,
} from './neighborGraph';
import { buildPassiveNeighborGraph } from './passiveNeighborGraph';
import {
  PACKED_TOPOLOGY_CELL_STRIDE,
  deserializeNeighborGraphWithHints,
  packPreferredEdges,
  packTopologyCells,
  unpackDeltaEdges,
  type NeighborGraphWorkerRequest,
  type NeighborGraphWorkerResponse,
} from './neighborGraphWorkerProtocol';

export const DEFAULT_TOPOLOGY_WORKER_MIN_CELLS = 512;

/** Dev-observable counters for paths that used to fail silently. A sync
 * fallback quietly re-runs the FULL topology build on the main thread — worth
 * seeing in a profile session, not worth a hard failure. */
export const neighborGraphBuilderStats = {
  /** Worker error / postMessage / deserialize failures → main-thread build. */
  workerFallbacks: 0,
  /** Builds below the worker threshold (expected, small fields). */
  belowThresholdBuilds: 0,
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
  /** Read at completion time; when provided, the worker CSR deserializes by
   * patching against these graphs (unchanged nodes reuse their neighbour Set
   * instances — the previous graphs must be discarded after the swap). */
  reuseFrom?: () => {
    graph: NeighborGraph | null;
    passiveGraph: NeighborGraph | null;
  };
}

export interface NeighborGraphBuildResult {
  graph: NeighborGraph;
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
    graph,
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
   * build to the always-correct probing path. */
  let lastAppliedGeneration = 0;

  const terminateWorker = () => {
    inFlightRequestId = null;
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
    }
    const current = active;
    if (!current || response.requestId !== current.requestId) {
      // A superseded build's response: its only remaining job was to free
      // the worker for the newest waiting request.
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
      const result: NeighborGraphBuildResult = {
        graph: deserializeNeighborGraphWithHints(
          reuse?.graph ?? null,
          response.graph,
          chained ? response.changedNodeIds : null,
        ),
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
      const packEdges = () => (options.includePassive
        ? packPreferredEdges(options.preferredEdges ?? [])
        : null);
      const baseRequest = {
        kind: 'build' as const,
        requestId,
        options: options.topology ?? {},
        includePassive: options.includePassive ?? false,
        passiveEdgeBudget: options.passiveEdgeBudget ?? null,
        passiveTuning: options.passiveTuning ?? null,
      };
      const fullRequest = (): NeighborGraphWorkerRequest => ({
        ...baseRequest,
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
    dispose() {
      disposed = true;
      cancel();
      terminateWorker();
    },
  };
}
