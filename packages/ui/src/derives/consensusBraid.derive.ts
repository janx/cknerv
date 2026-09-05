import type { Cell } from '@cknerv/types';
import {
  deriveCellMorphologyGenome,
  deriveCellMorphologyTopology,
  type CellMorphologyTopology,
  type CellMorphologyTopologyOptions,
  type MorphologyPoint3,
} from './cellMorphology.derive';
import { CELL_GALAXY_PALETTE, SCENE_ACCENT_PALETTE } from '../visualPalette';

export const CONSENSUS_BRAID_TAU = Math.PI * 2;

export const CONSENSUS_BRAID_FIELDS = [
  'capacity',
  'asset',
  'lock',
  'data',
  'state',
  'born',
] as const;

export type ConsensusBraidField = (typeof CONSENSUS_BRAID_FIELDS)[number];

/**
 * The braid's own names for the scene's accents.
 *
 * ⭐ IT NAMES THEM; IT DOES NOT OWN THEM. Six of these are
 * `SCENE_ACCENT_PALETTE` read by name, because a hue that means "agreement"
 * here and "a record resolved" in `cellNucleusMaterial` is ONE hue with one
 * meaning, and it was three slightly different golds until 2026-09-05. What
 * this map adds is the braid's vocabulary — `gold` is agreement, `violet` is
 * memory, `pale` is consensus light — so the derive reads in its own terms
 * while the value is stated once.
 *
 * ⚠️ `violet` moved: it was (0.4, 0.2, 1), a blue-violet, and the accent set's
 * one violet is the warm-side `memoryViolet`. Same argument as B2's warm pale —
 * the braid is drawn ON the organism, and the organism is rose.
 *
 * Two are the braid's alone. `deepCyan` is the dark end of the block ramp, not
 * an accent; `retire` is death's own signal and belongs to the wither
 * (`cellHybridMaterial`), which is a body colour rather than an event's.
 */
export const CONSENSUS_BRAID_PALETTE = {
  deepCyan: [0.035, 0.28, 0.62],
  gold: SCENE_ACCENT_PALETTE.gold,
  paleGold: SCENE_ACCENT_PALETTE.paleGold,
  cyan: SCENE_ACCENT_PALETTE.cyan,
  violet: SCENE_ACCENT_PALETTE.violet,
  pale: SCENE_ACCENT_PALETTE.pale,
  /** The warm half of the pale pair. The galaxy's own braid reads against
   *  rose tissue, and `pale` is a CYAN white — the peer plane's white, the
   *  carriers' white, the packet heads' white — so a selected cell wearing it
   *  said "network" on a surface that is the organism. This one is the same
   *  value at the same distance from white, turned to the warm side. */
  warmPale: SCENE_ACCENT_PALETTE.warmPale,
  retire: [0.94, 0.12, 0.46],
} as const;

/** Complete semantic identity of A, shared by portrait and production LOD. */
export type ConsensusBraidTopology = CellMorphologyTopology;

/** Intended agreement-node count used by the full A portrait. */
export function consensusBraidAgreementTarget(cell: Cell): number {
  const genome = deriveCellMorphologyGenome(cell);
  return Math.min(genome.data.slots.length, genome.lock.braidWord.length);
}

/** Shared sequential agreement envelope for production LOD and portrait A. */
export function consensusBraidAgreementResolution(
  agreementIndex: number,
  agreementCount: number,
  convergence: number,
): number {
  if (
    !Number.isFinite(agreementIndex)
    || !Number.isFinite(agreementCount)
    || !Number.isFinite(convergence)
    || agreementCount <= 0
  ) return 0;
  const threshold = (Math.max(0, agreementIndex) + 1) / agreementCount;
  const start = Math.max(0, threshold - 0.22);
  const width = Math.max(1e-6, threshold - start);
  const t = Math.max(0, Math.min(1, (convergence - start) / width));
  return t * t * (3 - 2 * t);
}

/** Capacity becomes a restrained, bounded physical presence in both views. */
export function consensusBraidPresenceScale(mass: number): number {
  const boundedMass = Math.max(0.84, Math.min(1.2, mass));
  return 1.02 + (boundedMass - 0.84) * 0.32;
}

/** Birth block becomes a stable packet phase, wrapping only for precision. */
export function consensusBraidBirthPhase(birthBlock: number): number {
  const wrapped = ((Math.trunc(birthBlock) % 4096) + 4096) % 4096;
  return wrapped / 4096 * CONSENSUS_BRAID_TAU;
}

export interface ConsensusBraidLayerOpacity {
  ribbon: number;
  streamGlow: number;
  /** Slow ambient conduction along contributor paths in the detail portrait. */
  streamFlow: number;
  streamCore: number;
  stitchGlow: number;
  stitchCore: number;
  agreementGlow: number;
  agreementCore: number;
  knotGlow: number;
  knotCore: number;
  packet: number;
}

/**
 * The braid is the FIRST visual focus of the cell detail panel, by ruling
 * (2026-09-05): with nothing selected it carries its full balanced weight.
 *
 * Round 3 of the visual review read the opposite off a capture — at `25c7d5a`
 * the CELL SCAN square held 8.75 % of its pixels over L 160 against 0.65 % for
 * the analysis plate, and the review called that a hierarchy upside down, so
 * for one commit (`806f842`) the portrait rested at 0.42 of its weight until a
 * fact asked it something. The user reversed it on sight: the specimen IS the
 * headline of this card, and the radiance at open is the design, not a defect
 * of it. A damping constant that has been ruled to 1 is not kept as a knob —
 * a settled decision is documented, not left as a dead branch — so the resting
 * portrait is the balanced set itself, and a selected fact lifts the layer it
 * owns ABOVE that balance, which is still what makes the selection legible
 * as an act. `consensusBraid.derive.test.ts` pins both halves.
 */

