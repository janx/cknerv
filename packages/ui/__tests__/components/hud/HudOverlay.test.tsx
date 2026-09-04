import { emptyScriptCensus } from '@cknerv/cache';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  completeBootPhase,
  failBootPhase,
  reportBootSnapshotProgress,
  resetBootSequenceForTest,
  type BootPhaseId,
} from '../../../src/boot/bootSequence';
import { HUD_COLORS, rgba } from '../../../src/components/hud/hudTheme';
import { REVEAL_GHOST_OPACITY } from '../../../src/components/hud/primitives';
import type { StreamHealthChannels } from '../../../src/derives/streamHealth.derive';
import type {
  ChainEntry,
  ChainNode,
  DaoStateRecord,
  EnrichmentSourceStatus,
  NetworkAtlasRecord,
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

import HudOverlay, {
  RAILS_COLLAPSE_HOLE_PX,
  RAILS_COLLAPSE_MAX_WIDTH_PX,
  RAILS_FULL_WIDTH_PX,
} from '../../../src/components/hud/HudOverlay';
import type { CellsStats } from '../../../src/derives/cellsStats.derive';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetBootSequenceForTest();
});

// ——— The page's boot record ————————————————————————————————
// It is a module store, and importing it starts it RUNNING — which is correct
// for a page and inconvenient for a test file, because a running record takes
// the top slot away from the stream banner and the replay plate (see the
// arbitration suite at the bottom). Every test that is not about the boot
// readout is therefore explicit about standing on the far side of that
// handover: the HUD as a visitor finds it once the page has come up.
const BOOT_RECORD_PHASES: readonly Exclude<BootPhaseId, 'seeding'>[] = [
  'instrument', 'snapshot', 'decode', 'gl', 'first_light', 'fabric', 'data_plane',
];
const finishBootRecord = () => {
  for (const id of BOOT_RECORD_PHASES) completeBootPhase(id);
};
beforeEach(() => { resetBootSequenceForTest(); finishBootRecord(); });

// ——— Boot count-off helpers —————————————————————————————————
/** One module's beat of the boot count-off. */
const BOOT_BEAT_MS = 130;
/** Comfortably past the longest possible ritual, for tests that want the HUD
 *  as the user finds it a second in rather than mid-count. */
const BOOT_SETTLED_MS = 1_200;
const BOOT_GHOST = String(REVEAL_GHOST_OPACITY);
const wrapper = (root: HTMLElement, id: string) =>
  root.querySelector(`[data-hud-panel="${id}"]`) as HTMLElement;
/** Advance the fake clock in whole beats, flushing React between each. The
 *  ritual re-arms itself from an effect, so the next beat only exists once the
 *  previous one has rendered — one big `advanceTimersByTime` would count once
 *  and then sit there looking finished. */
const tick = (ms: number) => {
  for (let left = ms; left > 0; left -= BOOT_BEAT_MS) {
    act(() => { vi.advanceTimersByTime(Math.min(left, BOOT_BEAT_MS)); });
  }
};

