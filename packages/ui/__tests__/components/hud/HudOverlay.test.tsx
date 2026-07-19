import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { ChainEntry, Peer, ChainNode, Cell, CellLink } from '@cknerv/types';

// The embedded portrait spins a real WebGL context — stub it in jsdom.
vi.mock('../../../src/components/hud/CellNucleusPortrait', () => ({
  default: ({ cell, traceReadout, traceResponseRef, traceEvidenceFocusSourceId }: {
    cell: { content_hash: string };
    traceReadout?: { stage: string } | null;
    traceResponseRef?: { current: unknown };
    traceEvidenceFocusSourceId?: number | null;
  }) => (
    <div
      data-testid="portrait"
      data-hash={cell.content_hash}
      data-trace-stage={traceReadout?.stage ?? ''}
      data-response-ref={traceResponseRef ? 'true' : 'false'}
      data-evidence-focus-source={traceEvidenceFocusSourceId ?? ''}
    />
  ),
  SCAN_PERIOD_S: 4.2,
}));

import HudOverlay from '../../../src/components/hud/HudOverlay';
import type { CellsStats } from '../../../src/derives/cellsStats.derive';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const chain: ChainEntry = {
  tip: 16204887, recent_blocks: [], recent_tx_hashes: [], total_blocks: 4217, total_txs: 9338,
  mempool: { pending: 312, proposed: 64, orphan: 0, total_tx_size: 0, total_tx_cycles: 0, min_fee_rate: 0 },
  epoch: { number: 11042, index: 842, length: 1800 }, median_time_ms: 0, difficulty: '0x0',
  chain_name: 'ckb', reorgs: 0, recent_block_intervals_ms: [8000], recent_block_tx_counts: [2], recent_block_sizes: [500],
  ibd: false, best_known_block: 16204887,
};
const peers: Peer[] = [{ node_id: 'n', addr: 'a', direction: 'outbound', version: '0.201.0', latency_ms: 84, best_known: 16204887, connected_ms: 1000 }];
const localNode: ChainNode = { id: 'ckb:local', label: 'local', is_miner: false, version: '0.201.0', connections: 47 };
const cellsStats: CellsStats = { born: 28431, live: 19204, dead: 9227, byKind: { wallet: 11302, dex: 4118, cf: 2401, ckbloom: 1383, generic: 0 }, capacityShannons: 0, inView: 19204, dataBearing: 0, byLock: { sighash: 0, multisig: 0, acp: 0, omnilock: 0, other: 0 }, byAsset: { native: 0, sudt: 0, xudt: 0, dao: 0, spore: 0, other: 0 } };

