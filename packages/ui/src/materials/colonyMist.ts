import * as THREE from 'three';
import { mulberry32 } from '../layout';

/**
 * The substance a POW cohort drinks, as a GLSL library and a noise tile.
 *
 * ⭐⭐⭐ THE PEER MESH IS THE BOUNDARY BETWEEN TWO UNIVERSES. Above it the cell
 * canopy — CKB's spacetime; below it the other one. A POW cohort is the place
 * the membrane is OPEN, and this file is what is on the other side: a faint
 * substance that permeates the space under the plane (「无处不在到处弥漫的物质」).
 * It has NO SHAPE OF ITS OWN — not a sea, not a coast, not curtains, not a
 * plume — and it is SECONDARY: it must never take focus from the peer mesh or
 * the cell galaxy. The sink and the drift are what give it one.
 *
 * ⭐⭐⭐ AND SINCE 2026-09-03 THIS FILE DRAWS NOTHING AT ALL. It used to own a
 * DRAW — `makeCohortIntakePatchMaterial`, one instanced patch of the medium per
 * cohort, lying 2.5 wu under the plane and lifted into a mound whose top was
 * the level the mouth's window showed — and before that a pair of ambient
 * sheets under the whole colony. Both are gone, and for opposite reasons. The
 * sheets were measured invisible (2/255 at their brightest pixel anywhere on
 * the canvas) and expensive (0.90 ms of the layer's 1.06 ms at the app camera)
 * on 2026-09-02. The patch went one day later with the whole composed form: the
 * lensed cohort (`colonyLens.ts`) samples this same medium where a bent light
 * ray crosses the colony plane, which is the intake drawn as a CONSEQUENCE of
 * the mass rather than as a surface mapped beside it — and two draws of one
 * substance, one computed and one painted, would disagree the first time either
 * was tuned.
 *
 * ⭐⭐ SO WHAT IS HERE IS THE SUBSTANCE ITSELF, and every consumer compiles it:
 * the medium (`MIST_MEDIUM_GLSL`), its spiral back-trace
 * (`MIST_BACKTRACE_GLSL`), the filaments (`MIST_FIBRES_GLSL`), the colour ramp
 * (`MIST_DISC_COLOR_GLSL`), the share factor and the seat/drift preamble, the
 * one 256² tile they all read, and the pure-TypeScript mirrors the tests
 * evaluate. ⛔ A snippet in here that no program compiles is dead weight the
 * guard tests will not catch — `colonyLensShaderGuards.test.ts` credits the
 * borrowed side of the ledger, so add nothing here without a consumer.
 *
 * ⭐⭐⭐ AND THE INTAKE IS STILL THE POINT (「pow cohort 汲取能量的视觉效果」). The
 * medium is drawn where it is BEING TAKEN and NOWHERE ELSE: there is no floor,
 * no sheet and no ground term in this file, and the omnipresence is stated by
 * the CATCHMENT — the reach around each mouth over which the back-trace pulls,
 * shown only inside the image the lens computes. ⛔ Do not put a floor back
 * without a NEW measurement that says a viewer can see one.
 *
 * ⛔⛔⛔ NOTHING IS EVER DRAWN ABOVE THE PLANE, and there is NO COLUMN, PLUME,
 * FUNNEL OR PILLAR under a mouth AT ANY BRIGHTNESS PROFILE. Twenty-five rounds
 * measured that: a shaft gated through the hole is invisible except from
 * directly overhead, and an ungated one is a searchlight in miniature — up
 * close, a saucer with a tractor beam. ⭐ ONLY SURFACES BEING DRAWN EVER READ AS
 * INTAKE. The lensed disc IS such a surface — the far side of it folded over
 * the top of the shadow is the substance seen from outside, moving.
 *
 * ⭐⭐⭐ AND THE COHORT'S SHARE DRIVES THE SINK, BECAUSE `k` IS A RATE AND A
 * SHARE IS A RATE. `aShare` is the fraction of its window the cohort took — the
 * indexer's week when there is one, the 240-block ring when there is not — and
 * `MIST_SHARE_FACTOR_GLSL` turns it into ONE per-instance factor
 * (`MIST_SHARE_FLOOR`) that scales the sink strength `uK` and the pile the
 * arriving medium leaves at the lip. A 62 % cohort therefore drinks at the full
 * `k` and visibly faster than a 2 % one, which is the SAME quantity said twice:
 * `d(r²)/dt = -k` is the speed the streamlines carry and the pile is what
 * arriving at that speed leaves behind.
 */

/* -------------------------------------------------------------------------- *
 * The medium's own texture: one 256² tile, mipmapped.
 * -------------------------------------------------------------------------- */

