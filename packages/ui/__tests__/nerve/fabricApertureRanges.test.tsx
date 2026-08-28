// One emitFabric can reach the lifecycle colour buffer twice: the recall
// aperture bakes its dim into the colour records' .w lanes, and the event flush
// marks the handful of slots an admit/kill/revival rewrote. Both paths clear
// before they mark, so whoever runs last decides what the renderer actually
// uploads — and a block's churn burst arriving mid-recall is the ordinary case,
// not a corner.
//
// The constraint these tests pin: the bake's mark set COVERS every slot the
// flush would have marked — indexed aperture candidates, previously dimmed
// slots being restored, and the flush's own slots folded into one range set —
// while curve and scalar keep their slot ranges. Single-path frames must look
// exactly as they always did.
//
// And what it must NOT be is the whole prefix on every frame of a hold: a recall
// dims a bounded disc for 2-5 s, and the slots outside it hold the same 1.0 the
// GPU already has.
//
// The component is Canvas-bound only through `useFrame`/`useThree` (the
// fabricChurnLifecycle precedent), and the passive fabric is the only layer
// built on the screen-space capsule, so intercepting that factory hands the
// test the very buffers the renderer reads.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { InstancedInterleavedBuffer, InterleavedBufferAttribute } from 'three';
import type { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Cell } from '@cknerv/types';
import {
  emptyNeighborGraph,
  type NeighborGraph,
} from '../../src/geometry/neighborGraph';
import { fabricEdgeKey } from '../../src/nerve/fabricOrder';
import {
  CONSENSUS_MEMORY_APERTURE_INNER_RADIUS,
  CONSENSUS_MEMORY_APERTURE_OUTER_RADIUS,
  type ConsensusMemoryAperture,
} from '../../src/nerve/consensusMemoryAperture';
import {
  FABRIC_LIFE_APERTURE_END_OFFSET,
  FABRIC_LIFE_APERTURE_START_OFFSET,
  FABRIC_LIFE_COLOR_STRIDE,
  FABRIC_LIFE_CURVE_STRIDE,
  FABRIC_LIFE_SCALAR_STRIDE,
} from '../../src/nerve/fabricLifecycleSlots';
import { FABRIC_SLOT_SEGMENTS } from '../../src/nerve/fabricSlots';
import { FABRIC_APERTURE_UPLOAD_POLICY } from '../../src/nerve/fabricLifecycleSlots';
import { fabricStats, resetFabricStats } from '../../src/nerve/fabricStats';
import { resetSimClock } from '../../src/tweaks/simClock';
import NeuralFabric, {
  type NeuralFabricHandles,
} from '../../src/nerve/NeuralFabric';

