import { describe, expect, it } from 'vitest';
import {
  CELL_CAUSAL_NAVIGATION_LIMIT,
  INITIAL_CELL_CAUSAL_NAVIGATION_STATE,
  cellCausalNavigationReducer,
  cellCausalNavigationStep,
} from '../src/cell-causal-navigation-state';

describe('cell causal navigation state', () => {
  it('starts at an ordinary selection and appends explicit causal jumps', () => {
    const selected = cellCausalNavigationReducer(
      INITIAL_CELL_CAUSAL_NAVIGATION_STATE,
      { type: 'select', cellId: 8687 },
    );
    const navigated = cellCausalNavigationReducer(selected, {
      type: 'navigate',
      fromCellId: 8687,
      targetCellId: 8686,
    });

    expect(navigated).toEqual({
      entries: [8687, 8686],
      index: 1,
    });
    expect(cellCausalNavigationStep(navigated, -1)).toEqual({
      cellId: 8687,
      index: 0,
    });
    expect(cellCausalNavigationStep(navigated, 1)).toBeNull();
  });

  it('moves backward and forward without rewriting the path', () => {
    const state = {
      entries: [10, 11, 12],
      index: 2,
    };
    const back = cellCausalNavigationReducer(state, {
      type: 'move',
      index: 1,
    });
    const forward = cellCausalNavigationReducer(back, {
      type: 'move',
      index: 2,
    });

    expect(back).toEqual({ entries: state.entries, index: 1 });
    expect(forward).toEqual({ entries: state.entries, index: 2 });
  });

  it('truncates the abandoned forward branch after a new causal jump', () => {
    const branched = cellCausalNavigationReducer(
      { entries: [10, 11, 12], index: 1 },
      { type: 'navigate', fromCellId: 11, targetCellId: 13 },
    );

    expect(branched).toEqual({
      entries: [10, 11, 13],
      index: 2,
    });
  });

  it('reseeds a stale journey from the Cell that emitted the jump', () => {
    const recovered = cellCausalNavigationReducer(
      { entries: [10, 11], index: 1 },
      { type: 'navigate', fromCellId: 20, targetCellId: 21 },
    );

    expect(recovered).toEqual({
      entries: [20, 21],
      index: 1,
    });
  });

  it('skips history entries whose Cell records left the live cache', () => {
    const state = {
      entries: [10, 11, 12, 13],
      index: 3,
    };

    expect(cellCausalNavigationStep(
      state,
      -1,
      (cellId) => cellId !== 12,
    )).toEqual({ cellId: 11, index: 1 });
  });

  it('bounds long journeys and clears them with the Cell selection', () => {
    let state = cellCausalNavigationReducer(
      INITIAL_CELL_CAUSAL_NAVIGATION_STATE,
      { type: 'select', cellId: 0 },
    );
    for (let cellId = 1; cellId <= CELL_CAUSAL_NAVIGATION_LIMIT + 4; cellId += 1) {
      state = cellCausalNavigationReducer(state, {
        type: 'navigate',
        fromCellId: state.entries[state.index] ?? null,
        targetCellId: cellId,
      });
    }

    expect(state.entries).toHaveLength(CELL_CAUSAL_NAVIGATION_LIMIT);
    expect(state.entries[0]).toBe(5);
    expect(state.index).toBe(CELL_CAUSAL_NAVIGATION_LIMIT - 1);
    expect(cellCausalNavigationReducer(state, { type: 'clear' }))
      .toBe(INITIAL_CELL_CAUSAL_NAVIGATION_STATE);
  });
});
