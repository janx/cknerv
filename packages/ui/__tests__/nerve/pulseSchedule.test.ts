import { describe, expect, it } from 'vitest';
import {
  ghostLegDurationMs,
  GHOST_HOP_SCALE_MAX,
  GHOST_HOP_SCALE_MIN,
  makePulseLegHead,
  PULSE_LEG_GHOST,
  pulseLegArrivalMs,
  pulseLegExtinguishes,
  pulseLegHeadInto,
  pulseTerminalArrivalMs,
} from '../../src/nerve/pulseSchedule';
import {
  HOP_MS_BASE,
  MEDIAN_FABRIC_EDGE_LEN,
  pulseTiming,
} from '../../src/nerve/pulseRunner';
import type { CellLink } from '@cknerv/types';

const HOP_MS = 30;

function headAt(
  totalHops: number,
  ghostMs: number,
  elapsedMs: number,
  hopMs = HOP_MS,
) {
  return pulseLegHeadInto(
    makePulseLegHead(),
    totalHops,
    hopMs,
    ghostMs,
    elapsedMs,
  );
}

describe('ghostLegDurationMs', () => {
  it('floors a short leg at one hop — nothing reads faster than the fabric', () => {
    expect(ghostLegDurationMs(HOP_MS, 0)).toBe(HOP_MS * GHOST_HOP_SCALE_MIN);
    expect(ghostLegDurationMs(HOP_MS, MEDIAN_FABRIC_EDGE_LEN * 0.1))
      .toBe(HOP_MS);
    expect(ghostLegDurationMs(HOP_MS, MEDIAN_FABRIC_EDGE_LEN)).toBe(HOP_MS);
  });

  it('scales with the fabric stride between the two clamps', () => {
    expect(ghostLegDurationMs(HOP_MS, MEDIAN_FABRIC_EDGE_LEN * 2))
      .toBeCloseTo(HOP_MS * 2, 9);
    expect(ghostLegDurationMs(HOP_MS, MEDIAN_FABRIC_EDGE_LEN * 3.5))
      .toBeCloseTo(HOP_MS * 3.5, 9);
  });

  it('caps a cross-disc origin so it launches instead of crawling', () => {
    expect(ghostLegDurationMs(HOP_MS, MEDIAN_FABRIC_EDGE_LEN * 4))
      .toBeCloseTo(HOP_MS * GHOST_HOP_SCALE_MAX, 9);
    // A derived origin can sit the full width of the tissue away.
    expect(ghostLegDurationMs(HOP_MS, 400)).toBe(HOP_MS * GHOST_HOP_SCALE_MAX);
    expect(ghostLegDurationMs(HOP_MS_BASE, 400))
      .toBeCloseTo(HOP_MS_BASE * 4, 9);
  });

  it('falls to the floor rather than poisoning the schedule with NaN', () => {
    expect(ghostLegDurationMs(HOP_MS, Number.NaN)).toBe(HOP_MS);
    expect(ghostLegDurationMs(HOP_MS, Number.POSITIVE_INFINITY)).toBe(HOP_MS);
  });
});

describe('pulseLegHeadInto without a ghost', () => {
  it('reproduces the pre-ghost arithmetic exactly', () => {
    for (const elapsedMs of [0, 1, 29.999, 30, 74, 149.5, 3000]) {
      const expectedLeg = Math.floor(elapsedMs / HOP_MS);
      const head = headAt(80, 0, elapsedMs);
      if (expectedLeg >= 80) {
        expect(head.arrived).toBe(true);
      } else {
        expect(head.leg).toBe(expectedLeg);
        expect(head.subT).toBeCloseTo(elapsedMs / HOP_MS - expectedLeg, 9);
      }
    }
  });

  it('starts on hop 0, never on the ghost leg', () => {
    const head = headAt(4, 0, 0);
    expect(head.leg).toBe(0);
    expect(head.subT).toBe(0);
    expect(head.arrived).toBe(false);
  });
});

