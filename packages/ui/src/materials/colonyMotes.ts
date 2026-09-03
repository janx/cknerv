import * as THREE from 'three';
import {
  COHORT_CONTEXT_ENERGY_GLSL,
  COHORT_GULP_FALL,
  COHORT_GULP_GLSL,
  COHORT_GULP_RISE,
  COHORT_NEVER_WON,
} from './colonyCohort';
import {
  COHORT_DISC_OUT_FAR,
  COHORT_HORIZON,
  COHORT_HORIZON_FAR,
  COHORT_LENS_REACH,
  COHORT_LENS_WARMTH,
  COHORT_UNFOLD_HI,
  COHORT_UNFOLD_LO,
  cohortDiscStops,
  cohortShadowRadius,
} from './colonyLens';
import { MIST_SWIRL } from './colonyMist';
import type { SceneColor } from '../visualPalette';

/**
 * The motes: the substance on its way in, as points the eye can follow.
 *
 * ⭐⭐⭐ THE INTAKE IS THE POINT, AND A FIELD ALONE CANNOT SHOW A RATE. The
 * lensed mark computes a picture — a shadow, a photon ring, a disc — and every
 * pixel of it is a place light came FROM. What that picture cannot say is how
 * fast the substance is moving, because a texture at rest and a texture flowing
 * at two world units a second look identical in a still and nearly identical in
 * motion. So a few hundred parcels of the same medium are drawn as points, each
 * living exactly ONE fall: born at a radius out in the void, carried in along
 * the sink's own streamline, gone at the shadow's edge, reborn somewhere else.
 * Motion the eye can track, at every camera, on the same arithmetic the disc's
 * texture is made of.
 *
 * ⭐⭐ ONE FALL EACH, AND THE FALL IS THE SINK'S OWN. A 2-D point sink of
 * strength k obeys `d(r²)/dt = -k`, so a parcel now at r was at `sqrt(r² + kτ)`
 * and a parcel born at r0 is at `sqrt(r0² - k·age)` — which makes the whole
 * trajectory closed-form, the life exactly `(r0² - shadow²)/k`, and the program
 * stateless: no simulation, no buffer of positions, no readback. Every mote is
 * a pure function of its seed and the clock. The angle is the same logarithmic
 * spiral the medium is carried on (`swirl · ln(r0/r)`), plus an orbital swing
 * near the mouth.
 *
 * The user's rules, as they bind THIS draw:
 *
 * 1. ⭐⭐⭐ THE MEMBRANE. Every mote's offset from its cohort has y = 0 exactly.
 *    There is no term in this program that can lift one off the colony plane.
 * 2. ⭐⭐⭐ THE INTAKE IS THE POINT. A mote IS a parcel of the mist, so it falls
 *    on the mist's own back-trace arithmetic and wears the disc's own colour —
 *    the lens's mid stop pushed toward its core, out of `cohortDiscStops`, so
 *    the `cohortWarmth` knob moves the disc and the specks in it together.
 * 3. ⭐⭐ SECONDARY AT THE DEFAULT CAMERA. The same closeness the lens folds on
 *    folds these: far away the birth radius pulls in to the far form's own
 *    extent and the whole draw dims to a fifth, so a cohort in the overview is a
 *    peer-sized smudge with a hint of grain and not a firework.
 * 4. ⛔ NEVER UPWARD. See 1. The colony's canopy is over this plane and nothing
 *    here reaches for it.
 *
 * ⭐ THE COLONY TURNS, AND THAT IS THIS PORT'S ONE STRUCTURAL DEPARTURE FROM THE
 * LAB. The lab's scene has an identity model matrix, so its motes could spiral
 * in world XZ. Here the layer sits inside a group that rotates about world Y:
 * `aOrigin` is therefore a COLONY-FRAME seat, the spiral is laid out in the
 * colony's own plane (so a mote's track turns with the colony exactly as the
 * disc's streamlines do), and the model matrix is applied ONCE — to the seat —
 * only so the fold can measure a world distance to the camera.
 *
 * ⚠️ TWO PLACES WHERE THIS PROGRAM AND THE DISC ARE NOT THE SAME NUMBER, each
 * deliberate and each one settleable with a knob:
 *
 * - `COHORT_MOTE_K` is 16 where the disc's back-trace runs at `MIST_SINK_K`
 *   (12). A mote is a marker the eye TRACKS over a whole fall and the disc's
 *   texture is a field it reads at a glance, so the preview the user approved
 *   pushed the tracked thing a third faster. Both are rates in wu²/s on the
 *   same law, and `cohortIntake` moves the disc's while `cohortMotes` is where
 *   this one would go.
 * - the mote's angle carries an ORBIT term (`COHORT_MOTE_ORBIT`) that the
 *   shipped back-trace has none of. It is weighted by the catchment, so it is a
 *   swing near the mouth and nothing at the rim: it is what makes a single
 *   tracked point read as an orbit decaying rather than as a bead on a wire.
 *   The plan already carries `cohortOrbit` as its knob.
 * ⭐ AND THE PROXIMITY EXEMPTION IS HERE TOO, computed in the VERTEX stage. It
 * is the same string the lens compiles (`COHORT_CONTEXT_ENERGY_GLSL`) against
 * the same fact — the distance from the camera to the mark's world seat — so a
 * cohort the camera has flown to keeps its disc AND the specks falling into it.
 * G2 shipped without it and said what it would cost: past 150 wu the lens dims
 * with the mesh and the motes would not, which is one mark receding in two
 * pieces. ⚠️ RGB only, as everywhere: the alpha is the shape, and dimming it
 * would change what a mote IS rather than how bright it is.
 *
 * ⭐ MEASURED LIVE 2026-09-03, on seven mainnet cohorts at 2560x1440 through
 * ANGLE/Vulkan: `colony.cohort.motes` costs **0.10-0.14 ms** at every camera
 * from the app overview to a hole filling the screen — a tenth of the lens
 * beside it — and the specks contribute NOTHING inside the shadow, the
 * motes-only frame being pixel-identical to a frame with neither draw.
 * `COHORT_MOTE_SHADOW_R` lands the vanish exactly on the silhouette.
 */

/* -------------------------------------------------------------------------- *
 * How many, and how they are told apart.
 * -------------------------------------------------------------------------- */

/**
 * Motes per cohort.
 *
 * ⭐ IT IS A DENSITY ALONG A LIFE, NOT A COUNT ON SCREEN. Every mote is at a
 * different point of its own fall, so 96 of them spread over a life of tens of
 * seconds put a handful in the bright inner region at any instant and leave the
 * rest as faint grain further out — which is what an intake looks like. Seven
 * cohorts is 672 points, and the geometry the layer allocates for the whole
 * `COHORT_MARK_CAP` is 6,144: a rounding error beside the peer cloud, and the
 * reason the count can be generous.
 */
