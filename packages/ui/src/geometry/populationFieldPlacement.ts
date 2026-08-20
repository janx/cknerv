// Placement of the unresolved population as real filaments in the Cells' own
// world.
//
// This module holds the whole of the halo's geometry. It is one CPU pass that
// walks the shared positional law — the SAME law `helixSeedF64` uses to place
// an addressable Cell — under an envelope re-closed further out. Nothing here
// is rasterized, marched, or evaluated per pixel: the output is a plain
// `Float32Array` of world positions plus a `Uint32Array` of segment indices,
// uploaded once and never touched again.
//
// It replaces a two-pass screen-space pipeline (a baked field texture, a
// density march at quarter resolution, a suppression shader, a line-integral
// convolution grain, a speck mask, and a composite). That construction failed
// for two structural reasons, neither visible in a still image:
//
//   1. Everything else in this scene is world-anchored. Cells and fabric rotate
//      with the galaxy, carry parallax, and interleave in depth. A
//      screen-locked layer shimmers in place while they move, so the eye files
//      it as a filter over the picture rather than as matter in the picture.
//   2. A procedural texture cannot match sprite geometry. However closely
//      value, grain and hue are matched, a hash-cell field and a cloud of
//      Gaussian point sprites stay two materials, and a material boundary is
//      always visible.
//
// Both came from a self-imposed rule — "the field never resolves at any camera
// distance" — which forced screen space and was never a product requirement.
// Not-addressable is a property of AFFORDANCE, not of resolvability, and the
// affordance now carries it: no hover, no cursor, no raycast, and a point
// clearly smaller and dimmer than any Cell.
//
// The second false constraint was budgetary. `AUTO_CELL_DISPLAY_BUDGET` is the
// ADDRESSABLE budget — payload, picking, fabric edges, hover state, a `Cell`
// object each. A non-addressable point is twelve bytes.
//
// ## Why STREAMLINES and not points
//
// The first world-space build placed points independently, weighting them onto
// the fibre corridors and hoping threads would emerge from the density
// contrast. They did not, and the reason is countable: at the halo's ~2.5
// points per pixel, the Poisson noise of an independent draw is comparable to
// every density modulation the weighting can produce, so what the eye gets is
// a clumpy spray. A density modulation cannot look like a drawn thread.
//
// The core's neural quality does not come from its points either. It comes
// from roughly eight thousand DRAWN FABRIC SEGMENTS. So the halo is built the
// same way: a seed is picked from the tissue, a walk follows the ridged fibre
// field's crest, and every step drops a point and a segment back to the last
// one. Threads then exist by construction instead of being hoped for, and the
// fibre buffer falls out of the walk with no k-NN search.
//
// ## What the fibres are allowed to claim
//
// The Cells' own fabric is a k-NN proximity mesh over positions — a geometric
// property of the embedding, not a claim that two Cells transacted. Edges
// among placed halo points therefore carry exactly the truth status the core's
// edges do. Every index THIS module emits addresses a point this module
// placed: the walk has no other vertex to name, and that is a property of the
// construction rather than a rule anyone has to keep.
//
// ### The scene speaks two registers (user ruling, 2026-08-19)
//
// This paragraph used to end with a ban: "what stays forbidden is an edge with
// ONE END on an addressable Cell". That ban is SUPERSEDED, and the reasoning
// that replaced it is worth having here, because it is what makes the halo's
// own honesty statable at all.
//
// The core is ACTUAL language: one mark IS one Cell, one stroke IS one
// proximity relation between two named Cells, one pulse IS one observed
// transaction path. This layer is SYMBOLIC language: one point stands for
// roughly fourteen Cells cknerv could not individuate, one fibre for
// unresolved connections in aggregate. Read that way, a stroke with one end on
// a Cell and one end in this field asserts nothing about two individuals. It
// says "this real Cell adjoins, and is continuous with, the unresolved mass" —
// aggregate-true, carrying exactly the truth status this whole layer carries,
// and precisely the 连续过渡 the mixed band exists to express. It is the
// transition band's SECONDARY NERVE (次级神经), and it is drawn by
// `geometry/bridgeEdges.ts` + `nerve/CellBridgeNerves.tsx`.
//
// What keeps a mixed stroke honest is HOW it is drawn, not whether. The ban
// was one blunt way of enforcing five things; these are the five, and they are
// the invariants that replaced it:
//
//   1. **Symbolic idiom at the symbolic end.** Matte, thin, fading into the
//      mass, singling out no individual. The actual end may carry a knot and
//      the fabric's width class; the far end may carry neither.
//   2. **No endpoint emphasis, ever, at a symbolic end.** A bridge's far end
//      is monotone-fading (`bridgeTaper`), takes no retirement flash, and does
//      not even terminate ON a placed point — it ends part-way along a fibre,
//      so no drawn vertex of this field is ever a stroke's endpoint. A halo
//      point must never look like a node with edges radiating from it.
//   3. **No actual-register SYSTEM traverses a mixed stroke.** Routing
//      (`pathRouter` — a pulse must never route into this field), pulse
//      planning, reinforcement, the inspection field, recall traces, and
//      picking all stop at the Cells. Bridges are render-only.
//   4. **Bridges live on the FABRIC side and follow their host's lifecycle.**
//      A bridge grows when its host Cell becomes a host and retracts when it
//      stops being one — actual-register motion about an actual event at the
//      actual end, never ambient shimmer. This field itself stays STATIC.
//   5. **This buffer stays static and prefix-trimmable.** Bridges only READ
//      these positions. The one-shot pass, the draws, and the
//      `populationSegmentsForPointPrefix` invariant are untouched by them —
//      and a bridge may only anchor inside the lowest preset's prefix, so no
//      quality step can trim a stroke's far end out from under it.

import {
  FIELD_HALF_X,
  FIELD_HALF_Z,
  TISSUE_ENVELOPE_EDGE,
  boundaryWarpBound,
  tissueSampleAt,
  valueNoise2,
} from '../helix';

/**
 * Where the UNRESOLVED population's envelope closes, in units of the resolved
 * rim.
 *
 * The addressable Cells stop at {@link TISSUE_ENVELOPE_EDGE} because that is
 * where cknerv stops individuating them, and `FIELD_HALF_X/Z` stay exactly
 * where they are — delivery landings and the contact front's extinction band
 * derive from those two numbers, and rescaling them would drag in every
 * constant elsewhere that was tuned against the old scale. The halo grows
 * OUTWARD instead: same organism, same law, boundary moved.
 *
 * The envelope is a SAMPLING bound — it keeps the drawn set compact — and not
 * a fact about the population, which is exactly why moving it for the
 * unresolved layer is legitimate and moving the rim is not.
 *
 * ## Why 1.6, and why it is not larger
 *
 * Live review: "the cells galaxy should be somewhat smaller than the peer
 * network". At 2.2 it was not. Measured at the production camera over the real
 * placement and the real colony, worst of four galaxy rotations, the halo's
 * projected convex hull covered **2.08x** the colony's, with 58% of its points
 * outside the colony's own hull. The peer mesh is the transport around the
 * organism and has to read as enclosing it; a display convention had outgrown
 * the measured object beside it.
 *
 * ## Why 1.6, and why it is not smaller
 *
 * The POINT budget is conserved, so pulling the edge in concentrates the same
 * 105,000 points into less area. (⚠️ The segment budget is not: measured live,
 * 93,912 segments at 2.2 against 87,964 here, over 20% more streamlines. The
 * walk seeds more filaments and finishes them sooner in denser tissue. Any
 * argument that reads "the budget is conserved" and then reasons about the
 * fibres is reasoning about a number that moved.) That is the honest answer to the second half
 * of the same review — "the centre could be brighter, more brilliant" — and it
 * comes from density rather than from a brightness knob. But it is bounded
 * from below by three separate measurements that all turn over between 1.5 and
 * 1.7, and none of them is the containment one:
 *
 * | edge | hull vs colony | points inside the resolved rim | pre-rim C/L | peak rendered L |
 * |-----:|---------------:|-------------------------------:|------------:|----------------:|
 * | 2.2  | 2.075          | 0.274                          | 0.1473      | 0.3659          |
 * | 1.7  | 0.905          | 0.455                          | 0.1264      | 0.4248          |
 * | 1.6  | **0.756**      | **0.490**                      | **0.1223**  | **0.4258**      |
 * | 1.5  | 0.650          | 0.553                          | 0.1165      | 0.4376          |
 * | 1.3  | 0.468          | 0.724                          | 0.1061      | 0.4521          |
 *
 *  1. **The halo has to stay a halo.** Its exclusive ground is the ring
 *     between the resolved rim (1.04) and this edge; the envelope's inner
 *     shoulder is fixed at 0.61 in `helix.ts` and does not follow. So closing
 *     the edge does not slide the layer inward as a whole — it moves its mass
 *     ONTO the Cells. The share of placed points inside the resolved rim
 *     crosses one half at edge **1.585**. Below that the layer is more infill
 *     than halo, which is a different picture from the one that was specified.
 *  2. **The complement is what shreds it — and this bound has since been
 *     RELAXED, though not removed.** Acceptance is probabilistic, so on ground
 *     the Cells half-occupy it used to drop every other point and the filament
 *     became beads: the share of points carried by fibre components of 8 or
 *     more ran 0.816 at 2.2, 0.701 here, and 0.526 at 1.3. That was the
 *     JOINT law of the draw and not the marginal, and
 *     {@link POPULATION_COMPLEMENT_CORRELATION_STEPS} fixed it. Re-measured
 *     with the correlated complement, same points, same seed:
 *
 *     | edge | 2.2 | 1.7 | 1.6 | 1.5 | 1.3 |
 *     |---|---:|---:|---:|---:|---:|
 *     | i.i.d.     | 0.816 | 0.697 | 0.701 | 0.662 | 0.526 |
 *     | correlated | 0.870 | 0.832 | **0.809** | 0.791 | 0.717 |
 *
 *     That column is an edge sweep under one length law and is read that way.
 *     The 1.6 figure has since moved to **0.811** under the tissue-keyed
 *     length and fork ramps ({@link POPULATION_STREAMLINE_REACH_DENSITY}); the
 *     shape of the row — monotone inward, spent by 1.3 — is a property of the
 *     complement and the edge, not of the length law, so the bound stands.
 *
 *     ⚠️ It still falls monotonically inward and 1.3 still costs a tenth of
 *     the layer's stroke against 1.6, so this remains a real reason not to
 *     close the edge further — it is simply no longer the tightest of the
 *     three. **The edge does not move on the strength of it**, because bounds
 *     1 and 3 are untouched: the correlated complement is marginal-preserving,
 *     so the share of points inside the resolved rim (0.490, crossing one half
 *     at 1.585) and the placed density that the chroma column is a function of
 *     are both exactly where they were.
 *  3. **Concentration eats chroma**, because bounded-screen accumulation
 *     converges to the emitted alpha in every channel. Rendered C/L in the
 *     pre-rim band falls 0.1473 -> 0.1223 here, and at 1.3 reaches **0.1061 —
 *     below the 0.1095 of the two-endpoint ramp that live review rejected as
 *     grey-white**. The colour work of `cab0d7b` survives at 1.6 and is spent
 *     by 1.3.
 *
 * 1.6 is the smallest edge that clears all three, and it is the containment
 * answer as well: 0.756 of the colony's projected area, 0.87 of it linearly.
 *
 * ⚠️ That column is an edge-to-edge comparison on one rig and is read that
 * way. The absolute containment figure moved afterwards, when the boundary
 * warp began following its own radius: the swept-disc ratio the test actually
 * gates went 0.845 → 0.862 against a 0.90 ceiling. Raggedness is spent out of
 * containment, so the two are one axis and only one of them can be maximised.
 *
 * ⚠️⚠️ **1.7 was on the table and is not any more, for that reason.** It was
 * offered as the gentler-boundary fallback on a hull of 0.905, measured before
 * the warp followed its radius. Re-measured with it, 1.7 sweeps **0.943**
 * against the 0.90 ceiling — it fails containment outright, which is the one
 * thing pulling the edge in was for. What it buys is marginal beside that:
 * chroma retention +0.011 before the rim and +0.007 outside it, fibre runs of
 * eight or more 0.697 → 0.735 (0.809 → 0.832 once the complement was
 * correlated — the same small gain), at +12% frame coverage. The ladder now
 * has one rung, and the boundary's own character is where the gentleness came
 * from.
 *
 * ## What it cost the GPU: nothing, and the reason generalises
 *
 * The live worry was that concentration trades area for overdraw, and every
 * halo fragment is a blend. Measured with `EXT_disjoint_timer_query_webgl2` at
 * 3840x2160 on the `high` tier with composition live, six runs per arm
 * alternated, both arms built and verified distinct down to the worker chunk's
 * hash:
 *
 * | arm | points | fibres | sum |
 * |-----|-------:|-------:|----:|
 * | 2.2 | 2.800 ms | 2.023 ms | 4.823 ms |
 * | 1.6 | 2.759 ms | 1.970 ms | **4.729 ms (-2.0%)** |
 *
 * ⭐ **Both draws are PRIMITIVE-bound, not fill-bound**, and that is the whole
 * explanation. Halving the primitives at the `med` tier gives 0.449x the
 * points time and 0.429x the fibres time — very nearly linear in count. Total
 * fragments are `N x sprite area`, and both of those are invariant to WHERE
 * the points sit, so redistributing a fixed budget over 54% of the area cannot
 * cost anything. The -2.0% is not concentration paying off either: it is the
 * 6.3% fewer segments above. Per segment the 1.6 arm is 4% dearer.
 *
 * ⚠️ Run-to-run noise (2.7-4.3% within an arm) is LARGER than the effect, and
 * at the frame level it is invisible — both arms sit on the same 16.7 ms
 * vsync p50. It took alternating six runs an arm to make the sign trustworthy.
 *
 * ⚠️⚠️ So this constant is not where the frame budget lives. The adaptive
 * controller's `high` to `med` step moves **2.64 ms** of GPU in this one
 * layer; this constant moves **0.094 ms**. The limit cycle at 4K is a **28x
 * larger lever than the edge**, it is pre-existing, and any perceived cost
 * change after this edge moved is far more likely to be how often the cascade
 * is switching than the edge itself.
 *
 * ⚠️ The brightness this buys saturates long before the damage does. Peak
 * rendered lightness is +16.4% here and only +23.6% at 1.3, because the extra
 * points land on ground the complement rejects — so the last third of the
 * reduction buys 7% more light for 25% less stroke.
 *
 * ⚠️ `COLONY_RADIUS = 92` is NOT the colony's extent: `COLONY_ELLIPSE_X/Z`
 * carry it to 115 x 78. Compare against the projected hull, never against
 * that constant.
 */
