import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { CELLS_Y, CHAIN_Y } from '../../src/layout';
import { FIELD_HALF_X, FIELD_HALF_Z } from '../../src/helix';
import {
  planDeliveries,
  PEER_INNER_RADIUS,
  PEER_OUTER_RADIUS,
} from '../../src/derives/peers.derive';
import {
  COLONY_ELLIPSE_X,
  COLONY_ELLIPSE_Z,
  localAnchor,
} from '../../src/derives/networkTopology.derive';
import { deliverySchema } from '../../src/tweaks/tweakSchema';
import { BEAM_GROW_DUR_S } from '../../src/ui/topologyConstants';
import {
  COURIER_END_EASE,
  FLAME_SPEED_STRETCH,
  courierEdgeEase,
  courierHopSpeed,
  courierPlumeLength,
  courierPlumeQuaternion,
  writeCourierMote,
  writeCourierPlume,
} from '../../src/components/courierGlyph';

const source = (file: string): string => readFileSync(
  resolve(process.cwd(), `src/components/${file}`),
  'utf8',
);

const UP = new THREE.Vector3(0, 1, 0);

function batch(capacity = 4): THREE.InstancedMesh {
  return new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial(),
    capacity,
  );
}

/** The instance matrix is a Float32Array: everything read back through it
 *  is compared at float32 precision (the pure-math tests above stay at 1e-9). */
const F32 = 1e-6;

function decompose(mesh: THREE.InstancedMesh, slot: number) {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(slot, m);
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  return { p, q, s };
}

