import { describe, expect, it } from 'vitest';

import {
  POPULATION_BACKBONE_BAND_COUNT,
  POPULATION_BACKBONE_BAND_EDGES,
  POPULATION_BACKBONE_BAND_WEIGHTS,
  POPULATION_BACKBONE_BUDGET,
  POPULATION_BACKBONE_MAX_RUN,
  POPULATION_BACKBONE_MIN_RUN,
  populationBackboneBandOf,
  populationBackboneBandShares,
  selectPopulationBackbone,
  type PopulationBackboneInput,
  type PopulationBackbonePartition,
} from '../../src/geometry/populationBackbone';
import {
  placePopulationField,
  populationSegmentsForPointPrefix,
  POPULATION_FIELD_POINTS,
} from '../../src/geometry/populationFieldPlacement';
import {
  populationBackboneInstanceData,
} from '../../src/components/CellPopulationField';
import {
  populationFibreTaper,
  populationStrokeTaper,
  POPULATION_BACKBONE_WIDTH_PX,
  POPULATION_STROKE_TAPER_FLOOR,
} from '../../src/materials/populationFieldMaterial';
import { SCREEN_CAPSULE_TRIANGLES_PER_SEGMENT } from '../../src/geometry/screenSpaceCapsuleLine';
import { QUALITY_PRESETS } from '../../src/tweaks/qualityPresets';
import { BRIDGE_WIDTH_RATIO } from '../../src/nerve/bridgeStroke';
import { FIELD_HALF_X, FIELD_HALF_Z } from '../../src/helix';

/** The real placement, once. The walk is ~160 ms and every rule below is a
 *  statement about the shipped buffers rather than about a fixture. */
const PLACEMENT = placePopulationField();
const INPUT: PopulationBackboneInput = {
  positions: PLACEMENT.positions,
  segments: PLACEMENT.segments,
  count: PLACEMENT.count,
  segmentCount: PLACEMENT.segmentCount,
};
const PARTITION = selectPopulationBackbone(INPUT, POPULATION_BACKBONE_BUDGET);

function pairKey(segments: Uint32Array, index: number): string {
  return `${segments[index * 2]}:${segments[index * 2 + 1]}`;
}

function midpointRadius(a: number, b: number): number {
  const x = (PLACEMENT.positions[a * 3] + PLACEMENT.positions[b * 3]) * 0.5;
  const z = (PLACEMENT.positions[a * 3 + 2] + PLACEMENT.positions[b * 3 + 2])
    * 0.5;
  const nx = x / FIELD_HALF_X;
  const nz = z / FIELD_HALF_Z;
  return Math.sqrt(nx * nx + nz * nz);
}

/** Connected components of the drawn fibre graph, re-derived independently of
 *  the module under test. */
function componentRoots(): Int32Array {
  const parent = new Int32Array(PLACEMENT.count);
  for (let i = 0; i < PLACEMENT.count; i += 1) parent[i] = i;
  const find = (start: number): number => {
    let node = start;
    while (parent[node] !== node) node = parent[node];
    return node;
  };
  for (let s = 0; s < PLACEMENT.segmentCount; s += 1) {
    const rootA = find(PLACEMENT.segments[s * 2]);
    const rootB = find(PLACEMENT.segments[s * 2 + 1]);
    if (rootA !== rootB) parent[rootA] = rootB;
  }
  const roots = new Int32Array(PLACEMENT.count);
  for (let i = 0; i < PLACEMENT.count; i += 1) roots[i] = find(i);
  return roots;
}

