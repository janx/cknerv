import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeCellCanopyVeilMaterial } from '../../src/materials/cellCanopyVeilMaterial';

describe('makeCellCanopyVeilMaterial', () => {
  it('returns an additive transparent shader material for the canopy veil', () => {
    const m = makeCellCanopyVeilMaterial();

    expect(m).toBeInstanceOf(THREE.ShaderMaterial);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.depthTest).toBe(false);
    expect(m.blending).toBe(THREE.AdditiveBlending);
    expect(m.toneMapped).toBe(false);
  });

  it('exposes the uniforms used by the breathing canopy veil', () => {
    const m = makeCellCanopyVeilMaterial();

    expect(m.uniforms.uTime).toBeDefined();
    expect(m.uniforms.uIntensity).toBeDefined();
    expect(m.uniforms.uColorA).toBeDefined();
    expect(m.uniforms.uColorB).toBeDefined();
    expect(m.uniforms.uColorC).toBeDefined();
  });

  it('uses the cell neural network palette instead of chain cyan', () => {
    const m = makeCellCanopyVeilMaterial();

    expect((m.uniforms.uColorA.value as THREE.Color).getHexString()).toBe('c21b4d');
    expect((m.uniforms.uColorB.value as THREE.Color).getHexString()).toBe('ff4fa3');
    expect((m.uniforms.uColorC.value as THREE.Color).getHexString()).toBe('ff8c26');
    expect((m.uniforms.uColorA.value as THREE.Color).getHexString()).not.toBe('7df9ff');
  });

  it('keeps the effect as a bounded canopy mask, not a full-scene nebula', () => {
    const m = makeCellCanopyVeilMaterial();

    expect(m.fragmentShader).toContain('canopyMask');
    expect(m.fragmentShader).toContain('breath');
    expect(m.fragmentShader).not.toContain('nebulaGas');
    expect(m.fragmentShader).not.toContain('NEBULA_GAS');
  });

  it('does not premultiply veil RGB before additive blending applies alpha', () => {
    const m = makeCellCanopyVeilMaterial();

    expect(m.fragmentShader).toContain('gl_FragColor = vec4(tint, alpha)');
    expect(m.fragmentShader).not.toContain('gl_FragColor = vec4(tint * alpha, alpha)');
  });

  it('uses defined smoothstep edge ordering for the canopy mask', () => {
    const m = makeCellCanopyVeilMaterial();

    expect(m.fragmentShader).toContain('1.0 - smoothstep(edge - 0.26, edge, r)');
    expect(m.fragmentShader).not.toContain('smoothstep(1.04, 0.18, r)');
  });

  it('caps alpha lower while increasing the opacity breathing range', () => {
    const m = makeCellCanopyVeilMaterial();

    expect(m.fragmentShader).toContain('vec2 breathedP = p / (1.0 + 0.022 * breathWave)');
    expect(m.fragmentShader).toContain('float mask = canopyMask(breathedP)');
    expect(m.fragmentShader).toContain('mix(0.035, 0.1025, breath)');
    expect(m.fragmentShader).toContain('0.985 + 0.015 * drift');
    expect(m.fragmentShader).not.toContain('mix(0.165, 0.205, breath)');
  });

  it('breaks the canopy edge with slow angular rim noise', () => {
    const m = makeCellCanopyVeilMaterial();

    expect(m.fragmentShader).toContain('float rimNoise(vec2 p)');
    expect(m.fragmentShader).toContain('atan(p.y, p.x)');
    expect(m.fragmentShader).toContain('sin(a * 5.0');
    expect(m.fragmentShader).toContain('sin(a * 9.0');
  });

  it('keeps color drift subtle and independent from the breathing cycle', () => {
    const m = makeCellCanopyVeilMaterial();

    expect(m.fragmentShader).toContain('float colorMix = 0.56 + 0.06 * sin(p.x * 1.2 - p.y * 0.8)');
    expect(m.fragmentShader).toContain('tint = mix(tint, uColorC, 0.040)');
    expect(m.fragmentShader).toContain('float drift = 0.5 + 0.5 * sin(p.x * 2.1 - p.y * 1.4)');
    expect(m.fragmentShader).not.toContain('smoothstep(-0.80, 0.90');
    expect(m.fragmentShader).not.toContain('0.10 + 0.06 * drift');
    expect(m.fragmentShader).not.toContain('uTime * 0.29');
  });
});
