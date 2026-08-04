import { describe, expect, it } from 'vitest';

import type {
  CellSemanticRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import {
  applyRevisionedSemanticsDeltas,
  emptySemanticsCache,
  outPointKey,
} from '../src/semanticsReducer';

const ready: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['cell_detail'],
  validated_anchor: { block: 10, hash: '0xblock10' },
};

function cell(block: number, txHash: string): CellSemanticRecord {
  return {
    out_point: { tx_hash: txHash, index: 0 },
    source: 'ckbadger',
    as_of: { block, hash: `0xblock${block}` },
    observed_at_block: block,
    updated_at_ms: block,
    facets: [],
  };
}

describe('semantics reducer', () => {
  it('keeps its own revision and upserts selected Cell context', () => {
    const record = cell(10, '0xcell');
    const next = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [
      { revision: 1, delta: { type: 'source_status', source: ready } },
      { revision: 2, delta: { type: 'cell_upsert', cell: record } },
    ]);

    expect(next.revision).toBe(2);
    expect(next.source.status).toBe('ready');
    expect(next.cells.get(outPointKey(record.out_point))).toBe(record);
  });

  it('prunes reorg-unsafe records while preserving older semantics', () => {
    const old = cell(9, '0xold');
    const orphan = cell(10, '0xorphan');
    const seeded = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [
      { revision: 1, delta: { type: 'cell_upsert', cell: old } },
      { revision: 2, delta: { type: 'cell_upsert', cell: orphan } },
    ]);
    const next = applyRevisionedSemanticsDeltas(seeded, [
      { revision: 3, delta: { type: 'prune', from_block: 10 } },
    ]);

    expect([...next.cells.keys()]).toEqual([outPointKey(old.out_point)]);
  });

  it('clear does not erase source health', () => {
    const seeded = applyRevisionedSemanticsDeltas(emptySemanticsCache(), [
      { revision: 1, delta: { type: 'source_status', source: ready } },
      { revision: 2, delta: { type: 'cell_upsert', cell: cell(10, '0xcell') } },
    ]);
    const next = applyRevisionedSemanticsDeltas(seeded, [
      { revision: 3, delta: { type: 'clear' } },
    ]);

    expect(next.source.status).toBe('ready');
    expect(next.cells.size).toBe(0);
  });
});
