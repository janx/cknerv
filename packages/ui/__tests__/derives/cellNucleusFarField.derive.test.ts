import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cellNucleusFarFieldBeyond,
  ensureCellFieldBounds,
  makeCellFieldBoundsCache,
  type CellFieldBoundsCache,
  type CellFieldBoundsSource,
} from '../../src/derives/cellNucleusFarField.derive';

// Mirrors the CellNucleus module constant; the predicate takes it as input.
const FAR_DIST = 9.5;

function cellAt(x: number, y: number, z: number): CellFieldBoundsSource {
  return { pos_seed: [x, y, z] };
}

const field: CellFieldBoundsSource[] = [
  cellAt(-3, 0, 1),
  cellAt(4, 2, -2),
  cellAt(0, -1.5, 3),
  cellAt(1, 1, 0),
];

function freshBounds(
  cells: readonly CellFieldBoundsSource[],
  count = cells.length,
): CellFieldBoundsCache {
  return ensureCellFieldBounds(makeCellFieldBoundsCache(), cells, count, 1);
}

function distanceToCenter(
  bounds: CellFieldBoundsCache,
  [x, y, z]: readonly [number, number, number],
): number {
  return Math.hypot(x - bounds.centerX, y - bounds.centerY, z - bounds.centerZ);
}

describe('ensureCellFieldBounds', () => {
  it('produces a sphere containing every drawn cell', () => {
    const bounds = freshBounds(field);
    expect(Number.isFinite(bounds.radius)).toBe(true);
    for (const cell of field) {
      expect(distanceToCenter(bounds, cell.pos_seed)).toBeLessThanOrEqual(
        bounds.radius + 1e-9,
      );
    }
  });

  it('bounds only the drawn prefix, not retained cells beyond it', () => {
    const cells = [...field, cellAt(500, 0, 0)];
    expect(freshBounds(cells, field.length).radius).toBeLessThan(10);
    expect(freshBounds(cells, cells.length).radius).toBeGreaterThan(200);
  });

  it('reuses the cached sphere while the position version holds', () => {
    const cache = makeCellFieldBoundsCache();
    const before = ensureCellFieldBounds(cache, field, field.length, 7).radius;
    // List identity is NOT the key — a payload delta republishes the array
    // without moving anything in it. The version is the caller's promise
    // that nothing moved, so a relocation here is unreachable by contract
    // and is used only to prove which of the two the cache reads.
    const republished = [...field.slice(1), cellAt(400, 0, 0)];
    expect(ensureCellFieldBounds(cache, republished, field.length, 7).radius)
      .toBe(before);
    expect(ensureCellFieldBounds(cache, republished, field.length, 8).radius)
      .toBeGreaterThan(before);
  });

  it('rescans when the position version moves', () => {
    const cache = makeCellFieldBoundsCache();
    expect(ensureCellFieldBounds(cache, field, field.length, 7).radius)
      .toBeLessThan(10);
    const replaced = [...field, cellAt(120, 0, 0)];
    expect(ensureCellFieldBounds(cache, replaced, replaced.length, 8).radius)
      .toBeGreaterThan(50);
  });

  it('rescans when the drawn count changes at the same version', () => {
    const cells = [...field, cellAt(120, 0, 0)];
    const cache = makeCellFieldBoundsCache();
    expect(ensureCellFieldBounds(cache, cells, field.length, 7).radius)
      .toBeLessThan(10);
    expect(ensureCellFieldBounds(cache, cells, cells.length, 7).radius)
      .toBeGreaterThan(50);
  });

  it('fails open (infinite radius) on a non-finite pos_seed', () => {
    const cells = [cellAt(0, 0, 0), cellAt(Number.NaN, 0, 0)];
    expect(freshBounds(cells).radius).toBe(Number.POSITIVE_INFINITY);
  });

  it('collapses to a zero sphere for an empty draw range', () => {
    expect(freshBounds(field, 0).radius).toBe(0);
    expect(freshBounds([], 4).radius).toBe(0);
  });

  it('reads each drawn record exactly twice per rescan and never on a steady tick', () => {
    const cells = Array.from({ length: 512 }, (_, index) => (
      cellAt(index * 0.3, (index % 5) * 0.7, -index * 0.2)
    ));
    let reads = 0;
    const measured = new Proxy(cells, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) reads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const cache = makeCellFieldBoundsCache();
    ensureCellFieldBounds(cache, measured, cells.length, 1);
    // Box pass plus exact-radius pass: the 0.08 ms-class rescan the gate
    // costs per field version, against a grid rebuild it now avoids.
    expect(reads).toBe(2 * cells.length);
    reads = 0;
    for (let tick = 0; tick < 24; tick += 1) {
      ensureCellFieldBounds(cache, measured, cells.length, 1);
    }
    expect(reads).toBe(0);
  });
});

