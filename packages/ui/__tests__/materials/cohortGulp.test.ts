// The gulp lane — the one per-block input the cohort mark has, and the
// sentinel that keeps it silent until a block actually arrives.
//
// ⚠️⚠️⚠️ A SENTINEL OF ZERO WOULD FLARE EVERY COHORT ON LOAD, and R16 shipped
// exactly that. The lane holds the SIM SECOND of the block a cohort won, the
// envelope is a function of `uTime - aGulp`, and an unfilled `Float32Array` is
// all zeros — so a zero-filled lane says "every cohort won at t = 0" at the one
// moment `uTime` is also zero. The whole colony then gulps for the first half
// second of every session, for a block none of them mined.
//
// ⭐ THE FIX IS ARITHMETIC RATHER THAN A FLAG. `COHORT_NEVER_WON` is far enough
// below any reachable `uTime` that the envelope is identically zero there, so
// "has never won" needs no branch, no second lane and no `isValid` bit: it is
// simply a point on the same curve where the curve is zero. This file is where
// that claim is measured rather than asserted.
//
// `ColonyCohorts` stamps the lane, for the ONE mark whose `nodeId` equals the
// flood's `entryId`, in SIM SECONDS off the same `simClock` it writes `uTime`
// from — that wiring is pinned in `ColonySightedNodes.test.tsx` and the lane
// walks in `colonyCohortShares.test.ts`. What is pinned HERE is the curve those
// numbers are dropped into, and the silence at the sentinel that a cohort which
// has never won relies on.
import { describe, expect, it } from 'vitest';
import {
  COHORT_GULP_FALL,
  COHORT_GULP_GLSL,
  COHORT_GULP_INTERIOR,
  COHORT_GULP_RISE,
  COHORT_NEVER_WON,
} from '../../src/materials/colonyCohort';
import { makeCohortLensMaterial } from '../../src/materials/colonyLens';
import {
  COHORT_MOTE_GULP_BURST,
  makeCohortMotesMaterial,
} from '../../src/materials/colonyMotes';

/**
 * The envelope, exactly as `COHORT_GULP_GLSL` computes it.
 *
 * ⚠️ Tied to the shipped string by `the mirror is the shipped snippet` below,
 * because a mirror that drifts from its shader proves nothing — R15 shipped one
 * that did.
 */
const gulp = (age: number): number =>
  age > 0
    ? Math.exp(-age / COHORT_GULP_FALL) * (1 - Math.exp(-age / COHORT_GULP_RISE))
    : 0;

