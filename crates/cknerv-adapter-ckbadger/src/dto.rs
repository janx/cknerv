use std::collections::HashMap;

use serde::{de::IgnoredAny, Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkStats {
    pub sync_status: SyncStatus,
}

/// Fixed-size subset of ckbadger's indexed transaction statistics. Source
/// labels are validated by the adapter but intentionally discarded before the
/// shared wire boundary.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransactionStatsResponse {
    pub current_hour: i64,
    pub current_day: i64,
    #[serde(default)]
    pub hourly_data: Vec<TransactionStatsPoint>,
    #[serde(default)]
    pub daily_data: Vec<TransactionStatsPoint>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct TransactionStatsPoint {
    pub label: String,
    pub value: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkCrawlerSummaryResponse {
    pub enabled: bool,
    pub has_data: bool,
    pub last_round: Option<NetworkCrawlerRoundResponse>,
}

/// The finished round inside `network/summary`, as ckbadger's peer-evidence
/// rework spells it.
///
/// Every name here is upstream's own. The round used to report `totalKnown`,
/// `attemptedPeers` and `unreachablePeers`; upstream deleted all three for
/// blurring separate quantities under one word, and cknerv does not
/// resurrect them from the survivors — a deleted field has no honest
/// substitute, only an invented one.
///
/// The wire carries more of this round than is declared here:
/// `nonSuccessfulAddressAttempts`, `malformedAddresses`, `peerOutcomes` and
/// `discovery`. Nothing in cknerv reads them, so they are deliberately not
/// declared: a field declared here is a field whose disappearance costs the
/// whole record, and this crate has now paid that price twice in one week.
/// Two of them could not be read anyway. `nonSuccessfulAddressAttempts` is
/// `addressAttempts` less the histogram's top rung and carries nothing the
/// strip does not draw; `malformedAddresses` counts advertised addresses that
/// never became a dial, so it sits OUTSIDE the partition below and would have
/// to be a statement of its own rather than a seventh bucket.
///
/// The five peer counts below are not five independent measurements. Upstream
/// derives all of them from one disjoint five-cell outcome matrix — every
/// candidate the round completed lands in exactly one of `sameNetworkIdentified`,
/// `exhausted{With,Without}RetainedVerification` and
/// `foreign{With,Without}RetainedVerification` — so they carry exact
/// arithmetic between them, and `map_network_atlas` refuses a round that breaks
/// it. Written out in those five cells:
///
/// ```text
/// candidatePeers            = S + Ewith + Ewithout + Fwith + Fwithout
/// reachablePeers            = S
/// exhaustedCandidates       =     Ewith + Ewithout
/// foreignPeers              =                        Fwith + Fwithout
/// verifiedUnavailablePeers  =     Ewith             + Fwith
/// verifiedRetainedPeers     = S + Ewith             + Fwith
/// ```
///
/// Two consequences worth stating because they are easy to assume away.
/// `reachable + exhausted + foreign` is exactly `candidatePeers` — a true
/// partition. `verifiedUnavailablePeers` is NOT a sixth part of it: it cuts
/// across `exhausted` and `foreign`, sharing `Ewith` with one and `Fwith` with
/// the other, so it may never be added to them.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkCrawlerRoundResponse {
    pub round_id: u64,
    pub started_at: u64,
    pub finished_at: u64,
    /// Peers the round considered — the widest count it reports, and the
    /// denominator every other peer count here sits under.
    pub candidate_peers: u64,
    /// Peers the crawler still holds a verification for at the end of the
    /// round: reached, or reached before and remembered. This is the set the
    /// deleted `totalKnown` was counting.
    pub verified_retained_peers: u64,
    /// Peers that answered this round and named this network.
    pub reachable_peers: u64,
    /// Peers the round finished without a verification: it tried every
    /// address it holds for them and none returned an identify.
    pub exhausted_candidates: u64,
    /// Peers that answered and named a different network. They dialed
    /// perfectly well; they are simply not on this chain.
    pub foreign_peers: u64,
    /// Peers the crawler still holds a verification for that this round did
    /// not reach on this network — the cohort the colony already draws dark.
    pub verified_unavailable_peers: u64,
    /// Peers verified for the first time in this round.
    pub new_verified_peers: u64,
    /// Address dials the round made. Upstream derives it by summing
    /// `addressObservations`, which is what makes reading both worth the
    /// second field: the sum is then a check rather than a restatement, and it
    /// is the only thing that would notice a SEVENTH result added upstream.
    /// Serde would ignore an undeclared seventh counter silently, cknerv's six
    /// would come up short of this total, and the round would be refused —
    /// which is the correct answer for a strip whose one claim is that its
    /// parts are all the parts.
    pub address_attempts: u64,
    pub address_observations: AddressObservationHistogramResponse,
}

/// Where each of the round's address dials stopped, along upstream's own
/// handshake axis.
///
/// Six counters, and cknerv reads every one of them — which is why they are
/// declared required rather than defaulted. A missing counter and a wrong
/// counter both end in the same refusal here, and the undefaulted form says
/// the truer thing about which happened: the wire changed shape, rather than
/// this round's arithmetic failing to close.
///
/// The order of these fields is the ORDER OF THE AXIS, weakest rung first, and
/// it is the same order `PeerProbeResult` declares. Nothing in this struct
/// enforces that — the mapper builds the axis from
/// `PeerProbeResult::HANDSHAKE_AXIS` and never from field order — but writing
/// them out of order here would be a lie to the next reader.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddressObservationHistogramResponse {
    pub dial_request_failed: u64,
    pub no_authenticated_session_before_deadline: u64,
    pub authenticated_session_without_identify_before_deadline: u64,
    pub malformed_identify: u64,
    pub foreign_network: u64,
    pub same_network_identified: u64,
}

