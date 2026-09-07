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

use std::collections::BTreeMap;
use std::path::PathBuf;

use cknerv_core::{
    AssetKind, Cell, CellDelta, CellGalaxySnapshot, CellLinkEndpointAnchor, Chain, ChainAnchor,
    DisplayMode, DisplayProvenance, LockKind, Mutation, NetworkRosterRecord, OutPoint,
    PeerAdvertisedEvidence, PeerProbeResult, PeerSightingAbsence, PeerSightingLookup,
    PeerSightingRecord, ProducerLedger, ProducerLedgerRow, ReplayPhase, RosterNode,
    RosterNodeState, ScriptCensus, ScriptCount, ScriptFamilyCensusRecord, ScriptFamilyCount,
    ScriptId, ScriptNameRecord, ScriptRegistryRecord, SemanticsDelta, SemanticsSnapshot,
};

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("tests")
        .join("fixtures")
        .join(name)
}

fn fixture(name: &str) -> serde_json::Value {
    let path = fixture_path(name);
    let f = std::fs::File::open(&path).unwrap_or_else(|e| panic!("open {name}: {e}"));
    serde_json::from_reader(f).unwrap_or_else(|e| panic!("parse {name}: {e}"))
}

/// Fixtures the TS twin reads are WRITTEN by this crate rather than kept by
/// hand: the committed bytes are this serializer's output, so a renamed field
/// or a reshaped variant lands in the file and the browser side fails on the
/// next run instead of drifting quietly behind a hand-edited sample.
///
/// Regenerate with
/// `CKNERV_REGEN_FIXTURES=1 cargo test -p cknerv-core --test wire_shape`,
/// then run the TS twins (`pnpm --filter @cknerv/{types,cache} test`) in the
/// same change.
fn assert_authored_fixture<T: serde::Serialize>(name: &str, value: &T) {
    let path = fixture_path(name);
    let mut encoded = serde_json::to_string_pretty(value).expect("serialize fixture");
    encoded.push('\n');
    if std::env::var("CKNERV_REGEN_FIXTURES").is_ok() {
        std::fs::write(&path, &encoded).unwrap_or_else(|e| panic!("write {name}: {e}"));
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {name}: {e}"));
    assert_eq!(
        encoded, committed,
        "{name} no longer matches what this crate serializes; regenerate with \
         CKNERV_REGEN_FIXTURES=1 cargo test -p cknerv-core --test wire_shape"
    );
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

/// Which variant a sample is. Total by construction: a new `Mutation` stops
/// compiling here until it is named, and the coverage assertion in
/// [`mutation_samples_cover_every_wire_visible_variant`] then demands a
/// fixture entry for it.
fn mutation_variant(mutation: &Mutation) -> &'static str {
    match mutation {
        Mutation::BlockMined { .. } => "block_mined",
        Mutation::ChainReorganized { .. } => "chain_reorganized",
        Mutation::ChainRebuild { .. } => "chain_rebuild",
        Mutation::TxLanded { .. } => "tx_landed",
        Mutation::ChainMempoolUpdated { .. } => "chain_mempool_updated",
        Mutation::ChainInfoUpdated { .. } => "chain_info_updated",
        Mutation::CellTagged { .. } => "cell_tagged",
        Mutation::ChainNodeRegistered { .. } => "chain_node_registered",
        Mutation::BackfillProgress { .. } => "backfill_progress",
        Mutation::CellHydrationCompleted { .. } => "cell_hydration_completed",
        Mutation::PeersUpdated { .. } => "peers_updated",
        Mutation::ChainSyncUpdated { .. } => "chain_sync_updated",
        Mutation::ChainNodeInfoUpdated { .. } => "chain_node_info_updated",
        Mutation::GalaxyReservoirReplaced { .. } => "galaxy_reservoir_replaced",
        Mutation::GalaxyReservoirToppedUp { .. } => "galaxy_reservoir_topped_up",
    }
}

/// The variants that deliberately never reach a client, so a fixture sample
/// for them would pin a wire shape nothing reads.
///
/// These are exactly the two `Mutation::entity_wire_visible` excludes: the
/// server synthesizes them so the curated display reservoir can ride the
/// canonical mutation channel, and both the entity ring and the broadcast
/// drop them. `cknerv-server`'s R5 pin
/// (`galaxy_reservoir_mutation_never_reaches_the_entity_wire`, with
/// `galaxy_top_up_closes_demand_over_the_internal_channel_only` for the
/// additive twin, in `crates/cknerv-server/src/state.rs`) proves the claim;
/// this list is the reason no fixture pins their shape. If that pin ever
/// stops holding, these two belong back in the fixture — the two tests guard
/// each other.
const OFF_THE_WIRE_MUTATIONS: &[&str] =
    &["galaxy_reservoir_replaced", "galaxy_reservoir_topped_up"];

/// Every wire-visible `Mutation` needs a sample, the same contract
/// `CellDelta` and `SemanticsDelta` already hold. Without this, a new
/// variant reaches the browser and the TS chain reducer's `default:` arm
/// swallows it — no fixture, no failure, no readout.
#[test]
fn mutation_samples_cover_every_wire_visible_variant() {
    let samples = fixture("mutation_samples.json");
    let covered: std::collections::BTreeSet<String> = samples
        .as_object()
        .expect("mutation_samples.json must be a JSON object")
        .values()
        .map(|sample| {
            let m: Mutation = serde_json::from_value(sample.clone()).expect("deserialize Mutation");
            // The fixture pins the wire, so everything in it must BE on the
            // wire — read from the predicate the server itself filters by.
            assert!(
                m.entity_wire_visible(),
                "{} is server-internal and has no wire shape to pin",
                mutation_variant(&m)
            );
            mutation_variant(&m).to_string()
        })
        .collect();
    let expected: std::collections::BTreeSet<String> = [
        "block_mined",
        "chain_reorganized",
        "chain_rebuild",
        "tx_landed",
        "chain_mempool_updated",
        "chain_info_updated",
        "cell_tagged",
        "chain_node_registered",
        "backfill_progress",
        "cell_hydration_completed",
        "peers_updated",
        "chain_sync_updated",
        "chain_node_info_updated",
    ]
    .into_iter()
    .map(str::to_string)
    .collect();
    assert_eq!(
        covered, expected,
        "every wire-visible Mutation variant needs a sample in \
         mutation_samples.json — the TS chain reducer's default arm is silent, \
         so an unsampled variant fails nowhere"
    );

    // The exclusion has to stay honest in both directions. `mutation_variant`
    // is total, so a new variant cannot compile without a name — but nothing
    // yet forces that name to appear in either list, and a variant named only
    // there would be as unsampled as before. The count closes it: adding a
    // variant makes this fail until its name joins one of the two lists.
    let named: std::collections::BTreeSet<String> = expected
        .iter()
        .cloned()
        .chain(OFF_THE_WIRE_MUTATIONS.iter().map(|s| s.to_string()))
        .collect();
    assert_eq!(
        named.len(),
        15,
        "every Mutation variant belongs to exactly one of the two lists above"
    );
}

/// Which variant a sample is. Total by construction: a new `CellDelta`
/// stops compiling here until it is named, and the coverage assertion in
/// [`cell_delta_samples_cover_every_variant`] then demands a sample for it.
fn cell_delta_variant(delta: &CellDelta) -> &'static str {
    match delta {
        CellDelta::Birth { .. } => "birth",
        CellDelta::Death { .. } => "death",
        CellDelta::Tag { .. } => "tag",
        CellDelta::Gc { .. } => "gc",
        CellDelta::Pulse { .. } => "pulse",
        CellDelta::Stats { .. } => "stats",
        CellDelta::ScriptCensus { .. } => "script_census",
        CellDelta::Backfill { .. } => "backfill",
        CellDelta::LinkPrune { .. } => "link_prune",
        CellDelta::Link { .. } => "link",
        CellDelta::Display { .. } => "display",
    }
}

