import { describe, expect, it } from 'vitest';

import type { BridgeEdge } from '../../src/geometry/bridgeEdges';
import { FABRIC_SAMPLES_PER_EDGE } from '../../src/nerve/fabricCapacity';
import {
  DEATH_RETRACT_MS,
  GROWTH_MS,
} from '../../src/nerve/fabricEdgeRender';
import {
  BRIDGE_FAR_END_ENERGY,
  bridgeRenderState,
  bridgeSymbolicDim,
  makeBridgeStrokeState,
  writeBridgeStroke,
} from '../../src/nerve/bridgeStroke';
import { bridgeTaper, TWIG_MIN } from '../../src/nerve/fabricLuminance';
import {
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

/** The layer's own emit: living strokes into a fresh pair of arrays. */
function draw(
  state = makeBridgeStrokeState(bridge(), 0),
  nowSec = 60,
  maxSegments = FABRIC_SAMPLES_PER_EDGE,
  centerDim = 0.3,
): { positions: Float32Array; colors: Float32Array; written: number } {
  const positions = new Float32Array(maxSegments * 6);
  const colors = new Float32Array(maxSegments * 6);
  const written = writeBridgeStroke(
    positions,
    colors,
    0,
    maxSegments,
    state,
    bridgeRenderState(state, nowSec),
    0.15,
    centerDim,
    new Float32Array(3),
  );
  return { positions, colors, written };
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
