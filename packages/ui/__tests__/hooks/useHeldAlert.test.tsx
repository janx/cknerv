import { cleanup, render } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ALERT_MIN_DWELL_MS, type AlertState } from '../../src/derives/alertLevel';
import { useHeldAlert } from '../../src/hooks/useHeldAlert';

afterEach(cleanup);

/**
 * The alert is read out of a BOX rather than taken as a prop, because that is
 * how `HudOverlay` uses this: it recomputes `alertLevel(...)` inside its own
 * render, so a re-render the hook causes reads the CURRENT world. A probe that
 * took a fixed prop could never show the hold ending on its own timer — the
 * one thing that matters on a chain quiet enough to have nothing else render.
 */
function Probe({ source, seen }: { source: { alert: AlertState }; seen: string[] }) {
  const held = useHeldAlert(source.alert);
  seen.push(`${held.level}:${held.trigger ?? '-'}`);
  return <span data-alert={held.level}>{held.trigger}</span>;
}

const calm: AlertState = { level: 'nominal', trigger: null };
const warn: AlertState = { level: 'warning', trigger: 'reorg-2' };
const crit: AlertState = { level: 'crit', trigger: 'reorg-9' };

describe('useHeldAlert', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const standing = (container: HTMLElement) =>
    container.querySelector('[data-alert]')?.getAttribute('data-alert');

  it('keeps an alarm on screen after its cause is gone', () => {
    const source = { alert: warn };
    const seen: string[] = [];
    const { rerender, container } = render(<Probe source={source} seen={seen} />);
    expect(standing(container)).toBe('warning');

    // The reorg delta is gone on the very next render — the defect this hook
    // exists for, and what used to take the band off screen inside one frame.
    source.alert = calm;
    vi.setSystemTime(20);
    rerender(<Probe source={source} seen={seen} />);
    expect(standing(container)).toBe('warning');

    vi.setSystemTime(ALERT_MIN_DWELL_MS - 1);
    rerender(<Probe source={source} seen={seen} />);
    expect(standing(container)).toBe('warning');
  });

  it('takes itself down at the deadline, with nothing else re-rendering', () => {
    const source = { alert: warn };
    const seen: string[] = [];
    const { container } = render(<Probe source={source} seen={seen} />);
    source.alert = calm;

    act(() => {
      vi.setSystemTime(ALERT_MIN_DWELL_MS - 1);
      vi.advanceTimersByTime(ALERT_MIN_DWELL_MS - 1);
    });
    expect(standing(container), 'fell a millisecond early').toBe('warning');

    act(() => {
      vi.setSystemTime(ALERT_MIN_DWELL_MS);
      vi.advanceTimersByTime(1);
    });
    expect(standing(container)).toBe('nominal');
  });

  it('lets worse news past immediately', () => {
    const source = { alert: warn };
    const seen: string[] = [];
    const { rerender, container } = render(<Probe source={source} seen={seen} />);
    source.alert = crit;
    vi.setSystemTime(10);
    rerender(<Probe source={source} seen={seen} />);
    expect(standing(container)).toBe('crit');
    expect(seen[seen.length - 1]).toBe('crit:reorg-9');
  });

  it('shows the alert on the FIRST committed frame, not after an effect', () => {
    // The E2 trap, one layer along: a hold that settled in an effect would
    // paint one frame of calm over an alarm. `render()` flushes effects before
    // it returns, so the assertion is on what the first render SAW.
    const seen: string[] = [];
    render(<Probe source={{ alert: crit }} seen={seen} />);
    expect(seen[0]).toBe('crit:reorg-9');
  });

  it('holds nothing when nothing is wrong', () => {
    const source = { alert: calm };
    const seen: string[] = [];
    const { rerender, container } = render(<Probe source={source} seen={seen} />);
    source.alert = warn;
    vi.setSystemTime(5);
    rerender(<Probe source={source} seen={seen} />);
    expect(standing(container)).toBe('warning');
  });
});
