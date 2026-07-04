import { describe, expect, it } from 'vitest';
import { diffCells, snapshotCells } from '../../src/nerve/cellsDelta';

const m = (entries: [number, number | null][]) =>
  new Map(entries.map(([id, d]) => [id, { death_at_ms: d }]));

describe('diffCells', () => {
  it('detects births (new ids)', () => {
    expect(diffCells(m([[1, null]]), m([[1, null], [2, null]])).born).toEqual([2]);
  });
  it('detects real death (death_at_ms null -> set)', () => {
    const d = diffCells(m([[1, null], [2, null]]), m([[1, null], [2, 500]]));
    expect(d.died).toEqual([2]);
    expect(d.evicted).toEqual([]);
  });
  it('detects gc eviction of a LIVE cell (removed while death_at_ms was null)', () => {
    const d = diffCells(m([[1, null], [2, null]]), m([[1, null]]));
    expect(d.evicted).toEqual([2]);
    expect(d.died).toEqual([]);
  });
  it('is a no-op when an already-dead cell is gc\'d (its edges retracted at death)', () => {
    const d = diffCells(m([[1, null], [2, 500]]), m([[1, null]]));
    expect(d.evicted).toEqual([]);
    expect(d.died).toEqual([]);
  });
  it('snapshotCells captures death_at_ms only', () => {
    const s = snapshotCells(m([[1, null], [2, 7]]));
    expect(s.get(2)).toEqual({ death_at_ms: 7 });
  });
});
