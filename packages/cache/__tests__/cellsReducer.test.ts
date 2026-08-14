// Pure-reducer tests for the cell-galaxy projection cache.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  Cell,
  CellDelta,
  CellGalaxySnapshot,
  RevisionedCellDelta,
} from '@cknerv/types';

import {
  applyCellDelta,
  applyRevisionedCellDeltas,
  emptyCellsCache,
  fromCellsSnapshot,
  NO_CELL_CHANGES,
} from '../src/cellsReducer';
import { aggregateCellsStats, emptyScriptCensus } from '../src/cellsStats';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = (name: string) =>
  resolve(__dirname, '..', '..', '..', 'tests', 'fixtures', name);
const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(fixturePath(name), 'utf8')) as T;

function cell(id: number, overrides: Partial<Cell> = {}): Cell {
  return {
    id,
    born_at_ms: 1000 + id,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [0, 0, 0],
    out_point: { tx_hash: '0xabc', index: id },
    capacity: 100,
    data_hex: '0x',
    content_hash: '0x' + '00'.repeat(32),
    ...overrides,
  };
}

function linkDelta(txHash: string, block: number): CellDelta {
  return {
    type: 'link',
    tx_hash: txHash,
    block,
    from_ids: [],
    to_ids: [block],
    endpoint_anchors: [],
    parents: [],
    tag: null,
    at_ms: block * 1000,
  };
}

