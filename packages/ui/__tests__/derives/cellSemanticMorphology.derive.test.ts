import { describe, expect, it } from 'vitest';
import type {
  Cell,
  CellSemanticRecord,
  EnrichmentSourceStatus,
  SemanticScript,
  ShapeSeed,
} from '@cknerv/types';
import { QUALITATIVE_BUCKET_COLORS } from '../../src/components/hud/hudTheme';
import { deriveConsensusBraidTopology } from '../../src/derives/consensusBraid.derive';
import { segmentColorSlots } from '../../src/derives/cellDataReader.derive';
import {
  cellSemanticCollectionIdentity,
  deriveCellSemanticMorphologyOverlay,
  semanticScriptShapeSeed,
  validateCellSemanticRecordForMorphology,
} from '../../src/derives/cellSemanticMorphology.derive';

const LOCK_SEED: ShapeSeed = [0x0123_4567, 0x89ab_cdef];
const TYPE_SEED: ShapeSeed = [0x7654_3210, 0xfedc_ba98];

const CELL: Cell = {
  id: 77,
  born_at_ms: 0,
  death_at_ms: null,
  birth_block: 100,
  tag: null,
  pos_seed: [0, 0, 0],
  out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: 2 },
  capacity: 8_000e8,
  data_hex: `0x${'11'.repeat(16)}`,
  data_bytes: 16,
  content_hash: `0x${'cd'.repeat(32)}`,
  lock_shape_seed: LOCK_SEED,
  type_shape_seed: TYPE_SEED,
  data_shape_seed: [3, 4],
  lock_kind: 'omnilock',
  asset_kind: 'xudt',
};

function scriptHash(seed: ShapeSeed): string {
  return `0x${seed[0].toString(16).padStart(8, '0')}`
    + `${seed[1].toString(16).padStart(8, '0')}${'00'.repeat(24)}`;
}

function script(seed: ShapeSeed, name: string): SemanticScript {
  return {
    script_hash: scriptHash(seed),
    code_hash: `0x${'44'.repeat(32)}`,
    hash_type: 'type',
    args: '0x1234',
    name,
    family: 'known',
  };
}

const ANCHOR = { block: 120, hash: `0x${'ef'.repeat(32)}` };

const SOURCE: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['cell_detail'],
  validated_anchor: ANCHOR,
};

const RECORD: CellSemanticRecord = {
  out_point: CELL.out_point,
  source: 'ckbadger',
  as_of: ANCHOR,
  observed_at_block: CELL.birth_block,
  updated_at_ms: 1,
  lock_script: script(LOCK_SEED, 'OmniLock'),
  type_script: script(TYPE_SEED, 'xUDT'),
  common_knowledge: {
    total_bytes: 130,
    capacity_field_bytes: 8,
    lock_script_bytes: 53,
    type_script_bytes: 53,
    data_bytes: 16,
  },
  content: {
    total_bytes: 16,
    data_complete: true,
    deterministic: {
      kind: 'pair',
      summary: 'two exact words',
      segments: [
        { label: 'right', start_byte: 8, end_byte: 16, meaning: 'word', value: '2' },
        { label: 'left', start_byte: 0, end_byte: 8, meaning: 'word', value: '1' },
      ],
    },
    heuristics: [{ kind: 'text', confidence: 'low', reason: 'ignored' }],
  },
  facets: [{ namespace: 'ckb', kind: 'dao', state: 'deposit', attributes: [] }],
};

