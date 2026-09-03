import * as THREE from 'three';
import {
  COHORT_CONTEXT_ENERGY_GLSL,
  COHORT_GULP_GLSL,
  COHORT_GULP_INTERIOR,
} from './colonyCohort';
import {
  MIST_BACKTRACE_GLSL,
  MIST_DISC_COLOR_GLSL,
  MIST_DRIFT,
  MIST_DRIFT_SIGN,
  MIST_FIBRES_GLSL,
  MIST_FIBRE_R,
  MIST_FIBRE_ROT,
  MIST_FIBRE_SHARP,
  MIST_FIBRE_T,
  MIST_FIL,
  MIST_GRAIN,
  MIST_GULP_R,
  MIST_LANE_HI,
  MIST_LANE_LO,
  MIST_MEDIUM_GLSL,
  MIST_NOISE_LOD_GLSL,
  MIST_PERIOD,
  MIST_RIDGE,
  MIST_RIDGE_POW,
  MIST_SEAT_DRIFT_GLSL,
  MIST_SHARE_FACTOR_GLSL,
  MIST_SHARE_FLOOR,
  MIST_SINK_K,
  MIST_SWIRL,
  makeMistNoiseTexture,
} from './colonyMist';
import { PEER_NETWORK_PALETTE, type SceneColor } from '../visualPalette';

/**
 * A POW cohort's mark, COMPUTED rather than composed: light bent around a mass.
 *
 * ⭐⭐⭐ THE IMAGE IS A CONSEQUENCE, NOT A STACK OF PARTS. Seven rounds of a
 * hand-built form — a lens mesh, a mapped arc, a plane disc, a depth trick,
 * lensed motes — reached a ceiling the user named: it never looked like the
 * film. The reason is structural and is now on record. Gargantua's image is
 * what light does around a mass, and a stack of independently mapped parts
 * cannot converge on shapes it does not contain. So this program computes it:
 * ONE camera-facing quad per cohort, and for every pixel the light ray is
 * traced BACKWARD around a Schwarzschild mass and reported where it ends —
 *
 * - in the horizon: black, and it hides what is behind it;
 * - on the disc: the intake's own texture, sampled where the bent ray crosses
 *   the colony plane, with a fainter second image where the ray crosses twice;
 * - in the void: nothing but the glow.
 *
 * The shadow, the photon ring, the far side of the disc folded over the top,
 * the front crossing, the beaming and the redshift are not drawn. They FOLLOW,
 * at every camera angle, from that one trace.
 *
 * The user's rules that bind this form:
 *
 * 1. ⭐⭐⭐ THE MEMBRANE. The disc plane IS the colony plane and the shadow is
 *    the hole in it. Nothing here has any extent in Y at all.
 * 2. ⭐⭐⭐ THE INTAKE IS THE POINT, AND IT IS ONE SUBSTANCE. The disc's texture
 *    is the mist's own medium and spiral back-trace, compiled from
 *    `colonyMist.ts`'s library, and the ledger's share still sets the sink's
 *    strength. What the disc shows is the substance being taken.
 * 3. ⭐⭐ THE FIELD STAYS SECONDARY AT THE DEFAULT CAMERA. The whole image folds
 *    with distance: far, a soft six-unit intake halo with at most a pixel of
 *    dark; near, the film's hole with a twenty-eight-unit vortex. ONE closeness
 *    number drives the mass, the disc's extent, the texture, the shadow's
 *    opacity and the beaming.
 * 4. ⛔ NEVER UPWARD. Nothing here emits toward the canopy; the arc over the top
 *    is disc light bent by the mass, and it exists only because the mass is
 *    there.
 *
 * ⚠️⚠️ THE THREE TRAPS THIS PROGRAM IS BUILT AROUND, each of which cost the lab
 * a round:
 *
 * - ⛔ NO `texture2D` ANYWHERE IN IT. A sampler inside a ray march picks its mip
 *   level from screen-space derivatives, and neighbouring rays end at unrelated
 *   places: the derivatives explode along one axis and the tile comes back in
 *   dashed radial stripes. Every fetch is `textureLod` with an explicit level —
 *   which is why `mistNoise` is declared HERE, in this program, and the medium
 *   above it is the shared text. `colonyLensShaderGuards.test.ts` refuses the
 *   other fetch outright.
 * - ⛔ NO STRAIGHT-RAY SHORTCUT. At a handoff radius of ten horizons the
 *   deflection is still 0.2 rad, and the disc's far edge showed a hard dome cut
 *   exactly at the seam. EVERY ray is integrated; the adaptive step is what
 *   keeps the far ones cheap — a ray that passes wide takes about a dozen steps
 *   before it leaves.
 * - ⚠️ PREMULTIPLIED NORMAL BLENDING, WHICH MAKES RENDER ORDER PART OF THE
 *   DESIGN. The shadow occludes by ALPHA and not by depth, so it darkens what
 *   drew BEFORE it and nothing that draws after. This is the only normal-blended
 *   occluder in the colony, and the layer that mounts it must draw after the
 *   edges and the nodes and before the courier and delivery layers.
 *
 * ⭐ ONE MORE DEPARTURE FROM THE LAB, AND IT IS THE COLONY'S OWN. The lab's
 * scene does not turn; this one does, about world Y, so a cohort's WORLD
 * position sweeps several world units a second. A medium sampled at a world
 * point would swim past its own mouth. The vertex stage therefore carries the
 * colony's axes (`vFrameX`, `vFrameZ`) and the instance's colony-frame seat
 * (`vSeat`), and every sample of the substance below is taken in that frame.
 * Only the beaming — which is a fact about the camera — stays in world space.
 */

/* -------------------------------------------------------------------------- *
 * The mass, and everything that is a multiple of it.
 * -------------------------------------------------------------------------- */

/**
 * The Schwarzschild radius at the near end of the fold, in world units.
 *
 * ⭐⭐⭐ EVERY OTHER LENGTH IN THIS FILE IS A MULTIPLE OF IT, which is what makes
 * the fold ONE number: scale the mass and the shadow, the photon ring, the
 * ISCO and the bending all scale with it, because that is what the geometry
 * says. The shadow a distant observer sees is not `rs` but `3√3/2 · rs = 2.6
 * rs` across in impact parameter — at this value, 2.0 wu, which is why the hit
 * radius the card uses is re-based on it rather than on the quad.
 *
 * A STARTING VALUE from the approved preview, chosen against the peer mesh it
 * sits in: a sighted peer's sprite is 1–2 wu, so a 2.0 wu eye is a mark of the
 * mesh's own size at the camera where the eye is open at all.
 */
export const COHORT_HORIZON = 0.77;

/**
 * …and at the far end of the fold, where the whole form is a peer-sized smudge.
 *
 * ⭐⭐ THE MASS FOLDS WITH DISTANCE, AND THAT IS THE WHOLE TRICK. At the app
 * camera a cohort is 100+ wu away and the near form would be a 28 wu vortex in
 * a field of 1.5 wu sprites — the third rule, broken. At 0.08 the shadow is
 * 0.21 wu across: at most a pixel of dark, under a soft halo. The camera comes
 * in and the eye opens. ⚠️ It is NOT zero: a mass of zero has no disc plane
 * crossing at all, and the far form would pop out of existence rather than
 * fold.
 */
export const COHORT_HORIZON_FAR = 0.08;

