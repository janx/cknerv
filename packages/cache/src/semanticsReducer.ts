import type {
  ActivityFeedRecord,
  AssetEcosystemRecord,
  CellSemanticRecord,
  ChainCensus,
  DaoStateRecord,
  EnrichmentSourceStatus,
  ForkWatchRecord,
  NetworkAtlasRecord,
  ScriptRegistryRecord,
  OutPoint,
  ProtocolEraRecord,
  RevisionedSemanticsDelta,
  SemanticsDelta,
  SemanticsSnapshot,
  TransactionHorizonRecord,
  TransactionSemanticRecord,
} from '@cknerv/types';

export interface SemanticsCache {
  revision: number;
  source: EnrichmentSourceStatus;
  cells: Map<string, CellSemanticRecord>;
  transactions: Map<string, TransactionSemanticRecord>;
  census: ChainCensus | null;
  assetEcosystem: AssetEcosystemRecord | null;
  daoState: DaoStateRecord | null;
  protocolEra: ProtocolEraRecord | null;
  forkWatch: ForkWatchRecord | null;
  activityFeed: ActivityFeedRecord | null;
  transactionHorizon: TransactionHorizonRecord | null;
  networkAtlas: NetworkAtlasRecord | null;
  /** Names for the script identities the cells projection's census reports.
   *  Null without a source that can name them; the panel then falls back to
   *  the handful of families cknerv pins itself. */
  scriptRegistry: ScriptRegistryRecord | null;
}

export function outPointKey(outPoint: OutPoint): string {
  return `${outPoint.tx_hash}:${outPoint.index}`;
}

export function emptySemanticsCache(): SemanticsCache {
  return {
    revision: 0,
    source: {
      source: 'none',
      status: 'disabled',
      capabilities: [],
    },
    cells: new Map(),
    transactions: new Map(),
    census: null,
    assetEcosystem: null,
    daoState: null,
    protocolEra: null,
    forkWatch: null,
    activityFeed: null,
    transactionHorizon: null,
    networkAtlas: null,
    scriptRegistry: null,
  };
}

export function fromSemanticsSnapshot(
  revision: number,
  snapshot: SemanticsSnapshot,
): SemanticsCache {
  return {
    revision,
    source: snapshot.source,
    cells: new Map(snapshot.cells.map((cell) => [outPointKey(cell.out_point), cell])),
    transactions: new Map(
      snapshot.transactions.map((transaction) => [transaction.tx_hash, transaction]),
    ),
    census: snapshot.census ?? null,
    assetEcosystem: snapshot.asset_ecosystem ?? null,
    daoState: snapshot.dao_state ?? null,
    protocolEra: snapshot.protocol_era ?? null,
    forkWatch: snapshot.fork_watch ?? null,
    activityFeed: snapshot.activity_feed ?? null,
    transactionHorizon: snapshot.transaction_horizon ?? null,
    networkAtlas: snapshot.network_atlas ?? null,
    scriptRegistry: snapshot.script_registry ?? null,
  };
}

// ── Periodic-refresh dedup for selected semantic records ────────────────
//
// The enrichment refresh loop re-emits record arms and re-upserts
// cell/transaction records whose content the cache already retains — often
// only the freshness anchors advance. A naive `{ ...prev, X: delta.X }`
// hands the record a fresh identity each time, breaking record-keyed React
// memoization downstream. Guards below return `prev` outright when the
// incoming content is unchanged, freezing the previous
// `as_of`/`updated_at_ms`.
//
// DELIBERATELY UNGUARDED: the seven records whose HUD derives read
// `nowMs - record.updated_at_ms` as a staleness signal (assetEcosystem,
// activityFeed, networkAtlas, daoState, forkWatch, protocolEra,
// transactionHorizon — see packages/ui/src/derives/*). For those, a frozen
// anchor would misreport "healthy poll, unchanged content" as STALE on any
// content plateau (fork watch sits unchanged for hours), and it would erase
// the one user-visible signal of a per-capability refresh outage. Their
// panel re-renders are cheap; dedup there buys identity nobody keys on.
// Guard one of them only after its derive stops treating `updated_at_ms`
// as a liveness clock.
//
// Cost trade-off: every record here is tiny — census is a handful of
// scalars, cell/transaction records are single rows — so one generic
// recursive comparison per refresh is negligible and stays correct as
// record shapes evolve.

