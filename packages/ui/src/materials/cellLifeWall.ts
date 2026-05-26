import * as THREE from 'three';

/**
 * Shared constants and helpers for the 3D Life polyhedra wall in the
 * cell detail panel. Each CKB cell renders one of N polyhedra, chosen
 * by hash. Numbers are scene-space (camera distance sets the absolute
 * pixel size); see the cell detail design spec for the derivation.
 */

export const GRID_N = 8;
export const WORLD = 4;
export const CELL = WORLD / GRID_N;          // 0.5
/** Per-cell polyhedron "radius" (visual half-extent). */
export const POLY_R = CELL * 0.36;           // 0.18

/** World-space (X, Y) coordinates for a grid cell at (row, col),
 *  with the wall centered at the origin. Row 0 is the topmost row
 *  (positive Y); col 0 is the leftmost column (negative X). */
export function gridToWorld(row: number, col: number): { x: number; y: number } {
  return {
    x: (col - (GRID_N - 1) / 2) * CELL,
    y: ((GRID_N - 1) / 2 - row) * CELL,
  };
}

/**
 * Polyhedron geometry factories — one per shape index.
 *
 * Order is stable: shapeIndex bytes from `gameOfLife.shapeIndex()`
 * return 0..7 (mod 8); callers must mod by SHAPE_FACTORIES.length
 * (== SHAPE_COUNT) before indexing, which `pickShapeIndex` does.
 */
const SHAPE_FACTORIES: Array<() => THREE.BufferGeometry> = [
  () => new THREE.TetrahedronGeometry(POLY_R, 0),
  () => new THREE.BoxGeometry(POLY_R * 1.2, POLY_R * 1.2, POLY_R * 1.2),
  () => new THREE.OctahedronGeometry(POLY_R, 0),
  () => new THREE.IcosahedronGeometry(POLY_R * 0.95, 0),
  () => new THREE.DodecahedronGeometry(POLY_R * 0.95, 0),
  () => new THREE.OctahedronGeometry(POLY_R * 0.85, 1),
];

export const SHAPE_COUNT = SHAPE_FACTORIES.length;

/** Pick the per-CKB-cell shape index, given the cell's content_hash
 *  bytes. Mirrors `shapeIndex` from cellLife/gameOfLife.ts but clamps
 *  to SHAPE_COUNT instead of the 3-bit raw range. */
export function pickShapeIndex(bytes: Uint8Array): number {
  const b = bytes.length > 16 ? bytes[16] : (bytes[0] ?? 0);
  return b % SHAPE_COUNT;
}

/** Build the shared shape geometry for a CKB cell. Caller disposes. */
export function makeShapeGeometry(shapeIdx: number): THREE.BufferGeometry {
  return SHAPE_FACTORIES[shapeIdx % SHAPE_COUNT]();
}

/** Build the wireframe edge geometry for the given shape geometry.
 *  Polyhedra read structurally clean, so we use their own edges
 *  directly (no inner-box inset trick the old cube version used). */
export function makeEdgeGeometry(shapeGeo: THREE.BufferGeometry): THREE.BufferGeometry {
  return new THREE.EdgesGeometry(shapeGeo);
}
