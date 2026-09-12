// WHICH RENDERS REACH WHICH PANEL.
//
// Five ticks of the shared clock reach the two spans that print a time and
// nothing else — not the overlay root, not one of the six memoized panels. A
// chain batch that moved only the mempool reaches CKB·01, which prints it, and
// no other panel. A cells batch at rest reaches neither strip, because the one
// thing it moves is a count the bar is not carrying while the cap control is
// away. And a chain clone that moved nothing CKB·01 prints reaches CKB·01 not
// at all — nor the three derives under it.
//
// Every one of those is a claim about a MEMO's key, and a memo key is exactly
// the kind of thing that can be got right in the source and wrong in the tree.
// The counts below are the tree.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { emptyScriptCensus } from '@cknerv/cache';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ActivityFeedRecord,
  AssetEcosystemRecord,
  ChainEntry,
  ChainNode,
  DaoStateRecord,
  EnrichmentSourceStatus,
  Peer,
  ScriptFamilyCensusRecord,
  TransactionHorizonRecord,
} from '@cknerv/types';
import type { CellsStats } from '../../../src/derives/cellsStats.derive';
import type { StreamHealthChannels } from '../../../src/derives/streamHealth.derive';
import {
  completeBootPhase,
  resetBootSequenceForTest,
  type BootPhaseId,
} from '../../../src/boot/bootSequence';
import { resetHudClockForTest } from '../../../src/components/hud/hudClock';

/** The HUD's own printed text, written from the code as it stood before the
 *  render keys were narrowed. A golden, so it is never regenerated to make a
 *  red test green: a change here is a change the reader would see. */
const HUD_TEXT_GOLDEN = readFileSync(
  resolve(process.cwd(), '__tests__/fixtures/hudOverlayText.txt'),
  'utf8',
);

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
// The three derives CKB·01's sections run — counted through the real
// implementations, so what is read is how often they ran and not whether they
// were replaced.
vi.mock('../../../src/derives/activityFeed.derive', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('../../../src/derives/activityFeed.derive')
  >();
  return {
    ...original,
    deriveActivityRows: (...args: Parameters<typeof original.deriveActivityRows>) => {
      bump('deriveActivityRows');
      return original.deriveActivityRows(...args);
    },
  };
});
vi.mock('../../../src/derives/transactionHorizon.derive', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('../../../src/derives/transactionHorizon.derive')
  >();
  return {
    ...original,
    deriveTransactionHorizonVisual: (
      ...args: Parameters<typeof original.deriveTransactionHorizonVisual>
    ) => {
      bump('deriveTransactionHorizonVisual');
      return original.deriveTransactionHorizonVisual(...args);
    },
  };
});
vi.mock('../../../src/derives/scriptFamilies.derive', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('../../../src/derives/scriptFamilies.derive')
  >();
  return {
    ...original,
    chainInventoryBuckets: (
      ...args: Parameters<typeof original.chainInventoryBuckets>
    ) => {
      bump('chainInventoryBuckets');
      return original.chainInventoryBuckets(...args);
    },
  };
});
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
const DERIVES = [
  'deriveActivityRows', 'deriveTransactionHorizonVisual', 'chainInventoryBuckets',
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
  capabilities: [
    'dao_state', 'asset_ecosystem', 'script_family_census',
    'transaction_horizon', 'activity_feed',
  ],
  validated_anchor: { block: 100, hash: '0xblock100' },
};

/** The three enrichment records CKB·01's sections are drawn from. Small, but
 *  each one has to be ACCEPTED by its section's visual-state guard, or the
 *  section returns null and the derive under it never runs. */
const AS_OF = { block: 100, hash: '0xblock100' };

const transactionHorizon: TransactionHorizonRecord = {
  source: 'ckbadger',
  as_of: AS_OF,
  updated_at_ms: 1,
  current_hour: 512,
  current_day: 11_204,
  hourly_counts: Array.from({ length: 24 }, (_, i) => 400 + i * 11),
  daily_counts: Array.from({ length: 7 }, (_, i) => 9_000 + i * 120),
};

