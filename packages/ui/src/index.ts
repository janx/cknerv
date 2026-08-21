// @cknerv/ui — chain-generic React + R3F primitives for the CKB
// neural visualization. Wire your `@cknerv/cache` cell-galaxy stream
// into <CellGalaxyProvider> at the root, then drop the primitives
// into any R3F <Canvas>.

// ── Helix (deterministic positions; byte-stable with cknerv-core) ──
export { helixSeed, helixSeedF64 } from './helix';

// ── Layout (Y planes + chain-node positioning) ──────────────────────
export * from './layout';

// ── Shared primitive types (Vec3, GraphNode, AnimationHint) ─────────
export type {
  AnimationHint,
  GraphNode,
  Vec3,
} from './types';

// ── Tweaks (sim-clock, useSimFrame, leva presets) ───────────────────
export * from './tweaks/simClock';
export * from './tweaks/SimClockScope';
export * from './tweaks/useSimFrame';
export * from './tweaks/qualityPresets';
export * from './tweaks/adaptiveQuality';
export * from './tweaks/cellDisplay';
export { default as AdaptiveQualityController } from './tweaks/AdaptiveQualityController';
export { default as SimClockTicker } from './tweaks/SimClockTicker';
export { default as TweakSync } from './tweaks/TweakSync';
export { LIVE } from './tweaks/liveTweaks';
export type { LiveTweaks } from './tweaks/liveTweaks';
export { default as RenderStatsSampler } from './tweaks/RenderStatsSampler';

// ── UI chrome (topology constants) ──────────────────────────────────
export * from './ui/topologyConstants';

// ── Materials (THREE.ShaderMaterials + GLSL chunks) ─────────────────
export * from './materials/cellEnvelope.glsl';
export * from './materials/cellHybridMaterial';
export * from './materials/shockwaveMaterial';
export * from './materials/peerNodeMaterial';
export * from './materials/consensusMemoryKnotMaterial';

// ── Geometry helpers ───────────────────────────────────────────────
export * from './geometry/cellPositions';
export * from './geometry/cellCausalLens';
export * from './geometry/edgeBezier';
export * from './geometry/neighborGraph';
export * from './geometry/pathRouter';

// ── Derive helpers (pure data shapers consumed by HUDs) ─────────────
export * from './derives/cellVisual.derive';
export * from './derives/cellMorphology.derive';
export * from './derives/cellSemanticMorphology.derive';
export * from './derives/cellInteraction.derive';
export * from './derives/cellSemantics.derive';
export * from './derives/assetEcosystem.derive';
export * from './derives/daoState.derive';
export * from './derives/activityFeed.derive';
export * from './derives/transactionHorizon.derive';
export * from './derives/networkAtlas.derive';
export * from './derives/cellConsensusIdentity.derive';
export * from './derives/cellCausalLens.derive';
export * from './derives/cellCausalLabel.derive';
export * from './derives/consensusBraid.derive';
export * from './derives/consensusFlow.derive';
export * from './derives/consensusMemoryCore.derive';
export * from './derives/consensusMemoryCoreIdentity.derive';
export * from './derives/consensusMemoryLod.derive';
export * from './derives/consensusMemoryPortrait.derive';
export * from './derives/consensusMemoryEvidence.derive';
export * from './derives/consensusRouteHopAgreement.derive';
export * from './derives/consensusRouteCamera.derive';
export * from './derives/cellsStats.derive';
export * from './derives/cellPopulationField.derive';
export * from './derives/peers.derive';
export * from './derives/ecgCondition';
export * from './derives/fleetTelemetry';
export * from './derives/alertLevel';
export * from './derives/cellChurn';
export * from './derives/networkTopology.derive';
export * from './derives/networkFlood.derive';
export * from './derives/canonicalRewrite.derive';
export * from './derives/streamHealth.derive';
export * from './derives/sceneView.derive';

// ── Hooks ──────────────────────────────────────────────────────────
export {
  CellGalaxyProvider,
  useCellGalaxy,
  type CellGalaxyProviderProps,
} from './hooks/cellGalaxyContext';

