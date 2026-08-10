import { describe, expect, it } from 'vitest';
import type { Cell, RevisionedCellDelta } from '@cknerv/types';
import {
  applyCellDelta,
  applyRevisionedCellDeltas,
  emptyCellsCache,
  fromCellsSnapshot,
  type CellGalaxyCache,
} from '../src/cellsReducer';
import {
  CELL_FIELD_HAS_DATA,
  cellFieldColumnBytes,
  cellFieldRemove,
  cellFieldSlotOf,
  cellFieldUpsert,
  clearCellField,
  createCellField,
  hydrateCellFieldFromColumnar,
  materializeCellAt,
  syncCellFieldFromCache,
  type CellField,
} from '../src/cellField';
import { CELLS_COLUMNAR_NO_TAG, type CellsColumnarView } from '../src/cellsColumnar';

function cell(id: number, overrides: Partial<Cell> = {}): Cell {
  return {
    id,
    born_at_ms: 1000 + id,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [0, 0, 0],
    out_point: { tx_hash: `0xtx${id}`, index: id % 7 },
    capacity: 6_100_000_000 + id,
    data_hex: '0x',
    content_hash: '0x' + '00'.repeat(32),
    ...overrides,
  };
}

/** Field rows must mirror the Map exactly. The columnar plane normalizes the
 *  optional enums (`undefined` → 'other'), matching every consumer's
 *  classifier default; everything else round-trips verbatim (pos_seed is
 *  f32-origin on the wire, so its JSON numbers are f32-exact already). */
function expectFieldMirrorsCache(field: CellField, cache: CellGalaxyCache): void {
  expect(field.size).toBe(cache.cells.size);
  for (const [id, c] of cache.cells) {
    const slot = cellFieldSlotOf(field, id);
    expect(slot, `cell ${id} missing from field`).toBeGreaterThanOrEqual(0);
    expect(materializeCellAt(field, slot)).toEqual({
      ...c,
      lock_kind: c.lock_kind ?? 'other',
      asset_kind: c.asset_kind ?? 'other',
    });
  }
}

describe('cellField store', () => {
  it('round-trips cells through columns, including 2^52-range ids', () => {
    const field = createCellField(16);
    const bigId = 4_503_599_627_370_497; // 2^52 + 1: must never truncate
    const a = cell(bigId, {
      tag: 'wallet',
      data_hex: '0xdeadbeef',
      lock_kind: 'omnilock',
      asset_kind: 'dao',
      death_at_ms: 123_456,
      pos_seed: [0.5, -2.25, 3.125],
    });
    const slot = cellFieldUpsert(field, a);
    expect(cellFieldSlotOf(field, bigId)).toBe(slot);
    expect(field.flags[slot] & CELL_FIELD_HAS_DATA).toBe(CELL_FIELD_HAS_DATA);
    expect(materializeCellAt(field, slot)).toEqual(a);

    // Upsert overwrites in place — same slot, new values.
    const a2 = { ...a, tag: null, death_at_ms: null, data_hex: '0x' };
    expect(cellFieldUpsert(field, a2)).toBe(slot);
    expect(field.size).toBe(1);
    expect(materializeCellAt(field, slot)).toEqual(a2);
  });

  it('normalizes absent optional enums to other', () => {
    const field = createCellField(16);
    const slot = cellFieldUpsert(field, cell(1));
    expect(materializeCellAt(field, slot)).toMatchObject({
      lock_kind: 'other',
      asset_kind: 'other',
    });
  });

  it('recycles freed slots and bumps their generation', () => {
    const field = createCellField(16);
    const slot = cellFieldUpsert(field, cell(1));
    const generationBefore = field.generation[slot];
    expect(cellFieldRemove(field, 1)).toBe(true);
    expect(cellFieldRemove(field, 1)).toBe(false);
    expect(cellFieldSlotOf(field, 1)).toBe(-1);
    expect(field.size).toBe(0);
    expect(field.generation[slot]).toBe(generationBefore + 1);
    // Next insert reuses the freed slot.
    expect(cellFieldUpsert(field, cell(2))).toBe(slot);
  });

  it('grows columns and hash across thousands of inserts and stays exact', () => {
    const field = createCellField(16);
    const count = 5000;
    for (let i = 0; i < count; i += 1) {
      // Spread ids across small and 2^52 ranges to exercise the hash mix.
      const id = i % 2 === 0 ? i + 1 : 4_503_599_627_370_000 + i;
      cellFieldUpsert(field, cell(id));
    }
    expect(field.size).toBe(count);
    for (let i = 0; i < count; i += 1) {
      const id = i % 2 === 0 ? i + 1 : 4_503_599_627_370_000 + i;
      const slot = cellFieldSlotOf(field, id);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(field.id[slot]).toBe(id);
    }
    expect(cellFieldColumnBytes(field)).toBeGreaterThan(count * 60);
  });

  it('survives heavy tombstone churn at one id neighborhood', () => {
    const field = createCellField(16);
    for (let round = 0; round < 2000; round += 1) {
      cellFieldUpsert(field, cell(round + 1));
      expect(cellFieldRemove(field, round + 1)).toBe(true);
    }
    expect(field.size).toBe(0);
    cellFieldUpsert(field, cell(42));
    expect(cellFieldSlotOf(field, 42)).toBeGreaterThanOrEqual(0);
    // Tombstone-triggered rehashes keep the table bounded.
    expect(field.hashKeys.length).toBeLessThanOrEqual(4096);
  });
});

