// The halo's placement pass, off the main thread.
//
// Walking 105K points of filament is roughly 150 ms of CPU — 1.5 evaluations
// of a twelve-octave field per placed point, against the twenty an independent
// draw needed. That is still a long task by any definition, and it would
// arrive at exactly the moment the page is still assembling itself. Spreading
// it across frames instead would mean either jank or seconds of absence, so it
// runs here and every buffer is transferred when it is finished.
//
// The backbone selection runs here too, for the same reason and a smaller
// version of it: it is a union-find plus a sort over the finished segment
// buffer (14 ms), it is pure in those buffers, and it produces the split the
// renderer draws — see `populationBackbone.ts`.
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
import { selectPopulationBackbone } from './populationBackbone';

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
   *  complement rejected.
   *
   *  The UNION of the two buffers below, kept whole because the bridge layer
   *  derives filament components from the complete fibre graph and a component
   *  is not a property of either half of a draw split. */
  segments: Uint32Array<ArrayBuffer>;
  /** The promoted strands — see `populationBackbone.ts`. Drawn as capsules,
   *  and REMOVED from `residual`: a partition, not an overlay, because
   *  bounded screen accumulation would deposit an overlaid stroke twice and
   *  the class would read as brighter rather than as wider. */
  backboneSegments: Uint32Array<ArrayBuffer>;
  backboneSegmentCount: number;
  /** Everything else, still drawn as one-device-pixel lines. */
  residualSegments: Uint32Array<ArrayBuffer>;
  residualSegmentCount: number;
  /** Strands promoted, as opposed to segments — the whole-run rule means the
   *  two are different numbers and only the first is a count of nerves. */
  backboneComponents: number;
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
  // Post-placement and still off the main thread: a union-find over 96,609
  // segments plus a sort of the components measures 14 ms here, against the
  // walk's own 116-157 ms, and it would be a fresh long task on the main
  // thread at exactly the moment the page is assembling itself.
  const partition = selectPopulationBackbone({
    positions: state.positions,
    segments: state.segments,
    count: state.count,
    segmentCount: state.segmentCount,
  });
  workerScope.postMessage(
    {
      kind: 'placed',
      positions: state.positions,
      segments: state.segments,
      backboneSegments: partition.backbone,
      backboneSegmentCount: partition.backboneCount,
      residualSegments: partition.residual,
      residualSegmentCount: partition.residualCount,
      backboneComponents: partition.components,
      weights: state.weights,
      count: state.count,
      segmentCount: state.segmentCount,
      streamlines: state.streamlines,
      work: state.work,
    },
    [
      state.positions.buffer,
      state.segments.buffer,
      partition.backbone.buffer,
      partition.residual.buffer,
      state.weights.buffer,
    ],
  );
};

export {};