describe('ckbadger portrait morphology overlay', () => {
  it('converts the indexed script hash with the adapter-pinned byte order', () => {
    expect(semanticScriptShapeSeed(scriptHash(LOCK_SEED))).toEqual(LOCK_SEED);
    expect(semanticScriptShapeSeed('0x1234')).toBeNull();
  });

  it('accepts only a ready record anchored to the active source proof', () => {
    expect(validateCellSemanticRecordForMorphology({
      cell: CELL,
      record: RECORD,
      source: SOURCE,
      phase: 'ready',
    })).toEqual({ status: 'valid', record: RECORD, message: null });

    expect(validateCellSemanticRecordForMorphology({
      cell: CELL,
      record: RECORD,
      source: { ...SOURCE, status: 'stale' },
      phase: 'ready',
    }).status).toBe('inactive');
    expect(validateCellSemanticRecordForMorphology({
      cell: CELL,
      record: null,
      source: SOURCE,
      phase: 'ready',
    }).status).toBe('absent');
  });

  it('derives exact content rails and occupied arcs without changing base topology', () => {
    const before = deriveConsensusBraidTopology(CELL);
    const overlay = deriveCellSemanticMorphologyOverlay(CELL, RECORD);
    const after = deriveConsensusBraidTopology(CELL);

    expect(after).toEqual(before);
    expect(overlay).not.toBeNull();
    expect(overlay?.scriptLabels.map((label) => [label.role, label.text])).toEqual([
      ['lock', 'OmniLock'],
      ['type', 'xUDT'],
    ]);
    expect(overlay?.dataSegments.map((segment) => [
      segment.label,
      segment.start,
      segment.end,
    ])).toEqual([
      ['left', 0, 0.5],
      ['right', 0.5, 1],
    ]);
    expect(overlay?.knowledgeSegments.map((segment) => segment.role)).toEqual([
      'capacity', 'lock', 'type', 'data',
    ]);
    expect(overlay?.roleGlyphs[0]?.role).toBe('dao');
  });

  it('colours its byte segments by the rule every other surface asks', () => {
    // The ring had a rule of its own — a private FNV-1a into four of the
    // qualitative ramp's six slots — while the DATA window beside it coloured
    // the very same segments by their position in the record's list. So one
    // Cell's `left` word was one colour on the portrait and another in the
    // window, and nothing in either file said which was right.
    //
    // Asserted against the rule rather than against numbers: `colorIndex` is
    // now whatever `segmentColorSlots` says, which is the whole claim. What
    // the rule itself computes is pinned in `cellDataReader.derive.test.ts`,
    // against an independent implementation of FNV-1a.
    const segments = RECORD.content!.deterministic!.segments;
    const slots = segmentColorSlots(segments);
    const overlay = deriveCellSemanticMorphologyOverlay(CELL, RECORD);

    // The overlay sorts into byte order; the slots come back at the record's
    // own indices, which is exactly the ordering independence the shared rule
    // promises.
    expect(overlay?.dataSegments.map((segment) => [segment.label, segment.colorIndex]))
      .toEqual([
        ['left', slots[segments.findIndex((entry) => entry.label === 'left')]],
        ['right', slots[segments.findIndex((entry) => entry.label === 'right')]],
      ]);

    // …and the ring can now reach the ramp's fifth and sixth slots, which the
    // `% 4` it replaced could not: two of the six colours were unreachable on
    // this surface and reachable in the window, which is one more way the two
    // could not have agreed.
    const highSlot: CellSemanticRecord = {
      ...RECORD,
      content: {
        ...RECORD.content!,
        deterministic: {
          kind: 'molecule',
          summary: 'one header word',
          segments: [{
            label: 'total_size',
            start_byte: 0,
            end_byte: 16,
            meaning: 'Molecule table total size (u32 LE)',
            value: '16',
          }],
        },
      },
    };
    const high = deriveCellSemanticMorphologyOverlay(CELL, highSlot);
    expect(high?.dataSegments[0]?.colorIndex).toBeGreaterThan(3);
    expect(high?.dataSegments[0]?.colorIndex)
      .toBeLessThan(QUALITATIVE_BUCKET_COLORS.length);
  });

  it('never promotes heuristic guesses into overlay geometry', () => {
    const heuristicsOnly: CellSemanticRecord = {
      ...RECORD,
      lock_script: undefined,
      type_script: undefined,
      common_knowledge: undefined,
      content: {
        total_bytes: CELL.data_bytes,
        data_complete: false,
        heuristics: [{ kind: 'image', confidence: 'high', reason: 'guess' }],
      },
      facets: [],
    };
    expect(deriveCellSemanticMorphologyOverlay(CELL, heuristicsOnly)).toBeNull();
  });

  it('suppresses a script-seed mismatch and reports it as semantic error', () => {
    const mismatched: CellSemanticRecord = {
      ...RECORD,
      lock_script: script([0xaaaa_aaaa, 0xbbbb_bbbb], 'Wrong lock'),
    };
    const validation = validateCellSemanticRecordForMorphology({
      cell: CELL,
      record: mismatched,
      source: SOURCE,
      phase: 'ready',
    });
    expect(validation.status).toBe('mismatch');
    expect(validation.message).toContain('lock script identity');
    expect(deriveCellSemanticMorphologyOverlay(CELL, mismatched)).toBeNull();
  });

  it('withdraws overlays on removal and rejects mismatched exact byte ranges', () => {
    expect(deriveCellSemanticMorphologyOverlay(CELL, null)).toBeNull();
    const invalidRange: CellSemanticRecord = {
      ...RECORD,
      content: {
        ...RECORD.content!,
        deterministic: {
          kind: 'bad',
          summary: 'bad',
          segments: [{
            label: 'overflow',
            start_byte: 0,
            end_byte: CELL.data_bytes + 1,
            meaning: 'bad',
            value: 'bad',
          }],
        },
      },
    };
    expect(validateCellSemanticRecordForMorphology({
      cell: CELL,
      record: invalidRange,
      source: SOURCE,
      phase: 'ready',
    }).status).toBe('mismatch');
    expect(deriveCellSemanticMorphologyOverlay(CELL, invalidRange)).toBeNull();
  });
});

