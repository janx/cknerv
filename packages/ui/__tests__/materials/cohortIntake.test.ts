// What a cohort's intake is, arithmetically — and two guards over the whole
// file's GLSL that have each cost this project a round already.
//
// The shader's own arithmetic is transliterated here (float64, an upper bound
// on the float32 the driver runs) and swept, in the house style of
// `colonyAccretion.test.ts`. ⚠️ A MIRROR THAT DRIFTS PROVES NOTHING — that is
// exactly how R15 shipped a silent divergence — so the mirror is pinned to the
// shipped GLSL by `the mirror below is the shipped density function`, which
// compares the real `intakeDensityAt` text against the copy this file
// transliterates. Change one and the other fails.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PEER_NETWORK_PALETTE } from '../../src/visualPalette';
// ⭐ The namespace is what makes the coverage claim below general: every
// exported STRING in the material file is a shared GLSL snippet, and the
// coverage sum finds them without being told their names.
import * as colonyCohort from '../../src/materials/colonyCohort';
import {
  COHORT_CLIP_KNEE,
  COHORT_INTAKE_AMP,
  COHORT_INTAKE_CRESTS,
  COHORT_INTAKE_DENSITY,
  COHORT_INTAKE_EDGE,
  COHORT_INTAKE_FLARE,
  COHORT_INTAKE_FLOOR,
  COHORT_INTAKE_GATHER,
  COHORT_INTAKE_HALF_EXTENT,
  COHORT_INTAKE_HELIX,
  COHORT_INTAKE_MAX_STEPS,
  COHORT_INTAKE_MOUTH,
  COHORT_INTAKE_RATE,
  COHORT_INTAKE_RATE_FLOOR,
  COHORT_INTAKE_REACH,
  COHORT_INTAKE_SIGMA,
  COHORT_INTAKE_STEPS,
  COHORT_INTAKE_SWIRL,
  COHORT_INTAKE_THROAT_R,
  COHORT_INTAKE_WARP,
  makeCohortCoreMaterial,
  makeCohortIntakeMaterial,
} from '../../src/materials/colonyCohort';

const SOURCE_PATH = resolve(process.cwd(), 'src/materials/colonyCohort.ts');
const SOURCE = readFileSync(SOURCE_PATH, 'utf8');

const TAU = Math.PI * 2;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const fract = (x: number): number => x - Math.floor(x);

/* -------------------------------------------------------------------------- *
 * The mirror: `intakeDensityAt`, line for line.
 * -------------------------------------------------------------------------- */

/** Everything the fragment reads that is not the marched point. `helix` and
 *  the two march knobs are parameters because the sweeps below move them. */
interface Funnel {
  readonly time: number;
  readonly seed: number;
  readonly rateScale: number;
  readonly helix: number;
}

const RESTING: Funnel = {
  time: 0,
  seed: 0,
  rateScale: 1,
  helix: COHORT_INTAKE_HELIX,
};

function intakeRadiusAt(h: number): number {
  return COHORT_INTAKE_THROAT_R
    + (COHORT_INTAKE_MOUTH - COHORT_INTAKE_THROAT_R)
      * Math.pow(Math.max(h, 0), COHORT_INTAKE_FLARE);
}

/** The crest, isolated: the only term with a `fract` in it, and therefore the
 *  only one that can tear. Its argument is the whole phase. */
function crestAt(phase: number): number {
  const w = fract(phase);
  const dw = Math.min(w, 1 - w);
  return COHORT_INTAKE_FLOOR
    + (1 - COHORT_INTAKE_FLOOR)
      * Math.exp(-(dw * dw) / (2 * COHORT_INTAKE_SIGMA * COHORT_INTAKE_SIGMA));
}

/** `intakeDensityAt(vec3 rel)`, in the funnel's own frame: `rel` is the point
 *  minus the throat, and the throat is the instance origin. */
function intakeDensityAt(
  rel: readonly [number, number, number],
  funnel: Funnel = RESTING,
): number {
  const h = -rel[1] / COHORT_INTAKE_REACH;
  if (h < 0 || h > 1) return 0;
  const rho = Math.hypot(rel[0], rel[2]);
  const radius = intakeRadiusAt(h);
  const q = rho / Math.max(radius, 0.001);
  const radial = Math.exp(-q * q * COHORT_INTAKE_EDGE);
  const s = Math.pow(Math.max(h, 0), COHORT_INTAKE_WARP);
  const theta = Math.atan2(rel[2], rel[0]);
  const crest = crestAt(
    s * COHORT_INTAKE_CRESTS
      + funnel.helix * (theta / TAU + funnel.time * COHORT_INTAKE_SWIRL)
      + funnel.time * COHORT_INTAKE_RATE * funnel.rateScale
      + funnel.seed,
  );
  const gather = Math.pow(
    COHORT_INTAKE_MOUTH / Math.max(radius, 0.001),
    COHORT_INTAKE_GATHER,
  );
  const mouthFade = 1 - smoothstep(0.74, 1.0, h);
  const throatFade = smoothstep(0.0, 0.10, h);
  return radial * crest * gather * mouthFade * throatFade;
}

/** A point at height fraction `h` on the funnel's own axis. */
const onAxis = (h: number): [number, number, number] => [0, -h * COHORT_INTAKE_REACH, 0];

/* -------------------------------------------------------------------------- *
 * The mirror: the ray clip and the march.
 * -------------------------------------------------------------------------- */

interface Clip {
  readonly t0: number;
  readonly t1: number;
}

/** The `y` slab `[-uReach, 0]` intersected with the bounding cylinder
 *  `rho <= uMouth`, in the funnel frame. `null` is a `discard`. */
function clipRay(
  rel0: readonly [number, number, number],
  rd: readonly [number, number, number],
): Clip | null {
  let t0 = 0;
  let t1 = 1e9;
  if (Math.abs(rd[1]) > 1e-6) {
    const ta = (0 - rel0[1]) / rd[1];
    const tb = (-COHORT_INTAKE_REACH - rel0[1]) / rd[1];
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
  } else if (rel0[1] > 0 || rel0[1] < -COHORT_INTAKE_REACH) {
    return null;
  }
  const a = rd[0] * rd[0] + rd[2] * rd[2];
  const b = 2 * (rel0[0] * rd[0] + rel0[2] * rd[2]);
  const c = rel0[0] * rel0[0] + rel0[2] * rel0[2]
    - COHORT_INTAKE_MOUTH * COHORT_INTAKE_MOUTH;
  const disc = b * b - 4 * a * c;
  if (disc <= 0 || a < 1e-9) return null;
  const sq = Math.sqrt(disc);
  t0 = Math.max(t0, (-b - sq) / (2 * a));
  t1 = Math.min(t1, (-b + sq) / (2 * a));
  if (t1 <= t0) return null;
  return { t0, t1 };
}

/** Is this point inside the bounding volume the clip claims to cover? */
function insideBounds(rel: readonly [number, number, number]): boolean {
  const h = -rel[1] / COHORT_INTAKE_REACH;
  return h >= 0 && h <= 1
    && Math.hypot(rel[0], rel[2]) <= COHORT_INTAKE_MOUTH;
}

const step = (
  rel0: readonly [number, number, number],
  rd: readonly [number, number, number],
  t: number,
): [number, number, number] => [
  rel0[0] + rd[0] * t,
  rel0[1] + rd[1] * t,
  rel0[2] + rd[2] * t,
];

interface March {
  readonly sum: number;
  readonly trans: number;
  readonly maxStepDepth: number;
}

