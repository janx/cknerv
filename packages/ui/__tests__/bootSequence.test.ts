import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginBootPhase,
  beginBootRequest,
  completeBootPhase,
  completeBootRequest,
  completeBootSeeding,
  failBootPhase,
  getBootSequence,
  reportBootRequestProgress,
  reportBootRequestResponse,
  reportBootSeeding,
  resetBootSequenceForTest,
  subscribeBootSequence,
  useBootSequence,
  type BootPhaseId,
  type BootPhaseSnapshot,
} from '../src/boot/bootSequence';

/** Read before any test body runs: the state the module publishes on
 * evaluation, which is what the pre-React shell reads. */
const AT_MODULE_LOAD = getBootSequence();

const FIXED_PHASES: Exclude<BootPhaseId, 'seeding'>[] = [
  'instrument',
  'snapshot',
  'decode',
  'gl',
  'first_light',
  'fabric',
  'data_plane',
];

const watchers: (() => void)[] = [];

afterEach(() => {
  cleanup();
  for (const unsubscribe of watchers.splice(0)) unsubscribe();
  resetBootSequenceForTest();
});

/** A subscriber that is dropped with the test, so a leftover listener cannot
 * outlive the store state it was watching. */
function watch(): ReturnType<typeof vi.fn> {
  const listener = vi.fn();
  watchers.push(subscribeBootSequence(listener));
  return listener;
}

function phase(id: BootPhaseId): BootPhaseSnapshot | undefined {
  return getBootSequence().phases.find((entry) => entry.id === id);
}

function finishEveryFixedPhase(): void {
  for (const id of FIXED_PHASES) completeBootPhase(id);
}

describe('boot sequence — initial state', () => {
  it('publishes the instrument line already running on module load', () => {
    // Evaluating the module is itself the proof that the bundle arrived.
    expect(AT_MODULE_LOAD.phases.map((entry) => entry.id)).toEqual(FIXED_PHASES);
    expect(AT_MODULE_LOAD.phases.map((entry) => entry.state)).toEqual([
      'active', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending',
    ]);
    expect(AT_MODULE_LOAD.active).toBe(true);
    expect(AT_MODULE_LOAD.complete).toBe(false);
    expect(AT_MODULE_LOAD.phases.some((entry) => entry.id === 'seeding')).toBe(false);
  });

  it('carries no progress fields until a writer reports one', () => {
    expect(phase('snapshot')).toEqual({ id: 'snapshot', state: 'pending' });
  });

  it('rewinds to that same shape for a second mount', () => {
    completeBootPhase('instrument');
    reportBootSeeding(4, 90);
    resetBootSequenceForTest();
    expect(getBootSequence()).toEqual(AT_MODULE_LOAD);
  });
});

