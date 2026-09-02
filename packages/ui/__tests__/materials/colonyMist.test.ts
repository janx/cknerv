// What the mist under the colony plane IS, arithmetically — and the two laws
// it shares with the mouth above it.
//
// ⭐⭐⭐ THE STANDING LAW OF THE WHOLE FEATURE IS THAT NOTHING IS EVER DRAWN
// ABOVE THE MEMBRANE, and the mist is the first layer that could break it: it
// is the only draw that puts geometry under the plane, and a mound is a lift.
// So the vertex stage's height is pinned twice here — as arithmetic over the
// whole patch, and as the source text that produces it.
//
// ⭐⭐ THE SECOND LAW IS THAT THE MOUND'S TOP AND THE WINDOW'S SURFACE ARE ONE
// SURFACE. `COHORT_INTAKE_LEVEL` and `COHORT_RIM_R` are imported from
// `colonyCohort.ts` rather than restated, and the tests below assert the IMPORT
// as well as the value: a mist that went dark inside a radius the mouth no
// longer has would be two holes at one cohort, drawn by two layers that both
// believed they were right.
//
// ⚠️ A MIRROR THAT DRIFTS PROVES NOTHING (R15 shipped exactly that), so every
// mirror below is tied to the shipped GLSL by `the mirrors above are the shipped
// shaders`, term for term.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  COHORT_CONTEXT_ENERGY_GLSL,
  COHORT_GULP_FALL,
  COHORT_GULP_GLSL,
  COHORT_GULP_INTERIOR,
  COHORT_GULP_RISE,
  COHORT_INTAKE_LEVEL,
  COHORT_INTERIOR_COLD,
  COHORT_NEVER_WON,
  COHORT_RIM_R,
} from '../../src/materials/colonyCohort';
import {
  MIST_AMP,
  MIST_CONC,
  MIST_CONTRAST_FAR,
  MIST_CONTRAST_NEAR,
  MIST_DRIFT,
  MIST_DRIFT_SIGN,
  MIST_FINE_HI,
  MIST_FINE_LO,
  MIST_FIL,
  MIST_FLOOR_DEPTH,
  MIST_GATE_IN,
  MIST_GRAIN,
  MIST_GULP_R,
  MIST_HAZE_BASE,
  MIST_HAZE_EDGE_IN,
  MIST_HAZE_EDGE_OUT,
  MIST_HAZE_ELLIPSE,
  MIST_HAZE_GRAIN,
  MIST_HAZE_SHEETS,
  MIST_MOUND_R,
  MIST_NOISE_CELLS,
  MIST_NOISE_SEED,
  MIST_NOISE_SIZE,
  MIST_PATCH_NEVER_ABOVE_GLSL,
  MIST_PATCH_SEGMENTS,
  MIST_PATH_MAX,
  MIST_PERIOD,
  MIST_REACH,
  MIST_RIDGE,
  MIST_RIDGE_POW,
  MIST_SINK_K,
  MIST_SWIRL,
  MIST_WAKE,
  MIST_WAKE_LEN,
  MIST_WAKE_W,
  makeCohortIntakePatchMaterial,
  makeMistHazeMaterial,
  makeMistNoiseTexture,
  mistBacktrace,
  mistCatchment,
  mistMoundLift,
  mistNoiseTile,
  mistPatchSupremum,
  mistSinkRadius,
  mistSpiralTurn,
  mistSurfaceDrop,
} from '../../src/materials/colonyMist';

const PATCH = makeCohortIntakePatchMaterial();
const HAZE = makeMistHazeMaterial();

/** Whitespace-insensitive, so a statement wrapped over lines still matches. */
const squash = (glsl: string): string => glsl.replace(/\s+/g, ' ');

/** ⚠️ Comment-free, so a word written in PROSE — `pow`, `texture` — can never be
 *  mistaken for code. The layer's own shader guards learned this first. */
const stripComments = (glsl: string): string =>
  glsl.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const PATCH_VERTEX = squash(stripComments(PATCH.vertexShader));
const PATCH_FRAGMENT = squash(stripComments(PATCH.fragmentShader));
const HAZE_VERTEX = squash(stripComments(HAZE.vertexShader));
const HAZE_FRAGMENT = squash(stripComments(HAZE.fragmentShader));

const SOURCE = readFileSync(
  resolve(process.cwd(), 'src/materials/colonyMist.ts'),
  'utf8',
);

/* -------------------------------------------------------------------------- *
 * The spiral: where a parcel of the medium was.
 * -------------------------------------------------------------------------- */

