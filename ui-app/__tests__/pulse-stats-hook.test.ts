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
    // ⭐ And where each block wave started, on the same surface for the same
    // reason: "the flood begins at the node that made the block" is a claim
    // about a distribution, and a distribution cannot be verified by looking at
    // a scene. A probe resets, waits out a few dozen blocks, and divides.
    expect(typeof window.__producerOriginStats).toBe('function');
    expect(typeof window.__producerOriginStatsReset).toBe('function');
    const origins = window.__producerOriginStats!();
    expect(origins).toHaveProperty('waves');
    expect(origins).toHaveProperty('attested');
    expect(origins).toHaveProperty('anonymous');
    expect(origins).toHaveProperty('byProducer');
    expect(typeof origins.attestedRatePct).toBe('number');
    // Always attached, exactly as its neighbours are: the live pass runs
    // against a release build, and an instrument a release build drops is an
    // instrument that is not there when it is wanted.
    window.__producerOriginStatsReset!();
    expect(window.__producerOriginStats!().waves).toBe(0);
  });
});
