import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import {
  BODY_DEPTH_ENERGY_GLSL,
  GALAXY_RADIANCE_IDENTITY,
  HYBRID_BASE_PX_PER_WU,
  galaxyRadianceGain,
} from './cellHybridMaterial';
import {
  optimizeScreenSpaceCapsuleMaterial,
  replaceShaderChunk,
} from '../geometry/screenSpaceCapsuleLine';
import { CELL_GALAXY_PALETTE, type SceneColor } from '../visualPalette';

/**
 * The unresolved population, drawn as points in the Cells' own world.
 *
 * This is deliberately the SAME material family as `cellHybridMaterial`, down
 * to the blend factors and the point-size law: a Gaussian sprite, bounded
 * screen accumulation, body hue, no tone mapping. There is no seam to blend
 * because there is no change of material, and that is the entire point of the
 * design — the previous construction was a procedural screen-space texture,
 * and however closely its value, grain and hue were matched, a hash-cell field
 * and a cloud of point sprites stay two materials with a visible boundary.
 *
 * The halo is separated from an addressable Cell by SIZE and BRIGHTNESS alone:
 *
 *   - clearly smaller — the whole of
 *     {@link POPULATION_FIELD_POINT_SIZE_MIN}..{@link POPULATION_FIELD_POINT_SIZE_MAX}
 *     sits below the smallest Cell sprite in the stage, and it is a RANGE
 *     rather than one value, so the two populations share a size axis instead
 *     of occupying a spike and a continuum on it;
 *   - no white-hot core — a Cell mixes toward `warmWhite` at its peak, and
 *     this does not, so the two never converge in hue at their centres;
 *   - no outer halo wash and no interaction ring;
 *   - a saturated patch of it can never reach a Cell core's brightness, and
 *     that ceiling is structural rather than tuned (see
 *     {@link POPULATION_FIELD_EMISSION}).
 *
 * And by nothing else. In particular it now RESOLVES on a fly-in, which is
 * what "unresolved" honestly means — more aperture resolves more. The whole
 * not-addressable burden therefore rests on affordance: no hover response, no
 * cursor change, no raycast, and the HUD legend.
 */

/**
 * Sprite size in world units, in the Cells' own scale — a RANGE, ridden by the
 * placement pass's taper weight.
 *
 * The ceiling is the invariant and it has not moved: no halo point is ever as
 * large as the smallest addressable Cell. Measured on the real stage,
 * `cellPointSize` runs 0.783 (an untagged Cell at minimum morphology) through
 * a median of 1.033 to 2.40, and 3.58 once tagged Cells are on stage; 0.76 is
 * under all of it.
 *
 * What moved is that the halo is no longer FLAT. A single value is what made
 * the mixed band read as two classes: every halo point in it drew at exactly
 * 0.72 — 0.92x the smallest Cell and 0.70x the median one, so not even
 * especially small — while the Cells beside them varied over a factor of three.
 * The eye reads a manufactured uniform carpet next to a varied population, and
 * no amount of extra structure elsewhere fixes a delta spike on the size axis.
 *
 * Measured, in the 0.75–1.04 band, over 19 log-spaced size bins between 0.42
 * and 2.45: the flat build occupies **11** of them, this range occupies
 * **15**, and the halo now puts 18.8% of its points in the same bin as the
 * smallest 9.2% of Cells. The ladder runs big Cells → small Cells → large halo
 * points → small halo points with nothing missing between.
 *
 * The floor is set by light rather than by taste. Rendered flux goes as
 * `size^2 * alpha`, so at 1080p this range plus {@link
 * this range lands the layer at 81% of the flat build's total light WITHOUT
 * moving {@link POPULATION_FIELD_EMISSION}, and the loss is where it should
 * be: the open fringe pays `(0.50/0.76)^2` = 0.433 against the dense tissue's
 * 1.0, which is the answer to the outer field carrying 76% of the layer's
 * light over the fewest Cells. Size is now the WHOLE of that taper — the
 * brightness half of it was measured to cost the outer field 11.4% of its
 * light for no gain in the radial profile, and is gone.
 */
export const POPULATION_FIELD_POINT_SIZE_MIN = 0.5;
export const POPULATION_FIELD_POINT_SIZE_MAX = 0.76;

/**
 * Brightness is NOT a per-point rule, and this is the measurement that says so.
 *
 * It used to be one: alpha rode the same tissue weight as size, floored at
 * 0.8. Two falloffs on the same key, compounding — and the design's reasoning
 * for removing it was that the Cells stop dead at the resolved rim, so a
 * brightness taper deepens that step exactly where the halo should be taking
 * over. Measured, on the real placement and the real stage, at 1080p flux
 * (`size^2 * alpha`, each layer at its own Gaussian width), binned by
 * elliptical radius over 44 shells:
 *
 * ⚠️ **There is no step at the rim.** Perceptual lightness across it runs
 * 0.3560 -> 0.3557 -> 0.3500. The premise is measurably wrong, and so is the
 * reason given for it: by the time the Cells stop they carry **1.3%** of the
 * light there. Their share falls below half at radius 0.72 and below a tenth
 * by 0.93 — the halo has already taken over, smoothly, well inside the rim.
 *
 * What the profile actually has is a **corner**, at radius ~1.13: perceptual
 * lightness is flat to within 0.008 from radius 0.2 all the way out (dP per
 * shell between -0.001 and +0.008), and then falls at a steady -0.013. A
 * uniformly bright interior meeting a steady ramp is precisely "the middle is
 * very bright and the edge suddenly darkens", and the corner sits where the
 * halo's OWN placed density stops rising — the complement stops rejecting
 * points at the rim — not where the Cells end.
 *
 * ⚠️⚠️ **Brightness cannot fix that corner, and the trade curve is the proof.**
 * Solving a target profile and deriving the weight from it — the whole span of
 * shoulder-rounding curves, at every falloff and exponent — moves the worst
 * change in slope from 0.0107 to at best 0.0070 while giving up light, and the
 * solutions that scored better than that were cancelling per-shell sampling
 * noise with a wiggly weight rather than smoothing anything visible. The
 * authority simply is not there: this taper's whole range was [0.8, 1.0], and
 * the profile's shape is set by the placement's density and by size.
 *
 * So the solve's honest answer is a constant, and the layer takes it: alpha is
 * flat at the emission ceiling, and the tissue taper is carried by SIZE alone
 * — which still tapers flux by `(0.50/0.76)^2` = 0.433 from the dense tissue
 * to the open fringe, so the taper that closed the bimodality is entirely
 * intact. What changes is that the outer field stops paying for it twice:
 * **+11.4% light beyond the rim**, +7.0% overall.
 *
 * The corner is still there. It is a placement-density feature and it wants a
 * placement answer; see the report for what that would cost.
 */
/** Sprite size in world units for one taper weight. */
export function populationPointSizeForWeight(weight: number): number {
  const w = Math.max(0, Math.min(1, weight));
  return POPULATION_FIELD_POINT_SIZE_MIN
    + (POPULATION_FIELD_POINT_SIZE_MAX - POPULATION_FIELD_POINT_SIZE_MIN) * w;
}

/**
 * Gaussian width as a fraction of the sprite, against a Cell's 0.10.
 *
 * WIDER relative to its own sprite, which is what removes the hard bright
 * centre: a Cell concentrates its light into a peak that reads as a core, and
 * this spends the same light over most of the footprint so it reads as a
 * speck. It also keeps the sprite from collapsing to a single lit fragment
 * when the camera pulls back.
 */
export const POPULATION_FIELD_SIGMA = 0.16;

/**
 * The layer's brightness ceiling, reached only at an amount curve of 1.
 *
 * The blend below is a bounded accumulation whose fixed point is the emitted
 * alpha itself, so this number IS the brightness a fully saturated patch of
 * halo converges to — a hard ceiling that no amount of overlap can pass.
 * Cell bodies emit up to ~1.18 and converge to white; the halo cannot, at any
 * density, on any profile. "Peak under a Cell core" is therefore a property of
 * the blend rather than a value someone dialled in.
 *
 * See {@link populationEmissionForGain} for what the measured profiles reach:
 * 0.39 at retained scope, 0.72 at mainnet chain scope, 0.90 at testnet. The
 * ceiling itself needs a ratio past 4,000 unresolved per resolved Cell, which
 * no profile we run comes near.
 *
 * This is the one level knob. If the layer needs to be brighter or dimmer
 * after a live look, it is the number to move.
 */
export const POPULATION_FIELD_EMISSION = 0.95;

/**
 * Smallest sprite the layer will draw, in CSS pixels before DPR.
 *
 * A point cannot render smaller than a fragment, so below this the footprint
 * is clamped and the light the clamp added is given back — energy conserved,
 * with the field dimming as it should instead of flickering as the sprite
 * crosses the pixel grid. Binds only when the camera pulls far back; at the
 * production camera the sprite is roughly four device pixels.
 */
export const POPULATION_FIELD_MIN_POINT_PX = 1.4;

/**
 * Largest sprite the layer will draw, in CSS pixels before DPR — the other end
 * of the same clamp, in the same unit, so the pair reads as one bound.
 *
 * The footprint law is `size * 2 * (viewportHeight / 2) / viewDistance` and
 * nothing in it is bounded from above: a point the camera passes CLOSE to
 * rasterizes without limit. That is not a hypothetical pose — the layer is
 * `frustumCulled = false` by construction (105K points, one static draw), and
 * `CONSENSUS_ROUTE_CAMERA_DISTANCE` stands the camera 36 world units off a
 * route centroid and flies it through the slab the halo occupies. At 1080p a
 * max-weight point is 22.8 CSS px at that standoff, 46 at 18 units, and 456 at
 * 1.8 — one point, one blended Gaussian quad, a fifth of the frame's height.
 *
 * 48 CSS px is twice the standoff footprint: points legitimately nearer than
 * the camera's own distance keep growing, and the ones it is passing THROUGH
 * stop. The energy term is unaffected either way — it corrects a sprite the
 * MINIMUM had to widen, and `min(1, shrink * shrink)` already saturates when
 * the drawn footprint is the smaller of the two.
 *
 * ⚠️ A ceiling on the halo cannot cross the class boundary it is separated by:
 * the bodies are drawn by `cellHybridMaterial` under no such clamp, so the
 * "always smaller than the smallest addressable Cell" invariant is tightened
 * here, never loosened.
 */
