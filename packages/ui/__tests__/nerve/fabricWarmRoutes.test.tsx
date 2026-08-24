// The warm-route overlay is the fabric family's only per-frame CPU sampler:
// a pulse crossing marks an edge warm, and from then until its usage settles
// the layer re-samples and re-uploads that edge every frame. Half of those
// bytes were positions, and positions are a function of nine numbers
// snapshotted at birth plus an interval that moves only while a tendril grows
// or a dead end retracts — so on a decay frame they are last frame's bytes.
//
// What these tests pin: colours go up while anything decays, positions only
// when the packed membership moves or a member is still animating, the deep
// tail quantizes its upload without quantizing its decay, and the last edge to
// settle still hides the layer with exactly one empty commit.
//
// The component is Canvas-bound only through `useFrame`/`useThree` (the
// fabricChurnLifecycle precedent). The warm overlay is the one screen-blended
// layer with no GPU lifecycle records, which is how the mesh recorder below
// tells it from its four siblings.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import * as THREE from 'three';
import type { InstancedInterleavedBuffer, InterleavedBufferAttribute } from 'three';
import type { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import type { Cell } from '@cknerv/types';
import {
  emptyNeighborGraph,
  type NeighborGraph,
} from '../../src/geometry/neighborGraph';
import { FABRIC_SAMPLES_PER_EDGE } from '../../src/nerve/fabricCapacity';
import {
  REINFORCE_AMOUNT,
  USAGE_DECAY_HALF_LIFE_S,
  USAGE_EPSILON,
  WARM_TAIL_COMMIT_INTERVAL_S,
  WARM_TAIL_USAGE,
} from '../../src/nerve/fabricReinforce';
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

const meshes = vi.hoisted(() => ({ built: [] as unknown[] }));

vi.mock('three/examples/jsm/lines/LineSegments2.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('three/examples/jsm/lines/LineSegments2.js')
  >();
  class RecordedLineSegments2 extends actual.LineSegments2 {
    constructor(geometry?: LineSegmentsGeometry, material?: LineMaterial) {
      super(geometry, material);
      meshes.built.push(this);
    }
  }
  return { ...actual, LineSegments2: RecordedLineSegments2 };
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

const CELLS = new Map([1, 2, 3].map((id) => [id, cell(id)] as const));

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

const GRAPH = graphOf([[1, 2], [2, 3]]);

interface WarmLayer {
  positions: InstancedInterleavedBuffer;
  colors: InstancedInterleavedBuffer;
  geometry: LineSegmentsGeometry;
}

/** The warm overlay's own buffers: the one screen-blended layer whose geometry
 *  carries no lifecycle records (the passive fabric and its wide twin do). */
function warmLayer(): WarmLayer {
  for (const built of meshes.built) {
    const mesh = built as LineSegments2;
    const geometry = mesh.geometry as LineSegmentsGeometry;
    const material = mesh.material as LineMaterial;
    if (material.blending !== THREE.CustomBlending) continue;
    if (geometry.getAttribute('fabricCurveFrom')) continue;
    return {
      positions: (geometry.getAttribute(
        'instanceStart',
      ) as InterleavedBufferAttribute).data as InstancedInterleavedBuffer,
      colors: (geometry.getAttribute(
        'instanceColorStart',
      ) as InterleavedBufferAttribute).data as InstancedInterleavedBuffer,
      geometry,
    };
  }
  throw new Error('no warm-route layer was built');
}

/** Stand in for the renderer, which clears an attribute's ranges as it uploads
 *  them. Every assertion below is therefore about ONE frame's marks. */
function consumeUploads(layer: WarmLayer): void {
  layer.positions.clearUpdateRanges();
  layer.colors.clearUpdateRanges();
}

function mountFabric(): NeuralFabricHandles {
  let handles: NeuralFabricHandles | null = null;
  render(<NeuralFabric onReady={(ready) => { handles = ready; }} />);
  if (handles === null) throw new Error('NeuralFabric never handed over handles');
  return handles;
}

/** A settled fabric at t = 42: booted at 40, every edge past its grow window
 *  (GROWTH_MS), nothing pending, the warm overlay still empty. */
function settledFabric(): { handles: NeuralFabricHandles; warm: WarmLayer } {
  const handles = mountFabric();
  handles.setFabric(GRAPH, CELLS, 40);
  handles.emitFabric(40);
  handles.emitFabric(42);
  const warm = warmLayer();
  expect(warm.geometry.instanceCount).toBe(0);
  consumeUploads(warm);
  return { handles, warm };
}

beforeEach(() => {
  meshes.built.length = 0;
  resetFabricStats();
  resetSimClock();
});

describe('warm-route overlay — what a decaying frame owes the GPU', () => {
  it('a first crossing uploads endpoints and colours together', () => {
    const { handles, warm } = settledFabric();

    handles.reinforce(1, 2);
    handles.emitFabric(42.1);

    expect(warm.geometry.instanceCount).toBe(FABRIC_SAMPLES_PER_EDGE);
    expect(warm.positions.updateRanges).toEqual([
      { start: 0, count: FABRIC_SAMPLES_PER_EDGE * 6 },
    ]);
    expect(warm.colors.updateRanges).toEqual([
      { start: 0, count: FABRIC_SAMPLES_PER_EDGE * 6 },
    ]);
    // Both lanes, metered — the layer used to upload megabytes invisibly.
    expect(fabricStats.uploadedBytesLast).toBe(FABRIC_SAMPLES_PER_EDGE * 12 * 4);
  });

  it('a decay-only frame marks colours and leaves the endpoints alone', () => {
    const { handles, warm } = settledFabric();

    handles.reinforce(1, 2);
    handles.emitFabric(42.1);
    consumeUploads(warm);

    // Nothing joined, nothing left, nothing is animating: brightness is the
    // only thing about this stroke that a frame can change.
    handles.emitFabric(42.2);
    expect(warm.colors.updateRanges).toEqual([
      { start: 0, count: FABRIC_SAMPLES_PER_EDGE * 6 },
    ]);
    expect(warm.positions.updateRanges).toEqual([]);
    expect(fabricStats.uploadedBytesLast).toBe(FABRIC_SAMPLES_PER_EDGE * 6 * 4);
  });

  it('a second crossing joining the packed prefix re-sends the endpoints', () => {
    const { handles, warm } = settledFabric();

    handles.reinforce(1, 2);
    handles.emitFabric(42.1);
    consumeUploads(warm);
    handles.emitFabric(42.2);
    consumeUploads(warm);

    // A new member appends its own segments; re-warming one already in the
    // set moves nothing, so only the first of these two arms the lane.
    handles.reinforce(2, 3);
    handles.emitFabric(42.3);
    expect(warm.geometry.instanceCount).toBe(FABRIC_SAMPLES_PER_EDGE * 2);
    expect(warm.positions.updateRanges).toEqual([
      { start: 0, count: FABRIC_SAMPLES_PER_EDGE * 2 * 6 },
    ]);
    consumeUploads(warm);

    handles.reinforce(2, 3);
    handles.emitFabric(42.4);
    expect(warm.positions.updateRanges).toEqual([]);
    expect(warm.colors.updateRanges).not.toEqual([]);
  });

  it('a member still inside its grow window keeps its endpoints moving', () => {
    const handles = mountFabric();
    handles.setFabric(GRAPH, CELLS, 40);
    handles.emitFabric(40);
    const warm = warmLayer();
    consumeUploads(warm);

    // Born at 40, so at 40.4 the tendril is a third extended and every
    // sample along it lands somewhere new next frame.
    handles.reinforce(1, 2);
    handles.emitFabric(40.4);
    consumeUploads(warm);

    handles.emitFabric(40.5);
    expect(warm.positions.updateRanges).toEqual([
      { start: 0, count: FABRIC_SAMPLES_PER_EDGE * 6 },
    ]);
  });

  it('the last edge to settle hides the layer with one empty commit', () => {
    const { handles, warm } = settledFabric();

    handles.reinforce(1, 2);
    handles.emitFabric(42.1);
    consumeUploads(warm);

    // Far past the tail: usage snaps to zero, the set empties, and the layer
    // has to be taken off screen.
    handles.emitFabric(80);
    expect(warm.geometry.instanceCount).toBe(0);
    expect(warm.positions.updateRanges).toEqual([]);
    expect(warm.colors.updateRanges).toEqual([]);

    // ...and then it owes nothing at all, frame after frame.
    const uploaded = fabricStats.uploadedBytes;
    handles.emitFabric(80.1);
    handles.emitFabric(80.2);
    expect(warm.geometry.instanceCount).toBe(0);
    expect(warm.colors.updateRanges).toEqual([]);
    expect(fabricStats.uploadedBytes).toBe(uploaded);
  });

  it('quantizes the deep tail without quantizing the decay', () => {
    const { handles, warm } = settledFabric();
    handles.reinforce(1, 2);

    // usage(t) = REINFORCE_AMOUNT · 2^(-(t-42)/halfLife). The band the
    // quantizer owns, and the second the edge is due to leave the set.
    const tailEntersAt = 42 + USAGE_DECAY_HALF_LIFE_S
      * Math.log2(REINFORCE_AMOUNT / WARM_TAIL_USAGE);
    const settlesAt = 42 + USAGE_DECAY_HALF_LIFE_S
      * Math.log2(REINFORCE_AMOUNT / USAGE_EPSILON);
    const frame = 1 / 60;

    let tailFrames = 0;
    let tailCommits = 0;
    let settledAt: number | null = null;
    for (let t = 42 + frame; t < settlesAt + 1 && settledAt === null; t += frame) {
      handles.emitFabric(t);
      if (t > tailEntersAt) {
        tailFrames += 1;
        if (warm.colors.updateRanges.length > 0) tailCommits += 1;
      }
      consumeUploads(warm);
      if (warm.geometry.instanceCount === 0) settledAt = t;
    }

    // Decay is bookkeeping and ran on every one of those frames: the edge
    // leaves the warm set on the frame the closed form says it does.
    expect(settledAt).not.toBeNull();
    expect((settledAt ?? 0) - settlesAt).toBeGreaterThanOrEqual(0);
    expect((settledAt ?? 0) - settlesAt).toBeLessThan(frame);
    // Upload is presentation, and in the tail it runs at ~10 Hz.
    expect(tailFrames).toBeGreaterThan(300);
    expect(tailCommits).toBeLessThan(
      (settlesAt - tailEntersAt) / WARM_TAIL_COMMIT_INTERVAL_S + 4,
    );
  });
});
