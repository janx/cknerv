// The halo's placement pass, off the main thread.
//
// Placing 260K points is roughly a second of CPU: five million candidates
// against a twelve-octave field, of which one in twenty survives. That is a
// long task by any definition, and it would arrive at exactly the moment the
// page is still assembling itself. Spreading it across frames instead would
// mean either a second of jank or ten seconds of absence, so it runs here and
// the buffer is transferred when it is finished.
//
// The pass reads nothing. It has no input beyond a point count and a seed,
// because the positional law is a pure function of position with no time, no
// id, and no universe seed — the same picture on every reload, in every
// universe. There is no message back except the finished buffer.

import {
  placePopulationField,
  POPULATION_FIELD_POINTS,
  POPULATION_FIELD_SEED,
} from './populationFieldPlacement';

export interface PopulationFieldWorkerRequest {
  kind: 'place';
  points: number;
  seed: number;
}

export interface PopulationFieldWorkerResponse {
  kind: 'placed';
  /** World positions, `3 * count` valid entries. Transferred, not copied. */
  positions: Float32Array<ArrayBuffer>;
  count: number;
  tries: number;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<PopulationFieldWorkerRequest>) => void) | null;
  postMessage(
    message: PopulationFieldWorkerResponse,
    transfer: Transferable[],
  ): void;
}

const workerScope = globalThis as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request?.kind !== 'place') return;
  const state = placePopulationField(
    Number.isFinite(request.points) ? request.points : POPULATION_FIELD_POINTS,
    Number.isFinite(request.seed) ? request.seed : POPULATION_FIELD_SEED,
  );
  workerScope.postMessage(
    {
      kind: 'placed',
      positions: state.positions,
      count: state.count,
      tries: state.tries,
    },
    [state.positions.buffer],
  );
};

export {};
