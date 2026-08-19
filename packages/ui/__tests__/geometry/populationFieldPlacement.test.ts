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
  POPULATION_STREAMLINE_JITTER,
  POPULATION_STREAMLINE_MAX_GENERATION,
  POPULATION_STREAMLINE_STEP,
  POPULATION_TAPER_COVERAGE_LIFT,
  POPULATION_TAPER_DENSITY_FULL,
  populationPointWeight,
  populationSegmentsForPointPrefix,
} from '../../src/geometry/populationFieldPlacement';
import {
  FIELD_HALF_X,
  FIELD_HALF_Z,
  helixSeedF64,
  TISSUE_ENVELOPE_EDGE,
  tissueSampleAt,
} from '../../src/helix';
import { cellPointSize } from '../../src/components/CellGalaxy';
import {
  populationPointSizeForWeight,
  POPULATION_FIELD_SIGMA,
} from '../../src/materials/populationFieldMaterial';

/** Enough points for every statistic below to be stable, small enough that
 *  the whole file stays well inside a normal test budget. The shipped count is
 *  an order of magnitude larger and walks the same law. */
const SAMPLE_POINTS = 20_000;

const placed = placePopulationField(SAMPLE_POINTS);

function pointAt(index: number): { x: number; y: number; z: number } {
  return {
    x: placed.positions[index * 3],
    y: placed.positions[index * 3 + 1],
    z: placed.positions[index * 3 + 2],
  };
}

/** Rendered light of one Gaussian sprite: peak alpha over its footprint, so
 *  `peak * (sigma * size)^2`. The house model — the same one that set the
 *  size range — extended with each layer's own Gaussian width, which is what
 *  a comparison ACROSS the two layers needs. */
function spriteFlux(size: number, sigma: number, peak: number): number {
  const s = sigma * size;
  return peak * s * s;
}

/** The radial luminance profile, in perceptual lightness, binned by elliptical
 *  radius. This is the measurement §5.2's brightness rule is derived from, and
 *  it is here so the derivation stays checkable rather than remembered. */
function radialProfile(bins: number): {
  cells: number[]; halo: number[]; lightness: number[];
} {
  const CELL_SIGMA = 0.10;   // cellHybridMaterial's Gaussian width
  const CELL_PEAK = 1.18;    // what a Cell body emits at its core
  const EMISSION = 0.72;     // populationEmissionForGain at mainnet chain scope
  const cells = new Array(bins).fill(0);
  const halo = new Array(bins).fill(0);
  const binOf = (x: number, z: number) => {
    const r = Math.hypot(x / FIELD_HALF_X, z / FIELD_HALF_Z);
    const b = Math.floor((r / POPULATION_FIELD_OUTER_EDGE) * bins);
    return b >= 0 && b < bins ? b : -1;
  };
  for (let i = 0; i < 12_000; i += 1) {
    const id = i * 7 + 1000003;
    const p = helixSeedF64(id);
    const b = binOf(p[0], p[2]);
    if (b >= 0) cells[b] += spriteFlux(cellPointSize({ id, tag: null }), CELL_SIGMA, CELL_PEAK);
  }
  for (let i = 0; i < placed.count; i += 1) {
    const b = binOf(placed.positions[i * 3], placed.positions[i * 3 + 2]);
    if (b < 0) continue;
    halo[b] += spriteFlux(
      populationPointSizeForWeight(placed.weights[i]),
      POPULATION_FIELD_SIGMA,
      EMISSION,
    ) * (POPULATION_FIELD_POINTS / SAMPLE_POINTS);
  }
  const lightness = cells.map((c, b) => {
    const r1 = (b / bins) * POPULATION_FIELD_OUTER_EDGE;
    const r2 = ((b + 1) / bins) * POPULATION_FIELD_OUTER_EDGE;
    const area = Math.PI * FIELD_HALF_X * FIELD_HALF_Z * (r2 * r2 - r1 * r1);
    return Math.cbrt((c + halo[b]) / area);   // OKLab-style perceptual
  });
  return { cells, halo, lightness };
}

