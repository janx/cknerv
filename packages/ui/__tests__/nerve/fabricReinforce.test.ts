import { describe, it, expect } from 'vitest';
import {
  reinforceUsage,
  decayUsage,
  usageBrightnessBoost,
  warmRouteBrightnessGain,
  REINFORCE_AMOUNT,
  USAGE_CAP,
  USAGE_GAIN,
  USAGE_DECAY_HALF_LIFE_S,
} from '../../src/nerve/fabricReinforce';

describe('fabricReinforce — usage-driven self-organization', () => {
  describe('reinforceUsage', () => {
    it('bumps a cold edge by REINFORCE_AMOUNT', () => {
      expect(reinforceUsage(0)).toBeCloseTo(REINFORCE_AMOUNT, 6);
    });
    it('never exceeds the cap however hot', () => {
      expect(reinforceUsage(USAGE_CAP)).toBe(USAGE_CAP);
      expect(reinforceUsage(USAGE_CAP - REINFORCE_AMOUNT / 2)).toBe(USAGE_CAP);
    });
    it('honors a live-tuned amount', () => {
      expect(reinforceUsage(0, 0.5)).toBeCloseTo(0.5, 6);
    });
  });

  describe('decayUsage', () => {
    it('is unchanged when no time passes', () => {
      expect(decayUsage(1, 0)).toBe(1);
    });
    it('halves over one half-life', () => {
      expect(decayUsage(1, USAGE_DECAY_HALF_LIFE_S)).toBeCloseTo(0.5, 4);
      expect(decayUsage(1, 2 * USAGE_DECAY_HALF_LIFE_S)).toBeCloseTo(0.25, 4);
    });
    it('snaps a near-zero remnant to exactly 0 so the fabric can settle', () => {
      expect(decayUsage(1e-9, 1)).toBe(0);
      expect(decayUsage(1, 1000)).toBe(0);
    });
    it('honors a live-tuned half-life', () => {
      expect(decayUsage(1, 5, 5)).toBeCloseTo(0.5, 4);
    });
  });

  describe('usageBrightnessBoost', () => {
    it('is exactly 1 for a cold edge (zero-drift: ① unchanged with no activity)', () => {
      expect(usageBrightnessBoost(0)).toBe(1);
    });
    it('reaches 1 + USAGE_GAIN at the cap and increases monotonically', () => {
      expect(usageBrightnessBoost(USAGE_CAP)).toBeCloseTo(1 + USAGE_GAIN, 6);
      expect(usageBrightnessBoost(0.5 * USAGE_CAP)).toBeGreaterThan(usageBrightnessBoost(0));
      expect(usageBrightnessBoost(USAGE_CAP)).toBeGreaterThan(usageBrightnessBoost(0.5 * USAGE_CAP));
    });
    it('honors a live-tuned gain', () => {
      expect(usageBrightnessBoost(USAGE_CAP, 3)).toBeCloseTo(4, 6);
    });
  });

  describe('warmRouteBrightnessGain', () => {
    it('emits no overlay energy for a cold edge', () => {
      expect(warmRouteBrightnessGain(0)).toBe(0);
    });
    it('contains only the incremental gain above the passive baseline', () => {
      expect(warmRouteBrightnessGain(USAGE_CAP)).toBeCloseTo(USAGE_GAIN, 6);
      expect(warmRouteBrightnessGain(0.5, 3)).toBeCloseTo(1.5, 6);
    });
  });
});
