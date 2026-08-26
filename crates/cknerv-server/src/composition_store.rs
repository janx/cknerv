//! Cross-run memory for the curated CellGalaxy composition.
//!
//! Curating a stage costs a source several thousand index pages and the
//! node a few hundred batched `get_live_cell` calls — around a minute of
//! work that, until now, every boot paid again from nothing. The set it
//! arrives at is not cheap and not arbitrary: it is the whole of what the
//! stage looks like. This module gives that set a life longer than the
//! process.
//!
//! Two halves, and the asymmetry between them is the whole design:
//!
//! * **Remembering** is a file write. `<workdir>/galaxy-composition.json`
//!   holds a schema-versioned envelope around the exact
//!   [`GalaxyCompositionRecord`] a source last proved, written atomically
//!   (tmp → rename, the [`crate::persistence`] idiom) so a crash mid-write
//!   leaves the previous record standing rather than half of the new one.
//!
//! * **Restoring** is NOT a file read. What comes back off disk is a list
//!   of outpoints that used to be live, which is exactly the shape
//!   ckbadger's discovery produces and exactly as untrustworthy: anything
//!   in it may have been spent while this process was down. So the
//!   restore feeds the held record back through the SAME canonical
//!   hydrator a fresh composition goes through — every outpoint re-read
//!   against the node, capacity re-checked, class re-checked, dead cells
//!   dropped — and stages only what survives. The trust boundary does not
//!   move an inch: nothing reaches the stage that the node did not
//!   re-affirm seconds ago.
//!
//! ## What the restored record says about itself
//!
//! Two fields carry the difference, and both are deliberate.
//!
//! `source` gains a ` (restored)` suffix. That is provenance — the
//! membership came out of this file, not out of a live index — and it is
//! also what keeps the boot honest: the display plane dedupes a refresh by
//! CONTENT, and `source` is part of that content
//! ([`GalaxyCompositionRecord::content_matches`]). On a quiet chain the
//! fresh composition that lands a minute later can be cell-for-cell
//! identical to the restored one, and a plain dedupe would swallow it —
//! leaving the stage correct but its provenance frozen on the restore
//! forever. A distinct source name means the fresh record always applies.
//!
//! `as_of` is the canonical block the restore is INSTALLED at, not the one
//! the record was originally curated at. The persisted anchor is
//! interesting — it is logged, and a large age is worth a warning — but it
//! cannot be the record's anchor, for two structural reasons rather than
//! one aesthetic one:
//!
//! 1. [`crate::state::ServerState::apply_enrichment`] refuses any anchored
//!    event whose block/hash is outside the retained 50-block canonical
//!    evidence ring. A composition curated at the last boot is hours or
//!    days behind that window; delivered under its own anchor it would be
//!    discarded at the door, every time, on every warm boot.
//! 2. The display plane degrades the reservoir when a rollback reaches at
//!    or below its anchor. An ancient anchor sits below every reorg that
//!    can ever happen, so the restored reservoir would become the one
//!    reservoir a reorg cannot dislodge — precisely backwards, because
//!    what proves these cells live is a node read taken at the CURRENT
//!    tip, which is exactly what a reorg near the tip can undo.
//!
//! So the anchor names what it always names on a hydrated record: the
//! height the membership was proven at. Here that is now.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use cknerv_core::projection::display_plane::DISPLAY_CURATED_FIELD;
use cknerv_core::{
    Cell, ChainAnchor, EnrichmentEvent, GalaxyCellCandidate, GalaxyCompositionCandidates,
    GalaxyCompositionRecord, GalaxyCompositionTarget,
};

use crate::enrichment::GalaxyCompositionHydrator;
use crate::state::ServerState;

/// Bumped when the on-disk shape changes incompatibly. An older or newer
/// file is discarded rather than guessed at — the record is derived state
/// a single composition refresh rebuilds.
const SCHEMA_VERSION: u32 = 1;

