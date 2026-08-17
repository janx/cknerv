// Bake of the shared positional law (`helix.tissueSampleAt`) into a texture,
// plus the halo fibre's two ridge bases into a second one.
//
// The law is a pure function of (x, z) with no time, no id, and no universe
// seed, so it is bakeable once and valid forever — identical across
// universes and across reloads. Baking it is what lets a renderer state the
// unresolved population as a continuous medium without evaluating ~12 noise
// octaves per pixel per frame.
//
// The bake is DELIBERATELY incremental. A 512² bake is ~262K evaluations of
// that function; measured here it is 88 ms in one call (0.172 ms per row), and
// 33 ms at 256² — a long task by any definition, arriving at exactly the
// moment the page is still assembling itself. `advanceTissueFieldBake` fills a
// bounded number of rows per call so the cost spreads across frames (8 rows
// ≈ 1.1 ms, so a 512² bake completes in ~64 frames), and until it finishes
// there is simply no texture — absence is a legal state for this layer.
//
// The domain is the HALO, `POPULATION_FIELD_OUTER_EDGE` times the resolved
// rim, so one texel now spans ~0.52 world units in x at 512² rather than
// ~0.23. The texel COUNT and therefore the bake cost are unchanged, and the
// field's finest octave has a scale of 11 world units, so 512² still
// oversamples it by roughly twenty to one.
//
// The fibre rides along in the same pass and costs 17% more per row (measured
// at both resolutions), because the expensive part of it — the domain warp
// that produces `qx, qz` — is work the law has already done. Two more octaves
// per texel, not a second bake, and the per-frame row budget does not move.

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
 * That relocation is the whole point of the layer's second life. Three
 * overlays — a grey alpha-over wash, an additive glow, an emissive swarm —
 * each cost the addressable Cells their sharpness at every strength that made
 * them visible at all, because a layer sharing screen space with the thing it
 * contextualizes always taxes it. Radius now carries SCOPE: detail inside,
 * population outside, and the boundary between them IS the render budget made
 * visible.
 */
export const POPULATION_FIELD_OUTER_EDGE = 2.2;

/** Half-extents of the baked domain. The bake covers the HALO, so a consumer
 *  reading the texture by a linear `uv = position / (2 * half) + 0.5` remap —
 *  the density march does exactly that — has to size its volume from these,
 *  never from `FIELD_HALF_X/Z`. */
export const TISSUE_BAKE_HALF_X = FIELD_HALF_X * POPULATION_FIELD_OUTER_EDGE;
export const TISSUE_BAKE_HALF_Z = FIELD_HALF_Z * POPULATION_FIELD_OUTER_EDGE;

/** Half-extent of `foldY`. The fold is
 *  `valueNoise2(...) * 4.6 + valueNoise2(...) * 1.7` and `valueNoise2`
 *  returns [-1, 1], so the fold cannot leave [-6.3, 6.3]. */
export const TISSUE_BAKE_FOLD_Y_RANGE = 6.3;
/** Bounds of `thickness`, which is `2.1 + verticalMass * 3.4 + ridge * 1.8`
 *  with both terms in [0, 1]. */
export const TISSUE_BAKE_THICKNESS_MIN = 2.1;
export const TISSUE_BAKE_THICKNESS_MAX = 7.3;

/** Channel layout of the baked texel, mirrored by the sampling shader:
 *  R = density under {@link POPULATION_FIELD_OUTER_EDGE} — the whole body,
 *  halo included; G = foldY normalized to [0, 1]; B = thickness normalized to
 *  [0, 1]; A = the density under the ORIGINAL edge, i.e. the share of that
 *  body cknerv has already individuated as addressable Cells.
 *
 *  A used to be a constant 1 with nowhere to go. It is now load-bearing: the
 *  march subtracts it, so the halo carries the population MINUS what is
 *  already drawn, and over the addressable Cells it carries exactly nothing.
 *  Both densities come from one evaluation of the same noise, which is what
 *  makes the subtraction meaningful rather than two fields disagreeing. */
export const TISSUE_BAKE_CHANNELS = 4;

/**
 * The halo's fibre, as two ridged octaves on the law's WARPED coordinates.
 *
 * The Galaxy's neural character comes from the k-NN filaments, not from the
 * points, so a halo of uniform spray reads as dust however exactly its density
 * is computed. The unification that makes fibre out there honest: the fabric's
 * 8K edge budget is a resolution limit exactly like the 12K Cell budget, so
 * the halo is unresolved CONNECTIONS as much as unresolved Cells — and at that
 * resolution you see bundles, never individual links. What is drawn is grain
 * DIRECTION, not links: no nodes, no endpoints, and rule 4 intact.
 *
 * Evaluated on `qx, qz` rather than on `x, z` so the strands follow the
 * organism's own flow instead of a grid. Scale decides this completely: the
 * `ridge` octave the density already uses sits at 11 world units and projects
 * as marbling, while the same construction at 3-5 units reads as dendritic.
 * Both were prototyped.
 */
