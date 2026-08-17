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
  POPULATION_FIBRE_MIX_A,
  POPULATION_FIBRE_MIX_B,
  POPULATION_FIBRE_SCALE_A,
  POPULATION_FIBRE_SCALE_B,
  POPULATION_FIBRE_WARP_B,
  POPULATION_FIELD_OUTER_EDGE,
  populationFibre,
  populationFibreBases,
  TISSUE_FIBRE_CHANNELS,
  TISSUE_BAKE_CHANNELS,
  TISSUE_BAKE_FOLD_Y_RANGE,
  TISSUE_BAKE_HALF_X,
  TISSUE_BAKE_HALF_Z,
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
      const x = tissueBakeAxisAt(ix, resolution, TISSUE_BAKE_HALF_X);
      const z = tissueBakeAxisAt(iz, resolution, TISSUE_BAKE_HALF_Z);
      const expected = tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE);
      const offset = (iz * resolution + ix) * TISSUE_BAKE_CHANNELS;

      const density = fromHalfFloat(state.data[offset]);
      const foldY = fromHalfFloat(state.data[offset + 1]) * foldSpan
        - TISSUE_BAKE_FOLD_Y_RANGE;
      const thickness = fromHalfFloat(state.data[offset + 2]) * thicknessSpan
        + TISSUE_BAKE_THICKNESS_MIN;
      const resolved = fromHalfFloat(state.data[offset + 3]);

      expect(density).toBeCloseTo(expected.density, 3);
      expect(foldY).toBeCloseTo(expected.foldY, 2);
      expect(thickness).toBeCloseTo(expected.thickness, 2);
      // A is no longer a constant filler. It carries the share of this texel's
      // body that cknerv has already drawn as addressable Cells, and the march
      // subtracts it — so a bake that put anything else here would put the
      // halo back on top of the Cells.
      expect(resolved).toBeCloseTo(expected.resolvedCoverage, 3);
      expect(resolved).toBeLessThanOrEqual(density + 1e-3);
    }
  });

  it('reaches past the resolved rim, and carries the rim inside itself', () => {
    // The two facts the relocation rests on, read straight off the texture:
    // the bake covers the HALO, and it still knows where the addressable Cells
    // stop. Without the first there is no layer; without the second it would
    // have nothing to subtract and would be an overlay again.
    const resolution = 64;
    const state = bakeTissueField(resolution);
    let pastRim = 0;
    let resolvedTexels = 0;

    for (let iz = 0; iz < resolution; iz += 1) {
      const z = tissueBakeAxisAt(iz, resolution, TISSUE_BAKE_HALF_Z);
      for (let ix = 0; ix < resolution; ix += 1) {
        const x = tissueBakeAxisAt(ix, resolution, TISSUE_BAKE_HALF_X);
        const offset = (iz * resolution + ix) * TISSUE_BAKE_CHANNELS;
        const density = fromHalfFloat(state.data[offset]);
        const resolved = fromHalfFloat(state.data[offset + 3]);

        // Rule 12 in the texture itself: a body that never closed would put
        // population on the whole screen.
        expect(resolved).toBeLessThanOrEqual(density + 1e-3);
        const radial = Math.hypot(x / FIELD_HALF_X, z / FIELD_HALF_Z);
        if (radial > 1.3) {
          if (density > 0.05) pastRim += 1;
          // Nothing cknerv drew is out here, so nothing may be subtracted.
          expect(resolved).toBe(0);
        }
        if (resolved > 0.05) resolvedTexels += 1;
      }
    }

    expect(pastRim).toBeGreaterThan(200);
    expect(resolvedTexels).toBeGreaterThan(100);
  });

  it('maps texel centres onto the uv the sampling shader will use', () => {
    const resolution = 16;
    for (const index of [0, 1, 8, 15]) {
      const x = tissueBakeAxisAt(index, resolution, TISSUE_BAKE_HALF_X);
      // The shader's lookup is a plain linear remap of world position; the
      // centre of texel `index` must land exactly on that texel's uv centre,
      // or every sample is a half-texel off the law it claims to evaluate.
      // The half-extent here is the SLAB's, which is the halo's — the march
      // divides by its own uHalf, so the two have to be the same rectangle.
      const uv = x / (2 * TISSUE_BAKE_HALF_X) + 0.5;
      expect(uv * resolution).toBeCloseTo(index + 0.5, 10);
    }
  });

  it('covers the halo footprint, grown outward from an unmoved rim', () => {
    // FIELD_HALF_X/Z keep their exact values and their exact meaning: where the
    // addressable Cells end, and what delivery landings and the contact front's
    // extinction band derive from. The bake grows OUTWARD from them. Shrinking
    // the Cell field to make room would have dragged in every constant tuned
    // against the old scale, which is a bug class this tree has paid for once.
    expect(TISSUE_BAKE_HALF_X).toBe(FIELD_HALF_X * POPULATION_FIELD_OUTER_EDGE);
    expect(TISSUE_BAKE_HALF_Z).toBe(FIELD_HALF_Z * POPULATION_FIELD_OUTER_EDGE);
    expect(POPULATION_FIELD_OUTER_EDGE).toBeGreaterThan(1);
    expect(FIELD_HALF_X).toBe(60);
    expect(FIELD_HALF_Z).toBe(54);

    const resolution = 8;
    expect(tissueBakeAxisAt(0, resolution, TISSUE_BAKE_HALF_X)).toBeGreaterThan(
      -TISSUE_BAKE_HALF_X,
    );
    expect(
      tissueBakeAxisAt(resolution - 1, resolution, TISSUE_BAKE_HALF_X),
    ).toBeLessThan(TISSUE_BAKE_HALF_X);
    expect(tissueBakeAxisAt(0, resolution, TISSUE_BAKE_HALF_Z)).toBeGreaterThan(
      -TISSUE_BAKE_HALF_Z,
    );
    expect(
      tissueBakeAxisAt(resolution - 1, resolution, TISSUE_BAKE_HALF_Z),
    ).toBeLessThan(TISSUE_BAKE_HALF_Z);
  });
});