// ── Components ─────────────────────────────────────────────────────
export { default as BlockDeliveryLayer } from './components/BlockDeliveryLayer';
export {
  default as CellCausalLensLayer,
  type CellCausalLensLayerProps,
} from './components/CellCausalLensLayer';
export {
  formatCkb, midTruncate, formatOutpoint, formatDataHex, formatCellKind,
  formatAge, formatDataSize, formatLockKind, formatAssetKind,
  LOCK_COLORS, ASSET_COLORS,
} from './components/hud/cellFormat';
export {
  default as CellGalaxy,
  writeCellBuffers,
  writeFlashSlots,
  writeCellInspectionTargets,
  type CellBufferTargets,
} from './components/CellGalaxy';
export {
  default as CanonicalRewriteEcho,
  makeCanonicalRewriteEchoMaterial,
} from './components/CanonicalRewriteEcho';
export { default as CellPopulationField } from './components/CellPopulationField';
export * from './geometry/populationFieldPlacement';
export * from './materials/populationFieldMaterial';
export {
  markCellFlashDirty,
  mergeCellFlashRanges,
  writeDirtyCellFlashSlots,
  type CellFlashDirtyIdsRef,
} from './components/cellFlash';
export type {
  CellIdentityBindingPhase,
  CellIdentityProofBinding,
  CellIdentityProofEvent,
  CellIdentityProofKind,
} from './components/CellIdentityProofMarker';
export {
  CELL_IDENTITY_PROOF_KINDS,
  cellIdentityProofBindingComplete,
} from './derives/cellIdentityProof.derive';
export {
  default as CellIdentityProofMarker,
} from './components/CellIdentityProofMarker';
export { default as CellSemanticOrbit } from './components/CellSemanticOrbit';
export {
  default as CellInspectionOverlay,
  CellInspectionAnchor,
  createCellInspectionHandles,
  cellInspectorPlacement,
  selectedCellScanAccent,
  type CellInspectionHandles,
  type CellInspectionOverlayProps,
  type CellInspectorPlacement,
  type CellInspectorPlacementSide,
} from './components/CellInspectionOverlay';
export { default as HudOverlay } from './components/hud/HudOverlay';
export {
  default as CellDetailPanel,
  type CellDetailPanelProps,
  type CellInspectionFacet,
} from './components/hud/CellDetailPanel';
export {
  default as CellSemanticsReadout,
  formatSemanticAssetAmount,
  type CellSemanticsPhase,
} from './components/hud/CellSemanticsReadout';
export { default as DaoStateReadout } from './components/hud/DaoStateReadout';
export { default as DaoStatePanel } from './components/hud/DaoStatePanel';
export { default as ProtocolEraBadge } from './components/hud/ProtocolEraBadge';
export { default as ActivityFeedReadout } from './components/hud/ActivityFeedReadout';
export { default as TransactionHorizonReadout } from './components/hud/TransactionHorizonReadout';
export { default as NetworkAtlasReadout } from './components/hud/NetworkAtlasReadout';
export { default as StageCapacityPanel } from './components/hud/StageCapacityPanel';
export { useReducedMotion } from './components/hud/useReducedMotion';
export * from './components/hud/cellPopulation.presentation';
export type {
  CellCausalNavigationReadout,
} from './components/hud/CellCausalLensReadout';
export { default as CellNucleusPortrait } from './components/hud/CellNucleusPortrait';
export {
  default as CellMorphologyLabArtwork,
  type CellMorphologyLabCamera,
  type CellMorphologyLabMode,
} from './components/hud/CellMorphologyLabArtwork';
export { default as CellPortraitInset } from './components/hud/CellPortraitInset';
export {
  default as CellCoreArtwork,
  CELL_CORE_DIRECTIONS,
  type CellCoreDirection,
} from './components/hud/CellCoreArtwork';
export { default as RenderStatsPanel } from './components/hud/RenderStatsPanel';
export {
  makeHaloMaterial,
  phaseFor,
  rateFor,
} from './components/GlowNode';
export type { Palette } from './components/GlowNode';
export { default as ColonyEdges } from './components/ColonyEdges';
export { default as ColonyNodes } from './components/ColonyNodes';
export { default as ColonyCourierLayer } from './components/ColonyCourierLayer';
export { default as NetworkColony } from './components/NetworkColony';
export {
  default as PeerInspectionOverlay,
  PeerInspectionAnchor,
  createPeerInspectionHandles,
  type PeerInspectionHandles,
  type PeerInspectionOverlayProps,
} from './components/PeerInspectionOverlay';
export {
  default as PeerLinkCard,
  type PeerLinkCardProps,
} from './components/hud/PeerLinkCard';
export {
  selectedPeerLinkAccent,
  type PeerLinkFacet,
} from './derives/peerLinkInstrument.derive';
export {
  PEER_LINK_LOST_HOLD_MS,
  usePeerInspectionRetention,
  type PeerInspectionRetention,
} from './hooks/usePeerInspectionRetention';
export {
  default as NodeInspectionOverlay,
  NodeInspectionAnchor,
  createNodeInspectionHandles,
  type NodeInspectionHandles,
  type NodeInspectionOverlayProps,
} from './components/NodeInspectionOverlay';
export {
  default as NodeSelfCard,
  NODE_SELF_ACCENT,
  type NodeSelfCardProps,
} from './components/hud/NodeSelfCard';