export const POPULATION_FIELD_MAX_POINT_PX = 48;

/**
 * The BEADS' body hue, at full saturation — one emitted colour per class, and
 * the palette's own.
 *
 * This is `tissueRose` because that is literally what an addressable Cell
 * emits: `consensusCellColor` hands every untagged Cell exactly this triple,
 * and mainnet has almost no tagged ones. The halo therefore emits the Cells'
 * own body colour and lets density do the rest — which is the whole of the
 * rule, and the reason there is nothing to tune here.
 *
 * ⚠️ It was a two-endpoint ramp, keyed on the taper weight, and that is what
 * live review saw as "why is the mixed band so grey-white". The mechanism is
 * worth keeping: **bounded-screen accumulation eats chroma**, because the
 * blend's fixed point is the emitted alpha in EVERY channel, so overlapping
 * marks converge toward neutral. The ramp's lit endpoint was solved to be
 * chromatically indistinguishable from a Cell — measured as a RENDERED target,
 * then applied as an EMITTED colour. But a Cell's pale magenta is not what a
 * Cell emits; it is what thousands of overlapping sprites accumulate to. The
 * halo emitted the already-accumulated answer and then accumulated it again,
 * and it assigned that pale endpoint exactly where placed density peaks
 * (r≈1.05) and overlap is greatest. Measured, the lit endpoint desaturated
 * after 7 overlapping sprites against the dim end's 20.
 *
 * The ramp existed to stop "rose scaled toward black" reading as brick, which
 * was real while alpha varied across the layer. It does not vary any more —
 * see {@link populationPointSizeForWeight} — so density is the only thing that
 * changes across the layer, and accumulation turns density into paleness for
 * free. A ramp is a second mechanism doing that same job, and it overshot it.
 *
 * Measured at 1080p on the production camera, over the real placement and the
 * real stage, light-weighted OKLCh, halo drawn alone and binned by elliptical
 * radius. The mixed band is 0.95–1.15, where the Cells and the halo interleave:
 *
 * | band | Cells `C/L` | ramp `C/L` | this `C/L` |
 * |---|---:|---:|---:|
 * | pre-rim 0.70–0.95 | 0.1171 | 0.1095 | 0.1519 |
 * | **mixed 0.95–1.15** | **0.1276** | **0.1043** | **0.1348** |
 * | outer 1.15–1.80 | 0.1256 | 0.1785 | 0.1628 |
 * | fringe 1.80–2.20 | — | 0.2679 | 0.1944 |
 *
 * The ramp put the layer's chroma MINIMUM in the mixed band at the same time
 * as its lightness MAXIMUM (L 0.4051, the brightest band it has), which is the
 * definition of grey-white. One emitted colour lifts that band's chroma 29%,
 * to within 5.7% of what the Cells themselves render there, and the band stops
 * being the layer's minimum at all.
 *
 * ⚠️ The ramp's saturated end, `(1.00, 0.23, 0.33)`, was the obvious candidate
 * and it is measurably wrong: it renders the mixed band at `C/L` 0.2302,
 * **1.80x** the Cells. It carried the same frame-of-reference error in the
 * other direction — solved against a THIN-halo rendered target, so applied at
 * full overlap it keeps far more chroma than it was ever asked for.
 *
 * ⚠️ The chroma-per-luminance INVERSION the ramp was built to fix did NOT
 * return once alpha went flat. Binned by the layer's own rendered lightness,
 * dim end to bright end, `C/L` runs 0.188 → 0.109 — falling, the Cells' own
 * direction (0.119 → 0.109) — and the bright end now lands on the Cells' bright
 * end exactly, where the ramp overshot it to 0.091.
 *
 * And it does not go brick, which is a hue fact rather than a taste one. Brick
 * is rose drifting toward ember (hue 45.4) or warm white (71.1); accumulation
 * drifts this the other way, because `b` > `g` in the emitted triple means blue
 * converges faster than green. Rendered hue runs 14.07 → 16.59 outward against
 * the emitted 19.29 — magenta-ward in every band, never orange-ward — while
 * chroma RISES outward as the layer thins. The outer field is the most
 * saturated part of the layer, not the least.
 *
 * Identity hue — asset, lock, tag — stays forbidden: we know nothing about
 * these Cells individually, and a tagged Cell's accent is exactly the identity
 * claim this layer cannot make. The Cells' own live warmth bias is not carried
 * either; it is a tunable knob on their material, and a copy of its default
 * baked in here would be a seam waiting for someone to move it.
 *
 * ⚠️ **Since 2026-08-20 this is the BEAD class's colour and not the whole
 * layer's**: the strokes emit {@link POPULATION_STROKE_COLOR}. Everything
 * above survives that split, because neither thing this rule killed is what
 * the split does. It killed a SPATIAL two-endpoint ramp keyed on the taper
 * weight — the grey-white mixed band — and it forbids identity hue; a stroke
 * class beside a bead class is neither a ramp nor a claim about any individual
 * Cell, and the reasoning for both bans is untouched. What the split adopts is
 * the core fabric's own grammar, vessels through tissue, in which THIS
 * constant is the tissue: the beads still emit exactly what an addressable
 * Cell emits, which is the whole of what this doc asserts. One colour per
 * class, and no ramp inside either.
 */
export const POPULATION_FIELD_COLOR: SceneColor = CELL_GALAXY_PALETTE.tissueRose;

/** A palette hue at this layer's own red ceiling — same chromaticity, red
 *  pinned to the 1.0 the halo already emits. `veinCrimson` (0.48, 0.06, 0.16)
 *  comes back as (1, 0.125, 0.3333). See {@link POPULATION_STROKE_COLOR} for
 *  why the level is SET here rather than luma-matched as `bridgeSymbolicDim`
 *  sets its own: at this family's chromaticity a luma match to `tissueRose`
 *  wants r = 1.49, and the layer may not emit past 1. */
function atRedCeiling(color: SceneColor): SceneColor {
  return [1, color[1] / color[0], color[2] / color[0]];
}