vi.mock('@react-three/fiber', () => ({
  useFrame: () => {},
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

function cell(id: number): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [id, 0, 0],
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

function cellsFor(ids: readonly number[]): Map<number, Cell> {
  return new Map(ids.map((id) => [id, cell(id)]));
}

function graphOf(pairs: ReadonlyArray<readonly [number, number]>): NeighborGraph {
  const graph = emptyNeighborGraph();
  for (const [from, to] of pairs) {
    graph.edges.push({ from, to, d: Math.abs(to - from), w: 0.5 });
    if (!graph.adjacency.has(from)) graph.adjacency.set(from, new Set());
    if (!graph.adjacency.has(to)) graph.adjacency.set(to, new Set());
    graph.adjacency.get(from)!.add(to);
    graph.adjacency.get(to)!.add(from);
  }
  return graph;
}

interface LifecycleBuffers {
  curve: InstancedInterleavedBuffer;
  color: InstancedInterleavedBuffer;
  scalar: InstancedInterleavedBuffer;
}

/** The three lifecycle buffers of the mounted passive fabric, read off the
 *  geometry the component bound them to. */
function lifecycleBuffers(): LifecycleBuffers {
  for (const geometry of capsules.geometries) {
    const color = geometry.getAttribute(
      'fabricColorFrom',
    ) as InterleavedBufferAttribute | undefined;
    if (!color) continue;
    return {
      curve: (geometry.getAttribute(
        'fabricCurveFrom',
      ) as InterleavedBufferAttribute).data as InstancedInterleavedBuffer,
      color: color.data as InstancedInterleavedBuffer,
      scalar: (geometry.getAttribute(
        'fabricLifecycle',
      ) as InterleavedBufferAttribute).data as InstancedInterleavedBuffer,
    };
  }
  throw new Error('no lifecycle geometry was built');
}

interface SlotRange { start: number; count: number }

/** Update ranges read back in SLOT units — what the commits actually mean,
 *  independent of how wide each buffer's record happens to be. */
function slotRanges(
  buffer: InstancedInterleavedBuffer,
  stride: number,
): SlotRange[] {
  return buffer.updateRanges.map(({ start, count }) => ({
    start: start / stride / FABRIC_SLOT_SEGMENTS,
    count: count / stride / FABRIC_SLOT_SEGMENTS,
  }));
}

/** Stand in for the renderer, which clears an attribute's ranges as it
 *  uploads them. Every assertion below is therefore about ONE frame's marks. */
function consumeUploads(buffers: LifecycleBuffers): void {
  buffers.curve.clearUpdateRanges();
  buffers.color.clearUpdateRanges();
  buffers.scalar.clearUpdateRanges();
}

function mountFabric(allocationEdges?: number): NeuralFabricHandles {
  let handles: NeuralFabricHandles | null = null;
  render(
    <NeuralFabric
      allocationEdges={allocationEdges}
      onReady={(ready) => { handles = ready; }}
    />,
  );
  if (handles === null) throw new Error('NeuralFabric never handed over handles');
  return handles;
}

const SLOTS = 4;
const GRAPH = graphOf([[1, 2], [2, 3], [3, 4], [4, 5]]);
const CELLS = cellsFor([1, 2, 3, 4, 5]);
/** renderOrder follows the graph's own edge order, so this pair owns slot 1. */
const CHURNED_EDGE = fabricEdgeKey(2, 3);
const CHURNED_SLOT: SlotRange = { start: 1, count: 1 };
const FULL_PREFIX: SlotRange = { start: 0, count: SLOTS };

/** Both aperture lanes of every segment of one slot, undimmed. */
const BASELINE_LANES = new Array(FABRIC_SLOT_SEGMENTS * 2).fill(1);
const FULL_LIFECYCLE_BYTES_PER_SLOT = FABRIC_SLOT_SEGMENTS * 4 * (
  FABRIC_LIFE_CURVE_STRIDE
  + FABRIC_LIFE_COLOR_STRIDE
  + FABRIC_LIFE_SCALAR_STRIDE
);

/** The recall dim as the shader will read it: each segment's start and end
 *  aperture lane, in slot order. 1 is untouched passive fabric. */
function apertureLanes(
  buffers: LifecycleBuffers,
  slot: number,
): number[] {
  const array = buffers.color.array;
  const lanes: number[] = [];
  for (let segment = 0; segment < FABRIC_SLOT_SEGMENTS; segment += 1) {
    const offset = (slot * FABRIC_SLOT_SEGMENTS + segment)
      * FABRIC_LIFE_COLOR_STRIDE;
    lanes.push(array[offset + FABRIC_LIFE_APERTURE_START_OFFSET]);
    lanes.push(array[offset + FABRIC_LIFE_APERTURE_END_OFFSET]);
  }
  return lanes;
}

interface ProbedAperture {
  field: ConsensusMemoryAperture;
  /** Spatial-hash lookups this field has served. One per sample that survives
   *  the bounding-box prefilter — so it reads the prefilter directly. */
  queries: () => number;
}

/**
 * One straight tessellated segment along z = 0, bucketed exactly the way
 * `deriveConsensusMemoryAperture` buckets its own: every grid column the
 * segment's extent reaches once dilated by the outer radius. Hand-building it
 * is what lets a test place the aperture's reach and slide its temporal window
 * across the frame clock, and what lets it count the queries it serves.
 */
function straightAperture(
  ax: number,
  bx: number,
  opensAtSec: number,
  closesAtSec: number,
): ProbedAperture {
  const grid = CONSENSUS_MEMORY_APERTURE_OUTER_RADIUS;
  const buckets = new Map<number, ReadonlyMap<number, readonly number[]>>();
  const minGridX = Math.floor((Math.min(ax, bx) - grid) / grid);
  const maxGridX = Math.floor((Math.max(ax, bx) + grid) / grid);
  for (let gridX = minGridX; gridX <= maxGridX; gridX += 1) {
    const zBuckets = new Map<number, readonly number[]>();
    for (let gridZ = -1; gridZ <= 1; gridZ += 1) zBuckets.set(gridZ, [0]);
    buckets.set(gridX, zBuckets);
  }
  let queries = 0;
  const lookUp = buckets.get.bind(buckets);
  buckets.get = (key: number) => {
    queries += 1;
    return lookUp(key);
  };
  return {
    field: {
      segments: [{
        ax,
        az: 0,
        bx,
        bz: 0,
        traversals: [{
          opensAtStartSec: opensAtSec,
          opensAtEndSec: opensAtSec,
          routeProgressStart: 0,
          routeProgressEnd: 1,
          routeProgressFeather: 1,
          collapseStartsAtSec: closesAtSec,
          collapseEndsAtSec: closesAtSec,
        }],
      }],
      buckets,
      edgeCount: 1,
      gridSize: grid,
      innerRadius: CONSENSUS_MEMORY_APERTURE_INNER_RADIUS,
      outerRadius: CONSENSUS_MEMORY_APERTURE_OUTER_RADIUS,
      temporalStartsAtSec: opensAtSec,
      temporalEndsAtSec: closesAtSec,
    },
    queries: () => queries,
  };
}

/** Two edges the width of the galaxy apart: an aperture can only ever reach
 *  one of them, which is what the prefilter is for. */
const SPAN_GRAPH = graphOf([[1, 2], [900, 901]]);
const SPAN_CELLS = cellsFor([1, 2, 900, 901]);
const NEAR_SLOT = 0;
const FAR_SLOT = 1;
/** Every sample of one reachable slot: its start point plus each segment end. */
const SAMPLES_PER_SLOT = FABRIC_SLOT_SEGMENTS + 1;

/** A settled fabric: slots assigned by the boot full walk, nothing pending. */
function bootedFabric(): { handles: NeuralFabricHandles; buffers: LifecycleBuffers } {
  const handles = mountFabric();
  handles.setFabric(GRAPH, CELLS, 40);
  handles.emitFabric(40);
  const buffers = lifecycleBuffers();
  expect(slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE))
    .toEqual([FULL_PREFIX]);
  consumeUploads(buffers);
  return { handles, buffers };
}

beforeEach(() => {
  capsules.geometries.length = 0;
  resetFabricStats();
  resetSimClock();
});

describe('fabric lifecycle update ranges — one frame, two commits', () => {
  it('a churn-only frame marks the dirty slot and nothing else', () => {
    const { handles, buffers } = bootedFabric();

    handles.killEdges([CHURNED_EDGE], 40.1, 'gc');
    handles.emitFabric(40.1);

    expect(slotRanges(buffers.curve, FABRIC_LIFE_CURVE_STRIDE))
      .toEqual([CHURNED_SLOT]);
    expect(slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE))
      .toEqual([CHURNED_SLOT]);
    expect(slotRanges(buffers.scalar, FABRIC_LIFE_SCALAR_STRIDE))
      .toEqual([CHURNED_SLOT]);
  });

  it('a recall-only frame marks the whole populated colour prefix', () => {
    const { handles, buffers } = bootedFabric();

    handles.setRecallAperture(
      straightAperture(0, 20, 39, 60).field, 1, null, 0,
    );
    handles.emitFabric(40.1);

    expect(slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE))
      .toEqual([FULL_PREFIX]);
    // The bake writes aperture lanes only; the records themselves are untouched.
    expect(buffers.curve.updateRanges).toEqual([]);
    expect(buffers.scalar.updateRanges).toEqual([]);
  });

  it('a recall holding through churn keeps the prefix the flush would have erased', () => {
    const { handles, buffers } = bootedFabric();

    handles.setRecallAperture(
      straightAperture(0, 20, 39, 60).field, 1, null, 0,
    );
    handles.killEdges([CHURNED_EDGE], 40.1, 'gc');
    const colorVersion = buffers.color.version;
    handles.emitFabric(40.1);

    // The aperture's prefix is a superset of the dirty slot's colour range, so
    // it — not the slot range — is what must survive to the GPU.
    expect(slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE))
      .toEqual([FULL_PREFIX]);
    // ...and it is flagged, so the ranges are read rather than left standing.
    expect(buffers.color.version).toBeGreaterThan(colorVersion);
    // The other two buffers are the flush's alone, at slot resolution.
    expect(slotRanges(buffers.curve, FABRIC_LIFE_CURVE_STRIDE))
      .toEqual([CHURNED_SLOT]);
    expect(slotRanges(buffers.scalar, FABRIC_LIFE_SCALAR_STRIDE))
      .toEqual([CHURNED_SLOT]);
  });

  it('the release frame restores the 1.0 baseline everywhere even under churn', () => {
    const { handles, buffers } = bootedFabric();

    // Frame 1: the recall holds.
    handles.setRecallAperture(
      straightAperture(0, 20, 39, 60).field, 1, null, 0,
    );
    handles.emitFabric(40.1);
    consumeUploads(buffers);

    // Frame 2: the recall is gone. Every slot was genuinely dimmed, so the
    // previous-dim set happens to cover the whole prefix in this fixture.
    handles.setRecallAperture(null, 0, null, 0);
    handles.killEdges([CHURNED_EDGE], 40.2, 'gc');
    handles.emitFabric(40.2);

    expect(slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE))
      .toEqual([FULL_PREFIX]);
    expect(slotRanges(buffers.curve, FABRIC_LIFE_CURVE_STRIDE))
      .toEqual([CHURNED_SLOT]);
  });
});

