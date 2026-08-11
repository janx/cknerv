import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  applyCellDelta,
  applyRevisionedCellDeltas,
  emptyCellsCache,
} from '@cknerv/cache';
import {
  consumeTopologyJournal,
  createTopologyJournal,
  feedTopologyJournal,
  invalidateTopologyJournal,
} from '../../src/geometry/topologyJournal';

function cell(id: number): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [id, 0, -id],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 0,
    data_hex: '0x',
    content_hash: `0x${id}`,
  };
}

describe('topology journal', () => {
  it('accumulates chained generations and consumes into one snapshot', () => {
    const journal = createTopologyJournal();
    let cache = applyCellDelta(emptyCellsCache(), { type: 'birth', cell: cell(1) });
    feedTopologyJournal(journal, cache);
    // First sight is a broken chain: full pack, then the chain starts.
    expect(journal.valid).toBe(false);
    expect(consumeTopologyJournal(journal).valid).toBe(false);

    cache = applyRevisionedCellDeltas(cache, [
      { revision: 2, delta: { type: 'birth', cell: cell(2) } },
      { revision: 3, delta: { type: 'death', id: 1, at_ms: 9 } },
    ]);
    feedTopologyJournal(journal, cache);
    // StrictMode-style refeed of the SAME generation is a no-op.
    feedTopologyJournal(journal, cache);
    cache = applyCellDelta(cache, { type: 'gc', ids: [1] });
    feedTopologyJournal(journal, cache);

    const snapshot = consumeTopologyJournal(journal);
    expect(snapshot.valid).toBe(true);
    expect([...snapshot.upserts.keys()]).toEqual([2]);
    expect([...snapshot.removedIds]).toEqual([1]);
    // Consumed: the chain restarts clean and valid.
    expect(journal.upserts.size).toBe(0);
    expect(journal.valid).toBe(true);
  });

  it('invalidates on a generation gap and after explicit invalidation', () => {
    const journal = createTopologyJournal();
    let cache = applyCellDelta(emptyCellsCache(), { type: 'birth', cell: cell(1) });
    feedTopologyJournal(journal, cache);
    consumeTopologyJournal(journal);

    // Skip a generation.
    cache = applyCellDelta(cache, { type: 'birth', cell: cell(2) });
    const skipped = applyCellDelta(cache, { type: 'birth', cell: cell(3) });
    feedTopologyJournal(journal, skipped);
    expect(journal.valid).toBe(false);

    consumeTopologyJournal(journal);
    expect(journal.valid).toBe(true);
    expect(invalidateTopologyJournal(journal)).toBeUndefined();
    expect(journal.valid).toBe(false);
  });
});
