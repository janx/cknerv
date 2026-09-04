// The render-count half of the HUD clock: five ticks of the shared clock
// reach the three spans that print a time and nothing else — not the overlay
// root, not one of the six memoized panels. The second suite holds the other
// promise the panel memos make: a chain batch that moved only the mempool
// reaches CKB·01, which prints it, and no other panel.
import { emptyScriptCensus } from '@cknerv/cache';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ChainEntry,
  ChainNode,
  DaoStateRecord,
  EnrichmentSourceStatus,
  Peer,
} from '@cknerv/types';
import type { CellsStats } from '../../../src/derives/cellsStats.derive';
import type { StreamHealthChannels } from '../../../src/derives/streamHealth.derive';
import {
  completeBootPhase,
  resetBootSequenceForTest,
  type BootPhaseId,
} from '../../../src/boot/bootSequence';
import { resetHudClockForTest } from '../../../src/components/hud/hudClock';

const { renders, bump, counted } = vi.hoisted(() => {
  const renders = new Map<string, number>();
  const bump = (name: string) => renders.set(name, (renders.get(name) ?? 0) + 1);
  /** Wrap a module's default export in a memo that counts the renders that
   *  reach it — the parent renders that changed at least one of its props. */
  const counted = (name: string) => async (
    importOriginal: () => Promise<Record<string, unknown>>,
  ) => {
    const original = await importOriginal();
    const { createElement, memo } = await import('react');
    type Props = Record<string, unknown>;
    const Original = original.default as import('react').ComponentType<Props>;
    return {
      ...original,
      default: memo(function Counted(props: Props) {
        bump(name);
        return createElement(Original, props);
      }),
    };
  };
  return { renders, bump, counted };
});

vi.mock('../../../src/components/hud/StatusStrip', counted('StatusStrip'));
vi.mock('../../../src/components/hud/BlockchainReadout', counted('BlockchainReadout'));
vi.mock('../../../src/components/hud/CellsPanel', counted('CellsPanel'));
vi.mock('../../../src/components/hud/NetworkPanel', counted('NetworkPanel'));
vi.mock('../../../src/components/hud/DaoStatePanel', counted('DaoStatePanel'));
vi.mock('../../../src/components/hud/BlockCadenceEcg', counted('BlockCadenceEcg'));
// The overlay root, counted through the one derive it calls on every render
// it makes while a stream health record is mounted.
vi.mock('../../../src/derives/streamHealth.derive', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('../../../src/derives/streamHealth.derive')
  >();
  return {
    ...original,
    deriveStreamHealthPhase: (channels: StreamHealthChannels) => {
      bump('HudOverlay');
      return original.deriveStreamHealthPhase(channels);
    },
  };
});

import HudOverlay from '../../../src/components/hud/HudOverlay';

const PANELS = [
  'StatusStrip', 'BlockchainReadout', 'CellsPanel', 'NetworkPanel', 'DaoStatePanel', 'BlockCadenceEcg',
] as const;

const BOOT_RECORD_PHASES: readonly Exclude<BootPhaseId, 'seeding'>[] = [
  'instrument', 'snapshot', 'decode', 'gl', 'first_light', 'fabric', 'data_plane',
];
/** One module's beat of the boot count-off, and enough of them to settle it. */
const BOOT_BEAT_MS = 130;
const BOOT_BEATS = 10;

beforeEach(() => {
  resetBootSequenceForTest();
  for (const id of BOOT_RECORD_PHASES) completeBootPhase(id);
  renders.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-28T10:00:00Z'));
});
afterEach(() => {
  cleanup();
  resetHudClockForTest();
  vi.useRealTimers();
  resetBootSequenceForTest();
});

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

function daoStateAt(updatedAtMs: number): DaoStateRecord {
  return {
    source: 'ckbadger',
    as_of: { block: 100, hash: '0xblock100' },
    statistics_block: 99,
    updated_at_ms: updatedAtMs,
    total_deposited_shannons: '837703738002110308',
    total_depositors: 16_740,
    active_deposits: 22_659,
    pending_withdrawal_shannons: '77523020877862416',
    unclaimed_compensation_shannons: '81345902996799859',
    estimated_apc_bps: 201,
  };
}

function streamsAt(nowMs: number): StreamHealthChannels {
  return {
    chain: { phase: 'live', attempt: 0, lastMessageAtMs: nowMs - 1_000, reason: null },
    cells: { phase: 'stale', attempt: 2, lastMessageAtMs: nowMs - 17_000, reason: 'heartbeat_timeout' },
  };
}

function mountSettled(chainEntry: ChainEntry = chain) {
  const mountedAt = Date.now();
  const daoState = daoStateAt(mountedAt);
  const streamHealth = streamsAt(mountedAt);
  const view = render(
    <HudOverlay
      chain={chainEntry}
      peers={peers}
      localNode={localNode}
      cellsStats={cellsStats}
      enrichmentSource={enrichmentSource}
      daoState={daoState}
      streamHealth={streamHealth}
    />,
  );
  // Past the boot count-off: the ritual re-renders the root once a beat, and
  // this suite is about the HUD the visitor settles into.
  for (let beat = 0; beat < BOOT_BEATS; beat += 1) {
    act(() => { vi.advanceTimersByTime(BOOT_BEAT_MS); });
  }
  const rerender = (next: ChainEntry) => view.rerender(
    <HudOverlay
      chain={next}
      peers={peers}
      localNode={localNode}
      cellsStats={cellsStats}
      enrichmentSource={enrichmentSource}
      daoState={daoState}
      streamHealth={streamHealth}
    />,
  );
  return { ...view, rerender, mountedAt };
}

const snapshot = () => Object.fromEntries(
  ['HudOverlay', ...PANELS].map((name) => [name, renders.get(name) ?? 0]),
);

describe('HudOverlay and the shared clock', () => {
  it('lets five ticks reach the three time readouts and nothing else', () => {
    const { container } = mountSettled();
    const before = snapshot();
    const text = () => container.textContent ?? '';
    // Boot settled 1.3s after mount: the three readouts print that.
    expect(text()).toContain('UP 00:00:01');
    expect(text()).toContain('1s AGO');
    expect(text()).toContain('LAST FRAME 18s');

    act(() => { vi.advanceTimersByTime(5_000); });

    expect(text()).toContain('UP 00:00:06');
    expect(text()).toContain('6s AGO');
    expect(text()).toContain('LAST FRAME 23s');
    // …and no panel, nor the root, rendered for it.
    expect(snapshot()).toEqual(before);
  });

  it('routes a mempool tick to CKB·01 alone', () => {
    const { rerender } = mountSettled();
    const before = snapshot();

    act(() => {
      rerender({ ...chain, mempool: { ...chain.mempool, pending: chain.mempool.pending + 1 } });
    });

    const after = snapshot();
    // The root renders once for the new entity; CKB·01 prints the mempool
    // and renders once; every other panel's inputs are keyed on what it
    // reads, and none of that moved.
    expect(after.HudOverlay).toBe(before.HudOverlay + 1);
    expect(after.BlockchainReadout).toBe(before.BlockchainReadout + 1);
    for (const name of ['StatusStrip', 'CellsPanel', 'NetworkPanel', 'DaoStatePanel', 'BlockCadenceEcg'] as const) {
      expect(after[name], `${name} rendered for a mempool tick`).toBe(before[name]);
    }
  });
});