export const POPULATION_FIELD_OUTER_EDGE = 1.6;

/**
 * How many points the halo carries.
 *
 * Halved from the 260,000 the independent-draw build used, and the reason is
 * the change of construction rather than a change of taste. A spray spends its
 * points filling area, so more of them bought less grain (local luminance
 * deviation falls as 1/sqrt(N)) and nothing else — structure at the corridor
 * scale did not improve at all across a 65K→900K sweep, and slightly worsened
 * as the extra points filled the low-density tail.
 *
 * A filament spends its points along a CURVE, and measured at matched light
 * the count no longer moves the structure AT ALL — orientation coherence is
 * flat within noise from 65,000 to 260,000, because the structure now comes
 * from the drawn fibres rather than from density contrast between points. What
 * the count moves is coverage and light, so it became a budget for the fibres
 * to spend: 105,000 points plus their fibres cover the same area as 260,000
 * bare points did — 27.4% of the frame against 27.3% — for 6.7% more light,
 * while orientation coherence goes from 0.183 to 0.333.
 *
 * It is also a population statement. Against a 12,000-Cell stage and ~1.46M
 * unresolved mainnet Cells, this is roughly one point per fourteen Cells
 * cknerv could not individuate.
 *
 * Cost: 1.26 MB of positions, 0.84 MB of indices and 0.42 MB of taper weights,
 * uploaded once — still LESS memory than the 3.1 MB the previous build
 * uploaded, and the pass itself is 116 ms of worker CPU.
 *
 * ⚠️ It is THREE draw calls now, not two: the fibres are partitioned into a
 * one-device-pixel line pass and a capsule pass over the strands promoted to
 * the halo's width class, which costs a second copy of the index buffer plus
 * the promoted subset expanded to instance data (0.77 + 0.51 MB at the shipped
 * budget). See `populationBackbone.ts`.
 */
export const POPULATION_FIELD_POINTS = 105_000;

/**
 * The segment count that belongs to the first `pointPrefix` placed points.
 *
 * The walk emits a point and then the segment that reaches it, and a branch
 * reaches back to a point it already emitted, so the larger index of a segment
 * is the newest point at the moment it was written and is therefore monotone
 * non-decreasing across the buffer. That makes the answer a binary search
 * rather than a scan, and it makes a prefix of the segment buffer exactly the
 * fibres of a prefix of the point buffer — no segment can dangle past the
 * points that are drawn.
 *
 * Pure. `segments` holds index pairs, `2 * segmentCount` valid entries.
 */
