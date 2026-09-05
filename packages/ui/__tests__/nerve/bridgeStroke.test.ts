import { describe, expect, it } from 'vitest';

import type { BridgeEdge } from '../../src/geometry/bridgeEdges';
import { FABRIC_SAMPLES_PER_EDGE } from '../../src/nerve/fabricCapacity';
import {
  DEATH_RETRACT_MS,
  GROWTH_MS,
  makeEdgeRenderScratch,
} from '../../src/nerve/fabricEdgeRender';
import {
  BRIDGE_FAR_END_ENERGY,
  BRIDGE_TIP_WIDTH_RATIO,
  BRIDGE_TIP_WIDTH_SCALE,
  BRIDGE_WIDTH_RATIO,
  bridgeRenderState,
  bridgeRenderStateInto,
  bridgeSymbolicDim,
  bridgeWidthScale,
  makeBridgeStrokeState,
  reconcileBridgeStrokes,
  writeBridgeStroke,
  type BridgeStrokeState,
} from '../../src/nerve/bridgeStroke';
import { bridgeTaper, TWIG_MIN } from '../../src/nerve/fabricLuminance';
import {
  POPULATION_BACKBONE_WIDTH_PX,
  POPULATION_STROKE_COLOR,
  populationFibreTaper,
} from '../../src/materials/populationFieldMaterial';
import { CELL_GALAXY_PALETTE } from '../../src/visualPalette';

const bridge = (over: Partial<BridgeEdge> = {}): BridgeEdge => ({
  cellId: 4242,
  fromX: 40, fromY: 1, fromZ: 20,
  anchorIndex: 991,
  anchorSegment: 700,
  toX: 43.5, toY: 0.4, toZ: 22.5,
  anchorWeight: 0.6,
  componentSize: 30,
  ...over,
});

/** The layer's own emit: living strokes into a fresh set of arrays. */
function draw(
  state = makeBridgeStrokeState(bridge(), 0),
  nowSec = 60,
  maxSegments = FABRIC_SAMPLES_PER_EDGE,
  centerDim = 0.3,
): {
  positions: Float32Array;
  colors: Float32Array;
  widths: Float32Array;
  written: number;
} {
  const positions = new Float32Array(maxSegments * 6);
  const colors = new Float32Array(maxSegments * 6);
  // Stride 2 against the stride-6 pair, and pre-filled with the sentinel the
  // layer allocates so an unwritten instance is visible as unwritten.
  const widths = new Float32Array(maxSegments * 2).fill(1);
  const written = writeBridgeStroke(
    positions,
    colors,
    widths,
    0,
    maxSegments,
    state,
    bridgeRenderState(state, nowSec),
    0.15,
    centerDim,
    new Float32Array(3),
  );
  return { positions, colors, widths, written };
}

const luma = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('bridgeTaper', () => {
  it('carries the knot at the actual end and nothing at the symbolic one', () => {
    expect(bridgeTaper(0, 0.2)).toBeCloseTo(1, 12);
    expect(bridgeTaper(1, 0.2)).toBeCloseTo(0.2, 12);
  });

  it('never rises — the far end may not look like a node', () => {
    for (const farEnd of [0.05, 0.147, 0.34, 0.9]) {
      let previous = Infinity;
      for (let step = 0; step <= 200; step += 1) {
        const value = bridgeTaper(step / 200, farEnd);
        expect(value).toBeLessThanOrEqual(previous + 1e-12);
        previous = value;
      }
    }
  });

  it('is the fabric parabola stretched over the whole stroke', () => {
    // fabricTaper's falling half is TAPER_MIN + (1 - TAPER_MIN)(1 - 2t)^2 on
    // [0, 0.5]; this is the same curve with 2t replaced by t.
    expect(bridgeTaper(0.5, 0.44)).toBeCloseTo(0.44 + 0.56 * 0.25, 12);
  });
});

