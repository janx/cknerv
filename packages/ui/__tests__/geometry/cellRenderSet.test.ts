import { describe, expect, it } from 'vitest';
import type { AssetKind, Cell, GalaxyCompositionRecord } from '@cknerv/types';
import {
  cellRenderList,
  cellRenderMap,
  createCellRenderSetState,
  currentActivityCellIds,
  sameCellRenderTopology,
  syncCellRenderSet,
} from '../../src/geometry/cellRenderSet';
import type { CellInspectionField } from '../../src/nerve/cellInspectionField';
import { applyCellDelta, applyRevisionedCellDeltas, emptyCellsCache } from '@cknerv/cache';

function cell(id: number, assetKind?: AssetKind): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [id, 0, 0],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 0,
    data_hex: '0x',
    content_hash: `0x${'00'.repeat(32)}`,
    asset_kind: assetKind,
  };
}

function composition(
  dao: Cell[],
  typed: Cell[],
  plain: Cell[],
): GalaxyCompositionRecord {
  return {
    source: 'ckbadger',
    as_of: { block: 10, hash: '0xblock10' },
    updated_at_ms: 1,
    dao,
    typed,
    plain,
  };
}

describe('cellRenderList', () => {
  const cells = new Map(
    Array.from({ length: 10 }, (_, id) => [id, cell(id)] as const),
  );

  it('uses the bounded cache prefix when no semantic Cell is selected', () => {
    expect(cellRenderList(cells, 4, null, null).map(({ id }) => id))
      .toEqual([0, 1, 2, 3]);
    expect(cellRenderList(cells, Number.NaN, null, null)).toEqual([]);
  });

  it('stops iterating once the resting display budget is filled', () => {
    let visited = 0;
    const instrumented = new Map(cells);
    const values = instrumented.values.bind(instrumented);
    instrumented.values = function* instrumentedValues() {
      for (const value of values()) {
        visited += 1;
        yield value;
      }
    } as typeof instrumented.values;

    expect(cellRenderList(instrumented, 4, null, null).map(({ id }) => id))
      .toEqual([0, 1, 2, 3]);
    expect(visited).toBe(4);
  });

  it('pins a selected Cell without scanning the hidden tail when no field is active', () => {
    let visited = 0;
    const instrumented = new Map(cells);
    const values = instrumented.values.bind(instrumented);
    instrumented.values = function* instrumentedValues() {
      for (const value of values()) {
        visited += 1;
        yield value;
      }
    } as typeof instrumented.values;

    expect(cellRenderList(instrumented, 4, 9, null).map(({ id }) => id))
      .toEqual([0, 1, 2, 9]);
    expect(visited).toBe(4);
  });

  it('pins selected graph context without exceeding the shared budget', () => {
    const field: CellInspectionField = {
      selectedCellId: 9,
      maxHops: 2,
      hopsByCellId: new Map([[9, 0], [8, 1], [7, 2]]),
    };
    const rendered = cellRenderList(cells, 4, 9, field);
    const renderedMap = cellRenderMap(rendered);

    expect(rendered).toHaveLength(4);
    expect(renderedMap.size).toBe(4);
    expect([...renderedMap.keys()]).toEqual(expect.arrayContaining([7, 8, 9]));
  });

  it('composes the 6000-cell resting field at exactly 30:40:30', () => {
    const record = composition(
      Array.from({ length: 1_800 }, (_, index) => cell(10_000 + index, 'dao')),
      Array.from({ length: 2_400 }, (_, index) => cell(20_000 + index, 'xudt')),
      Array.from({ length: 1_800 }, (_, index) => cell(30_000 + index, 'native')),
    );

    const rendered = cellRenderList(new Map(), 6_000, null, null, record);
    const counts = rendered.reduce((acc, entry) => {
      if (entry.asset_kind === 'dao') acc.dao += 1;
      else if (entry.asset_kind === 'native') acc.plain += 1;
      else acc.typed += 1;
      return acc;
    }, { dao: 0, typed: 0, plain: 0 });

    expect(rendered).toHaveLength(6_000);
    expect(counts).toEqual({ dao: 1_800, typed: 2_400, plain: 1_800 });
  });

  it('pins newest canonical activity inside its class quota', () => {
    const record = composition(
      [cell(101, 'dao'), cell(102, 'dao'), cell(103, 'dao')],
      [cell(201, 'xudt'), cell(202, 'xudt'), cell(203, 'xudt'), cell(204, 'xudt')],
      [cell(301, 'native'), cell(302, 'native'), cell(303, 'native')],
    );
    const active = cell(999, 'xudt');
    const canonical = new Map([[active.id, active]]);

    const rendered = cellRenderList(canonical, 10, null, null, record, [active.id]);

    expect(rendered.map(({ id }) => id)).toContain(active.id);
    expect(rendered.filter(({ asset_kind }) => asset_kind === 'dao')).toHaveLength(3);
    expect(rendered.filter(({ asset_kind }) => asset_kind === 'native')).toHaveLength(3);
    expect(rendered.filter(({ asset_kind }) => asset_kind === 'xudt')).toHaveLength(4);
    expect(canonical.size).toBe(1);
    expect(canonical.get(active.id)).toBe(active);
  });

  it('prefers a canonical Cell over an indexed copy of the same outpoint', () => {
    const indexed = cell(101, 'dao');
    const canonical = { ...cell(1, 'dao'), out_point: indexed.out_point };
    const record = composition(
      [indexed, cell(102, 'dao'), cell(103, 'dao')],
      [cell(201, 'xudt'), cell(202, 'xudt'), cell(203, 'xudt'), cell(204, 'xudt')],
      [cell(301, 'native'), cell(302, 'native'), cell(303, 'native')],
    );

    const rendered = cellRenderList(
      new Map([[canonical.id, canonical]]),
      10,
      null,
      null,
      record,
    );

    expect(rendered.map(({ id }) => id)).toContain(canonical.id);
    expect(rendered.map(({ id }) => id)).not.toContain(indexed.id);
  });

  it('extracts activity endpoints only from the newest block', () => {
    const pulseLinks = [
      { block: 9, from_ids: [1], to_ids: [2] },
      { block: 10, from_ids: [3], to_ids: [4] },
      { block: 10, from_ids: [4], to_ids: [5] },
    ] as Parameters<typeof currentActivityCellIds>[0]['pulseLinks'];

    expect(currentActivityCellIds({ pulseLinks })).toEqual([4, 5, 3]);
  });
});

