import {
  createNeighborGraphWorkerSession,
  type NeighborGraphWorkerRequest,
  type NeighborGraphWorkerResponse,
} from './neighborGraphWorkerProtocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<NeighborGraphWorkerRequest>) => void) | null;
  postMessage(message: NeighborGraphWorkerResponse, transfer: Transferable[]): void;
}

const workerScope = globalThis as unknown as WorkerScope;
const session = createNeighborGraphWorkerSession();

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.kind !== 'build') return;
  try {
    const response = session.execute(request);
    const transfer: Transferable[] = [
      response.graph.nodeIds.buffer,
      response.graph.adjacencyOffsets.buffer,
      response.graph.adjacentNodeIds.buffer,
      response.graph.edges.buffer,
    ];
    if (response.changedNodeIds) transfer.push(response.changedNodeIds.buffer);
    if (response.passiveAdded) transfer.push(response.passiveAdded.buffer);
    if (response.passiveRemoved) transfer.push(response.passiveRemoved.buffer);
    if (response.passiveGraph) {
      transfer.push(
        response.passiveGraph.nodeIds.buffer,
        response.passiveGraph.adjacencyOffsets.buffer,
        response.passiveGraph.adjacentNodeIds.buffer,
        response.passiveGraph.edges.buffer,
      );
    }
    workerScope.postMessage(response, transfer);
  } catch (error) {
    workerScope.postMessage({
      kind: 'failed',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    }, []);
  }
};

export {};