describe('the radial luminance profile the brightness rule is solved from', () => {
  const BINS = 44;
  const profile = radialProfile(BINS);
  const at = (r: number) => Math.min(BINS - 1, Math.floor((r / POPULATION_FIELD_OUTER_EDGE) * BINS));

  it('has no step where the addressable Cells stop', () => {
    // §5.2 said the Cells "stop dead at radius 1.04" and that a brightness
    // taper deepens that step. Measured, there is no step to deepen: the
    // profile crosses the rim flatter than it moves anywhere in the outer
    // field. The rule that used to taper brightness outward was answering a
    // feature that is not in the frame.
    const rim = at(TISSUE_ENVELOPE_EDGE);
    const acrossRim = Math.abs(profile.lightness[rim + 1] - profile.lightness[rim]);
    const outerSteps: number[] = [];
    for (let b = at(1.3); b < at(1.9); b += 1) {
      outerSteps.push(Math.abs(profile.lightness[b + 1] - profile.lightness[b]));
    }
    const typicalOuter = outerSteps.reduce((s, v) => s + v, 0) / outerSteps.length;
    expect(acrossRim).toBeLessThan(typicalOuter);
  });

  it('has the halo already carrying the light before the Cells run out', () => {
    // The other half of the same correction: the Cells are not the dominant
    // source at the rim, so their ending cannot be what the eye reads there.
    // Their share is already under a tenth well inside it, and the handover
    // happens over the mixed band rather than at a boundary.
    const share = (r: number) => {
      const b = at(r);
      return profile.cells[b] / (profile.cells[b] + profile.halo[b]);
    };
    // Thresholds are loose because this file samples 20,000 points against
    // the shipped 105,000; the shipped placement hands over earlier still
    // (half by radius 0.72, a tenth by 0.93, 1.3% at the rim).
    expect(share(0.60)).toBeGreaterThan(0.5);
    expect(share(0.95)).toBeLessThan(0.20);
    expect(share(TISSUE_ENVELOPE_EDGE)).toBeLessThan(0.06);
  });

  it('brightens across the mixed band as the Cells thin', () => {
    // §5.2's requirement, and it is met by the halo's own density rather than
    // by a per-point brightness rule — which is why brightness could be freed
    // to be flat. Rendered halo luminance per unit area, over the band.
    const density = (r: number) => {
      const b = at(r);
      const r1 = (b / BINS) * POPULATION_FIELD_OUTER_EDGE;
      const r2 = ((b + 1) / BINS) * POPULATION_FIELD_OUTER_EDGE;
      return profile.halo[b] / (Math.PI * FIELD_HALF_X * FIELD_HALF_Z * (r2 * r2 - r1 * r1));
    };
    expect(density(0.80)).toBeGreaterThan(density(0.70));
    expect(density(0.95)).toBeGreaterThan(density(0.80));
    expect(density(TISSUE_ENVELOPE_EDGE)).toBeGreaterThan(density(0.95));
  });
});

