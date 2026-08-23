// The stage-scoped script census: `cache.stageScripts`, counted where the
// staged set lives.
//
// Two properties are under test. First, the census always equals a full scan
// of the staged membership resolved canonical-first — the same equivalence
// `cellsStats.test.ts` holds for the retained aggregate, and the reason the
// incremental upkeep can be trusted at all. Second, its ranked form matches
// the backend's `ScriptTally`/`rank_and_cut` semantics line for line
// (`crates/cknerv-core/src/projection/cells_stats.rs`), because the panel
// draws both censuses with one set of bars and only the scope tag differs.

import { describe, expect, it } from 'vitest';
import type {
  Cell,
  CellDelta,
  DisplayProvenance,
  HashType,
  ScriptId,
} from '@cknerv/types';

import {
  applyCellDelta,
  applyRevisionedCellDeltas,
  emptyCellsCache,
  fromCellsSnapshot,
  resolveDisplayCell,
  type CellGalaxyCache,
} from '../src/cellsReducer';
import {
  aggregateStageScripts,
  stageScriptCensus,
  STAGE_CENSUS_CAP,
} from '../src/cellsStats';

const DEFAULT_LOCK: ScriptId = { code_hash: `0x${'9b'.repeat(32)}`, hash_type: 'type' };

function script(byte: string, hash_type: HashType = 'type'): ScriptId {
  return { code_hash: `0x${byte.repeat(32)}`, hash_type };
}

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
    lock_script: DEFAULT_LOCK,
    ...overrides,
  };
}

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

/** The invariant the reducer promises: the incrementally maintained tally is
 *  always what one scan of the staged membership would produce. Compared
 *  through the ranked census so the assertion cannot pass or fail on the
 *  insertion order of two maps. */
function expectStageInvariant(cache: CellGalaxyCache): void {
  const scanned = aggregateStageScripts(
    cache.displayMembers,
    (id) => resolveDisplayCell(cache, id),
  );
  expect(stageScriptCensus(cache.stageScripts))
    .toEqual(stageScriptCensus(scanned));
}

function step(cache: CellGalaxyCache, delta: CellDelta): CellGalaxyCache {
  const next = applyCellDelta(cache, delta);
  expectStageInvariant(next);
  return next;
}

/** Counts by role, as the panel would read them. */
function counts(cache: CellGalaxyCache) {
  const census = stageScriptCensus(cache.stageScripts);
  return {
    locks: Object.fromEntries(
      census.locks.map((entry) => [entry.script.code_hash.slice(2, 4), entry.count]),
    ),
    types: Object.fromEntries(
      census.types.map((entry) => [entry.script.code_hash.slice(2, 4), entry.count]),
    ),
    typesAbsent: census.types_absent,
    unidentified: census.unidentified,
  };
}

describe('stage script census — membership', () => {
  it('counts a cell when it takes the stage and stops when it leaves', () => {
    let cache = emptyCellsCache();
    expectStageInvariant(cache);
    // A cell the canonical lane already holds is NOT counted until the stage
    // takes it: the retained map is a different, wider population.
    cache = step(cache, { type: 'birth', cell: cell(1, { type_script: script('aa') }) });
    expect(counts(cache).types).toEqual({});

    cache = step(cache, displayDelta({ enter_cells: [cell(1, { type_script: script('aa') })] }));
    expect(counts(cache)).toMatchObject({ types: { aa: 1 }, typesAbsent: 0 });

    cache = step(cache, displayDelta({ exit_ids: [1] }));
    expect(counts(cache).types).toEqual({});
    // A family that left the stage entirely leaves no zero-count ghost.
    expect(stageScriptCensus(cache.stageScripts).types).toEqual([]);
    // …while the canonical record it came from is still retained.
    expect(cache.cells.has(1)).toBe(true);
  });

  it('counts composed-mode residents, which live outside the retained map', () => {
    let cache = emptyCellsCache();
    cache = step(cache, displayDelta({
      enter_cells: [
        cell(10, { type_script: script('aa') }),
        cell(11, { type_script: script('aa') }),
        cell(12, { type_script: script('bb') }),
        cell(13),
      ],
    }));

    expect(cache.cells.size).toBe(0);
    expect(counts(cache)).toEqual({
      locks: { '9b': 4 },
      types: { aa: 2, bb: 1 },
      typesAbsent: 1,
      unidentified: 0,
    });
  });

  it('counts a staged id once however it entered', () => {
    // Bare-id enters (an older server's lane) stage an id whose record this
    // cache may never have been sent. A census counts records, not ids.
    let cache = emptyCellsCache();
    cache = step(cache, displayDelta({ enter_ids: [77] }));
    expect(counts(cache)).toMatchObject({ types: {}, typesAbsent: 0, unidentified: 0 });

    cache = step(cache, { type: 'birth', cell: cell(77, { type_script: script('cc') }) });
    expect(counts(cache).types).toEqual({ cc: 1 });
  });
});

