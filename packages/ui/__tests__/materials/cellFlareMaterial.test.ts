import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeCellFlareMaterial } from '../../src/materials/cellFlareMaterial';

describe('makeCellFlareMaterial', () => {
  it('returns an additive ShaderMaterial with the flash uniforms', () => {
    const m = makeCellFlareMaterial();
    expect(m).toBeInstanceOf(THREE.ShaderMaterial);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.blending).toBe(THREE.AdditiveBlending);
    expect(m.toneMapped).toBe(false);
    expect(m.uniforms.uTime).toBeDefined();
    expect(m.uniforms.uBirthDurS).toBeDefined();
    expect(m.uniforms.uDeathDurS).toBeDefined();
    expect(m.uniforms.uViewportHeight).toBeDefined();
    expect(m.uniforms.uDischargeArms).toBeDefined();
  });

  it('renders an A protocol write and reads the shared aFlashAt attribute', () => {
    const m = makeCellFlareMaterial();
    expect(m.fragmentShader).toContain('vec4 protocolWrite(');
    expect(m.fragmentShader).toContain('segmentDistance');
    expect(m.fragmentShader).toContain('outerGate');
    expect(m.fragmentShader).toContain('innerGate');
    expect(m.fragmentShader).toContain('diamondRadius');
    expect(m.fragmentShader).toContain('vec3 amber');
    expect(m.fragmentShader).toContain('vec3 rose');
    expect(m.fragmentShader).toContain('vec3 violet');
    expect(m.fragmentShader).not.toContain('vec3 cyan');
    expect(m.fragmentShader).not.toContain('vec4 discharge(');
    expect(m.fragmentShader).toContain('flashEnv');
    expect(m.vertexShader).toContain('attribute float aFlashAt;');
    expect(m.vertexShader).toContain('vFlashAge');
  });

  it('carries no cloud or block shockwave (those stay on the cell body)', () => {
    const m = makeCellFlareMaterial();
    expect(m.fragmentShader).not.toContain('vec4 cloud(');
    expect(m.fragmentShader).not.toContain('vShockwave');
    expect(m.uniforms.uShockwaveAt).toBeUndefined();
  });
});
