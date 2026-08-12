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

use cknerv_core::{
    CompositionDemand, EnrichmentEvent, EnrichmentSourceState, EnrichmentSourceStatus,
};

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
    galaxy_composition: Option<Duration>,
    galaxy_composition_retry: Duration,
    galaxy_top_up: Duration,
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
            galaxy_composition: ENRICHMENT_GALAXY_COMPOSITION_REFRESH,
            galaxy_composition_retry: ENRICHMENT_GALAXY_COMPOSITION_RETRY,
            galaxy_top_up: ENRICHMENT_GALAXY_TOP_UP_REFRESH,
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
    GalaxyComposition,
    GalaxyTopUp,
}

const REFRESH_KINDS: [RefreshKind; 9] = [
    RefreshKind::AssetEcosystem,
    RefreshKind::DaoState,
    RefreshKind::ProtocolEra,
    RefreshKind::ActivityFeed,
    RefreshKind::TransactionHorizon,
    RefreshKind::ForkWatch,
    RefreshKind::NetworkAtlas,
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
            Some(interval) => waited(interval),
            // No cadence: keep trying until it lands, then hold.
            None => !self.published.contains(&kind) && waited(cadence.galaxy_composition_retry),
        }
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

    fn started(&mut self, kind: RefreshKind) {
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
) -> JoinHandle<()> {
    tokio::spawn(run(source, state, out, shutdown, RefreshCadence::default()))
}

async fn run(
    source: Arc<dyn EnrichmentSource>,
    state: Arc<ServerState>,
    out: mpsc::Sender<EnrichmentEvent>,
    mut shutdown: watch::Receiver<bool>,
    cadence: RefreshCadence,
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
                for kind in REFRESH_KINDS {
                    if kind == RefreshKind::GalaxyTopUp && (!demand.curated || demand.is_empty()) {
                        // Nothing to close. Stay due so the next tick sees
                        // a fresh number the moment the stage drifts.
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
                    tracker.started(kind);
                    let source = source.clone();
                    let context = context.clone();
                    refreshes.spawn(async move {
                        let _permit = permit;
                        RefreshCompletion {
                            kind,
                            result: kind.refresh(source.as_ref(), &context, demand).await,
                        }
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
                        match result {
                            Ok(Some(event)) => {
                                if out.send(event).await.is_err() {
                                    break 'supervisor;
                                }
                                if kind == RefreshKind::NetworkAtlas {
                                    network_atlas_present = true;
                                }
                            }
                            Ok(None) if kind == RefreshKind::NetworkAtlas && network_atlas_present => {
                                if out.send(EnrichmentEvent::NetworkAtlasClear).await.is_err() {
                                    break 'supervisor;
                                }
                                network_atlas_present = false;
                            }
                            Ok(None) => {}
                            Err(error) => tracing::warn!(
                                target: "cknerv-server",
                                capability = kind.capability(),
                                "optional enrichment refresh failed: {error}"
                            ),
                        }
                    }
                    Err(error) => {
                        // A source panic used to terminate the entire serial
                        // supervisor. Keep health probing alive and allow every
                        // capability to become due again instead.
                        tracker.in_flight.clear();
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
        ActivityFeedItem, ActivityFeedRecord, AssetEcosystemRecord, ChainAnchor, DaoStateRecord,
        Mutation, ReplayPhase,
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
            galaxy_composition: None,
            galaxy_composition_retry: Duration::from_secs(60),
            galaxy_top_up: Duration::from_millis(10),
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
            galaxy_composition: periodic,
            galaxy_composition_retry: Duration::from_millis(30),
            galaxy_top_up: Duration::from_secs(60),
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
            galaxy_composition: Some(Duration::from_secs(60)),
            galaxy_composition_retry: Duration::from_secs(60),
            galaxy_top_up: Duration::from_secs(60),
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
            galaxy_composition: Some(Duration::from_secs(1)),
            galaxy_composition_retry: Duration::from_secs(1),
            galaxy_top_up: Duration::from_secs(1),
            max_concurrent: 2,
        };
        let handle = tokio::spawn(run(source, state, out, shutdown_rx, cadence));

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
