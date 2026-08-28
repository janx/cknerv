import { describe, it, expect } from 'vitest';
import {
  latencyToRadius01,
  latencyPlacementStep,
  PEER_LATENCY_CAP_MS,
  PEER_INNER_RADIUS,
  PEER_OUTER_RADIUS,
  PEER_LATENCY_STEPS,
  peerAngle,
  syncProximity,
  peerColorKind,
  peerChurnDiff,
  summarizeNetwork,
  peerCrystalSize,
  peerCrystalBrightness,
  easeOutCubic,
  planDeliveries,
  deliveryPhase,
  deliveryScheduleHorizon,
  contactRelease,
  contactFrontState,
  contactFrontReachCeiling,
  smoothUnit,
  CONTACT_FRONT_START_RADIUS,
  CONTACT_FRONT_REACH_KNEE,
  CONTACT_FRONT_WIDTH_GROW_RATE,
  CONTACT_FRONT_WIDTH_RADIUS_CAP,
  buildCellNearestIndex,
  cellIdsWithinRadiusFromIndex,
  sharedCellNearestIndex,
  nearestCellIds,
  nearestCellIdsFromIndex,
  rotYLocalToWorldXZ,
  rotYWorldToLocalXZ,
  PEER_COLORS,
} from '../src/derives/peers.derive';
import { consensusRouteHopWorldPosition } from '../src/derives/consensusRouteCamera.derive';
import { deliverySchema } from '../src/tweaks/tweakSchema';
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

  it('latencyPlacementStep resolves a ping onto the annulus, no finer', () => {
    // The step exists so a memo signature over the peer list stops flipping on
    // ping jitter. Its size is the band's own reading resolution: one step is
    // (PEER_OUTER_RADIUS − PEER_INNER_RADIUS) / PEER_LATENCY_STEPS world units.
    const perStep = (PEER_OUTER_RADIUS - PEER_INNER_RADIUS) / PEER_LATENCY_STEPS;
    expect(perStep).toBeCloseTo(1.375, 6);
    expect(PEER_LATENCY_CAP_MS / PEER_LATENCY_STEPS).toBe(25);
    // jitter inside one step is one step…
    expect(latencyPlacementStep(140)).toBe(latencyPlacementStep(147));
    // …and a ping that genuinely moved is a different one.
    expect(latencyPlacementStep(140)).not.toBe(latencyPlacementStep(190));
    // the ends, and the unknown ping the annulus stands mid-ring.
    expect(latencyPlacementStep(0)).toBe(0);
    expect(latencyPlacementStep(PEER_LATENCY_CAP_MS)).toBe(PEER_LATENCY_STEPS);
    expect(latencyPlacementStep(100_000)).toBe(PEER_LATENCY_STEPS);
    expect(latencyPlacementStep(null)).toBe(PEER_LATENCY_STEPS / 2);
    expect(latencyPlacementStep(undefined)).toBe(latencyPlacementStep(null));
    expect(latencyPlacementStep(Number.NaN)).toBe(latencyPlacementStep(null));
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

  it('keeps the peer data plane inside the synthetic blue/ultraviolet family', () => {
    expect(PEER_COLORS.outbound[2]).toBeGreaterThan(PEER_COLORS.outbound[0]);
    expect(PEER_COLORS.inbound[2]).toBeGreaterThan(PEER_COLORS.inbound[0]);
    expect(PEER_COLORS.version[2]).toBeGreaterThan(PEER_COLORS.version[0]);
    expect(PEER_COLORS.outbound).not.toEqual(PEER_COLORS.inbound);
    expect(PEER_COLORS.version).not.toEqual(PEER_COLORS.outbound);
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

  describe('deliveryScheduleHorizon', () => {
    const CFG = { chargeDur: 0.4, lobDur: 1.0, ingestDur: 0.3 };
    const d = (startAge: number) => ({
      key: `k${startAge}`,
      from: [0, 0, 0] as [number, number, number],
      to: [0, 1, 0] as [number, number, number],
      startAge, hero: false,
    });

    it('is the last start plus lob+ingest — the exact age deliveryPhase goes done', () => {
      const deliveries = [d(0), d(0.8), d(0.25)];
      const horizon = deliveryScheduleHorizon(deliveries, CFG);
      expect(horizon).toBeCloseTo(0.8 + 1.0 + 0.3, 6);
      // Just before the horizon the latest delivery is still rendering…
      expect(deliveryPhase(horizon - 0.001 - 0.8, CFG).phase).toBe('ingest');
      // …and at the horizon every delivery is done.
      for (const dv of deliveries) {
        expect(deliveryPhase(horizon - dv.startAge, CFG).phase).toBe('done');
      }
    });

    it('empty plan retires immediately', () => {
      expect(deliveryScheduleHorizon([], CFG)).toBe(0);
    });
  });

  describe('contactRelease', () => {
    const samples = Array.from({ length: 21 }, (_, i) => i / 20);

    it('is only the front: a strength and a colour arc, nothing else left to release', () => {
      // The mote is absorbed by the courier's own end ease before contact, so
      // the envelope has no glyph, core or inhale fields left to reach zero.
      expect(Object.keys(contactRelease(0.5)).sort()).toEqual(['colorT', 'frontOpacity']);
    });

    it('THE INVARIANT: nothing visible remains at t=1, so the phase→done hard-hide is imperceptible', () => {
      const end = contactRelease(1);
      expect(end.frontOpacity).toBe(0);
      expect(end.colorT).toBeCloseTo(1, 6);
    });

    it('the front grows out of the absorbed mote rather than switching on beside it', () => {
      expect(contactRelease(0).frontOpacity).toBe(0);
      expect(contactRelease(0.05).frontOpacity).toBeGreaterThan(0.9);
      expect(contactRelease(1).frontOpacity).toBe(0);
    });

    it('decays linearly past the onset — the renderer\'s 1/r falloff owns the rest', () => {
      for (const u of samples) {
        if (u < 0.05) continue;
        expect(contactRelease(u).frontOpacity).toBeCloseTo(1 - u, 12);
      }
      for (let i = 1; i < samples.length; i += 1) {
        if (samples[i] <= 0.05) continue;
        expect(contactRelease(samples[i]).frontOpacity).toBeLessThan(
          contactRelease(samples[i - 1]).frontOpacity,
        );
      }
    });

    it('colour resolves carrier hue → the Cell field\'s own tissue across contact', () => {
      expect(contactRelease(0).colorT).toBe(0);
      expect(contactRelease(1).colorT).toBeCloseTo(1, 6);
      for (let i = 1; i < samples.length; i += 1) {
        expect(contactRelease(samples[i]).colorT).toBeGreaterThan(
          contactRelease(samples[i - 1]).colorT,
        );
      }
    });

    it('clamps t outside [0, 1]', () => {
      expect(contactRelease(-1)).toEqual(contactRelease(0));
      expect(contactRelease(2)).toEqual(contactRelease(1));
    });
  });

  describe('contactFrontState', () => {
    // Shipped defaults: speed 4.5 (= SHOCKWAVE_SPEED / CONTACT_WAVE_SCALE),
    // window 1.2 s — the numbers the completion contract must hold at.
    const live = { speed: 4.5, width: 0.07, falloffPower: 0.5, windowS: 1.2 };

    it('expands linearly from the start radius at the shared field speed', () => {
      expect(contactFrontState(0, 4.25, live).crestRadius)
        .toBeCloseTo(CONTACT_FRONT_START_RADIUS, 12);
      expect(contactFrontState(1, 4.25, live).crestRadius)
        .toBeCloseTo(CONTACT_FRONT_START_RADIUS + 4.5, 12);
      let prev = -Infinity;
      for (let i = 0; i <= 24; i += 1) {
        const r = contactFrontState((i / 24) * 1.2, 4.25, live).crestRadius;
        expect(r).toBeGreaterThan(prev);
        prev = r;
      }
    });

    it('reach is extinction, not a stop: full strength to the knee, zero at reach, radius never clamped', () => {
      const reach = 4.25;
      const kneeAge =
        (reach * CONTACT_FRONT_REACH_KNEE - CONTACT_FRONT_START_RADIUS) / live.speed;
      const extinctionAge = (reach - CONTACT_FRONT_START_RADIUS) / live.speed;
      expect(contactFrontState(kneeAge - 0.01, reach, live).reachFade).toBe(1);
      expect(contactFrontState(extinctionAge, reach, live).reachFade).toBeLessThan(1e-9);
      let prevFade = 1 + 1e-9;
      for (let i = 0; i <= 10; i += 1) {
        const age = kneeAge + (extinctionAge - kneeAge) * (i / 10);
        const s = contactFrontState(age, reach, live);
        expect(s.reachFade).toBeLessThanOrEqual(prevFade);
        // …while the radius keeps the shared speed straight through the fade.
        expect(s.crestRadius).toBeCloseTo(CONTACT_FRONT_START_RADIUS + live.speed * age, 12);
        prevFade = s.reachFade;
      }
      expect(contactFrontState(live.windowS, reach, live).reachFade).toBe(0);
    });

    it('clamps reach to what the window can complete — no front outlives its own extinction', () => {
      // The shipped hero reach (6.5) exceeds the shipped ceiling
      // (0.3 + 4.5×1.2 = 5.7): without the clamp, the time envelope killed the
      // hero front mid-knee (reachFade still ≈0.41 at the window's end) and
      // every knob value past the ceiling was a silent dead zone.
      expect(contactFrontReachCeiling(live.speed, live.windowS)).toBeCloseTo(5.7, 9);
      expect(contactFrontState(live.windowS, 6.5, live).reachFade).toBeLessThan(1e-9);
      expect(contactFrontState(live.windowS, 30, live).reachFade).toBeLessThan(1e-9);
      // A completable reach is untouched by the clamp.
      expect(contactFrontState(0.5, 4.25, live).reachFade)
        .toBe(contactFrontState(0.5, 4.25, { ...live, windowS: 99 }).reachFade);
    });

    it('ships completable: every default reach extinguishes inside the default window', () => {
      const shipped = {
        speed: deliverySchema.waveSpeed.value,
        width: deliverySchema.waveWidth.value,
        falloffPower: deliverySchema.waveFalloff.value,
        windowS: deliverySchema.ingestDur.value,
      };
      for (const reach of [
        deliverySchema.waveReachHero.value,
        deliverySchema.waveReachPeer.value,
      ]) {
        expect(contactFrontState(shipped.windowS, reach, shipped).reachFade)
          .toBeLessThan(1e-9);
      }
    });

    it('widens the crest as a RATE on the already-scale-divided width, under the radius cap', () => {
      // Young front: the cap owns the width (a release that is mostly crest
      // reads as a soft doughnut, not a thin ring leaving).
      expect(contactFrontState(0, 4.25, live).crestHalfWidth).toBeCloseTo(
        CONTACT_FRONT_START_RADIUS * CONTACT_FRONT_WIDTH_RADIUS_CAP,
        12,
      );
      // Mature front: ×(1 + 0.45·t) — the same ×1.54-over-a-window widening
      // the peer-plane wave carries. A scale-divided "rate" flattened this
      // toward ×1, the rigid-decal failure the constant exists to prevent.
      expect(contactFrontState(1.2, 4.25, live).crestHalfWidth)
        .toBeCloseTo(0.07 * (1 + 0.45 * 1.2), 12);
      expect(CONTACT_FRONT_WIDTH_GROW_RATE).toBe(0.45);
    });

    it('dims as 1/r from the falloff reference', () => {
      expect(contactFrontState(0, 4.25, { ...live, falloffPower: 0 }).falloff).toBe(1);
      let prev = Infinity;
      for (let i = 0; i <= 10; i += 1) {
        const f = contactFrontState((i / 10) * 1.2, 4.25, live).falloff;
        expect(f).toBeLessThan(prev);
        expect(f).toBeGreaterThan(0);
        prev = f;
      }
    });
  });

  describe('smoothUnit', () => {
    it('clamps outside [0,1] and eases inside — one easing for both ends of a front', () => {
      expect(smoothUnit(-5)).toBe(0);
      expect(smoothUnit(0)).toBe(0);
      expect(smoothUnit(0.5)).toBeCloseTo(0.5, 12);
      expect(smoothUnit(1)).toBe(1);
      expect(smoothUnit(7)).toBe(1);
    });
  });

  describe('rotYLocalToWorldXZ / rotYWorldToLocalXZ', () => {
    it('matches the three.js rotation.y map (local +x → world −z at +90°)', () => {
      // Pinned empirically against THREE.Group.matrixWorld, and against
      // consensusRouteHopWorldPosition, the live-verified twin of this map.
      const [wx, wz] = rotYLocalToWorldXZ(10, 0, Math.PI / 2);
      expect(wx).toBeCloseTo(0, 9);
      expect(wz).toBeCloseTo(-10, 9);
      const hop = consensusRouteHopWorldPosition([10, 0, 0], Math.PI / 2);
      expect(wx).toBeCloseTo(hop[0], 12);
      expect(wz).toBeCloseTo(hop[2], 12);
    });

    it('inverts exactly (round-trip is identity at any angle)', () => {
      for (const rotation of [0, 0.3, 1.7, -2.4, 9.1]) {
        const [wx, wz] = rotYLocalToWorldXZ(12.5, -7.25, rotation);
        const [lx, lz] = rotYWorldToLocalXZ(wx, wz, rotation);
        expect(lx).toBeCloseTo(12.5, 9);
        expect(lz).toBeCloseTo(-7.25, 9);
      }
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
      // cell 2 at local (10,0,0); three's rotation.y=+pi/2 carries local +x to
      // world −z, so its WORLD xz is (0,−10). (The old pin asserted (0,10) —
      // the inverse applied with the sign flipped, drifting 2θ from the frame.)
      const only = [grid[1]];
      expect(nearestCellIds([0, -10], Math.PI / 2, only, 1)).toEqual([2]);
    });

    it('agrees with the live-verified local→world map (round-trips through consensusRouteHopWorldPosition)', () => {
      // consensusRouteHopWorldPosition is pinned to a real THREE.Group's
      // matrixWorld by the route camera's live verification; the nearest-cell
      // inverse must find exactly the cell whose world footprint it names.
      for (const rotation of [0.3, 1.2, 2.5, -0.7]) {
        for (const cell of grid) {
          const world = consensusRouteHopWorldPosition(cell.pos_seed, rotation);
          expect(nearestCellIds([world[0], world[2]], rotation, grid, 1))
            .toEqual([cell.id]);
        }
      }
    });

    it('returns min(k, count) and never throws on empty', () => {
      expect(nearestCellIds([0, 0], 0, grid, 99)).toHaveLength(5);
      expect(nearestCellIds([0, 0], 0, [], 3)).toEqual([]);
      expect(nearestCellIds([0, 0], 0, grid, 0)).toEqual([]);
    });

    it('preserves iterable order for equal-distance candidates', () => {
      const tied = [
        { id: 7, pos_seed: [-1, 0, 0] as [number, number, number] },
        { id: 8, pos_seed: [1, 0, 0] as [number, number, number] },
        { id: 9, pos_seed: [0, 0, -1] as [number, number, number] },
      ];
      expect(nearestCellIds([0, 0], 0, tied, 2)).toEqual([7, 8]);
    });

    it('matches a stable full-sort reference while keeping only a bounded top-k', () => {
      const many = Array.from({ length: 2000 }, (_, index) => ({
        id: index,
        pos_seed: [
          ((index * 37) % 211) - 105,
          index % 7,
          ((index * 61) % 223) - 111,
        ] as [number, number, number],
      }));
      const landing: [number, number] = [13, -17];
      const expected = many
        .map((cell, order) => {
          const dx = cell.pos_seed[0] - landing[0];
          const dz = cell.pos_seed[2] - landing[1];
          return { id: cell.id, d2: dx * dx + dz * dz, order };
        })
        .sort((a, b) => a.d2 - b.d2 || a.order - b.order)
        .slice(0, 9)
        .map(({ id }) => id);

      expect(nearestCellIds(landing, 0, many, 9)).toEqual(expected);
      expect(nearestCellIds(landing, 0, many, Number.NaN)).toEqual([]);
      expect(nearestCellIds(landing, 0, many, 0.9)).toEqual([]);
    });

    it('reuses one exact spatial index across delivery landings', () => {
      const index = buildCellNearestIndex(grid, 4);
      expect(nearestCellIdsFromIndex([9, 0], 0, index, 3))
        .toEqual(nearestCellIds([9, 0], 0, grid, 3));
      expect(nearestCellIdsFromIndex([0, 10], Math.PI / 2, index, 4))
        .toEqual(nearestCellIds([0, 10], Math.PI / 2, grid, 4));
      expect(nearestCellIdsFromIndex([500, -300], 0, index, 2))
        .toEqual(nearestCellIds([500, -300], 0, grid, 2));
    });

    it('matches a full-sort reference across rotated spatial buckets', () => {
      const many = Array.from({ length: 800 }, (_, order) => ({
        id: order + 100,
        pos_seed: [
          ((order * 47) % 251) - 125,
          0,
          ((order * 73) % 263) - 131,
        ] as [number, number, number],
      }));
      const index = buildCellNearestIndex(many, 6);
      for (let query = 0; query < 24; query += 1) {
        const landing: [number, number] = [
          ((query * 31) % 181) - 90,
          ((query * 43) % 193) - 96,
        ];
        const rotation = (query - 12) * 0.11;
        const [lx, lz] = rotYWorldToLocalXZ(landing[0], landing[1], rotation);
        const expected = many
          .map((cell, order) => {
            const dx = cell.pos_seed[0] - lx;
            const dz = cell.pos_seed[2] - lz;
            return { id: cell.id, d2: dx * dx + dz * dz, order };
          })
          .sort((a, b) => a.d2 - b.d2 || a.order - b.order)
          .slice(0, 7)
          .map(({ id }) => id);
        expect(nearestCellIdsFromIndex(landing, rotation, index, 7))
          .toEqual(expected);
      }
    });
  });

  describe('planDeliveries', () => {
    // The real tissue footprint (helix.ts) at rest. Individual tests rotate it
    // where the world→local projection is the point.
    const FIELD = { halfX: 60, halfZ: 54, rotationY: 0 };

    it('builds a hero delivery per local origin, rising to cellsY', () => {
      const d = planDeliveries([[0, 22, 0]], 0.7, new Map(), {}, 38, FIELD);
      expect(d).toEqual([
        { key: 'local:0', from: [0, 22, 0], to: [0, 38, 0], startAge: 0.7, hero: true },
      ]);
    });

    it('builds a peer delivery per posById entry that has an arrival', () => {
      const pos = new Map<string, [number, number, number]>([['A', [10, 22, 5]]]);
      const d = planDeliveries([], 0, pos, { A: 1.4 }, 38, FIELD);
      expect(d).toEqual([
        { key: 'peer:A', from: [10, 22, 5], to: [10, 38, 5], startAge: 1.4, hero: false },
      ]);
    });

    it('skips peers without an arrival', () => {
      const pos = new Map<string, [number, number, number]>([
        ['A', [1, 22, 1]],
        ['B', [2, 22, 2]],
      ]);
      const d = planDeliveries([], 0, pos, { A: 1.0 }, 38, FIELD);
      expect(d.map((x) => x.key)).toEqual(['peer:A']);
    });

    it('pulls an over-rim landing radially onto the tissue, keeping the origin honest', () => {
      // Chain ellipse ×1.25 puts workers out to |x|≈70 against a 60-half-x
      // tissue: a scale-divided front released at x=70 would live entirely
      // off the field. The landing comes back to the rim; `from` never moves.
      const pos = new Map<string, [number, number, number]>([['far', [70, 22, 0]]]);
      const d = planDeliveries([], 0, pos, { far: 0.2 }, 38, FIELD);
      expect(d[0].from).toEqual([70, 22, 0]);
      expect(d[0].to[0]).toBeCloseTo(60, 6);
      expect(d[0].to[1]).toBe(38);
      expect(d[0].to[2]).toBeCloseTo(0, 6);
    });

    it('clamps on the ellipse, not a circle: z runs out at 54, and off-axis scales radially', () => {
      const pos = new Map<string, [number, number, number]>([
        ['zed', [0, 22, 58]],
        ['diag', [60, 22, 54]],
      ]);
      const d = planDeliveries([], 0, pos, { zed: 0, diag: 0 }, 38, FIELD);
      expect(d[0].to[0]).toBeCloseTo(0, 6);
      expect(d[0].to[2]).toBeCloseTo(54, 6);
      // (60,54) sits at norm √2: both components shrink by the same factor.
      expect(d[1].to[0]).toBeCloseTo(60 / Math.SQRT2, 6);
      expect(d[1].to[2]).toBeCloseTo(54 / Math.SQRT2, 6);
    });

    it('projects through the galaxy rotation before judging the rim', () => {
      // World z=58 overruns the resting footprint (half-z 54), but once the
      // galaxy has turned 90° that direction lies along the LONG axis (60):
      // the same worker is on tissue and must land at its own xz.
      const pos = new Map<string, [number, number, number]>([['A', [0, 22, 58]]]);
      const resting = planDeliveries([], 0, pos, { A: 0 }, 38, FIELD);
      expect(Math.hypot(resting[0].to[0], resting[0].to[2])).toBeLessThan(58);
      const turned = planDeliveries([], 0, pos, { A: 0 }, 38, { ...FIELD, rotationY: Math.PI / 2 });
      expect(turned[0].to[0]).toBeCloseTo(0, 6);
      expect(turned[0].to[2]).toBeCloseTo(58, 6);
    });

    it('judges the rim in the frame the tissue actually turned to (sign-sensitive)', () => {
      // A ±90° turn of an ellipse is the same footprint either way, so the
      // test above cannot catch an inverse applied with the wrong sign. At
      // rotationY=0.4 it can: this worker stands exactly on the turned LONG
      // axis at norm 0.99 — on tissue, so the landing passes through
      // untouched. The flipped inverse reads it at norm 1.05 and clamps.
      const field = { ...FIELD, rotationY: 0.4 };
      const [wx, wz] = rotYLocalToWorldXZ(59.5, 0, 0.4);
      const pos = new Map<string, [number, number, number]>([['axis', [wx, 22, wz]]]);
      const d = planDeliveries([], 0, pos, { axis: 0 }, 38, field);
      expect(d[0].to[0]).toBeCloseTo(wx, 9);
      expect(d[0].to[2]).toBeCloseTo(wz, 9);
    });

    it('clamps the hero exactly like a peer (multi-node anchors can sit past the rim)', () => {
      const d = planDeliveries([[75, 22, 0]], 0.5, new Map(), {}, 38, FIELD);
      expect(d[0].hero).toBe(true);
      expect(d[0].from).toEqual([75, 22, 0]);
      expect(d[0].to[0]).toBeCloseTo(60, 6);
    });

    it('lands in world while the launch stays colony-frame (counter-rotating colony)', () => {
      // Peer standing at colony-frame (0,·,58): with the colony turned +90°
      // its WORLD xz is (58,0) — on the long axis, inside the rim, so the
      // landing is that world point untouched. `from` keeps the topology's
      // colony-frame coordinates: the renderer rotates it live each frame.
      const pos = new Map<string, [number, number, number]>([['A', [0, 22, 58]]]);
      const d = planDeliveries([], 0, pos, { A: 0 }, 38, FIELD, Math.PI / 2);
      expect(d[0].from).toEqual([0, 22, 58]);
      expect(d[0].to[0]).toBeCloseTo(58, 6);
      expect(d[0].to[1]).toBe(38);
      expect(d[0].to[2]).toBeCloseTo(0, 6);
      // Omitting the colony rotation is the resting colony, byte-identical
      // to the pre-rotation plan (that same worker overruns half-z 54).
      const resting = planDeliveries([], 0, pos, { A: 0 }, 38, FIELD);
      expect(resting[0].to[2]).toBeCloseTo(54, 6);
    });
  });

  describe('cellIdsWithinRadiusFromIndex', () => {
    // Deterministic pseudo-random scatter, including exact-boundary points.
    function scatter(count: number): Array<{ id: number; pos_seed: [number, number, number] }> {
      const cells: Array<{ id: number; pos_seed: [number, number, number] }> = [];
      let s = 42;
      const rnd = () => {
        s = (s * 1103515245 + 12345) >>> 0;
        return (s / 4294967296) * 60 - 30;
      };
      for (let i = 0; i < count; i++) {
        cells.push({ id: 1000 + i, pos_seed: [rnd(), 0, rnd()] });
      }
      cells.push({ id: 1, pos_seed: [14, 0, 0] });  // exactly on the boundary
      cells.push({ id: 2, pos_seed: [14.001, 0, 0] }); // just outside
      return cells;
    }

    function bruteForce(
      cells: Array<{ id: number; pos_seed: [number, number, number] }>,
      lx: number,
      lz: number,
      radius: number,
    ) {
      const radiusSq = radius * radius;
      const out: Array<{ id: number; dist: number }> = [];
      for (const cell of cells) {
        const dx = cell.pos_seed[0] - lx;
        const dz = cell.pos_seed[2] - lz;
        const d2 = dx * dx + dz * dz;
        if (d2 > radiusSq) continue;
        out.push({ id: cell.id, dist: Math.sqrt(d2) });
      }
      return out;
    }

    it('returns the exact set, order, and distances of the full walk', () => {
      const cells = scatter(400);
      const index = buildCellNearestIndex(cells);
      for (const [lx, lz, radius] of [
        [0, 0, 14], [10, -8, 14], [-25, 25, 6], [0, 0, 0.5], [29, 29, 14],
      ] as const) {
        expect(cellIdsWithinRadiusFromIndex(lx, lz, radius, index))
          .toEqual(bruteForce(cells, lx, lz, radius));
      }
    });

    it('includes the exact-radius boundary and excludes just-outside', () => {
      const cells = scatter(0);
      const index = buildCellNearestIndex(cells);
      const ids = cellIdsWithinRadiusFromIndex(0, 0, 14, index).map((h) => h.id);
      expect(ids).toContain(1);
      expect(ids).not.toContain(2);
    });

    it('empty index and non-positive radius return nothing', () => {
      expect(cellIdsWithinRadiusFromIndex(0, 0, 5, buildCellNearestIndex([]))).toEqual([]);
      const index = buildCellNearestIndex(scatter(10));
      expect(cellIdsWithinRadiusFromIndex(0, 0, 0, index)).toEqual([]);
    });
  });

  describe('sharedCellNearestIndex', () => {
    it('reuses one build per token and rebuilds on a token change', () => {
      const cellsA = [{ id: 1, pos_seed: [0, 0, 0] as [number, number, number] }];
      const cellsB = [
        { id: 1, pos_seed: [0, 0, 0] as [number, number, number] },
        { id: 2, pos_seed: [3, 0, 3] as [number, number, number] },
      ];
      const first = sharedCellNearestIndex('tok-a', cellsA);
      // Same token: the iterable is not even consulted again.
      expect(sharedCellNearestIndex('tok-a', cellsB)).toBe(first);
      const second = sharedCellNearestIndex('tok-b', cellsB);
      expect(second).not.toBe(first);
      expect(second.count).toBe(2);
    });
  });
});