/**
 * The shipped accumulation — and, behind `quadrature: 'leftEndpoint'`, the rule
 * it replaced. `sum += (1 - e^-dA) * trans` is the integral of the emission
 * that survives to the eye over a step of constant density, EXACTLY;
 * `sum += dA * trans` is the left-endpoint rule for the same integral. The two
 * agree as `dA → 0` and diverge above it, and the divergence is what the suite
 * below measures.
 */
function march(
  rel0: readonly [number, number, number],
  rd: readonly [number, number, number],
  options: {
    funnel?: Funnel;
    steps?: number;
    density?: number;
    quadrature?: 'exact' | 'leftEndpoint';
  } = {},
): March | null {
  const {
    funnel = RESTING,
    steps = COHORT_INTAKE_STEPS,
    density = COHORT_INTAKE_DENSITY,
    quadrature = 'exact',
  } = options;
  const clip = clipRay(rel0, rd);
  if (clip === null) return null;
  const dt = (clip.t1 - clip.t0) / steps;
  let sum = 0;
  let trans = 1;
  let maxStepDepth = 0;
  for (let i = 0; i < COHORT_INTAKE_MAX_STEPS; i += 1) {
    if (i >= steps) break;
    const p = step(rel0, rd, clip.t0 + (i + 0.5) * dt);
    const dA = intakeDensityAt(p, funnel) * dt * density;
    if (dA > maxStepDepth) maxStepDepth = dA;
    const absorbed = 1 - Math.exp(-dA);
    sum += (quadrature === 'exact' ? absorbed : dA) * trans;
    trans *= 1 - absorbed;
    if (trans < 0.004) break;
  }
  return { sum, trans, maxStepDepth };
}

/** The soft knee, verbatim. It — and not the sum — is what bounds the mark. */
const knee = (amp: number): number =>
  COHORT_CLIP_KNEE * (1 - Math.exp(-amp / COHORT_CLIP_KNEE));

interface Ray {
  readonly rel0: [number, number, number];
  readonly rd: [number, number, number];
}

/**
 * A spread of rays that actually reach the volume, from every side — including
 * from straight above (looking down the axis at a cohort, which is the longest
 * chord there is) and from below the mouth. The eye is well outside the quad's
 * own half-extent, and the targets cover the axis, the wall and both ends.
 *
 * Deliberately a few hundred rays rather than a few hundred thousand: every
 * sweep below runs the whole march over all of them, several times.
 */
const SWEEP_RAYS: readonly Ray[] = (() => {
  const eyeDistance = 60;
  const rays: Ray[] = [];
  for (const elevation of [-84, -55, -24, -6, 6, 24, 55, 84]) {
    for (const azimuth of [0, 73, 147, 221, 295]) {
      const e = (elevation * Math.PI) / 180;
      const a = (azimuth * Math.PI) / 180;
      const rel0: [number, number, number] = [
        Math.cos(e) * Math.cos(a) * eyeDistance,
        Math.sin(e) * eyeDistance,
        Math.cos(e) * Math.sin(a) * eyeDistance,
      ];
      for (const h of [0.02, 0.2, 0.5, 0.8, 0.98]) {
        for (const [r, p] of [[0, 0], [0.5, 40], [0.98, 130], [0.98, 310]]) {
          const wall = r * COHORT_INTAKE_MOUTH * 0.98;
          const d: [number, number, number] = [
            Math.cos((p * Math.PI) / 180) * wall - rel0[0],
            -h * COHORT_INTAKE_REACH - rel0[1],
            Math.sin((p * Math.PI) / 180) * wall - rel0[2],
          ];
          const length = Math.hypot(d[0], d[1], d[2]);
          rays.push({ rel0, rd: [d[0] / length, d[1] / length, d[2] / length] });
        }
      }
    }
  }
  return rays;
})();

/**
 * One ray from the default camera's elevation, aimed at the funnel's axis at
 * height `h`. Sweeping `h` walks the eye down the funnel the way T6's contrast
 * probe walks a line down the mark on screen.
 */
function axisRay(h: number): [[number, number, number], [number, number, number]] {
  const elevation = (24 * Math.PI) / 180;
  const rel0: [number, number, number] = [
    Math.cos(elevation) * 60,
    Math.sin(elevation) * 60,
    0,
  ];
  const d: [number, number, number] = [
    -rel0[0],
    -h * COHORT_INTAKE_REACH - rel0[1],
    -rel0[2],
  ];
  const length = Math.hypot(d[0], d[1], d[2]);
  return [rel0, [d[0] / length, d[1] / length, d[2] / length]];
}

/* -------------------------------------------------------------------------- *
 * The density field.
 * -------------------------------------------------------------------------- */

