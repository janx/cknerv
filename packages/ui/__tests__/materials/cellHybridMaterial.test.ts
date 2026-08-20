import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BIRTH_BLOOM,
  CELL_INSPECTION_NAVIGATION_SIZE_SCALE,
  makeCellHybridMaterial,
  WITHER_COOL_END,
  WITHER_EMBER_TINT,
  WITHER_GUTTER_DEPTH,
  WITHER_GUTTER_RATE,
} from '../../src/materials/cellHybridMaterial';
import {
  BIRTH_DURATION_MS,
  DEATH_DURATION_MS,
  ENTER_FADE_MS,
  EXIT_FADE_MS,
} from '../../src/geometry/cellPositions';
import {
  STAGE_ENTER_SCALE_FROM,
  STAGE_EXIT_SCALE_TO,
} from '../../src/materials/cellEnvelope.glsl';
import { CELL_GALAXY_PALETTE } from '../../src/visualPalette';

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
    // Defaults, not just presence: a literal here outlives every sweep of
    // the constant it was copied from.
    expect(m.uniforms.uBirthDurS.value).toBe(BIRTH_DURATION_MS / 1000);
    expect(m.uniforms.uDeathDurS.value).toBe(DEATH_DURATION_MS / 1000);
    expect(m.uniforms.uViewportHeight).toBeDefined();
    expect(m.uniforms.uPixelRatio.value).toBe(1);
    expect(m.uniforms.uMemoryMinPointPx.value).toBe(24);
    expect(m.uniforms.uMemoryLinePx.value).toBe(0.55);
    expect(m.uniforms.uMemorySignalEnergy.value).toBe(1);
    expect(m.uniforms.uInspectionBlend.value).toBe(1);
    expect(m.uniforms.uWarmth.value).toBe(0.12);
    expect(m.uniforms.uCenterDim.value).toBe(0.3);
    expect(m.uniforms.uEnterDurS.value).toBe(ENTER_FADE_MS / 1000);
    expect(m.uniforms.uExitDurS.value).toBe(EXIT_FADE_MS / 1000);

    // Discharge moved to cellFlareMaterial — the cell body no longer flares.
    expect(m.uniforms.uDischargeArms).toBeUndefined();

    // The broad new-block wave belongs to the peer network.
    expect(m.uniforms.uShockwaveAt).toBeUndefined();
    expect(m.uniforms.uShockwaveOriginXZ).toBeUndefined();
    expect(m.uniforms.uShockwaveColor).toBeUndefined();
  });

  it('composes stage resolution with the record\'s own birth and death', () => {
    const m = makeCellHybridMaterial();

    // Four gestures, one product: the view resolving a cell never replaces
    // the record being born or dying, it multiplies with it.
    expect(m.vertexShader).toContain(
      'float scale = bEase * (1.0 - dEase) * stage.x;',
    );
    expect(m.vertexShader).toContain(
      `mix(${STAGE_ENTER_SCALE_FROM.toFixed(2)}, 1.0, enterEased)`,
    );
    expect(m.vertexShader).toContain(
      `mix(1.0, ${STAGE_EXIT_SCALE_TO.toFixed(2)}, exitEased)`,
    );
    expect(m.vertexShader).toContain('enterEased * (1.0 - exitEased)');
    // The alpha factor is the ENTIRE fragment-side cost, applied last so it
    // dims the event signals with the body.
    expect(m.fragmentShader).toContain('a *= vStageAlpha;');
    expect(m.fragmentShader.indexOf('a *= vStageAlpha;')).toBeLessThan(
      m.fragmentShader.indexOf('if (a < 0.005) discard;'),
    );
    expect(m.fragmentShader.indexOf('col = mix(col, retireColor, retireMix);'))
      .toBeLessThan(m.fragmentShader.indexOf('a *= vStageAlpha;'));
  });

  it('keeps cloud + hash11 but no discharge (moved to the flare layer)', () => {
    const m = makeCellHybridMaterial();
    expect(m.fragmentShader).toContain('vec4 cloud(');
    expect(m.fragmentShader).toContain('hash11');
    expect(m.vertexShader).toContain('vec3 ember');
    expect(m.vertexShader).toContain('vHotColor');
    expect(m.fragmentShader).not.toContain('vec4 discharge(');
  });

  it('evaluates per-Cell cloud invariants in the vertex shader', () => {
    const m = makeCellHybridMaterial();

    expect(m.vertexShader).toContain('float breathRate');
    expect(m.vertexShader).toContain('sin(uTime * breathRate + vSeed)');
    expect(m.vertexShader).toContain('vBodyColor =');
    expect(m.vertexShader).toContain('vCloudParams = vec3(');
    expect(m.fragmentShader).toContain('float radiusSquared = dot(uv, uv)');
    expect(m.fragmentShader).toContain(
      'exp(-radiusSquared * vCloudParams.x)',
    );
    expect(m.fragmentShader).not.toContain('hash11(vSeed + 7.7)');
    expect(m.fragmentShader).not.toContain('length(uv) > 0.5');
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

    expect(m.vertexShader).toContain('attribute float aInspectionFrom');
    expect(m.vertexShader).toContain('attribute float aInspectionTo');
    expect(m.vertexShader).toContain('uniform float uInspectionBlend');
    expect(m.vertexShader).toContain('vInspection = mix(');
    expect(m.fragmentShader).toContain(
      'base.a *= vCenterDim * vInspection',
    );
    expect(m.fragmentShader.indexOf('base.a *= vCenterDim * vInspection'))
      .toBeLessThan(m.fragmentShader.indexOf('focusSignal'));
    expect(m.fragmentShader.indexOf('base.a *= vCenterDim * vInspection'))
      .toBeLessThan(m.fragmentShader.indexOf('readEnergy'));
  });

  it('gives direct neighbours a split interface affordance within the pick footprint', () => {
    const m = makeCellHybridMaterial();

    expect(CELL_INSPECTION_NAVIGATION_SIZE_SCALE).toBeGreaterThan(1);
    expect(m.vertexShader).toContain('attribute float aInspectionRole');
    expect(m.vertexShader).toContain('inspectionNavigationScale');
    expect(m.vertexShader).toContain(
      CELL_INSPECTION_NAVIGATION_SIZE_SCALE.toFixed(2),
    );
    expect(m.fragmentShader).toContain('navigationRing');
    expect(m.fragmentShader).toContain('navigationArc');
    expect(m.fragmentShader).toContain('navigationNotch');
    expect(m.fragmentShader.indexOf('navigationSignal'))
      .toBeLessThan(m.fragmentShader.indexOf('focusSignal'));
    expect(m.fragmentShader).toContain('if (vInspectionRole > 0.0001)');
  });

  it('renders hover and selection as an interrupted braid interference signal', () => {
    const m = makeCellHybridMaterial();

    expect(m.vertexShader).toContain('attribute float aFocus');
    expect(m.vertexShader).toContain('vFocus = aFocus');
    expect(m.fragmentShader).toContain('focusRing');
    expect(m.fragmentShader).toContain('focusArc');
    expect(m.fragmentShader).toContain('focusGold');
    expect(m.fragmentShader).toContain('focusCyan');
    expect(m.fragmentShader).toContain('if (vFocus > 0.0001)');
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
    expect(m.fragmentShader).toContain('if (abs(vRecall) > 0.0001)');
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

  it('blooms a newborn warm and spends the bloom over its growth', () => {
    const m = makeCellHybridMaterial();

    expect(m.vertexShader).toContain('varying float vBirthRamp;');
    expect(m.fragmentShader).toContain('varying float vBirthRamp;');
    expect(m.vertexShader).toContain('vBirthRamp = birthRamp;');
    // The white core the resting cloud already mixes toward — no second
    // palette, and exactly one mix.
    expect(m.fragmentShader).toContain(
      `col = mix(col, vHotColor, ${BIRTH_BLOOM.toFixed(2)} * (1.0 - vBirthRamp));`,
    );
    // On the resting body, before any event accent can be tinted by it.
    expect(m.fragmentShader.indexOf('vHotColor, ' + BIRTH_BLOOM.toFixed(2)))
      .toBeLessThan(m.fragmentShader.indexOf('navigationSignal'));
  });

  it('withers a corpse by cooling and guttering it, not by deflating it', () => {
    const m = makeCellHybridMaterial();

    // Living cells resolve every term to identity, so the whole rite sits
    // behind one branch the resting field never takes.
    expect(m.fragmentShader).toContain('if (vDeathRamp > 0.0) {');
    // Chroma drains toward the galaxy's OWN ember, never a new palette.
    expect(m.fragmentShader).toContain(
      `vec3 emberColor = vec3(${CELL_GALAXY_PALETTE.ember.join(', ')});`,
    );
    expect(m.fragmentShader).toContain('vec3 ash = vec3(dot(col,');
    expect(m.fragmentShader).toContain(
      `float cooling = smoothstep(0.0, ${WITHER_COOL_END.toFixed(2)}, vDeathRamp);`,
    );
    expect(m.fragmentShader).toContain(
      `mix(ash, emberColor, ${WITHER_EMBER_TINT.toFixed(2)}),`,
    );
    // Per-cell phase: a block's worth of deaths must not strobe in unison.
    expect(m.fragmentShader).toContain('float gutterPhase = hash11(vSeed');
    expect(m.fragmentShader).toContain(
      `sin(uTime * ${WITHER_GUTTER_RATE.toFixed(1)} + gutterPhase)`,
    );
    expect(m.fragmentShader).toContain(
      `sin(uTime * ${(WITHER_GUTTER_RATE * 1.7).toFixed(2)} + gutterPhase * 2.1)`,
    );
    // Amplitude grows with the ramp and only ever removes light.
    expect(m.fragmentShader).toContain(
      `a *= 1.0 - ${WITHER_GUTTER_DEPTH.toFixed(2)} * vDeathRamp * gutter;`,
    );
    expect(WITHER_GUTTER_DEPTH).toBeLessThan(1);
    // Cooling and guttering both precede the retirement signal.
    expect(m.fragmentShader.indexOf('float cooling ='))
      .toBeLessThan(m.fragmentShader.indexOf('float retireMix ='));
    expect(m.fragmentShader.indexOf('float gutterPhase ='))
      .toBeLessThan(m.fragmentShader.indexOf('float retireMix ='));
  });

  it('keeps the broad network shockwave out of the anchored Cell core', () => {
    const m = makeCellHybridMaterial();

    expect(m.vertexShader).not.toContain('shockwaveSignalAt');
    expect(m.vertexShader).not.toContain('vShockwave');
    expect(m.vertexShader).not.toContain('uShockwave');
    expect(m.vertexShader).not.toContain('drift');
    expect(m.vertexShader).not.toContain('position + drift');
    expect(m.fragmentShader).not.toContain('vShockwave');
    expect(m.fragmentShader).not.toContain('uShockwave');
  });
});
