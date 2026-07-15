import { describe, expect, it } from 'vitest';
import type { AssetKind, Cell, CellGalaxySnapshot } from '@cknerv/types';
import {
  observedLabDataBytes,
  selectInitialLabCell,
} from '../src/cell-form-lab-selection';

function cell(id: number, dataHex: string, assetKind: AssetKind = 'other'): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [0, 0, 0],
    out_point: { tx_hash: `0x${'11'.repeat(32)}`, index: id },
    capacity: 61e8,
    data_hex: dataHex,
    content_hash: `0x${id.toString(16).padStart(64, '0')}`,
    lock_kind: 'sighash',
    asset_kind: assetKind,
  };
}

function snapshot(cells: Cell[]): CellGalaxySnapshot {
  return { cells, last_pulse_at_ms: 0 };
}

describe('selectInitialLabCell', () => {
  it('honors an explicit real Cell id before sample selection', () => {
    const cells = [cell(1, '0x', 'native'), cell(2, '0x001122')];
    expect(selectInitialLabCell(snapshot(cells), '?cell=1&sample=content')?.id).toBe(1);
  });

  it('selects the richest observed payload for content stress tests', () => {
    const cells = [cell(1, '0x00', 'native'), cell(2, '0x001122…'), cell(3, '0x0011')];
    expect(observedLabDataBytes(cells[1])).toBe(3);
    expect(selectInitialLabCell(snapshot(cells), '?sample=content')?.id).toBe(2);
  });

  it('falls back to a native Cell, then the first Cell, then null', () => {
    const native = cell(2, '0x', 'native');
    expect(selectInitialLabCell(snapshot([cell(1, '0x'), native]), '').id).toBe(2);
    expect(selectInitialLabCell(snapshot([cell(1, '0x')]), '').id).toBe(1);
    expect(selectInitialLabCell(snapshot([]), '')).toBeNull();
  });
});
