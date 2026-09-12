import { beforeEach, describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';

import {
  cellCombinedSlotHint,
  type CellCombinedSlotHintInput,
} from '../../src/geometry/cellCombinedSlotHint';
import {
  createCellSlotState,
  syncCellSlots,
  type CellSlotState,
  type CellSlotSync,
} from '../../src/geometry/cellSlotAssignment';
import {
  resetCellSlotStats,
  snapshotCellSlotStats,
} from '../../src/geometry/cellSlotStats';
import {
  createCellLifecycleStampState,
  reapCellExitHolds,
  refreshCellExitHolds,
  syncCellLifecycleStamps,
  takeCellExitHoldCells,
  type CellLifecycleStampState,
} from '../../src/geometry/cellLifecycleStamps';
import { EXIT_FADE_MS } from '../../src/geometry/cellPositions';
import type { CellRenderSetUpdate } from '../../src/geometry/cellRenderSet';

function cell(id: number, tag: string | null = null): Cell {
  return {
    id,
    born_at_ms: 1_000 + id,
    death_at_ms: null,
    birth_block: 1,
    tag,
    pos_seed: [id, 0, -id],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 100,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: `0x${id}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
  };
}

/** Counts what the plan prices this task in: one `slotOf.get` per drawn slot
 *  is the whole-list walk, one per journal entry is the incremental one. */
class CountingMap<K, V> extends Map<K, V> {
  gets = 0;

  override get(key: K): V | undefined {
    this.gets += 1;
    return super.get(key);
  }
}

function countingSlotState(): CellSlotState & { slotOf: CountingMap<number, number> } {
  const state = createCellSlotState();
  state.slotOf = new CountingMap<number, number>();
  return state as CellSlotState & { slotOf: CountingMap<number, number> };
}

interface StagedStep {
  staged: Cell[];
  journal: CellRenderSetUpdate | null;
}

function ranges(dirty: Iterable<number>): { start: number; count: number }[] {
  const sorted = [...new Set(dirty)].sort((a, b) => a - b);
  const out: { start: number; count: number }[] = [];
  for (const index of sorted) {
    const last = out[out.length - 1];
    if (last && last.start + last.count === index) last.count += 1;
    else out.push({ start: index, count: 1 });
  }
  return out;
}

/**
 * One staged journal, in the shape `syncCellRenderSet` actually publishes:
 * an exit leaves the list by SWAP-FROM-TAIL (dirtying the moved cell's slot
 * and dropping the tail), a value replacement patches its own slot, and a
 * birth appends. A block therefore dirties O(churn) slots and never the
 * prefix, which is the whole reason the incremental path is worth taking.
 */
function stageBlock(
  previous: readonly Cell[],
  exits: ReadonlySet<number>,
  refresh: ReadonlyMap<number, Cell>,
  births: readonly Cell[],
): StagedStep {
  const staged = previous.slice();
  const index = new Map(staged.map((c, slot) => [c.id, slot]));
  const dirty = new Set<number>();
  const exited: number[] = [];
  for (const id of exits) {
    const slot = index.get(id);
    if (slot === undefined) continue;
    exited.push(id);
    index.delete(id);
    const last = staged.length - 1;
    if (slot !== last) {
      const moved = staged[last];
      staged[slot] = moved;
      index.set(moved.id, slot);
      dirty.add(slot);
    }
    staged.pop();
  }
  for (const [id, record] of refresh) {
    const slot = index.get(id);
    if (slot === undefined || staged[slot] === record) continue;
    staged[slot] = record;
    dirty.add(slot);
  }
  const entered: number[] = [];
  for (const record of births) {
    if (index.has(record.id)) continue;
    dirty.add(staged.length);
    index.set(record.id, staged.length);
    staged.push(record);
    entered.push(record.id);
  }
  return {
    staged,
    journal: {
      cells: staged,
      previousCells: previous,
      ranges: ranges(dirty),
      membershipChanged: entered.length > 0 || exited.length > 0,
      entered,
      exited,
      topologyChanged: false,
      topologyVersion: 1,
      mode: 'incremental',
    },
  };
}

/** What `CellGalaxy` holds between frames: the drawn list and the three
 *  segments it was built from. */
interface DrawnList {
  combined: readonly Cell[];
  staged: readonly Cell[];
  overlay: readonly Cell[];
  holds: readonly Cell[];
}

function emptyDrawnList(): DrawnList {
  return { combined: [], staged: [], overlay: [], holds: [] };
}

function combine(
  staged: readonly Cell[],
  overlay: readonly Cell[],
  holds: readonly Cell[],
): readonly Cell[] {
  return overlay.length === 0 && holds.length === 0
    ? staged
    : (staged as Cell[]).concat(overlay as Cell[], holds as Cell[]);
}

/** One frame of the galaxy's own bookkeeping, through the REAL lifecycle
 *  module: reap what expired, stamp this journal's exits into holds, refresh
 *  held records, and take the hold segment. */
function drawnListFrame(
  lifecycle: CellLifecycleStampState,
  previous: DrawnList,
  step: StagedStep,
  overlayId: number | null,
  nowS: number,
  records: ReadonlyMap<number, Cell>,
): DrawnList {
  reapCellExitHolds(lifecycle, nowS);
  const stagedIds = new Set(step.staged.map((c) => c.id));
  const overlay = overlayId !== null
    && !stagedIds.has(overlayId)
    && records.has(overlayId)
    ? [records.get(overlayId)!]
    : [];
  const overlayIds = new Set(overlay.map((c) => c.id));
  if (step.journal !== null || overlay.length > 0) {
    syncCellLifecycleStamps(lifecycle, {
      entered: step.journal?.entered ?? [],
      exited: step.journal?.exited ?? [],
      nowS,
      resolve: (id) => {
        const record = records.get(id)
          ?? previous.combined.find((c) => c.id === id);
        return record
          ? { cell: record, times: { bornAtS: 0, deathAtS: 1e9 } }
          : null;
      },
      drawnElsewhere: (id) => overlayIds.has(id),
    });
  }
  refreshCellExitHolds(lifecycle, (id) => records.get(id) ?? null);
  const holds = takeCellExitHoldCells(lifecycle, 768);
  return {
    combined: combine(step.staged, overlay, holds),
    staged: step.staged,
    overlay,
    holds,
  };
}

function hintFor(
  previous: DrawnList,
  next: DrawnList,
  step: StagedStep,
): CellCombinedSlotHintInput {
  return {
    previousCombined: previous.combined,
    previousStaged: previous.staged,
    previousOverlay: previous.overlay,
    previousHolds: previous.holds,
    staged: next.staged,
    overlay: next.overlay,
    holds: next.holds,
    journal: step.journal,
  };
}

/** The staged prefix did not move this frame: a hold reap, an overlay
 *  change. There is no journal, and none is needed. */
function stagedStood(previous: DrawnList): StagedStep {
  return { staged: previous.staged as Cell[], journal: null };
}

function expectSameSync(patched: CellSlotSync, truth: CellSlotSync, label: string): void {
  expect(patched.count, `${label}: count`).toBe(truth.count);
  expect(patched.cells.map((c) => c.id), `${label}: slots`)
    .toEqual(truth.cells.map((c) => c.id));
  expect(patched.cells, `${label}: records`).toEqual(truth.cells);
  expect(patched.ranges, `${label}: ranges`).toEqual(truth.ranges);
  expect(patched.membershipChanged, `${label}: membership`).toBe(truth.membershipChanged);
  expect(patched.positionsChanged, `${label}: positions`).toBe(truth.positionsChanged);
}

describe('the slot hint over the whole drawn list', () => {
  beforeEach(() => {
    resetCellSlotStats();
  });

  it('takes the journal path through a block with exits, and its reap frame', () => {
    // The plan's own pricing: a block with departures cost TWO whole-list
    // walks (12,400 and 12,300 `slotOf.get` at 12,000 drawn) because the hold
    // segment made the hint unbuildable. It is now the churn, twice.
    const pool = new Map<number, Cell>();
    for (let id = 1; id <= 400; id += 1) pool.set(id, cell(id));
    const lifecycle = createCellLifecycleStampState();
    const state = countingSlotState();

    const opening = stageBlock([], new Set(), new Map(), [...pool.values()]);
    let drawn = drawnListFrame(lifecycle, emptyDrawnList(), opening, null, 0, pool);
    // The session's first sync has nothing to chain from and is canonical by
    // definition; the counter opens after it.
    syncCellSlots(state, drawn.combined);
    resetCellSlotStats();
    expect(drawn.holds).toHaveLength(0);

    // A block: twenty births, ten departures. The departures become holds, so
    // the drawn list is staged + holds and nothing left it.
    const exits = new Set([...pool.keys()].slice(0, 10));
    const births: Cell[] = [];
    for (let id = 401; id <= 420; id += 1) births.push(cell(id));
    for (const id of exits) pool.delete(id);
    for (const record of births) pool.set(record.id, record);
    const before = drawn;
    const block = stageBlock(before.staged, exits, new Map(), births);
    drawn = drawnListFrame(lifecycle, before, block, null, 1, pool);
    expect([...drawn.holds.map((c) => c.id)].sort((a, b) => a - b))
      .toEqual([...exits].sort((a, b) => a - b));

    state.slotOf.gets = 0;
    const hint = cellCombinedSlotHint(hintFor(before, drawn, block));
    expect(hint).toBeDefined();
    expect(hint!.removedIds).toEqual([]);
    const sync = syncCellSlots(state, drawn.combined, hint);
    expect(snapshotCellSlotStats()).toMatchObject({ canonical: 0, incremental: 1 });
    // The churn — twenty births, ten swapped tails, ten holds — and not one
    // get per drawn slot.
    expect(state.slotOf.gets).toBeLessThan(80);
    expect(sync.count).toBe(drawn.combined.length);
    expect(sync.count).toBe(420);

    // The reap frame, 0.9 s later: no journal at all, ten ids leave the drawn
    // list, and the walk is ten gets.
    const beforeReap = drawn;
    const stood = stagedStood(beforeReap);
    drawn = drawnListFrame(lifecycle, beforeReap, stood, null, 1 + EXIT_FADE_MS / 1000, pool);
    expect(drawn.holds).toHaveLength(0);
    state.slotOf.gets = 0;
    const reapHint = cellCombinedSlotHint(hintFor(beforeReap, drawn, stood));
    expect(reapHint).toBeDefined();
    expect(reapHint!.removedIds.slice().sort((a, b) => a - b))
      .toEqual([...exits].sort((a, b) => a - b));
    expect(reapHint!.upserts).toHaveLength(0);
    syncCellSlots(state, drawn.combined, reapHint);
    expect(snapshotCellSlotStats()).toMatchObject({ canonical: 0, incremental: 2 });
    expect(state.slotOf.gets).toBeLessThan(40);
  });

  it('leaves every slot where the whole-list walk would, over 1,500 steps', () => {
    // The ORACLE. Two independent slot states, the same drawn list: one
    // always canonical, one always offered the hint. Births, exits, reaps,
    // record refreshes, a selection that lands on a held cell and on an
    // off-stage one, revivals, and frames the staged prefix does not move in.
    let seed = 90_210;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const staged = new Map<number, Cell>();
    const offStage = new Map<number, Cell>();
    let nextId = 1;
    const opening: Cell[] = [];
    for (; nextId <= 120; nextId += 1) {
      const record = cell(nextId);
      staged.set(nextId, record);
      opening.push(record);
    }
    for (let index = 0; index < 20; index += 1, nextId += 1) {
      offStage.set(nextId, cell(nextId));
    }
    const lifecycle = createCellLifecycleStampState();
    const truthState = createCellSlotState();
    const patchedState = countingSlotState();
    let drawn = emptyDrawnList();
    let step: StagedStep = stageBlock([], new Set(), new Map(), opening);
    let overlayId: number | null = null;
    let nowS = 0;
    let hinted = 0;
    let gets = 0;
    let slots = 0;
    let holdsSeen = 0;
    let removalsSeen = 0;
    let revivals = 0;

    for (let index = 0; index < 1_500; index += 1) {
      if (index > 0) {
        nowS += 0.12;
        const previousStaged = drawn.staged;
        if (rand() < 0.75) {
          const exits = new Set<number>();
          const ids = previousStaged.map((c) => c.id);
          const departures = Math.floor(rand() * 4);
          for (let d = 0; d < departures && ids.length > 0; d += 1) {
            // Front-biased, like cap eviction.
            exits.add(ids[Math.floor(rand() * Math.min(6, ids.length))]);
          }
          const refresh = new Map<number, Cell>();
          if (rand() < 0.35 && staged.size > 0) {
            const keys = [...staged.keys()];
            const pick = keys[Math.floor(rand() * keys.length)];
            if (!exits.has(pick)) {
              refresh.set(pick, { ...staged.get(pick)!, tag: `t${index}` });
            }
          }
          const births: Cell[] = [];
          const born = Math.floor(rand() * 5);
          for (let b = 0; b < born; b += 1, nextId += 1) births.push(cell(nextId));
          // A cell can come back to the stage while its fade is still running.
          if (rand() < 0.2 && offStage.size > 0) {
            const keys = [...offStage.keys()];
            const pick = keys[Math.floor(rand() * keys.length)];
            births.push(offStage.get(pick)!);
            offStage.delete(pick);
            revivals += 1;
          }
          step = stageBlock(previousStaged, exits, refresh, births);
          for (const id of exits) {
            offStage.set(id, staged.get(id)!);
            staged.delete(id);
          }
          for (const [id, record] of refresh) staged.set(id, record);
          for (const record of births) staged.set(record.id, record);
        } else {
          step = stagedStood(drawn);
        }
        if (rand() < 0.15) {
          const keys = [...offStage.keys(), ...staged.keys()];
          overlayId = keys.length > 0 ? keys[Math.floor(rand() * keys.length)] : null;
        } else if (rand() < 0.08) {
          overlayId = null;
        }
      }
      const before = drawn;
      const records = new Map([...offStage, ...staged]);
      drawn = drawnListFrame(lifecycle, before, step, overlayId, nowS, records);
      if (drawn.holds.length > 0) holdsSeen += 1;

      const truth = syncCellSlots(truthState, drawn.combined);
      const hint = cellCombinedSlotHint(hintFor(before, drawn, step));
      if (hint) {
        hinted += 1;
        removalsSeen += hint.removedIds.length;
      }
      patchedState.slotOf.gets = 0;
      const patched = syncCellSlots(patchedState, drawn.combined, hint);
      gets += patchedState.slotOf.gets;
      slots += patched.count;
      expectSameSync(patched, truth, `step ${index}`);
      // The mutable assignment behind the published copy, slot for slot.
      // Compared without an assertion per slot: 1,500 steps of ~140 slots is
      // 200,000 `expect` calls and they cost more than the whole soak.
      let drift: string | null = patchedState.count === truthState.count
        ? null
        : `count ${patchedState.count} vs ${truthState.count}`;
      for (let slot = 0; drift === null && slot < patchedState.count; slot += 1) {
        if (patchedState.cells[slot] !== truthState.cells[slot]) {
          drift = `slot ${slot}: ${patchedState.cells[slot].id} vs ${truthState.cells[slot].id}`;
        }
      }
      expect(drift, `step ${index}`).toBeNull();
    }

    // The soak has to have exercised what it claims to.
    expect(holdsSeen).toBeGreaterThan(600);
    expect(removalsSeen).toBeGreaterThan(400);
    expect(revivals).toBeGreaterThan(20);
    // Every step but the session's opening one, whose empty base array is not
    // the empty array the drawn list was built from — and which the sync
    // refuses anyway, its own source being null.
    expect(hinted).toBe(1_499);
    // ⚠️ The counter is a module singleton and the ORACLE's own 1,500 syncs
    // are canonical by construction, so only the incremental count separates
    // the two paths — and it is one per step bar the session's first, which
    // has nothing to chain from.
    const stats = snapshotCellSlotStats();
    expect(stats.incremental).toBe(1_499);
    expect(stats.canonical).toBe(1_501);
    // …and the walk is the churn: a canonical-only run is one get per drawn
    // slot per step.
    expect(gets).toBeLessThan(slots / 8);
  });

  it('refuses a hint it cannot prove', () => {
    const pool = new Map<number, Cell>([[1, cell(1)], [2, cell(2)]]);
    const lifecycle = createCellLifecycleStampState();
    const opening = stageBlock([], new Set(), new Map(), [...pool.values()]);
    const drawn = drawnListFrame(lifecycle, emptyDrawnList(), opening, null, 0, pool);

    // The session's opening frame: the journal's base is an empty array, and
    // it is not the empty array the drawn list was built from. Identity is
    // identity, and the sync would refuse the hint anyway — its own source is
    // null until something has been synced.
    expect(cellCombinedSlotHint(hintFor(emptyDrawnList(), drawn, opening))).toBeUndefined();

    const next = stageBlock(drawn.staged, new Set(), new Map(), [cell(3)]);
    const after = drawnListFrame(lifecycle, drawn, next, null, 0.1, pool);
    const valid = hintFor(drawn, after, next);
    expect(cellCombinedSlotHint(valid)).toBeDefined();
    // A journal that describes a different base than the drawn list carries:
    // a generation was skipped, and the ids it names may not be the ones the
    // slots hold.
    expect(cellCombinedSlotHint({
      ...valid,
      journal: { ...next.journal!, previousCells: [cell(9)] },
    })).toBeUndefined();
    // A staged array that moved with no journal to say how.
    expect(cellCombinedSlotHint({ ...valid, journal: null })).toBeUndefined();
    // A journal whose result is not the array the drawn list was built from.
    expect(cellCombinedSlotHint({
      ...valid,
      journal: { ...next.journal!, cells: [...next.staged] },
    })).toBeUndefined();
    // …and a prefix that did not move needs no journal and cares nothing for
    // a stale one: the segments say everything.
    expect(cellCombinedSlotHint({
      ...hintFor(after, after, stagedStood(after)),
      journal: { ...next.journal!, previousCells: [cell(9)] },
    })).toBeDefined();
  });

  it('keeps a held cell the overlay picked up out of the removals', () => {
    // The one crossing that looks like a departure and is not: a cell exits
    // the stage, its fade starts, and a selection lands on it — the hold is
    // cancelled and the overlay draws it, at the same slot, in one frame.
    const pool = new Map<number, Cell>();
    for (let id = 1; id <= 6; id += 1) pool.set(id, cell(id));
    const lifecycle = createCellLifecycleStampState();
    const state = countingSlotState();
    const opening = stageBlock([], new Set(), new Map(), [...pool.values()]);
    let drawn = drawnListFrame(lifecycle, emptyDrawnList(), opening, null, 0, pool);
    syncCellSlots(state, drawn.combined);

    const departed = 3;
    const step = stageBlock(drawn.staged, new Set([departed]), new Map(), []);
    let before = drawn;
    drawn = drawnListFrame(lifecycle, before, step, null, 0.5, pool);
    expect(drawn.holds.map((c) => c.id)).toEqual([departed]);
    let hint = cellCombinedSlotHint(hintFor(before, drawn, step));
    expect(hint!.removedIds).toEqual([]);
    const heldSlot = state.slotOf.get(departed);
    syncCellSlots(state, drawn.combined, hint);
    expect(state.slotOf.get(departed)).toBe(heldSlot);

    // The selection lands on it: the hold ends, the overlay carries it.
    before = drawn;
    const stood = stagedStood(before);
    drawn = drawnListFrame(lifecycle, before, stood, departed, 0.6, pool);
    expect(drawn.holds).toHaveLength(0);
    expect(drawn.overlay.map((c) => c.id)).toEqual([departed]);
    hint = cellCombinedSlotHint(hintFor(before, drawn, stood));
    expect(hint!.removedIds).toEqual([]);
    syncCellSlots(state, drawn.combined, hint);
    expect(state.slotOf.get(departed)).toBe(heldSlot);
    expect(snapshotCellSlotStats().canonical).toBe(1);
  });
});
