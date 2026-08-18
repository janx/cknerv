// Placement of the unresolved population as real points in the Cells' own
// world.
//
// This module holds the whole of the halo's geometry. It is one CPU pass that
// rejection-samples the shared positional law — the SAME law, and the same
// rejection sampling, that `helixSeedF64` uses to place an addressable Cell —
// under an envelope re-closed further out. Nothing here is rasterized, marched,
// or evaluated per pixel: the output is a plain `Float32Array` of world
// positions, uploaded once and never touched again.
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
 * Measured at fixed total light, more points buy exactly one thing: less
 * grain. Local luminance deviation over a nine-pixel neighbourhood falls as
 * 1/sqrt(N) — 1.10 at 65K, 0.75 at 260K, 0.50 at 900K — while structure at the
 * corridor scale does not improve at all (filament contrast 0.54 → 0.48 → 0.46
 * across the same sweep, i.e. it slightly WORSENS as the extra points fill the
 * low-density tail). Past this count the layer trends back toward the smooth
 * wash the whole design exists to escape.
 *
 * It is also a population statement. Against a 12,000-Cell stage and ~1.46M
 * unresolved mainnet Cells, 260K is roughly one point per five and a half
 * Cells cknerv could not individuate — a ratio the picture can carry.
 *
 * Cost: 3.1 MB uploaded once, one draw call, and a fill footprint of roughly
 * 1.7 screens at any resolution (the sprite scales with the viewport, so
 * coverage is resolution-invariant).
 */
export const POPULATION_FIELD_POINTS = 260_000;

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
 * circle. Measured on the shipped placement, 31% of points land inside the
 * resolved rim — that interdigitation is the design working, not leaking.
 */
export const POPULATION_FIELD_COMPLEMENT_KNEE = 0.3;

/**
 * The halo's fibre, as two ridged octaves on the law's WARPED coordinates.
 *
 * The Galaxy's neural character comes from the k-NN filaments, not from the
 * points, so a halo of uniform spray reads as dust however exactly its density
 * is computed. What makes fibre out there honest: the fabric's edge budget is
 * a resolution limit exactly like the Cell budget, so the halo is unresolved
 * CONNECTIONS as much as unresolved Cells — and at that resolution you see
 * bundles, never individual links. What is drawn is where the population
 * GATHERS, not a link: no nodes, no endpoints, nothing terminates.
 *
 * Evaluated on `qx, qz` rather than on `x, z` so the strands follow the
 * organism's own flow instead of a grid. Scale decides this completely: the
 * `ridge` octave the density already uses sits at 11 world units and projects
 * as marbling, while the same construction at 3–5 units reads as dendritic.
 *
 * This is now WORLD-SPACE structure. It turns with the galaxy, as the fabric's
 * own filaments do, which is the entire reason the layer was rebuilt.
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
 *  Raised per POINT now rather than per texel, so nothing averages the thin
 *  structure away — the failure a baked field had to work around. */
export const POPULATION_FIBRE_POWER_A = 7;
export const POPULATION_FIBRE_POWER_B = 9;
export const POPULATION_FIBRE_MIX_A = 0.62;
export const POPULATION_FIBRE_MIX_B = 0.38;
const FIBRE_SALT_A = 0x51fa7c11;
const FIBRE_SALT_B = 0x2c9e77b3;

/** Acceptance floor and slope for the fibre rejection: a candidate survives
 *  with probability `FLOOR + SLOPE * fibre`. The floor keeps the voids from
 *  being surgically empty — a population has stragglers — and the slope is
 *  steep enough that the corridors gather most of the points. */
export const POPULATION_FIBRE_ACCEPT_FLOOR = 0.04;
export const POPULATION_FIBRE_ACCEPT_SLOPE = 3.4;

/**
 * How much thinner than the Cells' own slab the halo is.
 *
 * Not decoration. Points at different heights along one corridor project to
 * different screen positions, so a full-thickness slab smears the filaments
 * away in projection. Derivation: a vertical spread of sigma projects onto the
 * ground plane as `sigma / tan(elevation)`. At the production camera
 * ([110, 108, 110], elevation 34.8 degrees, tan 0.695) keeping that smear under
 * half the dominant fibre scale of 5.5 units needs sigma <= 1.91, against a
 * mean Cell thickness of 4.1 — a factor of 0.47. The camera has no polar limit
 * and can be orbited lower, and at 24 degrees the same bound gives 0.30.
 *
 * Measured, at the production camera: filament contrast rises monotonically as
 * the slab thins — 0.292 at full thickness, 0.480 here, 0.630 at a razor disk.
 * So 0.30 recovers 56% of what a zero-thickness disk would gain, which is the
 * "recovers much of what it loses" this trade was chosen for.
 *
 * It is also the disk to the Cells' bulge, which is the shape the
 * bulge-and-disk reading wanted anyway.
 */
export const POPULATION_FIELD_FLATTEN = 0.3;

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

/** Tries per requested point before the pass gives up and reports what it
 *  has. Measured acceptance is 5.13%, i.e. ~19.5 tries per point, so this is
 *  twenty times the expected work — it exists so a mis-tuned constant degrades
 *  into a thinner field instead of an infinite loop. */