// ————— composed-path optimizations must be invisible in the output —————
// Reference oracle: verbatim copy of the pre-optimization algorithm
// (unconditional outpoint index + unbounded canonical fallback walk).
function referenceComposedList(
  canonicalCells: ReadonlyMap<number, Cell>,
  visibleCount: number,
  selectedCellId: number | null,
  field: CellInspectionField | null,
  record: GalaxyCompositionRecord,
  activityCellIds: readonly number[],
): Cell[] {
  type Bucket = 'dao' | 'typed' | 'plain';
  const INTERLEAVE: readonly Bucket[] = [
    'dao', 'typed', 'plain', 'typed', 'dao',
    'typed', 'plain', 'dao', 'typed', 'plain',
  ];
  const bucketOf = (c: Cell): Bucket =>
    c.asset_kind === 'dao' ? 'dao' : c.asset_kind === 'native' ? 'plain' : 'typed';
  const targetsOf = (total: number): Record<Bucket, number> => {
    const dao = Math.floor(total * 0.3);
    const typed = Math.floor(total * 0.4);
    return { dao, typed, plain: total - dao - typed };
  };
  const opKey = (c: Cell) => `${c.out_point.tx_hash}:${c.out_point.index}`;
  const requestedCount = Number.isFinite(visibleCount)
    ? Math.max(0, Math.floor(visibleCount))
    : visibleCount === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : 0;
  if (requestedCount === 0) return [];
  const byOutPoint = new Map<string, Cell>();
  for (const c of canonicalCells.values()) byOutPoint.set(opKey(c), c);
  const byId = new Map<number, Cell>();
  for (const c of [...record.dao, ...record.typed, ...record.plain]) byId.set(c.id, c);
  const buckets: Record<Bucket, Cell[]> = { dao: [], typed: [], plain: [] };
  const admittedIds = new Set<number>();
  const admittedOps = new Set<string>();
  const admit = (c: Cell | undefined, expected?: Bucket) => {
    if (!c) return;
    const bucket = bucketOf(c);
    if (expected !== undefined && bucket !== expected) return;
    const op = opKey(c);
    if (admittedIds.has(c.id) || admittedOps.has(op)) return;
    admittedIds.add(c.id);
    admittedOps.add(op);
    buckets[bucket].push(c);
  };
  const cellById = (id: number) => canonicalCells.get(id) ?? byId.get(id);
  admit(selectedCellId === null ? undefined : cellById(selectedCellId));
  if (field?.selectedCellId === selectedCellId) {
    const fieldIds = [...field.hopsByCellId]
      .filter(([, hop]) => Number.isFinite(hop) && hop >= 0 && hop <= field.maxHops)
      .sort(([a, ah], [b, bh]) => ah - bh || a - b);
    for (const [id] of fieldIds) admit(cellById(id));
  }
  for (const id of activityCellIds) admit(canonicalCells.get(id));
  for (const bucket of ['dao', 'typed', 'plain'] as const) {
    for (const c of record[bucket]) admit(byOutPoint.get(opKey(c)) ?? c, bucket);
  }
  for (const c of canonicalCells.values()) admit(c);
  const available = buckets.dao.length + buckets.typed.length + buckets.plain.length;
  const count = Math.min(requestedCount, available);
  if (count === 0) return [];
  const targets = targetsOf(count);
  const selected = selectedCellId === null ? undefined : cellById(selectedCellId);
  if (selected) {
    const sb = bucketOf(selected);
    if (targets[sb] === 0) {
      const donor = (['plain', 'typed', 'dao'] as const).find(
        (b) => b !== sb && targets[b] > 0,
      );
      if (donor) { targets[donor] -= 1; targets[sb] += 1; }
    }
  }
  const chosen: Record<Bucket, Cell[]> = {
    dao: buckets.dao.slice(0, targets.dao),
    typed: buckets.typed.slice(0, targets.typed),
    plain: buckets.plain.slice(0, targets.plain),
  };
  let chosenCount = chosen.dao.length + chosen.typed.length + chosen.plain.length;
  const nextIndex = { dao: chosen.dao.length, typed: chosen.typed.length, plain: chosen.plain.length };
  while (chosenCount < count) {
    let progressed = false;
    for (const bucket of ['dao', 'typed', 'plain'] as const) {
      const c = buckets[bucket][nextIndex[bucket]];
      if (!c) continue;
      chosen[bucket].push(c);
      nextIndex[bucket] += 1;
      chosenCount += 1;
      progressed = true;
      if (chosenCount === count) break;
    }
    if (!progressed) break;
  }
  const rendered: Cell[] = [];
  const cursors = { dao: 0, typed: 0, plain: 0 };
  while (rendered.length < chosenCount) {
    let progressed = false;
    for (const preferred of INTERLEAVE) {
      let bucket: Bucket | undefined = preferred;
      if (cursors[bucket] >= chosen[bucket].length) {
        bucket = (['dao', 'typed', 'plain'] as const).find(
          (b) => cursors[b] < chosen[b].length,
        );
      }
      if (!bucket) break;
      rendered.push(chosen[bucket][cursors[bucket]]);
      cursors[bucket] += 1;
      progressed = true;
      if (rendered.length === chosenCount) break;
    }
    if (!progressed) break;
  }
  return rendered;
}

