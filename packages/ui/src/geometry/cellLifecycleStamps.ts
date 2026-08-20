// Stage lifecycle stamps for the Cell layer.
//
// Chain birth/death belong to the RECORD; stage enter/exit belong to the
// VIEW — one cell enters and leaves the stage many times inside a single
// lifetime (activity staging, quota eviction, `fill_vacancies` refill,
// resident retirement). Both pairs animate, and they must never animate at
// once: a cell that arrives inside its own birth window keeps the growth
// gesture exclusively, and a cell that leaves after it finished withering is
// already invisible, so its exit costs nothing.
//
// This module owns the stamp bookkeeping and the deferred-free queue that
// makes an exit drawable at all. It holds no GPU state: the caller maps ids
// to slots and writes the attribute arrays. Enter/exit timestamps are CLIENT
// receipt time (scene seconds at the journal patch), like `rewriteBirthAtRef`
// — stage membership is presentation, so a presentation clock is the honest
// one for it.
//
// Frame-loop lifetime: both halves (stamping from the display journal and
// reaping expired holds) run inside `useSimFrame`, so a hidden tab — no
// frames, frozen sim clock — neither stamps nor reaps. It needs none of the
// wall-clock bridging `fabricHiddenReap` does for the effect-fed fabric: the
// first visible frame sees one bulk churn, itself capped by `EXIT_HOLD_MAX`,
// and a fade frozen mid-flight resumes for the observer who returns to it.

import type { Cell } from '@cknerv/types';
import { BLOCK_HIGHLIGHT_DELAY_S } from '../ui/topologyConstants';
import {
  BIRTH_DURATION_MS,
  DEATH_DURATION_MS,
  EXIT_FADE_MS,
  EXIT_HOLD_MAX,
} from './cellPositions';

/** "Always on": the enter ramp has long since completed. */
export const ENTER_STAMP_SENTINEL = -1e9;
/** "Not exiting": the exit ramp has not started and never will. */
export const EXIT_STAMP_SENTINEL = 1e9;
/** "Alive": the same convention `writeCellBuffers` has always used. */
export const DEATH_STAMP_SENTINEL = 1e9;

export interface CellLifecycleSceneTimes {
  /** Scene second the birth gesture starts. */
  bornAtS: number;
  /** Scene second the withering starts, or `DEATH_STAMP_SENTINEL` while
   * the record is alive. */
  deathAtS: number;
}

/**
 * The one arithmetic that turns a chain record into the shader's lifecycle
 * clock. Every chain event is offset by the pulse-departure delay so a cell
 * reacts when its block's packet reaches it, never when the block was mined.
 * `bornAtOverride` is the receipt-time replacement used for canonical rewrite
 * arrivals, which carry historical timestamps they must not be drawn at.
 */
export function cellLifecycleSceneTimes(
  cell: Pick<Cell, 'born_at_ms' | 'death_at_ms'>,
  toSceneSeconds: (ms: number) => number,
  bornAtOverride?: number,
): CellLifecycleSceneTimes {
  return {
    bornAtS: bornAtOverride
      ?? toSceneSeconds(cell.born_at_ms) + BLOCK_HIGHLIGHT_DELAY_S,
    deathAtS: cell.death_at_ms === null
      ? DEATH_STAMP_SENTINEL
      : toSceneSeconds(cell.death_at_ms) + BLOCK_HIGHLIGHT_DELAY_S,
  };
}

/** One cell still drawn after its stage departure, for as long as its fade
 * lasts. */
export interface CellExitHold {
  id: number;
  /** The record as last drawn, refreshed from the cache while the fade runs
   * so a death landing mid-exit still withers. */
  cell: Cell;
  /** Scene second the fade ends and the slot may be reused. */
  freeAtS: number;
}

export interface CellLifecycleStampState {
  /** id → scene-second enter stamp. Absent = `ENTER_STAMP_SENTINEL`. */
  enterAt: Map<number, number>;
  /** id → scene-second exit stamp. Absent = `EXIT_STAMP_SENTINEL`. */
  exitAt: Map<number, number>;
  /** Exit fades in arrival order. One fixed window means arrival order IS
   * expiry order, so the head is always the next slot to come free. */
  holds: CellExitHold[];
  /** Read cursor into `holds`; everything before it is already freed. */
  head: number;
  /** Exits that never got their fade because the hold segment was full. */
  overflowed: number;
}

