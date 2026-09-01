import * as THREE from 'three';
import { PEER_NETWORK_PALETTE } from '../visualPalette';

/**
 * The two faces of a POW cohort's mark, and nothing else.
 *
 * ⭐⭐⭐ THE MARK IS THE APERTURE. A cohort is where the colony plane is
 * OPEN, and the whole form is that opening drawn twice: a disc lying IN the
 * plane (`makeCohortFaceMaterial`), and a camera-facing halo carrying the same
 * hole (`makeCohortAuraMaterial`). Nothing volumetric, nothing hanging under
 * the slab, and no second cadence — one hole, two rays through it.
 *
 * ⭐⭐⭐ A PLANET BLOCKS THE BACKGROUND; A HOLE BENDS IT. Every volume this
 * feature tried — a pillar, a vortex, a marched funnel — put a 20–40 world-unit
 * body next to a mesh built from 1–2 wu sprites and thin lines, and each read
 * as a landscape feature rather than as a junction: a searchlight, a cooling
 * tower, a drain. What survived every round was the opening itself, so this
 * draws only that.
 *
 * ⭐ THE CIRCLE IS WHAT MAKES THE COLONY PLANE LEGIBLE. The face draws a
 * CIRCLE; every ellipse a viewer sees is projection, and because every cohort
 * foreshortens identically that agreement states the plane itself. The
 * orientation is the colony's own and never per-cohort — the plane's normal is
 * world Y, which is also the rotation axis, so the mark turns with the plate
 * for free and has no axis anybody could read as pointing somewhere.
 *
 * ⛔⛔⛔ THE COHORT NEVER EMITS UPWARD, AT ANY TIME. A mined block goes
 * SIDEWAYS TO PEERS ONLY, because peers must verify it before it legitimately
 * enters the cell galaxy. `BlockDeliveryLayer` draws that later leg, and it
 * launches from MEASURED WORKERS on flood arrivals — never from the cohort.
 * That is structural rather than a convention: `planDeliveries` emits a carrier
 * only for ids present in `cf.arrivals`, and `networkFlood.derive` writes an
 * arrival only where `kind === 'measured'`, which an attested cohort is not. So
 * THE TWO WORLDS MEET AT THE APERTURE IN THE PLANE, and the leg out of the
 * colony is drawn by the peers that verified the block, from their own nodes.
 *
 * ⚠️ THAT CORRECTS A CLAIM THAT SHIPPED IN THREE SUCCESSIVE PLANS — "the block
 * leaves ABOVE and outward" — and it is stated positively here so the next
 * reader inherits the rule instead of the misconception. Nothing above the
 * plane belongs to this layer, at any phase of a block's life.
 *
 * ⭐⭐ NOTHING HERE DRAWS THE WIN EITHER, and that absence is the design rather
 * than a gap in it. `ColonyEdges`' outward surge already fires from the winning
 * cohort's own node, keyed on `attestedOrigin`; a second mark for the same
 * instant would be a second opinion about an event another layer already
 * states.
 *
 * ⭐⭐ BOTH FACES ARE ADDITIVE, UNLIT AND DEPTH-READ-ONLY, AND NO DARK PIXEL IS
 * EVER DRAWN. The pupil is unlit because bright structure REFUSES TO FILL it —
 * `smoothstep` up out of zero on the face, the ray/plane crossing on the aura —
 * which is this scene's own additive idiom for a hole. What this replaced spent
 * five register violations on the same idea: the only normal-blended object,
 * the only dark one, the only textured one (this scene's sole `fbm`), the only
 * oriented one and the only screen-locked one — and could still be seen through
 * by any colony edge behind it. The accepted cost of the swap is that nothing
 * behind a cohort is occluded any more.
 *
 * ⚠️ WHICH MAKES THE UNLIT MIDDLE SOMETHING OTHER LAYERS CAN BREAK. With no
 * shadow and no depth write there is nothing to reject a bright line laid
 * across the pupil; it is simply added to it. `COHORT_LINK_STOP_R` below is
 * where that is paid for: a cohort's own links end at the mark's outer edge, in
 * `ColonyEdges`, and the aperture stays its own from every camera.
 *
 * ⛔ AND WHAT THIS FORM DELIBERATELY DOES NOT DO — do not "fix" the absence.
 * 「从下方汲取能量」 is NOT EXPRESSED, by the user's decision, and after the lab
 * measured both halves of the only way there was to express it: a sub-plane
 * shaft gated through the hole is invisible except from directly overhead, and
 * an ungated one is a searchlight in miniature — the exact failure the aperture
 * exists to stop being. It is therefore deferred as a separate problem, and it
 * is ABSENT ON PURPOSE rather than missing.
 *
 * ⭐ The one surviving hint is `COHORT_AURA_HALO_BIAS` (knob `cohortHaloBias`),
 * which weights the halo DOWNWARD in world Y. It is the only cue for "the
 * energy is under the plane" that costs no silhouette: a gradient inside a glow
 * that is already there, so there is no cone, no stub, nothing that can read as
 * a beam, and it vanishes on its own from overhead — where "below" is not a
 * direction a viewer can see. That is the whole of it. Anything more has to
 * earn a draw of its own first.
 *
 * The design argument for each face sits on its own factory below; read it
 * before touching either.
 *
 * It remains continuous idle behaviour. It takes no block pulse, flood or
 * shockwave, and neither program reads a cohort's share.
 */

/**
 * The peer mesh's breathing cadence, and this file's one clock rate.
 *
 * ⭐ IT IS THE MESH'S NUMBER RATHER THAN THIS MARK'S. A cohort is a peer that
 * mines, so its mark inhales on the beat every stop around it keeps. The DEPTH
 * travels per-face and is not a constant here: the aperture carries
 * `COHORT_AP_BREATHE_DEPTH`. One rate, and a file whose two draws are one
 * object does not get a second one.
 */
export const COHORT_BREATHE_HZ = 1.2;

/* -------------------------------------------------------------------------- *
 * Shared by both faces — the proximity exemption.
 * -------------------------------------------------------------------------- */

