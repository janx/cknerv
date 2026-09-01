// What a cohort's APERTURE is, arithmetically — and the ceiling two additive
// draws share that neither of them can see.
//
// The mark is a hole in the colony plane, drawn as two faces of one opening: a
// disc lying in the plane, and a camera-facing halo carrying the same hole. So
// most of this file is a tie between two programs rather than a restatement of
// one, and the decisive tests move the CAMERA — the hole's agreement is a claim
// about projection, and no single pose can settle it.
//
// ⚠️ A MIRROR THAT DRIFTS PROVES NOTHING (R15 shipped exactly that), so the
// transliteration below is pinned to the shipped GLSL, term for term, by `the
// mirrors above are the shipped shaders`. Change one and the other fails.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PEER_NETWORK_PALETTE } from '../../src/visualPalette';
import {
  COHORT_AP_BREATHE_DEPTH,
  COHORT_AP_PUPIL_FRAC,
  COHORT_AP_R,
  COHORT_AP_RIM_FRAC,
  COHORT_AURA_AMP,
  COHORT_AURA_HALF,
  COHORT_AURA_HALO_BIAS,
  COHORT_AURA_HALO_BIAS_K,
  COHORT_AURA_HALO_EXP,
  COHORT_AURA_HALO_R,
  COHORT_AURA_HOT_MIX,
  COHORT_AURA_KNEE,
  COHORT_AURA_PUPIL_SCALE,
  COHORT_BREATHE_HZ,
  COHORT_CLIP_KNEE,
  COHORT_FACE_AA,
  COHORT_FACE_AMP,
  COHORT_FACE_DRIFT,
  COHORT_FACE_HALF,
  COHORT_FACE_HOT_MIX,
  COHORT_FACE_INTAKE_AMP,
  COHORT_FACE_INTAKE_CORE,
  COHORT_FACE_INTAKE_GAMMA,
  COHORT_FACE_PUPIL_SOFT,
  COHORT_FACE_RIM_AMP,
  COHORT_FACE_RIM_W,
  COHORT_FACE_STRIAE,
  COHORT_FACE_STRIAE_FLOOR,
  COHORT_FACE_STRIA_AMP,
  COHORT_FACE_STRIA_LIFT,
  COHORT_FACE_STRIA_R0,
  COHORT_FACE_STRIA_R1,
  COHORT_FACE_STRIA_W,
  COHORT_FACE_SWELL,
  COHORT_FACE_SWELL_RATE,
  cohortAuraHalfExtent,
  cohortFaceHalfExtent,
  makeCohortAuraMaterial,
  makeCohortFaceMaterial,
} from '../../src/materials/colonyCohort';

const FACE = makeCohortFaceMaterial();
const AURA = makeCohortAuraMaterial();
const FACE_FRAGMENT = FACE.fragmentShader;
const FACE_VERTEX = FACE.vertexShader;
const AURA_FRAGMENT = AURA.fragmentShader;
const AURA_VERTEX = AURA.vertexShader;

/** Whitespace-insensitive, so a statement wrapped over lines still matches. */
const squash = (glsl: string): string => glsl.replace(/\s+/g, ' ');

/** ⚠️ Comment-free, so a word written in PROSE — `noise`, `pow` — can never be
 *  mistaken for code. The file's own shader guards learned this first. */
const stripComments = (glsl: string): string =>
  glsl.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const FACE_VERTEX_CODE = stripComments(FACE_VERTEX);
const FACE_FRAGMENT_CODE = stripComments(FACE_FRAGMENT);
const AURA_VERTEX_CODE = stripComments(AURA_VERTEX);
const AURA_FRAGMENT_CODE = stripComments(AURA_FRAGMENT);

const TAU = Math.PI * 2;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const sq = (x: number): number => x * x;

/* -------------------------------------------------------------------------- *
 * The scene the sweeps run in.
 * -------------------------------------------------------------------------- */

type Vec3 = readonly [number, number, number];

/** A cohort standing in the colony plate, which sits at `Y ∈ [15, 29]`. */
const ORIGIN: Vec3 = [40, 22, -18];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => scale(a, 1 / norm3(a));
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * The camera's own world axes, exactly as the vertex shaders read them: the
 * first two ROWS of the view matrix are the camera's right and up in world
 * space, which is what `viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]`
 * picks out (three.js matrices are column-major, so `m[c][r]`).
 */
function cameraBasis(eye: Vec3, target: Vec3): { right: Vec3; up: Vec3 } {
  const forward = unit(sub(target, eye));
  const sideways = cross(forward, [0, 1, 0]);
  const right = norm3(sideways) < 1e-9 ? ([1, 0, 0] as Vec3) : unit(sideways);
  return { right, up: unit(cross(right, forward)) };
}

/** A camera `dist` away at `elevation` degrees above the plane, `azimuth` round. */
function cameraAt(dist: number, elevation: number, azimuth: number): Vec3 {
  const a = (elevation * Math.PI) / 180;
  const b = (azimuth * Math.PI) / 180;
  const flat = Math.cos(a) * dist;
  return [
    ORIGIN[0] + flat * Math.cos(b),
    ORIGIN[1] + Math.sin(a) * dist,
    ORIGIN[2] + flat * Math.sin(b),
  ];
}

/**
 * Where a view ray crosses the COLONY PLANE, as a radius about the cohort.
 *
 * ⭐ THIS ONE QUANTITY IS THE WHOLE TIE. The face reads it as `length(vP)` —
 * the fragment's own offset inside the disc — and the aura reads it as
 * `length((ro + rd * tp).xz - vOrigin.xz)`, its ray/plane crossing. They are
 * the same number about the same centre, which is why the two holes are one
 * hole rather than two that were tuned to agree.
 */
function planeRadius(eye: Vec3, ray: Vec3): number | undefined {
  if (Math.abs(ray[1]) <= 1e-5) return undefined;
  const t = (ORIGIN[1] - eye[1]) / ray[1];
  if (t <= 0) return undefined;
  const hit = add(eye, scale(ray, t));
  return Math.hypot(hit[0] - ORIGIN[0], hit[2] - ORIGIN[2]);
}

/* -------------------------------------------------------------------------- *
 * The mirrors: both fragments, term for term.
 * -------------------------------------------------------------------------- */

const SCAFFOLD = PEER_NETWORK_PALETTE.scaffold;
const COLD_WHITE = PEER_NETWORK_PALETTE.coldWhite;
const tintAt = (k: number): [number, number, number] => [
  mix(SCAFFOLD[0], COLD_WHITE[0], k),
  mix(SCAFFOLD[1], COLD_WHITE[1], k),
  mix(SCAFFOLD[2], COLD_WHITE[2], k),
];

interface Sample {
  readonly shape: number;
  readonly tint: readonly [number, number, number];
}

/** The rim's radius in world units, which every other length here is against. */
const RIM_R = Math.max(COHORT_AP_R * COHORT_AP_RIM_FRAC, 0.02);

/**
 * `pupil`, isolated: the term that makes the middle a hole.
 *
 * ⚠️ The clamp is not decoration. At `uPupilSoft = 0` the two edges would be
 * equal, and `smoothstep` with `edge0 >= edge1` is UNDEFINED in GLSL ES.
 */
function pupilAt(rho: number): number {
  const pup = Math.max(COHORT_AP_PUPIL_FRAC, 0.02);
  return smoothstep(pup * (1 - clamp(COHORT_FACE_PUPIL_SOFT, 0.02, 0.98)), pup, rho);
}