describe('composed path equivalence and cost', () => {
  function canonicalField(count: number): Map<number, Cell> {
    const map = new Map<number, Cell>();
    for (let id = 0; id < count; id += 1) {
      const kind: AssetKind = id % 7 === 0 ? 'dao' : id % 3 === 0 ? 'xudt' : 'native';
      map.set(id, cell(id, kind));
    }
    return map;
  }

  function expectEquivalent(
    canonical: Map<number, Cell>,
    budget: number,
    selectedCellId: number | null,
    field: CellInspectionField | null,
    record: GalaxyCompositionRecord,
    activity: number[],
  ) {
    const actual = cellRenderList(canonical, budget, selectedCellId, field, record, activity);
    const expected = referenceComposedList(canonical, budget, selectedCellId, field, record, activity);
    expect(actual.map((c) => c.id)).toEqual(expected.map((c) => c.id));
    // Same retained-object resolution, not just the same ids.
    for (let i = 0; i < actual.length; i += 1) expect(actual[i]).toBe(expected[i]);
    return actual;
  }

  it('matches the reference when the composition covers every quota', () => {
    const canonical = canonicalField(300);
    const all = [...canonical.values()];
    // Composition entries are id-stable copies of canonical records.
    const record = composition(
      all.filter((c) => c.asset_kind === 'dao').slice(0, 40).map((c) => ({ ...c })),
      all.filter((c) => c.asset_kind === 'xudt').slice(0, 50).map((c) => ({ ...c })),
      all.filter((c) => c.asset_kind === 'native').slice(0, 40).map((c) => ({ ...c })),
    );
    expectEquivalent(canonical, 60, null, null, record, [5, 11]);
  });

  it('matches the reference when sparse classes force the canonical fallback', () => {
    const canonical = canonicalField(240);
    const record = composition(
      [cell(1_001, 'dao')],
      [cell(2_001, 'xudt')],
      [cell(3_001, 'native')],
    );
    expectEquivalent(canonical, 90, 3, null, record, [7]);
  });

  it('matches the reference through selection, field, and tiny donor budgets', () => {
    const canonical = canonicalField(40);
    const record = composition(
      [cell(1_001, 'dao'), cell(1_002, 'dao')],
      [cell(2_001, 'xudt')],
      [cell(3_001, 'native')],
    );
    const field: CellInspectionField = {
      selectedCellId: 14,
      maxHops: 2,
      hopsByCellId: new Map([[14, 0], [3, 1], [9, 2]]),
    };
    expectEquivalent(canonical, 12, 14, field, record, [6, 21]);
    // Budget below the early-exit guard exercises the donor adjustment path.
    expectEquivalent(canonical, 3, 14, field, record, []);
  });

  it('skips both the canonical walk and the outpoint index once quotas fill', () => {
    const size = 3_000;
    const canonical = canonicalField(size);
    const all = [...canonical.values()];
    const record = composition(
      all.filter((c) => c.asset_kind === 'dao').slice(0, 40).map((c) => ({ ...c })),
      all.filter((c) => c.asset_kind === 'xudt').slice(0, 50).map((c) => ({ ...c })),
      all.filter((c) => c.asset_kind === 'native').slice(0, 60).map((c) => ({ ...c })),
    );
    let visited = 0;
    const instrumented = new Map(canonical);
    const values = instrumented.values.bind(instrumented);
    instrumented.values = function* instrumentedValues() {
      for (const value of values()) {
        visited += 1;
        yield value;
      }
    } as typeof instrumented.values;

    const rendered = cellRenderList(instrumented, 30, null, null, record, []);
    expect(rendered).toHaveLength(30);
    // Id-verified resolution avoids building the outpoint index, and filled
    // quotas stop the canonical fallback before it starts — nothing iterates
    // the retained map.
    expect(visited).toBe(0);
  });

  it('two render-set cursors share one composed resolution per input set', () => {
    const canonical = canonicalField(120);
    const record = composition(
      Array.from({ length: 12 }, (_, i) => cell(1_000 + i, 'dao')),
      Array.from({ length: 16 }, (_, i) => cell(2_000 + i, 'xudt')),
      Array.from({ length: 12 }, (_, i) => cell(3_000 + i, 'native')),
    );
    const first = cellRenderList(canonical, 30, null, null, record, [1, 2]);
    // Second caller passes a DIFFERENT activity array with the same content —
    // exactly what the two components' independent useMemos produce.
    const second = cellRenderList(canonical, 30, null, null, record, [1, 2]);
    expect(second).toBe(first);
    // A second input variant (selection open) occupies the other memo slot…
    const variant = cellRenderList(canonical, 30, 5, null, record, [1, 2]);
    expect(variant).not.toBe(first);
    // …and neither evicts the other while the two disagree.
    expect(cellRenderList(canonical, 30, null, null, record, [1, 2])).toBe(first);
    expect(cellRenderList(canonical, 30, 5, null, record, [1, 2])).toBe(variant);
  });
});