/**
 * A cohort keeps its light when the camera comes to it.
 *
 * ⭐⭐⭐ WITHOUT THIS THE MARK IS DIMMEST EXACTLY WHERE IT IS INSPECTED.
 * `cellDetailPeerContextEnergy` winds passive peer context down to
 * `CELL_DETAIL_VIEW_PEER_CONTEXT_FLOOR` — 0.28 — as the camera closes in, and
 * `NetworkColony` hands this layer the same number it hands every other
 * passive peer draw. So a cohort flown to loses 72 % of its light at the one
 * range anybody ever looks at it from, which is also the range every
 * screenshot is taken at. The damping is right for what it was written for: a
 * hundred passive stops receding behind the subject. It is wrong for the
 * object the camera came for.
 *
 * The precedent is `makeMeasuredPeerHalosMaterial`'s
 * `mix(uContextEnergy, 1.0, vPeerSelected)` — a peer that IS the subject is
 * exempt from the recession. A cohort carries no selection lane, so proximity
 * stands in for one: the camera being here is the same statement as a click.
 *
 * ⚠️⚠️ IT MUST MEASURE FROM `cameraPosition`, AND `length(vOrigin)` IS THE
 * TRAP. `vOrigin` is `modelMatrix * instanceMatrix * vec4(0, 0, 0, 1)` — WORLD
 * space — so `length(vOrigin)` is the cohort's distance from the world ORIGIN:
 * a per-cohort constant spanning ±115 wu across a colony centred near
 * (0, 22, 0), with no relationship to where the camera is. It compiles, it
 * runs, and the exemption then either never fires or fires permanently
 * depending only on where that cohort happens to stand. `cameraPosition` is a
 * three.js built-in and is already in world space.
 *
 * ⭐ IT READS THE ORIGIN AND NEVER THE QUAD CORNER. The aura's quad is 4.29 wu
 * across the mark's own centre and the face's is 3, so a per-fragment distance
 * would bring one face up ahead of the other and fade the two halves of ONE
 * hole apart. One distance per instance, and both faces read that one.
 *
 * ⭐ IT ONLY EVER ADDS LIGHT. `mix(uContextEnergy, 1.0, k)` with `k` in
 * [0, 1] lies between its own two ends, so the result is never below
 * `uContextEnergy` and never above 1 — at every distance, for every context
 * energy. The exemption cannot dim anything, which is what makes it safe to
 * apply unconditionally rather than behind a mode.
 */

/**
 * Within this distance of the camera, the exemption is complete.
 *
 * ⭐ INSIDE `CELL_DETAIL_VIEW_NEAR_DISTANCE` (82), where the damping has
 * already bottomed out — so the exemption's band strictly CONTAINS the
 * damping's, and there is no range at which the mark is receding while the
 * exemption has not yet started.
 */
export const COHORT_CONTEXT_EXEMPT_NEAR = 70;

/**
 * Beyond this distance nothing is exempt, and a cohort is damped exactly like
 * every other passive stop around it.
 *
 * ⭐ OUTSIDE `CELL_DETAIL_VIEW_FAR_DISTANCE` (148), where the damping has not
 * begun — the other half of the containment above. In the overview a cohort
 * carries no privilege at all; what distinguishes it there is six world units
 * of open plane, against a sighted peer's 1.5.
 */
export const COHORT_CONTEXT_EXEMPT_FAR = 150;

/**
 * The exemption itself, as ONE string pasted into both programs.
 *
 * ⭐ ONE STRING AND TWO USE SITES, SO THE TWO FACES CANNOT DRIFT APART. They
 * are one hole: a halo that came up while the disc inside it stayed damped
 * would be a worse artefact than the bug this fixes.
 * `cohortContextEnergy.test.ts` asserts this exact text is inside both
 * fragment sources.
 *
 * It leaves `cohortEnergy` in scope. Both fragments multiply that into RGB and
 * NEVER into alpha — the house idiom that keeps additive damping linear.
 */
export const COHORT_CONTEXT_ENERGY_GLSL = /* glsl */ `float cohortEnergy = mix(
          uContextEnergy,
          1.0,
          1.0 - smoothstep(
            ${COHORT_CONTEXT_EXEMPT_NEAR.toFixed(1)},
            ${COHORT_CONTEXT_EXEMPT_FAR.toFixed(1)},
            distance(cameraPosition, vOrigin)
          )
        );`;

/* -------------------------------------------------------------------------- *
 * The aperture — a cohort's mark as a hole in the colony plane.
 * -------------------------------------------------------------------------- */

/**
 * The mark IS the aperture, and it is drawn as two faces of one hole.
 *
 * ⭐⭐⭐ A PLANET BLOCKS THE BACKGROUND; A HOLE BENDS IT. Every volumetric form
 * this feature tried put a 20–40 world-unit body next to a mesh built from 1–2
 * wu sprites and thin lines, and each read as a landscape feature rather than
 * as a junction — a searchlight, a cooling tower, a drain. What survived every
 * round was the aperture itself, so this drops the volume entirely and draws
 * only the opening.
 *
 * 1. `makeCohortFaceMaterial` — a disc LYING IN THE COLONY PLANE: a bright rim,
 *    a small dark pupil, and a fine radial intake grain. ⭐ It draws a CIRCLE;
 *    every ellipse a viewer sees is projection, and because all cohorts
 *    foreshorten identically that agreement is what makes the colony plane
 *    itself legible.
 * 2. `makeCohortAuraMaterial` — a small camera-facing quad whose halo carries
 *    THE SAME HOLE, cut by crossing the view ray with the colony plane. ⚠️ It
 *    is not decoration: below roughly 15° of elevation it is the only thing
 *    keeping the mark from reading as a dash among the peer links.
 *
 * ⭐ ORIENTATION IS SHARED WITH THE COLONY'S OWN PLANE AND IS NEVER PER-COHORT.
 * The plane's normal is world Y, which is also the colony's rotation axis, so
 * the face needs no matrix of its own and turns with the plate for free. The
 * register violation this stays clear of is a mark with an axis a viewer could
 * read as pointing somewhere; a circle in the shared plane has none.
 *
 * ⚠️ 「从下方汲取能量」 IS NOT EXPRESSED HERE, AND THAT IS A DECISION. Measured
 * in the lab: a sub-plane shaft gated through the hole is invisible except from
 * directly overhead, and ungated it is a searchlight in miniature. It does not
 * earn a draw, so it is not in this file — do not smuggle a substitute in.
 */