/**
 * The face fragment's `shape` and `tint`, at radius `r` in the plane.
 *
 * `bound` pins every time-varying factor at ITS OWN maximum — breathe at 1
 * (`sin = +1`), the swell at `1 + uSwell` (`cos = +1`), and the grain at 1
 * (which a purely subtractive lift makes its maximum). Those three are
 * simultaneously reachable: their phases are incommensurate in `uTime` and
 * `aSeed`, so the orbit is dense and the bound is a supremum, not a slack
 * upper estimate. `the shared ceiling is reached, not merely bounded` measures
 * that rather than assuming it.
 */
function faceAt(
  r: number,
  options: { time?: number; seed?: number; footprint?: number; azimuth?: number; bound?: boolean } = {},
): Sample | undefined {
  const { time = 0, seed = 0, footprint = 0, azimuth = 0, bound = false } = options;
  if (r > COHORT_AP_R) return undefined; // discard: the quad's corners
  const rho = r / RIM_R;
  const pupil = pupilAt(rho);
  const rim = Math.exp(-sq((rho - 1) / Math.max(COHORT_FACE_RIM_W, 0.02)));
  const outer = Math.max(COHORT_AP_R / RIM_R, 1.2);
  const uu = clamp((rho - 1) / (outer - 1), 0, 1);
  const skirt = Math.pow(1 - uu, Math.max(COHORT_FACE_INTAKE_GAMMA, 0.2));
  const fill = COHORT_FACE_INTAKE_CORE * Math.exp(-sq((rho - 1) / 0.85));
  const striaW = Math.max(COHORT_FACE_STRIA_W, 0.02);
  const striaAmt =
    COHORT_FACE_STRIA_AMP *
    smoothstep(COHORT_FACE_STRIA_R0, COHORT_FACE_STRIA_R0 + striaW, uu) *
    (1 - smoothstep(COHORT_FACE_STRIA_R1, COHORT_FACE_STRIA_R1 + striaW, uu));
  let stria: number;
  let swell: number;
  let breathe: number;
  if (bound) {
    stria = 1;
    swell = 1 + COHORT_FACE_SWELL;
    breathe = 1;
  } else {
    const phase = COHORT_FACE_STRIAE * azimuth + (time * COHORT_FACE_DRIFT + seed) * TAU;
    const dph = (COHORT_FACE_STRIAE * footprint) / Math.max(r, 1e-3);
    const pre = mix(1, Math.exp(-0.16 * dph * dph), clamp(COHORT_FACE_AA, 0, 1));
    stria = 1 + striaAmt * pre * (0.5 + 0.5 * Math.cos(phase) - COHORT_FACE_STRIA_LIFT);
    swell =
      1 +
      COHORT_FACE_SWELL *
        Math.cos(uu * 1.1 * TAU + (time * COHORT_FACE_SWELL_RATE + seed) * TAU);
    breathe =
      1 -
      COHORT_AP_BREATHE_DEPTH +
      COHORT_AP_BREATHE_DEPTH * Math.sin(time * COHORT_BREATHE_HZ + seed * TAU);
  }
  const intake = COHORT_FACE_INTAKE_AMP * (skirt + fill) * swell * stria;
  let shape = (rim * COHORT_FACE_RIM_AMP + intake) * pupil * COHORT_FACE_AMP * breathe;
  if (shape < 0.0018) return undefined; // discard
  shape = COHORT_CLIP_KNEE * (1 - Math.exp(-shape / COHORT_CLIP_KNEE));
  return { shape, tint: tintAt(COHORT_FACE_HOT_MIX * rim * pupil) };
}

/** The radius, in units of the halo's own, at which the halo is fully cut. */
const AURA_PUPIL_R =
  RIM_R * Math.max(COHORT_AP_PUPIL_FRAC, 0.05) * Math.max(COHORT_AURA_PUPIL_SCALE, 0.1);

/** The aura fragment's `shape` and `tint`, for one view ray. */
function auraAt(
  eye: Vec3,
  ray: Vec3,
  world: Vec3,
  options: { time?: number; seed?: number; bound?: boolean } = {},
): Sample | undefined {
  const { time = 0, seed = 0, bound = false } = options;
  const oc = sub(ORIGIN, eye);
  const perp = norm3(sub(oc, scale(ray, dot(oc, ray))));
  const hR = Math.max(COHORT_AP_R * COHORT_AURA_HALO_R, 0.05);
  if (perp > hR) return undefined; // discard
  let halo = Math.pow(1 - clamp(perp / hR, 0, 1), Math.max(COHORT_AURA_HALO_EXP, 0.2));
  const crossing = planeRadius(eye, ray);
  if (crossing !== undefined) {
    halo *= smoothstep(AURA_PUPIL_R * 0.45, AURA_PUPIL_R, crossing);
  }
  const dy = world[1] - ORIGIN[1];
  halo *=
    1 -
    COHORT_AURA_HALO_BIAS *
      smoothstep(
        -hR * COHORT_AURA_HALO_BIAS_K * 0.35,
        hR * Math.max(COHORT_AURA_HALO_BIAS_K, 0.05),
        dy,
      );
  const breathe = bound
    ? 1
    : 1 -
      COHORT_AP_BREATHE_DEPTH +
      COHORT_AP_BREATHE_DEPTH * Math.sin(time * COHORT_BREATHE_HZ + seed * TAU);
  let shape = halo * COHORT_AURA_AMP * breathe;
  if (shape < 0.0018) return undefined; // discard
  shape = COHORT_AURA_KNEE * (1 - Math.exp(-shape / COHORT_AURA_KNEE));
  return { shape, tint: tintAt(COHORT_AURA_HOT_MIX) };
}

/* -------------------------------------------------------------------------- *
 * The sweep both ceilings are measured over.
 * -------------------------------------------------------------------------- */

const SWEEP_DISTANCES = [12, 26, 46, 100, 300];
/** ⭐ Dense either side of ZERO, because the plane going edge-on is where the
 *  halo stops being cut and where the rim's near and far arcs fold together. */
const SWEEP_ELEVATIONS = [
  -90, -45, -20, -10, -6, -4, -2, 0, 2, 4, 6, 10, 15, 20, 30, 45, 60, 90,
];
const SWEEP_AZIMUTHS = [0, 143];
const SWEEP_GRID = 81;

/** Every (camera, ray) pair in the sweep, with the quad point the ray lands on. */
function* sweep(): Generator<{ eye: Vec3; ray: Vec3; world: Vec3 }> {
  for (const dist of SWEEP_DISTANCES) {
    for (const elevation of SWEEP_ELEVATIONS) {
      for (const azimuth of SWEEP_AZIMUTHS) {
        const eye = cameraAt(dist, elevation, azimuth);
        const { right, up } = cameraBasis(eye, ORIGIN);
        for (let i = 0; i < SWEEP_GRID; i += 1) {
          for (let j = 0; j < SWEEP_GRID; j += 1) {
            const a = ((i / (SWEEP_GRID - 1)) * 2 - 1) * COHORT_AURA_HALF;
            const b = ((j / (SWEEP_GRID - 1)) * 2 - 1) * COHORT_AURA_HALF;
            const world = add(ORIGIN, add(scale(right, a), scale(up, b)));
            yield { eye, ray: unit(sub(world, eye)), world };
          }
        }
      }
    }
  }
}

/* -------------------------------------------------------------------------- *
 * The hole.
 * -------------------------------------------------------------------------- */

