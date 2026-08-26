import { describe, expect, it } from 'vitest';
import {
  GPU_TIMER_PENDING_CAPACITY,
  createGpuTimerQueryCore,
} from '../../src/tweaks/gpuTimerQuery';
import {
  PERFORMANCE_PROBE_LABELS,
  resetPerformanceProbe,
  retainPerformanceProbe,
  snapshotPerformanceProbe,
} from '../../src/tweaks/performanceProbeStore';

interface FakeQuery {
  id: number;
}

class FakeTimerQueryContext {
  readonly QUERY_RESULT_AVAILABLE = 0x8867;

  readonly QUERY_RESULT = 0x8866;

  readonly extension = {
    TIME_ELAPSED_EXT: 0x88bf,
    GPU_DISJOINT_EXT: 0x8fbb,
  };

  extensionAvailable = true;

  disjoint = false;

  lost = false;

  throwOnBegin = false;

  deletedQueries = 0;

  nextId = 1;

  active: FakeQuery | null = null;

  readonly queries = new Map<FakeQuery, { available: boolean; resultNs: number }>();

  getExtension(name: string): unknown {
    return name === 'EXT_disjoint_timer_query_webgl2' && this.extensionAvailable
      ? this.extension
      : null;
  }

  createQuery(): FakeQuery {
    const query = { id: this.nextId };
    this.nextId += 1;
    this.queries.set(query, { available: false, resultNs: 0 });
    return query;
  }

  deleteQuery(query: object): void {
    this.deletedQueries += 1;
    this.queries.delete(query as FakeQuery);
  }

  beginQuery(_target: number, query: object): void {
    if (this.throwOnBegin) throw new Error('begin rejected');
    this.active = query as FakeQuery;
  }

  endQuery(): void {
    this.active = null;
  }

  getQueryParameter(query: object, pname: number): unknown {
    const state = this.queries.get(query as FakeQuery);
    if (!state) throw new Error('unknown query');
    if (pname === this.QUERY_RESULT_AVAILABLE) return state.available;
    if (pname === this.QUERY_RESULT) return state.resultNs;
    throw new Error('unknown query parameter');
  }

  getParameter(pname: number): unknown {
    if (pname === this.extension.GPU_DISJOINT_EXT) return this.disjoint;
    throw new Error('unknown parameter');
  }

  isContextLost(): boolean {
    return this.lost;
  }

  completeAll(resultNs: number): void {
    for (const state of this.queries.values()) {
      state.available = true;
      state.resultNs = resultNs;
    }
  }
}

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
});