describe('the cohort gulp — the sentinel', () => {
  it('is EXACTLY zero for a cohort that has never won, at every clock a session reaches', () => {
    // ⭐ `uTime` is `simClock.elapsedSec` and grows without bound; 1e5 seconds
    // is 27 hours of sim time, well past any session. Over the whole of that
    // range the envelope at the sentinel is exactly zero — `toBe(0)`, never
    // "close to" — because `exp(-2.2e6)` underflows to zero in float64 long
    // before the multiplication ever happens.
    expect(COHORT_NEVER_WON).toBe(-1e6);
    for (let k = 0; k <= 1000; k += 1) {
      const uTime = (k / 1000) * 1e5;
      expect(gulp(uTime - COHORT_NEVER_WON)).toBe(0);
    }
    // ⚠️ AND THE COMPARISON THAT MATTERS: at a sentinel of ZERO the same lane
    // is at its PEAK for the first tenth of a second of every session.
    expect(gulp(0 - 0)).toBe(0); // t = 0 exactly is the one instant it is not…
    expect(gulp(0.1284 - 0)).toBeGreaterThan(0.66); // …and a frame later it is.
    // The margin is not marginal: the sentinel is 2.2 million e-foldings out.
    expect(-COHORT_NEVER_WON / COHORT_GULP_FALL).toBeGreaterThan(2e6);
  });

  it('peaks inside the first half second and is gone within three', () => {
    // ⭐ A GULP AND NOT A GLOW. The attack is 0.06 s and the decay 0.45 s, so
    // the mouth's answer to a block is a swallow the eye reads as one event —
    // the shape `ColonyEdges`' own outward surge already fires on.
    let peakAge = 0;
    let peak = 0;
    for (let k = 0; k <= 20000; k += 1) {
      const age = (k / 20000) * 5;
      const value = gulp(age);
      if (value > peak) {
        peak = value;
        peakAge = age;
      }
    }
    expect(peakAge).toBeGreaterThan(0);
    expect(peakAge).toBeLessThan(0.5);
    expect(peakAge).toBeCloseTo(0.1284, 3);
    expect(peak).toBeCloseTo(0.6633, 4);
    // Monotone up to the peak and monotone down after it: one event, not two.
    for (let k = 1; k <= 400; k += 1) {
      const before = gulp((k / 400) * peakAge * 0.999);
      expect(before).toBeGreaterThan(gulp(((k - 1) / 400) * peakAge * 0.999));
    }
    expect(gulp(1)).toBeLessThan(peak * 0.2);
    expect(gulp(3)).toBeLessThan(peak * 0.005);
    // ⭐ Bounded strictly under 1, so both multipliers it drives are bounded
    // too: the disc's pile can be at most 2.46x itself and a speck 2.66x.
    expect(peak).toBeLessThan(1);
    expect(1 + COHORT_GULP_INTERIOR * peak).toBeCloseTo(2.4593, 3);
    expect(1 + COHORT_MOTE_GULP_BURST * peak).toBeCloseTo(2.6583, 3);
    // ⚠️ THE SPECKS BURST HARDER THAN THE FIELD THEY FALL THROUGH, which is the
    // opposite ordering to the retired mouth's (its interior 2.2 gulped harder
    // than its drawn lip's 1.6, so the light came from inside the hole). Here
    // the reason is legibility rather than anatomy: the disc is a wide dim field
    // where a 2.5x lift is a wash, and a mote is a 1.5 px point where it is the
    // one thing the eye can follow to the block it belongs to.
    expect(COHORT_MOTE_GULP_BURST).toBeGreaterThan(COHORT_GULP_INTERIOR);
  });

  it('the mirror is the shipped snippet, term for term', () => {
    const squash = (glsl: string): string => glsl.replace(/\s+/g, ' ').trim();
    expect(squash(COHORT_GULP_GLSL)).toBe(
      'float gulpAge = uTime - vGulp; float gulp = gulpAge > 0.0'
        + ' ? exp(-gulpAge / 0.45) * (1.0 - exp(-gulpAge / 0.06)) : 0.0;',
    );
    // ⭐ THE TWO TIME CONSTANTS ARE CONSTANTS AND NOT LITERALS, so a retune has
    // one place to happen and the mirror above cannot fall behind it.
    expect(COHORT_GULP_FALL).toBe(0.45);
    expect(COHORT_GULP_RISE).toBe(0.06);
    expect(COHORT_GULP_GLSL).toContain(COHORT_GULP_FALL.toFixed(2));
    expect(COHORT_GULP_GLSL).toContain(COHORT_GULP_RISE.toFixed(2));
  });

  it('reaches BOTH draws, on the same clock and in two different stages', () => {
    const lens = makeCohortLensMaterial();
    const motes = makeCohortMotesMaterial();
    // ⚠️⚠️ ONE CLOCK, OR THE DIFFERENCE IS MEANINGLESS. The envelope is
    // `uTime - vGulp`, and `uTime` is written from `simClock.elapsedSec` by
    // `ColonyCohorts`. So whatever stamps the lane has to stamp SIM SECONDS —
    // not `performance.now()`, not a wall clock, not milliseconds. A stamp on
    // any other clock does not merely shift the flare; it puts it at a
    // difference of hundreds of thousands, which is zero.
    for (const [name, glsl] of [
      ['lens.fragmentShader', lens.fragmentShader],
      ['motes.vertexShader', motes.vertexShader],
    ] as const) {
      expect(`${name}: gulp`).toBe(`${name}: gulp`);
      expect(glsl).toContain('float gulpAge = uTime - vGulp;');
      expect(glsl).toContain('uniform float uTime;');
    }

    // ⭐ THE LENS SPENDS IT IN THE FRAGMENT, so the lane crosses the
    // interpolator: the pile is a function of where on the disc a bent ray
    // landed, and there is no per-instance answer to that.
    expect(lens.vertexShader).toContain('attribute float aGulp;');
    expect(lens.vertexShader).toContain('vGulp = aGulp;');
    expect(lens.vertexShader).toContain('varying float vGulp;');
    expect(lens.fragmentShader).toContain('varying float vGulp;');
    expect(lens.fragmentShader).toContain(`${COHORT_GULP_INTERIOR.toFixed(1)} * gulp`);

    // ⭐⭐ THE MOTES SPEND IT IN THE VERTEX, where `aGulp` is already in scope —
    // so the shared snippet's `vGulp` is bound to a LOCAL rather than carried
    // across an interpolator for nothing. The name is what the snippet asks for;
    // the stage is the program's own business.
    expect(motes.vertexShader).toContain('attribute float aGulp;');
    expect(motes.vertexShader).toContain('float vGulp = aGulp;');
    expect(motes.vertexShader).not.toContain('varying float vGulp;');
    expect(motes.fragmentShader).not.toContain('vGulp');
    expect(motes.vertexShader.indexOf('float vGulp = aGulp;'))
      .toBeLessThan(motes.vertexShader.indexOf(COHORT_GULP_GLSL));
    expect(motes.vertexShader)
      .toContain(`${COHORT_MOTE_GULP_BURST.toFixed(1)} * gulp`);
  });
});