/**
 * The STROKES' hue — the hairlines and the backbone, one colour for both, and
 * deliberately not the beads'.
 *
 * ## The verdict, which was two complaints with one cause
 *
 * Live review at 4K, `devicePixelRatio` 1, on `539cd41`: *the terminal and
 * secondary nerves still do not read at the operating camera* — with the width
 * class already promoting them to 1.4 device px — and *the whole cell mesh has
 * gone pale, it has lost the deep crimson*.
 *
 * They are the same fact. Strokes and beads emitted the SAME `tissueRose`, so
 * every pixel of added width was pink laid over pink and there was no NERVE
 * percept to gain: the percept this scene has already established for a nerve
 * is the core fabric's — dark vein vessels threading luminous rose tissue — and
 * it is a HUE contrast, not a brightness one. Meanwhile the spends that chased
 * the missing read ({@link POPULATION_FIBRE_ALPHA} 0.70 → 0.80 for +31% per
 * deposit, over +10% more segments, some at 1.4x width) all went into a colour
 * whose G and B are high, and high G/B is exactly what a bounded accumulation
 * converges toward white. The wash IS the failed visibility spend, so the fix
 * gives the light back and buys the read with hue instead.
 *
 * ## Why THIS colour
 *
 * Swept on the CPU proxies this file's tests already use — Rec. 709 luma, and
 * chroma as `r - (g + b) / 2`. "Fringe C/L" is one isolated deposit against
 * black in the outermost band (taper p50 0.446, emission 0.72 at mainnet chain
 * scope, alpha 0.70), which is the regime the visibility complaint lives in:
 *
 * | candidate | emitted | luma | vs rose | C | C/L | fringe C | fringe L |
 * |---|---|---:|---:|---:|---:|---:|---:|
 * | `tissueRose` (control) | 1.000, 0.400, 0.440 | 0.5304 | 1.000 | 0.580 | 1.093 | 0.0293 | 0.0268 |
 * | `veinRose`, raw | 0.720, 0.120, 0.240 | 0.2562 | 0.483 | 0.540 | 2.108 | 0.0273 | 0.0129 |
 * | `veinRose` at r=1 | 1.000, 0.167, 0.333 | 0.3559 | 0.671 | 0.750 | 2.108 | 0.0379 | 0.0180 |
 * | fabric's drawn vein at r=1 | 1.000, 0.135, 0.333 | 0.3332 | 0.628 | 0.766 | 2.299 | 0.0387 | 0.0168 |
 * | **`veinCrimson` at r=1 — this** | 1.000, 0.125, 0.333 | 0.3261 | 0.615 | 0.771 | 2.364 | 0.0389 | 0.0165 |
 * | `veinCrimson`, raw | 0.480, 0.060, 0.160 | 0.1565 | 0.295 | 0.370 | 2.364 | 0.0187 | 0.0079 |
 *
 * The shipped stroke, for the same deposit at alpha 0.80, renders C 0.0383 and
 * L 0.0350.
 *
 * ⭐ **The red ceiling is what makes a deep hue affordable, and the sweep is
 * where that stops being an opinion.** Scaling a palette colour down moves
 * luma and chroma together — `veinCrimson` raw keeps 23% of the fringe deposit
 * L and only 49% of its C, so a fringe stroke drawn in it gives up the
 * chromatic signal as well as the achromatic one, and a too-dark stroke
 * against black undoes the width win. Lifting the same chromaticity to r = 1
 * gives up the achromatic half ALONE: at the fringe this emits **C 0.0389
 * against the shipped 0.0383 (+1.6%)** at **47% of the luma**, which is the
 * whole trade stated in one row. Multiply by the widths and the acceptance
 * arithmetic comes out the right way: a promoted fringe strand carries
 * `1.6 x 0.0389` = 0.0622 of chromatic flux against `1.4 x 0.0383` = 0.0536
 * shipped, **+16%**, while its luma flux falls 46%. The mark gets wider and
 * more coloured, and dimmer. That is the round's whole thesis in three
 * numbers.
 *
 * Among the r = 1 candidates the fringe deposit is identical in RED by
 * construction, so the pick is simply the deepest: `veinCrimson`'s own
 * chromaticity, C/L 2.364 against the beads' 1.093. It is also the palette's,
 * which keeps "one colour per class, and the palette's own" literally true —
 * and it lands a hair under the vein the core fabric actually draws
 * (`consensusRouteColors` runs g/r 0.130–0.139 against this 0.125, with b/r
 * exactly 1/3 in both), which is the grammar being adopted.
 *
 * ## What accumulation does to it — the second complaint's own measurement
 *
 * The blend's fixed point is the emitted alpha in every channel, but the RATE
 * per deposit is `1 - tint * a`, so a channel the tint leaves near zero barely
 * moves. Rendered result of N stroke deposits at the recorded per-pixel
 * deposit counts (5.85 in the mixed band, 4.27 outside the rim, ~1 in the
 * isolated-deposit fringe) — shipped, then the alpha revert ALONE, then both
 * moves, so the two are separable:
 *
 * | band (N) | shipped, rose at 0.80 | alpha revert only | this |
 * |---|---|---|---|
 * | mixed 0.95–1.15 (5.85) | .3513 .2304 .2447 · L .2571 · C/L 0.442 | .2963 .1843 .1966 · L .2090 · C/L 0.506 | .2963 .0715 .1618 · L .1258 · **C/L 1.428** |
 * | outer 1.15–1.40 (4.27) | .2434 .1321 .1424 · L .1565 · C/L 0.678 | .1985 .1038 .1121 · L .1245 · C/L 0.727 | .1985 .0367 .0891 · L .0749 · **C/L 1.811** |
 * | outer 1.40–1.55 (4.27) | .1978 .1033 .1117 · L .1240 · C/L 0.728 | .1600 .0809 .0876 · L .0982 · C/L 0.771 | .1600 .0282 .0692 · L .0592 · **C/L 1.882** |
 * | fringe >= 1.55 (1) | .0660 .0264 .0290 · L .0350 · C/L 1.093 | .0505 .0202 .0222 · L .0268 · C/L 1.093 | .0505 .0063 .0168 · L .0165 · **C/L 2.364** |
 *
 * ⚠️ **The middle column is why the alpha revert is not the fix.** Giving the
 * light back moves every channel by the same factor, so the mixed band comes
 * down a fifth and stays exactly as grey-rose as it was — C/L 0.442 to 0.506
 * against an emitted 1.093. The channel RATIO is a property of the tint, and
 * only a tint can move it.
 *
 * ⭐ The hue change then costs the mixed band's RED nothing — 0.2963 in both
 * of the last two columns, because both classes emit r = 1 and red converges
 * at the same rate — and takes G and B out: −61% and −18% against the
 * reverted control, −69% and −34% against the shipped build. The band stops
 * accumulating toward white and accumulates toward deep red instead, which is
 * the entire content of *it has lost the deep crimson*, and it hands light
 * back rather than spending any.
 *
 * ⚠️ Those deposit counts are placement-era, as
 * {@link populationFibreTaper} records — a proxy for the shape of the effect
 * and not a rendered measurement. The live look is still the arbiter.
 *
 * ## What this is not
 *
 * Not a ramp: one flat colour for the whole stroke class, exactly as
 * {@link POPULATION_FIELD_COLOR} is for the whole bead class. The desaturation
 * trap that killed the halo's own two-endpoint ramp (`cab0d7b`) needed a
 * colour that VARIED across the field; a second class does not vary anything.
 * Not an identity hue: it says nothing about any individual, it is the same
 * vessel colour on every stroke in the layer. And `b` > `g` holds here as it
 * does for the beads (0.333 against 0.125), so blue still converges faster
 * than green and the rendered hue drifts magenta-ward under overlap — never
 * toward brick.
 */
export const POPULATION_STROKE_COLOR: SceneColor =
  atRedCeiling(CELL_GALAXY_PALETTE.veinCrimson);

/**
 * The emitted alpha for one amount-curve `gain`.
 *
 * The amount curve says `gain` scales how much of the swarm is LIT, and the
 * blend below squares the emitted alpha for an isolated point — a point
 * contributes `colour * a * a` and only a saturated patch converges to `a`
 * itself. Feeding `gain` straight into `a` therefore made rendered light go as
 * roughly the SQUARE of the amount, which collapses the low end: measured at
 * the production camera, retained scope (gain 0.17) lit 485 of the field's
 * 7,900 cells and landed at a mean luminance of 0.006 — indistinguishable
 * from absence, which the design names as its default failure.
 *
 * The square root undoes the blend's square, so light tracks the amount curve
 * instead of its square. The same measurement then gives 5,343 cells and
 * 0.017 for retained, 0.046 for mainnet chain scope, and 0.065 for testnet —
 * a visible field at every provable scope, with the profile difference the
 * curve exists to carry still intact.
 *
 * The ceiling is unmoved: `gain` is bounded by 1, so this is bounded by
 * {@link POPULATION_FIELD_EMISSION} times the radiance.
 *
 * ⟨ruling 22⟩ `radiance` is the galaxy's own gain — one number for the tissue
 * and its halo, read from `galaxyRadianceGain` so the two materials cannot
 * drift apart. It reaches the layer HERE, on the emission, rather than through
 * a fourth uniform: all three of this layer's passes take their level from
 * these two functions, so one multiply is the whole layer. Its default is the
 * identity and this line is then exactly what it was.
 */
export function populationEmissionForGain(
  gain: number,
  radiance: number = GALAXY_RADIANCE_IDENTITY,
): number {
  if (!Number.isFinite(gain) || gain <= 0) return 0;
  return Math.sqrt(Math.min(1, gain))
    * POPULATION_FIELD_EMISSION
    * galaxyRadianceGain(radiance);
}

/** Sprite footprint in drawing-buffer pixels, before the minimum is applied.
 *  The Cells' own law, on the Cells' own constant, so the halo and the bodies
 *  shrink with distance at exactly the same rate. */
export function populationPointFootprint(
  size: number,
  deviceViewportHeight: number,
  viewDistance: number,
): number {
  return size
    * HYBRID_BASE_PX_PER_WU
    * (deviceViewportHeight * 0.5 / Math.max(viewDistance, 0.001));
}

/** The footprint as drawn: the wanted one held between the two clamps, both
 *  stated in CSS pixels and both taken to device pixels by the same DPR. */
export function populationPointDrawn(
  wantedPx: number,
  pixelRatio: number,
): number {
  const dpr = Math.max(pixelRatio, 0.001);
  return Math.min(
    Math.max(wantedPx, POPULATION_FIELD_MIN_POINT_PX * dpr),
    POPULATION_FIELD_MAX_POINT_PX * dpr,
  );
}

/** Energy correction for a sprite the minimum footprint had to widen.
 *  Area scales as the square, so the light does too. */
export function populationPointEnergy(
  wantedPx: number,
  drawnPx: number,
): number {
  const shrink = wantedPx / Math.max(drawnPx, 1e-6);
  return Math.min(1, shrink * shrink);
}