export const COHORT_MOTES_PER_COHORT = 96;

/**
 * The three decorrelation salts, and they mean nothing individually.
 *
 * ⚠️ THEY ARE HERE SO THE MIRROR AND THE SHADER CANNOT DRIFT. `moteHash` is
 * `fract(sin(x) · 43758.5453)` — the standard one — and what keeps 96 motes of
 * one cohort, and every cohort of one colony, from marching in step, is only
 * that they enter it at different points. Each salt is a (multiplier, offset)
 * pair on one input: the seed for the birth radius and the starting phase, and
 * the seed AND the cycle index for the angle a mote is reborn at.
 */
export const COHORT_MOTE_HASH = {
  r0Seed: 7.1,
  r0Bias: 0.3,
  phaseSeed: 3.3,
  phaseBias: 0.7,
  thetaSeed: 5.7,
  thetaCycle: 0.61,
} as const;

/**
 * How one cohort's 96 seeds are laid out from the cohort's own seed lane:
 * `seed · spread + mote · step + bias`.
 *
 * ⭐ THE STEP IS THE GOLDEN RATIO, which is the cheapest way to make 96
 * consecutive integers land as far apart as they can inside one turn — and the
 * spread is large enough that two cohorts whose lane values differ by a
 * hundredth still enter the hash a world apart.
 */
export const COHORT_MOTE_SEED_SPREAD = 97.13;
export const COHORT_MOTE_SEED_STEP = 1.618;
export const COHORT_MOTE_SEED_BIAS = 0.37;

/* -------------------------------------------------------------------------- *
 * The fall.
 * -------------------------------------------------------------------------- */

/**
 * The sink's strength for a cohort of full share, in wu² per second.
 *
 * ⚠️ ABOVE `MIST_SINK_K` (12) ON PURPOSE — see the header. `k` is the rate the
 * square of the radius falls at, so a mote born at 27 wu reaches the shadow in
 * `(27² - 2²)/16 = 45 s` at full share, and the speed it crosses the last five
 * world units at (`k/2r`, so 1.6 wu/s at r = 5) is the number the eye actually
 * reads. A starting value from the approved preview.
 */
export const COHORT_MOTE_K = 16;

/**
 * …and the floor under `k · strength`.
 *
 * ⚠️ IT IS NOT A TASTE, IT IS WHAT KEEPS THE LIFE FINITE. The life is
 * `(r0² - shadow²)/k` and the cycle index is `floor(t / life)`; at k = 0 the
 * life is infinite and every mote in the draw sits at its birth radius forever,
 * or worse, divides by zero. A slot whose share was never written is exactly
 * that case, and this is the arithmetic that survives it.
 */
export const COHORT_MOTE_K_FLOOR = 0.5;

/**
 * The vortex's circulation, as a multiple of the radial flow: the SAME number
 * the medium is carried on, imported rather than restated.
 *
 * ⭐ ONE SUBSTANCE. A parcel turns by `swirl · ln(r0/r)` per e-fold of radius —
 * the definition of a logarithmic spiral — and that is the whole of the angle
 * the disc's texture is warped by. A mote that wound at a different rate than
 * the streaks it falls through would read as a bug even to somebody who could
 * not name it.
 */
export const COHORT_MOTE_SWIRL = MIST_SWIRL;

/**
 * The orbital swing, in radians per second at one world unit, weighted by the
 * catchment so it is a swing near the mouth and nothing at the rim.
 *
 * ⭐⭐ THIS IS WHAT MAKES A FALL LOOK LIKE AN ORBIT DECAYING. The spiral term
 * alone is a fixed shape in the plane: a mote runs down a curve that never
 * changes, and 96 of them read as beads on 96 wires. The swing is a function of
 * AGE as well as radius, so a mote that has been falling longer is further
 * around than one that was born beside it — the track fans out, and the inner
 * region turns. ⚠️ It has no counterpart in the shipped back-trace; see the
 * header.
 */
export const COHORT_MOTE_ORBIT = 1.2;

/**
 * The radius the swing's `1/r^1.5` is floored at, in world units.
 *
 * ⚠️ WITHOUT IT THE LAST HALF-UNIT IS A DISCONTINUITY. The swing goes as
 * `age / r^1.5`, and the age is largest exactly where the radius is smallest, so
 * an unfloored term spins a mote through several turns in its last frames. The
 * floor is inside the far shadow (0.21 wu) and well inside the near one (2.0),
 * so at the near camera it is never reached at all: it protects the far form,
 * where a mote can pass closer to the centre than half a world unit.
 */
export const COHORT_MOTE_ORBIT_R_FLOOR = 0.5;

/**
 * The catchment the swing is weighted by, at the near end of the fold: the
 * LENS'S OWN reach, imported.
 *
 * ⭐ AND IT IS NOT THE PATCH'S `MIST_REACH` (14), which is what the lab used
 * here. The disc these motes fall through is 28 wu across and its back-trace
 * runs at 30; a mote weighted by 14 would stop swinging halfway out of the
 * picture it belongs to, at exactly the radius where the disc's own streamlines
 * are still bending hard. The argument is `COHORT_LENS_REACH`'s, unchanged.
 */
export const COHORT_MOTE_REACH = COHORT_LENS_REACH;

/**
 * …and at the far end, where it is the far form's whole extent.
 *
 * ⭐ THE SAME FACT AS `COHORT_DISC_OUT_FAR`, so it is that constant. Far away
 * the mark is a six-unit halo; a catchment wider than the halo would weight a
 * swing outside anything that is drawn.
 */
export const COHORT_MOTE_REACH_FAR = COHORT_DISC_OUT_FAR;

/**
 * Where a mote is born, at the near end of the fold, in world units — the range
 * a uniform draw from the seed lands in.
 *
 * ⭐ THE MAX SITS JUST INSIDE `COHORT_DISC_OUT` (28), so every mote is born
 * inside the disc it falls through and none appears out of nothing beyond the
 * mark's own edge. The min is far enough out that the bright inner region is fed
 * continuously rather than in a pulse. Starting values from the approved
 * preview.
 */
export const COHORT_MOTE_R0_MIN = 8;
export const COHORT_MOTE_R0_MAX = 27;

