// The accretion fragment discards the annulus beyond the gas birth radius
// BEFORE its noise body. That is only pixel-identical if every additive term
// the body would have produced there is already under the closing
// `amp < 0.002` discard — which this file proves, term by term, from the
// shader's own constants: the field and gas windows close exactly at uBirth,
// the mesh halo at 1.9 uRim, and the three Gaussians are several sigma out.
// The GLSL is transliterated here (float64, an upper bound on the float32
// values by fifteen orders of magnitude of margin) and sampled over the whole
// annulus × angle × seed × time; the source oracle keeps the discard where it
// pays, ahead of the first noise call.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COHORT_BREATHE_DEPTH,
  COHORT_DISC_FLATTEN,
  COHORT_GAS_BIRTH_R,
  COHORT_HORIZON_R,
  COHORT_MARK_HALF_EXTENT,
  COHORT_MESH_HALO_AMP,
  COHORT_PHOTON_SIGMA,
  COHORT_RIM_AMP,
  COHORT_RIM_R,
  COHORT_RIM_SIGMA,
  makeColonyAccretionMaterial,
} from '../../src/materials/colonyAccretion';

const SOURCE = readFileSync(
  resolve(process.cwd(), 'src/materials/colonyAccretion.ts'),
  'utf8',
);

const TAU = Math.PI * 2;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const gaussian = (d: number, sigma: number): number => {
  const q = d / Math.max(sigma, 0.002);
  return Math.exp(-q * q);
};

/** The largest tweak the schema allows on the rim amplitude (`holeRim` max
 *  3): the bound below holds at it, so no knob can wake the annulus. */
const RIM_AMP_CEILING = Math.max(COHORT_RIM_AMP, 3);

/** Every additive term of the fragment at world radius `rw`, screen angle
 *  `theta`, per-instance `seed` and clock `time`, exactly as the shader
 *  composes `cold + hot` — before the `horizon * edge` factors, which are
 *  both ≤ 1 and can only lower it. The noise-driven terms carry their radial
 *  windows explicitly; the windows are what this proof rests on. */
function annulusAmplitudeUpperBound(
  rw: number,
  theta: number,
  seed: number,
  time: number,
): { amp: number; fieldWindow: number; gasWindow: number; meshHalo: number } {
  const uHorizon = COHORT_HORIZON_R;
  const uRim = COHORT_RIM_R;
  const uBirth = COHORT_GAS_BIRTH_R;
  const uRimAmp = RIM_AMP_CEILING;
  const px = Math.cos(theta) * rw;
  const py = Math.sin(theta) * rw;
  const orientation = (seed - 0.5) * 0.72;
  const c = Math.cos(orientation);
  const s = Math.sin(orientation);
  // mat2(c, -s, s, c) * pw — column-major, as GLSL reads it.
  const discPx = c * px + s * py;
  const discPy = -s * px + c * py;
  const discQx = discPx;
  const discQy = discPy / Math.max(COHORT_DISC_FLATTEN, 0.08);
  const discRadius = Math.hypot(discQx, discQy);
  const discAngle = Math.atan2(discQy, discQx) + seed * TAU - time * 0.5 * TAU;
  const rimRadius = uRim * (
    1 + 0.065 * Math.sin(discAngle * 3 + 0.8) + 0.035 * Math.sin(discAngle * 5 - 1.7)
  );
  const discBand = gaussian(discRadius - rimRadius, COHORT_RIM_SIGMA);
  const approaching = Math.pow(0.5 + 0.5 * Math.cos(discAngle - 0.38), 2.4);
  const rim = discBand * (0.34 + 1.02 * approaching) * uRimAmp;
  const photon = gaussian(rw - uHorizon * 1.28, COHORT_PHOTON_SIGMA)
    * (0.82 + 0.18 * Math.cos(discAngle * 2)) * uRimAmp;
  const polar = Math.pow(clamp(Math.abs(discPy) / Math.max(rw, 0.001), 0, 1), 4);
  const lens = gaussian(rw - uHorizon * 1.68, COHORT_PHOTON_SIGMA * 0.82)
    * polar * uRimAmp * 0.9;
  // The noise terms are bounded by their windows: the noise functions are
  // compositions of fract/mix and land in [0, 1], the ridge/breakup/flicker
  // factors in [0, 1.0], the gravity factor in [0.28, 1.08], the amplitude
  // knobs at their schema maxima (2 and 3). A closed window is zero exactly.
  const fieldWindow = smoothstep(uRim * 0.72, uRim * 1.18, rw)
    * (1 - smoothstep(uBirth * 0.74, uBirth, rw));
  const gasWindow = smoothstep(uHorizon * 1.08, uHorizon * 1.78, rw)
    * (1 - smoothstep(uBirth * 0.78, uBirth, rw));
  const disturbanceCeiling = fieldWindow * 1.0 * 2;
  const gasCeiling = gasWindow * 1.08 * 3;
  const gasHeatCeiling = gasCeiling * (0.34 + 0.26);
  const haloR = clamp(rw / Math.max(uRim * 1.9, 0.001), 0, 1);
  const meshHalo = Math.pow(1 - haloR, 1.6) * 0.42 * COHORT_MESH_HALO_AMP;
  const restBreathe = 1 - COHORT_BREATHE_DEPTH * (0.5 + 0.5 * Math.sin(time * 1.2 + seed * TAU));
  const cold = (rim * 0.68 + lens * 0.58 + meshHalo) * restBreathe
    + disturbanceCeiling * 0.74
    + gasCeiling;
  const hot = (photon * 1.18 + rim * 0.38 + lens * 0.82) * restBreathe
    + disturbanceCeiling * 0.12
    + gasHeatCeiling;
  return { amp: cold + hot, fieldWindow, gasWindow, meshHalo };
}