/**
 * The halo fibre's alpha, as a share of the point emission.
 *
 * The fibres are not extra light so much as REDISTRIBUTED light, and the
 * measurement that set this is the only one that matters: at the production
 * camera, adding them raises the halo's orientation coherence — the
 * structure-tensor measure that separates a drawn thread from isotropic noise
 * — from 0.183 to 0.333, against a Poisson floor of 0.184. The shipped
 * independent-point build sat AT that floor: its points, however carefully
 * weighted onto the fibre corridors, carried no more orientation than a random
 * spray, which is exactly the "reads as spray, not tissue" the layer failed on.
 * Placing the points on filaments and NOT drawing the fibres measures 0.184 —
 * the floor exactly. The strokes are the whole of the effect.
 *
 * The cost is +6.7% total light and no change in covered area (27.4% of the
 * frame against the previous build's 27.3%), because the point count came down
 * from 260,000 to 105,000 to pay for it.
 *
 * Under a Cell's core by construction, since it is a fraction of a point
 * emission that is itself bounded by {@link POPULATION_FIELD_EMISSION}. This
 * is the knob the live look moves. The sweep that priced it, measured against
 * the 0.70 build and kept here for future movement: 0.60 gives coherence 0.292
 * at −7% light, and 0.80 — where it now sits — 0.369 at +21%.
 *
 * ⭐ **SPENT 0.70 → 0.80 on 2026-08-20**, on the verdict
 * {@link populationFibreTaper} reserved it for. Live review, mainnet chain
 * scope at quality high: *the outermost halo band reads as dots with no
 * visible nerves.* Both primitives are there and only one crosses the eye's
 * threshold, for a reason that is entirely in the arithmetic:
 *
 *  - The fringe is **single-deposit land**. The bounded-screen blend below
 *    converges to `a` only where marks pile up; one ISOLATED deposit lays down
 *    `a * a`. The mixed band gets 4–6 deposits on the average covered pixel
 *    and rides the convergent part of that curve — the outermost band has
 *    almost no crossings and stays on the squared part.
 *  - The bead beside it concentrates the SAME `a` into a ~2 px Gaussian with a
 *    1.4 px minimum clamp ({@link POPULATION_FIELD_MIN_POINT_PX}), roughly
 *    5–8x the stroke's per-pixel intensity. So the points clear the threshold
 *    out there and the hairlines do not. The strand segments render; they
 *    render sub-threshold.
 *
 * Raising this is the one lever that reaches that regime, because in the
 * squared part rendered light goes as `a^2`: `0.8^2 / 0.7^2` = **+30.6%** on
 * an isolated deposit, against +14.3% on a saturated patch. It buys the most
 * exactly where the complaint is. The taper stays untouched — one lever at a
 * time, and the taper is what made the boundary a fringe rather than a hem.
 *
 * ⚠️ The fringe pays the taper on top of this, and on the CURRENT placement it
 * pays nearly all of it — see {@link populationFibreTaper}, where the
 * post-P3/P4 numbers are recorded.
 *
 * ⭐ **RETURNED 0.80 → 0.70 on 2026-08-20, hours later, and both halves of
 * the trail are kept because they are one story.** The raise was a stopgap for
 * a WIDTH problem. The fringe reads by MARK SIZE, `gl.LINES` carried no DPR
 * compensation, and `a^2` was the only lever that reached the isolated-deposit
 * regime while that was true. It is no longer true:
 * {@link POPULATION_BACKBONE_WIDTH_PX} now owns width, in a unit that survives
 * a change of display. So the stopgap is paying for nothing — and it was never
 * free. Per-deposit alpha is exactly the currency chroma retention is a
 * function of, and the second half of the same live verdict was *the whole
 * cell mesh has gone pale, it has lost the deep crimson*. This constant is one
 * of the two spends that produced that wash. The other was spending it in
 * `tissueRose`, whose high G and B are what a bounded accumulation converges
 * toward white — see {@link POPULATION_STROKE_COLOR}, which is the half of the
 * fix that costs no light at all.
 *
 * ⭐ **SPENT AGAIN, 0.70 → 0.80 on 2026-08-20, and the whole trail is kept
 * because the four moves are one argument and not a loop.** The fourth live
 * verdict is milder than the three before it and asks for something different:
 * the terminal nerves are *visible now, but hard to see CLEARLY*. Not absent —
 * under-resolved. Two of the three answers to that are geometry and land
 * beside this one ({@link POPULATION_BACKBONE_WIDTH_PX} 1.6 → 1.8,
 * `POPULATION_BACKBONE_BUDGET` 16,000 → 20,000); the third is level, and this
 * is the only constant that moves it for the whole class at once.
 *
 * ⚠️ **The number is the one the stopgap used. The reason is not.** In August's
 * second round 0.80 was a `tissueRose` alpha, spent to buy WIDTH it cannot buy,
 * in a tint whose high G and B are what a bounded accumulation converges toward
 * white — it produced the pale mesh the verdict then complained about. Every
 * one of those conditions has since been removed: the strokes emit
 * {@link POPULATION_STROKE_COLOR}, whose G and B are 0.125 and 0.333 of its
 * red, so the same alpha deposits toward deep red instead of toward white;
 * width has its own DPR-aware class; and the sparse end has
 * {@link POPULATION_STROKE_TAPER_FLOOR}. What is being bought is no longer a
 * substitute for any of them.
 *
 * And the cost is now MEASURED rather than feared. Rasterizing the real
 * placement at the production camera into the 3840x2160 buffer the verdicts
 * come from, at the geometry this round ships (1.8 px over a 20,000-segment
 * backbone), mean over each band's covered pixels:
 *
 * | alpha | fringe isolated deposit L | mixed dL | mixed C/L | vs 497c54d |
 * |---:|---:|---:|---:|---:|
 * | 0.70 (497c54d) | 0.0471 | — | 1.948 | — |
 * | 0.70 (this geometry) | 0.0471 | +1.2% | 1.926 | −1.1% |
 * | 0.75 | 0.0540 | +14.4% | 1.900 | −2.5% |
 * | **0.80** | **0.0615** | +28.3% | **1.874** | **−3.8%** |
 * | 0.85 | 0.0694 | +42.7% | 1.849 | −5.1% |
 *
 * The bar was the highest rung holding the just-accepted mixed band's
 * chroma-per-luma within about 5% of what the colour verdict was pronounced
 * on. 0.85 leaves it; 0.80 is the last rung inside, and it is also the first
 * that carries the fringe's isolated deposit to the 0.06 the read wants —
 * 0.75 reaches 0.054 and stops short. ⭐ The reason the chroma survives a
 * +28% level lift at all is the P9 measurement: this panel puts ~2 deposits on
 * the average covered pixel, not the six the retention tables were written
 * against at 1080p, and two deposits is still the squared part of the blend.
 * At six the same lift costs 9%. **The old fear was correct for the old
 * instrument's regime and this display is not in it.**
 *
 * It is deliberately NOT small relative to a point. "No endpoint emphasis of
 * any kind" is a requirement, and a faint connector between bright beads is
 * precisely a node with edges radiating from it. At this ratio the stroke is
 * the figure and the points are grain along it — and raising it moves the
 * stroke further toward the figure, never the other way.
 */
export const POPULATION_FIBRE_ALPHA = 0.8;

/**
 * The fibre's share of the tissue taper, and why a stroke needs one at all.
 *
 * ⚠️⚠️ The fibres shipped with **no varyings of any kind** — one flat alpha
 * everywhere, on the reasoning that the tint is one colour and there was
 * nothing left along a segment to vary. That reasoning covered the taper's
 * COLOUR job and missed its other one. The points fade into the open fringe
 * because their footprint shrinks: flux goes as `size^2`, so the fringe pays
 * `(0.50/0.76)^2` = 0.433. A one-pixel line has no width to shrink, so the
 * strokes drew at full alpha right out to the last segment and then stopped.
 *
 * Two live-review complaints came out of that single fact, measured at the
 * production camera on the real placement, points and fibres separated:
 *
 *  - **"the edge looks clipped, too regular"** — the layer's outer boundary is
 *    drawn almost entirely by strokes (in the band outside the resolved rim
 *    the fibres carry lightness 0.218 against the points' 0.148), and they end
 *    at full brightness. A trimmed mat, not a fringe.
 *  - **"the outer field still reads grey-white"** — bounded-screen
 *    accumulation converges to the emitted alpha in every channel, so chroma
 *    survives only while few marks overlap. Chroma retention (rendered chroma
 *    against the SAME tint at the SAME lightness, so lightness is divided out)
 *    peaks at three deposits and collapses after: 0.993, 0.910, **0.824**,
 *    0.755, 0.615 at six, 0.498 at eight. The average covered pixel takes
 *    5.85 fibre deposits in the mixed band and 4.27 outside the rim, so the
 *    layer sits on the far side of that peak — retention 0.657 in the mixed
 *    band and 0.772 outside, against **0.850 for the Cells in the same
 *    frame**. The points, measured alone, do not do this: their retention is
 *    flat across every band (0.148 C/L to 0.152, whatever the radius).
 *    Crossings are a fibre property and the points cannot produce one.
 *
 * So the fibre takes the SAME taper the point rides, in the only currency it
 * has. The scale is not free either: alpha is set to the point's own
 * FOOTPRINT-AREA falloff, `(size(w) / sizeMax)^2`, so the ratio of stroke to
 * bead is invariant along the whole taper. That is what "no endpoint emphasis
 * of any kind" actually requires — not a large constant, but a constant RATIO.
 * Tapering the alpha linearly in the weight instead would dim the stroke to
 * zero while the point still drew, which is a bead with a faint connector:
 * exactly the failure the flat alpha was defending against.
 *
 * Measured against the flat build: retention 0.700 -> 0.756 before the rim,
 * 0.657 -> 0.722 in the mixed band, 0.772 -> 0.857 outside it, for -11% of the
 * layer's light inside the rim and -24% outside it. The light it gives up is
 * the light that was making the boundary a cut — and it gives it up where the
 * cut was: binned into radial shells from the resolved rim outward, the
 * dimming deepens monotonically, 15% at the rim to 32% at the last lit shell.
 * That is a fringe rather than a hem.
 *
 * ⚠️ It does NOT fix the interior, and no per-segment alpha can: in dense
 * tissue the taper is 1 by construction. Retention there is bought only by
 * fewer crossings or a smaller per-deposit alpha, and the flat sweep prices
 * that separately — alpha 0.5 buys 0.737 in the mixed band for 13% of the
 * layer's light, 0.4 buys 0.779 for 19%. Left alone: this is the knob live
 * review should be given, not one to spend pre-emptively.
 *
 * ⭐ The two knobs compose, and the pairing was **0.8 with this taper**:
 * retention 0.729 / 0.691 / 0.838 — better than the flat build in every band —
 * while the layer's light comes back to −6% inside the rim instead of −11%,
 * and the fringe still fades 20%. It was carried as the answer if live review
 * reported the layer as dimmer rather than as rosier. **On 2026-08-20 it did**
 * (the outermost band read as beads with no thread), the pairing was spent —
 * and the SAME DAY the next look reported the layer as pale, which is the
 * warning attached to it coming true within hours. It buys light by spending
 * exactly the chroma this taper recovered, and the read it was bought for
 * never arrived, because the fringe's problem was the size of the mark and not
 * its intensity. {@link POPULATION_FIBRE_ALPHA} is back at 0.7, the width it
 * was standing in for now belongs to
 * {@link POPULATION_BACKBONE_WIDTH_PX}, and the read is bought in hue instead
 * ({@link POPULATION_STROKE_COLOR}) — which costs no per-deposit alpha at all,
 * so this taper's recovery is left intact.
 *
 * ⚠️ **Those retention and light figures are PLACEMENT-ERA.** They were
 * GPU-measured — OKLCh over rendered pixels at the production camera — on the
 * placement as it stood then, and the placement has since gained tissue-keyed
 * strand lengths, forks and joins (P3/P4). Deposit counts per pixel are a
 * placement property, and retention is a function of them, so all three
 * numbers are stale by an unknown amount. Nothing in the tree can re-derive
 * them: `docs/superpowers/measure/` holds placement-geometry instruments only
 * (contours, radial extent), and the material's own tests carry a linear
 * chroma proxy, not an OKLCh one. Both halves need pixels off a GPU. **The
 * live look is the arbiter now, not this table.**
 *
 * ⭐ The placement half of it IS cheap to redo headlessly, and was, on the
 * post-P3/P4 placement (105,000 points, 96,609 segments, 14,419 filaments,
 * 1,670 joins), binning segment midpoints by elliptical radius and evaluating
 * this taper — median, with p10/p90:
 *
 * | band | segments | taper p10/p50/p90 |
 * |---|---:|---|
 * | pre-rim 0.70–0.95 | 22,497 | 0.547 / **0.719** / 0.970 |
 * | mixed 0.95–1.15 | 32,308 | 0.523 / **0.652** / 0.845 |
 * | outer 1.15–1.40 | 28,208 | 0.465 / **0.535** / 0.666 |
 * | outer 1.40–1.55 | 5,527 | 0.442 / **0.467** / 0.560 |
 * | fringe 1.55–1.70 | 447 | 0.437 / **0.446** / 0.482 |
 *
 * Two things fall out that the old tables cannot tell you. **The 1.80–2.20
 * "fringe" band those tables measure no longer exists** — the outer edge came
 * in to `POPULATION_FIELD_OUTER_EDGE` (1.6), so the last lit shell is
 * now 1.55–1.70 and holds 447 segments. And **that shell sits essentially on
 * the taper's FLOOR**: `(sizeMin/sizeMax)^2` = `(0.50/0.76)^2` = 0.4328, and
 * its p10 measures 0.437. The stroke out there was already paying the deepest
 * discount the taper can charge, which is why it was the band that fell under
 * the threshold first and why it is the band the alpha raise most helps.
 *
 * ⭐ The general shape of the bug: a layer gained a second primitive, and the
 * taper that had been solved for the first one was never re-derived for it.
 *
 * ⭐⭐ **This is now the BEAD's law alone.** The stroke classes ride
 * {@link POPULATION_STROKE_TAPER_FLOOR} of it, and the constant-ratio rule
 * this doc argues for is deliberately broken in the sparse direction — see
 * that constant for the derivation and for why the failure mode the rule
 * guarded against cannot be produced by flooring the stroke side.
 */