describe('applyCellDelta', () => {
  it('birth inserts the cell into the map', () => {
    const before = emptyCellsCache();
    const c = applyCellDelta(before, {
      type: 'birth',
      cell: cell(1),
    });
    expect(c.cells.size).toBe(1);
    expect(c.cells.get(1)?.id).toBe(1);
    expect(c.cellChanges).toMatchObject({
      reset: false,
      orderInvalidated: false,
      born: [1],
      died: [],
      evicted: [],
      updated: [1],
    });
    expect(c.cellChanges.baseToken).toBe(before.cellsToken);
    expect(c.cellsToken).not.toBe(before.cellsToken);
  });

  it('death marks the existing cell with death_at_ms', () => {
    let c = applyCellDelta(emptyCellsCache(), { type: 'birth', cell: cell(1) });
    c = applyCellDelta(c, { type: 'death', id: 1, at_ms: 5000 });
    expect(c.cells.get(1)?.death_at_ms).toBe(5000);
    expect(c.cellChanges.died).toEqual([1]);
    expect(c.cellChanges.updated).toEqual([1]);
  });

  it('death is a no-op when the cell is missing', () => {
    const before = emptyCellsCache();
    const after = applyCellDelta(before, { type: 'death', id: 1, at_ms: 5000 });
    expect(after).toBe(before);
  });

  it('tag stamps the cell', () => {
    let c = applyCellDelta(emptyCellsCache(), { type: 'birth', cell: cell(1) });
    c = applyCellDelta(c, { type: 'tag', id: 1, tag: 'dex' });
    expect(c.cells.get(1)?.tag).toBe('dex');
    expect(c.cellChanges).toMatchObject({
      reset: false,
      born: [],
      died: [],
      evicted: [],
      updated: [1],
    });
  });

  it('gc removes the listed ids', () => {
    let c = emptyCellsCache();
    c = applyCellDelta(c, { type: 'birth', cell: cell(1) });
    c = applyCellDelta(c, { type: 'birth', cell: cell(2) });
    c = applyCellDelta(c, { type: 'birth', cell: cell(3) });
    c = applyCellDelta(c, { type: 'gc', ids: [1, 3] });
    expect(c.cells.size).toBe(1);
    expect(c.cells.get(2)?.id).toBe(2);
    expect(c.cellChanges.evicted).toEqual([1, 3]);
    expect(c.cellChanges.removed).toEqual([1, 3]);
    expect(c.cellChanges.updated).toEqual([]);
    expect(c.cellChanges.orderInvalidated).toBe(true);
  });

  it('lists dead-record reaping in removed but not evicted', () => {
    let c = applyCellDelta(emptyCellsCache(), { type: 'birth', cell: cell(1) });
    c = applyCellDelta(c, { type: 'death', id: 1, at_ms: 5000 });
    c = applyCellDelta(c, { type: 'gc', ids: [1] });
    expect(c.cells.size).toBe(0);
    expect(c.cellChanges.evicted).toEqual([]);
    expect(c.cellChanges.removed).toEqual([1]);
  });

  it('invalidates insertion order when gc removes then reinserts an id', () => {
    let start = emptyCellsCache();
    start = applyCellDelta(start, { type: 'birth', cell: cell(1) });
    start = applyCellDelta(start, { type: 'birth', cell: cell(2) });

    const out = applyRevisionedCellDeltas(start, [
      { revision: 1, delta: { type: 'gc', ids: [1] } },
      { revision: 2, delta: { type: 'birth', cell: cell(1) } },
    ]);

    expect([...out.cells.keys()]).toEqual([2, 1]);
    expect(out.cellChanges).toMatchObject({
      orderInvalidated: true,
      born: [],
      evicted: [],
      updated: [1],
      // Net view: the id is present on both sides of the batch, so the
      // remove-then-reinsert collapses out of `removed` too.
      removed: [],
    });
  });

  it('pulse advances lastPulseAtMs', () => {
    const c = applyCellDelta(emptyCellsCache(), { type: 'pulse', at_ms: 12345 });
    expect(c.lastPulseAtMs).toBe(12345);
  });

  it('stats overwrites total_births / total_deaths', () => {
    const c = applyCellDelta(emptyCellsCache(), {
      type: 'stats',
      total_births: 42,
      total_deaths: 17,
    });
    expect(c.totalBirths).toBe(42);
    expect(c.totalDeaths).toBe(17);
  });

  it('preserves the Cell Map for event-only deltas', () => {
    const populated = applyCellDelta(emptyCellsCache(), {
      type: 'birth',
      cell: cell(1),
    });
    const cells = populated.cells;

    const pulsed = applyCellDelta(populated, { type: 'pulse', at_ms: 12345 });
    const stats = applyCellDelta(pulsed, {
      type: 'stats',
      total_births: 1,
      total_deaths: 0,
    });
    const linked = applyCellDelta(stats, linkDelta('0xtx', 1));

    expect(pulsed.cells).toBe(cells);
    expect(stats.cells).toBe(cells);
    expect(linked.cells).toBe(cells);
    expect(linked.recentLinks).not.toBe(stats.recentLinks);
    expect(linked.pulseLinks).not.toBe(stats.pulseLinks);
    expect(pulsed.cellChanges).toMatchObject({
      reset: false,
      born: [],
      died: [],
      evicted: [],
      updated: [],
    });
    expect(stats.cellChanges).toBe(pulsed.cellChanges);
    expect(linked.cellChanges).toBe(pulsed.cellChanges);
  });

  it('link appends with a fresh monotonic seq', () => {
    let c = emptyCellsCache();
    c = applyCellDelta(c, {
      type: 'link',
      tx_hash: '0xtx',
      block: 1,
      from_ids: [1],
      to_ids: [2],
      endpoint_anchors: [
        {
          id: 1,
          pos_seed: [1, 0, -1],
          content_hash: '0x' + '11'.repeat(32),
        },
        {
          id: 2,
          pos_seed: [2, 0, -2],
          content_hash: '0x' + '22'.repeat(32),
        },
      ],
      parents: ['0xparent'],
      tag: null,
      at_ms: 1000,
    });
    expect(c.linksSeq).toBe(1);
    expect(c.recentLinks[0].seq).toBe(1);
    expect(c.recentLinks[0].tx_hash).toBe('0xtx');
    expect(c.recentLinks[0].endpoint_anchors.map((anchor) => anchor.id))
      .toEqual([1, 2]);
    expect(c.pulseLinks).toEqual(c.recentLinks);
  });

  it('retains evidence and pulse events under independent capacities', () => {
    let c = emptyCellsCache();
    for (let i = 0; i < 4; i++) {
      c = applyCellDelta(
        c,
        {
          type: 'link',
          tx_hash: `0xtx${i}`,
          block: i,
          from_ids: [],
          to_ids: [i],
          endpoint_anchors: [],
          parents: [],
          tag: null,
          at_ms: 1000 + i,
        },
        {
          recentLinksCapacity: 3,
          linkRingCapacity: 2,
        },
      );
    }

    expect(c.recentLinks.map((l) => l.tx_hash))
      .toEqual(['0xtx1', '0xtx2', '0xtx3']);
    expect(c.pulseLinks.map((l) => l.tx_hash)).toEqual(['0xtx2', '0xtx3']);
    expect(c.linksSeq).toBe(4);
  });

  it('link_prune removes orphan evidence and pending pulse events without rewinding seq', () => {
    let c = emptyCellsCache();
    c = applyCellDelta(c, linkDelta('0xcanonical', 1));
    c = applyCellDelta(c, linkDelta('0xorphan-2', 2));
    c = applyCellDelta(c, linkDelta('0xorphan-3', 3));
    const linksSeq = c.linksSeq;

    c = applyCellDelta(c, { type: 'link_prune', from_block: 2 });

    expect(c.recentLinks.map((link) => link.tx_hash)).toEqual(['0xcanonical']);
    expect(c.pulseLinks.map((link) => link.tx_hash)).toEqual(['0xcanonical']);
    expect(c.linksSeq).toBe(linksSeq);
    expect(c.linkPrune).toEqual({ fromBlock: 2, invalidatedCells: [] });
  });

  it('captures compact orphan Cell evidence before rollback GC removes it', () => {
    let c = emptyCellsCache();
    c = applyCellDelta(c, {
      type: 'birth',
      cell: cell(1, {
        birth_block: 1,
        pos_seed: [1, 2, 3],
        content_hash: `0x${'11'.repeat(32)}`,
      }),
    });
    c = applyCellDelta(c, {
      type: 'birth',
      cell: cell(2, {
        birth_block: 2,
        pos_seed: [4, 5, 6],
        content_hash: `0x${'22'.repeat(32)}`,
        data_hex: `0x${'ff'.repeat(256)}`,
      }),
    });

    const pruned = applyCellDelta(c, {
      type: 'link_prune',
      from_block: 2,
    });
    expect(pruned.linkPrune).toEqual({
      fromBlock: 2,
      invalidatedCells: [{
        id: 2,
        posSeed: [4, 5, 6],
        contentHash: `0x${'22'.repeat(32)}`,
      }],
    });
    expect(pruned.linkPrune?.invalidatedCells[0]).not.toHaveProperty('data_hex');

    const afterGc = applyCellDelta(pruned, { type: 'gc', ids: [2] });
    expect(afterGc.cells.has(2)).toBe(false);
    expect(afterGc.linkPrune).toBe(pruned.linkPrune);
  });

  it('captures the whole bounded field for a deep rebuild from block zero', () => {
    let c = emptyCellsCache();
    c = applyCellDelta(c, {
      type: 'birth',
      cell: cell(1, { birth_block: 1 }),
    });
    c = applyCellDelta(c, {
      type: 'birth',
      cell: cell(2, { birth_block: 20 }),
    });

    c = applyCellDelta(c, { type: 'link_prune', from_block: 0 });

    expect(c.linkPrune?.invalidatedCells.map((echo) => echo.id)).toEqual([1, 2]);
  });

  it('returns a new reference on a birth (purity)', () => {
    const before = emptyCellsCache();
    const after = applyCellDelta(before, { type: 'birth', cell: cell(1) });
    expect(after).not.toBe(before);
    expect(before.cells.size).toBe(0);
  });
});