/**
 * ⭐⭐⭐ THE SUBSTANCE IS A SAMPLER AND NOT AN ARITHMETIC LATTICE, AND THAT IS
 * MEASURED. It covers a 28 wu disc per cohort, it is read four times per
 * fragment for the two cross-faded phases, and — the decisive one — ⭐ IT MUST
 * PREFILTER WITH DISTANCE. R19 measured that unfiltered grain at this scale
 * either aliases or prefilters to nothing past about 25 wu; a mipmapped tile is
 * what let the preview's mist hold together at the app camera, where a cohort
 * is 100+ wu away. A lattice evaluated in the fragment shader has no mips and
 * cannot get any without a screen-footprint estimate per octave.
 *
 * ⚠️ AND INSIDE A RAY MARCH THE MIPS HAVE TO BE ASKED FOR BY LEVEL — see
 * `MIST_NOISE_LOD_GLSL`, which is the only fetch left in the feature.
 */
export const MIST_NOISE_SIZE = 256;

/**
 * Lattice cells across the tile, per RGBA channel: four octaves in one fetch.
 *
 * ⭐ THE COUNTS ARE WHAT MAKES THE TILE SEAMLESS. The lattice wraps modulo the
 * cell count, so a channel whose count divides the tile exactly repeats with no
 * seam under `RepeatWrapping` — which is why these are integers and why the
 * generator takes `% n` on both lattice corners. The lensed cohort — the tile's
 * ONLY reader since 2026-09-03 — takes R and G for the medium's two octaves and
 * R, G and B again for the fibres and their lane mask; A is generated for free
 * and is unread. B was the ambient sheets' slow patchiness until the sheets
 * were measured out on 2026-09-02 (see this file's header).
 * ⭐ The four stay because the upload is `RGBAFormat` either way — there is no
 * narrower tile to build — and because each channel's lattice is seeded
 * independently, so the ones that are read are bit-identical with or without
 * them.
 */
export const MIST_NOISE_CELLS: readonly number[] = [8, 16, 32, 64];

/**
 * The tile's seed. ⭐ A CONSTANT, because the mist has to be the same substance
 * from session to session: a re-seeded tile would move every filament under
 * every cohort on a reload, and the layer would stop being a place.
 */
export const MIST_NOISE_SEED = 0x9e3779b9;

/**
 * The tile's bytes, as a pure function — no THREE, no GL, no document.
 *
 * ⭐ SEPARATE FROM THE TEXTURE SO A TEST CAN CALL IT. The wrapper below builds
 * a `DataTexture`, which is what a scene needs and what a jsdom test has no use
 * for; the properties worth pinning (determinism, the wrap, the mean and the
 * range) are all properties of these bytes.
 *
 * Bilinear value noise with the smoothstep fade `t²(3 - 2t)`, one independent
 * lattice per channel, keyed off `seed` so two channels never correlate.
 */
export function mistNoiseTile(
  size: number = MIST_NOISE_SIZE,
  seed: number = MIST_NOISE_SEED,
) {
  const data = new Uint8Array(size * size * 4);
  const fade = (t: number): number => t * t * (3 - 2 * t);
  for (let channel = 0; channel < 4; channel += 1) {
    const cells = MIST_NOISE_CELLS[channel];
    // ⚠️ The channel's own stream. `Math.imul` rather than a plain multiply so
    // the wrap is defined at every channel index rather than at the four that
    // happen to fit in a double.
    const random = mulberry32(seed ^ Math.imul(channel, 0x9e3779b1));
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i += 1) lattice[i] = random();
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const fx = (x / size) * cells;
        const fy = (y / size) * cells;
        // ⭐ THE `% cells` IS THE SEAM. Without it the last cell interpolates
        // toward a corner that does not exist and the tile shows a line down
        // two of its edges the moment it repeats.
        const x0 = Math.floor(fx) % cells;
        const y0 = Math.floor(fy) % cells;
        const x1 = (x0 + 1) % cells;
        const y1 = (y0 + 1) % cells;
        const tx = fade(fx - Math.floor(fx));
        const ty = fade(fy - Math.floor(fy));
        const value =
          (1 - ty) * ((1 - tx) * lattice[y0 * cells + x0] + tx * lattice[y0 * cells + x1]) +
          ty * ((1 - tx) * lattice[y1 * cells + x0] + tx * lattice[y1 * cells + x1]);
        data[(y * size + x) * 4 + channel] = Math.round(value * 255);
      }
    }
  }
  return data;
}

let mistNoiseTexture: THREE.DataTexture | null = null;

