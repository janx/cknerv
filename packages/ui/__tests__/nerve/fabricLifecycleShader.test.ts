import { describe, expect, it } from 'vitest';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import {
  enableLineInspectionTransitionMaterial,
  optimizeScreenSpaceCapsuleMaterial,
} from '../../src/geometry/screenSpaceCapsuleLine';
import {
  enableFabricLifecycleMaterial,
  syncFabricLifecycleUniforms,
  FABRIC_LIFECYCLE_ALIVE_SENTINEL,
} from '../../src/nerve/fabricLifecycleShader';
import {
  DEATH_FLASH_MS,
  DEATH_RETRACT_MS,
  DECAY_MS,
  GROWTH_MS,
} from '../../src/nerve/fabricEdgeRender';
import { TAPER_MIN, TWIG_MIN } from '../../src/nerve/fabricLuminance';
import { USAGE_DECAY_HALF_LIFE_S } from '../../src/nerve/fabricReinforce';
import { CONSENSUS_BRAID_PALETTE } from '../../src/derives/consensusBraid.derive';

/** The fabric layer's real material stack: capsule + inspection + lifecycle. */
function makeFabricStackMaterial(): LineMaterial {
  const material = new LineMaterial({
    vertexColors: true,
    linewidth: 2.5,
    transparent: true,
    worldUnits: false,
  });
  enableLineInspectionTransitionMaterial(material);
  optimizeScreenSpaceCapsuleMaterial(material);
  return enableFabricLifecycleMaterial(material);
}

describe('fabric lifecycle shader patch', () => {
  it('applies over the real capsule-optimized LineMaterial without drift', () => {
    const material = makeFabricStackMaterial();
    const vertex = material.vertexShader;

    // Endpoints and endpoint colors now come from the lifecycle evaluation.
    expect(vertex).toContain('computeFabricLifecycle();');
    expect(vertex).toContain('vCapsuleColorStart = fabricLifeColorStart;');
    expect(vertex).toContain('vCapsuleColorEnd = fabricLifeColorEnd;');
    expect(vertex).not.toContain('modelViewMatrix * vec4( instanceStart');
    expect(vertex).not.toContain('vCapsuleColorStart = instanceColorStart;');

    // Static-record attributes and the three per-frame uniforms.
    for (const declaration of [
      'attribute vec3 fabricCurveFrom;',
      'attribute vec3 fabricCurveCtrl;',
      'attribute vec3 fabricCurveTo;',
      'attribute vec2 fabricSegmentSpan;',
      'attribute vec3 fabricColorFrom;',
      'attribute vec3 fabricColorTo;',
      'attribute vec4 fabricLifecycle;',
      'attribute vec4 fabricUsage;',
      'attribute vec2 fabricAperture;',
      'uniform float fabricSimTimeSec;',
      'uniform float fabricEnergyLive;',
      'uniform float fabricCenterDimLive;',
    ]) expect(vertex).toContain(declaration);
    expect(material.uniforms.fabricSimTimeSec).toBeDefined();
  });

  it('injects the exact TypeScript lifecycle constants into the GLSL', () => {
    const vertex = makeFabricStackMaterial().vertexShader;
    // Timing envelope (fabricEdgeRender).
    expect(vertex).toContain(`${GROWTH_MS}.0`);
    expect(vertex).toContain(`${DECAY_MS}.0`);
    expect(vertex).toContain(`${DEATH_RETRACT_MS}.0`);
    expect(vertex).toContain(`${DEATH_FLASH_MS}.0`);
    // Brightness floors and reclaim curve (fabricLuminance).
    expect(vertex).toContain(`${TAPER_MIN}`);
    expect(vertex).toContain(`${TWIG_MIN}`);
    // Usage half-life (fabricReinforce) and the braid palette.
    expect(vertex).toContain(`${USAGE_DECAY_HALF_LIFE_S}.0`);
    const [gr, gg, gb] = CONSENSUS_BRAID_PALETTE.gold;
    expect(vertex).toContain(`vec3( ${gr}, ${gg}, ${gb} )`);
    const [rr, rg, rb] = CONSENSUS_BRAID_PALETTE.retire;
    expect(vertex).toContain(`vec3( ${rr}, ${rg}, ${rb} )`);
  });

  it('refuses to apply before the capsule optimization', () => {
    const bare = new LineMaterial({ vertexColors: true, worldUnits: false });
    expect(() => enableFabricLifecycleMaterial(bare))
      .toThrow(/capsule/);
  });

  it('per-frame sync writes exactly the three scalars', () => {
    const material = makeFabricStackMaterial();
    syncFabricLifecycleUniforms(material, 123.5);
    expect(material.uniforms.fabricSimTimeSec.value).toBe(123.5);
    expect(material.uniforms.fabricEnergyLive.value).toBeGreaterThan(0);
    expect(material.uniforms.fabricCenterDimLive.value).toBeGreaterThanOrEqual(0);
  });

  it('keeps the alive sentinel far above any real sim-second', () => {
    expect(FABRIC_LIFECYCLE_ALIVE_SENTINEL).toBeGreaterThan(1e20);
    expect(Math.fround(FABRIC_LIFECYCLE_ALIVE_SENTINEL)).toBeGreaterThan(1e20);
  });
});