const TRY_CEILING_PER_POINT = 400;

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
 * evaluation for 46% of tries, the ones out in the thin halo and the corners
 * of the sampling box where almost nothing is ever accepted.
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
  capacity: number;
  /** Points written so far. Every prefix is an unbiased sample of the same
   *  distribution, so a partial buffer is thinner, never wrong. */
  count: number;
  tries: number;
  /** Set when the buffer is full, or when the try ceiling is reached. */
  done: boolean;
  /** mulberry32 state, carried across calls so the stream is one sequence
   *  however the budget is divided. */
  rng: number;
}

export function createPopulationPlacement(
  capacity: number,
  seed: number = POPULATION_FIELD_SEED,
): PopulationPlacementState {
  const size = Math.max(0, Math.floor(capacity));
  return {
    positions: new Float32Array(size * 3),
    capacity: size,
    count: 0,
    tries: 0,
    done: size === 0,
    rng: seed >>> 0,
  };
}

/**
 * Draw up to `tryBudget` more candidates.
 *
 * Budgeted in TRIES rather than in points because a try is the unit of work:
 * the caller is spending a time budget, and the yield per try is a property of
 * the field, not of the caller. Returns the same (mutated) state so one
 * reference can be held across calls.
 */
export function advancePopulationPlacement(
  state: PopulationPlacementState,
  tryBudget: number,
): PopulationPlacementState {
  if (state.done) return state;

  const { positions, capacity } = state;
  const halfX = FIELD_HALF_X * POPULATION_FIELD_OUTER_EDGE;
  const halfZ = FIELD_HALF_Z * POPULATION_FIELD_OUTER_EDGE;
  const ceiling = capacity * TRY_CEILING_PER_POINT;
  const budget = Math.max(1, Math.floor(tryBudget));

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

  let count = state.count;
  let tries = state.tries;
  const limit = tries + budget;

  while (count < capacity && tries < limit && tries < ceiling) {
    tries += 1;

    // 1. Uniform over the halo's bounding box.
    const x = (next() * 2 - 1) * halfX;
    const z = (next() * 2 - 1) * halfZ;
    // Drawn here so the majorant below can reject against it without having
    // evaluated the field. Same uniform, same comparison, one order earlier.
    const u = next();

    // 2. Radius-only majorant. No noise, no allocation, and it disposes of
    //    the box corners for free — they are outside the envelope entirely.
    const nx = x / FIELD_HALF_X;
    const nz = z / FIELD_HALF_Z;
    const radial = Math.sqrt(nx * nx + nz * nz);
    if (u >= populationPlacementMajorant(radial)) continue;

    // 3. The law itself, once, for every remaining term.
    const sample = tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE);

    // 4. Rejection-sample against the tissue density, exactly as
    //    `helixSeedF64` samples against the original envelope.
    if (u >= sample.density) continue;

    // 5. The complement. Drop the point where the addressable Cells already
    //    occupy this tissue — the whole of what a per-pixel suppression
    //    pipeline used to approximate, evaluated where the point actually is.
    if (next() >= populationComplementAcceptance(sample.resolvedCoverage)) {
      continue;
    }

    // 6. The fibre. Accept with probability rising along the ridged
    //    corridors, so the population gathers into filaments and leaves
    //    voids instead of dusting the envelope evenly.
    const fibre = populationFibreAt(sample.qx, sample.qz);
    if (
      next() > POPULATION_FIBRE_ACCEPT_FLOOR
        + POPULATION_FIBRE_ACCEPT_SLOPE * fibre
    ) continue;

    // 7. Height from the same fold and thickness the Cells are folded
    //    around, with only the Gaussian SPREAD flattened. The fold itself
    //    keeps its full amplitude: it is the organism's own mid-surface, it
    //    is what the Cells' bulge is folded around too, and it is what keeps
    //    an edge-on camera looking at a warped ribbon instead of a line. It
    //    carries 1.96 of the halo's 2.31 RMS vertical extent — flattening it
    //    as well would throw away more volume than the spread ever had.
    const gaussU1 = Math.max(next(), 1e-12);
    const gaussU2 = next();
    const gauss = Math.sqrt(-2 * Math.log(gaussU1))
      * Math.cos(2 * Math.PI * gaussU2);
    const y = sample.foldY
      + gauss * sample.thickness * POPULATION_FIELD_FLATTEN;

    const base = count * 3;
    positions[base] = x;
    positions[base + 1] = y;
    positions[base + 2] = z;
    count += 1;
  }

  state.rng = rng;
  state.count = count;
  state.tries = tries;
  state.done = count >= capacity || tries >= ceiling;
  return state;
}

/** Run a placement pass to completion. Roughly a second of CPU for the
 *  shipped count, which is why the renderer runs it in a worker and draws
 *  nothing until it lands — absence is a legal state for this layer. */
export function placePopulationField(
  capacity: number = POPULATION_FIELD_POINTS,
  seed: number = POPULATION_FIELD_SEED,
): PopulationPlacementState {
  const state = createPopulationPlacement(capacity, seed);
  return advancePopulationPlacement(
    state,
    state.capacity * TRY_CEILING_PER_POINT,
  );
}
