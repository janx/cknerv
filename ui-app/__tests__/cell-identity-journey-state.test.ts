import { describe, expect, it } from 'vitest';
import {
  INITIAL_CELL_IDENTITY_JOURNEY_STATE,
  cellIdentityJourneyReducer,
} from '../src/cell-identity-journey-state';

function selected(cellId = 42) {
  return cellIdentityJourneyReducer(
    INITIAL_CELL_IDENTITY_JOURNEY_STATE,
    { type: 'select', cellId, atMs: 10 },
  );
}

describe('Cell identity journey state', () => {
  it('collects each exact proof once in canonical WHERE / WHAT / WHEN order', () => {
    const address = cellIdentityJourneyReducer(selected(), {
      type: 'resolve',
      cellId: 42,
      kind: 'address',
      atMs: 20,
      reducedMotion: false,
    });
    const duplicate = cellIdentityJourneyReducer(address, {
      type: 'resolve',
      cellId: 42,
      kind: 'address',
      atMs: 30,
      reducedMotion: false,
    });
    const anchor = cellIdentityJourneyReducer(duplicate, {
      type: 'resolve',
      cellId: 42,
      kind: 'anchor',
      atMs: 40,
      reducedMotion: false,
    });
    const complete = cellIdentityJourneyReducer(anchor, {
      type: 'resolve',
      cellId: 42,
      kind: 'content',
      atMs: 50,
      reducedMotion: false,
    });

    expect(duplicate).toBe(address);
    expect(anchor.binding?.resolvedKinds).toEqual(['address', 'anchor']);
    expect(complete.binding).toMatchObject({
      cellId: 42,
      resolvedKinds: ['address', 'content', 'anchor'],
      phase: 'verified',
      revision: 4,
      changedAtMs: 50,
      lastResolvedKind: 'content',
    });
  });

  it('rejects recall until all three proofs belong to the selected Cell', () => {
    const partial = cellIdentityJourneyReducer(selected(), {
      type: 'resolve',
      cellId: 42,
      kind: 'address',
      atMs: 20,
      reducedMotion: false,
    });
    expect(cellIdentityJourneyReducer(partial, {
      type: 'recall-start',
      cellId: 42,
      requestKey: '18:42:1',
      atMs: 30,
    })).toBe(partial);
    expect(cellIdentityJourneyReducer(partial, {
      type: 'resolve',
      cellId: 7,
      kind: 'content',
      atMs: 30,
      reducedMotion: false,
    })).toBe(partial);
  });

  it('binds recall completion to the exact active trace request', () => {
    let state = selected();
    for (const [index, kind] of (
      ['address', 'content', 'anchor'] as const
    ).entries()) {
      state = cellIdentityJourneyReducer(state, {
        type: 'resolve',
        cellId: 42,
        kind,
        atMs: 20 + index,
        reducedMotion: false,
      });
    }
    const recalling = cellIdentityJourneyReducer(state, {
      type: 'recall-start',
      cellId: 42,
      requestKey: '18:42:1',
      atMs: 40,
    });
    const stale = cellIdentityJourneyReducer(recalling, {
      type: 'recall-retained',
      cellId: 42,
      requestKey: '18:42:0',
      atMs: 50,
    });
    const retained = cellIdentityJourneyReducer(stale, {
      type: 'recall-retained',
      cellId: 42,
      requestKey: '18:42:1',
      atMs: 60,
    });

    expect(recalling.binding?.phase).toBe('recalling');
    expect(stale).toBe(recalling);
    expect(retained.binding?.phase).toBe('retained');
    expect(retained.activeRecallKey).toBeNull();
  });

  it('returns a cancelled replay to its prior verified or retained state', () => {
    let state = selected();
    for (const kind of ['address', 'content', 'anchor'] as const) {
      state = cellIdentityJourneyReducer(state, {
        type: 'resolve',
        cellId: 42,
        kind,
        atMs: 20,
        reducedMotion: true,
      });
    }
    const firstRecall = cellIdentityJourneyReducer(state, {
      type: 'recall-start',
      cellId: 42,
      requestKey: '18:42:1',
      atMs: 30,
    });
    const verified = cellIdentityJourneyReducer(firstRecall, {
      type: 'recall-stop',
      atMs: 40,
    });
    const secondRecall = cellIdentityJourneyReducer(verified, {
      type: 'recall-start',
      cellId: 42,
      requestKey: '18:42:2',
      atMs: 50,
    });
    const retained = cellIdentityJourneyReducer(secondRecall, {
      type: 'recall-retained',
      cellId: 42,
      requestKey: '18:42:2',
      atMs: 60,
    });
    const replay = cellIdentityJourneyReducer(retained, {
      type: 'recall-start',
      cellId: 42,
      requestKey: '18:42:3',
      atMs: 70,
    });
    const returned = cellIdentityJourneyReducer(replay, {
      type: 'recall-stop',
      atMs: 80,
    });

    expect(verified.binding?.phase).toBe('verified');
    expect(returned.binding?.phase).toBe('retained');
    expect(returned.binding?.reducedMotion).toBe(true);
  });

  it('starts a fresh identity when another Cell is inspected', () => {
    const first = cellIdentityJourneyReducer(selected(), {
      type: 'resolve',
      cellId: 42,
      kind: 'address',
      atMs: 20,
      reducedMotion: false,
    });
    const next = cellIdentityJourneyReducer(first, {
      type: 'select',
      cellId: 7,
      atMs: 30,
    });

    expect(next.binding).toMatchObject({
      cellId: 7,
      resolvedKinds: [],
      phase: 'collecting',
    });
    expect(next.revision).toBe(first.revision + 1);
    expect(cellIdentityJourneyReducer(next, {
      type: 'recall-retained',
      cellId: 42,
      requestKey: '18:42:1',
      atMs: 40,
    })).toBe(next);
  });
});
