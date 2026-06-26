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
  byLock: { sighash: 0, multisig: 0, acp: 0, omnilock: 0, other: 0 },
  byAsset: { native: 0, sudt: 0, xudt: 0, dao: 0, spore: 0, other: 0 },
};
const churn = { bornPerBlock: 3.2, spentPerBlock: 2.7, netPerBlock: 0.5 };

describe('CellsPanel', () => {
  it('renders the flow vital sign, authoritative counts, and the in-view block', () => {
    const { container } = render(<CellsPanel stats={stats} churn={churn} reducedMotion />);
    const t = container.textContent ?? '';
    expect(t).toContain('CELLS');
    expect(t).toContain('细胞');
    expect(t).toContain('+0.5');      // net /blk
    expect(t).toContain('19,204');    // live
    expect(t).toContain('28,431');    // total observed
    expect(t).toContain('9,227');     // dead
    expect(t).toContain('In view');
    expect(t).toContain('4,983');
    expect(t).toContain('1.21 GB');   // capacity
    expect(t).toContain('31%');       // data pct = round(1545/4983*100)
  });
  it('has no Umbrella octagon (no svg path)', () => {
    const { container } = render(<CellsPanel stats={stats} churn={churn} reducedMotion />);
    expect(container.querySelectorAll('path').length).toBe(0);
  });
});