describe('cellNucleusFarFieldBeyond', () => {
  const bounds = freshBounds(field);

  function cameraBeyond(margin: number): [number, number, number] {
    return [
      bounds.centerX + bounds.radius + FAR_DIST + margin,
      bounds.centerY,
      bounds.centerZ,
    ];
  }

  it('is true when the whole field is beyond FAR_DIST', () => {
    const [x, y, z] = cameraBeyond(0.001);
    expect(cellNucleusFarFieldBeyond(x, y, z, bounds, FAR_DIST)).toBe(true);
  });

  it('is false when any cell could sit within FAR_DIST', () => {
    const [x, y, z] = cameraBeyond(-0.001);
    expect(cellNucleusFarFieldBeyond(x, y, z, bounds, FAR_DIST)).toBe(false);
    // Camera inside the field itself.
    expect(cellNucleusFarFieldBeyond(
      bounds.centerX,
      bounds.centerY,
      bounds.centerZ,
      bounds,
      FAR_DIST,
    )).toBe(false);
  });

  it('ignores interaction entirely: focus ids ride the direct lane, not this gate', () => {
    // The pre-5c4394d gate composed this predicate with focus / recall /
    // route-hop vetoes because the far-camera walk had to admit those cells
    // by hand. The gated collector resolves semantic ids on every tick
    // regardless of the gate's answer, so the predicate is pure distance.
    const [x, y, z] = cameraBeyond(50);
    expect(cellNucleusFarFieldBeyond(x, y, z, bounds, FAR_DIST)).toBe(true);
  });

  it('fails open on an unknown radius', () => {
    const unknown = {
      centerX: 0,
      centerY: 0,
      centerZ: 0,
      radius: Number.POSITIVE_INFINITY,
    };
    expect(cellNucleusFarFieldBeyond(1e6, 0, 0, unknown, FAR_DIST)).toBe(false);
    expect(cellNucleusFarFieldBeyond(1e6, 0, 0, unknown, Number.NaN)).toBe(false);
  });

  it('beyond implies every cell the walk would test is at least FAR_DIST away', () => {
    // Deterministic pseudo-random field + camera orbit sweep: whenever the
    // predicate says beyond, the per-cell walk's rejection distance must hold
    // for every cell, so skipping the spatial lane is behaviour-equivalent to
    // walking it.
    let seed = 42;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    const cells: CellFieldBoundsSource[] = [];
    for (let i = 0; i < 200; i += 1) {
      cells.push(cellAt(
        (random() - 0.5) * 12,
        (random() - 0.5) * 4,
        (random() - 0.5) * 12,
      ));
    }
    const sweepBounds = freshBounds(cells);
    let skips = 0;
    for (let step = 0; step < 60; step += 1) {
      const angle = (step / 60) * Math.PI * 2;
      const orbit = 6 + step * 0.4;
      const camera: [number, number, number] = [
        Math.cos(angle) * orbit,
        (random() - 0.5) * 6,
        Math.sin(angle) * orbit,
      ];
      const beyond = cellNucleusFarFieldBeyond(
        camera[0],
        camera[1],
        camera[2],
        sweepBounds,
        FAR_DIST,
      );
      if (!beyond) continue;
      skips += 1;
      for (const cell of cells) {
        expect(Math.hypot(
          cell.pos_seed[0] - camera[0],
          cell.pos_seed[1] - camera[1],
          cell.pos_seed[2] - camera[2],
        )).toBeGreaterThanOrEqual(FAR_DIST);
      }
    }
    // The sweep must actually exercise the beyond branch.
    expect(skips).toBeGreaterThan(0);
  });

  it('is the gate in front of the production spatial index, never bypassed', () => {
    // 5c4394d orphaned this module and let CellNucleus build the bucket index
    // on every field version — twice per block at the overview, for a query
    // that cannot admit anything there. The renderer now reaches the index
    // only through the gated collector; calling the index directly from the
    // component would recreate that regression.
    const NUCLEUS_SOURCE = readFileSync(
      resolve(process.cwd(), 'src/components/CellNucleus.tsx'),
      'utf8',
    );
    expect(NUCLEUS_SOURCE).toContain('collectCellNucleusCandidateIndices(');
    expect(NUCLEUS_SOURCE).toContain('makeCellNucleusLodCandidateCache');
    expect(NUCLEUS_SOURCE).not.toContain('ensureCellNucleusSpatialIndex(');
    expect(NUCLEUS_SOURCE).not.toContain('queryCellNucleusCandidateIndices(');
    expect(NUCLEUS_SOURCE).not.toContain('const lodWalkCount');
    const COLLECTOR_SOURCE = readFileSync(
      resolve(process.cwd(), 'src/derives/cellNucleusSpatialLod.derive.ts'),
      'utf8',
    );
    const collector = COLLECTOR_SOURCE.slice(
      COLLECTOR_SOURCE.indexOf('export function collectCellNucleusCandidateIndices('),
    );
    const gate = collector.indexOf('cellNucleusFarFieldBeyond(');
    const build = collector.indexOf('ensureCellNucleusSpatialIndex(');
    expect(gate).toBeGreaterThan(0);
    expect(build).toBeGreaterThan(gate);
  });
});