export function populationFibreTaper(weight: number): number {
  const ratio = populationFibreSizeRatio(weight);
  return ratio * ratio;
}

/**
 * The taper's square ROOT — the point's size as a fraction of the largest.
 *
 * Split out because both stroke classes have to carry the taper across a
 * segment, and the interpolation only commutes with the square one way round.
 * `mix()` is linear, so interpolating the RATIO and squaring per fragment
 * gives exactly {@link populationFibreTaper} of the interpolated weight;
 * interpolating the square would give something else, dimmer in the middle of
 * every segment. The fibre shader has always done it this way — this is the
 * same number, named, so the capsule class cannot drift from it.
 */
export function populationFibreSizeRatio(weight: number): number {
  return populationPointSizeForWeight(weight)
    / POPULATION_FIELD_POINT_SIZE_MAX;
}

/**
 * The lower bound on the taper a STROKE may be charged — bead untouched.
 *
 * ## The verdict, and the one thing left in it
 *
 * Live review of `92ed58c` at 4K, `devicePixelRatio` 1: the colour is right
 * and *the fringe band still reads as scattered dots with no connections*.
 * Every previous round answered this in a different currency — alpha
 * (`a^2`, reverted), width ({@link POPULATION_BACKBONE_WIDTH_PX}, 1 -> 1.4 ->
 * 1.6 device px), hue ({@link POPULATION_STROKE_COLOR}) — and the strokes are
 * demonstrably drawn: a headless probe against the running build counted
 * 15,988 promoted segments over 531 strands at 1.6 px with the emission live.
 * The problem was never presence. It is LEVEL, and this is the only round that
 * says so in the only unit that was still holding it down.
 *
 * ⚠️ The width history above ends at 1.6 because that is where it stood when
 * this constant was derived; it is 1.8 over a 20,000-segment backbone now, and
 * the alpha is 0.80 again. Neither moves this floor — it is stated as a taper,
 * so it rides whatever level and width the class is drawn at — but the fringe
 * DEPOSIT numbers quoted below are at the 0.70 alpha of the day and read 1.31x
 * higher today. The `populationFieldMaterial` tests carry the current pair.
 *
 * The arithmetic of the complaint, at the emission the live build reports
 * (`backboneEmission` 0.5065, mainnet chain scope):
 *
 *   `L = luma(stroke tint) * (emission * taper)^2`
 *     = 0.3261 * (0.5065 * 0.446)^2 = **0.0166**
 *
 * A deep red at 0.017 on black, at 620 nm-ish where photopic sensitivity is
 * already ~0.4x its peak, is under the eye's threshold. And the taper it pays
 * is not a taper at all out there — {@link populationFibreTaper}'s own table
 * records the fringe sitting ON the size floor, p10 0.437 against the hard
 * minimum `(0.50/0.76)^2` = 0.4328. The stroke class is charged the layer's
 * deepest possible discount in the band that needs the most.
 *
 * ## Why a floor rather than a curve, and why it is not taste
 *
 * The alternative was a compensation curve — emitted level riding the inverse
 * of the expected deposit count, so it rises as the tissue thins. ⚠️ **That
 * premise was measured and it is false on this panel.** Rasterizing all 96,609
 * segments at the production camera ([110,108,110], fov 50) into the 3840x2160
 * buffer the verdicts come from and running the layer's own blend per pixel,
 * deposits on the average COVERED pixel are:
 *
 * | band | covered px | deposits/px |
 * |---|---:|---:|
 * | pre-rim 0.70–0.95 | 166,292 | 1.84 |
 * | mixed 0.95–1.15 | 216,394 | 1.98 |
 * | outer 1.15–1.40 | 228,354 | 1.61 |
 * | outer 1.40–1.55 | 49,755 | 1.43 |
 * | fringe 1.55–1.70 | 3,057 | 1.42 |
 *
 * ⚠️⚠️ **The whole layer is in the isolated-deposit regime at 4K, not just
 * the fringe.** The 5.85 / 4.27 / 1 counts the tables above quote were
 * measured at 1080p, where a 1-device-px stroke covers a quarter of the pixels
 * for the same geometry; at four times the pixel count the crossings per
 * covered pixel fall with them. So there is no regime DIFFERENCE across the
 * field for an inverse-deposit compensation to compensate: the whole available
 * lift is 1.98/1.42 = 1.39x, which reaches taper 0.62 in the fringe — short of
 * the target — while doing nothing for the two outer bands.
 *
 * ⭐ And among level maps that reach a given fringe level, a floor is the one
 * that disturbs the rest of the field LEAST, which is provable rather than
 * preferred. `max(t, F)` is the identity above `F`. Any monotone map hitting
 * the same fringe value must lift the middle too: a gamma `t^k` reaching 0.75
 * at the fringe needs `k` = 0.344 and drags the mixed band's median to 0.863,
 * against the floor's 0.750. A linear remap of `[0.4328, 1]` onto `[0.75, 1]`
 * puts it at 0.847. The floor wins both, and it wins them by construction.
 *
 * ## The sweep
 *
 * Fringe isolated deposit (band p50 taper 0.446), and the mixed band measured
 * by rasterizing the real placement and running the blend per pixel — `dL` and
 * `dC/L` are the mean over the band's covered pixels against `92ed58c`:
 *
 * | floor | fringe taper | fringe L | x today | mixed dL | mixed dC/L | layer alpha |
 * |---|---:|---:|---:|---:|---:|---:|
 * | none | 0.446 | 0.0166 | 1.00x | — | — | 1.000x |
 * | 0.60 | 0.600 | 0.0301 | 1.81x | +5.0% | −0.1% | 1.058x |
 * | 0.70 | 0.700 | 0.0410 | 2.46x | +17.9% | −0.8% | 1.152x |
 * | **0.75** | 0.750 | **0.0471** | **2.83x** | **+27.6%** | **−1.4%** | **1.210x** |
 * | 0.80 | 0.800 | 0.0535 | 3.22x | +39.1% | −2.2% | 1.274x |
 *
 * 0.60 does not clear the threshold argument at all. 0.70 lands the fringe at
 * 0.0410 and 2.46x — the bottom edge of the window and a miss on the
 * multiplier, and this verdict has already been answered three times and
 * returned three times. 0.80 overshoots the window and charges the mixed band
 * 39% for it. **0.75 is the only rung inside 0.04–0.05 on both counts.**
 *
 * ⭐ The chromaticity is untouched and the RENDERED chroma very nearly is:
 * C/L in the mixed band moves 1.976 -> 1.948, −1.4%, because at ~2 deposits
 * the blend is still on the squared part of its curve where chroma is
 * preserved. That is what makes a LEVEL round safe here at all — the anti-ramp
 * lesson (chroma collapse under accumulation, `cab0d7b`) bites at six deposits
 * and this panel does not have six. Not one channel ratio moves: both stroke
 * materials emit {@link POPULATION_STROKE_COLOR} unchanged.
 *
 * ⚠️ **This round DOES add light, and every round before it did not.** The
 * layer's mean stroke taper goes 0.6396 -> 0.7740 (1.210x alpha, 1.403x
 * rendered flux at one deposit). Against `539cd41` — the build before the hue
 * change, which the last round measured the class at 0.484x of — the stroke
 * class now emits **0.679x** its luminous flux. Deeper and dimmer than the
 * build that failed, and no longer under the threshold.
 *
 * ## The doctrine this breaks, stated in full
 *
 * {@link populationFibreTaper} argues for a constant stroke:bead RATIO: "not a
 * large constant, but a constant RATIO", because a stroke that tapers to
 * nothing while its bead still draws is a node with edges radiating from it,
 * which the layer forbids. {@link POPULATION_END_TAPER} states the same rule
 * from the placement side, and forbids any fibre-only end treatment on top of
 * it.
 *
 * ⭐⭐ **That rule is broken here, in the sparse direction only, and the
 * failure mode it names cannot be produced by breaking it that way.** The rule
 * exists to stop `bead > stroke`. Flooring the STROKE side can only ever move
 * the ratio the other way: `strokeTaper(w) / beadTaper(w)` is 1 above the
 * floor and rises monotonically to 1.733 as `w` falls to zero. Strokes now run
 * relatively BRIGHTER than their beads where the tissue is thin — which is not
 * a weakening of the law but a restoration of the one it was derived from, the
 * placement's own: *the stroke is the figure and the points are grain along
 * it* ({@link POPULATION_FIBRE_ALPHA}). The fringe had inverted that law, and
 * the ratio rule is exactly what let it: charging beads and strokes the same
 * discount in a regime where the bead concentrates its light into a clamped
 * ~2 px Gaussian and the stroke spreads it along a 1–1.6 px line hands the
 * bead the visible mark and the stroke nothing.
 *
 * ## The end taper, measured rather than assumed
 *
 * {@link POPULATION_END_TAPER} fades a strand's last three points by scaling
 * the SHARED weight, and this floor binds the size-RATIO term the weight
 * reaches the stroke through — so the question is which of the two dominates.
 * Differencing two full placements (the real one against one with the array
 * neutralised) names every faded point in the layer and its own unfaded
 * weight. Fade depth is the tip's taper over its unfaded taper; 1.000 is a
 * fade that no longer exists:
 *
 * | band | tips | share of points | depth now | at 0.75 |
 * |---|---:|---:|---:|---:|
 * | interior < 0.70 | 6,752 | 66.7% | 0.748 | **0.896** |
 * | pre-rim 0.70–0.95 | 11,028 | 43.6% | 0.745 | **0.898** |
 * | mixed 0.95–1.15 | 9,706 | 28.7% | 0.814 | 0.965 |
 * | outer 1.15–1.40 | 9,376 | 32.0% | 0.895 | 0.998 |
 * | outer 1.40–1.55 | 2,995 | 50.5% | 0.955 | 1.000 |
 * | fringe 1.55–1.70 | 405 | 74.9% | 0.978 | 1.000 |
 *
 * ⭐ **The weight term dominates exactly where the fade was ever visible, and
 * the floor dominates only where it was not.** A tip keeps its fade while its
 * own strand body sits above the floor — `w` > 0.608 — which is the interior
 * and the pre-rim band, where two thirds and four tenths of all points are
 * inside a fade and where the fade survives at 0.90 depth against 0.75. In the
 * outer field the fade dies, and it was already dead: 0.955 and 0.978 are
 * 4.5% and 2.2% steps, and {@link POPULATION_END_TAPER} predicted this in
 * words before it was measured — *in the open fringe, where the weight is
 * already low, the tip barely moves at all*, because the SIZE floor bounded it
 * long before this one did. Endings still fade. They fade where an ending is
 * something you can see.
 *
 * ⚠️ The alternative the sweep considered and rejected — flooring BEFORE the
 * end-taper multiplication, so a tip fades from the floor rather than to it —
 * is not available without a fibre-only end treatment, and
 * {@link POPULATION_END_TAPER} forbids one in as many words. The fade is baked
 * into the shared weight at placement precisely so no draw can treat an end on
 * its own, and recovering the base weight from the faded one is not possible
 * downstream of that.
 */
