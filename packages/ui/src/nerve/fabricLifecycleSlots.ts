// Static per-slot records for the GPU-parametric fabric (P1.7). One edge's
// slot holds FABRIC_SAMPLES_PER_EDGE capsule instances that all duplicate the
// edge's curve/color/lifecycle record and differ only in their static segment
// span. Written ONCE per lifecycle event (admit / kill / reinforce / aperture
// window) instead of every animated frame; the shader in
// fabricLifecycleShader.ts evaluates everything else from sim time.
//
// The layout packs everything into THREE vec4-friendly interleaved buffers —
// six attributes total — because vertex attribute locations are a hard GPU
// resource (16 on common hardware) already shared with the line/inspection
// pipeline: curve endpoints carry the segment span in .w, endpoint colors
// carry the recall-aperture scale in .w, and the curve's third .w — the only
// component this layout ever had spare — carries the width tier. Pure module
// — unit-tested directly.

import { FABRIC_SAMPLES_PER_EDGE } from './fabricCapacity';
import {
  DEATH_RETRACT_MS,
  DECAY_MS,
  type DeathKind,
} from './fabricEdgeRender';
import { FABRIC_LIFECYCLE_ALIVE_SENTINEL } from './fabricLifecycleShader';

/** [fx,fy,fz,spanStart, cx,cy,cz,spanEnd, tx,ty,tz,trunkness] */
export const FABRIC_LIFE_CURVE_STRIDE = 12;
/** [fromR,fromG,fromB,apertureStart, toR,toG,toB,apertureEnd] */
export const FABRIC_LIFE_COLOR_STRIDE = 8;
/** [bornAtSec, dyingAtSec, brightnessMul, packedFlags] */
export const FABRIC_LIFE_SCALAR_STRIDE = 4;

/** Float offsets of the two aperture lanes inside one color-stride record. */
export const FABRIC_LIFE_APERTURE_START_OFFSET = 3;
export const FABRIC_LIFE_APERTURE_END_OFFSET = 7;

/** Float offset of the width-tier lane inside one curve-stride record — the
 *  last free component in the whole layout, and the reason the trunk class
 *  costs no attribute location (they are a hard GPU budget this stack already
 *  spends carefully). See `fabricTrunkClass` for what the value means. */
export const FABRIC_LIFE_TRUNKNESS_OFFSET = 11;

export interface FabricLifecycleArrays {
  curve: Float32Array;
  color: Float32Array;
  scalar: Float32Array;
}

export function makeFabricLifecycleArrays(
  maxSegments: number,
): FabricLifecycleArrays {
  const color = new Float32Array(maxSegments * FABRIC_LIFE_COLOR_STRIDE);
  // Aperture lanes rest at the exact 1.0 baseline.
  for (let segment = 0; segment < maxSegments; segment += 1) {
    color[segment * FABRIC_LIFE_COLOR_STRIDE + FABRIC_LIFE_APERTURE_START_OFFSET] = 1;
    color[segment * FABRIC_LIFE_COLOR_STRIDE + FABRIC_LIFE_APERTURE_END_OFFSET] = 1;
  }
  return {
    curve: new Float32Array(maxSegments * FABRIC_LIFE_CURVE_STRIDE),
    color,
    scalar: new Float32Array(maxSegments * FABRIC_LIFE_SCALAR_STRIDE),
  };
}

/** deathKind*4 + deadEndTo*2 + growReversed — small exact float integer,
 *  decoded with floor arithmetic in the vertex stage. */
export function packFabricLifecycleFlags(
  deathKind: DeathKind | null,
  deadEnd: 'from' | 'to' | null,
  growDir: 1 | -1,
): number {
  const kind = deathKind === 'death' ? 1 : deathKind === 'gc' ? 2 : 0;
  const deadEndTo = deadEnd === 'to' ? 1 : 0;
  const reversed = growDir === -1 ? 1 : 0;
  return kind * 4 + deadEndTo * 2 + reversed;
}

/** The lifecycle-relevant subset of NeuralFabric's EdgeState. Fabric-layer
 *  usage is deliberately absent: reinforcement renders on the warm overlay
 *  and the base fabric always evaluated with usage 0. */
