import * as THREE from 'three';
import {
  COHORT_CONTEXT_ENERGY_GLSL,
  COHORT_GULP_GLSL,
  COHORT_GULP_NUCLEUS,
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
 *    with distance: near, the film's hole with a twenty-eight-unit vortex;
 *    far, THE INTAKE ITSELF — the mesh's own light winding into a peer-like
 *    nucleus over a ten-unit catchment, with no hole and no ring, because out
 *    there a hole is a small eye (see `lensFarSample`). ONE closeness number drives the
 *    mass, the disc's extent, the texture and the beaming; the shadow's dark
 *    alone waits for the last part of the band (`lensHoleGate`).
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
 * ⭐⭐⭐ AND SINCE 2026-09-04 THE MULTIPLE IS PER COHORT. Every length below is
 * this radius times the instance's own mass factor `vMass` — the magnitude of
 * the `aMass` lane, `clamp(cbrt(week / COHORT_MASS_ANCHOR_SHARE),
 * COHORT_MASS_FLOOR, 1)` — so EVERY WORLD-UNIT SIZE QUOTED IN THIS FILE IS THE
 * `m = 1` COHORT'S, and a cohort at the floor wears 0.45 of each of them. The
 * fold's own closeness is taken on `uPxScale * vMass`, so what the band is
 * really measured in is pixels per SHADOW and every hole opens at the same
 * on-screen size whatever the mass behind it.
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
 * The share of the indexer's seven-day window at which a cohort is FULL SIZE.
 *
 * ⭐⭐⭐ THE MASS IS THE ONE THING A COHORT SAYS ABOUT ITSELF, AND THE CEILING IS
 * TODAY'S ACCEPTED FORM. Every form parameter above is a global uniform, so
 * seven cohorts were seven copies of one picture; from 2026-09-04 each carries
 * a factor `m` in [`COHORT_MASS_FLOOR`, 1] that multiplies EVERY length in
 * both of its programs, and `m` is the cube root of its share of the week
 * against this anchor. At and above it a cohort is exactly the form the user
 * judged on 2026-09-03; everyone else folds DOWN, so the colony can get
 * quieter and never louder — which is how the third rule (the field stays
 * secondary to the mesh and the canopy) survives a channel that moves size at
 * all.
 *
 * ⚠️ IT IS THE WEEK AND NEVER THE RING. A size the eye compares across days
 * must not pulse once a block: the 240-block ring moves on every block, empties
 * on every reorg and is empty for the first minute of a boot. No ledger ⇒ every
 * mass is 1 ⇒ today's picture, byte for byte.
 *
 * ⭐ 0.6 IS ALSO ABOUT THE LARGEST SHARE ONE POOL PLAUSIBLY HOLDS (the live top
 * was 62.5 % on 2026-09-02 and 63.5 % a day later). A week with no cohort near
 * it leaves every mark under size and the colony quieter than today; that is
 * honest, and `cohortMassAnchor` is live for the day it is judged too quiet.
 */
export const COHORT_MASS_ANCHOR_SHARE = 0.6;

/**
 * …and the smallest a cohort may be, as a fraction of that full mass.
 *
 * ⭐⭐ A LESSER PEER, NEVER A VANISHED ONE, and the floor is chosen against the
 * peer mesh's own world diameters (ghost 0.65, sighted dark 1.5, sighted
 * reached 2.0). `exp(-t²)` falls to a tenth at t = 1.52, so the nucleus is
 * `2 · 1.52 · COHORT_LENS_FAR_GLOW_R · m` across — 0.96 wu here, which still
 * out-foots a ghost and sits under a dark sighted peer. The other inequality
 * the floor has to keep is `COHORT_DISC_OUT_FAR · floor` = 6.3 wu >
 * `COHORT_LINK_STOP_R` 3.0, so even the smallest cohort's arms still cover the
 * end of its own links; `cohortKeepOut.test.ts` pins both.
 *
 * ⭐ AND A FLOOR OF 1 IS THE OFF SWITCH. Every mass is clamped into [floor, 1],
 * so `cohortMassFloor = 1` makes every cohort full size whatever the week says
 * — one knob, which is what the live leg's A/B turns.
 *
 * ⚠️ NOTHING THE TOPOLOGY READS FOLDS WITH IT. `COHORT_HIT_RADIUS`,
 * `COHORT_LINK_STOP_R` and the keep-out are sized for the MAXIMUM and stay
 * constant, so a viewer aims at the same target whatever a cohort's week was.
 */
export const COHORT_MASS_FLOOR = 0.45;

/**
 * The floor the PROGRAM puts under the lane: the smallest mass a varying can
 * carry, whatever arrives in the attribute.
 *
 * ⚠️⚠️ A LANE THAT IS NOT WRITTEN READS AS ZERO IN WebGL, and a mass of zero is
 * a mark with no extent at all — every radius in both programs is a multiple of
 * it, and the motes divide by one of them (`life = (r0² − shadow²)/k` with
 * `r0 = 0` is a NaN, and `vBright <= 0.001` is FALSE for a NaN). So the guard
 * is THREEFOLD and this is the last of the three: the layer's array is filled
 * with 1, the motes' geometry allocates its copy at 1, and the vertex stage
 * floors `abs(aMass)` here. Nothing legitimate can reach it — the floor is
 * 0.45 and the off value is 1 — which is exactly what makes it a guard and not
 * a tuning.
 *
 * ⚠️ IT IS ALSO WHY THE PACK CLAMPS RATHER THAN THROWS. The SIGN of the lane is
 * the handedness and the magnitude is the mass, so a magnitude of exactly zero
 * would be a mass with no hand; and `cohortMassLaneValue` runs inside
 * `useFrame`, where a throw takes the whole r3f loop down.
 */
export const COHORT_MASS_GLSL_FLOOR = 0.05;

/**
 * How long a mass takes to reach a new target: the time constant, in seconds.
 *
 * ⭐ IT EXISTS FOR TWO EVENTS AND NOT FOR THE DATA. A week share drifts by well
 * under a tenth of a percent between two 120-second refreshes, which is
 * invisible with or without a slew. What is not invisible is the ledger
 * ARRIVING after the cohorts are already standing (a boot where the window
 * fills before the first fetch) or being CLEARED by an indexer outage — both of
 * which move every mass at once, and a simultaneous pop of every mark in the
 * colony is the one thing the dolly strip has been measured never to do. 95 %
 * of the way in 4.5 s.
 */
export const COHORT_MASS_SLEW_S = 1.5;

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
 *  faded. A starting value from the approved preview, unchanged by the live leg
 *  of 2026-09-03.
 *
 *  ⚠️ IT IS ALSO THE RAY MARCH'S ESCAPE RADIUS, and that coupling shipped broken
 *  once. A ray "has left" when it is heading away and further out than it
 *  started — which is only true while the disc is inside `1.2·r0`, so at any
 *  camera closer to a mark than `28 / 1.2` = 23.3 wu the old test cut rays bent
 *  over the top before they reached the disc's far side, in hard quantised black
 *  wedges. Retuning this constant moves that camera; the escape test reads
 *  `max(r0, discOut)` for exactly that reason. */
export const COHORT_DISC_OUT = 28;

/**
 * …and at the far end: the reach of the intake's atmosphere, in world units.
 *
 * ⭐⭐⭐ FAR AWAY THE MARK IS THE INTAKE AND NOT A HALO (2026-09-03). The user
 * judged the live frames of the 3 wu skirt: at the app camera a cohort still
 * read as "a small eye", and what was missing was "the atmosphere of energy
 * being drawn in". So the far form is the substance itself — the mist's own
 * medium, advected along the sink's spiral streamlines and read coarse enough
 * for a six-pixel-per-unit camera to see the arms — winding into a nucleus.
 *
 * ⭐⭐⭐ FOURTEEN, AND THE LAW IS WHAT MAKES FOURTEEN AFFORDABLE. The user's second
 * judgement (2026-09-03, on the 5 wu form): the vortex did not reach far
 * enough, AND its periphery was too bright and fell too slowly — a disc with
 * an edge, not an atmosphere. Those are one complaint about one curve. The
 * far law is now hyperbolic, `(h/(ρ+h))^p` with `COHORT_LENS_FAR_KNEE` h and
 * `COHORT_LENS_FAR_DISC_POW` p, under the mist's own catchment weight
 * `(1 − (ρ/out)²)²`: at h = 1 and p = 1 it is at half its peak by 1 wu, a third
 * at 2, a sixth at 4 and a twentieth at 8 — so the light is concentrated at
 * the mouth the way a sink's density is, and what reaches out to the edge is a
 * faint coherent streak field the eye can follow for its SHAPE without it ever
 * competing with the mesh for its LIGHT. Four variants were shot ON-minus-hidden
 * at the app camera on 2026-09-03 (p 1.5 / 2.0 over 10 wu, p 1.0 / 1.2 over
 * 14): the steep pair kept the whirlpool inside 4 wu, the 1/r tail over 14 wu
 * is the one that reads as a vortex the size the user asked for at a periphery
 * of 10–17/255. Measured on the 5 wu form
 * (ON-minus-hidden, 6.3 px/wu): the layer's own light was still 23/255 at 2.2
 * wu and 12/255 at 2.9, over a 3–4.5 wu lit radius; a sighted peer's own light
 * is gone by 1 wu. That is the size mismatch the user called jarring.
 *
 * ⚠️ THE MASS STILL FOLDS HARDER THAN THE DISC — 9.63× against 28/14 = 2× —
 * and it must: far away there is no shadow to see at all, so what is left has
 * to be a picture of intake and never a scale model of a black hole.
 *
 * ⚠️ FOURTEEN IS THE `m = 1` COHORT'S CATCHMENT. The far law is sampled out to
 * `COHORT_DISC_OUT_FAR * vMass`, so a cohort at `COHORT_MASS_FLOOR` reaches
 * 6.3 wu — still past its own `COHORT_LINK_STOP_R` 3.0, which is the
 * inequality `cohortKeepOut.test.ts` pins.
 */
export const COHORT_DISC_OUT_FAR = 14;

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
 * ⭐ MEASURED LIVE 2026-09-03, on seven mainnet cohorts approached at 26 wu from
 * TWO azimuths each, with real CDP mouse events. **14 / 14 hole clicks opened
 * their own `POW COHORT //` card on the first try**, every one of the fourteen
 * hovers named that cohort's own `attested:0x…` id, and **7 / 7 nearest
 * clickable neighbours opened their own card** and never the cohort's. The
 * minimum XZ clearance over the whole colony was **exactly 3.500** — the
 * keep-out, still binding on two cohorts and on the seventh the ledger added —
 * so this radius leaves **1.50 wu of daylight** at the tightest. T6's live
 * minimum of 1.274 wu, and its one cohort that needed a second azimuth, are
 * both gone.
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
 * folded: the intake alone, read off the plane by a straight ray — no trace,
 * no eye, no beaming — the substance winding into a bright heart.
 *
 * ⭐⭐ PIXELS PER WORLD UNIT AND NOT DISTANCE, because the same distance is a
 * different picture on a 1440p screen and a phone, and because a dolly and a
 * zoom must fold identically. `uPxScale / |camera − origin|` is that number
 * exactly: the layer writes `uPxScale = 0.5 · drawingBufferHeight ·
 * projectionMatrix[1][1]` once a frame, which is DPR-aware for free.
 *
 * ⭐⭐⭐ AND IT IS 20 BECAUSE THE MID RANGE IS WHERE THE MARK WAS TOO BIG. Judged
 * on the live frames 2026-09-03: the far view is right, but between 14 and 20
 * px/wu the cohort dwarfed everything around it. On the old 6 → 30 band, 14
 * px/wu was already 0.26 unfolded — a `mix(6, 28, 0.26)` = 11.7 wu disc, 23
 * units across, against a sighted peer's 2.0. Starting the band at 20 holds the
 * FAR form — a peer-sized heart with the intake's arms around it — through the
 * whole of that range: the closeness at 14 and at 20 px/wu is exactly 0.
 */
export const COHORT_UNFOLD_LO = 20;

/** …and above this many, it is fully unfolded: the film's hole. Between them
 *  the closeness runs 0 → 1 on a smoothstep, and EVERY quantity that folds
 *  reads that one number, so nothing can unfold on its own schedule.
 *
 *  ⭐⭐ 50 KEEPS THE BAND AS WIDE AS IT WAS WHILE ITS FAR EDGE MOVES
 *  (2026-09-03). The unfold ran 6 → 30 until the user judged the mid range too
 *  big; a band that still ended at 30 would have crammed the whole
 *  transformation into ten pixels. At 20 → 50 the rim camera at 40 px/wu is 0.74
 *  unfolded and the close camera at 90 is unchanged at 1.
 *
 *  ⭐ AND THERE WAS NO POP, MEASURED 2026-09-03 — ⚠️ AT THE OLD 6 → 30 BAND, so
 *  the strip is owed a re-measure at this one. A paused dolly on one isolated
 *  cohort from 6 to 62 px/wu in steps of 2 — 29 frames, each cropped to the same
 *  24 wu of world and resampled to 512², so the magnification is removed and
 *  only the FORM is compared — gave a mean-absolute per-step difference with a
 *  median of 23.2 and a maximum of 26.6: **1.15× the median**, and it fell at
 *  20 px/wu, inside the band as it then stood, where the form was legitimately
 *  changing fastest. A discontinuity would have shown as a spike of several
 *  times the median; what that establishes is that a smoothstep on this quantity
 *  does not pop, not that THESE two edges do not. */
export const COHORT_UNFOLD_HI = 50;

/**
 * The band, INSIDE the fold, over which the hole's dark arrives: the closeness
 * at which a captured ray first paints black, and the closeness at which it
 * paints full black.
 *
 * ⭐⭐⭐ THE DARK IS THE LAST THING TO ARRIVE. A bright ring around a darker
 * centre IS a small eye, and that is what the trace produces on its own at the
 * start of the band: the mass is tiny but it still captures every ray aimed
 * within 2.6 horizons of the centre, so the centre is the one place the disc is
 * never sampled and the ring of disc around it is brighter. Below the band the
 * form is not traced at all (`lensFarSample`); through the first third of it
 * the traced disc blends in over the far form with NO dark, so a cohort at 30
 * px/wu is a lit whirlpool with a ring forming in it; at 35 the hole is
 * translucent; at 40 it is the film's hole. Everything else the fold moves —
 * the mass, both disc edges, the beaming, the texture — reads the closeness
 * raw, which is what keeps the form ONE thing; the black alone waits until the
 * picture is already a black hole in everything but colour.
 */
export const COHORT_HOLE_GATE_LO = 0.35;
export const COHORT_HOLE_GATE_HI = 0.85;

/* -------------------------------------------------------------------------- *
 * The integrator.
 * -------------------------------------------------------------------------- */

/**
 * How many RK4 steps a ray may take.
 *
 * ⭐ THE PRECISION IS WHAT THE QUALITY CASCADE MOVES, NEVER THE PRESENCE. A
 * cohort at 40 steps is the same cohort with a coarser photon ring; a cohort
 * that is not drawn is a producer the scene is lying about.
 *
 * ⚠️ AND IT IS NOT A PERFORMANCE LEVER. Measured live 2026-09-03, 96 -> 40 steps
 * moves the lens draw by −4 % to −17 % — inside the ±17 % cross-run noise — at
 * every camera from the app overview to a hole filling the screen, because the
 * march has four early exits and the cap binds only for the thin annulus of rays
 * that linger near the photon sphere. What the three tiers should hold is
 * therefore an OPEN QUESTION; what would actually buy a tier something on this
 * layer is `COHORT_LENS_QUAD_R`, `COHORT_DISC_OUT` or a resolution scale.
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
 *
 * ⭐⭐ THIS, AND NOT `uSteps`, IS THE LAYER'S REAL COST LEVER — measured live
 * 2026-09-03. The draw goes 0.455 ms at the app camera to 1.890 at 40 px/wu and
 * 2.386 at 90, and 4.584 when a second mark stands 9.6 wu away and its quad
 * overlaps: the cost tracks the pixels covered, and the step count moves it by
 * single-digit percent. A tier that has to buy something here should shrink this
 * or `COHORT_DISC_OUT`.
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
 * out with the fold, because at the far end of the band an asymmetry is a
 * dither pattern.
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
 * ⭐⭐⭐ THE NUCLEUS, AND IT IS THE BRIGHTEST THING IN THE FAR FORM. Far away
 * nothing is traced and no dark is painted (`lensFarSample`); this round,
 * camera-facing bloom — a 0.7 wu Gaussian with a brighter core at 0.35 of that
 * radius, the shape of a sighted peer's sprite — is the OBJECT a viewer sees,
 * and the in-plane arms are its atmosphere. The user's judgement of the 5 wu
 * form (2026-09-03) is why the weight moved from the plane to the nucleus:
 * a flat, foreshortened, clipped-white ellipse in a mesh of round soft points
 * was "not in harmony with the peer mesh", and the reason was its SHAPE and
 * its SIZE, not its colour alone. A cohort is a peer that mines: its nucleus
 * is round like a peer's, at most a little brighter, and everything that is
 * not round about it is faint.
 *
 * ⭐⭐ MEASURED LIVE 2026-09-03, AND THE THIRD RULE HOLDS BY MEASUREMENT. At the
 * app camera the layer's own brightest pixel anywhere on the canvas (ON minus
 * the four amplitudes at zero, the only honest subtraction when every cohort's
 * disc has peers standing in it) is **77/255**: **0.40** of a ghost sprite's
 * core (median 193) and **0.34** of a measured peer's (median 224). It carries
 * ≥ 1 on 0.40 % of the canvas and removes at most 11/255 anywhere. For scale the
 * retired mist patch peaked at 236/255 and the retired haze at 2/255 — the
 * lensed far form sits between them and much nearer the haze. ⚠️ At 40 px/wu the
 * same measurement inverts completely (76 % of the canvas, up to 255/255), which
 * is the fold doing what it claims. ⚠️ THAT MEASUREMENT WAS TAKEN AT THE 6 wu
 * FAR DISC AND THE 1.0 wu HALO; both were cut on 2026-09-03 and the numbers can
 * only have come down, but they are owed a re-measure.
 *
 * ⭐ 0.75, RAISED FROM 0.5 WITH THE ARMS (D-13, 2026-09-05), and it is not a
 * second decision. D-13 names one dial — `cohortFarAmp` 0.3 → 0.45 — but the
 * far form's legibility is a RATIO: R40's ruling is that the nucleus, not a
 * blend, is what keeps a dark lane from printing a pupil, and
 * `colonyLens.test.ts` holds it as an inequality between the brightest arm
 * anywhere past half a world unit and the darkest centre. Raising the arms
 * alone breaks that inequality outright (0.90 against 0.75) — a bright filament
 * at half a unit out-shines the heart and the form reads as a ring again. So
 * the stop is spent on the WHOLE form: both terms × 1.5, every ratio in the
 * picture unchanged, and the guard passes for the reason it exists rather than
 * because it was moved.
 */
export const COHORT_LENS_FAR_GLOW = 0.75;

/**
 * The far halo's Gaussian radius, in world units: `exp(-(impact/r)²)`, with the
 * brighter core at `COHORT_LENS_FAR_GLOW_CORE_R` of it.
 *
 * ⭐ 0.7 PUTS THE VISIBLE CORE INSIDE THE SAME FOOTPRINT THE SKIRT WAS CUT TO
 * (2026-09-03, the user's yardstick — see `COHORT_DISC_OUT_FAR`). `exp(-t²)`
 * falls to a tenth of its peak at t = 1.52, so 0.7 wu of radius is 2.13 wu
 * across: a sighted peer's 2.0 wu sprite. At 1.0 it was 3.04 wu across and the
 * halo reached past the mark it belongs to.
 *
 * ⚠️ 2.13 wu IS THE `m = 1` COHORT'S NUCLEUS. The radius is scaled by the
 * instance's mass (`COHORT_LENS_FAR_GLOW_R * vMass`), so a cohort at
 * `COHORT_MASS_FLOOR` is 0.96 wu across — which is the inequality the floor
 * was chosen against: wider than a ghost peer, narrower than a dark sighted
 * one, a LESSER peer and never a vanished one.
 */
export const COHORT_LENS_FAR_GLOW_R = 0.7;
export const COHORT_LENS_FAR_GLOW_CORE = 0.5;
export const COHORT_LENS_FAR_GLOW_CORE_R = 0.35;

/**
 * The far form's own law: hyperbolic in the radius, `amp · (h/(ρ+h))^pow`,
 * under the catchment weight, which the arms then modulate.
 *
 * ⭐⭐ IT IS A DIFFERENT LAW AND NOT A DIMMED NEAR ONE. The near disc is bright
 * at its inner edge and dark in the gap inside it; at the far end of the band
 * that reads as a ring, and a ring around a darker centre is a small eye. This
 * law's brightest point is its middle, at every camera.
 *
 * ⭐⭐⭐ HYPERBOLIC AND NOT A SKIRT (2026-09-03, the user's second judgement).
 * A skirt `(1 − ρ/out)^n` has to choose between a peer-sized body (steep) and
 * a reach (shallow), and the round before tried to have both with TWO skirts
 * — which made a core on a platform with an edge at 5 wu, the periphery too
 * bright and falling too slowly, and the intake and the cohort reading as two
 * objects. `(h/(ρ+h))^p` is what a sink's density looks like: a spike at the
 * mouth and a long faint tail, ONE curve from the nucleus to the edge, so the
 * arms are bright exactly where they enter the heart and fade without a step.
 * At h = 1 and p = 1: 1 at the centre, 0.5 at 1 wu, 0.32 at 2, 0.17 at 4,
 * 0.05 at 8, and the catchment weight takes it to exactly 0 at `out`.
 * `cohortFarFall` is the exponent: turn it up and the periphery dies faster
 * (1.5 and 2 were shot on 2026-09-03 and kept the whirlpool inside 4 wu, which
 * the user had just called too small a range).
 *
 * ⭐ 0.45, RAISED FROM 0.3 (D-13, 2026-09-05). Lane C's own question — "is a
 * peer that mines the right overview reading for the seven entities that make
 * every block?" — was answered by measurement rather than taste: the far form's
 * brightest pixel at the app camera is 77/255, 0.34 of a measured peer's, and
 * R40's own note already said "possibly TOO quiet". One stop of light on the
 * atmosphere; the nucleus gets its own answer on a block
 * (`COHORT_GULP_NUCLEUS`). Still a dial, and still secondary to the mesh and
 * the canopy, which is the ruling this may not overturn.
 */
export const COHORT_LENS_FAR_DISC_AMP = 0.45;
export const COHORT_LENS_FAR_DISC_POW = 1;

/** The knee of the far law, in world units: the radius at which it has fallen
 *  to `0.5^pow` of its peak. A peer's own core is about this size. */
export const COHORT_LENS_FAR_KNEE = 1.0;

/**
 * The arms' contrast, far away: the medium modulates the law by
 * `mix(1 − s, 1 + s, g)`, where `g` is the advected medium in [0, 1].
 *
 * ⭐⭐⭐ THIS IS WHAT MAKES THE FAR FORM AN INTAKE RATHER THAN A LAMP. The
 * mist's medium is CARRIED along the sink's spiral streamlines by the same
 * back-trace the near disc uses, so its blobs are sheared into arcs that wind
 * into the heart; at 1 a filament is twice the law and a lane between
 * filaments is nothing, which a six-pixel-per-unit camera resolves as arms
 * (judged on ON-minus-hidden crops, 2026-09-03: at 0.8 the arms were speckles
 * inside a smudge, at 1 to 1.2 a wound spiral). The traced far form used to
 * calm this to `0.7 + 0.3·g` — a 9 % ripple — and the user saw a lamp with an
 * eye in it. ⚠️ 1 IS THE CEILING: above it a lane goes NEGATIVE and the arms
 * start removing light. 0 is the old halo exactly, and it is one knob-turn
 * away (`cohortFarStreak`) for the day the arms are judged too loud.
 *
 * ⭐ THE ARMS RUN ALL THE WAY IN. The round before blended them to neutral
 * inside 1.75 wu so no dark lane could print a pupil on the heart, and the
 * user read the result as an intake that was not fused with its cohort. The
 * pupil is now kept off by the NUCLEUS instead (`COHORT_LENS_FAR_GLOW`): it is
 * round, it does not read the medium, and at the centre it out-weighs the
 * brightest lane anywhere past half a world unit — `colonyLens.test.ts` pins
 * that inequality — while the medium's lanes are 2.5 wu wide, so a lane cannot
 * be dark at the centre and bright half a unit away.
 */
export const COHORT_LENS_FAR_STREAK = 1;

/**
 * The fraction of the medium's grain the far form reads it at.
 *
 * ⭐ COARSER, BECAUSE THE CAMERA IS. `MIST_GRAIN` puts the coarsest cell at
 * 1.47 wu, which is one filament at arm's length and nine pixels at the app
 * camera — noise. Scaling the sample coordinates by 0.6 makes that cell 2.5 wu,
 * fifteen pixels there: a blob the eye can follow as the sink shears it into
 * an arc (0.45 gave broader blobs and fewer arms; judged 2026-09-03). The near
 * disc reads the medium at its own grain, and the band cross-fades the two.
 */
export const COHORT_LENS_FAR_GRAIN = 0.6;

/**
 * Extra turns per e-fold of radius, far away, on top of `MIST_SWIRL`.
 *
 * ⭐ THE WHIRLPOOL HAS TO BE LEGIBLE AT SIX PIXELS A UNIT. The shipped 1.4 turns
 * per e-fold winds a parcel 1.5 rad on its way from 9 wu to 3 — a curved
 * streak up close, a smear far away. Another 2.4 on top makes the arms wind
 * tightly enough to read as a vortex in a 50 px mark (0.8 and 1.6 left them
 * as sheared blobs; judged 2026-09-03). It is applied to the
 * back-trace's RESULT as a further rotation by `swirl · ln(r0 / r)` — the same
 * log-spiral law, on the same origin — so the library's text is untouched and
 * the near disc is untouched.
 */
export const COHORT_LENS_FAR_SWIRL = 2.4;

/**
 * How far the far form's colour sits from the mesh's own cyan toward the
 * disc's mid stop: 0 is `scaffold` exactly, 1 is the disc's cyan.
 *
 * ⭐⭐⭐ THE FAR FORM WEARS THE MESH'S HUE, AND THIS IS WHY. The round before
 * coloured the far arms with the near disc's ramp, whose outer stop is a deep
 * blue meant to be seen against black; over the rose canopy it composited to
 * VIOLET, a hue that belongs to neither the mesh (cyan) nor the canopy (rose),
 * and the user called the result jarring. Measured on that form, the
 * periphery's own light was (0.6, 6, 15) in RGB — blue at two and a half
 * times its green — where the scaffold is (26, 209, 255), green at four fifths
 * of blue. At the far camera the cohort is a peer that mines, and it takes the
 * mesh's light; the ramp to white happens only inside the nucleus.
 */
export const COHORT_LENS_FAR_TINT = 0.35;

/* -------------------------------------------------------------------------- *
 * The substance, where this draw's numbers differ from the retired patch's.
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
    // ⚠️ THE MIRROR'S ESCAPE RADIUS IS THE NO-DISC ONE, and that is deliberate:
    // this function traces a bare ray to measure a bend, so `r0 * 1.2` is where
    // it has left everything there is. The fragment carries `max(r0, discOut)`
    // instead, because there a ray beyond `1.2 * r0` has NOT left while the disc
    // still reaches past it — see the wedges G5 photographed. Do not "unify"
    // these two by taking the mirror's spelling into the program.
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

/* -------------------------------------------------------------------------- *
 * The mass a cohort carries: the week, packed into one lane.
 * -------------------------------------------------------------------------- */

/**
 * A cohort's mass factor from its share of the indexer's seven-day window:
 * `clamp(cbrt(share / anchor), floor, 1)`.
 *
 * ⭐⭐ THE CUBE ROOT IS WHAT MAKES SEVEN COHORTS LEGIBLE AS SEVEN. The live week
 * (2026-09-02) is one giant, three middling, two small and a trace — 62.5 /
 * 12.8 / 11.0 / 9.8 / 2.2 / 1.7 / ~0 %. Linear would spread them over 30×,
 * which puts the tail under a pixel; a logarithm collapses the top (1.0 / 0.84
 * / 0.82 / 0.81 / 0.66 / 0.63) and says nothing at all. The cube root separates
 * the giant from the rest by 1.75× and keeps the whole range near the 3× step
 * the peer-tier work found legible, floor included.
 *
 * ⭐ IT IS ALSO THE HONEST EXPONENT FOR A SIZE. A mass in three dimensions
 * scales as the cube of a length, so a cohort three times the miner is one
 * length-unit-and-a-half wide rather than three; the eye compares extents, and
 * this is the transform that makes an extent readable as an amount.
 */
export function cohortMassFactor(
  weekShare: number,
  anchor: number = COHORT_MASS_ANCHOR_SHARE,
  floor: number = COHORT_MASS_FLOOR,
): number {
  // ⚠️ The divisor is a live knob, so it is floored rather than trusted: an
  // anchor of zero would make every share an infinity and every mass a 1.
  return clamp(Math.cbrt(weekShare / Math.max(anchor, 1e-6)), floor, 1);
}

/**
 * One frame of the mass's approach to its target: `target + (current − target)
 * · exp(−dt / tau)`.
 *
 * ⭐ FRAME-RATE INDEPENDENT BY CONSTRUCTION, which a `mix(current, target, k)`
 * with a fixed `k` is not: two frames of `dt` and one of `2·dt` land on the
 * same number here, so a page that drops to 30 fps eases at the same speed it
 * did at 60. `COHORT_MASS_SLEW_S` says what the slew is for.
 *
 * ⚠️ EXACT AT `dt = 0`, AND THAT IS AN EARLY RETURN RATHER THAN A COINCIDENCE.
 * `target + (current − target)` is not bit-identical to `current` in floating
 * point, and this runs on every raw frame of a PAUSED page: a slot that drifts
 * by an ulp per frame is an upload per frame for the life of the tab.
 */
export function cohortMassApproach(
  current: number,
  target: number,
  dt: number,
  tau: number = COHORT_MASS_SLEW_S,
): number {
  if (dt <= 0) return current;
  return target + (current - target) * Math.exp(-dt / Math.max(tau, 1e-6));
}

/**
 * Which way a cohort's spiral winds, from its own seed: +1 or −1.
 *
 * ⭐ IDENTITY, NOT DATA, and that is the whole of what it may be. The seed is
 * `fnv1a(producer key) / 2^32`, so the hand is a fact about WHO this cohort is
 * — stable across churn, carrying no claim about the chain — and it is what
 * separates the middling cohorts that the week makes the same size. It is the
 * follow-up `MIST_SWIRL`'s own comment names: six same-handed spirals may read
 * as stamped.
 *
 * ⭐ SPENT IN FOUR PLACES AND NOWHERE ELSE. In the lens: `vHand` mirrors the
 * whole local frame in y — `local.y` in BOTH laws, the traced one and the
 * straight one — and with it `vDrift.y`, so the wake maps back onto itself and
 * stays where the colony's rotation puts it; and it turns the beaming's
 * product over, because the material's orbital direction IS the spiral's. In
 * the motes: `theta0 - hand * turn`. ⚠️ THE MIST LIBRARY'S TEXT IS UNTOUCHED —
 * the mirror lives in the ARGUMENTS the two programs hand it, so one substance
 * is still read one way.
 *
 * ⚠️ NEVER ZERO. It is packed as the SIGN of the mass lane, so a zero would be
 * a mass with no magnitude — see `cohortMassLaneValue`.
 */
export function cohortHandedness(seed: number): number {
  return seed < 0.5 ? 1 : -1;
}

/**
 * The mass and the hand as ONE float: the magnitude is the mass, the sign is
 * the hand.
 *
 * ⭐ ONE LANE FOR TWO FACTS, AND IT COSTS NO ATTRIBUTE SLOT. The lens's vertex
 * program is the busiest in the colony; a second lane for a bit would be a
 * whole float of bandwidth on both draws (the motes' copy is 96 vertices wide)
 * for one bit that never changes over a cohort's life.
 *
 * ⚠️ IT CLAMPS AND IT NEVER THROWS. This runs inside `useFrame`, where a throw
 * takes the whole r3f loop down with it, and no input may make it emit a zero:
 * zero is the value an UNWRITTEN lane already has, it has no sign to be a hand,
 * and in the motes it is a division. The magnitude is floored at
 * `COHORT_MASS_GLSL_FLOOR` with a comparison rather than a `Math.max` so a NaN
 * takes the floor instead of propagating, and the hand is read as "negative or
 * not" — the mirror of the program's own `aMass < 0.0`, which is FALSE for a
 * negative zero in GLSL exactly as it is here.
 */
export function cohortMassLaneValue(mass: number, hand: number = 1): number {
  const magnitude = mass > COHORT_MASS_GLSL_FLOOR ? mass : COHORT_MASS_GLSL_FLOOR;
  return hand < 0 ? -magnitude : magnitude;
}

/** The two facts back out of one lane value: the mirror of the vertex stage's
 *  own two lines, and the only place the unpacking is written in TypeScript. */
export function cohortMassUnpack(value: number): {
  readonly mass: number;
  readonly hand: number;
} {
  const magnitude = Math.abs(value);
  return {
    mass: magnitude > COHORT_MASS_GLSL_FLOOR ? magnitude : COHORT_MASS_GLSL_FLOOR,
    hand: value < 0 ? -1 : 1,
  };
}

/**
 * The fold, from pixels per world unit at the cohort and the cohort's own mass.
 *
 * ⭐⭐⭐ PIXELS PER SHADOW, NOT PIXELS PER WORLD UNIT. The mass multiplies the
 * camera's scale before the smoothstep reads it, so every cohort's hole opens
 * at the SAME ON-SCREEN SIZE whatever its week was — which is the only way a
 * 0.45 cohort at the mid range is not "a small eye", the form the user refused
 * twice. The cost is that at one camera the giant may be unfolding while the
 * tail is still wearing the far form; that is a coherent picture and it is the
 * point.
 */
export function lensCloseness(pxPerWu: number, mass: number = 1): number {
  return smoothstep(COHORT_UNFOLD_LO, COHORT_UNFOLD_HI, pxPerWu * mass);
}

/**
 * How much of the hole's dark has arrived, at a given closeness.
 *
 * ⭐ IT IS THE ALPHA A CAPTURED RAY PAINTS, and it is exactly 0 over the whole
 * first third of the band. `lensCloseness` says how unfolded the FORM is; this
 * says how much of it is black, and the two are deliberately not one number —
 * see `COHORT_HOLE_GATE_LO` for the judgement that separated them.
 */
export function lensHoleGate(closeness: number): number {
  return smoothstep(COHORT_HOLE_GATE_LO, COHORT_HOLE_GATE_HI, closeness);
}

/** Everything the fold moves, at one camera. */
export interface LensFold {
  readonly closeness: number;
  readonly horizon: number;
  readonly discIn: number;
  readonly discOut: number;
  /**
   * The alpha a captured ray paints: the shadow's opacity.
   *
   * ⚠️ IT IS NOT THE CLOSENESS, since 2026-09-03. It is `lensHoleGate` of it,
   * which is 0 over the whole first third of the band.
   */
  readonly shadowAlpha: number;
  /** The far form's own outer radius, in world units: the catchment the intake
   *  is read over below the band. */
  readonly farOut: number;
  /** The knee of the far law, in world units: where it has fallen to half its
   *  peak. ⭐ IT FOLDS WITH THE MASS AND NOT WITH THE CAMERA — a small cohort's
   *  spike is narrower in world units in exactly the proportion its catchment
   *  is, so the SHAPE of the atmosphere is one picture at every mass and only
   *  its size differs. */
  readonly farKnee: number;
  /** The nucleus's Gaussian radius, in world units. `exp(-t²)` reaches a tenth
   *  at t = 1.52, so the visible footprint is `2 · 1.52 ·` this. */
  readonly nucleusR: number;
}

/**
 * ⭐⭐⭐ ONE NUMBER DRIVES ALL OF IT. The mass, the disc's inner edge (which is a
 * multiple of the mass) and the disc's outer edge all read the same closeness,
 * so no part of the FORM can unfold on its own schedule and there is no camera
 * at which the mark is half of one thing.
 *
 * ⚠️ THE ONE EXCEPTION IS THE DARK, and it is the exception on purpose: the
 * shadow's opacity reads `lensHoleGate` of the closeness rather than the
 * closeness itself, so it arrives over the LAST part of the band. What folds is
 * the form; what waits is the black.
 *
 * ⭐⭐ AND THE MASS MULTIPLIES ALL OF IT, THE CAMERA'S OWN SCALE INCLUDED. `mass`
 * is the cohort's share of the week (`cohortMassFactor`), 1 by default and 1
 * for every cohort until a ledger says otherwise — so this function at `m = 1`
 * is the fold it has always been, value for value. The alpha is the one
 * quantity it does not touch directly: the dark's schedule is the closeness's,
 * and the closeness already reads the mass.
 */
export function lensFold(pxPerWu: number, mass: number = 1): LensFold {
  const closeness = lensCloseness(pxPerWu, mass);
  const horizon = mix(COHORT_HORIZON_FAR, COHORT_HORIZON, closeness) * mass;
  return {
    closeness,
    horizon,
    // ⭐ THE INNER EDGE COMES FOR FREE. It is written as a fraction of the
    // horizon and the horizon already carries the mass, so it is three horizons
    // at every camera AND at every mass without naming either.
    discIn: COHORT_DISC_IN * (horizon / COHORT_HORIZON),
    discOut: mix(COHORT_DISC_OUT_FAR, COHORT_DISC_OUT, closeness) * mass,
    shadowAlpha: lensHoleGate(closeness),
    farOut: COHORT_DISC_OUT_FAR * mass,
    farKnee: COHORT_LENS_FAR_KNEE * mass,
    nucleusR: COHORT_LENS_FAR_GLOW_R * mass,
  };
}

/**
 * The camera-facing quad's half-extent, in units of the cohort's own mass, at a
 * given closeness — the vertex stage's fold mirrored, so the quad shrink (A1-2)
 * can be pinned without a renderer. It is the GLSL `mix(1.25 · uDiscOutFar,
 * uQuadR, closeness)` statement for statement.
 *
 * ⭐⭐ IT SHRINKS TO THE MARK BELOW THE BAND. At closeness 0 the lit footprint
 * is the far disc out to `COHORT_DISC_OUT_FAR`, so the quad is 1.25× that — the
 * 1.25 covering the perspective enlargement of the disc's near edge. It grows to
 * `COHORT_LENS_QUAD_R` at closeness 1, where it is EXACTLY the shipped quad, so
 * nothing drawn moves and only discarded fragments are removed. The margin over
 * the footprint — `cohortLensQuadR(c)` against `lensFold(...).discOut` — never
 * falls below 1 (its minimum is the shipped 32/28 at closeness 1), which is the
 * proof the fold cuts off nothing the trace could light.
 */
export function cohortLensQuadR(closeness: number): number {
  return mix(1.25 * COHORT_DISC_OUT_FAR, COHORT_LENS_QUAD_R, closeness);
}

/** The mist's own catchment weight on the far radius fraction: `(1 − q²)²`. */
export function lensFarCatchment(rho: number, out: number): number {
  const q = Math.min(1, Math.max(0, rho / out));
  const b = 1 - q * q;
  return b * b;
}

/** The far form's law, without the arms: `amp · (h/(ρ+h))^pow · catchment`.
 *  ⭐ The knee folds with the mass and the catchment is handed in already
 *  folded, so a small cohort is the same curve at a smaller scale rather than
 *  the same spike inside a smaller skirt. */
export function lensFarLaw(rho: number, out: number, mass: number = 1): number {
  const knee = COHORT_LENS_FAR_KNEE * mass;
  return (
    COHORT_LENS_FAR_DISC_AMP
    * (knee / (Math.max(rho, 0) + knee)) ** COHORT_LENS_FAR_DISC_POW
    * lensFarCatchment(rho, out)
  );
}

/** The arms' factor on the law for a medium value `g` in [0, 1]. */
export function lensFarArms(g: number): number {
  return mix(1 - COHORT_LENS_FAR_STREAK, 1 + COHORT_LENS_FAR_STREAK, g);
}

/**
 * The far form's in-plane body: the law, modulated by the medium everywhere.
 * The mirror of `lensFarSample`'s brightness before the block's own gulp and
 * the colour.
 */
export function lensFarBody(rho: number, out: number, g: number): number {
  return lensFarLaw(rho, out) * lensFarArms(g);
}

/**
 * The nucleus: the round, camera-facing bloom over the far form, as a function
 * of the impact parameter. `glow · (1 + nucleusGulp · gulp) · (exp(−t²) + core
 * · exp(−(t/coreR)²))`.
 *
 * `gulp` is the block this cohort won, on the feature's one envelope
 * (`cohortMoteGulp`); 0 — a cohort that has not just mined — is the resting
 * form and the default, so every existing reading of this function is the
 * reading it always was.
 */
export function lensFarNucleus(
  impact: number,
  mass: number = 1,
  gulp: number = 0,
): number {
  const t = impact / Math.max(COHORT_LENS_FAR_GLOW_R * mass, 1e-4);
  const tc = t / COHORT_LENS_FAR_GLOW_CORE_R;
  return COHORT_LENS_FAR_GLOW
    * (1 + COHORT_GULP_NUCLEUS * gulp)
    * (Math.exp(-t * t) + COHORT_LENS_FAR_GLOW_CORE * Math.exp(-tc * tc));
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
 *
 * ⭐ AND THE HAND FLIPS THE BRIGHT SIDE WITH THE SPIRAL, because the material's
 * orbital direction IS the spiral's and "the approaching side" is a fact about
 * that direction: `lensBeaming(c, k, −1) === lensBeaming(−c, k, 1)`. The
 * program's own line is this product exactly — `uBeam * closeness * vHand *
 * dot(tangent, -view)` — and this function is its mirror.
 */
export function lensBeaming(
  cosToTangent: number,
  closeness: number,
  hand: number = 1,
): number {
  return 1 + COHORT_LENS_BEAM * closeness * hand * cosToTangent;
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
 * The vertex convention is the retired aura's, exactly: `instanceMatrix`
 * carries a TRANSLATION and nothing else, the quad's half-extent rides
 * `uQuadR`, and the four lanes are the ones the layer already plans — `aSeed`
 * (decorrelation), `aGulp` (the sim second of the block this cohort won),
 * `aShare` (its fraction of its window, which is the sink's strength here
 * exactly as it was under the retired patch) and `aMass`.
 *
 * ⭐⭐⭐ `aMass` IS THE ONLY THING THAT MAKES TWO COHORTS DIFFERENT PICTURES.
 * Every form parameter here is a global uniform, so the lane is what turns
 * seven copies into seven sizes: `vMass` multiplies EVERY length the fragment
 * names — the camera's own scale before the fold reads it, the mass, both disc
 * edges, the far catchment, the far law's knee and the nucleus — and everything
 * else is already written in units of `rs` or of an edge. A cohort whose lane
 * reads 1 is the form this file has always drawn, exactly.
 *
 * ⚠️ THE MAGNITUDE IS THE MASS AND THE SIGN IS THE HAND. The vertex stage
 * reads `max(abs(aMass), 0.05)` for the one and `aMass < 0.0` for the other;
 * `vHand` then mirrors the whole local frame in y — both laws' `local`, the
 * drift, the beaming — so each cohort winds its own way out of its own key
 * while every one of them is still one size and one substance.
 * `cohortMassLaneValue` on the CPU packs both.
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
    forceSinglePass: true,
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
      // ⚠️ 1 rather than 0, for the reason the retired patch's did: an unwritten
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
      uFarStreak: { value: COHORT_LENS_FAR_STREAK },
      uFarKnee: { value: COHORT_LENS_FAR_KNEE },
      uFarGrain: { value: COHORT_LENS_FAR_GRAIN },
      uFarSwirl: { value: COHORT_LENS_FAR_SWIRL },
      uFarTint: { value: COHORT_LENS_FAR_TINT },
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
      attribute float aMass;

      uniform float uQuadR;
      uniform float uDriftSign;
      uniform float uShareFloor;
      uniform float uShareMax;
      // Read in the vertex stage too, so the quad's own extent can fold on the
      // SAME closeness the fragment reads (A1-2). Shared uniforms — the values
      // are the ones the fragment already binds, not a second copy.
      uniform float uPxScale;
      uniform float uUnfoldLo;
      uniform float uUnfoldHi;
      uniform float uDiscOutFar;

      varying vec3 vWorld;
      varying vec3 vOrigin;
      varying vec2 vSeat;
      varying vec2 vDrift;
      varying vec2 vFrameX;
      varying vec2 vFrameZ;
      varying float vSeed;
      varying float vGulp;
      varying float vShareF;
      varying float vMass;
      varying float vHand;

      void main() {
        vSeed = aSeed;
        vGulp = aGulp;
        // The cohort's own size, and every length in the fragment is a multiple
        // of it. Floored because an unwritten lane reads as zero in WebGL, and
        // absolute because the sign is the hand, read on the next line.
        vMass = max(abs(aMass), ${COHORT_MASS_GLSL_FLOOR.toFixed(2)});
        // Which way this cohort's spiral winds, out of its own key: one bit,
        // carried in the sign, costing no attribute slot on either draw.
        vHand = aMass < 0.0 ? -1.0 : 1.0;
        ${MIST_SHARE_FACTOR_GLSL}
        // The instance's own world point: the centre of the mass, the origin of
        // every ray's polar frame, and what the context exemption measures.
        vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vOrigin = origin.xyz;
        ${MIST_SEAT_DRIFT_GLSL}
        // ⭐⭐ ONE REFLECTION OF THE WHOLE LOCAL FRAME, DRIFT INCLUDED. The
        // fragment reads the substance in a y-mirrored frame, and the drift
        // maps back onto itself under the same reflection: the spiral's
        // chirality turns over while the wake stays on the side the colony's
        // own rotation puts it.
        vDrift = vec2(vDrift.x, vDrift.y * vHand);
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
        // THE QUAD SHRINKS TO THE MARK BELOW THE BAND (A1-2, 2026-09-06). At
        // closeness 0 the only light is the far disc, out to uDiscOutFar, and
        // the nucleus inside it, so a quad sized for the traced hole (uQuadR 32
        // against a 14-wu disc) rasterises ~3.3x the fragments it could ever
        // light, all discarded. Fold the half-extent on the SAME closeness the
        // fragment reads, recomputed here from the same r0 (camera to origin) so
        // the two stages cannot disagree, down to 1.25x the far disc. The 1.25
        // covers the perspective enlargement of the disc's near edge at the
        // closest camera still at closeness 0; at closeness 1 the extent is
        // uQuadR unchanged. The drawn pixels are identical -- only discarded
        // ones are gone.
        float r0v = max(length(cameraPosition - origin.xyz), 1e-4);
        float closenessV = smoothstep(uUnfoldLo, uUnfoldHi, uPxScale * vMass / r0v);
        float quadR = mix(1.25 * uDiscOutFar, uQuadR, closenessV);
        vWorld = origin.xyz
          + (cameraRight * position.x + cameraUp * position.y)
            * quadR * vMass * 2.0;
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
      uniform float uFarStreak;
      uniform float uFarKnee;
      uniform float uFarGrain;
      uniform float uFarSwirl;
      uniform float uFarTint;
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
      varying float vMass;
      varying float vHand;

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
      // spiral back-trace and the sink's strength are the substance's own, out
      // of the mist library, so two cohorts' discs are one substance taken at
      // two rates and not two textures that happen to look alike.
      vec4 lensDisc(
        vec3 hit, vec3 view, float closeness, float edge, float outR, float rs
      ) {
        vec2 dxz = hit.xz - vOrigin.xz;
        float rho = max(length(dxz), 1e-4);
        // ⭐ IN THE COLONY'S FRAME, NOT THE WORLD'S — see the vertex stage —
        // and mirrored in y by the hand, which is the whole of what turns this
        // cohort's spiral over.
        vec2 local = vec2(dot(dxz, vFrameX), dot(dxz, vFrameZ) * vHand);
        float th = atan(local.y, local.x);
        // How far in the material has come, as a fraction: 1 at the inner edge.
        float cc = clamp(edge / rho, 0.0, 1.0);

        // The same clock, the same two phases and the same seed the retired
        // patch used, so no two cohorts breathe together and this one breathes
        // with its own mist.
        float ph = uTime / uPeriod + vSeed;
        float t0 = fract(ph) * uPeriod;
        float t1 = fract(ph + 0.5) * uPeriod;
        float phaseMix = 1.0 - abs(2.0 * fract(ph) - 1.0);
        // ⭐ The seat is what decorrelates the discs: the back-trace runs in
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
        // this cohort's own rate — the argument the retired patch's lip made.
        float pile = uConc * vShareF * cc * cc * cc
          + ${COHORT_GULP_INTERIOR.toFixed(1)} * gulp
            * clamp(edge * uGulpR / rho, 0.0, 1.0);

        // The fibres keep the inner disc; outside two inner radii the spiral
        // streak field takes over, so the outer disc reads as the vortex
        // drawing material in rather than as a ring of light.
        float inner = smoothstep(0.35, 0.7, cc);
        // SKIP THE DEAD FIBRE FETCH (A1-3, 2026-09-06). mistFibres is three of
        // the seven texture fetches this crossing spends, and inner is exactly 0
        // for rho past 6.6 wu -- ~94% of the disc -- where the fetch only fed a
        // mix to a zero weight that returns 1.0. Guard it so the fetch runs only
        // where its weight is positive; mix(a, b, 0.0) is a, so the output is
        // byte-for-byte the same and the branch is coherent along one ring.
        float fibW = uFibreMix * inner * closeness;
        float fib = 1.0;
        if (fibW > 0.0) {
          fib = mix(1.0, mistFibres(rho / edge, th, g, uTime), fibW);
        }
        float streak = uFil * g
          * (uContrastFar + uContrastNear * mix(1.0, 0.45, inner))
          * (1.0 + pile);
        float nearLaw = (
          streak + uDiscAmp * pow(cc, uDiscFall) * fib * (0.7 + 0.3 * g)
        ) * (1.0 - smoothstep(0.4, 1.0, rho / outR));
        // At the far end of the band the bent ray finds the same skirt the
        // straight one reads below it (lensFarSample), so the cross-fade between
        // the two has no seam to cross.
        float fq = clamp(rho / outR, 0.0, 1.0);
        float fCatch = 1.0 - fq * fq;
        fCatch *= fCatch;
        float knee = uFarKnee * vMass;
        float farLaw = uFarDiscAmp
          * pow(clamp(knee / (rho + knee), 0.0, 1.0), uFarDiscPow)
          * fCatch * (0.7 + 0.3 * g);
        // AND THE TRACED IMAGE ARRIVES WITH THE CLOSENESS. Below the band the
        // far form is drawn alone; through it the traced disc fades in over
        // that form, so the ring the trace makes around a small mass never
        // stands on its own -- a ring around a darker centre is a small eye.
        float v = closeness * mix(farLaw, nearLaw, closeness);
        // A sharp inner edge, written as a fraction of it so the guard can read
        // both edges without resolving a local.
        v *= smoothstep(1.0, 1.06, rho / edge);
        // Beaming toward the camera on the approaching side. The tangent is a
        // WORLD direction: this is a fact about the camera, not about the
        // substance, and it is the one thing here the colony's frame is wrong
        // for. The HAND still belongs in it: the material's orbital direction
        // is the spiral's, so which side approaches turns over with the wind.
        vec3 tangent = vec3(-dxz.y, 0.0, dxz.x) / rho;
        v *= 1.0 + uBeam * closeness * vHand * dot(tangent, -view);
        // …and the redshift's dimming, which is what puts the dark ring inside
        // the bright one.
        v *= sqrt(max(1.0 - rs / rho, 0.0));

        vec3 col = mistDiscColor(cc);
        // The outer disc is thinner, so the mesh shows through the vortex; the
        // far form is thinner still, because that far out an opaque disc is a
        // blob and the mark must stay secondary.
        float a = clamp(
          v * uDiscAlpha * mix(0.4, 1.0, inner) * mix(0.3, 1.0, closeness),
          0.0, 0.85
        );
        return vec4(col * v, a);
      }

      // ---- the far form: the intake, read off the plane by a STRAIGHT ray --
      //
      // The medium at a point of the plane, tau seconds back along the sink's
      // own streamline, read COARSE and wound TIGHTER than the near disc reads
      // it: the far camera has six pixels to a world unit, and what it has to
      // see is arms winding into a heart.
      float lensFarMedium(vec2 local, float tau) {
        // The parcel's radius now, and the radius it came from: the back-trace
        // returns the origin, and the origin's length IS that radius.
        vec2 dq = local - vDrift * (uDrift * tau);
        float r = max(length(dq), 0.002);
        vec2 p = mistBacktrace(local, tau);
        float rr = max(length(p), r);
        // Extra winding, far only, by the same log-spiral law on the same
        // origin: swirl times the e-folds of radius the parcel has fallen.
        float ang = uFarSwirl * log(rr / r);
        float cs = cos(ang);
        float sn = sin(ang);
        vec2 wound = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y);
        return mistMedium(wound * uFarGrain + vSeat, 0.5);
      }

      // FAR AWAY A TRACED IMAGE IS A SMALL EYE, and the user refused one twice.
      // Even the 0.08 wu mass captures every ray aimed within 2.6 horizons of
      // the centre, so the centre is the one place the disc is never sampled and
      // the ring around it is brighter. So out here the ray is not bent: it
      // goes straight to the plane and reads the intake there -- the skirt
      // peaking AT THE CENTRE, the arms of advected medium winding into it, the
      // block's own gulp on top -- with no inner edge, no shadow, no beaming and
      // no redshift. What is drawn is the substance being taken, which is the
      // point of the whole layer, at the one camera most viewers ever use.
      vec4 lensFarSample(vec3 o, vec3 d, vec3 c, float outR) {
        if (abs(d.y) < 1e-5) return vec4(0.0);
        float t = (c.y - o.y) / d.y;
        if (t <= 0.0) return vec4(0.0);
        vec3 hit = o + d * t;
        vec2 dxz = hit.xz - c.xz;
        float rho = length(dxz);
        // EVERYTHING OUTSIDE THE FAR RADIUS LEAVES HERE, so a 64 wu quad only
        // does work over the mark's own footprint, which is why the far end of
        // the fold is the cheapest camera this layer has.
        if (rho >= outR) return vec4(0.0);
        // In the colony's frame and at the seat, as the traced disc samples it:
        // the colony turns, and a world sample would swim past its own mouth.
        // Mirrored by the same hand, so the far arms wind the way the near
        // disc's do and the fold has no chirality to cross.
        vec2 local = vec2(dot(dxz, vFrameX), dot(dxz, vFrameZ) * vHand);
        float ph = uTime / uPeriod + vSeed;
        float t0 = fract(ph) * uPeriod;
        float t1 = fract(ph + 0.5) * uPeriod;
        float phaseMix = 1.0 - abs(2.0 * fract(ph) - 1.0);
        float g = mix(lensFarMedium(local, t1), lensFarMedium(local, t0), phaseMix);
        // ONE curve from the nucleus to the edge: a sink's own density, a spike
        // at the mouth and a long faint tail, under the mist's catchment weight
        // so it is exactly nothing at the far radius. The arms modulate it
        // everywhere -- the nucleus, not a blend, is what keeps a dark lane
        // from printing a pupil on the centre.
        float q = rho / outR;
        float catchW = 1.0 - q * q;
        catchW *= catchW;
        float knee = uFarKnee * vMass;
        float shape = pow(clamp(knee / (rho + knee), 0.0, 1.0), uFarDiscPow);
        float arms = mix(1.0 - uFarStreak, 1.0 + uFarStreak, g);
        // The block this cohort won, on the SAME curve the near disc swallows.
        ${COHORT_GULP_GLSL}
        float v = uFarDiscAmp * shape * catchW * arms
          * (1.0 + ${COHORT_GULP_INTERIOR.toFixed(1)} * gulp);
        // The mesh's own cyan, because out here a cohort is a peer that mines
        // and takes the mesh's light; white only where the law is near its
        // peak, inside the nucleus. Never the near disc's blue outer stop: over
        // the rose canopy it composited to violet.
        vec3 farCol = mix(uRimColor, uColMid, uFarTint);
        vec3 col = mix(farCol, uColCore, shape);
        // Thin, so the mesh shows through the atmosphere: that far out an opaque
        // disc is a blob and the mark must stay secondary.
        return vec4(col * v, clamp(v * uDiscAlpha * 0.3, 0.0, 0.5));
      }

      void main() {
        vec3 c = vOrigin;
        vec3 o = cameraPosition;
        vec3 d = normalize(vWorld - o);
        vec3 oc = o - c;
        float r0 = max(length(oc), 1e-4);

        // HOW CLOSE THE CAMERA IS, AND THE WHOLE FORM FOLDS WITH IT. Far, the
        // mass folds and with it every radius, and the picture is the intake
        // itself -- the substance winding into a bright heart, no hole, no
        // ring; near, the film's hole.
        // AND IT IS PIXELS PER SHADOW, NOT PER WORLD UNIT: the cohort's own
        // mass scales the camera before the fold reads it, so every cohort's
        // hole opens at the same on-screen size whatever its week was. fold and
        // discIn carry the mass for free, being fractions of rs.
        float closeness = smoothstep(uUnfoldLo, uUnfoldHi, uPxScale * vMass / r0);
        float rs = mix(uHorizonFar, uHorizon, closeness) * vMass;
        float fold = rs / uHorizon;
        float discIn = uDiscIn * fold;
        float discOut = mix(uDiscOutFar, uDiscOut, closeness) * vMass;
        float M = 0.5 * rs;

        // The ray's own polar frame: e1 toward the camera, e2 the direction it
        // is heading in, phi the angle it has swept about the mass.
        vec3 e1 = oc / r0;
        float alongE1 = dot(d, e1);
        vec3 dp = d - alongE1 * e1;
        float b = length(dp);
        vec3 e2 = b > 1e-5 ? dp / b : vec3(0.0, 1.0, 0.0);
        float impact = r0 * b;

        // HOISTED ABOVE THE FAR RETURN: one number, spent by both exits.
        ${COHORT_CONTEXT_ENERGY_GLSL}

        // The far form, along the unbent ray: the whole image below the band,
        // and under the traced one -- at one minus the closeness -- through it.
        float farW = 1.0 - closeness;
        vec4 far = vec4(0.0);
        if (farW > 0.0) {
          far = lensFarSample(o, d, c, uDiscOutFar * vMass);
          // The nucleus: round and camera-facing, the sprite's own register
          // and the brightest thing in the far form -- the object a viewer
          // sees, with the in-plane arms as its atmosphere.
          // Written as t*t rather than pow(t, 2.0) so no reader has to prove
          // the base non-negative.
          float tf = impact / max(uFarGlowR * vMass, 1e-4);
          float tc = tf / ${COHORT_LENS_FAR_GLOW_CORE_R.toFixed(2)};
          // …and it FLARES on the block this cohort won. The receivers have
          // always answered a block loudly; the producer had nothing louder
          // than 77/255 to answer with, so the event had no subject. Same
          // envelope as the disc's pile — one block, one curve — on the one
          // term that is the object rather than its atmosphere.
          ${COHORT_GULP_GLSL}
          float heart = uFarGlow
            * (1.0 + ${COHORT_GULP_NUCLEUS.toFixed(1)} * gulp)
            * (exp(-tf * tf) + ${COHORT_LENS_FAR_GLOW_CORE.toFixed(1)} * exp(-tc * tc));
          far.rgb += mix(uRimColor, uColCore, 0.6) * heart;
          far *= farW;
        }
        // NO MARCHING AT THE FAR END. Every cohort at the app camera sits at
        // closeness 0, and the fragment leaves here with the intake drawn and
        // no ray integrated at all.
        if (closeness <= 0.0) {
          if (far.a <= 0.0 && dot(far.rgb, vec3(1.0)) < 0.002) discard;
          gl_FragColor = vec4(far.rgb * uAmp * cohortEnergy, clamp(far.a, 0.0, 1.0));
          return;
        }

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
          // The ray has left: it is heading away, and it is beyond BOTH where it
          // started and the disc it could still fall through.
          // (No backticks in here: this is inside a template literal.)
          // WARNING: r0 alone is NOT the escape radius, and G5 photographed what
          // that costs. Once the camera stands closer to a mark than
          // discOut / 1.2 -- 23.3 wu at the shipped 28 wu disc, i.e. any frame
          // past about 66 px/wu -- the outer disc lies OUTSIDE 1.2 * r0, so a
          // ray bent over the top was cut before it reached the far side. The
          // cut lands wherever the adaptive step happens to sample, so it is not
          // a soft edge: it is a row of hard black wedges bitten out of the
          // disc's far rim, and they appear at exactly the camera the film look
          // is for.
          if (phi > 0.6 && r > max(r0, discOut) * 1.2) break;
        }

        // THE DARK IS THE LAST THING TO ARRIVE. A captured ray paints the hole
        // gate of the closeness and not the closeness itself: nothing through
        // the first third of the band, full black by 0.85. A ring around a
        // darker centre is a small eye, and the black waits until the picture
        // is already a black hole in everything but colour.
        if (captured) {
          acc.a = smoothstep(
            ${COHORT_HOLE_GATE_LO.toFixed(2)}, ${COHORT_HOLE_GATE_HI.toFixed(2)}, closeness
          );
        }

        // The bloom the film's grade adds near, cut where the hole is.
        // Written as t*t rather than pow(t, 2.0) so no reader has to prove the
        // base non-negative.
        float t = impact / max(uGlowR * rs, 1e-4);
        float glow = uGlow * closeness * exp(-t * t) * (captured ? 0.0 : 1.0);
        acc.rgb += mix(uRimColor, uColMid, 0.5 * closeness) * glow;

        // The far form lies UNDER the traced image, at one minus the closeness:
        // what the trace has not yet painted shows the intake through it, and
        // the arriving dark covers the heart at the gate's own pace.
        float over = clamp(acc.a, 0.0, 1.0);
        acc.rgb += far.rgb * (1.0 - over);
        acc.a += far.a * (1.0 - over);

        if (acc.a <= 0.0 && dot(acc.rgb, vec3(1.0)) < 0.002) discard;
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
