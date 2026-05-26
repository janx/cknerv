import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import {
  CRIMSON,
  LCL,
  CRIMSON_EDGE,
  LCL_EDGE,
  makeMembraneMaterial,
  makeEdgeMaterial,
} from '../../src/materials/cellLifeDetail3DMaterial';

describe('cellLifeDetail3D palette constants', () => {
  it('CRIMSON matches the topology fabric crimson', () => {
    expect(CRIMSON.r).toBeCloseTo(0.62, 5);
    expect(CRIMSON.g).toBeCloseTo(0.10, 5);
    expect(CRIMSON.b).toBeCloseTo(0.20, 5);
  });

  it('LCL matches the topology amber', () => {
    expect(LCL.r).toBeCloseTo(1.00, 5);
    expect(LCL.g).toBeCloseTo(0.55, 5);
    expect(LCL.b).toBeCloseTo(0.15, 5);
  });

  it('CRIMSON_EDGE lerps crimson toward white by 40%', () => {
    const expected = new THREE.Color(0.62, 0.10, 0.20)
      .lerp(new THREE.Color(1, 1, 1), 0.40);
    expect(CRIMSON_EDGE.r).toBeCloseTo(expected.r, 5);
    expect(CRIMSON_EDGE.g).toBeCloseTo(expected.g, 5);
    expect(CRIMSON_EDGE.b).toBeCloseTo(expected.b, 5);
  });

  it('LCL_EDGE lerps amber toward white by 30%', () => {
    const expected = new THREE.Color(1.00, 0.55, 0.15)
      .lerp(new THREE.Color(1, 1, 1), 0.30);
    expect(LCL_EDGE.r).toBeCloseTo(expected.r, 5);
    expect(LCL_EDGE.g).toBeCloseTo(expected.g, 5);
    expect(LCL_EDGE.b).toBeCloseTo(expected.b, 5);
  });
});

describe('makeMembraneMaterial', () => {
  it('returns a smooth-shaded MeshStandardMaterial with crimson tint', () => {
    const mat = makeMembraneMaterial();
    expect(mat).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(mat.roughness).toBeCloseTo(0.50, 5);
    expect(mat.opacity).toBeCloseTo(0.55, 5);
    expect(mat.emissiveIntensity).toBeCloseTo(0.95, 5);
    expect(mat.metalness).toBeCloseTo(0.0, 5);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.side).toBe(THREE.DoubleSide);
    expect(mat.color.r).toBeCloseTo(0.62, 5);
    // flatShading dropped — was producing per-face flicker that
    // compounded with the transmission speckle.
    expect(mat.flatShading).toBe(false);
    mat.dispose();
  });

  it('returns a fresh material instance each call (no shared state)', () => {
    const a = makeMembraneMaterial();
    const b = makeMembraneMaterial();
    expect(a).not.toBe(b);
    a.color.setRGB(0.1, 0.2, 0.3);
    expect(b.color.r).not.toBeCloseTo(0.1, 5);
    a.dispose();
    b.dispose();
  });
});

describe('makeEdgeMaterial', () => {
  it('returns a fat-line LineMaterial at 2 px width with the resolution copied through', () => {
    const resolution = new THREE.Vector2(680, 400);
    const mat = makeEdgeMaterial(resolution);
    expect(mat).toBeInstanceOf(LineMaterial);
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBeCloseTo(0.95, 5);
    expect(mat.linewidth).toBeCloseTo(2.0, 5);
    expect(mat.worldUnits).toBe(false);
    expect(mat.depthWrite).toBe(false);
    // LineMaterial's `resolution` setter copies into its own internal
    // Vector2 (it does not retain the caller's reference). We assert
    // the values match — the broadcast to every cell on viewport
    // resize is the responsibility of CellLifeDetail3D, not the
    // material factory.
    expect(mat.resolution.x).toBe(680);
    expect(mat.resolution.y).toBe(400);
    mat.dispose();
  });

  it('returns a fresh LineMaterial instance each call (no shared state)', () => {
    const resolution = new THREE.Vector2(680, 400);
    const a = makeEdgeMaterial(resolution);
    const b = makeEdgeMaterial(resolution);
    expect(a).not.toBe(b);
    a.color.setRGB(0.1, 0.2, 0.3);
    expect(b.color.r).not.toBeCloseTo(0.1, 5);
    a.dispose();
    b.dispose();
  });
});

