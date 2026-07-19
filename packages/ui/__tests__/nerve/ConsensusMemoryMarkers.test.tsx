import type { ReactNode } from 'react';
import type { Cell } from '@cknerv/types';
import { emptyCellsCache } from '@cknerv/cache';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CellGalaxyProvider } from '../../src/hooks/cellGalaxyContext';
import ConsensusMemoryMarkers from '../../src/nerve/ConsensusMemoryMarkers';
import type {
  ConsensusMemoryTraceFocus,
  ConsensusMemoryTraceFocusSource,
} from '../../src/nerve/consensusMemoryTrace';

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

function focusSource(
  id: number,
  hashDigit: string,
  startsAtSec: number,
  arrivesAtSec: number,
  targetId = 5,
): ConsensusMemoryTraceFocusSource {
  return {
    id,
    contentHash: `0x${hashDigit.repeat(64)}`,
    outPoint: { tx_hash: `0x${id}`, index: 0 },
    birthBlock: 1,
    startsAtSec,
    arrivesAtSec,
    routes: [{
      targetId,
      path: [id, id + 20, targetId],
      color: [0.2, 0.8, 1],
      hopCount: 2,
      hopMs: (arrivesAtSec - startsAtSec) * 500,
      startsAtSec,
      arrivesAtSec,
    }],
  };
}

function focus(overrides: Partial<ConsensusMemoryTraceFocus> = {}): ConsensusMemoryTraceFocus {
  return {
    key: '7:1',
    sourceKind: 'witness',
    sources: [focusSource(8, 'a', 1.1, 1.8)],
    routedSourceCount: 1,
    targetIds: [5],
    startedAtSec: 1,
    endsAtSec: 4,
    evidenceFocusSourceId: null,
    routeHopFocus: null,
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
    expect(target?.querySelectorAll('circle')).toHaveLength(0);
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

  it('numbers every routed witness and summarizes the real convergence count', () => {
    const cache = emptyCellsCache();
    cache.cells.set(8, cell(8, 'a'));
    cache.cells.set(9, cell(9, 'c'));
    cache.cells.set(5, cell(5, 'b'));

    const { container } = render(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers focus={focus({
          sources: [
            focusSource(8, 'a', 1.1, 1.8),
            focusSource(9, 'c', 1.32, 2.02),
          ],
          routedSourceCount: 2,
        })} />
      </CellGalaxyProvider>,
    );

    const sources = container.querySelectorAll('[data-memory-endpoint="source"]');
    expect(sources).toHaveLength(2);
    expect(sources[0].textContent).toContain('01/02');
    expect(sources[1].textContent).toContain('02/02');
    expect(sources[1].getAttribute('data-memory-source-index')).toBe('2');
    expect(container.querySelector('[data-memory-endpoint="target"]')?.textContent)
      .toContain('02 WITNESSES');
  });

  it('marks the selected real source while retaining the target as context', () => {
    const cache = emptyCellsCache();
    cache.cells.set(8, cell(8, 'a'));
    cache.cells.set(9, cell(9, 'c'));
    cache.cells.set(5, cell(5, 'b'));
    const traceFocus = focus({
      sources: [
        focusSource(8, 'a', 1.1, 1.8),
        focusSource(9, 'c', 1.32, 2.02),
      ],
      routedSourceCount: 2,
      evidenceFocusSourceId: 9,
    });
    const { container } = render(
      <CellGalaxyProvider value={cache}>
        <ConsensusMemoryMarkers focus={traceFocus} evidenceFocusSourceId={9} />
      </CellGalaxyProvider>,
    );

    const sources = container.querySelectorAll('[data-memory-endpoint="source"]');
    expect(sources[0].getAttribute('data-memory-evidence-focus')).toBe('passive');
    expect(sources[1].getAttribute('data-memory-evidence-focus')).toBe('active');
    expect(sources[1].getAttribute('data-memory-source-id')).toBe('9');
    expect(sources[1].getAttribute('data-memory-route')).toBe('9>29>5');
    expect(sources[1].getAttribute('data-memory-route-hops')).toBe('2');
    expect(sources[1].querySelector('[data-memory-route-proof="true"]')?.textContent)
      .toContain('CELL #9 · H02 · 700 MS');
    expect(container.querySelector('[data-memory-endpoint="target"]')
      ?.getAttribute('data-memory-evidence-focus')).toBe('context');
  });
});
