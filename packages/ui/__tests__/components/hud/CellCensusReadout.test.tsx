import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AssetEcosystemRecord,
  ChainCensus,
  EnrichmentSourceStatus,
  ScriptFamilyCensusRecord,
} from '@cknerv/types';
import CellCensusReadout from '../../../src/components/hud/CellCensusReadout';
import { INVENTORY_COLORS } from '../../../src/derives/scriptFamilies.derive';
import { STALE_OPACITY } from '../../../src/components/hud/hudTheme';

afterEach(cleanup);

const source: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['asset_ecosystem', 'script_family_census'],
  validated_anchor: { block: 100, hash: '0xblock100' },
};

const record: AssetEcosystemRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: '0xblock100' },
  updated_at_ms: Date.now(),
  total_live_capacity_shannons: '5776320963848791674',
  total_knowledge_bytes: 159_890_202,
  capacity_breakdown: [
    { category: 'dao', capacity_shannons: '837590809032221706', share_bps: 1450 },
    { category: 'tokens', capacity_shannons: '6341612687664451', share_bps: 10 },
    { category: 'objects', capacity_shannons: '2058992329315028', share_bps: 3 },
    { category: 'other', capacity_shannons: '4930329549799590489', share_bps: 8535 },
  ],
  top_assets: [{
    type_script_hash: `0x${'22'.repeat(32)}`,
    name: 'Otter',
    symbol: 'OTTER',
    holders_count: 34_386,
    total_capacity_shannons: '1041088511901394',
  }],
};

function census(overrides: Partial<ChainCensus> = {}): ChainCensus {
  return {
    source: 'node',
    as_of: { block: 100, hash: '0xblock100' },
    updated_at_ms: 1,
    live_cells: 1_471_373,
    classes: { dao: 22_690, typed_non_dao: 475_872, plain: 972_811 },
    ...overrides,
  };
}

/** Mainnet's shape on 2026-09-07, to the Cell: two thirds bare CKB, the
 *  keeper's income cells as the largest type family, tokens and objects a
 *  few percent each, six thousand identities, the DAO at one and a half —
 *  and the index's own verdict on which inventory each family is, which is
 *  what the bar splits the typed Cells by. The remainders make the type
 *  families, bare CKB and the unlisted tail partition `live_cells`. */
function familyCensus(overrides: Partial<ScriptFamilyCensusRecord> = {}): ScriptFamilyCensusRecord {
  return {
    source: 'ckbadger',
    as_of: { block: 100, hash: '0xblock100' },
    updated_at_ms: Date.now(),
    live_cells: 1_471_373,
    types_absent: 972_811,
    types_dao: 22_690,
    types_unlisted: 36_622,
    locks_unlisted: 10_916,
    families: [
      { name: 'Nervos DAO', kind: 'type', live_cells: 22_690 },
      { name: '.bit Income Cell', kind: 'type', live_cells: 233_849 },
      { name: 'xUDT', kind: 'type', live_cells: 57_748, inventory: 'token' },
      { name: 'COTA', kind: 'type', live_cells: 53_892 },
      { name: 'M-NFT', kind: 'type', live_cells: 45_994, inventory: 'object' },
      { name: 'Spore', kind: 'type', live_cells: 37_275, inventory: 'object' },
      { name: 'Simple UDT', kind: 'type', live_cells: 4_133, inventory: 'token' },
      { name: '.bit Account', kind: 'type', live_cells: 6_245, inventory: 'identity' },
      { name: 'did:ckb', kind: 'type', live_cells: 114, inventory: 'identity' },
      { name: 'Default Lock', kind: 'lock', live_cells: 893_139 },
      { name: '.bit Lock', kind: 'lock', live_cells: 259_569 },
      { name: 'JoyID', kind: 'lock', live_cells: 161_443 },
    ],
    ...overrides,
  };
}

const bar = (container: HTMLElement, title: string) =>
  container.querySelector<HTMLElement>(`[data-taxonomy-bar="${title}"]`);
const segments = (container: HTMLElement, title: string) =>
  Array.from(bar(container, title)?.querySelectorAll<HTMLElement>('[data-taxonomy-segment]') ?? []);
