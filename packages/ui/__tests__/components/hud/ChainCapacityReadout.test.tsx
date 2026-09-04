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

describe('ChainCapacityReadout folded', () => {
  it('keeps the header and the census count, and nothing else', () => {
    // The rail has collapsed: what survives is the reading a reader came to
    // the section for. Capacity and knowledge are both derivable from the
    // asset record the section header already anchors; the validated census
    // is not derivable from anything else on the panel.
    const { container } = render(
      <ChainCapacityReadout source={source} record={record} census={census()} folded />,
    );
    const section = container.querySelector('[data-chain-capacity]') as HTMLElement;

    expect(section.dataset.chainCapacityFolded).toBe('true');
    expect(section.textContent).toContain('CHAIN CAPACITY');
    expect(section.textContent).toContain('1,471,373 LIVE');
    expect(section.textContent).toContain('AS OF #100');
    expect(section.textContent).not.toContain('Live capacity');
    expect(section.textContent).not.toContain('Knowledge');
    expect(section.textContent).not.toContain('DAO');
  });

  it('is the full section without it', () => {
    const { container } = render(
      <ChainCapacityReadout source={source} record={record} census={census()} />,
    );
    const section = container.querySelector('[data-chain-capacity]') as HTMLElement;

    expect(section.dataset.chainCapacityFolded).toBeUndefined();
    expect(section.textContent).toContain('Live capacity');
    expect(section.textContent).toContain('Knowledge');
  });
});
