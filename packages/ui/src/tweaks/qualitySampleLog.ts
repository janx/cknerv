// Dev instrumentation for the adaptive quality controller: the sample windows
// it was actually handed, kept as a ring. Pure module singleton — the
// `pulseStats` / `fabricStats` / `cellPickStats` idiom: written by the
// controller, read by a snapshot, cleared by a probe or a test. The WINDOW
// hook that surfaces it lives in ui-app, so the library stays free of `window`
// coupling.
//
// ⭐ IT EXISTS BECAUSE THE TIER IS DECIDED FROM EVIDENCE NOBODY CAN SEE. The
// controller acts on a window MEAN and rejects four classes of frame outright,
// so "the page stepped down" is a verdict whose reasons are gone by the time
// anyone looks. A window that was thrown away is the reading a live session is
// opened for — `stalled` with the longest frame beside it says the throw was
// right — and a window that was NOT thrown away, with the mean the cascade
// read off it, is the only way to tell a machine that is genuinely slow from
// one whose measurement was.

import type { QualityPreset } from './qualityPresets';

/** One closed sample window, exactly as the controller weighed it. */
export interface QualitySample {
  /** `performance.now()` at the close of the window. */
  atMs: number;
  windowMs: number;
  frames: number;
  meanFrameMs: number;
  /** The window's longest frame — what a mean cannot say on its own. */
  maxFrameMs: number;
  /** The window was dropped because its longest frame was not a frame. */
  stalled: boolean;
  /** The tier in force while the window was collected. */
  quality: QualityPreset;
  smoothedFrameMs: number;
  slowEvidenceMs: number;
  locked: boolean;
}

/** How many windows the log keeps. Twenty minutes of them at the sampler's own
 *  cadence — enough to read a whole calibration and the hour after it, small
 *  enough that nobody has to remember to turn it off. */
export const QUALITY_SAMPLE_RING = 1600;

const samples: QualitySample[] = [];

export function recordQualitySample(sample: QualitySample): void {
  samples.push(sample);
  if (samples.length > QUALITY_SAMPLE_RING) samples.shift();
}

/** The ring as it stands, oldest first. A copy: a reader holding the live
 *  array would watch it mutate under a debugger pause. */
export function snapshotQualitySamples(): QualitySample[] {
  return samples.slice();
}

export function resetQualitySamples(): void {
  samples.length = 0;
}
