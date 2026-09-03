// The proximity exemption — and the one substitution that would have shipped
// it silently broken.
//
// A cohort is the object the camera flies in to look at, and until this landed
// it was the object that dimmed when the camera arrived: `NetworkColony` hands
// this layer the same `cellDetailPeerContextEnergy` it hands every passive peer
// draw, and that bottoms out at 0.28. So the mark lost 72 % of its light at the
// one range anybody inspects it from.
//
// ⚠️ NOTHING BELOW IS A TRANSLITERATION. R15 shipped a silent drift between a
// shader and a test's copy of its arithmetic, and a copy could not have caught
// THIS bug in any case, because the bug is a substitution a copy would have
// copied: `length(vOrigin)` instead of `distance(cameraPosition, vOrigin)`.
// Both compile. Both run. One measures the cohort's distance from the WORLD
// ORIGIN — a per-cohort constant — and never notices the camera at all. So the
// expression measured here is compiled from `COHORT_CONTEXT_ENERGY_GLSL`
// itself, byte for byte the string both cohort programs contain, and the
// decisive test MOVES THE CAMERA and MOVES THE COHORT independently.
//
// ⭐ THE TWO PROGRAMS SPEND IT IN DIFFERENT STAGES, WHICH IS WHY THE STRING IS
// SHARED RATHER THAN THE CODE. The lens computes it per FRAGMENT — it already
// has `vOrigin` across the interpolator and its whole picture is per-pixel — and
// the motes compute it per VERTEX, because a 1.5 px point has no extent to fade
// across and the seat is already a local up there. Same text, same fact, two
// stages: what would break the mark is the two disagreeing, not the two costing
// different amounts.
import { describe, expect, it } from 'vitest';
import {
  COHORT_CONTEXT_ENERGY_GLSL,
  COHORT_CONTEXT_EXEMPT_FAR,
  COHORT_CONTEXT_EXEMPT_NEAR,
} from '../../src/materials/colonyCohort';
import { makeCohortLensMaterial } from '../../src/materials/colonyLens';
import { makeCohortMotesMaterial } from '../../src/materials/colonyMotes';
import {
  CELL_DETAIL_VIEW_FAR_DISTANCE,
  CELL_DETAIL_VIEW_NEAR_DISTANCE,
  CELL_DETAIL_VIEW_PEER_CONTEXT_FLOOR,
  cellDetailPeerContextEnergy,
  cellDetailViewFocus,
} from '../../src/derives/sceneView.derive';

type Vec3 = readonly [number, number, number];

/* -------------------------------------------------------------------------- *
 * The shipped expression, RUN rather than restated.
 * -------------------------------------------------------------------------- */

const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));

/** GLSL's own three calls — the only ones the expression is allowed to make. */
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const distance = (a: Vec3, b: Vec3): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * ⭐ SUPPLIED ON PURPOSE, THOUGH THE SHIPPED EXPRESSION NEVER CALLS IT.
 *
 * The trap this file exists to catch is `length(vOrigin)`. If that form threw
 * a ReferenceError here, the decisive test below would be proving only that
 * this harness lacks a symbol — a bar the real bug clears easily, since it
 * compiles and runs on a GPU. With `length` available the broken expression
 * RUNS, and what fails is its ARITHMETIC. That the shipped text does not call
 * it is asserted separately and by name.
 */
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/**
 * The exported GLSL turned into a JavaScript expression by ONE substitution:
 * the declaration head becomes a `return`. Nothing else is rewritten, so what
 * runs below is the shader's own text with the shader's own operator
 * precedence — `mix`, `smoothstep`, `distance` and float arithmetic mean the
 * same thing in both languages, and a fourth call would fail to resolve rather
 * than pass quietly.
 */
const RETURNS_SHIPPED_TEXT = COHORT_CONTEXT_ENERGY_GLSL
  .replace(/^float\s+cohortEnergy\s*=/, 'return');

