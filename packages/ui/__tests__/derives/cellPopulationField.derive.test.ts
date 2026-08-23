import { describe, expect, it } from 'vitest';
import type { Cell, ChainCensus, ShapeSeed } from '@cknerv/types';

import {
  CENSUS_STALE_BLOCKS,
  cellPopulationGain,
  chainCensusIsUsable,
  deriveCellPopulationField,
  POPULATION_GAIN_MIN,
  POPULATION_GAIN_REFERENCE_RATIO,
  type CellPopulationCache,
} from '../../src/derives/cellPopulationField.derive';

const TYPE_SEED: ShapeSeed = [0x1234_5678, 0x9abc_def0];
const LOCK_SEED: ShapeSeed = [0x3141_5926, 0x5358_9793];
const DATA_SEED: ShapeSeed = [0x2384_6264, 0x3383_2795];

function cell(id: number, overrides: Partial<Cell> = {}): Cell {
  return {
    id,
    born_at_ms: 1_000,
    death_at_ms: null,
    birth_block: 12_345,
    tag: null,
    pos_seed: [0, 0, 0],
    out_point: { tx_hash: `0x${id.toString(16).padStart(64, '0')}`, index: 0 },
    capacity: 61_00000000,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: `0x${'cd'.repeat(32)}`,
    lock_shape_seed: LOCK_SEED,
    type_shape_seed: TYPE_SEED,
    data_shape_seed: DATA_SEED,
    lock_kind: 'sighash',
    asset_kind: 'xudt',
    ...overrides,
  };
}

const PLAIN = { type_shape_seed: null, asset_kind: 'native' } as const;
const DAO = { asset_kind: 'dao' } as const;

interface CacheOptions {
  retained?: Cell[];
  residents?: Cell[];
  /** Membership order. Defaults to retained then residents. */
  members?: number[];
  displayBudget?: { cells: number; nerveEdges: number } | null;
  mode?: 'canonical' | 'composed';
  inView?: number;
  observedLive?: number;
  statsScope?: 'full_retained' | 'received_rows';
}

function cache(options: CacheOptions = {}): CellPopulationCache {
  const retained = options.retained ?? [];
  const residents = options.residents ?? [];
  const members = options.members
    ?? [...retained.map((c) => c.id), ...residents.map((c) => c.id)];
  return {
    cells: new Map(retained.map((c) => [c.id, c])),
    displayMembers: new Set(members),
    displayResidents: new Map(residents.map((c) => [c.id, c])),
    displayBudget: options.displayBudget === undefined
      ? { cells: 12_000, nerveEdges: 8_000 }
      : options.displayBudget,
    displayProvenance: {
      mode: options.mode ?? 'composed',
      source: 'ckbadger',
      as_of: null,
      updated_at_ms: 1,
    },
    stats: {
      born: 0,
      live: options.observedLive ?? 0,
      dead: 0,
      byKind: { wallet: 0, dex: 0, cf: 0, ckbloom: 0, generic: 0 },
      capacityShannons: 0,
      inView: options.inView ?? retained.length,
      dataBearing: 0,
      byLock: { sighash: 0, multisig: 0, acp: 0, omnilock: 0, other: 0 },
      byAsset: { native: 0, sudt: 0, xudt: 0, dao: 0, spore: 0, other: 0, object: 0, identity: 0 },
      scripts: {
        locks: [],
        locks_tail_cells: 0,
        locks_tail_scripts: 0,
        types: [],
        types_tail_cells: 0,
        types_tail_scripts: 0,
        types_absent: 0,
        unidentified: 0,
      },
    },
    statsScope: options.statsScope ?? 'full_retained',
  };
}

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

