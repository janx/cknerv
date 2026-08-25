//! cknerv-core — chain-generic visualization primitives for CKB.
//!
//! See [`helix`] for the deterministic cell positioning function
//! (`helix_seed_for`) that must stay byte-parity with the TS twin in
//! `@cknerv/ui/src/helix.ts`. The shared fixture in
//! `tests/fixtures/helix_seed.json` (root of the cknerv repo) is the
//! source of truth for both sides.
//!
//! Module layout:
//! - [`mutation`] — wire-level [`Mutation`] enum and [`RevisionedMutation`].
//! - [`entity`] — chain-state singletons (`Chain`, `MempoolStats`, …).
//! - [`identity`] — outpoint-derived cell ids (`composition_id_for_outpoint`).
//! - [`outpoint`] — chain outpoint + tx-output payload types.
//! - [`projection`] — `Projection` trait + the `CellGalaxy` projection.
//! - [`ring`] — bounded ring buffer used by the server's event replay.

pub mod enrichment;
pub mod entity;
pub mod helix;
pub mod identity;
pub mod mutation;
pub mod outpoint;
pub mod projection;
pub mod ring;
pub mod rng;
pub mod taxonomy;

pub use enrichment::{
    ActivityFeedItem, ActivityFeedRecord, AssetEcosystemCategory, AssetEcosystemLeader,
    AssetEcosystemRecord, CellSemanticRecord, ChainAnchor, ChainCensus, ChainCensusClasses,
    CommonKnowledgeBreakdown, DaoStateRecord, EnrichmentEvent, EnrichmentProjection,
    EnrichmentSourceState, EnrichmentSourceStatus, ForkWatchDeepFork, ForkWatchEventKind,
    ForkWatchRecord, ForkWatchReorg, GalaxyCellCandidate, GalaxyCompositionCandidates,
    GalaxyCompositionRecord, GalaxyCompositionTarget, GalaxyCompositionTopUp, NetworkAtlasBucket,
    NetworkAtlasRecord, NetworkRosterRecord, PeerAdvertisedEvidence, PeerHandshakeDepthBucket,
    PeerProbeResult, PeerSightingAbsence, PeerSightingLookup, PeerSightingRecord, ProtocolEra,
    ProtocolEraRecord, RosterNode, ScriptNameRecord, ScriptRegistryRecord, SemanticAsset,
    SemanticAttribute, SemanticCellConsumption, SemanticCellContent, SemanticContentDecode,
    SemanticContentGuess, SemanticContentSegment, SemanticFacet, SemanticScript, SemanticsDelta,
    SemanticsProjection, SemanticsSnapshot, TransactionHorizonRecord,
    TransactionParticipantSemantic, TransactionSemanticRecord, MAX_SCRIPT_REGISTRY_ENTRIES,
};
pub use entity::{
    Chain, ChainNode, EpochInfo, MempoolStats, Peer, PeerDirection, RecentBlock, RecentTx,
};
pub use helix::{helix_seed_f64, helix_seed_for};
pub use identity::{composition_id_for_outpoint, COMPOSITION_ID_MASK, COMPOSITION_ID_PREFIX};
pub use mutation::{Mutation, ReplayPhase, RevisionedMutation};
pub use outpoint::{
    is_cellbase_input, OutPoint, ShapeSeed, TxOutputInfo, DATA_HEX_TRUNCATION_MARKER,
};
pub use projection::cells::{
    Cell, CellDelta, CellGalaxy, CellGalaxyPersisted, CellGalaxySnapshot, CellLinkEndpointAnchor,
    CellLinkRecord, DisplayBudget, DisplayMode, DisplayProvenance, DisplaySection,
    DEFAULT_REORG_WINDOW_BLOCKS,
};
pub use projection::cells_stats::{ObservedScriptsSink, ScriptCensus, ScriptCount};
pub use projection::composition_policy::{CompositionDemand, CompositionDemandSink};
pub use projection::Projection;
pub use ring::Ring;
pub use taxonomy::{AssetKind, HashType, LockKind, ScriptId};
