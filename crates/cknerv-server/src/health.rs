//! What the process can honestly say about itself.
//!
//! Two halves of one job: a supervisor task that notices when a background
//! task has stopped running, and the report `GET /api/health` serves.
//!
//! Health is read precisely when something is wrong, so nothing in here may
//! depend on the server being well. No projection lock is taken, no
//! snapshot is serialized, the coord lock is held for a load and released,
//! and any lock some other panic poisoned is read through rather than
//! re-panicked on — a health endpoint that dies with the thing it describes
//! is worse than none at all.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tokio::sync::watch;
use tokio::task::{AbortHandle, JoinHandle};

use cknerv_core::{EnrichmentSourceState, EnrichmentSourceStatus};

use crate::projection_registry::past_poison;
use crate::state::ServerState;

/// How often the supervisor asks whether the tasks it watches are still
/// running. `is_finished()` on a handful of abort handles is a load and a
/// compare; four times a second keeps the answer fresh within a refresh.
const SUPERVISION_INTERVAL: Duration = Duration::from_millis(250);

/// Which background task a [`TaskHealth`] record describes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TaskRole {
    /// The canonical mutation reducer — everything else feeds it.
    Reducer,
    /// The optional-enrichment reducer.
    EnrichmentReducer,
    /// The enrichment source's own probe/refresh supervisor.
    EnrichmentSource,
    /// One registered [`crate::Adapter`].
    Adapter,
}

impl TaskRole {
    fn describe(self) -> &'static str {
        match self {
            Self::Reducer => "the canonical reducer",
            Self::EnrichmentReducer => "the enrichment reducer",
            Self::EnrichmentSource => "the enrichment source supervisor",
            Self::Adapter => "adapter",
        }
    }
}

/// Liveness of one supervised task.
pub(crate) struct TaskHealth {
    role: TaskRole,
    name: String,
    alive: AtomicBool,
    /// Wall clock at which the supervisor first noticed it gone. Zero while
    /// it is still running.
    exited_at_ms: AtomicU64,
}

impl TaskHealth {
    fn alive(&self) -> bool {
        self.alive.load(Ordering::Relaxed)
    }

    fn died(&self) {
        self.alive.store(false, Ordering::Relaxed);
        self.exited_at_ms.store(now_ms(), Ordering::Relaxed);
    }

    fn report(&self) -> TaskReport {
        let exited_at_ms = self.exited_at_ms.load(Ordering::Relaxed);
        TaskReport {
            name: self.name.clone(),
            alive: self.alive(),
            exited_at_ms: (exited_at_ms > 0).then_some(exited_at_ms),
        }
    }
}

/// Everything `/api/health` reports that is not derived from the entity
/// store or the projections: uptime, which build is running, and the
/// liveness the supervisor maintains.
pub(crate) struct ServerHealth {
    started_at: Instant,
    build_version: OnceLock<String>,
    tasks: RwLock<Vec<Arc<TaskHealth>>>,
    /// Last source status seen on the enrichment event pipeline, recorded
    /// as it passes so health never has to serialize the semantics
    /// projection to find out how its source is doing.
    enrichment_source: RwLock<Option<EnrichmentSourceStatus>>,
}

impl ServerHealth {
    pub(crate) fn new() -> Self {
        Self {
            started_at: Instant::now(),
            build_version: OnceLock::new(),
            tasks: RwLock::new(Vec::new()),
            enrichment_source: RwLock::new(None),
        }
    }

    /// Which build is running, for the operator comparing a bug report
    /// against a commit. Same string the SPA is handed in its runtime
    /// config; the host supplies it, because only the host binary is built
    /// with the commit stamp.
    pub(crate) fn set_build_version(&self, version: &str) {
        let _ = self.build_version.set(version.to_string());
    }

    /// Start watching one task. The returned record is what the supervisor
    /// flips; the server keeps reading it here.
    pub(crate) fn watch(&self, role: TaskRole, name: &str) -> Arc<TaskHealth> {
        let record = Arc::new(TaskHealth {
            role,
            name: name.to_string(),
            alive: AtomicBool::new(true),
            exited_at_ms: AtomicU64::new(0),
        });
        past_poison(self.tasks.write()).push(record.clone());
        record
    }

    /// Keep the latest source status as it goes past on the event
    /// pipeline. Recorded after canonical validation, so health reports the
    /// status the projections were actually given, not the one the source
    /// claimed.
    pub(crate) fn record_enrichment_status(&self, status: &EnrichmentSourceStatus) {
        *past_poison(self.enrichment_source.write()) = Some(status.clone());
    }
}