/**
 * The tile as a texture, built once for the module's life.
 *
 * ⭐ MODULE-LAZY AND SHARED, because both materials sample the SAME substance
 * and two tiles would be two substances, 256 kB each, with a filament under one
 * cohort matching nothing under the next. It is never disposed on purpose: it
 * outlives every mount of the layer, and a colony that unmounts and remounts
 * (a profile switch, a re-plan) must not pay 256 k of value noise again.
 *
 * ⚠️ `LinearMipmapLinearFilter` + `generateMipmaps` IS THE WHOLE REASON THIS IS
 * A TEXTURE — see `MIST_NOISE_SIZE`. Drop either and the medium aliases at the
 * app camera, which is the only camera anybody ever screenshots.
 *
 * ⭐ IT COSTS 7.5–10.5 ms TO BUILD, MEASURED IN THE BROWSER 2026-09-02 (five
 * fresh module instances on the reference machine; 262,144 faded bilinear
 * samples across four channels). That is a MOUNT-TIME cost paid once for the
 * module's life, not a per-frame one, and it is UNDER the 50 ms `longtask`
 * threshold: over the first five seconds after navigation the longest long task
 * was 172 ms of the app's own boot work, and the tile never appeared as a task
 * of its own. ⚠️ The estimate this replaces was 15–50 ms, taken from four runs
 * of the pure function at a load average of 6 — it was 2–5× pessimistic. If a
 * later machine does see a hitch, the fix is to build it off the critical path
 * or at 128², NEVER to drop the mips.
 */
export function makeMistNoiseTexture(): THREE.DataTexture {
  if (mistNoiseTexture !== null) return mistNoiseTexture;
  const texture = new THREE.DataTexture(
    mistNoiseTile(),
    MIST_NOISE_SIZE,
    MIST_NOISE_SIZE,
    THREE.RGBAFormat,
  );
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  mistNoiseTexture = texture;
  return texture;
}

/* -------------------------------------------------------------------------- *
 * The medium: what the substance looks like where it is drawn.
 * -------------------------------------------------------------------------- */

/**
 * The medium's sampling frequency, in tile-widths per world unit.
 *
 * At 0.085 the tile repeats every 11.8 wu and its coarsest channel's cell — 8
 * across the tile — is 1.47 wu, which is the size of one filament's
 * cross-section. That is deliberately COMPARABLE TO THE HOLE — 1.6 wu at the
 * retired aperture's mouth, 2.0 wu at the lensed shadow it became: the medium
 * has to resolve as structure at the edge of the hole or the gather reads as a
 * smooth glow, which is a lamp and not an intake.
 */
export const MIST_GRAIN = 0.085;

/** How much of the medium is the RIDGE rather than the raw noise. Lab: 0.85. */
export const MIST_RIDGE = 0.85;

/**
 * How sharply the ridge is drawn out into filaments.
 *
 * ⚠️ Its base is `1 - abs(2n - 1)`, which is in [0, 1] BY CONSTRUCTION and NOT
 * provably so from the source, because `n` comes out of a texture. The GLSL
 * carries an explicit `max(..., 0.0)` for exactly that reason — a negative base
 * is undefined for GLSL's power function, and undefined quietly.
 */
export const MIST_RIDGE_POW = 1.7;

/**
 * The filaments' amplitude — the whole visible weight of the streak field.
 *
 * ⚠️ THE SUBSTANCE HAS NO GROUND TERM AT ALL, which is the preview's own
 * `uBase: 0` and is what makes the mist "visible only where it is being taken":
 * every term that reads it is multiplied by the catchment weight or by the
 * gather, so a fragment with no mouth in it draws nothing. ⭐ AND NOTHING ELSE
 * DRAWS A GROUND EITHER — the ambient sheets that used to lie under the whole
 * plane at 0.03 were measured invisible (2/255 at their brightest) and
 * expensive (0.90 ms of 1.06) and removed on 2026-09-02, so this term's absence
 * is the whole feature's statement rather than a division of labour.
 */
export const MIST_FIL = 0.24;

/**
 * Seconds per flow-map cycle.
 *
 * ⭐⭐ TWO PHASES HALF A CYCLE APART, CROSS-FADED, IS WHY THE SPIRAL NEVER
 * RESETS IN VIEW. A back-trace of age `tau` stretches the medium more the older
 * it is, so a single phase would visibly snap when `tau` wrapped. The preview
 * measured 14 s and 8 s of churn outward at the lip at this period; a longer one
 * stretches the medium into smears and a shorter one makes the cross-fade
 * itself the motion.
 */
export const MIST_PERIOD = 6;