export function createCellLifecycleStampState(): CellLifecycleStampState {
  return {
    enterAt: new Map(),
    exitAt: new Map(),
    holds: [],
    head: 0,
    overflowed: 0,
  };
}

/** Live (unfreed) holds. */
export function cellExitHoldCount(state: CellLifecycleStampState): number {
  return state.holds.length - state.head;
}

/** Reclaim the consumed prefix once it dominates the array. */
function compactCellExitHolds(state: CellLifecycleStampState): void {
  if (state.head > 256 && state.head * 2 > state.holds.length) {
    state.holds = state.holds.slice(state.head);
    state.head = 0;
  }
}

/** Drop one live hold by id. Live holds are bounded by `EXIT_HOLD_MAX` and
 * cancellations are rare, so a linear scan beats maintaining a second index. */
function removeCellExitHold(
  state: CellLifecycleStampState,
  id: number,
): boolean {
  for (let index = state.head; index < state.holds.length; index += 1) {
    if (state.holds[index].id !== id) continue;
    state.holds.splice(index, 1);
    return true;
  }
  return false;
}

/** What the stamping rules need to know about one id, resolved by the caller
 * against the same clock the buffers are written with. */
export interface CellLifecycleRecord {
  cell: Cell;
  times: CellLifecycleSceneTimes;
}

export interface CellLifecycleSyncInput {
  /** Net stage entrants this sync (absent from the drawn stage before it). */
  entered: readonly number[];
  /** Net stage departures this sync. */
  exited: readonly number[];
  nowS: number;
  /** The record behind an id, or null when nothing is left to draw. */
  resolve: (id: number) => CellLifecycleRecord | null;
  /** True while another drawn segment (the D4 overlay pool) already shows the
   * id. Null when no such segment exists — the resting case, which skips the
   * hold walk entirely. */
  drawnElsewhere?: ((id: number) => boolean) | null;
  birthDurS?: number;
  exitFadeS?: number;
  deathDurS?: number;
}

export interface CellLifecycleSyncResult {
  /** Ids whose exit stamp (`aStageAt.y`) changed while KEEPING their slot. A
   * membership sync cannot see these — the slot's occupant did not change —
   * so the caller uploads them explicitly. */
  exitStampIds: number[];
  /** Entrants that got a fade (the rest were already born or already drawn). */
  entered: number;
  held: number;
  /** Departures whose slot frees at once: withering already finished, or no
   * record left to draw. Exactly the behaviour that predates this module. */
  freedImmediately: number;
  /** Fades cancelled because the cell came back before they ended. */
  cancelled: number;
}

/**
 * Apply one membership diff to the stamps.
 *
 * Precedence, in the order the rules bind:
 * - a departure another segment still draws is not a departure;
 * - withering outranks exit — a finished corpse frees at once;
 * - a return during the fade cancels it, and earns no entrance, because the
 *   cell never fully left;
 * - a cell inside its own birth window keeps the growth gesture exclusively.
 */