describe('colony mist — the spiral back-trace', () => {
  it('is the EXACT back-trace of a 2-D point sink: r0² = r² + k·τ', () => {
    // ⭐ NOT AN APPROXIMATION OF A SINK, AND THAT IS WHY THE FILAMENTS BEND
    // INTO THE MOUTH RATHER THAN POINTING AT IT. A 2-D sink of strength k has
    // radial velocity -k/(2r), so d(r²)/dt = -k exactly, and the radius a
    // parcel held τ seconds ago is exactly sqrt(r² + kτ). Anything else is a
    // warp toward a point, which reads as a star.
    for (const r of [0.05, 0.4, 1.6, 3, 7, 13.9]) {
      for (const tau of [0, 0.4, 1, 3, 6]) {
        const r0 = mistSinkRadius(r, MIST_SINK_K, tau);
        expect(r0 * r0).toBeCloseTo(r * r + MIST_SINK_K * tau, 9);
        // Monotonically outward: a parcel is always FURTHER out in the past.
        expect(r0).toBeGreaterThanOrEqual(r - 1e-12);
      }
    }
  });

  it('winds by exactly swirl·ln(r0/r), which is what makes it a log spiral', () => {
    // ⭐ A PURE SINK IS A DRAIN AND READS AS RADIAL STREAKS — the exact failure
    // `COHORT_FACE_STRIAE` documents at low count. A circulation `swirl` times
    // the radial flow turns a parcel by this much per e-fold of radius, and a
    // constant turn per e-fold IS the definition of a logarithmic spiral.
    for (const r of [0.05, 1.6, 7, 13.9]) {
      for (const tau of [0.25, 1, 6]) {
        const r0 = mistSinkRadius(r, MIST_SINK_K, tau);
        expect(mistSpiralTurn(r, r0, MIST_SWIRL))
          .toBeCloseTo(MIST_SWIRL * Math.log(r0 / r), 12);
      }
    }
    // Per e-fold of radius the turn is the ratio itself, at every radius.
    for (const r of [0.5, 2, 9]) {
      expect(mistSpiralTurn(r, r * Math.E, MIST_SWIRL)).toBeCloseTo(MIST_SWIRL, 12);
    }
  });

  it('is the IDENTITY at τ = 0, so the medium at rest is the medium', () => {
    // ⚠️ The two cross-faded phases both pass through τ = 0 once per cycle. If
    // the back-trace moved a parcel there, the whole medium would jump every
    // `MIST_PERIOD` seconds — which is exactly the reset the cross-fade exists
    // to hide, reintroduced inside it.
    for (const [x, z] of [[0.3, 0], [1.6, 1.6], [-4, 9], [13.9, 0], [-2, -0.1]]) {
      const [bx, bz] = mistBacktrace(x, z, MIST_SINK_K, MIST_SWIRL, 0);
      expect(bx).toBeCloseTo(x, 12);
      expect(bz).toBeCloseTo(z, 12);
    }
    expect(mistSinkRadius(3, MIST_SINK_K, 0)).toBe(3);
    expect(mistSpiralTurn(3, 3, MIST_SWIRL)).toBe(0);
  });

  it('reduces to the pure sink form at the mouth and to nothing at the reach', () => {
    // ⚠️ `rr = mix(r, r0, w)` with `w` the catchment weight, so the pull is
    // FULL where the mouth is and EXACTLY the identity at `MIST_REACH` — which
    // is what keeps the patch seamless where it stops. It is not a fudge: a
    // back-trace that still moved parcels at the disc's edge would draw a
    // visible discontinuity against the neighbouring patch and against nothing
    // at all where there is no neighbour.
    const tau = 3;
    // Close to the sink the weight is ~1, so the traced radius is the pure one.
    const near = mistBacktrace(0.05, 0, MIST_SINK_K, MIST_SWIRL, tau);
    expect(Math.hypot(...near))
      .toBeCloseTo(mistSinkRadius(0.05, MIST_SINK_K, tau), 3);
    // At the reach the weight is exactly zero, so the point does not move.
    expect(mistCatchment(MIST_REACH, MIST_REACH)).toBe(0);
    const edge = mistBacktrace(MIST_REACH, 0, MIST_SINK_K, MIST_SWIRL, tau);
    expect(edge[0]).toBeCloseTo(MIST_REACH, 12);
    expect(edge[1]).toBeCloseTo(0, 12);
  });

  it('the mirror is the shipped GLSL, expression for expression', () => {
    // ⚠️ R15 SHIPPED A TRANSLITERATION THAT SILENTLY DRIFTED FROM ITS SHADER,
    // and every proof above is worthless if this one fails. Both formulas are
    // pinned as TEXT in the fragment source.
    expect(PATCH_FRAGMENT).toContain('float r0 = sqrt(r2 + uK * tau);');
    expect(PATCH_FRAGMENT).toContain('float rr = mix(r, r0, w);');
    expect(PATCH_FRAGMENT).toContain('float ang = uSwirl * log(rr / r);');
    // …and the weight the mix is taken on is the catchment, squared, the same
    // expression `mistCatchment` computes.
    expect(PATCH_FRAGMENT).toContain('float w = 1.0 - r2 / (uReach * uReach);');
    expect(PATCH_FRAGMENT).toContain('w *= w;');
    // The drift is SUBTRACTED: τ is an age, so a parcel now here was one drift
    // step BACK along the flow. (The preview added it; its ambient swirl was a
    // divergence-free wiggle where the sign is invisible. This one's is not.)
    expect(PATCH_FRAGMENT).toContain('vec2 d = q - vDrift * (uDrift * tau);');
    // And the rotation is the one the turn describes, applied to the offset.
    expect(PATCH_FRAGMENT)
      .toContain('return vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y) / r * rr;');
  });
});

/* -------------------------------------------------------------------------- *
 * The mound — and the law that nothing is drawn above the plane.
 * -------------------------------------------------------------------------- */