describe('cohort aperture — the hole', () => {
  it('the face’s pupil reaches EXACTLY zero, and is a refusal rather than a dark disc', () => {
    // ⭐⭐⭐ THE MARK'S MIDDLE IS UNLIT, NOT DIM. Every draw in this layer is
    // additive and depth-read-only, so there is no shadow available and no dark
    // pixel is ever written: the hole is the one place bright structure REFUSES
    // to fill. "Nearly zero" would not be a hole — additive light from the aura
    // behind it would simply fill it in.
    const darkTo = RIM_R * COHORT_AP_PUPIL_FRAC * (1 - COHORT_FACE_PUPIL_SOFT);
    const litFrom = RIM_R * COHORT_AP_PUPIL_FRAC;
    expect(darkTo).toBeCloseTo(0.2604, 6);
    expect(litFrom).toBeCloseTo(0.5208, 6);

    // Exactly zero — `toBe(0)`, never `toBeCloseTo` — everywhere inside.
    // ⚠️ Stepped as an exact FRACTION of the edge rather than by accumulating
    // an increment: a `r += darkTo / 400` accumulator overshoots the edge by
    // 4e-17 and then measures the sweep's own rounding instead of the pupil.
    const darkEdge = Math.max(COHORT_AP_PUPIL_FRAC, 0.02)
      * (1 - clamp(COHORT_FACE_PUPIL_SOFT, 0.02, 0.98));
    for (let k = 0; k <= 400; k += 1) {
      const rho = darkEdge * (k / 400);
      expect(pupilAt(rho)).toBe(0);
      // And so the whole fragment is zero there, whatever the time or seed.
      for (const time of [0, 1.7, 4.4]) {
        for (const seed of [0, 0.37, 0.81]) {
          expect(faceAt(rho * RIM_R, { time, seed, azimuth: 1.1 })).toBeUndefined();
        }
      }
    }
    // Zero right up to the edge, inclusive, and lit immediately outside it —
    // a boundary rather than a plateau that fades.
    expect(pupilAt(darkEdge)).toBe(0);
    expect(pupilAt(darkEdge * 1.02)).toBeGreaterThan(0);
    expect(pupilAt(Math.max(COHORT_AP_PUPIL_FRAC, 0.02))).toBe(1);

    // ⭐ And the darkness is the PUPIL's, not the discard threshold's: the
    // shape is identically zero well before anything is merely too faint.
    expect(faceAt(darkTo * 0.5, { bound: true })).toBeUndefined();
    expect(faceAt(litFrom, { bound: true })?.shape).toBeGreaterThan(0.4);
  });

  it('the aura’s hole is the SAME hole, at every camera, derived from the crossing', () => {
    // ⭐⭐⭐ NOT TWO HOLES THAT AGREE — ONE HOLE READ THROUGH TWO RAYS. The face
    // measures its radius inside the disc; the aura measures its radius by
    // crossing the view ray with the colony plane. Both are a distance in the
    // SAME plane about the SAME centre, so their ratio is a constant of the
    // design and cannot drift with the camera. Anything less would be a hole
    // that wandered off its own mark as the viewer moved.
    expect(AURA_PUPIL_R / (RIM_R * COHORT_AP_PUPIL_FRAC)).toBe(COHORT_AURA_PUPIL_SCALE);

    let tested = 0;
    let cut = 0;
    let uncut = 0;
    let elevationsWithACut = 0;
    for (const dist of SWEEP_DISTANCES) {
      for (const elevation of SWEEP_ELEVATIONS) {
        let cutHere = 0;
        const eye = cameraAt(dist, elevation, 37);
        const { right, up } = cameraBasis(eye, ORIGIN);
        for (let i = 0; i < 121; i += 1) {
          for (let j = 0; j < 121; j += 1) {
            const a = ((i / 120) * 2 - 1) * COHORT_AURA_HALF;
            const b = ((j / 120) * 2 - 1) * COHORT_AURA_HALF;
            const world = add(ORIGIN, add(scale(right, a), scale(up, b)));
            const ray = unit(sub(world, eye));
            const crossing = planeRadius(eye, ray);
            if (crossing === undefined) continue;
            const aura = auraAt(eye, ray, world, { bound: true });
            tested += 1;

            // The centre agrees: a ray crossing the plane AT the cohort is cut
            // to nothing by the aura and lands in the face's dead pupil.
            if (crossing <= AURA_PUPIL_R * 0.45) {
              expect(aura).toBeUndefined();
              cut += 1;
              cutHere += 1;
            }
            // And past the hole the halo is uncut — so the cut is a hole and
            // not a general dimming.
            if (crossing >= AURA_PUPIL_R && aura !== undefined) {
              uncut += 1;
            }
            // ⭐ THE APPARENT RADIUS IS THE PROJECTION OF ONE DISC. Whatever
            // the camera, a ray is inside the aura's hole precisely when its
            // plane crossing is inside 1.35x the face's pupil — so the two
            // holes project to the same ellipse up to that one factor, at
            // every pose, without either program restating the other's number.
            const insideAura = crossing < AURA_PUPIL_R;
            const insideFaceScaled =
              crossing < RIM_R * COHORT_AP_PUPIL_FRAC * COHORT_AURA_PUPIL_SCALE;
            expect(insideAura).toBe(insideFaceScaled);
          }
        }
        if (cutHere > 0) elevationsWithACut += 1;
      }
    }
    expect(tested).toBeGreaterThan(500_000);
    expect(cut).toBeGreaterThan(1_000);
    expect(uncut).toBeGreaterThan(100_000);
    // The hole is visible from most poses and closes up on its own as the
    // plane goes edge-on, which is the behaviour the halo's cut exists for.
    expect(elevationsWithACut).toBeGreaterThan(SWEEP_DISTANCES.length * 8);
  });

  it('closes the halo’s hole at grazing incidence, which is what keeps the mark a blob', () => {
    // ⭐ The conflict this resolves has no other answer: a halo strong enough
    // to stop the mark reading as a dash at 12° also floods the pupil at 30°.
    // The ray/plane cut settles both at once, because the hole's PROJECTED
    // AREA goes to zero on its own as the plane turns edge-on.
    const holeArea = (elevation: number): number => {
      const eye = cameraAt(46, elevation, 0);
      const { right, up } = cameraBasis(eye, ORIGIN);
      let inside = 0;
      const step = (2 * COHORT_AURA_HALF) / 200;
      for (let i = 0; i <= 200; i += 1) {
        for (let j = 0; j <= 200; j += 1) {
          const a = (i / 200) * 2 * COHORT_AURA_HALF - COHORT_AURA_HALF;
          const b = (j / 200) * 2 * COHORT_AURA_HALF - COHORT_AURA_HALF;
          const world = add(ORIGIN, add(scale(right, a), scale(up, b)));
          const crossing = planeRadius(eye, unit(sub(world, eye)));
          if (crossing !== undefined && crossing < AURA_PUPIL_R) inside += 1;
        }
      }
      return inside * step * step;
    };
    const overhead = holeArea(90);
    const middling = holeArea(30);
    const grazing = holeArea(4);
    expect(overhead).toBeGreaterThan(middling);
    expect(middling).toBeGreaterThan(grazing);
    // From overhead the hole is the pupil disc seen face-on; at 4° it has all
    // but shut, which is why the halo fills in exactly when the face cannot.
    expect(grazing / overhead).toBeLessThan(0.15);
  });
});

/* -------------------------------------------------------------------------- *
 * The ceiling the two draws share.
 * -------------------------------------------------------------------------- */

