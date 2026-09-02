import * as THREE from 'three';
import { PEER_NETWORK_PALETTE, type SceneColor } from '../visualPalette';

/**
 * The two faces of a POW cohort's mark, and nothing else.
 *
 * ⭐⭐⭐ THE MARK IS THE APERTURE. A cohort is where the colony plane is
 * OPEN, and the MARK is that opening drawn twice: a disc lying IN the
 * plane (`makeCohortFaceMaterial`), and a camera-facing halo carrying the same
 * hole (`makeCohortAuraMaterial`). Nothing volumetric, nothing hanging under
 * the slab, and no second cadence — one hole, two rays through it.
 *
 * ⭐ `ColonyCohorts` issues a THIRD draw beside these two, and it is not in this
 * file: the INTAKE PATCH, the surface of the mist the hole is drinking, whose
 * material is `makeCohortIntakePatchMaterial` in `materials/colonyMist`. Three
 * draws, one plan, one instance count, one `aGulp` lane — and the mark's own
 * two are still all this file owns. The two files share
 * `COHORT_INTAKE_LEVEL` (the window's medium level IS the mound's top) and
 * `COHORT_RIM_R` (the drawn lip IS the radius the patch gates, piles and wakes
 * against), which is what keeps one cohort from reading as two.
 *
 * ⭐⭐⭐ AND THE HOLE HAS A WINDOW IN IT. The peer mesh is the boundary between
 * two universes — above it the cell canopy, below it the one a cohort drinks
 * from — so looking into the aperture is looking at the other world: the
 * throat's wall lit FROM BELOW, and, wherever the view ray reaches deeper than
 * `COHORT_INTAKE_LEVEL`, the surface of the medium rising toward the lip. The
 * lip itself is fed by what arrives at it and is uneven for that reason, and on
 * the block this cohort wins the whole mouth GULPS (`aGulp`). ⛔ Every pixel of
 * it is still drawn on the aperture's own two quads: nothing is drawn under the
 * plane by this file, and nothing above it. The depth is the ray's, not a
 * volume's.
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
 * ⚠️ THIS HEADER USED TO SAY "NOTHING HERE DRAWS THE WIN EITHER", AND THAT IS
 * NO LONGER TRUE — the correction is worth keeping, because the old reason was
 * good. R19 left the block to `ColonyEdges`' outward surge, which fires from
 * the winning cohort's own node keyed on `attestedOrigin`, on the argument that
 * a second mark for the same instant would be a second OPINION about an event
 * another layer already states. What ships now is not a second opinion: on the
 * block a cohort wins, its lip, its window and the mist under it GULP together
 * on one envelope (`aGulp`, below) — the mouth swallowing what the edges are
 * already carrying away. One event in two places on one clock, and the edges
 * are still the only layer that says which way it left.
 *
 * ⭐⭐ BOTH FACES ARE ADDITIVE, UNLIT AND DEPTH-READ-ONLY, AND NO DARK PIXEL IS
 * EVER DRAWN. The mark's own structure REFUSES TO FILL the middle —
 * `smoothstep` up out of zero on the face, the ray/plane crossing on the aura —
 * which is this scene's own additive idiom for a hole. What this replaced spent
 * five register violations on the same idea: the only normal-blended object,
 * the only dark one, the only textured one (this scene's sole `fbm`), the only
 * oriented one and the only screen-locked one — and could still be seen through
 * by any colony edge behind it. The accepted cost of the swap is that nothing
 * behind a cohort is occluded any more.
 *
 * ⚠️ THE MIDDLE IS NO LONGER UNLIT, AND THAT INVARIANT MOVED ON PURPOSE. R19
 * pinned the pupil at exactly zero; the window fills it with the other world.
 * What replaces the old claim is stronger, not weaker: the face's OWN structure
 * — rim, skirt, grain — still reaches EXACTLY zero in there, and every photon
 * inside the pupil is `COHORT_INTERIOR_COLD`, a colour no other draw in the
 * peer plane wears. The middle is still not the network's; it now says whose
 * it is. (Do NOT restore the "no dark pixel" reading as "no pixel": the hole
 * was never dark and is not dark now.)
 *
 * ⚠️ AND THE MIDDLE IS STILL SOMETHING OTHER LAYERS CAN BREAK. With no shadow
 * and no depth write there is nothing to reject a bright line laid across it;
 * it is simply added. `COHORT_LINK_STOP_R` below is where that is paid for: a
 * cohort's own links end at the mark's outer edge, in `ColonyEdges`, and the
 * aperture stays its own from every camera.
 *
 * ⛔ AND WHAT THIS FORM STILL DOES NOT DO — do not "fix" the absence. There is
 * NO PLUME, COLUMN, FUNNEL OR PILLAR under the mouth, at any brightness
 * profile. Twenty-five rounds measured that: a shaft gated through the hole is
 * invisible except from directly overhead, and an ungated one is a searchlight
 * in miniature — up close, a saucer with a tractor beam. ⭐ ONLY SURFACES BEING
 * DRAWN EVER READ AS INTAKE, which is exactly what the window is and what the
 * mist patch beside it IS — it ships, in `materials/colonyMist`. A volume is not
 * an option that was left untried.
 *
 * ⭐ The second cue for "the energy is under the plane" costs no silhouette
 * either: `COHORT_AURA_HALO_BIAS` (knob `cohortHaloBias`) weights the halo
 * DOWNWARD in world Y, and `COHORT_AURA_UNDER_TINT` tips the half of it below
 * the plane toward the window's own colour. Both are gradients inside a glow
 * that is already there — no cone, no stub, nothing that can read as a beam —
 * and both vanish from overhead on their own, where "below" is not a direction
 * a viewer can see.
 *
 * The design argument for each face sits on its own factory below; read it
 * before touching either.
 *
 * It remains continuous idle behaviour, and neither program reads a cohort's
 * share. The one per-block input is `aGulp` — the sim second of the block this
 * cohort won — and it is a LANE rather than a uniform, because two blocks
 * seconds apart can name two different cohorts and one broadcast number would
 * cut the first mouth's swallow off mid-flight to hand the second one its own.
 *
 * ⭐⭐⭐ WHAT STAMPS IT IS ONE STRING EQUALITY, and that is the whole guard
 * against a mark gulping for somebody else's block: `ColonyCohorts` writes the
 * lane for the ONE mark whose `CohortMark.nodeId` equals `ColonyFlood.entryId`,
 * and both of those strings are `attested:<key>` from the SAME function,
 * `attestedNodeId` in `networkTopology.derive`. Every other slot stays at
 * `COHORT_NEVER_WON`. The shockwave and the flood object stay OUT, for the
 * reason they always had — a front that crosses the whole colony is one number
 * every cohort reads, and it would flare all six on a block one of them won.
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
 * 1. `makeCohortFaceMaterial` — a disc LYING IN THE COLONY PLANE: a bright rim
 *    fed by what arrives at it, a fine radial intake grain, and a WINDOW where
 *    the pupil is. ⭐ It draws a CIRCLE; every ellipse a viewer sees is
 *    projection, and because all cohorts foreshorten identically that agreement
 *    is what makes the colony plane itself legible.
 * 2. `makeCohortAuraMaterial` — a small camera-facing quad whose halo carries
 *    THE SAME HOLE, cut by crossing the view ray with the colony plane. ⚠️ It
 *    is not decoration: below roughly 15° of elevation it is the only thing
 *    keeping the mark from reading as a dash among the peer links, which is why
 *    it is lifted there (`COHORT_AURA_LOW_BOOST`).
 *
 * ⭐ ORIENTATION IS SHARED WITH THE COLONY'S OWN PLANE AND IS NEVER PER-COHORT.
 * The plane's normal is world Y, which is also the colony's rotation axis, so
 * the face needs no matrix of its own and turns with the plate for free. The
 * register violation this stays clear of is a mark with an axis a viewer could
 * read as pointing somewhere; a circle in the shared plane has none.
 *
 * ⭐⭐ 「从下方汲取能量」 IS EXPRESSED BY THE WINDOW AND BY NOTHING ELSE. It took
 * twenty-five rounds to find the one form that says it without lying: you SEE
 * INTO the hole, and what is in there is a surface being drawn upward. ⛔ The
 * rejected halves are still rejected — a sub-plane shaft gated through the hole
 * is invisible except from directly overhead, and ungated it is a searchlight
 * in miniature. Do not smuggle a volume back in beside the window.
 */

