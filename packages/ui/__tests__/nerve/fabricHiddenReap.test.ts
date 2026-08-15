import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DECAY_MS, type DeathKind } from '../../src/nerve/fabricEdgeRender';
import {
  createHiddenFabricClock,
  drainFabricReapQueue,
  evictDeadFabricEdges,
  fabricEdgeStateCeiling,
  hiddenFabricSimNow,
  startHiddenFabricReaper,
  FABRIC_MAX_DEATH_WINDOW_S,
  HIDDEN_REAP_INTERVAL_MS,
  type FabricReapQueue,
  type FabricReapTargets,
  type ReapableEdge,
} from '../../src/nerve/fabricHiddenReap';

interface TestEdge extends ReapableEdge {
  born: number;
}

interface Harness {
  targets: FabricReapTargets<TestEdge>;
  reaped: string[];
  /** Register an edge with a slot + warm-route membership, as ingest would. */
  add(key: string, edge: TestEdge): void;
}

function harness(): Harness {
  const reaped: string[] = [];
  let nextSlot = 0;
  const targets: FabricReapTargets<TestEdge> = {
    states: new Map<string, TestEdge>(),
    slots: new Map<string, number>(),
    freeSlots: [],
    warmKeys: new Set<string>(),
    onReap: (key) => { reaped.push(key); },
  };
  return {
    targets,
    reaped,
    add(key, edge) {
      targets.states.set(key, edge);
      targets.slots.set(key, nextSlot);
      nextSlot += 1;
      targets.warmKeys.add(key);
    },
  };
}

function alive(born = 0): TestEdge {
  return { born, dyingAt: null, deathKind: null };
}

function dying(dyingAt: number, deathKind: DeathKind = 'gc'): TestEdge {
  return { born: dyingAt - 10, dyingAt, deathKind };
}

function queueOf(entries: { key: string; endSec: number }[]): FabricReapQueue {
  return { entries, head: 0 };
}

describe('fabricEdgeStateCeiling', () => {
  it('leaves one generation of margin over the mounted slot capacity', () => {
    // Default class: 8,000 edges × 3 coexisting generations of slots.
    expect(fabricEdgeStateCeiling(24_000)).toBe(32_000);
    // Ceiling class: 20,000 × 3.
    expect(fabricEdgeStateCeiling(60_000)).toBe(80_000);
  });

  it('never returns a ceiling a real mount could sit above from the start', () => {
    expect(fabricEdgeStateCeiling(0)).toBeGreaterThan(0);
    expect(fabricEdgeStateCeiling(Number.NaN)).toBeGreaterThan(0);
    expect(fabricEdgeStateCeiling(24_000)).toBeGreaterThan(24_000);
  });
});

describe('hidden wall-clock bridge', () => {
  it('holds the frozen sim second while the frame loop owns time', () => {
    const clock = createHiddenFabricClock();
    clock.frozenSimSec = 120;
    expect(hiddenFabricSimNow(clock, 9_999_999)).toBe(120);
  });

  it('advances eligibility by exactly the wall seconds spent hidden', () => {
    const clock = createHiddenFabricClock();
    clock.frozenSimSec = 120;
    clock.hiddenSinceMs = 1_000;
    expect(hiddenFabricSimNow(clock, 1_000)).toBe(120);
    expect(hiddenFabricSimNow(clock, 2_500)).toBeCloseTo(121.5, 9);
    expect(hiddenFabricSimNow(clock, 3_601_000)).toBeCloseTo(3720, 9);
  });

  it('never runs backwards when the wall clock does', () => {
    const clock = createHiddenFabricClock();
    clock.frozenSimSec = 120;
    clock.hiddenSinceMs = 5_000;
    expect(hiddenFabricSimNow(clock, 4_000)).toBe(120);
  });

  it('pins the death horizon to the longest lifecycle window', () => {
    expect(FABRIC_MAX_DEATH_WINDOW_S).toBe(DECAY_MS / 1000);
  });
});

