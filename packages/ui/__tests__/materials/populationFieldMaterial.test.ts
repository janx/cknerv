import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { makeCellHybridMaterial } from '../../src/materials/cellHybridMaterial';
import {
  makePopulationPointMaterial,
  populationPointEnergy,
  populationPointFootprint,
  POPULATION_FIELD_COLOR,
  POPULATION_FIELD_EMISSION,
  POPULATION_FIELD_MIN_POINT_PX,
  POPULATION_FIELD_POINT_SIZE,
  POPULATION_FIELD_SIGMA,
} from '../../src/materials/populationFieldMaterial';
import { CELL_GALAXY_PALETTE } from '../../src/visualPalette';

describe('the halo is the Cells material family, not a second material', () => {
  const halo = makePopulationPointMaterial();
  const cells = makeCellHybridMaterial();

  it('blends exactly as a Cell body does', () => {
    // This is the whole design. Five rounds of tuning could not make a
    // procedural screen-space texture sit beside sprite geometry, because
    // however closely value, grain and hue were matched they stayed two
    // materials and a material boundary is always visible. There is no seam
    // here because there is no second material — and that claim is only true
    // while these agree.
    for (const key of [
      'blending',
      'blendEquation',
      'blendSrc',
      'blendDst',
      'blendEquationAlpha',
      'blendSrcAlpha',
      'blendDstAlpha',
      'transparent',
      'depthWrite',
      'toneMapped',
    ] as const) {
      expect(halo[key], key).toBe(cells[key]);
    }
    expect(halo.blending).toBe(THREE.CustomBlending);
  });

  it('emits rather than covers', () => {
    // A pixel with no unresolved population must receive exactly zero.
    // Alpha-over at any tint or opacity lifts the black across the envelope,
    // which is the optical signature of atmosphere between the viewer and the
    // subject — and it has already destroyed this scene once.
    expect(halo.blending).not.toBe(THREE.NormalBlending);
    expect(halo.blendDst).toBe(THREE.OneMinusSrcColorFactor);
    expect(halo.fragmentShader).toContain('gl_FragColor = vec4(uColor * a, a);');
  });

  it('writes raw, as the Cells do', () => {
    // A converted twin is a second material: one of the two would carry an
    // extra gamma and the boundary would come straight back.
    expect(halo.fragmentShader).not.toContain('colorspace_fragment');
    expect(cells.fragmentShader).not.toContain('colorspace_fragment');
  });

  it('shrinks with distance at the Cells own rate', () => {
    // Both sprite sizes are `size * BASE_PX_PER_WU * (viewportHeight / 2 /
    // distance)`. If the halo used its own multiplier the two populations
    // would separate as the camera moved, which is exactly the parallax
    // mismatch that made the screen-space version read as a filter.
    const law = /uViewportHeight \* 0\.5 \/ max\(-viewPos\.z, 0\.001\)/;
    expect(halo.vertexShader).toMatch(law);
    expect(cells.vertexShader).toMatch(law);
  });
});

describe('smaller and dimmer, and nothing else', () => {
  it('states a ceiling a saturated patch converges to', () => {
    // The blend's fixed point is the emitted alpha, so the emission constant
    // is a hard brightness ceiling rather than a value that happened to look
    // right. Cell bodies emit past 1 and converge to white; this cannot.
    expect(POPULATION_FIELD_EMISSION).toBeGreaterThan(0.5);
    expect(POPULATION_FIELD_EMISSION).toBeLessThan(1);
  });

  it('starts dark and is lit only by the amount curve', () => {
    const material = makePopulationPointMaterial();
    expect(material.uniforms.uEmission.value).toBe(0);
    expect(material.uniforms.uSize.value).toBe(POPULATION_FIELD_POINT_SIZE);
  });

  it('spends its light over the sprite instead of into a core', () => {
    // A Cell concentrates into a peak at sigma 0.10 and mixes toward white
    // there. This is wider relative to its own sprite and mixes toward
    // nothing, which is what makes it read as a speck rather than as a small
    // Cell.
    expect(POPULATION_FIELD_SIGMA).toBeGreaterThan(0.1);
    const material = makePopulationPointMaterial();
    expect(material.fragmentShader).toContain(
      (POPULATION_FIELD_SIGMA * POPULATION_FIELD_SIGMA).toFixed(6),
    );
  });

  it('carries the body hue at full saturation', () => {
    // Identity hue is banned: we know nothing about these Cells individually.
    // Desaturating toward grey is what makes a layer read as fog.
    expect(POPULATION_FIELD_COLOR).toBe(CELL_GALAXY_PALETTE.tissueRose);
    const [r, g, b] = POPULATION_FIELD_COLOR;
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(0.4);
  });
});

describe('the sprite footprint', () => {
  it('follows the inverse-distance law', () => {
    const near = populationPointFootprint(POPULATION_FIELD_POINT_SIZE, 1600, 100);
    const far = populationPointFootprint(POPULATION_FIELD_POINT_SIZE, 1600, 200);
    expect(near / far).toBeCloseTo(2, 6);
  });

  it('is a few device pixels at the production camera', () => {
    // Camera [110, 108, 110] looking at the origin is ~189 world units out;
    // a 1080p canvas at DPR 2 is 2160 drawing-buffer pixels tall.
    const px = populationPointFootprint(POPULATION_FIELD_POINT_SIZE, 2160, 189);
    expect(px).toBeGreaterThan(POPULATION_FIELD_MIN_POINT_PX);
    expect(px).toBeLessThan(16);
  });

  it('conserves light when the minimum footprint has to widen a sprite', () => {
    // A point cannot render smaller than a fragment. Without this the field
    // would stop dimming as the camera pulled back and would twinkle as
    // sprites crossed the pixel grid instead.
    expect(populationPointEnergy(4, 4)).toBe(1);
    expect(populationPointEnergy(0.7, 1.4)).toBeCloseTo(0.25, 6);
    // Never above one: a sprite the minimum did not touch is unmodified.
    expect(populationPointEnergy(8, 1.4)).toBe(1);
  });
});
