import { describe, expect, it, vi } from 'vitest';
import {
  GPU_FRAME_BRACKET_PERIOD,
  PERFORMANCE_PROBE_LABELS,
  PERFORMANCE_PROBE_SAMPLE_CAPACITY,
  advanceGpuProbeFrame,
  beginCpuProbe,
  endCpuProbe,
  exportPerformanceProbeJson,
  gpuProbeFrameIndex,
  gpuProbeFrameMode,
  isPerformanceProbeEnabled,
  measureCpuProbe,
  observeGpuFrameLedger,
  observeGpuProbeDrop,
  observePerformanceProbeSample,
  readGpuFrameLedger,
  resetPerformanceProbe,
  retainPerformanceProbe,
  snapshotPerformanceProbe,
} from '../../src/tweaks/performanceProbeStore';

describe('performanceProbeStore', () => {
  it('is allocation-free/inert until retained and releases idempotently', () => {
    resetPerformanceProbe(10);
    expect(isPerformanceProbeEnabled()).toBe(false);
    const clock = vi.spyOn(performance, 'now');
    expect(beginCpuProbe(PERFORMANCE_PROBE_LABELS.cellNucleusLod)).toBeNull();
    expect(clock).not.toHaveBeenCalled();
    clock.mockRestore();
    expect(observePerformanceProbeSample('frame', 'ignored', 16)).toBe(false);
    expect(snapshotPerformanceProbe().frame).toEqual({});

    const releaseA = retainPerformanceProbe();
    const releaseB = retainPerformanceProbe();
    expect(isPerformanceProbeEnabled()).toBe(true);
    releaseA();
    releaseA();
    expect(isPerformanceProbeEnabled()).toBe(true);
    releaseB();
    expect(isPerformanceProbeEnabled()).toBe(false);
  });

  it('exports bounded recent percentiles plus honest all-time aggregates', () => {
    resetPerformanceProbe(20);
    const release = retainPerformanceProbe();
    try {
      for (let value = 1; value <= 5; value += 1) {
        observePerformanceProbeSample(
          'frame',
          PERFORMANCE_PROBE_LABELS.frameInterval,
          value,
        );
      }
      const first = snapshotPerformanceProbe().frame[
        PERFORMANCE_PROBE_LABELS.frameInterval
      ];
      expect(first).toMatchObject({
        count: 5,
        retained: 5,
        meanMs: 3,
        p50Ms: 3,
        p95Ms: 4.8,
        p99Ms: 4.96,
        maxMs: 5,
        lastMs: 5,
      });

      for (let value = 6; value <= PERFORMANCE_PROBE_SAMPLE_CAPACITY + 20; value += 1) {
        observePerformanceProbeSample(
          'frame',
          PERFORMANCE_PROBE_LABELS.frameInterval,
          value,
        );
      }
      const bounded = snapshotPerformanceProbe().frame[
        PERFORMANCE_PROBE_LABELS.frameInterval
      ];
      expect(bounded.count).toBe(PERFORMANCE_PROBE_SAMPLE_CAPACITY + 20);
      expect(bounded.retained).toBe(PERFORMANCE_PROBE_SAMPLE_CAPACITY);
      expect(bounded.maxMs).toBe(PERFORMANCE_PROBE_SAMPLE_CAPACITY + 20);
      expect(bounded.lastMs).toBe(PERFORMANCE_PROBE_SAMPLE_CAPACITY + 20);
    } finally {
      release();
    }
  });

  it('measures explicit CPU spans, rejects double-end, and drops pre-reset spans', () => {
    resetPerformanceProbe(30);
    const release = retainPerformanceProbe();
    try {
      const span = beginCpuProbe(PERFORMANCE_PROBE_LABELS.cellFieldIngest, 100);
      expect(endCpuProbe(span, 104.25)).toBe(true);
      expect(endCpuProbe(span, 105)).toBe(false);

      const stale = beginCpuProbe(PERFORMANCE_PROBE_LABELS.topologyCommit, 200);
      resetPerformanceProbe(201);
      expect(endCpuProbe(stale, 210)).toBe(false);
      expect(snapshotPerformanceProbe().cpu).toEqual({});
    } finally {
      release();
    }
  });

  it('measures callback work in finally and preserves the thrown error', () => {
    resetPerformanceProbe(40);
    const release = retainPerformanceProbe();
    const now = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(500)
      .mockReturnValueOnce(506.5);
    try {
      expect(() => measureCpuProbe(
        PERFORMANCE_PROBE_LABELS.topologyCommit,
        () => { throw new Error('expected'); },
      )).toThrow('expected');
      const measured = snapshotPerformanceProbe().cpu[
        PERFORMANCE_PROBE_LABELS.topologyCommit
      ];
      expect(measured.count).toBe(1);
      expect(measured.lastMs).toBe(6.5);
    } finally {
      now.mockRestore();
      release();
    }
  });

  it('reports invalid samples and returns a versioned JSON export', () => {
    resetPerformanceProbe(50);
    const release = retainPerformanceProbe();
    try {
      expect(observePerformanceProbeSample('cpu', 'bad', Number.NaN)).toBe(false);
      const snapshot = JSON.parse(exportPerformanceProbeJson(0)) as {
        schemaVersion: number;
        sampleCapacity: number;
        invalidSamples: { cpu: number };
      };
      // Schema 2: the `gpu.frameLedger` block and the `frame.gpu` bracket
      // joined the export.
      expect(snapshot.schemaVersion).toBe(2);
      expect(snapshot.sampleCapacity).toBe(PERFORMANCE_PROBE_SAMPLE_CAPACITY);
      expect(snapshot.invalidSamples.cpu).toBe(1);
    } finally {
      release();
    }
  });

  it('alternates the frame mode only while retained, and counts each stream per frame', () => {
    resetPerformanceProbe(60);
    // Off: the mode never leaves `scopes` and no frame is counted.
    expect(advanceGpuProbeFrame()).toBe('scopes');
    expect(advanceGpuProbeFrame()).toBe('scopes');
    expect(gpuProbeFrameIndex()).toBe(0);
    const release = retainPerformanceProbe();
    try {
      const modes: string[] = [];
      for (let frame = 0; frame < 2 * GPU_FRAME_BRACKET_PERIOD; frame += 1) {
        modes.push(advanceGpuProbeFrame());
      }
      // Every Nth sampled frame is the bracket's; the rest belong to the scopes.
      expect(modes.filter((mode) => mode === 'bracket')).toHaveLength(2);
      expect(modes[GPU_FRAME_BRACKET_PERIOD - 1]).toBe('bracket');
      expect(gpuProbeFrameMode()).toBe(modes[modes.length - 1]);
      expect(gpuProbeFrameIndex()).toBe(2 * GPU_FRAME_BRACKET_PERIOD);

      // Two scopes on one frame are one scope frame; a bracket is one bracket
      // frame; ms accumulate per stream.
      observeGpuFrameLedger('scope', 1, 0.5);
      observeGpuFrameLedger('scope', 1, 0.25);
      observeGpuFrameLedger('scope', 3, 1);
      observeGpuFrameLedger('bracket', 2, 2);
      expect(readGpuFrameLedger()).toMatchObject({
        scopedMs: 1.75,
        scopeFrames: 2,
        bracketMs: 2,
        bracketFrames: 1,
        bracketPeriod: GPU_FRAME_BRACKET_PERIOD,
      });
      expect(snapshotPerformanceProbe().gpu.frameLedger).toEqual(readGpuFrameLedger());

      resetPerformanceProbe(61);
      expect(readGpuFrameLedger()).toMatchObject({
        frames: 0,
        mode: 'scopes',
        scopedMs: 0,
        scopeFrames: 0,
        bracketMs: 0,
        bracketFrames: 0,
      });
    } finally {
      release();
    }
  });

  it('mutates the GPU state in place and hands out isolated copies', () => {
    resetPerformanceProbe(70);
    observeGpuProbeDrop('overlap');
    observeGpuProbeDrop('capacity', 2);
    const first = snapshotPerformanceProbe().gpu.state;
    expect(first.droppedQueries).toBe(3);
    expect(first.droppedByReason).toMatchObject({ overlap: 1, capacity: 2 });
    // A reader scribbling on its copy cannot reach the store.
    first.droppedByReason.overlap = 99;
    first.droppedQueries = 99;
    const second = snapshotPerformanceProbe().gpu.state;
    expect(second.droppedByReason.overlap).toBe(1);
    expect(second.droppedQueries).toBe(3);
    resetPerformanceProbe(71);
    expect(snapshotPerformanceProbe().gpu.state.droppedQueries).toBe(0);
  });
});