describe("cohort intake — the funnel's density field", () => {
  it('is exactly zero above the throat and below the mouth', () => {
    // No light escapes upward past the node, and none hangs below the mouth:
    // both ends are hard zeroes, not tails. The window closes exactly at the
    // ends of h too — `throatFade` is smoothstep(0, …) at h = 0 and
    // `mouthFade` is 1 - smoothstep(…, 1) at h = 1 — so the closed interval
    // is dark at both endpoints as well as outside it.
    const outside = [-1e6, -12.5, -1, -1e-9, 0, 1, 1 + 1e-9, 1.0001, 4, 1e6];
    const funnels: Funnel[] = [
      RESTING,
      { time: 37.5, seed: 0.618, rateScale: 0.62, helix: 0 },
      { time: 86_400, seed: 0.999, rateScale: 1, helix: 3 },
    ];
    for (const h of outside) {
      for (const radius of [0, 0.4, 3, COHORT_INTAKE_MOUTH, 40]) {
        for (const angle of [0, 1.3, Math.PI, 4.9]) {
          const rel: [number, number, number] = [
            Math.cos(angle) * radius,
            -h * COHORT_INTAKE_REACH,
            Math.sin(angle) * radius,
          ];
          for (const funnel of funnels) {
            expect(intakeDensityAt(rel, funnel)).toBe(0);
          }
        }
      }
    }
    // …and the assertion above means something only because the inside of the
    // interval is lit. It is, at every height between the two windows.
    for (const h of [0.06, 0.1, 0.25, 0.5, 0.73, 0.85, 0.94]) {
      for (const funnel of funnels) {
        expect(`${h}: ${intakeDensityAt(onAxis(h), funnel) > 0}`)
          .toBe(`${h}: true`);
      }
    }
  });

  it('the crest is continuous across every fract wrap', () => {
    // `fract` is discontinuous; `min(w, 1 - w)` is what puts the seam back
    // together, and the crest's own peak sits ON the seam. If the two halves
    // ever disagreed the funnel would show a hard ring once a period.
    let worstJump = 0;
    for (let turn = -6; turn <= 6; turn += 1) {
      for (const epsilon of [1e-4, 1e-6, 1e-9]) {
        const below = crestAt(turn - epsilon);
        const above = crestAt(turn + epsilon);
        worstJump = Math.max(worstJump, Math.abs(above - below));
        // Both sides sit at the crest's own maximum, which is 1.
        expect(below).toBeCloseTo(1, 6);
        expect(above).toBeCloseTo(1, 6);
      }
      // …and the trough, half a period away, agrees with itself too.
      const troughBelow = crestAt(turn + 0.5 - 1e-9);
      const troughAbove = crestAt(turn + 0.5 + 1e-9);
      expect(Math.abs(troughAbove - troughBelow)).toBeLessThan(1e-9);
      // ⭐ The trough is the FLOOR plus a Gaussian tail, and never the floor
      // exactly: at half a period out the crest is 12.5 sigma away, which is
      // three parts in a million. That is what keeps the funnel a medium
      // instead of a stack of shells with gaps between them.
      expect(troughAbove).toBeGreaterThan(COHORT_INTAKE_FLOOR);
      expect(troughAbove).toBeLessThan(COHORT_INTAKE_FLOOR + 1e-5);
    }
    expect(worstJump).toBeLessThan(1e-6);
    // Continuity is not flatness: the crest really does have contrast.
    expect(crestAt(0) / crestAt(0.5)).toBeGreaterThan(4);
  });

  it('a non-integral helix tears the seam at theta = ±pi; the shipped one is integral', () => {
    // ⚠️ There is no lathe and no vertex seam left to blame. What wraps now is
    // `theta = atan(rel.z, rel.x)`, which jumps by exactly one turn across the
    // −x half-plane. The phase therefore jumps by `uHelix`, and `fract` hides
    // that jump if and only if `uHelix` is an INTEGER.
    const seamGap = (helix: number): number => {
      let worst = 0;
      for (const h of [0.15, 0.35, 0.6, 0.72]) {
        for (const rho of [0.2, 1.4, 4]) {
          for (const time of [0, 11.25]) {
            const y = -h * COHORT_INTAKE_REACH;
            const funnel: Funnel = { time, seed: 0.31, rateScale: 1, helix };
            const above = intakeDensityAt([-rho, y, +1e-9], funnel);
            const below = intakeDensityAt([-rho, y, -1e-9], funnel);
            const scale = Math.max(above, below, 1e-9);
            worst = Math.max(worst, Math.abs(above - below) / scale);
          }
        }
      }
      return worst;
    };
    for (const integral of [-2, -1, 0, 1, 2, 5]) {
      expect(`helix ${integral}: ${seamGap(integral) < 1e-6}`)
        .toBe(`helix ${integral}: true`);
    }
    // And a fractional turn is a visible discontinuity, not a rounding wobble.
    for (const fractional of [0.5, 1.3, -0.25, 2.75]) {
      expect(`helix ${fractional}: ${seamGap(fractional) > 0.05}`)
        .toBe(`helix ${fractional}: true`);
    }
    // So the shipped default has to be one of the former.
    expect(Number.isInteger(COHORT_INTAKE_HELIX)).toBe(true);
    expect(
      Number.isInteger(makeCohortIntakeMaterial().uniforms.uHelix.value),
    ).toBe(true);
  });

  it('flux gathers: the throat is denser than the mouth', () => {
    // ⭐ The convergence has to be legible as a convergence, and the term that
    // makes it so is `(uMouth / R)^uGather` — flux conservation, not a painted
    // ramp. On the axis, with the crest free to take any phase (any seed), the
    // whole open interval is monotonically brighter toward the throat.
    const bestOnAxis = (h: number): number => {
      let best = 0;
      for (let seed = 0; seed < 1; seed += 0.002) {
        best = Math.max(
          best,
          intakeDensityAt(onAxis(h), { ...RESTING, seed }),
        );
      }
      return best;
    };
    const worstOnAxis = (h: number): number => {
      let worst = Infinity;
      for (let seed = 0; seed < 1; seed += 0.002) {
        worst = Math.min(
          worst,
          intakeDensityAt(onAxis(h), { ...RESTING, seed }),
        );
      }
      return worst;
    };
    // Sampled over the interval where both windows are fully open, the
    // envelope only ever falls as the funnel widens.
    let previous = Infinity;
    for (let h = 0.1; h <= 0.74; h += 0.02) {
      const here = bestOnAxis(h);
      expect(`${h.toFixed(2)}: ${here <= previous + 1e-12}`)
        .toBe(`${h.toFixed(2)}: true`);
      previous = here;
    }
    // And the separation is wide enough to survive the crest: the DIMMEST
    // phase near the throat still beats the BRIGHTEST phase near the mouth.
    expect(worstOnAxis(0.1)).toBeGreaterThan(bestOnAxis(0.9));
    expect(bestOnAxis(0.1) / bestOnAxis(0.74)).toBeGreaterThan(2.5);
  });

  it('the mirror above is the shipped density function, character for character', () => {
    // ⚠️ R15 shipped a test-mirror that had silently drifted from its shader.
    // This is the tie: the GLSL the material actually compiles, normalised,
    // against the copy the transliteration above was written from. Editing
    // either one alone fails here, loudly, instead of quietly proving nothing.
    const fragment = makeCohortIntakeMaterial().fragmentShader;
    expect(normaliseGlsl(glslFunction(fragment, 'intakeDensityAt'))).toBe(
      normaliseGlsl(`
        float intakeDensityAt(vec3 rel) {
          float h = -rel.y / uReach;
          if (h < 0.0 || h > 1.0) return 0.0;
          float rho = length(rel.xz);
          float R = intakeRadiusAt(h);
          float q = rho / max(R, 0.001);
          float radial = exp(-q * q * uEdge);
          float s = pow(max(h, 0.0), uWarp);
          float theta = atan(rel.z, rel.x);
          float w = fract(
            s * uCrests
              + uHelix * (theta / TAU + uTime * uSwirl)
              + uTime * uRate * vRateScale
              + vSeed
          );
          float dw = min(w, 1.0 - w);
          float crest = uFloor
            + (1.0 - uFloor) * exp(-(dw * dw) / (2.0 * uSigma * uSigma));
          float gather = pow(uMouth / max(R, 0.001), uGather);
          float mouthFade = 1.0 - smoothstep(0.74, 1.0, h);
          float throatFade = smoothstep(0.0, 0.10, h);
          return radial * crest * gather * mouthFade * throatFade;
        }
      `),
    );
    expect(normaliseGlsl(glslFunction(fragment, 'intakeRadiusAt'))).toBe(
      normaliseGlsl(`
        float intakeRadiusAt(float h) {
          return uThroatR + (uMouth - uThroatR) * pow(max(h, 0.0), uFlare);
        }
      `),
    );
  });
});

/* -------------------------------------------------------------------------- *
 * The ray clip.
 * -------------------------------------------------------------------------- */