/// A scripted cell: the delta path carries script identity too, and it is
/// the path that lost it for a whole release when only the snapshot half
/// was fixtured.
fn sample_cell(id: u64) -> Cell {
    Cell {
        id,
        born_at_ms: 1_700_000_000_000,
        death_at_ms: None,
        birth_block: 100,
        tag: Some("dex".to_string()),
        pos_seed: [1.5, -0.25, 3.75],
        out_point: OutPoint {
            tx_hash: "0xabc".to_string(),
            index: 0,
        },
        capacity: 14_200_000_000,
        data_hex: "0x5c00000000000000".to_string(),
        data_bytes: 8,
        content_hash: "0x1111111111111111111111111111111111111111111111111111111111111111"
            .to_string(),
        lock_shape_seed: [0x9bd7e06f, 0x3ecf4be0],
        type_shape_seed: Some([0x50bd8d66, 0x80b8b9cf]),
        data_shape_seed: [0x5c000000, 0x00000000],
        lock_kind: LockKind::Sighash,
        asset_kind: AssetKind::Xudt,
        lock_script: sample_lock_script(),
        type_script: Some(sample_type_script()),
        collection_seed: None,
    }
}

fn sample_lock_script() -> ScriptId {
    ScriptId::parse(
        "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
        "type",
    )
    .expect("well-formed lock code hash")
}

fn sample_type_script() -> ScriptId {
    ScriptId::parse(
        "0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95",
        "data1",
    )
    .expect("well-formed type code hash")
}

