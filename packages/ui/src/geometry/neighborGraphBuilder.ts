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
  deserializeNeighborGraph,
  packPreferredEdges,
  packTopologyCells,
  type NeighborGraphWorkerRequest,
  type NeighborGraphWorkerResponse,
} from './neighborGraphWorkerProtocol';

export const DEFAULT_TOPOLOGY_WORKER_MIN_CELLS = 512;

export interface NeighborGraphBuildOptions {
  topology?: NeighborGraphOptions;
  includePassive?: boolean;
  preferredEdges?: readonly NeighborEdge[];
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
        return Promise.resolve().then(fallback);
      }

      try {
        worker ??= workerFactory();
      } catch {
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
            fallbackActive(requestId);
            return;
          }
          try {
            const result: NeighborGraphBuildResult = {
              graph: deserializeNeighborGraph(response.graph),
              passiveGraph: response.passiveGraph
                ? deserializeNeighborGraph(response.passiveGraph)
                : null,
            };
            active = null;
            worker!.onmessage = null;
            worker!.onerror = null;
            worker!.onmessageerror = null;
            resolve(result);
          } catch {
            fallbackActive(requestId);
          }
        };
        worker!.onerror = () => fallbackActive(requestId);
        worker!.onmessageerror = () => fallbackActive(requestId);
        const transfer: Transferable[] = [packedCells.buffer];
        if (preferredEdges) transfer.push(preferredEdges.buffer);
        try {
          worker!.postMessage(request, transfer);
        } catch {
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
