import { describe, it, expect } from 'vitest';
import { genArbor } from '../../src/derives/specimenPhyla';

const H = '0x' + 'ab'.repeat(32);
describe('genArbor', () => {
  it('builds a deterministic recursive FPGA routing tree + four landmarks', () => {
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
  it('builds a radial I/O backplane with elbow routes and a perimeter bus', () => {
    const g = genRadiolarian(H, { maturity: 0.6 });
    expect(g.membraneR).toBeGreaterThan(0);
    const portCount = g.nodes.length - 1;
    expect(portCount).toBeGreaterThanOrEqual(10);
    expect(g.segments.length / 6).toBe(portCount * 4); // three route legs + one perimeter edge per port
    expect(g.nodes.some((n) => n.x === 0 && n.y === 0 && n.z === 0)).toBe(true); // controller die
    expect(g.landmarks.species).not.toEqual(g.landmarks.core);
  });
});

import { genColony } from '../../src/derives/specimenPhyla';
describe('genColony', () => {
  it('is a grid of ≥8 chiplets linked by three-leg Manhattan routes', () => {
    const g = genColony(H, { maturity: 0.5 });
    expect(g.nodes.length).toBeGreaterThanOrEqual(8);
    expect(g.segments.length / 6).toBe((g.nodes.length - 1) * 3);
    expect(g.membraneR).toBeGreaterThan(0);
  });
});

import { genHelix } from '../../src/derives/specimenPhyla';
describe('genHelix', () => {
  it('builds a non-planar stack of hard hexagonal timing planes and vias', () => {
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
  it('builds an incomplete dual checksum bus with observation pads', () => {
    const g = genPlasmid(H, { maturity: 1 });
    expect(g.segments.length / 6).toBeGreaterThan(24);
    expect(g.nodes.length).toBeGreaterThanOrEqual(6);
    expect(g.membraneR).toBeNull();
  });
});
