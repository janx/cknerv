// The unresolved population, as a swarm — AROUND the addressable Cells, never
// over them.
//
// The layer was judged live three times as an overlay. Faint: invisible.
// Bright: white fog. An emissive swarm: still overlaid. Every version that was
// visible at all cost the Cells their sharpness, which is structural rather
// than a tuning failure — a layer sharing screen space with the thing it
// contextualizes always taxes it. So the two kinds stopped sharing screen
// space. Radius carries SCOPE: the addressable Cells are the bright central
// bulge, the unresolved population is the larger body around them, and the
// boundary between them IS the render budget made visible. Detailed inside,
// schematic outside — the surveyed-map convention, and no reader takes the
// unsurveyed land to be different land.
//
// Radius is NOT a property of a Cell. Nothing here says the unresolved Cells
// are peripheral on chain. The core is where the budget went; the halo is the
// remainder.
//
// Two passes, and the split is forced by what the two halves are made of.
//
//  1. DENSITY — quarter resolution, offscreen. Marches the baked positional
//     law through the tissue slab and writes one number per texel: what
//     FRACTION of this pixel's screen cell the unresolved population lights
//     up. That term is low-frequency by construction — it is a warped
//     multi-octave field over an ellipse 2.2 times the resolved rim, with no
//     detail below several world units — so quarter resolution is lossless for
//     it and a quarter of the marching cost. The march also subtracts the
//     already-individuated share, which is what makes the middle exactly zero.
//
//  2. COMPOSITE — full resolution. Turns that fraction into the thing itself:
//     a stochastic population of screen-space specks, two DEVICE pixels wide,
//     of which exactly that fraction are lit.
//
// The swarm is not a texture applied to a medium. The swarm IS the medium.
// That distinction is the whole feature, and getting it wrong once already
// cost a ship: a continuous term, however exact its density, reads as FOG,
// and fog is one substance whose only variable is how much of it there is. A
// population is not a quantity of stuff — it is a count of things too small
// to separate. So the field sets HOW MANY SPECKS ARE LIT, never how bright a
// wash is.
//
// Three consequences, and they are why this shape is right:
//
//  - It cannot be read as atmosphere. Discrete lit points on black are never
//    fog, at any brightness.
//  - The resolution argument becomes literal. Specks are sized in DEVICE
//    pixels, so flying closer spreads the field without ever making a speck
//    larger or countable. The limit is the instrument, not the distance.
//  - Figure/ground needs no tonal trick. Cells are large, peaked and
//    near-white at the core; specks are two pixels and dim. Same light,
//    different resolution — which is exactly the claim.
//
// Everything here EMITS and nothing covers. Alpha-over was the original bug:
// it lifts true black across the whole envelope, which is the optical
// signature of atmosphere BETWEEN the viewer and the subject, and that single
// choice was enough to drape the galaxy in white fog. Every term below is
// positive, and a pixel with no population under it is discarded before it
// can contribute anything at all.

import * as THREE from 'three';

import { CELL_GALAXY_PALETTE } from '../visualPalette';
import {
  TISSUE_BAKE_FOLD_Y_RANGE,
  TISSUE_BAKE_THICKNESS_MAX,
  TISSUE_BAKE_THICKNESS_MIN,
} from '../geometry/tissueFieldBake';

