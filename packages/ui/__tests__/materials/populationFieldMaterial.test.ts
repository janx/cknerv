import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  makePopulationCompositeMaterial,
  makePopulationDensityMaterial,
  POPULATION_FIELD_BLOOM_MS,
  POPULATION_FIELD_CONTINUUM_FRACTION,
  POPULATION_FIELD_EMISSION_PEAK,
  POPULATION_FIELD_FIBRE_FLOOR,
  POPULATION_FIELD_FIBRE_SATURATE,
  POPULATION_FIELD_FIBRE_SPAN,
  POPULATION_FIELD_MAX_BLOOMS,
  POPULATION_FIELD_SEAM_COARSENING,
  POPULATION_FIELD_CORE_HIGH,
  POPULATION_FIELD_CORE_LOW,
  POPULATION_FIELD_SIGHTLINE_HIGH,
  POPULATION_FIELD_SIGHTLINE_LOW,
  POPULATION_FIELD_SLAB_HALF_Y,
  POPULATION_FIELD_SPECK_FLOOR,
  POPULATION_FIELD_SPECK_GAIN,
  POPULATION_FIELD_SPECK_ELONGATION,
  POPULATION_FIELD_SPECK_PX,
  POPULATION_FIELD_SWARM_DENSITY,
  populationFibreClustering,
  populationResolvedSuppression,
  populationSwarmEmission,
  populationUnresolvedDepth,
} from '../../src/materials/populationFieldMaterial';
import {
  POPULATION_FIELD_OUTER_EDGE,
  populationFibre,
  populationFibreBases,
  TISSUE_BAKE_FOLD_Y_RANGE,
  TISSUE_BAKE_HALF_X,
  TISSUE_BAKE_HALF_Z,
  TISSUE_BAKE_THICKNESS_MAX,
  TISSUE_BAKE_THICKNESS_MIN,
} from '../../src/geometry/tissueFieldBake';
import {
  FIELD_HALF_X,
  FIELD_HALF_Z,
  helixSeedF64,
  tissueSampleAt,
} from '../../src/helix';
import { CELLS_Y } from '../../src/layout';
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
    expect(material.fragmentShader)
      .toContain('1.0 - exp(-unresolved * uOpticalDepth)');
    // The Gaussian's normalization is the part that is easy to drop and hard
    // to see: without it a column integrates to density * thickness, so the
    // medium overstates itself by up to 3.5x exactly where the tissue is
    // thickest — which is also where its own ridge term makes it densest.
    expect(material.fragmentShader)
      .toContain('exp(-0.5 * dy * dy) / safeThickness * stepLen');
    expect(material.fragmentShader).toContain('tau += density * weight;');
  });

  it('accumulates both depths through one set of samples', () => {
    const material = makePopulationDensityMaterial();

    // Two separate marches would put their steps in different places under the
    // dither, and the disagreement would show up as noise along exactly the
    // boundary this quantity exists to draw. One weight, two accumulations.
    expect(material.fragmentShader).toContain('tauResolved += resolved * weight;');
    expect(material.fragmentShader).toContain('float resolved = law.a;');
    // One fetch carries all four channels; a second sample of the same texture
    // would be pure cost.
    expect(material.fragmentShader).toContain('vec4 law = texture2D(uField, uv);');
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

/**
 * The halo, sampled where the addressable Cells actually are.
 *
 * §6.1 test 1 is a PER-CELL test, not a per-radius one. A radius test passes a
 * build that floods the tissue's cavities and fails one that correctly lets
 * the halo into them, so it measures the wrong thing now: what is defended is
 * Cells, not a circle.
 *
 * The production camera, in the galaxy's rotating frame — the same frame the
 * march runs in, so the camera sits at y = 108 - CELLS_Y.
 */
const HALO_CAMERA: [number, number, number] = [110, 108 - CELLS_Y, 110];
const HALO_FOV = (50 * Math.PI) / 180;
const HALO_VIEW = { width: 1280, height: 720 };
/** Mainnet's measured `gain` at chain scope (§6, R = 122.6). */
const HALO_GAIN = 0.58;

/** The suppression the ELLIPTICAL build used: the individuated SHARE of the
 *  population under the ray. `resolved` and `density` are the same body under
 *  two envelopes, so the body cancels and this is a function of the warped
 *  radius alone — which is why it could only ever draw an oval. Kept here as
 *  the bar the replacement has to clear. */
function ellipticalSuppression(tau: number, tauResolved: number): number {
  const share = tauResolved / Math.max(tau, 1e-9);
  const t = Math.max(0, Math.min(1, (share - 0.08) / (0.28 - 0.08)));
  return t * t * (3 - 2 * t);
}

interface RayHalo {
  /** Suppression from the shipped pair of measures. */
  lit: number;
  /** Suppression from the elliptical share, on the same ray. */
  litElliptical: number;
  /** Warped radius of the point of the organism this ray looks at. */
  foldRadius: number;
}

/** March one ray of the density pass and return both laws' lit fractions.
 *  Analytic rather than baked — the bake is an approximation of exactly this,
 *  and the law is what is under test. Undithered, so the result is a property
 *  of the field and not of a sampling phase. */
function marchHalo(px: number, py: number): RayHalo | null {
  const halfX = FIELD_HALF_X * POPULATION_FIELD_OUTER_EDGE;
  const halfZ = FIELD_HALF_Z * POPULATION_FIELD_OUTER_EDGE;
  const origin = new THREE.Vector3(...HALO_CAMERA);
  const forward = origin.clone().multiplyScalar(-1).normalize();
  const right = new THREE.Vector3(-forward.z, 0, forward.x).normalize();
  const up = right.clone().cross(forward);
  const tanHalf = Math.tan(HALO_FOV / 2);
  const aspect = HALO_VIEW.width / HALO_VIEW.height;
  const sx = ((px / HALO_VIEW.width) * 2 - 1) * tanHalf * aspect;
  const sy = (1 - (py / HALO_VIEW.height) * 2) * tanHalf;
  const dir = forward.clone()
    .addScaledVector(right, sx)
    .addScaledVector(up, sy)
    .normalize();

  const half = [halfX, POPULATION_FIELD_SLAB_HALF_Y, halfZ];
  const ro = [origin.x, origin.y, origin.z];
  const rd = [dir.x, dir.y, dir.z];
  let tEnter = -Infinity;
  let tExit = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    const unit = rd[axis] >= 0 ? 1 : -1;
    const inv = 1 / (unit * Math.max(Math.abs(rd[axis]), 1e-6));
    let lo = (-half[axis] - ro[axis]) * inv;
    let hi = (half[axis] - ro[axis]) * inv;
    if (lo > hi) { const swap = lo; lo = hi; hi = swap; }
    tEnter = Math.max(tEnter, lo);
    tExit = Math.min(tExit, hi);
  }
  tEnter = Math.max(tEnter, 0);
  if (tExit <= tEnter) return null;

  const steps = 8;
  const stepLen = (tExit - tEnter) / steps;
  let tau = 0;
  let tauResolved = 0;
  for (let i = 0; i < steps; i += 1) {
    const t = tEnter + (i + 0.5) * stepLen;
    const x = ro[0] + rd[0] * t;
    const y = ro[1] + rd[1] * t;
    const z = ro[2] + rd[2] * t;
    const sample = tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE);
    const thickness = Math.max(sample.thickness, 1e-3);
    const dy = (y - sample.foldY) / thickness;
    const weight = (Math.exp(-0.5 * dy * dy) / thickness) * stepLen;
    tau += sample.density * weight;
    tauResolved += sample.resolvedCoverage * weight;
  }

  const rdy = rd[1] >= 0 ? Math.max(rd[1], 1e-4) : Math.min(rd[1], -1e-4);
  const tFold = Math.min(Math.max(-ro[1] / rdy, tEnter), tExit);
  const foldX = ro[0] + rd[0] * tFold;
  const foldZ = ro[2] + rd[2] * tFold;
  const coverage = tissueSampleAt(foldX, foldZ, POPULATION_FIELD_OUTER_EDGE)
    .resolvedCoverage;

  const depth = POPULATION_FIELD_SWARM_DENSITY * HALO_GAIN;
  const unresolved = populationUnresolvedDepth(tau, coverage, tauResolved);
  const elliptical = tau * (1 - ellipticalSuppression(tau, tauResolved));
  return {
    lit: 1 - Math.exp(-unresolved * depth),
    litElliptical: 1 - Math.exp(-elliptical * depth),
    foldRadius: Math.hypot(foldX / FIELD_HALF_X, foldZ / FIELD_HALF_Z),
  };
}