/// One realistic sample per `CellDelta` variant, keyed by fixture name.
/// `display` appears twice because its two shapes — a composed patch with
/// resident payloads and the everyday id-only swap whose `provenance: None`
/// must vanish from the wire — are separately load-bearing. `pulse` appears
/// twice for the same reason: a wave that names its producer and a wave that
/// names nobody drive different code on the client, and the anonymous one is
/// the case a synthesized key would quietly replace.
fn cell_delta_samples() -> BTreeMap<&'static str, CellDelta> {
    let mut samples: BTreeMap<&'static str, CellDelta> = BTreeMap::new();
    samples.insert(
        "birth",
        CellDelta::Birth {
            cell: sample_cell(7),
        },
    );
    samples.insert(
        "death",
        CellDelta::Death {
            id: 7,
            at_ms: 1_700_000_005_000,
        },
    );
    samples.insert(
        "tag",
        CellDelta::Tag {
            id: 7,
            tag: "wallet".to_string(),
        },
    );
    samples.insert("gc", CellDelta::Gc { ids: vec![7, 8] });
    // A real mainnet producer key: the `ckb-default-hash` of the packed
    // `CellbaseWitness.lock` of block 20,259,445.
    samples.insert(
        "pulse",
        CellDelta::Pulse {
            at_ms: 1_700_000_006_000,
            producer_key: Some(
                "0xfc20a8c81a461efaf91585c631db784749d066f709d30243095efda7a7fdcfd9".to_string(),
            ),
        },
    );
    // The block that names nobody. The key has to be ABSENT from the wire,
    // not an empty string: downstream falls back to an anonymous origin on
    // absence, and a blank key would stage as an identity nobody has.
    samples.insert(
        "pulse_anonymous",
        CellDelta::Pulse {
            at_ms: 1_700_000_007_000,
            producer_key: None,
        },
    );
    samples.insert(
        "stats",
        CellDelta::Stats {
            total_births: 128,
            total_deaths: 96,
        },
    );
    // Ranked head plus tail counters: a panel reading only the head must be
    // able to say "and N more" instead of presenting the cut as the whole
    // distribution.
    samples.insert(
        "script_census",
        CellDelta::ScriptCensus {
            census: ScriptCensus {
                locks: vec![ScriptCount {
                    script: sample_lock_script(),
                    count: 2,
                }],
                locks_tail_cells: 3,
                locks_tail_scripts: 1,
                types: vec![ScriptCount {
                    script: sample_type_script(),
                    count: 1,
                }],
                types_tail_cells: 0,
                types_tail_scripts: 0,
                types_absent: 4,
                unidentified: 1,
            },
        },
    );
    samples.insert(
        "backfill_rebuild",
        CellDelta::Backfill {
            done: 3,
            total: 10,
            active: true,
            phase: ReplayPhase::Rebuild,
        },
    );
    samples.insert("link_prune", CellDelta::LinkPrune { from_block: 42 });
    // Causal edge with durable endpoint geometry: `endpoint_anchors` is
    // what the client routes on once the input cells have left its window.
    // The middle anchor is the identity-only kind — a spend of a cell this
    // projection never retained, so it names a place without proving
    // content and stays out of `from_ids`.
    samples.insert(
        "link",
        CellDelta::Link {
            tx_hash: "0xtx100".to_string(),
            block: 100,
            from_ids: vec![5],
            to_ids: vec![7],
            endpoint_anchors: vec![
                CellLinkEndpointAnchor {
                    id: 5,
                    pos_seed: [-2.0, 0.5, 1.25],
                    content_hash:
                        "0x3333333333333333333333333333333333333333333333333333333333333333"
                            .to_string(),
                    resolved: true,
                },
                CellLinkEndpointAnchor {
                    id: cknerv_core::COMPOSITION_ID_PREFIX + 9,
                    pos_seed: [-4.5, 0.25, -6.0],
                    content_hash: String::new(),
                    resolved: false,
                },
                CellLinkEndpointAnchor {
                    id: 7,
                    pos_seed: [1.5, -0.25, 3.75],
                    content_hash:
                        "0x1111111111111111111111111111111111111111111111111111111111111111"
                            .to_string(),
                    resolved: true,
                },
            ],
            parents: vec!["0xtx99".to_string()],
            tag: Some("dex".to_string()),
            at_ms: 1_700_000_004_000,
        },
    );
    // Display-plane patch, composed mode: a canonical enter by id, a
    // resident enter with full payload (composition-range id, 2^52 + 5), an
    // exit, and full provenance.
    samples.insert(
        "display_composed",
        CellDelta::Display {
            enter_ids: vec![1],
            enter_cells: vec![Cell {
                id: 4503599627370501,
                born_at_ms: 0,
                death_at_ms: None,
                birth_block: 12,
                tag: None,
                pos_seed: [2.5, -1.25, 0.75],
                out_point: OutPoint {
                    tx_hash: "0xdef".to_string(),
                    index: 3,
                },
                capacity: 5000,
                data_hex: "0x".to_string(),
                data_bytes: 0,
                content_hash: "0x2222222222222222222222222222222222222222222222222222222222222222"
                    .to_string(),
                lock_shape_seed: [0x22222222, 0x33333333],
                type_shape_seed: None,
                data_shape_seed: [0x44444444, 0x55555555],
                lock_kind: LockKind::Acp,
                asset_kind: AssetKind::Xudt,
                lock_script: Default::default(),
                type_script: None,
                collection_seed: None,
            }],
            exit_ids: vec![2],
            provenance: Some(DisplayProvenance {
                mode: DisplayMode::Composed,
                source: Some("ckbadger".to_string()),
                as_of: Some(ChainAnchor {
                    block: 12,
                    hash: "0xfeed".to_string(),
                }),
                updated_at_ms: 2000,
            }),
        },
    );
    samples.insert(
        "display_minimal",
        CellDelta::Display {
            enter_ids: vec![2],
            enter_cells: vec![],
            exit_ids: vec![1],
            provenance: None,
        },
    );
    samples
}

#[test]
fn cell_delta_samples_are_authored_by_the_serializer() {
    assert_authored_fixture("cell_delta_samples.json", &cell_delta_samples());
}