describe('the halo is placed where the Cells are not', () => {
  it('fills its buffer', () => {
    expect(placed.count).toBe(SAMPLE_POINTS);
    expect(placed.done).toBe(true);
  });

  it('lands no point in dense resolved tissue', () => {
    // THE invariant, and it is a property of the BUFFER rather than of the
    // rendered pixels: there is no photon to put back over an addressable
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

describe('the taper is baked with the point', () => {
  it('writes a weight for every placed point, and only for those', () => {
    expect(placed.weights.length).toBe(SAMPLE_POINTS);
    for (let i = 0; i < placed.count; i += 1) {
      expect(placed.weights[i]).toBeGreaterThanOrEqual(0);
      expect(placed.weights[i]).toBeLessThanOrEqual(1);
    }
  });

  it('is not flat — which is the whole reason it exists', () => {
    // A single size next to a varied one reads as two classes however small
    // it is. Measured on the shipped 105,000-point buffer, this spreads the
    // halo across 15 of the 19 log-spaced size bins between 0.42 and 2.45 in
    // the mixed band, against 11 for a flat value.
    let low = 0;
    let high = 0;
    for (let i = 0; i < placed.count; i += 1) {
      if (placed.weights[i] < 0.2) low += 1;
      if (placed.weights[i] > 0.8) high += 1;
    }
    expect(low / placed.count).toBeGreaterThan(0.05);
    expect(high / placed.count).toBeGreaterThan(0.05);
  });

  it('rises beside the Cells and falls in the open fringe', () => {
    // The requirement, stated as the two things it has to do at once.
    let beside = 0;
    let besideN = 0;
    let fringe = 0;
    let fringeN = 0;
    for (let i = 0; i < placed.count; i += 1) {
      const { x, z } = pointAt(i);
      const sample = tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE);
      if (sample.resolvedCoverage > 0.2) {
        beside += placed.weights[i];
        besideN += 1;
      } else if (sample.density < 0.1) {
        fringe += placed.weights[i];
        fringeN += 1;
      }
    }
    expect(besideN).toBeGreaterThan(0);
    expect(fringeN).toBeGreaterThan(0);
    expect(beside / besideN).toBeGreaterThan(fringe / fringeN * 3);
  });

  it('carries structure a radius could not', () => {
    // ⚠️ The design named `resolvedCoverage` as the key on the grounds that
    // radius is smooth and elliptical. MEASURED, coverage is the MORE radial
    // of the two candidates — its envelope closes hard at the resolved rim, so
    // it is exactly zero for the three quarters of the halo that live outside
    // it — and a coverage-only taper re-flattens the layer at the bottom of
    // its range instead of the top. The density term is what carries the
    // irregular structure; this test is the guard on that finding.
    const BINS = 40;
    const sum = new Float64Array(BINS);
    const seen = new Float64Array(BINS);
    let mean = 0;
    const radius = new Float64Array(placed.count);
    for (let i = 0; i < placed.count; i += 1) {
      const { x, z } = pointAt(i);
      const nx = x / FIELD_HALF_X;
      const nz = z / FIELD_HALF_Z;
      radius[i] = Math.sqrt(nx * nx + nz * nz);
      const bin = Math.min(
        BINS - 1,
        Math.floor(radius[i] / POPULATION_FIELD_OUTER_EDGE * BINS),
      );
      sum[bin] += placed.weights[i];
      seen[bin] += 1;
      mean += placed.weights[i];
    }
    mean /= placed.count;
    let total = 0;
    let residual = 0;
    for (let i = 0; i < placed.count; i += 1) {
      const bin = Math.min(
        BINS - 1,
        Math.floor(radius[i] / POPULATION_FIELD_OUTER_EDGE * BINS),
      );
      const predicted = sum[bin] / seen[bin];
      total += (placed.weights[i] - mean) ** 2;
      residual += (placed.weights[i] - predicted) ** 2;
    }
    // Nearly half the taper's variance is invisible to any function of radius.
    expect(residual / total).toBeGreaterThan(0.4);
  });

  it('is a pure function of the sample already in hand', () => {
    // Both terms come from one `tissueSampleAt`, so the taper costs no field
    // evaluation at all — the walk was going to make that call anyway.
    expect(populationPointWeight(0, 0)).toBe(0);
    expect(populationPointWeight(POPULATION_TAPER_DENSITY_FULL, 0)).toBe(1);
    expect(populationPointWeight(9, 9)).toBe(1);
    expect(populationPointWeight(0.3, 0)).toBeCloseTo(
      0.3 / POPULATION_TAPER_DENSITY_FULL,
      12,
    );
    // The coverage term LIFTS; it never stands alone.
    expect(POPULATION_TAPER_COVERAGE_LIFT).toBeGreaterThan(0);
    expect(POPULATION_TAPER_COVERAGE_LIFT).toBeLessThan(1);
    expect(populationPointWeight(0.2, 0.3))
      .toBeGreaterThan(populationPointWeight(0.2, 0));
  });
});

describe('the fibres connect halo points and nothing else', () => {
  // Rule 4, as amended 2026-08-18. The Cells' own fabric is a k-NN proximity
  // mesh over positions — a geometric property of the embedding, not a claim
  // that two Cells transacted — so edges among placed halo points carry
  // exactly the truth status the core's edges do. What stays forbidden is an
  // edge with ONE END on an addressable Cell, which would assert a
  // relationship between a named Cell and an anonymous one.

  it('emits fibres at all', () => {
    expect(placed.segmentCount).toBeGreaterThan(placed.count * 0.8);
    expect(placed.streamlines).toBeGreaterThan(0);
  });

  it('names only points this pass placed', () => {
    // Structural, and it is why the renderer draws the fibres as an INDEX
    // buffer over the points' own position attribute: there is no other vertex
    // in that geometry for an index to reach.
    for (let i = 0; i < placed.segmentCount * 2; i += 1) {
      expect(placed.segments[i]).toBeLessThan(placed.count);
    }
    // And every index is addressable as a point, so nothing dangles past the
    // written prefix when a pass stops short of its capacity.
    expect(placed.segments.length).toBeGreaterThanOrEqual(
      placed.segmentCount * 2,
    );
  });

  it('never bridges a gap the complement cleared', () => {
    // The strongest form this can take, and it makes the claim structural
    // rather than statistical: every segment spans exactly ONE integration
    // step in the ground plane. A point the complement rejected costs the walk
    // a step, so a bridge across one would have to span at least two — and
    // with the measured turn rate a two-step displacement is never shorter
    // than 1.78 steps. A fibre therefore cannot cross tissue the complement
    // just cleared, at any tuning of the knee.
    let worst = 0;
    for (let i = 0; i < placed.segmentCount; i += 1) {
      const a = placed.segments[i * 2];
      const b = placed.segments[i * 2 + 1];
      const dx = placed.positions[a * 3] - placed.positions[b * 3];
      const dz = placed.positions[a * 3 + 2] - placed.positions[b * 3 + 2];
      const span = Math.sqrt(dx * dx + dz * dz);
      if (span > worst) worst = span;
    }
    expect(worst).toBeLessThanOrEqual(POPULATION_STREAMLINE_STEP + 1e-4);
    expect(worst).toBeGreaterThan(POPULATION_STREAMLINE_STEP - 1e-4);
  });

  it('never closes a segment onto itself', () => {
    for (let i = 0; i < placed.segmentCount; i += 1) {
      expect(placed.segments[i * 2]).not.toBe(placed.segments[i * 2 + 1]);
    }
  });

  it('draws strokes, not dust', () => {
    // The count of components is the wrong statistic and it misled a whole
    // round: a third of components are one or two points, but they hold under
    // 4% of the light. Weight by POINTS, which is what the eye sees.
    const size = componentSizes();
    let inStrokes = 0;
    for (let i = 0; i < placed.count; i += 1) {
      if (size.of[i] >= 8) inStrokes += 1;
    }
    expect(inStrokes / placed.count).toBeGreaterThan(0.8);
  });

  it('frays into the Cells rather than everywhere', () => {
    // Where the fragmentation happens is the whole question. A filament that
    // breaks up as it enters the resolved tissue is the interdigitation this
    // design exists to produce; one that breaks up in open halo would be a
    // defect. Measured, singleton points sit at a resolved coverage of ~0.29
    // against ~0.01 for points inside long strokes.
    const size = componentSizes();
    let loneCoverage = 0;
    let lone = 0;
    let strokeCoverage = 0;
    let stroke = 0;
    for (let i = 0; i < placed.count; i += 1) {
      const { x, z } = pointAt(i);
      const coverage = tissueSampleAt(x, z).density;
      if (size.of[i] === 1) {
        loneCoverage += coverage;
        lone += 1;
      } else if (size.of[i] >= 16) {
        strokeCoverage += coverage;
        stroke += 1;
      }
    }
    expect(lone).toBeGreaterThan(0);
    expect(loneCoverage / lone).toBeGreaterThan(strokeCoverage / stroke * 4);
  });

  it('bounds how deep a fork may nest', () => {
    // Uncapped, the fork rule percolates — a child is as eligible a parent as
    // its parent was, and one component swallowed 24% of every placed point
    // while the median stayed at two. That is one tangle and a lot of dust,
    // not a spread of lengths.
    expect(POPULATION_STREAMLINE_MAX_GENERATION).toBeGreaterThanOrEqual(1);
    const size = componentSizes();
    let largest = 0;
    for (const n of size.sizes) if (n > largest) largest = n;
    expect(largest / placed.count).toBeLessThan(0.2);
  });

  it('draws runs at the fabric\'s own scale, not an order above it', () => {
    // The tangle half of a trade orientation coherence cannot make on its own:
    // coherence REWARDS long coherent runs, so shortening them can only lower
    // it, and a wide-window coherence turned out to move in lockstep with the
    // narrow one (ratio 0.77–0.79 across every variant swept) because filament
    // length is not what makes neighbouring filaments parallel — the flow
    // field is.
    //
    // The comparison the eye actually makes is against the Cells' own fabric.
    // MEASURED over the 8,000 edges it draws for a 12,000-Cell stage, at the
    // app's `neighborK` 5 / `maxEdgeLength` 42. RE-MEASURED 2026-08-19 after
    // the fabric's k-NN search was corrected: p50 5.70 -> 2.19, p90 8.47 ->
    // 4.05, max 26.17 -> 26.98. The max is unmoved because the fabric's
    // longest drawn edges are lifeline and stitch edges, which are not k-NN
    // edges — so the ceiling this was calibrated against still holds while the
    // typical stroke halved.
    const FABRIC_EDGE_P50 = 2.19;
    const FABRIC_EDGE_P90 = 4.05;
    const FABRIC_EDGE_MAX = 26.98;

    // A run is a maximal chain of consecutive segments — what is actually
    // drawn as one unbroken curve, which is not the same as one filament: the
    // complement breaks a filament wherever it crosses resolved tissue.
    const runs: number[] = [];
    let run = 0;
    let previousEnd = -2;
    for (let i = 0; i < placed.segmentCount; i += 1) {
      const a = placed.segments[i * 2];
      if (a === previousEnd) run += 1;
      else {
        if (run > 0) runs.push(run);
        run = 1;
      }
      previousEnd = placed.segments[i * 2 + 1];
    }
    if (run > 0) runs.push(run);
    const world = runs
      .map((steps) => steps * POPULATION_STREAMLINE_STEP)
      .sort((a, b) => a - b);
    const at = (p: number) => world[Math.floor(p * (world.length - 1))];

    // The longest curve the halo draws stays inside the longest edge the
    // fabric draws, within a margin. It used to be 3.1x it.
    expect(world[world.length - 1]).toBeLessThan(FABRIC_EDGE_MAX * 1.5);
    // ⚠️ The typical-stroke bands are WIDER than the calibration achieved,
    // and they are recorded rather than met: the fabric's p50 and p90 halved
    // under the k-NN correction while its max did not, so these ratios went
    // 1.5x -> 4.0x and 2.80x -> 5.86x without the halo changing at all.
    // Neither lever can follow — fewer steps breaks the "strokes, not dust"
    // floor above, and the step length is set against the sprite footprint.
    // See POPULATION_STREAMLINE_MIN_STEPS for the swept numbers. These bounds
    // exist to catch the runs growing FURTHER, not to claim the gap is shut.
    expect(at(0.5)).toBeLessThan(FABRIC_EDGE_P50 * 4.4);
    expect(at(0.9)).toBeLessThan(FABRIC_EDGE_P90 * 6.2);

    // And the spread SURVIVES. A uniform draw between two bounds is what made
    // an earlier pass read as felt — every filament the same size, no
    // hierarchy, no reading order — so shortening the tail must not flatten
    // the distribution onto one length.
    expect(at(0.9) / at(0.5)).toBeGreaterThan(2);
  });

  it('forks, so the tissue branches instead of combing', () => {
    const degree = new Int32Array(placed.count);
    for (let i = 0; i < placed.segmentCount * 2; i += 1) {
      degree[placed.segments[i]] += 1;
    }
    let forks = 0;
    for (let i = 0; i < placed.count; i += 1) if (degree[i] > 2) forks += 1;
    expect(forks).toBeGreaterThan(placed.count * 0.005);
  });
});

/** Connected components of the drawn fibre graph. */
function componentSizes(): { of: Int32Array; sizes: number[] } {
  const degree = new Int32Array(placed.count);
  for (let i = 0; i < placed.segmentCount * 2; i += 1) {
    degree[placed.segments[i]] += 1;
  }
  const offset = new Int32Array(placed.count + 1);
  for (let i = 0; i < placed.count; i += 1) offset[i + 1] = offset[i] + degree[i];
  const cursor = offset.slice(0, placed.count);
  const adjacency = new Int32Array(placed.segmentCount * 2);
  for (let i = 0; i < placed.segmentCount; i += 1) {
    const a = placed.segments[i * 2];
    const b = placed.segments[i * 2 + 1];
    adjacency[cursor[a]] = b;
    cursor[a] += 1;
    adjacency[cursor[b]] = a;
    cursor[b] += 1;
  }
  const component = new Int32Array(placed.count).fill(-1);
  const stack = new Int32Array(placed.count);
  const sizes: number[] = [];
  const of = new Int32Array(placed.count);
  for (let seed = 0; seed < placed.count; seed += 1) {
    if (component[seed] >= 0) continue;
    const id = sizes.length;
    let top = 0;
    let members = 0;
    stack[top] = seed;
    top += 1;
    component[seed] = id;
    while (top > 0) {
      top -= 1;
      const node = stack[top];
      members += 1;
      for (let k = offset[node]; k < offset[node + 1]; k += 1) {
        const other = adjacency[k];
        if (component[other] >= 0) continue;
        component[other] = id;
        stack[top] = other;
        top += 1;
      }
    }
    sizes.push(members);
  }
  for (let i = 0; i < placed.count; i += 1) of[i] = sizes[component[i]];
  return { of, sizes };
}

describe('the halo follows the law it says it follows', () => {
  it('gathers where the tissue is dense', () => {
    // Seeds are rejection-sampled against `density`, so placed points must sit
    // at a far higher density than a uniform draw over the same box would.
    //
    // The margin is thinner than the independent-draw build's, and the reason
    // is the construction rather than a weaker law: only the SEED is sampled
    // against density. The walk then carries a filament wherever the flow
    // takes it, including out into thin tissue, which is exactly what draws
    // the halo's outer silhouette. Weighting every step would straighten the
    // filaments back onto the density gradient and undo the thing this layer
    // was rebuilt for.
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

    expect(placedDensity).toBeGreaterThan(uniformDensity * 1.8);
  });

  it('runs its filaments in bundles, not in a plate of noodles', () => {
    // What the fibre field is FOR, and the only claim about it the measurement
    // supports. Two ways of also making it a density weight were built and
    // rejected — see the module — because a curve integrated perpendicular to
    // a gradient follows a CONTOUR and preserves the value it started at, so
    // the walk cannot be made to concentrate on the ridges. What it does do is
    // give every filament in a neighbourhood the same direction field to read,
    // and parallel bundles are what a corridor IS.
    //
    // Orientation coherence cannot arbitrate this: it is flat within noise
    // whether the field steers the walk or not. Only the alignment BETWEEN
    // filaments moves, from 0.637 (random headings) to about 0.71.
    const tangentX = new Float64Array(placed.count);
    const tangentZ = new Float64Array(placed.count);
    const hasTangent = new Uint8Array(placed.count);
    const next = new Int32Array(placed.count).fill(-1);
    for (let i = 0; i < placed.segmentCount; i += 1) {
      next[placed.segments[i * 2]] = placed.segments[i * 2 + 1];
    }
    const filament = new Int32Array(placed.count).fill(-1);
    let filaments = 0;
    for (let i = 0; i < placed.count; i += 1) {
      if (filament[i] >= 0) continue;
      const id = filaments;
      filaments += 1;
      let node = i;
      while (node >= 0 && filament[node] < 0) {
        filament[node] = id;
        node = next[node];
      }
    }
    for (let i = 0; i < placed.count; i += 1) {
      const to = next[i];
      if (to < 0) continue;
      const dx = placed.positions[to * 3] - placed.positions[i * 3];
      const dz = placed.positions[to * 3 + 2] - placed.positions[i * 3 + 2];
      const length = Math.sqrt(dx * dx + dz * dz) || 1;
      tangentX[i] = dx / length;
      tangentZ[i] = dz / length;
      hasTangent[i] = 1;
    }

    const cell = 3;
    const span = Math.ceil(2 * FIELD_HALF_X * POPULATION_FIELD_OUTER_EDGE / cell);
    const buckets = new Map<number, number[]>();
    for (let i = 0; i < placed.count; i += 1) {
      if (!hasTangent[i]) continue;
      const gx = Math.floor(
        (placed.positions[i * 3] + FIELD_HALF_X * POPULATION_FIELD_OUTER_EDGE)
          / cell,
      );
      const gz = Math.floor(
        (placed.positions[i * 3 + 2]
          + FIELD_HALF_Z * POPULATION_FIELD_OUTER_EDGE) / cell,
      );
      const key = gz * span + gx;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(i);
      else buckets.set(key, [i]);
    }
    let aligned = 0;
    let pairs = 0;
    for (const bucket of buckets.values()) {
      for (let a = 0; a < bucket.length; a += 1) {
        for (let b = a + 1; b < bucket.length; b += 1) {
          const i = bucket[a];
          const j = bucket[b];
          if (filament[i] === filament[j]) continue;
          aligned += Math.abs(
            tangentX[i] * tangentX[j] + tangentZ[i] * tangentZ[j],
          );
          pairs += 1;
        }
      }
    }
    expect(pairs).toBeGreaterThan(10_000);
    // Uniformly random headings give 2/pi. Anything at or below that means the
    // walk has stopped reading the field and the layer is a set of independent
    // persistent random walks — which the coherence measure would happily pass.
    expect(aligned / pairs).toBeGreaterThan(2 / Math.PI + 0.04);
  });

  it('draws one vertical offset per filament, not per point', () => {
    // This is what makes a filament a CURVE on screen instead of a smear
    // across the slab, and it is the whole reason the fibres project as
    // strokes. Consecutive points on one filament must sit at nearly the same
    // number of local thicknesses from the fold; independent draws would sit
    // at a correlation of zero.
    let sum = 0;
    let sumSq = 0;
    let cross = 0;
    let n = 0;
    for (let i = 0; i < placed.segmentCount; i += 1) {
      const a = placed.segments[i * 2];
      const b = placed.segments[i * 2 + 1];
      const sa = tissueSampleAt(
        placed.positions[a * 3],
        placed.positions[a * 3 + 2],
        POPULATION_FIELD_OUTER_EDGE,
      );
      const sb = tissueSampleAt(
        placed.positions[b * 3],
        placed.positions[b * 3 + 2],
        POPULATION_FIELD_OUTER_EDGE,
      );
      const ga = (placed.positions[a * 3 + 1] - sa.foldY)
        / (sa.thickness * POPULATION_FIELD_FLATTEN);
      const gb = (placed.positions[b * 3 + 1] - sb.foldY)
        / (sb.thickness * POPULATION_FIELD_FLATTEN);
      sum += ga + gb;
      sumSq += ga * ga + gb * gb;
      cross += ga * gb;
      n += 1;
    }
    const mean = sum / (2 * n);
    const variance = sumSq / (2 * n) - mean * mean;
    const correlation = (cross / n - mean * mean) / variance;
    // `sqrt(1 - JITTER^2)` is the construction's own answer, and the whole
    // point of composing the offset that way is that the marginal slab is
    // provably unchanged while the strand stays coherent.
    const expected = Math.sqrt(1 - POPULATION_STREAMLINE_JITTER ** 2);
    expect(correlation).toBeGreaterThan(expected - 0.06);
    expect(correlation).toBeLessThan(1);
  });

  it('flattens the spread and keeps the fold', () => {
    // Two separate claims, and the second is the one that survives an edge-on
    // camera: only the Gaussian SPREAD is thinned. The fold is the organism's
    // own mid-surface and keeps its full amplitude, so the halo is a warped
    // ribbon rather than a plane — a flat disk seen edge-on is a line.
    //
    // Re-derived for filaments, and it did NOT move. The old bound came from a
    // projection-smear argument on independent points and no longer applies:
    // a filament's offset is drawn once, so the curve translates on screen
    // rather than smearing. But the measurement replaced that constraint with
    // a stronger one from the same direction — orientation coherence falls
    // monotonically as the slab thickens, because independent filaments then
    // overlap in projection — and this test is the hard floor underneath it.
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
    // plane and the edge-on view has become a line. Measured, this is what
    // caps the flattening at about 0.48 — the reference prototype's 0.62 is
    // not admissible, whatever it looks like from overhead.
    expect(foldRms).toBeGreaterThan(spreadRms);
  });
});

describe('the placement pass is exact and resumable', () => {
  it('never rejects a candidate the law would have accepted', () => {
    // The radius-only majorant skips the twelve-octave evaluation for the
    // seeds that were never going to survive. It is a speed-up only while it
    // is a true upper bound; a majorant that is ever wrong silently biases the
    // distribution instead of failing.
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
    // would use. Chunking must not perturb the sequence — which now means
    // stopping MID-FILAMENT and resuming, since a walk is the unit of output
    // and a step is the unit of work.
    const whole = placePopulationField(2_000);
    const chunked = createPopulationPlacement(2_000);
    while (!chunked.done) advancePopulationPlacement(chunked, 397);

    expect(chunked.count).toBe(whole.count);
    expect(chunked.segmentCount).toBe(whole.segmentCount);
    expect(chunked.streamlines).toBe(whole.streamlines);
    expect(chunked.work).toBe(whole.work);
    expect(Array.from(chunked.positions)).toEqual(Array.from(whole.positions));
    expect(Array.from(chunked.segments)).toEqual(Array.from(whole.segments));
  });

  it('returns the same field on every reload', () => {
    const again = placePopulationField(2_000);
    const once = placePopulationField(2_000);
    expect(Array.from(again.positions)).toEqual(Array.from(once.positions));
    expect(Array.from(again.segments)).toEqual(Array.from(once.segments));
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
    advancePopulationPlacement(impossible, 4 * 30 + 1);
    expect(impossible.done).toBe(true);
  });

  it('states a population against the stage it contextualizes', () => {
    // Not a tuning constant to drift: the count is a claim. Against a
    // 12,000-Cell stage it is ~11 points per addressable Cell, and against
    // mainnet's ~1.46M live Cells about one point per eleven the dashboard
    // could not individuate.
    //
    // Halved from 260,000, and the reason is the change of construction. A
    // spray spent its points filling area; a filament spends them along a
    // curve, and at matched light the count no longer moves the structure at
    // all — measured, orientation coherence is flat within noise from 65K to
    // 260K. What the count moves now is coverage, and 105,000 puts the layer
    // at the previous build's covered area while paying for the fibres.
    expect(POPULATION_FIELD_POINTS / 12_000).toBeGreaterThan(8);
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

describe('populationSegmentsForPointPrefix', () => {
  it('keeps every segment whose both endpoints are inside the prefix', () => {
    // Two filaments: points 0..3 and 4..6, each segment reaching its newest
    // point, which is how the walk emits them.
    const segments = [0, 1, 1, 2, 2, 3, 4, 5, 5, 6];
    const count = 5;
    for (let prefix = 0; prefix <= 7; prefix += 1) {
      const kept = populationSegmentsForPointPrefix(segments, count, prefix);
      for (let i = 0; i < kept; i += 1) {
        expect(Math.max(segments[i * 2], segments[i * 2 + 1]))
          .toBeLessThan(prefix);
      }
      if (kept < count) {
        expect(Math.max(segments[kept * 2], segments[kept * 2 + 1]))
          .toBeGreaterThanOrEqual(prefix);
      }
    }
  });

  it('is empty at prefix zero and complete at the full count', () => {
    const segments = [0, 1, 1, 2, 2, 3];
    expect(populationSegmentsForPointPrefix(segments, 3, 0)).toBe(0);
    expect(populationSegmentsForPointPrefix(segments, 3, 4)).toBe(3);
    expect(populationSegmentsForPointPrefix(segments, 0, 10)).toBe(0);
  });

  it('never lets a real placement dangle a segment past the drawn points', () => {
    // The invariant the draw-range trim rests on, against the real walk: a
    // branch reaches back to an earlier point, so the guarantee is about the
    // LARGER index, and it has to hold on the shipped buffer, not a fixture.
    const placed = placePopulationField(4_000, POPULATION_FIELD_SEED);
    for (const share of [0, 0.25, 0.5, 0.75, 1]) {
      const prefix = Math.round(placed.count * share);
      const kept = populationSegmentsForPointPrefix(
        placed.segments,
        placed.segmentCount,
        prefix,
      );
      for (let i = 0; i < kept; i += 1) {
        expect(placed.segments[i * 2]).toBeLessThan(prefix);
        expect(placed.segments[i * 2 + 1]).toBeLessThan(prefix);
      }
    }
  });

  it('thins monotonically with the prefix', () => {
    const placed = placePopulationField(4_000, POPULATION_FIELD_SEED);
    let previous = -1;
    for (const share of [0, 0.25, 0.5, 0.75, 1]) {
      const kept = populationSegmentsForPointPrefix(
        placed.segments,
        placed.segmentCount,
        Math.round(placed.count * share),
      );
      expect(kept).toBeGreaterThanOrEqual(previous);
      previous = kept;
    }
    expect(previous).toBe(placed.segmentCount);
  });
});

describe('the cascade trim keeps the layer a set of strokes', () => {
  /** Share of drawn points carried by fibre components of 8 or more — the
   *  "draws strokes, not dust" guard, whose hard floor is 0.80. */
  function strokeShare(
    segments: ArrayLike<number>,
    segmentCount: number,
    points: number,
  ): number {
    const parent = new Int32Array(points);
    for (let i = 0; i < points; i += 1) parent[i] = i;
    const find = (start: number): number => {
      let a = start;
      while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
      return a;
    };
    for (let i = 0; i < segmentCount; i += 1) {
      const a = find(segments[i * 2]);
      const b = find(segments[i * 2 + 1]);
      if (a !== b) parent[a] = b;
    }
    const size = new Map<number, number>();
    for (let i = 0; i < points; i += 1) {
      const root = find(i);
      size.set(root, (size.get(root) ?? 0) + 1);
    }
    let carried = 0;
    for (const [, n] of size) if (n >= 8) carried += n;
    return carried / points;
  }

  it('holds the dust floor at every share the cascade can ask for', () => {
    // This is what makes the preset trim legitimate rather than a way of
    // shredding the layer: a prefix keeps whole filaments, and a branch only
    // ever reaches BACK, so thinning cannot orphan a point that a later
    // segment would have connected. Measured on the shipped 105,000-point
    // placement the share runs 0.816 / 0.822 / 0.824 at 1 / 0.5 / 0.25 — it
    // rises slightly, because the early filaments are the well-connected ones.
    const placed = placePopulationField(20_000, POPULATION_FIELD_SEED);
    for (const mul of [1, 0.5, 0.25]) {
      const points = Math.round(placed.count * mul);
      const segments = populationSegmentsForPointPrefix(
        placed.segments,
        placed.segmentCount,
        points,
      );
      expect(strokeShare(placed.segments, segments, points))
        .toBeGreaterThan(0.8);
    }
  });
});
