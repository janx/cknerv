import {
  createNeighborGraphWorkerSession,
  neighborGraphResponseTransferList,
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
    if (response.kind !== 'built') {
      workerScope.postMessage(response, []);
      return;
    }
    workerScope.postMessage(
      response,
      neighborGraphResponseTransferList(response),
    );
  } catch (error) {
    workerScope.postMessage({
      kind: 'failed',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    }, []);
  }
};

export {};
