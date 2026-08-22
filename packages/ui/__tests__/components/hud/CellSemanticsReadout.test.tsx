import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import type {
  CellSemanticRecord,
  SemanticContentDecode,
  SemanticFacet,
} from '@cknerv/types';
import {
  FacetEvidenceRow,
  semanticFacetAttribute,
  semanticFacetNumber,
  semanticFacetValue,
  semanticObjectReadout,
} from '../../../src/components/hud/CellSemanticsReadout';
import { HUD_TYPE } from '../../../src/components/hud/hudTheme';

afterEach(() => cleanup());

/** The DAO facet as it actually crosses the wire: three timestamp keys were
 *  APPENDED after the five it shipped with, which is exactly the case a
 *  positional reader gets wrong. */
const dao: SemanticFacet = {
  namespace: 'ckb',
  kind: 'dao',
  state: 'deposit',
  attributes: [
    { key: 'deposit_block', value: '16204800', unit: 'block' },
    { key: 'compensation', value: '1.25', unit: 'CKB' },
    { key: 'estimated_apc', value: '2.01%' },
    { key: 'deposit_at_ms', value: '1755238020000', unit: 'ms' },
  ],
};

function recordWithDecode(
  deterministic: SemanticContentDecode,
  totalBytes = 6878,
): CellSemanticRecord {
  return {
    out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: 0 },
    source: 'ckbadger',
    as_of: { block: 1, hash: '0xanchor' },
    observed_at_block: 1,
    updated_at_ms: 1,
    content: {
      total_bytes: totalBytes,
      data_complete: true,
      deterministic,
      heuristics: [],
    },
    facets: [],
  };
}

describe('CellSemanticsReadout — facet attributes', () => {
  it('reads a facet attribute by key, never by position', () => {
    expect(semanticFacetAttribute(dao, 'compensation')?.value).toBe('1.25');
    expect(semanticFacetValue(dao, 'compensation')).toBe('1.25 CKB');
    // A key with no unit prints alone rather than trailing an empty space.
    expect(semanticFacetValue(dao, 'estimated_apc')).toBe('2.01%');
    // The appended key is found where a positional read would have skipped it.
    expect(semanticFacetNumber(dao, 'deposit_at_ms')).toBe(1755238020000);
    expect(semanticFacetNumber(dao, 'deposit_block')).toBe(16204800);
  });

  it('says nothing for keys a facet does not carry', () => {
    expect(semanticFacetAttribute(dao, 'withdraw_block')).toBeNull();
    expect(semanticFacetValue(dao, 'withdraw_block')).toBeNull();
    expect(semanticFacetNumber(dao, 'withdraw_at_ms')).toBeNull();
    expect(semanticFacetValue(null, 'deposit_block')).toBeNull();
    expect(semanticFacetNumber(undefined, 'deposit_block')).toBeNull();
  });

  it('refuses to turn an unparseable value into a number', () => {
    // A block height that will not parse is unknown — never zero, which would
    // print as a real anchor at the genesis block.
    expect(semanticFacetNumber(dao, 'estimated_apc')).toBeNull();
  });
});

describe('CellSemanticsReadout — inventory object', () => {
  it('names a Spore by its declared type and size', () => {
    expect(semanticObjectReadout(recordWithDecode({
      kind: 'spore_cell',
      summary: 'Spore content payload',
      segments: [
        {
          label: 'content_type',
          start_byte: 0,
          end_byte: 9,
          meaning: 'Declared MIME type',
          value: 'image/png',
        },
      ],
    }))).toBe('image/png · 6,878 B');
  });

  it('names a cluster, an account and a token by their own segment', () => {
    expect(semanticObjectReadout(recordWithDecode({
      kind: 'spore_cluster_cell',
      summary: 'Spore cluster',
      segments: [
        {
          label: 'cluster_name',
          start_byte: 0,
          end_byte: 4,
          meaning: 'Cluster name',
          value: 'Nervos DOBs',
        },
      ],
    }))).toBe('Nervos DOBs');
    expect(semanticObjectReadout(recordWithDecode({
      kind: 'dotbit_account',
      summary: '.bit account cell',
      segments: [
        {
          label: 'account',
          start_byte: 0,
          end_byte: 8,
          meaning: 'Registered account',
          value: 'satoshi.bit',
        },
      ],
    }))).toBe('satoshi.bit');
    expect(semanticObjectReadout(recordWithDecode({
      kind: 'mnft_token',
      summary: 'mNFT token cell',
      segments: [
        {
          label: 'token_index',
          start_byte: 0,
          end_byte: 4,
          meaning: 'Token index in its class',
          value: '42',
        },
      ],
    }))).toBe('#42');
  });

  it('falls back to the decode\'s own summary when the labels are unknown', () => {
    // ckbadger owns the segment vocabulary. A spelling we have never seen is
    // a reason to quote the source, not to invent a reading of its bytes.
    expect(semanticObjectReadout(recordWithDecode({
      kind: 'spore_cell',
      summary: 'Spore content payload',
      segments: [
        {
          label: 'payload_v2',
          start_byte: 0,
          end_byte: 4,
          meaning: 'Opaque payload',
          value: '…',
        },
      ],
    }, 0))).toBe('Spore content payload');
  });

  it('stays silent for Cells that hold no object', () => {
    // A JSON blob or a DAO deposit has no inventory item; the DATA cluster
    // already prints the decode and the ASSET cluster must not restate it.
    expect(semanticObjectReadout(recordWithDecode({
      kind: 'json_document',
      summary: 'UTF-8 JSON object decoded from Cell data',
      segments: [],
    }))).toBeNull();
    expect(semanticObjectReadout(null)).toBeNull();
    expect(semanticObjectReadout({
      out_point: { tx_hash: '0x00', index: 0 },
      source: 'ckbadger',
      as_of: { block: 1, hash: '0xanchor' },
      observed_at_block: 1,
      updated_at_ms: 1,
      facets: [],
    })).toBeNull();
  });
});

describe('CellSemanticsReadout — facet evidence row', () => {
  it('prints facet values in the body tier with micro labels', () => {
    const { container } = render(<FacetEvidenceRow facet={{
      namespace: 'ckb',
      kind: 'dep_group',
      attributes: [
        { key: 'members', value: '2' },
        { key: 'member_0', value: '0xdep0:0' },
      ],
    }} />);
    const row = container.querySelector(
      '[data-cell-context-facet="ckb:dep_group"]',
    ) as HTMLElement;
    expect(row.textContent).toContain('DEP GROUP');
    expect(row.textContent).toContain('MEMBERS 2');
    const value = row.querySelector('[title="MEMBERS · 2"]') as HTMLElement;
    expect(value.style.fontSize).toBe(`${HUD_TYPE.label}px`);
    expect((value.firstElementChild as HTMLElement).style.fontSize)
      .toBe(`${HUD_TYPE.micro}px`);
  });
});
