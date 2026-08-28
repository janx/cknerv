// The app-owned CellField — the mutable columnar mirror of the cells cache
// (P2 dual-ingest). `ingestCellsCacheIntoField` runs on every cache
// generation (bootstrap seed + each WS batch); consumers migrate onto the
// columns in P2.3. Until then the field is verified, not read.
//
// Dev affordances on `window`:
//   window.__cellFieldStats()   → sync counters + size/bytes + spot-check
//                                 mismatch counters (0 = field ≡ Map)
//   window.__cellFieldParity()  → full O(n) field⟷Map comparison of the
//                                 last ingested cache; run manually, never
//                                 on the ingest path.
import {
  cellContentEquals,
  cellFieldColumnBytes,
  cellFieldSlotOf,
  createCellField,
  materializeCellAt,
  syncCellFieldFromCache,
  type CellGalaxyCache,
} from '@cknerv/cache';
import type { Cell } from '@cknerv/types';
import {
  PERFORMANCE_PROBE_LABELS,
  beginCpuProbe,
  endCpuProbe,
} from '@cknerv/ui';

const field = createCellField(4096);

const counters = {
  syncs: 0,
  noops: 0,
  incrementals: 0,
  rebuilds: 0,
  upserts: 0,
  removals: 0,
  /** field.size ≠ cache.cells.size after a sync — must stay 0. */
  sizeMismatches: 0,
  /** Bounded per-batch spot checks whose materialized row ≠ the Map cell —
   *  must stay 0. */
  spotChecks: 0,
  spotMismatches: 0,
};

let lastCache: CellGalaxyCache | null = null;

/** The optional enums normalize to 'other' in the columns; compare against
 *  the same normalization (matches every consumer's classifier default). */
function fieldRowEqualsCell(slot: number, cell: Cell): boolean {
  return cellContentEquals(materializeCellAt(field, slot), {
    ...cell,
    lock_kind: cell.lock_kind ?? 'other',
    asset_kind: cell.asset_kind ?? 'other',
  });
}

/** Per-batch spot-check budget. Bounds verification to O(churn) with a low
 *  ceiling — the ingest path must never regress into a full-map walk. */
const SPOT_CHECK_CAP = 64;

export function ingestCellsCacheIntoField(cache: CellGalaxyCache): void {
  // The opt-in render probe's span for this ingest — every generation,
  // no-ops included, so its mean is the cost of the path as taken. Disabled,
  // the probe returns before any clock read.
  const probe = beginCpuProbe(PERFORMANCE_PROBE_LABELS.cellFieldIngest);
  try {
    ingestUnprobed(cache);
  } finally {
    endCpuProbe(probe);
  }
}

function ingestUnprobed(cache: CellGalaxyCache): void {
  const result = syncCellFieldFromCache(field, cache);
  lastCache = cache;
  counters.syncs += 1;
  if (result.mode === 'noop') {
    counters.noops += 1;
    return;
  }
  if (result.mode === 'rebuild') counters.rebuilds += 1;
  else counters.incrementals += 1;
  counters.upserts += result.upserts;
  counters.removals += result.removals;

  if (field.size !== cache.cells.size) counters.sizeMismatches += 1;
  if (result.mode === 'incremental') {
    const updated = cache.cellChanges.updated;
    const step = Math.max(1, Math.ceil(updated.length / SPOT_CHECK_CAP));
    for (let i = 0; i < updated.length; i += step) {
      const cell = cache.cells.get(updated[i]);
      if (cell === undefined) continue;
      const slot = cellFieldSlotOf(field, updated[i]);
      counters.spotChecks += 1;
      if (slot < 0 || !fieldRowEqualsCell(slot, cell)) {
        counters.spotMismatches += 1;
      }
    }
  }
}

function snapshotCellFieldStats() {
  return {
    ...counters,
    size: field.size,
    slotEnd: field.slotEnd,
    hashTableSize: field.hashKeys.length,
    columnBytes: cellFieldColumnBytes(field),
  };
}

/** Full-map parity check against the last ingested cache. O(n) — devtools
 *  only. Returns mismatched ids (empty array = exact mirror). */
function verifyCellFieldParity() {
  if (lastCache === null) return { checked: 0, missing: [], mismatched: [], extraRows: 0 };
  const missing: number[] = [];
  const mismatched: number[] = [];
  for (const [id, cell] of lastCache.cells) {
    const slot = cellFieldSlotOf(field, id);
    if (slot < 0) missing.push(id);
    else if (!fieldRowEqualsCell(slot, cell)) mismatched.push(id);
  }
  return {
    checked: lastCache.cells.size,
    missing,
    mismatched,
    extraRows: field.size - lastCache.cells.size,
  };
}

declare global {
  interface Window {
    __cellFieldStats?: typeof snapshotCellFieldStats;
    __cellFieldParity?: typeof verifyCellFieldParity;
  }
}

export function installCellFieldHook(): void {
  if (typeof window === 'undefined') return;
  window.__cellFieldStats = snapshotCellFieldStats;
  window.__cellFieldParity = verifyCellFieldParity;
}
