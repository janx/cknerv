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
//! - [`outpoint`] — chain outpoint + tx-output payload types.
//! - [`projection`] — `Projection` trait + the `CellGalaxy` projection.
//! - [`ring`] — bounded ring buffer used by the server's event replay.

pub mod enrichment;
pub mod entity;
pub mod helix;
pub mod mutation;
pub mod outpoint;
pub mod projection;
pub mod ring;
pub mod rng;
pub mod taxonomy;

pub use enrichment::{
    ActivityFeedItem, ActivityFeedRecord, AssetEcosystemCategory, AssetEcosystemLeader,
    AssetEcosystemRecord, CellSemanticRecord, ChainAnchor, ChainCensus, CommonKnowledgeBreakdown,
    DaoStateRecord, EnrichmentEvent, EnrichmentProjection, EnrichmentSourceState,
    EnrichmentSourceStatus, ForkWatchDeepFork, ForkWatchEventKind, ForkWatchRecord, ForkWatchReorg,
    GalaxyCellCandidate, GalaxyCompositionCandidates, GalaxyCompositionRecord,
    GalaxyCompositionTarget, GalaxyCompositionTopUp, NetworkAtlasBucket, NetworkAtlasRecord,
    ProtocolEra, ProtocolEraRecord, SemanticAsset, SemanticAttribute, SemanticCellContent,
    SemanticContentDecode, SemanticContentGuess, SemanticContentSegment, SemanticFacet,
    SemanticScript, SemanticsDelta, SemanticsProjection, SemanticsSnapshot,
    TransactionHorizonRecord, TransactionParticipantSemantic, TransactionSemanticRecord,
};
pub use entity::{
    Chain, ChainNode, EpochInfo, MempoolStats, Peer, PeerDirection, RecentBlock, RecentTx,
};
pub use helix::{helix_seed_f64, helix_seed_for};
pub use mutation::{Mutation, ReplayPhase, RevisionedMutation};
pub use outpoint::{is_cellbase_input, CellOutput, OutPoint, TxOutputInfo};
pub use projection::cells::{
    Cell, CellDelta, CellGalaxy, CellGalaxyPersisted, CellGalaxySnapshot, CellLinkEndpointAnchor,
    CellLinkRecord, DisplayBudget, DisplayMode, DisplayProvenance, DisplaySection,
    DEFAULT_REORG_WINDOW_BLOCKS,
};
pub use projection::composition_policy::{CompositionDemand, CompositionDemandSink};
pub use projection::Projection;
pub use ring::Ring;
pub use taxonomy::{AssetKind, LockKind};
