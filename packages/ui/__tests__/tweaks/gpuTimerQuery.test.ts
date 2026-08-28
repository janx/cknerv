import { describe, expect, it, vi } from 'vitest';
import {
  GPU_TIMER_PENDING_CAPACITY,
  attachGpuFrameBracket,
  attachGpuTimerQueryContext,
  beginGpuFrameBracket,
  beginGpuProbe,
  createGpuProbeCallbacks,
  createGpuTimerQueryCore,
  endGpuFrameBracket,
  endGpuProbe,
  pollGpuTimerQueries,
} from '../../src/tweaks/gpuTimerQuery';
import {
  PERFORMANCE_PROBE_LABELS,
  advanceGpuProbeFrame,
  gpuProbeFrameMode,
  resetPerformanceProbe,
  retainPerformanceProbe,
  snapshotPerformanceProbe,
} from '../../src/tweaks/performanceProbeStore';
import { FakeTimerQueryContext } from '../fixtures/fakeTimerQueryContext';

describe('GpuTimerQueryCore', () => {
  it('publishes only asynchronous query results, converted from ns to ms', () => {
    resetPerformanceProbe(0);
    const release = retainPerformanceProbe();
    const gl = new FakeTimerQueryContext();
    const core = createGpuTimerQueryCore(gl);
    try {
      expect(core).not.toBeNull();
      const span = core!.begin(PERFORMANCE_PROBE_LABELS.populationPoints);
      expect(span).not.toBeNull();
      expect(core!.end(span)).toBe(true);
      expect(snapshotPerformanceProbe().gpu.state.pendingQueries).toBe(1);

      core!.poll();
      expect(snapshotPerformanceProbe().gpu.metrics).toEqual({});
      gl.completeAll(3_750_000);
      core!.poll();

      const snapshot = snapshotPerformanceProbe();
      expect(snapshot.gpu.state).toMatchObject({
        availability: 'ready',
        pendingQueries: 0,
        droppedQueries: 0,
      });
      expect(snapshot.gpu.metrics[
        PERFORMANCE_PROBE_LABELS.populationPoints
      ]).toMatchObject({ count: 1, meanMs: 3.75, lastMs: 3.75 });
    } finally {
      core?.dispose();
      release();
    }
  });

  it('rejects overlap/capacity instead of corrupting another draw scope', () => {
    resetPerformanceProbe(0);
    const release = retainPerformanceProbe();
    const gl = new FakeTimerQueryContext();
    const core = createGpuTimerQueryCore(gl, 1);
    try {
      const first = core!.begin(PERFORMANCE_PROBE_LABELS.populationPoints);
      expect(core!.begin(PERFORMANCE_PROBE_LABELS.populationResidualFibres)).toBeNull();
      expect(core!.end(first)).toBe(true);
      expect(core!.begin(PERFORMANCE_PROBE_LABELS.populationResidualFibres)).toBeNull();
      const state = snapshotPerformanceProbe().gpu.state;
      expect(state.droppedByReason.overlap).toBe(1);
      expect(state.droppedByReason.capacity).toBe(1);
    } finally {
      core?.dispose();
      release();
    }
  });

  it('deletes a created query when beginQuery rejects it', () => {
    resetPerformanceProbe(0);
    const release = retainPerformanceProbe();
    const gl = new FakeTimerQueryContext();
    gl.throwOnBegin = true;
    const core = createGpuTimerQueryCore(gl);
    try {
      expect(core!.begin(PERFORMANCE_PROBE_LABELS.populationPoints)).toBeNull();
      expect(gl.queries.size).toBe(0);
      expect(gl.deletedQueries).toBe(1);
      expect(snapshotPerformanceProbe().gpu.state.droppedByReason['create-failed'])
        .toBe(1);
    } finally {
      core?.dispose();
      release();
    }
  });

  it('discards all invalid results when the context reports a disjoint event', () => {
    resetPerformanceProbe(0);
    const release = retainPerformanceProbe();
    const gl = new FakeTimerQueryContext();
    const core = createGpuTimerQueryCore(gl);
    try {
      const a = core!.begin(PERFORMANCE_PROBE_LABELS.populationPoints);
      core!.end(a);
      const b = core!.begin(PERFORMANCE_PROBE_LABELS.populationResidualFibres);
      core!.end(b);
      gl.completeAll(2_000_000);
      gl.disjoint = true;
      core!.poll();

      const snapshot = snapshotPerformanceProbe();
      expect(snapshot.gpu.metrics).toEqual({});
      expect(snapshot.gpu.state.disjointEvents).toBe(1);
      expect(snapshot.gpu.state.droppedByReason.disjoint).toBe(2);
      expect(snapshot.gpu.state.pendingQueries).toBe(0);
    } finally {
      core?.dispose();
      release();
    }
  });

  it('drops delayed old-session queries after reset', () => {
    resetPerformanceProbe(0);
    const release = retainPerformanceProbe();
    const gl = new FakeTimerQueryContext();
    const core = createGpuTimerQueryCore(gl);
    try {
      const span = core!.begin(PERFORMANCE_PROBE_LABELS.populationPoints);
      core!.end(span);
      resetPerformanceProbe(100);
      gl.completeAll(9_000_000);
      core!.poll();
      expect(snapshotPerformanceProbe().gpu.metrics).toEqual({});
      expect(snapshotPerformanceProbe().gpu.state.pendingQueries).toBe(0);
    } finally {
      core?.dispose();
      release();
    }
  });

  it('reports missing WebGL2/extension support without a CPU-time fallback', () => {
    resetPerformanceProbe(0);
    const release = retainPerformanceProbe();
    try {
      expect(createGpuTimerQueryCore({})).toBeNull();
      expect(snapshotPerformanceProbe().gpu.state).toMatchObject({
        availability: 'unsupported',
        reason: 'webgl2-timer-query-api-unavailable',
      });

      const gl = new FakeTimerQueryContext();
      gl.extensionAvailable = false;
      expect(createGpuTimerQueryCore(gl)).toBeNull();
      expect(snapshotPerformanceProbe().gpu.state).toMatchObject({
        availability: 'unsupported',
        reason: 'EXT_disjoint_timer_query_webgl2-unavailable',
      });
      expect(snapshotPerformanceProbe().gpu.metrics).toEqual({});
      expect(GPU_TIMER_PENDING_CAPACITY).toBe(64);
    } finally {
      release();
    }
  });

  it('reuses query objects once their result is read, creating none in steady state', () => {
    resetPerformanceProbe(0);
    const release = retainPerformanceProbe();
    const gl = new FakeTimerQueryContext();
    const core = createGpuTimerQueryCore(gl);
    try {
      // Three scopes a frame, five frames: the first frame creates, every
      // later one draws on the pool the previous frame's poll refilled.
      for (let frame = 0; frame < 5; frame += 1) {
        for (let draw = 0; draw < 3; draw += 1) {
          core!.end(core!.begin(PERFORMANCE_PROBE_LABELS.cellBody));
        }
        gl.completeAll(500_000);
        core!.poll();
        expect(core!.pooledQueryCount).toBe(3);
      }
      expect(gl.nextId - 1).toBe(3);
      expect(gl.deletedQueries).toBe(0);
      expect(snapshotPerformanceProbe().gpu.metrics[
        PERFORMANCE_PROBE_LABELS.cellBody
      ]).toMatchObject({ count: 15, meanMs: 0.5 });
      // Disposal returns the pool to the driver along with everything else.
      core!.dispose();
      expect(gl.deletedQueries).toBe(3);
      expect(gl.queries.size).toBe(0);
    } finally {
      core?.dispose();
      release();
    }
  });

  it('retires, rather than reuses, a query whose result was never read', () => {
    resetPerformanceProbe(0);
    const release = retainPerformanceProbe();
    const gl = new FakeTimerQueryContext();
    const core = createGpuTimerQueryCore(gl);
    try {
      core!.end(core!.begin(PERFORMANCE_PROBE_LABELS.cellBody));
      core!.end(core!.begin(PERFORMANCE_PROBE_LABELS.cellFlare));
      gl.disjoint = true;
      core!.poll();
      expect(gl.deletedQueries).toBe(2);
      expect(core!.pooledQueryCount).toBe(0);
    } finally {
      core?.dispose();
      release();
    }
  });

  it('files a bracket query under frame.gpu in the frame domain and on the ledger', () => {
    resetPerformanceProbe(0);
    const release = retainPerformanceProbe();
    const gl = new FakeTimerQueryContext();
    const core = createGpuTimerQueryCore(gl);
    try {
      core!.end(core!.begin(PERFORMANCE_PROBE_LABELS.frameGpu, 'bracket'));
      gl.completeAll(2_500_000);
      core!.poll();
      const snapshot = snapshotPerformanceProbe();
      expect(snapshot.frame[PERFORMANCE_PROBE_LABELS.frameGpu]).toMatchObject({
        count: 1,
        lastMs: 2.5,
      });
      expect(snapshot.gpu.metrics[PERFORMANCE_PROBE_LABELS.frameGpu]).toBeUndefined();
      expect(snapshot.gpu.frameLedger).toMatchObject({
        bracketMs: 2.5,
        bracketFrames: 1,
        scopedMs: 0,
        scopeFrames: 0,
      });
    } finally {
      core?.dispose();
      release();
    }
  });
});

