// hudClock — the HUD's one wall clock, as a store with leaf subscribers.
//
// The overlay used to hold `Date.now()` as state at its root and tick it once
// a second, which re-rendered every panel it owns — some sixty components and
// three hundred host elements — for the handful of spans that print a time:
// the uptime in the status strip, the DAO record's freshness line, the stream
// banner's silence, and the ages on the floating cards, each of which ran a
// 1 Hz interval of its own on top. The tick lives out here instead: one
// interval for the whole page, published to whoever asked for the exact slice
// they read. A span that prints `UP 00:12:07` re-renders once a second; the
// panel around it renders when its DATA changes, never because a clock moved.
//
// The same pattern as `cellScanClock` — a plain store and a
// `useSyncExternalStore` subscription — at module scope because there is one
// wall clock, and selector-shaped so a reader that derives a string or a
// boolean sleeps through every tick that says the same thing.
import { useSyncExternalStore } from 'react';
import { formatAge } from './cellFormat';

/** The tick every HUD age, uptime and freshness line advances on. */
export const HUD_CLOCK_TICK_MS = 1_000;

const listeners = new Set<() => void>();
let nowMs = 0;
let timer: ReturnType<typeof setInterval> | null = null;
/** The `setInterval` / `clearInterval` pair the running timer was armed with.
 *  A test runner swaps the globals for fakes between tests; a timer armed
 *  under one implementation can be neither advanced nor cleared by the
 *  other, so a subscribe that finds the global changed re-arms rather than
 *  trusting a handle nothing can reach any more. */
let armedSetInterval: typeof setInterval | null = null;
let armedClearInterval: typeof clearInterval | null = null;

function sample(): number {
  nowMs = Date.now();
  return nowMs;
}

function tick(): void {
  sample();
  listeners.forEach((listener) => listener());
}

function disarm(): void {
  if (timer === null) return;
  (armedClearInterval ?? clearInterval)(timer);
  timer = null;
  armedSetInterval = null;
  armedClearInterval = null;
}

function arm(): void {
  if (typeof setInterval !== 'function') return; // test-safe
  timer = setInterval(tick, HUD_CLOCK_TICK_MS);
  armedSetInterval = setInterval;
  armedClearInterval = clearInterval;
}

/** The clock as of the last tick — refreshed on read once more than a tick
 *  has passed, so a reader arriving between ticks (or before anyone armed the
 *  interval) never prints a stale second, while consecutive reads inside one
 *  render still agree. Never a raw `Date.now()`: a snapshot that moved between
 *  two reads of the same render is what React calls tearing. */
export function readHudClockMs(): number {
  if (nowMs === 0 || Date.now() - nowMs >= HUD_CLOCK_TICK_MS) sample();
  return nowMs;
}

/** One interval for every subscriber; it stops when the last one leaves. */
export function subscribeHudClock(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null || armedSetInterval !== setInterval) {
    disarm();
    sample();
    arm();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) disarm();
  };
}

/** How many leaves are listening — a test's oracle for "one interval, shared". */
export function hudClockSubscriberCount(): number {
  return listeners.size;
}

/** Test-only: forget every subscriber and stop the interval. */
export function resetHudClockForTest(): void {
  listeners.clear();
  disarm();
  nowMs = 0;
}

/** Subscribe to one SLICE of the clock. The selector's value decides the
 *  re-render, so a leaf that selects a formatted string wakes when the
 *  string changes and a leaf that selects a boolean wakes on the flip. Select
 *  a primitive: an object built per read would read as a change on every
 *  render, which React rejects as an uncached snapshot. */
export function useHudClockSelector<T>(select: (nowMs: number) => T): T {
  const read = () => select(readHudClockMs());
  return useSyncExternalStore(subscribeHudClock, read, read);
}

function identity(value: number): number {
  return value;
}

/** The raw tick, for a leaf that formats its own reading. */
export function useHudClockMs(): number {
  return useHudClockSelector(identity);
}

/** The clock a host handed down, or the shared one. Cards and plates take an
 *  optional `nowMs` for labs and deterministic tests; passing it selects a
 *  constant, so the leaf never wakes for a tick it will not print. */
export function useHudNowMs(nowMs?: number): number {
  return useHudClockSelector((clock) => nowMs ?? clock);
}

/** `formatAge` as a leaf: the one span that changes when the second does,
 *  re-rendered by nothing but itself. */
export function HudAge({ atMs, nowMs }: { atMs: number; nowMs?: number }) {
  const text = useHudClockSelector((clock) => formatAge(atMs, nowMs ?? clock));
  return <>{text}</>;
}
