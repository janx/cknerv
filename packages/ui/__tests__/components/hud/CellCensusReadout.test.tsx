import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AssetEcosystemRecord,
  ChainCensus,
  EnrichmentSourceStatus,
  ScriptFamilyCensusRecord,
} from '@cknerv/types';
import CellCensusReadout from '../../../src/components/hud/CellCensusReadout';
import { SCRIPT_FAMILY_COLORS } from '../../../src/derives/scriptFamilies.derive';
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

/** Mainnet's shape on 2026-09-07, to the Cell: two thirds bare CKB, one
 *  keeper's income cells as the largest type family, the DAO seventh among
 *  the types and so folded off a six-slot bar, and one lock holding most of
 *  the chain. The remainders make both taxonomies partition `live_cells`. */
function familyCensus(overrides: Partial<ScriptFamilyCensusRecord> = {}): ScriptFamilyCensusRecord {
  return {
    source: 'ckbadger',
    as_of: { block: 100, hash: '0xblock100' },
    updated_at_ms: Date.now(),
    live_cells: 1_471_373,
    types_absent: 972_811,
    types_unlisted: 42_981,
    locks_unlisted: 10_916,
    families: [
      { name: 'Nervos DAO', kind: 'type', live_cells: 22_690 },
      { name: '.bit Income Cell', kind: 'type', live_cells: 233_849 },
      { name: 'xUDT', kind: 'type', live_cells: 57_748 },
      { name: 'COTA', kind: 'type', live_cells: 53_892 },
      { name: 'M-NFT', kind: 'type', live_cells: 45_994 },
      { name: 'Spore', kind: 'type', live_cells: 37_275 },
      { name: 'Simple UDT', kind: 'type', live_cells: 4_133 },
      { name: 'Default Lock', kind: 'lock', live_cells: 893_139 },
      { name: '.bit Lock', kind: 'lock', live_cells: 259_569 },
      { name: 'JoyID', kind: 'lock', live_cells: 161_443 },
      { name: 'FlashSigner', kind: 'lock', live_cells: 42_047 },
      { name: 'PW Lock', kind: 'lock', live_cells: 29_251 },
      { name: 'Force Bridge', kind: 'lock', live_cells: 27_197 },
      { name: 'OMNI Lock', kind: 'lock', live_cells: 25_858 },
      { name: 'UniPass', kind: 'lock', live_cells: 21_953 },
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
    expect(text).toContain('AS OF #100');
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
    expect(text).toContain('OTTER');
    expect(text).toContain('34,386 HOLDERS');
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

  it('splits the chain by the stage’s own two taxonomies, by Cell count', () => {
    // Not the index's capacity split (DAO 14.5%, TOKENS 0.1%, by CKB), and
    // not the census's three classes (DAO · TYPED · PLAIN): the ASSETS and
    // LOCKS bars STAGE·07 draws, over the whole chain's families.
    const { container } = render(
      <CellCensusReadout source={source} record={record} census={census()} scriptFamilyCensus={familyCensus()} />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain('14.5%');
    expect(text).not.toContain('TOKENS');
    expect(text).not.toContain('TYPED');
    expect(text).not.toContain('PLAIN');

    // ASSETS: bare CKB first, five families ranked by Cell count, the DAO
    // and sUDT folded past the six-slot cut, and last the typed Cells the
    // index has no family for.
    expect(segments(container, 'ASSETS').map((segment) => segment.dataset.taxonomySegment)).toEqual([
      'native',
      'type:.bit Income Cell',
      'type:xUDT',
      'type:COTA',
      'type:M-NFT',
      'type:Spore',
      'rest',
      'unlisted',
    ]);
    expect(legend(container, 'ASSETS')).toBe(
      'CKB 66% · .bit Income Cell 16% · xUDT 4% · COTA 4% · M-NFT 3% · Spore 3% · +2 more 2% · unlisted 3%',
    );
    // …and every segment is a share of the whole census, so the bar sums to
    // every live Cell rather than to the families the index happened to name.
    const widths = segments(container, 'ASSETS').map((segment) => parseFloat(segment.style.width));
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 6);
    expect(widths[0]).toBeCloseTo((972_811 / 1_471_373) * 100, 3);

    // LOCKS: six named, two folded, and the unlisted tail — a real 10,916
    // Cells — named at its rounded share rather than folded into a count.
    expect(segments(container, 'LOCKS').map((segment) => segment.dataset.taxonomySegment)).toEqual([
      'lock:Default Lock',
      'lock:.bit Lock',
      'lock:JoyID',
      'lock:FlashSigner',
      'lock:PW Lock',
      'lock:Force Bridge',
      'rest',
      'unlisted',
    ]);
    expect(legend(container, 'LOCKS')).toBe(
      'Default Lock 61% · .bit Lock 18% · JoyID 11% · FlashSigner 3% · PW Lock 2% · Force Bridge 2% · +2 more 3% · unlisted 1%',
    );
    // The unnamed tails wear the hue the stage's `unidentified` wears — both
    // are the part of a bar nobody here can name — and the plain segment is
    // CKB's own.
    const hue = (hex: string) => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = hex;
      return probe.style.backgroundColor;
    };
    const asset = segments(container, 'ASSETS');
    expect(asset[0].style.backgroundColor).toBe(hue(SCRIPT_FAMILY_COLORS.native));
    expect(asset[asset.length - 1].style.backgroundColor).toBe(hue(SCRIPT_FAMILY_COLORS.unidentified));
  });

  it('gives the bars their own scope, anchor and staleness', () => {
    // Anchors agree: the scope alone, the header having said the anchor once.
    const agreed = render(
      <CellCensusReadout source={source} record={record} census={census()} scriptFamilyCensus={familyCensus()} />,
    );
    expect(agreed.container.querySelector('[data-taxonomy-scope="ASSETS"]')?.textContent).toBe('CHAIN');
    expect(agreed.container.querySelector('[data-taxonomy-scope="LOCKS"]')?.textContent).toBe('CHAIN');
    cleanup();

    // The family count trails the record: it says where it was exact.
    const trailing = render(
      <CellCensusReadout
        source={source}
        record={record}
        census={census()}
        scriptFamilyCensus={familyCensus({ as_of: { block: 97, hash: '0xblock97' } })}
      />,
    );
    expect(trailing.container.querySelector('[data-taxonomy-scope="ASSETS"]')?.textContent)
      .toBe('CHAIN · AS OF #97');
    cleanup();

    // Its own refresh has stopped while the source is fine: the bars dim and
    // say so, and the capacity rows beside them stay at full strength.
    const stale = render(
      <CellCensusReadout
        source={source}
        record={record}
        census={census()}
        scriptFamilyCensus={familyCensus({ updated_at_ms: Date.now() - 400_000 })}
      />,
    );
    expect(stale.container.querySelector('[data-taxonomy-scope="LOCKS"]')?.textContent).toBe('CHAIN · STALE');
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
    expect(families.container.textContent).toContain('AS OF #100');
    expect(families.container.querySelector('[data-taxonomy-bar="ASSETS"]')).not.toBeNull();
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

  it('anchors the census to the header when the anchors agree', () => {
    const { container } = render(
      <CellCensusReadout source={source} record={record} census={census()} />,
    );
    const row = container.querySelector('[data-population-row="Chain live"]');
    // One anchor stated once: a second identical anchor on the row would read
    // as a second measurement. The SCOPE stays — three counts on this screen
    // carry the word "live" and each one names the scope it is true in.
    expect(row?.querySelector('[data-population-scope]')?.textContent).toBe('CHAIN');
  });

  it('gives the census its own anchor when it trails the record', () => {
    const { container } = render(
      <CellCensusReadout
        source={source}
        record={record}
        census={census({ as_of: { block: 98, hash: '0xblock98' } })}
      />,
    );
    const row = container.querySelector('[data-population-row="Chain live"]');
    expect(row?.querySelector('[data-population-scope]')?.textContent)
      .toBe('CHAIN · AS OF #98');
  });

  it('keeps a stale census, labeled and dimmed', () => {
    const { container } = render(
      <CellCensusReadout source={source} record={record} census={census()} censusStale />,
    );
    const row = container.querySelector<HTMLElement>('[data-population-row="Chain live"]');
    expect(row?.textContent).toContain('1,471,373');
    expect(row?.textContent).toContain('STALE');
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
    // Capacity rows, the two bars, and the top assets: all indexed, all dim.
    expect(indexed.length).toBe(3);
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
    expect(section.textContent).toContain('AS OF #100');
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
    expect(section.querySelectorAll('[data-taxonomy-bar]').length).toBe(2);
  });
});