/**
 * The outer radius of the mark, in world units. ⭐ THE size parameter: every
 * other length here is a fraction of it.
 *
 * Measured sweet spot of a 2.4–3.8 band: 6.0 wu across, with a bright ring at
 * 1.68 wu against a sighted peer's 1.5. Below 2.4 the structure stops resolving
 * at the app camera; above 4 the mark starts to dominate the colony.
 */
export const COHORT_AP_R = 3.0;

/** Rim radius, as a fraction of `COHORT_AP_R` — 0.84 wu at the shipped size. */
export const COHORT_AP_RIM_FRAC = 0.28;

/**
 * Pupil radius, as a fraction of the RIM radius. A small dark pupil: 0.52 wu.
 *
 * ⭐ BOTH FACES READ THIS ONE NUMBER, which is what makes the aura's hole and
 * the face's the same hole rather than two that were tuned to agree.
 */
export const COHORT_AP_PUPIL_FRAC = 0.62;

/**
 * Depth of the shared breathe, as a fraction. The RATE is `COHORT_BREATHE_HZ` —
 * this file has one clock and the aperture does not get a second one.
 *
 * ⚠️ THE LAB SOURCE HARD-CODED 1.1 Hz HERE, and a mark drawn twice must not
 * carry two clocks: the face and the aura are one object, and two rates would
 * make the halo drift against the disc it surrounds until they visibly
 * disagreed. The DEPTH may travel per-face; the rate does not.
 */
export const COHORT_AP_BREATHE_DEPTH = 0.09;

/* ------------------------------------------------- what other layers read off it */

/**
 * The cohort's pick radius, in world units. `ColonyNodes` re-exports it as
 * `ATTESTED_HIT_RADIUS`, and it is the whole of what a viewer aims at.
 *
 * ⭐ HALF THE MARK'S OWN RADIUS — the same rule the deleted centre's target
 * kept, applied to the mark that replaced it. What moved is the extent, not the
 * rule: the centre was a 4.6 wu bounding square around a profile that died well
 * inside it, so half of it landed on lit pixels; the aperture is a 6.0 wu DISC
 * whose light is drawn all the way out to `COHORT_AP_R`, so half of it lands
 * at 45 % of the face's own peak — plainly lit, and nowhere near the tail.
 *
 * ⚠️⚠️ AND ALL OF IT IS NOT AVAILABLE, WHICH IS WHAT SETTLES THE COEFFICIENT.
 * `COLONY_MIN_SPACING` is 6, so `COHORT_AP_R` — 3.0, exactly half of it —
 * reaches the MIDPOINT between a cohort and the nearest stop the colony's own
 * scatter will place beside it, and a target that reaches a neighbour's half of
 * the gap steals its clicks. A drawn halo may overlap a neighbour freely,
 * because additive light is not exclusive; a hit sphere may not, because a
 * click has exactly one winner. So the two ends of the mark answer to different
 * bounds, and this one is bounded above by the geometry of the colony rather
 * than by the mark. Half is 1.5 — a quarter of the minimum spacing, leaving 3.0
 * wu of clear gap between two targets standing as close as the colony allows.
 *
 * ⭐ AND IT GOES UP RATHER THAN DOWN, which is the direction the mark moved.
 * 1.15 wu was already the answer to a real failure — this radius once made the
 * producer the SMALLEST target in the colony at 0.375 wu, under the faintest
 * roster rung's 0.425, and a full-canvas hover sweep of the running app found
 * forty peers and zero miners. 1.5 keeps that clear by 50 % over the brightest
 * sighted stop's 1.0. There is still exactly ONE number: no annulus, no second
 * radius. Pinned both ways in `components/ColonySightedNodes.test.tsx`.
 */
export const COHORT_HIT_RADIUS = COHORT_AP_R * 0.5;

/**
 * How far short of a cohort's centre its own links stop, in world units.
 *
 * ⭐⭐⭐ A LINK RUNNING INTO THE MARK FILLS THE ONE PLACE THIS FORM KEEPS EMPTY.
 * The pupil is not painted dark — the face's profile climbs out of exactly zero
 * and the aura's halo is cut by the ray/plane crossing, and the hole is that
 * refusal and nothing else. There is no shadow left to hide anything: every
 * face here is additive and depth-read-only, so a bright line laid across the
 * mark is simply added to it. `ColonyEdges` therefore ends a cohort's links out
 * here rather than at its node.
 *
 * ⭐⭐ AND UNDER THE APERTURE IT HAS A SECOND JOB THE THROAT NEVER GAVE IT: THE
 * GRAIN. The face carries 88 radial striae, and the one measured law of that
 * grain is that radial structure at LOW COUNT reads as a star — nothing
 * recovers it but count. A colony link is radial structure at count four. Both
 * the links and the face lie in the colony plane, so a link crossing the disc
 * is coplanar with the grain and joins it as a spoke several times the width of
 * any stria. Stopping at the disc's edge is what keeps the striae law from
 * being undone from outside the material.
 *
 * ⭐ IT IS `COHORT_AP_R` — THE MARK'S OUTER EDGE, AND THE SAME NUMBER THE
 * FRAGMENT DISCARDS ON. `if (r > uApR) discard;` is the first line of the
 * face's shader: past this radius the disc draws nothing at all, so a link
 * ending here ends exactly where the mark does and adds light to no pixel of
 * it.
 *
 * ⚠️ IT IS NO LONGER `COHORT_HIT_RADIUS`, AND THE SPLIT IS DELIBERATE. Under
 * the old form one number served both, because the centre's bounding square had
 * slack in it and half of it happened to satisfy the aim and the ending at
 * once. The aperture has no slack: its light really does reach `COHORT_AP_R`,
 * and `COLONY_MIN_SPACING` really does forbid a target that large. The two
 * consumers are asking different questions — a line asks where the LIGHT ends,
 * a click asks how far a viewer may aim without taking a neighbour's stop — and
 * pretending they are one question now means answering at least one of them
 * wrong. Both are derived from `COHORT_AP_R` and neither is a free literal, so
 * a retune of the mark still moves both together.
 */