/**
 * The outer radius of the mark, in world units. ⭐ THE size parameter: every
 * other length here is a fraction of it.
 *
 * Measured sweet spot of a 2.4–3.8 band: 6.0 wu across. Below 2.4 the structure
 * stops resolving at the app camera; above 4 the mark starts to dominate the
 * colony. ⭐ IT DID NOT MOVE WHEN THE HOLE WAS RE-BASED, and that is deliberate:
 * `COHORT_HIT_RADIUS` and `COHORT_LINK_STOP_R` are both derived from it and the
 * colony's own spacing is what bounds them, so the mark's OUTER extent answers
 * to the colony while the hole inside it answers to the preview.
 *
 * ⚠️ THIS COMMENT ONCE READ "a bright ring at 1.68 wu", AND THAT SENTENCE COST
 * A ROUND. 1.68 was the ring's DIAMETER — the radius was 0.84 — and the plan
 * that ported the window read it as the preview's 1.6 wu RADIUS and concluded
 * the two forms already agreed. They were three times apart. Diameters are not
 * written here any more; `COHORT_RIM_R` is a radius and says so.
 */
export const COHORT_AP_R = 3.0;

/**
 * ⭐⭐⭐ THE HOLE'S RADIUS IN WORLD UNITS — THE ONE NUMBER EVERY PART OF THIS
 * FEATURE MEASURES ITSELF AGAINST.
 *
 * The face's window is drawn inside it, the drawn lip sits ON it, the skirt's
 * cut is a multiple of it (`COHORT_AURA_PUPIL_SCALE`), and the mist patch under
 * a cohort scales its gate, its dark eye, the medium piling at the lip and the
 * downstream wake by this same radius. It is exported so all of those read ONE
 * number: two holes at one cohort — a mouth of one size and a mist gate of
 * another — is the failure this constant exists to make impossible.
 *
 * 1.6 wu, from the approved preview (`AP_DEFAULTS.rimR` in the lab, and the
 * `uRimR` its sea material is handed).
 *
 * ⚠️⚠️ IT WAS 0.84 wu UNTIL 2026-09-02, AND THAT WAS A TRANSCRIPTION ERROR
 * RATHER THAN A DESIGN. R19's prose recorded "a bright ring at 1.68 wu" — a
 * DIAMETER — and the plan that ported the window read it as the lab's 1.6 wu
 * RADIUS and concluded the two agreed. They did not: the hole was three times
 * too small, and the symptom was measurable — the medium inside the throat
 * first became visible at 34° of elevation instead of the preview's 12°,
 * because the depth a ray reaches is proportional to the hole it crosses. The
 * lip's feed carried four lobes where the preview carried seven, for the same
 * reason. Both came back to the preview's numbers the moment this did.
 */
export const COHORT_RIM_R = 1.6;

/**
 * The same radius as a fraction of `COHORT_AP_R`, which is what the shader
 * reads: every length on this mark is a fraction of the mark, so the live
 * `cohortApR` knob scales the whole form together instead of shearing it.
 */
export const COHORT_AP_RIM_FRAC = COHORT_RIM_R / COHORT_AP_R;

/**
 * Pupil radius, as a fraction of the RIM radius — and it is now EXACTLY 1.
 *
 * ⭐⭐⭐ THE HOLE IS THE LIP, WHICH IS WHAT THE PREVIEW DRAWS. The lab's face
 * shows wall and medium for the whole disc `r < R` and puts its faint drawn lip
 * AT `R`; there is no second radius inside it. So the pupil does not sit inside
 * the ring any more — it reaches it, and the ring is the hole's edge rather
 * than a bright annulus with a smaller dark middle.
 *
 * ⭐ BOTH FACES READ THIS ONE NUMBER, which is what makes the aura's hole and
 * the face's the same hole rather than two that were tuned to agree.
 *
 * ⚠️ It is still a knob (`cohortPupil`, max 1.5), so a tuner can push the hole
 * OUTSIDE the lip. That is deliberate — it is how you find out whether the lip
 * wants to be inside or outside the throat — and it is safe: every consumer
 * derives from the product, and the two faces read the same product.
 */
export const COHORT_AP_PUPIL_FRAC = 1;

/**
 * The hole's radius under a live `cohortApR`, for any layer that has to agree
 * with the drawn mark rather than with the shipped constant.
 *
 * ⚠️ A FUNCTION FOR THE SAME REASON `cohortFaceHalfExtent` IS ONE. `uApR` is a
 * knob; a layer that hard-codes `COHORT_RIM_R` while the face reads
 * `uApR * uRimFrac` draws its gate at a radius the mouth no longer has.
 */
