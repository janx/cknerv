import { describe, it, expect } from 'vitest';
import {
  latencyToRadius01,
  peerAngle,
  peerWorldPosition,
  syncProximity,
  peerColorKind,
  peerChurnDiff,
  summarizeNetwork,
  peerCrystalSize,
  peerCrystalBrightness,
  blockCourierState,
  peerBeamFiredAge,
  peerArrivalAge,
  blockArrivalSchedule,
  rankPeers,
  PEER_RENDER_CAP,
  BLOCK_RECEIVE_S,
  BLOCK_RELAY_S,
  BLOCK_STAGGER_S,
  BLOCK_ARRIVAL_SPREAD_S,
  BLOCK_ARRIVAL_JITTER_S,
  BLOCK_RELAY_HOP_S,
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

  it('peerCrystalSize grows with sync proximity within bounds', () => {
    expect(peerCrystalSize(0)).toBeCloseTo(0.55, 5);
    expect(peerCrystalSize(0.5)).toBeCloseTo(1.1, 5);
    expect(peerCrystalSize(1)).toBeCloseTo(1.65, 5);
  });

  it('peerCrystalBrightness grows with sync proximity', () => {
    expect(peerCrystalBrightness(0)).toBeCloseTo(0.45, 5);
    expect(peerCrystalBrightness(1)).toBeCloseTo(0.95, 5);
  });

  it('blockCourierState: source rides peer→hub during receive', () => {
    expect(blockCourierState(-0.1, 0, true)).toEqual({ phase: 'idle', pos: 0 });
    expect(blockCourierState(0, 0, true)).toEqual({ phase: 'receive', pos: 1 });
    const r = blockCourierState(0.15, 0, true);
    expect(r.phase).toBe('receive');
    expect(r.pos).toBeCloseTo(0.5, 5); // 1 - 0.15/0.3
  });

  it('blockCourierState: non-source waits, then relays hub→peer', () => {
    expect(blockCourierState(0.15, 0, false).phase).toBe('idle'); // before relayStart
    expect(blockCourierState(0.3, 0, false)).toEqual({ phase: 'relay', pos: 0 });
    const y = blockCourierState(0.6, 0, false);
    expect(y.phase).toBe('relay');
    expect(y.pos).toBeCloseTo(0.5, 5); // (0.6 - 0.3) / 0.6
    expect(blockCourierState(0.9, 0, false).phase).toBe('idle'); // after relay window
  });

  it('blockCourierState: stagger delays the relay departure', () => {
    expect(blockCourierState(0.4, 0.2, false).phase).toBe('idle'); // relayStart = 0.5
    // Source is intentionally idle between receive-end and its staggered relay.
    expect(blockCourierState(0.4, 0.2, true).phase).toBe('idle');
    const z = blockCourierState(0.6, 0.2, false);
    expect(z.phase).toBe('relay');
    expect(z.pos).toBeCloseTo(0.1667, 3); // (0.6 - 0.5) / 0.6
  });

  it('peerBeamFiredAge: relay arrival = receive + stagger + relay', () => {
    expect(peerBeamFiredAge(0)).toBeCloseTo(BLOCK_RECEIVE_S + BLOCK_RELAY_S, 6);
    expect(peerBeamFiredAge(BLOCK_STAGGER_S)).toBeCloseTo(
      BLOCK_RECEIVE_S + BLOCK_STAGGER_S + BLOCK_RELAY_S,
      6,
    );
    // Strictly increasing in stagger.
    expect(peerBeamFiredAge(0.1)).toBeLessThan(peerBeamFiredAge(0.2));
  });

  it('peerArrivalAge: deterministic per (peer, nonce)', () => {
    const p = peer({ node_id: 'A', latency_ms: 50 });
    expect(peerArrivalAge(p, 7)).toBe(peerArrivalAge(p, 7));
  });

  it('peerArrivalAge: higher latency arrives later (base dominates jitter)', () => {
    const lo = peer({ node_id: 'A', latency_ms: 0 });
    const hi = peer({ node_id: 'A', latency_ms: 400 });
    // base gap = SPREAD*0.85 ≈ 0.68 >> 2*jitter = 0.30, so this holds at any nonce
    for (const nonce of [1, 2, 3, 99]) {
      expect(peerArrivalAge(hi, nonce)).toBeGreaterThan(peerArrivalAge(lo, nonce));
    }
  });

  it('peerArrivalAge: within the jitter band of the latency base and >= 0', () => {
    const p = peer({ node_id: 'Z', latency_ms: 200 }); // latencyToRadius01 = 0.5
    const base = BLOCK_ARRIVAL_SPREAD_S * (0.15 + 0.85 * 0.5);
    for (const nonce of [0, 5, 42, 1000]) {
      const a = peerArrivalAge(p, nonce);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(Math.abs(a - base)).toBeLessThanOrEqual(BLOCK_ARRIVAL_JITTER_S + 1e-9);
    }
  });

  it('peerArrivalAge: a new block nonce shifts the time', () => {
    const p = peer({ node_id: 'A', latency_ms: 50 });
    expect(peerArrivalAge(p, 1)).not.toBe(peerArrivalAge(p, 2));
  });

  it('rankPeers: outbound first, then ascending latency', () => {
    const ranked = rankPeers([
      peer({ node_id: 'in-fast', direction: 'inbound', latency_ms: 5 }),
      peer({ node_id: 'out-slow', direction: 'outbound', latency_ms: 300 }),
      peer({ node_id: 'out-fast', direction: 'outbound', latency_ms: 10 }),
    ]);
    expect(ranked.map((p) => p.node_id)).toEqual(['out-fast', 'out-slow', 'in-fast']);
  });

  it('rankPeers: caps at PEER_RENDER_CAP', () => {
    const many = Array.from({ length: PEER_RENDER_CAP + 20 }, (_, i) =>
      peer({ node_id: `n${i}`, latency_ms: i }));
    expect(rankPeers(many)).toHaveLength(PEER_RENDER_CAP);
  });

  it('blockArrivalSchedule: empty peers → no entry, zero delay', () => {
    expect(blockArrivalSchedule([], 1)).toEqual({ entryId: null, localReceiveDelayS: 0 });
  });

  it('blockArrivalSchedule: entry = earliest arrival; local trails by the relay hop', () => {
    const peers = [
      peer({ node_id: 'far', latency_ms: 400 }),
      peer({ node_id: 'near', latency_ms: 0 }),
    ];
    const s = blockArrivalSchedule(peers, 5);
    expect(s.entryId).toBe('near'); // lowest latency → earliest arrival
    expect(s.localReceiveDelayS).toBeCloseTo(
      peerArrivalAge(peers[1], 5) + BLOCK_RELAY_HOP_S,
      9,
    );
  });

  it('blockArrivalSchedule: local is never first (delay > entry arrival)', () => {
    const peers = [
      peer({ node_id: 'A', latency_ms: 10 }),
      peer({ node_id: 'B', latency_ms: 250 }),
    ];
    const s = blockArrivalSchedule(peers, 9);
    const entryAge = Math.min(peerArrivalAge(peers[0], 9), peerArrivalAge(peers[1], 9));
    expect(s.localReceiveDelayS).toBeGreaterThan(entryAge);
  });

  it('blockArrivalSchedule: entry peer changes with the block nonce', () => {
    // Equal latency → per-block jitter decides the winner.
    const peers = [
      peer({ node_id: 'A', latency_ms: 100 }),
      peer({ node_id: 'B', latency_ms: 100 }),
    ];
    const winners = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => blockArrivalSchedule(peers, n).entryId),
    );
    expect(winners.size).toBeGreaterThan(1);
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