const chain: ChainEntry = {
  tip: 16204887, recent_blocks: [], recent_tx_hashes: [], total_blocks: 4217, total_txs: 9338,
  mempool: { pending: 312, proposed: 64, orphan: 0, total_tx_size: 0, total_tx_cycles: 0, min_fee_rate: 0 },
  epoch: { number: 11042, index: 842, length: 1800 }, median_time_ms: 0, difficulty: '0x0',
  chain_name: 'ckb', reorgs: 0, recent_block_intervals_ms: [8000], recent_block_tx_counts: [2], recent_block_sizes: [500],
  ibd: false, best_known_block: 16204887,
  producers: [], producer_window: [], producer_window_blocks: 0,
};
const peers: Peer[] = [{ node_id: 'n', addr: 'a', direction: 'outbound', version: '0.201.0', latency_ms: 84, best_known: 16204887, connected_ms: 1000 }];
const localNode: ChainNode = { id: 'ckb:local', label: 'local', is_miner: false, version: '0.201.0', connections: 47 };
const cellsStats: CellsStats = { born: 28431, live: 19204, dead: 9227, byKind: { wallet: 11302, dex: 4118, cf: 2401, ckbloom: 1383, generic: 0 }, capacityShannons: 0, inView: 19204, dataBearing: 0, byLock: { sighash: 0, multisig: 0, acp: 0, omnilock: 0, other: 0 }, byAsset: { native: 0, sudt: 0, xudt: 0, dao: 0, spore: 0, other: 0, object: 0, identity: 0 }, scripts: emptyScriptCensus() };
const enrichmentSource: EnrichmentSourceStatus = {
  source: 'ckbadger',
  status: 'ready',
  capabilities: ['dao_state'],
  validated_anchor: { block: 100, hash: '0xblock100' },
};
const networkAtlas: NetworkAtlasRecord = {
  source: 'ckbadger',
  as_of: { block: 100, hash: '0xblock100' },
  updated_at_ms: Date.now(),
  crawl_round: 7,
  crawl_finished_at_s: 1_700_000_000,
  candidate_peers: 1290,
  last_round_reachable: 9,
  foreign_peers: 1,
  exhausted_candidates: 1280,
  verified_unavailable_peers: 1195,
  verified_retained_peers: 1204,
  new_verified_peers: 3,
  indexed_peers: 1204,
  countries: [{ label: 'SG', count: 800 }, { label: 'US', count: 404 }],
  versions: [{ label: '0.119.0', count: 900 }, { label: '0.118.0', count: 304 }],
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
    // Past the boot count-off: this test is about the HUD the user settles
    // into, not the half-second in which it lights itself up.
    vi.useFakeTimers();
    const { container } = render(<HudOverlay chain={chain} peers={peers} localNode={localNode} cellsStats={cellsStats} />);
    tick(BOOT_SETTLED_MS);
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

  it('rules the whole overlay with scan lines that blend against nothing', () => {
    const { container } = render(
      <HudOverlay chain={chain} peers={peers} localNode={localNode} cellsStats={cellsStats} />,
    );
    const root = container.firstElementChild as HTMLElement;
    const scan = root.firstElementChild as HTMLElement;
    expect(scan.style.background).toContain('repeating-linear-gradient');
    expect(scan.style.background).toContain(rgba(HUD_COLORS.heroInk, 0.035));
    expect(scan.style.opacity).toBe('0.5');
    expect(scan.style.pointerEvents).toBe('none');
    // First child of the root, and every band, rail and panel after it either
    // carries a z-index or arrives later in the tree — so the ruling has the
    // root's own transparent ground under it and nothing else. A blend mode
    // against a zero-alpha backdrop resolves to exactly the source-over above,
    // and costs the compositor an isolated full-viewport group to say so.
    expect(scan.style.mixBlendMode).toBe('');
    expect(root.style.zIndex).toBe('15');
  });

  it('keeps every rail at full energy — scene inspection never dims the HUD', () => {
    const { container } = render(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
      />,
    );
    const leftRail = container.querySelector('[data-hud-left-rail]') as HTMLElement;
    const meshRail = container.querySelector('.cknerv-mesh-rail') as HTMLElement;
    expect(leftRail.style.opacity).toBe('');
    expect(meshRail.style.opacity).toBe('');
    expect(leftRail.style.filter).toBe('');
    expect(meshRail.style.filter).toBe('');
  });

  it('counts the modules in at boot, in module order and in ink only', () => {
    vi.useFakeTimers();
    const { container } = render(
      <HudOverlay chain={chain} peers={peers} localNode={localNode} cellsStats={cellsStats} />,
    );
    const root = container.firstElementChild as HTMLElement;
    const roster = ['chain', 'peers', 'cells', 'pulse'];

    // t=0 — the whole registry is already mounted at its final geometry and
    // every module of it is dark. Structure first, ink after.
    expect(root.dataset.hudBoot).toBe('counting');
    for (const id of roster) {
      expect(wrapper(container, id).style.opacity).toBe(BOOT_GHOST);
      expect(wrapper(container, id).style.transition).toBe('opacity 260ms ease');
      expect(wrapper(container, id).style.pointerEvents).toBe('none');
    }
    // Geometry is untouched throughout: a reveal never moves layout.
    expect(wrapper(container, 'chain').style.flex).toBe('0 0 auto');
    expect(wrapper(container, 'chain').style.overflowY).toBe('auto');
    expect(wrapper(container, 'pulse').style.position).toBe('relative');
    // Chrome and safety surfaces never wait their turn.
    expect((container.querySelector('.cknerv-status-strip') as HTMLElement).style.opacity)
      .toBe('');

    tick(BOOT_BEAT_MS); // CKB·01
    expect(wrapper(container, 'chain').style.opacity).toBe('1');
    expect(wrapper(container, 'chain').style.pointerEvents).toBe('auto');
    expect(wrapper(container, 'peers').style.opacity).toBe(BOOT_GHOST);
    expect(root.dataset.hudBoot).toBe('counting');

    tick(BOOT_BEAT_MS); // PEER·02
    expect(wrapper(container, 'peers').style.opacity).toBe('1');
    expect(wrapper(container, 'cells').style.opacity).toBe(BOOT_GHOST);

    tick(BOOT_BEAT_MS); // CELL·03
    expect(wrapper(container, 'cells').style.opacity).toBe('1');
    expect(wrapper(container, 'pulse').style.opacity).toBe(BOOT_GHOST);
    expect(root.dataset.hudBoot).toBe('counting');

    tick(BOOT_BEAT_MS); // ECG·04 — the last module on a default stage
    expect(wrapper(container, 'pulse').style.opacity).toBe('1');
    // The pulse anchor never claimed pointer input; lighting it hands back
    // exactly what it had, not a blanket `auto`.
    expect(wrapper(container, 'pulse').style.pointerEvents).toBe('');
    expect(root.dataset.hudBoot).toBe('done');
    for (const id of roster) {
      expect(wrapper(container, id).style.opacity).toBe('1');
    }
  });

  it('skips the count-off entirely when motion has been asked to stop', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.useFakeTimers();
    const { container } = render(
      <HudOverlay chain={chain} peers={peers} localNode={localNode} cellsStats={cellsStats} />,
    );
    const root = container.firstElementChild as HTMLElement;

    // No ghost frame, not even the first one: the ritual is never armed.
    expect(root.dataset.hudBoot).toBe('done');
    for (const id of ['chain', 'peers', 'cells', 'pulse']) {
      expect(wrapper(container, id).style.opacity).toBe('');
      expect(wrapper(container, id).style.transition).toBe('');
    }
    expect(wrapper(container, 'chain').style.pointerEvents).toBe('auto');

    // …and nothing arrives late either — there was nothing scheduled.
    tick(BOOT_SETTLED_MS);
    expect(root.dataset.hudBoot).toBe('done');
    expect(wrapper(container, 'pulse').style.opacity).toBe('');
  });

  it('compresses the count-off around modules that are not on stage', () => {
    vi.useFakeTimers();
    const { container } = render(
      <HudOverlay chain={chain} peers={peers} localNode={localNode} cellsStats={cellsStats} />,
    );
    const root = container.firstElementChild as HTMLElement;

    // STAGE·07 and GL·08 are off by default and leave no dead slot behind:
    // four modules, four beats, done — not seven.
    tick(3 * BOOT_BEAT_MS);
    expect(root.dataset.hudBoot).toBe('counting');
    tick(BOOT_BEAT_MS);
    expect(root.dataset.hudBoot).toBe('done');
    cleanup();

    // A DAO record already validated at mount puts DAO·05 on the roster, and
    // the ritual grows by exactly its one beat.
    const { container: withDao } = render(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        enrichmentSource={enrichmentSource}
        daoState={daoState}
      />,
    );
    const daoRoot = withDao.firstElementChild as HTMLElement;
    tick(4 * BOOT_BEAT_MS);
    expect(daoRoot.dataset.hudBoot).toBe('counting');
    expect(wrapper(withDao, 'dao').style.opacity).toBe(BOOT_GHOST);
    tick(BOOT_BEAT_MS);
    expect(daoRoot.dataset.hudBoot).toBe('done');
    expect(wrapper(withDao, 'dao').style.opacity).toBe('1');
  });

  it('lets a module that missed the boot roster arrive already lit', () => {
    vi.useFakeTimers();
    const { container, rerender, getByRole } = render(
      <HudOverlay chain={chain} peers={peers} localNode={localNode} cellsStats={cellsStats} />,
    );
    const root = container.firstElementChild as HTMLElement;
    tick(BOOT_SETTLED_MS);
    expect(root.dataset.hudBoot).toBe('done');

    // A dev instrument summoned from the menu long after the count.
    fireEvent.click(getByRole('button', { name: 'Configure HUD panels, 4 of 6 visible' }));
    fireEvent.click(getByRole('menuitemcheckbox', { name: 'STAGE SAMPLE panel' }));
    expect(wrapper(container, 'stage').style.opacity).toBe('1');
    expect(wrapper(container, 'stage').style.pointerEvents).toBe('auto');

    // DAO·05 mounting when its record finally validates — news, not ritual.
    rerender(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        enrichmentSource={enrichmentSource}
        daoState={daoState}
      />,
    );
    expect(wrapper(container, 'dao').style.opacity).toBe('1');
  });

  it('lights a module that arrives mid-count immediately, never retroactively', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <HudOverlay chain={chain} peers={peers} localNode={localNode} cellsStats={cellsStats} />,
    );
    const root = container.firstElementChild as HTMLElement;

    tick(BOOT_BEAT_MS); // only CKB·01 has lit so far
    expect(root.dataset.hudBoot).toBe('counting');
    rerender(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        enrichmentSource={enrichmentSource}
        daoState={daoState}
      />,
    );

    // The roster was taken when the session opened; DAO·05 was not on it, so
    // it takes no slot and renumbers nobody — it simply appears, lit, while
    // PEER·02 is still waiting its turn.
    expect(wrapper(container, 'dao').style.opacity).toBe('1');
    expect(wrapper(container, 'peers').style.opacity).toBe(BOOT_GHOST);
    // …and the ritual still ends on its original four beats.
    tick(3 * BOOT_BEAT_MS);
    expect(root.dataset.hudBoot).toBe('done');
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
    // PEER·02 is visible from the start and reports the network only.
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

  it('reads the crawler atlas as more rows of PEER·02, not a panel within it', () => {
    const { container } = render(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        enrichmentSource={{
          ...enrichmentSource,
          capabilities: ['dao_state', 'network_atlas'],
        }}
        networkAtlas={networkAtlas}
      />,
    );
    const mesh = container.querySelector('[data-hud-panel="peers"]') as HTMLElement;

    // The indexed rows sit in the same flow as the measured ones…
    expect(mesh.textContent).toContain('Head consensus');
    expect(mesh.textContent).toContain('NAMED BY THE NETWORK · 1,290 PEERS');
    expect(mesh.textContent).toContain('COUNTRIES · ALL 1,204 VERIFIED PEERS');
    // …under one panel title, with no second heading and no scope framing.
    expect(mesh.textContent).toContain('PEER MESH');
    expect(mesh.textContent).not.toContain('NETWORK ATLAS');
    expect(container.textContent).not.toContain('NETWORK ATLAS');
    expect(mesh.querySelectorAll('[data-scope-stage]')).toHaveLength(0);
    expect(mesh.querySelector('[data-network-detail-mode="indexed"]')).not.toBeNull();
  });

  it('places a validated DAO panel immediately to the right of CKB·01', () => {
    vi.useFakeTimers();
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
    tick(BOOT_SETTLED_MS);
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
    expect(container.textContent).toContain('STAGE CELLS');
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

// ——— The top slot, while the page is still coming up ————————————
//
// One tenant at a time. The stream banner and the replay plate both report
// backend conditions the boot sequence already carries as lines of its own
// (`data_plane`, `seeding`), and the arrangement measured before this suite
// existed had the slot shouting CONNECTING over a galaxy that had finished
// rendering half a second earlier.

/** The page's boot record left where it starts: running, nothing finished. */
const midBoot = () => { resetBootSequenceForTest(); };

/** Neither socket is open yet — the state the old slot spent the whole boot in. */
const connectingStreams: StreamHealthChannels = {
  chain: { phase: 'connecting', attempt: 0, lastMessageAtMs: null, reason: null },
  cells: { phase: 'connecting', attempt: 0, lastMessageAtMs: null, reason: null },
};

/** Long enough past the linger that the readout has certainly stood down. */
const BOOT_LINGER_SETTLED_MS = 1_000;

describe('HudOverlay — the boot readout owns the top slot', () => {
  beforeEach(midBoot);

  const booting = (extra: Record<string, unknown> = {}) => render(
    <HudOverlay
      chain={chain}
      peers={peers}
      localNode={localNode}
      cellsStats={cellsStats}
      streamHealth={connectingStreams}
      backfill={{ done: 1234, total: 65_829, phase: 'boot' }}
      {...extra}
    />,
  );

  it('speaks with one voice while the instrument is coming up', () => {
    const { container } = booting();

    const banner = container.querySelector('[data-boot-banner]') as HTMLElement;
    expect(banner).not.toBeNull();
    expect(banner.style.top).toBe('36px');
    expect(banner.textContent).toContain('STAGE POWER-ON');
    expect(banner.textContent).toContain('INSTRUMENT');
    expect(banner.textContent).toContain('FIRST LIGHT');
    // …and the other two tenants hold, backfill prop and all.
    expect(container.querySelector('[data-stream-health-banner]')).toBeNull();
    expect(container.querySelector('[data-replay-phase]')).toBeNull();
    expect(container.textContent).not.toContain('CONNECTING DATA PLANE');
    expect(container.textContent).not.toContain('SEEDING CONSENSUS CELLS');
  });

  it('folds the server replay in as its own line, with its own count', () => {
    const { container } = booting();
    act(() => { reportBootSnapshotProgress(2_852_000, 4_600_000); });

    expect((container.querySelector('[data-boot-phase="snapshot"]') as HTMLElement)
      .textContent).toBe('SNAPSHOT 62%');
  });

  it('hands the slot back once the sequence finishes and its linger runs out', () => {
    vi.useFakeTimers();
    const { container } = booting();

    act(() => { finishBootRecord(); });
    // The whole trail lit is the one frame in which the wait is legible; the
    // slot is still the sequence's.
    expect(container.querySelector('[data-boot-banner]')).not.toBeNull();
    expect(container.querySelector('[data-stream-health-banner]')).toBeNull();

    act(() => { vi.advanceTimersByTime(BOOT_LINGER_SETTLED_MS); });
    expect(container.querySelector('[data-boot-banner]')).toBeNull();
    expect(container.querySelector('[data-stream-health-banner]')).not.toBeNull();
    expect(container.textContent).toContain('CONNECTING DATA PLANE');
    expect(container.querySelector('[data-replay-phase="boot"]')).not.toBeNull();
  });

  it('drops the linger when motion has been asked to stop', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.useFakeTimers();
    const { container } = booting();
    expect(container.querySelector('[data-boot-banner]')).not.toBeNull();

    act(() => { finishBootRecord(); });
    // No held frame at all: the sequence is over, so it is gone.
    expect(container.querySelector('[data-boot-banner]')).toBeNull();
    expect(container.querySelector('[data-stream-health-banner]')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(BOOT_LINGER_SETTLED_MS); });
    expect(container.querySelector('[data-boot-banner]')).toBeNull();
  });

  it('keeps a failed boot in the slot, and keeps the other two out of it', () => {
    vi.useFakeTimers();
    const { container } = booting();

    act(() => {
      failBootPhase('gl', 'context lost');
      finishBootRecord();
    });
    act(() => { vi.advanceTimersByTime(BOOT_LINGER_SETTLED_MS); });

    // A record carrying a fault never completes, so the band never stands
    // down. Deliberate: a boot that died is the louder fault, and two banners
    // arguing about which emergency is the emergency teaches a reader to
    // ignore both.
    expect(container.querySelector('[data-boot-banner]')).not.toBeNull();
    expect(container.textContent).toContain('GL FAULT — context lost');
    expect(container.querySelector('[data-stream-health-banner]')).toBeNull();
    expect(container.querySelector('[data-replay-phase]')).toBeNull();
  });

  it('shifts the alert bar by one band, never by two', () => {
    // A genuine at-tip stall: blocks stopped while the node is caught up.
    const stalled: ChainEntry = {
      ...chain,
      recent_block_intervals_ms: Array.from({ length: 60 }, () => 8000),
      last_block_ts_ms: Date.now() - 600_000,
    };
    const warningBar = (root: HTMLElement) => root
      .querySelector('[data-warning-trigger]')!
      .parentElement as HTMLElement;

    vi.useFakeTimers();
    const { container } = render(
      <HudOverlay
        chain={stalled}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        streamHealth={connectingStreams}
      />,
    );
    // The stream is interrupted too — it always is during boot — and the two
    // must not each claim their 30px, because only one band is on screen.
    expect(container.querySelector('[data-boot-banner]')).not.toBeNull();
    expect(warningBar(container).style.top).toBe('66px');

    act(() => { finishBootRecord(); });
    act(() => { vi.advanceTimersByTime(BOOT_LINGER_SETTLED_MS); });
    // Handed back: the stream banner is the tenant now, at the same offset.
    expect(container.querySelector('[data-stream-health-banner]')).not.toBeNull();
    expect(warningBar(container).style.top).toBe('66px');
  });

  it('gives a narrow top bar the one line it has room for', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 1280px'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const { container } = booting();
    const banner = container.querySelector('[data-boot-banner]') as HTMLElement;

    expect(banner.dataset.bootDense).toBe('true');
    expect(banner.querySelectorAll('[data-boot-phase]')).toHaveLength(1);
    expect(banner.textContent).toContain('STAGE POWER-ON');
    expect(banner.textContent).toContain('INSTRUMENT');
    expect(banner.textContent).not.toContain('FIRST LIGHT');
  });

  it('keeps a line in the narrow band for the whole held frame', () => {
    // Dense × linger, the crossing neither suite made — which is exactly why
    // this shipped. The linger exists because the whole trail lit is the only
    // frame in which a visitor can read what happened while they waited; the
    // dense selector asked for the leftmost UNFINISHED line, and during the
    // linger there is no such thing. So on every viewport at or under 1280px
    // the held frame was `◇ STAGE POWER-ON` and an empty trail, for all 700ms
    // of it, and then the band left. The linger bought a blank.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 1280px'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.useFakeTimers();
    const { container } = booting();

    act(() => { finishBootRecord(); });
    const banner = container.querySelector('[data-boot-banner]') as HTMLElement;
    expect(banner).not.toBeNull();
    expect(banner.dataset.bootDense).toBe('true');

    // The band still says something, and what it says is the line the run
    // ended on — lit, because it finished.
    const trail = banner.querySelectorAll('[data-boot-phase]');
    expect(trail).toHaveLength(1);
    expect(trail[0].textContent).toBe('DATA PLANE');
    expect((trail[0] as HTMLElement).dataset.state).toBe('done');

    // …and it is still a linger, not a band that forgot to leave.
    act(() => { vi.advanceTimersByTime(BOOT_LINGER_SETTLED_MS); });
    expect(container.querySelector('[data-boot-banner]')).toBeNull();
  });

  it('leaves the settled HUD exactly as it was', () => {
    // The other side of the handover, asserted here rather than trusted: a HUD
    // mounting after the record closed shows no band and holds nothing back.
    finishBootRecord();
    vi.useFakeTimers();
    const { container } = booting();

    expect(container.querySelector('[data-boot-banner]')).toBeNull();
    expect(container.querySelector('[data-stream-health-banner]')).not.toBeNull();
    expect(container.querySelector('[data-replay-phase="boot"]')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(BOOT_LINGER_SETTLED_MS); });
    expect(container.querySelector('[data-boot-banner]')).toBeNull();
  });
});

