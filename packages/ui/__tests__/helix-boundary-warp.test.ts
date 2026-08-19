import { describe, expect, it } from 'vitest';
import {
  FIELD_HALF_X,
  FIELD_HALF_Z,
  TISSUE_ENVELOPE_EDGE,
  boundaryWarpBound,
  boundaryWarpGain,
  helixSeedF64,
  tissueSampleAt,
} from '../src/helix';

// The boundary warp is the only term in the law that is stated in the same
// units as the thing it perturbs, so it is the only one that has to be
// re-derived when a consumer re-closes the envelope somewhere else. These are
// the two properties that makes safe: it changes nothing at the default edge,
// and it stays honest about its own reach.
describe('the boundary warp follows the boundary it warps', () => {
  it('is inert at the edge the Cells are placed under', () => {
    // The parity fixture and every constant it anchors live behind this: a
    // gain of exactly one means `tissueSampleAt`'s default path is the
    // sampler's own arithmetic, bit for bit, not merely close to it.
    expect(boundaryWarpGain(TISSUE_ENVELOPE_EDGE)).toBe(1);
    expect(boundaryWarpBound(TISSUE_ENVELOPE_EDGE)).toBeCloseTo(0.185, 12);
    for (let id = 1; id <= 400; id += 1) {
      const [x, , z] = helixSeedF64(id);
      const a = tissueSampleAt(x, z);
      const b = tissueSampleAt(x, z, TISSUE_ENVELOPE_EDGE);
      expect(a.density).toBe(b.density);
      expect(a.density).toBe(a.resolvedCoverage);
    }
  });

  it('never shrinks the tear when a consumer crops inward', () => {
    // Closing the envelope EARLIER crops the drawn set; it does not restate
    // where the organism ends, and smoothing the rim with it would sand down a
    // boundary the addressable Cells are still standing on.
    expect(boundaryWarpGain(0.5)).toBe(1);
    expect(boundaryWarpGain(0.9)).toBe(1);
  });

  it('holds the tear at a fixed fraction of its own radius', () => {
    // The derivation, stated as the property rather than as the number: an
    // outline's irregularity is its wobble against its own size, so that ratio
    // is what has to survive a move of the boundary.
    const cellRatio = boundaryWarpBound(TISSUE_ENVELOPE_EDGE) / TISSUE_ENVELOPE_EDGE;
    for (const edge of [1.3, 1.6, 1.7, 2.2]) {
      expect(boundaryWarpBound(edge) / edge).toBeCloseTo(cellRatio, 12);
    }
  });

  it('bounds the support of the envelope it closes', () => {
    // What a rejection majorant and a sampling box both need: past this the
    // closed envelope is exactly zero, so a box drawn here crops nothing.
    const edge = 1.6;
    const reach = edge + boundaryWarpBound(edge);
    let found = 0;
    for (let i = 0; i < 4000; i += 1) {
      const th = (i / 4000) * Math.PI * 2;
      // Just outside the bound, in every direction, the field is silent.
      const r = reach + 1e-6;
      const d = tissueSampleAt(
        Math.cos(th) * FIELD_HALF_X * r,
        Math.sin(th) * FIELD_HALF_Z * r,
        edge,
      ).density;
      expect(d).toBe(0);
      // And inside it, somewhere, it is not — or the bound would be vacuous.
      if (tissueSampleAt(
        Math.cos(th) * FIELD_HALF_X * (edge + 0.02),
        Math.sin(th) * FIELD_HALF_Z * (edge + 0.02),
        edge,
      ).density > 0) found += 1;
    }
    expect(found).toBeGreaterThan(0);
  });
});
