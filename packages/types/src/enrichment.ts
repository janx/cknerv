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
  facets: SemanticFacet[];
}

export interface TransactionParticipantSemantic {
  address: string;
  capacity_delta?: string;
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

export interface SemanticsSnapshot {
  source: EnrichmentSourceStatus;
  cells: CellSemanticRecord[];
  transactions: TransactionSemanticRecord[];
  census?: ChainCensus;
}

export type SemanticsDelta =
  | { type: 'source_status'; source: EnrichmentSourceStatus }
  | { type: 'cell_upsert'; cell: CellSemanticRecord }
  | { type: 'cell_remove'; out_point: OutPoint }
  | { type: 'transaction_upsert'; transaction: TransactionSemanticRecord }
  | { type: 'transaction_remove'; tx_hash: string }
  | { type: 'census_replace'; census: ChainCensus }
  | { type: 'prune'; from_block: number }
  | { type: 'clear' };

export interface RevisionedSemanticsDelta {
  revision: number;
  delta: SemanticsDelta;
}