describe('cohort intake — the ray clip', () => {
  it('marches exactly the slab-and-cylinder interval, and never a step outside it', () => {
    // The quad is a bounding PROXY. What makes that honest is that the clip is
    // exact: the marched interval starts at the entry point and ends at the
    // exit, with nothing of the volume left outside it and no step wasted
    // inside the corner the quad adds.
    let rays = 0;
    let clipped = 0;
    let worstEntry = 0;
    let worstExit = 0;
    const probe = 4000;
    for (const { rel0, rd } of SWEEP_RAYS) {
      rays += 1;
      const clip = clipRay(rel0, rd);
      // Brute force: where along this ray is the volume, really?
      let firstInside = Infinity;
      let lastInside = -Infinity;
      for (let i = 0; i <= probe; i += 1) {
        const t = (i / probe) * 200;
        if (!insideBounds(step(rel0, rd, t))) continue;
        firstInside = Math.min(firstInside, t);
        lastInside = Math.max(lastInside, t);
      }
      if (clip === null) {
        // A discard is only allowed where the brute force found nothing.
        expect(firstInside).toBe(Infinity);
        continue;
      }
      clipped += 1;
      const resolution = 200 / probe;
      // Nothing of the volume lies before t0 or after t1…
      expect(clip.t0).toBeLessThanOrEqual(firstInside + 1e-9);
      expect(clip.t1).toBeGreaterThanOrEqual(lastInside - 1e-9);
      // …and the interval is TIGHT: it does not start early or end late by
      // more than one brute-force sample.
      worstEntry = Math.max(worstEntry, firstInside - clip.t0);
      worstExit = Math.max(worstExit, clip.t1 - lastInside);
      // Every step the march takes lands inside the volume.
      const dt = (clip.t1 - clip.t0) / COHORT_INTAKE_STEPS;
      for (let i = 0; i < COHORT_INTAKE_STEPS; i += 1) {
        const p = step(rel0, rd, clip.t0 + (i + 0.5) * dt);
        expect(insideBounds(p)).toBe(true);
      }
    }
    expect(rays).toBe(SWEEP_RAYS.length);
    expect(rays).toBeGreaterThan(500);
    // Most of the sweep really does hit; a suite that clipped everything away
    // would pass the assertions above without testing anything.
    expect(clipped).toBeGreaterThan(rays * 0.5);
    expect(worstEntry).toBeLessThan(0.06);
    expect(worstExit).toBeLessThan(0.06);
  });

  it('rejects a ray that misses the cylinder, one that misses the slab, and one pointing away', () => {
    const far = COHORT_INTAKE_MOUTH * 3;
    // Parallel to the axis, outside the cylinder.
    expect(clipRay([far, 40, 0], [0, -1, 0])).toBeNull();
    // Horizontal, above the slab and below it.
    expect(clipRay([-50, 5, 0], [1, 0, 0])).toBeNull();
    expect(clipRay([-50, -COHORT_INTAKE_REACH - 5, 0], [1, 0, 0])).toBeNull();
    // Crossing the slab but wide of the cylinder.
    expect(clipRay([-50, 4, far], [0.9701425, -0.2425356, 0])).toBeNull();
    // Aimed at the volume but travelling AWAY from it: everything is behind
    // the camera, so `t1 <= t0` and the pixel discards.
    expect(clipRay([0, 30, 0.5], [0, 1, 0])).toBeNull();
    // The degenerate exactly-vertical ray: `a` is zero, so it discards too.
    expect(clipRay([0.5, 40, 0], [0, -1, 0])).toBeNull();
    // A control that must NOT be rejected, or the four above prove nothing.
    const hit = clipRay([0, 30, 30], [0, -0.7071068, -0.7071068]);
    expect(hit).not.toBeNull();
    expect((hit as Clip).t1).toBeGreaterThan((hit as Clip).t0);
  });

  it('truncates a density three orders under the axis, so the cylinder leaves no edge', () => {
    // The radial profile is a Gaussian and never actually reaches zero, so the
    // bounding cylinder is a truncation, not a boundary of the support. What
    // makes it invisible is how little is left out there.
    let wall = 0;
    let axis = 0;
    for (let h = 0; h <= 1; h += 0.002) {
      for (let seed = 0; seed < 1; seed += 0.02) {
        const funnel: Funnel = { ...RESTING, seed };
        wall = Math.max(
          wall,
          intakeDensityAt([COHORT_INTAKE_MOUTH, -h * COHORT_INTAKE_REACH, 0], funnel),
        );
        axis = Math.max(axis, intakeDensityAt(onAxis(h), funnel));
      }
    }
    expect(axis).toBeGreaterThan(1);
    expect(wall / axis).toBeLessThan(0.01);
  });
});

/* -------------------------------------------------------------------------- *
 * The march.
 * -------------------------------------------------------------------------- */