export const COHORT_LINK_STOP_R = COHORT_AP_R;

/* ------------------------------------------------------------------ the face */

/** Softness of the pupil's edge, as a fraction of the pupil radius. */
export const COHORT_FACE_PUPIL_SOFT = 0.5;

/** Gaussian half-width of the rim, as a fraction of the rim radius. */
export const COHORT_FACE_RIM_W = 0.34;

/** How hard the rim burns, before the knee. */
export const COHORT_FACE_RIM_AMP = 1.05;

/** How far the rim tips toward cold white at its own peak. */
export const COHORT_FACE_HOT_MIX = 0.45;

/** Amplitude of the intake skirt, from the rim out to `COHORT_AP_R`. */
export const COHORT_FACE_INTAKE_AMP = 0.72;

/**
 * Fall-off exponent across the skirt. ⭐ THE SMOOTH HALO HAS TO OUTREACH THE
 * GRAIN, or the silhouette stops being a clean ellipse.
 */
export const COHORT_FACE_INTAKE_GAMMA = 2.4;

/**
 * Fill just outside the rim, so the pupil is a hole in a LIT SURFACE and not a
 * gap between two rings.
 */
export const COHORT_FACE_INTAKE_CORE = 0.6;

/**
 * ⭐⭐⭐ THE NUMBER OF RADIAL STRIAE, AND THE ONE LAW THAT DECIDES WHETHER THIS
 * MARK IS A GRAIN OR A SUNFLOWER.
 *
 * Measured over 48 variants and four sweeps: at 44 striae or fewer, radial
 * structure on a small bright mark reads as a STAR — regardless of the
 * modulation's sign (additive, subtractive or symmetric), its contrast
 * (0.22–0.9) or its reach. Nothing else recovers it. COUNT IS THE ONLY ESCAPE:
 * past roughly 64 the striae stop being countable and become a texture, which
 * is what a medium being drawn inward actually looks like.
 *
 * `COHORT_FACE_STRIAE_FLOOR` is that measured floor, exported so the law is
 * visible in the source and pinned in `materials/cohortAperture.test.ts`.
 */
export const COHORT_FACE_STRIAE = 88;

/** The measured floor the count above must never fall below. See it for why. */
export const COHORT_FACE_STRIAE_FLOOR = 64;

/**
 * Depth of the stria modulation.
 *
 * ⭐⭐⭐ IT IS PURELY SUBTRACTIVE, AND THAT IS WHAT KEEPS THE SILHOUETTE ROUND.
 * `COHORT_FACE_STRIA_LIFT` at 1 makes the modulation `1 + amt * (cos-bump - 1)`,
 * which lies in `[1 - amt, 1]` — the striae can only ever REMOVE light. A
 * mean-preserving or additive modulation displaces the iso-brightness contour
 * OUTWARD wherever a stria sits, so the outline scallops and the mark reads as
 * a sunflower; that happened in every variant of the first two sweeps. Taking
 * light away instead leaves the outline exactly where the smooth halo put it
 * and carves the grain into the interior.
 */
export const COHORT_FACE_STRIA_AMP = 0.38;

/** 1 = purely subtractive, 0.5 = symmetric, 0 = purely additive. See above. */
export const COHORT_FACE_STRIA_LIFT = 1;

/** Where the grain fades in, as a fraction of the skirt. */
export const COHORT_FACE_STRIA_R0 = 0.02;

/** Where it is completely gone — well inside the smooth halo. */
export const COHORT_FACE_STRIA_R1 = 0.9;

/** Width of each of those two fades. */
export const COHORT_FACE_STRIA_W = 0.08;

/**
 * Azimuthal drift of the grain, in turns per second.
 *
 * ⚠️ IT IS NOT A SHARE LANE AND MUST NOT BECOME ONE WITHOUT A MEASUREMENT.
 * At 88 striae a drift of 0.022 turns/s carries one stria past a fixed azimuth
 * every 0.52 s — a rate a viewer could read. But the grain prefilters to
 * nothing past roughly 25 wu (see `uAa`), so any rate written here is legible
 * only in close-up, which is why the shipped form leaves share out of both
 * aperture programs entirely.
 */
export const COHORT_FACE_DRIFT = 0.022;

/**
 * ONE broad inward swell, and never crests: structure ACROSS the flow reads as
 * the layers of an object, which is the reading this form exists to avoid.
 */
export const COHORT_FACE_SWELL = 0.16;

/** How fast that one swell runs inward, in turns per second. */
export const COHORT_FACE_SWELL_RATE = 0.4;

/**
 * Prefilter strength for the grain, against its own screen footprint.
 *
 * ⭐ IT IS WHAT MAKES THE GRAIN A ZOOM-IN DETAIL RATHER THAN SCENE-SCALE NOISE.
 * 88 striae across a 6 wu mark alias into moiré the moment the mark is small on
 * screen; `dFdx`/`dFdy` give the footprint of one plane unit, and the grain is
 * damped by `exp(-0.16 * dph²)` as that footprint approaches a stria's width.
 * Past roughly 25 wu it prefilters to nothing and the face is a smooth ring.
 */
export const COHORT_FACE_AA = 1;

/** The face's own amplitude, before the knee. */
export const COHORT_FACE_AMP = 1;

