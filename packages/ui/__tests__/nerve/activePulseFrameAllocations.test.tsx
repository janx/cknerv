// The active-pulse frame at storm size, measured for garbage. A block storm
// walks up to MAX_ACTIVE_PULSES packets × (head + TRAIL_HOPS) hops through
// `pushActiveHop` every frame, and the review measured 12–15 MB/s of steady
// garbage at idle with the hop path as one named source: a fresh hop object
// per call and a `${lo}|${hi}` key string per hop per frame. This pins the
// repaired path at zero bytes per hop and keeps the number visible.
//
// Bytes are read off `process.memoryUsage().heapUsed` between two forced
// collections with the run sized well under the young generation, so no
// scavenge can land inside the window and the delta IS the allocation. That
// needs `--expose-gc` (`NODE_OPTIONS=--expose-gc pnpm vitest run ...`); a run
// without it keeps the structural assertions and skips the byte ones.
//
// The component is Canvas-bound only through `useFrame`/`useThree` (the
// fabricChurnLifecycle precedent), so a mocked r3f holds real handles.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import * as THREE from 'three';
import type { InterleavedBufferAttribute } from 'three';
import type { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import type { Cell } from '@cknerv/types';
import {
  emptyNeighborGraph,
  type NeighborGraph,
} from '../../src/geometry/neighborGraph';
import { resetSimClock } from '../../src/tweaks/simClock';
import NeuralFabric, {
  makeActiveHopScratch,
  writeActiveHop,
  type ActiveHop,
  type NeuralFabricHandles,
} from '../../src/nerve/NeuralFabric';
import type { Vec3 } from '../../src/types';

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

const gc: (() => void) | undefined = (globalThis as { gc?: () => void }).gc;

beforeEach(() => {
  meshes.built.length = 0;
});

function cell(id: number): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [id * 1.7, (id % 7) * 0.3, (id % 11) * 1.1],
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

/** A chain of passive edges (i, i+1) over `count` cells, half of which the
 *  synthetic frame rides (the passive path) — the other half of its hops
 *  cross pairs the selection never admitted (the fallback path). */
function fixture(count: number): {
  cells: Map<number, Cell>;
  graph: NeighborGraph;
} {
  const cells = new Map<number, Cell>();
  for (let id = 1; id <= count; id += 1) cells.set(id, cell(id));
  const graph = emptyNeighborGraph();
  for (let id = 1; id < count; id += 1) {
    graph.edges.push({ from: id, to: id + 1, d: 1.7, w: 0.5 });
  }
  return { cells, graph };
}

function mountHandles(): NeuralFabricHandles {
  let handles: NeuralFabricHandles | null = null;
  render(<NeuralFabric onReady={(h) => { handles = h; }} />);
  if (!handles) throw new Error('NeuralFabric never reported its handles');
  return handles;
}

const COLOR: Vec3 = [0.9, 0.3, 0.4];
/** Hops per synthetic frame. The active layer holds 6,000 segments at 12
 *  samples a hop, so 400 hops keep every hop on the full sampling path
 *  (a saturated layer returns before it resolves a curve). */
const HOPS_PER_FRAME = 400;
/** The storm the review sized: MAX_ACTIVE_PULSES × (head + TRAIL_HOPS). */
const STORM_HOPS = 256 * 7;

interface FrameDriver {
  name: string;
  frame(): void;
}

/** One frame of today's call pattern, before the scratch existed: a fresh
 *  hop literal per call, exactly as the pulse walk wrote them. */
function literalFrames(
  handles: NeuralFabricHandles,
  cells: Map<number, Cell>,
): FrameDriver {
  return {
    name: 'literal hop objects',
    frame() {
      for (let i = 0; i < HOPS_PER_FRAME; i += 1) {
        const from = 1 + (i * 3) % 300;
        const to = i % 2 === 0 ? from + 1 : from + 2;
        // A fully lit hop: every sample of every hop reaches the segment
        // writer. (An integer front keeps the caller's own argument boxing
        // out of a measurement that is about the callee.)
        handles.pushActiveHop({
          fromCellId: from,
          toCellId: to,
          mode: 'live',
          frontT: 1,
          brightness: 1.5,
          color: COLOR,
        }, cells);
      }
      handles.flushActive();
    },
  };
}

/** The same frame through one reused scratch hop. */
function scratchFrames(
  handles: NeuralFabricHandles,
  cells: Map<number, Cell>,
): FrameDriver {
  const scratch: ActiveHop = makeActiveHopScratch();
  return {
    name: 'scratch hop object',
    frame() {
      for (let i = 0; i < HOPS_PER_FRAME; i += 1) {
        const from = 1 + (i * 3) % 300;
        const to = i % 2 === 0 ? from + 1 : from + 2;
        handles.pushActiveHop(writeActiveHop(
          scratch,
          from,
          to,
          'live',
          1,
          1.5,
          COLOR,
        ), cells);
      }
      handles.flushActive();
    },
  };
}

/** Bytes allocated per frame, the young generation left untouched inside
 *  the window (30 frames of even the literal pattern stay far under the
 *  16 MB semi-space). The warm-up is long enough for the optimizing tier to
 *  own the whole path: a baseline tier boxes every double it passes, and
 *  that garbage is the tier's, not the path's. */
function bytesPerFrame(driver: FrameDriver, frames = 30): number {
  for (let i = 0; i < 120; i += 1) driver.frame(); // warm the JIT
  gc!();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < frames; i += 1) driver.frame();
  const after = process.memoryUsage().heapUsed;
  return (after - before) / frames;
}

