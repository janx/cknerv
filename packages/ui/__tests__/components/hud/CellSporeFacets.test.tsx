// A digital object's value rests on two questions its Cell cannot answer:
// whose collection it belongs to, and where its content physically lives. Both
// arrive as enrichment facets, and both are stated one attribute at a time —
// the cluster index can be down while the object index is up, and either half
// surviving still has something true to say. So these are ROW MATRIX tests: for
// each shape the wire actually produces, exactly which rows exist, what they
// say, and what colour they say it in.
//
// They live in their own file rather than in `CellDetailPanel.test.tsx`, whose
// lattice-clock assertions are order-sensitive: a test added there that resizes
// or reorders its neighbours makes an unrelated one flake red.

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type {
  Cell,
  CellSemanticRecord,
  SemanticFacet,
} from '@cknerv/types';

vi.mock('../../../src/components/hud/CellNucleusPortrait', async () => {
  const { memo } = await import('react');
  return {
    default: memo(() => <div data-testid="cell-nucleus-portrait" />),
  };
});

import CellDetailPanel from '../../../src/components/hud/CellDetailPanel';
import {
  compositionTierColor,
  compositionTierDescription,
  compositionTierLabel,
  FacetEvidenceRow,
} from '../../../src/components/hud/CellSemanticsReadout';
import { HUD_COLORS } from '../../../src/components/hud/hudTheme';

afterEach(() => cleanup());

/** jsdom hands inline colours back in `rgb()` form. */
function rgbOf(hex: string): string {
  const h = hex.replace('#', '');
  const channel = (at: number) => parseInt(h.slice(at, at + 2), 16);
  return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
}

const CLUSTER_ID = `0x${'51bf'.repeat(16)}`;

/** A crafted Cell: it carries a type script, which is what gives the register
 *  its CODE row and makes the enrichment slot beneath it real. */
const spore: Cell = {
  id: 8811, born_at_ms: 0, death_at_ms: null, birth_block: 16204800,
  tag: 'object', pos_seed: [0, 0, 0],
  out_point: { tx_hash: `0x${'cd'.repeat(32)}`, index: 0 },
  capacity: 30000000000, data_hex: '0xdeadbeef',
  data_bytes: 6878,
  content_hash: `0x${'22'.repeat(32)}`,
  lock_kind: 'sighash', asset_kind: 'object',
  lock_shape_seed: [1, 2], type_shape_seed: [5, 6], data_shape_seed: [3, 4],
  type_script: { code_hash: `0x${'4a'.repeat(32)}`, hash_type: 'data1' },
};

function collectionFacet(
  attributes: SemanticFacet['attributes'],
  state?: string,
): SemanticFacet {
  return { namespace: 'spore', kind: 'collection', state, attributes };
}

function compositionFacet(
  attributes: SemanticFacet['attributes'],
  state?: string,
): SemanticFacet {
  return { namespace: 'spore', kind: 'composition', state, attributes };
}

/** The whole population as ckbadger states it: an on-chain count that already
 *  includes the BTC+CKB objects, the pure subset inside it, and the three
 *  tiers beside it. There is no separate BTC count on the wire. */
const AGGREGATE_COUNTS: SemanticFacet['attributes'] = [
  { key: 'agg_tier', value: 'centralized_mixture' },
  { key: 'agg_onchain', value: '1010' },
  { key: 'agg_pure_ckb', value: '980' },
  { key: 'agg_decentralized', value: '12' },
  { key: 'agg_centralized', value: '2' },
  { key: 'agg_unknown', value: '0' },
];

function record(
  facets: SemanticFacet[],
  overrides: Partial<CellSemanticRecord> = {},
): CellSemanticRecord {
  return {
    out_point: spore.out_point,
    source: 'ckbadger',
    as_of: { block: spore.birth_block, hash: '0xanchor' },
    observed_at_block: spore.birth_block,
    updated_at_ms: 1,
    facets,
    ...overrides,
  };
}

/** The decoded object itself, so the OBJECT row exists and the two new rows
 *  around it can be checked for their PLACE as well as their content. */
