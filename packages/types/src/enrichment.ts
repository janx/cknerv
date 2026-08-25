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
  /**
   * Exact occupied capacity in shannons, from the source's stored figure
   * rather than the itemized bytes beside it. It counts script args the
   * breakdown never itemizes, so it usually EXCEEDS
   * `total_bytes * 100_000_000`; that residual is the evidence, not a
   * mismatch. Absent when the source stated none.
   */
  occupied_shannons?: string;
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

/**
 * Where a Cell's life ended, when the source reports it spent AND can name the
 * spender. Absence says only that the source did not state it: a live Cell and
 * a dead Cell whose consumer was never recorded both arrive without this.
 */
export interface SemanticCellConsumption {
  /** Transaction that spent the outpoint. */
  tx_hash: string;
  /** Block the spending transaction landed in, when the source knows it. */
  block?: number;
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
  /** Set only when the source reports the outpoint spent by a named tx. */
  consumed?: SemanticCellConsumption;
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

/** How far one of the crawler's dials got, in upstream's own vocabulary.
 *
 * An ORDINAL axis rather than a set of labels: each name is strictly further
 * through the handshake than the one before it, from a dial that never opened
 * to a peer that identified itself on this chain. The two middle rungs must
 * not be collapsed — `no_authenticated_session_before_deadline` says nothing
 * answered on the wire, and
 * `authenticated_session_without_identify_before_deadline` says something
 * answered, completed a secure handshake, and then never said who it was. To
 * an operator those are different problems with different fixes.
 *
 * `unknown` is the crawler naming a result this build has no word for; it
 * ranks lowest, so it only ever arrives alone.
 *
 * `PeerAdvertisedEvidence` is what carries it: the furthest rung one peer's
 * dials reached, which the adapter picks with a `max` over the Rust enum's own
 * ordering. Nothing on this side ranks these — a TS string union has no order
 * — so this is a set of names here and an axis only where the choosing
 * happens. */
export type PeerProbeResult =
  | 'unknown'
  | 'dial_request_failed'
  | 'no_authenticated_session_before_deadline'
  | 'authenticated_session_without_identify_before_deadline'
  | 'malformed_identify'
  | 'foreign_network'
  | 'same_network_identified';

export interface NetworkAtlasBucket {
  label: string;
  count: number;
}

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

/** Whole-network context from an optional network crawler: what the last
 * completed round reached, and what the set it holds is made of.
 *
 * Every count here carries the crawler's own field name. Three of them used to
 * be `total_known`, `last_round_attempted` and `new_nodes`, and every one of
 * those quantities was deleted at the source for blurring several separate
 * populations into one word. The replacements are not renames of a number that
 * stayed put: `verified_retained_peers` counts the peers the crawler still
 * holds a verification for, `candidate_peers` counts the peers the round
 * considered, and `new_verified_peers` counts the peers verified for the first
 * time in it. `last_round_reachable` keeps its own name because the fact under
 * it never moved.
 *
 * The four counts under `candidate_peers` are one round's outcome matrix read
 * four ways, so they are bound by arithmetic rather than merely bounded:
 * `last_round_reachable + exhausted_candidates + foreign_peers` is exactly
 * `candidate_peers`, and `last_round_reachable + verified_unavailable_peers`
 * is exactly `verified_retained_peers`. The first is what lets the panel draw
 * the three outcomes as three shares of one bar; the second is why
 * `verified_unavailable_peers` may not be a fourth share of it. That count
 * cuts ACROSS the exhausted and foreign cohorts — it is what is left verified
 * out of them — so it is the one number here that must never be added to its
 * neighbours.
 *
 * The buckets are a census, not a sample. They used to be folded out of one
 * bounded 64-row page of peers and captioned for it; upstream computes them
 * over every verified peer now, which is why `sample_size`,
 * `sample_reachable` and `sample_truncated` are gone, and why `median_rtt_ms`
 * went with them — the only number left that a bounded page could have
 * answered, and a reading of the crawler's own distance from the fleet rather
 * than of the fleet. */
export interface NetworkAtlasRecord {
  source: string;
  as_of: ChainAnchor;
  updated_at_ms: number;
  crawl_round: number;
  crawl_finished_at_s: number;
  candidate_peers: number;
  last_round_reachable: number;
  foreign_peers: number;
  exhausted_candidates: number;
  verified_unavailable_peers: number;
  verified_retained_peers: number;
  new_verified_peers: number;
  /** The peers the crawler holds an index entry for right now, and the
   * denominator every bucket below is counted against.
   *
   * It is upstream's `distributions.verifiedRetained` and it means the same
   * words as `verified_retained_peers` on a DIFFERENT CLOCK: the crawler scans
   * its node store when the request arrives, while the round reports what its
   * outcome matrix added up to when it finished. They agree whenever nothing
   * changed in between, and nothing promises that they must, so both are
   * carried and neither is ever asserted against the other. The buckets belong
   * to this one, and it is the number their caption states. */
  indexed_peers: number;
  countries: NetworkAtlasBucket[];
  versions: NetworkAtlasBucket[];
}

/** How the crawler came to know one roster node — the evidence behind the row,
 * in upstream's own gradient rather than a confidence rating.
 *
 * `reachable` is a node the crawler dialed in the last completed round and got
 * an identify out of; `verified_unavailable` is one it holds a verification for
 * from an earlier round and could not reach in the last one; and
 * `advertised_unverified` is one other peers advertise that no completed round
 * has ever got an answer out of. The first two are peers the crawler has
 * SPOKEN to. The third is hearsay with a real identity attached, and the reason
 * this replaced a boolean: three states do not fit in one, and folding the
 * third in beside a peer the crawler has actually dialed is exactly the blur
 * this record refuses.
 *
 * ⚠️ A consumer that has a mark for one rung and not another must SELECT the
 * rungs it can draw. Defaulting an unrecognised state to the brightest one —
 * which the old `reachable !== false` did, and which is what a boolean invites
 * — renders hearsay at the brightness reserved for a peer somebody answered. */
export type RosterNodeState = 'reachable' | 'verified_unavailable' | 'advertised_unverified';

/** One crawler-known node, as the scene may stage it.
 *
 * Its identity is real and nothing else here is: the id, the address, the
 * version and the labels are the crawler's own observations, while where this
 * node ends up standing — and every edge drawn to it — is scene placement
 * with no claim on the network's shape.
 *
 * ⭐ THE ABSENT FIELDS ARE THE POINT. Everything below `state` is optional
 * because the crawler holds it only for a node it actually reached, and a row
 * for a node it never reached must not borrow a plausible value from one it
 * did. `'Unknown'` still appears and still means what it always meant — the
 * crawler reached this node and its geolocation lookup came back empty — which
 * is a different statement from a field that is not here at all, and the reason
 * those two are not spelled the same way. */
export interface RosterNode {
  /** Base58: the id vocabulary the whole app already shares with the local
   * node's peer list, with `Peer.node_id`, and with
   * `/api/enrichment/peers/:node_id` — not the hex the crawler is keyed by. */
  node_id: string;
  /** The primary address the crawler holds for this node. Present for every
   * state: an address is what a candidate IS. */
  addr: string;
  /** What the crawler knows about this node, and how it came to know it. */
  state: RosterNodeState;
  /** The client version the crawler read off this node's identify. Absent
   * unless the crawler holds a verification for it. */
  version?: string;
  /** A crawler that REACHED a node and has no geolocation or ASN for it says
   * `'Unknown'`, and that answer crosses unchanged: "nobody knows" is a label,
   * not a gap. The field is absent only for a node the crawler never reached,
   * where there was no lookup to come back empty. */
  country?: string;
  asn?: string;
  /** When the crawler last REACHED this node.
   *
   * ⭐ One of three clocks, and not interchangeable with either. This is the
   * only one that means "the crawler saw this node", so it is absent for a node
   * it never did — a row that filled it from a neighbouring clock would print a
   * sighting that never happened. */
  last_reachable_ms?: number;
  /** When the network last NAMED this node to the crawler. The one clock every
   * row has, and the reason no roster row is ever undated. */
  last_advertised_ms: number;
  /** When the crawler last TRIED this node — the last completed round it was
   * in, whether or not the dial got anywhere. What dates a failure. */
  last_observed_ms?: number;
  /** The crawler's own dial, from the crawler's vantage. Display-only: it
   * measures a link this dashboard does not have, and is never a distance. */
  rtt_ms?: number;
}

/** The bounded sample of crawler-known nodes the scene may stage.
 *
 * `NetworkAtlasRecord`'s twin from the other side: the atlas counts the
 * crawler's whole known set and names nobody, and this names a bounded few
 * and counts nothing. Every identity in it is real; everything relational
 * still is not, because a crawler observes nodes rather than the links
 * between them — so a sighted node's position and edges stay declared
 * fiction.
 *
 * Entries arrive ordered by `node_id`, so the same known set stages as the
 * same set in the same order round after round. Empty `entries` is a crawler
 * that finished a round knowing nobody, which is a report and not the same
 * thing as having no crawler at all (that one arrives as
 * `network_roster_clear`).
 *
 * The bounded few are no longer one kind of node: every entry carries its own
 * `state`, and a scene with a mark for one rung and not another selects the
 * rungs it can draw rather than assuming the record only names those. */
export interface NetworkRosterRecord {
  source: string;
  as_of: ChainAnchor;
  updated_at_ms: number;
  crawl_round: number;
  /** The crawler knows more nodes than this roster names — either because a
   * page said there was more behind it, or because the roster spent its whole
   * budget before it had asked after every rung of the gradient. */
  truncated: boolean;
  entries: RosterNode[];
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
  /** How many distinct peers named this node to the crawler — the INBOUND
   * half of the address-book relationship.
   *
   * ⚠️ NOT A COUNT OF LINKS. Upstream is explicit that this is address-book
   * gossip: a peer that advertises this node's address may never have spoken
   * to it, and the crawler certainly did not watch them do it. Every surface
   * that prints it says so, because "47 peers name it" and "47 peers are
   * connected to it" are a sentence apart and a fact apart. */
  advertiser_peer_count?: number;
  /** How many ADDRESSES this node advertised to the crawler — the OUTBOUND
   * half, and the other end of the same relationship.
   *
   * ⚠️ ADDRESSES, NEVER PEERS, and the two are not interchangeable at any
   * ratio: a peer is advertised under every alias anybody has ever seen it at,
   * so this count runs several times the number of peers behind it (live:
   * ~5.7k addresses across ~137 peers). The field it replaces — ckbadger's
   * deleted `knownPeers` — counted peers, so a reader that carried the old
   * label onto this number would overstate the network by an unbounded factor
   * while sounding exactly as confident.
   *
   * Absent for every peer with no verification: the counter is nested inside
   * the crawler's authenticated observation, because it counts what the peer
   * said after it identified itself. */
  advertised_address_count?: number;
}

/** What the crawler holds about a peer it has never verified.
 *
 * The rung below a sighting: other peers advertised addresses for this node,
 * the crawler dialed them, and no dial ended in an identify it could keep. An
 * ordinary state rather than an edge — a node behind NAT dials out and cannot
 * be dialed back, so cknerv can hold a live link to a peer the crawler will
 * never verify.
 *
 * There is no country, no client version and no RTT here, because upstream
 * refuses to fabricate metadata for a peer it never reached and neither does
 * this. */
export interface PeerAdvertisedEvidence {
  /** When the network last named this peer to the crawler. The report's own
   * clock: an unverified peer has no sighting to be stamped by, and an
   * undated statement about the network is the one thing the DOSSIER never
   * prints. */
  last_advertised_at_ms: number;
  /** The furthest any of this peer's addresses got in the last completed
   * round. Absent when no round has completed with this peer in it — which is
   * a different statement again: nobody has tried yet. */
  furthest_result?: PeerProbeResult;
  /** The address `furthest_result` was read on, so the rung has somewhere to
   * have happened.
   *
   * The one fact here a node cannot learn about itself: a local node's own
   * config states what it BOUND, and this is what the network is telling
   * everybody to dial — a NAT's outside address, a port nobody forwarded, a
   * host that moved. It travels with the result rather than beside it because
   * a peer is dialed once per alias, and the two would otherwise be a rung
   * from one address and a name from another. */
  furthest_address?: string;
  /** How many of this peer's addresses the last completed round actually
   * dialed — the population `furthest_result` is the best of, and what makes
   * that rung readable as a summary rather than as the only thing that
   * happened. Zero when no round has completed. */
  dialed_address_count: number;
  /** Completed rounds in a row that ended with no verification. */
  consecutive_exhausted_rounds: number;
  /** How many distinct peers named this one to the crawler — the same INBOUND
   * count `PeerSightingRecord.advertiser_peer_count` carries, under the same
   * name because it is the same fact.
   *
   * The only weight this rung has. Everything else about an unverified peer
   * says how it failed; this says how much of the network is still repeating
   * its address. ⚠️ Still not a count of links. */
  advertiser_peer_count?: number;
}

/** Why a peer lookup came back without a sighting. Each one is a different
 * true statement, and none of them is a failure. */
export type PeerSightingAbsence =
  /** The configured source has no network crawler at all. */
  | 'no_crawler'
  /** The local node's id for this peer is not one the source can be keyed
   * by, so nothing was asked. */
  | 'unreadable_node_id'
  /** The source answered, and holds nothing at all under this id — not a
   * sighting, and not even an address somebody advertised. */
  | 'never_sighted'
  /** The source holds addresses for this node that other peers advertised,
   * and no verification of it: the network names this peer, and nobody
   * outside could get an identify out of it. `advertised` carries the
   * crawler's own word for how far the dials got. */
  | 'advertised_unverified';

/** The result of `GET /api/enrichment/peers/:node_id` when a source is
 * configured. Deliberately not `PeerSightingRecord | null`: "never seen from
 * outside" is an observation about the network, not a missing record.
 *
 * The evidence rides beside the reason rather than becoming a third state
 * because it is not a sighting and must never be read as one: none of a
 * sighting's fields exists for a peer nobody authenticated. */
export type PeerSightingLookup =
  | { state: 'sighted'; sighting: PeerSightingRecord }
  | {
      state: 'unsighted';
      reason: PeerSightingAbsence;
      advertised?: PeerAdvertisedEvidence;
    };

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
  network_roster?: NetworkRosterRecord;
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
  | { type: 'network_roster_replace'; network_roster: NetworkRosterRecord }
  | { type: 'network_roster_clear' }
  | { type: 'script_registry_replace'; script_registry: ScriptRegistryRecord }
  | { type: 'prune'; from_block: number }
  | { type: 'clear' };

export interface RevisionedSemanticsDelta {
  revision: number;
  delta: SemanticsDelta;
}