describe('cohort aperture — the ceiling two additive draws share', () => {
  it('rests under 1.0 in EVERY channel, measured over the whole camera sweep', () => {
    // ⚠️⚠️⚠️ THIS LAW HAS COST THIS FEATURE A FULL LIVE LEG. Additive blending
    // takes source alpha as its factor, so each draw contributes
    // `uColor * shape²`, and blue is EXACTLY 1.0 in both `scaffold` and
    // `coldWhite`. A pixel over 1.0 in blue clips to flat white-cyan and the
    // structure the whole form is about stops being visible.
    expect(SCAFFOLD[2]).toBe(1);
    expect(COLD_WHITE[2]).toBe(1);

    let supremum: [number, number, number] = [0, 0, 0];
    let faceSupremum = 0;
    let auraSupremum = 0;
    let samples = 0;
    for (const { eye, ray, world } of sweep()) {
      samples += 1;
      const channel = [0, 0, 0];
      const crossing = planeRadius(eye, ray);
      if (crossing !== undefined) {
        const face = faceAt(crossing, { bound: true });
        if (face !== undefined) {
          for (let c = 0; c < 3; c += 1) channel[c] += face.tint[c] * face.shape * face.shape;
          faceSupremum = Math.max(faceSupremum, face.shape);
        }
      }
      const aura = auraAt(eye, ray, world, { bound: true });
      if (aura !== undefined) {
        for (let c = 0; c < 3; c += 1) channel[c] += aura.tint[c] * aura.shape * aura.shape;
        auraSupremum = Math.max(auraSupremum, aura.shape);
      }
      for (let c = 0; c < 3; c += 1) {
        if (channel[c] > supremum[c]) supremum[c] = channel[c];
      }
    }
    expect(samples).toBe(
      SWEEP_DISTANCES.length * SWEEP_ELEVATIONS.length * SWEEP_AZIMUTHS.length
        * SWEEP_GRID * SWEEP_GRID,
    );

    // Each draw against its own knee, and then the sum, which is the number
    // that matters and the one the lab never measured.
    expect(faceSupremum).toBeCloseTo(0.851245, 5);
    expect(faceSupremum).toBeLessThan(COHORT_CLIP_KNEE);
    expect(auraSupremum).toBeCloseTo(0.357203, 5);
    expect(auraSupremum).toBeLessThan(COHORT_AURA_KNEE);
    expect(supremum[0]).toBeCloseTo(0.338322, 4);
    expect(supremum[1]).toBeCloseTo(0.748928, 4);
    expect(supremum[2]).toBeCloseTo(0.847535, 4);
    for (const channel of supremum) expect(channel).toBeLessThan(1);
    // Blue is the binding channel, because both colours are full in it.
    expect(supremum[2]).toBeGreaterThan(supremum[1]);
    expect(supremum[2]).toBeGreaterThan(supremum[0]);

    // ⚠️ WHAT THE LAB SHIPPED, FOR THE RECORD. Kneeing both faces at
    // `COHORT_CLIP_KNEE` — each measured alone — puts the SUM at 1.067 in
    // blue, at every distance from 8 to 300 wu, because at low elevation the
    // rim's near and far arcs fold onto the halo's own peak.
    const auraAtHouseKnee =
      COHORT_CLIP_KNEE * (1 - Math.exp(-0.93468 / COHORT_CLIP_KNEE));
    expect(sq(faceSupremum) + sq(auraAtHouseKnee)).toBeGreaterThan(1);
  });

  it('and that ceiling is ARITHMETIC, not merely a swept observation', () => {
    // ⭐ The two knees are a Pythagorean pair, so the two shapes lie strictly
    // inside the unit circle and blue is strictly under 1 at EVERY pixel,
    // camera, time and knob setting — not only at the ones swept above.
    expect(COHORT_AURA_KNEE).toBe(Math.sqrt(1 - COHORT_CLIP_KNEE ** 2));
    expect(sq(COHORT_CLIP_KNEE) + sq(COHORT_AURA_KNEE)).toBeCloseTo(1, 12);
    // Strictly, because `k * (1 - exp(-s / k)) < k` for every finite input:
    // the knee approaches its ceiling and never reaches it.
    //
    // ⚠️ IN EXACT ARITHMETIC, AND THE FLOAT CAVEAT IS MEASURED RATHER THAN
    // WAVED AT. `1 - exp(-s / k)` rounds to exactly 1 once `exp(-s / k)` drops
    // below half an ulp of 1, which is at `s / k` = 37.4 in float64 — NOT at
    // the ~745 where `exp` itself underflows. Past that the knee equals its
    // ceiling and the two would sum to exactly 1 rather than under it.
    for (const s of [0.0018, 0.05, 0.5, 1, 2.4, 5]) {
      expect(COHORT_CLIP_KNEE * (1 - Math.exp(-s / COHORT_CLIP_KNEE)))
        .toBeLessThan(COHORT_CLIP_KNEE);
      expect(COHORT_AURA_KNEE * (1 - Math.exp(-s / COHORT_AURA_KNEE)))
        .toBeLessThan(COHORT_AURA_KNEE);
    }
    // ⭐ And that boundary is 14x further out than anything either face can
    // hand its knee: the face's pre-knee shape tops out at 2.39 (`s / k` =
    // 2.59) and the aura's at 0.93 (`s / k` = 2.39). The strictness is real at
    // every input this form produces, with an order of magnitude to spare.
    const ROUNDS_TO_ONE = 37.4;
    expect(2.3863 / COHORT_CLIP_KNEE).toBeLessThan(ROUNDS_TO_ONE / 14);
    expect(0.93468 / COHORT_AURA_KNEE).toBeLessThan(ROUNDS_TO_ONE / 14);
    // The boundary itself, either side of it, for the record.
    expect(COHORT_CLIP_KNEE * (1 - Math.exp(-36))).toBeLessThan(COHORT_CLIP_KNEE);
    expect(COHORT_CLIP_KNEE * (1 - Math.exp(-40))).toBe(COHORT_CLIP_KNEE);
    expect(COHORT_AURA_KNEE * (1 - Math.exp(-40))).toBe(COHORT_AURA_KNEE);
    // ⭐ A KNEE AND NEVER A SCALE, and the face's is untouched — the whole
    // correction is taken out of the halo, none of it out of the structure.
    expect(FACE.uniforms.uKnee.value).toBe(COHORT_CLIP_KNEE);
    expect(AURA.uniforms.uKnee.value).toBe(COHORT_AURA_KNEE);
    expect(COHORT_AURA_KNEE).toBeLessThan(COHORT_CLIP_KNEE);
  });

  it('the shared ceiling is REACHED, not merely bounded', () => {
    // ⚠️ A supremum built by pinning each time factor at its own maximum is
    // only a bound until the maxima are shown to be simultaneously reachable.
    // They are: the breathe, the swell and the grain have incommensurate
    // phases in `uTime` and `aSeed`, so a real (time, seed) gets arbitrarily
    // close to all three at once. Measured at the rim, where the grain's
    // envelope is zero and only two of the three have to meet.
    const rim = RIM_R;
    const bound = faceAt(rim, { bound: true });
    expect(bound).toBeDefined();
    let best = 0;
    for (let step = 0; step < 4000; step += 1) {
      const time = step * 0.0173;
      for (let s = 0; s < 200; s += 1) {
        const live = faceAt(rim, { time, seed: s / 200, azimuth: 0.7 });
        if (live !== undefined && live.shape > best) best = live.shape;
      }
    }
    expect(best / (bound?.shape ?? 1)).toBeGreaterThan(0.9999);
  });
});

/* -------------------------------------------------------------------------- *
 * The grain.
 * -------------------------------------------------------------------------- */

