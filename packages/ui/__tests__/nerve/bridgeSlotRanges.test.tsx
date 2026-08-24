// What a bridge frame owes the GPU.
//
// A bridge's grow and retract run on the CPU, so every frame of a 1.2 s growth
// window reaches the layer's buffers — and the whole question is how much of
// them. Each stroke owns a fixed span, so the answer is: the spans of the
// strokes that actually moved, and on a settled frame nothing at all.
//
// The component is Canvas-bound only through `useFrame` / `useThree` (the
// fabricApertureRanges precedent), and it is the scene's ONLY tapered-width
// capsule layer, so intercepting the capsule geometry factory hands the test
// the very buffers the renderer reads — including the width lane no other
// layer allocates.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, type RenderResult } from '@testing-library/react';
import type { InstancedInterleavedBuffer, InterleavedBufferAttribute } from 'three';
import type { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Cell } from '@cknerv/types';

import { BRIDGE_ANCHOR_PREFIX } from '../../src/geometry/bridgeEdges';
import { emptyNeighborGraph } from '../../src/geometry/neighborGraph';
import {
  resetPopulationPlacement,
  setPopulationPlacement,
  type PopulationPlacementSnapshot,
} from '../../src/geometry/populationPlacementStore';
import { DEATH_RETRACT_MS, GROWTH_MS } from '../../src/nerve/fabricEdgeRender';
import { FABRIC_SLOT_FILLER_Y, FABRIC_SLOT_SEGMENTS } from '../../src/nerve/fabricSlots';
import { LIVE } from '../../src/tweaks/liveTweaks';
import { resetSimClock, simClock } from '../../src/tweaks/simClock';
import CellBridgeNerves from '../../src/nerve/CellBridgeNerves';

const frames = vi.hoisted(() => ({
  callbacks: [] as Array<(state: unknown, delta: number) => void>,
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: (state: unknown, delta: number) => void) => {
    frames.callbacks.push(callback);
  },
  useThree: (selector?: (state: unknown) => unknown) => {
    const state = { size: { width: 1280, height: 720 } };
    return selector ? selector(state) : state;
  },
}));

const capsules = vi.hoisted(() => ({
  geometries: [] as LineSegmentsGeometry[],
}));

vi.mock('../../src/geometry/screenSpaceCapsuleLine', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/geometry/screenSpaceCapsuleLine')
  >();
  return {
    ...actual,
    makeScreenSpaceCapsuleGeometry: () => {
      const geometry = actual.makeScreenSpaceCapsuleGeometry();
      capsules.geometries.push(geometry);
      return geometry;
    },
  };
});

/** Points a bridge may anchor in — the lowest quality preset's prefix, which
 *  is what `buildBridgeAnchorIndex` trims to. */
const ANCHORS = 4;
const POINTS = Math.round(ANCHORS / BRIDGE_ANCHOR_PREFIX);

/** A halo placement out at the rim, where `resolvedCoverage` is near zero and
 *  a bare Cell is therefore allowed to host. Only the first `ANCHORS` points
 *  and the segments between them are ever read; the rest exist so the prefix
 *  is a prefix. Segments stay sorted by their larger endpoint, which is what
 *  `populationSegmentsForPointPrefix` binary-searches. */
function placementFixture(): PopulationPlacementSnapshot {
  const positions = new Float32Array(POINTS * 3);
  const weights = new Float32Array(POINTS).fill(0.6);
  for (let point = 0; point < POINTS; point += 1) {
    positions[point * 3] = point < ANCHORS ? 60 + point * 2 : 200 + point;
    positions[point * 3 + 1] = 0;
    positions[point * 3 + 2] = point % 2 === 0 ? 1 : -1;
  }
  const segments = new Uint32Array([0, 1, 1, 2, 2, 3, 4, 5, 5, 6]);
  return {
    positions,
    segments,
    backboneSegments: new Uint32Array(0),
    backboneSegmentCount: 0,
    residualSegments: segments,
    residualSegmentCount: segments.length / 2,
    backboneComponents: 0,
    weights,
    count: POINTS,
    segmentCount: segments.length / 2,
    streamlines: 1,
    work: 1,
  };
}