describe('the width taper — the class signature a ladder could not give it', () => {
  const FABRIC_PX = 2.5;

  it('runs from the mesh rung down to the halo strand it merges into', () => {
    // ⚠️ Re-derived 2026-08-20 by live review, not by drift. The verdict was
    // that the three nerve classes do not read as different ENOUGH, and for
    // this one a wider rung was not available: above it sits the fabric mesh
    // at 2.5, fixed, and below it sits the width this stroke has to LAND at.
    expect(FABRIC_PX * BRIDGE_WIDTH_RATIO).toBeCloseTo(2.4, 10);
    expect(FABRIC_PX * BRIDGE_TIP_WIDTH_RATIO).toBeCloseTo(1.8, 10);
    // ⭐ The far end IS the halo backbone's rung, to the digit. A bridge ends
    // part-way along a promoted halo strand, so a width step at the merge
    // would be exactly the junction emphasis that layer's design forbids.
    expect(FABRIC_PX * BRIDGE_TIP_WIDTH_RATIO)
      .toBeCloseTo(POPULATION_BACKBONE_WIDTH_PX, 10);
    // And the knot stays under the mesh at every camera, since both ride the
    // same focus scale and the ratio is what is stored.
    expect(BRIDGE_WIDTH_RATIO).toBeLessThan(1);
    expect(BRIDGE_TIP_WIDTH_RATIO).toBeLessThan(BRIDGE_WIDTH_RATIO);
  });

  it('is a factor on the material width, so the live knob still moves it', () => {
    // `LineMaterial.linewidth` carries the knot; the instance lane says how
    // much of it each endpoint keeps. Stated as the ratio of the two ratios,
    // so moving either end moves the taper rather than desynchronising it.
    expect(BRIDGE_TIP_WIDTH_SCALE).toBeCloseTo(0.75, 10);
    expect(bridgeWidthScale(0)).toBe(1);
    expect(bridgeWidthScale(1)).toBeCloseTo(BRIDGE_TIP_WIDTH_SCALE, 12);
    for (const knob of [0.5, 2.5, 8]) {
      const knot = knob * BRIDGE_WIDTH_RATIO;
      expect(knot * bridgeWidthScale(1))
        .toBeCloseTo(knob * BRIDGE_TIP_WIDTH_RATIO, 10);
    }
  });

  it('falls monotonically and linearly, where the energy falls parabolically', () => {
    // Linear width against a parabolic energy is what makes the two channels
    // legible as two things: `bridgeTaper` puts most of its fall in the first
    // quarter, and a width that copied it would read as a blob with a
    // hairline off it.
    let previous = Infinity;
    for (let step = 0; step <= 20; step += 1) {
      const t = step / 20;
      const width = bridgeWidthScale(t);
      expect(width).toBeLessThanOrEqual(previous + 1e-12);
      expect(width).toBeGreaterThanOrEqual(BRIDGE_TIP_WIDTH_SCALE - 1e-12);
      previous = width;
    }
    // Linear: the midpoint is the mean of the ends, which the parabolic
    // energy is emphatically not.
    expect(bridgeWidthScale(0.5))
      .toBeCloseTo((1 + BRIDGE_TIP_WIDTH_SCALE) / 2, 12);
    const energyMid = bridgeTaper(0.5, 0.24);
    expect(energyMid).toBeLessThan((bridgeTaper(0, 0.24) + bridgeTaper(1, 0.24)) / 2);
    // Clamped outside [0, 1] rather than extrapolated — a retract writes
    // parameters inside the range, but nothing may widen past the knot.
    expect(bridgeWidthScale(-1)).toBe(1);
    expect(bridgeWidthScale(2)).toBeCloseTo(BRIDGE_TIP_WIDTH_SCALE, 12);
  });

  it('writes one width per endpoint, chained exactly as the colours are', () => {
    const { widths, written } = draw();
    expect(written).toBe(FABRIC_SAMPLES_PER_EDGE);
    // Endpoint-shared: each sub-segment starts where the previous ended, in
    // width as in position and colour. A discontinuity here would be a visible
    // step partway along a stroke.
    for (let seg = 1; seg < written; seg += 1) {
      expect(widths[seg * 2]).toBeCloseTo(widths[(seg - 1) * 2 + 1], 12);
    }
    expect(widths[0]).toBeCloseTo(bridgeWidthScale(0), 12);
    expect(widths[(written - 1) * 2 + 1])
      .toBeCloseTo(bridgeWidthScale(1), 12);
    // And it agrees with the curve parameter at every sample, which is what
    // keeps it in step with the energy and the hue.
    for (let seg = 0; seg < written; seg += 1) {
      const t = (seg + 1) / FABRIC_SAMPLES_PER_EDGE;
      expect(widths[seg * 2 + 1]).toBeCloseTo(bridgeWidthScale(t), 12);
    }
  });

  it('keys on the curve, not on the drawn extent, so a retract stays tapered', () => {
    // ⚠️ A retracting bridge is a tapered object being withdrawn into its
    // Cell, so its visible far end gets WIDER as it shortens. Keying on the
    // drawn extent instead would re-taper the stub every frame.
    const state = makeBridgeStrokeState(bridge(), 0);
    state.dyingAt = 60;
    const half = draw(state, 60 + DEATH_RETRACT_MS / 2000);
    expect(half.written).toBeGreaterThan(0);
    const lastEnd = half.widths[(half.written - 1) * 2 + 1];
    expect(lastEnd).toBeGreaterThan(bridgeWidthScale(1));
    expect(lastEnd).toBeLessThan(1);
    // The knot is still the knot: the end that stays on the Cell never moves.
    expect(half.widths[0]).toBeCloseTo(bridgeWidthScale(0), 12);
    // A growing stroke is the same law from the other side: a short fat stub
    // that extends and thins.
    const young = draw(makeBridgeStrokeState(bridge(), 0), GROWTH_MS / 2000);
    expect(young.widths[0]).toBeCloseTo(bridgeWidthScale(0), 12);
    expect(young.widths[(young.written - 1) * 2 + 1])
      .toBeGreaterThan(bridgeWidthScale(1));
  });

  it('is a signature and not a brightness raise', () => {
    // The geometric mean footprint against the flat 2.0 CSS px this class drew
    // before: 2.1 px, +5.0%. Measured over the real selection at the
    // production camera the same pair is 173,807 -> 182,497 device px².
    const meanWidth = FABRIC_PX * BRIDGE_WIDTH_RATIO
      * (bridgeWidthScale(0) + bridgeWidthScale(1)) / 2;
    expect(meanWidth).toBeCloseTo(2.1, 10);
    expect(meanWidth / 2.0).toBeCloseTo(1.05, 10);
    // And the light-weighted mean, which is the honest number because the wide
    // half is also the bright half: 2.18 px, +8.9%. Integrated over the same
    // curve the emit uses, at the middle of the measured `farEnd` range.
    const FAR = 0.24;
    const STEPS = 4_000;
    let lit = 0;
    let energy = 0;
    for (let i = 0; i < STEPS; i += 1) {
      const t = (i + 0.5) / STEPS;
      const e = bridgeTaper(t, FAR);
      lit += bridgeWidthScale(t) * e;
      energy += e;
    }
    const lightWeighted = FABRIC_PX * BRIDGE_WIDTH_RATIO * (lit / energy);
    expect(lightWeighted).toBeCloseTo(2.18, 2);
    expect(lightWeighted / 2.0).toBeLessThan(1.10);
    // ⚠️ Pinning the far end to the backbone's rung instead of solving for a
    // light-neutral mean is a CHOICE, and this is what it costs. With the tip
    // fixed at 1.8, a light-weighted mean of exactly 2.0 wants a knot of 2.12
    // — a 1.18x range along the stroke, too subtle to be the signature the
    // whole implementation is for. The merge width is the load-bearing
    // number; the mean follows it.
    let tWeighted = 0;
    for (let i = 0; i < STEPS; i += 1) {
      const t = (i + 0.5) / STEPS;
      tWeighted += t * bridgeTaper(t, FAR);
    }
    const centroid = tWeighted / energy;
    const tip = FABRIC_PX * BRIDGE_TIP_WIDTH_RATIO;
    // meanLight(K) = K - (K - tip) * centroid, solved for meanLight = 2.0.
    const neutralKnot = (2.0 - tip * centroid) / (1 - centroid);
    expect(neutralKnot).toBeCloseTo(2.12, 2);
    expect(neutralKnot / tip).toBeLessThan(1.2);
    expect(FABRIC_PX * BRIDGE_WIDTH_RATIO / tip).toBeGreaterThan(1.3);
  });
});

