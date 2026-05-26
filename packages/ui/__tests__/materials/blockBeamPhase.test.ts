import { describe, expect, it } from 'vitest';
import { computeBeamPhase, type BeamPhaseConfig } from '../../src/materials/blockBeamPhase';

const CFG: BeamPhaseConfig = {
  chargeDur: 0.10,
  growDur: 0.15,   // charge 0.10 + burst 0.05
  holdDur: 0.10,
  strikeDur: 0.30, // hold 0.10 + retract 0.20
};

describe('computeBeamPhase', () => {
  it('reports idle when fireRef has not been written (age < 0)', () => {
    const p = computeBeamPhase(-0.01, CFG);
    expect(p.visible).toBe(false);
    expect(p.chargeVisible).toBe(false);
    expect(p.spriteVisible).toBe(false);
    expect(p.expired).toBe(false);
  });

  it('shows the charging point and hides the beam during pure charge (t < chargeDur)', () => {
    const p = computeBeamPhase(CFG.chargeDur / 2, CFG);
    expect(p.chargeVisible).toBe(true);
    expect(p.chargeSize).toBeGreaterThan(0);
    expect(p.chargeAlpha).toBeGreaterThan(0);
    expect(p.visible).toBe(false);             // beam not visible yet
    expect(p.spriteVisible).toBe(false);
    expect(p.expired).toBe(false);
  });

  it('peaks the charge at t = chargeDur', () => {
    const p = computeBeamPhase(CFG.chargeDur, CFG);
    expect(p.chargeVisible).toBe(true);
    expect(p.chargeSize).toBeCloseTo(1, 6);
    expect(p.chargeAlpha).toBeCloseTo(1, 6);
    // Beam visibility flips on at chargeDur.
    expect(p.visible).toBe(true);
  });

  it('collapses the charging point during the early-burst tail', () => {
    // 30% of chargeDur is the collapse tail; halfway through it the
    // charge should be near 0.5.
    const p = computeBeamPhase(CFG.chargeDur + CFG.chargeDur * 0.15, CFG);
    expect(p.chargeVisible).toBe(true);
    expect(p.chargeSize).toBeCloseTo(0.5, 6);
    expect(p.chargeAlpha).toBeCloseTo(0.5, 6);
    expect(p.visible).toBe(true);              // beam already launching
  });

  it('hides the charging point after the collapse tail completes', () => {
    const after = CFG.chargeDur + CFG.chargeDur * 0.3 + 1e-4;
    const p = computeBeamPhase(after, CFG);
    expect(p.chargeVisible).toBe(false);
    expect(p.chargeSize).toBe(0);
    expect(p.chargeAlpha).toBe(0);
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
    expect(p.chargeVisible).toBe(false);
    expect(p.spriteVisible).toBe(false);
  });

  it('reports expiry well past the strike window (single-frame stutter)', () => {
    const p = computeBeamPhase(CFG.growDur + CFG.strikeDur + 5.0, CFG);
    expect(p.expired).toBe(true);
    expect(p.visible).toBe(false);
    expect(p.chargeVisible).toBe(false);
    expect(p.spriteVisible).toBe(false);
  });
});
