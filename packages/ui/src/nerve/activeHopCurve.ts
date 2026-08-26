// Allocation-free curve resolution for NeuralFabric's per-frame active hops.
// A real route normally rides an already-slotted passive edge, whose endpoints
// and quadratic control point were snapshotted at admission. Reusing that
// record removes repeated Cell lookups and control-point derivation while also
// making the active light follow the exact passive curve. Ghost overrides and
// edges outside the passive selection retain the historical fallback.

import { bezierControlInto, fabricEdgeSeed } from '../geometry/edgeBezier';
import type { CellById, Vec3 } from '../types';
import { fabricEdgeKey } from './fabricOrder';

export interface ActiveHopCurveRequest {
  fromCellId: number;
  toCellId: number;
  fromPos?: Vec3;
  toPos?: Vec3;
}

/** Geometry-only subset of NeuralFabric.EdgeState. */
export interface PassiveHopCurveState {
  fromCellId: number;
  toCellId: number;
  fromX: number; fromY: number; fromZ: number;
  ctrlX: number; ctrlY: number; ctrlZ: number;
  toX: number; toY: number; toZ: number;
}

export interface ResolvedActiveHopCurve {
  fromX: number; fromY: number; fromZ: number;
  ctrlX: number; ctrlY: number; ctrlZ: number;
  toX: number; toY: number; toZ: number;
}

export type ActiveHopCurveSource = 'passive' | 'fallback';

function writePassiveCurve(
  out: ResolvedActiveHopCurve,
  state: PassiveHopCurveState,
  reversed: boolean,
): void {
  out.fromX = reversed ? state.toX : state.fromX;
  out.fromY = reversed ? state.toY : state.fromY;
  out.fromZ = reversed ? state.toZ : state.fromZ;
  // A reversed quadratic keeps the same middle control point:
  // B_reversed(t) = B(1 - t).
  out.ctrlX = state.ctrlX;
  out.ctrlY = state.ctrlY;
  out.ctrlZ = state.ctrlZ;
  out.toX = reversed ? state.fromX : state.toX;
  out.toY = reversed ? state.fromY : state.toY;
  out.toZ = reversed ? state.fromZ : state.toZ;
}

/**
 * Resolve one hop into caller-owned scratch storage.
 *
 * Explicit endpoint overrides always select the fallback: a ghost is geometry
 * carried by value and must never be silently replaced by a live passive edge.
 * Without overrides, an exact state match wins in either orientation. Missing
 * passive geometry falls through to the historical Cell lookup + seeded
 * Bezier control derivation byte-for-byte.
 */
export function resolveActiveHopCurveInto(
  out: ResolvedActiveHopCurve,
  controlScratch: Float32Array,
  hop: ActiveHopCurveRequest,
  cells: CellById,
  passiveEdges: ReadonlyMap<string, PassiveHopCurveState>,
): ActiveHopCurveSource | null {
  if (hop.fromPos === undefined && hop.toPos === undefined) {
    const state = passiveEdges.get(fabricEdgeKey(hop.fromCellId, hop.toCellId));
    if (
      state
      && state.fromCellId === hop.fromCellId
      && state.toCellId === hop.toCellId
    ) {
      writePassiveCurve(out, state, false);
      return 'passive';
    }
    if (
      state
      && state.fromCellId === hop.toCellId
      && state.toCellId === hop.fromCellId
    ) {
      writePassiveCurve(out, state, true);
      return 'passive';
    }
  }

  const from = hop.fromPos ?? cells.get(hop.fromCellId)?.pos_seed;
  const to = hop.toPos ?? cells.get(hop.toCellId)?.pos_seed;
  if (!from || !to) return null;
  bezierControlInto(
    controlScratch,
    from[0], from[1], from[2],
    to[0], to[1], to[2],
    fabricEdgeSeed(hop.fromCellId, hop.toCellId),
  );
  out.fromX = from[0]; out.fromY = from[1]; out.fromZ = from[2];
  out.ctrlX = controlScratch[0];
  out.ctrlY = controlScratch[1];
  out.ctrlZ = controlScratch[2];
  out.toX = to[0]; out.toY = to[1]; out.toZ = to[2];
  return 'fallback';
}