export function cohortRimRadius(apR: number): number {
  return apR * COHORT_AP_RIM_FRAC;
}

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
 * whose light is drawn all the way out to `COHORT_AP_R`.
 *
 * ⭐⭐ AND SINCE THE HOLE WAS RE-BASED TO 1.6 wu, THE WHOLE TARGET IS INSIDE THE
 * HOLE — 1.5 against 1.6 — WHICH IS RIGHT AND NOT A REGRESSION. The old
 * reasoning here said half the radius "lands at 45 % of the face's own peak,
 * plainly lit"; that was measured against a mark whose middle was empty, and it
 * is simply the wrong argument now. What a viewer aims at IS the window: the
 * hole is the largest, brightest, most obviously clickable thing on the mark,
 * and it is lit by the other world rather than by the face. A target that
 * covered the lip instead would be a target on a fine ring. So the target is
 * the hole, and it stops 0.1 wu short of the lip — inside the one region a
 * viewer can be in no doubt about.
 *
 * ⚠️⚠️ AND ALL OF IT IS NOT AVAILABLE, WHICH IS WHAT SETTLES THE COEFFICIENT.
 * `COLONY_MIN_SPACING` is 6, so `COHORT_AP_R` — 3.0, exactly half of it —
 * reaches the MIDPOINT between a cohort and the nearest stop the colony's own
 * SCATTER will place beside it, and a target that reaches a neighbour's half of
 * the gap steals its clicks. A drawn halo may overlap a neighbour freely,
 * because additive light is not exclusive; a hit sphere may not, because a
 * click has exactly one winner. So the two ends of the mark answer to different
 * bounds, and this one is bounded above by the geometry of the colony rather
 * than by the mark. Half is 1.5 — a quarter of the minimum spacing, leaving 3.0
 * wu of clear gap between two targets standing as close as the colony allows.
 *
 * ⚠️⚠️ THAT BOUND ONLY EVER COVERED THE SCATTER, AND THE COLONY MEASURED
 * CLOSER (live, 2026-09-02). `COLONY_MIN_SPACING` rejects candidates in
 * `scatterInferred` and nowhere else; a SIGHTED peer's placement is a hash and
 * is bounded by nothing. With the slab thinned to `COLONY_Y_THICKNESS` 6 and a
 * cohort giving up its own height, the six live cohorts' nearest non-cohort
 * neighbours measured 1.274 / 2.355 / 4.602 / 5.337 / 7.794 / 8.247 wu, against
 * R19's 2.99 minimum at the old thickness — the minimum INSIDE both this radius
 * and the drawn hole. Clicks still resolved correctly, but at the 1.274 and
 * 4.602 wu peers' projected centres the HOVER readout named the cohort while
 * the CLICK resolved to the peer, and one cohort's own hole opened its
 * neighbour's card from one of two camera azimuths.
 *
 * ⭐⭐⭐ CLOSED BY PLACEMENT, NOT BY RETUNING THIS RADIUS.
 * `COHORT_KEEP_OUT_R` in `derives/networkTopology.derive.ts` empties a 3.5 wu
 * XZ disc around every attested position: a ghost or a staged peer inside it is
 * pushed out to the rim, the measured belt and the local node are exempt. That
 * is the right end of the problem — a hit sphere the size of the hole is what
 * the mark WANTS, and shrinking it would only make the miner a smaller target
 * again (see the paragraph below). Re-measured live afterwards on the same six
 * cohorts: the nearest non-cohort distances are now 3.598 / 3.527 / 4.602 /
 * 8.247 / 5.337 / 7.794 wu, the minimum XZ clearance over all 258 staged nodes
 * is exactly 3.500, all twelve hole clicks (six cohorts × two azimuths 90°
 * apart) open their own `POW COHORT //` card, all six nearest clickable
 * neighbours open their own, and no hover anywhere names a cohort at a peer's
 * centre. `__tests__/materials/cohortKeepOut.test.ts` pins the two radii
 * against each other, since a derive may not import this file.
 *
 * ⚠️ If this radius is ever changed, judge it against the KEEP-OUT — the
 * closest a staged peer may now stand — and never against `COLONY_MIN_SPACING`,
 * which bounds only the inferred scatter.
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
 * ⭐ Since the hole was re-based it is 1.4 wu OUTSIDE the lip rather than 2.5,
 * and the job is unchanged: what it clears is the SKIRT, which is where the
 * striae live, and the skirt still runs from the lip at 1.6 out to here. What
 * shrank is the skirt, not the margin.
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

/**
 * Softness of the pupil's edge, as a fraction of the pupil radius.
 *
 * ⭐ IT IS THE PREVIEW'S SHARP INNER EDGE, DERIVED RATHER THAN CHOSEN. The lab
 * draws its lip as `exp(-((R - r) / 0.10)²)` inside the hole — a Gaussian with
 * a 0.10 wu sigma, so the lip is at 1.8 % of its peak 0.2 wu inside `R` and
 * gone by 0.3. This face has no such asymmetry to spend: its ring is one
 * Gaussian and the SHARP inner edge is the pupil gate's job. 0.2 wu of edge on
 * a 1.6 wu hole is 0.125 of the radius, which is this number, and it is what
 * makes the hole read as an edge against a hole rather than as a soft vignette.
 */
export const COHORT_FACE_PUPIL_SOFT = 0.125;

/**
 * Gaussian half-width of the rim, as a fraction of the rim radius.
 *
 * ⭐ THE PREVIEW'S OUTER SIGMA, IN THIS FACE'S OWN UNITS. The lab's lip falls
 * off outside the hole as `exp(-((r - R) / 0.30)²)`: 0.30 wu, which on a 1.6 wu
 * hole is 0.1875 of the radius. ⚠️ It came down from 0.34 when the hole was
 * re-based: 0.34 was measured against an 0.84 wu ring and is 0.29 wu there, but
 * the SAME fraction on a 1.6 wu hole is 0.54 wu — a lip nearly twice the
 * preview's width, and a fat soft ring instead of the fine edge of a mouth. The
 * fraction moved so the world-unit width did not.
 */
export const COHORT_FACE_RIM_W = 0.1875;