/**
 * …and never nearer than this multiple of the shadow's own radius.
 *
 * ⚠️ IT IS THE OTHER HALF OF "THE LIFE IS FINITE". The life is
 * `(r0² - shadow²)/k`, so a mote born AT the shadow lives zero seconds and one
 * born inside it lives a negative number of them. 1.6 leaves `2.56 - 1 = 1.56`
 * shadow-radii-squared of fall, which at the far end of the fold is the whole of
 * a mote's existence: 0.33 wu down to 0.21.
 */
export const COHORT_MOTE_R0_FLOOR = 1.6;

/* -------------------------------------------------------------------------- *
 * Where it ends: the shadow, derived and never restated.
 * -------------------------------------------------------------------------- */

/**
 * Where a mote vanishes, near and far, in world units.
 *
 * ⭐⭐⭐ IT IS THE SAME FACT AS THE LENS'S SHADOW AND SO IT IS THE LENS'S OWN
 * NUMBER, derived from `COHORT_SHADOW_RATIO` and `COHORT_HORIZON` — both of
 * which live over there, with the mass — rather than typed again. The approved
 * preview carried 2.0 and 0.22 as literals; these are 2.0006 and 0.2078, which
 * is the same picture and one fewer place for the mass and the specks that
 * disappear into it to disagree.
 */
export const COHORT_MOTE_SHADOW_R = cohortShadowRadius(COHORT_HORIZON);
export const COHORT_MOTE_SHADOW_R_FAR = cohortShadowRadius(COHORT_HORIZON_FAR);

/**
 * A mote is gone once it is inside this multiple of the shadow's radius.
 *
 * ⭐ THE 3 % IS WHAT KEEPS THE DISAPPEARANCE INVISIBLE. A mote that ran all the
 * way to the shadow's edge would wink out ON the silhouette, where the eye is
 * already looking, and at the last instant it is also at its brightest and
 * fastest. Three per cent of the radius earlier is under a pixel at any camera
 * the shadow is visible from, and the mote is behind the disc's inner edge by
 * then anyway.
 */
export const COHORT_MOTE_VANISH = 1.03;

/* -------------------------------------------------------------------------- *
 * The light.
 * -------------------------------------------------------------------------- */

/**
 * A mote's brightness at its birth radius, before the inward rise: the floor of
 * `floor + (1 - floor) · near²`.
 *
 * ⭐ IT BRIGHTENS INWARD BECAUSE THE SUBSTANCE DOES. `near = 1 - r/r0` is how
 * far through its own fall a mote is, and the square puts most of the rise in
 * the last third — where the medium is compressed, the disc is bright and the
 * speed is highest. A mote at the rim is a faint speck of grain; a mote about to
 * go is the brightest point in the mark.
 */
export const COHORT_MOTE_FLOOR = 0.22;

/**
 * How long a newborn mote takes to reach full brightness, in seconds.
 *
 * ⚠️ WITHOUT IT EVERY REBIRTH IS A POP. A mote is reborn at a NEW angle at the
 * end of each cycle, so its old and new positions are unrelated: without a fade
 * the eye sees a point vanish at the mouth and a different one appear at the rim
 * in the same frame, and reads them as one thing teleporting.
 */
export const COHORT_MOTE_FADE_IN = 0.35;

/**
 * How much the block this cohort won multiplies a mote by, at the gulp's peak.
 *
 * ⭐ THE LARGEST BURST IN THE FEATURE, and that is a statement about what is
 * being multiplied. The disc's own pile lifts by `COHORT_GULP_INTERIOR` (2.2) —
 * a surface already carrying most of the mark's light — where a mote is a single
 * additive point sitting at 0.22 of full for most of its life, so at 2.2 the
 * swallow would not read on the specks at all. The envelope itself is the
 * feature's ONE curve — `COHORT_GULP_GLSL`, imported, never re-typed.
 *
 * ⭐ MEASURED LIVE 2026-09-03. Three mainnet blocks caught 340 / 342 / 447 ms
 * after their stamp, camped on the top cohort at 40 px/wu with the colony's
 * rotation frozen so the envelope is the ONLY thing that moves between a burst
 * frame and its rest frame: the crop's mean brightness rose **x1.29** each time,
 * with 78-80 % of its pixels brighter by more than 16/255.
 */
export const COHORT_MOTE_GULP_BURST = 2.5;

/**
 * What the whole draw is multiplied by at the far end of the fold.
 *
 * ⭐⭐ THE THIRD RULE, IN ONE NUMBER. At the app camera a cohort must not
 * out-weigh the peers around it, and a field of moving points is the single most
 * attention-grabbing thing a scene can contain. A fifth of the light, on marks
 * that are already under two pixels there, leaves a faint grain in a halo — the
 * hint that something is being drawn in — and nothing that competes.
 */
export const COHORT_MOTE_FAR_DIM = 0.2;

/** The amplitude, and the only scale on the whole draw. */
export const COHORT_MOTE_AMP = 1;

/* -------------------------------------------------------------------------- *
 * The point.
 * -------------------------------------------------------------------------- */

/**
 * A mote's world DIAMETER at full brightness, in world units, and the two ends
 * of the `floor + grow · near` ramp it is scaled by.
 *
 * ⭐ A WORLD DIAMETER AND NOT A PIXEL SIZE, which is the peer sprite's own
 * convention and the reason a mote is the same size on a 4K panel and a phone.
 * The ramp is the same statement the brightness makes: 0.19 wu of dim grain at
 * the rim, 0.48 wu about to fall in.
 */
export const COHORT_MOTE_SIZE = 0.32;
export const COHORT_MOTE_SIZE_FLOOR = 0.6;
export const COHORT_MOTE_SIZE_GROW = 0.9;

/**
 * …and the smallest it may be drawn, in DEVICE pixels.
 *
 * ⚠️ A SUB-PIXEL POINT DOES NOT DIM, IT FLICKERS. Rasterisation quantises
 * `gl_PointSize` to whole pixels, so a mote that projects to 0.4 px is drawn at
 * one pixel of FULL brightness or at none, depending on where its centre lands
 * that frame — a field of them boils. The floor makes the far form a stable
 * grain instead, and the fold's `COHORT_MOTE_FAR_DIM` is what takes the light
 * away there rather than the size.
 */
export const COHORT_MOTE_PIXEL_FLOOR = 1.5;

/**
 * The radial profile of one mote: a hot core plus a wider, fainter skirt.
 *
 * ⭐ THE PEER SPRITE'S OWN SHAPE, at this mark's exponents. Every point in this
 * scene is `pow(1 - r, coreExp) + pow(1 - r, haloExp) · halo` — the cloud, the
 * measured belt, the spikes — and a mote that used a different falloff would
 * read as a different KIND of object rather than as a smaller one. The core is
 * sharper than the peer cloud's (2.2 against 2.0) because a mote is a parcel of
 * a substance and not a node.
 */
