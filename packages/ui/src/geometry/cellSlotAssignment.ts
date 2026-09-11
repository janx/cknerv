// Stable GPU slot assignment for the instanced Cell layers.
//
// The render SET (membership + semantic order) reshuffles per block: activity
// leads each class and cap eviction removes from the FRONT of the retained
// map, so list position shifts wholesale — a list-positional slot mapping
// rewrites nearly the full 50K prefix every block. This module decouples the
// two: each visible cell keeps its GPU slot for as long as it stays visible,
// vacated slots refill by swap-from-tail (the array stays dense for one
// contiguous draw range), and per-block uploads collapse to O(churn).
//
// Slot order is visually free: every instanced Cell layer draws with additive
// or screen accumulation, and the semantic list (selection prefixes, graph
// consumers) lives elsewhere — this mapping is exclusively about which GPU
// instance a cell occupies.
//
// A departure frees its slot the moment the caller stops listing the cell —
// which is why the drawn list carries an exit-hold segment past the staged
// membership (`cellLifecycleStamps`): a cell leaves this module's list when
// its fade ENDS, not when the stage let it go.

import type { Cell } from '@cknerv/types';

export interface CellSlotRange {
  start: number;
  count: number;
}

export interface CellSlotState {
  /** Dense slot → cell array; `[0, count)` is always fully occupied. */
  cells: Cell[];
  /** Immutable snapshot republished only when a sync changed something —
   * consumers keep identity-based memos (effect deps, cached derivations).
   *
   * Both halves of that sentence are load-bearing, and neither can be paid
   * for by handing out a reference instead of a copy. `cells` above is
   * MUTATED IN PLACE by every sync, so publishing it would hand consumers a
   * live array; and a consumer that reads `published[slot]` after the fact
   * (the screen-space hit index resolves its hits that way) must see the
   * cell that slot holds NOW, so an identity that outlived a content change
   * would hand it the previous frame's cells. The index does not rebuild on
   * this identity — it keys on `positionsChanged` (as the field version) and
   * on the per-slot inputs the buffer writer reports — which is what lets a
   * payload-only republish cost it nothing. Nor can the sync's INPUT list
   * stand in: this is slot order, and slot order deliberately ignores list
   * order. */
  published: Cell[];
  /** cell id → slot. */
  slotOf: Map<number, number>;
  /** Per-slot membership stamp for the current sync generation. */
  stamps: number[];
  generation: number;
  count: number;
  /** Render-list snapshot the mutable assignment currently mirrors. This is
   * an identity guard for journal-shaped incremental syncs; it is not exposed
   * as the published slot order. */
  source: readonly Cell[] | null;
}

export interface CellSlotSync {
  /** Immutable published snapshot: a NEW array when this sync changed any
   * slot or the count, the previous one otherwise. */
  cells: Cell[];
  count: number;
  /** Sorted, coalesced slot ranges whose contents changed this sync. */
  ranges: CellSlotRange[];
  /** True when any cell entered or left the visible set. */
  membershipChanged: boolean;
  /** True when the drawn set's POSITIONS moved: a slot changed occupant, or
   * an in-place replacement carried a different `pos_seed`. A record refresh
   * that leaves every cell where it was republishes the list without this —
   * which is what lets a spatial cache outlive a payload delta. */
  positionsChanged: boolean;
}

export interface CellSlotIncrementalUpdate {
  /** Exact render list the update was computed against. */
  previousCells: readonly Cell[];
  /** Net ids that left the drawn set. */
  removedIds: readonly number[];
  /** New or replacement records, in current render-list order. */
  upserts: readonly Cell[];
}

export function createCellSlotState(): CellSlotState {
  return {
    cells: [],
    published: [],
    slotOf: new Map(),
    stamps: [],
    generation: 0,
    count: 0,
    source: null,
  };
}

function coalesceSlots(slots: number[]): CellSlotRange[] {
  if (slots.length === 0) return [];
  slots.sort((a, b) => a - b);
  const ranges: CellSlotRange[] = [];
  let start = slots[0];
  let end = slots[0];
  for (let i = 1; i < slots.length; i += 1) {
    const slot = slots[i];
    if (slot === end || slot === end + 1) {
      end = slot;
      continue;
    }
    ranges.push({ start, count: end - start + 1 });
    start = slot;
    end = slot;
  }
  ranges.push({ start, count: end - start + 1 });
  return ranges;
}

/**
 * Bring the slot assignment in step with the current render list. Retained
 * cells keep their slot (a value replacement dirties it in place), departed
 * cells free theirs, and new cells fill freed slots first, then append. The
 * render list's ORDER is deliberately ignored — reordering alone produces
 * zero dirty slots.
 */
export function syncCellSlots(
  state: CellSlotState,
  list: readonly Cell[],
  incremental?: CellSlotIncrementalUpdate,
): CellSlotSync {
  if (incremental && state.source === incremental.previousCells) {
    const synced = syncCellSlotsIncremental(state, list, incremental);
    if (synced) return synced;
  }
  return syncCellSlotsCanonical(state, list);
}

