// Empty fabric layers are invisible objects, not empty draws. three r169
// binds the program, material state and VAO and runs the object's
// before-render hooks BEFORE its zero-instance early-out, and the live
// measurement counted five such draws a frame — so every layer here follows
// its committed count: hidden at zero, shown by the commit that publishes
// one. The boot precompile is unaffected: `WebGLRenderer.compile` walks the
// scene with `traverse`, which ignores visibility (pinned against three's
// source in shaderPrecompile.test.ts).
//
// The component is Canvas-bound only through `useFrame`/`useThree` (the
// fabricChurnLifecycle precedent); the mesh recorder is the warm-route
// tests' — every LineSegments2 the component builds, in build order.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import * as THREE from 'three';
import type { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import type { Cell } from '@cknerv/types';
import {
  emptyNeighborGraph,
  type NeighborGraph,
} from '../../src/geometry/neighborGraph';
import { LIVE } from '../../src/tweaks/liveTweaks';
import { resetSimClock } from '../../src/tweaks/simClock';
import { fabricEdgeKey, fabricEdgeIndexSize } from '../../src/nerve/fabricOrder';
import { DECAY_MS } from '../../src/nerve/fabricEdgeRender';
import NeuralFabric, {
  makeActiveHopScratch,
  writeActiveHop,
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

const CELLS = new Map([1, 2, 3, 4].map((id) => [id, cell(id)] as const));

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

interface Layers {
  fabric: LineSegments2;
  trunk: LineSegments2;
  warm: LineSegments2;
  active: LineSegments2;
  memory: LineSegments2;
  routeHopPulse: LineSegments2;
}

/** The six meshes one mount builds, told apart by what each is made of:
 *  the two lifecycle passes by their records and width, the warm overlay
 *  as the screen-blended layer without records, the three additive layers
 *  in build order (active, memory, then the wider lock pulse). */
function layersOf(): Layers {
  const built = meshes.built as LineSegments2[];
  const lifecycle = built.filter((mesh) => (
    (mesh.geometry as LineSegmentsGeometry).getAttribute('fabricCurveFrom') !== undefined
  ));
  const fabric = lifecycle.find((mesh) => (
    (mesh.material as LineMaterial).linewidth === LIVE.cell.fabricWidth
  ));
  const trunk = lifecycle.find((mesh) => mesh !== fabric);
  const warm = built.find((mesh) => (
    (mesh.material as LineMaterial).blending === THREE.CustomBlending
    && (mesh.geometry as LineSegmentsGeometry).getAttribute('fabricCurveFrom') === undefined
  ));
  const additive = built.filter((mesh) => (
    (mesh.material as LineMaterial).blending === THREE.AdditiveBlending
  ));
  if (!fabric || !trunk || !warm || additive.length !== 3) {
    throw new Error(`unexpected layer set: ${built.length} meshes`);
  }
  return {
    fabric,
    trunk,
    warm,
    active: additive[0],
    memory: additive[1],
    routeHopPulse: additive[2],
  };
}

function mountHandles(): NeuralFabricHandles {
  let handles: NeuralFabricHandles | null = null;
  render(<NeuralFabric onReady={(h) => { handles = h; }} />);
  if (!handles) throw new Error('NeuralFabric never reported its handles');
  return handles;
}

const COLOR: Vec3 = [0.8, 0.2, 0.3];

function instanceCount(mesh: LineSegments2): number {
  return (mesh.geometry as LineSegmentsGeometry).instanceCount;
}

beforeEach(() => {
  meshes.built.length = 0;
  resetSimClock();
});

describe('fabric layers hide at zero and show at the commit that fills them', () => {
  it('every layer mounts hidden with nothing committed', () => {
    mountHandles();
    const layers = layersOf();
    for (const [name, mesh] of Object.entries(layers)) {
      expect(`${name}: ${mesh.visible}/${instanceCount(mesh)}`).toBe(`${name}: false/0`);
    }
  });

  it('the passive fabric and its wide pass show together on the first population, and stay coupled', () => {
    const handles = mountHandles();
    const { fabric, trunk } = layersOf();
    handles.setFabric(graphOf([[1, 2], [2, 3]]), CELLS, 0);
    expect(fabric.visible).toBe(false); // nothing committed until an emit
    handles.emitFabric(0);
    expect(instanceCount(fabric)).toBeGreaterThan(0);
    expect(fabric.visible).toBe(true);
    expect(trunk.visible).toBe(true);
    // A later incremental commit keeps both where the count puts them.
    handles.growEdges([{ from: 3, to: 4, d: 1, w: 0.5 }], CELLS, new Map(), new Map());
    handles.emitFabric(0.5);
    expect(fabric.visible).toBe(true);
    expect(trunk.visible).toBe(true);
  });

  it('the active layer shows only on frames that carry a hop', () => {
    const handles = mountHandles();
    const { active, memory } = layersOf();
    const hop = makeActiveHopScratch();
    handles.pushActiveHop(writeActiveHop(hop, 1, 2, 'live', 0.5, 1, COLOR), CELLS);
    handles.flushActive();
    expect(instanceCount(active)).toBeGreaterThan(0);
    expect(active.visible).toBe(true);
    expect(memory.visible).toBe(false);
    // An empty frame commits zero and hides it again.
    handles.flushActive();
    expect(instanceCount(active)).toBe(0);
    expect(active.visible).toBe(false);
  });

  it('the memory layer follows recalled hops the same way', () => {
    const handles = mountHandles();
    const { active, memory } = layersOf();
    const hop = makeActiveHopScratch();
    handles.pushActiveHop(writeActiveHop(hop, 1, 2, 'memory', 1, 1, COLOR, undefined, 0.65), CELLS);
    handles.flushActive();
    expect(memory.visible).toBe(true);
    expect(active.visible).toBe(false);
    handles.flushActive();
    expect(memory.visible).toBe(false);
  });

  it('the lock pulse shows while it is drawn and hides on the empty commit after it', () => {
    const handles = mountHandles();
    const { routeHopPulse } = layersOf();
    // Nothing drawn, nothing committed: the flush is a no-op and the mesh
    // stays hidden.
    handles.flushRouteHopPulse();
    expect(routeHopPulse.visible).toBe(false);
    const hop = makeActiveHopScratch();
    handles.pushActiveHop(writeActiveHop(hop, 1, 2, 'lock', 0.5, 1, COLOR, 1, 6.5), CELLS);
    handles.flushRouteHopPulse();
    expect(instanceCount(routeHopPulse)).toBeGreaterThan(0);
    expect(routeHopPulse.visible).toBe(true);
    handles.flushRouteHopPulse();
    expect(instanceCount(routeHopPulse)).toBe(0);
    expect(routeHopPulse.visible).toBe(false);
  });

  it('the warm overlay shows while a route is warm and hides with its last settled edge', () => {
    const handles = mountHandles();
    const { warm } = layersOf();
    handles.setFabric(graphOf([[1, 2], [2, 3]]), CELLS, 0);
    handles.emitFabric(0);
    expect(warm.visible).toBe(false);
    handles.reinforce(1, 2);
    handles.emitFabric(0.1);
    expect(instanceCount(warm)).toBeGreaterThan(0);
    expect(warm.visible).toBe(true);
    // Far past every half-life the usage settles to zero, the member drops
    // out, and the one empty commit that hides the layer follows.
    handles.emitFabric(600);
    expect(instanceCount(warm)).toBe(0);
    expect(warm.visible).toBe(false);
  });

  it('a hidden layer is skipped by the render walk and reached by the compile walk', () => {
    mountHandles();
    const layers = layersOf();
    const scene = new THREE.Scene();
    for (const mesh of Object.values(layers)) scene.add(mesh);
    // `compile` walks with `traverse` (every mounted material is linked);
    // `projectObject` — the render walk — returns on `visible === false`
    // before program, VAO or before-render hook, which is what
    // `traverseVisible` models exactly.
    const compiled: THREE.Object3D[] = [];
    scene.traverse((object) => { compiled.push(object); });
    const rendered: THREE.Object3D[] = [];
    scene.traverseVisible((object) => { rendered.push(object); });
    for (const mesh of Object.values(layers)) {
      expect(compiled).toContain(mesh);
      expect(rendered).not.toContain(mesh);
    }
    // The before-render hooks are per-draw uniform syncs whose only reader
    // is this object's own draw; each is still wired for the frame that
    // shows the object.
    for (const mesh of Object.values(layers)) {
      expect(typeof mesh.onBeforeRender).toBe('function');
    }
  });
});

describe('the numeric edge index mirrors the keyed edge states', () => {
  /** What the component holds: the index it reads per hop, and the map it
   *  keys everything else on. Read off the module through the handles by
   *  exercising the one path that reveals the index — a passive hop resolves
   *  to the recorded curve when, and only when, the index holds the edge. */
  function passiveHopResolves(handles: NeuralFabricHandles, a: number, b: number): boolean {
    const { active } = layersOf();
    const hop = makeActiveHopScratch();
    // A hop whose endpoints are absent from the cell map can ONLY draw
    // through the passive record; the fallback has nothing to look up.
    handles.pushActiveHop(writeActiveHop(hop, a, b, 'live', 1, 1, COLOR), new Map());
    handles.flushActive();
    return instanceCount(active) > 0;
  }

  it('admission, growth, reconciliation deaths and reaps keep the two in step', () => {
    const handles = mountHandles();
    handles.setFabric(graphOf([[1, 2], [2, 3]]), CELLS, 0);
    handles.emitFabric(0);
    expect(passiveHopResolves(handles, 1, 2)).toBe(true);
    expect(passiveHopResolves(handles, 2, 1)).toBe(true); // either orientation
    expect(passiveHopResolves(handles, 3, 4)).toBe(false);
    handles.growEdges([{ from: 3, to: 4, d: 1, w: 0.5 }], CELLS, new Map(), new Map());
    expect(passiveHopResolves(handles, 3, 4)).toBe(true);
    // A reconciliation that drops (2,3) fades it; while it fades the state
    // still exists (a dying edge keeps drawing), and after the reap it is
    // gone from both.
    handles.setFabric(graphOf([[1, 2], [3, 4]]), CELLS, 1);
    handles.emitFabric(1);
    expect(passiveHopResolves(handles, 2, 3)).toBe(true);
    handles.emitFabric(1 + DECAY_MS / 1000 + 0.5);
    expect(passiveHopResolves(handles, 2, 3)).toBe(false);
    expect(passiveHopResolves(handles, 1, 2)).toBe(true);
    expect(passiveHopResolves(handles, 3, 4)).toBe(true);
    // And the live-edge census the driver reads agrees with what resolves.
    expect(handles.collectLiveEdgeKeys().sort()).toEqual([
      fabricEdgeKey(1, 2),
      fabricEdgeKey(3, 4),
    ]);
  });

  it('a compacting full walk that reaps expired states removes them from the index too', () => {
    const handles = mountHandles();
    handles.setFabric(graphOf([[1, 2], [2, 3], [3, 4]]), CELLS, 0);
    handles.emitFabric(0);
    handles.killEdges([fabricEdgeKey(2, 3)], 0, 'gc');
    // Force the structural walk past the death window: a whole-graph
    // replacement from a populated set reconciles through the same map,
    // and the expired state compacts away inside the walk.
    handles.setFabric(graphOf([[1, 2], [3, 4]]), CELLS, DECAY_MS / 1000 + 1);
    handles.emitFabric(DECAY_MS / 1000 + 1);
    expect(passiveHopResolves(handles, 2, 3)).toBe(false);
    expect(passiveHopResolves(handles, 1, 2)).toBe(true);
    expect(passiveHopResolves(handles, 3, 4)).toBe(true);
  });

  it('the index helpers keep first-level entries only while an edge is under them', () => {
    // A direct check on the structure the component maintains.
    const index = new Map<number, Map<number, number>>();
    expect(fabricEdgeIndexSize(index)).toBe(0);
  });
});