export interface FabricLifecycleRecord {
  fromX: number; fromY: number; fromZ: number;
  ctrlX: number; ctrlY: number; ctrlZ: number;
  toX: number; toY: number; toZ: number;
  fromR: number; fromG: number; fromB: number;
  toR: number; toG: number; toB: number;
  bornAt: number;
  dyingAt: number | null;
  deathKind: DeathKind | null;
  deadEnd: 'from' | 'to' | null;
  growDir: 1 | -1;
  brightnessMul: number;
  /** Arbor weight, or `FABRIC_TRUNK_NO_ARBOR`. The vertex stage compares it
   *  against the tier threshold to decide WHICH of the two passive passes
   *  rasterizes this edge — see `fabricTrunkClass`. */
  trunkness: number;
}

/** Write one edge's full static record into its slot (all
 *  FABRIC_SAMPLES_PER_EDGE instances). `slotBaseSegment` is the slot's first
 *  segment index (slotIndex × FABRIC_SAMPLES_PER_EDGE). The aperture lanes are
 *  reset to the 1.0 baseline — a recycled slot must not inherit a stale
 *  recall dim; the recall-window writer re-bakes them while a recall holds. */
export function writeFabricLifecycleSlot(
  arrays: FabricLifecycleArrays,
  slotBaseSegment: number,
  record: FabricLifecycleRecord,
): void {
  const dying = record.dyingAt === null
    ? FABRIC_LIFECYCLE_ALIVE_SENTINEL
    : record.dyingAt;
  const flags = packFabricLifecycleFlags(
    record.deathKind,
    record.deadEnd,
    record.growDir,
  );
  for (let segment = 0; segment < FABRIC_SAMPLES_PER_EDGE; segment += 1) {
    const instance = slotBaseSegment + segment;
    const curveOffset = instance * FABRIC_LIFE_CURVE_STRIDE;
    arrays.curve[curveOffset] = record.fromX;
    arrays.curve[curveOffset + 1] = record.fromY;
    arrays.curve[curveOffset + 2] = record.fromZ;
    arrays.curve[curveOffset + 3] = segment / FABRIC_SAMPLES_PER_EDGE;
    arrays.curve[curveOffset + 4] = record.ctrlX;
    arrays.curve[curveOffset + 5] = record.ctrlY;
    arrays.curve[curveOffset + 6] = record.ctrlZ;
    arrays.curve[curveOffset + 7] = (segment + 1) / FABRIC_SAMPLES_PER_EDGE;
    arrays.curve[curveOffset + 8] = record.toX;
    arrays.curve[curveOffset + 9] = record.toY;
    arrays.curve[curveOffset + 10] = record.toZ;
    arrays.curve[curveOffset + FABRIC_LIFE_TRUNKNESS_OFFSET] = record.trunkness;
    const colorOffset = instance * FABRIC_LIFE_COLOR_STRIDE;
    arrays.color[colorOffset] = record.fromR;
    arrays.color[colorOffset + 1] = record.fromG;
    arrays.color[colorOffset + 2] = record.fromB;
    arrays.color[colorOffset + FABRIC_LIFE_APERTURE_START_OFFSET] = 1;
    arrays.color[colorOffset + 4] = record.toR;
    arrays.color[colorOffset + 5] = record.toG;
    arrays.color[colorOffset + 6] = record.toB;
    arrays.color[colorOffset + FABRIC_LIFE_APERTURE_END_OFFSET] = 1;
    const scalarOffset = instance * FABRIC_LIFE_SCALAR_STRIDE;
    arrays.scalar[scalarOffset] = record.bornAt;
    arrays.scalar[scalarOffset + 1] = dying;
    arrays.scalar[scalarOffset + 2] = record.brightnessMul;
    arrays.scalar[scalarOffset + 3] = flags;
  }
}

/**
 * The sim-second past which this lifecycle can never draw another fragment —
 * the shader hides it analytically, so the CPU's only remaining duty is
 * reclaiming the slot, which it can now do lazily at allocation time instead
 * of scanning per frame. Alive edges never expire (Infinity). Mirrors
 * fabricEdgeRenderState's reap conditions exactly (parity-tested).
 */
export function fabricLifecycleEndSec(
  dyingAt: number | null,
  deathKind: DeathKind | null,
): number {
  if (dyingAt === null) return Number.POSITIVE_INFINITY;
  const windowMs = deathKind === 'death' ? DEATH_RETRACT_MS : DECAY_MS;
  return dyingAt + windowMs / 1000;
}
