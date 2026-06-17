import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeCourierWakeMaterial } from '../../src/materials/courierWakeMaterial';

describe('makeCourierWakeMaterial', () => {
  it('returns an additive, depth-write-off ShaderMaterial', () => {
    const m = makeCourierWakeMaterial(new THREE.Color('#d8faff'), 1.6);
    expect(m).toBeInstanceOf(THREE.ShaderMaterial);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.blending).toBe(THREE.AdditiveBlending);
    expect(m.toneMapped).toBe(false);
  });

  it('exposes the size/color/viewport uniforms and a round-point fragment', () => {
    const m = makeCourierWakeMaterial(new THREE.Color('#d8faff'), 5);
    expect(m.uniforms.uColor).toBeDefined();
    expect(m.uniforms.uBaseSize.value).toBe(5);
    expect(m.uniforms.uViewportHeight).toBeDefined();
    expect(m.vertexShader).toContain('attribute float aAlpha;');
    expect(m.fragmentShader).toContain('gl_PointCoord');
  });
});
