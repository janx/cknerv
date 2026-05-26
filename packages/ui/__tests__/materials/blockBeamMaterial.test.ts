import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  makeBlockBeamMaterial,
  makeStrikeSplashSpriteTexture,
} from '../../src/materials/blockBeamMaterial';

describe('makeBlockBeamMaterial', () => {
  it('returns a ShaderMaterial wired for additive cylinder rendering', () => {
    const m = makeBlockBeamMaterial();
    expect(m).toBeInstanceOf(THREE.ShaderMaterial);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.depthTest).toBe(true);
    expect(m.blending).toBe(THREE.AdditiveBlending);
    expect(m.side).toBe(THREE.DoubleSide);
    expect(m.toneMapped).toBe(false);
  });

  it('exposes the expected uniforms with sensible defaults', () => {
    const m = makeBlockBeamMaterial();
    expect(m.uniforms.uAge.value).toBe(-1);
    expect(m.uniforms.uGrowDur.value).toBeGreaterThan(0);
    expect(m.uniforms.uStrikeDur.value).toBeGreaterThan(0);
    expect(m.uniforms.uTotalHeight.value).toBeGreaterThan(0);
  });

  it('uses fresnel (normal vs view) for the radial gradient', () => {
    const m = makeBlockBeamMaterial();
    expect(m.vertexShader).toContain('vNormalWorld');
    expect(m.vertexShader).toContain('vViewDir');
    expect(m.fragmentShader).toContain('dot(normalize(vNormalWorld)');
  });

  it('remaps position.y so the cylinder extends and then retracts into the tip', () => {
    const m = makeBlockBeamMaterial();
    expect(m.vertexShader).toContain('position.y + 0.5');
    expect(m.vertexShader).toContain('uTotalHeight');
    // Top extension during grow phase (base anchored, tip extends).
    expect(m.vertexShader).toContain('topT');
    // Bottom retraction during strike phase (tip anchored, base retracts up).
    expect(m.vertexShader).toContain('bottomT');
  });
});

describe('makeStrikeSplashSpriteTexture', () => {
  it('returns a CanvasTexture configured for additive sprite use', () => {
    const tex = makeStrikeSplashSpriteTexture();
    expect(tex).toBeInstanceOf(THREE.CanvasTexture);
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(tex.minFilter).toBe(THREE.LinearFilter);
    expect(tex.magFilter).toBe(THREE.LinearFilter);
  });
});