/**
 * The face's soft knee. ⭐ A KNEE AND NEVER A SCALE.
 *
 * ⭐⭐ AND IT IS APPLIED LAST, WHICH IS WHAT MAKES EVERY KNOB ON THIS FACE
 * SAFE. `knee * (1 - exp(-s / knee))` is strictly below `knee` for every finite
 * `s`, so no amplitude a tuner can dial — rim, skirt, breathe, all of them
 * multiplied together — can reach the additive clip. The centre this replaced
 * had no such property: its ceiling was `amp * 1.42` and its knob's MAXIMUM was
 * the guard, which is a guard a later hand can move.
 *
 * ⚠️ IT IS ONE HALF OF A PYTHAGOREAN PAIR AND DOES NOT MOVE ALONE — see
 * `COHORT_AURA_KNEE`, which is `sqrt(1 - this²)` and is what bounds the two
 * additive draws' SUM below 1.0 by arithmetic.
 */
export const COHORT_CLIP_KNEE = 0.92;

/**
 * Half-extent of the face's quad, in world units.
 *
 * The face is a disc of radius `apR` lying in the plane, and the quad is a
 * SQUARE in that same plane, so it needs no margin at all: a square of
 * half-extent `apR` strictly contains the disc, and the 21.5 % of its area
 * outside discards on the first line of the fragment.
 *
 * ⚠️ IT IS A FUNCTION AND THE LAYER HAS TO KEEP IT ONE, exactly as
 * `cohortAuraHalfExtent` is. If a knob drives `uApR` while `uHalf` stays, the
 * face crops against its own quad — the radius test inside stays exact, but the
 * pixels carrying the rim are never rasterised to run it. That bug has shipped
 * on this layer once already, on the proxy of the volume this replaced.
 */
export function cohortFaceHalfExtent(apR: number): number {
  return apR;
}

/** The same extent at the shipped radius: 3 world units. */
export const COHORT_FACE_HALF = cohortFaceHalfExtent(COHORT_AP_R);

/* ------------------------------------------------------------------ the aura */

/** The aura's own amplitude, before the knee. */
export const COHORT_AURA_AMP = 1;

/** Fall-off exponent of the halo, from the mark's centre outward. */
export const COHORT_AURA_HALO_EXP = 1.7;

/** Halo radius, as a multiple of `COHORT_AP_R` — 4.05 wu at the shipped size. */
export const COHORT_AURA_HALO_R = 1.35;

/**
 * How far the halo is weighted DOWNWARD in world Y.
 *
 * ⭐ THE ONLY CUE FOR "THE ENERGY IS UNDER THE PLANE" THAT COSTS NO SILHOUETTE.
 * It is a gradient inside a glow that is already there, so there is no cone, no
 * stub and nothing that can read as a beam, and it vanishes on its own from
 * overhead — where "below" is not a direction a viewer can see.
 */
export const COHORT_AURA_HALO_BIAS = 0.3;

/** How fast that bias falls off upward, in units of the halo radius. */
export const COHORT_AURA_HALO_BIAS_K = 0.55;

/**
 * The halo's own hole, in units of the aperture's pupil.
 *
 * ⭐⭐⭐ THE HALO HAS THE SAME HOLE, AND ONE TEST RESOLVES A CONFLICT THAT
 * OTHERWISE HAS NO ANSWER. A halo strong enough to stop the mark collapsing
 * into a dash at 12° of elevation also floods the pupil at 30° and kills the
 * one cue the whole form rests on. Cutting it with the aperture's own pupil
 * settles it EXACTLY, because the cut is computed by crossing the view ray with
 * the colony plane: from above, the ray lands inside the pupil and the halo is
 * cut, so the mark is a ring; at grazing incidence almost no ray lands in the
 * pupil at all, so the halo fills in and the mark stays a blob. The hole is
 * therefore never restated — it is the same disc, in the same plane, about the
 * same centre, read through a different ray.
 */
export const COHORT_AURA_PUPIL_SCALE = 1.35;

/** How far the halo tips toward cold white. Far less than the rim: the halo is
 *  support, and a white halo would compete with the structure it supports. */
export const COHORT_AURA_HOT_MIX = 0.1;

/**
 * The aura's soft knee — and the one number on this layer that is NOT the lab's.
 *
 * ⚠️⚠️⚠️ TWO ADDITIVE DRAWS OF ONE MARK SHARE A CEILING, AND NEITHER CAN SEE IT.
 * Additive blending takes source alpha as its factor, so each draw contributes
 * `uColor * shape²`, and blue is EXACTLY 1.0 in both `scaffold` and `coldWhite`
 * — so the blue a pixel receives is exactly `shapeFace² + shapeAura²`. The lab
 * kneed both faces at `COHORT_CLIP_KNEE` because it measured them one at a
 * time. Swept together over 700 cameras, their SUM reaches **1.067** in blue at
 * every distance from 8 to 300 wu: at low elevation the rim's near and far arcs
 * fold onto the halo's own peak, and the mark's brightest ring clips to flat
 * white-cyan with its structure gone. That is the failure that has already cost
 * this feature a full live leg.
 *
 * ⭐ SO THE TWO KNEES ARE A PYTHAGOREAN PAIR: `sqrt(1 - COHORT_CLIP_KNEE²)`.
 * Since `k * (1 - exp(-s / k)) < k` strictly for every finite input, the two
 * shapes lie STRICTLY inside the unit circle, so `shapeFace² + shapeAura² < 1`
 * at every pixel, every camera, every time and every knob setting. The ceiling
 * is arithmetic rather than a swept observation, which is what a ceiling this
 * expensive should be. Measured, it lands at 0.850 in blue.
 *
 * ⭐ THE FACE KEEPS `COHORT_CLIP_KNEE` UNTOUCHED, so the whole correction is
 * taken out of the halo and none of it out of the mark's structure. What that
 * costs is measured and small: the halo's peak drops, but the LIT AREA it
 * contributes at low elevation — the job it is actually here for — falls only
 * from 421 to 383 wu², 91 % of the lab's. A knee, never a scale.
 */
