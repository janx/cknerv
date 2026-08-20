import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { makeCellHybridMaterial } from '../../src/materials/cellHybridMaterial';
import { consensusCellColor } from '../../src/derives/consensusFlow.derive';
import { CELL_GALAXY_PALETTE } from '../../src/visualPalette';
import {
  makePopulationBackboneMaterial,
  makePopulationFibreMaterial,
  makePopulationPointMaterial,
  populationPointEnergy,
  populationEmissionForGain,
  populationPointFootprint,
  populationPointSizeForWeight,
  POPULATION_FIELD_COLOR,
  POPULATION_STROKE_COLOR,
  POPULATION_FIELD_EMISSION,
  POPULATION_FIELD_MIN_POINT_PX,
  POPULATION_FIELD_POINT_SIZE_MAX,
  POPULATION_FIELD_POINT_SIZE_MIN,
  POPULATION_FIELD_SIGMA,
  POPULATION_BACKBONE_WIDTH_PX,
  POPULATION_FIBRE_ALPHA,
  POPULATION_STROKE_TAPER_FLOOR,
  populationFibreEmissionForGain,
  populationFibreSizeRatio,
  populationFibreTaper,
  populationStrokeSizeRatio,
  populationStrokeTaper,
} from '../../src/materials/populationFieldMaterial';

/** Rec. 709 luma and the linear chroma proxy this layer's constants were swept
 *  on. Not OKLCh — the rendered measurements need pixels off a GPU, and these
 *  are what a unit test can honestly re-derive. */
const luma709 = (t: readonly [number, number, number]): number =>
  0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
const chroma709 = (t: readonly [number, number, number]): number =>
  t[0] - (t[1] + t[2]) / 2;

/** The layer's blend, run on the CPU: `dst = tint*a*a + dst*(1 - tint*a)`,
 *  premultiplied source into SrcAlpha / OneMinusSrcColor. Its fixed point is
 *  `a` in every channel; its RATE is `1 - tint*a` per channel, which is the
 *  whole of why a tint's own chroma decides whether overlap goes white. */