/// Filename inside `<workdir>/`. The atomic write goes to `<name>.tmp` and
/// renames over it, the same shape `cknerv-state.json` uses — and a
/// deliberately different FILE, so a composition that fails to serialize
/// can never cost the canonical checkpoint.
const FILE_NAME: &str = "galaxy-composition.json";

/// Appended to the persisted record's source name for the restored copy.
/// It can never stack: the restore's own record is never written back to
/// disk (see [`CompositionStore::remember`]).
const RESTORED_SUFFIX: &str = " (restored)";

/// How often the restore looks for canonical evidence to anchor itself to.
const EVIDENCE_POLL: Duration = Duration::from_millis(250);

/// How long it looks before giving up. A warm boot resumes from a
/// persisted cursor and has evidence on the first poll; a boot that
/// rebuilds canonical state instead has to wait out the replay, and past
/// this point fresh discovery is the better answer anyway.
const EVIDENCE_DEADLINE: Duration = Duration::from_secs(600);

/// Age, in blocks, past which the persisted curation gets a warning rather
/// than an info line.
///
/// NOT a discard threshold, and there deliberately isn't one. Age is not
/// rot: liveness here is decided cell by cell by the node, so a record
/// from last week restores exactly as safely as one from last hour — it
/// just restores fewer cells, and the top-up burst closes the rest. Ten
/// thousand blocks is roughly a day at CKB's cadence, which is the point
/// where "the stage you are looking at was curated a while ago" is worth
/// saying out loud.
const STALE_AGE_BLOCKS: u64 = 10_000;

/// On-disk envelope. Serialized by reference so remembering a full-size
/// record does not need a second copy of it in memory.
#[derive(Serialize)]
struct StoredComposition<'a> {
    schema_version: u32,
    record: &'a GalaxyCompositionRecord,
}

#[derive(Deserialize)]
struct HeldComposition {
    schema_version: u32,
    record: GalaxyCompositionRecord,
}

/// The file, and the two things anyone does with it.
pub(crate) struct CompositionStore {
    path: PathBuf,
}

impl CompositionStore {
    pub(crate) fn new(workdir: &Path) -> Self {
        Self {
            path: workdir.join(FILE_NAME),
        }
    }

    /// Remember one whole composition.
    ///
    /// Called once per successful composition refresh, which on the
    /// shipped cadence (D7 — the composition runs once and holds) means
    /// roughly once per process. Top-ups deliberately do NOT come through
    /// here: a top-up hands the stage a few hundred extra cells for a
    /// class it was short of, mutating the STAGE and not the record, so
    /// writing one would leave the file naming a composition no source
    /// ever proved as a whole. What the file holds is always a record some
    /// source derived and the node validated end to end.
    ///
    /// The restored record is likewise never written back. It is a subset
    /// of what is already here, discovered nothing, and would only teach
    /// the file to call itself restored.
    ///
    /// Never fails loudly: a full-size record is 10–15 MB of JSON and a
    /// disk that cannot take it is a reason to log, not a reason to lose a
    /// composition the stage is otherwise about to seat.
    pub(crate) async fn remember(&self, record: &GalaxyCompositionRecord) {
        let path = self.path.clone();
        let cells = held(record);
        // Copy rather than serialize here: serializing 12,000 cells is
        // hundreds of milliseconds of CPU, and this runs on a tokio worker.
        // The clone is a memcpy; the expensive half goes to the blocking pool.
        let record = record.clone();
        match tokio::task::spawn_blocking(move || write(&path, &record)).await {
            Ok(Ok(())) => tracing::info!(
                target: "cknerv-server",
                cells,
                "remembered the CellGalaxy composition for the next boot"
            ),
            Ok(Err(error)) => tracing::warn!(
                target: "cknerv-server",
                "failed to remember the CellGalaxy composition: {error}"
            ),
            Err(error) => tracing::warn!(
                target: "cknerv-server",
                "the CellGalaxy composition write task failed: {error}"
            ),
        }
    }
}

fn held(record: &GalaxyCompositionRecord) -> usize {
    record.dao.len() + record.typed.len() + record.plain.len()
}