export const COHORT_MOTE_CORE_EXP = 2.2;
export const COHORT_MOTE_HALO_EXP = 1.2;
export const COHORT_MOTE_HALO = 0.25;

/**
 * How far the disc's MID stop is pushed toward its CORE to give a mote its
 * colour.
 *
 * ⭐⭐ THE COLOUR IS THE DISC'S, TAKEN FROM THE DISC'S OWN STOPS. A mote is a
 * parcel of exactly the substance the disc is made of, so it cannot carry a hue
 * of its own — and because both come out of `cohortDiscStops`, the
 * `cohortWarmth` knob moves the disc and the specks in it together, in one
 * place, with no chance of a cold mote in a warm vortex. It is pushed toward
 * white because a single point at a pixel and a half needs the bright end of the
 * ramp to be a mote at all.
 *
 * ⚠️ THE PREVIEW'S OWN (0.75, 0.95, 1.0) IS NOT ON THAT LINE — it was picked by
 * hand, and red wants 0.615 of the way to white where green wants 0.667. 0.62 is
 * the least-squares point between them: (0.753, 0.943, 1.0), which disagrees
 * with the preview by 0.007 on GREEN and 0.003 on red — two levels of an 8-bit
 * channel, on a point a pixel and a half across. Being ON the disc's ramp is
 * worth more than matching a hand-picked triple that cannot follow the warmth.
 */
export const COHORT_MOTE_WHITEN = 0.62;

/**
 * The floor under the camera-to-cohort distance the fold is measured with, in
 * world units. ⚠️ A camera INSIDE a mark would otherwise divide by nothing.
 */
export const COHORT_MOTE_CAM_FLOOR = 1;

/**
 * The strength below which a slot is not a mote at all.
 *
 * ⚠️⚠️ AN UNWRITTEN SLOT MUST DRAW NOTHING, AND ZERO IS NOT ENOUGH ON ITS OWN.
 * The geometry is allocated for a CAPACITY and the marks plan fills the cohorts
 * it actually has; the rest keep `aOrigin = (0, 0, 0)`, which is the colony's
 * own centre — so without this the spare capacity spirals 96 points each around
 * the middle of the scene. `COHORT_MOTE_K_FLOOR` deliberately keeps the
 * arithmetic finite for those slots, which means the arithmetic alone cannot
 * hide them: this is what does.
 */
export const COHORT_MOTE_LIVE_STRENGTH = 1e-6;

/**
 * A mote's colour at a given warmth: the disc's mid stop, whitened.
 *
 * ⭐ ON THE CPU, for the reason `cohortDiscStops` does the same: warmth is a
 * per-DRAW fact and paying for it per point would buy nothing.
 */
export function cohortMoteColor(warmth: number = COHORT_LENS_WARMTH): SceneColor {
  const stops = cohortDiscStops(warmth);
  const t = Math.min(1, Math.max(0, COHORT_MOTE_WHITEN));
  return [
    stops.mid[0] + (stops.core[0] - stops.mid[0]) * t,
    stops.mid[1] + (stops.core[1] - stops.mid[1]) * t,
    stops.mid[2] + (stops.core[2] - stops.mid[2]) * t,
  ];
}

/* -------------------------------------------------------------------------- *
 * The mirror: one mote's whole life, in TypeScript.
 * -------------------------------------------------------------------------- */

/** GLSL's `smoothstep`, so the fold below is the shader's fold. */
function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** GLSL's `mix`. */
function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** GLSL's `fract`. */
function fract(value: number): number {
  return value - Math.floor(value);
}

/**
 * The hash the program decorrelates everything with.
 *
 * ⚠️ THE GPU WILL NOT LAND ON THE SAME DRAW, AND THAT IS FINE. `sin` of an
 * argument in the hundreds carries only a few decimals in a 32-bit float, so the
 * shader's `fract` and this one diverge — but both are the same distribution and
 * both are DETERMINISTIC in their input, which is the only property anything
 * here relies on: a mote reborn on cycle 7 must land at the same angle every
 * frame of cycle 7, not at an angle a test could predict from the outside.
 */
export function cohortMoteHash(value: number): number {
  return fract(Math.sin(value) * 43758.5453);
}

/** The seed of mote `mote` of the cohort whose own seed lane reads `seed`. */
export function cohortMoteSeed(seed: number, mote: number): number {
  return (
    seed * COHORT_MOTE_SEED_SPREAD
    + mote * COHORT_MOTE_SEED_STEP
    + COHORT_MOTE_SEED_BIAS
  );
}

/**
 * The gulp envelope, in TypeScript: the block this cohort won, as a factor of
 * time. It is `COHORT_GULP_GLSL`'s own arithmetic, built from the same two
 * exported constants, and `colonyMotes.test.ts` runs the shipped string beside
 * it rather than trusting the resemblance.
 */
export function cohortMoteGulp(gulpAge: number): number {
  return gulpAge > 0
    ? Math.exp(-gulpAge / COHORT_GULP_FALL)
      * (1 - Math.exp(-gulpAge / COHORT_GULP_RISE))
    : 0;
}

/** Everything the fold moves on this draw, at one camera. */
export interface CohortMoteFold {
  /** 0 at `COHORT_UNFOLD_LO` pixels per world unit, 1 at `COHORT_UNFOLD_HI`. */
  readonly closeness: number;
  /** The catchment the orbital swing is weighted by, in world units. */
  readonly reach: number;
  /** The birth radius' scale: the catchment as a fraction of its near value. */
  readonly fold: number;
  /** Where a mote vanishes, in world units. */
  readonly shadowR: number;
}

/**
 * ⭐⭐⭐ THE SAME ONE NUMBER THE LENS FOLDS ON, measured the same way and from
 * the same two edges. The catchment, the birth radius and the shadow all read
 * it, so the specks cannot unfold on a schedule of their own while the picture
 * they fall through is still folded.
 */
export function cohortMoteFold(pxPerWu: number): CohortMoteFold {
  const closeness = smoothstep(COHORT_UNFOLD_LO, COHORT_UNFOLD_HI, pxPerWu);
  const reach = mix(COHORT_MOTE_REACH_FAR, COHORT_MOTE_REACH, closeness);
  return {
    closeness,
    reach,
    fold: reach / COHORT_MOTE_REACH,
    shadowR: mix(COHORT_MOTE_SHADOW_R_FAR, COHORT_MOTE_SHADOW_R, closeness),
  };
}

