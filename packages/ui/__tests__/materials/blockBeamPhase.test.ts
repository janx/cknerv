import { describe, expect, it } from 'vitest';
import { computeBeamPhase, type BeamPhaseConfig } from '../../src/materials/blockBeamPhase';

const CFG: BeamPhaseConfig = {
  growDur: 0.15,
  holdDur: 0.10,
  strikeDur: 0.30, // hold 0.10 + retract 0.20
};

describe('computeBeamPhase', () => {
  it('reports idle when fireRef has not been written (age < 0)', () => {
    const p = computeBeamPhase(-0.01, CFG);
    expect(p.visible).toBe(false);
    expect(p.spriteVisible).toBe(false);
    expect(p.expired).toBe(false);
  });

  it('shows the beam immediately on launch — no charge pre-roll', () => {
    const p = computeBeamPhase(0.0001, CFG);
    expect(p.visible).toBe(true);        // visible from age 0 (strike on receive)
    expect(p.spriteVisible).toBe(false); // splash only once the beam lands
    expect(p.expired).toBe(false);
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
