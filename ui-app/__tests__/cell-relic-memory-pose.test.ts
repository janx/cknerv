import { describe, expect, it } from 'vitest';
import {
  cellRelicMemoryResponse,
  resolveCellRelicMemoryPose,
} from '../src/cell-relic-memory-pose';

describe('cell relic memory calibration pose', () => {
  it('accepts only the explicit review poses', () => {
    expect(resolveCellRelicMemoryPose('?memory=reading')).toBe('reading');
    expect(resolveCellRelicMemoryPose('?memory=locked')).toBe('locked');
    expect(resolveCellRelicMemoryPose('?memory=releasing')).toBe('releasing');
    expect(resolveCellRelicMemoryPose('?memory=unknown')).toBe('rest');
    expect(resolveCellRelicMemoryPose('')).toBe('rest');
  });

  it('projects static production responses without creating a write event', () => {
    expect(cellRelicMemoryResponse(42, 'rest')).toBeNull();
    expect(cellRelicMemoryResponse(42, 'reading')).toMatchObject({
      targetCellId: 42,
      response: { role: 'target', strength: 1, convergence: 0 },
    });
    expect(cellRelicMemoryResponse(42, 'locked')).toMatchObject({
      targetCellId: 42,
      response: { role: 'target', strength: 1, convergence: 1 },
    });
    expect(cellRelicMemoryResponse(42, 'releasing')).toMatchObject({
      targetCellId: 42,
      response: { role: 'target', strength: 0.25, convergence: 1 },
    });
  });
});