/** The sink's strength for a cohort of this share, in wu² per second. */
export function cohortMoteSinkK(strength: number): number {
  return Math.max(COHORT_MOTE_K * strength, COHORT_MOTE_K_FLOOR);
}

/** Where this mote is born, in world units. */
export function cohortMoteBirthRadius(
  seed: number,
  fold: number,
  shadowR: number,
): number {
  const draw = cohortMoteHash(
    seed * COHORT_MOTE_HASH.r0Seed + COHORT_MOTE_HASH.r0Bias,
  );
  return Math.max(
    mix(COHORT_MOTE_R0_MIN, COHORT_MOTE_R0_MAX, draw) * fold,
    shadowR * COHORT_MOTE_R0_FLOOR,
  );
}

/**
 * How long one fall lasts, in seconds: `(r0² - shadow²)/k`.
 *
 * ⭐ EXACT, BECAUSE THE SINK IS. `d(r²)/dt = -k` integrates to
 * `r² = r0² - k·age` with no approximation at all, so the age at which a mote
 * arrives at the shadow is a division and not a search — which is what makes the
 * whole program a closed form.
 */
export function cohortMoteLife(r0: number, shadowR: number, k: number): number {
  return (r0 * r0 - shadowR * shadowR) / k;
}

/** The radius of a mote `age` seconds into its fall. */
export function cohortMoteRadius(r0: number, k: number, age: number): number {
  return Math.sqrt(Math.max(r0 * r0 - k * age, 1e-4));
}

/**
 * The catchment weight: 1 at the mouth, 0 with zero slope at `reach`. The
 * medium's own `(1 - r²/reach²)²`, which is why the swing dies out exactly where
 * the back-trace's pull does.
 */
export function cohortMoteCatchment(r: number, reach: number): number {
  const w = Math.max(1 - (r * r) / (reach * reach), 0);
  return w * w;
}

/**
 * How far around a mote has wound getting here, in radians: the medium's
 * logarithmic spiral plus the orbital swing.
 *
 * The angle itself is `theta0 - turn`: a parcel arriving at radius `r` from `r0`
 * has come BACKWARD around the spiral from where it started.
 */
export function cohortMoteTurn(
  r: number,
  r0: number,
  age: number,
  reach: number,
): number {
  const floored = Math.max(r, COHORT_MOTE_ORBIT_R_FLOOR);
  return (
    COHORT_MOTE_SWIRL * Math.log(r0 / r)
    + ((COHORT_MOTE_ORBIT * age) / (floored * Math.sqrt(floored)))
      * cohortMoteCatchment(r, reach)
  );
}

/** One mote, at one instant, from one camera. */
export interface CohortMoteInput {
  /** This mote's own seed — `cohortMoteSeed(cohortSeed, mote)`. */
  readonly seed: number;
  /** The cohort's share, which is the sink's strength. */
  readonly strength: number;
  /** The sim clock, in seconds. */
  readonly time: number;
  /** Pixels per world unit at the cohort: `uPxScale / |camera - seat|`. */
  readonly pxPerWu: number;
  /** The sim second of the block this cohort won. Defaults to never. */
  readonly gulpAt?: number;
}

/** Where a mote is, how bright it is, and how big. */
export interface CohortMoteState extends CohortMoteFold {
  readonly k: number;
  /** The birth radius, in world units. */
  readonly r0: number;
  /** The length of one whole fall, in seconds. */
  readonly life: number;
  /** Which fall this is: a mote is reborn at a new angle on every one. */
  readonly cycle: number;
  /** How far into this fall, in seconds. */
  readonly age: number;
  /** The angle it was born at, in radians. */
  readonly theta0: number;
  /** Its radius now, in world units. */
  readonly r: number;
  /** Its angle now, in the colony's plane, in radians. */
  readonly theta: number;
  /** How far through its fall it is: 0 at birth, 1 at the centre. */
  readonly near: number;
  /** The block burst's factor: 1 at rest. */
  readonly burst: number;
  /** What the fragment is multiplied by. Zero means the mote is not drawn. */
  readonly brightness: number;
  /** Its world diameter, before the pixel floor. */
  readonly diameter: number;
}

/**
 * ⭐⭐ ONE MOTE'S WHOLE LIFE AS A PURE FUNCTION, which is the vertex program
 * statement for statement. Nothing here is integrated, remembered or fed back:
 * given a seed, a share, a clock and a camera there is exactly one answer, which
 * is why the draw needs no simulation and why this mirror can be tested at all.
 */
export function cohortMoteAt(input: CohortMoteInput): CohortMoteState {
  const { seed, strength, time, pxPerWu } = input;
  const gulpAt = input.gulpAt ?? COHORT_NEVER_WON;

  const fold = cohortMoteFold(pxPerWu);
  const k = cohortMoteSinkK(strength);
  const r0 = cohortMoteBirthRadius(seed, fold.fold, fold.shadowR);
  const life = cohortMoteLife(r0, fold.shadowR, k);

  // The clock, offset by a per-mote fraction of a life, so 96 motes born from
  // one geometry are spread over the whole of a fall instead of arriving in
  // ninety-six-strong waves.
  const phase = cohortMoteHash(
    seed * COHORT_MOTE_HASH.phaseSeed + COHORT_MOTE_HASH.phaseBias,
  );
  const shifted = time + phase * life;
  const cycle = Math.floor(shifted / life);
  const age = shifted - cycle * life;
  const theta0 = cohortMoteHash(
    seed * COHORT_MOTE_HASH.thetaSeed + cycle * COHORT_MOTE_HASH.thetaCycle,
  ) * Math.PI * 2;

  const r = cohortMoteRadius(r0, k, age);
  const theta = theta0 - cohortMoteTurn(r, r0, age, fold.reach);
  const near = 1 - r / r0;
  const burst = 1 + COHORT_MOTE_GULP_BURST * cohortMoteGulp(time - gulpAt);

  // Gone inside the shadow's edge, and never there at all for a slot the plan
  // has not filled.
  const alive = r >= fold.shadowR * COHORT_MOTE_VANISH
    && strength >= COHORT_MOTE_LIVE_STRENGTH;
  const brightness = alive
    ? (COHORT_MOTE_FLOOR + (1 - COHORT_MOTE_FLOOR) * near * near)
      * smoothstep(0, COHORT_MOTE_FADE_IN, age)
      * COHORT_MOTE_AMP
      * burst
      * mix(COHORT_MOTE_FAR_DIM, 1, fold.closeness)
    : 0;

  return {
    ...fold,
    k,
    r0,
    life,
    cycle,
    age,
    theta0,
    r,
    theta,
    near,
    burst,
    brightness,
    diameter: COHORT_MOTE_SIZE * (COHORT_MOTE_SIZE_FLOOR + COHORT_MOTE_SIZE_GROW * near),
  };
}

