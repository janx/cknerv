/**
 * What every draw a POW cohort makes has to agree about, and nothing else.
 *
 * ⭐⭐⭐ THE MARK IS COMPUTED NOW, AND THIS FILE IS WHAT SURVIVED THAT. Until
 * 2026-09-03 this was the APERTURE: a disc lying in the colony plane
 * (`makeCohortFaceMaterial`), a camera-facing halo carrying the same hole
 * (`makeCohortAuraMaterial`), the window into the other world, the drawn lip,
 * the 88 striae and the twelve radii they were all fractions of. Seven rounds
 * of that hand-built form reached a ceiling the user named: it never looked
 * like the film. The reason is structural and is on record in `colonyLens.ts` —
 * Gargantua's image is a CONSEQUENCE of light bending around a mass, and a
 * stack of independently mapped parts cannot converge on shapes it does not
 * contain. So the mark is now one ray-traced quad per cohort (`colonyLens.ts`)
 * plus the specks falling into it (`colonyMotes.ts`), and the aperture, its
 * aura and the mist patch that was drawn under it are all gone, with every
 * constant that existed only for them.
 *
 * ⛔ DO NOT BRING ANY OF IT BACK PIECEWISE. `COHORT_AP_R`, `COHORT_RIM_R`, the
 * pupil fraction, the striae, the two knees, `COHORT_INTAKE_LEVEL`, the
 * interior colour and both quad-extent functions were deleted rather than
 * deprecated: every one of them named a part of a picture that is no longer
 * assembled from parts, and a lens program that grew a "rim amplitude" would be
 * the composed form creeping back in through a knob.
 *
 * What is left here is what MORE THAN ONE program has to say identically, and
 * it is exactly two things:
 *
 * 1. **The gulp** — the sim second of the block a cohort won, the envelope over
 *    it, and the sentinel a cohort that has never won carries. The lens spends
 *    it in its fragment (the disc piles at the lip) and the motes in their
 *    vertex (every speck flares), so the curve is ONE string compiled twice.
 * 2. **The proximity exemption** — a cohort keeps its light when the camera
 *    comes to it, against the passive-peer damping every other draw in the
 *    colony obeys. Same argument: one string, two programs, RGB only.
 *
 * ⛔⛔⛔ AND THE STANDING RULE THE WHOLE FEATURE IS BUILT ON, restated here
 * because this is the file every program in it imports. THE COHORT NEVER EMITS
 * UPWARD, AT ANY TIME. A mined block goes SIDEWAYS TO PEERS ONLY, because peers
 * must verify it before it legitimately enters the cell galaxy;
 * `BlockDeliveryLayer` draws that later leg from MEASURED WORKERS on flood
 * arrivals and never from a cohort (`planDeliveries` emits a carrier only for
 * ids in `cf.arrivals`, and the flood derive writes an arrival only where
 * `kind === 'measured'`, which an attested cohort is not). ⚠️ Three successive
 * plans said "the block leaves ABOVE and outward" from here; they were wrong,
 * and the rule is written positively so the next reader inherits it and not the
 * misconception.
 */

/* -------------------------------------------------------------------------- *
 * The proximity exemption — shared by every cohort program.
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
 * three.js built-in and is in world space in BOTH stages.
 *
 * ⭐ IT READS THE MARK'S ORIGIN AND NEVER THE FRAGMENT'S OWN POINT. The lens's
 * quad is 64 wu across and a mote falls 27 wu from its seat, so a per-pixel
 * distance would bring one end of a mark up ahead of the other and fade one
 * cohort's disc apart from the specks inside it. One distance per mark, and
 * every program reads that one.
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
 * carries no privilege at all; what distinguishes it there is the keep-out's
 * 3.5 wu of open plane, against a sighted peer's 1.5.
 */
export const COHORT_CONTEXT_EXEMPT_FAR = 150;

/**
 * The exemption itself, as ONE string pasted into every program that draws a
 * cohort.
 *
 * ⭐ ONE STRING AND TWO USE SITES, SO THE DISC AND THE SPECKS IN IT CANNOT
 * DRIFT APART. They are one mark: a vortex that came up while the motes falling
 * through it stayed damped would be a worse artefact than the bug this fixes.
 * `cohortContextEnergy.test.ts` asserts this exact text is inside both.
 *
 * It needs `uContextEnergy` and `vOrigin` in scope and leaves `cohortEnergy`
 * there. ⚠️ `vOrigin` is a VARYING in the lens's fragment and a LOCAL in the
 * motes' vertex stage — the same name bound to the same fact, the mark's world
 * seat, in the stage each program can afford it in. Every fragment multiplies
 * `cohortEnergy` into RGB and NEVER into alpha: on the motes that is the house
 * idiom for keeping additive damping linear, and on the lens it also means a
 * damped mark still OCCLUDES exactly as much as an undamped one, which is
 * right — the hole is a fact about the colony, not about what the HUD is
 * currently interested in.
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

/**
 * How much the gulp lifts the substance at its peak. Lab: 2.2.
 *
 * ⚠️ IT LIFTS THE DISC'S PILE NOW AND NOT A WINDOW'S INTERIOR. The name is the
 * lab's and the number is the lab's; what reads it is `colonyLens.ts`'s pile
 * term, where the block a cohort won arrives as more material crossing the
 * lip. Its old partner `COHORT_GULP_LIP` (1.6, the drawn ring's own share of
 * the flare) went with the ring: the lensed form has no drawn ring to lift.
 */
export const COHORT_GULP_INTERIOR = 2.2;

/**
 * The gulp envelope, as ONE string, leaving `gulp` in scope.
 *
 * ⭐ A SHARED SNIPPET BECAUSE EVERY DRAW OF A COHORT WANTS THE SAME CURVE. The
 * disc and the specks falling through it gulp on the same block, and two
 * hand-copied envelopes would drift apart the first time either was tuned. It
 * needs `uTime` and `vGulp` in scope and nothing else.
 *
 * ⚠️ `vGulp` IS NOT ALWAYS A VARYING. The lens spends the gulp in its fragment,
 * where the lane must arrive across the interpolator; the motes spend it in the
 * VERTEX stage, where `aGulp` is already in scope, so that program binds the
 * name to a local (`float vGulp = aGulp;`) rather than carrying it across for
 * nothing. The snippet asks only that the name hold this cohort's stamp.
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