describe('cellPopulationGain', () => {
  it('renders no medium when the stage covers its scope', () => {
    expect(cellPopulationGain(1)).toBe(0);
    expect(cellPopulationGain(0.5)).toBe(0);
    expect(cellPopulationGain(0)).toBe(0);
    expect(cellPopulationGain(Number.NaN)).toBe(0);
  });

  it('is monotone in the ratio', () => {
    let previous = -1;
    for (const ratio of [1.01, 2, 4.2, 20, 122.6, 500, 1574, 4000]) {
      const gain = cellPopulationGain(ratio);
      expect(gain).toBeGreaterThanOrEqual(previous);
      previous = gain;
    }
  });

  it('matches the calibration the amount curve was tuned against', () => {
    // Measured live 2026-08-17: mainnet 1,471,373 live / 12,000 staged, and
    // a retained window of 50,001. Testnet is 18.9M, which is why the
    // reference is 4,000 rather than 1,000 — at 1,000 testnet pins at 1.0 and
    // the two profiles become indistinguishable.
    expect(cellPopulationGain(50_001 / 12_000)).toBeCloseTo(0.17, 2);
    expect(cellPopulationGain(1_471_373 / 12_000)).toBeCloseTo(0.58, 2);
    expect(cellPopulationGain(18_890_285 / 12_000)).toBeCloseTo(0.89, 2);
  });

  it('separates the two profiles instead of saturating either', () => {
    const mainnet = cellPopulationGain(122.6);
    const testnet = cellPopulationGain(1574);
    expect(testnet - mainnet).toBeGreaterThan(0.25);
    expect(testnet).toBeLessThan(1);
    // The failure this reference value exists to prevent.
    expect(cellPopulationGain(1574, 1000)).toBe(1);
  });

  it('floors a barely-hidden population instead of erasing it', () => {
    // A response continuous through R = 1 would state "nothing is hidden"
    // while something is.
    expect(cellPopulationGain(1.0001)).toBe(POPULATION_GAIN_MIN);
    expect(cellPopulationGain(1)).toBe(0);
  });

  it('never clamps at the top on a profile we actually run', () => {
    expect(cellPopulationGain(POPULATION_GAIN_REFERENCE_RATIO - 1))
      .toBeLessThan(1);
  });
});

describe('chainCensusIsUsable', () => {
  it('refuses anything it could not render honestly', () => {
    expect(chainCensusIsUsable(null)).toBe(false);
    expect(chainCensusIsUsable(census())).toBe(true);
    expect(chainCensusIsUsable(census({ live_cells: -1 }))).toBe(false);
    expect(chainCensusIsUsable(census({ live_cells: 1.5 }))).toBe(false);
    expect(chainCensusIsUsable(census({ live_cells: Number.NaN }))).toBe(false);
    expect(
      chainCensusIsUsable(census({ live_cells: Number.MAX_SAFE_INTEGER + 2 })),
    ).toBe(false);
  });

  it('accepts an exact zero, which is a real chain state', () => {
    // Withholding is how a source declines to answer; a delivered zero is an
    // answer, and a devnet before its first transaction really has none.
    expect(chainCensusIsUsable(census({ live_cells: 0 }))).toBe(true);
  });
});

