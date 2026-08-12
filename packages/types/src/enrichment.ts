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
 * bounded prefix and may end in `…`; all sizes/ranges refer to the full data.
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

export interface ChainCensus {
  source: string;
  as_of: ChainAnchor;
  updated_at_ms: number;
  live_cells: number;
  total_cells?: number;
  dead_cells?: number;
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
  | { type: 'prune'; from_block: number }
  | { type: 'clear' };

export interface RevisionedSemanticsDelta {
  revision: number;
  delta: SemanticsDelta;
}
