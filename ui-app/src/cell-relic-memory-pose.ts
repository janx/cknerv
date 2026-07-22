import type { ConsensusMemoryTargetResponse } from '@cknerv/ui';

export type CellRelicMemoryPose =
  | 'rest'
  | 'reading'
  | 'locked'
  | 'releasing';

const MEMORY_POSES = new Set<CellRelicMemoryPose>([
  'rest',
  'reading',
  'locked',
  'releasing',
]);

/** Optional production-memory pose for the real-Cell visual review matrix. */
export function resolveCellRelicMemoryPose(
  search: string,
): CellRelicMemoryPose {
  const candidate = new URLSearchParams(search).get('memory');
  return candidate && MEMORY_POSES.has(candidate as CellRelicMemoryPose)
    ? (candidate as CellRelicMemoryPose)
    : 'rest';
}

/**
 * Static frame-level response used only by the calibration route. Geometry,
 * materials and field mappings remain the production A renderer.
 */
export function cellRelicMemoryResponse(
  cellId: number,
  pose: CellRelicMemoryPose,
): ConsensusMemoryTargetResponse | null {
  if (pose === 'rest') return null;
  const locked = pose !== 'reading';
  return {
    targetCellId: cellId,
    response: {
      role: 'target',
      strength: pose === 'releasing' ? 0.25 : 1,
      phase: locked ? 0.88 : 0.32,
      convergence: locked ? 1 : 0,
    },
  };
}
