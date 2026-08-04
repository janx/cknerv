import { describe, expect, it } from 'vitest';
import type {
  CellSemanticRecord,
  EnrichmentSourceStatus,
  SemanticAsset,
} from '@cknerv/types';
import {
  CELL_SEMANTIC_TAU,
  cellSemanticAssetAccent,
  cellSemanticVisualState,
  deriveCellSemanticComposition,
} from '../../src/derives/cellSemantics.derive';

const record: CellSemanticRecord = {
  out_point: { tx_hash: `0x${'11'.repeat(32)}`, index: 0 },
  source: 'ckbadger',
  as_of: { block: 100, hash: `0x${'aa'.repeat(32)}` },
  observed_at_block: 92,
  updated_at_ms: 1,
  common_knowledge: {
    total_bytes: 100,
    capacity_field_bytes: 8,
    lock_script_bytes: 52,
    type_script_bytes: 33,
    data_bytes: 7,
  },
  facets: [],
};

const source: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['cell_detail'],
  validated_anchor: { block: 101, hash: `0x${'bb'.repeat(32)}` },
};

describe('selected Cell semantic visual derivation', () => {
  it('closes one exact orbit from occupied-byte proportions', () => {
    const composition = deriveCellSemanticComposition(record);

    expect(composition?.segments.map((segment) => segment.kind)).toEqual([
      'capacity',
      'lock',
      'type',
      'data',
    ]);
    expect(composition?.segments[1].fraction).toBeCloseTo(0.52);
    expect(composition?.segments.reduce(
      (sum, segment) => sum + segment.sweep,
      0,
    )).toBeCloseTo(CELL_SEMANTIC_TAU);
  });

  it('refuses to draw an inconsistent byte breakdown', () => {
    const inconsistent: CellSemanticRecord = {
      ...record,
      common_knowledge: {
        ...record.common_knowledge!,
        total_bytes: 99,
      },
    };

    expect(deriveCellSemanticComposition(inconsistent)).toBeNull();
  });

  it('requires a usable source state and a compatible validated anchor', () => {
    expect(cellSemanticVisualState(source, record)).toBe('ready');
    expect(cellSemanticVisualState({ ...source, status: 'stale' }, record))
      .toBe('stale');
    expect(cellSemanticVisualState({ ...source, status: 'syncing' }, record))
      .toBeNull();
    expect(cellSemanticVisualState({
      ...source,
      validated_anchor: { block: 100, hash: `0x${'cc'.repeat(32)}` },
    }, record)).toBeNull();
  });

  it('assigns protocol-family accents without replacing exact identity', () => {
    const asset = (standard: string): SemanticAsset => ({
      type_script_hash: `0x${'22'.repeat(32)}`,
      standard,
    });

    expect(cellSemanticAssetAccent(asset('xUDT'))).toBe('#c8ff72');
    expect(cellSemanticAssetAccent(asset('sUDT'))).toBe('#72ffd4');
    expect(cellSemanticAssetAccent(asset('custom'))).toBe('#d8b4ff');
  });
});
