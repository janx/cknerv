import { describe, expect, it } from 'vitest';
import {
  CELL_NUCLEUS_FAR_FIELD_GATE_SLACK,
  collectCellNucleusCandidateIndices,
  ensureCellNucleusSpatialIndex,
  makeCellNucleusCandidateScratch,
  makeCellNucleusLodCandidateCache,
  makeCellNucleusSpatialIndex,
  queryCellNucleusCandidateIndices,
  type CellNucleusSpatialSource,
} from '../../src/derives/cellNucleusSpatialLod.derive';
import { ensureCellFieldBounds } from '../../src/derives/cellNucleusFarField.derive';
import { helixSeedF64 } from '../../src/helix';

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

function makeRandom(initial: number): () => number {
  let seed = initial >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

// ---------------------------------------------------------------------------
// The nested-Map bucket index this module replaced (5c4394d), kept here as
// the reference the flat grid must match bucket-for-bucket: same bucket
// arithmetic, same strict sphere test, same slot-sorted answer.
// ---------------------------------------------------------------------------
interface ReferenceBucketIndex {
  count: number;
  bucketSize: number;
  rows: Map<number, Map<number, Map<number, number>>>;
  next: Int32Array;
}

function buildReferenceBucketIndex(
  cells: readonly CellNucleusSpatialSource[],
  count: number,
  bucketSize: number,
): ReferenceBucketIndex {
  const index: ReferenceBucketIndex = {
    count,
    bucketSize,
    rows: new Map(),
    next: new Int32Array(Math.max(1, count)),
  };
  for (let slot = 0; slot < count; slot += 1) {
    const [x, y, z] = cells[slot].pos_seed;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      index.next[slot] = -1;
      continue;
    }
    const bx = Math.floor(x / bucketSize);
    const by = Math.floor(y / bucketSize);
    const bz = Math.floor(z / bucketSize);
    let yRows = index.rows.get(bx);
    if (!yRows) {
      yRows = new Map();
      index.rows.set(bx, yRows);
    }
    let zHeads = yRows.get(by);
    if (!zHeads) {
      zHeads = new Map();
      yRows.set(by, zHeads);
    }
    index.next[slot] = zHeads.get(bz) ?? -1;
    zHeads.set(bz, slot);
  }
  return index;
}

function queryReferenceBucketIndex(
  index: ReferenceBucketIndex,
  cells: readonly CellNucleusSpatialSource[],
  camera: readonly [number, number, number],
  radius: number,
  slots: ReadonlyMap<number, number>,
  directIds: Iterable<number>,
): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  const add = (slot: number) => {
    if (seen.has(slot)) return;
    seen.add(slot);
    out.push(slot);
  };
  const walk = (head: number) => {
    let slot = head;
    while (slot >= 0) {
      const [x, y, z] = cells[slot].pos_seed;
      const dx = x - camera[0];
      const dy = y - camera[1];
      const dz = z - camera[2];
      if (dx * dx + dy * dy + dz * dz < radius * radius) add(slot);
      slot = index.next[slot];
    }
  };
  const [cx, cy, cz] = camera;
  const minBx = Math.floor((cx - radius) / index.bucketSize);
  const maxBx = Math.floor((cx + radius) / index.bucketSize);
  const minBy = Math.floor((cy - radius) / index.bucketSize);
  const maxBy = Math.floor((cy + radius) / index.bucketSize);
  const minBz = Math.floor((cz - radius) / index.bucketSize);
  const maxBz = Math.floor((cz + radius) / index.bucketSize);
  for (let bx = minBx; bx <= maxBx; bx += 1) {
    const yRows = index.rows.get(bx);
    for (let by = minBy; by <= maxBy; by += 1) {
      const zHeads = yRows?.get(by);
      for (let bz = minBz; bz <= maxBz; bz += 1) {
        walk(zHeads?.get(bz) ?? -1);
      }
    }
  }
  for (const cellId of directIds) {
    const slot = slots.get(cellId);
    if (slot !== undefined && slot < index.count && cells[slot]?.id === cellId) {
      add(slot);
    }
  }
  return out.sort((left, right) => left - right);
}

