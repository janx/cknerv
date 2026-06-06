import { describe, it, expect } from 'vitest';
import {
  latencyToRadius01,
  peerAngle,
  peerWorldPosition,
  syncProximity,
  peerColorKind,
  peerChurnDiff,
  summarizeNetwork,
  PEER_INNER_RADIUS,
  PEER_OUTER_RADIUS,
} from '../src/derives/peers.derive';
import { CHAIN_Y } from '../src/layout';
import { emptyChainCache } from '@cknerv/cache';
import type { Peer, ChainNode } from '@cknerv/types';

function peer(p: Partial<Peer>): Peer {
  return {
    node_id: 'Qm', addr: '1.2.3.4:8115', direction: 'outbound',
    version: '0.116.1', connected_ms: 0, ...p,
  };
}

describe('peers.derive', () => {
  it('latencyToRadius01 maps null to mid and clamps', () => {
    expect(latencyToRadius01(null)).toBe(0.5);
    expect(latencyToRadius01(undefined)).toBe(0.5);
    expect(latencyToRadius01(0)).toBe(0);
    expect(latencyToRadius01(100000)).toBe(1);
  });

  it('peerAngle is deterministic and in range', () => {
    const a = peerAngle('QmA');
    expect(a).toBe(peerAngle('QmA'));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(Math.PI * 2);
    expect(peerAngle('QmA')).not.toBe(peerAngle('QmB'));
  });

  it('peerWorldPosition sits on the chain plane within the annulus', () => {
    const [x, y, z] = peerWorldPosition(peer({ node_id: 'QmX', latency_ms: 0 }));
    expect(y).toBe(CHAIN_Y);
    const r = Math.hypot(x / 1.25, z / 0.85); // undo ellipse stretch
    expect(r).toBeGreaterThanOrEqual(PEER_INNER_RADIUS - 0.001);
    expect(r).toBeLessThanOrEqual(PEER_OUTER_RADIUS + 0.001);
  });

  it('syncProximity is 1 at tip, decays with lag, 0.5 when unknown', () => {
    expect(syncProximity(100, 100)).toBe(1);
    expect(syncProximity(null, 100)).toBe(0.5);
    expect(syncProximity(0, 2000)).toBe(0); // 2000 behind => floor
    expect(syncProximity(1000, 2000)).toBeCloseTo(0.5, 5);
  });

  it('peerColorKind reflects version mismatch then direction', () => {
    expect(peerColorKind(peer({ version: '0.115.0' }), '0.116.1')).toBe('version');
    expect(peerColorKind(peer({ direction: 'outbound', version: '0.116.1' }), '0.116.1')).toBe('outbound');
    expect(peerColorKind(peer({ direction: 'inbound', version: '0.116.1' }), '0.116.1')).toBe('inbound');
  });

  it('peerChurnDiff splits joined/dropped/stable by node_id', () => {
    const a = peer({ node_id: 'A' });
    const b = peer({ node_id: 'B' });
    const c = peer({ node_id: 'C' });
    const churn = peerChurnDiff([a, b], [b, c]);
    expect(churn.joined.map((p) => p.node_id)).toEqual(['C']);
    expect(churn.dropped.map((p) => p.node_id)).toEqual(['A']);
    expect(churn.stable.map((p) => p.node_id)).toEqual(['B']);
  });

  it('summarizeNetwork computes counts, median ping and sync label', () => {
    const chain = { ...emptyChainCache(), tip: 100, best_known_block: 100, ibd: false };
    const local: ChainNode = { id: 'ckb:local', label: 'L', is_miner: false, version: '0.116.1', connections: 3 };
    const s = summarizeNetwork(
      [
        peer({ node_id: 'A', direction: 'outbound', latency_ms: 10 }),
        peer({ node_id: 'B', direction: 'inbound', latency_ms: 30 }),
        peer({ node_id: 'C', direction: 'inbound', latency_ms: 50 }),
      ],
      chain,
      local,
    );
    expect(s.peerCount).toBe(3);
    expect(s.outbound).toBe(1);
    expect(s.inbound).toBe(2);
    expect(s.medianPingMs).toBe(30);
    expect(s.version).toBe('0.116.1');
    expect(s.syncLabel).toBe('AT TIP');
  });

  it('summarizeNetwork labels syncing + ibd', () => {
    const base = { ...emptyChainCache(), tip: 100 };
    expect(summarizeNetwork([], { ...base, best_known_block: 130, ibd: false }, undefined).syncLabel)
      .toBe('SYNCING 30 behind');
    expect(summarizeNetwork([], { ...base, best_known_block: 130, ibd: true }, undefined).syncLabel)
      .toBe('IBD');
  });
});
