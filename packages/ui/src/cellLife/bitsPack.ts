/**
 * Pack a seedGrid result into GLSL-friendly per-instance attributes for
 * the CellLifeAvatar fragment shader.
 *
 * Two parallel 36-bit streams: "alive" (bit set if cell is alive at all)
 * and "amber" (bit set if alive cell is value 2 / amber rather than
 * value 1 / cyan). Each stream packs into 5 bytes laid out as
 * `vec4 + float` so GLSL indexing is a 5-way switch (idx < 4 ? vec4[i] :
 * extra).
 *
 * Pre-resolving on CPU (rather than shipping raw hash bytes and
 * re-running seedGrid in the shader) keeps the shader attribute load
 * down and the GLSL math trivial.
 */
import {
  GRID_SIZE,
  INTERIOR_SIZE,
  INTERIOR_BITS,
  seedGrid,
  hashToBytes,
  type Grid,
} from './gameOfLife';
// Shape index is canonical in cellLifeWall so the avatar's 2D silhouette
// and the detail panel's 3D polyhedron resolve from the same `byte[16]
// mod SHAPE_COUNT` mapping. Without this shared source the two views
// disagreed (avatar used `byte & 0x07` → 8 buckets; wall used `byte %
// 6` → 6 buckets) and the same cell showed mismatched shapes.
import { pickShapeIndex } from '../materials/cellLifeWall';

export interface PackedAvatar {
  alive0: [number, number, number, number]; // bytes for bits 0..31
  alive1: number;                            // 1 byte = alive bits 32..35 (lower nibble)
  color0: [number, number, number, number]; // 4 bytes = amber-flag bits 0..31
  color1: number;                            // 1 byte = amber-flag bits 32..35
  shape: number;                             // 0..7
  dual: 0 | 1;
}

/** Pack a seeded grid into per-instance attributes. */
export function packGrid(grid: Grid, shape: number, dual: 0 | 1): PackedAvatar {
  const aliveBytes = [0, 0, 0, 0, 0];
  const colorBytes = [0, 0, 0, 0, 0];
  for (let i = 0; i < INTERIOR_BITS; i++) {
    const row = 1 + Math.floor(i / INTERIOR_SIZE);
    const col = 1 + (i % INTERIOR_SIZE);
    const v = grid[row * GRID_SIZE + col];
    if (v === 0) continue;
    const byteIdx = Math.floor(i / 8);
    const bitPos = i % 8;
    const mask = 1 << (7 - bitPos);
    aliveBytes[byteIdx] |= mask;
    if (v === 2) colorBytes[byteIdx] |= mask;
  }
  return {
    alive0: [aliveBytes[0], aliveBytes[1], aliveBytes[2], aliveBytes[3]],
    alive1: aliveBytes[4],
    color0: [colorBytes[0], colorBytes[1], colorBytes[2], colorBytes[3]],
    color1: colorBytes[4],
    shape,
    dual,
  };
}

/** Convenience: pack directly from a content_hash string. */
export function packFromHash(
  contentHash: string,
  isDual: boolean,
): PackedAvatar {
  const bytes = hashToBytes(contentHash);
  const grid = seedGrid(bytes, isDual);
  return packGrid(grid, pickShapeIndex(bytes), isDual ? 1 : 0);
}

/** Unpack a single interior bit from the packed alive stream.
 *  Used by the test suite to round-trip-verify; also handy for snapshot
 *  debugging. idx is 0..35. */
export function readAliveBit(p: PackedAvatar, idx: number): 0 | 1 {
  const byteIdx = Math.floor(idx / 8);
  const bitPos = idx % 8;
  const byte = byteIdx < 4 ? p.alive0[byteIdx] : p.alive1;
  return ((byte >> (7 - bitPos)) & 1) as 0 | 1;
}

/** Mirror of readAliveBit for the amber-color stream. */
export function readColorBit(p: PackedAvatar, idx: number): 0 | 1 {
  const byteIdx = Math.floor(idx / 8);
  const bitPos = idx % 8;
  const byte = byteIdx < 4 ? p.color0[byteIdx] : p.color1;
  return ((byte >> (7 - bitPos)) & 1) as 0 | 1;
}
