// The colony's rebuild counters, driven through the real derives: a topology
// build counts once, its scaffold once as a hit or a miss, a flood once.
import { describe, expect, it } from 'vitest';
import {
  colonyStats,
  resetColonyStats,
  snapshotColonyStats,
} from '../../src/derives/colonyStats';
import { inferredTopology } from '../../src/derives/networkTopology.derive';
import { colonyFlood } from '../../src/derives/networkFlood.derive';

describe('colonyStats', () => {
  it('counts topology builds, scaffold hits and misses, and floods where they are paid', () => {
    resetColonyStats();
    // A fresh seed: the scaffold is built.
    const first = inferredTopology([], 4242);
    expect(snapshotColonyStats()).toMatchObject({
      topologyBuilds: 1,
      scaffoldMisses: 1,
      scaffoldHits: 0,
      floods: 0,
    });
    // The same staged ids: the measured overlay rebuilds, the scaffold does not.
    inferredTopology([], 4242);
    expect(snapshotColonyStats()).toMatchObject({
      topologyBuilds: 2,
      scaffoldMisses: 1,
      scaffoldHits: 1,
    });
    // A new seed misses again.
    inferredTopology([], 4243);
    expect(snapshotColonyStats().scaffoldMisses).toBe(2);

    colonyFlood(first, 1);
    colonyFlood(first, 2, null);
    expect(snapshotColonyStats().floods).toBe(2);
  });

  it('carries the layer counters and resets to zero', () => {
    resetColonyStats();
    colonyStats.observeEdgeGeometryBuild();
    colonyStats.observeCourierSchedule();
    colonyStats.observeCourierSchedule();
    colonyStats.observeDeliveryPlan();
    expect(snapshotColonyStats()).toMatchObject({
      edgeGeometryBuilds: 1,
      courierSchedules: 2,
      deliveryPlans: 1,
    });
    // The snapshot is a copy: scribbling on it reaches nothing.
    const copy = snapshotColonyStats();
    copy.deliveryPlans = 99;
    expect(snapshotColonyStats().deliveryPlans).toBe(1);
    resetColonyStats();
    expect(snapshotColonyStats()).toEqual({
      topologyBuilds: 0,
      scaffoldHits: 0,
      scaffoldMisses: 0,
      floods: 0,
      edgeGeometryBuilds: 0,
      courierSchedules: 0,
      deliveryPlans: 0,
    });
  });
});
