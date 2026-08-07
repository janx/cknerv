import { describe, expect, it } from 'vitest';
import {
  markCellFlashDirty,
  mergeCellFlashRanges,
  writeActiveCellFlashIndices,
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

  it('indexes only slots inside the exact half-open flash interval', () => {
    const indices = new Uint16Array(8);
    const write = writeActiveCellFlashIndices(
      new Float32Array([9.5, 9.75, 10, 10.1, -1e9]),
      5,
      10,
      0.5,
      indices,
      0,
    );

    // Age 0.5 is complete; age 0 and the two younger positive ages are live.
    expect(write).toEqual({ count: 2, changed: true });
    expect([...indices.slice(0, write.count)]).toEqual([1, 2]);
  });

  it('reports index identity changes independently from draw-count changes', () => {
    const indices = new Uint16Array([1, 2, 0, 0]);

    expect(writeActiveCellFlashIndices(
      new Float32Array([-1e9, 9.8, 9.7]),
      3,
      10,
      0.5,
      indices,
      2,
    )).toEqual({ count: 2, changed: false });

    expect(writeActiveCellFlashIndices(
      new Float32Array([9.8, -1e9, 9.7]),
      3,
      10,
      0.5,
      indices,
      2,
    )).toEqual({ count: 2, changed: true });
    expect([...indices.slice(0, 2)]).toEqual([0, 2]);
  });
});