export const COHORT_AURA_KNEE = Math.sqrt(1 - COHORT_CLIP_KNEE ** 2);

/**
 * Half-extent of the aura's camera-facing quad, in world units.
 *
 * ⭐ THE 1.06 IS A PERSPECTIVE MARGIN AND NOT A GUESS. The halo is measured by
 * the PERPENDICULAR DISTANCE FROM THE VIEW RAY to the cohort, and for a camera
 * `D` from the mark a fragment sitting `d` out on the quad has a ray that
 * passes at `d / sqrt(1 + d²/D²)` — strictly LESS than `d`. So a quad of
 * half-extent exactly `haloR` leaves the halo's outer edge off its own quad.
 * The margin needed is `1 / sqrt(1 - (haloR/D)²)`, which is 1.062 at `D` = 12
 * wu — nearer than the orbit reaches. Beyond 12.2 wu the margin is slack.
 *
 * ⚠️ A FUNCTION FOR THE SAME REASON `cohortFaceHalfExtent` IS ONE: `uApR` and
 * `uHaloR` are both live knobs, and a quad left behind crops the halo it
 * carries.
 */
export function cohortAuraHalfExtent(apR: number, haloR: number): number {
  return apR * haloR * 1.06;
}

/** The same extent at the shipped radius and halo: 4.293 world units. */
export const COHORT_AURA_HALF = cohortAuraHalfExtent(
  COHORT_AP_R,
  COHORT_AURA_HALO_R,
);

/**
 * One cohort's face, as an instanced disc lying in the colony plane.
 *
 * ⚠️ THE GEOMETRY MUST BE `PlaneGeometry(1, 1)` — the SAME shared unit plane
 * the other draws in this layer take. The vertex shader lays it into the
 * instance's own XZ and scales it by the `uHalf` UNIFORM, so `mesh.scale` and a
 * scaled instance matrix are both irrelevant, exactly as they are for the aura
 * below. Two triangles are enough: the disc is flat, and the lab's 64x6 ring
 * existed only to demonstrate a bowl that was rejected at every amplitude
 * tested.
 *
 * ⭐ NO MATRIX AND NO ORIENTATION LANE. The plane's normal is world Y, which is
 * the colony's rotation axis, so laying the quad into local XZ and letting
 * `modelMatrix * instanceMatrix` carry it is all the orientation this mark ever
 * has. Rotation about Y maps that local plane onto the colony plane and
 * preserves lengths inside it, which is why `length(vP)` here and the aura's
 * ray/plane crossing measure the same radius about the same centre.
 *
 * ⚠️ THAT TIE ASSUMES THE INSTANCE MATRIX CARRIES NO SCALE. `ColonyCohorts`
 * builds it with `makeTranslation`; a scaled instance would move the face's
 * radius without moving the aura's, and the one hole would become two.
 *
 * `aSeed` is the same per-instance lane the other faces read. There is NO
 * `aShare` lane: share means rate on this layer, and neither aperture program
 * has a rate share could drive that survives the grain's own prefilter.
 */