#[test]
fn cell_delta_samples_cover_every_variant() {
    let covered: std::collections::BTreeSet<&str> = cell_delta_samples()
        .values()
        .map(cell_delta_variant)
        .collect();
    assert_eq!(
        covered,
        [
            "backfill",
            "birth",
            "death",
            "display",
            "gc",
            "link",
            "link_prune",
            "pulse",
            "script_census",
            "stats",
            "tag",
        ]
        .into_iter()
        .collect::<std::collections::BTreeSet<&str>>(),
        "every CellDelta variant needs a sample in cell_delta_samples.json — \
         the client reducer test drives the file arm by arm"
    );
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

/// `collection_seed` is the one field on a `Cell` whose job is to be EQUAL
/// across cells. The fixture carries the shape the chain actually produces —
/// a Spore Cluster container and a spore inside it, two different asset
/// kinds, one seed — and every cell whose family names no collection omits
/// the key entirely, which is what a snapshot written before M2b looks like.
#[test]
fn collection_seed_is_shared_by_kin_and_absent_everywhere_else() {
    let samples = fixture("cell_samples.json");
    let cells: Vec<Cell> =
        serde_json::from_value(samples.clone()).expect("cell_samples.json is a Cell array");

    let kin: Vec<&Cell> = cells
        .iter()
        .filter(|cell| cell.collection_seed.is_some())
        .collect();
    assert_eq!(kin.len(), 2, "the fixture carries one family");
    assert_eq!(
        kin[0].collection_seed, kin[1].collection_seed,
        "kinship is the field's whole purpose"
    );
    assert_ne!(
        kin[0].asset_kind, kin[1].asset_kind,
        "a container and its member are different kinds and still kin"
    );
    assert_ne!(
        kin[0].type_shape_seed, kin[1].type_shape_seed,
        "every OTHER seed still separates them"
    );

    // Absent means absent: no key on the wire, and a snapshot that predates
    // the field deserializes to `None` rather than failing.
    for (cell, sample) in cells.iter().zip(samples.as_array().expect("array")) {
        assert_eq!(
            cell.collection_seed.is_none(),
            sample.get("collection_seed").is_none(),
            "cell {} disagrees about whether it has kin",
            cell.id
        );
    }
    let mut legacy = samples[3].clone();
    assert!(legacy
        .as_object_mut()
        .expect("object")
        .remove("collection_seed")
        .is_some());
    let restored: Cell = serde_json::from_value(legacy).expect("pre-M2b cells still load");
    assert_eq!(restored.collection_seed, None);
}

/// Total by construction, same contract as [`cell_delta_variant`].
fn semantics_delta_variant(delta: &SemanticsDelta) -> &'static str {
    match delta {
        SemanticsDelta::SourceStatus { .. } => "source_status",
        SemanticsDelta::CellUpsert { .. } => "cell_upsert",
        SemanticsDelta::CellRemove { .. } => "cell_remove",
        SemanticsDelta::TransactionUpsert { .. } => "transaction_upsert",
        SemanticsDelta::TransactionRemove { .. } => "transaction_remove",
        SemanticsDelta::CensusReplace { .. } => "census_replace",
        SemanticsDelta::AssetEcosystemReplace { .. } => "asset_ecosystem_replace",
        SemanticsDelta::DaoStateReplace { .. } => "dao_state_replace",
        SemanticsDelta::ProtocolEraReplace { .. } => "protocol_era_replace",
        SemanticsDelta::ForkWatchReplace { .. } => "fork_watch_replace",
        SemanticsDelta::ActivityFeedReplace { .. } => "activity_feed_replace",
        SemanticsDelta::TransactionHorizonReplace { .. } => "transaction_horizon_replace",
        SemanticsDelta::NetworkAtlasReplace { .. } => "network_atlas_replace",
        SemanticsDelta::NetworkAtlasClear => "network_atlas_clear",
        SemanticsDelta::NetworkRosterReplace { .. } => "network_roster_replace",
        SemanticsDelta::NetworkRosterClear => "network_roster_clear",
        SemanticsDelta::ProducerLedgerReplace { .. } => "producer_ledger_replace",
        SemanticsDelta::ProducerLedgerClear => "producer_ledger_clear",
        SemanticsDelta::ScriptRegistryReplace { .. } => "script_registry_replace",
        SemanticsDelta::ScriptFamilyCensusReplace { .. } => "script_family_census_replace",
        SemanticsDelta::Prune { .. } => "prune",
        SemanticsDelta::Clear => "clear",
    }
}

/// Names for the identities the snapshot's own cells carry, so the fixture
/// exercises the join the browser actually performs: the cell census holds
/// `(code_hash, hash_type)` and refuses to name it, this half names it and
/// counts nothing. `unresolved` is not decoration — a live index answers
/// "found the code cell" for identities it still has no name for.
fn enrichment_script_registry() -> ScriptRegistryRecord {
    ScriptRegistryRecord {
        source: "ckbadger".to_string(),
        as_of: ChainAnchor {
            block: 100,
            hash: "0xblock100".to_string(),
        },
        updated_at_ms: 1_700_000_000_004,
        entries: vec![
            ScriptNameRecord {
                code_hash: "0xlockcode".to_string(),
                hash_type: "type".to_string(),
                name: "Default Lock".to_string(),
                description: Some("Secp256k1 blake160 single signature".to_string()),
                kind: Some("lock".to_string()),
                website: None,
                deprecated: false,
            },
            ScriptNameRecord {
                code_hash: "0xdaocode".to_string(),
                hash_type: "type".to_string(),
                name: "Nervos DAO".to_string(),
                description: None,
                kind: Some("type".to_string()),
                website: Some("https://nervos.org".to_string()),
                deprecated: false,
            },
        ],
        unresolved: 8,
    }
}

/// The whole chain's live Cells by script family, cut the way the browser
/// draws it: the listed families, bare CKB beside the type families, and the
/// two remainders the index has no family for. The figures are a
/// mainnet-shaped thousandth — 66% bare CKB, one lock family holding most of
/// the chain, a DAO family too small to be named on a six-slot bar — so the
/// derive that ranks and folds them is exercised on a shape it will meet.
fn enrichment_script_family_census() -> ScriptFamilyCensusRecord {
    let family =
        |name: &str, kind: &str, live_cells: u64, inventory: Option<&str>| ScriptFamilyCount {
            name: name.to_string(),
            kind: kind.to_string(),
            live_cells,
            inventory: inventory.map(str::to_string),
        };
    ScriptFamilyCensusRecord {
        source: "ckbadger".to_string(),
        as_of: ChainAnchor {
            block: 100,
            hash: "0xblock100".to_string(),
        },
        updated_at_ms: 1_700_000_000_005,
        live_cells: 1_000,
        types_absent: 663,
        types_dao: 15,
        types_unlisted: 10,
        locks_unlisted: 6,
        families: vec![
            family("Nervos DAO", "type", 15, None),
            family(".bit Income Cell", "type", 158, None),
            family("xUDT", "type", 39, Some("token")),
            family("COTA", "type", 36, None),
            family("M-NFT", "type", 31, Some("object")),
            family("Spore", "type", 25, Some("object")),
            family("Simple UDT", "type", 3, Some("token")),
            family("Spore Cluster", "type", 1, None),
            family("Unique Cell", "type", 1, None),
            family("CKBFS", "type", 1, None),
            family("did:ckb", "type", 1, Some("identity")),
            family("Bitcoin SPV Type Lock", "type", 1, None),
            family("Stable++ Asset", "type", 1, Some("token")),
            family("ccBTC Asset", "type", 1, Some("token")),
            family("M-NFT Class", "type", 4, None),
            family(".bit Reverse Record", "type", 8, None),
            family(".bit Account", "type", 1, Some("identity")),
            family("Default Lock", "lock", 604, None),
            family(".bit Lock", "lock", 175, None),
            family("JoyID", "lock", 109, None),
            family("FlashSigner", "lock", 28, None),
            family("PW Lock", "lock", 20, None),
            family("Force Bridge", "lock", 18, None),
            family("OMNI Lock", "lock", 17, None),
            family("UniPass", "lock", 15, None),
            family("RGB++", "lock", 4, None),
            family("Nervape Shadow Lock", "lock", 2, None),
            family("Default Multisig", "lock", 1, None),
            family("Anyone-Can-Pay Lock", "lock", 1, None),
        ],
    }
}