/** A hash-placed field on the production helix law, ids drawn from both id
 * families the renderer sees (small sequential and 2^52-based). */
function helixField(
  size: number,
  firstId: number,
  random: () => number,
): CellNucleusSpatialSource[] {
  const cells: CellNucleusSpatialSource[] = [];
  for (let slot = 0; slot < size; slot += 1) {
    const id = random() < 0.5
      ? firstId + slot
      : 2 ** 52 + firstId + slot;
    cells.push({ id, pos_seed: helixSeedF64(id) });
  }
  return cells;
}

/** Emulates one `syncCellSlots` membership move: a few slots change
 * occupant (fresh ids, fresh hash positions), one relocates in place. */
function moveMembership(
  cells: readonly CellNucleusSpatialSource[],
  nextId: number,
  random: () => number,
): CellNucleusSpatialSource[] {
  const moved = cells.slice();
  const churn = Math.max(1, Math.floor(moved.length * 0.05));
  for (let step = 0; step < churn; step += 1) {
    const slot = Math.floor(random() * moved.length);
    const id = nextId + step;
    moved[slot] = { id, pos_seed: helixSeedF64(id) };
  }
  const relocated = Math.floor(random() * moved.length);
  const before = moved[relocated];
  moved[relocated] = {
    id: before.id,
    pos_seed: [before.pos_seed[0] + 1.5, before.pos_seed[1], before.pos_seed[2] - 1],
  };
  return moved;
}

type Pose = 'inside' | 'rim' | 'far';

function randomPose(
  kind: Pose,
  cells: readonly CellNucleusSpatialSource[],
  count: number,
  random: () => number,
): [number, number, number] {
  const bounds = ensureCellFieldBounds({
    version: -1, count: -1, centerX: 0, centerY: 0, centerZ: 0, radius: 0,
  }, cells, count, 0);
  const direction = [random() - 0.5, random() - 0.5, random() - 0.5];
  const length = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  const unit = direction.map((axis) => axis / length);
  if (kind === 'inside') {
    const anchor = cells[Math.floor(random() * count)].pos_seed;
    return [
      anchor[0] + (random() - 0.5) * 12,
      anchor[1] + (random() - 0.5) * 12,
      anchor[2] + (random() - 0.5) * 12,
    ];
  }
  const distance = kind === 'rim'
    ? bounds.radius + FAR_DIST + (random() - 0.5) * 4
    : 120 + random() * 180;
  return [
    bounds.centerX + unit[0] * distance,
    bounds.centerY + unit[1] * distance,
    bounds.centerZ + unit[2] * distance,
  ];
}

function randomDirectIds(
  cells: readonly CellNucleusSpatialSource[],
  count: number,
  random: () => number,
): Set<number> {
  const ids = new Set<number>();
  const wanted = Math.floor(random() * 5);
  for (let step = 0; step < wanted; step += 1) {
    const roll = random();
    if (roll < 0.6) ids.add(cells[Math.floor(random() * count)].id);
    else if (roll < 0.8 && count < cells.length) {
      ids.add(cells[count + Math.floor(random() * (cells.length - count))].id);
    } else ids.add(-1 - step);
  }
  return ids;
}

interface NearEntry { index: number; focus: number; dist: number; detail: number }

/** The exact CellNucleus bake + LOD sort + cap over a candidate list. */
function selectNear(
  cells: readonly CellNucleusSpatialSource[],
  indices: Iterable<number>,
  camera: readonly [number, number, number],
  focusById: ReadonlyMap<number, number>,
  routeHopId: number | null,
  cap: number,
): NearEntry[] {
  const entries: NearEntry[] = [];
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
}

