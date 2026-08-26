//! Cross-run persistence for the chain entity + registered projections.
//!
//! Lifted from `simulator/src/dashboard/persistence.rs`, scoped to
//! cknerv-server's responsibility: persist the [`Chain`] singleton +
//! every registered projection's `save()` blob to a single JSON file
//! after boot replay and on shutdown, hydrate it on boot. RCG entity persistence stays in
//! simulator.
//!
//! On-disk format (per spec §6):
//!
//! ```json
//! {
//!   "schema_version": 5,
//!   "entities":   { "revision": N, "chain": {...}, "chain_nodes": [...] },
//!   "projections": { "<projection-name>": <save-blob>, ... }
//!   // NOTE: live `peers` are ephemeral and intentionally NOT persisted.
//! }
//! ```
//!
//! Atomic write via `.tmp` → rename. Failure on read / parse / hydrate
//! logs a warning and falls through to the empty-state path —
//! persistence is best-effort and never wedges the server on a corrupt
//! save file.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::state::ServerState;
use cknerv_core::RecentBlock;

/// Bumped when the on-disk shape changes incompatibly. Older files are
/// ignored on load.
///
/// 5: Cells carry canonical per-component morphology seeds and the complete
/// output-data byte length. Schema-4 rows only deserialize to compatibility
/// defaults, which are not valid production morphology inputs.
///
/// 4: `data_hex` truncation switched to a single ASCII marker. A v3 save
/// still holds the multi-byte one, which the columnar encoder can only
/// ship sanitized — discarding the save is cheaper and honest.
pub const SCHEMA_VERSION: u32 = 5;

/// Filename inside `<workdir>/`. Atomic write goes to `<name>.tmp` and
/// renames over it. Per spec §6.
const FILE_NAME: &str = "cknerv-state.json";

#[derive(Serialize, Deserialize)]
pub struct PersistedFile {
    pub schema_version: u32,
    pub entities: serde_json::Value,
    pub projections: serde_json::Value,
}

pub fn persisted_path(workdir: &Path) -> PathBuf {
    workdir.join(FILE_NAME)
}

/// Outcome of a load attempt.
#[derive(Debug, Default)]
pub struct LoadOutcome {
    /// True iff a file was found AND successfully applied.
    pub restored: bool,
    /// The chain tip immediately after restore (for callers that resume
    /// indexing from there). `None` if nothing was restored.
    pub restored_chain_tip: Option<u64>,
}

/// Minimal canonical cursor needed by an adapter to resume without assuming
/// that the saved height still belongs to the node's current main chain.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RestoredChainCursor {
    pub tip: u64,
    pub recent_blocks: Vec<RecentBlock>,
    /// Largest live-Cell reservoir target fully represented by the saved
    /// cells projection. Zero denotes legacy/fixed-window state.
    pub hydrated_cell_target: usize,
}

/// Serialize the chain entity + every registered projection. Writes
/// `<workdir>/cknerv-state.json` atomically.
pub fn save(state: &Arc<ServerState>, workdir: &Path) -> std::io::Result<()> {
    let entities = state.save_entities();
    let projections = state.projections.read().unwrap().save_all();
    let file = PersistedFile {
        schema_version: SCHEMA_VERSION,
        entities,
        projections,
    };
    let bytes = serde_json::to_vec(&file)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let final_path = persisted_path(workdir);
    let tmp_path = final_path.with_extension("json.tmp");
    if let Some(parent) = final_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&tmp_path, bytes)?;
    std::fs::rename(&tmp_path, &final_path)?;
    Ok(())
}

/// Try to hydrate `state` from `<workdir>/cknerv-state.json`. Logs and
/// falls through to the empty-state path on any error / schema mismatch.
pub fn load(state: Arc<ServerState>, workdir: &Path) -> LoadOutcome {
    let path = persisted_path(workdir);
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return LoadOutcome::default();
        }
        Err(e) => {
            tracing::warn!(
                target: "cknerv-server",
                "read {}: {e} — starting empty",
                path.display()
            );
            return LoadOutcome::default();
        }
    };
    let file: PersistedFile = match serde_json::from_slice(&bytes) {
        Ok(f) => f,
        Err(e) => {
            tracing::warn!(
                target: "cknerv-server",
                "parse {}: {e} — discarding and starting empty",
                path.display()
            );
            let _ = std::fs::remove_file(&path);
            return LoadOutcome::default();
        }
    };
    if file.schema_version != SCHEMA_VERSION {
        tracing::warn!(
            target: "cknerv-server",
            "persisted state schema {} != current {} — discarding",
            file.schema_version,
            SCHEMA_VERSION
        );
        let _ = std::fs::remove_file(&path);
        return LoadOutcome::default();
    }
    if let Err(e) = state.load_entities(file.entities) {
        tracing::warn!(
            target: "cknerv-server",
            "hydrate entities: {e} — starting empty"
        );
        let _ = std::fs::remove_file(&path);
        return LoadOutcome::default();
    }
    {
        let registry = state.projections.read().unwrap();
        registry.load_all(&file.projections);
    }
    let restored_tip = state.snapshot()["chain"]["tip"].as_u64();
    LoadOutcome {
        restored: true,
        restored_chain_tip: restored_tip,
    }
}

