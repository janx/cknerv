import {
  CELL_IDENTITY_PROOF_KINDS,
  cellIdentityProofBindingComplete,
  type CellIdentityBindingPhase,
  type CellIdentityProofBinding,
  type CellIdentityProofKind,
} from '@cknerv/ui';

export interface CellIdentityJourneyState {
  binding: CellIdentityProofBinding | null;
  /** Monotonic across selection changes so visual transition keys never alias. */
  revision: number;
  /** Exact trace request currently allowed to resolve this identity session. */
  activeRecallKey: string | null;
  /** Replay cancellation returns to retained when a prior recall was verified. */
  recallReturnPhase: Extract<
    CellIdentityBindingPhase,
    'verified' | 'retained'
  >;
}

export type CellIdentityJourneyAction =
  | { type: 'select'; cellId: number; atMs: number }
  | {
      type: 'resolve';
      cellId: number;
      kind: CellIdentityProofKind;
      atMs: number;
      reducedMotion: boolean;
    }
  | {
      type: 'recall-start';
      cellId: number;
      requestKey: string;
      atMs: number;
    }
  | { type: 'recall-stop'; atMs: number }
  | {
      type: 'recall-retained';
      cellId: number;
      requestKey: string;
      atMs: number;
    }
  | { type: 'clear' };

export const INITIAL_CELL_IDENTITY_JOURNEY_STATE: CellIdentityJourneyState = {
  binding: null,
  revision: 0,
  activeRecallKey: null,
  recallReturnPhase: 'verified',
};

function nextBinding(
  state: CellIdentityJourneyState,
  binding: Omit<CellIdentityProofBinding, 'revision'>,
): CellIdentityJourneyState {
  const revision = state.revision + 1;
  return {
    ...state,
    revision,
    binding: { ...binding, revision },
  };
}

/** One selected-Cell identity lifecycle from facet reads into retained memory. */
export function cellIdentityJourneyReducer(
  state: CellIdentityJourneyState,
  action: CellIdentityJourneyAction,
): CellIdentityJourneyState {
  if (action.type === 'clear') {
    if (state.binding === null && state.activeRecallKey === null) return state;
    return {
      ...state,
      binding: null,
      activeRecallKey: null,
      recallReturnPhase: 'verified',
    };
  }

  if (action.type === 'select') {
    if (state.binding?.cellId === action.cellId) return state;
    const revision = state.revision + 1;
    return {
      ...state,
      revision,
      binding: {
        cellId: action.cellId,
        resolvedKinds: [],
        phase: 'collecting',
        revision,
        changedAtMs: action.atMs,
        lastResolvedKind: null,
        reducedMotion: false,
      },
      activeRecallKey: null,
      recallReturnPhase: 'verified',
    };
  }

  const binding = state.binding;
  if (!binding) return state;

  if (action.type === 'resolve') {
    if (
      binding.cellId !== action.cellId
      || binding.resolvedKinds.includes(action.kind)
    ) {
      return state;
    }
    const resolvedKinds = CELL_IDENTITY_PROOF_KINDS.filter(
      (kind) => kind === action.kind || binding.resolvedKinds.includes(kind),
    );
    return nextBinding(state, {
      ...binding,
      resolvedKinds,
      phase: resolvedKinds.length === CELL_IDENTITY_PROOF_KINDS.length
        ? 'verified'
        : 'collecting',
      changedAtMs: action.atMs,
      lastResolvedKind: action.kind,
      reducedMotion: action.reducedMotion,
    });
  }

  if (action.type === 'recall-start') {
    if (
      binding.cellId !== action.cellId
      || !cellIdentityProofBindingComplete(binding)
    ) {
      return state;
    }
    if (
      binding.phase === 'recalling'
      && state.activeRecallKey === action.requestKey
    ) {
      return state;
    }
    const recallReturnPhase = binding.phase === 'retained'
      ? 'retained'
      : 'verified';
    return {
      ...nextBinding(state, {
        ...binding,
        phase: 'recalling',
        changedAtMs: action.atMs,
      }),
      activeRecallKey: action.requestKey,
      recallReturnPhase,
    };
  }

  if (action.type === 'recall-stop') {
    if (binding.phase !== 'recalling') return state;
    return {
      ...nextBinding(state, {
        ...binding,
        phase: state.recallReturnPhase,
        changedAtMs: action.atMs,
      }),
      activeRecallKey: null,
    };
  }

  if (
    binding.cellId !== action.cellId
    || state.activeRecallKey !== action.requestKey
  ) {
    return state;
  }
  return {
    ...nextBinding(state, {
      ...binding,
      phase: 'retained',
      changedAtMs: action.atMs,
    }),
    activeRecallKey: null,
    recallReturnPhase: 'retained',
  };
}
