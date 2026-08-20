// Stage lifecycle tests: the four gestures' precedence and the deferred-free
// queue that makes an exit drawable at all. Everything here is the pure half
// of CellGalaxy's per-sync decision — the frame effect itself cannot be
// observed in jsdom, so the decisions live in this module and are tested at
// this level.

import { describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import {
  cellExitHoldCount,
  cellLifecycleSceneTimes,
  createCellLifecycleStampState,
  ENTER_STAMP_SENTINEL,
  EXIT_STAMP_SENTINEL,
  pruneCellEnterStamps,
  reapCellExitHolds,
  refreshCellExitHolds,
  syncCellLifecycleStamps,
  takeCellExitHoldCells,
  type CellLifecycleRecord,
  type CellLifecycleStampState,
} from '../../src/geometry/cellLifecycleStamps';
import {
  BIRTH_DURATION_MS,
  DEATH_DURATION_MS,
  ENTER_FADE_MS,
  EXIT_FADE_MS,
  EXIT_HOLD_MAX,
} from '../../src/geometry/cellPositions';
import {
  createCellSlotState,
  syncCellSlots,
} from '../../src/geometry/cellSlotAssignment';
import { BLOCK_HIGHLIGHT_DELAY_S } from '../../src/ui/topologyConstants';

const BIRTH_S = BIRTH_DURATION_MS / 1000;
const DEATH_S = DEATH_DURATION_MS / 1000;
const EXIT_S = EXIT_FADE_MS / 1000;
const ENTER_S = ENTER_FADE_MS / 1000;

function cell(id: number, overrides: Partial<Cell> = {}): Cell {
  return {
    id,
    born_at_ms: 0,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [id, 0, -id],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 0,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: `0x${'00'.repeat(32)}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
    ...overrides,
  };
}

/** A resolver over a fixed record set, using explicit scene times so the
 * rules are read against exact clock positions rather than a conversion. */
function resolverFor(
  records: ReadonlyMap<number, { cell: Cell; bornAtS: number; deathAtS: number }>,
): (id: number) => CellLifecycleRecord | null {
  return (id) => {
    const record = records.get(id);
    return record === undefined
      ? null
      : {
        cell: record.cell,
        times: { bornAtS: record.bornAtS, deathAtS: record.deathAtS },
      };
  };
}

function liveHoldIds(state: CellLifecycleStampState): number[] {
  return state.holds.slice(state.head).map((hold) => hold.id);
}

describe('cellLifecycleSceneTimes', () => {
  it('offsets both chain events by the pulse-departure delay', () => {
    const times = cellLifecycleSceneTimes(
      cell(1, { born_at_ms: 1000, death_at_ms: 4000 }),
      (ms) => ms / 1000,
    );
    expect(times.bornAtS).toBeCloseTo(1 + BLOCK_HIGHLIGHT_DELAY_S, 6);
    expect(times.deathAtS).toBeCloseTo(4 + BLOCK_HIGHLIGHT_DELAY_S, 6);
  });

  it('keeps a live record on the death sentinel and honours receipt birth', () => {
    const alive = cellLifecycleSceneTimes(
      cell(1, { born_at_ms: 1000 }),
      (ms) => ms / 1000,
    );
    expect(alive.deathAtS).toBe(1e9);
    // A rewrite arrival carries a historical timestamp it must not be drawn
    // at: the receipt override replaces the whole computation, delay included.
    const rewritten = cellLifecycleSceneTimes(
      cell(1, { born_at_ms: 1000 }),
      (ms) => ms / 1000,
      42,
    );
    expect(rewritten.bornAtS).toBe(42);
  });
});

describe('syncCellLifecycleStamps — entering', () => {
  it('leaves a cell inside its own birth window to the growth gesture', () => {
    const state = createCellLifecycleStampState();
    const now = 10;
    const result = syncCellLifecycleStamps(state, {
      entered: [1],
      exited: [],
      nowS: now,
      resolve: resolverFor(new Map([
        // Born a hair ago: the birth ramp is still running.
        [1, { cell: cell(1), bornAtS: now - BIRTH_S * 0.5, deathAtS: 1e9 }],
      ])),
    });
    expect(result.entered).toBe(0);
    expect(state.enterAt.has(1)).toBe(false);
  });

  it('stamps an entrant whose birth visual is already over', () => {
    const state = createCellLifecycleStampState();
    const now = 10;
    const result = syncCellLifecycleStamps(state, {
      entered: [1],
      exited: [],
      nowS: now,
      resolve: resolverFor(new Map([
        [1, { cell: cell(1), bornAtS: now - BIRTH_S - 0.001, deathAtS: 1e9 }],
      ])),
    });
    expect(result.entered).toBe(1);
    expect(state.enterAt.get(1)).toBe(now);
  });

  it('leaves a canonical rewrite arrival to its receipt-time re-entry', () => {
    const state = createCellLifecycleStampState();
    const now = 500;
    const toSceneSeconds = (ms: number) => ms / 1000;
    // Ancient chain birth, but the record arrived just now as a rewrite
    // replacement: the receipt override is what the buffers draw, so the
    // birth window is open and the entrance must stay out of it.
    const replaced = cell(1, { born_at_ms: 1000 });
    const result = syncCellLifecycleStamps(state, {
      entered: [1],
      exited: [],
      nowS: now,
      resolve: () => ({
        cell: replaced,
        times: cellLifecycleSceneTimes(replaced, toSceneSeconds, now),
      }),
    });

    expect(result.entered).toBe(0);
    expect(state.enterAt.has(1)).toBe(false);
    // Without the override the same record is an ordinary old entrant.
    expect(
      syncCellLifecycleStamps(createCellLifecycleStampState(), {
        entered: [1],
        exited: [],
        nowS: now,
        resolve: () => ({
          cell: replaced,
          times: cellLifecycleSceneTimes(replaced, toSceneSeconds),
        }),
      }).entered,
    ).toBe(1);
  });

  it('gives no entrance to a cell the overlay pool already draws', () => {
    const state = createCellLifecycleStampState();
    const result = syncCellLifecycleStamps(state, {
      entered: [1],
      exited: [],
      nowS: 10,
      resolve: resolverFor(new Map([
        [1, { cell: cell(1), bornAtS: 0, deathAtS: 1e9 }],
      ])),
      drawnElsewhere: (id) => id === 1,
    });
    expect(result.entered).toBe(0);
    expect(state.enterAt.has(1)).toBe(false);
  });
});

describe('syncCellLifecycleStamps — exiting', () => {
  it('holds an alive departure for its fade and stamps it', () => {
    const state = createCellLifecycleStampState();
    const departing = cell(1);
    const result = syncCellLifecycleStamps(state, {
      entered: [],
      exited: [1],
      nowS: 10,
      resolve: resolverFor(new Map([
        [1, { cell: departing, bornAtS: 0, deathAtS: 1e9 }],
      ])),
    });

    expect(result.held).toBe(1);
    expect(result.freedImmediately).toBe(0);
    expect(result.exitStampIds).toEqual([1]);
    expect(state.exitAt.get(1)).toBe(10);
    expect(cellExitHoldCount(state)).toBe(1);
    expect(takeCellExitHoldCells(state)).toEqual([departing]);
  });

  it('frees a corpse that finished withering before it left', () => {
    const state = createCellLifecycleStampState();
    const now = 10;
    const result = syncCellLifecycleStamps(state, {
      entered: [],
      exited: [1],
      nowS: now,
      resolve: resolverFor(new Map([
        // Withering complete: invisible either way, so the slot frees now.
        [1, { cell: cell(1), bornAtS: 0, deathAtS: now - DEATH_S }],
      ])),
    });
    expect(result.freedImmediately).toBe(1);
    expect(result.held).toBe(0);
    expect(cellExitHoldCount(state)).toBe(0);
    expect(state.exitAt.has(1)).toBe(false);
  });

  it('holds a corpse whose withering has not finished yet', () => {
    const state = createCellLifecycleStampState();
    const now = 10;
    const result = syncCellLifecycleStamps(state, {
      entered: [],
      exited: [1],
      nowS: now,
      resolve: resolverFor(new Map([
        [1, { cell: cell(1), bornAtS: 0, deathAtS: now - DEATH_S * 0.5 }],
      ])),
    });
    expect(result.held).toBe(1);
  });

  it('frees a departure the cache can no longer resolve', () => {
    const state = createCellLifecycleStampState();
    const result = syncCellLifecycleStamps(state, {
      entered: [],
      exited: [1],
      nowS: 10,
      resolve: () => null,
    });
    expect(result.freedImmediately).toBe(1);
    expect(cellExitHoldCount(state)).toBe(0);
  });

  it('is not a departure while the overlay pool still draws it', () => {
    const state = createCellLifecycleStampState();
    const result = syncCellLifecycleStamps(state, {
      entered: [],
      exited: [1],
      nowS: 10,
      resolve: resolverFor(new Map([
        [1, { cell: cell(1), bornAtS: 0, deathAtS: 1e9 }],
      ])),
      drawnElsewhere: (id) => id === 1,
    });
    expect(result.held).toBe(0);
    expect(result.freedImmediately).toBe(0);
    expect(cellExitHoldCount(state)).toBe(0);
  });

  it('keeps an interrupted entrance running while it fades out', () => {
    const state = createCellLifecycleStampState();
    const records = new Map([
      [1, { cell: cell(1), bornAtS: 0, deathAtS: 1e9 }],
    ]);
    syncCellLifecycleStamps(state, {
      entered: [1],
      exited: [],
      nowS: 10,
      resolve: resolverFor(records),
    });
    syncCellLifecycleStamps(state, {
      entered: [],
      exited: [1],
      nowS: 10 + ENTER_S * 0.5,
      resolve: resolverFor(records),
    });
    // Both stamps stand: the fade-out starts from wherever the arrival got
    // to instead of snapping to full presence first.
    expect(state.enterAt.get(1)).toBe(10);
    expect(state.exitAt.get(1)).toBe(10 + ENTER_S * 0.5);
  });
});

describe('syncCellLifecycleStamps — returning', () => {
  it('cancels the fade and grants no entrance when a cell comes back', () => {
    const state = createCellLifecycleStampState();
    const records = new Map([
      [1, { cell: cell(1), bornAtS: 0, deathAtS: 1e9 }],
    ]);
    syncCellLifecycleStamps(state, {
      entered: [],
      exited: [1],
      nowS: 10,
      resolve: resolverFor(records),
    });

    const back = syncCellLifecycleStamps(state, {
      entered: [1],
      exited: [],
      nowS: 10 + EXIT_S * 0.5,
      resolve: resolverFor(records),
    });

    expect(back.cancelled).toBe(1);
    expect(back.entered).toBe(0);
    expect(back.exitStampIds).toEqual([1]);
    expect(state.exitAt.has(1)).toBe(false);
    expect(state.enterAt.has(1)).toBe(false);
    expect(cellExitHoldCount(state)).toBe(0);
  });

  it('cancels the fade of a hold the overlay pool picked up', () => {
    const state = createCellLifecycleStampState();
    const records = new Map([
      [1, { cell: cell(1), bornAtS: 0, deathAtS: 1e9 }],
      [2, { cell: cell(2), bornAtS: 0, deathAtS: 1e9 }],
    ]);
    syncCellLifecycleStamps(state, {
      entered: [],
      exited: [1, 2],
      nowS: 10,
      resolve: resolverFor(records),
    });

    // A selection lands on 1 while it fades: it stays on screen, which is
    // not what the fade means — and drawing it twice would break the slots.
    const selected = syncCellLifecycleStamps(state, {
      entered: [],
      exited: [],
      nowS: 10.1,
      resolve: resolverFor(records),
      drawnElsewhere: (id) => id === 1,
    });

    expect(selected.cancelled).toBe(1);
    expect(selected.exitStampIds).toEqual([1]);
    expect(liveHoldIds(state)).toEqual([2]);
  });

  it('reports neither arrival nor departure for a same-sync round trip', () => {
    // The render set nets these out, so this module never sees the pair —
    // pin the contract from this side too.
    const state = createCellLifecycleStampState();
    const result = syncCellLifecycleStamps(state, {
      entered: [],
      exited: [],
      nowS: 10,
      resolve: () => null,
    });
    expect(result).toEqual({
      exitStampIds: [],
      entered: 0,
      held: 0,
      freedImmediately: 0,
      cancelled: 0,
    });
  });
});

describe('cell exit-hold queue', () => {
  function holdIds(
    state: CellLifecycleStampState,
    ids: readonly number[],
    nowS: number,
  ): void {
    syncCellLifecycleStamps(state, {
      entered: [],
      exited: ids,
      nowS,
      resolve: (id) => ({
        cell: cell(id),
        times: { bornAtS: 0, deathAtS: 1e9 },
      }),
    });
  }

  it('frees a hold exactly when its fade ends, and not before', () => {
    const state = createCellLifecycleStampState();
    holdIds(state, [1], 10);

    expect(reapCellExitHolds(state, 10 + EXIT_S - 0.001)).toBe(0);
    expect(cellExitHoldCount(state)).toBe(1);
    expect(reapCellExitHolds(state, 10 + EXIT_S)).toBe(1);
    expect(cellExitHoldCount(state)).toBe(0);
    expect(state.exitAt.size).toBe(0);
    expect(takeCellExitHoldCells(state)).toEqual([]);
  });

  it('reaps in arrival order because every fade shares one window', () => {
    const state = createCellLifecycleStampState();
    holdIds(state, [1], 10);
    holdIds(state, [2], 10.4);
    holdIds(state, [3], 10.8);

    expect(reapCellExitHolds(state, 10.4 + EXIT_S)).toBe(2);
    expect(liveHoldIds(state)).toEqual([3]);
  });

  it('completes the OLDEST fades instantly when the segment is full', () => {
    const state = createCellLifecycleStampState();
    holdIds(state, [1, 2, 3, 4], 10);

    // Only two slots left: the two newest fades keep running, and the two
    // the eye has been following longest end where they are.
    const drawn = takeCellExitHoldCells(state, 2);
    expect(drawn.map(({ id }) => id)).toEqual([3, 4]);
    expect(state.overflowed).toBe(2);
    expect(state.exitAt.has(1)).toBe(false);
    expect(state.exitAt.has(4)).toBe(true);
    expect(cellExitHoldCount(state)).toBe(2);
  });

  it('never draws more holds than the reserved ceiling', () => {
    const state = createCellLifecycleStampState();
    const bulk = Array.from({ length: EXIT_HOLD_MAX + 64 }, (_, i) => i + 1);
    holdIds(state, bulk, 10);

    const drawn = takeCellExitHoldCells(state, Number.MAX_SAFE_INTEGER);
    expect(drawn.length).toBe(EXIT_HOLD_MAX);
    expect(state.overflowed).toBe(64);
    // The newest churn survives; the ids dropped are the oldest ones.
    expect(drawn[0].id).toBe(65);
  });

  it('refreshes a held record so a death mid-fade still withers', () => {
    const state = createCellLifecycleStampState();
    holdIds(state, [1], 10);
    const dead = cell(1, { death_at_ms: 11_000 });

    expect(refreshCellExitHolds(state, (id) => (id === 1 ? dead : null))).toBe(1);
    expect(takeCellExitHoldCells(state)).toEqual([dead]);
    // The fade window itself is untouched — the two clocks run side by side.
    expect(state.holds[state.head].freeAtS).toBe(10 + EXIT_S);
    expect(state.exitAt.get(1)).toBe(10);
    // A record the cache no longer holds leaves the last drawn one in place.
    expect(refreshCellExitHolds(state, () => null)).toBe(0);
    expect(takeCellExitHoldCells(state)).toEqual([dead]);
  });

  it('keeps the drawn slot array dense across hold, expiry and refill', () => {
    const slots = createCellSlotState();
    const staged = [cell(1), cell(2), cell(3)];
    syncCellSlots(slots, staged);

    const state = createCellLifecycleStampState();
    holdIds(state, [2], 10);
    // Cell 2 left the stage and a replacement took its place, but the drawn
    // list still shows it: staged + exit-hold segment.
    const replacement = cell(4);
    const drawnDuringFade = [staged[0], staged[2], replacement]
      .concat(takeCellExitHoldCells(state));
    const duringFade = syncCellSlots(slots, drawnDuringFade);
    expect(duringFade.count).toBe(4);
    expectDenseSlots(slots, drawnDuringFade);

    reapCellExitHolds(state, 10 + EXIT_S);
    const afterFade = [staged[0], staged[2], replacement]
      .concat(takeCellExitHoldCells(state));
    const settled = syncCellSlots(slots, afterFade);
    expect(settled.count).toBe(3);
    expectDenseSlots(slots, afterFade);
  });

  function expectDenseSlots(
    slots: ReturnType<typeof createCellSlotState>,
    list: readonly Cell[],
  ): void {
    expect(slots.cells.length).toBe(list.length);
    const seen = new Set<number>();
    for (let slot = 0; slot < slots.count; slot += 1) {
      const occupant = slots.cells[slot];
      expect(seen.has(occupant.id)).toBe(false);
      seen.add(occupant.id);
      expect(slots.slotOf.get(occupant.id)).toBe(slot);
    }
    expect(seen.size).toBe(list.length);
  }
});

describe('pruneCellEnterStamps', () => {
  it('drains completed entrances off the front and stops at the first live one', () => {
    const state = createCellLifecycleStampState();
    const resolve = (id: number): CellLifecycleRecord => ({
      cell: cell(id),
      times: { bornAtS: -100, deathAtS: 1e9 },
    });
    syncCellLifecycleStamps(state, {
      entered: [1], exited: [], nowS: 10, resolve,
    });
    syncCellLifecycleStamps(state, {
      entered: [2], exited: [], nowS: 11, resolve,
    });

    expect(pruneCellEnterStamps(state, 10 + ENTER_S, ENTER_S)).toBe(1);
    expect([...state.enterAt.keys()]).toEqual([2]);
    expect(pruneCellEnterStamps(state, 11 + ENTER_S - 0.001, ENTER_S)).toBe(0);
  });

  it('re-entry reinserts at the back so insertion order stays expiry order', () => {
    const state = createCellLifecycleStampState();
    const resolve = (id: number): CellLifecycleRecord => ({
      cell: cell(id),
      times: { bornAtS: -100, deathAtS: 1e9 },
    });
    syncCellLifecycleStamps(state, {
      entered: [1, 2], exited: [], nowS: 10, resolve,
    });
    // 1 leaves, its fade completes, and it comes back later.
    syncCellLifecycleStamps(state, {
      entered: [], exited: [1], nowS: 10.1, resolve,
    });
    reapCellExitHolds(state, 10.1 + EXIT_S);
    syncCellLifecycleStamps(state, {
      entered: [1], exited: [], nowS: 20, resolve,
    });

    expect([...state.enterAt.entries()]).toEqual([[2, 10], [1, 20]]);
  });
});

describe('stage stamp sentinels', () => {
  it('mirror the death-sentinel convention on both ends', () => {
    // Absent stamp ⇒ sentinel ⇒ the shader ramp reads fully-on / never-out.
    expect(ENTER_STAMP_SENTINEL).toBe(-1e9);
    expect(EXIT_STAMP_SENTINEL).toBe(1e9);
    expect(EXIT_HOLD_MAX).toBeGreaterThan(0);
  });
});