/// The bounded sample of crawler-known nodes the scene may stage — the other
/// The POW cohort ledger, as the live service answered on 2026-09-02.
///
/// The window figures are real — 7 complete UTC+8 days, 2026-08-26 to
/// 2026-09-01, 67,800 attributed blocks — and so are the two producers: the
/// top miner's lock hash, its `ckb1…` payout address, its 41,824 blocks, its
/// balance, its live cells and its transaction count, plus the reward one
/// sampled block actually paid it. Nothing here is a plausible-looking
/// invention, because the shapes a browser has to parse are the shapes this
/// service emits.
///
/// The two rows are the two shapes, and the second is the point of the pair.
/// The chart answers for every producer in one request; every optional below
/// `blocks` comes from a SEPARATE per-address request that can fail on its
/// own. So one row carries everything a successful lookup gives, and the other
/// carries a key and a count and nothing else — a producer whose address the
/// source would not resolve. A reader that cannot tell those apart will print
/// `0 CKB` over a balance nobody read.
///
/// ⚠️ `balance_shannons` is 9,820,183,392,640,200 — past
/// `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991) — and the TS twin asserts
/// exactly that, because a fixture whose balance fit in a double would pin
/// nothing about the decision to ship it as a string.
///
/// The clocks and the tip are this file's own scheme rather than mainnet's,
/// the same way `dao_state.statistics_block` is 99 beside a real mainnet
/// epoch: the fixture's chain stands at block 100, so the sampled reward is
/// dated inside it.
fn enrichment_producer_ledger() -> ProducerLedger {
    ProducerLedger {
        window_days: 7,
        from_date: "2026-08-26".to_string(),
        to_date: "2026-09-01".to_string(),
        total_blocks: 67_800,
        fetched_at_ms: 1_700_000_000_012,
        indexed_tip: 100,
        rows: vec![
            ProducerLedgerRow {
                key: "0xfc20a8c81a461efaf91585c631db784749d066f709d30243095efda7a7fdcfd9"
                    .to_string(),
                address: Some(
                    "ckb1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq0tpsqq08mkay9ewrfrdwlcghv62qw704s93hhsj"
                        .to_string(),
                ),
                blocks: 41_824,
                balance_shannons: Some("9820183392640200".to_string()),
                live_cells: Some(155_450),
                tx_count: Some(4_094_449),
                last_reward_shannons: Some("71011833086".to_string()),
                last_reward_block: Some(88),
            },
            ProducerLedgerRow {
                key: "0x6aa42538dd2de2ba4d022c7fdc92d35e760331a9d0f9992a03d2550e82cb7bc2"
                    .to_string(),
                address: None,
                blocks: 2,
                balance_shannons: None,
                live_cells: None,
                tx_count: None,
                last_reward_shannons: None,
                last_reward_block: None,
            },
        ],
    }
}

/// half of the crawler's answer, and the honesty line this file exists to
/// hold. Every identity here is real: the ids are base58, the same vocabulary
/// the local node's peer list and `/api/enrichment/peers/:node_id` speak, so a
/// browser can carry one row straight into a lookup. Nothing relational is
/// real: the roster says who exists, never who links to whom.
///
/// Ordered by `node_id`, which is what keeps a staged set the same set round
/// after round.
fn enrichment_network_roster(entries: Vec<RosterNode>, truncated: bool) -> NetworkRosterRecord {
    NetworkRosterRecord {
        source: "ckbadger".to_string(),
        as_of: ChainAnchor {
            block: 100,
            hash: "0xblock100".to_string(),
        },
        updated_at_ms: 1_700_000_000_011,
        crawl_round: 7,
        truncated,
        entries,
    }
}