describe('bridge stroke state', () => {
  it('lands the far end at the halo weight it actually anchored on', () => {
    const light = makeBridgeStrokeState(bridge({ anchorWeight: 1 }), 0);
    const thin = makeBridgeStrokeState(bridge({ anchorWeight: 0 }), 0);
    expect(light.farEnd).toBeCloseTo(
      BRIDGE_FAR_END_ENERGY * populationFibreTaper(1),
      12,
    );
    expect(thin.farEnd).toBeCloseTo(
      BRIDGE_FAR_END_ENERGY * populationFibreTaper(0),
      12,
    );
    expect(thin.farEnd).toBeLessThan(light.farEnd);
    expect(light.farEnd).toBeLessThanOrEqual(TWIG_MIN);
  });

  it('lands the symbolic end on the halo STROKE colour, at the vein luma', () => {
    const state = makeBridgeStrokeState(bridge(), 0);
    expect(luma(state.toR, state.toG, state.toB)).toBeCloseTo(
      luma(state.fromR, state.fromG, state.fromB),
      10,
    );
    // ⭐ The far end merges into a STRAND, so it lands on what a strand emits.
    // Since 2026-08-20 that is `POPULATION_STROKE_COLOR` and not `tissueRose`,
    // which is now the halo's BEAD colour: a stroke ending in the bead hue
    // would arrive speaking the wrong class's language.
    const dim = bridgeSymbolicDim([state.fromR, state.fromG, state.fromB]);
    expect(state.toR).toBeCloseTo(POPULATION_STROKE_COLOR[0] * dim, 12);
    expect(state.toG).toBeCloseTo(POPULATION_STROKE_COLOR[1] * dim, 12);
    expect(state.toB).toBeCloseTo(POPULATION_STROKE_COLOR[2] * dim, 12);
    expect(bridgeSymbolicDim(POPULATION_STROKE_COLOR)).toBeCloseTo(1, 10);
    // The gap the dim closes, re-derived at the new endpoint: the halo's
    // stroke hue is 2.0x the vein's luma where `tissueRose` was 3.3x, so the
    // factor is pinned rather than bounded — 0.489 at the middle of the hash
    // range, against the 0.285-0.316 the old endpoint asked for.
    const veinLuma = luma(state.fromR, state.fromG, state.fromB);
    expect(dim).toBeCloseTo(veinLuma / luma(...POPULATION_STROKE_COLOR), 12);
    expect(dim).toBeCloseTo(0.489, 2);
    expect(bridgeSymbolicDim(CELL_GALAXY_PALETTE.tissueRose)).toBeCloseTo(1.627, 3);
  });

  it('never brightens on the way in, at any anchor weight or vein', () => {
    // The recorded trap: ramping RAW from the vein to the old `tissueRose`
    // endpoint put a rising factor on the stroke that `bridgeTaper` had to
    // fight, and lost — with the far end at TWIG_MIN the product read 16%
    // above the knot. Re-derived here for the endpoint the class now uses,
    // over the whole hash range of veins and the whole range of anchor
    // weights, sampled far finer than the four sub-segments actually drawn.
    for (const anchorWeight of [0, 0.3, 0.6, 1]) {
      const state = makeBridgeStrokeState(bridge({ anchorWeight }), 0);
      const from = [state.fromR, state.fromG, state.fromB] as const;
      const to = [state.toR, state.toG, state.toB] as const;
      let previous = Infinity;
      for (let step = 0; step <= 400; step += 1) {
        const t = step / 400;
        const value = luma(
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t,
          from[2] + (to[2] - from[2]) * t,
        ) * bridgeTaper(t, state.farEnd);
        expect(value).toBeLessThanOrEqual(previous + 1e-12);
        previous = value;
      }
    }
  });

  it('takes the fabric non-forest band, never a trunk', () => {
    const state = makeBridgeStrokeState(bridge(), 0);
    expect(state.brightnessMul).toBeGreaterThanOrEqual(TWIG_MIN);
    expect(state.brightnessMul).toBeLessThanOrEqual(TWIG_MIN + 0.1);
  });

  it('is a pure function of the bridge', () => {
    expect(makeBridgeStrokeState(bridge(), 3))
      .toEqual(makeBridgeStrokeState(bridge(), 3));
    expect(makeBridgeStrokeState(bridge({ cellId: 4243 }), 3).ctrlX)
      .not.toBe(makeBridgeStrokeState(bridge(), 3).ctrlX);
  });
});