describe('deriveCellPopulationField', () => {
  it('produces no field when the stage covers its scope', () => {
    const retained = [cell(1), cell(2), cell(3)];
    const model = deriveCellPopulationField({
      cache: cache({ retained, inView: 3 }),
      displayLimit: 12_000,
    });

    expect(model.scope).toBe('retained');
    expect(model.ratio).toBe(1);
    expect(model.gain).toBe(0);
  });

  it('under-claims to the retained window without a census', () => {
    const retained = [cell(1), cell(2)];
    const model = deriveCellPopulationField({
      cache: cache({ retained, inView: 50_001 }),
      displayLimit: 12_000,
    });

    expect(model.scope).toBe('retained');
    expect(model.chainCensus).toBeNull();
    expect(model.retainedLive).toBe(50_001);
    expect(model.ratio).toBeCloseTo(50_001 / 2, 6);
  });

  it('widens the same field to chain scope on a validated census', () => {
    const retained = [cell(1), cell(2)];
    const model = deriveCellPopulationField({
      cache: cache({ retained, inView: 50_001 }),
      displayLimit: 12_000,
      census: census(),
      chainTip: 20_181_778,
    });

    expect(model.scope).toBe('chain');
    expect(model.ratio).toBeCloseTo(1_471_373 / 2, 6);
    expect(model.censusAgeBlocks).toBe(0);
    expect(model.censusStale).toBe(false);
  });

  it('falls back to retained scope when the census is withdrawn', () => {
    const base = { cache: cache({ retained: [cell(1)], inView: 500 }), displayLimit: 12_000 };
    const withCensus = deriveCellPopulationField({ ...base, census: census() });
    const withoutCensus = deriveCellPopulationField({ ...base, census: null });

    expect(withCensus.scope).toBe('chain');
    expect(withoutCensus.scope).toBe('retained');
    // The field persists at a lower gain rather than disappearing.
    expect(withoutCensus.gain).toBeGreaterThan(0);
    expect(withoutCensus.gain).toBeLessThan(withCensus.gain);
  });

  it('keeps a stale census, labeled, rather than dropping its count', () => {
    const fresh = deriveCellPopulationField({
      cache: cache({ retained: [cell(1)] }),
      displayLimit: 12_000,
      census: census(),
      chainTip: 20_181_778 + CENSUS_STALE_BLOCKS,
    });
    const stale = deriveCellPopulationField({
      cache: cache({ retained: [cell(1)] }),
      displayLimit: 12_000,
      census: census(),
      chainTip: 20_181_778 + CENSUS_STALE_BLOCKS + 1,
    });

    expect(fresh.censusStale).toBe(false);
    expect(stale.censusStale).toBe(true);
    // The count was exact where it says it was; scope does not fall back.
    expect(stale.scope).toBe('chain');
    expect(stale.chainCensus?.live_cells).toBe(1_471_373);
  });

  it('never reports a negative census age', () => {
    const model = deriveCellPopulationField({
      cache: cache({ retained: [cell(1)] }),
      displayLimit: 12_000,
      census: census(),
      chainTip: 20_181_000,
    });

    expect(model.censusAgeBlocks).toBe(0);
  });

  it('keeps residents out of the retained denominator', () => {
    const retained = [cell(1), cell(2)];
    const residents = [cell(90), cell(91), cell(92)];
    const model = deriveCellPopulationField({
      cache: cache({ retained, residents, inView: 50_001 }),
      displayLimit: 12_000,
    });

    expect(model.stagedLive).toBe(5);
    expect(model.stagedRetainedLive).toBe(2);
    expect(model.stagedResidentLive).toBe(3);
    // Residents are staged payloads the canonical set does not hold; the
    // retained window is exactly what the server aggregated.
    expect(model.retainedLive).toBe(50_001);
  });

  it('leaves dead records rendered but out of every live count', () => {
    const retained = [cell(1), cell(2, { death_at_ms: 5_000 }), cell(3)];
    const model = deriveCellPopulationField({
      cache: cache({ retained, inView: 3 }),
      displayLimit: 12_000,
    });

    // Two of the three are alive; the dead one is still drawn for its
    // withering tail but contributes to no population number.
    expect(model.renderedLive).toBe(2);
    expect(model.stagedLive).toBe(2);
  });

  it('discloses a manual clamp instead of calling the whole stage addressable', () => {
    const retained = Array.from({ length: 10 }, (_, i) => cell(i + 1));
    const model = deriveCellPopulationField({
      cache: cache({ retained, inView: 50_001 }),
      displayLimit: 4,
    });

    expect(model.clamped).toBe(true);
    expect(model.renderedLive).toBe(4);
    expect(model.stagedLive).toBe(10);
    // Canonical statistics do not move when a presentation clamp does.
    expect(model.retainedLive).toBe(50_001);
    expect(model.ratio).toBeCloseTo(50_001 / 10, 6);
  });

  it('reports no clamp when the budget covers the stage', () => {
    const retained = Array.from({ length: 10 }, (_, i) => cell(i + 1));
    const model = deriveCellPopulationField({
      cache: cache({ retained }),
      displayLimit: 12_000,
    });

    expect(model.clamped).toBe(false);
    expect(model.renderedLive).toBe(model.stagedLive);
  });

  it('counts an overlay once, as rendered and never as staged', () => {
    const retained = [cell(1), cell(2)];
    // 7 is retained but off-stage; the overlay is how it becomes visible.
    const offStage = cell(7);
    const base = cache({ retained: [...retained, offStage], members: [1, 2], inView: 3 });

    const model = deriveCellPopulationField({
      cache: base,
      displayLimit: 12_000,
      // Duplicated deliberately: an inspection field can name the selected
      // Cell twice, and a double count would inflate reported coverage.
      overlayCellIds: [7, 7, 1],
    });

    expect(model.stagedLive).toBe(2);
    expect(model.renderedLive).toBe(3);
    expect(model.renderedRetainedLive).toBe(3);
  });

  it('ignores an overlay id no record backs', () => {
    const model = deriveCellPopulationField({
      cache: cache({ retained: [cell(1)] }),
      displayLimit: 12_000,
      overlayCellIds: [404],
    });

    expect(model.renderedLive).toBe(1);
  });

  it('carries the retained provenance through instead of assuming coverage', () => {
    const partial = deriveCellPopulationField({
      cache: cache({ retained: [cell(1)], inView: 1, statsScope: 'received_rows' }),
      displayLimit: 12_000,
    });

    expect(partial.retainedScope).toBe('received_rows');
    expect(
      deriveCellPopulationField({
        cache: cache({ retained: [cell(1)], statsScope: 'full_retained' }),
        displayLimit: 12_000,
      }).retainedScope,
    ).toBe('full_retained');
  });

  it('measures the stage composition in the census bins, disjointly', () => {
    const retained = [
      cell(1, DAO),
      cell(2, DAO),
      cell(3),
      cell(4),
      cell(5),
      cell(6, PLAIN),
    ];
    const model = deriveCellPopulationField({
      cache: cache({ retained }),
      displayLimit: 12_000,
    });

    // A DAO Cell also carries a type script, so an order that tested "typed"
    // first would double-count it out of the DAO bin.
    expect(model.stagedClasses).toEqual({ dao: 2, typedNonDao: 3, plain: 1 });
    expect(
      model.stagedClasses.dao
      + model.stagedClasses.typedNonDao
      + model.stagedClasses.plain,
    ).toBe(model.stagedLive);
    expect(model.stagedCurated).toBe(true);
  });

  it('does not call an uncurated prefix a composition choice', () => {
    const model = deriveCellPopulationField({
      cache: cache({ retained: [cell(1)], mode: 'canonical' }),
      displayLimit: 12_000,
    });

    expect(model.stagedCurated).toBe(false);
  });

  it('falls back to the canonical prefix with no display plane', () => {
    const retained = Array.from({ length: 6 }, (_, i) => cell(i + 1));
    const model = deriveCellPopulationField({
      cache: cache({ retained, displayBudget: null, inView: 6 }),
      displayLimit: 4,
    });

    expect(model.renderedLive).toBe(4);
    // There is no server stage in this regime, so nothing may claim one.
    expect(model.stagedLive).toBe(0);
    expect(model.clamped).toBe(false);
  });

  it('survives an empty galaxy without inventing a population', () => {
    const model = deriveCellPopulationField({
      cache: cache(),
      displayLimit: 12_000,
    });

    expect(model.renderedLive).toBe(0);
    expect(model.stagedLive).toBe(0);
    expect(model.retainedLive).toBe(0);
    expect(model.ratio).toBe(0);
    expect(model.gain).toBe(0);
  });

  it('resolves a staged id canonical-first when both records exist', () => {
    // Post-reorg overlap keeps a resident payload beside a canonical record
    // with the same id. Counting it as a resident would understate retained
    // coverage and double the id's presence.
    const shared = 5;
    const model = deriveCellPopulationField({
      cache: cache({
        retained: [cell(shared)],
        residents: [cell(shared)],
        members: [shared],
      }),
      displayLimit: 12_000,
    });

    expect(model.stagedLive).toBe(1);
    expect(model.stagedRetainedLive).toBe(1);
    expect(model.stagedResidentLive).toBe(0);
  });

  it('never divides by an empty stage', () => {
    const model = deriveCellPopulationField({
      cache: cache({ retained: [], inView: 50_001 }),
      displayLimit: 12_000,
      census: census(),
    });

    expect(Number.isFinite(model.ratio)).toBe(true);
    expect(model.ratio).toBe(1_471_373);
    expect(model.gain).toBeLessThanOrEqual(1);
  });
});