describe('recall aperture ownership across a structural full walk', () => {
  it('re-bakes an active recall into the final compacted records before the full upload', () => {
    const handles = mountFabric();
    handles.setFabric(GRAPH, CELLS, 40);
    handles.setRecallAperture(
      straightAperture(0, 20, 44, 48).field, 1, null, 0,
    );
    const uploadedBefore = fabricStats.uploadedBytes;

    // Boot is a structural full walk, and all admissions also left static
    // lifeDirty records pending. Neither may replace the aperture lanes after
    // the NEW slot index has been baked.
    handles.emitFabric(45);
    const buffers = lifecycleBuffers();

    expect(Math.max(...apertureLanes(buffers, 0))).toBeLessThan(1);
    expect(slotRanges(buffers.curve, FABRIC_LIFE_CURVE_STRIDE))
      .toEqual([FULL_PREFIX]);
    expect(slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE))
      .toEqual([FULL_PREFIX]);
    expect(slotRanges(buffers.scalar, FABRIC_LIFE_SCALAR_STRIDE))
      .toEqual([FULL_PREFIX]);
    // One full static upload owns all three buffers. An earlier partial
    // aperture commit would inflate this by at least one colour slot.
    expect(fabricStats.uploadedBytes - uploadedBefore)
      .toBe(SLOTS * FULL_LIFECYCLE_BYTES_PER_SLOT);
  });

  it('keeps the rewritten baseline on release without a partial colour claim', () => {
    const handles = mountFabric(1); // three lifecycle slots
    const cells = cellsFor([1, 2, 3, 4, 5]);
    handles.setFabric(graphOf([[1, 2]]), cells, 40);
    handles.emitFabric(40);
    const buffers = lifecycleBuffers();
    consumeUploads(buffers);

    handles.setRecallAperture(
      straightAperture(0, 20, 44, 48).field, 1, null, 0,
    );
    handles.emitFabric(45);
    expect(Math.max(...apertureLanes(buffers, 0))).toBeLessThan(1);
    consumeUploads(buffers);

    handles.setRecallAperture(null, 0, null, 0);
    // Two admissions fit; the third leaves a lifeDirty/static backlog and
    // forces compaction. The full walk's baseline is already the release
    // answer, so no old-slot restore pass should claim colour first.
    handles.growEdges(
      [
        { from: 2, to: 3, d: 1, w: 0.5 },
        { from: 3, to: 4, d: 1, w: 0.5 },
        { from: 4, to: 5, d: 1, w: 0.5 },
      ],
      cells,
      new Map(),
      new Map(),
    );
    const uploadedBefore = fabricStats.uploadedBytes;
    handles.emitFabric(45.1);

    const compactedPrefix = [{ start: 0, count: 3 }];
    expect(slotRanges(buffers.curve, FABRIC_LIFE_CURVE_STRIDE))
      .toEqual(compactedPrefix);
    expect(slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE))
      .toEqual(compactedPrefix);
    expect(slotRanges(buffers.scalar, FABRIC_LIFE_SCALAR_STRIDE))
      .toEqual(compactedPrefix);
    for (let slot = 0; slot < 3; slot += 1) {
      expect(apertureLanes(buffers, slot)).toEqual(BASELINE_LANES);
    }
    expect(fabricStats.uploadedBytes - uploadedBefore)
      .toBe(3 * FULL_LIFECYCLE_BYTES_PER_SLOT);
  });
});

