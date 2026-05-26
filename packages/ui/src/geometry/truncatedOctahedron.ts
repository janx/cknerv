// Canonical truncated octahedron: vertices at all permutations of (0, ±1, ±2),
// scaled so the maximum vertex norm equals `circumradius`. 24 vertices, 36
// edges, 14 faces (8 hexagonal + 6 square). The 3D analog of the hex tile —
// the only space-filling polyhedron with regular-hexagon faces.

import type { Vec3 } from '../types';

export interface TruncatedOctahedron {
  readonly vertices: ReadonlyArray<Vec3>;
  readonly edges: ReadonlyArray<readonly [number, number]>;
  readonly hexFaceCentroids: ReadonlyArray<Vec3>;
  readonly squareFaceCentroids: ReadonlyArray<Vec3>;
}

const SQRT_5 = Math.sqrt(5);
const EDGE_TOL = 1e-6;

function canonicalVertices(): Vec3[] {
  // All permutations of (0, 1, 2) — there are 6 — and for each, all sign
  // combinations of the nonzero components. Yields 6 × 4 = 24 vertices.
  const perms: Array<[number, number, number]> = [
    [0, 1, 2], [0, 2, 1],
    [1, 0, 2], [2, 0, 1],
    [1, 2, 0], [2, 1, 0],
  ];
  const out: Vec3[] = [];
  for (const [a, b, c] of perms) {
    const signsA = a === 0 ? [1] : [1, -1];
    const signsB = b === 0 ? [1] : [1, -1];
    const signsC = c === 0 ? [1] : [1, -1];
    for (const sa of signsA) for (const sb of signsB) for (const sc of signsC) {
      out.push([a * sa, b * sb, c * sc]);
    }
  }
  return out;
}

function canonicalEdges(vertices: ReadonlyArray<Vec3>): Array<[number, number]> {
  // Two canonical vertices share an edge iff their distance is exactly √2.
  // O(24²) brute force is fine for a one-time module-load cost.
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      const [x1, y1, z1] = vertices[i];
      const [x2, y2, z2] = vertices[j];
      const d2 = (x1 - x2) ** 2 + (y1 - y2) ** 2 + (z1 - z2) ** 2;
      if (Math.abs(d2 - 2) < EDGE_TOL) edges.push([i, j]);
    }
  }
  return edges;
}

function canonicalHexCentroids(): Vec3[] {
  // 8 hex face normals: (±1, ±1, ±1). Their centroids (in canonical scale)
  // are exactly the unit-signed corners of a cube: (s1, s2, s3) where each s ∈ {+1, −1}.
  const out: Vec3[] = [];
  for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
    out.push([sx, sy, sz]);
  }
  return out;
}

function canonicalSquareCentroids(): Vec3[] {
  return [
    [2, 0, 0], [-2, 0, 0],
    [0, 2, 0], [0, -2, 0],
    [0, 0, 2], [0, 0, -2],
  ];
}

const CANONICAL_VERTS = canonicalVertices();
const CANONICAL_EDGES = canonicalEdges(CANONICAL_VERTS);
const CANONICAL_HEX = canonicalHexCentroids();
const CANONICAL_SQ = canonicalSquareCentroids();

export function buildTruncatedOctahedron(circumradius: number): TruncatedOctahedron {
  // Canonical vertices have norm √5. Scale so the requested circumradius lands
  // on the vertex distance.
  const s = circumradius / SQRT_5;
  const scale = (v: Vec3): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
  return {
    vertices: CANONICAL_VERTS.map(scale),
    edges: CANONICAL_EDGES,
    hexFaceCentroids: CANONICAL_HEX.map(scale),
    squareFaceCentroids: CANONICAL_SQ.map(scale),
  };
}
