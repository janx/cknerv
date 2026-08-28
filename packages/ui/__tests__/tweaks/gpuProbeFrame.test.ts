// A whole frame of every scoped draw, both ways round: with sampling off it
// must be free — no clock read, no GL call, no allocation — and with sampling
// on every label must sample, the scene bracket must sample on its own
// frames, and the two must never overlap.
import { describe, expect, it, vi } from 'vitest';
import { getHeapSpaceStatistics } from 'node:v8';
import * as THREE from 'three';
import {
  GPU_FRAME_BRACKET_PERIOD,
  PERFORMANCE_PROBE_LABELS,
  advanceGpuProbeFrame,
  gpuProbeFrameMode,
  isPerformanceProbeEnabled,
  readGpuFrameLedger,
  resetPerformanceProbe,
  retainPerformanceProbe,
  snapshotPerformanceProbe,
} from '../../src/tweaks/performanceProbeStore';
import {
  attachGpuFrameBracket,
  attachGpuTimerQueryContext,
  beginGpuFrameBracket,
  beginGpuProbe,
  createGpuProbeCallbacks,
  pollGpuTimerQueries,
} from '../../src/tweaks/gpuTimerQuery';
import { createNonEmptyDrawGpuProbeCallbacks } from '../../src/tweaks/nonEmptyGpuProbeCallbacks';
import { FakeTimerQueryContext } from '../fixtures/fakeTimerQueryContext';

/** Every per-draw label this task installed, one physical draw each. */
const DRAW_LABELS = [
  PERFORMANCE_PROBE_LABELS.cellBody,
  PERFORMANCE_PROBE_LABELS.cellFlare,
  PERFORMANCE_PROBE_LABELS.cellNucleusGlow,
  PERFORMANCE_PROBE_LABELS.cellNucleusCore,
  PERFORMANCE_PROBE_LABELS.cellNucleusNodes,
  PERFORMANCE_PROBE_LABELS.bridgeNerves,
  PERFORMANCE_PROBE_LABELS.colonyHaze,
  PERFORMANCE_PROBE_LABELS.colonyCloudAdvertised,
  PERFORMANCE_PROBE_LABELS.colonyCloudRemembered,
  PERFORMANCE_PROBE_LABELS.colonyCloudReached,
  PERFORMANCE_PROBE_LABELS.colonyMeasuredHalos,
  PERFORMANCE_PROBE_LABELS.colonyEdges,
  PERFORMANCE_PROBE_LABELS.colonyAccretionHorizon,
  PERFORMANCE_PROBE_LABELS.colonyAccretionDisc,
  PERFORMANCE_PROBE_LABELS.colonyCourierPlume,
  PERFORMANCE_PROBE_LABELS.colonyCourierBloom,
  PERFORMANCE_PROBE_LABELS.deliveryBody,
  PERFORMANCE_PROBE_LABELS.deliveryCore,
  PERFORMANCE_PROBE_LABELS.deliveryTrail,
  PERFORMANCE_PROBE_LABELS.deliveryWave,
  PERFORMANCE_PROBE_LABELS.stars,
] as const;

const renderer = {} as THREE.WebGLRenderer;
const camera = new THREE.Camera();
const group = new THREE.Group();
const material = new THREE.MeshBasicMaterial();

interface Draw {
  render(scene: THREE.Scene): void;
}

/** One scene's worth of probed draws: every label on an object shaped like
 *  the one it probes — instanced meshes answering `this.count`, point passes
 *  answering their draw range — invoked the way three invokes them, as the
 *  object's own methods. */
function makeDraws(): Draw[] {
  const instanced = new THREE.InstancedMesh(new THREE.BufferGeometry(), material, 4);
  instanced.count = 4;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  return DRAW_LABELS.map((label, index) => {
    const callbacks = createNonEmptyDrawGpuProbeCallbacks(
      createGpuProbeCallbacks(label),
    );
    const object: THREE.Object3D = index % 2 === 0
      ? instanced
      : new THREE.Points(geometry, material);
    const drawGeometry = index % 2 === 0 ? instanced.geometry : geometry;
    return {
      render(scene) {
        callbacks.onBeforeRender.call(
          object, renderer, scene, camera, drawGeometry, material, group,
        );
        callbacks.onAfterRender.call(
          object, renderer, scene, camera, drawGeometry, material, group,
        );
      },
    };
  });
}

const sceneGeometry = new THREE.BufferGeometry();

/** The sampler's frame, as it stands around a render: poll, decide the
 *  stream, then the scene pass with every draw inside it. (three's typings
 *  give the scene hooks the object-hook arity; the bracket ignores the
 *  arguments either way.) */
function renderFrame(scene: THREE.Scene, draws: readonly Draw[]): void {
  pollGpuTimerQueries();
  advanceGpuProbeFrame();
  scene.onBeforeRender(renderer, scene, camera, sceneGeometry, material, group);
  for (let i = 0; i < draws.length; i += 1) draws[i].render(scene);
  scene.onAfterRender(renderer, scene, camera, sceneGeometry, material, group);
}

