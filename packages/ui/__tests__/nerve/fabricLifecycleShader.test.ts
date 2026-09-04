import { describe, expect, it } from 'vitest';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import {
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
import { CONSENSUS_BRAID_PALETTE } from '../../src/derives/consensusBraid.derive';

/** The fabric layer's real material stack: capsule + lifecycle. */
function makeFabricStackMaterial(): LineMaterial {
  const material = new LineMaterial({
    vertexColors: true,
    linewidth: 2.5,
    transparent: true,
    worldUnits: false,
  });
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

    // Six packed vec4 attributes (locations are a hard GPU budget) and the
    // three per-frame uniforms; the dead stock attributes are stripped so
    // no driver counts them against the location limit.
    for (const declaration of [
      'attribute vec4 fabricCurveFrom;',
      'attribute vec4 fabricCurveCtrl;',
      'attribute vec4 fabricCurveTo;',
      'attribute vec4 fabricColorFrom;',
      'attribute vec4 fabricColorTo;',
      'attribute vec4 fabricLifecycle;',
      'uniform float fabricSimTimeSec;',
      'uniform float fabricEnergyLive;',
      'uniform float fabricCenterDimLive;',
    ]) expect(vertex).toContain(declaration);
    expect(vertex).not.toContain('attribute vec3 instanceStart;');
    expect(vertex).not.toContain('attribute vec3 instanceColorStart;');
    // Source-level declarations include ifdef'd-out dash attributes; the
    // ACTIVE set is 6 lifecycle (+ position/uv from three's prefix), safely
    // under the 16-location floor the old 19-attribute stack overflowed.
    // This counts THIS stack's declarations exactly; the whole package's
    // slot ledger — every family, with its injected and instanced charges —
    // is `__tests__/materials/vertexAttributeBudget.test.ts`.
    const attributeCount = (vertex.match(/attribute /g) ?? []).length;
    expect(attributeCount).toBeLessThanOrEqual(13);
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
    // The braid palette.
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

  it('per-frame sync writes the lifecycle scalars and the block-impact flush knobs', () => {
    const material = makeFabricStackMaterial();
    syncFabricLifecycleUniforms(material, 123.5);
    expect(material.uniforms.fabricSimTimeSec.value).toBe(123.5);
    expect(material.uniforms.fabricEnergyLive.value).toBeGreaterThan(0);
    expect(material.uniforms.fabricCenterDimLive.value).toBeGreaterThanOrEqual(0);
    // The flush twin's scalars ride the same sync (the slot lanes do not —
    // see fabricTissueFlush.test.ts).
    expect(material.uniforms.fabricFlushWindow.value).toBeGreaterThan(0);
    expect(material.uniforms.fabricFlushSpeed.value).toBeGreaterThan(0);
    expect(material.uniforms.fabricFlushFalloff.value).toBeGreaterThanOrEqual(0);
    expect(material.uniforms.fabricFlushAmp.value).toBeGreaterThan(0);
    expect(material.uniforms.fabricFlushMix.value).toBeGreaterThan(0);
  });

  it('keeps the alive sentinel far above any real sim-second', () => {
    expect(FABRIC_LIFECYCLE_ALIVE_SENTINEL).toBeGreaterThan(1e20);
    expect(Math.fround(FABRIC_LIFECYCLE_ALIVE_SENTINEL)).toBeGreaterThan(1e20);
  });
});