/// Four rows, because four things have to survive the wire, and three of them
/// are about what a row DOES NOT say.
///
/// The ids, addresses, versions and labels are lifted off a live mainnet crawl
/// rather than invented, so the shapes a browser has to parse are the shapes it
/// will meet: a `/dns4` alias with the peer id repeated inside it, a raw
/// `/ip4`, a client version carrying a build hash and a date, an ASN label that
/// is a number and an organisation name in one string.
///
/// - a node the crawler reached, carrying everything a dial can tell you;
/// - a node it reached and could not place, whose `"Unknown"` country and ASN
///   are the crawler's own word for a lookup that came back empty — a LABEL,
///   and the reason the field beside it is a string rather than a gap;
/// - a node it reached before and could not this round, which still holds a
///   verification and so still answers every one of those fields;
/// - a node nobody has ever got an answer out of, where the five things only a
///   dial could have told us are ABSENT. That row is the point of the shape:
///   absent and `"Unknown"` are two different sentences, and a reader that
///   cannot tell them apart will print the crawler's verdict over a peer it
///   has never spoken to.
///
/// The clocks are this file's own scheme rather than the crawl's, and every
/// row gives all four of them a different value: four clocks ride every row
/// now, and a fixture that gave two of them one value would let a twin
/// collapse the pair and still pass. The required one is always the newest,
/// which is what it means — it is the maximum over every positive channel,
/// and the advertise clock it replaced is only one of those channels.
///
/// Every row carries an advertise clock even though the wire no longer demands
/// one, and that is honest rather than lazy: the source answers `null` there
/// exactly when it answers `null` for the address too, and a row with no
/// address is one the adapter never stages. The optional is for the wire's
/// sake, not for a shape this fixture could truthfully draw.
fn enrichment_roster_nodes() -> Vec<RosterNode> {
    vec![
        RosterNode {
            node_id: "QmNRAvtC6L85hwp6vWnqaKonJw3dz1q39B4nXVQErzC4Hx".to_string(),
            addr:
                "/dns4/sange.ckb.guide/tcp/443/p2p/QmNRAvtC6L85hwp6vWnqaKonJw3dz1q39B4nXVQErzC4Hx"
                    .to_string(),
            state: RosterNodeState::Reachable,
            version: Some("0.209.0 (d166e28 2026-07-29)".to_string()),
            country: Some("CA".to_string()),
            asn: Some("AS16509 Amazon.com, Inc.".to_string()),
            last_reachable_ms: Some(1_699_999_940_000),
            last_advertised_ms: Some(1_699_999_990_000),
            last_observed_ms: Some(1_699_999_945_000),
            latest_positive_observed_ms: 1_699_999_995_000,
            rtt_ms: Some(1_331),
        },
        RosterNode {
            node_id: "QmPQM3t3fyWPzD5UvZEaiLw1siAesXbdCUQozDEUgYJ22Y".to_string(),
            addr: "/ip4/104.199.224.122/tcp/32872".to_string(),
            state: RosterNodeState::Reachable,
            version: Some("0.202.0 (d0a6c95 2025-06-11)".to_string()),
            country: Some("Unknown".to_string()),
            asn: Some("Unknown".to_string()),
            last_reachable_ms: Some(1_699_999_930_000),
            last_advertised_ms: Some(1_699_999_990_000),
            last_observed_ms: Some(1_699_999_935_000),
            latest_positive_observed_ms: 1_699_999_992_000,
            rtt_ms: Some(467),
        },
        RosterNode {
            node_id: "QmTdv6Dpi1e5fzKUVZzw5SJJYVvDt1jAq5ShiRRCQ7eBLB".to_string(),
            addr: "/ip4/203.0.113.254/tcp/8115".to_string(),
            state: RosterNodeState::AdvertisedUnverified,
            version: None,
            country: None,
            asn: None,
            last_reachable_ms: None,
            last_advertised_ms: Some(1_699_999_990_000),
            last_observed_ms: Some(1_699_999_920_000),
            latest_positive_observed_ms: 1_699_999_991_000,
            rtt_ms: None,
        },
        RosterNode {
            node_id: "QmcPjVi8ZvUCAsyrV3ocTkwQzMzPXpSUWnWnvYAxRmHKgh".to_string(),
            addr: "/ip4/8.218.177.113/tcp/8115".to_string(),
            state: RosterNodeState::VerifiedUnavailable,
            version: Some("0.208.1".to_string()),
            country: Some("SG".to_string()),
            asn: Some("AS45102 Alibaba (US) Technology Co., Ltd.".to_string()),
            last_reachable_ms: Some(1_699_999_100_000),
            last_advertised_ms: Some(1_699_999_980_000),
            last_observed_ms: Some(1_699_999_910_000),
            latest_positive_observed_ms: 1_699_999_985_000,
            rtt_ms: None,
        },
    ]
}

/// The crawler's own view of one node the local node is linked to. It is the
/// only enrichment record that describes a network peer rather than a chain
/// object, and the only one resolved purely on demand — so it rides the
/// fixture as its own section instead of a snapshot slot or a delta arm.
///
/// The clocks are milliseconds here although the crawler counts seconds: the
/// conversion belongs to the adapter, and this file is what the browser has
/// to be able to read.
fn enrichment_peer_sighting() -> PeerSightingRecord {
    PeerSightingRecord {
        source: "ckbadger".to_string(),
        as_of: ChainAnchor {
            block: 100,
            hash: "0xblock100".to_string(),
        },
        updated_at_ms: 1_700_000_000_005,
        node_id: "QmagxSv7GNwKXQE7mi1iDjFHghjUpbqjBgqSot7PmMJqHA".to_string(),
        country: "DE".to_string(),
        asn: "AS24940 Hetzner Online GmbH".to_string(),
        client_version: "0.209.0 (d166e28 2026-07-29)".to_string(),
        protocols: vec!["/ckb/syn".to_string(), "/ckb/relay".to_string()],
        first_seen_ms: 1_650_000_000_000,
        last_seen_ms: 1_699_999_940_000,
        last_reachable_at_ms: Some(1_699_999_940_000),
        reachable: true,
        rtt_ms: Some(41),
        // Both directions of the address book, and deliberately not the same
        // ORDER of magnitude: the browser's samples are what its tests read
        // the units off, and two counts that looked alike would let a surface
        // print either one under either label and still look right.
        advertiser_peer_count: Some(47),
        advertised_address_count: Some(5_727),
    }
}

/// The rung below a sighting: the network named this peer and the crawler
/// could not get an identify out of it. It rides the fixture beside the
/// sighting because it is the answer the browser gets for most of the live
/// candidate set, and the plate prints a different sentence for every result
/// the crawler can name.
fn enrichment_peer_advertised() -> PeerAdvertisedEvidence {
    PeerAdvertisedEvidence {
        // Two clocks and deliberately not the same moment: the browser's
        // tests read the units and the sentences off this file, and a sample
        // where both stamps agreed would let the plate print either one under
        // either phrase and still look right. Upstream's own maximum is the
        // later of the two by construction.
        last_advertised_at_ms: Some(1_699_999_940_000),
        latest_positive_observed_ms: 1_699_999_985_000,
        furthest_result: Some(PeerProbeResult::NoAuthenticatedSessionBeforeDeadline),
        furthest_address: Some("/ip4/198.51.100.4/tcp/8115".to_string()),
        // Three aliases dialed and none of them answered — the population the
        // rung above is the best of, and the difference between one dead
        // address and a node that is not answering anywhere.
        dialed_address_count: 3,
        consecutive_exhausted_rounds: 2,
        // Fewer peers name a peer nobody could dial than name one that
        // answers, which is the whole weight this rung has.
        advertiser_peer_count: Some(6),
    }
}