export const POPULATION_FIBRE_SCALE_A = 5.5;
export const POPULATION_FIBRE_SCALE_B = 3.1;
/** The second octave is read on coordinates scaled by this and offset, which
 *  both decorrelates it from the first and puts its true world scale at
 *  `POPULATION_FIBRE_SCALE_B / 1.7` — about 1.8 units, the finest structure
 *  in the layer. */
export const POPULATION_FIBRE_WARP_B = 1.7;
/** Powers the bases are raised to. High, so the ridges stay thin: these are
 *  bundles seen from far enough away that individual links never separate. */
export const POPULATION_FIBRE_POWER_A = 7;
export const POPULATION_FIBRE_POWER_B = 9;
export const POPULATION_FIBRE_MIX_A = 0.62;
export const POPULATION_FIBRE_MIX_B = 0.38;
const FIBRE_SALT_A = 0x51fa7c11;
const FIBRE_SALT_B = 0x2c9e77b3;

/** RG: the two ridge BASES, both in [0, 1]. */
export const TISSUE_FIBRE_CHANNELS = 2;

/**
 * The two ridge bases at one warped coordinate.
 *
 * The BASES are baked and the powers are applied per pixel, which is the whole
 * reason a 512-texel bake is enough: `1 - |noise|` has features at its own
 * octave's scale — 5.5 and ~1.8 world units — and the bake oversamples both,
 * while the same field raised to the ninth has features a texel wide and would
 * be averaged into mush. Measured against exact evaluation at 0.5-unit
 * sampling over the halo, a 512² bake of the bases reconstructs the fibre at
 * a correlation of 0.959 (0.887 at 256²); baking the powered ridges instead
 * loses the thin structure that makes them read as filaments at all.
 */
export function populationFibreBases(qx: number, qz: number): [number, number] {
  return [
    1 - Math.abs(valueNoise2(qx, qz, POPULATION_FIBRE_SCALE_A, FIBRE_SALT_A)),
    1 - Math.abs(valueNoise2(
      qx * POPULATION_FIBRE_WARP_B + 31,
      qz * POPULATION_FIBRE_WARP_B - 17,
      POPULATION_FIBRE_SCALE_B,
      FIBRE_SALT_B,
    )),
  ];
}

/** The fibre itself — the expression the composite evaluates per pixel, kept
 *  here so a test can drive it without a WebGL context. */
export function populationFibre(baseA: number, baseB: number): number {
  return baseA ** POPULATION_FIBRE_POWER_A * POPULATION_FIBRE_MIX_A
    + baseB ** POPULATION_FIBRE_POWER_B * POPULATION_FIBRE_MIX_B;
}

export interface TissueFieldBakeState {
  /** Texels per side. The grid is square in TEXELS over a non-square
   *  footprint, so one texel is wider in x than in z — which is correct:
   *  it keeps the sampling uv a plain linear remap of (x, z). */
  resolution: number;
  /** RGBA half-float texel data, row-major from -FIELD_HALF_Z upward.
   *  The buffer type is pinned so the array can be handed straight to a
   *  `THREE.DataTexture` without a defensive megabyte-scale copy. */
  data: Uint16Array<ArrayBuffer>;
  /** RG half-float ridge bases for the fibre, on the same grid and filled in
   *  the same pass — the warp that produced `qx, qz` is the expensive part and
   *  the law has already paid for it, so the fibre costs two more octaves per
   *  texel and not a second bake. A second texture rather than more channels
   *  because the law's four are all load-bearing. */
  fibre: Uint16Array<ArrayBuffer>;
  /** Rows already written. `resolution` means finished. */
  rows: number;
  done: boolean;
}

/** IEEE 754 binary32 → binary16, matching `THREE.DataUtils.toHalfFloat`.
 *  Local so the bake stays a pure module that unit tests can drive without a
 *  WebGL context or a three import. */
const floatView = new Float32Array(1);
const intView = new Int32Array(floatView.buffer);

