// The block-frame gauges the sustain wave is graded on. Every reading is fed
// an explicit timestamp, so what is pinned here is the ARITHMETIC and the
// bookkeeping — the ring's bound, the maxima, what a missing start mark does —
// rather than the machine's clock.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BLOCK_FRAME_RING_CAPACITY,
  blockFrameStats,
  resetBlockFrameStats,
  snapshotBlockFrameStats,
} from '../../src/nerve/blockFrameStats';

/** One landed build, start to end, in the module's own clock domain. */
function land(startMs: number, endMs: number): void {
  blockFrameStats.markLandingStart(startMs);
  blockFrameStats.observeLanding(endMs);
}

describe('blockFrameStats', () => {
  beforeEach(() => {
    resetBlockFrameStats();
  });

  it('records one entry per landing and keeps the ring at 32', () => {
    expect(BLOCK_FRAME_RING_CAPACITY).toBe(32);
    for (let index = 0; index < 40; index += 1) {
      land(index * 100, index * 100 + index);
    }
    const snapshot = snapshotBlockFrameStats();
    // Every landing counts; only the last 32 are retained.
    expect(snapshot.count).toBe(40);
    expect(snapshot.recent).toHaveLength(BLOCK_FRAME_RING_CAPACITY);
    // Oldest first, and the oldest survivor is landing #8 (40 − 32).
    expect(snapshot.recent[0].landingMs).toBe(8);
    expect(snapshot.recent[31].landingMs).toBe(39);
  });

  it('tracks the all-time maximum of each reading, not just the ring', () => {
    land(0, 48);
    blockFrameStats.observeBridge(13);
    // The 48 ms landing falls out of the ring; its max must not.
    for (let index = 1; index <= BLOCK_FRAME_RING_CAPACITY; index += 1) {
      land(index * 100, index * 100 + 1);
      blockFrameStats.observeBridge(2);
    }
    const snapshot = snapshotBlockFrameStats();
    expect(snapshot.recent).toHaveLength(BLOCK_FRAME_RING_CAPACITY);
    expect(snapshot.recent.some((entry) => entry.landingMs === 48)).toBe(false);
    expect(snapshot.max.landingMs).toBe(48);
    expect(snapshot.max.bridgeMs).toBe(13);
  });

  it('ignores a landing with no start mark, and a start mark it discarded', () => {
    // The synchronous fallback resolves the same promise without ever having
    // entered the worker's message handler.
    blockFrameStats.observeLanding(500);
    expect(snapshotBlockFrameStats().count).toBe(0);

    // A stale / failed / superseded response clears its own mark, so the NEXT
    // landing can never be measured from a task it did not belong to.
    blockFrameStats.markLandingStart(100);
    blockFrameStats.discardLanding();
    blockFrameStats.observeLanding(900);
    expect(snapshotBlockFrameStats().count).toBe(0);

    land(1_000, 1_020);
    const snapshot = snapshotBlockFrameStats();
    expect(snapshot.count).toBe(1);
    expect(snapshot.recent[0].landingMs).toBe(20);
  });

  it('closes a landing exactly once — a second observe finds no mark', () => {
    land(0, 30);
    blockFrameStats.observeLanding(90);
    expect(snapshotBlockFrameStats().count).toBe(1);
    expect(snapshotBlockFrameStats().max.landingMs).toBe(30);
  });

  it('stamps the bridge commit onto the landing it followed', () => {
    land(0, 20);
    blockFrameStats.observeBridge(9);
    land(100, 118);
    blockFrameStats.observeBridge(4);
    const snapshot = snapshotBlockFrameStats();
    expect(snapshot.bridgeCount).toBe(2);
    expect(snapshot.recent.map((entry) => entry.bridgeMs)).toEqual([9, 4]);
  });

  it('moves the bridge maximum even with no landing to stamp', () => {
    // An anchor change re-runs the effect with no build behind it. T5 is
    // graded on this maximum, so it must not need a landing to be recorded.
    blockFrameStats.observeBridge(25);
    const snapshot = snapshotBlockFrameStats();
    expect(snapshot.count).toBe(0);
    expect(snapshot.bridgeCount).toBe(1);
    expect(snapshot.max.bridgeMs).toBe(25);
  });

  it('reads the frame gap as the interval BETWEEN the frames around a landing', () => {
    blockFrameStats.markFrame(1_000);
    land(1_005, 1_045);
    // Before the next frame the entry carries the gap so far — an honest
    // lower bound if the frame never comes (a hidden tab, an unmount).
    expect(snapshotBlockFrameStats().recent[0].frameGapMs).toBe(45);
    blockFrameStats.markFrame(1_060);
    const snapshot = snapshotBlockFrameStats();
    expect(snapshot.recent[0].frameGapMs).toBe(60);
    expect(snapshot.max.frameGapMs).toBe(60);
    // A later frame with no landing pending changes nothing.
    blockFrameStats.markFrame(1_075);
    expect(snapshotBlockFrameStats().recent[0].frameGapMs).toBe(60);
  });

  it('reads a landing before any frame as a zero gap', () => {
    land(0, 12);
    expect(snapshotBlockFrameStats().recent[0].frameGapMs).toBe(0);
    blockFrameStats.markFrame(20);
    // Measured from the landing itself: there is no earlier frame to name.
    expect(snapshotBlockFrameStats().recent[0].frameGapMs).toBe(8);
  });

  it('hands out isolated copies and zeroes everything on reset', () => {
    blockFrameStats.markFrame(0);
    land(1, 6);
    blockFrameStats.observeBridge(3);
    const snapshot = snapshotBlockFrameStats();
    snapshot.recent[0].landingMs = 999;
    snapshot.max.landingMs = 999;
    expect(snapshotBlockFrameStats().recent[0].landingMs).toBe(5);
    expect(snapshotBlockFrameStats().max.landingMs).toBe(5);

    resetBlockFrameStats();
    expect(snapshotBlockFrameStats()).toEqual({
      count: 0,
      bridgeCount: 0,
      recent: [],
      max: { landingMs: 0, bridgeMs: 0, frameGapMs: 0 },
    });
    // Reset drops the open mark and the frame reference too, so a landing
    // that straddles a reset cannot be reported against a stale clock.
    blockFrameStats.observeLanding(10_000);
    expect(snapshotBlockFrameStats().count).toBe(0);
  });
});