// ——— The boot readout's second chapter: the stage composing —————
//
// A freshly started server announces its dashboard before its composition is
// back, so the page it auto-opens boots against a placeholder world and the
// Cells, edges and bridges that arrive afterwards would sprout with nothing on
// screen naming them. The record itself must not be held for that; the band
// changes chapter instead (`boot/stageCompose.ts` decides, and the chapter is
// a tenant of the same slot rather than a plate under it).

import type { CellPopulationFieldModel } from '../../../src/derives/cellPopulationField.derive';
import { STAGE_COMPOSE_SETTLE_MS } from '../../../src/boot/stageCompose';

const populationModel = (
  stagedLive: number,
  stageBudget: number | null,
  composition: { curated?: number; composed?: boolean; stampMs?: number } = {},
): CellPopulationFieldModel => {
  const curated = composition.curated ?? 0;
  return {
    renderedLive: stagedLive,
    renderedRetainedLive: stagedLive - curated,
    renderedResidentLive: curated,
    stagedLive,
    stagedRetainedLive: stagedLive - curated,
    stagedResidentLive: curated,
    stagedClasses: { dao: 0, typedNonDao: 0, plain: stagedLive },
    stagedCurated: composition.composed ?? true,
    stageComposedAtMs: composition.stampMs ?? 1,
    clamped: false,
    stageBudget,
    retainedLive: stagedLive,
    retainedScope: 'full_retained',
    observedLive: stagedLive,
    chainCensus: null,
    censusAgeBlocks: null,
    censusStale: false,
    scope: 'retained',
    ratio: 1,
    gain: 0.4,
  };
};

