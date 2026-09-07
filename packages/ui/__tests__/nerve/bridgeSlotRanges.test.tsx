// What a bridge frame owes the GPU.
//
// A bridge's grow and retract run on the CPU, so every frame of a 1.2 s growth
// window reaches the layer's buffers — and the whole question is how much of
// them. Each stroke owns a fixed span, so the answer is: the spans of the
// strokes that actually moved, and on a settled frame nothing at all. Since
// 2026-08-28 the same answer holds for a BUILD: a topology build that moved a
// handful of strokes admits those into spans of their own and writes nothing
// else, and a build that moved none runs no selection at all.
//
// The component is Canvas-bound only through `useFrame` / `useThree` (the
// fabricApertureRanges precedent), and it is the scene's ONLY tapered-width
// capsule layer, so intercepting the capsule geometry factory hands the test
// the very buffers the renderer reads — including the width lane no other
// layer allocates.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, type RenderResult } from '@testing-library/react';
import type { InstancedInterleavedBuffer, InterleavedBufferAttribute } from 'three';
import type { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Cell } from '@cknerv/types';

import {
  BRIDGE_ALLOCATION_BRIDGES,
  BRIDGE_ANCHOR_PREFIX,
  BRIDGE_BUDGET,
  buildBridgeAnchorIndex,
  selectBridgeEdges,
  type BridgeHostCell,
} from '../../src/geometry/bridgeEdges';
import { emptyNeighborGraph, type NeighborGraph } from '../../src/geometry/neighborGraph';
import {
  resetPopulationPlacement,
  setPopulationPlacement,
  type PopulationPlacementSnapshot,
} from '../../src/geometry/populationPlacementStore';
import { bridgeStats, resetBridgeStats } from '../../src/nerve/bridgeStats';
import {
  bridgeRenderState,
  reconcileBridgeStrokes,
  writeBridgeStroke,
  type BridgeStrokeState,
} from '../../src/nerve/bridgeStroke';
import { DEATH_RETRACT_MS, GROWTH_MS } from '../../src/nerve/fabricEdgeRender';
import { FABRIC_SLOT_FILLER_Y, FABRIC_SLOT_SEGMENTS } from '../../src/nerve/fabricSlots';
import { LIVE } from '../../src/tweaks/liveTweaks';
import { resetSimClock, simClock } from '../../src/tweaks/simClock';
import {
  FRAME_BUDGET_FABRIC_DRAIN,
  beginFrameBudget,
  resetFrameBudget,
  spendFrameBudget,
} from '../../src/nerve/frameBudget';
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

// The selection is the work the registry exists to skip, so the proof that
// it was skipped is a call count on the real function.
vi.mock('../../src/geometry/bridgeEdges', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/geometry/bridgeEdges')
  >();
  return { ...actual, selectBridgeEdges: vi.fn(actual.selectBridgeEdges) };
});