export function populationSegmentsForPointPrefix(
  segments: ArrayLike<number>,
  segmentCount: number,
  pointPrefix: number,
): number {
  if (pointPrefix <= 0 || segmentCount <= 0) return 0;
  let low = 0;
  let high = segmentCount;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const a = segments[mid * 2];
    const b = segments[mid * 2 + 1];
    if ((a > b ? a : b) < pointPrefix) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * The complement — where the addressable Cells already occupy this tissue.
 *
 * A candidate is kept with probability `1 - resolvedCoverage / (2 * KNEE)`,
 * which is zero at and above `2 * KNEE`. Evaluated at the point's REAL
 * position, so it follows every corridor and cavity exactly: no ray integrals,
 * no per-pixel thresholds, no cavity problem, and no photon to put back
 * because there is no point.
 *
 * **The invariant, stated correctly: zero where resolved Cells are DENSE —
 * never "zero inside a radius".** Earlier drafts said the latter and it cost
 * two rounds: it made the halo's ingress through the tissue's cavities look
 * like a violation to be capped, when a cavity contains no Cells and halo
 * light in one obscures nothing. The thing worth defending is Cells, not a
 * circle. Measured on the shipped placement, about a third of points land
 * inside the resolved rim — that interdigitation is the design working, not
 * leaking.
 *
 * A rejected point also BREAKS the filament (§5.1): the walk carries on
 * through the dense tissue, but no segment bridges the gap, or the drawn fibre
 * would cross exactly the ground the complement just cleared. A filament that
 * re-emerges on the far side of a Cell clump is the interdigitation reading
 * made literal.
 *
 * WHICH candidates are dropped is a separate question from how many, and the
 * two were once answered by the same draw; see
 * {@link POPULATION_COMPLEMENT_CORRELATION_STEPS}. The probability above is
 * unchanged by that, exactly.
 */
export const POPULATION_FIELD_COMPLEMENT_KNEE = 0.3;

/**
 * The taper, and the two measurements that chose its key.
 *
 * Size and brightness ride a per-point weight baked here, from the tissue the
 * point actually sits in. A FLAT size is what made the mixed band read as a
 * collision of two classes rather than as a gradient of one population:
 * measured on the shipped build, every one of the 21,262 halo points in the
 * 0.75–1.04 band drew at exactly 0.72 world units while the 2,485 addressable
 * Cells beside them ran 0.783–2.40, so the size axis held one delta spike and
 * then a separate continuum. The ceiling — no halo point is ever as large as
 * the smallest Cell — is right and stays, but a ceiling nothing ever
 * approaches is what guarantees the gap.
 *
 * ⚠️ The design said to key this on `resolvedCoverage` alone, on the grounds
 * that radius is smooth and elliptical. MEASURED, that is backwards, and the
 * measurement is the reason this constant exists:
 *
 * | key                | variance explained by radius alone | at the taper |
 * |--------------------|-----------------------------------:|--------------|
 * | `resolvedCoverage` | **77.9%**                          | 81% of points sit below 0.05 |
 * | `density` (outer)  | **50.2%**                          | p10 0.068, p50 0.280, p90 0.538 |
 *
 * `resolvedCoverage` is the MORE radial of the two, because its envelope
 * closes hard at the resolved rim and 74% of the halo lives outside it — so a
 * coverage-only taper is exactly zero for three quarters of the layer and
 * re-flattens it at the bottom of the range instead of the top.
 *
 * So the two terms carry the two halves of the requirement, and each is
 * structure-driven:
 *
 *  - **`density`** — the halo's own tissue under its own envelope — gives the
 *    layer grain everywhere and falls away in the thin outer fringe. It is
 *    the honest statement: the more unresolved population is here, the more
 *    light this mark carries.
 *  - **`resolvedCoverage`** — lifts the points that sit beside the Cells, which
 *    is the specific job the design named, and it is what puts halo points
 *    into the same size decade as the smallest Cells.
 */
export const POPULATION_TAPER_DENSITY_FULL = 0.6;
export const POPULATION_TAPER_COVERAGE_LIFT = 0.5;

/**
 * The per-point taper weight, in `[0, 1]`. Zero is the open outer fringe; one
 * is tissue as dense as the layer ever draws, or ground the addressable Cells
 * are already standing on.
 *
 * Both inputs come from the SAME `tissueSampleAt` call the walk already makes,
 * so the taper costs no field evaluation at all.
 */
export function populationPointWeight(
  density: number,
  resolvedCoverage: number,
): number {
  return clamp01(
    density / POPULATION_TAPER_DENSITY_FULL
    + POPULATION_TAPER_COVERAGE_LIFT
      * (resolvedCoverage / POPULATION_FIELD_COVERAGE_CEILING),
  );
}

/**
 * How a STRAND ends — the ramp its last points' weights are scaled by, tip
 * first.
 *
 * A strand is one unbroken drawn curve, which is not the same thing as a
 * filament: the complement breaks a filament wherever it crosses resolved
 * tissue, so one walk can leave several strands behind. Every one of them used
 * to stop at whatever weight the tissue handed its last point, and the
 * complaint that came back from live review was about precisely that — "the
 * edge looks clipped, too regular". The layer's outer boundary is drawn almost
 * entirely by strokes (lightness 0.218 against the points' 0.148 outside the
 * rim), and a stroke that ends at full strength is a hem.
 *
 * `1c44c79` answered the LAYER-wide half of it: the fibre took the same tissue
 * taper the point rides, so the open fringe draws dimmer than the dense
 * interior. What it could not answer is the per-strand half — inside one band
 * every strand still ended as abruptly as it began. This is that half, and it
 * is retroactive rather than predictive: the walk does not know a strand is
 * over until it is, and the whole pass finishes before either buffer is
 * transferred, so writing a weight a second time costs one store.
 *
 * ## Why these three numbers
 *
 * Equal increments, so the ramp has a corner at neither end: 0.25, 0.50, 0.75
 * and then the strand's own weight, four steps of a quarter. A geometric or
 * steeper ramp puts the whole fade into the last point, which reads as one
 * dim speck rather than as a tip.
 *
 * The tip is a QUARTER and never zero, and the floor is not squeamishness.
 * `populationPointSizeForWeight` maps weight 0 to
 * `POPULATION_FIELD_POINT_SIZE_MIN`, not to nothing, so a zero-weight point
 * still draws — it would be a full-sized-enough bead on a stroke faded to
 * `(0.50/0.76)^2 = 0.433`, which is a bead with a faint connector: exactly the
 * shape "no endpoint emphasis of any kind" forbids. Scaling the shared weight
 * is what keeps that from happening at all, because the stroke's alpha rides
 * `(size(w)/sizeMax)^2` of the SAME number — the ratio of stroke to bead is
 * invariant along this ramp for the same reason it is invariant along the
 * tissue taper, and no fibre-only end treatment may ever be added on top.
 *
 * Three points, not more: at {@link POPULATION_STREAMLINE_STEP} that is 3.75
 * world units of fade against a median drawn run of 7.50, and a fourth would
 * be fading more of the layer than it leaves. Measured on the shipped
 * 105,000-point placement, the three rungs take **14.6% / 12.5% / 11.2%** of
 * every point placed, so 38% of the layer is inside a fade and 62% is not.
 *
 * ⚠️ Those were 13.1% / 11.1% / 9.8% before the density-keyed length and fork
 * ramps ({@link POPULATION_STREAMLINE_REACH_DENSITY}), and the rise is the
 * ramps and not this array: shorter filaments and more forks mean 15.9% more
 * strands, and every strand has exactly one of these ends. A fade is a fixed
 * three points however long the strand is, so the share of the layer inside
 * one rises with the strand count by construction.
 *
 * ## What it costs, and where the light goes
 *
 * Point flux (`size^2` summed over the buffer) falls to **0.918x**. Fibre
 * flux, over the same change, RISES to **1.033x** — the correlated complement
 * ships with this and hands the strokes 7.6% more segments than the fades take
 * back. So the layer as a whole does not dim; what happens is that light moves
 * off the ENDS and onto the middles, which is the entire request.
 *
 * ⚠️ The fade is bounded by the size floor and cannot be deepened by this
 * ramp alone. A quarter-weight tip in the dense interior still draws at
 * `(0.5 + 0.26*0.25)/0.76 = 0.743` of the maximum sprite, so `0.553` of the
 * flux; in the open fringe, where the weight is already low, the tip barely
 * moves at all. If live review wants the tips to go further, the knob is
 * `POPULATION_FIELD_POINT_SIZE_MIN` and not this array — and that knob
 * is spoken for by the layer's own minimum-visible-sprite argument.
 */
export const POPULATION_END_TAPER: readonly number[] = [0.25, 0.5, 0.75];

/**
 * The halo's fibre, as two ridged octaves on the law's WARPED coordinates.
 *
 * It is no longer a weight on an independent draw. It is the walk's DIRECTION
 * field, and ONLY that: at each step the heading turns toward the perpendicular
 * of this function's gradient, so a filament runs along one of its flow lines
 * rather than across them, and neighbouring filaments — reading the same
 * smooth field — align into bundles. Measured, tangents of points within three
 * world units on DIFFERENT filaments agree at 0.705 against 0.637 for random
 * headings.
 *
 * Two ways of also making it a DENSITY weight were built and measured, and
 * neither is here:
 *
 *  - **Biasing the seed** toward high fibre. It cannot work, for a reason that
 *    is obvious once measured: a filament is fifteen points long, so the seed
 *    is 7% of them and the walk carries the rest wherever the flow goes. Mean
 *    fibre over placed points held at 1.10x the density-and-complement-weighted
 *    null at every slope from 0 to 6, and coverage, light and coherence were
 *    flat to within noise. It was an extra field evaluation per seed for
 *    nothing.
 *  - **A crest-climbing term**, adding the raw gradient to the heading. That
 *    does raise mean fibre (1.06x to 1.92x), and it is worse: the walk
 *    oscillates ACROSS the ridge instead of running along it — turn per step
 *    goes from 8 degrees to 53 — and it lowers both orientation coherence and
 *    the inter-filament alignment it was meant to improve.
 *
 * The reason both fail is one property of the construction, worth stating
 * plainly because it is invisible in a picture:
 *
 * > A curve integrated perpendicular to a gradient follows a CONTOUR, not a
 * > ridge. It preserves the value it started at.
 *
 * So this field decides which WAY the population runs, and the tissue density
 * decides WHERE it is. The contour is not a defect to correct; it is a flow
 * line, and flow lines are what the eye reads as tissue.
 *
 * What makes fibre out there honest: the fabric's edge budget is a resolution
 * limit exactly like the Cell budget, so the halo is unresolved CONNECTIONS as
 * much as unresolved Cells.
 *
 * Evaluated on `qx, qz` rather than on `x, z` so the strands follow the
 * organism's own flow instead of a grid. Scale decides this completely: the
 * `ridge` octave the density already uses sits at 11 world units and projects
 * as marbling, while the same construction at 3–5 units reads as dendritic.
 *
 * This is WORLD-SPACE structure. It turns with the galaxy, as the fabric's own
 * filaments do, which is the entire reason the layer was rebuilt.
 */
export const POPULATION_FIBRE_SCALE_A = 5.5;
export const POPULATION_FIBRE_SCALE_B = 3.1;
/** The second octave is read on coordinates scaled by this and offset, which
 *  both decorrelates it from the first and puts its true world scale at
 *  `POPULATION_FIBRE_SCALE_B / 1.7` — about 1.8 units, the finest structure in
 *  the layer. */
export const POPULATION_FIBRE_WARP_B = 1.7;
/** Powers the ridge bases are raised to. High, so the ridges stay thin: these
 *  are bundles seen from far enough away that individual links never separate.
 *  Raised per SAMPLE now rather than per texel, so nothing averages the thin
 *  structure away — the failure a baked field had to work around. */
export const POPULATION_FIBRE_POWER_A = 7;
export const POPULATION_FIBRE_POWER_B = 9;
export const POPULATION_FIBRE_MIX_A = 0.62;
export const POPULATION_FIBRE_MIX_B = 0.38;
const FIBRE_SALT_A = 0x51fa7c11;
const FIBRE_SALT_B = 0x2c9e77b3;

/**
 * Finite-difference arm for the crest gradient, in warped units.
 *
 * Deliberately coarse against the finest octave's ~1.8-unit scale: a tight arm
 * differentiates the noise's own wiggle and the walk chases it into circles,
 * while this one sees the ridge and not the texture on it. Measured, the walk
 * holds a mean fibre value well above the tissue's — it is tracking crests,
 * not wandering.
 */
export const POPULATION_FIBRE_GRADIENT_ARM = 0.55;


/**
 * World units per integration step.
 *
 * Set against the sprite footprint, not against the field. At the production
 * camera one world unit is about 6.1 device pixels and the sprite draws near
 * 4, so a step of 1.25 leaves consecutive points roughly two sprite-widths
 * apart: a dotted line, which is exactly why the segments are drawn. Much
 * shorter and the points merge into a solid worm that costs three times as
 * much for no more structure; much longer and the polyline visibly facets
 * against filament curvature radii of a few units.
 */
export const POPULATION_STREAMLINE_STEP = 1.25;

/**
 * Length spread, in steps.
 *
 * Drawn as `MIN + (MAX - MIN) * u^EXPONENT`. Real dendritic tissue has a wide
 * spread of lengths, and a uniform draw between two bounds is what made an
 * earlier pass read as felt — every filament the same size, no hierarchy, no
 * reading order. So the draw stays skewed; what changed is where it stops.
 *
 * ## The trade, and why coherence could not decide it alone
 *
 * The drawn runs used to reach 86 world units against the Cells' own fabric,
 * and a curve an order of magnitude longer than every stroke beside it reads
 * as swept HAIR rather than as tangled TISSUE, however well it is placed.
 *
 * ⚠️ Orientation coherence REWARDS long coherent runs, so it cannot arbitrate
 * a change that shortens them — it can only go down and call that worse. It
 * was paired with a tangle measure here, and one candidate instrument was
 * tried and DISCARDED first, which is worth writing down: coherence at a wide
 * (16 px) window, meant to catch "all the strokes run the same way over a
 * whole neighbourhood", moves in lockstep with the narrow one — the ratio held
 * at 0.77–0.79 across every variant swept. Filament length is not what makes
 * neighbouring filaments parallel; the flow field is, and it is unchanged.
 * Re-measured across a fresh twelve-variant sweep, coherence spans 0.473–0.498
 * — it barely moves at all, and it still cannot decide this.
 *
 * What does discriminate is the run-length distribution read against the
 * fabric's own, which is the comparison the eye is making.
 *
 * | | shipped | here | the fabric (as it then was) |
 * |---|---:|---:|---:|
 * | run p50 | 6.25 | 8.75 | 5.75 |
 * | run p90 | 40.0 | 23.75 | 8.50 |
 * | run max | **86.25** | **31.25** | 27.66 |
 * | max / fabric max | 3.12x | **1.13x** | 1x |
 * | filaments | 6,562 | **10,464** | — |
 * | fork points | 2.30% | 2.66% | — |
 * | orientation coherence | 0.326 | **0.319** | — |
 *
 * ## Re-derived 2026-08-19, because the fabric changed under it — and these
 * ## constants are STAYING, which took measuring to establish
 *
 * The fabric's k-NN search was corrected: it had been answering from a
 * truncated, direction-biased slice of each neighbourhood, and its edges were
 * ~2.6x longer than the true nearest neighbours. The reference this constant
 * was calibrated against moved with it:
 *
 * | fabric, 8,000 drawn edges | before | after |
 * |---|---:|---:|---:|
 * | p50 | 5.70 | **2.19** |
 * | p90 | 8.47 | **4.05** |
 * | max | 26.17 | **26.98** |
 *
 * ⚠️ **The max did not move, and that is not luck.** The fabric's longest
 * drawn edges are lifeline and component-stitch edges — the sparse exceptions
 * added so every Cell stays reachable — and those are not k-NN edges at all.
 * So the anchor this calibration actually named, "within 13% of the longest
 * edge the fabric draws", survived untouched at **1.16x**. What degraded is
 * the typical-stroke reading it was standing in for: run p50 went from 1.5x
 * the fabric's p50 to **4.0x**, and run p90 from 2.80x to **5.86x**.
 *
 * ⚠️ Those two ratios are the edge-2.2 distribution against the corrected
 * fabric. At 1.6 the drawn runs are shorter — p50 6.25 wu, p90 18.75 — so the
 * ratios were really 2.85x and 4.63x, and then
 * {@link POPULATION_COMPLEMENT_CORRELATION_STEPS} lengthened them again to
 * **7.50 / 21.25 wu, 3.42x and 5.25x**. That direction is not an accident and
 * it is worth naming: the breaks the i.i.d. complement was scattering through
 * the mixed band were CUTTING runs, so healing the strand-shredding bug spends
 * some of its gain on exactly the length regression this constant records.
 * The max is unmoved at 31.25 (1.16x) — it is bounded by
 * {@link POPULATION_STREAMLINE_MAX_STEPS} and not by the complement — and the
 * spread p90/p50 holds at 2.83.
 *
 * ⚠️⚠️ **Neither lever can follow, and both are pinned by something that has
 * nothing to do with the fabric.**
 *
 *  - **Fewer steps** fragments the fibre graph. The share of points carried by
 *    components of 8+ — "draws strokes, not dust", and a hard guard at 0.80 —
 *    sat at **0.826** here, with 3% of headroom. Every shortened variant
 *    swept falls through it: 5/26/1.6 gives 0.811 for almost no gain (p90
 *    5.86x -> 5.56x), 3/26/3.2 gives 0.678, 3/14/1.6 gives 0.53. Shortening a
 *    filament does not just shorten the drawn curve, it breaks the curve into
 *    dust, and dust is the failure this layer was rebuilt to escape.
 *
 *    ⚠️ That whole sweep predates two changes and cannot arbitrate again
 *    until it is re-run: the edge closed to 1.6, which took the share to
 *    0.701 and put it under the guard, and
 *    {@link POPULATION_COMPLEMENT_CORRELATION_STEPS} then took it back to
 *    **0.809**. The headroom is real again — 1.1% of it — and the direction
 *    of the finding is unchanged, but the specific variant numbers above were
 *    measured against an i.i.d. complement that no longer exists.
 *  - **A shorter step** would shorten runs in world units while leaving the
 *    topology — and therefore the stroke share — exactly intact, which is the
 *    lever that ought to work. It is spoken for: {@link
 *    POPULATION_STREAMLINE_STEP} is set against the SPRITE, not the field, and
 *    halving it merges consecutive points into a solid worm at three times the
 *    cost. The dotted-line reading is load-bearing.
 *
 * Coherence, re-measured across a twelve-variant sweep, spans 0.473–0.498
 * against 0.497 here — it barely moves at all, and it still cannot arbitrate
 * this. What arbitrates it is the dust floor, and the floor says stay.
 *
 * So the layer now draws runs at 4x the fabric's typical stroke where it drew
 * them at 1.5x, and that is a real, recorded regression against a look that
 * was accepted — not a thing this constant can fix. Closing it wants the
 * sprite footprint and the step re-solved together, at which point the point
 * count and the coverage budget come with them.
 *
 * ## Re-derived 2026-08-19 again, and this time the ceiling MOVED — because
 * ## it stopped being a constant
 *
 * All three numbers below are exactly what they were. What changed is that the
 * SPAN between them is now a function of the tissue the filament was born on
 * ({@link populationStreamlineSpan}), so "the longest run this layer draws" is
 * a property of the ground rather than of a constant. The paragraphs above
 * asked for one lever that could shorten the fringe without shortening the
 * corridors; the tissue is that lever, and it was already being sampled.
 *
 * Measured on the shipped 105,000-point placement, drawn runs in world units,
 * binned by the mean elliptical radius of each run:
 *
 * | band | p50 | p90 | p95 | max | forks/100 pts |
 * |---|---:|---:|---:|---:|---:|
 * | pre-rim < 0.95   | 5.00 -> 5.00  | 13.75 -> **12.50** | 17.50 -> 16.25 | 31.25 -> 31.25 | 1.93 -> 2.45 |
 * | mixed 0.95–1.15  | 11.25 -> 10.00 | 25.00 -> **20.00** | 27.50 -> 23.75 | 31.25 -> 31.25 | 3.21 -> 4.19 |
 * | outer 1.15–1.375 | 13.75 -> 10.00 | 26.25 -> **18.75** | 28.75 -> 22.50 | 31.25 -> 31.25 | 3.31 -> 5.24 |
 * | fringe >= 1.375  | 10.00 -> 7.50  | 22.50 -> **12.50** | 25.00 -> 15.00 | 31.25 -> 28.75 | 2.81 -> 5.11 |
 *
 * Layer-wide, p50 holds at 7.50 (it is pinned by the dotted-line coupling in
 * {@link POPULATION_STREAMLINE_STEP} and was never the target), p90 falls
 * 21.25 -> **17.50** and p99 30.00 -> 27.50. Against the fabric that is p90
 * 5.25x -> **4.32x** and p50 3.42x, unchanged. The spread p90/p50 goes 2.83 ->
 * 2.33 — narrower, still nothing like the uniform draw that read as felt.
 *
 * ⚠️ **The maxima do not move in the two inner bands, and that is the
 * construction and not a miss.** The key is read ONCE, where the filament is
 * seeded. A corridor filament draws its full 26 steps and then walks 32 world
 * units — a third of the field's half-width — so it can be born in the mixed
 * band and have its mean radius land in the outer one. Only the fringe's own
 * maximum falls, because only a fringe-BORN filament is short. Capping the
 * outer band's longest runs would need the length re-read as the walk travels,
 * which clips filaments at a density contour and puts back exactly the edge
 * {@link POPULATION_STREAMLINE_DENSITY_FLOOR} was lowered to remove.
 *
 * ## The dust floor is the segment budget. They are one number.
 *
 * The design asked this phase to hand back the segments
 * {@link POPULATION_COMPLEMENT_CORRELATION_STEPS} spent — 94,762 down to the
 * standing 87,964 — while holding the "strokes, not dust" guard at 0.80. Those
 * two requirements are the same quantity read twice, and they contradict each
 * other. The walk and the fork are both TREE moves: every segment either of
 * them writes joins a new point to one already placed, and neither ever closes
 * a cycle, so over that subgraph
 *
 * > **components = points − segments**, exactly, at every tuning.
 *
 * ⚠️ **That identity is no longer true of the whole drawn graph, and this
 * argument is written about the graph as it then was.**
 * {@link POPULATION_JOIN_CHANCE_MIXED} added a third move — a join, which
 * closes onto a strand already placed — and the general form is
 * `components = points − segments + cycles`, measured at 99 closed cycles in
 * 1,670 joins. Nothing below has to be re-derived: the walk and the fork are
 * still the only moves that can create a component, joins can only merge or
 * close, and so the exchange rate this section is about — one fork, one
 * segment, one component fewer — is exactly what it was. What the joins change
 * is the LEVEL: the layer now draws 96,609 segments at 8,490 components, and
 * the design's 87,964 is further out of reach than ever, for the same reason.
 *
 * 94,762 segments IS 10,238 components. 87,964 would be **17,036** — a 66%
 * rise, at a fixed 105,000 points, so a mean component of 6.2 points against a
 * guard that wants 8. It is not a coincidence that the layer last had that
 * many components under the i.i.d. complement, where the stroke share measured
 * **0.701**. Giving the segments back means giving the strand-survival fix
 * back; there is no third option, and the guard is the one the user's eye
 * ruled on.
 *
 * Swept anyway — some 300 parameterisations at 105,000 points — the best
 * segment count reachable at each floor:
 *
 * | constraint | best segments | what it costs |
 * |---|---:|---|
 * | stroke share >= 0.811 (as shipped) | **94,848** | nothing |
 * | >= 0.803, these two constants unchanged | 94,477 | the guard's whole margin |
 * | >= 0.803, MIN free (7/26) | 94,122 | the margin, and the floor moves |
 * | >= 0.800, MIN/MAX free (8/14) | 91,458 | the length spread, the corridors, the ladder |
 * | 87,964 (the design's number) | unreachable at any tuning | the complement fix |
 *
 * The exchange inside this phase is the same identity read once more, and it
 * is worth having as three rows because it is the whole of the tuning:
 *
 * | | segments | stroke share |
 * |---|---:|---:|
 * | before | 94,762 | 0.809 |
 * | + tissue-keyed length only | **93,440** | **0.772** (through the floor) |
 * | + tissue-keyed fork supply | 94,848 | 0.811 |
 *
 * The length ramp frees 1,322 segments and 3.7 points of stroke share; the
 * fork supply buys the share back and spends 1,408 segments doing it, because
 * a fork is a filament that did not start a component. There is no ordering of
 * those two that keeps both.
 *
 * So this phase lands at **94,848 segments, +0.09%** — the ladder above for
 * free, and the recovery recorded as impossible rather than approximated.
 *
 * ⚠️ The earlier sweep's finding survives intact and was re-confirmed: a
 * global shortening falls straight through the floor. What it could not see is
 * WHY, and the why is arithmetic — the guard's unit is EIGHT points and
 * {@link POPULATION_STREAMLINE_MIN_STEPS} is 6. Out in the fringe the
 * complement accepts nearly everything, so a filament's step count is its
 * component's point count; any law that pushes filaments onto MIN puts them
 * under the guard by construction, whatever the ceiling does. That is what
 * {@link POPULATION_STREAMLINE_REACH_FLOOR} and the raised fork supply in
 * {@link populationBranchRecordChance} are for, and between them the layer
 * shortens its fringe by 44% at p90 while the stroke share goes 0.809 ->
 * **0.811**.
 *
 * Worker CPU, min-of-9 at 105,000 points on one machine: **+0.3%**, which is
 * well inside the run-to-run spread. The pass runs 15.9% more filaments
 * (12,586 -> 14,581) for 1.3% more field evaluations (2.205 -> 2.235 per
 * placed point): a filament costs one seed attempt and its steps, and the
 * steps are the point budget, which did not move.
 */
export const POPULATION_STREAMLINE_MIN_STEPS = 6;
export const POPULATION_STREAMLINE_MAX_STEPS = 26;
export const POPULATION_STREAMLINE_LENGTH_EXPONENT = 1.6;

/**
 * How much tissue a filament needs under it to draw its full length — the
 * single key the length, the fork rate and the fork SUPPLY all ride.
 *
 * `reach = min(1, density / this)`. One over the halo's own density, read
 * where the filament STARTS: at the seed for fresh tissue, at the parent point
 * for a fork (the reservoir carries it, see {@link PopulationPlacementState}).
 * Nothing new is evaluated for it — both are samples the walk already made.
 *
 * ## Why the START and not the whole walk
 *
 * A walk that re-read the tissue every step would shorten as it left the
 * corridor, which is a different construction: it would clip filaments at the
 * density contour and put a soft edge back exactly where
 * {@link POPULATION_STREAMLINE_DENSITY_FLOOR} was lowered to remove one. Read
 * once, the key says what tissue a filament was BORN in, and a filament born
 * in a corridor keeps its arc wherever it ends up. The cost is visible in the
 * measurements below and is stated rather than hidden: the outer band's
 * longest runs do not move, because they are corridor filaments that walked
 * out, and a start-keyed law cannot reach them.
 *
 * ## Why 0.40
 *
 * Measured over the shipped placement, `density` at the point each filament
 * was seeded from runs p50 **0.413** for fresh tissue and **0.260** for fork
 * parents, and the placed points' own filaments carry a seed density of p50
 * 0.414 / 0.332 / 0.216 / 0.122 across the pre-rim / mixed / outer / fringe
 * bands. 0.40 is the value that leaves the two inner bands at or near full
 * reach and takes the outer and fringe to reach 0.54 and 0.31 — spans of 0.58
 * and 0.36 once {@link POPULATION_STREAMLINE_REACH_FLOOR} is in. That is the
 * ladder the tier design asks for, keyed to the tissue's own numbers rather
 * than to a radius.
 *
 * ⚠️ It is NOT {@link POPULATION_TAPER_DENSITY_FULL}. That constant answers
 * "as dense as the layer ever DRAWS" and saturates at 0.6, above the density
 * three quarters of all seeds sit at; used here it would shorten the corridors
 * too, which is the naive global shortening the sweep in
 * {@link POPULATION_STREAMLINE_MIN_STEPS} already showed falls through the
 * dust floor.
 */
export const POPULATION_STREAMLINE_REACH_DENSITY = 0.4;

/**
 * The share of the length span the emptiest tissue still draws.
 *
 * Not zero, and the floor is the dust guard's arithmetic rather than caution.
 * The guard counts points on fibre components of EIGHT or more, and
 * {@link POPULATION_STREAMLINE_MIN_STEPS} is 6 — below it. Out in the fringe
 * the complement accepts nearly everything, so a filament's step count IS its
 * component's point count, and a law that collapses the span onto MIN puts
 * every fringe filament under the guard by construction. Measured with the
 * fork supply left where it was, a span floor of 0 takes the layer-wide share
 * from 0.809 to **0.763**, which is the "dust" failure in its purest form —
 * not a filament that got shorter but a stroke that stopped being one.
 *
 * 0.08 leaves the emptiest ground drawing 6-7 steps, and the fringe's own
 * median seed density (0.122, measured) drawing 6-13 — so a typical fringe
 * filament is still a stroke on its own, and the ones that fall short are what
 * the raised fork supply in {@link populationBranchRecordChance} catches.
 */
export const POPULATION_STREAMLINE_REACH_FLOOR = 0.08;

/**
 * The tissue's reach at one density, in `[0, 1]`. Zero is the open fringe;
 * one is corridor ground.
 */
export function populationTissueReach(density: number): number {
  return clamp01(density / POPULATION_STREAMLINE_REACH_DENSITY);
}

/**
 * The length span, in steps, a filament born on this tissue draws from.
 *
 * `MIN + span * u^EXPONENT` keeps its skewed shape exactly — what moves is
 * where the tail ends. Corridor ground draws the full 20 steps of span the
 * layer always drew; the open fringe draws 1.6 of them.
 */
export function populationStreamlineSpan(density: number): number {
  return (POPULATION_STREAMLINE_MAX_STEPS - POPULATION_STREAMLINE_MIN_STEPS)
    * (POPULATION_STREAMLINE_REACH_FLOOR
      + (1 - POPULATION_STREAMLINE_REACH_FLOOR)
        * populationTissueReach(density));
}

/**
 * How much of the previous heading survives one step, before the field's own
 * direction is mixed in.
 *
 * This is the knob that decides whether the halo has CORRIDORS, and finding
 * that out took a measurement no picture would have given. Orientation
 * coherence — the metric that separates a drawn thread from noise — is flat
 * within noise across the whole range, 0.32 to 0.34, so it cannot arbitrate
 * here at all. What moves is the alignment of NEIGHBOURING filaments: tangents
 * of points within three world units on different filaments agree at
 *
 *   0.709 at full field-following, 0.706 here, 0.662 at 0.80,
 *   and 0.645 with the field switched off entirely — against 0.637 for random
 *   headings.
 *
 * So at 0.80 the field had almost stopped mattering and the layer was a set of
 * independent persistent random walks: still curves, still drawn, still tissue
 * by the coherence measure, but with no reason for two of them to run
 * together. Parallel bundles are what a corridor IS.
 *
 * The cost of holding onto them is curvature: 18.8 degrees of turn per step
 * here, a radius of 3.8 world units, against 8.4 degrees at 0.80. Some
 * persistence is still worth having — it lets a filament leave the flow line
 * it was born on, which is where the long arcs come from — but the bundling is
 * worth more, and the reference prototype ran at effectively zero persistence
 * and was judged acceptable in character.
 */
export const POPULATION_STREAMLINE_STIFFNESS = 0.55;

/**
 * Per-step heading noise, in radians, at full strength.
 *
 * Scaled per filament by its own draw, so some run nearly true and others
 * meander. The variation is the point: a constant wander gives every filament
 * the same nervous quality, which is another uniformity to read through.
 */
export const POPULATION_STREAMLINE_WANDER = 0.22;

/**
 * Share of filaments that start on an existing filament instead of on fresh
 * tissue, on CORRIDOR ground.
 *
 * This is where the branch points come from. A field of unconnected curves
 * reads as combed fibre; tissue bifurcates. The child inherits its parent's
 * vertical offset so the two actually meet in three dimensions rather than
 * crossing at different heights, and the first segment is emitted from the
 * PARENT's own point index, so the fork is drawn and not merely implied.
 *
 * Unchanged at 0.42, and now the DENSE end of a ramp: see
 * {@link POPULATION_STREAMLINE_BRANCH_SHARE_OPEN}.
 */
export const POPULATION_STREAMLINE_BRANCH_SHARE = 0.42;

/**
 * The same share on open ground, where the filaments are short.
 *
 * Terminal tissue arborizes: where a run cannot be long it should be BUSHY,
 * or shortening it just thins the layer. So the fork rate rides
 * {@link populationTissueReach} inversely — 0.85 in the open fringe against
 * 0.42 in the corridors, keyed on the density at the PARENT point, which the
 * reservoir already carries for the child's own length.
 *
 * ⚠️ **This constant alone cannot move the fork rate, and finding that out is
 * what put {@link populationBranchRecordChance} here.** A fork needs a live
 * reservoir slot, and slots are minted per emitted point at
 * `BRANCH_RECORD_CHANCE`. Measured on the shipped 105,000-point placement,
 * 4,643 slots are minted (0.05 of the points at generation < 2, less the ring
 * overwrites) and **4,061 are consumed — 87% of the entire supply**. Driving
 * this share from 0.42 to 1.0 with nothing else changed moves
 * the fork count 4,061 -> 4,352, +7%, and the layer's fork-point share not at
 * all (2.75% -> 2.77%). The seed-time share decides WHICH slots become
 * children once there are slots to choose between; it is not the rate.
 */
export const POPULATION_STREAMLINE_BRANCH_SHARE_OPEN = 0.85;

/** The fork share at one tissue density — the reach key, read inversely. */
export function populationBranchShare(density: number): number {
  return POPULATION_STREAMLINE_BRANCH_SHARE_OPEN
    + (POPULATION_STREAMLINE_BRANCH_SHARE
      - POPULATION_STREAMLINE_BRANCH_SHARE_OPEN)
      * populationTissueReach(density);
}

/** Fork half-angle range, in radians. Wide enough to read as a branch at the
 *  filament scale and narrow enough that the child still belongs to the
 *  parent's corridor. */
export const POPULATION_STREAMLINE_FORK_MIN = 0.42;
export const POPULATION_STREAMLINE_FORK_MAX = 1.15;

/**
 * How many times a filament may be branched from, counting its own descent.
 *
 * Without a cap the fork rule percolates: a child is as eligible a parent as
 * its parent was, so one component swallowed 24% of every point placed while
 * the median component stayed at two. That is not a wide spread of lengths, it
 * is one tangle and a lot of dust. The Cells' own fabric caps generations for
 * the same reason (`MAX_PASSIVE_EDGE_GENERATIONS`). Two keeps the fork visible
 * — a trunk, a branch, a twig — and stops the network closing on itself.
 */
export const POPULATION_STREAMLINE_MAX_GENERATION = 2;

/** How many walk states are held as branch candidates. A ring, overwritten in
 *  place: the pass allocates once and never grows. Large enough that children
 *  are drawn from across the whole field rather than from the last few
 *  filaments walked. */
const BRANCH_RESERVOIR = 4096;
/** Chance that a point emitted on CORRIDOR ground is recorded as a branch
 *  candidate. Unchanged at 0.05: low, so the reservoir turns over slowly and
 *  stays spatially mixed — a filament of average length offers about one place
 *  to fork from. */
const BRANCH_RECORD_CHANCE = 0.05;
/** And on open ground, where the same rate would starve the forks.
 *
 *  This is the other half of the fork PROBABILITY, and the half that actually
 *  carries it — see {@link POPULATION_STREAMLINE_BRANCH_SHARE_OPEN} for the
 *  measurement that says so. Raising it where the tissue is thin is what pays
 *  for the shortened runs out there: a filament that draws six steps in the
 *  open fringe is under the dust guard on its own, and a fork attaches it to
 *  its parent's component instead of leaving it as a speck. Measured, with
 *  {@link POPULATION_STREAMLINE_REACH_FLOOR} at 0.08 the layer-wide stroke
 *  share runs **0.772 at 0.05, 0.811 at 0.12, 0.838 at 0.16** — the floor is
 *  bought here and nowhere else.
 *
 *  ⚠️ It is not free in segments, and the exchange rate is exact: a fork is a
 *  TREE move, so every fork is a filament that did NOT start a component and
 *  is therefore one more segment. (That used to be stated as an identity over
 *  the whole graph — `components = points - segments` — which held while the
 *  graph was a forest and does not now that
 *  {@link POPULATION_JOIN_CHANCE_MIXED} closes cycles in it. The exchange rate
 *  for a FORK is unchanged; see that constant for the general form.) 0.12 is
 *  where the dust floor clears with a point of margin and the segment count
 *  comes out at or under where it started. */
const BRANCH_RECORD_CHANCE_OPEN = 0.12;

/** How likely a point on this tissue is to be recorded as a place to fork
 *  from. The reach key again, read inversely: thin ground offers more. */
export function populationBranchRecordChance(density: number): number {
  return BRANCH_RECORD_CHANCE_OPEN
    + (BRANCH_RECORD_CHANCE - BRANCH_RECORD_CHANCE_OPEN)
      * populationTissueReach(density);
}

/** A slot is CONSUMED when it is forked from.
 *
 *  Without this the fork rule percolates in breadth even with the generation
 *  cap on depth: early in the pass the reservoir holds two or three entries,
 *  every fork lands on them, and the first filaments walked end up with
 *  hundreds of children each. Measured on a 20,000-point pass, one component
 *  held 36% of every point placed while the same constants at 130,000 held
 *  2.6% — a structure that changes shape with the buffer size is not a
 *  structure. One record, one child, and a component is a small dendritic unit
 *  at any count. */
const BRANCH_CONSUMED = -1;

/** Density below which a walk stops. The envelope has closed and there is no
 *  population left to state; carrying on would draw a filament trailing off
 *  into vacuum.
 *
 *  Low, because a walk is not a candidate: an independent draw at this density
 *  almost never lands, but a filament that has already reached here is real
 *  and its last few points are the halo's outer silhouette. At 0.02 the
 *  outermost fifth of the envelope carried a twentieth of the points it should
 *  and the halo ended on a visible edge; this recovers it for no extra work. */
export const POPULATION_STREAMLINE_DENSITY_FLOOR = 0.01;

/**
 * How much thinner than the Cells' own slab the halo is.
 *
 * RE-DERIVED for filaments, and it did not move. The reasoning changed
 * completely; the number did not, which is worth writing down because the
 * obvious expectation was the opposite.
 *
 * The old bound came from projection smear on INDEPENDENT points: points at
 * different heights along one corridor project to different screen positions,
 * a vertical spread of sigma smears the ground plane by
 * `sigma / tan(elevation)`, and holding that under half the dominant fibre
 * scale needed sigma <= 1.91 against a mean Cell thickness of 4.1. **That
 * argument is void.** A filament's offset is drawn once, so the whole curve
 * translates on screen together, and a translated curve is still a curve.
 *
 * Two things replaced it, from opposite directions, and they agree:
 *
 *  1. Measured, orientation coherence at the production camera falls
 *     MONOTONICALLY as the slab thickens — 0.364 at 0.30, 0.332 at 0.45, 0.301
 *     at 0.62, 0.242 at full thickness — and the same holds at a low orbit.
 *     Not because a filament smears, but because independent filaments overlap
 *     in projection: a thicker slab puts more of them along one sight line and
 *     their crossings are isotropic.
 *  2. The fold is untouched at an RMS of 2.02, and the halo is a warped ribbon
 *     only while the fold carries more of the vertical extent than the
 *     flattened spread does. That inverts at about 0.48 — so the reference
 *     prototype's 0.62 is not admissible at all, whatever it looks like from
 *     overhead, because it turns the layer into a plane and an edge-on camera
 *     into a line.
 *
 * There is a third reason to leave it alone, and it is methodological: this
 * value was in the build the user judged and accepted. Changing the thickness
 * and adding the fibres in one step would confound the next judgement.
 *
 * It is also the disk to the Cells' bulge, which is the shape the
 * bulge-and-disk reading wanted anyway.
 */
export const POPULATION_FIELD_FLATTEN = 0.3;

/**
 * Per-point share of the vertical offset, against the per-filament share.
 *
 * Composed as `g * sqrt(1 - J^2) + jitter * J` so the MARGINAL distribution at
 * every point is exactly the Gaussian slab the Cells are folded into —
 * unchanged, provably, not approximately — while consecutive points on one
 * filament stay correlated at 0.984. Without the jitter a filament is a
 * perfect ribbon and reads as extruded; with it the strand has grain.
 */
export const POPULATION_STREAMLINE_JITTER = 0.18;

/** Deterministic stream seed. Presentation only: the halo carries no id, no
 *  time, and no universe seed, so this salt says nothing about any Cell — it
 *  only makes the same picture come back on every reload. */
export const POPULATION_FIELD_SEED = 0x00c0ffee;

/**
 * Bound on the un-enveloped tissue term, used as a rejection majorant.
 *
 * `body` is `0.015 + broad^2 * 0.55 + middle * 0.08 + broadRidge * 0.28
 * + ridge * 0.52 + core * 0.10 - cavity * 0.68` with every factor in [0, 1],
 * so it cannot exceed the sum of the positive coefficients. Analytic, not
 * empirical: a majorant that is ever wrong silently biases the distribution.
 */
const BODY_MAX = 1.545;
/** Bound on the boundary warp the envelope at this edge carries — the law's
 *  own number, NOT a restatement of it. It grows with the edge: the warp is
 *  re-scaled to the span the envelope smears it across, so a majorant taken
 *  against the base amplitude would be too tight here and would silently thin
 *  the outer fringe by rejecting candidates it never evaluated. */
const BOUNDARY_WARP_MAX = boundaryWarpBound(POPULATION_FIELD_OUTER_EDGE);
/** Where the law's envelope starts closing. Mirrors `tissueField`. */
const ENVELOPE_INNER = 0.61;

/** Field evaluations per requested point before the pass gives up and reports
 *  what it has. Measured cost is 1.5 evaluations per placed point, so this is
 *  twenty times the expected work — it exists so a mis-tuned constant degrades
 *  into a thinner field instead of an infinite loop. */
const WORK_CEILING_PER_POINT = 30;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** The fibre at one warped coordinate, in [0, 1]. */
export function populationFibreAt(qx: number, qz: number): number {
  const baseA = 1 - Math.abs(
    valueNoise2(qx, qz, POPULATION_FIBRE_SCALE_A, FIBRE_SALT_A),
  );
  const baseB = 1 - Math.abs(valueNoise2(
    qx * POPULATION_FIBRE_WARP_B + 31,
    qz * POPULATION_FIBRE_WARP_B - 17,
    POPULATION_FIBRE_SCALE_B,
    FIBRE_SALT_B,
  ));
  return baseA ** POPULATION_FIBRE_POWER_A * POPULATION_FIBRE_MIX_A
    + baseB ** POPULATION_FIBRE_POWER_B * POPULATION_FIBRE_MIX_B;
}

/**
 * Unit direction along the fibre's crest at one warped coordinate — the
 * perpendicular to the gradient, which is the direction in which the fibre
 * changes least.
 *
 * The gradient is taken in the WARPED frame and the step is then made in world
 * coordinates, which is an approximation: the warp's Jacobian is not the
 * identity. Measured, it costs nothing that matters — a walk built this way
 * still holds a mean fibre value far above the tissue's, so it is tracking
 * ridges — and the exact version needs four more twelve-octave evaluations per
 * step, tripling the pass for a correction smaller than the per-step wander
 * deliberately added on top.
 *
 * Returns `false` where the fibre is locally flat and there is no crest to
 * follow; the caller keeps its heading.
 */
function crestDirection(
  qx: number,
  qz: number,
  out: { x: number; z: number },
): boolean {
  const h = POPULATION_FIBRE_GRADIENT_ARM;
  const gx = populationFibreAt(qx + h, qz) - populationFibreAt(qx - h, qz);
  const gz = populationFibreAt(qx, qz + h) - populationFibreAt(qx, qz - h);
  const length = Math.sqrt(gx * gx + gz * gz);
  if (length < 1e-9) return false;
  // Perpendicular to the gradient: along the ridge, not across it.
  out.x = -gz / length;
  out.z = gx / length;
  return true;
}

/** Probability that a candidate survives the complement. Zero at and above
 *  twice the knee — structurally, not by tuning. */
export function populationComplementAcceptance(resolvedCoverage: number): number {
  return clamp01(
    1 - resolvedCoverage / (2 * POPULATION_FIELD_COMPLEMENT_KNEE),
  );
}

/** Highest `resolvedCoverage` any placed point can carry. The buffer's own
 *  statement of "zero where the addressable Cells are dense". */
export const POPULATION_FIELD_COVERAGE_CEILING =
  2 * POPULATION_FIELD_COMPLEMENT_KNEE;

/**
 * How far the complement's decisions agree along one filament, in walk steps.
 *
 * ## The bug this fixes is a JOINT law, not a marginal one
 *
 * The acceptance probability at every point is exactly
 * {@link populationComplementAcceptance} and this constant does not move it by
 * one part in a billion. What it changes is which candidates are dropped
 * TOGETHER, and that was the whole of the damage: an independent draw is
 * correct per point and ruinous per stroke. On ground the Cells half-occupy it
 * keeps every other candidate, and since a rejection breaks the strand, a
 * filament crossing that ground comes out as beads rather than as one stroke
 * that stops once.
 *
 * Measured on the shipped 105,000-point placement, over the band where `keep`
 * runs 0.15–0.85 — `resolvedCoverage` 0.09–0.51, 27,062 points, a quarter of
 * the layer — the share carried by fibre components of eight or more was
 * **0.203**, against 0.697 for the layer as a whole. That band IS the
 * transition between the addressable Cells and the halo, the one thing the
 * mixed register exists to express, and it was the one place the layer drew
 * dust.
 *
 * ## The construction, and why it is free
 *
 * The decision rides a latent AR(1) variate carried on the walk instead of
 * being drawn fresh:
 *
 * > `z <- rho * z + sqrt(1 - rho^2) * g`, accept where `z < invPhi(keep)`.
 *
 * A Gaussian copula, and the proof that it costs nothing is the same one
 * {@link POPULATION_STREAMLINE_JITTER} already turns on: `g` is standard
 * normal and `z` is standard normal, so `rho * z + sqrt(1 - rho^2) * g` is
 * standard normal again — the marginal is preserved by the recursion, exactly,
 * not approximately. Therefore `P(z < invPhi(keep)) = keep` at every single
 * point, not on average over the layer. The density statement the complement
 * makes is untouched; only the correlation between neighbouring decisions
 * moves. The one wrinkle is {@link inverseStandardNormal}'s own approximation
 * error, which perturbs that probability by at most 2.7e-10.
 *
 * A fresh variate is drawn at every filament seed, forked children included —
 * see the seeding block for why inheriting the parent's would be wrong.
 *
 * Both halves of that were measured rather than asserted. Driven through this
 * module's own decision at 200,000 candidates per bin, the empirical accept
 * rate matches `keep` to a worst deviation of **5.9e-3 over 21 bins**, against
 * a standard error the correlation inflates to 3.9e-3 — 1.5 sigma, no bias.
 * End to end on the real placement, the statistic the whole claim is about —
 * the mean `resolvedCoverage` the placed points sit at, which IS the density
 * statement — reads 0.06840 +/- 0.00092 across six seeds before and 0.06887
 * +/- 0.00054 after: a difference of means of 0.68%, half of one seed's own
 * spread. The share of points landing inside the resolved rim, 0.490, is
 * likewise unmoved.
 *
 * ## Why seven steps
 *
 * For an AR(1) the correlation at lag `k` is `rho^k`, so a length `l` where it
 * has fallen to `1/e` gives `rho = exp(-1/l)`. Swept at 105,000 points:
 *
 * | l | rho | keep 0.15–0.85 band | layer-wide | segments |
 * |--:|----:|--------------------:|-----------:|---------:|
 * | i.i.d. | — | 0.203 | 0.697 | 88,050 |
 * | 4  | 0.7788 | 0.473 | 0.784 | 93,551 |
 * | 5  | 0.8187 | 0.514 | 0.800 | 94,179 |
 * | 6  | 0.8465 | 0.540 | 0.805 | 94,504 |
 * | 7  | 0.8669 | **0.542** | **0.809** | 94,762 |
 * | 8  | 0.8825 | 0.562 | 0.815 | 95,082 |
 * | 10 | 0.9048 | 0.584 | 0.819 | 95,203 |
 * | 12 | 0.9200 | 0.590 | 0.826 | 95,528 |
 * | 20 | 0.9512 | 0.628 | 0.841 | 96,235 |
 *
 * The curve is still climbing at 20, and the reason to stop well inside it is
 * what the correlation is FOR. A run of agreeing decisions as long as a whole
 * filament stops expressing the tissue at all: the complement would keep or
 * drop entire strands rather than the parts of them that cross Cells, and
 * interdigitation — a filament re-emerging on the far side of a clump — is the
 * reading this layer's complement exists to produce. Seven steps is 8.75 world
 * units against a drawn run whose median is 7.50, so a typical strand gets ONE
 * decision about the ground it is crossing and a long one still gets several.
 * It takes 80% of the gain the runaway end of the sweep offers.
 *
 * ## What it costs
 *
 * Segments, and that is the honest price of the fix rather than an overrun:
 * **88,050 -> 94,762, +7.6%**, because every bead that becomes part of a
 * stroke again is a segment that was not being drawn.
 *
 * ⚠️ **That price is not refundable, and the reason is stated once, in
 * {@link POPULATION_STREAMLINE_MIN_STEPS}: a walk step and a fork are tree
 * moves, so over that subgraph `components = points - segments`.** The 6,712
 * segments this constant costs ARE the 6,712 fragments it healed. A later
 * phase asked for them back while holding the stroke share at 0.80 and the two
 * turned out to be the same number. The layer sits at 96,609 segments and a
 * stroke share of 0.844 — the last of which is
 * {@link POPULATION_JOIN_CHANCE_MIXED}, whose joins are the only segments here
 * that are NOT accounted for by that identity, and which lift the band this
 * constant is about from 0.55 to 0.65.
 *
 * The draws are
 * primitive-bound (halving primitives gives 0.43–0.45x the time), so that is
 * about +0.15 ms of the fibres' 1.97 ms at 4K — a twentieth of the adaptive
 * controller's own high-to-med step, and the layer's point budget and both
 * draw calls are untouched. Worker CPU, min-of-9 at 105,000 points: 142.3 ->
 * 151.2 ms, +6.2%, once, before the layer is on screen.
 *
 * ⚠️ Point light falls 8.2% and fibre light RISES 3.3%, but neither is this
 * constant's doing — both belong to {@link POPULATION_END_TAPER}, which ships
 * alongside it, and the fibre gain is the extra segments outweighing the
 * fades. Do not read either number as a cost of the correlation.
 */
export const POPULATION_COMPLEMENT_CORRELATION_STEPS = 7;
const COMPLEMENT_RHO = Math.exp(-1 / POPULATION_COMPLEMENT_CORRELATION_STEPS);
const COMPLEMENT_INNOVATION = Math.sqrt(1 - COMPLEMENT_RHO * COMPLEMENT_RHO);

/** Acklam's rational approximation to the standard normal's inverse CDF, in
 *  its three regions. */
const ACKLAM_LOW = 0.02425;
const ACKLAM_A = [
  -3.969683028665376e+1, 2.209460984245205e+2, -2.759285104469687e+2,
  1.383577518672690e+2, -3.066479806614716e+1, 2.506628277459239e+0,
];
const ACKLAM_B = [
  -5.447609879822406e+1, 1.615858368580409e+2, -1.556989798598866e+2,
  6.680131188771972e+1, -1.328068155288572e+1,
];
const ACKLAM_C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e+0,
  -2.549732539343734e+0, 4.374664141464968e+0, 2.938163982698783e+0,
];
const ACKLAM_D = [
  7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e+0,
  3.754408661907416e+0,
];

