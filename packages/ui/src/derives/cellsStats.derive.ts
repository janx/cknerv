import type { AssetKind, Cell, LockKind } from '@cknerv/types';

/** Per-kind bucket keys. Today the simulator emits four known tag
 *  strings; cells without a tag bucket into `'generic'`. Kept as a
 *  string union so the four-known-keys aggregate row layout stays
 *  exhaustively typed on this side, even though `Cell.tag` itself is
 *  an opaque string. */
export type CellKindKey = 'wallet' | 'dex' | 'cf' | 'ckbloom' | 'generic';

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

export function aggregateCellsStats(
  cells: Map<number, Cell>,
  totalBirths: number,
  totalDeaths: number,
): CellsStats {
  const byKind: Record<CellKindKey, number> = {
    wallet: 0,
    dex: 0,
    cf: 0,
    ckbloom: 0,
    generic: 0,
  };
  const byLock: Record<LockKind, number> = { sighash: 0, multisig: 0, acp: 0, omnilock: 0, other: 0 };
  const byAsset: Record<AssetKind, number> = { native: 0, sudt: 0, xudt: 0, dao: 0, spore: 0, other: 0 };
  let capacityShannons = 0;
  let inView = 0;
  let dataBearing = 0;
  for (const c of cells.values()) {
    if (c.death_at_ms !== null) continue;
    capacityShannons += c.capacity;
    inView += 1;
    if (c.data_hex !== '0x' && c.data_hex.length > 2) dataBearing += 1;
    byLock[c.lock_kind ?? 'other'] += 1;
    byAsset[c.asset_kind ?? 'other'] += 1;
    // Bucket unknown tag strings into `generic` so the aggregate row
    // shape stays the four-known-keys union. Today only four tag values
    // are emitted; if a future emitter introduces another tag, it
    // surfaces as `generic` until the SPA's per-tag UI is extended.
    const tag = c.tag;
    const key: CellKindKey =
      tag === 'wallet' || tag === 'dex' || tag === 'cf' || tag === 'ckbloom'
        ? tag
        : 'generic';
    byKind[key] += 1;
  }
  return {
    born: totalBirths,
    live: totalBirths - totalDeaths,
    dead: totalDeaths,
    byKind,
    capacityShannons,
    inView,
    dataBearing,
    byLock,
    byAsset,
  };
}