describe('the backbone partition is exact', () => {
  it('accounts for every segment exactly once', () => {
    expect(PARTITION.backboneCount + PARTITION.residualCount)
      .toBe(PLACEMENT.segmentCount);

    const promoted = new Set<string>();
    for (let s = 0; s < PARTITION.backboneCount; s += 1) {
      promoted.add(pairKey(PARTITION.backbone, s));
    }
    const residual = new Set<string>();
    for (let s = 0; s < PARTITION.residualCount; s += 1) {
      residual.add(pairKey(PARTITION.residual, s));
    }
    // Intersection empty: nothing is drawn twice. That is the whole reason
    // this is a partition and not an overlay — a bounded screen accumulation
    // deposits an overlaid stroke twice, and the class would then read as
    // brighter rather than as wider.
    let both = 0;
    for (const key of promoted) if (residual.has(key)) both += 1;
    expect(both).toBe(0);

    // Union complete: nothing is dropped. A halo segment that appeared in
    // neither buffer would simply stop being drawn.
    let missing = 0;
    for (let s = 0; s < PLACEMENT.segmentCount; s += 1) {
      const key = pairKey(PLACEMENT.segments, s);
      if (!promoted.has(key) && !residual.has(key)) missing += 1;
    }
    expect(missing).toBe(0);
  });

  it('is deterministic in the buffers alone', () => {
    // The layer's whole premise is the same picture on every reload, in every
    // universe: the placement is pure in (count, seed) and the selection must
    // be pure in the placement.
    const again = selectPopulationBackbone(INPUT, POPULATION_BACKBONE_BUDGET);
    expect(again.backboneCount).toBe(PARTITION.backboneCount);
    expect(again.residualCount).toBe(PARTITION.residualCount);
    expect(again.components).toBe(PARTITION.components);
    expect(Array.from(again.backbone)).toEqual(Array.from(PARTITION.backbone));
    expect(Array.from(again.residual)).toEqual(Array.from(PARTITION.residual));
  });
});

describe('the backbone promotes whole strands', () => {
  it('never leaves a promoted component half drawn', () => {
    // The law: whole continuous runs, never scattered segments. A dashed
    // promotion — every third segment wide — is the bead failure in a new
    // costume, because a periodic width step along a strand is exactly the
    // endpoint emphasis the symbolic register forbids.
    const roots = componentRoots();
    const promotedRoots = new Set<number>();
    let split = 0;
    for (let s = 0; s < PARTITION.backboneCount; s += 1) {
      promotedRoots.add(roots[PARTITION.backbone[s * 2]]);
      // And both ends of a promoted segment are in the same component by
      // construction — they are joined by the segment itself.
      if (roots[PARTITION.backbone[s * 2 + 1]]
        !== roots[PARTITION.backbone[s * 2]]) split += 1;
    }
    expect(split).toBe(0);
    expect(promotedRoots.size).toBe(PARTITION.components);
    // No residual segment belongs to a promoted component. This is the
    // no-dashes assertion stated from the other side, and it also covers the
    // joins: a join is inside the component it closed, so it goes wide with
    // it rather than staying a thin link between two wide arms.
    let dashed = 0;
    for (let s = 0; s < PARTITION.residualCount; s += 1) {
      if (promotedRoots.has(roots[PARTITION.residual[s * 2]])) dashed += 1;
    }
    expect(dashed).toBe(0);
  });

  it('promotes strands rather than dust or regions', () => {
    const roots = componentRoots();
    const size = new Map<number, number>();
    for (let s = 0; s < PARTITION.backboneCount; s += 1) {
      const root = roots[PARTITION.backbone[s * 2]];
      size.set(root, (size.get(root) ?? 0) + 1);
    }
    expect(size.size).toBeGreaterThan(0);
    for (const run of size.values()) {
      expect(run).toBeGreaterThanOrEqual(POPULATION_BACKBONE_MIN_RUN);
      expect(run).toBeLessThanOrEqual(POPULATION_BACKBONE_MAX_RUN);
    }
    // ⭐ The ceiling is what buys breadth. Without it the same budget is spent
    // on ~99 percolated components at a mean run of 161 segments — a few
    // thick ropes with the rest of every band as bare as the complaint found
    // it. Recorded as a live comparison so the constant cannot be dropped as
    // arbitrary.
    const uncapped = new Map<number, number>();
    for (let s = 0; s < PLACEMENT.segmentCount; s += 1) {
      const root = roots[PLACEMENT.segments[s * 2]];
      uncapped.set(root, (uncapped.get(root) ?? 0) + 1);
    }
    const largest = Math.max(...uncapped.values());
    expect(largest).toBeGreaterThan(POPULATION_BACKBONE_MAX_RUN * 10);
    expect(PARTITION.components).toBeGreaterThan(300);
  });
});

