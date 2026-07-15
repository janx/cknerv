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
export * from './tweaks/useSimFrame';
export * from './tweaks/qualityPresets';
export * from './tweaks/adaptiveQuality';
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
export * from './materials/cellShellMaterial';
export * from './materials/shockwaveMaterial';

// ── Geometry helpers ───────────────────────────────────────────────
export * from './geometry/cellPositions';
export * from './geometry/edgeBezier';
export * from './geometry/neighborGraph';
export * from './geometry/pathRouter';
export * from './geometry/truncatedOctahedron';

// ── Derive helpers (pure data shapers consumed by HUDs) ─────────────
export * from './derives/cellShell.derive';
export * from './derives/cellsStats.derive';
export * from './derives/eventStreamLines';
export * from './derives/peers.derive';
export * from './derives/ecgCondition';
export * from './derives/fleetTelemetry';
export * from './derives/alertLevel';
export * from './derives/cellChurn';
export * from './derives/networkTopology.derive';
export * from './derives/networkFlood.derive';

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
  formatCkb, midTruncate, formatOutpoint, formatDataHex, formatCellKind,
  formatAge, formatDataSize, formatLockKind, formatAssetKind,
  LOCK_COLORS, ASSET_COLORS,
} from './components/hud/cellFormat';
export {
  default as CellGalaxy,
  writeCellBuffers,
  writeFlashSlots,
  BLOCK_HIGHLIGHT_DELAY_S,
} from './components/CellGalaxy';
export type { BlockEventTrigger, CellBufferTargets } from './components/CellGalaxy';
export { default as CellShell } from './components/CellShell';
export {
  default as CellsHud,
  formatCommonKnowledgeBytes,
} from './components/CellsHud';
export { default as CkbNetworkHud } from './components/CkbNetworkHud';
export { default as HudOverlay } from './components/hud/HudOverlay';
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

// ── Nerve overlay (cell→cell dendritic pulses; pass as CellGalaxy `overlay`) ──
export { default as NeuralNetwork } from './nerve/NeuralNetwork';
export { default as DendriticBurst } from './nerve/DendriticBurst';
export type { DendriticBurstProps } from './nerve/DendriticBurst';
export { planPulses, type Pulse, type PulsePlanningOptions } from './nerve/pulseRunner';
export * from './nerve/pulseStats';