describe('HudOverlay', () => {
  it('mounts a non-interactive overlay containing every panel', () => {
    const { container } = render(<HudOverlay chain={chain} peers={peers} localNode={localNode} cellsStats={cellsStats} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.pointerEvents).toBe('none');
    const t = container.textContent ?? '';
    expect(t).toContain('CKNERV');       // status strip
    expect(t).toContain('COMMON KNOWLEDGE BASE'); // readout
    expect(t).toContain('PULSE');                 // ecg
    expect(t).toContain('PEER MESH');    // peer mesh
    expect(t).toContain('CELL MESH');    // cell mesh
  });

  it('shows the cell detail and a node detail at the same time (independent axes)', () => {
    const mockCell: Cell = {
      id: 7, born_at_ms: 1, death_at_ms: null, birth_block: 16204800, tag: 'wallet',
      pos_seed: [0, 0, 0], out_point: { tx_hash: '0x' + 'ab'.repeat(32), index: 0 },
      capacity: 6_100_000_000, data_hex: '0x', content_hash: '0x' + 'cd'.repeat(32),
    };
    const { container } = render(
      <HudOverlay
        chain={chain} peers={peers} localNode={localNode} cellsStats={cellsStats}
        selectedCell={mockCell} selectedNode={localNode}
      />,
    );
    const t = container.textContent ?? '';
    expect(t).toContain('CAPACITY'); // CELL detail (galaxy axis) is present…
    expect(t).toContain('OBSERVER'); // …AND the NODE detail (network axis) at the same time
  });

  it('threads retained Cell origin evidence into the detail memory plate', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const mockCell: Cell = {
      id: 7, born_at_ms: 1, death_at_ms: null, birth_block: 16204800, tag: 'wallet',
      pos_seed: [0, 0, 0], out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: 0 },
      capacity: 6_100_000_000, data_hex: '0x', content_hash: `0x${'cd'.repeat(32)}`,
    };
    const origin: CellLink = {
      seq: 3, tx_hash: mockCell.out_point.tx_hash, block: mockCell.birth_block,
      from_ids: [1], to_ids: [mockCell.id], parents: [], tag: null, at_ms: 10,
    };
    const onTraceCellWrite = vi.fn();
    const { container, getByRole } = render(
      <HudOverlay
        chain={chain} peers={peers} localNode={localNode} cellsStats={cellsStats}
        selectedCell={mockCell} recentCellLinks={[origin]}
        cellTraceSource="input"
        onTraceCellWrite={onTraceCellWrite}
      />,
    );
    expect(container.textContent).toContain('WRITE OBSERVED');
    fireEvent.click(getByRole('button', { name: 'recall causal path' }));
    expect(onTraceCellWrite).toHaveBeenCalledWith(origin.seq);
  });

  it('threads the authoritative recall stage into the selected Cell detail', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const mockCell: Cell = {
      id: 7, born_at_ms: 1, death_at_ms: null, birth_block: 16204800, tag: 'wallet',
      pos_seed: [0, 0, 0], out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: 0 },
      capacity: 6_100_000_000, data_hex: '0x', content_hash: `0x${'cd'.repeat(32)}`,
    };
    const origin: CellLink = {
      seq: 3, tx_hash: mockCell.out_point.tx_hash, block: mockCell.birth_block,
      from_ids: [1, 2], to_ids: [mockCell.id], parents: [], tag: null, at_ms: 10,
    };
    const { container } = render(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        selectedCell={mockCell}
        recentCellLinks={[origin]}
        tracedCellWriteSeq={origin.seq}
        cellTraceSource="input"
        cellTraceReadout={{
          key: '3:7:1',
          targetCellId: 7,
          sourceKind: 'input',
          stage: 'converging',
          sourceCount: 2,
          arrivedSourceCount: 1,
          resolvedSourceCount: 0,
          evidence: [
            {
              sourceId: 1,
              ordinal: 1,
              contentHash: `0x${'1'.repeat(64)}`,
              state: 'arrived',
              sourceOutPoint: { tx_hash: `0x${'1'.repeat(64)}`, index: 0 },
              sourceBirthBlock: 16204798,
              route: [1, 7],
              hopCount: 1,
              routeDurationMs: 420,
            },
            {
              sourceId: 2,
              ordinal: 2,
              contentHash: `0x${'2'.repeat(64)}`,
              state: 'routing',
              sourceOutPoint: { tx_hash: `0x${'2'.repeat(64)}`, index: 1 },
              sourceBirthBlock: 16204799,
              route: [2, 4, 7],
              hopCount: 2,
              routeDurationMs: 780,
            },
          ],
        }}
        cellTraceResponseRef={{ current: null }}
        cellTraceEvidenceFocusSourceId={2}
        onCellTraceEvidenceFocusChange={() => {}}
      />,
    );

    expect(container.querySelector('[data-memory-read-state="converging"]')).not.toBeNull();
    expect(container.textContent).toContain('ARRIVED 1/2');
    expect(container.querySelector('[data-testid="portrait"]')
      ?.getAttribute('data-trace-stage')).toBe('converging');
    expect(container.querySelector('[data-testid="portrait"]')
      ?.getAttribute('data-response-ref')).toBe('true');
    expect(container.querySelector('[data-testid="portrait"]')
      ?.getAttribute('data-evidence-focus-source')).toBe('2');
    expect(container.querySelector('[data-memory-evidence="2"]')
      ?.getAttribute('data-memory-evidence-focus')).toBe('active');
  });

  it('does not raise CAUTION when blocks merely run slower than the 8s target', () => {
    // R2: a uniformly slower-but-steady cadence is the chain's own rhythm, not an alarm.
    const steadySlow: ChainEntry = { ...chain, recent_block_intervals_ms: Array.from({ length: 60 }, () => 12000), last_block_ts_ms: Date.now() };
    const { container } = render(<HudOverlay chain={steadySlow} peers={peers} localNode={localNode} cellsStats={cellsStats} />);
    expect(container.textContent).not.toContain('CAUTION');
  });

  it('raises CAUTION when the recent window slows well past the chain\'s own baseline', () => {
    // 40 blocks at 8s establish the baseline; the last 20 at 14s are a genuine regime shift.
    const regimeShift: ChainEntry = {
      ...chain,
      recent_block_intervals_ms: [...Array.from({ length: 40 }, () => 8000), ...Array.from({ length: 20 }, () => 14000)],
      last_block_ts_ms: Date.now(),
    };
    const { container } = render(<HudOverlay chain={regimeShift} peers={peers} localNode={localNode} cellsStats={cellsStats} />);
    expect(container.textContent).toContain('CAUTION');
  });

  it('threads the build version into the status strip', () => {
    const { container } = render(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        build={{ version: '61922ba@20260630', href: 'https://github.com/janx/cknerv/commit/61922ba' }}
      />,
    );
    expect(container.textContent).toContain('61922ba@20260630');
  });
});