describe('applyRevisionedCellDeltas (batched)', () => {
  const rd = (revision: number, delta: RevisionedCellDelta['delta']) =>
    ({ revision, delta } as RevisionedCellDelta);

  it('applies a mixed batch identically to sequential single-delta application', () => {
    const start = emptyCellsCache();
    const deltas: RevisionedCellDelta[] = [
      rd(1, { type: 'birth', cell: cell(1) }),
      rd(2, { type: 'birth', cell: cell(2) }),
      rd(3, { type: 'death', id: 1, at_ms: 5000 }),
      rd(4, { type: 'pulse', at_ms: 7000 }),
      rd(5, { type: 'stats', total_births: 2, total_deaths: 1 }),
    ];

    // Sequential reference using the pure single-delta reducer.
    let seq = start;
    for (const d of deltas) seq = applyCellDelta(seq, d.delta);

    const batched = applyRevisionedCellDeltas(start, deltas);

    expect(batched.revision).toBe(5);
    expect([...batched.cells.keys()].sort()).toEqual([...seq.cells.keys()].sort());
    expect(batched.cells.get(1)?.death_at_ms).toBe(5000);
    expect(batched.cells.get(2)?.death_at_ms).toBeNull();
    expect(batched.lastPulseAtMs).toBe(7000);
    expect(batched.totalBirths).toBe(2);
    expect(batched.totalDeaths).toBe(1);
    // The input cache is never mutated.
    expect(start.cells.size).toBe(0);
    expect(start.revision).toBe(0);
  });

  it('returns the same reference when the batch is empty', () => {
    const start = emptyCellsCache();
    expect(applyRevisionedCellDeltas(start, [])).toBe(start);
  });

  it('advances linksSeq across multiple link deltas in one batch', () => {
    const start = emptyCellsCache();
    const link = (tx: string) =>
      ({
        type: 'link' as const,
        tx_hash: tx,
        block: 1,
        from_ids: [],
        to_ids: [],
        endpoint_anchors: [],
        parents: [],
        tag: null,
        at_ms: 1000,
      });
    const out = applyRevisionedCellDeltas(start, [
      rd(1, link('0xa')),
      rd(2, link('0xb')),
    ]);
    expect(out.linksSeq).toBe(2);
    expect(out.recentLinks.map((l) => l.seq)).toEqual([1, 2]);
    expect(out.recentLinks.map((l) => l.tx_hash)).toEqual(['0xa', '0xb']);
    expect(out.pulseLinks.map((l) => l.tx_hash)).toEqual(['0xa', '0xb']);
  });

  it('keeps collection identities lazy across an event-only batch', () => {
    const start = applyCellDelta(emptyCellsCache(), {
      type: 'birth',
      cell: cell(1),
    });
    const out = applyRevisionedCellDeltas(start, [
      rd(2, { type: 'pulse', at_ms: 2000 }),
      rd(3, { type: 'stats', total_births: 1, total_deaths: 0 }),
    ]);

    expect(out).not.toBe(start);
    expect(out.revision).toBe(3);
    expect(out.cells).toBe(start.cells);
    expect(out.cellsToken).toBe(start.cellsToken);
    expect(out.recentLinks).toBe(start.recentLinks);
    expect(out.pulseLinks).toBe(start.pulseLinks);
    expect(start.cellChanges.born).toEqual([1]);
    expect(out.cellChanges).toMatchObject({
      reset: false,
      born: [],
      died: [],
      evicted: [],
      updated: [],
    });
  });

  it('publishes only net lifecycle changes for ids touched by the batch', () => {
    let start = emptyCellsCache();
    start = applyCellDelta(start, { type: 'birth', cell: cell(1) });
    start = applyCellDelta(start, {
      type: 'birth',
      cell: cell(2, { death_at_ms: 900 }),
    });
    start = applyCellDelta(start, { type: 'birth', cell: cell(5) });

    const out = applyRevisionedCellDeltas(start, [
      rd(4, { type: 'death', id: 1, at_ms: 5000 }),
      rd(5, { type: 'gc', ids: [2, 5] }),
      rd(6, { type: 'birth', cell: cell(3) }),
      rd(7, { type: 'tag', id: 3, tag: 'dex' }),
      rd(8, { type: 'birth', cell: cell(4) }),
      rd(9, { type: 'gc', ids: [4] }),
    ]);

    expect(out.cellChanges).toMatchObject({
      reset: false,
      born: [3],
      died: [1],
      evicted: [5],
      updated: [1, 3],
    });
  });

  it('chains Cell journal tokens across consecutive membership batches', () => {
    const start = emptyCellsCache();
    const first = applyRevisionedCellDeltas(start, [
      rd(1, { type: 'birth', cell: cell(1) }),
    ]);
    const second = applyRevisionedCellDeltas(first, [
      rd(2, { type: 'birth', cell: cell(2) }),
    ]);

    expect(first.cellChanges.baseToken).toBe(start.cellsToken);
    expect(second.cellChanges.baseToken).toBe(first.cellsToken);
    expect(second.cellChanges.baseToken).not.toBe(start.cellsToken);
    expect(second.cellsToken).not.toBe(first.cellsToken);
  });

  it('keeps the prune event one-shot while replacement links receive fresh seq values', () => {
    let start = emptyCellsCache();
    start = applyCellDelta(start, linkDelta('0xcanonical', 1));
    start = applyCellDelta(start, linkDelta('0xorphan', 2));

    const pruned = applyRevisionedCellDeltas(start, [
      rd(3, { type: 'link_prune', from_block: 2 }),
      rd(4, linkDelta('0xreplacement', 2)),
    ]);

    expect(pruned.recentLinks.map((link) => link.tx_hash))
      .toEqual(['0xcanonical', '0xreplacement']);
    expect(pruned.pulseLinks.map((link) => link.tx_hash))
      .toEqual(['0xcanonical', '0xreplacement']);
    expect(pruned.recentLinks.map((link) => link.seq)).toEqual([1, 3]);
    expect(pruned.linksSeq).toBe(3);
    expect(pruned.linkPrune).toEqual({
      fromBlock: 2,
      invalidatedCells: [],
    });

    const marker = pruned.linkPrune;
    const afterOrdinaryDelta = applyCellDelta(pruned, {
      type: 'pulse',
      at_ms: 5000,
    });
    expect(afterOrdinaryDelta.linkPrune).toBe(marker);
  });

  it('captures invalidation evidence before GC inside one revision batch', () => {
    let start = emptyCellsCache();
    start = applyCellDelta(start, {
      type: 'birth',
      cell: cell(9, {
        birth_block: 7,
        pos_seed: [9, 1, -9],
        content_hash: `0x${'99'.repeat(32)}`,
      }),
    });

    const rewritten = applyRevisionedCellDeltas(start, [
      rd(8, { type: 'link_prune', from_block: 7 }),
      rd(8, { type: 'gc', ids: [9] }),
    ]);

    expect(rewritten.cells.has(9)).toBe(false);
    expect(rewritten.linkPrune?.invalidatedCells).toEqual([{
      id: 9,
      posSeed: [9, 1, -9],
      contentHash: `0x${'99'.repeat(32)}`,
    }]);
  });
});