/** What a lit fraction is worth as light on the pixel behind a Cell: the
 *  expectation of {@link populationSwarmEmission} over the mask draw and the
 *  brightness spread, times the emission peak. The tint's red channel is 1.0,
 *  so this IS the worst channel's contrast factor. Checked against the real
 *  function below rather than trusted. */
function expectedHalo(lit: number): number {
  const mean = POPULATION_FIELD_SPECK_FLOOR
    + (1 - POPULATION_FIELD_SPECK_FLOOR) * 0.5;
  return (lit * POPULATION_FIELD_CONTINUUM_FRACTION
    + lit * mean * lit * POPULATION_FIELD_SPECK_GAIN)
    * POPULATION_FIELD_EMISSION_PEAK;
}

/** Every sixth drawn Cell, projected to its screen pixel. */
function drawnCellPixels(): { px: number; py: number }[] {
  const origin = new THREE.Vector3(...HALO_CAMERA);
  const forward = origin.clone().multiplyScalar(-1).normalize();
  const right = new THREE.Vector3(-forward.z, 0, forward.x).normalize();
  const up = right.clone().cross(forward);
  const tanHalf = Math.tan(HALO_FOV / 2);
  const aspect = HALO_VIEW.width / HALO_VIEW.height;
  const pixels: { px: number; py: number }[] = [];
  for (let id = 1; id <= 12_000; id += 6) {
    const [x, y, z] = helixSeedF64(id);
    const rel = new THREE.Vector3(x, y, z).sub(origin);
    const depth = rel.dot(forward);
    if (depth <= 1) continue;
    const px = ((rel.dot(right) / (depth * tanHalf * aspect)) + 1) / 2
      * HALO_VIEW.width;
    const py = (1 - rel.dot(up) / (depth * tanHalf)) / 2 * HALO_VIEW.height;
    if (px < 0 || py < 0 || px >= HALO_VIEW.width || py >= HALO_VIEW.height) continue;
    pixels.push({ px, py });
  }
  return pixels;
}

