// The lensed cohort's arithmetic, pinned against physics rather than against
// itself.
//
// ⭐⭐⭐ THIS IS THE ONE FEATURE IN THE SCENE WHOSE PICTURE HAS AN INDEPENDENT
// RIGHT ANSWER. Every other mark in this app is a form somebody chose, and its
// tests can only say "it still does what it did". The lensed cohort computes
// light bending around a Schwarzschild mass, and general relativity says what
// that must come out to: a straight ray where the mass is zero, `4M/b` of bend
// in the weak field, capture at `b = 3√3 M`. So the integrator is checked
// against those, and the picture's own numbers — the fold, the two disc laws,
// the beaming, the redshift — against the plan's table.
//
// ⚠️ THE MIRROR IS THE MATERIAL'S OWN EXPORT AND NOT A COPY. `colonyLens.ts`
// ships `lensRk4Step` and `lensTrace` as TypeScript, the fragment integrates
// the same recurrence statement for statement, and `colonyLensShaderGuards.test.ts`
// pins the GLSL text so the two cannot drift.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  COHORT_DISC_CORE,
  COHORT_DISC_IN,
  COHORT_DISC_MID,
  COHORT_DISC_MID_WARM,
  COHORT_DISC_OUT,
  COHORT_DISC_OUTER,
  COHORT_DISC_OUTER_WARM,
  COHORT_DISC_OUT_FAR,
  COHORT_HORIZON,
  COHORT_HORIZON_FAR,
  COHORT_LENS_BEAM,
  COHORT_HOLE_GATE_HI,
  COHORT_HOLE_GATE_LO,
  COHORT_LENS_FAR_DISC_AMP,
  COHORT_LENS_FAR_DISC_POW,
  COHORT_LENS_FAR_GLOW,
  COHORT_LENS_FAR_GLOW_CORE,
  COHORT_LENS_FAR_GLOW_R,
  COHORT_LENS_FAR_KNEE,
  COHORT_LENS_FAR_STREAK,
  COHORT_LENS_QUAD_R,
  COHORT_LENS_STEP,
  COHORT_LENS_STEPS,
  COHORT_LENS_STEP_CAP,
  COHORT_LENS_STEP_STRETCH_MAX,
  COHORT_LENS_STEP_STRETCH_R,
  COHORT_UNFOLD_HI,
  COHORT_UNFOLD_LO,
  cohortDiscStops,
  lensAdaptiveStep,
  lensBeaming,
  lensCaptured,
  lensCloseness,
  lensDeflection,
  lensDiscInnerEdge,
  lensFarLaw,
  lensFarArms,
  lensFarBody,
  lensFarCatchment,
  lensFarNucleus,
  lensFold,
  lensHoleGate,
  lensNearOuterFade,
  lensRedshift,
  lensRk4Step,
  lensTrace,
  makeCohortLensMaterial,
} from '../../src/materials/colonyLens';
import {
  PEER_CLOUD_SIGHTED_DARK_TONE,
  PEER_CLOUD_SIGHTED_TONE,
} from '../../src/materials/peerNodeMaterial';

/** One horizon, so every impact parameter below reads as a multiple of it. */
const RS = 1;

/* -------------------------------------------------------------------------- *
 * The integrator.
 * -------------------------------------------------------------------------- */