describe('stage script census — payload replacement', () => {
  it('swaps the old scripts for the new when a staged record is re-shipped', () => {
    let cache = emptyCellsCache();
    cache = step(cache, displayDelta({ enter_cells: [cell(5, { type_script: script('aa') })] }));
    expect(counts(cache).types).toEqual({ aa: 1 });

    // Same id, still one member, different type script.
    cache = step(cache, displayDelta({
      enter_cells: [cell(5, { type_script: script('bb'), capacity: 999 })],
    }));
    expect(counts(cache).types).toEqual({ bb: 1 });
    expect(cache.displayMembers.size).toBe(1);
  });

  it('follows a staged id when a canonical birth outranks its resident copy', () => {
    // Resolution is canonical-first, so a canonical record arriving for an
    // already-staged resident id changes what the stage draws — with no
    // membership event and nothing in the display journal to report it.
    let cache = emptyCellsCache();
    cache = step(cache, displayDelta({ enter_cells: [cell(5, { type_script: script('aa') })] }));
    expect(counts(cache).types).toEqual({ aa: 1 });

    cache = step(cache, { type: 'birth', cell: cell(5, { type_script: script('bb') }) });
    expect(resolveDisplayCell(cache, 5)?.type_script).toEqual(script('bb'));
    expect(counts(cache).types).toEqual({ bb: 1 });
  });

  it('falls back to the resident copy when the canonical record is reaped', () => {
    // Post-reorg overlap keeps both homes; GC of the canonical one demotes
    // the stage to whatever the resident map still holds.
    let cache = emptyCellsCache();
    cache = step(cache, { type: 'birth', cell: cell(6, { type_script: script('aa') }) });
    cache = step(cache, displayDelta({ enter_cells: [cell(6, { type_script: script('bb') })] }));
    expect(cache.cells.has(6)).toBe(true);
    expect(cache.displayResidents.has(6)).toBe(true);
    expect(counts(cache).types).toEqual({ aa: 1 });

    cache = step(cache, { type: 'gc', ids: [6] });
    expect(counts(cache).types).toEqual({ bb: 1 });
  });

  it('drops a staged id whose only record was reaped', () => {
    let cache = emptyCellsCache();
    cache = step(cache, { type: 'birth', cell: cell(7, { type_script: script('aa') }) });
    cache = step(cache, displayDelta({ enter_cells: [cell(7, { type_script: script('aa') })] }));
    expect(cache.displayResidents.has(7)).toBe(false);
    expect(counts(cache).types).toEqual({ aa: 1 });

    cache = step(cache, { type: 'gc', ids: [7] });
    expect(cache.displayMembers.has(7)).toBe(true);
    expect(counts(cache).types).toEqual({});
  });
});