/// Total by construction, same contract as [`semantics_delta_variant`]: a new
/// absence reason cannot be added without being fixtured for the browser.
fn peer_sighting_absence_variant(reason: &PeerSightingAbsence) -> &'static str {
    match reason {
        PeerSightingAbsence::NoCrawler => "no_crawler",
        PeerSightingAbsence::UnreadableNodeId => "unreadable_node_id",
        PeerSightingAbsence::NeverSighted => "never_sighted",
        PeerSightingAbsence::AdvertisedUnverified => "advertised_unverified",
    }
}

/// The file's two halves as one serializable value, so the whole thing —
/// snapshot and every delta variant — is written by the serializer.
///
/// The snapshot's *content* is the committed file's own, read back through
/// `SemanticsSnapshot`: it is a page of realistic ckbadger records that no
/// one should have to restate as Rust literals, and round-tripping it means
/// the committed bytes are still this crate's output. Its *shape* therefore
/// tracks the struct — a renamed field regenerates, a removed one vanishes.
#[derive(serde::Serialize)]
struct EnrichmentSamples {
    snapshot: SemanticsSnapshot,
    deltas: BTreeMap<&'static str, SemanticsDelta>,
    /// The lazy per-peer lookup: not a snapshot slot and not a delta, because
    /// the set of peers belongs to the network rather than to the chain.
    peer_sightings: BTreeMap<&'static str, PeerSightingLookup>,
}

fn enrichment_samples() -> EnrichmentSamples {
    let committed = fixture("enrichment_samples.json");
    let mut snapshot: SemanticsSnapshot = serde_json::from_value(committed["snapshot"].clone())
        .unwrap_or_else(|e| panic!("deserialize SemanticsSnapshot: {e}"));
    snapshot.script_registry = Some(enrichment_script_registry());
    snapshot.script_family_census = Some(enrichment_script_family_census());
    snapshot.network_roster = Some(enrichment_network_roster(enrichment_roster_nodes(), true));
    snapshot.producer_ledger = Some(enrichment_producer_ledger());

    let mut deltas: BTreeMap<&'static str, SemanticsDelta> = BTreeMap::new();
    deltas.insert(
        "source_status",
        SemanticsDelta::SourceStatus {
            source: snapshot.source.clone(),
        },
    );
    deltas.insert(
        "cell_upsert",
        SemanticsDelta::CellUpsert {
            cell: Box::new(snapshot.cells[0].clone()),
        },
    );
    deltas.insert(
        "cell_remove",
        SemanticsDelta::CellRemove {
            out_point: snapshot.cells[0].out_point.clone(),
        },
    );
    deltas.insert(
        "transaction_upsert",
        SemanticsDelta::TransactionUpsert {
            transaction: Box::new(snapshot.transactions[0].clone()),
        },
    );
    deltas.insert(
        "transaction_remove",
        SemanticsDelta::TransactionRemove {
            tx_hash: snapshot.transactions[0].tx_hash.clone(),
        },
    );
    deltas.insert(
        "census_replace",
        SemanticsDelta::CensusReplace {
            census: snapshot.census.clone().expect("fixture census"),
        },
    );
    deltas.insert(
        "asset_ecosystem_replace",
        SemanticsDelta::AssetEcosystemReplace {
            asset_ecosystem: snapshot
                .asset_ecosystem
                .clone()
                .expect("fixture asset ecosystem"),
        },
    );
    deltas.insert(
        "dao_state_replace",
        SemanticsDelta::DaoStateReplace {
            dao_state: snapshot.dao_state.clone().expect("fixture dao state"),
        },
    );
    deltas.insert(
        "protocol_era_replace",
        SemanticsDelta::ProtocolEraReplace {
            protocol_era: snapshot.protocol_era.clone().expect("fixture protocol era"),
        },
    );
    deltas.insert(
        "fork_watch_replace",
        SemanticsDelta::ForkWatchReplace {
            fork_watch: snapshot.fork_watch.clone().expect("fixture fork watch"),
        },
    );
    deltas.insert(
        "activity_feed_replace",
        SemanticsDelta::ActivityFeedReplace {
            activity_feed: snapshot
                .activity_feed
                .clone()
                .expect("fixture activity feed"),
        },
    );
    deltas.insert(
        "transaction_horizon_replace",
        SemanticsDelta::TransactionHorizonReplace {
            transaction_horizon: snapshot
                .transaction_horizon
                .clone()
                .expect("fixture transaction horizon"),
        },
    );
    deltas.insert(
        "network_atlas_replace",
        SemanticsDelta::NetworkAtlasReplace {
            network_atlas: snapshot
                .network_atlas
                .clone()
                .expect("fixture network atlas"),
        },
    );
    deltas.insert("network_atlas_clear", SemanticsDelta::NetworkAtlasClear);
    deltas.insert(
        "network_roster_replace",
        SemanticsDelta::NetworkRosterReplace {
            network_roster: Box::new(
                snapshot
                    .network_roster
                    .clone()
                    .expect("fixture network roster"),
            ),
        },
    );
    // A crawler that finished a round and found nobody. Fixtured beside the
    // populated arm because the two mean different things and a reader has to
    // be able to tell them apart: this one is a report, and the clear below
    // is the absence of a crawler to report anything.
    deltas.insert(
        "network_roster_replace_empty",
        SemanticsDelta::NetworkRosterReplace {
            network_roster: Box::new(enrichment_network_roster(Vec::new(), false)),
        },
    );
    deltas.insert("network_roster_clear", SemanticsDelta::NetworkRosterClear);
    deltas.insert(
        "producer_ledger_replace",
        SemanticsDelta::ProducerLedgerReplace {
            producer_ledger: snapshot
                .producer_ledger
                .clone()
                .expect("fixture producer ledger"),
        },
    );
    // The source has no ledger to give — a 404 on the chart route, which is
    // absence and not a fault. Fixtured beside the replace because the client
    // answers it by falling back to the 240-block window rather than by
    // emptying a panel.
    deltas.insert("producer_ledger_clear", SemanticsDelta::ProducerLedgerClear);
    deltas.insert(
        "script_registry_replace",
        SemanticsDelta::ScriptRegistryReplace {
            script_registry: Box::new(enrichment_script_registry()),
        },
    );
    deltas.insert(
        "script_family_census_replace",
        SemanticsDelta::ScriptFamilyCensusReplace {
            script_family_census: Box::new(enrichment_script_family_census()),
        },
    );
    deltas.insert("prune", SemanticsDelta::Prune { from_block: 100 });
    deltas.insert("clear", SemanticsDelta::Clear);

    let mut peer_sightings: BTreeMap<&'static str, PeerSightingLookup> = BTreeMap::new();
    peer_sightings.insert(
        "sighted",
        PeerSightingLookup::sighted(enrichment_peer_sighting()),
    );
    for reason in [
        PeerSightingAbsence::NoCrawler,
        PeerSightingAbsence::UnreadableNodeId,
        PeerSightingAbsence::NeverSighted,
    ] {
        peer_sightings.insert(
            peer_sighting_absence_variant(&reason),
            PeerSightingLookup::unsighted(reason),
        );
    }
    // The one absence that carries evidence, so the browser has a sample of
    // the shape rather than only of the word.
    peer_sightings.insert(
        peer_sighting_absence_variant(&PeerSightingAbsence::AdvertisedUnverified),
        PeerSightingLookup::advertised_unverified(enrichment_peer_advertised()),
    );

    EnrichmentSamples {
        snapshot,
        deltas,
        peer_sightings,
    }
}