/// `network/distributions`: the crawler's whole verified set, counted by
/// label rather than sampled.
///
/// This is a census and the peers page is not. cknerv used to fold its own
/// country and version buckets out of one bounded 64-row page and had to
/// caption them as a sample for it; upstream now folds them over every peer it
/// holds a verification for, and adds the two axes cknerv could never compute
/// — the autonomous systems the fleet is hosted in, and the protocols it
/// opened. A census answers a question the sample only gestured at: whether
/// half the network shares one operator is not visible in sixty-four rows of
/// it.
///
/// `verifiedRetained` is the denominator the three histograms below are
/// counted against, and it is a DIFFERENT CLOCK from the round's identically-meant
/// `verifiedRetainedPeers`: upstream scans its node store when this request
/// arrives, while the round reports what its own outcome matrix added up to
/// when it finished. The two agree whenever nothing has changed in between and
/// nothing guarantees that they must, so cknerv carries this one under its own
/// name and never asserts the two against each other.
///
/// The wire also carries `sameNetworkReachable` and `verifiedUnavailable`,
/// which are that same scan split by the node record's `reachable` flag. They
/// are not declared: the ladder states both facts already, from the round,
/// where they are the crawler's own arithmetic rather than a re-derivation at
/// request time, and a second pair of numbers meaning the same words is the
/// ambiguity this whole rework exists to remove.
///
/// `protocols` is not declared either, and for a different reason worth
/// writing down because it looks like a free fourth strip. It is the one
/// histogram here that is NOT a partition: upstream counts one row per
/// protocol per peer, so a fleet where every peer opens Discovery and Identify
/// answers with two buckets that each equal the population and add up to twice
/// it. A proportional strip drawn from that would state a denominator it does
/// not have, and the shape it would draw is two segments at 100% each, which
/// is no shape at all. The day a peer speaks something else is news, but it is
/// news for a list of exceptions rather than for a bar.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkDistributionsResponse {
    pub verified_retained: u64,
    #[serde(default)]
    pub versions: Vec<LabelCountResponse>,
    #[serde(default)]
    pub countries: Vec<LabelCountResponse>,
    #[serde(default)]
    pub asns: Vec<LabelCountResponse>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct LabelCountResponse {
    pub label: String,
    pub count: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkPeersPageResponse {
    #[serde(default)]
    pub items: Vec<PeerSummaryResponse>,
    pub next_cursor: Option<String>,
}

/// How far the crawler got with one peer, in upstream's own vocabulary.
///
/// This is a gradient of evidence, not a confidence rating: `reachable` means
/// the crawler dialed the peer and it identified itself, and
/// `advertisedUnverified` means other peers named it and it never answered.
/// The roster carries those three onto the wire as its own state discriminant
/// and asks for them one scope at a time. It carries neither of the other two:
/// a `foreignNetwork` peer answered from another chain and is not a member of
/// this network's colony, and `noCompletedObservation` is the transient state
/// of a peer no finished round has reached yet, which is strictly less
/// evidence than `advertisedUnverified` already is.
///
/// ⭐ `Unknown` is load-bearing. Upstream broke this contract twice inside
/// 48 hours and each break cost the entire roster, because one unreadable
/// field fails the whole page decode. A sixth state added upstream must cost
/// one row and nothing else, so an unrecognised state decodes rather than
/// throwing, and the mappers decide what a row they cannot classify is
/// worth. Guarded by `an_unknown_display_state_costs_one_row_not_the_page`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PeerDisplayState {
    Reachable,
    VerifiedUnavailable,
    AdvertisedUnverified,
    ForeignNetwork,
    NoCompletedObservation,
    #[serde(other)]
    Unknown,
}

