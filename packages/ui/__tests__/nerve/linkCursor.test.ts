import { describe, expect, it } from 'vitest';
import type { CellLink } from '@cknerv/types';
import { advanceLinkCursor } from '../../src/nerve/linkCursor';

const link = (seq: number): CellLink => ({
  seq,
  tx_hash: `0x${seq}`,
  block: 1,
  from_ids: [],
  to_ids: [],
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
});