describe('drainFabricReapQueue', () => {
  it('retires expired edges and returns their slot to the recycle list', () => {
    const h = harness();
    h.add('a', dying(10));
    h.add('b', dying(10));
    h.add('c', alive());
    const queue = queueOf([
      { key: 'a', endSec: 11.5 },
      { key: 'b', endSec: 11.5 },
    ]);

    const consumed = drainFabricReapQueue(queue, h.targets, 12);

    expect(consumed).toBe(2);
    expect([...h.targets.states.keys()]).toEqual(['c']);
    expect(h.targets.freeSlots).toEqual([0, 1]);
    expect(h.targets.slots.has('a')).toBe(false);
    expect(h.targets.warmKeys.has('b')).toBe(false);
    expect(h.reaped).toEqual(['a', 'b']);
  });

  it('leaves an edge whose window has not closed yet', () => {
    const h = harness();
    h.add('a', dying(10));
    const queue = queueOf([{ key: 'a', endSec: 11.5 }]);

    expect(drainFabricReapQueue(queue, h.targets, 11.4)).toBe(0);
    expect(h.targets.states.has('a')).toBe(true);
    expect(queue.head).toBe(0);
  });

  it('drops a stale entry for a revived edge without reaping it', () => {
    const h = harness();
    const revived = dying(10);
    h.add('a', revived);
    const queue = queueOf([{ key: 'a', endSec: 11.5 }]);
    revived.dyingAt = null;
    revived.deathKind = null;

    expect(drainFabricReapQueue(queue, h.targets, 12)).toBe(1);
    expect(h.targets.states.has('a')).toBe(true);
    expect(h.reaped).toEqual([]);
  });

  it('bounds one pass to its budget and keeps the rest queued', () => {
    const h = harness();
    const entries: { key: string; endSec: number }[] = [];
    for (let i = 0; i < 10; i += 1) {
      const key = `e${i}`;
      h.add(key, dying(10));
      entries.push({ key, endSec: 11.5 });
    }
    const queue = queueOf(entries);

    expect(drainFabricReapQueue(queue, h.targets, 12, 4)).toBe(4);
    expect(h.targets.states.size).toBe(6);
    expect(drainFabricReapQueue(queue, h.targets, 12, 4)).toBe(4);
    expect(h.targets.states.size).toBe(2);
    // Under budget ⇒ the backlog is cleared, which is how the foreground
    // catch-up knows it can stop.
    expect(drainFabricReapQueue(queue, h.targets, 12, 4)).toBe(2);
    expect(h.targets.states.size).toBe(0);
  });

  it('retires a frozen-clock backlog only once the bridge advances', () => {
    // Every kill taken while hidden carries the SAME dyingAt, so the frozen
    // second retires none of them and the bridged second retires all.
    const clock = createHiddenFabricClock();
    clock.frozenSimSec = 300;
    clock.hiddenSinceMs = 0;
    const h = harness();
    const entries: { key: string; endSec: number }[] = [];
    for (let i = 0; i < 500; i += 1) {
      const key = `k${i}`;
      h.add(key, dying(300));
      entries.push({ key, endSec: 301.5 });
    }
    const queue = queueOf(entries);

    expect(drainFabricReapQueue(queue, h.targets, clock.frozenSimSec)).toBe(0);
    expect(h.targets.states.size).toBe(500);

    const bridged = hiddenFabricSimNow(clock, HIDDEN_REAP_INTERVAL_MS);
    expect(drainFabricReapQueue(queue, h.targets, bridged)).toBe(500);
    expect(h.targets.states.size).toBe(0);
  });
});

describe('evictDeadFabricEdges', () => {
  it('does nothing below the ceiling', () => {
    const h = harness();
    h.add('a', dying(10));
    h.add('b', alive());

    expect(evictDeadFabricEdges(h.targets, 100, 8)).toBe(0);
    expect(h.targets.states.size).toBe(2);
  });

  it('drops the oldest fully-dead states and keeps every living one', () => {
    const h = harness();
    // Insertion order is birth order: dead entries scattered through it.
    h.add('dead-oldest', dying(10));
    h.add('live-1', alive(11));
    h.add('dead-mid', dying(12));
    h.add('live-2', alive(13));
    h.add('dead-newest', dying(14));
    h.add('live-3', alive(15));

    const evicted = evictDeadFabricEdges(h.targets, 100, 4);

    expect(evicted).toBe(2);
    expect([...h.targets.states.keys()]).toEqual([
      'live-1', 'live-2', 'dead-newest', 'live-3',
    ]);
    expect(h.reaped).toEqual(['dead-oldest', 'dead-mid']);
    expect(h.targets.freeSlots).toEqual([0, 2]);
  });

  it('never evicts a living or still-fading edge, even over the ceiling', () => {
    const h = harness();
    h.add('live', alive());
    h.add('fading', dying(99));   // window closes at 100.5
    h.add('also-live', alive());

    expect(evictDeadFabricEdges(h.targets, 100, 1)).toBe(0);
    expect(h.targets.states.size).toBe(3);
    expect(h.reaped).toEqual([]);
  });
});