/**
 * How hard the rim burns, before the knee.
 *
 * ⭐⭐⭐ THE BRIGHT LIP IS THE MEDIUM ITSELF, WHICH IS WHY THIS IS 0.42 AND NOT
 * 1.05. The approved preview's DRAWN lip (`lipAmp` 0.42 in the lab's mouth) is
 * faint: what makes the edge of the mouth bright there is the mist PILING UP at
 * it — `uConc * (R / r)³` on the patch, the area compression a 2-D sink applies
 * to a parcel — and the drawn ring is only the thin edge that light sits on.
 * The branch shipped 1.05 because T2b re-based the radii and deliberately left
 * every amplitude alone: changing both in one commit would have made the
 * supremum re-measurement uninterpretable. It measured what the deferral cost —
 * at the lip the face peaks at 2.86 pre-knee against the window's 1.44, where
 * the preview's faint lip is ~0.6 against the same 1.44 — and handed the number
 * here, to the commit that mounts the mist. So the ring comes down to the
 * preview's value in the same change that adds the medium whose pile is the
 * rest of it, and the mouth stops being a ring with a hole in it.
 *
 * ⭐ WHAT THE DROP BOUGHT, MEASURED over the same 700-camera sweep: face
 * supremum 0.878861 → **0.808959** and the blue sum 0.925777 → **0.807773**,
 * while the aura's is bit-identical (the halo never reads `uRimAmp`). Additive
 * headroom 0.0742 → **0.1922**, which is the clearance the mist arrives into.
 *
 * ⚠️ It is still a live knob (`cohortRimAmp`). The live leg of 2026-09-02
 * captured the elevation series with the pile drawn under the lip and left the
 * verdict to the user rather than issuing one; nothing here was retuned.
 */
export const COHORT_FACE_RIM_AMP = 0.42;

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
 * Fill just outside the rim, so the hole is an opening in a LIT SURFACE and not
 * a gap between two rings.
 */
export const COHORT_FACE_INTAKE_CORE = 0.6;

/**
 * Width of that fill, as a fraction of the rim radius.
 *
 * ⚠️⚠️ IT IS BOUNDED ABOVE BY THE MARK'S OWN SILHOUETTE, and the bound BINDS.
 * The skirt reaches exactly zero at the disc's edge because `(1 - uu)^gamma`
 * does; the fill is a Gaussian and only ever approaches zero, so if it is still
 * measurable where the fragment discards, the mark ends on a hard circular cut
 * — the one failure `COHORT_FACE_INTAKE_GAMMA`'s own comment is about.
 *
 * ⭐ THE BOUND IS ARITHMETIC. The skirt band is `outer - 1 = uApR / rimR - 1`
 * wide in rho, which is 0.875 now that the hole is 1.6 wu (it was 2.571 when
 * the hole was 0.84, which is why nobody had to think about this before). The
 * face's own light at the edge is `uInAmp * uInCore * exp(-(0.875 / w)²) *
 * (1 + uSwell)`, and it must land under the 0.0018 discard: that gives
 * `w < 0.369`. 0.35 clears it with margin — 0.00097 against 0.0018 — so the
 * disc still dies below its own threshold rather than at it.
 */
export const COHORT_FACE_INTAKE_FILL_W = 0.35;

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

/* ----------------------------------------------------- the window in the face */

/**
 * ⭐⭐⭐ THE PUPIL IS A WINDOW, AND WHAT IS SEEN THROUGH IT IS THE OTHER WORLD.
 *
 * The peer mesh is the boundary between two universes: above it the cell
 * canopy, below it the one a cohort drinks from. A cohort is a HOLE in that
 * membrane, and R19 drew the hole as a refusal — bright structure declining to
 * fill the middle. That was honest and it was also empty: a viewer at the
 * default camera saw a ring and had no way to tell a hole from a doughnut.
 *
 * The window is what the hole SHOWS: the throat's wall, lit from below by what
 * is rising in it, and above a certain depth the medium's own surface. It is
 * the R22 form, approved on the live preview of 2026-09-02, and it is what
 * makes 「从下方汲取能量」 sayable at last. ⛔ Note what it still is NOT: nothing
 * is drawn UNDER the plane by this material and nothing is drawn above it. The
 * window is a rendering of the inside of the aperture, on the aperture's own
 * quad, and the only reason it reads as depth is the view ray's crossing.
 *
 * ⚠️ THE PUPIL IS NO LONGER UNLIT, AND THAT IS THE ONE INVARIANT THIS ROUND
 * MOVES ON PURPOSE. What survives, and is pinned instead, is stronger: the
 * face's OWN structure — rim, skirt, grain — still reaches EXACTLY zero inside
 * the pupil, and every photon in there belongs to `COHORT_INTERIOR_COLD`, a
 * colour no other draw in the peer plane wears. The middle is still not the
 * network's; it now says whose it is.
 */

/**
 * How far below the lip the other world's medium stands, in world units.
 *
 * ⭐⭐⭐ ONE CONSTANT, TWO CONSUMERS, AND THEY MUST NEVER BECOME TWO NUMBERS.
 * This is the depth at which the window stops showing wall and starts showing
 * surface, and it is ALSO the top of the mist's mound under the same cohort
 * (`makeCohortIntakePatchMaterial` in `materials/colonyMist`, drawn by
 * `ColonyCohorts` beside this mark): the patch of mist below the plane is
 * lifted into a gentle mound whose summit is exactly what the hole shows. If
 * the two ever drift, a viewer looking into the mouth sees a surface at one
 * height and a viewer looking at the mist beside it sees another, and the two
 * draws stop being one substance.
 *
 * 0.7 wu, from the approved preview (`mouth.level` in the lab's `field: mist`
 * scene). The live knob is `cohortLevel`, and it writes `uLevel` on the FACE
 * and on the PATCH in the same frame off one read — which is why the number
 * lives here rather than in either material.
 *
 * ⭐ MEASURED 2026-09-02, AND EVERY COHORT SHOWS MEDIUM AT THE APP CAMERA. At
 * this level the window first leaves wall at 13° of elevation over the pupil's
 * centre (the exact boundary `atan((level − 0.35) / R)` is 12.34°); live, the
 * production camera stands 19.0–50.4° above all six of the colony's cohorts, so
 * none of them shows only wall. Not retuned.
 */
export const COHORT_INTAKE_LEVEL = 0.7;

/**
 * The other world's colour: the register nothing on the peer plane wears.
 *
 * ⚠️ IT IS DELIBERATELY NOT A `PEER_NETWORK_PALETTE` TOKEN, and the nearest one
 * was measured rather than eyeballed: `inbound` is (0.369, 0.725, 1.0) against
 * this (0.45, 0.80, 1.0) — about 8 % apart in red and green, so borrowing it
 * would have been visually defensible. It is refused for a semantic reason. The
 * peer palette's five tokens all name roles INSIDE the peer plane (the
 * scaffold, an outbound link, an inbound one, a version, the hot end), and this
 * colour's whole job is to belong to the universe on the other side of that
 * plane. Naming it `inbound` would tell the next reader that the light in the
 * pupil is a peer-link fact, and would tie the other world's register to the
 * link grammar so that a future retune of one moved the other.
 *
 * ⭐ Its BLUE IS EXACTLY 1.0, like `scaffold` and `coldWhite`, which is what
 * keeps the additive ceiling's arithmetic (see `COHORT_AURA_KNEE`) unchanged:
 * every colour this layer can emit is full in blue, so the binding channel is
 * still `shapeFace² + shapeAura²` and the Pythagorean pair still bounds it.
 *
 * The value is the approved preview's `mouth.cold`, with `warmth` at 0 — the
 * lab could lerp it toward the HUD's chrome orange and the user left it cold.
 */