describe('a full frame of scoped draws', () => {
  it('is free when sampling is off: no clock read, no GL call, no allocation', () => {
    resetPerformanceProbe(0);
    expect(isPerformanceProbeEnabled()).toBe(false);
    const scene = new THREE.Scene();
    // The bracket is only ever installed by the enabled sampler; installed
    // anyway here, its hooks have to be as inert as the draw callbacks.
    const detachBracket = attachGpuFrameBracket(scene);
    const draws = makeDraws();
    const clock = vi.spyOn(performance, 'now');
    try {
      for (let frame = 0; frame < 50; frame += 1) renderFrame(scene, draws);
      expect(clock).not.toHaveBeenCalled();
      // No span, no query, no frame counted: the gate is in front of everything.
      expect(beginGpuProbe(PERFORMANCE_PROBE_LABELS.cellBody)).toBeNull();
      expect(beginGpuFrameBracket()).toBeNull();
      expect(gpuProbeFrameMode()).toBe('scopes');
      expect(readGpuFrameLedger().frames).toBe(0);
      expect(snapshotPerformanceProbe().gpu.metrics).toEqual({});

      // Allocation, on V8's new space, the way the picker's rebuild test
      // measures it: warm the tiers up first, void any round a scavenge
      // lands in, then bound the growth per frame. Twenty-one draws plus
      // the bracket: one span object per draw would already be ~1 KB.
      for (let frame = 0; frame < 2000; frame += 1) renderFrame(scene, draws);
      const newSpaceUsed = () => (
        getHeapSpaceStatistics().find((space) => space.space_name === 'new_space')
          ?.space_used_size ?? Number.NaN
      );
      const FRAMES = 1000;
      let measured = false;
      let growthPerFrame = Number.NaN;
      for (let round = 0; round < 6 && !measured; round += 1) {
        const before = newSpaceUsed();
        for (let frame = 0; frame < FRAMES; frame += 1) renderFrame(scene, draws);
        const after = newSpaceUsed();
        if (!(after >= before)) continue;
        growthPerFrame = (after - before) / FRAMES;
        measured = true;
      }
      expect(measured).toBe(true);
      expect(growthPerFrame).toBeLessThan(64);
    } finally {
      clock.mockRestore();
      detachBracket();
    }
  });

  it('is free of GL calls even with a context leased, once demand is released', () => {
    resetPerformanceProbe(0);
    const gl = new FakeTimerQueryContext();
    const release = retainPerformanceProbe();
    const detachContext = attachGpuTimerQueryContext(gl);
    release();
    expect(isPerformanceProbeEnabled()).toBe(false);
    const spies = (['createQuery', 'beginQuery', 'endQuery', 'getQueryParameter', 'getParameter'] as const)
      .map((method) => vi.spyOn(gl, method));
    const scene = new THREE.Scene();
    const detachBracket = attachGpuFrameBracket(scene);
    const draws = makeDraws();
    try {
      for (let frame = 0; frame < 10; frame += 1) renderFrame(scene, draws);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      detachBracket();
      detachContext();
    }
  });

  it('samples every draw on scope frames and the scene bracket on bracket frames, never both, off one pooled set of queries', () => {
    resetPerformanceProbe(0);
    const release = retainPerformanceProbe();
    const gl = new FakeTimerQueryContext();
    const detachContext = attachGpuTimerQueryContext(gl);
    const scene = new THREE.Scene();
    const detachBracket = attachGpuFrameBracket(scene);
    const draws = makeDraws();
    const FRAMES = 4 * GPU_FRAME_BRACKET_PERIOD;
    const bracketFrames = FRAMES / GPU_FRAME_BRACKET_PERIOD;
    const scopeFrames = FRAMES - bracketFrames;
    try {
      for (let frame = 0; frame < FRAMES; frame += 1) {
        renderFrame(scene, draws);
        // Every query of the frame completes at 1 ms before the next poll.
        gl.completeAll(1_000_000);
      }
      pollGpuTimerQueries();
      const snapshot = snapshotPerformanceProbe();
      for (const label of DRAW_LABELS) {
        expect(snapshot.gpu.metrics[label]?.count, label).toBe(scopeFrames);
      }
      expect(snapshot.frame[PERFORMANCE_PROBE_LABELS.frameGpu]?.count).toBe(bracketFrames);
      // The bracket lives in the frame domain, so Σ over `gpu` is the scoped total.
      expect(snapshot.gpu.metrics[PERFORMANCE_PROBE_LABELS.frameGpu]).toBeUndefined();
      expect(snapshot.gpu.state.droppedByReason.overlap).toBe(0);
      expect(snapshot.gpu.state.droppedQueries).toBe(0);
      expect(snapshot.gpu.state.pendingQueries).toBe(0);
      expect(snapshot.gpu.frameLedger).toMatchObject({
        frames: FRAMES,
        bracketFrames,
        scopeFrames,
        bracketMs: bracketFrames,
        scopedMs: scopeFrames * DRAW_LABELS.length,
      });
      // The pool: the first scope frame created one query per draw, and every
      // later frame — bracket frames included — drew on those.
      expect(gl.nextId - 1).toBe(DRAW_LABELS.length);
      expect(gl.deletedQueries).toBe(0);
    } finally {
      detachBracket();
      detachContext();
      release();
    }
  });
});
