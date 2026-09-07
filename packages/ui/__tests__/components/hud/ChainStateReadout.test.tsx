import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AssetEcosystemRecord,
  ChainCensus,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import ChainStateReadout from '../../../src/components/hud/ChainStateReadout';
import { CLASS_MIX_COLORS } from '../../../src/components/hud/cellFormat';
import { STALE_OPACITY } from '../../../src/components/hud/hudTheme';

afterEach(cleanup);

const source: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['asset_ecosystem'],
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

const bareCensus: ChainCensus = {
  source: 'node',
  as_of: { block: 100, hash: '0xblock100' },
  updated_at_ms: 1,
  live_cells: 1_471_373,
};

function census(overrides: Partial<ChainCensus> = {}): ChainCensus {
  return {
    ...bareCensus,
    // The partition the source proved sums to `live_cells`.
    classes: { dao: 22_690, typed_non_dao: 475_872, plain: 972_811 },
    ...overrides,
  };
}

describe('ChainStateReadout', () => {
  it('renders nothing without a proven chain measurement', () => {
    // No indexed record and no census: the block claims nothing, rather than
    // wearing local numbers as chain truth. The stage block carries those.
    const { container } = render(<ChainStateReadout />);
    expect(container.firstChild).toBeNull();

    const unusable = render(
      <ChainStateReadout source={{ ...source, status: 'connecting' }} record={record} />,
    );
    expect(unusable.container.firstChild).toBeNull();
  });

  it('shows the whole-chain overview under one stated anchor', () => {
    const { container } = render(
      <ChainStateReadout source={source} record={record} census={census()} />,
    );
    const text = container.textContent ?? '';

    expect(text).toContain('CHAIN STATE');
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
    expect(container.querySelector('[data-readout-title]')?.textContent).toBe('CHAIN STATE');
    expect(text).toContain('Live cells');
    expect(text).toContain('1,471,373');
    expect(text).toContain('OTTER');
    expect(text).toContain('34,386 HOLDERS');
    expect(text).not.toContain('INDEXED');
    expect(text).not.toContain('CKBADGER');
    // The section is several readings and is named for none of them: the
    // title it used to wear named the first row and made the bar under the
    // census read as a split of the capacity.
    expect(text).not.toContain('CHAIN CAPACITY');
    // The chain block holds no local vocabulary — the stage block is the
    // other stage on this rail, not a nested child of this one.
    expect(text).not.toContain('STAGE SAMPLE');
    expect(text).not.toContain('RETAINED');
    expect(text).not.toContain('Rendered');
  });

  it('splits the census by Cell COUNT, never by capacity', () => {
    // The record says DAO holds 14.5% of the chain's CKB and the token and
    // object Cells 0.13% between them — true of the capacity, and under a
    // Cell count it read as a Cell mix, which it is not: a token Cell holds
    // close to the least a Cell can hold and a balance Cell some three
    // hundred times that. The bar is the census's own partition, so its DAO
    // segment is 22,690 of 1,471,373 Cells, printed under the same `share`
    // law as STAGE·07's chain-mix row.
    const { container } = render(
      <ChainStateReadout source={source} record={record} census={census()} />,
    );
    const dao = container.querySelector<HTMLElement>('[data-chain-class="dao"]');
    expect(parseFloat(dao?.style.width ?? '')).toBeCloseTo((22_690 / 1_471_373) * 100, 3);
    const widths = Array.from(
      container.querySelectorAll<HTMLElement>('[data-chain-class]'),
    ).map((segment) => parseFloat(segment.style.width));
    expect(widths.length).toBe(3);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 6);

    const legend = container.querySelector<HTMLElement>('[data-class-legend="qualitative"]');
    expect(legend?.textContent).toBe('DAO 2% · TYPED 32% · PLAIN 66%');
    const text = container.textContent ?? '';
    expect(text).not.toContain('14.5%');
    expect(text).not.toContain('TOKENS');
    expect(text).not.toContain('OBJECTS');
    expect(text).not.toContain('OTHER');
    // Exact counts stay on the tooltip, the way every value on this rail
    // keeps its figure there.
    expect(container.querySelector<HTMLElement>('[data-chain-class-mix]')?.title)
      .toBe('DAO 22,690 · TYPED 475,872 · PLAIN 972,811 · OF 1,471,373 LIVE CELLS');
  });

  it('shows every class its legend names, and names it in its own hue', () => {
    // The capacity bar this replaced drew `TOKENS 0.08%` at 0.27 px and
    // `OBJECTS 0.03%` at 0.10 px — two of four names simply not on the bar —
    // under a legend printed in one grey, on a bar whose hues are the only
    // mapping it has (report A, A-9). The floor and the tinted names stay.
    const { container } = render(
      <ChainStateReadout source={source} record={record} census={census()} />,
    );
    const segments = Array.from(
      container.querySelectorAll<HTMLElement>('[data-chain-class]'),
    );
    expect(segments.length).toBe(3);
    for (const segment of segments) expect(segment.style.minWidth).toBe('1px');

    const legend = container.querySelector<HTMLElement>('[data-class-legend="qualitative"]');
    const names = Array.from(
      legend?.querySelectorAll<HTMLElement>('[data-class-legend-name]') ?? [],
    );
    expect(names.length).toBe(segments.length);
    for (const [index, name] of names.entries()) {
      expect(name.style.color, name.textContent ?? '').toBe(segments[index].style.background);
    }
    // One class, one hue, wherever it is counted: the stage-versus-chain
    // rows on STAGE·07 read the same table.
    const hues = segments.map((segment) => segment.style.backgroundColor);
    const expected = [CLASS_MIX_COLORS.dao, CLASS_MIX_COLORS.typed, CLASS_MIX_COLORS.plain]
      .map((hex) => {
        const probe = document.createElement('span');
        probe.style.backgroundColor = hex;
        return probe.style.backgroundColor;
      });
    expect(hues).toEqual(expected);
    // The share stays in the caption tier: a caption beside a key.
    expect(legend?.textContent).toContain('%');
  });

  it('draws no bar without a proven partition', () => {
    // `classes` is present only when the source proved it sums to the
    // count. Without it the count stands alone — never a bar guessed from
    // anything else under the census's anchor.
    const { container } = render(
      <ChainStateReadout source={source} record={record} census={bareCensus} />,
    );
    expect(container.querySelector('[data-chain-class-mix]')).toBeNull();
    expect(container.textContent).toContain('1,471,373');
    expect(container.textContent).not.toContain('PLAIN');
  });

  it('stands and dims the bar with the census, not with the index', () => {
    // Unusable index, proven census: the bar is the census's own and stays.
    const alone = render(
      <ChainStateReadout
        source={{ ...source, status: 'connecting' }}
        record={record}
        census={census()}
      />,
    );
    expect(alone.container.querySelector('[data-chain-class-mix]')).not.toBeNull();
    expect(alone.container.textContent).not.toContain('Live capacity');
    cleanup();

    // A stale index beside a fresh census leaves the bar at full strength.
    const staleIndex = render(
      <ChainStateReadout source={{ ...source, status: 'stale' }} record={record} census={census()} />,
    );
    expect(staleIndex.container.querySelector<HTMLElement>('[data-chain-class-mix]')?.style.opacity)
      .toBe('1');
    cleanup();

    // A stale census dims the bar with the row it partitions.
    const staleCensus = render(
      <ChainStateReadout source={source} record={record} census={census()} censusStale />,
    );
    expect(staleCensus.container.querySelector<HTMLElement>('[data-chain-class-mix]')?.style.opacity)
      .toBe('0.6');
  });

  it('anchors the census to the header when the anchors agree', () => {
    const { container } = render(
      <ChainStateReadout source={source} record={record} census={census()} />,
    );
    const row = container.querySelector('[data-population-row="Chain live"]');
    // One anchor stated once: a second identical anchor on the row would read
    // as a second measurement. The SCOPE stays — three counts on this screen
    // carry the word "live" and each one names the scope it is true in.
    expect(row?.querySelector('[data-population-scope]')?.textContent).toBe('CHAIN');
  });

  it('gives the census its own anchor when it trails the record', () => {
    const { container } = render(
      <ChainStateReadout
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
      <ChainStateReadout source={source} record={record} census={census()} censusStale />,
    );
    const row = container.querySelector<HTMLElement>('[data-population-row="Chain live"]');
    expect(row?.textContent).toContain('1,471,373');
    expect(row?.textContent).toContain('STALE');
    expect(row?.style.opacity).toBe('0.6');
  });

  it('says UNAVAILABLE rather than substituting a number it cannot prove', () => {
    const { container } = render(
      <ChainStateReadout source={source} record={record} census={null} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('UNAVAILABLE');
    expect(text).toContain('NO VALIDATED CENSUS');
    expect(container.querySelector('[data-chain-class-mix]')).toBeNull();
    // Never a synthesized zero, and never the retained count wearing the
    // chain's label.
    expect(text).not.toContain('ALL LIVE CELLS');
  });

  it('stands on the census alone when the index is unusable', () => {
    const { container } = render(
      <ChainStateReadout
        source={{ ...source, status: 'connecting' }}
        record={record}
        census={census()}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('CHAIN STATE');
    expect(text).toContain('AS OF #100');
    expect(text).toContain('1,471,373');
    expect(text).not.toContain('Live capacity');
    expect(text).not.toContain('Knowledge');
    expect(text).not.toContain('TOP ASSETS');
  });

  it('dims only stale indexed context, never a fresh census beside it', () => {
    const { container } = render(
      <ChainStateReadout
        source={{ ...source, status: 'stale' }}
        record={record}
        census={census()}
      />,
    );
    expect(container.textContent).toContain('STALE');
    const indexed = Array.from(
      container.querySelectorAll<HTMLElement>('[data-indexed-context]'),
    );
    expect(indexed.length).toBeGreaterThan(0);
    for (const section of indexed) expect(section.style.opacity).toBe(String(STALE_OPACITY));
    expect(container.querySelector<HTMLElement>(
      '[data-population-row="Chain live"]',
    )?.style.opacity).toBe('1');
    // The bar is the census's reading, so it is not indexed context.
    expect(container.querySelector('[data-indexed-context] [data-chain-class-mix]')).toBeNull();
  });
});

describe('ChainStateReadout folded', () => {
  it('keeps the header and the census count, and nothing else', () => {
    // The rail has collapsed: what survives is the reading a reader came to
    // the section for. Capacity and knowledge are both derivable from the
    // asset record the section header already anchors; the validated census
    // is not derivable from anything else on the panel.
    const { container } = render(
      <ChainStateReadout source={source} record={record} census={census()} folded />,
    );
    const section = container.querySelector('[data-chain-state]') as HTMLElement;

    expect(section.dataset.chainStateFolded).toBe('true');
    expect(section.textContent).toContain('CHAIN STATE');
    expect(section.textContent).toContain('1,471,373 LIVE');
    expect(section.textContent).toContain('AS OF #100');
    expect(section.textContent).not.toContain('Live capacity');
    expect(section.textContent).not.toContain('Knowledge');
    expect(section.textContent).not.toContain('DAO');
    expect(section.textContent).not.toContain('PLAIN');
  });

  it('is the full section without it', () => {
    const { container } = render(
      <ChainStateReadout source={source} record={record} census={census()} />,
    );
    const section = container.querySelector('[data-chain-state]') as HTMLElement;

    expect(section.dataset.chainStateFolded).toBeUndefined();
    expect(section.textContent).toContain('Live capacity');
    expect(section.textContent).toContain('Knowledge');
  });
});