export function syncCellLifecycleStamps(
  state: CellLifecycleStampState,
  input: CellLifecycleSyncInput,
): CellLifecycleSyncResult {
  const {
    entered,
    exited,
    nowS,
    resolve,
    drawnElsewhere = null,
    birthDurS = BIRTH_DURATION_MS / 1000,
    exitFadeS = EXIT_FADE_MS / 1000,
    deathDurS = DEATH_DURATION_MS / 1000,
  } = input;
  const result: CellLifecycleSyncResult = {
    exitStampIds: [],
    entered: 0,
    held: 0,
    freedImmediately: 0,
    cancelled: 0,
  };

  for (const id of exited) {
    if (drawnElsewhere?.(id)) continue;
    const record = resolve(id);
    if (record === null || nowS >= record.times.deathAtS + deathDurS) {
      state.enterAt.delete(id);
      result.freedImmediately += 1;
      continue;
    }
    state.holds.push({ id, cell: record.cell, freeAtS: nowS + exitFadeS });
    state.exitAt.set(id, nowS);
    // An enter stamp is deliberately kept: a cell that leaves mid-entrance
    // fades out from wherever its arrival got to, instead of snapping to
    // full presence first.
    result.exitStampIds.push(id);
    result.held += 1;
  }

  for (const id of entered) {
    if (removeCellExitHold(state, id)) {
      state.exitAt.delete(id);
      result.exitStampIds.push(id);
      result.cancelled += 1;
      continue;
    }
    if (drawnElsewhere?.(id)) continue;
    const record = resolve(id);
    // Delete before set: re-inserting an existing key keeps its ORIGINAL
    // position, and the prune below depends on insertion order being
    // expiry order.
    state.enterAt.delete(id);
    if (record === null) continue;
    if (nowS > record.times.bornAtS + birthDurS) {
      state.enterAt.set(id, nowS);
      result.entered += 1;
    }
  }

  // A held cell the overlay pool picked up (a selection landing on it) is
  // drawn twice unless its hold ends here — and it should end: the cell is
  // staying on screen, which is not what the fade means.
  if (drawnElsewhere) {
    for (let index = state.holds.length - 1; index >= state.head; index -= 1) {
      const hold = state.holds[index];
      if (!drawnElsewhere(hold.id)) continue;
      state.holds.splice(index, 1);
      state.exitAt.delete(hold.id);
      result.exitStampIds.push(hold.id);
      result.cancelled += 1;
    }
  }

  return result;
}

/**
 * Free every hold whose fade has ended. The queue is time-ordered, so a
 * resting frame costs one comparison. Returns the number freed.
 */
export function reapCellExitHolds(
  state: CellLifecycleStampState,
  nowS: number,
): number {
  let reaped = 0;
  while (
    state.head < state.holds.length
    && state.holds[state.head].freeAtS <= nowS
  ) {
    const hold = state.holds[state.head];
    state.head += 1;
    state.exitAt.delete(hold.id);
    state.enterAt.delete(hold.id);
    reaped += 1;
  }
  if (reaped > 0) compactCellExitHolds(state);
  return reaped;
}

/**
 * The exit-hold segment of the drawn list, oldest first, bounded by the slots
 * the caller has left. Holds past the bound complete INSTANTLY — oldest
 * first, counted in `overflowed` — so the drawn list can never outgrow the
 * buffers it is written into.
 */
export function takeCellExitHoldCells(
  state: CellLifecycleStampState,
  limit = EXIT_HOLD_MAX,
): Cell[] {
  const bound = Math.max(0, Math.min(EXIT_HOLD_MAX, Math.floor(limit)));
  while (cellExitHoldCount(state) > bound) {
    const dropped = state.holds[state.head];
    state.head += 1;
    state.exitAt.delete(dropped.id);
    state.enterAt.delete(dropped.id);
    state.overflowed += 1;
  }
  compactCellExitHolds(state);
  const cells: Cell[] = [];
  for (let index = state.head; index < state.holds.length; index += 1) {
    cells.push(state.holds[index].cell);
  }
  return cells;
}

/**
 * Re-resolve held records against the advancing cache. A cell that dies while
 * its exit fade runs must still wither, and the withering clock is per-slot
 * data written from the record — so the record has to keep up. Returns the
 * number of holds whose record changed.
 */
export function refreshCellExitHolds(
  state: CellLifecycleStampState,
  resolve: (id: number) => Cell | null | undefined,
): number {
  let refreshed = 0;
  for (let index = state.head; index < state.holds.length; index += 1) {
    const hold = state.holds[index];
    const cell = resolve(hold.id);
    if (!cell || cell === hold.cell) continue;
    hold.cell = cell;
    refreshed += 1;
  }
  return refreshed;
}

/**
 * Drop enter stamps whose fade is over. Every stamp shares one fixed window,
 * so Map insertion order is expiry order and the drain stops at the first
 * live entry. Stale stamps are visually inert (the ramp clamps to 1); this
 * only keeps the map from outliving the cells it describes.
 */
export function pruneCellEnterStamps(
  state: CellLifecycleStampState,
  nowS: number,
  enterFadeS: number,
): number {
  let pruned = 0;
  for (const [id, at] of state.enterAt) {
    if (at + enterFadeS > nowS) break;
    state.enterAt.delete(id);
    pruned += 1;
  }
  return pruned;
}
