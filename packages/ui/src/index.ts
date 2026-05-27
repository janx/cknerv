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

// ── Cell Life (Game of Life evaluator + bit-packing) ────────────────
export * from './cellLife/bitsPack';
export * from './cellLife/gameOfLife';

// ── Tweaks (sim-clock, useSimFrame, leva presets) ───────────────────
export * from './tweaks/simClock';
export * from './tweaks/useSimFrame';
export * from './tweaks/qualityPresets';
export * from './tweaks/cameraPresets';

// ── UI chrome (fonts, HUD layout, topology constants, scan state) ───
export * from './ui/fonts';
export * from './ui/hudLayout';
export * from './ui/topologyConstants';
export * from './ui/scanState';

// ── Materials (THREE.ShaderMaterials + GLSL chunks) ─────────────────
export * from './materials/blockBeamMaterial';
export * from './materials/blockBeamPhase';
export * from './materials/cellEnvelope.glsl';
export * from './materials/cellHybridMaterial';
export * from './materials/cellLifeAvatarMaterial';
export * from './materials/cellLifeDetail3DMaterial';
export * from './materials/cellLifeWall';
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

// ── Hooks ──────────────────────────────────────────────────────────
export {
  CellGalaxyProvider,
  useCellGalaxy,
  type CellGalaxyProviderProps,
} from './hooks/cellGalaxyContext';

// ── Components ─────────────────────────────────────────────────────
export { default as BlockBeam } from './components/BlockBeam';
export {
  default as CellDetailHud,
  formatCellKind,
  formatCkb,
  formatDataHex,
  formatOutpoint,
  midTruncate,
} from './components/CellDetailHud';
export { default as CellDetailHudOverlay } from './components/CellDetailHudOverlay';
export {
  default as CellGalaxy,
  writeCellBuffers,
  writeFlashSlots,
  BLOCK_HIGHLIGHT_DELAY_S,
} from './components/CellGalaxy';
export type { BlockEventTrigger, CellBufferTargets } from './components/CellGalaxy';
export { default as CellLifeAvatar } from './components/CellLifeAvatar';
export { default as CellLifeDetail3D } from './components/CellLifeDetail3D';
export { default as CellShell } from './components/CellShell';
export {
  default as CellsHud,
  formatCommonKnowledgeBytes,
} from './components/CellsHud';
export { default as CkbNetworkHud } from './components/CkbNetworkHud';
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
export { default as StatsHud } from './components/StatsHud';