/** Freshness-anchor keys skipped at every depth of the comparison.
 *  Verified against `packages/types/src/enrichment.ts`: all record
 *  types spell their anchors exactly `as_of` / `updated_at_ms`; no aliases
 *  exist. Deliberately NOT ignored (content, not freshness):
 *  `observed_at_block`, `statistics_block`, `detected_at_ms` (fork events),
 *  `timestamp_ms` (activity rows), `crawl_finished_at_s` (atlas crawl),
 *  `last_success_at_ms` (source liveness). */
const IGNORED_ANCHOR_KEYS = new Set(['as_of', 'updated_at_ms']);

/** Recursive structural equality over plain JSON wire data, skipping
 *  `IGNORED_ANCHOR_KEYS` at every depth. Arrays are order-sensitive; a key
 *  valued `undefined` counts as absent (JSON cannot carry the difference). */
export function deepEqualsIgnoringAnchors(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqualsIgnoringAnchors(a[i], b[i])) return false;
    }
    return true;
  }
  if (
    typeof a !== 'object'
    || typeof b !== 'object'
    || a === null
    || b === null
  ) {
    return false;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  for (const key of Object.keys(left)) {
    if (IGNORED_ANCHOR_KEYS.has(key)) continue;
    if (left[key] === undefined) continue;
    if (right[key] === undefined) return false;
    if (!deepEqualsIgnoringAnchors(left[key], right[key])) return false;
  }
  for (const key of Object.keys(right)) {
    if (IGNORED_ANCHOR_KEYS.has(key)) continue;
    if (right[key] !== undefined && left[key] === undefined) return false;
  }
  return true;
}

