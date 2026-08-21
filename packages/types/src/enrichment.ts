// Optional semantic-enrichment wire types. These mirror
// `cknerv_core::enrichment` and are deliberately separate from canonical
// Cell/transaction shapes.

import type { OutPoint } from './outpoint';

export interface ChainAnchor {
  block: number;
  hash: string;
}

export type EnrichmentSourceState =
  | 'disabled'
  | 'connecting'
  | 'syncing'
  | 'ready'
  | 'stale'
  | 'incompatible'
  | 'error';

export interface EnrichmentSourceStatus {
  source: string;
  status: EnrichmentSourceState;
  capabilities: string[];
  indexed_tip?: number;
  lag_blocks?: number;
  validated_anchor?: ChainAnchor;
  last_success_at_ms?: number;
  message?: string;
}

export interface SemanticAttribute {
  key: string;
  value: string;
  unit?: string;
}

export interface SemanticFacet {
  namespace: string;
  kind: string;
  state?: string;
  attributes: SemanticAttribute[];
}

export interface SemanticScript {
  script_hash: string;
  code_hash: string;
  hash_type: string;
  args: string;
  name?: string;
  family?: string;
  deprecated?: boolean;
}

export interface SemanticAsset {
  type_script_hash: string;
  standard?: string;
  name?: string;
  symbol?: string;
  amount?: string;
  decimals?: number;
}

export interface CommonKnowledgeBreakdown {
  total_bytes: number;
  capacity_field_bytes: number;
  lock_script_bytes: number;
  type_script_bytes: number;
  data_bytes: number;
}

/** Half-open byte range inside a deterministic interpretation. */
export interface SemanticContentSegment {
  label: string;
  start_byte: number;
  end_byte: number;
  meaning: string;
  value: string;
}

export interface SemanticContentDecode {
  kind: string;
  summary: string;
  segments: SemanticContentSegment[];
}

export interface SemanticContentGuess {
  kind: string;
  confidence: string;
  reason: string;
  mime_type?: string;
  value?: string;
}

/**
 * Display-safe evidence for the Cell's actual output data. `data_hex` is a
 * bounded prefix and may end in `DATA_HEX_TRUNCATION_MARKER`, same convention
 * as the canonical Cell; all sizes/ranges refer to the full data.
 */
export interface SemanticCellContent {
  total_bytes: number;
  data_hex?: string;
  data_complete: boolean;
  deterministic?: SemanticContentDecode;
  heuristics: SemanticContentGuess[];
}

export interface CellSemanticRecord {
  out_point: OutPoint;
  source: string;
  as_of: ChainAnchor;
  observed_at_block: number;
  updated_at_ms: number;
  address?: string;
  cell_type?: string;
  lock_script?: SemanticScript;
  type_script?: SemanticScript;
  asset?: SemanticAsset;
  common_knowledge?: CommonKnowledgeBreakdown;
  content?: SemanticCellContent;
  facets: SemanticFacet[];
}

export interface TransactionParticipantSemantic {
  address: string;
  /** Exact signed shannon delta; absent when participant attribution is partial. */
  capacity_delta?: string;
  /** Exact signed occupied-byte delta when supplied by the source. */
  common_knowledge_delta?: string;
  facets: SemanticFacet[];
}

export interface TransactionSemanticRecord {
  tx_hash: string;
  block: number;
  source: string;
  as_of: ChainAnchor;
  updated_at_ms: number;
  actions: SemanticFacet[];
  participants: TransactionParticipantSemantic[];
  fee?: string;
  cycles?: number;
}

/** Disjoint decomposition of a {@link ChainCensus}'s live count, in the same
 *  three bins the CellGalaxy composition target staffs the stage with. The
 *  three counters partition `live_cells` exactly; a source that cannot prove
 *  that partition sends no classes at all rather than an approximate one. */
export interface ChainCensusClasses {
  /** Nervos DAO cells. */
  dao: number;
  /** Cells carrying a type script that is not the DAO. */
  typed_non_dao: number;
  /** Cells with no type script. */
  plain: number;
}

export interface ChainCensus {
  source: string;
  as_of: ChainAnchor;
  updated_at_ms: number;
  live_cells: number;
  total_cells?: number;
  dead_cells?: number;
  /** Present only when the source proved the partition sums to `live_cells`.
   *  Absent is a legal state: the count stands alone. */
  classes?: ChainCensusClasses;
  /** Whole-chain twin of `CellViewStats.data_bearing` — orthogonal to
   *  `classes`, so it is never part of that partition. */
  data_bearing?: number;
}