/** A staged Cell within a bridge's reach of the anchor prefix above. */
function cell(id: number, x: number, z: number): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [x, 0, z],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 0,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: `0x${String(id).padStart(64, '0')}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
  };
}

const HOSTS = new Map<number, Cell>([
  [1, cell(1, 61, 0.5)],
  [2, cell(2, 64, -0.5)],
]);

function cellsFor(ids: readonly number[]): Map<number, Cell> {
  return new Map(ids.map((id) => [id, HOSTS.get(id)!]));
}

interface BridgeBuffers {
  positions: InstancedInterleavedBuffer;
  colors: InstancedInterleavedBuffer;
  widths: InstancedInterleavedBuffer;
  geometry: LineSegmentsGeometry;
}

/** The three lanes of the mounted bridge layer, read off the geometry the
 *  component bound them to. The width lane is the tell: no other layer in the
 *  scene has one. */
function bridgeBuffers(): BridgeBuffers {
  for (const geometry of capsules.geometries) {
    const widths = geometry.getAttribute(
      'instanceWidthStart',
    ) as InterleavedBufferAttribute | undefined;
    if (!widths) continue;
    return {
      positions: (geometry.getAttribute(
        'instanceStart',
      ) as InterleavedBufferAttribute).data as InstancedInterleavedBuffer,
      colors: (geometry.getAttribute(
        'instanceColorStart',
      ) as InterleavedBufferAttribute).data as InstancedInterleavedBuffer,
      widths: widths.data as InstancedInterleavedBuffer,
      geometry,
    };
  }
  throw new Error('no tapered capsule layer was built');
}

interface Span { start: number; count: number }

/** Update ranges in SEGMENT units — what a mark actually means, whatever each
 *  lane's stride happens to be. */
function spans(buffer: InstancedInterleavedBuffer, stride: number): Span[] {
  return buffer.updateRanges.map(({ start, count }) => ({
    start: start / stride,
    count: count / stride,
  }));
}

/** Stand in for the renderer, which clears an attribute's ranges as it
 *  uploads them. Every assertion below is therefore about ONE frame's marks. */
function consumeUploads(buffers: BridgeBuffers): void {
  buffers.positions.clearUpdateRanges();
  buffers.colors.clearUpdateRanges();
  buffers.widths.clearUpdateRanges();
}

const cellsRef = { current: new Map<number, Cell>() };
const passiveGraphRef = { current: emptyNeighborGraph() };
let view: RenderResult | null = null;
let version = 0;

/** Run one frame: every callback the current render registered, at `atSec`. */
function frame(atSec: number): void {
  resetSimClock(simClock, atSec);
  for (const callback of frames.callbacks) callback({}, 1 / 60);
}

/** A completed topology build — the staged Cells change and the version bumps,
 *  which is the one thing that re-selects — followed by its own frame. */
function build(ids: readonly number[], atSec: number): void {
  cellsRef.current = cellsFor(ids);
  version += 1;
  // Each render registers its own frame callbacks; only the live ones drive.
  frames.callbacks.length = 0;
  const element = (
    <CellBridgeNerves
      cellsRef={cellsRef}
      passiveGraphRef={passiveGraphRef}
      version={version}
    />
  );
  if (view === null) view = render(element);
  else view.rerender(element);
  frame(atSec);
}

const SETTLED_SEC = (GROWTH_MS / 1000) + 0.3;
const REAPED_SEC = (DEATH_RETRACT_MS / 1000) + 0.05;
const restingAlpha = LIVE.cell.fabricAlpha;

beforeEach(() => {
  capsules.geometries.length = 0;
  frames.callbacks.length = 0;
  view = null;
  version = 0;
  LIVE.cell.fabricAlpha = restingAlpha;
  resetSimClock();
  setPopulationPlacement(placementFixture());
});

afterEach(() => {
  cleanup();
  resetPopulationPlacement();
});

describe('the bridge layer rewrites the strokes that moved, not the layer', () => {
  it('says nothing at all on a settled frame', () => {
    build([1], 0);
    const buffers = bridgeBuffers();
    expect(buffers.geometry.instanceCount).toBeGreaterThan(0);
    frame(SETTLED_SEC);
    consumeUploads(buffers);

    // Nothing is growing, nothing is dying, no knob moved. The frame body is
    // an early return: not a mark, not a byte, and not one Bezier sample.
    const before = buffers.positions.array.slice();
    const version0 = buffers.positions.version;
    frame(SETTLED_SEC + 0.1);
    frame(SETTLED_SEC + 0.2);
    expect(buffers.positions.updateRanges).toEqual([]);
    expect(buffers.colors.updateRanges).toEqual([]);
    expect(buffers.widths.updateRanges).toEqual([]);
    expect(buffers.positions.version).toBe(version0);
    expect([...buffers.positions.array]).toEqual([...before]);
  });

  it('marks the span of the one stroke that is growing and no other', () => {
    build([1], 0);
    const buffers = bridgeBuffers();
    const settled = buffers.geometry.instanceCount;
    frame(SETTLED_SEC);
    consumeUploads(buffers);

    // A second host arrives. Its strokes are the only thing in the layer that
    // is moving for the next 1.2 s; the first host's are exactly where the
    // build frame left them.
    build([1, 2], SETTLED_SEC);
    const total = buffers.geometry.instanceCount;
    expect(total).toBeGreaterThan(settled);
    consumeUploads(buffers);
    const stable = buffers.positions.array.slice(0, settled * 6);

    frame(SETTLED_SEC + 0.1);
    const growing: Span = { start: settled, count: total - settled };
    expect(spans(buffers.positions, 6)).toEqual([growing]);
    expect(spans(buffers.colors, 6)).toEqual([growing]);
    // The width lane rides the positions: a tapered stroke's width is a
    // function of where it is along its own curve.
    expect(spans(buffers.widths, 2)).toEqual([growing]);
    // And the settled strokes were not merely un-marked — they were not
    // touched. This is the CPU half of the finding, asserted as bytes.
    expect([...buffers.positions.array.slice(0, settled * 6)])
      .toEqual([...stable]);
  });

  it('parks the span a retract leaves behind, on the frame it leaves it', () => {
    build([1, 2], 0);
    const buffers = bridgeBuffers();
    frame(SETTLED_SEC);
    consumeUploads(buffers);
    const both = buffers.geometry.instanceCount;

    // The second host leaves the selection: its strokes retract, and only
    // theirs move.
    build([1], SETTLED_SEC);
    consumeUploads(buffers);
    frame(SETTLED_SEC + 0.3);
    // They sit at the tail of the prefix — their host entered the layer
    // second, and a build hands out spans in that order.
    const dying = spans(buffers.positions, 6)[0];
    expect(spans(buffers.positions, 6)).toHaveLength(1);
    expect(dying.start).toBeGreaterThan(0);
    expect(dying.start + dying.count).toBe(both);
    consumeUploads(buffers);

    // Past the retract window the strokes are reaped. Their spans must go
    // degenerate on the way out: a hole nobody rewrites keeps drawing the last
    // frame of the retract until some later build happens to reuse it.
    frame(SETTLED_SEC + REAPED_SEC);
    expect(spans(buffers.positions, 6)).toEqual([dying]);
    for (let segment = dying.start; segment < dying.start + dying.count; segment += 1) {
      expect(buffers.positions.array[segment * 6 + 1]).toBe(FABRIC_SLOT_FILLER_Y);
      expect(buffers.positions.array[segment * 6 + 4]).toBe(FABRIC_SLOT_FILLER_Y);
      expect(buffers.colors.array[segment * 6]).toBe(0);
      expect(buffers.widths.array[segment * 2]).toBe(0);
      expect(buffers.widths.array[segment * 2 + 1]).toBe(0);
    }
    // The hole stays a hole — vertex-only cost — until a build compacts it,
    // and the frame after the last reap is quiet again.
    expect(buffers.geometry.instanceCount).toBe(both);
    consumeUploads(buffers);
    frame(SETTLED_SEC + REAPED_SEC + 0.1);
    expect(buffers.positions.updateRanges).toEqual([]);

    // ⚠️ A build that re-selected the same hosts is NOT where the debt is
    // paid. Nothing moved, so there is nothing for the walk to say and it does
    // not run: the layer already draws exactly what that selection asks for,
    // holes and all, and re-walking it would re-upload the whole prefix to
    // restate it.
    build([1], SETTLED_SEC + REAPED_SEC + 0.2);
    expect(buffers.geometry.instanceCount).toBe(both);
    expect(buffers.positions.updateRanges).toEqual([]);

    // A build that MOVED something is. Spans are handed out from zero and the
    // prefix shrinks back to what is actually drawn — here the last host's own
    // strokes, retracting. Hole debt is therefore bounded by one block's reaps
    // and can never outlive the next selection that changed.
    build([], SETTLED_SEC + REAPED_SEC + 0.3);
    expect(buffers.geometry.instanceCount).toBe(both - dying.count);
  });

  it('lands a knob drag on every stroke, settled or not', () => {
    build([1, 2], 0);
    const buffers = bridgeBuffers();
    frame(SETTLED_SEC);
    consumeUploads(buffers);
    const total = buffers.geometry.instanceCount;
    const before = buffers.colors.array.slice(0, total * 6);

    // The one path that still owes a full rewrite: every stroke's energy is a
    // function of this knob, and nothing about the strokes themselves moved.
    LIVE.cell.fabricAlpha = restingAlpha * 0.5;
    frame(SETTLED_SEC + 0.1);
    const whole: Span = { start: 0, count: total };
    expect(spans(buffers.positions, 6)).toEqual([whole]);
    expect(spans(buffers.colors, 6)).toEqual([whole]);
    expect(spans(buffers.widths, 2)).toEqual([whole]);
    const after = buffers.colors.array.slice(0, total * 6);
    expect([...after]).not.toEqual([...before]);
    for (let float = 0; float < after.length; float += 1) {
      expect(after[float]).toBeCloseTo(before[float] * 0.5, 9);
    }
    consumeUploads(buffers);

    // ...and it is a one-frame debt, not a new animation.
    frame(SETTLED_SEC + 0.2);
    expect(buffers.positions.updateRanges).toEqual([]);
  });

  it('reassigns every span on a build and uploads the whole prefix', () => {
    build([1], 0);
    const buffers = bridgeBuffers();
    const settled = buffers.geometry.instanceCount;
    // The build frame is a full rewrite: this is where strokes enter and leave.
    expect(spans(buffers.positions, 6)).toEqual([{ start: 0, count: settled }]);
    frame(SETTLED_SEC);
    consumeUploads(buffers);

    build([1, 2], SETTLED_SEC);
    const total = buffers.geometry.instanceCount;
    expect(spans(buffers.positions, 6)).toEqual([{ start: 0, count: total }]);
    expect(spans(buffers.colors, 6)).toEqual([{ start: 0, count: total }]);
    expect(spans(buffers.widths, 2)).toEqual([{ start: 0, count: total }]);
    // Every stroke is a whole number of spans, and each span is one curve's
    // sample budget — the fabric's slot, for the same reason.
    expect(total % FABRIC_SLOT_SEGMENTS).toBe(0);
  });

  it('leaves a span its stroke did not fill rasterizing nothing', () => {
    // The birth frame: a stroke's growth is at zero, so `writeBridgeStroke`
    // writes no segment at all — and its span may still hold whatever lived
    // there before the compaction.
    build([1], 0);
    const buffers = bridgeBuffers();
    const total = buffers.geometry.instanceCount;
    for (let segment = 0; segment < total; segment += 1) {
      expect(buffers.positions.array[segment * 6 + 1]).toBe(FABRIC_SLOT_FILLER_Y);
      expect(buffers.positions.array[segment * 6 + 4]).toBe(FABRIC_SLOT_FILLER_Y);
      for (let float = 0; float < 6; float += 1) {
        expect(buffers.colors.array[segment * 6 + float]).toBe(0);
      }
      // Zero width, so the capsule expands to nothing even for a driver that
      // rasterized an off-frustum degenerate segment anyway.
      expect(buffers.widths.array[segment * 2]).toBe(0);
      expect(buffers.widths.array[segment * 2 + 1]).toBe(0);
    }

    // One frame later the same spans carry real geometry, in place.
    frame(0.1);
    expect(spans(buffers.positions, 6)).toEqual([{ start: 0, count: total }]);
    for (let segment = 0; segment < total; segment += 1) {
      expect(buffers.positions.array[segment * 6 + 1])
        .toBeLessThan(FABRIC_SLOT_FILLER_Y);
      expect(buffers.widths.array[segment * 2]).toBeGreaterThan(0);
    }
  });
});
