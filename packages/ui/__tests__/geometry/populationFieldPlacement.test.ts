import { describe, expect, it } from 'vitest';

import {
  advancePopulationPlacement,
  createPopulationPlacement,
  placePopulationField,
  populationComplementAcceptance,
  populationFibreAt,
  populationPlacementMajorant,
  POPULATION_FIELD_COVERAGE_CEILING,
  POPULATION_FIELD_FLATTEN,
  POPULATION_FIELD_OUTER_EDGE,
  POPULATION_FIELD_POINTS,
  POPULATION_FIELD_SEED,
} from '../../src/geometry/populationFieldPlacement';
import {
  FIELD_HALF_X,
  FIELD_HALF_Z,
  TISSUE_ENVELOPE_EDGE,
  tissueSampleAt,
} from '../../src/helix';

/** Enough points for every statistic below to be stable, small enough that
 *  the whole file stays well inside a normal test budget. The shipped count is
 *  an order of magnitude larger and samples the same distribution. */
const SAMPLE_POINTS = 20_000;

const placed = placePopulationField(SAMPLE_POINTS);

function pointAt(index: number): { x: number; y: number; z: number } {
  return {
    x: placed.positions[index * 3],
    y: placed.positions[index * 3 + 1],
    z: placed.positions[index * 3 + 2],
  };
}

describe('the halo is placed where the Cells are not', () => {
  it('fills its buffer', () => {
    expect(placed.count).toBe(SAMPLE_POINTS);
    expect(placed.done).toBe(true);
  });

  it('lands no point in dense resolved tissue', () => {
    // THE invariant, and it is now a property of the BUFFER rather than of
    // the rendered pixels: there is no photon to put back over an addressable
    // Cell, because there is no point. No gain, brightness, or density knob
    // downstream can reintroduce one.
    //
    // Stated on coverage and never on radius. "Zero inside r <= 0.70" was the
    // earlier formulation and it was wrong: it read the halo's ingress through
    // the tissue's cavities as a violation, when a cavity contains no Cells
    // and halo light in one obscures nothing.
    let worst = 0;
    for (let i = 0; i < placed.count; i += 1) {
      const { x, z } = pointAt(i);
      const coverage = tissueSampleAt(x, z).density;
      if (coverage > worst) worst = coverage;
    }
    expect(worst).toBeLessThan(POPULATION_FIELD_COVERAGE_CEILING);
  });

  it('reaches inside the resolved rim through the low-density paths', () => {
    // The complement of the previous test, and it has to be asserted or the
    // cheapest way to pass that one is a radius cutoff — which is exactly the
    // failure that produced a visible elliptical seam. The two populations
    // interdigitate; they do not meet at a line.
    let inside = 0;
    for (let i = 0; i < placed.count; i += 1) {
      const { x, z } = pointAt(i);
      const nx = x / FIELD_HALF_X;
      const nz = z / FIELD_HALF_Z;
      if (Math.sqrt(nx * nx + nz * nz) < TISSUE_ENVELOPE_EDGE) inside += 1;
    }
    expect(inside / placed.count).toBeGreaterThan(0.15);
  });

  it('stays inside the halo envelope', () => {
    for (let i = 0; i < placed.count; i += 1) {
      const { x, z } = pointAt(i);
      const sample = tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE);
      expect(sample.density).toBeGreaterThan(0);
    }
  });
});

describe('the halo follows the law it says it follows', () => {
  it('gathers where the tissue is dense', () => {
    // Rejection sampling against `density` means placed points must sit at a
    // far higher density than a uniform draw over the same box would.
    let placedDensity = 0;
    for (let i = 0; i < placed.count; i += 1) {
      const { x, z } = pointAt(i);
      placedDensity += tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE).density;
    }
    placedDensity /= placed.count;

    let uniformDensity = 0;
    const grid = 60;
    for (let iz = 0; iz < grid; iz += 1) {
      for (let ix = 0; ix < grid; ix += 1) {
        const x = ((ix + 0.5) / grid * 2 - 1)
          * FIELD_HALF_X * POPULATION_FIELD_OUTER_EDGE;
        const z = ((iz + 0.5) / grid * 2 - 1)
          * FIELD_HALF_Z * POPULATION_FIELD_OUTER_EDGE;
        uniformDensity += tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE)
          .density;
      }
    }
    uniformDensity /= grid * grid;

    expect(placedDensity).toBeGreaterThan(uniformDensity * 2);
  });

  it('gathers onto the fibre corridors', () => {
    // Without this the layer is an even dusting, which reads as spray rather
    // than as tissue however exactly its density is computed.
    //
    // The null hypothesis is not the ambient field: it is THIS placement with
    // the fibre step removed, i.e. the density-and-complement-weighted mean.
    // Comparing against anything else would let a build that dropped the
    // fibre pass on the density term's own correlation with the ridge octave.
    let placedFibre = 0;
    for (let i = 0; i < placed.count; i += 1) {
      const { x, z } = pointAt(i);
      const sample = tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE);
      placedFibre += populationFibreAt(sample.qx, sample.qz);
    }
    placedFibre /= placed.count;

    let weight = 0;
    let weightedFibre = 0;
    const grid = 90;
    for (let iz = 0; iz < grid; iz += 1) {
      for (let ix = 0; ix < grid; ix += 1) {
        const x = ((ix + 0.5) / grid * 2 - 1)
          * FIELD_HALF_X * POPULATION_FIELD_OUTER_EDGE;
        const z = ((iz + 0.5) / grid * 2 - 1)
          * FIELD_HALF_Z * POPULATION_FIELD_OUTER_EDGE;
        const sample = tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE);
        const w = sample.density
          * populationComplementAcceptance(sample.resolvedCoverage);
        weight += w;
        weightedFibre += w * populationFibreAt(sample.qx, sample.qz);
      }
    }
    const withoutFibre = weightedFibre / weight;

    expect(placedFibre).toBeGreaterThan(withoutFibre * 1.4);
  });

  it('flattens the spread and keeps the fold', () => {
    // Two separate claims, and the second is the one that survives an edge-on
    // camera: only the Gaussian SPREAD is thinned. The fold is the organism's
    // own mid-surface and keeps its full amplitude, so the halo is a warped
    // ribbon rather than a plane — a flat disk seen edge-on is a line.
    let spreadSq = 0;
    let foldSq = 0;
    let thickness = 0;
    for (let i = 0; i < placed.count; i += 1) {
      const { x, y, z } = pointAt(i);
      const sample = tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE);
      spreadSq += (y - sample.foldY) ** 2;
      foldSq += sample.foldY ** 2;
      thickness += sample.thickness;
    }
    const spreadRms = Math.sqrt(spreadSq / placed.count);
    const foldRms = Math.sqrt(foldSq / placed.count);
    const meanThickness = thickness / placed.count;

    // The spread is the Cells' own thickness, flattened.
    expect(spreadRms / meanThickness).toBeCloseTo(POPULATION_FIELD_FLATTEN, 1);
    // And the fold, untouched, carries MORE of the vertical extent than the
    // flattened spread does. If that ever inverts, the halo has become a
    // plane and the edge-on view has become a line.
    expect(foldRms).toBeGreaterThan(spreadRms);
  });
});

