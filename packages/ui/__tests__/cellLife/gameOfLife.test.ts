import { describe, it, expect } from 'vitest';
import {
  hashToBytes,
  seedGrid,
  stepGrid,
  stepInterval,
  population,
  GRID_SIZE,
  INTERIOR_BITS,
} from '../../src/cellLife/gameOfLife';

describe('hashToBytes', () => {
  it('parses 0x-prefixed hex', () => {
    const b = hashToBytes('0xdeadbeef');
    expect(Array.from(b)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('parses unprefixed hex', () => {
    const b = hashToBytes('cafe');
    expect(Array.from(b)).toEqual([0xca, 0xfe]);
  });

  it('returns empty array for empty input', () => {
    expect(hashToBytes('').length).toBe(0);
    expect(hashToBytes('0x').length).toBe(0);
  });

  it('throws on odd-length body', () => {
    expect(() => hashToBytes('0xabc')).toThrow(/odd-length/);
  });

  it('throws on non-hex characters', () => {
    expect(() => hashToBytes('0xzz')).toThrow(/non-hex/);
  });
});

describe('seedGrid', () => {
  it('returns an all-dead grid for empty bytes', () => {
    const g = seedGrid(new Uint8Array(0), false);
    expect(g.length).toBe(GRID_SIZE * GRID_SIZE);
    expect(g.every((v) => v === 0)).toBe(true);
  });

  it('always leaves the border dead', () => {
    const bytes = new Uint8Array(32).fill(0xff);  // all bits alive
    const g = seedGrid(bytes, false);
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        if (r === 0 || r === GRID_SIZE - 1 || c === 0 || c === GRID_SIZE - 1) {
          expect(g[r * GRID_SIZE + c]).toBe(0);
        }
      }
    }
  });

  it('lights up exactly INTERIOR_BITS cells when all hash bits are 1', () => {
    const bytes = new Uint8Array(32).fill(0xff);
    const g = seedGrid(bytes, false);
    const alive = Array.from(g).filter((v) => v > 0).length;
    expect(alive).toBe(INTERIOR_BITS);
  });

  it('is deterministic for identical input', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const a = seedGrid(bytes, false);
    const b = seedGrid(bytes, false);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('produces only values 0 or 1 in non-dual mode', () => {
    const bytes = new Uint8Array(32).fill(0xff);
    const g = seedGrid(bytes, false);
    for (const v of g) {
      expect([0, 1]).toContain(v);
    }
  });

  it('produces both 1 and 2 in dual mode for a varied hash', () => {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = i < 16 ? 0xff : 0xaa;
    const g = seedGrid(bytes, true);
    const has1 = Array.from(g).some((v) => v === 1);
    const has2 = Array.from(g).some((v) => v === 2);
    expect(has1).toBe(true);
    expect(has2).toBe(true);
  });
});

/** Build a grid from a row-major template like
 *  ".X.\n.X.\n.X." where X = 1 (cyan), Y = 2 (amber), . = 0. */
function gridFromAscii(s: string): Uint8Array {
  const rows = s.trim().split('\n').map((r) => r.trim());
  expect(rows.length).toBe(GRID_SIZE);
  const g = new Uint8Array(GRID_SIZE * GRID_SIZE);
  for (let r = 0; r < GRID_SIZE; r++) {
    expect(rows[r].length).toBe(GRID_SIZE);
    for (let c = 0; c < GRID_SIZE; c++) {
      const ch = rows[r][c];
      g[r * GRID_SIZE + c] = ch === 'X' ? 1 : ch === 'Y' ? 2 : 0;
    }
  }
  return g;
}

describe('stepGrid', () => {
  it('blinker oscillates with period 2', () => {
    const v = gridFromAscii(
      '........\n' +
      '........\n' +
      '........\n' +
      '..XXX...\n' +
      '........\n' +
      '........\n' +
      '........\n' +
      '........'
    );
    const h = stepGrid(v);
    const expectedH = gridFromAscii(
      '........\n' +
      '........\n' +
      '...X....\n' +
      '...X....\n' +
      '...X....\n' +
      '........\n' +
      '........\n' +
      '........'
    );
    expect(Array.from(h)).toEqual(Array.from(expectedH));
    const v2 = stepGrid(h);
    expect(Array.from(v2)).toEqual(Array.from(v));
  });

  it('block is stable', () => {
    const g = gridFromAscii(
      '........\n' +
      '........\n' +
      '..XX....\n' +
      '..XX....\n' +
      '........\n' +
      '........\n' +
      '........\n' +
      '........'
    );
    expect(Array.from(stepGrid(g))).toEqual(Array.from(g));
  });

  it('survivor cells keep their original color', () => {
    const g = gridFromAscii(
      '........\n' +
      '........\n' +
      '..YY....\n' +
      '..YY....\n' +
      '........\n' +
      '........\n' +
      '........\n' +
      '........'
    );
    const next = stepGrid(g);
    expect(Array.from(next)).toEqual(Array.from(g));
  });

  it('newborn inherits majority neighbor color', () => {
    const g = gridFromAscii(
      '........\n' +
      '........\n' +
      '..Y.....\n' +
      '..XY....\n' +
      '........\n' +
      '........\n' +
      '........\n' +
      '........'
    );
    const next = stepGrid(g);
    // Cell (2,3) had 3 neighbors: Y at (2,2), X at (3,2), Y at (3,3).
    // Majority is amber (2 vs 1), expect 2.
    expect(next[2 * GRID_SIZE + 3]).toBe(2);
  });

  it('cyan wins ties on birth', () => {
    const g = gridFromAscii(
      '........\n' +
      '........\n' +
      '..X.....\n' +
      '...Y....\n' +
      '..X.....\n' +
      '........\n' +
      '........\n' +
      '........'
    );
    const next = stepGrid(g);
    // Cell (3,2): neighbors X(2,2), Y(3,3), X(4,2) = 2 cyan + 1 amber.
    // Not a tie, majority cyan -> value 1.
    expect(next[3 * GRID_SIZE + 2]).toBe(1);
  });
});

describe('stepInterval', () => {
  it('returns 300 for byte 0', () => {
    const bytes = new Uint8Array(20);
    bytes[17] = 0;
    expect(stepInterval(bytes)).toBe(300);
  });

  it('returns 600 for byte 255', () => {
    const bytes = new Uint8Array(20);
    bytes[17] = 255;
    expect(stepInterval(bytes)).toBe(600);
  });

  it('falls back to byte[1] for short hashes', () => {
    const bytes = new Uint8Array([0, 128]);
    // 300 + floor(128/255 * 300) = 300 + 150 = 450
    expect(stepInterval(bytes)).toBe(450);
  });

  it('returns 300 for empty bytes', () => {
    expect(stepInterval(new Uint8Array(0))).toBe(300);
  });
});

describe('population', () => {
  it('counts non-zero cells', () => {
    const g = new Uint8Array(GRID_SIZE * GRID_SIZE);
    expect(population(g)).toBe(0);
    g[10] = 1;
    g[20] = 2;
    g[30] = 1;
    expect(population(g)).toBe(3);
  });
});
