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
  deserializeNeighborGraphInto,
  packPreferredEdges,
  packTopologyCells,
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
  preferredEdges?: readonly NeighborEdge[];
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
        preferredEdges: options.preferredEdges,
      })
      : null,
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

  const terminateWorker = () => {
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = null;
  };

  const cancel = () => {
    if (active) {
      active.resolve(null);
      active = null;
    }
    terminateWorker();
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
      const packedCells = packTopologyCells(cells);
      const liveCellCount = packedCells.length / PACKED_TOPOLOGY_CELL_STRIDE;
      const canUseWorker = (
        liveCellCount >= minWorkerCells
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
      const request: NeighborGraphWorkerRequest = {
        kind: 'build',
        requestId,
        cells: packedCells,
        options: options.topology ?? {},
        includePassive: options.includePassive ?? false,
        passiveEdgeBudget: options.passiveEdgeBudget ?? null,
        preferredEdges,
      };

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
          try {
            const reuse = options.reuseFrom?.() ?? null;
            const result: NeighborGraphBuildResult = {
              graph: deserializeNeighborGraphInto(
                reuse?.graph ?? null,
                response.graph,
              ),
              passiveGraph: response.passiveGraph
                ? deserializeNeighborGraphInto(
                  reuse?.passiveGraph ?? null,
                  response.passiveGraph,
                )
                : null,
            };
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
        const transfer: Transferable[] = [packedCells.buffer];
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
