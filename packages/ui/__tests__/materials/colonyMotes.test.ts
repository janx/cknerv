// The motes — the one part of a cohort's mark that MOVES, and therefore the one
// whose arithmetic a still frame cannot check.
//
// ⭐⭐⭐ EVERY MOTE IS A PURE FUNCTION OF ITS SEED AND THE CLOCK, which is what
// makes this file possible at all. There is no simulation to step, no buffer of
// positions and no feedback: a 2-D point sink obeys `d(r²)/dt = -k`, so the
// radius is a square root, the life is a division, and the whole trajectory can
// be evaluated at any instant in either direction. What is pinned below is that
// closed form — the fall, the spiral, the rebirth, the fold, the burst and the
// pixel floor — against the physics it claims and against the numbers the
// approved preview shipped.
//
// ⚠️ THE MIRROR IS THE MODULE'S OWN EXPORT AND NOT A COPY. `colonyMotes.ts`
// ships `cohortMoteAt` as TypeScript, the vertex program computes the same
// statements in the same order, and `colonyMotesShaderGuards.test.ts` pins the
// GLSL text so the two cannot drift.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  COHORT_GULP_FALL,
  COHORT_GULP_GLSL,
  COHORT_GULP_RISE,
  COHORT_NEVER_WON,
} from '../../src/materials/colonyCohort';
import {
  COHORT_DISC_OUT,
  COHORT_HORIZON,
  COHORT_HORIZON_FAR,
  COHORT_LENS_REACH,
  COHORT_MASS_FLOOR,
  COHORT_MASS_GLSL_FLOOR,
  COHORT_SHADOW_RATIO,
  COHORT_UNFOLD_HI,
  COHORT_UNFOLD_LO,
  cohortDiscStops,
  cohortMassLaneValue,
  cohortMassUnpack,
  cohortShadowRadius,
} from '../../src/materials/colonyLens';
import { MIST_SWIRL } from '../../src/materials/colonyMist';
import {
  COHORT_MOTES_PER_COHORT,
  COHORT_MOTE_AMP,
  COHORT_MOTE_FADE_IN,
  COHORT_MOTE_FAR_DIM,
  COHORT_MOTE_FLOOR,
  COHORT_MOTE_GULP_BURST,
  COHORT_MOTE_K,
  COHORT_MOTE_K_FLOOR,
  COHORT_MOTE_LIVE_STRENGTH,
  COHORT_MOTE_ORBIT,
  COHORT_MOTE_PIXEL_FLOOR,
  COHORT_MOTE_R0_FLOOR,
  COHORT_MOTE_R0_MAX,
  COHORT_MOTE_R0_MIN,
  COHORT_MOTE_REACH,
  COHORT_MOTE_REACH_FAR,
  COHORT_MOTE_SEED_SPREAD,
  COHORT_MOTE_SHADOW_R,
  COHORT_MOTE_SHADOW_R_FAR,
  COHORT_MOTE_SIZE,
  COHORT_MOTE_VANISH,
  COHORT_MOTE_WHITEN,
  buildCohortMotesGeometry,
  cohortMoteAt,
  cohortMoteBirthRadius,
  cohortMoteColor,
  cohortMoteFold,
  cohortMoteGulp,
  cohortMoteHash,
  cohortMoteLife,
  cohortMotePointSizePx,
  cohortMoteRadius,
  cohortMoteSeed,
  cohortMoteSinkK,
  cohortMoteTurn,
  makeCohortMotesMaterial,
  markCohortAttributeRange,
  setCohortMotesDrawCount,
  stampCohortMotes,
  writeCohortMotes,
  writeCohortMotesMass,
} from '../../src/materials/colonyMotes';

/** A camera close enough to unfold the form completely. */
const NEAR_PX = COHORT_UNFOLD_HI * 2;
/** …and one far enough to fold it completely. */
const FAR_PX = COHORT_UNFOLD_LO / 2;

/** A cohort taking its whole window: the sink at full strength. */
const FULL = 1;

/** The three masses the live week actually produces: the floor pair, the
 *  middling three, and the giant at the ceiling. */
const MASSES = [COHORT_MASS_FLOOR, 0.6, 1] as const;

/** GLSL's `smoothstep`, where a test has to divide one out. */
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/* -------------------------------------------------------------------------- *
 * The fall.
 * -------------------------------------------------------------------------- */

