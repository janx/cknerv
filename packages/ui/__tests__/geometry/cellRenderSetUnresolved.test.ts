// A staged member with no record used to vanish in silence: the render set
// skipped it, the stage looked thinner, and nothing said so. The server now
// ships a record with every enter and the whole stage in every snapshot, so a
// member that resolves to nothing is a broken contract — it gets counted, and
// says so once.
//
// Own file: the warning is once per session, and a module registry shared
// with the rest of the render-set suite would let another test spend it.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Cell, CellGalaxySnapshot } from '@cknerv/types';
import { fromCellsSnapshot } from '@cknerv/cache';

import {
  cellRenderSetStats,
  createCellRenderSetState,
  syncCellRenderSet,
} from '../../src/geometry/cellRenderSet';

function cell(id: number): Cell {
  return {
    id,
    born_at_ms: 1000 + id,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [id, 0, 0],
    out_point: { tx_hash: `0x${id}`, index: 0 },
    capacity: 100,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: '0x' + '00'.repeat(32),
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
  };
}

function snapshotWithDisplay(
  cells: readonly Cell[],
  members: readonly number[],
): CellGalaxySnapshot {
  return {
    cells: [...cells],
    last_pulse_at_ms: 0,
    display: {
      budget: { cells: 12_000, nerve_edges: 8_000 },
      members: [...members],
      residents: [],
      provenance: { mode: 'canonical', source: null, as_of: null, updated_at_ms: 0 },
    },
  };
}

describe('cellRenderSet — a staged member with no record', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('counts it, names it once, and still renders the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Members 2 and 3 were staged by ids alone; no record ever arrived.
    const cache = fromCellsSnapshot(
      1,
      snapshotWithDisplay([cell(1)], [1, 2, 3]),
    );

    const before = cellRenderSetStats.unresolvedStagedMembers;
    const update = syncCellRenderSet(createCellRenderSetState(), cache, 12_000);

    expect(update.cells.map(({ id }) => id)).toEqual([1]);
    expect(cellRenderSetStats.unresolvedStagedMembers).toBe(before + 2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('staged member 2');
  });

  it('keeps counting after the one warning is spent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = fromCellsSnapshot(
      2,
      snapshotWithDisplay([cell(1)], [1, 4]),
    );

    const before = cellRenderSetStats.unresolvedStagedMembers;
    syncCellRenderSet(createCellRenderSetState(), cache, 12_000);

    expect(cellRenderSetStats.unresolvedStagedMembers).toBe(before + 1);
    expect(warn).not.toHaveBeenCalled();
  });
});
