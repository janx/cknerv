import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import { HYBRID_BASE_PX_PER_WU } from './cellHybridMaterial';
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
 * Body hue, at full saturation — ONE emitted colour, and the palette's own.
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
 */
export const POPULATION_FIELD_COLOR: SceneColor = CELL_GALAXY_PALETTE.tissueRose;

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
 * {@link POPULATION_FIELD_EMISSION}.
 */
export function populationEmissionForGain(gain: number): number {
  if (!Number.isFinite(gain) || gain <= 0) return 0;
  return Math.sqrt(Math.min(1, gain)) * POPULATION_FIELD_EMISSION;
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
 * (the outermost band read as beads with no thread), and
 * {@link POPULATION_FIBRE_ALPHA} is now 0.8. Raising a flat alpha alone is
 * still what must not be done: it buys light by spending exactly the chroma
 * this taper recovered — which is why the pairing, and not the flat raise, is
 * what was spent.
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

/** The fibre's emitted alpha for one amount-curve `gain`. The same curve the
 *  points ride, so the two never drift apart as scope changes. */
export function populationFibreEmissionForGain(gain: number): number {
  return populationEmissionForGain(gain) * POPULATION_FIBRE_ALPHA;
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
      uEmission: { value: 0 },
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

      varying float vEnergy;

      void main() {
        vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPos;

        float weight = clamp(aWeight, 0.0, 1.0);
        float wanted = mix(uSizeMin, uSizeMax, weight)
          * ${HYBRID_BASE_PX_PER_WU.toFixed(1)}
          * (uViewportHeight * 0.5 / max(-viewPos.z, 0.001));
        float minimum = uMinPointPx * max(uPixelRatio, 0.001);
        float drawn = max(wanted, minimum);
        // Conserve the light the clamp added, so pulling the camera back
        // dims the field instead of making it twinkle across the pixel grid.
        float shrink = wanted / drawn;
        vEnergy = min(1.0, shrink * shrink);
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
 * screen accumulation, the same body hue, no tone mapping — but a plain
 * one-pixel GL line where the fabric draws a 2.5-pixel screen-space capsule,
 * and no endpoint treatment of any kind. The filament is the figure; its
 * vertices are not.
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
      uColor: { value: new THREE.Color(...POPULATION_FIELD_COLOR) },
      // The point material's own two, read here so the stroke's taper can
      // never drift from the bead's — see `populationFibreTaper`.
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
        vSizeRatio = mix(uSizeMin, uSizeMax, weight) / uSizeMax;
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
        // ratio -- so stroke and bead dim together and their RATIO never
        // moves along the taper. No endpoint falloff and no brightening at a
        // vertex: the taper is a property of the tissue, and both ends of a
        // segment sit in tissue. A halo point must never look like a node
        // with edges radiating from it — the filament is the figure, and
        // where two of them cross, accumulation is what makes the crossing
        // brighter.
        float a = uEmission * vSizeRatio * vSizeRatio;
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
 * ## Why 1.4, and why it is not larger
 *
 * The ladder reads 3.4 pulse / 3.2 trunk / 2.5 mesh / **1.7 bridge** / 1.4
 * halo backbone / 1 device px residual grain, and a rung has to be
 * distinguishable from the rung above it. The bridge is 1.7 CSS px
 * (`BRIDGE_WIDTH_RATIO` 0.68 on the fabric's 2.5). 1.4 leaves 0.3 CSS px,
 * which is a resolvable step even at DPR 1; 1.5 would leave 0.2 px for 7% more
 * stroke, and a rung nobody can see is not a rung.
 *
 * ## Why 1.4, and why it is not smaller
 *
 * ⚠️ **State the gain in DEVICE pixels or repeat the bug.** The reference 4K
 * monitor reports `devicePixelRatio` 1 with a 3840x2160 buffer (measured, see
 * `qualityPresets.ts`), so on the machine the verdict came from this is
 * **1.4 device px against the hairline's 1 — a factor of 1.4, not of 2.8.**
 * At DPR 2 the same constant is 2.8 device px against the same 1, a factor of
 * 2.8. The class is DPR-aware precisely so the FIRST number is a floor rather
 * than a coincidence.
 *
 * ⭐ And width is not the whole of what the primitive change buys, which is
 * why 1.4 is enough to test the verdict with. A `gl.LINES` primitive lights
 * one pixel per major-axis step under the diamond-exit rule, so a diagonal
 * strand is a chain of corner-touching pixels — a dotted line, which is
 * exactly the read being complained about — and a segment that projects to
 * barely a pixel can be dropped entirely. A capsule is a swept disk: it covers
 * a contiguous region, and it never falls under its own width.
 *
 * ⭐ The number that says this is not a brightness raise in disguise: with
 * 16.6% of segments promoted, the layer's MEAN stroke width goes to
 * `0.166 x 1.4 + 0.834 x 1.0` = **1.07 device px at DPR 1** (1.30 at DPR 2).
 * The halo as a whole gains under 7% of stroke area, and all of it is
 * concentrated into the strands that had to carry the read.
 */
export const POPULATION_BACKBONE_WIDTH_PX = 1.4;

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
			// the result exactly \`populationFibreTaper\` of the interpolated
			// weight, because mix() is linear. \`alpha\` is the stock cap test's
			// coverage, which is 1 inside a solid capsule.
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
 * {@link populationFibreEmissionForGain}. Chroma retention is a function of
 * per-deposit alpha, so it cannot move; width is the visibility channel.
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
  material.uniforms.uColor = {
    value: new THREE.Color(...POPULATION_FIELD_COLOR),
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