export const POPULATION_STROKE_TAPER_FLOOR = 0.75;

/** The floor in the unit the shaders interpolate in. Both stroke classes read
 *  it from here — the hairline's vertex stage bakes this exact literal, the
 *  capsule's instance data calls the function below — so there is one number
 *  and no drift is expressible. */
const STROKE_TAPER_FLOOR_RATIO = Math.sqrt(POPULATION_STROKE_TAPER_FLOOR);

/**
 * The size ratio a STROKE draws at: {@link populationFibreSizeRatio}, floored.
 *
 * Applied to the ratio rather than to its square because that is the unit
 * every stroke in this layer interpolates in, and `max(r, sqrt(F))^2` is
 * `max(r^2, F)` exactly — the floor commutes with the square, so flooring
 * here is flooring the taper and there is no second law to keep in step.
 */
export function populationStrokeSizeRatio(weight: number): number {
  return Math.max(populationFibreSizeRatio(weight), STROKE_TAPER_FLOOR_RATIO);
}

/** {@link populationFibreTaper} for a stroke — the bead's law with
 *  {@link POPULATION_STROKE_TAPER_FLOOR} under it. */
export function populationStrokeTaper(weight: number): number {
  const ratio = populationStrokeSizeRatio(weight);
  return ratio * ratio;
}

/** The fibre's emitted alpha for one amount-curve `gain`. The same curve the
 *  points ride — and ⟨ruling 22⟩ the same radiance, for the same reason: the
 *  beads and the strands they run between are one layer, and a gain on half of
 *  it would be a second claim about how bright the halo is. */
export function populationFibreEmissionForGain(
  gain: number,
  radiance: number = GALAXY_RADIANCE_IDENTITY,
): number {
  return populationEmissionForGain(gain, radiance) * POPULATION_FIBRE_ALPHA;
}

export interface PopulationPointUniforms {
  /** Drawing-buffer height, not CSS height — WebGL point size is measured in
   *  drawing-buffer pixels. */
  uViewportHeight: { value: number };
  uPixelRatio: { value: number };
  uSizeMin: { value: number };
  uSizeMax: { value: number };
  uMinPointPx: { value: number };
  /** {@link populationEmissionForGain} of the amount curve. Zero means the
   *  stage covers its scope and there is nothing unresolved to state. */
  uEmission: { value: number };
  /** ⟨D-10 · knob c⟩ How much of the far half's light the depth term spends.
   *  0 is today's picture — see `BODY_DEPTH_ENERGY_GLSL`, which the Cell
   *  bodies read from the same place so the two answer to one law. */
  uDepthEnergy: { value: number };
  /** The body hue, at full saturation. One colour, never an identity palette,
   *  and never a function of the taper — density is what varies it on screen. */
  uColor: { value: THREE.Color };
}

export function makePopulationPointMaterial(): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uViewportHeight: { value: 800 },
      uPixelRatio: { value: 1 },
      uSizeMin: { value: POPULATION_FIELD_POINT_SIZE_MIN },
      uSizeMax: { value: POPULATION_FIELD_POINT_SIZE_MAX },
      uMinPointPx: { value: POPULATION_FIELD_MIN_POINT_PX },
      uMaxPointPx: { value: POPULATION_FIELD_MAX_POINT_PX },
      uEmission: { value: 0 },
      uDepthEnergy: { value: 0 },
      uColor: { value: new THREE.Color(...POPULATION_FIELD_COLOR) },
    },
    transparent: true,
    depthWrite: false,
    // Byte-for-byte the Cell bodies' blend. Bounded screen accumulation: the
    // layer EMITS and never covers, so a pixel with no unresolved population
    // receives exactly zero and empty space stays true black. Alpha-over at
    // any tint or opacity lifts the black across the envelope, which is the
    // optical signature of atmosphere between the viewer and the subject —
    // that single choice is enough to destroy the scene, and it has been made
    // once already.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcColorFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    toneMapped: false,
    vertexShader: /* glsl */ `
      // Baked at placement from the tissue the point sits in: high beside the
      // Cells and in dense halo, low in the thin outer fringe. SIZE alone
      // rides it — brightness is flat (see POPULATION_FIELD_EMISSION) and the
      // tint is one colour (see POPULATION_FIELD_COLOR), so the layer's
      // gradient is made by how many points land on a pixel and by nothing
      // else. That is how the Cells make theirs.
      attribute float aWeight;

      uniform float uViewportHeight;
      uniform float uPixelRatio;
      uniform float uSizeMin;
      uniform float uSizeMax;
      uniform float uMinPointPx;
      uniform float uMaxPointPx;
      uniform float uDepthEnergy;

      varying float vEnergy;

      ${BODY_DEPTH_ENERGY_GLSL}

      void main() {
        vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPos;
        // ⟨D-10 · knob c⟩ The SAME law the Cell bodies read, from the same
        // file: the halo's beads are the same matter at lower resolution, and
        // a depth cue that stopped at the rim would draw the seam this design
        // exists to remove. The centre is the world origin, so the view
        // matrix's own translation is its depth — no uniform, and no way for
        // one to disagree with where the group actually is.
        float depthDim = bodyDepthEnergy(
          -viewPos.z,
          -(viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z,
          uDepthEnergy
        );

        float weight = clamp(aWeight, 0.0, 1.0);
        float wanted = mix(uSizeMin, uSizeMax, weight)
          * ${HYBRID_BASE_PX_PER_WU.toFixed(1)}
          * (uViewportHeight * 0.5 / max(-viewPos.z, 0.001));
        float dpr = max(uPixelRatio, 0.001);
        // Both ends of the same bound. The floor is what a fragment can
        // resolve; the ceiling is what one member of a population may cover,
        // and the layer is never frustum culled, so a camera flying through
        // the slab is a pose the law has to hold at.
        float drawn = clamp(wanted, uMinPointPx * dpr, uMaxPointPx * dpr);
        // Conserve the light the FLOOR added, so pulling the camera back
        // dims the field instead of making it twinkle across the pixel grid.
        // A sprite the ceiling narrowed leaves this at one.
        float shrink = wanted / drawn;
        vEnergy = min(1.0, shrink * shrink) * depthDim;
        gl_PointSize = drawn;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 uColor;
      uniform float uEmission;

      varying float vEnergy;

      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float radiusSquared = dot(uv, uv);
        if (radiusSquared > 0.25) discard;

        // One Gaussian. No hot-white centre, no outer wash, no ring — the
        // three things that would make this read as a small Cell instead of
        // as one member of a population.
        float peak = exp(
          -radiusSquared
          / ${(POPULATION_FIELD_SIGMA * POPULATION_FIELD_SIGMA).toFixed(6)}
        );
        // Flat in the weight: the tissue taper is size's job alone (see
        // POPULATION_FIELD_POINT_SIZE_MIN), and a second taper on the same
        // key only cost the outer field light it could not spare.
        float a = peak * uEmission * vEnergy;
        // ONE colour, the body hue at full saturation, exactly as a Cell emits
        // it. The blend below converges toward the emitted alpha in every
        // channel, so overlap eats chroma on its own — which is how the Cells
        // get their pale cores, and it is the whole gradient this layer needs.
        // A tint that ALSO rode the taper paled the layer precisely where
        // overlap was already greatest, and that is what read as grey-white.
        vec3 tint = uColor;
        // Premultiplied, matching the Cell bodies: the blend multiplies rgb
        // by src alpha again, which is what bounds the accumulation.
        // No colorspace conversion here for the same reason — the Cells write
        // raw and a converted twin would be a second material.
        gl_FragColor = vec4(tint * a, a);
      }
    `,
  });
  return material;
}

