import { describe, it, expect } from 'vitest';
import { genArbor } from '../../src/derives/specimenPhyla';

const H = '0x' + 'ab'.repeat(32);
describe('genArbor', () => {
  it('is deterministic and produces geometry + four landmarks', () => {
    const a = genArbor(H, { maturity: 0.7 }), b = genArbor(H, { maturity: 0.7 });
    expect(a.segments.length).toBe(b.segments.length);
    expect(a.segments.length).toBeGreaterThan(0);
    expect(a.nodes.length).toBeGreaterThan(0);
    for (const k of ['core', 'species', 'membrane', 'outer'] as const) {
      expect(a.landmarks[k]).toHaveLength(3);
    }
    expect(a.landmarks.core).toEqual([0, 0, 0]);
  });
});

import { genRadiolarian } from '../../src/derives/specimenPhyla';
describe('genRadiolarian', () => {
  it('has a membrane, ≥9 filopodia strands, a central body node, and landmarks', () => {
    const g = genRadiolarian(H, { maturity: 0.6 });
    expect(g.membraneR).toBeGreaterThan(0);
    expect(g.segments.length / 6).toBeGreaterThanOrEqual(9 * 5); // ≥9 rays × 5 segs (floor)
    expect(g.nodes.some((n) => n.x === 0 && n.y === 0 && n.z === 0)).toBe(true); // central body
    expect(g.landmarks.species).not.toEqual(g.landmarks.core);
  });
});

import { genColony } from '../../src/derives/specimenPhyla';
describe('genColony', () => {
  it('is a cluster of ≥7 vesicle nodes linked by necks', () => {
    const g = genColony(H, { maturity: 0.5 });
    expect(g.nodes.length).toBeGreaterThanOrEqual(7);
    expect(g.segments.length / 6).toBe(g.nodes.length - 1); // each non-root linked once
    expect(g.membraneR).toBeGreaterThan(0);
  });
});

import { genHelix } from '../../src/derives/specimenPhyla';
describe('genHelix', () => {
  it('builds two strands + rungs winding through 3D (non-planar)', () => {
    const g = genHelix(H, { maturity: 0.8 });
    expect(g.segments.length).toBeGreaterThan(0);
    expect(g.nodes.length).toBeGreaterThan(0);
    // not all z equal → genuinely 3D
    const zs = g.nodes.map((n) => n.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.05);
  });
});

import { genPlasmid } from '../../src/derives/specimenPhyla';
describe('genPlasmid', () => {
  it('is a closed supercoiled loop with nodes', () => {
    const g = genPlasmid(H, { maturity: 1 });
    expect(g.segments.length / 6).toBeGreaterThan(50); // ~64 steps
    expect(g.nodes.length).toBeGreaterThanOrEqual(6);
  });
});
