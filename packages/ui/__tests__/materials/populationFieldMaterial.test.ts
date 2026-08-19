import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { makeCellHybridMaterial } from '../../src/materials/cellHybridMaterial';
import {
  makePopulationPointMaterial,
  populationPointEnergy,
  populationEmissionForGain,
  populationPointFootprint,
  populationPointSizeForWeight,
  populationTaperForWeight,
  populationTintForWeight,
  POPULATION_FIELD_COLOR_DIM,
  POPULATION_FIELD_COLOR_LIT,
  POPULATION_FIELD_EMISSION,
  POPULATION_FIELD_MIN_POINT_PX,
  POPULATION_FIELD_POINT_SIZE_MAX,
  POPULATION_FIELD_POINT_SIZE_MIN,
  POPULATION_FIELD_SIGMA,
  POPULATION_FIELD_TAPER_FLOOR,
} from '../../src/materials/populationFieldMaterial';

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
    expect(halo.fragmentShader).toContain('gl_FragColor = vec4(tint * a, a);');
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
    expect(material.uniforms.uSizeMin.value).toBe(POPULATION_FIELD_POINT_SIZE_MIN);
    expect(material.uniforms.uSizeMax.value).toBe(POPULATION_FIELD_POINT_SIZE_MAX);
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

  it('carries the body hue at full saturation, at BOTH ends of the ramp', () => {
    // Identity hue is banned: we know nothing about these Cells individually.
    // Desaturating toward grey is what makes a layer read as fog, and the ramp
    // is where that could creep in — a pale lit end is legitimate only while
    // the dim end still carries the body's chroma.
    for (const tint of [POPULATION_FIELD_COLOR_DIM, POPULATION_FIELD_COLOR_LIT]) {
      const [r, g, b] = tint;
      expect(r).toBe(1);
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(0.35);
    }
    // The dim end is the MORE saturated one. Bounded-screen accumulation
    // converges toward the emitted alpha in every channel, so overlap eats
    // chroma; without this the layer's faint half renders as brick.
    const chroma = (t: readonly [number, number, number]) => t[0] - (t[1] + t[2]) / 2;
    expect(chroma(POPULATION_FIELD_COLOR_DIM))
      .toBeGreaterThan(chroma(POPULATION_FIELD_COLOR_LIT) * 1.5);
  });

  it('holds one hue across the ramp, and varies only its chroma', () => {
    // A hue that MOVED along the ramp would be exactly the second colour the
    // ramp exists to remove. Both endpoints are red-dominant with blue over
    // green by a similar margin; only the distance from white differs.
    const lean = (t: readonly [number, number, number]) => t[2] - t[1];
    expect(lean(POPULATION_FIELD_COLOR_DIM)).toBeGreaterThan(0);
    expect(lean(POPULATION_FIELD_COLOR_LIT)).toBeGreaterThanOrEqual(0);
  });

  it('never lets a halo point reach the smallest addressable Cell', () => {
    // `cellPointSize` bottoms out at 1.35 * 0.58 = 0.783 for an untagged Cell
    // at minimum morphology. The ceiling is the invariant; the range under it
    // is what stops the two populations reading as two classes.
    const SMALLEST_CELL = 1.35 * 0.58;
    expect(POPULATION_FIELD_POINT_SIZE_MAX).toBeLessThan(SMALLEST_CELL);
    expect(populationPointSizeForWeight(1)).toBe(POPULATION_FIELD_POINT_SIZE_MAX);
    expect(populationPointSizeForWeight(0)).toBe(POPULATION_FIELD_POINT_SIZE_MIN);
    // And it is a real spread, not a ceiling with nothing under it — a value
    // nothing ever approaches is what guaranteed the gap in the first place.
    expect(POPULATION_FIELD_POINT_SIZE_MAX / POPULATION_FIELD_POINT_SIZE_MIN)
      .toBeGreaterThan(1.4);
  });

  it('tapers monotonically, and clamps outside the unit range', () => {
    for (const fn of [populationPointSizeForWeight, populationTaperForWeight]) {
      expect(fn(0.5)).toBeGreaterThan(fn(0));
      expect(fn(1)).toBeGreaterThan(fn(0.5));
      expect(fn(-1)).toBe(fn(0));
      expect(fn(2)).toBe(fn(1));
    }
    expect(populationTaperForWeight(1)).toBe(1);
    expect(populationTaperForWeight(0)).toBe(POPULATION_FIELD_TAPER_FLOOR);
    const dim = populationTintForWeight(0);
    const lit = populationTintForWeight(1);
    expect([...dim]).toEqual([...POPULATION_FIELD_COLOR_DIM]);
    expect([...lit]).toEqual([...POPULATION_FIELD_COLOR_LIT]);
    expect(populationTintForWeight(0.5)[1])
      .toBeCloseTo((dim[1] + lit[1]) / 2, 6);
  });

  it('keeps the PEAK taper gentler than the flux taper', () => {
    // Size and brightness ride one weight and compound. A large peak ratio
    // would make the outer halo read as a separate dim layer; the flux ratio
    // is what carries the taper, and it comes from the footprint.
    const flux = (populationPointSizeForWeight(0) / populationPointSizeForWeight(1)) ** 2
      * populationTaperForWeight(0);
    expect(populationTaperForWeight(0)).toBeGreaterThan(0.7);
    expect(flux).toBeLessThan(0.5);
  });
});

describe('the sprite footprint', () => {
  it('follows the inverse-distance law', () => {
    const near = populationPointFootprint(POPULATION_FIELD_POINT_SIZE_MAX, 1600, 100);
    const far = populationPointFootprint(POPULATION_FIELD_POINT_SIZE_MAX, 1600, 200);
    expect(near / far).toBeCloseTo(2, 6);
  });

  it('is a few device pixels at the production camera', () => {
    // Camera [110, 108, 110] looking at the origin is ~189 world units out;
    // a 1080p canvas at DPR 2 is 2160 drawing-buffer pixels tall.
    const px = populationPointFootprint(POPULATION_FIELD_POINT_SIZE_MIN, 2160, 189);
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

describe('the amount curve reaches the picture undistorted', () => {
  it('is silent when the stage covers its scope', () => {
    expect(populationEmissionForGain(0)).toBe(0);
    expect(populationEmissionForGain(-1)).toBe(0);
    expect(populationEmissionForGain(Number.NaN)).toBe(0);
  });

  it('undoes the blend square so light tracks the amount, not its square', () => {
    // An isolated point contributes `colour * a * a`; only a saturated patch
    // converges to `a`. Feeding gain straight into `a` made rendered light go
    // as the square of the amount, and at retained scope (gain 0.17) that lit
    // 485 of the field's 7,900 cells — indistinguishable from absence, which
    // is this layer's named default failure.
    const retained = populationEmissionForGain(0.17);
    const mainnet = populationEmissionForGain(0.58);
    expect((retained * retained) / (mainnet * mainnet)).toBeCloseTo(0.17 / 0.58, 6);
  });

  it('never passes its ceiling, whatever the amount', () => {
    expect(populationEmissionForGain(1)).toBeCloseTo(POPULATION_FIELD_EMISSION, 6);
    expect(populationEmissionForGain(50)).toBeCloseTo(POPULATION_FIELD_EMISSION, 6);
  });

  it('keeps the two profiles apart', () => {
    // Mainnet R is 123 and testnet 1,574; the curve exists to make those two
    // read differently, and a mapping that flattened them would erase it.
    expect(populationEmissionForGain(0.89))
      .toBeGreaterThan(populationEmissionForGain(0.58) * 1.15);
  });
});
