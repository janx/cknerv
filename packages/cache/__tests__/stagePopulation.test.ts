// The stage-scoped population tally: `cache.stagePopulation`, counted where
// the staged set lives.
//
// One property is under test: after every transition the tally equals one
// scan of the staged membership resolved canonical-first — the same
// equivalence `stageScripts.test.ts` holds for the script census, and the
// reason the population field (`@cknerv/ui`) can read five integers per block
// instead of walking 12,000 members and allocating a 12,000-entry Set. The
// named cases are the transitions that move the numbers WITHOUT a membership
// event (promotion, demotion, death) and the ones that must not turn the
// tally's identity.

import { describe, expect, it } from 'vitest';
import type { Cell, CellDelta, DisplayProvenance } from '@cknerv/types';

import {
  applyCellDelta,
  applyRevisionedCellDeltas,
  emptyCellsCache,
  fromCellsSnapshot,
  type CellGalaxyCache,
} from '../src/cellsReducer';
import {
  aggregateStagePopulation,
  cellPopulationClass,
  emptyStagePopulation,
  type StagePopulationTally,
} from '../src/cellsStats';

/** Plain by default: no type script, so `type_shape_seed` is null. */
function cell(id: number, overrides: Partial<Cell> = {}): Cell {
  return {
    id,
    born_at_ms: 1000 + id,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [id, 0, 0],
    out_point: { tx_hash: `0xtx${id}`, index: 0 },
    capacity: 100 + id,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: `0x${String(id).padStart(64, '0')}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
    lock_kind: 'sighash',
    asset_kind: 'native',
    ...overrides,
  };
}

/** A DAO Cell always carries a type script. */
const DAO: Partial<Cell> = { asset_kind: 'dao', type_shape_seed: [7, 7] };
const TYPED: Partial<Cell> = { asset_kind: 'xudt', type_shape_seed: [8, 8] };

function displayDelta(overrides: Partial<{
  enter_ids: number[];
  enter_cells: Cell[];
  exit_ids: number[];
  provenance: DisplayProvenance | null;
}> = {}): CellDelta {
  return {
    type: 'display',
    enter_ids: [],
    enter_cells: [],
    exit_ids: [],
    ...overrides,
  };
}

function tally(
  overrides: Partial<StagePopulationTally> = {},
): StagePopulationTally {
  return { ...emptyStagePopulation(), ...overrides };
}

/** The invariant the reducer promises: the incrementally maintained tally is
 *  always what one scan of the staged membership would produce. */
function expectStageInvariant(cache: CellGalaxyCache): void {
  expect(cache.stagePopulation).toEqual(
    aggregateStagePopulation(
      cache.displayMembers,
      cache.cells,
      cache.displayResidents,
    ),
  );
  // …and the bins partition the live count.
  const { retainedLive, residentLive, dao, typedNonDao, plain } = cache.stagePopulation;
  expect(dao + typedNonDao + plain).toBe(retainedLive + residentLive);
}

function step(cache: CellGalaxyCache, delta: CellDelta): CellGalaxyCache {
  const next = applyCellDelta(cache, delta);
  expectStageInvariant(next);
  return next;
}

describe('cellPopulationClass', () => {
  it('tests DAO first so the three bins stay disjoint', () => {
    // A DAO Cell carries a type script; an order that tested "typed" first
    // would count it out of the DAO bin.
    expect(cellPopulationClass(cell(1, DAO))).toBe('dao');
    expect(cellPopulationClass(cell(1, TYPED))).toBe('typedNonDao');
    expect(cellPopulationClass(cell(1))).toBe('plain');
  });

  it('reads the type shape seed, which is always present, not the optional script', () => {
    // Older persisted records can lack `type_script` while still carrying a
    // type; the seed is the field every record has.
    expect(cellPopulationClass({ type_shape_seed: [1, 1] })).toBe('typedNonDao');
    expect(cellPopulationClass({ type_shape_seed: null })).toBe('plain');
  });
});

describe('stage population — membership', () => {
  it('counts a member when it takes the stage and stops when it leaves', () => {
    let cache = emptyCellsCache();
    expectStageInvariant(cache);
    // A cell the canonical lane already holds is NOT counted until the stage
    // takes it: the retained map is a different, wider population.
    cache = step(cache, { type: 'birth', cell: cell(1, TYPED) });
    expect(cache.stagePopulation).toEqual(tally());

    cache = step(cache, displayDelta({ enter_cells: [cell(1, TYPED)] }));
    expect(cache.stagePopulation).toEqual(tally({ retainedLive: 1, typedNonDao: 1 }));

    cache = step(cache, displayDelta({ exit_ids: [1] }));
    expect(cache.stagePopulation).toEqual(tally());
    expect(cache.cells.has(1)).toBe(true);
  });

  it('files a member under the home that resolved it', () => {
    let cache = emptyCellsCache();
    // Composed-mode residents live outside the retained map entirely.
    cache = step(cache, displayDelta({
      enter_cells: [cell(10, DAO), cell(11, TYPED), cell(12), cell(13)],
    }));
    expect(cache.cells.size).toBe(0);
    expect(cache.stagePopulation).toEqual(tally({
      residentLive: 4, dao: 1, typedNonDao: 1, plain: 2,
    }));

    // A canonical birth entering in the same batch as its own record ships a
    // duplicate the reducer drops: membership only, resolved canonically.
    cache = applyRevisionedCellDeltas(cache, [
      { revision: 1, delta: { type: 'birth', cell: cell(20, DAO) } },
      { revision: 2, delta: displayDelta({ enter_cells: [cell(20, DAO)] }) },
    ]);
    expectStageInvariant(cache);
    expect(cache.displayResidents.has(20)).toBe(false);
    expect(cache.stagePopulation).toEqual(tally({
      retainedLive: 1, residentLive: 4, dao: 2, typedNonDao: 1, plain: 2,
    }));
  });

  it('counts records, not ids: a bare-id enter contributes nothing until a record arrives', () => {
    let cache = emptyCellsCache();
    cache = step(cache, displayDelta({ enter_ids: [77] }));
    expect(cache.displayMembers.has(77)).toBe(true);
    expect(cache.stagePopulation).toEqual(tally());

    cache = step(cache, { type: 'birth', cell: cell(77, TYPED) });
    expect(cache.stagePopulation).toEqual(tally({ retainedLive: 1, typedNonDao: 1 }));
  });
});

describe('stage population — resolution moves without a membership event', () => {
  it('promotes a resident to retained when its canonical record is born', () => {
    let cache = emptyCellsCache();
    cache = step(cache, displayDelta({ enter_cells: [cell(5, TYPED)] }));
    expect(cache.stagePopulation).toEqual(tally({ residentLive: 1, typedNonDao: 1 }));

    // Canonical-first resolution: the same id now draws its canonical record
    // — and that record may be in a different bin than the resident copy.
    cache = step(cache, { type: 'birth', cell: cell(5, DAO) });
    expect(cache.displayResidents.has(5)).toBe(true);
    expect(cache.stagePopulation).toEqual(tally({ retainedLive: 1, dao: 1 }));
  });

  it('demotes to the resident copy when the canonical record is reaped', () => {
    let cache = emptyCellsCache();
    cache = step(cache, { type: 'birth', cell: cell(6, DAO) });
    cache = step(cache, displayDelta({ enter_cells: [cell(6, TYPED)] }));
    expect(cache.stagePopulation).toEqual(tally({ retainedLive: 1, dao: 1 }));

    cache = step(cache, { type: 'gc', ids: [6] });
    expect(cache.displayMembers.has(6)).toBe(true);
    expect(cache.stagePopulation).toEqual(tally({ residentLive: 1, typedNonDao: 1 }));
  });

  it('drops a member whose only record was reaped', () => {
    let cache = emptyCellsCache();
    cache = step(cache, { type: 'birth', cell: cell(7) });
    cache = step(cache, displayDelta({ enter_cells: [cell(7)] }));
    expect(cache.displayResidents.has(7)).toBe(false);
    expect(cache.stagePopulation).toEqual(tally({ retainedLive: 1, plain: 1 }));

    cache = step(cache, { type: 'gc', ids: [7] });
    expect(cache.displayMembers.has(7)).toBe(true);
    expect(cache.stagePopulation).toEqual(tally());
  });

  it('moves the bins when a re-shipped record changes class', () => {
    let cache = emptyCellsCache();
    cache = step(cache, displayDelta({ enter_cells: [cell(8, TYPED)] }));
    cache = step(cache, displayDelta({ enter_cells: [cell(8, DAO)] }));
    expect(cache.displayMembers.size).toBe(1);
    expect(cache.stagePopulation).toEqual(tally({ residentLive: 1, dao: 1 }));
  });
});

describe('stage population — the living, not the stage', () => {
  it('leaves a dead member on stage but out of the population', () => {
    // The one place this tally and the script census part ways: a corpse in
    // its death-animation window is still on stage (the census keeps
    // counting it) but is not population.
    let cache = emptyCellsCache();
    cache = step(cache, displayDelta({ enter_cells: [cell(8, DAO), cell(9, TYPED)] }));
    const before = cache.stagePopulation;

    cache = step(cache, { type: 'death', id: 8, at_ms: 9_000 });
    expect(cache.displayMembers.has(8)).toBe(true);
    expect(cache.stagePopulation).toEqual(tally({ residentLive: 1, typedNonDao: 1 }));
    // A death moves a live count, so the identity must turn.
    expect(cache.stagePopulation).not.toBe(before);

    // The corpse leaving the stage moves nothing further.
    const dead = cache.stagePopulation;
    cache = step(cache, displayDelta({ exit_ids: [8] }));
    expect(cache.stagePopulation).toBe(dead);
  });

  it('patches a resident corpse too, not only the canonical one', () => {
    // Death reaches both homes; a resident frozen alive would be counted
    // alive forever.
    let cache = emptyCellsCache();
    cache = step(cache, displayDelta({ enter_cells: [cell(3)] }));
    cache = step(cache, { type: 'death', id: 3, at_ms: 5_000 });
    expect(cache.stagePopulation).toEqual(tally());
  });

  it('keeps the tally identity across the patches that move nothing', () => {
    let cache = emptyCellsCache();
    cache = step(cache, displayDelta({ enter_cells: [cell(9, TYPED)] }));
    const before = cache.stagePopulation;

    cache = step(cache, { type: 'tag', id: 9, tag: 'wallet' });
    cache = step(cache, { type: 'pulse', at_ms: 123 });
    cache = step(cache, { type: 'stats', total_births: 9, total_deaths: 2 });
    // Same class re-shipped with a different capacity: same contribution.
    cache = step(cache, displayDelta({ enter_cells: [cell(9, { ...TYPED, capacity: 999 })] }));
    // Provenance-only patch.
    cache = step(cache, displayDelta({
      provenance: { mode: 'composed', source: 'ckbadger', as_of: null, updated_at_ms: 5 },
    }));
    // A canonical birth off stage.
    cache = step(cache, { type: 'birth', cell: cell(50, DAO) });

    expect(cache.stagePopulation).toBe(before);
  });
});

describe('stage population — batches and snapshots', () => {
  it('collapses intermediate stage churn inside one batch', () => {
    let cache = emptyCellsCache();
    cache = applyRevisionedCellDeltas(cache, [
      // Enters and exits within the same batch: net zero.
      { revision: 2, delta: displayDelta({ enter_cells: [cell(2, DAO)] }) },
      { revision: 3, delta: displayDelta({ exit_ids: [2] }) },
      // Replaced twice: only the final payload counts.
      { revision: 4, delta: displayDelta({ enter_cells: [cell(1, DAO)] }) },
      { revision: 5, delta: displayDelta({ enter_cells: [cell(1, TYPED)] }) },
      // Born and dead in one batch.
      { revision: 6, delta: displayDelta({ enter_cells: [cell(3)] }) },
      { revision: 7, delta: { type: 'death', id: 3, at_ms: 100 } },
    ]);
    expectStageInvariant(cache);
    expect(cache.stagePopulation).toEqual(tally({ residentLive: 1, typedNonDao: 1 }));
  });

  it('seeds from a snapshot with a composed display plane', () => {
    const cache = fromCellsSnapshot(4, {
      cells: [
        cell(1, DAO),
        // Retained but not staged: outside the tally.
        cell(2, TYPED),
        // Staged AND resident (post-reorg overlap): resolved canonical-first.
        cell(5, DAO),
      ],
      last_pulse_at_ms: 0,
      display: {
        budget: { cells: 12_000, nerve_edges: 8_000 },
        // 9 has no record anywhere: counts as nothing.
        members: [1, 3, 4, 5, 9],
        residents: [
          cell(3, TYPED),
          // A corpse shipped in the snapshot.
          cell(4, { death_at_ms: 77 }),
          cell(5, TYPED),
        ],
        provenance: {
          mode: 'composed',
          source: 'ckbadger',
          as_of: { block: 42, hash: '0xblock42' },
          updated_at_ms: 7_000,
        },
      },
    });

    expectStageInvariant(cache);
    expect(cache.stagePopulation).toEqual(tally({
      retainedLive: 2, residentLive: 1, dao: 2, typedNonDao: 1,
    }));
  });

  it('is empty for a server that ships no display plane at all', () => {
    const cache = fromCellsSnapshot(1, {
      cells: [cell(1, DAO), cell(2)],
      last_pulse_at_ms: 0,
    });
    expect(cache.displayMembers.size).toBe(0);
    expect(cache.stagePopulation).toEqual(emptyStagePopulation());
  });

  it('survives a long randomized stage soak', () => {
    // Enters, exits, replacements, bare ids, canonical births, deaths and GC
    // in random order over a small id universe, so promotions, demotions and
    // overlaps happen constantly — every transition checked against the
    // full scan.
    let seed = 20260828;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const classes: Partial<Cell>[] = [{}, DAO, TYPED];
    let cache = emptyCellsCache();
    let moved = 0;
    for (let i = 0; i < 600; i += 1) {
      const id = 1 + Math.floor(random() * 14);
      const record = cell(id, {
        ...classes[Math.floor(random() * classes.length)],
        capacity: 100 + Math.floor(random() * 1000),
        death_at_ms: random() < 0.1 ? 500 + i : null,
      });
      const roll = random();
      const before = cache.stagePopulation;
      if (roll < 0.3) cache = step(cache, displayDelta({ enter_cells: [record] }));
      else if (roll < 0.45) cache = step(cache, displayDelta({ exit_ids: [id] }));
      else if (roll < 0.7) cache = step(cache, { type: 'birth', cell: record });
      else if (roll < 0.8) cache = step(cache, { type: 'gc', ids: [id] });
      else if (roll < 0.9) cache = step(cache, { type: 'death', id, at_ms: 1000 + i });
      else if (roll < 0.95) cache = step(cache, { type: 'tag', id, tag: 'wallet' });
      else cache = step(cache, displayDelta({ enter_ids: [id] }));
      if (cache.stagePopulation !== before) moved += 1;
      // Identity turns only when a number moved.
      if (cache.stagePopulation !== before) {
        expect(cache.stagePopulation).not.toEqual(before);
      }
    }
    expect(cache.displayMembers.size).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(100);
  });
});
