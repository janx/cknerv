import { describe, expect, it } from 'vitest';
import { buildTruncatedOctahedron } from '../../src/geometry/truncatedOctahedron';

const SQRT_5 = Math.sqrt(5);
const SQRT_3 = Math.sqrt(3);
const SQRT_2 = Math.sqrt(2);
const EPS = 1e-9;

describe('buildTruncatedOctahedron', () => {
  it('has 24 vertices, 36 edges, 14 faces (V − E + F = 2)', () => {
    const t = buildTruncatedOctahedron(SQRT_5);
    expect(t.vertices).toHaveLength(24);
    expect(t.edges).toHaveLength(36);
    expect(t.hexFaceCentroids).toHaveLength(8);
    expect(t.squareFaceCentroids).toHaveLength(6);
    const V = t.vertices.length;
    const E = t.edges.length;
    const F = t.hexFaceCentroids.length + t.squareFaceCentroids.length;
    expect(V - E + F).toBe(2);
  });

  it('all vertices lie at the requested circumradius', () => {
    const R = SQRT_5;
    const t = buildTruncatedOctahedron(R);
    for (const [x, y, z] of t.vertices) {
      const norm = Math.sqrt(x * x + y * y + z * z);
      expect(Math.abs(norm - R)).toBeLessThan(EPS);
    }
  });

  it('every edge has length √2 at canonical scale', () => {
    const t = buildTruncatedOctahedron(SQRT_5);
    for (const [i, j] of t.edges) {
      const [x1, y1, z1] = t.vertices[i];
      const [x2, y2, z2] = t.vertices[j];
      const d = Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2 + (z1 - z2) ** 2);
      expect(Math.abs(d - SQRT_2)).toBeLessThan(EPS);
    }
  });

  it('hex face centroids are at distance √3 (canonical scale)', () => {
    const t = buildTruncatedOctahedron(SQRT_5);
    for (const [x, y, z] of t.hexFaceCentroids) {
      const norm = Math.sqrt(x * x + y * y + z * z);
      expect(Math.abs(norm - SQRT_3)).toBeLessThan(EPS);
    }
  });

  it('square face centroids are at distance 2 (canonical scale)', () => {
    const t = buildTruncatedOctahedron(SQRT_5);
    for (const [x, y, z] of t.squareFaceCentroids) {
      const norm = Math.sqrt(x * x + y * y + z * z);
      expect(Math.abs(norm - 2)).toBeLessThan(EPS);
    }
  });

  it('scales linearly with circumradius', () => {
    const a = buildTruncatedOctahedron(1);
    const b = buildTruncatedOctahedron(3);
    for (let i = 0; i < a.vertices.length; i++) {
      expect(b.vertices[i][0]).toBeCloseTo(a.vertices[i][0] * 3, 9);
      expect(b.vertices[i][1]).toBeCloseTo(a.vertices[i][1] * 3, 9);
      expect(b.vertices[i][2]).toBeCloseTo(a.vertices[i][2] * 3, 9);
    }
  });

  it('edge index pairs reference valid vertices and are non-degenerate', () => {
    const t = buildTruncatedOctahedron(SQRT_5);
    for (const [i, j] of t.edges) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(t.vertices.length);
      expect(j).toBeLessThan(t.vertices.length);
      expect(i).not.toBe(j);
    }
  });
});