/// Atomic write: the whole envelope lands in `<name>.tmp` first and is
/// renamed over the live file, so a reader never sees a partial record and
/// a failed write leaves the previous one intact.
fn write(path: &Path, record: &GalaxyCompositionRecord) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(&StoredComposition {
        schema_version: SCHEMA_VERSION,
        record,
    })
    .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Read the held record, or nothing at all.
///
/// Every failure is the same failure — there is no composition to restore
/// — and every one of them is survivable by definition, because it is the
/// state every first boot is in. Missing, unreadable, corrupt and
/// schema-mismatched all return `None`; the last two also delete the file,
/// matching [`crate::persistence::load`], since a record that cannot be
/// parsed cannot become useful later and the next refresh rewrites it.
fn read(path: &Path) -> Option<GalaxyCompositionRecord> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            tracing::info!(
                target: "cknerv-server",
                "no remembered CellGalaxy composition; the stage composes from discovery"
            );
            return None;
        }
        Err(error) => {
            tracing::warn!(
                target: "cknerv-server",
                "read {}: {error} — composing from discovery instead",
                path.display()
            );
            return None;
        }
    };
    let envelope: HeldComposition = match serde_json::from_slice(&bytes) {
        Ok(envelope) => envelope,
        Err(error) => {
            tracing::warn!(
                target: "cknerv-server",
                "parse {}: {error} — discarding and composing from discovery instead",
                path.display()
            );
            let _ = std::fs::remove_file(path);
            return None;
        }
    };
    if envelope.schema_version != SCHEMA_VERSION {
        tracing::warn!(
            target: "cknerv-server",
            "remembered composition schema {} != current {SCHEMA_VERSION} — discarding",
            envelope.schema_version
        );
        let _ = std::fs::remove_file(path);
        return None;
    }
    Some(envelope.record)
}

/// What a held record looks like to the canonical hydrator: outpoints with
/// the capacity and birth height they had when they were curated, which is
/// exactly the discovery-hint shape ckbadger produces and exactly as
/// unverified. The hydrator re-reads each one and refuses any the node
/// disagrees with.
///
/// Targets are the CURATED FIELD's class quotas — the budget less the
/// display plane's standing recency window, which is staffed from the
/// canonical stream and is not the composition's to fill — clamped to what
/// the record actually holds. The restore is not an opportunity to seat
/// more than was curated, only to seat again what survived.
fn candidates_for(
    record: &GalaxyCompositionRecord,
    as_of: ChainAnchor,
    updated_at_ms: u64,
) -> GalaxyCompositionCandidates {
    let budget = GalaxyCompositionTarget::for_total(DISPLAY_CURATED_FIELD);
    GalaxyCompositionCandidates {
        source: restored_source(&record.source),
        as_of,
        updated_at_ms,
        target: GalaxyCompositionTarget {
            dao: budget.dao.min(record.dao.len()),
            typed: budget.typed.min(record.typed.len()),
            plain: budget.plain.min(record.plain.len()),
        },
        dao: hints(&record.dao),
        typed: hints(&record.typed),
        plain: hints(&record.plain),
    }
}

fn hints(cells: &[Cell]) -> Vec<GalaxyCellCandidate> {
    cells
        .iter()
        .map(|cell| GalaxyCellCandidate {
            out_point: cell.out_point.clone(),
            capacity: cell.capacity,
            birth_block: cell.birth_block,
        })
        .collect()
}

/// See the module doc: this is what keeps a content-identical fresh
/// composition from being read as a duplicate of the restore.
fn restored_source(source: &str) -> String {
    format!("{source}{RESTORED_SUFFIX}")
}

