// The halo's placement pass, off the main thread.
//
// Walking 105K points of filament is roughly 150 ms of CPU — 1.5 evaluations
// of a twelve-octave field per placed point, against the twenty an independent
// draw needed. That is still a long task by any definition, and it would
// arrive at exactly the moment the page is still assembling itself. Spreading
// it across frames instead would mean either jank or seconds of absence, so it
// runs here and both buffers are transferred when it is finished.
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
  /** Filament segments as index pairs into `positions`, `2 * segmentCount`
   *  valid entries. Every index addresses a point in the same buffer — the
   *  fibres reach no addressable Cell — and no pair bridges a point the
   *  complement rejected. */
  segments: Uint32Array<ArrayBuffer>;
  /** The taper weight of each point, `count` valid entries. Size, brightness
   *  and tint ride it; the fibres interpolate it between their endpoints. */
  weights: Float32Array<ArrayBuffer>;
  count: number;
  segmentCount: number;
  streamlines: number;
  work: number;
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
      segments: state.segments,
      weights: state.weights,
      count: state.count,
      segmentCount: state.segmentCount,
      streamlines: state.streamlines,
      work: state.work,
    },
    [state.positions.buffer, state.segments.buffer, state.weights.buffer],
  );
};

export {};