/// Watch the background tasks and say when one of them is gone.
///
/// Policy: a death is reported, never answered with an exit.
/// `spawn_projection_runtime` signals shutdown when it lags, and that is
/// right for what it guards — a desynced projection serves state that is
/// WRONG, and wrong is worse than absent. A dead adapter or reducer is a
/// different failure: what remains is STALE, not wrong, and this is a
/// visualization somebody is looking at. Freezing with a loud error and a
/// degraded `/api/health` leaves an operator a server to ask questions of;
/// exiting leaves them a blank tab and no evidence.
///
/// This is also what closes the reducer's quiet exit: when every adapter
/// drops its sender the reducer breaks out of its loop "cleanly", and
/// without this the process would keep heartbeating stale data forever
/// with nothing anywhere saying so.
pub(crate) fn spawn_supervisor(
    watched: Vec<(Arc<TaskHealth>, AbortHandle)>,
    mut shutdown: watch::Receiver<bool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            tokio::select! {
                changed = shutdown.changed() => {
                    // A closed channel means the handle that owns these
                    // tasks is gone; either way there is nothing left to
                    // supervise, and tasks exiting from here on are
                    // exiting on purpose.
                    if changed.is_err() || *shutdown.borrow() {
                        break;
                    }
                }
                _ = tokio::time::sleep(SUPERVISION_INTERVAL) => {
                    if *shutdown.borrow() {
                        break;
                    }
                    for (task, handle) in &watched {
                        if !handle.is_finished() || !task.alive() {
                            continue;
                        }
                        task.died();
                        tracing::error!(
                            target: "cknerv-server",
                            "{} `{}` exited outside shutdown — derived state is frozen \
                             from here; /api/health reports degraded",
                            task.role.describe(),
                            task.name,
                        );
                    }
                }
            }
        }
    })
}

/// The `/api/health` body.
///
/// Every field is either an atomic, a flag the supervisor maintains, or a
/// short read of the entity store. Nothing here walks a projection.
#[derive(Debug, Serialize)]
pub(crate) struct HealthReport {
    /// `null` unless the host supplied one (the CLI does).
    build_version: Option<String>,
    uptime_s: u64,
    /// True when any watched task has died or any projection is
    /// quarantined — the single field a monitor needs.
    degraded: bool,
    revision: u64,
    tip: u64,
    /// Age of the tip block by its OWN timestamp. `null` until a block has
    /// been observed.
    tip_age_ms: Option<u64>,
    replay_active: bool,
    mutation_ring_len: usize,
    /// `null` when nothing is supervising (a bare embedded `ServerState`),
    /// which is not the same claim as "alive".
    reducer_alive: Option<bool>,
    adapters: Vec<TaskReport>,
    projections: Vec<ProjectionReport>,
    /// The quarantined subset of `projections`, by name, so a monitor can
    /// alert on one field.
    quarantined_projections: Vec<&'static str>,
    enrichment: EnrichmentReport,
}

#[derive(Debug, Serialize)]
struct TaskReport {
    name: String,
    alive: bool,
    exited_at_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
struct ProjectionReport {
    name: &'static str,
    revision: u64,
    quarantined: bool,
    quarantine_reason: Option<String>,
}

#[derive(Debug, Serialize)]
struct EnrichmentReport {
    reducer_alive: Option<bool>,
    /// `null` when no enrichment source is configured at all.
    supervisor_alive: Option<bool>,
    source: Option<String>,
    status: Option<EnrichmentSourceState>,
    lag_blocks: Option<u64>,
    last_success_at_ms: Option<u64>,
}

pub(crate) fn report(state: &ServerState) -> HealthReport {
    let health = state.health();
    let tasks = past_poison(health.tasks.read()).clone();
    let alive_in = |role: TaskRole| -> Option<bool> {
        tasks
            .iter()
            .filter(|task| task.role == role)
            .fold(None, |all, task| Some(all.unwrap_or(true) && task.alive()))
    };
    let adapters: Vec<TaskReport> = tasks
        .iter()
        .filter(|task| task.role == TaskRole::Adapter)
        .map(|task| task.report())
        .collect();

    let (revision, tip, last_block_ts_ms) = state.health_vitals();
    let projections: Vec<ProjectionReport> = past_poison(state.projections.read())
        .runtimes()
        .iter()
        .map(|runtime| {
            let reason = runtime.quarantine_reason();
            ProjectionReport {
                name: runtime.name(),
                revision: runtime.revision(),
                quarantined: reason.is_some(),
                quarantine_reason: reason.map(|reason| reason.to_string()),
            }
        })
        .collect();
    let quarantined_projections: Vec<&'static str> = projections
        .iter()
        .filter(|projection| projection.quarantined)
        .map(|projection| projection.name)
        .collect();

    let reducer_alive = alive_in(TaskRole::Reducer);
    let enrichment_source = past_poison(health.enrichment_source.read()).clone();
    let degraded = !quarantined_projections.is_empty() || tasks.iter().any(|task| !task.alive());

    HealthReport {
        build_version: health.build_version.get().cloned(),
        uptime_s: health.started_at.elapsed().as_secs(),
        degraded,
        revision,
        tip,
        tip_age_ms: last_block_ts_ms.map(|at| now_ms().saturating_sub(at)),
        replay_active: state.replay_active(),
        mutation_ring_len: state.mutation_ring.len(),
        reducer_alive,
        adapters,
        projections,
        quarantined_projections,
        enrichment: EnrichmentReport {
            reducer_alive: alive_in(TaskRole::EnrichmentReducer),
            supervisor_alive: alive_in(TaskRole::EnrichmentSource),
            source: enrichment_source
                .as_ref()
                .map(|status| status.source.clone()),
            status: enrichment_source.as_ref().map(|status| status.status),
            lag_blocks: enrichment_source.as_ref().and_then(|s| s.lag_blocks),
            last_success_at_ms: enrichment_source.and_then(|s| s.last_success_at_ms),
        },
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_millis() as u64)
}
