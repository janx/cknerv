import { beforeEach, describe, expect, it } from 'vitest';
import {
  pulseStats,
  snapshotPulseStats,
  resetPulseStats,
} from '../../src/nerve/pulseStats';

beforeEach(() => resetPulseStats());

describe('pulseStats.bump / bumpPath', () => {
  it('counts per-link reasons and path fails', () => {
    pulseStats.bump('fired');
    pulseStats.bump('no-source', 3);
    pulseStats.bumpPath('endpoint-missing');
    const s = snapshotPulseStats();
    expect(s.linkReasons.fired).toBe(1);
    expect(s.linkReasons['no-source']).toBe(3);
    expect(s.pathFails['endpoint-missing']).toBe(1);
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
    pulseStats.bump('no-source', 1);
    pulseStats.bump('backfill', 10); // excluded from the denominator
    expect(snapshotPulseStats().firedRatePct).toBeCloseTo(75, 6); // 3 / (3+1)
  });
});

describe('resetPulseStats', () => {
  it('zeros every counter and the rollup state', () => {
    pulseStats.bump('fired');
    pulseStats.observeLink(1, true);
    pulseStats.observeBlockTick();
    resetPulseStats();
    const s = snapshotPulseStats();
    expect(s.linkReasons.fired).toBe(0);
    expect(s.blocksTotal).toBe(0);
    expect(s.blocksWithLinks).toBe(0);
    expect(s.blocksLit).toBe(0);
  });
});
