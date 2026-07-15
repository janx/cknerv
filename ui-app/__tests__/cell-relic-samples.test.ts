import { describe, expect, it } from 'vitest';
import type { AssetKind, Cell, CellGalaxySnapshot, LockKind } from '@cknerv/types';
import { selectRelicSamples } from '../src/cell-relic-samples';

function cell(
  id: number,
  options: {
    asset?: AssetKind;
    lock?: LockKind;
    capacity?: number;
    data?: string;
    hashPrefix?: string;
  } = {},
): Cell {
  const prefix = (options.hashPrefix ?? id.toString(16)).padStart(8, '0');
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [0, 0, 0],
    out_point: { tx_hash: `0x${'11'.repeat(32)}`, index: id },
    capacity: options.capacity ?? 61e8,
    data_hex: options.data ?? '0x',
    content_hash: `0x${prefix}${'0'.repeat(56)}`,
    lock_kind: options.lock ?? 'sighash',
    asset_kind: options.asset ?? 'native',
  };
}

function snapshot(cells: Cell[]): CellGalaxySnapshot {
  return { cells, last_pulse_at_ms: 0 };
}

describe('selectRelicSamples', () => {
  it('selects unique real Cells while covering available asset families', () => {
    const cells = [
      cell(1, { asset: 'native' }),
      cell(2, { asset: 'sudt' }),
      cell(3, { asset: 'dao' }),
      cell(4, { asset: 'spore' }),
      cell(5, { asset: 'other' }),
      cell(6, { asset: 'native', data: '0x001122' }),
    ];
    const samples = selectRelicSamples(snapshot(cells), 6);
    expect(new Set(samples.map(({ cell: sample }) => sample.id)).size).toBe(samples.length);
    expect(new Set(samples.map(({ cell: sample }) => sample.asset_kind))).toEqual(
      new Set(['native', 'sudt', 'dao', 'spore', 'other']),
    );
  });

  it('adds capacity, data, and lock variants after asset coverage', () => {
    const cells = [
      cell(1, { asset: 'native', lock: 'sighash' }),
      cell(2, { asset: 'other', lock: 'multisig', data: '0x00112233' }),
      cell(3, { asset: 'native', lock: 'acp', capacity: 10e8 }),
      cell(4, { asset: 'other', lock: 'omnilock', capacity: 10_000e8 }),
      cell(5, { asset: 'native', lock: 'other' }),
      cell(6, { asset: 'other', lock: 'sighash' }),
      cell(7, { asset: 'native', lock: 'multisig' }),
      cell(8, { asset: 'other', lock: 'acp' }),
    ];
    const samples = selectRelicSamples(snapshot(cells), 8);
    expect(samples).toHaveLength(8);
    expect(samples.some(({ basis }) => basis === 'data')).toBe(true);
    expect(samples.some(({ basis }) => basis === 'capacity')).toBe(true);
    expect(new Set(samples.map(({ cell: sample }) => sample.lock_kind)).size).toBeGreaterThan(2);
  });

  it('honors the requested limit and handles empty snapshots', () => {
    const cells = Array.from({ length: 20 }, (_, index) => cell(index + 1));
    expect(selectRelicSamples(snapshot(cells), 4)).toHaveLength(4);
    expect(selectRelicSamples(snapshot([]))).toEqual([]);
    expect(selectRelicSamples(snapshot(cells), 0)).toEqual([]);
  });
});
