// The population field after it stopped walking the stage.
//
// `deriveCellPopulationField` used to walk all 12,000 staged members (two
// Map lookups each) and allocate a 12,000-entry Set for the render prefix on
// every Cell-bearing batch. It now reads the reducer's `stagePopulation`
// tally and walks a prefix only under the manual clamp or without a display
// plane. Two things are pinned here:
//
//   1. Equivalence. The pre-change implementation is kept below, verbatim, as
//      the oracle, and a randomized reducer-driven soak — births, deaths,
//      tags, GC, stage enters/exits/re-ships, bare ids, provenance changes,
//      snapshot resyncs with and without a display plane, clamp changes,
//      overlay changes — asserts the two produce identical models after every
//      batch.
//   2. The gate. Under a display plane and no clamp, the derive must not
//      iterate the membership or either Cell map at all: a cache whose
//      collections throw on iteration derives fine. The two regimes that DO
//      walk are named and pinned as such.

import { describe, expect, it } from 'vitest';
import type {
  Cell,
  CellGalaxySnapshot,
  ChainCensus,
  RevisionedCellDelta,
  ShapeSeed,
} from '@cknerv/types';
import {
  applyRevisionedCellDeltas,
  emptyCellsCache,
  fromCellsSnapshot,
  type CellGalaxyCache,
  type CellStatsScope,
} from '@cknerv/cache';

import {
  deriveCellPopulationField,
  type CellPopulationFieldModel,
} from '../../src/derives/cellPopulationField.derive';

// ── the pre-change derive, verbatim (the oracle) ─────────────────────────

type LegacyPopulationCache = Pick<
  CellGalaxyCache,
  | 'cells'
  | 'displayMembers'
  | 'displayResidents'
  | 'displayBudget'
  | 'displayProvenance'
  | 'stats'
  | 'statsScope'
>;

const LEGACY_GAIN_REFERENCE_RATIO = 4000;
const LEGACY_GAIN_MIN = 0.08;
const LEGACY_CENSUS_STALE_BLOCKS = 24;
const LEGACY_EMPTY_OVERLAY_IDS: readonly number[] = [];

function legacyNormalizeDisplayLimit(limit: number): number {
  if (Number.isFinite(limit)) return Math.max(0, Math.floor(limit));
  return limit === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : 0;
}

function legacyGain(
  ratio: number,
  referenceRatio = LEGACY_GAIN_REFERENCE_RATIO,
  minimum = LEGACY_GAIN_MIN,
): number {
  if (!Number.isFinite(ratio) || ratio <= 1) return 0;
  const raw = Math.log1p(ratio - 1) / Math.log1p(referenceRatio - 1);
  return Math.max(minimum, Math.min(1, raw));
}

function legacyCensusIsUsable(census: ChainCensus | null): boolean {
  return (
    census !== null
    && Number.isFinite(census.live_cells)
    && Number.isInteger(census.live_cells)
    && census.live_cells >= 0
    && census.live_cells <= Number.MAX_SAFE_INTEGER
  );
}

interface LegacyClassTally {
  dao: number;
  typedNonDao: number;
  plain: number;
}

function legacyTallyClass(tally: LegacyClassTally, cell: {
  asset_kind?: string;
  type_shape_seed: unknown;
}): void {
  if (cell.asset_kind === 'dao') {
    tally.dao += 1;
    return;
  }
  if (cell.type_shape_seed !== null) {
    tally.typedNonDao += 1;
    return;
  }
  tally.plain += 1;
}

interface LegacyInput {
  cache: LegacyPopulationCache;
  displayLimit: number;
  census?: ChainCensus | null;
  chainTip?: number;
  overlayCellIds?: readonly number[];
}

