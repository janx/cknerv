// Deterministic review scenarios for the Cell population field.
//
// Every condition the design has to survive, as one named, reproducible
// model. These are the states a reviewer needs to see, and pinning them here
// means a change in the derive, the amount curve, or the HUD's scope labels
// shows up as a diff on a named situation rather than as a shrug at a live
// dashboard that happened to look fine.
//
// The counts are the ones measured live on 2026-08-17: mainnet 1,471,373 live
// Cells at block 20,181,778, testnet 18,890,285, a retained window of 50,001,
// and a 12,000-Cell stage.

import type { Cell, ChainCensus, ShapeSeed } from '@cknerv/types';

import {
  deriveCellPopulationField,
  type CellPopulationCache,
  type CellPopulationFieldModel,
} from '../../src/derives/cellPopulationField.derive';

const TYPE_SEED: ShapeSeed = [0x1234_5678, 0x9abc_def0];
const LOCK_SEED: ShapeSeed = [0x3141_5926, 0x5358_9793];
const DATA_SEED: ShapeSeed = [0x2384_6264, 0x3383_2795];

export const MAINNET_LIVE_CELLS = 1_471_373;
export const TESTNET_LIVE_CELLS = 18_890_285;
export const RETAINED_WINDOW = 50_001;
export const STAGE_BUDGET = 12_000;
export const MAINNET_TIP = 20_181_778;

/** A staged Cell. The population model reads only lifecycle and class, so the
 *  rest is fixed — these are stand-ins for stage membership, not specimens. */
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

/** A stage of `count` Cells composed 20:65:15 DAO/typed/plain, the way the
 *  curated policy staffs it. The chain is nothing like this mix, which is
 *  exactly what the composition disclosure exists to show.
 *
 *  The quota does not divide by ten, so the cycle is twenty: 4 dao, 13
 *  typed, 3 plain. `REVIEW_STAGE` is a multiple of it, so the fixture
 *  lands on the quota exactly rather than near it. */
function curatedStage(count: number): Cell[] {
  const cells: Cell[] = [];
  for (let i = 0; i < count; i += 1) {
    const bucket = i % 20;
    if (bucket < 4) cells.push(cell(i + 1, { asset_kind: 'dao' }));
    else if (bucket < 17) cells.push(cell(i + 1));
    else cells.push(cell(i + 1, { type_shape_seed: null, asset_kind: 'native' }));
  }
  return cells;
}