describe('canonical suffix-rewrite replay identity reuse', () => {
  const rd = (revision: number, delta: RevisionedCellDelta['delta']) =>
    ({ revision, delta } as RevisionedCellDelta);

  it('an identical rebirth is a pure no-op', () => {
    const populated = applyCellDelta(emptyCellsCache(), {
      type: 'birth',
      cell: cell(1),
    });
    // Fresh object, byte-identical content — as produced by a replayed frame.
    const replayed = applyCellDelta(populated, { type: 'birth', cell: cell(1) });
    expect(replayed).toBe(populated);
    expect(replayed.cells.get(1)).toBe(populated.cells.get(1));
  });

  it('keeps identity and journal silence for unchanged cells across a suffix-rewrite replay', () => {
    // Retained field: 40 cells below the rewrite boundary + 8 in the suffix.
    let start = emptyCellsCache();
    const seed: RevisionedCellDelta[] = [];
    for (let id = 1; id <= 48; id += 1) {
      seed.push(rd(id, {
        type: 'birth',
        cell: cell(id, { birth_block: id <= 40 ? 1 : 50 + id }),
      }));
    }
    start = applyRevisionedCellDeltas(start, seed);

    // Suffix rewrite replay: the prune marker plus re-delivered births. All
    // records arrive as fresh parsed objects; only two carry real changes.
    const replay: RevisionedCellDelta[] = [
      rd(100, { type: 'link_prune', from_block: 90 }),
    ];
    for (let id = 1; id <= 48; id += 1) {
      if (id === 41) {
        replay.push(rd(100 + id, {
          type: 'birth',
          cell: cell(id, { birth_block: 50 + id, capacity: 999 }),
        }));
      } else if (id === 42) {
        replay.push(rd(100 + id, {
          type: 'birth',
          cell: cell(id, { birth_block: 50 + id, death_at_ms: 9000 }),
        }));
      } else {
        replay.push(rd(100 + id, {
          type: 'birth',
          cell: cell(id, { birth_block: id <= 40 ? 1 : 50 + id }),
        }));
      }
    }
    const out = applyRevisionedCellDeltas(start, replay);

    // Every content-identical record keeps its exact retained object.
    for (let id = 1; id <= 48; id += 1) {
      if (id === 41 || id === 42) continue;
      expect(out.cells.get(id)).toBe(start.cells.get(id));
    }
    // The really-changed subset is replaced and is all the journal carries.
    expect(out.cells.get(41)).not.toBe(start.cells.get(41));
    expect(out.cells.get(41)?.capacity).toBe(999);
    expect(out.cells.get(42)?.death_at_ms).toBe(9000);
    expect(out.cellChanges).toMatchObject({
      reset: false,
      orderInvalidated: false,
      born: [],
      died: [42],
      evicted: [],
      updated: [41, 42],
    });
    expect(out.cellChanges.baseToken).toBe(start.cellsToken);
    expect(out.cellsToken).not.toBe(start.cellsToken);
  });

  it('advances only the revision when every replayed record is unchanged', () => {
    let start = emptyCellsCache();
    start = applyRevisionedCellDeltas(start, [
      rd(1, { type: 'birth', cell: cell(1) }),
      rd(2, { type: 'birth', cell: cell(2) }),
    ]);

    const out = applyRevisionedCellDeltas(start, [
      rd(3, { type: 'birth', cell: cell(1) }),
      rd(4, { type: 'birth', cell: cell(2) }),
    ]);

    expect(out).not.toBe(start);
    expect(out.revision).toBe(4);
    expect(out.cells).toBe(start.cells);
    expect(out.cellsToken).toBe(start.cellsToken);
    expect(out.cellChanges).toBe(NO_CELL_CHANGES);
  });

  it('re-death at the recorded timestamp and re-tag with the applied tag are no-ops', () => {
    let c = applyCellDelta(emptyCellsCache(), {
      type: 'birth',
      cell: cell(1, { tag: 'dex' }),
    });
    c = applyCellDelta(c, { type: 'death', id: 1, at_ms: 5000 });

    const redeath = applyCellDelta(c, { type: 'death', id: 1, at_ms: 5000 });
    expect(redeath).toBe(c);

    const retag = applyCellDelta(c, { type: 'tag', id: 1, tag: 'dex' });
    expect(retag).toBe(c);
  });

  it('gc of ids the cache never retained is a pure no-op', () => {
    const populated = applyCellDelta(emptyCellsCache(), {
      type: 'birth',
      cell: cell(1),
    });
    const swept = applyCellDelta(populated, { type: 'gc', ids: [7, 9] });
    expect(swept).toBe(populated);
    expect(swept.cellsToken).toBe(populated.cellsToken);
  });
});

