use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context};
use async_trait::async_trait;
use reqwest::StatusCode;
use url::Url;

use cknerv_core::projection::display_plane::DISPLAY_CURATED_FIELD;
use cknerv_core::{
    ActivityFeedItem, ActivityFeedRecord, AssetEcosystemCategory, AssetEcosystemLeader,
    AssetEcosystemRecord, CellSemanticRecord, ChainAnchor, ChainCensus, ChainCensusClasses,
    CommonKnowledgeBreakdown, CompositionDemand, DaoStateRecord, EnrichmentSourceState,
    EnrichmentSourceStatus, ForkWatchDeepFork, ForkWatchEventKind, ForkWatchRecord, ForkWatchReorg,
    GalaxyCompositionRecord, GalaxyCompositionTopUp, HashType, NetworkAtlasBucket,
    NetworkAtlasRecord, NetworkRosterRecord, OutPoint, PeerAdvertisedEvidence, PeerProbeResult,
    PeerSightingAbsence, PeerSightingLookup, PeerSightingRecord, ProtocolEra, ProtocolEraRecord,
    RosterNode, RosterNodeState, ScriptId, ScriptNameRecord, ScriptRegistryRecord, SemanticAsset,
    SemanticAttribute, SemanticCellConsumption, SemanticCellContent, SemanticContentDecode,
    SemanticContentGuess, SemanticContentSegment, SemanticFacet, SemanticScript,
    TransactionHorizonRecord, TransactionParticipantSemantic, TransactionSemanticRecord,
    DATA_HEX_TRUNCATION_MARKER, MAX_SCRIPT_REGISTRY_ENTRIES,
};
use cknerv_server::{CanonicalContext, EnrichmentSource, GalaxyCompositionHydrator};

use crate::dto::{
    AssetEcosystemResponse, BlockResponse, CandidateEvidenceResponse, CellDataAnalysis,
    CellDetailResponse, ClusterDetailResponse, CollectionCompositionDto,
    CommonKnowledgeSizeBreakdown, DaoInfo, DaoStatisticsResponse, HardforkEventResponse,
    HardforkTimelineResponse, LabelCountResponse, LatestActivityResponse, LiveCellSummaryResponse,
    LookupScriptsRequest, NetworkCrawlerSummaryResponse, NetworkDistributionsResponse,
    NetworkPeersPageResponse, NetworkStats, NftCollectionDetailResponse, PeerDetailResponse,
    PeerDisplayState, PeerProbeResultResponse, PeerSummaryResponse, RecentReorgResponse,
    ReorgEventResponse, ScriptCatalogueResponse, ScriptFamilyResponse, ScriptLookupInfo,
    ScriptLookupResponse, ScriptResponse, SporeItemResponse, TokenResponse,
    TransactionDetailResponse, TransactionLifecycleResponse, TransactionStatsPoint,
    TransactionStatsResponse, VerifiedPeerResponse,
};
use crate::galaxy_composition::{
    discover as discover_galaxy_composition, identity_families as galaxy_identity_families,
    top_up as top_up_galaxy_composition, CandidateTail, IdentityStandard,
};

/// Everything this source can answer, unconditionally. These strings are the
/// feature switches the browser reads: `ui-app/src/App.tsx` gates the whole
/// crawler dossier on `peer_sighting` and the transaction reader on
/// `transaction_detail`, and four derives in `packages/ui/src/derives/` gate
/// on one each. A rename here is a silent feature removal there, so the list
/// is pinned in `tests/fixtures/enrichment_samples.json` — this crate asserts
/// the fixture equals what it declares, and the TS side asserts every string
/// its own code consumes is in the fixture.
const CAPABILITIES: &[&str] = &[
    "cell_detail",
    "script_identity",
    "data_analysis",
    "asset_identity",
    "asset_ecosystem",
    "dao_state",
    "protocol_era",
    "activity_feed",
    "transaction_horizon",
    "fork_watch",
    "network_atlas",
    "network_roster",
    "peer_sighting",
    "chain_census",
    "script_registry",
    "transaction_detail",
    "transaction_lifecycle",
];
/// The one conditional capability: announced only when a composition hydrator
/// is wired with a non-zero target. Spelled once so the fixture pin below can
/// name it rather than re-typing it.
const GALAXY_COMPOSITION_CAPABILITY: &str = "galaxy_composition";
const DEFAULT_MAX_LAG_BLOCKS: u64 = 12;
const MAX_ECOSYSTEM_CATEGORIES: usize = 16;
const MAX_ECOSYSTEM_ASSETS: usize = 16;
const ACTIVITY_FEED_LIMIT: usize = 8;
const MAX_ACTIVITY_PARTICIPANTS: usize = 512;
const MAX_ACTIVITY_NESTED_ITEMS: usize = 512;
const MAX_ACTIVITY_LABEL_CHARS: usize = 96;
const MAX_TRANSACTION_HOURLY_BUCKETS: usize = 24;
const MAX_TRANSACTION_DAILY_BUCKETS: usize = 14;
const MAX_FORK_WATCH_WINDOW_SECONDS: u32 = 31 * 24 * 60 * 60;
const MAX_PROTOCOL_ERAS: usize = 16;
const MAX_PROTOCOL_LABEL_CHARS: usize = 64;
/// How many label buckets one `network/distributions` histogram may carry.
///
/// A hostility guard rather than a policy: the real bound is the population
/// itself, because every bucket is at least one peer and the buckets have to
/// add up to the peers they describe, so a verified set of N peers can never
/// answer with more than N of them. This is here so an answer that is not a
/// histogram at all is refused before it is folded, and it sits far enough
/// above any network CKB has ever had that it cannot be what refuses a real
/// one.
const MAX_NETWORK_DISTRIBUTION_BUCKETS: usize = 512;
/// What this source last learned about whether `network/peers` answers.
///
/// Written by the one reader that can tell — the bounded page, which upstream
/// answers with `200` and an empty `items` even for a crawler that knows
/// nobody, so a non-success there is never "no peers" and always "not this
/// route". The per-peer dossier lookup only READS it, because its own `404`
/// is ambiguous by construction: it is the same answer for "the crawler holds
/// nothing under this id" and "this build is asking a route that no longer
/// exists", and only the list can separate them.
///
/// `UNOBSERVED` is the window before the first crawler refresh of a process.
/// It is deliberately read as "no reason to doubt": refusing to answer until
/// the 60s cadence has run once would trade a false statement about a peer
/// for a false alarm on every card opened in the first minute, and the
/// capability that gates this dossier is announced beside the two that drive
/// that refresh, so the window closes on its own.
const PEERS_ROUTE_UNOBSERVED: u8 = 0;
const PEERS_ROUTE_ANSWERING: u8 = 1;
const PEERS_ROUTE_FAULTING: u8 = 2;
/// How many crawler-known nodes one roster may name. The scene stages the
/// entries it has a mark for, so this is a stage budget before it is a wire
/// budget: it sits just above the inferred cloud's own population, which is
/// what keeps replacing scatter with real identities GPU-neutral.
const ROSTER_CAP: usize = 256;
/// The rungs of upstream's evidence gradient the roster names, strongest
/// first — and, because the budget above is spent in this order, the priority
/// that decides who is left out once the network outgrows it.
///
/// ⭐ THE ORDER IS WHY THIS IS THREE REQUESTS AND NOT ONE. `network/peers`
/// unscoped is one page sorted by last positive observation, which mixes the
/// rungs: ask it for 256 rows of a 400-peer network and the slice that comes
/// back is whoever anything touched most recently, with no guarantee a single
/// peer the crawler has actually spoken to is inside it. Asking rung by rung
/// is what makes "every verified peer, then hearsay with what is left" a
/// property of the request rather than a policy written in a comment — and it
/// also stops the two states the roster does not stage from spending budget on
/// their way to being dropped. It costs two extra requests a minute.
///
/// The `state=` word matches upstream's dial result and nothing else; upstream
/// is explicit that it neither filters nor reinterprets the participation
/// evidence that now sits beside it. So these three rungs are three answers
/// about dialing, which is what this roster has always sorted on, and the
/// filter values did not move when the field they match was renamed.
///
/// Within the last rung the order upstream returns is the order the budget is
/// spent, which is newest positively-observed first, ties broken by peer id.
/// ⚠️ THAT IS NOT THE RIGHT WEIGHT AND IT IS KNOWN NOT TO BE. The honest
/// measure of hearsay is how many independent peers named the node, and that
/// lives on the per-peer detail route rather than on this page, so ranking by
/// it would cost one request per candidate. What the page can say is worth
/// something and worth stating plainly: the observation clock separates peers
/// something still touches from peers nothing has touched in a while, which is
/// exactly the axis to drop from, and it degenerates within a round into a
/// peer-id prefix — arbitrary, but the same arbitrary set every round, so the
/// colony does not reshuffle its identities every minute. When upstream grows
/// an `advertiserCount` on the list row, the swap is to over-ask this last
/// rung and sort the surplus off in `map_network_roster`, where the budget is
/// already the thing being spent.
const ROSTER_SCOPES: [RosterScope; 3] = [
    RosterScope {
        filter: "reachable",
        state: PeerDisplayState::Reachable,
    },
    RosterScope {
        filter: "verifiedUnavailable",
        state: PeerDisplayState::VerifiedUnavailable,
    },
    RosterScope {
        filter: "advertisedUnverified",
        state: PeerDisplayState::AdvertisedUnverified,
    },
];

/// One rung of [`ROSTER_SCOPES`]: the word upstream's `state=` filter parses,
/// and the state every row of that page must then decode to. Both are here so
/// the pair can be checked against each other rather than trusted to stay in
/// step — `roster_scope_filters_name_the_states_they_ask_for` is that check.
#[derive(Clone, Copy)]
struct RosterScope {
    filter: &'static str,
    state: PeerDisplayState,
}
/// One page holds ckbadger's whole script catalogue (66 families as measured);
/// the limit is here so a grown catalogue arrives truncated rather than paged.
const SCRIPT_CATALOGUE_LIMIT: usize = 200;
/// `scripts/lookup` wants a transaction for context. The census has no
/// transaction — it is a set of identities — so this asks with none and lets
/// the response's own `resolutionState` say whether that mattered.
const UNANCHORED_LOOKUP_TX: &str =
    "0x0000000000000000000000000000000000000000000000000000000000000000";

/// ckbadger answers `resolutionState: "resolved"` once it has located the
/// code cell, and names it `"Unknown"` when it has no family for it — so
/// "resolved" means "I found the deployment", not "I know what it is". Eight
/// of twenty-nine identities on a live mainnet galaxy come back that way.
/// Passing that through would print "Unknown" as a script family and report
/// nothing unresolved, which is the exact failure this registry exists to
/// end: a name we do not have is reported as missing, not invented.
fn is_real_script_name(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("unknown")
}

/// CKB's own spelling for a hash type, which is what the wire carries.
pub(crate) fn hash_type_wire(hash_type: HashType) -> String {
    match hash_type {
        HashType::Data => "data",
        HashType::Type => "type",
        HashType::Data1 => "data1",
        HashType::Data2 => "data2",
    }
    .to_string()
}
const MAX_NETWORK_LABEL_CHARS: usize = 96;
/// A multiaddr is longer than a label: an ip6 address with a peer-id suffix
/// already runs past a hundred characters, and truncating one would print an
/// address that is not the node's.
const MAX_NETWORK_ADDR_CHARS: usize = 192;
const MAX_PEER_ID_HEX_CHARS: usize = 256;
/// A CKB PeerId is a multihash — 34 base58 characters for the identity form,
/// 46 for the sha256 one. The cap is far above both and exists so a hostile
/// path segment is rejected before it reaches the decoder.
const MAX_PEER_ID_BASE58_CHARS: usize = 128;
/// CKB opens a handful of protocols per peer; the cap is here so a
/// mis-shaped answer is refused rather than rendered.
const MAX_PEER_PROTOCOLS: usize = 32;
const MAX_CELL_CONTENT_PREVIEW_BYTES: usize = 4 * 1024;
const MAX_CELL_CONTENT_SEGMENTS: usize = 64;
const MAX_CELL_CONTENT_GUESSES: usize = 16;
/// How much of a collection's description one Cell record carries. Long enough
/// for the sentence that says what the collection is, short enough that a
/// marketing essay cannot dominate a per-Cell record. Counted in characters,
/// not bytes, so the cut never lands inside one.
const MAX_COLLECTION_DESCRIPTION_CHARS: usize = 160;
/// The literal ckbadger's spore decode writes into the `cluster_id` segment
/// for an object minted outside any cluster. It is a stated fact — unlike an
/// absent segment, which states nothing at all.
const SPORE_NO_CLUSTER: &str = "none";
/// How much of an M-NFT type script names its class: a 20-byte issuer id and a
/// 4-byte class id, before a token's own 4-byte serial. Spelled in hex
/// characters because that is the form the args arrive in and the form the
/// lookup path wants back.
const MNFT_COLLECTION_ID_HEX_CHARS: usize = 48;
const SHANNONS_PER_CKB: u128 = 100_000_000;
const MAX_WIRE_SAFE_U64: u64 = 9_007_199_254_740_991;
/// The composition curates exactly as many Cells as the stage can seat.
///
/// It is the display budget and nothing else: curating MORE spends index
/// pages and node batches on Cells the plane has no slot for, and curating
/// LESS hands the difference to the canonical fallback stream — a
/// plain-heavy boot the demand ratchet then spends minutes of bounded
/// top-ups undoing. This constant was 6,000 for as long as the stage seated
/// 6,000; the budget doubled and the cap did not follow, which is the only
/// reason a cold boot ever showed half a curated galaxy.
///
/// It is the CURATED FIELD, not the whole cell budget: the display plane
/// keeps a standing recency window (`DISPLAY_TIP_WINDOW`) staffed from the
/// canonical stream alone, and those seats are not the composition's to
/// fill. Curating more than the field can seat spends index pages and node
/// batches on cells nobody will see.
///
/// Over the field the class quota is `{dao 2_160, typed 7_560,
/// plain 1_080}`, so the composition curates exactly 1,080 plain — the
/// plain quota, to the slot. That matters because the ratchet never
/// displaces a curated member to reach a class target, so curated plain is
/// a floor under the plain class: at the field's size that floor sits ON
/// the quota instead of above it, and 20/70/10 stays reachable rather than
/// being held open by plain's own surplus.
const MAX_GALAXY_COMPOSITION_TARGET: usize = DISPLAY_CURATED_FIELD;
/// Candidates a single top-up may offer per class. Bounds one tick's
/// node work to ~4 `get_live_cell` batches per class; a larger shortfall
/// simply takes more ticks, which is what keeps a several-thousand-cell
/// boot gap from arriving as one stall.
const TOP_UP_CANDIDATES_PER_CLASS: usize = 256;

/// Read-only client for a direct or orchestrator-proxied ckbadger API base.
pub struct CkbadgerEnrichmentSource {
    api_base: Url,
    client: reqwest::Client,
    max_lag_blocks: u64,
    validated_anchor: RwLock<Option<ChainAnchor>>,
    galaxy_hydrator: Option<Arc<dyn GalaxyCompositionHydrator>>,
    galaxy_composition_target: usize,
    /// How far each class's candidate paging has reached. Held behind a
    /// mutex because `EnrichmentSource` is a `&self` trait and the tail
    /// is the one piece of source state that must survive between calls.
    /// Contention is nil: one supervisor task drives it.
    candidate_tail: tokio::sync::Mutex<CandidateTail>,
    /// One of the `PEERS_ROUTE_*` values: whether the crawler's peer list
    /// answered the last time it was asked. Shared so the per-peer dossier
    /// can tell a peer the crawler has never heard of from a route this build
    /// no longer knows the name of, without spending a request to find out.
    peers_route: AtomicU8,
}

impl CkbadgerEnrichmentSource {
    pub fn new(mut api_base: Url) -> anyhow::Result<Self> {
        if !api_base.path().ends_with('/') {
            let path = format!("{}/", api_base.path());
            api_base.set_path(&path);
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(4))
            .build()
            .context("build ckbadger HTTP client")?;
        Ok(Self {
            api_base,
            client,
            max_lag_blocks: DEFAULT_MAX_LAG_BLOCKS,
            validated_anchor: RwLock::new(None),
            galaxy_hydrator: None,
            galaxy_composition_target: 0,
            candidate_tail: tokio::sync::Mutex::new(CandidateTail::default()),
            peers_route: AtomicU8::new(PEERS_ROUTE_UNOBSERVED),
        })
    }

    pub fn with_max_lag_blocks(mut self, max_lag_blocks: u64) -> Self {
        self.max_lag_blocks = max_lag_blocks;
        self
    }

    /// Enable bounded indexed discovery backed by canonical CKB hydration.
    /// The requested target is clamped to
    /// [`MAX_GALAXY_COMPOSITION_TARGET`] — the stage's curated field; larger
    /// canonical reservoirs remain available to live pulse routing.
    pub fn with_galaxy_composition_hydrator<H>(mut self, hydrator: H, target: usize) -> Self
    where
        H: GalaxyCompositionHydrator,
    {
        self.galaxy_hydrator = Some(Arc::new(hydrator));
        self.galaxy_composition_target = target.min(MAX_GALAXY_COMPOSITION_TARGET);
        self
    }

    pub fn api_base(&self) -> &Url {
        &self.api_base
    }

    fn endpoint(&self, relative: &str) -> anyhow::Result<Url> {
        self.api_base
            .join(relative)
            .with_context(|| format!("join ckbadger endpoint {relative:?}"))
    }

    fn status(&self, state: EnrichmentSourceState) -> EnrichmentSourceStatus {
        EnrichmentSourceStatus {
            source: self.name().to_string(),
            status: state,
            capabilities: self.capabilities(),
            indexed_tip: None,
            lag_blocks: None,
            validated_anchor: None,
            last_success_at_ms: None,
            message: None,
        }
    }

    fn clear_anchor(&self) {
        *self.validated_anchor.write().unwrap() = None;
    }

    fn clear_anchor_if(&self, expected: &ChainAnchor) {
        let mut anchor = self.validated_anchor.write().unwrap();
        if anchor.as_ref() == Some(expected) {
            *anchor = None;
        }
    }

    async fn revalidate_anchor(&self, anchor: &ChainAnchor, subject: &str) -> anyhow::Result<()> {
        let url = self.endpoint(&format!("blocks/{}", anchor.block))?;
        let response = self
            .client
            .get(url)
            .send()
            .await
            .with_context(|| format!("recheck ckbadger {subject} anchor"))?;
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger {subject} anchor recheck returned HTTP {}",
                response.status()
            ));
        }
        let indexed_block: BlockResponse = response
            .json()
            .await
            .with_context(|| format!("decode ckbadger {subject} anchor recheck"))?;
        let anchor_block = i64::try_from(anchor.block)
            .with_context(|| format!("validated {subject} anchor exceeds ckbadger block range"))?;
        if indexed_block.number != anchor_block || indexed_block.hash != anchor.hash {
            self.clear_anchor_if(anchor);
            return Err(anyhow!("ckbadger {subject} anchor changed during fetch"));
        }
        Ok(())
    }

    fn current_anchor(&self, context: &CanonicalContext) -> anyhow::Result<ChainAnchor> {
        let anchor = self
            .validated_anchor
            .read()
            .unwrap()
            .clone()
            .ok_or_else(|| anyhow!("ckbadger has no validated canonical anchor"))?;
        if !context
            .recent_blocks
            .iter()
            .any(|block| block.number == anchor.block && block.hash == anchor.hash)
        {
            self.clear_anchor();
            return Err(anyhow!(
                "ckbadger anchor expired after a canonical chain change"
            ));
        }
        Ok(anchor)
    }

    /// The latest completed round, and the gate every other crawler read sits
    /// behind. `None` is a source with no crawler data to report — switched
    /// off, never run, or still in its first round — and each caller turns
    /// that into whatever absence its own record means.
    ///
    /// It is asked first and it is the one place a missing crawler is an
    /// absence rather than a fault: a source that answers this has committed
    /// to answering the crawler's other routes too, so a denial from any of
    /// them is a route this build no longer knows the name of.
    async fn read_crawler_round(&self) -> anyhow::Result<Option<NetworkCrawlerSummaryResponse>> {
        let summary_url = self.endpoint("network/summary")?;
        let response = self
            .client
            .get(summary_url)
            .send()
            .await
            .context("fetch ckbadger network summary")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger network summary returned HTTP {}",
                response.status()
            ));
        }
        let summary: NetworkCrawlerSummaryResponse = response
            .json()
            .await
            .context("decode ckbadger network summary")?;
        if !summary.enabled || !summary.has_data || summary.last_round.is_none() {
            return Ok(None);
        }
        Ok(Some(summary))
    }

    /// One roster read: the latest round, and one bounded page per rung of the
    /// evidence gradient the roster names.
    ///
    /// The atlas used to come through here too, for a 64-row page it folded
    /// into country and version buckets and a median dial. It no longer asks
    /// for peers at all — upstream counts those buckets over its whole
    /// verified set now — so these pages have one reader and one purpose:
    /// naming the nodes the scene may stage.
    ///
    /// The pages are asked for in [`ROSTER_SCOPES`] order and each one is
    /// asked only for what the budget has left, so a rung can never take a
    /// seat from a stronger one; see that constant for why the order is the
    /// whole design and why this is not a single unscoped page. A rung that
    /// finds the budget already spent is not asked at all — there is nothing
    /// left to do with its answer, and the roster says it stopped short by
    /// coming back `truncated`.
    async fn read_crawler(
        &self,
        budget: usize,
    ) -> anyhow::Result<Option<(NetworkCrawlerSummaryResponse, Vec<NetworkPeersPageResponse>)>>
    {
        let Some(summary) = self.read_crawler_round().await? else {
            return Ok(None);
        };
        let mut pages = Vec::with_capacity(ROSTER_SCOPES.len());
        let mut remaining = budget;
        for scope in ROSTER_SCOPES {
            if remaining == 0 {
                // Every rung after this one goes unasked, and `truncated`
                // carries that: `map_network_roster` reads a page count short
                // of the scope count as "there was more gradient than budget".
                break;
            }
            let page = self.read_roster_page(scope.filter, remaining).await?;
            remaining = remaining.saturating_sub(page.items.len());
            pages.push(page);
        }
        Ok(Some((summary, pages)))
    }

    /// The crawler's whole verified set, counted by label.
    ///
    /// A 404 here is an error rather than an absence, for the same reason it
    /// is on the peer page: the round summary has already said the crawler is
    /// enabled, holds data and finished a round, so a source that then denies
    /// this route is not a source without distributions — it is a source whose
    /// route name this build has fallen behind. Turning that into `Ok(None)`
    /// would publish a `NetworkAtlasClear` and take the readout off the panel
    /// while stating, in the only voice the panel has, that the crawl found
    /// nothing.
    ///
    /// It deliberately does NOT write [`CkbadgerEnrichmentSource::peers_route`].
    /// That flag is what lets the per-peer dossier tell a verdict about a node
    /// from a fault about this build, and it may only be written by a reader of
    /// the route whose 404 the dossier is trying to read — `network/peers`, not
    /// this one. The roster refresh runs on the same minute cadence and keeps
    /// writing it.
    async fn read_network_distributions(&self) -> anyhow::Result<NetworkDistributionsResponse> {
        let url = self.endpoint("network/distributions")?;
        let response = self
            .client
            .get(url)
            .send()
            .await
            .context("fetch ckbadger network distributions")?;
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger network distributions returned HTTP {}",
                response.status()
            ));
        }
        response
            .json()
            .await
            .context("decode ckbadger network distributions")
    }

    /// One bounded, scoped page of the crawler's candidates, and the single
    /// place this crate observes whether the peer list route is answering at
    /// all.
    ///
    /// A 404 here is deliberately an error rather than an absence, which is
    /// the opposite of what this code did under the old route name. The
    /// summary has already said the crawler is enabled, holds data, and
    /// finished a round; a source that then denies the list route is not a
    /// source without a crawler, it is a source whose route this build no
    /// longer knows the name of. The distinction is not academic — the
    /// supervisor turns `Ok(None)` into `NetworkRosterClear`, which takes
    /// every sighted node off stage and states, in the only voice the scene
    /// has, that nobody is crawling. That is how a rename cost the whole
    /// colony twice: silently, and while looking like a healthy report of
    /// nothing.
    ///
    /// It is also the only writer of [`CkbadgerEnrichmentSource::peers_route`],
    /// which is what lets the per-peer dossier refuse to turn its own 404 into
    /// a fact about a peer. The flag records whether the route ANSWERED, not
    /// whether the answer could be read: a page that arrives in a shape this
    /// build cannot decode still proves the route is there, so the mark goes
    /// down before the decode. Each rung of a roster refresh writes it in
    /// turn, which is what it means — the last thing the route did.
    ///
    /// `state` is always sent. It used to be sent to keep hearsay off the
    /// stage, and the record can name hearsay honestly now, so what it does
    /// today is spend the budget in evidence order; [`ROSTER_SCOPES`] carries
    /// that argument. `limit` is never zero: upstream rejects a page of none,
    /// and a caller with nothing left to spend has no reason to ask.
    async fn read_roster_page(
        &self,
        scope: &str,
        limit: usize,
    ) -> anyhow::Result<NetworkPeersPageResponse> {
        debug_assert!(limit > 0, "a roster page with no budget is never asked for");
        let mut peers_url = self.endpoint("network/peers")?;
        peers_url
            .query_pairs_mut()
            .append_pair("state", scope)
            .append_pair("limit", &limit.to_string());
        let response = match self.client.get(peers_url).send().await {
            Ok(response) => response,
            Err(error) => {
                self.note_peers_route(false);
                return Err(error).context("fetch ckbadger bounded network peers");
            }
        };
        self.note_peers_route(response.status().is_success());
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger bounded network peers returned HTTP {}",
                response.status()
            ));
        }
        response
            .json()
            .await
            .context("decode ckbadger bounded network peers")
    }

    /// Record what the peer list route just did. See the `PEERS_ROUTE_*`
    /// constants for why only the list route may write this.
    fn note_peers_route(&self, answering: bool) {
        self.peers_route.store(
            if answering {
                PEERS_ROUTE_ANSWERING
            } else {
                PEERS_ROUTE_FAULTING
            },
            Ordering::Relaxed,
        );
    }

    /// Whether the last look at the peer list route found it broken. Only a
    /// positive answer means anything: an unobserved route is read as one
    /// there is no reason to doubt.
    fn peers_route_is_faulting(&self) -> bool {
        self.peers_route.load(Ordering::Relaxed) == PEERS_ROUTE_FAULTING
    }

    async fn transaction_lifecycle(&self, tx_hash: &str) -> Option<TransactionLifecycleResponse> {
        let url = match self.endpoint(&format!("transactions/{tx_hash}/lifecycle")) {
            Ok(url) => url,
            Err(error) => {
                tracing::debug!(target: "cknerv-adapter-ckbadger", "{error}");
                return None;
            }
        };
        match self.client.get(url).send().await {
            Ok(response) if response.status().is_success() => response
                .json()
                .await
                .map_err(|error| {
                    tracing::debug!(
                        target: "cknerv-adapter-ckbadger",
                        "ckbadger transaction lifecycle decode failed: {error}"
                    );
                })
                .ok(),
            Ok(response) => {
                tracing::debug!(
                    target: "cknerv-adapter-ckbadger",
                    status = %response.status(),
                    "ckbadger transaction lifecycle unavailable"
                );
                None
            }
            Err(error) => {
                tracing::debug!(
                    target: "cknerv-adapter-ckbadger",
                    "ckbadger transaction lifecycle failed: {error}"
                );
                None
            }
        }
    }

    async fn script_lookups(&self, cell: &CellDetailResponse) -> ScriptLookupResponse {
        let mut hashes = vec![cell.lock.code_hash.as_str()];
        if let Some(type_script) = cell.type_script.as_ref() {
            if type_script.code_hash != cell.lock.code_hash {
                hashes.push(type_script.code_hash.as_str());
            }
        }
        let request = LookupScriptsRequest {
            code_hashes: hashes,
            tx_hash: &cell.tx_hash,
        };
        let url = match self.endpoint("scripts/lookup") {
            Ok(url) => url,
            Err(error) => {
                tracing::debug!(target: "cknerv-adapter-ckbadger", "{error}");
                return HashMap::new();
            }
        };
        match self.client.post(url).json(&request).send().await {
            Ok(response) if response.status().is_success() => {
                response.json().await.unwrap_or_else(|error| {
                    tracing::debug!(
                        target: "cknerv-adapter-ckbadger",
                        "ckbadger script lookup decode failed: {error}"
                    );
                    HashMap::new()
                })
            }
            Ok(response) => {
                tracing::debug!(
                    target: "cknerv-adapter-ckbadger",
                    status = %response.status(),
                    "ckbadger script lookup unavailable"
                );
                HashMap::new()
            }
            Err(error) => {
                tracing::debug!(
                    target: "cknerv-adapter-ckbadger",
                    "ckbadger script lookup failed: {error}"
                );
                HashMap::new()
            }
        }
    }

    /// Resolve code hashes to family names. One request: the endpoint takes a
    /// batch, and the whole observed set is tens of hashes.
    ///
    /// `txHash` disambiguates a code hash that several deployed scripts share,
    /// which only happens for data-hash scripts. The census is a set of
    /// identities with no transaction attached, so this asks without that
    /// context and reads `resolutionState` to find out when it mattered — an
    /// unresolved entry is dropped rather than guessed at.
    async fn lookup_script_names(
        &self,
        code_hashes: &[String],
    ) -> anyhow::Result<HashMap<String, ScriptLookupInfo>> {
        if code_hashes.is_empty() {
            return Ok(HashMap::new());
        }
        let url = self.endpoint("scripts/lookup")?;
        let request = LookupScriptsRequest {
            code_hashes: code_hashes.iter().map(String::as_str).collect(),
            tx_hash: UNANCHORED_LOOKUP_TX,
        };
        let response = self
            .client
            .post(url)
            .json(&request)
            .send()
            .await
            .context("fetch ckbadger script lookup")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(HashMap::new());
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger script lookup returned HTTP {}",
                response.status()
            ));
        }
        let looked_up: ScriptLookupResponse = response
            .json()
            .await
            .context("decode ckbadger script lookup")?;
        Ok(looked_up
            .into_iter()
            .filter(|(_, info)| {
                info.resolution_state == "resolved" && is_real_script_name(&info.name)
            })
            .collect())
    }

    /// The script-family catalogue, keyed by name. Bounded and fixed-shape:
    /// one page holds every family the index tracks.
    async fn script_catalogue(&self) -> anyhow::Result<HashMap<String, ScriptFamilyResponse>> {
        let mut url = self.endpoint("scripts")?;
        url.query_pairs_mut()
            .append_pair("limit", &SCRIPT_CATALOGUE_LIMIT.to_string());
        let response = self
            .client
            .get(url)
            .send()
            .await
            .context("fetch ckbadger script catalogue")?;
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger script catalogue returned HTTP {}",
                response.status()
            ));
        }
        let catalogue: ScriptCatalogueResponse = response
            .json()
            .await
            .context("decode ckbadger script catalogue")?;
        Ok(catalogue
            .data
            .into_iter()
            .map(|family| (family.name.clone(), family))
            .collect())
    }

    async fn token_asset(&self, cell: &CellDetailResponse) -> Option<SemanticAsset> {
        match self.fetch_token_asset(cell).await {
            Ok(asset) => asset,
            Err(error) => {
                tracing::debug!(
                    target: "cknerv-adapter-ckbadger",
                    "ckbadger token identity unavailable: {error}"
                );
                None
            }
        }
    }

    async fn fetch_token_asset(
        &self,
        cell: &CellDetailResponse,
    ) -> anyhow::Result<Option<SemanticAsset>> {
        let Some((type_script_hash, amount)) = udt_asset_request(cell)? else {
            return Ok(None);
        };
        let url = self.endpoint(&format!("tokens/{type_script_hash}"))?;
        let response = self
            .client
            .get(url)
            .send()
            .await
            .context("fetch ckbadger token identity")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger token identity returned HTTP {}",
                response.status()
            ));
        }
        let token: TokenResponse = response
            .json()
            .await
            .context("decode ckbadger token identity")?;
        if token.type_script_hash != type_script_hash {
            return Err(anyhow!("ckbadger returned a different token identity"));
        }
        let decimals = token
            .decimals
            .map(u8::try_from)
            .transpose()
            .context("ckbadger returned invalid token decimals")?;
        Ok(Some(SemanticAsset {
            type_script_hash,
            standard: nonempty(token.standard),
            name: token.name.and_then(nonempty),
            symbol: token.symbol.and_then(nonempty),
            amount: Some(amount),
            decimals,
        }))
    }

    /// The two things a digital object's Cell cannot say about itself: which
    /// collection it belongs to, and where its content physically lives.
    ///
    /// Neither is legible from the Cell alone. SporeData puts the cluster id
    /// after the content bytes, so the bounded `data` prefix never reaches it
    /// and every object's type script looks alike on the wire; the storage
    /// tier is a measurement ckbadger's decode worker makes, not a claim the
    /// Cell carries. What a spore Cell does carry is the decode segment naming
    /// its cluster, and that is precisely what lets the object lookup and the
    /// cluster lookup run side by side instead of one behind the other.
    ///
    /// M-NFT reaches the same two answers by a shorter road. Its decode
    /// segments are the token's own fields and name no class at all, but its
    /// type script does: the first 24 bytes of the args are the issuer and
    /// class ids that both a token cell and its class cell are keyed by. One
    /// collection lookup answers both questions, because ckbadger's asset
    /// index states a collection's composition on the collection itself —
    /// there is no per-item media profile upstream to ask for.
    ///
    /// A Cell that is neither family costs zero requests. Every request that
    /// is made degrades alone: whichever half answers still becomes a facet.
    async fn object_enrichment(&self, cell: &CellDetailResponse) -> Vec<SemanticFacet> {
        let Some(decoded) = cell
            .data_analysis
            .as_ref()
            .and_then(|analysis| analysis.deterministic.as_ref())
        else {
            return Vec::new();
        };
        let args = cell.type_script.as_ref().map(|script| script.args.as_str());
        match decoded.kind.as_str() {
            "spore_cell" => {
                let segment = decoded
                    .segments
                    .iter()
                    .find(|segment| segment.label == "cluster_id")
                    .map(|segment| segment.human_value.as_str());
                // An object's role is derived from the segment, so a segment
                // that is absent or unreadable leaves the role unknown — and
                // unknown is never dressed up as sole. It earns no collection
                // facet, while the storage question is still asked.
                let (role, cluster_id) = match segment {
                    Some(id) if is_hash32(id) => (Some("item"), Some(id)),
                    Some(SPORE_NO_CLUSTER) => (Some("sole_item"), None),
                    _ => (None, None),
                };
                let spore_id = args.filter(|args| is_hash32(args));
                let (item, cluster) =
                    tokio::join!(self.spore_object(spore_id), self.spore_cluster(cluster_id));
                map_object_facets("spore", role, cluster_id, item, cluster.map(Into::into))
            }
            // A cluster Cell states its role by being one, so the role holds
            // even when its args are not an id anything can be looked up by.
            "spore_cluster_cell" => {
                let cluster_id = args.filter(|args| is_hash32(args));
                let cluster = self.spore_cluster(cluster_id).await;
                map_object_facets(
                    "spore",
                    Some("cluster"),
                    cluster_id,
                    None,
                    cluster.map(Into::into),
                )
            }
            // A token cell descends from its class, a class cell is one; both
            // are keyed by the same 24 bytes. Args too short to hold them name
            // no collection, so nothing is claimed and nothing is asked.
            kind @ ("mnft_token_cell" | "mnft_class_cell") => {
                let Some(collection_id) = mnft_collection_id(args) else {
                    return Vec::new();
                };
                let role = match kind {
                    "mnft_token_cell" => "item",
                    _ => "cluster",
                };
                let collection = self.nft_collection(&collection_id).await;
                map_object_facets(
                    "mnft",
                    Some(role),
                    Some(&collection_id),
                    None,
                    collection.map(Into::into),
                )
            }
            _ => Vec::new(),
        }
    }

    /// One object's storage measurement. A `None` id is a spore Cell whose
    /// type args are not a 32-byte object id: nothing to ask about, so nothing
    /// is asked.
    async fn spore_object(&self, spore_id: Option<&str>) -> Option<SporeItemResponse> {
        let spore_id = spore_id?;
        match self.fetch_spore_object(spore_id).await {
            Ok(item) => item,
            Err(error) => {
                tracing::debug!(
                    target: "cknerv-adapter-ckbadger",
                    "ckbadger spore object unavailable: {error}"
                );
                None
            }
        }
    }

    async fn fetch_spore_object(
        &self,
        spore_id: &str,
    ) -> anyhow::Result<Option<SporeItemResponse>> {
        let url = self.endpoint(&format!("spore/objects/{spore_id}"))?;
        let response = self
            .client
            .get(url)
            .send()
            .await
            .context("fetch ckbadger spore object")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger spore object returned HTTP {}",
                response.status()
            ));
        }
        let item: SporeItemResponse = response
            .json()
            .await
            .context("decode ckbadger spore object")?;
        Ok(Some(item))
    }

    /// One collection's facts. A `None` id is a Cell that named no cluster it
    /// could be looked up by — a sole object, or one whose decode said nothing.
    async fn spore_cluster(&self, cluster_id: Option<&str>) -> Option<ClusterDetailResponse> {
        let cluster_id = cluster_id?;
        match self.fetch_spore_cluster(cluster_id).await {
            Ok(cluster) => cluster,
            Err(error) => {
                tracing::debug!(
                    target: "cknerv-adapter-ckbadger",
                    "ckbadger spore cluster unavailable: {error}"
                );
                None
            }
        }
    }

    async fn fetch_spore_cluster(
        &self,
        cluster_id: &str,
    ) -> anyhow::Result<Option<ClusterDetailResponse>> {
        let url = self.endpoint(&format!("spore/clusters/{cluster_id}"))?;
        let response = self
            .client
            .get(url)
            .send()
            .await
            .context("fetch ckbadger spore cluster")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger spore cluster returned HTTP {}",
                response.status()
            ));
        }
        let cluster: ClusterDetailResponse = response
            .json()
            .await
            .context("decode ckbadger spore cluster")?;
        Ok(Some(cluster))
    }

    /// One M-NFT collection's facts and its population's composition. Unlike
    /// the spore pair this is a single call, because the asset index answers
    /// both from the class: an M-NFT token has no media profile of its own to
    /// measure.
    async fn nft_collection(&self, collection_id: &str) -> Option<NftCollectionDetailResponse> {
        match self.fetch_nft_collection(collection_id).await {
            Ok(collection) => collection,
            Err(error) => {
                tracing::debug!(
                    target: "cknerv-adapter-ckbadger",
                    "ckbadger nft collection unavailable: {error}"
                );
                None
            }
        }
    }

    async fn fetch_nft_collection(
        &self,
        collection_id: &str,
    ) -> anyhow::Result<Option<NftCollectionDetailResponse>> {
        let url = self.endpoint(&format!("assets/objects/{collection_id}"))?;
        let response = self
            .client
            .get(url)
            .send()
            .await
            .context("fetch ckbadger nft collection")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger nft collection returned HTTP {}",
                response.status()
            ));
        }
        let collection: NftCollectionDetailResponse = response
            .json()
            .await
            .context("decode ckbadger nft collection")?;
        Ok(Some(collection))
    }

    fn to_record(
        &self,
        cell: CellDetailResponse,
        anchor: ChainAnchor,
        lookups: &ScriptLookupResponse,
        asset: Option<SemanticAsset>,
        object_facets: Vec<SemanticFacet>,
    ) -> anyhow::Result<CellSemanticRecord> {
        let created_at_block = u64::try_from(cell.created_at_block)
            .map_err(|_| anyhow!("ckbadger returned a negative Cell creation block"))?;
        if created_at_block > anchor.block {
            return Err(anyhow!(
                "ckbadger Cell was created at block {created_at_block}, ahead of validated anchor {}",
                anchor.block
            ));
        }
        let output_index = u32::try_from(cell.output_index)
            .map_err(|_| anyhow!("ckbadger returned a negative Cell output index"))?;
        let lock_script = Some(map_script(cell.lock, cell.lock_script_hash, lookups));
        let type_script = cell
            .type_script
            .zip(cell.type_script_hash)
            .map(|(script, script_hash)| map_script(script, script_hash, lookups));
        let common_knowledge = map_common_knowledge(
            cell.common_knowledge_size_breakdown,
            cell.common_knowledge_size,
        )?;
        let content = map_cell_content(cell.data_size, cell.data, cell.data_analysis)?;
        let consumed = map_consumption(
            cell.status.as_deref(),
            cell.consumed_at_block,
            cell.consumed_by_tx,
        )?;
        if common_knowledge.data_bytes != content.total_bytes {
            return Err(anyhow!(
                "ckbadger Cell dataSize is {} bytes, but occupied-capacity dataBytes is {}",
                content.total_bytes,
                common_knowledge.data_bytes
            ));
        }
        let mut facets = Vec::new();
        if cell.is_dep_group {
            let mut attributes = Vec::new();
            if let Some(items) = cell.dep_group_items {
                attributes.push(SemanticAttribute {
                    key: "members".to_string(),
                    value: items.len().to_string(),
                    unit: None,
                });
                for (index, item) in items.into_iter().take(8).enumerate() {
                    attributes.push(SemanticAttribute {
                        key: format!("member_{index}"),
                        value: format!("{}:{}", item.tx_hash, item.output_index),
                        unit: None,
                    });
                }
            }
            facets.push(SemanticFacet {
                namespace: "ckb".to_string(),
                kind: "dep_group".to_string(),
                state: None,
                attributes,
            });
        }
        if let Some(scripts) = cell.code_cell_of {
            facets.extend(scripts.into_iter().map(|script| SemanticFacet {
                namespace: "ckb".to_string(),
                kind: "code_cell".to_string(),
                state: Some(script.name),
                attributes: vec![
                    SemanticAttribute {
                        key: "code_hash".to_string(),
                        value: script.code_hash,
                        unit: None,
                    },
                    SemanticAttribute {
                        key: "hash_type".to_string(),
                        value: script.hash_type,
                        unit: None,
                    },
                ],
            }));
        }
        if let Some(dao) = cell.dao_info {
            facets.push(dao_facet(dao)?);
        }
        facets.extend(object_facets);
        Ok(CellSemanticRecord {
            out_point: OutPoint {
                tx_hash: cell.tx_hash,
                index: output_index,
            },
            source: self.name().to_string(),
            as_of: anchor,
            observed_at_block: created_at_block,
            updated_at_ms: now_ms(),
            address: cell.address,
            cell_type: cell.cell_type,
            lock_script,
            type_script,
            asset,
            common_knowledge: Some(common_knowledge),
            content: Some(content),
            consumed,
            facets,
        })
    }

    fn to_transaction_record(
        &self,
        transaction: TransactionDetailResponse,
        lifecycle: Option<TransactionLifecycleResponse>,
        anchor: ChainAnchor,
    ) -> anyhow::Result<TransactionSemanticRecord> {
        if transaction.status != "committed" {
            return Err(anyhow!(
                "ckbadger transaction detail is not committed: {}",
                transaction.status
            ));
        }
        let block = transaction
            .block_number
            .ok_or_else(|| anyhow!("ckbadger committed transaction has no block number"))
            .and_then(|value| nonnegative(value, "transaction blockNumber"))?;
        if block > anchor.block {
            return Err(anyhow!(
                "ckbadger transaction was committed at block {block}, ahead of validated anchor {}",
                anchor.block
            ));
        }
        let block_hash = transaction
            .block_hash
            .as_deref()
            .ok_or_else(|| anyhow!("ckbadger committed transaction has no block hash"))?;
        if !is_hash32(block_hash) {
            return Err(anyhow!(
                "ckbadger committed transaction has an invalid block hash"
            ));
        }
        unsigned_decimal(&transaction.fee, "transaction fee")?;

        let participants = transaction_participants(&transaction)?;
        let mut actions = vec![transaction_io_facet(&transaction)?];
        if let Some(lifecycle) = lifecycle {
            actions.push(transaction_lifecycle_facet(&transaction, lifecycle)?);
        }
        let cycles = transaction
            .cycles
            .filter(|value| *value > 0)
            .map(|value| {
                u64::try_from(value).context("ckbadger returned invalid transaction cycles")
            })
            .transpose()?;

        Ok(TransactionSemanticRecord {
            tx_hash: transaction.hash,
            block,
            source: self.name().to_string(),
            as_of: anchor,
            updated_at_ms: now_ms(),
            actions,
            participants,
            fee: Some(transaction.fee),
            cycles,
        })
    }

    /// Which `(code_hash, hash_type)` each identity collection on the
    /// inventory ranking stands for.
    ///
    /// ckbadger publishes no collection → code-hash route and the identity
    /// collection ids are synthetic ASCII, so the only thing that knows the
    /// pair is cknerv's own census joined against the registry's names. One
    /// lookup, deduped by code hash exactly as the registry enrichment does.
    ///
    /// Never fatal. An empty census defers the identity rows by one
    /// composition (R1), and a lookup that fails costs the same rows — about
    /// a twentieth of the typed class — rather than the ninety-five percent
    /// that needed no census at all.
    async fn identity_families(
        &self,
        context: &CanonicalContext,
    ) -> HashMap<IdentityStandard, ScriptId> {
        if context.observed_scripts.is_empty() {
            return HashMap::new();
        }
        let mut hashes: Vec<String> = Vec::new();
        for script in &context.observed_scripts {
            let hex = script.code_hash_hex();
            if !hashes.contains(&hex) {
                hashes.push(hex);
            }
        }
        hashes.truncate(MAX_SCRIPT_REGISTRY_ENTRIES);
        let named = match self.lookup_script_names(&hashes).await {
            Ok(named) => named,
            Err(error) => {
                tracing::warn!(
                    target: "cknerv-adapter-ckbadger",
                    "the script lookup that names identity families failed; \
                     their ranked collections sit out this composition: {error:#}"
                );
                return HashMap::new();
            }
        };
        galaxy_identity_families(&context.observed_scripts, |code_hash| {
            named.get(code_hash).map(|info| info.name.as_str())
        })
    }
}

#[async_trait]
impl EnrichmentSource for CkbadgerEnrichmentSource {
    fn name(&self) -> &'static str {
        "ckbadger"
    }

    fn capabilities(&self) -> Vec<String> {
        let mut capabilities: Vec<_> = CAPABILITIES
            .iter()
            .map(|value| (*value).to_string())
            .collect();
        if self.galaxy_hydrator.is_some() && self.galaxy_composition_target > 0 {
            capabilities.push(GALAXY_COMPOSITION_CAPABILITY.to_string());
        }
        capabilities
    }

    async fn probe(&self, context: &CanonicalContext) -> EnrichmentSourceStatus {
        let mut status = self.status(EnrichmentSourceState::Connecting);
        if context.replay_active || context.recent_blocks.is_empty() {
            self.clear_anchor();
            status.status = EnrichmentSourceState::Syncing;
            status.message = Some(if context.replay_active {
                "waiting for canonical replay to complete".to_string()
            } else {
                "waiting for canonical block evidence".to_string()
            });
            return status;
        }

        let network_url = match self.endpoint("statistics/network") {
            Ok(url) => url,
            Err(error) => {
                self.clear_anchor();
                status.status = EnrichmentSourceState::Error;
                status.message = Some(error.to_string());
                return status;
            }
        };
        let network: NetworkStats = match self.client.get(network_url).send().await {
            Ok(response) if response.status().is_success() => match response.json().await {
                Ok(network) => network,
                Err(error) => {
                    self.clear_anchor();
                    status.status = EnrichmentSourceState::Error;
                    status.message = Some(format!("decode ckbadger network status: {error}"));
                    return status;
                }
            },
            Ok(response) => {
                self.clear_anchor();
                status.status = EnrichmentSourceState::Error;
                status.message = Some(format!(
                    "ckbadger network status returned HTTP {}",
                    response.status()
                ));
                return status;
            }
            Err(error) => {
                self.clear_anchor();
                status.status = EnrichmentSourceState::Error;
                status.message = Some(format!("connect to ckbadger: {error}"));
                return status;
            }
        };

        let indexed_tip = match u64::try_from(network.sync_status.synced_block) {
            Ok(tip) => tip,
            Err(_) => {
                self.clear_anchor();
                status.status = EnrichmentSourceState::Error;
                status.message = Some("ckbadger returned a negative indexed tip".to_string());
                return status;
            }
        };
        status.indexed_tip = Some(indexed_tip);
        status.lag_blocks = Some(context.tip.saturating_sub(indexed_tip));

        let Some(canonical) = context
            .recent_blocks
            .iter()
            .filter(|block| block.number <= indexed_tip)
            .max_by_key(|block| block.number)
        else {
            self.clear_anchor();
            status.status = EnrichmentSourceState::Syncing;
            status.message =
                Some("ckbadger tip is behind cknerv's retained block-hash evidence".to_string());
            return status;
        };
        let block_url = match self.endpoint(&format!("blocks/{}", canonical.number)) {
            Ok(url) => url,
            Err(error) => {
                self.clear_anchor();
                status.status = EnrichmentSourceState::Error;
                status.message = Some(error.to_string());
                return status;
            }
        };
        let indexed_block: BlockResponse = match self.client.get(block_url).send().await {
            Ok(response) if response.status().is_success() => match response.json().await {
                Ok(block) => block,
                Err(error) => {
                    self.clear_anchor();
                    status.status = EnrichmentSourceState::Error;
                    status.message = Some(format!("decode ckbadger block anchor: {error}"));
                    return status;
                }
            },
            Ok(response) => {
                self.clear_anchor();
                status.status = EnrichmentSourceState::Error;
                status.message = Some(format!(
                    "ckbadger block anchor returned HTTP {}",
                    response.status()
                ));
                return status;
            }
            Err(error) => {
                self.clear_anchor();
                status.status = EnrichmentSourceState::Error;
                status.message = Some(format!("fetch ckbadger block anchor: {error}"));
                return status;
            }
        };
        if indexed_block.number != canonical.number as i64 || indexed_block.hash != canonical.hash {
            self.clear_anchor();
            status.status = EnrichmentSourceState::Incompatible;
            status.message = Some(format!(
                "block {} hash differs between CKB and ckbadger",
                canonical.number
            ));
            return status;
        }

        let anchor = ChainAnchor {
            block: canonical.number,
            hash: canonical.hash.clone(),
        };
        *self.validated_anchor.write().unwrap() = Some(anchor.clone());
        status.validated_anchor = Some(anchor);
        status.last_success_at_ms = Some(now_ms());
        let lag = status.lag_blocks.unwrap_or(0);
        status.status = if network.sync_status.is_syncing {
            EnrichmentSourceState::Syncing
        } else if lag > self.max_lag_blocks {
            EnrichmentSourceState::Stale
        } else {
            EnrichmentSourceState::Ready
        };
        if status.status == EnrichmentSourceState::Stale {
            status.message = Some(format!("ckbadger is {lag} blocks behind CKB"));
        }
        status
    }

    async fn enrich_cell(
        &self,
        out_point: &OutPoint,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<CellSemanticRecord>> {
        if !is_hash32(&out_point.tx_hash) {
            return Err(anyhow!(
                "Cell transaction hash must be 0x-prefixed 32-byte hex"
            ));
        }
        let requested_index = i32::try_from(out_point.index)
            .context("Cell output index is outside ckbadger's API range")?;
        let anchor = self.current_anchor(context)?;
        let url = self.endpoint(&format!("cells/{}/{}", out_point.tx_hash, out_point.index))?;
        let response = self
            .client
            .get(url)
            .send()
            .await
            .context("fetch ckbadger Cell detail")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger Cell detail returned HTTP {}",
                response.status()
            ));
        }
        let cell: CellDetailResponse = response
            .json()
            .await
            .context("decode ckbadger Cell detail")?;
        if cell.tx_hash != out_point.tx_hash || cell.output_index != requested_index {
            return Err(anyhow!("ckbadger returned a different outpoint"));
        }
        let (lookups, asset, object_facets) = tokio::join!(
            self.script_lookups(&cell),
            self.token_asset(&cell),
            self.object_enrichment(&cell)
        );
        let record = self.to_record(cell, anchor.clone(), &lookups, asset, object_facets)?;
        self.revalidate_anchor(&anchor, "Cell detail").await?;
        Ok(Some(record))
    }

    async fn enrich_transaction(
        &self,
        tx_hash: &str,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<TransactionSemanticRecord>> {
        if !is_hash32(tx_hash) {
            return Err(anyhow!("transaction hash must be 0x-prefixed 32-byte hex"));
        }
        let anchor = self.current_anchor(context)?;
        let detail_url = self.endpoint(&format!("transactions/{tx_hash}/detail"))?;
        let response = self
            .client
            .get(detail_url)
            .send()
            .await
            .context("fetch ckbadger transaction detail")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger transaction detail returned HTTP {}",
                response.status()
            ));
        }
        let transaction: TransactionDetailResponse = response
            .json()
            .await
            .context("decode ckbadger transaction detail")?;
        if transaction.hash != tx_hash {
            return Err(anyhow!("ckbadger returned a different transaction"));
        }
        let lifecycle = self.transaction_lifecycle(tx_hash).await;
        let record = self.to_transaction_record(transaction, lifecycle, anchor.clone())?;
        self.revalidate_anchor(&anchor, "transaction detail")
            .await?;
        Ok(Some(record))
    }

    async fn enrich_asset_ecosystem(
        &self,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<AssetEcosystemRecord>> {
        let anchor = self.current_anchor(context)?;
        let url = self.endpoint("statistics/asset-ecosystem")?;
        let response = self
            .client
            .get(url)
            .send()
            .await
            .context("fetch ckbadger asset ecosystem")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger asset ecosystem returned HTTP {}",
                response.status()
            ));
        }
        let ecosystem: AssetEcosystemResponse = response
            .json()
            .await
            .context("decode ckbadger asset ecosystem")?;
        let record = map_asset_ecosystem(ecosystem, anchor.clone())?;
        self.revalidate_anchor(&anchor, "asset ecosystem").await?;
        Ok(Some(record))
    }

    async fn enrich_dao_state(
        &self,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<DaoStateRecord>> {
        let anchor = self.current_anchor(context)?;
        let url = self.endpoint("dao/statistics")?;
        let response = self
            .client
            .get(url)
            .send()
            .await
            .context("fetch ckbadger DAO statistics")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger DAO statistics returned HTTP {}",
                response.status()
            ));
        }
        let statistics: DaoStatisticsResponse = response
            .json()
            .await
            .context("decode ckbadger DAO statistics")?;
        let record = map_dao_state(statistics, anchor.clone())?;
        if record.is_some() {
            self.revalidate_anchor(&anchor, "DAO state").await?;
        }
        Ok(record)
    }

    async fn enrich_chain_census(
        &self,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<ChainCensus>> {
        // A validated anchor still gates the capability (the supervisor will
        // not dispatch without one), but this record is NOT anchored at it:
        // the counts are exact at the summary's own tip, so that is the block
        // the dashboard has to print beside them. `map_chain_census` proves
        // that tip against the local node's canonical evidence, which is a
        // stronger fence than re-reading the index — a source-side reorg
        // during the fetch yields a hash our own chain does not hold.
        self.current_anchor(context)?;
        let url = self.endpoint("cells/live-summary")?;
        let response = self
            .client
            .get(url)
            .send()
            .await
            .context("fetch ckbadger live cell summary")?;
        // `503 initializing` (bulk sync, or a reorg withdrew the record) and
        // `500` (corrupt record) both mean the source is deliberately
        // declining to state a number. Withhold; never synthesize a zero.
        if matches!(
            response.status(),
            StatusCode::NOT_FOUND
                | StatusCode::SERVICE_UNAVAILABLE
                | StatusCode::INTERNAL_SERVER_ERROR
        ) {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger live cell summary returned HTTP {}",
                response.status()
            ));
        }
        let summary: LiveCellSummaryResponse = response
            .json()
            .await
            .context("decode ckbadger live cell summary")?;
        map_chain_census(summary, context)
    }

    async fn enrich_protocol_era(
        &self,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<ProtocolEraRecord>> {
        let Some(expected_network) = ckbadger_network(&context.chain_name) else {
            return Ok(None);
        };
        let anchor = self.current_anchor(context)?;
        let url = self.endpoint("hardforks")?;
        let response = self
            .client
            .get(url)
            .send()
            .await
            .context("fetch ckbadger hardfork timeline")?;
        if matches!(
            response.status(),
            StatusCode::NOT_FOUND | StatusCode::BAD_REQUEST
        ) {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger hardfork timeline returned HTTP {}",
                response.status()
            ));
        }
        let timeline: HardforkTimelineResponse = response
            .json()
            .await
            .context("decode ckbadger hardfork timeline")?;
        let record = map_protocol_era(
            timeline,
            expected_network,
            anchor.clone(),
            context.epoch_number,
        )?;
        if record.is_some() {
            self.revalidate_anchor(&anchor, "protocol era").await?;
        }
        Ok(record)
    }

    async fn enrich_fork_watch(
        &self,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<ForkWatchRecord>> {
        let url = self.endpoint("forks/recent")?;
        let response = self
            .client
            .get(url)
            .send()
            .await
            .context("fetch ckbadger fork watch")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger fork watch returned HTTP {}",
                response.status()
            ));
        }
        let watch: RecentReorgResponse = response
            .json()
            .await
            .context("decode ckbadger fork watch")?;
        if watch.deep_fork.detected {
            let Some(anchor) = deep_fork_canonical_anchor(&watch, context)? else {
                return Ok(None);
            };
            return map_fork_watch(watch, anchor);
        }

        // Ordinary recent history remains coupled to the source's normal
        // compatibility proof. An active deep fork is different: the index is
        // expected to be incompatible, so its live-chain hash is validated
        // directly above instead.
        let Ok(anchor) = self.current_anchor(context) else {
            return Ok(None);
        };
        let record = map_fork_watch(watch, anchor.clone())?;
        if record.is_some() {
            self.revalidate_anchor(&anchor, "fork watch").await?;
        }
        Ok(record)
    }

    async fn enrich_activity_feed(
        &self,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<ActivityFeedRecord>> {
        let anchor = self.current_anchor(context)?;
        let mut url = self.endpoint("activities/latest")?;
        url.query_pairs_mut()
            .append_pair("limit", &ACTIVITY_FEED_LIMIT.to_string());
        let response = self
            .client
            .get(url)
            .send()
            .await
            .context("fetch ckbadger latest activities")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger latest activities returned HTTP {}",
                response.status()
            ));
        }
        let activities: Vec<LatestActivityResponse> = response
            .json()
            .await
            .context("decode ckbadger latest activities")?;
        let record = map_activity_feed(activities, anchor.clone())?;
        self.revalidate_anchor(&anchor, "activity feed").await?;
        Ok(Some(record))
    }

    async fn enrich_transaction_horizon(
        &self,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<TransactionHorizonRecord>> {
        let anchor = self.current_anchor(context)?;
        let statistics_url = self.endpoint("statistics/tx-stats")?;
        let response = self
            .client
            .get(statistics_url)
            .send()
            .await
            .context("fetch ckbadger transaction horizon")?;
        if matches!(
            response.status(),
            StatusCode::NOT_FOUND | StatusCode::BAD_REQUEST
        ) {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger transaction horizon returned HTTP {}",
                response.status()
            ));
        }
        let statistics: TransactionStatsResponse = response
            .json()
            .await
            .context("decode ckbadger transaction horizon")?;

        // The summary itself has no tip field and statistics/network is
        // cached independently. Prove that the source has not advanced beyond
        // the validated upper bound, then perform the shared final anchor
        // proof immediately before admitting the result.
        let successor = anchor
            .block
            .checked_add(1)
            .ok_or_else(|| anyhow!("validated transaction-horizon anchor has no successor"))?;
        let successor_url = self.endpoint(&format!("blocks/{successor}"))?;
        let response = self
            .client
            .get(successor_url)
            .send()
            .await
            .context("check ckbadger transaction-horizon upper bound")?;
        if response.status().is_success() {
            return Ok(None);
        }
        if response.status() != StatusCode::NOT_FOUND {
            return Err(anyhow!(
                "ckbadger transaction-horizon upper-bound check returned HTTP {}",
                response.status()
            ));
        }

        let record = map_transaction_horizon(statistics, anchor.clone())?;
        self.revalidate_anchor(&anchor, "transaction horizon")
            .await?;
        Ok(Some(record))
    }

    async fn enrich_network_atlas(
        &self,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<NetworkAtlasRecord>> {
        let anchor = self.current_anchor(context)?;
        let Some(summary) = self.read_crawler_round().await? else {
            return Ok(None);
        };
        let distributions = self.read_network_distributions().await?;
        let record = map_network_atlas(summary, distributions, anchor.clone())?;
        self.revalidate_anchor(&anchor, "network atlas").await?;
        Ok(Some(record))
    }

    async fn enrich_network_roster(
        &self,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<NetworkRosterRecord>> {
        let anchor = self.current_anchor(context)?;
        let Some((summary, pages)) = self.read_crawler(ROSTER_CAP).await? else {
            return Ok(None);
        };
        let record = map_network_roster(summary, pages, anchor.clone())?;
        self.revalidate_anchor(&anchor, "network roster").await?;
        Ok(Some(record))
    }

    async fn enrich_peer(
        &self,
        node_id: &str,
        context: &CanonicalContext,
    ) -> anyhow::Result<PeerSightingLookup> {
        // An id we cannot read is a fact about our own peer list, not a
        // question worth putting to the source: no request is made.
        let Some(peer_hex) = peer_id_to_hex(node_id) else {
            return Ok(PeerSightingLookup::unsighted(
                PeerSightingAbsence::UnreadableNodeId,
            ));
        };
        let anchor = self.current_anchor(context)?;
        let url = self.endpoint(&format!("network/peers/{peer_hex}"))?;
        let response = self
            .client
            .get(url)
            .send()
            .await
            .context("fetch ckbadger peer detail")?;
        if response.status() == StatusCode::NOT_FOUND {
            // A 404 is two different answers wearing one status, and which
            // one it is depends on something this request cannot see. If the
            // peer list route is not answering either, the whole peer API is
            // gone — renamed, most likely, which is how this exact line came
            // to print `NEVER SEEN FROM OUTSIDE` under every peer on the
            // dashboard while the crawler sat there healthy. That is a fault
            // about cknerv, not a fact about the node, and the plate has a
            // voice for faults.
            if self.peers_route_is_faulting() {
                return Err(anyhow!(
                    "ckbadger peer detail answered HTTP 404 while its peer list route is not \
                     answering: this is a fault in the peer API, not a report about the node"
                ));
            }
            // The route is there and holds nothing under this id — not a
            // verification, and not even an address somebody advertised.
            // Under the old route this was the weaker "no verified record";
            // the route it now asks answers for every peer anyone has named,
            // so a miss here means the network has never named this node
            // where this crawler could hear it.
            return Ok(PeerSightingLookup::unsighted(
                PeerSightingAbsence::NeverSighted,
            ));
        }
        if !response.status().is_success() {
            return Err(anyhow!(
                "ckbadger peer detail returned HTTP {}",
                response.status()
            ));
        }
        let detail: PeerDetailResponse = response
            .json()
            .await
            .context("decode ckbadger peer detail")?;
        let lookup = map_peer_lookup(node_id, &peer_hex, detail, anchor.clone())?;
        self.revalidate_anchor(&anchor, "peer sighting").await?;
        Ok(lookup)
    }

    async fn enrich_script_registry(
        &self,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<ScriptRegistryRecord>> {
        // Nothing on stage yet: the Cell projection has not published a
        // census, so there is nothing to name and no request worth making.
        if context.observed_scripts.is_empty() {
            return Ok(None);
        }
        let anchor = self.current_anchor(context)?;

        // Dedup by code hash. The census reports (code_hash, hash_type)
        // pairs and lookup keys on the hash alone, so two hash types over
        // one deployed script are one question.
        let mut hashes: Vec<String> = Vec::new();
        for script in &context.observed_scripts {
            let hex = script.code_hash_hex();
            if !hashes.contains(&hex) {
                hashes.push(hex);
            }
        }
        hashes.truncate(MAX_SCRIPT_REGISTRY_ENTRIES);

        let lookups = self.lookup_script_names(&hashes).await?;
        // The catalogue is what carries descriptions and websites; a
        // failure there costs those fields and nothing else, so it is not
        // allowed to fail the record.
        let catalogue = self.script_catalogue().await.unwrap_or_default();

        let mut entries = Vec::with_capacity(lookups.len());
        for script in &context.observed_scripts {
            let hex = script.code_hash_hex();
            let Some(info) = lookups.get(&hex) else {
                continue;
            };
            let hash_type = hash_type_wire(script.hash_type);
            if entries.iter().any(|entry: &ScriptNameRecord| {
                entry.code_hash == hex && entry.hash_type == hash_type
            }) {
                continue;
            }
            let family = catalogue.get(&info.name);
            entries.push(ScriptNameRecord {
                code_hash: hex,
                hash_type,
                name: info.name.clone(),
                description: family.and_then(|f| f.description.clone()),
                kind: info
                    .script_kind
                    .clone()
                    .or_else(|| family.and_then(|f| f.script_kind.clone())),
                website: family.and_then(|f| f.website.clone()),
                deprecated: info.deprecated,
            });
        }
        let unresolved = context
            .observed_scripts
            .len()
            .saturating_sub(entries.len())
            .min(u32::MAX as usize) as u32;

        self.revalidate_anchor(&anchor, "script registry").await?;
        Ok(Some(ScriptRegistryRecord {
            source: "ckbadger".to_string(),
            as_of: anchor,
            updated_at_ms: now_ms(),
            entries,
            unresolved,
        }))
    }

    async fn enrich_galaxy_composition(
        &self,
        context: &CanonicalContext,
    ) -> anyhow::Result<Option<GalaxyCompositionRecord>> {
        let Some(hydrator) = self.galaxy_hydrator.as_ref() else {
            return Ok(None);
        };
        if self.galaxy_composition_target == 0 {
            return Ok(None);
        }

        let anchor = self.current_anchor(context)?;
        let identity_families = self.identity_families(context).await;
        let candidates = discover_galaxy_composition(
            &self.client,
            &self.api_base,
            anchor.clone(),
            self.galaxy_composition_target,
            &identity_families,
            now_ms(),
        )
        .await?;
        // Avoid a large canonical RPC batch if the indexed view moved while
        // the bounded discovery requests were in flight.
        self.revalidate_anchor(&anchor, "CellGalaxy composition discovery")
            .await?;
        // What the tail must resume past — captured before the hydrator
        // consumes the batch, but not CLAIMED until this discovery actually
        // produced a record. Marking first meant a hydration failure, or an
        // anchor that moved under the node batch, burned a composition's
        // worth of tail depth on cells nobody was ever handed: the retry
        // re-discovered the same head, the tail skipped it as already
        // emitted, and the shortfall never closed.
        let claimed: Vec<OutPoint> = candidates
            .dao
            .iter()
            .chain(&candidates.typed)
            .chain(&candidates.plain)
            .map(|candidate| candidate.out_point.clone())
            .collect();
        let record = hydrator.hydrate_galaxy_composition(candidates).await?;
        if record.source != self.name() || record.as_of != anchor {
            return Err(anyhow!(
                "CellGalaxy composition hydrator changed its source anchor"
            ));
        }
        self.revalidate_anchor(&anchor, "CellGalaxy composition")
            .await?;
        self.candidate_tail
            .lock()
            .await
            .note_emitted(claimed.iter());
        Ok(Some(record))
    }

    async fn enrich_galaxy_top_up(
        &self,
        context: &CanonicalContext,
        demand: CompositionDemand,
    ) -> anyhow::Result<Option<GalaxyCompositionTopUp>> {
        let Some(hydrator) = self.galaxy_hydrator.as_ref() else {
            return Ok(None);
        };
        if self.galaxy_composition_target == 0 || !demand.curated || demand.is_empty() {
            return Ok(None);
        }
        let want_dao = demand.dao.min(TOP_UP_CANDIDATES_PER_CLASS);
        let want_typed = demand.typed.min(TOP_UP_CANDIDATES_PER_CLASS);

        let anchor = self.current_anchor(context)?;
        let identity_families = self.identity_families(context).await;
        let candidates = {
            let mut tail = self.candidate_tail.lock().await;
            top_up_galaxy_composition(
                &self.client,
                &self.api_base,
                anchor.clone(),
                &mut tail,
                want_dao,
                want_typed,
                &identity_families,
                now_ms(),
            )
            .await?
        };
        if candidates.dao.is_empty() && candidates.typed.is_empty() {
            // The tail had nothing new this turn. Not an error — the
            // cursors advanced, so the next tick resumes deeper.
            return Ok(None);
        }
        self.revalidate_anchor(&anchor, "CellGalaxy composition top-up discovery")
            .await?;
        let top_up = hydrator.hydrate_galaxy_top_up(candidates).await?;
        if top_up.source != self.name() || top_up.as_of != anchor {
            return Err(anyhow!(
                "CellGalaxy composition hydrator changed its source anchor"
            ));
        }
        if top_up.is_empty() {
            return Ok(None);
        }
        self.revalidate_anchor(&anchor, "CellGalaxy composition top-up")
            .await?;
        Ok(Some(top_up))
    }
}

fn ckbadger_network(chain_name: &str) -> Option<&'static str> {
    match chain_name {
        "ckb" => Some("mainnet"),
        "ckb_testnet" => Some("testnet"),
        _ => None,
    }
}

fn map_protocol_era(
    timeline: HardforkTimelineResponse,
    expected_network: &str,
    anchor: ChainAnchor,
    canonical_epoch: u64,
) -> anyhow::Result<Option<ProtocolEraRecord>> {
    if timeline.network != expected_network {
        return Err(anyhow!(
            "ckbadger hardfork network {:?} does not match canonical network {expected_network:?}",
            timeline.network
        ));
    }
    if timeline.events.is_empty() || timeline.events.len() > MAX_PROTOCOL_ERAS {
        return Err(anyhow!(
            "ckbadger returned an unsupported number of hardfork events"
        ));
    }

    let indexed_tip_block = nonnegative(timeline.tip_block, "hardfork tipBlock")?;
    let indexed_tip_epoch = nonnegative(timeline.tip_epoch, "hardfork tipEpoch")?;
    wire_safe_u64(indexed_tip_block, "hardfork tipBlock")?;
    wire_safe_u64(indexed_tip_epoch, "hardfork tipEpoch")?;
    // ckbadger can advance between the compatibility probe and this request.
    // Wait for the next probe rather than admitting unproven block/epoch data.
    if indexed_tip_block > anchor.block || indexed_tip_epoch > canonical_epoch {
        return Ok(None);
    }

    let mut ids = HashSet::new();
    let mut previous_activation_epoch = None;
    let mut current = None;
    let mut upcoming = None;
    for event in timeline.events {
        let id = bounded_protocol_label(&event.id, "hardfork event id")?;
        if !ids.insert(id) {
            return Err(anyhow!("ckbadger returned a duplicate hardfork event"));
        }
        let era = map_protocol_era_event(
            event,
            indexed_tip_block,
            indexed_tip_epoch,
            previous_activation_epoch,
        )?;
        previous_activation_epoch = Some(era.activation_epoch);
        if era.activation_epoch <= indexed_tip_epoch {
            current = Some(era);
        } else if upcoming.is_none() {
            upcoming = Some(era);
        }
    }

    Ok(Some(ProtocolEraRecord {
        source: "ckbadger".to_string(),
        as_of: anchor,
        updated_at_ms: now_ms(),
        network: expected_network.to_string(),
        indexed_tip_block,
        indexed_tip_epoch,
        current,
        upcoming,
    }))
}

fn map_protocol_era_event(
    event: HardforkEventResponse,
    indexed_tip_block: u64,
    indexed_tip_epoch: u64,
    previous_activation_epoch: Option<u64>,
) -> anyhow::Result<ProtocolEra> {
    let name = bounded_protocol_label(&event.short_name, "hardfork shortName")?;
    let edition_year = u16::try_from(event.edition_year)
        .context("ckbadger returned invalid hardfork editionYear")?;
    if edition_year == 0 {
        return Err(anyhow!("ckbadger returned an invalid hardfork editionYear"));
    }
    let activation_epoch = nonnegative(event.activation_epoch, "hardfork activationEpoch")?;
    wire_safe_u64(activation_epoch, "hardfork activationEpoch")?;
    if previous_activation_epoch.is_some_and(|previous| activation_epoch <= previous) {
        return Err(anyhow!(
            "ckbadger hardfork events were not ordered by unique activation epoch"
        ));
    }
    let activation_block = event
        .activation_block
        .map(|value| nonnegative(value, "hardfork activationBlock"))
        .transpose()?;
    if let Some(block) = activation_block {
        wire_safe_u64(block, "hardfork activationBlock")?;
    }

    let activated = activation_epoch <= indexed_tip_epoch;
    let expected_status = if activated { "activated" } else { "upcoming" };
    if event.status != expected_status {
        return Err(anyhow!(
            "ckbadger hardfork status {:?} disagrees with tip epoch {indexed_tip_epoch}",
            event.status
        ));
    }
    if activated && activation_block.is_some_and(|block| block > indexed_tip_block) {
        return Err(anyhow!(
            "ckbadger activated hardfork block is ahead of its indexed tip"
        ));
    }
    if !activated && activation_block.is_some() {
        return Err(anyhow!(
            "ckbadger upcoming hardfork unexpectedly has an activation block"
        ));
    }

    Ok(ProtocolEra {
        name,
        edition_year,
        activation_epoch,
        activation_block,
    })
}

fn bounded_protocol_label(value: &str, field: &str) -> anyhow::Result<String> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().count() > MAX_PROTOCOL_LABEL_CHARS
        || value.chars().any(char::is_control)
    {
        return Err(anyhow!("ckbadger returned an invalid {field}"));
    }
    Ok(value.to_string())
}

struct MappedForkWatchReorg {
    record: ForkWatchReorg,
    old_tip_hash: String,
    new_tip_hash: String,
}

fn map_fork_watch(
    watch: RecentReorgResponse,
    anchor: ChainAnchor,
) -> anyhow::Result<Option<ForkWatchRecord>> {
    let recent_window_seconds = u32::try_from(watch.recent_window_seconds)
        .context("ckbadger returned invalid fork-watch recentWindowSeconds")?;
    if recent_window_seconds == 0 || recent_window_seconds > MAX_FORK_WATCH_WINDOW_SECONDS {
        return Err(anyhow!(
            "ckbadger returned an unsupported fork-watch recent window"
        ));
    }
    if watch.deep_fork.detected && !watch.has_recent_reorg {
        return Err(anyhow!(
            "ckbadger reported an active deep fork without a recent fork signal"
        ));
    }

    let recent_event = if watch.has_recent_reorg {
        let event = watch
            .reorg
            .ok_or_else(|| anyhow!("ckbadger fork watch omitted its recent event"))?;
        let event = map_fork_watch_reorg(event)?;
        if event.record.fork_point > anchor.block || event.record.new_tip > anchor.block {
            return Ok(None);
        }
        Some(event)
    } else {
        None
    };

    let deep_fork = if watch.deep_fork.detected {
        let event = recent_event
            .as_ref()
            .ok_or_else(|| anyhow!("ckbadger deep fork omitted its event"))?;
        if event.record.kind != ForkWatchEventKind::Deep {
            return Err(anyhow!(
                "ckbadger active deep fork was not backed by a deep event"
            ));
        }
        let indexed_tip =
            required_nonnegative(watch.deep_fork.db_tip, "fork-watch deepFork dbTip")?;
        let indexed_tip_hash = required_hash32(
            watch.deep_fork.db_tip_hash.as_deref(),
            "fork-watch deepFork dbTipHash",
        )?;
        let chain_tip =
            required_nonnegative(watch.deep_fork.chain_tip, "fork-watch deepFork chainTip")?;
        let chain_tip_hash = required_hash32(
            watch.deep_fork.chain_tip_hash.as_deref(),
            "fork-watch deepFork chainTipHash",
        )?;
        let fork_point =
            required_nonnegative(watch.deep_fork.fork_point, "fork-watch deepFork forkPoint")?;
        let depth = u32::try_from(
            watch
                .deep_fork
                .depth
                .ok_or_else(|| anyhow!("ckbadger fork-watch deepFork omitted depth"))?,
        )
        .context("ckbadger returned invalid fork-watch deepFork depth")?;
        if depth == 0 || indexed_tip < fork_point || chain_tip < fork_point {
            return Err(anyhow!("ckbadger returned inconsistent deep-fork bounds"));
        }
        for (value, field) in [
            (indexed_tip, "fork-watch deepFork dbTip"),
            (chain_tip, "fork-watch deepFork chainTip"),
            (fork_point, "fork-watch deepFork forkPoint"),
        ] {
            wire_safe_u64(value, field)?;
        }
        if chain_tip != anchor.block
            || chain_tip_hash != anchor.hash.as_str()
            || fork_point > anchor.block
        {
            return Ok(None);
        }
        if fork_point != event.record.fork_point
            || depth != event.record.depth
            || indexed_tip != event.record.old_tip
            || indexed_tip_hash != event.old_tip_hash.as_str()
            || chain_tip != event.record.new_tip
            || chain_tip_hash != event.new_tip_hash.as_str()
        {
            return Err(anyhow!(
                "ckbadger deep-fork status disagrees with its persisted event"
            ));
        }
        Some(ForkWatchDeepFork {
            detected_at_ms: event.record.detected_at_ms,
            fork_point,
            indexed_tip,
            chain_tip,
            depth,
        })
    } else {
        if watch.deep_fork.db_tip.is_some()
            || watch.deep_fork.db_tip_hash.is_some()
            || watch.deep_fork.chain_tip.is_some()
            || watch.deep_fork.chain_tip_hash.is_some()
            || watch.deep_fork.depth.is_some()
            || watch.deep_fork.fork_point.is_some()
        {
            return Err(anyhow!(
                "ckbadger inactive deep-fork status retained detail fields"
            ));
        }
        None
    };

    Ok(Some(ForkWatchRecord {
        source: "ckbadger".to_string(),
        as_of: anchor,
        updated_at_ms: now_ms(),
        recent_window_seconds,
        recent_reorg: recent_event.map(|event| event.record),
        deep_fork,
    }))
}

fn map_fork_watch_reorg(event: ReorgEventResponse) -> anyhow::Result<MappedForkWatchReorg> {
    let detected_at_ms = nonnegative(event.id, "fork-watch event id")?;
    let fork_point = nonnegative(event.fork_point_number, "fork-watch event forkPointNumber")?;
    let old_tip = nonnegative(event.old_tip_number, "fork-watch event oldTipNumber")?;
    let new_tip = nonnegative(event.new_tip_number, "fork-watch event newTipNumber")?;
    let depth =
        u32::try_from(event.depth).context("ckbadger returned invalid fork-watch event depth")?;
    let orphaned_blocks = nonnegative(
        event.orphaned_blocks_count,
        "fork-watch event orphanedBlocksCount",
    )?;
    let orphaned_transactions = nonnegative(
        event.orphaned_txs_count,
        "fork-watch event orphanedTxsCount",
    )?;
    for (hash, field) in [
        (&event.fork_point_hash, "fork-watch event forkPointHash"),
        (&event.old_tip_hash, "fork-watch event oldTipHash"),
        (&event.new_tip_hash, "fork-watch event newTipHash"),
    ] {
        if !is_hash32(hash) {
            return Err(anyhow!("ckbadger returned invalid {field}"));
        }
    }
    if depth == 0 || old_tip < fork_point || new_tip < fork_point {
        return Err(anyhow!("ckbadger returned inconsistent fork-event bounds"));
    }
    for (value, field) in [
        (detected_at_ms, "fork-watch event id"),
        (fork_point, "fork-watch event forkPointNumber"),
        (old_tip, "fork-watch event oldTipNumber"),
        (new_tip, "fork-watch event newTipNumber"),
        (orphaned_blocks, "fork-watch event orphanedBlocksCount"),
        (orphaned_transactions, "fork-watch event orphanedTxsCount"),
    ] {
        wire_safe_u64(value, field)?;
    }
    let kind = match event.event_type.as_str() {
        "reorg" => ForkWatchEventKind::Reorg,
        "deep" => ForkWatchEventKind::Deep,
        other => {
            return Err(anyhow!(
                "ckbadger returned unsupported fork event type {other:?}"
            ))
        }
    };
    Ok(MappedForkWatchReorg {
        old_tip_hash: event.old_tip_hash,
        new_tip_hash: event.new_tip_hash,
        record: ForkWatchReorg {
            detected_at_ms,
            fork_point,
            old_tip,
            new_tip,
            depth,
            orphaned_blocks,
            orphaned_transactions,
            kind,
        },
    })
}

fn required_nonnegative(value: Option<i64>, field: &str) -> anyhow::Result<u64> {
    nonnegative(
        value.ok_or_else(|| anyhow!("ckbadger {field} was omitted"))?,
        field,
    )
}

fn required_hash32<'a>(value: Option<&'a str>, field: &str) -> anyhow::Result<&'a str> {
    let value = value.ok_or_else(|| anyhow!("ckbadger {field} was omitted"))?;
    if !is_hash32(value) {
        return Err(anyhow!("ckbadger returned invalid {field}"));
    }
    Ok(value)
}

fn deep_fork_canonical_anchor(
    watch: &RecentReorgResponse,
    context: &CanonicalContext,
) -> anyhow::Result<Option<ChainAnchor>> {
    let chain_tip =
        required_nonnegative(watch.deep_fork.chain_tip, "fork-watch deepFork chainTip")?;
    wire_safe_u64(chain_tip, "fork-watch deepFork chainTip")?;
    let chain_tip_hash = required_hash32(
        watch.deep_fork.chain_tip_hash.as_deref(),
        "fork-watch deepFork chainTipHash",
    )?;
    Ok(context
        .recent_blocks
        .iter()
        .find(|block| block.number == chain_tip && block.hash == chain_tip_hash)
        .map(|block| ChainAnchor {
            block: block.number,
            hash: block.hash.clone(),
        }))
}

/// Normalize one live-cell summary into a [`ChainCensus`], or withhold it.
///
/// Three things have to hold before this states a whole-chain number:
///
/// 1. every counter is inside the JSON safe-integer range the browser will
///    read it back as;
/// 2. the summary's tip block AND hash appear in the local node's retained
///    canonical evidence — an unverifiable or replaced tip is not a slightly
///    stale count, it is a count about a chain this dashboard is not on;
/// 3. the three class counters, when present, sum to `live_cells` exactly.
///
/// A partition that does not add up rejects the WHOLE record, not just the
/// classes. Two counters maintained by the same incremental pipeline
/// disagreeing is evidence about that pipeline, not about one field of it:
/// if the bins have drifted there is no reason left to trust the total they
/// are supposed to decompose. The error surfaces as a refresh failure so it
/// is logged rather than silently degrading to a countless dashboard.
fn map_chain_census(
    summary: LiveCellSummaryResponse,
    context: &CanonicalContext,
) -> anyhow::Result<Option<ChainCensus>> {
    let tip_block = nonnegative(summary.tip.block, "live summary tip.block")?;
    wire_safe_u64(tip_block, "live summary tip.block")?;
    if !is_hash32(&summary.tip.hash) {
        return Err(anyhow!("ckbadger returned invalid live summary tip.hash"));
    }
    let live_cells = nonnegative(summary.live_cells, "live summary liveCells")?;
    wire_safe_u64(live_cells, "live summary liveCells")?;

    // The index can be ahead of, behind, or off this chain. Only a block the
    // local node itself still vouches for admits the counts.
    let Some(anchor) = context
        .recent_blocks
        .iter()
        .find(|block| block.number == tip_block && block.hash == summary.tip.hash)
        .map(|block| ChainAnchor {
            block: block.number,
            hash: block.hash.clone(),
        })
    else {
        return Ok(None);
    };

    let classes = summary
        .classes
        .map(|classes| -> anyhow::Result<ChainCensusClasses> {
            let dao = nonnegative(classes.dao, "live summary classes.dao")?;
            let typed_non_dao =
                nonnegative(classes.typed_non_dao, "live summary classes.typedNonDao")?;
            let plain = nonnegative(classes.plain, "live summary classes.plain")?;
            for (value, field) in [
                (dao, "live summary classes.dao"),
                (typed_non_dao, "live summary classes.typedNonDao"),
                (plain, "live summary classes.plain"),
            ] {
                wire_safe_u64(value, field)?;
            }
            let classes = ChainCensusClasses {
                dao,
                typed_non_dao,
                plain,
            };
            if classes.total() != Some(live_cells) {
                return Err(anyhow!(
                    "ckbadger live summary classes do not partition liveCells"
                ));
            }
            Ok(classes)
        })
        .transpose()?;

    let data_bearing = summary
        .data_bearing
        .map(|value| {
            let value = nonnegative(value, "live summary dataBearing")?;
            wire_safe_u64(value, "live summary dataBearing")
        })
        .transpose()?;

    Ok(Some(ChainCensus {
        source: "ckbadger".to_string(),
        as_of: anchor,
        updated_at_ms: now_ms(),
        live_cells,
        // ckbadger publishes neither counter; `ChainCensus` already declares
        // both optional, so they stay unstated rather than guessed.
        total_cells: None,
        dead_cells: None,
        classes,
        data_bearing,
    }))
}

fn map_dao_state(
    statistics: DaoStatisticsResponse,
    anchor: ChainAnchor,
) -> anyhow::Result<Option<DaoStateRecord>> {
    let statistics_block =
        nonnegative(statistics.tip_block_number, "DAO statistics tipBlockNumber")?;
    wire_safe_u64(statistics_block, "DAO statistics tipBlockNumber")?;
    // The index can commit another batch between the compatibility probe and
    // this request. Withhold that newer singleton until a later probe proves
    // its canonical block hash.
    if statistics_block > anchor.block {
        return Ok(None);
    }

    let total_deposited =
        unsigned_decimal(&statistics.total_deposited, "DAO statistics totalDeposited")?;
    let pending_withdrawal = unsigned_decimal(
        &statistics.pending_withdrawal_capacity,
        "DAO statistics pendingWithdrawalCapacity",
    )?;
    let unclaimed_compensation = unsigned_decimal(
        &statistics.unclaimed_compensation,
        "DAO statistics unclaimedCompensation",
    )?;
    let total_depositors = u32::try_from(statistics.total_depositors)
        .context("ckbadger returned invalid DAO statistics totalDepositors")?;
    let active_deposits = u32::try_from(statistics.active_deposits)
        .context("ckbadger returned invalid DAO statistics activeDeposits")?;
    let estimated_apc_bps = u32::from(percentage_to_bps(
        &statistics.estimated_apc,
        "DAO statistics estimatedApc",
    )?);
    let deposit_change_24h_shannons = statistics
        .deposit_change_24h
        .as_deref()
        .map(|value| {
            signed_ckb_decimal_to_shannons(value, "DAO statistics depositChange24h")
                .map(|value| value.to_string())
        })
        .transpose()?;

    Ok(Some(DaoStateRecord {
        source: "ckbadger".to_string(),
        as_of: anchor,
        statistics_block,
        updated_at_ms: now_ms(),
        total_deposited_shannons: total_deposited.to_string(),
        total_depositors,
        active_deposits,
        pending_withdrawal_shannons: pending_withdrawal.to_string(),
        unclaimed_compensation_shannons: unclaimed_compensation.to_string(),
        estimated_apc_bps,
        deposit_change_24h_shannons,
        depositors_change_24h: statistics.depositors_change_24h,
    }))
}

/// The reach bar and the census under it.
///
/// Two upstream reads, and they are two different statements. The round is
/// what one crawl of the network found; the distributions are what the crawler
/// holds right now. Neither is checked against the other — see
/// `NetworkAtlasRecord::indexed_peers` for why a cross-clock equality here
/// would be an invariant that fails on a healthy source.
///
/// This is a TALLY, so anything it cannot read refuses the whole record rather
/// than thinning it: every count published here is a statement about a
/// population, and a population with a hole in it is not the population the
/// row claims to describe.
fn map_network_atlas(
    summary: NetworkCrawlerSummaryResponse,
    distributions: NetworkDistributionsResponse,
    anchor: ChainAnchor,
) -> anyhow::Result<NetworkAtlasRecord> {
    let round = summary
        .last_round
        .ok_or_else(|| anyhow!("ckbadger network summary omitted its last round"))?;
    if !summary.enabled || !summary.has_data {
        return Err(anyhow!("ckbadger network crawler has no usable data"));
    }
    for (value, field) in [
        (round.round_id, "network roundId"),
        (round.started_at, "network round startedAt"),
        (round.finished_at, "network round finishedAt"),
        (round.candidate_peers, "network round candidatePeers"),
        (round.reachable_peers, "network round reachablePeers"),
        (round.foreign_peers, "network round foreignPeers"),
        (
            round.exhausted_candidates,
            "network round exhaustedCandidates",
        ),
        (
            round.verified_unavailable_peers,
            "network round verifiedUnavailablePeers",
        ),
        (
            round.verified_retained_peers,
            "network round verifiedRetainedPeers",
        ),
        (round.new_verified_peers, "network round newVerifiedPeers"),
        (
            distributions.verified_retained,
            "network distributions verifiedRetained",
        ),
    ] {
        wire_safe_u64(value, field)?;
    }
    if round.finished_at < round.started_at {
        return Err(anyhow!("ckbadger network round finished before it started"));
    }

    // The round's arithmetic, which is exact rather than merely bounded.
    // Upstream derives all five of these counts from ONE disjoint outcome
    // matrix — see `NetworkCrawlerRoundResponse` for the five cells written
    // out — so they are not five measurements that happen to agree, and a
    // source whose counts do not close is a source publishing something other
    // than that matrix.
    //
    // A completed candidate ends in exactly one of three ways: it answered on
    // this network, it answered on another one, or the round ran out of
    // addresses to try. So those three ARE the candidates, and this one
    // equality is what earns the panel the right to draw them as three shares
    // of one bar — three parts that did not add up would be drawn as widths of
    // a whole they are not parts of.
    let outcomes = round
        .reachable_peers
        .checked_add(round.exhausted_candidates)
        .and_then(|sum| sum.checked_add(round.foreign_peers))
        .ok_or_else(|| anyhow!("ckbadger network round peer outcomes overflowed"))?;
    if outcomes != round.candidate_peers {
        return Err(anyhow!(
            "ckbadger network round outcomes do not add up to its candidate count"
        ));
    }
    // And the cross-cut. A peer the crawler still holds a verification for is
    // either one this round reached or one it did not, with no third case, so
    // this is an equality too — and it is the reason the panel may state the
    // unavailable count beside the bar without implying it is a fourth share
    // of it. `verifiedUnavailable` is drawn from the exhausted and foreign
    // cohorts and would double-count against them.
    let verified = round
        .reachable_peers
        .checked_add(round.verified_unavailable_peers)
        .ok_or_else(|| anyhow!("ckbadger network round verified peers overflowed"))?;
    if verified != round.verified_retained_peers {
        return Err(anyhow!(
            "ckbadger network round reachable and unavailable peers do not add up to its \
             retained verified count"
        ));
    }
    if round.new_verified_peers > round.verified_retained_peers {
        return Err(anyhow!(
            "ckbadger network round newly-verified count exceeds its retained verified count"
        ));
    }

    let indexed_peers = u32::try_from(distributions.verified_retained)
        .context("ckbadger network indexed peer count is outside u32")?;
    let countries = network_distribution(
        distributions.countries,
        indexed_peers,
        "network distribution country",
    )?;
    let versions = network_distribution(
        distributions.versions,
        indexed_peers,
        "network distribution version",
    )?;
    Ok(NetworkAtlasRecord {
        source: "ckbadger".to_string(),
        as_of: anchor,
        updated_at_ms: now_ms(),
        crawl_round: round.round_id,
        crawl_finished_at_s: round.finished_at,
        candidate_peers: round.candidate_peers,
        last_round_reachable: round.reachable_peers,
        foreign_peers: round.foreign_peers,
        exhausted_candidates: round.exhausted_candidates,
        verified_unavailable_peers: round.verified_unavailable_peers,
        verified_retained_peers: round.verified_retained_peers,
        new_verified_peers: round.new_verified_peers,
        indexed_peers,
        countries,
        versions,
    })
}

/// One histogram from `network/distributions`, checked against the population
/// it claims to partition.
///
/// The partition check is the load-bearing one. A histogram whose counts do
/// not add up to the peers it describes is not a slower or a staler answer, it
/// is a different question — and the panel draws each bucket as its share of
/// that population, so a wrong denominator draws a wrong bar rather than a
/// missing one. It is also what keeps a multi-label histogram out: upstream's
/// `protocols` counts one row per protocol per peer and would fail here on the
/// first healthy network it met, which is why nothing reads it.
///
/// Labels that arrive empty become the word for not knowing, and two rows that
/// both say it are added together rather than refused. `bounded_network_text`
/// has always held that an absent label and an empty one are the same
/// statement to a reader; two spellings of that one statement are still one
/// bucket.
fn network_distribution(
    rows: Vec<LabelCountResponse>,
    population: u32,
    field: &str,
) -> anyhow::Result<Vec<NetworkAtlasBucket>> {
    if rows.len() > MAX_NETWORK_DISTRIBUTION_BUCKETS {
        return Err(anyhow!("ckbadger returned too many {field} buckets"));
    }
    let mut counts = BTreeMap::<String, u32>::new();
    let mut total = 0_u32;
    for row in rows {
        let count = u32::try_from(row.count)
            .ok()
            .filter(|count| *count > 0)
            .ok_or_else(|| anyhow!("ckbadger returned an invalid {field} count"))?;
        let label = bounded_network_label(&row.label, field)?;
        let bucket = counts.entry(label).or_default();
        *bucket = bucket
            .checked_add(count)
            .ok_or_else(|| anyhow!("ckbadger {field} buckets overflowed"))?;
        total = total
            .checked_add(count)
            .ok_or_else(|| anyhow!("ckbadger {field} buckets overflowed"))?;
    }
    if total != population {
        return Err(anyhow!(
            "ckbadger {field} buckets do not add up to the peers they describe"
        ));
    }
    Ok(network_buckets(counts))
}

/// The atlas's twin, and the place their two disciplines part.
///
/// The atlas is a TALLY: one unreadable row poisons every count it feeds, so
/// the whole record is refused. A roster is a SAMPLE — a list of nodes the
/// scene may stage — so a row it cannot read honestly is simply not staged,
/// and the nodes beside it still are. Nothing about a dropped row is ever
/// guessed at, and no count here is derived from the rows that survived.
///
/// `pages` arrives one entry per rung of [`ROSTER_SCOPES`], in that order,
/// strongest evidence first — and short of that when the budget ran out before
/// the weaker rungs were asked after, which is why it is zipped against the
/// scope table rather than indexed into it. They are three slices and not one
/// page: each was sorted by upstream on its own, so the ordering invariant
/// below is checked WITHIN a page and never across the seam between two, where
/// a fresher hearsay row legitimately follows a staler verified one.
fn map_network_roster(
    summary: NetworkCrawlerSummaryResponse,
    pages: Vec<NetworkPeersPageResponse>,
    anchor: ChainAnchor,
) -> anyhow::Result<NetworkRosterRecord> {
    let round = summary
        .last_round
        .ok_or_else(|| anyhow!("ckbadger network summary omitted its last round"))?;
    if !summary.enabled || !summary.has_data {
        return Err(anyhow!("ckbadger network crawler has no usable data"));
    }
    wire_safe_u64(round.round_id, "network roundId")?;
    let received: usize = pages.iter().map(|page| page.items.len()).sum();
    if received > ROSTER_CAP {
        return Err(anyhow!(
            "ckbadger network peers exceeded the requested roster limit"
        ));
    }
    // Upstream orders each page by when its peers were last positively
    // observed, which is a key every crawl round moves: publishing it in that
    // order would reshuffle the whole roster every round. Membership in the cap is
    // this crate's call and the scope order is what makes it, but the order
    // cknerv publishes is the id — a node's only fact that a crawl cannot
    // change.
    let mut entries: Vec<RosterNode> = Vec::with_capacity(received);
    let mut staged = HashSet::new();
    let mut unreadable = 0usize;
    let mut duplicate = 0usize;
    // A rung nobody asked after is a rung whose peers this roster does not
    // name, which is precisely what `truncated` reports. It is the only way
    // the flag can be raised without a cursor to raise it: a scope answered
    // in full has no `nextCursor`, so a budget that ran out between scopes
    // would otherwise publish a full roster claiming to be the whole set.
    let mut truncated = pages.len() < ROSTER_SCOPES.len();
    let mut off_scope = 0usize;
    for (scope, page) in ROSTER_SCOPES.iter().zip(pages) {
        truncated |= page.next_cursor.is_some();
        let mut previous_latest_positive_observed_at = None;
        for peer in page.items {
            // A page may only contribute the rung it was asked for. Upstream
            // filters on exactly this field, so in health the test never
            // fires — and that is the point of it. If the `state=` parameter
            // ever stops being honoured, every page becomes the same unscoped
            // population sorted by observation time, the strongest rung's
            // request swallows the entire budget on rows belonging to the
            // weakest, and the roster is back to a slice nobody chose while
            // still looking like a healthy report. Dropped rather than
            // refused, and dropped rather than kept: a row on the wrong page
            // is asked for again on its own, and a sixth state upstream adds
            // must cost this build a row and never the record.
            if peer.crawler_dial_state != scope.state {
                off_scope += 1;
                continue;
            }
            // The one page-level fault a sample can still have. The atlas used
            // to check this, back when it drew its own 64-row sample off this
            // page; it counts a census now and never asks for peers, so the
            // guard moved to the reader that kept the page — and the argument
            // moved with it unchanged, because it was always an argument about
            // a sample. Each page is a bounded slice of a set that outgrows
            // it, `truncated` is the only thing said about the rest, and which
            // peers land inside the budget is decided entirely by the order
            // they arrive in. A page cknerv cannot vouch for the order of is a
            // slice whose membership nobody chose.
            //
            // `latestPositiveObservedAt` is upstream's actual sort key, ties
            // broken by peer id. It took that job over from `lastAdvertisedAt`
            // when the advertise clock became nullable, and checking the old
            // key against the new order would have refused every healthy page
            // — the sort is a checked maximum over four channels, so a peer a
            // direct session touched a second ago legitimately outranks one
            // gossiped an hour ago, and the advertise clock says the reverse.
            // A page-order invariant that fires on health is a total loss
            // wearing a validation's clothes, which is the one failure this
            // guard exists to avoid rather than cause.
            //
            // It is also the only ordering that CAN be checked:
            // `lastDialObservedAt` moves per peer within a round and arrives
            // genuinely out of order. Ties are the normal case rather than an
            // edge — a round advertises its whole page in one moment — so only
            // a strictly newer row after an older one is out of order.
            wire_safe_u64(
                peer.latest_positive_observed_at,
                "network peer latestPositiveObservedAt",
            )?;
            if previous_latest_positive_observed_at
                .is_some_and(|previous| peer.latest_positive_observed_at > previous)
            {
                return Err(anyhow!(
                    "ckbadger network peers were not ordered newest positively observed first"
                ));
            }
            previous_latest_positive_observed_at = Some(peer.latest_positive_observed_at);
            let Some(entry) = roster_node(peer) else {
                unreadable += 1;
                continue;
            };
            if !staged.insert(entry.node_id.clone()) {
                duplicate += 1;
                continue;
            }
            entries.push(entry);
        }
    }
    entries.sort_by(|left, right| left.node_id.cmp(&right.node_id));
    // Dropping a row is correct — a roster is a sample, and an unreadable node
    // is one cknerv will not stage — but doing it in silence made "the crawler
    // knows 56 nodes" indistinguishable from "the crawler answered with 200
    // and validation ate 144". One line per refresh, only when something was
    // dropped, so the shortfall has a place to be read from.
    //
    // Deliberately NOT on the wire: `NetworkRosterRecord` carries `truncated`
    // (upstream had more than the budget) and nothing else about size, so an
    // honest dropped-row count would be a new field on a shared record — a
    // wire change, and this is an observability fix.
    if unreadable > 0 || duplicate > 0 || off_scope > 0 {
        tracing::debug!(
            target: "cknerv-adapter-ckbadger",
            crawl_round = round.round_id,
            received,
            staged = entries.len(),
            unreadable,
            duplicate,
            off_scope,
            "the roster dropped rows it could not stage"
        );
    }

    Ok(NetworkRosterRecord {
        source: "ckbadger".to_string(),
        as_of: anchor,
        updated_at_ms: now_ms(),
        crawl_round: round.round_id,
        truncated,
        entries,
    })
}

/// Which rung of the record's own gradient one upstream state is, or `None`
/// for a state no roster row is made from.
///
/// The three that map are the three the record can say a true sentence about.
/// `foreignNetwork` is a peer that answered from another chain — a real
/// observation, and not a member of this network's colony, so the atlas's
/// reach bar counts it and the roster does not name it. `noCompletedObservation`
/// is a candidate no finished round has reached, which is strictly less dial
/// evidence than `advertisedUnverified` already carries.
///
/// ⚠️ That last one is no longer only the state of a peer the next round will
/// move on. A peer met through an inbound session it never advertised for
/// never yields an alias to dial, so it never completes a round and never
/// leaves this state — see [`PeerDisplayState`], where the consequence is
/// written out. The ruling that the roster does not stage it stands; what has
/// changed is that the set it excludes is now permanent rather than passing.
/// `Unknown` is a state upstream added and this build has no name for, which
/// is the one case where naming a node would mean inventing what is known
/// about it.
///
/// Exhaustive on purpose: a state added upstream lands here as a compile
/// error, in a crate whose last two outages were both a wire that changed
/// without anything stopping to ask.
fn roster_state(state: PeerDisplayState) -> Option<RosterNodeState> {
    match state {
        PeerDisplayState::Reachable => Some(RosterNodeState::Reachable),
        PeerDisplayState::VerifiedUnavailable => Some(RosterNodeState::VerifiedUnavailable),
        PeerDisplayState::AdvertisedUnverified => Some(RosterNodeState::AdvertisedUnverified),
        PeerDisplayState::ForeignNetwork
        | PeerDisplayState::NoCompletedObservation
        | PeerDisplayState::Unknown => None,
    }
}

/// One row turned into one stageable node, or `None` when it cannot be read
/// as one. Every field is bounded here rather than at the record, because the
/// answer to an unusable field is to leave this node out — never to invent a
/// value for it, and never to lose the page over it.
///
/// ⭐ NOTHING HERE READS THE STATE TO DECIDE WHAT A FIELD MEANS, and that is
/// deliberate. It would be easy to write "if this row is unverified then drop
/// the labels", and it would be a second opinion about a line upstream has
/// already drawn: it builds all five optional fields out of the verified node
/// record, so their absence IS the statement that there was no dial to learn
/// them from. Reading them straight through keeps one authority over that
/// line. The state answers a different question — what kind of evidence stands
/// behind this row — and it is the only thing it answers.
fn roster_node(peer: PeerSummaryResponse) -> Option<RosterNode> {
    validate_network_peer_id(&peer.peer_id).ok()?;
    let state = roster_state(peer.crawler_dial_state)?;
    // ⭐ NO ADDRESS, NO ROW — and this is the `?` that finally makes that
    // sentence true. The field was a defaulted `String` while upstream still
    // refused to answer at all for an aliasless candidate, and an empty one
    // fell through `bounded_network_text` to the literal word `Unknown`: the
    // comment claimed such a row was left off stage and the code staged it,
    // with an address a reader could click on and learn nothing from. Upstream
    // now answers `null` here on purpose, for the peers it met through a
    // session rather than a dial, so the gap stopped being hypothetical on the
    // same day it was found.
    let primary_addr = peer.primary_addr.as_deref()?;
    Some(RosterNode {
        node_id: peer_hex_to_id(&peer.peer_id)?,
        addr: bounded_network_text(
            primary_addr,
            MAX_NETWORK_ADDR_CHARS,
            "network peer primaryAddr",
        )
        .ok()?,
        state,
        version: optional_network_label(peer.version.as_deref(), "network peer version").ok()?,
        country: optional_network_label(peer.country.as_deref(), "network peer country").ok()?,
        asn: optional_network_label(peer.asn.as_deref(), "network peer asn").ok()?,
        // Four clocks, four facts, and each one keeps its own name from the
        // wire it arrived on to the wire it leaves on. `lastReachableAt` is
        // the moment the crawler SAW this node and the only one that may ever
        // date a sighting; `lastAdvertisedAt` is the moment the network last
        // NAMED it; `lastDialObservedAt` is the moment the crawler last TRIED
        // it, which is what dates a failure; `latestPositiveObservedAt` is the
        // newest of every positive channel at once. A row that let one of them
        // stand in for another would put a sighting's date on a node nobody
        // has ever dialed.
        //
        // The last of the four is the one that is required, and it is why no
        // roster row is ever undated. The advertise clock used to hold that
        // job and cannot any more — a node reached only through a session was
        // never gossiped, so it has no advertise moment to be dated by, and
        // the source says so with a `null` rather than by inventing one. It is
        // read if it is there and never a second reason to drop a row: losing
        // a verified, dialable, named peer over a clock no reader draws would
        // be a worse answer than the missing clock.
        last_reachable_ms: optional_sighting_clock_ms(
            peer.last_reachable_at,
            "network peer lastReachableAt",
        )
        .ok()?,
        last_advertised_ms: optional_sighting_clock_ms(
            peer.last_advertised_at,
            "network peer lastAdvertisedAt",
        )
        .ok()?,
        last_observed_ms: optional_sighting_clock_ms(
            peer.last_dial_observed_at,
            "network peer lastDialObservedAt",
        )
        .ok()?,
        latest_positive_observed_ms: sighting_clock_ms(
            peer.latest_positive_observed_at,
            "network peer latestPositiveObservedAt",
        )
        .ok()?,
        rtt_ms: peer.rtt_ms,
    })
}

fn network_buckets(counts: BTreeMap<String, u32>) -> Vec<NetworkAtlasBucket> {
    let mut buckets: Vec<_> = counts
        .into_iter()
        .map(|(label, count)| NetworkAtlasBucket { label, count })
        .collect();
    buckets.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.label.cmp(&right.label))
    });
    buckets
}

fn bounded_network_label(value: &str, field: &str) -> anyhow::Result<String> {
    bounded_network_text(value, MAX_NETWORK_LABEL_CHARS, field)
}

/// The same label, from a page that answers `null` for what it never learned.
///
/// ⭐ ABSENT AND EMPTY ARE TWO DIFFERENT ANSWERS HERE, and this function
/// exists to keep them apart. Upstream builds a peer's version, country and
/// ASN out of the verified node record, so `null` means there was never a dial
/// to learn them from — while a peer it DID reach whose geolocation lookup
/// came back empty arrives carrying upstream's own word `"Unknown"`. Both
/// sentences are true and they are not the same sentence: one says nobody has
/// ever spoken to this node, the other says somebody did and could not place
/// it. This used to be `value.unwrap_or_default()`, which was right while the
/// page was pinned to peers the crawler had reached and would now print the
/// crawler's verdict over a node it never dialed.
///
/// An empty string still becomes `"Unknown"` below, because a crawler that
/// holds a node record with no label in it is stating something rather than
/// leaving a hole.
fn optional_network_label(value: Option<&str>, field: &str) -> anyhow::Result<Option<String>> {
    value
        .map(|label| bounded_network_label(label, field))
        .transpose()
}

/// Trimmed, length-bounded and control-free — and an empty answer becomes
/// `"Unknown"`, because a crawler with no geolocation for a node is stating
/// something rather than leaving a hole for a reader to fill in.
fn bounded_network_text(value: &str, max_chars: usize, field: &str) -> anyhow::Result<String> {
    let label = value.trim();
    if label.is_empty() {
        return Ok("Unknown".to_string());
    }
    if label.chars().count() > max_chars || label.chars().any(char::is_control) {
        return Err(anyhow!("ckbadger returned an invalid {field}"));
    }
    Ok(label.to_string())
}

fn validate_network_peer_id(value: &str) -> anyhow::Result<()> {
    let valid = !value.is_empty()
        && value.len() <= MAX_PEER_ID_HEX_CHARS
        && value.len().is_multiple_of(2)
        && value.as_bytes().iter().all(u8::is_ascii_hexdigit);
    if !valid {
        return Err(anyhow!("ckbadger network node returned an invalid peerId"));
    }
    Ok(())
}

/// The join between the two halves of one node's identity: CKB's RPC prints a
/// peer id as base58 (`Qm…`), and the crawler stores the multihash bytes
/// behind that string. `None` says the local node handed us something that is
/// not a peer id at all, which the caller reports as an absence rather than
/// asking the source about it.
fn peer_id_to_hex(node_id: &str) -> Option<String> {
    use std::fmt::Write as _;

    if node_id.is_empty() || node_id.len() > MAX_PEER_ID_BASE58_CHARS {
        return None;
    }
    // Decoded into a fixed buffer: the id is bounded above, so nothing a
    // peer list can hold allocates here.
    let mut bytes = [0_u8; MAX_PEER_ID_HEX_CHARS / 2];
    let length = bs58::decode(node_id).onto(&mut bytes).ok()?;
    if length == 0 {
        return None;
    }
    let mut hex = String::with_capacity(length * 2);
    for byte in &bytes[..length] {
        let _ = write!(hex, "{byte:02x}");
    }
    Some(hex)
}

/// The same join as [`peer_id_to_hex`], read the other way: the crawler keys
/// its nodes by the multihash bytes, and everything downstream of here — the
/// local node's peer list, a selection id, `/api/enrichment/peers/:node_id` —
/// speaks base58. Converting at the boundary is what keeps ONE id vocabulary
/// in the app instead of two that have to be reconciled per reader.
///
/// Bounded on both sides, so a page of ids allocates only the ids. `None` is
/// an id that did not survive the trip — including one whose base58 form the
/// peer lookup could not be keyed by — and the caller drops that row rather
/// than staging a node under a name nothing else would answer to.
fn peer_hex_to_id(peer_hex: &str) -> Option<String> {
    if peer_hex.is_empty()
        || peer_hex.len() > MAX_PEER_ID_HEX_CHARS
        || !peer_hex.len().is_multiple_of(2)
    {
        return None;
    }
    let length = peer_hex.len() / 2;
    let mut bytes = [0_u8; MAX_PEER_ID_HEX_CHARS / 2];
    for (index, slot) in bytes[..length].iter_mut().enumerate() {
        let pair = peer_hex.get(index * 2..index * 2 + 2)?;
        if !pair.as_bytes().iter().all(u8::is_ascii_hexdigit) {
            return None;
        }
        *slot = u8::from_str_radix(pair, 16).ok()?;
    }
    let mut encoded = [0_u8; MAX_PEER_ID_BASE58_CHARS];
    let written = bs58::encode(&bytes[..length]).onto(&mut encoded[..]).ok()?;
    std::str::from_utf8(&encoded[..written])
        .ok()
        .map(str::to_string)
}

/// One peer dossier, turned into whichever of the two true statements it is.
///
/// The route answers a candidate — everything anyone advertised about a peer
/// — with the crawler's verified observation nested inside it, and that inner
/// record is `null` for every peer the crawler could not authenticate. The
/// split here is exactly that field: a peer with a verification is a
/// sighting, and a peer without one is not a decode failure, not an empty
/// sighting, and not "never seen from outside" — it is a peer the network
/// names that nobody outside could get an identify out of, which is its own
/// statement with its own evidence.
fn map_peer_lookup(
    node_id: &str,
    peer_hex: &str,
    detail: PeerDetailResponse,
    anchor: ChainAnchor,
) -> anyhow::Result<PeerSightingLookup> {
    validate_network_peer_id(&detail.peer_id)?;
    if !detail.peer_id.eq_ignore_ascii_case(peer_hex) {
        return Err(anyhow!("ckbadger returned a different network node"));
    }
    // The peers that named this one. It stands outside the verification on
    // the wire because it is true of every candidate — a peer nobody could
    // dial is still a peer the network keeps repeating the address of — so it
    // is read once here and handed to whichever of the two statements this
    // turns out to be.
    let advertiser_peer_count = detail
        .advertisers
        .as_ref()
        .map(|advertisers| {
            u32::try_from(advertisers.len()).context("ckbadger peer advertisers is outside u32")
        })
        .transpose()?;
    let Some(verified) = detail.verified else {
        return Ok(PeerSightingLookup::advertised_unverified(
            map_advertised_evidence(
                detail.last_advertised_at,
                detail.last_completed.as_ref(),
                advertiser_peer_count,
            )?,
        ));
    };
    // `reachable` on this record has always meant "the crawler got an
    // identify out of it in the round that just finished", which is precisely
    // what upstream now calls the `reachable` display state. A peer it holds
    // a verification for but did not reach this round keeps reading as the
    // dark half of the sighted tier, exactly as it did.
    let reachable = detail.display_state == PeerDisplayState::Reachable;
    map_peer_sighting(node_id, verified, reachable, advertiser_peer_count, anchor)
        .map(PeerSightingLookup::sighted)
}

fn map_peer_sighting(
    node_id: &str,
    verified: VerifiedPeerResponse,
    reachable: bool,
    advertiser_peer_count: Option<u32>,
    anchor: ChainAnchor,
) -> anyhow::Result<PeerSightingRecord> {
    let first_seen_ms = sighting_clock_ms(verified.first_seen, "peer verified firstSeen")?;
    let last_seen_ms = sighting_clock_ms(verified.last_seen, "peer verified lastSeen")?;
    if last_seen_ms < first_seen_ms {
        return Err(anyhow!(
            "ckbadger peer was last seen before it was first seen"
        ));
    }
    // Zero is the crawler's "never": a node it has never completed a dial to
    // has no reachable-at moment, and 1970 is not one.
    let last_reachable_at_ms = match verified.last_reachable_at {
        0 => None,
        seconds => Some(seconds_to_wire_ms(
            seconds,
            "peer verified lastReachableAt",
        )?),
    };
    if verified.protocols.len() > MAX_PEER_PROTOCOLS {
        return Err(anyhow!(
            "ckbadger peer returned more protocols than a peer can open"
        ));
    }
    let protocols = verified
        .protocols
        .iter()
        .map(|protocol| bounded_network_label(protocol, "peer verified protocol"))
        .collect::<anyhow::Result<Vec<String>>>()?;

    Ok(PeerSightingRecord {
        source: "ckbadger".to_string(),
        as_of: anchor,
        updated_at_ms: now_ms(),
        node_id: node_id.to_string(),
        country: bounded_network_label(&verified.country, "peer verified country")?,
        asn: bounded_network_label(&verified.asn, "peer verified asn")?,
        client_version: bounded_network_label(
            &verified.client_version,
            "peer verified clientVersion",
        )?,
        protocols,
        first_seen_ms,
        last_seen_ms,
        last_reachable_at_ms,
        reachable,
        rtt_ms: verified.rtt_ms,
        // Both directions of the address book, each under its own name and
        // its own unit. The slot that held one number for both is gone: it
        // counted PEERS this node knew, upstream deleted it, and the list
        // that arrived in its place counts peers that know THIS node — so
        // there was never a way to fill it that did not say the sentence
        // backwards. What replaces it is two counts that cannot be swapped,
        // because one is peers and the other is addresses.
        advertiser_peer_count,
        advertised_address_count: verified
            .discovery
            .map(|discovery| {
                u32::try_from(discovery.normalized_advertised_addresses)
                    .context("ckbadger peer normalizedAdvertisedAddresses is outside u32")
            })
            .transpose()?,
    })
}

/// The crawler's account of a peer it never verified.
///
/// A candidate is dialed once per address it has been advertised under, so
/// there is no single "the" result — there is a handful, one per alias. The
/// honest summary of them is the FURTHEST any of them got, because that is
/// the best this peer managed and the only one an operator can act on: a peer
/// whose seven addresses all refused the dial and a peer that opened a secure
/// session on one of them and then went quiet have different problems, and
/// taking the last observation in the list would pick between them by
/// accident.
fn map_advertised_evidence(
    last_advertised_at: u64,
    last_completed: Option<&CandidateEvidenceResponse>,
    advertiser_peer_count: Option<u32>,
) -> anyhow::Result<PeerAdvertisedEvidence> {
    // No completed round is a third statement again — the network has named
    // this peer and nobody has tried it yet — so an absent round carries an
    // absent result rather than a flattened failure.
    //
    // The winner is taken as a whole OBSERVATION rather than as a rung,
    // because the rung and the address it was read on have to come from the
    // same dial. Ties are real (a peer whose nine aliases all refused the
    // dial has nine winners) and any of them names the same rung at a genuine
    // address, which is why the count of dials rides beside it: one refusal
    // out of one and one out of nine are different reports.
    let furthest = last_completed.and_then(|completed| {
        completed
            .observations
            .iter()
            .max_by_key(|observation| map_probe_result(observation.result))
    });
    Ok(PeerAdvertisedEvidence {
        last_advertised_at_ms: sighting_clock_ms(last_advertised_at, "peer lastAdvertisedAt")?,
        furthest_result: furthest.map(|observation| map_probe_result(observation.result)),
        // A multiaddr, so it is bounded as one — a truncated address is an
        // address that is not the node's. An observation that carried none
        // arrives as `bounded_network_text`'s word for an empty label, which
        // is a fine answer for a country and a false one here: the rung still
        // happened, and it did not happen at a place called Unknown.
        furthest_address: furthest
            .map(|observation| {
                bounded_network_text(
                    &observation.address,
                    MAX_NETWORK_ADDR_CHARS,
                    "peer probe address",
                )
            })
            .transpose()?
            .filter(|address| address != "Unknown"),
        dialed_address_count: last_completed
            .map(|completed| {
                u32::try_from(completed.observations.len())
                    .context("ckbadger peer observations is outside u32")
            })
            .transpose()?
            .unwrap_or(0),
        consecutive_exhausted_rounds: last_completed
            .map(|completed| {
                u32::try_from(completed.consecutive_exhausted_rounds)
                    .context("ckbadger peer consecutiveExhaustedRounds is outside u32")
            })
            .transpose()?
            .unwrap_or(0),
        advertiser_peer_count,
    })
}

/// The wire's word for how far a dial got, in the shared contract's own
/// vocabulary. A result this build has no name for becomes the rung that
/// claims least, so any nameable result on any of the peer's addresses wins
/// the `max` above and this only ever surfaces alone.
fn map_probe_result(result: PeerProbeResultResponse) -> PeerProbeResult {
    match result {
        PeerProbeResultResponse::DialRequestFailed => PeerProbeResult::DialRequestFailed,
        PeerProbeResultResponse::NoAuthenticatedSessionBeforeDeadline => {
            PeerProbeResult::NoAuthenticatedSessionBeforeDeadline
        }
        PeerProbeResultResponse::AuthenticatedSessionWithoutIdentifyBeforeDeadline => {
            PeerProbeResult::AuthenticatedSessionWithoutIdentifyBeforeDeadline
        }
        PeerProbeResultResponse::MalformedIdentify => PeerProbeResult::MalformedIdentify,
        PeerProbeResultResponse::ForeignNetwork => PeerProbeResult::ForeignNetwork,
        PeerProbeResultResponse::SameNetworkIdentified => PeerProbeResult::SameNetworkIdentified,
        PeerProbeResultResponse::Unknown => PeerProbeResult::Unknown,
    }
}

/// A sighting's own clock, in the milliseconds the shared wire counts. Zero is
/// refused rather than published: an epoch-1970 stamp would render as a node
/// the network has known for fifty-six years, which the source never claimed.
fn sighting_clock_ms(seconds: u64, field: &str) -> anyhow::Result<u64> {
    if seconds == 0 {
        return Err(anyhow!("ckbadger returned a sighting with no {field}"));
    }
    seconds_to_wire_ms(seconds, field)
}

/// The same clock from a wire that answers `null` for a moment that never
/// happened. A clock the source did not send stays unsent; only a clock it
/// sent and cknerv cannot read is a reason to drop the row.
fn optional_sighting_clock_ms(seconds: Option<u64>, field: &str) -> anyhow::Result<Option<u64>> {
    seconds
        .map(|seconds| sighting_clock_ms(seconds, field))
        .transpose()
}

fn seconds_to_wire_ms(seconds: u64, field: &str) -> anyhow::Result<u64> {
    let millis = seconds
        .checked_mul(1_000)
        .ok_or_else(|| anyhow!("ckbadger returned {field} outside the millisecond range"))?;
    wire_safe_u64(millis, field)
}

fn map_transaction_horizon(
    statistics: TransactionStatsResponse,
    anchor: ChainAnchor,
) -> anyhow::Result<TransactionHorizonRecord> {
    let current_hour = transaction_count(statistics.current_hour, "currentHour")?;
    let current_day = transaction_count(statistics.current_day, "currentDay")?;
    let hourly_counts = transaction_buckets(
        statistics.hourly_data,
        MAX_TRANSACTION_HOURLY_BUCKETS,
        "hourlyData",
        valid_hour_bucket_label,
    )?;
    let daily_counts = transaction_buckets(
        statistics.daily_data,
        MAX_TRANSACTION_DAILY_BUCKETS,
        "dailyData",
        valid_day_bucket_label,
    )?;

    Ok(TransactionHorizonRecord {
        source: "ckbadger".to_string(),
        as_of: anchor,
        updated_at_ms: now_ms(),
        current_hour,
        current_day,
        hourly_counts,
        daily_counts,
    })
}

fn transaction_buckets(
    points: Vec<TransactionStatsPoint>,
    limit: usize,
    field: &str,
    valid_label: fn(&str) -> bool,
) -> anyhow::Result<Vec<u64>> {
    if points.len() > limit {
        return Err(anyhow!(
            "ckbadger transaction horizon exceeded {field} bound"
        ));
    }
    let mut labels = HashSet::with_capacity(points.len());
    points
        .into_iter()
        .map(|point| {
            if !valid_label(&point.label) {
                return Err(anyhow!(
                    "ckbadger transaction horizon returned invalid {field} label"
                ));
            }
            if !labels.insert(point.label) {
                return Err(anyhow!(
                    "ckbadger transaction horizon returned duplicate {field} label"
                ));
            }
            transaction_count(point.value, field)
        })
        .collect()
}

fn transaction_count(value: i64, field: &str) -> anyhow::Result<u64> {
    wire_safe_u64(nonnegative(value, field)?, field)
}

fn valid_hour_bucket_label(label: &str) -> bool {
    let bytes = label.as_bytes();
    if bytes.len() != 5
        || !bytes[0].is_ascii_digit()
        || !bytes[1].is_ascii_digit()
        || bytes[2] != b':'
        || bytes[3] != b'0'
        || bytes[4] != b'0'
    {
        return false;
    }
    (bytes[0] - b'0') * 10 + (bytes[1] - b'0') <= 23
}

fn valid_day_bucket_label(label: &str) -> bool {
    let bytes = label.as_bytes();
    if bytes.len() != 5
        || !bytes[0].is_ascii_digit()
        || !bytes[1].is_ascii_digit()
        || bytes[2] != b'/'
        || !bytes[3].is_ascii_digit()
        || !bytes[4].is_ascii_digit()
    {
        return false;
    }
    let month = (bytes[0] - b'0') * 10 + (bytes[1] - b'0');
    let day = (bytes[3] - b'0') * 10 + (bytes[4] - b'0');
    (1..=12).contains(&month) && (1..=31).contains(&day)
}

fn map_activity_feed(
    activities: Vec<LatestActivityResponse>,
    anchor: ChainAnchor,
) -> anyhow::Result<ActivityFeedRecord> {
    if activities.len() > ACTIVITY_FEED_LIMIT {
        return Err(anyhow!(
            "ckbadger latest activities exceeded the requested limit"
        ));
    }

    let mut tx_hashes = HashSet::new();
    let mut previous_block = None;
    let mut mapped = Vec::with_capacity(activities.len());
    for activity in activities {
        if activity.is_cellbase {
            return Err(anyhow!(
                "ckbadger latest activities unexpectedly included cellbase"
            ));
        }
        if !is_hash32(&activity.tx_hash) {
            return Err(anyhow!(
                "ckbadger latest activities returned an invalid transaction hash"
            ));
        }
        if !tx_hashes.insert(activity.tx_hash.clone()) {
            return Err(anyhow!(
                "ckbadger latest activities returned a duplicate transaction"
            ));
        }
        let block = nonnegative(activity.block_number, "activity blockNumber")?;
        wire_safe_u64(block, "activity blockNumber")?;
        if previous_block.is_some_and(|previous| block > previous) {
            return Err(anyhow!(
                "ckbadger latest activities were not ordered newest first"
            ));
        }
        previous_block = Some(block);
        // The chain may advance between the source probe and this bounded
        // request. Keep validating response order, but publish only the safe
        // suffix already covered by the validated anchor. A later probe will
        // admit the leading entries once their block hash is proven.
        if block > anchor.block {
            continue;
        }
        let timestamp_ms = unsigned_decimal(&activity.timestamp, "activity timestamp")?;
        let timestamp_ms =
            u64::try_from(timestamp_ms).context("ckbadger activity timestamp is outside u64")?;
        wire_safe_u64(timestamp_ms, "activity timestamp")?;
        if activity.participants.len() > MAX_ACTIVITY_PARTICIPANTS {
            return Err(anyhow!("ckbadger activity returned too many participants"));
        }
        let participant_count = u32::try_from(activity.participants.len())
            .context("ckbadger activity participant count is outside u32")?;
        let (category, label) = classify_activity(&activity)?;
        mapped.push(ActivityFeedItem {
            tx_hash: activity.tx_hash,
            block,
            timestamp_ms,
            category,
            label,
            participant_count,
        });
    }

    Ok(ActivityFeedRecord {
        source: "ckbadger".to_string(),
        as_of: anchor,
        updated_at_ms: now_ms(),
        activities: mapped,
    })
}

fn classify_activity(
    activity: &LatestActivityResponse,
) -> anyhow::Result<(String, Option<String>)> {
    let nested_items = activity
        .protocol_actions
        .len()
        .checked_add(activity.type_calls.len())
        .and_then(|count| count.checked_add(activity.lock_calls.len()))
        .and_then(|count| {
            activity
                .participants
                .iter()
                .try_fold(count, |total, participant| {
                    total.checked_add(participant.item_deltas.len())
                })
        })
        .ok_or_else(|| anyhow!("ckbadger activity nested item count overflows"))?;
    if nested_items > MAX_ACTIVITY_NESTED_ITEMS {
        return Err(anyhow!("ckbadger activity returned too many nested items"));
    }

    let mut protocol_label = None;
    let mut protocol_category = None;
    for action in &activity.protocol_actions {
        let protocol = bounded_activity_label(&action.protocol, "activity protocol")?
            .ok_or_else(|| anyhow!("ckbadger activity returned an empty protocol"))?;
        let action = bounded_activity_label(&action.action, "activity action")?
            .ok_or_else(|| anyhow!("ckbadger activity returned an empty action"))?;
        if protocol_label.is_none() || protocol.eq_ignore_ascii_case("dao") {
            protocol_category = Some(if protocol.eq_ignore_ascii_case("dao") {
                "dao"
            } else {
                "protocol"
            });
            protocol_label = Some(format!("{protocol} · {action}"));
        }
    }
    if let Some(category) = protocol_category {
        return Ok((category.to_string(), protocol_label));
    }

    let mut item_category = None;
    for participant in &activity.participants {
        for item in &participant.item_deltas {
            let kind = item.kind.trim();
            if !matches!(kind, "token" | "object" | "identity") {
                return Err(anyhow!(
                    "ckbadger activity returned unsupported item kind {kind:?}"
                ));
            }
            item_category.get_or_insert_with(|| kind.to_string());
        }
    }
    if let Some(category) = item_category {
        return Ok((category, None));
    }

    let mut script_label = None;
    for call in activity.type_calls.iter().chain(&activity.lock_calls) {
        if let Some(name) = call.script_name.as_deref() {
            let name = bounded_activity_label(name, "activity script name")?;
            if script_label.is_none() {
                script_label = name;
            }
        }
    }
    if !activity.type_calls.is_empty() || !activity.lock_calls.is_empty() {
        return Ok(("script".to_string(), script_label));
    }

    Ok(("transfer".to_string(), None))
}

fn bounded_activity_label(value: &str, field: &str) -> anyhow::Result<Option<String>> {
    let value = value.trim();
    if value.chars().count() > MAX_ACTIVITY_LABEL_CHARS {
        return Err(anyhow!("ckbadger returned an overlong {field}"));
    }
    Ok((!value.is_empty()).then(|| value.to_string()))
}

fn map_asset_ecosystem(
    ecosystem: AssetEcosystemResponse,
    anchor: ChainAnchor,
) -> anyhow::Result<AssetEcosystemRecord> {
    if ecosystem.capacity_breakdown.len() > MAX_ECOSYSTEM_CATEGORIES {
        return Err(anyhow!(
            "ckbadger asset ecosystem returned too many capacity categories"
        ));
    }
    if ecosystem.top_tokens.len() > MAX_ECOSYSTEM_ASSETS {
        return Err(anyhow!(
            "ckbadger asset ecosystem returned too many top assets"
        ));
    }

    let total_live_capacity = ckb_decimal_to_shannons(
        &ecosystem.total_live_capacity_ckb,
        "asset ecosystem totalLiveCapacityCkb",
    )?;
    let total_knowledge_shannons = ckb_decimal_to_shannons(
        &ecosystem.total_knowledge_size_ckb,
        "asset ecosystem totalKnowledgeSizeCkb",
    )?;
    if total_knowledge_shannons % SHANNONS_PER_CKB != 0 {
        return Err(anyhow!(
            "ckbadger asset ecosystem returned fractional knowledge bytes"
        ));
    }
    if total_knowledge_shannons > total_live_capacity {
        return Err(anyhow!(
            "ckbadger asset ecosystem knowledge exceeds total live capacity"
        ));
    }
    let total_knowledge_bytes = u64::try_from(total_knowledge_shannons / SHANNONS_PER_CKB)
        .context("ckbadger asset ecosystem knowledge size is outside u64")?;
    wire_safe_u64(
        total_knowledge_bytes,
        "asset ecosystem total knowledge bytes",
    )?;

    let mut category_keys = HashSet::<String>::new();
    let mut category_capacity_sum = 0u128;
    let mut category_share_sum = 0u32;
    let mut capacity_breakdown = Vec::with_capacity(ecosystem.capacity_breakdown.len());
    for category in ecosystem.capacity_breakdown {
        let key = nonempty(category.category)
            .ok_or_else(|| anyhow!("ckbadger asset ecosystem returned an empty category"))?;
        if !category_keys.insert(key.clone()) {
            return Err(anyhow!(
                "ckbadger asset ecosystem returned duplicate category {key}"
            ));
        }
        let capacity = ckb_decimal_to_shannons(
            &category.capacity_ckb,
            "asset ecosystem category capacityCkb",
        )?;
        category_capacity_sum = category_capacity_sum
            .checked_add(capacity)
            .ok_or_else(|| anyhow!("ckbadger asset ecosystem category capacity overflows"))?;
        let share_bps =
            percentage_to_bps(&category.percentage, "asset ecosystem category percentage")?;
        category_share_sum = category_share_sum
            .checked_add(u32::from(share_bps))
            .ok_or_else(|| anyhow!("ckbadger asset ecosystem category share overflows"))?;
        capacity_breakdown.push(AssetEcosystemCategory {
            category: key,
            capacity_shannons: capacity.to_string(),
            share_bps,
        });
    }
    if category_capacity_sum > total_live_capacity {
        return Err(anyhow!(
            "ckbadger asset ecosystem categories exceed total live capacity"
        ));
    }
    if category_share_sum > 10_000 {
        return Err(anyhow!(
            "ckbadger asset ecosystem category shares exceed 100%"
        ));
    }

    let mut asset_hashes = HashSet::<String>::new();
    let mut top_assets = Vec::with_capacity(ecosystem.top_tokens.len());
    for asset in ecosystem.top_tokens {
        if !is_hash32(&asset.type_script_hash) {
            return Err(anyhow!(
                "ckbadger asset ecosystem returned an invalid type-script hash"
            ));
        }
        if !asset_hashes.insert(asset.type_script_hash.clone()) {
            return Err(anyhow!(
                "ckbadger asset ecosystem returned a duplicate top asset"
            ));
        }
        let capacity = ckb_decimal_to_shannons(
            &asset.total_capacity_ckb,
            "asset ecosystem token totalCapacityCkb",
        )?;
        if capacity > total_live_capacity {
            return Err(anyhow!(
                "ckbadger asset ecosystem asset capacity exceeds total live capacity"
            ));
        }
        let holders_count = nonnegative(asset.holders_count, "asset ecosystem holdersCount")?;
        wire_safe_u64(holders_count, "asset ecosystem holdersCount")?;
        top_assets.push(AssetEcosystemLeader {
            type_script_hash: asset.type_script_hash,
            name: asset.name.and_then(nonempty),
            symbol: asset.symbol.and_then(nonempty),
            holders_count,
            total_capacity_shannons: capacity.to_string(),
        });
    }

    Ok(AssetEcosystemRecord {
        source: "ckbadger".to_string(),
        as_of: anchor,
        updated_at_ms: now_ms(),
        total_live_capacity_shannons: total_live_capacity.to_string(),
        total_knowledge_bytes,
        capacity_breakdown,
        top_assets,
    })
}

struct ParticipantCapacity {
    delta: i128,
    complete: bool,
}

fn transaction_participants(
    transaction: &TransactionDetailResponse,
) -> anyhow::Result<Vec<TransactionParticipantSemantic>> {
    let mut participants = BTreeMap::<String, ParticipantCapacity>::new();
    for input in &transaction.inputs {
        accumulate_participant_capacity(
            &mut participants,
            input.address.as_deref(),
            input.capacity.as_deref(),
            -1,
            "transaction input capacity",
        )?;
    }
    for output in &transaction.outputs {
        accumulate_participant_capacity(
            &mut participants,
            output.address.as_deref(),
            Some(&output.capacity),
            1,
            "transaction output capacity",
        )?;
    }
    Ok(participants
        .into_iter()
        .map(|(address, capacity)| TransactionParticipantSemantic {
            address,
            capacity_delta: capacity.complete.then(|| capacity.delta.to_string()),
            common_knowledge_delta: None,
            facets: Vec::new(),
        })
        .collect())
}

fn accumulate_participant_capacity(
    participants: &mut BTreeMap<String, ParticipantCapacity>,
    address: Option<&str>,
    capacity: Option<&str>,
    sign: i128,
    field: &str,
) -> anyhow::Result<()> {
    let parsed = capacity
        .map(|value| signed_capacity(value, field))
        .transpose()?;
    let Some(address) = address.filter(|value| !value.is_empty()) else {
        return Ok(());
    };
    let participant = participants
        .entry(address.to_string())
        .or_insert(ParticipantCapacity {
            delta: 0,
            complete: true,
        });
    let Some(capacity) = parsed else {
        participant.complete = false;
        return Ok(());
    };
    let signed = capacity
        .checked_mul(sign)
        .ok_or_else(|| anyhow!("ckbadger {field} overflows signed capacity"))?;
    participant.delta = participant
        .delta
        .checked_add(signed)
        .ok_or_else(|| anyhow!("ckbadger participant capacity delta overflows"))?;
    Ok(())
}

fn transaction_io_facet(transaction: &TransactionDetailResponse) -> anyhow::Result<SemanticFacet> {
    let inputs = nonnegative(
        i64::from(transaction.inputs_count),
        "transaction inputsCount",
    )?;
    let outputs = nonnegative(
        i64::from(transaction.outputs_count),
        "transaction outputsCount",
    )?;
    if inputs as usize != transaction.inputs.len() || outputs as usize != transaction.outputs.len()
    {
        return Err(anyhow!(
            "ckbadger transaction I/O counts do not match the detail arrays"
        ));
    }
    let mut attributes = vec![
        attribute("inputs", inputs.to_string(), None),
        attribute("outputs", outputs.to_string(), None),
        attribute("cellbase", transaction.is_cellbase.to_string(), None),
    ];
    if let Some(block_hash) = transaction.block_hash.as_ref() {
        attributes.push(attribute("block_hash", block_hash.clone(), None));
    }
    if let Some(fee_rate) = transaction.fee_rate.as_ref() {
        unsigned_decimal(fee_rate, "transaction feeRate")?;
        attributes.push(attribute("fee_rate", fee_rate.clone(), Some("shannons/kB")));
    }
    if let Some(size) = transaction.tx_size {
        attributes.push(attribute(
            "size",
            nonnegative(i64::from(size), "transaction txSize")?.to_string(),
            Some("bytes"),
        ));
    }
    if let Some(confirmations) = transaction.confirmations {
        attributes.push(attribute(
            "confirmations",
            nonnegative(confirmations, "transaction confirmations")?.to_string(),
            None,
        ));
    }
    for (key, value, unit) in [
        (
            "inputs_capacity",
            transaction.inputs_capacity.as_ref(),
            "shannons",
        ),
        (
            "outputs_capacity",
            transaction.outputs_capacity.as_ref(),
            "shannons",
        ),
        (
            "inputs_common_knowledge",
            transaction.inputs_common_knowledge_size.as_ref(),
            "bytes",
        ),
        (
            "outputs_common_knowledge",
            transaction.outputs_common_knowledge_size.as_ref(),
            "bytes",
        ),
    ] {
        if let Some(value) = value {
            unsigned_decimal(value, key)?;
            attributes.push(attribute(key, value.clone(), Some(unit)));
        }
    }
    let observed_output_knowledge = transaction.outputs.iter().try_fold(0u64, |sum, output| {
        let value = nonnegative(
            output.common_knowledge_size,
            "transaction output commonKnowledgeSize",
        )?;
        sum.checked_add(value)
            .ok_or_else(|| anyhow!("ckbadger output common knowledge sum overflows"))
    })?;
    if transaction.outputs_common_knowledge_size.is_none() {
        attributes.push(attribute(
            "outputs_common_knowledge",
            observed_output_knowledge.to_string(),
            Some("bytes"),
        ));
    }
    Ok(SemanticFacet {
        namespace: "ckb".to_string(),
        kind: "transaction_io".to_string(),
        state: Some(transaction.status.clone()),
        attributes,
    })
}

fn transaction_lifecycle_facet(
    transaction: &TransactionDetailResponse,
    lifecycle: TransactionLifecycleResponse,
) -> anyhow::Result<SemanticFacet> {
    if lifecycle.hash != transaction.hash {
        return Err(anyhow!(
            "ckbadger lifecycle returned a different transaction"
        ));
    }
    if lifecycle.phase != "committed" || lifecycle.is_cellbase != transaction.is_cellbase {
        return Err(anyhow!(
            "ckbadger lifecycle disagrees with transaction detail"
        ));
    }
    let committed = lifecycle
        .committed_in
        .ok_or_else(|| anyhow!("ckbadger committed lifecycle has no commit block"))?;
    let detail_block = transaction
        .block_number
        .ok_or_else(|| anyhow!("ckbadger committed transaction has no block number"))?;
    let detail_hash = transaction
        .block_hash
        .as_deref()
        .ok_or_else(|| anyhow!("ckbadger committed transaction has no block hash"))?;
    if committed.block_number != detail_block || committed.block_hash != detail_hash {
        return Err(anyhow!(
            "ckbadger lifecycle commit anchor disagrees with transaction detail"
        ));
    }
    let mut attributes = vec![
        attribute("proposal_id", lifecycle.proposal_id, None),
        attribute(
            "committed_block",
            nonnegative(committed.block_number, "lifecycle committed block")?.to_string(),
            None,
        ),
    ];
    if let Some(proposed) = lifecycle.proposed_in {
        if !is_hash32(&proposed.block_hash) {
            return Err(anyhow!("ckbadger lifecycle has an invalid proposal hash"));
        }
        attributes.push(attribute(
            "proposed_block",
            nonnegative(proposed.block_number, "lifecycle proposed block")?.to_string(),
            None,
        ));
    }
    if let Some(uncle) = lifecycle.proposed_in_uncle {
        if !is_hash32(&uncle.block_hash) {
            return Err(anyhow!("ckbadger lifecycle has an invalid uncle hash"));
        }
        attributes.push(attribute(
            "proposed_uncle_block",
            nonnegative(uncle.block_number, "lifecycle proposal uncle block")?.to_string(),
            None,
        ));
    }
    if let Some(distance) = lifecycle.commitment_distance {
        attributes.push(attribute(
            "commitment_distance",
            nonnegative(distance, "lifecycle commitment distance")?.to_string(),
            Some("blocks"),
        ));
    }
    attributes.push(attribute(
        "window_close",
        nonnegative(lifecycle.commitment_window.close, "lifecycle window close")?.to_string(),
        Some("blocks"),
    ));
    attributes.push(attribute(
        "window_far",
        nonnegative(lifecycle.commitment_window.far, "lifecycle window far")?.to_string(),
        Some("blocks"),
    ));
    if let Some(confirmations) = lifecycle.confirmations {
        attributes.push(attribute(
            "confirmations",
            nonnegative(confirmations, "lifecycle confirmations")?.to_string(),
            None,
        ));
    }
    Ok(SemanticFacet {
        namespace: "ckb".to_string(),
        kind: "transaction_lifecycle".to_string(),
        state: Some(lifecycle.phase),
        attributes,
    })
}

fn attribute(
    key: impl Into<String>,
    value: impl Into<String>,
    unit: Option<&str>,
) -> SemanticAttribute {
    SemanticAttribute {
        key: key.into(),
        value: value.into(),
        unit: unit.map(str::to_string),
    }
}

fn unsigned_decimal(value: &str, field: &str) -> anyhow::Result<u128> {
    value
        .parse::<u128>()
        .with_context(|| format!("ckbadger returned invalid {field}"))
}

fn fixed_decimal_to_scaled(value: &str, scale: usize, field: &str) -> anyhow::Result<u128> {
    let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
    if whole.is_empty()
        || !whole.as_bytes().iter().all(u8::is_ascii_digit)
        || !fraction.as_bytes().iter().all(u8::is_ascii_digit)
        || value.matches('.').count() > 1
    {
        return Err(anyhow!("ckbadger returned invalid {field}"));
    }
    let (kept_fraction, extra_fraction) = if fraction.len() > scale {
        fraction.split_at(scale)
    } else {
        (fraction, "")
    };
    if extra_fraction.bytes().any(|digit| digit != b'0') {
        return Err(anyhow!("ckbadger returned over-precise {field}"));
    }
    let factor = 10u128
        .checked_pow(u32::try_from(scale).context("decimal scale exceeds u32")?)
        .ok_or_else(|| anyhow!("decimal scale overflows"))?;
    let whole = whole
        .parse::<u128>()
        .with_context(|| format!("ckbadger returned invalid {field}"))?;
    let mut padded_fraction = kept_fraction.to_string();
    padded_fraction.extend(std::iter::repeat_n('0', scale - kept_fraction.len()));
    let fraction = if padded_fraction.is_empty() {
        0
    } else {
        padded_fraction
            .parse::<u128>()
            .with_context(|| format!("ckbadger returned invalid {field}"))?
    };
    whole
        .checked_mul(factor)
        .and_then(|value| value.checked_add(fraction))
        .ok_or_else(|| anyhow!("ckbadger {field} overflows"))
}

fn ckb_decimal_to_shannons(value: &str, field: &str) -> anyhow::Result<u128> {
    fixed_decimal_to_scaled(value, 8, field)
}

fn signed_fixed_decimal_to_scaled(value: &str, scale: usize, field: &str) -> anyhow::Result<i128> {
    let (negative, magnitude) = if let Some(value) = value.strip_prefix('-') {
        (true, value)
    } else {
        (false, value.strip_prefix('+').unwrap_or(value))
    };
    let magnitude = fixed_decimal_to_scaled(magnitude, scale, field)?;
    let magnitude =
        i128::try_from(magnitude).with_context(|| format!("ckbadger {field} is outside i128"))?;
    if negative {
        magnitude
            .checked_neg()
            .ok_or_else(|| anyhow!("ckbadger {field} overflows"))
    } else {
        Ok(magnitude)
    }
}

fn signed_ckb_decimal_to_shannons(value: &str, field: &str) -> anyhow::Result<i128> {
    signed_fixed_decimal_to_scaled(value, 8, field)
}

fn percentage_to_bps(value: &str, field: &str) -> anyhow::Result<u16> {
    let bps = fixed_decimal_to_scaled(value, 2, field)?;
    if bps > 10_000 {
        return Err(anyhow!("ckbadger returned {field} above 100%"));
    }
    u16::try_from(bps).with_context(|| format!("ckbadger returned invalid {field}"))
}

fn signed_capacity(value: &str, field: &str) -> anyhow::Result<i128> {
    value
        .parse::<i128>()
        .with_context(|| format!("ckbadger returned invalid {field}"))
        .and_then(|value| {
            (value >= 0)
                .then_some(value)
                .ok_or_else(|| anyhow!("ckbadger returned negative {field}"))
        })
}

fn nonempty(value: impl Into<String>) -> Option<String> {
    let value = value.into();
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn udt_asset_request(cell: &CellDetailResponse) -> anyhow::Result<Option<(String, String)>> {
    let Some(decoded) = cell
        .data_analysis
        .as_ref()
        .and_then(|analysis| analysis.deterministic.as_ref())
        .filter(|decoded| decoded.kind == "udt_amount")
    else {
        return Ok(None);
    };
    let amount = decoded
        .segments
        .iter()
        .find(|segment| segment.label == "amount")
        .map(|segment| segment.human_value.clone())
        .ok_or_else(|| anyhow!("ckbadger UDT decode has no amount segment"))?;
    unsigned_decimal(&amount, "UDT amount")?;
    let type_script_hash = cell
        .type_script_hash
        .clone()
        .ok_or_else(|| anyhow!("ckbadger UDT decode has no type-script hash"))?;
    if !is_hash32(&type_script_hash) {
        return Err(anyhow!(
            "ckbadger UDT decode has an invalid type-script hash"
        ));
    }
    Ok(Some((type_script_hash, amount)))
}

/// Maps the itemized byte breakdown, plus the source's own exact occupied
/// capacity when it stated one.
///
/// The two are checked against DIFFERENT invariants on purpose. The four
/// component byte counts must add up to `total_bytes` — a breakdown that does
/// not explain its own total is broken. `commonKnowledgeSize` is computed
/// upstream from the Cell's stored occupied capacity, which counts script args
/// the byte breakdown never itemizes, so it routinely exceeds
/// `total_bytes * SHANNONS_PER_BYTE`. That residual is the whole reason to
/// carry it: cross-checking the two would reject exactly the cells whose
/// unindexed args this figure exists to reveal.
fn map_common_knowledge(
    breakdown: CommonKnowledgeSizeBreakdown,
    occupied_shannons: Option<i64>,
) -> anyhow::Result<CommonKnowledgeBreakdown> {
    let occupied_shannons = occupied_shannons
        .map(|value| {
            let shannons = nonnegative(value, "commonKnowledgeSize")?;
            Ok::<_, anyhow::Error>(shannons.to_string())
        })
        .transpose()?;
    let mapped = CommonKnowledgeBreakdown {
        total_bytes: nonnegative(breakdown.total_bytes, "totalBytes")?,
        capacity_field_bytes: nonnegative(breakdown.capacity_field_bytes, "capacityFieldBytes")?,
        lock_script_bytes: nonnegative(breakdown.lock_script_bytes, "lockScriptBytes")?,
        type_script_bytes: nonnegative(breakdown.type_script_bytes, "typeScriptBytes")?,
        data_bytes: nonnegative(breakdown.data_bytes, "dataBytes")?,
        occupied_shannons,
    };
    let component_total = mapped
        .capacity_field_bytes
        .checked_add(mapped.lock_script_bytes)
        .and_then(|value| value.checked_add(mapped.type_script_bytes))
        .and_then(|value| value.checked_add(mapped.data_bytes))
        .ok_or_else(|| anyhow!("ckbadger common-knowledge breakdown overflows"))?;
    if component_total != mapped.total_bytes {
        return Err(anyhow!(
            "ckbadger common-knowledge breakdown totals {} bytes, expected {}",
            component_total,
            mapped.total_bytes
        ));
    }
    Ok(mapped)
}

fn map_script(
    script: ScriptResponse,
    script_hash: String,
    lookups: &ScriptLookupResponse,
) -> SemanticScript {
    let lookup = lookups.get(&script.code_hash);
    SemanticScript {
        script_hash,
        code_hash: script.code_hash,
        hash_type: script.hash_type,
        args: script.args,
        name: lookup.map(|info| info.name.clone()),
        family: lookup.and_then(script_family),
        deprecated: lookup.map(|info| info.deprecated),
    }
}

fn script_family(info: &ScriptLookupInfo) -> Option<String> {
    info.decoder_type
        .clone()
        .or_else(|| info.script_kind.clone())
        .or_else(|| (info.resolution_state != "resolved").then(|| info.resolution_state.clone()))
}

fn map_cell_content(
    data_size: i64,
    data: Option<String>,
    analysis: Option<CellDataAnalysis>,
) -> anyhow::Result<SemanticCellContent> {
    let total_bytes = nonnegative(data_size, "Cell dataSize")?;
    let (data_hex, data_complete) = map_cell_data_preview(data, total_bytes)?;
    let (deterministic, heuristics) = match analysis {
        Some(analysis) => {
            if analysis.heuristic_guesses.len() > MAX_CELL_CONTENT_GUESSES {
                return Err(anyhow!(
                    "ckbadger returned {} Cell-data guesses, limit is {MAX_CELL_CONTENT_GUESSES}",
                    analysis.heuristic_guesses.len()
                ));
            }
            let deterministic = analysis
                .deterministic
                .map(|decoded| {
                    if decoded.segments.len() > MAX_CELL_CONTENT_SEGMENTS {
                        return Err(anyhow!(
                            "ckbadger returned {} Cell-data segments, limit is {MAX_CELL_CONTENT_SEGMENTS}",
                            decoded.segments.len()
                        ));
                    }
                    let segments = decoded
                        .segments
                        .into_iter()
                        .map(|segment| {
                            let start_byte = nonnegative(segment.start, "Cell data segment start")?;
                            let end_byte = nonnegative(segment.end, "Cell data segment end")?;
                            if start_byte > end_byte || end_byte > total_bytes {
                                return Err(anyhow!(
                                    "ckbadger Cell-data segment {:?} has invalid range {start_byte}..{end_byte} for {total_bytes} bytes",
                                    segment.label
                                ));
                            }
                            Ok(SemanticContentSegment {
                                label: segment.label,
                                start_byte,
                                end_byte,
                                meaning: segment.meaning,
                                value: segment.human_value,
                            })
                        })
                        .collect::<anyhow::Result<Vec<_>>>()?;
                    Ok(SemanticContentDecode {
                        kind: decoded.kind,
                        summary: decoded.summary,
                        segments,
                    })
                })
                .transpose()?;
            let heuristics = analysis
                .heuristic_guesses
                .into_iter()
                .map(|guess| SemanticContentGuess {
                    kind: guess.kind,
                    confidence: guess.confidence,
                    reason: guess.reason,
                    mime_type: guess.mime_type,
                    value: guess.human_value,
                })
                .collect();
            (deterministic, heuristics)
        }
        None => (None, Vec::new()),
    };
    Ok(SemanticCellContent {
        total_bytes,
        data_hex,
        data_complete,
        deterministic,
        heuristics,
    })
}

fn map_cell_data_preview(
    data: Option<String>,
    total_bytes: u64,
) -> anyhow::Result<(Option<String>, bool)> {
    let Some(data) = data else {
        return Ok((None, false));
    };
    let body = data
        .strip_prefix("0x")
        .ok_or_else(|| anyhow!("ckbadger Cell data is not 0x-prefixed hex"))?;
    if body.len() % 2 != 0 || !body.as_bytes().iter().all(u8::is_ascii_hexdigit) {
        return Err(anyhow!("ckbadger Cell data is not whole-byte hex"));
    }
    let actual_bytes = u64::try_from(body.len() / 2)
        .context("ckbadger Cell data length exceeds the platform range")?;
    if actual_bytes != total_bytes {
        return Err(anyhow!(
            "ckbadger Cell data contains {actual_bytes} bytes, expected {total_bytes}"
        ));
    }
    let preview_chars = body.len().min(MAX_CELL_CONTENT_PREVIEW_BYTES * 2);
    let complete = preview_chars == body.len();
    // Same marker as the canonical Cell's `data_hex` — one convention, one
    // client-side strip, and ASCII so neither can break the columnar blob.
    let suffix = if complete {
        String::new()
    } else {
        DATA_HEX_TRUNCATION_MARKER.to_string()
    };
    Ok((
        Some(format!("0x{}{suffix}", &body[..preview_chars])),
        complete,
    ))
}

/// Builds the DAO position facet.
///
/// Blocks lead, wall clocks follow: the timestamp rows are APPENDED after every
/// existing attribute so a reader that shows only the leading few keeps showing
/// the same leading few. A timestamp the source could not resolve — an empty
/// string upstream substitutes for a missing block header, or any instant this
/// parser does not recognise — is simply absent, because a DAO position with an
/// unreadable deposit date is still a DAO position worth reading.
fn dao_facet(dao: DaoInfo) -> anyhow::Result<SemanticFacet> {
    let mut attributes = vec![SemanticAttribute {
        key: "deposit_block".to_string(),
        value: nonnegative(dao.deposit_block_number, "depositBlockNumber")?.to_string(),
        unit: Some("block".to_string()),
    }];
    if let Some(block) = dao.withdraw_request_block {
        attributes.push(SemanticAttribute {
            key: "withdraw_request_block".to_string(),
            value: nonnegative(block, "withdrawRequestBlock")?.to_string(),
            unit: Some("block".to_string()),
        });
    }
    if let Some(block) = dao.withdraw_block {
        attributes.push(SemanticAttribute {
            key: "withdraw_block".to_string(),
            value: nonnegative(block, "withdrawBlock")?.to_string(),
            unit: Some("block".to_string()),
        });
    }
    if let Some(compensation) = dao.compensation_ckb {
        attributes.push(SemanticAttribute {
            key: "compensation".to_string(),
            value: compensation,
            unit: Some("CKB".to_string()),
        });
    }
    if let Some(apc) = dao.estimated_apc {
        attributes.push(SemanticAttribute {
            key: "estimated_apc".to_string(),
            value: apc,
            unit: None,
        });
    }
    for (key, timestamp) in [
        ("deposit_at_ms", dao.deposit_timestamp),
        ("withdraw_request_at_ms", dao.withdraw_request_timestamp),
        ("withdraw_at_ms", dao.withdraw_timestamp),
    ] {
        let Some(at_ms) = timestamp.as_deref().and_then(rfc3339_to_ms) else {
            continue;
        };
        attributes.push(SemanticAttribute {
            key: key.to_string(),
            value: at_ms.to_string(),
            unit: Some("ms".to_string()),
        });
    }
    Ok(SemanticFacet {
        namespace: "ckb".to_string(),
        kind: "dao".to_string(),
        state: Some(dao.dao_status),
        attributes,
    })
}

/// The collection facts every object family states, in the one shape the
/// facets are built from.
///
/// Two indexes answer the same questions in two vocabularies — `sporesCount`
/// against `liveCount`, a description on the cluster itself against one nested
/// in the class — and there is exactly one set of answers, so the two
/// spellings are reconciled here at the edge rather than twice inside the
/// mapper.
struct CollectionFacts {
    name: Option<String>,
    description: Option<String>,
    live_items: i64,
    holders: i64,
    owned_capacity: Option<String>,
    composition: Option<CollectionCompositionDto>,
}

impl From<ClusterDetailResponse> for CollectionFacts {
    fn from(cluster: ClusterDetailResponse) -> Self {
        Self {
            name: cluster.name,
            description: cluster.description,
            live_items: cluster.spores_count,
            holders: cluster.holders_count,
            owned_capacity: cluster.owned_capacity,
            composition: cluster.composition,
        }
    }
}

impl From<NftCollectionDetailResponse> for CollectionFacts {
    fn from(collection: NftCollectionDetailResponse) -> Self {
        Self {
            name: collection.name,
            description: collection.class_detail.and_then(|class| class.description),
            live_items: collection.live_count,
            holders: collection.holders_count,
            owned_capacity: collection.owned_capacity,
            composition: collection.composition,
        }
    }
}

/// Assembles one object's facets out of whatever its lookups established.
///
/// The two are independent by construction, because their sources are: a
/// collection facet carrying nothing but a role and an id still answers whose
/// kin the object is, and a composition facet carrying only the object's own
/// tier still answers where that one object lives. So each attribute appears
/// on its own evidence, and a half that never arrived is simply absent rather
/// than zero — a collection with no stated population is not a collection of
/// none.
///
/// `role` is `None` for an object whose decode named no collection either way:
/// there is nothing truthful to say about its kin, so no collection facet is
/// built at all. `item` is `None` for a family that publishes no per-item
/// measurement — M-NFT states composition only for a whole class — and the
/// composition facet then carries the population's answer alone, which is the
/// same shape a cluster Cell already produced.
fn map_object_facets(
    namespace: &str,
    role: Option<&str>,
    collection_id: Option<&str>,
    item: Option<SporeItemResponse>,
    collection: Option<CollectionFacts>,
) -> Vec<SemanticFacet> {
    let media = item.as_ref().and_then(|item| item.media_profile.as_ref());
    let item_tier = media.and_then(|profile| nonempty(profile.tier.as_str()));
    let aggregate = collection
        .as_ref()
        .and_then(|collection| collection.composition.as_ref());
    let aggregate_tier = aggregate.and_then(|aggregate| nonempty(aggregate.tier.as_str()));

    let mut composition = Vec::new();
    if let Some(tier) = item_tier.clone() {
        composition.push(attribute("item_tier", tier, None));
    }
    // Zero issues is the ordinary case and says nothing; a count only appears
    // once there is something wrong to count.
    if let Some(issues) = media
        .map(|profile| profile.issues.len())
        .filter(|issues| *issues > 0)
    {
        composition.push(attribute("item_issues", issues.to_string(), None));
    }
    if let Some(aggregate) = aggregate {
        if let Some(tier) = aggregate_tier.clone() {
            composition.push(attribute("agg_tier", tier, None));
        }
        composition.extend(
            [
                stated_count("agg_onchain", aggregate.onchain_count),
                stated_count("agg_pure_ckb", aggregate.pure_ckb_count),
                stated_count("agg_decentralized", aggregate.decentralized_mixture_count),
                stated_count("agg_centralized", aggregate.centralized_mixture_count),
                stated_count("agg_unknown", aggregate.unknown_count),
            ]
            .into_iter()
            .flatten(),
        );
    }
    // The headline is the object's own tier when it has one — that is the
    // question a reader of one object is asking. A cluster Cell holds no media
    // of its own, and neither does an M-NFT token upstream, so their headline
    // is the population's.
    let headline = item_tier.or(aggregate_tier);

    let mut facets = Vec::new();
    if let Some(role) = role {
        let mut attributes = vec![attribute("role", role, None)];
        if let Some(collection_id) = collection_id {
            attributes.push(attribute("collection_id", collection_id, None));
        }
        let mut state = None;
        if let Some(collection) = collection {
            state = collection.name.and_then(nonempty);
            attributes.extend(
                [
                    stated_count("live_items", collection.live_items),
                    stated_count("holders", collection.holders),
                ]
                .into_iter()
                .flatten(),
            );
            if let Some(capacity) = collection
                .owned_capacity
                .and_then(nonempty)
                .filter(|capacity| unsigned_decimal(capacity, "collection ownedCapacity").is_ok())
            {
                attributes.push(attribute("owned_capacity", capacity, Some("shannons")));
            }
            if let Some(description) = collection
                .description
                .and_then(nonempty)
                .as_deref()
                .and_then(collection_description_text)
            {
                attributes.push(attribute(
                    "description",
                    description
                        .chars()
                        .take(MAX_COLLECTION_DESCRIPTION_CHARS)
                        .collect::<String>(),
                    None,
                ));
            }
        }
        facets.push(SemanticFacet {
            namespace: namespace.to_string(),
            kind: "collection".to_string(),
            state,
            attributes,
        });
    }
    if !composition.is_empty() {
        facets.push(SemanticFacet {
            namespace: namespace.to_string(),
            kind: "composition".to_string(),
            state: headline,
            attributes: composition,
        });
    }
    facets
}

/// The class an M-NFT Cell belongs to, read off its own type script.
///
/// M-NFT keys everything by the args rather than by cell data: a 20-byte
/// issuer id and a 4-byte class id name the collection, and a token's own
/// 4-byte serial follows them — so one derivation serves the token cell and
/// the class cell alike, and a class cell's trailing bytes are simply not part
/// of the id. Args too short to hold those 24 bytes, or not hex at all, name
/// no class: that is unknown, and unknown is never dressed up as an id
/// something could be looked up by. Lowercased because the id leaves here as a
/// path segment, and ckbadger's asset index is keyed in lower case.
fn mnft_collection_id(args: Option<&str>) -> Option<String> {
    let hex = args?.strip_prefix("0x")?;
    if hex.len() < MNFT_COLLECTION_ID_HEX_CHARS || !hex.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    Some(format!(
        "0x{}",
        hex[..MNFT_COLLECTION_ID_HEX_CHARS].to_ascii_lowercase()
    ))
}

/// A count an object index stated about itself. Negative is not a smaller
/// number, it is a broken one, so it is withheld rather than printed.
fn stated_count(key: &str, value: i64) -> Option<SemanticAttribute> {
    nonnegative(value, key)
        .ok()
        .map(|count| attribute(key, count.to_string(), None))
}

/// The sentence inside a collection's description field.
///
/// ClusterData's description is free text by protocol, but DOB clusters pack a
/// JSON envelope — `{"description": "…", "dob": {decoder, pattern, …}}` —
/// where only the inner sentence is prose and the rest is decoder
/// configuration no reader of a Cell card wants. Live mainnet made the cost
/// concrete: the bounded cut landed mid-JSON and the panel's hover read like a
/// config file. So exactly that shape is unwrapped; any other text — plain
/// prose, malformed JSON, an envelope with no inner sentence — passes through
/// verbatim, because second-guessing free text any further than the one shape
/// DOB actually mints would be this side inventing a description. Which is
/// also why an M-NFT class runs through the same door: its description is
/// already a sentence, and a sentence crosses unchanged.
fn collection_description_text(raw: &str) -> Option<String> {
    let inner = serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .as_ref()
        .and_then(|value| value.get("description"))
        .and_then(|value| value.as_str())
        .and_then(nonempty);
    inner.or_else(|| nonempty(raw))
}

/// Milliseconds since the Unix epoch for an RFC 3339 instant, or `None` when
/// the text is not one this parser can read exactly.
///
/// ckbadger prints DAO instants with `chrono`'s `to_rfc3339` over a UTC
/// second-precision value, so the shapes that actually arrive are
/// `1970-01-01T00:00:00+00:00` and the `Z` spelling of the same. Rather than
/// take a date-time dependency for three optional rows, this reads the fixed
/// layout directly: any offset is honoured, a fractional second is truncated
/// toward the second it belongs to, and anything else — including the empty
/// string upstream substitutes for a missing block header — is unknown rather
/// than guessed.
fn rfc3339_to_ms(value: &str) -> Option<u64> {
    let bytes = value.as_bytes();
    if bytes.len() < 19 || !bytes[10].eq_ignore_ascii_case(&b'T') {
        return None;
    }
    let number = |range: std::ops::Range<usize>| -> Option<i64> {
        let text = value.get(range)?;
        text.bytes()
            .all(|digit| digit.is_ascii_digit())
            .then(|| text.parse::<i64>().ok())
            .flatten()
    };
    if bytes[4] != b'-' || bytes[7] != b'-' || bytes[13] != b':' || bytes[16] != b':' {
        return None;
    }
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    let (hour, minute, second) = (number(11..13)?, number(14..16)?, number(17..19)?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    if hour > 23 || minute > 59 || second > 60 {
        return None;
    }

    let mut rest = &value[19..];
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits = fraction.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 {
            return None;
        }
        rest = &fraction[digits..];
    }
    // Offsets are subtracted because the printed wall clock is local to them.
    let offset_seconds = if rest.eq_ignore_ascii_case("Z") || rest.is_empty() {
        0
    } else {
        let sign = match rest.as_bytes().first() {
            Some(b'+') => 1,
            Some(b'-') => -1,
            _ => return None,
        };
        // Sliced through `get` rather than `[..]`: this text arrives off the
        // wire, and a multi-byte character mid-offset would panic an index.
        let body = &rest[1..];
        let (offset_hours, offset_minutes) = match body.len() {
            5 if body.as_bytes()[2] == b':' => (
                rfc3339_offset_part(body.get(0..2))?,
                rfc3339_offset_part(body.get(3..5))?,
            ),
            4 => (
                rfc3339_offset_part(body.get(0..2))?,
                rfc3339_offset_part(body.get(2..4))?,
            ),
            _ => return None,
        };
        if offset_hours > 23 || offset_minutes > 59 {
            return None;
        }
        sign * (offset_hours * 3600 + offset_minutes * 60)
    };

    // Howard Hinnant's `days_from_civil`, shifting the era so March leads the
    // year and the leap day lands last.
    let year = year - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;

    let seconds = days
        .checked_mul(86_400)?
        .checked_add(hour * 3600 + minute * 60 + second)?
        .checked_sub(offset_seconds)?;
    u64::try_from(seconds).ok()?.checked_mul(1_000)
}

fn rfc3339_offset_part(text: Option<&str>) -> Option<i64> {
    let text = text?;
    text.bytes()
        .all(|digit| digit.is_ascii_digit())
        .then(|| text.parse::<i64>().ok())
        .flatten()
}

/// The end of a Cell's life, when the source both calls it dead and names the
/// transaction that spent it.
///
/// A dead Cell whose consumer the index never recorded yields nothing: the
/// record would then assert a death it cannot attribute, and the absent field
/// already says "not stated". A malformed hash is a different thing entirely —
/// the source contradicting its own format — and is refused.
fn map_consumption(
    status: Option<&str>,
    consumed_at_block: Option<i64>,
    consumed_by_tx: Option<String>,
) -> anyhow::Result<Option<SemanticCellConsumption>> {
    if status != Some("dead") {
        return Ok(None);
    }
    let Some(tx_hash) = consumed_by_tx else {
        return Ok(None);
    };
    if !is_hash32(&tx_hash) {
        return Err(anyhow!(
            "ckbadger Cell consumedByTx is not a 0x-prefixed 32-byte hash"
        ));
    }
    let block = consumed_at_block
        .map(|block| {
            let block = nonnegative(block, "consumedAtBlock")?;
            wire_safe_u64(block, "consumedAtBlock")
        })
        .transpose()?;
    Ok(Some(SemanticCellConsumption { tx_hash, block }))
}

fn nonnegative(value: i64, field: &str) -> anyhow::Result<u64> {
    u64::try_from(value).with_context(|| format!("ckbadger returned negative {field}"))
}

fn wire_safe_u64(value: u64, field: &str) -> anyhow::Result<u64> {
    (value <= MAX_WIRE_SAFE_U64)
        .then_some(value)
        .ok_or_else(|| anyhow!("ckbadger returned {field} outside the JSON safe-integer range"))
}

fn is_hash32(value: &str) -> bool {
    value.len() == 66
        && value.starts_with("0x")
        && value.as_bytes()[2..].iter().all(u8::is_ascii_hexdigit)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::{get, post};
    use axum::{Json, Router};
    use cknerv_core::{GalaxyCompositionCandidates, RecentBlock, ScriptId};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    const TX_HASH: &str = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const ASSET_TX_HASH: &str =
        "0x3333333333333333333333333333333333333333333333333333333333333333";
    const ASSET_TYPE_HASH: &str =
        "0x2222222222222222222222222222222222222222222222222222222222222222";
    const TX_BLOCK_HASH: &str =
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    /// Capability strings are feature switches the browser reads by literal
    /// name, so a rename here removes a feature there with every gate green —
    /// `peer_sighting` alone gates the entire crawler dossier
    /// (`ui-app/src/App.tsx`). The shared fixture is where the two sides agree
    /// on the spelling; the TS twin
    /// (`packages/cache/__tests__/wireFixtures.test.ts`) asserts every string
    /// its own code consumes appears in this same list.
    ///
    /// Order-sensitive, matching the house style for authored fixtures: the
    /// wire array is `CAPABILITIES` in declaration order, then the one
    /// conditional capability the fixture's source has enabled.
    ///
    /// If this fails after an intended change, regenerate with
    /// `CKNERV_REGEN_FIXTURES=1 cargo test -p cknerv-core --test wire_shape`
    /// — but note the fixture's `source` round-trips through its own committed
    /// bytes, so the capability list must be hand-corrected there first.
    #[test]
    fn declared_capabilities_are_spelled_the_same_in_the_shared_fixture() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/enrichment_samples.json"
        );
        let raw =
            std::fs::read_to_string(path).expect("read tests/fixtures/enrichment_samples.json");
        let fixture: serde_json::Value =
            serde_json::from_str(&raw).expect("parse tests/fixtures/enrichment_samples.json");

        let expected: Vec<&str> = CAPABILITIES
            .iter()
            .copied()
            .chain(std::iter::once(GALAXY_COMPOSITION_CAPABILITY))
            .collect();

        for pointer in [
            "/snapshot/source/capabilities",
            "/deltas/source_status/source/capabilities",
        ] {
            let listed: Vec<&str> = fixture
                .pointer(pointer)
                .and_then(|value| value.as_array())
                .unwrap_or_else(|| panic!("{pointer} is missing from the fixture"))
                .iter()
                .map(|value| value.as_str().expect("capability is a string"))
                .collect();
            assert_eq!(
                listed, expected,
                "{pointer} drifted from what this crate declares"
            );
        }
    }

    async fn spawn_mock_api(block_hash: &str) -> (Url, tokio::task::JoinHandle<()>) {
        let response_hash = block_hash.to_string();
        let app = Router::new()
            .route(
                "/api/v1/statistics/network",
                get(|| async {
                    Json(serde_json::json!({
                        "syncStatus": {
                            "isSyncing": false,
                            "syncedBlock": 100
                        }
                    }))
                }),
            )
            .route(
                "/api/v1/statistics/tx-stats",
                get(|| async {
                    Json(serde_json::json!({
                        "currentHour": 12,
                        "currentDay": 345,
                        "hourlyData": [
                            { "label": "10:00", "value": 7 },
                            { "label": "11:00", "value": 9 },
                            { "label": "12:00", "value": 12 }
                        ],
                        "dailyData": [
                            { "label": "08/03", "value": 300 },
                            { "label": "08/04", "value": 321 },
                            { "label": "08/05", "value": 345 }
                        ]
                    }))
                }),
            )
            .route(
                "/api/v1/network/summary",
                get(|| async {
                    Json(serde_json::json!({
                        "enabled": true,
                        "hasData": true,
                        "lastRound": {
                            "roundId": 7,
                            "startedAt": 1699999990,
                            "finishedAt": 1700000000,
                            "candidatePeers": 61,
                            "verifiedRetainedPeers": 42,
                            "reachablePeers": 9,
                            "verifiedUnavailablePeers": 33,
                            "exhaustedCandidates": 51,
                            "foreignPeers": 1,
                            "addressAttempts": 90,
                            "nonSuccessfulAddressAttempts": 81,
                            "malformedAddresses": 0,
                            "newVerifiedPeers": 3,
                            "addressObservations": {
                                "dialRequestFailed": 20,
                                "noAuthenticatedSessionBeforeDeadline": 45,
                                "authenticatedSessionWithoutIdentifyBeforeDeadline": 8,
                                "malformedIdentify": 4,
                                "foreignNetwork": 4,
                                "sameNetworkIdentified": 9
                            }
                        },
                        "activeRound": null
                    }))
                }),
            )
            .route(
                "/api/v1/network/peers",
                get(|axum::extract::Query(query): axum::extract::Query<HashMap<String, String>>| async move {
                    // The roster is the only reader of this page now — the
                    // atlas counts a census instead — and it asks with its own
                    // budget. An unbounded page is the failure this asserts
                    // against.
                    let limit: usize = query
                        .get("limit")
                        .expect("network peers fetched with no bound")
                        .parse()
                        .expect("network peers fetched with an unreadable bound");
                    assert!(
                        limit > 0 && limit <= 256,
                        "network peers fetched with an unexpected bound: {limit}"
                    );
                    // And an unscoped page is the other one. `network/peers`
                    // answers every rung of the crawler's evidence gradient
                    // from one route, sorted by advertise time, so a reader
                    // that forgets the scope hands a bounded budget to
                    // whoever the gossip mentioned last. The roster asks rung
                    // by rung so its budget is spent strongest first.
                    let scope = query
                        .get("state")
                        .map(String::as_str)
                        .expect("network peers fetched without a scope");
                    let items = match scope {
                        "reachable" => serde_json::json!([
                            {
                                "peerId": "7065657241",
                                "crawlerDialState": "reachable",
                                "primaryAddr": "/ip4/127.0.0.1/tcp/8115",
                                "version": "0.119.0",
                                "country": "SG",
                                "asn": "AS1 Example",
                                "lastAdvertisedAt": 30,
                                "latestPositiveObservedAt": 30,
                                "lastDialObservedAt": 30,
                                "lastReachableAt": 30,
                                "rttMs": 12
                            },
                            {
                                "peerId": "7065657242",
                                "crawlerDialState": "reachable",
                                "primaryAddr": "/ip4/127.0.0.2/tcp/8115",
                                "version": "0.119.0",
                                "country": "SG",
                                "asn": "AS1 Example",
                                "lastAdvertisedAt": 20,
                                "latestPositiveObservedAt": 20,
                                "lastDialObservedAt": 12,
                                "lastReachableAt": 10,
                                "rttMs": null
                            },
                            {
                                "peerId": "7065657243",
                                "crawlerDialState": "reachable",
                                "primaryAddr": "/ip4/127.0.0.3/tcp/8115",
                                "version": "0.118.0",
                                "country": "US",
                                "asn": "AS2 Example",
                                "lastAdvertisedAt": 10,
                                "latestPositiveObservedAt": 10,
                                "lastDialObservedAt": 18,
                                "lastReachableAt": 10,
                                "rttMs": 24
                            }
                        ]),
                        // Verified once, silent now — and with no geolocation
                        // behind it, which upstream answers with its own word
                        // rather than with a null.
                        "verifiedUnavailable" => serde_json::json!([
                            {
                                "peerId": "7065657244",
                                "crawlerDialState": "verifiedUnavailable",
                                "primaryAddr": "/ip4/127.0.0.4/tcp/8115",
                                "version": "0.117.0",
                                "country": "Unknown",
                                "asn": "Unknown",
                                "lastAdvertisedAt": 28,
                                "latestPositiveObservedAt": 28,
                                "lastDialObservedAt": 28,
                                "lastReachableAt": 6,
                                "rttMs": null
                            }
                        ]),
                        // Hearsay: a real id on a real address that no dial
                        // has ever got an answer out of. Every field a dial
                        // would have filled is null, and null is how it
                        // leaves.
                        "advertisedUnverified" => serde_json::json!([
                            {
                                "peerId": "7065657245",
                                "crawlerDialState": "advertisedUnverified",
                                "primaryAddr": "/ip4/127.0.0.5/tcp/8115",
                                "version": null,
                                "country": null,
                                "asn": null,
                                "lastAdvertisedAt": 30,
                                "latestPositiveObservedAt": 30,
                                "lastDialObservedAt": 26,
                                "lastReachableAt": null,
                                "rttMs": null
                            }
                        ]),
                        other => panic!("network peers fetched with an unexpected scope: {other}"),
                    };
                    Json(serde_json::json!({
                        "items": items,
                        // Only the strongest rung says there is more behind
                        // it, so the record's `truncated` has exactly one
                        // source in this fixture.
                        "nextCursor": if scope == "reachable" { Some("7065657243") } else { None }
                    }))
                }),
            )
            .route(
                "/api/v1/network/distributions",
                get(|| async {
                    // A census over the same forty-two peers the round says it
                    // holds verified — three histograms that partition them,
                    // and `protocols`, which does not: two labels that each
                    // cover the whole set. It is on the wire here precisely
                    // because nothing declares it, so a decode that quietly
                    // started reading it would land in the partition check.
                    Json(serde_json::json!({
                        "verifiedRetained": 42,
                        "sameNetworkReachable": 9,
                        "verifiedUnavailable": 33,
                        "versions": [
                            { "label": "0.119.0", "count": 30 },
                            { "label": "0.118.0", "count": 12 }
                        ],
                        "countries": [
                            { "label": "SG", "count": 25 },
                            { "label": "US", "count": 17 }
                        ],
                        "asns": [
                            { "label": "AS1 Example", "count": 40 },
                            { "label": "AS2 Example", "count": 2 }
                        ],
                        "protocols": [
                            { "label": "/ckb/discovery", "count": 42 },
                            { "label": "/ckb/identify", "count": 42 }
                        ]
                    }))
                }),
            )
            .route(
                "/api/v1/blocks/:number",
                get(move |axum::extract::Path(number): axum::extract::Path<i64>| {
                    let hash = response_hash.clone();
                    async move {
                        if number == 100 {
                            (
                                StatusCode::OK,
                                Json(serde_json::json!({
                                    "number": 100,
                                    "hash": hash
                                })),
                            )
                        } else {
                            (
                                StatusCode::NOT_FOUND,
                                Json(serde_json::json!({
                                    "error": "block not found"
                                })),
                            )
                        }
                    }
                }),
            )
            .route(
                "/api/v1/statistics/asset-ecosystem",
                get(|| async {
                    Json(serde_json::json!({
                        "topTokens": [{
                            "typeScriptHash": ASSET_TYPE_HASH,
                            "name": "Nervos Test Token",
                            "symbol": "NTT",
                            "holdersCount": 42,
                            "totalCapacityCkb": "1234.50000000"
                        }],
                        "capacityBreakdown": [
                            {
                                "category": "dao",
                                "capacityCkb": "250000.00000000",
                                "percentage": "25.00"
                            },
                            {
                                "category": "tokens",
                                "capacityCkb": "10000.50000000",
                                "percentage": "1.00"
                            },
                            {
                                "category": "other",
                                "capacityCkb": "739999.50000000",
                                "percentage": "74.00"
                            }
                        ],
                        "totalLiveCapacityCkb": "1000000.00000000",
                        "totalKnowledgeSizeCkb": "12345"
                    }))
                }),
            )
            .route(
                "/api/v1/dao/statistics",
                get(|| async {
                    Json(serde_json::json!({
                        "tipBlockNumber": 99,
                        "totalDeposited": "837703738002110308",
                        "totalDepositedCkb": "8377037380.02110308",
                        "totalDepositors": 16740,
                        "activeDeposits": 22659,
                        "totalCompensationPaid": "74401943107226997",
                        "totalCompensationPaidCkb": "744019431.07226997",
                        "unclaimedCompensation": "81345902996799859",
                        "unclaimedCompensationCkb": "813459029.96799859",
                        "averageDepositDays": "411.75",
                        "estimatedApc": "2.01",
                        "miningReward": "0",
                        "miningRewardCkb": "0.00000000",
                        "depositCompensation": "0",
                        "depositCompensationCkb": "0.00000000",
                        "burnt": "0",
                        "burntCkb": "0.00000000",
                        "pendingWithdrawalCapacity": "77523020877862416",
                        "pendingWithdrawalCapacityCkb": "775230208.77862416",
                        "depositChange24h": "1415305.99353229",
                        "depositorsChange24h": 5
                    }))
                }),
            )
            .route(
                "/api/v1/hardforks",
                get(|| async {
                    Json(serde_json::json!({
                        "network": "mainnet",
                        "tipEpoch": 12300,
                        "tipBlock": 100,
                        "events": [
                            {
                                "id": "mirana-2021",
                                "shortName": "Mirana",
                                "editionYear": 2021,
                                "activationEpoch": 5414,
                                "activationBlock": 70,
                                "status": "activated"
                            },
                            {
                                "id": "meepo-2024",
                                "shortName": "Meepo",
                                "editionYear": 2024,
                                "activationEpoch": 12293,
                                "activationBlock": 99,
                                "status": "activated"
                            }
                        ]
                    }))
                }),
            )
            .route(
                "/api/v1/forks/recent",
                get(|| async {
                    Json(serde_json::json!({
                        "hasRecentReorg": true,
                        "reorg": {
                            "id": 1700000000008_i64,
                            "detectedAt": "2023-11-14T22:13:20+00:00",
                            "forkPointNumber": 97,
                            "forkPointHash": format!("0x{}", "11".repeat(32)),
                            "oldTipNumber": 98,
                            "oldTipHash": format!("0x{}", "22".repeat(32)),
                            "newTipNumber": 99,
                            "newTipHash": format!("0x{}", "33".repeat(32)),
                            "depth": 1,
                            "orphanedBlocksCount": 1,
                            "orphanedTxsCount": 3,
                            "eventType": "reorg",
                            "resolvedAt": null,
                            "resolvedBy": null,
                            "resolutionAction": null,
                            "resolutionNotes": null
                        },
                        "recentWindowSeconds": 86400,
                        "deepFork": {
                            "detected": false,
                            "detectedAt": null,
                            "dbTip": null,
                            "dbTipHash": null,
                            "chainTip": null,
                            "chainTipHash": null,
                            "depth": null,
                            "forkPoint": null
                        }
                    }))
                }),
            )
            .route(
                "/api/v1/activities/latest",
                get(|| async {
                    Json(serde_json::json!([
                        {
                            "txHash": format!("0x{}", "44".repeat(32)),
                            "blockNumber": 100,
                            "txIndex": 2,
                            "timestamp": "1700000000000",
                            "isCellbase": false,
                            "protocolActions": [{
                                "protocol": "dao",
                                "action": "deposit",
                                "metadata": {}
                            }],
                            "typeCalls": [],
                            "lockCalls": [],
                            "participants": [{
                                "address": "ckt1dao",
                                "ckbDelta": "-10000000000",
                                "usedDelta": "102",
                                "itemDeltas": [],
                                "tags": 1
                            }]
                        },
                        {
                            "txHash": format!("0x{}", "55".repeat(32)),
                            "blockNumber": 99,
                            "txIndex": 1,
                            "timestamp": "1699999999000",
                            "isCellbase": false,
                            "protocolActions": [],
                            "typeCalls": [],
                            "lockCalls": [],
                            "participants": [{
                                "address": "ckt1token",
                                "ckbDelta": "0",
                                "usedDelta": "0",
                                "itemDeltas": [{
                                    "kind": "token",
                                    "typeScriptHash": ASSET_TYPE_HASH,
                                    "delta": "42"
                                }],
                                "tags": 2
                            }]
                        },
                        {
                            "txHash": format!("0x{}", "66".repeat(32)),
                            "blockNumber": 98,
                            "txIndex": 1,
                            "timestamp": "1699999998000",
                            "isCellbase": false,
                            "protocolActions": [],
                            "typeCalls": [{
                                "typeCodeHash": format!("0x{}", "77".repeat(32)),
                                "typeHashType": "type",
                                "typeArgs": "0x",
                                "scriptHash": format!("0x{}", "88".repeat(32)),
                                "scriptName": ".bit Time Info"
                            }],
                            "lockCalls": [],
                            "participants": []
                        }
                    ]))
                }),
            )
            .route(
                "/api/v1/cells/:tx_hash/:output_index",
                get(|axum::extract::Path((tx_hash, output_index)): axum::extract::Path<(String, i32)>| async move {
                    if tx_hash == ASSET_TX_HASH {
                        return Json(serde_json::json!({
                            "txHash": ASSET_TX_HASH,
                            "outputIndex": output_index,
                            "dataSize": 16,
                            "data": format!("0x{}", "00".repeat(16)),
                            "lockScriptHash": "0xlockscript",
                            "typeScriptHash": ASSET_TYPE_HASH,
                            "address": "ckt1qyqasset",
                            "createdAtBlock": 93,
                            "lock": {
                                "codeHash": "0xlockcode",
                                "hashType": "type",
                                "args": "0x01"
                            },
                            "type": {
                                "codeHash": "0x4444444444444444444444444444444444444444444444444444444444444444",
                                "hashType": "type",
                                "args": "0x02"
                            },
                            "commonKnowledgeSizeBreakdown": {
                                "capacityFieldBytes": 8,
                                "lockScriptBytes": 54,
                                "typeScriptBytes": 34,
                                "dataBytes": 16,
                                "totalBytes": 112
                            },
                            "dataAnalysis": {
                                "deterministic": {
                                    "kind": "udt_amount",
                                    "summary": "xUDT amount",
                                    "segments": [{
                                        "label": "amount",
                                        "start": 0,
                                        "end": 16,
                                        "meaning": "xUDT amount in little-endian u128",
                                        "humanValue": "12345000000"
                                    }]
                                },
                                "heuristicGuesses": []
                            },
                            "isDepGroup": false
                        }));
                    }
                    Json(dao_cell_detail(output_index))
                }),
            )
            .route(
                "/api/v1/tokens/:type_hash",
                get(|axum::extract::Path(type_hash): axum::extract::Path<String>| async move {
                    Json(serde_json::json!({
                        "typeScriptHash": type_hash,
                        "standard": "xUDT",
                        "name": "Nervos Test Token",
                        "symbol": "NTT",
                        "decimals": 8
                    }))
                }),
            )
            .route(
                "/api/v1/scripts/lookup",
                post(|| async {
                    Json(serde_json::json!({
                        "0xlockcode": {
                            "name": "Default Lock",
                            "deprecated": false,
                            "scriptKind": "lock",
                            "decoderType": null,
                            "resolutionState": "resolved"
                        },
                        "0xdaocode": {
                            "name": "Nervos DAO",
                            "deprecated": false,
                            "scriptKind": "type",
                            "decoderType": "dao",
                            "resolutionState": "resolved"
                        }
                    }))
                }),
            )
            .route(
                "/api/v1/transactions/:tx_hash/detail",
                get(|| async {
                    Json(serde_json::json!({
                        "hash": TX_HASH,
                        "status": "committed",
                        "blockNumber": 92,
                        "blockHash": TX_BLOCK_HASH,
                        "inputsCount": 2,
                        "outputsCount": 2,
                        "fee": "1000",
                        "feeRate": "5000",
                        "txSize": 200,
                        "cycles": 12345,
                        "confirmations": 9,
                        "isCellbase": false,
                        "inputsCapacity": "30000000000",
                        "outputsCapacity": "29999999000",
                        "inputsCommonKnowledgeSize": "122",
                        "outputsCommonKnowledgeSize": "150",
                        "inputs": [
                            { "capacity": "10000000000", "address": "ckt1alice" },
                            { "capacity": "20000000000", "address": "ckt1bob" }
                        ],
                        "outputs": [
                            {
                                "capacity": "14999999000",
                                "commonKnowledgeSize": 70,
                                "address": "ckt1alice"
                            },
                            {
                                "capacity": "15000000000",
                                "commonKnowledgeSize": 80,
                                "address": "ckt1carol"
                            }
                        ]
                    }))
                }),
            )
            .route(
                "/api/v1/transactions/:tx_hash/lifecycle",
                get(|| async {
                    Json(serde_json::json!({
                        "hash": TX_HASH,
                        "phase": "committed",
                        "proposalId": "0x11111111111111111111",
                        "proposedIn": {
                            "blockNumber": 90,
                            "blockHash": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
                        },
                        "proposedInUncle": null,
                        "committedIn": {
                            "blockNumber": 92,
                            "blockHash": TX_BLOCK_HASH
                        },
                        "commitmentDistance": 2,
                        "commitmentWindow": { "close": 2, "far": 10 },
                        "isCellbase": false,
                        "confirmations": 9
                    }))
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (
            Url::parse(&format!("http://{address}/api/v1")).unwrap(),
            handle,
        )
    }

    async fn spawn_disabled_crawler_api() -> (Url, tokio::task::JoinHandle<()>, Arc<AtomicUsize>) {
        let crawler_requests = Arc::new(AtomicUsize::new(0));
        let counted_requests = crawler_requests.clone();
        let app = Router::new()
            .route(
                "/api/v1/statistics/network",
                get(|| async {
                    Json(serde_json::json!({
                        "syncStatus": {
                            "isSyncing": false,
                            "syncedBlock": 100
                        }
                    }))
                }),
            )
            .route(
                "/api/v1/blocks/:number",
                get(|| async {
                    Json(serde_json::json!({
                        "number": 100,
                        "hash": "0xblock100"
                    }))
                }),
            )
            .route(
                "/api/v1/network/summary",
                get(|| async {
                    Json(serde_json::json!({
                        "enabled": false,
                        "hasData": false,
                        "lastRound": null
                    }))
                }),
            )
            // Both crawler data routes, counted together. A disabled crawler
            // must cost neither: the summary gate is what stops the atlas
            // reaching for a census and the roster reaching for a page, and a
            // counter on only one of them would stop noticing if that gate
            // moved.
            .route(
                "/api/v1/network/peers",
                get({
                    let counted = counted_requests.clone();
                    move || {
                        let counted = counted.clone();
                        async move {
                            counted.fetch_add(1, Ordering::Relaxed);
                            Json(serde_json::json!({
                                "items": [],
                                "nextCursor": null
                            }))
                        }
                    }
                }),
            )
            .route(
                "/api/v1/network/distributions",
                get(move || {
                    let counted = counted_requests.clone();
                    async move {
                        counted.fetch_add(1, Ordering::Relaxed);
                        Json(serde_json::json!({
                            "verifiedRetained": 0,
                            "sameNetworkReachable": 0,
                            "verifiedUnavailable": 0,
                            "versions": [],
                            "countries": [],
                            "asns": [],
                            "protocols": []
                        }))
                    }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (
            Url::parse(&format!("http://{address}/api/v1")).unwrap(),
            handle,
            crawler_requests,
        )
    }

    async fn spawn_advancing_transaction_horizon_api() -> (Url, tokio::task::JoinHandle<()>) {
        let app = Router::new()
            .route(
                "/api/v1/statistics/network",
                get(|| async {
                    Json(serde_json::json!({
                        "syncStatus": {
                            "isSyncing": false,
                            "syncedBlock": 100
                        }
                    }))
                }),
            )
            .route(
                "/api/v1/statistics/tx-stats",
                get(|| async {
                    Json(serde_json::json!({
                        "currentHour": 1,
                        "currentDay": 1,
                        "hourlyData": [{ "label": "12:00", "value": 1 }],
                        "dailyData": [{ "label": "08/05", "value": 1 }]
                    }))
                }),
            )
            .route(
                "/api/v1/blocks/:number",
                get(
                    |axum::extract::Path(number): axum::extract::Path<i64>| async move {
                        Json(serde_json::json!({
                            "number": number,
                            "hash": if number == 100 { "0xblock100" } else { "0xblock101" }
                        }))
                    },
                ),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (
            Url::parse(&format!("http://{address}/api/v1")).unwrap(),
            handle,
        )
    }

    async fn spawn_reorganized_transaction_horizon_api() -> (Url, tokio::task::JoinHandle<()>) {
        let block_requests = Arc::new(AtomicUsize::new(0));
        let counted_requests = block_requests.clone();
        let app = Router::new()
            .route(
                "/api/v1/statistics/network",
                get(|| async {
                    Json(serde_json::json!({
                        "syncStatus": {
                            "isSyncing": false,
                            "syncedBlock": 100
                        }
                    }))
                }),
            )
            .route(
                "/api/v1/statistics/tx-stats",
                get(|| async {
                    Json(serde_json::json!({
                        "currentHour": 1,
                        "currentDay": 1,
                        "hourlyData": [{ "label": "12:00", "value": 1 }],
                        "dailyData": [{ "label": "08/05", "value": 1 }]
                    }))
                }),
            )
            .route(
                "/api/v1/activities/latest",
                get(|| async { Json(serde_json::json!([])) }),
            )
            .route(
                "/api/v1/blocks/:number",
                get(
                    move |axum::extract::Path(number): axum::extract::Path<i64>| {
                        let requests = counted_requests.clone();
                        async move {
                            if number != 100 {
                                return (
                                    StatusCode::NOT_FOUND,
                                    Json(serde_json::json!({
                                        "error": "block not found"
                                    })),
                                );
                            }
                            let hash = if requests.fetch_add(1, Ordering::Relaxed) == 0 {
                                "0xblock100"
                            } else {
                                "0xreplacement100"
                            };
                            (
                                StatusCode::OK,
                                Json(serde_json::json!({
                                    "number": number,
                                    "hash": hash
                                })),
                            )
                        }
                    },
                ),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (
            Url::parse(&format!("http://{address}/api/v1")).unwrap(),
            handle,
        )
    }

    fn context() -> CanonicalContext {
        CanonicalContext {
            tip: 101,
            epoch_number: 12_300,
            chain_name: "ckb".to_string(),
            recent_blocks: vec![RecentBlock {
                number: 100,
                hash: "0xblock100".to_string(),
            }],
            recent_transactions: Vec::new(),
            replay_active: false,
            observed_scripts: Vec::new(),
        }
    }

    fn active_deep_watch() -> RecentReorgResponse {
        RecentReorgResponse {
            has_recent_reorg: true,
            reorg: Some(ReorgEventResponse {
                id: 1_700_000_000_000,
                fork_point_number: 97,
                fork_point_hash: format!("0x{}", "11".repeat(32)),
                old_tip_number: 99,
                old_tip_hash: format!("0x{}", "22".repeat(32)),
                new_tip_number: 100,
                new_tip_hash: format!("0x{}", "33".repeat(32)),
                depth: 2,
                orphaned_blocks_count: 0,
                orphaned_txs_count: 0,
                event_type: "deep".to_string(),
            }),
            recent_window_seconds: 86_400,
            deep_fork: crate::dto::DeepForkStatusResponse {
                detected: true,
                db_tip: Some(99),
                db_tip_hash: Some(format!("0x{}", "22".repeat(32))),
                chain_tip: Some(100),
                chain_tip_hash: Some(format!("0x{}", "33".repeat(32))),
                depth: Some(2),
                fork_point: Some(97),
            },
        }
    }

    fn hardfork_timeline() -> HardforkTimelineResponse {
        HardforkTimelineResponse {
            network: "mainnet".to_string(),
            tip_epoch: 12_000,
            tip_block: 100,
            events: vec![
                HardforkEventResponse {
                    id: "mirana-2021".to_string(),
                    short_name: "Mirana".to_string(),
                    edition_year: 2021,
                    activation_epoch: 5_414,
                    activation_block: Some(70),
                    status: "activated".to_string(),
                },
                HardforkEventResponse {
                    id: "meepo-2024".to_string(),
                    short_name: "Meepo".to_string(),
                    edition_year: 2024,
                    activation_epoch: 12_293,
                    activation_block: None,
                    status: "upcoming".to_string(),
                },
            ],
        }
    }

    #[test]
    fn api_base_is_normalized_before_relative_joins() {
        let source =
            CkbadgerEnrichmentSource::new(Url::parse("http://127.0.0.1:8101/api/v1").unwrap())
                .unwrap();

        assert_eq!(
            source.endpoint("statistics/network").unwrap().as_str(),
            "http://127.0.0.1:8101/api/v1/statistics/network"
        );
    }

    #[test]
    fn stale_refresh_cannot_clear_a_newer_probe_anchor() {
        let source =
            CkbadgerEnrichmentSource::new(Url::parse("http://127.0.0.1:8101/api/v1").unwrap())
                .unwrap();
        let old = ChainAnchor {
            block: 100,
            hash: "0xblock100".to_string(),
        };
        let newer = ChainAnchor {
            block: 101,
            hash: "0xblock101".to_string(),
        };
        *source.validated_anchor.write().unwrap() = Some(newer.clone());

        source.clear_anchor_if(&old);
        assert_eq!(
            source.validated_anchor.read().unwrap().as_ref(),
            Some(&newer)
        );

        source.clear_anchor_if(&newer);
        assert!(source.validated_anchor.read().unwrap().is_none());
    }

    /// The census anchors on the chain's OWN hash format, so its fixtures use
    /// real 32-byte hashes rather than the short labels the other mock
    /// routes get away with.
    fn census_hash(block: u64) -> String {
        format!("0x{:064x}", block)
    }

    fn census_context(block: u64) -> CanonicalContext {
        CanonicalContext {
            tip: block,
            epoch_number: 12_300,
            chain_name: "ckb".to_string(),
            recent_blocks: vec![RecentBlock {
                number: block,
                hash: census_hash(block),
            }],
            recent_transactions: Vec::new(),
            replay_active: false,
            observed_scripts: Vec::new(),
        }
    }

    fn live_summary(block: u64, live: i64, classes: Option<(i64, i64, i64)>) -> serde_json::Value {
        let mut body = serde_json::json!({
            "tip": { "block": block, "hash": census_hash(block) },
            "liveCells": live,
            "dataBearing": 266_346,
        });
        if let Some((dao, typed_non_dao, plain)) = classes {
            body["classes"] = serde_json::json!({
                "dao": dao,
                "typedNonDao": typed_non_dao,
                "plain": plain,
            });
        }
        body
    }

    fn decode_live_summary(body: serde_json::Value) -> LiveCellSummaryResponse {
        serde_json::from_value(body).expect("decode live summary fixture")
    }

    async fn spawn_live_summary_api(
        status: StatusCode,
        body: serde_json::Value,
    ) -> (Url, tokio::task::JoinHandle<()>, Arc<AtomicUsize>) {
        let summary_requests = Arc::new(AtomicUsize::new(0));
        let counted = summary_requests.clone();
        let app = Router::new()
            .route(
                "/api/v1/statistics/network",
                get(|| async {
                    Json(serde_json::json!({
                        "syncStatus": { "isSyncing": false, "syncedBlock": 100 }
                    }))
                }),
            )
            .route(
                "/api/v1/blocks/:number",
                get(|| async {
                    Json(serde_json::json!({
                        "number": 100,
                        "hash": census_hash(100),
                    }))
                }),
            )
            .route(
                "/api/v1/cells/live-summary",
                get(move || {
                    let requests = counted.clone();
                    let body = body.clone();
                    async move {
                        requests.fetch_add(1, Ordering::Relaxed);
                        (status, Json(body))
                    }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let base = Url::parse(&format!("http://{address}/api/v1")).unwrap();
        (base, handle, summary_requests)
    }

    #[tokio::test]
    async fn a_census_is_anchored_at_the_block_its_counts_are_exact_at() {
        let (api_base, server, _) = spawn_live_summary_api(
            StatusCode::OK,
            live_summary(100, 1_471_222, Some((22_676, 475_891, 972_655))),
        )
        .await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();
        let context = census_context(100);
        source.probe(&context).await;

        let census = source
            .enrich_chain_census(&context)
            .await
            .expect("census")
            .expect("record");

        assert_eq!(census.as_of.block, 100);
        assert_eq!(census.as_of.hash, census_hash(100));
        assert_eq!(census.live_cells, 1_471_222);
        assert_eq!(
            census.classes.as_ref().and_then(ChainCensusClasses::total),
            Some(1_471_222)
        );
        assert_eq!(census.data_bearing, Some(266_346));
        assert_eq!(census.total_cells, None);
        assert_eq!(census.dead_cells, None);
        server.abort();
    }

    #[tokio::test]
    async fn an_initializing_census_yields_no_record_rather_than_a_zero() {
        for status in [
            StatusCode::SERVICE_UNAVAILABLE,
            StatusCode::INTERNAL_SERVER_ERROR,
            StatusCode::NOT_FOUND,
        ] {
            let (api_base, server, requests) =
                spawn_live_summary_api(status, serde_json::json!({ "error": "initializing" }))
                    .await;
            let source = CkbadgerEnrichmentSource::new(api_base).unwrap();
            let context = census_context(100);
            source.probe(&context).await;

            let census = source.enrich_chain_census(&context).await.expect("census");

            assert!(census.is_none(), "{status} must withhold, not synthesize");
            assert_eq!(requests.load(Ordering::Relaxed), 1);
            server.abort();
        }
    }

    #[test]
    fn a_census_tip_the_local_node_cannot_vouch_for_is_not_admitted() {
        let context = census_context(100);

        // Same height, different chain: the hash decides.
        let mut forked = live_summary(100, 1_471_222, None);
        forked["tip"]["hash"] = serde_json::json!(format!("0x{}", "ab".repeat(32)));
        assert!(map_chain_census(decode_live_summary(forked), &context)
            .expect("no error")
            .is_none());

        // Ahead of the retained canonical window: withheld until evidence
        // reaches it, never anchored at a block we have not seen.
        assert!(map_chain_census(
            decode_live_summary(live_summary(101, 1_471_222, None)),
            &context
        )
        .expect("no error")
        .is_none());
    }

    #[test]
    fn census_classes_that_do_not_partition_the_count_are_rejected() {
        let context = census_context(100);
        let body = live_summary(100, 1_471_222, Some((22_676, 475_891, 972_654)));

        let error = map_chain_census(decode_live_summary(body), &context)
            .expect_err("a mismatched partition must reject the record");

        assert!(error.to_string().contains("partition"), "{error}");
    }

    #[test]
    fn census_counters_outside_the_browser_safe_range_are_rejected() {
        let context = census_context(100);
        let mut negative = live_summary(100, 1_471_222, None);
        negative["liveCells"] = serde_json::json!(-1);
        assert!(map_chain_census(decode_live_summary(negative), &context).is_err());

        let mut unsafe_count = live_summary(100, 1_471_222, None);
        unsafe_count["liveCells"] = serde_json::json!(MAX_WIRE_SAFE_U64 as i64 + 1);
        assert!(map_chain_census(decode_live_summary(unsafe_count), &context).is_err());
    }

    #[test]
    fn a_census_without_classes_still_states_its_count() {
        let context = census_context(100);

        let census = map_chain_census(
            decode_live_summary(live_summary(100, 1_471_222, None)),
            &context,
        )
        .expect("no error")
        .expect("record");

        assert_eq!(census.live_cells, 1_471_222);
        assert!(census.classes.is_none());
    }

    #[test]
    fn unresolved_script_state_remains_visible_as_family() {
        let lookup = ScriptLookupInfo {
            name: "Unknown".to_string(),
            deprecated: false,
            script_kind: None,
            decoder_type: None,
            resolution_state: "ambiguous".to_string(),
        };

        assert_eq!(script_family(&lookup).as_deref(), Some("ambiguous"));
    }

    #[tokio::test]
    async fn probe_validates_hash_before_serving_rich_cell_context() {
        let (api_base, server) = spawn_mock_api("0xblock100").await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();

        let status = source.probe(&context()).await;
        assert_eq!(status.status, EnrichmentSourceState::Ready);
        assert_eq!(status.lag_blocks, Some(1));
        assert_eq!(status.validated_anchor.as_ref().unwrap().block, 100);
        assert!(status
            .capabilities
            .contains(&"transaction_detail".to_string()));
        assert!(status.capabilities.contains(&"asset_identity".to_string()));
        assert!(status.capabilities.contains(&"asset_ecosystem".to_string()));
        assert!(status.capabilities.contains(&"dao_state".to_string()));
        assert!(status.capabilities.contains(&"protocol_era".to_string()));
        assert!(status.capabilities.contains(&"activity_feed".to_string()));
        assert!(status
            .capabilities
            .contains(&"transaction_horizon".to_string()));
        assert!(status.capabilities.contains(&"fork_watch".to_string()));
        assert!(status.capabilities.contains(&"network_atlas".to_string()));
        assert!(!status
            .capabilities
            .contains(&"galaxy_composition".to_string()));

        let ecosystem = source
            .enrich_asset_ecosystem(&context())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(ecosystem.as_of.block, 100);
        assert_eq!(ecosystem.total_live_capacity_shannons, "100000000000000");
        assert_eq!(ecosystem.total_knowledge_bytes, 12_345);
        assert_eq!(ecosystem.capacity_breakdown[0].share_bps, 2_500);
        assert_eq!(ecosystem.top_assets[0].holders_count, 42);
        assert_eq!(
            ecosystem.top_assets[0].total_capacity_shannons,
            "123450000000"
        );

        let dao_state = source.enrich_dao_state(&context()).await.unwrap().unwrap();
        assert_eq!(dao_state.as_of.block, 100);
        assert_eq!(dao_state.statistics_block, 99);
        assert_eq!(dao_state.total_deposited_shannons, "837703738002110308");
        assert_eq!(dao_state.total_depositors, 16_740);
        assert_eq!(dao_state.active_deposits, 22_659);
        assert_eq!(dao_state.estimated_apc_bps, 201);
        assert_eq!(
            dao_state.deposit_change_24h_shannons.as_deref(),
            Some("141530599353229")
        );
        assert_eq!(dao_state.depositors_change_24h, Some(5));

        let protocol_era = source
            .enrich_protocol_era(&context())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(protocol_era.as_of.block, 100);
        assert_eq!(protocol_era.network, "mainnet");
        assert_eq!(protocol_era.indexed_tip_block, 100);
        assert_eq!(protocol_era.indexed_tip_epoch, 12_300);
        let current = protocol_era.current.unwrap();
        assert_eq!(current.name, "Meepo");
        assert_eq!(current.edition_year, 2024);
        assert_eq!(current.activation_epoch, 12_293);
        assert_eq!(current.activation_block, Some(99));
        assert!(protocol_era.upcoming.is_none());

        let fork_watch = source.enrich_fork_watch(&context()).await.unwrap().unwrap();
        assert_eq!(fork_watch.as_of.block, 100);
        assert_eq!(fork_watch.recent_window_seconds, 86_400);
        let reorg = fork_watch.recent_reorg.as_ref().unwrap();
        assert_eq!(reorg.fork_point, 97);
        assert_eq!(reorg.depth, 1);
        assert_eq!(reorg.orphaned_transactions, 3);
        assert_eq!(reorg.kind, ForkWatchEventKind::Reorg);
        assert!(fork_watch.deep_fork.is_none());

        let activity_feed = source
            .enrich_activity_feed(&context())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(activity_feed.as_of.block, 100);
        assert_eq!(activity_feed.activities.len(), 3);
        assert_eq!(activity_feed.activities[0].category, "dao");
        assert_eq!(
            activity_feed.activities[0].label.as_deref(),
            Some("dao · deposit")
        );
        assert_eq!(activity_feed.activities[1].category, "token");
        assert_eq!(activity_feed.activities[2].category, "script");
        assert_eq!(
            activity_feed.activities[2].label.as_deref(),
            Some(".bit Time Info")
        );

        let transaction_horizon = source
            .enrich_transaction_horizon(&context())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(transaction_horizon.as_of.block, 100);
        assert_eq!(transaction_horizon.current_hour, 12);
        assert_eq!(transaction_horizon.current_day, 345);
        assert_eq!(transaction_horizon.hourly_counts, vec![7, 9, 12]);
        assert_eq!(transaction_horizon.daily_counts, vec![300, 321, 345]);

        let network_atlas = source
            .enrich_network_atlas(&context())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(network_atlas.as_of.block, 100);
        assert_eq!(network_atlas.crawl_round, 7);
        assert_eq!(network_atlas.candidate_peers, 61);
        assert_eq!(network_atlas.last_round_reachable, 9);
        assert_eq!(network_atlas.foreign_peers, 1);
        assert_eq!(network_atlas.exhausted_candidates, 51);
        assert_eq!(network_atlas.verified_unavailable_peers, 33);
        assert_eq!(network_atlas.verified_retained_peers, 42);
        assert_eq!(network_atlas.new_verified_peers, 3);
        // The buckets come from the census route, not from the three-row page
        // above: they cover every peer the crawler holds, which is why the
        // strips no longer have to caption themselves as a sample.
        assert_eq!(network_atlas.indexed_peers, 42);
        assert_eq!(network_atlas.countries[0].label, "SG");
        assert_eq!(network_atlas.countries[0].count, 25);
        assert_eq!(network_atlas.versions[0].label, "0.119.0");

        let network_roster = source
            .enrich_network_roster(&context())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(network_roster.as_of.block, 100);
        assert_eq!(network_roster.crawl_round, 7);
        assert!(network_roster.truncated);
        // The crawler's hex ids arrive as the base58 the rest of the app
        // keys on, ordered by that id rather than by the page's recency.
        assert_eq!(
            network_roster
                .entries
                .iter()
                .map(|entry| entry.node_id.as_str())
                .collect::<Vec<_>>(),
            vec!["DgUrnn4", "DgUrnn5", "DgUrnn6", "DgUrnn7", "DgUrnn8"]
        );
        assert_eq!(network_roster.entries[0].addr, "/ip4/127.0.0.1/tcp/8115");
        assert_eq!(
            network_roster.entries[0].asn.as_deref(),
            Some("AS1 Example")
        );
        // Unix seconds upstream, milliseconds on the wire — and four clocks
        // that do not share one, on a row that carries all four.
        assert_eq!(network_roster.entries[0].last_reachable_ms, Some(30_000));
        assert_eq!(network_roster.entries[0].last_advertised_ms, Some(30_000));
        assert_eq!(network_roster.entries[0].last_observed_ms, Some(30_000));
        assert_eq!(
            network_roster.entries[0].latest_positive_observed_ms,
            30_000
        );
        assert_eq!(network_roster.entries[1].last_reachable_ms, Some(10_000));
        assert_eq!(network_roster.entries[1].last_advertised_ms, Some(20_000));
        assert_eq!(network_roster.entries[1].last_observed_ms, Some(12_000));
        assert_eq!(network_roster.entries[0].rtt_ms, Some(12));
        assert_eq!(network_roster.entries[1].rtt_ms, None);
        // Three requests, three rungs, one record — and the budget was spent
        // strongest first, so the three reached peers are all inside it.
        assert_eq!(
            network_roster
                .entries
                .iter()
                .map(|entry| entry.state)
                .collect::<Vec<_>>(),
            vec![
                RosterNodeState::Reachable,
                RosterNodeState::Reachable,
                RosterNodeState::Reachable,
                RosterNodeState::VerifiedUnavailable,
                RosterNodeState::AdvertisedUnverified,
            ]
        );
        // The crawler reached this one before and could not place it: that is
        // its word, and it crosses as a label rather than thinning to a gap.
        assert_eq!(
            network_roster.entries[3].country.as_deref(),
            Some("Unknown")
        );
        assert_eq!(network_roster.entries[3].last_reachable_ms, Some(6_000));
        // And the row nobody has ever dialed carries no answer at all for the
        // four things a dial would have told us — never the crawler's word for
        // a lookup that came back empty, which is a different sentence.
        let hearsay = &network_roster.entries[4];
        assert_eq!(hearsay.state, RosterNodeState::AdvertisedUnverified);
        assert_eq!(hearsay.version, None);
        assert_eq!(hearsay.country, None);
        assert_eq!(hearsay.asn, None);
        assert_eq!(hearsay.rtt_ms, None);
        assert_eq!(hearsay.last_reachable_ms, None);
        // What it does have is the two clocks that belong to a candidate: when
        // the network last named it, and when the crawler last tried it.
        assert_eq!(hearsay.last_advertised_ms, Some(30_000));
        assert_eq!(hearsay.last_observed_ms, Some(26_000));

        let record = source
            .enrich_cell(
                &OutPoint {
                    tx_hash: TX_HASH.to_string(),
                    index: 1,
                },
                &context(),
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            record.lock_script.as_ref().unwrap().name.as_deref(),
            Some("Default Lock")
        );
        assert_eq!(
            record.type_script.as_ref().unwrap().family.as_deref(),
            Some("dao")
        );
        assert_eq!(record.common_knowledge.as_ref().unwrap().total_bytes, 102);
        assert!(record.asset.is_none());
        assert!(record.facets.iter().any(|facet| facet.kind == "dao"));
        let content = record.content.as_ref().unwrap();
        assert_eq!(content.total_bytes, 7);
        assert_eq!(content.data_hex.as_deref(), Some("0x00000000000000"));
        assert!(content.data_complete);
        let decoded = content.deterministic.as_ref().unwrap();
        assert_eq!(decoded.kind, "dao_cell");
        assert_eq!(decoded.segments[0].start_byte, 0);
        assert_eq!(decoded.segments[0].end_byte, 7);
        assert_eq!(decoded.segments[0].meaning, "DAO deposit block marker");

        let asset_record = source
            .enrich_cell(
                &OutPoint {
                    tx_hash: ASSET_TX_HASH.to_string(),
                    index: 0,
                },
                &context(),
            )
            .await
            .unwrap()
            .unwrap();
        let asset = asset_record.asset.as_ref().unwrap();
        assert_eq!(asset.type_script_hash, ASSET_TYPE_HASH);
        assert_eq!(asset.standard.as_deref(), Some("xUDT"));
        assert_eq!(asset.name.as_deref(), Some("Nervos Test Token"));
        assert_eq!(asset.symbol.as_deref(), Some("NTT"));
        assert_eq!(asset.amount.as_deref(), Some("12345000000"));
        assert_eq!(asset.decimals, Some(8));
        assert_eq!(
            asset_record
                .content
                .as_ref()
                .and_then(|content| content.deterministic.as_ref())
                .map(|decoded| decoded.kind.as_str()),
            Some("udt_amount")
        );

        let transaction = source
            .enrich_transaction(TX_HASH, &context())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(transaction.block, 92);
        assert_eq!(transaction.fee.as_deref(), Some("1000"));
        assert_eq!(transaction.cycles, Some(12345));
        assert!(transaction
            .actions
            .iter()
            .any(|facet| facet.kind == "transaction_lifecycle"));
        assert_eq!(
            transaction
                .participants
                .iter()
                .find(|participant| participant.address == "ckt1alice")
                .and_then(|participant| participant.capacity_delta.as_deref()),
            Some("4999999000")
        );
        assert_eq!(
            transaction
                .participants
                .iter()
                .find(|participant| participant.address == "ckt1bob")
                .and_then(|participant| participant.capacity_delta.as_deref()),
            Some("-20000000000")
        );

        server.abort();
    }

    /// The DAO deposit Cell every mock serves for `TX_HASH`. Shared so the
    /// object stub can prove a Cell that is no kind of object asks the object
    /// indexes nothing while still being the same Cell the older tests read.
    fn dao_cell_detail(output_index: i32) -> serde_json::Value {
        serde_json::json!({
            "txHash": TX_HASH,
            "outputIndex": output_index,
            "dataSize": 7,
            "data": format!("0x{}", "00".repeat(7)),
            "lockScriptHash": "0xlockscript",
            "typeScriptHash": "0xtypescript",
            "address": "ckt1qyqexample",
            "cellType": "dao",
            "createdAtBlock": 92,
            "lock": {
                "codeHash": "0xlockcode",
                "hashType": "type",
                "args": "0x01"
            },
            "type": {
                "codeHash": "0xdaocode",
                "hashType": "type",
                "args": "0x"
            },
            "commonKnowledgeSizeBreakdown": {
                "capacityFieldBytes": 8,
                "lockScriptBytes": 54,
                "typeScriptBytes": 33,
                "dataBytes": 7,
                "totalBytes": 102
            },
            "dataAnalysis": {
                "deterministic": {
                    "kind": "dao_cell",
                    "summary": "DAO deposit",
                    "segments": [{
                        "label": "deposit_block",
                        "start": 0,
                        "end": 7,
                        "meaning": "DAO deposit block marker",
                        "humanValue": "92"
                    }]
                },
                "heuristicGuesses": []
            },
            "isDepGroup": false,
            "daoInfo": {
                "daoStatus": "deposit",
                "depositBlockNumber": 92
            }
        })
    }

    const SPORE_TX_HASH: &str =
        "0x5555555555555555555555555555555555555555555555555555555555555555";
    const SOLE_SPORE_TX_HASH: &str =
        "0x6666666666666666666666666666666666666666666666666666666666666666";
    /// A spore whose decode carries no `cluster_id` segment at all — the shape
    /// that must read as unknown rather than as sole.
    const MUTE_SPORE_TX_HASH: &str =
        "0x7777777777777777777777777777777777777777777777777777777777777777";
    const CLUSTER_TX_HASH: &str =
        "0x8888888888888888888888888888888888888888888888888888888888888888";
    /// An object's spore id is its type-script args, which is why the object
    /// lookup needs nothing the Cell detail did not already carry.
    const SPORE_ID: &str = "0x9999999999999999999999999999999999999999999999999999999999999999";
    const SOLE_SPORE_ID: &str =
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const MUTE_SPORE_ID: &str =
        "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    const CLUSTER_ID: &str = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const SPORE_CODE_HASH: &str =
        "0x1010101010101010101010101010101010101010101010101010101010101010";
    const SPORE_CLUSTER_CODE_HASH: &str =
        "0x2020202020202020202020202020202020202020202020202020202020202020";
    const SPORE_TYPE_HASH: &str =
        "0x3030303030303030303030303030303030303030303030303030303030303030";
    const SPORE_CLUSTER_TYPE_HASH: &str =
        "0x4040404040404040404040404040404040404040404040404040404040404040";

    const MNFT_TOKEN_TX_HASH: &str =
        "0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
    const MNFT_CLASS_TX_HASH: &str =
        "0xa2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2";
    /// A token cell whose args cannot hold the 24 bytes that name a class —
    /// the shape that must read as unknown and cost no request.
    const MNFT_STUNTED_TX_HASH: &str =
        "0xa3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3";
    /// A live mainnet collection: 20 bytes of issuer, 4 of class. Every M-NFT
    /// Cell below is keyed by it, because that is how M-NFT keys itself.
    const MNFT_COLLECTION_ID: &str = "0x8f67efedd50c61c9dd332defd4051f08a02d797700000014";
    /// The class id followed by one token's own 4-byte serial: 28 bytes, of
    /// which only the first 24 name anything a collection can be looked up by.
    const MNFT_TOKEN_ARGS: &str = "0x8f67efedd50c61c9dd332defd4051f08a02d79770000001400000971";
    const MNFT_TOKEN_CODE_HASH: &str =
        "0x5050505050505050505050505050505050505050505050505050505050505050";
    const MNFT_CLASS_CODE_HASH: &str =
        "0x6060606060606060606060606060606060606060606060606060606060606060";
    const MNFT_TOKEN_TYPE_HASH: &str =
        "0x7070707070707070707070707070707070707070707070707070707070707070";
    const MNFT_CLASS_TYPE_HASH: &str =
        "0x8080808080808080808080808080808080808080808080808080808080808080";
    /// The one prose sentence an M-NFT class states about itself, and the only
    /// thing this side reads out of `classDetail`.
    const MNFT_CLASS_DESCRIPTION: &str = "A collection of hand-drawn Santas, minted for Christmas.";

    /// A collection description longer than one Cell record carries, arranged
    /// so an em dash occupies the bytes on either side of the bound: a
    /// byte-wise cut at 160 would land inside that character, which is the
    /// whole reason the bound counts characters.
    fn long_cluster_description() -> String {
        let prose = "Nervape Gen2, a generation of on-chain characters. Minted 2024. ".repeat(4);
        let head: String = prose.chars().take(158).collect();
        format!("{head}—and a tail no per-Cell record needs to carry")
    }

    /// A spore object Cell as ckbadger's Cell detail describes one. The
    /// cluster id reaches this side through the decode, never through the
    /// bounded data prefix: SporeData puts it after the content bytes.
    fn spore_cell_detail(
        tx_hash: &str,
        spore_id: &str,
        segments: serde_json::Value,
    ) -> serde_json::Value {
        serde_json::json!({
            "txHash": tx_hash,
            "outputIndex": 0,
            "dataSize": 96,
            "data": format!("0x{}", "00".repeat(96)),
            "lockScriptHash": "0xlockscript",
            "typeScriptHash": SPORE_TYPE_HASH,
            "address": "ckt1qyqspore",
            "createdAtBlock": 94,
            "lock": {
                "codeHash": "0xlockcode",
                "hashType": "type",
                "args": "0x01"
            },
            "type": {
                "codeHash": SPORE_CODE_HASH,
                "hashType": "data1",
                "args": spore_id
            },
            "commonKnowledgeSizeBreakdown": {
                "capacityFieldBytes": 8,
                "lockScriptBytes": 54,
                "typeScriptBytes": 65,
                "dataBytes": 96,
                "totalBytes": 223
            },
            "dataAnalysis": {
                "deterministic": {
                    "kind": "spore_cell",
                    "summary": "Spore digital object",
                    "segments": segments
                },
                "heuristicGuesses": []
            },
            "isDepGroup": false
        })
    }

    fn cluster_id_segment(human_value: &str) -> serde_json::Value {
        serde_json::json!({
            "label": "cluster_id",
            "start": 64,
            "end": 96,
            "meaning": "SporeData cluster id",
            "humanValue": human_value
        })
    }

    fn content_type_segment() -> serde_json::Value {
        serde_json::json!({
            "label": "content_type",
            "start": 0,
            "end": 9,
            "meaning": "SporeData content type",
            "humanValue": "image/png"
        })
    }

    fn clustered_spore_cell() -> serde_json::Value {
        spore_cell_detail(
            SPORE_TX_HASH,
            SPORE_ID,
            serde_json::json!([content_type_segment(), cluster_id_segment(CLUSTER_ID)]),
        )
    }

    fn sole_spore_cell() -> serde_json::Value {
        spore_cell_detail(
            SOLE_SPORE_TX_HASH,
            SOLE_SPORE_ID,
            serde_json::json!([content_type_segment(), cluster_id_segment(SPORE_NO_CLUSTER)]),
        )
    }

    fn mute_spore_cell() -> serde_json::Value {
        spore_cell_detail(
            MUTE_SPORE_TX_HASH,
            MUTE_SPORE_ID,
            serde_json::json!([content_type_segment()]),
        )
    }

    /// A cluster Cell names itself by its own type-script args, so it needs no
    /// segment read at all. Its data is a small on-chain document.
    fn spore_cluster_cell() -> serde_json::Value {
        serde_json::json!({
            "txHash": CLUSTER_TX_HASH,
            "outputIndex": 0,
            "dataSize": 40,
            "data": format!("0x{}", "00".repeat(40)),
            "lockScriptHash": "0xlockscript",
            "typeScriptHash": SPORE_CLUSTER_TYPE_HASH,
            "address": "ckt1qyqcluster",
            "createdAtBlock": 90,
            "lock": {
                "codeHash": "0xlockcode",
                "hashType": "type",
                "args": "0x01"
            },
            "type": {
                "codeHash": SPORE_CLUSTER_CODE_HASH,
                "hashType": "data1",
                "args": CLUSTER_ID
            },
            "commonKnowledgeSizeBreakdown": {
                "capacityFieldBytes": 8,
                "lockScriptBytes": 54,
                "typeScriptBytes": 65,
                "dataBytes": 40,
                "totalBytes": 167
            },
            "dataAnalysis": {
                "deterministic": {
                    "kind": "spore_cluster_cell",
                    "summary": "Spore cluster",
                    "segments": [{
                        "label": "name",
                        "start": 0,
                        "end": 12,
                        "meaning": "ClusterData name",
                        "humanValue": "Nervape Gen2"
                    }]
                },
                "heuristicGuesses": []
            },
            "isDepGroup": false
        })
    }

    /// An M-NFT Cell as ckbadger's Cell detail describes one. The segments are
    /// the token's own fields and name no class at all — which is the whole
    /// reason the collection id has to be read off the type script.
    fn mnft_cell_detail(
        tx_hash: &str,
        kind: &str,
        code_hash: &str,
        type_script_hash: &str,
        args: &str,
        segments: serde_json::Value,
    ) -> serde_json::Value {
        serde_json::json!({
            "txHash": tx_hash,
            "outputIndex": 0,
            "dataSize": 11,
            "data": format!("0x{}", "00".repeat(11)),
            "lockScriptHash": "0xlockscript",
            "typeScriptHash": type_script_hash,
            "address": "ckt1qyqmnft",
            "createdAtBlock": 93,
            "lock": {
                "codeHash": "0xlockcode",
                "hashType": "type",
                "args": "0x01"
            },
            "type": {
                "codeHash": code_hash,
                "hashType": "type",
                "args": args
            },
            "commonKnowledgeSizeBreakdown": {
                "capacityFieldBytes": 8,
                "lockScriptBytes": 54,
                "typeScriptBytes": 61,
                "dataBytes": 11,
                "totalBytes": 134
            },
            "dataAnalysis": {
                "deterministic": {
                    "kind": kind,
                    "summary": "m-NFT",
                    "segments": segments
                },
                "heuristicGuesses": []
            },
            "isDepGroup": false
        })
    }

    fn mnft_token_cell() -> serde_json::Value {
        mnft_cell_detail(
            MNFT_TOKEN_TX_HASH,
            "mnft_token_cell",
            MNFT_TOKEN_CODE_HASH,
            MNFT_TOKEN_TYPE_HASH,
            MNFT_TOKEN_ARGS,
            serde_json::json!([{
                "label": "characteristic",
                "start": 1,
                "end": 9,
                "meaning": "TokenData characteristic",
                "humanValue": "0x0000000000000000"
            }]),
        )
    }

    /// A class cell's args are the 24 bytes and nothing after them, so the
    /// class is named by exactly what a token's args begin with.
    fn mnft_class_cell() -> serde_json::Value {
        mnft_cell_detail(
            MNFT_CLASS_TX_HASH,
            "mnft_class_cell",
            MNFT_CLASS_CODE_HASH,
            MNFT_CLASS_TYPE_HASH,
            MNFT_COLLECTION_ID,
            serde_json::json!([{
                "label": "total",
                "start": 1,
                "end": 5,
                "meaning": "ClassData total supply",
                "humanValue": "2408"
            }]),
        )
    }

    /// Sixteen bytes of args: too few to name a class, and no amount of
    /// asking upstream would change that.
    fn mnft_stunted_token_cell() -> serde_json::Value {
        mnft_cell_detail(
            MNFT_STUNTED_TX_HASH,
            "mnft_token_cell",
            MNFT_TOKEN_CODE_HASH,
            MNFT_TOKEN_TYPE_HASH,
            "0x8f67efedd50c61c9dd332defd4051f08",
            serde_json::json!([]),
        )
    }

    /// The M-NFT class and its population's composition, riding one response
    /// off ckbadger's asset index. The counts are a live mainnet collection's;
    /// `standard`, `totalCount`, `ownedKnowledge`, `issuerDetail`, the
    /// renderer and `onchainRatio` are here precisely because nothing reads
    /// them: an unread field must pass through the deserializer, not break it.
    fn nft_collection_detail() -> serde_json::Value {
        serde_json::json!({
            "collectionId": MNFT_COLLECTION_ID,
            "standard": "m_nft",
            "name": "Non-Fungible Santa Claus",
            "totalCount": 2408,
            "liveCount": 2408,
            "holdersCount": 1392,
            "ownedCapacity": "32285294386739",
            "ownedKnowledge": "349160",
            "composition": {
                "tier": "centralized_mixture",
                "onchainCount": 0,
                "pureCkbCount": 0,
                "decentralizedMixtureCount": 0,
                "centralizedMixtureCount": 2408,
                "unknownCount": 0,
                "onchainRatio": 0.0
            },
            "classDetail": {
                "classId": MNFT_COLLECTION_ID,
                "issuerId": "0x8f67efedd50c61c9dd332defd4051f08a02d7977",
                "name": "Non-Fungible Santa Claus",
                "description": MNFT_CLASS_DESCRIPTION,
                "renderer": "https://example.invalid/nfsc/token.png"
            },
            "issuerDetail": {
                "issuerId": "0x8f67efedd50c61c9dd332defd4051f08a02d7977",
                "name": "Non-Fungible Santa Claus"
            }
        })
    }

    /// The collection's own facts and its population's composition, riding one
    /// response, spelled as ckbadger spells them. `sources` and `onchainRatio`
    /// are here precisely because nothing reads them: an unread field must
    /// pass through the deserializer, not break it.
    fn cluster_detail() -> serde_json::Value {
        serde_json::json!({
            "clusterId": CLUSTER_ID,
            "name": "Nervape Gen2",
            "description": long_cluster_description(),
            "sporesCount": 1024,
            "holdersCount": 210,
            "ownedCapacity": "109067222027837",
            "composition": {
                "tier": "centralized_mixture",
                "onchainCount": 1010,
                "pureCkbCount": 980,
                "decentralizedMixtureCount": 12,
                "centralizedMixtureCount": 2,
                "unknownCount": 0,
                "onchainRatio": 0.986
            }
        })
    }

    /// Which routes of ckbadger's two object indexes answer during one test. A
    /// degraded route answers 500 rather than vanishing, because the
    /// discipline under test is that a failing call costs only its own
    /// attributes.
    #[derive(Clone, Copy)]
    struct ObjectIndexHealth {
        objects: StatusCode,
        clusters: StatusCode,
        assets: StatusCode,
    }

    impl ObjectIndexHealth {
        const HEALTHY: Self = Self {
            objects: StatusCode::OK,
            clusters: StatusCode::OK,
            assets: StatusCode::OK,
        };
        const OBJECTS_DOWN: Self = Self {
            objects: StatusCode::INTERNAL_SERVER_ERROR,
            clusters: StatusCode::OK,
            assets: StatusCode::OK,
        };
        const CLUSTERS_DOWN: Self = Self {
            objects: StatusCode::OK,
            clusters: StatusCode::INTERNAL_SERVER_ERROR,
            assets: StatusCode::OK,
        };
        const ASSETS_DOWN: Self = Self {
            objects: StatusCode::OK,
            clusters: StatusCode::OK,
            assets: StatusCode::INTERNAL_SERVER_ERROR,
        };
    }

    /// What the adapter asked the object indexes, per route. Round trips are
    /// the point of the parallel design, so the tests count them rather than
    /// trusting them — and counting all three at once is what proves each
    /// family asks only its own index.
    #[derive(Clone)]
    struct ObjectCalls {
        objects: Arc<AtomicUsize>,
        clusters: Arc<AtomicUsize>,
        assets: Arc<AtomicUsize>,
    }

    impl ObjectCalls {
        fn counts(&self) -> (usize, usize, usize) {
            (
                self.objects.load(Ordering::Relaxed),
                self.clusters.load(Ordering::Relaxed),
                self.assets.load(Ordering::Relaxed),
            )
        }
    }

    async fn spawn_object_api(
        health: ObjectIndexHealth,
    ) -> (Url, tokio::task::JoinHandle<()>, ObjectCalls) {
        let calls = ObjectCalls {
            objects: Arc::new(AtomicUsize::new(0)),
            clusters: Arc::new(AtomicUsize::new(0)),
            assets: Arc::new(AtomicUsize::new(0)),
        };
        let counted_objects = calls.objects.clone();
        let counted_clusters = calls.clusters.clone();
        let counted_assets = calls.assets.clone();
        let app = Router::new()
            .route(
                "/api/v1/statistics/network",
                get(|| async {
                    Json(serde_json::json!({
                        "syncStatus": { "isSyncing": false, "syncedBlock": 100 }
                    }))
                }),
            )
            .route(
                "/api/v1/blocks/:number",
                get(|| async { Json(serde_json::json!({ "number": 100, "hash": "0xblock100" })) }),
            )
            .route(
                "/api/v1/scripts/lookup",
                post(|| async {
                    Json(serde_json::json!({
                        "0xlockcode": {
                            "name": "Default Lock",
                            "deprecated": false,
                            "scriptKind": "lock",
                            "decoderType": null,
                            "resolutionState": "resolved"
                        },
                        (SPORE_CODE_HASH): {
                            "name": "Spore",
                            "deprecated": false,
                            "scriptKind": "type",
                            "decoderType": "spore",
                            "resolutionState": "resolved"
                        },
                        (SPORE_CLUSTER_CODE_HASH): {
                            "name": "Spore Cluster",
                            "deprecated": false,
                            "scriptKind": "type",
                            "decoderType": "spore_cluster",
                            "resolutionState": "resolved"
                        },
                        (MNFT_TOKEN_CODE_HASH): {
                            "name": "m-NFT",
                            "deprecated": false,
                            "scriptKind": "type",
                            "decoderType": "mnft_token",
                            "resolutionState": "resolved"
                        },
                        (MNFT_CLASS_CODE_HASH): {
                            "name": "m-NFT Class",
                            "deprecated": false,
                            "scriptKind": "type",
                            "decoderType": "mnft_class",
                            "resolutionState": "resolved"
                        }
                    }))
                }),
            )
            .route(
                "/api/v1/cells/:tx_hash/:output_index",
                get(
                    |axum::extract::Path((tx_hash, output_index)): axum::extract::Path<(
                        String,
                        i32,
                    )>| async move {
                        Json(match tx_hash.as_str() {
                            SPORE_TX_HASH => clustered_spore_cell(),
                            SOLE_SPORE_TX_HASH => sole_spore_cell(),
                            MUTE_SPORE_TX_HASH => mute_spore_cell(),
                            CLUSTER_TX_HASH => spore_cluster_cell(),
                            MNFT_TOKEN_TX_HASH => mnft_token_cell(),
                            MNFT_CLASS_TX_HASH => mnft_class_cell(),
                            MNFT_STUNTED_TX_HASH => mnft_stunted_token_cell(),
                            _ => dao_cell_detail(output_index),
                        })
                    },
                ),
            )
            .route(
                "/api/v1/spore/objects/:spore_id",
                get(
                    move |axum::extract::Path(spore_id): axum::extract::Path<String>| {
                        let calls = counted_objects.clone();
                        async move {
                            calls.fetch_add(1, Ordering::Relaxed);
                            if health.objects != StatusCode::OK {
                                return (
                                    health.objects,
                                    Json(serde_json::json!({ "error": "object index down" })),
                                );
                            }
                            let media = match spore_id.as_str() {
                                SPORE_ID => serde_json::json!({
                                    "tier": "pure_ckb",
                                    "sources": [{ "scheme": "ckbfs" }],
                                    "issues": ["dangling media", "decode failed"]
                                }),
                                SOLE_SPORE_ID => serde_json::json!({
                                    "tier": "btc_ckb",
                                    "sources": [{ "scheme": "btcfs" }],
                                    "issues": []
                                }),
                                _ => serde_json::json!({
                                    "tier": "decentralized_mixture",
                                    "sources": [{ "scheme": "ipfs" }],
                                    "issues": []
                                }),
                            };
                            (
                                StatusCode::OK,
                                Json(serde_json::json!({
                                    "clusterId": CLUSTER_ID,
                                    "mediaProfile": media
                                })),
                            )
                        }
                    },
                ),
            )
            .route(
                "/api/v1/spore/clusters/:cluster_id",
                get(
                    move |axum::extract::Path(cluster_id): axum::extract::Path<String>| {
                        let calls = counted_clusters.clone();
                        async move {
                            calls.fetch_add(1, Ordering::Relaxed);
                            if health.clusters != StatusCode::OK {
                                return (
                                    health.clusters,
                                    Json(serde_json::json!({ "error": "cluster index down" })),
                                );
                            }
                            if cluster_id != CLUSTER_ID {
                                return (
                                    StatusCode::NOT_FOUND,
                                    Json(serde_json::json!({ "error": "cluster not found" })),
                                );
                            }
                            (StatusCode::OK, Json(cluster_detail()))
                        }
                    },
                ),
            )
            .route(
                "/api/v1/assets/objects/:collection_id",
                get(
                    move |axum::extract::Path(collection_id): axum::extract::Path<String>| {
                        let calls = counted_assets.clone();
                        async move {
                            calls.fetch_add(1, Ordering::Relaxed);
                            if health.assets != StatusCode::OK {
                                return (
                                    health.assets,
                                    Json(serde_json::json!({ "error": "asset index down" })),
                                );
                            }
                            if collection_id != MNFT_COLLECTION_ID {
                                return (
                                    StatusCode::NOT_FOUND,
                                    Json(serde_json::json!({ "error": "collection not found" })),
                                );
                            }
                            (StatusCode::OK, Json(nft_collection_detail()))
                        }
                    },
                ),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (
            Url::parse(&format!("http://{address}/api/v1")).unwrap(),
            handle,
            calls,
        )
    }

    async fn enrich_object_cell(
        source: &CkbadgerEnrichmentSource,
        tx_hash: &str,
    ) -> CellSemanticRecord {
        source.probe(&context()).await;
        source
            .enrich_cell(
                &OutPoint {
                    tx_hash: tx_hash.to_string(),
                    index: 0,
                },
                &context(),
            )
            .await
            .expect("enrichment must never fail on a degraded object index")
            .expect("the Cell exists")
    }

    fn object_facet<'a>(
        record: &'a CellSemanticRecord,
        namespace: &str,
        kind: &str,
    ) -> &'a SemanticFacet {
        record
            .facets
            .iter()
            .find(|candidate| candidate.namespace == namespace && candidate.kind == kind)
            .unwrap_or_else(|| panic!("record carries no {namespace} {kind} facet"))
    }

    fn facet_value<'a>(facet: &'a SemanticFacet, key: &str) -> Option<&'a str> {
        facet
            .attributes
            .iter()
            .find(|candidate| candidate.key == key)
            .map(|candidate| candidate.value.as_str())
    }

    fn facet_keys(facet: &SemanticFacet) -> Vec<&str> {
        facet
            .attributes
            .iter()
            .map(|candidate| candidate.key.as_str())
            .collect()
    }

    #[tokio::test]
    async fn a_clustered_spore_learns_its_kin_and_where_its_content_lives() {
        let (api_base, server, calls) = spawn_object_api(ObjectIndexHealth::HEALTHY).await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();

        let record = enrich_object_cell(&source, SPORE_TX_HASH).await;

        let collection = object_facet(&record, "spore", "collection");
        assert_eq!(collection.state.as_deref(), Some("Nervape Gen2"));
        assert_eq!(facet_value(collection, "role"), Some("item"));
        assert_eq!(facet_value(collection, "collection_id"), Some(CLUSTER_ID));
        assert_eq!(facet_value(collection, "live_items"), Some("1024"));
        assert_eq!(facet_value(collection, "holders"), Some("210"));
        assert_eq!(
            facet_value(collection, "owned_capacity"),
            Some("109067222027837")
        );

        let description = facet_value(collection, "description").expect("description");
        assert_eq!(
            description.chars().count(),
            MAX_COLLECTION_DESCRIPTION_CHARS
        );
        assert_eq!(
            description,
            long_cluster_description()
                .chars()
                .take(MAX_COLLECTION_DESCRIPTION_CHARS)
                .collect::<String>()
        );
        // The bound counts characters because it must: a byte-wise cut at the
        // same number would land inside this description's em dash.
        assert!(!long_cluster_description().is_char_boundary(MAX_COLLECTION_DESCRIPTION_CHARS));

        let composition = object_facet(&record, "spore", "composition");
        // The headline a reader of one object wants is that object's own tier,
        // not the collection's worst-dominant verdict.
        assert_eq!(composition.state.as_deref(), Some("pure_ckb"));
        assert_eq!(facet_value(composition, "item_tier"), Some("pure_ckb"));
        assert_eq!(facet_value(composition, "item_issues"), Some("2"));
        assert_eq!(
            facet_value(composition, "agg_tier"),
            Some("centralized_mixture")
        );
        assert_eq!(facet_value(composition, "agg_onchain"), Some("1010"));
        assert_eq!(facet_value(composition, "agg_pure_ckb"), Some("980"));
        assert_eq!(facet_value(composition, "agg_decentralized"), Some("12"));
        assert_eq!(facet_value(composition, "agg_centralized"), Some("2"));
        assert_eq!(facet_value(composition, "agg_unknown"), Some("0"));

        // Two lookups, side by side, because the decode already named the
        // cluster — and none of them to the asset index, which knows nothing
        // about spores.
        assert_eq!(calls.counts(), (1, 1, 0));
        server.abort();
    }

    #[tokio::test]
    async fn a_sole_spore_states_its_solitude_and_asks_no_collection() {
        let (api_base, server, calls) = spawn_object_api(ObjectIndexHealth::HEALTHY).await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();

        let record = enrich_object_cell(&source, SOLE_SPORE_TX_HASH).await;

        let collection = object_facet(&record, "spore", "collection");
        assert_eq!(collection.state, None);
        assert_eq!(facet_keys(collection), vec!["role"]);
        assert_eq!(facet_value(collection, "role"), Some("sole_item"));

        let composition = object_facet(&record, "spore", "composition");
        assert_eq!(composition.state.as_deref(), Some("btc_ckb"));
        // No issues is the ordinary case, and states nothing worth a row.
        assert_eq!(facet_keys(composition), vec!["item_tier"]);
        assert_eq!(facet_value(composition, "item_tier"), Some("btc_ckb"));

        assert_eq!(calls.counts(), (1, 0, 0));
        server.abort();
    }

    #[tokio::test]
    async fn a_collection_lookup_that_fails_costs_only_its_own_attributes() {
        let (api_base, server, calls) = spawn_object_api(ObjectIndexHealth::CLUSTERS_DOWN).await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();

        let record = enrich_object_cell(&source, SPORE_TX_HASH).await;

        // Whose kin it is survives the outage: that answer came from the Cell.
        let collection = object_facet(&record, "spore", "collection");
        assert_eq!(collection.state, None);
        assert_eq!(facet_keys(collection), vec!["role", "collection_id"]);
        assert_eq!(facet_value(collection, "collection_id"), Some(CLUSTER_ID));

        let composition = object_facet(&record, "spore", "composition");
        assert_eq!(composition.state.as_deref(), Some("pure_ckb"));
        assert_eq!(facet_keys(composition), vec!["item_tier", "item_issues"]);

        assert_eq!(calls.counts(), (1, 1, 0));
        server.abort();
    }

    #[tokio::test]
    async fn an_object_lookup_that_fails_leaves_the_collection_whole() {
        let (api_base, server, calls) = spawn_object_api(ObjectIndexHealth::OBJECTS_DOWN).await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();

        let record = enrich_object_cell(&source, SPORE_TX_HASH).await;

        let collection = object_facet(&record, "spore", "collection");
        assert_eq!(collection.state.as_deref(), Some("Nervape Gen2"));
        assert_eq!(
            facet_keys(collection),
            vec![
                "role",
                "collection_id",
                "live_items",
                "holders",
                "owned_capacity",
                "description"
            ]
        );

        // With no measurement of its own, the object borrows the population's
        // headline rather than showing none.
        let composition = object_facet(&record, "spore", "composition");
        assert_eq!(composition.state.as_deref(), Some("centralized_mixture"));
        assert_eq!(
            facet_keys(composition),
            vec![
                "agg_tier",
                "agg_onchain",
                "agg_pure_ckb",
                "agg_decentralized",
                "agg_centralized",
                "agg_unknown"
            ]
        );

        assert_eq!(calls.counts(), (1, 1, 0));
        server.abort();
    }

    #[tokio::test]
    async fn a_spore_whose_decode_names_no_cluster_is_unknown_rather_than_sole() {
        let (api_base, server, calls) = spawn_object_api(ObjectIndexHealth::HEALTHY).await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();

        let record = enrich_object_cell(&source, MUTE_SPORE_TX_HASH).await;

        // Silence is not solitude: with nothing said about kinship, nothing is
        // claimed about it.
        assert!(record.facets.iter().all(|facet| facet.kind != "collection"));

        // The storage question is independent, so it is still asked.
        let composition = object_facet(&record, "spore", "composition");
        assert_eq!(composition.state.as_deref(), Some("decentralized_mixture"));
        assert_eq!(
            facet_value(composition, "item_tier"),
            Some("decentralized_mixture")
        );

        assert_eq!(calls.counts(), (1, 0, 0));
        server.abort();
    }

    #[tokio::test]
    async fn a_cluster_cell_reads_the_population_it_names() {
        let (api_base, server, calls) = spawn_object_api(ObjectIndexHealth::HEALTHY).await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();

        let record = enrich_object_cell(&source, CLUSTER_TX_HASH).await;

        let collection = object_facet(&record, "spore", "collection");
        assert_eq!(collection.state.as_deref(), Some("Nervape Gen2"));
        assert_eq!(facet_value(collection, "role"), Some("cluster"));
        // A cluster is keyed by its own type-script args, not by a segment.
        assert_eq!(facet_value(collection, "collection_id"), Some(CLUSTER_ID));
        assert_eq!(facet_value(collection, "live_items"), Some("1024"));
        assert_eq!(facet_value(collection, "holders"), Some("210"));

        // A cluster Cell holds no media of its own, so the aggregate is the
        // only composition it has.
        let composition = object_facet(&record, "spore", "composition");
        assert_eq!(composition.state.as_deref(), Some("centralized_mixture"));
        assert!(composition
            .attributes
            .iter()
            .all(|attribute| attribute.key.starts_with("agg_")));

        assert_eq!(calls.counts(), (0, 1, 0));
        server.abort();
    }

    /// M-NFT names its class in the type script rather than in the data, so an
    /// item's kin is legible before any request is made — and one request is
    /// all it takes, because the asset index states a class's composition on
    /// the class itself.
    #[tokio::test]
    async fn an_mnft_token_learns_the_class_it_descends_from() {
        let (api_base, server, calls) = spawn_object_api(ObjectIndexHealth::HEALTHY).await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();

        let record = enrich_object_cell(&source, MNFT_TOKEN_TX_HASH).await;

        let collection = object_facet(&record, "mnft", "collection");
        assert_eq!(
            collection.state.as_deref(),
            Some("Non-Fungible Santa Claus")
        );
        assert_eq!(facet_value(collection, "role"), Some("item"));
        // The token's own serial is the four bytes past the class id, and no
        // part of what names the collection.
        assert_eq!(
            facet_value(collection, "collection_id"),
            Some(MNFT_COLLECTION_ID)
        );
        assert_eq!(facet_value(collection, "live_items"), Some("2408"));
        assert_eq!(facet_value(collection, "holders"), Some("1392"));
        assert_eq!(
            facet_value(collection, "owned_capacity"),
            Some("32285294386739")
        );
        // M-NFT keeps its prose on the class record, and a sentence needs no
        // unwrapping to cross.
        assert_eq!(
            facet_value(collection, "description"),
            Some(MNFT_CLASS_DESCRIPTION)
        );

        // No per-item media profile exists upstream, so the population's
        // verdict is the only one there is to headline with.
        let composition = object_facet(&record, "mnft", "composition");
        assert_eq!(composition.state.as_deref(), Some("centralized_mixture"));
        assert_eq!(
            facet_keys(composition),
            vec![
                "agg_tier",
                "agg_onchain",
                "agg_pure_ckb",
                "agg_decentralized",
                "agg_centralized",
                "agg_unknown"
            ]
        );
        assert_eq!(facet_value(composition, "agg_centralized"), Some("2408"));

        // One call, to the asset index alone: the spore routes know nothing
        // about m-NFT.
        assert_eq!(calls.counts(), (0, 0, 1));
        server.abort();
    }

    #[tokio::test]
    async fn an_mnft_class_cell_reads_the_population_it_names() {
        let (api_base, server, calls) = spawn_object_api(ObjectIndexHealth::HEALTHY).await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();

        let record = enrich_object_cell(&source, MNFT_CLASS_TX_HASH).await;

        let collection = object_facet(&record, "mnft", "collection");
        assert_eq!(
            collection.state.as_deref(),
            Some("Non-Fungible Santa Claus")
        );
        assert_eq!(facet_value(collection, "role"), Some("cluster"));
        // A class cell and its tokens are keyed by the same 24 bytes, which is
        // why one derivation and one route serve both.
        assert_eq!(
            facet_value(collection, "collection_id"),
            Some(MNFT_COLLECTION_ID)
        );
        assert_eq!(facet_value(collection, "live_items"), Some("2408"));

        let composition = object_facet(&record, "mnft", "composition");
        assert_eq!(composition.state.as_deref(), Some("centralized_mixture"));
        assert!(composition
            .attributes
            .iter()
            .all(|attribute| attribute.key.starts_with("agg_")));

        assert_eq!(calls.counts(), (0, 0, 1));
        server.abort();
    }

    #[tokio::test]
    async fn an_mnft_token_whose_args_cannot_hold_a_class_id_claims_nothing() {
        let (api_base, server, calls) = spawn_object_api(ObjectIndexHealth::HEALTHY).await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();

        let record = enrich_object_cell(&source, MNFT_STUNTED_TX_HASH).await;

        // Sixteen bytes name no class. Unknown is not a collection, and no
        // request could make it one.
        assert!(record.facets.iter().all(|facet| facet.namespace != "mnft"));
        assert_eq!(calls.counts(), (0, 0, 0));
        server.abort();
    }

    #[tokio::test]
    async fn an_mnft_cell_survives_an_asset_index_outage_still_naming_its_class() {
        let (api_base, server, calls) = spawn_object_api(ObjectIndexHealth::ASSETS_DOWN).await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();

        let record = enrich_object_cell(&source, MNFT_TOKEN_TX_HASH).await;

        // The class id came off the Cell's own type script, so it outlives the
        // index that would have described the class.
        let collection = object_facet(&record, "mnft", "collection");
        assert_eq!(collection.state, None);
        assert_eq!(facet_keys(collection), vec!["role", "collection_id"]);
        assert_eq!(facet_value(collection, "role"), Some("item"));
        assert_eq!(
            facet_value(collection, "collection_id"),
            Some(MNFT_COLLECTION_ID)
        );
        // Nothing was measured, so nothing is composed: a tier this side never
        // heard is absent rather than unknown.
        assert!(record
            .facets
            .iter()
            .all(|facet| facet.kind != "composition"));

        assert_eq!(calls.counts(), (0, 0, 1));
        server.abort();
    }

    #[tokio::test]
    async fn a_cell_that_is_no_kind_of_object_asks_the_object_indexes_nothing() {
        let (api_base, server, calls) = spawn_object_api(ObjectIndexHealth::HEALTHY).await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();

        let record = enrich_object_cell(&source, TX_HASH).await;

        assert!(record.facets.iter().any(|facet| facet.kind == "dao"));
        assert!(record
            .facets
            .iter()
            .all(|facet| facet.namespace != "spore" && facet.namespace != "mnft"));
        assert_eq!(calls.counts(), (0, 0, 0));
        server.abort();
    }

    /// The derivation itself, in the shapes the wire actually produces and the
    /// ones it must refuse. An id that names a collection is worth exactly as
    /// much as the guarantee that a non-id never becomes one.
    #[test]
    fn an_mnft_class_id_is_the_first_twenty_four_bytes_or_nothing() {
        // A token's args carry a serial past the class id; a class cell's stop
        // at the class id. Both name the same collection.
        assert_eq!(
            mnft_collection_id(Some(MNFT_TOKEN_ARGS)).as_deref(),
            Some(MNFT_COLLECTION_ID)
        );
        assert_eq!(
            mnft_collection_id(Some(MNFT_COLLECTION_ID)).as_deref(),
            Some(MNFT_COLLECTION_ID)
        );
        // The path segment is lower case because ckbadger's index is.
        assert_eq!(
            mnft_collection_id(Some("0x8F67EFEDD50C61C9DD332DEFD4051F08A02D797700000014"))
                .as_deref(),
            Some(MNFT_COLLECTION_ID)
        );
        // One byte short, no prefix, not hex, nothing at all: each names no
        // class, and none of them is dressed up as one.
        assert_eq!(
            mnft_collection_id(Some("0x8f67efedd50c61c9dd332defd4051f08a02d7977000000")),
            None
        );
        assert_eq!(
            mnft_collection_id(Some("8f67efedd50c61c9dd332defd4051f08a02d797700000014")),
            None
        );
        assert_eq!(
            mnft_collection_id(Some("0xzzzzefedd50c61c9dd332defd4051f08a02d797700000014")),
            None
        );
        assert_eq!(mnft_collection_id(Some("0x")), None);
        assert_eq!(mnft_collection_id(None), None);
    }

    /// The vocabulary pin. Every name below is ckbadger's rather than ours —
    /// the camelCase wire fields of both object indexes, the five tier
    /// spellings, the four decode kinds, the `cluster_id` segment label and
    /// its `"none"` sentinel — and this test exists for one purpose: to fail
    /// loudly when one of them drifts upstream, because a drifted name
    /// otherwise reaches the panel as a row that quietly stopped appearing.
    #[test]
    fn the_object_vocabulary_is_pinned_to_ckbadgers_own_spelling() {
        let cluster: ClusterDetailResponse =
            serde_json::from_value(cluster_detail()).expect("cluster detail decodes");
        assert_eq!(cluster.name.as_deref(), Some("Nervape Gen2"));
        assert_eq!(cluster.spores_count, 1024);
        assert_eq!(cluster.holders_count, 210);
        assert_eq!(cluster.owned_capacity.as_deref(), Some("109067222027837"));
        let composition = cluster
            .composition
            .expect("composition rides the cluster response");
        assert_eq!(composition.tier, "centralized_mixture");
        assert_eq!(composition.onchain_count, 1010);
        assert_eq!(composition.pure_ckb_count, 980);
        assert_eq!(composition.decentralized_mixture_count, 12);
        assert_eq!(composition.centralized_mixture_count, 2);
        assert_eq!(composition.unknown_count, 0);

        // The asset index answers the same two questions in its own spelling:
        // `liveCount` for a population, `ownedCapacity` for its capacity, and
        // the collection's prose nested one level down in `classDetail`.
        let collection: NftCollectionDetailResponse =
            serde_json::from_value(nft_collection_detail()).expect("nft collection decodes");
        assert_eq!(collection.name.as_deref(), Some("Non-Fungible Santa Claus"));
        assert_eq!(collection.live_count, 2408);
        assert_eq!(collection.holders_count, 1392);
        assert_eq!(collection.owned_capacity.as_deref(), Some("32285294386739"));
        assert_eq!(
            collection
                .class_detail
                .and_then(|class| class.description)
                .as_deref(),
            Some(MNFT_CLASS_DESCRIPTION)
        );
        let collection_composition = collection
            .composition
            .expect("composition rides the collection response");
        assert_eq!(collection_composition.tier, "centralized_mixture");
        assert_eq!(collection_composition.centralized_mixture_count, 2408);

        // The five tiers ckbadger measures, plus a sixth it has not invented
        // yet: an unfamiliar tier must arrive as a string this side does not
        // recognise, never as a decode failure.
        for tier in [
            "pure_ckb",
            "btc_ckb",
            "decentralized_mixture",
            "centralized_mixture",
            "unknown",
            "a_tier_from_a_later_ckbadger",
        ] {
            let item: SporeItemResponse = serde_json::from_value(serde_json::json!({
                "clusterId": CLUSTER_ID,
                "mediaProfile": { "tier": tier, "sources": [], "issues": [] }
            }))
            .expect("spore object decodes");
            assert_eq!(item.media_profile.expect("media profile").tier, tier);
        }

        // What the gate matches on, read back through the real Cell decoder.
        let decode = |cell: serde_json::Value| {
            serde_json::from_value::<CellDetailResponse>(cell)
                .expect("cell detail decodes")
                .data_analysis
                .and_then(|analysis| analysis.deterministic)
                .expect("deterministic decode")
        };
        let clustered = decode(clustered_spore_cell());
        assert_eq!(clustered.kind, "spore_cell");
        assert_eq!(
            clustered
                .segments
                .iter()
                .find(|segment| segment.label == "cluster_id")
                .map(|segment| segment.human_value.as_str()),
            Some(CLUSTER_ID)
        );
        assert_eq!(
            decode(sole_spore_cell())
                .segments
                .iter()
                .find(|segment| segment.label == "cluster_id")
                .map(|segment| segment.human_value.as_str()),
            Some(SPORE_NO_CLUSTER)
        );
        assert_eq!(decode(spore_cluster_cell()).kind, "spore_cluster_cell");
        // M-NFT's decode names the token's own fields and no class, which is
        // why the kind is all the gate reads off it.
        let token = decode(mnft_token_cell());
        assert_eq!(token.kind, "mnft_token_cell");
        assert!(token
            .segments
            .iter()
            .all(|segment| segment.label != "cluster_id"));
        assert_eq!(decode(mnft_class_cell()).kind, "mnft_class_cell");
    }

    /// DOB clusters mint their description as a JSON envelope whose only
    /// prose is the inner sentence; everything else that arrives is free text
    /// and crosses verbatim. Live mainnet is where the envelope was found:
    /// the bounded cut landed mid-JSON and the hover read like a config file.
    #[test]
    fn a_dob_description_envelope_yields_its_inner_sentence() {
        assert_eq!(
            collection_description_text(
                r#"{"description":"Handheld gadgets for Nervapes.","dob":{"ver":0}}"#
            )
            .as_deref(),
            Some("Handheld gadgets for Nervapes.")
        );
        // Plain prose, malformed JSON, and an envelope with no inner sentence
        // all cross verbatim — unwrapping any further would be inventing one.
        assert_eq!(
            collection_description_text("Cosmic Repository: www.cosmicrepository.com").as_deref(),
            Some("Cosmic Repository: www.cosmicrepository.com")
        );
        assert_eq!(
            collection_description_text(r#"{"description":"broken"#).as_deref(),
            Some(r#"{"description":"broken"#)
        );
        assert_eq!(
            collection_description_text(r#"{"dob":{"ver":0}}"#).as_deref(),
            Some(r#"{"dob":{"ver":0}}"#)
        );
        assert_eq!(
            collection_description_text(r#"{"description":"   ","dob":{}}"#).as_deref(),
            Some(r#"{"description":"   ","dob":{}}"#)
        );
    }

    /// Anchor-valid stub carrying a script catalogue and a lookup endpoint.
    /// `lookup_requests` counts calls so a test can prove the adapter asked
    /// nothing when it had nothing to ask about.
    async fn spawn_script_registry_api() -> (Url, tokio::task::JoinHandle<()>, Arc<AtomicUsize>) {
        let lookup_requests = Arc::new(AtomicUsize::new(0));
        let counted = lookup_requests.clone();
        let app = Router::new()
            .route(
                "/api/v1/statistics/network",
                get(|| async {
                    Json(serde_json::json!({
                        "syncStatus": { "isSyncing": false, "syncedBlock": 100 }
                    }))
                }),
            )
            .route(
                "/api/v1/blocks/:number",
                get(|| async { Json(serde_json::json!({ "number": 100, "hash": "0xblock100" })) }),
            )
            .route(
                "/api/v1/scripts",
                get(|| async {
                    Json(serde_json::json!({
                        "data": [
                            {
                                "familyId": "default-lock",
                                "name": "Default Lock",
                                "description": "SECP256K1/blake160 single-signature lock.",
                                "scriptKind": "lock",
                                "website": null
                            },
                            {
                                "familyId": "joyid",
                                "name": "JoyID",
                                "description": "Passkey lock.",
                                "scriptKind": "lock",
                                "website": "https://joy.id"
                            }
                        ],
                        "total": 2
                    }))
                }),
            )
            .route(
                "/api/v1/scripts/lookup",
                axum::routing::post(move || {
                    let requests = counted.clone();
                    async move {
                        requests.fetch_add(1, Ordering::Relaxed);
                        Json(serde_json::json!({
                            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": {
                                "name": "JoyID",
                                "deprecated": false,
                                "scriptKind": "lock",
                                "decoderType": null,
                                "resolutionState": "resolved"
                            },
                            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb": {
                                "name": "Ambiguous",
                                "deprecated": false,
                                "scriptKind": "lock",
                                "decoderType": null,
                                "resolutionState": "ambiguous"
                            },
                            "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc": {
                                "name": "Unknown",
                                "deprecated": false,
                                "scriptKind": "lock",
                                "decoderType": null,
                                "resolutionState": "resolved"
                            }
                        }))
                    }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (
            Url::parse(&format!("http://{address}/api/v1")).unwrap(),
            handle,
            lookup_requests,
        )
    }

    #[tokio::test]
    async fn script_registry_names_what_the_census_observed() {
        let (api_base, server, lookup_requests) = spawn_script_registry_api().await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();
        assert_eq!(
            source.probe(&context()).await.status,
            EnrichmentSourceState::Ready
        );

        let mut ctx = context();
        ctx.observed_scripts = vec![
            ScriptId {
                code_hash: [0xaa; 32],
                hash_type: HashType::Type,
            },
            // Resolved as ambiguous by the index: dropped, not guessed at.
            ScriptId {
                code_hash: [0xbb; 32],
                hash_type: HashType::Type,
            },
            // Located but unnamed: ckbadger calls this "resolved" and names
            // it "Unknown", which is not a name.
            ScriptId {
                code_hash: [0xcc; 32],
                hash_type: HashType::Type,
            },
            // The index has never heard of this one at all.
            ScriptId {
                code_hash: [0xdd; 32],
                hash_type: HashType::Data1,
            },
        ];

        let registry = source
            .enrich_script_registry(&ctx)
            .await
            .unwrap()
            .expect("registry record");

        assert_eq!(registry.entries.len(), 1);
        let entry = &registry.entries[0];
        assert_eq!(entry.name, "JoyID");
        assert_eq!(entry.hash_type, "type");
        assert_eq!(entry.code_hash, format!("0x{}", "aa".repeat(32)));
        // The description comes from the catalogue, joined on the name the
        // lookup returned — the lookup itself carries no description.
        assert_eq!(entry.description.as_deref(), Some("Passkey lock."));
        assert_eq!(entry.website.as_deref(), Some("https://joy.id"));
        assert!(!entry.deprecated);
        // Three observed identities produced no name — ambiguous, sentinel,
        // and absent — and the record says so rather than presenting one
        // name as the whole answer.
        assert_eq!(registry.unresolved, 3);
        assert!(!registry.entries.iter().any(|entry| entry.name == "Unknown"));
        assert_eq!(lookup_requests.load(Ordering::Relaxed), 1);

        server.abort();
    }

    #[tokio::test]
    async fn script_registry_asks_nothing_before_the_first_census() {
        let (api_base, server, lookup_requests) = spawn_script_registry_api().await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();
        assert_eq!(
            source.probe(&context()).await.status,
            EnrichmentSourceState::Ready
        );

        // An empty observed set means "nothing to name yet", never "ask the
        // index what exists".
        let registry = source.enrich_script_registry(&context()).await.unwrap();

        assert!(registry.is_none());
        assert_eq!(lookup_requests.load(Ordering::Relaxed), 0);
        server.abort();
    }

    #[tokio::test]
    async fn mismatched_block_hash_marks_source_incompatible() {
        let (api_base, server) = spawn_mock_api("0xother-chain").await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();

        let status = source.probe(&context()).await;
        assert_eq!(status.status, EnrichmentSourceState::Incompatible);
        assert!(status.validated_anchor.is_none());

        server.abort();
    }

    #[tokio::test]
    async fn disabled_crawler_returns_no_atlas_without_fetching_nodes() {
        let (api_base, server, crawler_requests) = spawn_disabled_crawler_api().await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();
        assert_eq!(
            source.probe(&context()).await.status,
            EnrichmentSourceState::Ready
        );

        let atlas = source.enrich_network_atlas(&context()).await.unwrap();

        assert!(atlas.is_none());
        assert_eq!(crawler_requests.load(Ordering::Relaxed), 0);
        server.abort();
    }

    #[tokio::test]
    async fn disabled_crawler_returns_no_roster_without_fetching_nodes() {
        let (api_base, server, crawler_requests) = spawn_disabled_crawler_api().await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();
        assert_eq!(
            source.probe(&context()).await.status,
            EnrichmentSourceState::Ready
        );

        let roster = source.enrich_network_roster(&context()).await.unwrap();

        // No crawler is an ABSENT roster, which is what retires the sighted
        // nodes already on stage. An empty one would say the opposite.
        assert!(roster.is_none());
        assert_eq!(crawler_requests.load(Ordering::Relaxed), 0);
        server.abort();
    }

    /// A hydrator that fails a stated number of times before answering, so a
    /// test can ask what the source did with the batch it never delivered.
    struct FlakyHydrator {
        failures_left: std::sync::atomic::AtomicUsize,
        hydrated: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl GalaxyCompositionHydrator for FlakyHydrator {
        async fn hydrate_galaxy_composition(
            &self,
            candidates: GalaxyCompositionCandidates,
        ) -> anyhow::Result<GalaxyCompositionRecord> {
            self.hydrated.fetch_add(
                candidates.dao.len() + candidates.typed.len() + candidates.plain.len(),
                Ordering::Relaxed,
            );
            if self
                .failures_left
                .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |left| {
                    left.checked_sub(1)
                })
                .is_ok()
            {
                return Err(anyhow!("the local node was not answering"));
            }
            Ok(GalaxyCompositionRecord {
                source: "ckbadger".to_string(),
                as_of: candidates.as_of,
                updated_at_ms: candidates.updated_at_ms,
                dao: Vec::new(),
                typed: Vec::new(),
                plain: Vec::new(),
            })
        }

        async fn hydrate_galaxy_top_up(
            &self,
            _candidates: GalaxyCompositionCandidates,
        ) -> anyhow::Result<GalaxyCompositionTopUp> {
            unreachable!("this test never tops up")
        }
    }

    /// A discovery whose hydration fails must leave the batch UNCLAIMED.
    ///
    /// The tail was marked the moment discovery returned, before the node
    /// batch that turns candidates into cells had answered. A hydration
    /// failure — or an anchor that moved under it — therefore burned a whole
    /// composition's worth of tail depth on cells nobody was ever handed:
    /// the retry re-discovered the same head, and every later top-up skipped
    /// it as already emitted, so the shortfall never closed.
    #[tokio::test]
    async fn a_failed_hydration_leaves_the_batch_for_the_retry() {
        let (api_base, server) =
            crate::galaxy_composition::tests::spawn_composition_index(1, true).await;
        let hydrated = Arc::new(AtomicUsize::new(0));
        let source = CkbadgerEnrichmentSource::new(api_base)
            .unwrap()
            .with_galaxy_composition_hydrator(
                FlakyHydrator {
                    failures_left: std::sync::atomic::AtomicUsize::new(1),
                    hydrated: hydrated.clone(),
                },
                64,
            );
        assert_eq!(
            source.probe(&context()).await.status,
            EnrichmentSourceState::Ready
        );

        let failed = source.enrich_galaxy_composition(&context()).await;
        assert!(failed.is_err(), "the hydrator refused this batch");
        let offered = hydrated.load(Ordering::Relaxed);
        assert!(offered > 0, "the discovery did find candidates to offer");
        assert_eq!(
            source.candidate_tail.lock().await.claimed(),
            0,
            "a batch that never became a record claims no tail depth"
        );

        // The retry takes the very same candidates, and only now are they
        // claimed — so the tail resumes past what a client actually received.
        let record = source
            .enrich_galaxy_composition(&context())
            .await
            .expect("the second attempt hydrates")
            .expect("a composition record");
        assert_eq!(record.as_of.block, 100);
        assert_eq!(
            hydrated.load(Ordering::Relaxed),
            offered * 2,
            "the retry re-offered the batch the failure did not consume"
        );
        assert_eq!(
            source.candidate_tail.lock().await.claimed(),
            offered,
            "the claim lands once the record exists, and not before"
        );
        server.abort();
    }

    fn crawler_summary(round_id: u64) -> NetworkCrawlerSummaryResponse {
        NetworkCrawlerSummaryResponse {
            enabled: true,
            has_data: true,
            last_round: Some(crate::dto::NetworkCrawlerRoundResponse {
                round_id,
                started_at: 1_700_000_000,
                finished_at: 1_700_000_010,
                // One disjoint outcome matrix, spelled out so the round
                // closes both ways: 3 identified on this network, 8 exhausted
                // (6 of them still holding an older verification), 1 foreign.
                // 3 + 8 + 1 = 12 candidates, and 3 + 6 = 9 held verified.
                candidate_peers: 12,
                reachable_peers: 3,
                exhausted_candidates: 8,
                foreign_peers: 1,
                verified_unavailable_peers: 6,
                verified_retained_peers: 9,
                new_verified_peers: 1,
            }),
        }
    }

    /// The census beside that round: nine peers held verified, folded two ways
    /// over the same nine.
    fn crawler_distributions() -> NetworkDistributionsResponse {
        NetworkDistributionsResponse {
            verified_retained: 9,
            versions: vec![
                label_count("0.209.0 (d166e28 2026-07-29)", 6),
                label_count("0.207.0 (8f6cacf 2026-06-10)", 3),
            ],
            countries: vec![label_count("SG", 5), label_count("US", 4)],
        }
    }

    fn label_count(label: &str, count: u64) -> LabelCountResponse {
        LabelCountResponse {
            label: label.to_string(),
            count,
        }
    }

    /// One row of a reachable-scoped page. `last_seen` fills all four clocks
    /// the row carries, so a test that means to separate them has to say so —
    /// and because the page's order is checked on the newest positive
    /// observation, that is also the number an ordering test is choosing.
    fn crawler_row(peer_id: &str, last_seen: u64) -> PeerSummaryResponse {
        PeerSummaryResponse {
            peer_id: peer_id.to_string(),
            crawler_dial_state: PeerDisplayState::Reachable,
            primary_addr: Some("/ip4/127.0.0.1/tcp/8115".to_string()),
            version: Some("0.209.0".to_string()),
            country: Some("SG".to_string()),
            asn: Some("AS1 Example".to_string()),
            last_advertised_at: Some(last_seen),
            last_dial_observed_at: Some(last_seen),
            latest_positive_observed_at: last_seen,
            last_reachable_at: Some(last_seen),
            rtt_ms: Some(12),
        }
    }

    /// One row of the weakest rung: a real id on a real address, and null for
    /// every one of the five things only a dial could have answered.
    ///
    /// Its newest positive observation is the advertisement, which is the
    /// whole of what is positively known about a peer nobody ever reached —
    /// the dial clock beside it records an attempt that failed, and a failure
    /// is not one of the channels upstream takes its maximum over.
    fn hearsay_row(peer_id: &str, advertised_at: u64, observed_at: u64) -> PeerSummaryResponse {
        PeerSummaryResponse {
            peer_id: peer_id.to_string(),
            crawler_dial_state: PeerDisplayState::AdvertisedUnverified,
            primary_addr: Some("/ip4/127.0.0.9/tcp/8115".to_string()),
            version: None,
            country: None,
            asn: None,
            last_advertised_at: Some(advertised_at),
            last_dial_observed_at: Some(observed_at),
            latest_positive_observed_at: advertised_at,
            last_reachable_at: None,
            rtt_ms: None,
        }
    }

    /// One page as the mapper takes them: a refresh hands it one per rung of
    /// [`ROSTER_SCOPES`], and most tests here exercise a single rung.
    fn peers_page(
        items: Vec<PeerSummaryResponse>,
        next_cursor: Option<&str>,
    ) -> NetworkPeersPageResponse {
        NetworkPeersPageResponse {
            items,
            next_cursor: next_cursor.map(str::to_string),
        }
    }

    fn roster_anchor() -> ChainAnchor {
        ChainAnchor {
            block: 100,
            hash: "0xblock100".to_string(),
        }
    }

    #[test]
    fn a_roster_is_ordered_by_id_no_matter_how_the_page_arrived() {
        // Upstream pages by last-advertised, the one key a crawl round moves.
        // A roster published in that order would reshuffle every round and
        // teleport every node the scene had placed.
        let peers = peers_page(
            vec![
                crawler_row("7065657243", 30),
                crawler_row("7065657241", 20),
                crawler_row("7065657242", 10),
            ],
            None,
        );

        let roster = map_network_roster(crawler_summary(7), vec![peers], roster_anchor()).unwrap();

        assert_eq!(
            roster
                .entries
                .iter()
                .map(|entry| entry.node_id.as_str())
                .collect::<Vec<_>>(),
            vec!["DgUrnn4", "DgUrnn5", "DgUrnn6"]
        );
        // Two rungs went unasked, and a roster that did not get to the end of
        // the gradient says so.
        assert!(roster.truncated);
    }

    #[test]
    fn a_roster_drops_the_rows_it_cannot_stage_and_keeps_the_rest() {
        // The crawler reached this one before and could not this round: it is
        // still a peer it holds a verification for, so it stages dark rather
        // than leaving. Its country and ASN arrive as upstream's own word for
        // a lookup that came back empty.
        let mut remembered = crawler_row("7065657242", 20);
        remembered.crawler_dial_state = PeerDisplayState::VerifiedUnavailable;
        remembered.country = Some(String::new());
        remembered.asn = Some(String::new());
        // A peer on another chain: it answered, and it is not a member of this
        // network's colony. The reach bar counts it; the roster does not
        // name it.
        let mut foreign = crawler_row("7065657246", 18);
        foreign.crawler_dial_state = PeerDisplayState::ForeignNetwork;
        // A reached peer the crawler holds no reach moment for. It still
        // stages: the state is what says the dial was answered, and the row is
        // dated by the positive-observation clock every candidate has.
        let mut undated = crawler_row("7065657245", 12);
        undated.last_reachable_at = None;
        // Newest positively-observed first within each page, because that is the order
        // upstream sorts a scope in and the order this mapper checks for. The
        // dark row rides the rung that asked for it — a page only contributes
        // its own state.
        let pages = vec![
            peers_page(
                vec![
                    crawler_row("7065657241", 40),
                    // Not a peer id at all: skipped, never repaired into one.
                    crawler_row("not-hex", 35),
                    // The same node twice: it may only stand on stage once.
                    crawler_row("7065657241", 30),
                    foreign,
                    undated,
                    // No advertise moment at all. Every other clock on this
                    // record may be absent; this one is what dates the row, so
                    // a row without it is one nothing can stamp.
                    crawler_row("7065657243", 0),
                ],
                Some("7065657242"),
            ),
            peers_page(vec![remembered], None),
            peers_page(Vec::new(), None),
        ];

        let roster = map_network_roster(crawler_summary(7), pages, roster_anchor()).unwrap();

        assert_eq!(
            roster
                .entries
                .iter()
                .map(|entry| entry.node_id.as_str())
                .collect::<Vec<_>>(),
            vec!["DgUrnn4", "DgUrnn5", "DgUrnn8"]
        );
        // A crawler that reached a node and cannot place it says so, and the
        // row carries the word rather than an absent field.
        assert_eq!(roster.entries[1].country.as_deref(), Some("Unknown"));
        assert_eq!(roster.entries[1].asn.as_deref(), Some("Unknown"));
        assert_eq!(
            roster.entries[1].state,
            RosterNodeState::VerifiedUnavailable
        );
        // Reached, and with no moment to date the reach by. The old record
        // could not express that and dropped the row; this one can, and the
        // positive-observation clock still stamps it.
        assert_eq!(roster.entries[2].state, RosterNodeState::Reachable);
        assert_eq!(roster.entries[2].last_reachable_ms, None);
        assert_eq!(roster.entries[2].latest_positive_observed_ms, 12_000);
        assert!(roster.truncated);
    }

    #[test]
    fn the_states_the_scene_has_no_mark_for_never_reach_the_record() {
        // Two of upstream's five states are not rungs of this record's
        // gradient and never become a row. A foreign-chain peer answered a
        // dial and belongs to another network — the reach bar counts it, and
        // a colony that staged it would be drawing somebody else's network into
        // this one. A candidate no completed round has reached yet carries
        // strictly less than the hearsay rung already does, and is gone again
        // by the next round. `Unknown` is a sixth state upstream added that
        // this build has no sentence for, and the only honest thing to do with
        // a node you cannot describe is to not name it.
        for state in [
            PeerDisplayState::ForeignNetwork,
            PeerDisplayState::NoCompletedObservation,
            PeerDisplayState::Unknown,
        ] {
            assert_eq!(roster_state(state), None, "{state:?} became a roster rung");
            let mut row = crawler_row("7065657241", 40);
            row.crawler_dial_state = state;
            let peers = peers_page(vec![row], None);

            let roster =
                map_network_roster(crawler_summary(7), vec![peers], roster_anchor()).unwrap();

            assert!(roster.entries.is_empty(), "{state:?} was staged");
        }
    }

    #[test]
    fn roster_scope_filters_name_the_states_they_ask_for() {
        // The scope table sends a word and then trusts every row of the answer
        // to decode to the state that word names. Both halves are written by
        // hand from upstream's filter vocabulary, so this is where they are
        // checked against each other: `state=` is parsed upstream by string
        // match, and a scope word that drifted from its state would ask for
        // one rung and then throw the whole page away as off-scope.
        for scope in ROSTER_SCOPES {
            let decoded: PeerDisplayState = serde_json::from_value(serde_json::json!(scope.filter))
                .expect("a scope filter must be a state this build can name");
            assert_eq!(
                decoded, scope.state,
                "scope filter {} does not name its own state",
                scope.filter
            );
            assert!(
                roster_state(scope.state).is_some(),
                "scope filter {} asks for a state the record cannot carry",
                scope.filter
            );
        }
    }

    #[test]
    fn a_row_on_the_wrong_page_is_dropped_rather_than_taking_a_seat() {
        // In health this never fires: upstream filters on exactly the field
        // being compared. It is here for the day it stops — a `state=` that
        // is ignored turns every page into the same unscoped population, the
        // strongest rung's request swallows the whole budget on rows belonging
        // to the weakest, and nothing about the record would look wrong.
        let unfiltered = || {
            vec![
                crawler_row("7065657241", 40),
                hearsay_row("7065657242", 39, 38),
            ]
        };
        let pages = vec![
            peers_page(unfiltered(), None),
            peers_page(
                vec![
                    crawler_row("7065657243", 37),
                    hearsay_row("7065657244", 36, 35),
                ],
                None,
            ),
            peers_page(unfiltered(), None),
        ];

        let roster = map_network_roster(crawler_summary(7), pages, roster_anchor()).unwrap();

        // One row from each page: the one that rung was asked for. The
        // verified-unavailable page contributed nothing, because nothing on
        // it was verified-unavailable.
        assert_eq!(
            roster
                .entries
                .iter()
                .map(|entry| (entry.node_id.as_str(), entry.state))
                .collect::<Vec<_>>(),
            vec![
                ("DgUrnn4", RosterNodeState::Reachable),
                ("DgUrnn5", RosterNodeState::AdvertisedUnverified),
            ]
        );
    }

    #[test]
    fn the_budget_is_spent_on_the_strongest_evidence_first() {
        // The whole reason the roster asks three times instead of once. An
        // unscoped page is sorted by advertise time, which mixes the rungs, so
        // a budget spent on it goes to whoever the gossip mentioned most
        // recently — here, hearsay advertised after every verified peer. Rung
        // by rung, the verified peers are inside the budget and the hearsay
        // competes only with itself for what is left.
        let pages = vec![
            peers_page(vec![crawler_row("7065657241", 10)], None),
            peers_page(
                vec![{
                    let mut row = crawler_row("7065657242", 9);
                    row.crawler_dial_state = PeerDisplayState::VerifiedUnavailable;
                    row
                }],
                None,
            ),
            peers_page(
                vec![
                    hearsay_row("7065657243", 90, 89),
                    hearsay_row("7065657244", 80, 79),
                ],
                None,
            ),
        ];

        let roster = map_network_roster(crawler_summary(7), pages, roster_anchor()).unwrap();

        assert_eq!(
            roster
                .entries
                .iter()
                .map(|entry| entry.state)
                .collect::<Vec<_>>(),
            vec![
                RosterNodeState::Reachable,
                RosterNodeState::VerifiedUnavailable,
                RosterNodeState::AdvertisedUnverified,
                RosterNodeState::AdvertisedUnverified,
            ]
        );
        // Every rung was asked after and every page was answered in full, so
        // this roster names everything the crawler would have handed it.
        assert!(!roster.truncated);
    }

    #[test]
    fn a_row_the_crawler_never_dialed_carries_no_answer_rather_than_the_word_for_one() {
        // ⭐ The distinction this whole task turns on. Upstream mints
        // `"Unknown"` itself, for a peer it DID reach whose geolocation lookup
        // came back empty, and answers `null` for a peer it never reached at
        // all. Two different true sentences: somebody dialed this node and
        // could not place it, versus nobody has ever dialed it. Spelling them
        // the same way — one `unwrap_or_default()` is enough — prints the
        // crawler's verdict over a node it has never spoken to.
        let mut placeless = crawler_row("7065657241", 40);
        placeless.country = Some("Unknown".to_string());
        placeless.asn = Some("Unknown".to_string());
        let pages = vec![
            peers_page(vec![placeless], None),
            peers_page(Vec::new(), None),
            peers_page(vec![hearsay_row("7065657242", 39, 38)], None),
        ];

        let roster = map_network_roster(crawler_summary(7), pages, roster_anchor()).unwrap();

        let reached = &roster.entries[0];
        assert_eq!(reached.state, RosterNodeState::Reachable);
        assert_eq!(reached.country.as_deref(), Some("Unknown"));
        assert_eq!(reached.asn.as_deref(), Some("Unknown"));
        assert_eq!(reached.version.as_deref(), Some("0.209.0"));

        let hearsay = &roster.entries[1];
        assert_eq!(hearsay.state, RosterNodeState::AdvertisedUnverified);
        assert_eq!(hearsay.version, None);
        assert_eq!(hearsay.country, None);
        assert_eq!(hearsay.asn, None);
        assert_eq!(hearsay.rtt_ms, None);
    }

    #[test]
    fn the_four_clocks_a_row_carries_are_four_different_facts() {
        // Every value here is distinct on purpose: collapse any pair — read
        // the advertise moment into the reach field, let `lastDialObservedAt`
        // stand in for a reach the crawler never made, or fill the required
        // clock from a channel instead of reading the maximum upstream sent —
        // and one of these numbers lands under the wrong name. The reach clock
        // is the only one that means "the crawler saw this node", and it is
        // exactly the one an unverified row does not have; the required clock
        // is the only one that is never missing, and it is strictly the
        // newest, because that is what a maximum over channels is.
        let mut reached = crawler_row("7065657241", 0);
        reached.last_advertised_at = Some(900);
        reached.last_dial_observed_at = Some(800);
        reached.last_reachable_at = Some(700);
        reached.latest_positive_observed_at = 950;
        let pages = vec![
            peers_page(vec![reached], None),
            peers_page(Vec::new(), None),
            peers_page(vec![hearsay_row("7065657242", 600, 500)], None),
        ];

        let roster = map_network_roster(crawler_summary(7), pages, roster_anchor()).unwrap();

        assert_eq!(roster.entries[0].last_advertised_ms, Some(900_000));
        assert_eq!(roster.entries[0].last_observed_ms, Some(800_000));
        assert_eq!(roster.entries[0].last_reachable_ms, Some(700_000));
        assert_eq!(roster.entries[0].latest_positive_observed_ms, 950_000);
        // The row nobody ever reached: three clocks, and the fourth one is not
        // borrowed from any of them.
        assert_eq!(roster.entries[1].last_advertised_ms, Some(600_000));
        assert_eq!(roster.entries[1].last_observed_ms, Some(500_000));
        assert_eq!(roster.entries[1].latest_positive_observed_ms, 600_000);
        assert_eq!(roster.entries[1].last_reachable_ms, None);
    }

    #[test]
    fn a_round_that_found_nobody_is_an_empty_roster_and_still_a_report() {
        let pages = vec![
            peers_page(Vec::new(), None),
            peers_page(Vec::new(), None),
            peers_page(Vec::new(), None),
        ];

        let roster = map_network_roster(crawler_summary(11), pages, roster_anchor()).unwrap();

        assert_eq!(roster.crawl_round, 11);
        assert!(roster.entries.is_empty());
        assert!(!roster.truncated);
    }

    #[test]
    fn a_refresh_that_ran_out_of_budget_before_the_gradient_says_so() {
        // The one way `truncated` can be true with no cursor anywhere. A scope
        // answered in full carries no `nextCursor`, so a budget that ran out
        // between rungs would otherwise publish a roster that names a fraction
        // of the crawler's peers while claiming to name all of them.
        let pages = vec![peers_page(vec![crawler_row("7065657241", 40)], None)];

        let roster = map_network_roster(crawler_summary(7), pages, roster_anchor()).unwrap();

        assert_eq!(roster.entries.len(), 1);
        assert!(roster.truncated);
    }

    #[test]
    fn a_refresh_larger_than_the_cap_is_refused_rather_than_trimmed() {
        // Trimming would publish a roster whose membership is decided by an
        // order this crate did not ask for. Counted across the rungs, because
        // that is what the stage budget bounds: three pages each inside the
        // cap can still add up to more colony than there is room for.
        let pages = vec![
            peers_page(
                (0..ROSTER_CAP)
                    .map(|index| crawler_row(&format!("1220{index:060x}"), 20))
                    .collect(),
                None,
            ),
            peers_page(Vec::new(), None),
            peers_page(vec![hearsay_row("7065657242", 20, 19)], None),
        ];

        let error = map_network_roster(crawler_summary(7), pages, roster_anchor()).unwrap_err();

        assert!(error.to_string().contains("roster limit"), "{error}");
    }

    #[test]
    fn an_unknown_crawler_dial_state_costs_one_row_not_the_page() {
        // Upstream has broken this wire three times inside 36 hours, and each
        // break cost the whole roster rather than a field of it, because serde
        // fails an entire page over one value it has no name for. A sixth
        // state has to arrive as a row cknerv declines to stage — never as a
        // page it cannot open. Delete `#[serde(other)]` and this decode is
        // the error that empties the colony again.
        //
        // The rows carry the two evidence fields this build deliberately does
        // not declare, so the page proves what it claims: an undeclared field
        // is ignored rather than fatal, which is the whole reason they are
        // named in a doc comment instead of read into a struct.
        let page: NetworkPeersPageResponse = serde_json::from_str(
            r#"{
                "items": [
                    {
                        "peerId": "7065657241",
                        "crawlerDialState": "reachable",
                        "participation": {
                            "discoveryAdvertised": true,
                            "directSessionObserved": false,
                            "crawlerIdentified": true
                        },
                        "sessionInitiators": [],
                        "primaryAddr": "/ip4/127.0.0.1/tcp/8115",
                        "version": "0.209.0",
                        "country": "SG",
                        "asn": "AS1 Example",
                        "lastAdvertisedAt": 40,
                        "lastDialObservedAt": 40,
                        "latestPositiveObservedAt": 40,
                        "lastReachableAt": 40,
                        "rttMs": 12
                    },
                    {
                        "peerId": "7065657242",
                        "crawlerDialState": "quantumEntangled",
                        "participation": {
                            "discoveryAdvertised": true,
                            "directSessionObserved": false,
                            "crawlerIdentified": false
                        },
                        "sessionInitiators": ["peerInitiated"],
                        "primaryAddr": "/ip4/127.0.0.2/tcp/8115",
                        "version": null,
                        "country": null,
                        "asn": null,
                        "lastAdvertisedAt": 40,
                        "lastDialObservedAt": 40,
                        "latestPositiveObservedAt": 40,
                        "lastReachableAt": null,
                        "rttMs": null
                    }
                ],
                "nextCursor": null
            }"#,
        )
        .expect("a state this build has no name for must not fail the page");

        assert_eq!(page.items.len(), 2);
        assert_eq!(
            page.items[0].crawler_dial_state,
            PeerDisplayState::Reachable
        );
        assert_eq!(page.items[1].crawler_dial_state, PeerDisplayState::Unknown);

        // And the row that has no name is the only thing lost: its neighbour
        // still stages.
        let roster = map_network_roster(crawler_summary(7), vec![page], roster_anchor()).unwrap();
        assert_eq!(
            roster
                .entries
                .iter()
                .map(|entry| entry.node_id.as_str())
                .collect::<Vec<_>>(),
            vec!["DgUrnn4"]
        );
    }

    #[test]
    fn a_peer_the_crawler_only_ever_met_through_a_session_decodes_and_stages_nobody() {
        // The row this whole repair exists for, and the one shape the live
        // crawler could not be made to produce: nothing has ever dialed IN to
        // that host, so every candidate it holds came from gossip and carries
        // an address. These bytes are upstream's own pinned example of the
        // other case — a peer seen only through an inbound session it did not
        // dial — copied from the test that fixes that contract upstream.
        //
        // Three separate things have to hold at once, and each was a break in
        // its own right: `null` in `primaryAddr` and `lastAdvertisedAt` must
        // decode rather than fail the page, `latestPositiveObservedAt` must be
        // there to date the row when both of those are gone, and the two
        // evidence fields this build does not declare must be ignored rather
        // than fatal.
        let page: NetworkPeersPageResponse = serde_json::from_str(
            r#"{
                "items": [
                    {
                        "peerId": "7065657244",
                        "crawlerDialState": "noCompletedObservation",
                        "participation": {
                            "discoveryAdvertised": false,
                            "directSessionObserved": true,
                            "crawlerIdentified": false
                        },
                        "sessionInitiators": ["peerInitiated"],
                        "primaryAddr": null,
                        "version": null,
                        "country": null,
                        "asn": null,
                        "lastAdvertisedAt": null,
                        "lastDialObservedAt": null,
                        "latestPositiveObservedAt": 250,
                        "lastReachableAt": null,
                        "rttMs": null
                    }
                ],
                "nextCursor": null
            }"#,
        )
        .expect("a peer with no dialable address must not fail the page");

        assert_eq!(page.items[0].primary_addr, None);
        assert_eq!(page.items[0].last_advertised_at, None);
        assert_eq!(page.items[0].latest_positive_observed_at, 250);
        assert_eq!(
            page.items[0].crawler_dial_state,
            PeerDisplayState::NoCompletedObservation
        );

        // ⚠️ AND IT STAGES NOBODY, WHICH IS THE SETTLED RULING AND ALSO THE
        // COST OF IT. The roster names the three dial rungs, and a peer met
        // only through a session never completes a dial, so it can never be
        // one of them — on a publicly reachable host that is precisely the
        // population upstream grew this evidence to reveal, and the colony
        // stays silent about it. Pinned here so the silence is a decision on
        // the record rather than an accident nobody wrote down.
        let roster = map_network_roster(crawler_summary(7), vec![page], roster_anchor()).unwrap();

        assert!(roster.entries.is_empty());
    }

    #[test]
    fn a_roster_refuses_a_page_that_did_not_arrive_newest_positively_observed_first() {
        // The invariant this replaces was written against `lastSeen`, then
        // against `lastAdvertisedAt`, and it is on its third key because
        // upstream is on its third sort. The argument has never changed: a
        // page whose order cknerv cannot vouch for is a slice whose membership
        // nobody chose, and the roster is the only reader taking a slice.
        //
        // These two rows are DESCENDING by the retired key and ASCENDING by
        // the live one, so an invariant still reading the advertise clock
        // waves them through. That is the point of building them this way —
        // a guard that merely still compiles against a renamed field is a
        // guard that stopped guarding, and nothing else here would say so.
        let mut newest_advertised = crawler_row("7065657241", 20);
        newest_advertised.last_advertised_at = Some(40);
        newest_advertised.latest_positive_observed_at = 20;
        let mut newest_observed = crawler_row("7065657242", 40);
        newest_observed.last_advertised_at = Some(20);
        newest_observed.latest_positive_observed_at = 40;
        let out_of_order = peers_page(vec![newest_advertised, newest_observed], None);

        let error = map_network_roster(crawler_summary(7), vec![out_of_order], roster_anchor())
            .unwrap_err();

        assert!(
            error
                .to_string()
                .contains("newest positively observed first"),
            "{error}"
        );
    }

    #[test]
    fn a_page_upstream_sorted_is_never_refused_for_the_key_it_stopped_sorting_by() {
        // The other half, and the expensive one. `latestPositiveObservedAt` is
        // a checked maximum over four channels, and the advertise clock is
        // only one of them — so a peer a direct session touched a moment ago
        // outranks one the gossip named an hour ago, and the two keys disagree
        // constantly on a live crawl. An invariant left pointing at the old
        // key would refuse a page upstream sorted perfectly, take every node
        // off stage, and do it while looking like a validation catching a
        // fault. That is the exact silent-total-loss shape this file has now
        // been bitten by twice; here it is, pinned, so the third time is a red
        // test instead of an empty colony.
        let mut freshly_sessioned = crawler_row("7065657241", 90);
        freshly_sessioned.last_advertised_at = Some(10);
        let mut long_gossiped = crawler_row("7065657242", 20);
        long_gossiped.last_advertised_at = Some(80);
        let healthy = peers_page(vec![freshly_sessioned, long_gossiped], None);

        let roster = map_network_roster(crawler_summary(7), vec![healthy], roster_anchor())
            .expect("a page upstream sorted is a page this roster stages");

        assert_eq!(roster.entries.len(), 2);
    }

    #[test]
    fn a_peer_with_no_address_is_left_off_rather_than_named_unknown() {
        // Upstream answers `null` here for a peer it only ever met through a
        // session it did not dial, and refuses on principle to mint an address
        // out of that session's socket. cknerv must refuse just as flatly. The
        // failure being pinned is not a decode error — it is the quiet one:
        // `bounded_network_text` turns an empty string into the word
        // `"Unknown"`, so a mapper that reached for `unwrap_or_default()` here
        // would stage a node whose address reads `Unknown`, invite a reader to
        // click it, and have nothing true to say. One row leaves; the page and
        // its neighbour stay.
        let mut addressless = crawler_row("7065657242", 30);
        addressless.primary_addr = None;
        addressless.last_advertised_at = None;
        let page = peers_page(vec![crawler_row("7065657241", 40), addressless], None);

        let roster = map_network_roster(crawler_summary(7), vec![page], roster_anchor()).unwrap();

        assert_eq!(
            roster
                .entries
                .iter()
                .map(|entry| entry.node_id.as_str())
                .collect::<Vec<_>>(),
            vec!["DgUrnn4"]
        );
        assert!(
            roster.entries.iter().all(|entry| entry.addr != "Unknown"),
            "an address nobody sent was invented"
        );
    }

    #[test]
    fn a_missing_advertise_clock_costs_a_reading_and_never_the_node() {
        // The advertise clock is optional on both wires now, and the reason it
        // is optional rather than a second reason to drop a row matters: no
        // reader draws it. Dropping a verified, dialable, named peer out of
        // the colony because a clock nobody renders came back `null` would be
        // a strictly worse answer than the missing clock itself. So the node
        // stages, undated on that one axis and dated on the axis that is
        // required — and nothing borrows a neighbouring clock to fill the gap.
        let mut ungossiped = crawler_row("7065657241", 40);
        ungossiped.last_advertised_at = None;
        let page = peers_page(vec![ungossiped], None);

        let roster = map_network_roster(crawler_summary(7), vec![page], roster_anchor()).unwrap();

        assert_eq!(roster.entries.len(), 1);
        assert_eq!(roster.entries[0].last_advertised_ms, None);
        assert_eq!(roster.entries[0].latest_positive_observed_ms, 40_000);
        assert_eq!(roster.entries[0].last_reachable_ms, Some(40_000));
    }

    #[test]
    fn the_order_is_checked_inside_a_page_and_never_across_two() {
        // Each rung is sorted by upstream on its own, so the seam between two
        // pages is not an ordering at all — the hearsay a round advertised a
        // minute ago legitimately follows a verified peer nobody has mentioned
        // in a day. An invariant swept across the concatenation would refuse
        // every healthy refresh where the weakest rung is the freshest, which
        // is the ordinary shape of a live crawl.
        let pages = vec![
            peers_page(vec![crawler_row("7065657241", 10)], None),
            peers_page(Vec::new(), None),
            peers_page(vec![hearsay_row("7065657242", 90, 89)], None),
        ];

        let roster = map_network_roster(crawler_summary(7), pages, roster_anchor()).unwrap();

        assert_eq!(roster.entries.len(), 2);
    }

    #[test]
    fn one_advertise_moment_shared_by_every_row_is_an_order_and_not_a_fault() {
        // A round advertises its whole page in a single moment, so the live
        // page is nothing but ties and upstream falls through to the peer id
        // to break them. An invariant demanding a strict decrease would
        // refuse every healthy page — a total loss dressed as a validation.
        let tied = peers_page(
            vec![
                crawler_row("7065657241", 40),
                crawler_row("7065657242", 40),
                crawler_row("7065657243", 40),
            ],
            None,
        );

        let roster = map_network_roster(crawler_summary(7), vec![tied], roster_anchor()).unwrap();

        assert_eq!(roster.entries.len(), 3);
    }

    #[test]
    fn an_atlas_publishes_the_round_outcomes_and_the_census_beside_it() {
        let atlas = map_network_atlas(crawler_summary(7), crawler_distributions(), roster_anchor())
            .unwrap();

        // The round's counts. The first three are a partition of the fourth —
        // which is what the panel draws as one bar — and the fifth cuts across
        // two of them, which is why it is not a fourth share.
        assert_eq!(atlas.candidate_peers, 12);
        assert_eq!(atlas.last_round_reachable, 3);
        assert_eq!(atlas.foreign_peers, 1);
        assert_eq!(atlas.exhausted_candidates, 8);
        assert_eq!(atlas.verified_unavailable_peers, 6);
        assert_eq!(atlas.verified_retained_peers, 9);
        assert_eq!(atlas.new_verified_peers, 1);

        // And the census, on its own clock and its own denominator.
        assert_eq!(atlas.indexed_peers, 9);
        for family in [&atlas.countries, &atlas.versions] {
            assert_eq!(
                family.iter().map(|bucket| bucket.count).sum::<u32>(),
                atlas.indexed_peers
            );
        }
        // Ranked, not in the order upstream happened to answer in.
        assert_eq!(atlas.versions[0].label, "0.209.0 (d166e28 2026-07-29)");
        assert_eq!(atlas.versions[0].count, 6);
    }

    #[test]
    fn an_atlas_refuses_a_round_whose_outcomes_do_not_add_up_to_its_candidates() {
        // The three ways a completed candidate can end ARE the candidates:
        // upstream reads all four counts off one disjoint outcome matrix, so
        // this is an equality and not a bound. Loosen it to `<=` and a round
        // that lost a whole cohort on the way out publishes three widths
        // that quietly stop being the parts of the number they are drawn
        // against.
        for (name, mutate) in [
            (
                "a cohort short",
                Box::new(|round: &mut crate::dto::NetworkCrawlerRoundResponse| {
                    round.exhausted_candidates -= 1;
                }) as Box<dyn Fn(&mut crate::dto::NetworkCrawlerRoundResponse)>,
            ),
            (
                "a cohort over",
                Box::new(|round: &mut crate::dto::NetworkCrawlerRoundResponse| {
                    round.foreign_peers += 1;
                }),
            ),
            (
                "more reached than considered",
                Box::new(|round: &mut crate::dto::NetworkCrawlerRoundResponse| {
                    round.reachable_peers = round.candidate_peers + 1;
                }),
            ),
        ] {
            let mut summary = crawler_summary(7);
            mutate(summary.last_round.as_mut().unwrap());
            let error =
                map_network_atlas(summary, crawler_distributions(), roster_anchor()).unwrap_err();
            assert!(
                error
                    .to_string()
                    .contains("do not add up to its candidate count"),
                "{name}: {error}"
            );
        }
    }

    #[test]
    fn an_atlas_refuses_a_round_whose_verified_peers_do_not_split_in_two() {
        // A peer the crawler holds a verification for was either reached this
        // round or it was not, and there is no third case — so this is the
        // other equality, and it is what lets the panel print the unavailable
        // count beside the reachable one without implying they are parts of
        // the candidates.
        for delta in [-1_i64, 1] {
            let mut summary = crawler_summary(7);
            {
                let round = summary.last_round.as_mut().unwrap();
                round.verified_unavailable_peers =
                    round.verified_unavailable_peers.wrapping_add_signed(delta);
            }
            let error =
                map_network_atlas(summary, crawler_distributions(), roster_anchor()).unwrap_err();
            assert!(
                error
                    .to_string()
                    .contains("do not add up to its retained verified count"),
                "{delta}: {error}"
            );
        }

        let mut newer_than_it_holds = crawler_summary(7);
        newer_than_it_holds
            .last_round
            .as_mut()
            .unwrap()
            .new_verified_peers = 10;
        let error = map_network_atlas(
            newer_than_it_holds,
            crawler_distributions(),
            roster_anchor(),
        )
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("exceeds its retained verified count"),
            "{error}"
        );
    }

    #[test]
    fn an_atlas_refuses_a_histogram_that_does_not_cover_the_peers_it_describes() {
        // Every strip is drawn as each bucket's share of one population, so a
        // histogram that does not add up to that population draws a wrong bar
        // rather than a short one. This is also the check that keeps a
        // multi-label histogram out: upstream's `protocols` counts one row per
        // protocol per peer, so a fleet where every peer opens both would land
        // here at twice the population — which is why nothing reads it.
        let mut short = crawler_distributions();
        short.countries.pop();
        let error = map_network_atlas(crawler_summary(7), short, roster_anchor()).unwrap_err();
        assert!(
            error.to_string().contains("country buckets do not add up"),
            "{error}"
        );

        let mut doubled = crawler_distributions();
        doubled.versions = doubled
            .versions
            .iter()
            .map(|bucket| label_count(&bucket.label, bucket.count * 2))
            .collect();
        let error = map_network_atlas(crawler_summary(7), doubled, roster_anchor()).unwrap_err();
        assert!(
            error.to_string().contains("version buckets do not add up"),
            "{error}"
        );

        let mut empty_bucket = crawler_distributions();
        empty_bucket.versions.push(label_count("0.0.0", 0));
        let error =
            map_network_atlas(crawler_summary(7), empty_bucket, roster_anchor()).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("invalid network distribution version count"),
            "{error}"
        );
    }

    #[test]
    fn an_atlas_refuses_a_histogram_too_long_to_be_one() {
        // This record rides in every snapshot, so the bucket cap is a wire
        // budget before it is anything else — and `serde` has already
        // materialised the array by the time this runs, which is precisely why
        // the cap has to stop it going any further. It is a hostility guard
        // and never a policy: the partition check bounds a real histogram at
        // one bucket per peer, far below this.
        let mut flooded = crawler_distributions();
        flooded.countries = (0..=MAX_NETWORK_DISTRIBUTION_BUCKETS)
            .map(|index| label_count(&format!("C{index}"), 1))
            .collect();

        let error = map_network_atlas(crawler_summary(7), flooded, roster_anchor()).unwrap_err();

        assert!(
            error
                .to_string()
                .contains("too many network distribution country buckets"),
            "{error}"
        );
    }

    #[test]
    fn a_census_label_the_crawler_never_learned_is_counted_as_the_word_for_it() {
        // Upstream writes its own word for not knowing into the country
        // histogram, and writes nothing at all into the version one for a peer
        // that identified without a version. Both are the same statement to a
        // reader — nobody knows — so they are one bucket, and the record never
        // carries a blank label for a strip to draw as a nameless sliver.
        let mut unlabelled = crawler_distributions();
        unlabelled.versions = vec![label_count("", 4), label_count("Unknown", 5)];

        let atlas = map_network_atlas(crawler_summary(7), unlabelled, roster_anchor()).unwrap();

        assert_eq!(atlas.versions.len(), 1);
        assert_eq!(atlas.versions[0].label, "Unknown");
        assert_eq!(atlas.versions[0].count, 9);
    }

    #[test]
    fn a_reached_row_with_nothing_behind_it_stages_reached_and_says_nothing_else() {
        // Upstream reads `reachable` off the round's outcome and the five
        // optional fields off the node record, and the two are not the same
        // condition — a peer that identified in the last round while upstream
        // holds no record for it answers `reachable` with every one of them
        // null. It is rare and it is not a decode failure: the dial WAS
        // answered, which is the whole of what the state claims, so the row
        // stages under it and stays silent about everything a record would
        // have told us. The old contract had no way to be silent and dropped
        // the node instead.
        let mut unlabelled = crawler_row("7065657241", 40);
        unlabelled.country = None;
        unlabelled.version = None;
        unlabelled.asn = None;
        unlabelled.last_reachable_at = None;
        unlabelled.rtt_ms = None;
        let page = peers_page(vec![unlabelled], None);

        let roster = map_network_roster(crawler_summary(7), vec![page], roster_anchor()).unwrap();

        assert_eq!(roster.entries.len(), 1);
        assert_eq!(roster.entries[0].state, RosterNodeState::Reachable);
        assert_eq!(roster.entries[0].country, None);
        assert_eq!(roster.entries[0].version, None);
        assert_eq!(roster.entries[0].asn, None);
        assert_eq!(roster.entries[0].last_reachable_ms, None);
        // And the one clock every candidate has still dates it, which is why
        // no roster row is ever undated even when four of its five optional
        // fields are gone.
        assert_eq!(roster.entries[0].latest_positive_observed_ms, 40_000);
    }

    #[test]
    fn one_node_id_survives_the_round_trip_between_both_vocabularies() {
        // A real mainnet id, so the pin is the shape the crawler actually
        // keys by: 0x1220 + a 32-byte sha256 multihash.
        let peer_hex = "122001287e5131d1a7176be5fdb14c21d717ff9cc9f8d1cf1028b64ea1ec35eb4deb";
        let node_id = peer_hex_to_id(peer_hex).expect("hex is a peer id");

        assert_eq!(node_id, "QmNRAvtC6L85hwp6vWnqaKonJw3dz1q39B4nXVQErzC4Hx");
        assert_eq!(peer_id_to_hex(&node_id).as_deref(), Some(peer_hex));
        assert_eq!(peer_hex_to_id("not-hex"), None);
        assert_eq!(peer_hex_to_id(""), None);
    }

    #[tokio::test]
    async fn transaction_horizon_waits_when_source_advances_after_fetch() {
        let (api_base, server) = spawn_advancing_transaction_horizon_api().await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();
        assert_eq!(
            source.probe(&context()).await.status,
            EnrichmentSourceState::Ready
        );

        let horizon = source.enrich_transaction_horizon(&context()).await.unwrap();

        assert!(horizon.is_none());
        server.abort();
    }

    #[tokio::test]
    async fn transaction_horizon_rejects_same_height_anchor_change() {
        let (api_base, server) = spawn_reorganized_transaction_horizon_api().await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();
        assert_eq!(
            source.probe(&context()).await.status,
            EnrichmentSourceState::Ready
        );

        let error = source
            .enrich_transaction_horizon(&context())
            .await
            .unwrap_err();

        assert!(error.to_string().contains("anchor changed"));
        assert!(source.current_anchor(&context()).is_err());
        server.abort();
    }

    #[tokio::test]
    async fn activity_feed_rejects_same_height_anchor_change() {
        let (api_base, server) = spawn_reorganized_transaction_horizon_api().await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();
        assert_eq!(
            source.probe(&context()).await.status,
            EnrichmentSourceState::Ready
        );

        let error = source.enrich_activity_feed(&context()).await.unwrap_err();

        assert!(error.to_string().contains("activity feed anchor changed"));
        assert!(source.current_anchor(&context()).is_err());
        server.abort();
    }

    #[test]
    fn inconsistent_common_knowledge_breakdown_is_rejected() {
        let error = map_common_knowledge(
            CommonKnowledgeSizeBreakdown {
                capacity_field_bytes: 8,
                lock_script_bytes: 54,
                type_script_bytes: 33,
                data_bytes: 7,
                total_bytes: 101,
            },
            None,
        )
        .unwrap_err();

        assert!(error.to_string().contains("totals 102 bytes, expected 101"));
    }

    /// The exact shannon figure counts script args the byte breakdown never
    /// itemizes, so it OUTRUNS `total_bytes * 100_000_000` on any cell with
    /// args — which is nearly all of them. Cross-checking the two would reject
    /// precisely the cells this figure exists to explain, so the residual is
    /// carried, not judged.
    #[test]
    fn the_exact_occupied_capacity_may_outrun_the_bytes_it_is_shipped_beside() {
        let breakdown = || CommonKnowledgeSizeBreakdown {
            capacity_field_bytes: 8,
            lock_script_bytes: 54,
            type_script_bytes: 33,
            data_bytes: 7,
            total_bytes: 102,
        };

        let residual = map_common_knowledge(breakdown(), Some(10_300_000_000)).unwrap();
        assert_eq!(residual.total_bytes, 102);
        assert_eq!(
            residual.occupied_shannons.as_deref(),
            Some("10300000000"),
            "an extra byte of unindexed args must survive as evidence"
        );

        let unstated = map_common_knowledge(breakdown(), None).unwrap();
        assert_eq!(unstated.occupied_shannons, None);

        let error = map_common_knowledge(breakdown(), Some(-1)).unwrap_err();
        assert!(error.to_string().contains("negative commonKnowledgeSize"));
    }

    /// The DAO wall clocks are three optional rows on a facet that is useful
    /// without them, so an instant this parser cannot read exactly is dropped
    /// rather than allowed to sink the whole position.
    #[test]
    fn dao_wall_clocks_follow_the_blocks_and_an_unreadable_one_just_goes_missing() {
        let facet = dao_facet(crate::dto::DaoInfo {
            dao_status: "withdrawing".to_string(),
            deposit_block_number: 16_204_800,
            // Upstream leaves an empty string where a block header is missing.
            deposit_timestamp: Some(String::new()),
            withdraw_request_block: Some(16_300_000),
            withdraw_request_timestamp: Some("2024-03-05T06:07:08+00:00".to_string()),
            withdraw_block: None,
            withdraw_timestamp: Some("yesterday".to_string()),
            compensation_ckb: Some("1.25".to_string()),
            estimated_apc: None,
        })
        .unwrap();

        let keys: Vec<&str> = facet
            .attributes
            .iter()
            .map(|attribute| attribute.key.as_str())
            .collect();
        assert_eq!(
            keys,
            vec![
                "deposit_block",
                "withdraw_request_block",
                "compensation",
                "withdraw_request_at_ms",
            ],
            "blocks keep the lead; only the readable wall clock is appended"
        );
        let at_ms = facet
            .attributes
            .iter()
            .find(|attribute| attribute.key == "withdraw_request_at_ms")
            .unwrap();
        assert_eq!(at_ms.value, "1709618828000");
        assert_eq!(at_ms.unit.as_deref(), Some("ms"));
    }

    #[test]
    fn rfc3339_instants_convert_without_a_date_time_dependency() {
        for (text, expected) in [
            ("1970-01-01T00:00:00+00:00", Some(0)),
            ("1970-01-01T00:00:00Z", Some(0)),
            ("2024-03-05T06:07:08+00:00", Some(1_709_618_828_000)),
            // A fraction belongs to the second it is printed inside.
            ("2024-03-05T06:07:08.999Z", Some(1_709_618_828_000)),
            // Offsets are subtracted: the same instant, two wall clocks.
            ("2024-03-05T14:07:08+08:00", Some(1_709_618_828_000)),
            ("2024-03-05T01:07:08-05:00", Some(1_709_618_828_000)),
            // Leap day and century-leap arithmetic, the two places a
            // hand-rolled civil-days conversion goes wrong.
            ("2024-02-29T00:00:00Z", Some(1_709_164_800_000)),
            ("2000-02-29T00:00:00Z", Some(951_782_400_000)),
            ("2100-03-01T00:00:00Z", Some(4_107_542_400_000)),
            // Upstream's stand-in for a block header it does not have.
            ("", None),
            ("2024-03-05", None),
            ("2024-13-05T06:07:08Z", None),
            ("2024-03-05T06:07:08+0y:00", None),
            ("2024-03-05T06:07:08.Z", None),
            // A multi-byte character mid-offset must answer, not panic.
            ("2024-03-05T06:07:08+a\u{e9}0", None),
            ("2024-03-05T06:07:08+\u{e9}:00", None),
            ("1969-12-31T23:59:59Z", None),
        ] {
            assert_eq!(rfc3339_to_ms(text), expected, "{text}");
        }
    }

    /// A death the source cannot attribute is not carried: the record would
    /// otherwise assert an ending it has no spender for.
    #[test]
    fn only_a_death_with_a_named_spender_becomes_a_consumption() {
        let spender = format!("0x{}", "1c".repeat(32));

        let consumed = map_consumption(Some("dead"), Some(16_400_000), Some(spender.clone()))
            .unwrap()
            .expect("a named spender is a consumption");
        assert_eq!(consumed.tx_hash, spender);
        assert_eq!(consumed.block, Some(16_400_000));

        // Upstream nulls the block when it stored a zero, and the death is
        // still a death.
        assert_eq!(
            map_consumption(Some("dead"), None, Some(spender.clone()))
                .unwrap()
                .and_then(|consumed| consumed.block),
            None
        );
        assert!(map_consumption(Some("dead"), Some(16_400_000), None)
            .unwrap()
            .is_none());
        assert!(map_consumption(Some("live"), None, None).unwrap().is_none());
        // An older ckbadger states no status at all.
        assert!(map_consumption(None, Some(16_400_000), Some(spender))
            .unwrap()
            .is_none());

        let error = map_consumption(Some("dead"), None, Some("0xdead".to_string())).unwrap_err();
        assert!(error.to_string().contains("consumedByTx"));
    }

    fn cell_detail_body(tx_hash: &str) -> serde_json::Value {
        serde_json::json!({
            "txHash": tx_hash,
            "outputIndex": 1,
            "capacity": "10400000000",
            "dataSize": 8,
            "data": "0x5c00000000000000",
            "lockScriptHash": format!("0x{}", "11".repeat(32)),
            "typeScriptHash": format!("0x{}", "22".repeat(32)),
            "address": "ckt1qyqexample",
            "createdAtBlock": 16_204_800,
            "lock": {
                "codeHash": format!("0x{}", "33".repeat(32)),
                "hashType": "type",
                "args": format!("0x{}", "44".repeat(20)),
            },
            "type": {
                "codeHash": format!("0x{}", "55".repeat(32)),
                "hashType": "type",
                "args": "0x",
            },
            "commonKnowledgeSizeBreakdown": {
                "capacityFieldBytes": 8,
                "lockScriptBytes": 53,
                "typeScriptBytes": 33,
                "dataBytes": 8,
                "totalBytes": 102,
            },
            "isDepGroup": false,
        })
    }

    /// The three facts this DTO learned in one payload, decoded the way the
    /// live path decodes it — `serde_json` straight off the response body.
    #[test]
    fn cell_detail_decodes_the_exact_capacity_the_wall_clocks_and_the_spender() {
        let spender = format!("0x{}", "1c".repeat(32));
        let mut body = cell_detail_body(&format!("0x{}", "0a".repeat(32)));
        body["commonKnowledgeSize"] = serde_json::json!(10_320_000_000_i64);
        body["status"] = serde_json::json!("dead");
        body["consumedAtBlock"] = serde_json::json!(16_400_000);
        body["consumedByTx"] = serde_json::json!(spender);
        body["daoInfo"] = serde_json::json!({
            "isDaoCell": true,
            "daoStatus": "withdrawing",
            "depositBlockNumber": 16_204_800,
            "depositTimestamp": "2024-03-05T06:07:08+00:00",
            "withdrawRequestBlock": 16_300_000,
            "withdrawRequestTimestamp": "2024-03-06T06:07:08+00:00",
            "withdrawTimestamp": "2024-03-07T06:07:08+00:00",
            "compensation": "125000000",
            "compensationCkb": "1.25",
        });

        let cell: CellDetailResponse =
            serde_json::from_value(body).expect("decode cell detail fixture");

        assert_eq!(cell.common_knowledge_size, Some(10_320_000_000));
        assert_eq!(cell.status.as_deref(), Some("dead"));
        assert_eq!(cell.consumed_at_block, Some(16_400_000));
        assert_eq!(cell.consumed_by_tx.as_deref(), Some(spender.as_str()));
        let dao = cell.dao_info.expect("daoInfo");
        assert_eq!(
            dao.deposit_timestamp.as_deref(),
            Some("2024-03-05T06:07:08+00:00")
        );
        assert_eq!(
            dao.withdraw_request_timestamp.as_deref(),
            Some("2024-03-06T06:07:08+00:00")
        );
        assert_eq!(
            dao.withdraw_timestamp.as_deref(),
            Some("2024-03-07T06:07:08+00:00")
        );
        // The exact figure exceeds 102 * 100_000_000 by 20 bytes of lock args
        // the breakdown does not itemize — and the mapping keeps both.
        let common_knowledge = map_common_knowledge(
            cell.common_knowledge_size_breakdown,
            cell.common_knowledge_size,
        )
        .expect("a residual is evidence, not a contradiction");
        assert_eq!(common_knowledge.total_bytes, 102);
        assert_eq!(
            common_knowledge.occupied_shannons.as_deref(),
            Some("10320000000")
        );
        let consumed = map_consumption(
            cell.status.as_deref(),
            cell.consumed_at_block,
            cell.consumed_by_tx,
        )
        .expect("a named spender")
        .expect("a dead cell with a spender is consumed");
        assert_eq!(consumed.tx_hash, spender);
        assert_eq!(consumed.block, Some(16_400_000));
        let facet = dao_facet(dao).expect("dao facet");
        assert_eq!(
            facet
                .attributes
                .iter()
                .filter(|attribute| attribute.key.ends_with("_at_ms"))
                .map(|attribute| (attribute.key.as_str(), attribute.value.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("deposit_at_ms", "1709618828000"),
                ("withdraw_request_at_ms", "1709705228000"),
                ("withdraw_at_ms", "1709791628000"),
            ]
        );
    }

    /// The same endpoint on a ckbadger that predates all three facts. Every
    /// new field is absent rather than defaulted to a number, so nothing in
    /// the record claims an exact capacity, a date, or a death.
    #[test]
    fn a_cell_detail_without_the_new_facts_still_decodes_and_claims_nothing() {
        let mut body = cell_detail_body(&format!("0x{}", "0b".repeat(32)));
        body["daoInfo"] = serde_json::json!({
            "isDaoCell": true,
            "daoStatus": "deposited",
            "depositBlockNumber": 16_204_800,
        });

        let cell: CellDetailResponse =
            serde_json::from_value(body).expect("a legacy payload must still decode");

        assert_eq!(cell.common_knowledge_size, None);
        assert_eq!(cell.status, None);
        assert_eq!(cell.consumed_at_block, None);
        assert_eq!(cell.consumed_by_tx, None);
        let dao = cell.dao_info.expect("daoInfo");
        assert_eq!(dao.deposit_timestamp, None);
        assert_eq!(dao.withdraw_request_timestamp, None);
        assert_eq!(dao.withdraw_timestamp, None);

        let common_knowledge = map_common_knowledge(
            cell.common_knowledge_size_breakdown,
            cell.common_knowledge_size,
        )
        .expect("the byte breakdown still stands on its own");
        assert_eq!(common_knowledge.total_bytes, 102);
        assert_eq!(common_knowledge.occupied_shannons, None);
        assert!(map_consumption(
            cell.status.as_deref(),
            cell.consumed_at_block,
            cell.consumed_by_tx
        )
        .unwrap()
        .is_none());
        let facet = dao_facet(dao).expect("dao facet");
        assert!(
            !facet
                .attributes
                .iter()
                .any(|attribute| attribute.key.ends_with("_at_ms")),
            "no source clock means no wall-clock row"
        );
    }

    #[test]
    fn cell_content_keeps_exact_decode_ranges_and_bounds_raw_preview() {
        let total = MAX_CELL_CONTENT_PREVIEW_BYTES + 2;
        let content = map_cell_content(
            i64::try_from(total).unwrap(),
            Some(format!("0x{}", "ab".repeat(total))),
            Some(crate::dto::CellDataAnalysis {
                deterministic: Some(crate::dto::CellDeterministicDecode {
                    kind: "binary_envelope".to_string(),
                    summary: "deterministic header".to_string(),
                    segments: vec![
                        crate::dto::CellDataSegment {
                            label: "header".to_string(),
                            start: 0,
                            end: 2,
                            meaning: "two-byte header".to_string(),
                            human_value: "0xabab".to_string(),
                        },
                        crate::dto::CellDataSegment {
                            label: "empty_field".to_string(),
                            start: 2,
                            end: 2,
                            meaning: "present but empty field".to_string(),
                            human_value: "empty".to_string(),
                        },
                    ],
                }),
                heuristic_guesses: vec![crate::dto::CellDataGuess {
                    kind: "magic_number".to_string(),
                    confidence: "medium".to_string(),
                    reason: "header resembles a known envelope".to_string(),
                    mime_type: Some("application/octet-stream".to_string()),
                    human_value: None,
                }],
            }),
        )
        .unwrap();

        assert_eq!(content.total_bytes, u64::try_from(total).unwrap());
        assert!(!content.data_complete);
        let preview = content.data_hex.as_deref().unwrap();
        assert!(preview.ends_with(DATA_HEX_TRUNCATION_MARKER));
        assert!(preview.is_ascii(), "the marker must not widen the preview");
        assert_eq!(
            preview.len(),
            2 + MAX_CELL_CONTENT_PREVIEW_BYTES * 2 + DATA_HEX_TRUNCATION_MARKER.len_utf8()
        );
        let segment = &content.deterministic.as_ref().unwrap().segments[0];
        assert_eq!((segment.start_byte, segment.end_byte), (0, 2));
        assert_eq!(segment.meaning, "two-byte header");
        assert_eq!(segment.value, "0xabab");
        let empty = &content.deterministic.as_ref().unwrap().segments[1];
        assert_eq!((empty.start_byte, empty.end_byte), (2, 2));
        assert_eq!(empty.value, "empty");
        assert_eq!(
            content.heuristics[0].mime_type.as_deref(),
            Some("application/octet-stream")
        );
    }

    #[test]
    fn cell_content_rejects_ranges_outside_the_actual_payload() {
        let error = map_cell_content(
            1,
            Some("0xaa".to_string()),
            Some(crate::dto::CellDataAnalysis {
                deterministic: Some(crate::dto::CellDeterministicDecode {
                    kind: "invalid".to_string(),
                    summary: "invalid range".to_string(),
                    segments: vec![crate::dto::CellDataSegment {
                        label: "overflow".to_string(),
                        start: 0,
                        end: 2,
                        meaning: "outside payload".to_string(),
                        human_value: "?".to_string(),
                    }],
                }),
                heuristic_guesses: Vec::new(),
            }),
        )
        .unwrap_err();

        assert!(error.to_string().contains("invalid range 0..2 for 1 bytes"));
    }

    #[test]
    fn fixed_ckb_decimals_convert_without_floating_point() {
        assert_eq!(
            ckb_decimal_to_shannons("57763209638.48791674", "capacity").unwrap(),
            5_776_320_963_848_791_674
        );
        assert_eq!(percentage_to_bps("14.50", "share").unwrap(), 1_450);
        assert_eq!(
            signed_ckb_decimal_to_shannons("-1.25000000", "delta").unwrap(),
            -125_000_000
        );
        assert_eq!(
            signed_ckb_decimal_to_shannons("+0.00000001", "delta").unwrap(),
            1
        );
        assert!(ckb_decimal_to_shannons("1.000000001", "capacity").is_err());
        assert!(signed_ckb_decimal_to_shannons("-1.000000001", "delta").is_err());
        assert!(percentage_to_bps("100.01", "share").is_err());
    }

    #[test]
    fn transaction_horizon_keeps_only_bounded_counts() {
        let record = map_transaction_horizon(
            TransactionStatsResponse {
                current_hour: 12,
                current_day: 345,
                hourly_data: vec![
                    TransactionStatsPoint {
                        label: "10:00".to_string(),
                        value: 7,
                    },
                    TransactionStatsPoint {
                        label: "11:00".to_string(),
                        value: 9,
                    },
                ],
                daily_data: vec![TransactionStatsPoint {
                    label: "08/05".to_string(),
                    value: 345,
                }],
            },
            ChainAnchor {
                block: 100,
                hash: "0xblock100".to_string(),
            },
        )
        .unwrap();

        assert_eq!(record.current_hour, 12);
        assert_eq!(record.current_day, 345);
        assert_eq!(record.hourly_counts, vec![7, 9]);
        assert_eq!(record.daily_counts, vec![345]);
    }

    #[test]
    fn transaction_horizon_rejects_invalid_labels_counts_and_bounds() {
        let anchor = || ChainAnchor {
            block: 100,
            hash: "0xblock100".to_string(),
        };
        let response = |hourly_data| TransactionStatsResponse {
            current_hour: 1,
            current_day: 1,
            hourly_data,
            daily_data: Vec::new(),
        };

        assert!(map_transaction_horizon(
            response(vec![TransactionStatsPoint {
                label: "24:00".to_string(),
                value: 1,
            }]),
            anchor(),
        )
        .is_err());
        assert!(map_transaction_horizon(
            response(vec![TransactionStatsPoint {
                label: "12:00".to_string(),
                value: -1,
            }]),
            anchor(),
        )
        .is_err());
        assert!(map_transaction_horizon(
            response(
                (0..=MAX_TRANSACTION_HOURLY_BUCKETS)
                    .map(|index| TransactionStatsPoint {
                        label: format!("{:02}:00", index % 24),
                        value: 1,
                    })
                    .collect(),
            ),
            anchor(),
        )
        .is_err());
    }

    #[test]
    fn protocol_era_keeps_only_the_current_and_next_editions() {
        let record = map_protocol_era(
            hardfork_timeline(),
            "mainnet",
            ChainAnchor {
                block: 100,
                hash: "0xblock100".to_string(),
            },
            12_000,
        )
        .unwrap()
        .unwrap();

        assert_eq!(record.current.unwrap().name, "Mirana");
        assert_eq!(record.upcoming.unwrap().name, "Meepo");
    }

    #[test]
    fn protocol_era_waits_for_a_probe_that_covers_block_and_epoch_tips() {
        let mut timeline = hardfork_timeline();
        timeline.tip_block = 101;
        assert!(map_protocol_era(
            timeline,
            "mainnet",
            ChainAnchor {
                block: 100,
                hash: "0xblock100".to_string(),
            },
            12_000,
        )
        .unwrap()
        .is_none());

        let mut timeline = hardfork_timeline();
        timeline.tip_epoch = 12_001;
        assert!(map_protocol_era(
            timeline,
            "mainnet",
            ChainAnchor {
                block: 100,
                hash: "0xblock100".to_string(),
            },
            12_000,
        )
        .unwrap()
        .is_none());
    }

    #[test]
    fn protocol_era_rejects_network_status_and_order_disagreement() {
        let mut timeline = hardfork_timeline();
        timeline.network = "testnet".to_string();
        assert!(map_protocol_era(
            timeline,
            "mainnet",
            ChainAnchor {
                block: 100,
                hash: "0xblock100".to_string(),
            },
            12_000,
        )
        .is_err());

        let mut timeline = hardfork_timeline();
        timeline.events[1].status = "activated".to_string();
        assert!(map_protocol_era(
            timeline,
            "mainnet",
            ChainAnchor {
                block: 100,
                hash: "0xblock100".to_string(),
            },
            12_000,
        )
        .is_err());

        let mut timeline = hardfork_timeline();
        timeline.events.swap(0, 1);
        assert!(map_protocol_era(
            timeline,
            "mainnet",
            ChainAnchor {
                block: 100,
                hash: "0xblock100".to_string(),
            },
            12_000,
        )
        .is_err());
    }

    #[tokio::test]
    async fn protocol_era_is_unsupported_on_a_custom_canonical_network() {
        let source =
            CkbadgerEnrichmentSource::new(Url::parse("http://127.0.0.1:9/api/v1").unwrap())
                .unwrap();
        let mut canonical = context();
        canonical.chain_name = "ckb_dev".to_string();

        assert!(source
            .enrich_protocol_era(&canonical)
            .await
            .unwrap()
            .is_none());
    }

    #[test]
    fn dao_state_waits_for_a_validated_anchor_that_covers_its_statistics() {
        let statistics = DaoStatisticsResponse {
            tip_block_number: 101,
            total_deposited: "1".to_string(),
            total_depositors: 1,
            active_deposits: 1,
            unclaimed_compensation: "0".to_string(),
            estimated_apc: "2.01".to_string(),
            pending_withdrawal_capacity: "0".to_string(),
            deposit_change_24h: Some("-1.00000000".to_string()),
            depositors_change_24h: Some(-1),
        };

        let state = map_dao_state(
            statistics,
            ChainAnchor {
                block: 100,
                hash: "0xblock100".to_string(),
            },
        )
        .unwrap();

        assert!(state.is_none());
    }

    #[test]
    fn fork_watch_maps_an_active_deep_fork_as_fixed_context() {
        let watch = active_deep_watch();

        let record = map_fork_watch(
            watch,
            ChainAnchor {
                block: 100,
                hash: format!("0x{}", "33".repeat(32)),
            },
        )
        .unwrap()
        .unwrap();

        assert_eq!(record.recent_reorg.unwrap().kind, ForkWatchEventKind::Deep);
        assert_eq!(record.deep_fork.unwrap().indexed_tip, 99);
    }

    #[test]
    fn active_deep_fork_uses_direct_canonical_tip_proof() {
        let mut canonical = context();
        canonical.recent_blocks[0].hash = format!("0x{}", "33".repeat(32));

        let anchor = deep_fork_canonical_anchor(&active_deep_watch(), &canonical)
            .unwrap()
            .unwrap();
        assert_eq!(anchor.block, 100);
        assert_eq!(anchor.hash, canonical.recent_blocks[0].hash);

        canonical.recent_blocks[0].hash = format!("0x{}", "44".repeat(32));
        assert!(deep_fork_canonical_anchor(&active_deep_watch(), &canonical)
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn active_deep_fork_does_not_require_a_compatible_index_anchor() {
        let app = Router::new().route(
            "/api/v1/forks/recent",
            get(|| async {
                Json(serde_json::json!({
                    "hasRecentReorg": true,
                    "reorg": {
                        "id": 1_700_000_000_000_i64,
                        "forkPointNumber": 97,
                        "forkPointHash": format!("0x{}", "11".repeat(32)),
                        "oldTipNumber": 102,
                        "oldTipHash": format!("0x{}", "22".repeat(32)),
                        "newTipNumber": 100,
                        "newTipHash": format!("0x{}", "33".repeat(32)),
                        "depth": 5,
                        "orphanedBlocksCount": 0,
                        "orphanedTxsCount": 0,
                        "eventType": "deep"
                    },
                    "recentWindowSeconds": 86400,
                    "deepFork": {
                        "detected": true,
                        "dbTip": 102,
                        "dbTipHash": format!("0x{}", "22".repeat(32)),
                        "chainTip": 100,
                        "chainTipHash": format!("0x{}", "33".repeat(32)),
                        "depth": 5,
                        "forkPoint": 97
                    }
                }))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let source =
            CkbadgerEnrichmentSource::new(Url::parse(&format!("http://{address}/api/v1")).unwrap())
                .unwrap();
        let mut canonical = context();
        canonical.recent_blocks[0].hash = format!("0x{}", "33".repeat(32));

        let record = source.enrich_fork_watch(&canonical).await.unwrap().unwrap();

        assert_eq!(record.as_of.block, 100);
        assert_eq!(record.deep_fork.unwrap().indexed_tip, 102);
        server.abort();
    }

    #[test]
    fn fork_watch_waits_when_a_recent_event_is_ahead_of_its_anchor() {
        let watch = RecentReorgResponse {
            has_recent_reorg: true,
            reorg: Some(ReorgEventResponse {
                id: 1_700_000_000_000,
                fork_point_number: 99,
                fork_point_hash: format!("0x{}", "11".repeat(32)),
                old_tip_number: 100,
                old_tip_hash: format!("0x{}", "22".repeat(32)),
                new_tip_number: 101,
                new_tip_hash: format!("0x{}", "33".repeat(32)),
                depth: 1,
                orphaned_blocks_count: 1,
                orphaned_txs_count: 3,
                event_type: "reorg".to_string(),
            }),
            recent_window_seconds: 86_400,
            deep_fork: crate::dto::DeepForkStatusResponse {
                detected: false,
                db_tip: None,
                db_tip_hash: None,
                chain_tip: None,
                chain_tip_hash: None,
                depth: None,
                fork_point: None,
            },
        };

        let record = map_fork_watch(
            watch,
            ChainAnchor {
                block: 100,
                hash: "0xblock100".to_string(),
            },
        )
        .unwrap();

        assert!(record.is_none());
    }

    #[test]
    fn activity_feed_filters_only_the_unanchored_leading_prefix() {
        fn transfer(block: i64, byte: &str) -> LatestActivityResponse {
            LatestActivityResponse {
                tx_hash: format!("0x{}", byte.repeat(32)),
                block_number: block,
                timestamp: "1700000000000".to_string(),
                is_cellbase: false,
                protocol_actions: Vec::new(),
                type_calls: Vec::new(),
                lock_calls: Vec::new(),
                participants: Vec::new(),
            }
        }

        let feed = map_activity_feed(
            vec![transfer(101, "11"), transfer(100, "22")],
            ChainAnchor {
                block: 100,
                hash: "0xblock100".to_string(),
            },
        )
        .unwrap();

        assert_eq!(feed.activities.len(), 1);
        assert_eq!(feed.activities[0].block, 100);
        assert_eq!(feed.activities[0].tx_hash, format!("0x{}", "22".repeat(32)));
    }

    /// A CKB peer id is a multihash the RPC prints in base58; the crawler
    /// stores the bytes. The vector is BUILT here rather than pasted, so the
    /// test pins the conversion instead of pinning one lucky string.
    fn base58_peer_id(bytes: &[u8]) -> String {
        let mut encoded = [0_u8; 128];
        let length = bs58::encode(bytes)
            .onto(&mut encoded[..])
            .expect("encode peer id");
        String::from_utf8(encoded[..length].to_vec()).expect("base58 is ascii")
    }

    /// `0x12 0x20` + 32 bytes: the sha2-256 multihash every `Qm…` peer id on
    /// a live CKB network carries.
    fn sighted_peer_bytes() -> Vec<u8> {
        let mut bytes = vec![0x12, 0x20];
        bytes.extend((0..32).map(|index| 0xa0_u8 ^ index));
        bytes
    }

    fn broken_store_peer_bytes() -> Vec<u8> {
        let mut bytes = vec![0x12, 0x20];
        bytes.extend((0..32).map(|index| 0x50_u8 ^ index));
        bytes
    }

    /// A peer the network names and the crawler could never dial — the state
    /// most of the live candidate set is in, and the one a NAT'd node cknerv
    /// holds an inbound link to is in.
    fn advertised_peer_bytes() -> Vec<u8> {
        let mut bytes = vec![0x12, 0x20];
        bytes.extend((0..32).map(|index| 0x30_u8 ^ index));
        bytes
    }

    async fn spawn_peer_dossier_api() -> (Url, tokio::task::JoinHandle<()>, Arc<AtomicUsize>) {
        let node_requests = Arc::new(AtomicUsize::new(0));
        let counted_requests = node_requests.clone();
        let sighted = peer_id_to_hex(&base58_peer_id(&sighted_peer_bytes())).unwrap();
        let broken = peer_id_to_hex(&base58_peer_id(&broken_store_peer_bytes())).unwrap();
        let advertised = peer_id_to_hex(&base58_peer_id(&advertised_peer_bytes())).unwrap();
        let app = Router::new()
            .route(
                "/api/v1/statistics/network",
                get(|| async {
                    Json(serde_json::json!({
                        "syncStatus": {
                            "isSyncing": false,
                            "syncedBlock": 100
                        }
                    }))
                }),
            )
            .route(
                "/api/v1/blocks/:number",
                get(|| async {
                    Json(serde_json::json!({
                        "number": 100,
                        "hash": "0xblock100"
                    }))
                }),
            )
            .route(
                "/api/v1/network/peers/:peer_id",
                get(
                    move |axum::extract::Path(peer_id): axum::extract::Path<String>| {
                        let node_requests = counted_requests.clone();
                        let sighted = sighted.clone();
                        let broken = broken.clone();
                        let advertised = advertised.clone();
                        async move {
                            node_requests.fetch_add(1, Ordering::Relaxed);
                            if peer_id == broken {
                                return (
                                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                                    Json(serde_json::json!({ "error": "store" })),
                                );
                            }
                            // The live shape of a peer nobody could dial:
                            // real aliases, real advertisers, a typed reason
                            // per address tried — and `verified: null`.
                            if peer_id == advertised {
                                return (
                                    axum::http::StatusCode::OK,
                                    Json(serde_json::json!({
                                        "peerId": peer_id,
                                        "observationVantage": "thisCkbadgerInstance",
                                        "displayState": "advertisedUnverified",
                                        "firstDiscoveredAt": 1_699_990_000,
                                        "lastAdvertisedAt": 1_700_000_000,
                                        "aliases": [{
                                            "address": "/ip4/198.51.100.4/tcp/8115",
                                            "firstAdvertisedAt": 1_699_990_000,
                                            "lastAdvertisedAt": 1_700_000_000
                                        }],
                                        "lastCompleted": {
                                            "roundId": 2,
                                            "outcome": "exhausted",
                                            "observations": [
                                                {
                                                    "address": "/ip4/198.51.100.4/tcp/8115",
                                                    "roundId": 2,
                                                    "observedAt": 1_699_999_900,
                                                    "elapsedMs": 231,
                                                    "result": "dialRequestFailed"
                                                },
                                                {
                                                    "address": "/ip4/198.51.100.5/tcp/8115",
                                                    "roundId": 2,
                                                    "observedAt": 1_699_999_910,
                                                    "elapsedMs": 4000,
                                                    "result": "noAuthenticatedSessionBeforeDeadline"
                                                }
                                            ],
                                            "consecutiveExhaustedRounds": 2
                                        },
                                        "active": null,
                                        "verified": null,
                                        "advertisers": [
                                            {
                                                "advertiserPeerId": "1220aa",
                                                "observedAt": 1_700_000_000
                                            },
                                            {
                                                "advertiserPeerId": "1220ab",
                                                "observedAt": 1_700_000_001
                                            }
                                        ]
                                    })),
                                );
                            }
                            if peer_id != sighted {
                                return (
                                    axum::http::StatusCode::NOT_FOUND,
                                    Json(serde_json::json!({ "error": "not_found" })),
                                );
                            }
                            (
                                axum::http::StatusCode::OK,
                                Json(serde_json::json!({
                                    "peerId": peer_id,
                                    "observationVantage": "thisCkbadgerInstance",
                                    "displayState": "reachable",
                                    "firstDiscoveredAt": 1_650_000_000,
                                    "lastAdvertisedAt": 1_700_000_000,
                                    "aliases": [{
                                        "address": "/ip4/203.0.113.7/tcp/8115",
                                        "firstAdvertisedAt": 1_650_000_000,
                                        "lastAdvertisedAt": 1_700_000_000
                                    }],
                                    "lastCompleted": {
                                        "roundId": 2,
                                        "outcome": "sameNetworkIdentified",
                                        "observations": [{
                                            "address": "/ip4/203.0.113.7/tcp/8115",
                                            "roundId": 2,
                                            "observedAt": 1_700_000_000,
                                            "elapsedMs": 41,
                                            "result": "sameNetworkIdentified"
                                        }],
                                        "consecutiveExhaustedRounds": 0
                                    },
                                    "active": null,
                                    "verified": {
                                        "ownAddrs": ["/ip4/203.0.113.7/tcp/8115"],
                                        "clientVersion": "0.209.0 (d166e28 2026-07-29)",
                                        "flags": 3,
                                        "protocols": ["/ckb/syn", "/ckb/relay"],
                                        "firstSeen": 1_650_000_000,
                                        "lastSeen": 1_700_000_000,
                                        "lastReachableAt": 1_699_999_000,
                                        "country": "DE",
                                        "asn": "AS24940 Hetzner",
                                        "rttMs": 41,
                                        "discovery": {
                                            "validNodesMessages": 1,
                                            "malformedMessages": 0,
                                            "unexpectedMessages": 0,
                                            "normalizedAdvertisedAddresses": 87,
                                            "rejectedAdvertisedAddresses": 0
                                        }
                                    },
                                    "advertisers": [
                                        {
                                            "advertiserPeerId": "1220bb",
                                            "observedAt": 1_700_000_000
                                        },
                                        {
                                            "advertiserPeerId": "1220bc",
                                            "observedAt": 1_700_000_001
                                        },
                                        {
                                            "advertiserPeerId": "1220bd",
                                            "observedAt": 1_700_000_002
                                        }
                                    ]
                                })),
                            )
                        }
                    },
                ),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (
            Url::parse(&format!("http://{address}/api/v1")).unwrap(),
            handle,
            node_requests,
        )
    }

    #[test]
    fn a_base58_peer_id_becomes_the_crawlers_hex_key() {
        let bytes = sighted_peer_bytes();
        let expected: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();

        let node_id = base58_peer_id(&bytes);

        // The shape a live `get_peers` answer carries, not just any base58.
        assert!(node_id.starts_with("Qm"), "node id was {node_id}");
        assert_eq!(peer_id_to_hex(&node_id), Some(expected));
    }

    #[test]
    fn an_id_that_is_not_a_peer_id_has_no_crawler_key() {
        // Base58 has no `0`, `O`, `I` or `l`; an address, an empty segment
        // and an oversized one are all not peer ids either.
        assert_eq!(peer_id_to_hex("QmO0Il"), None);
        assert_eq!(peer_id_to_hex(""), None);
        assert_eq!(
            peer_id_to_hex(&"Q".repeat(MAX_PEER_ID_BASE58_CHARS + 1)),
            None
        );
        assert_eq!(peer_id_to_hex("/ip4/127.0.0.1/tcp/8115"), None);
    }

    #[tokio::test]
    async fn a_peer_sighting_carries_the_crawlers_clock_in_milliseconds() {
        let (api_base, server, _) = spawn_peer_dossier_api().await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();
        assert_eq!(
            source.probe(&context()).await.status,
            EnrichmentSourceState::Ready
        );
        let node_id = base58_peer_id(&sighted_peer_bytes());

        let lookup = source.enrich_peer(&node_id, &context()).await.unwrap();

        let PeerSightingLookup::Sighted { sighting } = lookup else {
            panic!("expected a sighting, got {lookup:?}");
        };
        // The id the browser holds comes back, not the crawler's hex key.
        assert_eq!(sighting.node_id, node_id);
        assert_eq!(sighting.source, "ckbadger");
        assert_eq!(sighting.as_of.block, 100);
        assert_eq!(sighting.country, "DE");
        assert_eq!(sighting.asn, "AS24940 Hetzner");
        assert_eq!(sighting.client_version, "0.209.0 (d166e28 2026-07-29)");
        assert_eq!(sighting.protocols, vec!["/ckb/syn", "/ckb/relay"]);
        // Unix SECONDS upstream, milliseconds on cknerv's wire.
        assert_eq!(sighting.first_seen_ms, 1_650_000_000_000);
        assert_eq!(sighting.last_seen_ms, 1_700_000_000_000);
        assert_eq!(sighting.last_reachable_at_ms, Some(1_699_999_000_000));
        assert!(sighting.reachable);
        assert_eq!(sighting.rtt_ms, Some(41));
        // Both directions of the address book, each off its own field. The
        // slot that held one number for both is gone, and the two that
        // replaced it cannot be swapped without saying something false: three
        // peers named this node, and this node gossiped eighty-seven
        // ADDRESSES. The mock's two figures are far apart on purpose — if the
        // mapper read `discovery` into the inbound count nothing about the
        // shape of the record would look wrong.
        assert_eq!(sighting.advertiser_peer_count, Some(3));
        assert_eq!(sighting.advertised_address_count, Some(87));
        server.abort();
    }

    #[tokio::test]
    async fn a_peer_the_network_names_and_nobody_could_dial_is_its_own_report() {
        // The case that used to be a decode failure and then a lie: upstream
        // nests its verified observation inside the candidate, and answers
        // `verified: null` for every peer it could not authenticate. Most of
        // the live candidate set is in that state, and a peer cknerv holds an
        // inbound link to can be one of them, because a node behind NAT dials
        // out and cannot be dialed back.
        let (api_base, server, node_requests) = spawn_peer_dossier_api().await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();
        assert_eq!(
            source.probe(&context()).await.status,
            EnrichmentSourceState::Ready
        );
        let node_id = base58_peer_id(&advertised_peer_bytes());

        let lookup = source.enrich_peer(&node_id, &context()).await.unwrap();

        let PeerSightingLookup::Unsighted { reason, advertised } = lookup else {
            panic!("a peer with no verification is not a sighting");
        };
        // Not `NeverSighted`: the crawler holds this peer's addresses and
        // dialed them. Different fact, different word.
        assert_eq!(reason, PeerSightingAbsence::AdvertisedUnverified);
        let evidence = advertised.expect("the absence with evidence carries it");
        // Two addresses were tried and the furthest of them got a session
        // attempt rather than a refused dial. Taking the list's last entry
        // would have been the same answer by luck; taking its first would
        // have been the wrong one.
        assert_eq!(
            evidence.furthest_result,
            Some(PeerProbeResult::NoAuthenticatedSessionBeforeDeadline)
        );
        assert_eq!(evidence.consecutive_exhausted_rounds, 2);
        // The rung has somewhere it happened, and it is the address of the
        // dial that got furthest rather than of the one listed first — which
        // is a different address here, so an implementation that took the
        // list's head would name the refused one under the session sentence.
        assert_eq!(
            evidence.furthest_address.as_deref(),
            Some("/ip4/198.51.100.5/tcp/8115")
        );
        // …out of the two the round actually dialed. One refusal out of one
        // is a dead address; one out of two is a node not answering anywhere.
        assert_eq!(evidence.dialed_address_count, 2);
        // The only weight this rung has: how much of the network still
        // repeats the address. Fewer than name the sighted peer, as it is
        // live.
        assert_eq!(evidence.advertiser_peer_count, Some(2));
        // Unix SECONDS upstream, milliseconds on cknerv's wire — the one
        // clock an unverified peer's report can be dated by.
        assert_eq!(evidence.last_advertised_at_ms, 1_700_000_000_000);
        assert_eq!(node_requests.load(Ordering::Relaxed), 1);
        server.abort();
    }

    #[tokio::test]
    async fn a_node_the_crawler_never_saw_is_answered_not_refused() {
        let (api_base, server, node_requests) = spawn_peer_dossier_api().await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();
        assert_eq!(
            source.probe(&context()).await.status,
            EnrichmentSourceState::Ready
        );
        let unseen = base58_peer_id(&[0x12, 0x20, 0x77, 0x77]);

        let lookup = source.enrich_peer(&unseen, &context()).await.unwrap();

        // Upstream 404 is the crawler's own report — it was asked, and it
        // has never seen this node from outside.
        assert_eq!(
            lookup,
            PeerSightingLookup::unsighted(PeerSightingAbsence::NeverSighted)
        );
        assert_eq!(node_requests.load(Ordering::Relaxed), 1);
        server.abort();
    }

    /// A source whose crawler is alive and whose peer routes this build no
    /// longer knows the name of — the exact break that has now happened
    /// twice, from cknerv's side of it.
    async fn spawn_renamed_peer_api() -> (Url, tokio::task::JoinHandle<()>) {
        let app = Router::new()
            .route(
                "/api/v1/statistics/network",
                get(|| async {
                    Json(serde_json::json!({
                        "syncStatus": { "isSyncing": false, "syncedBlock": 100 }
                    }))
                }),
            )
            .route(
                "/api/v1/blocks/:number",
                get(|| async { Json(serde_json::json!({ "number": 100, "hash": "0xblock100" })) }),
            )
            // The crawler itself is fine and says so.
            .route(
                "/api/v1/network/summary",
                get(|| async {
                    Json(serde_json::json!({
                        "enabled": true,
                        "hasData": true,
                        "lastRound": {
                            "roundId": 7,
                            "startedAt": 1_699_999_990,
                            "finishedAt": 1_700_000_000,
                            "candidatePeers": 61,
                            "reachablePeers": 9,
                            "exhaustedCandidates": 51,
                            "foreignPeers": 1,
                            "verifiedUnavailablePeers": 33,
                            "verifiedRetainedPeers": 42,
                            "newVerifiedPeers": 3,
                            "addressAttempts": 90,
                            "addressObservations": {
                                "dialRequestFailed": 20,
                                "noAuthenticatedSessionBeforeDeadline": 45,
                                "authenticatedSessionWithoutIdentifyBeforeDeadline": 8,
                                "malformedIdentify": 4,
                                "foreignNetwork": 4,
                                "sameNetworkIdentified": 9
                            }
                        },
                        "activeRound": null
                    }))
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (
            Url::parse(&format!("http://{address}/api/v1")).unwrap(),
            handle,
        )
    }

    #[tokio::test]
    async fn a_peer_route_this_build_cannot_find_is_a_fault_and_never_a_verdict_on_a_node() {
        // The worst thing this adapter has ever printed: upstream renamed the
        // peer routes, every point lookup answered 404, and the DOSSIER told
        // the pilot that every peer on the dashboard had never been seen from
        // outside. A blank would have been honest. That line asserted
        // something false, on the one plate whose whole discipline is that
        // different true statements are never blurred.
        //
        // The list route is what separates the two readings of a 404, and it
        // costs no request: the roster refresh already asks it every 60s. The
        // atlas used to be the one asking — it reads a census now and never
        // touches the peer page, so the roster is the whole of that health
        // signal and this test asks it the way the supervisor does.
        let (api_base, server) = spawn_renamed_peer_api().await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();
        assert_eq!(
            source.probe(&context()).await.status,
            EnrichmentSourceState::Ready
        );

        // Before the list route has been looked at, there is nothing to doubt
        // and the crawler's own 404 is taken at its word. This is the window
        // the refresh cadence closes, and it is deliberate: refusing to
        // answer for the first minute of a process would trade a false
        // statement for a false alarm.
        let unseen = base58_peer_id(&[0x12, 0x20, 0x77, 0x77]);
        assert_eq!(
            source.enrich_peer(&unseen, &context()).await.unwrap(),
            PeerSightingLookup::unsighted(PeerSightingAbsence::NeverSighted)
        );

        // The atlas fails against this source too — its census route is gone
        // by the same rename — and that failure must teach the dossier
        // NOTHING. Only a reader of `network/peers` can separate the two
        // readings of a point-lookup 404, so the flag has exactly one writer,
        // and a peer asked after an atlas fault still gets the crawler's own
        // verdict rather than a fault borrowed from a different route.
        let atlas_error = source
            .enrich_network_atlas(&context())
            .await
            .unwrap_err()
            .to_string();
        assert!(atlas_error.contains("HTTP 404"), "{atlas_error}");
        assert_eq!(
            source.enrich_peer(&unseen, &context()).await.unwrap(),
            PeerSightingLookup::unsighted(PeerSightingAbsence::NeverSighted)
        );

        // One roster refresh is all it takes to learn the peer route is gone.
        let roster_error = source
            .enrich_network_roster(&context())
            .await
            .unwrap_err()
            .to_string();
        assert!(roster_error.contains("HTTP 404"), "{roster_error}");

        // And now the same 404 is a fault about this build, not a verdict on
        // the node. Delete the health check in `enrich_peer` and this comes
        // back `NeverSighted` — the lie, restored.
        let error = source
            .enrich_peer(&unseen, &context())
            .await
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("peer list route is not answering"),
            "error was {error}"
        );
        server.abort();
    }

    #[tokio::test]
    async fn an_unreadable_node_id_is_never_put_to_the_source() {
        let (api_base, server, node_requests) = spawn_peer_dossier_api().await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();
        assert_eq!(
            source.probe(&context()).await.status,
            EnrichmentSourceState::Ready
        );

        let lookup = source
            .enrich_peer("not-a-peer-id-0OIl", &context())
            .await
            .unwrap();

        assert_eq!(
            lookup,
            PeerSightingLookup::unsighted(PeerSightingAbsence::UnreadableNodeId)
        );
        assert_eq!(node_requests.load(Ordering::Relaxed), 0);
        server.abort();
    }

    #[tokio::test]
    async fn a_broken_network_store_is_an_error_not_an_absence() {
        let (api_base, server, _) = spawn_peer_dossier_api().await;
        let source = CkbadgerEnrichmentSource::new(api_base).unwrap();
        assert_eq!(
            source.probe(&context()).await.status,
            EnrichmentSourceState::Ready
        );
        let node_id = base58_peer_id(&broken_store_peer_bytes());

        let error = source
            .enrich_peer(&node_id, &context())
            .await
            .unwrap_err()
            .to_string();

        assert!(error.contains("HTTP 500"), "error was {error}");
        server.abort();
    }

    fn peer_anchor() -> ChainAnchor {
        ChainAnchor {
            block: 100,
            hash: "0xblock100".to_string(),
        }
    }

    /// The crawler's verified half, as it arrives nested inside the
    /// candidate. Every clock is a unix SECOND here, as upstream counts them.
    fn verified_peer() -> VerifiedPeerResponse {
        VerifiedPeerResponse {
            client_version: "0.209.0".to_string(),
            protocols: Vec::new(),
            first_seen: 1_650_000_000,
            last_seen: 1_700_000_000,
            last_reachable_at: 0,
            country: String::new(),
            asn: String::new(),
            rtt_ms: None,
            discovery: None,
        }
    }

    fn peer_detail(peer_id: &str, verified: Option<VerifiedPeerResponse>) -> PeerDetailResponse {
        PeerDetailResponse {
            peer_id: peer_id.to_string(),
            display_state: if verified.is_some() {
                PeerDisplayState::Reachable
            } else {
                PeerDisplayState::AdvertisedUnverified
            },
            last_advertised_at: 1_700_000_000,
            last_completed: None,
            verified,
            advertisers: None,
        }
    }

    #[test]
    fn a_sighting_of_a_different_node_is_refused() {
        let error = map_peer_lookup(
            "QmWhoever",
            "1220ee",
            peer_detail("1220ff", Some(verified_peer())),
            peer_anchor(),
        )
        .unwrap_err()
        .to_string();

        assert!(
            error.contains("different network node"),
            "error was {error}"
        );
    }

    #[test]
    fn a_node_never_dialed_has_no_reachable_moment_and_empty_labels_stay_unknown() {
        let mut verified = verified_peer();
        verified.client_version = String::new();
        verified.country = "  ".to_string();

        let lookup = map_peer_lookup(
            "QmWhoever",
            "1220EE",
            peer_detail("1220ee", Some(verified)),
            peer_anchor(),
        )
        .unwrap();

        let PeerSightingLookup::Sighted { sighting } = lookup else {
            panic!("a peer with a verification is a sighting");
        };
        // Zero is the crawler's "never", and 1970 is not a reachable moment.
        assert_eq!(sighting.last_reachable_at_ms, None);
        assert_eq!(sighting.country, "Unknown");
        assert_eq!(sighting.asn, "Unknown");
        assert_eq!(sighting.client_version, "Unknown");
    }

    #[test]
    fn a_sighting_without_a_clock_is_not_a_sighting() {
        let mut verified = verified_peer();
        verified.first_seen = 0;
        verified.last_seen = 0;

        let error = map_peer_lookup(
            "QmWhoever",
            "1220ee",
            peer_detail("1220ee", Some(verified)),
            peer_anchor(),
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("firstSeen"), "error was {error}");
    }

    #[test]
    fn a_peer_the_crawler_holds_but_did_not_reach_this_round_stages_dark() {
        // `verifiedUnavailable` is the crawler's own word for a peer it
        // reached before and could not reach this round, and it is exactly
        // what `reachable: false` has always meant on this record. It is not
        // an absence: the sighting is real, it is just not fresh.
        let mut detail = peer_detail("1220ee", Some(verified_peer()));
        detail.display_state = PeerDisplayState::VerifiedUnavailable;

        let lookup = map_peer_lookup("QmWhoever", "1220ee", detail, peer_anchor()).unwrap();

        let PeerSightingLookup::Sighted { sighting } = lookup else {
            panic!("a peer with a verification is a sighting");
        };
        assert!(!sighting.reachable);
    }

    #[test]
    fn a_peer_no_completed_round_has_touched_says_so_rather_than_naming_a_reason() {
        // A third statement again, and the reason it is `Option` rather than
        // a seventh rung: the network has named this peer and no finished
        // round has tried it. Inventing "the dial failed" here would be the
        // same class of lie this whole task exists to remove.
        let mut detail = peer_detail("1220ee", None);
        detail.display_state = PeerDisplayState::NoCompletedObservation;

        let lookup = map_peer_lookup("QmWhoever", "1220ee", detail, peer_anchor()).unwrap();

        assert_eq!(
            lookup,
            PeerSightingLookup::advertised_unverified(PeerAdvertisedEvidence {
                last_advertised_at_ms: 1_700_000_000_000,
                furthest_result: None,
                furthest_address: None,
                dialed_address_count: 0,
                consecutive_exhausted_rounds: 0,
                advertiser_peer_count: None,
            })
        );
    }

    #[test]
    fn the_furthest_dial_is_the_answer_and_a_word_this_build_lacks_never_wins() {
        // A candidate is dialed once per advertised address, so there is no
        // single result — there is a handful, in whatever order upstream
        // wrote them. The furthest is the only summary an operator can act
        // on, and a result this build cannot name must never displace one it
        // can.
        let observations = [
            "authenticatedSessionWithoutIdentifyBeforeDeadline",
            "quantumTunnelled",
            "dialRequestFailed",
        ];
        let completed: CandidateEvidenceResponse = serde_json::from_value(serde_json::json!({
            "roundId": 4,
            "outcome": "exhausted",
            "observations": observations.iter().map(|result| serde_json::json!({
                "address": "/ip4/198.51.100.4/tcp/8115",
                "roundId": 4,
                "observedAt": 1_699_999_900,
                "elapsedMs": 12,
                "result": result,
            })).collect::<Vec<_>>(),
            "consecutiveExhaustedRounds": 9,
        }))
        .expect("a result this build has no name for must not fail the dossier");

        let evidence = map_advertised_evidence(1_700_000_000, Some(&completed), None).unwrap();

        assert_eq!(
            evidence.furthest_result,
            Some(PeerProbeResult::AuthenticatedSessionWithoutIdentifyBeforeDeadline)
        );
        assert_eq!(evidence.consecutive_exhausted_rounds, 9);

        // And when every observation is a word this build lacks, the report
        // says that rather than picking a reason out of the air.
        let all_unknown: CandidateEvidenceResponse = serde_json::from_value(serde_json::json!({
            "observations": [{ "result": "quantumTunnelled" }],
            "consecutiveExhaustedRounds": 1,
        }))
        .expect("decode");
        assert_eq!(
            map_advertised_evidence(1_700_000_000, Some(&all_unknown), None)
                .unwrap()
                .furthest_result,
            Some(PeerProbeResult::Unknown)
        );
    }

    #[test]
    fn the_two_directions_of_the_address_book_cannot_be_swapped() {
        // The row this replaces printed ONE number for a relationship that has
        // two ends, and upstream deleted it for exactly that. What arrives now
        // is a count of PEERS that named this node and a count of ADDRESSES it
        // named, and they are not the same population at any ratio — live, a
        // peer gossips thousands of addresses belonging to a hundred-odd
        // peers. So the mapper is asserted on where each lands, with figures
        // far enough apart that reading one field into the other could not
        // pass for a plausible record.
        let detail: PeerDetailResponse = serde_json::from_value(serde_json::json!({
            "peerId": "1220ee",
            "displayState": "reachable",
            "lastAdvertisedAt": 1_700_000_000,
            "verified": {
                "clientVersion": "0.209.0",
                "protocols": [],
                "firstSeen": 1_650_000_000,
                "lastSeen": 1_700_000_000,
                "lastReachableAt": 1_699_999_000,
                "country": "DE",
                "asn": "AS24940 Hetzner",
                "rttMs": 41,
                "discovery": {
                    "validNodesMessages": 1,
                    "malformedMessages": 0,
                    "unexpectedMessages": 0,
                    "normalizedAdvertisedAddresses": 5_727,
                    "rejectedAdvertisedAddresses": 0
                }
            },
            "advertisers": [
                { "advertiserPeerId": "1220aa", "observedAt": 1_700_000_000 },
                { "advertiserPeerId": "1220ab", "observedAt": 1_700_000_000 }
            ]
        }))
        .expect("decode");

        let PeerSightingLookup::Sighted { sighting } =
            map_peer_lookup("QmWhoever", "1220ee", detail, peer_anchor()).unwrap()
        else {
            panic!("a peer with a verification is a sighting");
        };

        assert_eq!(sighting.advertiser_peer_count, Some(2));
        assert_eq!(sighting.advertised_address_count, Some(5_727));
    }

    #[test]
    fn a_list_nobody_sent_is_not_a_count_of_zero() {
        // The count IS the fact here, so absent and empty have to stay apart:
        // "nobody can say how many peers name this node" and "no peer names
        // this node" are different reports, and the second one over a peer the
        // crawler is dialing every round would be the same class of confident
        // falsehood the dossier was repaired for. This is why the field is an
        // `Option<Vec<_>>` where every other list on the route defaults.
        let without: PeerDetailResponse = serde_json::from_value(serde_json::json!({
            "peerId": "1220ee",
            "displayState": "advertisedUnverified",
            "lastAdvertisedAt": 1_700_000_000,
            "verified": null
        }))
        .expect("decode");
        let PeerSightingLookup::Unsighted { advertised, .. } =
            map_peer_lookup("QmWhoever", "1220ee", without, peer_anchor()).unwrap()
        else {
            panic!("a peer with no verification is not a sighting");
        };
        assert_eq!(
            advertised.expect("evidence").advertiser_peer_count,
            None,
            "a wire that stops sending advertisers must stand the row down"
        );

        let empty: PeerDetailResponse = serde_json::from_value(serde_json::json!({
            "peerId": "1220ee",
            "displayState": "advertisedUnverified",
            "lastAdvertisedAt": 1_700_000_000,
            "verified": null,
            "advertisers": []
        }))
        .expect("decode");
        let PeerSightingLookup::Unsighted { advertised, .. } =
            map_peer_lookup("QmWhoever", "1220ee", empty, peer_anchor()).unwrap()
        else {
            panic!("a peer with no verification is not a sighting");
        };
        assert_eq!(
            advertised.expect("evidence").advertiser_peer_count,
            Some(0),
            "a crawler that answers with an empty list has said zero, and zero is a report"
        );

        // The same discipline one level in: a verification with no discovery
        // counters says nothing about the outbound direction rather than
        // saying the peer gossiped nothing.
        let mut quiet = peer_detail("1220ee", Some(verified_peer()));
        quiet.advertisers = Some(Vec::new());
        let PeerSightingLookup::Sighted { sighting } =
            map_peer_lookup("QmWhoever", "1220ee", quiet, peer_anchor()).unwrap()
        else {
            panic!("a peer with a verification is a sighting");
        };
        assert_eq!(sighting.advertised_address_count, None);
    }

    #[test]
    fn an_advertiser_row_this_build_cannot_read_still_counts() {
        // Only the LENGTH of this list is read, and the ids behind it are the
        // first real edge evidence the colony has ever held — which is a spec
        // of its own and not this one. Parsing the rows as nothing keeps a
        // reshape of the entry from costing the whole dossier, and the test is
        // here because the cheap alternative (a declared `advertiserPeerId`)
        // would have looked identical until the day upstream renamed it.
        let detail: PeerDetailResponse = serde_json::from_value(serde_json::json!({
            "peerId": "1220ee",
            "displayState": "advertisedUnverified",
            "lastAdvertisedAt": 1_700_000_000,
            "verified": null,
            "advertisers": [
                { "advertiserPeerId": "1220aa", "observedAt": 1_700_000_000 },
                { "seenBy": "1220ab", "firstHeardAt": 1_700_000_000, "hops": 2 },
                17
            ]
        }))
        .expect("a reshaped advertiser row must not fail the dossier");

        let PeerSightingLookup::Unsighted { advertised, .. } =
            map_peer_lookup("QmWhoever", "1220ee", detail, peer_anchor()).unwrap()
        else {
            panic!("a peer with no verification is not a sighting");
        };
        assert_eq!(advertised.expect("evidence").advertiser_peer_count, Some(3));
    }

    #[test]
    fn a_rung_with_no_address_does_not_happen_at_a_place_called_unknown() {
        // `bounded_network_text` answers `"Unknown"` for an empty label, which
        // is right for a country the crawler could not resolve and false for
        // an address: the dial still happened, and it did not happen there.
        // The count is a fact either way, so the row states that alone rather
        // than naming a place nobody dialed.
        let completed: CandidateEvidenceResponse = serde_json::from_value(serde_json::json!({
            "observations": [{ "result": "dialRequestFailed" }],
            "consecutiveExhaustedRounds": 1,
        }))
        .expect("decode");

        let evidence = map_advertised_evidence(1_700_000_000, Some(&completed), None).unwrap();

        assert_eq!(
            evidence.furthest_result,
            Some(PeerProbeResult::DialRequestFailed)
        );
        assert_eq!(evidence.furthest_address, None);
        assert_eq!(evidence.dialed_address_count, 1);
    }

    #[test]
    fn an_undated_advertisement_is_not_a_report() {
        // Every CRAWLER-class line the DOSSIER prints has to be stamped, and
        // this is the only clock an unverified peer has. Zero is upstream's
        // "never", and 1970 is not a moment the network named anything.
        let error = map_advertised_evidence(0, None, None)
            .unwrap_err()
            .to_string();

        assert!(error.contains("lastAdvertisedAt"), "error was {error}");
    }
}