export const COHORT_INTERIOR_COLD: SceneColor = [0.45, 0.80, 1.0];

/** How hard the medium's surface burns, seen through the hole. Lab: 1.15. */
export const COHORT_FACE_INTERIOR_AMP = 1.15;

/**
 * The medium's feature size, in cycles per world unit of the sampling plane.
 *
 * ⭐ IT IS THE LAB'S NUMBER ON THE LAB'S HOLE, WHICH IS WHY IT IS UNCHANGED.
 * This comment used to argue the opposite — that a 0.521 wu pupil against the
 * lab's 1.6 carried about four lobes where the lab carried seven, and that the
 * scale might want doubling. That was a symptom of a DIAMETER read as a RADIUS:
 * once the hole was re-based to the lab's own 1.6 wu, the feed re-measured at
 * 7.04 lobes against the lab's 7. Nothing to compensate. There is no knob on
 * this constant, deliberately — the medium's feature size is a statement about
 * the substance, not a taste to settle against pixels.
 */
export const COHORT_FACE_INTERIOR_SCALE = 0.55;

/** How fast the medium rises toward the lip, in zoom doublings per second. */
export const COHORT_FACE_RISE = 0.16;

/** How fast it churns, sideways, while it rises. */
export const COHORT_FACE_BOIL = 0.35;

/** How hard the throat's wall is lit from below, before the window's own 0.55. */
export const COHORT_FACE_WALL_AMP = 0.85;

/**
 * Flutes around the throat's wall.
 *
 * ⚠️ AN INTEGER, AND THE SEAM IS WHY. The wall's grain is a function of the
 * azimuth `phi ∈ (-π, π]`, so anything but a whole number of cycles around the
 * throat leaves a discontinuity down one side of the hole. The lab got this for
 * free from a repeating texture whose span happened to be integral; here it is
 * a pair of cosines, and the constant has to carry the property itself.
 */
export const COHORT_FACE_WALL_GRAIN = 26;

/* -------------------------------------------------------- the gulp, on a block */

/**
 * The lane's "this cohort has never won" sentinel, in sim seconds.
 *
 * ⚠️⚠️⚠️ ZERO WOULD READ AS "WON AT BOOT" AND FLARE EVERY COHORT ON LOAD. R16
 * paid for that once: an unfilled `Float32Array` is all zeros, `uTime` starts at
 * zero, and the envelope below is evaluated at `age = uTime - 0` — which is
 * exactly the peak of the gulp for the first half second of every session, on
 * every cohort at once, for a block none of them mined.
 *
 * ⭐ AND IT IS FAR-NEGATIVE RATHER THAN MERELY NEGATIVE, so no reachable
 * `uTime` can walk back into the envelope's live band. At -1e6 the age is a
 * million seconds — eleven days of sim time — before the envelope's `exp(-age /
 * 0.45)` is anything but a denormal, and `exp(-2.2e6)` is zero in float32
 * outright. `cohortGulp.test.ts` pins it as exactly 0 over `uTime ∈ [0, 1e5]`.
 */
export const COHORT_NEVER_WON = -1e6;

/** Decay of the gulp, in seconds: how long the flare takes to leave. */
export const COHORT_GULP_FALL = 0.45;

/** Attack of the gulp, in seconds: how long it takes to arrive. */
export const COHORT_GULP_RISE = 0.06;

/** How much the gulp lifts the interior at its peak. Lab: 2.2. */
export const COHORT_GULP_INTERIOR = 2.2;

/** How much it lifts the lip. Lab: 1.6 — less, so the mouth reads as SWALLOWING
 *  rather than as flashing. */
export const COHORT_GULP_LIP = 1.6;

/**
 * The gulp envelope, as ONE string, leaving `gulp` in scope.
 *
 * ⭐ A SHARED SNIPPET BECAUSE THE MIST WILL WANT THE SAME CURVE. The mouth and
 * the patch of mist under it gulp on the same block, and two hand-copied
 * envelopes would drift apart the first time either was tuned. It needs `uTime`
 * and `vGulp` in scope and nothing else.
 *
 * ⭐ IT IS EXACTLY ZERO FOR A NEGATIVE AGE, which is what makes
 * `COHORT_NEVER_WON` a sentinel rather than a very old win: the `age > 0.0`
 * branch is what a cohort that has never mined takes, at every `uTime`.
 */
export const COHORT_GULP_GLSL = /* glsl */ `float gulpAge = uTime - vGulp;
        float gulp = gulpAge > 0.0
          ? exp(-gulpAge / ${COHORT_GULP_FALL.toFixed(2)})
            * (1.0 - exp(-gulpAge / ${COHORT_GULP_RISE.toFixed(2)}))
          : 0.0;`;

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

/**
 * Halo radius, as a multiple of `COHORT_AP_R` — 4.05 wu at the shipped size.
 *
 * ⚠️ MEASURED AGAINST THE PREVIEW AND LEFT ALONE, WHICH IS A REPORTED CHOICE
 * RATHER THAN AN OVERSIGHT. The lab's skirt reaches 2.6 wu — 1.63x its own
 * 1.6 wu hole — while this one reaches 4.05, which is 2.53x the same hole. The
 * two are not the same parameter: the lab's face draws ONLY a lip, so its skirt
 * is sized against the lip, and this face carries R19's intake skirt out to
 * `COHORT_AP_R`, so its halo is sized against the MARK — 1.35x the disc, which
 * is the relationship R19 measured and which the re-basing did not touch. It is
 * a live knob (`cohortHaloR`) and a look call; the live leg judges it with the
 * ratio above in hand rather than a guess being made here.
 */
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
 *
 * ⚠️ IT CAME DOWN FROM 1.35 WHEN THE HOLE WAS RE-BASED, and the sign of the
 * change is the whole point. A scale ABOVE one made sense against an 0.52 wu
 * pupil: the halo had to be kept a little clear of a very small hole or it
 * flooded it. Against a 1.6 wu hole the same 1.35 puts the cut at 2.16 wu —
 * 0.56 wu OUTSIDE the lip — and carves a dark annulus out of the glow beyond
 * the mark's own edge, which is not a hole, it is a bite. The preview cuts at
 * `uRimR * 0.95`: the halo comes up exactly at the lip. This is that number.
 *
 * ⚠️ The branch cuts to ZERO where the preview cuts to 0.22, and that stays —
 * it is the law `the aura's hole is the SAME hole` sweeps at every camera. The
 * cost is measured and reported rather than hidden: with the hole tripled, the
 * halo's core term now falls almost entirely inside the cut, so the aura's
 * brightest surviving pixel is at the cut's edge rather than at its centre.
 */