describe('syncCellFieldFromCache', () => {
  it('is idempotent per cache generation', () => {
    const field = createCellField(16);
    const cache = applyCellDelta(emptyCellsCache(), { type: 'birth', cell: cell(1) });
    expect(syncCellFieldFromCache(field, cache).mode).toBe('rebuild');
    expect(syncCellFieldFromCache(field, cache).mode).toBe('noop');
    expectFieldMirrorsCache(field, cache);
  });

  it('applies chained generations incrementally, including dead-record GC', () => {
    const field = createCellField(16);
    let cache = applyCellDelta(emptyCellsCache(), { type: 'birth', cell: cell(1) });
    syncCellFieldFromCache(field, cache);

    cache = applyCellDelta(cache, { type: 'birth', cell: cell(2) });
    expect(syncCellFieldFromCache(field, cache)).toEqual({
      mode: 'incremental',
      upserts: 1,
      removals: 0,
    });
    expectFieldMirrorsCache(field, cache);

    cache = applyCellDelta(cache, { type: 'death', id: 1, at_ms: 9000 });
    expect(syncCellFieldFromCache(field, cache).mode).toBe('incremental');
    expect(
      materializeCellAt(field, cellFieldSlotOf(field, 1)).death_at_ms,
    ).toBe(9000);

    // GC of the already-dead record: only the new `removed` list carries it.
    cache = applyCellDelta(cache, { type: 'gc', ids: [1] });
    expect(cache.cellChanges.evicted).toEqual([]);
    expect(cache.cellChanges.removed).toEqual([1]);
    expect(syncCellFieldFromCache(field, cache)).toEqual({
      mode: 'incremental',
      upserts: 0,
      removals: 1,
    });
    expectFieldMirrorsCache(field, cache);
  });

  it('falls back to one rebuild when a generation was skipped', () => {
    const field = createCellField(16);
    let cache = applyCellDelta(emptyCellsCache(), { type: 'birth', cell: cell(1) });
    syncCellFieldFromCache(field, cache);
    cache = applyCellDelta(cache, { type: 'birth', cell: cell(2) });
    const skipped = applyCellDelta(cache, { type: 'birth', cell: cell(3) });
    // Field never saw `cache`; the journal on `skipped` chains from cache's
    // token, so the field must detect the gap and rebuild.
    expect(syncCellFieldFromCache(field, skipped).mode).toBe('rebuild');
    expectFieldMirrorsCache(field, skipped);
  });

  it('rebuilds on snapshot reset', () => {
    const field = createCellField(16);
    let cache = applyCellDelta(emptyCellsCache(), { type: 'birth', cell: cell(1) });
    syncCellFieldFromCache(field, cache);
    cache = fromCellsSnapshot(7, {
      cells: [cell(10), cell(11)],
      last_pulse_at_ms: 0,
    });
    expect(syncCellFieldFromCache(field, cache).mode).toBe('rebuild');
    expectFieldMirrorsCache(field, cache);
  });

  it('mirrors the map exactly through a long randomized delta soak', () => {
    // Deterministic LCG so failures reproduce.
    let state = 12345;
    const rand = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    const randomId = () =>
      rand() < 0.3
        ? 4_503_599_627_370_000 + Math.floor(rand() * 500)
        : 1 + Math.floor(rand() * 500);
    const randomCell = (id: number): Cell =>
      cell(id, {
        born_at_ms: Math.floor(rand() * 1e12),
        pos_seed: [
          Math.fround(rand() * 10 - 5),
          Math.fround(rand() * 10 - 5),
          Math.fround(rand() * 10 - 5),
        ],
        tag: rand() < 0.2 ? 'wallet' : null,
        data_hex: rand() < 0.3 ? '0xdeadbeef' : '0x',
        lock_kind: rand() < 0.5 ? 'sighash' : undefined,
        asset_kind: rand() < 0.5 ? 'dao' : undefined,
      });

    const field = createCellField(16);
    let cache = emptyCellsCache();
    let incrementals = 0;
    for (let round = 0; round < 300; round += 1) {
      const deltas: RevisionedCellDelta[] = [];
      const batchSize = 1 + Math.floor(rand() * 6);
      for (let i = 0; i < batchSize; i += 1) {
        const roll = rand();
        if (roll < 0.45) {
          deltas.push({
            revision: round * 10 + i,
            delta: { type: 'birth', cell: randomCell(randomId()) },
          });
        } else if (roll < 0.65) {
          deltas.push({
            revision: round * 10 + i,
            delta: { type: 'death', id: randomId(), at_ms: round * 1000 + i },
          });
        } else if (roll < 0.85) {
          const ids = [randomId(), randomId()].filter(() => rand() < 0.8);
          deltas.push({ revision: round * 10 + i, delta: { type: 'gc', ids } });
        } else {
          deltas.push({
            revision: round * 10 + i,
            delta: { type: 'tag', id: randomId(), tag: 'dex' },
          });
        }
      }
      cache = applyRevisionedCellDeltas(cache, deltas);
      // Occasionally skip a sync to force the gap-rebuild path next round.
      if (rand() < 0.1) continue;
      const result = syncCellFieldFromCache(field, cache);
      if (result.mode === 'incremental') incrementals += 1;
      expectFieldMirrorsCache(field, cache);
    }
    // The soak must actually exercise the incremental path, not rebuild
    // every round.
    expect(incrementals).toBeGreaterThan(150);
  });
});

