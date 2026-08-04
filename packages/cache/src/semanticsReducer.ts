import type {
  ActivityFeedRecord,
  AssetEcosystemRecord,
  CellSemanticRecord,
  ChainCensus,
  EnrichmentSourceStatus,
  OutPoint,
  RevisionedSemanticsDelta,
  SemanticsDelta,
  SemanticsSnapshot,
  TransactionSemanticRecord,
} from '@cknerv/types';

export interface SemanticsCache {
  revision: number;
  source: EnrichmentSourceStatus;
  cells: Map<string, CellSemanticRecord>;
  transactions: Map<string, TransactionSemanticRecord>;
  census: ChainCensus | null;
  assetEcosystem: AssetEcosystemRecord | null;
  activityFeed: ActivityFeedRecord | null;
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
    activityFeed: null,
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
    activityFeed: snapshot.activity_feed ?? null,
  };
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
    case 'activity_feed_replace':
      return { ...prev, activityFeed: delta.activity_feed };
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
      const activityFeed =
        prev.activityFeed
        && prev.activityFeed.as_of.block >= delta.from_block
          ? null
          : prev.activityFeed;
      return {
        ...prev,
        cells,
        transactions,
        census,
        assetEcosystem,
        activityFeed,
      };
    }
    case 'clear':
      return {
        ...prev,
        cells: new Map(),
        transactions: new Map(),
        census: null,
        assetEcosystem: null,
        activityFeed: null,
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
