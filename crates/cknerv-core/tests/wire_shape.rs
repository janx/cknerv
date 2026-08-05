//! Wire-shape canary. Every entry in `tests/fixtures/*.json` must
//! round-trip through serde without loss. Catches silent drift between
//! this crate's wire format and the `@cknerv/types` schema (mirrored on
//! the TS side in PR B5).
//!
//! Per the cknerv extraction plan, the wire shape these tests pin is the
//! source of truth — both Rust producers (cknerv-server) and TS consumers
//! (@cknerv/cache, @cknerv/ui) must match it. Adding a new mutation
//! variant or a new entity field requires a corresponding fixture update
//! here; otherwise this test makes the omission loud.

use std::path::PathBuf;

use cknerv_core::{
    Cell, CellDelta, CellGalaxySnapshot, Chain, Mutation, ReplayPhase, SemanticsDelta,
    SemanticsSnapshot,
};

fn fixture(name: &str) -> serde_json::Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("tests")
        .join("fixtures")
        .join(name);
    let f = std::fs::File::open(&path).unwrap_or_else(|e| panic!("open {name}: {e}"));
    serde_json::from_reader(f).unwrap_or_else(|e| panic!("parse {name}: {e}"))
}

/// Canonical form: recursively sort object keys so we compare value
/// shapes regardless of serde key-emission order. (serde_json's
/// serializer preserves insertion order; the fixture's order is the
/// hand-written one. Without canonicalization the assertion would
/// spuriously fail on key reordering.)
fn canonicalize(v: &serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match v {
        Value::Object(map) => {
            let sorted: std::collections::BTreeMap<String, Value> = map
                .iter()
                .map(|(k, v)| (k.clone(), canonicalize(v)))
                .collect();
            Value::Object(sorted.into_iter().collect())
        }
        Value::Array(arr) => Value::Array(arr.iter().map(canonicalize).collect()),
        _ => v.clone(),
    }
}

#[test]
fn mutation_samples_round_trip() {
    let samples = fixture("mutation_samples.json");
    let map = samples
        .as_object()
        .expect("mutation_samples.json must be a JSON object");
    assert!(!map.is_empty(), "mutation_samples.json must have entries");
    for (variant_name, sample) in map {
        let m: Mutation = serde_json::from_value(sample.clone())
            .unwrap_or_else(|e| panic!("deserialize Mutation::{variant_name}: {e}"));
        let re = serde_json::to_value(&m)
            .unwrap_or_else(|e| panic!("serialize Mutation::{variant_name}: {e}"));
        assert_eq!(
            canonicalize(sample),
            canonicalize(&re),
            "Mutation::{variant_name} round-trip mismatch"
        );
    }
}

#[test]
fn cell_delta_samples_match_serialized_shape() {
    let samples = fixture("cell_delta_samples.json");
    let sample = &samples["link_prune"];
    let delta = CellDelta::LinkPrune { from_block: 42 };
    let serialized = serde_json::to_value(delta).expect("serialize CellDelta::LinkPrune");
    assert_eq!(canonicalize(sample), canonicalize(&serialized));

    let sample = &samples["backfill_rebuild"];
    let delta = CellDelta::Backfill {
        done: 3,
        total: 10,
        active: true,
        phase: ReplayPhase::Rebuild,
    };
    let serialized = serde_json::to_value(delta).expect("serialize CellDelta::Backfill");
    assert_eq!(canonicalize(sample), canonicalize(&serialized));
}

#[test]
fn snapshot_chain_round_trips() {
    let sample = fixture("snapshot_chain.json");
    let chain: Chain =
        serde_json::from_value(sample.clone()).unwrap_or_else(|e| panic!("deserialize Chain: {e}"));
    let re = serde_json::to_value(&chain).unwrap_or_else(|e| panic!("serialize Chain: {e}"));
    assert_eq!(canonicalize(&sample), canonicalize(&re));
}

#[test]
fn snapshot_cells_round_trips() {
    let sample = fixture("snapshot_cells.json");
    let g: CellGalaxySnapshot = serde_json::from_value(sample.clone())
        .unwrap_or_else(|e| panic!("deserialize CellGalaxySnapshot: {e}"));
    let re =
        serde_json::to_value(&g).unwrap_or_else(|e| panic!("serialize CellGalaxySnapshot: {e}"));
    assert_eq!(canonicalize(&sample), canonicalize(&re));
}

#[test]
fn cell_samples_round_trip() {
    let samples = fixture("cell_samples.json");
    let arr = samples
        .as_array()
        .expect("cell_samples.json must be a JSON array");
    assert!(!arr.is_empty(), "cell_samples.json must have entries");
    for (i, sample) in arr.iter().enumerate() {
        let cell: Cell = serde_json::from_value(sample.clone())
            .unwrap_or_else(|e| panic!("deserialize cell[{i}]: {e}"));
        let re = serde_json::to_value(&cell).unwrap_or_else(|e| panic!("serialize cell[{i}]: {e}"));
        assert_eq!(
            canonicalize(sample),
            canonicalize(&re),
            "cell[{i}] round-trip"
        );
    }
}

