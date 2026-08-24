// A digital object's value rests on two questions its Cell cannot answer:
// whose collection it belongs to, and where its content physically lives. Both
// arrive as enrichment facets, and both are stated one attribute at a time —
// the collection index can be down while the object index is up, and either
// half surviving still has something true to say. So these are ROW MATRIX
// tests: for each shape the wire actually produces, exactly which rows and
// blocks exist, what they say, and what colour they say it in.
//
// Two families reach this register, `spore` and `mnft`, and they arrive as the
// same two KINDS under different namespaces. Every read here is by kind — a
// filter on the namespace is how the panel silently dropped m-NFT for a
// release — and the namespace is a label and nothing else.
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
import { STORAGE_TIER_COLORS } from '../../../src/components/hud/cellFormat';
import { HUD_COLORS } from '../../../src/components/hud/hudTheme';

afterEach(() => cleanup());

/** jsdom hands inline colours back in `rgb()` form. */
function rgbOf(hex: string): string {
  const h = hex.replace('#', '');
  const channel = (at: number) => parseInt(h.slice(at, at + 2), 16);
  return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
}

/** …and a tint in `rgba()`, spaced the way cssstyle re-serializes it. */
function rgbaOf(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const channel = (at: number) => parseInt(h.slice(at, at + 2), 16);
  return `rgba(${channel(0)}, ${channel(2)}, ${channel(4)}, ${alpha})`;
}

/** A spore cluster: 32 bytes. */
const CLUSTER_ID = `0x${'51bf'.repeat(16)}`;
/** An m-NFT class: a 20-byte issuer and a 4-byte class, and nothing after. */
const CLASS_ID = `0x${'7a'.repeat(20)}b1c2d3e4`;

/** A crafted Cell: it carries a type script, which is what gives the register
 *  its CODE row and makes the enrichment slot beneath it real. */
const objectCell: Cell = {
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
  namespace = 'spore',
): SemanticFacet {
  return { namespace, kind: 'collection', state, attributes };
}

