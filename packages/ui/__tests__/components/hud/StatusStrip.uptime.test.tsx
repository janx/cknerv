// The uptime is the one reading in the status strip that changes every
// second. It used to arrive as a prop from a clock the overlay ticked at its
// root; it is a leaf on the shared HUD clock now, and the strip around it is
// memoized and never renders for the tick.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StatusStrip from '../../../src/components/hud/StatusStrip';
import { resetHudClockForTest } from '../../../src/components/hud/hudClock';

afterEach(() => {
  cleanup();
  resetHudClockForTest();
  vi.useRealTimers();
});

describe('StatusStrip uptime', () => {
  it('counts from the instant its host mounted, on the shared clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T10:00:00Z'));
    const { container } = render(
      <StatusStrip level="nominal" uptimeSinceMs={Date.now()} />,
    );
    expect(container.textContent).toContain('UP 00:00:00');
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(container.textContent).toContain('UP 00:00:03');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(container.textContent).toContain('UP 00:01:03');
  });

  it('prints a fixed uptime as it stands when a host hands one down', () => {
    vi.useFakeTimers();
    const { container } = render(<StatusStrip level="nominal" uptimeMs={3_000} />);
    expect(container.textContent).toContain('UP 00:00:03');
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(container.textContent).toContain('UP 00:00:03');
  });

  it('is memoized, with the uptime kept out of its props', () => {
    const exported = StatusStrip as unknown as { $$typeof?: symbol; compare?: unknown };
    expect(exported.$$typeof).toBe(Symbol.for('react.memo'));
    expect(exported.compare == null).toBe(true);
  });
});