/**
 * The standard normal's inverse CDF — the threshold the correlated complement
 * compares its latent variate against.
 *
 * Peter Acklam's rational approximation: a central branch on `p - 0.5` and two
 * tail branches on `sqrt(-2 ln p)`, published relative error below 1.15e-9. No
 * refinement step, and none is wanted — what this feeds is a comparison, so
 * the only error that means anything is the one it makes in the ACCEPTANCE
 * PROBABILITY, and that is bounded by `|Phi(invPhi(p)) - p|`. Measured against
 * a 50-digit reference over the whole double-precision range of `p`, in steps
 * of 1e-3 in the quantile: **2.7e-10**, worst at `p ~= 0.85`. In the quantile
 * itself the worst absolute error over `|x| <= 6` is 8.8e-9.
 *
 * ⚠️ Past `|x| = 6` the sweep's error climbs to 0.08 at `|x| = 8.3`, and that
 * is the DOUBLE and not the approximation: at `p > 1 - 1e-16` the `1 - p` the
 * upper branch takes has already lost every significant digit it had. It costs
 * nothing here — the caller's `keep` reaches 0 and 1 exactly, on ground at
 * twice the knee and across the open fringe, and both are handled before this
 * is ever called.
 *
 * Returns +/-Infinity at the endpoints, which is the mathematically right
 * answer and never a NaN; the caller still short-circuits both, because a
 * comparison against an infinity is a branch it can skip entirely.
 */