describe('reconcileBridgeStrokes', () => {
  const strokeMap = (
    ...bridges: BridgeEdge[]
  ): Map<string, BridgeStrokeState> => {
    const strokes = new Map<string, BridgeStrokeState>();
    reconcileBridgeStrokes(strokes, bridges, 0);
    return strokes;
  };

  it('counts a host that gained a bridge', () => {
    const strokes = new Map<string, BridgeStrokeState>();
    expect(reconcileBridgeStrokes(strokes, [bridge(), bridge({ cellId: 7 })], 5))
      .toBe(2);
    expect(strokes.size).toBe(2);
    expect(strokes.get('4242#991')?.bornAt).toBe(5);
  });

  it('counts a host that left the selection, once', () => {
    const strokes = strokeMap(bridge(), bridge({ cellId: 7 }));
    expect(reconcileBridgeStrokes(strokes, [bridge()], 5)).toBe(1);
    expect(strokes.get('7#991')?.dyingAt).toBe(5);
    // The second build finds it already retracting: a death is not re-counted
    // for as long as the afterimage lives.
    expect(reconcileBridgeStrokes(strokes, [bridge()], 6)).toBe(0);
    expect(strokes.get('7#991')?.dyingAt).toBe(5);
  });

  it('counts a re-admitted host and leaves its clock alone', () => {
    const strokes = strokeMap(bridge());
    reconcileBridgeStrokes(strokes, [], 5);
    expect(reconcileBridgeStrokes(strokes, [bridge()], 9)).toBe(1);
    const revived = strokes.get('4242#991')!;
    expect(revived.dyingAt).toBeNull();
    // Keeps growing from where it is rather than restarting.
    expect(revived.bornAt).toBe(0);
  });

  it('reports zero for a selection that did not move — and touches nothing', () => {
    // ⭐ The steady state of a composed stage. Zero is what lets the layer skip
    // a full re-walk and a full-prefix upload, so it has to be exact: same
    // hosts, same anchors, same records, in a different array order.
    const strokes = strokeMap(bridge(), bridge({ cellId: 7 }));
    const before = [...strokes.entries()].map(([key, s]) => [key, { ...s }]);
    expect(
      reconcileBridgeStrokes(strokes, [bridge({ cellId: 7 }), bridge()], 40),
    ).toBe(0);
    expect([...strokes.entries()].map(([key, s]) => [key, { ...s }]))
      .toEqual(before);
  });

  it('sums the three kinds in one build', () => {
    const strokes = strokeMap(bridge(), bridge({ cellId: 7 }));
    reconcileBridgeStrokes(strokes, [bridge()], 5);
    // One revival (7), one death (4242), one birth (8).
    expect(
      reconcileBridgeStrokes(
        strokes, [bridge({ cellId: 7 }), bridge({ cellId: 8 })], 9,
      ),
    ).toBe(3);
  });
});

