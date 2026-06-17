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
  beamShapeJitter,
  courierLeg,
  easeInOutCubic,
  courierFlight,
  wakeSamples,
  blockArrivalSchedule,
  rankPeers,
  PEER_RENDER_CAP,
  BLOCK_ARRIVAL_BASE_S,
  BLOCK_ARRIVAL_SPREAD_S,
  BLOCK_ARRIVAL_JITTER_S,
  BLOCK_RELAY_HOP_S,
  PEER_INNER_RADIUS,
  PEER_OUTER_RADIUS,
} from '../src/derives/peers.derive';
import { BEAM_HOLD_DUR_S, BEAM_STRIKE_DUR_S } from '../src/ui/topologyConstants';
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

  it('beamShapeJitter: deterministic per (node, nonce)', () => {
    expect(beamShapeJitter('A', 3)).toEqual(beamShapeJitter('A', 3));
  });

  it('beamShapeJitter: multipliers within their amplitude bands', () => {
    for (const nonce of [0, 1, 7, 50]) {
      const j = beamShapeJitter('node-x', nonce);
      expect(j.growMul).toBeGreaterThanOrEqual(0.8);   expect(j.growMul).toBeLessThanOrEqual(1.2);
      expect(j.tailMul).toBeGreaterThanOrEqual(0.8);   expect(j.tailMul).toBeLessThanOrEqual(1.2);
      expect(j.flowMul).toBeGreaterThanOrEqual(0.75);  expect(j.flowMul).toBeLessThanOrEqual(1.25);
      expect(j.splashMul).toBeGreaterThanOrEqual(0.85); expect(j.splashMul).toBeLessThanOrEqual(1.15);
      expect(j.coreMul).toBeGreaterThanOrEqual(0.85);  expect(j.coreMul).toBeLessThanOrEqual(1.15);
    }
  });

  it('beamShapeJitter: tailMul keeps the retract window positive', () => {
    const j = beamShapeJitter('p', 11);
    expect(j.tailMul).toBeGreaterThan(0);
    // one factor drives both phases, so the retract window keeps its sign
    const hold = BEAM_HOLD_DUR_S * j.tailMul;
    const strike = BEAM_STRIKE_DUR_S * j.tailMul;
    expect(strike - hold).toBeCloseTo((BEAM_STRIKE_DUR_S - BEAM_HOLD_DUR_S) * j.tailMul, 9);
    expect(strike).toBeGreaterThan(hold);
  });

  it('beamShapeJitter: differs by node at the same block', () => {
    expect(beamShapeJitter('A', 5)).not.toEqual(beamShapeJitter('B', 5));
  });

  it('courierLeg: hidden before it departs', () => {
    expect(courierLeg(0.5, 1.0, 0.4)).toEqual({ visible: false, t: 0 });
  });

  it('courierLeg: t ramps 0→1 across the flight window', () => {
    expect(courierLeg(0.5, 1.0, 0.5)).toEqual({ visible: true, t: 0 }); // at the start node
    const mid = courierLeg(0.5, 1.0, 1.0);
    expect(mid.visible).toBe(true);
    expect(mid.t).toBeCloseTo(0.5, 6);
  });

  it('courierLeg: hidden once it lands; a zero-length leg never shows', () => {
    expect(courierLeg(0.5, 1.0, 1.5).visible).toBe(false); // landed
    expect(courierLeg(0.5, 0, 0.5).visible).toBe(false); // dur 0
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

  it('blockArrivalSchedule: empty peers → no entry, zero delay, no arrivals/senders', () => {
    expect(blockArrivalSchedule([], 1)).toEqual({
      entryId: null,
      localReceiveDelayS: 0,
      arrivals: {},
      senders: {},
    });
  });

  it('blockArrivalSchedule: senders form a broadcast cascade (source → null, rest earlier)', () => {
    const peers = [
      peer({ node_id: 'a', latency_ms: 20 }),
      peer({ node_id: 'b', latency_ms: 45 }),
      peer({ node_id: 'c', latency_ms: 80 }),
      peer({ node_id: 'd', latency_ms: 130 }),
      peer({ node_id: 'e', latency_ms: 200 }),
    ];
    const s = blockArrivalSchedule(peers, 3);
    // the entry (earliest arrival) is the source — no inbound courier
    expect(s.entryId).not.toBeNull();
    expect(s.senders[s.entryId as string]).toBeNull();
    // every other peer's courier comes from a node that received no later than it
    // (couriers flow forward through the arrival order)
    for (const id of Object.keys(s.arrivals)) {
      if (id === s.entryId) continue;
      const from = s.senders[id];
      expect(from).not.toBeNull();
      expect(s.arrivals[from as string]).toBeLessThanOrEqual(s.arrivals[id]);
    }
  });

  it('blockArrivalSchedule: arrivals cover every peer, low→high latency, within the window', () => {
    const peers = [
      peer({ node_id: 'near', latency_ms: 10 }),
      peer({ node_id: 'mid', latency_ms: 120 }),
      peer({ node_id: 'far', latency_ms: 380 }),
    ];
    const s = blockArrivalSchedule(peers, 5);
    expect(Object.keys(s.arrivals).sort()).toEqual(['far', 'mid', 'near']);
    // Well-separated latencies → arrival order tracks latency order (gaps >> jitter).
    expect(s.arrivals.near).toBeLessThan(s.arrivals.mid);
    expect(s.arrivals.mid).toBeLessThan(s.arrivals.far);
    const ceil = BLOCK_ARRIVAL_BASE_S + BLOCK_ARRIVAL_SPREAD_S + BLOCK_ARRIVAL_JITTER_S + 1e-9;
    for (const a of Object.values(s.arrivals)) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(ceil);
    }
  });

  it('blockArrivalSchedule: entry = earliest arrival; local trails it by the relay hop', () => {
    const peers = [
      peer({ node_id: 'far', latency_ms: 400 }),
      peer({ node_id: 'near', latency_ms: 0 }),
    ];
    const s = blockArrivalSchedule(peers, 5);
    expect(s.entryId).toBe('near'); // lowest latency → earliest arrival
    const minArrival = Math.min(...Object.values(s.arrivals));
    expect(s.arrivals.near).toBeCloseTo(minArrival, 9);
    expect(s.localReceiveDelayS).toBeCloseTo(minArrival + BLOCK_RELAY_HOP_S, 9);
  });

  it('blockArrivalSchedule: local is never first (delay > the earliest peer arrival)', () => {
    const peers = [
      peer({ node_id: 'A', latency_ms: 10 }),
      peer({ node_id: 'B', latency_ms: 250 }),
    ];
    const s = blockArrivalSchedule(peers, 9);
    const minArrival = Math.min(...Object.values(s.arrivals));
    expect(s.localReceiveDelayS).toBeGreaterThan(minArrival);
  });

  it('blockArrivalSchedule: clustered latencies still spread out (the fix — not simultaneous)', () => {
    // Worst case: 4 peers bunched at 30ms + 1 outlier at 50ms — pure latency-proportional
    // timing would pile the 4 together. Rank-even spacing must still spread them so the
    // sweep reads. (Old absolute model gave only ~0.1s of total spread here.)
    const peers = [
      peer({ node_id: 'a', latency_ms: 30 }),
      peer({ node_id: 'b', latency_ms: 30 }),
      peer({ node_id: 'c', latency_ms: 30 }),
      peer({ node_id: 'd', latency_ms: 30 }),
      peer({ node_id: 'e', latency_ms: 50 }),
    ];
    const ages = Object.values(blockArrivalSchedule(peers, 7).arrivals);
    const span = Math.max(...ages) - Math.min(...ages);
    expect(span).toBeGreaterThan(1.0);
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

  describe('easeInOutCubic', () => {
    it('pins the endpoints and the midpoint', () => {
      expect(easeInOutCubic(0)).toBe(0);
      expect(easeInOutCubic(1)).toBe(1);
      expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
    });
    it('is monotonic and eased (slow) at both ends', () => {
      let prev = -Infinity;
      for (let i = 0; i <= 20; i += 1) {
        const v = easeInOutCubic(i / 20);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
      expect(easeInOutCubic(0.1)).toBeLessThan(0.1);
      expect(easeInOutCubic(0.9)).toBeGreaterThan(0.9);
    });
  });

  describe('courierFlight', () => {
    const pos = new Map<string, [number, number, number]>([
      ['A', [10, 22, 0]],
      ['B', [20, 22, 5]],
      ['C', [30, 22, -5]],
    ]);
    const hub: [number, number, number] = [0, 22, 0];
    const schedule = {
      entryId: 'A',
      senders: { A: null, B: 'A', C: 'B' } as Record<string, string | null>,
      arrivals: { A: 0.12, B: 1.4, C: 1.9 } as Record<string, number>,
    };

    it('entry peer relays inward to the hub over BLOCK_RELAY_HOP_S', () => {
      const f = courierFlight('A', schedule, pos, hub)!;
      expect(f.from).toEqual([10, 22, 0]);
      expect(f.to).toEqual(hub);
      expect(f.startAge).toBe(0.12);
      expect(f.dur).toBe(BLOCK_RELAY_HOP_S);
    });

    it('a broadcast peer flies sender→self with a clamped broadcast hop', () => {
      const f = courierFlight('B', schedule, pos, hub)!;
      expect(f.from).toEqual([10, 22, 0]);
      expect(f.to).toEqual([20, 22, 5]);
      expect(f.startAge).toBe(Math.max(0, 1.4 - 1.0));
      expect(f.dur).toBeCloseTo(1.4 - f.startAge, 6);
    });

    it('returns null when the peer has no arrival or a position is missing', () => {
      expect(courierFlight('Z', schedule, pos, hub)).toBeNull();
      const onlyC = new Map<string, [number, number, number]>([['C', [1, 1, 1]]]);
      expect(courierFlight('C', schedule, onlyC, hub)).toBeNull(); // sender 'B' absent
    });
  });

  describe('wakeSamples', () => {
    const flight = { from: [0, 0, 0] as [number, number, number], to: [10, 0, 0] as [number, number, number], startAge: 0, dur: 1 };

    it('drops samples that predate launch (tk <= 0) and caps at `samples`', () => {
      const early = wakeSamples(flight, 0.05, { samples: 12, dtS: 0.04, gain: 1 });
      expect(early.length).toBeLessThan(12);
      const mid = wakeSamples(flight, 0.6, { samples: 12, dtS: 0.04, gain: 1 });
      expect(mid.length).toBeLessThanOrEqual(12);
      expect(mid.length).toBeGreaterThan(0);
    });

    it('alpha strictly decreases with distance behind the head', () => {
      const s = wakeSamples(flight, 0.6, { samples: 6, dtS: 0.04, gain: 1 });
      for (let i = 1; i < s.length; i += 1) {
        expect(s[i].alpha).toBeLessThan(s[i - 1].alpha);
      }
    });

    it('scales alpha linearly with gain', () => {
      const a1 = wakeSamples(flight, 0.6, { samples: 6, dtS: 0.04, gain: 1 });
      const a2 = wakeSamples(flight, 0.6, { samples: 6, dtS: 0.04, gain: 2 });
      expect(a2.length).toBe(a1.length);
      for (let i = 0; i < a1.length; i += 1) {
        expect(a2[i].alpha).toBeCloseTo(a1[i].alpha * 2, 6);
      }
    });

    it('returns an empty wake for a degenerate (dur <= 0) flight', () => {
      const degenerate = { from: [0, 0, 0] as [number, number, number], to: [10, 0, 0] as [number, number, number], startAge: 0, dur: 0 };
      expect(wakeSamples(degenerate, 0.6, { samples: 6, dtS: 0.04, gain: 1 })).toEqual([]);
    });

    it('samples lie on the eased path between from and to', () => {
      const s = wakeSamples(flight, 0.6, { samples: 4, dtS: 0.05, gain: 1 });
      for (const sm of s) {
        expect(sm.pos[0]).toBeGreaterThanOrEqual(0);
        expect(sm.pos[0]).toBeLessThanOrEqual(10);
        expect(sm.pos[1]).toBe(0);
        expect(sm.pos[2]).toBe(0);
      }
    });
  });
});
