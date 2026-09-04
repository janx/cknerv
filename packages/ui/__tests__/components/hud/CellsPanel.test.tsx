import { emptyScriptCensus } from '@cknerv/cache';
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
  byAsset: { native: 3500, sudt: 900, xudt: 350, dao: 200, spore: 33, other: 0, object: 0, identity: 0 },
  scripts: emptyScriptCensus(),
};
const churn = { bornPerBlock: 3.2, spentPerBlock: 2.7, netPerBlock: 0.5 };

describe('CellsPanel', () => {
  it('renders only Cell metabolism and authoritative lifecycle counts', () => {
    const { container } = render(<CellsPanel stats={stats} churn={churn} reducedMotion />);
    const t = container.textContent ?? '';
    expect(t).toContain('CELL MESH');
    expect(t).toContain('元胞汤');
    expect(t).toContain('+0.5');      // net /blk
    expect(t).toContain('19,204');    // observed live
    // `stats.live` counts the backend's observation window, not the chain.
    // Beside a medium standing for millions of unresolved Cells, an
    // unqualified "Live cells" is not imprecise — it is contradictory.
    expect(t).toContain('Observed live');
    expect(t).not.toContain('Live cells');
    expect(t).toContain('28,431');    // total observed
    expect(t).toContain('9,227');     // dead
    expect(t).not.toContain('STAGE CAPACITY');
    expect(t).not.toContain('CHAIN CAPACITY');
    expect(t).not.toContain('1.21 GB');
    expect(container.querySelector('[data-cell-capacity-mode]')).toBeNull();
  });
  it('keeps the lifted row lifted after the rail collapses', () => {
    // The dense form is header, hero and ONE row, and that row is the lifted
    // one — a collapse that dropped the lift would put the panel's kept
    // reading back on the 11 px pitch the lift exists to end.
    const { container } = render(<CellsPanel stats={stats} churn={churn} reducedMotion dense />);
    const row = container.querySelector('[data-hud-stat-lift]') as HTMLElement;
    expect(row.dataset.hudStatLift).toBe('emphasis');
    expect(row.textContent).toContain('19,204');
  });

  it('keeps chain capacity and taxonomy out of the mesh panel', () => {
    const { container } = render(<CellsPanel stats={stats} churn={churn} reducedMotion />);
    const t = container.textContent ?? '';
    expect(t).not.toContain('STAGE ASSETS');
    expect(t).not.toContain('STAGE LOCKS');
    expect(t).not.toContain('sighash');
  });
  it('states BORN and DIED with a mark that is drawn, not typed', () => {
    // `▲`/`▼` are in no face `src/fonts` ships, and in no upstream face
    // either — Google's `latin` range stops before Geometric Shapes. The two
    // rows carried them as the first character of a LABEL, which meant the
    // one part of this panel encoding a direction was set in whatever the
    // reader's machine had. The direction is a mark now, and the words keep
    // saying it, which is why the marks stay out of the a11y tree.
    const { container } = render(<CellsPanel stats={stats} churn={churn} reducedMotion />);
    const t = container.textContent ?? '';
    expect(t).toContain('BORN');
    expect(t).toContain('DIED');
    expect(t).not.toMatch(/[\u25B2\u25BC]/);
    expect(Array.from(container.querySelectorAll('[data-direction-mark]'))
      .map((mark) => mark.getAttribute('data-direction-mark')))
      .toEqual(['up', 'down']);
    expect(container.querySelectorAll('[data-direction-mark][aria-hidden="true"]').length)
      .toBe(2);
  });

  it('has no Umbrella octagon (no svg path)', () => {
    const { container } = render(<CellsPanel stats={stats} churn={churn} reducedMotion />);
    expect(container.querySelectorAll('path').length).toBe(0);
  });
});