export function inverseStandardNormal(p: number): number {
  if (!(p > 0)) return p === 0 ? -Infinity : NaN;
  if (p >= 1) return p === 1 ? Infinity : NaN;
  if (p < ACKLAM_LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((ACKLAM_C[0] * q + ACKLAM_C[1]) * q + ACKLAM_C[2]) * q
      + ACKLAM_C[3]) * q + ACKLAM_C[4]) * q + ACKLAM_C[5])
      / ((((ACKLAM_D[0] * q + ACKLAM_D[1]) * q + ACKLAM_D[2]) * q
        + ACKLAM_D[3]) * q + 1);
  }
  if (p > 1 - ACKLAM_LOW) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((ACKLAM_C[0] * q + ACKLAM_C[1]) * q + ACKLAM_C[2]) * q
      + ACKLAM_C[3]) * q + ACKLAM_C[4]) * q + ACKLAM_C[5])
      / ((((ACKLAM_D[0] * q + ACKLAM_D[1]) * q + ACKLAM_D[2]) * q
        + ACKLAM_D[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((ACKLAM_A[0] * r + ACKLAM_A[1]) * r + ACKLAM_A[2]) * r
    + ACKLAM_A[3]) * r + ACKLAM_A[4]) * r + ACKLAM_A[5]) * q
    / (((((ACKLAM_B[0] * r + ACKLAM_B[1]) * r + ACKLAM_B[2]) * r
      + ACKLAM_B[3]) * r + ACKLAM_B[4]) * r + 1);
}