describe('cohort intake — the optical-depth march', () => {
  it('the knee bounds the amplitude for every density, and the mark never clips', () => {
    // ⭐ THIS — not the sum — is what makes the amplitude a number one can
    // reason about. Mathematically the knee maps [0, ∞) onto [0, uKnee): it is
    // strictly increasing, so no structure is flattened, and its ceiling is a
    // supremum it never attains, so nothing downstream of it can saturate. In
    // float64 it does attain it, once the exponential underflows; the second
    // loop below is where that starts and what it is still worth.
    let previous = -1;
    for (const sum of [0, 1e-6, 0.1, 0.5, 0.9, 1, 1.51, 2, 5, 10, 20]) {
      const out = knee(COHORT_INTAKE_AMP * sum);
      expect(out).toBeLessThan(COHORT_CLIP_KNEE);
      expect(out).toBeGreaterThan(previous);
      previous = out;
    }
    // Past that, `exp(-amp/uKnee)` underflows and the knee sits ON its
    // supremum rather than under it. It still never exceeds it, which is the
    // property everything downstream depends on.
    for (const sum of [1e3, 1e6, 1e9, Number.MAX_VALUE]) {
      const out = knee(COHORT_INTAKE_AMP * sum);
      expect(out).toBeLessThanOrEqual(COHORT_CLIP_KNEE);
      expect(out).toBeGreaterThanOrEqual(previous);
      previous = out;
    }
    expect(previous).toBe(COHORT_CLIP_KNEE);
    expect(knee(0)).toBe(0);
    // ⚠️ R16's blowout: additive blending applies source alpha to RGB, so the
    // screen gets `uColor * amp²`. At the knee's own supremum the brightest
    // channel of the scaffold is still under the clip, which is what leaves
    // the crest's structure legible instead of filled in.
    const ceiling = COHORT_CLIP_KNEE * COHORT_CLIP_KNEE;
    for (const channel of PEER_NETWORK_PALETTE.scaffold) {
      expect(channel * ceiling).toBeLessThan(1);
    }
  });

  it('telescopes: sum + trans is exactly one, so sum < 1 for every density and step count', () => {
    // ⭐ THIS is what makes `sum` an OPACITY rather than a running total that
    // happens to look like one. Each step moves `sum` up and `trans` down by
    // the same `a * trans`, so their total is invariant — one, its starting
    // value — however many steps run and however deep each one is. `uAmp` is
    // therefore a fraction of a bounded quantity, and the knee downstream is a
    // safety net rather than the only thing standing between the mark and the
    // clip.
    for (const density of [0.1, COHORT_INTAKE_DENSITY, 4, 20]) {
      for (const steps of [4, 12, COHORT_INTAKE_STEPS, COHORT_INTAKE_MAX_STEPS]) {
        let sumMax = 0;
        let worstIdentity = 0;
        let rays = 0;
        let strict = true;
        for (const { rel0, rd } of SWEEP_RAYS) {
          const marched = march(rel0, rd, { density, steps });
          if (marched === null) continue;
          rays += 1;
          worstIdentity = Math.max(
            worstIdentity,
            Math.abs(marched.sum + marched.trans - 1),
          );
          sumMax = Math.max(sumMax, marched.sum);
          // ⚠️ `sum < 1` STRICTLY is an arithmetic claim, not a floating-point
          // one, and the difference is real rather than pedantic. `sum` is
          // `1 - trans` and `trans` is never zero in exact arithmetic — but a
          // double cannot hold `1 - 1e-320`, so the moment the medium goes
          // effectively opaque the sum rounds ONTO its bound. That is the
          // physically right answer (an opaque medium absorbs everything), and
          // it is still a bound, which is the only property anything
          // downstream needs. The shader never gets near it either way: the
          // loop breaks at `trans < 0.004`.
          if (marched.trans > 1e-12) strict = strict && marched.sum < 1;
        }
        expect(rays).toBeGreaterThan(100);
        expect(worstIdentity).toBeLessThan(1e-12);
        expect(`${density}/${steps}: ${sumMax <= 1}`)
          .toBe(`${density}/${steps}: true`);
        expect(`${density}/${steps} strict: ${strict}`)
          .toBe(`${density}/${steps} strict: true`);
      }
    }
    // At the shipped constants nothing is anywhere near opaque enough to
    // underflow, so the bound is strict with room to spare.
    let shippedMax = 0;
    for (const { rel0, rd } of SWEEP_RAYS) {
      const marched = march(rel0, rd);
      if (marched !== null) shippedMax = Math.max(shippedMax, marched.sum);
    }
    expect(shippedMax).toBeLessThan(1);
  });

  it('the left-endpoint rule it replaced is unbounded, and non-monotone in density', () => {
    // ⚠️ THE FIRST CUT OF THIS MATERIAL WROTE `sum += dA * trans`, and the
    // design note called it bounded "by construction". It is not: that is the
    // LEFT-endpoint rule for a decreasing integrand, over-estimating by about
    // dA²/2 a step, and 28 steps across a 20-unit reach put dA above 1.1 near
    // the throat. This keeps the measurement that settled it, because the
    // number is the argument.
    const supremum = (density: number, quadrature: 'exact' | 'leftEndpoint'): number => {
      let sumMax = 0;
      for (const { rel0, rd } of SWEEP_RAYS) {
        const marched = march(rel0, rd, { density, quadrature });
        if (marched !== null) sumMax = Math.max(sumMax, marched.sum);
      }
      return sumMax;
    };
    expect(supremum(COHORT_INTAKE_DENSITY, 'leftEndpoint')).toBeGreaterThan(1.5);
    expect(supremum(20, 'leftEndpoint')).toBeGreaterThan(6);
    expect(supremum(COHORT_INTAKE_DENSITY, 'exact')).toBeLessThan(1);
    expect(supremum(20, 'exact')).toBeLessThanOrEqual(1);
    expect(supremum(20, 'leftEndpoint') / supremum(20, 'exact'))
      .toBeGreaterThan(6);
    // The over-estimate is one-sided: the rule never returns LESS than the
    // integral it approximates, and the gap closes as the steps get fine.
    for (const steps of [COHORT_INTAKE_STEPS, COHORT_INTAKE_MAX_STEPS]) {
      let worstUnder = 0;
      let finestDepth = 0;
      for (const { rel0, rd } of SWEEP_RAYS) {
        const options = { steps, density: 0.05 };
        const exact = march(rel0, rd, options);
        const left = march(rel0, rd, { ...options, quadrature: 'leftEndpoint' });
        if (exact === null || left === null) continue;
        worstUnder = Math.min(worstUnder, left.sum - exact.sum);
        finestDepth = Math.max(finestDepth, exact.maxStepDepth);
      }
      expect(worstUnder).toBeGreaterThanOrEqual(-1e-12);
      // At a step depth this shallow the two forms are the same picture, which
      // is the regime the design note silently assumed the whole time.
      expect(finestDepth).toBeLessThan(0.1);
    }
    // ⭐⭐ AND THE REAL TRAP, worse than the missing bound: under the left
    // rule the density knob is NON-MONOTONE in crest contrast. Contrast falls
    // to a floor around uDensity 2 and then CLIMBS again, because once `trans`
    // collapses inside one step the sum degenerates into a point sample of the
    // first sample's density — bright, structured-looking, and meaningless. A
    // tuner raising density in search of contrast walks through that dead zone
    // and out the far side. The exact form falls monotonically to 1:1, which
    // is the honest report that the medium has gone opaque.
    const axisContrast = (
      density: number,
      quadrature: 'exact' | 'leftEndpoint',
    ): number => {
      let peak = 0;
      let trough = Infinity;
      for (let h = 0.10; h <= 0.74001; h += 0.01) {
        const marched = march(...axisRay(h), { density, quadrature });
        const value = marched === null ? 0 : marched.sum;
        peak = Math.max(peak, value);
        trough = Math.min(trough, value);
      }
      return peak / trough;
    };
    const densities = [0.25, 0.5, COHORT_INTAKE_DENSITY, 1.5, 2, 3, 5, 10, 20];
    const left = densities.map((density) => axisContrast(density, 'leftEndpoint'));
    const exact = densities.map((density) => axisContrast(density, 'exact'));
    // The left rule turns back up: its last reading beats its middle one.
    expect(Math.min(...left)).toBeLessThan(1.3);
    expect(left[left.length - 1]).toBeGreaterThan(Math.min(...left) * 1.4);
    // The exact form only ever falls, all the way to 1:1. The slack is there
    // because once the contrast has bottomed out ON 1 the remaining motion is
    // in the fourth decimal — a wobble at the floor, not a recovery, and the
    // assertion after the loop is what says so.
    for (let i = 1; i < exact.length; i += 1) {
      expect(`${densities[i]}: ${exact[i] <= exact[i - 1] + 2e-3}`)
        .toBe(`${densities[i]}: true`);
    }
    expect(exact[0]).toBeGreaterThan(2.4);
    expect(Math.max(...exact.slice(4))).toBeLessThan(1.1);
    expect(exact[exact.length - 1]).toBeLessThan(1.02);
  });

  it('measures what the shipped constants actually reach, so a tune has a baseline', () => {
    let sumMax = 0;
    let depthMax = 0;
    let ampMax = 0;
    for (const { rel0, rd } of SWEEP_RAYS) {
      const marched = march(rel0, rd);
      if (marched === null) continue;
      sumMax = Math.max(sumMax, marched.sum);
      depthMax = Math.max(depthMax, marched.maxStepDepth);
      ampMax = Math.max(ampMax, knee(COHORT_INTAKE_AMP * marched.sum));
    }
    // Today, over this sweep: sum 0.9984, step depth 1.186, amplitude 0.5079
    // (a denser sweep finds a step depth of 1.64). T6 re-tunes these against
    // the real light budget; a leg that moves them a long way without meaning
    // to will find out here.
    expect(sumMax).toBeGreaterThan(0.99);
    expect(sumMax).toBeLessThan(1);
    expect(depthMax).toBeLessThan(2);
    expect(ampMax).toBeGreaterThan(0.4);
    expect(ampMax).toBeLessThan(COHORT_CLIP_KNEE);
  });

  it('the march above is the shipped march, and the shipped one absorbs exactly', () => {
    // ⚠️ A MIRROR THAT DRIFTS PROVES NOTHING — R15 shipped exactly that. The
    // density function has its own character-for-character tie above; this is
    // the tie for the accumulation, which is the whole subject of this suite.
    const fragment = makeCohortIntakeMaterial().fragmentShader;
    expect(fragment).toContain('float a = 1.0 - exp(-dA);');
    expect(fragment).toContain('sum += a * trans;');
    expect(fragment).toContain('trans *= 1.0 - a;');
    expect(fragment).toContain('if (trans < 0.004) break;');
    // And the rule it replaced is gone, in either spelling. ⚠️ Comment-free
    // text: the shader's own comment NAMES the rule it no longer uses, and a
    // guard that read the comments would have called that a regression.
    const code = stripComments(fragment);
    expect(code).not.toContain('sum += dA * trans');
    expect(code).not.toContain('trans *= exp(-dA)');
  });
});

/* -------------------------------------------------------------------------- *
 * The material itself.
 * -------------------------------------------------------------------------- */