export const COHORT_AURA_PUPIL_SCALE = 0.95;

/** How far the halo tips toward cold white. Far less than the rim: the halo is
 *  support, and a white halo would compete with the structure it supports. */
export const COHORT_AURA_HOT_MIX = 0.1;

/**
 * A second, tighter term added to the halo's profile — the peer sprite's own
 * core, which the skirt alone does not have.
 *
 * ⭐ IT IS A GRAMMAR TIE AND NOT A BRIGHTNESS TWEAK. Every measured peer in
 * this scene is drawn as a core inside a skirt; a cohort drawn as a skirt alone
 * is the one stop in the colony built to a different rule, and at range that is
 * exactly what it looked like. The hole then takes the core straight back out
 * of the middle, so what survives is a peer's own profile with the pupil
 * removed — which is precisely the claim the mark is making.
 */
export const COHORT_AURA_CORE_AMP = 0.6;

/** Fall-off of that core term. Sharper than the skirt's, which is what makes it
 *  a core rather than a second skirt. */
export const COHORT_AURA_CORE_EXP = 3.2;

/**
 * How far the halo is lifted when the colony plane is seen nearly edge-on.
 *
 * ⭐⭐ THE FACE CLOSES TO A SLIT AT A LOW CAMERA, AND SOMETHING HAS TO CARRY THE
 * MARK THERE. A disc lying in the plane has zero projected area at zero
 * elevation, so below roughly 15° the face is a bright horizontal sliver
 * indistinguishable from a peer link. The halo is view-independent and is the
 * only thing left; at the elevations where it is the whole mark it is allowed
 * to be 2.6x itself. Above `|dir.y|` 0.55 (33° of elevation) the boost is gone
 * entirely and the face is doing the work again.
 */
export const COHORT_AURA_LOW_BOOST = 2.6;

/** Where the low-elevation boost begins to fade, in `|dir.y|`. */
export const COHORT_AURA_LOW_BOOST_IN = 0.05;

/** Where it is completely gone. */
export const COHORT_AURA_LOW_BOOST_OUT = 0.55;

/**
 * How far the halo BELOW the plane wears the other world's colour.
 *
 * ⭐ THE HALO STRADDLES THE MEMBRANE, so it is the one draw in this layer that
 * can say which side is which without drawing anything new. Above the plane it
 * is the network's cyan; below it, it tips toward `COHORT_INTERIOR_COLD` — the
 * same colour the window shows through the hole. The cue costs no silhouette,
 * exactly like `COHORT_AURA_HALO_BIAS` beside it, and it vanishes from overhead
 * on its own, where "below" is not a direction a viewer can see.
 */
