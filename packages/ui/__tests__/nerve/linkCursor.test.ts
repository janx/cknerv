import { describe, expect, it } from 'vitest';
import type { CellLink } from '@cknerv/types';
import { advanceLinkCursor } from '../../src/nerve/linkCursor';

const link = (seq: number): CellLink => ({
  seq,
  tx_hash: `0x${seq}`,
  block: 1,
  from_ids: [],
  to_ids: [],
  endpoint_anchors: [],
  parents: [],
  tag: null,
  at_ms: 1000 + seq,
});

describe('advanceLinkCursor', () => {
  it('fires links with seq above the cursor and advances to the max seq', () => {
    const { toFire, nextSeq } = advanceLinkCursor([link(1), link(2), link(3)], 1, false);
    expect(toFire.map((l) => l.seq)).toEqual([2, 3]);
    expect(nextSeq).toBe(3);
  });

  it('fires nothing already at or below the cursor', () => {
    const { toFire, nextSeq } = advanceLinkCursor([link(1), link(2)], 2, false);
    expect(toFire).toEqual([]);
    expect(nextSeq).toBe(2);
  });

  it('consumes seqs WITHOUT firing while backfilling', () => {
    const { toFire, nextSeq } = advanceLinkCursor([link(1), link(2), link(3)], 0, true);
    expect(toFire).toEqual([]); // no nerve pulses during catch-up/boot
    expect(nextSeq).toBe(3); // cursor still advances → no backlog replay later
  });

  it('fires new links and reports suppressed=0 when not backfilling', () => {
    const r = advanceLinkCursor([link(1), link(2)], 0, false);
    expect(r.toFire.map((l) => l.seq)).toEqual([1, 2]);
    expect(r.nextSeq).toBe(2);
    expect(r.suppressed).toBe(0);
  });

  it('suppresses all new links and counts them while backfilling', () => {
    const r = advanceLinkCursor([link(1), link(2), link(3)], 0, true);
    expect(r.toFire).toEqual([]);
    expect(r.nextSeq).toBe(3); // cursor still advances
    expect(r.suppressed).toBe(3);
  });

  it('ignores already-consumed links (seq <= lastSeq)', () => {
    const r = advanceLinkCursor([link(1), link(2), link(3)], 2, true);
    expect(r.suppressed).toBe(1); // only seq 3 is new
    expect(r.nextSeq).toBe(3);
  });

  it('reports no eviction gap in steady state or on an empty ring', () => {
    // Ring still holds consumed links: min seq (1) <= cursor → gap 0.
    expect(advanceLinkCursor([link(1), link(2), link(3)], 2, false).evictedGap).toBe(0);
    // Contiguous fresh links: head is exactly cursor+1 → gap 0.
    expect(advanceLinkCursor([link(3), link(4)], 2, false).evictedGap).toBe(0);
    expect(advanceLinkCursor([], 7, false).evictedGap).toBe(0);
  });

  it('reports the seqs evicted before the cursor ever saw them', () => {
    // Cursor at 2, ring starts at 5: seqs 3-4 were shed by the bounded ring.
    const r = advanceLinkCursor([link(5), link(6)], 2, false);
    expect(r.evictedGap).toBe(2);
    expect(r.toFire.map((l) => l.seq)).toEqual([5, 6]);
  });

  it('computes the gap from the scanned minimum, not ring order', () => {
    expect(advanceLinkCursor([link(6), link(5)], 2, false).evictedGap).toBe(2);
  });
});
