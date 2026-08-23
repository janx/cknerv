//! Independent scheduling for bounded optional-enrichment refreshes.
//!
//! Source probes stay on their own cadence while aggregate capabilities run
//! with bounded concurrency. A slow or failing aggregate therefore cannot
//! delay source health or another due capability, and a capability never has
//! more than one request in flight.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::{mpsc, watch, Semaphore};
use tokio::task::{JoinHandle, JoinSet};

use cknerv_core::projection::display_plane::DISPLAY_CURATED_FIELD;
use cknerv_core::{
    CompositionDemand, EnrichmentEvent, EnrichmentSourceState, EnrichmentSourceStatus,
    GalaxyCompositionTarget,
};

use crate::composition_store::CompositionStore;
use crate::enrichment::{CanonicalContext, EnrichmentSource};
use crate::state::ServerState;

const ENRICHMENT_PROBE_INTERVAL: Duration = Duration::from_secs(5);
const ENRICHMENT_STATUS_REFRESH: Duration = Duration::from_secs(60);
const ENRICHMENT_ECOSYSTEM_REFRESH: Duration = Duration::from_secs(30);
const ENRICHMENT_DAO_STATE_REFRESH: Duration = Duration::from_secs(60);
const ENRICHMENT_PROTOCOL_ERA_REFRESH: Duration = Duration::from_secs(5 * 60);
const ENRICHMENT_ACTIVITY_REFRESH: Duration = Duration::from_secs(15);
const ENRICHMENT_TRANSACTION_HORIZON_REFRESH: Duration = Duration::from_secs(60);
const ENRICHMENT_FORK_WATCH_REFRESH: Duration = Duration::from_secs(15);
const ENRICHMENT_NETWORK_ATLAS_REFRESH: Duration = Duration::from_secs(60);
/// The roster shares the atlas's clock because it shares the atlas's subject:
/// a crawl round is the only thing that can change either of them, and this
/// cadence only decides how soon a finished round is noticed. Repeating it
/// costs one bounded page and nothing on the wire — the projection publishes
/// a roster only when its round advances.
const ENRICHMENT_NETWORK_ROSTER_REFRESH: Duration = Duration::from_secs(60);
/// The whole-chain Cell census. Its source answers from a fixed-size record
/// in constant work, and its subject — the live-cell count — moves with every
/// block, so the cadence is set by how stale a printed `AS OF` height may get
/// rather than by the cost of asking.
const ENRICHMENT_CHAIN_CENSUS_REFRESH: Duration = Duration::from_secs(30);
/// Script names change when someone deploys a new script family, which is a
/// scale of hours. Five minutes is already far faster than the fact moves;
/// the reason to repeat at all is that the census keeps discovering
/// identities this galaxy had not seen yet.
const ENRICHMENT_SCRIPT_REGISTRY_REFRESH: Duration = Duration::from_secs(300);
/// The composition has NO cadence by default (design D7). It runs once
/// to staff the stage and then holds; drift is corrected by the top-up,
/// which costs churn rather than a whole re-derivation every period.
/// Setting this re-enables the old behaviour, whose meaning is now
/// narrower: a pure re-rank of the resting set against the current
/// index ordering.
const ENRICHMENT_GALAXY_COMPOSITION_REFRESH: Option<Duration> = None;
/// How long to wait before re-attempting a composition that has not
/// landed yet — and the grace period before an uncurated stage is read
/// as a degrade rather than as the gap between publishing the event and
/// the reducer applying it.
const ENRICHMENT_GALAXY_COMPOSITION_RETRY: Duration = Duration::from_secs(30);
/// The top-up cadence. Short, because each turn is bounded to a few
/// hundred candidates and the whole point is that a shortfall closes as
/// it opens rather than waiting out a period.
const ENRICHMENT_GALAXY_TOP_UP_REFRESH: Duration = Duration::from_secs(5);
/// Consecutive fruitless top-up rounds tolerated before the cadence starts
/// stretching. Sized to absorb the ordinary lag between dispatching a round
/// and the reducer applying its mutation, so a round in flight is never
/// mistaken for a round that achieved nothing.
const TOP_UP_STALL_GRACE: u32 = 3;
/// Ceiling on the doubling: 5s << 6 ≈ 5 minutes.
const TOP_UP_MAX_BACKOFF_SHIFT: u32 = 6;
/// Consecutive top-up rounds one burst may run back-to-back.
///
/// A stop, not a budget. Each round is bounded by the source to a few
/// hundred candidates per class, so sixty-four of them offer several times
/// the whole stage — far past any shortfall a boot or a degrade can open,
/// which is the margin. What the number is really for is the case where the
/// source keeps answering and the plane keeps declining: the burst has to
/// end on its own even when nothing tells it to.
const TOP_UP_BURST_MAX_ROUNDS: u32 = 64;

/// The shortfall above which the top-up stops waiting out its cadence.
///
/// Five percent of the typed quota. Below it lies ordinary drift — a
/// handful of deaths in a class — which the 5s cadence closes without
/// anyone noticing. Above it lies convergence, and there are exactly two
/// ways to get there: the residue a fresh composition leaves at boot, and
/// the climb back after a degrade dropped the stage to prefix staffing.
///
/// Both want the same treatment, which is why the trigger is the shortfall
/// and not how long the process has been up. Nothing about being young is
/// what makes hurrying right; a stage that degrades an hour in is in
/// exactly the position a booting one is, and a young process with a
/// well-staffed stage has nothing to hurry about.
fn top_up_burst_demand() -> usize {
    GalaxyCompositionTarget::for_total(DISPLAY_CURATED_FIELD).typed / 20
}

const MAX_CONCURRENT_REFRESHES: usize = 3;

#[derive(Clone, Copy)]
struct RefreshCadence {
    probe: Duration,
    status: Duration,
    ecosystem: Duration,
    dao_state: Duration,
    protocol_era: Duration,
    activity: Duration,
    transaction_horizon: Duration,
    fork_watch: Duration,
    network_atlas: Duration,
    network_roster: Duration,
    chain_census: Duration,
    script_registry: Duration,
    galaxy_composition: Option<Duration>,
    galaxy_composition_retry: Duration,
    galaxy_top_up: Duration,
    /// See [`top_up_burst_demand`].
    top_up_burst_demand: usize,
    /// See [`TOP_UP_BURST_MAX_ROUNDS`].
    top_up_burst_max_rounds: u32,
    max_concurrent: usize,
}

