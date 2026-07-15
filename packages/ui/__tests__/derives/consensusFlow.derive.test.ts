import { describe, expect, it } from 'vitest';
import {
  CONSENSUS_WRITE_SEAL_LIFETIME_S,
  consensusBlockColor,
  consensusCellColor,
  consensusChromaIntensity,
  consensusPacketColor,
  consensusRouteGoldMix,
  consensusRouteColors,
  consensusWriteSealState,
} from '../../src/derives/consensusFlow.derive';

const distance = (a: readonly number[], b: readonly number[]): number => Math.hypot(
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
);

describe('A consensus-flow visual contract', () => {
  it('keeps resting routes deterministic, bounded, and predominantly cool', () => {
    const left = consensusRouteColors(0x1234_5600);
    const right = consensusRouteColors(0x1234_5600);

    expect(left).toEqual(right);
    expect([...left.from, ...left.to].every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(left.from[2]).toBeGreaterThan(left.from[0]);
    expect(left.to[2]).toBeGreaterThan(left.to[0]);
  });

  it('never assigns a false gold signal to an idle route by hash alone', () => {
    const routes = Array.from({ length: 64 }, (_, seed) => consensusRouteColors(seed * 0x1f_123));
    expect(routes.every(({ from, to }) => (
      from[2] > from[0] && to[2] > to[0]
    ))).toBe(true);
  });

  it('turns hierarchy and observed traffic into a bounded gold signal', () => {
    const cold = consensusRouteGoldMix(0, 0);
    const trunk = consensusRouteGoldMix(1, 0);
    const used = consensusRouteGoldMix(0, 1);

    expect(cold).toBe(0);
    expect(trunk).toBeCloseTo(0.28, 6);
    expect(used).toBeCloseTo(0.82, 6);
    expect(used).toBeGreaterThan(trunk);
  });

  it('keeps resting Cell identity inside the structural cyan family', () => {
    const color = consensusCellColor({
      assetClass: 2,
      lockClass: 3,
      mass: 1,
      payload: 0.8,
      seeds: [0.2, 0.7, 0.4, 0.9],
      accent: [0.94, 0.48, 0.68],
    });

    expect(color[2]).toBeGreaterThan(color[0]);
    expect(color.every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it('uses tx identity within the warm information lane and keeps tags secondary', () => {
    const first = consensusPacketColor('0xtx-a', null);
    const second = consensusPacketColor('0xtx-b', null);
    const tagged = consensusPacketColor('0xtx-a', 'wallet');

    expect(consensusPacketColor('0xtx-a', null)).toEqual(first);
    expect(first[0]).toBeGreaterThan(first[2]);
    expect(second[0]).toBeGreaterThan(second[2]);
    expect(first).not.toEqual(second);
    expect(distance(first, tagged)).toBeLessThan(0.1);
  });

  it('soft-knees active energy before it can erase the packet hue', () => {
    expect(consensusChromaIntensity(-1)).toBe(0);
    expect(consensusChromaIntensity(Number.NaN)).toBe(0);
    expect(consensusChromaIntensity(1)).toBeGreaterThan(0.5);
    expect(consensusChromaIntensity(2.2)).toBeLessThan(1);
    expect(consensusChromaIntensity(100)).toBeCloseTo(1.12, 6);
  });

  it('gives block carriers a stable, bounded warm information colour', () => {
    const colors = Array.from({ length: 24 }, (_, nonce) => consensusBlockColor(nonce));

    expect(consensusBlockColor(7)).toEqual(consensusBlockColor(7));
    expect(colors.flat().every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(colors.every((color) => color[0] > color[2])).toBe(true);
  });

  it('expands a write seal, then contracts it into a fading memory latch', () => {
    expect(consensusWriteSealState(0).visible).toBe(false);
    expect(consensusWriteSealState(CONSENSUS_WRITE_SEAL_LIFETIME_S).visible).toBe(false);

    const early = consensusWriteSealState(0.06);
    const expanded = consensusWriteSealState(0.36);
    const latched = consensusWriteSealState(1.5);
    const late = consensusWriteSealState(CONSENSUS_WRITE_SEAL_LIFETIME_S - 0.1);

    expect(early.visible).toBe(true);
    expect(early.core).toBeGreaterThan(0.9);
    expect(expanded.radius).toBeGreaterThan(early.radius);
    expect(expanded.opacity).toBeGreaterThan(0.8);
    expect(expanded.core).toBe(0);
    expect(expanded.memory).toBe(0);
    expect(latched.radius).toBeLessThan(expanded.radius);
    expect(latched.opacity).toBeGreaterThan(0.1);
    expect(latched.core).toBeGreaterThan(0.3);
    expect(latched.memory).toBeGreaterThan(0.9);
    expect(late.opacity).toBeLessThan(latched.opacity);
  });
});
