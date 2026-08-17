import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  makePopulationCompositeMaterial,
  makePopulationDensityMaterial,
  POPULATION_FIELD_BLOOM_MS,
  POPULATION_FIELD_GRAIN_PX,
  POPULATION_FIELD_MAX_BLOOMS,
  POPULATION_FIELD_SLAB_HALF_Y,
} from '../../src/materials/populationFieldMaterial';
import {
  TISSUE_BAKE_FOLD_Y_RANGE,
  TISSUE_BAKE_THICKNESS_MAX,
  TISSUE_BAKE_THICKNESS_MIN,
} from '../../src/geometry/tissueFieldBake';
import { DEATH_DURATION_MS } from '../../src/geometry/cellPositions';
import { CELL_GALAXY_PALETTE } from '../../src/visualPalette';

describe('makePopulationDensityMaterial', () => {
  it('marches a bounded volume, not a fullscreen quad', () => {
    const material = makePopulationDensityMaterial();

    expect(material).toBeInstanceOf(THREE.ShaderMaterial);
    // Back faces: the exit surface stays visible whether the camera is
    // outside the slab or has flown inside it.
    expect(material.side).toBe(THREE.BackSide);
    expect(material.depthWrite).toBe(false);
    expect(material.toneMapped).toBe(false);
    expect(material.fragmentShader).toContain('slabRange');
    expect(material.fragmentShader).not.toContain('gl_FragCoord.xy / uResolution');
  });

  it('decodes the bake with the exact ranges the bake encoded', () => {
    const material = makePopulationDensityMaterial();

    // A mismatch here silently rescales the fold or the thickness, which
    // would tilt or inflate the medium against the Cells it sits among.
    expect(material.uniforms.uFoldRange.value).toBe(TISSUE_BAKE_FOLD_Y_RANGE);
    expect(material.uniforms.uThicknessMin.value)
      .toBe(TISSUE_BAKE_THICKNESS_MIN);
    expect(material.uniforms.uThicknessSpan.value)
      .toBe(TISSUE_BAKE_THICKNESS_MAX - TISSUE_BAKE_THICKNESS_MIN);
  });

  it('evaluates the analytic volume the Cell sampler implies', () => {
    const material = makePopulationDensityMaterial();

    // rho = density * exp(-0.5 * ((y - foldY) / thickness)^2), then
    // alpha = 1 - exp(-tau). Both halves have to be in the shader, or the
    // medium stops being the same law the Cells are placed by.
    expect(material.fragmentShader).toContain('exp(-0.5 * dy * dy)');
    expect(material.fragmentShader).toContain('1.0 - exp(-tau');
  });

  it('stays within the eight-step march budget', () => {
    const material = makePopulationDensityMaterial();
    expect(material.uniforms.uSteps.value).toBeLessThanOrEqual(8);
  });

  it('dithers the march so a fixed offset cannot band', () => {
    const material = makePopulationDensityMaterial();
    expect(material.fragmentShader).toContain('hash21(gl_FragCoord.xy)');
  });

  it('starts with no optical depth, so absence is the default state', () => {
    const material = makePopulationDensityMaterial();
    expect(material.uniforms.uOpticalDepth.value).toBe(0);
    expect(material.uniforms.uField.value).toBeNull();
  });
});

