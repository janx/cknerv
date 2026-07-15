import { fnv1a } from '../geometry/edgeBezier';
import { CONSENSUS_BRAID_PALETTE } from './consensusBraid.derive';
import type { CellVisualDescriptor } from './cellVisual.derive';

export type ConsensusFlowColor = [number, number, number];

export interface ConsensusRouteColors {
  /** Colour at the lower canonical Cell id. */
  from: ConsensusFlowColor;
  /** Colour at the higher canonical Cell id. */
  to: ConsensusFlowColor;
}

export interface ConsensusWriteSealState {
  visible: boolean;
  /** Normalised sprite radius in [0, 1]. */
  radius: number;
  /** Additive intensity envelope in [0, 1]. */
  opacity: number;
  /** Early agreement-knot intensity in [0, 1]. */
  core: number;
  /** Radians used to counter-rotate the two interrupted rings. */
  rotation: number;
  /** Settled-memory blend in [0, 1], used for semantic screen-space LOD. */
  memory: number;
}

/** Fast, legible write stamp followed by a quiet structural memory latch. */
export const CONSENSUS_WRITE_PHASE_S = 0.72;
export const CONSENSUS_MEMORY_PHASE_S = 6.0;
export const CONSENSUS_WRITE_SEAL_LIFETIME_S =
  CONSENSUS_WRITE_PHASE_S + CONSENSUS_MEMORY_PHASE_S;

const mixColor = (
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  amount: number,
): ConsensusFlowColor => [
  from[0] + (to[0] - from[0]) * amount,
  from[1] + (to[1] - from[1]) * amount,
  from[2] + (to[2] - from[2]) * amount,
];

const scaleColor = (
  color: readonly [number, number, number],
  amount: number,
): ConsensusFlowColor => [
  color[0] * amount,
  color[1] * amount,
  color[2] * amount,
];

const byteUnit = (seed: number, shift: number): number => (
  ((seed >>> shift) & 0xff) / 0xff
);

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

function coolContributor(amount: number): ConsensusFlowColor {
  return mixColor(
    CONSENSUS_BRAID_PALETTE.deepCyan,
    CONSENSUS_BRAID_PALETTE.cyan,
    0.3 + amount * 0.48,
  );
}

function goldContributor(amount: number): ConsensusFlowColor {
  return mixColor(
    CONSENSUS_BRAID_PALETTE.gold,
    CONSENSUS_BRAID_PALETTE.paleGold,
    0.08 + amount * 0.28,
  );
}

/**
 * Stable resting colours for one canonical Cell edge. Hash variation stays
 * inside the structural blue/cyan family; gold is applied later from actual
 * hierarchy and observed traffic, never assigned to a cold route by chance.
 */
export function consensusRouteColors(seed: number): ConsensusRouteColors {
  const first = coolContributor(byteUnit(seed, 8));
  const second = coolContributor(byteUnit(seed, 16));
  const energy = 0.72;
  return { from: scaleColor(first, energy), to: scaleColor(second, energy) };
}

/** Stable resting Cell colour. Content hash supplies variation only within the
 * structural cyan family; on-chain asset/tag metadata is retained as a small
 * accent and can never turn an idle Cell into a false activity signal. */
export function consensusCellColor(
  visual: CellVisualDescriptor,
): ConsensusFlowColor {
  const structure = coolContributor(visual.seeds[0]);
  const depth = mixColor(
    CONSENSUS_BRAID_PALETTE.deepCyan,
    structure,
    0.58 + visual.seeds[1] * 0.3,
  );
  return mixColor(depth, visual.accent, 0.025 + visual.payload * 0.015);
}

/** Gold occupancy for one passive route. Geometric hierarchy establishes a
 * restrained persistent backbone; repeated real packet crossings dominate and
 * can turn the route into a warm consensus trunk. */