/**
 * One step of the complement's latent chain, given the previous value and a
 * fresh standard normal.
 *
 * `rho * z + sqrt(1 - rho^2) * g`: the whole of the construction, and the
 * reason it is stated as a function rather than written inline is that the
 * marginal it preserves is the only thing making the correlation free, so the
 * claim has to be checkable against the code the walk actually runs.
 */
export function populationComplementVariate(
  previous: number,
  gaussian: number,
): number {
  return previous * COMPLEMENT_RHO + gaussian * COMPLEMENT_INNOVATION;
}

/**
 * Whether a candidate carrying `variate` survives a complement of `keep`.
 *
 * Both ends are decided here and not by {@link inverseStandardNormal}, because
 * `keep` reaches both exactly: one across the whole open fringe, which is also
 * the hot path, and zero on ground at twice the knee, where nothing may ever
 * be drawn. `invPhi` answers +/-Infinity there, so this is a short-circuit and
 * not a special case — but a NaN would be one, and that is what a threshold
 * arithmetic on an infinity could produce.
 */
export function populationComplementAccepts(
  variate: number,
  keep: number,
): boolean {
  if (keep >= 1) return true;
  if (keep <= 0) return false;
  return variate < inverseStandardNormal(keep);
}

/**
 * ANASTOMOSIS — how often a walk CLOSES onto a strand it is passing.
 *
 * A fork is a tree move: it adds a curve and never a circuit. Until this
 * constant the layer drew nothing else, and the consequence was exact rather
 * than approximate — the drawn graph was a FOREST, so `components = points -
 * segments`, and 105,000 points at 94,890 segments IS **10,110 separate
 * pieces**. Ten thousand pieces is not what "one basically connected network"
 * reads as, and the missing move is the one a network's signature actually
 * needs beside bifurcation: CLOSED CELLS.
 *
 * So a stepping walk may close onto a nearby point ANOTHER filament already
 * placed: one segment, from that point to the one just emitted. Newest index
 * second, exactly as a fork writes it, so the segment buffer stays monotone in
 * its larger endpoint and {@link populationSegmentsForPointPrefix} is still a
 * binary search — the plexus costs the quality cascade nothing.
 *
 * ## The rate rides the COMPLEMENT's own keep, and that is not a radius
 *
 * `keep = 1 - coverage / (2 * KNEE)` is this layer's own statement of how much
 * of the ground under a point is still unresolved. The rate is
 *
 * > `keep * (OPEN + (MIXED - OPEN) * 4 * keep * (1 - keep))`
 *
 * — a parabola in `keep`, which is zero where either population is absent and
 * one where they half-occupy the ground together, on a floor that survives out
 * in the open, all multiplied by `keep` so that ground the Cells own draws
 * nothing at all. It peaks at **5.4% per accepted point at keep 0.67**
 * (coverage 0.20), sits at 0.4% across the whole open fringe, and is under
 * 0.8% below keep 0.15 — where, by the complement's own construction, there is
 * almost nothing placed to join anyway.
 *
 * ⚠️ **MEASURED, and it is the finding that matters most here: the band the
 * ladder instrument calls "mixed" (elliptical radius 0.95–1.15) is NOT where
 * the two registers mix.** Over the shipped placement the `keep` at placed
 * points runs, by radius band:
 *
 * | band | keep p10 | p50 | share under 0.95 |
 * |---|---:|---:|---:|
 * | pre-rim < 0.95   | 0.358 | **0.737** | 92.9% |
 * | mixed 0.95–1.15  | 0.918 | 1.000 | 17.4% |
 * | outer 1.15–1.375 | 1.000 | 1.000 | 0.0% |
 * | fringe >= 1.375  | 1.000 | 1.000 | 0.0% |
 *
 * The addressable Cells' coverage is spent well before radius 0.95, so the
 * transition this phase exists to knit — the one
 * {@link POPULATION_COMPLEMENT_CORRELATION_STEPS} measured as "keep 0.15–0.85,
 * a quarter of the layer" — lives INSIDE the band the instrument calls
 * pre-rim. A coverage-keyed rate therefore peaks there, and any rate that
 * peaked in the 0.95–1.15 annulus instead would have to be keyed on radius,
 * which is the one key this file does not take. Read in the complement's own
 * coordinate the ladder is unambiguous (105,000 points):
 *
 * | ground | points | junctions/100 before | after | join ends/100 |
 * |---|---:|---:|---:|---:|
 * | Cell ground   keep < 0.15  |    597 | 0.30 | 0.50 | 1.17 |
 * | transition    0.15–0.85    | 26,796 | 2.06 | **6.95** | 7.57 |
 * | rim-adjacent  0.85–0.999   | 21,729 | 4.05 | 6.76 | 3.69 |
 * | open          keep ~ 1     | 55,878 | 5.03 | 5.73 | 0.80 |
 *
 * Junction density used to climb monotonically OUTWARD (that is the fork
 * ramp: {@link populationBranchRecordChance} mints more slots in thin tissue).
 * It now peaks in the transition, which is the whole request. By radius the
 * same numbers read 2.60 -> **6.88** / 4.24 -> 5.87 / 5.30 -> 6.02 / 5.23 ->
 * 5.58 across pre-rim / mixed / outer / fringe — the peak is in the band that
 * CONTAINS the transition, not in the one named after it.
 *
 * ## What it bought
 *
 * The "before" column is THIS code with the two rates at zero, not the phase
 * before it: a join costs one draw from the shared stream at every accepted
 * point, so the placement is a different realisation either way, and 94,848
 * segments became 94,890 without a single join being drawn. Reading the two
 * arms against each other is what isolates the joins from the shift.
 *
 * | | before | after |
 * |---|---:|---:|
 * | segments | 94,890 | **96,609** (+1.8%) |
 * | components | 10,110 | **8,490** |
 * | largest component | 129 pts (0.12%) | **1,722 pts (1.64%)** |
 * | dust floor (points on components >= 8) | 0.8099 | **0.8443** |
 * | stroke share in the transition band | 0.5395 | **0.6482** |
 * | fork points / 100 | 4.05 | 4.11 |
 *
 * The stroke share is the one to read twice: the correlated complement lifted
 * that band from 0.203 to about 0.55 and could go no further, because what
 * remains is filaments that stop at a clump and filaments that start past it.
 * A join is the only move that can attach those to each other, and it buys
 * another 10.9 points of the band.
 *
 * ## The rate, chosen against the segment line
 *
 * | (open, mixed) | joins | segments | components | largest | dust |
 * |---|---:|---:|---:|---:|---:|
 * | off             |     0 | 94,890 | 10,110 | 0.12% | 0.8099 |
 * | 0.002 / 0.045   |   836 | 95,738 |  9,295 | 0.39% | 0.8299 |
 * | **0.004 / 0.09**| **1,670** | **96,609** | **8,490** | **1.64%** | **0.8443** |
 * | 0.005 / 0.11    | 2,002 | 96,992 |  8,130 | 1.99% | 0.8535 |
 *
 * The budget line is ~97,000 drawn segments — priced in GPU primitives, since
 * both halo draws are primitive-bound and near-linear in count (halving them
 * gives 0.43–0.45x the time), so 1,719 more segments is about +0.04 ms of the
 * fibres' 1.97 ms at 4K against an adaptive-controller step of 2.64 ms. The
 * 0.005 row reaches 96,992 and leaves nothing; this row clears it by 391.
 *
 * ⚠️ **What the cap produces is a LOCAL plexus, and percolation is measurably
 * just past the line.** 1,571 of these joins merge two components and 99 close
 * a cycle inside one. Pushed further, on the same code:
 *
 * | joins | segments | largest component |
 * |---:|---:|---:|
 * | 1,670 | 96,609 | 1.6% |
 * | 3,283 | 98,107 | **14.9%** |
 * | 4,038 | 99,051 | **33.0%** |
 *
 * So "the band fuses into one component" is a SEGMENT PURCHASE of about 2,400
 * more than the budget allows, not a tuning of this constant — and past 4,038
 * the structural join ceiling binds and raising the rate makes the largest
 * component SMALLER (33.0% -> 26.7% at eight times this rate), because the
 * ceiling is then spent early in the buffer instead of across the field.
 */
export const POPULATION_JOIN_CHANCE_OPEN = 0.004;
export const POPULATION_JOIN_CHANCE_MIXED = 0.09;

/** The chance an accepted point closes onto a strand, at one resolved
 *  coverage. Zero where the Cells own the ground, a floor in the open fringe,
 *  a peak where the two populations share it. */
export function populationJoinChance(resolvedCoverage: number): number {
  const keep = populationComplementAcceptance(resolvedCoverage);
  const mixed = 4 * keep * (1 - keep);
  return keep * (POPULATION_JOIN_CHANCE_OPEN
    + (POPULATION_JOIN_CHANCE_MIXED - POPULATION_JOIN_CHANCE_OPEN) * mixed);
}

/**
 * The reach window a join may close over, in walk steps.
 *
 * Both ends of it are load-bearing, and the FLOOR is the one that is not
 * obvious. A candidate nearer than a step would draw a tick sitting on top of
 * a point — which is a bead with a stub, and "no endpoint emphasis of any
 * kind" forbids exactly that shape. It also makes the taxonomy exact: a walk
 * step and a fork's first segment are both exactly one
 * {@link POPULATION_STREAMLINE_STEP} in the ground plane, so ANY segment
 * longer than one step is a join and the buffer can be read without being
 * told. The ceiling keeps the stroke at the layer's own scale — 1.875 world
 * units against a drawn run whose median is 7.50 — so a join is tissue closing
 * on itself and never a spoke thrown across the field.
 */
export const POPULATION_JOIN_REACH_MIN = 1.1;
export const POPULATION_JOIN_REACH = 1.5;

/**
 * Ceiling on the DRAWN length of a join, in walk steps.
 *
 * The reach above is measured in the ground plane; this one is measured in
 * three dimensions, and it exists because a join is the one segment here whose
 * two ends did not agree on a height. A fork inherits its parent's offset
 * precisely so the two meet in 3D rather than crossing at different heights,
 * and a join cannot inherit anything — so the agreement has to be a CONDITION
 * instead. Measured over pairs inside the reach window, the vertical gap runs
 * p50 1.27 and p99 5.15 world units: without this cap a join would sometimes
 * be a 5-unit strut across the slab, longer than the fabric's own p90 stroke.
 * At two steps the drawn joins run p50 1.61, p90 1.94, max 2.49.
 */
export const POPULATION_JOIN_SPAN = 2;

/**
 * How many joins one filament may close.
 *
 * A plexus, not a felt. With the rate above this is nearly never the binding
 * constraint — the layer closes 1,670 joins across 14,419 filaments — but it
 * is what stops a single long filament in the transition band from stitching
 * itself to everything it passes, which is the shape a felt has.
 */
export const POPULATION_JOIN_PER_FILAMENT = 2;

const JOIN_REACH_MIN_SQ =
  (POPULATION_JOIN_REACH_MIN * POPULATION_STREAMLINE_STEP) ** 2;
const JOIN_REACH_SQ = (POPULATION_JOIN_REACH * POPULATION_STREAMLINE_STEP) ** 2;
const JOIN_SPAN_SQ = (POPULATION_JOIN_SPAN * POPULATION_STREAMLINE_STEP) ** 2;

/** The candidate grid: one cell exactly the reach, so a 3x3 scan around the
 *  current point covers the whole window and nothing further. 121 x 109 cells
 *  over the seeding box. */
const JOIN_GRID_CELL = POPULATION_JOIN_REACH * POPULATION_STREAMLINE_STEP;
/**
 * How many points one cell remembers, newest first, overwritten in place.
 *
 * Every emitted point is filed — there is no separate candidate lottery — so
 * the depth is what decides whether a cell still holds a point of ANOTHER
 * filament when a walk comes through it. A cell sees about 10.2 points over
 * the whole pass and a strand crossing one leaves two or three consecutively,
 * so a shallow ring holds one strand and answers nothing. Measured at 105,000
 * points, joins landed and the layer's largest component:
 *
 * | depth | joins | largest | memory |
 * |---:|---:|---:|---:|
 * | 2  | 1,309 | 0.38% | 109 KB |
 * | 3  | 1,573 | 0.48% | 164 KB |
 * | 4  | 1,562 | 0.55% | 219 KB |
 * | 6  | **1,670** | **1.64%** | **322 KB** |
 * | 10 | 1,742 | 2.21% | 528 KB |
 *
 * Six takes 96% of the joins ten finds, for 61% of the memory, and the rate
 * curve is what sets the count from there. (The largest-component column is
 * noisy across this sweep on purpose-built grounds: the layer sits just under
 * its percolation threshold, so which pairs merge decides how big the biggest
 * piece gets.)
 */
const JOIN_GRID_DEPTH = 6;
const JOIN_GRID_HALF_X =
  FIELD_HALF_X * (POPULATION_FIELD_OUTER_EDGE + BOUNDARY_WARP_MAX);
const JOIN_GRID_HALF_Z =
  FIELD_HALF_Z * (POPULATION_FIELD_OUTER_EDGE + BOUNDARY_WARP_MAX);