describe('cohort intake — the material', () => {
  const material = makeCohortIntakeMaterial();

  it('binds the constants every proof above rests on', () => {
    const bound = Object.fromEntries(
      Object.entries(material.uniforms).map(([name, u]) => [name, u.value]),
    );
    expect(bound.uReach).toBe(COHORT_INTAKE_REACH);
    expect(bound.uMouth).toBe(COHORT_INTAKE_MOUTH);
    expect(bound.uThroatR).toBe(COHORT_INTAKE_THROAT_R);
    expect(bound.uFlare).toBe(COHORT_INTAKE_FLARE);
    expect(bound.uWarp).toBe(COHORT_INTAKE_WARP);
    expect(bound.uCrests).toBe(COHORT_INTAKE_CRESTS);
    expect(bound.uRate).toBe(COHORT_INTAKE_RATE);
    expect(bound.uSigma).toBe(COHORT_INTAKE_SIGMA);
    expect(bound.uFloor).toBe(COHORT_INTAKE_FLOOR);
    expect(bound.uGather).toBe(COHORT_INTAKE_GATHER);
    expect(bound.uEdge).toBe(COHORT_INTAKE_EDGE);
    expect(bound.uHelix).toBe(COHORT_INTAKE_HELIX);
    expect(bound.uSwirl).toBe(COHORT_INTAKE_SWIRL);
    expect(bound.uSteps).toBe(COHORT_INTAKE_STEPS);
    expect(bound.uDensity).toBe(COHORT_INTAKE_DENSITY);
    expect(bound.uAmp).toBe(COHORT_INTAKE_AMP);
    expect(bound.uKnee).toBe(COHORT_CLIP_KNEE);
    expect(bound.uRateFloor).toBe(COHORT_INTAKE_RATE_FLOOR);
    expect(bound.uContextEnergy).toBe(1);
    // The march's compile-time cap has to be able to hold uSteps.
    expect(COHORT_INTAKE_STEPS).toBeLessThanOrEqual(COHORT_INTAKE_MAX_STEPS);
    expect(material.fragmentShader)
      .toContain(`for (int i = 0; i < ${COHORT_INTAKE_MAX_STEPS}; i++)`);
  });

  it('is additive, unlit and depth-read-only, like every other draw in the layer', () => {
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.toneMapped).toBe(false);
  });

  it('carries the quad extent in a UNIFORM, because a hand-built billboard ignores scale', () => {
    // ⚠️ The quad is rebuilt from raw `position` and the camera axes, which no
    // model matrix ever touches — so `mesh.scale` and a scaled instance matrix
    // are both silently ignored, and a unit plane would render one world unit
    // across. The extent has to ride a uniform, and the geometry has to be
    // `PlaneGeometry(1, 1)`. (This cost a full lab round.)
    expect(material.uniforms.uHalf.value).toBe(COHORT_INTAKE_HALF_EXTENT);
    expect(material.vertexShader).toContain('uniform float uHalf;');
    expect(material.vertexShader).toContain('* uHalf * 2.0');
    // The half-extent covers the volume's bounding sphere from every angle:
    // a cylinder of radius uMouth and height uReach, centred half a reach
    // below the throat.
    const corner = Math.hypot(COHORT_INTAKE_MOUTH, COHORT_INTAKE_REACH * 0.5);
    expect(COHORT_INTAKE_HALF_EXTENT).toBeCloseTo(corner, 12);
    for (let h = 0; h <= 1; h += 0.01) {
      for (const rho of [0, COHORT_INTAKE_MOUTH]) {
        const y = -h * COHORT_INTAKE_REACH + COHORT_INTAKE_REACH * 0.5;
        expect(Math.hypot(rho, y)).toBeLessThanOrEqual(
          COHORT_INTAKE_HALF_EXTENT + 1e-12,
        );
      }
    }
  });

  it('derives the throat in the vertex shader and never takes it as a uniform', () => {
    // ⭐ The colony turns about world Y under this layer. A throat written
    // once a frame from the CPU would lag that rotation and drag every funnel
    // off its own node; the instance origin is the throat, on whatever frame
    // the GPU is drawing.
    const vertex = material.vertexShader;
    expect(vertex).toContain(
      'vec4 anchor = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
    );
    expect(vertex).toContain('vOrigin = anchor.xyz;');
    expect(vertex).toContain(
      'vec3 centre = anchor.xyz - vec3(0.0, uReach * 0.5, 0.0);',
    );
    expect(Object.keys(material.uniforms)).not.toContain('uThroat');
    expect(Object.keys(material.uniforms)).not.toContain('uOrigin');
  });

  it('takes share as a per-instance lane, and lets it move nothing but the rate', () => {
    const vertex = material.vertexShader;
    expect(vertex).toContain('attribute float aSeed;');
    expect(vertex).toContain('attribute float aShare;');
    expect(vertex).toContain(
      'vRateScale = mix(uRateFloor, 1.0, clamp(aShare, 0.0, 1.0));',
    );
    // `mix(0.62, 1, s)` is the plan's `0.62 + 0.38 * s`, and it is clamped at
    // both ends so a share outside [0, 1] cannot stop or overrun a funnel.
    const rateScale = (share: number): number =>
      COHORT_INTAKE_RATE_FLOOR
        + (1 - COHORT_INTAKE_RATE_FLOOR) * clamp(share, 0, 1);
    expect(rateScale(0)).toBeCloseTo(0.62, 12);
    expect(rateScale(1)).toBeCloseTo(1, 12);
    expect(rateScale(0.5)).toBeCloseTo(0.81, 12);
    expect(rateScale(-3)).toBe(rateScale(0));
    expect(rateScale(9)).toBe(rateScale(1));
    // ⭐ And it reaches exactly ONE term of the fragment: the crest phase.
    // Nothing about the geometry, the amplitude or the footprint reads it.
    const fragment = material.fragmentShader;
    // Two mentions in the whole fragment: the `varying` declaration, and the
    // single read inside the crest's phase.
    expect([...fragment.matchAll(/vRateScale/g)]).toHaveLength(2);
    expect(fragment).toContain('+ uTime * uRate * vRateScale');
    for (const share of [0, 0.5, 1]) {
      const funnel: Funnel = { ...RESTING, time: 0, rateScale: rateScale(share) };
      // At t = 0 the rate cannot have moved anything at all.
      expect(intakeDensityAt(onAxis(0.4), funnel))
        .toBe(intakeDensityAt(onAxis(0.4), RESTING));
    }
  });
});

/* -------------------------------------------------------------------------- *
 * Source-level guards over the WHOLE file's GLSL.
 * -------------------------------------------------------------------------- */

/** Strip GLSL/TS comments. Both guards below run on comment-free text so a
 *  `pow` or `smoothstep` written in prose can never be mistaken for code. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

/** Whitespace-insensitive GLSL, for comparing one program's text to another. */
function normaliseGlsl(glsl: string): string {
  return stripComments(glsl).replace(/\s+/g, ' ').trim();
}