export function consensusRouteGoldMix(
  hierarchy: number,
  usage: number,
): number {
  const trunk = Math.max(0, Math.min(1, hierarchy)) * 0.28;
  const traffic = smoothstep(0.02, 0.88, Math.max(0, Math.min(1, usage))) * 0.82;
  return Math.max(trunk, traffic);
}

/** Chroma-preserving soft knee for additive moving paths. It keeps the packet
 * lane below hard RGB clipping while the separate pale head glyph supplies the
 * high-energy focal point. */
export function consensusChromaIntensity(intensity: number): number {
  const energy = Number.isFinite(intensity) ? Math.max(0, intensity) : 0;
  return 1.12 * (1 - Math.exp(-energy * 0.72));
}

/**
 * One transaction keeps one packet identity from source through arrival.
 * Moving information occupies the warm consensus lane; the tx hash varies it
 * subtly toward cyan, while a tag adds only a restrained metadata accent.
 */
export function consensusPacketColor(
  txHash: string,
  tag: string | null,
): ConsensusFlowColor {
  const txSeed = fnv1a(txHash);
  const spectral = byteUnit(txSeed, 8);
  const base = mixColor(
    goldContributor(spectral),
    coolContributor(byteUnit(txSeed, 16)),
    0.035 + byteUnit(txSeed, 24) * 0.075,
  );

  if (!tag) return base;
  const tagSeed = fnv1a(tag);
  const accent = (tagSeed & 1) === 0
    ? CONSENSUS_BRAID_PALETTE.violet
    : CONSENSUS_BRAID_PALETTE.pale;
  return mixColor(base, accent, 0.025 + byteUnit(tagSeed, 8) * 0.025);
}

/**
 * Stable carrier identity for one observed block pulse. The block stays in the
 * warm information lane and lifts slightly toward pale while crossing the
 * dimmer P2P and galaxy layers. Transactions retain subtler identities after
 * the carrier reaches the Cell field.
 */
export function consensusBlockColor(nonce: number): ConsensusFlowColor {
  const stableNonce = Number.isFinite(nonce) ? Math.trunc(nonce) : 0;
  const base = consensusPacketColor(`block:${stableNonce}`, null);
  return mixColor(base, CONSENSUS_BRAID_PALETTE.pale, 0.08);
}

/**
 * Pure write-seal lifecycle in seconds. The first phase expands the agreement
 * stamp; the second contracts it into a restrained knot that remains attached
 * to the written Cell, making persistence visible without adding fake data.
 */
export function consensusWriteSealState(ageS: number): ConsensusWriteSealState {
  if (!(ageS > 0 && ageS < CONSENSUS_WRITE_SEAL_LIFETIME_S)) {
    return { visible: false, radius: 0, opacity: 0, core: 0, rotation: 0, memory: 0 };
  }
  if (ageS <= CONSENSUS_WRITE_PHASE_S) {
    const writeT = ageS / CONSENSUS_WRITE_PHASE_S;
    const easeOut = 1 - (1 - writeT) ** 3;
    const startup = smoothstep(0, 0.12, writeT);
    return {
      visible: true,
      radius: 0.08 + easeOut * 0.92,
      opacity: Math.sin(writeT * Math.PI) * startup * (1 - writeT * 0.12),
      core: 1 - smoothstep(0.12, 0.42, writeT),
      rotation: writeT * 1.35,
      memory: 0,
    };
  }

  const memoryT = (ageS - CONSENSUS_WRITE_PHASE_S) / CONSENSUS_MEMORY_PHASE_S;
  const latch = smoothstep(0, 0.12, memoryT);
  const appear = smoothstep(0, 0.025, memoryT);
  const fade = 1 - smoothstep(0.9, 1, memoryT);
  return {
    visible: true,
    radius: 1 - latch * 0.48,
    opacity: (0.32 + (1 - latch) * 0.18) * appear * fade,
    core: latch * 0.5 * fade,
    rotation: 1.35 + memoryT * 0.65,
    memory: latch * fade,
  };
}
