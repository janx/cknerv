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

function noteWorkerFallback(): void {
  neighborGraphBuilderStats.workerFallbacks += 1;
  if (!workerFallbackWarned) {
    workerFallbackWarned = true;
    console.warn(
      'neighborGraphBuilder: worker path failed; building topology synchronously '
      + 'on the main thread (counted in neighborGraphBuilderStats.workerFallbacks).',
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

/** Latest-only topology builder. Superseding an in-flight build terminates its
 * Worker so backfill/config churn cannot queue seconds of stale CPU work. */
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
  let nextRequestId = 1;
  let disposed = false;
  /** Generation of the last worker response actually APPLIED on this side.
   * Incremental hints are trusted only when the next response chains from
   * it; a superseded/dropped response breaks the chain and downgrades one
   * build to the always-correct probing path. */
  let lastAppliedGeneration = 0;

  const terminateWorker = () => {
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
    if (active) {
      active.resolve(null);
      active = null;
    }
  };

  const fallbackActive = (requestId: number) => {
    const current = active;
    if (!current || current.requestId !== requestId) return;
    active = null;
    terminateWorker();
    try {
      current.resolve(current.fallback());
    } catch (error) {
      current.reject(error);
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
        worker ??= workerFactory();
      } catch {
        noteWorkerFallback();
        terminateWorker();
        return Promise.resolve().then(fallback);
      }

      const requestId = nextRequestId;
      nextRequestId += 1;
      const preferredEdges = options.includePassive
        ? packPreferredEdges(options.preferredEdges ?? [])
        : null;
      const baseRequest = {
        kind: 'build' as const,
        requestId,
        options: options.topology ?? {},
        includePassive: options.includePassive ?? false,
        passiveEdgeBudget: options.passiveEdgeBudget ?? null,
        passiveTuning: options.passiveTuning ?? null,
        preferredEdges,
      };
      const fullRequest = (): NeighborGraphWorkerRequest => ({
        ...baseRequest,
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
          cells: null,
          cellsDelta: {
            baseGeneration: lastAppliedGeneration,
            upserts,
            removedIds: Float64Array.from(journal.removedIds),
          },
        };
      };
      const request = deltaRequest() ?? fullRequest();

      return new Promise<NeighborGraphBuildResult | null>((resolve, reject) => {
        active = { requestId, resolve, reject, fallback };
        worker!.onmessage = (event: MessageEvent<NeighborGraphWorkerResponse>) => {
          const response = event.data;
          if (response.requestId !== requestId || active?.requestId !== requestId) {
            return;
          }
          if (response.kind === 'failed') {
            noteWorkerFallback();
            fallbackActive(requestId);
            return;
          }
          if (response.kind === 'stale') {
            // Ordinary after a superseded/dropped build: re-send the full
            // pack under the same requestId (full requests never go stale).
            try {
              worker!.postMessage(fullRequest(), []);
            } catch {
              noteWorkerFallback();
              fallbackActive(requestId);
            }
            return;
          }
          try {
            const reuse = options.reuseFrom?.() ?? null;
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
            worker!.onmessage = null;
            worker!.onerror = null;
            worker!.onmessageerror = null;
            resolve(result);
          } catch {
            noteWorkerFallback();
            fallbackActive(requestId);
          }
        };
        worker!.onerror = () => {
          noteWorkerFallback();
          fallbackActive(requestId);
        };
        worker!.onmessageerror = () => {
          noteWorkerFallback();
          fallbackActive(requestId);
        };
        const transfer: Transferable[] = [];
        if (request.cells) transfer.push(request.cells.buffer);
        if (request.cellsDelta) {
          transfer.push(
            request.cellsDelta.upserts.buffer,
            request.cellsDelta.removedIds.buffer,
          );
        }
        if (preferredEdges) transfer.push(preferredEdges.buffer);
        try {
          worker!.postMessage(request, transfer);
        } catch {
          noteWorkerFallback();
          fallbackActive(requestId);
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