/// Wire the two halves together for one boot.
///
/// Runs entirely beside canonical boot — it holds no canonical lock, sits
/// on no critical path, and every branch below ends in "log it and let the
/// ordinary composition happen". The one thing it must never do is stage
/// something the node did not just affirm, and the hydrator is what makes
/// that structural rather than careful.
pub(crate) fn spawn_restore(
    hydrator: Arc<dyn GalaxyCompositionHydrator>,
    state: Arc<ServerState>,
    workdir: PathBuf,
    out: mpsc::Sender<EnrichmentEvent>,
    shutdown: watch::Receiver<bool>,
) -> JoinHandle<()> {
    tokio::spawn(restore(
        hydrator,
        state,
        workdir.join(FILE_NAME),
        out,
        shutdown,
        EVIDENCE_DEADLINE,
    ))
}

async fn restore(
    hydrator: Arc<dyn GalaxyCompositionHydrator>,
    state: Arc<ServerState>,
    path: PathBuf,
    out: mpsc::Sender<EnrichmentEvent>,
    mut shutdown: watch::Receiver<bool>,
    deadline: Duration,
) {
    let reading = path.clone();
    let Ok(Some(record)) = tokio::task::spawn_blocking(move || read(&reading)).await else {
        return;
    };
    if held(&record) == 0 {
        tracing::info!(
            target: "cknerv-server",
            "the remembered CellGalaxy composition is empty; composing from discovery instead"
        );
        return;
    }

    let Some(anchor) = wait_for_evidence(&state, &mut shutdown, deadline).await else {
        return;
    };
    let age = anchor.block.saturating_sub(record.as_of.block);
    if age > STALE_AGE_BLOCKS {
        tracing::warn!(
            target: "cknerv-server",
            curated_at = record.as_of.block,
            tip = anchor.block,
            age_blocks = age,
            cells = held(&record),
            "the remembered CellGalaxy composition is old; revalidating it anyway — the node decides liveness cell by cell, so age costs cells, not correctness"
        );
    } else {
        tracing::info!(
            target: "cknerv-server",
            curated_at = record.as_of.block,
            tip = anchor.block,
            age_blocks = age,
            cells = held(&record),
            "revalidating the remembered CellGalaxy composition through the node"
        );
    }

    let offered = held(&record);
    // The anchor here is the height the node is being asked at; the one the
    // record ships under is re-read below, once the answers are in.
    let candidates = candidates_for(&record, anchor, now_ms());
    // The held copy is the larger of the two and has nothing left to say;
    // let go of it before the node batches start rather than carry a
    // full-size record through every one of them.
    drop(record);
    let mut restored = match hydrator.hydrate_galaxy_composition(candidates).await {
        Ok(restored) => restored,
        Err(error) => {
            tracing::warn!(
                target: "cknerv-server",
                "could not revalidate the remembered CellGalaxy composition: {error}"
            );
            return;
        }
    };
    let landed = held(&restored);
    if landed == 0 {
        tracing::info!(
            target: "cknerv-server",
            offered,
            "nothing in the remembered CellGalaxy composition is still live; composing from discovery instead"
        );
        return;
    }
    // A fresh composition that landed while the node was answering has
    // strictly better provenance than this one. Attrition is not a reason
    // to hold back — a thin restored stage is still a curated stage and
    // the top-up burst closes the rest — but losing to discovery is.
    if state.composition_demand().curated {
        tracing::info!(
            target: "cknerv-server",
            "a fresh composition staffed the stage while the remembered one was revalidating; dropping the restore"
        );
        return;
    }
    // Re-anchor at the door. The reducer checks the record against the
    // evidence ring as it is NOW, and the node has been working through a
    // couple of hundred batches since the anchor above was read — long
    // enough for a one-block reorg at the tip to have dropped exactly that
    // block from the ring and cost a restore that is otherwise perfectly
    // good. Nothing is lost by moving it: every cell in here was proved
    // live by a node read taken during that same window, so the newest
    // block this server can prove is the honest height for all of them.
    let Some(anchor) = current_anchor(&state) else {
        tracing::info!(
            target: "cknerv-server",
            "canonical evidence went away while the remembered composition was revalidating; dropping the restore"
        );
        return;
    };
    restored.as_of = anchor;
    tracing::info!(
        target: "cknerv-server",
        offered,
        landed,
        dropped = offered.saturating_sub(landed),
        at = restored.as_of.block,
        "restored the remembered CellGalaxy composition"
    );
    let _ = out
        .send(EnrichmentEvent::GalaxyCompositionReplace(restored))
        .await;
}