const activityFeed: ActivityFeedRecord = {
  source: 'ckbadger',
  as_of: AS_OF,
  updated_at_ms: 1,
  window_ms: 3_600_000,
  kinds: [
    { kind: 'transfer', in_window: 42, in_window_capped: false },
    { kind: 'dao', in_window: 6, in_window_capped: false },
    { kind: 'token', in_window: 0, in_window_capped: false },
    { kind: 'object', in_window: 0, in_window_capped: false },
    { kind: 'identity', in_window: 0, in_window_capped: false },
    { kind: 'protocol', in_window: 0, in_window_capped: false },
    { kind: 'script', in_window: 100, in_window_capped: true },
  ],
};

const assetEcosystem: AssetEcosystemRecord = {
  source: 'ckbadger',
  as_of: AS_OF,
  updated_at_ms: 1,
  total_live_capacity_shannons: '5776320963848791674',
  total_knowledge_bytes: 159_890_202,
  capacity_breakdown: [
    { category: 'dao', capacity_shannons: '837590809032221706', share_bps: 1450 },
    { category: 'other', capacity_shannons: '4930329549799590489', share_bps: 8550 },
  ],
  top_assets: [],
};

const scriptFamilyCensus: ScriptFamilyCensusRecord = {
  source: 'ckbadger',
  as_of: AS_OF,
  updated_at_ms: 1,
  live_cells: 1_471_373,
  types_absent: 972_811,
  types_dao: 22_690,
  types_unlisted: 36_622,
  locks_unlisted: 10_916,
  families: [
    { name: 'Nervos DAO', kind: 'type', live_cells: 22_690 },
    { name: 'xUDT', kind: 'type', live_cells: 57_748, inventory: 'token' },
    { name: 'Spore', kind: 'type', live_cells: 37_275, inventory: 'object' },
    { name: '.bit Account', kind: 'type', live_cells: 6_245, inventory: 'identity' },
    { name: 'Default Lock', kind: 'lock', live_cells: 893_139 },
  ],
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

/** What a batch can move: the chain entity, the cells tally, and the count of
 *  Cells the stage could show. */
interface HudInputs {
  chain: ChainEntry;
  cellsStats: CellsStats;
  cellCount?: number;
}

function mountSettled(initial: Partial<HudInputs> = {}) {
  const mountedAt = Date.now();
  const daoState = daoStateAt(mountedAt);
  const streamHealth = streamsAt(mountedAt);
  let inputs: HudInputs = { chain, cellsStats, ...initial };
  const element = () => (
    <HudOverlay
      chain={inputs.chain}
      peers={peers}
      localNode={localNode}
      cellsStats={inputs.cellsStats}
      cellCount={inputs.cellCount}
      enrichmentSource={enrichmentSource}
      activityFeed={activityFeed}
      transactionHorizon={transactionHorizon}
      assetEcosystem={assetEcosystem}
      scriptFamilyCensus={scriptFamilyCensus}
      daoState={daoState}
      streamHealth={streamHealth}
    />
  );
  const view = render(element());
  // Past the boot count-off: the ritual re-renders the root once a beat, and
  // this suite is about the HUD the visitor settles into.
  for (let beat = 0; beat < BOOT_BEATS; beat += 1) {
    act(() => { vi.advanceTimersByTime(BOOT_BEAT_MS); });
  }
  const rerender = (next: Partial<HudInputs>) => {
    inputs = { ...inputs, ...next };
    view.rerender(element());
  };
  return { ...view, rerender, mountedAt };
}

const snapshot = () => Object.fromEntries(
  ['HudOverlay', ...PANELS, ...DERIVES].map((name) => [name, renders.get(name) ?? 0]),
);

describe('HudOverlay and the shared clock', () => {
  it('lets five ticks reach the two time readouts and nothing else', () => {
    const { container } = mountSettled();
    const before = snapshot();
    const text = () => container.textContent ?? '';
    // Boot settled 1.3s after mount: the two readouts print that.
    expect(text()).toContain('1S AGO');
    expect(text()).toContain('LAST FRAME 18S');

    act(() => { vi.advanceTimersByTime(5_000); });

    expect(container.querySelector('[data-status-uptime]')).toBeNull();
    expect(text()).toContain('6S AGO');
    expect(text()).toContain('LAST FRAME 23S');
    // …and no panel, nor the root, rendered for it.
    expect(snapshot()).toEqual(before);
  });

  it('routes a mempool tick to CKB·01 alone', () => {
    const { rerender } = mountSettled();
    const before = snapshot();

    act(() => {
      rerender({
        chain: {
          ...chain,
          mempool: { ...chain.mempool, pending: chain.mempool.pending + 1 },
        },
      });
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


describe('what each panel is keyed on', () => {
  it('spends a cells batch on neither strip while the cap control is away', () => {
    // The bar carries `cellCount` for one reason: the STAGE CELLS cap, which
    // is not in the bar until the quality rail has been used. At rest the
    // count is a number nothing up there prints, and it moved on every cells
    // batch — through BOTH strip copies, the visible one and the hidden probe
    // the fold is measured on (report L4-1).
    const { rerender, container } = mountSettled({ cellCount: 19_204 });
    const before = snapshot();
    const printed = container.textContent;

    act(() => {
      rerender({
        cellsStats: { ...cellsStats, inView: 19_240, live: 19_240 },
        cellCount: 19_240,
      });
    });

    const after = snapshot();
    expect(after.StatusStrip, 'a cells batch reached the strip').toBe(before.StatusStrip);
    // The root prints the tally itself, so it renders; so does CELL·03.
    expect(after.HudOverlay).toBe(before.HudOverlay + 1);
    expect(after.CellsPanel).toBe(before.CellsPanel + 1);
    expect(container.textContent).not.toBe(printed);
  });

  it('spends a chain clone that moved nothing it prints on nobody', () => {
    // `chain` is shallow-cloned by every batch that touches it — a peer
    // refresh, a transaction, an enrichment status — while CKB·01 prints the
    // tip, the epoch, the mempool, the reorg tally and (through the era badge)
    // the network's name. A clone that moved none of those is not news.
    const { rerender, container } = mountSettled();
    const before = snapshot();
    const printed = container.textContent;

    act(() => {
      rerender({ chain: { ...chain, total_txs: chain.total_txs + 7 } });
    });

    const after = snapshot();
    expect(after.HudOverlay).toBe(before.HudOverlay + 1);
    expect(after.BlockchainReadout, 'CKB·01 rendered for a field it does not print')
      .toBe(before.BlockchainReadout);
    for (const name of DERIVES) {
      expect(after[name], `${name} re-ran for a field it does not read`)
        .toBe(before[name]);
    }
    expect(container.textContent).toBe(printed);
  });

  it('re-runs no derive for a tip that moved under it', () => {
    // The three sections under the chain rows are drawn from enrichment
    // records on their own 30–60 s cadence. A block moves the tip and nothing
    // they read, and each of them walked its whole record again for it
    // (report L4-3).
    const { rerender, container } = mountSettled();
    const before = snapshot();
    const printed = container.textContent;

    act(() => { rerender({ chain: { ...chain, tip: chain.tip + 1 } }); });

    const after = snapshot();
    expect(after.BlockchainReadout).toBe(before.BlockchainReadout + 1);
    for (const name of DERIVES) {
      expect(after[name], `${name} re-ran for a tip change`).toBe(before[name]);
    }
    expect(container.textContent).not.toBe(printed);
  });

  it('prints exactly what it printed before the keys changed', () => {
    // ⚠️ A GOLDEN, and the rule for one: it was written from the code as it
    // stood BEFORE this task and is never regenerated to make a red test
    // green. Every claim above is about WHEN a panel renders; this is the one
    // that says the panel still renders the same HUD.
    const { container } = mountSettled({ cellCount: 19_204 });
    expect(container.textContent).toBe(HUD_TEXT_GOLDEN);
  });
});