describe('every band keeps a skeleton', () => {
  const SHARES = populationBackboneBandShares(INPUT, PARTITION);

  it('bins on the placement own radial coordinate', () => {
    expect(POPULATION_BACKBONE_BAND_COUNT)
      .toBe(POPULATION_BACKBONE_BAND_EDGES.length + 1);
    expect(POPULATION_BACKBONE_BAND_WEIGHTS)
      .toHaveLength(POPULATION_BACKBONE_BAND_COUNT);
    expect(populationBackboneBandOf(0)).toBe(0);
    expect(populationBackboneBandOf(0.949)).toBe(0);
    expect(populationBackboneBandOf(0.95)).toBe(1);
    expect(populationBackboneBandOf(1.6)).toBe(4);
    // Quotas rise outward, monotonically: the inner bands are crossing-rich
    // and already read from accumulation, the outer shells have almost no
    // crossings and the skeleton carries the read alone.
    for (let band = 1; band < POPULATION_BACKBONE_BAND_COUNT; band += 1) {
      expect(POPULATION_BACKBONE_BAND_WEIGHTS[band])
        .toBeGreaterThan(POPULATION_BACKBONE_BAND_WEIGHTS[band - 1]);
    }
  });

  it('gives the outer shells a rising share, and the recorded one', () => {
    // The requirement first: no band may be left without a skeleton, and the
    // share has to RISE outward — a backbone that stopped at the rim would
    // draw a seam there, which is the failure class `1c44c79` was spent on.
    const floors = [0.05, 0.12, 0.20, 0.25, 0.30];
    for (let band = 0; band < POPULATION_BACKBONE_BAND_COUNT; band += 1) {
      expect(SHARES[band].segments).toBeGreaterThan(0);
      expect(SHARES[band].share).toBeGreaterThanOrEqual(floors[band]);
      if (band > 0) {
        expect(SHARES[band].share).toBeGreaterThan(SHARES[band - 1].share);
      }
    }

    // And the table the constants are justified by, to half a percentage
    // point. A placement change moves these, and it should fail here loudly
    // rather than drift: the budget and the band weights were chosen against
    // exactly this row.
    //
    // ⚠️ Re-pinned 2026-08-20 from the 16,000 row to the 20,000 one. The
    // placement did NOT move — the sweep below re-derives every row of the
    // recorded table unchanged — the BUDGET did, on the verdict that the
    // terminal nerves are visible but not clear.
    //
    // | band | segments | promoted | share |
    // |---|---:|---:|---:|
    // | pre-rim < 0.95   | 30,120 | 3,343 | 11.1% |
    // | mixed 0.95–1.15  | 32,308 | 6,203 | 19.2% |
    // | outer 1.15–1.40  | 28,208 | 8,265 | 29.3% |
    // | outer 1.40–1.55  |  5,526 | 1,984 | 35.9% |
    // | fringe >= 1.55   |    447 |   195 | 43.6% |
    const recorded = [0.111, 0.192, 0.293, 0.359, 0.436];
    for (let band = 0; band < POPULATION_BACKBONE_BAND_COUNT; band += 1) {
      expect(SHARES[band].share).toBeCloseTo(recorded[band], 2);
    }
    expect(PARTITION.backboneCount / PLACEMENT.segmentCount)
      .toBeCloseTo(0.207, 2);
  });

  it('bins each segment exactly once', () => {
    let counted = 0;
    for (const band of SHARES) counted += band.segments;
    expect(counted).toBe(PLACEMENT.segmentCount);
    let promoted = 0;
    for (const band of SHARES) promoted += band.promoted;
    expect(promoted).toBe(PARTITION.backboneCount);
  });

  it('re-derives the budget sweep the choice was made on', () => {
    // | budget | pre-rim | mixed | 1.15–1.40 | 1.40–1.55 | fringe |
    // |---:|---:|---:|---:|---:|---:|
    // |  8,000 |  4.5% |  7.6% | 12.0% | 12.7% | 21.9% |
    // | 12,000 |  6.8% | 11.3% | 17.7% | 20.7% | 28.0% |
    // | 16,000 |  8.9% | 15.3% | 23.5% | 28.6% | 36.0% |
    // | 20,000 | 11.1% | 19.2% | 29.3% | 35.9% | 43.6% |
    // | 24,000 | 13.1% | 23.4% | 35.0% | 40.8% | 45.9% |
    const sweep: Record<number, number[]> = {
      8_000: [0.045, 0.076, 0.120, 0.127, 0.219],
      12_000: [0.068, 0.113, 0.177, 0.207, 0.280],
      16_000: [0.089, 0.153, 0.235, 0.286, 0.360],
      20_000: [0.111, 0.192, 0.293, 0.359, 0.436],
      24_000: [0.131, 0.234, 0.350, 0.408, 0.459],
    };
    for (const [budget, expected] of Object.entries(sweep)) {
      const partition = selectPopulationBackbone(INPUT, Number(budget));
      // The budget is a ceiling and the whole-run rule spends under it, never
      // over: a component is taken only if it fits.
      expect(partition.backboneCount).toBeLessThanOrEqual(Number(budget));
      const shares = populationBackboneBandShares(INPUT, partition);
      for (let band = 0; band < POPULATION_BACKBONE_BAND_COUNT; band += 1) {
        expect(shares[band].share).toBeCloseTo(expected[band], 2);
      }
    }
    // 16,000 was the SMALLEST of these at which the two outermost shells hold
    // a skeleton rather than a sample, and that claim still holds — it is what
    // rules 12,000 out.
    const smaller = populationBackboneBandShares(
      INPUT,
      selectPopulationBackbone(INPUT, 12_000),
    );
    expect(smaller[3].share).toBeLessThan(0.25);
    expect(smaller[4].share).toBeLessThan(0.30);

    // ⭐ 20,000 answers a LATER question — not "does every shell have a
    // skeleton" but "does it read as connected tissue" — so the bar it is
    // pinned to is different: both outer shells past a third of their
    // segments, which 16,000 misses on one of the two.
    const shipped = populationBackboneBandShares(INPUT, PARTITION);
    expect(shipped[3].share).toBeGreaterThan(0.33);
    expect(shipped[4].share).toBeGreaterThan(0.40);
    const previous = populationBackboneBandShares(
      INPUT,
      selectPopulationBackbone(INPUT, 16_000),
    );
    expect(previous[3].share).toBeLessThan(0.33);
    // And 24,000 is rejected on the same table: the fringe's own curve is
    // flattening (+7.6 points from 16K to 20K, +2.3 from 20K to 24K) while
    // the crossing-rich inner bands keep taking the whole cost.
    const larger = populationBackboneBandShares(
      INPUT,
      selectPopulationBackbone(INPUT, 24_000),
    );
    expect(larger[4].share - shipped[4].share)
      .toBeLessThan((shipped[4].share - previous[4].share) / 3);
    expect(larger[0].share - shipped[0].share)
      .toBeGreaterThan((shipped[0].share - previous[0].share) * 0.8);
  });
});