describe('hydrateCellFieldFromColumnar', () => {
  it('fills numeric columns and tags, and marks strings unhydrated', () => {
    const view: CellsColumnarView = {
      revision: 5,
      lastPulseAtMs: 0,
      totalBirths: 2,
      totalDeaths: 0,
      rowCount: 2,
      id: new Float64Array([4_503_599_627_370_497, 8]),
      bornAtMs: new Float64Array([100, 200]),
      deathAtMs: new Float64Array([Number.NaN, 900]),
      capacity: new Float64Array([1000, 2000]),
      posX: new Float32Array([1, -1]),
      posY: new Float32Array([2, -2]),
      posZ: new Float32Array([3, -3]),
      birthBlock: new Uint32Array([5, 6]),
      outPointIndex: new Uint32Array([0, 3]),
      lockKind: new Uint8Array([0, 3]),
      assetKind: new Uint8Array([0, 3]),
      tagIndex: new Uint8Array([0, CELLS_COLUMNAR_NO_TAG]),
      dataFlag: new Uint8Array([1, 0]),
      tags: ['wallet'],
    };
    const field = createCellField(16);
    hydrateCellFieldFromColumnar(field, view);

    expect(field.size).toBe(2);
    expect(field.stringsHydrated).toBe(false);
    expect(field.syncToken).toBeNull();
    const slot = cellFieldSlotOf(field, 4_503_599_627_370_497);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(field.tag[slot]).toBe('wallet');
    expect(field.flags[slot]).toBe(CELL_FIELD_HAS_DATA);
    expect(Number.isNaN(field.deathAtMs[slot])).toBe(true);
    const slot2 = cellFieldSlotOf(field, 8);
    expect(field.deathAtMs[slot2]).toBe(900);
    expect(field.tag[slot2]).toBeNull();

    // A later full clear restores the JSON-path contract.
    clearCellField(field);
    expect(field.size).toBe(0);
    expect(field.stringsHydrated).toBe(true);
  });
});