describe('pulseLegHeadInto with a ghost', () => {
  const GHOST_MS = 45;

  it('spends the leading window on the ghost leg', () => {
    expect(headAt(4, GHOST_MS, 0).leg).toBe(PULSE_LEG_GHOST);
    expect(headAt(4, GHOST_MS, 0).subT).toBe(0);
    expect(headAt(4, GHOST_MS, GHOST_MS / 2).subT).toBeCloseTo(0.5, 9);
    expect(headAt(4, GHOST_MS, GHOST_MS - 0.001).leg).toBe(PULSE_LEG_GHOST);
  });

  it('shifts every real hop boundary by exactly the ghost duration', () => {
    expect(headAt(4, GHOST_MS, GHOST_MS).leg).toBe(0);
    expect(headAt(4, GHOST_MS, GHOST_MS).subT).toBe(0);
    for (const t of [0, 15, 30, 45.5, 90, 119.9]) {
      const shifted = headAt(4, GHOST_MS, t + GHOST_MS);
      const plain = headAt(4, 0, t);
      expect(shifted.leg).toBe(plain.leg);
      expect(shifted.subT).toBeCloseTo(plain.subT, 9);
      expect(shifted.arrived).toBe(plain.arrived);
    }
  });

  it('delays arrival by the ghost instead of absorbing it', () => {
    expect(pulseTerminalArrivalMs(4, HOP_MS, 0)).toBe(4 * HOP_MS);
    expect(pulseTerminalArrivalMs(4, HOP_MS, GHOST_MS))
      .toBe(4 * HOP_MS + GHOST_MS);
    expect(headAt(4, GHOST_MS, 4 * HOP_MS + GHOST_MS - 0.001).arrived)
      .toBe(false);
    expect(headAt(4, GHOST_MS, 4 * HOP_MS + GHOST_MS).arrived).toBe(true);
  });

  it('lands a ghost-only packet at the ghost end', () => {
    // path.length === 1: the entry node IS the destination, so the ghost is
    // the entire journey.
    expect(pulseTerminalArrivalMs(0, HOP_MS, GHOST_MS)).toBe(GHOST_MS);
    expect(headAt(0, GHOST_MS, GHOST_MS - 0.001).leg).toBe(PULSE_LEG_GHOST);
    expect(headAt(0, GHOST_MS, GHOST_MS - 0.001).arrived).toBe(false);
    const arrived = headAt(0, GHOST_MS, GHOST_MS);
    expect(arrived.arrived).toBe(true);
    expect(arrived.leg).toBe(0); // the terminal node's index, not a leg
  });
});

describe('pulseLegArrivalMs', () => {
  it('lands the ghost on path[0] at the ghost end', () => {
    expect(pulseLegArrivalMs(HOP_MS, 45, PULSE_LEG_GHOST)).toBe(45);
    expect(pulseLegArrivalMs(HOP_MS, 0, PULSE_LEG_GHOST)).toBe(0);
  });

  it('keeps one hop between consecutive landings, ghost or not', () => {
    for (const ghostMs of [0, 45, 132]) {
      expect(pulseLegArrivalMs(HOP_MS, ghostMs, 0)).toBe(ghostMs + HOP_MS);
      for (let leg = 1; leg < 6; leg += 1) {
        const step = pulseLegArrivalMs(HOP_MS, ghostMs, leg)
          - pulseLegArrivalMs(HOP_MS, ghostMs, leg - 1);
        expect(step).toBeCloseTo(HOP_MS, 9);
      }
      // The last leg's landing IS the terminal arrival.
      expect(pulseLegArrivalMs(HOP_MS, ghostMs, 3))
        .toBeCloseTo(pulseTerminalArrivalMs(4, HOP_MS, ghostMs), 9);
    }
  });
});

describe('pulseLegExtinguishes', () => {
  it('exempts the ghost leg and no other', () => {
    expect(pulseLegExtinguishes(PULSE_LEG_GHOST)).toBe(false);
    expect(pulseLegExtinguishes(0)).toBe(true);
    expect(pulseLegExtinguishes(1)).toBe(true);
    expect(pulseLegExtinguishes(79)).toBe(true);
  });
});

describe('entry churn', () => {
  const link = {
    seq: 7,
    block: 42,
    tx_hash: '0xfeed',
    at_ms: 1_000,
    from_ids: [],
    to_ids: [900],
    parents: [],
    endpoint_anchors: [],
  } as unknown as CellLink;

  it('re-times nothing but the ghost when the stage offers another entry', () => {
    // Same consumed cell, same destination: the animation is seeded by the
    // anchor, never by whichever live node the stage happened to offer.
    const a = pulseTiming(link, 5_000, 900);
    const b = pulseTiming(link, 5_000, 900);
    expect(b).toEqual(a);

    // Two entries at different distances from the same origin.
    const nearMs = ghostLegDurationMs(a.hopMs, MEDIAN_FABRIC_EDGE_LEN);
    const farMs = ghostLegDurationMs(a.hopMs, MEDIAN_FABRIC_EDGE_LEN * 3);
    expect(farMs).toBeGreaterThan(nearMs);

    // Departure is the same instant; the cadence after the ghost is the same
    // hop time; only the whole tail shifts, by exactly the ghost difference.
    expect(headAt(3, nearMs, 0, a.hopMs).leg).toBe(PULSE_LEG_GHOST);
    expect(headAt(3, farMs, 0, a.hopMs).leg).toBe(PULSE_LEG_GHOST);
    const shift = farMs - nearMs;
    for (let leg = 0; leg < 3; leg += 1) {
      expect(
        pulseLegArrivalMs(a.hopMs, farMs, leg)
        - pulseLegArrivalMs(a.hopMs, nearMs, leg),
      ).toBeCloseTo(shift, 9);
    }
    expect(
      pulseTerminalArrivalMs(3, a.hopMs, farMs)
      - pulseTerminalArrivalMs(3, a.hopMs, nearMs),
    ).toBeCloseTo(shift, 9);
  });
});