describe('both index sets stay prefix-trimmable', () => {
  /** Descents in the max-endpoint sequence — the property the binary search
   *  is exact under. Counted rather than asserted per segment: one failing
   *  expectation is the finding, 96,609 of them are a stack trace. */
  const descents = (segments: Uint32Array, count: number): number => {
    let previous = -1;
    let out = 0;
    for (let s = 0; s < count; s += 1) {
      const a = segments[s * 2];
      const b = segments[s * 2 + 1];
      const newest = a > b ? a : b;
      if (newest < previous) out += 1;
      previous = newest;
    }
    return out;
  };

  /** Drawn segments with an endpoint past the prefix — a dangling stroke. */
  const dangling = (
    segments: Uint32Array,
    drawn: number,
    points: number,
  ): number => {
    let out = 0;
    for (let s = 0; s < drawn; s += 1) {
      if (segments[s * 2] >= points || segments[s * 2 + 1] >= points) out += 1;
    }
    return out;
  };

  it('keeps the monotone max-endpoint the trim depends on', () => {
    // A subsequence of a monotone sequence is monotone. The buffers are
    // emitted in the source's own order for exactly this reason, and the
    // binary search in `populationSegmentsForPointPrefix` is only exact while
    // it holds.
    expect(descents(PLACEMENT.segments, PLACEMENT.segmentCount)).toBe(0);
    expect(descents(PARTITION.backbone, PARTITION.backboneCount)).toBe(0);
    expect(descents(PARTITION.residual, PARTITION.residualCount)).toBe(0);
  });

  it('trims both halves consistently at every quality preset', () => {
    const multipliers = new Set(
      Object.values(QUALITY_PRESETS).map((preset) => preset.populationCapMul),
    );
    expect(Array.from(multipliers).sort()).toEqual([0.25, 0.5, 1]);
    for (const mul of multipliers) {
      const points = Math.round(PLACEMENT.count * mul);
      const backbone = populationSegmentsForPointPrefix(
        PARTITION.backbone, PARTITION.backboneCount, points,
      );
      const residual = populationSegmentsForPointPrefix(
        PARTITION.residual, PARTITION.residualCount, points,
      );
      const whole = populationSegmentsForPointPrefix(
        PLACEMENT.segments, PLACEMENT.segmentCount, points,
      );
      // The two trims add up to the trim of the union — the partition is
      // exact at every preset, not only at `high`.
      expect(backbone + residual).toBe(whole);
      expect(backbone).toBeGreaterThan(0);

      // And no drawn segment dangles: BOTH endpoints of everything drawn are
      // inside the point prefix. This is the discipline the bridge anchors
      // follow, applied to the class that now has two index buffers to keep
      // it in.
      expect(dangling(PARTITION.backbone, backbone, points)).toBe(0);
      expect(dangling(PARTITION.residual, residual, points)).toBe(0);
      // Nothing eligible is left out either — the first trimmed-away segment
      // of each half really does reach past the prefix.
      if (backbone < PARTITION.backboneCount) {
        const a = PARTITION.backbone[backbone * 2];
        const b = PARTITION.backbone[backbone * 2 + 1];
        expect(Math.max(a, b)).toBeGreaterThanOrEqual(points);
      }
    }
  });

  it('degrades to an all-residual partition rather than throwing', () => {
    const empty = selectPopulationBackbone(INPUT, 0);
    expect(empty.backboneCount).toBe(0);
    expect(empty.residualCount).toBe(PLACEMENT.segmentCount);
    expect(empty.components).toBe(0);
  });
});