describe('sameCellRenderTopology', () => {
  it('ignores payload-only changes but detects structural display changes', () => {
    const previous = cellRenderMap([cell(1), cell(2)]);

    expect(sameCellRenderTopology(previous, [
      { ...cell(1), tag: 'dex' },
      cell(2),
    ])).toBe(true);
    expect(sameCellRenderTopology(previous, [cell(2), cell(1)])).toBe(false);
    expect(sameCellRenderTopology(previous, [
      { ...cell(1), death_at_ms: 5000 },
      cell(2),
    ])).toBe(false);
    expect(sameCellRenderTopology(previous, [
      { ...cell(1), pos_seed: [99, 0, 0] },
      cell(2),
    ])).toBe(false);
  });
});

describe('syncCellRenderSet', () => {
  function cacheWithCells(ids: readonly number[]) {
    let cache = emptyCellsCache();
    for (const id of ids) {
      cache = applyCellDelta(cache, { type: 'birth', cell: cell(id) });
    }
    return cache;
  }

  it('ignores hidden births without iterating or replacing the visible prefix', () => {
    const state = createCellRenderSetState();
    const before = cacheWithCells([0, 1, 2, 3, 4]);
    const initial = syncCellRenderSet(state, before, 3, null, null);
    const visible = initial.cells;
    const topologyVersion = initial.topologyVersion;
    const after = applyCellDelta(before, {
      type: 'birth',
      cell: cell(5),
    });
    let visited = 0;
    const values = after.cells.values.bind(after.cells);
    after.cells.values = function* instrumentedValues() {
      for (const value of values()) {
        visited += 1;
        yield value;
      }
    } as typeof after.cells.values;

    const update = syncCellRenderSet(state, after, 3, null, null);

    expect(update.mode).toBe('incremental');
    expect(update.cells).toBe(visible);
    expect(update.ranges).toEqual([]);
    expect(update.membershipChanged).toBe(false);
    expect(update.topologyVersion).toBe(topologyVersion);
    expect(visited).toBe(0);
  });

  it('patches only visible metadata/lifecycle slots and versions topology precisely', () => {
    const state = createCellRenderSetState();
    const start = cacheWithCells([0, 1, 2, 3]);
    const initial = syncCellRenderSet(state, start, 3, null, null);

    const tagged = applyCellDelta(start, { type: 'tag', id: 1, tag: 'dex' });
    const tagUpdate = syncCellRenderSet(state, tagged, 3, null, null);
    expect(tagUpdate.mode).toBe('incremental');
    expect(tagUpdate.ranges).toEqual([{ start: 1, count: 1 }]);
    expect(tagUpdate.cells[0]).toBe(initial.cells[0]);
    expect(tagUpdate.cells[1]).toBe(tagged.cells.get(1));
    expect(tagUpdate.topologyChanged).toBe(false);
    expect(tagUpdate.topologyVersion).toBe(initial.topologyVersion);

    const dead = applyCellDelta(tagged, { type: 'death', id: 1, at_ms: 5000 });
    const deathUpdate = syncCellRenderSet(state, dead, 3, null, null);
    expect(deathUpdate.ranges).toEqual([{ start: 1, count: 1 }]);
    expect(deathUpdate.topologyChanged).toBe(true);
    expect(deathUpdate.topologyVersion).toBe(initial.topologyVersion + 1);
  });

  it('appends births incrementally while the display budget has room', () => {
    const state = createCellRenderSetState();
    const before = cacheWithCells([0, 1]);
    syncCellRenderSet(state, before, 4, null, null);
    const after = applyCellDelta(before, {
      type: 'birth',
      cell: cell(2),
    });

    const update = syncCellRenderSet(state, after, 4, null, null);

    expect(update.mode).toBe('incremental');
    expect(update.cells.map(({ id }) => id)).toEqual([0, 1, 2]);
    expect(update.ranges).toEqual([{ start: 2, count: 1 }]);
    expect(update.membershipChanged).toBe(true);
    expect(update.topologyChanged).toBe(true);
  });

  it('rebuilds canonically after GC invalidates insertion order', () => {
    const state = createCellRenderSetState();
    const before = cacheWithCells([0, 1, 2, 3, 4]);
    syncCellRenderSet(state, before, 3, null, null);
    const after = applyCellDelta(before, { type: 'gc', ids: [0] });
    let visited = 0;
    const values = after.cells.values.bind(after.cells);
    after.cells.values = function* instrumentedValues() {
      for (const value of values()) {
        visited += 1;
        yield value;
      }
    } as typeof after.cells.values;

    const update = syncCellRenderSet(state, after, 3, null, null);

    expect(after.cellChanges.orderInvalidated).toBe(true);
    expect(update.mode).toBe('rebuild');
    expect(update.cells.map(({ id }) => id)).toEqual([1, 2, 3]);
    expect(update.ranges).toEqual([{ start: 0, count: 3 }]);
    expect(visited).toBe(3);
  });

  it('rebuilds when React skips a journal or a selected birth needs pinning', () => {
    const state = createCellRenderSetState();
    const start = cacheWithCells([0, 1, 2, 3]);
    syncCellRenderSet(state, start, 3, 9, null);
    const skipped = applyCellDelta(start, {
      type: 'birth',
      cell: cell(4),
    });
    const latest = applyCellDelta(skipped, { type: 'tag', id: 1, tag: 'dex' });

    const recovered = syncCellRenderSet(state, latest, 3, 9, null);
    expect(recovered.mode).toBe('rebuild');
    expect(recovered.cells.map(({ id }) => id)).toEqual([0, 1, 2]);

    const selected = applyCellDelta(latest, {
      type: 'birth',
      cell: cell(9),
    });
    const pinned = syncCellRenderSet(state, selected, 3, 9, null);
    expect(pinned.mode).toBe('rebuild');
    expect(pinned.cells.map(({ id }) => id)).toEqual([0, 1, 9]);
  });
});