/**
 * The ambient drift's speed, in world units per second.
 *
 * ⚠️⚠️ IT IS NOT THE COLONY'S ROTATION RATE, AND THE GAP IS MEASURED. The
 * colony turns at `LIVE.galaxy.rotationRate` = 0.00125 rad/s and `attestedPos`
 * puts a cohort at a mean radius of E[sqrt(u)] * 92 = 61 wu, so a cohort's own
 * tangential speed is about 0.077 wu/s — which would advect the medium 0.46 wu
 * per flow-map period, 3.9 % of one grain cell, i.e. NOTHING. The preview's
 * ambient swirl runs at about 0.52 wu/s typical (peak 1.5): ten times faster,
 * and visible as a slow slide of half a grain cell per second. ⭐ SO THIS IS A
 * STYLISTIC AMBIENT, NOT THE ROTATION, and it is honest about that: the medium
 * is sampled in COLONY-FRAME coordinates (constant per mark, no shimmer as the
 * plate turns), and this term is the relative streaming laid on top of it, in
 * the direction the world-static mist would move.
 *
 * ⭐ CONFIRMED LIVE 2026-09-02. With the colony's own rotation set to zero, the
 * medium at a 40 px/wu mouth block-matches to a median radial −0.656 wu/s in
 * the 5–12 wu annulus and a median tangential −0.231 wu/s in the 2–5 wu one —
 * an order above the 0.077 wu/s a cohort's rotation could contribute, exactly
 * as the arithmetic above predicts. Not retuned.
 */
export const MIST_DRIFT = 0.8;

/**
 * Which way that drift runs, as a sign on the colony's own tangential
 * direction.
 *
 * ⚠️ DERIVED, AND STILL A KNOB, BECAUSE A SIGN IS WHAT A SCREENSHOT SETTLES.
 * `NetworkColony` turns the group by `rotation.y -= rate * dt`, so a cohort's
 * WORLD velocity is along `(-z, x)` and the mist therefore streams past it
 * along `(z, -x)` — the negative of the tangential vector the vertex stage
 * builds. Downstream is where the wake goes, so the sign has to be right or the
 * depleted band sits in FRONT of the mouth, which reads as a shadow rather than
 * as a wake.
 *
 * ⚠️ STILL OPEN AFTER THE LIVE LEG OF 2026-09-02: measuring the spiral required
 * `cohortWake` at 0 (a static depleted band survives the background subtraction
 * and biases the block match), so that session turned the wake OFF and never
 * put a screenshot of it in front of anybody. The sign is derived and it is
 * still only derived.
 */
export const MIST_DRIFT_SIGN = -1;

/* -------------------------------------------------------------------------- *
 * The sink: how the mouth takes it.
 * -------------------------------------------------------------------------- */

/**
 * Sink strength, in square world units per second: `r0 = sqrt(r² + k * tau)`.
 *
 * ⭐ THAT IS THE EXACT BACK-TRACE OF A 2-D POINT SINK, not an approximation of
 * one. A sink of strength `k` has radial velocity `-k / (2r)`, so `d(r²)/dt =
 * -k` and the radius a parcel had `tau` ago is exactly `sqrt(r² + k*tau)`. The
 * medium is therefore advected by the flow rather than warped toward it, which
 * is why the filaments bend into the mouth instead of pointing at it.
 *
 * ⭐⭐ IT READS AS A SINK ON THE LENSED DISC, MEASURED 2026-09-03. Block matching
 * a live 40 px/wu frame (16×16 blocks, ±48 px search, radius and azimuth from a
 * real ray/plane unprojection and never from screen pixels) gives an inward
 * ratio over the 5–12 wu annulus of **1.79 : 1** on the top cohort at the full
 * factor, median radial **−0.381 wu/s** against the model's −0.706 at r = 8.5.
 * ⚠️ READ THIS SINK AT 5–12 wu: inside 5 wu the true displacement at `k` = 12 is
 * past what 16×16 block matching can follow, and that annulus has never resolved
 * in any leg. `MIST_SHARE_FLOOR` below carries the measurement that this `k` is
 * really what the share is scaling.
 */
export const MIST_SINK_K = 12;

/**
 * The vortex-to-sink ratio: `theta0 = theta + s * ln(r0 / r)`.
 *
 * ⭐ THE LOG SPIRAL IS WHAT MAKES IT AN INTAKE RATHER THAN A DRAIN. A pure sink
 * pulls the medium straight in and reads as radial streaks — which is a star,
 * the failure the retired aperture's 88 striae were counted to escape. Adding a
 * circulation makes every streamline a logarithmic spiral, and a spiral is a
 * shape a viewer reads as SWALLOWING. 1.4 turns per e-fold of radius, from the
 * approved preview.
 *
 * ⭐ It is the same for every cohort on purpose. Six same-handed spirals may
 * read as stamped; deriving the handedness from the producer key is a
 * deliberate follow-up (§6 of the plan), not an omission.
 */
export const MIST_SWIRL = 1.4;

/* ---- the filaments, which only a close camera can resolve ---------------- *
 *
 * ⭐ THESE SIX ARE THE MEDIUM'S TEXTURE AT ARM'S LENGTH, and only the lensed
 * cohort binds them, because it is the one draw that gets close enough for a
 * fibre to be a fibre — the retired patch was a 14 wu surface seen from 100 wu
 * away, where a filament finer than the streaks prefilters to grey.
 * `MIST_FIBRES_GLSL` is the shape and these are its starting values, from the
 * approved preview. They live here, with the substance, so that the day a
 * second program wants the same threads there is one place to change.
 */