/** One GLSL function's whole text, by name, brace-balanced. */
function glslFunction(program: string, name: string): string {
  const signature = program.indexOf(`float ${name}(`);
  if (signature < 0) throw new Error(`no function ${name}`);
  const open = program.indexOf('{', signature);
  let depth = 0;
  for (let i = open; i < program.length; i += 1) {
    if (program[i] === '{') depth += 1;
    else if (program[i] === '}') {
      depth -= 1;
      if (depth === 0) return program.slice(signature, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

/** The arguments of the call whose `(` is at `open`, split at top level. */
function callArguments(source: string, open: number): string[] {
  let depth = 0;
  let start = open + 1;
  const args: string[] = [];
  for (let i = open; i < source.length; i += 1) {
    const character = source[i];
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        args.push(source.slice(start, i));
        return args;
      }
    } else if (character === ',' && depth === 1) {
      args.push(source.slice(start, i));
      start = i + 1;
    }
  }
  throw new Error('unbalanced parentheses');
}

/** Every call of `name` in `program`, as its argument list. */
function callsOf(program: string, name: string): string[][] {
  const pattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
  return [...program.matchAll(pattern)].map((match) =>
    callArguments(program, (match.index ?? 0) + match[0].length - 1));
}

/* --- a tiny expression reader, enough for the two guards ------------------ */

type Node =
  | { kind: 'number'; value: number }
  | { kind: 'name'; name: string }
  | { kind: 'call'; name: string; args: Node[] }
  | { kind: 'unary'; operator: string; operand: Node }
  | { kind: 'binary'; operator: string; left: Node; right: Node };

function tokenise(expression: string): string[] {
  return expression.match(/[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?|[A-Za-z_][\w.]*|[-+*/(),]/g)
    ?? [];
}

/** `undefined` where the grammar runs out — every caller treats that as "not
 *  proven", never as "fine". */
function parseExpression(expression: string): Node | undefined {
  const tokens = tokenise(expression);
  let at = 0;
  const peek = (): string | undefined => tokens[at];
  const take = (): string => tokens[at++];
  const parseExpr = (): Node | undefined => {
    let left = parseTerm();
    while (left !== undefined && (peek() === '+' || peek() === '-')) {
      const operator = take();
      const right = parseTerm();
      if (right === undefined) return undefined;
      left = { kind: 'binary', operator, left, right };
    }
    return left;
  };
  const parseTerm = (): Node | undefined => {
    let left = parseUnary();
    while (left !== undefined && (peek() === '*' || peek() === '/')) {
      const operator = take();
      const right = parseUnary();
      if (right === undefined) return undefined;
      left = { kind: 'binary', operator, left, right };
    }
    return left;
  };
  const parseUnary = (): Node | undefined => {
    if (peek() === '-' || peek() === '+') {
      const operator = take();
      const operand = parseUnary();
      return operand === undefined ? undefined : { kind: 'unary', operator, operand };
    }
    return parsePrimary();
  };
  const parsePrimary = (): Node | undefined => {
    const token = peek();
    if (token === undefined) return undefined;
    if (token === '(') {
      take();
      const inner = parseExpr();
      if (inner === undefined || take() !== ')') return undefined;
      return inner;
    }
    if (/^[0-9.]/.test(token)) {
      take();
      return { kind: 'number', value: Number.parseFloat(token) };
    }
    if (/^[A-Za-z_]/.test(token)) {
      take();
      if (peek() !== '(') return { kind: 'name', name: token };
      take();
      const args: Node[] = [];
      if (peek() === ')') take();
      else {
        for (;;) {
          const argument = parseExpr();
          if (argument === undefined) return undefined;
          args.push(argument);
          const next = take();
          if (next === ')') break;
          if (next !== ',') return undefined;
        }
      }
      return { kind: 'call', name: token, args };
    }
    return undefined;
  };
  const parsed = parseExpr();
  return at === tokens.length ? parsed : undefined;
}

/** What a name in one program can be resolved to: a bound uniform value, or a
 *  local `float` declared exactly once (a name assigned again is dropped —
 *  its declaration is no longer the whole story). */
interface Scope {
  readonly uniforms: ReadonlyMap<string, number>;
  readonly locals: ReadonlyMap<string, string>;
}

function scopeOf(program: string, uniforms: ReadonlyMap<string, number>): Scope {
  const body = stripComments(program).replace(/\s+/g, ' ');
  const locals = new Map<string, string>();
  for (const match of body.matchAll(/\bfloat\s+(\w+)\s*=\s*([^;]+);/g)) {
    const [, name, expression] = match;
    const assignments = [...body.matchAll(new RegExp(`\\b${name}\\s*=(?!=)`, 'g'))];
    if (assignments.length !== 1) continue;
    locals.set(name, expression);
  }
  return { uniforms, locals };
}

function resolveLocal(name: string, scope: Scope): Node | undefined {
  const local = scope.locals.get(name);
  return local === undefined ? undefined : parseExpression(local);
}

/** A number, where the expression is one. */
function evaluate(node: Node, scope: Scope, seen: ReadonlySet<string>): number | undefined {
  if (node.kind === 'number') return node.value;
  if (node.kind === 'name') {
    const bound = scope.uniforms.get(node.name);
    if (bound !== undefined) return bound;
    if (seen.has(node.name)) return undefined;
    const local = resolveLocal(node.name, scope);
    return local === undefined
      ? undefined
      : evaluate(local, scope, new Set([...seen, node.name]));
  }
  if (node.kind === 'unary') {
    const operand = evaluate(node.operand, scope, seen);
    if (operand === undefined) return undefined;
    return node.operator === '-' ? -operand : operand;
  }
  if (node.kind === 'binary') {
    const left = evaluate(node.left, scope, seen);
    const right = evaluate(node.right, scope, seen);
    if (left === undefined || right === undefined) return undefined;
    if (node.operator === '+') return left + right;
    if (node.operator === '-') return left - right;
    if (node.operator === '*') return left * right;
    return right === 0 ? undefined : left / right;
  }
  const args = node.args.map((argument) => evaluate(argument, scope, seen));
  if (args.some((value) => value === undefined)) return undefined;
  const numbers = args as number[];
  if (node.name === 'max') return Math.max(...numbers);
  if (node.name === 'min') return Math.min(...numbers);
  if (node.name === 'abs') return Math.abs(numbers[0]);
  if (node.name === 'sqrt') return Math.sqrt(numbers[0]);
  if (node.name === 'exp') return Math.exp(numbers[0]);
  if (node.name === 'pow') return Math.pow(numbers[0], numbers[1]);
  if (node.name === 'clamp') return clamp(numbers[0], numbers[1], numbers[2]);
  return undefined;
}

/** An upper bound on |node|, where one is obvious — enough for `A + B*cos(x)`. */
function magnitudeBound(node: Node, scope: Scope, seen: ReadonlySet<string>): number | undefined {
  const exact = evaluate(node, scope, seen);
  if (exact !== undefined) return Math.abs(exact);
  if (node.kind === 'call' && (node.name === 'cos' || node.name === 'sin')) return 1;
  if (node.kind === 'unary') return magnitudeBound(node.operand, scope, seen);
  if (node.kind === 'binary' && node.operator === '*') {
    const left = magnitudeBound(node.left, scope, seen);
    const right = magnitudeBound(node.right, scope, seen);
    return left === undefined || right === undefined ? undefined : left * right;
  }
  if (inUnitInterval(node, scope, seen)) return 1;
  return undefined;
}

/** Provably within [0, 1]. */
function inUnitInterval(node: Node, scope: Scope, seen: ReadonlySet<string>): boolean {
  const exact = evaluate(node, scope, seen);
  if (exact !== undefined) return exact >= 0 && exact <= 1;
  if (node.kind === 'name') {
    if (seen.has(node.name)) return false;
    const local = resolveLocal(node.name, scope);
    return local !== undefined
      && inUnitInterval(local, scope, new Set([...seen, node.name]));
  }
  if (node.kind === 'call') {
    if (node.name === 'smoothstep' || node.name === 'fract') return true;
    if (node.name === 'clamp' && node.args.length === 3) {
      const low = evaluate(node.args[1], scope, seen);
      const high = evaluate(node.args[2], scope, seen);
      return low !== undefined && high !== undefined && low >= 0 && high <= 1;
    }
    return false;
  }
  if (node.kind === 'binary') {
    if (node.operator === '*') {
      return inUnitInterval(node.left, scope, seen)
        && inUnitInterval(node.right, scope, seen);
    }
    if (node.operator === '-') {
      const left = evaluate(node.left, scope, seen);
      return left === 1 && inUnitInterval(node.right, scope, seen);
    }
  }
  return false;
}

/**
 * Provably ≥ 0.
 *
 * ⚠️ `pow(x, y)` with a negative `x` is UNDEFINED in GLSL, and it is undefined
 * quietly: the driver returns whatever it returns. Anything this returns
 * `false` for is not necessarily a bug — it is a base nobody has proven safe,
 * which is exactly the thing that should have to be argued in review.
 */
function nonNegative(node: Node, scope: Scope, seen: ReadonlySet<string>): boolean {
  const exact = evaluate(node, scope, seen);
  if (exact !== undefined) return exact >= 0;
  if (inUnitInterval(node, scope, seen)) return true;
  if (node.kind === 'name') {
    if (seen.has(node.name)) return false;
    const local = resolveLocal(node.name, scope);
    return local !== undefined
      && nonNegative(local, scope, new Set([...seen, node.name]));
  }
  if (node.kind === 'call') {
    // Ranges GLSL itself guarantees.
    if (['abs', 'length', 'exp', 'sqrt', 'fract', 'smoothstep', 'pow', 'dot']
      .includes(node.name)) {
      // `dot(a, b)` only when it is a squared length.
      if (node.name !== 'dot') return true;
      return node.args.length === 2
        && JSON.stringify(node.args[0]) === JSON.stringify(node.args[1]);
    }
    if (node.name === 'max') {
      return node.args.some((argument) => nonNegative(argument, scope, seen));
    }
    if (node.name === 'min') {
      return node.args.every((argument) => nonNegative(argument, scope, seen));
    }
    if (node.name === 'clamp' && node.args.length === 3) {
      return nonNegative(node.args[1], scope, seen);
    }
    if (node.name === 'mix' && node.args.length === 3) {
      return nonNegative(node.args[0], scope, seen)
        && nonNegative(node.args[1], scope, seen)
        && inUnitInterval(node.args[2], scope, seen);
    }
    return false;
  }
  if (node.kind === 'binary') {
    if (node.operator === '*' || node.operator === '/') {
      return nonNegative(node.left, scope, seen) && nonNegative(node.right, scope, seen);
    }
    // `A ± B` where A is a number that dominates every value B can take —
    // `0.5 + 0.5 * cos(x)` and `1.0 - smoothstep(a, b, x)` are both this.
    const anchor = evaluate(node.left, scope, seen);
    const swing = magnitudeBound(node.right, scope, seen);
    if (anchor !== undefined && swing !== undefined && anchor >= swing) return true;
    if (node.operator === '+') {
      return nonNegative(node.left, scope, seen) && nonNegative(node.right, scope, seen);
    }
  }
  return false;
}

/** Every GLSL program this file ships, with the uniform values it is drawn
 *  with. Their texts, concatenated, are all the GLSL in the file — which the
 *  coverage test below checks rather than assumes. */
function programs(): { name: string; glsl: string; scope: Scope }[] {
  const built = [
    ['cohortIntake', makeCohortIntakeMaterial()],
    ['cohortCore', makeCohortCoreMaterial()],
  ] as const;
  return built.flatMap(([name, material]) => {
    const uniforms = new Map<string, number>();
    for (const [key, uniform] of Object.entries(material.uniforms)) {
      if (typeof uniform.value === 'number') uniforms.set(key, uniform.value);
    }
    return (['vertexShader', 'fragmentShader'] as const).map((stage) => {
      const glsl = stripComments(material[stage]).replace(/\s+/g, ' ');
      return { name: `${name}.${stage}`, glsl, scope: scopeOf(glsl, uniforms) };
    });
  });
}

describe('colonyCohort.ts — source-level shader guards', () => {
  const compiled = programs();

  it('no smoothstep anywhere has edge0 >= edge1', () => {
    // ⚠️ `smoothstep(a, b, x)` with `a >= b` is UNDEFINED in GLSL ES. It is
    // not a warning and not a fallback: on this project's own AMD/Vulkan
    // driver it once rendered NOTHING AT ALL, and in the R17 lab it produced a
    // driver-dependent funnel mouth. The fix is always `1.0 - smoothstep(b, a,
    // x)`, never a swap of the third argument. It has bitten twice; this is
    // what stops a third.
    const unprovable: string[] = [];
    let checked = 0;
    for (const program of compiled) {
      for (const args of callsOf(program.glsl, 'smoothstep')) {
        const edges = args.slice(0, 2).map((argument) => {
          const node = parseExpression(argument);
          return node === undefined
            ? undefined
            : evaluate(node, program.scope, new Set());
        });
        const [edge0, edge1] = edges;
        if (edge0 === undefined || edge1 === undefined) {
          // Edges built from a varying or a texture cannot be settled here.
          // None exist today, and the coverage claim below says so; a leg
          // that adds one has to argue it rather than slip it past.
          unprovable.push(`${program.name}: smoothstep(${args[0]},${args[1]}, …)`);
          continue;
        }
        checked += 1;
        const verdict = edge0 < edge1 ? 'ordered' : 'UNDEFINED IN GLSL ES';
        expect(`${program.name}: smoothstep(${edge0}, ${edge1}) is ${verdict}`)
          .toBe(`${program.name}: smoothstep(${edge0}, ${edge1}) is ordered`);
      }
    }
    expect(unprovable).toEqual([]);
    // ⚠️ Two of the four programs this list once held went with the accreting
    // void, and ten of the fifteen `smoothstep` calls went with them — so the
    // floor came down from 10, and back up by two when the proximity
    // exemption put one in each surviving program. It is only a
    // says-the-parser-ran check: what makes the sweep COMPLETE is the coverage
    // test below, which pins these against every call in the file.
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it('no pow anywhere can be handed a negative base', () => {
    // ⚠️ `pow(x, y)` with `x < 0` is undefined in GLSL. Use `d * d` for a
    // square, `max(x, 0.0)` where the sign is merely awkward, and a clamp
    // where it is genuinely unknown.
    const unproven: string[] = [];
    let checked = 0;
    for (const program of compiled) {
      for (const args of callsOf(program.glsl, 'pow')) {
        const node = parseExpression(args[0]);
        checked += 1;
        if (node === undefined || !nonNegative(node, program.scope, new Set())) {
          unproven.push(`${program.name}: pow(${args[0].trim()}, …)`);
        }
      }
    }
    expect(unproven).toEqual([]);
    // Same story: nine of the fourteen `pow` calls belonged to the two deleted
    // programs. The completeness claim is the coverage test below, not this.
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it('covers every smoothstep and pow the file actually contains', () => {
    // The two guards run over the compiled PROGRAMS, so they can resolve
    // uniforms and locals. This is what says the programs are the whole file:
    // a GLSL string added to a material nobody built, or to a third factory,
    // shows up here as a count that no longer matches.
    // ⚠️ A SHARED SNIPPET IS WRITTEN ONCE AND COMPILED ONCE PER USE SITE.
    // `COHORT_CONTEXT_ENERGY_GLSL` holds one `smoothstep` and is pasted into
    // both programs, so a raw file count is short by exactly one call per
    // EXTRA use. Adding that surplus back keeps this an EQUALITY rather than
    // weakening it to "at least", which would let a whole unbuilt program slip
    // through. The surplus is clamped at zero on purpose: a snippet that is
    // never interpolated then still fails here, which is the right verdict for
    // GLSL nobody compiles.
    const file = stripComments(SOURCE);
    const shared = Object.entries(colonyCohort)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
    for (const name of ['smoothstep', 'pow']) {
      const pattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
      const surplus = shared.reduce((total, [key, glsl]) => {
        const uses = [...SOURCE.matchAll(new RegExp(`\\$\\{${key}\\}`, 'g'))].length;
        const calls = [...stripComments(glsl).matchAll(pattern)].length;
        return total + calls * Math.max(uses - 1, 0);
      }, 0);
      const inFile = [...file.matchAll(pattern)].length + surplus;
      const inPrograms = compiled
        .reduce((total, program) => total + callsOf(program.glsl, name).length, 0);
      expect(`${name}: ${inPrograms} of ${inFile}`).toBe(`${name}: ${inFile} of ${inFile}`);
      expect(inFile).toBeGreaterThan(0);
    }
  });
});