/// One row of `network/peers`: candidates and verified peers unified, each
/// tagged with the evidence behind it.
///
/// ⭐ THE NULLS ARE THE CONTRACT. Upstream builds `version`, `country`, `asn`,
/// `lastReachableAt` and `rttMs` out of the verified node record and answers
/// `null` for all five when it holds none — so a `null` here is upstream
/// saying *there was never a dial to learn this from*, and it draws the line
/// in exactly the place cknerv needs it drawn. It is emphatically NOT the same
/// answer as an empty label: upstream mints the word `"Unknown"` itself for a
/// peer it DID reach whose geolocation or ASN lookup came back empty, so
/// "nobody knows where this reached node is" arrives as a string and "nobody
/// ever spoke to this node" arrives as `null`. Collapsing the two — which one
/// `unwrap_or_default()` in the mapper is enough to do — would print the
/// crawler's verdict over a peer it never dialed.
///
/// Three clocks arrive here and they are three different facts. Nothing may
/// fill one from another; see the mapper, where each keeps its own name all
/// the way onto the wire.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PeerSummaryResponse {
    pub peer_id: String,
    pub display_state: PeerDisplayState,
    /// The first alias the crawler retains for this peer. Read only by the
    /// roster: the atlas counts this page and deliberately names nothing on
    /// it. Defaulted because a row that reaches us without one is a row to
    /// leave off stage, not a page to lose — upstream refuses to answer at
    /// all for a candidate with no retained alias.
    #[serde(default)]
    pub primary_addr: String,
    pub version: Option<String>,
    pub country: Option<String>,
    pub asn: Option<String>,
    /// Unix seconds the network last named this peer to the crawler, and
    /// upstream's sort key for this page: rows arrive newest-advertised first,
    /// ties broken by `peerId`.
    ///
    /// It does two jobs and they are worth keeping apart. It is what the
    /// roster checks the page's order against — which peers land inside a
    /// bounded slice is decided by that order, and nothing else on the page
    /// can say whether it held. It is also the ONE clock every candidate has,
    /// verified or not, so it is the stamp an unverified row is dated by; a
    /// peer nobody ever advertised is a peer no crawler ever heard of.
    pub last_advertised_at: u64,
    /// Unix seconds the crawler last FINISHED A ROUND with this peer in it,
    /// whether or not the dial got anywhere — the newest stamp across the
    /// addresses that round tried. Absent for a candidate no completed round
    /// has reached yet, which is precisely the `noCompletedObservation` state.
    ///
    /// It is not a sighting and it is not the sort key. It arrives here so the
    /// roster can say when a failure was last confirmed to still be a failure,
    /// which is the one thing an unverified peer's row could otherwise only
    /// answer by borrowing a clock that means something else.
    pub last_observed_at: Option<u64>,
    /// Unix seconds the crawler last REACHED this peer. Present exactly when
    /// upstream holds a verified node record for it — the same condition that
    /// decides every other optional field on this row, which is why the five
    /// arrive and depart together.
    ///
    /// Note that condition is the node record and not the state word: a
    /// `foreignNetwork` or `noCompletedObservation` row can carry a stale node
    /// record from an earlier round and answer with all five populated. The
    /// roster stages neither of those, so the two never disagree in practice —
    /// but a reader that derived "was this peer ever reached" from the state
    /// word instead of from this field would be deriving it from the wrong
    /// one.
    pub last_reachable_at: Option<u64>,
    pub rtt_ms: Option<u32>,
}

