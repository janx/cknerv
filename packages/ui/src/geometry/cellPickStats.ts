// Dev instrumentation for the Cell picker: how often its screen-space index
// is rebuilt, and what tripped each rebuild. Pure module singleton — the
// `fabricStats` / `pulseStats` idiom: mutated directly by the raycast, read
// by a snapshot, reset by a probe or a test, always on (a few integer
// increments per raycast, which is per pointer move). The WINDOW hook that
// surfaces it lives in ui-app, so the library stays free of `window` coupling.
//
// ⭐ IT EXISTS BECAUSE THE PICKER'S COST WAS ONLY EVER INFERRED. The index
// re-projects the whole drawn field — 12,000 cells — on a rebuild, and the
// gates that decide when (field version, size epoch, draw count, detail
// epoch, viewport, galaxy spin, camera drift, projection, a pointerdown's
// precise snapshot) were each argued from source. Reset, sweep the pointer
// or drag the camera, and read: `rebuilds` against `raycasts` is the reuse
// rate, `suspendedSkips` is what the motion gate declined, and the reasons
// say which gate is firing. A reason is counted for every gate that was open
// at the rebuild, so Σ reasons ≥ rebuilds.

export type CellPickRebuildReason =
  | 'pointerdown'
  | 'fieldVersion'
  | 'sizeEpoch'
  | 'count'
  | 'detailEpoch'
  | 'viewport'
  | 'spin'
  | 'camera'
  | 'projection';

export const CELL_PICK_REBUILD_REASONS: readonly CellPickRebuildReason[] = [
  'pointerdown',
  'fieldVersion',
  'sizeEpoch',
  'count',
  'detailEpoch',
  'viewport',
  'spin',
  'camera',
  'projection',
];

export interface CellPickStatsSnapshot {
  /** Every raycast the picker was asked for, answered or declined. */
  raycasts: number;
  /** Hover probes dropped while the camera was moving (presses and clicks
   *  still answer, from a precise snapshot): the raycasts that never passed
   *  the motion gate, which is the first thing a raycast can return on. */
  suspendedSkips: number;
  /** Raycasts answered off the index as it stood. */
  reuses: number;
  /** Whole-field re-projections. */
  rebuilds: number;
  /** Which gate was open at each rebuild; several can be at once. */
  rebuildReasons: Record<CellPickRebuildReason, number>;
  /** The two focus pads re-resolved (a rebuild, or a hover/selection move). */
  padRefreshes: number;
  /** Raycasts that produced a hit. */
  hits: number;
}

function zeroReasons(): Record<CellPickRebuildReason, number> {
  return {
    pointerdown: 0,
    fieldVersion: 0,
    sizeEpoch: 0,
    count: 0,
    detailEpoch: 0,
    viewport: 0,
    spin: 0,
    camera: 0,
    projection: 0,
  };
}

interface CellPickStatsState extends Omit<CellPickStatsSnapshot, 'suspendedSkips'> {
  /** Raycasts that passed the motion gate; the skips are the rest. */
  answered: number;
  observeRaycast(): void;
  observeAnswered(): void;
  observeReuse(): void;
  observeRebuild(): void;
  observeRebuildReason(reason: CellPickRebuildReason): void;
  observePadRefresh(): void;
  observeHit(): void;
  snapshot(): CellPickStatsSnapshot;
  reset(): void;
}

export const cellPickStats: CellPickStatsState = {
  raycasts: 0,
  answered: 0,
  reuses: 0,
  rebuilds: 0,
  rebuildReasons: zeroReasons(),
  padRefreshes: 0,
  hits: 0,

  observeRaycast() {
    this.raycasts += 1;
  },
  observeAnswered() {
    this.answered += 1;
  },
  observeReuse() {
    this.reuses += 1;
  },
  observeRebuild() {
    this.rebuilds += 1;
  },
  observeRebuildReason(reason) {
    this.rebuildReasons[reason] += 1;
  },
  observePadRefresh() {
    this.padRefreshes += 1;
  },
  observeHit() {
    this.hits += 1;
  },

  snapshot() {
    return {
      raycasts: this.raycasts,
      suspendedSkips: this.raycasts - this.answered,
      reuses: this.reuses,
      rebuilds: this.rebuilds,
      rebuildReasons: { ...this.rebuildReasons },
      padRefreshes: this.padRefreshes,
      hits: this.hits,
    };
  },

  reset() {
    this.raycasts = 0;
    this.answered = 0;
    this.reuses = 0;
    this.rebuilds = 0;
    this.rebuildReasons = zeroReasons();
    this.padRefreshes = 0;
    this.hits = 0;
  },
};

export function snapshotCellPickStats(): CellPickStatsSnapshot {
  return cellPickStats.snapshot();
}
export function resetCellPickStats(): void {
  cellPickStats.reset();
}
