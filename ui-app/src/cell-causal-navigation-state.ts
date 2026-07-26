export const CELL_CAUSAL_NAVIGATION_LIMIT = 24;

export interface CellCausalNavigationState {
  /** Browser-like causal inspection trail, including the current Cell. */
  entries: readonly number[];
  /** Current entry inside `entries`; `-1` means there is no Cell journey. */
  index: number;
}

export interface CellCausalNavigationStep {
  cellId: number;
  index: number;
}

export type CellCausalNavigationAction =
  | { type: 'select'; cellId: number }
  | {
    type: 'navigate';
    fromCellId: number | null;
    targetCellId: number;
  }
  | { type: 'move'; index: number }
  | { type: 'clear' };

export const INITIAL_CELL_CAUSAL_NAVIGATION_STATE: CellCausalNavigationState = {
  entries: [],
  index: -1,
};

function validCellId(cellId: number | null): cellId is number {
  return cellId !== null
    && Number.isSafeInteger(cellId)
    && cellId >= 0;
}

/**
 * Find the next retained history entry in one direction. Missing projection
 * records are skipped without erasing the honest path that was already read.
 */
export function cellCausalNavigationStep(
  state: CellCausalNavigationState,
  direction: -1 | 1,
  isRetained: (cellId: number) => boolean = () => true,
): CellCausalNavigationStep | null {
  if (state.index < 0 || state.index >= state.entries.length) return null;
  for (
    let index = state.index + direction;
    index >= 0 && index < state.entries.length;
    index += direction
  ) {
    const cellId = state.entries[index];
    if (cellId !== undefined && isRetained(cellId)) {
      return { cellId, index };
    }
  }
  return null;
}

/**
 * Browser-like history for explicit causal endpoint jumps. An ordinary galaxy
 * selection starts a fresh journey; a causal jump appends after the current
 * entry and truncates any abandoned forward branch.
 */
export function cellCausalNavigationReducer(
  state: CellCausalNavigationState,
  action: CellCausalNavigationAction,
): CellCausalNavigationState {
  if (action.type === 'clear') {
    return state.entries.length === 0
      ? state
      : INITIAL_CELL_CAUSAL_NAVIGATION_STATE;
  }

  if (action.type === 'move') {
    if (
      !Number.isSafeInteger(action.index)
      || action.index < 0
      || action.index >= state.entries.length
      || action.index === state.index
    ) return state;
    return { ...state, index: action.index };
  }

  if (action.type === 'select') {
    if (!validCellId(action.cellId)) return state;
    if (state.entries[state.index] === action.cellId) return state;
    return { entries: [action.cellId], index: 0 };
  }

  if (!validCellId(action.targetCellId)) return state;
  const currentCellId = state.entries[state.index] ?? null;
  const fromCellId = validCellId(action.fromCellId)
    ? action.fromCellId
    : currentCellId;
  if (currentCellId === action.targetCellId) return state;

  const prefix = fromCellId !== null && currentCellId === fromCellId
    ? state.entries.slice(0, state.index + 1)
    : fromCellId === null
      ? []
      : [fromCellId];
  if (prefix.at(-1) === action.targetCellId) return state;

  const appended = [...prefix, action.targetCellId];
  const entries = appended.length > CELL_CAUSAL_NAVIGATION_LIMIT
    ? appended.slice(appended.length - CELL_CAUSAL_NAVIGATION_LIMIT)
    : appended;
  return {
    entries,
    index: entries.length - 1,
  };
}