impl Default for RefreshCadence {
    fn default() -> Self {
        Self {
            probe: ENRICHMENT_PROBE_INTERVAL,
            status: ENRICHMENT_STATUS_REFRESH,
            ecosystem: ENRICHMENT_ECOSYSTEM_REFRESH,
            dao_state: ENRICHMENT_DAO_STATE_REFRESH,
            protocol_era: ENRICHMENT_PROTOCOL_ERA_REFRESH,
            activity: ENRICHMENT_ACTIVITY_REFRESH,
            transaction_horizon: ENRICHMENT_TRANSACTION_HORIZON_REFRESH,
            fork_watch: ENRICHMENT_FORK_WATCH_REFRESH,
            network_atlas: ENRICHMENT_NETWORK_ATLAS_REFRESH,
            network_roster: ENRICHMENT_NETWORK_ROSTER_REFRESH,
            chain_census: ENRICHMENT_CHAIN_CENSUS_REFRESH,
            script_registry: ENRICHMENT_SCRIPT_REGISTRY_REFRESH,
            galaxy_composition: ENRICHMENT_GALAXY_COMPOSITION_REFRESH,
            galaxy_composition_retry: ENRICHMENT_GALAXY_COMPOSITION_RETRY,
            galaxy_top_up: ENRICHMENT_GALAXY_TOP_UP_REFRESH,
            top_up_burst_demand: top_up_burst_demand(),
            top_up_burst_max_rounds: TOP_UP_BURST_MAX_ROUNDS,
            max_concurrent: MAX_CONCURRENT_REFRESHES,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum RefreshKind {
    AssetEcosystem,
    DaoState,
    ProtocolEra,
    ActivityFeed,
    TransactionHorizon,
    ForkWatch,
    NetworkAtlas,
    NetworkRoster,
    ChainCensus,
    ScriptRegistry,
    GalaxyComposition,
    GalaxyTopUp,
}

const REFRESH_KINDS: [RefreshKind; 12] = [
    RefreshKind::AssetEcosystem,
    RefreshKind::DaoState,
    RefreshKind::ProtocolEra,
    RefreshKind::ActivityFeed,
    RefreshKind::TransactionHorizon,
    RefreshKind::ForkWatch,
    RefreshKind::NetworkAtlas,
    RefreshKind::NetworkRoster,
    RefreshKind::ChainCensus,
    RefreshKind::ScriptRegistry,
    RefreshKind::GalaxyComposition,
    RefreshKind::GalaxyTopUp,
];

impl RefreshKind {
    fn capability(self) -> &'static str {
        match self {
            Self::AssetEcosystem => "asset_ecosystem",
            Self::DaoState => "dao_state",
            Self::ProtocolEra => "protocol_era",
            Self::ActivityFeed => "activity_feed",
            Self::TransactionHorizon => "transaction_horizon",
            Self::ForkWatch => "fork_watch",
            Self::NetworkAtlas => "network_atlas",
            Self::NetworkRoster => "network_roster",
            Self::ChainCensus => "chain_census",
            Self::ScriptRegistry => "script_registry",
            // The top-up is the same source feature as the composition:
            // a source that cannot compose cannot supply either.
            Self::GalaxyComposition | Self::GalaxyTopUp => "galaxy_composition",
        }
    }

    /// How often this capability repeats. `None` means "run once and
    /// hold" — only the composition does that, and only something
    /// external can make it due again (see
    /// [`RefreshTracker::rearm_composition_if_degraded`]).
    fn interval(self, cadence: RefreshCadence) -> Option<Duration> {
        match self {
            Self::AssetEcosystem => Some(cadence.ecosystem),
            Self::DaoState => Some(cadence.dao_state),
            Self::ProtocolEra => Some(cadence.protocol_era),
            Self::ActivityFeed => Some(cadence.activity),
            Self::TransactionHorizon => Some(cadence.transaction_horizon),
            Self::ForkWatch => Some(cadence.fork_watch),
            Self::NetworkAtlas => Some(cadence.network_atlas),
            Self::NetworkRoster => Some(cadence.network_roster),
            Self::ChainCensus => Some(cadence.chain_census),
            Self::ScriptRegistry => Some(cadence.script_registry),
            Self::GalaxyComposition => cadence.galaxy_composition,
            Self::GalaxyTopUp => Some(cadence.galaxy_top_up),
        }
    }

    fn supported(self, status: &EnrichmentSourceStatus) -> bool {
        status
            .capabilities
            .iter()
            .any(|capability| capability == self.capability())
    }

    fn ready(self, status: &EnrichmentSourceStatus) -> bool {
        if !self.supported(status) {
            return false;
        }

        match self {
            Self::ForkWatch => {
                (status.validated_anchor.is_some()
                    && matches!(
                        status.status,
                        EnrichmentSourceState::Ready | EnrichmentSourceState::Stale
                    ))
                    || status.status == EnrichmentSourceState::Incompatible
            }
            _ => {
                status.validated_anchor.is_some()
                    && matches!(
                        status.status,
                        EnrichmentSourceState::Ready | EnrichmentSourceState::Stale
                    )
            }
        }
    }

    async fn refresh(
        self,
        source: &dyn EnrichmentSource,
        context: &CanonicalContext,
        demand: CompositionDemand,
    ) -> anyhow::Result<Option<EnrichmentEvent>> {
        match self {
            Self::AssetEcosystem => source
                .enrich_asset_ecosystem(context)
                .await
                .map(|record| record.map(EnrichmentEvent::AssetEcosystemReplace)),
            Self::DaoState => source
                .enrich_dao_state(context)
                .await
                .map(|record| record.map(EnrichmentEvent::DaoStateReplace)),
            Self::ProtocolEra => source
                .enrich_protocol_era(context)
                .await
                .map(|record| record.map(EnrichmentEvent::ProtocolEraReplace)),
            Self::ActivityFeed => source
                .enrich_activity_feed(context)
                .await
                .map(|record| record.map(EnrichmentEvent::ActivityFeedReplace)),
            Self::TransactionHorizon => source
                .enrich_transaction_horizon(context)
                .await
                .map(|record| record.map(EnrichmentEvent::TransactionHorizonReplace)),
            Self::ForkWatch => source
                .enrich_fork_watch(context)
                .await
                .map(|record| record.map(EnrichmentEvent::ForkWatchReplace)),
            Self::NetworkAtlas => source
                .enrich_network_atlas(context)
                .await
                .map(|record| record.map(EnrichmentEvent::NetworkAtlasReplace)),
            Self::NetworkRoster => source.enrich_network_roster(context).await.map(|record| {
                record.map(|roster| EnrichmentEvent::NetworkRosterReplace(Box::new(roster)))
            }),
            Self::ChainCensus => source
                .enrich_chain_census(context)
                .await
                .map(|record| record.map(EnrichmentEvent::CensusReplace)),
            Self::ScriptRegistry => source.enrich_script_registry(context).await.map(|record| {
                record.map(|registry| EnrichmentEvent::ScriptRegistryReplace(Box::new(registry)))
            }),
            Self::GalaxyComposition => source
                .enrich_galaxy_composition(context)
                .await
                .map(|record| record.map(EnrichmentEvent::GalaxyCompositionReplace)),
            Self::GalaxyTopUp => source
                .enrich_galaxy_top_up(context, demand)
                .await
                .map(|top_up| top_up.map(EnrichmentEvent::GalaxyCompositionTopUp)),
        }
    }
}

#[derive(Default)]
struct RefreshTracker {
    last_started: HashMap<RefreshKind, Instant>,
    in_flight: HashSet<RefreshKind>,
    published: HashSet<RefreshKind>,
    initial_dao_retry_pending: bool,
    /// Consecutive top-up rounds that left the shortfall no smaller, and
    /// the bookkeeping to tell a completed round from one still in flight.
    top_up_stalled: u32,
    top_up_awaiting_outcome: bool,
    top_up_demand_before: usize,
    /// Rounds the current burst has run back-to-back. Zero means the
    /// top-up is on its ordinary cadence, and it is the whole of "am I
    /// bursting" — there is no second flag to disagree with it.
    top_up_burst_rounds: u32,
    /// Cells the current burst has landed, for the one line it logs.
    top_up_burst_landed: usize,
}

impl RefreshTracker {
    fn due(
        &mut self,
        kind: RefreshKind,
        status: &EnrichmentSourceStatus,
        cadence: RefreshCadence,
    ) -> bool {
        if !kind.ready(status) {
            self.last_started.remove(&kind);
            self.published.remove(&kind);
            if kind == RefreshKind::DaoState {
                self.initial_dao_retry_pending = kind.supported(status);
            }
            return false;
        }
        if self.in_flight.contains(&kind) {
            return false;
        }
        let waited = |at_least: Duration| {
            self.last_started
                .get(&kind)
                .is_none_or(|last| last.elapsed() >= at_least)
        };
        match kind.interval(cadence) {
            // A burst is due by definition — running without waiting out
            // the cadence is the whole of what bursting means.
            Some(_) if self.bursting(kind) => true,
            Some(interval) => waited(self.stretched(kind, interval)),
            // No cadence: keep trying until it lands, then hold.
            None => !self.published.contains(&kind) && waited(cadence.galaxy_composition_retry),
        }
    }

    fn bursting(&self, kind: RefreshKind) -> bool {
        kind == RefreshKind::GalaxyTopUp && self.top_up_burst_rounds > 0
    }

    /// A composition with no cadence runs once — so something has to
    /// make it due again when the stage loses it. A reorg at or below
    /// the reservoir anchor degrades the display plane back to prefix
    /// staffing, and the plane says so by publishing an uncurated
    /// demand; only a fresh composition can lift it out again.
    ///
    /// The grace period is what keeps this from mistaking the gap
    /// between publishing the event and the reducer applying it for a
    /// degrade — during that window the stage is legitimately not
    /// curated yet.
    fn rearm_composition_if_degraded(&mut self, demand: CompositionDemand, grace: Duration) {
        const KIND: RefreshKind = RefreshKind::GalaxyComposition;
        if demand.curated || !self.published.contains(&KIND) {
            return;
        }
        if self
            .last_started
            .get(&KIND)
            .is_some_and(|last| last.elapsed() < grace)
        {
            return;
        }
        self.published.remove(&KIND);
        self.last_started.remove(&KIND);
    }

    /// Judge the last dispatched top-up by the only thing that matters:
    /// did the shortfall get smaller.
    ///
    /// A demand can be perfectly real and still unplaceable — a class is
    /// short while every over-quota class holds nothing but curated
    /// members, so nobody may give way and the plane declines everything
    /// offered. Asking again at full cadence then costs index pages and a
    /// node round-trip every 5 seconds forever, and worse: the source
    /// marks each offered outpoint as handed out, so a round that placed
    /// nothing still permanently shrinks the supply that could have
    /// answered later. Stretching the cadence is what keeps an
    /// unsatisfiable ask from eating the answer.
    fn note_top_up_outcome(&mut self, demand: CompositionDemand) {
        if !demand.curated {
            // Prefix staffing asks for nothing; a degrade is not a stall.
            self.top_up_stalled = 0;
            self.top_up_awaiting_outcome = false;
            return;
        }
        if self.top_up_burst_rounds > 0 {
            // A burst is ONE judging window, not one per round. The
            // shortfall a round closes is republished by the reducer
            // several rounds after the round that closed it, so judging
            // each burst round by the demand delta would read a burst
            // doing exactly its job as a stall and stretch the cadence
            // for it. The judgment runs once, when the burst ends, against
            // the shortfall the burst opened on — see
            // [`RefreshTracker::end_top_up_burst`].
            return;
        }
        if !self.top_up_awaiting_outcome || self.in_flight.contains(&RefreshKind::GalaxyTopUp) {
            return; // no completed round to judge
        }
        self.top_up_awaiting_outcome = false;
        if demand.total() < self.top_up_demand_before {
            self.top_up_stalled = 0;
            return;
        }
        self.top_up_stalled = self.top_up_stalled.saturating_add(1);
        if self.top_up_stalled == TOP_UP_STALL_GRACE + 1 {
            tracing::info!(
                target: "cknerv-server",
                shortfall = demand.total(),
                "the display plane is asking for cells it cannot place; \
                 stretching the top-up cadence"
            );
        }
    }

    /// Record the shortfall a dispatched top-up round is opening
    /// against. A burst keeps the shortfall its FIRST round opened on:
    /// the whole run is judged as one window, so the window's baseline is
    /// the one that matters.
    fn note_top_up_dispatch(&mut self, demand: CompositionDemand) {
        if self.top_up_burst_rounds == 0 {
            self.top_up_demand_before = demand.total();
        }
    }

    /// Judge a completed top-up round, and say whether the next one should
    /// follow immediately instead of waiting out the cadence.
    ///
    /// A burst is armed by a round that LANDED cells under a shortfall
    /// worth hurrying for, and it lasts exactly as long as both stay true.
    /// Fruitfulness is read from the round's own result rather than from
    /// the demand delta because inside a burst the delta is not yet
    /// knowable — the reducer republishes the shortfall several rounds
    /// behind the round that closed it.
    ///
    /// The delta still has the final word. The whole burst goes to
    /// [`RefreshTracker::note_top_up_outcome`] as one window when it ends,
    /// and a tracker carrying a stall may not arm a new one: that is what
    /// keeps a dry source, or a live source whose cells the plane will not
    /// place, from being asked sixty-four times about it.
    fn note_top_up_landing(
        &mut self,
        landed: usize,
        demand: CompositionDemand,
        cadence: RefreshCadence,
    ) -> bool {
        let hungry = demand.curated && demand.total() > cadence.top_up_burst_demand;
        if self.top_up_burst_rounds == 0 {
            // Nothing to arm from: an ordinary cadence round stays on the
            // ordinary path, judged by the demand delta at the next probe
            // exactly as it was before bursts existed.
            if landed == 0 || !hungry || self.top_up_stalled > 0 {
                return false;
            }
        } else if landed == 0 || !hungry {
            // The supply ran dry, or the shortfall closed. Either way the
            // reason to hurry is gone.
            self.end_top_up_burst(demand);
            return false;
        }
        self.top_up_burst_rounds = self.top_up_burst_rounds.saturating_add(1);
        self.top_up_burst_landed = self.top_up_burst_landed.saturating_add(landed);
        if self.top_up_burst_rounds >= cadence.top_up_burst_max_rounds {
            self.end_top_up_burst(demand);
            return false;
        }
        true
    }

    /// Close a burst and hand the run it made to the ordinary judgment.
    ///
    /// Every exit goes through here, so the summary line is a property of
    /// the burst ending rather than of which way it ended.
    fn end_top_up_burst(&mut self, demand: CompositionDemand) {
        if self.top_up_burst_rounds == 0 {
            return;
        }
        tracing::info!(
            target: "cknerv-server",
            rounds = self.top_up_burst_rounds,
            cells = self.top_up_burst_landed,
            shortfall = demand.total(),
            "the top-up ran its rounds back-to-back and is back on cadence"
        );
        self.top_up_burst_rounds = 0;
        self.top_up_burst_landed = 0;
        // `top_up_demand_before` still holds the shortfall the burst
        // opened on, so this counts the whole run as exactly one round for
        // the backoff: a burst that closed nothing earns one fruitless
        // round — and with it the refusal to arm another — while a burst
        // that closed something clears the count outright.
        self.note_top_up_outcome(demand);
    }

    /// The top-up's cadence after any earned backoff. Every other
    /// capability keeps its configured interval.
    fn stretched(&self, kind: RefreshKind, interval: Duration) -> Duration {
        if kind != RefreshKind::GalaxyTopUp {
            return interval;
        }
        let steps = self
            .top_up_stalled
            .saturating_sub(TOP_UP_STALL_GRACE)
            .min(TOP_UP_MAX_BACKOFF_SHIFT);
        interval.saturating_mul(1u32 << steps)
    }

    fn started(&mut self, kind: RefreshKind) {
        if kind == RefreshKind::GalaxyTopUp {
            self.top_up_awaiting_outcome = true;
        }
        self.last_started.insert(kind, Instant::now());
        self.in_flight.insert(kind);
        if kind == RefreshKind::DaoState {
            self.initial_dao_retry_pending = false;
        }
    }

    fn finished(&mut self, kind: RefreshKind, published: bool) {
        self.in_flight.remove(&kind);
        if published {
            self.published.insert(kind);
            if kind == RefreshKind::DaoState {
                self.initial_dao_retry_pending = false;
            }
        } else if kind == RefreshKind::DaoState && !self.published.contains(&kind) {
            // A DAO singleton can advance between the compatibility probe and
            // its aggregate request. The source deliberately withholds that
            // unproven record as `None`; until the first usable snapshot is
            // published, make it due again and let newer canonical evidence
            // wake the probe immediately.
            self.last_started.remove(&kind);
            self.initial_dao_retry_pending = true;
        }
    }

    fn awaiting_initial_dao_retry(&self) -> bool {
        self.initial_dao_retry_pending && !self.in_flight.contains(&RefreshKind::DaoState)
    }

    fn canonical_retry_scheduled(&mut self) {
        self.initial_dao_retry_pending = false;
    }
}

struct RefreshCompletion {
    kind: RefreshKind,
    result: anyhow::Result<Option<EnrichmentEvent>>,
}

pub(crate) fn spawn(
    source: Arc<dyn EnrichmentSource>,
    state: Arc<ServerState>,
    out: mpsc::Sender<EnrichmentEvent>,
    shutdown: watch::Receiver<bool>,
    store: Option<Arc<CompositionStore>>,
) -> JoinHandle<()> {
    tokio::spawn(run(
        source,
        state,
        out,
        shutdown,
        RefreshCadence::default(),
        store,
    ))
}

async fn run(
    source: Arc<dyn EnrichmentSource>,
    state: Arc<ServerState>,
    out: mpsc::Sender<EnrichmentEvent>,
    mut shutdown: watch::Receiver<bool>,
    cadence: RefreshCadence,
    store: Option<Arc<CompositionStore>>,
) {
    let mut interval = tokio::time::interval(cadence.probe);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut canonical_evidence = state.subscribe_canonical_evidence();
    let mut last_status = None;
    let mut last_publish = Instant::now()
        .checked_sub(cadence.status)
        .unwrap_or_else(Instant::now);
    let mut tracker = RefreshTracker::default();
    let limiter = Arc::new(Semaphore::new(cadence.max_concurrent.max(1)));
    let top_up_limiter = Arc::new(Semaphore::new(1));
    let mut refreshes = JoinSet::new();
    let mut network_atlas_present = false;
    let mut network_roster_present = false;

    'supervisor: loop {
        tokio::select! {
            _ = interval.tick() => {
                let context = state.canonical_context();
                let status = source.probe(&context).await;
                let changed = last_status.as_ref().is_none_or(|previous| {
                    status_materially_changed(previous, &status)
                });
                if changed || last_publish.elapsed() >= cadence.status {
                    if out.send(EnrichmentEvent::SourceStatus(status.clone())).await.is_err() {
                        break;
                    }
                    last_status = Some(status.clone());
                    last_publish = Instant::now();
                }

                let demand = state.composition_demand();
                tracker.rearm_composition_if_degraded(demand, cadence.galaxy_composition_retry);
                tracker.note_top_up_outcome(demand);
                for kind in REFRESH_KINDS {
                    if kind == RefreshKind::GalaxyTopUp && (!demand.curated || demand.is_empty()) {
                        // Nothing to close. Stay due so the next tick sees
                        // a fresh number the moment the stage drifts — and
                        // let go of any burst here rather than leaving one
                        // armed against a shortfall that no longer exists.
                        tracker.end_top_up_burst(demand);
                        continue;
                    }
                    if !tracker.due(kind, &status, cadence) {
                        continue;
                    }
                    // The top-up runs on its own permit. It is the only
                    // capability that repeats on a seconds cadence, so
                    // sharing the pool would let it crowd out the bounded
                    // aggregates it sits beside.
                    let permit = if kind == RefreshKind::GalaxyTopUp {
                        top_up_limiter.clone().try_acquire_owned()
                    } else {
                        limiter.clone().try_acquire_owned()
                    };
                    let Ok(permit) = permit else {
                        if kind == RefreshKind::GalaxyTopUp {
                            continue;
                        }
                        // Do not queue a request with this tick's canonical
                        // context. A later probe will retry it with fresh proof.
                        break;
                    };
                    if kind == RefreshKind::GalaxyTopUp {
                        tracker.note_top_up_dispatch(demand);
                    }
                    tracker.started(kind);
                    let source = source.clone();
                    let context = context.clone();
                    let store = store.clone();
                    refreshes.spawn(async move {
                        let _permit = permit;
                        let result = kind.refresh(source.as_ref(), &context, demand).await;
                        // The one place a whole composition is known to
                        // exist AND to have been proved: the source
                        // discovered it, the canonical hydrator validated
                        // every cell of it through the node, and nothing
                        // downstream can turn it into anything but this
                        // same record. Whether the stage then seats it is
                        // a question about the chain moving under the
                        // request, not about the record — which is why the
                        // memory is written here rather than after the
                        // reducer, and written before the event is handed
                        // on, so a process that dies in between still
                        // wakes up remembering. Top-ups are absent on
                        // purpose: see `CompositionStore::remember`.
                        if let (Some(store), Ok(Some(EnrichmentEvent::GalaxyCompositionReplace(
                            record,
                        )))) = (&store, &result)
                        {
                            store.remember(record).await;
                        }
                        RefreshCompletion { kind, result }
                    });
                }
            }
            changed = canonical_evidence.changed(), if tracker.awaiting_initial_dao_retry() => {
                if changed.is_err() {
                    // ServerState outlives this supervisor in normal wiring.
                    // If its signal ever closes, retain the periodic probe
                    // without spinning on a permanently-ready error.
                    tracker.canonical_retry_scheduled();
                    continue;
                }
                let context = state.canonical_context();
                if context.replay_active || context.recent_blocks.is_empty() {
                    continue;
                }

                // Coalesce any canonical movement observed while the DAO
                // request was in flight, then reuse the ordinary probe path
                // immediately with a fresh context and proof.
                tracker.canonical_retry_scheduled();
                interval.reset_immediately();
            }
            completion = refreshes.join_next(), if !refreshes.is_empty() => {
                let Some(completion) = completion else {
                    continue;
                };
                match completion {
                    Ok(RefreshCompletion { kind, result }) => {
                        tracker.finished(kind, matches!(&result, Ok(Some(_))));
                        // What this round actually delivered, read before
                        // the event is handed on. A burst continues on
                        // supply, never on a shortfall number the reducer
                        // has not republished yet.
                        let landed = match &result {
                            Ok(Some(EnrichmentEvent::GalaxyCompositionTopUp(top_up))) => {
                                top_up.len()
                            }
                            _ => 0,
                        };
                        match result {
                            Ok(Some(event)) => {
                                if out.send(event).await.is_err() {
                                    break 'supervisor;
                                }
                                match kind {
                                    RefreshKind::NetworkAtlas => network_atlas_present = true,
                                    RefreshKind::NetworkRoster => network_roster_present = true,
                                    _ => {}
                                }
                            }
                            Ok(None) if kind == RefreshKind::NetworkAtlas && network_atlas_present => {
                                if out.send(EnrichmentEvent::NetworkAtlasClear).await.is_err() {
                                    break 'supervisor;
                                }
                                network_atlas_present = false;
                            }
                            // A source that stops offering a roster has had
                            // its crawler switched off: the sighted nodes on
                            // stage are no longer anybody's observation and
                            // have to leave with it.
                            Ok(None) if kind == RefreshKind::NetworkRoster && network_roster_present => {
                                if out.send(EnrichmentEvent::NetworkRosterClear).await.is_err() {
                                    break 'supervisor;
                                }
                                network_roster_present = false;
                            }
                            Ok(None) => {}
                            Err(error) => tracing::warn!(
                                target: "cknerv-server",
                                capability = kind.capability(),
                                "optional enrichment refresh failed: {error}"
                            ),
                        }
                        if kind == RefreshKind::GalaxyTopUp
                            && tracker.note_top_up_landing(
                                landed,
                                state.composition_demand(),
                                cadence,
                            )
                        {
                            // Run the next round now. The probe tick is
                            // what dispatches, so waking it is how a round
                            // is asked for — and it re-probes on the way,
                            // which means the round that follows carries
                            // its own fresh canonical proof rather than
                            // inheriting this one's.
                            interval.reset_immediately();
                        }
                    }
                    Err(error) => {
                        // A source panic used to terminate the entire serial
                        // supervisor. Keep health probing alive and allow every
                        // capability to become due again instead.
                        tracker.in_flight.clear();
                        // A round that died proved nothing about supply, so
                        // it cannot carry a burst: end it here rather than
                        // leave one armed on a source that is falling over.
                        tracker.end_top_up_burst(state.composition_demand());
                        tracing::warn!(
                            target: "cknerv-server",
                            "optional enrichment refresh task failed: {error}"
                        );
                    }
                }
            }
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() {
                    break;
                }
            }
        }
    }