/// One peer's crawler dossier, keyed by hex-encoded PeerId bytes.
///
/// Upstream used to answer this route with one flat record and no way to say
/// "I hold addresses for this peer and have never got a packet out of it".
/// It now answers a candidate — everything anyone has advertised about the
/// peer — with the verified observation nested inside it, and **`verified` is
/// null for every peer the crawler could not authenticate**. That is not an
/// edge: most of the candidate set is in that state (79 of 136 as measured),
/// and a peer cknerv holds an inbound link to is a perfectly ordinary member
/// of it, because a node behind NAT dials out and cannot be dialed back.
///
/// The wire carries more of this peer than is declared here:
/// `observationVantage`, `firstDiscoveredAt`, `aliases` and `active`. Nothing
/// in cknerv reads them, so they are deliberately not declared — a field
/// declared here is a field whose disappearance costs the whole record, and
/// this crate has now paid that price twice in one week.
///
/// `advertisers` is declared, and it is NOT the deleted `knownPeers`: it
/// counts the peers that named *this* one, where `knownPeers` counted the
/// peers *this* one named. Reading it into the old slot would have printed the
/// sentence backwards, which is why that slot is gone rather than filled and
/// why this arrives under a label of its own.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PeerDetailResponse {
    pub peer_id: String,
    pub display_state: PeerDisplayState,
    /// Unix seconds the network last named this peer to the crawler. It
    /// exists for every candidate, verified or not, which is what makes it
    /// the one clock an unverified peer's report can be dated by.
    pub last_advertised_at: u64,
    /// The last round that finished with this peer in it. Absent for a peer
    /// the crawler has heard named and not yet probed in any completed round.
    pub last_completed: Option<CandidateEvidenceResponse>,
    /// The crawler's verified observation, or `null` for a peer it holds no
    /// verification for. This is the field that decides whether cknerv has a
    /// sighting to report at all.
    pub verified: Option<VerifiedPeerResponse>,
    /// The peers that named this one to the crawler — the INBOUND half of the
    /// address-book relationship, and the only half that exists for a peer
    /// nobody ever authenticated.
    ///
    /// ⭐ Only the LENGTH is read, and the entries are deliberately parsed as
    /// nothing at all. cknerv publishes a count of distinct advertisers; the
    /// ids behind it would be the first genuinely real edge evidence the
    /// colony has ever held, and drawing them needs a spec of its own —
    /// upstream is explicit that `knownPeers` is address-book gossip rather
    /// than a live topology edge. Reading the rows as [`IgnoredAny`] keeps a
    /// reshape of the entry shape from costing the whole dossier, which is a
    /// real risk on a field whose only job here is to be counted.
    ///
    /// `Option` rather than `#[serde(default)]`, unlike every other list on
    /// this route: absent has to stay distinguishable from empty, because the
    /// COUNT is the fact. A wire that stops sending the list must stand the
    /// row down, never print "0 PEERS NAME IT" over a peer the crawler is
    /// dialing every round.
    pub advertisers: Option<Vec<IgnoredAny>>,
}

/// How the last completed round went for one candidate.
///
/// `roundId` and `outcome` are on the wire and not declared: the outcome word
/// is derivable from the observations below — an `exhausted` candidate is one
/// where no address identified — and the round number has no reader. What
/// matters is the per-address evidence: a dial that never opened and a secure
/// session that opened and then went quiet are genuinely different diagnoses,
/// and collapsing them would throw away the only part of this record an
/// operator can act on.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CandidateEvidenceResponse {
    #[serde(default)]
    pub observations: Vec<AddressProbeEvidenceResponse>,
    /// How many completed rounds in a row have ended without a verification.
    /// Zero for a peer that has just started failing, and the difference
    /// between "the network is settling" and "this has never worked".
    pub consecutive_exhausted_rounds: u64,
}

/// One address the round dialed, and how far it got.
///
/// The wire also carries `roundId`, `observedAt` and `elapsedMs`. The round
/// number has no reader, and the two clocks would only date a failure the
/// candidate's own `lastObservedAt` already dates. `elapsedMs` is the one
/// worth naming as a refusal rather than an oversight: it is how long the
/// crawler waited, so on the rung that dominates the live set it is the
/// crawler's own deadline printed back — the same figure under every peer,
/// and a number that says nothing about any of them.
///
/// `address` IS read. It is the operator diagnostic the DOSSIER's EXPOSURE
/// row was always going to grow: the alias the network is gossiping is the
/// one thing on the mirror that a node cannot learn from its own config,
/// which prints what it bound rather than what the world was told.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddressProbeEvidenceResponse {
    pub result: PeerProbeResultResponse,
    /// The multiaddr this dial was made to. Defaulted rather than required:
    /// it qualifies the result, and an observation that arrives without one
    /// is a sentence with no address in it, never a dossier to lose.
    #[serde(default)]
    pub address: String,
}

