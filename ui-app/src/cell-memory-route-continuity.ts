import {
  consensusMemoryTraceIdentityKey,
  deriveConsensusMemoryRouteHopFocus,
  type ConsensusMemoryRouteHopFocus,
  type ConsensusMemoryTraceReadout,
} from '@cknerv/ui';

/** Trace-key-free address remembered only after a route hop was verified. */
export interface CellMemoryRouteAnchor {
  traceIdentity: string;
  sourceId: number;
  targetCellId: number;
  cellId: number;
  hopIndex: number;
}

export function cellMemoryRouteAnchor(
  focus: ConsensusMemoryRouteHopFocus | null,
): CellMemoryRouteAnchor | null {
  return focus
    ? {
      traceIdentity: consensusMemoryTraceIdentityKey(focus.traceKey),
      sourceId: focus.sourceId,
      targetCellId: focus.targetCellId,
      cellId: focus.cellId,
      hopIndex: focus.hopIndex,
    }
    : null;
}

/**
 * Rebind a remembered spatial inspection only after the fresh semantic
 * readout proves that the same source/hop still exists for the same target.
 */
export function restoreCellMemoryRouteAnchor(
  anchor: CellMemoryRouteAnchor | null,
  readout: ConsensusMemoryTraceReadout | null,
): ConsensusMemoryRouteHopFocus | null {
  if (
    !anchor
    || !readout
    || readout.targetCellId !== anchor.targetCellId
    || consensusMemoryTraceIdentityKey(readout.key) !== anchor.traceIdentity
  ) {
    return null;
  }
  const restored = deriveConsensusMemoryRouteHopFocus(
    readout,
    anchor.sourceId,
    anchor.hopIndex,
  );
  return restored?.cellId === anchor.cellId ? restored : null;
}