describe('cellSemanticCollectionIdentity', () => {
  function recordWith(overrides: Partial<CellSemanticRecord>): CellSemanticRecord {
    return {
      out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: 0 },
      source: 'ckbadger',
      as_of: { block_number: 1, block_hash: `0x${'11'.repeat(32)}` },
      observed_at_block: 1,
      updated_at_ms: 0,
      facets: [],
      ...overrides,
    } as CellSemanticRecord;
  }

  function decode(label: string, value: string): Partial<CellSemanticRecord> {
    return {
      content: {
        total_bytes: 64,
        deterministic: {
          kind: 'spore',
          summary: 'a spore',
          segments: [{
            label,
            meaning: 'collection',
            value,
            start_byte: 0,
            end_byte: 8,
          }],
        },
      },
    } as Partial<CellSemanticRecord>;
  }

  it('reads a named cluster out of the decode, whatever it is spelled', () => {
    for (const label of ['cluster_name', 'cluster', 'collection', 'Cluster-Name']) {
      expect(cellSemanticCollectionIdentity(recordWith(decode(label, 'Nervape'))))
        .toBe('cluster:Nervape');
    }
  });

  it('falls back to the asset name and never to the standard', () => {
    expect(cellSemanticCollectionIdentity(recordWith({
      asset: { type_script_hash: `0x${'cd'.repeat(32)}`, name: 'Azuki', standard: 'm_nft' },
    }))).toBe('asset:Azuki');

    // A standard is not a collection: tinting every m-nft alike would claim a
    // kinship the chain never stated.
    expect(cellSemanticCollectionIdentity(recordWith({
      asset: { type_script_hash: `0x${'cd'.repeat(32)}`, standard: 'm_nft' },
    }))).toBeNull();
  });

  it('prefers the decoded cluster over the asset name', () => {
    expect(cellSemanticCollectionIdentity(recordWith({
      ...decode('cluster_name', 'Nervape'),
      asset: { type_script_hash: `0x${'cd'.repeat(32)}`, name: 'Azuki' },
    }))).toBe('cluster:Nervape');
  });

  it('namespaces so a cluster cannot be confused with an asset', () => {
    expect(cellSemanticCollectionIdentity(recordWith(decode('cluster', 'cota'))))
      .not.toBe(cellSemanticCollectionIdentity(recordWith({
        asset: { type_script_hash: `0x${'cd'.repeat(32)}`, name: 'cota' },
      })));
  });

  it('says nothing when there is nothing to say', () => {
    expect(cellSemanticCollectionIdentity(null)).toBeNull();
    expect(cellSemanticCollectionIdentity(undefined)).toBeNull();
    expect(cellSemanticCollectionIdentity(recordWith({}))).toBeNull();
    expect(cellSemanticCollectionIdentity(recordWith(decode('cluster_name', '   '))))
      .toBeNull();
  });
});