function syncCellSlotsCanonical(
  state: CellSlotState,
  list: readonly Cell[],
): CellSlotSync {
  state.generation += 1;
  const generation = state.generation;
  const { cells, slotOf, stamps } = state;
  const dirty: number[] = [];
  const adds: Cell[] = [];
  let membershipChanged = false;
  let relocated = false;

  for (const cell of list) {
    const slot = slotOf.get(cell.id);
    if (
      slot === undefined
      || slot >= state.count
      || cells[slot]?.id !== cell.id
    ) {
      adds.push(cell);
      continue;
    }
    stamps[slot] = generation;
    const before = cells[slot];
    if (before !== cell) {
      if (
        before.pos_seed[0] !== cell.pos_seed[0]
        || before.pos_seed[1] !== cell.pos_seed[1]
        || before.pos_seed[2] !== cell.pos_seed[2]
      ) {
        relocated = true;
      }
      cells[slot] = cell;
      dirty.push(slot);
    }
  }

  // Free every slot whose occupant left the set, refilling from `adds`
  // first and then by swapping the (live) tail down so the array stays
  // dense. Holes are scanned ascending; the live tail search skips stale
  // tail slots, which simply evaporate.
  const placeAt = (slot: number, cell: Cell) => {
    cells[slot] = cell;
    slotOf.set(cell.id, slot);
    stamps[slot] = generation;
    dirty.push(slot);
  };
  for (let slot = 0; slot < state.count; slot += 1) {
    if (stamps[slot] === generation) continue;
    membershipChanged = true;
    slotOf.delete(cells[slot].id);
    const add = adds.pop();
    if (add !== undefined) {
      placeAt(slot, add);
      continue;
    }
    // Trim stale tail slots outright, then move the last live cell down.
    let tail = state.count - 1;
    while (tail > slot && stamps[tail] !== generation) {
      slotOf.delete(cells[tail].id);
      tail -= 1;
    }
    state.count = tail + 1;
    if (tail > slot) {
      placeAt(slot, cells[tail]);
      state.count = tail;
    } else {
      // The hole reached the (shrunken) end of the array.
      state.count = slot;
    }
  }
  for (const cell of adds) {
    membershipChanged = true;
    placeAt(state.count, cell);
    state.count += 1;
  }
  cells.length = state.count;
  stamps.length = state.count;
  state.source = list;

  if (
    dirty.length > 0
    || membershipChanged
    || state.published.length !== state.count
  ) {
    state.published = cells.slice();
  }
  return {
    cells: state.published,
    count: state.count,
    ranges: coalesceSlots(dirty),
    membershipChanged,
    // Every occupant change goes through `placeAt`, and every `placeAt` is a
    // membership move — so the two sources cover the whole set between them.
    positionsChanged: relocated || membershipChanged,
  };
}

/** Journal path for the ordinary render-set update. It touches only ids named
 * by the render cursor, while preserving the canonical hole-fill order of the
 * full sync. Returning null asks the caller to use that canonical path. */
function syncCellSlotsIncremental(
  state: CellSlotState,
  list: readonly Cell[],
  update: CellSlotIncrementalUpdate,
): CellSlotSync | null {
  if (state.count !== update.previousCells.length) return null;
  const { cells, slotOf, stamps } = state;
  const removed = new Set(update.removedIds);
  const adds: Cell[] = [];
  const replacements: Array<{ slot: number; cell: Cell }> = [];

  // Validate the whole journal before changing mutable slot state. If a stale
  // or incomplete cursor reaches this path, the canonical fallback must still
  // see the exact pre-update state so it can publish every dirty payload.
  for (const cell of update.upserts) {
    const slot = slotOf.get(cell.id);
    if (slot === undefined || slot >= state.count || cells[slot]?.id !== cell.id) {
      adds.push(cell);
      continue;
    }
    if (cells[slot] !== cell) replacements.push({ slot, cell });
  }
  const addedCount = adds.length;

  const removalSlots: number[] = [];
  for (const id of removed) {
    const slot = slotOf.get(id);
    if (slot === undefined || slot >= state.count || cells[slot]?.id !== id) return null;
    removalSlots.push(slot);
  }
  if (state.count - removalSlots.length + addedCount !== list.length) return null;

  state.generation += 1;
  const dirty: number[] = [];
  let relocated = false;
  for (const { slot, cell } of replacements) {
    const before = cells[slot];
    if (
      before.pos_seed[0] !== cell.pos_seed[0]
      || before.pos_seed[1] !== cell.pos_seed[1]
      || before.pos_seed[2] !== cell.pos_seed[2]
    ) relocated = true;
    cells[slot] = cell;
    dirty.push(slot);
  }
  removalSlots.sort((a, b) => a - b);
  // Delete every departed id before compaction. Some tail slots disappear
  // while an earlier hole is filled, so deleting only the slot currently
  // visited would leave those tail ids in the reverse map.
  for (const id of removed) slotOf.delete(id);
  const placeAt = (slot: number, cell: Cell) => {
    cells[slot] = cell;
    slotOf.set(cell.id, slot);
    dirty.push(slot);
  };
  for (const slot of removalSlots) {
    if (slot >= state.count || !removed.has(cells[slot].id)) continue;
    const add = adds.pop();
    if (add !== undefined) {
      placeAt(slot, add);
      continue;
    }
    let tail = state.count - 1;
    while (tail > slot && removed.has(cells[tail].id)) {
      tail -= 1;
    }
    state.count = tail + 1;
    if (tail > slot) {
      placeAt(slot, cells[tail]);
      state.count = tail;
    } else {
      state.count = slot;
    }
  }
  for (const cell of adds) {
    placeAt(state.count, cell);
    state.count += 1;
  }
  cells.length = state.count;
  stamps.length = state.count;
  state.source = list;
  const membershipChanged = removalSlots.length > 0 || addedCount > 0;
  if (dirty.length > 0 || membershipChanged) state.published = cells.slice();
  return {
    cells: state.published,
    count: state.count,
    ranges: coalesceSlots(dirty),
    membershipChanged,
    positionsChanged: relocated || membershipChanged,
  };
}