const composingBand = (root: HTMLElement) =>
  root.querySelector('[data-stage-composing-banner]') as HTMLElement | null;

describe('HudOverlay — the stage composing chapter', () => {
  const settled = (extra: Record<string, unknown> = {}) => render(
    <HudOverlay
      chain={chain}
      peers={peers}
      localNode={localNode}
      cellsStats={cellsStats}
      {...extra}
    />,
  );

  it('discloses a still-filling stage once the record has stood down', () => {
    const { container } = settled({
      cellPopulation: populationModel(9_298, 12_000),
    });
    const band = composingBand(container);
    expect(band).not.toBeNull();
    expect(band?.textContent).toContain('STAGE COMPOSING');
    expect(band?.textContent).toContain('STAGED 9,298 / 12,000');
    // Filling is the one movement with an honest denominator, so it is the one
    // that draws the edge.
    expect(band?.querySelector('[data-top-band-fill]')).not.toBeNull();
  });

  it('speaks for a stage that is full but still uncomposed', () => {
    const { container } = settled({
      cellPopulation: populationModel(12_000, 12_000, { composed: false }),
    });
    const band = composingBand(container);
    expect(band).not.toBeNull();
    expect(band?.textContent).toContain('AWAITING COMPOSITION');
    // …and draws no bar for it: every seat is taken and none of them is the
    // one the composition means to put there.
    expect(band?.querySelector('[data-top-band-fill]')).toBeNull();
  });

  it('never renders for a stage that booted full and composed — the refresh case', () => {
    const { container } = settled({
      cellPopulation: populationModel(12_000, 12_000, { curated: 9_000 }),
    });
    expect(composingBand(container)).toBeNull();
  });

  it('never renders without a display plane', () => {
    const { container } = settled({
      cellPopulation: populationModel(9_298, null),
    });
    expect(composingBand(container)).toBeNull();
  });

  it('holds while the boot readout still owns the slot', () => {
    resetBootSequenceForTest();
    const { container } = settled({
      cellPopulation: populationModel(9_298, 12_000),
    });
    expect(container.querySelector('[data-boot-banner]')).not.toBeNull();
    expect(composingBand(container)).toBeNull();
  });

  it('yields the slot to a stream fault', () => {
    const { container } = settled({
      cellPopulation: populationModel(9_298, 12_000),
      streamHealth: connectingStreams,
    });
    expect(container.querySelector('[data-stream-health-banner]')).not.toBeNull();
    expect(composingBand(container)).toBeNull();
  });

  it('yields the slot to the replay plate', () => {
    const { container } = settled({
      cellPopulation: populationModel(9_298, 12_000),
      backfill: { done: 1234, total: 65_829, phase: 'boot' },
    });
    expect(container.querySelector('[data-replay-phase="boot"]')).not.toBeNull();
    expect(composingBand(container)).toBeNull();
  });

  it('stays through the composition it exists to narrate, then leaves for good', () => {
    vi.useFakeTimers();
    const props = {
      chain, peers, localNode, cellsStats,
      cellPopulation: populationModel(11_488, 12_000, { composed: false }),
    };
    const { container, rerender } = render(<HudOverlay {...props} />);
    expect(composingBand(container)).not.toBeNull();

    // The seat count reaching the budget is where the old readout resolved —
    // measured, its last frame was a full bar drawn at the instant the
    // composition began. It is a movement, not an ending.
    rerender(<HudOverlay {...props} cellPopulation={
      populationModel(12_000, 12_000, { curated: 9_008, stampMs: 2 })
    } />);
    expect(composingBand(container)?.textContent).toContain('CURATED 9,008');

    // Top-up rounds keep swapping fill for curated members. Each one re-arms
    // the settle clock, so a gap shorter than it cannot end the chapter.
    act(() => { vi.advanceTimersByTime(STAGE_COMPOSE_SETTLE_MS - 1_000); });
    rerender(<HudOverlay {...props} cellPopulation={
      populationModel(12_000, 12_000, { curated: 10_169, stampMs: 2 })
    } />);
    act(() => { vi.advanceTimersByTime(STAGE_COMPOSE_SETTLE_MS - 1_000); });
    expect(composingBand(container)?.textContent).toContain('CURATED 10,169');

    // Nothing moves for a settle window: the world on screen IS the world.
    act(() => { vi.advanceTimersByTime(STAGE_COMPOSE_SETTLE_MS); });
    expect(composingBand(container)).toBeNull();

    // …and a later per-block dip is churn, not composing: the watch is
    // terminal for the session.
    rerender(<HudOverlay {...props} cellPopulation={
      populationModel(9_000, 12_000, { curated: 8_000, stampMs: 3 })
    } />);
    expect(composingBand(container)).toBeNull();
    vi.useRealTimers();
  });
});