const evaluateShipped = new Function(
  'mix',
  'smoothstep',
  'distance',
  'length',
  'uContextEnergy',
  'cameraPosition',
  'vOrigin',
  RETURNS_SHIPPED_TEXT,
) as (
  glslMix: typeof mix,
  glslSmoothstep: typeof smoothstep,
  glslDistance: typeof distance,
  glslLength: typeof length,
  uContextEnergy: number,
  cameraPosition: Vec3,
  vOrigin: Vec3,
) => number;

/** `cohortEnergy`, exactly as both fragment programs compute it. */
function cohortEnergy(
  contextEnergy: number,
  cameraPosition: Vec3,
  origin: Vec3,
): number {
  return evaluateShipped(
    mix,
    smoothstep,
    distance,
    length,
    contextEnergy,
    cameraPosition,
    origin,
  );
}

/** A point `away` world units from `origin`, along +z. The direction is
 *  arbitrary and the expression is isotropic; only the distance is claimed. */
const cameraAt = (origin: Vec3, away: number): Vec3 =>
  [origin[0], origin[1], origin[2] + away];

/** The colony is a 230 x 156 wu plate centred near (0, 22, 0), so its cohorts
 *  stand anywhere from a few units to well over a hundred from world zero. */
const COHORT_NEAR_WORLD_ZERO: Vec3 = [4, 22, 4];
const COHORT_FAR_FROM_WORLD_ZERO: Vec3 = [110, 22, -110];

/* -------------------------------------------------------------------------- *
 * What it measures.
 * -------------------------------------------------------------------------- */