function cache(options: {
  staged: Cell[];
  retainedLive?: number;
  observedLive?: number;
  statsScope?: 'full_retained' | 'received_rows';
  mode?: 'canonical' | 'composed';
  displayBudget?: { cells: number; nerveEdges: number } | null;
}): CellPopulationCache {
  const staged = options.staged;
  return {
    cells: new Map(staged.map((c) => [c.id, c])),
    displayMembers: new Set(staged.map((c) => c.id)),
    displayResidents: new Map(),
    displayBudget: options.displayBudget === undefined
      ? { cells: STAGE_BUDGET, nerveEdges: 8_000 }
      : options.displayBudget,
    displayProvenance: {
      mode: options.mode ?? 'composed',
      source: 'ckbadger',
      as_of: null,
      updated_at_ms: 1,
    },
    stats: {
      born: 202_671,
      live: options.observedLive ?? 50_043,
      dead: 152_628,
      byKind: { wallet: 0, dex: 0, cf: 0, ckbloom: 0, generic: staged.length },
      capacityShannons: 0,
      inView: options.retainedLive ?? RETAINED_WINDOW,
      dataBearing: 0,
      byLock: { sighash: 0, multisig: 0, acp: 0, omnilock: 0, other: 0 },
      byAsset: { native: 0, sudt: 0, xudt: 0, dao: 0, spore: 0, other: 0 },
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

export function mainnetCensus(overrides: Partial<ChainCensus> = {}): ChainCensus {
  return {
    source: 'ckbadger',
    as_of: { block: MAINNET_TIP, hash: `0x${'c6'.repeat(32)}` },
    updated_at_ms: 1,
    live_cells: MAINNET_LIVE_CELLS,
    classes: { dao: 22_676, typed_non_dao: 475_891, plain: 972_806 },
    data_bearing: 266_346,
    ...overrides,
  };
}

export function testnetCensus(): ChainCensus {
  return {
    source: 'ckbadger',
    as_of: { block: 22_110_293, hash: `0x${'25'.repeat(32)}` },
    updated_at_ms: 1,
    live_cells: TESTNET_LIVE_CELLS,
    classes: { dao: 7_896, typed_non_dao: 854_856, plain: 18_027_533 },
    data_bearing: 813_314,
  };
}

export interface PopulationReviewScenario {
  /** Stable identifier a reviewer can name when reporting what they saw. */
  id: string;
  /** What this scenario is a test OF — the condition, not the numbers. */
  situation: string;
  model: CellPopulationFieldModel;
}

/** A smaller stage keeps these fixtures cheap while preserving every ratio
 *  that matters; the derive's denominators are counts, not identities. */
const REVIEW_STAGE = 120;
const REVIEW_SCALE = STAGE_BUDGET / REVIEW_STAGE;

function scaled(value: number): number {
  return Math.round(value / REVIEW_SCALE);
}

export function populationReviewScenarios(): PopulationReviewScenario[] {
  const stage = curatedStage(REVIEW_STAGE);

  return [
    {
      id: 'empty-galaxy',
      situation: 'No Cells at all. Nothing staged, nothing retained.',
      model: deriveCellPopulationField({
        cache: cache({ staged: [], retainedLive: 0, observedLive: 0 }),
        displayLimit: STAGE_BUDGET,
      }),
    },
    {
      id: 'stage-covers-scope',
      situation: 'R <= 1. The stage holds everything its scope contains, so '
        + 'there is no medium — the correct degenerate case.',
      model: deriveCellPopulationField({
        cache: cache({ staged: stage, retainedLive: REVIEW_STAGE }),
        displayLimit: STAGE_BUDGET,
      }),
    },
    {
      id: 'retained-scope',
      situation: 'No census. The field under-claims to the retained window '
        + 'rather than guessing, and says which scope it is claiming.',
      model: deriveCellPopulationField({
        cache: cache({ staged: stage, retainedLive: scaled(RETAINED_WINDOW) }),
        displayLimit: STAGE_BUDGET,
      }),
    },
    {
      id: 'chain-scope-mainnet',
      situation: 'Validated mainnet census. The population clearly dominates '
        + 'the stage without erasing it.',
      model: deriveCellPopulationField({
        cache: cache({ staged: stage, retainedLive: scaled(RETAINED_WINDOW) }),
        displayLimit: STAGE_BUDGET,
        census: mainnetCensus({ live_cells: scaled(MAINNET_LIVE_CELLS) }),
        chainTip: MAINNET_TIP,
      }),
    },
    {
      id: 'chain-scope-testnet',
      situation: 'Validated testnet census — 12.8x mainnet. Denser still, and '
        + 'visibly different from mainnet rather than pinned at the top.',
      model: deriveCellPopulationField({
        cache: cache({ staged: stage, retainedLive: scaled(RETAINED_WINDOW) }),
        displayLimit: STAGE_BUDGET,
        census: { ...testnetCensus(), live_cells: scaled(TESTNET_LIVE_CELLS) },
        chainTip: 22_110_293,
      }),
    },
    {
      id: 'stale-census',
      situation: 'Census anchor still canonical but far behind the tip. Chain '
        + 'scope is kept, dimmed, and explicitly labeled stale.',
      model: deriveCellPopulationField({
        cache: cache({ staged: stage, retainedLive: scaled(RETAINED_WINDOW) }),
        displayLimit: STAGE_BUDGET,
        census: mainnetCensus({ live_cells: scaled(MAINNET_LIVE_CELLS) }),
        chainTip: MAINNET_TIP + 400,
      }),
    },
    {
      id: 'census-withdrawn',
      situation: 'A reorg pruned the census, or the source went incompatible. '
        + 'Scope falls back to retained and the field persists at lower gain.',
      model: deriveCellPopulationField({
        cache: cache({ staged: stage, retainedLive: scaled(RETAINED_WINDOW) }),
        displayLimit: STAGE_BUDGET,
        census: null,
      }),
    },
    {
      id: 'manual-clamp',
      situation: 'A presentation clamp renders less than the server staged. '
        + 'Both numbers are disclosed; canonical statistics do not move.',
      model: deriveCellPopulationField({
        cache: cache({ staged: stage, retainedLive: scaled(RETAINED_WINDOW) }),
        displayLimit: Math.floor(REVIEW_STAGE / 2),
        census: mainnetCensus({ live_cells: scaled(MAINNET_LIVE_CELLS) }),
        chainTip: MAINNET_TIP,
      }),
    },
    {
      id: 'selected-cell-overlay',
      situation: 'An off-stage Cell held open by the inspection overlay. It '
        + 'is rendered, counted once, and never staged.',
      model: deriveCellPopulationField({
        cache: cache({
          staged: [...stage, cell(9_001)],
          retainedLive: scaled(RETAINED_WINDOW),
        }),
        displayLimit: REVIEW_STAGE,
        census: mainnetCensus({ live_cells: scaled(MAINNET_LIVE_CELLS) }),
        chainTip: MAINNET_TIP,
        overlayCellIds: [9_001],
      }),
    },
    {
      id: 'partial-retained-stats',
      situation: 'An older server ships no aggregate segment. The retained '
        + 'row says so instead of borrowing the window label.',
      model: deriveCellPopulationField({
        cache: cache({
          staged: stage,
          retainedLive: REVIEW_STAGE,
          statsScope: 'received_rows',
        }),
        displayLimit: STAGE_BUDGET,
      }),
    },
    {
      id: 'no-display-plane',
      situation: 'A server with no display plane. The renderer falls back to '
        + 'the canonical prefix and nothing claims a server stage.',
      model: deriveCellPopulationField({
        cache: cache({
          staged: stage,
          retainedLive: scaled(RETAINED_WINDOW),
          displayBudget: null,
        }),
        displayLimit: STAGE_BUDGET,
      }),
    },
    {
      id: 'uncurated-stage',
      situation: 'Canonical insertion-order staffing. The stage mix is an '
        + 'accident of ordering and must not be labeled a curation choice.',
      model: deriveCellPopulationField({
        cache: cache({
          staged: stage,
          retainedLive: scaled(RETAINED_WINDOW),
          mode: 'canonical',
        }),
        displayLimit: STAGE_BUDGET,
        census: mainnetCensus({ live_cells: scaled(MAINNET_LIVE_CELLS) }),
        chainTip: MAINNET_TIP,
      }),
    },
    {
      id: 'census-without-classes',
      situation: 'A census that proves a count but no partition. The count '
        + 'stands; no composition is disclosed at all.',
      model: deriveCellPopulationField({
        cache: cache({ staged: stage, retainedLive: scaled(RETAINED_WINDOW) }),
        displayLimit: STAGE_BUDGET,
        census: mainnetCensus({
          live_cells: scaled(MAINNET_LIVE_CELLS),
          classes: undefined,
        }),
        chainTip: MAINNET_TIP,
      }),
    },
  ];
}