// ——— The alarm is a band too ——————————————————————————————————————
//
// The top slot stacks. A banner (boot or stream) takes 30px, the alarm takes
// its own 34 under it, and the rails start below the stack. The alarm knew to
// sit under a banner from the day it was written; nothing knew to sit under
// the ALARM. So on every reorg and every at-tip stall — banner up or banner
// down, it made no difference — the rails started 22px INSIDE the band, and
// the CKB·01 and PULSE panels printed their top brackets and the first third
// of their headers over it. The rails are DOM-later so they win the paint, and
// their translucent ground let the flash strobe through them.
//
// What regressed is arithmetic, so arithmetic is what this pins. The bands are
// measured off the DOM they actually rendered rather than recomputed from
// numbers copied over here — recomputing the number somewhere else is the
// whole of the bug — and the clearance under the stack has to come out the
// same in every state the slot can be in.

import { STATUS_STRIP_HEIGHTS } from '../../../src/components/hud/StatusStrip';
import { WARNING_BAR_HEIGHT } from '../../../src/components/hud/WarningBar';

/** A pixel length written by a style prop, as a number. */
const px = (value: string): number => Number.parseFloat(value);

/** The gap the rails hold under whatever is standing in the slot, and the
 *  narrower one the floating plates hold. Two numbers because they are two
 *  kinds of surface; one number each because a clearance that changes with
 *  the tenant is the same drift wearing a different hat. */