describe('startHiddenFabricReaper', () => {
  let visibility: DocumentVisibilityState = 'visible';

  function setVisibility(next: DocumentVisibilityState): void {
    visibility = next;
    document.dispatchEvent(new Event('visibilitychange'));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drains on wall time while hidden and hands the backlog back on return', () => {
    let wall = 1_000;
    const reaps: number[] = [];
    const resumes: number[] = [];
    const reaper = startHiddenFabricReaper({
      wallNowMs: () => wall,
      simNowSec: () => 300,
      reap: (sec) => { reaps.push(sec); },
      resume: (sec) => { resumes.push(sec); },
    });

    // Visible: the frame loop owns reaping, the interval is a no-op.
    expect(reaper.framelessSimNow()).toBeNull();
    wall += HIDDEN_REAP_INTERVAL_MS;
    vi.advanceTimersByTime(HIDDEN_REAP_INTERVAL_MS);
    expect(reaps).toEqual([]);

    setVisibility('hidden');
    expect(reaper.framelessSimNow()).toBe(300);
    wall += HIDDEN_REAP_INTERVAL_MS;
    vi.advanceTimersByTime(HIDDEN_REAP_INTERVAL_MS);
    wall += HIDDEN_REAP_INTERVAL_MS;
    vi.advanceTimersByTime(HIDDEN_REAP_INTERVAL_MS);
    // Eligibility advanced with the wall clock, not with the tick count.
    expect(reaps).toEqual([330, 360]);
    expect(reaper.framelessSimNow()).toBe(360);

    setVisibility('visible');
    // Clamped to one death window past the freeze: everything the hidden
    // stretch stamped is retired, a kill stamped after it is not.
    expect(resumes).toEqual([300 + FABRIC_MAX_DEATH_WINDOW_S]);
    expect(reaper.framelessSimNow()).toBeNull();
    wall += HIDDEN_REAP_INTERVAL_MS;
    vi.advanceTimersByTime(HIDDEN_REAP_INTERVAL_MS);
    expect(reaps).toEqual([330, 360]);
    reaper.stop();
  });

  it('hands back the real elapsed second when the hidden stretch was short', () => {
    let wall = 0;
    const resumes: number[] = [];
    const reaper = startHiddenFabricReaper({
      wallNowMs: () => wall,
      simNowSec: () => 50,
      reap: () => {},
      resume: (sec) => { resumes.push(sec); },
    });
    setVisibility('hidden');
    wall += 400;
    setVisibility('visible');
    expect(resumes).toEqual([50.4]);
    reaper.stop();
  });

  it('anchors a tab that mounted straight into the background', () => {
    visibility = 'hidden';
    let wall = 2_000;
    const reaps: number[] = [];
    const reaper = startHiddenFabricReaper({
      wallNowMs: () => wall,
      simNowSec: () => 12,
      reap: (sec) => { reaps.push(sec); },
      resume: () => {},
    });

    expect(reaper.framelessSimNow()).toBe(12);
    wall += 60_000;
    vi.advanceTimersByTime(HIDDEN_REAP_INTERVAL_MS * 2);
    expect(reaps.at(-1)).toBe(72);
    reaper.stop();
  });

  it('stops listening and stops ticking after teardown', () => {
    let wall = 0;
    const reaps: number[] = [];
    const resumes: number[] = [];
    const reaper = startHiddenFabricReaper({
      wallNowMs: () => wall,
      simNowSec: () => 0,
      reap: (sec) => { reaps.push(sec); },
      resume: (sec) => { resumes.push(sec); },
    });
    setVisibility('hidden');
    reaper.stop();

    wall += HIDDEN_REAP_INTERVAL_MS;
    vi.advanceTimersByTime(HIDDEN_REAP_INTERVAL_MS * 4);
    setVisibility('visible');
    expect(reaps).toEqual([]);
    expect(resumes).toEqual([]);
  });

  it('drains the queues and prunes the states a hidden stretch piled up', () => {
    // End to end over the real containers: ingest keeps stamping kills with
    // the frozen clock, the interval retires them without a frame.
    const h = harness();
    const queue = queueOf([]);
    let wall = 0;
    const reaper = startHiddenFabricReaper({
      wallNowMs: () => wall,
      simNowSec: () => 200,
      reap: (sec) => {
        drainFabricReapQueue(queue, h.targets, sec);
        evictDeadFabricEdges(h.targets, sec, 4);
      },
      resume: () => {},
    });
    setVisibility('hidden');
    for (let i = 0; i < 2_000; i += 1) {
      const key = `k${i}`;
      h.add(key, dying(200));
      queue.entries.push({ key, endSec: 201.5 });
    }
    expect(h.targets.states.size).toBe(2_000);

    wall += HIDDEN_REAP_INTERVAL_MS;
    vi.advanceTimersByTime(HIDDEN_REAP_INTERVAL_MS);

    expect(h.targets.states.size).toBe(0);
    expect(queue.head).toBe(0);          // compacted, not just advanced
    expect(queue.entries.length).toBe(0);
    expect(h.targets.freeSlots.length).toBe(2_000);
    reaper.stop();
  });
});