/**
 * The disc's inner edge: the innermost stable circular orbit, at 3 horizons.
 *
 * ⭐ IT IS NOT A TASTE. Below 3 rs no circular orbit is stable, so there is
 * nothing there to shine — that is why the film's disc has a gap inside it, and
 * why the gap is OUTSIDE the 2.6 rs shadow rather than flush with it. Written
 * as the multiple, never as 2.31, so it follows the mass.
 *
 * ⚠️ IT IS A FUNCTION AS WELL AS A CONSTANT, and the layer has to keep using the
 * function: `cohortHorizon` is a live knob, and a knob that moved the mass while
 * `uDiscIn` held 2.31 would open a gap of the wrong size — the shadow would grow
 * out through its own accretion disc. One authority, re-derived per frame.
 */
export const COHORT_DISC_IN_HORIZONS = 3;

/** The disc's inner edge for a given horizon: the ISCO, in world units. */
export function cohortDiscInner(horizon: number): number {
  return COHORT_DISC_IN_HORIZONS * horizon;
}

/** The same edge at the shipped mass: 2.31 world units. */
export const COHORT_DISC_IN = cohortDiscInner(COHORT_HORIZON);

/** The disc's outer edge at the near end of the fold, in world units: the
 *  intake's range, where the streak field carries it and the fibres have
 *  faded. A starting value from the approved preview. */
export const COHORT_DISC_OUT = 28;

/**
 * …and at the far end, where the mark must not out-weigh a peer.
 *
 * ⚠️ IT FOLDS HARDER THAN THE MASS. The mass folds by 9.6× and the disc by
 * 4.7×, so the far form is proportionally WIDER than the near one — which is
 * the point: far away there is no shadow to see, and what is left has to be a
 * soft halo of intake rather than a scale model of a black hole.
 */
export const COHORT_DISC_OUT_FAR = 6;

/* ------------------------------------------- what other layers read off the mass */

/**
 * The apparent radius of the shadow, as a multiple of the horizon: `3√3/2`.
 *
 * ⭐⭐ A DISTANT OBSERVER DOES NOT SEE `rs`. The last ray that escapes has
 * impact parameter `3√3 M = 3√3/2 · rs`, so the black disc in the picture is
 * 2.598 horizons across in impact parameter and not one — which is why the
 * trace below produces a shadow 2.6 times larger than the mass suggests, why
 * the motes vanish THERE rather than at `rs`, and why the pick target is that
 * radius too. Written as the ratio so everything derived from it follows the
 * mass. It is not a number this file chose: `lensCaptured` resolves the same
 * boundary out of the integration, to within one step.
 */
export const COHORT_SHADOW_RATIO = (3 * Math.sqrt(3)) / 2;

/** The shadow's apparent radius for a given horizon, in world units.
 *
 *  ⚠️ A FUNCTION FOR THE REASON `cohortDiscInner` IS ONE: `cohortHorizon` is a
 *  live knob, and the radius the motes vanish at has to follow the mass or the
 *  specks disappear off the silhouette instead of into it. */
export function cohortShadowRadius(horizon: number): number {
  return COHORT_SHADOW_RATIO * horizon;
}

/**
 * The cohort's pick radius, in world units. `ColonyNodes` re-exports it as
 * `ATTESTED_HIT_RADIUS`, and it is the whole of what a viewer aims at.
 *
 * ⭐⭐⭐ IT IS THE SHADOW, AT THE NEAR END OF THE FOLD — 2.0 wu. The target is
 * the one place on this mark a viewer can be in no doubt about: the black disc
 * in the middle, which is the largest, most obviously deliberate feature the
 * form has. Derived (`ratio · horizon`) rather than typed, so a retune of the
 * mass moves the target with the picture; the preview's own literal was 2.0 and
 * this is 2.0005.
 *
 * ⭐⭐ AND IT IS THE SAME SPHERE AT EVERY DISTANCE, WHICH IS DELIBERATE AND NOT
 * AN OVERSIGHT. The drawn form folds with the camera — far away the shadow is
 * 0.21 wu and the halo is six — but the hit sphere lives in the TOPOLOGY, which
 * does not know where the camera is, and a pick radius that changed with it
 * would be a target that moved under the cursor as the user dollied. So the far
 * halo is explicitly NOT a hit target: it is a soft glow with no edge anybody
 * could aim at, and aiming at the middle of it lands inside this sphere anyway.
 *
 * ⚠️⚠️ IT WENT UP FROM 1.5 wu, AND THE BOUND THAT SETTLES IT IS THE KEEP-OUT
 * RATHER THAN THE COLONY'S SPACING. `COHORT_KEEP_OUT_R` in
 * `derives/networkTopology.derive.ts` empties a 3.5 wu XZ disc around every
 * attested position — a ghost or a staged peer inside it is pushed out to the
 * rim, the measured belt and the local node exempt — so the closest a clickable
 * neighbour may now stand is 3.5, and two pick spheres of 2.0 and a sighted
 * peer's largest 1.0 still leave half a world unit of daylight.
 * `cohortKeepOut.test.ts` pins the whole chain, since a derive may not import
 * this file. ⚠️ Judge any change to it against that number and never against
 * `COLONY_MIN_SPACING`, which bounds only the inferred scatter.
 *
 * ⭐ AND IT MUST NEVER GO SMALL AGAIN. This radius once made the producer the
 * SMALLEST target in the colony at 0.375 wu, under the faintest roster rung's
 * 0.425, and a full-canvas hover sweep of the running app found forty peers and
 * zero miners. There is still exactly ONE number: no annulus, no second radius.
 */
export const COHORT_HIT_RADIUS = cohortShadowRadius(COHORT_HORIZON);

/**
 * How far short of a cohort's centre its own links stop, in world units.
 *
 * ⭐⭐⭐ A LINK RUNNING INTO THE MARK IS A LINE LAID ACROSS AN IMAGE OF BENT
 * LIGHT. Everything inside this radius is the picture the trace computes — the
 * shadow, the photon ring, the disc's inner edge and the fold of the far side
 * over the top — and a colony link is a straight bright segment in the same
 * plane, drawn additively with no depth to reject it. It would read as a spoke
 * of a wheel through the one region of the scene that is saying "light does not
 * go straight here". `ColonyEdges` therefore ends a cohort's links out here
 * rather than at its node.
 *
 * ⭐ 3.0 wu, AND THE TWO INEQUALITIES ARE THE WHOLE JUSTIFICATION: it is
 * OUTSIDE the disc's inner edge (`COHORT_DISC_IN`, 2.31 wu — so no link ends on
 * top of the bright ring the ISCO makes) and INSIDE the keep-out (3.5 wu — so a
 * peer displaced to the rim still has half a world unit of its own link left to
 * draw, rather than one trimmed to a point). `cohortKeepOut.test.ts` pins
 * `HIT < DISC_IN < LINK_STOP < KEEP_OUT` in one line.
 *
 * ⚠️ IT IS NOT `COHORT_HIT_RADIUS`, AND THE SPLIT IS DELIBERATE. The two
 * consumers ask different questions — a line asks where the IMAGE ends, a click
 * asks how far a viewer may aim without taking a neighbour's stop — and
 * pretending they are one question means answering at least one of them wrong.
 * The near disc reaches 28 wu, so neither of them is "where the light stops":
 * beyond this radius the disc is a faint streak field the mesh is meant to show
 * through, and a link crossing THAT is the vortex being seen through, which is
 * what the outer disc is for.
 */
