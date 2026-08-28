import type {
  ActivityFeedRecord,
  AssetEcosystemRecord,
  CellSemanticRecord,
  ChainCensus,
  DaoStateRecord,
  EnrichmentSourceStatus,
  ForkWatchRecord,
  NetworkAtlasRecord,
  NetworkRosterRecord,
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
  /** The bounded set of crawler-known nodes the scene may stage. Null means
   *  no crawler roster at all; a record whose `entries` are empty is a crawl
   *  round that finished knowing nobody — a report, and a different thing. */
  networkRoster: NetworkRosterRecord | null;
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
    networkRoster: null,
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
    networkRoster: snapshot.network_roster ?? null,
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
// DELIBERATELY UNGUARDED: the eight records whose HUD derives read the
// anchor itself (assetEcosystem, activityFeed, networkAtlas, daoState,
// forkWatch, protocolEra, transactionHorizon — `nowMs -
// record.updated_at_ms` as a staleness signal — and census, whose panel
// PRINTS `AS OF #<block>` beside a whole-chain count). For the seven, a
// frozen anchor would misreport "healthy poll, unchanged content" as STALE
// on any content plateau (fork watch sits unchanged for hours), and it
// would erase the one user-visible signal of a per-capability refresh
// outage. For the census, a frozen anchor would keep printing an old block
// height under a count the source just re-proved at a newer one — the
// dashboard would understate its own freshness in the one place it makes
// an explicit claim about it. Guard one of them only after its derive
// stops reading the anchor.
//
// Cost trade-off: the records still guarded are tiny — cell/transaction
// records are single rows — so one generic recursive comparison per
// refresh is negligible and stays correct as record shapes evolve.

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

// ── Retention caps (client-side defense only) ───────────────────────────
//
// The server already bounds what it can ever ship: `SemanticsProjection`
// (`crates/cknerv-core/src/enrichment.rs:811-812`) holds `cell_cap: 512` /
// `transaction_cap: 2048` and evicts past them oldest-first by insert
// sequence (`enforce_cell_cap` / `enforce_transaction_cap`). The only route
// past those numbers is a server bug or a host that is not cknerv, so the
// caps below are pure defense at 4× the server figures: high enough that a
// healthy stream never reaches them, low enough that an endless run of
// unmatched upserts degrades by dropping the oldest instead of growing the
// tab's heap without bound.
//
// A snapshot that arrives already over a cap is left alone — its records
// were resident the moment the frame parsed — and the first delta batch that
// writes the map brings it back under.
export const MAX_RETAINED_CELLS = 2_048;
export const MAX_RETAINED_TRANSACTIONS = 8_192;

/** One batch's copy-on-write scratch. `value` starts as the caller's cache
 *  and becomes a shallow copy the first time an arm writes; each Map is
 *  copied at most once per batch however many deltas touch it. No-op arms
 *  write nothing, so a batch of only no-op deltas leaves `owned` false and
 *  the caller gets `prev` back — the identity the refresh-dedup contract
 *  above depends on. */
interface SemanticsDraft {
  value: SemanticsCache;
  owned: boolean;
  cellsOwned: boolean;
  transactionsOwned: boolean;
}

function createDraft(prev: SemanticsCache): SemanticsDraft {
  return { value: prev, owned: false, cellsOwned: false, transactionsOwned: false };
}

function writable(draft: SemanticsDraft): SemanticsCache {
  if (!draft.owned) {
    draft.value = { ...draft.value };
    draft.owned = true;
  }
  return draft.value;
}

function writableCells(draft: SemanticsDraft): Map<string, CellSemanticRecord> {
  const value = writable(draft);
  if (!draft.cellsOwned) {
    value.cells = new Map(value.cells);
    draft.cellsOwned = true;
  }
  return value.cells;
}

function writableTransactions(
  draft: SemanticsDraft,
): Map<string, TransactionSemanticRecord> {
  const value = writable(draft);
  if (!draft.transactionsOwned) {
    value.transactions = new Map(value.transactions);
    draft.transactionsOwned = true;
  }
  return value.transactions;
}

/** Drop oldest-inserted keys until the map fits. Map iteration is insertion
 *  order and `set` on an existing key does not reorder it, so this evicts in
 *  the same order the server's sequence-keyed sweep would. Only ever called
 *  on a Map this batch owns. */
function evictOldest<V>(map: Map<string, V>, cap: number): void {
  const keys = map.keys();
  while (map.size > cap) {
    const oldest = keys.next();
    if (oldest.done === true) return;
    map.delete(oldest.value);
  }
}

/** Applied once per batch, and only to a Map this batch wrote: an untouched
 *  Map cannot have grown, so checking it would be the one thing able to turn
 *  a no-op batch into a fresh cache identity. */
function enforceRetentionCaps(draft: SemanticsDraft): void {
  if (draft.cellsOwned && draft.value.cells.size > MAX_RETAINED_CELLS) {
    evictOldest(draft.value.cells, MAX_RETAINED_CELLS);
  }
  if (
    draft.transactionsOwned
    && draft.value.transactions.size > MAX_RETAINED_TRANSACTIONS
  ) {
    evictOldest(draft.value.transactions, MAX_RETAINED_TRANSACTIONS);
  }
}

function reduceDelta(draft: SemanticsDraft, delta: SemanticsDelta): void {
  switch (delta.type) {
    case 'source_status':
      // `EnrichmentSourceStatus` carries no anchor keys, so this guard is a
      // plain deep equality: `last_success_at_ms` and the tip/lag fields are
      // liveness content, and any change still replaces. Only a literal
      // re-broadcast of an identical status is dropped.
      if (deepEqualsIgnoringAnchors(draft.value.source, delta.source)) return;
      writable(draft).source = delta.source;
      return;
    case 'cell_upsert': {
      const key = outPointKey(delta.cell.out_point);
      const existing = draft.value.cells.get(key);
      // Refresh re-delivery of already-retained content: keep the record
      // and the Map identity outright (no defensive copy).
      if (
        existing !== undefined
        && deepEqualsIgnoringAnchors(existing, delta.cell)
      ) {
        return;
      }
      writableCells(draft).set(key, delta.cell);
      return;
    }
    case 'cell_remove': {
      const key = outPointKey(delta.out_point);
      if (!draft.value.cells.has(key)) return;
      writableCells(draft).delete(key);
      return;
    }
    case 'transaction_upsert': {
      const existing = draft.value.transactions.get(delta.transaction.tx_hash);
      if (
        existing !== undefined
        && deepEqualsIgnoringAnchors(existing, delta.transaction)
      ) {
        return;
      }
      writableTransactions(draft).set(delta.transaction.tx_hash, delta.transaction);
      return;
    }
    case 'transaction_remove': {
      if (!draft.value.transactions.has(delta.tx_hash)) return;
      writableTransactions(draft).delete(delta.tx_hash);
      return;
    }
    // Every *_replace arm is a plain replacement — see the DELIBERATELY
    // UNGUARDED note above. `census_replace` was the one exception until the
    // population field started printing the census anchor: a re-proved count
    // at a newer block is NEW information even when the count is identical,
    // because what the record certifies is "this many, as of here".
    case 'census_replace':
      writable(draft).census = delta.census;
      return;
    case 'asset_ecosystem_replace':
      writable(draft).assetEcosystem = delta.asset_ecosystem;
      return;
    case 'dao_state_replace':
      writable(draft).daoState = delta.dao_state;
      return;
    case 'protocol_era_replace':
      writable(draft).protocolEra = delta.protocol_era;
      return;
    case 'fork_watch_replace':
      writable(draft).forkWatch = delta.fork_watch;
      return;
    case 'activity_feed_replace':
      writable(draft).activityFeed = delta.activity_feed;
      return;
    case 'transaction_horizon_replace':
      writable(draft).transactionHorizon = delta.transaction_horizon;
      return;
    case 'network_atlas_replace':
      writable(draft).networkAtlas = delta.network_atlas;
      return;
    case 'network_roster_replace':
      // The only dedup a roster gets lives on the server, which withholds a
      // crawl round it has already published (`enrichment.rs`,
      // `EnrichmentEvent::NetworkRosterReplace`) because hundreds of
      // unchanged rows would evict live deltas from the replay ring to say
      // nothing. Whatever reaches here is therefore news, and the client
      // offers no second opinion on it.
      writable(draft).networkRoster = delta.network_roster;
      return;
    case 'script_registry_replace':
      writable(draft).scriptRegistry = delta.script_registry;
      return;
    case 'network_atlas_clear':
      writable(draft).networkAtlas = null;
      return;
    case 'network_roster_clear':
      // The crawler is gone, not empty-handed: a round that finished knowing
      // nobody arrives as a replace carrying no entries and leaves the slot
      // standing. Only this arm empties it.
      writable(draft).networkRoster = null;
      return;
    case 'prune': {
      const value = writable(draft);
      value.cells = new Map(
        [...value.cells].filter(([, cell]) => cell.as_of.block < delta.from_block),
      );
      draft.cellsOwned = true;
      value.transactions = new Map(
        [...value.transactions].filter(
          ([, transaction]) =>
            transaction.block < delta.from_block
            && transaction.as_of.block < delta.from_block,
        ),
      );
      draft.transactionsOwned = true;
      if (value.census && value.census.as_of.block >= delta.from_block) {
        value.census = null;
      }
      if (
        value.assetEcosystem
        && value.assetEcosystem.as_of.block >= delta.from_block
      ) {
        value.assetEcosystem = null;
      }
      if (value.daoState && value.daoState.as_of.block >= delta.from_block) {
        value.daoState = null;
      }
      if (value.protocolEra && value.protocolEra.as_of.block >= delta.from_block) {
        value.protocolEra = null;
      }
      if (value.forkWatch && value.forkWatch.as_of.block >= delta.from_block) {
        value.forkWatch = null;
      }
      if (value.activityFeed && value.activityFeed.as_of.block >= delta.from_block) {
        value.activityFeed = null;
      }
      if (
        value.transactionHorizon
        && value.transactionHorizon.as_of.block >= delta.from_block
      ) {
        value.transactionHorizon = null;
      }
      if (value.networkAtlas && value.networkAtlas.as_of.block >= delta.from_block) {
        value.networkAtlas = null;
      }
      // A crawler's nodes outlive a reorg, but the record's claim to have
      // been observed under this chain does not — the roster drops on the
      // atlas's rule, and the server republishes the round it withheld
      // (its gate reads its own copy, which the same prune just emptied).
      if (
        value.networkRoster
        && value.networkRoster.as_of.block >= delta.from_block
      ) {
        value.networkRoster = null;
      }
      // A script's name does not depend on the tip, but the record proving it
      // came from a compatible index does. Dropped on the same rule as every
      // other anchored record, and the next refresh re-proves it — the exact
      // rule the server's prune arm applies (`enrichment.rs`
      // `Mutation::ChainReorganized`).
      if (
        value.scriptRegistry
        && value.scriptRegistry.as_of.block >= delta.from_block
      ) {
        value.scriptRegistry = null;
      }
      return;
    }
    case 'clear': {
      // Mirrors the server's `clear_records()`: every record slot empties,
      // script names included — a rebuilt source may be pointed at another
      // network, and a retained registry would name the new census's
      // identities from the old one.
      const value = writable(draft);
      value.cells = new Map();
      draft.cellsOwned = true;
      value.transactions = new Map();
      draft.transactionsOwned = true;
      value.census = null;
      value.assetEcosystem = null;
      value.daoState = null;
      value.protocolEra = null;
      value.forkWatch = null;
      value.activityFeed = null;
      value.transactionHorizon = null;
      value.networkAtlas = null;
      value.networkRoster = null;
      value.scriptRegistry = null;
      return;
    }
    default: {
      // A delta variant this build does not know (server ahead of the
      // embedded client, or a projection-only arm absent from the TS union)
      // must be a no-op — falling off the end returned `undefined` and the
      // revisioned batch path then spread it into a cache with no maps at
      // all. The `never` binding keeps a variant ADDED to the TS union a
      // compile error here rather than a silent drop.
      const _exhaustive: never = delta;
      void _exhaustive;
    }
  }
}

export function applySemanticsDelta(
  prev: SemanticsCache,
  delta: SemanticsDelta,
): SemanticsCache {
  const draft = createDraft(prev);
  reduceDelta(draft, delta);
  enforceRetentionCaps(draft);
  return draft.value;
}

export function applyRevisionedSemanticsDeltas(
  prev: SemanticsCache,
  deltas: RevisionedSemanticsDelta[],
): SemanticsCache {
  const draft = createDraft(prev);
  let revision = prev.revision;
  for (const entry of deltas) {
    reduceDelta(draft, entry.delta);
    revision = Math.max(revision, entry.revision);
  }
  enforceRetentionCaps(draft);
  // A revision-only advance still publishes a fresh cache (the stream's
  // `?since=` cursor lives in it); a batch that changed nothing at all,
  // revision included, hands back `prev` untouched.
  if (revision !== draft.value.revision) writable(draft).revision = revision;
  return draft.value;
}

/**
 * True when `next` is `prev` with only its revision moved — the batch was
 * the refresh loop re-delivering records this cache already retains (see the
 * dedup note above), and a stream may keep the cursor without publishing.
 *
 * Exact under the copy-on-write rules above: an arm that changes content goes
 * through `writable(draft)` and replaces the field it touches — the two Maps
 * are copied before any write — so a batch that left every other field's
 * identity alone wrote nothing a consumer can read. Compared key by key off
 * the cache itself rather than against a list of names, so a record slot
 * added later is covered by construction.
 */
export function semanticsCacheRevisionOnly(
  prev: SemanticsCache,
  next: SemanticsCache,
): boolean {
  if (next === prev) return false;
  for (const key of Object.keys(next) as Array<keyof SemanticsCache>) {
    if (key === 'revision') continue;
    if (next[key] !== prev[key]) return false;
  }
  return true;
}