/**
 * The resolved share at and above which the halo is fully suppressed —
 * rule 9a's upper threshold.
 *
 * The march accumulates two optical depths through one set of samples: `tau`
 * for the whole body and `tauResolved` for the part already drawn as
 * addressable Cells. The halo then states the difference as a fraction of the
 * population rather than of the light: `share = tauResolved / tau`, and
 * `tau * (1 - smoothstep(LOW, HIGH, share))`. At and above this threshold that
 * is exactly zero — not low, and zero BEFORE the exponential, so no gain, no
 * swarm density, and no future brightness knob can put a photon back over the
 * Cells. That is the whole reason the layer moved outside the rim, and it has
 * to be arithmetic rather than restraint.
 *
 * **This threshold is the old linear knee, and it is derived the same way.**
 * A constant knee could not do the other half of the job: `tauResolved / 0.12`
 * amplifies the resolved share 8.3x, so the halo only switched on once
 * resolved density had fallen essentially to zero — past the last Cell — while
 * the Cells had been thinning since ~0.7 of the rim. That left a band where
 * NEITHER population was drawn, which is what read as a hard boundary.
 * Splitting the one constant in two lets the protection and the crossfade be
 * placed independently: this one says where the halo may begin, and
 * {@link POPULATION_FIELD_SHARE_LOW} says where it reaches full strength.
 *
 * Derived, not copied. Against 12,000 real `helixSeedF64` positions projected
 * from the production camera, with the share measured per quarter-resolution
 * texel and the halo's own emission modelled from
 * {@link populationSwarmEmission}:
 *
 * | HIGH | Cells in the zero region | max lit fraction inside r <= 0.70 |
 * |-----:|-------------------------:|----------------------------------:|
 * | 0.12 (the old knee) |         96.8 % |                           0.000 |
 * | 0.26 |                   91.8 % |                             0.000 |
 * | **0.28** |               **91.1 %** |                     **0.000** |
 * | 0.30 |                   90.4 % |                             0.020 |
 * | 0.34 |                   88.5 % |                             0.109 |
 * | 0.38 |                   87.0 % |                             0.198 |
 *
 * 0.28 is the largest value at which the halo is still exactly zero everywhere
 * inside `r <= 0.70` of the resolved ellipse — the Cell body's dense bulge,
 * **including its own cavities**. That last clause is the whole measurement:
 * the tissue is full of voids, and a ray that crosses one carries almost no
 * resolved depth, so past this threshold the halo starts lighting up the holes
 * INSIDE the core. A texel-density statistic cannot see that — the densest
 * still-lit patch sits at 7 of 16 Cells per texel anywhere from 0.28 to 0.38 —
 * and light in the core's cavities is precisely the "any layer sharing screen
 * space with the addressable Cells" failure that three overlays already died
 * of.
 *
 * Nothing is given up for that margin: the seam metric of §6.1 test 5 (the
 * deepest trough of total luminance on a walk outward, against the shallower
 * of the two shoulders) is 0.743 here and 0.744 at 0.30 — it has already
 * reached its plateau. The shipped linear knee scores 0.607.
 *
 * **What is protected is the DENSE core, not every Cell.** The exactly-zero
 * region is deliberately smaller than it was: 5.7 % of Cells leave it, all of
 * them in the thinning rim, and the interleaving that produces is the only way
 * the two regions can meet at all.
 */
export const POPULATION_FIELD_SHARE_HIGH = 0.28;

/**
 * The resolved share at and below which the halo runs at full strength —
 * rule 9a's lower threshold, and the far end of the crossfade.
 *
 * The measured share is not a local property of the fold plane: an elevated
 * camera's ray keeps picking up resolved tissue well past its own footprint,
 * so the share is still 0.11 at 1.06 of the ellipse and 0.026 at 1.14. This
 * threshold therefore lands the crossfade's outer end at about 1.09 of the
 * rim, making it 0.19 of the ellipse wide — comparable to the 0.25 over which
 * the Cells themselves visibly thin, which is the point: the two ramps have to
 * overlap or there is a band with nothing in it.
 *
 * It is a weak lever and was measured as one. Across 0.00 to 0.16 the seam
 * metric moves from 0.733 to 0.743 — inside the noise — because everything it
 * governs happens where the Cells are already gone. What it does change is how
 * many Cells sit on a fully-lit halo: 3.3 % at 0.00, 4.6 % at 0.08, 5.9 % at
 * 0.16. Low enough to keep that small, high enough that the halo actually
 * reaches full strength inside its own envelope rather than approaching it
 * asymptotically.
 */
export const POPULATION_FIELD_SHARE_LOW = 0.08;

/**
 * How much coarser the swarm's grain is at the inner edge of the crossfade,
 * as a fraction of its normal screen scale — §5.2.
 *
 * Density alone cannot close the seam, because the discontinuity the eye sees
 * there is one of KIND, not of amount: on one side large bright Cell sprites,
 * on the other two-pixel dots, with the switch happening over a few pixels.
 * Ramping the speck scale with the suppression puts the coarsest grain exactly
 * where the halo meets the thinning Cells — just barely unresolvable, which is
 * the honest state for matter at the edge of what the instrument can separate —
 * and refines it outward, so apparent grain size varies continuously across
 * the boundary instead of switching.
 *
 * The population statement survives it. `amount` is the fraction of screen
 * CELLS that are lit, so scaling the cell up scales the lit AREA by exactly
 * the same factor as the unlit area: bigger specks, proportionally fewer of
 * them, same fraction of the screen lit and therefore the same count stated.
 */
export const POPULATION_FIELD_SEAM_COARSENING = 0.55;

/** The share of the population under a ray that is already individuated, and
 *  the suppression it earns. The shader evaluates exactly this curve through
 *  GLSL's own `smoothstep`, which is the same cubic.
 *
 *  Driving it from the RATIO rather than from an absolute coverage is what
 *  makes it stable: both depths ride the same dithered samples, so the dither
 *  noise cancels in the quotient. */
export function populationResolvedSuppression(share: number): number {
  const t = Math.max(0, Math.min(
    1,
    (share - POPULATION_FIELD_SHARE_LOW)
      / (POPULATION_FIELD_SHARE_HIGH - POPULATION_FIELD_SHARE_LOW),
  ));
  return t * t * (3 - 2 * t);
}