    refreshes.abort_all();
}

fn status_materially_changed(
    previous: &EnrichmentSourceStatus,
    current: &EnrichmentSourceStatus,
) -> bool {
    previous.source != current.source
        || previous.status != current.status
        || previous.capabilities != current.capabilities
        || previous.indexed_tip != current.indexed_tip
        || previous.lag_blocks != current.lag_blocks
        || previous.validated_anchor != current.validated_anchor
        || previous.message != current.message
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use async_trait::async_trait;
    use cknerv_core::{
        ActivityFeedItem, ActivityFeedRecord, AssetEcosystemRecord, ChainAnchor, ChainCensus,
        ChainCensusClasses, DaoStateRecord, Mutation, ReplayPhase,
    };

    use super::*;

    struct SlowAggregateSource {
        probes: Arc<AtomicUsize>,
        ecosystem_calls: Arc<AtomicUsize>,
    }

    struct DaoFixtureSource {
        dao_calls: Arc<AtomicUsize>,
        withhold_first: bool,
    }

    /// Advertises `chain_census` and answers with a record anchored at the
    /// canonical block it was handed, so the test can prove the supervisor
    /// dispatches the kind AND that the census reaches the event channel.
    struct CensusFixtureSource {
        census_calls: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl EnrichmentSource for CensusFixtureSource {
        fn name(&self) -> &'static str {
            "census-fixture"
        }

        fn capabilities(&self) -> Vec<String> {
            vec!["chain_census".to_string()]
        }

        async fn probe(&self, context: &CanonicalContext) -> EnrichmentSourceStatus {
            let anchor = context.recent_blocks.last().map(|block| ChainAnchor {
                block: block.number,
                hash: block.hash.clone(),
            });
            EnrichmentSourceStatus {
                source: self.name().to_string(),
                status: EnrichmentSourceState::Ready,
                capabilities: self.capabilities(),
                indexed_tip: Some(context.tip),
                lag_blocks: Some(0),
                validated_anchor: anchor,
                last_success_at_ms: Some(1),
                message: None,
            }
        }

        async fn enrich_cell(
            &self,
            _out_point: &cknerv_core::OutPoint,
            _context: &CanonicalContext,
        ) -> anyhow::Result<Option<cknerv_core::CellSemanticRecord>> {
            Ok(None)
        }

        async fn enrich_chain_census(
            &self,
            context: &CanonicalContext,
        ) -> anyhow::Result<Option<ChainCensus>> {
            self.census_calls.fetch_add(1, Ordering::Relaxed);
            let block = context.recent_blocks.last().expect("canonical block");
            Ok(Some(ChainCensus {
                source: self.name().to_string(),
                as_of: ChainAnchor {
                    block: block.number,
                    hash: block.hash.clone(),
                },
                updated_at_ms: 1,
                live_cells: 1_471_222,
                total_cells: None,
                dead_cells: None,
                classes: Some(ChainCensusClasses {
                    dao: 22_676,
                    typed_non_dao: 475_891,
                    plain: 972_655,
                }),
                data_bearing: Some(266_346),
            }))
        }
    }

    #[async_trait]
    impl EnrichmentSource for SlowAggregateSource {
        fn name(&self) -> &'static str {
            "slow-fixture"
        }

        fn capabilities(&self) -> Vec<String> {
            vec!["asset_ecosystem".to_string(), "activity_feed".to_string()]
        }

        async fn probe(&self, context: &CanonicalContext) -> EnrichmentSourceStatus {
            self.probes.fetch_add(1, Ordering::Relaxed);
            let anchor = context.recent_blocks.last().map(|block| ChainAnchor {
                block: block.number,
                hash: block.hash.clone(),
            });
            EnrichmentSourceStatus {
                source: self.name().to_string(),
                status: EnrichmentSourceState::Ready,
                capabilities: self.capabilities(),
                indexed_tip: Some(context.tip),
                lag_blocks: Some(0),
                validated_anchor: anchor,
                last_success_at_ms: Some(1),
                message: None,
            }
        }

        async fn enrich_cell(
            &self,
            _out_point: &cknerv_core::OutPoint,
            _context: &CanonicalContext,
        ) -> anyhow::Result<Option<cknerv_core::CellSemanticRecord>> {
            Ok(None)
        }

        async fn enrich_asset_ecosystem(
            &self,
            _context: &CanonicalContext,
        ) -> anyhow::Result<Option<AssetEcosystemRecord>> {
            self.ecosystem_calls.fetch_add(1, Ordering::Relaxed);
            tokio::time::sleep(Duration::from_millis(250)).await;
            Ok(None)
        }

        async fn enrich_activity_feed(
            &self,
            context: &CanonicalContext,
        ) -> anyhow::Result<Option<ActivityFeedRecord>> {
            let block = context.recent_blocks.last().expect("canonical block");
            Ok(Some(ActivityFeedRecord {
                source: self.name().to_string(),
                as_of: ChainAnchor {
                    block: block.number,
                    hash: block.hash.clone(),
                },
                updated_at_ms: 1,
                activities: vec![ActivityFeedItem {
                    tx_hash: format!("0x{}", "11".repeat(32)),
                    block: block.number,
                    timestamp_ms: 1,
                    category: "transfer".to_string(),
                    label: None,
                    participant_count: 2,
                }],
            }))
        }
    }

    #[async_trait]
    impl EnrichmentSource for DaoFixtureSource {
        fn name(&self) -> &'static str {
            "dao-fixture"
        }

        fn capabilities(&self) -> Vec<String> {
            vec!["dao_state".to_string()]
        }

        async fn probe(&self, context: &CanonicalContext) -> EnrichmentSourceStatus {
            let Some(block) = context.recent_blocks.last() else {
                return EnrichmentSourceStatus {
                    source: self.name().to_string(),
                    status: EnrichmentSourceState::Syncing,
                    capabilities: self.capabilities(),
                    indexed_tip: Some(context.tip),
                    lag_blocks: Some(0),
                    validated_anchor: None,
                    last_success_at_ms: None,
                    message: Some("waiting for canonical block evidence".to_string()),
                };
            };
            EnrichmentSourceStatus {
                source: self.name().to_string(),
                status: EnrichmentSourceState::Ready,
                capabilities: self.capabilities(),
                indexed_tip: Some(context.tip),
                lag_blocks: Some(0),
                validated_anchor: Some(ChainAnchor {
                    block: block.number,
                    hash: block.hash.clone(),
                }),
                last_success_at_ms: Some(1),
                message: None,
            }
        }

        async fn enrich_cell(
            &self,
            _out_point: &cknerv_core::OutPoint,
            _context: &CanonicalContext,
        ) -> anyhow::Result<Option<cknerv_core::CellSemanticRecord>> {
            Ok(None)
        }

        async fn enrich_dao_state(
            &self,
            context: &CanonicalContext,
        ) -> anyhow::Result<Option<DaoStateRecord>> {
            if self.dao_calls.fetch_add(1, Ordering::Relaxed) == 0 && self.withhold_first {
                return Ok(None);
            }
            let block = context.recent_blocks.last().expect("canonical block");
            Ok(Some(DaoStateRecord {
                source: self.name().to_string(),
                as_of: ChainAnchor {
                    block: block.number,
                    hash: block.hash.clone(),
                },
                statistics_block: block.number,
                updated_at_ms: 1,
                total_deposited_shannons: "1".to_string(),
                total_depositors: 1,
                active_deposits: 1,
                pending_withdrawal_shannons: "0".to_string(),
                unclaimed_compensation_shannons: "0".to_string(),
                estimated_apc_bps: 201,
                deposit_change_24h_shannons: None,
                depositors_change_24h: None,
            }))
        }
    }

    /// A source that only supports the composition capability and
    /// records every top-up it is asked for.
    struct TopUpSource {
        asks: Arc<std::sync::Mutex<Vec<CompositionDemand>>>,
    }

    #[async_trait]
    impl EnrichmentSource for TopUpSource {
        fn name(&self) -> &'static str {
            "top-up-fixture"
        }

        fn capabilities(&self) -> Vec<String> {
            vec!["galaxy_composition".to_string()]
        }

        async fn probe(&self, context: &CanonicalContext) -> EnrichmentSourceStatus {
            let anchor = context.recent_blocks.last().map(|block| ChainAnchor {
                block: block.number,
                hash: block.hash.clone(),
            });
            EnrichmentSourceStatus {
                source: self.name().to_string(),
                status: EnrichmentSourceState::Ready,
                capabilities: self.capabilities(),
                indexed_tip: Some(context.tip),
                lag_blocks: Some(0),
                validated_anchor: anchor,
                last_success_at_ms: Some(1),
                message: None,
            }
        }

        async fn enrich_cell(
            &self,
            _out_point: &cknerv_core::OutPoint,
            _context: &CanonicalContext,
        ) -> anyhow::Result<Option<cknerv_core::CellSemanticRecord>> {
            Ok(None)
        }

        async fn enrich_galaxy_top_up(
            &self,
            _context: &CanonicalContext,
            demand: CompositionDemand,
        ) -> anyhow::Result<Option<cknerv_core::GalaxyCompositionTopUp>> {
            self.asks.lock().unwrap().push(demand);
            Ok(None)
        }
    }

    fn top_up_cadence() -> RefreshCadence {
        RefreshCadence {
            probe: Duration::from_millis(10),
            status: Duration::from_secs(60),
            ecosystem: Duration::from_secs(60),
            dao_state: Duration::from_secs(60),
            protocol_era: Duration::from_secs(60),
            activity: Duration::from_secs(60),
            transaction_horizon: Duration::from_secs(60),
            fork_watch: Duration::from_secs(60),
            network_atlas: Duration::from_secs(60),
            network_roster: Duration::from_secs(60),
            chain_census: Duration::from_secs(60),
            script_registry: Duration::from_secs(300),
            galaxy_composition: None,
            galaxy_composition_retry: Duration::from_secs(60),
            galaxy_top_up: Duration::from_millis(10),
            top_up_burst_demand: top_up_burst_demand(),
            top_up_burst_max_rounds: TOP_UP_BURST_MAX_ROUNDS,
            max_concurrent: 1,
        }
    }

    /// A source that counts full compositions and reports them landing.
    struct CompositionCountingSource {
        compositions: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl EnrichmentSource for CompositionCountingSource {
        fn name(&self) -> &'static str {
            "composition-fixture"
        }

        fn capabilities(&self) -> Vec<String> {
            vec!["galaxy_composition".to_string()]
        }

        async fn probe(&self, context: &CanonicalContext) -> EnrichmentSourceStatus {
            let anchor = context.recent_blocks.last().map(|block| ChainAnchor {
                block: block.number,
                hash: block.hash.clone(),
            });
            EnrichmentSourceStatus {
                source: self.name().to_string(),
                status: EnrichmentSourceState::Ready,
                capabilities: self.capabilities(),
                indexed_tip: Some(context.tip),
                lag_blocks: Some(0),
                validated_anchor: anchor,
                last_success_at_ms: Some(1),
                message: None,
            }
        }

        async fn enrich_cell(
            &self,
            _out_point: &cknerv_core::OutPoint,
            _context: &CanonicalContext,
        ) -> anyhow::Result<Option<cknerv_core::CellSemanticRecord>> {
            Ok(None)
        }

        async fn enrich_galaxy_composition(
            &self,
            context: &CanonicalContext,
        ) -> anyhow::Result<Option<cknerv_core::GalaxyCompositionRecord>> {
            self.compositions.fetch_add(1, Ordering::Relaxed);
            let block = context.recent_blocks.last().unwrap();
            Ok(Some(cknerv_core::GalaxyCompositionRecord {
                source: self.name().to_string(),
                as_of: ChainAnchor {
                    block: block.number,
                    hash: block.hash.clone(),
                },
                updated_at_ms: 1,
                dao: Vec::new(),
                typed: Vec::new(),
                plain: Vec::new(),
            }))
        }
    }

    fn composition_cadence(periodic: Option<Duration>) -> RefreshCadence {
        RefreshCadence {
            probe: Duration::from_millis(10),
            status: Duration::from_secs(60),
            ecosystem: Duration::from_secs(60),
            dao_state: Duration::from_secs(60),
            protocol_era: Duration::from_secs(60),
            activity: Duration::from_secs(60),
            transaction_horizon: Duration::from_secs(60),
            fork_watch: Duration::from_secs(60),
            network_atlas: Duration::from_secs(60),
            network_roster: Duration::from_secs(60),
            chain_census: Duration::from_secs(60),
            script_registry: Duration::from_secs(300),
            galaxy_composition: periodic,
            galaxy_composition_retry: Duration::from_millis(30),
            galaxy_top_up: Duration::from_secs(60),
            top_up_burst_demand: top_up_burst_demand(),
            top_up_burst_max_rounds: TOP_UP_BURST_MAX_ROUNDS,
            max_concurrent: 2,
        }
    }

    /// D7 — with no cadence the composition staffs the stage ONCE and
    /// then holds. The whole point of the top-up is that drift no longer
    /// needs a periodic re-derivation of the entire membership.
    #[tokio::test]
    async fn without_a_cadence_the_composition_runs_once_and_holds() {
        let sink = Arc::new(cknerv_core::CompositionDemandSink::new());
        let mut state = ServerState::new();
        state.set_composition_demand_sink(sink.clone());
        let state = Arc::new(state);
        state.apply_mutation(Mutation::BlockMined {
            number: 7,
            hash: "0xblock7".to_string(),
            tx_count: 1,
            size: 1,
            at: 1,
        });
        let compositions = Arc::new(AtomicUsize::new(0));
        let source: Arc<dyn EnrichmentSource> = Arc::new(CompositionCountingSource {
            compositions: compositions.clone(),
        });
        let (out, mut events) = mpsc::channel(16);
        let (shutdown, shutdown_rx) = watch::channel(false);
        let handle = tokio::spawn(run(
            source,
            state,
            out,
            shutdown_rx,
            composition_cadence(None),
            None,
        ));

        // It lands once…
        tokio::time::timeout(Duration::from_millis(500), async {
            while compositions.load(Ordering::Relaxed) == 0 {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("the first composition must still run");
        // …and the supervisor's own view of it is "published", which is
        // what the reducer would confirm on the real path.
        while let Ok(event) = events.try_recv() {
            if matches!(event, EnrichmentEvent::GalaxyCompositionReplace(_)) {
                sink.publish(CompositionDemand {
                    curated: true,
                    dao: 10,
                    typed: 10,
                });
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(
            compositions.load(Ordering::Relaxed),
            1,
            "no periodic re-derivation: {} probe rounds went by",
            200 / 10
        );

        let _ = shutdown.send(true);
        let _ = handle.await;
    }

    /// …but a degrade must lift the stage back out. The plane reports an
    /// uncurated demand after a reorg at the reservoir anchor, and only
    /// a fresh composition can answer that.
    #[tokio::test]
    async fn a_degraded_stage_makes_the_composition_due_again() {
        let sink = Arc::new(cknerv_core::CompositionDemandSink::new());
        let mut state = ServerState::new();
        state.set_composition_demand_sink(sink.clone());
        let state = Arc::new(state);
        state.apply_mutation(Mutation::BlockMined {
            number: 7,
            hash: "0xblock7".to_string(),
            tx_count: 1,
            size: 1,
            at: 1,
        });
        let compositions = Arc::new(AtomicUsize::new(0));
        let source: Arc<dyn EnrichmentSource> = Arc::new(CompositionCountingSource {
            compositions: compositions.clone(),
        });
        let (out, _events) = mpsc::channel(16);
        let (shutdown, shutdown_rx) = watch::channel(false);
        let handle = tokio::spawn(run(
            source,
            state,
            out,
            shutdown_rx,
            composition_cadence(None),
            None,
        ));

        tokio::time::timeout(Duration::from_millis(500), async {
            while compositions.load(Ordering::Relaxed) == 0 {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("first composition");
        sink.publish(CompositionDemand {
            curated: true,
            dao: 1,
            typed: 1,
        });
        tokio::time::sleep(Duration::from_millis(120)).await;
        assert_eq!(
            compositions.load(Ordering::Relaxed),
            1,
            "held while curated"
        );

        // The reorg degrade: the plane falls back to prefix staffing.
        sink.publish(CompositionDemand::default());
        tokio::time::timeout(Duration::from_millis(600), async {
            while compositions.load(Ordering::Relaxed) < 2 {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("a degraded stage must be recomposed");

        let _ = shutdown.send(true);
        let _ = handle.await;
    }

    /// With a cadence configured the old behaviour is intact — it just
    /// means "re-rank against the current index ordering" now.
    #[tokio::test]
    async fn a_configured_cadence_still_repeats() {
        let state = Arc::new(ServerState::new());
        state.apply_mutation(Mutation::BlockMined {
            number: 7,
            hash: "0xblock7".to_string(),
            tx_count: 1,
            size: 1,
            at: 1,
        });
        let compositions = Arc::new(AtomicUsize::new(0));
        let source: Arc<dyn EnrichmentSource> = Arc::new(CompositionCountingSource {
            compositions: compositions.clone(),
        });
        let (out, _events) = mpsc::channel(16);
        let (shutdown, shutdown_rx) = watch::channel(false);
        let handle = tokio::spawn(run(
            source,
            state,
            out,
            shutdown_rx,
            composition_cadence(Some(Duration::from_millis(30))),
            None,
        ));

        tokio::time::timeout(Duration::from_millis(800), async {
            while compositions.load(Ordering::Relaxed) < 3 {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("a configured cadence repeats");

        let _ = shutdown.send(true);
        let _ = handle.await;
    }

    /// The top-up is demand-gated: a stage that is not asking costs the
    /// index nothing, and one that is asking is told exactly how much.
    fn curated_shortfall(total: usize) -> CompositionDemand {
        CompositionDemand {
            curated: true,
            dao: total,
            typed: 0,
        }
    }

    /// One completed top-up round, judged.
    fn top_up_round(tracker: &mut RefreshTracker, before: usize, after: usize) {
        tracker.top_up_demand_before = before;
        tracker.started(RefreshKind::GalaxyTopUp);
        tracker.finished(RefreshKind::GalaxyTopUp, true);
        tracker.note_top_up_outcome(curated_shortfall(after));
    }

    /// A shortfall that keeps closing is exactly what the top-up is for —
    /// it must never be slowed down for doing its job.
    #[test]
    fn a_closing_shortfall_never_earns_a_backoff() {
        let mut tracker = RefreshTracker::default();
        let base = Duration::from_secs(5);
        let mut shortfall = 1_000;
        for _ in 0..12 {
            let before = shortfall;
            shortfall -= 50;
            top_up_round(&mut tracker, before, shortfall);
            assert_eq!(tracker.stretched(RefreshKind::GalaxyTopUp, base), base);
        }
    }

    /// The plane can publish a shortfall the ratchet cannot place: a class
    /// is short while every over-quota class holds nothing but curated
    /// members, so nobody may give way. Asking again every 5s forever costs
    /// index pages and a node round-trip each time — and each round burns
    /// candidates out of the source's tail for good, so it shrinks the very
    /// supply that could have answered later.
    #[test]
    fn an_unplaceable_shortfall_stretches_the_cadence_up_to_a_ceiling() {
        let mut tracker = RefreshTracker::default();
        let base = Duration::from_secs(5);

        for _ in 0..TOP_UP_STALL_GRACE {
            top_up_round(&mut tracker, 1_000, 1_000);
            assert_eq!(
                tracker.stretched(RefreshKind::GalaxyTopUp, base),
                base,
                "a round in flight must not be mistaken for a fruitless one"
            );
        }

        for step in 1..=4u32 {
            top_up_round(&mut tracker, 1_000, 1_000);
            assert_eq!(
                tracker.stretched(RefreshKind::GalaxyTopUp, base),
                base * (1 << step)
            );
        }

        for _ in 0..20 {
            top_up_round(&mut tracker, 1_000, 1_000);
        }
        assert_eq!(
            tracker.stretched(RefreshKind::GalaxyTopUp, base),
            base * (1 << TOP_UP_MAX_BACKOFF_SHIFT),
            "the backoff has a ceiling; a stalled stage is still checked"
        );
        assert_eq!(
            tracker.stretched(RefreshKind::AssetEcosystem, Duration::from_secs(30)),
            Duration::from_secs(30),
            "the backoff belongs to the top-up alone"
        );

        // One placement reopens the tap immediately.
        top_up_round(&mut tracker, 1_000, 999);
        assert_eq!(tracker.stretched(RefreshKind::GalaxyTopUp, base), base);
    }

    /// A degrade back to prefix staffing zeroes the demand; that is not a
    /// stalled top-up, and the next composition must not inherit a
    /// stretched cadence.
    #[test]
    fn a_degrade_clears_the_backoff() {
        let mut tracker = RefreshTracker::default();
        let base = Duration::from_secs(5);
        for _ in 0..10 {
            top_up_round(&mut tracker, 1_000, 1_000);
        }
        assert!(tracker.stretched(RefreshKind::GalaxyTopUp, base) > base);
        tracker.note_top_up_outcome(CompositionDemand::default());
        assert_eq!(tracker.stretched(RefreshKind::GalaxyTopUp, base), base);
    }

    #[tokio::test]
    async fn the_top_up_only_runs_while_the_stage_is_asking() {
        let sink = Arc::new(cknerv_core::CompositionDemandSink::new());
        let mut state = ServerState::new();
        state.set_composition_demand_sink(sink.clone());
        let state = Arc::new(state);
        state.apply_mutation(Mutation::BlockMined {
            number: 7,
            hash: "0xblock7".to_string(),
            tx_count: 1,
            size: 1,
            at: 1,
        });

        let asks = Arc::new(std::sync::Mutex::new(Vec::new()));
        let source: Arc<dyn EnrichmentSource> = Arc::new(TopUpSource { asks: asks.clone() });
        let (out, _events) = mpsc::channel(16);
        let (shutdown, shutdown_rx) = watch::channel(false);
        let handle = tokio::spawn(run(
            source,
            state.clone(),
            out,
            shutdown_rx,
            top_up_cadence(),
            None,
        ));

        // Silent stage: nothing published, so nothing is fetched.
        tokio::time::sleep(Duration::from_millis(80)).await;
        assert!(
            asks.lock().unwrap().is_empty(),
            "a stage that is not asking must not touch the index"
        );

        sink.publish(CompositionDemand {
            curated: true,
            dao: 1_777,
            typed: 1_994,
        });
        tokio::time::timeout(Duration::from_millis(500), async {
            while asks.lock().unwrap().is_empty() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("a published shortfall wakes the top-up");
        assert_eq!(
            asks.lock().unwrap()[0],
            CompositionDemand {
                curated: true,
                dao: 1_777,
                typed: 1_994,
            },
            "the source is told the shortfall verbatim"
        );

        // Closing the gap stops the asking again.
        sink.publish(CompositionDemand::default());
        tokio::time::sleep(Duration::from_millis(50)).await;
        let settled = asks.lock().unwrap().len();
        tokio::time::sleep(Duration::from_millis(80)).await;
        assert_eq!(
            asks.lock().unwrap().len(),
            settled,
            "a satisfied stage goes quiet"
        );

        let _ = shutdown.send(true);
        let _ = handle.await;
    }

    // ── the boot burst ────────────────────────────────────────────

    /// A source whose top-up lands cells for its first `fruitful` rounds
    /// and nothing after, so a test can say exactly when the supply runs
    /// out. It counts every round it is asked for.
    struct BurstTopUpSource {
        rounds: Arc<AtomicUsize>,
        fruitful: usize,
    }

    #[async_trait]
    impl EnrichmentSource for BurstTopUpSource {
        fn name(&self) -> &'static str {
            "burst-fixture"
        }

        fn capabilities(&self) -> Vec<String> {
            vec!["galaxy_composition".to_string()]
        }

        async fn probe(&self, context: &CanonicalContext) -> EnrichmentSourceStatus {
            let anchor = context.recent_blocks.last().map(|block| ChainAnchor {
                block: block.number,
                hash: block.hash.clone(),
            });
            EnrichmentSourceStatus {
                source: self.name().to_string(),
                status: EnrichmentSourceState::Ready,
                capabilities: self.capabilities(),
                indexed_tip: Some(context.tip),
                lag_blocks: Some(0),
                validated_anchor: anchor,
                last_success_at_ms: Some(1),
                message: None,
            }
        }

        async fn enrich_cell(
            &self,
            _out_point: &cknerv_core::OutPoint,
            _context: &CanonicalContext,
        ) -> anyhow::Result<Option<cknerv_core::CellSemanticRecord>> {
            Ok(None)
        }

        async fn enrich_galaxy_top_up(
            &self,
            context: &CanonicalContext,
            _demand: CompositionDemand,
        ) -> anyhow::Result<Option<cknerv_core::GalaxyCompositionTopUp>> {
            let round = self.rounds.fetch_add(1, Ordering::Relaxed);
            if round >= self.fruitful {
                return Ok(None);
            }
            let block = context.recent_blocks.last().expect("canonical block");
            Ok(Some(cknerv_core::GalaxyCompositionTopUp {
                source: self.name().to_string(),
                as_of: ChainAnchor {
                    block: block.number,
                    hash: block.hash.clone(),
                },
                updated_at_ms: 1,
                dao: (0..4).map(|i| top_up_cell(round as u64 * 16 + i)).collect(),
                typed: Vec::new(),
            }))
        }
    }

    fn top_up_cell(id: u64) -> cknerv_core::Cell {
        cknerv_core::Cell {
            id,
            born_at_ms: 0,
            death_at_ms: None,
            birth_block: 1,
            tag: None,
            pos_seed: [0.0, 0.0, 0.0],
            out_point: cknerv_core::OutPoint {
                tx_hash: format!("0x{id:064x}"),
                index: 0,
            },
            capacity: id,
            data_hex: "0x".into(),
            data_bytes: 0,
            content_hash: format!("0x{:064x}", id + 1),
            lock_shape_seed: [id as u32, 1],
            type_shape_seed: None,
            data_shape_seed: [id as u32, 2],
            lock_kind: Default::default(),
            asset_kind: Default::default(),
            lock_script: Default::default(),
            type_script: None,
            collection_seed: None,
        }
    }

    /// A cadence on which the ORDINARY path could not produce a second
    /// top-up round inside a test: a minute between rounds, against probes
    /// that tick every ten milliseconds. Every round past the first is
    /// therefore a burst round and can be nothing else.
    fn burst_cadence(max_rounds: u32) -> RefreshCadence {
        RefreshCadence {
            galaxy_top_up: Duration::from_secs(60),
            top_up_burst_demand: 100,
            top_up_burst_max_rounds: max_rounds,
            ..top_up_cadence()
        }
    }

    /// Run the supervisor against a published shortfall until the top-up
    /// goes quiet — `quiet` elapsed with no new round — and report how
    /// many rounds it got through.
    ///
    /// Quiet rather than a fixed sleep because the claim under test is
    /// about ORDERING, not speed: on these cadences the next cadence round
    /// is a minute away, so any silence at all means the burst is over and
    /// waiting longer cannot change the count. A fixed window would have
    /// measured how loaded the machine was instead.
    async fn top_up_rounds_until_quiet(
        fruitful: usize,
        demand: CompositionDemand,
        cadence: RefreshCadence,
        quiet: Duration,
    ) -> usize {
        let sink = Arc::new(cknerv_core::CompositionDemandSink::new());
        let mut state = ServerState::new();
        state.set_composition_demand_sink(sink.clone());
        let state = Arc::new(state);
        state.apply_mutation(Mutation::BlockMined {
            number: 7,
            hash: "0xblock7".to_string(),
            tx_count: 1,
            size: 1,
            at: 1,
        });
        // The shortfall stands: no reducer is applying what the rounds
        // land, which is the harshest case for a burst — every round is
        // answered by a demand number that has not moved.
        sink.publish(demand);

        let rounds = Arc::new(AtomicUsize::new(0));
        let source: Arc<dyn EnrichmentSource> = Arc::new(BurstTopUpSource {
            rounds: rounds.clone(),
            fruitful,
        });
        let (out, mut events) = mpsc::channel(4);
        // Drain the channel. A burst sends an event per round, and a full
        // channel would block the supervisor mid-burst — which is the very
        // thing under test.
        let drain = tokio::spawn(async move { while events.recv().await.is_some() {} });
        let (shutdown, shutdown_rx) = watch::channel(false);
        let handle = tokio::spawn(run(source, state, out, shutdown_rx, cadence, None));

        let deadline = Instant::now() + Duration::from_secs(10);
        let mut last = usize::MAX;
        let mut unchanged_since = Instant::now();
        let ran = loop {
            tokio::time::sleep(Duration::from_millis(5)).await;
            let now = rounds.load(Ordering::Relaxed);
            if now != last {
                last = now;
                unchanged_since = Instant::now();
            } else if unchanged_since.elapsed() >= quiet {
                break now;
            }
            assert!(Instant::now() < deadline, "the top-up never stopped asking");
        };
        let _ = shutdown.send(true);
        let _ = handle.await;
        drain.abort();
        ran
    }

    /// ⭐ The boot answer: a stage far short of its quota does not wait out
    /// a cadence per few hundred Cells. Sixteen rounds land inside a
    /// window where the configured cadence allows exactly one.
    #[tokio::test]
    async fn a_large_shortfall_takes_the_top_up_off_its_cadence() {
        let ran = top_up_rounds_until_quiet(
            usize::MAX,
            curated_shortfall(4_000),
            burst_cadence(16),
            Duration::from_millis(60),
        )
        .await;
        assert_eq!(
            ran, 16,
            "a shortfall worth hurrying for runs its rounds back-to-back"
        );
    }

    /// The bound, and that it is the ONLY thing stopping a source that
    /// never runs out: the round count follows the cap and nothing else.
    #[tokio::test]
    async fn the_burst_stops_at_its_round_cap() {
        for cap in [4u32, 12] {
            let ran = top_up_rounds_until_quiet(
                usize::MAX,
                curated_shortfall(4_000),
                burst_cadence(cap),
                Duration::from_millis(60),
            )
            .await;
            assert_eq!(
                ran, cap as usize,
                "an endless supply under a standing shortfall stops at the cap"
            );
        }
    }

    /// Burst only while fruitful. The moment a round returns nothing the
    /// drumbeat stops — and stays stopped, rather than pausing.
    #[tokio::test]
    async fn the_burst_ends_on_the_first_round_that_lands_nothing() {
        // A long silence, deliberately: the claim is that the burst ENDED,
        // not that it paused for breath.
        let ran = top_up_rounds_until_quiet(
            5,
            curated_shortfall(4_000),
            burst_cadence(64),
            Duration::from_millis(250),
        )
        .await;
        assert_eq!(
            ran, 6,
            "five rounds that landed Cells, and the one that did not, which ended it"
        );
    }

    /// Ordinary drift is not a boot. A stage a few dozen Cells short keeps
    /// the cadence it always had — one round, then the wait.
    #[tokio::test]
    async fn a_small_shortfall_never_leaves_the_cadence() {
        let cadence = burst_cadence(64);
        let ran = top_up_rounds_until_quiet(
            usize::MAX,
            curated_shortfall(cadence.top_up_burst_demand),
            cadence,
            Duration::from_millis(150),
        )
        .await;
        assert_eq!(ran, 1, "a shortfall at the threshold waits out the cadence");

        // Same source, same cadence, same window: only the size of the ask
        // is different.
        let ran = top_up_rounds_until_quiet(
            usize::MAX,
            curated_shortfall(cadence.top_up_burst_demand + 1),
            cadence,
            Duration::from_millis(150),
        )
        .await;
        assert!(
            ran > 1,
            "one Cell past the threshold is what changes the behaviour, and nothing else"
        );
    }

    /// ⭐ How the burst composes with the fruitless-stretch backoff: the
    /// whole run is ONE round as far as the backoff is concerned.
    ///
    /// It has to be. Inside a burst the demand delta is unreadable — the
    /// reducer republishes the shortfall several rounds behind the round
    /// that closed it — so a per-round judgment would score a burst doing
    /// exactly its job as eight consecutive stalls and stretch the cadence
    /// to minutes for it. Judged once, against the shortfall it opened on,
    /// a burst that moved nothing earns exactly one fruitless round; and a
    /// tracker carrying one may not open another burst, which is what
    /// stops a source the plane will not place from being asked in bulk.
    #[test]
    fn a_whole_burst_is_one_round_to_the_backoff_and_a_stalled_one_may_not_re_arm() {
        let cadence = RefreshCadence {
            top_up_burst_demand: 100,
            top_up_burst_max_rounds: 8,
            ..RefreshCadence::default()
        };
        let mut tracker = RefreshTracker::default();
        let hungry = curated_shortfall(1_000);
        let round = |tracker: &mut RefreshTracker, landed: usize| {
            tracker.note_top_up_dispatch(hungry);
            tracker.started(RefreshKind::GalaxyTopUp);
            tracker.finished(RefreshKind::GalaxyTopUp, landed > 0);
            tracker.note_top_up_landing(landed, hungry, cadence)
        };

        assert!(
            round(&mut tracker, 64),
            "a landing round under a large ask arms the burst"
        );
        for _ in 0..6 {
            assert!(round(&mut tracker, 64));
            assert_eq!(
                tracker.top_up_stalled, 0,
                "a burst in flight is not judged round by round"
            );
        }
        assert!(!round(&mut tracker, 64), "the eighth round hits the cap");
        assert_eq!(
            tracker.top_up_stalled, 1,
            "eight rounds against an unmoved shortfall are ONE fruitless round"
        );

        assert!(
            !round(&mut tracker, 64),
            "a stalled tracker may not open another burst, however well the source answers"
        );
        assert_eq!(
            tracker.stretched(RefreshKind::GalaxyTopUp, Duration::from_secs(5)),
            Duration::from_secs(5),
            "one fruitless round is still inside the grace: the cadence has not moved"
        );
    }

    /// The other half of the same law: a burst that DID close the
    /// shortfall it opened on leaves the backoff clean, so the next one
    /// may arm at once.
    #[test]
    fn a_burst_that_closes_its_shortfall_leaves_the_backoff_clean() {
        let cadence = RefreshCadence {
            top_up_burst_demand: 100,
            top_up_burst_max_rounds: 64,
            ..RefreshCadence::default()
        };
        let mut tracker = RefreshTracker::default();
        let opened = curated_shortfall(1_000);
        for _ in 0..3 {
            tracker.note_top_up_dispatch(opened);
            tracker.started(RefreshKind::GalaxyTopUp);
            tracker.finished(RefreshKind::GalaxyTopUp, true);
            assert!(tracker.note_top_up_landing(64, opened, cadence));
        }

        // The source runs dry, and by now the reducer has published what
        // the burst placed.
        let closed = curated_shortfall(600);
        tracker.note_top_up_dispatch(closed);
        tracker.started(RefreshKind::GalaxyTopUp);
        tracker.finished(RefreshKind::GalaxyTopUp, false);
        assert!(!tracker.note_top_up_landing(0, closed, cadence));
        assert_eq!(
            tracker.top_up_stalled, 0,
            "a burst that moved the shortfall is not a stall"
        );
        assert!(
            tracker.note_top_up_landing(64, closed, cadence),
            "and the next landing round may arm a burst straight away"
        );
    }

    fn cold_start_cadence() -> RefreshCadence {
        RefreshCadence {
            probe: Duration::from_secs(10),
            status: Duration::from_secs(60),
            ecosystem: Duration::from_secs(60),
            dao_state: Duration::from_secs(60),
            protocol_era: Duration::from_secs(60),
            activity: Duration::from_secs(60),
            transaction_horizon: Duration::from_secs(60),
            fork_watch: Duration::from_secs(60),
            network_atlas: Duration::from_secs(60),
            network_roster: Duration::from_secs(60),
            chain_census: Duration::from_secs(60),
            script_registry: Duration::from_secs(300),
            galaxy_composition: Some(Duration::from_secs(60)),
            galaxy_composition_retry: Duration::from_secs(60),
            galaxy_top_up: Duration::from_secs(60),
            top_up_burst_demand: top_up_burst_demand(),
            top_up_burst_max_rounds: TOP_UP_BURST_MAX_ROUNDS,
            max_concurrent: 1,
        }
    }

    #[tokio::test]
    async fn slow_aggregate_does_not_block_another_capability_or_health_probe() {
        let state = Arc::new(ServerState::new());
        state.apply_mutation(Mutation::BlockMined {
            number: 7,
            hash: "0xblock7".to_string(),
            tx_count: 1,
            size: 1,
            at: 1,
        });

        let probes = Arc::new(AtomicUsize::new(0));
        let ecosystem_calls = Arc::new(AtomicUsize::new(0));
        let source: Arc<dyn EnrichmentSource> = Arc::new(SlowAggregateSource {
            probes: probes.clone(),
            ecosystem_calls: ecosystem_calls.clone(),
        });
        let (out, mut events) = mpsc::channel(16);
        let (shutdown, shutdown_rx) = watch::channel(false);
        let cadence = RefreshCadence {
            probe: Duration::from_millis(20),
            status: Duration::from_secs(1),
            ecosystem: Duration::from_secs(1),
            dao_state: Duration::from_secs(1),
            protocol_era: Duration::from_secs(1),
            activity: Duration::from_secs(1),
            transaction_horizon: Duration::from_secs(1),
            fork_watch: Duration::from_secs(1),
            network_atlas: Duration::from_secs(1),
            network_roster: Duration::from_secs(1),
            chain_census: Duration::from_secs(1),
            script_registry: Duration::from_secs(300),
            galaxy_composition: Some(Duration::from_secs(1)),
            galaxy_composition_retry: Duration::from_secs(1),
            galaxy_top_up: Duration::from_secs(1),
            top_up_burst_demand: top_up_burst_demand(),
            top_up_burst_max_rounds: TOP_UP_BURST_MAX_ROUNDS,
            max_concurrent: 2,
        };
        let handle = tokio::spawn(run(source, state, out, shutdown_rx, cadence, None));

        tokio::time::timeout(Duration::from_millis(150), async {
            loop {
                if matches!(
                    events.recv().await,
                    Some(EnrichmentEvent::ActivityFeedReplace(_))
                ) {
                    break;
                }
            }
        })
        .await
        .expect("fast activity refresh must not wait for slow ecosystem refresh");

        tokio::time::sleep(Duration::from_millis(60)).await;
        assert!(
            probes.load(Ordering::Relaxed) >= 2,
            "source probing must continue while an aggregate is in flight"
        );
        assert_eq!(
            ecosystem_calls.load(Ordering::Relaxed),
            1,
            "one capability must not overlap its own in-flight refresh"
        );

        shutdown.send(true).unwrap();
        tokio::time::timeout(Duration::from_secs(1), handle)
            .await
            .expect("supervisor stops")
            .unwrap();
    }

    #[tokio::test]
    async fn an_advertised_census_capability_is_refreshed_on_its_own_cadence() {
        let state = Arc::new(ServerState::new());
        state.apply_mutation(Mutation::BlockMined {
            number: 7,
            hash: "0xblock7".to_string(),
            tx_count: 1,
            size: 1,
            at: 1,
        });

        let census_calls = Arc::new(AtomicUsize::new(0));
        let source: Arc<dyn EnrichmentSource> = Arc::new(CensusFixtureSource {
            census_calls: census_calls.clone(),
        });
        let (out, mut events) = mpsc::channel(16);
        let (shutdown, shutdown_rx) = watch::channel(false);
        let cadence = RefreshCadence {
            probe: Duration::from_millis(20),
            chain_census: Duration::from_millis(20),
            ..top_up_cadence()
        };
        let handle = tokio::spawn(run(source, state, out, shutdown_rx, cadence, None));

        let census = tokio::time::timeout(Duration::from_millis(300), async {
            loop {
                if let Some(EnrichmentEvent::CensusReplace(census)) = events.recv().await {
                    break census;
                }
            }
        })
        .await
        .expect("an advertised census capability must reach the event channel");

        assert_eq!(census.live_cells, 1_471_222);
        assert_eq!(census.as_of.block, 7);
        assert_eq!(
            census.classes.as_ref().and_then(ChainCensusClasses::total),
            Some(census.live_cells)
        );

        shutdown.send(true).unwrap();
        tokio::time::timeout(Duration::from_secs(1), handle)
            .await
            .expect("supervisor stops")
            .unwrap();
        assert!(census_calls.load(Ordering::Relaxed) >= 1);
    }

    #[tokio::test]
    async fn dao_state_starts_when_first_canonical_evidence_arrives() {
        let state = Arc::new(ServerState::new());
        let dao_calls = Arc::new(AtomicUsize::new(0));
        let source: Arc<dyn EnrichmentSource> = Arc::new(DaoFixtureSource {
            dao_calls: dao_calls.clone(),
            withhold_first: false,
        });
        let (out, mut events) = mpsc::channel(16);
        let (shutdown, shutdown_rx) = watch::channel(false);
        let handle = tokio::spawn(run(
            source,
            state.clone(),
            out,
            shutdown_rx,
            cold_start_cadence(),
            None,
        ));

        tokio::time::timeout(Duration::from_millis(250), async {
            loop {
                if matches!(
                    events.recv().await,
                    Some(EnrichmentEvent::SourceStatus(EnrichmentSourceStatus {
                        status: EnrichmentSourceState::Syncing,
                        ..
                    }))
                ) {
                    break;
                }
            }
        })
        .await
        .expect("initial probe reports that canonical evidence is missing");

        state.apply_mutation(Mutation::BackfillProgress {
            done: 0,
            total: 1,
            active: true,
            phase: ReplayPhase::Boot,
        });
        state.apply_mutation(Mutation::BlockMined {
            number: 7,
            hash: "0xblock7".to_string(),
            tx_count: 1,
            size: 1,
            at: 1,
        });
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(
            dao_calls.load(Ordering::Relaxed),
            0,
            "DAO refresh stays gated while canonical replay is active"
        );
        state.apply_mutation(Mutation::BackfillProgress {
            done: 1,
            total: 1,
            active: false,
            phase: ReplayPhase::Boot,
        });

        let dao = tokio::time::timeout(Duration::from_millis(250), async {
            loop {
                if let Some(EnrichmentEvent::DaoStateReplace(dao)) = events.recv().await {
                    break dao;
                }
            }
        })
        .await
        .expect("canonical evidence wakes the initial DAO refresh");
        assert_eq!(dao.statistics_block, 7);
        assert_eq!(dao_calls.load(Ordering::Relaxed), 1);

        shutdown.send(true).unwrap();
        tokio::time::timeout(Duration::from_secs(1), handle)
            .await
            .expect("supervisor stops")
            .unwrap();
    }

    #[tokio::test]
    async fn withheld_dao_state_retries_when_canonical_evidence_advances() {
        let state = Arc::new(ServerState::new());
        state.apply_mutation(Mutation::BlockMined {
            number: 7,
            hash: "0xblock7".to_string(),
            tx_count: 1,
            size: 1,
            at: 1,
        });

        let dao_calls = Arc::new(AtomicUsize::new(0));
        let source: Arc<dyn EnrichmentSource> = Arc::new(DaoFixtureSource {
            dao_calls: dao_calls.clone(),
            withhold_first: true,
        });
        let (out, mut events) = mpsc::channel(16);
        let (shutdown, shutdown_rx) = watch::channel(false);
        let handle = tokio::spawn(run(
            source,
            state.clone(),
            out,
            shutdown_rx,
            cold_start_cadence(),
            None,
        ));

        tokio::time::timeout(Duration::from_millis(250), async {
            while dao_calls.load(Ordering::Relaxed) == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("initial DAO request completes");

        state.apply_mutation(Mutation::BlockMined {
            number: 8,
            hash: "0xblock8".to_string(),
            tx_count: 1,
            size: 1,
            at: 2,
        });

        let dao = tokio::time::timeout(Duration::from_millis(250), async {
            loop {
                if let Some(EnrichmentEvent::DaoStateReplace(dao)) = events.recv().await {
                    break dao;
                }
            }
        })
        .await
        .expect("new canonical evidence retries the withheld DAO state");
        assert_eq!(dao.statistics_block, 8);
        assert_eq!(dao_calls.load(Ordering::Relaxed), 2);

        state.apply_mutation(Mutation::BlockMined {
            number: 9,
            hash: "0xblock9".to_string(),
            tx_count: 1,
            size: 1,
            at: 3,
        });
        tokio::time::sleep(Duration::from_millis(60)).await;
        assert_eq!(
            dao_calls.load(Ordering::Relaxed),
            2,
            "a published DAO state returns to its steady-state cadence"
        );

        shutdown.send(true).unwrap();
        tokio::time::timeout(Duration::from_secs(1), handle)
            .await
            .expect("supervisor stops")
            .unwrap();
    }
}
