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
  });
});