const RAIL_CLEARANCE_PX = 12;
const PLATE_CLEARANCE_PX = 10;

/** A chain stalled at tip: caught up, and no block for ten minutes. The alarm
 *  this raises is `danger / stalled` — a real one, from the real derive, so
 *  the suite cannot pass by describing an alarm nobody would ever see. */
const stalled = (): ChainEntry => ({
  ...chain,
  recent_block_intervals_ms: Array.from({ length: 60 }, () => 8000),
  last_block_ts_ms: Date.now() - 600_000,
});

const alarmBand = (root: HTMLElement): HTMLElement | null =>
  (root.querySelector('[data-warning-trigger]')?.parentElement as HTMLElement) ?? null;

/** The bottom edge of the lowest band standing in the top slot, taken from
 *  what rendered: each band's own `top` plus its own `height`. Falls back to
 *  the status strip when the slot is empty, because the strip is then the
 *  ceiling everything hangs from. */
const slotBottom = (root: HTMLElement): number => [
  root.querySelector('[data-boot-banner]'),
  root.querySelector('[data-stream-health-banner]'),
  alarmBand(root),
].reduce(
  (bottom, band) => (band === null
    ? bottom
    : Math.max(bottom, px((band as HTMLElement).style.top) + px((band as HTMLElement).style.height))),
  STATUS_STRIP_HEIGHTS.wide as number,
);