const sporeContent: CellSemanticRecord['content'] = {
  total_bytes: spore.data_bytes,
  data_complete: true,
  deterministic: {
    kind: 'spore_cell',
    summary: 'Spore digital object',
    segments: [
      {
        label: 'content_type',
        start_byte: 0,
        end_byte: 9,
        meaning: 'SporeData content type',
        value: 'image/png',
      },
      {
        label: 'cluster_id',
        start_byte: 9,
        end_byte: 41,
        meaning: 'SporeData cluster reference',
        value: CLUSTER_ID,
      },
    ],
  },
  heuristics: [],
};

function renderPanel(semanticRecord: CellSemanticRecord) {
  return render(
    <CellDetailPanel
      cell={spore}
      onClose={() => {}}
      semanticSource={{
        source: 'ckbadger',
        status: 'ready',
        capabilities: ['cell_detail'],
        lag_blocks: 1,
      }}
      semanticPhase="ready"
      semanticRecord={semanticRecord}
    />,
  );
}

/** The enrichment rows of the type register, in the order they are read. */
function evidenceRows(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(
    '[data-cell-evidence-slot="type"] [data-cell-evidence-row]',
  )).map((row) => row.getAttribute('data-cell-evidence-row') ?? '');
}

function row(container: HTMLElement, name: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `[data-cell-evidence-row="${name}"]`,
  );
}

function value(container: HTMLElement, name: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    `[data-cell-evidence-value="${name}"]`,
  );
  if (!element) throw new Error(`no ${name} value in the register`);
  return element;
}

describe('composition tier vocabulary', () => {
  it('speaks ckbadger\'s five tiers in HUD type, colour and sentence', () => {
    expect(compositionTierLabel('pure_ckb')).toBe('PURE CKB');
    expect(compositionTierColor('pure_ckb')).toBe(HUD_COLORS.nominal);
    expect(compositionTierDescription('pure_ckb')).toBe(
      'All content is stored directly on the CKB blockchain (on-chain data or ckbfs://). Fully verifiable and permanent.',
    );

    expect(compositionTierLabel('btc_ckb')).toBe('BTC+CKB');
    expect(compositionTierColor('btc_ckb')).toBe(HUD_COLORS.cyanWire);
    expect(compositionTierDescription('btc_ckb')).toBe(
      'Content is stored across both CKB (on-chain data or ckbfs://) and Bitcoin (btcfs://). Fully verifiable and permanent.',
    );

    expect(compositionTierLabel('decentralized_mixture'))
      .toBe('DECENTRALIZED MIXTURE');
    expect(compositionTierColor('decentralized_mixture'))
      .toBe(HUD_COLORS.caution);
    expect(compositionTierDescription('decentralized_mixture')).toBe(
      'Some content references external decentralized storage (e.g. IPFS, Arweave). Data persists as long as the external network hosts it.',
    );

    expect(compositionTierLabel('centralized_mixture'))
      .toBe('CENTRALIZED MIXTURE');
    // The ember family, never red: an object leaning on somebody's server is a
    // weaker promise, not a fault. Red stays reserved for pathology.
    expect(compositionTierColor('centralized_mixture')).toBe(HUD_COLORS.ember);
    expect(compositionTierColor('centralized_mixture'))
      .not.toBe(HUD_COLORS.danger);
    expect(compositionTierDescription('centralized_mixture')).toBe(
      'Some content depends on centralized servers (http/https). Data availability relies on the server operator.',
    );

    expect(compositionTierLabel('unknown')).toBe('UNKNOWN');
    expect(compositionTierColor('unknown')).toBe(HUD_COLORS.dim);
    expect(compositionTierDescription('unknown')).toBe(
      'Composition could not be determined. The content storage method for objects in this cluster is unverified.',
    );
  });

  it('names both spore kinds where a facet is summarized generically', () => {
    // The register spells these out and suppresses the generic row, so this is
    // the naming any OTHER surface would read — untitled, `collection` would
    // have arrived there as the raw wire word.
    const { container } = render(
      <FacetEvidenceRow facet={collectionFacet(
        [{ key: 'role', value: 'item' }],
        'Nervape Gen2',
      )} />,
    );
    expect(container.textContent).toContain('COLLECTION');
    cleanup();

    const composition = render(
      <FacetEvidenceRow facet={compositionFacet(
        [{ key: 'item_tier', value: 'pure_ckb' }],
        'pure_ckb',
      )} />,
    );
    expect(composition.container.textContent).toContain('COMPOSITION');
  });

  it('renders a tier it has never seen instead of failing on it', () => {
    // The index owns this vocabulary. A sixth spelling is a word this side has
    // not learned, which reads raw and unestablished — never a decode failure.
    expect(compositionTierLabel('quantum_mixture')).toBe('QUANTUM MIXTURE');
    expect(compositionTierColor('quantum_mixture')).toBe(HUD_COLORS.dim);
    expect(compositionTierDescription('quantum_mixture'))
      .toBe(compositionTierDescription('unknown'));

    // A wire string naming something on `Object.prototype` is an unknown tier
    // like any other, not a truthy table hit with nothing inside it.
    expect(compositionTierLabel('constructor')).toBe('CONSTRUCTOR');
    expect(compositionTierColor('constructor')).toBe(HUD_COLORS.dim);
    expect(compositionTierDescription('constructor'))
      .toBe(compositionTierDescription('unknown'));
  });
});