#[test]
fn enrichment_samples_are_authored_by_the_serializer() {
    assert_authored_fixture("enrichment_samples.json", &enrichment_samples());
}

#[test]
fn enrichment_samples_cover_every_peer_absence_reason() {
    let covered: std::collections::BTreeSet<&str> = enrichment_samples()
        .peer_sightings
        .values()
        .filter_map(|lookup| match lookup {
            PeerSightingLookup::Sighted { .. } => None,
            PeerSightingLookup::Unsighted { reason, .. } => {
                Some(peer_sighting_absence_variant(reason))
            }
        })
        .collect();
    assert_eq!(
        covered,
        [
            "advertised_unverified",
            "never_sighted",
            "no_crawler",
            "unreadable_node_id"
        ]
        .into_iter()
        .collect::<std::collections::BTreeSet<&str>>(),
        "every PeerSightingAbsence reason needs a sample in enrichment_samples.json — \
         the DOSSIER plate prints a different sentence for each one"
    );
}

/// ⚠️ The half of the ledger's contract that no type can state, pinned on
/// both sides of the wire (`packages/types/__tests__/wire_shape.test.ts` reads
/// the same bytes with `BigInt`).
///
/// The balance is a decimal STRING carrying a value a JS `number` cannot hold.
/// If the fixture's figure ever drops under 2^53-1 the sample stops being
/// evidence of anything — every assertion about it would keep passing with a
/// `number` twin that silently rounds — so the magnitude is asserted here
/// rather than assumed from the field's type.
#[test]
fn the_fixture_ledger_states_a_balance_no_double_could_hold() {
    let samples = fixture("enrichment_samples.json");
    let ledger = &samples["snapshot"]["producer_ledger"];
    assert_eq!(ledger["total_blocks"], 67_800);
    assert_eq!(ledger["window_days"], 7);

    let balance = &ledger["rows"][0]["balance_shannons"];
    assert!(
        balance.is_string(),
        "the balance rides the wire as a string"
    );
    assert!(
        balance
            .as_str()
            .expect("string")
            .parse::<u128>()
            .expect("decimal shannons")
            > 9_007_199_254_740_991,
        "the sampled balance has to be past Number.MAX_SAFE_INTEGER, or the \
         fixture proves nothing about why this field is not a number"
    );

    // The second row is the one with nothing but a key and a count: the
    // producer whose address lookup the source did not answer. Absent keys,
    // not nulls — the difference the browser reads as "unknown" rather than
    // "zero".
    let bare = &ledger["rows"][1];
    for absent in ["address", "balance_shannons", "live_cells", "tx_count"] {
        assert!(bare.get(absent).is_none(), "{absent} should be absent");
    }
    assert_eq!(bare["blocks"], 2);
}

#[test]
fn enrichment_samples_cover_every_delta_variant() {
    let covered: std::collections::BTreeSet<&str> = enrichment_samples()
        .deltas
        .values()
        .map(semantics_delta_variant)
        .collect();
    assert_eq!(
        covered,
        [
            "activity_feed_replace",
            "asset_ecosystem_replace",
            "cell_remove",
            "cell_upsert",
            "census_replace",
            "clear",
            "dao_state_replace",
            "fork_watch_replace",
            "network_atlas_clear",
            "network_atlas_replace",
            "network_roster_clear",
            "network_roster_replace",
            "producer_ledger_clear",
            "producer_ledger_replace",
            "protocol_era_replace",
            "prune",
            "script_family_census_replace",
            "script_registry_replace",
            "source_status",
            "transaction_horizon_replace",
            "transaction_remove",
            "transaction_upsert",
        ]
        .into_iter()
        .collect::<std::collections::BTreeSet<&str>>(),
        "every SemanticsDelta variant needs a sample in enrichment_samples.json — \
         the client reducer test drives the file arm by arm"
    );
}
