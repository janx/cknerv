// What a cohort's CENTRE is, arithmetically — and the one number that has
// already cost this project a whole live leg.
//
// The centre is deliberately not a new mark: it is a peer stop's own resting
// profile with its middle refused. So most of this file is a tie between two
// shaders rather than a restatement of one. ⚠️ A MIRROR THAT DRIFTS PROVES
// NOTHING (R15 shipped exactly that), so where the arithmetic below is
// transliterated it is pinned to the shipped GLSL, and where it claims to
// match `peerNodeMaterial` it reads that material's ACTUAL fragment source
// rather than a copy of the numbers.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PEER_NETWORK_PALETTE, PEER_NETWORK_HEX } from '../../src/visualPalette';
import { peerSchema } from '../../src/tweaks/tweakSchema';
import { makePeerHaloMaterial } from '../../src/materials/peerNodeMaterial';
import {
  COHORT_BREATHE_HZ,
  COHORT_CORE_AMP,
  COHORT_CORE_HALF,
  COHORT_CORE_REFUSE,
  makeCohortCoreMaterial,
} from '../../src/materials/colonyCohort';

const TAU = Math.PI * 2;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

const CORE_FRAGMENT = makeCohortCoreMaterial().fragmentShader;
const CORE_VERTEX = makeCohortCoreMaterial().vertexShader;
const PEER_FRAGMENT = makePeerHaloMaterial(PEER_NETWORK_HEX.scaffold).fragmentShader;

/* -------------------------------------------------------------------------- *
 * The mirror: the fragment's shape, line for line.
 * -------------------------------------------------------------------------- */

/** `refuse`, isolated: the term that makes the throat a hole. */
const refuseAt = (r: number): number =>
  smoothstep(0, Math.max(COHORT_CORE_REFUSE, 0.001), r);

/** `breathe`, isolated: the mesh's cadence, at time `t` with seed phase. */
const breatheAt = (time: number, phase: number): number =>
  0.78 + 0.22 * Math.sin(time * COHORT_BREATHE_HZ + phase);

/** The whole fragment's `shape`, for a point `r` of the way to the rim. */
function shapeAt(r: number, time = 0, phase = 0): number {
  if (r > 1) return 0;
  const core = Math.pow(Math.max(1 - r, 0), 4);
  const halo = Math.pow(Math.max(1 - r, 0), 1.6) * 0.42;
  return (core + halo) * refuseAt(r) * COHORT_CORE_AMP * breatheAt(time, phase);
}

/* -------------------------------------------------------------------------- *
 * The throat.
 * -------------------------------------------------------------------------- */

describe("cohort core — the refused throat", () => {
  it('reaches EXACTLY zero on the axis, in every frame and for every seed', () => {
    // ⭐ The throat is not merely dim. This scene's idiom for a hole is
    // additive: darkness is the one place bright structure declines to fill,
    // and no dark pixel is ever drawn. A profile that merely got small would
    // still paint a cyan dot at the convergence point and turn the funnel
    // back into a searchlight aimed at a bead.
    expect(refuseAt(0)).toBe(0);
    for (let time = 0; time < 12; time += 0.37) {
      for (let phase = 0; phase < TAU; phase += TAU / 16) {
        expect(shapeAt(0, time, phase)).toBe(0);
      }
    }
    // Zero only AT the axis, though — it climbs away from it immediately and
    // is fully released at uRefuse, or the mark would just be a smaller mark.
    expect(shapeAt(1e-6)).toBeGreaterThan(0);
    expect(refuseAt(COHORT_CORE_REFUSE)).toBe(1);
    expect(refuseAt(COHORT_CORE_REFUSE / 2)).toBeCloseTo(0.5, 12);
    // The refusal is monotone: no ring of its own inside the throat.
    let previous = -1;
    for (let r = 0; r <= 1; r += 0.001) {
      const here = refuseAt(r);
      expect(`${r.toFixed(3)}: ${here >= previous}`).toBe(`${r.toFixed(3)}: true`);
      previous = here;
    }
    // And the hole has real diameter rather than being a pinprick: a third of
    // the way out of the throat the profile is still down to a QUARTER of what
    // it would be without the refusal, and two thirds of the way out to about
    // three quarters. That gradient is the hole; a steeper one would read as a
    // hard-edged black dot and a shallower one as a merely dim centre.
    expect(refuseAt(COHORT_CORE_REFUSE / 3)).toBeCloseTo(0.2593, 3);
    expect(refuseAt(COHORT_CORE_REFUSE * (2 / 3))).toBeCloseTo(0.7407, 3);
  });

  it('is written so a zero knob cannot make smoothstep undefined', () => {
    // ⚠️ `smoothstep(a, b, x)` with `a >= b` is UNDEFINED in GLSL ES — not a
    // warning, not a fallback. It rendered NOTHING AT ALL on this project's own
    // AMD/Vulkan driver once already. T3 gives uRefuse a knob, so the guard has
    // to be in the shader and not in the caller.
    expect(CORE_FRAGMENT).toContain('smoothstep(0.0, max(uRefuse, 0.001), r)');
    expect(COHORT_CORE_REFUSE).toBeGreaterThan(0.001);
  });
});

