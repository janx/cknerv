import { describe, it, expect } from 'vitest';
import {
  computeRuntimeStats, fpsColor, fmtCompact,
  setStats, getStatsSnapshot, subscribeStats, ZERO_STATS,
  type RenderInfoLike,
} from '../../src/tweaks/renderStatsStore';
import { HUD_COLORS } from '../../src/components/hud/hudTheme';

const info: RenderInfoLike = {
  render: { calls: 300, triangles: 90000 },
  memory: { geometries: 50, textures: 20 },
  programs: { length: 10 },
};

describe('computeRuntimeStats', () => {
  it('per-frame averages + instantaneous memory/program counts', () => {
    const s = computeRuntimeStats(15, 250, info);
    expect(s.fps).toBeCloseTo(60);
    expect(s.msPerFrame).toBeCloseTo(250 / 15);
    expect(s.drawCalls).toBe(20);   // 300/15
    expect(s.triangles).toBe(6000); // 90000/15
    expect(s.geometries).toBe(50);
    expect(s.textures).toBe(20);
    expect(s.programs).toBe(10);
  });
  it('guards frames=0 / elapsed=0 (no NaN/Infinity)', () => {
    const s = computeRuntimeStats(0, 0, info);
    expect(s.fps).toBe(0);
    expect(s.msPerFrame).toBe(0);
    expect(s.drawCalls).toBe(0);
    expect(s.triangles).toBe(0);
  });
  it('programs defaults to 0 when null', () => {
    expect(computeRuntimeStats(1, 16, { ...info, programs: null }).programs).toBe(0);
  });
  it('averages the window\'s uploaded bytes per frame, and reads 0 without a ledger delta', () => {
    // gl.info counts no buffer traffic: the upload figure is the ledger's
    // window delta, per frame like DRAW and TRIS.
    expect(computeRuntimeStats(15, 250, info, 1500).uploadBytesPerFrame).toBe(100);
    expect(computeRuntimeStats(15, 250, info).uploadBytesPerFrame).toBe(0);
    expect(computeRuntimeStats(0, 0, info, 1500).uploadBytesPerFrame).toBe(0);
    expect(ZERO_STATS.uploadBytesPerFrame).toBe(0);
  });
  it('averages each GPU stream over its own frames and reads null, never zero, without one', () => {
    // A bracket frame carries no scopes and a scope frame no bracket, so the
    // two are ms per frame OF THEIR KIND, and the remainder is their difference.
    const both = computeRuntimeStats(15, 250, info, 0, {
      bracketMs: 10, bracketFrames: 4, scopedMs: 9, scopeFrames: 6,
    });
    expect(both.gpuFrameMs).toBeCloseTo(2.5);
    expect(both.gpuUnscopedMs).toBeCloseTo(1);
    // Signed: scopes summing past the frame is a reading, not noise.
    expect(computeRuntimeStats(15, 250, info, 0, {
      bracketMs: 4, bracketFrames: 4, scopedMs: 9, scopeFrames: 6,
    }).gpuUnscopedMs).toBeCloseTo(-0.5);
    // No bracket resolved yet, or timer queries unsupported: nothing to print.
    const bracketless = computeRuntimeStats(15, 250, info, 0, {
      bracketMs: 0, bracketFrames: 0, scopedMs: 9, scopeFrames: 6,
    });
    expect(bracketless.gpuFrameMs).toBeNull();
    expect(bracketless.gpuUnscopedMs).toBeNull();
    const scopeless = computeRuntimeStats(15, 250, info, 0, {
      bracketMs: 10, bracketFrames: 4, scopedMs: 0, scopeFrames: 0,
    });
    expect(scopeless.gpuFrameMs).toBeCloseTo(2.5);
    expect(scopeless.gpuUnscopedMs).toBeNull();
    expect(computeRuntimeStats(15, 250, info).gpuFrameMs).toBeNull();
    expect(ZERO_STATS.gpuFrameMs).toBeNull();
    expect(ZERO_STATS.gpuUnscopedMs).toBeNull();
  });
});

describe('fpsColor', () => {
  it('reads the house severity ramp, one rung per state', () => {
    // Named, not spelled — the whole finding. These three used to be Tailwind
    // defaults, a private ramp beside the declared one, and the panel's only
    // coloured reading was therefore the one green on screen that did not
    // match any other healthy reading.
    expect(fpsColor(60)).toBe(HUD_COLORS.nominal);
    expect(fpsColor(45)).toBe(HUD_COLORS.caution);
    expect(fpsColor(20)).toBe(HUD_COLORS.danger);
  });

  it('changes rung exactly at the thresholds it documents', () => {
    // The boundaries are the behaviour; the tokens above are only what the
    // behaviour is painted in. Kept separate so a retune of the palette and a
    // retune of the thresholds fail as two different tests.
    expect(fpsColor(55)).toBe(HUD_COLORS.nominal);
    expect(fpsColor(54.9)).toBe(HUD_COLORS.caution);
    expect(fpsColor(30)).toBe(HUD_COLORS.caution);
    expect(fpsColor(29.9)).toBe(HUD_COLORS.danger);
  });

  it('spends three distinct rungs, so the three states are three colours', () => {
    const rungs = new Set([fpsColor(60), fpsColor(45), fpsColor(20)]);
    expect(rungs.size).toBe(3);
  });
});

describe('fmtCompact', () => {
  it('formats <1k / k / M and guards negatives', () => {
    expect(fmtCompact(300)).toBe('300');
    expect(fmtCompact(6000)).toBe('6.0k');
    expect(fmtCompact(90000)).toBe('90.0k');
    expect(fmtCompact(150000)).toBe('150k');
    expect(fmtCompact(2_500_000)).toBe('2.5M');
    expect(fmtCompact(-1)).toBe('—');
  });
});

describe('stats store', () => {
  it('setStats swaps the snapshot ref + notifies; getSnapshot stable until next setStats; unsub stops notifications', () => {
    const before = getStatsSnapshot();
    let notified = 0;
    const unsub = subscribeStats(() => { notified += 1; });
    const next = computeRuntimeStats(15, 250, info);
    setStats(next);
    expect(notified).toBe(1);
    expect(getStatsSnapshot()).toBe(next);       // new ref
    expect(getStatsSnapshot()).toBe(next);       // stable between updates
    expect(getStatsSnapshot()).not.toBe(before);
    unsub();
    setStats(ZERO_STATS);
    expect(notified).toBe(1);                    // no notify after unsub
  });
});