// A recall is one moving edge and a long stillness. The bake has to follow the
// first exactly; on the second the lanes it would write are the lanes already
// there, and a frame that re-derives them re-derives ~32 k Bezier samples and
// re-uploads the whole colour prefix to say nothing.
describe('recall aperture bake — what a still frame owes', () => {
  it('a hold the trace clock has left stops baking and stops uploading', () => {
    const { handles, buffers } = bootedFabric();
    // A window that closed before the frames below: the recall is still up,
    // but no point in the world can be dimmed by it any more.
    const recall = straightAperture(0, 20, 41, 42);

    // Frame 1: the recall state moved, so it is evaluated once.
    handles.setRecallAperture(recall.field, 0.6, null, 0);
    handles.emitFabric(45);
    expect(buffers.color.updateRanges).toEqual([]);
    consumeUploads(buffers);

    // Frame 2: nothing moved and nothing can. Not one mark, not one byte.
    const uploaded = fabricStats.uploadedBytes;
    handles.emitFabric(45.1);
    expect(buffers.color.updateRanges).toEqual([]);
    expect(buffers.curve.updateRanges).toEqual([]);
    expect(buffers.scalar.updateRanges).toEqual([]);
    expect(fabricStats.uploadedBytes).toBe(uploaded);

    // Frame 3: churn during the same stillness. The bake never ran, so it
    // never claimed the colour prefix, and the flush owns that buffer again
    // exactly as it does on any frame with no recall at all.
    handles.killEdges([CHURNED_EDGE], 45.2, 'gc');
    handles.emitFabric(45.2);
    expect(slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE))
      .toEqual([CHURNED_SLOT]);
    expect(slotRanges(buffers.curve, FABRIC_LIFE_CURVE_STRIDE))
      .toEqual([CHURNED_SLOT]);
    expect(slotRanges(buffers.scalar, FABRIC_LIFE_SCALAR_STRIDE))
      .toEqual([CHURNED_SLOT]);
  });

  it('a frame inside the trace window bakes even when the caller passed nothing new', () => {
    const { handles, buffers } = bootedFabric();
    const recall = straightAperture(0, 20, 44, 48);

    handles.setRecallAperture(recall.field, 0.6, null, 0);
    handles.emitFabric(45);
    consumeUploads(buffers);

    // Same fields, same strengths — but the wavefront is inside its window, so
    // the output is the clock's to move and the bake must follow it.
    handles.emitFabric(45.1);
    expect(slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE))
      .toEqual([FULL_PREFIX]);
  });

  it('a strength change outside the trace window owes no upload', () => {
    const { handles, buffers } = bootedFabric();
    const recall = straightAperture(0, 20, 41, 42);

    handles.setRecallAperture(recall.field, 0.6, null, 0);
    handles.emitFabric(45);
    consumeUploads(buffers);
    handles.emitFabric(45.1);
    expect(buffers.color.updateRanges).toEqual([]);

    handles.setRecallAperture(recall.field, 0.9, null, 0);
    handles.emitFabric(45.2);
    expect(buffers.color.updateRanges).toEqual([]);
  });

  it('a slot admitted mid-hold carries the lanes a bake would have given it', () => {
    const { handles, buffers } = bootedFabric();
    const recall = straightAperture(0, 20, 41, 42);

    handles.setRecallAperture(recall.field, 0.6, null, 0);
    handles.emitFabric(45);
    consumeUploads(buffers);

    // The new edge's record write puts the 1.0 baseline in its aperture lanes,
    // and with the aperture unable to dim anything that IS the bake's answer —
    // which is why the skip survives a slot arriving under it.
    const grown = fabricEdgeKey(5, 6);
    handles.growEdges(
      [{ from: 5, to: 6, d: 1, w: 0.5 }],
      cellsFor([5, 6]),
      new Map([[grown, 45.1]]),
      new Map(),
    );
    handles.emitFabric(45.1);

    expect(apertureLanes(buffers, SLOTS)).toEqual(BASELINE_LANES);
    expect(slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE))
      .toEqual([{ start: SLOTS, count: 1 }]);
  });

  it('a release restores the baseline exactly once, then says nothing', () => {
    const { handles, buffers } = bootedFabric();
    const recall = straightAperture(0, 20, 44, 48);

    // Every booted cell sits on the route, so every slot is genuinely dimmed.
    handles.setRecallAperture(recall.field, 1, null, 0);
    handles.emitFabric(45);
    expect(Math.max(...apertureLanes(buffers, 0))).toBeLessThan(1);
    consumeUploads(buffers);

    handles.setRecallAperture(null, 0, null, 0);
    handles.emitFabric(45.1);
    expect(slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE))
      .toEqual([FULL_PREFIX]);
    expect(apertureLanes(buffers, 0)).toEqual(BASELINE_LANES);
    consumeUploads(buffers);

    const uploaded = fabricStats.uploadedBytes;
    handles.emitFabric(45.2);
    handles.emitFabric(45.3);
    expect(buffers.color.updateRanges).toEqual([]);
    expect(fabricStats.uploadedBytes).toBe(uploaded);
  });

  it('a dim the trace clock outlives is lifted once, by the frame after the window', () => {
    const { handles, buffers } = bootedFabric();
    // The recall stays up across all three frames; only the window closes.
    const recall = straightAperture(0, 20, 44, 46);

    handles.setRecallAperture(recall.field, 1, null, 0);
    handles.emitFabric(45);
    expect(Math.max(...apertureLanes(buffers, 0))).toBeLessThan(1);
    consumeUploads(buffers);

    // Past the window nothing is dimmed any more, so the lanes owe one last
    // pass back to the baseline — the caller passed nothing new to say so.
    handles.emitFabric(47);
    expect(slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE))
      .toEqual([FULL_PREFIX]);
    expect(apertureLanes(buffers, 0)).toEqual(BASELINE_LANES);
    consumeUploads(buffers);

    const uploaded = fabricStats.uploadedBytes;
    handles.emitFabric(47.1);
    expect(buffers.color.updateRanges).toEqual([]);
    expect(fabricStats.uploadedBytes).toBe(uploaded);
  });

  it('a dimming frame uploads the box neighbourhood, not the colour prefix', () => {
    const handles = mountFabric();
    handles.setFabric(SPAN_GRAPH, SPAN_CELLS, 40);
    handles.emitFabric(40);
    const buffers = lifecycleBuffers();
    consumeUploads(buffers);

    // A window the frame clock is INSIDE: the dim is moving, so the bake has
    // to run — and this is the whole 2-5 s of a recall, not a corner.
    const far = straightAperture(890, 910, 39, 60);
    handles.setRecallAperture(far.field, 1, null, 0);
    handles.emitFabric(41);

    expect(slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE))
      .toEqual([{ start: FAR_SLOT, count: 1 }]);
    expect(Math.max(...apertureLanes(buffers, FAR_SLOT))).toBeLessThan(1);
    expect(apertureLanes(buffers, NEAR_SLOT)).toEqual(BASELINE_LANES);
  });

  it('a slot the aperture moves off is uploaded back, once', () => {
    const handles = mountFabric();
    handles.setFabric(SPAN_GRAPH, SPAN_CELLS, 40);
    handles.emitFabric(40);
    const buffers = lifecycleBuffers();
    consumeUploads(buffers);

    handles.setRecallAperture(straightAperture(890, 910, 39, 60).field, 1, null, 0);
    handles.emitFabric(41);
    consumeUploads(buffers);

    // The recall jumps to the other end of the galaxy. The far slot is out of
    // the new box entirely, so nothing about THIS frame's geometry would send
    // it — only the memory that the last bake dimmed it.
    handles.setRecallAperture(straightAperture(0, 20, 39, 60).field, 1, null, 0);
    handles.emitFabric(41.1);
    expect(slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE))
      .toEqual([{ start: NEAR_SLOT, count: 2 }]);
    expect(apertureLanes(buffers, FAR_SLOT)).toEqual(BASELINE_LANES);
    consumeUploads(buffers);

    // Once given back, it stays given back: the range narrows to the box.
    handles.emitFabric(41.2);
    expect(slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE))
      .toEqual([{ start: NEAR_SLOT, count: 1 }]);
  });

  it('release restores only slots the previous bake actually dimmed', () => {
    const handles = mountFabric();
    handles.setFabric(SPAN_GRAPH, SPAN_CELLS, 40);
    handles.emitFabric(40);
    const buffers = lifecycleBuffers();
    consumeUploads(buffers);

    handles.setRecallAperture(
      straightAperture(890, 910, 39, 60).field, 1, null, 0,
    );
    handles.emitFabric(41);
    expect(Math.max(...apertureLanes(buffers, FAR_SLOT))).toBeLessThan(1);
    expect(apertureLanes(buffers, NEAR_SLOT)).toEqual(BASELINE_LANES);
    consumeUploads(buffers);

    handles.setRecallAperture(null, 0, null, 0);
    handles.emitFabric(41.1);
    expect(slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE))
      .toEqual([{ start: FAR_SLOT, count: 1 }]);
    expect(apertureLanes(buffers, FAR_SLOT)).toEqual(BASELINE_LANES);
    expect(apertureLanes(buffers, NEAR_SLOT)).toEqual(BASELINE_LANES);
  });

  it('a dimming bake carries the flush colour slots inside its own ranges', () => {
    const handles = mountFabric();
    handles.setFabric(SPAN_GRAPH, SPAN_CELLS, 40);
    handles.emitFabric(40);
    const buffers = lifecycleBuffers();
    consumeUploads(buffers);

    // The recall reaches only the far slot; the churn is on the near one. Two
    // disjoint claims on one buffer — the bake owns it, so it must carry both.
    handles.setRecallAperture(straightAperture(890, 910, 39, 60).field, 1, null, 0);
    handles.killEdges([fabricEdgeKey(1, 2)], 41, 'gc');
    handles.emitFabric(41);

    expect(slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE))
      .toEqual([{ start: NEAR_SLOT, count: 2 }]);
    expect(slotRanges(buffers.curve, FABRIC_LIFE_CURVE_STRIDE))
      .toEqual([{ start: NEAR_SLOT, count: 1 }]);
    expect(slotRanges(buffers.scalar, FABRIC_LIFE_SCALAR_STRIDE))
      .toEqual([{ start: NEAR_SLOT, count: 1 }]);
  });

  it('only slots the aperture can reach are sampled; the rest go to baseline', () => {
    const handles = mountFabric();
    handles.setFabric(SPAN_GRAPH, SPAN_CELLS, 40);
    handles.emitFabric(40);
    const buffers = lifecycleBuffers();
    consumeUploads(buffers);

    // Frame 1: an aperture around the far pair only.
    const far = straightAperture(890, 910, 39, 60);
    handles.setRecallAperture(far.field, 1, null, 0);
    handles.emitFabric(41);
    expect(Math.max(...apertureLanes(buffers, FAR_SLOT))).toBeLessThan(1);
    expect(apertureLanes(buffers, NEAR_SLOT)).toEqual(BASELINE_LANES);
    // The rejected slot cost four compares, not five spatial-hash queries.
    expect(far.queries()).toBe(SAMPLES_PER_SLOT);

    // Frame 2: the aperture is now around the near pair. The far slot has to
    // come back to the baseline, and nothing remembers that it was dimmed —
    // writing baseline for everything outside the box is what restores it.
    const near = straightAperture(0, 20, 39, 60);
    handles.setRecallAperture(near.field, 1, null, 0);
    handles.emitFabric(41.1);
    expect(apertureLanes(buffers, FAR_SLOT)).toEqual(BASELINE_LANES);
    expect(Math.max(...apertureLanes(buffers, NEAR_SLOT))).toBeLessThan(1);
    expect(near.queries()).toBe(SAMPLES_PER_SLOT);
    expect(far.queries()).toBe(SAMPLES_PER_SLOT);
  });
});