function legacyDeriveCellPopulationField(input: LegacyInput): CellPopulationFieldModel {
  const { cache, displayLimit } = input;
  const census = input.census ?? null;
  const chainTip = input.chainTip ?? 0;
  const overlayCellIds = input.overlayCellIds ?? LEGACY_EMPTY_OVERLAY_IDS;

  const limit = legacyNormalizeDisplayLimit(displayLimit);
  const displayPlaneActive = cache.displayBudget !== null;

  let stagedRetainedLive = 0;
  let stagedResidentLive = 0;
  let renderedRetainedLive = 0;
  let renderedResidentLive = 0;
  const stagedClasses: LegacyClassTally = { dao: 0, typedNonDao: 0, plain: 0 };
  const renderedIds = new Set<number>();

  if (displayPlaneActive) {
    const renderCount = Math.min(cache.displayMembers.size, limit);
    let resolved = 0;
    for (const id of cache.displayMembers) {
      const canonical = cache.cells.get(id);
      const cell = canonical ?? cache.displayResidents.get(id);
      if (!cell) continue;
      const alive = cell.death_at_ms === null;
      const inRenderSet = resolved < renderCount;
      resolved += 1;
      if (alive) {
        if (canonical) stagedRetainedLive += 1;
        else stagedResidentLive += 1;
        legacyTallyClass(stagedClasses, cell);
      }
      if (inRenderSet) {
        renderedIds.add(id);
        if (alive) {
          if (canonical) renderedRetainedLive += 1;
          else renderedResidentLive += 1;
        }
      }
    }
  } else {
    let drawn = 0;
    for (const cell of cache.cells.values()) {
      if (drawn >= limit) break;
      drawn += 1;
      renderedIds.add(cell.id);
      if (cell.death_at_ms === null) renderedRetainedLive += 1;
    }
  }

  for (const id of overlayCellIds) {
    if (renderedIds.has(id)) continue;
    const canonical = cache.cells.get(id);
    const cell = canonical ?? cache.displayResidents.get(id);
    if (!cell) continue;
    renderedIds.add(id);
    if (cell.death_at_ms !== null) continue;
    if (canonical) renderedRetainedLive += 1;
    else renderedResidentLive += 1;
  }

  const stagedLive = stagedRetainedLive + stagedResidentLive;
  const renderedLive = renderedRetainedLive + renderedResidentLive;
  const retainedLive = cache.stats.inView;
  const usableCensus = legacyCensusIsUsable(census) ? census : null;
  const scope = usableCensus ? 'chain' : 'retained';
  const population = usableCensus ? usableCensus.live_cells : retainedLive;
  const ratio = population / Math.max(stagedLive, 1);
  const gain = legacyGain(ratio);
  const censusAgeBlocks = usableCensus
    ? Math.max(0, chainTip - usableCensus.as_of.block)
    : null;

  return {
    renderedLive,
    renderedRetainedLive,
    renderedResidentLive,
    stagedLive,
    stagedRetainedLive,
    stagedResidentLive,
    stagedClasses: {
      dao: stagedClasses.dao,
      typedNonDao: stagedClasses.typedNonDao,
      plain: stagedClasses.plain,
    },
    stagedCurated: cache.displayProvenance?.mode === 'composed',
    stageComposedAtMs: cache.displayProvenance?.updated_at_ms ?? null,
    clamped: displayPlaneActive && limit < cache.displayMembers.size,
    stageBudget: cache.displayBudget?.cells ?? null,
    retainedLive,
    retainedScope: cache.statsScope,
    observedLive: cache.stats.live,
    chainCensus: usableCensus,
    censusAgeBlocks,
    censusStale: censusAgeBlocks !== null && censusAgeBlocks > LEGACY_CENSUS_STALE_BLOCKS,
    scope,
    ratio,
    gain,
  };
}

// ── fixtures ─────────────────────────────────────────────────────────────

const TYPE_SEED: ShapeSeed = [0x1234_5678, 0x9abc_def0];

