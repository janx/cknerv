/** Canonical edge map key. We use a string rather than a packed
 *  numeric key because cell ids in long-running sessions can exceed the
 *  2^16 bit width a comfy pack would need, and the ~3k entries ×
 *  few-hundred-millis-per-rebuild domain makes string Map performance
 *  a non-issue. */
export function fabricEdgeKey(a: number, b: number): string {
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  return `${lo}|${hi}`;
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