/** Angular repeats of the fibre field around the mouth, per full turn. */
export const MIST_FIBRE_T = 1;

/** Radial repeats per e-fold of radius: the threads' pitch as they wind in. */
export const MIST_FIBRE_R = 7;

/** How thread-like a thread is: the exponent on the ridge. Higher is finer. */
export const MIST_FIBRE_SHARP = 2.2;

/** How fast the whole fibre field turns, in radians per second of sim time.
 *  ⭐ It is a slow drift and NOT the disc's orbital speed: the material's own
 *  motion is the back-trace's, and this only keeps the threads from being a
 *  frozen stamp. */
export const MIST_FIBRE_ROT = 0.25;

/** Where a bundle of threads starts, on the coarse lane mask. */
export const MIST_LANE_LO = 0.22;

/** …and where it is fully open. Threads come in bundles with gaps between
 *  them, which is what keeps a fibred disc from reading as corduroy. */
export const MIST_LANE_HI = 0.68;

/**
 * What the SMALLEST cohort's sink is worth, as a fraction of the largest one's.
 *
 * ⭐⭐ THE SHARE IS A RATE ON THIS LAYER — see the file header — so it scales
 * `uK` (wu²/s) and the pile that arriving at that speed leaves at the lip. The
 * factor is `mix(floor, 1, share / shareMax)`, so the busiest cohort in view
 * drinks at the full `k` and every other one drinks in proportion.
 *
 * ⚠️ A STARTING VALUE, AND THE FLOOR IS WHY IT IS NOT ZERO. Mainnet's smallest
 * measured cohort held 0.0029 % of the week on 2026-09-02 and its second
 * smallest 1.7 %; at a floor of 0 both would draw a disc with no visible
 * motion at all, which says "this cohort is not taking anything" when what is
 * true is "this cohort is taking little". At 0.35 the 2.3 % row comes out at
 * 0.374 against the top row's 1 — the busiest cohort drinks 2.7× as hard, and
 * the smallest still moves. ⚠️ IT IS NO LONGER A KNOB: `cohortShareFloor` went
 * with the intake patch on 2026-09-03, so settling it now means editing this
 * constant.
 *
 * ⭐⭐ AND THE FLOOR DOES CARRY AN INTAKE, MEASURED 2026-09-03. The smallest
 * mainnet cohort in view (1.65 % of the week, factor 0.367) block-matched at
 * **1.40 : 1 inward** over 5–12 wu with a median radial of −0.245 wu/s — a sink,
 * not a still picture. The same cohort with the floor written to 1 ran
 * **3.25× faster** (−0.797 wu/s) against a predicted 2.72×, which is what says
 * the factor is really driving `k` rather than a coincidence of two crops.
 * ⚠️ Still open by EYE: 1.40 : 1 is a sink to a block matcher, and whether it
 * reads as one to a viewer at the app camera is a judgement nobody has recorded.
 */
export const MIST_SHARE_FLOOR = 0.35;

/**
 * How far the gulp reaches, in rim radii.
 *
 * The block flare is `clamp(rim * 2.2 / r, 0, 1)` — full out to 2.2 rim radii
 * and falling as `1/r` past that, so the swallow is seen as the whole gathering
 * annulus surging rather than as a point flashing.
 */
export const MIST_GULP_R = 2.2;

/* -------------------------------------------------------------------------- *
 * The arithmetic, as pure functions — the mirror the tests read.
 * -------------------------------------------------------------------------- */

/**
 * How hard this cohort drinks, relative to the busiest one in view.
 *
 * ⭐ THE MIRROR OF THE ONE LINE THE VERTEX STAGE COMPUTES, and the only place
 * the factor is written in a language a test can evaluate:
 * `mix(floor, 1, clamp(share / max(shareMax, 1e-6), 0, 1))`. It is 1 at
 * `shareMax`, `floor` at zero, monotone between them, and CLAMPED above — a
 * share larger than the maximum handed in cannot make a cohort drink faster
 * than `k`, which is what keeps a stale `uShareMax` a wrong RATIO rather than
 * an unbounded sink.
 *
 * ⚠️ The `1e-6` is not a taste either: `shareMax` is 1 when the lane holds no
 * live entry, but a caller that hands over a zero maximum gets `floor` for
 * everybody rather than a division by zero, which is the honest reading of "no
 * cohort took anything".
 */
export function mistShareFactor(
  share: number,
  shareMax: number = 1,
  floor: number = MIST_SHARE_FLOOR,
): number {
  const t = Math.min(Math.max(share / Math.max(shareMax, 1e-6), 0), 1);
  return floor + (1 - floor) * t;
}

