import { afterEach, describe, expect, it } from 'vitest';
import {
  gpuUploadedBytes,
  observeGpuUpload,
  resetGpuUploads,
  snapshotGpuUploads,
} from '../../src/tweaks/gpuUploadLedger';

afterEach(() => {
  resetGpuUploads();
});

describe('gpuUploadLedger', () => {
  it('sums flagged bytes by lane with last-commit and peak readings', () => {
    observeGpuUpload('fabric', 4096);
    observeGpuUpload('fabric', 256);
    observeGpuUpload('cells', 816_000);
    observeGpuUpload('bridge', 224);
    observeGpuUpload('cohort', 3456);
    const s = snapshotGpuUploads();
    expect(s.lanes.fabric).toEqual({
      bytes: 4352, commits: 2, bytesLast: 256, bytesMax: 4096,
    });
    expect(s.lanes.cells).toEqual({
      bytes: 816_000, commits: 1, bytesLast: 816_000, bytesMax: 816_000,
    });
    expect(s.lanes.bridge.bytes).toBe(224);
    expect(s.lanes.cohort.bytes).toBe(3456);
    expect(s.bytes).toBe(4352 + 816_000 + 224 + 3456);
    expect(s.commits).toBe(5);
    expect(gpuUploadedBytes()).toBe(s.bytes);
  });

  it('ignores empty commits, so the last-commit reading is a real upload', () => {
    observeGpuUpload('cells', 1024);
    observeGpuUpload('cells', 0);
    observeGpuUpload('cells', -8);
    observeGpuUpload('cells', Number.NaN);
    const s = snapshotGpuUploads();
    expect(s.lanes.cells).toEqual({
      bytes: 1024, commits: 1, bytesLast: 1024, bytesMax: 1024,
    });
  });

  it('hands out copies and resets every lane at once', () => {
    observeGpuUpload('fabric', 10);
    const s = snapshotGpuUploads();
    s.lanes.fabric.bytes = 999;
    expect(snapshotGpuUploads().lanes.fabric.bytes).toBe(10);
    resetGpuUploads();
    expect(snapshotGpuUploads()).toEqual({
      lanes: {
        fabric: { bytes: 0, commits: 0, bytesLast: 0, bytesMax: 0 },
        bridge: { bytes: 0, commits: 0, bytesLast: 0, bytesMax: 0 },
        cells: { bytes: 0, commits: 0, bytesLast: 0, bytesMax: 0 },
        cohort: { bytes: 0, commits: 0, bytesLast: 0, bytesMax: 0 },
      },
      bytes: 0,
      commits: 0,
    });
    expect(gpuUploadedBytes()).toBe(0);
  });
});