describe('applyRevisionedCellDeltas', () => {
  it('advances revision to the max in the batch', () => {
    const after = applyRevisionedCellDeltas(emptyCellsCache(), [
      { revision: 1, delta: { type: 'birth', cell: cell(1) } },
      { revision: 5, delta: { type: 'birth', cell: cell(2) } },
    ]);
    expect(after.revision).toBe(5);
    expect(after.cells.size).toBe(2);
  });

  it('returns the previous cache for an empty batch', () => {
    const before = emptyCellsCache();
    expect(applyRevisionedCellDeltas(before, [])).toBe(before);
  });
});

describe('fromCellsSnapshot', () => {
  it('hydrates cells, recent_links, and counters', () => {
    const snap: CellGalaxySnapshot = {
      cells: [cell(1), cell(2, { tag: 'dex' })],
      last_pulse_at_ms: 1234,
      recent_links: [
        {
          tx_hash: '0xtx1',
          block: 1,
          from_ids: [],
          to_ids: [1, 2],
          endpoint_anchors: [
            {
              id: 1,
              pos_seed: [0, 0, 0],
              content_hash: cell(1).content_hash,
            },
            {
              id: 2,
              pos_seed: [0, 0, 0],
              content_hash: cell(2).content_hash,
            },
          ],
          parents: [],
          tag: null,
          at_ms: 1100,
        },
      ],
      total_births: 2,
      total_deaths: 0,
    };
    const c = fromCellsSnapshot(7, snap);
    expect(c.revision).toBe(7);
    expect(c.cells.size).toBe(2);
    expect(c.totalBirths).toBe(2);
    expect(c.recentLinks.length).toBe(1);
    expect(c.recentLinks[0].seq).toBe(1);
    expect(c.pulseLinks).toEqual([]);
    expect(c.linksSeq).toBe(1);
    expect(c.lastPulseAtMs).toBe(1234);
    expect(c.cellChanges).toMatchObject({
      reset: true,
      born: [],
      died: [],
      evicted: [],
      updated: [],
    });
  });

  it('hydrates the evidence window without replaying snapshot links as pulses', () => {
    const snap: CellGalaxySnapshot = {
      cells: [],
      last_pulse_at_ms: 0,
      recent_links: [0, 1, 2].map((i) => ({
        tx_hash: `0xtx${i}`,
        block: i,
        from_ids: [],
        to_ids: [i],
        endpoint_anchors: [],
        parents: [],
        tag: null,
        at_ms: 1000 + i,
      })),
    };

    const c = fromCellsSnapshot(7, snap, {
      recentLinksCapacity: 3,
      linkRingCapacity: 1,
    });

    expect(c.recentLinks.map((l) => l.tx_hash))
      .toEqual(['0xtx0', '0xtx1', '0xtx2']);
    expect(c.pulseLinks).toEqual([]);
    expect(c.linksSeq).toBe(3);
  });

  it('trims hydrated evidence only with the evidence capacity', () => {
    const snap: CellGalaxySnapshot = {
      cells: [],
      last_pulse_at_ms: 0,
      recent_links: [0, 1, 2].map((i) => ({
        tx_hash: `0xtx${i}`,
        block: i,
        from_ids: [],
        to_ids: [i],
        endpoint_anchors: [],
        parents: [],
        tag: null,
        at_ms: 1000 + i,
      })),
    };

    const c = fromCellsSnapshot(7, snap, {
      recentLinksCapacity: 2,
      linkRingCapacity: 1,
    });

    expect(c.recentLinks.map((l) => l.tx_hash)).toEqual(['0xtx1', '0xtx2']);
    expect(c.pulseLinks).toEqual([]);
    expect(c.linksSeq).toBe(2);
  });

  it('reuses content-identical retained Cell objects on a resync snapshot', () => {
    let prev = emptyCellsCache();
    prev = applyCellDelta(prev, { type: 'birth', cell: cell(1) });
    prev = applyCellDelta(prev, { type: 'birth', cell: cell(2) });
    prev = applyCellDelta(prev, { type: 'birth', cell: cell(3) });

    // Resync snapshot: 1 unchanged, 2 really changed, 3 gone, 4 new.
    const snap: CellGalaxySnapshot = {
      cells: [cell(1), cell(2, { capacity: 777 }), cell(4)],
      last_pulse_at_ms: 0,
    };
    const c = fromCellsSnapshot(9, snap, {}, prev);

    expect(c.cells.get(1)).toBe(prev.cells.get(1));
    expect(c.cells.get(2)).not.toBe(prev.cells.get(2));
    expect(c.cells.get(2)?.capacity).toBe(777);
    expect(c.cells.get(4)?.id).toBe(4);
    // The snapshot stays authoritative for membership and insertion order.
    expect(c.cells.has(3)).toBe(false);
    expect([...c.cells.keys()]).toEqual([1, 2, 4]);
    // Reset signalling is untouched: fresh token, reset journal.
    expect(c.cellsToken).not.toBe(prev.cellsToken);
    expect(c.cellChanges).toMatchObject({
      reset: true,
      born: [],
      died: [],
      evicted: [],
      updated: [],
    });
  });
});