const SLOT_LAYOUTS = [
  { name: 'a quiet slot', boot: false, streams: false, alarm: false },
  { name: 'an alarm standing alone', boot: false, streams: false, alarm: true },
  { name: 'the boot readout alone', boot: true, streams: false, alarm: false },
  { name: 'the boot readout over an alarm', boot: true, streams: false, alarm: true },
  { name: 'a stream fault over an alarm', boot: false, streams: true, alarm: true },
] as const;

describe('HudOverlay — everything below the top slot clears the whole stack', () => {
  const mount = (layout: { boot: boolean; streams: boolean; alarm: boolean }) => {
    vi.useFakeTimers();
    if (layout.boot) resetBootSequenceForTest();
    return render(
      <HudOverlay
        chain={layout.alarm ? stalled() : chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        streamHealth={layout.streams ? connectingStreams : undefined}
      />,
    );
  };

  it.each(SLOT_LAYOUTS)('holds one clearance under $name', (layout) => {
    const { container } = mount(layout);

    // The states are real, not asserted into being: check the slot actually
    // contains what the row claims before measuring anything about it.
    expect(Boolean(container.querySelector('[data-boot-banner]'))).toBe(layout.boot);
    expect(Boolean(container.querySelector('[data-stream-health-banner]')))
      .toBe(layout.streams && !layout.boot);
    expect(Boolean(alarmBand(container))).toBe(layout.alarm);

    const left = container.querySelector('[data-hud-left-rail]') as HTMLElement;
    const mesh = container.querySelector('.cknerv-mesh-rail') as HTMLElement;
    expect(px(left.style.top)).toBe(slotBottom(container) + RAIL_CLEARANCE_PX);
    expect(px(mesh.style.top)).toBe(px(left.style.top));
  });

  it('budgets exactly the band it paints', () => {
    // The fix in one assertion. The height the bar renders and the offset the
    // surfaces below it add were two literals in two files, 22px apart, and
    // nothing ever made them meet. Now there is one exported number: retune it
    // and both sides move, or this fails.
    const { container } = mount({ boot: false, streams: false, alarm: true });
    const band = alarmBand(container) as HTMLElement;

    expect(px(band.style.height)).toBe(WARNING_BAR_HEIGHT);
    expect(px((container.querySelector('[data-hud-left-rail]') as HTMLElement).style.top))
      .toBe(px(band.style.top) + WARNING_BAR_HEIGHT + RAIL_CLEARANCE_PX);
  });

  it('drops the replay plate below a standing alarm too', () => {
    // The plate floats in the same column as the bands and is not held back by
    // an alarm — a catch-up and a stall are different facts and both are worth
    // saying — so it has to be moved rather than suppressed.
    vi.useFakeTimers();
    const { container } = render(
      <HudOverlay
        chain={stalled()}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        backfill={{ done: 1234, total: 65_829, phase: 'boot' }}
      />,
    );

    const plate = container.querySelector('[data-replay-phase="boot"]') as HTMLElement;
    expect(alarmBand(container)).not.toBeNull();
    expect(px(plate.style.top)).toBe(slotBottom(container) + PLATE_CLEARANCE_PX);
  });

  it('yields the composing chapter to an alarm, the way it yields to the rest', () => {
    // The chapter is the quietest thing in the slot — a disclosure, not a
    // fault — and it already stands down for the boot readout, a stream fault
    // and a replay. An alarm is the loudest of the four; it cannot be the one
    // the chapter talks over.
    vi.useFakeTimers();
    const { container } = render(
      <HudOverlay
        chain={stalled()}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        cellPopulation={populationModel(9_298, 12_000)}
      />,
    );

    expect(alarmBand(container)).not.toBeNull();
    expect(composingBand(container)).toBeNull();
  });
});

/**
 * The collapse rule. jsdom lays nothing out, so the oracle is the arithmetic
 * the layout is made of rather than a rendered box: every left panel's measure
 * plus the 14 px inset, every right panel's measure plus its own, and the hole
 * that leaves. The rendered version of the same reading is the live rects dump
 * in `runs/A5b/`.
 *
 * The threshold itself is not a screen size: the rails collapse exactly where
 * two full rails would stop leaving room for a card to stand beside its cell
 * (`RAILS_COLLAPSE_MAX_WIDTH_PX`, 1,523 px). So 1,440 is a COLLAPSED stage here
 * and 1,600 is the one that keeps its full measure.
 */
describe('HudOverlay rail collapse', () => {
  /** Outer box of a HudPanel: its declared measure plus `13px 15px` of padding
   *  on a box that is not `border-box`. */
  const outer = (el: HTMLElement): number => Number.parseFloat(
    (el.style.width || '0').replace(/^min\(/, '').split('px')[0],
  ) + 30;

  const panelBox = (container: HTMLElement, id: string): number => {
    const wrap = container.querySelector(`[data-hud-panel="${id}"]`) as HTMLElement;
    const panel = wrap.querySelector('[data-hud-occlusion="true"]') as HTMLElement;
    return outer(panel);
  };

  const stage = (width: number) => {
    vi.stubGlobal('matchMedia', (query: string) => {
      const max = /max-width:\s*(\d+)px/.exec(query);
      return {
        matches: max ? width <= Number(max[1]) : false,
        addEventListener: () => {},
        removeEventListener: () => {},
      };
    });
    return render(
      <HudOverlay
        chain={chain}
        peers={peers}
        localNode={localNode}
        cellsStats={cellsStats}
        enrichmentSource={enrichmentSource}
        daoState={daoState}
      />,
    );
  };

  const holeAt = (container: HTMLElement, width: number): number => {
    // The two rails, measured from their own insets: 14 px on each side.
    const left = 14 + Math.max(
      panelBox(container, 'chain'),
      panelBox(container, 'pulse'),
      panelBox(container, 'dao'),
    );
    const right = 14 + Math.max(
      panelBox(container, 'cells'),
      panelBox(container, 'peers'),
    );
    return width - left - right;
  };

  it('leaves the stage more than half of a 1280px page', () => {
    // The gate the plan sets, at the width it sets it: at `25c7d5a` the hole
    // was 550 px of 1,280 — 43 % — with the card on top of it.
    const { container } = stage(1280);

    expect(holeAt(container, 1280) / 1280).toBeGreaterThanOrEqual(0.5);
  });

  it('still leaves a stage at 1100', () => {
    // No share is promised down here — the rails have a floor and 1,100 is
    // below where half is reachable — but the stage must not close.
    const { container } = stage(1100);

    expect(holeAt(container, 1100)).toBeGreaterThan(500);
  });

  it('keeps the full measure above the threshold', () => {
    const { container } = stage(1600);

    expect(panelBox(container, 'chain')).toBe(370);
    expect(panelBox(container, 'cells')).toBe(332);
    expect(panelBox(container, 'peers')).toBe(332);
  });

  it('leaves exactly the rails the collapse rule is stated from', () => {
    // The rule's own arithmetic against the rails as rendered: two insets, a
    // chain panel and a mesh panel, each in its frame. `RAILS_FULL_WIDTH_PX`
    // restates the mesh measure and the frame; this is the toll on both.
    const { container } = stage(1600);

    expect(1600 - holeAt(container, 1600)).toBe(RAILS_FULL_WIDTH_PX);
  });

  it('leaves a 1440px page room for a card beside its cell', () => {
    // The stage this task exists for. Two full rails leave 710 px there, and
    // the narrowest card this dialect has is 728 — so before the collapse
    // reached 1,440 every family (beside, stacked, docked) landed the card on
    // a rail. Collapsed, the same page leaves 874.
    const { container } = stage(1440);

    expect(panelBox(container, 'chain')).toBe(298);
    expect(panelBox(container, 'cells')).toBe(240);
    expect(holeAt(container, 1440)).toBeGreaterThanOrEqual(RAILS_COLLAPSE_HOLE_PX);
  });

  it('collapses exactly where a full-railed page runs out of that room', () => {
    // Both sides of the threshold, and the threshold is the point: one pixel
    // above it the rails stay full and the stage still holds card + tether +
    // margin; at it the stage would have been a pixel short, so the rails give
    // way instead.
    const above = stage(RAILS_COLLAPSE_MAX_WIDTH_PX + 1);
    expect(panelBox(above.container, 'chain')).toBe(370);
    expect(holeAt(above.container, RAILS_COLLAPSE_MAX_WIDTH_PX + 1))
      .toBeGreaterThanOrEqual(RAILS_COLLAPSE_HOLE_PX);
    cleanup();

    const at = stage(RAILS_COLLAPSE_MAX_WIDTH_PX);
    expect(panelBox(at.container, 'chain')).toBe(298);
    expect(RAILS_COLLAPSE_MAX_WIDTH_PX - RAILS_FULL_WIDTH_PX)
      .toBeLessThan(RAILS_COLLAPSE_HOLE_PX);
  });

  it('keeps CKB\u00b701\u2019s own five rows through the collapse', () => {
    // The panel narrows and its three lower sections fold (see
    // `ChainCapacityReadout.test.tsx`), but tip, epoch, progress, mempool and
    // reorgs are what CKB\u00b701 IS and none of them goes.
    const { container } = stage(1280);
    const chainPanel = container.querySelector('[data-hud-panel="chain"]') as HTMLElement;

    for (const row of ['Tip', 'Epoch', 'Epoch progress', 'Mempool', 'Reorgs']) {
      expect(chainPanel.textContent).toContain(row);
    }
    expect(panelBox(container, 'chain')).toBe(298);
  });

  it('leaves the mesh panels a header, a hero and one row', () => {
    const { container } = stage(1280);
    const cells = container.querySelector('[data-hud-panel="cells"]') as HTMLElement;
    const peers_ = container.querySelector('[data-hud-panel="peers"]') as HTMLElement;

    expect(cells.textContent).toContain('CELL MESH');
    expect(cells.textContent).toContain('Observed live');
    expect(cells.textContent).not.toContain('BORN');
    expect(cells.textContent).not.toContain('Total observed');
    expect(peers_.textContent).toContain('PEER MESH');
    expect(peers_.textContent).toContain('Peers');
    expect(peers_.textContent).not.toContain('AT-TIP');
    expect(peers_.textContent).not.toContain('Head consensus');
  });

  it('keeps every row above the threshold', () => {
    const { container } = stage(1600);
    const cells = container.querySelector('[data-hud-panel="cells"]') as HTMLElement;
    const chainPanel = container.querySelector('[data-hud-panel="chain"]') as HTMLElement;

    expect(cells.textContent).toContain('BORN');
    expect(cells.textContent).toContain('Total observed');
    expect(panelBox(container, 'chain')).toBe(370);
  });
});