const JOIN_GRID_COLS = Math.ceil(2 * JOIN_GRID_HALF_X / JOIN_GRID_CELL);
const JOIN_GRID_ROWS = Math.ceil(2 * JOIN_GRID_HALF_Z / JOIN_GRID_CELL);
/** An entry holding no point — and what a CONSUMED one is set back to. */
const JOIN_GRID_EMPTY = -1;

/**
 * Upper bound on the acceptance probability at one radius, from the radius
 * alone — no noise evaluated.
 *
 * `density` is `envelope * body` and `envelope` is monotone decreasing in
 * `radial + boundaryWarp`, so closing the envelope at `radial - warpMax`
 * bounds it from above. Drawing the uniform BEFORE the field and rejecting
 * against this bound is exact — it changes which candidates are examined, not
 * the distribution of the ones kept — and it skips the twelve-octave
 * evaluation for the seeds out in the thin halo and the corners of the
 * sampling box, where almost nothing is ever accepted.
 */
export function populationPlacementMajorant(radial: number): number {
  const envelopeUpper = 1 - smoothstep(
    ENVELOPE_INNER,
    POPULATION_FIELD_OUTER_EDGE,
    radial - BOUNDARY_WARP_MAX,
  );
  return Math.min(1, envelopeUpper * BODY_MAX);
}

export interface PopulationPlacementState {
  /** World positions, `3 * capacity` long, valid for the first `count`
   *  points. The buffer type is pinned so it can be transferred out of a
   *  worker without a defensive copy. */
  positions: Float32Array<ArrayBuffer>;
  /** Segment endpoints as pairs of indices into {@link positions}, valid for
   *  the first `2 * segmentCount` entries. Every index addresses a point this
   *  pass placed — no segment reaches an addressable Cell (§3 rule 4), and no
   *  segment bridges a point the complement rejected. */
  segments: Uint32Array<ArrayBuffer>;
  /** Joins closed by {@link populationJoinChance} — segments that reached a
   *  strand instead of the walk's own previous point. Counted because they are
   *  the one thing here that can spend more segments than points, and because
   *  they are what makes this graph stop being a forest. */
  joins: number;
  /** The taper weight of each placed point, `capacity` long and valid for the
   *  first `count` entries. SIZE alone rides it: brightness is flat at the
   *  emission ceiling and the tint is one colour, so what varies across the
   *  layer on screen is how many points land on a pixel, exactly as it is for
   *  the Cells. (One colour per CLASS: the beads' `POPULATION_FIELD_COLOR` and
   *  the strokes' `POPULATION_STROKE_COLOR`, each flat over its own class and
   *  neither a function of this weight.) Transferred with the positions; pinned for the same reason.
   *
   *  ⚠️ Written TWICE for the last points of every strand: once from the
   *  tissue at emission, then scaled again by {@link POPULATION_END_TAPER}
   *  once the strand is known to have ended. So an entry is not final until
   *  its strand is over, which costs nothing here — the pass finishes before
   *  either buffer leaves the worker — but would matter to any caller that
   *  read this mid-pass. */
  weights: Float32Array<ArrayBuffer>;
  capacity: number;
  /** Points written so far. */
  count: number;
  segmentCount: number;
  /** Filaments started, including branches. */
  streamlines: number;
  /** Field evaluations spent — seed attempts plus walk steps. The unit of
   *  work, and what the budget below is denominated in. */
  work: number;
  /** Set when the buffer is full, or when the work ceiling is reached. */
  done: boolean;
  /** mulberry32 state, carried across calls so the stream is one sequence
   *  however the budget is divided. */
  rng: number;
  /** The filament currently being walked, carried across calls so a budgeted
   *  caller can stop mid-strand and resume without perturbing the sequence. */
  walk: WalkState;
  /** Branch candidates: a ring of walk states recorded from filaments already
   *  placed. Allocated once, overwritten in place. */
  branchX: Float64Array;
  branchZ: Float64Array;
  branchDirX: Float64Array;
  branchDirZ: Float64Array;
  branchOffset: Float64Array;
  branchPoint: Int32Array;
  branchGeneration: Int32Array;
  /** The tissue density at each recorded point. The child's own reach key —
   *  it decides the child's length and the chance the slot is forked from at
   *  all — captured from the sample the walk had already made when it recorded
   *  the slot, so a fork costs no field evaluation either. */
  branchDensity: Float64Array;
  branchWritten: number;
  /** Join candidates: every emitted point, filed by ground-plane cell,
   *  {@link JOIN_GRID_DEPTH} deep and overwritten in place. Holds point
   *  indices, so the position and the height come from the buffer that is
   *  actually drawn. A join CONSUMES its entry — that is this pass's second
   *  anti-percolation move, and it is what stops several strands closing onto
   *  one point and building the lit hub the symbolic register forbids. */
  joinGrid: Int32Array;
  /** Per-cell write cursor for that ring. */
  joinCursor: Uint8Array;
}

interface WalkState {
  /** Steps left on the current filament; zero means "seed a new one". */
  stepsLeft: number;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  /** The filament's own standard-normal vertical offset, in units of the
   *  local flattened thickness. Drawn ONCE per filament — this is what keeps
   *  the strand a coherent curve in three dimensions instead of a smear
   *  across the slab. */
  offset: number;
  /** Per-filament wander scale, in [0, 1] of {@link POPULATION_STREAMLINE_WANDER}. */
  wander: number;
  /** How many forks deep this filament is. Fresh tissue is 0. */
  generation: number;
  /** Index of the FIRST point this filament emitted, or -1 before it has
   *  emitted one. A filament's accepted points are contiguous in the buffer —
   *  only one walk is ever running — so "emitted before this" is exactly
   *  "belongs to another filament", and a join needs no id to test it. */
  firstPoint: number;
  /** Joins this filament has already closed. Capped at
   *  {@link POPULATION_JOIN_PER_FILAMENT}: a plexus, not a felt. */
  joins: number;
  /** The tissue density this filament was BORN on — the seed's own sample for
   *  fresh tissue, the parent point's for a fork. Read once, at the seed, and
   *  then only through {@link populationTissueReach}: it sets how far this
   *  filament may run, and it is why a corridor filament keeps its arc after
   *  it has walked out into thin ground. */
  seedDensity: number;
  /** Index of the last point emitted on this filament, or -1 when the
   *  complement broke it. A break must not be bridged. */
  previous: number;
  /** The complement's latent variate — marginally standard normal at every
   *  step by construction, carried so that consecutive decisions agree over a
   *  run instead of being drawn fresh. See
   *  {@link POPULATION_COMPLEMENT_CORRELATION_STEPS}. Redrawn at every seed. */
  complement: number;
  /** The last three points emitted on the STRAND in hand, newest first, or -1
   *  for an unused slot. A strand's end fades these — see
   *  {@link POPULATION_END_TAPER} — and emptying the ring as it does is what
   *  stops a complement break followed closely by the filament's own end from
   *  fading one point twice. */
  tip0: number;
  tip1: number;
  tip2: number;
}

export function createPopulationPlacement(
  capacity: number,
  seed: number = POPULATION_FIELD_SEED,
): PopulationPlacementState {
  const size = Math.max(0, Math.floor(capacity));
  return {
    positions: new Float32Array(size * 3),
    // A point adds at most TWO segments: the one that reaches it — from its
    // predecessor on the same filament, or from the parent it forked from —
    // and at most one join closing onto a strand it passed. The buffer is
    // still one segment per point, and it is still exact, because a filament
    // is at most POPULATION_STREAMLINE_MAX_STEPS points long: at least one
    // point in every 26 starts a strand and reaches back to nothing, and that
    // slack is precisely what the joins are spent from. See the join ceiling
    // in `advancePopulationPlacement`.
    segments: new Uint32Array(size * 2),
    weights: new Float32Array(size),
    joins: 0,
    capacity: size,
    count: 0,
    segmentCount: 0,
    streamlines: 0,
    work: 0,
    done: size === 0,
    rng: seed >>> 0,
    walk: {
      stepsLeft: 0,
      x: 0,
      z: 0,
      dirX: 1,
      dirZ: 0,
      offset: 0,
      wander: 0,
      generation: 0,
      firstPoint: -1,
      joins: 0,
      seedDensity: 0,
      previous: -1,
      complement: 0,
      tip0: -1,
      tip1: -1,
      tip2: -1,
    },
    branchX: new Float64Array(BRANCH_RESERVOIR),
    branchZ: new Float64Array(BRANCH_RESERVOIR),
    branchDirX: new Float64Array(BRANCH_RESERVOIR),
    branchDirZ: new Float64Array(BRANCH_RESERVOIR),
    branchOffset: new Float64Array(BRANCH_RESERVOIR),
    branchPoint: new Int32Array(BRANCH_RESERVOIR),
    branchGeneration: new Int32Array(BRANCH_RESERVOIR),
    branchDensity: new Float64Array(BRANCH_RESERVOIR),
    branchWritten: 0,
    // Spatial, not per-point: the grid covers the seeding box at one cell per
    // reach whatever the capacity is, so a small pass pays the same 0.26 MB a
    // full one does. It is worker-local — never transferred, never uploaded.
    joinGrid: new Int32Array(JOIN_GRID_COLS * JOIN_GRID_ROWS * JOIN_GRID_DEPTH)
      .fill(JOIN_GRID_EMPTY),
    joinCursor: new Uint8Array(JOIN_GRID_COLS * JOIN_GRID_ROWS),
  };
}

/**
 * Walk up to `workBudget` more field evaluations.
 *
 * Budgeted in field evaluations rather than in points because that is the unit
 * of work: the caller is spending a time budget, and the yield per evaluation
 * is a property of the field, not of the caller. Returns the same (mutated)
 * state so one reference can be held across calls.
 */