// The colour lanes are the cheapest upload in the scene (128 B a slot, one
// call a range) and the one that recurs every frame of a recall. Slot order is
// spatially random in the app, so a dimmed disc is a scattered slot set; the
// merge bridges a parked gap only while it costs less than the call it saves,
// and must never mark a slot the bake left alone unless it sits inside such a
// gap. The oracle below is the strongest statement of correctness there is:
// every float the frame changed lies inside a marked range.
describe('recall aperture ranges under the lane policy', () => {
  const EDGES = 400;
  function longGraph(): NeighborGraph {
    const pairs: [number, number][] = [];
    for (let i = 1; i <= EDGES; i += 1) pairs.push([i, i + 1]);
    return graphOf(pairs);
  }
  const ids = Array.from({ length: EDGES + 1 }, (_, i) => i + 1);

  function changedSlots(before: ArrayLike<number>, after: ArrayLike<number>): Set<number> {
    const slots = new Set<number>();
    for (let i = 0; i < after.length; i += 1) {
      if (before[i] !== after[i]) {
        slots.add(Math.floor(i / FABRIC_LIFE_COLOR_STRIDE / FABRIC_SLOT_SEGMENTS));
      }
    }
    return slots;
  }
  function inRanges(ranges: SlotRange[], slot: number): boolean {
    return ranges.some((r) => slot >= r.start && slot < r.start + r.count);
  }

  it('two dimmed discs far apart in slot space are two ranges, priced per slot', () => {
    const handles = mountFabric();
    handles.setFabric(longGraph(), cellsFor(ids), 40);
    handles.emitFabric(40);
    const buffers = lifecycleBuffers();
    consumeUploads(buffers);

    // One field around x∈[0,2] (slot 0's neighbourhood), one around
    // x∈[300,302] (slot ~299's): the union box reaches every slot, the dim
    // reaches two clusters ~300 slots apart — far past the 32-slot bridge.
    handles.setRecallAperture(
      straightAperture(0, 2, 39, 60).field, 1,
      straightAperture(300, 302, 39, 60).field, 1,
    );
    const before = buffers.color.array.slice();
    handles.emitFabric(41);
    const after = buffers.color.array;

    const ranges = slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].start).toBe(0);
    expect(ranges[1].start).toBeGreaterThan(
      ranges[0].start + ranges[0].count + FABRIC_APERTURE_UPLOAD_POLICY.gapMaxSlots,
    );
    // Every slot the bake changed is marked, and the marks stop at the hull.
    const changed = changedSlots(before, after);
    expect(changed.size).toBeGreaterThan(2);
    for (const slot of changed) expect(inRanges(ranges, slot), `slot ${slot}`).toBe(true);
    const last = ranges[ranges.length - 1];
    expect(last.start + last.count).toBeLessThanOrEqual(Math.max(...changed) + 1);
    expect(ranges[0].start).toBeGreaterThanOrEqual(Math.min(...changed));
    // Bytes: the marked slots at 128 B each — not the whole 400-slot prefix.
    const markedSlots = ranges.reduce((sum, r) => sum + r.count, 0);
    expect(fabricStats.uploadedBytesLast)
      .toBe(markedSlots * FABRIC_APERTURE_UPLOAD_POLICY.bytesPerSlot);
    expect(markedSlots).toBeLessThan(EDGES / 4);
  });

  it('a churn burst under a scattered recall folds into the bake\'s ranges, still slot-priced', () => {
    const handles = mountFabric();
    handles.setFabric(longGraph(), cellsFor(ids), 40);
    handles.emitFabric(40);
    const buffers = lifecycleBuffers();
    consumeUploads(buffers);

    handles.setRecallAperture(straightAperture(300, 302, 39, 60).field, 1, null, 0);
    // A kill on slot 150: nowhere near the dim, so it is its own range on
    // the colour buffer the bake owns this frame, and the flush's own two
    // buffers mark that slot alone.
    handles.killEdges([fabricEdgeKey(151, 152)], 41, 'gc');
    const before = buffers.color.array.slice();
    handles.emitFabric(41);

    const colour = slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE);
    expect(colour.length).toBeGreaterThanOrEqual(2);
    expect(inRanges(colour, 150)).toBe(true);
    for (const slot of changedSlots(before, buffers.color.array)) {
      expect(inRanges(colour, slot), `slot ${slot}`).toBe(true);
    }
    expect(slotRanges(buffers.curve, FABRIC_LIFE_CURVE_STRIDE))
      .toEqual([{ start: 150, count: 1 }]);
    expect(slotRanges(buffers.scalar, FABRIC_LIFE_SCALAR_STRIDE))
      .toEqual([{ start: 150, count: 1 }]);
  });
});
