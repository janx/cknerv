// Pure-reducer tests for the cell-galaxy projection cache.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  Cell,
  CellGalaxySnapshot,
  RevisionedCellDelta,
} from '@cknerv/types';

import {
  applyCellDelta,
  applyRevisionedCellDeltas,
  emptyCellsCache,
  fromCellsSnapshot,
} from '../src/cellsReducer';

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

describe('applyCellDelta', () => {
  it('birth inserts the cell into the map', () => {
    const c = applyCellDelta(emptyCellsCache(), {
      type: 'birth',
      cell: cell(1),
    });
    expect(c.cells.size).toBe(1);
    expect(c.cells.get(1)?.id).toBe(1);
  });

  it('death marks the existing cell with death_at_ms', () => {
    let c = applyCellDelta(emptyCellsCache(), { type: 'birth', cell: cell(1) });
    c = applyCellDelta(c, { type: 'death', id: 1, at_ms: 5000 });
    expect(c.cells.get(1)?.death_at_ms).toBe(5000);
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
  });

  it('gc removes the listed ids', () => {
    let c = emptyCellsCache();
    c = applyCellDelta(c, { type: 'birth', cell: cell(1) });
    c = applyCellDelta(c, { type: 'birth', cell: cell(2) });
    c = applyCellDelta(c, { type: 'birth', cell: cell(3) });
    c = applyCellDelta(c, { type: 'gc', ids: [1, 3] });
    expect(c.cells.size).toBe(1);
    expect(c.cells.get(2)?.id).toBe(2);
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

  it('link appends with a fresh monotonic seq', () => {
    let c = emptyCellsCache();
    c = applyCellDelta(c, {
      type: 'link',
      tx_hash: '0xtx',
      block: 1,
      from_ids: [1],
      to_ids: [2],
      parents: ['0xparent'],
      tag: null,
      at_ms: 1000,
    });
    expect(c.linksSeq).toBe(1);
    expect(c.recentLinks[0].seq).toBe(1);
    expect(c.recentLinks[0].tx_hash).toBe('0xtx');
  });

  it('returns a new reference on a birth (purity)', () => {
    const before = emptyCellsCache();
    const after = applyCellDelta(before, { type: 'birth', cell: cell(1) });
    expect(after).not.toBe(before);
    expect(before.cells.size).toBe(0);
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
    expect(c.linksSeq).toBe(1);
    expect(c.lastPulseAtMs).toBe(1234);
  });
});

describe('cross-language wire-shape parity', () => {
  it('snapshot_cells.json hydrates a runnable cache', () => {
    const snap = fixture<CellGalaxySnapshot>('snapshot_cells.json');
    const c = fromCellsSnapshot(0, snap);
    expect(c.cells.size).toBe(snap.cells.length);
    expect(c.totalBirths).toBe(snap.total_births ?? 0);
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
