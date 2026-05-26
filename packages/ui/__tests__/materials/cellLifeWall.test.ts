import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  WORLD,
  CELL,
  POLY_R,
  GRID_N,
  SHAPE_COUNT,
  gridToWorld,
  pickShapeIndex,
  makeShapeGeometry,
  makeEdgeGeometry,
} from '../../src/materials/cellLifeWall';

describe('cellLifeWall constants', () => {
  it('exposes derived constants consistent with the spec', () => {
    expect(GRID_N).toBe(8);
    expect(WORLD).toBe(4);
    expect(CELL).toBeCloseTo(0.5, 10);
    expect(POLY_R).toBeCloseTo(CELL * 0.36, 10);
    expect(SHAPE_COUNT).toBeGreaterThan(0);
  });
});

describe('gridToWorld', () => {
  it('maps grid (0, 0) to the top-left cell, centered around origin', () => {
    const { x, y } = gridToWorld(0, 0);
    expect(x).toBeCloseTo(-3.5 * CELL, 10);
    expect(y).toBeCloseTo(+3.5 * CELL, 10);
  });

  it('maps grid (7, 7) to the bottom-right cell', () => {
    const { x, y } = gridToWorld(7, 7);
    expect(x).toBeCloseTo(+3.5 * CELL, 10);
    expect(y).toBeCloseTo(-3.5 * CELL, 10);
  });

  it('maps grid (3, 4) to a column-right-of-center, row-above-center', () => {
    const { x, y } = gridToWorld(3, 4);
    expect(x).toBeCloseTo((4 - 3.5) * CELL, 10);
    expect(y).toBeCloseTo((3.5 - 3) * CELL, 10);
  });
});

describe('pickShapeIndex', () => {
  it('returns values in [0, SHAPE_COUNT)', () => {
    for (let b = 0; b < 256; b++) {
      // Build a 32-byte fixture where byte[16] varies across 0..255.
      const bytes = new Uint8Array(32);
      bytes[16] = b;
      const idx = pickShapeIndex(bytes);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(SHAPE_COUNT);
    }
  });

  it('falls back to byte[0] when bytes shorter than 17 elements', () => {
    const short = new Uint8Array([5, 0]);
    expect(pickShapeIndex(short)).toBe(5 % SHAPE_COUNT);
  });

  it('returns 0 for an empty byte array', () => {
    expect(pickShapeIndex(new Uint8Array(0))).toBe(0);
  });
});

describe('makeShapeGeometry / makeEdgeGeometry', () => {
  it('builds a non-empty BufferGeometry for every shape index', () => {
    for (let i = 0; i < SHAPE_COUNT; i++) {
      const geo = makeShapeGeometry(i);
      expect(geo).toBeInstanceOf(THREE.BufferGeometry);
      const pos = geo.getAttribute('position');
      expect(pos).toBeDefined();
      expect(pos!.count).toBeGreaterThan(0);
      geo.dispose();
    }
  });

  it('builds non-empty edge geometry for each shape', () => {
    for (let i = 0; i < SHAPE_COUNT; i++) {
      const geo = makeShapeGeometry(i);
      const edges = makeEdgeGeometry(geo);
      expect(edges).toBeInstanceOf(THREE.BufferGeometry);
      const pos = edges.getAttribute('position');
      expect(pos).toBeDefined();
      expect(pos!.count).toBeGreaterThan(0);
      edges.dispose();
      geo.dispose();
    }
  });
});