describe('cross-language wire-shape parity', () => {
  it('snapshot_cells.json hydrates a runnable cache', () => {
    const snap = fixture<CellGalaxySnapshot>('snapshot_cells.json');
    const c = fromCellsSnapshot(0, snap);
    expect(c.cells.size).toBe(snap.cells.length);
    expect(c.totalBirths).toBe(snap.total_births ?? 0);
  });

  // ⭐ The differential gate for moving aggregation to the server: the segment
  // the Rust side computed over the fixture's cells must equal, field for
  // field, what this side's reference scan derives from those same cells.
  // Regenerating the fixture from Rust and running this is what keeps the two
  // implementations honest about `data_hex` emptiness, the four known tags,
  // and the dead-cell skip.
  it('the server aggregate equals the reference full scan, field for field', () => {
    const snap = fixture<CellGalaxySnapshot>('snapshot_cells.json');
    expect(snap.stats).toBeDefined();
    const seeded = fromCellsSnapshot(0, snap);
    const scanned = aggregateCellsStats(
      seeded.cells,
      snap.total_births ?? 0,
      snap.total_deaths ?? 0,
    );
    // The script census is the one field this side deliberately does NOT
    // derive. Every other number here is scope-independent enough that a scan
    // over the same rows reproduces it; a census is a distribution over the
    // whole retained set, and this cache holds the staged subset. Computing
    // it locally would not be a slower path to the same answer — it would be
    // a confident wrong one, so the scan leaves it empty.
    const { scripts: scannedCensus, ...scannedRest } = scanned;
    const { scripts: seededCensus, ...seededRest } = seeded.stats;
    expect(seededRest).toEqual(scannedRest);
    expect(scannedCensus).toEqual(emptyScriptCensus());
    expect(seededCensus.locks.length).toBeGreaterThan(0);
  });

  it('falls back to the full scan when the server sends no aggregate', () => {
    const snap = fixture<CellGalaxySnapshot>('snapshot_cells.json');
    const { stats: _dropped, ...legacy } = snap;
    const seeded = fromCellsSnapshot(0, legacy as CellGalaxySnapshot);
    expect(seeded.stats).toEqual(
      aggregateCellsStats(
        seeded.cells,
        snap.total_births ?? 0,
        snap.total_deaths ?? 0,
      ),
    );
  });

  // The whole point of the segment: it describes the server's retained set, so
  // it must not move when the snapshot's row scope narrows to the stage.
  it('keeps the seeded aggregate when the snapshot carries fewer rows', () => {
    const snap = fixture<CellGalaxySnapshot>('snapshot_cells.json');
    const staged: CellGalaxySnapshot = { ...snap, cells: snap.cells.slice(0, 1) };
    const seeded = fromCellsSnapshot(0, staged);
    expect(seeded.cells.size).toBe(1);
    expect(seeded.stats.inView).toBe(snap.stats!.in_view);
    expect(seeded.stats.capacityShannons).toBe(snap.stats!.capacity_shannons);
    expect(seeded.stats.byAsset).toEqual(snap.stats!.by_asset);
  });

  it('the cell_samples.json entries pipe through applyCellDelta birth/death', () => {
    const cells = fixture<Cell[]>('cell_samples.json');
    let c = emptyCellsCache();
    let rev = 0;
    const deltas: RevisionedCellDelta[] = cells.map((cell) => ({
      revision: ++rev,
      delta: { type: 'birth', cell },
    }));
    c = applyRevisionedCellDeltas(c, deltas);
    expect(c.cells.size).toBe(cells.length);
    expect(c.revision).toBe(cells.length);
  });
});