/**
 * The catchment weight: compact support, zero with zero slope at `reach`.
 *
 * ⚠️ `reach` IS REQUIRED AND HAS NO DEFAULT ANY MORE. It defaulted to
 * `MIST_REACH` (14 wu, the retired patch's half-extent) while this file owned a
 * draw; it does not own one now, so the reach belongs to whichever program
 * compiles `MIST_BACKTRACE_GLSL` and binds `uReach` — 30 wu in the lens
 * (`COHORT_LENS_REACH`), folded to the far disc's 6 in the motes. A default
 * here would be a fourth number nothing draws at.
 */
export function mistCatchment(r: number, reach: number): number {
  const x = (r * r) / Math.max(reach * reach, 1e-6);
  if (x >= 1) return 0;
  const b = 1 - x;
  return b * b;
}

/**
 * Where a parcel of the medium now at radius `r` was `tau` seconds ago, in
 * radius: the exact back-trace of a 2-D point sink of strength `k`.
 *
 * `d(r²)/dt = -k` for a sink, so `r0² = r² + k * tau` — an identity at
 * `tau = 0`, and monotonically outward from there.
 */
export function mistSinkRadius(r: number, k: number, tau: number): number {
  return Math.sqrt(r * r + k * tau);
}

/**
 * How far around it wound getting here: `theta0 - theta = swirl * ln(r0 / r)`.
 *
 * A vortex whose circulation is `swirl` times the sink's radial flow turns a
 * parcel by exactly this much per e-fold of radius, which is the definition of
 * a logarithmic spiral. Zero at `tau = 0`, because `r0 = r` there.
 */
export function mistSpiralTurn(r: number, r0: number, swirl: number): number {
  return swirl * Math.log(r0 / r);
}

/**
 * The shipped back-trace, in the sink's own plane coordinates: the point of
 * the medium that is now at `(x, z)` was here `tau` seconds ago.
 *
 * ⚠️ IT BLENDS BACK TO THE IDENTITY AT THE CATCHMENT'S EDGE, and that is not a
 * fudge — it is what keeps the field seamless where it stops. `rr = mix(r, r0,
 * w)` with `w` the catchment weight, so the sink's pull is full at the mouth and
 * exactly nothing at `reach`, where the disc has faded out anyway. The pure sink
 * form is `mistSinkRadius`, and this reduces to it as `r` approaches the sink,
 * where the catchment weight is 1.
 *
 * ⚠️ THE DRIFT IS SUBTRACTED, not added: `tau` is an age, so a parcel now here
 * was one drift-step BACK along the flow. (The preview added it; its ambient
 * swirl is a divergence-free wiggle where the sign is invisible, and this one's
 * is not — it decides which side of the mouth the wake trails on.)
 */
export function mistBacktrace(
  x: number,
  z: number,
  k: number,
  swirl: number,
  tau: number,
  reach: number,
  drift: readonly [number, number] = [0, 0],
  driftSpeed: number = 0,
): readonly [number, number] {
  const dx = x - drift[0] * driftSpeed * tau;
  const dz = z - drift[1] * driftSpeed * tau;
  const r2 = dx * dx + dz * dz;
  const w0 = 1 - r2 / Math.max(reach * reach, 1e-6);
  if (w0 <= 0) return [dx, dz];
  const w = w0 * w0;
  const r = Math.max(Math.sqrt(r2), 0.002);
  const r0 = mistSinkRadius(r, k, tau);
  const rr = r + (r0 - r) * w;
  const angle = mistSpiralTurn(r, rr, swirl);
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  return [((cs * dx - sn * dz) / r) * rr, ((sn * dx + cs * dz) / r) * rr];
}

/* -------------------------------------------------------------------------- *
 * The medium, as a GLSL library.
 * -------------------------------------------------------------------------- *
 *
 * ⭐⭐⭐ THE SUBSTANCE IS WRITTEN ONCE AND COMPILED INTO EVERY PROGRAM THAT
 * DRAWS IT. Until 2026-09-03 the medium and its back-trace were inline in the
 * intake patch and nowhere else, because there was nowhere else. The lensed
 * cohort samples the SAME substance where a bent light ray crosses the colony
 * plane, and a hand-copied second medium would be two substances the first time
 * either was tuned — which is exactly the failure `COHORT_GULP_GLSL` was made a
 * shared string to prevent one round earlier.
 *
 * ⭐⭐ THE SNIPPETS ARE FUNCTION TEXT AND NOTHING ELSE: no uniform block, no
 * varying block. Each program declares what it binds, in its own one place, and
 * `colonyLensShaderGuards.test.ts` proves that every `uNoise`/`u…`/`v…` name a
 * snippet reaches for is declared by the program that includes it. A snippet
 * that carried its own `uniform float uReach;` would collide with a program's
 * own declaration the moment two of them were pasted into one shader.
 *
 * ⭐ AND THE FETCH IS THE ONE THING THAT IS NOT IN THEM. `mistNoise(vec2 p, int
 * ch)` is declared by each program before the library goes in. The patch's used
 * `texture2D` and let the driver pick the mip from screen derivatives, which is
 * right for a surface; a ray march MUST NOT, because neighbouring rays end at
 * unrelated places, the derivatives explode along one axis and the tile comes
 * back in coarse stripes (§4 of the Gargantua plan). ⚠️ With the patch retired
 * there is exactly one fetch left in the feature and it states its level, so
 * `texture2D` does not appear in this file at all any more — which turns the
 * lens's "no texture2D" guard from a claim about a build step into a fact about
 * the text.
 */

