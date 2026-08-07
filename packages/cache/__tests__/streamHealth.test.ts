import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createStreamHealthTracker,
  type StreamHealth,
} from '../src/streamHealth';

afterEach(() => {
  vi.useRealTimers();
});

describe('createStreamHealthTracker', () => {
  it('publishes connection, live, retry, and recovered lifecycle states', () => {
    const states: StreamHealth[] = [];
    let now = 1_000;
    const tracker = createStreamHealthTracker({
      now: () => now,
      onHealth: (health) => states.push(health),
    }, () => {});

    tracker.startAttempt();
    tracker.opened();
    now = 1_050;
    tracker.message();
    tracker.closed();
    tracker.startAttempt();
    tracker.opened();
    now = 1_075;
    tracker.message();

    expect(states.map((state) => state.phase)).toEqual([
      'connecting',
      'connecting',
      'connecting',
      'live',
      'retrying',
      'retrying',
      'retrying',
      'live',
    ]);
    expect(states[3].lastMessageAtMs).toBe(1_050);
    expect(states[4].reason).toBe('closed');
    expect(states.at(-1)?.attempt).toBe(0);
  });

  it('marks heartbeat silence stale once and recovers on a reopened socket', () => {
    vi.useFakeTimers();
    const states: StreamHealth[] = [];
    const onStale = vi.fn();
    let now = 2_000;
    const tracker = createStreamHealthTracker({
      staleAfterMs: 100,
      now: () => now,
      onHealth: (health) => states.push(health),
    }, onStale);

    tracker.startAttempt();
    tracker.opened();
    tracker.message();
    now = 2_101;
    vi.advanceTimersByTime(101);

    expect(states.at(-1)).toMatchObject({
      phase: 'stale',
      reason: 'heartbeat_timeout',
      lastMessageAtMs: 2_000,
    });
    expect(onStale).toHaveBeenCalledTimes(1);

    // Closing a socket because the watchdog fired must not recursively arm a
    // zero-delay stale timer.
    tracker.closed();
    vi.runOnlyPendingTimers();
    expect(onStale).toHaveBeenCalledTimes(1);

    tracker.startAttempt();
    tracker.opened();
    expect(states.at(-1)?.phase).toBe('stale');
    tracker.message();
    expect(states.at(-1)?.phase).toBe('live');
  });

  it('keeps lag recovery distinct from ordinary retry until a data frame lands', () => {
    const states: StreamHealth[] = [];
    const tracker = createStreamHealthTracker({
      onHealth: (health) => states.push(health),
    }, () => {});

    tracker.startAttempt();
    tracker.opened();
    tracker.resyncing();
    tracker.closed(true);
    tracker.startAttempt(true);
    tracker.opened(true);
    tracker.message();

    expect(states.slice(-5).map((state) => state.phase)).toEqual([
      'resyncing',
      'resyncing',
      'resyncing',
      'resyncing',
      'live',
    ]);
    expect(states.at(-2)?.reason).toBe('lagged');
  });
});

describe('freshness publish throttling', () => {
  it('publishes same-phase freshness at most once per second, transitions immediately', () => {
    const states: StreamHealth[] = [];
    let now = 1_000;
    const tracker = createStreamHealthTracker({
      now: () => now,
      onHealth: (health) => states.push(health),
    }, () => {});

    tracker.startAttempt();
    tracker.opened();
    tracker.message(); // connecting → live: publishes
    const livePublishes = () => states.filter((s) => s.phase === 'live');
    expect(livePublishes()).toHaveLength(1);

    now = 1_200;
    tracker.message(); // same-phase freshness within 1s: suppressed
    now = 1_400;
    tracker.message(); // still suppressed
    expect(livePublishes()).toHaveLength(1);

    now = 2_100;
    tracker.message(); // ≥1s since last publish: freshness republished
    expect(livePublishes()).toHaveLength(2);
    expect(livePublishes().at(-1)?.lastMessageAtMs).toBe(2_100);

    now = 2_150;
    tracker.closed(); // lifecycle transition publishes immediately
    expect(states.at(-1)?.phase).toBe('retrying');
  });
});
