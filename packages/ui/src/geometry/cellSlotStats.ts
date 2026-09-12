// Dev instrumentation for the Cell slot assignment: which of its two walks a
// sync took, and how often the published snapshot was copied.
//
// Pure module singleton — the `cellPickStats` / `fabricStats` idiom: mutated
// directly by the sync, read by a snapshot, reset by a probe or a test, always
// on (one integer increment per sync). The WINDOW hook that surfaces it lives
// in ui-app, so the library stays free of `window` coupling.
//
// ⭐ IT EXISTS BECAUSE THE TWO PATHS ARE INDISTINGUISHABLE FROM OUTSIDE. The
// journal walk touches only the ids the render cursor named (200 `slotOf` gets
// on a births-only block); the canonical walk reads every drawn slot (12,400
// at a 12K stage, twice on any block with an exit — once on the journal frame
// and once when the exit hold is reaped 0.9 s later). They publish the same
// `CellSlotSync`, they dirty the same slots, they upload the same bytes, and
// the release build mangles both names — so which one ran could only ever be
// inferred from a wall clock. `canonical ≈ 2 × blocks with an exit` is the
// reading this counter was added for.
//
// `publishedCopies` is the other half of a sync's cost: the immutable snapshot
// is a whole-array copy, and it is republished exactly when a slot or the
// count changed — a pure reorder must show up here as zero.

export interface CellSlotStatsSnapshot {
  /** Syncs that walked the whole drawn list. */
  canonical: number;
  /** Syncs answered from the render journal. */
  incremental: number;
  /** Whole-array republishes of the immutable slot snapshot. */
  publishedCopies: number;
}

interface CellSlotStatsState extends CellSlotStatsSnapshot {
  observeCanonicalSync(): void;
  observeIncrementalSync(): void;
  observePublishedCopy(): void;
  snapshot(): CellSlotStatsSnapshot;
  reset(): void;
}

export const cellSlotStats: CellSlotStatsState = {
  canonical: 0,
  incremental: 0,
  publishedCopies: 0,

  observeCanonicalSync() {
    this.canonical += 1;
  },
  observeIncrementalSync() {
    this.incremental += 1;
  },
  observePublishedCopy() {
    this.publishedCopies += 1;
  },

  snapshot() {
    return {
      canonical: this.canonical,
      incremental: this.incremental,
      publishedCopies: this.publishedCopies,
    };
  },

  reset() {
    this.canonical = 0;
    this.incremental = 0;
    this.publishedCopies = 0;
  },
};

export function snapshotCellSlotStats(): CellSlotStatsSnapshot {
  return cellSlotStats.snapshot();
}
export function resetCellSlotStats(): void {
  cellSlotStats.reset();
}
