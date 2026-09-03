import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AssetEcosystemRecord,
  ChainCensus,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import ChainCapacityReadout from '../../../src/components/hud/ChainCapacityReadout';

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

function census(overrides: Partial<ChainCensus> = {}): ChainCensus {
  return {
    source: 'node',
    as_of: { block: 100, hash: '0xblock100' },
    updated_at_ms: 1,
    live_cells: 1_471_373,
    ...overrides,
  };
}

describe('ChainCapacityReadout', () => {
  it('renders nothing without a proven chain measurement', () => {
    // No indexed record and no census: the block claims nothing, rather than
    // wearing local numbers as chain truth. The stage block carries those.
    const { container } = render(<ChainCapacityReadout />);
    expect(container.firstChild).toBeNull();

    const unusable = render(
      <ChainCapacityReadout source={{ ...source, status: 'connecting' }} record={record} />,
    );
    expect(unusable.container.firstChild).toBeNull();
  });

  it('names the unit once per byte row, in one column, in the CJK face', () => {
    // ⭐ THE TWO ROWS ARE ONE UNIT READ FROM BOTH ENDS — capacity is the bytes
    // the chain has sold, knowledge is the bytes standing in them — so 字节元
    // belongs to the PAIR rather than to either row, and it has to look like
    // it does. It stands in FRONT OF THE FIGURE, which is what it is the unit
    // of; beside the label it read as a second label, a third of the row away
    // from the number it qualifies.
    const { container } = render(
      <ChainCapacityReadout source={source} record={record} census={census()} />,
    );
    // Named rather than positional: `data-indexed-context` marks all three
    // indexed blocks in this readout, and only this one is the byte pair.
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-chain-byte-rows] > div'));
    expect(rows).toHaveLength(2);

    const units = rows.map((row) => Array.from(row.children)
      .find((child) => child.textContent === '字节元') as HTMLElement | undefined);
    expect(units.every(Boolean), 'both byte rows name the unit').toBe(true);

    // The column. The figures are right-aligned and of different lengths, so
    // what pins the companions is the measure RESERVED FOR THE VALUE — both
    // rows reserve the same one, so both companions land on one x. Asserted on
    // the value box, because jsdom has no font and lays every text run out at
    // zero width; the browser is where the x itself was checked.
    const valueWidths = rows.map((row) => (row.lastElementChild as HTMLElement).style.minWidth);
    expect(new Set(valueWidths).size, 'the two figures reserve one measure').toBe(1);
    // 84 is measured: `57.95 G·CKB` draws 75.9px live and neither row can
    // print past 12 characters of the mono voice.
    expect(valueWidths[0]).toBe('84px');
    // A floor, never a cap — a figure that outgrows it steps its own companion
    // left rather than being clipped.
    for (const row of rows) {
      expect((row.lastElementChild as HTMLElement).style.width).toBe('');
    }

    // And the companion comes BEFORE the figure in the row, not after the label.
    for (const row of rows) {
      const kids = Array.from(row.children);
      expect(kids).toHaveLength(3);
      expect(kids[1].textContent).toBe('字节元');
      expect(kids[2]).toBe(row.lastElementChild);
    }

    // And it is set in the face that has Chinese in it, at the 9px floor the
    // HUD renders Han at — `micro` is the Latin floor and a mincho glyph
    // carries several times the strokes in the same em.
    for (const unit of units) {
      expect(unit!.style.fontFamily).toContain('Huiwen-mincho');
      expect(unit!.style.fontSize).toBe('9px');
    }

    // Said once per row and nowhere else: the figures keep the `CKB` suffix
    // they already carry, so the unit is never printed twice in one reading.
    expect((container.textContent ?? '').match(/字节元/g)).toHaveLength(2);
  });

  it('shows the whole-chain overview under one stated anchor', () => {
    const { container } = render(
      <ChainCapacityReadout source={source} record={record} census={census()} />,
    );
    const text = container.textContent ?? '';

    expect(text).toContain('CHAIN CAPACITY');
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
    expect(container.querySelector('[data-readout-title]')?.textContent).toBe('CHAIN CAPACITY');
    expect(text).toContain('Live cells');
    expect(text).toContain('1,471,373');
    expect(text).toContain('OTTER');
    expect(text).toContain('34,386 HOLDERS');
    expect(text).not.toContain('INDEXED');
    expect(text).not.toContain('CKBADGER');
    expect(container.querySelector<HTMLElement>(
      '[data-asset-capacity-category="dao"]',
    )?.style.width).toBe('14.5%');
    // The chain block holds no local vocabulary — the stage block is the
    // other stage on this rail, not a nested child of this one.
    expect(text).not.toContain('STAGE SAMPLE');
    expect(text).not.toContain('RETAINED');
    expect(text).not.toContain('Rendered');
  });

  it('anchors the census to the header when the anchors agree', () => {
    const { container } = render(
      <ChainCapacityReadout source={source} record={record} census={census()} />,
    );
    const row = container.querySelector('[data-population-row="Chain live"]');
    // One anchor stated once: a second identical tag on the row would read
    // as a second measurement.
    expect(row?.querySelector('[data-population-scope]')).toBeNull();
  });

  it('gives the census its own anchor when it trails the record', () => {
    const { container } = render(
      <ChainCapacityReadout
        source={source}
        record={record}
        census={census({ as_of: { block: 98, hash: '0xblock98' } })}
      />,
    );
    const row = container.querySelector('[data-population-row="Chain live"]');
    expect(row?.querySelector('[data-population-scope]')?.textContent).toBe('AS OF #98');
  });

  it('keeps a stale census, labeled and dimmed', () => {
    const { container } = render(
      <ChainCapacityReadout source={source} record={record} census={census()} censusStale />,
    );
    const row = container.querySelector<HTMLElement>('[data-population-row="Chain live"]');
    expect(row?.textContent).toContain('1,471,373');
    expect(row?.textContent).toContain('STALE');
    expect(row?.style.opacity).toBe('0.6');
  });

  it('says UNAVAILABLE rather than substituting a number it cannot prove', () => {
    const { container } = render(
      <ChainCapacityReadout source={source} record={record} census={null} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('UNAVAILABLE');
    expect(text).toContain('NO VALIDATED CENSUS');
    // Never a synthesized zero, and never the retained count wearing the
    // chain's label.
    expect(text).not.toContain('ALL LIVE CELLS');
  });

  it('stands on the census alone when the index is unusable', () => {
    const { container } = render(
      <ChainCapacityReadout
        source={{ ...source, status: 'connecting' }}
        record={record}
        census={census()}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('CHAIN CAPACITY');
    expect(text).toContain('AS OF #100');
    expect(text).toContain('1,471,373');
    expect(text).not.toContain('Live capacity');
    expect(text).not.toContain('Knowledge');
    expect(text).not.toContain('TOP ASSETS');
  });

  it('dims only stale indexed context, never a fresh census beside it', () => {
    const { container } = render(
      <ChainCapacityReadout
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
    for (const section of indexed) expect(section.style.opacity).toBe('0.68');
    expect(container.querySelector<HTMLElement>(
      '[data-population-row="Chain live"]',
    )?.style.opacity).toBe('1');
  });
});
