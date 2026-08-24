import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cellNucleusFarFieldBeyond,
  cellNucleusFarFieldSkip,
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
});

describe('cellNucleusFarFieldSkip', () => {
  const bounds = freshBounds(field);

  function cameraBeyond(margin: number): [number, number, number] {
    return [
      bounds.centerX + bounds.radius + FAR_DIST + margin,
      bounds.centerY,
      bounds.centerZ,
    ];
  }

  it('skips when the whole field is beyond FAR_DIST and nothing is focused', () => {
    const [x, y, z] = cameraBeyond(0.001);
    expect(cellNucleusFarFieldSkip(x, y, z, bounds, FAR_DIST, 0, false, false))
      .toBe(true);
  });

  it('never skips while a hover/selection focus envelope is alive', () => {
    const [x, y, z] = cameraBeyond(50);
    expect(cellNucleusFarFieldSkip(x, y, z, bounds, FAR_DIST, 1, false, false))
      .toBe(false);
  });

  it('never skips while a recall or route-hop focus is active', () => {
    const [x, y, z] = cameraBeyond(50);
    expect(cellNucleusFarFieldSkip(x, y, z, bounds, FAR_DIST, 0, true, false))
      .toBe(false);
    expect(cellNucleusFarFieldSkip(x, y, z, bounds, FAR_DIST, 0, false, true))
      .toBe(false);
  });

  it('does not skip when any cell could sit within FAR_DIST', () => {
    const [x, y, z] = cameraBeyond(-0.001);
    expect(cellNucleusFarFieldSkip(x, y, z, bounds, FAR_DIST, 0, false, false))
      .toBe(false);
    // Camera inside the field itself.
    expect(cellNucleusFarFieldSkip(
      bounds.centerX,
      bounds.centerY,
      bounds.centerZ,
      bounds,
      FAR_DIST,
      0,
      false,
      false,
    )).toBe(false);
  });

  it('fails open on an unknown radius', () => {
    const unknown = {
      centerX: 0,
      centerY: 0,
      centerZ: 0,
      radius: Number.POSITIVE_INFINITY,
    };
    expect(cellNucleusFarFieldSkip(1e6, 0, 0, unknown, FAR_DIST, 0, false, false))
      .toBe(false);
  });

  it('skip implies every cell the walk would test is beyond FAR_DIST', () => {
    // Deterministic pseudo-random field + camera orbit sweep: whenever the
    // predicate says skip, the per-cell walk's rejection distance must hold
    // for every cell, so skipping is behaviour-equivalent to walking.
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
      const skip = cellNucleusFarFieldSkip(
        camera[0],
        camera[1],
        camera[2],
        sweepBounds,
        FAR_DIST,
        0,
        false,
        false,
      );
      if (!skip) continue;
      skips += 1;
      for (const cell of cells) {
        expect(Math.hypot(
          cell.pos_seed[0] - camera[0],
          cell.pos_seed[1] - camera[1],
          cell.pos_seed[2] - camera[2],
        )).toBeGreaterThanOrEqual(FAR_DIST);
      }
    }
    // The sweep must actually exercise the skip branch.
    expect(skips).toBeGreaterThan(0);
  });
});

describe('cellNucleusFarFieldBeyond', () => {
  const bounds = freshBounds(field);

  it('is the pure distance predicate the skip composes with envelope gates', () => {
    const beyondCamera: [number, number, number] = [
      bounds.centerX + bounds.radius + FAR_DIST + 0.001,
      bounds.centerY,
      bounds.centerZ,
    ];
    const nearCamera: [number, number, number] = [
      bounds.centerX + bounds.radius + FAR_DIST - 0.001,
      bounds.centerY,
      bounds.centerZ,
    ];
    expect(cellNucleusFarFieldBeyond(...beyondCamera, bounds, FAR_DIST))
      .toBe(true);
    expect(cellNucleusFarFieldBeyond(...nearCamera, bounds, FAR_DIST))
      .toBe(false);
    // Ignores focus entirely — the frame loop pairs it with an
    // envelope-only walk instead of a veto…
    expect(cellNucleusFarFieldSkip(
      ...beyondCamera,
      bounds,
      FAR_DIST,
      3,
      false,
      false,
    )).toBe(false);
    // …while the composed skip is exactly beyond ∧ no-envelope.
    expect(cellNucleusFarFieldSkip(
      ...beyondCamera,
      bounds,
      FAR_DIST,
      0,
      false,
      false,
    )).toBe(true);
  });

  it('fails open on an unknown radius', () => {
    const unknown = {
      centerX: 0,
      centerY: 0,
      centerZ: 0,
      radius: Number.POSITIVE_INFINITY,
    };
    expect(cellNucleusFarFieldBeyond(1e6, 0, 0, unknown, FAR_DIST)).toBe(false);
  });

  it('keeps the far-camera selection walk on the envelope, not the field', () => {
    // An open detail panel holds a focus envelope for its whole lifetime;
    // that must not resurrect the O(count) per-Cell walk the far-field
    // early-out exists to remove. Recall keeps the full walk (its response
    // set spans endpoints beyond the envelope), and route-hop focus only
    // exists while recall is active.
    const NUCLEUS_SOURCE = readFileSync(
      resolve(process.cwd(), 'src/components/CellNucleus.tsx'),
      'utf8',
    );
    expect(NUCLEUS_SOURCE).toContain('const envelopeOnlyLod = recallFocus === null');
    expect(NUCLEUS_SOURCE).toContain('cellNucleusFarFieldBeyond(');
    expect(NUCLEUS_SOURCE).toContain('envelopeOnlyLod ? 0 : count');
    expect(NUCLEUS_SOURCE).toContain(
      'const index = visibleIndexByCell.get(cellId)',
    );
    expect(NUCLEUS_SOURCE).toContain('const detail = userFocus * 0.68');
  });
});
