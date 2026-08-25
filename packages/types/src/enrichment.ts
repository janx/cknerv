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
 * It sits here, above both records that speak it, because it is now ONE
 * vocabulary read at two scales: `PeerHandshakeDepthBucket` counts a whole
 * round's dials by where each stopped, and `PeerAdvertisedEvidence` names the
 * furthest rung one peer's dials reached. A second ordering of the same six
 * results is exactly the drift that would let the panel and the dossier
 * disagree about which way this axis points. */
export type PeerProbeResult =
  | 'unknown'
  | 'dial_request_failed'
  | 'no_authenticated_session_before_deadline'
  | 'authenticated_session_without_identify_before_deadline'
  | 'malformed_identify'
  | 'foreign_network'
  | 'same_network_identified';

/** The axis a round's address histogram is counted along, weakest rung first.
 *
 * The Rust twin is `PeerProbeResult::HANDSHAKE_AXIS`, and there the order is
 * the enum's own `Ord`; a TS string union has no order at all, so this is the
 * only place the order exists on this side and every reader takes it from
 * here rather than writing the six results out again.
 *
 * `unknown` is deliberately absent. It is cknerv's word for an observation it
 * could not read on ONE peer, and a round's histogram has six upstream-named
 * counters and no seventh — so a bucket for it would be a bucket nothing could
 * ever fill, in a strip whose whole claim is that its parts add up to the
 * dials that were made. */
export const PEER_PROBE_HANDSHAKE_AXIS = [
  'dial_request_failed',
  'no_authenticated_session_before_deadline',
  'authenticated_session_without_identify_before_deadline',
  'malformed_identify',
  'foreign_network',
  'same_network_identified',
] as const satisfies readonly PeerProbeResult[];

/** A result that can actually be a bucket of a round's histogram: the axis's
 * six, and never `unknown`. The wire shape below stays permissive because a
 * wire may carry anything; this is what a reader is allowed to have narrowed it
 * to, so a surface that names the rungs is exhaustive over six rather than
 * carrying a seventh row nothing can reach. */
export type PeerHandshakeAxisRung = (typeof PEER_PROBE_HANDSHAKE_AXIS)[number];

/** One rung of the handshake axis, and how many of the round's address dials
 * stopped on it.
 *
 * Deliberately NOT a `NetworkAtlasBucket`. That one carries a label the
 * crawler chose — a country code, a client version string — which cknerv can
 * only pass through and rank by size. This one carries a typed rung of a fixed
 * axis, so its order is a fact about the wire rather than a rendering choice,
 * and nothing downstream may sort it. */
export interface PeerHandshakeDepthBucket {
  result: PeerProbeResult;
  /** Address dials, not peers. A peer is dialed once per address anybody
   * advertised for it, so this population is several times the peer counts
   * beside it and never partitions them. */
  attempts: number;
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
 * Beside them, and NOT one of them, is the round's address histogram.
 * `address_attempts` and `handshake_depth` count the individual ADDRESSES
 * those peers were dialed on, which is a several-times-larger population that
 * partitions nothing above it. It rides here because it is the same round's
 * evidence one scale down — the decomposition of the ladder's own failure rung
 * — and because upstream holds each identified peer to exactly one identifying
 * dial, so the axis's top rung and `last_round_reachable` are one cohort
 * counted two ways.
 *
 * The four counts under `candidate_peers` are one round's outcome matrix read
 * four ways, so they are bound by arithmetic rather than merely bounded:
 * `last_round_reachable + exhausted_candidates + foreign_peers` is exactly
 * `candidate_peers`, and `last_round_reachable + verified_unavailable_peers`
 * is exactly `verified_retained_peers`. `verified_unavailable_peers` cuts
 * ACROSS the first three rather than joining them — it is what is left
 * verified out of the exhausted and foreign cohorts — so it is the one number
 * here that must never be added to its neighbours.
 *
 * The buckets are a census, not a sample. They used to be folded out of one
 * bounded 64-row page of peers and captioned for it; upstream computes them
 * over every verified peer now, which is why `sample_size`,
 * `sample_reachable` and `sample_truncated` are gone, why `median_rtt_ms` went
 * with them — the only number left that a bounded page could have answered,
 * and a reading of the crawler's own distance from the fleet rather than of
 * the fleet — and why `asns` is here at all. */
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
  /** Address dials the round made, and the denominator `handshake_depth`
   * partitions.
   *
   * A DIFFERENT POPULATION from every peer count above it: a peer is dialed
   * once per address anybody advertised for it, so a round makes several times
   * as many dials as it considers peers, and nothing bounds the ratio. Upstream
   * derives this by summing the same six counters `handshake_depth` carries,
   * which is what makes the equality worth checking rather than restating — a
   * seventh rung added upstream would leave the six short of it, and a strip
   * drawn from six of seven parts would claim to be a whole. */
  address_attempts: number;
  /** Where each of those dials stopped, one bucket per rung of
   * `PEER_PROBE_HANDSHAKE_AXIS`, weakest first.
   *
   * The order is the reading, so it is never sorted by size the way the three
   * label histograms below are. A zero bucket is kept rather than dropped:
   * "no dial ended with an unreadable identify" is a result, and an axis that
   * lost its quiet rungs would make a round where nothing went wrong
   * indistinguishable from a build that stopped counting them. */
  handshake_depth: PeerHandshakeDepthBucket[];
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
  /** The autonomous systems the verified set is hosted in — the axis that says
   * whether half a network shares one operator, which is a fact no count of
   * peers or countries can state. */
  asns: NetworkAtlasBucket[];
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
  /** How many peers this node holds in its own address book — the OUTBOUND
   * direction, and the one count no source can currently answer.
   *
   * ckbadger deleted `knownPeers` from its peer route. What replaced it is
   * `advertisers[]`, the peers that named THIS node: the same relationship
   * read from the other end. Filling this slot from that list would print the
   * sentence backwards, so it is left empty until both directions can be
   * labelled for what they are, and the CROWD row stands down while it is.
   * Absent means "nobody can say", never "zero". */
  known_peers_count?: number;
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
  /** Completed rounds in a row that ended with no verification. */
  consecutive_exhausted_rounds: number;
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