export function toHalfFloat(value: number): number {
  floatView[0] = value;
  const bits = intView[0];
  const sign = (bits >> 16) & 0x8000;
  let exponent = ((bits >> 23) & 0xff) - 112;
  let mantissa = bits & 0x007fffff;

  if (exponent <= 0) {
    // Subnormal or underflow to signed zero.
    if (exponent < -10) return sign;
    mantissa |= 0x00800000;
    const shift = 14 - exponent;
    const rounded = mantissa + (1 << (shift - 1));
    return sign | (rounded >> shift);
  }
  if (exponent >= 0x1f) {
    // Overflow / inf / NaN all clamp to half infinity; the baked ranges are
    // small enough that this branch is unreachable in practice.
    return sign | 0x7c00;
  }
  // Round-to-nearest on the 13 dropped mantissa bits.
  const rounded = mantissa + 0x00000fff + ((mantissa >> 13) & 1);
  if (rounded & 0x00800000) {
    exponent += 1;
    return exponent >= 0x1f
      ? sign | 0x7c00
      : sign | (exponent << 10);
  }
  return sign | (exponent << 10) | (rounded >> 13);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function createTissueFieldBake(resolution: number): TissueFieldBakeState {
  const side = Math.max(1, Math.floor(resolution));
  return {
    resolution: side,
    data: new Uint16Array(side * side * TISSUE_BAKE_CHANNELS),
    fibre: new Uint16Array(side * side * TISSUE_FIBRE_CHANNELS),
    rows: 0,
    done: false,
  };
}

/** Texel-centre world coordinate along one axis. The centres line up with a
 *  plain `uv = position / (2 * halfExtent) + 0.5` lookup under linear
 *  filtering, so the shader needs no half-texel correction. */
export function tissueBakeAxisAt(
  index: number,
  resolution: number,
  halfExtent: number,
): number {
  return ((index + 0.5) / resolution) * 2 * halfExtent - halfExtent;
}

/**
 * Fill up to `rowBudget` more rows. Returns the same (mutated) state so a
 * caller can hold one reference across frames.
 *
 * The budget is rows, not texels, because a row is the unit that keeps the
 * inner loop tight; a caller sizes it from the frame time it is willing to
 * spend, not from the resolution.
 */
export function advanceTissueFieldBake(
  state: TissueFieldBakeState,
  rowBudget: number,
): TissueFieldBakeState {
  if (state.done) return state;
  const { resolution, data, fibre } = state;
  const foldSpan = 2 * TISSUE_BAKE_FOLD_Y_RANGE;
  const thicknessSpan = TISSUE_BAKE_THICKNESS_MAX - TISSUE_BAKE_THICKNESS_MIN;
  const last = Math.min(resolution, state.rows + Math.max(1, Math.floor(rowBudget)));

  for (let iz = state.rows; iz < last; iz += 1) {
    const z = tissueBakeAxisAt(iz, resolution, TISSUE_BAKE_HALF_Z);
    let offset = iz * resolution * TISSUE_BAKE_CHANNELS;
    let fibreOffset = iz * resolution * TISSUE_FIBRE_CHANNELS;
    for (let ix = 0; ix < resolution; ix += 1) {
      const x = tissueBakeAxisAt(ix, resolution, TISSUE_BAKE_HALF_X);
      // One evaluation, both envelopes. Sampling the halo and the resolved
      // share separately would be two passes over the same twelve octaves AND
      // two chances for them to drift apart, and the layer's whole guarantee
      // rests on them being the same field.
      const sample = tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE);
      data[offset] = toHalfFloat(sample.density);
      data[offset + 1] = toHalfFloat(
        clamp01((sample.foldY + TISSUE_BAKE_FOLD_Y_RANGE) / foldSpan),
      );
      data[offset + 2] = toHalfFloat(
        clamp01((sample.thickness - TISSUE_BAKE_THICKNESS_MIN) / thicknessSpan),
      );
      data[offset + 3] = toHalfFloat(sample.resolvedCoverage);
      offset += TISSUE_BAKE_CHANNELS;
      // The same evaluation's warped coordinates. Reading them from the law
      // rather than re-deriving them is what keeps the fibre ON the organism's
      // flow: a second warp would be a second field, and strands that do not
      // follow the corridors the Cells are placed along read as a pattern laid
      // over the galaxy instead of as its own grain.
      const [baseA, baseB] = populationFibreBases(sample.qx, sample.qz);
      fibre[fibreOffset] = toHalfFloat(baseA);
      fibre[fibreOffset + 1] = toHalfFloat(baseB);
      fibreOffset += TISSUE_FIBRE_CHANNELS;
    }
  }

  state.rows = last;
  state.done = last >= resolution;
  return state;
}

/** Run a bake to completion. Convenient for tests and for any caller that has
 *  already decided it can afford the whole cost; the renderer does not use
 *  it, because the renderer cannot. */
export function bakeTissueField(resolution: number): TissueFieldBakeState {
  const state = createTissueFieldBake(resolution);
  return advanceTissueFieldBake(state, state.resolution);
}
