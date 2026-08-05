import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type {
  Cell,
  CellLink,
  ChainEntry,
  ChainNode,
  DaoStateRecord,
  EnrichmentSourceStatus,
  Peer,
} from '@cknerv/types';

// The embedded portrait spins a real WebGL context — stub it in jsdom.
vi.mock('../../../src/components/hud/CellNucleusPortrait', () => ({
  default: ({ cell, traceReadout, traceResponseRef, traceEvidenceFocusSourceId, onIdentityProofRead }: {
    cell: { content_hash: string };
    traceReadout?: { stage: string } | null;
    traceResponseRef?: { current: unknown };
    traceEvidenceFocusSourceId?: number | null;
    onIdentityProofRead?: (
      kind: 'address' | 'content' | 'anchor',
    ) => void;
  }) => (
    <div
      data-testid="portrait"
      data-hash={cell.content_hash}
      data-trace-stage={traceReadout?.stage ?? ''}
      data-response-ref={traceResponseRef ? 'true' : 'false'}
      data-evidence-focus-source={traceEvidenceFocusSourceId ?? ''}
    >
      <button
        type="button"
        data-testid="content-address-read-resolved"
        onClick={() => onIdentityProofRead?.('content')}
      />
    </div>
  ),
  SCAN_PERIOD_S: 4.2,
}));

import HudOverlay from '../../../src/components/hud/HudOverlay';
import type { CellsStats } from '../../../src/derives/cellsStats.derive';
import type {
  CellIdentityProofBinding,
} from '../../../src/derives/cellIdentityProof.derive';

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
const enrichmentSource: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['dao_state'],
  validated_anchor: { block: 100, hash: '0xblock100' },
};
const daoState: DaoStateRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: '0xblock100' },
  statistics_block: 99,
  updated_at_ms: Date.now(),
  total_deposited_shannons: '837703738002110308',
  total_depositors: 16_740,
  active_deposits: 22_659,
  pending_withdrawal_shannons: '77523020877862416',
  unclaimed_compensation_shannons: '81345902996799859',
  estimated_apc_bps: 201,
};

