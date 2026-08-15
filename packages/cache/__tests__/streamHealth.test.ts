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

    // `opened` lands in the phase `startAttempt` already announced, so it adds
    // no publish of its own.
    expect(states.map((state) => state.phase)).toEqual([
      'connecting',
      'connecting',
      'live',
      'retrying',
      'retrying',
      'live',
    ]);
    expect(states[2].lastMessageAtMs).toBe(1_050);
    expect(states[3].reason).toBe('closed');
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

    expect(states.slice(-4).map((state) => state.phase)).toEqual([
      'resyncing',
      'resyncing',
      'resyncing',
      'live',
    ]);
    expect(states.at(-2)?.reason).toBe('lagged');
  });
});

describe('freshness stays off the publish channel', () => {
  it('publishes nothing for a frame that only advances the stamp', () => {
    const states: StreamHealth[] = [];
    let now = 1_000;
    const tracker = createStreamHealthTracker({
      now: () => now,
      onHealth: (health) => states.push(health),
    }, () => {});

    tracker.startAttempt();
    tracker.opened();
    tracker.message(); // connecting → live: a lifecycle change, publishes
    const publishCount = states.length;
    expect(states.at(-1)).toMatchObject({ phase: 'live', lastMessageAtMs: 1_000 });

    for (let i = 1; i <= 20; i += 1) {
      now = 1_000 + i * 250;
      tracker.message();
    }
    expect(states).toHaveLength(publishCount);

    now = 7_000;
    tracker.closed(); // a real transition publishes, carrying the newest stamp
    expect(states.at(-1)).toMatchObject({
      phase: 'retrying',
      reason: 'closed',
      lastMessageAtMs: 6_000,
    });
  });

  it('publishes each lifecycle transition exactly once', () => {
    const states: StreamHealth[] = [];
    let now = 5_000;
    const tracker = createStreamHealthTracker({
      now: () => now,
      onHealth: (health) => states.push(health),
    }, () => {});

    tracker.startAttempt();
    tracker.opened();
    states.length = 0; // the connect preamble is covered above
    tracker.message(); // → live
    now = 5_100;
    tracker.message();
    now = 5_200;
    tracker.message();
    tracker.resyncing(); // live → resyncing
    now = 5_300;
    tracker.message(true); // still resyncing: no transition
    now = 5_400;
    tracker.message(); // resyncing → live

    expect(states.map((state) => state.phase)).toEqual([
      'live',
      'resyncing',
      'live',
    ]);
  });

  it('measures the stale watchdog from frames that were never published', () => {
    vi.useFakeTimers();
    const states: StreamHealth[] = [];
    const onStale = vi.fn();
    let now = 1_000;
    const tracker = createStreamHealthTracker({
      staleAfterMs: 1_000,
      now: () => now,
      onHealth: (health) => states.push(health),
    }, onStale);

    tracker.startAttempt();
    tracker.opened();
    tracker.message();

    // Four suppressed frames spanning well past staleAfterMs: silence is
    // measured from the internal stamp, not from the last publish.
    for (let i = 1; i <= 4; i += 1) {
      now = 1_000 + i * 400;
      vi.advanceTimersByTime(400);
      tracker.message();
    }
    expect(states.filter((state) => state.phase === 'live')).toHaveLength(1);
    expect(onStale).not.toHaveBeenCalled();

    now = 3_600;
    vi.advanceTimersByTime(1_000);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toMatchObject({
      phase: 'stale',
      reason: 'heartbeat_timeout',
      lastMessageAtMs: 2_600,
    });
  });
});