/// How far one dial got, in upstream's own vocabulary.
///
/// This is an ORDINAL axis, not a set of labels: each name is strictly
/// further through the handshake than the one above it, from a dial that
/// never opened to a peer that identified itself on this chain. A candidate
/// is probed once per alias, so the honest answer to "why is this peer not
/// verified" is the FURTHEST any of its addresses got — the last one tried
/// would be an arbitrary pick.
///
/// ⭐ `Unknown` is load-bearing for the same reason it is on
/// [`PeerDisplayState`]: upstream sends these as strings, and a seventh
/// result added there must cost this build a sentence it cannot phrase, never
/// the whole dossier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PeerProbeResultResponse {
    DialRequestFailed,
    NoAuthenticatedSessionBeforeDeadline,
    AuthenticatedSessionWithoutIdentifyBeforeDeadline,
    MalformedIdentify,
    ForeignNetwork,
    SameNetworkIdentified,
    #[serde(other)]
    Unknown,
}

/// The crawler's verified observation of a peer: present exactly when it
/// authenticated the peer and read an identify off it, absent otherwise.
///
/// The clocks are unix SECONDS here; the shared wire contract counts
/// milliseconds, and the mapper is where that conversion happens. `ownAddrs`
/// and `flags` are deliberately not read: the dashboard already holds the
/// addresses the local node negotiated, and capability bits have no reader.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifiedPeerResponse {
    pub client_version: String,
    #[serde(default)]
    pub protocols: Vec<String>,
    pub first_seen: u64,
    pub last_seen: u64,
    pub last_reachable_at: u64,
    pub country: String,
    pub asn: String,
    pub rtt_ms: Option<u32>,
    /// What this peer gossiped to the crawler while it was authenticated —
    /// the OUTBOUND half of the address-book relationship, and the half that
    /// exists only for a peer somebody actually got an identify out of.
    ///
    /// It is nested under the verification for exactly that reason, and it is
    /// why the two directions can never be one row: the count of peers that
    /// named this node stands for every candidate, and this one stands only
    /// here.
    pub discovery: Option<PeerDiscoveryCountersResponse>,
}

/// What one authenticated peer's discovery messages amounted to.
///
/// ⚠️ THE UNIT IS ADDRESSES. `validNodesMessages`, `malformedMessages`,
/// `unexpectedMessages` and `rejectedAdvertisedAddresses` ride the same object
/// and are not declared: they measure the conversation rather than the address
/// book, and the row cknerv draws from this asks how much of the network one
/// peer knows. The count that answers that is the normalized one, and a peer
/// carries several addresses, so it is never the peer count the deleted
/// `knownPeers` was — which is the whole reason this arrives under its own
/// name instead of into that slot.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PeerDiscoveryCountersResponse {
    pub normalized_advertised_addresses: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssetEcosystemResponse {
    #[serde(default)]
    pub top_tokens: Vec<AssetEcosystemToken>,
    #[serde(default)]
    pub capacity_breakdown: Vec<AssetEcosystemCategory>,
    pub total_live_capacity_ckb: String,
    pub total_knowledge_size_ckb: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssetEcosystemToken {
    pub type_script_hash: String,
    pub name: Option<String>,
    pub symbol: Option<String>,
    pub holders_count: i64,
    pub total_capacity_ckb: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssetEcosystemCategory {
    pub category: String,
    pub capacity_ckb: String,
    pub percentage: String,
}

/// ckbadger's whole-chain live-Cell summary. The source maintains this as a
/// fixed-size record updated incrementally from birth/spend, so the response
/// is constant work and never a scan; it has no synthesized default, which is
/// why an unavailable aggregate is an HTTP status rather than a zero here.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LiveCellSummaryResponse {
    pub tip: LiveCellSummaryTip,
    pub live_cells: i64,
    #[serde(default)]
    pub classes: Option<LiveCellSummaryClasses>,
    #[serde(default)]
    pub data_bearing: Option<i64>,
}

/// The block the counts are exact at. cknerv proves this pair against its own
/// canonical evidence before admitting anything the record says.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LiveCellSummaryTip {
    pub block: i64,
    pub hash: String,
}

