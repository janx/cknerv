import type { ReactNode } from 'react';
import type { Cell } from '@cknerv/types';
import { emptyCellsCache } from '@cknerv/cache';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CellGalaxyProvider } from '../../src/hooks/cellGalaxyContext';
import ConsensusMemoryMarkers from '../../src/nerve/ConsensusMemoryMarkers';
import type { ConsensusMemoryTraceFocus } from '../../src/nerve/consensusMemoryTrace';

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../src/tweaks/useSimFrame', () => ({
  useSimFrame: () => undefined,
}));

function cell(id: number, hashDigit: string): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [id, id + 1, id + 2],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 0,
    data_hex: '0x',
    content_hash: `0x${hashDigit.repeat(64)}`,
  };
}

function focus(overrides: Partial<ConsensusMemoryTraceFocus> = {}): ConsensusMemoryTraceFocus {
  return {
    key: '7:1',
    sourceKind: 'witness',
    sourceIds: [8],
    targetIds: [5],
    startedAtSec: 1,
    endsAtSec: 4,
    ...overrides,
  };
}

describe('ConsensusMemoryMarkers', () => {
  it('binds honest source and record labels to retained Cell endpoints', () => {
    const cache = emptyCellsCache();
    cache.cells.set(8, cell(8, 'a'));
    cache.cells.set(5, cell(5, 'b'));

    const { container } = render(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers focus={focus()} />
      </CellGalaxyProvider>,
    );

    const source = container.querySelector('[data-memory-endpoint="source"]');
    const target = container.querySelector('[data-memory-endpoint="target"]');
    expect(source?.getAttribute('data-memory-source-kind')).toBe('witness');
    expect(source?.textContent).toContain('LINEAGE WITNESS');
    expect(source?.textContent).toContain('谱系见证');
    expect(source?.textContent).toContain('AAAAAAAAAA');
    expect(target?.textContent).toContain('SHARED RECORD');
    expect(target?.textContent).toContain('共识记录');
    expect(target?.textContent).toContain('BBBBBBBBBB');
  });

  it('never fabricates a marker when the planned endpoint is absent', () => {
    const cache = emptyCellsCache();
    cache.cells.set(5, cell(5, 'b'));

    const { container } = render(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers focus={focus()} />
      </CellGalaxyProvider>,
    );

    expect(container.querySelector('[data-memory-endpoint="source"]')).toBeNull();
    expect(container.querySelector('[data-memory-endpoint="target"]')).not.toBeNull();
  });

  it('distinguishes an exact retained transaction input from a lineage witness', () => {
    const cache = emptyCellsCache();
    cache.cells.set(8, cell(8, 'a'));
    cache.cells.set(5, cell(5, 'b'));

    const { container } = render(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers focus={focus({ sourceKind: 'input' })} />
      </CellGalaxyProvider>,
    );

    const source = container.querySelector('[data-memory-endpoint="source"]');
    expect(source?.getAttribute('data-memory-source-kind')).toBe('input');
    expect(source?.textContent).toContain('RETAINED INPUT');
    expect(source?.textContent).toContain('交易输入');
  });
});