/**
 * The fetch for a ray-march: the mip level is stated, never derived.: the mip level is stated, never derived.
 *
 * ⚠️ THIS IS THE ONE TRAP THAT COST THE LAB A ROUND. Inside a march the two
 * neighbouring fragments' samples come from unrelated points, so
 * `texture2D`'s implicit `dFdx`/`dFdy` are meaningless and the hardware reads a
 * far coarser level along one axis than the other — the noise came back as
 * dashed radial stripes rather than as a medium. `uLod` is the level, and the
 * lens's guard refuses any `texture2D` in its program at all.
 */
export const MIST_NOISE_LOD_GLSL: string = /* glsl */ `float mistNoise(vec2 p, int ch) {
  vec4 t = textureLod(uNoise, p, uLod);
  return ch == 0 ? t.r : ch == 1 ? t.g : ch == 2 ? t.b : t.a;
}`;

/**
 * The substance itself. Needs `uGrain`, `uRidge`, `uRidgePow` and `mistNoise`.
 *
 * Isotropic ridged noise in the colony's own XZ, two octaves, the second only
 * where the field is being taken (`fine`; the lens passes 1.0, because a ray
 * that reached the disc is looking at the part of the medium that is being
 * taken by definition). It has NO DIRECTION OF ITS OWN — that is the point, and
 * it is what makes the mist a substance rather than a sea or a set of curtains.
 * The sink and the drift give it one.
 *
 * ⚠️ The max() is not decoration: a negative base is UNDEFINED for GLSL's power
 * function, and the ridge's base cannot be proven non-negative from the source
 * because it comes out of a texture.
 */
export const MIST_MEDIUM_GLSL: string = /* glsl */ `float mistMedium(vec2 q, float fine) {
        vec2 p = q * uGrain;
        float n = mistNoise(p, 0) * 0.63
          + mistNoise(p * 2.07 + vec2(0.31, 0.17), 1) * 0.34 * fine;
        float ridged = 1.0 - abs(2.0 * n - 1.0);
        return mix(n, pow(max(ridged, 0.0), uRidgePow), uRidge);
      }`;

/**
 * Where a parcel of it was, tau seconds ago. Needs `uReach`, `uK`, `uSwirl`,
 * `uDrift`, the varyings `vDrift` and `vShareF`, and works in the SINK'S OWN
 * frame — the offset from the mouth, in the colony's plane.
 *
 * ⭐ THE EXACT BACK-TRACE OF A 2-D POINT SINK WITH A VORTEX, and not a warp
 * toward the mouth. A sink of strength k has d(r*r)/dt = -k, so a parcel now at
 * r was at sqrt(r*r + k*tau); a circulation swirl times the radial flow turns
 * it by swirl * ln(r0 / r) on the way in, which is the definition of a
 * logarithmic spiral. The medium is CARRIED along those streamlines, which is
 * why the filaments bend into the mouth instead of pointing at it.
 *
 * ⚠️ The pull blends back to the identity at the catchment's edge, so the field
 * has no seam where it stops.
 *
 * ⭐⭐ AND THE STRENGTH IS THIS COHORT'S OWN. uK * vShareF is where the share
 * becomes a speed: the biggest producer in view pulls at the full k and the
 * smallest at the floor's fraction of it, on the same curve.
 */
export const MIST_BACKTRACE_GLSL: string = /* glsl */ `vec2 mistBacktrace(vec2 q, float tau) {
        vec2 d = q - vDrift * (uDrift * tau);
        float r2 = dot(d, d);
        float w = 1.0 - r2 / (uReach * uReach);
        if (w <= 0.0) return d;
        w *= w;
        float r = max(sqrt(r2), 0.002);
        float r0 = sqrt(r2 + uK * vShareF * tau);
        float rr = mix(r, r0, w);
        float ang = uSwirl * log(rr / r);
        float cs = cos(ang);
        float sn = sin(ang);
        return vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y) / r * rr;
      }`;

