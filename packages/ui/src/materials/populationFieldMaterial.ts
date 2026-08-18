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
  POPULATION_FIBRE_MIX_A,
  POPULATION_FIBRE_MIX_B,
  TISSUE_BAKE_FOLD_Y_RANGE,
  TISSUE_BAKE_THICKNESS_MAX,
  TISSUE_BAKE_THICKNESS_MIN,
} from '../geometry/tissueFieldBake';

/**
 * The resolved coverage AT THE FOLD PLANE at and above which the halo is
 * fully suppressed — rule 9a's upper threshold.
 *
 * ## What this replaced, and why the boundary was an ellipse
 *
 * The suppression used to read the *share* of the population under a ray that
 * was already individuated: `tauResolved / tau`, both accumulated through the
 * same march. That quantity can never carry structure, and the reason is
 * algebra rather than tuning. `resolved` and `density` are the SAME `body`
 * term under two envelopes, so their quotient is
 * `envelope(1.04) / envelope(2.2)` and the body — every corridor, every
 * cavity, every ridge — cancels exactly. What is left is
 * `smoothstep(0.61, 1.04, radial + boundaryWarp)` over
 * `smoothstep(0.61, 2.2, ...)`: a function of the warped radius and nothing
 * else, with only ±0.185 of warp across a 0.43-wide band. Every threshold on
 * it draws an ellipse, which is exactly what the addressable region looked
 * like — a regular oval moat between the Cells and the population around them.
 *
 * The fold-plane sample carries all of that structure back, because it is the
 * body itself rather than a ratio of two envelopes over it. It is also LOCAL:
 * it answers "are there Cells at this place in the organism", where the ray
 * integral answers "are there Cells anywhere along this line of sight". The
 * moat was the second question's answer, and closing it needs the first.
 *
 * ## Derivation
 *
 * Measured against 12,000 real `helixSeedF64` positions projected from the
 * production camera (`[110, 108, 110]`, fov 50, 1280x720; the galaxy-local
 * camera is at y = 108 − `CELLS_Y`), density marched at quarter resolution
 * with an undithered offset so the boundary metric reads structure rather than
 * sampling noise.
 *
 * The instrument is the length of the halo's own boundary — the share of
 * quarter-res texels inside `r <= 1.6` that touch both a lit and an unlit
 * neighbour. A curve is short; fingers are long. It rises to a plateau and
 * comes back down:
 *
 * | HIGH | boundary | halo inside the rim | Cells with light on them |
 * |-----:|---------:|--------------------:|-------------------------:|
 * | 0.10 |    4.7 % |                32 % |                     17 % |
 * | 0.13 |    4.8 % |                37 % |                     19 % |
 * | **0.15** | **4.9 %** |          **40 %** |                 **21 %** |
 * | 0.20 |    4.9 % |                46 % |                     25 % |
 * | 0.26 |    4.7 % |                52 % |                     30 % |
 * | 0.42 (the prototype) | 5.1 % |     68 % |                     47 % |
 *
 * 0.15 is the low end of the plateau, and the low end is the right end: every
 * step further into it buys no more boundary and costs more Cells. The
 * shipped share-driven build scores 2.9 % on the same instrument, so this is a
 * boundary 69 % longer, drawn by the tissue instead of by a radius.
 *
 * ## This threshold alone would cost the Cells, and does not have to
 *
 * A fold-plane sample cannot see WHERE in the slab a Cell sits — the Cells are
 * spread over a Gaussian 2.1 to 7.3 units thick, and the ray through one meets
 * the plane a median of 8.2 world units away from it (p90 20.3, p99 36.9,
 * against `FIELD_HALF_X` = 60). So on its own it lights 21 % of drawn Cells
 * where the shipped build lights 7 %. {@link POPULATION_FIELD_SIGHTLINE_HIGH}
 * is what puts the vertical information back, and it costs nothing visible:
 * see its own note for the measurement.
 */
export const POPULATION_FIELD_CORE_HIGH = 0.15;

/**
 * The fold-plane coverage at and below which the halo runs at full strength —
 * rule 9a's lower threshold, and the far end of the crossfade.
 *
 * A weak lever, and measured as one: swept from 0.000 to 0.090 with
 * {@link POPULATION_FIELD_CORE_HIGH} fixed, the boundary length never leaves
 * 4.8–4.9 %, the halo's reach never leaves 39–42 %, and the share of Cells
 * carrying light moves from 20 % to 24 %. Everything it governs happens where
 * the resolved tissue has already thinned to a few percent of its peak.
 *
 * It has to be strictly positive all the same. At exactly zero the halo only
 * reaches full strength where the coverage is *exactly* zero, and the bake is
 * half-float and linearly filtered, so true zeros are rare anywhere inside the
 * envelope — the outer body would approach full strength asymptotically
 * instead of arriving at it. 0.02 is 2 % of peak coverage: below it there is
 * no addressable Cell to defend, and the halo is simply all of the population.
 */
export const POPULATION_FIELD_CORE_LOW = 0.02;

/**
 * The resolved optical depth ALONG THE RAY at and above which the halo is
 * fully suppressed — the second half of rule 9a's suppression.
 *
 * `tauResolved` unnormalized, not divided by `tau`. That division was the bug
 * (see {@link POPULATION_FIELD_CORE_HIGH}); the accumulation itself was never
 * the problem, and it answers the one question the fold plane cannot: is there
 * addressable tissue anywhere along this line of sight, at any height. The two
 * suppressions are combined with `max`, so the halo survives only where BOTH
 * say there is nothing to obscure — the plane says "no Cells at this place in
 * the organism", the sightline says "no Cells in front of or behind this
 * pixel".
 *
 * This is the term that makes the interdigitation free. Measured the same way,
 * with the fold thresholds fixed at 0.02 / 0.15:
 *
 * | sightline HIGH | Cells with light | worst within 3 px (p90) | boundary | reach |
 * |---------------:|-----------------:|------------------------:|---------:|------:|
 * | (none — fold only) |         21 % |                   0.526 |    4.9 % |  40 % |
 * | 2.80 |                       16 % |                   0.372 |    4.8 % |  38 % |
 * | 1.40 |                       10 % |                   0.141 |    4.6 % |  34 % |
 * | **1.00** |               **7 %** |               **0.058** | **4.6 %** | **29 %** |
 * | 0.80 |                        6 % |                   0.030 |    4.4 % |  26 % |
 * | 0.40 |                        3 % |                   0.000 |    3.6 % |  16 % |
 * | *the shipped share build* |  *7 %* |                 *0.030* |  *2.9 %* | *19 %* |
 *
 * 1.00 is where the per-Cell cost meets the shipped build — 7 % of drawn
 * Cells carry any halo light, against the same 7 % today — while the boundary
 * is 59 % longer and the halo reaches half again as far into the tissue.
 * Below it the boundary starts collapsing back toward a curve; above it the
 * Cells start paying.
 *
 * The exchange is better than break-even, and the acceptance test asserts the
 * good half of it. Marched analytically per Cell rather than through the
 * quarter-resolution texture, four Cells in five carry exactly nothing under
 * either law, and in the TAIL — where a Cell actually loses contrast — the new
 * pair is strictly ahead: 71 Cells in 2,000 above a tenth of full halo against
 * the ellipse's 92, p95 0.116 against 0.158, p99 0.393 against 0.503. What it
 * gives back is a faint dusting on about 1 % more rim Cells at a tenth of that
 * level, which is the interdigitation itself. The Cells that carry any light
 * are still the rim ones (median radius 0.85, against 0.86 today).
 *
 * Setting this below {@link POPULATION_FIELD_CORE_LOW}'s effective range —
 * anything at or under about 0.05 — reverts the layer to a sightline-only
 * suppression and brings the moat back. Raising it past ~5 turns the term off
 * and leaves the fold plane alone with the 21 % cost above.
 */