const legend = (container: HTMLElement, title: string) =>
  bar(container, title)?.querySelector<HTMLElement>('[data-taxonomy-legend]')?.textContent ?? '';

describe('CellCensusReadout', () => {
  it('renders nothing without a proven chain measurement', () => {
    // No indexed record, no census, no family count: the block claims
    // nothing, rather than wearing local numbers as chain truth. The stage
    // block carries those.
    const { container } = render(<CellCensusReadout />);
    expect(container.firstChild).toBeNull();

    const unusable = render(
      <CellCensusReadout
        source={{ ...source, status: 'connecting' }}
        record={record}
        scriptFamilyCensus={familyCensus()}
      />,
    );
    expect(unusable.container.firstChild).toBeNull();
  });

  it('shows the whole-chain census under one stated anchor', () => {
    const { container } = render(
      <CellCensusReadout source={source} record={record} census={census()} scriptFamilyCensus={familyCensus()} />,
    );
    const text = container.textContent ?? '';

    expect(text).toContain('CELL CENSUS');
    // No anchor anywhere in the section: the header wore `AS OF #n` for a
    // day and the user struck it with the rest.
    expect(text).not.toContain('AS OF');
    // Live capacity reads in the HUD-wide K/M/G·CKB family; the exact CKB
    // figure — and the CKByte equivalence — stay on the value's tooltip.
    expect(text).toContain('57.76 G·CKB');
    expect(text).not.toContain('57,763,209,638.48 CKB');
    expect(container.querySelector(
      '[title="57,763,209,638.48 CKB · 1 CKB = 1 CKByte of state"]',
    )).not.toBeNull();
    expect(text).toContain('159.9 MB');
    // Same header system as the panel's other fused readouts.
    expect(container.querySelector('[data-readout-title]')?.textContent).toBe('CELL CENSUS');
    expect(text).toContain('Live cells');
    expect(text).toContain('1,471,373');
    // The record's top-asset list is not drawn: ranked by one key and
    // captioned with another, it was struck.
    expect(text).not.toContain('TOP ASSETS');
    expect(text).not.toContain('OTTER');
    expect(text).not.toContain('HOLDERS');
    expect(text).not.toContain('INDEXED');
    expect(text).not.toContain('CKBADGER');
    // Two names it has worn and shed: the first named one row of five, the
    // second named nothing in particular.
    expect(text).not.toContain('CHAIN CAPACITY');
    expect(text).not.toContain('CHAIN STATE');
    // The chain block holds no local vocabulary — the stage block is the
    // other stage on this rail, not a nested child of this one.
    expect(text).not.toContain('STAGE SAMPLE');
    expect(text).not.toContain('RETAINED');
    expect(text).not.toContain('Rendered');
  });

  it('splits the chain by the index’s own inventory, by Cell count', () => {
    // Not the index's capacity split (DAO 14.5%, TOKENS 0.1%, by CKB), not
    // the census's three classes (DAO · TYPED · PLAIN), and not thirty
    // families ranked: the words ckbadger's own menu uses — its Inventory
    // pages, the DAO, Scripts — over every live Cell, with CKB first.
    const { container } = render(
      <CellCensusReadout source={source} record={record} census={census()} scriptFamilyCensus={familyCensus()} />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain('14.5%');
    expect(text).not.toContain('TYPED');
    expect(text).not.toContain('PLAIN');
    expect(text).not.toContain('.bit Income Cell');
    expect(container.querySelector('[data-taxonomy-bar="LOCKS"]')).toBeNull();

    expect(segments(container, 'TYPES').map((segment) => segment.dataset.taxonomySegment)).toEqual([
      'native',
      'token',
      'object',
      'identity',
      'dao',
      'script',
    ]);
    // Identities are 0.43% of the chain: a real six thousand Cells, so a
    // segment, but under the legend's half-percent floor, so a count in the
    // tail rather than a name claiming to be absent. SCRIPTS is every other
    // typed Cell — the keeper's income cells, COTA, the typed Cells the
    // index has no family for — with the DAO's own family taken off it.
    expect(legend(container, 'TYPES')).toBe(
      'CKB 66% · TOKENS 4% · OBJECTS 6% · DAO 2% · SCRIPTS 22% · +1 <1%',
    );
    expect(bar(container, 'TYPES')?.title).toBe(
      'CKB 66% · TOKENS 4% · OBJECTS 6% · IDENTITIES <1% · DAO 2% · SCRIPTS 22%',
    );
    const widths = segments(container, 'TYPES').map((segment) => parseFloat(segment.style.width));
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 6);
    expect(widths[0]).toBeCloseTo((972_811 / 1_471_373) * 100, 3);
    expect(widths[5]).toBeCloseTo((324_363 / 1_471_373) * 100, 3);

    // One hue per word, the words the activity feed already wears.
    const hue = (hex: string) => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = hex;
      return probe.style.backgroundColor;
    };
    const asset = segments(container, 'TYPES');
    expect(asset.map((segment) => segment.style.backgroundColor)).toEqual(
      ['native', 'token', 'object', 'identity', 'dao', 'script'].map((key) => hue(INVENTORY_COLORS[key])),
    );
  });

  it('carries no scope word and no anchor, only STALE', () => {
    // `CHAIN`, `CHAIN · AS OF #n` on the count and on the bar, then `AS OF
    // #n` on the header: all struck as noise. What survives is the one word
    // a reader must not miss.
    const agreed = render(
      <CellCensusReadout source={source} record={record} census={census()} scriptFamilyCensus={familyCensus()} />,
    );
    expect(agreed.container.querySelector('[data-taxonomy-scope]')).toBeNull();
    expect(agreed.container.querySelector('[data-population-scope]')).toBeNull();
    expect(agreed.container.textContent).not.toContain('CHAIN');
    cleanup();

    // The family count trailing the record is not a fact a reader acts on.
    const trailing = render(
      <CellCensusReadout
        source={source}
        record={record}
        census={census({ as_of: { block: 98, hash: '0xblock98' } })}
        scriptFamilyCensus={familyCensus({ as_of: { block: 97, hash: '0xblock97' } })}
      />,
    );
    expect(trailing.container.textContent).not.toContain('AS OF');
    cleanup();

    // Its own refresh has stopped while the source is fine: the bar dims and
    // says so, and the capacity rows beside it stay at full strength.
    const stale = render(
      <CellCensusReadout
        source={source}
        record={record}
        census={census()}
        scriptFamilyCensus={familyCensus({ updated_at_ms: Date.now() - 400_000 })}
      />,
    );
    expect(stale.container.querySelector('[data-taxonomy-scope="TYPES"]')?.textContent).toBe('STALE');
    expect(stale.container.querySelector<HTMLElement>('[data-chain-taxonomy]')?.style.opacity)
      .toBe(String(STALE_OPACITY));
    expect(stale.container.querySelector('[data-readout-title]')?.parentElement?.textContent)
      .not.toContain('STALE');
  });

  it('draws no bar until the index has counted every family', () => {
    // No family census: the count stands alone — never a bar guessed from
    // the three classes, which say nothing about which family a typed Cell
    // belongs to.
    const { container } = render(
      <CellCensusReadout source={source} record={record} census={census()} />,
    );
    expect(container.querySelector('[data-taxonomy-bar]')).toBeNull();
    expect(container.textContent).toContain('1,471,373');
    expect(container.textContent).not.toContain('LOCKS');
  });

  it('stands on the family census alone, and on the census alone', () => {
    // An unusable index record with a usable family count: the section is
    // the census's, and states the family count's anchor.
    const families = render(
      <CellCensusReadout source={source} record={null} scriptFamilyCensus={familyCensus()} />,
    );
    expect(families.container.textContent).toContain('CELL CENSUS');
    expect(families.container.textContent).not.toContain('AS OF');
    expect(families.container.querySelector('[data-taxonomy-bar="TYPES"]')).not.toBeNull();
    expect(families.container.textContent).not.toContain('Live capacity');
    cleanup();

    const counted = render(
      <CellCensusReadout
        source={{ ...source, status: 'connecting' }}
        record={record}
        census={census()}
        scriptFamilyCensus={familyCensus()}
      />,
    );
    const text = counted.container.textContent ?? '';
    expect(text).toContain('CELL CENSUS');
    expect(text).toContain('1,471,373');
    expect(text).not.toContain('Live capacity');
    expect(text).not.toContain('Knowledge');
    expect(text).not.toContain('TOP ASSETS');
    expect(counted.container.querySelector('[data-taxonomy-bar]')).toBeNull();
  });

  it('prints the count bare, whatever the census’s own anchor', () => {
    // One anchor stated once, on the header; the row wore `CHAIN` and its own
    // `AS OF #n` for a while and the user struck both as noise.
    const agreed = render(
      <CellCensusReadout source={source} record={record} census={census()} />,
    );
    expect(agreed.container.querySelector('[data-population-row="Chain live"] [data-population-scope]')).toBeNull();
    cleanup();
    const trailing = render(
      <CellCensusReadout
        source={source}
        record={record}
        census={census({ as_of: { block: 98, hash: '0xblock98' } })}
      />,
    );
    const row = trailing.container.querySelector('[data-population-row="Chain live"]');
    expect(row?.querySelector('[data-population-scope]')).toBeNull();
    expect(row?.textContent).toContain('1,471,373');
  });

  it('keeps a stale census, labeled and dimmed', () => {
    const { container } = render(
      <CellCensusReadout source={source} record={record} census={census()} censusStale />,
    );
    const row = container.querySelector<HTMLElement>('[data-population-row="Chain live"]');
    expect(row?.textContent).toContain('1,471,373');
    expect(row?.querySelector('[data-population-scope]')?.textContent).toBe('STALE');
    expect(row?.style.opacity).toBe('0.6');
  });

  it('says UNAVAILABLE rather than substituting a number it cannot prove', () => {
    const { container } = render(
      <CellCensusReadout source={source} record={record} census={null} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('UNAVAILABLE');
    expect(text).toContain('NO VALIDATED CENSUS');
    // Never a synthesized zero, and never the retained count wearing the
    // chain's label.
    expect(text).not.toContain('ALL LIVE CELLS');
  });

  it('dims only stale indexed context, never a fresh census beside it', () => {
    const { container } = render(
      <CellCensusReadout
        source={{ ...source, status: 'stale' }}
        record={record}
        census={census()}
        scriptFamilyCensus={familyCensus()}
      />,
    );
    expect(container.textContent).toContain('STALE');
    const indexed = Array.from(
      container.querySelectorAll<HTMLElement>('[data-indexed-context]'),
    );
    // The capacity rows and the bar: both indexed, both dim.
    expect(indexed.length).toBe(2);
    for (const section of indexed) expect(section.style.opacity).toBe(String(STALE_OPACITY));
    expect(container.querySelector<HTMLElement>(
      '[data-population-row="Chain live"]',
    )?.style.opacity).toBe('1');
  });
});

