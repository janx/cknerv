/**
 * Game of Life engine for the CellLife avatar.
 *
 * Pure-logic, deterministic, side-effect-free. No DOM, no canvas, no React.
 * Both the per-cell instanced avatar (CPU pack -> GPU draw) and the detail
 * panel's animated 3D viewport (CPU step -> GPU draw) consume this module.
 *
 * Grid is 8x8 (border always dead, interior 6x6 = 36 cells).
 * Values: 0 = dead, 1 = primary (cyan), 2 = dual-mode secondary (amber).
 */

export const GRID_SIZE = 8;
export const INTERIOR_SIZE = GRID_SIZE - 2;       // 6
export const INTERIOR_BITS = INTERIOR_SIZE * INTERIOR_SIZE;  // 36

export type CellValue = 0 | 1 | 2;
export type Grid = Uint8Array;  // length GRID_SIZE * GRID_SIZE, row-major

/** Parse a hex hash string (with or without 0x prefix) into a byte array.
 *  Throws on malformed input (odd-length body or non-hex chars). */
export function hashToBytes(hex: string): Uint8Array {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (body.length === 0) return new Uint8Array(0);
  if (body.length % 2 !== 0) {
    throw new Error(`hashToBytes: odd-length hex body (${body.length})`);
  }
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(body.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`hashToBytes: non-hex byte at offset ${i}`);
    }
    out[i] = byte;
  }
  return out;
}

/**
 * Seed a Game-of-Life grid from hash bytes.
 *
 * Walks INTERIOR_BITS consecutive bits across the byte array (MSB-first
 * within each byte, modular wrap across the array). Each bit-set marks an
 * interior cell as alive.
 *
 * In dual mode each alive cell additionally looks at a second bit from
 * byte index `(byteIdx + 16) mod bytes.length` to pick color 1 (cyan) or
 * 2 (amber). Border cells are always 0.
 */
export function seedGrid(bytes: Uint8Array, isDual: boolean): Grid {
  const grid = new Uint8Array(GRID_SIZE * GRID_SIZE);
  if (bytes.length === 0) return grid;

  for (let i = 0; i < INTERIOR_BITS; i++) {
    const byteIdx = Math.floor(i / 8) % bytes.length;
    const bitPos = i % 8;
    const alive = (bytes[byteIdx] >> (7 - bitPos)) & 1;
    if (!alive) continue;

    const row = 1 + Math.floor(i / INTERIOR_SIZE);
    const col = 1 + (i % INTERIOR_SIZE);

    if (isDual) {
      const colorByteIdx = (byteIdx + 16) % bytes.length;
      const colorBit = (bytes[colorByteIdx] >> (7 - bitPos)) & 1;
      grid[row * GRID_SIZE + col] = colorBit === 0 ? 1 : 2;
    } else {
      grid[row * GRID_SIZE + col] = 1;
    }
  }
  return grid;
}

/**
 * Advance the grid one step using B3/S23 rules.
 *
 * - Surviving cells keep their original color.
 * - Newborns inherit the majority neighbor color; on a tie, cyan (value 1)
 *   wins.
 * - Border cells are always evaluated as dead and never come alive (the
 *   inner loop only considers rows/cols 1..GRID_SIZE-2).
 */
export function stepGrid(grid: Grid): Grid {
  const next = new Uint8Array(GRID_SIZE * GRID_SIZE);
  for (let r = 1; r < GRID_SIZE - 1; r++) {
    for (let c = 1; c < GRID_SIZE - 1; c++) {
      let live = 0;
      let cyan = 0;
      let amber = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const v = grid[(r + dr) * GRID_SIZE + (c + dc)];
          if (v > 0) {
            live++;
            if (v === 1) cyan++;
            else amber++;
          }
        }
      }
      const self = grid[r * GRID_SIZE + c];
      if (self > 0) {
        if (live === 2 || live === 3) next[r * GRID_SIZE + c] = self;
      } else if (live === 3) {
        next[r * GRID_SIZE + c] = amber > cyan ? 2 : 1;
      }
    }
  }
  return next;
}

/** Animation step interval in ms (300..600), derived from hash bytes.
 *  Uses byte[17], falling back to byte[1] for short hashes, 0 for empty. */
export function stepInterval(bytes: Uint8Array): number {
  const byte = bytes.length > 17 ? bytes[17] : (bytes[1] ?? 0);
  return 300 + Math.floor((byte / 255) * 300);
}

/** Count alive cells (value > 0) in the grid. */
export function population(grid: Grid): number {
  let n = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] > 0) n++;
  }
  return n;
}
