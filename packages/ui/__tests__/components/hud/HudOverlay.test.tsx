import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import type { ChainEntry, Peer, ChainNode } from '@cknerv/types';
import HudOverlay from '../../../src/components/hud/HudOverlay';
import type { CellsStats } from '../../../src/derives/cellsStats.derive';

afterEach(cleanup);

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
    expect(t).toContain('BLOCKCHAIN');   // readout
    expect(t).toContain('BLOCK CADENCE');// ecg
    expect(t).toContain('NETWORK');      // network
    expect(t).toContain('CELLS');        // cells
  });

  it('reads CAUTION when recent intervals run ~1.5x the protocol target', () => {
    const slow: ChainEntry = { ...chain, recent_block_intervals_ms: Array.from({ length: 30 }, () => 12000), last_block_ts_ms: Date.now() };
    const { container } = render(<HudOverlay chain={slow} peers={peers} localNode={localNode} cellsStats={cellsStats} />);
    expect(container.textContent).toContain('CAUTION');
  });
});
