// Pure diff of two cells-map snapshots into the three lifecycle events the
// living mesh reacts to. Death vs gc is derived here: a cell whose
// death_at_ms went null -> non-null really died (retract + flash); a cell
// that vanished from the map while still alive (death_at_ms null) was
// evicted by the configured Cell cap (quiet fade). An already-dead cell that later
// gc's is a no-op — its edges retracted at death.

export interface CellSnapshotEntry {
  death_at_ms: number | null;
}
export interface CellsDiff {
  born: number[];
  died: number[];
  evicted: number[];
}

export function snapshotCells(
  cells: ReadonlyMap<number, { death_at_ms: number | null }>,
): Map<number, CellSnapshotEntry> {
  const out = new Map<number, CellSnapshotEntry>();
  for (const [id, c] of cells) out.set(id, { death_at_ms: c.death_at_ms });
  return out;
}

export function diffCells(
  prev: ReadonlyMap<number, CellSnapshotEntry>,
  next: ReadonlyMap<number, { death_at_ms: number | null }>,
): CellsDiff {
  const born: number[] = [];
  const died: number[] = [];
  const evicted: number[] = [];
  for (const [id, c] of next) {
    const p = prev.get(id);
    if (p === undefined) born.push(id);
    else if (p.death_at_ms == null && c.death_at_ms != null) died.push(id);
  }
  for (const [id, p] of prev) {
    if (next.has(id)) continue;
    if (p.death_at_ms == null) evicted.push(id); // removed while alive = eviction
    // else: already dead -> edges retracted at death -> no-op
  }
  return { born, died, evicted };
}
