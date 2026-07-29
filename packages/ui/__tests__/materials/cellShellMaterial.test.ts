import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeCellShellMaterial } from '../../src/materials/cellShellMaterial';

describe('makeCellShellMaterial', () => {
  it('returns a ShaderMaterial wired for additive line rendering', () => {
    const m = makeCellShellMaterial();
    expect(m).toBeInstanceOf(THREE.ShaderMaterial);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.blending).toBe(THREE.AdditiveBlending);
    expect(m.toneMapped).toBe(false);
  });

  it('exposes the expected uniforms', () => {
    const m = makeCellShellMaterial();
    expect(m.uniforms.uTime).toBeDefined();
    expect(m.uniforms.uBirthDurS).toBeDefined();
    expect(m.uniforms.uDeathDurS).toBeDefined();
    expect(m.uniforms.uRotRate).toBeDefined();
    expect(m.uniforms.uFlashPeak).toBeDefined();
    expect(m.uniforms.uOpacity).toBeDefined();
    expect(m.uniforms.uShockwaveAt).toBeUndefined();
    expect(m.uniforms.uShockwaveOriginXZ).toBeUndefined();
    // Color comes from per-vertex aColor now, not a uniform.
    expect(m.uniforms.uColor).toBeUndefined();
  });

  it('declares the per-vertex attributes consumed in the vertex shader', () => {
    const m = makeCellShellMaterial();
    expect(m.vertexShader).toContain('attribute vec3 aPos');
    expect(m.vertexShader).toContain('attribute vec3 aColor');
    expect(m.vertexShader).toContain('attribute float aBornAt');
    expect(m.vertexShader).toContain('attribute float aDeathAt');
    expect(m.vertexShader).toContain('attribute float aFlashAt');
    expect(m.vertexShader).toContain('attribute float aRotPhase');
    expect(m.vertexShader).toContain('attribute float aSize');
  });

  it('imports the shared envelope helpers', () => {
    const m = makeCellShellMaterial();
    expect(m.vertexShader).toContain('birthEase');
    expect(m.vertexShader).toContain('deathEase');
    expect(m.fragmentShader).toContain('flashEnv');
  });

  it('keeps the peer-network shockwave out of Cell shell geometry', () => {
    const m = makeCellShellMaterial();
    expect(m.vertexShader).not.toContain('vWorldXZ');
    expect(m.fragmentShader).not.toContain('shockwaveSignalAt');
    expect(m.fragmentShader).not.toContain('uShockwave');
  });
});