function compositionFacet(
  attributes: SemanticFacet['attributes'],
  state?: string,
  namespace = 'spore',
): SemanticFacet {
  return { namespace, kind: 'composition', state, attributes };
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

/** The same census printed two ways: every count for the hover, and only the
 *  tiers that hold something for the line a reader actually sees. */
const AGGREGATE_TITLE_COUNTS =
  'on-chain 1,010 (pure 980) · decentralized 12 · centralized 2 · unknown 0';
const AGGREGATE_VISIBLE_COUNTS =
  '1,010 ON-CHAIN (980 PURE) · 12 DECENTRALIZED · 2 CENTRALIZED';

function record(
  facets: SemanticFacet[],
  overrides: Partial<CellSemanticRecord> = {},
): CellSemanticRecord {
  return {
    out_point: objectCell.out_point,
    source: 'ckbadger',
    as_of: { block: objectCell.birth_block, hash: '0xanchor' },
    observed_at_block: objectCell.birth_block,
    updated_at_ms: 1,
    facets,
    ...overrides,
  };
}

/** The decoded object itself, so the OBJECT row exists and the block under it
 *  can be checked for its PLACE as well as its content. */
const sporeContent: CellSemanticRecord['content'] = {
  total_bytes: objectCell.data_bytes,
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

/** An m-NFT token names no class in its data — the class is in the type script
 *  args, which is why the adapter derives it there. Its decode carries the
 *  token's own serial, and that is the OBJECT row. */
const mnftContent: CellSemanticRecord['content'] = {
  total_bytes: 21,
  data_complete: true,
  deterministic: {
    kind: 'mnft_token_cell',
    summary: 'm-NFT token',
    segments: [
      {
        label: 'token_id',
        start_byte: 0,
        end_byte: 4,
        meaning: 'mNFT token index',
        value: '812',
      },
    ],
  },
  heuristics: [],
};

function renderPanel(semanticRecord: CellSemanticRecord) {
  return render(
    <CellDetailPanel
      cell={objectCell}
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

/** The enrichment stack of the type register, in the order it is read: every
 *  evidence row by name, and the composition block among them, so a test that
 *  states a matrix states the block's PLACE in it too. */
function evidenceStack(container: HTMLElement): string[] {
  const slot = container.querySelector('[data-cell-evidence-slot="type"]');
  return Array.from(slot?.children ?? []).map((node) => (
    node.getAttribute('data-cell-evidence-row')
      ?? (node.hasAttribute('data-cell-composition-block')
        ? 'composition-block'
        : `unnamed:${node.nodeName.toLowerCase()}`)
  ));
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

function block(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-cell-composition-block]');
}

function statedBlock(container: HTMLElement): HTMLElement {
  const element = block(container);
  if (!element) throw new Error('no composition block in the register');
  return element;
}

/** What the block says, line by line. */
function blockTier(container: HTMLElement): HTMLElement {
  const element = statedBlock(container)
    .querySelector<HTMLElement>('[data-cell-composition-tier]');
  if (!element) throw new Error('the composition block names no tier');
  return element;
}

function blockCounts(container: HTMLElement): HTMLElement | null {
  return statedBlock(container)
    .querySelector<HTMLElement>('[data-cell-composition-counts]');
}

describe('composition tier vocabulary', () => {
  it('speaks ckbadger\'s five tiers in HUD type, colour and sentence', () => {
    expect(compositionTierLabel('pure_ckb')).toBe('PURE CKB');
    expect(compositionTierColor('pure_ckb')).toBe(STORAGE_TIER_COLORS.pure_ckb);
    expect(compositionTierDescription('pure_ckb')).toBe(
      'All content is stored directly on the CKB blockchain (on-chain data or ckbfs://). Fully verifiable and permanent.',
    );

    expect(compositionTierLabel('btc_ckb')).toBe('BTC+CKB');
    expect(compositionTierColor('btc_ckb')).toBe(STORAGE_TIER_COLORS.btc_ckb);
    expect(compositionTierDescription('btc_ckb')).toBe(
      'Content is stored across both CKB (on-chain data or ckbfs://) and Bitcoin (btcfs://). Fully verifiable and permanent.',
    );

    expect(compositionTierLabel('decentralized_mixture'))
      .toBe('DECENTRALIZED MIXTURE');
    expect(compositionTierColor('decentralized_mixture'))
      .toBe(STORAGE_TIER_COLORS.decentralized_mixture);
    expect(compositionTierDescription('decentralized_mixture')).toBe(
      'Some content references external decentralized storage (e.g. IPFS, Arweave). Data persists as long as the external network hosts it.',
    );

    expect(compositionTierLabel('centralized_mixture'))
      .toBe('CENTRALIZED MIXTURE');
    // Ash, and nothing louder: an object leaning on somebody's server is a
    // weaker promise, not a fault. The whole ramp sits off the severity ladder
    // now — this used to be `ember`, one rung above `caution`, which put the
    // HUD's own gradient for something going wrong behind a durability fact.
    expect(compositionTierColor('centralized_mixture'))
      .toBe(STORAGE_TIER_COLORS.centralized_mixture);
    expect(compositionTierColor('centralized_mixture'))
      .not.toBe(HUD_COLORS.danger);
    expect(compositionTierColor('centralized_mixture'))
      .not.toBe(HUD_COLORS.ember);
    expect(compositionTierDescription('centralized_mixture')).toBe(
      'Some content depends on centralized servers (http/https). Data availability relies on the server operator.',
    );

    expect(compositionTierLabel('unknown')).toBe('UNKNOWN');
    expect(compositionTierColor('unknown')).toBe(STORAGE_TIER_COLORS.unknown);
    expect(compositionTierDescription('unknown')).toBe(
      'Composition could not be determined. The content storage method for objects in this cluster is unverified.',
    );
  });

  it('names both object kinds where a facet is summarized generically', () => {
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
    expect(compositionTierColor('quantum_mixture'))
      .toBe(STORAGE_TIER_COLORS.unknown);
    expect(compositionTierDescription('quantum_mixture'))
      .toBe(compositionTierDescription('unknown'));

    // A wire string naming something on `Object.prototype` is an unknown tier
    // like any other, not a truthy table hit with nothing inside it.
    expect(compositionTierLabel('constructor')).toBe('CONSTRUCTOR');
    expect(compositionTierColor('constructor')).toBe(STORAGE_TIER_COLORS.unknown);
    expect(compositionTierDescription('constructor'))
      .toBe(compositionTierDescription('unknown'));
  });
});

describe('CellDetailPanel — object kin and composition', () => {
  it('spells out a clustered spore: kin, id, population, object, composition', () => {
    const { container } = renderPanel(record([
      collectionFacet([
        { key: 'role', value: 'item' },
        { key: 'collection_id', value: CLUSTER_ID },
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
    expect(evidenceStack(container)).toEqual([
      'collection', 'cluster-id', 'population', 'object', 'composition-block',
    ]);

    // The name is a value, in the house's value-emphasis ink.
    expect(value(container, 'collection').textContent).toBe('Nervape Gen2');
    expect(value(container, 'collection').style.color)
      .toBe(rgbOf(HUD_COLORS.goldInk));
    expect(value(container, 'collection').getAttribute('title'))
      .toBe('A generative collection of 1024 objects.');

    // The id is forensics: truncated on the row, whole in the title. A spore's
    // group is a CLUSTER, which is the word its own index uses for it.
    expect(row(container, 'cluster-id')?.textContent)
      .toBe('CLUSTER0x51bf51bf51…f51bf51bf');
    expect(value(container, 'cluster-id').getAttribute('title'))
      .toBe(CLUSTER_ID);

    expect(value(container, 'population').textContent)
      .toBe('1,024 LIVE · 210 HOLDERS · 1.09 M CKB');

    expect(row(container, 'object')?.textContent)
      .toBe('OBJECTimage/png · 6,878 B');

    // The headline is the facet's STATE, which the index already resolved to
    // this object's OWN measurement — not the population's `agg_tier`, which
    // says centralized on the very same facet.
    expect(statedBlock(container).getAttribute('data-cell-composition-block'))
      .toBe('pure_ckb');
    expect(blockTier(container).textContent).toBe('PURE CKB');
    expect(blockTier(container).style.color)
      .toBe(rgbOf(STORAGE_TIER_COLORS.pure_ckb));

    // Its neighbours' census sits under it — counts, never a ratio and never a
    // bar — with the empty tiers left off the line and kept in the hover.
    expect(blockCounts(container)?.textContent).toBe(AGGREGATE_VISIBLE_COUNTS);
    expect(statedBlock(container).getAttribute('title')).toBe(
      `${compositionTierDescription('pure_ckb')} ${AGGREGATE_TITLE_COUNTS}`,
    );
    expect(statedBlock(container).getAttribute('title'))
      .not.toMatch(/%|ratio/i);
    expect(container.querySelector('[data-cell-storage-issues]')).toBeNull();
  });

  it('wears the tier on its edge and behind its words, never as a fill', () => {
    // The point of the redesign: the durability of an object's bytes is legible
    // from the SHAPE of the block before a word of it is read. A wash, not a
    // panel of its own — the plate under it is near-opaque by construction and
    // everything inside tints down onto that ground.
    const { container } = renderPanel(record([
      compositionFacet(AGGREGATE_COUNTS, 'centralized_mixture'),
    ]));

    expect(statedBlock(container).style.borderLeft)
      .toBe(`2px solid ${rgbaOf(STORAGE_TIER_COLORS.centralized_mixture, 0.55)}`);
    expect(statedBlock(container).style.background)
      .toBe(rgbaOf(STORAGE_TIER_COLORS.centralized_mixture, 0.07));
  });

  it('reads an m-NFT token with the same two kinds, and calls its group a CLASS', () => {
    const { container } = renderPanel(record([
      collectionFacet([
        { key: 'role', value: 'item' },
        { key: 'collection_id', value: CLASS_ID },
        { key: 'live_items', value: '2408' },
        { key: 'holders', value: '917' },
        { key: 'description', value: 'A Christmas collection.' },
      ], 'Non-Fungible Santa Claus', 'mnft'),
      compositionFacet(AGGREGATE_COUNTS, 'centralized_mixture', 'mnft'),
    ], { content: mnftContent }));

    // Same matrix as a spore's. A read that filtered on the namespace would
    // have produced an empty stack here.
    expect(evidenceStack(container)).toEqual([
      'collection', 'cluster-id', 'population', 'object', 'composition-block',
    ]);
    expect(value(container, 'collection').textContent)
      .toBe('Non-Fungible Santa Claus');
    // M-NFT keys its objects by class, and printing a spore's word over an
    // m-NFT's id would name a thing that does not exist upstream.
    expect(row(container, 'cluster-id')?.textContent)
      .toBe('CLASS0x7a7a7a7a7a…ab1c2d3e4');
    expect(value(container, 'cluster-id').getAttribute('title')).toBe(CLASS_ID);
    expect(container.textContent).not.toContain('CLUSTER');
    expect(row(container, 'object')?.textContent).toBe('OBJECT#812');

    // No per-item media profile exists upstream for m-NFT, so the headline is
    // the population's tier and there is nothing to have found issues in.
    expect(blockTier(container).textContent).toBe('CENTRALIZED MIXTURE');
    expect(blockTier(container).style.color)
      .toBe(rgbOf(STORAGE_TIER_COLORS.centralized_mixture));
    expect(blockCounts(container)?.textContent).toBe(AGGREGATE_VISIBLE_COUNTS);
    expect(statedBlock(container).querySelector('[data-cell-storage-issues]'))
      .toBeNull();
  });

  it('lets an m-NFT class Cell state its population and mix, and nothing twice', () => {
    const { container } = renderPanel(record([
      collectionFacet([
        { key: 'role', value: 'cluster' },
        { key: 'collection_id', value: CLASS_ID },
        { key: 'live_items', value: '2408' },
      ], 'Non-Fungible Santa Claus', 'mnft'),
      compositionFacet(AGGREGATE_COUNTS, 'centralized_mixture', 'mnft'),
    ]));

    // The class Cell's name is already its OBJECT row and its id is already
    // its ARGS row — the same dedupe a spore cluster Cell gets.
    expect(evidenceStack(container)).toEqual(['population', 'composition-block']);
    expect(value(container, 'population').textContent).toBe('2,408 LIVE');
    expect(blockTier(container).textContent).toBe('CENTRALIZED MIXTURE');
  });

  it('has no word for a family it has not met, and does not borrow one', () => {
    const { container } = renderPanel(record([
      collectionFacet([
        { key: 'role', value: 'item' },
        { key: 'collection_id', value: CLUSTER_ID },
      ], 'Some Third Family', 'cota'),
    ]));

    expect(row(container, 'cluster-id')?.textContent)
      .toBe('COLLECTION ID0x51bf51bf51…f51bf51bf');
    expect(container.textContent).not.toContain('CLUSTER');
    expect(container.textContent).not.toContain('CLASS');
  });

  it('states the kin it knows when the asset index answered nothing', () => {
    // The m-NFT outage shape: the class id survives on the Cell's own type
    // script, and the index that would have described that class is down. Rows
    // for what is established, and no block at all — a composition facet is
    // never invented from an absence.
    const { container } = renderPanel(record([
      collectionFacet([
        { key: 'role', value: 'item' },
        { key: 'collection_id', value: CLASS_ID },
      ], undefined, 'mnft'),
    ]));

    expect(evidenceStack(container)).toEqual(['collection']);
    expect(value(container, 'collection').textContent)
      .toBe('0x7a7a7a7a7a…ab1c2d3e4');
    expect(value(container, 'collection').style.color)
      .toBe(rgbOf(HUD_COLORS.goldInk));
    expect(block(container)).toBeNull();
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

    expect(blockTier(container).textContent).toBe('DECENTRALIZED MIXTURE');
    expect(blockTier(container).style.color)
      .toBe(rgbOf(STORAGE_TIER_COLORS.decentralized_mixture));
    // The chip beside it is the one thing here that IS a fault, and it is the
    // only caution on the block now: an object hosted on IPFS used to wear the
    // same yellow as the issues its index found in it.
    expect(blockTier(container).style.color)
      .not.toBe(rgbOf(HUD_COLORS.caution));
    // The chip rides the block's own heading, right of the word it qualifies.
    const chip = statedBlock(container).querySelector<HTMLElement>(
      '[data-cell-storage-issues="2"]',
    );
    expect(chip?.textContent).toBe('2 ISSUES');
    expect(chip?.style.color).toBe(rgbOf(HUD_COLORS.caution));
    expect(chip?.getAttribute('title'))
      .toBe('2 content issues reported by the index.');
    // Nothing was stated about the population, so the counts line is absent
    // rather than empty and the hover is the tier's sentence alone.
    expect(blockCounts(container)).toBeNull();
    expect(statedBlock(container).getAttribute('title'))
      .toBe(compositionTierDescription('decentralized_mixture'));
  });

  it('states solitude as a fact rather than as a missing name', () => {
    const { container } = renderPanel(record([
      collectionFacet([{ key: 'role', value: 'sole_item' }]),
      compositionFacet([{ key: 'item_tier', value: 'pure_ckb' }], 'pure_ckb'),
    ]));

    expect(evidenceStack(container)).toEqual(['collection', 'composition-block']);
    expect(value(container, 'collection').textContent).toBe('SOLE SPORE');
    // Instrument grey: there is no collection here to emphasise.
    expect(value(container, 'collection').style.color)
      .toBe(rgbOf(HUD_COLORS.dim));
    expect(value(container, 'collection').style.color)
      .not.toBe(rgbOf(HUD_COLORS.goldInk));
    // A sole spore still has bytes, and they still live somewhere.
    expect(blockTier(container).textContent).toBe('PURE CKB');
  });

  it('lets a cluster Cell state its population and mix, and nothing twice', () => {
    const { container } = renderPanel(record([
      collectionFacet([
        { key: 'role', value: 'cluster' },
        { key: 'collection_id', value: CLUSTER_ID },
        { key: 'live_items', value: '1024' },
        { key: 'holders', value: '210' },
      ], 'Nervape Gen2'),
      compositionFacet(AGGREGATE_COUNTS, 'centralized_mixture'),
    ]));

    // The cluster's name is already its OBJECT row and its id is already its
    // ARGS row; a COLLECTION or CLUSTER row here would say both a second time.
    expect(evidenceStack(container)).toEqual(['population', 'composition-block']);
    expect(value(container, 'population').textContent)
      .toBe('1,024 LIVE · 210 HOLDERS');
    // A cluster Cell holds no media of its own, so the headline it wears is
    // the population's — which is exactly what the facet's state says.
    expect(blockTier(container).textContent).toBe('CENTRALIZED MIXTURE');
    expect(blockTier(container).style.color)
      .toBe(rgbOf(STORAGE_TIER_COLORS.centralized_mixture));
  });

  it('names the kin by id when the collection index is down', () => {
    const { container } = renderPanel(record([
      collectionFacet([
        { key: 'role', value: 'item' },
        { key: 'collection_id', value: CLUSTER_ID },
      ]),
    ]));

    // Nothing was established about the population, so nothing is claimed —
    // and the id takes the COLLECTION row rather than being printed on two
    // consecutive rows saying the same string.
    expect(evidenceStack(container)).toEqual(['collection']);
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
    // Where its bytes live is a separate question, and still answered.
    const { container } = renderPanel(record([
      compositionFacet([{ key: 'item_tier', value: 'btc_ckb' }], 'btc_ckb'),
    ]));

    expect(evidenceStack(container)).toEqual(['composition-block']);
    expect(blockTier(container).textContent).toBe('BTC+CKB');
    expect(blockTier(container).style.color)
      .toBe(rgbOf(STORAGE_TIER_COLORS.btc_ckb));
    expect(container.textContent).not.toContain('SOLE SPORE');
    expect(row(container, 'collection')).toBeNull();
  });

  it('prints the tiers a collection actually holds, and keeps the zeros in the hover', () => {
    const { container } = renderPanel(record([
      collectionFacet([
        { key: 'role', value: 'cluster' },
        { key: 'live_items', value: '5' },
      ]),
      compositionFacet([
        { key: 'agg_tier', value: 'centralized_mixture' },
        { key: 'agg_onchain', value: '0' },
        { key: 'agg_pure_ckb', value: '0' },
        { key: 'agg_decentralized', value: '0' },
        { key: 'agg_centralized', value: '5' },
        { key: 'agg_unknown', value: '0' },
      ], 'centralized_mixture'),
    ]));

    // A tier holding none of a collection's objects costs a reader a glance
    // and tells them nothing the tiers beside it have not already said.
    expect(blockCounts(container)?.textContent).toBe('5 CENTRALIZED');
    // The full census is one hover away, zeros and all.
    expect(statedBlock(container).getAttribute('title')).toBe(
      `${compositionTierDescription('centralized_mixture')} on-chain 0 (pure 0) · decentralized 0 · centralized 5 · unknown 0`,
    );
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

    // No pure count arrived, so nothing is stated in parentheses — an unstated
    // subset is not a subset of none.
    expect(blockCounts(container)?.textContent).toBe('7 ON-CHAIN');
    expect(statedBlock(container).getAttribute('title')).toBe(
      `${compositionTierDescription('pure_ckb')} on-chain 7`,
    );
  });

  it('states a pure count that has no on-chain figure beside it on its own', () => {
    // The folding rule read from the other end: `pure` is stated INSIDE
    // `on-chain` because that is what the wire means, and with no on-chain
    // figure to fold it into it is a term like any other rather than an
    // orphaned parenthesis.
    const { container } = renderPanel(record([
      compositionFacet([
        { key: 'agg_tier', value: 'pure_ckb' },
        { key: 'agg_onchain', value: '0' },
        { key: 'agg_pure_ckb', value: '7' },
      ], 'pure_ckb'),
    ]));

    expect(blockCounts(container)?.textContent).toBe('7 PURE');
  });

  it('says where the content lives once, not twice under two labels', () => {
    // The rows this block replaced. COMPOSITION stated the population's tier
    // and STORAGE stated this object's own, one under the other, and they read
    // as the same sentence printed twice — which is the whole reason the block
    // exists and the reason neither row may come back.
    const { container } = renderPanel(record([
      collectionFacet([
        { key: 'role', value: 'item' },
        { key: 'collection_id', value: CLUSTER_ID },
      ], 'Nervape Gen2'),
      compositionFacet([
        { key: 'item_tier', value: 'pure_ckb' },
        ...AGGREGATE_COUNTS,
      ], 'pure_ckb'),
    ], { content: sporeContent }));

    expect(row(container, 'storage')).toBeNull();
    expect(row(container, 'composition')).toBeNull();
    expect(container.querySelector('[data-cell-evidence-value="storage"]'))
      .toBeNull();
    expect(container.querySelector('[data-cell-evidence-value="composition"]'))
      .toBeNull();
    expect(container.textContent).not.toContain('STORAGE');
    // One block, and one only.
    expect(container.querySelectorAll('[data-cell-composition-block]'))
      .toHaveLength(1);
  });

  it('does not print the object facets a second time as a generic summary', () => {
    // `primarySemanticFacet` falls back to the record's FIRST facet, so a kind
    // spelled out row by row that is not excluded from the generic slot renders
    // twice — once as its rows, once as a one-liner underneath them.
    const { container } = renderPanel(record([
      collectionFacet([
        { key: 'role', value: 'item' },
        { key: 'collection_id', value: CLASS_ID },
      ], 'Non-Fungible Santa Claus', 'mnft'),
      compositionFacet(AGGREGATE_COUNTS, 'centralized_mixture', 'mnft'),
    ]));

    expect(container.querySelector('[data-cell-context-facet="mnft:collection"]'))
      .toBeNull();
    expect(container.querySelector('[data-cell-context-facet="mnft:composition"]'))
      .toBeNull();
    expect(container.querySelector('[data-cell-context-facet]')).toBeNull();
    // The evidence itself is still there — suppression is of the duplicate.
    expect(evidenceStack(container))
      .toEqual(['collection', 'cluster-id', 'composition-block']);
  });
});
