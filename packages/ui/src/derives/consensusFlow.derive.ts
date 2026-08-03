import { fnv1a } from '../geometry/edgeBezier';
import { CONSENSUS_BRAID_PALETTE } from './consensusBraid.derive';
import type { CellVisualDescriptor } from './cellVisual.derive';
import { CELL_GALAXY_PALETTE } from '../visualPalette';

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

export interface ConsensusWriteSealArrival {
  firedAt: number;
  color: ConsensusFlowColor;
}

export interface ConsensusWriteSealSlot extends ConsensusWriteSealArrival {
  cellId: number;
}

function normalizeWriteSealCapacity(capacity: number): number {
  return Number.isFinite(capacity)
    ? Math.max(0, Math.floor(capacity))
    : 0;
}

/** Drain the imperative arrival map exactly once. The producer already keeps
 * only the newest write per Cell between frames, so clearing after consumption
 * turns the shared Map into a bounded event queue instead of an ever-growing
 * history that every animation frame must rescan. */
export function drainConsensusWriteSealArrivals(
  arrivals: Map<number, ConsensusWriteSealArrival>,
  slots: ConsensusWriteSealSlot[],
  nowSec: number,
  capacity: number,
  lifetimeSec = CONSENSUS_WRITE_SEAL_LIFETIME_S,
  consumedCellIds?: Set<number>,
): number {
  const limit = normalizeWriteSealCapacity(capacity);
  let added = 0;
  if (limit > 0 && Number.isFinite(nowSec) && Number.isFinite(lifetimeSec)) {
    for (const [cellId, entry] of arrivals) {
      if (
        Number.isFinite(entry.firedAt)
        && entry.firedAt >= nowSec - Math.max(0, lifetimeSec)
      ) {
        slots.push({ cellId, firedAt: entry.firedAt, color: entry.color });
        consumedCellIds?.add(cellId);
        added += 1;
      }
    }
  }
  arrivals.clear();

  if (slots.length > limit) {
    // Retain newest insertion-order entries without allocating a sliced copy.
    slots.copyWithin(0, slots.length - limit);
    slots.length = limit;
  }
  return added;
}

/** Compact active write seals in place. Missing/expired records can never
 * become visible again, so retaining them would only keep the frame loop busy. */
export function compactConsensusWriteSealSlots(
  slots: ConsensusWriteSealSlot[],
  nowSec: number,
  cells?: ReadonlyMap<number, unknown>,
  lifetimeSec = CONSENSUS_WRITE_SEAL_LIFETIME_S,
): number {
  if (
    !Number.isFinite(nowSec)
    || !Number.isFinite(lifetimeSec)
    || lifetimeSec <= 0
  ) {
    slots.length = 0;
    return 0;
  }

  let write = 0;
  for (const slot of slots) {
    if (!Number.isFinite(slot.firedAt)) continue;
    if (nowSec - slot.firedAt >= lifetimeSec) continue;
    if (cells && !cells.has(slot.cellId)) continue;
    slots[write] = slot;
    write += 1;
  }
  slots.length = write;
  return write;
}

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

function veinContributor(amount: number): ConsensusFlowColor {
  return mixColor(
    CELL_GALAXY_PALETTE.veinCrimson,
    CELL_GALAXY_PALETTE.veinRose,
    0.08 + amount * 0.18,
  );
}

/** Restrained cool contributor used only as a spectral shoulder on moving
 * protocol identities and historical memory, never as the resting Cell field. */
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
 * inside the crimson vascular family; gold is applied later from actual
 * hierarchy and observed traffic, so the field reads as living tissue at rest
 * and a firing neural structure under load.
 */
export function consensusRouteColors(seed: number): ConsensusRouteColors {
  const first = veinContributor(byteUnit(seed, 8));
  const second = veinContributor(byteUnit(seed, 16));
  const energy = 0.92;
  return { from: scaleColor(first, energy), to: scaleColor(second, energy) };
}

/** Stable resting Cell colour. Untagged Cells restore the luminous rose body
 * used by the earlier galaxy; explicit runtime tags retain their established
 * pastel identity. Asset/lock semantics remain encoded by the Cell form rather
 * than turning the far field into a categorical network chart. */
export function consensusCellColor(
  visual: CellVisualDescriptor,
  tagged = false,
): ConsensusFlowColor {
  const color = tagged
    ? visual.accent
    : CELL_GALAXY_PALETTE.tissueRose;
  return [color[0], color[1], color[2]];
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
 * Cool historical-recall identity. A memory trace must remain visibly
 * distinct from the warm lane reserved for newly observed block/tx traffic.
 */
export function consensusMemoryTraceColor(txHash: string): ConsensusFlowColor {
  const seed = fnv1a(`memory:${txHash}`);
  const spectral = byteUnit(seed, 8);
  const memory = mixColor(
    CONSENSUS_BRAID_PALETTE.violet,
    CONSENSUS_BRAID_PALETTE.cyan,
    0.14 + spectral * 0.14,
  );
  return mixColor(memory, CONSENSUS_BRAID_PALETTE.pale, 0.06);
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
