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
  GraphEdge,
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
export * from './tweaks/cameraPresets';
export { default as AdaptiveQualityController } from './tweaks/AdaptiveQualityController';
export { default as SimClockTicker } from './tweaks/SimClockTicker';
export { default as TweakSync } from './tweaks/TweakSync';
export { LIVE } from './tweaks/liveTweaks';
export type { LiveTweaks } from './tweaks/liveTweaks';
export { RENDER_STATS_TOGGLE } from './tweaks/renderStatsStore';
export { default as RenderStatsSampler } from './tweaks/RenderStatsSampler';

// ── UI chrome (fonts, HUD layout, topology constants) ───────────────
export * from './ui/fonts';
export * from './ui/hudLayout';
export * from './ui/topologyConstants';

// ── Materials (THREE.ShaderMaterials + GLSL chunks) ─────────────────
export * from './materials/cellEnvelope.glsl';
export * from './materials/cellHybridMaterial';
export * from './materials/cellOrganismMaterial';
export * from './materials/cellShellMaterial';
export * from './materials/shockwaveMaterial';
export * from './materials/peerNodeMaterial';
export * from './materials/consensusMemoryKnotMaterial';

// ── Geometry helpers ───────────────────────────────────────────────
export * from './geometry/cellPositions';
export * from './geometry/cellCausalLens';
export * from './geometry/edgeBezier';
export * from './geometry/neighborGraph';
export * from './geometry/pathRouter';
export * from './geometry/truncatedOctahedron';

// ── Derive helpers (pure data shapers consumed by HUDs) ─────────────
export * from './derives/cellShell.derive';
export * from './derives/cellVisual.derive';
export * from './derives/cellInteraction.derive';
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
export * from './derives/eventStreamLines';
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
export { default as BackfillHud } from './components/BackfillHud';
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
  BLOCK_HIGHLIGHT_DELAY_S,
} from './components/CellGalaxy';
export {
  default as CanonicalRewriteEcho,
  makeCanonicalRewriteEchoMaterial,
} from './components/CanonicalRewriteEcho';
export type { BlockEventTrigger, CellBufferTargets } from './components/CellGalaxy';
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
export { default as CellShell } from './components/CellShell';
export { default as CellOrganism } from './components/CellOrganism';
export {
  default as CellsHud,
  formatCommonKnowledgeBytes,
} from './components/CellsHud';
export { default as CkbNetworkHud } from './components/CkbNetworkHud';
export { default as HudOverlay } from './components/hud/HudOverlay';
export { default as CellDetailPanel } from './components/hud/CellDetailPanel';
export type {
  CellCausalNavigationReadout,
} from './components/hud/CellCausalLensReadout';
export { default as CellNucleusPortrait } from './components/hud/CellNucleusPortrait';
export {
  default as CellCoreArtwork,
  CELL_CORE_DIRECTIONS,
  type CellCoreDirection,
} from './components/hud/CellCoreArtwork';
export { default as RenderStatsPanel } from './components/hud/RenderStatsPanel';
export {
  default as EdgeEnvelopeLayer,
  buildTrajectories,
  colorForOriginIdx,
} from './components/EdgeEnvelopeLayer';
export type { EdgeEnvelope, Trajectory } from './components/EdgeEnvelopeLayer';
export { default as EventStreamHud } from './components/EventStreamHud';
export type {
  RenderedLine,
  EventStreamHudProps,
} from './components/EventStreamHud';
export {
  default as GlowNode,
  makeHaloMaterial,
  phaseFor,
  rateFor,
} from './components/GlowNode';
export type { Palette, Shape } from './components/GlowNode';
export { default as CrystalGlow } from './components/CrystalGlow';
export { default as NetworkHud } from './components/NetworkHud';
export { default as ColonyEdges } from './components/ColonyEdges';
export { default as ColonyNodes } from './components/ColonyNodes';
export { default as ColonyCourierLayer } from './components/ColonyCourierLayer';
export { default as NetworkColony } from './components/NetworkColony';

// ── Consensus flow overlay (Cell→Cell protocol writes) ──────────────
export { default as NeuralNetwork } from './nerve/NeuralNetwork';
export {
  CELL_INSPECTION_BACKGROUND_ENERGY,
  CELL_INSPECTION_HOP_ENERGY,
  CELL_INSPECTION_MAX_HOPS,
  cellInspectionEdgeScaleAt,
  cellInspectionFieldScale,
  cellInspectionFieldTransitionScaleAt,
  dampCellInspectionFieldScale,
  deriveCellInspectionField,
  type CellInspectionField,
} from './nerve/cellInspectionField';
export { consensusMemoryTraceIdentityKey } from './nerve/consensusMemoryTraceContinuity';
export { default as DendriticBurst } from './nerve/DendriticBurst';
export { default as ConsensusWriteSeal } from './nerve/DendriticBurst';
export {
  default as ConsensusRouteCamera,
  type ConsensusRouteCameraControls,
  type ConsensusRouteCameraProps,
} from './nerve/ConsensusRouteCamera';
export type {
  ConsensusWriteSealProps,
  DendriticBurstProps,
} from './nerve/DendriticBurst';
export { planPulses, type Pulse, type PulsePlanningOptions } from './nerve/pulseRunner';
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
  type ConsensusMemorySourceEvidence,
  type ConsensusMemoryTraceEvidence,
  type ConsensusMemoryTargetResponse,
  type ConsensusPulseMode,
} from './nerve/consensusMemoryTrace';
export * from './nerve/pulseStats';