describe('bridge lifecycle', () => {
  it('grows out of the Cell, not out of the halo', () => {
    const state = makeBridgeStrokeState(bridge(), 10);
    const growing = bridgeRenderState(state, 10 + (GROWTH_MS / 1000) * 0.5);
    expect(growing.tStart).toBe(0);
    expect(growing.tEnd).toBeCloseTo(0.5, 6);
    expect(growing.animating).toBe(true);
  });

  it('withdraws the symbolic end back toward the Cell', () => {
    const state = makeBridgeStrokeState(bridge(), 0);
    state.dyingAt = 20;
    const dying = bridgeRenderState(state, 20 + (DEATH_RETRACT_MS / 1000) * 0.5);
    expect(dying.tStart).toBe(0);
    expect(dying.tEnd).toBeCloseTo(0.5, 6);
    // Past the window it reaps, so the layer can free the record.
    expect(bridgeRenderState(state, 20 + DEATH_RETRACT_MS / 1000 + 1e-6).reap)
      .toBe(true);
  });

  it('shares no state between two strokes read in the same frame', () => {
    const young = makeBridgeStrokeState(bridge(), 100);
    const old = makeBridgeStrokeState(bridge(), 0);
    const youngRender = { ...bridgeRenderState(young, 100.4) };
    const oldRender = bridgeRenderState(old, 100.4);
    expect(youngRender.tEnd).toBeLessThan(1);
    expect(oldRender.tEnd).toBe(1);
    expect({ ...bridgeRenderState(young, 100.4) }).toEqual(youngRender);
  });
});

