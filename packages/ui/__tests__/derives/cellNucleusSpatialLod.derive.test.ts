import { describe, expect, it } from 'vitest';
import {
  ensureCellNucleusSpatialIndex,
  makeCellNucleusCandidateScratch,
  makeCellNucleusSpatialIndex,
  queryCellNucleusCandidateIndices,
  type CellNucleusSpatialSource,
} from '../../src/derives/cellNucleusSpatialLod.derive';

const FAR_DIST = 9.5;

function cell(
  id: number,
  x: number,
  y: number,
  z: number,
): CellNucleusSpatialSource {
  return { id, pos_seed: [x, y, z] };
}

function slotLookup(
  cells: readonly CellNucleusSpatialSource[],
): ReadonlyMap<number, number> {
  return new Map(cells.map((candidate, slot) => [candidate.id, slot]));
}

function referenceCandidates(
  cells: readonly CellNucleusSpatialSource[],
  count: number,
  camera: readonly [number, number, number],
  radius: number,
  directIds: ReadonlySet<number>,
): number[] {
  const out: number[] = [];
  const radiusSq = radius * radius;
  for (let index = 0; index < Math.min(count, cells.length); index += 1) {
    const candidate = cells[index];
    const dx = candidate.pos_seed[0] - camera[0];
    const dy = candidate.pos_seed[1] - camera[1];
    const dz = candidate.pos_seed[2] - camera[2];
    if (directIds.has(candidate.id) || dx * dx + dy * dy + dz * dz < radiusSq) {
      out.push(index);
    }
  }
  return out;
}