describe('cohort lens — the Binet integrator', () => {
  it('is exactly a straight line when there is no mass', () => {
    // ⭐⭐ THE NULL TEST, AND THE ONLY ONE WITH AN EXACT CLOSED FORM. At M = 0
    // the orbit equation is `u'' = -u`, whose solution `u = sin(phi + phi0)/b`
    // IS a straight line at perpendicular distance `b` — so a ray launched with
    // impact parameter 5 must come no closer than 5 and must leave pointing
    // exactly where it came from. Both to 1e-4, over a 0.11 rad step.
    const trace = lensTrace(5 * RS, RS, { mass: 0 });
    expect(trace.captured).toBe(false);
    expect(trace.closest).toBeCloseTo(5 * RS, 4);
    // The bend is measured as the change of the ray's DIRECTION, so a straight
    // ray reports zero however far out the measurement is taken.
    expect(Math.abs(trace.bend)).toBeLessThan(1e-4);
  });

  it('takes one RK4 step of the harmonic case, and is fourth order doing it', () => {
    // With M = 0 and a ray at its periapsis (u = 1, u' = 0) the exact solution
    // is (cos h, -sin h), so one step's error is the method's local truncation
    // error and nothing else: 4.2e-9 at the shipped step.
    const h = COHORT_LENS_STEP;
    const stepped = lensRk4Step(1, 0, h, 0);
    expect(Math.abs(stepped.u - Math.cos(h))).toBeLessThan(1e-8);
    expect(Math.abs(stepped.up + Math.sin(h))).toBeLessThan(1e-8);
    // ⭐⭐ AND IT IS FOURTH ORDER, WHICH IS THE WHOLE REASON THE LONG STEPS ARE
    // ALLOWED. Halving the step must cut the local error by 2^5 = 32; a
    // second-order method would show 8, and the disc's far edge would visibly
    // under-bend where the step is stretched six times.
    const error = (step: number): number =>
      Math.abs(lensRk4Step(1, 0, step, 0).up + Math.sin(step));
    expect(error(h) / error(h / 2)).toBeGreaterThan(28);
    expect(error(h) / error(h / 2)).toBeLessThan(36);
  });

  it('stretches the step for a wide pass, and never past six times', () => {
    // ⭐ THE FLOOR IS EXACTLY THE BASE INSIDE 2.5 HORIZONS, which is just inside
    // the capture boundary at 2.598: the rays that need every step get every
    // step.
    for (const impact of [0.1, 1, 2, 2.5]) {
      expect(lensAdaptiveStep(impact * RS, RS)).toBe(COHORT_LENS_STEP);
    }
    expect(lensAdaptiveStep(2.5 * RS, RS)).toBe(COHORT_LENS_STEP);
    expect(lensAdaptiveStep(5 * RS, RS)).toBeCloseTo(2 * COHORT_LENS_STEP, 12);
    // …and the ceiling is reached at 6 * 2.5 = 15 horizons and never exceeded,
    // however wide the pass. The quad's corner is 45 wu from the mass, which at
    // the near horizon is 58 horizons.
    for (const impact of [15, 30, 45, 1000]) {
      expect(lensAdaptiveStep(impact * RS, RS))
        .toBeCloseTo(COHORT_LENS_STEP_STRETCH_MAX * COHORT_LENS_STEP, 12);
    }
    expect(COHORT_LENS_STEP_STRETCH_R).toBe(2.5);
    expect(COHORT_LENS_STEP_STRETCH_MAX).toBe(6);
  });

  it('reproduces general relativity’s light bending', () => {
    // ⚠️⚠️ THE FIRST-ORDER LAW `2 rs / b` IS NOT WHAT A CORRECT INTEGRATOR
    // RETURNS AT TEN HORIZONS, and the plan's tolerance for it (5 % at 10 rs,
    // 2 % at 30) is unreachable for a REASON rather than through error: the next
    // term of the deflection series is `(15π/4)(M/b)²`, which is 14.7 % of the
    // leading term at b = 10 rs and 4.9 % at 30. The trace is checked against
    // the series it must actually satisfy —
    //
    //   Δφ = 4M/b + (15π/4)(M/b)² + (128/3)(M/b)³ + …
    //
    // — and separately against the leading term at an impact where the leading
    // term is the whole story.
    const M = 0.5 * RS;
    const series = (b: number): number =>
      4 * (M / b)
      + (15 * Math.PI / 4) * (M / b) ** 2
      + (128 / 3) * (M / b) ** 3;
    for (const impact of [10, 30]) {
      const bend = lensDeflection(impact * RS, RS);
      expect(Math.abs(bend / series(impact * RS) - 1)).toBeLessThan(0.01);
    }
    // The leading law, where it is the law: at 45 horizons — the widest pass a
    // 32 wu quad can produce at the near horizon — the trace is within 5 % of
    // `2 rs / b`, and the whole of the residual is the second-order term.
    const wide = lensDeflection(45 * RS, RS);
    expect(Math.abs(wide / (2 * RS / (45 * RS)) - 1)).toBeLessThan(0.05);
    // …and it is an APPROACH, not a coincidence: the excess over the leading
    // term shrinks monotonically as the ray passes wider.
    const excess = [5, 10, 30, 45]
      .map((b) => lensDeflection(b * RS, RS) / (2 * RS / (b * RS)) - 1);
    for (let i = 1; i < excess.length; i += 1) {
      expect(excess[i]).toBeLessThan(excess[i - 1]);
    }
    expect(excess[0]).toBeGreaterThan(0.4);
    expect(excess[excess.length - 1]).toBeLessThan(0.05);
  });

  it('loses nothing to the adaptive step', () => {
    // ⭐⭐ THE CLAIM THE STRETCH RESTS ON, MEASURED. A twelvefold finer
    // integration of the same ray — twelve times the steps at a twelfth of the
    // step — agrees with the shipped one to better than half a percent of the
    // deflection at every impact the quad can produce. That is what makes "every
    // ray is bent" affordable: the wide rays are cheap AND right.
    for (const impact of [5, 10, 30, 45]) {
      const shipped = lensDeflection(impact * RS, RS);
      const fine = lensDeflection(
        impact * RS, RS, COHORT_LENS_STEPS * 12, COHORT_LENS_STEP / 12,
      );
      expect(Math.abs(shipped / fine - 1)).toBeLessThan(0.005);
    }
  });

  it('puts the capture boundary where 3√3 M is', () => {
    // ⭐⭐⭐ NOTHING IN THE PROGRAM SAYS 2.598, AND THAT IS THE POINT. The shadow
    // is not a drawn disc with a radius; it is the set of rays that fall in, and
    // where that set ends falls out of the integration. The trace resolves it to
    // inside a tenth of a horizon.
    const critical = 3 * Math.sqrt(3) * 0.5 * RS;
    expect(critical).toBeCloseTo(2.598, 3);
    expect(lensCaptured(2.55 * RS, RS)).toBe(true);
    expect(lensCaptured(2.65 * RS, RS)).toBe(false);
    // Well inside, and well outside.
    expect(lensCaptured(1 * RS, RS)).toBe(true);
    expect(lensCaptured(2 * RS, RS)).toBe(true);
    for (const impact of [3, 5, 10, 30]) {
      expect(lensCaptured(impact * RS, RS)).toBe(false);
    }
  });

  it('never runs past the loop’s compile-time cap', () => {
    // ⚠️ A GLSL LOOP NEEDS A CONSTANT BOUND, so the fragment runs to the cap and
    // breaks on the uniform. The cap has to be above the step count or the
    // quality cascade's top tier would be silently truncated.
    expect(COHORT_LENS_STEPS).toBeLessThan(COHORT_LENS_STEP_CAP);
    expect(lensTrace(2.5 * RS, RS).steps).toBeLessThanOrEqual(COHORT_LENS_STEPS);
    // A ray that passes wide leaves in about a dozen steps, which is the other
    // half of the adaptive step's argument: it is cheap because it is done.
    expect(lensTrace(30 * RS, RS).steps).toBeLessThan(15);
  });
});

