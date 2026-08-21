import { emptyScriptCensus } from '@cknerv/cache';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type {
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
const cellsStats: CellsStats = { born: 28431, live: 19204, dead: 9227, byKind: { wallet: 11302, dex: 4118, cf: 2401, ckbloom: 1383, generic: 0 }, capacityShannons: 0, inView: 19204, dataBearing: 0, byLock: { sighash: 0, multisig: 0, acp: 0, omnilock: 0, other: 0 }, byAsset: { native: 0, sudt: 0, xudt: 0, dao: 0, spore: 0, other: 0 }, scripts: emptyScriptCensus() };
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

describe('HudOverlay', () => {
  it('mounts a non-interactive overlay containing every panel', () => {
    const { container } = render(<HudOverlay chain={chain} peers={peers} localNode={localNode} cellsStats={cellsStats} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.pointerEvents).toBe('none');
    expect(root.style.userSelect).toBe('none');
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
    expect(leftRail.textContent).not.toContain('STAGE SAMPLE');
    expect(leftRail.textContent).toContain('PULSE');
    expect(leftRail.style.flexDirection).toBe('column');
    expect(leftRail.style.bottom).toBe('14px');
    expect(chainCluster.style.flexDirection).toBe('row');
    expect(chainCluster.style.flex).toBe('1 1 auto');
    expect(chainCluster.style.pointerEvents).toBe('none');
    expect(chainScroll.style.flex).toBe('0 0 auto');
    expect(chainScroll.style.overflowY).toBe('auto');
    expect(chainScroll.style.pointerEvents).toBe('auto');
    // The bottom stack (DAO over PULSE) is what pins to the rail's floor now.
    expect((container.querySelector('[data-hud-bottom-stack]') as HTMLElement)
      .style.marginTop).toBe('auto');
    expect((pulse.firstElementChild as HTMLElement).style.width)
      .toMatch(/340px.*58px/);
    expect(meshRail.textContent).not.toContain('STAGE SAMPLE');
    expect(meshRail.style.top).toBe('48px');
    expect(meshRail.style.bottom).toBe('');
  });

  it('recedes ambient telemetry while a Cell scan owns scene focus', () => {
    const { container } = render(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        cellInspectionActive
      />,
    );
    const leftRail = container.querySelector('[data-hud-left-rail]') as HTMLElement;
    const meshRail = container.querySelector('.cknerv-mesh-rail') as HTMLElement;
    expect(leftRail.style.opacity).toBe('0.22');
    expect(meshRail.style.opacity).toBe('0.22');
    expect(leftRail.style.filter).toBe('saturate(0.55) brightness(0.72)');
    expect(meshRail.style.filter).toBe('saturate(0.55) brightness(0.72)');
  });

  it('controls each main panel independently from the top-bar menu', () => {
    const { container, getByRole } = render(
      <HudOverlay chain={chain} peers={peers} localNode={localNode} cellsStats={cellsStats} />,
    );
    const menuToggle = getByRole('button', {
      name: 'Configure HUD panels, 4 of 6 visible',
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
    expect((container.querySelector('[data-hud-pulse-anchor]')
      ?.firstElementChild as HTMLElement).style.width)
      .toMatch(/340px.*58px/);
    expect(container.querySelector('[data-hud-chain-cluster]')).toBeNull();
    expect((container.querySelector('[data-hud-left-rail]') as HTMLElement).style.bottom).toBe('14px');
    expect(getByRole('button', {
      name: 'Configure HUD panels, 3 of 6 visible',
    })).not.toBeNull();

    fireEvent.click(getByRole('menuitemcheckbox', { name: 'CELL MESH panel' }));
    expect(container.querySelector('[data-hud-panel="cells"]')).toBeNull();
    expect(container.querySelector('[data-hud-panel="peers"]')).not.toBeNull();
    expect(container.querySelector('.cknerv-mesh-rail')).not.toBeNull();

    fireEvent.click(getByRole('menuitemcheckbox', { name: 'PULSE panel' }));
    expect(container.querySelector('[data-hud-left-rail]')).toBeNull();
    expect(container.querySelector('[data-hud-panel="peers"]')).not.toBeNull();

    // The dev instruments start hidden and dock into the left cluster when
    // summoned — never onto the mesh rail, whose corner belongs to the
    // Jukebox chip.
    fireEvent.click(getByRole('menuitemcheckbox', { name: 'STAGE SAMPLE panel' }));
    expect(container.querySelector('[data-hud-panel="stage"]')).not.toBeNull();
    expect(container.querySelector('[data-hud-left-rail]')).not.toBeNull();
    fireEvent.click(getByRole('menuitemcheckbox', { name: 'RENDER STATS panel' }));
    expect(container.querySelector('[data-hud-panel="render"]')).not.toBeNull();
    fireEvent.click(getByRole('menuitemcheckbox', { name: 'STAGE SAMPLE panel' }));
    expect(container.querySelector('[data-hud-panel="stage"]')).toBeNull();
    fireEvent.click(getByRole('menuitemcheckbox', { name: 'RENDER STATS panel' }));
    expect(container.querySelector('[data-hud-left-rail]')).toBeNull();

    fireEvent.click(getByRole('menuitemcheckbox', { name: 'PEER MESH panel' }));
    expect(container.querySelector('.cknerv-mesh-rail')).toBeNull();
    expect(container.querySelector('[data-panel-visibility-menu]')).not.toBeNull();
    expect(container.textContent).toContain('CKNERV');
  });

  it('hands the scene colony count to the stage instrument, not the peer mesh', () => {
    const { container, getByRole } = render(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        colonyCount={277}
      />,
    );
    // MESH·02 is visible from the start and reports the network only.
    expect(container.querySelector('[data-hud-panel="peers"]')?.textContent)
      .not.toContain('inferred');

    fireEvent.click(getByRole('button', {
      name: 'Configure HUD panels, 4 of 6 visible',
    }));
    fireEvent.click(getByRole('menuitemcheckbox', { name: 'STAGE SAMPLE panel' }));
    expect(container.querySelector('[data-hud-panel="stage"]')?.textContent)
      .toContain('~277 nodes · inferred');
  });

  it('leaves per-peer telemetry to the cards and shows catch-up only off-tip', () => {
    const { container } = render(
      <HudOverlay chain={chain} peers={peers} localNode={localNode} cellsStats={cellsStats} />,
    );
    const mesh = container.querySelector('[data-hud-panel="peers"]') as HTMLElement;
    expect(mesh.textContent).not.toContain('LOCAL NODE VIEW');
    expect(mesh.textContent).not.toContain('84ms');   // the one peer's RTT
    expect(mesh.textContent).not.toContain('0.201.0');
    expect(mesh.textContent).not.toContain('Syncing'); // tip === best known
    cleanup();

    const { container: behind } = render(
      <HudOverlay
        chain={{ ...chain, tip: chain.best_known_block - 400_000 }}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
      />,
    );
    expect((behind.querySelector('[data-hud-panel="peers"]') as HTMLElement).textContent)
      .toContain('97.5% of #16,204,887');
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
    const stack = container.querySelector('[data-hud-bottom-stack]') as HTMLElement;
    const daoPanel = stack.querySelector('[data-hud-panel="dao"]') as HTMLElement;
    const pulseAnchor = stack.querySelector('[data-hud-pulse-anchor]') as HTMLElement;

    // DAO·05 belongs to the bottom stack, directly over ECG·04 — the cluster
    // row beside CKB·01 is reserved for the opt-in dev instruments.
    expect(cluster.querySelector('[data-hud-panel="dao"]')).toBeNull();
    expect(stack.style.marginTop).toBe('auto');
    expect(stack.children[0]).toBe(daoPanel);
    expect(stack.children[1]).toBe(pulseAnchor);
    expect(daoPanel.style.pointerEvents).toBe('auto');
    expect(cluster.textContent).not.toContain('NERVOS DAO');
    expect(daoPanel.textContent).toContain('NERVOS DAO');
    expect(daoPanel.textContent).toContain('DAO·05');
    expect((pulseAnchor.firstElementChild as HTMLElement).style.width)
      .toMatch(/340px.*58px/);

    fireEvent.click(getByRole('button', {
      name: 'Configure HUD panels, 5 of 7 visible',
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

  it('keeps every scene-tethered detail out of the fixed HUD', () => {
    const { container } = render(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
      />,
    );
    const meshRail = container.querySelector('.cknerv-mesh-rail')!;

    // Summaries only: the rail names the meshes, never a single entity.
    expect(meshRail.textContent).toContain('CELL MESH');
    expect(meshRail.textContent).toContain('PEER MESH');
    expect(meshRail.textContent).not.toContain('CONSENSUS MEMORY');
    expect(meshRail.querySelector('[data-node-probe-card]')).toBeNull();
    expect(meshRail.querySelector('[data-peer-probe-card]')).toBeNull();
    expect(container.querySelector('[data-cell-inspection-overlay]')).toBeNull();
  });

  it('keeps the narrow Cell zone summary-only', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 1100px'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const { container } = render(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
      />,
    );
    const rail = container.querySelector('.cknerv-mesh-rail')!;
    const cellZone = rail.firstElementChild as HTMLElement;

    // No zone wrapper survives the detail cards: the summary IS the rail child.
    expect(cellZone.dataset.hudPanel).toBe('cells');
    expect(cellZone.textContent).toContain('CELL MESH');
    expect(rail.children).toHaveLength(2);
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
