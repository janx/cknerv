// What the mist under the colony plane IS, arithmetically — and the fact that
// this file no longer draws any of it.
//
// ⭐⭐⭐ THE SUBSTANCE IS A LIBRARY NOW. Until 2026-09-03 this file owned a DRAW
// — `makeCohortIntakePatchMaterial`, one instanced patch of the medium per
// cohort, lying under the plane and lifted into a mound whose top was the level
// the mouth's window showed — and the tests that went with it: the mound's
// profile, the law that no vertex is ever above the membrane, the dark eye at
// the rim, the wake, the grazing path length, the layer's own additive
// supremum. All of it went with the composed aperture, because the lensed
// cohort (`colonyLens.ts`) samples this same medium where a bent light ray
// crosses the colony plane — the intake drawn as a CONSEQUENCE of the mass
// rather than as a surface mapped beside it.
//
// ⭐⭐ SO WHAT IS PINNED HERE IS THE SUBSTANCE AND THE ONE COMPILER OF IT: the
// spiral back-trace that IS a 2-D point sink with a vortex, the share factor
// that turns a cohort's fraction of its window into the sink's strength, the
// 256² tile the medium is read out of, and — at the end — that every GLSL
// snippet this file exports is compiled by a program somewhere, since a library
// nobody includes is dead text no guard would catch.
//
// ⚠️ A MIRROR THAT DRIFTS PROVES NOTHING (R15 shipped exactly that), so every
// mirror below is tied to the shipped GLSL as TEXT — read out of the lens's own
// compiled program, which is the only place the substance is now assembled.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  COHORT_LENS_REACH,
  makeCohortLensMaterial,
} from '../../src/materials/colonyLens';
import {
  MIST_BACKTRACE_GLSL,
  MIST_DISC_COLOR_GLSL,
  MIST_DRIFT_SIGN,
  MIST_FIBRES_GLSL,
  MIST_MEDIUM_GLSL,
  MIST_NOISE_CELLS,
  MIST_NOISE_LOD_GLSL,
  MIST_NOISE_SEED,
  MIST_NOISE_SIZE,
  MIST_SEAT_DRIFT_GLSL,
  MIST_SHARE_FACTOR_GLSL,
  MIST_SHARE_FLOOR,
  MIST_SINK_K,
  MIST_SWIRL,
  makeMistNoiseTexture,
  mistBacktrace,
  mistCatchment,
  mistNoiseTile,
  mistShareFactor,
  mistSinkRadius,
  mistSpiralTurn,
} from '../../src/materials/colonyMist';

/** The one program that compiles this library today. */
const LENS = makeCohortLensMaterial();

/** Whitespace-insensitive, so a statement wrapped over lines still matches. */
const squash = (glsl: string): string => glsl.replace(/\s+/g, ' ');

/** ⚠️ Comment-free, so a word written in PROSE — `pow`, `texture` — can never be
 *  mistaken for code. The layer's own shader guards learned this first. */
const stripComments = (glsl: string): string =>
  glsl.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const LENS_VERTEX = squash(stripComments(LENS.vertexShader));