/* -------------------------------------------------------------------------- *
 * The fold.
 * -------------------------------------------------------------------------- */

describe('cohort lens — the fold', () => {
  it('is 0 at twenty pixels per world unit, 1 at fifty, and monotone between', () => {
    expect(lensCloseness(COHORT_UNFOLD_LO)).toBe(0);
    expect(lensCloseness(COHORT_UNFOLD_HI)).toBe(1);
    expect(lensCloseness(1)).toBe(0);
    expect(lensCloseness(1000)).toBe(1);
    let previous = -1;
    for (let px = 0; px <= 60; px += 0.5) {
      const closeness = lensCloseness(px);
      expect(closeness).toBeGreaterThanOrEqual(previous);
      previous = closeness;
    }
    expect(COHORT_UNFOLD_LO).toBeLessThan(COHORT_UNFOLD_HI);
  });

  it('moves the mass, both disc edges and the shadow together', () => {
    // ⭐⭐⭐ ONE NUMBER, AND EVERY RADIUS READS IT. A form in which the mass
    // unfolded before the disc did would be a black hole with a ring around it
    // at one camera and a ring with a dot in it at another.
    const far = lensFold(COHORT_UNFOLD_LO);
    expect(far.closeness).toBe(0);
    expect(far.horizon).toBe(COHORT_HORIZON_FAR);
    expect(far.discOut).toBe(COHORT_DISC_OUT_FAR);
    // ⭐ The shadow is not painted at all out here: its alpha IS the closeness.
    expect(far.shadowAlpha).toBe(0);
    // …and the inner edge folds WITH the mass, so it is still three horizons.
    expect(far.discIn / far.horizon).toBeCloseTo(3, 12);

    const near = lensFold(COHORT_UNFOLD_HI);
    expect(near.closeness).toBe(1);
    expect(near.horizon).toBe(COHORT_HORIZON);
    expect(near.discIn).toBeCloseTo(COHORT_DISC_IN, 12);
    expect(near.discOut).toBe(COHORT_DISC_OUT);
    expect(near.shadowAlpha).toBe(1);
    expect(near.discIn / near.horizon).toBeCloseTo(3, 12);

    // The plan's own table, in one line each.
    expect(COHORT_DISC_IN).toBeCloseTo(2.31, 10);
    expect(COHORT_HORIZON / COHORT_HORIZON_FAR).toBeCloseTo(9.625, 3);
    expect(COHORT_DISC_OUT / COHORT_DISC_OUT_FAR).toBeCloseTo(2, 3);
    // ⚠️ THE DISC SHRINKS LESS THAN THE MASS, deliberately: far away there is
    // no shadow to see at all and what is left must read as INTAKE, never as a
    // scale model of a black hole. 2× against 9.63× since 2026-09-03, when
    // the far form became the intake itself and its arms needed room (the 3 wu
    // skirt before it was 9.33×, the 6 wu one before that 4.67×, and the 5 wu
    // two-skirt form in between 5.6×).
    expect(COHORT_DISC_OUT / COHORT_DISC_OUT_FAR)
      .toBeLessThan(COHORT_HORIZON / COHORT_HORIZON_FAR);
  });

  it('puts the near shadow at two world units and paints no dark below the band', () => {
    // The shadow's angular size is `3√3/2 · rs` in impact parameter, which is
    // what `COHORT_HIT_RADIUS` is re-based on.
    const shadow = (rs: number): number => (3 * Math.sqrt(3) / 2) * rs;
    expect(shadow(COHORT_HORIZON)).toBeCloseTo(2.0, 1);
    expect(shadow(COHORT_HORIZON_FAR)).toBeCloseTo(0.208, 3);
    // ⭐⭐ "AT MOST A PIXEL OF DARK" IS ENFORCED BY THE ALPHA AND NOT BY THE
    // ARITHMETIC OF SIZE. While the band's far end was 6 px/wu the far shadow
    // was 1.2 pixels across and the size alone said it; at 20 px/wu the same
    // shadow would be 8.3 pixels across. What keeps it invisible is that the
    // shadow's alpha IS the closeness, so below the band no dark is painted.
    expect(2 * shadow(COHORT_HORIZON_FAR) * COHORT_UNFOLD_LO).toBeCloseTo(8.3, 1);
    const darkPx = (px: number): number => {
      const fold = lensFold(px);
      return fold.shadowAlpha * 2 * shadow(fold.horizon) * px;
    };
    expect(darkPx(COHORT_UNFOLD_LO)).toBe(0);
    // …and over the app camera's own range — 4.6 to 22.6 px/wu across seven
    // mainnet marks, measured 2026-09-03 — the dark the layer actually paints
    // stays under one pixel, which is the user's third rule as a number.
    for (let px = 4.6; px <= 22.6; px += 0.2) {
      expect(darkPx(px)).toBeLessThan(1);
    }
  });

  it('holds the far form through the whole mid range', () => {
    // ⭐⭐⭐ 14 TO 20 px/wu IS THE RANGE THE USER JUDGED TOO BIG on the live
    // frames (2026-09-03): the far view was right, the mid range far too big.
    // The band now starts where that range ends, so at 14 and at 20 the
    // closeness is exactly 0 and the mark is the far halo and nothing else.
    for (const px of [14, 20]) {
      expect(lensCloseness(px)).toBe(0);
      const fold = lensFold(px);
      expect(fold.closeness).toBe(0);
      expect(fold.horizon).toBe(COHORT_HORIZON_FAR);
      expect(fold.discOut).toBe(COHORT_DISC_OUT_FAR);
      expect(fold.shadowAlpha).toBe(0);
    }
    // ⚠️ WHAT IT USED TO BE, so the size of the change is on the record: on the
    // old 6 → 30 band, 14 px/wu was already 0.26 unfolded — a
    // `mix(6, 28, 0.26)` = 11.7 wu disc, 23 units across, against the 2.0 wu
    // sprite of the sighted peer standing next to it.
    const wasCloseness = (px: number): number => {
      const t = Math.min(1, Math.max(0, (px - 6) / (30 - 6)));
      return t * t * (3 - 2 * t);
    };
    expect(wasCloseness(14)).toBeCloseTo(0.259, 3);
    expect(6 + (28 - 6) * wasCloseness(14)).toBeCloseTo(11.7, 1);
    expect(lensFold(14).discOut).toBe(COHORT_DISC_OUT_FAR);
    expect(COHORT_DISC_OUT_FAR).toBe(14);
  });

  it('paints the dark last: nothing through the first third of the band', () => {
    // ⭐⭐⭐ A BRIGHT RING AROUND A DARKER CENTRE IS A SMALL EYE, and the trace
    // makes one on its own at the start of the band. So the shadow's alpha is
    // not the closeness: it is the hole gate of it, exactly 0 until 0.35 and
    // exactly 1 from 0.85, monotone between.
    expect(COHORT_HOLE_GATE_LO).toBeLessThan(COHORT_HOLE_GATE_HI);
    expect(lensHoleGate(0)).toBe(0);
    expect(lensHoleGate(COHORT_HOLE_GATE_LO)).toBe(0);
    expect(lensHoleGate(COHORT_HOLE_GATE_HI)).toBe(1);
    expect(lensHoleGate(1)).toBe(1);
    let previous = -1;
    for (let c = 0; c <= 1; c += 0.01) {
      expect(lensHoleGate(c)).toBeGreaterThanOrEqual(previous);
      previous = lensHoleGate(c);
    }
    // In pixels per world unit: at 30 the form is a quarter unfolded and
    // carries NO dark; at 40 it is three quarters unfolded and mostly black;
    // at 50 the film's hole.
    expect(lensCloseness(30)).toBeCloseTo(0.259, 3);
    expect(lensFold(30).shadowAlpha).toBe(0);
    expect(lensFold(40).shadowAlpha).toBeGreaterThan(0.5);
    expect(lensFold(40).shadowAlpha).toBeLessThan(1);
    expect(lensFold(50).shadowAlpha).toBe(1);
    // …and the FORM is not gated: at 30 the mass, both edges and the disc are
    // already a quarter of the way to the near values.
    expect(lensFold(30).horizon).toBeGreaterThan(COHORT_HORIZON_FAR);
    expect(lensFold(30).discOut).toBeGreaterThan(COHORT_DISC_OUT_FAR);
  });
});

