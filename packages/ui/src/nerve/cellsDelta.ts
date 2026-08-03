// Pure diff of two cells-map snapshots into the three lifecycle events the
// living mesh reacts to. Death vs gc is derived here: a cell whose
// death_at_ms went null -> non-null really died (retract + flash); a cell
// that vanished from the map while still alive (death_at_ms null) was
// evicted by the configured Cell cap (quiet fade). An already-dead cell that later
// gc's is a no-op — its edges retracted at death.

/** The snapshot needs only lifecycle state; storing the scalar directly avoids
 * allocating one wrapper object for every retained Cell on each membership
 * update. */
export type CellSnapshotEntry = number | null;
export interface CellsDiff {
  born: number[];
  died: number[];
  evicted: number[];
}

export function snapshotCells(
  cells: ReadonlyMap<number, { death_at_ms: number | null }>,
): Map<number, CellSnapshotEntry> {
  const out = new Map<number, CellSnapshotEntry>();
  for (const [id, c] of cells) out.set(id, c.death_at_ms);
  return out;
}

export interface CellsDiffSnapshot {
  diff: CellsDiff;
  snapshot: Map<number, CellSnapshotEntry>;
}

/** Diff and capture the next scalar snapshot in the same pass. */
export function diffAndSnapshotCells(
  prev: ReadonlyMap<number, CellSnapshotEntry>,
  next: ReadonlyMap<number, { death_at_ms: number | null }>,
): CellsDiffSnapshot {
  const born: number[] = [];
  const died: number[] = [];
  const evicted: number[] = [];
  const snapshot = new Map<number, CellSnapshotEntry>();
  for (const [id, cell] of next) {
    const deathAt = cell.death_at_ms;
    snapshot.set(id, deathAt);
    if (!prev.has(id)) born.push(id);
    else if (prev.get(id) === null && deathAt !== null) died.push(id);
  }
  for (const [id, previousDeathAt] of prev) {
    if (next.has(id)) continue;
    if (previousDeathAt === null) evicted.push(id);
  }
  return { diff: { born, died, evicted }, snapshot };
}

export function diffCells(
  prev: ReadonlyMap<number, CellSnapshotEntry>,
  next: ReadonlyMap<number, { death_at_ms: number | null }>,
): CellsDiff {
  return diffAndSnapshotCells(prev, next).diff;
}