const LENS_FRAGMENT = squash(stripComments(LENS.fragmentShader));

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
    // ⭐ A PURE SINK IS A DRAIN AND READS AS RADIAL STREAKS — the failure the
    // retired aperture's 88 striae were counted to escape. A circulation `swirl`
    // times
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
      const [bx, bz] = mistBacktrace(
        x, z, MIST_SINK_K, MIST_SWIRL, 0, COHORT_LENS_REACH,
      );
      expect(bx).toBeCloseTo(x, 12);
      expect(bz).toBeCloseTo(z, 12);
    }
    expect(mistSinkRadius(3, MIST_SINK_K, 0)).toBe(3);
    expect(mistSpiralTurn(3, 3, MIST_SWIRL)).toBe(0);
  });

  it('reduces to the pure sink form at the mouth and to nothing at the reach', () => {
    // ⚠️ `rr = mix(r, r0, w)` with `w` the catchment weight, so the pull is FULL
    // where the mouth is and EXACTLY the identity at the REACH — which is what
    // keeps the field seamless where it stops. It is not a fudge: a back-trace
    // that still moved parcels at the disc's edge would draw a visible
    // discontinuity against nothing at all.
    //
    // ⚠️ THE REACH IS THE COMPILER'S AND NO LONGER THIS FILE'S. It defaulted to
    // `MIST_REACH` (14 wu, the retired patch's half-extent) while this file
    // owned a draw; the only program that compiles the back-trace now binds
    // `COHORT_LENS_REACH` (30 wu, sized for a 28 wu disc), so the parameter is
    // required and the number comes from the draw that uses it.
    const tau = 3;
    const reach = COHORT_LENS_REACH;
    expect(LENS.uniforms.uReach.value).toBe(reach);
    // Close to the sink the weight is ~1, so the traced radius is the pure one.
    const near = mistBacktrace(0.05, 0, MIST_SINK_K, MIST_SWIRL, tau, reach);
    expect(Math.hypot(...near))
      .toBeCloseTo(mistSinkRadius(0.05, MIST_SINK_K, tau), 3);
    // At the reach the weight is exactly zero, so the point does not move.
    expect(mistCatchment(reach, reach)).toBe(0);
    const edge = mistBacktrace(reach, 0, MIST_SINK_K, MIST_SWIRL, tau, reach);
    expect(edge[0]).toBeCloseTo(reach, 12);
    expect(edge[1]).toBeCloseTo(0, 12);
  });

  it('the mirror is the shipped GLSL, expression for expression', () => {
    // ⚠️ R15 SHIPPED A TRANSLITERATION THAT SILENTLY DRIFTED FROM ITS SHADER,
    // and every proof above is worthless if this one fails. Both formulas are
    // pinned as TEXT in the fragment source.
    // ⭐ `k` IN THE MIRROR IS `uK * vShareF` IN THE SHADER, and that is the
    // whole of the share's effect on the flow: the cohort's own strength, from
    // the vertex stage's one factor. The mirror takes the product as its `k`.
    expect(LENS_FRAGMENT).toContain('float r0 = sqrt(r2 + uK * vShareF * tau);');
    expect(LENS_FRAGMENT).toContain('float rr = mix(r, r0, w);');
    expect(LENS_FRAGMENT).toContain('float ang = uSwirl * log(rr / r);');
    // …and the weight the mix is taken on is the catchment, squared, the same
    // expression `mistCatchment` computes.
    expect(LENS_FRAGMENT).toContain('float w = 1.0 - r2 / (uReach * uReach);');
    expect(LENS_FRAGMENT).toContain('w *= w;');
    // The drift is SUBTRACTED: τ is an age, so a parcel now here was one drift
    // step BACK along the flow. (The preview added it; its ambient swirl was a
    // divergence-free wiggle where the sign is invisible. This one's is not.)
    expect(LENS_FRAGMENT).toContain('vec2 d = q - vDrift * (uDrift * tau);');
    // And the rotation is the one the turn describes, applied to the offset.
    expect(LENS_FRAGMENT)
      .toContain('return vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y) / r * rr;');
  });
});

/* -------------------------------------------------------------------------- *
 * The share: how hard THIS cohort drinks.
 * -------------------------------------------------------------------------- */