/// Mutually exclusive decomposition of `liveCells`. Optional as a whole: a
/// response without it still carries a usable count.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LiveCellSummaryClasses {
    pub dao: i64,
    pub typed_non_dao: i64,
    pub plain: i64,
}

/// Fixed-shape subset of ckbadger's global DAO statistics response. Fields
/// that cknerv does not publish are intentionally ignored by serde.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DaoStatisticsResponse {
    pub tip_block_number: i64,
    pub total_deposited: String,
    pub total_depositors: i32,
    pub active_deposits: i32,
    pub unclaimed_compensation: String,
    pub estimated_apc: String,
    pub pending_withdrawal_capacity: String,
    pub deposit_change_24h: Option<String>,
    pub depositors_change_24h: Option<i32>,
}

/// Bounded subset of ckbadger's static hardfork timeline. Resource links,
/// summaries, and dates are deliberately excluded from cknerv's adapter DTO.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HardforkTimelineResponse {
    pub network: String,
    pub tip_epoch: i64,
    pub tip_block: i64,
    #[serde(default)]
    pub events: Vec<HardforkEventResponse>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HardforkEventResponse {
    pub id: String,
    pub short_name: String,
    pub edition_year: i32,
    pub activation_epoch: i64,
    pub activation_block: Option<i64>,
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecentReorgResponse {
    pub has_recent_reorg: bool,
    pub reorg: Option<ReorgEventResponse>,
    pub recent_window_seconds: i64,
    pub deep_fork: DeepForkStatusResponse,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReorgEventResponse {
    pub id: i64,
    pub fork_point_number: i64,
    pub fork_point_hash: String,
    pub old_tip_number: i64,
    pub old_tip_hash: String,
    pub new_tip_number: i64,
    pub new_tip_hash: String,
    pub depth: i32,
    pub orphaned_blocks_count: i64,
    pub orphaned_txs_count: i64,
    pub event_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeepForkStatusResponse {
    pub detected: bool,
    pub db_tip: Option<i64>,
    pub db_tip_hash: Option<String>,
    pub chain_tip: Option<i64>,
    pub chain_tip_hash: Option<String>,
    pub depth: Option<i32>,
    pub fork_point: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LatestActivityResponse {
    pub tx_hash: String,
    pub block_number: i64,
    pub timestamp: String,
    pub is_cellbase: bool,
    #[serde(default)]
    pub protocol_actions: Vec<ActivityProtocolAction>,
    #[serde(default)]
    pub type_calls: Vec<ActivityScriptCall>,
    #[serde(default)]
    pub lock_calls: Vec<ActivityScriptCall>,
    #[serde(default)]
    pub participants: Vec<ActivityParticipant>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActivityProtocolAction {
    pub protocol: String,
    pub action: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActivityScriptCall {
    pub script_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActivityParticipant {
    #[serde(default)]
    pub item_deltas: Vec<ActivityItemDelta>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ActivityItemDelta {
    pub kind: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncStatus {
    pub is_syncing: bool,
    pub synced_block: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BlockResponse {
    pub number: i64,
    pub hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CellDetailResponse {
    pub tx_hash: String,
    pub output_index: i32,
    pub data_size: i64,
    pub data: Option<String>,
    pub lock_script_hash: String,
    pub type_script_hash: Option<String>,
    pub address: Option<String>,
    pub cell_type: Option<String>,
    pub created_at_block: i64,
    /// `live` or `dead`. Older ckbadger builds omit it; absence is not death.
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub consumed_at_block: Option<i64>,
    #[serde(default)]
    pub consumed_by_tx: Option<String>,
    pub lock: ScriptResponse,
    #[serde(rename = "type")]
    pub type_script: Option<ScriptResponse>,
    /// Occupied capacity in shannons, computed upstream from the Cell's stored
    /// occupied capacity rather than from the itemized byte breakdown beside
    /// it — the two are allowed to disagree.
    #[serde(default)]
    pub common_knowledge_size: Option<i64>,
    pub common_knowledge_size_breakdown: CommonKnowledgeSizeBreakdown,
    #[serde(default)]
    pub data_analysis: Option<CellDataAnalysis>,
    #[serde(default)]
    pub is_dep_group: bool,
    #[serde(default)]
    pub dep_group_items: Option<Vec<DepGroupItem>>,
    #[serde(default)]
    pub code_cell_of: Option<Vec<CodeCellScript>>,
    #[serde(default)]
    pub dao_info: Option<DaoInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptResponse {
    pub code_hash: String,
    pub hash_type: String,
    pub args: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommonKnowledgeSizeBreakdown {
    pub capacity_field_bytes: i64,
    pub lock_script_bytes: i64,
    pub type_script_bytes: i64,
    pub data_bytes: i64,
    pub total_bytes: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CellDataAnalysis {
    pub deterministic: Option<CellDeterministicDecode>,
    #[serde(default)]
    pub heuristic_guesses: Vec<CellDataGuess>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CellDeterministicDecode {
    pub kind: String,
    pub summary: String,
    #[serde(default)]
    pub segments: Vec<CellDataSegment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CellDataSegment {
    pub label: String,
    pub start: i64,
    pub end: i64,
    pub meaning: String,
    pub human_value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CellDataGuess {
    pub kind: String,
    pub confidence: String,
    pub reason: String,
    pub mime_type: Option<String>,
    pub human_value: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DepGroupItem {
    pub tx_hash: String,
    pub output_index: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodeCellScript {
    pub name: String,
    pub code_hash: String,
    pub hash_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DaoInfo {
    pub dao_status: String,
    pub deposit_block_number: i64,
    /// RFC 3339 instants derived upstream from each block's header timestamp,
    /// second precision, always UTC. Upstream substitutes an empty string when
    /// the header is missing, so "present" is not the same as "known".
    pub deposit_timestamp: Option<String>,
    pub withdraw_request_block: Option<i64>,
    pub withdraw_request_timestamp: Option<String>,
    pub withdraw_block: Option<i64>,
    pub withdraw_timestamp: Option<String>,
    pub compensation_ckb: Option<String>,
    pub estimated_apc: Option<String>,
}

/// One family from ckbadger's script catalogue. The catalogue carries names
/// and descriptions but no code hashes, so it cannot resolve a script on its
/// own — it is joined to `scripts/lookup` results by `name`, which is unique
/// across the catalogue.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptFamilyResponse {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub script_kind: Option<String>,
    #[serde(default)]
    pub website: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptCatalogueResponse {
    #[serde(default)]
    pub data: Vec<ScriptFamilyResponse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LookupScriptsRequest<'a> {
    pub code_hashes: Vec<&'a str>,
    pub tx_hash: &'a str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptLookupInfo {
    pub name: String,
    pub deprecated: bool,
    pub script_kind: Option<String>,
    pub decoder_type: Option<String>,
    pub resolution_state: String,
}

pub(crate) type ScriptLookupResponse = HashMap<String, ScriptLookupInfo>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TokenResponse {
    pub type_script_hash: String,
    pub standard: String,
    pub name: Option<String>,
    pub symbol: Option<String>,
    pub decimals: Option<i16>,
}

/// One digital object as ckbadger's spore index knows it.
///
/// The response also names the object's cluster, but this side has already
/// read that id out of the Cell's own decode segment — which is exactly what
/// lets the object and cluster fetches run side by side — so it is
/// deliberately not deserialized here.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SporeItemResponse {
    /// Absent until ckbadger's decode worker has measured the object. An
    /// unmeasured object is unknown, which is not the same claim as off-chain.
    #[serde(default)]
    pub media_profile: Option<SporeMediaProfileDto>,
}

/// Where one object's content physically lives. `tier` is ckbadger's own
/// vocabulary — `pure_ckb`, `btc_ckb`, `decentralized_mixture`,
/// `centralized_mixture`, `unknown` — and is carried through verbatim: the
/// tier list is ckbadger's to grow, and a sixth spelling must arrive as a
/// string this side does not recognise rather than as a decode failure.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SporeMediaProfileDto {
    pub tier: String,
    /// Deterministic decode failures and dangling media, one sentence each.
    /// Only how many there are travels onward.
    #[serde(default)]
    pub issues: Vec<String>,
}

/// One spore cluster: the collection's own facts and the storage composition
/// of its whole live population, riding a single response.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClusterDetailResponse {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// Live spores, not everything ever minted: a collection's population is
    /// what it holds now.
    pub spores_count: i64,
    pub holders_count: i64,
    /// Shannons locked in the collection's live cells.
    #[serde(default)]
    pub owned_capacity: Option<String>,
    #[serde(default)]
    pub composition: Option<CollectionCompositionDto>,
}

/// One M-NFT collection as ckbadger's asset index knows it: the class's own
/// facts and the storage composition of its whole live population, riding a
/// single response — the same two answers a spore cluster gives, under the
/// asset index's own spelling.
///
/// `standard`, `totalCount`, `ownedKnowledge` and `issuerDetail` ride the same
/// object and are deliberately not deserialized. So is `classDetail`'s
/// everything-else: an M-NFT class states a renderer and an issuer id that no
/// reader of one Cell is asking about, and the one thing they are asking —
/// what this collection is — lives in its `description`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NftCollectionDetailResponse {
    #[serde(default)]
    pub name: Option<String>,
    /// Live items, not everything ever minted — the asset index's spelling of
    /// the count a spore cluster calls `sporesCount`.
    pub live_count: i64,
    pub holders_count: i64,
    /// Shannons locked in the collection's live cells.
    #[serde(default)]
    pub owned_capacity: Option<String>,
    #[serde(default)]
    pub composition: Option<CollectionCompositionDto>,
    /// The class cell's own record, which is where M-NFT keeps its prose: the
    /// collection envelope carries a name, the class carries what it is.
    #[serde(default)]
    pub class_detail: Option<NftClassDetail>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NftClassDetail {
    #[serde(default)]
    pub description: Option<String>,
}

/// The population's storage composition, in the one shape both object indexes
/// answer with. The tier is worst-dominant upstream: one centralized object
/// colours the whole collection. `onchain_count` already sums the pure-CKB and
/// BTC+CKB objects — the wire carries no separate BTC+CKB count, so their
/// difference is the only way to see the BTC half. `onchainRatio` rides the
/// same object and is deliberately not read: the panel states tiers and
/// counts, never a percentage.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CollectionCompositionDto {
    pub tier: String,
    pub onchain_count: i64,
    pub pure_ckb_count: i64,
    pub decentralized_mixture_count: i64,
    pub centralized_mixture_count: i64,
    pub unknown_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransactionDetailResponse {
    pub hash: String,
    pub status: String,
    pub block_number: Option<i64>,
    pub block_hash: Option<String>,
    pub inputs_count: i32,
    pub outputs_count: i32,
    pub fee: String,
    pub fee_rate: Option<String>,
    pub tx_size: Option<i32>,
    pub cycles: Option<i64>,
    pub confirmations: Option<i64>,
    pub is_cellbase: bool,
    pub inputs_capacity: Option<String>,
    pub outputs_capacity: Option<String>,
    #[serde(rename = "inputsCommonKnowledgeSize")]
    pub inputs_common_knowledge_size: Option<String>,
    #[serde(rename = "outputsCommonKnowledgeSize")]
    pub outputs_common_knowledge_size: Option<String>,
    #[serde(default)]
    pub inputs: Vec<TransactionInputResponse>,
    #[serde(default)]
    pub outputs: Vec<TransactionOutputResponse>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransactionInputResponse {
    pub capacity: Option<String>,
    pub address: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransactionOutputResponse {
    pub capacity: String,
    #[serde(rename = "commonKnowledgeSize")]
    pub common_knowledge_size: i64,
    pub address: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransactionLifecycleResponse {
    pub hash: String,
    pub phase: String,
    pub proposal_id: String,
    pub proposed_in: Option<LifecycleBlockInfo>,
    pub proposed_in_uncle: Option<LifecycleUncleInfo>,
    pub committed_in: Option<LifecycleBlockInfo>,
    pub commitment_distance: Option<i64>,
    pub commitment_window: CommitmentWindow,
    pub is_cellbase: bool,
    pub confirmations: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LifecycleBlockInfo {
    pub block_number: i64,
    pub block_hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LifecycleUncleInfo {
    pub block_number: i64,
    pub block_hash: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CommitmentWindow {
    pub close: i64,
    pub far: i64,
}
