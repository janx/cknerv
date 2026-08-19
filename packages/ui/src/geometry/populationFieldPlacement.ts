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
// edges do. What stays forbidden is an edge with ONE END on an addressable
// Cell: that would assert a relationship between a named Cell and an anonymous
// one, which nothing in the pipeline can support. Every index this module
// emits addresses a point this module placed.

import {
  FIELD_HALF_X,
  FIELD_HALF_Z,
  TISSUE_ENVELOPE_EDGE,
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
 */
export const POPULATION_FIELD_OUTER_EDGE = 2.2;

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
 * uploaded once, two draw calls — still LESS memory than the 3.1 MB the
 * previous build uploaded, and the pass itself is 116 ms of worker CPU.
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
 * ⚠️⚠️ **Neither lever can follow, and both are pinned by something that has
 * nothing to do with the fabric.**
 *
 *  - **Fewer steps** fragments the fibre graph. The share of points carried by
 *    components of 8+ — "draws strokes, not dust", and a hard guard at 0.80 —
 *    sits at **0.826** here, with 3% of headroom. Every shortened variant
 *    swept falls through it: 5/26/1.6 gives 0.811 for almost no gain (p90
 *    5.86x -> 5.56x), 3/26/3.2 gives 0.678, 3/14/1.6 gives 0.53. Shortening a
 *    filament does not just shorten the drawn curve, it breaks the curve into
 *    dust, and dust is the failure this layer was rebuilt to escape.
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
 */
export const POPULATION_STREAMLINE_MIN_STEPS = 6;
export const POPULATION_STREAMLINE_MAX_STEPS = 26;
export const POPULATION_STREAMLINE_LENGTH_EXPONENT = 1.6;

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
 * tissue.
 *
 * This is where the branch points come from. A field of unconnected curves
 * reads as combed fibre; tissue bifurcates. The child inherits its parent's
 * vertical offset so the two actually meet in three dimensions rather than
 * crossing at different heights, and the first segment is emitted from the
 * PARENT's own point index, so the fork is drawn and not merely implied.
 */
export const POPULATION_STREAMLINE_BRANCH_SHARE = 0.42;

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
/** Chance that a given emitted point is recorded as a branch candidate. Low,
 *  so the reservoir turns over slowly and stays spatially mixed — a filament
 *  of average length offers about one place to fork from. */
const BRANCH_RECORD_CHANCE = 0.05;

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
/** Bound on `boundaryWarp`, which is `valueNoise2(...) * 0.13
 *  + valueNoise2(...) * 0.055` and `valueNoise2` returns [-1, 1]. */
const BOUNDARY_WARP_MAX = 0.185;
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
  /** The taper weight of each placed point, `capacity` long and valid for the
   *  first `count` entries. Size, brightness and tint all ride it, and the
   *  fibres interpolate it between their endpoints, so a filament tapers with
   *  the tissue it runs through instead of being flat along its length.
   *  Transferred with the positions; pinned for the same reason. */
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
  branchWritten: number;
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
  /** Index of the last point emitted on this filament, or -1 when the
   *  complement broke it. A break must not be bridged. */
  previous: number;
}

export function createPopulationPlacement(
  capacity: number,
  seed: number = POPULATION_FIELD_SEED,
): PopulationPlacementState {
  const size = Math.max(0, Math.floor(capacity));
  return {
    positions: new Float32Array(size * 3),
    // Every emitted point adds at most one segment — to its predecessor on
    // the same filament, or to the parent it forked from — so the point
    // capacity bounds the segment capacity exactly.
    segments: new Uint32Array(size * 2),
    weights: new Float32Array(size),
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
      previous: -1,
    },
    branchX: new Float64Array(BRANCH_RESERVOIR),
    branchZ: new Float64Array(BRANCH_RESERVOIR),
    branchDirX: new Float64Array(BRANCH_RESERVOIR),
    branchDirZ: new Float64Array(BRANCH_RESERVOIR),
    branchOffset: new Float64Array(BRANCH_RESERVOIR),
    branchPoint: new Int32Array(BRANCH_RESERVOIR),
    branchGeneration: new Int32Array(BRANCH_RESERVOIR),
    branchWritten: 0,
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
  const halfX = FIELD_HALF_X * POPULATION_FIELD_OUTER_EDGE;
  const halfZ = FIELD_HALF_Z * POPULATION_FIELD_OUTER_EDGE;
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

  let count = state.count;
  let segmentCount = state.segmentCount;
  let streamlines = state.streamlines;
  let work = state.work;
  let branchWritten = state.branchWritten;
  const limit = work + budget;

  while (count < capacity && work < limit && work < ceiling) {
    // ---- Seed a new filament ------------------------------------------
    if (walk.stepsLeft <= 0) {
      work += 1;

      const reservoir = Math.min(branchWritten, BRANCH_RESERVOIR);
      let forking = reservoir > 0
        && next() < POPULATION_STREAMLINE_BRANCH_SHARE;
      let slot = 0;
      let parent = BRANCH_CONSUMED;
      if (forking) {
        slot = Math.min(reservoir - 1, Math.floor(next() * reservoir));
        parent = state.branchPoint[slot];
        // A spent slot is not a reason to spend a whole iteration: fall
        // through to fresh tissue instead of looping, or the pass does twice
        // the work once the reservoir is mostly consumed.
        if (parent === BRANCH_CONSUMED) forking = false;
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
        if (u >= tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE).density) {
          continue;
        }
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

      const span = POPULATION_STREAMLINE_MAX_STEPS
        - POPULATION_STREAMLINE_MIN_STEPS;
      walk.stepsLeft = POPULATION_STREAMLINE_MIN_STEPS + Math.floor(
        span * next() ** POPULATION_STREAMLINE_LENGTH_EXPONENT,
      );
      walk.wander = next();
      streamlines += 1;
      continue;
    }

    // ---- One step of the current filament ------------------------------
    walk.stepsLeft -= 1;
    work += 1;

    const sample = tissueSampleAt(walk.x, walk.z, POPULATION_FIELD_OUTER_EDGE);
    if (sample.density < POPULATION_STREAMLINE_DENSITY_FLOOR) {
      // Out of tissue. Stop rather than trail a filament into vacuum.
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
    if (next() < populationComplementAcceptance(sample.resolvedCoverage)) {
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

      if (
        walk.generation < POPULATION_STREAMLINE_MAX_GENERATION
        && next() < BRANCH_RECORD_CHANCE
      ) {
        const slot = branchWritten % BRANCH_RESERVOIR;
        state.branchX[slot] = walk.x;
        state.branchZ[slot] = walk.z;
        state.branchDirX[slot] = walk.dirX;
        state.branchDirZ[slot] = walk.dirZ;
        state.branchOffset[slot] = walk.offset;
        state.branchPoint[slot] = index;
        state.branchGeneration[slot] = walk.generation;
        branchWritten += 1;
      }
    } else {
      walk.previous = -1;
    }

    walk.x += walk.dirX * POPULATION_STREAMLINE_STEP;
    walk.z += walk.dirZ * POPULATION_STREAMLINE_STEP;
  }

  state.rng = rng;
  state.count = count;
  state.segmentCount = segmentCount;
  state.streamlines = streamlines;
  state.work = work;
  state.branchWritten = branchWritten;
  state.done = count >= capacity || work >= ceiling;
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
