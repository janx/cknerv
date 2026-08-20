import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeCellFlareMaterial } from '../../src/materials/cellFlareMaterial';
import { makeCellHybridMaterial } from '../../src/materials/cellHybridMaterial';
import {
  BIRTH_DURATION_MS,
  DEATH_DURATION_MS,
  ENTER_FADE_MS,
  EXIT_FADE_MS,
} from '../../src/geometry/cellPositions';

describe('makeCellFlareMaterial', () => {
  it('returns an additive ShaderMaterial with the flash uniforms', () => {
    const m = makeCellFlareMaterial();
    expect(m).toBeInstanceOf(THREE.ShaderMaterial);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.blending).toBe(THREE.AdditiveBlending);
    expect(m.toneMapped).toBe(false);
    expect(m.uniforms.uTime).toBeDefined();
    expect(m.uniforms.uBirthDurS.value).toBe(BIRTH_DURATION_MS / 1000);
    expect(m.uniforms.uDeathDurS.value).toBe(DEATH_DURATION_MS / 1000);
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
    expect(m.vertexShader).not.toContain('attribute vec3  aColor');
    expect(m.fragmentShader).not.toContain('varying vec3  vColor');
  });

  it('clips inactive write vertices before they generate point fragments', () => {
    const m = makeCellFlareMaterial();

    expect(m.vertexShader).toContain('vFlashAge < 0.0');
    expect(m.vertexShader).toContain('vFlashAge >= 0.5');
    expect(m.vertexShader).toContain(
      'gl_Position = vec4(2.0, 2.0, 2.0, 1.0)',
    );
    expect(m.vertexShader.indexOf('vFlashAge >= 0.5')).toBeLessThan(
      m.vertexShader.indexOf('viewMatrix * modelMatrix'),
    );
  });

  it('resolves its cell in and out on the same clock as the body', () => {
    const flare = makeCellFlareMaterial();
    const hybrid = makeCellHybridMaterial();

    // The flare draws OVER the body it belongs to: two spans would show up
    // as a write outliving the cell that made it.
    expect(flare.uniforms.uEnterDurS.value).toBe(ENTER_FADE_MS / 1000);
    expect(flare.uniforms.uExitDurS.value).toBe(EXIT_FADE_MS / 1000);
    expect(flare.uniforms.uEnterDurS.value)
      .toBe(hybrid.uniforms.uEnterDurS.value);
    expect(flare.uniforms.uExitDurS.value)
      .toBe(hybrid.uniforms.uExitDurS.value);

    for (const material of [flare, hybrid]) {
      expect(material.vertexShader).toContain('attribute vec2  aStageAt;');
      // One shared envelope, so neither layer can drift into its own curve.
      expect(material.vertexShader).toContain('vec2 stage = stageEnvelope(');
      expect(material.vertexShader).toContain(
        'stageEase(stageRamp(uTime, aStageAt.x, uEnterDurS))',
      );
      expect(material.vertexShader).toContain(
        'stageEase(stageRamp(uTime, aStageAt.y, uExitDurS))',
      );
      expect(material.vertexShader).toContain(
        'float scale = bEase * (1.0 - dEase) * stage.x;',
      );
      expect(material.vertexShader).toContain('vStageAlpha = stage.y;');
      expect(material.fragmentShader).toContain('varying float vStageAlpha;');
    }
  });

  it('runs the chain gestures on the body\'s durations and curves', () => {
    const flare = makeCellFlareMaterial();
    const hybrid = makeCellHybridMaterial();

    // A write is drawn ON its cell. Two birth windows would leave a seal
    // hanging over a body that has already settled, and two death windows
    // would outlive the corpse that made it.
    for (const material of [flare, hybrid]) {
      expect(material.uniforms.uBirthDurS.value).toBe(BIRTH_DURATION_MS / 1000);
      expect(material.uniforms.uDeathDurS.value).toBe(DEATH_DURATION_MS / 1000);
      // One shared snippet: neither layer owns a private growth or wither.
      expect(material.vertexShader).toContain('float birthEase(float r) {');
      expect(material.vertexShader).toContain('float deathEase(float r) {');
      expect(material.vertexShader).toContain('float bEase = birthEase(birthRamp);');
      expect(material.vertexShader).toContain('float dEase = deathEase(deathRamp);');
    }
  });

  it('clips a write whose cell is fully released before projection', () => {
    const m = makeCellFlareMaterial();
    expect(m.vertexShader).toContain('vStageAlpha <= 0.0');
    expect(m.vertexShader.indexOf('vStageAlpha <= 0.0')).toBeLessThan(
      m.vertexShader.indexOf('viewMatrix * modelMatrix'),
    );
    expect(m.fragmentShader).toContain(
      'writeSignal.a * (1.0 - vDeathRamp) * vStageAlpha',
    );
  });

  it('carries no cloud or peer-network shockwave', () => {
    const m = makeCellFlareMaterial();
    expect(m.fragmentShader).not.toContain('vec4 cloud(');
    expect(m.fragmentShader).not.toContain('vShockwave');
    expect(m.uniforms.uShockwaveAt).toBeUndefined();
  });
});
