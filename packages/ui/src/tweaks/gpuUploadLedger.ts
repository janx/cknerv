// Bytes handed to gl.bufferSubData, by lane, across the whole scene — the one
// place a probe (or GL·08) can read "how much did this frame upload" without
// touching gl.info, which does not count buffer traffic at all.
//
// Pure module singleton, the `fabricStats` / `pulseStats` idiom: always on
// (one addition per commit), read directly, reset by tests. The lane
// counters feed it from their own `observe*` paths, so a lane keeps its own
// richer readout and this ledger stays the cheap sum a per-frame sampler
// wants. The WINDOW hook lives in ui-app, so the library stays window-free.

export type GpuUploadLane = 'fabric' | 'bridge' | 'cells' | 'cohort';

export interface GpuUploadLaneSnapshot {
  /** Σ bytes flagged for upload by this lane. */
  bytes: number;
  /** Commits that flagged at least one byte. */
  commits: number;
  /** Bytes of the most recent uploading commit. */
  bytesLast: number;
  /** Largest single commit observed. */
  bytesMax: number;
}

export interface GpuUploadSnapshot {
  lanes: Record<GpuUploadLane, GpuUploadLaneSnapshot>;
  /** Σ over every lane. */
  bytes: number;
  commits: number;
}

function zeroLane(): GpuUploadLaneSnapshot {
  return { bytes: 0, commits: 0, bytesLast: 0, bytesMax: 0 };
}

const lanes: Record<GpuUploadLane, GpuUploadLaneSnapshot> = {
  fabric: zeroLane(),
  bridge: zeroLane(),
  cells: zeroLane(),
  cohort: zeroLane(),
};
let totalBytes = 0;
let totalCommits = 0;

/** Record one commit's flagged bytes. Empty commits (nothing flagged) are
 *  not commits and must not clobber the "last uploading commit" reading. */
export function observeGpuUpload(lane: GpuUploadLane, bytes: number): void {
  if (!(bytes > 0)) return;
  const entry = lanes[lane];
  entry.bytes += bytes;
  entry.commits += 1;
  entry.bytesLast = bytes;
  if (bytes > entry.bytesMax) entry.bytesMax = bytes;
  totalBytes += bytes;
  totalCommits += 1;
}

/** The running total, for a sampler that differences it per window. */
export function gpuUploadedBytes(): number {
  return totalBytes;
}

export function snapshotGpuUploads(): GpuUploadSnapshot {
  return {
    lanes: {
      fabric: { ...lanes.fabric },
      bridge: { ...lanes.bridge },
      cells: { ...lanes.cells },
      cohort: { ...lanes.cohort },
    },
    bytes: totalBytes,
    commits: totalCommits,
  };
}

export function resetGpuUploads(): void {
  lanes.fabric = zeroLane();
  lanes.bridge = zeroLane();
  lanes.cells = zeroLane();
  lanes.cohort = zeroLane();
  totalBytes = 0;
  totalCommits = 0;
}