describe('writeBridgeStroke', () => {
  it('emits the fabric sample count as one chained polyline', () => {
    const { positions, written } = draw();
    expect(written).toBe(FABRIC_SAMPLES_PER_EDGE);
    for (let segment = 1; segment < written; segment += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        expect(positions[segment * 6 + axis])
          .toBeCloseTo(positions[(segment - 1) * 6 + 3 + axis], 6);
      }
    }
  });

  it('dims monotonically in every channel to the far end', () => {
    const { colors, written } = draw();
    const vertices: [number, number, number][] = [
      [colors[0], colors[1], colors[2]],
    ];
    for (let segment = 0; segment < written; segment += 1) {
      vertices.push([
        colors[segment * 6 + 3],
        colors[segment * 6 + 4],
        colors[segment * 6 + 5],
      ]);
    }
    for (let vertex = 1; vertex < vertices.length; vertex += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        expect(vertices[vertex][channel])
          .toBeLessThanOrEqual(vertices[vertex - 1][channel] + 1e-9);
      }
    }
    // And the last vertex is the dimmest thing on the stroke by a wide
    // margin — no knot, no bead, nothing for a halo point to look like.
    const last = vertices[vertices.length - 1];
    const first = vertices[0];
    expect(luma(...last)).toBeLessThan(luma(...first) * 0.4);
  });

  it('discards the retirement flash the fabric would apply', () => {
    // At the instant of death the fabric's flash envelope is exactly 1 and
    // the retract has not moved, so a stroke that read it would be at its
    // brightest here. It must be byte-identical to the settled stroke.
    const settled = makeBridgeStrokeState(bridge(), 0);
    const dying = makeBridgeStrokeState(bridge(), 0);
    dying.dyingAt = 60;
    const render = bridgeRenderState(dying, 60);
    expect(render.flash).toBeCloseTo(1, 6);
    expect(render.tEnd).toBe(1);
    expect([...draw(dying, 60).colors]).toEqual([...draw(settled, 60).colors]);
  });

  it('respects the core de-glare rather than bypassing it', () => {
    const centre = makeBridgeStrokeState(
      bridge({ fromX: 0, fromZ: 0, toX: 2, toZ: 2 }),
      0,
    );
    const dim = draw(centre, 60, FABRIC_SAMPLES_PER_EDGE, 0.3);
    const bright = draw(centre, 60, FABRIC_SAMPLES_PER_EDGE, 1);
    expect(dim.colors[0]).toBeLessThan(bright.colors[0]);
    expect(dim.colors[0]).toBeGreaterThan(0);
  });

  it('clips at the allocation instead of writing past it', () => {
    const { written, positions } = draw(
      makeBridgeStrokeState(bridge(), 0),
      60,
      2,
    );
    expect(written).toBe(2);
    expect(positions.length).toBe(12);
  });

  it('writes nothing for an invisible stroke', () => {
    const state = makeBridgeStrokeState(bridge(), 500);
    // Staggered into the future: not yet born.
    expect(draw(state, 100).written).toBe(0);
  });
});

describe('bridgeRenderStateInto — allocation-free per-frame render state', () => {
  it('writes into the caller scratch and returns it', () => {
    const state = makeBridgeStrokeState(bridge(), 0);
    const scratch = makeEdgeRenderScratch();
    const result = bridgeRenderStateInto(scratch, state, 60);
    expect(result).toBe(scratch);
  });

  it('matches the allocating bridgeRenderState across the lifecycle', () => {
    const scratch = makeEdgeRenderScratch();
    for (const nowSec of [
      0,
      GROWTH_MS / 2000,
      60,
      60 + DEATH_RETRACT_MS / 2000,
    ]) {
      const growing = makeBridgeStrokeState(bridge(), 0);
      expect(bridgeRenderStateInto(scratch, growing, nowSec))
        .toEqual(bridgeRenderState(growing, nowSec));
    }
  });

  it('one scratch, reused across a walk, holds only the latest stroke', () => {
    const scratch = makeEdgeRenderScratch();
    const first = makeBridgeStrokeState(bridge(), 0);
    const second = makeBridgeStrokeState(bridge({ cellId: 9999 }), 30);
    bridgeRenderStateInto(scratch, first, 60);
    bridgeRenderStateInto(scratch, second, 60);
    expect(scratch).toEqual(bridgeRenderState(second, 60));
  });
});