/**
 * Unresolved optical depth: the population under a ray, minus the part of it
 * already drawn. The shader evaluates exactly this expression.
 *
 * The subtraction is on OPTICAL DEPTH and not on emission, and the difference
 * is visible. `1 - exp(-tau)` is concave, so scaling the light after
 * saturation makes the halo creep up slowly from the boundary and leaves a
 * dark seam between the Cells and the population around them; subtracting the
 * population first lets the halo reach the body it belongs to. It is also the
 * honest form: what the resolved Cells remove from the halo is not brightness,
 * it is the Cells themselves.
 *
 * Above {@link POPULATION_FIELD_SHARE_HIGH} the suppression is exactly 1 and
 * this is exactly zero, at any optical depth. Below
 * {@link POPULATION_FIELD_SHARE_LOW} it is exactly `tau`. In between it is a
 * crossfade, and that band is the only place the two populations can meet.
 *
 * @param tau         optical depth of the whole body along the ray
 * @param tauResolved optical depth of the individuated share of it
 */
export function populationUnresolvedDepth(
  tau: number,
  tauResolved: number,
): number {
  // The guard is for an empty ray, where both depths are zero together and the
  // quotient would be 0/0. It is far below any depth that survives the
  // composite's own floor, so it can never distort a share that matters:
  // a `tau` under 1e-9 produces a lit fraction under 1e-9 as well.
  const share = tauResolved / Math.max(tau, 1e-9);
  return tau * (1 - populationResolvedSuppression(share));
}

/**
 * Half-height of the marched slab.
 *
 * The volume is `density(x, z) * exp(-½((y - foldY) / thickness)²)`, so it has
 * no hard top: it is bounded by where the Gaussian stops mattering. `foldY`
 * cannot leave ±6.3 and `thickness` cannot exceed 7.3, so three sigma above
 * the highest fold is 6.3 + 3 × 7.3 ≈ 28. Past that the medium is contributing
 * less than a thousandth of its peak and the march is spending steps on
 * nothing.
 *
 * **This did not grow with the halo, and that is deliberate.** The fold and
 * the thickness are the same noise at the same `(x, z)` — only the boundary
 * moved — so the analytic bound above is unchanged in absolute terms. Which
 * means the halo is the same thickness as the core over a footprint 2.2 times
 * wider, and therefore relatively FLATTER by exactly that factor: a bulge with
 * a disk around it, straight out of the geometry, with no second vertical law
 * invented for the outer region. Giving the halo a profile of its own would be
 * asserting a population geography that the law does not contain.
 *
 * It is also what keeps the march honest. The marched span is
 * `min` over the three axes, and from any elevated camera the y band is what
 * binds it — the production camera's central ray crosses 140 units of slab
 * whether the footprint is the core's or the halo's. Measured against a
 * 256-step reference, the eight-step march's relative error in the dense band
 * is 13.5 % over the core domain and 13.2 % over the halo domain: widening the
 * footprint costs the integration nothing.
 */
export const POPULATION_FIELD_SLAB_HALF_Y = 28;

/**
 * How densely the swarm populates the screen, per unit of integrated density,
 * before `gain`.
 *
 * The math is unchanged and still Beer-Lambert: optical depth is
 * `gain * SWARM_DENSITY * ∫ρ dl`, and `1 - exp(-τ)` saturates it into [0, 1).
 * What changed is what that number MEANS. It used to be an alpha — how opaque
 * a wash is — and the name `EXTINCTION` said so, which is why it is gone:
 * nothing here extinguishes anything. It is now the LIT FRACTION: out of every
 * hundred screen cells under this ray, how many the unresolved population
 * lights up. Same curve, and the value below survives the reinterpretation
 * unchanged, because both readings are answering "how much of the swarm is
 * lit".
 *
 * The acceptance test this is calibrated against (§6.1 test 4): **the core
 * must read as the bulge of one body, not as a galaxy with a fringe.** The
 * halo has to surround and continue the Cells, sharing their corridors and
 * cavities; a layer too faint to do that contributes nothing at all, however
 * exact its density term.
 *
 * The first calibration failed it. At 0.21 and the measured mainnet gain of
 * 0.58, ordinary mid-field tissue (areal density ≈ 0.23) reached a lit
 * fraction of 0.16 and the layer averaged 0.12 — one speck in eight, which
 * beside a bright Cell field is indistinguishable from absence.
 *
 * At 0.84 the same mid-field lights about half its cells and the densest
 * tissue about nine in ten, so the population around the Cells is a crowd
 * rather than a void, and the cavities and corridors the field has always
 * contained become legible as gaps in that crowd. Re-derived against the swarm
 * and kept: this is also the value the accepted reference render was made at.
 *
 * Raising it can no longer cost the Cells anything — the density term is
 * exactly zero over them before this number is ever applied — so this is a
 * free live-tuning lever in a way it was not while the layer was an overlay.
 *
 * This is the live-tuning lever for the population's presence. Nothing else
 * here should be reached for first — `gain` is calibration and the density
 * term is the chain's own law, but this number is taste.
 */