describe('colony mist — the mound', () => {
  it('is 1 at the sink and 0 with ZERO DERIVATIVE at its own radius', () => {
    // ⭐ THE ZERO SLOPE IS THE WHOLE POINT OF THE SQUARE. `(1 - x)²` has
    // derivative `-2(1 - x)`, which vanishes at `x = 1`, so the mound meets the
    // flat floor tangentially: no crease anywhere on the silhouette, from any
    // camera, at any subdivision.
    expect(mistMoundLift(0, MIST_MOUND_R)).toBe(1);
    expect(mistMoundLift(MIST_MOUND_R, MIST_MOUND_R)).toBe(0);
    expect(mistMoundLift(MIST_MOUND_R * 1.5, MIST_MOUND_R)).toBe(0);
    // The derivative, measured rather than argued: a one-sided difference just
    // inside the edge falls off as the step, which is what a double root does.
    for (const h of [1e-2, 1e-3, 1e-4]) {
      const slope = (mistMoundLift(MIST_MOUND_R, MIST_MOUND_R)
        - mistMoundLift(MIST_MOUND_R - h, MIST_MOUND_R)) / h;
      expect(Math.abs(slope)).toBeLessThan(3 * h);
    }
    // Monotone in between: a mound, never a ring.
    let previous = Infinity;
    for (let k = 0; k <= 200; k += 1) {
      const lift = mistMoundLift((k / 200) * MIST_MOUND_R, MIST_MOUND_R);
      expect(lift).toBeLessThanOrEqual(previous + 1e-12);
      previous = lift;
    }
  });

  it('puts the mound’s top EXACTLY at the level the window already shows', () => {
    // ⭐⭐⭐ ONE CONSTANT, TWO CONSUMERS, AND THEY MUST NEVER BECOME TWO
    // NUMBERS. What the hole shows and what the mist beside it does are one
    // surface. If they ever drift, a viewer looking INTO the mouth sees the
    // medium at one height and a viewer looking at the mist beside it sees
    // another, and the two draws stop being one substance.
    expect(mistSurfaceDrop(0)).toBe(COHORT_INTAKE_LEVEL);
    expect(mistSurfaceDrop(MIST_MOUND_R)).toBe(MIST_FLOOR_DEPTH);
    expect(mistSurfaceDrop(MIST_REACH)).toBe(MIST_FLOOR_DEPTH);
    // The uniform is the shared constant and not a literal, which is the whole
    // mechanism: `cohortRise` has ONE place to write, and it moves the face's
    // `uLevel` and this mound's top together.
    expect(PATCH.uniforms.uLevel.value).toBe(COHORT_INTAKE_LEVEL);
    expect(SOURCE).toContain("uLevel: { value: COHORT_INTAKE_LEVEL }");
    expect(SOURCE).toContain("COHORT_INTAKE_LEVEL,");
    expect(SOURCE).not.toMatch(/uLevel:\s*\{\s*value:\s*0\.7\s*\}/);
  });

  it('NEVER puts a vertex above the membrane, at any radius or knob', () => {
    // ⛔⛔⛔ THE STANDING LAW OF THIS WHOLE FEATURE. The cohort never emits
    // upward, and the mist is the only draw that could break that by accident:
    // it is the one layer with geometry under the plane, and a mound is a lift.
    //
    // The height is `originY - mix(uFloorDepth, uLevel, lift)`. A mix of two
    // POSITIVE depths lies between them, so the drop is positive at every
    // vertex — no branch, no clamp, and nothing a knob can invert as long as
    // both depths stay positive.
    for (const level of [0.2, COHORT_INTAKE_LEVEL, 1.4]) {
      for (const floor of [1.0, MIST_FLOOR_DEPTH, 6]) {
        for (let k = 0; k <= 400; k += 1) {
          const r = (k / 400) * MIST_REACH * Math.SQRT2; // out to the quad's corner
          const drop = mistSurfaceDrop(r, floor, level, MIST_MOUND_R);
          expect(drop).toBeGreaterThan(0);
          expect(drop).toBeGreaterThanOrEqual(Math.min(level, floor) - 1e-12);
          expect(drop).toBeLessThanOrEqual(Math.max(level, floor) + 1e-12);
        }
      }
    }
    // And the same claim as SOURCE, because the arithmetic above is a mirror.
    // The vertex stage subtracts the drop and can do nothing else with it.
    expect(squash(MIST_PATCH_NEVER_ABOVE_GLSL))
      .toBe('float drop = mix(uFloorDepth, uLevel, lift); vec3 local = vec3(offset.x, -drop, offset.y);');
    expect(PATCH_VERTEX).toContain(squash(MIST_PATCH_NEVER_ABOVE_GLSL));
    // ⚠️ There is exactly one place the local point is built, and one sign.
    expect([...PATCH_VERTEX.matchAll(/vec3 local =/g)]).toHaveLength(1);
    expect(PATCH_VERTEX).not.toMatch(/vec3 local = vec3\([^)]*\+\s*drop/);
    // Both depths ship positive, which is what the mix's bound rests on.
    expect(PATCH.uniforms.uFloorDepth.value).toBeGreaterThan(0);
    expect(PATCH.uniforms.uLevel.value).toBeGreaterThan(0);
    expect(MIST_FLOOR_DEPTH).toBeGreaterThan(COHORT_INTAKE_LEVEL);
  });

  it('lifts on the mound’s radius and gathers on the catchment’s — two radii, two jobs', () => {
    // ⚠️ THE MOUND IS HALF THE CATCHMENT, so the lift never reaches the quad's
    // own edge where the subdivision is coarsest, and the medium is still being
    // gathered well outside the visible rise.
    expect(MIST_MOUND_R).toBe(MIST_REACH / 2);
    expect(mistCatchment(0, MIST_REACH)).toBe(1);
    expect(mistCatchment(MIST_REACH, MIST_REACH)).toBe(0);
    expect(mistCatchment(MIST_REACH * 1.4, MIST_REACH)).toBe(0);
    // Compact support with a zero slope at the edge, like the mound: the
    // fragment that leaves at the disc's edge leaves nothing behind it.
    for (const h of [1e-2, 1e-3, 1e-4]) {
      const slope = (mistCatchment(MIST_REACH, MIST_REACH)
        - mistCatchment(MIST_REACH - h, MIST_REACH)) / h;
      expect(Math.abs(slope)).toBeLessThan(3 * h);
    }
    // The vertex stage reads the mound's radius and the fragment the reach.
    expect(PATCH_VERTEX).toContain('float x = dot(offset, offset) / max(uMoundR * uMoundR, 1e-4);');
    expect(PATCH_VERTEX).not.toMatch(/\buReach\s*\*\s*uReach\b/);
    expect(PATCH_FRAGMENT).toContain('float reach2 = uReach * uReach;');
  });
});

/* -------------------------------------------------------------------------- *
 * The eye, the reach, and the one radius the mouth already owns.
 * -------------------------------------------------------------------------- */