describe('stage script census — corpses on stage', () => {
  it('keeps counting a dead cell for as long as the stage keeps it', () => {
    // The one deliberate divergence from the backend's census, which skips
    // dead cells: this one counts the stage, not the living. A body inside
    // its death-animation window is still on stage and still drawn.
    let cache = emptyCellsCache();
    cache = step(cache, displayDelta({
      enter_cells: [cell(8, { type_script: script('aa') })],
    }));
    cache = step(cache, { type: 'death', id: 8, at_ms: 9_000 });

    expect(resolveDisplayCell(cache, 8)?.death_at_ms).toBe(9_000);
    expect(counts(cache).types).toEqual({ aa: 1 });

    // It leaves the census when it leaves the stage, not when it dies.
    cache = step(cache, displayDelta({ exit_ids: [8] }));
    expect(counts(cache).types).toEqual({});
  });

  it('keeps the tally identity across the patches that do not move it', () => {
    // Death and tag rewrite a staged record without touching its scripts. A
    // tally that turned over for those would re-rank itself every block.
    let cache = emptyCellsCache();
    cache = step(cache, displayDelta({
      enter_cells: [cell(9, { type_script: script('aa') })],
    }));
    const tally = cache.stageScripts;
    const census = stageScriptCensus(tally);

    cache = step(cache, { type: 'death', id: 9, at_ms: 4_000 });
    cache = step(cache, { type: 'tag', id: 9, tag: 'wallet' });
    cache = step(cache, { type: 'pulse', at_ms: 123 });

    expect(cache.stageScripts).toBe(tally);
    // …so the ranking is not recomputed either.
    expect(stageScriptCensus(cache.stageScripts)).toBe(census);
  });
});

describe('stage script census — backend edge semantics', () => {
  it('separates plain cells from unreadable identities', () => {
    let cache = emptyCellsCache();
    cache = step(cache, displayDelta({
      enter_cells: [
        // Plain: no type script at all.
        cell(1),
        // The wire omits an unset lock script entirely.
        cell(2, { lock_script: undefined, type_script: script('aa') }),
        // A type script cknerv could not parse carries the all-zero hash.
        cell(3, { type_script: { code_hash: `0x${'00'.repeat(32)}`, hash_type: 'data' } }),
      ],
    }));

    const census = stageScriptCensus(cache.stageScripts);
    expect(census.types_absent).toBe(1);
    // One unreadable lock plus one unreadable type — counted per role, the
    // same double count the backend's `ScriptTally` makes.
    expect(census.unidentified).toBe(2);
    expect(census.types.map((entry) => entry.script)).toEqual([script('aa')]);
    // Neither gap appears as a script family.
    expect(census.locks.length).toBe(1);
  });

  it('ranks most cells first and breaks ties on the code hash', () => {
    const enter: Cell[] = [];
    let id = 0;
    const add = (byte: string, times: number) => {
      for (let i = 0; i < times; i += 1) {
        enter.push(cell(id += 1, { type_script: script(byte) }));
      }
    };
    // Inserted in an order the tie-break has to undo: a stable sort on count
    // alone would leave bb ahead of aa and dd ahead of cc.
    add('bb', 5);
    add('dd', 2);
    add('aa', 5);
    add('cc', 2);

    const cache = step(emptyCellsCache(), displayDelta({ enter_cells: enter }));
    expect(stageScriptCensus(cache.stageScripts).types).toEqual([
      { script: script('aa'), count: 5 },
      { script: script('bb'), count: 5 },
      { script: script('cc'), count: 2 },
      { script: script('dd'), count: 2 },
    ]);
  });

  it('cuts at the same depth as the backend and carries the tail', () => {
    const families = STAGE_CENSUS_CAP + 6;
    const enter: Cell[] = [];
    let id = 0;
    for (let f = 0; f < families; f += 1) {
      // Descending counts: family 0 is the largest, so the six smallest fall
      // past the cut.
      const byte = (16 + f).toString(16);
      for (let i = 0; i < families - f; i += 1) {
        enter.push(cell(id += 1, { type_script: script(byte) }));
      }
    }
    const cache = step(emptyCellsCache(), displayDelta({ enter_cells: enter }));
    const census = stageScriptCensus(cache.stageScripts);

    expect(census.types.length).toBe(STAGE_CENSUS_CAP);
    expect(census.types_tail_scripts).toBe(6);
    // Counts 6, 5, 4, 3, 2, 1 — visible as a total rather than dropped.
    expect(census.types_tail_cells).toBe(21);
    expect(census.types[0].count).toBe(families);
    // The locks all share one identity, so that role is nowhere near the cut.
    expect(census.locks_tail_scripts).toBe(0);
  });
});