describe('the capsule carries the hairline own taper', () => {
  it('ends every capsule at populationStrokeTaper of the shared weight', () => {
    const snapshot = {
      positions: PLACEMENT.positions,
      segments: PLACEMENT.segments,
      backboneSegments: PARTITION.backbone,
      backboneSegmentCount: PARTITION.backboneCount,
      residualSegments: PARTITION.residual,
      residualSegmentCount: PARTITION.residualCount,
      backboneComponents: PARTITION.components,
      weights: PLACEMENT.weights,
      count: PLACEMENT.count,
      segmentCount: PLACEMENT.segmentCount,
      streamlines: PLACEMENT.streamlines,
      work: PLACEMENT.work,
    };
    const instances = populationBackboneInstanceData(snapshot);
    expect(instances.endpoints).toHaveLength(PARTITION.backboneCount * 6);
    expect(instances.taper).toHaveLength(PARTITION.backboneCount * 2);

    // The buffer carries the size RATIO and the shader squares it, because
    // mix() is linear and interpolating an already-squared taper would dim
    // the middle of every segment. So the taper AT AN END is the square of
    // what the buffer holds, and it must equal the hairlines' taper of the
    // same shared weight — same fade at a strand's tip, same fade in the
    // fringe. Wider, never brighter.
    //
    // ⭐ The law is `populationStrokeTaper` and no longer
    // `populationFibreTaper`: this class has no vertex stage of its own, so
    // POPULATION_STROKE_TAPER_FLOOR reaches it here, in the buffer, where the
    // hairline takes it in `max()` in GLSL. Asserting it against the SHARED
    // helper is what makes the two halves one law rather than two.
    let worstTaper = 0;
    let worstPosition = 0;
    let floored = 0;
    for (let s = 0; s < PARTITION.backboneCount; s += 1) {
      const a = PARTITION.backbone[s * 2];
      const b = PARTITION.backbone[s * 2 + 1];
      const start = instances.taper[s * 2];
      const end = instances.taper[s * 2 + 1];
      worstTaper = Math.max(
        worstTaper,
        Math.abs(start * start - populationStrokeTaper(PLACEMENT.weights[a])),
        Math.abs(end * end - populationStrokeTaper(PLACEMENT.weights[b])),
      );
      // ...and never under it, at either end, on any segment. The tolerance
      // is float32's and not slack: this buffer IS a Float32Array, so
      // `sqrt(0.75)` reaches the shader as 0.86602539 and squares to
      // 0.74999997. That is the number the GPU works with.
      expect(start * start).toBeGreaterThanOrEqual(
        POPULATION_STROKE_TAPER_FLOOR - 1e-6,
      );
      expect(end * end).toBeGreaterThanOrEqual(
        POPULATION_STROKE_TAPER_FLOOR - 1e-6,
      );
      if (populationFibreTaper(PLACEMENT.weights[a])
        < POPULATION_STROKE_TAPER_FLOOR) {
        floored += 1;
      }
      // Positions come from the SHARED buffer, unchanged — the capsule is the
      // same stroke the hairline was, at a different width.
      for (let k = 0; k < 3; k += 1) {
        worstPosition = Math.max(
          worstPosition,
          Math.abs(instances.endpoints[s * 6 + k]
            - PLACEMENT.positions[a * 3 + k]),
          Math.abs(instances.endpoints[s * 6 + 3 + k]
            - PLACEMENT.positions[b * 3 + k]),
        );
      }
    }
    expect(worstTaper).toBeLessThan(1e-6);
    expect(worstPosition).toBe(0);
    // The floor is doing work on this placement rather than sitting under it:
    // most promoted endpoints are thin-tissue, which is where the strands the
    // fringe verdict is about live.
    expect(floored).toBeGreaterThan(PARTITION.backboneCount * 0.5);
  });

  it('sits on the width ladder below the bridge', () => {
    // 4.6 pulse / 4.4 trunk / 2.5 mesh / 2.4 bridge / 1.8 halo backbone / 1
    // device px residual grain. The bridge is the mixed register's headline
    // and this rung stays under it.
    //
    // ⭐ Re-derived 2026-08-20, for the third time in a day and for the third
    // reason. 1.4 was the smallest step that could TEST the first verdict;
    // 1.6 answered it together with the hue change; 1.8 answers a milder and
    // later one — *visible now, but hard to see clearly* — as one third of a
    // move that also widened the budget and raised the level. These asserts
    // are re-derived at the new ladder, never relaxed.
    const bridgePx = 2.5 * BRIDGE_WIDTH_RATIO;
    expect(bridgePx).toBeCloseTo(2.4, 10);
    expect(POPULATION_BACKBONE_WIDTH_PX).toBe(1.8);
    expect(POPULATION_BACKBONE_WIDTH_PX).toBeLessThan(bridgePx);
    expect(bridgePx - POPULATION_BACKBONE_WIDTH_PX).toBeCloseTo(0.6, 10);
    // And above the residual hairline it partitions with, which is one DEVICE
    // pixel — half a CSS pixel at DPR 2, which is the whole mechanism.
    expect(POPULATION_BACKBONE_WIDTH_PX).toBeGreaterThan(1);
    // The mean stroke width the partition actually draws, in device px at
    // DPR 1, against the 1.10 the previous rung and budget gave: the class
    // buys 6% more stroke area, all of it in the strands carrying the read.
    const promoted = PARTITION.backboneCount / PLACEMENT.segmentCount;
    expect(promoted * POPULATION_BACKBONE_WIDTH_PX + (1 - promoted) * 1)
      .toBeCloseTo(1.166, 2);
  });
});