/**
 * The halo's fibres — the segments the placement walk emits between
 * consecutive points on one filament.
 *
 * Drawn in the Cells' fabric's language, one sample lower: the same bounded
 * screen accumulation, the same VEIN hue the core's nerves carry
 * ({@link POPULATION_STROKE_COLOR}), no tone mapping — but a plain one-pixel
 * GL line where the fabric draws a 2.5-pixel screen-space capsule, and no
 * endpoint treatment of any kind. The filament is the figure; its vertices are
 * not.
 *
 * Plain {@link THREE.LineSegments} rather than the fabric's `LineSegments2`,
 * and the reason is budget, not taste. A fat line is an instanced quad plus a
 * capsule SDF in the fragment shader — twelve triangles and a full shader per
 * segment — which at this layer's 124,000 segments would be 1.5M triangles a
 * frame against the fabric's 32,000 instances. A GL line is two vertices and a
 * one-pixel span: 0.51 of a 1080p screen in fill for the whole layer.
 *
 * ## What these are allowed to claim
 *
 * The Cells' own fabric is a k-NN proximity mesh over positions — a geometric
 * property of the embedding, not a claim that two Cells transacted — so edges
 * among placed halo points carry exactly the truth status the core's edges do.
 * Every index in this geometry addresses a point the same pass placed, and no
 * segment bridges a point the complement rejected.
 *
 * ⚠️ That is a statement about THIS material, and it stays true. It is not
 * the old blanket ban on a stroke with one end on an addressable Cell: the
 * 2026-08-19 register ruling allows such a stroke as the mixed band's
 * secondary nerve, drawn fabric-side by `nerve/CellBridgeNerves.tsx` under
 * five invariants. `populationFieldPlacement.ts`'s header is the authority.
 */
export function makePopulationFibreMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uEmission: { value: 0 },
      // The STROKE hue, not the bead's — see `POPULATION_STROKE_COLOR`. The
      // backbone half of this partition reads the same constant, so the two
      // widths are one colour as well as one light.
      uColor: { value: new THREE.Color(...POPULATION_STROKE_COLOR) },
      // The point material's own two, read here so the stroke's taper is the
      // bead's curve and not a second one — see `populationFibreTaper`. What
      // it no longer is, below `POPULATION_STROKE_TAPER_FLOOR`, is the bead's
      // VALUE: the vertex stage bounds it, and only from below.
      uSizeMin: { value: POPULATION_FIELD_POINT_SIZE_MIN },
      uSizeMax: { value: POPULATION_FIELD_POINT_SIZE_MAX },
    },
    transparent: true,
    depthWrite: false,
    // Byte-for-byte the Cell bodies' and the fabric's blend. The layer EMITS
    // and never covers, so a pixel with no unresolved population receives
    // exactly zero and empty space stays true black.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcColorFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    toneMapped: false,
    vertexShader: /* glsl */ `
      // The fibres are an index buffer over the points' own vertices, so they
      // inherit the placement exactly — and now the taper with it, off the
      // same attribute the points read. A stroke has no width to shrink, so
      // the taper reaches it as alpha.
      attribute float aWeight;

      uniform float uSizeMin;
      uniform float uSizeMax;

      // The size RATIO, not its square. Squaring in the fragment makes the
      // interpolated value exactly the taper of the interpolated weight,
      // because mix() is linear -- interpolating the square would not be.
      varying float vSizeRatio;

      void main() {
        float weight = clamp(aWeight, 0.0, 1.0);
        // POPULATION_STROKE_TAPER_FLOOR, in the unit this varying carries:
        // the floor commutes with the square, so bounding the ratio by
        // sqrt(F) is bounding the taper by F. The BEAD does not read this --
        // the stroke:bead ratio is deliberately no longer constant below the
        // floor, and only in the direction that makes the stroke the figure.
        vSizeRatio = max(
          mix(uSizeMin, uSizeMax, weight) / uSizeMax,
          ${STROKE_TAPER_FLOOR_RATIO}
        );
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 uColor;
      uniform float uEmission;

      varying float vSizeRatio;

      void main() {
        // The point's own footprint-area falloff -- the square of the size
        // ratio -- so stroke and bead dim together down to
        // POPULATION_STROKE_TAPER_FLOOR, below which the stroke stops dimming
        // and the bead carries on. That break is one-directional by
        // construction: it can only make the stroke brighter relative to its
        // beads, never fainter, so "a node with edges radiating from it" is
        // still unreachable. No endpoint falloff and no brightening at a
        // vertex: the taper is a property of the tissue, and both ends of a
        // segment sit in tissue. The filament is the figure, and where two of
        // them cross, accumulation is what makes the crossing brighter.
        float a = uEmission * vSizeRatio * vSizeRatio;
        // The vein hue at the layer's red ceiling: same red as the bead
        // beside it, a fifth of its green. Bounded accumulation converges
        // each channel at a rate set by that channel's tint, so a stroke
        // stacks toward deep red where a rose one stacked toward white.
        vec3 tint = uColor;
        // Premultiplied, matching the Cell bodies, and written raw for the
        // same reason — a colorspace-converted twin would be a second
        // material, which is the seam this design exists to remove.
        gl_FragColor = vec4(tint * a, a);
      }
    `,
  });
}

/**
 * The backbone stroke's width, in CSS pixels.
 *
 * ## Why a width class exists in this layer at all
 *
 * ⚠️⚠️ **`gl.LINES` rasterizes at exactly ONE DEVICE PIXEL, and this layer's
 * fibre was the only stroke in the scene with no DPR compensation.** The point
 * sprite has `uPixelRatio`; the fabric, the pulses and the bridges are
 * screen-space capsules stated in CSS pixels and expanded against
 * `resolution`. Every other stroke in the frame therefore holds its apparent
 * width as pixels get smaller, and this one does not.
 *
 * The arithmetic, spelled out because the whole bug is a constant whose UNIT
 * stopped meaning what it meant. Take a strand that draws 100 px long and 1 px
 * wide on the 1080p display {@link POPULATION_FIBRE_ALPHA} was calibrated on.
 * On a 3840x2160 panel of the same size the pixel pitch halves, so the same
 * strand draws 200 px long and still 1 px wide — the same physical LENGTH, and
 * **half the physical width and half the physical area**. Nothing else in the
 * frame does that: a 2.5 px capsule is 2.5 px at either resolution. And this
 * holds whichever way the extra pixels arrive — at `devicePixelRatio` 2 the
 * hairline is half a CSS pixel, at DPR 1 on a 4K panel it is a physically
 * smaller pixel.
 *
 * That is the whole of the 2026-08-20 live verdict — *the outermost band still
 * shows beads with no visible nerves* — and it is why the alpha raise that
 * shipped the day before did not reach it. A headless probe against the
 * running build found all 96,609 segments drawn and the raise live. Outside
 * the rim the field is in the isolated-deposit regime, where the blend below
 * lays down `a * a` instead of converging to `a`, and **alpha cannot buy
 * width**: raising it lifts every deposit's intensity and leaves the mark the
 * same size, while the bead beside it stays 5–8x more intense per pixel
 * because it concentrates its light into a clamped Gaussian.
 *
 * ## Where this rung sits on the ladder
 *
 * The ladder reads 4.6 pulse / 4.4 trunk / 2.5 mesh / **2.4 → 1.8 bridge** /
 * 1.8 halo backbone / 1 device px residual grain, and a rung has to be
 * distinguishable from the rung above it.
 *
 * ⭐ **1.6 → 1.8 on 2026-08-20, and this time the whole ladder moved with
 * it.** The verdict that opened the round was that the three nerve classes are
 * not different ENOUGH from one another — 中央 fabric, 次级 bridges, 末梢 halo
 * strokes — and the diagnosis was arithmetic rather than aesthetic: the rungs
 * had been set one pair at a time, each against its immediate neighbour, and
 * the result was a ladder of ~1.25x adjacent steps. A 1.25x width difference
 * is below at-a-glance discriminability for two strokes that are not adjacent
 * on screen, which is the whole of what "hard to tell apart" means here. So
 * the steps were re-cut as a set: the trunk took the big move (3.2 → 4.4,
 * 1.76x the mesh), the bridge became the only stroke in the scene whose width
 * VARIES along its length, and this class took the step that keeps it clear of
 * the bridge's thin end while pulling further off the hairline it partitions
 * with.
 *
 * ⚠️ 1.8 is deliberately the SAME number the bridge's far end lands on. That
 * is not a collision, it is the merge: a 次级 stroke ends part-way along a
 * 末梢 strand, and arriving at the strand's own width is what makes the join
 * read as a continuation rather than as a step. That is also why the bridge
 * TAPERS rather than taking a rung of its own — see `BRIDGE_TIP_WIDTH_RATIO`,
 * which reads this constant's value from the other side of the join.
 *
 * ## Why 1.8, and why the steps below it are 1.6 and 1.4
 *
 * ⚠️ **State the gain in DEVICE pixels or repeat the bug.** The reference 4K
 * monitor reports `devicePixelRatio` 1 with a 3840x2160 buffer (measured, see
 * `qualityPresets.ts`), so on the machine the verdicts come from this is
 * **1.8 device px against the hairline's 1 — a factor of 1.8, not of 3.6.**
 * At DPR 2 the same constant is 3.6 device px against the same 1. The class is
 * DPR-aware precisely so the FIRST number is a floor rather than a
 * coincidence, and 1.4 was the smallest number that could TEST the verdict.
 * Live review on `539cd41` returned it unfixed — *the terminal and secondary
 * nerves still do not read at the operating camera* — which answers the
 * question that constant was posed to ask: on this panel, 1.4x over the
 * hairline is not enough. 1.6 was the next step, and the read was bought
 * mostly elsewhere: {@link POPULATION_STROKE_COLOR} moved the whole stroke
 * class out of the beads' hue, because a wider mark in the SAME pink was
 * always going to be more pink rather than a nerve. That is the round the
 * fourth verdict finally graded as *visible, but hard to see clearly* — so
 * the rung takes its last step, alongside a wider net (the budget) and a
 * higher level ({@link POPULATION_FIBRE_ALPHA}), because "not clear enough"
 * is answered by all three and by no one of them.
 *
 * ⭐ And width is not the whole of what the primitive change buys, which is
 * why 1.4 was enough to test the verdict with. A `gl.LINES` primitive lights
 * one pixel per major-axis step under the diamond-exit rule, so a diagonal
 * strand is a chain of corner-touching pixels — a dotted line, which is
 * exactly the read being complained about — and a segment that projects to
 * barely a pixel can be dropped entirely. A capsule is a swept disk: it covers
 * a contiguous region, and it never falls under its own width.
 *
 * ⭐ The GEOMETRY half of this round, stated on its own so it is not confused
 * with the level half. With 20.7% of segments promoted at the wider budget,
 * the layer's MEAN stroke width goes to `0.207 x 1.8 + 0.793 x 1.0` =
 * **1.166 device px at DPR 1** (1.54 at DPR 2), against 1.10 at the previous
 * rung and budget — **6.0% more stroke area**, all of it in the strands that
 * had to carry the read. Rasterized at the production camera the same pair
 * measures +1.2% mean luma on the mixed band, which is what a geometry move
 * costs when the class it widens is already the figure. The level this round
 * adds is {@link POPULATION_FIBRE_ALPHA}'s and is accounted there.
 */