export const COHORT_AURA_UNDER_TINT = 0.8;

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
 * expensive should be. Measured, the SUM has moved with the mark and the
 * theorem has not: 0.850 in blue when the pair was introduced, 0.925777 once
 * the window landed in the hole, and **0.807773** now that the lip is the
 * preview's 0.42 — `cohortAperture.test.ts` re-sweeps it on every run, so the
 * number in this comment is never the only copy.
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
 * radius without moving the aura's, and the one hole would become two. ⭐ THE
 * WINDOW LEANS ON THE SAME ASSUMPTION FOR THE SAME REASON: the vertex stage
 * takes the TRANSPOSE of `mat3(modelMatrix * instanceMatrix)` as its inverse to
 * put the camera in the instance's own plane coordinates, which is exact for a
 * rotation about Y and wrong for anything else.
 *
 * `aSeed` is the same per-instance lane the other faces read. `aGulp` is the
 * new one: the SIM SECOND of the block this cohort won, or `COHORT_NEVER_WON`
 * for a cohort that has never won one, stamped by `ColonyCohorts` against the
 * flood's entry id. ⚠️ It is on the same clock `uTime` is — `simClock.elapsedSec`
 * — because the envelope is `uTime - aGulp` and two clocks would make that
 * difference meaningless. There is still NO `aShare`
 * lane: share means rate on this layer, and neither aperture program has a rate
 * share could drive that survives the grain's own prefilter.
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
      uInCoreW: { value: COHORT_FACE_INTAKE_FILL_W },
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
      // ---- the window, and what it shows
      uInterior: {
        value: new THREE.Color().setRGB(...COHORT_INTERIOR_COLD),
      },
      uLevel: { value: COHORT_INTAKE_LEVEL },
      uRise: { value: COHORT_FACE_RISE },
      uBoil: { value: COHORT_FACE_BOIL },
      uInteriorAmp: { value: COHORT_FACE_INTERIOR_AMP },
      uInteriorScale: { value: COHORT_FACE_INTERIOR_SCALE },
      uWallAmp: { value: COHORT_FACE_WALL_AMP },
      uWallGrain: { value: COHORT_FACE_WALL_GRAIN },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aGulp;

      uniform float uHalf;

      varying vec2 vP;
      varying vec3 vCam;
      varying vec3 vOrigin;
      varying float vSeed;
      varying float vGulp;

      void main() {
        vSeed = aSeed;
        vGulp = aGulp;
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
        // ⭐⭐ THE CAMERA, IN THE INSTANCE'S OWN PLANE COORDINATES — which is
        // what lets the window do its ray arithmetic in the frame the disc is
        // drawn in, so the throat and its wall turn with the plate exactly as
        // the grain does. The colony group carries a ROTATION ABOUT WORLD Y and
        // nothing else (no scale anywhere on the path, and the instance matrix
        // is a pure translation), so this basis is orthonormal and its
        // TRANSPOSE is its inverse — three dot products against the columns.
        // ⚠️ That is the same assumption length(vP) already rests on: a scaled
        // instance would move the face's radius without moving the aura's, and
        // one hole would become two.
        mat3 frame = mat3(modelMatrix * instanceMatrix);
        vec3 toCam = cameraPosition - origin.xyz;
        vCam = vec3(dot(frame[0], toCam), dot(frame[1], toCam), dot(frame[2], toCam));
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
      uniform float uInCoreW;
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
      uniform vec3 uInterior;
      uniform float uLevel;
      uniform float uRise;
      uniform float uBoil;
      uniform float uInteriorAmp;
      uniform float uInteriorScale;
      uniform float uWallAmp;
      uniform float uWallGrain;

      varying vec2 vP;
      varying vec3 vCam;
      varying vec3 vOrigin;
      varying float vSeed;
      varying float vGulp;

      const float TAU = 6.28318530718;

      // Lattice cells per unit of the medium's sampling coordinate. ⭐ IT IS
      // THE LAB'S TILE, WRITTEN OUT: the preview drew this medium from a 256²
      // value-noise texture whose two coarsest channels hold 8 and 16 cells
      // across the tile, sampled in UV. The same two frequencies are stated
      // here so the port is a change of MECHANISM and not of look.
      const float MEDIUM_CELLS = 8.0;

      float sq(float x) { return x * x; }

      // ---- the other world's medium --------------------------------------
      //
      // ⭐⭐ A HASH RATHER THAN A SAMPLER, DELIBERATELY. The medium below the
      // plane has to be uneven or the window reads as a lit disc, and the lab
      // fetched it from a 256² tile. A texture here would make this the only
      // sampled draw in the peer plane — one of the five register violations
      // the mark this replaced was retired for — and it would also hand this
      // material an asset to own, dispose and share with the mist layer that
      // has not been written yet. Bilinear value noise is what that tile
      // CONTAINED, so it is written out instead: same construction, same two
      // frequencies, no asset.
      //
      // ⚠️ IT IS PAID FOR ONLY WHERE IT SHOWS. The medium is evaluated inside
      // the pupil (3 % of the disc) and again on the lip's own Gaussian, and
      // nowhere else — see the two guards in main().
      float hashOne(vec2 p) {
        vec3 q = fract(p.xyx * 0.1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }

      float lattice(vec2 p) {
        vec2 cell = floor(p);
        vec2 f = p - cell;
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hashOne(cell);
        float b = hashOne(cell + vec2(1.0, 0.0));
        float c = hashOne(cell + vec2(0.0, 1.0));
        float d = hashOne(cell + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      // Ridged, RISING and churning: features expand toward the eye, with two
      // zoom phases cross-faded so the octave's reset is never seen, while a
      // slow drift slides the whole thing sideways. It exists nowhere in this
      // scene except inside a hole.
      float otherMedium(vec2 p, float seed) {
        float ph = uTime * uRise;
        float zA = exp2(fract(ph));
        float zB = exp2(fract(ph + 0.5));
        float wA = 1.0 - abs(2.0 * fract(ph) - 1.0);
        vec2 drift = vec2(0.13, 0.07) * uTime * uBoil + seed * 7.0;
        vec2 pa = p * uInteriorScale / zA + drift;
        vec2 pb = p * uInteriorScale / zB + drift * 0.8 + 0.37;
        float na = lattice(pa * MEDIUM_CELLS) * 0.62
          + lattice((pa * 2.1 + 0.2) * MEDIUM_CELLS * 2.0) * 0.38;
        float nb = lattice(pb * MEDIUM_CELLS) * 0.62
          + lattice((pb * 2.1 + 0.2) * MEDIUM_CELLS * 2.0) * 0.38;
        float n = mix(nb, na, wA);
        // ⚠️ The max() is not decoration: a negative base is UNDEFINED for
        // GLSL's power function, and the file's own guard refuses a base it
        // cannot prove non-negative. The expression is in [0, 1] by
        // construction; the clamp makes that visible to a reader and a parser.
        return pow(max(1.0 - abs(2.0 * n - 1.0), 0.0), 1.6);
      }

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
        float fill = uInCore * exp(-sq((rho - 1.0) / max(uInCoreW, 0.02)));

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

        // ---- the block this cohort won, if it has ever won one.
        ${COHORT_GULP_GLSL}

        // ---- THE WINDOW: what the hole SHOWS. --------------------------------
        // ⭐⭐⭐ THE PUPIL IS NOT UNLIT ANY MORE — it is a window onto the other
        // world, and the face's own structure is still exactly zero in there
        // (pupil multiplies it and reaches zero). Every photon below belongs
        // to uInterior, a colour no other draw in the peer plane wears.
        float pupR = rimR * pup;
        float interior = 0.0;
        if (r < pupR) {
          // The view ray, IN THE INSTANCE'S OWN PLANE. vCam is the camera
          // expressed in the same basis vP is, so the whole window turns with
          // the plate and its wall does not slide as the colony rotates.
          vec3 dir = normalize(vec3(vP.x, 0.0, vP.y) - vCam);
          float lxz = length(dir.xz);
          vec2 e = lxz > 1e-5 ? dir.xz / lxz : vec2(0.0, 1.0);
          float tanEl = abs(dir.y) / max(lxz, 1e-5);
          // Continue the ray past the plane and meet the throat's cylinder;
          // the depth it reaches is the hit distance times tan(elevation). The
          // FAR side of the hole shows wall under the lip, the near side looks
          // away down the shaft — which is why this needs the ray and not the
          // radius.
          float b = dot(vP, e);
          float t = -b + sqrt(max(b * b + pupR * pupR - r * r, 0.0));
          float h = t * tanEl;
          vec2 hitP = vP + e * t;
          float phi = atan(hitP.y, hitP.x);
          // The wall's own grain: uWallGrain flutes around the throat, CLIMBING
          // toward the lip — the wall says which way the medium is going even
          // where the medium itself is not yet in view. 0.35 wu/s is the lab's
          // own rate, read off its tile (0.030 UV/s against 0.085 UV/wu).
          // ⚠️ COSINES AND NOT THE LATTICE, because a value-noise lattice does
          // not close on itself around a circle and would leave a seam down one
          // side of the hole; a whole number of cycles around does.
          float hw = h + uTime * 0.35;
          float g = 0.5 + 0.5 * (
            0.62 * cos(phi * uWallGrain + vSeed * TAU + hw * 3.0)
            + 0.38 * cos(phi * uWallGrain * 0.5 - vSeed * 4.1 + hw * 7.0)
          );
          // The wall, LIT FROM BELOW: dark at the lip, brighter the deeper the
          // ray reaches, because what is lighting it is down there.
          float lit = (1.0 - exp(-h / max(uLevel, 0.05)))
            * (0.55 + 0.6 * g) * uWallAmp * 0.55;
          // ⭐ And past the medium's own level the ray stops meeting wall and
          // meets SURFACE. The band is 0.7 wu wide about uLevel, so the two
          // cross-fade rather than switching.
          float seeMedium = smoothstep(uLevel - 0.35, uLevel + 0.35, h);
          // Where the ray meets that level, in the plane: the point of the
          // medium this fragment is actually looking at.
          vec2 mp = vP + e * (uLevel / max(tanEl, 0.06));
          float m = otherMedium(mp, vSeed);
          float surf = (0.30 + 0.95 * m) * uInteriorAmp
            * (1.0 + ${COHORT_GULP_INTERIOR.toFixed(1)} * gulp);
          // The near lip stands in front of the far wall: the throat darkens
          // into the edge of the hole rather than ending at it. ⭐ It is written
          // as a FRACTION so it follows the cohortApR knob — and now that the
          // hole is the preview's own 1.6 wu, 0.1375 of it is 0.22 wu EXACTLY,
          // which is the absolute band the preview uses. The two agree because
          // the radius does; when the hole was 0.52 wu they could not.
          float shade = smoothstep(0.0, pupR * 0.1375, pupR - r);
          interior = mix(lit, surf, seeMedium) * shade;
        }

        // ---- the lip is fed by WHAT ARRIVES AT IT, so it is uneven, and it
        // flares when the mouth swallows a block.
        // ⚠️ Guarded on the rim's own Gaussian: feed costs the medium's whole
        // evaluation and the rim is under a thousandth outside rho 0.11–1.89,
        // which is 72 % of the disc. The step at that boundary is at most
        // 0.001 * uRimAmp * 0.45 = 5e-4 of a shape that is 1.2 there.
        float lipFeed = 1.0;
        if (rim > 0.001) {
          vec2 nrm = r > 1e-4 ? vP / r : vec2(1.0, 0.0);
          float feed = otherMedium(nrm * rimR, vSeed);
          lipFeed = (0.55 + 0.9 * feed)
            * (1.0 + ${COHORT_GULP_LIP.toFixed(1)} * gulp);
        }

        float breathe = 1.0 - uBreatheDepth
          + uBreatheDepth * sin(uTime * uBreatheHz + vSeed * TAU);
        // ⭐ THE FACE'S OWN STRUCTURE, WHICH STILL REACHES EXACTLY ZERO INSIDE
        // THE PUPIL. pupil gates it and nothing else; the interior is ADDED
        // outside that gate, which is what makes the middle the other world's
        // rather than a dimmer version of this one's.
        float structure = (rim * uRimAmp * lipFeed + intake) * pupil;
        float shape = (structure + interior) * uAmp * breathe;
        if (shape < 0.0018) discard;
        // ⭐ A KNEE AND NEVER A SCALE. See COHORT_AURA_KNEE for why the aura's
        // is the Pythagorean partner of this one.
        shape = uKnee * (1.0 - exp(-shape / uKnee));
        ${COHORT_CONTEXT_ENERGY_GLSL}
        // ⭐ TWO REGISTERS, SPLIT BY THE INTERIOR'S OWN SHARE OF THE LIGHT. The
        // knee is applied to the TOTAL — one draw, one alpha, one ceiling — and
        // the colour is the convex mix the two terms earned. Every colour in
        // that mix is full in blue, so the additive ceiling's arithmetic is
        // exactly the one COHORT_AURA_KNEE states.
        float otherShare = clamp(interior / max(structure + interior, 1e-4), 0.0, 1.0);
        vec3 tint = mix(
          mix(uColor, uHot, uHotMix * rim * pupil),
          uInterior,
          otherShare
        );
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
 * searchlight this whole form exists to stop being. It is not in this file. The
 * quad does STRADDLE the plane — it faces the camera — and the half of it below
 * wears the window's colour (`COHORT_AURA_UNDER_TINT`), which is a tint on a
 * glow that already exists and adds no silhouette at all.
 *
 * `aSeed` is the same per-instance lane the face reads, and there is no
 * `aShare` lane — see `makeCohortFaceMaterial`. ⭐ NOR `aGulp`: the skirt is the
 * mark's support at a low camera, and a support that flared on the win would be
 * a second opinion about an instant the mouth and `ColonyEdges` already state.
 * One lane, one consumer, and the aura's row in the attribute budget stays at
 * the face's old width.
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
      // ---- the peer's own core, the low camera, and the world underneath
      uCoreAmp: { value: COHORT_AURA_CORE_AMP },
      uCoreExp: { value: COHORT_AURA_CORE_EXP },
      uLowBoost: { value: COHORT_AURA_LOW_BOOST },
      uUnderTint: { value: COHORT_AURA_UNDER_TINT },
      uInterior: {
        value: new THREE.Color().setRGB(...COHORT_INTERIOR_COLD),
      },
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
      uniform float uCoreAmp;
      uniform float uCoreExp;
      uniform float uLowBoost;
      uniform float uUnderTint;
      uniform vec3 uInterior;

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
        // ⭐ A CORE INSIDE A SKIRT — the profile every measured peer in this
        // scene is drawn with. A cohort drawn as a skirt alone was the one stop
        // in the colony built to a different rule. The hole below then takes
        // the core straight back out of the middle, so what survives is a
        // peer's own profile with its pupil removed.
        float halo = pow(1.0 - hx, max(uHaloExp, 0.2))
          + pow(1.0 - hx, max(uCoreExp, 0.2)) * uCoreAmp;
        // ⭐⭐ AND IT IS LIFTED WHERE IT IS THE WHOLE MARK. Below roughly 33° of
        // elevation the face — a disc lying IN the plane — has almost no
        // projected area left, so the halo is all there is; between there and
        // 3° it is allowed to be uLowBoost times itself. Above the band it is
        // exactly what it always was.
        halo *= mix(
          1.0,
          uLowBoost,
          1.0 - smoothstep(
            ${COHORT_AURA_LOW_BOOST_IN.toFixed(2)},
            ${COHORT_AURA_LOW_BOOST_OUT.toFixed(2)},
            abs(rd.y)
          )
        );

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
        // ⭐ THE HALO STRADDLES THE MEMBRANE, so it is the one draw here that
        // can say which side is which without drawing anything new: above the
        // plane it is the network's cyan, below it tips toward the colour the
        // window shows through the hole. It costs no silhouette — a gradient
        // inside a glow that is already there — and it vanishes from overhead
        // on its own, where "below" is not a direction a viewer can see.
        float under = 1.0 - smoothstep(-0.55, 0.15, dy / hR);
        vec3 tint = mix(mix(uColor, uHot, uHotMix), uInterior, under * uUnderTint);
        gl_FragColor = vec4(tint * shape * cohortEnergy, shape);
      }
    `,
  });
}
