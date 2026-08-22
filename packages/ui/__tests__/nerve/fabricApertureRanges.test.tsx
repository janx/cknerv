// One emitFabric can reach the lifecycle colour buffer twice: the recall
// aperture bakes its dim into the colour records' .w lanes and marks the whole
// populated prefix, and the event flush marks the handful of slots an
// admit/kill/revival rewrote. Both paths clear before they mark, so whoever
// runs last decides what the renderer actually uploads — and a block's churn
// burst arriving mid-recall is the ordinary case, not a corner.
//
// The constraint these tests pin: the aperture's prefix is a SUPERSET of every
// slot's colour range, so on a collision frame the surviving colour ranges must
// be the prefix, while curve and scalar keep their slot ranges. Single-path
// frames must look exactly as they always did.
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
  FABRIC_LIFE_COLOR_STRIDE,
  FABRIC_LIFE_CURVE_STRIDE,
  FABRIC_LIFE_SCALAR_STRIDE,
} from '../../src/nerve/fabricLifecycleSlots';
import { FABRIC_SLOT_SEGMENTS } from '../../src/nerve/fabricSlots';
import { resetFabricStats } from '../../src/nerve/fabricStats';
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

function mountFabric(): NeuralFabricHandles {
  let handles: NeuralFabricHandles | null = null;
  render(<NeuralFabric onReady={(ready) => { handles = ready; }} />);
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

    handles.setRecallAperture(null, 0.5, null, 0);
    handles.emitFabric(40.1);

    expect(slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE))
      .toEqual([FULL_PREFIX]);
    // The bake writes aperture lanes only; the records themselves are untouched.
    expect(buffers.curve.updateRanges).toEqual([]);
    expect(buffers.scalar.updateRanges).toEqual([]);
  });

  it('a recall holding through churn keeps the prefix the flush would have erased', () => {
    const { handles, buffers } = bootedFabric();

    handles.setRecallAperture(null, 0.5, null, 0);
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
    handles.setRecallAperture(null, 0.5, null, 0);
    handles.emitFabric(40.1);
    consumeUploads(buffers);

    // Frame 2: the recall is gone. This is the ONE pass that writes the
    // baseline back over every slot — losing its range sticks the dim on
    // every edge the churn did not touch.
    handles.setRecallAperture(null, 0, null, 0);
    handles.killEdges([CHURNED_EDGE], 40.2, 'gc');
    handles.emitFabric(40.2);

    expect(slotRanges(buffers.color, FABRIC_LIFE_COLOR_STRIDE))
      .toEqual([FULL_PREFIX]);
    expect(slotRanges(buffers.curve, FABRIC_LIFE_CURVE_STRIDE))
      .toEqual([CHURNED_SLOT]);
  });
});
