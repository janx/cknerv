// Frontend cache for the cell-galaxy projection.
//
// Mirrors the Rust `CellGalaxy` projection's wire shape (from
// `cknerv-core::projection::cells`). The cache holds the live cell set;
// `applyCellDelta` mutates it via Birth/Death/Tag/Gc/Pulse/Stats/Link.
// `fromCellsSnapshot()` hydrates from a snapshot frame.

import type {
  Cell,
  CellDelta,
  CellGalaxySnapshot,
  CellLink,
  CellLinkRecord,
  RevisionedCellDelta,
} from '@cknerv/types';

/** FIFO retention for nerve-pulse causal edges. Pulses live ~0.8 s on
 *  the GPU, so 128 entries is plenty even at burst rates of ~150 tx/s. */
const LINK_RING_CAPACITY = 128;

export interface CellGalaxyCache {
  revision: number;
  /** Map keyed by cell.id for O(1) lookup. Iteration order matches insertion
   *  order, which the visual layer relies on (newest cells last → tag-newest
   *  semantics). */
  cells: Map<number, Cell>;
  lastPulseAtMs: number;
  /** Recent causal edges (input cells → output cells of one tx). FIFO,
   *  capped at LINK_RING_CAPACITY. NervePulses tracks its own consumed-up-to
   *  seq cursor and processes anything with a higher seq. */
  recentLinks: CellLink[];
  /** Monotonic seq assigned to the most recent link. 0 = no link yet. */
  linksSeq: number;
  /** Cumulative on-chain counters mirrored from the backend. CellsHud reads
   *  these for its TOTAL / DEAD / ALIVE rows so the panel reflects chain
   *  reality rather than what's currently rendered in the galaxy. */
  totalBirths: number;
  totalDeaths: number;
}

export function emptyCellsCache(): CellGalaxyCache {
  return {
    revision: 0,
    cells: new Map(),
    lastPulseAtMs: 0,
    recentLinks: [],
    linksSeq: 0,
    totalBirths: 0,
    totalDeaths: 0,
  };
}

export function fromCellsSnapshot(
  rev: number,
  snap: CellGalaxySnapshot,
): CellGalaxyCache {
  const cells = new Map<number, Cell>();
  for (const c of snap.cells) cells.set(c.id, c);
  // Hydrate recentLinks from the snapshot's historical link records,
  // assigning sequential seq numbers in chronological order. The
  // backend ships these so the frontend tx DAG can be reconstructed
  // on first paint without orphaning cells alive at page load.
  const records: CellLinkRecord[] = snap.recent_links ?? [];
  const sorted = [...records].sort((a, b) => a.at_ms - b.at_ms);
  const recentLinks: CellLink[] = sorted.map((r, i) => ({
    seq: i + 1,
    tx_hash: r.tx_hash,
    block: r.block,
    from_ids: r.from_ids,
    to_ids: r.to_ids,
    parents: r.parents,
    tag: r.tag,
    at_ms: r.at_ms,
  }));
  return {
    revision: rev,
    cells,
    lastPulseAtMs: snap.last_pulse_at_ms,
    recentLinks,
    linksSeq: recentLinks.length,
    totalBirths: snap.total_births ?? 0,
    totalDeaths: snap.total_deaths ?? 0,
  };
}

/** Apply a single delta to a cells cache. **Pure**; returns a new cache. */
export function applyCellDelta(
  prev: CellGalaxyCache,
  d: CellDelta,
): CellGalaxyCache {
  switch (d.type) {
    case 'birth': {
      const cells = new Map(prev.cells);
      cells.set(d.cell.id, d.cell);
      return { ...prev, cells };
    }
    case 'death': {
      const existing = prev.cells.get(d.id);
      if (!existing) return prev;
      const cells = new Map(prev.cells);
      cells.set(d.id, { ...existing, death_at_ms: d.at_ms });
      return { ...prev, cells };
    }
    case 'tag': {
      const existing = prev.cells.get(d.id);
      if (!existing) return prev;
      const cells = new Map(prev.cells);
      cells.set(d.id, { ...existing, tag: d.tag });
      return { ...prev, cells };
    }
    case 'gc': {
      const cells = new Map(prev.cells);
      for (const id of d.ids) cells.delete(id);
      return { ...prev, cells };
    }
    case 'pulse': {
      return { ...prev, lastPulseAtMs: d.at_ms };
    }
    case 'stats': {
      return {
        ...prev,
        totalBirths: d.total_births,
        totalDeaths: d.total_deaths,
      };
    }
    case 'link': {
      const nextSeq = prev.linksSeq + 1;
      const link: CellLink = {
        seq: nextSeq,
        tx_hash: d.tx_hash,
        block: d.block,
        from_ids: d.from_ids,
        to_ids: d.to_ids,
        parents: d.parents,
        tag: d.tag,
        at_ms: d.at_ms,
      };
      const recentLinks =
        prev.recentLinks.length >= LINK_RING_CAPACITY
          ? [...prev.recentLinks.slice(1), link]
          : [...prev.recentLinks, link];
      return { ...prev, recentLinks, linksSeq: nextSeq };
    }
    default: {
      const _exhaustive: never = d;
      void _exhaustive;
      return prev;
    }
  }
}

export function applyRevisionedCellDeltas(
  prev: CellGalaxyCache,
  deltas: RevisionedCellDelta[],
): CellGalaxyCache {
  let next = prev;
  let maxRev = prev.revision;
  for (const rd of deltas) {
    next = applyCellDelta(next, rd.delta);
    if (rd.revision > maxRev) maxRev = rd.revision;
  }
  if (maxRev !== prev.revision) {
    next = { ...next, revision: maxRev };
  }
  return next;
}
