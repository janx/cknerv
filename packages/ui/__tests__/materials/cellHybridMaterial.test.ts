import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeCellHybridMaterial } from '../../src/materials/cellHybridMaterial';

describe('makeCellHybridMaterial', () => {
  it('returns a ShaderMaterial with expected uniforms and blending', () => {
    const m = makeCellHybridMaterial();
    expect(m).toBeInstanceOf(THREE.ShaderMaterial);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.blending).toBe(THREE.AdditiveBlending);
    expect(m.toneMapped).toBe(false);

    // Plumbing uniforms
    expect(m.uniforms.uTime).toBeDefined();
    expect(m.uniforms.uBirthDurS).toBeDefined();
    expect(m.uniforms.uDeathDurS).toBeDefined();
    expect(m.uniforms.uViewportHeight).toBeDefined();

    // Discharge moved to cellFlareMaterial — the cell body no longer flares.
    expect(m.uniforms.uDischargeArms).toBeUndefined();

    // The block shockwave belongs to the actual cell body, not a separate
    // drifted halo Points layer beside the cell.
    expect(m.uniforms.uShockwaveAt).toBeDefined();
    expect(m.uniforms.uShockwaveOriginXZ).toBeDefined();
    expect(m.uniforms.uShockwaveSpeed).toBeDefined();
    expect(m.uniforms.uShockwaveDurS).toBeDefined();
    expect(m.uniforms.uShockwaveBandBase).toBeDefined();
    expect(m.uniforms.uShockwaveBandGrow).toBeDefined();
    expect(m.uniforms.uShockwaveColorBoost).toBeDefined();
    expect(m.uniforms.uShockwaveAlphaBoost).toBeDefined();
    expect(m.uniforms.uShockwaveSizeBoost).toBeDefined();
    expect(m.uniforms.uShockwaveTrailBoost).toBeDefined();
  });

  it('keeps cloud + hash11 but no discharge (moved to the flare layer)', () => {
    const m = makeCellHybridMaterial();
    expect(m.fragmentShader).toContain('vec4 cloud(');
    expect(m.fragmentShader).toContain('hash11');
    expect(m.fragmentShader).not.toContain('vec4 discharge(');
  });

  it('brightens and expands the anchored cell core as the block shockwave crosses it', () => {
    const m = makeCellHybridMaterial();

    expect(m.vertexShader).toContain('shockwaveAtVertex');
    expect(m.vertexShader).toContain('vShockwave');
    expect(m.vertexShader).toContain('uShockwaveSizeBoost');
    expect(m.vertexShader).toContain('(1.0 + vShockwave * uShockwaveSizeBoost)');
    expect(m.vertexShader).not.toContain('drift');
    expect(m.vertexShader).not.toContain('position + drift');

    expect(m.fragmentShader).toContain('vShockwave');
    expect(m.fragmentShader).toContain('uShockwaveColorBoost');
    expect(m.fragmentShader).toContain('uShockwaveAlphaBoost');
    expect(m.fragmentShader).toContain('uShockwaveTrailBoost');
  });

  it('uses mid-range core shockwave boosts (visible spreading front on sparse cells)', () => {
    const m = makeCellHybridMaterial();

    expect(m.uniforms.uShockwaveColorBoost.value).toBeCloseTo(9.0);
    expect(m.uniforms.uShockwaveAlphaBoost.value).toBeCloseTo(5.5);
    expect(m.uniforms.uShockwaveSizeBoost.value).toBeCloseTo(0.5);
    expect(m.uniforms.uShockwaveTrailBoost.value).toBeCloseTo(0.18);
  });
});
