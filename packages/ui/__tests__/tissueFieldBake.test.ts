import { describe, expect, it } from 'vitest';

import {
  FIELD_HALF_X,
  FIELD_HALF_Z,
  helixSeedF64,
  TISSUE_ENVELOPE_EDGE,
  tissueSampleAt,
} from '../src/helix';
import {
  advanceTissueFieldBake,
  bakeTissueField,
  createTissueFieldBake,
  TISSUE_BAKE_CHANNELS,
  TISSUE_BAKE_FOLD_Y_RANGE,
  TISSUE_BAKE_THICKNESS_MAX,
  TISSUE_BAKE_THICKNESS_MIN,
  tissueBakeAxisAt,
  toHalfFloat,
} from '../src/geometry/tissueFieldBake';

/** Inverse of `toHalfFloat`, for reading a bake back. Test-local: nothing in
 *  the renderer decodes on the CPU — the GPU does it in the sampler. */
function fromHalfFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x03ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 0x1f) return mantissa ? NaN : sign * Infinity;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

describe('tissueSampleAt', () => {
  it('is a pure function of position, with no time, id or universe seed', () => {
    const first = tissueSampleAt(12.5, -7.25);
    // Interleave unrelated evaluations: a sampler that carried hidden state
    // would drift here, and hidden state is exactly what would turn a
    // distribution into an invented geography.
    tissueSampleAt(-40, 33);
    tissueSampleAt(0, 0);
    const second = tissueSampleAt(12.5, -7.25);

    expect(second).toEqual(first);
  });

  it('stays inside the ranges the bake normalizes against', () => {
    for (let iz = 0; iz <= 40; iz += 1) {
      for (let ix = 0; ix <= 40; ix += 1) {
        const x = (ix / 40) * 2 * FIELD_HALF_X - FIELD_HALF_X;
        const z = (iz / 40) * 2 * FIELD_HALF_Z - FIELD_HALF_Z;
        const sample = tissueSampleAt(x, z);

        expect(sample.density).toBeGreaterThanOrEqual(0);
        expect(sample.density).toBeLessThanOrEqual(1);
        expect(Math.abs(sample.foldY)).toBeLessThanOrEqual(
          TISSUE_BAKE_FOLD_Y_RANGE,
        );
        expect(sample.thickness).toBeGreaterThanOrEqual(
          TISSUE_BAKE_THICKNESS_MIN,
        );
        expect(sample.thickness).toBeLessThanOrEqual(TISSUE_BAKE_THICKNESS_MAX);
      }
    }
  });

  it('reproduces the sampler exactly at the default edge', () => {
    // The default has to BE the law, not resemble it: `helixSeedF64` thresholds
    // against this number, and a sampler that disagreed with it by a rounding
    // step would describe a distribution the Cells are not drawn from.
    for (const [x, z] of [[0, 0], [12.5, -7.25], [-40, 33], [55, 50], [-58, -8]]) {
      const sample = tissueSampleAt(x, z);
      expect(sample.density).toBe(sample.resolvedCoverage);
      expect(tissueSampleAt(x, z, TISSUE_ENVELOPE_EDGE)).toEqual(sample);
    }
  });

  it('reopens the envelope outward, and only outward', () => {
    // The halo is the same field CONTINUED, so pushing the edge out may only
    // ever ADD tissue. If a wider edge could remove any, the layer outside the
    // rim would be a different organism rather than this one carrying on.
    let grew = 0;
    for (let iz = 0; iz <= 30; iz += 1) {
      for (let ix = 0; ix <= 30; ix += 1) {
        const x = (ix / 30) * 4 * FIELD_HALF_X - 2 * FIELD_HALF_X;
        const z = (iz / 30) * 4 * FIELD_HALF_Z - 2 * FIELD_HALF_Z;
        const wide = tissueSampleAt(x, z, 2.2);
        const tight = tissueSampleAt(x, z);

        expect(wide.density).toBeGreaterThanOrEqual(wide.resolvedCoverage);
        // The resolved share is a fact about where cknerv places Cells; the
        // edge a caller asks for cannot move it.
        expect(wide.resolvedCoverage).toBe(tight.density);
        // Fold and thickness are the same noise at the same point — the halo
        // continues the core's geometry instead of restating it.
        expect(wide.foldY).toBe(tight.foldY);
        expect(wide.thickness).toBe(tight.thickness);
        if (wide.density > tight.density) grew += 1;
      }
    }
    // And it must actually reach past the rim, or the halo has nothing to draw.
    expect(grew).toBeGreaterThan(100);
  });

  it('still closes, at whatever edge it was given', () => {
    // An envelope that never shut would make the population unbounded, which
    // is a claim about geography rather than about a count.
    for (const [x, z] of [
      [FIELD_HALF_X * 2.6, FIELD_HALF_Z * 2.6],
      [FIELD_HALF_X * 3, 0],
      [0, -FIELD_HALF_Z * 3],
    ]) {
      expect(tissueSampleAt(x, z, 2.2).density).toBe(0);
    }
  });

  it('reads zero density outside the tissue envelope', () => {
    // The envelope closes at radial 1.04 plus a boundary warp under 0.185, so
    // a point well past the corner of the bounding ellipse cannot be tissue.
    for (const [x, z] of [
      [FIELD_HALF_X * 1.6, FIELD_HALF_Z * 1.6],
      [-FIELD_HALF_X * 1.6, FIELD_HALF_Z * 1.6],
      [FIELD_HALF_X * 2, 0],
      [0, -FIELD_HALF_Z * 2],
    ]) {
      expect(tissueSampleAt(x, z).density).toBe(0);
    }
  });

  it('describes the same fold the Cell sampler actually draws from', () => {
    // The claim this whole layer rests on: the medium extrapolates the law
    // real Cells are positioned by, rather than inventing a shape that merely
    // resembles it. So real ids must land where the sampler says tissue is,
    // and their y must be distributed as N(foldY, thickness).
    const ratios: number[] = [];
    let insideTissue = 0;
    const total = 4000;
    for (let id = 1; id <= total; id += 1) {
      const [x, y, z] = helixSeedF64(id);
      const sample = tissueSampleAt(x, z);
      if (sample.density > 0) insideTissue += 1;
      ratios.push(Math.abs(y - sample.foldY) / sample.thickness);
    }

    // Rejection sampling accepts on `threshold < density`, so an accepted
    // position essentially always has density above zero; the few that do not
    // are the ~4.5% halo outliers, which are scaled OUTWARD past the rim.
    expect(insideTissue / total).toBeGreaterThan(0.9);
    // Median |z-score| of a standard normal is 0.674. The band is wide enough
    // to absorb the halo tail and narrow enough that a wrong fold, a wrong
    // thickness, or a swapped noise salt would break it.
    expect(median(ratios)).toBeGreaterThan(0.5);
    expect(median(ratios)).toBeLessThan(0.9);
  });
});