/// Lightweight read of the persisted chain tip without mutating any
/// server state. Returns `None` if the file is absent, unparseable, or
/// the schema mismatches. The CLI uses this to decide whether to skip
/// the boot backfill and resume the forward poll from the saved tip.
pub fn peek_restored_tip(workdir: &Path) -> Option<u64> {
    peek_restored_chain_cursor(workdir).map(|cursor| cursor.tip)
}

/// Lightweight read of the persisted tip plus its recent canonical hash
/// anchors. No state is hydrated. The CKB adapter uses the hashes to detect a
/// reorg that occurred while cknerv was offline before it replays any tx.
pub fn peek_restored_chain_cursor(workdir: &Path) -> Option<RestoredChainCursor> {
    let bytes = std::fs::read(persisted_path(workdir)).ok()?;
    let file: PersistedFile = serde_json::from_slice(&bytes).ok()?;
    if file.schema_version != SCHEMA_VERSION {
        return None;
    }
    let chain = file.entities.get("chain")?;
    let tip = chain.get("tip")?.as_u64()?;
    let recent_blocks = serde_json::from_value(
        chain
            .get("recent_blocks")
            .cloned()
            .unwrap_or_else(|| serde_json::Value::Array(Vec::new())),
    )
    .unwrap_or_default();
    let hydrated_cell_target = file
        .projections
        .get("cells")
        .and_then(|cells| cells.get("hydrated_cell_target"))
        .and_then(serde_json::Value::as_u64)
        .and_then(|target| usize::try_from(target).ok())
        .unwrap_or(0);
    Some(RestoredChainCursor {
        tip,
        recent_blocks,
        hydrated_cell_target,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cknerv_core::Mutation;

    fn tmpdir() -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        p.push(format!("cknerv-server-test-{nonce}"));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn save_then_load_round_trips_chain() {
        let workdir = tmpdir();
        let s1 = Arc::new(ServerState::new());
        s1.apply_mutation(Mutation::BlockMined {
            number: 42,
            hash: "0xblk42".into(),
            tx_count: 1,
            size: 0,
            at: 1_000,
            producer_key: None,
            producer_message: None,
        });
        save(&s1, &workdir).expect("save");

        let s2 = Arc::new(ServerState::new());
        let outcome = load(s2.clone(), &workdir);
        assert!(outcome.restored);
        assert_eq!(outcome.restored_chain_tip, Some(42));

        let snap = s2.snapshot();
        assert_eq!(snap["chain"]["tip"], 42);

        let _ = std::fs::remove_dir_all(&workdir);
    }

    #[test]
    fn peek_restored_tip_reads_saved_tip() {
        let workdir = tmpdir();
        assert_eq!(peek_restored_tip(&workdir), None, "no file yet");

        let s = Arc::new(ServerState::new());
        s.apply_mutation(Mutation::BlockMined {
            number: 12345,
            hash: "0xblk".into(),
            tx_count: 0,
            size: 0,
            at: 1_000,
            producer_key: None,
            producer_message: None,
        });
        save(&s, &workdir).expect("save");
        assert_eq!(peek_restored_tip(&workdir), Some(12345));
        assert_eq!(
            peek_restored_chain_cursor(&workdir),
            Some(RestoredChainCursor {
                tip: 12345,
                recent_blocks: vec![RecentBlock {
                    number: 12345,
                    hash: "0xblk".into(),
                }],
                hydrated_cell_target: 0,
            })
        );

        let _ = std::fs::remove_dir_all(&workdir);
    }

    #[test]
    fn peek_restored_cursor_keeps_tip_when_hash_anchors_are_unreadable() {
        let workdir = tmpdir();
        let path = persisted_path(&workdir);
        std::fs::write(
            path,
            serde_json::to_vec(&serde_json::json!({
                "schema_version": SCHEMA_VERSION,
                "entities": {
                    "chain": {
                        "tip": 77,
                        "recent_blocks": "legacy-or-corrupt-anchor-window"
                    }
                },
                "projections": {}
            }))
            .unwrap(),
        )
        .unwrap();

        assert_eq!(
            peek_restored_chain_cursor(&workdir),
            Some(RestoredChainCursor {
                tip: 77,
                recent_blocks: Vec::new(),
                hydrated_cell_target: 0,
            })
        );

        let _ = std::fs::remove_dir_all(&workdir);
    }

    #[test]
    fn peek_cursor_reads_completed_cell_hydration_target() {
        let workdir = tmpdir();
        let state = Arc::new(ServerState::new());
        state
            .projections
            .write()
            .unwrap()
            .register(cknerv_core::CellGalaxy::new());
        state.apply_mutation(Mutation::BlockMined {
            number: 88,
            hash: "0xblock88".into(),
            tx_count: 0,
            size: 0,
            at: 1_000,
            producer_key: None,
            producer_message: None,
        });
        state.apply_mutation(Mutation::CellHydrationCompleted {
            target: 20_000,
            available: 20_003,
            from_block: 12,
            at_tip: 88,
        });
        save(&state, &workdir).expect("save");

        let cursor = peek_restored_chain_cursor(&workdir).expect("cursor");
        assert_eq!(cursor.tip, 88);
        assert_eq!(cursor.hydrated_cell_target, 20_000);

        let _ = std::fs::remove_dir_all(&workdir);
    }

    #[test]
    fn load_with_no_file_returns_default() {
        let workdir = tmpdir();
        let s = Arc::new(ServerState::new());
        let outcome = load(s, &workdir);
        assert!(!outcome.restored);
        let _ = std::fs::remove_dir_all(&workdir);
    }

    #[test]
    fn load_with_schema_v4_discards_file() {
        let workdir = tmpdir();
        let path = persisted_path(&workdir);
        std::fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({
                "schema_version": 4,
                "entities": {},
                "projections": {},
            }))
            .unwrap(),
        )
        .unwrap();
        let s = Arc::new(ServerState::new());
        let outcome = load(s, &workdir);
        assert!(!outcome.restored);
        assert!(!path.exists(), "file should have been deleted");
        let _ = std::fs::remove_dir_all(&workdir);
    }

    /// The producer window is why a restore is worth having on this path at
    /// all: a boot that restores state SKIPS the backfill, so the window has
    /// no replay to warm it and starts from whatever the save file held.
    #[test]
    fn a_warm_producer_window_survives_save_and_load() {
        let workdir = tmpdir();
        let s1 = Arc::new(ServerState::new());
        for number in 1..=5u64 {
            s1.apply_mutation(Mutation::BlockMined {
                number,
                hash: format!("0xblk{number}"),
                tx_count: 0,
                size: 0,
                at: number * 1_000,
                producer_key: Some(if number % 5 == 0 { "0xrare" } else { "0xbusy" }.into()),
                producer_message: Some("0.209.0 (7e31f75 2026-07-30)".into()),
            });
        }
        save(&s1, &workdir).expect("save");

        let s2 = Arc::new(ServerState::new());
        assert!(load(s2.clone(), &workdir).restored);
        let chain = s2.snapshot()["chain"].clone();
        assert_eq!(chain["producer_window_blocks"], 5);
        assert_eq!(chain["producer_window"], serde_json::json!([0, 0, 0, 0, 1]));
        let producers = chain["producers"].as_array().unwrap();
        assert_eq!(producers[0]["key"], "0xbusy");
        assert_eq!(producers[0]["blocks"], 4);
        assert_eq!(producers[1]["key"], "0xrare");
        assert_eq!(producers[1]["blocks"], 1);

        let _ = std::fs::remove_dir_all(&workdir);
    }

    /// Every state file on disk today was written without a producer window,
    /// and the fields are additive with serde defaults — so the file still
    /// loads at the CURRENT schema version, as an empty window rather than a
    /// discarded save. That is the whole reason `SCHEMA_VERSION` did not move
    /// for this change.
    #[test]
    fn a_save_written_before_the_producer_window_still_restores() {
        let workdir = tmpdir();
        let path = persisted_path(&workdir);
        std::fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({
                "schema_version": SCHEMA_VERSION,
                "entities": {
                    "revision": 9,
                    "chain": {
                        "tip": 4242,
                        "recent_blocks": [{ "number": 4242, "hash": "0xblk" }],
                        "total_blocks": 4242
                    },
                    "chain_nodes": []
                },
                "projections": {}
            }))
            .unwrap(),
        )
        .unwrap();

        let s = Arc::new(ServerState::new());
        let outcome = load(s.clone(), &workdir);
        assert!(
            outcome.restored,
            "an additive field must not discard a save"
        );
        assert_eq!(outcome.restored_chain_tip, Some(4242));
        assert!(path.exists(), "a loadable save must not be deleted");
        let chain = s.snapshot()["chain"].clone();
        assert_eq!(chain["producers"], serde_json::json!([]));
        assert_eq!(chain["producer_window_blocks"], 0);

        let _ = std::fs::remove_dir_all(&workdir);
    }

    #[test]
    fn load_with_newer_schema_discards_file() {
        let workdir = tmpdir();
        let path = persisted_path(&workdir);
        std::fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({
                "schema_version": SCHEMA_VERSION + 1,
                "entities": {},
                "projections": {},
            }))
            .unwrap(),
        )
        .unwrap();
        let outcome = load(Arc::new(ServerState::new()), &workdir);
        assert!(!outcome.restored);
        assert!(!path.exists(), "newer state must not be partially loaded");
        let _ = std::fs::remove_dir_all(&workdir);
    }

    #[test]
    fn schema_v5_save_load_preserves_cell_morphology_inputs() {
        use cknerv_core::{AssetKind, LockKind, ScriptId, TxOutputInfo};

        let workdir = tmpdir();
        let source = Arc::new(ServerState::new());
        source
            .projections
            .write()
            .unwrap()
            .register(cknerv_core::CellGalaxy::new());
        let script = ScriptId::parse(&format!("0x{}", "11".repeat(32)), "type").unwrap();
        source.apply_mutation(Mutation::TxLanded {
            tx_hash: "0xmorphology".into(),
            block: 7,
            at: 1_000,
            inputs: Vec::new(),
            outputs: vec![TxOutputInfo {
                capacity: 61_00000000,
                data_hex: "0xaabb~".into(),
                data_bytes: 2_048,
                content_hash: format!("0x{}", "22".repeat(32)),
                lock_shape_seed: [0x0102_0304, 0x0506_0708],
                type_shape_seed: Some([0x1112_1314, 0x1516_1718]),
                data_shape_seed: [0x2122_2324, 0x2526_2728],
                lock_kind: LockKind::Sighash,
                asset_kind: AssetKind::Xudt,
                lock_script: script,
                type_script: Some(script),
                collection_seed: None,
            }],
        });
        save(&source, &workdir).expect("save schema-v5 state");

        let restored = Arc::new(ServerState::new());
        restored
            .projections
            .write()
            .unwrap()
            .register(cknerv_core::CellGalaxy::new());
        assert!(load(restored.clone(), &workdir).restored);
        let projections = restored.projections.read().unwrap().save_all();
        let cell = &projections["cells"]["cells"][0];
        assert_eq!(cell["data_bytes"], 2_048);
        assert_eq!(
            cell["lock_shape_seed"],
            serde_json::json!([0x0102_0304_u32, 0x0506_0708_u32])
        );
        assert_eq!(
            cell["type_shape_seed"],
            serde_json::json!([0x1112_1314_u32, 0x1516_1718_u32])
        );
        assert_eq!(
            cell["data_shape_seed"],
            serde_json::json!([0x2122_2324_u32, 0x2526_2728_u32])
        );

        let _ = std::fs::remove_dir_all(&workdir);
    }

    #[test]
    fn peers_are_not_persisted() {
        use cknerv_core::{Peer, PeerDirection};
        let workdir = tmpdir();
        let s1 = Arc::new(ServerState::new());
        s1.apply_mutation(Mutation::PeersUpdated {
            peers: vec![Peer {
                node_id: "QmA".into(),
                addr: "1.2.3.4:8115".into(),
                direction: PeerDirection::Outbound,
                version: "0.116.1".into(),
                latency_ms: Some(20),
                best_known: Some(50),
                connected_ms: 1000,
            }],
        });
        save(&s1, &workdir).expect("save");

        let s2 = Arc::new(ServerState::new());
        load(s2.clone(), &workdir);
        // peers were ephemeral: restored state has none.
        assert_eq!(s2.snapshot()["peers"].as_array().unwrap().len(), 0);
        let _ = std::fs::remove_dir_all(&workdir);
    }

    #[test]
    fn load_with_garbage_file_discards_it() {
        let workdir = tmpdir();
        let path = persisted_path(&workdir);
        std::fs::write(&path, b"not even json").unwrap();
        let s = Arc::new(ServerState::new());
        let outcome = load(s, &workdir);
        assert!(!outcome.restored);
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(&workdir);
    }
}
