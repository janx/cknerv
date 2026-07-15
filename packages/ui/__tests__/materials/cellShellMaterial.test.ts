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
    expect(m.uniforms.uShockwaveAt).toBeDefined();
    expect(m.uniforms.uShockwaveOriginXZ).toBeDefined();
    expect(m.uniforms.uShockwaveColor).toBeDefined();
    expect(m.uniforms.uShockwaveSpeed).toBeDefined();
    expect(m.uniforms.uShockwaveDurS).toBeDefined();
    expect(m.uniforms.uShockwaveBandBase).toBeDefined();
    expect(m.uniforms.uShockwaveBandGrow).toBeDefined();
    expect(m.uniforms.uShockwaveColorBoost).toBeDefined();
    expect(m.uniforms.uShockwaveAlphaBoost).toBeDefined();
    expect(m.uniforms.uShockwaveTrailBoost).toBeDefined();
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

  it('brightens existing shell geometry as the block shockwave crosses it', () => {
    const m = makeCellShellMaterial();
    expect(m.vertexShader).toContain('vWorldXZ');
    expect(m.fragmentShader).toContain('vec4 shockwave()');
    expect(m.fragmentShader).toContain('uShockwaveColor');
    expect(m.fragmentShader).toContain('waveColor');
    expect(m.fragmentShader).toContain('uShockwaveColorBoost');
    expect(m.fragmentShader).toContain('uShockwaveTrailBoost');
    expect(m.fragmentShader).toContain('trail');
  });
});
