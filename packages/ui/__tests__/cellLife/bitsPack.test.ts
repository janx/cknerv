import { describe, it, expect } from 'vitest';
import {
  packGrid,
  packFromHash,
  readAliveBit,
  readColorBit,
} from '../../src/cellLife/bitsPack';
import {
  seedGrid,
  GRID_SIZE,
  INTERIOR_SIZE,
  INTERIOR_BITS,
} from '../../src/cellLife/gameOfLife';

describe('packGrid', () => {
  it('round-trips an all-dead grid as all zeros', () => {
    const g = new Uint8Array(GRID_SIZE * GRID_SIZE);
    const p = packGrid(g, 0, 0);
    for (let i = 0; i < INTERIOR_BITS; i++) {
      expect(readAliveBit(p, i)).toBe(0);
      expect(readColorBit(p, i)).toBe(0);
    }
  });

  it('round-trips an all-alive grid', () => {
    const g = new Uint8Array(GRID_SIZE * GRID_SIZE);
    for (let r = 1; r < GRID_SIZE - 1; r++) {
      for (let c = 1; c < GRID_SIZE - 1; c++) g[r * GRID_SIZE + c] = 1;
    }
    const p = packGrid(g, 3, 0);
    for (let i = 0; i < INTERIOR_BITS; i++) {
      expect(readAliveBit(p, i)).toBe(1);
      expect(readColorBit(p, i)).toBe(0);
    }
    expect(p.shape).toBe(3);
    expect(p.dual).toBe(0);
  });

  it('preserves amber positions in dual mode', () => {
    const g = new Uint8Array(GRID_SIZE * GRID_SIZE);
    for (let r = 1; r < GRID_SIZE - 1; r++) {
      for (let c = 1; c < GRID_SIZE - 1; c++) {
        g[r * GRID_SIZE + c] = (r + c) % 2 === 0 ? 1 : 2;
      }
    }
    const p = packGrid(g, 0, 1);
    for (let i = 0; i < INTERIOR_BITS; i++) {
      const row = 1 + Math.floor(i / INTERIOR_SIZE);
      const col = 1 + (i % INTERIOR_SIZE);
      const expectedAlive = 1;
      const expectedColor = (row + col) % 2 === 0 ? 0 : 1;
      expect(readAliveBit(p, i)).toBe(expectedAlive);
      expect(readColorBit(p, i)).toBe(expectedColor);
    }
  });

  it('roundtrips a seeded grid identically', () => {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = (i * 37) & 0xff;
    const g = seedGrid(bytes, true);
    const p = packGrid(g, 0, 1);
    for (let i = 0; i < INTERIOR_BITS; i++) {
      const row = 1 + Math.floor(i / INTERIOR_SIZE);
      const col = 1 + (i % INTERIOR_SIZE);
      const v = g[row * GRID_SIZE + col];
      expect(readAliveBit(p, i)).toBe(v > 0 ? 1 : 0);
      expect(readColorBit(p, i)).toBe(v === 2 ? 1 : 0);
    }
  });
});

describe('packFromHash', () => {
  it('returns identical PackedAvatar for identical hash + dual flag', () => {
    const hash = '0x' + 'ab'.repeat(32);
    const a = packFromHash(hash, true);
    const b = packFromHash(hash, true);
    expect(a).toEqual(b);
  });

  it('differs when the hash differs', () => {
    const a = packFromHash('0x' + 'ab'.repeat(32), false);
    const b = packFromHash('0x' + 'cd'.repeat(32), false);
    expect(a).not.toEqual(b);
  });
});