describe('boot sequence — phase transitions', () => {
  it('runs the phases as independent machines, not a pipeline', () => {
    // Display order is display order. Real boots overlap: fabric can start
    // before the snapshot line has anything to say.
    beginBootPhase('fabric');
    completeBootPhase('data_plane');
    expect(phase('fabric')?.state).toBe('active');
    expect(phase('data_plane')?.state).toBe('done');
    expect(phase('snapshot')?.state).toBe('pending');
    expect(phase('instrument')?.state).toBe('active');
  });

  it('lets a single observed event finish a phase that never started', () => {
    // `fabric` and `data_plane` have no natural begin — one commit, done.
    completeBootPhase('fabric');
    expect(phase('fabric')?.state).toBe('done');
  });

  it('holds done terminal against any later write', () => {
    completeBootPhase('gl');
    beginBootPhase('gl');
    failBootPhase('gl', 'context lost');
    expect(phase('gl')).toEqual({ id: 'gl', state: 'done' });
  });

  it('holds failed terminal and keeps the first reason', () => {
    // A cascade of follow-up faults must not overwrite the root cause the
    // banner is showing.
    failBootPhase('gl', 'webgl2 unavailable');
    failBootPhase('gl', 'context lost');
    completeBootPhase('gl');
    beginBootPhase('gl');
    expect(phase('gl')).toEqual({
      id: 'gl',
      state: 'failed',
      detail: 'webgl2 unavailable',
    });
  });

  it('absorbs StrictMode double invocation without notifying twice', () => {
    const listener = watch();

    beginBootPhase('decode');
    beginBootPhase('decode');
    expect(listener).toHaveBeenCalledTimes(1);

    completeBootPhase('decode');
    completeBootPhase('decode');
    expect(listener).toHaveBeenCalledTimes(2);

    const settled = getBootSequence();
    beginBootPhase('decode');
    expect(getBootSequence()).toBe(settled);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('boot sequence — completion', () => {
  it('completes once every fixed phase is done', () => {
    finishEveryFixedPhase();
    expect(getBootSequence().complete).toBe(true);
    expect(getBootSequence().active).toBe(false);
  });

  it('never completes after a fault, so the banner keeps carrying it', () => {
    for (const id of FIXED_PHASES) {
      if (id === 'first_light') failBootPhase(id, 'no steady frames');
      else completeBootPhase(id);
    }
    expect(getBootSequence().complete).toBe(false);
    expect(getBootSequence().active).toBe(true);
    expect(phase('first_light')?.detail).toBe('no steady frames');
  });

  it('goes inert on completion — every writer becomes a no-op', () => {
    // Mid-session reconnects and replays stay the existing banners' job.
    finishEveryFixedPhase();
    const completed = getBootSequence();
    const listener = watch();

    beginBootPhase('snapshot');
    failBootPhase('gl', 'context lost');
    beginBootRequest('cells', 'cells-binary', 1);
    reportBootSeeding(3, 40);
    completeBootSeeding();

    expect(getBootSequence()).toBe(completed);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('boot sequence — observed snapshot requests', () => {
  it('records exact byte progress on the current attempt', () => {
    const attempt = beginBootRequest('cells', 'cells-binary', 1);
    reportBootRequestResponse('cells', attempt, 2, 4_600_000);
    reportBootRequestProgress('cells', attempt, 3, 1_048_576);
    expect(getBootSequence().requests?.at(-1)).toMatchObject({
      kind: 'cells',
      attempt,
      state: 'reading',
      receivedBytes: 1_048_576,
      totalBytes: 4_600_000,
    });
  });

  it('keeps a length-less response indeterminate instead of inventing one', () => {
    const attempt = beginBootRequest('cells', 'cells-json', 1);
    reportBootRequestResponse('cells', attempt, 2, null);
    reportBootRequestProgress('cells', attempt, 3, 2_048);
    expect(getBootSequence().requests?.at(-1)?.totalBytes).toBeNull();
    // A denominator that cannot be divided by is indeterminate too.
    reportBootRequestResponse('cells', attempt, 4, Number.NaN);
    reportBootRequestProgress('cells', attempt, 5, 4_096);
    expect(getBootSequence().requests?.at(-1)?.totalBytes).toBeNull();
    expect(getBootSequence().requests?.at(-1)?.receivedBytes).toBe(4_096);
  });

  it('gives a fallback its own zero-based count and ignores invalid readings', () => {
    const binary = beginBootRequest('cells', 'cells-binary', 1);
    reportBootRequestProgress('cells', binary, 2, 900_000);
    const json = beginBootRequest('cells', 'cells-json', 3);
    reportBootRequestProgress('cells', json, 4, Number.NaN);
    expect(getBootSequence().requests?.at(-1)?.receivedBytes).toBe(0);
    reportBootRequestProgress('cells', json, 5, 100_000);
    expect(getBootSequence().requests?.at(-1)?.receivedBytes).toBe(100_000);
  });

  it('ignores progress once an attempt is terminal', () => {
    const attempt = beginBootRequest('cells', 'cells-binary', 1);
    completeBootRequest('cells', attempt, 2);
    const done = getBootSequence().requests?.at(-1);
    reportBootRequestProgress('cells', attempt, 3, 1_024);
    expect(getBootSequence().requests?.at(-1)).toBe(done);
  });
});

describe('boot sequence — server seeding line', () => {
  it('appears only once the replay reports, and appears last', () => {
    expect(phase('seeding')).toBeUndefined();
    reportBootSeeding(12, 480);
    expect(getBootSequence().phases.at(-1)).toEqual({
      id: 'seeding',
      state: 'active',
      seedingDone: 12,
      seedingTotal: 480,
    });
    expect(getBootSequence().phases).toHaveLength(FIXED_PHASES.length + 1);
  });

  it('mirrors later server counts without re-notifying on a repeat', () => {
    const listener = watch();

    reportBootSeeding(12, 480);
    reportBootSeeding(240, 480);
    expect(listener).toHaveBeenCalledTimes(2);

    const mirrored = getBootSequence();
    reportBootSeeding(240, 480);
    expect(getBootSequence()).toBe(mirrored);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('finishes terminal, like every other line', () => {
    reportBootSeeding(240, 480);
    completeBootSeeding();
    expect(phase('seeding')?.state).toBe('done');
    reportBootSeeding(300, 480);
    expect(phase('seeding')).toEqual({
      id: 'seeding',
      state: 'done',
      seedingDone: 240,
      seedingTotal: 480,
    });
  });

  it('does nothing when the replay never reported', () => {
    const listener = watch();
    completeBootSeeding();
    expect(phase('seeding')).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it('blocks completion until the replay is done', () => {
    reportBootSeeding(12, 480);
    finishEveryFixedPhase();
    expect(getBootSequence().complete).toBe(false);
    completeBootSeeding();
    expect(getBootSequence().complete).toBe(true);
  });
});

describe('boot sequence — store contract', () => {
  it('replaces the snapshot immutably and leaves untouched lines alone', () => {
    const before = getBootSequence();
    const untouched = phase('fabric');

    completeBootPhase('instrument');

    const after = getBootSequence();
    expect(after).not.toBe(before);
    expect(after.phases).not.toBe(before.phases);
    expect(before.phases[0].state).toBe('active');
    expect(phase('fabric')).toBe(untouched);
  });

  it('stops delivering after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBootSequence(listener);
    completeBootPhase('instrument');
    unsubscribe();
    completeBootPhase('decode');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('feeds the hook through useSyncExternalStore', () => {
    const view = renderHook(() => useBootSequence());
    expect(view.result.current).toEqual(AT_MODULE_LOAD);

    let attempt = 0;
    act(() => {
      attempt = beginBootRequest('cells', 'cells-binary', 1);
      reportBootRequestResponse('cells', attempt, 2, 4_096);
      reportBootRequestProgress('cells', attempt, 3, 512);
    });
    expect(view.result.current.requests?.at(-1)).toMatchObject({
      kind: 'cells',
      state: 'reading',
      receivedBytes: 512,
      totalBytes: 4_096,
    });

    act(() => { finishEveryFixedPhase(); });
    expect(view.result.current.complete).toBe(true);
  });
});
