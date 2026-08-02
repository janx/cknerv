import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CellVisualDescriptor } from '../../src/derives/cellVisual.derive';
import {
  CONSENSUS_BRAID_FIELDS,
  consensusBraidAgreementTarget,
  consensusBraidAgreementResolution,
  consensusBraidBirthPhase,
  consensusBraidLayerOpacity,
  consensusBraidContributorColor,
  consensusBraidPresenceScale,
  consensusBraidFrequencies,
  consensusBraidPoint,
  consensusBraidSpecs,
  consensusBraidStrandCount,
  deriveConsensusBraidTopology,
} from '../../src/derives/consensusBraid.derive';

const VISUAL: CellVisualDescriptor = {
  assetClass: 0,
  lockClass: 0,
  mass: 1,
  payload: 0.5,
  seeds: [0.1, 0.2, 0.3, 0.4],
  accent: [1, 0.68, 0.35],
};

describe('canonical consensus braid mapping', () => {
  it('defines the six readable on-chain fields in scan order', () => {
    expect(CONSENSUS_BRAID_FIELDS).toEqual([
      'capacity',
      'asset',
      'lock',
      'data',
      'state',
      'born',
    ]);
  });

  it('maps asset classes to stable frequency families', () => {
    expect(Array.from({ length: 6 }, (_, asset) => consensusBraidFrequencies(asset))).toEqual([
      [2, 3, 4],
      [2, 3, 5],
      [3, 4, 7],
      [1, 3, 5],
      [3, 5, 6],
      [2, 5, 7],
    ]);
  });

  it('maps lock classes to a bounded contributor count', () => {
    expect(Array.from({ length: 5 }, (_, lock) => consensusBraidStrandCount(lock))).toEqual([
      3,
      4,
      4,
      5,
      5,
    ]);
  });

  it('produces identical portrait and LOD-ready specs for the same descriptor', () => {
    const left = consensusBraidSpecs(VISUAL);
    const right = consensusBraidSpecs(VISUAL);
    expect(left).toEqual(right);
    expect(left).toHaveLength(3);
    expect(left[0]).toMatchObject({ a: 2, b: 3, c: 4 });

    const pointA = consensusBraidPoint(left[0], 1.25, new THREE.Vector3());
    const pointB = consensusBraidPoint(right[0], 1.25, new THREE.Vector3());
    expect(pointA.toArray()).toEqual(pointB.toArray());
  });

  it('derives the agreement-node target from contributors and payload', () => {
    expect(consensusBraidAgreementTarget({ ...VISUAL, payload: 0 })).toBe(2);
    expect(consensusBraidAgreementTarget(VISUAL)).toBe(4);
    expect(consensusBraidAgreementTarget({
      ...VISUAL,
      lockClass: 4,
      payload: 1,
    })).toBe(12);
  });

  it('resolves canonical agreement knots sequentially from shared convergence', () => {
    expect(Array.from({ length: 4 }, (_, index) => (
      consensusBraidAgreementResolution(index, 4, 0)
    ))).toEqual([0, 0, 0, 0]);
    expect(consensusBraidAgreementResolution(0, 4, 0.25)).toBe(1);
    expect(consensusBraidAgreementResolution(1, 4, 0.25)).toBe(0);
    expect(Array.from({ length: 4 }, (_, index) => (
      consensusBraidAgreementResolution(index, 4, 1)
    ))).toEqual([1, 1, 1, 1]);
    expect(consensusBraidAgreementResolution(0, 0, 1)).toBe(0);
  });

  it('resolves one stable full-density agreement constellation', () => {
    const dense = {
      ...VISUAL,
      lockClass: 4,
      payload: 1,
      seeds: [0.93, 0.17, 0.61, 0.38] as const,
    };
    const left = deriveConsensusBraidTopology(dense, 12_345);
    const right = deriveConsensusBraidTopology(dense, 12_345);

    expect(left).toEqual(right);
    expect(left.agreements).toHaveLength(consensusBraidAgreementTarget(dense));
    expect(left.agreements).toHaveLength(12);
    expect(Array.from({ length: 4 }, (_, pair) => (
      left.agreements.filter((agreement) => agreement.pair === pair).length
    ))).toEqual([3, 3, 3, 3]);
    expect(left.agreements.map((agreement) => agreement.ordinal)).toEqual([
      0, 1, 2,
      0, 1, 2,
      0, 1, 2,
      0, 1, 2,
    ]);
    expect(left.birthPhase).toBe(consensusBraidBirthPhase(12_345));
  });

  it('maps capacity mass to one monotonic bounded presence scale', () => {
    const low = consensusBraidPresenceScale(0.84);
    const middle = consensusBraidPresenceScale(1);
    const high = consensusBraidPresenceScale(1.2);

    expect(low).toBeCloseTo(1.02);
    expect(low).toBeLessThan(middle);
    expect(middle).toBeLessThan(high);
    expect(consensusBraidPresenceScale(-10)).toBe(low);
    expect(consensusBraidPresenceScale(10)).toBe(high);
  });

  it('maps readable fields to distinct A layers', () => {
    const normal = consensusBraidLayerOpacity(null, 3);
    const capacity = consensusBraidLayerOpacity('capacity', 3);
    const asset = consensusBraidLayerOpacity('asset', 3);
    const lock = consensusBraidLayerOpacity('lock', 3);
    const data = consensusBraidLayerOpacity('data', 3);
    const born = consensusBraidLayerOpacity('born', 3);

    expect(capacity.ribbon).toBeGreaterThan(capacity.streamCore);
    expect(asset.streamCore).toBeGreaterThan(asset.ribbon);
    expect(asset.streamFlow).toBeGreaterThan(normal.streamFlow);
    expect(lock.streamCore).toBeGreaterThan(lock.agreementCore);
    expect(lock.streamFlow).toBeGreaterThan(data.streamFlow);
    expect(data.stitchCore).toBeGreaterThan(data.ribbon);
    expect(data.knotCore).toBeGreaterThan(data.streamCore);
    expect(born.packet).toBeGreaterThan(born.streamCore);
    expect(consensusBraidLayerOpacity('state', 3)).toEqual(normal);
  });

  it('turns birth block into a stable wrapped packet phase', () => {
    expect(consensusBraidBirthPhase(0)).toBe(0);
    expect(consensusBraidBirthPhase(1024)).toBeCloseTo(Math.PI / 2);
    expect(consensusBraidBirthPhase(4096)).toBe(0);
    expect(consensusBraidBirthPhase(-1)).toBeGreaterThan(6);
  });

  it('keeps the production Cell braid in the warm biological family', () => {
    const tissue = consensusBraidContributorColor(0, 0.5);
    const synapse = consensusBraidContributorColor(1, 0.5);
    const memory = consensusBraidContributorColor(2, 0.5);

    expect(tissue[0]).toBeGreaterThan(tissue[2]);
    expect(synapse[0]).toBeGreaterThan(synapse[2]);
    expect(memory[0]).toBeGreaterThan(memory[1]);
  });
});
