// The node channel's poll, under a clock this file owns.
//
// What is pinned here is the failure the endpoint EXISTS for and could not
// survive: a server that accepts the connection and never answers it. Without
// a deadline that request is the browser's to time out, on the browser's own
// schedule — minutes — and for the whole of it the poll publishes nothing, the
// next poll is never scheduled, and the node channel keeps showing the last
// reading it took while the server was well. So the tests below are about the
// three ways one request can end: abandoned, answered, and dropped by the
// caller.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { connectNodeHealth } from '../src/connect';

const HEALTH_URL = '/api/health';

/** A poll cadence whose deadline is the doubling rather than the floor, so
 *  the arithmetic under test is visible in the numbers below. */
const POLL_MS = 3_000;
const TIMEOUT_MS = POLL_MS * 2;

/** A body the derive reads as a live node — every adapter alive, no
 *  quarantine, a tip that moved a moment ago. */
const LIVE_BODY = {
  degraded: false,
  adapters: [{ name: 'ckb', alive: true }],
  tip_age_ms: 1_200,
  quarantined_projections: [],
};

/** A `fetch` that never answers and only ever ends by abort — the server this
 *  poll was written for. Resolves nothing, rejects the way the platform does
 *  when the signal fires. */
function hangingFetch(): {
  fetch: ReturnType<typeof vi.fn>;
  signals: AbortSignal[];
} {
  const signals: AbortSignal[] = [];
  const fetch = vi.fn((_url: string, init?: RequestInit) => {
    const signal = init?.signal;
    if (!signal) throw new Error('the poll sent no signal');
    signals.push(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    });
  });
  return { fetch, signals };
}

function servedFetch(body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('connectNodeHealth', () => {
  it('abandons a request the server never answers, and polls again', async () => {
    const { fetch, signals } = hangingFetch();
    vi.stubGlobal('fetch', fetch);
    const onHealth = vi.fn();

    const channel = connectNodeHealth(onHealth, { pollMs: POLL_MS });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    // Still inside the deadline: the poll is waiting, not failing.
    expect(onHealth).not.toHaveBeenCalled();
    expect(signals[0].aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    // `null` is this channel's own word for "I have nothing to say"; the
    // sockets own the story about an unreachable server.
    expect(onHealth).toHaveBeenCalledOnce();
    expect(onHealth).toHaveBeenCalledWith(null);
    expect(signals[0].aborted).toBe(true);

    // And the cadence survives the abandonment — the channel that gave up on
    // one request has to be the one that notices the server come back.
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
    channel.disconnect();
  });

  it('leaves an answered request alone', async () => {
    const fetch = servedFetch(LIVE_BODY);
    vi.stubGlobal('fetch', fetch);
    const onHealth = vi.fn();

    const channel = connectNodeHealth(onHealth, {
      pollMs: POLL_MS,
      now: () => 10_000,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onHealth).toHaveBeenCalledTimes(1);
    expect(onHealth.mock.calls[0][0]).toMatchObject({ phase: 'live', fault: null });

    // The deadline that would have fired for the answer already given is
    // cleared: waiting past it publishes nothing, and the only further call
    // is the next poll's own.
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(onHealth.mock.calls.every((call) => call[0] !== null)).toBe(true);
    channel.disconnect();
  });

  it('drops the request already on the wire when the caller disconnects', async () => {
    const { fetch, signals } = hangingFetch();
    vi.stubGlobal('fetch', fetch);
    const onHealth = vi.fn();

    const channel = connectNodeHealth(onHealth, { pollMs: POLL_MS });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    channel.disconnect();
    expect(signals[0].aborted).toBe(true);

    // A disconnected channel says nothing on the way out — the abort is not a
    // reading — and never polls again.
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + POLL_MS * 4);
    expect(onHealth).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