describe('the halo fibre', () => {
  it('stays inside the range the bake and the shader both assume', () => {
    // Both bases are `1 - |noise|` with noise in [-1, 1], so they are in
    // [0, 1] — which is what lets the composite raise them to the seventh and
    // ninth without the result running away, and what lets them be stored in
    // a half float with no normalization of their own.
    for (let iz = 0; iz <= 30; iz += 1) {
      for (let ix = 0; ix <= 30; ix += 1) {
        const qx = (ix / 30) * 4 * FIELD_HALF_X - 2 * FIELD_HALF_X;
        const qz = (iz / 30) * 4 * FIELD_HALF_Z - 2 * FIELD_HALF_Z;
        const [a, b] = populationFibreBases(qx, qz);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(1);
        const fibre = populationFibre(a, b);
        expect(fibre).toBeGreaterThanOrEqual(0);
        expect(fibre).toBeLessThanOrEqual(POPULATION_FIBRE_MIX_A + POPULATION_FIBRE_MIX_B);
      }
    }
  });

  it('follows the organism\'s flow, not a grid', () => {
    // §5.1. The octaves are read on the WARPED coordinates, so the strands
    // run along the same corridors the Cells are placed in. Evaluated on the
    // raw position instead they would be a pattern laid over the galaxy —
    // correct-looking noise that agrees with nothing.
    let differed = 0;
    for (let iz = 0; iz <= 20; iz += 1) {
      for (let ix = 0; ix <= 20; ix += 1) {
        const x = (ix / 20) * 2 * FIELD_HALF_X - FIELD_HALF_X;
        const z = (iz / 20) * 2 * FIELD_HALF_Z - FIELD_HALF_Z;
        const sample = tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE);
        // The warp really does move the point, and the bake really does use
        // the moved one.
        const warped = populationFibre(...populationFibreBases(sample.qx, sample.qz));
        const unwarped = populationFibre(...populationFibreBases(x, z));
        if (Math.abs(warped - unwarped) > 1e-6) differed += 1;
      }
    }
    expect(differed).toBeGreaterThan(400);
  });

  it('is fine enough to read as dendritic, not as marbling', () => {
    // ⚠️ Scale is the whole game here, and it is the one thing about this
    // layer that cannot be fixed later by a gain. The density's own ridge
    // octave sits at 11 world units and projects as MARBLING; the same
    // construction at 3-5 units reads as dendritic. Both were prototyped, and
    // the difference is not subtle.
    expect(POPULATION_FIBRE_SCALE_A).toBeLessThan(11 / 1.8);
    // The second octave carries a coordinate scaling, so its true world scale
    // is the quotient — the finest structure the layer has.
    const scaleB = POPULATION_FIBRE_SCALE_B / POPULATION_FIBRE_WARP_B;
    expect(scaleB).toBeLessThan(POPULATION_FIBRE_SCALE_A);
    expect(scaleB).toBeGreaterThan(1);

    // And measured rather than asserted from the constants: along a line
    // through the tissue the fibre has to turn over much faster than the
    // density it rides on, or it is just more of the same shape.
    const step = 2;
    let fibreRough = 0;
    let densityRough = 0;
    let fibreMean = 0;
    let densityMean = 0;
    let n = 0;
    let previous: { fibre: number; density: number } | null = null;
    for (let x = -FIELD_HALF_X; x <= FIELD_HALF_X; x += step) {
      const sample = tissueSampleAt(x, 8, POPULATION_FIELD_OUTER_EDGE);
      const current = {
        fibre: populationFibre(...populationFibreBases(sample.qx, sample.qz)),
        density: sample.density,
      };
      if (previous) {
        fibreRough += Math.abs(current.fibre - previous.fibre);
        densityRough += Math.abs(current.density - previous.density);
        n += 1;
      }
      fibreMean += current.fibre;
      densityMean += current.density;
      previous = current;
    }
    const samples = Math.floor((2 * FIELD_HALF_X) / step) + 1;
    // Normalized by each field's own level, so this compares STRUCTURE and
    // not amplitude.
    const fibreTurnover = (fibreRough / n) / (fibreMean / samples);
    const densityTurnover = (densityRough / n) / (densityMean / samples);
    expect(fibreTurnover).toBeGreaterThan(densityTurnover * 3);
  });

  it('bakes its bases off the same evaluation as the law', () => {
    // One pass, one warp. Re-deriving `qx, qz` for the fibre would be four
    // more noise evaluations per texel AND a second chance for the two to
    // drift apart, and the strands agreeing with the corridors is the entire
    // reason they read as the organism's own grain.
    const state = bakeTissueField(24);
    expect(state.fibre).toHaveLength(24 * 24 * TISSUE_FIBRE_CHANNELS);

    for (const [ix, iz] of [[0, 0], [7, 3], [12, 12], [23, 23]]) {
      const x = tissueBakeAxisAt(ix, 24, TISSUE_BAKE_HALF_X);
      const z = tissueBakeAxisAt(iz, 24, TISSUE_BAKE_HALF_Z);
      const sample = tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE);
      const [a, b] = populationFibreBases(sample.qx, sample.qz);
      const offset = (iz * 24 + ix) * TISSUE_FIBRE_CHANNELS;
      expect(fromHalfFloat(state.fibre[offset])).toBeCloseTo(a, 3);
      expect(fromHalfFloat(state.fibre[offset + 1])).toBeCloseTo(b, 3);
    }
  });

  it('fills the fibre with the same incremental budget as the law', () => {
    // The fibre cannot lag the law by a row: they are uploaded together the
    // frame the bake finishes, and a partly filled fibre would draw strands
    // that stop in a straight line across the galaxy.
    const state = createTissueFieldBake(16);
    advanceTissueFieldBake(state, 5);
    expect(state.rows).toBe(5);
    const filled = state.fibre.slice(0, 5 * 16 * TISSUE_FIBRE_CHANNELS);
    expect(filled.some((value) => value !== 0)).toBe(true);
    const untouched = state.fibre.slice(5 * 16 * TISSUE_FIBRE_CHANNELS);
    expect(untouched.every((value) => value === 0)).toBe(true);

    advanceTissueFieldBake(state, 16);
    expect(state.done).toBe(true);
    expect(state.fibre.some((value) => value !== 0)).toBe(true);
  });
});