describe('stage script census — batches and snapshots', () => {
  it('collapses intermediate stage churn inside one batch', () => {
    let cache = emptyCellsCache();
    cache = applyRevisionedCellDeltas(cache, [
      { revision: 1, delta: displayDelta({ enter_cells: [cell(1, { type_script: script('aa') })] }) },
    ]);
    expectStageInvariant(cache);

    cache = applyRevisionedCellDeltas(cache, [
      // Enters and exits within the same batch: net zero.
      { revision: 2, delta: displayDelta({ enter_cells: [cell(2, { type_script: script('bb') })] }) },
      { revision: 3, delta: displayDelta({ exit_ids: [2] }) },
      // Replaced twice: only the final payload counts.
      { revision: 4, delta: displayDelta({ enter_cells: [cell(1, { type_script: script('cc') })] }) },
      { revision: 5, delta: displayDelta({ enter_cells: [cell(1, { type_script: script('dd') })] }) },
    ]);
    expectStageInvariant(cache);
    expect(counts(cache).types).toEqual({ dd: 1 });
  });

  it('is untouched by batches that never reach the stage', () => {
    let cache = emptyCellsCache();
    cache = step(cache, displayDelta({ enter_cells: [cell(1, { type_script: script('aa') })] }));
    const tally = cache.stageScripts;

    cache = applyRevisionedCellDeltas(cache, [
      { revision: 6, delta: { type: 'birth', cell: cell(50, { type_script: script('ee') }) } },
      { revision: 7, delta: { type: 'stats', total_births: 9, total_deaths: 2 } },
    ]);
    expectStageInvariant(cache);
    expect(cache.stageScripts).toBe(tally);
    expect(counts(cache).types).toEqual({ aa: 1 });
  });

  it('seeds from a snapshot with a composed display plane', () => {
    const cache = fromCellsSnapshot(4, {
      cells: [
        cell(1, { type_script: script('aa') }),
        // Retained but not staged: outside the census.
        cell(2, { type_script: script('ff') }),
      ],
      last_pulse_at_ms: 0,
      display: {
        budget: { cells: 12_000, nerve_edges: 8_000 },
        members: [1, 3, 4],
        residents: [
          cell(3, { type_script: script('bb') }),
          cell(4),
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
    expect(counts(cache)).toEqual({
      locks: { '9b': 3 },
      types: { aa: 1, bb: 1 },
      typesAbsent: 1,
      unidentified: 0,
    });
    // The retained-window census is the backend's to send and stays empty
    // here — the two scopes never seed each other.
    expect(cache.stats.scripts.types).toEqual([]);
  });

  it('is empty for a server that ships no display plane at all', () => {
    const cache = fromCellsSnapshot(1, {
      cells: [cell(1, { type_script: script('aa') })],
      last_pulse_at_ms: 0,
    });

    expect(cache.displayMembers.size).toBe(0);
    expect(stageScriptCensus(cache.stageScripts)).toEqual(
      stageScriptCensus(aggregateStageScripts([], () => undefined)),
    );
    expect(counts(cache).types).toEqual({});
  });

  it('survives a long randomized stage soak', () => {
    // Enters, exits, replacements, canonical births, deaths and GC in random
    // order — every transition checked against the full scan.
    let seed = 20260823;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const bytes = ['aa', 'bb', 'cc', 'dd', 'ee'];
    let cache = emptyCellsCache();
    for (let i = 0; i < 400; i += 1) {
      const id = 1 + Math.floor(random() * 12);
      const typed = random() < 0.7;
      const record = cell(id, {
        capacity: 100 + Math.floor(random() * 1000),
        type_script: typed
          ? script(bytes[Math.floor(random() * bytes.length)])
          : undefined,
      });
      const roll = random();
      if (roll < 0.35) cache = step(cache, displayDelta({ enter_cells: [record] }));
      else if (roll < 0.5) cache = step(cache, displayDelta({ exit_ids: [id] }));
      else if (roll < 0.75) cache = step(cache, { type: 'birth', cell: record });
      else if (roll < 0.85) cache = step(cache, { type: 'gc', ids: [id] });
      else if (roll < 0.95) cache = step(cache, { type: 'death', id, at_ms: 1000 + i });
      else cache = step(cache, displayDelta({ enter_ids: [id] }));
    }
    expect(cache.displayMembers.size).toBeGreaterThan(0);
  });
});