describe('cohort aperture — the grain, and why it is not a sunflower', () => {
  it('carries at least the measured striae floor, which count alone can clear', () => {
    // ⭐⭐⭐ MEASURED OVER 48 VARIANTS AND FOUR SWEEPS: at 44 radial striae or
    // fewer, radial structure on a small bright mark reads as a STAR — and it
    // does so regardless of the modulation's SIGN (additive, subtractive or
    // symmetric), its CONTRAST (0.22 to 0.9) or its REACH. None of those three
    // recovers it. COUNT IS THE ONLY ESCAPE: past roughly 64 the striae stop
    // being countable and become a texture, which is what a medium being drawn
    // inward actually looks like. This is the floor, and it is not a taste.
    expect(COHORT_FACE_STRIAE_FLOOR).toBe(64);
    expect(COHORT_FACE_STRIAE).toBeGreaterThanOrEqual(COHORT_FACE_STRIAE_FLOOR);
    expect(COHORT_FACE_STRIAE).toBe(88);
    // Comfortably clear of it, and clear of the 44 that failed, so a small
    // future re-tune cannot walk back into the sunflower.
    expect(COHORT_FACE_STRIAE / COHORT_FACE_STRIAE_FLOOR).toBeGreaterThan(1.3);
    expect(COHORT_FACE_STRIAE / 44).toBeGreaterThanOrEqual(2);
    // One stria is 4.09° of azimuth: below anything a viewer counts.
    expect(360 / COHORT_FACE_STRIAE).toBeCloseTo(4.0909, 4);
    // It is an integer, or the pattern would not close on itself round the
    // mark and one stria would be a visible seam.
    expect(Number.isInteger(COHORT_FACE_STRIAE)).toBe(true);
    // And the shipped material really binds it.
    expect(FACE.uniforms.uStriae.value).toBe(COHORT_FACE_STRIAE);
  });

  it('modulates PURELY SUBTRACTIVELY, so the silhouette can never scallop', () => {
    // ⭐⭐⭐ THE OTHER HALF OF THE SUNFLOWER PROBLEM, and the half that count
    // cannot fix. With a mean-preserving or additive modulation the outline is
    // the iso-brightness contour, so any grain amplitude near the visible edge
    // pushes that contour OUTWARD under every stria and the mark grows petals.
    // A lift of 1 makes the modulation lie in `[1 - amt, 1]`: a stria can only
    // ever REMOVE light, so the outline stays exactly where the smooth halo
    // put it and the grain is carved into the interior.
    expect(COHORT_FACE_STRIA_LIFT).toBe(1);
    for (let phase = 0; phase < TAU; phase += TAU / 720) {
      const modulation = 0.5 + 0.5 * Math.cos(phase) - COHORT_FACE_STRIA_LIFT;
      expect(modulation).toBeLessThanOrEqual(0);
      expect(modulation).toBeGreaterThanOrEqual(-1 - 1e-12);
    }

    // So at every radius the brightest azimuth is the SMOOTH profile, exactly.
    for (let r = 0.3; r < COHORT_AP_R; r += 0.01) {
      const smooth = faceAt(r, { bound: true });
      let brightest = 0;
      for (let k = 0; k < 176; k += 1) {
        const live = faceAt(r, { azimuth: (k / 176) * TAU, seed: 0.31, time: 3.3 });
        brightest = Math.max(brightest, live?.shape ?? 0);
      }
      // The smooth bound also carries the swell and breathe at their maxima,
      // so it dominates; what matters is that no azimuth ever exceeds it.
      expect(brightest).toBeLessThanOrEqual((smooth?.shape ?? 0) + 1e-12);
    }
  });

  it('prefilters to nothing as the mark shrinks, so the grain is a zoom-in detail', () => {
    // ⭐ 88 striae across a 6 wu mark alias into moiré the moment the mark is
    // small on screen. The prefilter damps them by their own screen footprint,
    // so what survives at scene scale is a smooth ring — and the grain is
    // never a scene-scale cue that would have to mean something.
    // The prefilter term itself, which is what the fragment computes.
    const RADIUS = 1.8; // out in the visible skirt, where the grain lives
    const prefilter = (footprint: number): number => {
      const dph = (COHORT_FACE_STRIAE * footprint) / RADIUS;
      return Math.exp(-0.16 * dph * dph);
    };
    // Measured, not asserted: the curve, at footprints in world units.
    expect(prefilter(0)).toBe(1);
    expect(prefilter(0.02)).toBeCloseTo(0.8582, 4);
    expect(prefilter(0.04)).toBeCloseTo(0.5423, 4);
    expect(prefilter(0.08)).toBeCloseTo(0.08651, 5);
    expect(prefilter(0.12)).toBeCloseTo(0.004059, 6);

    // And the grain's actual azimuthal swing follows it down.
    const swing = (footprint: number): number => {
      let low = Infinity;
      let high = 0;
      for (let k = 0; k < 176; k += 1) {
        const live = faceAt(RADIUS, { azimuth: (k / 176) * TAU, footprint, time: 0, seed: 0 });
        const shape = live?.shape ?? 0;
        low = Math.min(low, shape);
        high = Math.max(high, shape);
      }
      return high - low;
    };
    const sharp = swing(0);
    expect(sharp).toBeGreaterThan(0.02);
    expect(swing(0.08) / sharp).toBeLessThan(0.10);
    expect(swing(0.2) / sharp).toBeLessThan(1e-5);

    // ⚠️ WHAT THAT IS IN CAMERA DISTANCE, AGAINST THE APP'S OWN CAMERA — and
    // it is NOT the "~25 wu" the plan claims. The scene's Canvas runs a 47°
    // VERTICAL field, so on a 1080-line frame one pixel spans
    // `2 * D * tan(23.5°) / 1080` world units. Measured on that camera the
    // grain is still at 86 % at 25 wu and 59 % at 46; it reaches a tenth only
    // near 100 wu and is gone by 300. It IS a zoom-in detail, but the zoom it
    // needs is roughly four times closer than the plan stated.
    const APP_FOV_DEGREES = 47;
    const worldPerPixel = (D: number, lines = 1080): number =>
      (2 * D * Math.tan((APP_FOV_DEGREES * Math.PI) / 360)) / lines;
    expect(prefilter(worldPerPixel(12))).toBeCloseTo(0.96493, 5);
    expect(prefilter(worldPerPixel(25))).toBeCloseTo(0.85644, 5);
    expect(prefilter(worldPerPixel(46))).toBeCloseTo(0.59176, 5);
    expect(prefilter(worldPerPixel(100))).toBeCloseTo(0.083789, 6);
    expect(prefilter(worldPerPixel(300))).toBeLessThan(1e-9);
    // ⚠️ AND IT MOVES WITH DPR, which this layer's quality presets drive. At
    // DPR 2 the footprint halves and the grain survives twice as far out —
    // still 54 % at 100 wu. Any future claim about where the grain "goes away"
    // has to name a resolution as well as a distance.
    expect(prefilter(worldPerPixel(100, 2160))).toBeCloseTo(0.53802, 5);
  });
});

/* -------------------------------------------------------------------------- *
 * A circle, in the colony's own plane.
 * -------------------------------------------------------------------------- */