/**
 * The medium's filaments, combed into rings around a mouth: an angular-radial
 * noise in `(theta, ln r)`, ridged so it reads as threads rather than as
 * blobs, gated by a coarser lane mask so the threads come in bundles.
 *
 * ⭐ IT IS THE INNER DISC'S TEXTURE AND NOTHING ELSE DRAWS IT. The retired patch
 * never had it: at 14 wu seen from the app camera the streaks ARE the texture,
 * and a filament finer than them would prefilter to grey. The lensed cohort
 * looks at the same substance from two world units away, where the streaks are
 * a smear and the fibres are what the film's disc is made of — so the snippet
 * lives here, with the substance, and the program that needs it binds it.
 *
 * `rr` is the radius in units of the disc's inner edge, `th` the angle in the
 * colony's frame, `g` the medium's own value there (so a fibre lands where the
 * substance is, not on a lattice of its own) and `t` the clock.
 *
 * ⚠️ THE `max` UNDER THE POWER IS LOAD-BEARING and is this port's one change to
 * the lab's text: `n` carries `+ (g - 0.5) * 0.18`, which can push it outside
 * [0, 1], and `1 - abs(2n - 1)` is then NEGATIVE — undefined, quietly, under
 * `pow`. Needs `uFibreRot`, `uFibreT`, `uFibreR`, `uFibreSharp`, `uLaneLo`,
 * `uLaneHi` and `mistNoise`.
 */
export const MIST_FIBRES_GLSL: string = /* glsl */ `float mistFibres(float rr, float th, float g, float t) {
  float a = (th - t * uFibreRot) / 6.2831853 * uFibreT;
  float lr = log(max(rr, 1.0));
  vec2 p = vec2(a, lr * uFibreR * 0.16 + 0.37);
  float n = mistNoise(p, 0) * 0.68 + mistNoise(p * vec2(1.0, 2.3) + vec2(0.3, 0.1), 1) * 0.32;
  n += (g - 0.5) * 0.18;
  float fib = pow(max(1.0 - abs(2.0 * n - 1.0), 0.0), uFibreSharp);
  float dens = smoothstep(uLaneLo, uLaneHi, mistNoise(vec2(a * 0.5 + 0.2, lr * 0.5 + 0.6), 2));
  return mix(0.12, 1.0, fib * dens);
}`;

/**
 * The three colour stops of the substance seen HOT, as one ramp in the gathered
 * fraction `c`: outer, mid, core. Needs `uColOuter`, `uColMid`, `uColCore`.
 *
 * ⭐ THE STOPS THEMSELVES ARE NOT HERE. This is the ramp's SHAPE — where the
 * mid stop takes over from the outer one and where the core burns through — and
 * it belongs with the substance. Which three colours it interpolates is the
 * lensed disc's own statement, argued in `colonyLens.ts`, because that is the
 * only program that has a temperature to colour.
 */
export const MIST_DISC_COLOR_GLSL: string = /* glsl */ `vec3 mistDiscColor(float c) {
  return mix(mix(uColOuter, uColMid, smoothstep(0.0, 0.45, c)), uColCore, smoothstep(0.55, 1.0, c));
}`;

/**
 * How hard this cohort drinks, as ONE per-instance factor, computed in the
 * vertex stage and left in `vShareF`. Needs `aShare`, `uShareFloor`,
 * `uShareMax`.
 *
 * ⭐⭐ The share is a RATE and the sink's k is a rate, so one factor carries it
 * into both places the rate shows: the speed the streamlines run at and the
 * pile arriving at that speed leaves at the lip. Mirrored exactly by
 * `mistShareFactor`, which is where the arithmetic is argued. The clamp is what
 * makes a stale `uShareMax` a wrong ratio rather than an unbounded sink.
 */
export const MIST_SHARE_FACTOR_GLSL: string = /* glsl */ `vShareF = mix(uShareFloor, 1.0, clamp(aShare / max(uShareMax, 1e-6), 0.0, 1.0));`;

/**
 * The instance's seat in the colony's own frame, and the drift past it. Leaves
 * `seat` and `vDrift` in scope; needs `instanceMatrix` and `uDriftSign`.
 *
 * ⭐ THE DRIFT IS THE COLONY'S OWN TANGENT AT THIS SINK, in the frame the mark
 * is drawn in. The instance's translation is its colony-frame position, so the
 * tangential direction there is (-z, x); the sign says which way the mist
 * streams past a cohort that is itself being carried around. It decides which
 * side of the mouth the wake trails on — and, in the lens, which side of the
 * disc the streaks arrive from.
 *
 * ⚠️ `seat` IS A COLONY-FRAME CONSTANT AND THAT IS WHY IT IS LEFT IN SCOPE. The
 * colony rotates about world Y; a cohort's WORLD position therefore sweeps
 * through several world units a second. Any program that samples the medium at
 * a world point would swim; the lens offsets its sample by this seat instead,
 * which is fixed for the life of the mark.
 */
export const MIST_SEAT_DRIFT_GLSL: string = /* glsl */ `vec3 seat = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec2 tangent = vec2(-seat.z, seat.x);
        float tangentLen = length(tangent);
        vDrift = tangentLen > 1e-4
          ? (tangent / tangentLen) * uDriftSign
          : vec2(1.0, 0.0);`;