function cell(id: number, overrides: Partial<Cell> = {}): Cell {
  return {
    id,
    born_at_ms: 1_000 + id,
    death_at_ms: null,
    birth_block: 12_345,
    tag: null,
    pos_seed: [id, 0, 0],
    out_point: { tx_hash: `0x${id.toString(16).padStart(64, '0')}`, index: 0 },
    capacity: 61_00000000,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: `0x${'cd'.repeat(32)}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
    lock_kind: 'sighash',
    asset_kind: 'native',
    ...overrides,
  };
}

const CLASSES: readonly Partial<Cell>[] = [
  {},
  { asset_kind: 'dao', type_shape_seed: TYPE_SEED },
  { asset_kind: 'xudt', type_shape_seed: TYPE_SEED },
];

function census(overrides: Partial<ChainCensus> = {}): ChainCensus {
  return {
    source: 'ckbadger',
    as_of: { block: 20_181_778, hash: `0x${'c6'.repeat(32)}` },
    updated_at_ms: 1,
    live_cells: 1_471_373,
    classes: { dao: 22_676, typed_non_dao: 475_891, plain: 972_806 },
    data_bearing: 266_346,
    ...overrides,
  };
}

function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

/** Snapshot with a random stage (or none), for the resync steps. */
function randomSnapshot(
  random: () => number,
  universe: number,
  withDisplay: boolean,
): CellGalaxySnapshot {
  const record = (id: number): Cell => cell(id, {
    ...pick(random, CLASSES),
    death_at_ms: random() < 0.15 ? 400 : null,
  });
  const canonical: Cell[] = [];
  const residents: Cell[] = [];
  const members: number[] = [];
  for (let id = 1; id <= universe; id += 1) {
    const roll = random();
    if (roll < 0.35) {
      canonical.push(record(id));
      if (random() < 0.7) members.push(id);
    } else if (roll < 0.7) {
      residents.push(record(id));
      members.push(id);
      // Post-reorg overlap: both homes hold the id.
      if (random() < 0.2) canonical.push(record(id));
    } else if (roll < 0.75) {
      // A member with no record anywhere.
      members.push(id);
    }
  }
  return {
    cells: canonical,
    last_pulse_at_ms: 0,
    total_births: 200 + Math.floor(random() * 100),
    total_deaths: Math.floor(random() * 100),
    ...(random() < 0.5
      ? {
        stats: {
          by_kind: { wallet: 0, dex: 0, cf: 0, ckbloom: 0, generic: 0 },
          capacity_shannons: 0,
          in_view: Math.floor(random() * 50_000),
          data_bearing: 0,
          by_lock: { sighash: 0, multisig: 0, acp: 0, omnilock: 0, other: 0 },
          by_asset: {
            native: 0, sudt: 0, xudt: 0, dao: 0, spore: 0, other: 0, object: 0, identity: 0,
          },
        },
      }
      : {}),
    ...(withDisplay
      ? {
        display: {
          budget: { cells: 12_000, nerve_edges: 8_000 },
          members,
          residents,
          provenance: {
            mode: random() < 0.5 ? 'composed' : 'canonical',
            source: 'ckbadger',
            as_of: null,
            updated_at_ms: Math.floor(random() * 1_000),
          },
        },
      }
      : {}),
  };
}

function randomBatch(
  random: () => number,
  universe: number,
  startRevision: number,
): RevisionedCellDelta[] {
  const deltas: RevisionedCellDelta[] = [];
  const count = 1 + Math.floor(random() * 6);
  let revision = startRevision;
  for (let i = 0; i < count; i += 1) {
    const id = 1 + Math.floor(random() * universe);
    const record = cell(id, {
      ...pick(random, CLASSES),
      capacity: 100 + Math.floor(random() * 1_000),
      death_at_ms: random() < 0.1 ? 500 + revision : null,
    });
    const roll = random();
    revision += 1;
    if (roll < 0.22) {
      deltas.push({ revision, delta: { type: 'birth', cell: record } });
    } else if (roll < 0.44) {
      deltas.push({
        revision,
        delta: { type: 'display', enter_ids: [], enter_cells: [record], exit_ids: [] },
      });
    } else if (roll < 0.58) {
      deltas.push({
        revision,
        delta: { type: 'display', enter_ids: [], enter_cells: [], exit_ids: [id] },
      });
    } else if (roll < 0.68) {
      deltas.push({ revision, delta: { type: 'death', id, at_ms: 1_000 + revision } });
    } else if (roll < 0.76) {
      deltas.push({ revision, delta: { type: 'gc', ids: [id] } });
    } else if (roll < 0.82) {
      deltas.push({ revision, delta: { type: 'tag', id, tag: 'wallet' } });
    } else if (roll < 0.86) {
      deltas.push({
        revision,
        delta: { type: 'display', enter_ids: [id], enter_cells: [], exit_ids: [] },
      });
    } else if (roll < 0.9) {
      deltas.push({
        revision,
        delta: {
          type: 'display',
          enter_ids: [],
          enter_cells: [],
          exit_ids: [],
          provenance: {
            mode: random() < 0.5 ? 'composed' : 'canonical',
            source: 'ckbadger',
            as_of: null,
            updated_at_ms: Math.floor(random() * 1_000),
          },
        },
      });
    } else if (roll < 0.95) {
      deltas.push({ revision, delta: { type: 'pulse', at_ms: revision } });
    } else {
      deltas.push({
        revision,
        delta: {
          type: 'stats',
          total_births: 300 + revision,
          total_deaths: Math.floor(revision / 3),
        },
      });
    }
  }
  return deltas;
}

/** Overlay lists the inspection field can produce: empty, a member, an
 *  off-stage retained record, an unknown id, duplicates, a corpse. */
function randomOverlay(random: () => number, universe: number): number[] {
  const count = Math.floor(random() * 4);
  const ids: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const roll = random();
    if (roll < 0.1) ids.push(9_999);
    else if (roll < 0.3 && ids.length > 0) ids.push(ids[0]);
    else ids.push(1 + Math.floor(random() * universe));
  }
  return ids;
}

function randomLimit(random: () => number, stageSize: number): number {
  return pick(random, [
    Number.POSITIVE_INFINITY,
    12_000,
    stageSize,
    Math.max(0, stageSize - 1),
    Math.floor(stageSize / 2),
    3,
    0,
    Number.NaN,
  ]);
}

// ── equivalence ──────────────────────────────────────────────────────────

describe('deriveCellPopulationField — equivalence with the walking derive', () => {
  it('matches the pre-change implementation after every reducer batch', () => {
    const random = makeRandom(0x5eed_2026);
    const UNIVERSE = 40;
    let cache = emptyCellsCache();
    let revision = 0;
    let clampedSteps = 0;
    let fallbackSteps = 0;
    let overlaySteps = 0;

    for (let step = 0; step < 900; step += 1) {
      if (step % 60 === 0) {
        // Resync: a snapshot replacing live state, with or without a display
        // plane, reusing content-identical records from the previous cache
        // (the identity path the real reconnect takes).
        revision += 1;
        cache = fromCellsSnapshot(
          revision,
          randomSnapshot(random, UNIVERSE, random() < 0.8),
          {},
          cache,
        );
      } else {
        const batch = randomBatch(random, UNIVERSE, revision);
        revision = batch[batch.length - 1].revision;
        cache = applyRevisionedCellDeltas(cache, batch);
      }

      const displayLimit = randomLimit(random, cache.displayMembers.size);
      const overlayCellIds = randomOverlay(random, UNIVERSE);
      const usedCensus = random() < 0.6
        ? census({ live_cells: random() < 0.1 ? -1 : Math.floor(random() * 2_000_000) })
        : null;
      const chainTip = 20_181_778 + Math.floor(random() * 60) - 10;
      const input = { cache, displayLimit, census: usedCensus, chainTip, overlayCellIds };

      const expected = legacyDeriveCellPopulationField(input);
      const actual = deriveCellPopulationField(input);
      expect(actual).toStrictEqual(expected);

      if (expected.clamped) clampedSteps += 1;
      if (cache.displayBudget === null) fallbackSteps += 1;
      if (overlayCellIds.length > 0) overlaySteps += 1;
    }
    // The soak really covered the regimes the derive distinguishes.
    expect(clampedSteps).toBeGreaterThan(100);
    expect(fallbackSteps).toBeGreaterThan(30);
    expect(overlaySteps).toBeGreaterThan(300);
  });
});

// ── the gate: no walk under a display plane without a clamp ──────────────

class UnwalkableSet<T> extends Set<T> {
  override [Symbol.iterator](): never {
    throw new Error('walked displayMembers');
  }
  override values(): never {
    throw new Error('walked displayMembers');
  }
  override keys(): never {
    throw new Error('walked displayMembers');
  }
  override entries(): never {
    throw new Error('walked displayMembers');
  }
  override forEach(): never {
    throw new Error('walked displayMembers');
  }
}

class UnwalkableMap<K, V> extends Map<K, V> {
  override [Symbol.iterator](): never {
    throw new Error('walked a Cell map');
  }
  override values(): never {
    throw new Error('walked a Cell map');
  }
  override keys(): never {
    throw new Error('walked a Cell map');
  }
  override entries(): never {
    throw new Error('walked a Cell map');
  }
  override forEach(): never {
    throw new Error('walked a Cell map');
  }
}

/** The same cache, with every collection refusing to be iterated. Lookups
 *  (`has`, `get`, `size`) still work — those are what an O(overlay) derive
 *  is allowed to spend. */
function unwalkable(cache: CellGalaxyCache): CellGalaxyCache {
  return {
    ...cache,
    cells: new UnwalkableMap(cache.cells),
    displayMembers: new UnwalkableSet(cache.displayMembers),
    displayResidents: new UnwalkableMap(cache.displayResidents),
  };
}

function stagedCache(
  members: number,
  statsScope: CellStatsScope = 'full_retained',
): CellGalaxyCache {
  const random = makeRandom(members);
  const canonical: Cell[] = [];
  const residents: Cell[] = [];
  const ids: number[] = [];
  for (let id = 1; id <= members; id += 1) {
    const record = cell(id, pick(random, CLASSES));
    if (id % 4 === 0) canonical.push(record);
    else residents.push(record);
    ids.push(id);
  }
  // Off-stage retained records for the overlay to find.
  canonical.push(cell(members + 1), cell(members + 2, { death_at_ms: 9 }));
  const snapshot: CellGalaxySnapshot = {
    cells: canonical,
    last_pulse_at_ms: 0,
    total_births: 1_000,
    total_deaths: 100,
    display: {
      budget: { cells: 12_000, nerve_edges: 8_000 },
      members: ids,
      residents,
      provenance: { mode: 'composed', source: 'ckbadger', as_of: null, updated_at_ms: 1 },
    },
  };
  const hydrated = fromCellsSnapshot(1, snapshot);
  return statsScope === hydrated.statsScope ? hydrated : { ...hydrated, statsScope };
}

describe('deriveCellPopulationField — what it walks', () => {
  it('walks nothing under a display plane without a clamp', () => {
    const plain = stagedCache(200);
    const overlayCellIds = [201, 201, 202, 7, 9_999];
    const input = { displayLimit: 12_000, census: census(), chainTip: 20_181_790, overlayCellIds };

    const expected = deriveCellPopulationField({ cache: plain, ...input });
    // The whole derive — staged counts, rendered counts, overlay dedup —
    // completes against collections that throw on iteration.
    expect(() => deriveCellPopulationField({ cache: unwalkable(plain), ...input }))
      .not.toThrow();
    expect(deriveCellPopulationField({ cache: unwalkable(plain), ...input }))
      .toStrictEqual(expected);
    // …and the numbers are the real ones, not a degenerate zero.
    expect(expected.stagedLive).toBe(200);
    expect(expected.renderedLive).toBe(201);
    // Every resolved member counts for the unclamped limit exactly.
    expect(deriveCellPopulationField({
      cache: unwalkable(plain), ...input, displayLimit: 200,
    })).toStrictEqual(expected);
    expect(deriveCellPopulationField({
      cache: unwalkable(plain), ...input, displayLimit: Number.POSITIVE_INFINITY,
    })).toStrictEqual(expected);
  });

  it('walks a prefix only under the manual clamp', () => {
    // The clamp is the manual knob's regime; the render set itself rebuilds
    // its whole list there, so the derive walking the drawn prefix is in
    // keeping — and it is the ONLY display-plane regime that walks.
    const plain = stagedCache(200);
    expect(() => deriveCellPopulationField({
      cache: unwalkable(plain), displayLimit: 199,
    })).toThrow('walked displayMembers');
    // A zero clamp draws nothing and therefore walks nothing.
    expect(() => deriveCellPopulationField({
      cache: unwalkable(plain), displayLimit: 0,
    })).not.toThrow();
  });

  it('walks the canonical prefix without a display plane (compatibility fallback)', () => {
    const plain = stagedCache(50);
    const fallback = { ...plain, displayBudget: null };
    expect(() => deriveCellPopulationField({
      cache: unwalkable(fallback), displayLimit: 12_000,
    })).toThrow('walked a Cell map');
  });

  it('reads the staged counts from the reducer tally, not from the maps', () => {
    // A tally that disagrees with the maps is impossible through the reducer;
    // planting one proves which source the derive believes.
    const plain = stagedCache(20);
    const planted = {
      ...plain,
      stagePopulation: { retainedLive: 3, residentLive: 4, dao: 1, typedNonDao: 2, plain: 4 },
    };
    const model = deriveCellPopulationField({ cache: planted, displayLimit: 12_000 });
    expect(model.stagedRetainedLive).toBe(3);
    expect(model.stagedResidentLive).toBe(4);
    expect(model.stagedLive).toBe(7);
    expect(model.renderedLive).toBe(7);
    expect(model.stagedClasses).toEqual({ dao: 1, typedNonDao: 2, plain: 4 });
  });
});
