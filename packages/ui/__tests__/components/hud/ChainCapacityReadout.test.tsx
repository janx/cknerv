import { emptyScriptCensus } from '@cknerv/cache';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AssetEcosystemRecord,
  EnrichmentSourceStatus,
} from '@cknerv/types';
import ChainCapacityReadout from '../../../src/components/hud/ChainCapacityReadout';
import type { CellsStats } from '../../../src/derives/cellsStats.derive';

afterEach(cleanup);

const stats: CellsStats = {
  born: 28_431,
  live: 19_204,
  dead: 9_227,
  byKind: { wallet: 0, dex: 0, cf: 0, ckbloom: 0, generic: 19_204 },
  capacityShannons: 121_000_000_000_000_000,
  inView: 4_983,
  dataBearing: 1_545,
  byLock: { sighash: 3_200, multisig: 1_100, acp: 450, omnilock: 0, other: 233 },
  byAsset: { native: 3_500, sudt: 900, xudt: 350, dao: 200, spore: 33, other: 0 },
  scripts: emptyScriptCensus(),
};

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

describe('ChainCapacityReadout', () => {
  it('shows the direct Galaxy window as the complete base view', () => {
    const { container } = render(<ChainCapacityReadout stats={stats} />);
    const text = container.textContent ?? '';

    expect(text).toContain('GALAXY WINDOW');
    expect(text).toContain('4,983 RETAINED CELLS');
    expect(text).toContain('1.21 GB');
    expect(text).toContain('WINDOW ASSETS');
    expect(text).toContain('WINDOW LOCKS');
    expect(text).toContain('default');
    expect(text).not.toContain('CHAIN CAPACITY');
    expect(container.querySelector('[data-cell-capacity-mode="retained"]')).not.toBeNull();
  });

  it('upgrades to one whole-chain-to-Galaxy hierarchy without losing base data', () => {
    const { container } = render(
      <ChainCapacityReadout stats={stats} source={source} record={record} />,
    );
    const text = container.textContent ?? '';

    expect(text).toContain('CHAIN CAPACITY');
    expect(text).toContain('AS OF #100');
    expect(text).toContain('57,763,209,638.48 CKB');
    expect(text).toContain('159.9 MB');
    expect(text).toContain('OTTER');
    expect(text).toContain('34,386 HOLDERS');
    expect(text).toContain('GALAXY WINDOW');
    expect(text).toContain('1.21 GB');
    expect(text).toContain('WINDOW ASSETS');
    expect(text).toContain('WINDOW LOCKS');
    expect(text).not.toContain('INDEXED');
    expect(text).not.toContain('CKBADGER');
    expect(Array.from(container.querySelectorAll('[data-scope-stage]')).map(
      (stage) => stage.getAttribute('data-scope-stage'),
    )).toEqual(['indexed-chain', 'galaxy-window']);
    expect(Array.from(container.querySelectorAll<HTMLElement>('[data-scope-stage]')).map(
      (stage) => stage.dataset.scopeLayout,
    )).toEqual(['flush', 'flush']);
    expect(container.querySelectorAll('[data-scope-header]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-scope-content]')).toHaveLength(2);
    expect(container.querySelector<HTMLElement>(
      '[data-asset-capacity-category="dao"]',
    )?.style.width).toBe('14.5%');
  });

  it('keeps the direct Galaxy window when enrichment is unusable', () => {
    const { container } = render(
      <ChainCapacityReadout
        stats={stats}
        source={{ ...source, status: 'connecting' }}
        record={record}
      />,
    );

    expect(container.querySelector('[data-cell-capacity-mode="retained"]')).not.toBeNull();
    expect(container.textContent).not.toContain('CHAIN CAPACITY');
  });

  it('dims only stale whole-chain context', () => {
    const { container } = render(
      <ChainCapacityReadout
        stats={stats}
        source={{ ...source, status: 'stale' }}
        record={record}
      />,
    );

    expect((container.querySelector('[data-scope-stage="indexed-chain"]') as HTMLElement).style.opacity).toBe('0.68');
    expect((container.querySelector('[data-scope-stage="galaxy-window"]') as HTMLElement).style.opacity).toBe('');
  });
});
