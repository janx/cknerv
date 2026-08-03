import { describe, expect, it } from 'vitest';
import {
  CONSENSUS_WRITE_SEAL_LIFETIME_S,
  consensusBlockColor,
  consensusCellColor,
  consensusChromaIntensity,
  compactConsensusWriteSealSlots,
  drainConsensusWriteSealArrivals,
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
  it('keeps resting routes deterministic, bounded, and vascular crimson', () => {
    const left = consensusRouteColors(0x1234_5600);
    const right = consensusRouteColors(0x1234_5600);

    expect(left).toEqual(right);
    expect([...left.from, ...left.to].every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(left.from[0]).toBeGreaterThan(left.from[2]);
    expect(left.to[0]).toBeGreaterThan(left.to[2]);
    expect(left.from[2]).toBeGreaterThan(left.from[1]);
    expect(left.to[2]).toBeGreaterThan(left.to[1]);
  });

  it('never assigns a false cold-network signal to an idle Cell route', () => {
    const routes = Array.from({ length: 64 }, (_, seed) => consensusRouteColors(seed * 0x1f_123));
    expect(routes.every(({ from, to }) => (
      from[0] > from[2] && to[0] > to[2]
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

  it('restores the living rose body while preserving explicit tag colours', () => {
    const visual = {
      assetClass: 2,
      lockClass: 3,
      mass: 1,
      payload: 0.8,
      seeds: [0.2, 0.7, 0.4, 0.9],
      accent: [0.94, 0.48, 0.68],
    } as const;
    const color = consensusCellColor(visual);
    const tagged = consensusCellColor(visual, true);

    expect(color).toEqual([1, 0.4, 0.44]);
    expect(tagged).toEqual([0.94, 0.48, 0.68]);
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

  it('drains write arrivals once and retains only the newest bounded slots', () => {
    const slots = [{
      cellId: 9,
      firedAt: 9.5,
      color: [1, 0, 0] as [number, number, number],
    }];
    const arrivals = new Map([
      [1, { firedAt: 9.7, color: [0, 1, 0] as [number, number, number] }],
      [2, { firedAt: 1, color: [0, 0, 1] as [number, number, number] }],
      [3, { firedAt: 10.2, color: [1, 1, 0] as [number, number, number] }],
    ]);
    const consumedCellIds = new Set<number>();

    expect(drainConsensusWriteSealArrivals(
      arrivals,
      slots,
      10,
      2,
      CONSENSUS_WRITE_SEAL_LIFETIME_S,
      consumedCellIds,
    )).toBe(2);
    expect(arrivals.size).toBe(0);
    expect(slots.map(({ cellId }) => cellId)).toEqual([1, 3]);
    expect([...consumedCellIds]).toEqual([1, 3]);
  });

  it('compacts expired and missing write seals in place', () => {
    const slots = [
      { cellId: 1, firedAt: 9, color: [1, 0, 0] as [number, number, number] },
      { cellId: 2, firedAt: 1, color: [0, 1, 0] as [number, number, number] },
      { cellId: 3, firedAt: 9, color: [0, 0, 1] as [number, number, number] },
    ];
    const cells = new Map<number, unknown>([[1, {}], [2, {}]]);

    expect(compactConsensusWriteSealSlots(slots, 10, cells, 2)).toBe(1);
    expect(slots.map(({ cellId }) => cellId)).toEqual([1]);
  });
});