export interface AssetEcosystemCategory {
  category: string;
  /** Exact capacity in shannons. */
  capacity_shannons: string;
  /** Share of total live capacity in basis points (`10_000 == 100%`). */
  share_bps: number;
}

export interface AssetEcosystemLeader {
  type_script_hash: string;
  name?: string;
  symbol?: string;
  holders_count: number;
  /** Exact capacity in shannons. */
  total_capacity_shannons: string;
}

export interface AssetEcosystemRecord {
  source: string;
  as_of: ChainAnchor;
  updated_at_ms: number;
  total_live_capacity_shannons: string;
  total_knowledge_bytes: number;
  capacity_breakdown: AssetEcosystemCategory[];
  top_assets: AssetEcosystemLeader[];
}

export interface DaoStateRecord {
  source: string;
  as_of: ChainAnchor;
  statistics_block: number;
  updated_at_ms: number;
  total_deposited_shannons: string;
  total_depositors: number;
  active_deposits: number;
  pending_withdrawal_shannons: string;
  unclaimed_compensation_shannons: string;
  /** Estimated annual percentage compensation in basis points. */
  estimated_apc_bps: number;
  deposit_change_24h_shannons?: string;
  depositors_change_24h?: number;
}

export interface ProtocolEra {
  name: string;
  edition_year: number;
  activation_epoch: number;
  activation_block?: number;
}

/** Fixed latest/current protocol edition context, not a resource catalogue. */
export interface ProtocolEraRecord {
  source: string;
  as_of: ChainAnchor;
  updated_at_ms: number;
  network: string;
  indexed_tip_block: number;
  indexed_tip_epoch: number;
  current?: ProtocolEra;
  upcoming?: ProtocolEra;
}

export type ForkWatchEventKind = 'reorg' | 'deep';

export interface ForkWatchReorg {
  detected_at_ms: number;
  fork_point: number;
  old_tip: number;
  new_tip: number;
  depth: number;
  orphaned_blocks: number;
  orphaned_transactions: number;
  kind: ForkWatchEventKind;
}

export interface ForkWatchDeepFork {
  detected_at_ms: number;
  fork_point: number;
  indexed_tip: number;
  chain_tip: number;
  depth: number;
}

export interface ForkWatchRecord {
  source: string;
  as_of: ChainAnchor;
  updated_at_ms: number;
  recent_window_seconds: number;
  recent_reorg?: ForkWatchReorg;
  deep_fork?: ForkWatchDeepFork;
}

export interface ActivityFeedItem {
  tx_hash: string;
  block: number;
  timestamp_ms: number;
  category: string;
  label?: string;
  participant_count: number;
}

/** Explicitly bounded newest-activity sample, not a historical census. */
export interface ActivityFeedRecord {
  source: string;
  as_of: ChainAnchor;
  updated_at_ms: number;
  activities: ActivityFeedItem[];
}

/** Bounded oldest-to-newest indexed counts; never a canonical total. */
export interface TransactionHorizonRecord {
  source: string;
  as_of: ChainAnchor;
  updated_at_ms: number;
  current_hour: number;
  current_day: number;
  hourly_counts: number[];
  daily_counts: number[];
}

export interface NetworkAtlasBucket {
  label: string;
  count: number;
}

/** Bounded latest-node sample plus the source's latest crawl summary. */
/** A name for one script identity, from an index that tracks far more script
 *  families than cknerv pins itself. The other half of the cells projection's
 *  script census: that side counts identities and refuses to name them, this
 *  side names them and counts nothing. They are joined on `code_hash` +
 *  `hash_type`, so neither has to trust the other's scope. */
export interface ScriptNameRecord {
  code_hash: string;
  hash_type: string;
  /** The family name as the index spells it — "Default Lock", "JoyID". */
  name: string;
  description?: string;
  /** `'lock'` / `'type'` when the index classifies the family's role. */
  kind?: string;
  website?: string;
  deprecated: boolean;
}

/** Names for the scripts the canonical set is currently holding — sized by
 *  what cknerv observed, not by what the index knows. */
export interface ScriptRegistryRecord {
  source: string;
  as_of: ChainAnchor;
  updated_at_ms: number;
  entries: ScriptNameRecord[];
  /** Observed identities the index had no name for. Counted, not listed: the
   *  panel already holds those code hashes from the census. */
  unresolved: number;
}

