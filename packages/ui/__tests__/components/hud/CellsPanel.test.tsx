import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import CellsPanel from '../../../src/components/hud/CellsPanel';
import type { CellsStats } from '../../../src/derives/cellsStats.derive';
import type {
  AssetEcosystemRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';

afterEach(cleanup);

const stats: CellsStats = {
  born: 28431, live: 19204, dead: 9227,
  byKind: { wallet: 0, dex: 0, cf: 0, ckbloom: 0, generic: 19204 },
  capacityShannons: 121_000_000_000_000_000, // 1.21e17 shannons = 1.21e9 bytes = 1.21 GB
  inView: 4983, dataBearing: 1545,
  byLock: { sighash: 3200, multisig: 1100, acp: 450, omnilock: 0, other: 233 },
  byAsset: { native: 3500, sudt: 900, xudt: 350, dao: 200, spore: 33, other: 0 },
};
const churn = { bornPerBlock: 3.2, spentPerBlock: 2.7, netPerBlock: 0.5 };
const enrichmentSource: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['asset_ecosystem'],
  validated_anchor: { block: 100, hash: '0xblock100' },
};
const assetEcosystem: AssetEcosystemRecord = {
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

describe('CellsPanel', () => {
  it('renders the flow vital sign, authoritative counts, and the in-view block', () => {
    const { container } = render(<CellsPanel stats={stats} churn={churn} reducedMotion />);
    const t = container.textContent ?? '';
    expect(t).toContain('CELL MESH');
    expect(t).toContain('共识细胞网络');
    expect(t).toContain('+0.5');      // net /blk
    expect(t).toContain('19,204');    // live
    expect(t).toContain('28,431');    // total observed
    expect(t).toContain('9,227');     // dead
    expect(t).toContain('Retained');
    expect(t).toContain('4,983');
    expect(t).toContain('1.21 GB');   // capacity
    expect(container.querySelector('[data-cell-capacity-mode="retained"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-cell-capacity-mode]')).toHaveLength(1);
  });
  it('renders the asset + lock taxonomy bars', () => {
    const { container } = render(<CellsPanel stats={stats} churn={churn} reducedMotion />);
    const t = container.textContent ?? '';
    expect(t).toContain('ASSETS');
    expect(t).toContain('LOCKS');
    expect(t).toContain('CKB');       // native legend label
    expect(t).toContain('sighash');   // lock legend label
    expect(t).not.toContain('Data · plain');
  });
  it('has no Umbrella octagon (no svg path)', () => {
    const { container } = render(<CellsPanel stats={stats} churn={churn} reducedMotion />);
    expect(container.querySelectorAll('path').length).toBe(0);
  });
  it('enhances retained capacity with a whole-chain-to-Galaxy scope', () => {
    const { container } = render(
      <CellsPanel
        stats={stats}
        churn={churn}
        enrichmentSource={enrichmentSource}
        assetEcosystem={assetEcosystem}
        reducedMotion
      />,
    );
    const t = container.textContent ?? '';
    expect(t).toContain('INDEXED CHAIN CAPACITY');
    expect(t).toContain('#100');
    expect(t).toContain('57,763,209,638.48 CKB');
    expect(t).toContain('159.9 MB');
    expect(t).toContain('OTTER');
    expect(t).toContain('34,386 HOLDERS');
    // Every useful base datum remains inside the nested Galaxy window.
    expect(t).toContain('4,983 RETAINED CELLS');
    expect(t).toContain('1.21 GB');
    expect(t).toContain('WINDOW ASSETS');
    expect(t).toContain('WINDOW LOCKS');
    expect(t).toContain('sighash');
    expect(container.querySelector('[data-retained-capacity-context]')).not.toBeNull();
    expect(container.querySelector('[data-cell-capacity-mode="retained"]')).toBeNull();
    expect(container.querySelectorAll('[data-cell-capacity-mode]')).toHaveLength(1);
    expect(Array.from(container.querySelectorAll('[data-scope-stage]')).map(
      (stage) => stage.getAttribute('data-scope-stage'),
    )).toEqual(['indexed-chain', 'galaxy-window']);
    const daoBucket = container.querySelector<HTMLElement>(
      '[data-asset-capacity-category="dao"]',
    );
    expect(daoBucket?.style.width).toBe('14.5%');
  });
  it('does not add indexed ecosystem UI without the optional source', () => {
    const { container } = render(<CellsPanel stats={stats} churn={churn} reducedMotion />);
    expect(container.textContent).not.toContain('INDEXED CHAIN CAPACITY');
  });

  it('keeps the base capacity view while ckbadger has no usable record', () => {
    const { container } = render(
      <CellsPanel
        stats={stats}
        churn={churn}
        enrichmentSource={{ ...enrichmentSource, status: 'connecting' }}
        assetEcosystem={assetEcosystem}
        reducedMotion
      />,
    );

    expect(container.querySelector('[data-cell-capacity-mode="retained"]')).not.toBeNull();
    expect(container.textContent).not.toContain('INDEXED CHAIN CAPACITY');
  });

  it('dims stale indexed scope without dimming direct Galaxy data', () => {
    const { container } = render(
      <CellsPanel
        stats={stats}
        churn={churn}
        enrichmentSource={{ ...enrichmentSource, status: 'stale' }}
        assetEcosystem={assetEcosystem}
        reducedMotion
      />,
    );

    expect((container.querySelector('[data-scope-stage="indexed-chain"]') as HTMLElement).style.opacity).toBe('0.68');
    expect((container.querySelector('[data-scope-stage="galaxy-window"]') as HTMLElement).style.opacity).toBe('');
  });
});