describe('colony mist — the share drives the sink', () => {
  const MAX = 0.616873; // mainnet's top cohort, 2026-09-02

  it('is the floor at nothing, exactly 1 at the maximum, and monotone between', () => {
    // ⭐⭐ THE SHARE IS A RATE AND THE SINK'S k IS A RATE, which is the whole
    // reason this factor exists on this layer and on no other. The two ends are
    // identities rather than approximations: `mix(f, 1, 0)` is `f` and
    // `mix(f, 1, 1)` is 1, so the busiest cohort in view drinks at exactly the
    // shipped `k` and the supremum below is unmoved.
    expect(mistShareFactor(0, MAX, MIST_SHARE_FLOOR)).toBe(MIST_SHARE_FLOOR);
    expect(mistShareFactor(MAX, MAX, MIST_SHARE_FLOOR)).toBe(1);
    let previous = -Infinity;
    for (let k = 0; k <= 200; k += 1) {
      const value = mistShareFactor((k / 200) * MAX, MAX, MIST_SHARE_FLOOR);
      expect(value).toBeGreaterThan(previous);
      expect(value).toBeGreaterThanOrEqual(MIST_SHARE_FLOOR);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
    // ⭐ AND THE SMALLEST COHORT MAINNET ACTUALLY HAS STILL DRINKS. 0.0029 % of
    // the week against the top row's 61.7 % — a ratio of 4.7e-5 — so without
    // the floor its patch would be motionless. At 0.35 it pulls at a third of
    // the busiest one's strength, which is the number the live leg judges.
    expect(mistShareFactor(0.000029, MAX, MIST_SHARE_FLOOR))
      .toBeCloseTo(MIST_SHARE_FLOOR, 4);
    expect(mistShareFactor(0.0227, MAX, MIST_SHARE_FLOOR)).toBeCloseTo(0.374, 3);
    expect(MIST_SHARE_FLOOR).toBe(0.35);
  });

  it('CLAMPS above the maximum, so a stale divisor is a wrong ratio and never a runaway', () => {
    // ⚠️ `uShareMax` is written from the lane's own walk, so it moves with the
    // lane — but a frame between a window change and the next walk would
    // otherwise hand the shader a share ABOVE its divisor. The clamp makes that
    // frame merely wrong in proportion instead of pulling harder than `k`.
    expect(mistShareFactor(MAX * 2, MAX, MIST_SHARE_FLOOR)).toBe(1);
    expect(mistShareFactor(1, 0.02, MIST_SHARE_FLOOR)).toBe(1);
    // …and a maximum of zero — no cohort took anything — is the floor for
    // everybody rather than a division by nothing.
    expect(Number.isFinite(mistShareFactor(0, 0, MIST_SHARE_FLOOR))).toBe(true);
    expect(mistShareFactor(0, 0, MIST_SHARE_FLOOR)).toBe(MIST_SHARE_FLOOR);
    // A negative share cannot arrive (`producerLedgerIsCoherent` and the window
    // both forbid it) and is still bounded below.
    expect(mistShareFactor(-1, MAX, MIST_SHARE_FLOOR)).toBe(MIST_SHARE_FLOOR);
  });

  it('the mirror is the shipped GLSL, expression for expression', () => {
    // ⚠️ A MIRROR THAT DRIFTS PROVES NOTHING — R15 shipped exactly that. The
    // factor is computed ONCE PER INSTANCE in the vertex stage and carried as a
    // varying, so the pin is the vertex line and the reading is the fragment's
    // two multiplies.
    expect(LENS_VERTEX).toContain(
      'vShareF = mix(uShareFloor, 1.0, clamp(aShare / max(uShareMax, 1e-6), 0.0, 1.0));',
    );
    expect(LENS_VERTEX).toContain('varying float vShareF;');
    expect(LENS_FRAGMENT).toContain('varying float vShareF;');
    // …and the TS is that expression, term for term, in a language a test can
    // evaluate. Both are read out of the source so a rename on either side
    // fails here rather than in a browser.
    expect(SOURCE).toContain(
      'const t = Math.min(Math.max(share / Math.max(shareMax, 1e-6), 0), 1);',
    );
    expect(SOURCE).toContain('return floor + (1 - floor) * t;');
    // `mix(a, b, t)` IS `a + (b - a) * t`, which for b = 1 is the line above.
    const glslMix = (a: number, b: number, t: number): number => a + (b - a) * t;
    for (let k = 0; k <= 100; k += 1) {
      const share = (k / 100) * MAX * 1.5; // past the maximum, to catch the clamp
      const t = Math.min(Math.max(share / Math.max(MAX, 1e-6), 0), 1);
      expect(mistShareFactor(share, MAX, MIST_SHARE_FLOOR))
        .toBeCloseTo(glslMix(MIST_SHARE_FLOOR, 1, t), 12);
    }
  });

  it('scales the SINK and the PILE and nothing else, the gulp least of all', () => {
    // ⭐⭐ ONE FACTOR, TWO READERS, AND THEY ARE THE SAME QUANTITY SAID TWICE:
    // `d(r²)/dt = -k` is the speed the streamlines run at, and the pile is what
    // arriving at that speed leaves where the disc's inner edge is. Scaling only
    // the sink would give a slow cohort an edge as bright as a fast one's.
    expect(LENS_FRAGMENT).toContain('float r0 = sqrt(r2 + uK * vShareF * tau);');
    expect(LENS_FRAGMENT).toContain('float pile = uConc * vShareF * cc * cc * cc');
    // ⭐ AND THE BLOCK FLARE IS DELIBERATELY NOT SCALED: one block is one block,
    // whichever cohort won it, so the gulp is ADDED to the pile after the share
    // has weighed it.
    expect(LENS_FRAGMENT).toMatch(/pile = uConc \* vShareF[^;]*\+ 2\.2 \* gulp/);
    expect(LENS_FRAGMENT).not.toMatch(/gulp \* [^;]*vShareF/);
    // Exactly two readings of the factor in the fragment, so a third would be a
    // deliberate edit rather than a drift.
    expect([...LENS_FRAGMENT.matchAll(/vShareF/g)]).toHaveLength(3); // decl + 2
    // ⚠️ It weighs no colour and no amplitude. `uAmp` is still the program's
    // ONLY scale on its brightness; the share changes how the substance MOVES.
    expect(LENS_FRAGMENT).toContain('acc.rgb * uAmp * cohortEnergy');
    expect(LENS_FRAGMENT).not.toMatch(/uCol\w+[^;]*vShareF|vShareF[^;]*uAmp/);
  });

  it('reaches the SPECKS too, at the same rate, through the layer above', () => {
    // ⚠️⚠️ THE MOTES CANNOT READ `aShare`. Their geometry is a `THREE.Points`
    // with one vertex per MOTE, so a per-instance lane would be read by the
    // first ninety-sixth of the colony's specks and by nothing else — which is
    // why `ColonyCohorts` runs THIS function on the CPU and writes its result
    // into `aStrength`. The parity that matters is that it is the same
    // function: a mote falling at a rate its own streamlines do not run at is a
    // parcel of a substance it is not part of.
    const layer = readFileSync(
      resolve(process.cwd(), 'src/components/ColonyCohorts.tsx'),
      'utf8',
    );
    expect([...layer.matchAll(/mistShareFactor\(share\[index\] \?\? 0, shareMaxRef\.current\)/g)])
      .toHaveLength(2);
    // …and the same floor on both sides, because the CPU call takes the default.
    expect(mistShareFactor(0, 1)).toBe(MIST_SHARE_FLOOR);
    expect(LENS.uniforms.uShareFloor.value).toBe(MIST_SHARE_FLOOR);
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

  it('is the ONE tile the substance is read out of, mipmapped and repeating', () => {
    // ⭐ MODULE-LAZY AND SHARED: two tiles would be two substances, 256 kB
    // each, with a filament in one cohort's disc matching nothing in the next.
    // ⚠️ It had a second reader — the ambient sheets — until 2026-09-02 and a
    // third — the intake patch — until 2026-09-03, and laziness still earns its
    // keep: the lensed mark is the only draw left, so a scene with no attested
    // producer never builds the tile at all.
    const texture = makeMistNoiseTexture();
    expect(makeMistNoiseTexture()).toBe(texture);
    expect(LENS.uniforms.uNoise.value).toBe(texture);
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
 * A library, and the one program that compiles it.
 * -------------------------------------------------------------------------- */

describe('colony mist — a library with one compiler', () => {
  it('ships no material of its own, and no `texture2D` anywhere', () => {
    // ⭐⭐⭐ THE FILE STOPPED DRAWING ON 2026-09-03, and this is the assertion
    // that says so rather than the header. A factory here would be a second
    // picture of the substance beside the computed one — which is exactly the
    // composed form the lensed mark replaced.
    const code = stripComments(SOURCE);
    expect(code).not.toMatch(/new THREE\.ShaderMaterial/);
    expect(code).not.toMatch(/export function make\w*Material/);
    // ⭐⭐ AND THE FETCH IS GONE WITH IT. `MIST_NOISE_GLSL` sampled the tile with
    // `texture2D` and let the driver pick the mip from screen derivatives, which
    // is right for a surface and WRONG inside a ray march: neighbouring rays end
    // at unrelated places, the derivatives explode along one axis and the tile
    // comes back in dashed radial stripes. With the patch retired there is one
    // fetch left in the feature and it states its level — so the lens's "no
    // texture2D" guard is now a fact about the whole library rather than a claim
    // about one program.
    expect(code).not.toContain('texture2D');
    expect(MIST_NOISE_LOD_GLSL).toContain('textureLod(uNoise, p, uLod)');
  });

  it('lends every snippet it exports to a program that compiles it', () => {
    // ⚠️ A LIBRARY NOBODY INCLUDES IS DEAD TEXT NO GUARD WOULD CATCH. The
    // shader-guard files credit BORROWED snippets against the programs that
    // paste them in, so a snippet exported here and compiled nowhere would
    // simply vanish from both ledgers — short on neither side, and wrong. This
    // is the other half of that pair: every string this module exports is in the
    // one program that assembles the substance.
    const snippets: [string, string][] = [
      ['MIST_NOISE_LOD_GLSL', MIST_NOISE_LOD_GLSL],
      ['MIST_MEDIUM_GLSL', MIST_MEDIUM_GLSL],
      ['MIST_BACKTRACE_GLSL', MIST_BACKTRACE_GLSL],
      ['MIST_FIBRES_GLSL', MIST_FIBRES_GLSL],
      ['MIST_DISC_COLOR_GLSL', MIST_DISC_COLOR_GLSL],
    ];
    for (const [name, snippet] of snippets) {
      const body = squash(stripComments(snippet));
      expect(`${name}: ${LENS_FRAGMENT.includes(body)}`).toBe(`${name}: true`);
    }
    // …and the two that belong to the VERTEX stage are there instead, which is
    // where a per-instance fact has to be computed.
    for (const [name, snippet] of [
      ['MIST_SHARE_FACTOR_GLSL', MIST_SHARE_FACTOR_GLSL],
      ['MIST_SEAT_DRIFT_GLSL', MIST_SEAT_DRIFT_GLSL],
    ] as const) {
      const body = squash(stripComments(snippet));
      expect(`${name}: ${LENS_VERTEX.includes(body)}`).toBe(`${name}: true`);
    }
  });

  it('drifts on the colony’s own tangent, which is what gives the flow a side', () => {
    // ⭐ THE COHORT MOVES THROUGH THE MIST AS THE PLATE TURNS, so the substance
    // streams past it. The direction is the tangential one at the sink, computed
    // once per instance in the vertex stage — a per-fragment version would be
    // the same number computed 10^5 times, and inside a ray march it would be
    // computed once per STEP.
    expect(LENS_VERTEX).toContain('vec2 tangent = vec2(-seat.z, seat.x);');
    expect(LENS_VERTEX).toContain(
      'vDrift = tangentLen > 1e-4 ? (tangent / tangentLen) * uDriftSign : vec2(1.0, 0.0);',
    );
    // ⚠️ The seat is the instance's COLONY-FRAME position — `instanceMatrix`
    // alone, without the model matrix — because the medium is sampled in that
    // frame too. A world-frame seat would sweep several world units a second as
    // the plate turns, and the substance would swim past its own mouth.
    expect(LENS_VERTEX)
      .toContain('vec3 seat = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;');
    // A sign, and the derivation: the group turns by `rotation.y -= rate * dt`,
    // so a cohort's world velocity is along (-z, x) and the mist streams past it
    // the other way. Derived and still only derived — a sign is what a
    // screenshot settles, and the live leg owns it.
    expect(Math.abs(MIST_DRIFT_SIGN)).toBe(1);
    expect(MIST_DRIFT_SIGN).toBe(-1);
    expect(LENS.uniforms.uDriftSign.value).toBe(MIST_DRIFT_SIGN);
  });
});

