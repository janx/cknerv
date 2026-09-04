import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
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
