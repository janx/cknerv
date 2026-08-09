import { describe, it, expect } from 'vitest';
import {
  colonyCourierSchedule,
  courierScheduleHorizon,
} from '../src/derives/colonyCourier.derive';
import type { ColonyFlood } from '../src/derives/networkFlood.derive';
import type { Vec3 } from '../src/types';

const p = (x: number): Vec3 => [x, 0, 0];
// Tree: A(origin)→B→C, A→D. Arrivals monotonic along the tree.
const cf: ColonyFlood = {
  entryId: 'A', localReceiveDelayS: 0, arrivals: {}, senders: {},
  colonyArrivalS: { A: 0, B: 0.5, C: 1.2, D: 0.8 },
  colonyPredecessor: { A: null, B: 'A', C: 'B', D: 'A' },
};
const posById = new Map<string, Vec3>([['A', p(0)], ['B', p(1)], ['C', p(2)], ['D', p(3)]]);

describe('colonyCourierSchedule', () => {
  it('one courier per non-origin node, flung from its predecessor, timed by arrivals', () => {
    const hops = colonyCourierSchedule(cf, posById);
    expect(hops.map((h) => h.id).sort()).toEqual(['B', 'C', 'D']); // A (origin) has none
    const b = hops.find((h) => h.id === 'B')!;
    expect(b.from).toEqual(p(0)); // A
    expect(b.to).toEqual(p(1));   // B
    expect(b.launchAge).toBe(0);  // A's arrival
    expect(b.arriveAge).toBe(0.5);// B's arrival
    const c = hops.find((h) => h.id === 'C')!;
    expect(c.from).toEqual(p(1)); // B (C's predecessor)
    expect(c.launchAge).toBe(0.5);// B's arrival
    expect(c.arriveAge).toBe(1.2);// C's arrival
  });

  it('origin gets no courier; every hop rides a real tree edge, launch <= arrive', () => {
    const hops = colonyCourierSchedule(cf, posById);
    expect(hops.some((h) => h.id === 'A')).toBe(false);
    for (const h of hops) {
      expect(cf.colonyPredecessor[h.id]).toBeTruthy();
      expect(h.arriveAge).toBe(cf.colonyArrivalS[h.id]);
      expect(h.launchAge).toBeLessThanOrEqual(h.arriveAge);
    }
  });

  it('skips nodes whose own or predecessor position is missing', () => {
    const partial = new Map<string, Vec3>([['A', p(0)], ['B', p(1)]]); // C, D absent
    const hops = colonyCourierSchedule(cf, partial);
    expect(hops.map((h) => h.id)).toEqual(['B']);
  });
});

describe('courierScheduleHorizon', () => {
  it('is the latest arrival — every hop window ends at its arriveAge', () => {
    const hops = colonyCourierSchedule(cf, posById);
    const horizon = courierScheduleHorizon(hops);
    expect(horizon).toBe(1.2); // C, the deepest node
    for (const h of hops) expect(h.arriveAge).toBeLessThanOrEqual(horizon);
  });

  it('empty schedule retires immediately', () => {
    expect(courierScheduleHorizon([])).toBe(0);
  });
});