#[test]
fn enrichment_samples_match_wire_shape() {
    let samples = fixture("enrichment_samples.json");
    let snapshot_value = samples["snapshot"].clone();
    let snapshot: SemanticsSnapshot = serde_json::from_value(snapshot_value.clone())
        .unwrap_or_else(|e| panic!("deserialize SemanticsSnapshot: {e}"));
    let serialized = serde_json::to_value(&snapshot).expect("serialize SemanticsSnapshot");
    assert_eq!(canonicalize(&snapshot_value), canonicalize(&serialized));

    let source_status = SemanticsDelta::SourceStatus {
        source: snapshot.source.clone(),
    };
    assert_eq!(
        canonicalize(&samples["deltas"]["source_status"]),
        canonicalize(&serde_json::to_value(source_status).unwrap())
    );
    let cell_upsert = SemanticsDelta::CellUpsert {
        cell: Box::new(snapshot.cells[0].clone()),
    };
    assert_eq!(
        canonicalize(&samples["deltas"]["cell_upsert"]),
        canonicalize(&serde_json::to_value(cell_upsert).unwrap())
    );
    let prune = SemanticsDelta::Prune { from_block: 100 };
    assert_eq!(
        canonicalize(&samples["deltas"]["prune"]),
        canonicalize(&serde_json::to_value(prune).unwrap())
    );
    let cell_remove = SemanticsDelta::CellRemove {
        out_point: snapshot.cells[0].out_point.clone(),
    };
    assert_eq!(
        canonicalize(&samples["deltas"]["cell_remove"]),
        canonicalize(&serde_json::to_value(cell_remove).unwrap())
    );
    let transaction_remove = SemanticsDelta::TransactionRemove {
        tx_hash: snapshot.transactions[0].tx_hash.clone(),
    };
    assert_eq!(
        canonicalize(&samples["deltas"]["transaction_remove"]),
        canonicalize(&serde_json::to_value(transaction_remove).unwrap())
    );
    let asset_ecosystem = SemanticsDelta::AssetEcosystemReplace {
        asset_ecosystem: snapshot.asset_ecosystem.clone().unwrap(),
    };
    assert_eq!(
        canonicalize(&samples["deltas"]["asset_ecosystem_replace"]),
        canonicalize(&serde_json::to_value(asset_ecosystem).unwrap())
    );
    let dao_state = SemanticsDelta::DaoStateReplace {
        dao_state: snapshot.dao_state.clone().unwrap(),
    };
    assert_eq!(
        canonicalize(&samples["deltas"]["dao_state_replace"]),
        canonicalize(&serde_json::to_value(dao_state).unwrap())
    );
    let protocol_era = SemanticsDelta::ProtocolEraReplace {
        protocol_era: snapshot.protocol_era.clone().unwrap(),
    };
    assert_eq!(
        canonicalize(&samples["deltas"]["protocol_era_replace"]),
        canonicalize(&serde_json::to_value(protocol_era).unwrap())
    );
    let fork_watch = SemanticsDelta::ForkWatchReplace {
        fork_watch: snapshot.fork_watch.clone().unwrap(),
    };
    assert_eq!(
        canonicalize(&samples["deltas"]["fork_watch_replace"]),
        canonicalize(&serde_json::to_value(fork_watch).unwrap())
    );
    let activity_feed = SemanticsDelta::ActivityFeedReplace {
        activity_feed: snapshot.activity_feed.clone().unwrap(),
    };
    assert_eq!(
        canonicalize(&samples["deltas"]["activity_feed_replace"]),
        canonicalize(&serde_json::to_value(activity_feed).unwrap())
    );
    let transaction_horizon = SemanticsDelta::TransactionHorizonReplace {
        transaction_horizon: snapshot.transaction_horizon.clone().unwrap(),
    };
    assert_eq!(
        canonicalize(&samples["deltas"]["transaction_horizon_replace"]),
        canonicalize(&serde_json::to_value(transaction_horizon).unwrap())
    );
    let network_atlas = SemanticsDelta::NetworkAtlasReplace {
        network_atlas: snapshot.network_atlas.clone().unwrap(),
    };
    assert_eq!(
        canonicalize(&samples["deltas"]["network_atlas_replace"]),
        canonicalize(&serde_json::to_value(network_atlas).unwrap())
    );
    assert_eq!(
        canonicalize(&samples["deltas"]["network_atlas_clear"]),
        canonicalize(&serde_json::to_value(SemanticsDelta::NetworkAtlasClear).unwrap())
    );
}
