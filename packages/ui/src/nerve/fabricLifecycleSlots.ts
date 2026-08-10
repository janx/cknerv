// Static per-slot records for the GPU-parametric fabric (P1.7). One edge's
// slot holds FABRIC_SAMPLES_PER_EDGE capsule instances that all duplicate the
// edge's curve/color/lifecycle record and differ only in their static segment
// span. Written ONCE per lifecycle event (admit / kill / reinforce / aperture
// window) instead of every animated frame; the shader in
// fabricLifecycleShader.ts evaluates everything else from sim time. Pure
// module — unit-tested directly.

import { FABRIC_SAMPLES_PER_EDGE } from './fabricCapacity';
import {
  DEATH_RETRACT_MS,
  DECAY_MS,
  type DeathKind,
} from './fabricEdgeRender';
import { FABRIC_LIFECYCLE_ALIVE_SENTINEL } from './fabricLifecycleShader';

export const FABRIC_LIFE_CURVE_STRIDE = 11; // from(3) ctrl(3) to(3) span(2)
export const FABRIC_LIFE_COLOR_STRIDE = 6; // fromRGB toRGB
export const FABRIC_LIFE_SCALAR_STRIDE = 8; // born dying brightness flags usage usageAt r r
export const FABRIC_LIFE_APERTURE_STRIDE = 2; // start end

export interface FabricLifecycleArrays {
  curve: Float32Array;
  color: Float32Array;
  scalar: Float32Array;
  aperture: Float32Array;
}

export function makeFabricLifecycleArrays(
  maxSegments: number,
): FabricLifecycleArrays {
  return {
    curve: new Float32Array(maxSegments * FABRIC_LIFE_CURVE_STRIDE),
    color: new Float32Array(maxSegments * FABRIC_LIFE_COLOR_STRIDE),
    scalar: new Float32Array(maxSegments * FABRIC_LIFE_SCALAR_STRIDE),
    aperture: new Float32Array(maxSegments * FABRIC_LIFE_APERTURE_STRIDE).fill(1),
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

/** The lifecycle-relevant subset of NeuralFabric's EdgeState. */
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
  /** Usage value at the most recent reinforce event (0 = cold). */
  usageAtEvent: number;
  /** Sim-second of that event; the shader decays from here. */
  usageEventAtSec: number;
}

/** Write one edge's full static record into its slot (all
 *  FABRIC_SAMPLES_PER_EDGE instances). `slotBaseSegment` is the slot's first
 *  segment index (slotIndex × FABRIC_SAMPLES_PER_EDGE). Aperture values are
 *  deliberately NOT touched — they belong to the recall window's own writer
 *  and default to 1. */
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
    arrays.curve[curveOffset + 3] = record.ctrlX;
    arrays.curve[curveOffset + 4] = record.ctrlY;
    arrays.curve[curveOffset + 5] = record.ctrlZ;
    arrays.curve[curveOffset + 6] = record.toX;
    arrays.curve[curveOffset + 7] = record.toY;
    arrays.curve[curveOffset + 8] = record.toZ;
    arrays.curve[curveOffset + 9] = segment / FABRIC_SAMPLES_PER_EDGE;
    arrays.curve[curveOffset + 10] = (segment + 1) / FABRIC_SAMPLES_PER_EDGE;
    const colorOffset = instance * FABRIC_LIFE_COLOR_STRIDE;
    arrays.color[colorOffset] = record.fromR;
    arrays.color[colorOffset + 1] = record.fromG;
    arrays.color[colorOffset + 2] = record.fromB;
    arrays.color[colorOffset + 3] = record.toR;
    arrays.color[colorOffset + 4] = record.toG;
    arrays.color[colorOffset + 5] = record.toB;
    const scalarOffset = instance * FABRIC_LIFE_SCALAR_STRIDE;
    arrays.scalar[scalarOffset] = record.bornAt;
    arrays.scalar[scalarOffset + 1] = dying;
    arrays.scalar[scalarOffset + 2] = record.brightnessMul;
    arrays.scalar[scalarOffset + 3] = flags;
    arrays.scalar[scalarOffset + 4] = record.usageAtEvent;
    arrays.scalar[scalarOffset + 5] = record.usageEventAtSec;
    arrays.scalar[scalarOffset + 6] = 0;
    arrays.scalar[scalarOffset + 7] = 0;
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
