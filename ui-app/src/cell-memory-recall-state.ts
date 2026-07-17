import type { ConsensusMemoryTraceRequest } from '@cknerv/ui';

/** Keep the default dashboard's recall legible as a convergence, not traffic. */
export const CELL_MEMORY_RECALL_MAX_PULSES = 2;

export interface CellMemoryRecallState {
  request: ConsensusMemoryTraceRequest | null;
  /** Never reset: stale renderer completions cannot cancel a newer replay. */
  nonce: number;
}

export type CellMemoryRecallAction =
  | { type: 'toggle'; linkSeq: number; targetCellId: number }
  | { type: 'cancel' }
  | { type: 'complete'; request: ConsensusMemoryTraceRequest };

export const INITIAL_CELL_MEMORY_RECALL_STATE: CellMemoryRecallState = {
  request: null,
  nonce: 0,
};

function sameRequest(
  a: ConsensusMemoryTraceRequest,
  b: ConsensusMemoryTraceRequest,
): boolean {
  return a.linkSeq === b.linkSeq
    && a.targetCellId === b.targetCellId
    && a.nonce === b.nonce;
}

/**
 * Explicit recall lifecycle for the default dashboard. Selecting the active
 * write again exits immediately; natural completion clears only the request
 * that actually finished, and the nonce stays monotonic across both paths.
 */
export function cellMemoryRecallReducer(
  state: CellMemoryRecallState,
  action: CellMemoryRecallAction,
): CellMemoryRecallState {
  if (action.type === 'cancel') {
    return state.request === null ? state : { ...state, request: null };
  }

  if (action.type === 'complete') {
    if (
      state.request === null
      || !sameRequest(state.request, action.request)
    ) {
      return state;
    }
    return { ...state, request: null };
  }

  if (
    state.request?.linkSeq === action.linkSeq
    && state.request.targetCellId === action.targetCellId
  ) {
    return { ...state, request: null };
  }

  const nonce = state.nonce + 1;
  return {
    nonce,
    request: {
      linkSeq: action.linkSeq,
      targetCellId: action.targetCellId,
      nonce,
    },
  };
}
