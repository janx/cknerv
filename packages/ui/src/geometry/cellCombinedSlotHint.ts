// The journal-shaped hint for the WHOLE drawn list.
//
// The drawn list is three segments — the staged prefix, the selection
// overlay, the exit holds (`cellLifecycleStamps`) — and `syncCellSlots` will
// take a journal only for the list it is actually handed. Handing it the
// STAGED journal therefore worked on a block with births alone and was
// refused on every block with a departure, because a departure becomes a hold
// appended after the staged list: the list the journal describes and the list
// being synced were different arrays. Measured on mainnet over thirteen
// blocks (T1): the incremental path was taken ONCE, and the whole-list walk
// twenty-four times — a `slotOf.get` per drawn slot, twice a block (the
// journal frame and the reap frame 0.9 s later), at 12,000 slots.
//
// So the hint is built here, for the combined list, out of what the three
// segments already know: an id left the DRAWN list only if it is in none of
// them now, and everything each small segment carries is offered as an upsert
// (a record that did not move is a no-op on the incremental path, and the
// segments are bounded by the overlay pool and `EXIT_HOLD_MAX`).
//
// Two invariants of the segments are load-bearing and both belong to code
// that predates this module:
//   * the overlay holds the SELECTED cell only while it is off-stage
//     (`cellRenderOverlay` skips a staged id), and
//   * a hold is born from a staged departure and is cancelled the moment its
//     id re-enters the stage or the overlay picks it up
//     (`syncCellLifecycleStamps`).
// Together they mean the three segments are disjoint, and that an id which
// leaves the overlay or the holds for the STAGE is named by the journal's
// `entered` — which is how this stays O(churn) instead of asking a 12,000-id
// membership question.

import type { Cell } from '@cknerv/types';
import type { CellRenderSetUpdate } from './cellRenderSet';
import type { CellSlotIncrementalUpdate } from './cellSlotAssignment';

export interface CellCombinedSlotHintInput {
  /** The drawn list the slot assignment currently mirrors. */
  previousCombined: readonly Cell[];
  /** The three segments `previousCombined` was built from, in that order. */
  previousStaged: readonly Cell[];
  previousOverlay: readonly Cell[];
  previousHolds: readonly Cell[];
  /** …and this frame's. */
  staged: readonly Cell[];
  overlay: readonly Cell[];
  holds: readonly Cell[];
  /** The render set's journal, when it published one this frame. */
  journal: CellRenderSetUpdate | null;
}

const EMPTY_IDS: ReadonlySet<number> = new Set();

function idSet(cells: readonly Cell[]): ReadonlySet<number> {
  if (cells.length === 0) return EMPTY_IDS;
  const ids = new Set<number>();
  for (const cell of cells) ids.add(cell.id);
  return ids;
}

/**
 * The hint for this frame's drawn list, or `undefined` when the move cannot
 * be proven and the whole-list walk is the honest answer.
 *
 * Proof is two identity checks on the staged prefix — the journal's base must
 * be the array the drawn list was built from, and its result must be the
 * array it is being rebuilt from — or the prefix not having moved at all
 * (a reap frame, an overlay change: no journal exists, and none is needed).
 * Everything else is arithmetic over the churn.
 */
export function cellCombinedSlotHint(
  input: CellCombinedSlotHintInput,
): CellSlotIncrementalUpdate | undefined {
  const { journal } = input;
  const stagedStood = input.staged === input.previousStaged;
  if (!stagedStood) {
    if (journal === null) return undefined;
    if (journal.previousCells !== input.previousStaged) return undefined;
    if (journal.cells !== input.staged) return undefined;
  }

  const overlayIds = idSet(input.overlay);
  const holdIds = idSet(input.holds);
  // `entered` is the only way a cell reaches the staged prefix from one of the
  // other two segments, and it is the journal's own list.
  const enteredIds: ReadonlySet<number> = stagedStood || journal === null
    ? EMPTY_IDS
    : new Set(journal.entered);

  const removedIds: number[] = [];
  if (!stagedStood && journal !== null) {
    // A staged departure leaves the DRAWN list only if nothing else draws it:
    // usually its own hold does, which is what the fade is.
    for (const id of journal.exited) {
      if (!holdIds.has(id) && !overlayIds.has(id)) removedIds.push(id);
    }
  }
  // The two small segments are diffed directly; both are bounded (one
  // selection, `EXIT_HOLD_MAX` fades) and neither has a journal of its own.
  for (const cell of input.previousOverlay) {
    if (overlayIds.has(cell.id) || holdIds.has(cell.id) || enteredIds.has(cell.id)) continue;
    removedIds.push(cell.id);
  }
  for (const cell of input.previousHolds) {
    if (holdIds.has(cell.id) || overlayIds.has(cell.id) || enteredIds.has(cell.id)) continue;
    removedIds.push(cell.id);
  }

  // Upserts must arrive in the order the COMBINED list carries them, because
  // the incremental path fills freed slots from the end of its add list and
  // the canonical walk fills them from the end of the list's own new cells —
  // the two agree only if the order does. Staged ranges are ascending, so the
  // journal's own order is list order.
  const upserts: Cell[] = [];
  if (!stagedStood && journal !== null) {
    for (const range of journal.ranges) {
      const end = Math.min(range.start + range.count, journal.cells.length);
      for (let index = range.start; index < end; index += 1) {
        upserts.push(journal.cells[index]);
      }
    }
  }
  // Whole segments rather than their deltas: a record that is already where
  // it belongs costs the incremental path one map lookup and no write, and
  // this is how a REFRESHED hold record (a death landing mid-fade) reaches
  // the buffers without the segment having to report it.
  for (const cell of input.overlay) upserts.push(cell);
  for (const cell of input.holds) upserts.push(cell);

  return { previousCells: input.previousCombined, removedIds, upserts };
}