type BridgeEdgesModule = typeof import('../../src/geometry/bridgeEdges');
let actualBridgeEdges: BridgeEdgesModule;
beforeAll(async () => {
  actualBridgeEdges = await vi.importActual<BridgeEdgesModule>(
    '../../src/geometry/bridgeEdges',
  );
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

/** The selection's own view of a Cell map, for the from-scratch oracle. */
function hostsOf(cells: ReadonlyMap<number, Cell>, graph: NeighborGraph): BridgeHostCell[] {
  const degree = new Map<number, number>();
  for (const edge of graph.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const hosts: BridgeHostCell[] = [];
  for (const c of cells.values()) {
    if (c.death_at_ms != null) continue;
    hosts.push({
      id: c.id,
      x: c.pos_seed[0],
      y: c.pos_seed[1],
      z: c.pos_seed[2],
      degree: degree.get(c.id) ?? 0,
    });
  }
  return hosts;
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

/** The slots a set of segment ranges covers. */
function coveredSlots(ranges: readonly Span[]): Set<number> {
  const slots = new Set<number>();
  for (const range of ranges) {
    for (let seg = range.start; seg < range.start + range.count; seg += 1) {
      slots.add(Math.floor(seg / FABRIC_SLOT_SEGMENTS));
    }
  }
  return slots;
}

/** Stand in for the renderer, which clears an attribute's ranges as it
 *  uploads them. Every assertion below is therefore about ONE frame's marks. */
function consumeUploads(buffers: BridgeBuffers): void {
  buffers.positions.clearUpdateRanges();
  buffers.colors.clearUpdateRanges();
  buffers.widths.clearUpdateRanges();
}

/** One stroke's span, read back as content. A span is fully written or fully
 *  parked — `writeBridgeStroke` writes its whole sample count or nothing —
 *  and a written stroke's first vertex sits on its host Cell, which is how a
 *  test tells whose span it is looking at without the layer's private map. */
interface SlotBlock {
  slot: number;
  parked: boolean;
  hostX: number;
  floats: number[];
}

function blocks(buffers: BridgeBuffers): SlotBlock[] {
  const positions = buffers.positions.array as Float32Array;
  const colors = buffers.colors.array as Float32Array;
  const widths = buffers.widths.array as Float32Array;
  const out: SlotBlock[] = [];
  const slots = buffers.geometry.instanceCount / FABRIC_SLOT_SEGMENTS;
  expect(Number.isInteger(slots)).toBe(true);
  for (let slot = 0; slot < slots; slot += 1) {
    const seg0 = slot * FABRIC_SLOT_SEGMENTS;
    const parked = positions[seg0 * 6 + 1] === FABRIC_SLOT_FILLER_Y;
    for (let seg = seg0; seg < seg0 + FABRIC_SLOT_SEGMENTS; seg += 1) {
      expect(positions[seg * 6 + 1] === FABRIC_SLOT_FILLER_Y).toBe(parked);
      expect(positions[seg * 6 + 4] === FABRIC_SLOT_FILLER_Y).toBe(parked);
    }
    out.push({
      slot,
      parked,
      hostX: positions[seg0 * 6],
      floats: [
        ...positions.subarray(seg0 * 6, (seg0 + FABRIC_SLOT_SEGMENTS) * 6),
        ...colors.subarray(seg0 * 6, (seg0 + FABRIC_SLOT_SEGMENTS) * 6),
        ...widths.subarray(seg0 * 2, (seg0 + FABRIC_SLOT_SEGMENTS) * 2),
      ],
    });
  }
  return out;
}

function slotsOfHost(buffers: BridgeBuffers, hostX: number): number[] {
  return blocks(buffers)
    .filter((block) => !block.parked && block.hostX === hostX)
    .map((block) => block.slot);
}

/** The layer's written spans as a sorted multiset of their bytes — the shape
 *  an equivalence is stated in, since where a stroke sits is the layer's
 *  business and what it contains is not. */
function writtenBlocks(buffers: BridgeBuffers): string[] {
  return blocks(buffers)
    .filter((block) => !block.parked)
    .map((block) => JSON.stringify(block.floats))
    .sort();
}

/** Frames one build takes: `bridgeSchedule`'s three steps, one per frame. */
const BRIDGE_BUILD_FRAMES = 3;

const cellsRef = { current: new Map<number, Cell>() };
const passiveGraphRef = { current: emptyNeighborGraph() };
let view: RenderResult | null = null;
let version = 0;

/** Run one frame: every callback the current render registered, at `atSec`.
 *  The owner's raw priority −1 frame opens the shared heavy-work ledger before
 *  any of them (`frameBudget`), and standing in for it is the harness's job —
 *  without it this class would read one endless frame and hold its own steps.
 */
function frame(atSec: number): void {
  resetSimClock(simClock, atSec);
  beginFrameBudget();
  for (const callback of frames.callbacks) callback({}, 1 / 60);
}

/** A frame whose heavy budget the owner's other block consumers already took
 *  — the drain and the live-plan slice on the frame right after a landing. */
function busyFrame(atSec: number): void {
  resetSimClock(simClock, atSec);
  beginFrameBudget();
  spendFrameBudget(FRAME_BUDGET_FABRIC_DRAIN, 11);
  for (const callback of frames.callbacks) callback({}, 1 / 60);
}

/** A completed topology build — the staged Cells change and the version bumps,
 *  which is the one thing that re-selects — followed by the frames it takes.
 *
 *  ⭐ THREE frames, all at `atSec`: the body is `bridgeSchedule`'s sync →
 *  select → reconcile, one step per frame at most, so a build is finished on
 *  the third. They share one clock, so the build's strokes are still born (or
 *  start dying) at exactly `atSec`, which is what a replay through the pure
 *  functions has to assume. The renderer clears an attribute's ranges as it
 *  uploads them, so the harness does the same between the frames — every
 *  assertion below is about the marks of ONE frame, and the frame that matters
 *  is the one the reconcile landed on. */
function build(cells: readonly number[] | Map<number, Cell>, atSec: number): void {
  cellsRef.current = cells instanceof Map ? cells : cellsFor(cells);
  version += 1;
  resetSimClock(simClock, atSec);
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
  for (let step = 1; step < BRIDGE_BUILD_FRAMES; step += 1) {
    frame(atSec);
    consumeUploads(bridgeBuffers());
  }
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
  cellsRef.current = new Map();
  passiveGraphRef.current = emptyNeighborGraph();
  resetSimClock();
  resetBridgeStats();
  resetFrameBudget();
  vi.mocked(selectBridgeEdges).mockClear();
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

  it('parks the span a retract leaves behind, and the next birth takes it', () => {
    build([1, 2], 0);
    const buffers = bridgeBuffers();
    frame(SETTLED_SEC);
    consumeUploads(buffers);
    const both = buffers.geometry.instanceCount;
    const dyingSlots = slotsOfHost(buffers, 64);
    const livingSlots = slotsOfHost(buffers, 61);
    expect(dyingSlots.length).toBeGreaterThan(0);
    expect(livingSlots.length).toBeGreaterThan(0);
    expect(dyingSlots.length + livingSlots.length).toBe(both / FABRIC_SLOT_SEGMENTS);

    // The second host leaves the selection: its strokes retract IN PLACE —
    // the spans they were admitted into, wherever those are — and only
    // theirs move. The first host's bytes are not touched from here on.
    const stable = () => livingSlots.map((slot) => JSON.stringify(blocks(buffers)[slot].floats));
    const stableBefore = stable();
    build([1], SETTLED_SEC);
    consumeUploads(buffers);
    frame(SETTLED_SEC + 0.3);
    const marked = coveredSlots(spans(buffers.positions, 6));
    for (const slot of dyingSlots) expect(marked.has(slot)).toBe(true);
    // The merge may bridge a small gap between two dying spans (one
    // bufferSubData instead of two); it never reaches outside their hull.
    for (const slot of marked) {
      expect(slot).toBeGreaterThanOrEqual(Math.min(...dyingSlots));
      expect(slot).toBeLessThanOrEqual(Math.max(...dyingSlots));
    }
    expect(stable()).toEqual(stableBefore);
    consumeUploads(buffers);

    // Past the retract window the strokes are reaped. Their spans must go
    // degenerate on the way out: a hole nobody rewrites keeps drawing the last
    // frame of the retract until some later birth happens to reuse it.
    frame(SETTLED_SEC + REAPED_SEC);
    expect(coveredSlots(spans(buffers.positions, 6))).toEqual(marked);
    for (const slot of dyingSlots) {
      const block = blocks(buffers)[slot];
      expect(block.parked).toBe(true);
      for (let seg = 0; seg < FABRIC_SLOT_SEGMENTS; seg += 1) {
        expect(buffers.colors.array[(slot * FABRIC_SLOT_SEGMENTS + seg) * 6]).toBe(0);
        expect(buffers.widths.array[(slot * FABRIC_SLOT_SEGMENTS + seg) * 2]).toBe(0);
        expect(buffers.widths.array[(slot * FABRIC_SLOT_SEGMENTS + seg) * 2 + 1]).toBe(0);
      }
    }
    expect(stable()).toEqual(stableBefore);
    // The hole stays a hole — vertex-only cost, and the prefix does not
    // shrink — and the frame after the last reap is quiet again.
    expect(buffers.geometry.instanceCount).toBe(both);
    consumeUploads(buffers);
    frame(SETTLED_SEC + REAPED_SEC + 0.1);
    expect(buffers.positions.updateRanges).toEqual([]);

    // ⚠️ A build that re-selected the same hosts is NOT where the debt is
    // paid, and it costs nothing: the registry reports no movement, so no
    // selection runs, nothing is reconciled, nothing is marked.
    const selections = vi.mocked(selectBridgeEdges).mock.calls.length;
    build([1], SETTLED_SEC + REAPED_SEC + 0.2);
    expect(vi.mocked(selectBridgeEdges).mock.calls.length).toBe(selections);
    expect(buffers.geometry.instanceCount).toBe(both);
    expect(buffers.positions.updateRanges).toEqual([]);
    expect(stable()).toEqual(stableBefore);

    // ⭐ The next BIRTH is. A stroke born between two full walks takes a
    // parked hole before the prefix grows — the fabric's own allocator — so
    // the prefix stays where it was, the marks on the build frame are the
    // reused holes and nothing else, and the survivors are still untouched.
    build([1, 2], SETTLED_SEC + REAPED_SEC + 0.3);
    expect(buffers.geometry.instanceCount).toBe(both);
    const reborn = coveredSlots(spans(buffers.positions, 6));
    for (const slot of dyingSlots) expect(reborn.has(slot)).toBe(true);
    for (const slot of reborn) {
      expect(slot).toBeGreaterThanOrEqual(Math.min(...dyingSlots));
      expect(slot).toBeLessThanOrEqual(Math.max(...dyingSlots));
    }
    expect(stable()).toEqual(stableBefore);
    frame(SETTLED_SEC + REAPED_SEC + 0.3 + SETTLED_SEC);
    expect(slotsOfHost(buffers, 64).sort()).toEqual([...dyingSlots].sort());
    expect(slotsOfHost(buffers, 61)).toEqual(livingSlots);
    expect(bridgeStats.freeSlotsLast).toBe(0);
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
    expect(bridgeStats.fullWalkReasons.repaint).toBe(1);
    consumeUploads(buffers);

    // ...and it is a one-frame debt, not a new animation.
    frame(SETTLED_SEC + 0.2);
    expect(buffers.positions.updateRanges).toEqual([]);
  });

  it('marks the spans of the strokes a build moved and uploads no other', () => {
    build([1], 0);
    const buffers = bridgeBuffers();
    const settled = buffers.geometry.instanceCount;
    // The boot build: every stroke is a birth, so every span is admitted and
    // the whole prefix is what moved.
    expect(spans(buffers.positions, 6)).toEqual([{ start: 0, count: settled }]);
    expect(bridgeStats.uploadedBytesLastBuild).toBe(settled * 14 * 4);
    frame(SETTLED_SEC);
    consumeUploads(buffers);
    const stable = buffers.positions.array.slice(0, settled * 6);

    // ⭐ A build that moved a handful of strokes used to be a full walk: every
    // span re-written, the whole populated prefix re-uploaded, to move them.
    // Now the second host's births are admitted into spans of their own at
    // the end of the prefix, those spans are the frame's only marks, and the
    // first host's bytes are not touched.
    build([1, 2], SETTLED_SEC);
    const total = buffers.geometry.instanceCount;
    const admitted: Span = { start: settled, count: total - settled };
    expect(spans(buffers.positions, 6)).toEqual([admitted]);
    expect(spans(buffers.colors, 6)).toEqual([admitted]);
    expect(spans(buffers.widths, 2)).toEqual([admitted]);
    expect([...buffers.positions.array.slice(0, settled * 6)]).toEqual([...stable]);
    expect(bridgeStats.strokesWrittenLastBuild).toBe(admitted.count / FABRIC_SLOT_SEGMENTS);
    expect(bridgeStats.uploadedBytesLastBuild).toBe(admitted.count * 14 * 4);
    expect(bridgeStats.fullWalks).toBe(0);
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

describe('the bridge layer selects on a frame, never in the commit', () => {
  /** One completed build WITHOUT its frame, so the React commit can be looked
   *  at on its own — and with the owner's landed-version ref, which the
   *  helper above deliberately omits (a scene that publishes none has no
   *  fabric draining behind it, so its first frame runs the build). */
  function commit(
    ids: readonly number[],
    atSec: number,
    fabricLandedVersionRef: { current: number },
  ): void {
    cellsRef.current = cellsFor(ids);
    version += 1;
    resetSimClock(simClock, atSec);
    frames.callbacks.length = 0;
    const element = (
      <CellBridgeNerves
        cellsRef={cellsRef}
        passiveGraphRef={passiveGraphRef}
        version={version}
        fabricLandedVersionRef={fabricLandedVersionRef}
      />
    );
    if (view === null) view = render(element);
    else view.rerender(element);
  }

  it('holds the whole build until the drain lands the fabric it picks hosts by', () => {
    const select = vi.mocked(selectBridgeEdges);
    const landed = { current: -1 };
    commit([1], 0, landed);

    // ⭐ The commit is two ref writes. Not a host sync, not a selection, not a
    // reconcile — this is the 24–30 ms React scheduler task at every block,
    // and it is gone.
    expect(select).toHaveBeenCalledTimes(0);
    expect(bridgeStats.builds).toBe(0);

    // And the frames while the owner is still draining build 1's grows hold
    // it too: hosts are keyed on the DRAWN fabric, so selecting here would
    // read a fabric that is behind the staged Cells.
    frame(0.01);
    frame(0.02);
    expect(select).toHaveBeenCalledTimes(0);
    expect(bridgeStats.builds).toBe(0);

    // ⭐ The first frame after the drain finishes is step A — the host sync
    // alone. The selection is the class's largest single grain (5–23 ms live),
    // and it is not going to share a frame with the drain that just finished.
    landed.current = 1;
    frame(0.03);
    expect(select).toHaveBeenCalledTimes(0);
    expect(bridgeStats.builds).toBe(0);
    expect(bridgeBuffers().geometry.instanceCount).toBe(0);

    // Step B on the SECOND frame: the selection, and nothing it chose has
    // reached the layer yet.
    frame(0.04);
    expect(select).toHaveBeenCalledTimes(1);
    expect(bridgeStats.builds).toBe(0);
    expect(bridgeBuffers().geometry.instanceCount).toBe(0);

    // Step C on the third: the reconcile, and the strokes it moves are
    // admitted by the pass further down the SAME frame callback — which is
    // the invariant the split had to keep.
    frame(0.05);
    expect(bridgeStats.builds).toBe(1);
    expect(bridgeBuffers().geometry.instanceCount).toBeGreaterThan(0);

    // One sequence per build, not one step per frame from here on.
    frame(0.06);
    frame(0.07);
    expect(select).toHaveBeenCalledTimes(1);
    expect(bridgeStats.builds).toBe(1);
  });

  it('runs the newest build only, when one supersedes another mid-drain', () => {
    const select = vi.mocked(selectBridgeEdges);
    const landed = { current: -1 };
    commit([1], 0, landed);
    frame(0.01);
    expect(select).toHaveBeenCalledTimes(0);

    // Build 2 arrives before build 1's fabric drained. The arm is replaced,
    // so build 1's selection never runs at all — and nothing is lost by it:
    // the selection reads the CURRENT registry and drawn fabric, which is
    // build 2's, and that is what build 1's would have had to become.
    commit([1, 2], 0.02, landed);
    landed.current = 2;
    frame(0.02);
    frame(0.03);
    expect(select).toHaveBeenCalledTimes(1);
    frame(0.04);
    expect(bridgeStats.builds).toBe(1);
    expect(select.mock.results[0].value.bridges.some(
      (bridge: { cellId: number }) => bridge.cellId === 2,
    )).toBe(true);
  });

  it('restarts at the host sync when a newer arm lands mid-sequence', () => {
    // ⚠️ The one thing the sequence may never do is mix two builds: a
    // selection taken over one build's hosts and reconciled onto another
    // build's strokes is a layer of two versions. So a newer arm does not
    // resume where the older sequence stood — it starts again at step A.
    const select = vi.mocked(selectBridgeEdges);
    const landed = { current: -1 };
    commit([1], 0, landed);
    landed.current = 1;
    frame(0.01);
    expect(select).toHaveBeenCalledTimes(0);

    // Build 2 lands with build 1 one step in. Were the sequence resumed, this
    // frame would be step B and the selection would run now.
    commit([1, 2], 0.02, landed);
    landed.current = 2;
    frame(0.02);
    expect(select).toHaveBeenCalledTimes(0);

    // It is step A again, so the selection is on the frame after — once, over
    // the newer build's hosts.
    frame(0.03);
    expect(select).toHaveBeenCalledTimes(1);
    expect(select.mock.results[0].value.bridges.some(
      (bridge: { cellId: number }) => bridge.cellId === 2,
    )).toBe(true);
    frame(0.04);
    expect(bridgeStats.builds).toBe(1);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('yields the frame to the drain and the plan slice, and is never starved', () => {
    // The measured block frame: the drain and the live-plan slice have
    // already taken the frame's heavy budget, and the class's step is what
    // would turn it into three vsyncs. It waits — but not forever.
    const select = vi.mocked(selectBridgeEdges);
    const landed = { current: -1 };
    commit([1], 0, landed);
    landed.current = 1;

    for (let held = 0; held < 3; held += 1) {
      busyFrame(0.01 + held * 0.01);
      expect(bridgeStats.builds).toBe(0);
      expect(select).toHaveBeenCalledTimes(0);
    }
    // Held three frames in a row is as long as any consumer here may be held:
    // the fourth runs regardless, spent frame or not.
    busyFrame(0.04);
    // ...and the sequence proceeds from there, one step a frame.
    frame(0.05);
    expect(select).toHaveBeenCalledTimes(1);
    frame(0.06);
    expect(bridgeStats.builds).toBe(1);
  });
});

describe('the bridge layer runs the selection only for a build that moved a host', () => {
  it('skips the selection and the reconcile when nothing it reads moved', () => {
    const select = vi.mocked(selectBridgeEdges);
    build([1], 0);
    expect(select).toHaveBeenCalledTimes(1);
    const buffers = bridgeBuffers();
    frame(SETTLED_SEC);
    consumeUploads(buffers);

    // The same hosts, the same drawn fabric, a new version: the steady state
    // of a composed stage. Zero selection work — not a call, not a mark.
    build([1], SETTLED_SEC);
    build([1], SETTLED_SEC);
    expect(select).toHaveBeenCalledTimes(1);
    expect(bridgeStats.builds).toBe(3);
    expect(bridgeStats.selectionsSkipped).toBe(2);
    expect(bridgeStats.selectionsRun).toBe(1);
    expect(buffers.positions.updateRanges).toEqual([]);

    // A degree change the selection cannot see — a Cell that is not on the
    // stage at all — is not movement either.
    passiveGraphRef.current = {
      adjacency: new Map(),
      edges: [{ from: 900, to: 901, d: 1 }],
    };
    build([1], SETTLED_SEC);
    expect(select).toHaveBeenCalledTimes(1);
    expect(bridgeStats.selectionsSkipped).toBe(3);
  });

  it('re-selects for a moved host and lands where a from-scratch selection would', () => {
    const select = vi.mocked(selectBridgeEdges);
    build([1], 0);
    frame(SETTLED_SEC);

    // A host arrives.
    build([1, 2], SETTLED_SEC);
    expect(select).toHaveBeenCalledTimes(2);
    const index = actualBridgeEdges.buildBridgeAnchorIndex(placementFixture());
    const fresh = () => actualBridgeEdges.selectBridgeEdges(
      hostsOf(cellsRef.current, passiveGraphRef.current), index,
    ).bridges;
    expect(select.mock.results[1].value.bridges).toEqual(fresh());

    // A host's drawn-fabric degree moves: it is the same Cell, and the
    // selection reads it differently.
    passiveGraphRef.current = {
      adjacency: new Map(),
      edges: [{ from: 1, to: 2, d: 1 }],
    };
    build([1, 2], SETTLED_SEC + 0.1);
    expect(select).toHaveBeenCalledTimes(3);
    expect(select.mock.results[2].value.bridges).toEqual(fresh());
    // ...and the same fabric again is the steady state again.
    build([1, 2], SETTLED_SEC + 0.2);
    expect(select).toHaveBeenCalledTimes(3);

    // A host dies on the stage before it is collected: it stops hosting on
    // the build that sees the death, exactly as a fabric edge stops.
    const dead = { ...HOSTS.get(2)!, death_at_ms: 1 };
    build(new Map([[1, HOSTS.get(1)!], [2, dead]]), SETTLED_SEC + 0.3);
    expect(select).toHaveBeenCalledTimes(4);
    expect(select.mock.results[3].value.bridges).toEqual(fresh());
    expect(select.mock.results[3].value.bridges.every(
      (bridge: { cellId: number }) => bridge.cellId === 1,
    )).toBe(true);
  });
});

interface Step { ids: readonly number[] | Map<number, Cell>; atSec: number }

function cellsOf(step: Step): Map<number, Cell> {
  return step.ids instanceof Map ? step.ids : cellsFor(step.ids);
}

/** The oracle: the same builds replayed through the pure functions the layer
 *  is made of, then every surviving stroke drawn the way the old full walk
 *  drew it — settled, at its own final geometry. Compared as a sorted
 *  multiset of span contents, because WHERE the layer put a stroke is the
 *  layer's business and what the span contains is not. */
function reference(steps: readonly Step[], settleSec: number): string[] {
  const index = actualBridgeEdges.buildBridgeAnchorIndex(placementFixture());
  const strokes = new Map<string, BridgeStrokeState>();
  for (const step of steps) {
    const selection = actualBridgeEdges.selectBridgeEdges(
      hostsOf(cellsOf(step), passiveGraphRef.current), index,
    );
    reconcileBridgeStrokes(strokes, selection.bridges, step.atSec);
  }
  const positions = new Float32Array(FABRIC_SLOT_SEGMENTS * 6);
  const colors = new Float32Array(FABRIC_SLOT_SEGMENTS * 6);
  const widths = new Float32Array(FABRIC_SLOT_SEGMENTS * 2);
  const out: string[] = [];
  for (const stroke of strokes.values()) {
    const render = bridgeRenderState(stroke, settleSec);
    if (render.reap) continue;
    expect(render.animating).toBe(false);
    positions.fill(0);
    colors.fill(0);
    widths.fill(1);
    writeBridgeStroke(
      positions, colors, widths, 0, FABRIC_SLOT_SEGMENTS,
      stroke, render, LIVE.cell.fabricAlpha, LIVE.cell.centerDim,
      new Float32Array(3),
    );
    out.push(JSON.stringify([...positions, ...colors, ...widths]));
  }
  return out.sort();
}

describe('after every stroke settles, the layer holds exactly what a from-scratch layer would', () => {
  /** Drive the layer through the same steps and settle it. */
  function layerAfter(steps: readonly Step[], settleSec: number): BridgeBuffers {
    for (const step of steps) build(step.ids, step.atSec);
    frame(settleSec);
    frame(settleSec + 0.05);
    return bridgeBuffers();
  }

  const S = SETTLED_SEC;
  const R = REAPED_SEC;

  it('an unchanged build', () => {
    const steps: Step[] = [{ ids: [1, 2], atSec: 0 }, { ids: [1, 2], atSec: S }];
    const buffers = layerAfter(steps, 2 * S);
    const expected = reference(steps, 2 * S);
    expect(expected.length).toBeGreaterThan(0);
    expect(writtenBlocks(buffers)).toEqual(expected);
  });

  it('one added host', () => {
    const steps: Step[] = [{ ids: [1], atSec: 0 }, { ids: [1, 2], atSec: S }];
    const buffers = layerAfter(steps, 2 * S);
    const expected = reference(steps, 2 * S);
    expect(writtenBlocks(buffers)).toEqual(expected);
    // And it is strictly more than the first build drew.
    expect(expected.length).toBeGreaterThan(reference(steps.slice(0, 1), S).length);
  });

  it('one removed host, past its retract', () => {
    const steps: Step[] = [{ ids: [1, 2], atSec: 0 }, { ids: [1], atSec: S }];
    const buffers = layerAfter(steps, S + R);
    const expected = reference(steps, S + R);
    expect(writtenBlocks(buffers)).toEqual(expected);
    // The reaped strokes left holes, parked and excluded above — and the
    // prefix is not compacted for it.
    expect(blocks(buffers).some((block) => block.parked)).toBe(true);
    expect(blocks(buffers).length).toBe(reference(steps.slice(0, 1), S).length);
  });

  it('one host re-admitted in the middle of its retract', () => {
    const steps: Step[] = [
      { ids: [1, 2], atSec: 0 },
      { ids: [1], atSec: S },
      { ids: [1, 2], atSec: S + 0.3 },
    ];
    // Drive the retract a little way before the revival so the revived
    // strokes really were part-way withdrawn on screen.
    build(steps[0].ids, steps[0].atSec);
    frame(S);
    build(steps[1].ids, steps[1].atSec);
    frame(S + 0.15);
    const buffers = bridgeBuffers();
    expect(buffers.positions.updateRanges.length).toBeGreaterThan(0);
    build(steps[2].ids, steps[2].atSec);
    frame(S + 0.3 + S);
    frame(S + 0.3 + S + 0.05);
    const expected = reference(steps, S + 0.3 + S);
    expect(writtenBlocks(buffers)).toEqual(expected);
    // Revived, not reborn: the same strokes as the untouched pair.
    expect(expected).toEqual(reference([{ ids: [1, 2], atSec: 0 }], S));
    expect(blocks(buffers).some((block) => block.parked)).toBe(false);
  });
});

describe('the allocation overflow is the compaction, and it clips afterimages only', () => {
  /** Enough hosts to fill the live budget from this placement — every one
   *  within reach of the four anchors and at the rim's near-zero coverage. */
  function crowd(count: number, firstId: number): Map<number, Cell> {
    const cells = new Map<number, Cell>();
    for (let n = 0; n < count; n += 1) {
      const id = firstId + n;
      cells.set(id, cell(id, 58 + ((n * 7) % 100) / 10, -1.5 + ((n * 13) % 30) / 10));
    }
    return cells;
  }

  /** The stroke identities a from-scratch selection of a stage draws. With
   *  four anchors and the separation rule most hosts get one or two strokes,
   *  so the count is the oracle's, never assumed. */
  function selectedKeys(cells: Map<number, Cell>): Set<string> {
    const index = actualBridgeEdges.buildBridgeAnchorIndex(placementFixture());
    return new Set(actualBridgeEdges.selectBridgeEdges(
      hostsOf(cells, passiveGraphRef.current), index,
    ).bridges.map((bridge) => actualBridgeEdges.bridgeKey(bridge.cellId, bridge.anchorIndex)));
  }

  it('hands spans to living strokes first when live and dying strokes exceed the allocation', () => {
    const first = crowd(1000, 1000);
    const firstKeys = selectedKeys(first);
    build(first, 0);
    const buffers = bridgeBuffers();
    frame(SETTLED_SEC);
    expect(firstKeys.size).toBeGreaterThan(1000);
    expect(firstKeys.size).toBeLessThanOrEqual(BRIDGE_BUDGET);
    expect(writtenBlocks(buffers).length).toBe(firstKeys.size);
    expect(buffers.geometry.instanceCount).toBe(firstKeys.size * FABRIC_SLOT_SEGMENTS);
    expect(bridgeStats.fullWalks).toBe(0);

    // Swap out half the stage. The departing hosts' strokes retract in place
    // while the newcomers' births need spans of their own, and together they
    // exceed the 2,000-stroke allocation: the admission overflows and the
    // full walk compacts — living strokes first, so what the allocation
    // could not house is an afterimage, never live form.
    const swapped = new Map(first);
    let dropped = 0;
    for (const id of [...first.keys()]) {
      if (dropped >= 500) break;
      swapped.delete(id);
      dropped += 1;
    }
    for (const [id, c] of crowd(500, 5000)) swapped.set(id, c);
    const secondKeys = selectedKeys(swapped);
    const dying = [...firstKeys].filter((key) => !secondKeys.has(key)).length;
    const born = [...secondKeys].filter((key) => !firstKeys.has(key)).length;
    // The precondition this test is about: more strokes than spans.
    expect(secondKeys.size + dying).toBeGreaterThan(BRIDGE_ALLOCATION_BRIDGES);
    expect(born).toBeGreaterThan(0);

    build(swapped, SETTLED_SEC);
    expect(bridgeStats.fullWalkReasons.overflow).toBe(1);
    expect(bridgeStats.strokesMoved).toBe(firstKeys.size + dying + born);
    expect(buffers.geometry.instanceCount)
      .toBe(BRIDGE_ALLOCATION_BRIDGES * FABRIC_SLOT_SEGMENTS);
    frame(SETTLED_SEC + 0.3);
    // Every span is drawn: the live set in full, and as many afterimages as
    // the headroom holds.
    expect(blocks(buffers).filter((block) => !block.parked).length)
      .toBe(BRIDGE_ALLOCATION_BRIDGES);

    // Past the retract every afterimage is gone, the live set remains —
    // every stroke of it, byte-for-byte what a from-scratch layer holds — and
    // the holes are the spans the reaped afterimages gave back.
    const settleSec = SETTLED_SEC + SETTLED_SEC + REAPED_SEC;
    frame(settleSec);
    const settled = blocks(buffers);
    expect(settled.filter((block) => !block.parked).length).toBe(secondKeys.size);
    expect(settled.filter((block) => block.parked).length)
      .toBe(BRIDGE_ALLOCATION_BRIDGES - secondKeys.size);
    expect(writtenBlocks(buffers)).toEqual(reference(
      [{ ids: first, atSec: 0 }, { ids: swapped, atSec: SETTLED_SEC }],
      settleSec,
    ));
    consumeUploads(buffers);
    frame(settleSec + 0.1);
    expect(buffers.positions.updateRanges).toEqual([]);
  });
});