export function makeCohortFaceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    // The disc lies IN the plane, so it is seen from below as often as from
    // above. It is the only draw in this layer that needs both faces.
    side: THREE.DoubleSide,
    uniforms: {
      uColor: {
        value: new THREE.Color().setRGB(...PEER_NETWORK_PALETTE.scaffold),
      },
      uHot: {
        value: new THREE.Color().setRGB(...PEER_NETWORK_PALETTE.coldWhite),
      },
      uTime: { value: 0 },
      uContextEnergy: { value: 1 },
      uHalf: { value: COHORT_FACE_HALF },
      uApR: { value: COHORT_AP_R },
      uRimFrac: { value: COHORT_AP_RIM_FRAC },
      uPupilFrac: { value: COHORT_AP_PUPIL_FRAC },
      uPupilSoft: { value: COHORT_FACE_PUPIL_SOFT },
      uRimW: { value: COHORT_FACE_RIM_W },
      uRimAmp: { value: COHORT_FACE_RIM_AMP },
      uHotMix: { value: COHORT_FACE_HOT_MIX },
      uInAmp: { value: COHORT_FACE_INTAKE_AMP },
      uInGamma: { value: COHORT_FACE_INTAKE_GAMMA },
      uInCore: { value: COHORT_FACE_INTAKE_CORE },
      uStriae: { value: COHORT_FACE_STRIAE },
      uStriaAmp: { value: COHORT_FACE_STRIA_AMP },
      uStriaLift: { value: COHORT_FACE_STRIA_LIFT },
      uStriaR0: { value: COHORT_FACE_STRIA_R0 },
      uStriaR1: { value: COHORT_FACE_STRIA_R1 },
      uStriaW: { value: COHORT_FACE_STRIA_W },
      uDrift: { value: COHORT_FACE_DRIFT },
      uSwell: { value: COHORT_FACE_SWELL },
      uSwellRate: { value: COHORT_FACE_SWELL_RATE },
      uAa: { value: COHORT_FACE_AA },
      uAmp: { value: COHORT_FACE_AMP },
      uKnee: { value: COHORT_CLIP_KNEE },
      uBreatheDepth: { value: COHORT_AP_BREATHE_DEPTH },
      uBreatheHz: { value: COHORT_BREATHE_HZ },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;

      uniform float uHalf;

      varying vec2 vP;
      varying vec3 vOrigin;
      varying float vSeed;

      void main() {
        vSeed = aSeed;
        // The instance's own world point, for the proximity exemption. It is
        // the SAME quantity every other face in this layer carries.
        vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vOrigin = origin.xyz;
        // ⚠️ uHalf IS A UNIFORM AND HAS TO BE — see the factory's comment.
        // The unit plane is laid into the instance's local XZ, which the
        // colony's rotation about world Y keeps parallel to the colony plane.
        vec3 local = vec3(position.x, 0.0, position.y) * uHalf * 2.0;
        // The offset from the cohort's centre, in the plane. A rotation about
        // Y preserves its length, so this is the same radius the aura reads
        // off its ray/plane crossing.
        vP = local.xz;
        vec4 world = modelMatrix * instanceMatrix * vec4(local, 1.0);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 uColor;
      uniform vec3 uHot;
      uniform float uTime;
      uniform float uContextEnergy;
      uniform float uApR;
      uniform float uRimFrac;
      uniform float uPupilFrac;
      uniform float uPupilSoft;
      uniform float uRimW;
      uniform float uRimAmp;
      uniform float uHotMix;
      uniform float uInAmp;
      uniform float uInGamma;
      uniform float uInCore;
      uniform float uStriae;
      uniform float uStriaAmp;
      uniform float uStriaLift;
      uniform float uStriaR0;
      uniform float uStriaR1;
      uniform float uStriaW;
      uniform float uDrift;
      uniform float uSwell;
      uniform float uSwellRate;
      uniform float uAa;
      uniform float uAmp;
      uniform float uKnee;
      uniform float uBreatheDepth;
      uniform float uBreatheHz;

      varying vec2 vP;
      varying vec3 vOrigin;
      varying float vSeed;

      const float TAU = 6.28318530718;

      float sq(float x) { return x * x; }

      void main() {
        float r = length(vP);
        // The quad is a square and the mark is a disc: 21.5 % of the
        // fragments are corner and leave here.
        if (r > uApR) discard;

        float rimR = max(uApR * uRimFrac, 0.02);
        float rho = r / rimR;
        float pup = max(uPupilFrac, 0.02);

        // ⭐⭐⭐ THE PUPIL, AND IT REACHES EXACTLY ZERO. It is an absence of
        // light and never a drawn dark disc — this scene's own additive idiom
        // for a hole. ⚠️ The clamp keeps edge0 strictly below
        // edge1: at uPupilSoft = 0 the two edges would be equal, and
        // smoothstep with edge0 >= edge1 is UNDEFINED in GLSL ES and has
        // rendered nothing at all on this project's own driver once already.
        float pupil = smoothstep(
          pup * (1.0 - clamp(uPupilSoft, 0.02, 0.98)),
          pup,
          rho
        );
        float rim = exp(-sq((rho - 1.0) / max(uRimW, 0.02)));

        // The intake skirt, from the rim out to the mark's edge.
        float outer = max(uApR / rimR, 1.2);
        float uu = clamp((rho - 1.0) / (outer - 1.0), 0.0, 1.0);
        float skirt = pow(1.0 - uu, max(uInGamma, 0.2));
        float fill = uInCore * exp(-sq((rho - 1.0) / 0.85));

        // ---- the grain: a modulation of the SAME light, running radially
        // inward. A continuous cosine in azimuth, never beads and never
        // particles.
        float th = atan(vP.y, vP.x);
        float ph = uStriae * th + (uTime * uDrift + vSeed) * TAU;
        // Prefiltered against its own screen footprint, so the grain is a
        // zoom-in detail and never scene-scale noise.
        vec2 footX = dFdx(vP);
        vec2 footY = dFdy(vP);
        float foot = max(length(footX), length(footY));
        float dph = uStriae * foot / max(r, 1e-3);
        float pre = mix(1.0, exp(-0.16 * dph * dph), clamp(uAa, 0.0, 1.0));
        // A bell envelope, so the grain is gone before the outer boundary.
        float striaW = max(uStriaW, 0.02);
        float striaAmt = uStriaAmp
          * smoothstep(uStriaR0, uStriaR0 + striaW, uu)
          * (1.0 - smoothstep(uStriaR1, uStriaR1 + striaW, uu));
        // ⭐⭐⭐ SUBTRACTIVE. With uStriaLift at 1 this lies in [1 - amt, 1],
        // so a stria can only ever REMOVE light and the outer iso-brightness
        // contour stays exactly where the smooth halo put it. An additive or
        // mean-preserving modulation pushes that contour outward under every
        // stria, and the mark reads as a sunflower.
        float stria = 1.0
          + striaAmt * pre * ((0.5 + 0.5 * cos(ph)) - uStriaLift);

        // ONE broad inward swell. Never crests: structure ACROSS the flow
        // reads as the layers of an object.
        float swell = 1.0
          + uSwell * cos(uu * 1.10 * TAU + (uTime * uSwellRate + vSeed) * TAU);

        float intake = uInAmp * (skirt + fill) * swell * stria;

        float breathe = 1.0 - uBreatheDepth
          + uBreatheDepth * sin(uTime * uBreatheHz + vSeed * TAU);
        float shape = (rim * uRimAmp + intake) * pupil * uAmp * breathe;
        if (shape < 0.0018) discard;
        // ⭐ A KNEE AND NEVER A SCALE. See COHORT_AURA_KNEE for why the aura's
        // is the Pythagorean partner of this one.
        shape = uKnee * (1.0 - exp(-shape / uKnee));
        ${COHORT_CONTEXT_ENERGY_GLSL}
        vec3 tint = mix(uColor, uHot, uHotMix * rim * pupil);
        // Energy multiplies RGB and NEVER alpha — the house idiom that keeps
        // additive damping linear.
        gl_FragColor = vec4(tint * shape * cohortEnergy, shape);
      }
    `,
  });
}

/**
 * One cohort's aura, as an instanced camera-facing billboard.
 *
 * ⭐ IT DOES THE ONE THING A PLANE-LYING QUAD CANNOT: keep the mark's AREA when
 * the plane is seen edge-on. Below roughly 15° of elevation the face collapses
 * to a bright horizontal sliver and is then indistinguishable from a peer link;
 * the halo is view-independent, so the mark stays a blob at every elevation.
 *
 * ⭐⭐⭐ AND IT CARRIES THE SAME HOLE, cut by crossing the view ray with the
 * colony plane rather than by restating the face's pupil. From above, a ray
 * through the middle of the mark lands inside the pupil and the halo is cut, so
 * the mark reads as a ring; at grazing incidence almost no ray lands in the
 * pupil, so the halo fills in and the mark stays solid. One test, and the mark
 * does the right thing at every elevation.
 *
 * ⚠️ THE GEOMETRY MUST BE `PlaneGeometry(1, 1)`, and for a stronger reason
 * than the face's: this quad is rebuilt from raw `position` and the view
 * matrix's camera axes, which no model matrix ever touches, so `mesh.scale` and
 * a scaled instance matrix are not merely irrelevant — they are SILENTLY
 * DROPPED, and a unit plane with its extent baked into the geometry would draw
 * one world unit across. The extent has to ride the `uHalf` UNIFORM.
 *
 * ⛔ NOTHING IS DRAWN ABOVE THE COLONY PLANE AND NOTHING BELOW IT EITHER. The
 * lab carried a short converging medium under the slab behind a switch; it was
 * measured invisible except from directly overhead, and ungated it was the
 * searchlight this whole form exists to stop being. It is not in this file.
 *
 * `aSeed` is the same per-instance lane the face reads, and there is no
 * `aShare` lane — see `makeCohortFaceMaterial`.
 */
export function makeCohortAuraMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uColor: {
        value: new THREE.Color().setRGB(...PEER_NETWORK_PALETTE.scaffold),
      },
      uHot: {
        value: new THREE.Color().setRGB(...PEER_NETWORK_PALETTE.coldWhite),
      },
      uTime: { value: 0 },
      uContextEnergy: { value: 1 },
      uHalf: { value: COHORT_AURA_HALF },
      uApR: { value: COHORT_AP_R },
      uRimFrac: { value: COHORT_AP_RIM_FRAC },
      uPupilFrac: { value: COHORT_AP_PUPIL_FRAC },
      uHaloExp: { value: COHORT_AURA_HALO_EXP },
      uHaloR: { value: COHORT_AURA_HALO_R },
      uHaloBias: { value: COHORT_AURA_HALO_BIAS },
      uHaloBiasK: { value: COHORT_AURA_HALO_BIAS_K },
      uHaloPupil: { value: COHORT_AURA_PUPIL_SCALE },
      uHotMix: { value: COHORT_AURA_HOT_MIX },
      uAmp: { value: COHORT_AURA_AMP },
      uKnee: { value: COHORT_AURA_KNEE },
      uBreatheDepth: { value: COHORT_AP_BREATHE_DEPTH },
      uBreatheHz: { value: COHORT_BREATHE_HZ },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;

      uniform float uHalf;

      varying vec3 vWorld;
      varying vec3 vOrigin;
      varying float vSeed;

      void main() {
        vSeed = aSeed;
        vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vOrigin = origin.xyz;
        vec3 cameraRight = vec3(
          viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]
        );
        vec3 cameraUp = vec3(
          viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]
        );
        // ⚠️ uHalf IS A UNIFORM AND HAS TO BE — see the factory's comment.
        vWorld = origin.xyz
          + (cameraRight * position.x + cameraUp * position.y) * uHalf * 2.0;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 uColor;
      uniform vec3 uHot;
      uniform float uTime;
      uniform float uContextEnergy;
      uniform float uApR;
      uniform float uRimFrac;
      uniform float uPupilFrac;
      uniform float uHaloExp;
      uniform float uHaloR;
      uniform float uHaloBias;
      uniform float uHaloBiasK;
      uniform float uHaloPupil;
      uniform float uHotMix;
      uniform float uAmp;
      uniform float uKnee;
      uniform float uBreatheDepth;
      uniform float uBreatheHz;

      varying vec3 vWorld;
      varying vec3 vOrigin;
      varying float vSeed;

      const float TAU = 6.28318530718;

      void main() {
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vWorld - ro);

        // ---- the halo, measured from the COHORT and not from the quad, so it
        // stays concentric with the aperture however the billboard is turned.
        vec3 oc = vOrigin - ro;
        float tc = dot(oc, rd);
        float perp = length(oc - rd * tc);
        float hR = max(uApR * uHaloR, 0.05);
        if (perp > hR) discard;
        float hx = clamp(perp / hR, 0.0, 1.0);
        float halo = pow(1.0 - hx, max(uHaloExp, 0.2));

        // ⭐⭐⭐ THE SAME HOLE, CUT BY THE RAY/PLANE CROSSING. The radius below
        // is the aperture's own pupil scaled once, and the distance it is
        // compared against is measured in the colony plane about the cohort's
        // own centre — which is the very quantity the face calls length(vP).
        // The two holes are therefore one hole seen through two rays, and
        // there is no second radius anywhere for them to drift apart on.
        float rimR = max(uApR * uRimFrac, 0.02);
        float pupR = rimR * max(uPupilFrac, 0.05) * max(uHaloPupil, 0.1);
        if (abs(rd.y) > 1e-5) {
          float tp = (vOrigin.y - ro.y) / rd.y;
          if (tp > 0.0) {
            float planeR = length((ro + rd * tp).xz - vOrigin.xz);
            halo *= smoothstep(pupR * 0.45, pupR, planeR);
          }
        }

        // Weighted downward in world Y: a gradient inside a glow that is
        // already there, so it adds no silhouette and cannot read as a beam.
        float dy = vWorld.y - vOrigin.y;
        halo *= 1.0 - uHaloBias * smoothstep(
          -hR * uHaloBiasK * 0.35,
          hR * max(uHaloBiasK, 0.05),
          dy
        );

        float breathe = 1.0 - uBreatheDepth
          + uBreatheDepth * sin(uTime * uBreatheHz + vSeed * TAU);
        float shape = halo * uAmp * breathe;
        if (shape < 0.0018) discard;
        // ⭐ The Pythagorean partner of the face's knee, so the two draws sum
        // strictly inside the unit circle. See COHORT_AURA_KNEE.
        shape = uKnee * (1.0 - exp(-shape / uKnee));
        ${COHORT_CONTEXT_ENERGY_GLSL}
        vec3 tint = mix(uColor, uHot, uHotMix);
        gl_FragColor = vec4(tint * shape * cohortEnergy, shape);
      }
    `,
  });
}
