// The halo's placed buffers, published once and read by everyone.
//
// The placement is a 116 ms worker pass over a twelve-octave field, and it is
// pure in (point count, seed): no id, no time, no universe seed, the same
// picture on every reload. Two consumers now read it — `CellPopulationField`
// draws it, and the bridge layer anchors its far ends in it — and the one
// thing that must never happen is those two disagreeing. Running the pass
// twice would cost a second long task AND leave two buffers that are equal
// only as long as nobody edits the walk; sharing the ONE result makes the
// agreement structural.
//
// The `renderStatsStore` external-store shape, for the same reason it was
// chosen there: the producer is inside the Canvas and the consumers are
// wherever they are, `useSyncExternalStore` needs a snapshot whose identity is
// stable between publishes, and none of this belongs in React state — the
// buffers are written once and never mutated.
//
// The snapshot holds the buffers, not GPU objects. `CellPopulationField` still
// owns its two geometries and still disposes them; disposal frees the GPU
// side and leaves these arrays exactly where they are, which is what lets a
// remount adopt the placement instead of paying for it again.

import { useSyncExternalStore } from 'react';

export interface PopulationPlacementSnapshot {
  /** World positions, `3 * count` valid entries. Read-only to every
   *  consumer: the placement writes these once, in the worker, and the layers
   *  that share them assume they never move again. */
  positions: Float32Array;
  /** Filament segments as index pairs into `positions`. */
  segments: Uint32Array;
  /** Per-point taper weight. */
  weights: Float32Array;
  count: number;
  segmentCount: number;
  streamlines: number;
  work: number;
}

let snapshot: PopulationPlacementSnapshot | null = null;
const listeners = new Set<() => void>();

/** Publish the finished placement. Idempotent by construction — the pass runs
 *  once — but a second publish simply replaces the snapshot and notifies. */
export function setPopulationPlacement(
  next: PopulationPlacementSnapshot,
): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Stable reference between publishes — required by `useSyncExternalStore`,
 *  which re-renders on every identity change of the value it is handed. */
export function getPopulationPlacement(): PopulationPlacementSnapshot | null {
  return snapshot;
}

export function subscribePopulationPlacement(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test seam. Production never clears: the placement outlives every mount,
 *  which is exactly the point — a remounted `CellPopulationField` adopts it
 *  rather than spinning a second worker. */
export function resetPopulationPlacement(): void {
  snapshot = null;
  for (const listener of listeners) listener();
}

export function usePopulationPlacement(): PopulationPlacementSnapshot | null {
  return useSyncExternalStore(
    subscribePopulationPlacement,
    getPopulationPlacement,
    getPopulationPlacement,
  );
}