describe('CellNucleus private spatial LOD index', () => {
  it('matches the full-prefix candidate oracle across 3D camera probes', () => {
    const random = makeRandom(0x91d3a5f7);
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
      expect(selectNear(cells, candidates, camera, focusById, routeHopId, cap))
        .toEqual(selectNear(cells, allIndices, camera, focusById, routeHopId, cap));
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

  it('keeps extreme finite coordinates exact through the overflow chain', () => {
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

    // floor(MAX_VALUE / FAR_DIST) is finite but far outside int32 and the
    // safe-integer range: no dense grid can hold it and an integer
    // `for (++bucket)` would never advance. The field takes the exact
    // overflow chain instead, which still retains the exact-position
    // candidate and rejects both astronomically distant records.
    expect(index.dense).toBe(false);
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
    // A dense field queried from an extreme camera clamps to the grid and
    // misses, instead of walking a non-advancing bucket range.
    const compact = [cell(1, 0, 0, 0), cell(2, 3, 0, 0)];
    const compactIndex = ensureCellNucleusSpatialIndex(
      makeCellNucleusSpatialIndex(), compact, 2, 1, FAR_DIST,
    );
    expect(compactIndex.dense).toBe(true);
    expect([...queryCellNucleusCandidateIndices(
      compactIndex,
      compact,
      extreme,
      -extreme,
      extreme,
      FAR_DIST,
      slotLookup(compact),
      [],
      makeCellNucleusCandidateScratch(),
    )]).toEqual([]);
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
    // The gated collector applies the same validation on its far path.
    const cache = makeCellNucleusLodCandidateCache();
    expect([...collectCellNucleusCandidateIndices(
      cache, cells, 2, 1, 100, 100, 100, FAR_DIST, new Map([[14, 0]]), [14],
    )]).toEqual([]);
    expect([...collectCellNucleusCandidateIndices(
      cache, cells, 2, 1, 100, 100, 100, FAR_DIST, slots, [12, 13],
    )]).toEqual([1]);
    expect(cache.index.generation).toBe(0);
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

  it('rebuilds allocation-free once its typed storage is sized', () => {
    const random = makeRandom(0x5eed1234);
    const cells = helixField(3_000, 100, random);
    const index = ensureCellNucleusSpatialIndex(
      makeCellNucleusSpatialIndex(), cells, cells.length, 1, FAR_DIST,
    );
    expect(index.dense).toBe(true);
    expect(index).not.toHaveProperty('rows');
    const { heads, next, bucketCoords } = index;
    let field = cells;
    for (let version = 2; version < 12; version += 1) {
      field = moveMembership(field, 10_000 * version, random);
      // Membership moves and a shrinking prefix reuse every buffer; only a
      // field larger than any seen so far may size up.
      const count = version % 3 === 0 ? field.length - 40 : field.length;
      ensureCellNucleusSpatialIndex(index, field, count, version, FAR_DIST);
      expect(index.generation).toBe(version);
      expect(index.heads).toBe(heads);
      expect(index.next).toBe(next);
      expect(index.bucketCoords).toBe(bucketCoords);
    }
  });

  it('matches the nested-Map bucket query it replaced, and the exact walk, over thousands of poses and several field versions', () => {
    const random = makeRandom(0x0badf00d);
    let field = helixField(6_000, 1, random);
    let count = field.length;
    const cache = makeCellNucleusLodCandidateCache();
    const scratch = makeCellNucleusCandidateScratch();
    const flat = makeCellNucleusSpatialIndex();
    const kinds: Pose[] = ['inside', 'rim', 'far'];
    let poses = 0;
    let insidePoses = 0;
    let admittedSomething = 0;
    for (let version = 1; version <= 5; version += 1) {
      if (version > 1) {
        field = moveMembership(field, 20_000 * version, random);
        count = version % 2 === 0 ? field.length - 250 : field.length;
      }
      const slots = slotLookup(field);
      const reference = buildReferenceBucketIndex(field, count, FAR_DIST);
      ensureCellNucleusSpatialIndex(flat, field, count, version, FAR_DIST);
      const allIndices = Array.from({ length: count }, (_, index) => index);
      for (let probe = 0; probe < 600; probe += 1) {
        const kind = kinds[probe % 3];
        const camera = randomPose(kind, field, count, random);
        const directIds = randomDirectIds(field, count, random);
        const expected = queryReferenceBucketIndex(
          reference, field, camera, FAR_DIST, slots, directIds,
        );
        expect(expected).toEqual(
          referenceCandidates(field, count, camera, FAR_DIST, directIds),
        );
        const viaIndex = queryCellNucleusCandidateIndices(
          flat, field, camera[0], camera[1], camera[2], FAR_DIST,
          slots, directIds, scratch,
        );
        expect([...viaIndex]).toEqual(expected);
        const viaGate = collectCellNucleusCandidateIndices(
          cache, field, count, version, camera[0], camera[1], camera[2],
          FAR_DIST, slots, directIds,
        );
        expect([...viaGate]).toEqual(expected);

        // The near set CellNucleus finally bakes — same slots, same order
        // after the focus/distance sort, same cap — from the gated collector
        // and from the full-prefix walk.
        const focusById = new Map<number, number>();
        for (const id of directIds) focusById.set(id, random());
        const routeHopId = [...directIds][0] ?? null;
        const near = selectNear(field, viaGate, camera, focusById, routeHopId, 12);
        expect(near).toEqual(
          selectNear(field, allIndices, camera, focusById, routeHopId, 12),
        );
        poses += 1;
        if (kind === 'inside') insidePoses += 1;
        if (near.length > 0) admittedSomething += 1;
      }
    }
    expect(poses).toBe(3_000);
    // The sweep must actually exercise admission, not only empty answers.
    expect(insidePoses).toBe(1_000);
    expect(admittedSomething).toBeGreaterThan(500);
  });

  it('never builds or refreshes the index while the whole field is beyond the radius', () => {
    const random = makeRandom(0xfa5fa5);
    let field = helixField(4_000, 7, random);
    const cache = makeCellNucleusLodCandidateCache();
    // The default production pose: ~189 wu from the field centre, well past
    // the ~62 wu sphere plus the 9.5 wu admission radius.
    const overview: [number, number, number] = [110, 108, 110];
    let reads = 0;
    const measured = (cells: CellNucleusSpatialSource[]) => new Proxy(cells, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) reads += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    // Block frame + exit-hold reap + cohort churn: many version bumps, all
    // observed from the overview.
    for (let version = 1; version <= 40; version += 1) {
      field = moveMembership(field, 50_000 * version, random);
      const slots = slotLookup(field);
      const count = field.length;
      const list = measured(field);
      reads = 0;
      const answer = collectCellNucleusCandidateIndices(
        cache, list, count, version, overview[0], overview[1], overview[2],
        FAR_DIST, slots, [],
      );
      expect([...answer]).toEqual([]);
      // One bounds rescan (two passes) at most — never a grid rebuild.
      expect(reads).toBeGreaterThan(0);
      expect(reads).toBeLessThanOrEqual(2 * count);
      expect(cache.index.generation).toBe(0);
      expect(cache.bounds.version).toBe(version);

      // Steady 12 Hz ticks at the same version touch no record at all.
      reads = 0;
      for (let tick = 0; tick < 12; tick += 1) {
        collectCellNucleusCandidateIndices(
          cache, list, count, version, overview[0], overview[1], overview[2],
          FAR_DIST, slots, [],
        );
      }
      expect(reads).toBe(0);

      // Focus / hover / recall / route-hop ids still resolve at any distance,
      // reading exactly the records they name.
      const focused = [field[3].id, field[count - 1].id, -42];
      reads = 0;
      const withFocus = collectCellNucleusCandidateIndices(
        cache, list, count, version, overview[0], overview[1], overview[2],
        FAR_DIST, slots, focused,
      );
      expect([...withFocus]).toEqual([3, count - 1]);
      expect(reads).toBe(2);
      expect(cache.index.generation).toBe(0);
    }
  });

  it('builds the index on the first tick inside the field and refreshes it only for a new version', () => {
    const random = makeRandom(0x1234abcd);
    let field = helixField(4_000, 9, random);
    const cache = makeCellNucleusLodCandidateCache();
    const overview: [number, number, number] = [110, 108, 110];
    const dolly = field[17].pos_seed;
    const query = (
      camera: readonly [number, number, number],
      version: number,
    ) => collectCellNucleusCandidateIndices(
      cache, field, field.length, version, camera[0], camera[1], camera[2],
      FAR_DIST, slotLookup(field), [],
    );

    query(overview, 1);
    expect(cache.index.generation).toBe(0);
    expect([...query(dolly, 1)]).toEqual(
      referenceCandidates(field, field.length, dolly, FAR_DIST, new Set()),
    );
    expect(cache.index.generation).toBe(1);
    for (let tick = 0; tick < 24; tick += 1) query(dolly, 1);
    expect(cache.index.generation).toBe(1);

    // A membership move while inside rebuilds once, on the tick that sees it.
    field = moveMembership(field, 90_000, random);
    expect([...query(dolly, 2)]).toEqual(
      referenceCandidates(field, field.length, dolly, FAR_DIST, new Set()),
    );
    expect(cache.index.generation).toBe(2);

    // Moves observed only from the overview leave the stale index alone…
    for (let version = 3; version <= 6; version += 1) {
      field = moveMembership(field, 100_000 * version, random);
      query(overview, version);
      expect(cache.index.generation).toBe(2);
      expect(cache.index.version).toBe(2);
    }
    // …and it is never queried stale: the first tick back inside rebuilds
    // for the current version before answering.
    expect([...query(dolly, 6)]).toEqual(
      referenceCandidates(field, field.length, dolly, FAR_DIST, new Set()),
    );
    expect(cache.index.generation).toBe(3);
    expect(cache.index.version).toBe(6);
  });

  it('keeps the gate conservative by a hair of slack at the sphere boundary', () => {
    const random = makeRandom(0x77777777);
    const field = helixField(1_000, 3, random);
    const bounds = ensureCellFieldBounds({
      version: -1, count: -1, centerX: 0, centerY: 0, centerZ: 0, radius: 0,
    }, field, field.length, 1);
    const cache = makeCellNucleusLodCandidateCache();
    const at = (distance: number): [number, number, number] => [
      bounds.centerX + distance,
      bounds.centerY,
      bounds.centerZ,
    ];
    const edge = bounds.radius + FAR_DIST;
    const tick = (camera: readonly [number, number, number]) => (
      collectCellNucleusCandidateIndices(
        cache, field, field.length, 1, camera[0], camera[1], camera[2],
        FAR_DIST, slotLookup(field), [],
      )
    );
    // Exactly on the walk's own boundary the exact test still decides…
    tick(at(edge + CELL_NUCLEUS_FAR_FIELD_GATE_SLACK / 2));
    expect(cache.index.generation).toBe(1);
    // …and past the slack the proof stands alone.
    const gated = makeCellNucleusLodCandidateCache();
    collectCellNucleusCandidateIndices(
      gated, field, field.length, 1,
      ...at(edge + CELL_NUCLEUS_FAR_FIELD_GATE_SLACK * 2),
      FAR_DIST, slotLookup(field), [],
    );
    expect(gated.index.generation).toBe(0);
  });

  it('fails the gate open for a non-finite position and keeps that slot unadmitted', () => {
    const cells = [
      cell(1, 0, 0, 0),
      cell(2, Number.NaN, 0, 0),
      cell(3, 4, 0, 0),
    ];
    const cache = makeCellNucleusLodCandidateCache();
    // An unknown radius cannot prove anything, so even a far camera builds
    // the index — where the NaN slot is skipped exactly as before.
    expect([...collectCellNucleusCandidateIndices(
      cache, cells, 3, 1, 500, 500, 500, FAR_DIST, slotLookup(cells), [],
    )]).toEqual([]);
    expect(cache.bounds.radius).toBe(Number.POSITIVE_INFINITY);
    expect(cache.index.generation).toBe(1);
    expect([...collectCellNucleusCandidateIndices(
      cache, cells, 3, 1, 1, 0, 0, FAR_DIST, slotLookup(cells), [2],
    )]).toEqual([0, 1, 2]);
  });
});
