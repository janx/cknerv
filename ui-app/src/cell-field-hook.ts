// The app-owned CellField — the mutable columnar mirror of the cells cache
// (P2 dual-ingest). Consumers migrate onto the columns in P2.3; until then the
// field is VERIFIED, NOT READ, and that is the whole of what this module is
// for.
//
// ⭐ WHICH IS WHY IT IS OFF. Scaffolding for a migration is not a feature, and
// this scaffolding is not free: every cache generation — the bootstrap seed
// and each WS batch — cost an O(churn) sync into a second copy of every cell's
// columns, up to 64 spot-check materialisations, and a retained `lastCache`
// pinning the previous generation. Cheap per batch, real per session, and paid
// by every visitor for a reading nobody was going to look at. So the mirror
// runs behind `?dev=1` — the switch the Tweaks panel already opens on — and a
// page without it does not build the field at all: `ingestCellsCacheIntoField`
// returns at its first line and the two window hooks are never installed.
// Verifying the migration means opening the page the way its verifier does.
//
// Dev affordances on `window`, installed only under `?dev=1`:
//   window.__cellFieldStats()   → sync counters + size/bytes + spot-check
//                                 mismatch counters (0 = field ≡ Map), with
//                                 `enabled` saying whether anything above it
//                                 was ever counted
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
import { hasQuerySwitch } from './render-quality';

/** Whether this page mirrors the cache at all. Settled once, by
 *  {@link installCellFieldHook}, from the URL the page opened on. False until
 *  then — including on a page that never installs the hook, which is the
 *  right default for every consumer of this module except the verifier. */
let enabled = false;

let field = createCellField(4096);

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

function zeroCounters(): void {
  counters.syncs = 0;
  counters.noops = 0;
  counters.incrementals = 0;
  counters.rebuilds = 0;
  counters.upserts = 0;
  counters.removals = 0;
  counters.sizeMismatches = 0;
  counters.spotChecks = 0;
  counters.spotMismatches = 0;
}

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
  // The gate, before the probe and before anything is counted: an ordinary
  // page pays one comparison per cache generation for a mirror it will never
  // read.
  if (!enabled) return;
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

export function snapshotCellFieldStats() {
  return {
    // Whether the mirror was built at all, first: every counter below it reads
    // zero on a page without `?dev=1`, and a zero that means "not measured" is
    // not the same reading as a zero that means "no drift".
    enabled,
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

/**
 * Decide whether this page mirrors the cache, and publish the readings if it
 * does.
 *
 * `search` is the seam a test drives the gate through; the app calls this with
 * nothing and the page's own query string answers.
 */
export function installCellFieldHook(search?: string): void {
  if (typeof window === 'undefined') return;
  enabled = hasQuerySwitch(search ?? window.location.search, 'dev');
  if (!enabled) return;
  window.__cellFieldStats = snapshotCellFieldStats;
  window.__cellFieldParity = verifyCellFieldParity;
}

/** A page decides this once, so nothing in the product rewinds it; a test that
 *  exercises both sides of the gate has to. Drops the mirror with the switch —
 *  a field carried across the flip would let an ingest that was refused be
 *  read as one that landed. */
export function resetCellFieldHookForTest(): void {
  enabled = false;
  field = createCellField(4096);
  lastCache = null;
  zeroCounters();
  if (typeof window === 'undefined') return;
  delete window.__cellFieldStats;
  delete window.__cellFieldParity;
}
