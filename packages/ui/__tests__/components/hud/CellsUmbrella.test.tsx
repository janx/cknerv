import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import CellsUmbrella from '../../../src/components/hud/CellsUmbrella';
import type { CellsStats } from '../../../src/derives/cellsStats.derive';

afterEach(cleanup);

const stats: CellsStats = {
  born: 28431, live: 19204, dead: 9227,
  byKind: { wallet: 11302, dex: 4118, cf: 2401, ckbloom: 1383, generic: 0 },
  capacityShannons: 489201137700000000,
  inView: 19204,
  dataBearing: 0,
};

describe('CellsUmbrella', () => {
  it('renders counts, by-kind and an 8-wedge gauge', () => {
    const { container } = render(<CellsUmbrella stats={stats} />);
    const t = container.textContent ?? '';
    expect(t).toContain('CELLS');
    expect(t).toContain('细胞');
    expect(t).toContain('28,431');
    expect(t).toContain('19,204');
    expect(t).toContain('9,227');
    expect(t).toContain('11,302'); // wallet
    expect(container.querySelectorAll('path').length).toBe(8);
  });
});