describe('courierGlyph — the one courier vocabulary', () => {
  describe('courierEdgeEase', () => {
    it('is 0 at both ends of a hop and 1 across the middle, ramping over the end ease', () => {
      expect(courierEdgeEase(0)).toBe(0);
      expect(courierEdgeEase(1)).toBe(0);
      expect(courierEdgeEase(COURIER_END_EASE / 2)).toBeCloseTo(0.5, 12);
      expect(courierEdgeEase(1 - COURIER_END_EASE / 2)).toBeCloseTo(0.5, 12);
      expect(courierEdgeEase(COURIER_END_EASE)).toBeCloseTo(1, 12);
      expect(courierEdgeEase(0.5)).toBe(1);
      // A wider ease ramps slower.
      expect(courierEdgeEase(0.04, 0.2)).toBeCloseTo(0.2, 12);
    });
  });

  describe('courierHopSpeed', () => {
    it('is the analytic easeOutCubic velocity: 3× the mean speed off the launch, 0 at rest', () => {
      expect(courierHopSpeed(10, 2, 0)).toBeCloseTo(15, 12);
      expect(courierHopSpeed(10, 2, 0.5)).toBeCloseTo(3.75, 12);
      expect(courierHopSpeed(10, 2, 1)).toBe(0);
    });
    it('integrates back to the leg length over the hop', () => {
      const n = 20000;
      let dist = 0;
      for (let i = 0; i < n; i += 1) {
        dist += courierHopSpeed(10, 2, (i + 0.5) / n) * (2 / n);
      }
      expect(dist).toBeCloseTo(10, 4);
    });
  });

  describe('courierPlumeLength', () => {
    it('rests at minLen, stretches per world-unit/s, caps at maxLen', () => {
      expect(courierPlumeLength(0.7, 2.5, 0)).toBe(0.7);
      expect(courierPlumeLength(0.7, 2.5, 10)).toBeCloseTo(0.7 + 10 * FLAME_SPEED_STRETCH, 12);
      expect(courierPlumeLength(0.7, 2.5, 1e6)).toBe(2.5);
      expect(courierPlumeLength(0.7, 2.5, 10, 0.05)).toBeCloseTo(1.2, 12);
    });
  });

  describe('courierPlumeQuaternion', () => {
    it('puts local +Y along the flight and local +Z toward the camera, off-axis', () => {
      const dir = new THREE.Vector3(3, 0, 4); // any length: normalized inside
      const position = new THREE.Vector3(1, 2, 3);
      const camPos = new THREE.Vector3(1, 12, 3); // straight above the nozzle
      const q = courierPlumeQuaternion(new THREE.Quaternion(), dir, position, camPos);
      const y = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const z = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      expect(y.distanceTo(dir.clone().normalize())).toBeLessThan(1e-9);
      expect(z.distanceTo(UP)).toBeLessThan(1e-9);
      // The input vector is not mutated.
      expect(dir.toArray()).toEqual([3, 0, 4]);
    });

    it('with the camera dead-on a horizontal hop, falls back to world-up', () => {
      const dir = new THREE.Vector3(1, 0, 0);
      const position = new THREE.Vector3(0, 0, 0);
      const camPos = new THREE.Vector3(10, 0, 0);
      const q = courierPlumeQuaternion(new THREE.Quaternion(), dir, position, camPos);
      const y = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const x = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      expect(y.distanceTo(dir)).toBeLessThan(1e-9);
      // x = dir × up = (1,0,0) × (0,1,0) = (0,0,1)
      expect(x.distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-9);
      for (const c of q.toArray()) expect(Number.isFinite(c)).toBe(true);
    });

    it('with the camera dead-on the vertical hero hop, falls back to world-X (up would collapse)', () => {
      // The block's last hop climbs the axis CHAIN_Y → CELLS_Y (16 wu).
      const dir = new THREE.Vector3(0, 16, 0);
      const position = new THREE.Vector3(0, 22, 0);
      const camPos = new THREE.Vector3(0, 80, 0);
      const q = courierPlumeQuaternion(new THREE.Quaternion(), dir, position, camPos);
      const y = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const x = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      expect(y.distanceTo(UP)).toBeLessThan(1e-9);
      // x = dir × worldX = (0,1,0) × (1,0,0) = (0,0,−1)
      expect(x.distanceTo(new THREE.Vector3(0, 0, -1))).toBeLessThan(1e-9);
      for (const c of q.toArray()) expect(Number.isFinite(c)).toBe(true);
    });

    it('takes the world-X fallback for every near-vertical hop (|dir.y| ≥ 0.9)', () => {
      const dir = new THREE.Vector3(0.1, 1, 0).normalize(); // dir.y ≈ 0.995
      const position = new THREE.Vector3(2, 22, -3);
      const camPos = position.clone().addScaledVector(dir, 25); // on the axis
      const q = courierPlumeQuaternion(new THREE.Quaternion(), dir, position, camPos);
      const y = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      expect(y.distanceTo(dir)).toBeLessThan(1e-9);
      for (const c of q.toArray()) expect(Number.isFinite(c)).toBe(true);
      // Right-handed and orthonormal: x × y = z.
      const x = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const z = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      expect(x.clone().cross(y).distanceTo(z)).toBeLessThan(1e-9);
    });
  });

  describe('writers', () => {
    it('writeCourierMote composes position · camera quaternion · size×edge into the slot', () => {
      const mesh = batch();
      const camQuat = new THREE.Quaternion().setFromAxisAngle(UP, 0.7);
      writeCourierMote(mesh, 2, new THREE.Vector3(1, 2, 3), camQuat, 0.7, 0.5);
      const { p, q, s } = decompose(mesh, 2);
      expect(p.distanceTo(new THREE.Vector3(1, 2, 3))).toBeLessThan(F32);
      expect(s.distanceTo(new THREE.Vector3(0.35, 0.35, 0.35))).toBeLessThan(F32);
      expect(q.angleTo(camQuat)).toBeLessThan(F32);
      // Edge 0 → the mote is gone, not merely dim.
      writeCourierMote(mesh, 3, new THREE.Vector3(1, 2, 3), camQuat, 0.7, 0);
      expect(decompose(mesh, 3).s.length()).toBe(0);
    });

    it('writeCourierPlume scales width × (length × edge) on the flight basis at the nozzle', () => {
      const mesh = batch();
      const dir = new THREE.Vector3(0, 0, -1);
      const position = new THREE.Vector3(4, 5, 6);
      const camPos = new THREE.Vector3(4, 25, 6);
      writeCourierPlume(mesh, 1, position, dir, camPos, 0.7, 2.0, 0.5);
      const { p, q, s } = decompose(mesh, 1);
      expect(p.distanceTo(position)).toBeLessThan(F32);
      expect(s.distanceTo(new THREE.Vector3(0.7, 1.0, 1))).toBeLessThan(F32);
      const y = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      expect(y.distanceTo(dir)).toBeLessThan(F32);
      const expected = courierPlumeQuaternion(new THREE.Quaternion(), dir, position, camPos);
      expect(q.angleTo(expected)).toBeLessThan(F32);
    });
  });

  describe('one vocabulary, two layers (source pins)', () => {
    it('both layers call the helper and neither keeps a private billboard basis', () => {
      const courier = source('ColonyCourierLayer.tsx');
      const delivery = source('BlockDeliveryLayer.tsx');
      for (const layer of [courier, delivery]) {
        expect(layer).toContain("from './courierGlyph'");
        expect(layer).toContain('writeCourierMote(');
        expect(layer).toContain('writeCourierPlume(');
        expect(layer).toContain('courierEdgeEase(');
        expect(layer).toContain('courierHopSpeed(');
        expect(layer).toContain('courierPlumeLength(');
        // No private copy of the basis maths or of the helper's constants.
        expect(layer).not.toMatch(/makeBasis|crossVectors|setFromRotationMatrix/);
        expect(layer).not.toMatch(/COURIER_END_EASE\s*=|FLAME_SPEED_STRETCH\s*=/);
        expect(layer).not.toMatch(/3 \* \(1 - t\) \* \(1 - t\)/);
      }
      // The helper alone owns the basis and its vertical fallback.
      const helper = source('courierGlyph.ts');
      expect(helper).toContain('_x.crossVectors(_dir, Math.abs(_dir.y) < 0.9 ? _up : _worldX)');
      expect(helper).toContain('_basis.makeBasis(_x, _dir, _z)');
      expect(helper).toContain('_view.subVectors(camPos, position)');
      // Both hops are thrown the same way.
      expect(courier).toContain('const s = easeOutCubic(t)');
      expect(delivery).toContain('const progress = easeOutCubic(phase.t)');
    });
  });
});

