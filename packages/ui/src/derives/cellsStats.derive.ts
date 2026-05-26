import type { Cell } from '@cknerv/types';

/** Per-kind bucket keys. Today the simulator emits four known tag
 *  strings; cells without a tag bucket into `'generic'`. Kept as a
 *  string union so the four-known-keys aggregate row layout stays
 *  exhaustively typed on this side, even though `Cell.tag` itself is
 *  an opaque string. */
export type CellKindKey = 'wallet' | 'dex' | 'cf' | 'ckbloom' | 'generic';

export interface CellsStats {
  /** Cumulative cells ever-born on chain. From the backend's authoritative
   *  counter, unaffected by CELL_CAP eviction or local GC. */
  born: number;
  /** Cells alive on chain right now (`born - dead`). May exceed the size of
   *  the local `cells` map when the backend has capped its projection. */
  live: number;
  /** Cumulative real chain deaths. CELL_CAP evictions are excluded — those
   *  cells are still alive on chain. */
  dead: number;
  /** Per-kind breakdown of cells *currently in the galaxy view* (i.e. alive
   *  in the local cache). This stays a galaxy-view stat: with CELL_CAP=5000
   *  it may understate true on-chain per-kind counts, but no per-kind chain
   *  counter exists yet and the panel uses this for visual decomposition,
   *  not for chain accounting. */
  byKind: Record<CellKindKey, number>;
  /** Sum of `capacity` over locally-alive cells (galaxy-view, see byKind). */
  capacityShannons: number;
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
  let capacityShannons = 0;
  for (const c of cells.values()) {
    if (c.death_at_ms !== null) continue;
    capacityShannons += c.capacity;
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
  };
}