describe('cohort aperture — a circle in the colony plane', () => {
  it('has NO per-cohort orientation term anywhere in either program', () => {
    // ⭐ The register violation this stays clear of is a mark with an axis a
    // viewer could read as pointing somewhere. Sharing the COLONY's plane is
    // not that: the plane's normal is world Y, which is the colony's own
    // rotation axis, so the face inherits one orientation that every cohort
    // shares and none of its own.
    for (const program of [
      FACE_VERTEX_CODE, FACE_FRAGMENT_CODE, AURA_VERTEX_CODE, AURA_FRAGMENT_CODE,
    ]) {
      // No per-instance angle, axis or basis lane.
      expect(program).not.toMatch(/attribute\s+(float|vec\d|mat\d)\s+a(Angle|Axis|Turn|Rot|Orient|Basis|Normal|Up)/);
      // No rotation built in the shader either.
      expect(program).not.toMatch(/\bmat2\s*\(/);
      expect(program).not.toMatch(/\bmat3\s*\(/);
      expect(program).not.toMatch(/\brotate\w*\s*\(/);
    }
    // ⭐ The only per-instance lane on either face is the seed. `aShare` is
    // deliberately ABSENT: share means RATE on this layer, and the only rate
    // either aperture program has is the grain's drift — which the prefilter
    // takes to nothing before the mark is small enough to compare cohorts
    // against each other, so a share lane here would carry a fact no viewer
    // could read. It stays off until something measurable wants it.
    for (const vertex of [FACE_VERTEX_CODE, AURA_VERTEX_CODE]) {
      const attributes = [...vertex.matchAll(/attribute\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]);
      expect(attributes).toEqual(['aSeed']);
    }
    for (const fragment of [FACE_FRAGMENT_CODE, AURA_FRAGMENT_CODE]) {
      expect(fragment).not.toMatch(/\battribute\b/);
      expect(fragment).not.toMatch(/\baShare\b/);
    }
    // And no orientation arrives through the transform either: the face is
    // laid into the instance's own XZ with no matrix of its own.
    expect(squash(FACE_VERTEX))
      .toContain('vec3 local = vec3(position.x, 0.0, position.y) * uHalf * 2.0;');
    expect(FACE_VERTEX).not.toContain('normalMatrix');
  });

  it('is exactly invariant under a turn of one stria, so it points nowhere', () => {
    // ⭐ The ONLY azimuth-dependent term in the face is `uStriae * th`, which
    // is 88-fold symmetric. Turning a cohort by 2π/88 about its own axis
    // reproduces the image EXACTLY — so the seed's azimuthal phase is a
    // texture offset inside one stria, never a heading a viewer could read.
    const period = TAU / COHORT_FACE_STRIAE;
    let compared = 0;
    for (const r of [0.4, 0.62, 0.84, 1.3, 2.1, 2.5]) {
      for (const seed of [0, 0.31, 0.77]) {
        for (const time of [0, 2.6]) {
          const here = faceAt(r, { azimuth: 0.37, seed, time });
          const turned = faceAt(r, { azimuth: 0.37 + period, seed, time });
          // Either both are lit and agree, or both discard — the symmetry has
          // to hold on the discard too, or the mark's edge would have a seam.
          expect(turned === undefined).toBe(here === undefined);
          if (here === undefined || turned === undefined) continue;
          expect(turned.shape).toBeCloseTo(here.shape, 12);
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(30);
    // Nothing else in the face depends on azimuth at all: the pupil, rim,
    // skirt and swell are functions of radius alone, so the silhouette is a
    // circle and every ellipse a viewer sees is projection.
    for (const r of [0.4, 0.84, 1.7]) {
      const shapes = new Set<number>();
      for (let k = 0; k < 64; k += 1) {
        shapes.add(Number((faceAt(r, { azimuth: (k / 64) * TAU, bound: true })?.shape ?? 0).toFixed(12)));
      }
      expect(shapes.size).toBe(1);
    }
  });

  it('foreshortens with the plane rather than facing the camera', () => {
    // ⭐ The face's extent on screen has to CHANGE with elevation — that
    // agreement across all four cohorts is what makes the colony plane itself
    // legible, and it is the one thing a billboard could not do.
    const litArea = (elevation: number): number => {
      const eye = cameraAt(46, elevation, 0);
      const { right, up } = cameraBasis(eye, ORIGIN);
      const step = (2 * COHORT_AURA_HALF) / 240;
      let inside = 0;
      for (let i = 0; i <= 240; i += 1) {
        for (let j = 0; j <= 240; j += 1) {
          const a = (i / 240) * 2 * COHORT_AURA_HALF - COHORT_AURA_HALF;
          const b = (j / 240) * 2 * COHORT_AURA_HALF - COHORT_AURA_HALF;
          const world = add(ORIGIN, add(scale(right, a), scale(up, b)));
          const crossing = planeRadius(eye, unit(sub(world, eye)));
          if (crossing !== undefined && faceAt(crossing, { bound: true }) !== undefined) inside += 1;
        }
      }
      return inside * step * step;
    };
    const overhead = litArea(90);
    const middling = litArea(30);
    const grazing = litArea(6);
    expect(overhead).toBeGreaterThan(middling * 1.5);
    expect(middling).toBeGreaterThan(grazing * 1.5);
    // Which is exactly why the aura is load-bearing rather than decorative:
    // where the face has all but gone, something view-independent has to hold
    // the mark's area or it reads as a dash among the peer links.
    expect(grazing / overhead).toBeLessThan(0.25);
  });
});

/* -------------------------------------------------------------------------- *
 * The mirrors are the shipped shaders.
 * -------------------------------------------------------------------------- */

describe('cohort aperture — the mirrors above are the shipped shaders', () => {
  it('the face, term for term', () => {
    // ⚠️ Everything measured in this file runs on the transliteration at the
    // top, so the transliteration has to be tied to the GLSL that ships.
    const glsl = squash(FACE_FRAGMENT);
    expect(glsl).toContain('float rimR = max(uApR * uRimFrac, 0.02);');
    expect(glsl).toContain('float rho = r / rimR;');
    expect(glsl).toContain('float pup = max(uPupilFrac, 0.02);');
    expect(glsl).toContain(
      'float pupil = smoothstep( pup * (1.0 - clamp(uPupilSoft, 0.02, 0.98)), pup, rho );',
    );
    expect(glsl).toContain('float rim = exp(-sq((rho - 1.0) / max(uRimW, 0.02)));');
    expect(glsl).toContain('float outer = max(uApR / rimR, 1.2);');
    expect(glsl).toContain('float uu = clamp((rho - 1.0) / (outer - 1.0), 0.0, 1.0);');
    expect(glsl).toContain('float skirt = pow(1.0 - uu, max(uInGamma, 0.2));');
    expect(glsl).toContain('float fill = uInCore * exp(-sq((rho - 1.0) / 0.85));');
    expect(glsl).toContain('float ph = uStriae * th + (uTime * uDrift + vSeed) * TAU;');
    expect(glsl).toContain('float dph = uStriae * foot / max(r, 1e-3);');
    expect(glsl).toContain('float pre = mix(1.0, exp(-0.16 * dph * dph), clamp(uAa, 0.0, 1.0));');
    expect(glsl).toContain('float striaW = max(uStriaW, 0.02);');
    expect(glsl).toContain(
      'float striaAmt = uStriaAmp * smoothstep(uStriaR0, uStriaR0 + striaW, uu)'
        + ' * (1.0 - smoothstep(uStriaR1, uStriaR1 + striaW, uu));',
    );
    expect(glsl).toContain(
      'float stria = 1.0 + striaAmt * pre * ((0.5 + 0.5 * cos(ph)) - uStriaLift);',
    );
    expect(glsl).toContain(
      'float swell = 1.0 + uSwell * cos(uu * 1.10 * TAU + (uTime * uSwellRate + vSeed) * TAU);',
    );
    expect(glsl).toContain('float intake = uInAmp * (skirt + fill) * swell * stria;');
    expect(glsl).toContain(
      'float breathe = 1.0 - uBreatheDepth + uBreatheDepth * sin(uTime * uBreatheHz + vSeed * TAU);',
    );
    expect(glsl).toContain('float shape = (rim * uRimAmp + intake) * pupil * uAmp * breathe;');
    expect(glsl).toContain('if (shape < 0.0018) discard;');
    expect(glsl).toContain('shape = uKnee * (1.0 - exp(-shape / uKnee));');
    expect(glsl).toContain('vec3 tint = mix(uColor, uHot, uHotMix * rim * pupil);');
    // ⭐ Energy multiplies RGB and NEVER alpha — the house idiom that keeps
    // additive damping linear.
    expect(glsl).toContain('gl_FragColor = vec4(tint * shape * cohortEnergy, shape);');
    // The corner discard, which is what makes a square quad legal for a disc.
    expect(glsl).toContain('if (r > uApR) discard;');
  });

  it('the aura, term for term — and its hole is derived, never restated', () => {
    const glsl = squash(AURA_FRAGMENT);
    expect(glsl).toContain('vec3 rd = normalize(vWorld - ro);');
    expect(glsl).toContain('float perp = length(oc - rd * tc);');
    expect(glsl).toContain('float hR = max(uApR * uHaloR, 0.05);');
    expect(glsl).toContain('if (perp > hR) discard;');
    expect(glsl).toContain('float hx = clamp(perp / hR, 0.0, 1.0);');
    expect(glsl).toContain('float halo = pow(1.0 - hx, max(uHaloExp, 0.2));');
    // ⭐⭐⭐ THE HOLE, CUT BY THE RAY/PLANE CROSSING. `pupR` is built from the
    // SAME `uApR`, `uRimFrac` and `uPupilFrac` the face reads, scaled once by
    // `uHaloPupil`; and the distance it is compared against is measured in the
    // colony plane about the cohort's own centre. There is no second pupil
    // anywhere for the two to drift apart on.
    expect(glsl).toContain('float rimR = max(uApR * uRimFrac, 0.02);');
    expect(glsl).toContain(
      'float pupR = rimR * max(uPupilFrac, 0.05) * max(uHaloPupil, 0.1);',
    );
    expect(glsl).toContain('float tp = (vOrigin.y - ro.y) / rd.y;');
    expect(glsl).toContain('float planeR = length((ro + rd * tp).xz - vOrigin.xz);');
    expect(glsl).toContain('halo *= smoothstep(pupR * 0.45, pupR, planeR);');
    // Guarded on both sides: a ray parallel to the plane never crosses it, and
    // a crossing behind the camera is not one the viewer can see.
    expect(glsl).toContain('if (abs(rd.y) > 1e-5) {');
    expect(glsl).toContain('if (tp > 0.0) {');
    expect(glsl).toContain(
      'halo *= 1.0 - uHaloBias * smoothstep( -hR * uHaloBiasK * 0.35,'
        + ' hR * max(uHaloBiasK, 0.05), dy );',
    );
    expect(glsl).toContain('shape = uKnee * (1.0 - exp(-shape / uKnee));');
    expect(glsl).toContain('gl_FragColor = vec4(tint * shape * cohortEnergy, shape);');
    // ⛔ Nothing volumetric, and nothing at all below the plane: the lab's
    // short sub-plane march measured invisible except from directly overhead
    // and did not earn a draw.
    expect(squash(AURA_FRAGMENT_CODE)).not.toContain('for (');
    expect(squash(AURA_FRAGMENT_CODE)).not.toMatch(/\bfbm\b|\bnoise\b|\bsnoise\b|\bhash\b/);
  });

  it('neither program contains noise of any kind', () => {
    // ⭐ The mark this replaced was the scene's sole `fbm`, and one of five
    // register violations it spent on the same idea.
    for (const program of [
      FACE_VERTEX_CODE, FACE_FRAGMENT_CODE, AURA_VERTEX_CODE, AURA_FRAGMENT_CODE,
    ]) {
      expect(program).not.toMatch(/\bfbm\b|\bnoise\b|\bsnoise\b|\bhash\b|\btexture2D\b|\bsampler/);
      // `fract` is how a hash is usually spelled in this house; there is none.
      expect(program).not.toMatch(/\bfract\s*\(/);
    }
    // ⚠️ And the sweep above really is comment-free, or it would be proving
    // nothing: the face's own prose says the word "noise" out loud.
    expect(FACE_FRAGMENT).toMatch(/\bnoise\b/);
    expect(FACE_FRAGMENT_CODE).not.toMatch(/\bnoise\b/);
  });
});

/* -------------------------------------------------------------------------- *
 * The materials themselves.
 * -------------------------------------------------------------------------- */

describe('cohort aperture — the materials', () => {
  it('bind the constants the proofs above rest on', () => {
    expect(FACE.uniforms.uApR.value).toBe(COHORT_AP_R);
    expect(FACE.uniforms.uRimFrac.value).toBe(COHORT_AP_RIM_FRAC);
    expect(FACE.uniforms.uPupilFrac.value).toBe(COHORT_AP_PUPIL_FRAC);
    expect(FACE.uniforms.uPupilSoft.value).toBe(COHORT_FACE_PUPIL_SOFT);
    expect(FACE.uniforms.uRimW.value).toBe(COHORT_FACE_RIM_W);
    expect(FACE.uniforms.uRimAmp.value).toBe(COHORT_FACE_RIM_AMP);
    expect(FACE.uniforms.uHotMix.value).toBe(COHORT_FACE_HOT_MIX);
    expect(FACE.uniforms.uInAmp.value).toBe(COHORT_FACE_INTAKE_AMP);
    expect(FACE.uniforms.uInGamma.value).toBe(COHORT_FACE_INTAKE_GAMMA);
    expect(FACE.uniforms.uInCore.value).toBe(COHORT_FACE_INTAKE_CORE);
    expect(FACE.uniforms.uStriaAmp.value).toBe(COHORT_FACE_STRIA_AMP);
    expect(FACE.uniforms.uStriaLift.value).toBe(COHORT_FACE_STRIA_LIFT);
    expect(FACE.uniforms.uStriaR0.value).toBe(COHORT_FACE_STRIA_R0);
    expect(FACE.uniforms.uStriaR1.value).toBe(COHORT_FACE_STRIA_R1);
    expect(FACE.uniforms.uStriaW.value).toBe(COHORT_FACE_STRIA_W);
    expect(FACE.uniforms.uDrift.value).toBe(COHORT_FACE_DRIFT);
    expect(FACE.uniforms.uSwell.value).toBe(COHORT_FACE_SWELL);
    expect(FACE.uniforms.uSwellRate.value).toBe(COHORT_FACE_SWELL_RATE);
    expect(FACE.uniforms.uAa.value).toBe(COHORT_FACE_AA);
    expect(FACE.uniforms.uAmp.value).toBe(COHORT_FACE_AMP);

    expect(AURA.uniforms.uApR.value).toBe(COHORT_AP_R);
    expect(AURA.uniforms.uRimFrac.value).toBe(COHORT_AP_RIM_FRAC);
    expect(AURA.uniforms.uPupilFrac.value).toBe(COHORT_AP_PUPIL_FRAC);
    expect(AURA.uniforms.uHaloExp.value).toBe(COHORT_AURA_HALO_EXP);
    expect(AURA.uniforms.uHaloR.value).toBe(COHORT_AURA_HALO_R);
    expect(AURA.uniforms.uHaloBias.value).toBe(COHORT_AURA_HALO_BIAS);
    expect(AURA.uniforms.uHaloBiasK.value).toBe(COHORT_AURA_HALO_BIAS_K);
    expect(AURA.uniforms.uHaloPupil.value).toBe(COHORT_AURA_PUPIL_SCALE);
    expect(AURA.uniforms.uHotMix.value).toBe(COHORT_AURA_HOT_MIX);
    expect(AURA.uniforms.uAmp.value).toBe(COHORT_AURA_AMP);

    // ⭐ THE THREE APERTURE NUMBERS BOTH FACES READ. They are the reason the
    // two holes are one hole; a copy on either side would be the drift.
    for (const material of [FACE, AURA]) {
      expect(material.uniforms.uApR.value).toBe(COHORT_AP_R);
      expect(material.uniforms.uRimFrac.value).toBe(COHORT_AP_RIM_FRAC);
      expect(material.uniforms.uPupilFrac.value).toBe(COHORT_AP_PUPIL_FRAC);
      // One mark, one cadence: the depth is per-face, the RATE is the file's.
      expect(material.uniforms.uBreatheHz.value).toBe(COHORT_BREATHE_HZ);
      expect(material.uniforms.uBreatheDepth.value).toBe(COHORT_AP_BREATHE_DEPTH);
      expect(material.uniforms.uContextEnergy.value).toBe(1);
      expect(material.uniforms.uTime.value).toBe(0);
      const colour = material.uniforms.uColor.value as THREE.Color;
      expect([colour.r, colour.g, colour.b]).toEqual([...PEER_NETWORK_PALETTE.scaffold]);
      const hot = material.uniforms.uHot.value as THREE.Color;
      expect([hot.r, hot.g, hot.b]).toEqual([...PEER_NETWORK_PALETTE.coldWhite]);
    }
  });

  it('are additive, unlit and depth-read-only, like every other draw in the layer', () => {
    for (const material of [FACE, AURA]) {
      expect(material.blending).toBe(THREE.AdditiveBlending);
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.depthTest).toBe(true);
      expect(material.toneMapped).toBe(false);
    }
    // ⭐ The face is the ONE draw in this layer that needs both sides: it lies
    // IN the plane, so it is seen from below exactly as often as from above.
    expect(FACE.side).toBe(THREE.DoubleSide);
    expect(AURA.side).toBe(THREE.FrontSide);
  });

  it('carry their quad extents in a UNIFORM, because a hand-built quad ignores scale', () => {
    // ⚠️ Both take `PlaneGeometry(1, 1)`, the shared unit plane. The face lays
    // it into the instance's local XZ and the aura rebuilds it from the view
    // matrix's camera axes — neither path is touched by `mesh.scale` or by a
    // scaled instance matrix, so the extent has to ride `uHalf`.
    for (const vertex of [FACE_VERTEX, AURA_VERTEX]) {
      expect(vertex).toContain('uniform float uHalf;');
      expect(vertex).toContain('* uHalf * 2.0');
      expect(vertex).toContain(
        'vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
      );
    }
    expect(AURA_VERTEX).toContain('viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]');
    // ⚠️ And each extent is a FUNCTION of the form it bounds, so a knob that
    // grows the mark cannot leave the quad behind — the bug that has already
    // shipped once on this layer, on the proxy of the volume this replaced.
    expect(FACE.uniforms.uHalf.value).toBe(COHORT_FACE_HALF);
    expect(COHORT_FACE_HALF).toBe(cohortFaceHalfExtent(COHORT_AP_R));
    expect(AURA.uniforms.uHalf.value).toBe(COHORT_AURA_HALF);
    expect(COHORT_AURA_HALF).toBe(cohortAuraHalfExtent(COHORT_AP_R, COHORT_AURA_HALO_R));

    // The face's square strictly contains its disc, with nothing to spare and
    // nothing wasted beyond the corners.
    expect(COHORT_FACE_HALF).toBe(COHORT_AP_R);

    // ⭐ THE AURA'S 1.06 IS A PERSPECTIVE MARGIN AND NOT A GUESS. The halo is
    // measured by the perpendicular distance from the VIEW RAY to the cohort,
    // and a fragment `d` out on the quad has a ray passing at `d / sqrt(1 +
    // d²/D²)` — strictly less than `d`. So covering a halo of radius `hR` from
    // `D` away needs `1 / sqrt(1 - (hR/D)²)`, which is 1.0623 at `D` = 12 wu.
    const haloR = COHORT_AP_R * COHORT_AURA_HALO_R;
    const marginAt = (D: number): number => 1 / Math.sqrt(1 - (haloR / D) ** 2);
    expect(marginAt(12)).toBeCloseTo(1.0623, 4);
    expect(COHORT_AURA_HALF / haloR).toBeCloseTo(1.06, 10);
    // Slack at every camera the orbit actually reaches, and tight only nearer
    // than that — which is also where the plan puts the cost budget's edge.
    for (const D of [13, 20, 46, 120, 400]) {
      expect(COHORT_AURA_HALF / haloR).toBeGreaterThan(marginAt(D));
    }
  });

  it('carry the proximity exemption and the instance origin, on both faces', () => {
    for (const material of [FACE, AURA]) {
      // ⭐ The same shared string both older faces carry. `cohortContextEnergy`
      // owns the arithmetic; this is what says these two are inside it too, so
      // a cohort the camera has flown to keeps its light on all its faces at
      // once rather than coming up in pieces.
      expect(material.fragmentShader).toContain('distance(cameraPosition, vOrigin)');
      expect(material.fragmentShader).toContain('uniform float uContextEnergy;');
      expect([...material.fragmentShader.matchAll(/\buContextEnergy\b/g)]).toHaveLength(2);
      expect([...material.fragmentShader.matchAll(/\bcohortEnergy\b/g)]).toHaveLength(2);
      expect(material.vertexShader).toContain('varying vec3 vOrigin;');
      expect(material.fragmentShader).toContain('varying vec3 vOrigin;');
      expect(material.vertexShader).toMatch(/vOrigin = \w+\.xyz;/);
    }
  });

  it('is swept by the file’s own shader guards, which is where they live', () => {
    // ⭐ The two source-level guards — no `smoothstep` with `edge0 >= edge1`,
    // no `pow` with a possibly-negative base — are implemented ONCE, over the
    // whole file, in `cohortShaderGuards.test.ts`. They have their own file
    // because they outlive every form this feature has drawn: they were written
    // for the accreting void and twice travelled as a passenger in a test whose
    // subject was then deleted. Both programs are in their list, and their
    // coverage assertion means they HAVE to be: every `pow` and `smoothstep` in
    // the file must appear in a program they were handed.
    const guards = readFileSync(
      resolve(process.cwd(), '__tests__/materials/cohortShaderGuards.test.ts'),
      'utf8',
    );
    expect(guards).toContain("['cohortFace', makeCohortFaceMaterial()]");
    expect(guards).toContain("['cohortAura', makeCohortAuraMaterial()]");
    expect(guards).toContain('no smoothstep anywhere has edge0 >= edge1');
    expect(guards).toContain('no pow anywhere can be handed a negative base');

    // These programs really do give the guards something to check. ⚠️ The
    // counts include the ONE `smoothstep` pasted in from
    // `COHORT_CONTEXT_ENERGY_GLSL`, which is why the guards' coverage sum has
    // to credit a shared snippet once per EXTRA use site — two use sites now,
    // so exactly one call has to be added back.
    expect([...FACE_FRAGMENT.matchAll(/\bsmoothstep\s*\(/g)]).toHaveLength(4);
    expect([...AURA_FRAGMENT.matchAll(/\bsmoothstep\s*\(/g)]).toHaveLength(3);
    expect([...FACE_FRAGMENT.matchAll(/\bpow\s*\(/g)]).toHaveLength(1);
    expect([...AURA_FRAGMENT.matchAll(/\bpow\s*\(/g)]).toHaveLength(1);
    // ⚠️ And a square is `sq(x)`, never `pow(x, 2.0)`: a negative base is
    // undefined in GLSL and a square is the one case where it is free to avoid.
    expect(FACE_FRAGMENT).toContain('float sq(float x) { return x * x; }');
    expect(FACE_FRAGMENT).not.toMatch(/pow\([^,]+,\s*2\.0\)/);
  });
});
