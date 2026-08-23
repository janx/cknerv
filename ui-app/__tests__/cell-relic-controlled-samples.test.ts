import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  CONTROLLED_RELIC_CAMERAS,
  controlledRelicRows,
} from '../src/cell-relic-controlled-samples';

const SOURCE: Cell = {
  id: 77,
  born_at_ms: 1_000,
  death_at_ms: null,
  birth_block: 42,
  tag: null,
  pos_seed: [0, 0, 0],
  out_point: { tx_hash: `0x${'11'.repeat(32)}`, index: 0 },
  capacity: 61e8,
  data_hex: '0x1234',
  data_bytes: 2,
  content_hash: `0x${'22'.repeat(32)}`,
  lock_shape_seed: [1, 2],
  type_shape_seed: [3, 4],
  data_shape_seed: [5, 6],
  lock_kind: 'sighash',
  asset_kind: 'xudt',
};

describe('controlled Cell relic matrix', () => {
  it('covers every single-variable row and all canonical cameras', () => {
    const rows = controlledRelicRows(SOURCE);
    expect(rows.map((row) => row.axis)).toEqual([
      'type',
      'lock',
      'data-content',
      'data-size',
      'capacity',
      'collection',
      'fallback',
    ]);
    expect(CONTROLLED_RELIC_CAMERAS).toEqual(['front', 'side', 'three-quarter']);
  });

  it('retains one observed identity and never labels counterfactuals as real Cells', () => {
    for (const row of controlledRelicRows(SOURCE)) {
      for (const sample of row.variants) {
        expect(sample.synthetic).toBe(true);
        expect(sample.sourceCellId).toBe(SOURCE.id);
        expect(sample.cell.id).toBe(SOURCE.id);
        expect(sample.cell.out_point).toBe(SOURCE.out_point);
      }
    }
  });

  it('changes only the fields owned by each controlled axis', () => {
    const byAxis = new Map(controlledRelicRows(SOURCE).map((row) => [row.axis, row]));
    for (const sample of byAxis.get('type')!.variants) {
      expect(sample.cell.lock_shape_seed).toEqual(SOURCE.lock_shape_seed);
      expect(sample.cell.data_shape_seed).toEqual(SOURCE.data_shape_seed);
      expect(sample.cell.data_bytes).toBe(SOURCE.data_bytes);
      expect(sample.cell.capacity).toBe(SOURCE.capacity);
    }
    for (const sample of byAxis.get('lock')!.variants) {
      expect(sample.cell.type_shape_seed).toEqual(SOURCE.type_shape_seed);
      expect(sample.cell.data_shape_seed).toEqual(SOURCE.data_shape_seed);
      expect(sample.cell.data_bytes).toBe(SOURCE.data_bytes);
      expect(sample.cell.capacity).toBe(SOURCE.capacity);
    }
    for (const sample of byAxis.get('data-content')!.variants) {
      expect(sample.cell.type_shape_seed).toEqual(SOURCE.type_shape_seed);
      expect(sample.cell.lock_shape_seed).toEqual(SOURCE.lock_shape_seed);
      expect(sample.cell.data_bytes).toBe(256);
      expect(sample.cell.capacity).toBe(SOURCE.capacity);
    }
    for (const sample of byAxis.get('data-size')!.variants) {
      expect(sample.cell.type_shape_seed).toEqual(SOURCE.type_shape_seed);
      expect(sample.cell.lock_shape_seed).toEqual(SOURCE.lock_shape_seed);
      expect(sample.cell.data_shape_seed).toEqual([0x1111_2222, 0x3333_4444]);
      expect(sample.cell.capacity).toBe(SOURCE.capacity);
    }
    for (const sample of byAxis.get('capacity')!.variants) {
      expect(sample.cell.type_shape_seed).toEqual(SOURCE.type_shape_seed);
      expect(sample.cell.lock_shape_seed).toEqual(SOURCE.lock_shape_seed);
      expect(sample.cell.data_shape_seed).toEqual(SOURCE.data_shape_seed);
      expect(sample.cell.data_bytes).toBe(SOURCE.data_bytes);
    }
    // The crafted family is the row's CONSTANT, not a second variable: every
    // variant wears the same one, so the only thing that moves is the
    // collection. Everything a cartouche's outline reads from is held too.
    const collection = byAxis.get('collection')!.variants;
    for (const sample of collection) {
      expect(sample.cell.asset_kind).toBe('spore');
      expect(sample.cell.type_shape_seed).toEqual(collection[0].cell.type_shape_seed);
      expect(sample.cell.lock_shape_seed).toEqual(SOURCE.lock_shape_seed);
      expect(sample.cell.data_shape_seed).toEqual(SOURCE.data_shape_seed);
      expect(sample.cell.data_bytes).toBe(SOURCE.data_bytes);
      expect(sample.cell.capacity).toBe(SOURCE.capacity);
    }
    expect(collection[0].cell.collection_seed).toBeUndefined();
    expect(
      new Set(collection.slice(1).map((s) => String(s.cell.collection_seed))).size,
    ).toBe(collection.length - 1);
  });
});