// ── Consensus flow overlay (Cell→Cell protocol writes) ──────────────
export { default as NeuralNetwork, MAX_ACTIVE_PULSES } from './nerve/NeuralNetwork';
export {
  CELL_INSPECTION_BACKGROUND_ENERGY,
  CELL_INSPECTION_HOP_ENERGY,
  CELL_INSPECTION_MAX_HOPS,
  cellInspectionEdgeScaleAt,
  cellInspectionFieldScale,
  cellInspectionFieldTransitionScaleAt,
  cellInspectionBodyTransitionBlend,
  CELL_INSPECTION_BODY_TRANSITION_SECONDS,
  dampCellInspectionFieldScale,
  deriveCellInspectionField,
  type CellInspectionField,
} from './nerve/cellInspectionField';
export { consensusMemoryTraceIdentityKey } from './nerve/consensusMemoryTraceContinuity';
export { default as ConsensusWriteSeal } from './nerve/DendriticBurst';
export {
  default as ConsensusRouteCamera,
  type ConsensusRouteCameraControls,
  type ConsensusRouteCameraProps,
} from './nerve/ConsensusRouteCamera';
export type { ConsensusWriteSealProps } from './nerve/DendriticBurst';
export {
  planPulses,
  MAX_PULSES_PER_LINK,
  MAX_ORIGINS_PER_LINK,
  type Pulse,
  type PulseOrigin,
  type PulsePlanningOptions,
} from './nerve/pulseRunner';
export { livePulseDepartureDelayS } from './nerve/pulseBatch';
export {
  planConsensusMemoryTrace,
  canRecallConsensusMemory,
  consensusMemoryTraceReadout,
  consensusMemoryTraceRequestKey,
  consensusMemoryRouteHopAdjacentSegments,
  consensusMemoryRouteHopCellFocus,
  consensusMemoryRouteHopFocusEqual,
  classifyConsensusMemoryRouteHopTransition,
  deriveConsensusMemoryRouteHopFocus,
  deriveConsensusMemoryRouteHopInspection,
  deriveConsensusMemoryRouteHopSpatialFocus,
  deriveConsensusMemoryRouteHopTangent,
  deriveConsensusMemoryRouteHopWindow,
  deriveConsensusMemoryTraceEndpoints,
  isConsensusMemoryRouteHopTargetArrival,
  shouldAnimateConsensusMemoryRouteHopTargetLatch,
  stepConsensusMemoryRouteHopFocus,
  validateConsensusMemoryRouteHopFocus,
  CONSENSUS_PULSE_POLICY,
  type ConsensusMemoryTracePlan,
  type ConsensusMemoryTraceReadout,
  type ConsensusMemoryTraceRequest,
  type ConsensusMemoryTraceOutcome,
  type ConsensusMemoryRouteHopFocus,
  type ConsensusMemoryRouteHopInspection,
  type ConsensusMemoryRouteHopRole,
  type ConsensusMemoryRouteHopSpatialFocus,
  type ConsensusMemoryRouteHopTangent,
  type ConsensusMemoryRouteHopTransitionKind,
  type ConsensusMemoryRouteHopWindow,
  type ConsensusMemoryTraceSource,
  type ConsensusMemoryTraceStage,
  type ConsensusMemoryCellResponse,
  type ConsensusMemoryCellResponseRef,
  type ConsensusMemoryEvidenceResponse,
  type ConsensusMemoryEvidenceState,
  deriveConsensusMemoryConsumedInputs,
  type ConsensusMemoryConsumedInput,
  type ConsensusMemorySourceEvidence,
  type ConsensusMemoryTraceEvidence,
  type ConsensusMemoryTargetResponse,
  type ConsensusPulseMode,
} from './nerve/consensusMemoryTrace';
export * from './nerve/pulseStats';
export * from './nerve/fabricStats';