describe('CellDetailPanel — spore kin and storage', () => {
  it('spells out a clustered object: kin, id, population, mix, own storage', () => {
    const { container } = renderPanel(record([
      collectionFacet([
        { key: 'role', value: 'item' },
        { key: 'cluster_id', value: CLUSTER_ID },
        { key: 'live_items', value: '1024' },
        { key: 'holders', value: '210' },
        { key: 'owned_capacity', value: '109067222027837', unit: 'shannons' },
        { key: 'description', value: 'A generative collection of 1024 objects.' },
      ], 'Nervape Gen2'),
      compositionFacet([
        { key: 'item_tier', value: 'pure_ckb' },
        ...AGGREGATE_COUNTS,
      ], 'pure_ckb'),
    ], { content: sporeContent }));

    // Collection facts, then the object, then where the object's bytes live.
    expect(evidenceRows(container)).toEqual([
      'collection', 'cluster-id', 'population', 'composition', 'object',
      'storage',
    ]);

    // The name is a value, in the house's value-emphasis ink.
    expect(value(container, 'collection').textContent).toBe('Nervape Gen2');
    expect(value(container, 'collection').style.color)
      .toBe(rgbOf(HUD_COLORS.goldInk));
    expect(value(container, 'collection').getAttribute('title'))
      .toBe('A generative collection of 1024 objects.');

    // The id is forensics: truncated on the row, whole in the title.
    expect(value(container, 'cluster-id').textContent)
      .toBe('0x51bf51bf51…f51bf51bf');
    expect(value(container, 'cluster-id').getAttribute('title'))
      .toBe(CLUSTER_ID);

    expect(value(container, 'population').textContent)
      .toBe('1,024 LIVE · 210 HOLDERS · 1.09 M CKB');

    // The population's mix reads as the aggregate tier, colour-coded, with the
    // counts — never a ratio and never a percentage — as its provenance.
    expect(value(container, 'composition').textContent)
      .toBe('CENTRALIZED MIXTURE');
    expect(value(container, 'composition').style.color)
      .toBe(rgbOf(HUD_COLORS.ember));
    expect(value(container, 'composition').getAttribute('title')).toBe(
      'Some content depends on centralized servers (http/https). Data availability relies on the server operator. on-chain 1,010 (pure 980) · decentralized 12 · centralized 2 · unknown 0',
    );
    expect(value(container, 'composition').getAttribute('title'))
      .not.toMatch(/%|ratio/i);

    // This object's own storage is a different fact from its collection's.
    expect(value(container, 'storage').textContent).toBe('PURE CKB');
    expect(value(container, 'storage').style.color)
      .toBe(rgbOf(HUD_COLORS.nominal));
    expect(value(container, 'storage').getAttribute('title')).toBe(
      'All content is stored directly on the CKB blockchain (on-chain data or ckbfs://). Fully verifiable and permanent.',
    );
    expect(container.querySelector('[data-cell-storage-issues]')).toBeNull();

    expect(row(container, 'object')?.textContent)
      .toBe('OBJECTimage/png · 6,878 B');
  });

  it('states a locked capacity in the house CKB grammar, never in shannons', () => {
    const { container } = renderPanel(record([
      collectionFacet([
        { key: 'role', value: 'cluster' },
        { key: 'owned_capacity', value: '109067222027837', unit: 'shannons' },
      ], 'Nervape Gen2'),
    ]));

    expect(value(container, 'population').textContent).toBe('1.09 M CKB');
    // `semanticFacetValue` would have appended the unit here; the row reads the
    // attribute itself precisely so it cannot.
    expect(container.textContent).not.toContain('shannons');
    expect(container.textContent).not.toContain('109067222027837');
  });

  it('withholds a capacity that will not parse rather than printing a zero', () => {
    const { container } = renderPanel(record([
      collectionFacet([
        { key: 'role', value: 'cluster' },
        { key: 'live_items', value: '1024' },
        { key: 'owned_capacity', value: 'not-a-number', unit: 'shannons' },
      ]),
    ]));

    // Read off the row itself: the CAPACITY fact elsewhere on the card is a
    // real CKB figure, and a card-wide text search would find that instead.
    expect(value(container, 'population').textContent).toBe('1,024 LIVE');
    expect(value(container, 'population').textContent).not.toContain('CKB');
  });

  it('flags an object whose content the index could not fully read', () => {
    const { container } = renderPanel(record([
      compositionFacet([
        { key: 'item_tier', value: 'decentralized_mixture' },
        { key: 'item_issues', value: '2' },
      ], 'decentralized_mixture'),
    ]));

    expect(value(container, 'storage').textContent)
      .toBe('DECENTRALIZED MIXTURE');
    expect(value(container, 'storage').style.color)
      .toBe(rgbOf(HUD_COLORS.caution));
    const chip = container.querySelector<HTMLElement>(
      '[data-cell-storage-issues="2"]',
    );
    expect(chip?.textContent).toBe('2 ISSUES');
    expect(chip?.style.color).toBe(rgbOf(HUD_COLORS.caution));
    // The count is in the provenance too, so a hover explains the chip.
    expect(value(container, 'storage').getAttribute('title')).toBe(
      'Some content references external decentralized storage (e.g. IPFS, Arweave). Data persists as long as the external network hosts it. 2 content issues reported by the index.',
    );
  });

  it('states solitude as a fact rather than as a missing name', () => {
    const { container } = renderPanel(record([
      collectionFacet([{ key: 'role', value: 'sole_item' }]),
      compositionFacet([{ key: 'item_tier', value: 'pure_ckb' }], 'pure_ckb'),
    ]));

    expect(evidenceRows(container)).toEqual(['collection', 'storage']);
    expect(value(container, 'collection').textContent).toBe('SOLE SPORE');
    // Instrument grey: there is no collection here to emphasise.
    expect(value(container, 'collection').style.color)
      .toBe(rgbOf(HUD_COLORS.dim));
    expect(value(container, 'collection').style.color)
      .not.toBe(rgbOf(HUD_COLORS.goldInk));
  });

  it('lets a cluster Cell state its population and mix, and nothing twice', () => {
    const { container } = renderPanel(record([
      collectionFacet([
        { key: 'role', value: 'cluster' },
        { key: 'cluster_id', value: CLUSTER_ID },
        { key: 'live_items', value: '1024' },
        { key: 'holders', value: '210' },
      ], 'Nervape Gen2'),
      compositionFacet(AGGREGATE_COUNTS, 'centralized_mixture'),
    ]));

    // The cluster's name is already its OBJECT row and its id is already its
    // ARGS row; a COLLECTION or CLUSTER row here would say both a second time.
    expect(evidenceRows(container)).toEqual(['population', 'composition']);
    expect(value(container, 'population').textContent)
      .toBe('1,024 LIVE · 210 HOLDERS');
    expect(value(container, 'composition').textContent)
      .toBe('CENTRALIZED MIXTURE');
    // A cluster Cell holds no media of its own, so it claims no storage tier.
    expect(row(container, 'storage')).toBeNull();
  });

  it('names the kin by id when the collection index is down', () => {
    const { container } = renderPanel(record([
      collectionFacet([
        { key: 'role', value: 'item' },
        { key: 'cluster_id', value: CLUSTER_ID },
      ]),
    ]));

    // Nothing was established about the population, so nothing is claimed —
    // and the id takes the COLLECTION row rather than being printed on two
    // consecutive rows saying the same string.
    expect(evidenceRows(container)).toEqual(['collection']);
    expect(value(container, 'collection').textContent)
      .toBe('0x51bf51bf51…f51bf51bf');
    expect(value(container, 'collection').style.color)
      .toBe(rgbOf(HUD_COLORS.goldInk));
    expect(value(container, 'collection').getAttribute('title'))
      .toBe(CLUSTER_ID);
  });

  it('admits an unresolved collection instead of inventing one', () => {
    const { container } = renderPanel(record([
      collectionFacet([{ key: 'role', value: 'item' }]),
    ]));

    expect(value(container, 'collection').textContent).toBe('UNRESOLVED');
    expect(value(container, 'collection').style.color)
      .toBe(rgbOf(HUD_COLORS.dim));
    expect(container.textContent).not.toContain('SOLE SPORE');
  });

  it('never reads an absent collection facet as solitude', () => {
    // The decode named no cluster either way: kinship is UNKNOWN, and the one
    // thing the panel may not do is state that as "this object has no kin".
    const { container } = renderPanel(record([
      compositionFacet([{ key: 'item_tier', value: 'btc_ckb' }], 'btc_ckb'),
    ]));

    expect(evidenceRows(container)).toEqual(['storage']);
    expect(value(container, 'storage').textContent).toBe('BTC+CKB');
    expect(value(container, 'storage').style.color)
      .toBe(rgbOf(HUD_COLORS.cyanWire));
    expect(container.textContent).not.toContain('SOLE SPORE');
    expect(row(container, 'collection')).toBeNull();
  });

  it('lists whichever aggregate counts arrived, and no others', () => {
    const { container } = renderPanel(record([
      collectionFacet([
        { key: 'role', value: 'cluster' },
        { key: 'live_items', value: '7' },
      ]),
      compositionFacet([
        { key: 'agg_tier', value: 'pure_ckb' },
        { key: 'agg_onchain', value: '7' },
      ], 'pure_ckb'),
    ]));

    expect(value(container, 'composition').getAttribute('title')).toBe(
      'All content is stored directly on the CKB blockchain (on-chain data or ckbfs://). Fully verifiable and permanent. on-chain 7',
    );
  });

  it('does not print the spore facets a second time as a generic summary', () => {
    // `primarySemanticFacet` falls back to the record's FIRST facet, so a kind
    // spelled out row by row that is not excluded from the generic slot renders
    // twice — once as its rows, once as a one-liner underneath them.
    const { container } = renderPanel(record([
      collectionFacet([
        { key: 'role', value: 'item' },
        { key: 'cluster_id', value: CLUSTER_ID },
      ], 'Nervape Gen2'),
      compositionFacet([{ key: 'item_tier', value: 'pure_ckb' }], 'pure_ckb'),
    ]));

    expect(container.querySelector('[data-cell-context-facet="spore:collection"]'))
      .toBeNull();
    expect(container.querySelector('[data-cell-context-facet="spore:composition"]'))
      .toBeNull();
    expect(container.querySelector('[data-cell-context-facet]')).toBeNull();
    // The rows themselves are still there — suppression is of the duplicate.
    expect(evidenceRows(container))
      .toEqual(['collection', 'cluster-id', 'storage']);
  });
});