describe('colony mist — the eye and the edge', () => {
  it('goes EXACTLY dark at the sink and is EXACTLY open outside 0.98 of the rim', () => {
    // ⭐⭐ THE EYE IS AN ABSENCE, LIKE THE PUPIL ABOVE IT — never a drawn dark
    // disc, which is this scene's additive idiom for a hole. `smoothstep` is
    // exactly 0 at or below its lower edge and exactly 1 at or above its upper
    // one, so both ends are identities rather than approximations.
    const gate = (r: number): number => {
      const lo = COHORT_RIM_R * MIST_GATE_IN;
      const hi = COHORT_RIM_R * 0.98;
      const t = Math.min(1, Math.max(0, (r - lo) / (hi - lo)));
      return t * t * (3 - 2 * t);
    };
    expect(gate(0)).toBe(0);
    expect(gate(COHORT_RIM_R * MIST_GATE_IN)).toBe(0);
    expect(gate(COHORT_RIM_R * 0.98)).toBe(1);
    expect(gate(COHORT_RIM_R)).toBe(1);
    expect(gate(COHORT_RIM_R * 4)).toBe(1);
    // ⚠️ FULLY OPEN BEFORE THE LIP, WHERE THE PILE PEAKS. A gate still climbing
    // at the rim would eat the gather it exists to frame.
    expect(COHORT_RIM_R * 0.98).toBeLessThan(COHORT_RIM_R);
    expect(PATCH_FRAGMENT)
      .toContain('float gate = smoothstep(uRimR * uGateIn, uRimR * 0.98, r);');
  });

  it('reads the mouth’s OWN radius and level, rather than restating either', () => {
    // ⭐⭐⭐ TWO HOLES AT ONE COHORT IS THE FAILURE THESE IMPORTS PREVENT. A mist
    // that went dark inside 1.6 wu while the mouth's hole was 0.52 would be two
    // different holes, drawn by two layers that both believed they were right —
    // and that is not hypothetical: the branch shipped exactly that mismatch
    // until 2026-09-02, because a DIAMETER had been read as a radius.
    expect(PATCH.uniforms.uRimR.value).toBe(COHORT_RIM_R);
    expect(PATCH.uniforms.uLevel.value).toBe(COHORT_INTAKE_LEVEL);
    // The import, not the number: a literal here is the whole bug class.
    expect(SOURCE).toMatch(/import\s*\{[\s\S]*?COHORT_RIM_R[\s\S]*?\}\s*from\s*'\.\/colonyCohort'/);
    expect(SOURCE).toMatch(/import\s*\{[\s\S]*?COHORT_INTAKE_LEVEL[\s\S]*?\}\s*from\s*'\.\/colonyCohort'/);
    expect(SOURCE).toContain('uRimR: { value: COHORT_RIM_R }');
    // ⚠️ And no bare 1.6 or 0.7 anywhere a uniform is bound.
    expect(SOURCE).not.toMatch(/uRimR:\s*\{\s*value:\s*1\.6\s*\}/);
    // The gate, the eye, the pile and the wake are all fractions of that ONE
    // radius, so the whole patch follows the mouth when the mouth moves.
    for (const term of [
      'uRimR * uGateIn', 'uRimR * 0.98', 'clamp(uRimR / r, 0.0, 1.0)',
      'clamp(uRimR * uGulpR / r, 0.0, 1.0)', 'uRimR * 1.2', 'uRimR * 2.5',
    ]) {
      expect(PATCH_FRAGMENT).toContain(term);
    }
  });

  it('discards outside the catchment, because the quad is square and the disc is not', () => {
    // ⭐ 21.5 % OF THE QUAD IS CORNER. The patch is a disc of radius `uReach`
    // inside a square of half-extent `uReach`, so a fifth of every fragment is
    // outside the catchment entirely — and the weight there is zero anyway, so
    // discarding is both cheaper and the only thing that keeps the patch from
    // drawing a faint SQUARE under each cohort.
    expect(PATCH_FRAGMENT).toContain('if (r2 > reach2) discard;');
    const guard = PATCH_FRAGMENT.indexOf('if (r2 > reach2) discard;');
    expect(guard).toBeGreaterThan(0);
    // …and it is the FIRST statement of main, before any fetch or back-trace.
    const body = PATCH_FRAGMENT.indexOf('void main() {');
    expect(PATCH_FRAGMENT.slice(body, guard)).not.toMatch(/texture2D|mistBacktrace\s*\(/);
    // 1 - pi/4 of a square is outside its inscribed disc.
    expect(1 - Math.PI / 4).toBeCloseTo(0.2146, 4);
  });

  it('never draws structure it cannot see, and pays for it only where it shows', () => {
    // ⭐⭐ BOTH BACK-TRACES AND ALL FOUR FETCHES SIT BEHIND ONE GUARD. Below
    // `MIST_FINE_LO` on the catchment weight the fragment is a discard and a
    // multiply, which is what makes a 28 wu patch per cohort affordable.
    expect(PATCH_FRAGMENT).toContain('float fine = smoothstep(uFineLo, uFineHi, near);');
    expect(PATCH_FRAGMENT).toContain('if (fine > 0.002) {');
    const guard = PATCH_FRAGMENT.indexOf('if (fine > 0.002) {');
    for (const call of ['mistBacktrace(d, t0)', 'mistBacktrace(d, t1)']) {
      expect(PATCH_FRAGMENT.indexOf(call)).toBeGreaterThan(guard);
    }
    // The band, in world units: the structure fades in over 3.6 wu and is never
    // seen switching on. (w = (1 - r²/R²)², so r = R·sqrt(1 - sqrt(w)).)
    const radiusAt = (w: number): number => MIST_REACH * Math.sqrt(1 - Math.sqrt(w));
    expect(radiusAt(MIST_FINE_LO)).toBeCloseTo(12.97, 2);
    expect(radiusAt(MIST_FINE_HI)).toBeCloseTo(9.42, 2);
    expect(radiusAt(MIST_FINE_LO) - radiusAt(MIST_FINE_HI)).toBeCloseTo(3.56, 2);
    expect(MIST_FINE_LO).toBeLessThan(MIST_FINE_HI);
  });
});

/* -------------------------------------------------------------------------- *
 * The haze.
 * -------------------------------------------------------------------------- */

describe('colony mist — the haze sheets', () => {
  it('reaches its return with EXACTLY ONE texture fetch', () => {
    // ⭐⭐⭐ THE FIELD IS SECONDARY, AND THIS IS THE DRAW THAT PROVES IT. The
    // sheets cover the whole space under the colony; anything they do is paid
    // for over the entire screen. One fetch, an elliptical fade, the grazing
    // path, and out — no structure, no back-trace, no sinks, no time.
    const fetches = [...HAZE_FRAGMENT.matchAll(/\btexture2D\s*\(|\btexture\s*\(/g)];
    expect(fetches).toHaveLength(1);
    expect(HAZE_FRAGMENT).toContain('float ground = texture2D(uNoise, q * uGrain).b;');
    expect(HAZE_FRAGMENT)
      .toContain('float v = uBase * (0.70 + 0.60 * ground) * edge * path * uAmp;');
    // Nothing structural leaked in from the patch.
    for (const banned of ['mistBacktrace', 'mistMedium', 'uSwirl', 'uK', 'uConc', 'vGulp']) {
      expect(HAZE_FRAGMENT).not.toContain(banned);
    }
    // ⚠️ AND NO CLOCK. Motion in the far field is exactly what would pull focus
    // from the mesh, and the preview's haze does not animate either.
    expect(HAZE_FRAGMENT).not.toMatch(/\buTime\b/);
    expect(HAZE_VERTEX).not.toMatch(/\buTime\b/);
    expect(HAZE.uniforms.uTime).toBeUndefined();
  });

  it('has no edge anywhere, on the colony’s OWN ellipse', () => {
    // ⚠️ A VISIBLE RIM TURNS THE SUBSTANCE INTO A PLATE, which is the register
    // this whole round is refusing. The fade is measured on the colony's own
    // stretched footprint, so it dissolves at the same proportion off every
    // axis instead of showing a rim off the long one and cutting the short one
    // short. Ported from the preview's `coast` term, not invented.
    expect(HAZE_FRAGMENT).toContain('float rho = length(q / uEllipse);');
    expect(HAZE_FRAGMENT).toContain('float edge = 1.0 - smoothstep(uEdgeIn, uEdgeOut, rho);');
    expect(HAZE_FRAGMENT).toContain('if (edge <= 0.0) discard;');
    // 115 x 78.2 wu — derived from the colony's own placement, never typed.
    expect(MIST_HAZE_ELLIPSE[0]).toBeCloseTo(115, 6);
    expect(MIST_HAZE_ELLIPSE[1]).toBeCloseTo(78.2, 6);
    const ellipse = HAZE.uniforms.uEllipse.value as THREE.Vector2;
    expect(ellipse.x).toBe(MIST_HAZE_ELLIPSE[0]);
    expect(ellipse.y).toBe(MIST_HAZE_ELLIPSE[1]);
    // The fade starts OUTSIDE the colony (rho 1) and ends well past it, so no
    // cohort ever stands in it: `attestedPos` puts every producer at rho ≤ 1.
    expect(MIST_HAZE_EDGE_IN).toBeGreaterThan(1);
    expect(MIST_HAZE_EDGE_OUT).toBeGreaterThan(MIST_HAZE_EDGE_IN);
  });

  it('is a few percent of the scene, and the deeper sheet is fainter and coarser', () => {
    // ⭐⭐ TWO SHEETS AT TWO DEPTHS AND TWO SCALES ARE WHAT MAKE THE SUBSTANCE
    // READ AS DEEP. One sheet is a floor; two, seen through each other at any
    // angle but straight down, are a volume with nothing volumetric in it.
    expect(MIST_HAZE_SHEETS).toHaveLength(2);
    expect(MIST_HAZE_SHEETS[0].depth).toBe(MIST_FLOOR_DEPTH + 4.5);
    expect(MIST_HAZE_SHEETS[1].depth).toBe(MIST_FLOOR_DEPTH + 11);
    expect(MIST_HAZE_SHEETS[1].base).toBeCloseTo(MIST_HAZE_BASE * 0.75, 12);
    expect(MIST_HAZE_SHEETS[1].grain).toBeLessThan(MIST_HAZE_SHEETS[0].grain);
    // ⚠️ BOTH SIT BELOW THE PATCH'S OWN FLOOR, so the intake is always the
    // nearest thing to the membrane and never seen through the ambient.
    for (const sheet of MIST_HAZE_SHEETS) {
      expect(sheet.depth).toBeGreaterThan(MIST_FLOOR_DEPTH);
    }
    // The brightest a sheet can be: base × (0.70 + 0.60) × the grazing path.
    const ceiling = MIST_HAZE_BASE * 1.3 * MIST_PATH_MAX * MIST_AMP;
    expect(ceiling).toBeCloseTo(0.0624, 4);
    expect(ceiling).toBeLessThan(0.07);
  });

  it('reads the tile at the preview’s own per-sheet scale, not the plan’s table', () => {
    // ⚠️ THE PLAN'S §4 TABLE SAYS "grain 0.085 · 0.4" AND THAT IS SHORT ONE
    // FACTOR. `lab/scene.js` gives each sheet `across: 0.085 * scale` with
    // `scale` 0.6 and 0.45 BEFORE the ground's own 0.40, so the two sheets read
    // the tile at 0.0204 and 0.0153 — not at 0.034. At 0.0204 the tile repeats
    // every 49 wu, which is what makes the ground read as slow patchiness
    // rather than as grain.
    expect(MIST_HAZE_GRAIN).toBeCloseTo(0.085 * 0.6 * 0.4, 12);
    expect(MIST_HAZE_GRAIN).toBeCloseTo(0.0204, 6);
    expect(MIST_HAZE_SHEETS[1].grain).toBeCloseTo(0.085 * 0.45 * 0.4, 12);
    expect(1 / MIST_HAZE_GRAIN).toBeCloseTo(49.0, 1);
    // …and the patch's own grain is the UNSCALED number, one cell of which is
    // 1.47 wu: comparable to the hole, which is what lets the gather resolve as
    // structure at the lip instead of as a smooth glow.
    expect(MIST_GRAIN).toBe(0.085);
    expect(1 / (MIST_GRAIN * MIST_NOISE_CELLS[0])).toBeCloseTo(1.47, 2);
  });
});

/* -------------------------------------------------------------------------- *
 * The tile.
 * -------------------------------------------------------------------------- */

describe('colony mist — the noise tile', () => {
  const tile = mistNoiseTile();

  it('is deterministic for a seed, and a different seed is a different tile', () => {
    // ⭐ THE MIST HAS TO BE THE SAME SUBSTANCE FROM SESSION TO SESSION. A
    // re-seeded tile would move every filament under every cohort on a reload,
    // and the layer would stop being a place.
    const again = mistNoiseTile();
    expect(again).toEqual(tile);
    const other = mistNoiseTile(MIST_NOISE_SIZE, MIST_NOISE_SEED ^ 0x5f356495);
    expect(other).not.toEqual(tile);
    expect(tile).toHaveLength(MIST_NOISE_SIZE * MIST_NOISE_SIZE * 4);
  });

  it('WRAPS, so RepeatWrapping shows no seam', () => {
    // ⭐⭐ THE `% cells` IN THE GENERATOR IS THE SEAM. Without it the last cell
    // interpolates toward a corner that does not exist and the tile shows a
    // line down two of its edges the moment it repeats — under every cohort, at
    // the same place, which reads as a drawn grid.
    //
    // The claim is measured rather than argued: the step ACROSS the wrap is no
    // larger than the largest step anywhere INSIDE the tile. A tile that did
    // not wrap would jump by most of the lattice's range there, because the
    // last column would have interpolated toward a corner the first column
    // knows nothing about.
    for (let channel = 0; channel < 4; channel += 1) {
      let interior = 0;
      let acrossWrapX = 0;
      let acrossWrapY = 0;
      for (let y = 0; y < MIST_NOISE_SIZE; y += 1) {
        for (let x = 0; x < MIST_NOISE_SIZE; x += 1) {
          const here = tile[(y * MIST_NOISE_SIZE + x) * 4 + channel];
          if (x + 1 < MIST_NOISE_SIZE) {
            const right = tile[(y * MIST_NOISE_SIZE + x + 1) * 4 + channel];
            interior = Math.max(interior, Math.abs(right - here));
          }
          if (y + 1 < MIST_NOISE_SIZE) {
            const below = tile[((y + 1) * MIST_NOISE_SIZE + x) * 4 + channel];
            interior = Math.max(interior, Math.abs(below - here));
          }
        }
        const first = tile[(y * MIST_NOISE_SIZE + 0) * 4 + channel];
        const last = tile[(y * MIST_NOISE_SIZE + MIST_NOISE_SIZE - 1) * 4 + channel];
        acrossWrapX = Math.max(acrossWrapX, Math.abs(first - last));
      }
      for (let x = 0; x < MIST_NOISE_SIZE; x += 1) {
        const first = tile[(0 * MIST_NOISE_SIZE + x) * 4 + channel];
        const last = tile[((MIST_NOISE_SIZE - 1) * MIST_NOISE_SIZE + x) * 4 + channel];
        acrossWrapY = Math.max(acrossWrapY, Math.abs(first - last));
      }
      expect(`ch${channel}: wrapX ${acrossWrapX < interior}`)
        .toBe(`ch${channel}: wrapX true`);
      expect(`ch${channel}: wrapY ${acrossWrapY < interior}`)
        .toBe(`ch${channel}: wrapY true`);
      // …and the interior step is bounded by what a smoothstep-faded bilinear
      // lattice can do in one texel — the fade's slope peaks at 1.5, one cell
      // spans `size / cells` texels, and a lattice difference is at most 1 —
      // so the claim above is a real bound rather than a comparison against a
      // number that happened to be large. Measured 11 / 23 / 46 / 87 against
      // this bound's 12 / 25 / 49 / 97, and the wraps are 1 / 3 / 8 / 38.
      const cells = MIST_NOISE_CELLS[channel];
      expect(`ch${channel}: step ${interior} <= ${Math.ceil(255 * 1.5 * cells / MIST_NOISE_SIZE) + 1}`)
        .toBe(`ch${channel}: step ${interior} <= ${Math.ceil(255 * 1.5 * cells / MIST_NOISE_SIZE) + 1}`);
      expect(interior).toBeLessThanOrEqual(
        Math.ceil((255 * 1.5 * cells) / MIST_NOISE_SIZE) + 1,
      );
    }
    // The generator's own wrap, stated: both lattice corners are taken modulo
    // the cell count, so column `size` is the identical sample point as 0.
    expect(SOURCE).toContain('const x1 = (x0 + 1) % cells;');
    expect(SOURCE).toContain('const y1 = (y0 + 1) % cells;');
    // Every channel's cell count divides the tile, which is what makes that
    // modulo land on a texel boundary rather than mid-interpolation.
    for (const cells of MIST_NOISE_CELLS) {
      expect(MIST_NOISE_SIZE % cells).toBe(0);
    }
  });

  it('has a sane mean and uses its range', () => {
    // A value-noise lattice of uniform corners smoothed bilinearly has mean
    // 0.5; a tile that had collapsed toward one end would be a flat medium and
    // the ridge would have nothing to bite on.
    for (let channel = 0; channel < 4; channel += 1) {
      let sum = 0;
      let lo = 255;
      let hi = 0;
      for (let i = channel; i < tile.length; i += 4) {
        sum += tile[i];
        if (tile[i] < lo) lo = tile[i];
        if (tile[i] > hi) hi = tile[i];
      }
      const mean = sum / (tile.length / 4) / 255;
      expect(mean).toBeGreaterThan(0.4);
      expect(mean).toBeLessThan(0.6);
      expect(lo).toBeLessThan(40);
      expect(hi).toBeGreaterThan(215);
    }
  });

  it('is the SAME texture for both materials, mipmapped and repeating', () => {
    // ⭐ MODULE-LAZY AND SHARED: two tiles would be two substances, 256 kB
    // each, with a filament under one cohort matching nothing under the next.
    const texture = makeMistNoiseTexture();
    expect(makeMistNoiseTexture()).toBe(texture);
    expect(PATCH.uniforms.uNoise.value).toBe(texture);
    expect(HAZE.uniforms.uNoise.value).toBe(texture);
    // ⚠️ THE MIPS ARE THE WHOLE REASON THIS IS A TEXTURE AND NOT A LATTICE.
    // R19 measured unfiltered grain at this scale aliasing or prefiltering to
    // nothing past ~25 wu; the app camera stands 100+ wu from a cohort.
    expect(texture.generateMipmaps).toBe(true);
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(texture.magFilter).toBe(THREE.LinearFilter);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    expect(texture.image.width).toBe(MIST_NOISE_SIZE);
    expect(texture.image.height).toBe(MIST_NOISE_SIZE);
    // A power of two, or there are no mips at all.
    expect(Math.log2(MIST_NOISE_SIZE) % 1).toBe(0);
  });
});

/* -------------------------------------------------------------------------- *
 * The materials themselves.
 * -------------------------------------------------------------------------- */

describe('colony mist — the materials', () => {
  it('bind every constant the proofs above rest on', () => {
    const bound: Record<string, number> = {
      uReach: MIST_REACH,
      uMoundR: MIST_MOUND_R,
      uFloorDepth: MIST_FLOOR_DEPTH,
      uLevel: COHORT_INTAKE_LEVEL,
      uRimR: COHORT_RIM_R,
      uK: MIST_SINK_K,
      uSwirl: MIST_SWIRL,
      uPeriod: MIST_PERIOD,
      uDrift: MIST_DRIFT,
      uDriftSign: MIST_DRIFT_SIGN,
      uGrain: MIST_GRAIN,
      uRidge: MIST_RIDGE,
      uRidgePow: MIST_RIDGE_POW,
      uFil: MIST_FIL,
      uContrastNear: MIST_CONTRAST_NEAR,
      uContrastFar: MIST_CONTRAST_FAR,
      uFineLo: MIST_FINE_LO,
      uFineHi: MIST_FINE_HI,
      uConc: MIST_CONC,
      uGulpR: MIST_GULP_R,
      uWake: MIST_WAKE,
      uWakeW: MIST_WAKE_W,
      uWakeLen: MIST_WAKE_LEN,
      uGateIn: MIST_GATE_IN,
      uPathMax: MIST_PATH_MAX,
      uAmp: MIST_AMP,
      uContextEnergy: 1,
      uTime: 0,
    };
    for (const [name, value] of Object.entries(bound)) {
      expect(`${name}: ${PATCH.uniforms[name]?.value}`).toBe(`${name}: ${value}`);
    }
    // ⚠️ NO SINK ARRAY AND NO COUNT — see the guards. One instance is one sink.
    expect(PATCH.uniforms.uSinks).toBeUndefined();
    expect(PATCH.uniforms.uSinkCount).toBeUndefined();
    expect(HAZE.uniforms.uBase.value).toBe(MIST_HAZE_BASE);
    expect(HAZE.uniforms.uGrain.value).toBe(MIST_HAZE_GRAIN);
    expect(HAZE.uniforms.uEdgeIn.value).toBe(MIST_HAZE_EDGE_IN);
    expect(HAZE.uniforms.uEdgeOut.value).toBe(MIST_HAZE_EDGE_OUT);
  });

  it('wear the mouth’s own colour, because they are one substance', () => {
    // ⭐⭐⭐ ONE SUBSTANCE, ONE REGISTER. The mound's top IS the surface the
    // hole shows, so a viewer looking into the mouth and a viewer looking at
    // the mist beside it must not see two colours of the same medium.
    //
    // ⚠️ THE PREVIEW USED TWO COLOURS AND NEITHER IS KEPT: a deeper blue
    // (0.10, 0.58, 1.0) tinting toward (0.102, 0.819, 1.0) as the medium
    // gathered — and that bright end is EXACTLY `PEER_NETWORK_PALETTE.scaffold`,
    // a token whose whole job is to name a role INSIDE the peer plane.
    for (const material of [PATCH, HAZE]) {
      const colour = material.uniforms.uColor.value as THREE.Color;
      expect([colour.r, colour.g, colour.b]).toEqual([...COHORT_INTERIOR_COLD]);
    }
    // ⭐ Blue is EXACTLY 1.0, like every other colour this feature emits, so
    // the additive ceiling's binding channel is unchanged by this layer.
    expect(COHORT_INTERIOR_COLD[2]).toBe(1);
  });

  it('are additive, unlit and depth-read-only, exactly like the mark above them', () => {
    for (const material of [PATCH, HAZE]) {
      expect(material.transparent).toBe(true);
      expect(material.depthTest).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.blending).toBe(THREE.AdditiveBlending);
      expect(material.toneMapped).toBe(false);
      // Seen from below as often as from above: the camera goes under the
      // plane, and a single-sided sheet disappears from there.
      expect(material.side).toBe(THREE.DoubleSide);
    }
    // Energy multiplies RGB and NEVER alpha — the house idiom that keeps
    // additive damping linear.
    expect(PATCH_FRAGMENT)
      .toContain('gl_FragColor = vec4(uColor * v * cohortEnergy, min(v, 1.0));');
    expect(HAZE_FRAGMENT).toContain('gl_FragColor = vec4(uColor * v, min(v, 1.0));');
  });

  it('carry the patch’s extent in a UNIFORM, so the reach stays a knob', () => {
    // ⚠️ BAKING `2 * MIST_REACH` INTO THE GEOMETRY WOULD TURN THE REACH KNOB
    // INTO A REBUILD — the same law `COHORT_FACE_HALF` rides `uHalf` for. The
    // geometry `ColonyMist` must build is the UNIT plane, subdivided.
    expect(PATCH_VERTEX).toContain('vec2 offset = position.xy * (uReach * 2.0);');
    expect(MIST_PATCH_SEGMENTS).toBe(24);
    // One mound radius spans 6 of the 24 subdivisions, which is what makes the
    // lift a mound rather than a tent.
    expect((MIST_MOUND_R / (MIST_REACH * 2)) * MIST_PATCH_SEGMENTS).toBeCloseTo(6, 6);
  });

  it('take the SAME two lanes the face takes, on the SAME clock', () => {
    // ⭐ ONE GEOMETRY, ONE `wonAtRef`, ONE STAMP. `aGulp` is the sim second of
    // the block this cohort won; the mouth and the mist under it must swallow
    // the SAME block, so the lane is re-laid off the same map in the same
    // effect `cohortWinLane` already runs in.
    expect(PATCH_VERTEX).toContain('attribute float aSeed;');
    expect(PATCH_VERTEX).toContain('attribute float aGulp;');
    expect(PATCH_VERTEX).toContain('vGulp = aGulp;');
    expect(PATCH_VERTEX).not.toContain('aShare');
    // ⚠️ `uTime` is `simClock.elapsedSec` on both draws, because the envelope
    // is `uTime - vGulp` and a `performance.now()` stamp is a difference of
    // hundreds of thousands that reads as zero.
    expect(PATCH_FRAGMENT).toContain(squash(stripComments(COHORT_GULP_GLSL)));
    // The shared snippet, not a copy: two hand-copied envelopes would drift
    // apart the first time either was tuned.
    expect(SOURCE).toContain('${COHORT_GULP_GLSL}');
    expect(SOURCE).not.toContain('float gulpAge = uTime - vGulp;');
    // And the sentinel is silent here exactly as it is on the face.
    const gulp = (age: number): number =>
      age > 0
        ? Math.exp(-age / COHORT_GULP_FALL) * (1 - Math.exp(-age / COHORT_GULP_RISE))
        : 0;
    for (let k = 0; k <= 200; k += 1) {
      expect(gulp((k / 200) * 1e5 - COHORT_NEVER_WON)).toBe(0);
    }
  });

  it('recede with an inspection in RGB only, off the SAME exemption the mark uses', () => {
    // ⭐ THE MIST MUST NOT FIGHT AN INSPECTION. `NetworkColony` winds passive
    // peer context down as the camera closes on a cell, and the patch is
    // passive context; it recedes with everything else, and it comes back at
    // the one range anybody looks at a cohort from — the same exemption, the
    // same string, so the mark and the mist under it cannot drift apart.
    expect(PATCH_FRAGMENT).toContain(squash(stripComments(COHORT_CONTEXT_ENERGY_GLSL)));
    expect(PATCH_FRAGMENT).toContain('distance(cameraPosition, vOrigin)');
    expect(SOURCE).toContain('${COHORT_CONTEXT_ENERGY_GLSL}');
    expect(PATCH_VERTEX).toContain('vOrigin = origin.xyz;');
    expect(PATCH_VERTEX)
      .toContain('vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);');
    // ⚠️ NOT ON THE HAZE, and the reason is that the exemption measures the
    // camera against ONE instance origin — "the camera came for this" — and a
    // sheet 230 wu across is not a thing anybody comes for.
    expect(HAZE_FRAGMENT).not.toContain('cohortEnergy');
    expect(HAZE.uniforms.uContextEnergy).toBeUndefined();
  });

  it('drift on the colony’s own tangent, which is what gives the wake a side', () => {
    // ⭐ THE COHORT MOVES THROUGH THE MIST AS THE PLATE TURNS, so the depleted
    // band trails BEHIND it. The direction is the tangential one at the sink,
    // computed once per instance in the vertex stage — a per-fragment version
    // would be the same number computed 10^5 times.
    expect(PATCH_VERTEX).toContain('vec2 tangent = vec2(-seat.z, seat.x);');
    expect(PATCH_VERTEX).toContain('vDrift = tangentLen > 1e-4 ? (tangent / tangentLen) * uDriftSign : vec2(1.0, 0.0);');
    // ⚠️ The seat is the instance's COLONY-FRAME position — `instanceMatrix`
    // alone, without the model matrix — because `vP` lives in that frame too.
    expect(PATCH_VERTEX)
      .toContain('vec3 seat = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;');
    // A sign, and the derivation: the group turns by `rotation.y -= rate * dt`,
    // so a cohort's world velocity is along (-z, x) and the mist streams past
    // it the other way. Still a knob, because a sign is what a screenshot
    // settles.
    expect(Math.abs(MIST_DRIFT_SIGN)).toBe(1);
    expect(MIST_DRIFT_SIGN).toBe(-1);
    // The wake lives DOWNSTREAM — positive `along` — and only ever removes.
    expect(PATCH_FRAGMENT).toContain('float along = dot(d, vDrift);');
    expect(PATCH_FRAGMENT).toContain('float across = dot(d, vec2(-vDrift.y, vDrift.x));');
    expect(PATCH_FRAGMENT).toContain('(1.0 - uWake * wake)');
    expect(MIST_WAKE).toBeGreaterThan(0);
    expect(MIST_WAKE).toBeLessThan(1);
    // Its extent, in world units: a Gaussian 2.2 wu across the drift, opening
    // at 1.2 rim radii and gone by 17 wu.
    expect(MIST_WAKE_W).toBe(2.2);
    expect(MIST_WAKE_LEN).toBe(17);
    expect(MIST_WAKE_LEN).toBeGreaterThan(COHORT_RIM_R * 2.5);
  });
});

/* -------------------------------------------------------------------------- *
 * The ceiling the layer shares with the mark above it.
 * -------------------------------------------------------------------------- */

describe('colony mist — the ceiling it shares with the mouth', () => {
  it('states its own arithmetic supremum, and it is ABOVE the mark’s headroom', () => {
    // ⚠️⚠️ THIS IS A HANDOVER TO T6 RATHER THAN A PASSING GRADE. The face and
    // the aura sum to 0.925777 in blue over a 700-camera sweep — the number
    // `cohortAperture.test.ts` re-measures beside this one — leaving 0.0742;
    // every colour this feature emits is exactly 1.0 in blue, so blue binds
    // here too. The patch's brightest ring is where its gate finishes opening
    // — 0.98 · COHORT_RIM_R — which is the SAME radius the face's lip peaks at,
    // and the mound puts it 0.88 wu under the plane there, so from anything but
    // a grazing camera the two project on top of each other.
    //
    // ⭐ THE COLLISION IS STRUCTURAL, NOT ACCIDENTAL, AND IT IS NOT SOMETHING
    // TO INVENT A KNEE FOR HERE: the preview the user approved had exactly this
    // brightness beside exactly this mouth. `uAmp` (knob `cohortMist`) is the
    // single scale, and T6 measures the saturated pixels the R19 way — mark-on
    // minus mark-off, never a raw count.
    const rest = mistPatchSupremum();
    const swallowing = mistPatchSupremum(true);
    expect(rest).toBeCloseTo(1.95, 2);
    expect(swallowing).toBeCloseTo(3.05, 2);
    expect(swallowing).toBeGreaterThan(rest);
    const headroom = 1 - 0.925777;
    expect(headroom).toBeCloseTo(0.0742, 4);
    expect(rest).toBeGreaterThan(headroom);
    // The two rings really are at the same radius, and the mound really does
    // hold that radius under the plane rather than at it.
    expect(COHORT_RIM_R * 0.98).toBeCloseTo(1.568, 6);
    expect(mistSurfaceDrop(COHORT_RIM_R * 0.98)).toBeCloseTo(0.876, 3);
  });

  it('falls with uAmp, which is the ONLY scale on the layer', () => {
    // ⭐ ONE HANDLE. Every other constant shapes the mist; this one weighs it,
    // and the supremum above is linear in it, so a live measurement translates
    // directly into a knob setting.
    expect(MIST_AMP).toBe(1);
    expect(PATCH.uniforms.uAmp.value).toBe(MIST_AMP);
    expect(HAZE.uniforms.uAmp.value).toBe(MIST_AMP);
    // The last multiply on both programs, so nothing is applied after it.
    expect(PATCH_FRAGMENT).toContain('* path * uAmp;');
    expect(HAZE_FRAGMENT).toContain('* edge * path * uAmp;');
  });
});
