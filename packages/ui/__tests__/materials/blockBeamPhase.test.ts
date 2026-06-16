import { describe, expect, it } from 'vitest';
import { computeBeamPhase, type BeamPhaseConfig } from '../../src/materials/blockBeamPhase';

const CFG: BeamPhaseConfig = {
  growDur: 0.15,
  holdDur: 0.10,
  strikeDur: 0.30, // hold 0.10 + retract 0.20
};

describe('computeBeamPhase', () => {
  it('hides the beam body before launch (age < 0)', () => {
    const p = computeBeamPhase(-0.01, CFG);
    expect(p.visible).toBe(false);
    expect(p.spriteVisible).toBe(false);
    expect(p.expired).toBe(false);
  });

  it('is fully idle well before launch (age < −chargeDur)', () => {
    const p = computeBeamPhase(-0.5, CFG); // default chargeDur 0.25 → −0.5 < −0.25
    expect(p.charging).toBe(false);
    expect(p.chargeT).toBe(0);
    expect(p.visible).toBe(false);
    expect(p.expired).toBe(false);
  });

  it('shows the beam immediately on launch (age ≥ 0), not charging', () => {
    const p = computeBeamPhase(0.0001, CFG);
    expect(p.visible).toBe(true);        // visible from age 0 (strike on receive)
    expect(p.spriteVisible).toBe(false); // splash only once the beam lands
    expect(p.expired).toBe(false);
    expect(p.charging).toBe(false);
    expect(p.chargeT).toBe(0);
  });

  it('keeps the beam visible while it grows toward the cell plane', () => {
    const p = computeBeamPhase(CFG.growDur / 2, CFG);
    expect(p.visible).toBe(true);
    expect(p.spriteVisible).toBe(false);
  });

  it('starts the strike-splash at t = growDur', () => {
    const p = computeBeamPhase(CFG.growDur, CFG);
    expect(p.visible).toBe(true);
    expect(p.spriteVisible).toBe(true);
    expect(p.spriteSize).toBeCloseTo(0, 6);
    expect(p.spriteAlpha).toBeCloseTo(1, 6);
    expect(p.expired).toBe(false);
  });

  it('reaches sprite peak size within the first ~33% of the strike window', () => {
    const p = computeBeamPhase(CFG.growDur + CFG.strikeDur * 0.33, CFG);
    expect(p.spriteVisible).toBe(true);
    expect(p.spriteSize).toBeCloseTo(1, 4);
    expect(p.spriteAlpha).toBeCloseTo(1, 6);
  });

  it('starts fading sprite alpha past the half-mark of the strike window', () => {
    const p = computeBeamPhase(CFG.growDur + CFG.strikeDur * 0.75, CFG);
    expect(p.spriteVisible).toBe(true);
    expect(p.spriteSize).toBeCloseTo(1, 6);    // size held at peak
    expect(p.spriteAlpha).toBeCloseTo(0.5, 6); // alpha midway through fade
  });

  it('reports expiry at or past growDur + strikeDur', () => {
    const p = computeBeamPhase(CFG.growDur + CFG.strikeDur, CFG);
    expect(p.expired).toBe(true);
    expect(p.visible).toBe(false);
    expect(p.spriteVisible).toBe(false);
  });

  it('reports expiry well past the strike window (single-frame stutter)', () => {
    const p = computeBeamPhase(CFG.growDur + CFG.strikeDur + 5.0, CFG);
    expect(p.expired).toBe(true);
    expect(p.visible).toBe(false);
    expect(p.spriteVisible).toBe(false);
  });
});

describe('computeBeamPhase — charge pre-roll', () => {
  const C: BeamPhaseConfig = { growDur: 0.15, holdDur: 0.10, strikeDur: 0.30, chargeDur: 0.20 };

  it('opens the charge window at age = −chargeDur (chargeT 0, body hidden)', () => {
    const p = computeBeamPhase(-0.20, C);
    expect(p.charging).toBe(true);
    expect(p.chargeT).toBeCloseTo(0, 6);
    expect(p.visible).toBe(false);
    expect(p.spriteVisible).toBe(false);
    expect(p.expired).toBe(false);
  });

  it('ramps chargeT 0 → 1 across the window', () => {
    expect(computeBeamPhase(-0.10, C).chargeT).toBeCloseTo(0.5, 6);
    expect(computeBeamPhase(-0.001, C).chargeT).toBeCloseTo(0.995, 3);
  });

  it('is fully idle just before the window opens', () => {
    const p = computeBeamPhase(-0.2001, C);
    expect(p.charging).toBe(false);
    expect(p.chargeT).toBe(0);
  });

  it('stops charging exactly at launch (age = 0)', () => {
    const p = computeBeamPhase(0, C);
    expect(p.charging).toBe(false);
    expect(p.chargeT).toBe(0);
    expect(p.visible).toBe(true);
  });

  it('treats chargeDur = 0 as no pre-roll', () => {
    const p = computeBeamPhase(-0.01, { ...C, chargeDur: 0 });
    expect(p.charging).toBe(false);
    expect(p.visible).toBe(false);
  });
});