describe('cohort motes — the trajectory', () => {
  it('falls on the sink’s own law: r² = r0² − k·age', () => {
    // ⭐⭐ THE SINK IS EXACT AND SO IS THIS. `d(r²)/dt = -k` integrates with no
    // approximation, which is why the program needs no simulation: the radius at
    // any age is a square root of a straight line in r².
    const k = cohortMoteSinkK(FULL);
    const r0 = 27;
    for (let age = 0; age <= 40; age += 0.5) {
      const r = cohortMoteRadius(r0, k, age);
      expect(r * r).toBeCloseTo(r0 * r0 - k * age, 9);
    }
    // Monotone inward, and never outward at any age.
    let previous = Number.POSITIVE_INFINITY;
    for (let age = 0; age <= 45; age += 0.25) {
      const r = cohortMoteRadius(r0, k, age);
      expect(r).toBeLessThanOrEqual(previous);
      previous = r;
    }
  });

  it('winds on the medium’s own logarithmic spiral, plus a swing that dies at the catchment', () => {
    // The spiral term is the mist's, character for character: `swirl · ln(r0/r)`
    // per e-fold of radius, at the SAME circulation the disc's back-trace uses.
    const reach = COHORT_MOTE_REACH;
    // At the catchment's edge the swing is exactly zero, so the whole turn is
    // the spiral — which is what makes the two agree where they meet.
    const atEdge = cohortMoteTurn(reach, reach, 10, reach);
    expect(atEdge).toBeCloseTo(MIST_SWIRL * Math.log(1), 12);
    expect(atEdge).toBe(0);
    // Outside it, still only the spiral.
    expect(cohortMoteTurn(reach * 1.5, reach * 2, 10, reach))
      .toBeCloseTo(MIST_SWIRL * Math.log(2 / 1.5), 12);
    // Inside it, the spiral plus a swing that grows with AGE — which is what
    // makes two motes born at the same angle fan apart instead of running down
    // one wire.
    const young = cohortMoteTurn(6, 20, 5, reach);
    const old = cohortMoteTurn(6, 20, 20, reach);
    expect(old - young).toBeGreaterThan(0);
    expect(old - young).toBeCloseTo(
      ((COHORT_MOTE_ORBIT * 15) / 6 ** 1.5) * (1 - 36 / (reach * reach)) ** 2,
      9,
    );
    // And the turn is subtracted from the birth angle: a parcel arriving has
    // come BACKWARD around the spiral from where it started.
    const state = cohortMoteAt({ seed: 3, strength: FULL, time: 12, pxPerWu: NEAR_PX });
    expect(state.theta).toBeCloseTo(
      state.theta0 - cohortMoteTurn(state.r, state.r0, state.age, state.reach),
      12,
    );
  });

  it('winds the other way for a cohort whose lane is negative, and no other way', () => {
    // ⭐⭐ THE HAND IS ONE REFLECTION AND NOTHING ELSE. It is identity rather
    // than data — the sign of the mass lane, off the producer key's own seed —
    // so it may separate two cohorts the week makes the same size and may not
    // change how much substance either is taking: the same radius at the same
    // instant, the same light, the same speck, wound the other way round.
    for (const time of [0.4, 6.5, 31]) {
      const seed = cohortMoteSeed(0.42, 7);
      const input = { seed, strength: FULL, time, pxPerWu: NEAR_PX } as const;
      const right = cohortMoteAt(input);
      const left = cohortMoteAt({ ...input, hand: -1 });
      expect(left.r).toBe(right.r);
      expect(left.r0).toBe(right.r0);
      expect(left.life).toBe(right.life);
      expect(left.near).toBe(right.near);
      expect(left.brightness).toBe(right.brightness);
      expect(left.diameter).toBe(right.diameter);
      expect(left.theta0).toBe(right.theta0);
      // The turn is negated and the birth angle is not: `theta0 - hand · turn`.
      expect(left.theta - left.theta0).toBeCloseTo(-(right.theta - right.theta0), 12);
      // …and it is not a reflection of nothing: this mote really has wound.
      expect(Math.abs(right.theta - right.theta0)).toBeGreaterThan(0.05);
    }
    // ⭐ +1 IS THE DEFAULT, EXACTLY — the whole colony's hand until a lane says
    // otherwise, which is why the picture is unchanged before one does.
    const base = { seed: 12.5, strength: FULL, time: 9, pxPerWu: NEAR_PX } as const;
    expect(cohortMoteAt({ ...base, hand: 1 })).toEqual(cohortMoteAt(base));
    // And the hand a lane value carries is the sign the mirror unpacks.
    expect(cohortMassUnpack(cohortMassLaneValue(0.6, -1)).hand).toBe(-1);
    expect(cohortMassUnpack(cohortMassLaneValue(0.6, 1)).hand).toBe(1);
  });

  it('is one fall at one scale for a cohort of less mass, and a shorter one', () => {
    // ⭐⭐⭐ A SMALLER COHORT IS THE SAME PICTURE AT A SMALLER SIZE, which is the
    // whole claim of the channel: every LENGTH scales by the mass and nothing
    // else about the fall is touched. The birth radius, the shadow and the
    // catchment fold together, so the trajectory is the full-size one scaled —
    // read at the camera scale the mass says (`px · m`), because the fold is
    // pixels per shadow.
    //
    // ⚠️ AND THE FALL IS FASTER, WHICH IS ARITHMETIC AND NOT A CHOICE. The sink
    // strength `k` is the cohort's SHARE and stays in wu² per second, so a life
    // of `(r0² - shadow²)/k` over lengths scaled by `m` is scaled by `m²`: at
    // the floor a speck crosses its smaller catchment in a fifth of the time.
    // The substance is the same substance; there is simply less of it to cross.
    const seed = cohortMoteSeed(0.42, 13);
    for (const mass of MASSES) {
      const small = cohortMoteAt({ seed, strength: FULL, time: 3, pxPerWu: 40, mass });
      const full = cohortMoteAt({ seed, strength: FULL, time: 3, pxPerWu: 40 * mass });
      expect(small.closeness).toBe(full.closeness);
      expect(small.reach).toBeCloseTo(full.reach * mass, 12);
      expect(small.shadowR).toBeCloseTo(full.shadowR * mass, 12);
      expect(small.r0).toBeCloseTo(full.r0 * mass, 12);
      expect(small.life).toBeCloseTo(full.life * mass * mass, 12);
      // The whole trajectory, at the instant the shorter life puts it at.
      const at = cohortMoteAt({
        seed, strength: FULL, time: 3 * mass * mass, pxPerWu: 40, mass,
      });
      expect(at.r).toBeCloseTo(full.r * mass, 10);
      expect(at.near).toBeCloseTo(full.near, 10);
    }
  });

  it('lives exactly as long as it takes to reach the shadow’s edge', () => {
    // ⭐⭐⭐ THE LIFE IS NOT A TUNED DURATION, IT IS WHERE THE FALL ENDS. At
    // `age = life` the radius is the shadow's radius to the last bit, at every
    // birth radius and every strength — so nothing can vanish early in the void
    // or run on past the silhouette.
    const { shadowR } = cohortMoteFold(NEAR_PX);
    for (const r0 of [8, 13.5, 21, COHORT_MOTE_R0_MAX]) {
      for (const strength of [0.1, 0.4, FULL]) {
        const k = cohortMoteSinkK(strength);
        const life = cohortMoteLife(r0, shadowR, k);
        expect(cohortMoteRadius(r0, k, life)).toBeCloseTo(shadowR, 9);
        expect(life).toBeGreaterThan(0);
      }
    }
    // And the same holds at the far end of the fold, where both the birth radius
    // and the shadow have collapsed.
    const far = cohortMoteFold(FAR_PX);
    const k = cohortMoteSinkK(FULL);
    const r0 = cohortMoteBirthRadius(4.2, far.fold, far.shadowR);
    expect(cohortMoteRadius(r0, k, cohortMoteLife(r0, far.shadowR, k)))
      .toBeCloseTo(far.shadowR, 9);
  });

  it('is never born inside the shadow, whatever the fold and the mass do to both', () => {
    // ⚠️ THE OTHER HALF OF "THE LIFE IS FINITE": a mote born AT the shadow lives
    // zero seconds, and one born inside it a negative number of them.
    //
    // ⭐ AND THE MASS CANNOT BREAK IT, BY CONSTRUCTION: it multiplies the
    // catchment and the shadow by the SAME factor, so the birth floor
    // (`shadowR · 1.6`) and the drawn radius fold together. A mass that scaled
    // one and not the other is exactly the bug this sweep would catch.
    for (const mass of MASSES) {
      for (let px = 0; px <= 90; px += 0.5) {
        const fold = cohortMoteFold(px, mass);
        for (const seed of [0.11, 5.7, 91.3, 210.4]) {
          const r0 = cohortMoteBirthRadius(seed, fold.fold, fold.shadowR);
          expect(r0).toBeGreaterThanOrEqual(fold.shadowR * COHORT_MOTE_R0_FLOOR);
          expect(r0).toBeGreaterThan(fold.shadowR * COHORT_MOTE_VANISH);
          expect(cohortMoteLife(r0, fold.shadowR, cohortMoteSinkK(FULL)))
            .toBeGreaterThan(0);
        }
      }
    }
  });

  it('keeps the arithmetic finite for a cohort that takes nothing at all', () => {
    // ⚠️ A SLOT THE MARKS PLAN NEVER FILLED ARRIVES WITH A STRENGTH OF ZERO, and
    // an unfloored `k` makes the life infinite and `floor(t / life)` a NaN. The
    // floor is what keeps every number below defined; the LIGHT is taken away
    // separately, by the strength gate.
    expect(cohortMoteSinkK(0)).toBe(COHORT_MOTE_K_FLOOR);
    expect(cohortMoteSinkK(FULL)).toBe(COHORT_MOTE_K);
    const state = cohortMoteAt({ seed: 12.5, strength: 0, time: 40, pxPerWu: NEAR_PX });
    for (const value of [state.r, state.theta, state.age, state.life, state.r0]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(state.brightness).toBe(0);
  });
});

/* -------------------------------------------------------------------------- *
 * Rebirth.
 * -------------------------------------------------------------------------- */

describe('cohort motes — one fall, then another somewhere else', () => {
  it('is reborn at the same angle every frame of a cycle, and a new one on the next', () => {
    // ⭐⭐ DETERMINISTIC IN (SEED, CYCLE) IS THE WHOLE CONTRACT. The mote has no
    // memory: it must land on the same angle at every one of the thousands of
    // frames of a single fall — otherwise it jitters — and on a DIFFERENT one on
    // the next fall, or 96 motes retrace 96 fixed grooves forever.
    const seed = cohortMoteSeed(0.37, 11);
    const base = cohortMoteAt({ seed, strength: FULL, time: 0, pxPerWu: NEAR_PX });
    const angles = new Map<number, number>();
    for (let time = 0; time <= base.life * 6; time += base.life / 240) {
      const state = cohortMoteAt({ seed, strength: FULL, time, pxPerWu: NEAR_PX });
      const seen = angles.get(state.cycle);
      if (seen === undefined) angles.set(state.cycle, state.theta0);
      else expect(state.theta0).toBe(seen);
    }
    // Six or seven whole falls, every one of them at its own angle.
    expect(angles.size).toBeGreaterThanOrEqual(6);
    expect(new Set(angles.values()).size).toBe(angles.size);
    // And the angles really are spread over the turn rather than clustered.
    const values = [...angles.values()];
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(Math.PI);
    for (const angle of values) {
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(Math.PI * 2);
    }
  });

  it('spreads one cohort’s 96 motes over the whole of a fall', () => {
    // ⚠️ WITHOUT THE PHASE OFFSET THEY ARRIVE IN NINETY-SIX-STRONG WAVES. Each
    // mote's clock is shifted by its own fraction of its own life, so at any
    // instant the cohort has motes at every stage of the fall.
    const ages: number[] = [];
    for (let mote = 0; mote < COHORT_MOTES_PER_COHORT; mote += 1) {
      const state = cohortMoteAt({
        seed: cohortMoteSeed(0.11, mote),
        strength: FULL,
        time: 0,
        pxPerWu: NEAR_PX,
      });
      ages.push(state.age / state.life);
    }
    // Every tenth of a life has somebody in it.
    const buckets = new Set(ages.map((fraction) => Math.floor(fraction * 10)));
    expect(buckets.size).toBe(10);
    // …and the seeds themselves are 96 different numbers, which is what the
    // spread and the golden-ratio step are for.
    const seeds = new Set(
      Array.from({ length: COHORT_MOTES_PER_COHORT }, (_, mote) =>
        cohortMoteSeed(0.11, mote)),
    );
    expect(seeds.size).toBe(COHORT_MOTES_PER_COHORT);
  });

  it('gives two cohorts different motes from the same mote index', () => {
    // The cohort's own seed lane enters the spread, so cohort 0's mote 5 and
    // cohort 1's mote 5 are unrelated — six discs that breathed together would
    // read as one animation played six times.
    const a = cohortMoteSeed(0.11, 5);
    const b = cohortMoteSeed(0.28, 5);
    expect(b - a).toBeCloseTo(0.17 * COHORT_MOTE_SEED_SPREAD, 9);
    const first = cohortMoteAt({ seed: a, strength: FULL, time: 3, pxPerWu: NEAR_PX });
    const second = cohortMoteAt({ seed: b, strength: FULL, time: 3, pxPerWu: NEAR_PX });
    expect(first.r0).not.toBeCloseTo(second.r0, 3);
    expect(first.theta0).not.toBeCloseTo(second.theta0, 3);
  });

  it('hashes deterministically, into the unit interval', () => {
    for (const value of [0, 0.37, 7.1, 91.3, 638.5, 4021.7]) {
      const hashed = cohortMoteHash(value);
      expect(hashed).toBe(cohortMoteHash(value));
      expect(hashed).toBeGreaterThanOrEqual(0);
      expect(hashed).toBeLessThan(1);
    }
  });
});

/* -------------------------------------------------------------------------- *
 * The light.
 * -------------------------------------------------------------------------- */

describe('cohort motes — how bright, and when not at all', () => {
  it('rises inward, from the floor at birth to full at the centre', () => {
    // ⭐ IT BRIGHTENS BECAUSE THE SUBSTANCE DOES: denser, faster and hotter the
    // closer in it gets. The square puts most of the rise in the last third.
    const seed = cohortMoteSeed(0.5, 7);
    const first = cohortMoteAt({ seed, strength: FULL, time: 0, pxPerWu: NEAR_PX });
    // Walk one whole fall from just after the fade-in to just before the shadow.
    const start = first.age;
    let previous = -1;
    let samples = 0;
    for (let step = 0; step <= 200; step += 1) {
      const age = start + ((first.life - start) * step) / 200;
      const state = cohortMoteAt({
        seed, strength: FULL, time: age - start, pxPerWu: NEAR_PX,
      });
      if (state.cycle !== first.cycle || state.brightness === 0) continue;
      if (state.age < COHORT_MOTE_FADE_IN) continue;
      expect(state.brightness).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = state.brightness;
      samples += 1;
    }
    expect(samples).toBeGreaterThan(100);
    // The two ends of the ramp, stated: the floor at birth and 1 at the centre.
    expect(COHORT_MOTE_FLOOR + (1 - COHORT_MOTE_FLOOR) * 0 ** 2)
      .toBeCloseTo(COHORT_MOTE_FLOOR, 12);
    expect(COHORT_MOTE_FLOOR + (1 - COHORT_MOTE_FLOOR) * 1 ** 2).toBe(1);
  });

  it('is zero before it is born, and zero once it is inside the shadow', () => {
    // The fade-in is what stops a rebirth reading as a teleport: at age zero the
    // mote has no light at all, and it takes 0.35 s to arrive.
    const seed = cohortMoteSeed(0.9, 3);
    const born = cohortMoteAt({ seed, strength: FULL, time: 0, pxPerWu: NEAR_PX });
    const atBirth = cohortMoteAt({
      seed, strength: FULL, time: -born.age, pxPerWu: NEAR_PX,
    });
    expect(atBirth.age).toBeCloseTo(0, 9);
    expect(atBirth.brightness).toBe(0);
    const midFade = cohortMoteAt({
      seed, strength: FULL, time: -born.age + COHORT_MOTE_FADE_IN / 2, pxPerWu: NEAR_PX,
    });
    expect(midFade.brightness).toBeGreaterThan(0);
    expect(midFade.brightness).toBeLessThan(
      cohortMoteAt({
        seed, strength: FULL, time: -born.age + COHORT_MOTE_FADE_IN, pxPerWu: NEAR_PX,
      }).brightness,
    );

    // …and at the other end it is gone BEFORE the silhouette, by 3 % of the
    // shadow's radius, so it never winks out on the edge the eye is watching.
    const { shadowR } = cohortMoteFold(NEAR_PX);
    const k = cohortMoteSinkK(FULL);
    const life = cohortMoteLife(born.r0, shadowR, k);
    const gone = cohortMoteAt({
      seed, strength: FULL, time: -born.age + life * 0.9999, pxPerWu: NEAR_PX,
    });
    expect(gone.r).toBeLessThan(shadowR * COHORT_MOTE_VANISH);
    expect(gone.brightness).toBe(0);
  });

  it('draws nothing at all for a slot the plan never filled', () => {
    // ⚠️⚠️ AN UNWRITTEN SLOT'S SEAT IS THE COLONY'S OWN CENTRE, so a spare
    // capacity that drew would put 96 points per slot in the middle of the
    // scene. The gate is on the strength, which is zero there.
    for (const strength of [0, COHORT_MOTE_LIVE_STRENGTH / 2]) {
      for (let time = 0; time < 60; time += 0.7) {
        expect(cohortMoteAt({ seed: 4.5, strength, time, pxPerWu: NEAR_PX }).brightness)
          .toBe(0);
      }
    }
    // …and a cohort with the smallest live share still draws.
    const live = cohortMoteAt({
      seed: 4.5, strength: COHORT_MOTE_LIVE_STRENGTH, time: 8, pxPerWu: NEAR_PX,
    });
    expect(live.brightness).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- *
 * The fold.
 * -------------------------------------------------------------------------- */

describe('cohort motes — the fold', () => {
  it('is 0 at twenty pixels per world unit and 1 at fifty — the lens’s band', () => {
    expect(cohortMoteFold(COHORT_UNFOLD_LO).closeness).toBe(0);
    expect(cohortMoteFold(COHORT_UNFOLD_HI).closeness).toBe(1);
    expect(cohortMoteFold(0).closeness).toBe(0);
    expect(cohortMoteFold(1e6).closeness).toBe(1);
    // Monotone in between, and smooth at both edges.
    let previous = -1;
    for (let px = 0; px <= 60; px += 0.25) {
      const closeness = cohortMoteFold(px).closeness;
      expect(closeness).toBeGreaterThanOrEqual(previous);
      previous = closeness;
    }
    expect(cohortMoteFold((COHORT_UNFOLD_LO + COHORT_UNFOLD_HI) / 2).closeness)
      .toBeCloseTo(0.5, 12);
  });

  it('moves the catchment, the birth radius and the shadow together', () => {
    // ⭐⭐⭐ ONE NUMBER, so the specks cannot unfold on a schedule of their own
    // while the picture they fall through is still folded.
    const near = cohortMoteFold(COHORT_UNFOLD_HI);
    const far = cohortMoteFold(COHORT_UNFOLD_LO);
    expect(near.reach).toBe(COHORT_MOTE_REACH);
    expect(far.reach).toBe(COHORT_MOTE_REACH_FAR);
    expect(near.fold).toBe(1);
    expect(far.fold).toBeCloseTo(COHORT_MOTE_REACH_FAR / COHORT_MOTE_REACH, 12);
    expect(near.shadowR).toBe(COHORT_MOTE_SHADOW_R);
    expect(far.shadowR).toBe(COHORT_MOTE_SHADOW_R_FAR);
    // The shadow is the LENS's, derived from the same mass and never restated —
    // through the lens's own function, so the live `cohortHorizon` knob moves the
    // radius a speck vanishes at and the radius the trace makes black together.
    expect(COHORT_MOTE_SHADOW_R).toBe(cohortShadowRadius(COHORT_HORIZON));
    expect(COHORT_MOTE_SHADOW_R_FAR).toBe(cohortShadowRadius(COHORT_HORIZON_FAR));
    expect(COHORT_MOTE_SHADOW_R).toBeCloseTo(2.0, 2);
    expect(COHORT_MOTE_SHADOW_R_FAR).toBeCloseTo(0.208, 3);
  });

  it('pulls the birth radius in with the fold, and never past the shadow', () => {
    // Near, a mote is born between 8 and 27 world units — inside the near disc's
    // own outer edge, so nothing appears out of nothing beyond the mark.
    const near = cohortMoteFold(NEAR_PX);
    const radii: number[] = [];
    for (let mote = 0; mote < COHORT_MOTES_PER_COHORT; mote += 1) {
      radii.push(cohortMoteBirthRadius(cohortMoteSeed(0.42, mote), near.fold, near.shadowR));
    }
    expect(Math.min(...radii)).toBeGreaterThanOrEqual(COHORT_MOTE_R0_MIN);
    expect(Math.max(...radii)).toBeLessThanOrEqual(COHORT_MOTE_R0_MAX);
    expect(COHORT_MOTE_R0_MAX).toBeLessThan(COHORT_DISC_OUT);
    // Far, the same 96 motes are born inside the far form's six world units.
    const far = cohortMoteFold(FAR_PX);
    for (let mote = 0; mote < COHORT_MOTES_PER_COHORT; mote += 1) {
      const r0 = cohortMoteBirthRadius(cohortMoteSeed(0.42, mote), far.fold, far.shadowR);
      expect(r0).toBeLessThanOrEqual(COHORT_MOTE_REACH_FAR);
      expect(r0).toBeGreaterThan(far.shadowR);
    }
    // And the same seed always folds INWARD as the camera pulls back.
    let previous = 0;
    for (let px = 0; px <= 40; px += 0.5) {
      const fold = cohortMoteFold(px);
      const r0 = cohortMoteBirthRadius(3.3, fold.fold, fold.shadowR);
      expect(r0).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = r0;
    }
  });

  it('scales every length by the cohort’s mass, and reads the camera per SHADOW', () => {
    // ⭐⭐⭐ THE ONE CHANNEL A COHORT HAS TO SPEAK WITH. Every other form
    // parameter of this draw is a uniform the whole colony shares, so the mass
    // is the whole of what makes two intakes different pictures — and what it
    // multiplies FIRST is the camera's own scale. Pixels per SHADOW and not per
    // world unit: a cohort of half the mass reaches the same point of the band
    // at twice the pixels per world unit, so every cohort's specks unfold at
    // the same size on screen and a small one is never "a small eye".
    for (const mass of MASSES) {
      for (const px of [0, 7, 20, 26, 33, 50, 120]) {
        const own = cohortMoteFold(px, mass);
        // The SAME point of the band, reached at the scale the mass names.
        const same = cohortMoteFold(px * mass);
        expect(own.closeness).toBe(same.closeness);
        expect(own.reach).toBeCloseTo(same.reach * mass, 12);
        expect(own.shadowR).toBeCloseTo(same.shadowR * mass, 12);
        expect(own.fold).toBeCloseTo(same.fold * mass, 12);
        // …and the birth radius is never named: it rides `fold` and `shadowR`,
        // so it folds with the mark for free.
        for (const seed of [0.11, 91.3]) {
          expect(cohortMoteBirthRadius(seed, own.fold, own.shadowR)).toBeCloseTo(
            cohortMoteBirthRadius(seed, same.fold, same.shadowR) * mass,
            12,
          );
        }
      }
    }
    // ⭐⭐ A MASS OF 1 IS THE FOLD THIS FILE HAS ALWAYS COMPUTED, value for
    // value — which is what says the running picture is unchanged until a week
    // says otherwise.
    for (const px of [0, 13, 26, 44, 90]) {
      expect(cohortMoteFold(px, 1)).toEqual(cohortMoteFold(px));
    }
    // The lane is one number carrying two facts, and the MAGNITUDE is what
    // folds — the mirror of the vertex stage's own `max(abs(aMass), …)`.
    expect(cohortMassUnpack(cohortMassLaneValue(0.6, -1)))
      .toEqual({ mass: 0.6, hand: -1 });
    expect(cohortMoteFold(26, cohortMassUnpack(-0.6).mass))
      .toEqual(cohortMoteFold(26, 0.6));
    // ⚠️⚠️ AND A LANE NOBODY WROTE IS NOT A MASS OF ZERO. WebGL reads a missing
    // attribute as zero, and zero here is a shadow of zero, a life of zero and
    // a division by it; the mirror takes the program's own floor instead, so
    // both sides of the pane answer the same non-zero number.
    expect(cohortMassUnpack(0).mass).toBe(COHORT_MASS_GLSL_FLOOR);
    expect(COHORT_MASS_GLSL_FLOOR).toBeGreaterThan(0);
    const floored = cohortMoteFold(NEAR_PX, COHORT_MASS_GLSL_FLOOR);
    expect(floored.shadowR).toBeGreaterThan(0);
    expect(cohortMoteLife(
      cohortMoteBirthRadius(0.11, floored.fold, floored.shadowR),
      floored.shadowR,
      cohortMoteSinkK(FULL),
    )).toBeGreaterThan(0);
  });

  it('dims the whole draw to a fifth at the far end, which is the third rule', () => {
    // ⭐⭐ A FIELD OF MOVING POINTS IS THE MOST ATTENTION-GRABBING THING A SCENE
    // CAN CONTAIN, and at the app camera a cohort must not out-weigh the peers
    // around it.
    //
    // ⚠️ THE TWO ENDS ARE NOT COMPARED AT THE SAME CLOCK, because the LIFE folds
    // too: the far mote is born at a fifth of the radius but the far shadow is a
    // tenth of the near one, so the same second is a different point of a
    // different fall. What the fold does to the LIGHT is isolated instead, by
    // dividing out the part of the law that is about where the mote is.
    const shape = (state: { near: number; age: number }): number =>
      (COHORT_MOTE_FLOOR + (1 - COHORT_MOTE_FLOOR) * state.near * state.near)
      * smoothstep(0, COHORT_MOTE_FADE_IN, state.age);
    for (const seed of [cohortMoteSeed(0.6, 21), cohortMoteSeed(0.24, 3)]) {
      for (const time of [0, 1.7, 9.3]) {
        const near = cohortMoteAt({ seed, strength: FULL, time, pxPerWu: NEAR_PX });
        const far = cohortMoteAt({ seed, strength: FULL, time, pxPerWu: FAR_PX });
        expect(near.brightness / shape(near)).toBeCloseTo(1, 12);
        expect(far.brightness / shape(far)).toBeCloseTo(COHORT_MOTE_FAR_DIM, 12);
        // Dim, and never absent: the far form still carries its grain.
        expect(far.brightness).toBeGreaterThan(0);
      }
    }
  });
});

/* -------------------------------------------------------------------------- *
 * The block.
 * -------------------------------------------------------------------------- */

describe('cohort motes — the block this cohort won', () => {
  it('runs the feature’s ONE envelope, character for character', () => {
    // ⚠️ NOT A TRANSLITERATION. The shipped GLSL is turned into a runnable
    // expression by ONE substitution — the declaration head becomes a `return` —
    // and the mirror is measured against IT rather than against a copy of it.
    const body = COHORT_GULP_GLSL
      .replace('float gulpAge = uTime - vGulp;', 'var gulpAge = uTime - vGulp;')
      .replace('float gulp =', 'return');
    const shipped = new Function('exp', 'uTime', 'vGulp', body) as (
      exp: (value: number) => number,
      uTime: number,
      vGulp: number,
    ) => number;
    for (let age = -1; age <= 4; age += 0.01) {
      expect(cohortMoteGulp(age)).toBeCloseTo(shipped(Math.exp, age, 0), 12);
    }
    expect(cohortMoteGulp(0)).toBe(0);
    expect(cohortMoteGulp(-5)).toBe(0);
  });

  it('is silent for a cohort that has never won, at every clock a session reaches', () => {
    // ⚠️⚠️ THE SENTINEL, WHICH IS WHY THE LANE IS FILLED WITH IT AND NEVER WITH
    // ZERO: a zero-filled lane says every cohort won at t = 0 at the one moment
    // `uTime` is also zero.
    for (let step = 0; step <= 200; step += 1) {
      const time = (step / 200) * 1e5;
      expect(cohortMoteGulp(time - COHORT_NEVER_WON)).toBe(0);
      expect(cohortMoteAt({ seed: 2.2, strength: FULL, time, pxPerWu: NEAR_PX }).burst)
        .toBe(1);
    }
  });

  it('bursts by 1 + 2.5·gulp, and peaks inside the first half second', () => {
    // ⭐ THE LARGEST BURST IN THE FEATURE, on the thinnest thing in it: a mote is
    // a single additive point at 0.22 of full for most of its life.
    const seed = cohortMoteSeed(0.75, 40);
    const won = 20;
    let peak = { time: -1, burst: 1 };
    for (let time = won; time <= won + 4; time += 0.005) {
      const state = cohortMoteAt({
        seed, strength: FULL, time, pxPerWu: NEAR_PX, gulpAt: won,
      });
      expect(state.burst)
        .toBeCloseTo(1 + COHORT_MOTE_GULP_BURST * cohortMoteGulp(time - won), 12);
      if (state.burst > peak.burst) peak = { time: time - won, burst: state.burst };
    }
    expect(peak.time).toBeGreaterThan(0);
    expect(peak.time).toBeLessThan(0.5);
    // The peak of `exp(-a/0.45)·(1 - exp(-a/0.06))` is about 0.663, so the mote
    // is 2.66 times its resting brightness at the swallow.
    expect(peak.burst).toBeCloseTo(1 + COHORT_MOTE_GULP_BURST * 0.6632, 3);
    expect(COHORT_MOTE_GULP_BURST).toBeGreaterThan(1);
    // …and it is over inside a couple of seconds, so the mark is not left lit.
    const later = cohortMoteAt({
      seed, strength: FULL, time: won + 3, pxPerWu: NEAR_PX, gulpAt: won,
    });
    expect(later.burst).toBeLessThan(1.02);
    // The burst multiplies the brightness and nothing else: the mote does not
    // move, grow or change colour on the block.
    const rest = cohortMoteAt({ seed, strength: FULL, time: won + 0.2, pxPerWu: NEAR_PX });
    const flare = cohortMoteAt({
      seed, strength: FULL, time: won + 0.2, pxPerWu: NEAR_PX, gulpAt: won,
    });
    expect(flare.r).toBe(rest.r);
    expect(flare.theta).toBe(rest.theta);
    expect(flare.diameter).toBe(rest.diameter);
    expect(flare.brightness).toBeCloseTo(rest.brightness * flare.burst, 12);
  });

  it('reads the same two time constants the mouth and the lip do', () => {
    expect(COHORT_GULP_FALL).toBe(0.45);
    expect(COHORT_GULP_RISE).toBe(0.06);
  });
});

/* -------------------------------------------------------------------------- *
 * The point.
 * -------------------------------------------------------------------------- */

describe('cohort motes — the point on screen', () => {
  it('projects a WORLD diameter the way the peer sprites do', () => {
    // Half the drawing buffer times the projection's own 1/tan(fov/2), over the
    // view depth. Doubling the buffer height doubles the point; doubling the
    // distance halves it.
    const base = {
      diameter: COHORT_MOTE_SIZE,
      viewportHeight: 1440,
      projection11: 1 / Math.tan((50 * Math.PI) / 180 / 2),
      viewZ: -12,
    };
    const size = cohortMotePointSizePx(base);
    expect(size).toBeGreaterThan(COHORT_MOTE_PIXEL_FLOOR);
    expect(cohortMotePointSizePx({ ...base, viewportHeight: 2880 }))
      .toBeCloseTo(size * 2, 9);
    expect(cohortMotePointSizePx({ ...base, viewZ: -24 })).toBeCloseTo(size / 2, 9);
  });

  it('never draws a point below a pixel and a half', () => {
    // ⚠️ A SUB-PIXEL POINT DOES NOT DIM, IT FLICKERS: rasterisation quantises
    // the size, so it is one FULL pixel or none depending on where its centre
    // lands that frame, and a field of them boils.
    for (const viewZ of [-50, -200, -1000, -1e5]) {
      expect(cohortMotePointSizePx({
        diameter: COHORT_MOTE_SIZE * 0.6,
        viewportHeight: 1080,
        projection11: 2.14,
        viewZ,
      })).toBeGreaterThanOrEqual(COHORT_MOTE_PIXEL_FLOOR);
    }
    // …and a camera sitting exactly on a mote does not divide by zero.
    expect(Number.isFinite(cohortMotePointSizePx({
      diameter: COHORT_MOTE_SIZE, viewportHeight: 1080, projection11: 2.14, viewZ: 0,
    }))).toBe(true);
  });

  it('grows as it falls, on the same ramp the brightness rises on', () => {
    const seed = cohortMoteSeed(0.2, 60);
    const early = cohortMoteAt({ seed, strength: FULL, time: 0, pxPerWu: NEAR_PX });
    const late = cohortMoteAt({
      seed, strength: FULL, time: early.life - early.age - 0.5, pxPerWu: NEAR_PX,
    });
    expect(late.near).toBeGreaterThan(early.near);
    expect(late.diameter).toBeGreaterThan(early.diameter);
    // The two ends of the ramp, in world units: 0.19 wu of dim grain at the rim
    // and 0.48 wu about to fall in.
    expect(COHORT_MOTE_SIZE * 0.6).toBeCloseTo(0.192, 6);
    expect(COHORT_MOTE_SIZE * (0.6 + 0.9)).toBeCloseTo(0.48, 6);
  });
});

/* -------------------------------------------------------------------------- *
 * Colour.
 * -------------------------------------------------------------------------- */

describe('cohort motes — the colour is the disc’s', () => {
  it('is the disc’s mid stop pushed toward its core, at the same warmth', () => {
    // ⭐⭐ A MOTE IS A PARCEL OF THE SUBSTANCE THE DISC IS MADE OF, so it cannot
    // carry a hue of its own — and one knob moves both.
    for (const warmth of [0, 0.35, 1]) {
      const stops = cohortDiscStops(warmth);
      const colour = cohortMoteColor(warmth);
      for (let channel = 0; channel < 3; channel += 1) {
        expect(colour[channel]).toBeCloseTo(
          stops.mid[channel]
            + (stops.core[channel] - stops.mid[channel]) * COHORT_MOTE_WHITEN,
          12,
        );
      }
    }
    // Cold, as approved. ⚠️ NO SINGLE LERP OF THE DISC'S STOPS REPRODUCES THE
    // PREVIEW'S TRIPLE EXACTLY, because the preview's (0.75, 0.95, 1.0) was
    // picked by hand and is not on the line between the mid stop and the core:
    // red wants 0.615 of the way and green wants 0.667. 0.62 is the
    // least-squares point, and the largest disagreement is 0.007 on GREEN — two
    // levels of an 8-bit channel, on a point a pixel and a half across. Being ON
    // the disc's ramp is worth more than matching a hand-picked triple.
    const cold = cohortMoteColor(0);
    for (const [channel, preview] of [[0, 0.75], [1, 0.95], [2, 1.0]] as const) {
      expect(`channel ${channel}: ${Math.abs(cold[channel] - preview) < 0.01}`)
        .toBe(`channel ${channel}: true`);
    }
    expect(cold[2]).toBeCloseTo(1.0, 6);
    // Warm follows the film's grade rather than staying cyan in an orange disc.
    const warm = cohortMoteColor(1);
    expect(warm[0]).toBeGreaterThan(warm[2]);
    expect(cold[2]).toBeGreaterThan(cold[0]);
  });
});

/* -------------------------------------------------------------------------- *
 * The geometry.
 * -------------------------------------------------------------------------- */

describe('cohort motes — the geometry the layer drives', () => {
  it('allocates exactly capacity × 96 of every lane', () => {
    for (const capacity of [0, 1, 6, 64]) {
      const geometry = buildCohortMotesGeometry(capacity);
      const count = capacity * COHORT_MOTES_PER_COHORT;
      for (const name of [
        'position', 'aOrigin', 'aSeed', 'aStrength', 'aGulp', 'aMass',
      ]) {
        expect(`${name}: ${geometry.getAttribute(name).count}`)
          .toBe(`${name}: ${count}`);
      }
      expect(geometry.getAttribute('position').itemSize).toBe(3);
      expect(geometry.getAttribute('aOrigin').itemSize).toBe(3);
      for (const name of ['aSeed', 'aStrength', 'aGulp', 'aMass']) {
        expect(geometry.getAttribute(name).itemSize).toBe(1);
      }
      expect(geometry.drawRange).toEqual({ start: 0, count: 0 });
    }
    expect(() => buildCohortMotesGeometry(-1)).toThrow(/whole count/);
    expect(() => buildCohortMotesGeometry(1.5)).toThrow(/whole count/);
  });

  it('submits only the committed cohort prefix', () => {
    const geometry = buildCohortMotesGeometry(64);
    setCohortMotesDrawCount(geometry, 7);
    expect(geometry.drawRange).toEqual({
      start: 0,
      count: 7 * COHORT_MOTES_PER_COHORT,
    });
    setCohortMotesDrawCount(geometry, 0);
    expect(geometry.drawRange.count).toBe(0);
    expect(() => setCohortMotesDrawCount(geometry, 65)).toThrow(/capacity of 64/);
  });

  it('clears initialization ranges and uploads one gulp as exactly 384 bytes', () => {
    const geometry = buildCohortMotesGeometry(64);
    writeCohortMotes(geometry, 0, { x: 1, y: 2, z: 3 }, 0.2, 0.4, 1);
    for (const name of ['position', 'aOrigin', 'aSeed', 'aStrength', 'aMass']) {
      const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
      expect(attribute.updateRanges.length).toBeGreaterThan(0);
      attribute.onUploadCallback();
      expect(attribute.updateRanges).toEqual([]);
    }
    const gulp = geometry.getAttribute('aGulp') as THREE.BufferAttribute;
    gulp.onUploadCallback();
    stampCohortMotes(geometry, 6, 20);
    expect(gulp.updateRanges).toEqual([{
      start: 6 * COHORT_MOTES_PER_COHORT,
      count: COHORT_MOTES_PER_COHORT,
    }]);
    expect(gulp.updateRanges[0].count * Float32Array.BYTES_PER_ELEMENT).toBe(384);
  });

  it('coalesces touching attribute ranges before the next upload', () => {
    const geometry = buildCohortMotesGeometry(4);
    const mass = geometry.getAttribute('aMass') as THREE.BufferAttribute;
    mass.onUploadCallback();
    markCohortAttributeRange(mass, 96, 96);
    markCohortAttributeRange(mass, 192, 96);
    expect(mass.updateRanges).toEqual([{ start: 96, count: 192 }]);
  });

  it('starts every slot silent, at the sentinel, and at full size', () => {
    // ⚠️⚠️ A ZERO-FILLED GULP LANE FLARES THE WHOLE COLONY ON LOAD, because
    // `uTime` is also zero at that instant.
    //
    // ⚠️⚠️ …AND A ZERO-FILLED MASS LANE IS THE MIRROR IMAGE OF THAT: not a
    // quiet cohort but a mark with NO EXTENT, whose life is zero and whose
    // `shifted / life` is a NaN the brightness test does not catch. One is the
    // mass of a cohort nothing has been said about, which is the form this draw
    // had before the lane existed — so an unwritten slot is TODAY'S picture and
    // never a twentieth of it.
    const geometry = buildCohortMotesGeometry(4);
    const gulp = geometry.getAttribute('aGulp');
    const strength = geometry.getAttribute('aStrength');
    const mass = geometry.getAttribute('aMass');
    for (let mote = 0; mote < gulp.count; mote += 1) {
      expect(gulp.getX(mote)).toBe(COHORT_NEVER_WON);
      expect(strength.getX(mote)).toBe(0);
      expect(mass.getX(mote)).toBe(1);
    }
  });

  it('writes exactly one cohort’s 96 slots and leaves its neighbours alone', () => {
    const geometry = buildCohortMotesGeometry(3);
    // ⚠️ THE LAST ARGUMENT IS THE SIGNED LANE VALUE, so this one is a cohort of
    // 0.45 mass winding the other way — the two facts in one float.
    writeCohortMotes(geometry, 1, { x: 12, y: 22, z: -7 }, 0.31, 0.64, -0.45);
    const origin = geometry.getAttribute('aOrigin');
    const position = geometry.getAttribute('position');
    const seeds = geometry.getAttribute('aSeed');
    const strength = geometry.getAttribute('aStrength');
    const mass = geometry.getAttribute('aMass');
    for (let mote = 0; mote < origin.count; mote += 1) {
      const own = mote >= COHORT_MOTES_PER_COHORT
        && mote < COHORT_MOTES_PER_COHORT * 2;
      expect(`${mote}: ${origin.getX(mote)}`).toBe(`${mote}: ${own ? 12 : 0}`);
      expect(`${mote}: ${origin.getY(mote)}`).toBe(`${mote}: ${own ? 22 : 0}`);
      expect(`${mote}: ${origin.getZ(mote)}`).toBe(`${mote}: ${own ? -7 : 0}`);
      // ⚠️ `position` is what three takes the draw's vertex count and its bound
      // from, and it carries the same seat.
      expect(position.getX(mote)).toBe(origin.getX(mote));
      expect(position.getZ(mote)).toBe(origin.getZ(mote));
      expect(strength.getX(mote)).toBeCloseTo(own ? 0.64 : 0, 6);
      // ⭐ WRITTEN VERBATIM, SIGN AND ALL — this writer packs nothing and
      // clamps nothing; `cohortMassLaneValue` is where a mass becomes a lane.
      // A neighbour keeps the 1 the geometry was built with. ⚠️ `Math.fround`
      // because the lane is a Float32Array and 0.45 is not one of its numbers.
      expect(`${mote}: ${mass.getX(mote)}`)
        .toBe(`${mote}: ${own ? Math.fround(-0.45) : 1}`);
      if (own) {
        expect(seeds.getX(mote))
          .toBeCloseTo(cohortMoteSeed(0.31, mote - COHORT_MOTES_PER_COHORT), 4);
      } else {
        expect(seeds.getX(mote)).toBe(0);
      }
    }
    // Writing the same cohort twice lands on the same 96 motes, so a re-plan
    // that keeps a cohort in place does not teleport its specks.
    const before = Array.from({ length: COHORT_MOTES_PER_COHORT }, (_, index) =>
      seeds.getX(COHORT_MOTES_PER_COHORT + index));
    writeCohortMotes(geometry, 1, { x: 12, y: 22, z: -7 }, 0.31, 0.64, -0.45);
    for (let index = 0; index < COHORT_MOTES_PER_COHORT; index += 1) {
      expect(seeds.getX(COHORT_MOTES_PER_COHORT + index)).toBe(before[index]);
    }
    expect(() => writeCohortMotes(geometry, 3, { x: 0, y: 0, z: 0 }, 0, 1, 1))
      .toThrow(/outside a capacity of 3/);
  });

  it('eases one cohort’s mass lane alone, and flags that one upload', () => {
    // ⭐⭐ THE SLEW WRITES SIXTY TIMES A SECOND AND MUST COST ONE LANE. A mass
    // eases toward a new week over a second and a half; re-laying the seat, the
    // strength and 96 HASHED seeds on every frame of that ease — and flagging
    // five uploads where one lane moved — is what this writer exists to avoid.
    const geometry = buildCohortMotesGeometry(3);
    const mass = geometry.getAttribute('aMass') as THREE.BufferAttribute;
    const seeds = geometry.getAttribute('aSeed') as THREE.BufferAttribute;
    const strength = geometry.getAttribute('aStrength') as THREE.BufferAttribute;
    writeCohortMotes(geometry, 1, { x: 4, y: 0, z: 9 }, 0.77, 0.5, 1);
    // ⚠️ `needsUpdate` IS WRITE-ONLY on a BufferAttribute, so the version is
    // what says an upload was flagged.
    const seedVersion = seeds.version;
    const strengthVersion = strength.version;
    const before = mass.version;
    writeCohortMotesMass(geometry, 1, -0.6);
    expect(mass.version).toBe(before + 1);
    // …and NOTHING else moved: not the seeds, not the strength, not the seats.
    expect(seeds.version).toBe(seedVersion);
    expect(strength.version).toBe(strengthVersion);
    let eased = 0;
    for (let mote = 0; mote < mass.count; mote += 1) {
      const own = mote >= COHORT_MOTES_PER_COHORT
        && mote < COHORT_MOTES_PER_COHORT * 2;
      expect(`${mote}: ${mass.getX(mote)}`)
        .toBe(`${mote}: ${own ? Math.fround(-0.6) : 1}`);
      if (own) eased += 1;
    }
    expect(eased).toBe(COHORT_MOTES_PER_COHORT);
    expect(strength.getX(COHORT_MOTES_PER_COHORT)).toBe(0.5);
    expect(() => writeCohortMotesMass(geometry, 3, 1))
      .toThrow(/outside a capacity of 3/);
    expect(() => writeCohortMotesMass(buildCohortMotesGeometry(0), 0, 1))
      .toThrow(/outside a capacity of 0/);
  });

  it('stamps exactly one cohort’s 96 slots, and flags the upload', () => {
    // ⚠️ THE WHOLE COHORT OR NOTHING: the burst is a fact about the cohort, and a
    // partial write would show as a wedge of the intake flaring.
    const geometry = buildCohortMotesGeometry(3);
    const gulp = geometry.getAttribute('aGulp') as THREE.BufferAttribute;
    // ⚠️ `needsUpdate` IS A WRITE-ONLY ACCESSOR on a BufferAttribute — reading it
    // gives `undefined` — so what says the upload was flagged is the version it
    // increments.
    const before = gulp.version;
    stampCohortMotes(geometry, 2, 41.5);
    expect(gulp.version).toBe(before + 1);
    let stamped = 0;
    for (let mote = 0; mote < gulp.count; mote += 1) {
      const own = mote >= COHORT_MOTES_PER_COHORT * 2;
      expect(`${mote}: ${gulp.getX(mote)}`)
        .toBe(`${mote}: ${own ? 41.5 : COHORT_NEVER_WON}`);
      if (own) stamped += 1;
    }
    expect(stamped).toBe(COHORT_MOTES_PER_COHORT);
    expect(() => stampCohortMotes(geometry, 3, 1)).toThrow(/outside a capacity of 3/);
    expect(() => stampCohortMotes(buildCohortMotesGeometry(0), 0, 1))
      .toThrow(/outside a capacity of 0/);
  });
});

/* -------------------------------------------------------------------------- *
 * The material.
 * -------------------------------------------------------------------------- */

describe('cohort motes — the material', () => {
  const material = makeCohortMotesMaterial();

  it('adds light and never removes it, and writes no depth', () => {
    // ⭐ THE LENS QUAD BESIDE IT IS THE COLONY'S ONE NORMAL-BLENDED DRAW, because
    // a shadow has to take light away. A mote has nothing to hide behind it.
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.toneMapped).toBe(false);
  });

  it('takes five lanes and no others', () => {
    // ⭐ THE FIFTH IS THE MASS, 96 COPIES WIDE LIKE THE REST. A Points geometry
    // is not instanced, so every per-cohort fact has to be widened; the mass
    // carries the hand in its SIGN rather than asking for a sixth.
    const attributes = [...material.vertexShader.matchAll(
      /^\s*attribute\s+(\w+)\s+(\w+)\s*;/gm,
    )].map((match) => `${match[1]} ${match[2]}`);
    expect(attributes).toEqual([
      'vec3 aOrigin', 'float aSeed', 'float aStrength', 'float aGulp',
      'float aMass',
    ]);
  });

  it('binds the approved preview’s numbers, and the lens’s where they are one fact', () => {
    const value = (name: string): unknown => material.uniforms[name]?.value;
    expect(value('uK')).toBe(COHORT_MOTE_K);
    expect(value('uSwirl')).toBe(MIST_SWIRL);
    expect(value('uOrbit')).toBe(COHORT_MOTE_ORBIT);
    expect(value('uReach')).toBe(COHORT_LENS_REACH);
    expect(value('uReachFar')).toBe(COHORT_MOTE_REACH_FAR);
    expect(value('uR0Min')).toBe(COHORT_MOTE_R0_MIN);
    expect(value('uR0Max')).toBe(COHORT_MOTE_R0_MAX);
    expect(value('uShadowR')).toBe(COHORT_MOTE_SHADOW_R);
    expect(value('uShadowRFar')).toBe(COHORT_MOTE_SHADOW_R_FAR);
    expect(value('uUnfoldLo')).toBe(COHORT_UNFOLD_LO);
    expect(value('uUnfoldHi')).toBe(COHORT_UNFOLD_HI);
    expect(value('uMoteSize')).toBe(COHORT_MOTE_SIZE);
    expect(value('uAmp')).toBe(COHORT_MOTE_AMP);
    expect(value('uTime')).toBe(0);
    // ⚠️ UNFOLDED RATHER THAN INVISIBLE before the layer's first frame: a
    // uniform nobody writes must show up as the wrong FORM, never as an empty
    // scene.
    expect(value('uPxScale')).toBe(1e6);
    const colour = value('uColor') as THREE.Color;
    const [r, g, b] = cohortMoteColor(0);
    expect(colour.r).toBeCloseTo(r, 6);
    expect(colour.g).toBeCloseTo(g, 6);
    expect(colour.b).toBeCloseTo(b, 6);
    // The whole uniform list, so an addition is a deliberate edit.
    expect(Object.keys(material.uniforms).sort()).toEqual([
      'uAmp', 'uColor', 'uContextEnergy', 'uK', 'uMoteSize', 'uOrbit', 'uPxScale', 'uR0Max',
      'uR0Min', 'uReach', 'uReachFar', 'uShadowR', 'uShadowRFar', 'uSwirl',
      'uTime', 'uUnfoldHi', 'uUnfoldLo', 'uViewportHeight',
    ]);
  });

  it('lays every mote in the membrane, with no term that could lift one out', () => {
    // ⛔ NEVER UPWARD, and here it is structural: the offset's Y is the literal
    // zero, and there is no other place in the program a Y is written.
    expect(material.vertexShader)
      .toContain('vec3 local = aOrigin + vec3(cos(theta) * r, 0.0, sin(theta) * r);');
  });
});