export const POPULATION_BACKBONE_WIDTH_PX = 1.8;

const BACKBONE_UNIFORM_ANCHOR = 'uniform float opacity;';
const BACKBONE_UNIFORMS = `uniform float opacity;
		uniform float uEmission;
		uniform vec3 uColor;`;
const BACKBONE_OUTPUT_ANCHOR =
  '\t\t\tgl_FragColor = vec4( diffuseColor.rgb, alpha );';
const BACKBONE_OUTPUT = `
			// The HAIRLINE's emission law, to the letter, so the two halves of
			// the partition are the same light at two widths. \`diffuseColor.r\`
			// carries the perspective-correct interpolation of the endpoint SIZE
			// RATIO that the capsule patch already computes; squaring it here —
			// rather than interpolating an already-squared value — is what makes
			// the result exactly \`populationStrokeTaper\` of the interpolated
			// weight, because mix() is linear. \`alpha\` is the stock cap test's
			// coverage, which is 1 inside a solid capsule.
			//
			// The floor arrives already applied, in the buffer: this class
			// computes its ratio on the CPU (\`populationBackboneInstanceData\`)
			// where the hairline computes it in a vertex stage, so each half
			// bounds it where it makes it, off the one
			// \`POPULATION_STROKE_TAPER_FLOOR\`. There is no per-fragment clamp
			// here for the same reason there is none there — the floor is a
			// property of the tissue weight at an endpoint, not of position
			// along a segment, and clamping after the interpolation would be a
			// varying that changes shape mid-stroke.
			float haloAlpha = uEmission * diffuseColor.r * diffuseColor.r * alpha;
			// Written raw and NOT colour-managed, for the reason the point and
			// fibre materials are: a converted twin of this stroke would be a
			// second material, and the seam between two materials is the thing
			// this whole layer exists to have removed. The stock encode step
			// after this line is dropped for the same reason — leaving it in
			// would put this pass in sRGB while the hairline it partitions with
			// stays linear, and the backbone would read as brighter rather than
			// as wider. See \`makePopulationBackboneMaterial\`.
			gl_FragColor = vec4( uColor * haloAlpha, haloAlpha );`;
const BACKBONE_COLORSPACE_ANCHOR = '#include <colorspace_fragment>';

/**
 * The promoted strands, as screen-space capsules.
 *
 * Not a new line-rendering system: this is the passive fabric's own
 * two-triangle capsule (`optimizeScreenSpaceCapsuleMaterial`), reached the way
 * `CellBridgeNerves` reaches it — reuse at the level of the PARTS. What it does
 * not take from the fabric is the fabric's OUTPUT. A `LineMaterial` writes
 * `vec4( diffuseColor.rgb, opacity )` and then colour-manages it; this layer
 * emits `vec4( tint * a, a )` raw into a blend that multiplies by the source
 * alpha a second time, which is where the halo's documented `a * a` isolated
 * deposit comes from. Two patches replace that tail, and a third carries the
 * two uniforms the tail needs.
 *
 * ⭐ The endpoint taper rides the attribute slot `instanceColorStart/End`,
 * bound as ONE component rather than three. GL fills the missing components of
 * a `vec3` attribute with `(0, 1)` and the fragment reads only `.r`, so the
 * taper costs two floats a segment instead of six — 0.128 MB against 0.384 MB
 * at the shipped budget. The alternative was a full vertex-colour buffer
 * carrying the same scalar three times.
 *
 * There is no endpoint emphasis of any kind here. Round caps are the capsule's
 * silhouette, not a brightening: the stroke's energy is a function of the
 * tissue weight at each end and of nothing else, so a strand's last segments
 * fade exactly as the hairlines do — wider, never brighter. And the per-deposit
 * alpha is not merely bounded by the hairline's, it IS the hairline's: this
 * material introduces no emission constant, it reads
 * {@link populationFibreEmissionForGain}, and it reads the same
 * {@link POPULATION_STROKE_TAPER_FLOOR} through
 * {@link populationStrokeSizeRatio}.
 *
 * ⚠️ That last sentence used to end *chroma retention is a function of
 * per-deposit alpha, so it cannot move; width is the visibility channel*.
 * Width was the visibility channel for as long as level was the one thing the
 * layer would not spend, and 2026-08-20's third verdict is what ended that:
 * width had already gone 1 -> 1.4 -> 1.6 device px and the fringe still read
 * as dots. Level moves now, both halves of the partition together, and the
 * chroma it costs was measured rather than assumed — 1.4% of the mixed band's
 * C/L, because this panel accumulates ~2 deposits per covered pixel and not
 * the six the retention tables were written against.
 *
 * ⚠️ The fourth verdict then moved the currency ITSELF: per-deposit alpha,
 * the quantity the retired sentence named as immovable, is 0.80 again
 * ({@link POPULATION_FIBRE_ALPHA}). Same measurement, same reason — at two
 * deposits a level lift is cheap in chroma, and it was priced at −3.8% of the
 * mixed band's C/L before it was spent. The rule that survives all four
 * rounds is not "never move level"; it is **never move a channel without
 * measuring what it costs in the regime the display is actually in**.
 */
export function makePopulationBackboneMaterial(): LineMaterial {
  const material = new LineMaterial({
    vertexColors: true,
    linewidth: POPULATION_BACKBONE_WIDTH_PX,
    transparent: true,
    depthWrite: false,
    worldUnits: false,
    toneMapped: false,
  });
  // Byte-for-byte the fibre's blend, which is byte-for-byte the Cell bodies'.
  // The layer EMITS and never covers, so a pixel with no unresolved population
  // receives exactly zero and empty space stays true black.
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.SrcAlphaFactor;
  material.blendDst = THREE.OneMinusSrcColorFactor;
  material.blendEquationAlpha = THREE.AddEquation;
  material.blendSrcAlpha = THREE.OneFactor;
  material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  optimizeScreenSpaceCapsuleMaterial(material);
  material.uniforms.uEmission = { value: 0 };
  // The hairline's colour as well as its light: both halves of the partition
  // are one stroke class, and a class has one hue.
  material.uniforms.uColor = {
    value: new THREE.Color(...POPULATION_STROKE_COLOR),
  };
  material.fragmentShader = replaceShaderChunk(
    material.fragmentShader,
    BACKBONE_UNIFORM_ANCHOR,
    BACKBONE_UNIFORMS,
    'halo backbone uniform declarations',
  );
  material.fragmentShader = replaceShaderChunk(
    material.fragmentShader,
    BACKBONE_OUTPUT_ANCHOR,
    BACKBONE_OUTPUT,
    'halo backbone fragment output',
  );
  material.fragmentShader = replaceShaderChunk(
    material.fragmentShader,
    BACKBONE_COLORSPACE_ANCHOR,
    '',
    'halo backbone colour management',
  );
  material.needsUpdate = true;
  return material;
}