export const COHORT_LINK_STOP_R = 3.0;

/* -------------------------------------------------------------------------- *
 * The fold: one number, measured in pixels per world unit.
 * -------------------------------------------------------------------------- */

/**
 * Below this many pixels per world unit at the cohort, the form is fully
 * folded: a far halo, no eye, no beaming, the texture calmed to a glow.
 *
 * ⭐⭐ PIXELS PER WORLD UNIT AND NOT DISTANCE, because the same distance is a
 * different picture on a 1440p screen and a phone, and because a dolly and a
 * zoom must fold identically. `uPxScale / |camera − origin|` is that number
 * exactly: the layer writes `uPxScale = 0.5 · drawingBufferHeight ·
 * projectionMatrix[1][1]` once a frame, which is DPR-aware for free.
 */
export const COHORT_UNFOLD_LO = 6;

/** …and above this many, it is fully unfolded: the film's hole. Between them
 *  the closeness runs 0 → 1 on a smoothstep, and EVERY quantity that folds
 *  reads that one number, so nothing can unfold on its own schedule. */
export const COHORT_UNFOLD_HI = 30;

/* -------------------------------------------------------------------------- *
 * The integrator.
 * -------------------------------------------------------------------------- */

/**
 * How many RK4 steps a ray may take.
 *
 * ⭐ THE PRECISION IS WHAT THE QUALITY CASCADE MOVES, NEVER THE PRESENCE. A
 * cohort at 40 steps is the same cohort with a coarser photon ring; a cohort
 * that is not drawn is a producer the scene is lying about.
 */
export const COHORT_LENS_STEPS = 96;

/**
 * The base step, in radians of orbital angle.
 *
 * ⭐ THE INTEGRATION VARIABLE IS THE ANGLE AND NOT THE PATH LENGTH, which is
 * what makes a fixed step sane: the whole passage of a ray past a mass is order
 * π of angle whether it passes at two horizons or at forty. 0.055 rad puts ~57
 * steps in a half turn.
 */
export const COHORT_LENS_STEP = 0.055;

/**
 * The step is stretched for a ray that passes wide: `step · clamp(impact /
 * (2.5 rs), 1, 6)`.
 *
 * ⭐⭐ THIS IS WHAT PAYS FOR "EVERY RAY IS BENT". A ray at the capture radius
 * needs the full resolution and gets it (the clamp's floor is exactly 1 at 2.5
 * rs, just inside the 2.598 rs capture boundary); a ray passing at 30 horizons
 * bends by 0.07 rad in total and can cross the whole scene in nine steps. The
 * ceiling of 6 is measured, not guessed: at 6× the base the trace still agrees
 * with a 12× finer integration to better than 0.35 % of the deflection.
 */
export const COHORT_LENS_STEP_STRETCH_R = 2.5;
export const COHORT_LENS_STEP_STRETCH_MAX = 6;

/**
 * The loop's compile-time bound.
 *
 * ⚠️ A GLSL LOOP NEEDS A CONSTANT BOUND AND THE STEP COUNT IS A UNIFORM, so the
 * loop runs to this cap and breaks on `i >= uSteps`. It is the ceiling the
 * quality cascade may never exceed, and it is above the shipped 96 so a live
 * knob can explore.
 */
export const COHORT_LENS_STEP_CAP = 160;

/**
 * Half-extent of the quad, in world units.
 *
 * ⚠️ IT MUST COVER THE NEAR DISC AND ITS COST IS THE PIXELS IT COVERS. At 28 wu
 * of disc a 32 wu half-extent leaves four units of margin for the outer glow
 * and for the arc the lensing lifts above the plane. There is no cheaper way to
 * be sure the disc is not cut off by its own quad: the quad is the domain of
 * the trace, and a ray that is not launched draws nothing.
 */
export const COHORT_LENS_QUAD_R = 32;

/* -------------------------------------------------------------------------- *
 * The light.
 * -------------------------------------------------------------------------- */

/**
 * Relativistic beaming, at full closeness: the approaching side of the disc is
 * brighter than the receding one by this fraction.
 *
 * ⭐ IT IS THE FILM'S MOST RECOGNISABLE ASYMMETRY and the cheapest honest thing
 * in the program: one dot product of the disc's tangent with the view. It fades
 * out with the fold, because at six pixels an asymmetry is a dither pattern.
 */
export const COHORT_LENS_BEAM = 0.45;

/** How much of what is behind the disc the disc hides, at its brightest. Below
 *  1 on purpose: the mesh shows through the vortex, which is what keeps a
 *  cohort from reading as a solid plate laid on the colony. */
export const COHORT_LENS_DISC_ALPHA = 0.7;

/** The disc's own brightness where the fibres live, and how fast it falls with
 *  radius (as a power of the gathered fraction). Starting values from the
 *  approved preview. */
export const COHORT_LENS_DISC_AMP = 1.5;
export const COHORT_LENS_DISC_FALL = 1.2;

/**
 * The bloom the film's grade adds around the near hole — ⚠️ AS A STAND-IN,
 * BECAUSE THIS APP HAS NO POST-PROCESS. A Gaussian in the impact parameter,
 * four horizons wide.
 */
export const COHORT_LENS_GLOW = 0.35;
export const COHORT_LENS_GLOW_R = 4;

/**
 * The far form's presence: the mesh's own register.
 *
 * ⭐⭐ FAR AWAY THE MARK IS A HALO AND NOT A HOLE. The shadow is not painted at
 * all (its alpha is the closeness), so what is left is this: a one-unit glow
 * with a brighter half-unit core — deliberately the shape of a sighted peer's
 * sprite, because at that distance a cohort IS a peer that happens to mine.
 * ⚠️ The live leg has to measure the halo's brightest pixel against a measured
 * peer's core and it must come out at or below it.
 */
export const COHORT_LENS_FAR_GLOW = 0.3;
export const COHORT_LENS_FAR_GLOW_R = 1;
export const COHORT_LENS_FAR_GLOW_CORE = 0.5;
export const COHORT_LENS_FAR_GLOW_CORE_R = 0.35;

/**
 * The far disc's own law: brightness falling from the centre to the far radius,
 * `amp · (1 − ρ/out)^pow`, with the spiral left as a faint modulation.
 *
 * ⭐⭐ IT IS A DIFFERENT LAW AND NOT A DIMMED NEAR ONE. The near disc is bright
 * at its inner edge and dark in the gap inside it; at six pixels that reads as
 * a ring, and a ring is a shape the mesh does not have. A skirt falling from
 * the centre is the shape a peer HAS, which is why the far form wears it.
 */
export const COHORT_LENS_FAR_DISC_AMP = 0.9;
export const COHORT_LENS_FAR_DISC_POW = 2.2;

/* -------------------------------------------------------------------------- *
 * The substance, where this draw's numbers differ from the patch's.
 * -------------------------------------------------------------------------- */

/**
 * The catchment the disc's back-trace uses, in world units.
 *
 * ⚠️ IT IS NOT `MIST_REACH`, AND THE DIFFERENCE IS THE OBJECT'S SIZE. The patch
 * is a 14 wu surface seen from above; this disc is 28 wu across and the
 * streamlines have to still be bending at its rim, or the outer disc reads as
 * static noise with a vortex painted inside it.
 */
