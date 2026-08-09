// The Cell statistics aggregate moved into @cknerv/cache so the reducer can
// maintain it incrementally (cache.stats, O(touched ids) per batch — read
// that instead of re-aggregating). This module re-exports the reference
// implementation and types for existing consumers of the ui barrel.
export {
  aggregateCellsStats,
  cellKindKey,
  type CellKindKey,
  type CellsStats,
} from '@cknerv/cache';
