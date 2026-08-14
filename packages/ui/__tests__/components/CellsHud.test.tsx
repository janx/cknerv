import { emptyScriptCensus } from '@cknerv/cache';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import CellsHud, { formatCommonKnowledgeBytes } from '../../src/components/CellsHud';
import type { CellsStats } from '../../src/derives/cellsStats.derive';

// drei <Text> tries to load remote fonts in jsdom; stub as <span> so children
// attach to the DOM and textContent assertions can read them. We render
// CellsHud directly (no <Canvas>) so R3F's custom reconciler is bypassed.
vi.mock('@react-three/drei', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const stats: CellsStats = {
  born: 12,
  live: 10,
  dead: 2,
  byKind: { wallet: 3, dex: 4, cf: 2, ckbloom: 1, generic: 0 },
  capacityShannons: 12_345_600_000_000,
  inView: 10,
  dataBearing: 0,
  byLock: { sighash: 0, multisig: 0, acp: 0, omnilock: 0, other: 0 },
  byAsset: { native: 0, sudt: 0, xudt: 0, dao: 0, spore: 0, other: 0 },
  scripts: emptyScriptCensus(),
};

describe('CellsHud', () => {
  it('renders header and counts', () => {
    const { container } = render(
      <CellsHud x={0} y={0} width={240} stats={stats} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('CELLS');
    expect(text).toContain('TOTAL');
    expect(text).toContain('ALIVE');
    expect(text).toContain('DEAD');
    expect(text).toContain('BY KIND');
    expect(text).toContain('COMMON KNOWLEDGE');
    expect(text).toContain('WALLET');
    expect(text).toContain('DEX');
    expect(text).toContain('CF');
    expect(text).toContain('CKBLOOM');
  });

  it('reads chain counters for TOTAL / ALIVE / DEAD', () => {
    const { container } = render(
      <CellsHud x={0} y={0} width={240} stats={stats} />,
    );
    const text = container.textContent ?? '';
    expect(text).toMatch(/TOTAL\s*12/);
    expect(text).toMatch(/ALIVE\s*10/);
    expect(text).toMatch(/DEAD\s*2/);
  });

  it('collapses GENERIC row when count is zero', () => {
    const { container } = render(
      <CellsHud x={0} y={0} width={240} stats={stats} />,
    );
    expect(container.textContent ?? '').not.toContain('GENERIC');
  });
});

describe('formatCommonKnowledgeBytes', () => {
  it('converts shannons to whole bytes with thousands separators', () => {
    expect(formatCommonKnowledgeBytes(100_000_000)).toBe('1 Bytes');
    expect(formatCommonKnowledgeBytes(0)).toBe('0 Bytes');
    expect(formatCommonKnowledgeBytes(12_345_600_000_000)).toBe('123,456 Bytes');
  });

  it('rounds sub-byte shannon residue to the nearest whole byte', () => {
    // 100_000_001 shannons → 1.00000001 bytes → 1 byte after Math.round.
    expect(formatCommonKnowledgeBytes(100_000_001)).toBe('1 Bytes');
  });
});
