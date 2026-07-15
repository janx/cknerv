import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CellVisualDescriptor } from '../../src/derives/cellVisual.derive';
import {
  CONSENSUS_BRAID_FIELDS,
  consensusBraidAgreementTarget,
  consensusBraidBirthPhase,
  consensusBraidLayerOpacity,
  consensusBraidFrequencies,
  consensusBraidPoint,
  consensusBraidSpecs,
  consensusBraidStrandCount,
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

  it('maps readable fields to distinct A layers', () => {
    const normal = consensusBraidLayerOpacity(null, 3);
    const capacity = consensusBraidLayerOpacity('capacity', 3);
    const asset = consensusBraidLayerOpacity('asset', 3);
    const lock = consensusBraidLayerOpacity('lock', 3);
    const data = consensusBraidLayerOpacity('data', 3);
    const born = consensusBraidLayerOpacity('born', 3);

    expect(capacity.ribbon).toBeGreaterThan(capacity.streamCore);
    expect(asset.streamCore).toBeGreaterThan(asset.ribbon);
    expect(lock.streamCore).toBeGreaterThan(lock.agreementCore);
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
});