export const POPULATION_FIELD_SWARM_DENSITY = 0.84;

/**
 * Speck size, in DEVICE pixels. Sized on the display and never in the world:
 * that is what makes flying closer spread the population out without ever
 * resolving one of its members.
 *
 * §5 allows 1.5–2.5; two is the only INTEGER in that window and the reason
 * matters. `floor(gl_FragCoord.xy / size)` at a fractional size produces
 * screen cells that alternate between one and two pixels wide on a beat — at
 * 1.7 the pattern repeats every ten cells, and that beat is a low-frequency
 * structure laid over a layer whose entire job is to have none. At two, every
 * cell is exactly 2×2 device pixels and the grid is silent.
 */
export const POPULATION_FIELD_SPECK_PX = 2;

/**
 * The swarm reseeds this many times per second, per speck.
 *
 * A screen-locked mask that never moves is a screen door: the galaxy rotates
 * behind a fixed pattern and the pattern wins. Reseeding turns it into
 * scintillation, which is also the honest reading — a photon-limited
 * instrument cannot hold any individual still.
 *
 * The failure mode on the other side is TV static, and static has a specific
 * cause: the WHOLE FIELD re-rolling in lockstep, so the eye sees a frame
 * boundary instead of a population. That is why each screen cell carries its
 * own phase offset (see `uSwarmPhase` in the composite) — every speck reseeds
 * at this rate, but no two reseed at the same instant, so there is no global
 * event to perceive. Rate, speck size, and the continuum fraction are the
 * three live-tuning levers.
 */
export const POPULATION_FIELD_SPECK_RESEED_HZ = 11;

/**
 * The faint continuum under the swarm, as a fraction of full emission.
 *
 * Without it the densest tissue reads as dots rather than as solid matter: at
 * a lit fraction of 0.9 the eye still finds the one unlit cell in ten and
 * counts holes. A fifth of the emission spread evenly closes those holes
 * while leaving the speck population carrying the signal.
 *
 * It is a floor, never a wash — it is scaled by the same lit fraction, so
 * where there is no population there is no continuum either.
 */
export const POPULATION_FIELD_CONTINUUM_FRACTION = 0.22;

/** Emission of one lit speck, before its brightness spread. */
export const POPULATION_FIELD_SPECK_GAIN = 0.9;

/**
 * Dimmest a lit speck may be, as a fraction of the brightest.
 *
 * The spread exists so the swarm does not read as a halftone screen of
 * identical dots. It is one-sided on purpose: unresolved light never
 * subtracts, and a speck that dipped below the continuum would paint a dark
 * point — dirt, not scintillation.
 */
export const POPULATION_FIELD_SPECK_FLOOR = 0.55;

/**
 * Overall emission scale, applied to the body tint.
 *
 * This is the bound in §11: peak speck brightness must stay below a single
 * resolved Cell's core, so no patch of swarm can be mistaken for a Cell and
 * the discrete bodies sit in front tonally without any veil pushing them
 * there. A far Cell's core is `warmWhite` mixed 0.72 into its body colour at
 * unit peak — near-white, luminance ≈ 0.95. The brightest possible speck here
 * is a fully lit cell at a lit fraction of 0.92, which is body rose at
 * luminance ≈ 0.43. Less than half, and a saturated hue against a near-white
 * one: the two cannot be confused even where they touch.
 */
export const POPULATION_FIELD_EMISSION_PEAK = 0.85;

/** Concurrent membership blooms. Ring-allocated by the caller; the shader
 *  loop breaks at the live count, so the ceiling costs nothing until it is
 *  actually reached. */
export const POPULATION_FIELD_MAX_BLOOMS = 64;

/**
 * A dissolve is not a death.
 *
 * Death owns its event signature — its own colour and `DEATH_DURATION_MS` of
 * 600. A Cell leaving the stage is ALIVE on chain, so its mark has to be
 * slower and quieter, or the eye's death count stops matching the HUD's and
 * this layer has to be cut.
 */
export const POPULATION_FIELD_BLOOM_MS = 1400;

/**
 * Emission of one screen cell of the swarm — the composite's whole colour
 * math, as a scalar.
 *
 * The GLSL below is driven by the same constants through uniforms, so this is
 * the shape the shader evaluates rather than a paraphrase of it. Two
 * properties are worth stating as code because they are the two that were got
 * wrong before:
 *
 *  - **Zero in, zero out.** No population under a pixel means no light from
 *    it, at any speck brightness, so empty space keeps its true black.
 *  - **Positive only.** Nothing here can subtract. A grain that dipped below
 *    its base level painted dark speckles, and dirt is not a population.
 *
 * @param litFraction share of screen cells the population lights, in [0, 1]
 * @param pick        the cell's mask draw, in [0, 1)
 * @param spread      the cell's brightness draw, in [0, 1)
 */
