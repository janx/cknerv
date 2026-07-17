import { describe, expect, it } from 'vitest';
import {
  MEMORY_SOURCE_LABEL_GAP_PX,
  chooseConsensusMemoryLabelSide,
  layoutConsensusMemorySourceLabels,
  placeConsensusMemoryLabel,
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

  it('keeps the semantic side until the viewport edge requires a flip', () => {
    expect(chooseConsensusMemoryLabelSide({
      x: 130,
      y: 100,
      width: 80,
      height: 30,
      preferredSide: 'right',
      viewportWidth: 300,
    })).toBe('right');
    expect(chooseConsensusMemoryLabelSide({
      x: 280,
      y: 100,
      width: 80,
      height: 30,
      preferredSide: 'right',
      viewportWidth: 300,
    })).toBe('left');
  });

  it('expands away from a measured HUD panel but ignores distant panels', () => {
    const base = {
      x: 150,
      y: 100,
      width: 100,
      height: 30,
      preferredSide: 'right' as const,
      viewportWidth: 400,
    };
    expect(chooseConsensusMemoryLabelSide({
      ...base,
      obstacles: [{ left: 160, top: 80, right: 280, bottom: 120 }],
    })).toBe('left');
    expect(chooseConsensusMemoryLabelSide({
      ...base,
      obstacles: [{ left: 160, top: 200, right: 280, bottom: 240 }],
    })).toBe('right');
  });

  it('uses the nearest clear vertical lane when HUD blocks both sides', () => {
    const placement = placeConsensusMemoryLabel({
      x: 200,
      y: 100,
      width: 100,
      height: 20,
      preferredSide: 'left',
      viewportWidth: 400,
      viewportHeight: 300,
      desiredShiftPx: -20,
      obstacles: [{ left: 0, top: 60, right: 400, bottom: 95 }],
    });

    expect(placement.side).toBe('left');
    expect(placement.shift).toBe(11);
    expect(placement.rect.top).toBe(101);
  });

  it('prefers a side flip over a needless leader bend', () => {
    const placement = placeConsensusMemoryLabel({
      x: 200,
      y: 100,
      width: 100,
      height: 20,
      preferredSide: 'right',
      viewportWidth: 400,
      viewportHeight: 300,
      desiredShiftPx: 0,
      obstacles: [{ left: 210, top: 80, right: 320, bottom: 120 }],
    });

    expect(placement.side).toBe('left');
    expect(placement.shift).toBe(0);
  });

  it('accounts for the copy gap between the Cell glyph and label', () => {
    const placement = placeConsensusMemoryLabel({
      x: 130,
      y: 100,
      width: 80,
      height: 20,
      preferredSide: 'right',
      viewportWidth: 200,
      viewportHeight: 200,
      desiredShiftPx: 0,
      horizontalOffsetPx: 24,
    });

    expect(placement.side).toBe('left');
    expect(placement.rect).toEqual({ left: 26, top: 90, right: 106, bottom: 110 });
  });
});