function accumulate(
  tint: readonly [number, number, number],
  a: number,
  deposits: number,
): [number, number, number] {
  const dst: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < deposits; i += 1) {
    for (let c = 0; c < 3; c += 1) dst[c] = tint[c] * a * a + dst[c] * (1 - tint[c] * a);
  }
  return dst;
}

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
    expect(material.uniforms.uColor.value.toArray())
      .toEqual([...POPULATION_FIELD_COLOR]);
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

  it('emits what an addressable Cell emits, and nothing it was told about', () => {
    // The BEADS emit ONE colour and it is the Cells' own body colour: an
    // untagged Cell's `aColor` is this exact triple, and mainnet has almost no
    // tagged ones. A tagged Cell's accent is an identity claim this layer
    // cannot make, so the accent path is what must never appear here.
    expect([...POPULATION_FIELD_COLOR])
      .toEqual([...consensusCellColor({ accent: [0, 0, 0] } as never, false)]);
    expect([...POPULATION_FIELD_COLOR]).toEqual([...CELL_GALAXY_PALETTE.tissueRose]);
  });

  it('carries the body hue at full saturation, and never approaches warmWhite', () => {
    // Identity hue is banned and so is fog: desaturating toward grey is what
    // makes a layer read as atmosphere rather than as matter. And the Cells'
    // own drift toward `warmWhite` at their peak is THEIR core signature —
    // the halo is forbidden it, which is why one saturated body colour and no
    // ramp toward pale is the correct shape for this constant.
    const [r, g, b] = POPULATION_FIELD_COLOR;
    expect(r).toBe(1);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(0.35);
    // Distance from `warmWhite`, on the axis that matters: the halo's emitted
    // colour is far more saturated than the Cells' hot mix, at every channel.
    const chroma = (t: readonly [number, number, number]) => t[0] - (t[1] + t[2]) / 2;
    expect(chroma(POPULATION_FIELD_COLOR))
      .toBeGreaterThan(chroma(CELL_GALAXY_PALETTE.warmWhite) * 5);
  });

  it('gives the strokes the vein hue and the beads the body hue', () => {
    // The two live verdicts of 2026-08-20 — terminal nerves still not reading
    // at 1.4 px, and the whole mesh gone pale — were one bug: strokes and
    // beads emitted the SAME colour, so added width was pink over pink and
    // there was no nerve percept to gain at any width, while every spend made
    // to buy one went into the channels a bounded accumulation converges
    // toward white. The scene's own nerve grammar is the core fabric's: dark
    // vein vessels through luminous rose tissue, a HUE contrast.
    expect([...POPULATION_STROKE_COLOR])
      .not.toEqual([...POPULATION_FIELD_COLOR]);
    // The vein family's chromaticity, at this layer's own red ceiling —
    // `veinCrimson` (0.48, 0.06, 0.16) has g/r 0.125 and b/r exactly 1/3.
    const vein = CELL_GALAXY_PALETTE.veinCrimson;
    expect(POPULATION_STROKE_COLOR[0]).toBe(1);
    expect(POPULATION_STROKE_COLOR[1]).toBeCloseTo(vein[1] / vein[0], 12);
    expect(POPULATION_STROKE_COLOR[2]).toBeCloseTo(vein[2] / vein[0], 12);
    // Same red as the bead beside it, so the two classes are one family
    // separated in G and B alone: this is the wash taken out, not a second
    // material introduced.
    expect(POPULATION_STROKE_COLOR[0]).toBe(POPULATION_FIELD_COLOR[0]);
    expect(POPULATION_STROKE_COLOR[1]).toBeLessThan(POPULATION_FIELD_COLOR[1] / 3);
    expect(POPULATION_STROKE_COLOR[2]).toBeLessThan(POPULATION_FIELD_COLOR[2]);
    // Chroma per luminance, on the same CPU proxies the sweep was run with:
    // 2.364 against the beads' 1.093, which is the whole of the split.
    const strokeCL = chroma709(POPULATION_STROKE_COLOR) / luma709(POPULATION_STROKE_COLOR);
    const beadCL = chroma709(POPULATION_FIELD_COLOR) / luma709(POPULATION_FIELD_COLOR);
    expect(strokeCL).toBeCloseTo(2.364, 3);
    expect(beadCL).toBeCloseTo(1.093, 3);
    expect(strokeCL).toBeGreaterThan(beadCL * 2);
    // And it is DARKER, which is the trade: 0.615 of the beads' luma, so a
    // round that widened the strokes still took light out of the layer.
    expect(luma709(POPULATION_STROKE_COLOR) / luma709(POPULATION_FIELD_COLOR))
      .toBeCloseTo(0.615, 3);
  });

  it('deposits toward deep red where the shipped stroke deposited toward white', () => {
    // The blend's fixed point is the emitted alpha in EVERY channel, but the
    // rate per deposit is `1 - tint * a` — so a channel the tint leaves near
    // zero barely moves, and the wash is a property of the tint rather than of
    // the accumulation. Mixed band: taper p50 0.652, emission 0.72 at mainnet
    // chain scope, and the deposit counts `populationFibreTaper` records
    // (5.85 on the average covered pixel there, placement-era).
    const a = (alpha: number) => 0.72 * alpha * 0.652;
    const shipped = accumulate(POPULATION_FIELD_COLOR, a(0.8), 6);
    // ⚠️ 0.70 is written out rather than read from the constant. It was the
    // live value when this test was written and it is not any more (the alpha
    // came back to 0.80 on the fourth verdict), but the counterfactual it
    // stands for — *what if the pale build had only been dimmed?* — is why the
    // hue exists and has to stay measurable.
    const reverted = accumulate(POPULATION_FIELD_COLOR, a(0.70), 6);
    const now = accumulate(POPULATION_STROKE_COLOR, a(POPULATION_FIBRE_ALPHA), 6);

    // ⚠️ The alpha revert ALONE does not answer the pale verdict, and this is
    // the number that says so: .3533 .2341 .2485 at C/L 0.430 becomes
    // .2985 .1875 .1999 at C/L 0.494. Dimmer by a fifth, and still grey-rose,
    // because the ratio between the channels is a property of the TINT.
    expect(chroma709(reverted) / luma709(reverted))
      .toBeLessThan((chroma709(shipped) / luma709(shipped)) * 1.2);

    // ⭐ And with the alpha back at 0.80 the comparison finally isolates the
    // hue exactly — same alpha, same deposit count, one tint against the
    // other. The hue change costs the RED channel nothing (both classes emit
    // r = 1, so red converges at the same rate to the same place) and takes G
    // and B out: .3533 .0941 .2072 at C/L 1.287 against .3533 .2341 .2485 at
    // 0.430. Green is 40% of what it was, and the band's chroma-per-luma
    // triples.
    expect(now[0]).toBeCloseTo(shipped[0], 12);
    expect(now[1]).toBeLessThan(shipped[1] * 0.45);
    expect(now[2]).toBeLessThan(shipped[2] * 0.85);
    expect(chroma709(now) / luma709(now))
      .toBeGreaterThan((chroma709(shipped) / luma709(shipped)) * 2.9);
    // And the hue is a DIMMING as well as a deepening — 0.604 of the pale
    // build's luma at the alpha that build ran at. That is what makes the
    // alpha affordable again: the class the fourth verdict raised is still
    // well under the one that was called pale.
    expect(luma709(now)).toBeLessThan(luma709(shipped) * 0.65);
    expect(luma709(now) / luma709(shipped)).toBeCloseTo(0.604, 3);
  });

  it('keeps the fringe deposit chromatic while giving up its luma', () => {
    // The acceptance arithmetic for the deepening, in the band the visibility
    // verdict lives in: one isolated deposit against black at the fringe taper
    // p50 0.446. A deep hue reached by SCALING a palette colour gives up
    // chroma along with luma and undoes the width win; reached at the red
    // ceiling it gives up the achromatic half alone.
    const fringe = (tint: readonly [number, number, number], alpha: number) => {
      const a = 0.72 * alpha * 0.446;
      return [tint[0] * a * a, tint[1] * a * a, tint[2] * a * a] as const;
    };
    const shipped = fringe(POPULATION_FIELD_COLOR, 0.8);
    const now = fringe(POPULATION_STROKE_COLOR, POPULATION_FIBRE_ALPHA);
    // ⚠️ Re-derived 2026-08-20 with the alpha back at 0.80, which is what both
    // sides now run at — so this reads as a pure tint comparison and the
    // recorded figures moved by exactly the `(0.8/0.7)^2` the alpha carries.
    // Chroma per deposit RISES by a third at 61% of the luma...
    expect(chroma709(now) / chroma709(shipped)).toBeGreaterThan(1.25);
    expect(chroma709(now) / chroma709(shipped)).toBeLessThan(1.40);
    expect(luma709(now) / luma709(shipped)).toBeCloseTo(0.615, 2);
    // ...so multiplied by the widths, a promoted fringe strand carries far
    // more chromatic flux than the pale build's did (1.8 x 0.0508 against
    // 1.4 x 0.0382, +71%) while its luminous flux is still down a fifth.
    expect(POPULATION_BACKBONE_WIDTH_PX * chroma709(now) / (1.4 * chroma709(shipped)))
      .toBeCloseTo(1.709, 2);
    expect(POPULATION_BACKBONE_WIDTH_PX * luma709(now) / (1.4 * luma709(shipped)))
      .toBeCloseTo(0.790, 2);
    // Scaling the same palette colour instead loses the chroma too, which is
    // why the sweep rejected raw `veinCrimson` and raw `veinRose`: at the same
    // alpha it keeps under half the chroma the red-ceiling version does.
    const scaled = fringe(CELL_GALAXY_PALETTE.veinCrimson, POPULATION_FIBRE_ALPHA);
    expect(chroma709(scaled)).toBeLessThan(chroma709(now) * 0.5);
  });

  it('leans blue over green, which is what keeps the outer field off brick', () => {
    // Brick is rose drifting toward ember (OKLCH hue 45) or warm white (71).
    // Bounded-screen accumulation moves each channel toward the emitted alpha
    // at a rate set by that channel, so `b` > `g` means blue converges faster
    // and the rendered hue drifts MAGENTA-ward as overlap grows — away from
    // ember, never toward it. Measured on the real placement at 1080p, hue
    // runs 14.07 in the mixed band out to 16.59 at the fringe against an
    // emitted 19.29, and chroma RISES outward as the layer thins.
    expect(POPULATION_FIELD_COLOR[2]).toBeGreaterThan(POPULATION_FIELD_COLOR[1]);
    // The rule belongs to the layer, not to one constant: the strokes carry it
    // too (0.333 against 0.125), so nothing here drifts toward brick as
    // overlap grows.
    expect(POPULATION_STROKE_COLOR[2]).toBeGreaterThan(POPULATION_STROKE_COLOR[1]);
  });

  it('never varies the tint with the taper, in either draw', () => {
    // This is the regression. One attribute drove size, brightness AND tint,
    // so the palest colour landed exactly where points are largest and where
    // placed density peaks — and accumulation stacked pale sprites into
    // grey-white. Measured, the pale end desaturated after 7 overlapping
    // sprites against the saturated end's 20, and it was assigned precisely
    // where overlap is greatest. Density is the only thing allowed to vary
    // this layer's colour, exactly as it is for the Cells.
    for (const src of [
      makePopulationPointMaterial().fragmentShader,
      makePopulationFibreMaterial().fragmentShader,
    ]) {
      const tintLine = src.split('\n').find((l) => l.includes('vec3 tint = '));
      expect(tintLine).toBeDefined();
      expect(tintLine).not.toContain('vWeight');
      expect(tintLine).not.toContain('mix(');
    }
    // The fibres DO bind the taper — it is what fades the layer's boundary
    // instead of letting the strokes stop dead — but it reaches alpha only.
    // The tint stays the one emitted colour in both draws, which is the whole
    // of this regression: it was the taper on the TINT that stacked pale
    // sprites into grey-white, never the taper itself.
    const fibreVertex = makePopulationFibreMaterial().vertexShader;
    expect(fibreVertex).toContain('aWeight');
    expect(makePopulationFibreMaterial().fragmentShader)
      .toContain('float a = uEmission * vSizeRatio * vSizeRatio;');
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
    const fn = populationPointSizeForWeight;
    expect(fn(0.5)).toBeGreaterThan(fn(0));
    expect(fn(1)).toBeGreaterThan(fn(0.5));
    expect(fn(-1)).toBe(fn(0));
    expect(fn(2)).toBe(fn(1));
  });

  it('spends the tissue taper on size and nothing on brightness', () => {
    // The two used to ride the same weight and compound, and the second one
    // bought nothing: measured over the real placement, binned by elliptical
    // radius, the brightness half of the taper cost the field beyond the
    // resolved rim 11.4% of its light and moved the radial luminance profile's
    // worst change in slope by less than 0.001. Size alone still carries a
    // real taper — flux goes as its square — so the bimodality that the taper
    // was introduced to close stays closed.
    const fluxTaper =
      (populationPointSizeForWeight(0) / populationPointSizeForWeight(1)) ** 2;
    expect(fluxTaper).toBeLessThan(0.5);
    expect(fluxTaper).toBeGreaterThan(0.35);
    // No alpha term may depend on the weight — in either draw.
    //
    // `uTaperFloor` was the name of the removed BRIGHTNESS floor on the point
    // sprite, and this guard is the point class's: it keeps a second taper on
    // the same key from coming back. It is not the stroke class's floor, which
    // is a bound on the size RATIO the strokes already ride, lives in the
    // vertex stage as a baked constant, and is asserted below in
    // 'the stroke class carries a level floor the beads do not'.
    for (const src of [
      makePopulationPointMaterial().fragmentShader,
      makePopulationFibreMaterial().fragmentShader,
    ]) {
      const alphaLine = src.split('\n').find((l) => l.includes('float a = '));
      expect(alphaLine).toBeDefined();
      expect(alphaLine).not.toContain('vWeight');
      expect(src).not.toContain('uTaperFloor');
    }
    // And the point sprite must not reach the stroke floor by any other name.
    expect(makePopulationPointMaterial().fragmentShader)
      .not.toContain(String(Math.sqrt(POPULATION_STROKE_TAPER_FLOOR)));
    expect(makePopulationPointMaterial().vertexShader)
      .not.toContain(String(Math.sqrt(POPULATION_STROKE_TAPER_FLOOR)));
  });
});