describe('rule 9a: the halo cannot reach the addressable Cells', () => {
  it('is exactly zero at and above either upper threshold, not merely low', () => {
    // The invariant the whole relocation rests on. Three overlays were judged
    // live and every one that was visible at all cost the Cells their
    // sharpness, so the guarantee cannot be "faint" — it has to be a zero, and
    // it has to be structural rather than a value someone chose carefully.
    //
    // Either measure alone is enough to produce it: dense tissue at this point
    // of the organism, or enough addressable tissue anywhere along the ray.
    for (const tau of [0.001, 0.05, 0.4, 1, 3, 12, 400]) {
      for (const coverage of [POPULATION_FIELD_CORE_HIGH, 0.5, 0.9, 1]) {
        expect(populationUnresolvedDepth(tau, coverage, 0)).toBe(0);
      }
      for (const sightline of [POPULATION_FIELD_SIGHTLINE_HIGH, 2, 9]) {
        expect(populationUnresolvedDepth(tau, 0, sightline)).toBe(0);
      }
    }
  });

  it('no gain, density, or brightness can put light back over the Cells', () => {
    // The zero happens BEFORE the exponential, so the whole chain downstream —
    // optical depth, the swarm mask, the continuum, the emission peak —
    // multiplies a zero, at every draw of the stochastic mask and at every
    // scale anyone might later reach for.
    for (const tau of [0.02, 0.3, 2, 40]) {
      for (const [coverage, sightline] of [
        [POPULATION_FIELD_CORE_HIGH, 0],
        [0.4, 0],
        [0, POPULATION_FIELD_SIGHTLINE_HIGH],
        [1, 4],
      ]) {
        const unresolved = populationUnresolvedDepth(tau, coverage, sightline);
        for (const opticalDepth of [0.01, 0.58 * 0.84, 5, 1000]) {
          const litFraction = 1 - Math.exp(-unresolved * opticalDepth);
          expect(litFraction).toBe(0);
          for (const pick of [0, 0.25, 0.5, 0.75, 0.999]) {
            for (const spread of [0, 0.5, 1]) {
              expect(populationSwarmEmission(litFraction, pick, spread)).toBe(0);
            }
          }
        }
      }
    }
  });

  it('takes the stronger of the two measures, never their average', () => {
    // A Cell has a place and a direction. Averaging would let a ray full of
    // Cells through wherever the plane under it happened to be empty, which is
    // most of the seam: `max` is what makes each measure a veto rather than a
    // vote.
    const tau = 1.4;
    const covered = populationUnresolvedDepth(tau, 1, 0);
    const sighted = populationUnresolvedDepth(tau, 0, 3);
    expect(covered).toBe(0);
    expect(sighted).toBe(0);
    expect(populationUnresolvedDepth(tau, 1, 3)).toBe(0);
    // And each is monotone on its own axis: more evidence of Cells, less halo.
    let previous = tau + 1;
    for (const coverage of [0, 0.04, 0.07, 0.1, 0.13, 0.15]) {
      const depth = populationUnresolvedDepth(tau, coverage, 0);
      expect(depth).toBeLessThanOrEqual(previous);
      previous = depth;
    }
    previous = tau + 1;
    for (const sightline of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const depth = populationUnresolvedDepth(tau, 0, sightline);
      expect(depth).toBeLessThanOrEqual(previous);
      previous = depth;
    }
  });

  it('crossfades between the thresholds instead of switching', () => {
    // §6.1 test 5, and the reason each measure is a pair rather than a knee.
    // A single knee can only place the halo's onset; it cannot also say how
    // wide the transition is, so it put the whole crossfade PAST the last
    // Cell and left a band where neither population was drawn.
    expect(POPULATION_FIELD_CORE_LOW).toBeGreaterThan(0);
    expect(POPULATION_FIELD_CORE_LOW).toBeLessThan(POPULATION_FIELD_CORE_HIGH);
    expect(POPULATION_FIELD_CORE_HIGH).toBeLessThan(1);
    expect(POPULATION_FIELD_SIGHTLINE_LOW).toBeGreaterThan(0);
    expect(POPULATION_FIELD_SIGHTLINE_LOW)
      .toBeLessThan(POPULATION_FIELD_SIGHTLINE_HIGH);

    const tau = 1.4;
    let previous = 0;
    for (const coverage of [0.13, 0.11, 0.09, 0.07, 0.05]) {
      const unresolved = populationUnresolvedDepth(tau, coverage, 0);
      // Strictly rising as the coverage falls — the crossfade is a ramp, and
      // every one of these sits between the thresholds.
      expect(unresolved).toBeGreaterThan(previous);
      expect(unresolved).toBeLessThan(tau);
      previous = unresolved;
    }
    // And it is smooth at both ends: a smoothstep has zero slope there, so
    // neither threshold shows up as a crease in the picture.
    expect(populationResolvedSuppression(POPULATION_FIELD_CORE_LOW, 0)).toBe(0);
    expect(populationResolvedSuppression(POPULATION_FIELD_CORE_HIGH, 0)).toBe(1);
    expect(populationResolvedSuppression(0, POPULATION_FIELD_SIGHTLINE_LOW))
      .toBe(0);
    expect(populationResolvedSuppression(0, POPULATION_FIELD_SIGHTLINE_HIGH))
      .toBe(1);
    const mid = (POPULATION_FIELD_CORE_LOW + POPULATION_FIELD_CORE_HIGH) / 2;
    expect(populationResolvedSuppression(mid, 0)).toBeCloseTo(0.5, 12);
  });

  it('states the whole population wherever nothing is individuated', () => {
    // A suppression that swallowed the layer would pass every test above and
    // ship nothing. At and below both lower thresholds the halo is at FULL
    // strength — not asymptotically approaching it — so the outer body is
    // never quietly dimmed by a trace of coverage too small to see.
    const tau = 1.4;
    for (const coverage of [POPULATION_FIELD_CORE_LOW, 0.01, 0]) {
      for (const sightline of [POPULATION_FIELD_SIGHTLINE_LOW, 0.05, 0]) {
        expect(populationUnresolvedDepth(tau, coverage, sightline)).toBe(tau);
      }
    }
    // An empty ray states nothing, and is not a divide by zero any more —
    // there is no quotient left to guard.
    expect(populationUnresolvedDepth(0, 0, 0)).toBe(0);
  });

  it('subtracts population, before the exponential and not after', () => {
    const shader = makePopulationDensityMaterial().fragmentShader;

    // Order is the test. Scaling the LIGHT after saturation leaves a dark ring
    // between the Cells and the population around them, because 1 - exp(-tau)
    // is concave; subtracting the depth first lets the halo reach the body it
    // is supposed to continue. It is also the only form in which "exactly
    // zero" survives an arbitrary optical depth.
    expect(shader).toContain('float unresolved = tau * (1.0 - supp);');
    expect(shader.indexOf('float unresolved ='))
      .toBeLessThan(shader.indexOf('1.0 - exp(-unresolved'));
  });

  it('reads the fold plane as well as the ray, and never their ratio', () => {
    const shader = makePopulationDensityMaterial().fragmentShader;

    // The ratio is the bug. `resolved` and `density` are one body under two
    // envelopes, so `tauResolved / tau` cancels the body exactly and leaves a
    // function of the warped radius — an ellipse, however it is thresholded.
    expect(shader).not.toContain('tauResolved / max(tau');
    expect(shader).not.toContain('float share');
    // The local measure, taken at the point of the organism the pixel looks
    // at, through the helper the composite shares.
    expect(shader).toContain('vec3 foldPoint = foldPlanePoint(ro, rd, tEnter, tExit);');
    expect(shader).toContain('float foldCoverage = texture2D(uField, foldUv).a;');
    // Both measures, and the stronger wins.
    expect(shader).toContain('float supp = max(');
    expect(shader).toContain('smoothstep(uCoreLow, uCoreHigh, foldCoverage)');
    expect(shader).toContain('smoothstep(uSightLow, uSightHigh, tauResolved)');

    const uniforms = makePopulationDensityMaterial().uniforms;
    expect(uniforms.uCoreLow.value).toBe(POPULATION_FIELD_CORE_LOW);
    expect(uniforms.uCoreHigh.value).toBe(POPULATION_FIELD_CORE_HIGH);
    expect(uniforms.uSightLow.value).toBe(POPULATION_FIELD_SIGHTLINE_LOW);
    expect(uniforms.uSightHigh.value).toBe(POPULATION_FIELD_SIGHTLINE_HIGH);
  });

  it('publishes the suppression so the composite can ramp its grain', () => {
    const shader = makePopulationDensityMaterial().fragmentShader;

    // Faint tissue at the far edge and suppressed tissue at the seam produce
    // the same lit fraction in R and want opposite grain, so the crossfade
    // position cannot be recovered downstream — it has to be carried.
    expect(shader).toContain('gl_FragColor = vec4(litFraction, supp, 0.0, 1.0);');
  });

  it('§6.1 test 1: leaves the Cells that were worst off strictly better', () => {
    // PER CELL, not per radius. The old instrument asked whether the halo was
    // zero inside r <= 0.70; it passes a build that floods the tissue's
    // cavities and fails one that correctly lets the halo into them. A cavity
    // holds no Cells and halo light in one obscures nothing.
    //
    // Both layers composite by bounded screen, so a Cell sits at `c + h(1-c)`
    // over a surround at `h`: an excursion of `c(1-h)` against `c` with the
    // layer off. The halo's luminance at a Cell's pixel IS that Cell's local
    // contrast reduction, whichever order the two are drawn in.
    //
    // The bar is the build this replaces — the elliptical suppression was
    // judged live and accepted, so it is the thing to be no worse than.
    // The expectation helper is not allowed to drift from the shader's own
    // colour math, so it is checked against it rather than trusted.
    for (const lit of [0.15, 0.5, 0.9]) {
      let total = 0;
      const draws = 160;
      for (let i = 0; i < draws; i += 1) {
        for (let j = 0; j < draws; j += 1) {
          total += populationSwarmEmission(lit, (i + 0.5) / draws, (j + 0.5) / draws);
        }
      }
      const measured = (total / (draws * draws)) * POPULATION_FIELD_EMISSION_PEAK;
      expect(measured).toBeCloseTo(expectedHalo(lit), 3);
    }

    const pixels = drawnCellPixels();
    expect(pixels.length).toBeGreaterThan(1800);

    const mine: number[] = [];
    const ellipse: number[] = [];
    for (const { px, py } of pixels) {
      const halo = marchHalo(px, py);
      if (!halo) continue;
      mine.push(expectedHalo(halo.lit));
      ellipse.push(expectedHalo(halo.litElliptical));
    }
    mine.sort((a, b) => a - b);
    ellipse.sort((a, b) => a - b);
    const at = (values: number[], p: number) =>
      values[Math.floor(values.length * p)];
    const over = (values: number[], t: number) =>
      values.filter((v) => v > t).length;

    // Four Cells in five carry exactly nothing, and that is not a tuned bound:
    // it is the `max` of two suppressions saturating over the body.
    expect(at(mine, 0.8)).toBe(0);
    expect(at(ellipse, 0.8)).toBe(0);

    // The TAIL is what matters, because that is where a Cell actually loses
    // contrast, and the new law is strictly better there: it takes light off
    // the Cells the ellipse left sitting in the fully lit halo. What it gives
    // back is a faint dusting on a few more rim Cells — around a percent of
    // them, at a tenth of that level — which is the interdigitation itself.
    for (const level of [0.10, 0.20, 0.30]) {
      expect(over(mine, level)).toBeLessThanOrEqual(over(ellipse, level));
    }
    expect(at(mine, 0.95)).toBeLessThanOrEqual(at(ellipse, 0.95));
    expect(at(mine, 0.99)).toBeLessThanOrEqual(at(ellipse, 0.99));
    // Not a vacuous comparison: the ellipse really does light Cells.
    expect(over(ellipse, 0.20)).toBeGreaterThan(20);
  });

  it('§6.1 test 1: reaches further into the tissue than the ellipse did', () => {
    // The other half, and the reason for the change. Without this the test
    // above is satisfied by suppressing everything.
    let area = 0;
    let lit = 0;
    let litElliptical = 0;
    for (let py = 6; py < HALO_VIEW.height; py += 12) {
      for (let px = 6; px < HALO_VIEW.width; px += 12) {
        const halo = marchHalo(px, py);
        if (!halo || halo.foldRadius > 1) continue;
        area += 1;
        if (halo.lit > 0.05) lit += 1;
        if (halo.litElliptical > 0.05) litElliptical += 1;
      }
    }
    expect(area).toBeGreaterThan(600);
    // Inside the resolved rim — the cavities, corridors and thinning tissue
    // the ellipse could never enter, because its input had no body term left
    // in it to enter by. Measured at 1.54x.
    expect(lit).toBeGreaterThan(litElliptical * 1.4);
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
    // rejected alternative precisely because it does resolve. The fibre
    // rotates that grid and stretches it, both in DEVICE pixels — the shape of
    // a cell follows the world, its size never does.
    expect(material.fragmentShader).toContain('dot(gl_FragCoord.xy, axis)');
    expect(material.fragmentShader).toContain('vec2 cell = floor(rotated / extent);');
    expect(material.fragmentShader)
      .toContain('vec2(uSpeckPx * coarse * uSpeckAspect, uSpeckPx * coarse / uSpeckAspect)');
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
    expect(material.fragmentShader).toContain('step(pick, clustered)');
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

  it('coarsens the grain where the halo meets the thinning Cells', () => {
    const material = makePopulationCompositeMaterial();
    const shader = material.fragmentShader;

    // §5.2. Density alone cannot close the seam: the discontinuity there is
    // one of KIND — large bright sprites on one side, two-pixel dots on the
    // other — so the grain has to vary continuously across it. The ramp is
    // driven by the suppression the density pass publishes in G, not by the
    // lit fraction, because faint far tissue and suppressed seam tissue read
    // the same in R and want opposite grain.
    expect(shader).toContain('float suppression = density.g;');
    expect(shader)
      .toContain('float coarse = 1.0 + uCoarsening * clamp(suppression, 0.0, 1.0);');
    expect(material.uniforms.uCoarsening.value)
      .toBe(POPULATION_FIELD_SEAM_COARSENING);
    // Coarser at the seam, never finer: a grain that refined INTO the boundary
    // would sharpen exactly the edge this exists to dissolve.
    expect(POPULATION_FIELD_SEAM_COARSENING).toBeGreaterThan(0);
    // And bounded — at the far side of the ramp the swarm must still be the
    // same population, not a second, chunkier one.
    expect(POPULATION_FIELD_SEAM_COARSENING).toBeLessThan(1);
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
  it('grows outward from a rim that does not move', () => {
    // The rejected alternative was shrinking the Cell field to make room. That
    // would rescale FIELD_HALF_X/Z, which delivery landings and the contact
    // front's extinction band derive from, and every constant tuned against
    // the old scale with them.
    expect(FIELD_HALF_X).toBe(60);
    expect(FIELD_HALF_Z).toBe(54);
    expect(POPULATION_FIELD_OUTER_EDGE).toBeGreaterThan(1);
    expect(TISSUE_BAKE_HALF_X).toBeGreaterThan(FIELD_HALF_X);
    expect(TISSUE_BAKE_HALF_Z).toBeGreaterThan(FIELD_HALF_Z);
    // Same factor on both axes: the halo is this ellipse continued, not a
    // differently-proportioned object placed around it.
    expect(TISSUE_BAKE_HALF_X / FIELD_HALF_X)
      .toBeCloseTo(TISSUE_BAKE_HALF_Z / FIELD_HALF_Z, 12);
  });

  it('keeps the halo flatter than the core, out of the law', () => {
    // §6.1 test 4 wants a bulge with a disk around it. The fold and the
    // thickness are the same noise at the same point, so the medium's vertical
    // extent is unchanged in absolute terms — which over a footprint 2.2x
    // wider IS flatter, by exactly that factor, with no second vertical
    // profile invented for the outer region.
    const coreAspect = POPULATION_FIELD_SLAB_HALF_Y / FIELD_HALF_X;
    const haloAspect = POPULATION_FIELD_SLAB_HALF_Y / TISSUE_BAKE_HALF_X;
    expect(haloAspect).toBeLessThan(coreAspect);
    expect(coreAspect / haloAspect).toBeCloseTo(POPULATION_FIELD_OUTER_EDGE, 12);
  });

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

describe('§5.1: the halo carries the unresolved FABRIC too', () => {
  it('clusters the specks without inventing or destroying a population', () => {
    // The fibre may gather the swarm; it may not change how much of it there
    // is. Measured against the real field over the halo domain, weighted by
    // the density that decides how much swarm each place holds.
    const halfX = FIELD_HALF_X * POPULATION_FIELD_OUTER_EDGE;
    const halfZ = FIELD_HALF_Z * POPULATION_FIELD_OUTER_EDGE;
    const fibres: number[] = [];
    const weights: number[] = [];
    const steps = 90;
    for (let i = 0; i <= steps; i += 1) {
      for (let j = 0; j <= steps; j += 1) {
        const x = (i / steps) * 2 * halfX - halfX;
        const z = (j / steps) * 2 * halfZ - halfZ;
        const sample = tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE);
        if (sample.density <= 0.02) continue;
        fibres.push(populationFibre(...populationFibreBases(sample.qx, sample.qz)));
        weights.push(sample.density);
      }
    }
    expect(fibres.length).toBeGreaterThan(2000);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const meanAt = (amount: number) => fibres.reduce(
      (sum, fibre, index) => sum + populationFibreClustering(fibre, amount) * weights[index],
      0,
    ) / total;

    // Below saturation the modulation is linear, so this ratio is the
    // modulation's own mean: measured at 1.15, i.e. the strands take slightly
    // more than the voids give up. `SPAN` is set so that the FRAME integral —
    // the thing a viewer actually sees, over the real distribution of
    // amounts at the production camera — comes out at 0.99 of the unclustered
    // swarm; the reference prototype's narrower span measured 0.88, which
    // would have quietly under-claimed the population by an eighth.
    expect(meanAt(0.2) / 0.2).toBeGreaterThan(0.9);
    expect(meanAt(0.2) / 0.2).toBeLessThan(1.3);
    // Where the swarm is already nearly fully lit there is nowhere to gather
    // TO, so clustering can only give some back. It may never claim more than
    // every cell.
    expect(meanAt(1)).toBeLessThan(1);
    expect(meanAt(1)).toBeGreaterThan(0.6);
  });

  it('leaves a void sparse rather than empty', () => {
    // A resolution limit does not produce vacuum between bundles. It produces
    // fewer of the same specks, which is what the floor is: a fifth of them
    // survive where the fibre says nothing at all.
    expect(POPULATION_FIELD_FIBRE_FLOOR).toBeGreaterThan(0);
    expect(populationFibreClustering(0, 0.5))
      .toBeCloseTo(0.5 * POPULATION_FIELD_FIBRE_FLOOR, 12);
    // And it is monotone: more fibre gathers more, never less.
    let previous = -1;
    for (const fibre of [0, 0.05, 0.1, 0.2, 0.35, 0.6, 1]) {
      const gathered = populationFibreClustering(fibre, 0.3);
      expect(gathered).toBeGreaterThanOrEqual(previous);
      previous = gathered;
    }
    // Saturating the fibre before the modulation is what keeps the strands
    // from clipping into a hard-edged stencil: past this the curve is flat.
    expect(populationFibreClustering(1 / POPULATION_FIELD_FIBRE_SATURATE, 0.3))
      .toBeCloseTo(populationFibreClustering(1, 0.3), 12);
    expect(POPULATION_FIELD_FIBRE_SPAN).toBeGreaterThan(0);
  });

  it('modulates which specks are lit and never how bright they are', () => {
    // §5.1's line, and the difference between a population with a grain and a
    // wash with a pattern on it. The clustered fraction reaches the mask
    // threshold and nothing else: a speck inside a bundle is exactly as bright
    // as one outside it.
    const litFraction = 0.4;
    for (const spread of [0, 0.5, 1]) {
      const inBundle = populationSwarmEmission(litFraction, 0.05, spread, 0.9);
      const inVoid = populationSwarmEmission(litFraction, 0.05, spread, 0.1);
      expect(inBundle).toBe(inVoid);
    }
    // What DOES change is whether a given draw is lit at all.
    expect(populationSwarmEmission(litFraction, 0.5, 1, 0.9))
      .toBeGreaterThan(populationSwarmEmission(litFraction, 0.5, 1, 0.1));
    // And the continuum underneath belongs to the population, not to the
    // fibre, so a void keeps the floor its density earns.
    expect(populationSwarmEmission(litFraction, 0.99, 1, 0))
      .toBeCloseTo(litFraction * POPULATION_FIELD_CONTINUUM_FRACTION, 12);
    // Zero population is still zero, whatever the fibre says.
    expect(populationSwarmEmission(0, 0, 1, 1)).toBe(0);
  });

  it('elongates the grain without changing how much of it there is', () => {
    const material = makePopulationCompositeMaterial();
    const aspect = material.uniforms.uSpeckAspect.value as number;

    // Area-preserving by construction: long axis times the aspect, short axis
    // divided by it. Anisotropy is what makes a texture read as fibrous
    // instead of as noise, and it is the one property of the grain rule 10
    // leaves free — the SIZE of a screen cell is what may never follow the
    // world.
    expect(aspect * aspect).toBeCloseTo(POPULATION_FIELD_SPECK_ELONGATION, 12);
    const along = POPULATION_FIELD_SPECK_PX * aspect;
    const across = POPULATION_FIELD_SPECK_PX / aspect;
    expect(along * across)
      .toBeCloseTo(POPULATION_FIELD_SPECK_PX * POPULATION_FIELD_SPECK_PX, 12);
    expect(along / across).toBeCloseTo(POPULATION_FIELD_SPECK_ELONGATION, 12);
    // Fibrous, not merely oval, and not so long that a speck becomes a dash
    // anyone could trace.
    expect(POPULATION_FIELD_SPECK_ELONGATION).toBeGreaterThan(2);
    expect(POPULATION_FIELD_SPECK_ELONGATION).toBeLessThan(4);
  });

  it('draws grain direction, and never a link between two points', () => {
    const shader = makePopulationCompositeMaterial().fragmentShader;

    // Rule 4 is what makes fibre out here honest at all: there are no nodes in
    // the halo, so nothing may terminate anywhere. The direction is taken
    // ACROSS the local gradient — a field, evaluated per pixel, with no
    // endpoints to have and no segment to draw between them.
    expect(shader).toContain('vec2 along = vec2(-grad.y, grad.x);');
    expect(shader).toContain('vec2 grad = vec2(gx / uBakeTexel.x, gz / uBakeTexel.y);');
    // The fibre reaches the mask threshold and stops there.
    expect(shader).toContain('float clustered = clamp(');
    expect(shader).toContain('float emission = amount * uContinuum + lit * amount * uSpeckGain;');
  });

  it('reads the fibre once, on the fold plane, not through the march', () => {
    // It is a property of the tissue's own plane — the halo is a disk and
    // filaments in it lie in it — so one ray-plane intersection per pixel is
    // the whole cost, rather than a fetch per march step through a volume
    // that has no fibre in it.
    const composite = makePopulationCompositeMaterial().fragmentShader;
    expect(composite)
      .toContain('vec3 foldPoint = foldPlanePoint(ro, rd, tEnter, tExit);');
    // Through the SAME helper the density pass takes rule 9a's local measure
    // with, so the grain is drawn at the point of the organism where the
    // population under it was decided. Clamped into the slab: a grazing ray's
    // fold intersection runs off to infinity, and an edge-on camera really
    // does produce one.
    expect(composite)
      .toContain('float tFold = clamp(-ro.y / rdy, tEnter, tExit);');

    // And the density march never touches it. Two textures, one pass each.
    const density = makePopulationDensityMaterial().fragmentShader;
    expect(density).not.toContain('uFibre');
    expect(density).not.toContain('fibreAt');
  });
});
