// O(churn) topology journal for the worker graph builders (Step B of the
// per-block O(N) elimination). The owner feeds it every cache generation;
// `consumeTopologyJournal` hands the accumulated change set to a build and
// clears SPECULATIVELY — safe because the builder packs synchronously inside
// build(), and every failure path afterwards (supersession, worker loss,
// sync fallback) funnels through the worker-session generation check into a
// full re-pack, so a lost journal can never corrupt topology.

import type { Cell } from '@cknerv/types';
import type { CellChangeSet, CellGalaxyCache } from '@cknerv/cache';

export interface TopologyJournal {
  upserts: Map<number, Cell>;
  removedIds: Set<number>;
  lastToken: object | null;
  /** True when the accumulated entries completely describe every change
   * since the last consume. Any journal-chain break clears it — the next
   * build sends a full pack and restarts the chain. */
  valid: boolean;
}

export interface TopologyJournalSnapshot {
  valid: boolean;
  upserts: ReadonlyMap<
    number,
    { id: number; pos_seed: readonly [number, number, number] }
  >;
  removedIds: Iterable<number>;
}

export function createTopologyJournal(): TopologyJournal {
  return {
    upserts: new Map(),
    removedIds: new Set(),
    lastToken: null,
    valid: false,
  };
}

/** Accumulate one cache generation. Topology cares only about LIVE
 * positions: births/revivals upsert, death transitions and map removals
 * remove. Re-feeding the same generation (StrictMode double effects) is a
 * no-op; any chain break invalidates until the next consume restarts it. */
export function feedTopologyJournal(
  journal: TopologyJournal,
  cache: {
    readonly cells: ReadonlyMap<number, Cell>;
    readonly cellsToken: object;
    readonly cellChanges: CellChangeSet;
  },
): void {
  if (cache.cellsToken === journal.lastToken) return;
  const changes = cache.cellChanges;
  if (
    changes.reset
    || journal.lastToken === null
    || changes.baseToken !== journal.lastToken
  ) {
    journal.valid = false;
    journal.upserts.clear();
    journal.removedIds.clear();
  } else {
    for (const id of changes.updated) {
      const cell = cache.cells.get(id);
      if (!cell) continue;
      if (cell.death_at_ms === null) {
        journal.upserts.set(id, cell);
        journal.removedIds.delete(id);
      } else {
        journal.removedIds.add(id);
        journal.upserts.delete(id);
      }
    }
    for (const id of changes.removed) {
      journal.removedIds.add(id);
      journal.upserts.delete(id);
    }
  }
  journal.lastToken = cache.cellsToken;
}

/** Snapshot for one build, then restart the chain (speculative clear — see
 * module docs for why every failure path stays safe). */
export function consumeTopologyJournal(
  journal: TopologyJournal,
): TopologyJournalSnapshot {
  const snapshot: TopologyJournalSnapshot = {
    valid: journal.valid,
    upserts: journal.upserts,
    removedIds: journal.removedIds,
  };
  journal.upserts = new Map();
  journal.removedIds = new Set();
  journal.valid = true;
  return snapshot;
}

/**
 * A build that packs a SUBSET of the retained map (partial display
 * coverage) replaces the worker's retained baseline with that subset;
 * generations keep chaining, so a later cache-lineage delta would silently
 * patch the wrong base. Callers must break the chain explicitly for such
 * builds. Returns undefined so it can be passed where the option is elided.
 */
export function invalidateTopologyJournal(
  journal: TopologyJournal,
): undefined {
  journal.valid = false;
  journal.upserts.clear();
  journal.removedIds.clear();
  return undefined;
}

// ── display-graph feed ──────────────────────────────────────────────────
// The display graph's membership is the server-authored display plane, so
// its journal is fed from the DISPLAY journal (entered→upserts with
// canonical-first resolved cells, exited→removes, updated→upserts) instead
// of the canonical cache journal. Chain validity spans BOTH token lineages:
// canonical updates of staged members ride batches that advance only the
// cells token, while membership patches advance only the display token.

export interface DisplayGraphJournalFeed {
  journal: TopologyJournal;
  /** True while feeding from the server display plane. A regime flip
   * (display plane appearing/disappearing across a snapshot) breaks the
   * chain — the next build sends a full pack. */
  displayPlaneActive: boolean;
  lastCellsToken: object | null;
  lastDisplayToken: object | null;
}

export function createDisplayGraphJournalFeed(): DisplayGraphJournalFeed {
  return {
    journal: createTopologyJournal(),
    displayPlaneActive: false,
    lastCellsToken: null,
    lastDisplayToken: null,
  };
}

/** Accumulate one cache generation for the display graph. Under a display
 * plane the display journal drives entries (dead members remove, live
 * members upsert); without one the canonical fallback delegates to
 * `feedTopologyJournal` — that regime's builds only chain deltas at full
 * coverage, exactly as before. Re-feeding the same generation is a no-op. */
export function feedDisplayGraphJournal(
  feed: DisplayGraphJournalFeed,
  cache: Pick<
    CellGalaxyCache,
    | 'cells'
    | 'cellsToken'
    | 'cellChanges'
    | 'displayMembers'
    | 'displayResidents'
    | 'displayBudget'
    | 'displayToken'
    | 'displayChanges'
  >,
): void {
  const displayPlaneActive = cache.displayBudget !== null;
  if (feed.displayPlaneActive !== displayPlaneActive) {
    invalidateTopologyJournal(feed.journal);
    feed.displayPlaneActive = displayPlaneActive;
    feed.lastCellsToken = null;
    feed.lastDisplayToken = null;
  }
  if (!displayPlaneActive) {
    feedTopologyJournal(feed.journal, cache);
    return;
  }

  const canonicalFresh = cache.cellsToken !== feed.lastCellsToken;
  const displayFresh = cache.displayToken !== feed.lastDisplayToken;
  if (!canonicalFresh && !displayFresh) return;
  const displayChanges = cache.displayChanges;
  const chainBroken =
    feed.lastCellsToken === null
    || cache.cellChanges.reset
    || displayChanges.reset
    || (canonicalFresh && cache.cellChanges.baseToken !== feed.lastCellsToken)
    || (displayFresh && displayChanges.baseToken !== feed.lastDisplayToken);
  if (chainBroken) {
    invalidateTopologyJournal(feed.journal);
  } else {
    const journal = feed.journal;
    for (const id of displayChanges.exited) {
      journal.removedIds.add(id);
      journal.upserts.delete(id);
    }
    const upsert = (id: number) => {
      const cell = cache.cells.get(id) ?? cache.displayResidents.get(id);
      if (!cell) return;
      if (cell.death_at_ms === null) {
        journal.upserts.set(id, cell);
        journal.removedIds.delete(id);
      } else {
        journal.removedIds.add(id);
        journal.upserts.delete(id);
      }
    };
    for (const id of displayChanges.entered) upsert(id);
    for (const id of displayChanges.updated) upsert(id);
  }
  feed.lastCellsToken = cache.cellsToken;
  feed.lastDisplayToken = cache.displayToken;
}