export function populationSwarmEmission(
  litFraction: number,
  pick: number,
  spread: number,
): number {
  const lit = Math.min(Math.max(litFraction, 0), 1);
  const continuum = lit * POPULATION_FIELD_CONTINUUM_FRACTION;
  // The mask threshold IS the population statement: a cell is lit exactly when
  // its uniform draw falls under the local fraction, so the COUNT of lit
  // specks per unit screen area carries the number. Speck brightness carries
  // nothing, which is why the spread below is narrow and centred.
  if (pick >= lit) return continuum;
  const brightness = POPULATION_FIELD_SPECK_FLOOR
    + (1 - POPULATION_FIELD_SPECK_FLOOR) * spread;
  // The second `lit` is not a second population claim, it is the rim: at the
  // envelope's edge the fraction is a few percent, and specks that stayed at
  // full brightness there would be a scatter of isolated bright points — the
  // one thing a user could actually count, which rule 10 forbids. Fading them
  // as they thin out lets the population end instead of fraying into stars.
  return continuum + brightness * lit * POPULATION_FIELD_SPECK_GAIN;
}

/**
 * The swarm's colour: the organism's own body light, at full saturation.
 *
 * Two rules meet here and they point opposite ways. The field carries NO
 * IDENTITY hue — asset, lock and tag palettes are forbidden, because a hue
 * that means something elsewhere would make an aggregate look like a claim
 * about which Cells it contains. But it MUST carry the BODY hue, because the
 * resolved and the unresolved are the same kind of thing separated by
 * resolution alone, and unresolved starlight is the same light as its stars.
 *
 * The previous version resolved that tension by desaturating a quarter of the
 * way toward grey, and grey over a coloured scene is atmospheric perspective —
 * the eye has exactly one word for it, and the word is fog. Full saturation,
 * no level trim, straight from the Cells' own palette.
 */
function swarmTint(): THREE.Color {
  return new THREE.Color().setRGB(...CELL_GALAXY_PALETTE.tissueRose);
}

/** Helpers both fragment programs are compiled with. The composite needs only
 *  the hash; the density pass needs both. They share one text so the hash the
 *  march dithers with and the hash the swarm is drawn from cannot drift into
 *  two different noises. */
const SLAB_GLSL = /* glsl */ `
  // Analytic slab entry/exit. The direction is guarded away from exact zero
  // because GLSL does not promise IEEE infinities through min/max.
  bool slabRange(vec3 ro, vec3 rd, vec3 half3, out float tEnter, out float tExit) {
    // GLSL sign() returns 0 for an exactly axis-aligned component, which
    // would put a zero straight back into the divisor this guard exists to
    // remove — and an edge-on camera really can produce one. step() maps to
    // +1/-1 and never to zero.
    vec3 unit = step(vec3(0.0), rd) * 2.0 - 1.0;
    vec3 safeRd = unit * max(abs(rd), vec3(1e-6));
    vec3 inv = 1.0 / safeRd;
    vec3 a = (-half3 - ro) * inv;
    vec3 b = ( half3 - ro) * inv;
    vec3 lo = min(a, b);
    vec3 hi = max(a, b);
    tEnter = max(max(lo.x, lo.y), lo.z);
    tExit  = min(min(hi.x, hi.y), hi.z);
    // A camera inside the slab starts at the camera, not behind it.
    tEnter = max(tEnter, 0.0);
    return tExit > tEnter;
  }

  // Deterministic per-pixel hash. Two jobs. In the march it dithers the
  // starting offset, because eight steps through a smooth field band visibly
  // and dithering trades those bands for noise. In the composite it IS the
  // population: the swarm's mask is a threshold on this, so its uniformity is
  // load-bearing — a biased hash would make the lit fraction disagree with the
  // count the field is stating. Measured against the real bake it tracks the
  // field to within 0.2% at every level.
  float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
`;

export interface PopulationDensityUniforms {
  uField: { value: THREE.Texture | null };
  uHalf: { value: THREE.Vector3 };
  uLocalCamera: { value: THREE.Vector3 };
  uSteps: { value: number };
  uOpticalDepth: { value: number };
  uShareLow: { value: number };
  uShareHigh: { value: number };
  uFoldRange: { value: number };
  uThicknessMin: { value: number };
  uThicknessSpan: { value: number };
}

/**
 * Pass 1. Renders the slab's bounding box (never a fullscreen quad — the
 * medium occupies a bounded volume and paying for the rest of the screen
 * would be paying for nothing) and writes the lit fraction to R.
 *
 * The slab is the HALO's volume now, so this pass covers a footprint 2.2 times
 * the resolved rim — and writes exactly zero across the middle of it, where
 * the addressable Cells are. The two regions tile the space; they never stack.
 */
