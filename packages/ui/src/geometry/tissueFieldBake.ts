// Bake of the shared positional law (`helix.tissueSampleAt`) into one texture.
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

import { FIELD_HALF_X, FIELD_HALF_Z, tissueSampleAt } from '../helix';

/** Half-extent of `foldY`. The fold is
 *  `valueNoise2(...) * 4.6 + valueNoise2(...) * 1.7` and `valueNoise2`
 *  returns [-1, 1], so the fold cannot leave [-6.3, 6.3]. */
export const TISSUE_BAKE_FOLD_Y_RANGE = 6.3;
/** Bounds of `thickness`, which is `2.1 + verticalMass * 3.4 + ridge * 1.8`
 *  with both terms in [0, 1]. */
export const TISSUE_BAKE_THICKNESS_MIN = 2.1;
export const TISSUE_BAKE_THICKNESS_MAX = 7.3;

/** Channel layout of the baked texel, mirrored by the sampling shader:
 *  R = density, G = foldY normalized to [0, 1], B = thickness normalized to
 *  [0, 1], A = 1 (unused; RGB textures no longer exist in three). */
export const TISSUE_BAKE_CHANNELS = 4;

export interface TissueFieldBakeState {
  /** Texels per side. The grid is square in TEXELS over a non-square
   *  footprint, so one texel is wider in x than in z — which is correct:
   *  it keeps the sampling uv a plain linear remap of (x, z). */
  resolution: number;
  /** RGBA half-float texel data, row-major from -FIELD_HALF_Z upward.
   *  The buffer type is pinned so the array can be handed straight to a
   *  `THREE.DataTexture` without a defensive megabyte-scale copy. */
  data: Uint16Array<ArrayBuffer>;
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
  const { resolution, data } = state;
  const foldSpan = 2 * TISSUE_BAKE_FOLD_Y_RANGE;
  const thicknessSpan = TISSUE_BAKE_THICKNESS_MAX - TISSUE_BAKE_THICKNESS_MIN;
  const last = Math.min(resolution, state.rows + Math.max(1, Math.floor(rowBudget)));

  for (let iz = state.rows; iz < last; iz += 1) {
    const z = tissueBakeAxisAt(iz, resolution, FIELD_HALF_Z);
    let offset = iz * resolution * TISSUE_BAKE_CHANNELS;
    for (let ix = 0; ix < resolution; ix += 1) {
      const x = tissueBakeAxisAt(ix, resolution, FIELD_HALF_X);
      const sample = tissueSampleAt(x, z);
      data[offset] = toHalfFloat(sample.density);
      data[offset + 1] = toHalfFloat(
        clamp01((sample.foldY + TISSUE_BAKE_FOLD_Y_RANGE) / foldSpan),
      );
      data[offset + 2] = toHalfFloat(
        clamp01((sample.thickness - TISSUE_BAKE_THICKNESS_MIN) / thicknessSpan),
      );
      data[offset + 3] = toHalfFloat(1);
      offset += TISSUE_BAKE_CHANNELS;
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
