import type {
  ActivityFeedRecord,
  AssetEcosystemRecord,
  Cell,
  CellSemanticRecord,
  ChainCensus,
  DaoStateRecord,
  EnrichmentSourceStatus,
  ForkWatchRecord,
  GalaxyCompositionRecord,
  NetworkAtlasRecord,
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
  galaxyComposition: GalaxyCompositionRecord | null;
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
    galaxyComposition: null,
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
    galaxyComposition: snapshot.galaxy_composition ?? null,
  };
}

// ── CellGalaxy composition identity reuse ───────────────────────────────
//
// The enrichment source re-emits `galaxy_composition_replace` on every
// refresh (~15 min) even when the composition content is unchanged. A naive
// replace hands every Cell a fresh object identity, forcing identity-keyed
// consumers downstream (WeakMap presentation caches, render-set journal,
// k-NN display graph, fabric reconcile) into a full rebuild. These helpers
// reconcile the incoming record against the previous one instead: a Cell
// whose content is unchanged keeps its old object identity, an untouched
// bucket keeps its array identity, and a content-identical record keeps the
// record identity outright — deliberately freezing the previous
// `as_of`/`updated_at_ms` freshness anchors, which stay semantically valid
// while the content they anchor is byte-identical.

/** Content equality over every `Cell` field (nested `out_point` and the
 *  `pos_seed` tuple compared element-wise; never mistake this for a
 *  reference check). */
function cellContentEquals(a: Cell, b: Cell): boolean {
  return (
    a.id === b.id
    && a.born_at_ms === b.born_at_ms
    && a.death_at_ms === b.death_at_ms
    && a.birth_block === b.birth_block
    && a.tag === b.tag
    && a.pos_seed[0] === b.pos_seed[0]
    && a.pos_seed[1] === b.pos_seed[1]
    && a.pos_seed[2] === b.pos_seed[2]
    && a.out_point.tx_hash === b.out_point.tx_hash
    && a.out_point.index === b.out_point.index
    && a.capacity === b.capacity
    && a.data_hex === b.data_hex
    && a.content_hash === b.content_hash
    && a.lock_kind === b.lock_kind
    && a.asset_kind === b.asset_kind
  );
}

/** Rebuild one composition bucket, reusing the previous Cell object for
 *  every incoming Cell whose content is unchanged. Returns the previous
 *  array itself when the whole bucket is order- and content-identical. */
function reconcileCompositionBucket(
  prevBucket: Cell[],
  nextBucket: Cell[],
  prevById: Map<number, Cell>,
): Cell[] {
  let changed = prevBucket.length !== nextBucket.length;
  const merged = new Array<Cell>(nextBucket.length);
  for (let i = 0; i < nextBucket.length; i += 1) {
    const incoming = nextBucket[i];
    const previous = prevById.get(incoming.id);
    const kept =
      previous !== undefined && cellContentEquals(previous, incoming)
        ? previous
        : incoming;
    merged[i] = kept;
    if (!changed && kept !== prevBucket[i]) changed = true;
  }
  return changed ? merged : prevBucket;
}

/** Reconcile an incoming composition against the previous one so unchanged
 *  content keeps its object identity at every level (record → bucket array
 *  → Cell). Record equality ignores the `as_of`/`updated_at_ms` freshness
 *  anchors, which advance on every refresh regardless of content. */
function reconcileGalaxyComposition(
  prev: GalaxyCompositionRecord | null,
  next: GalaxyCompositionRecord,
): GalaxyCompositionRecord {
  if (prev === null) return next;
  const prevById = new Map<number, Cell>();
  for (const bucket of [prev.dao, prev.typed, prev.plain]) {
    for (const cell of bucket) prevById.set(cell.id, cell);
  }
  const dao = reconcileCompositionBucket(prev.dao, next.dao, prevById);
  const typed = reconcileCompositionBucket(prev.typed, next.typed, prevById);
  const plain = reconcileCompositionBucket(prev.plain, next.plain, prevById);
  const contentIdentical =
    dao === prev.dao
    && typed === prev.typed
    && plain === prev.plain
    && next.source === prev.source;
  return contentIdentical ? prev : { ...next, dao, typed, plain };
}

function reduceDelta(prev: SemanticsCache, delta: SemanticsDelta): SemanticsCache {
  switch (delta.type) {
    case 'source_status':
      return { ...prev, source: delta.source };
    case 'cell_upsert': {
      const cells = new Map(prev.cells);
      cells.set(outPointKey(delta.cell.out_point), delta.cell);
      return { ...prev, cells };
    }
    case 'cell_remove': {
      if (!prev.cells.has(outPointKey(delta.out_point))) return prev;
      const cells = new Map(prev.cells);
      cells.delete(outPointKey(delta.out_point));
      return { ...prev, cells };
    }
    case 'transaction_upsert': {
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
    case 'census_replace':
      return { ...prev, census: delta.census };
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
    case 'network_atlas_clear':
      return { ...prev, networkAtlas: null };
    case 'galaxy_composition_replace': {
      const galaxyComposition = reconcileGalaxyComposition(
        prev.galaxyComposition,
        delta.galaxy_composition,
      );
      return galaxyComposition === prev.galaxyComposition
        ? prev
        : { ...prev, galaxyComposition };
    }
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
      const galaxyComposition =
        prev.galaxyComposition
        && prev.galaxyComposition.as_of.block >= delta.from_block
          ? null
          : prev.galaxyComposition;
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
        galaxyComposition,
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
        galaxyComposition: null,
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