export interface NetworkAtlasRecord {
  source: string;
  as_of: ChainAnchor;
  updated_at_ms: number;
  crawl_round: number;
  crawl_finished_at_s: number;
  total_known: number;
  last_round_dialed: number;
  last_round_reachable: number;
  new_nodes: number;
  frontier_drained: boolean;
  sample_size: number;
  sample_reachable: number;
  sample_truncated: boolean;
  median_rtt_ms?: number;
  countries: NetworkAtlasBucket[];
  versions: NetworkAtlasBucket[];
}

/** How one node looked the last time an optional network crawler reached it.
 *
 * The only enrichment record that describes a network peer rather than a
 * chain object, and the only one resolved purely on demand — it never
 * arrives in the semantics snapshot or a delta. Every row drawn from it is
 * CRAWLER-class: a different vantage and a different clock from the local
 * RPC link, so it must be stamped with `last_seen_ms` rather than blended
 * into live link telemetry. */
export interface PeerSightingRecord {
  source: string;
  as_of: ChainAnchor;
  updated_at_ms: number;
  /** The base58 node id the lookup asked with — the same string the local
   * node's peer list carries. */
  node_id: string;
  country: string;
  asn: string;
  client_version: string;
  protocols: string[];
  first_seen_ms: number;
  last_seen_ms: number;
  /** Absent when the crawler has never completed a dial to this node. */
  last_reachable_at_ms?: number;
  reachable: boolean;
  rtt_ms?: number;
  known_peers_count: number;
}

/** Why a peer lookup came back without a sighting. Each one is a different
 * true statement, and none of them is a failure. */
export type PeerSightingAbsence =
  /** The configured source has no network crawler at all. */
  | 'no_crawler'
  /** The local node's id for this peer is not one the source can be keyed
   * by, so nothing was asked. */
  | 'unreadable_node_id'
  /** The source answered, and has never seen this node from outside. */
  | 'never_sighted';

/** The result of `GET /api/enrichment/peers/:node_id` when a source is
 * configured. Deliberately not `PeerSightingRecord | null`: "never seen from
 * outside" is an observation about the network, not a missing record. */
export type PeerSightingLookup =
  | { state: 'sighted'; sighting: PeerSightingRecord }
  | { state: 'unsighted'; reason: PeerSightingAbsence };

export interface SemanticsSnapshot {
  source: EnrichmentSourceStatus;
  cells: CellSemanticRecord[];
  transactions: TransactionSemanticRecord[];
  census?: ChainCensus;
  asset_ecosystem?: AssetEcosystemRecord;
  dao_state?: DaoStateRecord;
  protocol_era?: ProtocolEraRecord;
  fork_watch?: ForkWatchRecord;
  activity_feed?: ActivityFeedRecord;
  transaction_horizon?: TransactionHorizonRecord;
  network_atlas?: NetworkAtlasRecord;
  script_registry?: ScriptRegistryRecord;
}

export type SemanticsDelta =
  | { type: 'source_status'; source: EnrichmentSourceStatus }
  | { type: 'cell_upsert'; cell: CellSemanticRecord }
  | { type: 'cell_remove'; out_point: OutPoint }
  | { type: 'transaction_upsert'; transaction: TransactionSemanticRecord }
  | { type: 'transaction_remove'; tx_hash: string }
  | { type: 'census_replace'; census: ChainCensus }
  | { type: 'asset_ecosystem_replace'; asset_ecosystem: AssetEcosystemRecord }
  | { type: 'dao_state_replace'; dao_state: DaoStateRecord }
  | { type: 'protocol_era_replace'; protocol_era: ProtocolEraRecord }
  | { type: 'fork_watch_replace'; fork_watch: ForkWatchRecord }
  | { type: 'activity_feed_replace'; activity_feed: ActivityFeedRecord }
  | { type: 'transaction_horizon_replace'; transaction_horizon: TransactionHorizonRecord }
  | { type: 'network_atlas_replace'; network_atlas: NetworkAtlasRecord }
  | { type: 'network_atlas_clear' }
  | { type: 'script_registry_replace'; script_registry: ScriptRegistryRecord }
  | { type: 'prune'; from_block: number }
  | { type: 'clear' };

export interface RevisionedSemanticsDelta {
  revision: number;
  delta: SemanticsDelta;
}
