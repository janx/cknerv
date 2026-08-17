import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  makePopulationCompositeMaterial,
  makePopulationDensityMaterial,
  POPULATION_FIELD_BLOOM_MS,
  POPULATION_FIELD_CONTINUUM_FRACTION,
  POPULATION_FIELD_EMISSION_PEAK,
  POPULATION_FIELD_MAX_BLOOMS,
  POPULATION_FIELD_SLAB_HALF_Y,
  POPULATION_FIELD_SPECK_FLOOR,
  POPULATION_FIELD_SPECK_GAIN,
  POPULATION_FIELD_SPECK_PX,
  populationSwarmEmission,
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

    // rho = density * N(y; foldY, thickness), then alpha = 1 - exp(-tau).
    // All three parts have to be in the shader, or the medium stops being the
    // same law the Cells are placed by.
    expect(material.fragmentShader).toContain('exp(-0.5 * dy * dy)');
    expect(material.fragmentShader).toContain('1.0 - exp(-tau');
    // The Gaussian's normalization is the part that is easy to drop and hard
    // to see: without it a column integrates to density * thickness, so the
    // medium overstates itself by up to 3.5x exactly where the tissue is
    // thickest — which is also where its own ridge term makes it densest.
    expect(material.fragmentShader)
      .toContain('(density / safeThickness) * exp(-0.5 * dy * dy)');
  });

  it('stays within the eight-step march budget', () => {
    const material = makePopulationDensityMaterial();
    expect(material.uniforms.uSteps.value).toBeLessThanOrEqual(8);
  });

  it('dithers the march so a fixed offset cannot band', () => {
    const material = makePopulationDensityMaterial();
    expect(material.fragmentShader).toContain('hash21(gl_FragCoord.xy)');
  });

  it('guards the slab divisor against an exactly axis-aligned ray', () => {
    const material = makePopulationDensityMaterial();

    // GLSL sign() is 0 at zero, so `sign(rd) * max(abs(rd), eps)` leaves the
    // zero it was meant to remove. An edge-on camera produces exactly that
    // ray, and the result is a division by zero in the intersection.
    expect(material.fragmentShader).not.toContain('sign(rd)');
    expect(material.fragmentShader).toContain('step(vec3(0.0), rd) * 2.0 - 1.0');
  });

  it('starts with no optical depth, so absence is the default state', () => {
    const material = makePopulationDensityMaterial();
    expect(material.uniforms.uOpticalDepth.value).toBe(0);
    expect(material.uniforms.uField.value).toBeNull();
  });
});