/* -------------------------------------------------------------------------- *
 * The tie to the peer mesh.
 * -------------------------------------------------------------------------- */

/** The numbers `makePeerHaloMaterial` actually compiles with, read out of its
 *  own fragment source so the two shaders cannot drift apart silently. */
function peerProfile(): {
  coreExponent: number;
  haloExponent: number;
  haloWeight: number;
  breatheBase: number;
  breatheDepth: number;
  breatheRate: number;
} {
  const core = /float core = pow\(1\.0 - r, ([0-9.]+)\);/.exec(PEER_FRAGMENT);
  const halo = /float halo = pow\(1\.0 - r, ([0-9.]+)\) \* ([0-9.]+);/.exec(PEER_FRAGMENT);
  const breathe = /float breathe = ([0-9.]+) \+ ([0-9.]+) \* sin\(uTime \* ([0-9.]+) \+ uPhase\);/
    .exec(PEER_FRAGMENT);
  if (core === null || halo === null || breathe === null) {
    throw new Error('peerNodeMaterial no longer states its profile in the form this reads');
  }
  return {
    coreExponent: Number.parseFloat(core[1]),
    haloExponent: Number.parseFloat(halo[1]),
    haloWeight: Number.parseFloat(halo[2]),
    breatheBase: Number.parseFloat(breathe[1]),
    breatheDepth: Number.parseFloat(breathe[2]),
    breatheRate: Number.parseFloat(breathe[3]),
  };
}