describe('tissueFieldBake', () => {
  it('encodes half floats the way the GPU will read them back', () => {
    for (const value of [0, 1, 0.5, 0.25, 0.1, 0.9999, 1 / 3]) {
      expect(fromHalfFloat(toHalfFloat(value))).toBeCloseTo(value, 3);
    }
    expect(fromHalfFloat(toHalfFloat(-0.25))).toBeCloseTo(-0.25, 5);
  });

  it('spreads across calls without changing a single texel', () => {
    const whole = bakeTissueField(32);

    const chunked = createTissueFieldBake(32);
    let guard = 0;
    while (!chunked.done) {
      advanceTissueFieldBake(chunked, 5);
      guard += 1;
      expect(guard).toBeLessThan(100);
    }

    // Byte identity, not approximate agreement: the incremental path is the
    // only path the renderer uses, so it has to BE the bake, not resemble it.
    expect(chunked.rows).toBe(32);
    expect(Array.from(chunked.data)).toEqual(Array.from(whole.data));
  });

  it('a finished bake is not advanced again by a later call', () => {
    const state = bakeTissueField(16);
    const before = state.data.slice();

    advanceTissueFieldBake(state, 16);

    expect(state.rows).toBe(16);
    expect(Array.from(state.data)).toEqual(Array.from(before));
  });

  it('stores the law at texel centres, decodable back to the sampler', () => {
    const resolution = 24;
    const state = bakeTissueField(resolution);
    const foldSpan = 2 * TISSUE_BAKE_FOLD_Y_RANGE;
    const thicknessSpan = TISSUE_BAKE_THICKNESS_MAX - TISSUE_BAKE_THICKNESS_MIN;

    for (const [ix, iz] of [[0, 0], [12, 7], [23, 23], [5, 19]]) {
      const x = tissueBakeAxisAt(ix, resolution, FIELD_HALF_X);
      const z = tissueBakeAxisAt(iz, resolution, FIELD_HALF_Z);
      const expected = tissueSampleAt(x, z);
      const offset = (iz * resolution + ix) * TISSUE_BAKE_CHANNELS;

      const density = fromHalfFloat(state.data[offset]);
      const foldY = fromHalfFloat(state.data[offset + 1]) * foldSpan
        - TISSUE_BAKE_FOLD_Y_RANGE;
      const thickness = fromHalfFloat(state.data[offset + 2]) * thicknessSpan
        + TISSUE_BAKE_THICKNESS_MIN;

      expect(density).toBeCloseTo(expected.density, 3);
      expect(foldY).toBeCloseTo(expected.foldY, 2);
      expect(thickness).toBeCloseTo(expected.thickness, 2);
      expect(fromHalfFloat(state.data[offset + 3])).toBe(1);
    }
  });

  it('maps texel centres onto the uv the sampling shader will use', () => {
    const resolution = 16;
    for (const index of [0, 1, 8, 15]) {
      const x = tissueBakeAxisAt(index, resolution, FIELD_HALF_X);
      // The shader's lookup is a plain linear remap of world position; the
      // centre of texel `index` must land exactly on that texel's uv centre,
      // or every sample is a half-texel off the law it claims to evaluate.
      const uv = x / (2 * FIELD_HALF_X) + 0.5;
      expect(uv * resolution).toBeCloseTo(index + 0.5, 10);
    }
  });

  it('covers the footprint helix declares, and no more', () => {
    const resolution = 8;
    expect(tissueBakeAxisAt(0, resolution, FIELD_HALF_X)).toBeGreaterThan(
      -FIELD_HALF_X,
    );
    expect(
      tissueBakeAxisAt(resolution - 1, resolution, FIELD_HALF_X),
    ).toBeLessThan(FIELD_HALF_X);
    expect(tissueBakeAxisAt(0, resolution, FIELD_HALF_Z)).toBeGreaterThan(
      -FIELD_HALF_Z,
    );
    expect(
      tissueBakeAxisAt(resolution - 1, resolution, FIELD_HALF_Z),
    ).toBeLessThan(FIELD_HALF_Z);
  });
});
