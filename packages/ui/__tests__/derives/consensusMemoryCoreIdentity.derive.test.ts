import { describe, expect, it } from 'vitest';
import type { CellVisualDescriptor } from '../../src/derives/cellVisual.derive';
import { consensusMemoryCoreIdentity } from '../../src/derives/consensusMemoryCoreIdentity.derive';

const VISUAL: CellVisualDescriptor = {
  assetClass: 0,
  lockClass: 0,
  mass: 0.84,
  payload: 0,
  seeds: [0.1, 0.2, 0.3, 0.4],
  accent: [1, 0.68, 0.35],
};

describe('consensusMemoryCoreIdentity', () => {
  it('normalizes the existing A field mapping for the far core', () => {
    expect(consensusMemoryCoreIdentity({
      ...VISUAL,
      assetClass: 7,
      lockClass: 4,
      payload: 0.72,
      mass: 1.2,
    })).toEqual({
      semantic: [1, 1, 0.72, 1],
      hashSeed: 0.3,
    });
  });

  it('keeps content identity independent from semantic classes', () => {
    const first = consensusMemoryCoreIdentity(VISUAL);
    const second = consensusMemoryCoreIdentity({
      ...VISUAL,
      assetClass: 3,
      lockClass: 2,
      payload: 1,
      mass: 1.1,
    });

    expect(first.hashSeed).toBe(second.hashSeed);
    expect(first.semantic).not.toEqual(second.semantic);
  });

  it('clamps malformed descriptor ranges to bounded shader inputs', () => {
    expect(consensusMemoryCoreIdentity({
      ...VISUAL,
      assetClass: -2,
      lockClass: 99,
      payload: -1,
      mass: 4,
      seeds: [0, 0, 2, 0],
    })).toEqual({
      semantic: [0, 1, 0, 1],
      hashSeed: 1,
    });
  });
});
