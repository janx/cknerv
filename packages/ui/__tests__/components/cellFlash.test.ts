import { describe, expect, it } from 'vitest';
import {
  markCellFlashDirty,
  mergeCellFlashRanges,
  writeDirtyCellFlashSlots,
} from '../../src/components/cellFlash';

describe('cell flash dirty journal', () => {
  it('publishes one id to the exact journal and compatibility gate', () => {
    const dirtyRef = { current: false };
    const dirtyIdsRef = { current: new Set<number>() };

    markCellFlashDirty(42, dirtyRef, dirtyIdsRef);
    markCellFlashDirty(42, dirtyRef, dirtyIdsRef);

    expect(dirtyRef.current).toBe(true);
    expect([...dirtyIdsRef.current]).toEqual([42]);
  });

  it('writes only visible dirty slots and coalesces adjacent indices', () => {
    const flashArray = new Float32Array(8).fill(-7);
    const ranges = writeDirtyCellFlashSlots(
      new Set([20, 40, 30, 999]),
      new Map([[10, 0], [20, 1], [30, 2], [40, 5]]),
      6,
      new Map([[20, 2.5], [30, 3.5], [40, 4.5], [999, 9.5]]),
      flashArray,
    );

    expect(ranges).toEqual([
      { start: 1, count: 2 },
      { start: 5, count: 1 },
    ]);
    expect([...flashArray]).toEqual([-7, 2.5, 3.5, -7, -7, 4.5, -7, -7]);
  });

  it('writes the no-flash sentinel when a dirty map entry was removed', () => {
    const flashArray = new Float32Array([9]);

    expect(writeDirtyCellFlashSlots(
      new Set([10]),
      new Map([[10, 0]]),
      1,
      new Map(),
      flashArray,
    )).toEqual([{ start: 0, count: 1 }]);
    expect(flashArray[0]).toBe(-1e9);
  });

  it('merges overlapping static and flash-only GPU ranges', () => {
    expect(mergeCellFlashRanges(
      [{ start: 1, count: 3 }, { start: 8, count: 2 }],
      [{ start: 3, count: 3 }, { start: 7, count: 1 }],
      9,
    )).toEqual([
      { start: 1, count: 5 },
      { start: 7, count: 2 },
    ]);
  });
});