/** Readable A grammar: one on-chain field emphasizes one visual layer. */
export function consensusBraidLayerOpacity(
  focusField: ConsensusBraidField | null,
  strandCount: number,
): ConsensusBraidLayerOpacity {
  const normal: ConsensusBraidLayerOpacity = {
    ribbon: Math.max(0.25, 0.38 - (strandCount - 3) * 0.05),
    streamGlow: 0.045,
    streamFlow: 0.24,
    streamCore: 0.74 - (strandCount - 3) * 0.1,
    stitchGlow: 0.055,
    stitchCore: 0.72,
    agreementGlow: 0.13,
    agreementCore: 0.96,
    knotGlow: 0.18,
    knotCore: 0.98,
    packet: 0.9,
  };
  if (focusField === 'capacity') {
    return {
      ribbon: 0.56,
      streamGlow: 0.025,
      streamFlow: 0.06,
      streamCore: 0.22,
      stitchGlow: 0.018,
      stitchCore: 0.12,
      agreementGlow: 0.025,
      agreementCore: 0.16,
      knotGlow: 0.06,
      knotCore: 0.2,
      packet: 0.16,
    };
  }
  if (focusField === 'asset') {
    return {
      ribbon: 0.14,
      streamGlow: 0.1,
      streamFlow: 0.28,
      streamCore: 0.98,
      stitchGlow: 0.02,
      stitchCore: 0.16,
      agreementGlow: 0.025,
      agreementCore: 0.18,
      knotGlow: 0.07,
      knotCore: 0.24,
      packet: 0.16,
    };
  }
  if (focusField === 'lock') {
    return {
      ribbon: 0.42,
      streamGlow: 0.07,
      streamFlow: 0.24,
      streamCore: 0.86,
      stitchGlow: 0.035,
      stitchCore: 0.28,
      agreementGlow: 0.025,
      agreementCore: 0.18,
      knotGlow: 0.06,
      knotCore: 0.22,
      packet: 0.18,
    };
  }
  if (focusField === 'data') {
    return {
      ribbon: 0.1,
      streamGlow: 0.025,
      streamFlow: 0.1,
      streamCore: 0.2,
      stitchGlow: 0.12,
      stitchCore: 0.92,
      agreementGlow: 0.2,
      agreementCore: 1,
      knotGlow: 0.3,
      knotCore: 1,
      packet: 0.96,
    };
  }
  if (focusField === 'born') {
    return {
      ribbon: 0.08,
      streamGlow: 0.02,
      streamFlow: 0.06,
      streamCore: 0.14,
      stitchGlow: 0.018,
      stitchCore: 0.12,
      agreementGlow: 0.025,
      agreementCore: 0.16,
      knotGlow: 0.06,
      knotCore: 0.2,
      packet: 1,
    };
  }
  // STATE reads the integrity of the whole structure, so it intentionally
  // preserves the complete balance; ConsensusMemory adds a restrained pulse.
  if (focusField === 'state') return normal;
  // …and with NOTHING selected the same balance, at full weight: the braid is
  // the headline of the card (see the ruling above the layer table).
  return normal;
}

/** Sample a canonical closed path without adding renderer-specific topology. */
export function consensusBraidPathPoint(
  points: readonly MorphologyPoint3[],
  parameter: number,
): MorphologyPoint3 {
  const segmentCount = Math.max(0, points.length - 1);
  if (segmentCount === 0) return points[0] ?? [0, 0, 0];
  const wrapped = ((parameter % 1) + 1) % 1;
  const scaled = wrapped * segmentCount;
  const index = Math.floor(scaled) % segmentCount;
  const amount = scaled - Math.floor(scaled);
  const from = points[index];
  const to = points[index + 1];
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
}

/**
 * Resolve the canonical V2 identity once. Renderers may resample these paths,
 * but crossings, data marks, agreement order, capacity presence and ledger
 * phase all come from this single pure result.
 */
export function deriveConsensusBraidTopology(
  cell: Cell,
  options: CellMorphologyTopologyOptions = {},
): ConsensusBraidTopology {
  return deriveCellMorphologyTopology(cell, options);
}

export function consensusBraidContributorColor(
  strand: number,
  spectral: number,
): readonly [number, number, number] {
  const mix = (
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    amount: number,
  ): readonly [number, number, number] => [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
  if (strand % 3 === 0) {
    return mix(
      CELL_GALAXY_PALETTE.tissueRose,
      CELL_GALAXY_PALETTE.warmWhite,
      0.08 + spectral * 0.18,
    );
  }
  if (strand % 3 === 1) {
    return mix(
      CELL_GALAXY_PALETTE.synapseAmber,
      CELL_GALAXY_PALETTE.warmWhite,
      0.06 + spectral * 0.18,
    );
  }
  return mix(
    CELL_GALAXY_PALETTE.memoryViolet,
    CELL_GALAXY_PALETTE.tissueRose,
    0.24 + spectral * 0.28,
  );
}
