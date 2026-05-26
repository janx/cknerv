import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import { buildTruncatedOctahedron } from '../../src/geometry/truncatedOctahedron';
import {
  allocCellShellBuffers,
  rotPhaseFor,
  writeCellShellBuffers,
  EDGES_PER_CELL,
  VERTS_PER_CELL,
} from '../../src/derives/cellShell.derive';

function mkCell(id: number, x: number, y: number, z: number, tag: Cell['tag'] = null, bornMs = 0, deathMs: number | null = null): Cell {
  return {
    id, born_at_ms: bornMs, death_at_ms: deathMs, birth_block: 1,
    tag, pos_seed: [x, y, z],
    out_point: { tx_hash: '0x', index: 0 },
    capacity: 0, data_hex: '',
    content_hash: '0x' + '00'.repeat(32),
  };
}

describe('cellShell.derive', () => {
  it('exports geometry-derived constants', () => {
    expect(EDGES_PER_CELL).toBe(36);
    expect(VERTS_PER_CELL).toBe(72);
  });

  it('rotPhaseFor is deterministic and in [0, 2π)', () => {
    for (const id of [0, 1, 2, 42, 999, 1_234_567]) {
      const a = rotPhaseFor(id);
      const b = rotPhaseFor(id);
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(Math.PI * 2);
    }
  });

  it('rotPhaseFor avoids collisions across small ids', () => {
    const seen = new Set<number>();
    for (let id = 0; id < 1024; id++) seen.add(Math.round(rotPhaseFor(id) * 1e6));
    expect(seen.size).toBeGreaterThan(1020); // near-perfect uniqueness
  });

  it('writeCellShellBuffers writes 72 vertex entries per cell into the targets', () => {
    const cap = 4;
    const targets = allocCellShellBuffers(cap);
    const geom = buildTruncatedOctahedron(1);

    const cells: Cell[] = [
      mkCell(1, 10, 0, 0),
      mkCell(2, 0, 20, 0, 'dex', 100, null),
    ];
    const flashMap = new Map<number, number>([[1, 3.5]]);
    const toSceneSec = (ms: number) => ms / 1000;

    writeCellShellBuffers(
      cells,
      cells.length,
      toSceneSec,
      0,
      flashMap,
      geom,
      1.4,            // generic halo size × 1.4
      1.4 * 1.875,    // tagged halo size × 1.4 (= 1.875 × generic)
      targets,
    );

    expect(targets.vertexCount).toBe(cells.length * 72);

    // For cell 1 (generic, born 0, alive, flash 3.5s):
    expect(targets.posArr[0]).toBe(10);
    expect(targets.posArr[1]).toBe(0);
    expect(targets.posArr[2]).toBe(0);
    expect(targets.bornArr[0]).toBe(0);
    expect(targets.deathArr[0]).toBe(1e9); // alive sentinel
    expect(targets.flashArr[0]).toBe(3.5);
    expect(targets.sizeArr[0]).toBeCloseTo(1.4, 5);
    // Generic cells get the pale-blue color (matches CellGalaxy GENERIC_COLOR).
    expect(targets.colorArr[0]).toBeCloseTo(0.62, 5);
    expect(targets.colorArr[1]).toBeCloseTo(0.78, 5);
    expect(targets.colorArr[2]).toBeCloseTo(1.0, 5);

    // For cell 2 (tagged 'dex', born 0.1, alive, no flash):
    expect(targets.posArr[72 * 3 + 0]).toBe(0);
    expect(targets.posArr[72 * 3 + 1]).toBe(20);
    expect(targets.posArr[72 * 3 + 2]).toBe(0);
    expect(targets.bornArr[72]).toBeCloseTo(0.1, 7);
    expect(targets.flashArr[72]).toBe(-1e9); // no-flash sentinel
    expect(targets.sizeArr[72]).toBe(2.625);
    // dex-tagged color (= COLOR_BY_TAG.dex).
    expect(targets.colorArr[72 * 3 + 0]).toBeCloseTo(0.99, 5);
    expect(targets.colorArr[72 * 3 + 1]).toBeCloseTo(0.83, 5);
    expect(targets.colorArr[72 * 3 + 2]).toBeCloseTo(0.30, 5);
  });

  it('local edge endpoints match the truncated octahedron', () => {
    const cap = 1;
    const targets = allocCellShellBuffers(cap);
    const geom = buildTruncatedOctahedron(1);
    writeCellShellBuffers(
      [mkCell(1, 0, 0, 0)], 1, (ms) => ms / 1000, 0, new Map(),
      geom, 1, 1, targets,
    );
    const [i0, i1] = geom.edges[0];
    const v0 = geom.vertices[i0];
    const v1 = geom.vertices[i1];
    expect(targets.positionArr[0]).toBeCloseTo(v0[0], 5);
    expect(targets.positionArr[1]).toBeCloseTo(v0[1], 5);
    expect(targets.positionArr[2]).toBeCloseTo(v0[2], 5);
    expect(targets.positionArr[3]).toBeCloseTo(v1[0], 5);
    expect(targets.positionArr[4]).toBeCloseTo(v1[1], 5);
    expect(targets.positionArr[5]).toBeCloseTo(v1[2], 5);
  });

  it('death timestamp is written for dying cells', () => {
    const cap = 1;
    const targets = allocCellShellBuffers(cap);
    const geom = buildTruncatedOctahedron(1);
    writeCellShellBuffers(
      [mkCell(1, 0, 0, 0, null, 0, 500)], 1, (ms) => ms / 1000, 0, new Map(),
      geom, 1, 1, targets,
    );
    expect(targets.deathArr[0]).toBeCloseTo(0.5, 9);
  });

  it('applies the blockHighlightDelayS offset to bornS and deathS', () => {
    const cap = 1;
    const targets = allocCellShellBuffers(cap);
    const geom = buildTruncatedOctahedron(1);
    const DELAY = 0.3;
    writeCellShellBuffers(
      [mkCell(1, 0, 0, 0, null, 0, 500)],
      1,
      (ms) => ms / 1000,
      DELAY,
      new Map(),
      geom,
      1,
      1,
      targets,
    );
    expect(targets.bornArr[0]).toBeCloseTo(0 + DELAY, 7);
    expect(targets.deathArr[0]).toBeCloseTo(0.5 + DELAY, 7);
  });

  it('does NOT apply blockHighlightDelayS to the flash timestamp', () => {
    const cap = 1;
    const targets = allocCellShellBuffers(cap);
    const geom = buildTruncatedOctahedron(1);
    const DELAY = 0.3;
    writeCellShellBuffers(
      [mkCell(1, 0, 0, 0)],
      1,
      (ms) => ms / 1000,
      DELAY,
      new Map([[1, 2.5]]),
      geom,
      1,
      1,
      targets,
    );
    expect(targets.flashArr[0]).toBe(2.5);
  });
});