describe('frame bracket', () => {
  const renderArgs = [{}, {}, {}, null] as const;

  it('keeps the draw scopes and the bracket on different frames, without touching the overlap counter', () => {
    resetPerformanceProbe(0);
    const release = retainPerformanceProbe();
    const gl = new FakeTimerQueryContext();
    const detach = attachGpuTimerQueryContext(gl);
    const createQuery = vi.spyOn(gl, 'createQuery');
    try {
      // Frame 1 carries the scopes: the bracket declines before any GL call.
      expect(advanceGpuProbeFrame()).toBe('scopes');
      expect(beginGpuFrameBracket()).toBeNull();
      const scope = beginGpuProbe(PERFORMANCE_PROBE_LABELS.cellBody);
      expect(scope).not.toBeNull();
      expect(endGpuProbe(scope)).toBe(true);
      // Frame 2 carries the bracket: a scope declines the same way, and the
      // refusal is the mode gate, never an overlap drop.
      expect(advanceGpuProbeFrame()).toBe('bracket');
      createQuery.mockClear();
      expect(beginGpuProbe(PERFORMANCE_PROBE_LABELS.cellBody)).toBeNull();
      expect(createQuery).not.toHaveBeenCalled();
      const bracket = beginGpuFrameBracket();
      expect(bracket).not.toBeNull();
      expect(beginGpuProbe(PERFORMANCE_PROBE_LABELS.cellFlare)).toBeNull();
      expect(endGpuFrameBracket(bracket)).toBe(true);
      gl.completeAll(1_000_000);
      pollGpuTimerQueries();
      const snapshot = snapshotPerformanceProbe();
      expect(snapshot.gpu.state.droppedByReason.overlap).toBe(0);
      expect(snapshot.gpu.state.droppedQueries).toBe(0);
      expect(snapshot.gpu.metrics[PERFORMANCE_PROBE_LABELS.cellBody]?.count).toBe(1);
      expect(snapshot.frame[PERFORMANCE_PROBE_LABELS.frameGpu]?.count).toBe(1);
      expect(snapshot.gpu.frameLedger).toMatchObject({
        frames: 2,
        mode: 'bracket',
        bracketFrames: 1,
        scopeFrames: 1,
      });
    } finally {
      detach();
      release();
    }
  });

  it('wraps a scene\'s render hooks, keeps the hooks it found, and restores them on detach', () => {
    resetPerformanceProbe(0);
    const release = retainPerformanceProbe();
    const gl = new FakeTimerQueryContext();
    const detachContext = attachGpuTimerQueryContext(gl);
    const before = vi.fn();
    const after = vi.fn();
    const scene = { onBeforeRender: before, onAfterRender: after };
    try {
      const detachBracket = attachGpuFrameBracket(scene);
      expect(scene.onBeforeRender).not.toBe(before);
      advanceGpuProbeFrame();
      advanceGpuProbeFrame();
      expect(gpuProbeFrameMode()).toBe('bracket');
      // Three hands the before hook four arguments and the after hook three.
      // A pass with no probed draw opens no bracket: nothing to attribute.
      scene.onBeforeRender(...renderArgs);
      scene.onAfterRender(renderArgs[0], renderArgs[1], renderArgs[2]);
      // The scene's own hooks ran, with the arguments three handed in.
      expect(before).toHaveBeenCalledWith(...renderArgs);
      expect(after).toHaveBeenCalledWith(renderArgs[0], renderArgs[1], renderArgs[2]);
      expect(snapshotPerformanceProbe().gpu.state.pendingQueries).toBe(0);
      expect(gl.nextId - 1).toBe(0);
      // The next bracket frame: the pass's FIRST probed draw opens the one
      // query — after the render-list build, at the first draw command — a
      // second probed draw joins it, and the pass's end closes it.
      advanceGpuProbeFrame();
      advanceGpuProbeFrame();
      expect(gpuProbeFrameMode()).toBe('bracket');
      const draw = createGpuProbeCallbacks(PERFORMANCE_PROBE_LABELS.cellBody);
      scene.onBeforeRender(...renderArgs);
      expect(gl.nextId - 1).toBe(0);
      draw.onBeforeRender();
      draw.onAfterRender();
      draw.onBeforeRender();
      draw.onAfterRender();
      expect(gl.nextId - 1).toBe(1);
      expect(snapshotPerformanceProbe().gpu.state.pendingQueries).toBe(0);
      scene.onAfterRender(renderArgs[0], renderArgs[1], renderArgs[2]);
      expect(snapshotPerformanceProbe().gpu.state.pendingQueries).toBe(1);
      expect(snapshotPerformanceProbe().gpu.state.droppedQueries).toBe(0);
      detachBracket();
      expect(scene.onBeforeRender).toBe(before);
      expect(scene.onAfterRender).toBe(after);
      // Detach is idempotent, and leaves a hook somebody replaced since.
      const replaced = vi.fn();
      scene.onBeforeRender = replaced;
      detachBracket();
      expect(scene.onBeforeRender).toBe(replaced);
    } finally {
      detachContext();
      release();
    }
  });
});
