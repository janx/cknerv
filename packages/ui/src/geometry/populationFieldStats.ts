// Dev instrumentation for the halo's population layer: what the placement pass
// produced and what the three draws actually submit. A REGISTRY rather than a
// counter singleton, because unlike `pulseStats` and its neighbours this
// reading is not accumulated anywhere — every value is live state held by one
// mounted component (its geometries' draw ranges, its materials' uniforms), so
// the only honest way to publish it is to publish the component's own reader
// and drop it when the component goes. The WINDOW hook that surfaces this lives
// in ui-app, so the library stays free of `window` coupling.
//
// One reader, deliberately: the layer is a singleton in the scene, and two
// registrations would mean two halos, which is a bug this module should not
// paper over. The last to register wins and unregistering is exact — a reader
// that is no longer the live one cannot clear its successor — so React's
// double-invoked effects and a remount in either order leave the registry
// holding the mounted component's reader or nothing at all.

/** The placement pass's own counts, as the layer records them when a placement
 *  lands. `null` until the worker's first delivery. */
export interface PopulationFieldPlacementCounts {
  count: number;
  segmentCount: number;
  backboneSegmentCount: number;
  residualSegmentCount: number;
  backboneComponents: number;
  streamlines: number;
  work: number;
}

/** What the layer publishes: the placement it was given, the primitives the
 *  three draws would submit, and the emission and taper they would be drawn
 *  with. It reports; it never affects a number the HUD prints. */
export interface PopulationFieldStatsSnapshot {
  placement: PopulationFieldPlacementCounts | null;
  /** The points the placement was asked for, against the `drawn` prefix. */
  requested: number;
  drawn: {
    points: number;
    segments: number;
    backbone: number;
  };
  emission: number;
  fibreEmission: number;
  backboneEmission: number;
  backboneWidthPx: number;
  taper: {
    sizeMin: number;
    sizeMax: number;
    minPointPx: number;
  };
}

export type PopulationFieldStatsReader = () => PopulationFieldStatsSnapshot;

let reader: PopulationFieldStatsReader | null = null;

/** Publish the mounted layer's reader. Returns the unregistration, which is
 *  what the effect's cleanup calls. */
export function registerPopulationFieldStatsReader(
  read: PopulationFieldStatsReader,
): () => void {
  reader = read;
  return () => {
    if (reader === read) reader = null;
  };
}

/** The layer's live reading, or `null` while no layer is mounted — which is
 *  the truthful answer for a scene that has not built its halo yet. */
export function snapshotPopulationFieldStats(): PopulationFieldStatsSnapshot | null {
  return reader === null ? null : reader();
}