describe('full-coverage journal fast path (composition present)', () => {
  function cacheOf(ids: readonly number[]) {
    let cache = emptyCellsCache();
    for (const id of ids) {
      cache = applyCellDelta(cache, { type: 'birth', cell: cell(id) });
    }
    return cache;
  }

  it('applies per-block churn incrementally when the budget covers everyone', () => {
    const state = createCellRenderSetState();
    let cache = cacheOf([1, 2, 3, 4, 5]);
    const record = composition([cell(1)], [cell(2)], [cell(3)]);
    const first = syncCellRenderSet(state, cache, 50, null, null, record, [1]);
    expect(first.mode).toBe('rebuild');

    // One block batch: a birth, a value replacement, a front GC removal,
    // and a CHANGED activity set — previously any of these forced a full
    // rebuild.
    cache = applyRevisionedCellDeltas(cache, [
      { revision: 2, delta: { type: 'birth', cell: cell(9) } },
      { revision: 3, delta: { type: 'tag', id: 2, tag: 'dex' } },
      { revision: 4, delta: { type: 'gc', ids: [1] } },
    ]);
    const second = syncCellRenderSet(state, cache, 50, null, null, record, [9]);
    expect(second.mode).toBe('incremental');
    expect(second.membershipChanged).toBe(true);
    const ids = second.cells.map((c) => c.id).sort((a, b) => a - b);
    expect(ids).toEqual([2, 3, 4, 5, 9]);
    expect(second.cells.find((c) => c.id === 2)?.tag).toBe('dex');
    // The index stays exact after the swap-removal.
    for (const [index, c] of second.cells.entries()) {
      expect(state.indexById.get(c.id)).toBe(index);
    }
  });

  it('keeps the composed rebuild for partial coverage', () => {
    const state = createCellRenderSetState();
    let cache = cacheOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const record = composition([cell(1)], [cell(2)], [cell(3)]);
    const first = syncCellRenderSet(state, cache, 10, null, null, record, []);
    expect(first.mode).toBe('rebuild');
    cache = applyCellDelta(cache, { type: 'gc', ids: [4] });
    // Below full coverage a deletion still invalidates the ordered prefix.
    const second = syncCellRenderSet(state, cache, 10, null, null, record, []);
    expect(second.mode).toBe('rebuild');
  });

  it('falls back to one canonical rebuild when the journal cannot explain the prefix', () => {
    const state = createCellRenderSetState();
    let cache = cacheOf([1, 2, 3]);
    const record = composition([], [], []);
    syncCellRenderSet(state, cache, 50, null, null, record, []);
    // Skip a generation: the second transition's journal no longer chains.
    cache = applyCellDelta(cache, { type: 'birth', cell: cell(7) });
    cache = applyCellDelta(cache, { type: 'birth', cell: cell(8) });
    const out = syncCellRenderSet(state, cache, 50, null, null, record, []);
    expect(out.mode).toBe('rebuild');
    expect(out.cells.map((c) => c.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 7, 8]);
  });
});