describe('the price is recorded in primitives and bytes', () => {
  it('prices the capsule pass against the point draw', () => {
    // The halo is primitive-bound, so primitives price this without a timer.
    const capsuleTriangles = PARTITION.backboneCount
      * SCREEN_CAPSULE_TRIANGLES_PER_SEGMENT;
    // A point sprite is one primitive the driver expands to a screen quad.
    const pointTriangles = POPULATION_FIELD_POINTS * 2;
    expect(capsuleTriangles).toBeCloseTo(40_000, -3);
    expect(capsuleTriangles / pointTriangles).toBeLessThan(0.20);
    // Partition, not overlay: the fibre pass gives up exactly what the
    // capsule pass takes.
    expect(PARTITION.residualCount)
      .toBe(PLACEMENT.segmentCount - PARTITION.backboneCount);
  });

  it('expands only the promoted subset of the positions', () => {
    const BYTES = 4;
    const sharedPositions = PLACEMENT.count * 3 * BYTES;
    const capsulePositions = PARTITION.backboneCount * 6 * BYTES;
    const capsuleTaper = PARTITION.backboneCount * 2 * BYTES;
    // 0.48 MB against the 1.26 MB a duplicate of the whole position buffer
    // would cost (0.384 MB at the 16,000 budget this was first pinned at).
    // `LineSegmentsGeometry` can only name consecutive vertex pairs, and the
    // halo's segments are not consecutive, so SOMETHING has to be written out
    // — the requirement is that it is only the subset, and the bound is a
    // share of the whole rather than a byte count so a budget move re-derives
    // it instead of silently passing.
    expect(capsulePositions / sharedPositions).toBeLessThan(0.40);
    // The taper rides a one-component slot of the vec3 colour attribute, so
    // it costs a third of what a full vertex-colour buffer would.
    expect(capsuleTaper).toBe(capsulePositions / 3);
    // And the partition itself costs exactly one more copy of the index
    // buffer, whatever the budget is.
    const indexBytes = (PARTITION.backboneCount + PARTITION.residualCount)
      * 2 * BYTES;
    expect(indexBytes).toBe(PLACEMENT.segmentCount * 2 * BYTES);
  });
});

describe('the selection stays out of the actual register', () => {
  it('reads positions and indices and nothing else', () => {
    // No id, no time, no universe seed, no chain state — the same partition on
    // every reload, in every universe, exactly as the placement is.
    const keys = Object.keys(INPUT satisfies PopulationBackboneInput).sort();
    expect(keys).toEqual(['count', 'positions', 'segmentCount', 'segments']);
    const partition: PopulationBackbonePartition = PARTITION;
    expect(partition.backbone).toBeInstanceOf(Uint32Array);
    expect(partition.residual).toBeInstanceOf(Uint32Array);
  });

  it('promotes nothing that reaches outside the placed points', () => {
    let outOfRange = 0;
    let degenerate = 0;
    for (let s = 0; s < PARTITION.backboneCount; s += 1) {
      const a = PARTITION.backbone[s * 2];
      const b = PARTITION.backbone[s * 2 + 1];
      if (a >= PLACEMENT.count || b >= PLACEMENT.count) outOfRange += 1;
      if (!(midpointRadius(a, b) > 0)) degenerate += 1;
    }
    expect(outOfRange).toBe(0);
    expect(degenerate).toBe(0);
  });
});
