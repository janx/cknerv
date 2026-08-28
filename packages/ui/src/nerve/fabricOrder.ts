/** Canonical edge map key — the STRUCTURAL vocabulary: render order, slot
 *  ownership, reap queues, warm membership and every kill list speak it, at
 *  event rate. A string rather than a packed number because cell ids span two
 *  families (sequential-small and ~2^52) and never fit a 32-bit pack. It is
 *  deliberately absent from the per-frame hop path: building one per hop per
 *  frame cost two number→string conversions, a cons string and its flatten on
 *  every lookup (~140 B a hop, ~250 KB a storm frame) — the frame path reads
 *  the numeric two-level index below instead. */
export function fabricEdgeKey(a: number, b: number): string {
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  return `${lo}|${hi}`;
}

/** Allocation-free edge lookup for the frame loop: `lo → hi → value`, the
 *  same canonical (min, max) pair the string key spells, with no string built
 *  to ask. Ids are never packed into one number (see `fabricEdgeKey`). */
export type FabricEdgeIndex<T> = Map<number, Map<number, T>>;
export type ReadonlyFabricEdgeIndex<T> = ReadonlyMap<number, ReadonlyMap<number, T>>;

export function fabricEdgeIndexGet<T>(
  index: ReadonlyFabricEdgeIndex<T>,
  a: number,
  b: number,
): T | undefined {
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  return index.get(lo)?.get(hi);
}

export function fabricEdgeIndexSet<T>(
  index: FabricEdgeIndex<T>,
  a: number,
  b: number,
  value: T,
): void {
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  let inner = index.get(lo);
  if (inner === undefined) {
    inner = new Map<number, T>();
    index.set(lo, inner);
  }
  inner.set(hi, value);
}

/** Remove one edge; an inner map left empty goes with it, so the index never
 *  holds more first-level entries than there are edges. */
export function fabricEdgeIndexDelete<T>(
  index: FabricEdgeIndex<T>,
  a: number,
  b: number,
): boolean {
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  const inner = index.get(lo);
  if (inner === undefined) return false;
  const removed = inner.delete(hi);
  if (removed && inner.size === 0) index.delete(lo);
  return removed;
}

/** Number of edges the index holds — for the mirror test against the
 *  string-keyed state map, never for a frame path. */
export function fabricEdgeIndexSize<T>(index: ReadonlyFabricEdgeIndex<T>): number {
  let size = 0;
  for (const inner of index.values()) size += inner.size;
  return size;
}

export function orderFabricStateKeys(
  graphEdges: ReadonlyArray<{ from: number; to: number }>,
  existingKeys: Iterable<string>,
): { order: string[]; liveKeys: Set<string> } {
  const liveKeys = new Set<string>();
  const order: string[] = [];
  for (const e of graphEdges) {
    const key = fabricEdgeKey(e.from, e.to);
    if (liveKeys.has(key)) continue;
    liveKeys.add(key);
    order.push(key);
  }
  for (const key of existingKeys) {
    if (liveKeys.has(key)) continue;
    order.push(key);
  }
  return { order, liveKeys };
}

/** The lifecycle bit required to put current form ahead of fading history. */
export interface FabricRenderOrderState {
  readonly dyingAt: number | null;
}

/**
 * Restore the complete render-order invariant from the authoritative state map.
 *
 * `renderOrder` is intentionally lazy between structural walks: an in-place
 * reap leaves a tombstone, and a later admission appends. That stops ordinary
 * churn from copying the whole order, but it also means the same canonical key
 * can occur twice when an edge returns before tombstones are swept. A full walk
 * cannot consume that lazy representation directly: duplicate keys would write
 * duplicate GPU records, and insertion order may put fading afterimages ahead
 * of newly-live edges at the allocation clip boundary.
 *
 * This pass is stable inside both lifecycle groups. First occurrences already
 * present in `renderOrder` keep their relative order; states absent from the
 * lazy order append in Map iteration order. Missing-state tombstones and later
 * duplicate occurrences disappear. Every live state precedes every afterimage.
 */
export function canonicalizeFabricRenderOrder<T extends FabricRenderOrderState>(
  renderOrder: readonly string[],
  states: ReadonlyMap<string, T>,
): string[] {
  const seen = new Set<string>();
  const live: string[] = [];
  const afterimages: string[] = [];
  const append = (key: string): void => {
    if (seen.has(key)) return;
    const state = states.get(key);
    if (!state) return;
    seen.add(key);
    (state.dyingAt === null ? live : afterimages).push(key);
  };

  for (const key of renderOrder) append(key);
  for (const key of states.keys()) append(key);
  return live.concat(afterimages);
}
