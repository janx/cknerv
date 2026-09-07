// The gate on the CellField mirror.
//
// The mirror is the client half of the P2 columnar plane and it is verified,
// not read — nothing in the product consumes a column until the P2.3 consumer
// migration lands. Every cache generation used to pay for it anyway: a sync
// into a second copy of every cell's columns, up to 64 materialised
// spot-checks, and a retained previous cache. What is pinned here is that an
// ordinary page pays none of it, and that the page that VERIFIES the migration
// still gets everything it had.
import { afterEach, describe, expect, it } from 'vitest';
import type { Cell } from '@cknerv/types';
import { applyCellDelta, emptyCellsCache } from '@cknerv/cache';

import {
  ingestCellsCacheIntoField,
  installCellFieldHook,
  resetCellFieldHookForTest,
  snapshotCellFieldStats,
} from '../src/cell-field-hook';

function cell(id: number): Cell {
  return {
    id,
    born_at_ms: 1_000 + id,
    death_at_ms: null,
    birth_block: 1,
    tag: null,
    pos_seed: [0, 0, 0],
    out_point: { tx_hash: `0xtx${id}`, index: id % 7 },
    capacity: 6_100_000_000 + id,
    data_hex: '0x',
    data_bytes: 0,
    content_hash: `0x${'00'.repeat(32)}`,
    lock_shape_seed: [1, 2],
    type_shape_seed: null,
    data_shape_seed: [3, 4],
  };
}

/** Three cells' worth of cache, the shape App hands the ingest each time the
 *  reducer publishes a generation. */
function cacheOfThree() {
  let cache = emptyCellsCache();
  for (const id of [1, 2, 3]) {
    cache = applyCellDelta(cache, { type: 'birth', cell: cell(id) });
  }
  return cache;
}

afterEach(() => {
  resetCellFieldHookForTest();
});

describe('the CellField mirror', () => {
  it('is not built on a page that did not ask for it', () => {
    installCellFieldHook('?quality=high');
    ingestCellsCacheIntoField(cacheOfThree());

    const stats = snapshotCellFieldStats();
    expect(stats.enabled).toBe(false);
    // Nothing synced, nothing counted, nothing allocated: the columns are
    // still the empty field the module opened with.
    expect(stats.size).toBe(0);
    expect(stats.syncs).toBe(0);
    expect(stats.spotChecks).toBe(0);
    // And no devtools surface, because there is nothing behind it to read.
    expect(window.__cellFieldStats).toBeUndefined();
    expect(window.__cellFieldParity).toBeUndefined();
  });

  it('is not built on a page that installs no hook at all', () => {
    // A review Lab, or any entry point that never calls the installer: the
    // flag's default has to be off rather than "whatever the last page said".
    ingestCellsCacheIntoField(cacheOfThree());
    expect(snapshotCellFieldStats()).toMatchObject({ enabled: false, size: 0, syncs: 0 });
  });

  it('mirrors every generation under ?dev=1, and publishes the readings', () => {
    installCellFieldHook('?dev=1');
    const cache = cacheOfThree();
    ingestCellsCacheIntoField(cache);

    const stats = snapshotCellFieldStats();
    expect(stats.enabled).toBe(true);
    expect(stats.size).toBe(cache.cells.size);
    expect(stats.syncs).toBe(1);
    // The mirror's whole promise, on the one generation it was given.
    expect(stats.sizeMismatches).toBe(0);
    expect(stats.spotMismatches).toBe(0);

    expect(typeof window.__cellFieldStats).toBe('function');
    expect(typeof window.__cellFieldParity).toBe('function');
    expect(window.__cellFieldStats!().size).toBe(cache.cells.size);
    expect(window.__cellFieldParity!()).toMatchObject({
      checked: cache.cells.size,
      missing: [],
      mismatched: [],
      extraRows: 0,
    });

    // A re-delivered generation is still the no-op it always was — the gate
    // did not replace the idempotence the ingest already had.
    ingestCellsCacheIntoField(cache);
    expect(snapshotCellFieldStats()).toMatchObject({ syncs: 2, noops: 1 });
  });
});
