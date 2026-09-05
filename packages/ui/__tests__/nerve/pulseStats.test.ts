import { beforeEach, describe, expect, it } from 'vitest';
import {
  pulseStats,
  snapshotPulseStats,
  resetPulseStats,
} from '../../src/nerve/pulseStats';

beforeEach(() => resetPulseStats());

describe('pulseStats.bump / bumpPath / bumpOrigin', () => {
  it('counts per-link reasons, path fails and origin honesty', () => {
    pulseStats.bump('fired');
    pulseStats.bump('no-origin', 3);
    pulseStats.bumpPath('endpoint-missing');
    pulseStats.bumpOrigin('origin-derived', 2);
    const s = snapshotPulseStats();
    expect(s.linkReasons.fired).toBe(1);
    expect(s.linkReasons['no-origin']).toBe(3);
    expect(s.pathFails['endpoint-missing']).toBe(1);
    expect(s.origins).toEqual({ 'origin-retained': 0, 'origin-derived': 2 });
  });

  /** T0's live baseline was captured against the sibling-proxy taxonomy. The
   *  exposed shape must stay a superset of it or the A/B comparison silently
   *  loses fields instead of showing them at zero. */
  it('keeps the retired sibling-proxy counters in the exposed shape, reading 0', () => {
    pulseStats.bump('fired');
    const s = snapshotPulseStats();
    expect(s.linkReasons['no-parents']).toBe(0);
    expect(s.linkReasons['no-source']).toBe(0);
    expect(Object.keys(s.linkReasons).sort()).toEqual([
      'all-paths-failed', 'backfill', 'batch-budget', 'fired',
      'no-origin', 'no-outputs', 'no-parents', 'no-source',
    ]);
  });
});

describe('pulseStats block rollup', () => {
  it('rolls up blocks by monotonic link.block, folding the open block into the snapshot', () => {
    pulseStats.observeLink(100, false); // block 100 opens, dark so far
    pulseStats.observeLink(100, true);  // block 100 lit
    pulseStats.observeLink(101, false); // block 100 closes (lit); 101 opens, dark
    pulseStats.observeLink(102, true);  // block 101 closes (dark); 102 opens, lit
    const s = snapshotPulseStats();
    expect(s.blocksWithLinks).toBe(3); // 100 + 101 closed, 102 open
    expect(s.blocksLit).toBe(2);       // 100 + 102
  });

  it('derives silent / empty / dark from blocksTotal and the rollup', () => {
    for (let i = 0; i < 5; i++) pulseStats.observeBlockTick(); // 5 blocks arrived
    pulseStats.observeLink(1, true);
    pulseStats.observeLink(2, false);
    pulseStats.observeLink(3, true); // stays open — folded into snapshot
    const s = snapshotPulseStats();
    expect(s.blocksTotal).toBe(5);
    expect(s.blocksWithLinks).toBe(3);
    expect(s.blocksLit).toBe(2);
    expect(s.blocksSilent).toBe(3);       // 5 - 2
    expect(s.blocksNoLinks).toBe(2);      // 5 - 3
    expect(s.blocksLinksButDark).toBe(1); // 3 - 2
  });
});

describe('pulseStats.firedRatePct', () => {
  it('is fired over planPulses terminal outcomes and excludes backfill', () => {
    pulseStats.bump('fired', 3);
    pulseStats.bump('no-origin', 1);
    pulseStats.bump('backfill', 10); // excluded from the denominator
    expect(snapshotPulseStats().firedRatePct).toBeCloseTo(75, 6); // 3 / (3+1)
  });
});

describe('pulseStats live-plan driver gauges', () => {
  it('counts deadline-forced slices and keeps the running max planner step', () => {
    pulseStats.observeForcedByDeadline();
    pulseStats.observeForcedByDeadline();
    // Running max, not last-write: a larger step raises it, a smaller one
    // leaves it, and it is never negative.
    pulseStats.observeStepMs(3.2);
    pulseStats.observeStepMs(1.1);
    pulseStats.observeStepMs(7.8);
    pulseStats.observeStepMs(0);
    const s = snapshotPulseStats();
    expect(s.forcedByDeadline).toBe(2);
    expect(s.maxStepMs).toBeCloseTo(7.8, 12);
  });

  it('reads zero before any slice runs', () => {
    const s = snapshotPulseStats();
    expect(s.forcedByDeadline).toBe(0);
    expect(s.maxStepMs).toBe(0);
  });
});

describe('resetPulseStats', () => {
  it('zeros every counter and the rollup state', () => {
    pulseStats.bump('fired');
    pulseStats.bumpOrigin('origin-retained');
    pulseStats.observeLink(1, true);
    pulseStats.observeBlockTick();
    pulseStats.observeForcedByDeadline();
    pulseStats.observeStepMs(5);
    resetPulseStats();
    const s = snapshotPulseStats();
    expect(s.linkReasons.fired).toBe(0);
    expect(s.origins['origin-retained']).toBe(0);
    expect(s.blocksTotal).toBe(0);
    expect(s.blocksWithLinks).toBe(0);
    expect(s.blocksLit).toBe(0);
    expect(s.forcedByDeadline).toBe(0);
    expect(s.maxStepMs).toBe(0);
  });
});

describe('pulseStats.bumpRecall', () => {
  beforeEach(() => resetPulseStats());

  it('counts recall outcomes and reports the success rate', () => {
    pulseStats.bumpRecall('recalled');
    pulseStats.bumpRecall('no-source', 2);
    pulseStats.bumpRecall('no-route');
    const snap = snapshotPulseStats();
    expect(snap.recallOutcomes).toEqual({
      recalled: 1,
      'link-missing': 0,
      'no-source': 2,
      'no-route': 1,
    });
    expect(snap.recalledRatePct).toBeCloseTo(25, 6);
  });

  it('reports a zero rate before any recall is attempted', () => {
    expect(snapshotPulseStats().recalledRatePct).toBe(0);
  });

  it('keeps recall counters clear of the per-link pulse counters', () => {
    pulseStats.bump('fired');
    pulseStats.bumpRecall('recalled');
    const snap = snapshotPulseStats();
    expect(snap.firedRatePct).toBeCloseTo(100, 6);
    expect(snap.recalledRatePct).toBeCloseTo(100, 6);
    expect(snap.linkReasons.fired).toBe(1);
    expect(snap.recallOutcomes.recalled).toBe(1);
  });
});