/// Wait for a canonical block this server can prove, and hand back the
/// anchor the restore will install under.
///
/// A warm boot resumes from a persisted cursor, so the ring is already
/// full and the first poll returns. A boot that rebuilds canonical state
/// waits out the replay instead — bounded, interruptible, and abandoned
/// entirely the moment the stage becomes curated by other means.
async fn wait_for_evidence(
    state: &ServerState,
    shutdown: &mut watch::Receiver<bool>,
    deadline: Duration,
) -> Option<ChainAnchor> {
    let started = Instant::now();
    let mut poll = tokio::time::interval(EVIDENCE_POLL);
    loop {
        tokio::select! {
            _ = poll.tick() => {
                if state.composition_demand().curated {
                    tracing::info!(
                        target: "cknerv-server",
                        "the stage is already curated; the remembered composition is not needed"
                    );
                    return None;
                }
                if let Some(anchor) = current_anchor(state) {
                    return Some(anchor);
                }
                if started.elapsed() >= deadline {
                    tracing::warn!(
                        target: "cknerv-server",
                        "no canonical evidence within {}s; leaving the stage to discovery",
                        deadline.as_secs()
                    );
                    return None;
                }
            }
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() {
                    return None;
                }
            }
        }
    }
}

/// The newest block the canonical evidence ring can prove — which is both
/// the anchor the reducer will check the restore against and the height
/// the node's liveness answers belong to. `None` while a replay is
/// rebuilding that ring.
fn current_anchor(state: &ServerState) -> Option<ChainAnchor> {
    let context = state.canonical_context();
    if context.replay_active {
        return None;
    }
    context.recent_blocks.last().map(|block| ChainAnchor {
        block: block.number,
        hash: block.hash.clone(),
    })
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    use async_trait::async_trait;
    use cknerv_core::{AssetKind, GalaxyCompositionTopUp, Mutation, OutPoint};

    /// The hand-rolled scratch directory the state persistence tests use,
    /// labelled per test so parallel runs cannot share a nanosecond — and
    /// self-removing, because a full-size record is 15 MB and these ones
    /// only differ from it in scale.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(label: &str) -> Self {
            let mut path = std::env::temp_dir();
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            path.push(format!("cknerv-composition-{label}-{nonce}"));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn file(&self) -> PathBuf {
            self.0.join(FILE_NAME)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn cell(id: u64, kind: AssetKind, prefix: &str) -> Cell {
        Cell {
            id,
            born_at_ms: 0,
            death_at_ms: None,
            birth_block: 7,
            tag: None,
            pos_seed: cknerv_core::helix_seed_for(id),
            out_point: OutPoint {
                tx_hash: format!("0x{prefix}{id:062x}"),
                index: 0,
            },
            capacity: 500 + id,
            data_hex: "0x".into(),
            data_bytes: 0,
            content_hash: format!("0x{id:064x}"),
            lock_shape_seed: [id as u32, 1],
            type_shape_seed: None,
            data_shape_seed: [id as u32, 2],
            lock_kind: Default::default(),
            asset_kind: kind,
            lock_script: Default::default(),
            type_script: None,
            collection_seed: None,
        }
    }

    /// `0xde…` outpoints stand for cells spent while the process was down.
    fn record(block: u64) -> GalaxyCompositionRecord {
        GalaxyCompositionRecord {
            source: "ckbadger".into(),
            as_of: ChainAnchor {
                block,
                hash: format!("0x{block:x}"),
            },
            updated_at_ms: 9_000,
            dao: vec![cell(1, AssetKind::Dao, "ab"), cell(2, AssetKind::Dao, "de")],
            typed: vec![cell(3, AssetKind::Xudt, "ab")],
            plain: vec![cell(4, AssetKind::Native, "de")],
        }
    }

    /// The node the restore validates against: everything survives except
    /// the `0xde…` outpoints, which are spent.
    struct SpendingNode;

    #[async_trait]
    impl GalaxyCompositionHydrator for SpendingNode {
        async fn hydrate_galaxy_composition(
            &self,
            candidates: GalaxyCompositionCandidates,
        ) -> anyhow::Result<GalaxyCompositionRecord> {
            let live = |bucket: &[GalaxyCellCandidate], kind: AssetKind| {
                bucket
                    .iter()
                    .filter(|candidate| !candidate.out_point.tx_hash.starts_with("0xde"))
                    .enumerate()
                    .map(|(i, candidate)| {
                        let mut cell = cell(i as u64, kind, "ab");
                        cell.out_point = candidate.out_point.clone();
                        cell.capacity = candidate.capacity;
                        cell.birth_block = candidate.birth_block;
                        cell
                    })
                    .collect()
            };
            Ok(GalaxyCompositionRecord {
                source: candidates.source.clone(),
                as_of: candidates.as_of.clone(),
                updated_at_ms: candidates.updated_at_ms,
                dao: live(&candidates.dao, AssetKind::Dao),
                typed: live(&candidates.typed, AssetKind::Xudt),
                plain: live(&candidates.plain, AssetKind::Native),
            })
        }

        async fn hydrate_galaxy_top_up(
            &self,
            _candidates: GalaxyCompositionCandidates,
        ) -> anyhow::Result<GalaxyCompositionTopUp> {
            unreachable!("the restore never tops up")
        }
    }

    /// A node that takes long enough for the chain to move under it —
    /// which, on mainnet, roughly two hundred batches always does.
    struct MiningNode(Arc<ServerState>, u64);

    #[async_trait]
    impl GalaxyCompositionHydrator for MiningNode {
        async fn hydrate_galaxy_composition(
            &self,
            candidates: GalaxyCompositionCandidates,
        ) -> anyhow::Result<GalaxyCompositionRecord> {
            self.0.apply_mutation(Mutation::BlockMined {
                number: self.1,
                hash: format!("0x{:x}", self.1),
                tx_count: 0,
                size: 0,
                at: 2,
                producer_key: None,
                producer_message: None,
            });
            SpendingNode.hydrate_galaxy_composition(candidates).await
        }

        async fn hydrate_galaxy_top_up(
            &self,
            _candidates: GalaxyCompositionCandidates,
        ) -> anyhow::Result<GalaxyCompositionTopUp> {
            unreachable!("the restore never tops up")
        }
    }

    /// A node that refuses — the restore has to be survivable.
    struct UnreachableNode;

    #[async_trait]
    impl GalaxyCompositionHydrator for UnreachableNode {
        async fn hydrate_galaxy_composition(
            &self,
            _candidates: GalaxyCompositionCandidates,
        ) -> anyhow::Result<GalaxyCompositionRecord> {
            Err(anyhow::anyhow!("node refused the batch"))
        }

        async fn hydrate_galaxy_top_up(
            &self,
            _candidates: GalaxyCompositionCandidates,
        ) -> anyhow::Result<GalaxyCompositionTopUp> {
            unreachable!("the restore never tops up")
        }
    }

    fn mined_state(number: u64) -> Arc<ServerState> {
        let state = Arc::new(ServerState::new());
        state.apply_mutation(Mutation::BlockMined {
            number,
            hash: format!("0x{number:x}"),
            tx_count: 0,
            size: 0,
            at: 1,
            producer_key: None,
            producer_message: None,
        });
        state
    }

    async fn run_restore(
        hydrator: Arc<dyn GalaxyCompositionHydrator>,
        state: Arc<ServerState>,
        path: PathBuf,
    ) -> Option<EnrichmentEvent> {
        let (out, mut events) = mpsc::channel(4);
        let (_tx, shutdown) = watch::channel(false);
        restore(
            hydrator,
            state,
            path,
            out,
            shutdown,
            Duration::from_millis(200),
        )
        .await;
        events.try_recv().ok()
    }

    #[test]
    fn a_remembered_composition_round_trips_byte_for_byte() {
        let scratch = Scratch::new("round-trip");
        let path = scratch.file();
        let original = record(4_000);

        write(&path, &original).unwrap();
        assert_eq!(read(&path), Some(original));
    }

    /// tmp → rename is what makes a failed write cost nothing. Blocking
    /// the tmp path (a directory sits where the temporary file wants to
    /// be) stands in for the disk giving out mid-write.
    #[test]
    fn a_failed_write_leaves_the_previous_record_standing() {
        let scratch = Scratch::new("failed-write");
        let path = scratch.file();
        let first = record(4_000);
        write(&path, &first).unwrap();

        std::fs::create_dir(path.with_extension("json.tmp")).unwrap();
        let second = record(5_000);
        assert!(write(&path, &second).is_err());

        assert_eq!(read(&path), Some(first), "the live file never moved");
    }

    #[test]
    fn a_corrupt_file_is_discarded_rather_than_guessed_at() {
        let scratch = Scratch::new("corrupt");
        let path = scratch.file();
        std::fs::write(&path, b"{not json at all").unwrap();

        assert_eq!(read(&path), None);
        assert!(!path.exists(), "an unparseable record cannot become useful");
    }

    #[test]
    fn a_record_from_another_schema_is_skipped() {
        let scratch = Scratch::new("schema");
        let path = scratch.file();
        let envelope = serde_json::json!({
            "schema_version": SCHEMA_VERSION + 1,
            "record": serde_json::to_value(record(4_000)).unwrap(),
        });
        std::fs::write(&path, serde_json::to_vec(&envelope).unwrap()).unwrap();

        assert_eq!(read(&path), None);
    }

    #[test]
    fn a_missing_file_is_simply_no_composition() {
        let scratch = Scratch::new("missing");
        let path = scratch.file();
        assert_eq!(read(&path), None);
    }

    /// The whole point of routing the restore through the hydrator: what
    /// was spent while the process was down does not come back.
    #[tokio::test]
    async fn the_restore_drops_what_the_node_no_longer_holds() {
        let scratch = Scratch::new("attrition");
        let path = scratch.file();
        write(&path, &record(4_000)).unwrap();

        let event = run_restore(Arc::new(SpendingNode), mined_state(9_000), path)
            .await
            .expect("the restore delivers");
        let EnrichmentEvent::GalaxyCompositionReplace(restored) = event else {
            panic!("the restore uses the ordinary composition channel");
        };

        assert_eq!(restored.dao.len(), 1, "the spent DAO cell stayed dead");
        assert_eq!(restored.typed.len(), 1);
        assert!(
            restored.plain.is_empty(),
            "the spent plain cell stayed dead"
        );
        assert!(restored
            .dao
            .iter()
            .chain(&restored.typed)
            .all(|cell| cell.out_point.tx_hash.starts_with("0xab")));
    }

    /// The anchor is the height the membership was proven at — the tip the
    /// node answered from — not the height it was curated at. Delivered
    /// under the persisted anchor the record would be refused at the door
    /// (`apply_enrichment` only accepts anchors inside the retained
    /// evidence ring) on every warm boot there has ever been.
    #[tokio::test]
    async fn the_restore_installs_under_an_anchor_the_server_can_prove() {
        let scratch = Scratch::new("anchor");
        let path = scratch.file();
        write(&path, &record(4_000)).unwrap();
        let state = mined_state(9_000);

        let event = run_restore(Arc::new(SpendingNode), state.clone(), path)
            .await
            .expect("the restore delivers");
        let EnrichmentEvent::GalaxyCompositionReplace(restored) = event else {
            panic!("the restore uses the ordinary composition channel");
        };

        assert_eq!(restored.as_of.block, 9_000);
        assert_eq!(restored.as_of.hash, format!("0x{:x}", 9_000));
        assert!(
            state.apply_enrichment(EnrichmentEvent::GalaxyCompositionReplace(restored)),
            "and that anchor is one the reducer accepts"
        );
    }

    /// The anchor is read again at the door rather than kept from before
    /// the node batches: a one-block reorg during those seconds would drop
    /// the earlier block out of the evidence ring and the reducer would
    /// refuse a restore that is otherwise entirely sound.
    #[tokio::test]
    async fn the_anchor_is_the_one_the_ring_holds_when_the_restore_arrives() {
        let scratch = Scratch::new("re-anchor");
        let path = scratch.file();
        write(&path, &record(4_000)).unwrap();
        let state = mined_state(9_000);

        let event = run_restore(
            Arc::new(MiningNode(state.clone(), 9_001)),
            state.clone(),
            path,
        )
        .await
        .expect("the restore delivers");
        let EnrichmentEvent::GalaxyCompositionReplace(restored) = event else {
            panic!("the restore uses the ordinary composition channel");
        };

        assert_eq!(
            restored.as_of.block, 9_001,
            "the block that arrived meanwhile"
        );
        assert!(state.apply_enrichment(EnrichmentEvent::GalaxyCompositionReplace(restored)));
    }

    /// The dedupe the display plane runs is on CONTENT, and `source` is
    /// content. Without a distinct name a quiet chain could hand back a
    /// cell-for-cell identical fresh composition, which would be swallowed
    /// as a duplicate and leave the stage's provenance frozen on the
    /// restore.
    #[test]
    fn a_fresh_composition_is_never_a_duplicate_of_the_restore() {
        let fresh = record(9_000);
        let mut restored = fresh.clone();
        restored.source = restored_source(&fresh.source);

        assert!(
            !restored.content_matches(&fresh),
            "identical cells, different provenance — the fresh record must still apply"
        );
        assert_eq!(restored.source, "ckbadger (restored)");
    }

    /// Targets never exceed what was curated: the restore seats again what
    /// survived, it does not invent room.
    #[test]
    fn targets_are_clamped_to_what_the_record_holds() {
        let held = record(4_000);
        let candidates = candidates_for(
            &held,
            ChainAnchor {
                block: 9_000,
                hash: "0x9".into(),
            },
            5,
        );

        assert_eq!(candidates.target.dao, 2);
        assert_eq!(candidates.target.typed, 1);
        assert_eq!(candidates.target.plain, 1);
        assert_eq!(candidates.dao[0].capacity, held.dao[0].capacity);
        assert_eq!(candidates.dao[0].birth_block, held.dao[0].birth_block);
    }

    /// Every failure below is the state a first boot is already in, so
    /// every one of them has to look exactly like it: nothing delivered,
    /// nothing blocked, discovery composes the stage.
    #[tokio::test]
    async fn nothing_remembered_is_indistinguishable_from_a_cold_boot() {
        let event = run_restore(
            Arc::new(SpendingNode),
            mined_state(9_000),
            Scratch::new("cold-boot").file(),
        )
        .await;
        assert!(event.is_none());
    }

    #[tokio::test]
    async fn a_node_that_refuses_the_batch_costs_the_restore_and_nothing_else() {
        let scratch = Scratch::new("node-refused");
        let path = scratch.file();
        write(&path, &record(4_000)).unwrap();

        let event = run_restore(Arc::new(UnreachableNode), mined_state(9_000), path).await;
        assert!(event.is_none());
    }

    /// Canonical evidence is what the restore anchors to. Without it the
    /// wait times out and the boot proceeds untouched.
    #[tokio::test]
    async fn a_server_with_no_canonical_evidence_yet_is_waited_for_and_given_up_on() {
        let scratch = Scratch::new("no-evidence");
        let path = scratch.file();
        write(&path, &record(4_000)).unwrap();

        let started = Instant::now();
        let event = run_restore(
            Arc::new(SpendingNode),
            Arc::new(ServerState::new()),
            path.clone(),
        )
        .await;
        assert!(event.is_none());
        assert!(started.elapsed() >= Duration::from_millis(200));
        assert!(path.exists(), "and the record is still there for next time");
    }
}