/* -------------------------------------------------------------------------- *
 * The disc.
 * -------------------------------------------------------------------------- */

describe('cohort lens — the disc’s two laws', () => {
  it('the far law falls from the centre to exactly zero at the far radius', () => {
    // ⭐ ONE CURVE, a sink's own density: hyperbolic in the radius under the
    // mist's catchment weight, brightest at the middle, exactly nothing at the
    // edge — no ring, no pupil, no platform and no rim.
    const out = COHORT_DISC_OUT_FAR;
    expect(lensFarLaw(0, out)).toBeCloseTo(COHORT_LENS_FAR_DISC_AMP, 12);
    expect(lensFarLaw(out, out)).toBe(0);
    expect(lensFarLaw(out * 1.5, out)).toBe(0);
    expect(lensFarCatchment(0, out)).toBe(1);
    expect(lensFarCatchment(out, out)).toBe(0);
    let previous = Infinity;
    for (let rho = 0; rho <= out; rho += out / 200) {
      const value = lensFarLaw(rho, out);
      expect(value).toBeLessThan(previous);
      previous = value;
    }
  });

  it('concentrates the light at the mouth and leaves the periphery faint', () => {
    // ⭐⭐⭐ THE USER'S SECOND JUDGEMENT (2026-09-03) AS NUMBERS: the vortex must
    // reach further, and its periphery must be fainter and die faster. Both are
    // one curve: `(h/(ρ+h))^p` under the catchment weight is at half its peak
    // by 1 wu, a third at 2 wu, a sixth at 4 and a twentieth at 8 — a sink's
    // own 1/r density — and the reach is fourteen.
    const out = COHORT_DISC_OUT_FAR;
    const peak = lensFarLaw(0, out);
    const at = (rho: number): number => lensFarLaw(rho, out) / peak;
    expect(COHORT_LENS_FAR_KNEE).toBe(1);
    expect(COHORT_LENS_FAR_DISC_POW).toBe(1);
    // The half-maximum radius of the bare law, `h · (2^(1/p) − 1)`.
    const half = COHORT_LENS_FAR_KNEE * (2 ** (1 / COHORT_LENS_FAR_DISC_POW) - 1);
    expect(half).toBe(1);
    expect(at(half)).toBeGreaterThan(0.49);
    expect(at(2)).toBeCloseTo(0.32, 2);
    expect(at(4)).toBeCloseTo(0.169, 2);
    expect(at(4)).toBeLessThan(0.2);
    expect(at(8)).toBeLessThan(0.06);
    expect(at(8)).toBeGreaterThan(0.04);
    // ⚠️ WHAT THE TWO-SKIRT FORM DID, so the size of the change is on the
    // record: its arms' skirt `(1 − ρ/5)^0.8` was still 0.66 of its peak at 2
    // wu and 0.28 at 4 — a disc with an edge, which the user called too bright
    // at the periphery and not fused with the cohort.
    expect((1 - 2 / 5) ** 0.8).toBeCloseTo(0.6645, 3);
    expect((1 - 4 / 5) ** 0.8).toBeCloseTo(0.276, 3);
  });

  it('the arms run all the way in, and the nucleus keeps the pupil off', () => {
    const out = COHORT_DISC_OUT_FAR;
    // ⭐ THE ARMS' CONTRAST: a filament is twice the law and a lane is NOTHING,
    // everywhere — no blend to neutral near the heart, which is what made the
    // intake and the cohort read as two objects. ⚠️ 1 is the ceiling: past it
    // a lane would go negative and remove light.
    expect(COHORT_LENS_FAR_STREAK).toBe(1);
    expect(lensFarArms(1)).toBeCloseTo(2, 12);
    expect(lensFarArms(0)).toBeCloseTo(0, 12);
    expect(lensFarArms(0.5)).toBe(1);
    expect(lensFarBody(0.7, out, 1) / lensFarBody(0.7, out, 0.5)).toBeCloseTo(2, 12);
    expect(lensFarBody(0, out, 0)).toBe(0);
    // ⭐⭐ THE NUCLEUS IS THE BRIGHTEST THING IN THE FAR FORM, and it does not
    // read the medium. With the DARKEST lane at the centre, the centre is still
    // brighter than the BRIGHTEST lane anywhere past half a world unit, so no
    // lane can print a pupil; and the medium's lanes are 2.5 wu wide, so a lane
    // cannot be dark at the centre and bright half a unit away.
    expect(lensFarNucleus(0)).toBeCloseTo(
      COHORT_LENS_FAR_GLOW * (1 + COHORT_LENS_FAR_GLOW_CORE), 12,
    );
    const darkestCentre = lensFarNucleus(0) + lensFarBody(0, out, 0);
    for (let rho = 0.5; rho <= out; rho += 0.05) {
      const brightest = lensFarNucleus(rho) + lensFarBody(rho, out, 1);
      expect(brightest).toBeLessThan(darkestCentre);
    }
    // …and the nucleus is a sighted peer's own shape: a 0.7 wu Gaussian with a
    // brighter core at 0.35 of it, falling to a tenth by 1.06 wu.
    expect(COHORT_LENS_FAR_GLOW_R).toBe(0.7);
    expect(lensFarNucleus(1.06) / lensFarNucleus(0)).toBeLessThan(0.1);
    // The fifth of the law at 2 wu, doubled by a filament, is still under the
    // nucleus's own peak: the arms enter the heart, they never out-shine it.
    expect(lensFarBody(2, out, 1)).toBeLessThan(lensFarNucleus(0));
  });

  it('the near law fades out over the outer 60 % of the disc', () => {
    const out = COHORT_DISC_OUT;
    expect(lensNearOuterFade(0, out)).toBe(1);
    expect(lensNearOuterFade(0.4 * out, out)).toBe(1);
    expect(lensNearOuterFade(out, out)).toBe(0);
    expect(lensNearOuterFade(out * 1.2, out)).toBe(0);
    expect(lensNearOuterFade(0.7 * out, out)).toBeCloseTo(0.5, 6);
  });

  it('the inner edge is sharp: nothing at the ISCO, everything just outside', () => {
    // ⭐ THE GAP IS A FACT ABOUT ORBITS. Below three horizons no circular orbit
    // is stable, so a soft edge there would be light where there is nothing to
    // shine — and it is exactly what makes the film's disc read as a disc rather
    // than as a glow with a dot in it.
    const edge = COHORT_DISC_IN;
    expect(lensDiscInnerEdge(edge, edge)).toBe(0);
    expect(lensDiscInnerEdge(edge * 0.9, edge)).toBe(0);
    expect(lensDiscInnerEdge(edge * 1.06, edge)).toBe(1);
    expect(lensDiscInnerEdge(edge * 2, edge)).toBe(1);
    // …and the whole ramp is 6 % of the radius: 0.14 wu at the near horizon.
    expect(edge * 0.06).toBeLessThan(0.15);
  });

  it('beams antisymmetrically about the tangent, and only when unfolded', () => {
    // ⭐ THE DISC'S TOTAL LIGHT IS UNCHANGED; only its distribution moves. That
    // is what makes beaming a free asymmetry rather than a brightness knob.
    for (const cosine of [0, 0.25, 0.5, 0.75, 1]) {
      expect(lensBeaming(cosine, 1) - 1).toBeCloseTo(-(lensBeaming(-cosine, 1) - 1), 12);
    }
    expect(lensBeaming(1, 1)).toBeCloseTo(1 + COHORT_LENS_BEAM, 12);
    expect(lensBeaming(-1, 1)).toBeCloseTo(1 - COHORT_LENS_BEAM, 12);
    expect(lensBeaming(0, 1)).toBe(1);
    // ⚠️ And it folds away: far out an asymmetry is a dither pattern.
    expect(lensBeaming(1, 0)).toBe(1);
    expect(lensBeaming(1, 0.5)).toBeCloseTo(1 + COHORT_LENS_BEAM / 2, 12);
  });

  it('redshifts to nothing at the horizon and to nothing at all far out', () => {
    expect(lensRedshift(COHORT_HORIZON, COHORT_HORIZON)).toBe(0);
    expect(lensRedshift(COHORT_HORIZON * 0.5, COHORT_HORIZON)).toBe(0);
    expect(lensRedshift(100 * COHORT_HORIZON, COHORT_HORIZON)).toBeGreaterThan(0.99);
    // At the disc's own inner edge it is still a visible dimming — which is what
    // puts a dark band inside the bright one rather than a hard rim.
    expect(lensRedshift(COHORT_DISC_IN, COHORT_HORIZON)).toBeCloseTo(0.8165, 4);
    let previous = -1;
    for (let rho = COHORT_HORIZON; rho <= COHORT_DISC_OUT; rho += 0.25) {
      const value = lensRedshift(rho, COHORT_HORIZON);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('lerps the three colour stops on the CPU, cold at rest', () => {
    // ⭐ WARMTH IS A PER-DRAW FACT, so it is spent once per material and not
    // once per pixel. The shader sees three colours and does not know there is
    // a knob.
    expect(cohortDiscStops(0)).toEqual({
      core: COHORT_DISC_CORE, mid: COHORT_DISC_MID, outer: COHORT_DISC_OUTER,
    });
    for (let channel = 0; channel < 3; channel += 1) {
      expect(cohortDiscStops(1).mid[channel])
        .toBeCloseTo(COHORT_DISC_MID_WARM[channel], 12);
      expect(cohortDiscStops(1).outer[channel])
        .toBeCloseTo(COHORT_DISC_OUTER_WARM[channel], 12);
    }
    const half = cohortDiscStops(0.5);
    expect(half.mid[0]).toBeCloseTo((COHORT_DISC_MID[0] + COHORT_DISC_MID_WARM[0]) / 2, 12);
    // Out of range is clamped, so a knob cannot invent a fourth colour.
    expect(cohortDiscStops(-1)).toEqual(cohortDiscStops(0));
    expect(cohortDiscStops(5)).toEqual(cohortDiscStops(1));
  });
});

/* -------------------------------------------------------------------------- *
 * The material.
 * -------------------------------------------------------------------------- */

describe('cohort lens — the material', () => {
  const material = makeCohortLensMaterial();

  it('composites rather than adds, because a shadow removes light', () => {
    // ⚠️⚠️ THE ONLY NON-ADDITIVE DRAW IN THE COLONY. Additive blending can only
    // fail to add; it has no way to say "there is less light here than there
    // was", which is precisely what a shadow says. Premultiplied normal
    // blending does — and the price is that render order becomes part of the
    // design, which the layer that mounts it must state.
    expect(material.blending).toBe(THREE.NormalBlending);
    expect(material.premultipliedAlpha).toBe(true);
    expect(material.transparent).toBe(true);
    // Depth READ, never depth WRITE: the mark occludes by alpha and must not
    // stop anything behind it from drawing.
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.toneMapped).toBe(false);
    // A camera-facing quad the camera can pass through.
    expect(material.side).toBe(THREE.DoubleSide);
  });

  it('takes the layer’s three lanes and no others', () => {
    const attributes = [...material.vertexShader.matchAll(/attribute\s+\w+\s+(\w+)\s*;/g)]
      .map((match) => match[1]);
    expect(attributes).toEqual(['aSeed', 'aGulp', 'aShare']);
    // ⭐ EVERY LANE HAS A READER. `aSeed` decorrelates the two-phase clock so
    // six discs never breathe together, `aGulp` is the block this cohort won,
    // and `aShare` is the sink's own strength — the same three the patch takes,
    // for the same three reasons.
    expect(material.vertexShader).toContain('vSeed = aSeed;');
    expect(material.vertexShader).toContain('vGulp = aGulp;');
    expect(material.vertexShader).toContain('aShare / max(uShareMax, 1e-6)');
    expect(material.fragmentShader).toContain('uTime / uPeriod + vSeed');
    expect(material.fragmentShader).toContain('vShareF');
    // …and the instance matrix carries a TRANSLATION and nothing else, which is
    // why the quad's extent is a uniform.
    expect(material.vertexShader).toContain('uQuadR * 2.0');
    expect(material.uniforms.uQuadR.value).toBe(COHORT_LENS_QUAD_R);
  });

  it('binds the plan’s numbers, and the substance’s from the mist', () => {
    const value = (name: string): unknown => material.uniforms[name].value;
    expect(value('uHorizon')).toBe(COHORT_HORIZON);
    expect(value('uHorizonFar')).toBe(COHORT_HORIZON_FAR);
    expect(value('uDiscIn')).toBe(COHORT_DISC_IN);
    expect(value('uDiscOut')).toBe(COHORT_DISC_OUT);
    expect(value('uDiscOutFar')).toBe(COHORT_DISC_OUT_FAR);
    expect(value('uUnfoldLo')).toBe(COHORT_UNFOLD_LO);
    expect(value('uUnfoldHi')).toBe(COHORT_UNFOLD_HI);
    expect(value('uSteps')).toBe(COHORT_LENS_STEPS);
    expect(value('uStep')).toBe(COHORT_LENS_STEP);
    expect(value('uBeam')).toBe(COHORT_LENS_BEAM);
    expect(value('uFarDiscAmp')).toBe(COHORT_LENS_FAR_DISC_AMP);
    // ⚠️ uPxScale starts absurdly large so a material drawn before the layer's
    // first frame is UNFOLDED rather than invisible: a missing per-frame write
    // then shows as the wrong form, not as a cohort that is not there.
    expect(value('uPxScale')).toBeGreaterThan(1e5);
    // The context exemption is off until a HUD says otherwise.
    expect(value('uContextEnergy')).toBe(1);
    // …and the share's denominator is 1 rather than 0, for the reason the
    // patch's is: an unwritten maximum reads shares as themselves.
    expect(value('uShareMax')).toBe(1);
  });

  it('states its mip level, and the fetch is the only one it has', () => {
    // ⛔ THE RAY-MARCH LOD TRAP. Everything about this is pinned as text in the
    // guard file; here it is enough that the level is a uniform that exists.
    // ⚠️ Comment-free, because the shader's own PROSE says the word `texture2D`
    // where it explains why there is none — the trap the neighbours' guards
    // learned first.
    const code = material.fragmentShader
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
    expect(material.uniforms.uLod.value).toBe(0);
    expect(code).toContain('textureLod(uNoise, p, uLod)');
    expect(code).not.toContain('texture2D');
  });
});
