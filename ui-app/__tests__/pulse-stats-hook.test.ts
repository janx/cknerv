import { describe, expect, it } from 'vitest';
import { installPulseStatsHook } from '../src/pulse-stats-hook';

describe('installPulseStatsHook', () => {
  it('attaches read + reset functions to window', () => {
    installPulseStatsHook();
    expect(typeof window.__pulseStats).toBe('function');
    expect(typeof window.__pulseStatsReset).toBe('function');
    // The read hook returns a snapshot object with the expected shape.
    const snap = window.__pulseStats!();
    expect(snap).toHaveProperty('blocksTotal');
    expect(snap).toHaveProperty('linkReasons');
    // Recall counters ride the same surface: unification moved historical
    // recall onto the staged graph, so its availability has to be observable.
    expect(snap).toHaveProperty('recallOutcomes');
    expect(snap).toHaveProperty('recalledRatePct');
    // The quality verdict rides the same surface: the lock is only
    // verifiable if a probe can read `locked`/`switches` from the page.
    expect(typeof window.__qualityStats).toBe('function');
    const quality = window.__qualityStats!();
    expect(quality).toHaveProperty('effective');
    expect(quality).toHaveProperty('locked');
    expect(typeof quality.switches).toBe('number');
  });
});