describe('cohort core — the peer mesh’s own profile', () => {
  const peer = peerProfile();

  it('takes the peer halo’s exponents, from that material’s actual source', () => {
    // ⭐ A cohort is a peer that mines. Nothing about the resting grammar of a
    // stop should have to be re-learned to read one, so the profile is not
    // "similar to" the peer family's — it IS the peer family's, and this
    // assertion reads `peerNodeMaterial`'s compiled text rather than a copy of
    // its numbers so that editing one alone fails here.
    const core = /float core = pow\(max\(1\.0 - r, 0\.0\), ([0-9.]+)\);/.exec(CORE_FRAGMENT);
    const halo = /float halo = pow\(max\(1\.0 - r, 0\.0\), ([0-9.]+)\) \* ([0-9.]+);/
      .exec(CORE_FRAGMENT);
    expect(core).not.toBeNull();
    expect(halo).not.toBeNull();
    expect(Number.parseFloat((core as RegExpExecArray)[1])).toBe(peer.coreExponent);
    expect(Number.parseFloat((halo as RegExpExecArray)[1])).toBe(peer.haloExponent);
    expect(Number.parseFloat((halo as RegExpExecArray)[2])).toBe(peer.haloWeight);
    // The values the exponents are read at have to agree too, or matching
    // exponents would mean nothing: same radial coordinate, same circular cut.
    const radius = 'float r = length(vUv - 0.5) * 2.0;';
    expect(CORE_FRAGMENT).toContain(radius);
    expect(PEER_FRAGMENT).toContain(radius);
    expect(CORE_FRAGMENT).toContain('if (r > 1.0) discard;');
    expect(PEER_FRAGMENT).toContain('if (r > 1.0) discard;');
    // ⚠️ The one deliberate difference: `max(1.0 - r, 0.0)`. Both shaders
    // discard beyond the rim, so the base is never negative in either — but
    // `pow` with a negative base is UB, and the source-level guard that proves
    // it cannot see a discard. The clamp is what makes the guard's answer true
    // rather than merely likely.
    expect(peer.coreExponent).toBe(4);
    expect(peer.haloExponent).toBe(1.6);
    expect(peer.haloWeight).toBe(0.42);
    // The two profiles agree numerically, everywhere, up to the refusal.
    for (let r = COHORT_CORE_REFUSE; r <= 1; r += 0.005) {
      const peerShape = Math.pow(1 - r, peer.coreExponent)
        + Math.pow(1 - r, peer.haloExponent) * peer.haloWeight;
      expect(shapeAt(r, 0, Math.PI / 2) / COHORT_CORE_AMP).toBeCloseTo(peerShape, 12);
    }
  });

  it('breathes on the mesh’s cadence, at the mesh’s depth', () => {
    // The colony's other marks already breathe at 1.2; a cohort that breathed
    // on its own beat would read as a different KIND of object rather than a
    // peer with a job. The rate rides a uniform so T6 has a knob, and this is
    // what stops the knob's default drifting off the mesh.
    expect(COHORT_BREATHE_HZ).toBe(peer.breatheRate);
    expect(makeCohortCoreMaterial().uniforms.uBreatheHz.value).toBe(peer.breatheRate);
    expect(CORE_FRAGMENT)
      .toContain('float breathe = 0.78 + 0.22 * sin(uTime * uBreatheHz + vPhase);');
    expect(peer.breatheBase).toBe(0.78);
    expect(peer.breatheDepth).toBe(0.22);
    // One full cycle in 2π/1.2 ≈ 5.236 s, swinging between 0.56 and 1.0 —
    // never inverting, so the mark never goes out.
    let low = Infinity;
    let high = -Infinity;
    for (let time = 0; time < 6; time += 0.001) {
      const value = breatheAt(time, 0);
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    expect(low).toBeCloseTo(peer.breatheBase - peer.breatheDepth, 6);
    expect(high).toBeCloseTo(peer.breatheBase + peer.breatheDepth, 6);
    expect(low).toBeGreaterThan(0);
    expect(breatheAt(0, 0)).toBeCloseTo(peer.breatheBase, 12);
    expect(breatheAt(TAU / COHORT_BREATHE_HZ, 0)).toBeCloseTo(breatheAt(0, 0), 9);
  });

  it('spreads the breathe by seed, taking the same lane the intake takes', () => {
    // ⭐ The seed is a fraction of a turn on both faces of this mark. The
    // intake measures crest phase in TURNS and takes it raw; the breathe
    // measures phase in RADIANS and takes it times TAU. A seed handed to the
    // breathe raw would spread 60 cohorts over 1 radian of a 6.28-radian cycle
    // and they would all inhale together.
    expect(CORE_VERTEX).toContain('attribute float aSeed;');
    expect(CORE_VERTEX).toContain('vPhase = aSeed * TAU;');
    expect(CORE_VERTEX).toContain('const float TAU = 6.28318530718;');
    // Share reaches this face not at all: it is crest speed, and there are no
    // crests here.
    expect(CORE_VERTEX).not.toContain('aShare');
    expect(CORE_FRAGMENT).not.toContain('Share');
    // A seed sweep really does cover the whole cycle.
    let low = Infinity;
    let high = -Infinity;
    for (let seed = 0; seed < 1; seed += 0.001) {
      const value = breatheAt(0, seed * TAU);
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    expect(high - low).toBeCloseTo(0.44, 3);
  });
});

/* -------------------------------------------------------------------------- *
 * The standing law: nothing clips.
 * -------------------------------------------------------------------------- */

describe('cohort core — the resting supremum', () => {
  it('stays under 1.0 in EVERY channel, so the mark’s structure survives', () => {
    // ⭐⭐⭐ THIS IS THE LAW THAT COST A FULL LIVE LEG IN R16. Additive blending
    // applies source alpha to RGB, so the screen receives `uColor * shape²`.
    // The scaffold is `#1AD1FF`, whose BLUE IS EXACTLY FULL — so a shape
    // reaching 1.0 clips blue flat, then green, and the mark stops being a
    // profile and becomes a white-cyan blob with no readable structure inside
    // it. R16's mark was driven to a supremum of 4.8 before anyone noticed,
    // because a blown-out shape still looks bright and only its STRUCTURE is
    // missing.
    let supremum = 0;
    let atRadius = 0;
    for (let r = 0; r <= 1; r += 0.0001) {
      for (let phase = 0; phase < TAU; phase += TAU / 24) {
        for (const time of [0, 0.41, 1.7, 3.9, 11.3]) {
          const value = shapeAt(r, time, phase);
          if (value > supremum) {
            supremum = value;
            atRadius = r;
          }
        }
      }
    }
    // Today: 0.1842 at r = 0.2354. T6 re-tunes against the real light budget;
    // what it may never do is take this over 1.
    expect(supremum).toBeCloseTo(0.1842, 4);
    expect(atRadius).toBeCloseTo(0.2354, 3);
    expect(supremum).toBeLessThan(1);
    for (const channel of PEER_NETWORK_PALETTE.scaffold) {
      expect(channel * supremum * supremum).toBeLessThan(1);
    }
    // ⭐ And the bound holds ANALYTICALLY, not just over the sweep above, so a
    // finer grid cannot find a counter-example: core ≤ 1, halo ≤ 0.42,
    // refuse ≤ 1 and breathe ≤ 1, so shape ≤ uAmp * 1.42 whatever else moves.
    const ceiling = COHORT_CORE_AMP * 1.42;
    expect(supremum).toBeLessThanOrEqual(ceiling);
    expect(ceiling).toBeLessThan(1);
    for (const channel of PEER_NETWORK_PALETTE.scaffold) {
      expect(channel * ceiling * ceiling).toBeLessThan(1);
    }
    // ⚠️ Blue is exactly full, which is WHY red is the probe channel for
    // anything measured off a screenshot: it is the one with headroom.
    expect(PEER_NETWORK_PALETTE.scaffold[2]).toBe(1);
    expect(PEER_NETWORK_PALETTE.scaffold[0]).toBeLessThan(0.2);
  });

  it('holds that bound however far a knob is pushed, as long as amp is sane', () => {
    // The knob T3 adds is `cohortCoreAmp`. The ceiling above is linear in it,
    // so this is the value at which the mark would start to clip — worth
    // knowing before someone reaches for it in T6 rather than after.
    const clippingAmp = 1 / 1.42;
    expect(COHORT_CORE_AMP).toBeLessThan(clippingAmp);
    expect(clippingAmp).toBeCloseTo(0.704, 3);
    // ⭐⭐⭐ THE GUARD IS THE KNOB'S CEILING, NOT THE DEFAULT'S DISTANCE FROM
    // IT. This used to assert that the shipped amp sat a factor of two under
    // the analytic clip, which conflated two different claims: "the mark
    // cannot be blown out" and "the mark is dim". Only the first is a law, and
    // stating it as the second means the assertion fires on any attempt to
    // make the centre brighter — including a warranted one. What actually
    // keeps the mark safe is that NO REACHABLE KNOB VALUE CLIPS.
    expect(peerSchema.cohortCoreAmp.max).toBeLessThan(clippingAmp);
    expect(peerSchema.cohortCoreAmp.value).toBe(COHORT_CORE_AMP);
    expect(COHORT_CORE_AMP).toBeLessThanOrEqual(peerSchema.cohortCoreAmp.max);
    // ⭐ AND THE ANALYTIC CEILING IS LOOSE BY 2.6x, WHICH IS THE HEADROOM THE
    // BOUND ABOVE CANNOT SEE. `core + halo` peaks at r = 0, where `refuse` is
    // exactly zero, so the two can never be at their maxima together: the
    // measured supremum is 0.5418 of the amplitude against the bound's 1.42.
    // Both numbers are true and they answer different questions — the loose
    // one is what makes the knob safe under every combination, the tight one
    // is how much light the mark actually has left.
    // The profile's peak is a pure function of the shape, so the ratio to the
    // amplitude is a constant of the design and not of the tuning.
    let supremumPerAmp = 0;
    for (let r = 0; r <= 1; r += 0.0001) {
      const value = shapeAt(r, 0, Math.PI / 2) / COHORT_CORE_AMP;
      if (value > supremumPerAmp) supremumPerAmp = value;
    }
    expect(supremumPerAmp).toBeCloseTo(0.54185, 4);
    expect(1.42 / supremumPerAmp).toBeGreaterThan(2.6);
    // On the screen, which receives shape² with blue exactly full:
    const onScreen = (COHORT_CORE_AMP * supremumPerAmp) ** 2;
    expect(onScreen).toBeLessThan(1);
  });

  it('the mirror above is the shipped shape, term for term', () => {
    // ⚠️ Everything measured in this file runs on the transliteration at the
    // top, so the transliteration has to be tied to the GLSL that ships.
    expect(CORE_FRAGMENT).toContain('float core = pow(max(1.0 - r, 0.0), 4.0);');
    expect(CORE_FRAGMENT).toContain('float halo = pow(max(1.0 - r, 0.0), 1.6) * 0.42;');
    expect(CORE_FRAGMENT).toContain('float refuse = smoothstep(0.0, max(uRefuse, 0.001), r);');
    expect(CORE_FRAGMENT)
      .toContain('float breathe = 0.78 + 0.22 * sin(uTime * uBreatheHz + vPhase);');
    expect(CORE_FRAGMENT)
      .toContain('float shape = (core + halo) * refuse * uAmp * breathe;');
    // ⭐ THE ENERGY IN THE RGB TERM IS `cohortEnergy`, NOT `uContextEnergy`.
    // The proximity exemption sits between them, and it is shared verbatim
    // with the intake; `cohortContextEnergy.test.ts` owns that tie. What this
    // line still says is the house idiom: energy multiplies RGB and NEVER
    // alpha, which is what keeps additive damping linear.
    expect(CORE_FRAGMENT)
      .toContain('gl_FragColor = vec4(uColor * shape * cohortEnergy, shape);');
  });
});

/* -------------------------------------------------------------------------- *
 * The material itself.
 * -------------------------------------------------------------------------- */

describe('cohort core — the material', () => {
  const material = makeCohortCoreMaterial();

  it('binds the constants the proofs above rest on', () => {
    expect(material.uniforms.uAmp.value).toBe(COHORT_CORE_AMP);
    expect(material.uniforms.uRefuse.value).toBe(COHORT_CORE_REFUSE);
    expect(material.uniforms.uHalf.value).toBe(COHORT_CORE_HALF);
    expect(material.uniforms.uBreatheHz.value).toBe(COHORT_BREATHE_HZ);
    expect(material.uniforms.uContextEnergy.value).toBe(1);
    expect(material.uniforms.uTime.value).toBe(0);
    const colour = material.uniforms.uColor.value as THREE.Color;
    expect([colour.r, colour.g, colour.b]).toEqual([...PEER_NETWORK_PALETTE.scaffold]);
  });

  it('is additive, unlit and depth-read-only, like every other draw in the layer', () => {
    // The layer has exactly one blend mode now. The deleted horizon pass was
    // the only normal-blended object in the scene and the only one that could
    // occlude what was behind it; nothing here reintroduces either.
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.toneMapped).toBe(false);
  });

  it('carries the quad extent in a UNIFORM, because a hand-built billboard ignores scale', () => {
    // ⚠️ T3 MUST GIVE THIS `PlaneGeometry(1, 1)`. The quad is rebuilt from raw
    // `position` and the view matrix's camera axes, which no model matrix ever
    // touches — so `mesh.scale` and a scaled instance matrix are both silently
    // ignored, and the extent has to ride `uHalf`. Its two older neighbours in
    // the same file do the OPPOSITE: they bake the extent into
    // `PlaneGeometry(half * 2, half * 2)` and read `position` as world units.
    // Reaching for `accretionGeometry` here renders the mark 3.7x too big.
    expect(CORE_VERTEX).toContain('uniform float uHalf;');
    expect(CORE_VERTEX).toContain('* uHalf * 2.0');
    expect(CORE_VERTEX).toContain(
      'vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
    );
    expect(CORE_VERTEX).toContain('viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]');
    // A unit plane, so `position.x ∈ [-0.5, 0.5]` and the quad spans exactly
    // 2 * uHalf world units.
    expect(COHORT_CORE_HALF).toBeGreaterThan(0);
  });

  it('is swept by the file’s own shader guards, which is where they live', () => {
    // ⭐ The two source-level guards — no `smoothstep` with `edge0 >= edge1`,
    // no `pow` with a possibly-negative base — are implemented ONCE, over the
    // whole file, in `cohortIntake.test.ts`. This program is in their list, and
    // their coverage assertion means it HAS to be: every `pow` and `smoothstep`
    // in the file must appear in a program they were handed, so a factory added
    // here and not there fails there rather than passing quietly here.
    const guards = readFileSync(
      resolve(process.cwd(), '__tests__/materials/cohortIntake.test.ts'),
      'utf8',
    );
    expect(guards).toContain("['cohortCore', makeCohortCoreMaterial()]");
    expect(guards).toContain('no smoothstep anywhere has edge0 >= edge1');
    expect(guards).toContain('no pow anywhere can be handed a negative base');
    // This program really does give them something to check.
    expect([...CORE_FRAGMENT.matchAll(/\bpow\s*\(/g)]).toHaveLength(2);
    // Two: the refusal, and the proximity exemption pasted in from
    // `COHORT_CONTEXT_ENERGY_GLSL`. The second is written once and compiled
    // into both programs, which is why the guards' coverage sum has to allow
    // for it — see `covers every smoothstep and pow the file actually
    // contains`.
    expect([...CORE_FRAGMENT.matchAll(/\bsmoothstep\s*\(/g)]).toHaveLength(2);
  });
});