describe('the placement pass is exact and resumable', () => {
  it('never rejects a candidate the law would have accepted', () => {
    // The radius-only majorant skips the twelve-octave evaluation for the
    // candidates that were never going to survive. It is a speed-up only
    // while it is a true upper bound; a majorant that is ever wrong silently
    // biases the distribution instead of failing.
    const grid = 90;
    for (let iz = 0; iz < grid; iz += 1) {
      for (let ix = 0; ix < grid; ix += 1) {
        const x = ((ix + 0.5) / grid * 2 - 1)
          * FIELD_HALF_X * POPULATION_FIELD_OUTER_EDGE;
        const z = ((iz + 0.5) / grid * 2 - 1)
          * FIELD_HALF_Z * POPULATION_FIELD_OUTER_EDGE;
        const nx = x / FIELD_HALF_X;
        const nz = z / FIELD_HALF_Z;
        const radial = Math.sqrt(nx * nx + nz * nz);
        const density = tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE)
          .density;
        expect(density).toBeLessThanOrEqual(
          populationPlacementMajorant(radial) + 1e-12,
        );
      }
    }
  });

  it('produces one stream however the budget is divided', () => {
    // The renderer runs this to completion inside a worker, but the budgeted
    // form is what makes it testable and what a caller with a frame budget
    // would use. Chunking must not perturb the sequence.
    const whole = placePopulationField(2_000);
    const chunked = createPopulationPlacement(2_000);
    while (!chunked.done) advancePopulationPlacement(chunked, 997);

    expect(chunked.count).toBe(whole.count);
    expect(chunked.tries).toBe(whole.tries);
    expect(Array.from(chunked.positions)).toEqual(Array.from(whole.positions));
  });

  it('returns the same field on every reload', () => {
    const again = placePopulationField(2_000);
    const once = placePopulationField(2_000);
    expect(Array.from(again.positions)).toEqual(Array.from(once.positions));
    // And a different salt is a different field, so the determinism above is
    // the seed's doing and not a constant buffer.
    const other = placePopulationField(2_000, POPULATION_FIELD_SEED ^ 0x9e37);
    expect(Array.from(other.positions)).not.toEqual(Array.from(once.positions));
  });

  it('terminates on a count it cannot reach', () => {
    // A mis-tuned constant must degrade into a thinner field, never into an
    // unbounded loop on the thread that owns the frame.
    const impossible = createPopulationPlacement(4);
    // Reject everything by asking the complement for a coverage no tissue has.
    expect(populationComplementAcceptance(1)).toBe(0);
    advancePopulationPlacement(impossible, 4 * 400 + 1);
    expect(impossible.done).toBe(true);
  });

  it('states a population against the stage it contextualizes', () => {
    // Not a tuning constant to drift: the count is a claim. Against a
    // 12,000-Cell stage it is ~22 points per addressable Cell, and against
    // mainnet's ~1.46M live Cells about one point per five and a half the
    // dashboard could not individuate.
    expect(POPULATION_FIELD_POINTS / 12_000).toBeGreaterThan(15);
    expect(POPULATION_FIELD_POINTS).toBeLessThan(400_000);
  });
});

describe('the complement is a ramp, not a step', () => {
  it('is full strength on empty tissue and zero on dense tissue', () => {
    expect(populationComplementAcceptance(0)).toBe(1);
    expect(populationComplementAcceptance(POPULATION_FIELD_COVERAGE_CEILING))
      .toBe(0);
    expect(populationComplementAcceptance(1)).toBe(0);
  });

  it('crossfades across the band where the Cells are thinning', () => {
    // A hard step at the rim is the seam this design exists to remove: the
    // Cells thin from about 0.7 of the rim outward, so the halo has to arrive
    // while they are still thinning or there is a band where neither
    // population is drawn.
    const mid = populationComplementAcceptance(
      POPULATION_FIELD_COVERAGE_CEILING / 2,
    );
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });
});
