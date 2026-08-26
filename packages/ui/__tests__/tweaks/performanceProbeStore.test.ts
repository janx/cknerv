import { describe, expect, it, vi } from 'vitest';
import {
  PERFORMANCE_PROBE_LABELS,
  PERFORMANCE_PROBE_SAMPLE_CAPACITY,
  beginCpuProbe,
  endCpuProbe,
  exportPerformanceProbeJson,
  isPerformanceProbeEnabled,
  measureCpuProbe,
  observePerformanceProbeSample,
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
      expect(snapshot.schemaVersion).toBe(1);
      expect(snapshot.sampleCapacity).toBe(PERFORMANCE_PROBE_SAMPLE_CAPACITY);
      expect(snapshot.invalidSamples.cpu).toBe(1);
    } finally {
      release();
    }
  });
});
