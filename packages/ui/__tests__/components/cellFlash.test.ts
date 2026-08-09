import { describe, expect, it } from 'vitest';
import {
  collectCellFlashCandidates,
  markCellFlashDirty,
  mergeCellFlashRanges,
  writeActiveCellFlashIndices,
  writeActiveCellFlashIndicesFromCandidates,
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

describe('candidate-driven flash index', () => {
  it('collect admits open and future windows, rejects closed and sentinel slots', () => {
    const candidates = new Set<number>();
    collectCellFlashCandidates(
      [{ start: 0, count: 5 }],
      new Float32Array([9.8, 12, 9.5, -1e9, 20]),
      4, // slot 4 is beyond the visible prefix
      10,
      0.5,
      candidates,
    );
    // open (9.8) + future (12); closed-exactly-at-duration (9.5) and the
    // no-flash sentinel stay out; slot 4 is out of range.
    expect([...candidates].sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it('emits byte-identically to the full scan across a multi-step scenario', () => {
    const flashArray = new Float32Array([9.9, 12, 9.6, -1e9, 9.85, 30, 9.95, -1e9]);
    const candidates = new Set<number>();
    collectCellFlashCandidates(
      [{ start: 0, count: 8 }], flashArray, 8, 10, 0.5, candidates,
    );
    const scratch: number[] = [];
    const steps: Array<{ now: number; visible: number }> = [
      { now: 10, visible: 8 },     // slots 0,4,6 live
      { now: 10.2, visible: 8 },   // 0 expired at 10.4? no: 9.9+0.5=10.4 → still live
      { now: 10.5, visible: 8 },   // 0,4,6 expired; none live (future 12/30 parked)
      { now: 12.1, visible: 8 },   // slot 1's window open
      { now: 12.2, visible: 1 },   // draw prefix shrank below slot 1 → parked
      { now: 12.3, visible: 8 },   // grew back → emitted again
      { now: 12.6, visible: 8 },   // slot 1 expired
    ];
    let prevA = 0;
    let prevB = 0;
    for (const step of steps) {
      const a = new Uint16Array(8);
      const b = new Uint16Array(8);
      const scan = writeActiveCellFlashIndices(
        flashArray, step.visible, step.now, 0.5, a, prevA,
      );
      const event = writeActiveCellFlashIndicesFromCandidates(
        candidates, flashArray, step.visible, step.now, 0.5, b, prevB, scratch,
      );
      expect(event.count).toBe(scan.count);
      expect(event.changed).toBe(scan.changed);
      expect([...b.slice(0, event.count)]).toEqual([...a.slice(0, scan.count)]);
      prevA = scan.count;
      prevB = event.count;
    }
    // Lazy expiry retired every closed window; only the far-future slot stays.
    expect([...candidates]).toEqual([5]);
  });

  it('a dirty rewrite re-admits an expired slot', () => {
    const flashArray = new Float32Array([-1e9, -1e9]);
    const candidates = new Set<number>();
    writeDirtyCellFlashSlots(
      new Set([20]),
      new Map([[20, 1]]),
      2,
      new Map([[20, 50]]),
      flashArray,
      candidates,
    );
    expect([...candidates]).toEqual([1]);
    const indices = new Uint16Array(4);
    const write = writeActiveCellFlashIndicesFromCandidates(
      candidates, flashArray, 2, 50.1, 0.5, indices, 0, [],
    );
    expect(write).toEqual({ count: 1, changed: true });
    expect(indices[0]).toBe(1);
  });

  it('an empty candidate set is the zero-cost resting state', () => {
    const write = writeActiveCellFlashIndicesFromCandidates(
      new Set(),
      new Float32Array([9.9]),
      1,
      10,
      0.5,
      new Uint16Array(4),
      3,
      [],
    );
    expect(write).toEqual({ count: 0, changed: true }); // draw count drops 3 → 0
  });
});