export const POPULATION_FIELD_SIGHTLINE_HIGH = 1.0;

/**
 * The resolved optical depth along the ray at and below which the sightline
 * term suppresses nothing.
 *
 * Paired with {@link POPULATION_FIELD_SIGHTLINE_HIGH} and swept with it: the
 * two move together because the crossfade has to stay wide enough that its
 * onset is not itself a visible contour. 0.12 puts the ramp's start where a
 * ray has picked up about a tenth of the resolved depth a central one carries,
 * which is past the last Cell in that direction and inside the band where the
 * fold-plane term is already opening.
 */
export const POPULATION_FIELD_SIGHTLINE_LOW = 0.12;

/**
 * How far the halo is lifted inside the transition band — §5.2's brightness
 * bridge.
 *
 * The shapes interlock now, and the boundary is no longer geometric. What was
 * left separating the two regions is VALUE, which is what the eye segments on
 * first. Measured on the production camera with the shipped bake, mainnet's
 * gain of 0.58 and the real Cell sprite's own light: walking outward, total
 * areal luminance runs 0.113 through the bulge, falls to **0.076 at r ≈ 0.82**
 * — a 28% trough against its own shoulders — then rises to 0.128 in the halo.
 * That trough is the band where the Cells have thinned and the halo has not
 * yet arrived (§6.1 test 5), and a dark band between two lit regions is a line
 * drawn between them however well the shapes interdigitate.
 *
 * The form is `(1 - supp) * (1 + BRIDGE * supp)`, which has a closed form
 * worth stating because both halves of it are load-bearing:
 *
 *     peak factor = (BRIDGE + 1)^2 / (4 * BRIDGE)   at   supp = (BRIDGE - 1) / (2 * BRIDGE)
 *
 * so the lift is 1.125x at supp = 0.25 — inside the band, never at its edges —
 * and the factor returns to exactly 1 at supp = 0 and exactly 0 at supp = 1.
 * **Rule 9a is untouched by construction**: at full suppression this multiplies
 * a zero, at every gain and every optical depth.
 *
 * **Why 2.** The bridge buys the seam and pays for it on the rim Cells, and
 * both sides are measurable. Three columns, all on the production camera:
 * the trough against its own shoulders, the halo's share of the local Cell
 * luminance where the two touch (r 0.72–0.92), and — the one that binds — how
 * many of 2,000 drawn Cells end up carrying more than 0.30 of halo light.
 *
 * | BRIDGE | trough | halo/Cell at the touch | Cells > 0.30 | p99 Cell |
 * |-------:|-------:|-----------------------:|-------------:|---------:|
 * | 0 (accepted build) | 27.7% | 0.38x | 40 | 0.385 |
 * | 1 | 21.6% | 0.49x | 60 | 0.425 |
 * | 1.5 | 20.1% | 0.54x | 67 | 0.434 |
 * | **2** | **18.7%** | **0.58x** | **75** | **0.466** |
 * | 2.5 | 17.4% | 0.63x | 86 | 0.503 |
 * | 3.5 | 15.3% | 0.71x | — | — |
 *
 * The band the bridge lifts is exactly where the thinning rim Cells are, so
 * lifting it costs some of them contrast. **The bound is the elliptical
 * suppression that was judged live and accepted: its 99th-percentile Cell sat
 * at 0.4925, and 2 is the largest gain that keeps the worst-affected Cells
 * under it.** At 2.5 they pass it. That is the constraint, not taste — and it
 * is asserted in §6.1 test 1 rather than written down here.
 *
 * Four Cells in five still carry exactly nothing, unchanged.
 *
 * What it buys: the trough closes from 27.7% to 18.7%, and in the band where
 * the two touch the halo goes from **0.38x to 0.58x** the local Cell layer's
 * own areal luminance — approaching it, as §5.2 asks, and still under it. The
 * brightest speck the band can produce lands at luma 0.477 against a Cell
 * core's 1.284, so §11's separation is nowhere near being tested.
 *
 * The prototype's 2.6 was derived from a mock with a flat-dot core, which has
 * no rim Cells to lose contrast; this is derived against `cellHybridMaterial`'s
 * own emission, and the difference between 2.6 and 2 is that cost.
 */
export const POPULATION_FIELD_SEAM_BRIDGE = 2;

/**
 * How far the swarm's grain scale swings across the crossfade — §5.2.
 *
 * Density alone cannot close the seam, because the discontinuity the eye sees
 * there is one of KIND, not of amount: on one side large bright Cell sprites,
 * on the other two-pixel dots, with the switch happening over a few pixels.
 * So the grain scale is ramped, and apparent grain size varies continuously
 * across the boundary instead of switching.
 *
 * ⚠️ **The direction was backwards and this reverses it.** The first build
 * made the grain COARSEST at the seam, reasoning that the halo's texture
 * should be just-barely-unresolvable where it meets the Cells. That maximises
 * the textural mismatch exactly where the two have to read as one material:
 * the core is ~8,000 fabric filaments about one pixel wide, so what the halo
 * has to match WHERE THEY TOUCH is fine, not coarse. Coarsening outward is
 * also the better story — detail degrades with distance from the surveyed
 * region.
 *
 * The ramp is `1 + COARSENING * (0.5 - supp)`, centred on 1, so the mean grain
 * is exactly what it always was and only its gradient reverses.
 *
 * **The span is derived, not chosen.** §5 permits a screen cell of 1.5 to 2.5
 * device pixels measured as the cell's area. With
 * {@link POPULATION_FIELD_SPECK_PX} at 2 the ramp's ends are `2 * (1 ± span/2)`,
 * so a span of 0.5 lands them at exactly 1.5 and 2.5 — the widest swing §5
 * allows, and the whole of it. (The prototype's 1.45 - 0.55·supp put the outer
 * end at 2.9 px; the shipped 1 + 0.55·supp put the seam end at 3.1 px. Both
 * are outside the window, in opposite directions.)
 *
 * The population statement survives it. `amount` is the fraction of screen
 * CELLS that are lit, so scaling the cell up scales the lit AREA by exactly
 * the same factor as the unlit area: bigger specks, proportionally fewer of
 * them, same fraction of the screen lit and therefore the same count stated.
 */
