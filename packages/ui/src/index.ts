// @cknerv/ui — chain-generic React + R3F primitives for the CKB
// neural visualization. Wire your `@cknerv/cache` cell-galaxy stream
// into <CellGalaxyProvider> at the root, then drop the primitives
// into any R3F <Canvas>.
//
// What this file publishes: exactly the names `ui-app` imports. It used to
// publish nearly everything the package contains, because a sibling repo
// consumed the surface too — that repo has been out of the picture since
// 2026-08-10, and what was left behind was a barrel re-exporting ~800 names of
// which the one real consumer imported ~100. A barrel that wide is not a
// courtesy; it is a laundering machine. Every symbol inside it counts as "used"
// forever, so nothing in the package can ever be seen to have died, and
// `tsc` has nothing to report. Adding a line back when something new needs it
// is one edit; recovering the ability to tell live code from dead is not.
//
// Modules NOT listed here are still very much alive — they are imported by
// relative path inside the package. Absence from this file means "the app does
// not reach in for this", not "this is unused".

// ── Layout (Y planes + chain-node positioning) ──────────────────────
export * from './layout';

// ── Tweaks (sim-clock, useSimFrame, leva presets) ───────────────────
export * from './tweaks/simClock';
export * from './tweaks/SimClockScope';
export * from './tweaks/qualityPresets';
export * from './tweaks/cellDisplay';
export { default as AdaptiveQualityController } from './tweaks/AdaptiveQualityController';
export { default as SimClockTicker } from './tweaks/SimClockTicker';
export { default as TweakSync } from './tweaks/TweakSync';
export { default as RenderStatsSampler } from './tweaks/RenderStatsSampler';

// ── Geometry helpers ───────────────────────────────────────────────
export * from './geometry/cellPositions';
export * from './geometry/neighborGraph';
export * from './geometry/pathRouter';

// ── Derive helpers (pure data shapers consumed by HUDs) ─────────────
export * from './derives/cellMorphology.derive';
export * from './derives/cellInteraction.derive';
export * from './derives/cellCausalLens.derive';
export * from './derives/consensusBraid.derive';
export * from './derives/consensusFlow.derive';
export * from './derives/cellPopulationField.derive';
export * from './derives/networkTopology.derive';
export * from './derives/networkFlood.derive';
export * from './derives/sceneView.derive';

// ── Hooks ──────────────────────────────────────────────────────────
export { CellGalaxyProvider } from './hooks/cellGalaxyContext';

// ── Components ─────────────────────────────────────────────────────
export {
  default as CellCausalLensLayer,
} from './components/CellCausalLensLayer';
export {
  formatCkb, formatLockKind, formatAssetKind, ASSET_COLORS,
} from './components/hud/cellFormat';
export { default as CellGalaxy } from './components/CellGalaxy';
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
export { default as CellSemanticOrbit } from './components/CellSemanticOrbit';
export {
  default as CellInspectionOverlay,
  CellInspectionAnchor,
  createCellInspectionHandles,
  type CellInspectionHandles,
} from './components/CellInspectionOverlay';
export { default as HudOverlay } from './components/hud/HudOverlay';
export { default as CellDetailPanel } from './components/hud/CellDetailPanel';
export { default as CellNucleusPortrait } from './components/hud/CellNucleusPortrait';
export {
  default as CellMorphologyLabArtwork,
  type CellMorphologyLabMode,
} from './components/hud/CellMorphologyLabArtwork';
export { default as CellPortraitInset } from './components/hud/CellPortraitInset';
export {
  default as CellCoreArtwork,
  CELL_CORE_DIRECTIONS,
  type CellCoreDirection,
} from './components/hud/CellCoreArtwork';
export { default as RenderStatsPanel } from './components/hud/RenderStatsPanel';
export { default as NetworkColony } from './components/NetworkColony';
export {
  default as PeerInspectionOverlay,
  PeerInspectionAnchor,
  createPeerInspectionHandles,
  type PeerInspectionHandles,
} from './components/PeerInspectionOverlay';
export type {
  PeerSightingPhase,
  PeerSightingState,
} from './components/hud/PeerSightingPlate';
export { usePeerInspectionRetention } from './hooks/usePeerInspectionRetention';
export {
  default as NodeInspectionOverlay,
  NodeInspectionAnchor,
  createNodeInspectionHandles,
  type NodeInspectionHandles,
} from './components/NodeInspectionOverlay';
export {
  default as SightedInspectionOverlay,
  SightedInspectionAnchor,
  createSightedInspectionHandles,
  type SightedInspectionHandles,
} from './components/SightedInspectionOverlay';

// ── Consensus flow overlay (Cell→Cell protocol writes) ──────────────
export { default as NeuralNetwork, MAX_ACTIVE_PULSES } from './nerve/NeuralNetwork';
export { consensusMemoryTraceIdentityKey } from './nerve/consensusMemoryTraceContinuity';
export { default as ConsensusWriteSeal } from './nerve/DendriticBurst';
export {
  default as ConsensusRouteCamera,
} from './nerve/ConsensusRouteCamera';
export {
  planPulses,
  MAX_PULSES_PER_LINK,
  MAX_ORIGINS_PER_LINK,
} from './nerve/pulseRunner';
export { livePulseDepartureDelayS } from './nerve/pulseBatch';
export {
  planConsensusMemoryTrace,
  canRecallConsensusMemory,
  consensusMemoryTraceRequestKey,
  consensusMemoryRouteHopFocusEqual,
  deriveConsensusMemoryRouteHopFocus,
  deriveConsensusMemoryTraceEndpoints,
  type ConsensusMemoryTraceReadout,
  type ConsensusMemoryTraceRequest,
  type ConsensusMemoryTraceOutcome,
  type ConsensusMemoryRouteHopFocus,
  type ConsensusMemoryTargetResponse,
} from './nerve/consensusMemoryTrace';
export * from './nerve/pulseStats';
export * from './nerve/fabricStats';