function reduceDelta(prev: SemanticsCache, delta: SemanticsDelta): SemanticsCache {
  switch (delta.type) {
    case 'source_status':
      // `EnrichmentSourceStatus` carries no anchor keys, so this guard is a
      // plain deep equality: `last_success_at_ms` and the tip/lag fields are
      // liveness content, and any change still replaces. Only a literal
      // re-broadcast of an identical status is dropped.
      return deepEqualsIgnoringAnchors(prev.source, delta.source)
        ? prev
        : { ...prev, source: delta.source };
    case 'cell_upsert': {
      const key = outPointKey(delta.cell.out_point);
      const existing = prev.cells.get(key);
      // Refresh re-delivery of already-retained content: keep the record
      // and the Map identity outright (no defensive copy).
      if (
        existing !== undefined
        && deepEqualsIgnoringAnchors(existing, delta.cell)
      ) {
        return prev;
      }
      const cells = new Map(prev.cells);
      cells.set(key, delta.cell);
      return { ...prev, cells };
    }
    case 'cell_remove': {
      if (!prev.cells.has(outPointKey(delta.out_point))) return prev;
      const cells = new Map(prev.cells);
      cells.delete(outPointKey(delta.out_point));
      return { ...prev, cells };
    }
    case 'transaction_upsert': {
      const existing = prev.transactions.get(delta.transaction.tx_hash);
      if (
        existing !== undefined
        && deepEqualsIgnoringAnchors(existing, delta.transaction)
      ) {
        return prev;
      }
      const transactions = new Map(prev.transactions);
      transactions.set(delta.transaction.tx_hash, delta.transaction);
      return { ...prev, transactions };
    }
    case 'transaction_remove': {
      if (!prev.transactions.has(delta.tx_hash)) return prev;
      const transactions = new Map(prev.transactions);
      transactions.delete(delta.tx_hash);
      return { ...prev, transactions };
    }
    // `census_replace` is the one *_replace arm with a dedup guard: no HUD
    // derive reads its `updated_at_ms`, so keeping the record identity on a
    // content-identical re-emit is free. The seven arms below it stay plain
    // replacements — see the DELIBERATELY UNGUARDED note above. A cleared
    // (null) slot never dedups: content arriving after prune/clear lands.
    case 'census_replace':
      return deepEqualsIgnoringAnchors(prev.census, delta.census)
        ? prev
        : { ...prev, census: delta.census };
    case 'asset_ecosystem_replace':
      return { ...prev, assetEcosystem: delta.asset_ecosystem };
    case 'dao_state_replace':
      return { ...prev, daoState: delta.dao_state };
    case 'protocol_era_replace':
      return { ...prev, protocolEra: delta.protocol_era };
    case 'fork_watch_replace':
      return { ...prev, forkWatch: delta.fork_watch };
    case 'activity_feed_replace':
      return { ...prev, activityFeed: delta.activity_feed };
    case 'transaction_horizon_replace':
      return { ...prev, transactionHorizon: delta.transaction_horizon };
    case 'network_atlas_replace':
      return { ...prev, networkAtlas: delta.network_atlas };
    case 'script_registry_replace':
      return { ...prev, scriptRegistry: delta.script_registry };
    case 'network_atlas_clear':
      return { ...prev, networkAtlas: null };
    case 'prune': {
      const cells = new Map(
        [...prev.cells].filter(([, cell]) => cell.as_of.block < delta.from_block),
      );
      const transactions = new Map(
        [...prev.transactions].filter(
          ([, transaction]) =>
            transaction.block < delta.from_block
            && transaction.as_of.block < delta.from_block,
        ),
      );
      const census =
        prev.census && prev.census.as_of.block >= delta.from_block
          ? null
          : prev.census;
      const assetEcosystem =
        prev.assetEcosystem
        && prev.assetEcosystem.as_of.block >= delta.from_block
          ? null
          : prev.assetEcosystem;
      const daoState =
        prev.daoState && prev.daoState.as_of.block >= delta.from_block
          ? null
          : prev.daoState;
      const protocolEra =
        prev.protocolEra && prev.protocolEra.as_of.block >= delta.from_block
          ? null
          : prev.protocolEra;
      const forkWatch =
        prev.forkWatch && prev.forkWatch.as_of.block >= delta.from_block
          ? null
          : prev.forkWatch;
      const activityFeed =
        prev.activityFeed
        && prev.activityFeed.as_of.block >= delta.from_block
          ? null
          : prev.activityFeed;
      const transactionHorizon =
        prev.transactionHorizon
        && prev.transactionHorizon.as_of.block >= delta.from_block
          ? null
          : prev.transactionHorizon;
      const networkAtlas =
        prev.networkAtlas
        && prev.networkAtlas.as_of.block >= delta.from_block
          ? null
          : prev.networkAtlas;
      return {
        ...prev,
        cells,
        transactions,
        census,
        assetEcosystem,
        daoState,
        protocolEra,
        forkWatch,
        activityFeed,
        transactionHorizon,
        networkAtlas,
      };
    }
    case 'clear':
      return {
        ...prev,
        cells: new Map(),
        transactions: new Map(),
        census: null,
        assetEcosystem: null,
        daoState: null,
        protocolEra: null,
        forkWatch: null,
        activityFeed: null,
        transactionHorizon: null,
        networkAtlas: null,
      };
  }
}

export function applySemanticsDelta(
  prev: SemanticsCache,
  delta: SemanticsDelta,
): SemanticsCache {
  return reduceDelta(prev, delta);
}

export function applyRevisionedSemanticsDeltas(
  prev: SemanticsCache,
  deltas: RevisionedSemanticsDelta[],
): SemanticsCache {
  let next = prev;
  let revision = prev.revision;
  for (const entry of deltas) {
    next = reduceDelta(next, entry.delta);
    revision = Math.max(revision, entry.revision);
  }
  return next === prev && revision === prev.revision
    ? prev
    : { ...next, revision };
}