export const POPULATION_FIELD_SEAM_COARSENING = 0.5;

/**
 * The grain scale at a given suppression — the shader evaluates exactly this.
 *
 * Finest where the halo meets the Cells, coarsening outward, centred on 1.
 *
 * @param suppression how much of the halo the drawn Cells have taken, in [0, 1]
 */
export function populationSeamGrain(suppression: number): number {
  const supp = Math.max(0, Math.min(1, suppression));
  return 1 + POPULATION_FIELD_SEAM_COARSENING * (0.5 - supp);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * How much of the halo the already-individuated Cells take, from the two
 * things that can be known about where they are. The shader evaluates exactly
 * this expression through GLSL's own `smoothstep`, which is the same cubic.
 *
 * **Two terms, because a Cell has a place and a direction.** The fold-plane
 * coverage says whether there are addressable Cells at this point of the
 * organism — it carries every corridor and cavity, which is what makes the
 * boundary fingers instead of an ellipse. The sightline depth says whether
 * there are addressable Cells anywhere along this ray — it carries the
 * vertical spread, which a single plane sample is blind to. `max` means the
 * halo survives only where both say there is nothing to obscure, so neither
 * term can ever ADD light over Cells; each can only take more away.
 *
 * @param coverage  resolved coverage where the ray crosses the fold plane
 * @param sightline resolved optical depth accumulated along the whole ray
 */
export function populationResolvedSuppression(
  coverage: number,
  sightline: number,
): number {
  return Math.max(
    smoothstep(POPULATION_FIELD_CORE_LOW, POPULATION_FIELD_CORE_HIGH, coverage),
    smoothstep(
      POPULATION_FIELD_SIGHTLINE_LOW,
      POPULATION_FIELD_SIGHTLINE_HIGH,
      sightline,
    ),
  );
}

/**
 * §5.2's brightness bridge, as a factor on the crossfade — the shader
 * evaluates exactly this.
 *
 * Peaks at `(BRIDGE - 1) / (2 * BRIDGE)`, reaching `(BRIDGE + 1)^2 / (4 *
 * BRIDGE)`; exactly 1 where nothing is suppressed and exactly 0 where
 * everything is.
 *
 * @param suppression how much of the halo the drawn Cells have taken, in [0, 1]
 */
export function populationSeamBridge(suppression: number): number {
  const supp = Math.max(0, Math.min(1, suppression));
  return (1 - supp) * (1 + POPULATION_FIELD_SEAM_BRIDGE * supp);
}

/**
 * Unresolved optical depth: the population under a ray, minus the part of it
 * already drawn, lifted across the band where the two meet. The shader
 * evaluates exactly this expression.
 *
 * The subtraction is on OPTICAL DEPTH and not on emission, and the difference
 * is visible. `1 - exp(-tau)` is concave, so scaling the light after
 * saturation makes the halo creep up slowly from the boundary and leaves a
 * dark seam between the Cells and the population around them; subtracting the
 * population first lets the halo reach the body it belongs to. It is also the
 * honest form: what the resolved Cells remove from the halo is not brightness,
 * it is the Cells themselves.
 *
 * Past either upper threshold the suppression is exactly 1 and this is exactly
 * zero, at any optical depth. Below both lower thresholds it is exactly `tau`.
 * In between it is a crossfade, and that band is the only place the two
 * populations can meet — so the band is also where §5.2's bridge lifts it, to
 * a bounded 1.125x of `tau` at the middle of the ramp. That overshoot is the
 * one place the crossfade states more population than the unsuppressed field
 * does, and it is the price of closing the trough the crossfade otherwise
 * leaves; the HUD's counts and the layer's `gain` are untouched by it.
 *
 * @param tau       optical depth of the whole body along the ray
 * @param coverage  resolved coverage where the ray crosses the fold plane
 * @param sightline resolved optical depth accumulated along the whole ray
 */
export function populationUnresolvedDepth(
  tau: number,
  coverage: number,
  sightline: number,
): number {
  return tau * populationSeamBridge(
    populationResolvedSuppression(coverage, sightline),
  );
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
 * §5 allows 1.5–2.5, and two is the only INTEGER in that window. That is why
 * it is the value here, but it buys less than the first draft claimed: the
 * cell is scaled by {@link populationSeamGrain} before it is used, so the
 * extent is fractional everywhere except the exact middle of the crossfade,
 * and the integer is a CENTRE rather than a guarantee. What the centre does
 * buy is that the ramp's two ends land on §5's two bounds exactly, which is
 * what makes the seam coarsening span derived rather than chosen.
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

/*
 * ⚠️ **Does the smear swim?** — §5.1.1's open risk, measured.
 *
 * The direction field turns with the galaxy while the hash is locked to the
 * screen, so the streaks could in principle drift across the picture: the same
 * class of artefact as the screen door, and the one thing a still frame cannot
 * answer. The test is a cross-correlation of the mask between two frames a
 * rotation apart, over screen shifts — a pattern that SWIMS peaks at the shift
 * it drifted by, a pattern locked to the screen peaks at zero, and one locked
 * to the world peaks where the tissue went.
 *
 * Measured against the shipped mask, at the galaxy's own 0.0025 rad/s and at a
 * brisk user orbit, with the reseed phase frozen so nothing else can move:
 *
 * | interval | tissue moves | smear: peak | at shift | old mask: peak |
 * |---|---:|---:|---|---:|
 * | one frame | 0.02 px | 0.994 | (0, 0) | 0.654 |
 * | one second | 0.92 px | 0.808 | (0, 0) | 0.043 |
 * | four seconds | 3.66 px | 0.603 | (0, 0) | 0.001 |
 * | one second, orbiting | 125 px | 0.356 | **(0, 0)** | 0.010 |
 *
 * **It does not swim.** The peak never leaves zero shift, at any rotation
 * rate — the lattice is fixed to the screen and the taps are offsets from the
 * fragment, so a turning direction can only decorrelate the smear in place,
 * never carry it. Nothing here needs to be locked to the field, and rule 10's
 * never-resolves guarantee is untouched.
 *
 * The risk is the opposite one, and it is what the reseed above is for: with
 * the phase live the correlation is 0.007 after a second, so the pattern is
 * wholly renewed several times a second and cannot be perceived as standing
 * still. What survives from frame to frame is 0.80 against the old mask's
 * 0.53 — the smear scintillates more gently, because eleven taps re-roll
 * gradually where one draw blinked.
 *
 * ⭐ The same measurement says the old mask was never frozen under REDUCED
 * MOTION either: at 0.043 after one second of the galaxy's own rotation, it
 * was re-rolling completely from the turning direction alone, with the phase
 * pinned to zero. §12 asks reduced motion to freeze the grain, and the smear
 * is the first build that actually does.
 */

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

/**
 * How hard the fibre gathers the specks — §5.1.
 *
 * Three numbers, one job: the swarm has to read as tissue rather than as
 * spray, and the only honest way to do that is to change WHICH specks are lit,
 * never how bright any of them is. Brightening along the strands would make
 * the layer a wash with a pattern on it, which is the rejected alternative
 * ("noise on fog is still fog").
 *
 *     bundled   = min(1, fibre * SATURATE)
 *     clustered = litFraction * (FLOOR + SPAN * bundled)
 *
 * `SATURATE` is what keeps the modulation bounded: the fibre's own peak is
 * ~0.99 and its density-weighted mean only 0.16, so without the inner
 * saturation a mean-preserving span would have to be about 6x and the strands
 * would clip to a hard-edged stencil. `FLOOR` is what the voids keep — a fifth
 * of their specks, so a gap between bundles is sparse rather than empty, which
 * is what a resolution limit actually looks like.
 *
 * `SPAN` is DERIVED and not chosen. Clustering must not change the population
 * the layer states, so the expected number of lit specks has to survive it,
 * clamping included: measured over the production camera's own frame with the
 * shipped bake, `0.22 + 2.3 * bundled` lights 99.2 % of the specks the
 * unclustered swarm would have. The reference prototype's `0.22 + 1.9` came
 * out at 88.2 %, which would have quietly under-claimed the population by an
 * eighth.
 */
export const POPULATION_FIELD_FIBRE_SATURATE = 2.6;
export const POPULATION_FIELD_FIBRE_FLOOR = 0.22;
export const POPULATION_FIELD_FIBRE_SPAN = 2.3;

/**
 * How often a lit speck belongs to the brighter sub-population — §5.1's points
 * ON the filaments.
 *
 * The fibre alone renders the *connections*. The population is Cells, and the
 * core's language is bright points on filaments, so the halo has to be points
 * on filaments too or it stays a different material however well the strands
 * are drawn.
 *
 * `chance = FLOOR + JUNCTION * fibre²`. Squaring is what puts the points at
 * the junctions: the fibre is `0.62·a + 0.38·b` over the two ridged octaves,
 * so its square carries a `2·0.62·0.38·ab` cross term that peaks only where
 * BOTH octaves do. Measured over the halo domain weighted by the population
 * under it, that lands the share at **6.2 % of lit specks**, rising to 15.3 %
 * on the strongest junctions — sparse, which is the point.
 *
 * This is a MASK THRESHOLD and that is why it may read the fibre at all.
 * §5.1's line holds: only the thresholds see the fibre, and speck brightness,
 * the continuum and the rim fade all keep reading the unclustered population.
 * The node's own brightness below is a constant, so a strand still gathers and
 * marks specks without a single photon of its own.
 */
export const POPULATION_FIELD_NODE_CHANCE = 0.055;
export const POPULATION_FIELD_NODE_JUNCTION = 0.10;

/** The measured population-weighted mean of the chance above, over the halo
 *  domain. Only {@link POPULATION_FIELD_NODE_BALANCE} reads it, and only to
 *  keep the sub-population from changing how much light the layer emits.
 *  The acceptance test re-measures it against the real field on every run, so
 *  moving either chance constant without re-deriving this fails there rather
 *  than silently changing the layer's brightness. */
export const POPULATION_FIELD_NODE_SHARE = 0.0614;

/**
 * How much brighter a node speck is than an ordinary one.
 *
 * **The ceiling here is the red channel, not taste.** The tint is `tissueRose`
 * (1.0, 0.40, 0.44) and {@link POPULATION_FIELD_EMISSION_PEAK} is 0.85, so the
 * largest emission that reaches the framebuffer without clamping red is
 * 1 / 0.85 = 1.176 — and the swarm's brightest speck already sat at 1.12, 95 %
 * of the way there. Anything brighter clamps red while green and blue keep
 * climbing, which drags the speck toward white; and white is precisely what
 * makes a point in the halo look like a resolved Cell core. The prototype's
 * 1.5–2.6x was measured against an 8-bit mock where exactly that clamping was
 * doing the work.
 *
 * So the multiplier is derived from where whitening starts to matter. At the
 * brightest a speck can be, mean-balanced:
 *
 * | gain | displayed rgb | luma | / Cell core | saturation | / core |
 * |-----:|---------------|-----:|------------:|-----------:|-------:|
 * | 1.3 | (1.00,0.47,0.51) | 0.582 |   0.706 |      0.535 |  2.02x |
 * | **1.5** | **(1.00,0.52,0.57)** | **0.626** | **0.759** | **0.480** | **1.81x** |
 * | 1.6 | (1.00,0.55,0.60) | 0.647 |   0.785 |      0.453 |  1.71x |
 * | 1.8 | (1.00,0.60,0.66) | 0.689 |   0.836 |      0.400 |  1.51x |
 * | 2.0 | (1.00,0.65,0.72) | 0.730 |   0.885 |      0.349 |  1.32x |
 *
 * 1.5 is the largest gain at which a node stays more than **1.8x as saturated**
 * as a Cell core — unmistakably the body rose rather than a near-white core —
 * and it keeps a 1.32x margin on luminance underneath that.
 *
 * **Re-checked after §5.2's bridge, which raises emission.** The threshold
 * itself cannot move: a node clamps red past `amount` 0.769, which is a closed
 * form in the constants above, and the bridge lives inside the exponential
 * where `amount` is already bounded by one. What moves is how much of the
 * picture reaches it — measured over the halo, **1.6 % of lit pixels before
 * the bridge and 2.1 % after** (8.9 % to 12.2 % inside the seam band itself).
 * The band's brightest node lands at rgb (1.00, 0.50, 0.55), saturation 0.496,
 * still clear of the 1.8x bound the test holds at 0.477. The gain stands.
 *
 * ⚠️ An earlier draft of this note said red was unclamped "except its densest
 * quarter". That reads as a quarter of the layer and it is not: the share of
 * lit halo pixels past the cap was 1.6 %, and is 2.1 % now.
 */
export const POPULATION_FIELD_NODE_GAIN = 1.5;

/**
 * What every speck's brightness is scaled by so the sub-population is a
 * REDISTRIBUTION rather than more light.
 *
 * Derived, not chosen: `1 / (1 + share · (gain − 1))` is exactly the factor
 * that holds `E[brightness]` where it was, so the layer emits the same total
 * light and states the same population, and nobody has to re-judge a
 * brightness that was already accepted. Ordinary specks give up 3 %; the nodes
 * take it back concentrated into a sixteenth of them.
 */
export const POPULATION_FIELD_NODE_BALANCE = 1
  / (1 + POPULATION_FIELD_NODE_SHARE * (POPULATION_FIELD_NODE_GAIN - 1));

/**
 * How many hash taps the mask draw is smeared over, each way — §5.1.1.
 *
 * Anisotropy is what makes a texture read as fibrous instead of as noise, and
 * the elongated screen cell this replaces did not deliver any: measured on the
 * production camera, its lit runs were 1.62 px along the flow against 1.68 px
 * across — an aspect of 0.96, a circle. The line-integral convolution below
 * measures **1.63**, from the same field and the same hash.
 *
 * **Five, and fewer is better here, which is not obvious.** More taps make a
 * longer smear, but the smear can only stay coherent while the direction does,
 * and the direction turns a median 0.047 rad per pixel. Past about five steps
 * the far taps are sampling a direction that has already turned, so they add
 * noise rather than length. Measured aspect, direction from the ridge base:
 *
 * | taps each way | cells | hash evals | aspect |
 * |--------------:|------:|-----------:|-------:|
 * | 5 | 11 | **22** | **1.63** |
 * | 7 | 15 | 30 | 1.56 |
 * | 9 | 19 | 38 | 1.52 |
 * | 12 | 25 | 50 | 1.48 |
 *
 * The cheapest option is also the best one, and it lands on §5.1.1's own
 * budget of about nineteen hash evaluations per pixel — the spec assumed one
 * hash per tap, but each tap needs a second for its reseed phase, so the
 * budget buys five steps rather than nine.
 */
export const POPULATION_FIELD_LIC_TAPS = 5;

/**
 * How far apart the smear's taps are, in device pixels, before the seam ramp.
 *
 * **Derived from the ramp, not chosen.** The lattice and the step are the same
 * number — taps then land in adjacent cells, which is what makes the smear
 * continuous along the flow rather than a comb of correlations at multiples of
 * the step — and both ride {@link populationSeamGrain}. This is set so that at
 * full suppression, where the halo meets the Cells' own one-pixel filaments,
 * the lattice is exactly one device pixel; at the far edge it opens to 1.67 px.
 * Fine where the two materials must match, coarse where nothing is beside it.
 *
 * The draw's spread is invariant to this scale (measured 0.1004 / 0.1007 /
 * 0.1002 at 1.00 / 1.33 / 1.67 px), so one contrast fit covers the whole ramp.
 */
export const POPULATION_FIELD_LIC_STEP = 1 / populationSeamGrain(1);

/**
 * The two coefficients that put the smeared draw back on a flat [0, 1).
 *
 * A triangular-weighted mean of eleven uniforms is a bell with a spread of
 * about 0.10, not a uniform — and `step(pick, clustered)` on a bell states the
 * wrong population. The remap is that sum's own CDF, which is Gaussian to
 * within a whisker, evaluated as `0.5 * (1 + tanh(C * z * (1 + S * z^2)))`:
 * the standard tanh form of `erf`, with both coefficients FITTED to the
 * measured distribution rather than taken from the textbook approximation.
 *
 * What that buys, as the share of screen cells actually lit against the share
 * the field asked for, over 660,000 draws at eleven flow angles:
 *
 * | remap | worst relative error |
 * |---|---:|
 * | the prototype's linear `(raw - 0.5) * 4.4 + 0.5` | **320 %** (lights 8.4 % where the field says 2 %) |
 * | textbook `erf` at the measured spread | 4.0 % |
 * | **fitted, below** | **0.7 %** |
 *
 * The linear stretch is not a near miss: it clips both tails onto 0 and 1, so
 * it over-claims the faint outer population fourfold — which is the one thing
 * this layer may not do.
 */
export const POPULATION_FIELD_LIC_CONTRAST = 7.64;
export const POPULATION_FIELD_LIC_SHOULDER = 5.5;

/**
 * The mask draw, from the smeared value — the shader evaluates exactly this.
 *
 * @param raw the triangular-weighted mean of the taps, centred on 0.5
 */
export function populationLicPick(raw: number): number {
  const z = raw - 0.5;
  const u = POPULATION_FIELD_LIC_CONTRAST * z
    * (1 + POPULATION_FIELD_LIC_SHOULDER * z * z);
  const e = Math.exp(2 * u);
  return e / (e + 1);
}

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
 * @param clustered   the same fraction after the fibre has gathered it;
 *                    defaults to no clustering at all
 * @param nodeDraw    the cell's second, independent mask draw, in [0, 1)
 * @param nodeChance  {@link populationNodeChance} for the local fibre;
 *                    defaults to no sub-population at all
 */
export function populationSwarmEmission(
  litFraction: number,
  pick: number,
  spread: number,
  clustered: number = litFraction,
  nodeDraw: number = 1,
  nodeChance: number = 0,
): number {
  const lit = Math.min(Math.max(litFraction, 0), 1);
  const gathered = Math.min(Math.max(clustered, 0), 1);
  const continuum = lit * POPULATION_FIELD_CONTINUUM_FRACTION;
  // The mask threshold IS the population statement: a cell is lit exactly when
  // its uniform draw falls under the local fraction, so the COUNT of lit
  // specks per unit screen area carries the number. Speck brightness carries
  // nothing, which is why the spread below is narrow and centred.
  //
  // The fibre moves that threshold and nothing else. Everything below reads
  // the UNCLUSTERED population, so a bundle holds more specks without any of
  // them being brighter — grain direction, not a glow along a strand.
  if (pick >= gathered) return continuum;
  // §5.1's points ON the filaments. A SECOND mask threshold, independent of
  // the first, so it moves no speck in or out of the population — it only
  // decides which of the already-lit ones are the brighter kind. The chance
  // reads the fibre because it is a threshold; the gain is a constant, so a
  // strand still never glows.
  const node = nodeDraw < nodeChance ? POPULATION_FIELD_NODE_GAIN : 1;
  const brightness = (POPULATION_FIELD_SPECK_FLOOR
    + (1 - POPULATION_FIELD_SPECK_FLOOR) * spread)
    * POPULATION_FIELD_NODE_BALANCE * node;
  // The second `lit` is not a second population claim, it is the rim: at the
  // envelope's edge the fraction is a few percent, and specks that stayed at
  // full brightness there would be a scatter of isolated bright points — the
  // one thing a user could actually count, which rule 10 forbids. Fading them
  // as they thin out lets the population end instead of fraying into stars.
  return continuum + brightness * lit * POPULATION_FIELD_SPECK_GAIN;
}

/**
 * How the fibre gathers the swarm: the share of screen cells lit inside a
 * bundle, given the population under the pixel and the local fibre strength.
 *
 * The modulation is on the MASK THRESHOLD and nowhere else. Speck brightness,
 * the continuum, and the rim fade all keep reading the unclustered population,
 * so the fibre moves specks around without adding a single photon of its own.
 *
 * @param fibre       the local fibre strength, in [0, 1]
 * @param litFraction the population's own lit fraction under this pixel
 */
/**
 * How likely a lit speck is to belong to the brighter sub-population, given
 * the local fibre — §5.1's points on the filaments.
 *
 * The square is what puts them at the junctions rather than along every
 * strand: `fibre` is `0.62·a + 0.38·b` over two ridged octaves, so `fibre²`
 * carries a cross term that peaks only where both octaves do. The floor is
 * what keeps the sub-population from being a map of the fibre — a few of them
 * land off the strands entirely, which is what a resolution limit looks like.
 *
 * @param fibre the local fibre strength, in [0, 1]
 */
export function populationNodeChance(fibre: number): number {
  const strength = Math.min(Math.max(fibre, 0), 1);
  return POPULATION_FIELD_NODE_CHANCE
    + POPULATION_FIELD_NODE_JUNCTION * strength * strength;
}

export function populationFibreClustering(
  fibre: number,
  litFraction: number,
): number {
  const bundled = Math.min(Math.max(fibre * POPULATION_FIELD_FIBRE_SATURATE, 0), 1);
  const gathered = litFraction
    * (POPULATION_FIELD_FIBRE_FLOOR + POPULATION_FIELD_FIBRE_SPAN * bundled);
  return Math.min(Math.max(gathered, 0), 1);
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

  // Where the ray crosses the tissue's own plane — the point of the organism
  // this pixel is looking at. Both passes need it and for the same reason:
  // the halo is a disk, so what lies in it, lies IN it. The density pass reads
  // the resolved coverage there (the local half of rule 9a) and the composite
  // reads the fibre there.
  //
  // Clamped into the slab because a grazing ray's intersection runs off to
  // infinity and would sample the bake's clamped edge forever, and an edge-on
  // camera really does produce one.
  vec3 foldPlanePoint(vec3 ro, vec3 rd, float tEnter, float tExit) {
    float rdy = rd.y >= 0.0 ? max(rd.y, 1e-4) : min(rd.y, -1e-4);
    float tFold = clamp(-ro.y / rdy, tEnter, tExit);
    return ro + rd * tFold;
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
  uCoreLow: { value: number };
  uCoreHigh: { value: number };
  uSightLow: { value: number };
  uSightHigh: { value: number };
  uBridge: { value: number };
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
      uCoreLow: { value: POPULATION_FIELD_CORE_LOW },
      uCoreHigh: { value: POPULATION_FIELD_CORE_HIGH },
      uSightLow: { value: POPULATION_FIELD_SIGHTLINE_LOW },
      uSightHigh: { value: POPULATION_FIELD_SIGHTLINE_HIGH },
      uBridge: { value: POPULATION_FIELD_SEAM_BRIDGE },
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
      uniform float uCoreLow;
      uniform float uCoreHigh;
      uniform float uSightLow;
      uniform float uSightHigh;
      uniform float uBridge;
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

        // The point of the ORGANISM this pixel is looking at, and the resolved
        // coverage there. One fetch, no dither: this is a place, not an
        // integral, so it carries every corridor and cavity the tissue has.
        vec3 foldPoint = foldPlanePoint(ro, rd, tEnter, tExit);
        vec2 foldUv = foldPoint.xz / (2.0 * uHalf.xz) + 0.5;
        float foldCoverage = texture2D(uField, foldUv).a;

        // Rule 9a, as arithmetic. The halo states the population MINUS the
        // part of it already on screen as addressable Cells: a subtraction of
        // optical depths, done before the exponential, so a pixel whose Cells
        // are dense enough on either measure ends at exactly zero and no gain,
        // swarm density, or later brightness knob can put a photon back over
        // them. Three overlays failed by taxing the Cells' sharpness; this is
        // the guarantee that replaces them.
        //
        // Subtracting depth rather than emission is also what closes the seam.
        // 1 - exp(-tau) is concave, so scaling the LIGHT after saturation lets
        // the halo creep up slowly and leaves a dark ring around the body it
        // is supposed to continue.
        //
        // TWO MEASURES, because a Cell has a place and a direction, and the
        // suppression has to know both.
        //
        // The fold-plane coverage is the LOCAL one — are there addressable
        // Cells at this point of the organism. It is what the ratio
        // tauResolved / tau could never be: that quotient is the same body
        // term under two envelopes, so the body cancels exactly and what
        // remains is a function of the warped radius alone. Every threshold on
        // it drew an ellipse, which is what the addressable region looked like
        // — a regular oval moat around the Cells. The plane sample is the body
        // itself, so the boundary it draws is as irregular as the tissue.
        //
        // The sightline depth is the DIRECTIONAL one — are there addressable
        // Cells anywhere along this ray, at any height. The Cells occupy a
        // slab 2.1 to 7.3 units thick and the ray through one meets the plane
        // a median 8.2 world units away from it, so a plane sample alone is
        // blind to most of them: on its own it puts halo light on 21% of drawn
        // Cells where this pair puts it on 7%, the same 7% the elliptical
        // build reached.
        //
        // The stronger of the two wins, so the halo survives only where BOTH
        // say there is nothing to obscure. Neither term can add light over
        // Cells; each can only take more away.
        float supp = max(
          smoothstep(uCoreLow, uCoreHigh, foldCoverage),
          smoothstep(uSightLow, uSightHigh, tauResolved));
        float unresolved = tau * (1.0 - supp);
        // §5.2's brightness bridge. The crossfade alone leaves a measured 28%
        // luminance trough at r ~ 0.8, where the Cells have thinned and the
        // halo has not yet arrived, and a trough between two lit regions is a
        // line drawn between them. This lifts the halo INSIDE the band and
        // settles it outward.
        //
        // It multiplies the depth and not the light, for rule 9a's own reason:
        // scaling after the exponential is what leaves a dark seam. Because it
        // lives inside the exponential it cannot raise the layer's ceiling at
        // all — the lit fraction is still below one at any gain — so §11's
        // bound on peak speck brightness is untouched by construction.
        //
        // The zero survives: at full suppression this multiplies a term that
        // is already exactly zero.
        unresolved *= 1.0 + uBridge * supp;

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
  /** The baked ridge bases. Absent until the bake lands, like the law's. */
  uFibre: { value: THREE.Texture | null };
  /** Half-extents of the baked domain, so the fibre lookup remaps position
   *  exactly the way the density march does. */
  uHalf: { value: THREE.Vector3 };
  /** Camera in the galaxy's rotating frame — the composite needs its own ray
   *  to find where each pixel crosses the fold plane. */
  uLocalCamera: { value: THREE.Vector3 };
  /** One bake texel in world units. The gradient is taken at this spacing, so
   *  it tracks the finest structure the bake actually holds. */
  uBakeTexel: { value: THREE.Vector2 };
  uResolution: { value: THREE.Vector2 };
  uTint: { value: THREE.Color };
  uSpeckPx: { value: number };
  uLicStep: { value: number };
  uLicContrast: { value: number };
  uLicShoulder: { value: number };
  uFibreFloor: { value: number };
  uFibreSpan: { value: number };
  uFibreSaturate: { value: number };
  uNodeChance: { value: number };
  uNodeJunction: { value: number };
  uNodeGain: { value: number };
  uNodeBalance: { value: number };
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
      uFibre: { value: null },
      uHalf: { value: new THREE.Vector3(1, 1, 1) },
      uLocalCamera: { value: new THREE.Vector3() },
      uBakeTexel: { value: new THREE.Vector2(1, 1) },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTint: { value: swarmTint() },
      uSpeckPx: { value: POPULATION_FIELD_SPECK_PX },
      uLicStep: { value: POPULATION_FIELD_LIC_STEP },
      uLicContrast: { value: POPULATION_FIELD_LIC_CONTRAST },
      uLicShoulder: { value: POPULATION_FIELD_LIC_SHOULDER },
      uFibreFloor: { value: POPULATION_FIELD_FIBRE_FLOOR },
      uFibreSpan: { value: POPULATION_FIELD_FIBRE_SPAN },
      uFibreSaturate: { value: POPULATION_FIELD_FIBRE_SATURATE },
      uNodeChance: { value: POPULATION_FIELD_NODE_CHANCE },
      uNodeJunction: { value: POPULATION_FIELD_NODE_JUNCTION },
      uNodeGain: { value: POPULATION_FIELD_NODE_GAIN },
      uNodeBalance: { value: POPULATION_FIELD_NODE_BALANCE },
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
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      // Both matrices are program-wide uniforms three already sets for every
      // object it draws; the fragment prefix simply does not declare them.
      uniform mat4  modelViewMatrix;
      uniform mat4  projectionMatrix;
      uniform sampler2D uDensity;
      uniform sampler2D uFibre;
      uniform vec3  uHalf;
      uniform vec3  uLocalCamera;
      uniform vec2  uBakeTexel;
      uniform vec2  uResolution;
      uniform vec3  uTint;
      uniform float uSpeckPx;
      uniform float uLicStep;
      uniform float uLicContrast;
      uniform float uLicShoulder;
      uniform float uFibreFloor;
      uniform float uFibreSpan;
      uniform float uFibreSaturate;
      uniform float uNodeChance;
      uniform float uNodeJunction;
      uniform float uNodeGain;
      uniform float uNodeBalance;
      uniform float uCoarsening;
      uniform float uContinuum;
      uniform float uSpeckGain;
      uniform float uSpeckFloor;
      uniform float uPeak;
      uniform float uSwarmPhase;
      uniform int   uBloomCount;
      uniform vec4  uBlooms[${POPULATION_FIELD_MAX_BLOOMS}];

      varying vec3 vLocal;

      ${SLAB_GLSL}

      // The halo's fibre, from the baked ridge bases.
      //
      // The powers live here rather than in the bake, and that is the whole
      // reason one fetch is enough: 1 - |noise| has features at its octave's
      // own scale, which the bake oversamples, while the same field raised to
      // the ninth has features a texel wide and would be averaged into mush.
      // Sharp filaments at screen resolution, for the cost of a lookup.
      float fibreAt(vec2 p) {
        vec2 uv = p / (2.0 * uHalf.xz) + 0.5;
        vec2 base = texture2D(uFibre, uv).rg;
        float a2 = base.r * base.r;
        float a = a2 * a2 * a2 * base.r;
        float b2 = base.g * base.g;
        float b4 = b2 * b2;
        float b = b4 * b4 * base.g;
        return a * ${POPULATION_FIBRE_MIX_A} + b * ${POPULATION_FIBRE_MIX_B};
      }

      // The DIRECTION reads the ridge base, unpowered. The powers are exactly
      // what makes the fibre peaky, and a peaky field's gradient direction is
      // noise: measured on the production camera, the powered field's
      // projected direction turns a median 0.141 rad between ADJACENT pixels
      // against 0.047 for the base. That matters because the smear below can
      // only stay coherent while the direction does — switching the four
      // difference taps to the base takes the grain's anisotropy from 1.30 to
      // 1.52 with nothing else changed, and it is CHEAPER, because these taps
      // no longer pay for the powers.
      float fibreBaseAt(vec2 p) {
        return texture2D(uFibre, p / (2.0 * uHalf.xz) + 0.5).r;
      }

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

        // --- the fold plane, which is where the fibre lives ----------------
        //
        // The fibre is a property of the tissue's own plane, not of the
        // volume: the halo is a disk, and filaments in it lie in it. So the
        // ray is intersected with y = 0 once and the field is read there,
        // rather than being carried through the march. The fold wanders by at
        // most +-6.3 over a footprint 264 wide, and the fibre is a grain
        // rather than a registered feature, so the plane is the fold closely
        // enough.
        //
        // The same crossing the density pass takes for rule 9a's local half,
        // through the same shared helper — the two passes have to be looking
        // at the same point of the organism or the grain would be drawn
        // somewhere other than where the population was decided.
        vec3 ro = uLocalCamera;
        vec3 rd = normalize(vLocal - ro);
        float tEnter, tExit;
        slabRange(ro, rd, uHalf, tEnter, tExit);
        vec3 foldPoint = foldPlanePoint(ro, rd, tEnter, tExit);
        vec2 fold = foldPoint.xz;

        // Grain DIRECTION, not links. Filaments run ALONG a ridge, which is
        // across its gradient — there are no nodes out here and nothing
        // terminates anywhere, so what the halo carries is the direction the
        // unresolved fabric runs in, never a segment between two points.
        //
        // Central differences on the same texture one texel apart: adjacent
        // texels are cache hits, which is why the direction is computed here
        // instead of being baked into channels of its own that would have to
        // be kept in sync with the bases.
        float gx = fibreBaseAt(fold + vec2(uBakeTexel.x, 0.0))
          - fibreBaseAt(fold - vec2(uBakeTexel.x, 0.0));
        float gz = fibreBaseAt(fold + vec2(0.0, uBakeTexel.y))
          - fibreBaseAt(fold - vec2(0.0, uBakeTexel.y));
        // In WORLD units. The bake's texels are wider in x than in z, so a
        // gradient left in texel units would tilt every direction in the
        // picture by a constant angle.
        vec2 grad = vec2(gx / uBakeTexel.x, gz / uBakeTexel.y);
        vec2 along = vec2(-grad.y, grad.x);
        float alongLen = length(along);
        vec2 dir = alongLen > 1e-6 ? along / alongLen : vec2(1.0, 0.0);

        // Into screen space through the same projection the Cells use, as two
        // projected points rather than a rotation of the camera basis, so the
        // perspective foreshortening is exact and the strands stay glued to
        // the plane at the edges of the frame instead of swinging off it.
        vec4 viewNear = modelViewMatrix * vec4(foldPoint, 1.0);
        vec4 viewFar = viewNear
          + modelViewMatrix * vec4(dir.x * 2.0, 0.0, dir.y * 2.0, 0.0);
        vec4 clipNear = projectionMatrix * viewNear;
        vec4 clipFar = projectionMatrix * viewFar;
        vec2 ndcStep = clipFar.xy / max(clipFar.w, 1e-4)
          - clipNear.xy / max(clipNear.w, 1e-4);
        vec2 screenStep = ndcStep * uResolution;
        float screenLen = length(screenStep);
        vec2 axis = screenLen > 1e-6 ? screenStep / screenLen : vec2(1.0, 0.0);

        // The fibre CLUSTERS the specks and does nothing else. It modulates
        // the mask threshold, so a bundle holds more of them and a void
        // holds fewer; every brightness term below still reads the
        // unclustered population, because a strand that glowed would be a
        // wash with a pattern on it rather than a population with a grain.
        float fibre = fibreAt(fold);
        float bundled = clamp(fibre * uFibreSaturate, 0.0, 1.0);
        float clustered = clamp(
          amount * (uFibreFloor + uFibreSpan * bundled), 0.0, 1.0);

        // The swarm. Screen cells of uSpeckPx DEVICE pixels, of which exactly
        // the local fraction are lit — the field sets HOW MANY specks are lit,
        // never how bright a wash is. The cell index comes from gl_FragCoord,
        // so the scale is fixed to the display and no camera move resolves it.
        // §5.2, the resolution gradient. FINEST where the halo meets the
        // thinning Cells and coarsening outward: the core is filaments about
        // one pixel wide, so what the halo has to match where the two touch
        // is fine. Apparent grain size then varies continuously across the
        // boundary instead of switching from large sprites to dots, and the
        // switch of KIND is what the eye was reading as an edge. The count is
        // unaffected: the lit fraction is a fraction of screen CELLS, so a
        // larger cell lights a proportionally larger area and states the same
        // population.
        float coarse = 1.0 + uCoarsening * (0.5 - clamp(suppression, 0.0, 1.0));
        // The cell is AXIS-ALIGNED, and that is a correction. It used to be
        // indexed by the PROJECTION of the absolute fragment coordinate onto
        // the local direction — a screen coordinate of magnitude ~1400 turned
        // by a per-pixel direction — so a direction that moved by even a
        // thousandth of a radian between neighbours moved that index by more
        // than a whole cell. Measured on
        // the production camera the direction turns a median 0.047 rad
        // between ADJACENT pixels, which moved that index a median 26 px
        // against a cell 1.2 px across: neighbouring pixels landed in
        // unrelated cells, and the mask was one-pixel noise with no cell
        // structure and no elongation in it at all (run lengths 1.62 along
        // the flow against 1.68 across — an aspect of 0.96, which is a
        // circle). The anisotropy the elongation was there to provide now
        // comes from the smear below, where it is measurable.
        vec2 extent = max(vec2(uSpeckPx * coarse), vec2(0.25));
        vec2 cell = floor(gl_FragCoord.xy / extent);

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
        float spread = hash21(cell * 0.7 + epoch * 5.71 + 3.3);
        // A SECOND draw on the same cell and the same epoch, so a node
        // reseeds with the speck it belongs to rather than blinking on its
        // own clock.
        float nodeDraw = hash21(cell * 1.7 + epoch * 9.31 + 4.7);

        // §5.1.1. THE MASK DRAW, by line-integral convolution.
        //
        // The core is filaments about one pixel wide. One hash per screen
        // cell can only ever produce one-pixel NOISE, and no amount of
        // brightness matching fuses noise with hair. A finer noise octave
        // does not help either: an 0.8-unit octave is 1.55 texels on the
        // 512² bake, below Nyquist, so it aliases rather than sub-branches.
        //
        // The answer is not a finer noise, it is smearing a fine hash ALONG a
        // coarse direction. Structure then emerges at the HASH's frequency —
        // one pixel — while the direction field stays exactly as coarse as
        // the bake can afford. Pure ALU, and not one extra texture fetch.
        //
        // The lattice rides the same seam ramp as the speck cell, so it is
        // exactly one device pixel where the halo meets the Cells' own
        // one-pixel filaments and 1.67 px at the far edge. The step equals
        // the lattice: taps then land in adjacent cells, which is what makes
        // the smear continuous along the flow instead of a comb.
        float licPx = uLicStep * coarse;
        float acc = 0.0;
        for (int k = -${POPULATION_FIELD_LIC_TAPS}; k <= ${POPULATION_FIELD_LIC_TAPS}; k++) {
          float w = 1.0 - abs(float(k)) / ${(POPULATION_FIELD_LIC_TAPS + 1).toFixed(1)};
          vec2 licCell = floor(
            (gl_FragCoord.xy + axis * (float(k) * licPx)) / licPx);
          float licJitter = hash21(licCell * 1.37 + 11.7);
          float licEpoch = floor(uSwarmPhase + licJitter);
          acc += hash21(licCell + licEpoch * 17.13) * w;
        }
        // The triangular weights sum to exactly TAPS + 1.
        float licRaw = acc / ${(POPULATION_FIELD_LIC_TAPS + 1).toFixed(1)};

        // A mean of many uniforms is not uniform, and the mask threshold is
        // the layer's entire population statement — step(pick, clustered) has
        // to light exactly that fraction of the screen or the count disagrees
        // with the field. So the draw is put back on [0, 1) flat through the
        // sum's own CDF, which is Gaussian to within a whisker. The
        // prototype's linear stretch is what this replaces: measured, it lit
        // 8.4 % of cells where the field said 2 %, over-claiming the faint
        // outer population fourfold. This tracks it to 0.7 % at every level.
        //
        // 0.5 * (1 + tanh(u)) with the tanh written as one exp, because GLSL
        // ES 1.00 has no tanh.
        float licZ = licRaw - 0.5;
        float licU = uLicContrast * licZ * (1.0 + uLicShoulder * licZ * licZ);
        float licE = exp(2.0 * licU);
        float pick = licE / (licE + 1.0);

        // step(pick, clustered) is 1 exactly when the cell's draw falls under
        // the local fraction. Every term from here is positive: unresolved
        // light never subtracts, and a speck dipping below the continuum would
        // paint a dark point — dirt, not scintillation.
        //
        // The two terms after it read the unclustered amount, and that is the
        // line §5.1 draws: the continuum is the population's own floor, and
        // the second factor is the rim fade that keeps thinning tissue
        // from fraying into countable stars. Both are statements about how
        // much population is here. Only the threshold is allowed to know
        // about the fibre.
        //
        // §5.1's points ON the filaments. The fibre alone renders the
        // CONNECTIONS, and the population is Cells — the core's language is
        // bright points on filaments, so the halo has to be points on
        // filaments too or it stays a different material however well the
        // strands are drawn. A second, independent threshold on the same cell:
        // it moves no speck into or out of the population, it only says which
        // of the already-lit ones are the brighter kind. Squaring the fibre is
        // what puts them at the JUNCTIONS — the square of a two-octave mix
        // carries a cross term that peaks only where both octaves do — and the
        // floor keeps a few of them off the strands entirely, which is what a
        // resolution limit looks like. Sub-pixel, reseeding, uncountable:
        // rule 10 is untouched.
        //
        // uNodeBalance is the price. It is derived so E[brightness] does not
        // move, which makes the sub-population a REDISTRIBUTION rather than
        // more light — the layer emits the same total and states the same
        // population, and the brightness already judged live does not change.
        float nodeChance = uNodeChance + uNodeJunction * fibre * fibre;
        float node = 1.0 + step(nodeDraw, nodeChance) * (uNodeGain - 1.0);
        float lit = step(pick, clustered)
          * (uSpeckFloor + (1.0 - uSpeckFloor) * spread) * uNodeBalance * node;
        float emission = amount * uContinuum + lit * amount * uSpeckGain;

        gl_FragColor = vec4(uTint * emission * uPeak, emission * uPeak);
      }
    `,
  });
}