/** How a point of this world diameter projects, in device pixels. */
export interface CohortMotePointSize {
  /** The mote's world diameter — `cohortMoteAt(...).diameter`. */
  readonly diameter: number;
  /** The DRAWING BUFFER's height in device pixels, which is `uViewportHeight`. */
  readonly viewportHeight: number;
  /** The projection matrix' [1][1], which is `1/tan(fov/2)`. */
  readonly projection11: number;
  /** The view-space depth of the point: negative, in front of the camera. */
  readonly viewZ: number;
}

/**
 * ⭐ THE PEER SPRITE'S PROJECTION, EXACTLY. Half the drawing buffer times the
 * projection's own `1/tan(fov/2)` over the view depth is what turns a world
 * diameter into pixels; a hard-coded pixel scale drifts with display density and
 * window height, and then a mote is a different size on every machine.
 */
export function cohortMotePointSizePx(size: CohortMotePointSize): number {
  return Math.max(
    COHORT_MOTE_PIXEL_FLOOR,
    (size.diameter * 0.5 * size.viewportHeight * size.projection11)
      / Math.max(-size.viewZ, 0.001),
  );
}

/* -------------------------------------------------------------------------- *
 * The program.
 * -------------------------------------------------------------------------- */

/** A number as a GLSL float literal: an integer still needs its point. */
function glslFloat(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

/**
 * The motes of every cohort in the colony, as one `THREE.Points` draw.
 *
 * The geometry is `buildCohortMotesGeometry`'s, and the four lanes are written
 * per COHORT by `writeCohortMotes` and stamped by `stampCohortMotes`. Every
 * per-frame value is a uniform: the layer writes `uTime` (the sim clock the
 * gulp lane is stamped on), `uPxScale`, `uViewportHeight` and
 * `uContextEnergy`.
 */
export function makeCohortMotesMaterial(): THREE.ShaderMaterial {
  const color = cohortMoteColor(COHORT_LENS_WARMTH);
  return new THREE.ShaderMaterial({
    // ⭐ ADDITIVE, WHICH IS WHAT A MOTE IS: light arriving, never light removed.
    // The lens quad beside it is the colony's ONE normal-blended draw because a
    // shadow has to take light away; these have nothing to hide behind them.
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      // ---- the fall
      uK: { value: COHORT_MOTE_K },
      uSwirl: { value: COHORT_MOTE_SWIRL },
      uOrbit: { value: COHORT_MOTE_ORBIT },
      uReach: { value: COHORT_MOTE_REACH },
      uReachFar: { value: COHORT_MOTE_REACH_FAR },
      uR0Min: { value: COHORT_MOTE_R0_MIN },
      uR0Max: { value: COHORT_MOTE_R0_MAX },
      uShadowR: { value: COHORT_MOTE_SHADOW_R },
      uShadowRFar: { value: COHORT_MOTE_SHADOW_R_FAR },
      // ---- the fold. ⚠️ uPxScale starts absurdly large for the reason the
      // lens's does: a draw that happens before the layer's first frame is
      // UNFOLDED rather than dimmed to a fifth, so a uniform nobody writes
      // shows up as the wrong form and never as an empty scene.
      uPxScale: { value: 1e6 },
      uUnfoldLo: { value: COHORT_UNFOLD_LO },
      uUnfoldHi: { value: COHORT_UNFOLD_HI },
      // ---- the point. The drawing buffer's height in DEVICE pixels; the owner
      // refreshes it, because a resize or a quality-tier DPR change moves it
      // under a live material.
      uViewportHeight: { value: 1080 },
      uMoteSize: { value: COHORT_MOTE_SIZE },
      uAmp: { value: COHORT_MOTE_AMP },
      // The passive-peer recession, and the exemption from it that a cohort
      // the camera came for earns. Written every frame beside the lens's.
      uContextEnergy: { value: 1 },
      uColor: { value: new THREE.Color().setRGB(...color) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aOrigin;
      attribute float aSeed;
      attribute float aStrength;
      attribute float aGulp;

      uniform float uTime;
      uniform float uK;
      uniform float uSwirl;
      uniform float uOrbit;
      uniform float uReach;
      uniform float uReachFar;
      uniform float uR0Min;
      uniform float uR0Max;
      uniform float uShadowR;
      uniform float uShadowRFar;
      uniform float uPxScale;
      uniform float uUnfoldLo;
      uniform float uUnfoldHi;
      uniform float uViewportHeight;
      uniform float uMoteSize;
      uniform float uAmp;
      uniform float uContextEnergy;

      varying float vBright;
      varying float vEnergy;

      // The standard hash. What it is FOR is that 96 motes of one cohort enter
      // it at 96 different points; see COHORT_MOTE_HASH.
      float moteHash(float n) { return fract(sin(n) * 43758.5453); }

      void main() {
        // ⚠️ THE STRENGTH IS A RATE AND THE FLOOR KEEPS THE LIFE FINITE. A slot
        // the marks plan never filled arrives here with a strength of zero; the
        // arithmetic below has to stay well-defined for it, and the light is
        // taken away at the end instead.
        float k = max(uK * aStrength, ${glslFloat(COHORT_MOTE_K_FLOOR)});

        // ⭐⭐ THE SEAT IS IN THE COLONY'S FRAME AND THE CAMERA IS NOT. The
        // colony turns about world Y, so the model matrix is applied ONCE, to
        // the seat, purely to measure how far away the camera is; the fall
        // itself is laid out in the colony's own plane below and turns with it.
        vec3 seat = (modelMatrix * vec4(aOrigin, 1.0)).xyz;
        // ⭐ THE MARK'S OWN DISTANCE, ONCE, FOR THE WHOLE SPECK. The shared
        // exemption names the world seat vOrigin because the lens reads it as a
        // varying in its fragment; here it is already a local, so the name is
        // bound to it rather than carried across the interpolator for nothing.
        // One distance per mote and never one per pixel: a 1.5 px point has no
        // extent to fade across, and every mote of a cohort must recede with
        // the disc it is falling into.
        vec3 vOrigin = seat;
        ${COHORT_CONTEXT_ENERGY_GLSL}
        vEnergy = cohortEnergy;
        float closeness = smoothstep(
          uUnfoldLo,
          uUnfoldHi,
          uPxScale / max(length(cameraPosition - seat), ${glslFloat(COHORT_MOTE_CAM_FLOOR)})
        );
        // ⭐⭐⭐ ONE NUMBER FOLDS ALL OF IT, and it is the lens's number. The
        // catchment, the birth radius that rides it and the shadow the mote
        // disappears into all move together.
        float reach = mix(uReachFar, uReach, closeness);
        float fold = reach / uReach;
        float shadowR = mix(uShadowRFar, uShadowR, closeness);

        // Born somewhere in the void, and never inside the shadow: a mote born
        // at the shadow would live exactly zero seconds.
        float r0 = max(
          mix(uR0Min, uR0Max, moteHash(aSeed * ${glslFloat(COHORT_MOTE_HASH.r0Seed)} + ${glslFloat(COHORT_MOTE_HASH.r0Bias)})) * fold,
          shadowR * ${glslFloat(COHORT_MOTE_R0_FLOOR)}
        );
        // ⭐ ONE FALL, CLOSED FORM. A 2-D point sink obeys d(r*r)/dt = -k, so
        // the whole trajectory is a square root and the life is a division.
        float life = (r0 * r0 - shadowR * shadowR) / k;
        float shifted = uTime + moteHash(aSeed * ${glslFloat(COHORT_MOTE_HASH.phaseSeed)} + ${glslFloat(COHORT_MOTE_HASH.phaseBias)}) * life;
        float cycle = floor(shifted / life);
        float age = shifted - cycle * life;
        // Reborn at a new angle every fall, and at the SAME new angle every
        // frame of that fall: the cycle index is in the hash.
        float theta0 = moteHash(aSeed * ${glslFloat(COHORT_MOTE_HASH.thetaSeed)} + cycle * ${glslFloat(COHORT_MOTE_HASH.thetaCycle)}) * 6.2831853;
        float r = sqrt(max(r0 * r0 - k * age, 1e-4));

        // The medium's own logarithmic spiral, plus a swing that is a function
        // of AGE as well as radius — so motes born beside each other fan out
        // instead of running down one wire. The catchment weight is the
        // back-trace's, so the swing dies exactly where the pull does.
        float w = max(1.0 - (r * r) / (reach * reach), 0.0);
        w *= w;
        // ⚠️ r^1.5 as r * sqrt(r), on a radius floored above zero: a pow() here
        // would be a power of a quantity this program cannot prove positive at
        // the call site, and this is the same arithmetic with nothing to prove.
        float rq = max(r, ${glslFloat(COHORT_MOTE_ORBIT_R_FLOOR)});
        float turn = uSwirl * log(r0 / r) + uOrbit * age / (rq * sqrt(rq)) * w;
        float theta = theta0 - turn;
        // ⛔ THE OFFSET'S Y IS EXACTLY ZERO. A mote lives in the membrane; there
        // is no term in this program that could lift one out of it.
        vec3 local = aOrigin + vec3(cos(theta) * r, 0.0, sin(theta) * r);

        // Brighter the further through its fall it is, because the substance is
        // denser, faster and hotter the closer in it gets.
        float near = 1.0 - r / r0;
        float fadeIn = smoothstep(0.0, ${glslFloat(COHORT_MOTE_FADE_IN)}, age);
        // The block this cohort won, on the feature's ONE curve. The envelope
        // reads a varying in every other program that compiles it; here the
        // gulp is spent in the VERTEX stage, where the lane is an attribute
        // already in scope, so the name is bound to a local instead.
        float vGulp = aGulp;
        ${COHORT_GULP_GLSL}
        vBright = (${glslFloat(COHORT_MOTE_FLOOR)} + ${glslFloat(1 - COHORT_MOTE_FLOOR)} * near * near)
          * fadeIn
          * uAmp
          * (1.0 + ${glslFloat(COHORT_MOTE_GULP_BURST)} * gulp)
          * mix(${glslFloat(COHORT_MOTE_FAR_DIM)}, 1.0, closeness);
        // ⚠️ TWO WAYS TO NOT BE A MOTE, AND NEITHER IS A BRANCH. Inside the
        // shadow's edge the fall is over; at a strength of zero the slot was
        // never filled by the marks plan and its seat is the colony's centre.
        vBright *= step(shadowR * ${glslFloat(COHORT_MOTE_VANISH)}, r) * step(${glslFloat(COHORT_MOTE_LIVE_STRENGTH)}, aStrength);

        vec4 view = modelViewMatrix * vec4(local, 1.0);
        // A WORLD diameter, projected the way every other point in this scene
        // is. The floor is in device pixels: a sub-pixel point does not dim, it
        // flickers, and the fold is what takes the far form's light away.
        float diameter = uMoteSize * (${glslFloat(COHORT_MOTE_SIZE_FLOOR)} + ${glslFloat(COHORT_MOTE_SIZE_GROW)} * near);
        gl_PointSize = max(
          ${glslFloat(COHORT_MOTE_PIXEL_FLOOR)},
          diameter * 0.5 * uViewportHeight * projectionMatrix[1][1]
            / max(-view.z, 0.001)
        );
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 uColor;

      varying float vBright;
      varying float vEnergy;

      void main() {
        // A mote that is out of its life, inside the shadow or in an unfilled
        // slot costs one comparison and no pixels at all.
        if (vBright <= 0.001) discard;
        float r = length(gl_PointCoord - 0.5) * 2.0;
        // ⚠️ AND THIS IS ALSO WHAT PROVES THE TWO POWERS BELOW. Past the unit
        // radius there is no fragment, so 1.0 - r is in [0, 1] at every pow()
        // this program evaluates. It is the peer sprite's own guard, in the same
        // position, for the same reason.
        if (r > 1.0) discard;
        float core = pow(1.0 - r, ${glslFloat(COHORT_MOTE_CORE_EXP)});
        float halo = pow(1.0 - r, ${glslFloat(COHORT_MOTE_HALO_EXP)})
          * ${glslFloat(COHORT_MOTE_HALO)};
        float s = (core + halo) * vBright;
        // ⚠️ ALPHA IS THE SHAPE AND NOT A CONSTANT, because three's additive
        // blend uses SOURCE ALPHA as its factor: the mote's contribution is
        // therefore its shape SQUARED, which is what keeps a field of them from
        // clipping to a white sheet where they overlap.
        // ⚠️ …AND THE ENERGY MULTIPLIES RGB ONLY, the house idiom: on an
        // additive draw whose blend factor is the source alpha, damping the
        // alpha too would square the recession and make a distant cohort's
        // specks vanish rather than recede.
        gl_FragColor = vec4(uColor * s * vEnergy, min(s, 1.0));
      }
    `,
  });
}

/* -------------------------------------------------------------------------- *
 * The geometry: one buffer for the whole colony, written per cohort.
 * -------------------------------------------------------------------------- */

/** A cohort's seat in the colony's frame. A `THREE.Vector3` satisfies it. */
export interface CohortMoteSeat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * A `THREE.Points` geometry with room for `capacity` cohorts.
 *
 * ⚠️⚠️ `aGulp` HERE IS A PER-MOTE COPY OF THE COHORT'S LANE, NOT THE SHARED
 * `InstancedBufferAttribute`. The lens beside it is drawn by an InstancedMesh
 * and reads ONE lane value per instance, so the layer hands it the
 * `InstancedBufferAttribute` object itself. A Points geometry is not instanced:
 * there is one vertex per MOTE, so the lane has to be widened to 96 copies per
 * cohort and `stampCohortMotes` is what writes them. Handing this geometry a
 * shared instance lane would read one cohort's stamp for the first 1/96th of the
 * colony's motes and garbage after it.
 *
 * ⚠️ THE OWNER MUST SET `frustumCulled = false` ON THE POINTS OBJECT. The bound
 * three computes comes from `position`, which holds the SEATS; the vertex
 * program then moves every mote up to `COHORT_MOTE_R0_MAX` world units away from
 * its seat, so the computed sphere does not contain the draw and a cohort's
 * motes vanish as its seat leaves the frustum.
 *
 * ⭐ AN UNWRITTEN SLOT DRAWS NOTHING, by arithmetic: `aStrength` starts at zero
 * and the program refuses a mote below `COHORT_MOTE_LIVE_STRENGTH`. So a
 * capacity larger than the plan's cohort count costs vertices and no pixels, and
 * a cohort is retired by writing a strength of zero over it.
 */
export function buildCohortMotesGeometry(capacity: number): THREE.BufferGeometry {
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new Error(`cohort motes: capacity must be a whole count, got ${capacity}`);
  }
  const count = capacity * COHORT_MOTES_PER_COHORT;
  const geometry = new THREE.BufferGeometry();
  // ⚠️ `position` IS REQUIRED AND IS NOT WHAT THE PROGRAM READS. three takes the
  // draw's vertex count and its bounding sphere from it, so it must exist and
  // must be the right length; the fall is built from `aOrigin`, which carries
  // the same seat and is what the vertex stage names.
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(count * 3), 3),
  );
  geometry.setAttribute(
    'aOrigin',
    new THREE.BufferAttribute(new Float32Array(count * 3), 3),
  );
  geometry.setAttribute(
    'aSeed',
    new THREE.BufferAttribute(new Float32Array(count), 1),
  );
  geometry.setAttribute(
    'aStrength',
    new THREE.BufferAttribute(new Float32Array(count), 1),
  );
  // ⚠️⚠️ THE SENTINEL, NEVER ZERO. An unfilled lane of zeros says "every cohort
  // won a block at t = 0" at the one moment `uTime` is also zero, and the whole
  // colony bursts for the first half second of every session. See
  // `COHORT_NEVER_WON`, which is far enough below any reachable clock that the
  // envelope is identically zero there with no branch and no second lane.
  geometry.setAttribute(
    'aGulp',
    new THREE.BufferAttribute(
      new Float32Array(count).fill(COHORT_NEVER_WON),
      1,
    ),
  );
  return geometry;
}

/** The slice of the buffers that belongs to cohort `index`. */
function cohortSlice(
  geometry: THREE.BufferGeometry,
  index: number,
): { readonly from: number; readonly to: number } {
  const capacity = geometry.hasAttribute('aSeed')
    ? geometry.getAttribute('aSeed').count / COHORT_MOTES_PER_COHORT
    : 0;
  if (!Number.isInteger(index) || index < 0 || index >= capacity) {
    throw new Error(
      `cohort motes: index ${index} is outside a capacity of ${capacity}`,
    );
  }
  const from = index * COHORT_MOTES_PER_COHORT;
  return { from, to: from + COHORT_MOTES_PER_COHORT };
}

/**
 * Fill one cohort's 96 motes: its seat, its share, and 96 decorrelated seeds.
 *
 * ⭐ THE SEED IS THE COHORT'S OWN LANE VALUE, spread across the motes here so
 * the layer never has to know how many there are. The same cohort written twice
 * lands on the same 96 motes, so a re-plan that keeps a cohort in place does not
 * teleport its specks.
 *
 * ⚠️ `strength` IS THE COHORT'S SHARE — the same number the lens's `aShare`
 * carries. What the two programs do with it differs by one step and the caller
 * owns the choice: the lens's vertex stage runs it through
 * `MIST_SHARE_FACTOR_GLSL` (a floor of 0.35, normalised by the busiest cohort in
 * view) before it becomes the sink's k, and this program multiplies it straight
 * into `uK`. Hand it `mistShareFactor(share, shareMax)` for a mote that falls at
 * the same rate its own disc's streamlines do.
 */
export function writeCohortMotes(
  geometry: THREE.BufferGeometry,
  index: number,
  seat: CohortMoteSeat,
  seed: number,
  strength: number,
): void {
  const { from, to } = cohortSlice(geometry, index);
  const position = geometry.getAttribute('position');
  const origin = geometry.getAttribute('aOrigin');
  const seeds = geometry.getAttribute('aSeed');
  const strengths = geometry.getAttribute('aStrength');
  for (let mote = from; mote < to; mote += 1) {
    position.setXYZ(mote, seat.x, seat.y, seat.z);
    origin.setXYZ(mote, seat.x, seat.y, seat.z);
    seeds.setX(mote, cohortMoteSeed(seed, mote - from));
    strengths.setX(mote, strength);
  }
  position.needsUpdate = true;
  origin.needsUpdate = true;
  seeds.needsUpdate = true;
  strengths.needsUpdate = true;
}

/**
 * Stamp the block this cohort won onto its 96 motes, in SIM SECONDS off the same
 * clock the material's `uTime` is written from.
 *
 * ⚠️ IT IS THE WHOLE COHORT OR NOTHING. The burst is a fact about the cohort and
 * not about any one speck, so the 96 slots take the same value; a partial write
 * would show as a wedge of the intake flaring.
 */
export function stampCohortMotes(
  geometry: THREE.BufferGeometry,
  index: number,
  simSecond: number,
): void {
  const { from, to } = cohortSlice(geometry, index);
  const gulp = geometry.getAttribute('aGulp');
  for (let mote = from; mote < to; mote += 1) gulp.setX(mote, simSecond);
  // The whole lane goes up: 576 floats for a six-cohort colony is 2.3 kB, which
  // is cheaper to upload than a partial range is to reason about.
  gulp.needsUpdate = true;
}
