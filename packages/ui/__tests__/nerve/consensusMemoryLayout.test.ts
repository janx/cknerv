import { describe, expect, it } from 'vitest';
import {
  MEMORY_SOURCE_LABEL_GAP_PX,
  layoutConsensusMemorySourceLabels,
} from '../../src/nerve/consensusMemoryLayout';

describe('layoutConsensusMemorySourceLabels', () => {
  it('leaves isolated labels attached to their Cell anchors', () => {
    const shifts = layoutConsensusMemorySourceLabels([
      { id: 1, y: 10 },
      { id: 2, y: 100 },
    ]);

    expect(shifts.get(1)).toBe(0);
    expect(shifts.get(2)).toBe(0);
  });

  it('spreads colliding labels symmetrically in actual screen space', () => {
    const anchors = [
      { id: 1, y: 100 },
      { id: 2, y: 108 },
    ];
    const shifts = layoutConsensusMemorySourceLabels(anchors);
    const firstY = anchors[0].y + (shifts.get(1) ?? 0);
    const secondY = anchors[1].y + (shifts.get(2) ?? 0);

    expect(secondY - firstY).toBe(MEMORY_SOURCE_LABEL_GAP_PX);
    expect(shifts.get(1)).toBeCloseTo(-(shifts.get(2) ?? 0));
  });

  it('forms three bounded witness lanes without moving the middle anchor', () => {
    const shifts = layoutConsensusMemorySourceLabels([
      { id: 1, y: 100 },
      { id: 2, y: 100 },
      { id: 3, y: 100 },
    ]);

    expect(shifts.get(1)).toBe(-MEMORY_SOURCE_LABEL_GAP_PX);
    expect(shifts.get(2)).toBe(0);
    expect(shifts.get(3)).toBe(MEMORY_SOURCE_LABEL_GAP_PX);
  });

  it('does not move close labels whose outward screen rectangles do not overlap', () => {
    const shifts = layoutConsensusMemorySourceLabels([
      { id: 1, x: 300, y: 100, width: 180, side: 'left' },
      { id: 2, x: 700, y: 108, width: 180, side: 'right' },
    ]);

    expect(shifts.get(1)).toBe(0);
    expect(shifts.get(2)).toBe(0);
  });
});