describe('makePopulationCompositeMaterial', () => {
  it('blends beneath the Cells without hiding the chain mesh', () => {
    const material = makePopulationCompositeMaterial();

    expect(material.transparent).toBe(true);
    expect(material.blending).toBe(THREE.NormalBlending);
    expect(material.depthWrite).toBe(false);
    // Depth-testing a back face would erase the medium wherever something
    // opaque sat behind it. Transparency, not depth, is what keeps the chain
    // layer visible THROUGH the medium.
    expect(material.depthTest).toBe(false);
  });

  it('encodes to the output colour space like every sibling sprite pass', () => {
    const material = makePopulationCompositeMaterial();
    // Without this the medium tracks a second gamma curve against the Cell
    // sprites it shares a frame with.
    expect(material.toneMapped).toBe(false);
    expect(material.fragmentShader).toContain('#include <colorspace_fragment>');
  });

  it('locks its grain to the screen, never to the world', () => {
    const material = makePopulationCompositeMaterial();

    // The grain cell index comes from gl_FragCoord, so its frequency is fixed
    // to the display: flying closer cannot resolve it. World-space grain is
    // the rejected alternative precisely because it does resolve.
    expect(material.fragmentShader).toContain('floor(gl_FragCoord.xy / max(uGrainPx');
    expect(material.uniforms.uGrainPx.value).toBe(POPULATION_FIELD_GRAIN_PX);
    expect(POPULATION_FIELD_GRAIN_PX).toBeGreaterThanOrEqual(1);
    expect(POPULATION_FIELD_GRAIN_PX).toBeLessThanOrEqual(2.5);
  });

  it('scales grain amplitude by optical depth so it lives where matter is', () => {
    const material = makePopulationCompositeMaterial();
    expect(material.fragmentShader).toContain('grain * uGrainAmount * total');
  });

  it('samples the density term by screen position, upsampling it', () => {
    const material = makePopulationCompositeMaterial();
    expect(material.fragmentShader)
      .toContain('gl_FragCoord.xy / uResolution');
    expect(material.fragmentShader).toContain('texture2D(uDensity, screenUv)');
  });

  it('carries a bounded bloom pool that costs nothing while empty', () => {
    const material = makePopulationCompositeMaterial();

    expect(material.uniforms.uBlooms.value).toHaveLength(
      POPULATION_FIELD_MAX_BLOOMS,
    );
    expect(POPULATION_FIELD_MAX_BLOOMS).toBe(64);
    expect(material.uniforms.uBloomCount.value).toBe(0);
    // The loop exits at the live count rather than running the ceiling.
    expect(material.fragmentShader).toContain('if (i >= uBloomCount) break;');
  });

  it('keeps blooms inside the medium instead of floating in vacuum', () => {
    const material = makePopulationCompositeMaterial();
    // A bloom is scaled by the coverage it sits in; one in empty space would
    // read as an object rather than as a transition within a population.
    expect(material.fragmentShader).toContain('max(coverage, 0.12)');
  });

  it('takes a desaturated body tint and no identity hue at all', () => {
    const material = makePopulationCompositeMaterial();
    const tint = material.uniforms.uTint.value as THREE.Color;
    const [r, g, b] = CELL_GALAXY_PALETTE.tissueRose;

    // Same family as the organism, far less saturated: an identity palette
    // here would make an aggregate look like a claim about its members.
    const bodySaturation = Math.max(r, g, b) - Math.min(r, g, b);
    const tintSaturation = Math.max(tint.r, tint.g, tint.b)
      - Math.min(tint.r, tint.g, tint.b);
    expect(tintSaturation).toBeLessThan(bodySaturation * 0.35);
    // Warm rather than neutral-cold, so it still belongs to this organism.
    expect(tint.r).toBeGreaterThan(tint.g);
  });
});

describe('the medium against its neighbours', () => {
  it('is bounded by the analytic extent of the fold, not by taste', () => {
    // foldY cannot leave its range and thickness cannot exceed its maximum,
    // so three sigma above the highest fold is where the volume stops
    // contributing. A shorter slab would clip the medium's own top.
    const threeSigma = TISSUE_BAKE_FOLD_Y_RANGE + 3 * TISSUE_BAKE_THICKNESS_MAX;
    expect(POPULATION_FIELD_SLAB_HALF_Y).toBeGreaterThanOrEqual(threeSigma - 1);
    expect(POPULATION_FIELD_SLAB_HALF_Y).toBeLessThan(threeSigma + 6);
  });

  it('gives a dissolve a signature a death cannot be confused with', () => {
    // Death owns its colour and its 600 ms. A Cell leaving the stage is alive
    // on chain, so its mark is markedly slower — if the eye's death count
    // stops matching the HUD's, this layer has failed.
    expect(POPULATION_FIELD_BLOOM_MS).toBeGreaterThan(DEATH_DURATION_MS * 2);
  });
});