export function makePopulationDensityMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uField: { value: null },
      uHalf: { value: new THREE.Vector3(1, 1, 1) },
      uLocalCamera: { value: new THREE.Vector3() },
      uSteps: { value: 8 },
      uOpticalDepth: { value: 0 },
      uShareLow: { value: POPULATION_FIELD_SHARE_LOW },
      uShareHigh: { value: POPULATION_FIELD_SHARE_HIGH },
      uFoldRange: { value: TISSUE_BAKE_FOLD_Y_RANGE },
      uThicknessMin: { value: TISSUE_BAKE_THICKNESS_MIN },
      uThicknessSpan: {
        value: TISSUE_BAKE_THICKNESS_MAX - TISSUE_BAKE_THICKNESS_MIN,
      },
    } satisfies PopulationDensityUniforms,
    // Back faces: the exit surface is visible whether the camera is outside
    // the slab or inside it, so one draw covers the close fly-in too.
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    transparent: false,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uField;
      uniform vec3  uHalf;
      uniform vec3  uLocalCamera;
      uniform float uSteps;
      uniform float uOpticalDepth;
      uniform float uShareLow;
      uniform float uShareHigh;
      uniform float uFoldRange;
      uniform float uThicknessMin;
      uniform float uThicknessSpan;

      varying vec3 vLocal;

      ${SLAB_GLSL}

      void main() {
        vec3 ro = uLocalCamera;
        vec3 rd = normalize(vLocal - ro);
        float tEnter, tExit;
        if (!slabRange(ro, rd, uHalf, tEnter, tExit)) discard;

        float steps = max(uSteps, 1.0);
        float span = tExit - tEnter;
        float stepLen = span / steps;
        // Dithered start: the band pattern of a fixed offset would be a
        // structure, and this layer must never show one.
        float offset = hash21(gl_FragCoord.xy) * stepLen;

        float tau = 0.0;
        float tauResolved = 0.0;
        for (int i = 0; i < 16; i++) {
          if (float(i) >= steps) break;
          float t = tEnter + offset + float(i) * stepLen;
          vec3 p = ro + rd * t;
          // One fetch carries the whole law: the body's density, its fold
          // centre, its thickness, and the share of it already individuated.
          vec2 uv = p.xz / (2.0 * uHalf.xz) + 0.5;
          vec4 law = texture2D(uField, uv);
          float density = law.r;
          float resolved = law.a;
          float foldY = law.g * (2.0 * uFoldRange) - uFoldRange;
          float thickness = law.b * uThicknessSpan + uThicknessMin;
          float safeThickness = max(thickness, 1e-3);
          float dy = (p.y - foldY) / safeThickness;
          // The 1 / thickness is the Gaussian's NORMALIZATION, and dropping it
          // is not a scale error that a constant absorbs: it makes a column's
          // integrated density proportional to how thick the tissue is there.
          // helixSeedF64 draws y ~ N(foldY, thickness), so a column has to
          // integrate back to the areal density it was sampled from, whatever
          // the local thickness. Thickness spans 2.1 to 7.3 and is driven by
          // the same ridge term as the density, so without this the medium
          // overstates its densest regions by up to 3.5x — and the shape it
          // showed would no longer be the law the Cells are placed by.
          float weight = exp(-0.5 * dy * dy) / safeThickness * stepLen;
          tau += density * weight;
          // The SAME sample, the same weight. Two marches would disagree
          // wherever the dither put their steps in different places, and the
          // disagreement would show up as noise exactly along the boundary
          // this quantity exists to draw.
          tauResolved += resolved * weight;
        }

        // Rule 9a, as arithmetic. The halo states the population MINUS the
        // part of it already on screen as addressable Cells: a subtraction of
        // optical depths, done before the exponential, so a pixel whose
        // population is more than uShareHigh individuated ends at exactly zero
        // and no gain, swarm density, or later brightness knob can put a photon
        // back over the Cells. Three overlays failed by taxing the Cells'
        // sharpness; this is the guarantee that replaces them.
        //
        // Subtracting depth rather than emission is also what closes the seam.
        // 1 - exp(-tau) is concave, so scaling the LIGHT after saturation lets
        // the halo creep up slowly and leaves a dark ring around the body it
        // is supposed to continue.
        //
        // Two thresholds rather than one knee. A constant knee amplifies the
        // resolved share, so it can only ever switch the halo on PAST the last
        // Cell, while the Cells have been thinning since 0.7 of the rim — the
        // band between the two is where neither population is drawn, and that
        // band is the boundary a viewer sees. The crossfade has to land inside
        // the thinning band, which takes a start and an end.
        //
        // The share is the RATIO, so the dither noise both depths ride cancels
        // in the quotient. The guard is for an empty ray, where they are zero
        // together; the resolved term is the same body under a tighter
        // envelope, so it can never exceed the density term.
        float share = tauResolved / max(tau, 1e-9);
        float supp = smoothstep(uShareLow, uShareHigh, share);
        float unresolved = tau * (1.0 - supp);

        // The population reaches the screen through the same law it
        // accumulates by. This number is not an opacity — the composite reads
        // it as the FRACTION of screen cells the unresolved population lights
        // up, and nothing downstream ever treats it as an alpha.
        float litFraction = 1.0 - exp(-unresolved * uOpticalDepth);
        // G carries the suppression itself, because the composite needs to
        // know not just how much population is here but how close it is to the
        // Cells: the swarm's grain is coarsest where the two meet (§5.2), and
        // that ramp cannot be recovered from the lit fraction alone — faint
        // tissue at the far edge and suppressed tissue at the seam produce the
        // same number in R and want opposite grain.
        gl_FragColor = vec4(litFraction, supp, 0.0, 1.0);
      }
    `,
  });
}

export interface PopulationCompositeUniforms {
  uDensity: { value: THREE.Texture | null };
  uResolution: { value: THREE.Vector2 };
  uTint: { value: THREE.Color };
  uSpeckPx: { value: number };
  uCoarsening: { value: number };
  uContinuum: { value: number };
  uSpeckGain: { value: number };
  uSpeckFloor: { value: number };
  uPeak: { value: number };
  uSwarmPhase: { value: number };
  uBloomCount: { value: number };
  /** xy = NDC centre, z = life in [0, 1], w = radius in device pixels. */
  uBlooms: { value: THREE.Vector4[] };
}

/**
 * Pass 2. Turns the lit fraction into the swarm.
 *
 * This is where the layer either states a population or drapes a veil, and
 * the difference is entirely in the blend. It accumulates — `src` at full
 * weight, `dst` scaled by what is left of the channel — so it can only ever
 * ADD light to what is behind it, and a zero contribution leaves the
 * destination byte-identical. Alpha-over could not make that promise: it
 * multiplies the destination by `1 - a`, which means the layer DARKENS
 * whatever it covers and lifts true black toward its own tint everywhere its
 * envelope reaches. That reads as atmosphere between the viewer and the
 * subject, and it is what destroyed the scene the first time.
 *
 * Bounded screen rather than plain additive, matching `cellHybridMaterial`:
 * nine cells in ten are lit at the galaxy's core, and piling that additively
 * onto the chain mesh underneath would blow both out. Over the scene's
 * near-black the two are within 2/255 of each other; over anything bright the
 * bounded form is the one that survives.
 *
 * The blooms live here rather than in the density march for the same reason
 * the swarm does: they are a screen-scale mark, and a quarter-resolution one
 * would be a visible square.
 */
export function makePopulationCompositeMaterial(): THREE.ShaderMaterial {
  const blooms: THREE.Vector4[] = [];
  for (let i = 0; i < POPULATION_FIELD_MAX_BLOOMS; i += 1) {
    blooms.push(new THREE.Vector4(0, 0, 0, 0));
  }
  return new THREE.ShaderMaterial({
    uniforms: {
      uDensity: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTint: { value: swarmTint() },
      uSpeckPx: { value: POPULATION_FIELD_SPECK_PX },
      uCoarsening: { value: POPULATION_FIELD_SEAM_COARSENING },
      uContinuum: { value: POPULATION_FIELD_CONTINUUM_FRACTION },
      uSpeckGain: { value: POPULATION_FIELD_SPECK_GAIN },
      uSpeckFloor: { value: POPULATION_FIELD_SPECK_FLOOR },
      uPeak: { value: POPULATION_FIELD_EMISSION_PEAK },
      uSwarmPhase: { value: 0 },
      uBloomCount: { value: 0 },
      uBlooms: { value: blooms },
    } satisfies PopulationCompositeUniforms,
    side: THREE.BackSide,
    // The chain mesh sits under the Cell plane and has to stay visible
    // THROUGH the swarm. Emission is what keeps it there: the layer adds its
    // own light and removes none of the mesh's, so depth-testing a back face
    // against it would only erase the swarm wherever something opaque
    // happened to be behind it.
    depthTest: false,
    depthWrite: false,
    transparent: true,
    // Bounded screen accumulation: `src * 1 + dst * (1 - src)`, per channel.
    // Zero src leaves dst exactly as it was — that is rule 12 made structural
    // rather than a matter of restraint — and no src can ever reduce a
    // channel, so this layer cannot darken anything.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcColorFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    // No tone mapping and NO colour-space encode, exactly like
    // `cellHybridMaterial` — the Cell bodies write their palette values
    // straight to the framebuffer, so encoding here would put the swarm on a
    // second gamma curve and lift the body rose from rgb(255,102,112) to
    // rgb(255,170,177): a pale pink instead of the Cells' own colour. "The
    // same light" is a pixel-level claim, and this is where it is kept.
    toneMapped: false,
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uDensity;
      uniform vec2  uResolution;
      uniform vec3  uTint;
      uniform float uSpeckPx;
      uniform float uCoarsening;
      uniform float uContinuum;
      uniform float uSpeckGain;
      uniform float uSpeckFloor;
      uniform float uPeak;
      uniform float uSwarmPhase;
      uniform int   uBloomCount;
      uniform vec4  uBlooms[${POPULATION_FIELD_MAX_BLOOMS}];

      ${SLAB_GLSL}

      void main() {
        vec2 screenUv = gl_FragCoord.xy / uResolution;
        // R is how much unresolved population is under this pixel; G is how
        // much of the population under it the Cells have already taken. The
        // first sets how many specks are lit, the second how coarse they are.
        vec2 density = texture2D(uDensity, screenUv).rg;
        float field = density.r;
        float suppression = density.g;

        // Nothing unresolved under this pixel, so nothing to say about it.
        // This sits BEFORE the blooms deliberately: the bloom term has a
        // floor that keeps it legible in faint tissue, and without this gate
        // that floor would let a transition mark paint light where the
        // population is zero — a bloom in vacuum, which is an object, not a
        // dissolve. Empty space keeps its true black on this line.
        if (field <= 0.0015) discard;

        // The blooms mark where a Cell condensed out of, or dissolved into,
        // the population. They raise the LOCAL LIT FRACTION rather than
        // adding a glow of their own: a transition is a crowd thickening
        // where a Cell arrived or left, which keeps it inside the swarm's
        // language instead of laying a second substance over it.
        //
        // ⚠️ Moving the medium outside the resolved rim took most of these
        // with it. A bloom is gated on the medium existing under the pixel,
        // and the medium is now exactly zero wherever staged Cells are dense —
        // which is where stage entries and exits happen. Only transitions out
        // at the rim still have anything to bloom into. The §8 boundary is
        // therefore unfinished under the new arrangement, not merely quieter,
        // and it needs a decision of its own: either the transition mark stops
        // being made OF the medium, or the two kinds get a shared band to meet
        // in. Left exactly as it was rather than silently redesigned here.
        float bloom = 0.0;
        for (int i = 0; i < ${POPULATION_FIELD_MAX_BLOOMS}; i++) {
          if (i >= uBloomCount) break;
          vec4 b = uBlooms[i];
          vec2 centre = (b.xy * 0.5 + 0.5) * uResolution;
          float radius = max(b.w, 1.0);
          float d = length(gl_FragCoord.xy - centre) / radius;
          // Rise fast, leave slowly: an entry has to be READ as an arrival
          // without ever gaining the snap of a death.
          float life = clamp(b.z, 0.0, 1.0);
          float envelope = sin(life * 3.14159265) * (1.0 - life * 0.35);
          bloom += exp(-d * d * 3.0) * envelope;
        }
        bloom = min(bloom, 1.5);

        float amount = clamp(field + bloom * 0.35 * max(field, 0.12), 0.0, 1.0);

        // The swarm. Screen cells of uSpeckPx DEVICE pixels, of which exactly
        // "amount" of them are lit — the field sets HOW MANY specks are lit,
        // never how bright a wash is. The cell index comes from gl_FragCoord,
        // so the scale is fixed to the display and no camera move resolves it.
        // §5.2, the resolution gradient. Coarsest where the halo meets the
        // thinning Cells — its grain just barely unresolvable, which is the
        // honest state for matter at the edge of what the instrument can
        // separate — and refining outward. Apparent grain size then varies
        // continuously across the boundary instead of switching from large
        // sprites to two-pixel dots, and the switch of KIND is what the eye
        // was reading as an edge. The count is unaffected: the lit fraction
        // is a fraction of screen CELLS, so a larger cell lights a
        // proportionally larger area and states the same population.
        float coarse = 1.0 + uCoarsening * clamp(suppression, 0.0, 1.0);
        vec2 cell = floor(gl_FragCoord.xy / max(uSpeckPx * coarse, 1.0));

        // Per-cell phase. Every speck reseeds at the same RATE, but this
        // offset spreads the instants uniformly across the period, so the
        // field never re-rolls as a whole. That lockstep re-roll is what makes
        // noise read as TV static; without it the same rate reads as
        // scintillation, which is the honest signature of a photon-limited
        // instrument. Reduced motion pins uSwarmPhase to zero and the whole
        // pattern freezes, deterministically, with the lit fraction — and so
        // every count — exactly where it was.
        float jitter = hash21(cell * 1.37 + 11.7);
        float epoch = floor(uSwarmPhase + jitter);
        float pick = hash21(cell + epoch * 17.13);
        float spread = hash21(cell * 0.7 + epoch * 5.71 + 3.3);

        // step(pick, amount) is 1 exactly when the cell's draw falls under the
        // local fraction. Every term from here is positive: unresolved light
        // never subtracts, and a speck dipping below the continuum would paint
        // a dark point — dirt, not scintillation.
        float lit = step(pick, amount)
          * (uSpeckFloor + (1.0 - uSpeckFloor) * spread);
        float emission = amount * uContinuum + lit * amount * uSpeckGain;

        gl_FragColor = vec4(uTint * emission * uPeak, emission * uPeak);
      }
    `,
  });
}
