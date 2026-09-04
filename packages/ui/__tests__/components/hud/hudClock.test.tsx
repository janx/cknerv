// The HUD's one wall clock: a store with leaf subscribers. These pins hold
// the three things that make it cheaper than the root-level tick it replaced
// — one interval shared by every leaf, a selector that sleeps through ticks
// that say the same thing, and a host-supplied clock that never wakes a leaf
// at all — plus the two edges a shared store has to get right: a reader
// arriving between ticks, and a timer implementation swapped under it.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HUD_CLOCK_TICK_MS,
  HudAge,
  hudClockSubscriberCount,
  readHudClockMs,
  resetHudClockForTest,
  useHudClockSelector,
  useHudNowMs,
} from '../../../src/components/hud/hudClock';

afterEach(() => {
  cleanup();
  resetHudClockForTest();
  vi.useRealTimers();
});

/** A fake clock parked on a minute boundary, so a five-second walk cannot
 *  cross one and wake the minute reader by accident. */
function parkedFakeClock(): number {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-28T10:00:00Z'));
  return Date.now();
}

describe('hudClock', () => {
  it('runs one interval for every leaf and stops it when the last one leaves', () => {
    const start = parkedFakeClock();
    const renders = { seconds: 0, minutes: 0 };
    function Seconds() {
      renders.seconds += 1;
      const ms = useHudNowMs();
      return <span data-testid="seconds">{ms}</span>;
    }
    function Minutes() {
      renders.minutes += 1;
      const minute = useHudClockSelector((ms) => Math.floor(ms / 60_000));
      return <span data-testid="minutes">{minute}</span>;
    }
    const { getByTestId, unmount } = render(<><Seconds /><Minutes /></>);
    expect(hudClockSubscriberCount()).toBe(2);
    expect(vi.getTimerCount()).toBe(1);
    expect(Number(getByTestId('seconds').textContent)).toBe(start);

    // One tick per act, so each notification commits on its own — five ticks
    // inside one act would batch into a single render and hide the count.
    for (let tick = 1; tick <= 5; tick += 1) {
      act(() => { vi.advanceTimersByTime(HUD_CLOCK_TICK_MS); });
      expect(Number(getByTestId('seconds').textContent)).toBe(start + tick * 1_000);
    }
    // The second reader woke once a tick; the minute reader selected the
    // same value every time and slept through all five.
    expect(renders.seconds).toBe(6);
    expect(renders.minutes).toBe(1);

    unmount();
    expect(hudClockSubscriberCount()).toBe(0);
    // No listener, no timer: the clock does not tick an empty room.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a host-supplied clock selects a constant, so the leaf never wakes', () => {
    const now = parkedFakeClock();
    let renders = 0;
    function Age() {
      renders += 1;
      return <HudAge atMs={now - 90_000} nowMs={now} />;
    }
    const { container } = render(<Age />);
    expect(container.textContent).toBe('1M 30S');
    act(() => { vi.advanceTimersByTime(HUD_CLOCK_TICK_MS * 5); });
    expect(container.textContent).toBe('1M 30S');
    expect(renders).toBe(1);
  });

  it('ages a span on the shared clock when no host clock is given', () => {
    const now = parkedFakeClock();
    const { container } = render(<HudAge atMs={now - 55_000} />);
    expect(container.textContent).toBe('55S');
    act(() => { vi.advanceTimersByTime(HUD_CLOCK_TICK_MS * 5); });
    expect(container.textContent).toBe('1M 0S');
  });

  it('refreshes a reader that arrives between ticks rather than serving a stale second', () => {
    const start = parkedFakeClock();
    expect(readHudClockMs()).toBe(start);
    // Nobody is subscribed, so nothing ticked — but a second and a half has
    // passed, and a reader must not print the old second.
    vi.advanceTimersByTime(1_500);
    expect(readHudClockMs()).toBe(start + 1_500);
    // …while two reads inside the same second agree, which is what keeps a
    // render from tearing between them.
    vi.advanceTimersByTime(200);
    expect(readHudClockMs()).toBe(start + 1_500);
  });

  it('re-arms under a timer implementation swapped beneath it', () => {
    // A leaf subscribed under real timers…
    function Seconds() {
      const ms = useHudNowMs();
      return <span data-testid="seconds">{ms}</span>;
    }
    render(<Seconds />);
    expect(hudClockSubscriberCount()).toBe(1);
    // …then the suite fakes the clock. The real interval can be neither
    // advanced nor cleared by the fake, so the next subscriber re-arms.
    const start = parkedFakeClock();
    const { getAllByTestId } = render(<Seconds />);
    expect(hudClockSubscriberCount()).toBe(2);
    expect(vi.getTimerCount()).toBe(1);
    act(() => { vi.advanceTimersByTime(HUD_CLOCK_TICK_MS * 2); });
    // Both leaves — the one that subscribed under the real clock too — now
    // read the fake one's ticks: the re-armed interval feeds every listener.
    const readings = getAllByTestId('seconds').map((node) => Number(node.textContent));
    expect(readings).toEqual([start + 2_000, start + 2_000]);
  });
});