describe('makePopulationCompositeMaterial', () => {
  it('emits beneath the Cells and never covers them', () => {
    const material = makePopulationCompositeMaterial();

    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    // Depth-testing a back face would erase the swarm wherever something
    // opaque sat behind it. Emission, not depth, is what keeps the chain
    // layer visible THROUGH the population.
    expect(material.depthTest).toBe(false);

    // Rule 12, as blend state. Alpha-over is what shipped and what draped the
    // galaxy in white fog: it multiplies the destination by `1 - a`, so every
    // nonzero alpha lifts true black toward the tint across the whole
    // envelope — the optical signature of atmosphere between viewer and
    // subject. Bounded screen accumulation cannot do that.
    expect(material.blending).not.toBe(THREE.NormalBlending);
    expect(material.blending).toBe(THREE.CustomBlending);
    expect(material.blendEquation).toBe(THREE.AddEquation);
    expect(material.blendSrc).toBe(THREE.OneFactor);
    expect(material.blendDst).toBe(THREE.OneMinusSrcColorFactor);
    // The destination factor is what carries the promise. It must reach 1
    // when the source is zero, so an unlit pixel is left byte-identical, and
    // it must never be a function of source ALPHA, which is the form that
    // darkens.
    expect(material.blendDst).not.toBe(THREE.OneMinusSrcAlphaFactor);
  });

  it('writes the Cells\' own light, on the Cells\' own curve', () => {
    const material = makePopulationCompositeMaterial();

    expect(material.toneMapped).toBe(false);
    // `cellHybridMaterial` writes its palette values straight to the
    // framebuffer with no encode. Encoding here would put the swarm on a
    // second gamma curve and lift body rose from rgb(255,102,112) to
    // rgb(255,170,177) — a pale pink where the Cells are crimson, which is
    // half of how the first build came out looking like fog. "The same light"
    // is a pixel-level claim and this is where it is kept.
    expect(material.fragmentShader)
      .not.toContain('#include <colorspace_fragment>');
  });

  it('locks the swarm to the screen, never to the world', () => {
    const material = makePopulationCompositeMaterial();

    // The speck cell index comes from gl_FragCoord, so its frequency is fixed
    // to the display: flying closer spreads the population without ever
    // making one of its members larger or countable. World-space grain is the
    // rejected alternative precisely because it does resolve.
    expect(material.fragmentShader)
      .toContain('floor(gl_FragCoord.xy / max(uSpeckPx');
    expect(material.uniforms.uSpeckPx.value).toBe(POPULATION_FIELD_SPECK_PX);
    expect(POPULATION_FIELD_SPECK_PX).toBeGreaterThanOrEqual(1.5);
    expect(POPULATION_FIELD_SPECK_PX).toBeLessThanOrEqual(2.5);
  });

  it('reseeds each speck on its own phase, never the field in lockstep', () => {
    const material = makePopulationCompositeMaterial();

    // A whole-field re-roll on one frame is what makes noise read as TV
    // static. The per-cell offset spreads the reseed instants uniformly
    // across the period, so the same rate reads as scintillation instead.
    expect(material.fragmentShader).toContain('float jitter = hash21(cell');
    expect(material.fragmentShader)
      .toContain('floor(uSwarmPhase + jitter)');
    // Frozen deterministically rather than by a separate code path: phase
    // zero is a legal value of the same expression.
    expect(material.uniforms.uSwarmPhase.value).toBe(0);
  });

  it('carries the population in the speck COUNT, not in a wash', () => {
    const material = makePopulationCompositeMaterial();

    // The mask threshold against the local fraction is the entire population
    // statement. A luminance modulation of a continuous term is the rejected
    // alternative — noise on fog is still fog.
    expect(material.fragmentShader).toContain('step(pick, amount)');
    expect(material.uniforms.uContinuum.value)
      .toBe(POPULATION_FIELD_CONTINUUM_FRACTION);
    expect(material.uniforms.uSpeckGain.value)
      .toBe(POPULATION_FIELD_SPECK_GAIN);
    expect(material.uniforms.uSpeckFloor.value)
      .toBe(POPULATION_FIELD_SPECK_FLOOR);
    expect(material.uniforms.uPeak.value)
      .toBe(POPULATION_FIELD_EMISSION_PEAK);
    // The continuum exists so dense tissue reads solid rather than dotted; if
    // it ever carried most of the emission the layer would be a wash again.
    expect(POPULATION_FIELD_CONTINUUM_FRACTION).toBeLessThan(0.35);
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

  it('keeps blooms inside the population instead of floating in vacuum', () => {
    const material = makePopulationCompositeMaterial();
    const shader = material.fragmentShader;

    // A bloom is scaled by the population it sits in; one in empty space
    // would read as an object rather than as a transition within a crowd.
    expect(shader).toContain('max(field, 0.12)');
    // That floor is exactly what makes the gate below load-bearing: it keeps
    // a bloom legible in faint tissue, and would just as happily paint one
    // where there is no tissue at all. The discard has to come FIRST.
    expect(shader.indexOf('if (field <= 0.0015) discard;'))
      .toBeLessThan(shader.indexOf('if (i >= uBloomCount) break;'));
  });

  it('cannot lift a pixel with no population under it', () => {
    const material = makePopulationCompositeMaterial();

    // Rule 12, and the test the shipped build would have failed. Empty space
    // must stay exactly black: the layer is gated on the density term ALONE,
    // before the blooms are even read, so nothing downstream — a transition
    // mark, a continuum floor, a speck — can put light where the field is
    // zero.
    expect(material.fragmentShader).toContain('if (field <= 0.0015) discard;');
    for (const pick of [0, 0.25, 0.5, 0.75, 0.999]) {
      for (const spread of [0, 0.5, 1]) {
        expect(populationSwarmEmission(0, pick, spread)).toBe(0);
      }
    }
    // And a field that is merely faint may not be lifted to a wash either.
    expect(populationSwarmEmission(0.01, 0, 1)).toBeLessThan(0.02);
  });

  it('takes the body hue at full saturation, and no identity hue', () => {
    const material = makePopulationCompositeMaterial();
    const tint = material.uniforms.uTint.value as THREE.Color;
    const [r, g, b] = CELL_GALAXY_PALETTE.tissueRose;

    // Rule 11 pulls both ways at once and the previous build resolved it the
    // wrong way. BODY hue is REQUIRED: the resolved and the unresolved are
    // the same kind of thing separated by resolution alone, and unresolved
    // starlight is the same light as its stars. IDENTITY hue is banned: an
    // asset, lock or tag palette would make an aggregate look like a claim
    // about which Cells it contains.
    expect(tint.r).toBeCloseTo(r, 6);
    expect(tint.g).toBeCloseTo(g, 6);
    expect(tint.b).toBeCloseTo(b, 6);

    // The desaturation this replaces was a quarter of the way to grey, and
    // grey over a coloured scene is atmospheric perspective — the eye has
    // exactly one word for it. Saturation must not be trimmed at all.
    const bodySaturation = Math.max(r, g, b) - Math.min(r, g, b);
    const tintSaturation = Math.max(tint.r, tint.g, tint.b)
      - Math.min(tint.r, tint.g, tint.b);
    expect(tintSaturation).toBeCloseTo(bodySaturation, 6);

    // No identity palette may leak in, whatever its saturation.
    for (const [name, colour] of Object.entries(CELL_GALAXY_PALETTE)) {
      if (name === 'tissueRose') continue;
      expect([tint.r, tint.g, tint.b]).not.toEqual([...colour]);
    }
  });

  it('never emits a negative term, at any draw', () => {
    // A grain that dips below its base level paints dark speckles, and dirt
    // is not a population. This was the fourth cause of the first build
    // reading as fog: noise applied as a plus-or-minus modulation.
    for (let i = 0; i <= 20; i += 1) {
      const litFraction = i / 20;
      for (const pick of [0, 0.3, 0.6, 0.9, 0.999]) {
        for (const spread of [0, 0.5, 1]) {
          expect(populationSwarmEmission(litFraction, pick, spread))
            .toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('keeps peak speck brightness under a resolved Cell core', () => {
    const material = makePopulationCompositeMaterial();
    const tint = material.uniforms.uTint.value as THREE.Color;
    const luma = (r: number, g: number, b: number) =>
      0.2126 * r + 0.7152 * g + 0.0722 * b;

    // The brightest a speck can be: a fully lit cell in the densest tissue,
    // at the top of the brightness spread.
    const peak = populationSwarmEmission(1, 0, 1) * POPULATION_FIELD_EMISSION_PEAK;
    const speckLuma = luma(tint.r * peak, tint.g * peak, tint.b * peak);

    // A far Cell's core is warmWhite mixed 0.72 into its body colour at unit
    // peak. Figure/ground is carried by THIS, not by a veil pushed in front
    // of the population: same light, different resolution, and the resolved
    // one is the brighter.
    const [wr, wg, wb] = CELL_GALAXY_PALETTE.warmWhite;
    const [br, bg, bb] = CELL_GALAXY_PALETTE.tissueRose;
    const mix = (a: number, b2: number) => a + (b2 - a) * 0.72;
    const coreLuma = luma(mix(br, wr), mix(bg, wg), mix(bb, wb));

    expect(speckLuma).toBeLessThan(coreLuma);
    // And by a clear margin, not by a rounding error — a patch of swarm must
    // not be mistakable for a Cell even where the two touch.
    expect(speckLuma).toBeLessThan(coreLuma * 0.65);
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
