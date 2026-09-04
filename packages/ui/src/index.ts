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

// ── The HUD's own occluding boxes, and the hole they leave ──────────
// The app reads these for one thing only: fitting the camera to the hole the
// rails leave. Additive, and deliberately the SAME reader — and now the same
// HOLE — the inspector's solver and the cell card compose into, rather than a
// fifth `querySelectorAll('[data-hud-occlusion]')` on its own cadence and a
// second opinion about where the stage ends.
export {
  hudHoleFromRects,
  useHudOcclusionRects,
  type HudHole,
  type HudOcclusionRect,
} from './components/hudOcclusion';

// ── Tweaks (sim-clock, useSimFrame, leva presets) ───────────────────
export * from './tweaks/simClock';
export * from './tweaks/SimClockScope';
export * from './tweaks/qualityPresets';
export * from './tweaks/cellDisplay';
export { default as AdaptiveQualityController } from './tweaks/AdaptiveQualityController';
export { default as SimClockTicker } from './tweaks/SimClockTicker';
export { default as TweakSync } from './tweaks/TweakSync';
export { default as RenderStatsSampler } from './tweaks/RenderStatsSampler';
export {
  GPU_FRAME_BRACKET_PERIOD,
  PERFORMANCE_PROBE_LABELS,
  PERFORMANCE_PROBE_SAMPLE_CAPACITY,
  PERFORMANCE_PROBE_SCHEMA_VERSION,
  beginCpuProbe,
  endCpuProbe,
  measureCpuProbe,
  snapshotPerformanceProbe,
  exportPerformanceProbeJson,
  resetPerformanceProbe,
  type CpuProbeSpan,
  type GpuFrameLedgerSnapshot,
  type PerformanceProbeMetricSummary,
  type PerformanceProbeSnapshot,
} from './tweaks/performanceProbeStore';
export {
  beginGpuProbe,
  endGpuProbe,
  createGpuProbeCallbacks,
  type GpuProbeSpan,
} from './tweaks/gpuTimerQuery';
export {
  createNonEmptyDrawGpuProbeCallbacks,
} from './tweaks/nonEmptyGpuProbeCallbacks';

// ── Boot sequence (page-boot progress, written from the entry point) ─
export {
  beginBootPhase,
  completeBootPhase,
  failBootPhase,
  reportBootSnapshotProgress,
  reportBootSeeding,
  completeBootSeeding,
  getBootSequence,
  subscribeBootSequence,
  useBootSequence,
  resetBootSequenceForTest,
  type BootPhaseId,
  type BootPhaseState,
  type BootPhaseSnapshot,
  type BootSequenceSnapshot,
} from './boot/bootSequence';
export { default as BootFrameSentinel } from './boot/BootFrameSentinel';
export { default as BootNerveRestSentinel } from './boot/BootNerveRestSentinel';
// The one piece of the HUD banner's vocabulary the pre-React shell also needs:
// both readouts print the streamed byte count into the same band, minutes of
// wall clock apart on a slow connection and milliseconds apart on a fast one.
export { formatBootSnapshotDetail } from './components/hud/bootSequencePresentation';

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
// The chain's recent producers, and the fingerprint join that narrows one to a
// set of crawled peers without ever narrowing it to a name. App builds the view
// and hands it to the colony (staging), the flood (origin) and the cards.
export * from './derives/blockProducers.derive';
export * from './derives/networkHashRate.derive';
export * from './derives/networkTopology.derive';
export * from './derives/networkFlood.derive';
// Only the placement quantizer: a memo signature over the peer list has to
// resolve a ping exactly as the annulus does, and this keeps the two on one
// formula rather than copying the band constants out of the package.
export { latencyPlacementStep } from './derives/peers.derive';
export * from './derives/sceneView.derive';
// Only the collapse itself: the formatters beside it are banner copy, and the
// one caller outside this package asks a single question — is every stream
// this page subscribed to live?
export {
  deriveStreamHealthSummary,
  type StreamHealthChannels,
} from './derives/streamHealth.derive';

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
// The landing queue: the app owns one and hands it to CellGalaxy (which
// mounts the landing layer that drains it) and to NetworkColony (whose
// delivery layer fills it), the way it already owns the shared flash buffers.
export {
  createLandingFlashQueue,
  type LandingFlashQueue,
} from './components/landingFlashQueue';
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
// The palette, for the one surface the HUD does not own: the app mounts the
// Canvas and paints the ground the whole instrument sits on, so `stageGround`
// has to be readable from out there or it goes back to being a literal.
//
// …and the motion rungs, for the same shape of reason: the card's exit is a
// fade the CHASSIS draws and a hold the APP owns, so the app has to know how
// long the fade is. One number, read from the table rather than typed twice.
export { HUD_COLORS, HUD_MOTION } from './components/hud/hudTheme';
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
export {
  default as MinerInspectionOverlay,
  MinerInspectionAnchor,
  createMinerInspectionHandles,
  type MinerInspectionHandles,
} from './components/MinerInspectionOverlay';
export type { MinerNodeSubject } from './components/hud/MinerNodeCard';
// The colony's fourth selection dialect. It has lived in `ColonyNodes` since
// the mark was drawn and stayed out of this barrel because the barrel is
// deliberately trimmed and takes an export only once something reads it — and
// until the card existed, nothing outside the scene ever had to recognise a
// `miner:` selection. `App` is that reader.
export { MINER_SELECTION_PREFIX } from './components/ColonyNodes';

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
// Bytes handed to bufferSubData by lane — what the fabric, bridge and Cell
// commits actually flag, summed where GL·08 and a probe can read it.
export {
  observeGpuUpload,
  resetGpuUploads,
  snapshotGpuUploads,
  type GpuUploadLane,
  type GpuUploadLaneSnapshot,
  type GpuUploadSnapshot,
} from './tweaks/gpuUploadLedger';
// The colony's own counter, on the same window surface those two ride: where
// each block wave started, which is the only way to observe from outside that
// the flood's origin follows the chain rather than the scatter.
export * from './derives/producerOriginStats';
// The colony's rebuild cadence and the Cell picker's index rebuilds, on the
// same surface: both were argued from source until they had a counter.
export * from './derives/colonyStats';
export * from './geometry/cellPickStats';