export function advancePopulationPlacement(
  state: PopulationPlacementState,
  workBudget: number,
): PopulationPlacementState {
  if (state.done) return state;

  const { positions, segments, weights, capacity, walk } = state;
  // The box has to cover the envelope's SUPPORT, not its nominal edge: the
  // boundary warp carries density out to `edge + warpBound`, and a box drawn
  // at the edge itself crops that overshoot along a straight line — a crop
  // the eye reads as a clean cut precisely because it is one. Cheap to widen:
  // the seeds it adds are rejected by `populationPlacementMajorant` from the
  // radius alone, before any noise is evaluated. Measured min-of-9, that is
  // 2.028 → 2.204 field evaluations per placed point and +12.6% on the pass —
  // once, in a worker, before the layer is on screen at all.
  const seedEdge = POPULATION_FIELD_OUTER_EDGE + BOUNDARY_WARP_MAX;
  const halfX = FIELD_HALF_X * seedEdge;
  const halfZ = FIELD_HALF_Z * seedEdge;
  const ceiling = capacity * WORK_CEILING_PER_POINT;
  const budget = Math.max(1, Math.floor(workBudget));

  // mulberry32, inlined. The stream is hot enough that a closure per call
  // shows up, and its state has to survive the return either way.
  let rng = state.rng;
  const next = (): number => {
    rng = (rng + 0x6d2b79f5) >>> 0;
    let t = rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
  // Box–Muller, one value per call. The discarded half would have to live on
  // the state to be reused, and correlating two draws that way is not worth a
  // field with this much noise in it already.
  const gaussian = (): number => Math.sqrt(-2 * Math.log(Math.max(next(), 1e-12)))
    * Math.cos(2 * Math.PI * next());

  const crest = { x: 0, z: 0 };
  const jitterShare = POPULATION_STREAMLINE_JITTER;
  const filamentShare = Math.sqrt(1 - jitterShare * jitterShare);

  // ---- The join candidate grid ----------------------------------------
  //
  // Every emitted point is filed by ground-plane cell, JOIN_GRID_DEPTH deep,
  // overwritten in place: no allocation inside the loop, and the cost per step
  // is two multiplies and a store. The cell is exactly the reach, so the 3x3
  // scan below sees every point that could possibly qualify and no more.
  const joinGrid = state.joinGrid;
  const joinCursor = state.joinCursor;
  // The structural ceiling that keeps a one-segment-per-point buffer exact.
  // A filament is at most MAX_STEPS points, so at least `count / MAX_STEPS`
  // points start a strand and emit no segment of their own; the joins are
  // spent out of that slack and can never overrun it. At 105,000 points this
  // is 4,038 and the rate lands at less than half of it, so it does not bind —
  // it is the guard, not the budget.
  const joinCeiling = Math.floor(capacity / POPULATION_STREAMLINE_MAX_STEPS);

  const rememberPoint = (index: number, x: number, z: number): void => {
    const gx = Math.floor((x + JOIN_GRID_HALF_X) / JOIN_GRID_CELL);
    const gz = Math.floor((z + JOIN_GRID_HALF_Z) / JOIN_GRID_CELL);
    if (gx < 0 || gz < 0 || gx >= JOIN_GRID_COLS || gz >= JOIN_GRID_ROWS) return;
    const cell = gz * JOIN_GRID_COLS + gx;
    const slot = joinCursor[cell];
    joinGrid[cell * JOIN_GRID_DEPTH + slot] = index;
    joinCursor[cell] = slot + 1 < JOIN_GRID_DEPTH ? slot + 1 : 0;
  };

  // The nearest point of ANOTHER filament inside the reach window, or -1. The
  // entry is CONSUMED on the way out, so no second strand can close onto the
  // same point and build a hub out of it.
  const closeOntoStrand = (
    x: number,
    y: number,
    z: number,
    before: number,
  ): number => {
    const gx0 = Math.floor((x + JOIN_GRID_HALF_X) / JOIN_GRID_CELL);
    const gz0 = Math.floor((z + JOIN_GRID_HALF_Z) / JOIN_GRID_CELL);
    let best = -1;
    let bestEntry = -1;
    let bestSpan = JOIN_SPAN_SQ;
    for (let dz = -1; dz <= 1; dz += 1) {
      const gz = gz0 + dz;
      if (gz < 0 || gz >= JOIN_GRID_ROWS) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const gx = gx0 + dx;
        if (gx < 0 || gx >= JOIN_GRID_COLS) continue;
        const base = (gz * JOIN_GRID_COLS + gx) * JOIN_GRID_DEPTH;
        for (let k = 0; k < JOIN_GRID_DEPTH; k += 1) {
          const candidate = joinGrid[base + k];
          // Empty, consumed, or this filament's own: its points are contiguous
          // in the buffer, so one comparison decides it.
          if (candidate < 0 || candidate >= before) continue;
          const cx = positions[candidate * 3] - x;
          const cz = positions[candidate * 3 + 2] - z;
          const plane = cx * cx + cz * cz;
          // Closer than the window's floor and the stroke is a tick on top of
          // a point, which is endpoint emphasis by another name; further and it
          // is a spoke thrown across the tissue.
          if (plane <= JOIN_REACH_MIN_SQ || plane > JOIN_REACH_SQ) continue;
          const cy = positions[candidate * 3 + 1] - y;
          const span = plane + cy * cy;
          if (span >= bestSpan) continue;
          bestSpan = span;
          best = candidate;
          bestEntry = base + k;
        }
      }
    }
    if (bestEntry >= 0) joinGrid[bestEntry] = JOIN_GRID_EMPTY;
    return best;
  };

  // A strand is over: fade the last points it emitted so it ends as a tip
  // rather than at whatever weight the tissue handed its last one. Retroactive,
  // and free — the whole pass finishes before either buffer is transferred, so
  // a second write to a weight is a store into memory nothing has read.
  //
  // Every way a strand can end comes through here: the steps running out, the
  // density floor, a complement break severing it mid-filament, and the pass
  // itself finishing. Emptying the ring is what keeps two of those arriving in
  // quick succession from fading one point twice.
  const endStrand = (): void => {
    if (walk.tip0 >= 0) weights[walk.tip0] *= POPULATION_END_TAPER[0];
    if (walk.tip1 >= 0) weights[walk.tip1] *= POPULATION_END_TAPER[1];
    if (walk.tip2 >= 0) weights[walk.tip2] *= POPULATION_END_TAPER[2];
    walk.tip0 = -1;
    walk.tip1 = -1;
    walk.tip2 = -1;
  };

  let count = state.count;
  let segmentCount = state.segmentCount;
  let streamlines = state.streamlines;
  let joins = state.joins;
  let work = state.work;
  let branchWritten = state.branchWritten;
  const limit = work + budget;

  while (count < capacity && work < limit && work < ceiling) {
    // ---- Seed a new filament ------------------------------------------
    if (walk.stepsLeft <= 0) {
      work += 1;

      // The slot is drawn BEFORE the fork is decided, which is the reverse of
      // the order this used to run in. The share is keyed on the ground the
      // parent point stands on, and there is no key until a slot is in hand.
      const reservoir = Math.min(branchWritten, BRANCH_RESERVOIR);
      let forking = reservoir > 0;
      let slot = 0;
      let parent = BRANCH_CONSUMED;
      if (forking) {
        slot = Math.min(reservoir - 1, Math.floor(next() * reservoir));
        parent = state.branchPoint[slot];
        // A spent slot is not a reason to spend a whole iteration: fall
        // through to fresh tissue instead of looping, or the pass does twice
        // the work once the reservoir is mostly consumed.
        if (parent === BRANCH_CONSUMED) forking = false;
        else {
          forking = next()
            < populationBranchShare(state.branchDensity[slot]);
        }
      }

      if (forking) {
        // A child filament, forked FROM a point on its parent. It inherits
        // the parent's vertical offset so the two meet in three dimensions
        // rather than crossing at different heights, and its first segment
        // reaches back to the parent's own point — the fork is drawn, not
        // implied.
        state.branchPoint[slot] = BRANCH_CONSUMED;
        walk.x = state.branchX[slot];
        walk.z = state.branchZ[slot];
        walk.offset = state.branchOffset[slot];
        walk.previous = parent;
        walk.generation = state.branchGeneration[slot] + 1;
        walk.seedDensity = state.branchDensity[slot];
        const fork = POPULATION_STREAMLINE_FORK_MIN
          + next() * (POPULATION_STREAMLINE_FORK_MAX
            - POPULATION_STREAMLINE_FORK_MIN);
        const angle = next() < 0.5 ? fork : -fork;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const px = state.branchDirX[slot];
        const pz = state.branchDirZ[slot];
        walk.dirX = px * cos - pz * sin;
        walk.dirZ = px * sin + pz * cos;
        // One step out along the fork before the first child point. Starting
        // ON the parent would put two points at one (x, z) and draw the first
        // segment as a vertical tick — an endpoint emphasis, which is the one
        // thing the fibres must never produce.
        walk.x += walk.dirX * POPULATION_STREAMLINE_STEP;
        walk.z += walk.dirZ * POPULATION_STREAMLINE_STEP;
      } else {
        // Fresh tissue. Rejection-sample the seed against the same density
        // the Cells are sampled against, under the pushed-out envelope.
        const x = (next() * 2 - 1) * halfX;
        const z = (next() * 2 - 1) * halfZ;
        const u = next();
        const nx = x / FIELD_HALF_X;
        const nz = z / FIELD_HALF_Z;
        const radial = Math.sqrt(nx * nx + nz * nz);
        if (u >= populationPlacementMajorant(radial)) continue;
        // The rejection test's own sample is the filament's reach key. It was
        // being computed and thrown away; keeping it costs one store.
        const seedDensity = tissueSampleAt(
          x, z, POPULATION_FIELD_OUTER_EDGE,
        ).density;
        if (u >= seedDensity) continue;
        walk.seedDensity = seedDensity;
        walk.x = x;
        walk.z = z;
        walk.offset = gaussian();
        walk.previous = -1;
        walk.generation = 0;
        // No crest yet, so the first step takes the field's own direction —
        // with a coin flip, or every filament through one ridge would set off
        // the same way and the field would comb rather than branch.
        walk.dirX = 0;
        walk.dirZ = 0;
      }

      const span = populationStreamlineSpan(walk.seedDensity);
      walk.stepsLeft = POPULATION_STREAMLINE_MIN_STEPS + Math.floor(
        span * next() ** POPULATION_STREAMLINE_LENGTH_EXPONENT,
      );
      walk.wander = next();
      // A fresh variate for every filament, forked children INCLUDED. The
      // tempting alternative is to let a child inherit its parent's: the child
      // starts one step from a point on the parent, in the same tissue, and
      // inheriting would make the fork itself far likelier to be drawn. It is
      // wrong for one reason and the reason is the whole value of this
      // construction — the parent's variate at a recorded point is conditioned
      // on the parent having been ACCEPTED there, so it is a truncated normal
      // and not a standard one. Carrying it into the child would bias the
      // child's first steps toward acceptance, and the marginal that makes the
      // correlation free would stop being exact.
      walk.complement = gaussian();
      // The tip ring belongs to one strand. The end that emptied it has
      // already run; clearing here means a missed end loses a fade rather than
      // applying one twice.
      walk.tip0 = -1;
      walk.tip1 = -1;
      walk.tip2 = -1;
      // A fresh filament, and the two things a join asks about it: it has
      // emitted nothing yet, and it has closed nothing yet.
      walk.firstPoint = -1;
      walk.joins = 0;
      streamlines += 1;
      continue;
    }

    // ---- One step of the current filament ------------------------------
    walk.stepsLeft -= 1;
    work += 1;

    const sample = tissueSampleAt(walk.x, walk.z, POPULATION_FIELD_OUTER_EDGE);
    if (sample.density < POPULATION_STREAMLINE_DENSITY_FLOOR) {
      // Out of tissue. Stop rather than trail a filament into vacuum — and
      // fade out, because this is the halo's outer silhouette and a stroke
      // that simply stopped there is what read as a trimmed mat.
      endStrand();
      walk.stepsLeft = 0;
      continue;
    }

    // Heading: the crest, softened by the heading already held and perturbed
    // by this filament's own wander. Pure crest-following is a pure function
    // of position, so every filament through a region traces one curve.
    if (crestDirection(sample.qx, sample.qz, crest)) {
      let cx = crest.x;
      let cz = crest.z;
      if (walk.dirX * cx + walk.dirZ * cz < 0) {
        // The crest is an axis, not an arrow. Take the branch that carries on.
        cx = -cx;
        cz = -cz;
      }
      if (walk.dirX === 0 && walk.dirZ === 0) {
        // First step of a fresh filament: no heading to preserve, so pick a
        // sense at random.
        const sense = next() < 0.5 ? 1 : -1;
        walk.dirX = cx * sense;
        walk.dirZ = cz * sense;
      } else {
        const stiff = POPULATION_STREAMLINE_STIFFNESS;
        walk.dirX = walk.dirX * stiff + cx * (1 - stiff);
        walk.dirZ = walk.dirZ * stiff + cz * (1 - stiff);
      }
    } else if (walk.dirX === 0 && walk.dirZ === 0) {
      // Flat fibre and no heading yet — take any direction rather than stall.
      const angle = next() * Math.PI * 2;
      walk.dirX = Math.cos(angle);
      walk.dirZ = Math.sin(angle);
    }

    const spin = (next() * 2 - 1) * POPULATION_STREAMLINE_WANDER * walk.wander;
    const cos = Math.cos(spin);
    const sin = Math.sin(spin);
    const turnedX = walk.dirX * cos - walk.dirZ * sin;
    const turnedZ = walk.dirX * sin + walk.dirZ * cos;
    const norm = Math.sqrt(turnedX * turnedX + turnedZ * turnedZ) || 1;
    walk.dirX = turnedX / norm;
    walk.dirZ = turnedZ / norm;

    // The complement. Drop the point where the addressable Cells already
    // occupy this tissue — the whole of what a per-pixel suppression pipeline
    // used to approximate, evaluated where the point actually is. The walk
    // carries on regardless; only the drawing stops, and the filament breaks
    // so that no segment crosses the ground just cleared.
    //
    // The decision rides a latent variate the walk carries rather than a fresh
    // draw, so consecutive decisions agree over about
    // POPULATION_COMPLEMENT_CORRELATION_STEPS steps — a strand crossing
    // half-occupied ground survives whole or breaks once, instead of beading.
    // Advanced on every step, accepted or not, so the correlation is a
    // property of the WALK and not of what it happened to emit.
    walk.complement = populationComplementVariate(walk.complement, gaussian());
    if (
      populationComplementAccepts(
        walk.complement,
        populationComplementAcceptance(sample.resolvedCoverage),
      )
    ) {
      // Height from the same fold and thickness the Cells are folded around,
      // with only the Gaussian SPREAD flattened. The fold itself keeps its
      // full amplitude: it is the organism's own mid-surface, and it is what
      // keeps an edge-on camera looking at a warped ribbon instead of a line.
      const offset = walk.offset * filamentShare + gaussian() * jitterShare;
      const y = sample.foldY
        + offset * sample.thickness * POPULATION_FIELD_FLATTEN;

      const index = count;
      const base = index * 3;
      positions[base] = walk.x;
      positions[base + 1] = y;
      positions[base + 2] = walk.z;
      // Both terms come from the sample already in hand, so the taper is free.
      weights[index] = populationPointWeight(
        sample.density,
        sample.resolvedCoverage,
      );
      count += 1;

      if (walk.previous >= 0) {
        const pair = segmentCount * 2;
        segments[pair] = walk.previous;
        segments[pair + 1] = index;
        segmentCount += 1;
      }
      walk.previous = index;
      if (walk.firstPoint < 0) walk.firstPoint = index;
      walk.tip2 = walk.tip1;
      walk.tip1 = walk.tip0;
      walk.tip0 = index;

      // Anastomosis. A stepping walk may CLOSE onto a strand it is passing —
      // one segment from the stored point to THIS one, which is the newest
      // index in the buffer, so the prefix contract holds by construction
      // exactly as it does for a fork. The rate rides the complement's own
      // keep; the reach keeps the stroke at the layer's own scale; the cap
      // keeps it a plexus. Nothing here writes a weight: a junction is matte,
      // and that is the whole of the rule.
      rememberPoint(index, walk.x, walk.z);
      if (
        walk.joins < POPULATION_JOIN_PER_FILAMENT
        && joins < joinCeiling
        && next() < populationJoinChance(sample.resolvedCoverage)
      ) {
        const target = closeOntoStrand(walk.x, y, walk.z, walk.firstPoint);
        if (target >= 0) {
          const pair = segmentCount * 2;
          segments[pair] = target;
          segments[pair + 1] = index;
          segmentCount += 1;
          joins += 1;
          walk.joins += 1;
        }
      }

      if (
        walk.generation < POPULATION_STREAMLINE_MAX_GENERATION
        && next() < populationBranchRecordChance(sample.density)
      ) {
        const slot = branchWritten % BRANCH_RESERVOIR;
        state.branchX[slot] = walk.x;
        state.branchZ[slot] = walk.z;
        state.branchDirX[slot] = walk.dirX;
        state.branchDirZ[slot] = walk.dirZ;
        state.branchOffset[slot] = walk.offset;
        state.branchPoint[slot] = index;
        state.branchGeneration[slot] = walk.generation;
        state.branchDensity[slot] = sample.density;
        branchWritten += 1;
      }
    } else {
      // The break severs the strand, so this is one of its ends.
      endStrand();
      walk.previous = -1;
    }

    // And the filament's own end. A rejection on the last step reaches this
    // with an emptied ring, so the two cannot fade one point twice.
    if (walk.stepsLeft <= 0) endStrand();

    walk.x += walk.dirX * POPULATION_STREAMLINE_STEP;
    walk.z += walk.dirZ * POPULATION_STREAMLINE_STEP;
  }

  state.rng = rng;
  state.count = count;
  state.segmentCount = segmentCount;
  state.streamlines = streamlines;
  state.joins = joins;
  state.work = work;
  state.branchWritten = branchWritten;
  state.done = count >= capacity || work >= ceiling;
  // The pass is over, so the strand in hand ends here too. It ends because the
  // buffer filled rather than because the tissue ran out, but it is still the
  // last thing drawn on that curve and nothing downstream can tell the
  // difference. A caller that merely spent THIS call's budget is not done and
  // its strand carries on — which is why this reads `state.done` and not the
  // loop's exit.
  if (state.done) endStrand();
  return state;
}

/** Run a placement pass to completion. A fraction of a second of CPU for the
 *  shipped count, which is why the renderer runs it in a worker and draws
 *  nothing until it lands — absence is a legal state for this layer. */
export function placePopulationField(
  capacity: number = POPULATION_FIELD_POINTS,
  seed: number = POPULATION_FIELD_SEED,
): PopulationPlacementState {
  const state = createPopulationPlacement(capacity, seed);
  return advancePopulationPlacement(
    state,
    state.capacity * WORK_CEILING_PER_POINT,
  );
}