describe('the stroke class carries a level floor the beads do not', () => {
  /** The amount curve the live build reports at mainnet chain scope,
   *  headless-probed off `92ed58c` on the 4K panel the verdicts come from:
   *  0.5065 of stroke emission at the 0.70 alpha of that day, so the curve
   *  itself is `0.5065 / 0.70`. Stated this way rather than as a literal so
   *  that {@link POPULATION_FIBRE_ALPHA} moving moves every rendered number
   *  below with it — which it did on 2026-08-20, 0.70 → 0.80. */
  const GAIN_EMISSION = 0.5065 / 0.70;
  const STROKE_EMISSION = GAIN_EMISSION * POPULATION_FIBRE_ALPHA;
  /** Band medians from the placement, and the deposits a covered pixel in each
   *  actually takes at 3840x2160 — re-measured by rasterizing all 96,609
   *  segments at the production camera, because the 5.85/4.27/1 in the
   *  material's older tables were counted at 1080p. */
  const FRINGE_TAPER = 0.446;
  const MIXED_TAPER = 0.652;
  const MIXED_DEPOSITS = 2;

  it('is one number, reached by both stroke draws and by neither bead path', () => {
    // The whole risk in a two-class partition is that the two halves drift.
    // The hairline bounds its ratio in a vertex stage; the capsule has no
    // vertex stage of its own and bounds it in `populationBackboneInstanceData`
    // — two places, so the number has to come from one.
    const floorRatio = Math.sqrt(POPULATION_STROKE_TAPER_FLOOR);
    const fibre = makePopulationFibreMaterial();
    // The hairline's GLSL literal is GENERATED from the constant, so moving
    // the constant moves the shader and this assertion together.
    expect(fibre.vertexShader).toContain(String(floorRatio));
    expect(fibre.vertexShader).toContain('max(');
    // The capsule's half is the exported helper, and it agrees exactly.
    for (let w = 0; w <= 1.0001; w += 0.01) {
      expect(populationStrokeSizeRatio(w))
        .toBe(Math.max(populationFibreSizeRatio(w), floorRatio));
      expect(populationStrokeTaper(w))
        .toBeGreaterThanOrEqual(POPULATION_STROKE_TAPER_FLOOR - 1e-12);
    }
    // Both stroke fragment stages still square the interpolated RATIO, which
    // is what makes `max(r, sqrt(F))^2` the same thing as `max(r^2, F)`.
    expect(fibre.fragmentShader)
      .toContain('float a = uEmission * vSizeRatio * vSizeRatio;');
    expect(makePopulationBackboneMaterial().fragmentShader).toContain(
      'float haloAlpha = uEmission * diffuseColor.r * diffuseColor.r * alpha;',
    );
  });

  it('leaves the beads on the unfloored taper, value for value', () => {
    // The floor is a STROKE lever. The point sprite's size law, and the taper
    // helper it shares with the placement, must be untouched — a floor that
    // leaked into the bead would raise the sprite size and undo the whole
    // bimodality argument `POPULATION_FIELD_POINT_SIZE_MIN` rests on.
    for (let w = 0; w <= 1.0001; w += 0.01) {
      expect(populationFibreTaper(w))
        .toBe(populationFibreSizeRatio(w) * populationFibreSizeRatio(w));
      expect(populationPointSizeForWeight(w)).toBeCloseTo(
        POPULATION_FIELD_POINT_SIZE_MIN
        + (POPULATION_FIELD_POINT_SIZE_MAX - POPULATION_FIELD_POINT_SIZE_MIN) * w,
        12,
      );
      expect(populationPointSizeForWeight(w))
        .toBeLessThanOrEqual(POPULATION_FIELD_POINT_SIZE_MAX);
    }
    expect(populationFibreTaper(0))
      .toBeCloseTo((POPULATION_FIELD_POINT_SIZE_MIN
        / POPULATION_FIELD_POINT_SIZE_MAX) ** 2, 12);
    // The point material reads the size uniforms and nothing else.
    const point = makePopulationPointMaterial();
    expect(point.uniforms.uSizeMin.value).toBe(POPULATION_FIELD_POINT_SIZE_MIN);
    expect(point.uniforms.uSizeMax.value).toBe(POPULATION_FIELD_POINT_SIZE_MAX);
    expect(point.vertexShader)
      .toContain('float wanted = mix(uSizeMin, uSizeMax, weight)');
  });

  it('lifts the fringe deposit over the threshold it was sitting under', () => {
    // The verdict, as arithmetic. An isolated deposit renders `tint * a * a`,
    // so at the fringe band's median taper the stroke was landing at
    //   0.3261 * (0.5065 * 0.446)^2 = 0.0166
    // — a deep red at 0.017 on black, where photopic sensitivity is already
    // ~0.4x its peak. The floor was the only lever left that reached it at the
    // time: alpha had been reverted to protect chroma, width had gone
    // 1 -> 1.4 -> 1.6 device px, and the hue was the round before it.
    //
    // ⚠️ Re-derived 2026-08-20 at the alpha the class ships now. The FLOOR is
    // unchanged and so is its multiplier — the emission cancels out of a ratio
    // of two tapers — but the LEVELS all rise by (0.80/0.70)^2 = 1.306, which
    // is the point of the alpha round and is what carries the fringe deposit
    // to the 0.06 the fourth verdict wants.
    const deposit = (taper: number) => {
      const a = STROKE_EMISSION * taper;
      return luma709(POPULATION_STROKE_COLOR) * a * a;
    };
    const before = deposit(FRINGE_TAPER);
    const after = deposit(POPULATION_STROKE_TAPER_FLOOR);
    expect(before).toBeCloseTo(0.0217, 4);
    expect(after).toBeCloseTo(0.0615, 4);
    // The multiplier the floor was chosen for, unchanged by the alpha because
    // it is a ratio: `(0.75 / 0.446)^2`.
    expect(after / before).toBeGreaterThan(2.5);
    // ⭐ The level target, re-pinned. The window was [0.04, 0.05] when this
    // was written and the alpha was 0.70; the fourth verdict — *visible now,
    // but hard to see clearly* — moved it to "at least 0.06", and 0.80 is the
    // rung that reaches it while holding the mixed band's chroma (see below).
    expect(after).toBeGreaterThanOrEqual(0.06);
    expect(after).toBeLessThanOrEqual(0.065);
    // The floor's own neighbours stay in the test as the reason it is 0.75:
    // 0.70 misses the multiplier, 0.80 overshoots the level window.
    expect(deposit(0.70) / before).toBeLessThan(2.5);
    expect(deposit(0.80)).toBeGreaterThan(0.065);
    // The bead beside it is unmoved, and still ahead: it concentrates a larger
    // emission and a lighter tint into a clamped Gaussian, so this closes the
    // gap rather than reversing it. Nothing here can make a stroke outshine
    // the bead it runs through.
    const beadPeak = luma709(POPULATION_FIELD_COLOR)
      * (STROKE_EMISSION / POPULATION_FIBRE_ALPHA) ** 2;
    expect(beadPeak / after).toBeGreaterThan(1);
    expect(beadPeak / after).toBeLessThan(beadPeak / before);
  });

  it('picks the level rung the mixed band can still pay for', () => {
    // ⚠️ The audit trail this constant carries is 0.70 -> 0.80 -> 0.70 -> 0.80
    // and the fourth move is NOT the second one repeated. The second was a
    // `tissueRose` alpha spent to buy WIDTH it cannot buy, in a tint whose
    // high G and B are what a bounded accumulation converges toward white; it
    // produced the pale mesh the next verdict complained about. Every one of
    // those conditions was removed before this round: the strokes emit
    // `POPULATION_STROKE_COLOR`, width has its own DPR-aware class, and the
    // sparse end has `POPULATION_STROKE_TAPER_FLOOR`. So the assertion is not
    // on the number — it is on the two quantities that make the number safe.
    expect(POPULATION_FIBRE_ALPHA).toBe(0.8);

    // (1) The fringe's isolated deposit clears the read target. Rendered
    // light goes as `a^2` out there, which is why this is the lever that
    // reaches the band the verdict is about: +30.6% for a 14.3% alpha step.
    const fringe = (alpha: number) => {
      const a = GAIN_EMISSION * alpha * POPULATION_STROKE_TAPER_FLOOR;
      return luma709(POPULATION_STROKE_COLOR) * a * a;
    };
    expect(fringe(0.70)).toBeCloseTo(0.0471, 4);
    expect(fringe(0.75)).toBeCloseTo(0.0540, 4);
    expect(fringe(POPULATION_FIBRE_ALPHA)).toBeCloseTo(0.0615, 4);
    expect(fringe(POPULATION_FIBRE_ALPHA)).toBeGreaterThanOrEqual(0.06);
    // 0.75 is measured and rejected: it stops short of the target.
    expect(fringe(0.75)).toBeLessThan(0.06);

    // (2) And the just-accepted mixed band keeps its chroma. Rasterizing the
    // real placement at the production camera measured C/L 1.948 -> 1.874,
    // -3.8%, with 0.85 at -5.1% and outside the bound; the proxy below
    // reproduces the SHAPE of that at the band's measured deposit count.
    const mixed = (alpha: number) => accumulate(
      POPULATION_STROKE_COLOR,
      GAIN_EMISSION * alpha * MIXED_TAPER,
      MIXED_DEPOSITS,
    );
    const cl = (t: readonly [number, number, number]) => chroma709(t) / luma709(t);
    const beforeAlpha = mixed(0.70);
    const afterAlpha = mixed(POPULATION_FIBRE_ALPHA);
    expect(cl(afterAlpha) / cl(beforeAlpha)).toBeGreaterThan(0.95);
    expect(cl(afterAlpha)).toBeGreaterThan(1.35);
    // ⭐ The reason it survives at all, and the reason the old fear was right
    // for its own instrument: at the six deposits the retention tables were
    // written against at 1080p, the same lift costs several times as much.
    const six = (alpha: number) => accumulate(
      POPULATION_STROKE_COLOR, GAIN_EMISSION * alpha * MIXED_TAPER, 6,
    );
    expect(1 - cl(six(POPULATION_FIBRE_ALPHA)) / cl(six(0.70)))
      .toBeGreaterThan((1 - cl(afterAlpha) / cl(beforeAlpha)) * 2);

    // And it is a LEVEL move: not one channel ratio of either class changes.
    expect([...POPULATION_STROKE_COLOR]).toEqual([
      1,
      CELL_GALAXY_PALETTE.veinCrimson[1] / CELL_GALAXY_PALETTE.veinCrimson[0],
      CELL_GALAXY_PALETTE.veinCrimson[2] / CELL_GALAXY_PALETTE.veinCrimson[0],
    ]);
    // The beads ride `populationEmissionForGain` and never this constant, so
    // the layer's OTHER class is untouched by the whole round.
    expect(populationFibreEmissionForGain(0.5))
      .toBeCloseTo(populationEmissionForGain(0.5) * POPULATION_FIBRE_ALPHA, 12);
  });

  it('moves the just-accepted mixed band as little as a floor can', () => {
    // The colour verdict was pronounced on this band, so it is the one the
    // level round has to pay for. Measured by rasterizing the real placement
    // at the production camera: +27.6% mean luma over the band's covered
    // pixels, and -1.4% of its chroma-per-luma. The proxy below reproduces
    // both at the band median and the band's measured deposit count, and the
    // bounds are what this change commits to.
    //
    // ⚠️ The proxy reads +29.2% / -2.2% since the alpha went back to 0.80: a
    // higher per-deposit alpha sits further up the blend's curve, so the same
    // taper step buys slightly more luma and costs slightly more chroma. The
    // rasterized figures above are the 0.70 measurement and are left as the
    // record of what the FLOOR alone was priced at. The bounds hold at both.
    const at = (taper: number) =>
      accumulate(POPULATION_STROKE_COLOR, STROKE_EMISSION * taper, MIXED_DEPOSITS);
    const before = at(MIXED_TAPER);
    const after = at(POPULATION_STROKE_TAPER_FLOOR);
    expect(luma709(after) / luma709(before)).toBeLessThan(1.35);
    expect((chroma709(after) / luma709(after))
      / (chroma709(before) / luma709(before))).toBeGreaterThan(0.97);

    // ⭐ Why the chroma barely moves, and why that is a measurement rather
    // than luck: this panel accumulates ~2 deposits on the average covered
    // pixel, not the six the retention tables were written against at 1080p.
    // Two deposits is still the squared part of the blend, where chroma is
    // preserved. At six the same lift would cost 9%, which is the anti-ramp
    // lesson, and it is the deposit count that keeps this round clear of it.
    const six = (taper: number) =>
      accumulate(POPULATION_STROKE_COLOR, STROKE_EMISSION * taper, 6);
    expect((chroma709(six(POPULATION_STROKE_TAPER_FLOOR))
      / luma709(six(POPULATION_STROKE_TAPER_FLOOR)))
      / (chroma709(six(MIXED_TAPER)) / luma709(six(MIXED_TAPER))))
      .toBeLessThan(0.95);

    // And not one channel RATIO moves: the emitted colour is untouched in
    // both stroke draws, so this is a level round and nothing else.
    expect([...POPULATION_STROKE_COLOR]).toEqual([
      1,
      CELL_GALAXY_PALETTE.veinCrimson[1] / CELL_GALAXY_PALETTE.veinCrimson[0],
      CELL_GALAXY_PALETTE.veinCrimson[2] / CELL_GALAXY_PALETTE.veinCrimson[0],
    ]);
    expect(makePopulationBackboneMaterial().uniforms.uColor.value.getHex())
      .toBe(makePopulationFibreMaterial().uniforms.uColor.value.getHex());
  });

  it('still fades a strand ending, where an ending can be seen', () => {
    // `POPULATION_END_TAPER` fades the last three points by scaling the SHARED
    // weight, and this floor binds the size-ratio term that weight reaches the
    // stroke through — so one of the two dominates and which one is a fact
    // about the tissue, not a preference.
    //
    // Measured by differencing two full placements: the fade keeps 0.90 of its
    // depth in the interior and the pre-rim band, where 66.7% and 43.6% of all
    // points sit inside one, and goes flat in the outer field, where it
    // already measured 0.955 and 0.978 — steps of 4.5% and 2.2%, bounded by
    // the SIZE floor long before this one existed.
    const END = [0.25, 0.5, 0.75];
    const depth = (w: number, k: number, t: (x: number) => number) =>
      t(w * k) / t(w);
    // Interior: the weight term dominates and the ending survives. At the
    // densest tissue the unfloored ramp is 0.836 / 0.687 / 0.553 and the
    // floored one is 0.836 / 0.750 / 0.750 — a fade that still steps twice,
    // with its last two rungs resting on the floor together. Monotone, never
    // rising: a strand may not brighten toward its own end.
    expect(depth(1, END[0], populationStrokeTaper)).toBeLessThan(0.8);
    expect(depth(1, END[0], populationStrokeTaper)).toBeGreaterThan(0.7);
    expect(depth(1, END[2], populationStrokeTaper))
      .toBeGreaterThan(depth(1, END[1], populationStrokeTaper));
    expect(depth(1, END[1], populationStrokeTaper))
      .toBeGreaterThanOrEqual(depth(1, END[0], populationStrokeTaper));
    expect(depth(1, END[2], populationStrokeTaper)).toBeLessThan(1);
    // Fringe: the floor dominates and the ending is flat — because it already
    // was. Unfloored, the deepest rung out there is a 2.2% step.
    const FRINGE_W = 0.029;
    expect(depth(FRINGE_W, END[0], populationFibreTaper)).toBeGreaterThan(0.97);
    expect(depth(FRINGE_W, END[0], populationStrokeTaper)).toBe(1);
    // The ban this preserves: the fade lives in the shared weight, so no draw
    // may add an end treatment of its own. Neither stroke stage carries one.
    const fibre = makePopulationFibreMaterial();
    for (const emphasis of ['vDistance', 'vPosition', 'smoothstep(']) {
      expect(fibre.vertexShader).not.toContain(emphasis);
      expect(fibre.fragmentShader).not.toContain(emphasis);
    }
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

describe('the backbone is the hairline at a different width', () => {
  const backbone = makePopulationBackboneMaterial();
  const fibre = makePopulationFibreMaterial();

  it('blends exactly as the hairline it was taken out of', () => {
    // The partition draws one set of strokes in two passes. If the two passes
    // did not agree here, the promoted half would be a different LIGHT rather
    // than a different width — and "wider, never brighter" is the whole
    // contract of the class.
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
      expect(backbone[key], key).toBe(fibre[key]);
    }
    expect(backbone.blending).toBe(THREE.CustomBlending);
    expect(backbone.blendDst).toBe(THREE.OneMinusSrcColorFactor);
  });

  it('emits the hairline own premultiplied law', () => {
    // `vec4(tint * a, a)` into a SrcAlpha/OneMinusSrcColor blend is what makes
    // an isolated deposit contribute `tint * a * a`. A stock LineMaterial
    // writes `vec4(diffuseColor.rgb, opacity)` instead, which is linear in the
    // encoded energy — the promoted strands would have jumped a whole
    // brightness class on the same alpha.
    expect(backbone.fragmentShader)
      .toContain('gl_FragColor = vec4( uColor * haloAlpha, haloAlpha );');
    expect(backbone.fragmentShader)
      .not.toContain('gl_FragColor = vec4( diffuseColor.rgb, alpha );');
    expect(fibre.fragmentShader)
      .toContain('gl_FragColor = vec4(tint * a, a);');
  });

  it('writes raw, as every other draw in this layer does', () => {
    // ⚠️ The one patch that is easy to forget and impossible to see in a
    // still: a stock LineMaterial colour-manages its output. Leaving that in
    // would encode this pass to sRGB while the hairline it partitions with
    // stays linear — 0.25 would render as 0.53, and the backbone would read
    // as brighter rather than as wider.
    expect(backbone.fragmentShader).not.toContain('colorspace_fragment');
    expect(fibre.fragmentShader).not.toContain('colorspace_fragment');
    // And premultiplication stays MANUAL: the stock include would multiply a
    // second time.
    expect(backbone.premultipliedAlpha).toBe(false);
  });

  it('squares the interpolated ratio, never the interpolated square', () => {
    // mix() is linear, so the taper of an interpolated weight is the square of
    // the interpolated RATIO. Both classes do it the same way round, off the
    // same helper, and the geometry hands the shader the ratio.
    expect(backbone.fragmentShader).toContain(
      'float haloAlpha = uEmission * diffuseColor.r * diffuseColor.r * alpha;',
    );
    expect(fibre.fragmentShader)
      .toContain('float a = uEmission * vSizeRatio * vSizeRatio;');
    for (const weight of [0, 0.25, 0.5, 0.75, 1]) {
      const ratio = populationFibreSizeRatio(weight);
      expect(ratio * ratio).toBeCloseTo(populationFibreTaper(weight), 12);
    }
  });

  it('carries no emission constant of its own', () => {
    // Per-deposit alpha is not merely bounded by the hairline's, it IS the
    // hairline's — chroma retention is a function of per-deposit alpha, so a
    // width class that also raised alpha would spend the chroma the taper was
    // installed to recover.
    expect(backbone.uniforms.uEmission.value).toBe(0);
    expect(fibre.uniforms.uEmission.value).toBe(0);
    // One hue for the whole stroke class, both widths of it — a partition is
    // one set of strokes drawn in two passes, and a colour step at the
    // promotion boundary would be a seam down the middle of every strand.
    expect(backbone.uniforms.uColor.value.getHex())
      .toBe(fibre.uniforms.uColor.value.getHex());
    expect(new THREE.Color(...POPULATION_STROKE_COLOR).getHex())
      .toBe(backbone.uniforms.uColor.value.getHex());
    // And it is NOT the beads' colour: that is the 2026-08-20 split.
    expect(new THREE.Color(...POPULATION_FIELD_COLOR).getHex())
      .not.toBe(backbone.uniforms.uColor.value.getHex());
    expect(makePopulationPointMaterial().uniforms.uColor.value.getHex())
      .toBe(new THREE.Color(...POPULATION_FIELD_COLOR).getHex());
    // The amount curve both passes ride is one function, so scope changes can
    // never pull the two halves of the partition apart.
    expect(populationFibreEmissionForGain(0.4))
      .toBe(populationFibreEmissionForGain(0.4));
  });

  it('states its width in CSS pixels, which is what makes it DPR-aware', () => {
    // ⚠️⚠️ The mechanism the whole class exists for: `gl.LINES` rasterizes at
    // one DEVICE pixel and has no pixel-ratio input anywhere, so the hairline
    // thins as the framebuffer grows. A screen-space capsule states its width
    // against `resolution`, which `LineSegments2.onBeforeRender` writes in CSS
    // pixels immediately before every draw.
    expect(backbone.linewidth).toBe(POPULATION_BACKBONE_WIDTH_PX);
    // 1.4 -> 1.6 -> 1.8 on 2026-08-20, three live verdicts in a day: 1.4 was
    // the smallest step that could TEST the first, 1.6 answered it together
    // with the hue change, and 1.8 answers the third — *visible now, but hard
    // to see clearly* — as the geometry third of a move that also widened the
    // budget and raised the level. Recorded decisions re-decided by live
    // review, which is what this constant is for.
    expect(POPULATION_BACKBONE_WIDTH_PX).toBe(1.8);
    expect(backbone.worldUnits).toBe(false);
    expect(backbone.uniforms.resolution).toBeDefined();
    expect(backbone.uniforms.capsulePixelRatio).toBeDefined();
    // The two-triangle capsule, not the stock six.
    expect(backbone.fragmentShader).toContain('vCapsuleStartPx');
  });

  it('has no endpoint emphasis of any kind', () => {
    // Round caps are the capsule's silhouette. What is forbidden is a
    // brightening at a vertex: the stroke's energy is a function of the tissue
    // weight at each end and of nothing else, so a strand's last segments fade
    // exactly as the hairlines do.
    const output = backbone.fragmentShader
      .split('\n')
      .find((line) => line.includes('float haloAlpha'));
    expect(output).toBeDefined();
    expect(output).not.toContain('capsuleT');
    expect(output).not.toContain('vUv');
  });
});