describe('CellNucleus private spatial LOD index', () => {
  it('matches the full-prefix candidate oracle across 3D camera probes', () => {
    let seed = 0x91d3a5f7;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const cells: CellNucleusSpatialSource[] = [];
    for (let id = 0; id < 2_000; id += 1) {
      cells.push(cell(
        id,
        (random() - 0.5) * 180,
        (random() - 0.5) * 70,
        (random() - 0.5) * 180,
      ));
    }
    const count = 1_733;
    const index = ensureCellNucleusSpatialIndex(
      makeCellNucleusSpatialIndex(),
      cells,
      count,
      7,
      FAR_DIST,
    );
    const scratch = makeCellNucleusCandidateScratch();
    const slots = slotLookup(cells);

    for (let probe = 0; probe < 80; probe += 1) {
      const camera: [number, number, number] = [
        (random() - 0.5) * 200,
        (random() - 0.5) * 80,
        (random() - 0.5) * 200,
      ];
      // Models selected/hovered, a releasing focus envelope, recall endpoints
      // and a route-hop id.  Some ids deliberately sit outside the prefix.
      const directIds = new Set([
        Math.floor(random() * cells.length),
        Math.floor(random() * cells.length),
        Math.floor(random() * cells.length),
        cells.length + probe,
      ]);
      const actual = queryCellNucleusCandidateIndices(
        index,
        cells,
        camera[0],
        camera[1],
        camera[2],
        FAR_DIST,
        slots,
        directIds,
        scratch,
      );
      expect([...actual]).toEqual(
        referenceCandidates(cells, count, camera, FAR_DIST, directIds),
      );
    }
  });

  it('preserves final focus/distance priority and cap semantics', () => {
    let seed = 0x4c4f445f;
    const random = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    const cells: CellNucleusSpatialSource[] = [];
    for (let id = 0; id < 4_000; id += 1) {
      cells.push(cell(
        id,
        (random() - 0.5) * 140,
        (random() - 0.5) * 50,
        (random() - 0.5) * 140,
      ));
    }
    const spatial = ensureCellNucleusSpatialIndex(
      makeCellNucleusSpatialIndex(),
      cells,
      cells.length,
      1,
      FAR_DIST,
    );
    const scratch = makeCellNucleusCandidateScratch();
    const slots = slotLookup(cells);
    type Entry = { index: number; focus: number; dist: number; detail: number };
    const select = (
      indices: Iterable<number>,
      camera: readonly [number, number, number],
      focusById: ReadonlyMap<number, number>,
      routeHopId: number | null,
      cap: number,
    ): Entry[] => {
      const entries: Entry[] = [];
      for (const index of indices) {
        const candidate = cells[index];
        const focus = focusById.get(candidate.id) ?? 0;
        const dx = candidate.pos_seed[0] - camera[0];
        const dy = candidate.pos_seed[1] - camera[1];
        const dz = candidate.pos_seed[2] - camera[2];
        const distSq = dx * dx + dy * dy + dz * dz;
        if (focus <= 0 && distSq >= FAR_DIST * FAR_DIST) continue;
        const dist = Math.sqrt(distSq);
        const cameraDetail = Math.max(
          0,
          Math.min(1, (FAR_DIST - dist) / (FAR_DIST - 2.5)),
        );
        const detail = Math.max(
          cameraDetail,
          focus * (0.68 + cameraDetail * 0.32),
        );
        if (detail > 0.02) entries.push({ index, focus, dist, detail });
      }
      entries.sort((left, right) => (
        Number(cells[right.index].id === routeHopId)
          - Number(cells[left.index].id === routeHopId)
        || right.focus - left.focus
        || left.dist - right.dist
      ));
      if (entries.length > cap) entries.length = cap;
      return entries;
    };

    const allIndices = cells.map((_, index) => index);
    for (let probe = 0; probe < 60; probe += 1) {
      const camera: [number, number, number] = [
        (random() - 0.5) * 150,
        (random() - 0.5) * 60,
        (random() - 0.5) * 150,
      ];
      const focusById = new Map<number, number>();
      for (let focus = 0; focus < 8; focus += 1) {
        focusById.set(
          Math.floor(random() * cells.length),
          focus === 0 ? 0 : random(),
        );
      }
      const routeHopId = [...focusById.keys()][2] ?? null;
      const candidates = queryCellNucleusCandidateIndices(
        spatial,
        cells,
        camera[0],
        camera[1],
        camera[2],
        FAR_DIST,
        slots,
        focusById.keys(),
        scratch,
      );
      const cap = [4, 8, 12][probe % 3];
      expect(select(candidates, camera, focusById, routeHopId, cap)).toEqual(
        select(allIndices, camera, focusById, routeHopId, cap),
      );
    }
  });

  it('keeps strict FAR_DIST and negative bucket boundaries byte-equivalent', () => {
    const epsilon = 1e-6;
    const cells = [
      cell(1, FAR_DIST, 0, 0),
      cell(2, FAR_DIST - epsilon, 0, 0),
      cell(3, -FAR_DIST, 0, 0),
      cell(4, -FAR_DIST + epsilon, 0, 0),
      cell(5, 0, FAR_DIST - epsilon, 0),
      cell(6, 0, 0, FAR_DIST + epsilon),
    ];
    const index = ensureCellNucleusSpatialIndex(
      makeCellNucleusSpatialIndex(), cells, cells.length, 1, FAR_DIST,
    );
    const scratch = makeCellNucleusCandidateScratch();
    const slots = slotLookup(cells);

    expect([...queryCellNucleusCandidateIndices(
      index, cells, 0, 0, 0, FAR_DIST, slots, [], scratch,
    )]).toEqual([1, 3, 4]);
    // A semantic envelope is evaluated by the old exact CellNucleus formula
    // even on the boundary, so the direct lane must retain it.
    expect([...queryCellNucleusCandidateIndices(
      index, cells, 0, 0, 0, FAR_DIST, slots, [1, 3], scratch,
    )]).toEqual([0, 1, 2, 3, 4]);
  });

  it('falls back to occupied buckets for extreme finite coordinates', () => {
    const extreme = Number.MAX_VALUE;
    const cells = [
      cell(1, extreme, extreme, extreme),
      cell(2, extreme, extreme, -extreme),
      cell(3, 0, 0, 0),
    ];
    const index = ensureCellNucleusSpatialIndex(
      makeCellNucleusSpatialIndex(),
      cells,
      cells.length,
      1,
      FAR_DIST,
    );

    // floor(MAX_VALUE / FAR_DIST) is finite but far outside the safe-integer
    // range: an integer `for (++bucket)` would never advance. The occupied-row
    // fallback still retains the exact-position candidate and rejects both
    // astronomically distant records.
    expect([...queryCellNucleusCandidateIndices(
      index,
      cells,
      extreme,
      extreme,
      extreme,
      FAR_DIST,
      slotLookup(cells),
      [],
      makeCellNucleusCandidateScratch(),
    )]).toEqual([0]);
  });

  it('reuses payload-only generations and rebuilds moved slot generations', () => {
    const original = [cell(1, 0, 0, 0), cell(2, 30, 0, 0)];
    const index = ensureCellNucleusSpatialIndex(
      makeCellNucleusSpatialIndex(), original, 2, 11, FAR_DIST,
    );
    expect(index.generation).toBe(1);
    const nextStorage = index.next;

    const republished = original.map((entry) => ({
      ...entry,
      // A stand-in payload field proves list/object identity is not the key.
      payload: 'refreshed',
    }));
    ensureCellNucleusSpatialIndex(index, republished, 2, 11, FAR_DIST);
    expect(index.generation).toBe(1);

    const moved = [republished[0], cell(2, 3, 0, 0)];
    ensureCellNucleusSpatialIndex(index, moved, 2, 12, FAR_DIST);
    expect(index.generation).toBe(2);
    expect(index.next).toBe(nextStorage);
    expect([...queryCellNucleusCandidateIndices(
      index,
      moved,
      0,
      0,
      0,
      FAR_DIST,
      slotLookup(moved),
      [],
      makeCellNucleusCandidateScratch(),
    )]).toEqual([0, 1]);
  });

  it('indexes only the drawn prefix and ignores tail-only republishes', () => {
    const cells: CellNucleusSpatialSource[] = [];
    for (let index = 0; index < 50_000; index += 1) {
      cells.push(cell(index, index, index % 7, -index));
    }
    const drawnCount = 192;
    let rebuildReads = 0;
    const measuredCells = new Proxy(cells, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) {
          rebuildReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const index = ensureCellNucleusSpatialIndex(
      makeCellNucleusSpatialIndex(),
      measuredCells,
      drawnCount,
      5,
      FAR_DIST,
    );

    expect(rebuildReads).toBe(drawnCount);
    expect(index.next).toBeInstanceOf(Int32Array);
    expect(index.next.length).toBeGreaterThanOrEqual(drawnCount);
    expect(index).not.toHaveProperty('indexById');
    expect(index).not.toHaveProperty('totalCount');

    const storage = index.next;
    let tailRepublishReads = 0;
    const extendedTail = new Proxy([...cells, cell(50_000, 1, 2, 3)], {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) {
          tailRepublishReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    ensureCellNucleusSpatialIndex(
      index,
      extendedTail,
      drawnCount,
      5,
      FAR_DIST,
    );
    expect(index.generation).toBe(1);
    expect(index.next).toBe(storage);
    expect(tailRepublishReads).toBe(0);
  });

  it('uses the supplied stable-slot lookup without widening the drawn prefix', () => {
    const cells = [
      cell(11, 0, 0, 0),
      cell(12, 1, 0, 0),
      cell(13, 2, 0, 0),
      cell(14, 3, 0, 0),
    ];
    const index = ensureCellNucleusSpatialIndex(
      makeCellNucleusSpatialIndex(), cells, 2, 1, FAR_DIST,
    );
    const slots = slotLookup(cells);
    // Ordinary direct focus cannot widen the shared draw prefix.
    expect([...queryCellNucleusCandidateIndices(
      index,
      cells,
      100,
      100,
      100,
      FAR_DIST,
      slots,
      [14],
      makeCellNucleusCandidateScratch(),
    )]).toEqual([]);
    // A stale hit must not admit the wrong occupant as the semantic Cell.
    expect([...queryCellNucleusCandidateIndices(
      index,
      cells,
      100,
      100,
      100,
      FAR_DIST,
      new Map([[14, 0]]),
      [14],
      makeCellNucleusCandidateScratch(),
    )]).toEqual([]);
  });

  it('keeps a steady 50k field query proportional to local occupancy', () => {
    const cells: CellNucleusSpatialSource[] = [];
    for (let index = 0; index < 50_000; index += 1) {
      cells.push(cell(
        index,
        (index % 100) * 3,
        (Math.floor(index / 100) % 20) * 3,
        Math.floor(index / 2_000) * 3,
      ));
    }
    const spatial = ensureCellNucleusSpatialIndex(
      makeCellNucleusSpatialIndex(),
      cells,
      cells.length,
      1,
      FAR_DIST,
    );
    const scratch = makeCellNucleusCandidateScratch();
    const camera: [number, number, number] = [150, 30, 36];
    const directIds = new Set([49_999]);
    const slots = slotLookup(cells);
    let indexedReads = 0;
    const measuredCells = new Proxy(cells, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) {
          indexedReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const storage = spatial.next;
    for (let frame = 0; frame < 64; frame += 1) {
      ensureCellNucleusSpatialIndex(
        spatial,
        measuredCells,
        cells.length,
        1,
        FAR_DIST,
      );
    }
    expect(spatial.generation).toBe(1);
    expect(spatial.next).toBe(storage);
    expect(indexedReads).toBe(0);

    const actual = queryCellNucleusCandidateIndices(
      spatial,
      measuredCells,
      camera[0],
      camera[1],
      camera[2],
      FAR_DIST,
      slots,
      directIds,
      scratch,
    );

    expect([...actual]).toEqual(
      referenceCandidates(cells, cells.length, camera, FAR_DIST, directIds),
    );
    expect(indexedReads).toBeLessThan(1_000);
    expect(actual.length).toBeLessThan(250);
    expect(actual).toContain(49_999);
  });
});