describe('CellCensusReadout folded', () => {
  it('keeps the header and the census count, and nothing else', () => {
    // The rail has collapsed: what survives is the reading a reader came to
    // the section for. Capacity and knowledge are both derivable from the
    // asset record the section header already anchors; the validated census
    // is not derivable from anything else on the panel.
    const { container } = render(
      <CellCensusReadout source={source} record={record} census={census()} scriptFamilyCensus={familyCensus()} folded />,
    );
    const section = container.querySelector('[data-cell-census]') as HTMLElement;

    expect(section.dataset.cellCensusFolded).toBe('true');
    expect(section.textContent).toContain('CELL CENSUS');
    expect(section.textContent).toContain('1,471,373 LIVE');
    expect(section.textContent).not.toContain('AS OF');
    expect(section.textContent).not.toContain('Live capacity');
    expect(section.textContent).not.toContain('Knowledge');
    expect(section.querySelector('[data-taxonomy-bar]')).toBeNull();
  });

  it('is the full section without it', () => {
    const { container } = render(
      <CellCensusReadout source={source} record={record} census={census()} scriptFamilyCensus={familyCensus()} />,
    );
    const section = container.querySelector('[data-cell-census]') as HTMLElement;

    expect(section.dataset.cellCensusFolded).toBeUndefined();
    expect(section.textContent).toContain('Live capacity');
    expect(section.textContent).toContain('Knowledge');
    expect(section.querySelectorAll('[data-taxonomy-bar]').length).toBe(1);
  });
});