function identityBinding(
  cellId: number,
  phase: CellIdentityProofBinding['phase'] = 'verified',
): CellIdentityProofBinding {
  return {
    cellId,
    resolvedKinds: ['address', 'content', 'anchor'],
    phase,
    revision: 4,
    changedAtMs: 100,
    lastResolvedKind: 'anchor',
    reducedMotion: true,
  };
}

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
    const leftRail = container.querySelector('[data-hud-left-rail]') as HTMLElement;
    const chainCluster = container.querySelector('[data-hud-chain-cluster]') as HTMLElement;
    const chainScroll = container.querySelector('[data-chain-panel-scroll]') as HTMLElement;
    const pulse = container.querySelector('[data-hud-pulse-anchor]') as HTMLElement;
    const meshRail = container.querySelector('.cknerv-mesh-rail') as HTMLElement;
    expect(leftRail.textContent).toContain('COMMON KNOWLEDGE BASE');
    expect(leftRail.textContent).toContain('GALAXY WINDOW');
    expect(leftRail.textContent).toContain('PULSE');
    expect(leftRail.style.flexDirection).toBe('column');
    expect(leftRail.style.bottom).toBe('14px');
    expect(chainCluster.style.flexDirection).toBe('row');
    expect(chainCluster.style.flex).toBe('1 1 auto');
    expect(chainScroll.style.flex).toBe('0 0 auto');
    expect(chainScroll.style.overflowY).toBe('auto');
    expect(pulse.style.marginTop).toBe('auto');
    expect(meshRail.textContent).not.toContain('GALAXY WINDOW');
    expect(meshRail.style.top).toBe('48px');
    expect(meshRail.style.bottom).toBe('');
  });

  it('controls each main panel independently from the top-bar menu', () => {
    const { container, getByRole } = render(
      <HudOverlay chain={chain} peers={peers} localNode={localNode} cellsStats={cellsStats} />,
    );
    const menuToggle = getByRole('button', {
      name: 'Configure HUD panels, 4 of 4 visible',
    });

    fireEvent.click(menuToggle);
    fireEvent.click(getByRole('menuitemcheckbox', {
      name: 'COMMON KNOWLEDGE BASE panel',
    }));

    expect(container.querySelector('[data-hud-panel="chain"]')).toBeNull();
    expect(container.querySelector('[data-hud-panel="pulse"]')).not.toBeNull();
    expect(container.querySelector('[data-hud-panel="cells"]')).not.toBeNull();
    expect(container.querySelector('[data-hud-panel="peers"]')).not.toBeNull();
    expect(container.querySelector('[data-hud-pulse-anchor]')).not.toBeNull();
    expect(container.querySelector('[data-hud-chain-cluster]')).toBeNull();
    expect((container.querySelector('[data-hud-left-rail]') as HTMLElement).style.bottom).toBe('14px');
    expect(getByRole('button', {
      name: 'Configure HUD panels, 3 of 4 visible',
    })).not.toBeNull();

    fireEvent.click(getByRole('menuitemcheckbox', { name: 'CELL MESH panel' }));
    expect(container.querySelector('[data-hud-panel="cells"]')).toBeNull();
    expect(container.querySelector('[data-hud-panel="peers"]')).not.toBeNull();
    expect(container.querySelector('.cknerv-mesh-rail')).not.toBeNull();

    fireEvent.click(getByRole('menuitemcheckbox', { name: 'PULSE panel' }));
    expect(container.querySelector('[data-hud-left-rail]')).toBeNull();
    expect(container.querySelector('[data-hud-panel="peers"]')).not.toBeNull();

    fireEvent.click(getByRole('menuitemcheckbox', { name: 'PEER MESH panel' }));
    expect(container.querySelector('.cknerv-mesh-rail')).toBeNull();
    expect(container.querySelector('[data-panel-visibility-menu]')).not.toBeNull();
    expect(container.textContent).toContain('CKNERV');
  });

  it('places a validated DAO panel immediately to the right of CKB·01', () => {
    const { container, getByRole } = render(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        enrichmentSource={enrichmentSource}
        daoState={daoState}
      />,
    );
    const cluster = container.querySelector('[data-hud-chain-cluster]') as HTMLElement;
    const chainPanel = cluster.querySelector('[data-hud-panel="chain"]') as HTMLElement;
    const daoPanel = cluster.querySelector('[data-hud-panel="dao"]') as HTMLElement;

    expect(cluster.style.flexDirection).toBe('row');
    expect(cluster.children[0]).toBe(chainPanel);
    expect(cluster.children[1]).toBe(daoPanel);
    expect(chainPanel.textContent).not.toContain('NERVOS DAO');
    expect(daoPanel.textContent).toContain('NERVOS DAO');
    expect(daoPanel.textContent).toContain('DAO·05');

    fireEvent.click(getByRole('button', {
      name: 'Configure HUD panels, 5 of 5 visible',
    }));
    fireEvent.click(getByRole('menuitemcheckbox', { name: 'NERVOS DAO panel' }));
    expect(container.querySelector('[data-hud-panel="dao"]')).toBeNull();
    expect(container.querySelector('[data-hud-panel="chain"]')).not.toBeNull();
  });

  it('uses a two-row top bar and offsets both panel rails on narrow screens', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 1100px'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const { container } = render(
      <HudOverlay chain={chain} peers={peers} localNode={localNode} cellsStats={cellsStats} />,
    );
    const status = container.querySelector('.cknerv-status-strip') as HTMLElement;
    const leftRail = container.querySelector('[data-hud-left-rail]') as HTMLElement;
    const meshRail = container.querySelector('.cknerv-mesh-rail') as HTMLElement;

    expect(status.dataset.statusLayout).toBe('compact');
    expect(status.style.height).toBe('64px');
    expect(container.querySelector('[data-status-controls]')).not.toBeNull();
    expect(leftRail.style.top).toBe('76px');
    expect(meshRail.style.top).toBe('76px');
    expect(meshRail.style.maxHeight).toBe('calc(100vh - 90px)');
  });

  it('keeps a CKB-only phone bar to two priority rows', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 560px')
        || query.includes('max-width: 1100px')
        || query.includes('max-width: 1280px'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const { container } = render(
      <HudOverlay chain={chain} peers={peers} localNode={localNode} cellsStats={cellsStats} />,
    );
    const status = container.querySelector('.cknerv-status-strip') as HTMLElement;
    const leftRail = container.querySelector('[data-hud-left-rail]') as HTMLElement;
    const meshRail = container.querySelector('.cknerv-mesh-rail') as HTMLElement;

    expect(status.dataset.statusLayout).toBe('mobile');
    expect(status.style.height).toBe('59px');
    expect(container.querySelector('[data-status-performance]')).not.toBeNull();
    expect(container.querySelector('[data-status-context]')).toBeNull();
    expect(leftRail.style.top).toBe('71px');
    expect(meshRail.style.top).toBe('71px');
    expect(meshRail.style.maxHeight).toBe('calc(100vh - 85px)');
  });

  it('adds the mobile context row only when enhanced status is present', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 560px')
        || query.includes('max-width: 1100px')
        || query.includes('max-width: 1280px'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const { container } = render(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        enrichmentSource={enrichmentSource}
      />,
    );
    const status = container.querySelector('.cknerv-status-strip') as HTMLElement;
    const leftRail = container.querySelector('[data-hud-left-rail]') as HTMLElement;

    expect(status.dataset.statusLayout).toBe('mobile');
    expect(status.style.height).toBe('88px');
    expect(container.querySelector('[data-status-context]')?.textContent)
      .toContain('CKBADGERREADY');
    expect(leftRail.style.top).toBe('100px');
  });

  it('marks frozen browser data without changing nominal chain telemetry', () => {
    const now = Date.now();
    const { container } = render(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        streamHealth={{
          chain: {
            phase: 'live',
            attempt: 0,
            lastMessageAtMs: now - 1_000,
            reason: null,
          },
          cells: {
            phase: 'stale',
            attempt: 2,
            lastMessageAtMs: now - 17_000,
            reason: 'heartbeat_timeout',
          },
        }}
      />,
    );

    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.streamPhase).toBe('stale');
    expect(container.querySelector('[data-stream-stale-frame]')).not.toBeNull();
    expect(container.querySelector('[data-stream-chip]')).toBeNull();
    expect(container.textContent).toContain('DATA FROZEN');
    expect(container.textContent).toContain('CELLS');
    expect(container.textContent).toContain('NOMINAL');
    const meshRail = container.querySelector('.cknerv-mesh-rail') as HTMLElement;
    expect(meshRail.style.top).toBe('78px');
    expect(meshRail.style.bottom).toBe('');
  });

  it('places stream interruption UI below the two-row narrow top bar', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 1100px')
        || query.includes('max-width: 1280px'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const now = Date.now();
    const { container } = render(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        streamHealth={{
          chain: {
            phase: 'live',
            attempt: 0,
            lastMessageAtMs: now - 1_000,
            reason: null,
          },
          cells: {
            phase: 'stale',
            attempt: 2,
            lastMessageAtMs: now - 17_000,
            reason: 'heartbeat_timeout',
          },
        }}
      />,
    );
    const banner = container.querySelector('[data-stream-health-banner]') as HTMLElement;
    const leftRail = container.querySelector('[data-hud-left-rail]') as HTMLElement;
    const meshRail = container.querySelector('.cknerv-mesh-rail') as HTMLElement;

    expect(banner.style.top).toBe('64px');
    expect(leftRail.style.top).toBe('106px');
    expect(meshRail.style.top).toBe('106px');
    expect(meshRail.style.maxHeight).toBe('calc(100vh - 120px)');
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

  it('forwards a resolved identity proof from the selected Cell detail', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const mockCell: Cell = {
      id: 7, born_at_ms: 1, death_at_ms: null, birth_block: 16204800, tag: 'wallet',
      pos_seed: [0, 0, 0], out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: 0 },
      capacity: 6_100_000_000, data_hex: '0x', content_hash: `0x${'cd'.repeat(32)}`,
    };
    const onCellIdentityProofRead = vi.fn();
    const { getByRole, getByTestId } = render(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        selectedCell={mockCell}
        onCellIdentityProofRead={onCellIdentityProofRead}
      />,
    );

    fireEvent.click(getByRole('button', { name: 'inspect content' }));
    fireEvent.click(getByTestId('content-address-read-resolved'));
    expect(onCellIdentityProofRead).toHaveBeenCalledWith(
      'content',
      mockCell.id,
      true,
    );
  });

  it('keeps the selected Cell detail first in the narrow scroll rail', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 1100px'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const mockCell: Cell = {
      id: 7, born_at_ms: 1, death_at_ms: null, birth_block: 16204800, tag: 'wallet',
      pos_seed: [0, 0, 0], out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: 0 },
      capacity: 6_100_000_000, data_hex: '0x', content_hash: `0x${'cd'.repeat(32)}`,
    };
    const { container } = render(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        selectedCell={mockCell}
      />,
    );
    const rail = container.querySelector('.cknerv-mesh-rail')!;
    const cellZone = rail.firstElementChild as HTMLElement;

    expect(cellZone.style.flexDirection).toBe('column');
    expect(cellZone.firstElementChild?.textContent).toContain('CAPACITY');
    expect(cellZone.children[1]?.textContent).toContain('CELL MESH');
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
      endpoint_anchors: [],
    };
    const onTraceCellWrite = vi.fn();
    const { container, getByRole } = render(
      <HudOverlay
        chain={chain} peers={peers} localNode={localNode} cellsStats={cellsStats}
        selectedCell={mockCell} recentCellLinks={[origin]}
        cellTraceSource="input"
        cellIdentityProofBinding={identityBinding(mockCell.id)}
        onTraceCellWrite={onTraceCellWrite}
      />,
    );
    expect(container.textContent).toContain('WRITE OBSERVED');
    fireEvent.click(getByRole('button', { name: 'recall causal path' }));
    expect(onTraceCellWrite).toHaveBeenCalledWith(origin.seq);
  });

  it('renders the selected Cell causal neighbourhood from exact retained records', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const target: Cell = {
      id: 7, born_at_ms: 1, death_at_ms: null, birth_block: 16204800, tag: 'wallet',
      pos_seed: [0, 0, 0], out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: 0 },
      capacity: 6_100_000_000, data_hex: '0x', content_hash: `0x${'cd'.repeat(32)}`,
    };
    const input: Cell = {
      ...target,
      id: 1,
      death_at_ms: 12,
      out_point: { tx_hash: `0x${'11'.repeat(32)}`, index: 1 },
    };
    const sibling: Cell = {
      ...target,
      id: 8,
      out_point: { tx_hash: target.out_point.tx_hash, index: 1 },
    };
    const origin: CellLink = {
      seq: 3,
      tx_hash: target.out_point.tx_hash,
      block: target.birth_block,
      from_ids: [input.id],
      to_ids: [target.id, sibling.id],
      endpoint_anchors: [],
      parents: [input.out_point.tx_hash],
      tag: null,
      at_ms: 10,
    };
    const { container } = render(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        selectedCell={target}
        cellRecordsById={new Map([
          [input.id, input],
          [target.id, target],
          [sibling.id, sibling],
        ])}
        recentCellLinks={[origin]}
      />,
    );
    const causal = container.querySelector('[data-cell-causal-lens]')!;

    expect(causal.getAttribute('data-causal-status')).toBe('exact');
    expect(causal.getAttribute('data-causal-provenance')).toBe('observed');
    expect(causal.textContent).toContain('1/1 INPUTS');
    expect(causal.textContent).toContain('2/2 OUTPUTS');
    expect(causal.textContent).toContain('1 SELECTED · 1 SIBLING');
  });

  it('threads the authoritative recall stage into the selected Cell detail', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const mockCell: Cell = {
      id: 7, born_at_ms: 1, death_at_ms: null, birth_block: 16204800, tag: 'wallet',
      pos_seed: [0, 0, 0], out_point: { tx_hash: `0x${'ab'.repeat(32)}`, index: 0 },
      capacity: 6_100_000_000, data_hex: '0x', content_hash: `0x${'cd'.repeat(32)}`,
    };
    const transitCell: Cell = {
      ...mockCell,
      id: 4,
      birth_block: 16204796,
      out_point: { tx_hash: `0x${'44'.repeat(32)}`, index: 0 },
      content_hash: `0x${'44'.repeat(32)}`,
    };
    const origin: CellLink = {
      seq: 3, tx_hash: mockCell.out_point.tx_hash, block: mockCell.birth_block,
      from_ids: [1, 2], to_ids: [mockCell.id], parents: [], tag: null, at_ms: 10,
      endpoint_anchors: [],
    };
    const onCellTraceRouteHopFocusChange = vi.fn();
    const onCellTraceRouteHopLockChange = vi.fn();
    const routeHopFocus = {
      traceKey: '3:7:1',
      sourceId: 2,
      targetCellId: 7,
      cellId: 4,
      hopIndex: 1,
    };
    const { container } = render(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        selectedCell={mockCell}
        cellRecordsById={new Map([
          [transitCell.id, transitCell],
          [mockCell.id, mockCell],
        ])}
        recentCellLinks={[origin]}
        tracedCellWriteSeq={origin.seq}
        cellTraceSource="input"
        cellIdentityProofBinding={identityBinding(mockCell.id, 'recalling')}
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
        cellTraceEvidencePreviewSourceId={1}
        onCellTraceEvidenceFocusChange={() => {}}
        cellTraceRouteHopFocus={routeHopFocus}
        onCellTraceRouteHopFocusChange={onCellTraceRouteHopFocusChange}
        cellTraceRouteHopLock={routeHopFocus}
        onCellTraceRouteHopLockChange={onCellTraceRouteHopLockChange}
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
      ?.getAttribute('data-memory-evidence-focus')).toBe('retained');
    expect(container.querySelector('[data-memory-evidence="2"]')
      ?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-memory-evidence="2"]')
      ?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-memory-evidence="1"]')
      ?.getAttribute('data-memory-evidence-focus')).toBe('preview');
    expect(container.querySelector('[data-memory-evidence="1"]')
      ?.getAttribute('data-memory-evidence-scene-preview')).toBe('true');
    expect(container.querySelector('[data-memory-evidence="1"]')
      ?.getAttribute('aria-pressed')).toBe('false');
    const routeHop = container.querySelector<HTMLElement>(
      '[data-memory-evidence-route-cell="4"]',
    )!;
    expect(routeHop.getAttribute('data-memory-evidence-route-focus')).toBe('locked');
    expect(routeHop.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector(
      '[data-memory-evidence-route-hop-inspector="true"]',
    )?.textContent).toContain('4444444·4444');
    fireEvent.pointerEnter(routeHop);
    expect(onCellTraceRouteHopFocusChange).toHaveBeenLastCalledWith({
      traceKey: '3:7:1',
      sourceId: 2,
      targetCellId: 7,
      cellId: 4,
      hopIndex: 1,
    });
    fireEvent.click(routeHop);
    expect(onCellTraceRouteHopLockChange).toHaveBeenLastCalledWith(null);
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
    const build = container.querySelector('[data-build-chip]');
    expect(build?.getAttribute('aria-label')).toBe('61922ba@20260630');
    expect(build?.textContent).toBe('BUILD61922ba');
  });

  it('passes product-owned actions through the shared top bar slot', () => {
    const { getByRole } = render(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        topBarActions={<button type="button">JUKEBOX</button>}
      />,
    );

    expect(getByRole('button', { name: 'JUKEBOX' })).not.toBeNull();
  });
});