describe('cohort proximity exemption — what it measures', () => {
  it('is the shipped text, and the shipped text asks the CAMERA', () => {
    // The substitution that turns the string into a runnable expression has to
    // have actually fired, or every measurement below is measuring nothing.
    expect(RETURNS_SHIPPED_TEXT.startsWith('return')).toBe(true);
    expect(RETURNS_SHIPPED_TEXT).not.toContain('float cohortEnergy');

    // ⚠️⚠️ THE WHOLE BUG IS IN THIS ONE ARGUMENT. `vOrigin` is
    // `modelMatrix * instanceMatrix * vec4(0, 0, 0, 1)` — world space — so
    // `length(vOrigin)` is a cohort's distance from world zero and is CONSTANT
    // for that cohort however the camera moves.
    expect(COHORT_CONTEXT_ENERGY_GLSL).toContain('distance(cameraPosition, vOrigin)');
    expect(COHORT_CONTEXT_ENERGY_GLSL).not.toContain('length(');

    // ⭐ The instance origin, and never a per-fragment position. `vWorld` is
    // the AURA's quad corner, 4.29 world units out from the mark's centre;
    // reading it here would bring one face up ahead of the other and fade the
    // two halves of ONE hole apart.
    expect(COHORT_CONTEXT_ENERGY_GLSL).not.toContain('vWorld');
    expect(COHORT_CONTEXT_ENERGY_GLSL).not.toContain('gl_FragCoord');

    // Only three of the four builtins supplied above are ever called: the
    // fourth is `length`, which is here so that the trap form RUNS rather than
    // throwing. This is what says the shipped text is not using it.
    const called = new Set(
      [...COHORT_CONTEXT_ENERGY_GLSL.matchAll(/\b([a-z]\w*)\s*\(/g)]
        .map((match) => match[1]),
    );
    expect([...called].sort()).toEqual(['distance', 'mix', 'smoothstep']);
  });

  it('responds to where the CAMERA is, not to where the cohort stands', () => {
    // ⭐⭐⭐ THIS IS THE TEST THAT `length(vOrigin)` FAILS. Everything else in
    // this file passes under the broken form too: it is the right SHAPE, in
    // the right place, with the right edges. It is simply reading the wrong
    // vector, and only moving the two vectors independently says so.
    const context = CELL_DETAIL_VIEW_PEER_CONTEXT_FLOOR;

    // 1. A camera standing on a cohort exempts it completely — wherever in the
    //    colony that cohort happens to be.
    for (const origin of [COHORT_NEAR_WORLD_ZERO, COHORT_FAR_FROM_WORLD_ZERO]) {
      expect(cohortEnergy(context, origin, origin)).toBe(1);
    }

    // 2. The SAME camera-to-cohort distance at two utterly different world
    //    positions gives the SAME energy. Under `length(vOrigin)` these two
    //    read 1 and 0.28 respectively, because the cohort near world zero is
    //    inside the near edge forever and the far one is outside the far edge
    //    forever — see the arithmetic pinned in 3.
    const nearAt100 = cohortEnergy(context, cameraAt(COHORT_NEAR_WORLD_ZERO, 100), COHORT_NEAR_WORLD_ZERO);
    const farAt100 = cohortEnergy(context, cameraAt(COHORT_FAR_FROM_WORLD_ZERO, 100), COHORT_FAR_FROM_WORLD_ZERO);
    expect(nearAt100).toBe(farAt100);
    // And it is a PARTIAL exemption at 100 wu, so that equality is not two
    // saturated ends agreeing by accident.
    expect(nearAt100).toBeGreaterThan(context);
    expect(nearAt100).toBeLessThan(1);
    expect(nearAt100).toBeCloseTo(0.7722, 4);

    // 3. For the record, what the trap would have measured instead: a number
    //    that never changes for a given cohort, and that lands on opposite
    //    sides of the ramp for these two purely because of where they stand.
    const fromWorldZero = (o: Vec3): number => Math.hypot(o[0], o[1], o[2]);
    expect(fromWorldZero(COHORT_NEAR_WORLD_ZERO)).toBeLessThan(COHORT_CONTEXT_EXEMPT_NEAR);
    expect(fromWorldZero(COHORT_FAR_FROM_WORLD_ZERO)).toBeGreaterThan(COHORT_CONTEXT_EXEMPT_FAR);

    // 4. Hold the cohort still and fly the camera out: the energy falls, all
    //    the way from fully exempt to not exempt at all.
    let previous = Number.POSITIVE_INFINITY;
    for (let away = 0; away <= 220; away += 2) {
      const energy = cohortEnergy(context, cameraAt(COHORT_FAR_FROM_WORLD_ZERO, away), COHORT_FAR_FROM_WORLD_ZERO);
      expect(energy).toBeLessThanOrEqual(previous + 1e-12);
      previous = energy;
    }
    expect(cohortEnergy(context, cameraAt(COHORT_FAR_FROM_WORLD_ZERO, 0), COHORT_FAR_FROM_WORLD_ZERO)).toBe(1);
    expect(cohortEnergy(context, cameraAt(COHORT_FAR_FROM_WORLD_ZERO, 220), COHORT_FAR_FROM_WORLD_ZERO)).toBe(context);

    // 5. And hold the camera still and slide the cohort: the energy moves,
    //    because the DISTANCE moved. The broken form is flat here for every
    //    cohort on a sphere about world zero, which includes this whole sweep.
    const onASphere = (angle: number): Vec3 =>
      [90 * Math.cos(angle), 22, 90 * Math.sin(angle)];
    const ring = [0, 1, 2, 3, 4, 5, 6, 7]
      .map((step) => onASphere((step / 8) * Math.PI * 2));
    const rounded = (value: number): number => Number(value.toFixed(9));
    // Every cohort on this ring stands the SAME distance from world zero, so
    // the trap returns ONE value for the whole ring however the camera moves.
    expect(new Set(ring.map((origin) => rounded(fromWorldZero(origin)))).size).toBe(1);
    // A camera parked at the colony's own centre is equidistant from them too,
    // so the exemption agrees with the trap in that one pose...
    const centre: Vec3 = [0, 22, 0];
    expect(new Set(ring.map((origin) => rounded(cohortEnergy(context, centre, origin)))).size)
      .toBe(1);
    // ...and disagrees everywhere else, which is every pose a viewer is ever
    // in. The trap is still flat across this ring; the shipped form is not.
    const offCentre: Vec3 = [0, 22, 60];
    expect(new Set(ring.map((origin) => rounded(cohortEnergy(context, offCentre, origin)))).size)
      .toBeGreaterThan(1);
  });

  it('only ever ADDS light, at every distance and every context energy', () => {
    // ⭐ `mix(uContextEnergy, 1.0, k)` with k in [0, 1] lies between its two
    // ends. That is what makes the exemption safe to apply unconditionally:
    // there is no camera position and no scene focus at which it can take
    // light away, so it can never make the passive mesh's damping worse.
    const origin: Vec3 = [12, 22, -40];
    // Stepped as a ratio of integers: a `context += 0.02` accumulator walks
    // off the end of [0, 1] by 2e-16 and then measures the sweep's own
    // rounding rather than the expression.
    for (let index = 0; index <= 50; index += 1) {
      const context = index / 50;
      for (let away = 0; away <= 400; away += 2) {
        const energy = cohortEnergy(context, cameraAt(origin, away), origin);
        expect(energy).toBeGreaterThanOrEqual(context - 1e-12);
        expect(energy).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is monotone in distance and continuous across both edges', () => {
    const context = CELL_DETAIL_VIEW_PEER_CONTEXT_FLOOR;
    const origin: Vec3 = [0, 22, 0];
    // Fully exempt right up to the near edge, released exactly at the far one,
    // and smooth in between — smoothstep's derivative is zero at both, so the
    // mark neither snaps on nor visibly steps as the camera crosses either.
    for (const away of [0, 1, 35, COHORT_CONTEXT_EXEMPT_NEAR]) {
      expect(cohortEnergy(context, cameraAt(origin, away), origin)).toBe(1);
    }
    for (const away of [COHORT_CONTEXT_EXEMPT_FAR, 151, 300, 1000]) {
      expect(cohortEnergy(context, cameraAt(origin, away), origin)).toBe(context);
    }
    const midpoint = (COHORT_CONTEXT_EXEMPT_NEAR + COHORT_CONTEXT_EXEMPT_FAR) / 2;
    expect(cohortEnergy(context, cameraAt(origin, midpoint), origin))
      .toBeCloseTo(mix(context, 1, 0.5), 12);
  });
});

/* -------------------------------------------------------------------------- *
 * Where its edges sit, against the damping it exists to escape.
 * -------------------------------------------------------------------------- */

describe('cohort proximity exemption — against the scene-focus damping', () => {
  it('is a band that strictly CONTAINS the damping ramp', () => {
    // ⭐ Complete before the damping bottoms out, released after the damping
    // has finished releasing. So there is no range in which a cohort is
    // receding while the exemption has not started, and none in which it is
    // privileged while its neighbours are not damped at all.
    expect(COHORT_CONTEXT_EXEMPT_NEAR).toBeLessThan(CELL_DETAIL_VIEW_NEAR_DISTANCE);
    expect(COHORT_CONTEXT_EXEMPT_FAR).toBeGreaterThan(CELL_DETAIL_VIEW_FAR_DISTANCE);
    expect(COHORT_CONTEXT_EXEMPT_NEAR).toBeLessThan(COHORT_CONTEXT_EXEMPT_FAR);

    // Both edges come from those exported constants and not from a literal a
    // later hand could move without moving the containment above. ⚠️ The
    // ordering is also what keeps the call DEFINED: smoothstep with
    // edge0 >= edge1 is undefined in GLSL ES and has rendered nothing at all
    // on this project's own driver.
    const edges = COHORT_CONTEXT_ENERGY_GLSL
      .match(/smoothstep\(\s*([\d.]+),\s*([\d.]+),/);
    expect(edges).not.toBeNull();
    expect(Number(edges?.[1])).toBe(COHORT_CONTEXT_EXEMPT_NEAR);
    expect(Number(edges?.[2])).toBe(COHORT_CONTEXT_EXEMPT_FAR);
  });

  it('cancels the damping at the range a cohort is actually inspected from', () => {
    // The bug, end to end. ⚠️ The two distances are not the same measurement:
    // `cellDetailViewFocus` takes the camera's distance to its own ORBIT
    // TARGET, and the exemption takes its distance to the COHORT. They
    // coincide exactly when the camera has come to look at the cohort — which
    // is the case this exists for, and the case every screenshot is taken in.
    const inspecting = 60;
    const damped = cellDetailPeerContextEnergy(cellDetailViewFocus(inspecting));
    expect(damped).toBe(CELL_DETAIL_VIEW_PEER_CONTEXT_FLOOR);
    expect(damped).toBeCloseTo(0.28, 12);

    const origin: Vec3 = [40, 22, -18];
    // Without the exemption this cohort renders at 28 % of its light. With it,
    // at full.
    expect(cohortEnergy(damped, cameraAt(origin, inspecting), origin)).toBe(1);

    // Measured, not claimed, at the two ends of the damping's own ramp: the
    // ramps are NESTED, not aligned, so the exemption is 95.6 % in where the
    // damping bottoms out rather than exactly whole there — a cohort keeps
    // 95.6 % of its light instead of 28 % — and has 0.19 % left where the
    // damping finishes releasing, which is below anything an eye resolves.
    expect(cohortEnergy(damped, cameraAt(origin, CELL_DETAIL_VIEW_NEAR_DISTANCE), origin))
      .toBeCloseTo(0.95626, 9);
    expect(cohortEnergy(damped, cameraAt(origin, CELL_DETAIL_VIEW_FAR_DISTANCE), origin))
      .toBeCloseTo(0.2813275, 9);
  });

  it('leaves a distant cohort damped exactly like the rest of the mesh', () => {
    // ⭐ In the overview a cohort carries no privilege at all. What
    // distinguishes it there is six world units of open plane against a sighted
    // peer's 1.5 — presence is size and structure, not a brighter pixel.
    const origin: Vec3 = [-70, 22, 55];
    for (const away of [COHORT_CONTEXT_EXEMPT_FAR, 200, 420]) {
      for (const context of [0, CELL_DETAIL_VIEW_PEER_CONTEXT_FLOOR, 0.5, 1]) {
        expect(cohortEnergy(context, cameraAt(origin, away), origin)).toBe(context);
      }
    }
  });
});

/* -------------------------------------------------------------------------- *
 * One expression, two programs.
 * -------------------------------------------------------------------------- */

describe('cohort proximity exemption — one expression in both programs', () => {
  const lens = makeCohortLensMaterial();
  const motes = makeCohortMotesMaterial();

  it('pastes the same string, character for character, into both programs', () => {
    // ⭐ They are ONE MARK. Specks that stayed bright while the disc they fall
    // through receded would be a worse artefact than the bug this fixes, and two
    // copies of an expression is exactly how that happens. The shared constant is
    // the structural answer; this is the assertion that says it is still being
    // used as one.
    //
    // ⚠️ THE STAGES DIFFER AND THE TEXT DOES NOT: the lens carries it in its
    // FRAGMENT and the motes in their VERTEX, so what is searched is the whole
    // program rather than a stage chosen in advance.
    for (const [name, glsl] of [
      ['lens.fragmentShader', lens.fragmentShader],
      ['motes.vertexShader', motes.vertexShader],
    ] as const) {
      expect(`${name}: ${glsl.includes(COHORT_CONTEXT_ENERGY_GLSL)}`)
        .toBe(`${name}: true`);
      expect(glsl.split(COHORT_CONTEXT_ENERGY_GLSL)).toHaveLength(2);
    }
    // …and never twice in one material, which would be two exemptions racing.
    expect(lens.vertexShader).not.toContain('cohortEnergy');
    expect(motes.fragmentShader).not.toContain('cohortEnergy');
  });

  it('multiplies the energy into RGB and NEVER into alpha, in both', () => {
    // ⚠️ THE HOUSE IDIOM, AND IT IS LOAD-BEARING TWICE OVER. The motes are
    // additive and additive blending uses SOURCE ALPHA as its factor, so energy
    // in alpha would damp them by the square and stop the recession being
    // linear. The lens is NORMALLY blended, where alpha is what OCCLUDES: energy
    // in its alpha would mean a cohort the HUD is not currently interested in
    // stops hiding what is behind it, and the hole is a fact about the colony
    // rather than about the HUD's attention.
    expect(lens.fragmentShader).toContain(
      'acc.rgb * uAmp * cohortEnergy, clamp(acc.a, 0.0, 1.0)',
    );
    expect(motes.fragmentShader)
      .toContain('gl_FragColor = vec4(uColor * s * vEnergy, min(s, 1.0));');

    // Nothing bypasses the exemption: `uContextEnergy` occurs exactly twice in
    // the program that reads it — its uniform declaration, and the one read
    // inside the shared expression.
    // ⭐ The lens READS it twice — once at the far exit, where nothing is
    // traced, and once at the near one — but COMPUTES it once, above both: a
    // fragment that left by the far door with an undamped mark would be the
    // exact drift the shared expression exists to prevent.
    for (const [name, glsl, reads] of [
      ['lens.fragmentShader', lens.fragmentShader, 2],
      ['motes.vertexShader', motes.vertexShader, 1],
    ] as const) {
      expect(`${name}: ${[...glsl.matchAll(/\buContextEnergy\b/g)].length}`)
        .toBe(`${name}: 2`);
      expect(glsl).toContain('uniform float uContextEnergy;');
      expect([...glsl.matchAll(/\bcohortEnergy\b/g)]).toHaveLength(1 + reads);
    }
    expect(lens.fragmentShader).toContain(
      'far.rgb * uAmp * cohortEnergy, clamp(far.a, 0.0, 1.0)',
    );
    // …and the one computation stands BEFORE the far exit, so both doors spend
    // the same number.
    expect(lens.fragmentShader.indexOf(COHORT_CONTEXT_ENERGY_GLSL))
      .toBeLessThan(lens.fragmentShader.indexOf('if (closeness <= 0.0) {'));

    // ⭐ THE MOTES CARRY IT ACROSS AS ONE FLOAT, computed once per speck rather
    // than once per pixel — and it is the ONLY thing `vEnergy` ever holds, so
    // there is no path where a mote is damped by something else.
    expect(motes.vertexShader).toContain('varying float vEnergy;');
    expect(motes.fragmentShader).toContain('varying float vEnergy;');
    expect(motes.vertexShader).toContain('vEnergy = cohortEnergy;');
    expect([...motes.vertexShader.matchAll(/\bvEnergy\b/g)]).toHaveLength(2);

    // Both take the damping from the layer at full by default, so an instance
    // drawn before the first frame loop is not silently dimmed.
    expect(lens.uniforms.uContextEnergy.value).toBe(1);
    expect(motes.uniforms.uContextEnergy.value).toBe(1);
  });

  it('measures from the MARK’s own world point in both, never from the pixel', () => {
    // ⭐⭐ ONE DISTANCE PER MARK. The lens's quad is 64 world units across and a
    // mote falls up to 27 wu from its seat, so a per-pixel or per-speck distance
    // would bring one end of a mark up ahead of the other — the disc fading
    // apart from the specks inside it, which is the exact drift the shared
    // expression exists to prevent.
    //
    // ⚠️ The two arrive at `vOrigin` differently and BOTH are the instance's own
    // world point: the lens carries it as a varying from
    // `modelMatrix * instanceMatrix * vec4(0,0,0,1)`, and the motes bind the name
    // to the local seat they already built out of `modelMatrix * aOrigin`. A
    // Points geometry has no instance matrix to read.
    expect(lens.vertexShader).toContain('varying vec3 vOrigin;');
    expect(lens.fragmentShader).toContain('varying vec3 vOrigin;');
    expect(lens.vertexShader)
      .toContain('modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)');
    expect(lens.vertexShader).toMatch(/vOrigin = \w+\.xyz;/);
    expect(motes.vertexShader)
      .toContain('vec3 seat = (modelMatrix * vec4(aOrigin, 1.0)).xyz;');
    expect(motes.vertexShader).toContain('vec3 vOrigin = seat;');
    // …and the local is bound BEFORE the expression that reads it, or the
    // program would not compile at all.
    expect(motes.vertexShader.indexOf('vec3 vOrigin = seat;'))
      .toBeLessThan(motes.vertexShader.indexOf(COHORT_CONTEXT_ENERGY_GLSL));
  });
});