// ——— ⟨F3 / D-12⟩ The lob has no beam left in it ————————————————————————
//
// The rejected form has a name in the record: 「外星激光捅进温暖的有机体」 — an
// alien laser stabbing into the warm organism. `BlockBeam` was deleted for it,
// and report D-12 found the last vestige still on master: during the lob each
// carrier rose from the peer plane to the tissue trailing a hard white tapered
// streak, 1.2–4 wu × 0.55 wu, an 8–27 px vertical bar ending in the tissue.
//
// B0 re-landed the last-hop rework, which replaces that glyph with the SAME
// courier the propagation tree is drawn with: a mote and a plume, thrown with
// easeOutCubic, in the block's carrier hue. This chapter is the verification —
// and it does not verify the obvious thing, because the obvious thing is not
// true. THE HERO'S LOB IS STILL VERTICAL: the local anchor stands under the
// canopy, so its landing is its own xz and its flight is 16 world units of
// pure rise. What makes that not a beam is arithmetic, and the arithmetic is
// what is pinned below.
describe('the lob has no beam left in it', () => {
  const delivery = source('BlockDeliveryLayer.tsx');
  const code = delivery.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('draws three carrier forms and no fourth, and none of them is a streak', () => {
    // The three batches the layer's own header names: motes, plumes, fronts.
    for (const batch of ['moteBatchRef', 'plumeBatchRef', 'waveBatchRef']) {
      expect(code, `${batch} left the delivery layer`).toContain(batch);
    }
    // …and the vestige by name. The header claims "No glyph, no streak, no
    // sear, nothing white"; a claim in a comment that the code contradicts is
    // worse than no claim, so the claim is read as CODE.
    for (const gone of ['streak', 'Streak', 'beam', 'Beam', 'sear', 'Sear', 'Glyph geometry']) {
      expect(code, `the delivery layer says ${gone} again`).not.toContain(gone);
    }
    // BEAM_GROW_DUR_S is the phase table's own name for the lob window and it
    // is the one survivor of the deleted beam — a DURATION, not a form.
    expect(delivery).toContain('LOB_DUR_S = BEAM_GROW_DUR_S');
  });

  it('every carrier is aimed by its flight or by the camera; the one fixed axis is FLAT', () => {
    // A beam is a form with an axis of its own. Here the mote faces the
    // camera, the plume follows `to − from`, and the ONE constant orientation
    // in the file lays the contact front flat IN the tissue plane.
    // The plume's axis, read as ONE span: the vector is built from the
    // delivery's own endpoints and handed straight to the writer. Asserting
    // the two halves separately would pass on a file that set a constant axis
    // and computed the endpoints somewhere else — the throw's own position
    // interpolation uses the same subtraction three lines up.
    expect(code, 'the plume no longer follows the flight').toMatch(
      /_flightDirection\.set\(\s*delivery\.to\[0\] - fromX,\s*delivery\.to\[1\] - fromY,\s*delivery\.to\[2\] - fromZ,\s*\);[\s\S]{0,400}?writeCourierPlume\([\s\S]{0,200}?_flightDirection,/,
    );
    expect(code).toContain('_cameraQuaternion');
    // Exactly one constant quaternion, and it maps the annulus's own normal
    // onto the world's up axis — which is a DISC lying in the tissue, the
    // opposite of a bar crossing it.
    expect(code.match(/new THREE\.Quaternion\(\)\.setFromUnitVectors/g)).toHaveLength(1);
    const flat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 1, 0),
    );
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(flat);
    expect(normal.y).toBeCloseTo(1, 12);
    expect(Math.hypot(normal.x, normal.z)).toBeCloseTo(0, 12);
  });

  it('the hero rises with no travel — and its trail cannot span the gap', () => {
    // The geometry, computed rather than asserted about. The local anchor
    // stands ~30 wu off the galaxy's axis, well inside the 60 × 54 footprint,
    // so its landing is its own xz: the hero's flight is pure rise.
    const anchor = localAnchor(0xc0ffee);
    const [hero] = planDeliveries(
      [anchor], 0.4, new Map(), {}, CELLS_Y,
      { halfX: FIELD_HALF_X, halfZ: FIELD_HALF_Z, rotationY: 0 },
    );
    const rise = hero.to[1] - hero.from[1];
    const travel = Math.hypot(hero.to[0] - hero.from[0], hero.to[2] - hero.from[2]);
    expect(rise).toBe(CELLS_Y - CHAIN_Y);
    expect(travel).toBeCloseTo(0, 9);

    // So the plume IS vertical for this one carrier, and the thing that keeps
    // it from being the rejected bar is that it is a STUB on a long rise: the
    // trail can never reach from one plane to the other, at any knob setting.
    expect(deliverySchema.plumeMaxLen.value * 4).toBeLessThanOrEqual(rise);
    expect(deliverySchema.plumeMaxLen.max).toBeLessThan(rise);
    // And it never even reaches that ceiling. `courierPlumeLength` is the
    // hop's analytic speed made visible, and a 16 wu rise over `LOB_DUR_S`
    // peaks at 48 wu/s, which the stretch turns into **1.86 wu** — an EIGHTH
    // of the rise, at the throw, falling to its 0.9 floor as the hop coasts to
    // rest. At the membrane the trail is shorter than the plume is WIDE: a
    // blob, which is the opposite of a bar.
    const at = (t: number) => courierPlumeLength(
      deliverySchema.plumeMinLen.value,
      deliverySchema.plumeMaxLen.value,
      courierHopSpeed(rise, BEAM_GROW_DUR_S, t),
    );
    expect(at(0)).toBeCloseTo(1.86, 6);
    expect(at(0) * 8).toBeLessThanOrEqual(rise);
    expect(at(0)).toBeLessThan(deliverySchema.plumeMaxLen.value);
    expect(at(1)).toBe(deliverySchema.plumeMinLen.value);
    expect(at(1)).toBeLessThan(deliverySchema.plumeWidth.value);
  });

  it('a MEASURED carrier lobs like the hero, and the stub arithmetic covers it \u27e8ruling 24\u27e9', () => {
    // This test used to read the other way, and the reversal is the point.
    // B1 had moved the belt to 66-86 OUTSIDE the canopy, so every measured
    // landing was clamped inward and every measured lob had travel across the
    // scene; the chapter leaned on that for the twelve carriers it does not
    // compute individually. Ruling 24 puts the belt back at 34-56 around the
    // local anchor — the peers belong inside the organism they serve — so most
    // of them land on their own xz again and lob straight up, exactly as the
    // hero does.
    //
    // That is not the defect D-12 reported. What D-12 measured was the old
    // `courierGlyph`'s BAR, and there is no glyph: the arithmetic one test up
    // is what makes a vertical lob harmless, and it is a property of the RISE
    // and the schema's own ceiling, not of where the carrier started. It
    // therefore covers every carrier in the layer, hero and peer alike, and it
    // is restated here so the claim is not left resting on a geometry that has
    // just been reverted.
    const anchor: [number, number, number] = [12, CHAIN_Y, -9];
    const peers = [30, 120, 210, 300].map((deg, i) => {
      const a = (deg * Math.PI) / 180;
      // The belt's own two radii, on the colony's ellipse, about the anchor.
      const r = i % 2 === 0 ? PEER_INNER_RADIUS : PEER_OUTER_RADIUS;
      return [
        anchor[0] + Math.cos(a) * r * COLONY_ELLIPSE_X,
        CHAIN_Y,
        anchor[2] + Math.sin(a) * r * COLONY_ELLIPSE_Z,
      ] as [number, number, number];
    });
    const pos = new Map(peers.map((p, i) => [`p${i}`, p] as const));
    const arrivals = Object.fromEntries(peers.map((_, i) => [`p${i}`, 0.2 * i]));
    const plan = planDeliveries(
      [], 0, pos, arrivals, CELLS_Y,
      { halfX: FIELD_HALF_X, halfZ: FIELD_HALF_Z, rotationY: 0 },
    );
    expect(plan).toHaveLength(4);

    const rise = CELLS_Y - CHAIN_Y;
    let clamped = 0;
    for (const d of plan) {
      const travel = Math.hypot(d.to[0] - d.from[0], d.to[2] - d.from[2]);
      if (travel > 2) clamped += 1;
      // Whatever the travel, the RISE is the same 16 world units and the trail
      // is a stub on it: the schema's own ceiling is under the rise, so no
      // knob setting can turn any of these into a bar crossing the planes.
      expect(rise).toBe(CELLS_Y - CHAIN_Y);
      expect(deliverySchema.plumeMaxLen.max).toBeLessThan(rise);
      expect(courierPlumeLength(
        deliverySchema.plumeMinLen.value,
        deliverySchema.plumeMaxLen.value,
        courierHopSpeed(rise, BEAM_GROW_DUR_S, 0),
      ) * 8).toBeLessThanOrEqual(rise);
    }
    // Some of them still travel and some do not, which is the honest shape of
    // a belt that stands inside the tissue on the tight axis and past it on
    // the wide one: 56 x 1.25 = 70 against a 60 rim, 56 x 0.85 = 47.6 under a
    // 54 one.
    expect(clamped).toBeGreaterThan(0);
    expect(clamped).toBeLessThan(plan.length);
    expect(PEER_OUTER_RADIUS * COLONY_ELLIPSE_X).toBeGreaterThan(FIELD_HALF_X);
    expect(PEER_OUTER_RADIUS * COLONY_ELLIPSE_Z).toBeLessThan(FIELD_HALF_Z);
  });
});
