// The halo placement request, and what happens when it does not come back.
//
// `CellPopulationField` spawns the worker and owns the geometries; this owns
// the conversation. It lives outside the component for the ordinary reason —
// an R3F layer is not testable in jsdom, so the logic that has to be tested
// moves to a module that is.
//
// WHY A FALLBACK AT ALL. The placement store is the single source both the
// halo and the bridge nerve tier read (`CellBridgeNerves` anchors its far ends
// exclusively there). A worker that fails to spawn, throws while walking, or
// returns a reply this build cannot deserialize used to leave the store null
// for the life of the tab, and BOTH layers simply never appeared — no error,
// no warning, nothing to notice. The pass is pure in (points, seed) and the
// main thread can run it; it costs one long task, which is a far better
// outcome than two layers silently missing. Same shape as
// `neighborGraphBuilder`'s worker path: warn once, name the loss, build
// synchronously.

import { selectPopulationBackbone } from './populationBackbone';
import { placePopulationField } from './populationFieldPlacement';
import type { PopulationPlacementSnapshot } from './populationPlacementStore';
// Type-only, so the worker module's body never lands in the main bundle — it
// is reached exclusively through the `new URL(...)` the component holds.
import type {
  PopulationFieldWorkerRequest,
  PopulationFieldWorkerResponse,
} from './populationField.worker';

/** Failure-path placements, counted so a session can be asked whether it paid
 *  for one. Diagnostic only — nothing renders off this. */
export const populationFieldSessionStats = {
  /** Worker spawn / error / unreadable-reply failures → main-thread pass. */
  workerFallbacks: 0,
};

let workerFallbackWarned = false;

function noteWorkerFallback(reason: unknown): void {
  populationFieldSessionStats.workerFallbacks += 1;
  if (!workerFallbackWarned) {
    workerFallbackWarned = true;
    // The reason rides the warning: this fallback costs a ~150 ms long task
    // on the main thread, so "which path failed" has to be answerable from a
    // console alone.
    console.warn(
      'populationField: worker path failed; placing the halo synchronously on '
      + 'the main thread (the halo and the bridge nerve tier both read this '
      + 'placement, and would otherwise never appear).',
      reason,
    );
  }
}

/** Test seam. The warn-once latch is module state by design — production
 *  wants one line per session, tests want each case to be able to see it. */
export function resetPopulationFieldSessionWarning(): void {
  workerFallbackWarned = false;
}

/** The worker's own body, run here. Identical composition — the walk, then
 *  the backbone partition over its finished buffers — because the renderer
 *  consumes one shape and must not learn which thread produced it. */
export function placePopulationFieldSynchronously(
  points: number,
  seed: number,
): PopulationPlacementSnapshot {
  const state = placePopulationField(points, seed);
  const partition = selectPopulationBackbone({
    positions: state.positions,
    segments: state.segments,
    count: state.count,
    segmentCount: state.segmentCount,
  });
  return {
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
  };
}

export interface PopulationFieldSession {
  /** The mount is going away. Stops any delivery still to come; the caller
   *  still owns terminating the worker it created. */
  cancel(): void;
}

export interface PopulationFieldSessionOptions {
  worker: Worker;
  request: PopulationFieldWorkerRequest;
  /** Called exactly once with the finished placement, from whichever thread
   *  produced it. The caller publishes it and builds its geometries here. */
  onPlaced: (placement: PopulationPlacementSnapshot) => void;
  /** Injectable for tests; production uses the real pass. */
  placeSynchronously?: (points: number, seed: number) => PopulationPlacementSnapshot;
}

/**
 * Wire a spawned worker to one placement delivery, with a main-thread fallback
 * on every path that could otherwise deliver nothing.
 *
 * DELIVERY IS LATCHED. `onPlaced` fires at most once per session, so a worker
 * that answers late — after its own `onerror` already sent us down the
 * synchronous path — is ignored rather than publishing a second placement over
 * the buffers two layers are already drawing.
 */
export function beginPopulationFieldPlacement(
  options: PopulationFieldSessionOptions,
): PopulationFieldSession {
  const { worker, request, onPlaced } = options;
  const placeSynchronously = options.placeSynchronously
    ?? placePopulationFieldSynchronously;
  let cancelled = false;
  let delivered = false;

  const deliver = (placement: PopulationPlacementSnapshot): void => {
    if (cancelled || delivered) return;
    delivered = true;
    onPlaced(placement);
  };

  const fallBackToMainThread = (reason: unknown): void => {
    if (cancelled || delivered) return;
    noteWorkerFallback(reason);
    worker.terminate();
    deliver(placeSynchronously(request.points, request.seed));
  };

  worker.onmessage = (event: MessageEvent<PopulationFieldWorkerResponse>) => {
    const response = event.data;
    worker.terminate();
    if (response?.kind !== 'placed') {
      // A reply we cannot read is the same loss as no reply at all.
      fallBackToMainThread(response);
      return;
    }
    deliver({
      positions: response.positions,
      segments: response.segments,
      backboneSegments: response.backboneSegments,
      backboneSegmentCount: response.backboneSegmentCount,
      residualSegments: response.residualSegments,
      residualSegmentCount: response.residualSegmentCount,
      backboneComponents: response.backboneComponents,
      weights: response.weights,
      count: response.count,
      segmentCount: response.segmentCount,
      streamlines: response.streamlines,
      work: response.work,
    });
  };
  worker.onerror = (event) => { fallBackToMainThread(event); };
  worker.onmessageerror = (event) => { fallBackToMainThread(event); };

  try {
    worker.postMessage(request);
  } catch (error) {
    // A structured-clone or detached-buffer throw is a failure like any other.
    fallBackToMainThread(error);
  }

  return {
    cancel(): void {
      cancelled = true;
      worker.terminate();
    },
  };
}
