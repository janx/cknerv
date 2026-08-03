import { describe, expect, it } from 'vitest';
import {
  diffAndSnapshotCells,
  diffCells,
  snapshotCells,
} from '../../src/nerve/cellsDelta';

const m = (entries: [number, number | null][]) =>
  new Map(entries.map(([id, d]) => [id, { death_at_ms: d }]));
const s = (entries: [number, number | null][]) => snapshotCells(m(entries));

describe('diffCells', () => {
  it('detects births (new ids)', () => {
    expect(diffCells(s([[1, null]]), m([[1, null], [2, null]])).born).toEqual([2]);
  });
  it('detects real death (death_at_ms null -> set)', () => {
    const d = diffCells(s([[1, null], [2, null]]), m([[1, null], [2, 500]]));
    expect(d.died).toEqual([2]);
    expect(d.evicted).toEqual([]);
  });
  it('detects gc eviction of a LIVE cell (removed while death_at_ms was null)', () => {
    const d = diffCells(s([[1, null], [2, null]]), m([[1, null]]));
    expect(d.evicted).toEqual([2]);
    expect(d.died).toEqual([]);
  });
  it('is a no-op when an already-dead cell is gc\'d (its edges retracted at death)', () => {
    const d = diffCells(s([[1, null], [2, 500]]), m([[1, null]]));
    expect(d.evicted).toEqual([]);
    expect(d.died).toEqual([]);
  });
  it('snapshotCells captures death_at_ms only', () => {
    const s = snapshotCells(m([[1, null], [2, 7]]));
    expect(s.get(2)).toBe(7);
  });
  it('captures the next snapshot while diffing in one pass', () => {
    const result = diffAndSnapshotCells(
      snapshotCells(m([[1, null], [2, null]])),
      m([[2, 7], [3, null]]),
    );
    expect(result.diff).toEqual({ born: [3], died: [2], evicted: [1] });
    expect([...result.snapshot]).toEqual([[2, 7], [3, null]]);
  });
});