describe('active pulse frame allocations', () => {
  it('the scratch hop is one object, rewritten in place, optional lanes reset', () => {
    const scratch = makeActiveHopScratch();
    const ghost: Vec3 = [1, 2, 3];
    const first = writeActiveHop(scratch, 1, 2, 'live', 0.5, 2, COLOR, -1, 0.4, ghost, ghost);
    expect(first).toBe(scratch);
    expect(first).toEqual({
      fromCellId: 1,
      toCellId: 2,
      mode: 'live',
      frontT: 0.5,
      brightness: 2,
      color: COLOR,
      direction: -1,
      tailDecay: 0.4,
      fromPos: ghost,
      toPos: ghost,
    });
    // A later hop that names no direction, tail or ghost must not inherit
    // the previous hop's — the optional lanes are part of every write.
    const second = writeActiveHop(scratch, 3, 4, 'memory', 1, 1, COLOR);
    expect(second).toBe(scratch);
    expect(second.direction).toBeUndefined();
    expect(second.tailDecay).toBeUndefined();
    expect(second.fromPos).toBeUndefined();
    expect(second.toPos).toBeUndefined();
    expect(second.mode).toBe('memory');
  });

  it('draws the same segments whether the hop arrived as a literal or the scratch', () => {
    resetSimClock();
    const { cells, graph } = fixture(320);
    const handles = mountHandles();
    handles.setFabric(graph, cells, 0);
    handles.emitFabric(0);
    // Both drivers write into the same active layer; compare the layer's
    // populated prefix after one frame of each (flushActive resets the
    // count but leaves the bytes, so the prefix IS the frame).
    const literal = literalFrames(handles, cells);
    const scratch = scratchFrames(handles, cells);
    const read = (): { positions: Float32Array; colors: Float32Array } => {
      const active = activeLayer();
      return {
        positions: active.positions.slice(),
        colors: active.colors.slice(),
      };
    };
    literal.frame();
    const a = read();
    scratch.frame();
    const b = read();
    expect(b.positions).toEqual(a.positions);
    expect(b.colors).toEqual(a.colors);
    expect(a.positions.some((v) => v !== 0)).toBe(true);
  });

  it('allocates nothing per hop on the repaired path (bytes visible)', () => {
    resetSimClock();
    const { cells, graph } = fixture(320);
    const handles = mountHandles();
    handles.setFabric(graph, cells, 0);
    handles.emitFabric(0);
    if (!gc) {
      // eslint-disable-next-line no-console
      console.log('active pulse frame allocations: run with NODE_OPTIONS=--expose-gc for bytes');
      return;
    }
    const literal = bytesPerFrame(literalFrames(handles, cells));
    const scratch = bytesPerFrame(scratchFrames(handles, cells));
    const perHop = (bytes: number): number => bytes / HOPS_PER_FRAME;
    // eslint-disable-next-line no-console
    console.log(
      `active pulse frame allocations (${HOPS_PER_FRAME} hops/frame): `
      + `literal ${literal.toFixed(0)} B/frame (${perHop(literal).toFixed(1)} B/hop, `
      + `${(perHop(literal) * STORM_HOPS / 1024).toFixed(1)} KB per ${STORM_HOPS}-hop storm frame); `
      + `scratch ${scratch.toFixed(0)} B/frame (${perHop(scratch).toFixed(1)} B/hop, `
      + `${(perHop(scratch) * STORM_HOPS / 1024).toFixed(1)} KB per storm frame)`,
    );
    // Per hop the path allocates nothing: the resolver builds no key string,
    // the layer writer touches typed arrays only, and the scratch is the
    // caller's. What remains is per FRAME — the two update-range records
    // each commit pushes (`addUpdateRange`), well under a kilobyte — so the
    // bound is stated per frame, and against the literal pattern.
    expect(scratch).toBeLessThan(2048);
    expect(scratch).toBeLessThan(literal / 10);
  });
});

/** The active layer's stock lanes: the first additive layer the component
 *  builds (active, then memory, then the wider lock pulse). */
function activeLayer(): { positions: Float32Array; colors: Float32Array } {
  const mesh = (meshes.built as LineSegments2[]).find((built) => (
    (built.material as LineMaterial).blending === THREE.AdditiveBlending
  ));
  if (!mesh) throw new Error('no active layer was built');
  const geometry = mesh.geometry as LineSegmentsGeometry;
  const positions = (geometry.getAttribute('instanceStart') as InterleavedBufferAttribute)
    .data.array as Float32Array;
  const colors = (geometry.getAttribute('instanceColorStart') as InterleavedBufferAttribute)
    .data.array as Float32Array;
  return { positions, colors };
}