describe('colony accretion — the annulus beyond uBirth is provably dark', () => {
  it('every window that gates a noise term closes exactly at the birth radius', () => {
    // The mesh halo closes earlier still, so the birth radius sits outside it.
    expect(COHORT_GAS_BIRTH_R).toBeGreaterThan(COHORT_RIM_R * 1.9);
    // And the three Gaussians are far out: their distances in sigma at the
    // birth radius, with the rim measured against its largest possible
    // radius (both modulation terms at +1).
    const rimSigmas = (COHORT_GAS_BIRTH_R - COHORT_RIM_R * 1.1) / COHORT_RIM_SIGMA;
    const photonSigmas = (COHORT_GAS_BIRTH_R - COHORT_HORIZON_R * 1.28) / COHORT_PHOTON_SIGMA;
    const lensSigmas = (COHORT_GAS_BIRTH_R - COHORT_HORIZON_R * 1.68) / (COHORT_PHOTON_SIGMA * 0.82);
    expect(rimSigmas).toBeGreaterThan(6);
    expect(photonSigmas).toBeGreaterThan(14);
    expect(lensSigmas).toBeGreaterThan(16);
  });

  it('cold + hot stays under the closing discard everywhere past uBirth, for every angle, seed and clock', () => {
    // Exclusive at the birth radius itself (`rw > uBirth` is the discard) and
    // inclusive at the quad's corner reach, which `rq > 1.0` already trims.
    const radii = 160;
    const angles = 36;
    const seeds = [0, 0.137, 0.5, 0.731, 0.999];
    const clocks = [0, 0.37, 7.1, 3600.25, 86_400 * 3];
    let worst = 0;
    let samples = 0;
    let openWindows = 0;
    for (let r = 1; r <= radii; r += 1) {
      const rw = COHORT_GAS_BIRTH_R
        + (COHORT_MARK_HALF_EXTENT * Math.SQRT2 - COHORT_GAS_BIRTH_R) * (r / radii);
      for (let a = 0; a < angles; a += 1) {
        const theta = (a / angles) * TAU;
        for (const seed of seeds) {
          for (const time of clocks) {
            const bound = annulusAmplitudeUpperBound(rw, theta, seed, time);
            if (bound.fieldWindow !== 0 || bound.gasWindow !== 0 || bound.meshHalo !== 0) {
              openWindows += 1;
            }
            if (bound.amp > worst) worst = bound.amp;
            samples += 1;
          }
        }
      }
    }
    expect(samples).toBe(radii * angles * seeds.length * clocks.length);
    // Every noise window and the halo are exactly zero at every sample.
    expect(openWindows).toBe(0);
    // The old code's own discard threshold, with the margin that makes the
    // early one the same picture and not merely a close one.
    expect(worst).toBeLessThan(1e-12);
    expect(worst).toBeLessThan(0.002);
  });

  it('nothing inside the birth radius is touched by the early discard', () => {
    // Just inside, the windows are open and the halo is still alive at the
    // rim's outer skirt — the body has work to do there, and the discard
    // does not reach it.
    const inside = annulusAmplitudeUpperBound(COHORT_GAS_BIRTH_R * 0.9, 0.3, 0.5, 1);
    expect(inside.fieldWindow).toBeGreaterThan(0);
    expect(inside.gasWindow).toBeGreaterThan(0);
    const skirt = annulusAmplitudeUpperBound(COHORT_RIM_R * 1.5, 0.3, 0.5, 1);
    expect(skirt.meshHalo).toBeGreaterThan(0);
  });

  it('discards the annulus before the first noise call, and keeps the closing discard', () => {
    const fragment = makeColonyAccretionMaterial().fragmentShader;
    const main = fragment.slice(fragment.indexOf('void main()'));
    const radius = main.indexOf('float rw = rq * uHalf;');
    const early = main.indexOf('if (rw > uBirth) discard;');
    const firstNoise = main.indexOf('fbm3(');
    const closing = main.indexOf('if (amp < 0.002) discard;');
    expect(radius).toBeGreaterThan(-1);
    expect(early).toBeGreaterThan(radius);
    expect(firstNoise).toBeGreaterThan(early);
    expect(closing).toBeGreaterThan(firstNoise);
    // The bound above is stated against the constants the material binds.
    const material = makeColonyAccretionMaterial();
    expect(material.uniforms.uBirth.value).toBe(COHORT_GAS_BIRTH_R);
    expect(material.uniforms.uRim.value).toBe(COHORT_RIM_R);
    expect(material.uniforms.uHorizon.value).toBe(COHORT_HORIZON_R);
    expect(material.uniforms.uHalf.value).toBe(COHORT_MARK_HALF_EXTENT);
    // Only the amplitudes and rates are live-tuned (ColonyAccretion.tsx); the
    // radii and sigmas the proof rests on are not.
    expect(SOURCE).toContain('if (rw > uBirth) discard;');
  });
});
