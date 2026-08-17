import { describe, expect, it } from 'vitest';
import type { Cell, CellDelta } from '@cknerv/types';
import {
  applyCellDelta,
  applyRevisionedCellDeltas,
  emptyCellsCache,
  fromCellsSnapshot,
} from '@cknerv/cache';
import {
  consumeTopologyJournal,
  createDisplayGraphJournalFeed,
  createTopologyJournal,
  feedDisplayGraphJournal,
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
    data_bytes: 0,
    content_hash: `0x${id}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
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

describe('display-graph journal feed', () => {
  function displayDelta(overrides: Partial<{
    enter_ids: number[];
    enter_cells: Cell[];
    exit_ids: number[];
  }> = {}): CellDelta {
    return {
      type: 'display',
      enter_ids: [],
      enter_cells: [],
      exit_ids: [],
      ...overrides,
    };
  }

  function stagedCache(canonical: Cell[], members: number[], residents: Cell[] = []) {
    return fromCellsSnapshot(1, {
      cells: canonical,
      last_pulse_at_ms: 0,
      display: {
        budget: { cells: 12_000, nerve_edges: 8_000 },
        members,
        residents,
        provenance: {
          mode: 'canonical',
          source: null,
          as_of: null,
          updated_at_ms: 0,
        },
      },
    });
  }

  it('translates display enters/exits/updates into graph upserts/removes', () => {
    const feed = createDisplayGraphJournalFeed();
    let cache = stagedCache([cell(1), cell(2), cell(3)], [1, 2]);
    feedDisplayGraphJournal(feed, cache);
    // Bootstrap sight is a broken chain: the first build full-packs.
    expect(consumeTopologyJournal(feed.journal).valid).toBe(false);

    const resident = cell(700);
    cache = applyRevisionedCellDeltas(cache, [
      {
        revision: 2,
        delta: displayDelta({
          enter_ids: [3],
          enter_cells: [resident],
          exit_ids: [2],
        }),
      },
      { revision: 3, delta: { type: 'death', id: 1, at_ms: 9 } },
    ]);
    feedDisplayGraphJournal(feed, cache);
    // StrictMode-style refeed of the SAME generation is a no-op.
    feedDisplayGraphJournal(feed, cache);

    const snapshot = consumeTopologyJournal(feed.journal);
    expect(snapshot.valid).toBe(true);
    // Enters upsert (canonical 3 + resident 700); the dead staged member 1
    // removes (topology holds live positions only); the exit removes.
    expect([...snapshot.upserts.keys()].sort((a, b) => a - b)).toEqual([3, 700]);
    expect([...snapshot.removedIds].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('canonical churn of off-stage cells feeds nothing', () => {
    const feed = createDisplayGraphJournalFeed();
    let cache = stagedCache([cell(1)], [1]);
    feedDisplayGraphJournal(feed, cache);
    consumeTopologyJournal(feed.journal);

    cache = applyCellDelta(cache, { type: 'birth', cell: cell(50) });
    feedDisplayGraphJournal(feed, cache);
    const snapshot = consumeTopologyJournal(feed.journal);
    expect(snapshot.valid).toBe(true);
    expect(snapshot.upserts.size).toBe(0);
    expect([...snapshot.removedIds]).toEqual([]);
  });

  it('invalidates on a skipped generation in either token lineage', () => {
    const feed = createDisplayGraphJournalFeed();
    let cache = stagedCache([cell(1), cell(2), cell(3)], [1]);
    feedDisplayGraphJournal(feed, cache);
    consumeTopologyJournal(feed.journal);

    cache = applyCellDelta(cache, displayDelta({ enter_ids: [2] }));
    const skipped = applyCellDelta(cache, displayDelta({ enter_ids: [3] }));
    feedDisplayGraphJournal(feed, skipped);
    expect(feed.journal.valid).toBe(false);
  });

  it('falls back to the canonical cache journal without a display plane', () => {
    const feed = createDisplayGraphJournalFeed();
    let cache = applyCellDelta(emptyCellsCache(), { type: 'birth', cell: cell(1) });
    feedDisplayGraphJournal(feed, cache);
    consumeTopologyJournal(feed.journal);

    cache = applyCellDelta(cache, { type: 'birth', cell: cell(2) });
    feedDisplayGraphJournal(feed, cache);
    const snapshot = consumeTopologyJournal(feed.journal);
    expect(snapshot.valid).toBe(true);
    expect([...snapshot.upserts.keys()]).toEqual([2]);
  });

  it('a display plane appearing breaks the chain once', () => {
    const feed = createDisplayGraphJournalFeed();
    let cache = applyCellDelta(emptyCellsCache(), { type: 'birth', cell: cell(1) });
    feedDisplayGraphJournal(feed, cache);
    consumeTopologyJournal(feed.journal);

    const staffed = stagedCache([cell(1)], [1]);
    feedDisplayGraphJournal(feed, staffed);
    expect(feed.journal.valid).toBe(false);
    consumeTopologyJournal(feed.journal);

    // …and chains normally afterwards.
    const grown = applyRevisionedCellDeltas(staffed, [
      { revision: 2, delta: { type: 'birth', cell: cell(2) } },
      { revision: 2, delta: displayDelta({ enter_ids: [2] }) },
    ]);
    feedDisplayGraphJournal(feed, grown);
    const snapshot = consumeTopologyJournal(feed.journal);
    expect(snapshot.valid).toBe(true);
    expect([...snapshot.upserts.keys()]).toEqual([2]);
  });
});

describe('feed results (the eager driver licence)', () => {
  function stagedCache(canonical: Cell[], members: number[]) {
    return fromCellsSnapshot(1, {
      cells: canonical,
      last_pulse_at_ms: 0,
      display: {
        budget: { cells: 12_000, nerve_edges: 8_000 },
        members,
        residents: [],
        provenance: {
          mode: 'canonical',
          source: null,
          as_of: null,
          updated_at_ms: 0,
        },
      },
    });
  }

  it('reports the canonical journal as fresh only once per generation', () => {
    const journal = createTopologyJournal();
    let cache = applyCellDelta(emptyCellsCache(), { type: 'birth', cell: cell(1) });
    // Bootstrap sight has no predecessor to chain onto.
    expect(feedTopologyJournal(journal, cache)).toEqual({
      fresh: true,
      chained: false,
    });
    expect(feedTopologyJournal(journal, cache)).toEqual({
      fresh: false,
      chained: false,
    });
    cache = applyCellDelta(cache, { type: 'birth', cell: cell(2) });
    expect(feedTopologyJournal(journal, cache)).toEqual({
      fresh: true,
      chained: true,
    });
  });

  it('withholds the chain across a skipped canonical generation', () => {
    const journal = createTopologyJournal();
    let cache = applyCellDelta(emptyCellsCache(), { type: 'birth', cell: cell(1) });
    feedTopologyJournal(journal, cache);
    cache = applyCellDelta(cache, { type: 'birth', cell: cell(2) });
    const skipped = applyCellDelta(cache, { type: 'birth', cell: cell(3) });
    expect(feedTopologyJournal(journal, skipped)).toEqual({
      fresh: true,
      chained: false,
    });
  });

  it('names the display regime and chains across membership churn', () => {
    const feed = createDisplayGraphJournalFeed();
    let cache = stagedCache([cell(1), cell(2)], [1]);
    expect(feedDisplayGraphJournal(feed, cache)).toEqual({
      fresh: true,
      chained: false,
      regime: 'display',
    });
    cache = applyCellDelta(cache, {
      type: 'display',
      enter_ids: [2],
      enter_cells: [],
      exit_ids: [],
    });
    expect(feedDisplayGraphJournal(feed, cache)).toEqual({
      fresh: true,
      chained: true,
      regime: 'display',
    });
    // StrictMode-style refeed of the same generation must not re-apply.
    expect(feedDisplayGraphJournal(feed, cache)).toEqual({
      fresh: false,
      chained: false,
      regime: 'display',
    });
  });

  it('names the canonical regime and never chains across a regime flip', () => {
    const feed = createDisplayGraphJournalFeed();
    let cache = applyCellDelta(emptyCellsCache(), { type: 'birth', cell: cell(1) });
    expect(feedDisplayGraphJournal(feed, cache)).toEqual({
      fresh: true,
      chained: false,
      regime: 'canonical',
    });
    cache = applyCellDelta(cache, { type: 'birth', cell: cell(2) });
    expect(feedDisplayGraphJournal(feed, cache)).toEqual({
      fresh: true,
      chained: true,
      regime: 'canonical',
    });
    // A display plane appearing re-bases the graph even though the cell
    // journal itself chained — the flip alone disqualifies an in-place replay.
    const staged = stagedCache([cell(1), cell(2)], [1]);
    expect(feedDisplayGraphJournal(feed, staged)).toEqual({
      fresh: true,
      chained: false,
      regime: 'display',
    });
  });
});
