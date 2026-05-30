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
