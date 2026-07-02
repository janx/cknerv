import { describe, it, expect } from 'vitest';
import {
  latencyToRadius01,
  peerAngle,
  syncProximity,
  peerColorKind,
  peerChurnDiff,
  summarizeNetwork,
  peerCrystalSize,
  peerCrystalBrightness,
  easeOutCubic,
  easeInLob,
  planDeliveries,
  deliveryPhase,
  bolusIngest,
  nearestCellIds,
} from '../src/derives/peers.derive';
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
