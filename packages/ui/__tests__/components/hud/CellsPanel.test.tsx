import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import CellsPanel from '../../../src/components/hud/CellsPanel';
import type { CellsStats } from '../../../src/derives/cellsStats.derive';

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
    expect(t).toContain('In view');
    expect(t).toContain('4,983');
    expect(t).toContain('1.21 GB');   // capacity
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
});
