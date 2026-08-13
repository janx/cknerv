// Aggregate statistics over the retained Cell map. The reducer maintains
// these incrementally (O(touched ids) per batch) via `adjustCellsStats`;
// `aggregateCellsStats` remains the reference full-scan implementation and
// the equivalence-test oracle. Moved here from @cknerv/ui's derive layer so
// the reducer can own the upkeep — the ui module re-exports for
// compatibility.

import type {
  AssetKind,
  Cell,
  CellKindKey,
  CellViewStats,
  LockKind,
} from '@cknerv/types';

/** Re-exported from `@cknerv/types`, where it moved once the SERVER took
 *  over the bucketing: the wire's `by_kind` object is keyed by exactly this
 *  union, so one definition has to bind both sides. */
export type { CellKindKey } from '@cknerv/types';

export interface CellsStats {
  /** Canonical births in the backend's current observation/rebuild window,
   *  unaffected by CELL_CAP eviction or local GC. */
  born: number;
  /** Cells still alive within the observation window (`born - dead`). May
   *  exceed the local `cells` map after backend cap eviction. */
  live: number;
  /** Real chain deaths in that observation window. CELL_CAP evictions are
   *  excluded — those cells are still alive on chain. */
  dead: number;
  /** Per-kind breakdown of cells *currently in the galaxy view* (i.e. alive
   *  in the local cache). This stays a galaxy-view stat: at the configured
   *  CELL_CAP it may understate true on-chain per-kind counts, but no per-kind chain
   *  counter exists yet and the panel uses this for visual decomposition,
   *  not for chain accounting. */
  byKind: Record<CellKindKey, number>;
  /** Sum of `capacity` over locally-alive cells (galaxy-view, see byKind). */
  capacityShannons: number;
  /** # of alive cells in the local cache — the sampled "in view" set
   *  (≤ CELL_CAP). Distinct from `live` (the observation-window count). */
  inView: number;
  /** # of in-view alive cells carrying non-empty output data (`data_hex` past `0x`). */
  dataBearing: number;
  /** Lock-script-family breakdown of in-view alive cells. A galaxy-view
   *  sample (≤ CELL_CAP), same scope as `inView`; cells lacking `lock_kind`
   *  bucket into `other`. */
  byLock: Record<LockKind, number>;
  /** Asset/type-script-family breakdown of in-view alive cells. Galaxy-view
   *  sample like `byLock`; cells lacking `asset_kind` bucket into `other`. */
  byAsset: Record<AssetKind, number>;
}

/** Bucket an opaque tag string into the exhaustive four-known-keys union. */
export function cellKindKey(tag: string | null): CellKindKey {
  return tag === 'wallet' || tag === 'dex' || tag === 'cf' || tag === 'ckbloom'
    ? tag
    : 'generic';
}

export function emptyCellsStats(totalBirths = 0, totalDeaths = 0): CellsStats {
  return {
    born: totalBirths,
    live: totalBirths - totalDeaths,
    dead: totalDeaths,
    byKind: { wallet: 0, dex: 0, cf: 0, ckbloom: 0, generic: 0 },
    capacityShannons: 0,
    inView: 0,
    dataBearing: 0,
    byLock: { sighash: 0, multisig: 0, acp: 0, omnilock: 0, other: 0 },
    byAsset: { native: 0, sudt: 0, xudt: 0, dao: 0, spore: 0, other: 0 },
  };
}

/** Small fixed-shape copy so a copy-on-write batch can mutate a draft. */
export function cloneCellsStats(stats: CellsStats): CellsStats {
  return {
    born: stats.born,
    live: stats.live,
    dead: stats.dead,
    byKind: { ...stats.byKind },
    capacityShannons: stats.capacityShannons,
    inView: stats.inView,
    dataBearing: stats.dataBearing,
    byLock: { ...stats.byLock },
    byAsset: { ...stats.byAsset },
  };
}

/** Add (`sign` +1) or remove (−1) one ALIVE cell's contribution in place. */
function addCellContribution(stats: CellsStats, cell: Cell, sign: 1 | -1): void {
  stats.capacityShannons += sign * cell.capacity;
  stats.inView += sign;
  if (cell.data_hex !== '0x' && cell.data_hex.length > 2) {
    stats.dataBearing += sign;
  }
  stats.byLock[cell.lock_kind ?? 'other'] += sign;
  stats.byAsset[cell.asset_kind ?? 'other'] += sign;
  stats.byKind[cellKindKey(cell.tag)] += sign;
}

/**
 * Replace one Cell's contribution in a mutable stats draft: `before`/`after`
 * are the cache's initial and final values for one touched id (either may be
 * absent). Dead cells contribute nothing, exactly like the reference scan's
 * `death_at_ms !== null` skip — so deaths subtract, revivals add, and GC of
 * an already-dead record is a no-op.
 */
export function adjustCellsStats(
  stats: CellsStats,
  before: Cell | undefined,
  after: Cell | undefined,
): void {
  if (before !== undefined && before.death_at_ms === null) {
    addCellContribution(stats, before, -1);
  }
  if (after !== undefined && after.death_at_ms === null) {
    addCellContribution(stats, after, 1);
  }
}

/** Adopt the server's aggregate segment as the hydration seed.
 *
 * The counters the server does NOT send — born/live/dead — come from the
 * snapshot's own `total_births`/`total_deaths`, so there is exactly one copy
 * of each number on the wire. Everything else is a rename: the wire uses the
 * Rust field names, the cache its own.
 *
 * ⚠️ Scope-independent by contract. The segment always describes the server's
 * FULL retained set, so it stays correct once the snapshot stops carrying
 * every retained row — which is the entire reason it exists. Seeding from a
 * scan of the rows that DID arrive would silently start counting the stage
 * instead of the galaxy.
 */
export function adoptCellViewStats(
  stats: CellViewStats,
  totalBirths: number,
  totalDeaths: number,
): CellsStats {
  return {
    born: totalBirths,
    live: totalBirths - totalDeaths,
    dead: totalDeaths,
    byKind: { ...stats.by_kind },
    capacityShannons: stats.capacity_shannons,
    inView: stats.in_view,
    dataBearing: stats.data_bearing,
    byLock: { ...stats.by_lock },
    byAsset: { ...stats.by_asset },
  };
}

/** Reference full-scan aggregation — the fallback hydration path for a server
 *  with no aggregate segment, and the equivalence oracle for both the
 *  reducer's incremental upkeep and the server's aggregation. */
export function aggregateCellsStats(
  cells: ReadonlyMap<number, Cell>,
  totalBirths: number,
  totalDeaths: number,
): CellsStats {
  const stats = emptyCellsStats(totalBirths, totalDeaths);
  for (const cell of cells.values()) {
    if (cell.death_at_ms !== null) continue;
    addCellContribution(stats, cell, 1);
  }
  return stats;
}
