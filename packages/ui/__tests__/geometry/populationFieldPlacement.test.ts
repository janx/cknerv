import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  advancePopulationPlacement,
  createPopulationPlacement,
  resetPopulationSegmentOverflowWarning,
  inverseStandardNormal,
  placePopulationField,
  populationComplementAcceptance,
  populationComplementAccepts,
  populationComplementVariate,
  populationFibreAt,
  populationPlacementMajorant,
  POPULATION_COMPLEMENT_CORRELATION_STEPS,
  POPULATION_END_TAPER,
  POPULATION_FIELD_COVERAGE_CEILING,
  POPULATION_FIELD_FLATTEN,
  POPULATION_FIELD_OUTER_EDGE,
  POPULATION_FIELD_POINTS,
  POPULATION_FIELD_SEED,
  POPULATION_JOIN_CHANCE_MIXED,
  POPULATION_JOIN_CHANCE_OPEN,
  POPULATION_JOIN_PER_FILAMENT,
  POPULATION_JOIN_REACH,
  POPULATION_JOIN_REACH_MIN,
  POPULATION_JOIN_SPAN,
  populationJoinChance,
  POPULATION_STREAMLINE_JITTER,
  POPULATION_STREAMLINE_BRANCH_SHARE,
  POPULATION_STREAMLINE_BRANCH_SHARE_OPEN,
  POPULATION_STREAMLINE_MAX_GENERATION,
  POPULATION_STREAMLINE_MAX_STEPS,
  POPULATION_STREAMLINE_MIN_STEPS,
  POPULATION_STREAMLINE_REACH_DENSITY,
  POPULATION_STREAMLINE_REACH_FLOOR,
  POPULATION_STREAMLINE_STEP,
  POPULATION_TAPER_COVERAGE_LIFT,
  POPULATION_TAPER_DENSITY_FULL,
  populationBranchRecordChance,
  populationBranchShare,
  populationPointWeight,
  populationSegmentsForPointPrefix,
  populationStreamlineSpan,
  populationTissueReach,
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
  COLONY_ELLIPSE_X,
  COLONY_ELLIPSE_Z,
  COLONY_RADIUS,
} from '../../src/derives/networkTopology.derive';
import {
  populationFibreTaper,
  populationPointSizeForWeight,
  POPULATION_FIELD_POINT_SIZE_MAX,
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

/** A segment's length in the GROUND PLANE — the one number that tells the
 *  walk's three moves apart in the buffer, with nothing recorded alongside
 *  them. A walk step and a fork's first segment are both exactly one
 *  integration step; a join's reach window starts above one step, which is
 *  why its floor is where it is. */
function inPlaneSpan(segment: number): number {
  const a = placed.segments[segment * 2];
  const b = placed.segments[segment * 2 + 1];
  const dx = placed.positions[a * 3] - placed.positions[b * 3];
  const dz = placed.positions[a * 3 + 2] - placed.positions[b * 3 + 2];
  return Math.sqrt(dx * dx + dz * dz);
}

function isJoin(segment: number): boolean {
  return inPlaneSpan(segment) > POPULATION_STREAMLINE_STEP + 1e-4;
}

/** Degree over the WALK's own moves only — steps and forks, not joins. The
 *  fork ladder is a claim about branching and has to stay measurable now that
 *  a second kind of junction shares the buffer. */
function walkDegrees(): Int32Array {
  const degree = new Int32Array(placed.count);
  for (let i = 0; i < placed.segmentCount; i += 1) {
    if (isJoin(i)) continue;
    degree[placed.segments[i * 2]] += 1;
    degree[placed.segments[i * 2 + 1]] += 1;
  }
  return degree;
}

/** Rendered light of one Gaussian sprite: peak alpha over its footprint, so
 *  `peak * (sigma * size)^2`. The house model — the same one that set the
 *  size range — extended with each layer's own Gaussian width, which is what
 *  a comparison ACROSS the two layers needs. */
function spriteFlux(size: number, sigma: number, peak: number): number {
  const s = sigma * size;
  return peak * s * s;
}

/** Bin width of the radial grid, in absolute elliptical radius.
 *
 *  ⚠️ FIXED, and never `POPULATION_FIELD_OUTER_EDGE / bins`. It used to be the
 *  latter, and that made every reading below a function of the constant they
 *  are the acceptance test FOR: changing the edge reshuffled the grid, so two
 *  edges could not be compared and a regression could hide inside a rebinning.
 *  An instrument cannot evaluate its own subject. */
const PROFILE_BIN = 0.05;
/** Out past any edge this layer will take, so the grid never truncates. */
const PROFILE_BINS = 52;

/** The radial luminance profile, in perceptual lightness, binned by elliptical
 *  radius on a FIXED grid. This is the measurement §5.2's brightness rule is
 *  derived from, and it is here so the derivation stays checkable rather than
 *  remembered. */
function radialProfile(): {
  cells: number[]; halo: number[]; lightness: number[]; haloDensity: number[];
} {
  const CELL_SIGMA = 0.10;   // cellHybridMaterial's Gaussian width
  const CELL_PEAK = 1.18;    // what a Cell body emits at its core
  const EMISSION = 0.72;     // populationEmissionForGain at mainnet chain scope
  const cells = new Array(PROFILE_BINS).fill(0);
  const halo = new Array(PROFILE_BINS).fill(0);
  const binOf = (x: number, z: number) => {
    const r = Math.hypot(x / FIELD_HALF_X, z / FIELD_HALF_Z);
    const b = Math.floor(r / PROFILE_BIN);
    return b >= 0 && b < PROFILE_BINS ? b : -1;
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
  const shellArea = (b: number) => {
    const r1 = b * PROFILE_BIN;
    const r2 = (b + 1) * PROFILE_BIN;
    return Math.PI * FIELD_HALF_X * FIELD_HALF_Z * (r2 * r2 - r1 * r1);
  };
  const lightness = cells.map((c, b) =>
    Math.cbrt((c + halo[b]) / shellArea(b)));   // OKLab-style perceptual
  const haloDensity = halo.map((h, b) => h / shellArea(b));
  return { cells, halo, lightness, haloDensity };
}

describe('the radial luminance profile the brightness rule is solved from', () => {
  const profile = radialProfile();
  const at = (r: number) => Math.min(PROFILE_BINS - 1, Math.floor(r / PROFILE_BIN));
  /** Last bin the halo actually reaches, so "the outer field" is named by the
   *  placement rather than by a radius pinned to one era's edge. */
  const outermost = (() => {
    let last = at(TISSUE_ENVELOPE_EDGE) + 2;
    for (let b = last; b < PROFILE_BINS; b += 1) if (profile.halo[b] > 0) last = b;
    return last;
  })();

  it('has no step where the addressable Cells stop', () => {
    // §5.2 said the Cells "stop dead at radius 1.04" and that a brightness
    // taper deepens that step. Measured, there is no step to deepen: the
    // profile crosses the rim flatter than it moves anywhere in the outer
    // field. The rule that used to taper brightness outward was answering a
    // feature that is not in the frame.
    //
    // The margin narrows as the edge closes, because the outer field then has
    // less room to fall through, and this is the number that says how much:
    // the rim step against the typical outer step runs 0.16 at edge 2.2 and
    // 0.39 at 1.6 (0.0134 against 0.0346 on the shipped 105,000-point
    // placement). Still no knee — but the outer boundary is 2.1x harder, and
    // that is the price the containment answer was bought with.
    const rim = at(TISSUE_ENVELOPE_EDGE);
    const acrossRim = Math.abs(profile.lightness[rim + 1] - profile.lightness[rim]);
    const outerSteps: number[] = [];
    for (let b = rim + 2; b < outermost; b += 1) {
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
    // (0.70 at radius 0.60, 0.07 at 0.95, 1.9% at the rim).
    expect(share(0.60)).toBeGreaterThan(0.5);
    expect(share(0.95)).toBeLessThan(0.20);
    expect(share(TISSUE_ENVELOPE_EDGE)).toBeLessThan(0.06);
  });

  it('brightens across the band where the Cells hand over', () => {
    // §5.2's requirement, and it is met by the halo's own density rather than
    // by a per-point brightness rule — which is why brightness could be freed
    // to be flat.
    //
    // ⚠️ The band is named by the HANDOVER, not by the resolved rim. It used
    // to assert that the halo was still climbing at 1.04, which was true at
    // edge 2.2 by where the peak happened to sit and is not a requirement:
    // measured on the shipped placement the Cells' share of light is 0.70 at
    // radius 0.60 and 0.07 by 0.95, so the handover is over well before the
    // rim, and at edge 1.6 the halo's density peaks at 0.95 with the Cells
    // already gone. What §5.2 asks is that the halo rise THROUGH the thinning
    // and only then fall away, and that is what is asserted.
    const density = (r: number) => profile.haloDensity[at(r)];
    const cellShare = (r: number) => {
      const b = at(r);
      return profile.cells[b] / (profile.cells[b] + profile.halo[b]);
    };
    expect(cellShare(0.70)).toBeGreaterThan(cellShare(0.95));
    expect(density(0.80)).toBeGreaterThan(density(0.70));
    expect(density(0.95)).toBeGreaterThan(density(0.80));
    // And past the handover it falls, rather than ending on a cliff: the last
    // shell carrying halo light is dimmer than the peak, monotonically.
    expect(density(0.95)).toBeGreaterThan(profile.haloDensity[outermost]);
  });
});

describe('the galaxy sits inside the network that delivers to it', () => {
  it('sweeps a smaller footprint than the colony', () => {
    // Live review, 2026-08-19: "the cells galaxy should be somewhat smaller
    // than the peer network". This is asserted as a PROPERTY and never as an
    // edge value, because the failure it guards is exactly an edge constant
    // drifting out past the network while every other test stays green.
    //
    // ⚠️ `COLONY_RADIUS` alone is NOT the colony's extent — `COLONY_ELLIPSE_X`
    // and `COLONY_ELLIPSE_Z` carry it to 115 x 78 world units. Comparing the
    // halo's 132 against a bare 92 is what the first pass at this did, and it
    // is wrong on both sides of the comparison.
    //
    // The galaxy group turns on Y, so its silhouette over a full rotation is a
    // DISC of its own outer radius, whatever shape it holds at any instant.
    // The colony does not turn. So the honest comparison is that disc against
    // the colony's ellipse, by area.
    const radii: number[] = [];
    for (let i = 0; i < placed.count; i += 1) {
      radii.push(Math.hypot(placed.positions[i * 3], placed.positions[i * 3 + 2]));
    }
    radii.sort((a, b) => a - b);
    // The 99th percentile, not the maximum: a rotating body's silhouette is
    // what the eye reads as its edge, and the last hundredth of a filamentary
    // layer is a scatter of specks that never draws one.
    const swept = radii[Math.floor(0.99 * radii.length)];
    const colonyFootprint = COLONY_RADIUS * COLONY_ELLIPSE_X
      * COLONY_RADIUS * COLONY_ELLIPSE_Z;
    // Measured on the shipped 105,000-point placement: 0.862 at edge 1.6,
    // against 1.55 at the 2.2 live review rejected.
    //
    // ⚠️ 0.845 of that is the edge; the boundary warp following its own radius
    // (`boundaryWarpGain`) and the seeding box widening to cover it carry the
    // rest. A torn edge reaches further in places than a smooth one at the
    // same nominal radius, so raggedness spends containment — which is why
    // the warp is scaled to the radius and not to the envelope's span, a
    // derivation that measured 0.896 here and left nothing.
    expect((swept * swept) / colonyFootprint).toBeLessThan(0.90);
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
    // rather than statistical: every segment the WALK writes spans exactly ONE
    // integration step in the ground plane. A point the complement rejected
    // costs the walk a step, so a bridge across one would have to span at
    // least two — and with the measured turn rate a two-step displacement is
    // never shorter than 1.78 steps. A fibre therefore cannot cross tissue the
    // complement just cleared, at any tuning of the knee.
    //
    // ⚠️ A JOIN is the one segment that is not a step, so it gets the same
    // question asked directly rather than by construction: both of its ends
    // are points the complement accepted, and the ground between them is at
    // most 1.875 wu wide. Measured, the worst `resolvedCoverage` at a join's
    // midpoint is 0.458 here and 0.559 on the shipped 105,000 (p50 0.126, p90
    // 0.304) — under the ceiling, which is the invariant stated as a property
    // of the buffer rather than of the pixels.
    //
    // The taxonomy is asserted as well as used: the segments longer than one
    // step are EXACTLY the joins the pass counted, so a reader of this buffer
    // can tell the three moves apart with no side channel.
    let worstStep = 0;
    let shortestStep = Infinity;
    let joins = 0;
    let worstJoinPlane = 0;
    let shortestJoinPlane = Infinity;
    let worstJoinDrawn = 0;
    let worstJoinCoverage = 0;
    for (let i = 0; i < placed.segmentCount; i += 1) {
      const span = inPlaneSpan(i);
      if (!isJoin(i)) {
        if (span > worstStep) worstStep = span;
        if (span < shortestStep) shortestStep = span;
        continue;
      }
      joins += 1;
      const a = placed.segments[i * 2];
      const b = placed.segments[i * 2 + 1];
      const dy = placed.positions[a * 3 + 1] - placed.positions[b * 3 + 1];
      const drawn = Math.sqrt(span * span + dy * dy);
      if (span > worstJoinPlane) worstJoinPlane = span;
      if (span < shortestJoinPlane) shortestJoinPlane = span;
      if (drawn > worstJoinDrawn) worstJoinDrawn = drawn;
      const coverage = tissueSampleAt(
        (placed.positions[a * 3] + placed.positions[b * 3]) / 2,
        (placed.positions[a * 3 + 2] + placed.positions[b * 3 + 2]) / 2,
        POPULATION_FIELD_OUTER_EDGE,
      ).resolvedCoverage;
      if (coverage > worstJoinCoverage) worstJoinCoverage = coverage;
    }
    expect(worstStep).toBeLessThanOrEqual(POPULATION_STREAMLINE_STEP + 1e-4);
    expect(shortestStep).toBeGreaterThan(POPULATION_STREAMLINE_STEP - 1e-4);

    expect(joins).toBe(placed.joins);
    expect(joins).toBeGreaterThan(0);
    expect(shortestJoinPlane).toBeGreaterThan(
      POPULATION_JOIN_REACH_MIN * POPULATION_STREAMLINE_STEP - 1e-4,
    );
    expect(worstJoinPlane).toBeLessThanOrEqual(
      POPULATION_JOIN_REACH * POPULATION_STREAMLINE_STEP + 1e-4,
    );
    expect(worstJoinDrawn).toBeLessThanOrEqual(
      POPULATION_JOIN_SPAN * POPULATION_STREAMLINE_STEP + 1e-4,
    );
    expect(worstJoinCoverage).toBeLessThan(POPULATION_FIELD_COVERAGE_CEILING);
  });

  it('never closes a segment onto itself', () => {
    for (let i = 0; i < placed.segmentCount; i += 1) {
      expect(placed.segments[i * 2]).not.toBe(placed.segments[i * 2 + 1]);
    }
  });

  it('draws strokes, not dust', () => {
    // The count of components is the wrong statistic and it misled a whole
    // round: a third of components are one or two points, but they hold a
    // small share of the light. Weight by POINTS, which is what the eye sees.
    //
    // ⚠️ THIS FLOOR WAS WEAKENED TO 0.65 AND IS BACK AT 0.80. Both moves were
    // the complement, and the sequence is worth keeping because the first one
    // read as a property of the edge when it was really a property of the
    // draw.
    //
    // Closing `POPULATION_FIELD_OUTER_EDGE` to 1.6 does not slide the layer
    // inward as a whole — the envelope's inner shoulder is fixed at 0.61 in
    // `helix.ts` — it moves the layer's mass ONTO the Cells, so the share of
    // points inside the resolved rim went 0.27 -> 0.49. Acceptance was
    // independent per candidate, so on ground the Cells half-occupy it dropped
    // every other one and broke the filament at each: correct per point,
    // ruinous per stroke. This share followed the mass in, and 0.65 was
    // recorded as "this edge's floor".
    //
    // `POPULATION_COMPLEMENT_CORRELATION_STEPS` then fixed the JOINT law while
    // leaving the marginal exactly alone, and the whole column came back up:
    //
    //   edge         2.2    1.7    1.6    1.5    1.3
    //   i.i.d.       0.816  0.697  0.701  0.662  0.526   (105,000 points)
    //   correlated   0.870  0.832  0.809  0.791  0.717
    //
    // So the floor is the original 0.80 again, and it is a real gate rather
    // than a record: measured **0.811** on the shipped placement and 0.813 on
    // this file's 20,000, which is between one and two points of headroom.
    //
    // ⚠️ Those two were 0.809 / 0.814 before the tissue-keyed length and fork
    // ramps, and holding them THROUGH a 44% cut to the fringe's p90 run is
    // what that phase had to buy. It did not buy it with the length law: a
    // span floor of zero takes this to 0.763, because the guard's unit is
    // EIGHT points and POPULATION_STREAMLINE_MIN_STEPS is 6, so a law that
    // pushes fringe filaments onto MIN makes dust by construction (the length
    // ramp on its own lands at 0.772). It bought it with the fork SUPPLY — see
    // populationBranchRecordChance.
    //
    // ⚠️⚠️ **The identity this used to end on is gone, and it is worth being
    // precise about which half survived.** It read "the drawn graph is a
    // forest, so `components = points - segments`, and a floor on component
    // size is a ceiling on component count". A join closes onto a strand
    // already placed, so the general form is now
    //
    //   components = points - segments + cycles
    //
    // measured at 27 closed cycles in this file's 242 joins and 99 in the
    // shipped 1,670. The floor-is-a-ceiling reading still holds — a join can
    // only merge components or close one — and the guard now measures
    // **0.844** on the shipped placement and 0.840 here, four points of
    // headroom where there were one or two, because the joins spend themselves
    // exactly where the complement fragments the layer.
    const size = componentSizes();
    let inStrokes = 0;
    for (let i = 0; i < placed.count; i += 1) {
      if (size.of[i] >= 8) inStrokes += 1;
    }
    expect(inStrokes / placed.count).toBeGreaterThan(0.80);
  });

  it('frays into the Cells rather than everywhere', () => {
    // Where the fragmentation happens is the whole question. A filament that
    // breaks up as it enters the resolved tissue is the interdigitation this
    // design exists to produce; one that breaks up in open halo would be a
    // defect.
    //
    // ⚠️ The margin here NARROWED by design when the complement's decisions
    // were correlated, and the two numbers that moved say exactly what the
    // change did. Singletons: 1,156 points at a mean coverage of 0.315,
    // against 374 at 0.261 — most of the dust is simply gone. Points inside
    // components of 16 or more: mean coverage 0.0095 -> 0.0289, because a
    // strand that draws one accept now carries THROUGH the half-occupied
    // ground instead of beading across it. The ratio of the two is 33.3 ->
    // 9.0, and the claim it guards is unchanged: what breaks up still breaks
    // up in the Cells and not in open halo.
    //
    // Re-measured after the tissue-keyed ramps, on this file's 20,000: 352
    // singletons at 0.270 against 0.0284 inside components of 16 or more,
    // ratio 9.5. The ramps shorten the FRINGE, where coverage is zero and the
    // complement never fires, so they leave this comparison where it was —
    // which is the check that they shortened the right band.
    //
    // ⚠️ The joins narrow it again, and in the direction that says they
    // landed where they were aimed: 332 singletons at 0.269 against 0.0349
    // inside components of 16 or more, ratio 7.7 (9.7 with the rate at zero).
    // Both terms moved for the same reason — a join attaches a fragment in the
    // transition band to a stroke, so the survivors are the loneliest specks
    // and the big components now reach further into the Cells.
    //
    // ⚠️⚠️ It cannot be tightened back. Strokes reaching into the transition
    // band IS the mixed register the halo is being asked to speak.
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
    //
    // ⚠️ Joins are SKIPPED rather than counted. A join is a cross-link, not a
    // step of any walk, and leaving it in the chain would split the curve it
    // lands on in two — the run p50 of the pre-rim band reads 3.75 instead of
    // 5.00 that way, which is an artefact of the instrument and not a stroke
    // that got shorter. Skipping keeps this measurement the same one the
    // length ramps were tuned against.
    const runs: number[] = [];
    let run = 0;
    let previousEnd = -2;
    for (let i = 0; i < placed.segmentCount; i += 1) {
      if (isJoin(i)) continue;
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
    //
    // ⚠️ Re-derived three times since. At edge 1.6 the drawn runs are shorter
    // than that era's — p50 6.25 wu, p90 18.75, so 2.85x and 4.63x — and then
    // correlating the complement lengthened them again to 7.50 / 21.25 wu,
    // **3.42x and 5.25x**. That direction is not incidental: the breaks the
    // i.i.d. draw scattered through the mixed band were CUTTING runs, so
    // healing the strand-shredding bug spends part of its gain on exactly the
    // length regression recorded here.
    //
    // Then the length span became a function of the tissue each filament was
    // born on (POPULATION_STREAMLINE_REACH_DENSITY), and the p90 came back:
    // 21.25 -> **17.50 wu, 5.25x -> 4.32x**, with p50 pinned at 7.50 (3.42x)
    // because the dotted-line reading owns it. The bound below is TIGHTENED to
    // match rather than left where it was. The max is unmoved at 31.25 (1.16x)
    // and cannot follow: the key is read at the SEED, so a corridor filament
    // keeps its full 26 steps wherever it walks. What did move is the fringe's
    // own maximum, 31.25 -> 28.75, and its p90, 22.50 -> 12.50 — the ladder is
    // per band and is asserted as such below.
    expect(at(0.5)).toBeLessThan(FABRIC_EDGE_P50 * 4.4);
    expect(at(0.9)).toBeLessThan(FABRIC_EDGE_P90 * 5.0);

    // And the spread SURVIVES. A uniform draw between two bounds is what made
    // an earlier pass read as felt — every filament the same size, no
    // hierarchy, no reading order — so shortening the tail must not flatten
    // the distribution onto one length. Measured 2.83 before the tissue-keyed
    // span and **2.33** after: narrower, because that is what shortening a
    // tail does, and nowhere near the uniform draw.
    expect(at(0.9) / at(0.5)).toBeGreaterThan(2);
  });

  it('forks, so the tissue branches instead of combing', () => {
    // Measured 2.83% of placed points before the tissue-keyed fork ramps and
    // **3.98%** after, on this file's 20,000 — and the rise is where the runs
    // shortened: per band it goes 2.08 -> 2.68 / 3.42 -> 3.98 / 2.99 -> 5.43 /
    // 3.08 -> 4.72 across pre-rim / mixed / outer / fringe. Terminal tissue
    // arborises; where a run cannot be long it has to be bushy instead.
    //
    // ⚠️ Counted on the WALK's own moves, which is not the same as counting
    // junctions any more: a join raises a point's degree without branching
    // anything. Fork points hold at 4.06% here (3.94% with the join rate at
    // zero) while junctions of every kind run 5.55% — the plexus is measured
    // by its own test below, and this one stays a statement about branching.
    const degree = walkDegrees();
    let forks = 0;
    for (let i = 0; i < placed.count; i += 1) if (degree[i] > 2) forks += 1;
    expect(forks).toBeGreaterThan(placed.count * 0.005);
  });
});

/** Elliptical radius of a placed point, on the law's own axes. */
function radiusOf(index: number): number {
  const { x, z } = pointAt(index);
  return Math.hypot(x / FIELD_HALF_X, z / FIELD_HALF_Z);
}

/** The four bands the tier design names, by elliptical radius: the resolved
 *  interior, the mixed band the 次级神经 live in, and the outer field split in
 *  two. Fixed boundaries, never derived from `POPULATION_FIELD_OUTER_EDGE` —
 *  an instrument may not be a function of the thing it measures. */
const LADDER_BANDS: ReadonlyArray<readonly [string, number, number]> = [
  ['pre-rim', 0, 0.95],
  ['mixed', 0.95, 1.15],
  ['outer', 1.15, 1.375],
  ['fringe', 1.375, Infinity],
];

/** Drawn runs in world units, per band. A run is binned by the MEAN radius of
 *  its points and not by where it starts: a 26-step filament crosses a third
 *  of the field's half-width, so "where this stroke is" is not the same
 *  question as "where it was seeded".
 *
 *  Joins are skipped, for the reason given where the layer-wide version of
 *  this measurement is taken: a cross-link is not a step of any walk. */
function runsByBand(): number[][] {
  const perBand: number[][] = LADDER_BANDS.map(() => []);
  let run = 0;
  let radiusSum = 0;
  let previousEnd = -2;
  const flush = () => {
    if (run <= 0) return;
    const mean = radiusSum / (run + 1);
    let band = LADDER_BANDS.length - 1;
    for (let b = 0; b < LADDER_BANDS.length; b += 1) {
      if (mean >= LADDER_BANDS[b][1] && mean < LADDER_BANDS[b][2]) band = b;
    }
    perBand[band].push(run * POPULATION_STREAMLINE_STEP);
  };
  for (let i = 0; i < placed.segmentCount; i += 1) {
    if (isJoin(i)) continue;
    const a = placed.segments[i * 2];
    const b = placed.segments[i * 2 + 1];
    if (a === previousEnd) {
      run += 1;
      radiusSum += radiusOf(b);
    } else {
      flush();
      run = 1;
      radiusSum = radiusOf(a) + radiusOf(b);
    }
    previousEnd = b;
  }
  flush();
  for (const band of perBand) band.sort((x, y) => x - y);
  return perBand;
}

describe('the tissue decides how far a filament runs, and how often it forks', () => {
  const quantile = (sorted: number[], q: number) =>
    sorted[Math.floor(q * (sorted.length - 1))];

  it('reads one key, and reads it as a ramp on the halo\'s own density', () => {
    // ONE key for three laws — length, fork share, fork supply — so the layer
    // cannot be tuned into disagreeing with itself about where its terminal
    // tissue is.
    expect(populationTissueReach(0)).toBe(0);
    expect(populationTissueReach(POPULATION_STREAMLINE_REACH_DENSITY)).toBe(1);
    expect(populationTissueReach(9)).toBe(1);
    expect(populationTissueReach(0.2))
      .toBeGreaterThan(populationTissueReach(0.1));
    // And it saturates BELOW the taper's own "as dense as the layer ever
    // draws". They are different questions: the taper asks how much light a
    // mark carries, this asks how much tissue a filament has to run through.
    // Keyed at 0.6 the corridors would shorten too, which is the naive global
    // shortening the dust floor already rejected.
    expect(POPULATION_STREAMLINE_REACH_DENSITY)
      .toBeLessThan(POPULATION_TAPER_DENSITY_FULL);
  });

  it('scales the span and never the floor, so the draw keeps its shape', () => {
    const span = POPULATION_STREAMLINE_MAX_STEPS
      - POPULATION_STREAMLINE_MIN_STEPS;
    expect(populationStreamlineSpan(POPULATION_STREAMLINE_REACH_DENSITY))
      .toBeCloseTo(span, 12);
    expect(populationStreamlineSpan(0))
      .toBeCloseTo(span * POPULATION_STREAMLINE_REACH_FLOOR, 12);
    expect(populationStreamlineSpan(0.2))
      .toBeLessThan(populationStreamlineSpan(0.35));

    // ⭐ THE structural guard, and the arithmetic is the whole reason the
    // floor is not zero. "Draws strokes, not dust" counts components of EIGHT
    // points, and MIN_STEPS is 6 — below it. Out in the fringe the complement
    // accepts nearly everything, so a filament's step count IS its component's
    // point count. A span that collapsed to zero would put every fringe
    // filament under the guard however the ceiling was tuned: measured, a span
    // floor of 0 takes the layer-wide stroke share from 0.809 to 0.763.
    expect(POPULATION_STREAMLINE_REACH_FLOOR).toBeGreaterThan(0);
    expect(POPULATION_STREAMLINE_MIN_STEPS).toBeLessThan(8);
  });

  it('forks more exactly where it runs less, on both halves of the probability', () => {
    // The seed-time share, keyed inversely.
    expect(populationBranchShare(0))
      .toBeCloseTo(POPULATION_STREAMLINE_BRANCH_SHARE_OPEN, 12);
    expect(populationBranchShare(POPULATION_STREAMLINE_REACH_DENSITY))
      .toBeCloseTo(POPULATION_STREAMLINE_BRANCH_SHARE, 12);
    expect(POPULATION_STREAMLINE_BRANCH_SHARE_OPEN)
      .toBeGreaterThan(POPULATION_STREAMLINE_BRANCH_SHARE);

    // ⚠️ And the supply, which is the half that actually carries the rate.
    // A fork needs a live reservoir slot; slots are minted per emitted point.
    // Measured on the shipped placement, 4,643 slots are minted and 4,061
    // consumed — 87% of the whole supply — so driving the share above from
    // 0.42 to 1.0 with nothing else changed moves the fork count 4,061 ->
    // 4,352 and the layer's fork-point share not at all. Both halves have to
    // ride the key or "forks rise where runs shorten" is a comment.
    expect(populationBranchRecordChance(0))
      .toBeGreaterThan(populationBranchRecordChance(
        POPULATION_STREAMLINE_REACH_DENSITY,
      ));
    expect(populationBranchRecordChance(9))
      .toBe(populationBranchRecordChance(
        POPULATION_STREAMLINE_REACH_DENSITY,
      ));
  });

  it('runs its ladder downhill outward, which it did not used to', () => {
    // ⭐ THE gate this phase exists for. G2: "the fringe reads as combed hair,
    // not a terminal network" — and G3 recorded the length rung as INVERTED,
    // the longest strokes in the frame sitting furthest out. Measured before
    // the tissue-keyed span, p90 of the drawn runs ran 13.75 / 25.00 / **26.25**
    // / 22.50 wu across pre-rim / mixed / outer / fringe: the outer band was
    // the longest thing in the picture. After: 12.50 / 20.00 / 18.75 / 12.50.
    //
    // Asserted as an ORDERING and not as values, because the values are a
    // sample-size statistic and the ordering is the anatomy: trunks inside,
    // fine short endings outside.
    const runs = runsByBand();
    const [, mixed, outer, fringe] = runs;
    expect(mixed.length).toBeGreaterThan(100);
    expect(outer.length).toBeGreaterThan(100);
    expect(fringe.length).toBeGreaterThan(50);

    const p90 = (band: number[]) => quantile(band, 0.9);
    expect(p90(mixed)).toBeGreaterThanOrEqual(p90(outer));
    expect(p90(outer)).toBeGreaterThan(p90(fringe));
    // And the fringe is not merely last, it is markedly shorter — the "twiggy"
    // half of the requirement. Measured 12.50 against the mixed band's 20.00.
    expect(p90(fringe)).toBeLessThan(p90(mixed) * 0.7);
    // p95 rather than the maximum, deliberately: the maximum is an extreme of
    // a few thousand runs and moves with the sample, while the ladder is a
    // distributional claim. Measured 22.50 / 22.50 / 13.75 here and 23.75 /
    // 22.50 / 15.00 on the shipped 105,000.
    const p95 = (band: number[]) => quantile(band, 0.95);
    expect(p95(fringe)).toBeLessThan(p95(mixed) * 0.75);

    // ⚠️ The two inner MAXIMA do not move and are not asserted. The key is
    // read once, at the seed, so a corridor filament draws its full span and
    // then walks 32 world units — it can be born in the mixed band and have
    // its mean radius land in the outer one. Only a fringe-BORN filament is
    // short, so only the fringe's own maximum falls (31.25 -> 28.75 on the
    // shipped placement). Capping the rest would mean re-reading the tissue
    // mid-walk, which clips filaments at a density contour and puts back the
    // hard outer edge POPULATION_STREAMLINE_DENSITY_FLOOR was lowered to
    // remove.
  });

  it('puts its extra branch points in the bands whose runs it cut', () => {
    // The other half of the same claim, measured on the drawn graph rather
    // than on the constants: fork points per 100 placed points, by band, went
    // 2.08 / 3.42 / 2.99 / 3.08 before the ramps to 2.68 / 3.98 / 5.43 / 4.72
    // after. The outer and fringe bands roughly doubled; the pre-rim, whose
    // runs the complement was already cutting, barely moved.
    //
    // ⚠️ Re-measured on the WALK's own degree once joins shared the buffer:
    // 2.78 / 4.14 / 5.41 / 4.48 here and 2.66 / 4.25 / 5.48 / 5.16 on the
    // shipped 105,000. Counting every junction instead would read 5.77 / 5.28 /
    // 5.92 / 4.69 and would say the OPPOSITE about branching, because the join
    // rate is keyed on the complement and the fork rate on the tissue — two
    // different ladders that happen to share a degree count.
    const degree = walkDegrees();
    const forks = new Array(LADDER_BANDS.length).fill(0);
    const points = new Array(LADDER_BANDS.length).fill(0);
    for (let i = 0; i < placed.count; i += 1) {
      const radius = radiusOf(i);
      let band = LADDER_BANDS.length - 1;
      for (let b = 0; b < LADDER_BANDS.length; b += 1) {
        if (radius >= LADDER_BANDS[b][1] && radius < LADDER_BANDS[b][2]) band = b;
      }
      points[band] += 1;
      if (degree[i] > 2) forks[band] += 1;
    }
    const rate = (band: number) => forks[band] / points[band];
    expect(rate(2)).toBeGreaterThan(rate(0) * 1.5);
    expect(rate(3)).toBeGreaterThan(rate(0) * 1.5);
  });
});

/** The complement's own coordinate: how much of the ground under a point is
 *  still unresolved. The bands the register transition is actually named by —
 *  see the note in `populationJoinChance` for why they are not the elliptical
 *  ones. */
function keepAt(index: number): number {
  const { x, z } = pointAt(index);
  return populationComplementAcceptance(
    tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE).resolvedCoverage,
  );
}

const KEEP_BANDS: ReadonlyArray<readonly [string, number, number]> = [
  ['cell ground', -1, 0.15],
  ['transition', 0.15, 0.85],
  ['rim-adjacent', 0.85, 0.999],
  ['open', 0.999, 2],
];

function keepBandOf(index: number): number {
  const keep = keepAt(index);
  for (let b = 0; b < KEEP_BANDS.length; b += 1) {
    if (keep >= KEEP_BANDS[b][1] && keep < KEEP_BANDS[b][2]) return b;
  }
  return KEEP_BANDS.length - 1;
}

describe('a walk closes onto strands it passes, so the layer stops being a forest', () => {
  it('rates the closure on the complement\'s own keep, and on nothing else', () => {
    // Zero where the addressable Cells own the ground — they are already
    // telling that story and this layer places almost nothing there — a floor
    // that survives across the whole open fringe, and a peak in between.
    expect(populationJoinChance(POPULATION_FIELD_COVERAGE_CEILING)).toBe(0);
    expect(populationJoinChance(0)).toBeCloseTo(POPULATION_JOIN_CHANCE_OPEN, 12);
    expect(POPULATION_JOIN_CHANCE_OPEN).toBeGreaterThan(0);
    expect(POPULATION_JOIN_CHANCE_MIXED)
      .toBeGreaterThan(POPULATION_JOIN_CHANCE_OPEN);

    // The peak is INSIDE the transition, not at its edges. Measured 5.4% at
    // keep 0.67, which is `resolvedCoverage` 0.20 — inside the 0.09–0.51 band
    // the correlated complement is derived against.
    let peak = 0;
    let peakAt = 0;
    for (let i = 0; i <= 600; i += 1) {
      const coverage = POPULATION_FIELD_COVERAGE_CEILING * i / 600;
      const rate = populationJoinChance(coverage);
      if (rate > peak) {
        peak = rate;
        peakAt = coverage;
      }
    }
    expect(peakAt).toBeGreaterThan(0.09);
    expect(peakAt).toBeLessThan(0.51);
    expect(peak).toBeGreaterThan(populationJoinChance(0) * 4);
  });

  it('closes where the two registers actually mix', () => {
    // ⭐ THE ladder this phase is gated on, read in the coordinate the rate
    // rides. Joins per 100 points, by how much of the ground is still
    // unresolved: **1.14 / 5.92 / 2.83 / 0.58** here and 1.17 / 7.57 / 3.69 /
    // 0.80 on the shipped 105,000, across cell ground / transition /
    // rim-adjacent / open.
    //
    // ⚠️ Deliberately NOT the elliptical bands. Measured, the annulus the
    // ladder instrument calls "mixed" (0.95–1.15) carries a keep of 1.000 at
    // the median — the Cells' coverage is spent well inside it — so the
    // register transition lives in the band the instrument calls pre-rim, and
    // a rate keyed on coverage cannot peak anywhere else. See
    // `populationJoinChance`.
    const points = new Array(KEEP_BANDS.length).fill(0);
    const joinEnds = new Array(KEEP_BANDS.length).fill(0);
    const junctions = new Array(KEEP_BANDS.length).fill(0);
    const joinIncident = new Int32Array(placed.count);
    for (let i = 0; i < placed.segmentCount; i += 1) {
      if (!isJoin(i)) continue;
      joinIncident[placed.segments[i * 2]] += 1;
      joinIncident[placed.segments[i * 2 + 1]] += 1;
    }
    const degree = new Int32Array(placed.count);
    for (let i = 0; i < placed.segmentCount * 2; i += 1) {
      degree[placed.segments[i]] += 1;
    }
    for (let i = 0; i < placed.count; i += 1) {
      const band = keepBandOf(i);
      points[band] += 1;
      if (joinIncident[i] > 0) joinEnds[band] += 1;
      if (degree[i] > 2) junctions[band] += 1;
    }
    const rate = (band: number) => joinEnds[band] / points[band];
    expect(points[1]).toBeGreaterThan(placed.count * 0.15);
    expect(rate(1)).toBeGreaterThan(rate(2) * 1.5);
    expect(rate(2)).toBeGreaterThan(rate(3) * 2);
    expect(rate(3)).toBeGreaterThan(0);

    // And what it does to the junction ladder as a whole. Before the joins
    // that ladder climbed monotonically OUTWARD in this coordinate — 1.59 in
    // the transition against 5.03 in the open, a ratio of 0.32 — because the
    // fork supply is keyed on tissue density and mints more of it in thin
    // ground. The transition has caught up: 5.46 against 5.36 here (1.02x)
    // and 6.95 against 5.73 on the shipped placement (1.21x), where the peak
    // is outright. Asserted as the catch-up, because at 20,000 points the
    // rim-adjacent band's 6.35 is within the sample's own spread of both.
    const density = (band: number) => junctions[band] / points[band];
    expect(density(1)).toBeGreaterThan(density(3) * 0.9);
  });

  it('merges components and closes cells, and the identity says which', () => {
    // ⚠️⚠️ The forest identity is DEAD and this is its replacement. Every
    // segment the walk or a fork writes reaches a point placed for the first
    // time, so neither can close a circuit and `components = points -
    // segments` held exactly at every tuning. A join reaches a point already
    // placed, so it either MERGES two components or CLOSES a cycle inside one,
    // and the general form is
    //
    //   components = points - segments + cycles
    //
    // which is asserted here rather than assumed, because three separate
    // arguments in the module still lean on the forest half of it.
    //
    // Measured here: 242 joins, 215 merges, 27 closed cells. On the shipped
    // 105,000: 1,670 joins, 1,571 merges, 99 closed cells. A plexus at this
    // budget is mostly a merging move; the closed cells are 6% of it.
    const parent = new Int32Array(placed.count);
    for (let i = 0; i < placed.count; i += 1) parent[i] = i;
    const find = (start: number): number => {
      let a = start;
      while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
      return a;
    };
    let cycles = 0;
    let merges = 0;
    for (let i = 0; i < placed.segmentCount; i += 1) {
      const a = find(placed.segments[i * 2]);
      const b = find(placed.segments[i * 2 + 1]);
      if (a === b) cycles += 1;
      else {
        parent[a] = b;
        if (isJoin(i)) merges += 1;
      }
    }
    const roots = new Set<number>();
    for (let i = 0; i < placed.count; i += 1) roots.add(find(i));

    expect(cycles).toBeGreaterThan(0);
    expect(merges + cycles).toBe(placed.joins);
    expect(roots.size).toBe(placed.count - placed.segmentCount + cycles);
    // A join is overwhelmingly a merge, which is what makes it a plexus rather
    // than a decoration on strands that were already connected.
    expect(merges).toBeGreaterThan(placed.joins * 0.7);
  });

  it('leaves the layer measurably more connected than a forest of it', () => {
    // The "basically connected" number, and the honest version of it. The
    // largest component is a percolation statistic and swings with the draw
    // (0.4%–2.2% across grid depths on the shipped placement, because the
    // layer sits just under its threshold), so what is asserted is the share
    // of points carried by components of 64 or more — the same question with a
    // stable answer.
    //
    // Measured, with the join rate at zero against as shipped: **0.061 ->
    // 0.190** here and 0.090 -> 0.265 on the shipped 105,000. Components of
    // 128 or more went 0.000 -> 0.085 and 0.001 -> 0.138. The largest
    // component itself went 108 -> 266 points here, 129 -> 1,722 there.
    const size = componentSizes();
    let carried = 0;
    let largest = 0;
    for (let i = 0; i < placed.count; i += 1) {
      if (size.of[i] >= 64) carried += 1;
    }
    for (const n of size.sizes) if (n > largest) largest = n;
    expect(carried / placed.count).toBeGreaterThan(0.12);
    // And it is still nothing like one tangle: the generation cap and the
    // per-filament join cap between them keep the biggest piece small.
    expect(largest / placed.count).toBeLessThan(0.2);
  });

  it('never lets a junction become a hub', () => {
    // "A halo point must never look like a node with edges radiating from it."
    // The degree ceiling is STRUCTURAL, not statistical: two walk steps, at
    // most one fork child (a point is offered to the branch reservoir once),
    // at most one join reaching out (one attempt per emitted point) and at
    // most one reaching in (the grid entry is consumed on use). Five, and it
    // is reached by two points in 105,000 — the histogram runs
    // 1,818 / 19,832 / 76,812 / 6,392 / 144 / 2 over degrees 0 to 5.
    const degree = new Int32Array(placed.count);
    const joinIncident = new Int32Array(placed.count);
    const seen = new Set<string>();
    for (let i = 0; i < placed.segmentCount; i += 1) {
      const a = placed.segments[i * 2];
      const b = placed.segments[i * 2 + 1];
      degree[a] += 1;
      degree[b] += 1;
      if (isJoin(i)) {
        joinIncident[a] += 1;
        joinIncident[b] += 1;
        // A join always reaches BACKWARD, which is the whole of the prefix
        // contract: the newest point is the second endpoint.
        expect(a).toBeLessThan(b);
      }
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    let worst = 0;
    let worstJoins = 0;
    for (let i = 0; i < placed.count; i += 1) {
      if (degree[i] > worst) worst = degree[i];
      if (joinIncident[i] > worstJoins) worstJoins = joinIncident[i];
    }
    expect(worst).toBeLessThanOrEqual(5);
    expect(worstJoins).toBeLessThanOrEqual(2);
  });

  it('leaves every junction matte, which is the one absolute', () => {
    // ⭐ The rule with no exceptions: the join code path writes SEGMENTS and
    // nothing else. No endpoint emphasis of any kind at either end — not a
    // brighter weight, not a larger sprite, not a rescued taper.
    //
    // Asserted structurally rather than by inspection: every stored weight in
    // this buffer is the tissue's own answer times one of exactly four rungs
    // (see 'fades a strand's last points'), and that leaves no room for a
    // join-specific write anywhere. Here it is checked on the join ENDPOINTS
    // specifically, where such a write would live, and the distribution is
    // checked too — 99 / 73 / 58 of this file's 484 join ends sit on the
    // three FADE rungs (599 / 507 / 422 of 3,340 on the shipped placement), so
    // a join that lands on a strand's tip still ends as a tip.
    const rungs = new Map<number, number>();
    for (let i = 0; i < placed.segmentCount; i += 1) {
      if (!isJoin(i)) continue;
      for (const end of [placed.segments[i * 2], placed.segments[i * 2 + 1]]) {
        const { x, z } = pointAt(end);
        const sample = tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE);
        const ratio = placed.weights[end]
          / populationPointWeight(sample.density, sample.resolvedCoverage);
        let rung = -1;
        for (const value of [1, ...POPULATION_END_TAPER]) {
          if (Math.abs(ratio - value) < 1e-3) rung = value;
        }
        expect(rung).toBeGreaterThan(0);
        rungs.set(rung, (rungs.get(rung) ?? 0) + 1);
      }
    }
    for (const rung of POPULATION_END_TAPER) {
      expect(rungs.get(rung) ?? 0).toBeGreaterThan(0);
    }
  });

  it('cannot overrun a buffer sized at one segment per point', () => {
    // The joins are the only thing here that can spend more segments than
    // points, and the bound is arithmetic rather than a hope. A filament is at
    // most POPULATION_STREAMLINE_MAX_STEPS points long, so at least one point
    // in every 26 starts a strand and reaches back to nothing; the joins are
    // spent from that slack and the pass stops offering them at
    // `capacity / MAX_STEPS`. At 105,000 points the ceiling is 4,038 and the
    // rate lands at 1,670 — it guards, it does not bind.
    expect(placed.joins)
      .toBeLessThan(placed.capacity / POPULATION_STREAMLINE_MAX_STEPS);
    expect(placed.segmentCount).toBeLessThanOrEqual(placed.capacity);
    expect(placed.segments.length).toBeGreaterThanOrEqual(
      placed.segmentCount * 2,
    );
    expect(POPULATION_JOIN_PER_FILAMENT).toBeGreaterThanOrEqual(1);
  });
});

// The sizing above is an ARGUMENT resting on tuned constants — the join
// ceiling and the strand-length bound — and it miscounts a forked filament's
// reach segment. At the shipped constants there is ~8K of headroom, so nothing
// here ever fires; what these pin is the SHAPE of the failure if a retune
// spends it. A typed-array write past the end is dropped rather than thrown,
// so an unguarded writer would leave `segmentCount` counting segments that are
// not in the buffer and every consumer downstream reading indices that were
// never written.
describe('the segment writer refuses what the buffer cannot hold', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetPopulationSegmentOverflowWarning();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => { warn.mockRestore(); });

  it('places on past a full segment buffer instead of writing past its end', () => {
    const state = createPopulationPlacement(600, POPULATION_FIELD_SEED);
    // A buffer the sizing argument would never produce, which is the point:
    // this is the retune that spent the headroom, arrived at early.
    const pairs = 4;
    state.segments = new Uint32Array(pairs * 2);
    advancePopulationPlacement(state, 200_000);

    expect(state.segmentCount).toBe(pairs);
    // A refusal, not a stall: the walk kept placing points.
    expect(state.count).toBeGreaterThan(pairs);
    // And every index that IS in the buffer addresses a point that exists —
    // no half-written pair, no zero-filled tail counted as a segment.
    for (let i = 0; i < state.segmentCount * 2; i += 1) {
      expect(state.segments[i]).toBeGreaterThanOrEqual(0);
      expect(state.segments[i]).toBeLessThan(state.count);
    }
    // A refused join is not a join.
    expect(state.joins).toBeLessThanOrEqual(pairs);
  });

  it('says so once, not once per dropped segment', () => {
    const state = createPopulationPlacement(600, POPULATION_FIELD_SEED);
    state.segments = new Uint32Array(4);
    advancePopulationPlacement(state, 200_000);

    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0] as [string];
    expect(message).toContain('segment buffer is full');
    expect(message).toContain('createPopulationPlacement');

    // A second pass in the same session adds no further noise.
    const again = createPopulationPlacement(600, POPULATION_FIELD_SEED);
    again.segments = new Uint32Array(4);
    advancePopulationPlacement(again, 200_000);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('is silent at the shipped sizing — the guard changes no behaviour today', () => {
    const state = createPopulationPlacement(4_000, POPULATION_FIELD_SEED);
    advancePopulationPlacement(state, 4_000 * 64);

    expect(warn).not.toHaveBeenCalled();
    expect(state.segmentCount).toBeLessThanOrEqual(state.capacity);
    expect(state.segmentCount).toBeGreaterThan(0);
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

    // ⚠️ The multiple RIDES `POPULATION_FIELD_OUTER_EDGE`, because the null
    // is a uniform draw over the halo's own sampling box and that box shrinks
    // with the edge. What a rejection sampler on `density` can reach at all is
    // `E[d^2]/E[d]^2` over the box — 3.03 at edge 2.2 and 2.72 at 1.6, since
    // tightening the box removes exactly the empty corners the sampler was
    // rejecting. Measured: 2.23 of a possible 3.03 at 2.2, and 1.71 of 2.72
    // here. The law is unchanged; the headroom it had is smaller.
    expect(placedDensity).toBeGreaterThan(uniformDensity * 1.6);
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
    // ⭐ And the joins, which is the assertion that pins the newest state to
    // the walk: a filament's join budget and the candidate grid both have to
    // survive a call boundary, and a join drawn on one side of one would move
    // every segment after it.
    expect(chunked.joins).toBe(whole.joins);
    expect(whole.joins).toBeGreaterThan(0);
    expect(Array.from(chunked.positions)).toEqual(Array.from(whole.positions));
    expect(Array.from(chunked.segments)).toEqual(Array.from(whole.segments));
    // ⭐ The weights too, and they are the reason this assertion earns its
    // keep now rather than restating the two above. The end taper writes them
    // RETROACTIVELY — a strand's last three points are faded once the strand
    // is known to be over — so the ring of indices it holds has to live on the
    // walk state and survive a call boundary. Chunking is the only thing that
    // exercises that, and a ring held in a local would pass every other test
    // in this file.
    expect(Array.from(chunked.weights)).toEqual(Array.from(whole.weights));
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
    // placement the share runs 0.811 / 0.809 / 0.806 at 1 / 0.5 / 0.25, and
    // 0.813 / 0.813 / 0.810 on this file's 20,000.
    //
    // The subject here is the TRIM, not the edge: what this test owns is that
    // taking a prefix costs nothing, and that claim is scale-free. The
    // absolute level belongs to `POPULATION_FIELD_OUTER_EDGE` and is asserted
    // once, with its derivation, in 'draws strokes, not dust'.
    const placed = placePopulationField(20_000, POPULATION_FIELD_SEED);
    const shares = [1, 0.5, 0.25].map((mul) => {
      const points = Math.round(placed.count * mul);
      const segments = populationSegmentsForPointPrefix(
        placed.segments,
        placed.segmentCount,
        points,
      );
      return strokeShare(placed.segments, segments, points);
    });
    for (const share of shares) {
      // Never materially below the undrawn full buffer — a prefix may not
      // turn strokes into dust.
      expect(share).toBeGreaterThan(shares[0] - 0.03);
      expect(share).toBeGreaterThan(0.65);
    }
  });
});

describe('the inverse normal the correlated complement thresholds on', () => {
  it('lands on known quantiles', () => {
    // Reference values to 20 significant figures, from a 50-digit `erfc`.
    // Acklam's own bound is a relative error under 1.15e-9 and nothing here
    // refines it, because the caller does not want a quantile — it wants a
    // COMPARISON, and the only error that means anything is the one this
    // makes in the acceptance PROBABILITY. Swept against the same reference
    // over the whole double-precision range of `p`, that is 2.7e-10.
    const known: Array<[number, number]> = [
      [0.5, 0],
      [0.16, -0.99445788320975316774],
      [0.84, 0.99445788320975316774],
      [0.025, -1.9599639845400542355],
      [0.975, 1.9599639845400542355],
      [0.99, 2.3263478740408411009],
      [0.001, -3.0902323061678135415],
      [1e-6, -4.7534243088228989482],
      // Both region boundaries, where a piecewise rational approximation is at
      // its worst and where a transcription error in one branch would show up
      // as a step. The complement's `keep` walks straight across them.
      [0.02425, -1.9729610513118848503],
      [0.97575, 1.9729610513118848503],
    ];
    let worst = 0;
    for (const [p, want] of known) {
      worst = Math.max(worst, Math.abs(inverseStandardNormal(p) - want));
    }
    // Measured 5.0e-9 over this table, and 8.8e-9 swept at 1e-3 in the
    // quantile over |x| <= 6. Two decades of margin here, and still four
    // decades tighter than any error that could bend an acceptance rate.
    expect(worst).toBeLessThan(1e-7);
  });

  it('answers both endpoints, and never with a NaN', () => {
    // `keep` reaches 0 and 1 EXACTLY — zero on ground at twice the knee, one
    // across the whole open fringe — so the infinities are the two answers the
    // layer's own invariants are made of, and a NaN at either would silently
    // turn "never draw here" into "always".
    expect(inverseStandardNormal(0)).toBe(-Infinity);
    expect(inverseStandardNormal(1)).toBe(Infinity);
    expect(Number.isNaN(inverseStandardNormal(-0.1))).toBe(true);
    expect(Number.isNaN(inverseStandardNormal(1.1))).toBe(true);
    expect(Number.isNaN(inverseStandardNormal(Number.NaN))).toBe(true);
  });

  it('increases across both region boundaries', () => {
    // A rational approximation stitched from three branches can be smooth in
    // each and step at a seam. The step here would be of the order of the
    // approximation error, so this is checked on a grid coarse enough that the
    // true rise dwarfs it — and it spans 0.02425 and 0.97575 deliberately.
    let previous = -Infinity;
    for (let p = 0.001; p < 1; p += 0.001) {
      const value = inverseStandardNormal(p);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });
});

describe('the complement is correlated along a filament, and nowhere else', () => {
  /** mulberry32 through Box-Muller — the module's own pair, so the decision is
   *  driven here by the stream it is driven by in the walk. */
  function normals(seed: number): () => number {
    let state = seed >>> 0;
    const next = (): number => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
    };
    return () => Math.sqrt(-2 * Math.log(Math.max(next(), 1e-12)))
      * Math.cos(2 * Math.PI * next());
  }

  it('accepts at exactly the ramp\'s probability, in every coverage bin', () => {
    // ⭐ THE test for this construction, because the correlation is only free
    // while the marginal is untouched: the halo's density statement — "kept
    // with probability 1 - coverage / (2 * KNEE)" — is what the whole layer's
    // honesty rests on, and correlating the draws would be a way to move it
    // without anything else noticing.
    //
    // N per bin is 200,000, and the tolerance is derived rather than picked.
    // The binomial standard error at the worst bin (keep 0.5) is
    // sqrt(0.25/200000) = 1.1e-3, and the AR(1) inflates it: measured across
    // 40 independent chains, the spread is 3.0-3.5x the binomial one at every
    // bin, an effective sample of about N/11. So the worst-case standard error
    // is 3.9e-3 and 0.02 is five of them. Measured worst deviation across
    // these 21 bins: 5.9e-3 at keep 0.30, or 1.5 sigma.
    const N = 200_000;
    let worst = 0;
    for (let bin = 0; bin <= 20; bin += 1) {
      const coverage = POPULATION_FIELD_COVERAGE_CEILING * bin / 20;
      const keep = populationComplementAcceptance(coverage);
      const gaussian = normals(0x5eed + bin * 104_729);
      let variate = gaussian();
      let accepted = 0;
      for (let i = 0; i < N; i += 1) {
        variate = populationComplementVariate(variate, gaussian());
        if (populationComplementAccepts(variate, keep)) accepted += 1;
      }
      worst = Math.max(worst, Math.abs(accepted / N - keep));
    }
    expect(worst).toBeLessThan(0.02);
  });

  it('holds both ends of the ramp structurally, at any variate', () => {
    // The two the approximation is never asked about. `invPhi(0)` is -Infinity
    // and `invPhi(1)` is +Infinity, and the second is also the hot path: the
    // open fringe carries no resolved Cells at all, so most of the layer takes
    // this branch.
    for (const variate of [-40, -8, -1, 0, 1, 8, 40]) {
      expect(populationComplementAccepts(variate, 0)).toBe(false);
      expect(populationComplementAccepts(variate, 1)).toBe(true);
      expect(populationComplementAccepts(
        variate,
        populationComplementAcceptance(POPULATION_FIELD_COVERAGE_CEILING),
      )).toBe(false);
      expect(populationComplementAccepts(
        variate,
        populationComplementAcceptance(0),
      )).toBe(true);
    }
  });

  it('agrees with itself over a run, which is the whole point', () => {
    // The JOINT law, checked against its own closed form rather than against a
    // remembered number. For two standard normals correlated at rho and a
    // common threshold at the median, P(both below) is
    // 1/4 + arcsin(rho) / (2 pi), so P(accept | accept) at keep 0.5 is
    // 1/2 + arcsin(rho) / pi. An i.i.d. draw gives 0.5, which is exactly the
    // "every other point" that turned strands into beads.
    const rho = Math.exp(-1 / POPULATION_COMPLEMENT_CORRELATION_STEPS);
    const expected = 0.5 + Math.asin(rho) / Math.PI;
    expect(expected).toBeGreaterThan(0.8);

    const gaussian = normals(0xc0ffee);
    let variate = gaussian();
    let previous = populationComplementAccepts(variate, 0.5);
    let after = 0;
    let following = 0;
    for (let i = 0; i < 200_000; i += 1) {
      variate = populationComplementVariate(variate, gaussian());
      const current = populationComplementAccepts(variate, 0.5);
      if (previous) {
        after += 1;
        if (current) following += 1;
      }
      previous = current;
    }
    // Measured 0.8337 against the closed form's 0.8339, over four million
    // steps; 0.01 is loose enough for the 200,000 this test can afford.
    expect(following / after).toBeCloseTo(expected, 2);
  });

  it('carries strands through the band where the Cells half-occupy the tissue', () => {
    // ⭐ The reason the change exists, measured where the damage was. The
    // complement's keep-probability runs 0.15-0.85 over `resolvedCoverage`
    // 0.09-0.51, which is the transition between the addressable Cells and the
    // halo — a quarter of every point placed. An i.i.d. draw dropped every
    // other candidate there and broke the filament at each one, so the band
    // drew beads: the share of ITS points carried by fibre components of eight
    // or more was 0.203, against 0.697 for the layer as a whole.
    //
    // Measured correlated: 0.550 on the shipped 105,000-point placement, and
    // 0.550 on this file's 20,000 sample (0.542 / 0.560 before the
    // tissue-keyed ramps, which barely touch this band — the shortening is
    // keyed on `density` and this band is named by `resolvedCoverage`). The
    // floor sits well under both, because what is being asserted is that the
    // i.i.d. figure is far behind — not that a particular number came back.
    //
    // ⭐ The joins take it further, and this is the band they were aimed at:
    // **0.648** on the shipped placement and **0.623** here, against 0.540 /
    // 0.522 with the join rate at zero. The correlated complement could not
    // reach this on its own — what remains after it is filaments that stop at
    // a clump and filaments that start past it, and a join is the only move
    // that can attach those two to each other.
    const size = componentSizes();
    let inBand = 0;
    let carried = 0;
    for (let i = 0; i < placed.count; i += 1) {
      const { x, z } = pointAt(i);
      const coverage = tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE)
        .resolvedCoverage;
      if (coverage < 0.09 || coverage > 0.51) continue;
      inBand += 1;
      if (size.of[i] >= 8) carried += 1;
    }
    expect(inBand).toBeGreaterThan(placed.count * 0.15);
    expect(carried / inBand).toBeGreaterThan(0.45);
  });
});

describe('every strand ends as a fading tip', () => {
  /** The weight the tissue alone would have written at each placed point. The
   *  end taper is the ONLY thing that may separate the two, so the ratio is
   *  the whole instrument. */
  function taperRatios(): Float64Array {
    const ratios = new Float64Array(placed.count);
    for (let i = 0; i < placed.count; i += 1) {
      const { x, z } = pointAt(i);
      const sample = tissueSampleAt(x, z, POPULATION_FIELD_OUTER_EDGE);
      ratios[i] = placed.weights[i]
        / populationPointWeight(sample.density, sample.resolvedCoverage);
    }
    return ratios;
  }

  it('fades a strand\'s last points and leaves every other one alone', () => {
    // Structural rather than statistical: every stored weight is the tissue's
    // own answer times one of exactly four numbers.
    //
    // ⚠️ The tolerance is not float noise on the multiply — it is the position
    // round trip. `positions` is a Float32Array and the walk sampled the field
    // in doubles, so recomputing the weight from what was stored moves it by
    // up to 2.2e-5 where the field is steep (measured, over 105,000 points).
    // 1e-3 covers that with 45x to spare and is still 60x tighter than the
    // gap between two rungs.
    const ratios = taperRatios();
    const seen = new Map<number, number>();
    for (let i = 0; i < placed.count; i += 1) {
      let rung = -1;
      for (const value of [1, ...POPULATION_END_TAPER]) {
        if (Math.abs(ratios[i] - value) < 1e-3) rung = value;
      }
      expect(rung).toBeGreaterThan(0);
      seen.set(rung, (seen.get(rung) ?? 0) + 1);
    }
    // And all four are actually used. Measured on the shipped placement the
    // three fade rungs take **14.6% / 12.5% / 11.2%** of the buffer, so 38% of
    // the layer sits inside a fade and 62% does not. (13.1% / 11.1% / 9.8%
    // before the tissue-keyed ramps: a fade is three points however long the
    // strand is, so 15.9% more strands is 15.9% more fade.)
    for (const rung of POPULATION_END_TAPER) {
      expect(seen.get(rung) ?? 0).toBeGreaterThan(placed.count * 0.05);
    }
    expect(seen.get(1) ?? 0).toBeGreaterThan(placed.count * 0.5);
  });

  it('never fades one point twice', () => {
    // The failure mode this is here for: a complement break severs a strand
    // and the filament's own steps run out a moment later, so two ends arrive
    // at the same three points. A doubled fade would land on 0.0625, 0.125,
    // 0.1875, 0.375, 0.5625 — every one of them at least 0.06 from a legal
    // rung, which the assertion above already excludes. Stated separately
    // because it is the invariant, not a corollary.
    const ratios = taperRatios();
    for (const bad of [0.0625, 0.125, 0.1875, 0.375, 0.5625]) {
      for (let i = 0; i < placed.count; i += 1) {
        expect(Math.abs(ratios[i] - bad)).toBeGreaterThan(0.01);
      }
    }
  });

  it('leaves the tip lit', () => {
    // A zero-weight tip is not an invisible point — `populationPointSizeForWeight`
    // floors at POPULATION_FIELD_POINT_SIZE_MIN, so it would still draw a bead,
    // on a stroke faded to 0.433. That is a bead with a faint connector, which
    // is precisely what "no endpoint emphasis of any kind" forbids. The ramp
    // stops at a quarter for that reason and not out of caution.
    expect(POPULATION_END_TAPER[0]).toBeGreaterThan(0);
    let smallest = Infinity;
    for (let i = 0; i < placed.count; i += 1) {
      smallest = Math.min(smallest, placed.weights[i]);
    }
    expect(smallest).toBeGreaterThan(0);
    // The ramp rises to the strand's own weight, and does so monotonically.
    for (let i = 1; i < POPULATION_END_TAPER.length; i += 1) {
      expect(POPULATION_END_TAPER[i]).toBeGreaterThan(POPULATION_END_TAPER[i - 1]);
    }
    expect(POPULATION_END_TAPER[POPULATION_END_TAPER.length - 1])
      .toBeLessThan(1);
  });

  it('keeps the stroke-to-bead ratio invariant, which is what the rule asks', () => {
    // "No endpoint emphasis of any kind" is a constant RATIO and not a small
    // constant — see `populationFibreTaper`. The fade is applied to the weight
    // BOTH primitives read, so the stroke's alpha and the bead's footprint
    // move together and their ratio does not move at all. This is the guard on
    // the thing a future fibre-only end treatment would break.
    for (const rung of [1, ...POPULATION_END_TAPER]) {
      const weight = 0.8 * rung;
      const size = populationPointSizeForWeight(weight);
      expect(populationFibreTaper(weight)).toBeCloseTo(
        (size / POPULATION_FIELD_POINT_SIZE_MAX) ** 2,
        12,
      );
    }
  });
});
