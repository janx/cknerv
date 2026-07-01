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
  courierLeg,
  easeOutCubic,
  easeInLob,
  courierFlight,
  planDeliveries,
  deliveryPhase,
  bolusIngest,
  nearestCellIds,
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

  describe('easeOutCubic', () => {
    it('pins endpoints and is front-loaded (fast launch)', () => {
      expect(easeOutCubic(0)).toBe(0);
      expect(easeOutCubic(1)).toBe(1);
      expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 6); // 1 - 0.5^3
      expect(easeOutCubic(0.1)).toBeGreaterThan(0.25); // covers ground fast early
    });
    it('is monotonic and decelerating (slope shrinks toward 1)', () => {
      let prev = -Infinity;
      for (let i = 0; i <= 20; i += 1) {
        const v = easeOutCubic(i / 20);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
      expect(easeOutCubic(0.1) - easeOutCubic(0)).toBeGreaterThan(easeOutCubic(1) - easeOutCubic(0.9));
    });
  });

  describe('easeInLob', () => {
    it('pins endpoints and is back-loaded (accelerating launch)', () => {
      expect(easeInLob(0)).toBe(0);
      expect(easeInLob(1)).toBeCloseTo(1, 6);
      expect(easeInLob(0.5)).toBeCloseTo(0.2875, 6); // 0.15*0.5 + 0.85*0.25
      expect(easeInLob(0.5)).toBeLessThan(0.5); // behind a linear ramp at the midpoint
    });
    it('is monotonic and accelerating (slope grows toward 1)', () => {
      let prev = -Infinity;
      for (let i = 0; i <= 20; i += 1) {
        const v = easeInLob(i / 20);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
      expect(easeInLob(1) - easeInLob(0.9)).toBeGreaterThan(easeInLob(0.1) - easeInLob(0));
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

  describe('deliveryPhase', () => {
    const CFG = { chargeDur: 0.4, lobDur: 1.0, ingestDur: 0.3 };

    it('idle before the gather window (far-future firedAt stays hidden)', () => {
      expect(deliveryPhase(-0.5, CFG)).toEqual({ phase: 'idle', t: 0 });
    });

    it('gather ramps 0→1 across the pre-roll', () => {
      expect(deliveryPhase(-0.4, CFG).phase).toBe('gather');
      const g = deliveryPhase(-0.2, CFG);
      expect(g.phase).toBe('gather');
      expect(g.t).toBeCloseTo(0.5, 6);
    });

    it('lob ramps 0→1 across lobDur', () => {
      expect(deliveryPhase(0, CFG)).toEqual({ phase: 'lob', t: 0 });
      const l = deliveryPhase(0.5, CFG);
      expect(l.phase).toBe('lob');
      expect(l.t).toBeCloseTo(0.5, 6);
    });

    it('ingest starts when the lob lands and ramps 0→1', () => {
      expect(deliveryPhase(1.0, CFG)).toEqual({ phase: 'ingest', t: 0 });
      const i = deliveryPhase(1.15, CFG);
      expect(i.phase).toBe('ingest');
      expect(i.t).toBeCloseTo(0.5, 6);
    });

    it('done once ingest completes', () => {
      expect(deliveryPhase(1.3, CFG)).toEqual({ phase: 'done', t: 1 });
    });

    it('zero chargeDur: negative localAge is idle, lob starts at 0', () => {
      const c = { chargeDur: 0, lobDur: 1, ingestDur: 0.3 };
      expect(deliveryPhase(-0.001, c)).toEqual({ phase: 'idle', t: 0 });
      expect(deliveryPhase(0, c)).toEqual({ phase: 'lob', t: 0 });
    });
  });

  describe('bolusIngest', () => {
    const samples = Array.from({ length: 21 }, (_, i) => i / 20);

    it('body dissolves: scale & opacity start full and reach exactly 0', () => {
      expect(bolusIngest(0).bodyScale).toBeCloseTo(1, 6);
      expect(bolusIngest(0).bodyOpacity).toBeCloseTo(1, 6);
      expect(bolusIngest(1).bodyScale).toBe(0);
      expect(bolusIngest(1).bodyOpacity).toBe(0);
    });

    it('body scale & opacity are monotonically decreasing (no re-grow)', () => {
      for (let i = 1; i < samples.length; i += 1) {
        expect(bolusIngest(samples[i]).bodyScale).toBeLessThanOrEqual(
          bolusIngest(samples[i - 1]).bodyScale + 1e-9,
        );
        expect(bolusIngest(samples[i]).bodyOpacity).toBeLessThanOrEqual(
          bolusIngest(samples[i - 1]).bodyOpacity + 1e-9,
        );
      }
    });

    it('THE FIX: nothing visible remains at t=1, so the phase→done hard-hide is imperceptible', () => {
      const end = bolusIngest(1);
      expect(end.bodyScale * end.bodyOpacity).toBe(0);
      expect(end.flashOpacity).toBe(0);
    });

    it('inward pull draws toward the core: 0→1, monotonic, back-loaded (accelerating suck-in)', () => {
      expect(bolusIngest(0).pull).toBe(0);
      expect(bolusIngest(1).pull).toBeCloseTo(1, 6);
      expect(bolusIngest(0.1).pull).toBeLessThan(0.1); // behind a linear ramp — accelerates
      for (let i = 1; i < samples.length; i += 1) {
        expect(bolusIngest(samples[i]).pull).toBeGreaterThanOrEqual(
          bolusIngest(samples[i - 1]).pull - 1e-9,
        );
      }
    });

    it('flash is a bright impact that lingers into an amber tail (not the old ~2-frame pop)', () => {
      expect(bolusIngest(0).flashOpacity).toBeCloseTo(1, 6); // bright at the strike
      // spans the window: at 30% through, brighter than the old exp(-7·t)=0.122 blink
      expect(bolusIngest(0.3).flashOpacity).toBeGreaterThan(0.122);
      expect(bolusIngest(1).flashOpacity).toBe(0); // clean end, no leftover pop
    });

    it('colour resolves white-hot → her amber across the ingest', () => {
      expect(bolusIngest(0).colorT).toBe(0);
      expect(bolusIngest(1).colorT).toBeCloseTo(1, 6);
    });
  });

  describe('nearestCellIds', () => {
    const grid = [
      { id: 1, pos_seed: [0, 0, 0] as [number, number, number] },
      { id: 2, pos_seed: [10, 0, 0] as [number, number, number] },
      { id: 3, pos_seed: [0, 0, 10] as [number, number, number] },
      { id: 4, pos_seed: [10, 0, 10] as [number, number, number] },
      { id: 5, pos_seed: [30, 0, 30] as [number, number, number] },
    ];

    it('returns the k nearest cell ids, nearest first (no rotation)', () => {
      // to (9,0): id2 (10,0) d=1, then id1 (0,0) d=9, then id4 (10,10) d≈10.05
      expect(nearestCellIds([9, 0], 0, grid, 2)).toEqual([2, 1]);
    });

    it('picks by xz only (y in pos_seed is ignored)', () => {
      const cells = [
        { id: 1, pos_seed: [0, 999, 0] as [number, number, number] },
        { id: 2, pos_seed: [50, 0, 50] as [number, number, number] },
      ];
      expect(nearestCellIds([1, 1], 0, cells, 1)).toEqual([1]);
    });

    it('accounts for galaxy rotation (landing is world-xz; cells live in the rotating local frame)', () => {
      // cell 2 at local (10,0,0); with the group rotated +pi/2 its WORLD xz is (0,10).
      const only = [grid[1]];
      expect(nearestCellIds([0, 10], Math.PI / 2, only, 1)).toEqual([2]);
    });

    it('returns min(k, count) and never throws on empty', () => {
      expect(nearestCellIds([0, 0], 0, grid, 99)).toHaveLength(5);
      expect(nearestCellIds([0, 0], 0, [], 3)).toEqual([]);
      expect(nearestCellIds([0, 0], 0, grid, 0)).toEqual([]);
    });
  });

  describe('planDeliveries', () => {
    it('builds a hero delivery per local origin, rising to cellsY', () => {
      const d = planDeliveries([[0, 22, 0]], 0.7, new Map(), {}, 38);
      expect(d).toEqual([
        { key: 'local:0', from: [0, 22, 0], to: [0, 38, 0], startAge: 0.7, hero: true },
      ]);
    });

    it('builds a peer delivery per posById entry that has an arrival', () => {
      const pos = new Map<string, [number, number, number]>([['A', [10, 22, 5]]]);
      const d = planDeliveries([], 0, pos, { A: 1.4 }, 38);
      expect(d).toEqual([
        { key: 'peer:A', from: [10, 22, 5], to: [10, 38, 5], startAge: 1.4, hero: false },
      ]);
    });

    it('skips peers without an arrival', () => {
      const pos = new Map<string, [number, number, number]>([
        ['A', [1, 22, 1]],
        ['B', [2, 22, 2]],
      ]);
      const d = planDeliveries([], 0, pos, { A: 1.0 }, 38);
      expect(d.map((x) => x.key)).toEqual(['peer:A']);
    });
  });
});
