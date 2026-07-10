// packages/ui/__tests__/derives/specimenKit.test.ts
import { describe, it, expect } from 'vitest';
import {
  phylumForAsset, massFromCapacity, maturityFromAge, viabilityFromDeath,
  dataBytes, tintFromTag, hashToAcgt, seededRng, hashToBytes, randDir,
} from '../../src/derives/specimenKit';

describe('specimenKit', () => {
  it('maps asset_kind to phylum with a fallback', () => {
    expect(phylumForAsset('native')).toBe('radiolarian');
    expect(phylumForAsset('xudt')).toBe('colony');
    expect(phylumForAsset('sudt')).toBe('colony');
    expect(phylumForAsset('dao')).toBe('helix');
    expect(phylumForAsset('spore')).toBe('arbor');
    expect(phylumForAsset('other')).toBe('plasmid');
    expect(phylumForAsset(undefined)).toBe('plasmid');
  });
  it('mass is floored and rises with capacity', () => {
    const small = massFromCapacity(61e8), big = massFromCapacity(1_000_000e8);
    expect(small).toBeGreaterThanOrEqual(0.5);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThanOrEqual(1.11);
  });
  it('viability drops for a dead cell', () => {
    expect(viabilityFromDeath(null)).toBe(1);
    expect(viabilityFromDeath(5000)).toBeLessThan(1);
  });
  it('dataBytes counts hex bytes and tolerates a truncation ellipsis', () => {
    expect(dataBytes('0xdeadbeef')).toBe(4);
    expect(dataBytes('0xdeadbeef…')).toBe(4);
    expect(dataBytes('0x')).toBe(0);
  });
  it('hashToAcgt yields 2 bases per hex nibble from A/C/G/T only', () => {
    const g = hashToAcgt('0x1a2b');
    expect(g).toMatch(/^[ACGT]+$/);
    expect(g.length).toBe(8); // 4 nibbles × 2
  });
  it('seededRng is deterministic; randDir is unit-length', () => {
    const r1 = seededRng(hashToBytes('0x1234')), r2 = seededRng(hashToBytes('0x1234'));
    expect(r1()).toBe(r2());
    const d = randDir(seededRng(hashToBytes('0xabcd')));
    expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 5);
  });
});