export const COHORT_LENS_REACH = 30;

/** How hard the medium piles up at the disc's inner edge. Below `MIST_CONC`
 *  because the near law already has its own radial term (`uDiscAmp · c^1.2`)
 *  and the patch has none. */
export const COHORT_LENS_CONC = 1;

/**
 * The streak field's contrast at the near and far ends of the fold.
 *
 * ⚠️ BOTH ARE ABOVE THE PATCH'S. The patch is looked at from a hundred world
 * units, where contrast is what survives prefiltering; this disc is looked at
 * from two, where the streaks are the substance's grain and have to be legible
 * against a disc that is itself bright.
 */
export const COHORT_LENS_CONTRAST_NEAR = 2.6;
export const COHORT_LENS_CONTRAST_FAR = 0.35;

/** How much of the fibre field is mixed into the inner disc at full closeness.
 *  Not 1: the streaks must still show through the threads, because they are the
 *  same substance and one of them is the flow. */
export const COHORT_LENS_FIBRE_MIX = 0.85;

/** The explicit mip level every noise fetch in this program reads. ⭐ LEVEL 0
 *  IS THE RIGHT DEFAULT AND NOT AN OVERSIGHT: the disc is looked at from close
 *  by, and the fold — not the mip chain — is what calms the texture with
 *  distance. It is a uniform so the live leg can walk it if the near disc
 *  aliases. */
export const COHORT_LENS_LOD = 0;

/** The amplitude, and the only scale on the whole draw. */
export const COHORT_LENS_AMP = 1;

/* -------------------------------------------------------------------------- *
 * Colour.
 * -------------------------------------------------------------------------- */

/**
 * The disc's three colour stops, cold: outer, mid, core.
 *
 * ⚠️ THEY ARE NOT `PEER_NETWORK_PALETTE` TOKENS, for the reason
 * `COHORT_INTERIOR_COLD` is not one either: the peer palette's tokens all name
 * roles INSIDE the peer plane, and this is the other world's light. What ties
 * them to the scene is the MID stop, which is a lightened `scaffold` — the
 * cohort's light is the peer plane's own hue, at a temperature.
 *
 * ⭐ THE CORE IS EXACTLY WHITE, and that is a statement rather than a
 * convenience: the inner disc is the hottest thing in the scene and everything
 * hot in this app clips to white. The ramp's SHAPE lives with the substance
 * (`MIST_DISC_COLOR_GLSL`); these are the three colours it interpolates.
 */
export const COHORT_DISC_CORE: SceneColor = [1, 1, 1];
export const COHORT_DISC_MID: SceneColor = [0.35, 0.85, 1.0];
export const COHORT_DISC_OUTER: SceneColor = [0.05, 0.25, 0.7];

/**
 * …and the same three warm, which is the film's own grade.
 *
 * ⭐ THE USER LEFT IT COLD, AND THE WARM SET IS KEPT ANYWAY. `COHORT_INTERIOR_COLD`
 * records the same decision one round earlier: the lab could lerp the mouth
 * toward the HUD's chrome orange and the approved still is the cold one. The
 * warm stops stay because the `cohortWarmth` knob is how the live leg puts the
 * two side by side on a real GPU, which is the only way that choice can be
 * re-made honestly.
 */
export const COHORT_DISC_CORE_WARM: SceneColor = [1, 1, 1];
export const COHORT_DISC_MID_WARM: SceneColor = [1.0, 0.62, 0.30];
export const COHORT_DISC_OUTER_WARM: SceneColor = [0.40, 0.16, 0.06];

/** The warmth the material is built at. Cold, as approved. */
export const COHORT_LENS_WARMTH = 0;

/**
 * The three stops at a given warmth.
 *
 * ⭐ THE LERP IS ON THE CPU AND NOT IN THE FRAGMENT, deliberately: warmth is a
 * per-DRAW fact, so paying for it per PIXEL would be three extra colour
 * uniforms and a mix per fragment to compute the same three constants the
 * material could hold. The shader sees three colours and does not know there is
 * a knob.
 */
export function cohortDiscStops(warmth: number): {
  readonly core: SceneColor;
  readonly mid: SceneColor;
  readonly outer: SceneColor;
} {
  const t = Math.min(1, Math.max(0, warmth));
  const lerp = (cold: SceneColor, warm: SceneColor): SceneColor => [
    cold[0] + (warm[0] - cold[0]) * t,
    cold[1] + (warm[1] - cold[1]) * t,
    cold[2] + (warm[2] - cold[2]) * t,
  ];
  return {
    core: lerp(COHORT_DISC_CORE, COHORT_DISC_CORE_WARM),
    mid: lerp(COHORT_DISC_MID, COHORT_DISC_MID_WARM),
    outer: lerp(COHORT_DISC_OUTER, COHORT_DISC_OUTER_WARM),
  };
}

/* -------------------------------------------------------------------------- *
 * The mirror: the trace's arithmetic in TypeScript, so it can be pinned.
 * -------------------------------------------------------------------------- */

