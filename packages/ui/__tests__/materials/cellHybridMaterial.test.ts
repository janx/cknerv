import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeCellHybridMaterial } from '../../src/materials/cellHybridMaterial';

describe('makeCellHybridMaterial', () => {
  it('uses bounded accumulation for resting Cells and exposes its uniforms', () => {
    const m = makeCellHybridMaterial();
    expect(m).toBeInstanceOf(THREE.ShaderMaterial);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.blending).toBe(THREE.CustomBlending);
    expect(m.blendEquation).toBe(THREE.AddEquation);
    expect(m.blendSrc).toBe(THREE.SrcAlphaFactor);
    expect(m.blendDst).toBe(THREE.OneMinusSrcColorFactor);
    expect(m.blendEquationAlpha).toBe(THREE.AddEquation);
    expect(m.blendSrcAlpha).toBe(THREE.OneFactor);
    expect(m.blendDstAlpha).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(m.toneMapped).toBe(false);

    // Plumbing uniforms
    expect(m.uniforms.uTime).toBeDefined();
    expect(m.uniforms.uBirthDurS).toBeDefined();
    expect(m.uniforms.uDeathDurS).toBeDefined();
    expect(m.uniforms.uViewportHeight).toBeDefined();
    expect(m.uniforms.uPixelRatio.value).toBe(1);
    expect(m.uniforms.uMemoryMinPointPx.value).toBe(24);
    expect(m.uniforms.uMemoryLinePx.value).toBe(0.55);
    expect(m.uniforms.uMemorySignalEnergy.value).toBe(1);
    expect(m.uniforms.uWarmth.value).toBe(0.04);
    expect(m.uniforms.uCenterDim.value).toBe(0.3);

    // Discharge moved to cellFlareMaterial — the cell body no longer flares.
    expect(m.uniforms.uDischargeArms).toBeUndefined();

    // The block shockwave belongs to the actual cell body, not a separate
    // drifted halo Points layer beside the cell.
    expect(m.uniforms.uShockwaveAt).toBeDefined();
    expect(m.uniforms.uShockwaveOriginXZ).toBeDefined();
    expect(m.uniforms.uShockwaveColor).toBeDefined();
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

  it('reserves centre compression for the resting body before event accents', () => {
    const m = makeCellHybridMaterial();
    expect(m.vertexShader).toContain('vCenterDim');
    expect(m.fragmentShader).toContain('base.a *= vCenterDim');
    expect(m.fragmentShader.indexOf('base.a *= vCenterDim')).toBeLessThan(
      m.fragmentShader.indexOf('focusSignal'),
    );
  });

  it('applies topology inspection only to the resting Cell body', () => {
    const m = makeCellHybridMaterial();

    expect(m.vertexShader).toContain('attribute float aInspection');
    expect(m.vertexShader).toContain('vInspection = aInspection');
    expect(m.fragmentShader).toContain(
      'base.a *= vCenterDim * vInspection',
    );
    expect(m.fragmentShader.indexOf('base.a *= vCenterDim * vInspection'))
      .toBeLessThan(m.fragmentShader.indexOf('focusSignal'));
    expect(m.fragmentShader.indexOf('base.a *= vCenterDim * vInspection'))
      .toBeLessThan(m.fragmentShader.indexOf('readEnergy'));
  });

  it('renders hover and selection as an interrupted braid interference signal', () => {
    const m = makeCellHybridMaterial();

    expect(m.vertexShader).toContain('attribute float aFocus');
    expect(m.vertexShader).toContain('vFocus = aFocus');
    expect(m.fragmentShader).toContain('focusRing');
    expect(m.fragmentShader).toContain('focusArc');
    expect(m.fragmentShader).toContain('focusGold');
    expect(m.fragmentShader).toContain('focusCyan');
  });

  it('reads recalled evidence through address rails and a resolved record latch', () => {
    const m = makeCellHybridMaterial();

    expect(m.vertexShader).toContain('attribute float aRecall');
    expect(m.vertexShader).toContain('attribute float aRecallState');
    expect(m.vertexShader).toContain('vRecall = aRecall');
    expect(m.fragmentShader).toContain('scanAperture');
    expect(m.fragmentShader).toContain('addressGate');
    expect(m.fragmentShader).toContain('readEnergy');
    expect(m.fragmentShader).toContain('retainedEnergy');
    expect(m.fragmentShader).toContain('recordLatch');
    expect(m.fragmentShader).toContain('recordKnot');
    expect(m.fragmentShader).toContain('departureRail');
    expect(m.fragmentShader.indexOf('recordLatch')).toBeLessThan(
      m.fragmentShader.indexOf('retireMix'),
    );
  });

  it('keeps far retained cores distinct through the canonical A field mapping', () => {
    const m = makeCellHybridMaterial();

    expect(m.vertexShader).toContain('attribute vec4  aMemoryIdentity');
    expect(m.vertexShader).toContain('attribute float aMemorySeed');
    expect(m.vertexShader).toContain('vSeed      = aMemorySeed');
    expect(m.vertexShader).not.toContain('float(gl_VertexID)');
    expect(m.fragmentShader).toContain('recordAngle');
    expect(m.fragmentShader).toContain('checksumInner');
    expect(m.fragmentShader).toContain('checksumOuter');
    expect(m.fragmentShader).toContain('lockCadence');
    expect(m.fragmentShader).toContain('recordKnotRadius');
    expect(m.vertexShader).toContain('retainedFloor');
    expect(m.vertexShader).toContain('vPointCssPx');
    expect(m.fragmentShader).toContain('checksumWidth');
    expect(m.fragmentShader).toContain('checksumLaneStep');
  });

  it('cross-fades compact memory into the expanded braid instead of stacking both', () => {
    const m = makeCellHybridMaterial();

    expect(m.vertexShader).toContain('float compactVisibility');
    expect(m.fragmentShader).toContain('float compactVisibility');
    expect(m.fragmentShader).toContain('* compactVisibility');
    expect(m.vertexShader).toContain('uMemoryMinPointPx');
    expect(m.fragmentShader).toContain('uMemorySignalEnergy');
  });

  it('uses the purple-red retirement signal only as real death advances', () => {
    const m = makeCellHybridMaterial();

    expect(m.fragmentShader).toContain('retireColor');
    expect(m.fragmentShader).toContain('retireMix');
    expect(m.fragmentShader).toContain('smoothstep(0.0, 0.48, vDeathRamp)');
    expect(m.fragmentShader.indexOf('retireMix')).toBeGreaterThan(
      m.fragmentShader.indexOf('focusSignal'),
    );
  });

  it('brightens and expands the anchored cell core as the block shockwave crosses it', () => {
    const m = makeCellHybridMaterial();

    expect(m.vertexShader).toContain('shockwaveAtVertex');
    expect(m.vertexShader).toContain('vShockwave');
    expect(m.vertexShader).toContain('uShockwaveColor');
    expect(m.vertexShader).toContain('vShockwaveColor');
    expect(m.vertexShader).toContain('uShockwaveSizeBoost');
    expect(m.vertexShader).toContain('(1.0 + vShockwave * uShockwaveSizeBoost)');
    expect(m.vertexShader).not.toContain('drift');
    expect(m.vertexShader).not.toContain('position + drift');

    expect(m.fragmentShader).toContain('vShockwave');
    expect(m.fragmentShader).toContain('uShockwaveColorBoost');
    expect(m.fragmentShader).toContain('uShockwaveAlphaBoost');
    expect(m.fragmentShader).toContain('uShockwaveTrailBoost');
    expect(m.fragmentShader).toContain('vShockwaveColor');
  });

  it('uses mid-range core shockwave boosts (visible spreading front on sparse cells)', () => {
    const m = makeCellHybridMaterial();

    expect(m.uniforms.uShockwaveColorBoost.value).toBeCloseTo(3.75); // halved 2026-07-08 (new-block flash −50%)
    expect(m.uniforms.uShockwaveAlphaBoost.value).toBeCloseTo(2.75);
    expect(m.uniforms.uShockwaveSizeBoost.value).toBeCloseTo(0.5);
    expect(m.uniforms.uShockwaveTrailBoost.value).toBeCloseTo(0.18);
  });
});
