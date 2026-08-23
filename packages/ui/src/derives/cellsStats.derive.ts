// The Cell statistics aggregate moved into @cknerv/cache so the reducer can
// maintain it incrementally (cache.stats, O(touched ids) per batch — read
// that instead of re-aggregating). This module re-exports the reference
// implementation and its types so the HUD panels that read `CellsStats` can
// name the shape without reaching across the package boundary themselves.
export {
  aggregateCellsStats,
  cellKindKey,
  type CellKindKey,
  type CellsStats,
} from '@cknerv/cache';