/** GLSL's `smoothstep`, so the fold below is the shader's fold. */
function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** GLSL's `clamp`. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** GLSL's `mix`. */
function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** A ray's state on the orbit: `u = 1/r` and `u' = du/dφ`. */
export interface LensRayState {
  readonly u: number;
  readonly up: number;
}

/**
 * ONE RK4 step of the relativistic orbit equation, `u'' = −u + 3 M u²`.
 *
 * ⭐⭐ THIS IS THE WHOLE OF THE PHYSICS. The Newtonian term `−u` is what makes a
 * free ray a straight line in polar coordinates; `3 M u²` is general
 * relativity's entire correction for a light ray, and it is what produces the
 * shadow, the photon ring and the arc over the top. `M = rs / 2`.
 *
 * ⭐ FOURTH ORDER SO THE LONG STEPS HOLD. A ray that passes wide takes steps six
 * times the base, and a second-order integrator at that step visibly under-bends
 * the disc's far edge.
 */
export function lensRk4Step(
  u: number,
  up: number,
  h: number,
  M: number,
): LensRayState {
  const acceleration = (value: number): number => -value + 3 * M * value * value;
  const k1u = up;
  const k1p = acceleration(u);
  const u2 = u + 0.5 * h * k1u;
  const p2 = up + 0.5 * h * k1p;
  const k2u = p2;
  const k2p = acceleration(u2);
  const u3 = u + 0.5 * h * k2u;
  const p3 = up + 0.5 * h * k2p;
  const k3u = p3;
  const k3p = acceleration(u3);
  const u4 = u + h * k3u;
  const p4 = up + h * k3p;
  const k4u = p4;
  const k4p = acceleration(u4);
  return {
    u: u + (h * (k1u + 2 * k2u + 2 * k3u + k4u)) / 6,
    up: up + (h * (k1p + 2 * k2p + 2 * k3p + k4p)) / 6,
  };
}

/** The step this ray takes, in radians: the base, stretched for a wide pass. */
export function lensAdaptiveStep(
  impact: number,
  rs: number,
  step: number = COHORT_LENS_STEP,
): number {
  return (
    step
    * clamp(
      impact / (COHORT_LENS_STEP_STRETCH_R * rs),
      1,
      COHORT_LENS_STEP_STRETCH_MAX,
    )
  );
}

/** How a trace is run. Every default is the shipped program's. */
export interface LensTraceOptions {
  /** How many RK4 steps the ray may take. */
  readonly steps?: number;
  /** The base angular step, before the wide-pass stretch. */
  readonly step?: number;
  /**
   * The mass, in world units. Defaults to `rs / 2`, which is the Schwarzschild
   * relation and the only value the program ever uses.
   *
   * ⭐ IT IS OVERRIDABLE FOR EXACTLY ONE REASON: at `M = 0` the orbit equation
   * becomes `u'' = −u`, whose solutions are STRAIGHT LINES in polar
   * coordinates. That is the integrator's null test — the one case whose answer
   * is known exactly and independently — and there is no other way to ask for
   * it, because `rs` also sets the horizon, the step and the start radius.
   */
  readonly mass?: number;
}

/** Where a traced ray ended up. */
export interface LensTrace {
  /** Total change of the ray's DIRECTION, in radians. */
  readonly bend: number;
  /** The periapsis, in world units, or `Infinity` if the ray never turned. */
  readonly closest: number;
  /** True if the ray crossed the horizon. */
  readonly captured: boolean;
  /** How many steps it actually took. */
  readonly steps: number;
}

/**
 * The shader's trace, in TypeScript: a ray launched from `r0 = 200 rs` with the
 * given impact parameter, integrated exactly as the fragment integrates it.
 *
 * ⭐⭐ THE BEND IS MEASURED AS A DIRECTION AND NOT AS A SWEPT ANGLE. At radius
 * `r` and orbital angle `φ` the ray points along `ψ = φ + atan2(u, −u′)`, which
 * is CONSTANT for an unbent ray at any radius — so the deflection is `ψ_end −
 * ψ_start` with no geometry to subtract, and a straight ray reports exactly
 * zero however far out it is measured. The `atan2` is unwrapped step by step,
 * because a ray that turns far enough would otherwise report its bend modulo a
 * full turn.
 *
 * ⚠️ THE START RADIUS IS FINITE, so a deflection measured here is short of the
 * asymptotic one by the bending that happens outside it — about `(b/r0)²` of
 * the total, which at 200 rs is 0.06 % at ten horizons and 2 % at forty.
 */
export function lensTrace(
  impact: number,
  rs: number,
  options: LensTraceOptions = {},
): LensTrace {
  const steps = options.steps ?? COHORT_LENS_STEPS;
  const step = options.step ?? COHORT_LENS_STEP;
  const M = options.mass ?? 0.5 * rs;
  const r0 = 200 * rs;
  const sine = impact / r0;
  const along = -Math.sqrt(Math.max(1 - sine * sine, 0));
  const h = lensAdaptiveStep(impact, rs, step);
  let u = 1 / r0;
  let up = (-along * u) / Math.max(sine, 1e-5);
  let phi = 0;
  let psi = phi + Math.atan2(u, -up);
  const psi0 = psi;
  let captured = false;
  let taken = 0;
  let closest = Infinity;
  for (let i = 0; i < steps; i += 1) {
    const before = { u, up };
    const next = lensRk4Step(u, up, h, M);
    u = next.u;
    up = next.up;
    phi += h;
    taken += 1;
    if (u <= 0) break;
    const turned = phi + Math.atan2(u, -up);
    psi = turned + 2 * Math.PI * Math.round((psi - turned) / (2 * Math.PI));
    // The periapsis is where u' changes sign; a cubic Hermite through the two
    // states brackets it far more finely than the step does, which is what lets
    // the straight-ray case be pinned to 1e-4 with a 0.11 rad step.
    if (before.up > 0 && up <= 0 && closest === Infinity) {
      const hermite = (
        s: number,
        f0: number,
        d0: number,
        f1: number,
        d1: number,
      ): number => {
        const s2 = s * s;
        const s3 = s2 * s;
        return (
          (2 * s3 - 3 * s2 + 1) * f0
          + (s3 - 2 * s2 + s) * h * d0
          + (-2 * s3 + 3 * s2) * f1
          + (s3 - s2) * h * d1
        );
      };
      const slope = (value: number): number => -value + 3 * M * value * value;
      let low = 0;
      let high = 1;
      for (let bisect = 0; bisect < 60; bisect += 1) {
        const middle = (low + high) / 2;
        if (hermite(middle, before.up, slope(before.u), up, slope(u)) > 0) {
          low = middle;
        } else {
          high = middle;
        }
      }
      closest = 1 / hermite((low + high) / 2, before.u, before.up, u, up);
    }
    const r = 1 / u;
    if (r < rs) {
      captured = true;
      break;
    }
    if (phi > 0.6 && r > r0 * 1.2) break;
  }
  return { bend: psi - psi0, closest, captured, steps: taken };
}

/** The total bend of a ray with this impact parameter, in radians. */
export function lensDeflection(
  impact: number,
  rs: number,
  steps: number = COHORT_LENS_STEPS,
  step: number = COHORT_LENS_STEP,
): number {
  return lensTrace(impact, rs, { steps, step }).bend;
}

/**
 * Whether a ray with this impact parameter falls in.
 *
 * ⭐ THE BOUNDARY IS `b = 3√3 M = 2.598 rs` and nothing in the program says so:
 * it FALLS OUT of the integration, which is the whole argument for computing
 * the image instead of drawing it. The trace resolves it to within one step.
 */
export function lensCaptured(
  impact: number,
  rs: number,
  steps: number = COHORT_LENS_STEPS,
): boolean {
  return lensTrace(impact, rs, { steps }).captured;
}

/** The fold, from pixels per world unit at the cohort. */
export function lensCloseness(pxPerWu: number): number {
  return smoothstep(COHORT_UNFOLD_LO, COHORT_UNFOLD_HI, pxPerWu);
}

/** Everything the fold moves, at one camera. */
export interface LensFold {
  readonly closeness: number;
  readonly horizon: number;
  readonly discIn: number;
  readonly discOut: number;
  /** The alpha a captured ray paints: the shadow's opacity. */
  readonly shadowAlpha: number;
}

/**
 * ⭐⭐⭐ ONE NUMBER DRIVES ALL OF IT. The mass, the disc's inner edge (which is a
 * multiple of the mass), the disc's outer edge and the shadow's opacity all
 * read the same closeness, so no part of the form can unfold on its own
 * schedule and there is no camera at which the mark is half of one thing.
 */
export function lensFold(pxPerWu: number): LensFold {
  const closeness = lensCloseness(pxPerWu);
  const horizon = mix(COHORT_HORIZON_FAR, COHORT_HORIZON, closeness);
  return {
    closeness,
    horizon,
    discIn: COHORT_DISC_IN * (horizon / COHORT_HORIZON),
    discOut: mix(COHORT_DISC_OUT_FAR, COHORT_DISC_OUT, closeness),
    shadowAlpha: closeness,
  };
}

/** The far disc's law, without the medium's own modulation. */
export function lensFarLaw(rho: number, out: number): number {
  return (
    COHORT_LENS_FAR_DISC_AMP
    * Math.max(1 - rho / out, 0) ** COHORT_LENS_FAR_DISC_POW
  );
}

/** The near disc's outer fade: 1 inside 0.4 of the outer radius, 0 at it. */
export function lensNearOuterFade(rho: number, out: number): number {
  return 1 - smoothstep(0.4, 1, rho / out);
}

/** The disc's inner edge: 0 at the ISCO, 1 at 1.06 of it. ⭐ SHARP ON PURPOSE —
 *  the gap between the shadow and the disc is a fact about orbits, and a soft
 *  edge there reads as a glow filling the gap in. */
export function lensDiscInnerEdge(rho: number, edge: number): number {
  return smoothstep(1, 1.06, rho / edge);
}

/**
 * Relativistic beaming, as a factor on the disc's brightness.
 *
 * `cosToTangent` is the disc's tangent at that point dotted with the direction
 * BACK toward the camera: +1 where the material comes straight at the viewer.
 * ⭐ Antisymmetric by construction, so the disc's total light is unchanged and
 * only its distribution moves.
 */
export function lensBeaming(cosToTangent: number, closeness: number): number {
  return 1 + COHORT_LENS_BEAM * closeness * cosToTangent;
}

/** The gravitational redshift's dimming, `sqrt(1 − rs/ρ)`: 0 at the horizon,
 *  and indistinguishable from 1 by the time the disc's outer edge is reached. */
export function lensRedshift(rho: number, rs: number): number {
  return Math.sqrt(Math.max(1 - rs / rho, 0));
}

/* -------------------------------------------------------------------------- *
 * The program.
 * -------------------------------------------------------------------------- */

/**
 * One cohort's mark: an instanced camera-facing quad that traces light.
 *
 * The vertex convention is the aura's, exactly: `instanceMatrix` carries a
 * TRANSLATION and nothing else, the quad's half-extent rides `uQuadR`, and the
 * three lanes are the ones the layer already plans — `aSeed` (decorrelation),
 * `aGulp` (the sim second of the block this cohort won) and `aShare` (its
 * fraction of its window, which is the sink's strength here exactly as it is
 * under the patch).
 *
 * ⚠️ A SCALED INSTANCE MATRIX WOULD MOVE THE QUAD WITHOUT MOVING THE MASS, and
 * the mark would be a window onto a hole that is somewhere else.
 */
export function makeCohortLensMaterial(): THREE.ShaderMaterial {
  const stops = cohortDiscStops(COHORT_LENS_WARMTH);
  return new THREE.ShaderMaterial({
    // ⚠️⚠️ NOT ADDITIVE, AND IT IS THE ONLY DRAW IN THE COLONY THAT IS NOT. The
    // shadow is a place where light is REMOVED, and additive blending has no
    // way to say that: it can only fail to add. Premultiplied normal blending
    // does — `dst = src + dst·(1 − a)` — which is why the mark can hide a link
    // behind it. ⚠️ The cost is that render order becomes part of the design:
    // it darkens what drew BEFORE it and nothing that draws after.
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    premultipliedAlpha: true,
    toneMapped: false,
    side: THREE.DoubleSide,
    uniforms: {
      uNoise: { value: makeMistNoiseTexture() },
      uLod: { value: COHORT_LENS_LOD },
      uTime: { value: 0 },
      uContextEnergy: { value: 1 },
      uAmp: { value: COHORT_LENS_AMP },
      uQuadR: { value: COHORT_LENS_QUAD_R },
      // ---- the fold. ⚠️ uPxScale starts absurdly large so a material built
      // and drawn before the layer's first frame is UNFOLDED rather than
      // invisible: a missing uniform then shows as the wrong form, not as a
      // cohort that is not there.
      uPxScale: { value: 1e6 },
      uUnfoldLo: { value: COHORT_UNFOLD_LO },
      uUnfoldHi: { value: COHORT_UNFOLD_HI },
      // ---- the mass and the disc
      uHorizon: { value: COHORT_HORIZON },
      uHorizonFar: { value: COHORT_HORIZON_FAR },
      uDiscIn: { value: COHORT_DISC_IN },
      uDiscOut: { value: COHORT_DISC_OUT },
      uDiscOutFar: { value: COHORT_DISC_OUT_FAR },
      uSteps: { value: COHORT_LENS_STEPS },
      uStep: { value: COHORT_LENS_STEP },
      // ---- the substance: the mist's own numbers, imported and not restated,
      // because the disc and the patch are one medium.
      uGrain: { value: MIST_GRAIN },
      uRidge: { value: MIST_RIDGE },
      uRidgePow: { value: MIST_RIDGE_POW },
      uReach: { value: COHORT_LENS_REACH },
      uK: { value: MIST_SINK_K },
      uSwirl: { value: MIST_SWIRL },
      uDrift: { value: MIST_DRIFT },
      uDriftSign: { value: MIST_DRIFT_SIGN },
      uPeriod: { value: MIST_PERIOD },
      uShareFloor: { value: MIST_SHARE_FLOOR },
      // ⚠️ 1 rather than 0, for the reason the patch's does: an unwritten
      // maximum reads shares as themselves instead of dividing by nothing.
      uShareMax: { value: 1 },
      // ---- the disc's texture
      uFil: { value: MIST_FIL },
      uContrastNear: { value: COHORT_LENS_CONTRAST_NEAR },
      uContrastFar: { value: COHORT_LENS_CONTRAST_FAR },
      uConc: { value: COHORT_LENS_CONC },
      uGulpR: { value: MIST_GULP_R },
      uDiscAmp: { value: COHORT_LENS_DISC_AMP },
      uDiscFall: { value: COHORT_LENS_DISC_FALL },
      uFibreMix: { value: COHORT_LENS_FIBRE_MIX },
      uFibreT: { value: MIST_FIBRE_T },
      uFibreR: { value: MIST_FIBRE_R },
      uFibreSharp: { value: MIST_FIBRE_SHARP },
      uFibreRot: { value: MIST_FIBRE_ROT },
      uLaneLo: { value: MIST_LANE_LO },
      uLaneHi: { value: MIST_LANE_HI },
      // ---- the light
      uBeam: { value: COHORT_LENS_BEAM },
      uDiscAlpha: { value: COHORT_LENS_DISC_ALPHA },
      uGlow: { value: COHORT_LENS_GLOW },
      uGlowR: { value: COHORT_LENS_GLOW_R },
      uFarGlow: { value: COHORT_LENS_FAR_GLOW },
      uFarGlowR: { value: COHORT_LENS_FAR_GLOW_R },
      uFarDiscAmp: { value: COHORT_LENS_FAR_DISC_AMP },
      uFarDiscPow: { value: COHORT_LENS_FAR_DISC_POW },
      uColCore: { value: new THREE.Color().setRGB(...stops.core) },
      uColMid: { value: new THREE.Color().setRGB(...stops.mid) },
      uColOuter: { value: new THREE.Color().setRGB(...stops.outer) },
      // ⭐ The glow's own hue IS a peer token: it is the light around the mark
      // as the mesh sees it, and the mesh's colour is `scaffold`.
      uRimColor: { value: new THREE.Color().setRGB(...PEER_NETWORK_PALETTE.scaffold) },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aGulp;
      attribute float aShare;

      uniform float uQuadR;
      uniform float uDriftSign;
      uniform float uShareFloor;
      uniform float uShareMax;

      varying vec3 vWorld;
      varying vec3 vOrigin;
      varying vec2 vSeat;
      varying vec2 vDrift;
      varying vec2 vFrameX;
      varying vec2 vFrameZ;
      varying float vSeed;
      varying float vGulp;
      varying float vShareF;

      void main() {
        vSeed = aSeed;
        vGulp = aGulp;
        ${MIST_SHARE_FACTOR_GLSL}
        // The instance's own world point: the centre of the mass, the origin of
        // every ray's polar frame, and what the context exemption measures.
        vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vOrigin = origin.xyz;
        ${MIST_SEAT_DRIFT_GLSL}
        vSeat = seat.xz;
        // ⭐⭐ THE COLONY'S OWN AXES, so the fragment can sample the substance in
        // the frame the substance lives in. The colony turns about world Y and
        // carries its cohorts with it; a medium sampled at a WORLD point would
        // stream past each mouth at several world units a second, which is a
        // motion the flow does not have and the eye reads instantly.
        vFrameX = (modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xz;
        vFrameZ = (modelMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xz;
        // The quad faces the camera: it is the DOMAIN of the trace and never a
        // picture of anything, so its orientation carries no meaning at all.
        vec3 cameraRight = vec3(
          viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]
        );
        vec3 cameraUp = vec3(
          viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]
        );
        vWorld = origin.xyz
          + (cameraRight * position.x + cameraUp * position.y) * uQuadR * 2.0;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform sampler2D uNoise;
      uniform float uLod;
      uniform float uTime;
      uniform float uContextEnergy;
      uniform float uAmp;
      uniform float uPxScale;
      uniform float uUnfoldLo;
      uniform float uUnfoldHi;
      uniform float uHorizon;
      uniform float uHorizonFar;
      uniform float uDiscIn;
      uniform float uDiscOut;
      uniform float uDiscOutFar;
      uniform int uSteps;
      uniform float uStep;
      uniform float uGrain;
      uniform float uRidge;
      uniform float uRidgePow;
      uniform float uReach;
      uniform float uK;
      uniform float uSwirl;
      uniform float uDrift;
      uniform float uPeriod;
      uniform float uFil;
      uniform float uContrastNear;
      uniform float uContrastFar;
      uniform float uConc;
      uniform float uGulpR;
      uniform float uDiscAmp;
      uniform float uDiscFall;
      uniform float uFibreMix;
      uniform float uFibreT;
      uniform float uFibreR;
      uniform float uFibreSharp;
      uniform float uFibreRot;
      uniform float uLaneLo;
      uniform float uLaneHi;
      uniform float uBeam;
      uniform float uDiscAlpha;
      uniform float uGlow;
      uniform float uGlowR;
      uniform float uFarGlow;
      uniform float uFarGlowR;
      uniform float uFarDiscAmp;
      uniform float uFarDiscPow;
      uniform vec3 uColCore;
      uniform vec3 uColMid;
      uniform vec3 uColOuter;
      uniform vec3 uRimColor;

      varying vec3 vWorld;
      varying vec3 vOrigin;
      varying vec2 vSeat;
      varying vec2 vDrift;
      varying vec2 vFrameX;
      varying vec2 vFrameZ;
      varying float vSeed;
      varying float vGulp;
      varying float vShareF;

      // ---- the substance, read the one way a ray march may read it ---------
      //
      // ⛔ NO texture2D IN THIS PROGRAM. Neighbouring rays end at unrelated
      // places, so the derivatives a sampler would use to pick a mip are
      // meaningless and the tile comes back in coarse stripes. The level is
      // stated. Everything under the fetch is the mist's own text.
      ${MIST_NOISE_LOD_GLSL}

      ${MIST_MEDIUM_GLSL}

      ${MIST_BACKTRACE_GLSL}

      ${MIST_FIBRES_GLSL}

      ${MIST_DISC_COLOR_GLSL}

      // ---- what the disc looks like where a ray crossed it ------------------
      //
      // ⭐⭐ IT IS THE INTAKE AND NOT A TEXTURE OF A DISC. The medium, the
      // spiral back-trace and the sink's strength are the patch's own, compiled
      // from the same strings, so a viewer looking at a cohort's disc and a
      // viewer looking at the mist under another one are looking at one
      // substance being taken at two rates.
      vec4 lensDisc(
        vec3 hit, vec3 view, float closeness, float edge, float outR, float rs
      ) {
        vec2 dxz = hit.xz - vOrigin.xz;
        float rho = max(length(dxz), 1e-4);
        // ⭐ IN THE COLONY'S FRAME, NOT THE WORLD'S — see the vertex stage.
        vec2 local = vec2(dot(dxz, vFrameX), dot(dxz, vFrameZ));
        float th = atan(local.y, local.x);
        // How far in the material has come, as a fraction: 1 at the inner edge.
        float cc = clamp(edge / rho, 0.0, 1.0);

        // The same clock, the same two phases and the same seed the patch uses,
        // so six cohorts never breathe together and this one breathes with its
        // own mist.
        float ph = uTime / uPeriod + vSeed;
        float t0 = fract(ph) * uPeriod;
        float t1 = fract(ph + 0.5) * uPeriod;
        float phaseMix = 1.0 - abs(2.0 * fract(ph) - 1.0);
        // ⭐ The seat is what decorrelates the six discs: the back-trace runs in
        // the sink's own frame and the tile is read at the cohort's colony-frame
        // seat, which is a CONSTANT. Sampling at a world point would swim.
        float gA = mistMedium(mistBacktrace(local, t0) + vSeat, 1.0);
        float gB = mistMedium(mistBacktrace(local, t1) + vSeat, 1.0);
        float g = mix(gB, gA, phaseMix);
        // Far away the texture would read as noise at a few pixels, so it calms
        // to a smooth glow: the streaks flatten toward the medium's own mean.
        g = mix(0.5, g, mix(0.3, 1.0, closeness));

        // ---- the block this cohort won, on the SAME curve the mouth swallows
        ${COHORT_GULP_GLSL}
        // The pile: the area compression a 2-D sink applies to a parcel, at
        // this cohort's own rate — the same argument the patch's lip makes.
        float pile = uConc * vShareF * cc * cc * cc
          + ${COHORT_GULP_INTERIOR.toFixed(1)} * gulp
            * clamp(edge * uGulpR / rho, 0.0, 1.0);

        // The fibres keep the inner disc; outside two inner radii the spiral
        // streak field takes over, so the outer disc reads as the vortex
        // drawing material in rather than as a ring of light.
        float inner = smoothstep(0.35, 0.7, cc);
        float fib = mix(
          1.0, mistFibres(rho / edge, th, g, uTime), uFibreMix * inner * closeness
        );
        float streak = uFil * g
          * (uContrastFar + uContrastNear * mix(1.0, 0.45, inner))
          * (1.0 + pile);
        float nearLaw = (
          streak + uDiscAmp * pow(cc, uDiscFall) * fib * (0.7 + 0.3 * g)
        ) * (1.0 - smoothstep(0.4, 1.0, rho / outR));
        // Far away the disc is an intake halo instead: brightness falling from
        // the centre to the far radius like a peer's skirt, the spiral a faint
        // modulation on it.
        float farLaw = uFarDiscAmp
          * pow(max(1.0 - rho / outR, 0.0), uFarDiscPow) * (0.7 + 0.3 * g);
        float v = mix(farLaw, nearLaw, closeness);
        // A sharp inner edge, written as a fraction of it so the guard can read
        // both edges without resolving a local.
        v *= smoothstep(1.0, 1.06, rho / edge);
        // Beaming toward the camera on the approaching side. The tangent is a
        // WORLD direction: this is a fact about the camera, not about the
        // substance, and it is the one thing here the colony's frame is wrong
        // for.
        vec3 tangent = vec3(-dxz.y, 0.0, dxz.x) / rho;
        v *= 1.0 + uBeam * closeness * dot(tangent, -view);
        // …and the redshift's dimming, which is what puts the dark ring inside
        // the bright one.
        v *= sqrt(max(1.0 - rs / rho, 0.0));

        vec3 col = mistDiscColor(cc);
        // The outer disc is thinner, so the mesh shows through the vortex; the
        // far form is thinner still, because at six pixels an opaque disc is a
        // blob and the mark must stay secondary.
        float a = clamp(
          v * uDiscAlpha * mix(0.4, 1.0, inner) * mix(0.3, 1.0, closeness),
          0.0, 0.85
        );
        return vec4(col * v, a);
      }

      void main() {
        vec3 c = vOrigin;
        vec3 o = cameraPosition;
        vec3 d = normalize(vWorld - o);
        vec3 oc = o - c;
        float r0 = max(length(oc), 1e-4);

        // ⭐⭐⭐ HOW CLOSE THE CAMERA IS, AND THE WHOLE FORM FOLDS WITH IT. Far,
        // the mass folds and with it every radius, so the cohort is a
        // peer-sized eye in the mesh; near, the film's hole.
        float closeness = smoothstep(uUnfoldLo, uUnfoldHi, uPxScale / r0);
        float rs = mix(uHorizonFar, uHorizon, closeness);
        float fold = rs / uHorizon;
        float discIn = uDiscIn * fold;
        float discOut = mix(uDiscOutFar, uDiscOut, closeness);
        float M = 0.5 * rs;

        // The ray's own polar frame: e1 toward the camera, e2 the direction it
        // is heading in, phi the angle it has swept about the mass.
        vec3 e1 = oc / r0;
        float alongE1 = dot(d, e1);
        vec3 dp = d - alongE1 * e1;
        float b = length(dp);
        vec3 e2 = b > 1e-5 ? dp / b : vec3(0.0, 1.0, 0.0);
        float impact = r0 * b;

        vec4 acc = vec4(0.0);
        float trans = 1.0;
        bool captured = false;

        float u = 1.0 / r0;
        float up = -alongE1 * u / max(b, 1e-5);
        float phi = 0.0;
        // ⚠️ EVERY RAY IS BENT, and the step is what makes that affordable: a
        // ray passing wide bends little and takes steps six times as long, so
        // the seam a straight-ray shortcut leaves at the disc's far edge never
        // exists. Fourth order, so the long steps hold.
        float h = uStep * clamp(
          impact / (${COHORT_LENS_STEP_STRETCH_R.toFixed(1)} * rs),
          1.0, ${COHORT_LENS_STEP_STRETCH_MAX.toFixed(1)}
        );
        vec3 prev = o;
        float prevY = o.y - c.y;
        for (int i = 0; i < ${COHORT_LENS_STEP_CAP}; i++) {
          if (i >= uSteps) break;
          float k1u = up;
          float k1p = -u + 3.0 * M * u * u;
          float u2 = u + 0.5 * h * k1u;
          float p2 = up + 0.5 * h * k1p;
          float k2u = p2;
          float k2p = -u2 + 3.0 * M * u2 * u2;
          float u3 = u + 0.5 * h * k2u;
          float p3 = up + 0.5 * h * k2p;
          float k3u = p3;
          float k3p = -u3 + 3.0 * M * u3 * u3;
          float u4 = u + h * k3u;
          float p4 = up + h * k3p;
          float k4u = p4;
          float k4p = -u4 + 3.0 * M * u4 * u4;
          u += h * (k1u + 2.0 * k2u + 2.0 * k3u + k4u) / 6.0;
          up += h * (k1p + 2.0 * k2p + 2.0 * k3p + k4p) / 6.0;
          phi += h;
          if (u <= 0.0) break;
          float r = 1.0 / u;
          // ⭐ THE HORIZON IS A CONSEQUENCE. Nothing draws the shadow: a ray
          // that ends here simply never reaches anything that shines.
          if (r < rs) { captured = true; break; }
          vec3 pnow = c + r * (cos(phi) * e1 + sin(phi) * e2);
          float y = pnow.y - c.y;
          // ⭐⭐ THE PLANE CROSSING, AND THE SECOND IMAGE. A ray that crosses the
          // colony plane inside the disc picks up its light; the transmittance
          // it leaves is what lets a SECOND crossing show through the first,
          // which is the far side of the disc seen over the top of the hole.
          if (y * prevY < 0.0) {
            float f = prevY / (prevY - y);
            vec3 hit = mix(prev, pnow, f);
            float rho = length(hit.xz - c.xz);
            if (rho > discIn && rho < discOut) {
              vec4 sm = lensDisc(
                hit, normalize(pnow - prev), closeness, discIn, discOut, rs
              );
              acc.rgb += trans * sm.rgb;
              acc.a += trans * sm.a;
              trans *= (1.0 - sm.a);
              if (trans < 0.04) break;
            }
          }
          prev = pnow;
          prevY = y;
          // The ray has left: it is heading away and is already further out
          // than it started.
          if (phi > 0.6 && r > r0 * 1.2) break;
        }

        // ⭐⭐⭐ FAR AWAY THE SHADOW IS NOT PAINTED AT ALL. Its black and its
        // occlusion fade in with the closeness, so from the default camera a
        // cohort is a soft halo of intake with no eye, and the eye opens as the
        // camera comes in. This one line is what keeps the mark secondary.
        if (captured) { acc.a = closeness; }

        // The bloom the film's grade adds near, and the halo that IS the far
        // form. ⚠️ Written as t*t rather than pow(t, 2.0) so no reader has to
        // prove the base non-negative.
        float glowRad = mix(uFarGlowR, uGlowR * rs, closeness);
        float shadowCut = mix(1.0, captured ? 0.0 : 1.0, closeness);
        float t = impact / max(glowRad, 1e-4);
        float glow = (uGlow * closeness + uFarGlow * (1.0 - closeness))
          * exp(-t * t) * shadowCut;
        // The far halo has a brighter core: the peer sprite's own nucleus, which
        // is the register the mark wears when it is one mark among hundreds.
        float tc = t / ${COHORT_LENS_FAR_GLOW_CORE_R.toFixed(2)};
        glow += uFarGlow * (1.0 - closeness)
          * ${COHORT_LENS_FAR_GLOW_CORE.toFixed(1)} * exp(-tc * tc) * shadowCut;
        vec3 glowCol = mix(uRimColor, uColMid, 0.5 * closeness);
        acc.rgb += glowCol * glow;

        if (acc.a <= 0.0 && dot(acc.rgb, vec3(1.0)) < 0.002) discard;
        ${COHORT_CONTEXT_ENERGY_GLSL}
        // ⚠️ ENERGY MULTIPLIES RGB AND NEVER ALPHA — the house idiom. On an
        // ADDITIVE draw that is simply a dim; here it also means a damped mark
        // still occludes exactly as much as an undamped one, which is right:
        // the hole is a fact about the colony and not about what the HUD is
        // currently interested in.
        gl_FragColor = vec4(
          acc.rgb * uAmp * cohortEnergy, clamp(acc.a, 0.0, 1.0)
        );
      }
    `,
  });
}
