import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import WarningBar from '../../../src/components/hud/WarningBar';
import { HUD_COLORS, HUD_MOTION } from '../../../src/components/hud/hudTheme';

afterEach(cleanup);

function channels(hex: string): string {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ');
}

function asRgb(hex: string): string {
  return `rgb(${channels(hex)})`;
}

function asRgba(hex: string, alpha: number): string {
  return `rgba(${channels(hex)}, ${alpha})`;
}

describe('WarningBar', () => {
  it('is hidden at nominal/caution', () => {
    const { container } = render(<WarningBar level="caution" trigger={null} />);
    expect(container.firstChild).toBeNull();
  });
  it('shows the 警告 banner + trigger at warning and above', () => {
    const { container } = render(<WarningBar level="danger" trigger="sync-stall" />);
    const t = container.textContent ?? '';
    expect(t).toContain('警告');
    expect(t).toContain('SYNC-STALL');
  });
  it('can stack below a transport-health banner', () => {
    const { container } = render(
      <WarningBar level="danger" trigger="sync-stall" top={60} />,
    );
    expect((container.firstElementChild as HTMLElement).style.top).toBe('60px');
  });
  // 警告 is the siren and stays outline; the trigger is the reason and inverts,
  // in the same filled grammar the status strip escalates into.
  it('inverts the trigger into a filled chip and leaves the CJK outline', () => {
    const { container } = render(<WarningBar level="warning" trigger="reorg-2" />);
    const chip = container.querySelector('[data-warning-trigger]') as HTMLElement;
    expect(chip.textContent).toBe('REORG-2');
    expect(chip.style.color).toBe('rgb(0, 0, 0)');
    expect(chip.style.backgroundColor).not.toBe('');
    expect(chip.style.padding).toBe('1px 6px');
    const siren = container.querySelector('span') as HTMLElement;
    expect(siren.textContent).toBe('警告');
    expect(siren.style.backgroundColor).toBe('');
  });
  it('carries the warning amber, not chrome orange', () => {
    const { container } = render(<WarningBar level="warning" trigger={null} />);
    const bar = container.firstElementChild as HTMLElement;
    // jsdom hands the hex back as `rgb(...)`, so the comparison is made there.
    expect(bar.style.borderTop).toContain(asRgb(HUD_COLORS.warning));
    expect(bar.style.borderTop).not.toContain(asRgb(HUD_COLORS.orange));
  });
  // Red is already spent by the time crit arrives, so the last step is shape:
  // hazard bands on both edges, static so reduced motion still sees them.
  it('bands both edges at crit only', () => {
    const { container, rerender } = render(<WarningBar level="crit" trigger="reorg-7" />);
    const bands = container.querySelectorAll('[data-hazard-band]');
    expect(bands.length).toBe(2);
    expect((bands[0] as HTMLElement).style.background).toContain('repeating-linear-gradient');
    expect((bands[0] as HTMLElement).style.height).toBe('4px');
    rerender(<WarningBar level="danger" trigger="stalled" />);
    expect(container.querySelectorAll('[data-hazard-band]').length).toBe(0);
  });
  // The other half of the crit step, and the only thing `crit` is: the ground
  // the banding is laid on. Pinned at the surface rather than in the source
  // oracle beside it, because the finding was a token that reached the DOM
  // only as a hand-typed copy of itself.
  it('darkens its own ground at crit, in the token that names the level', () => {
    const { container, rerender } = render(<WarningBar level="crit" trigger="reorg-7" />);
    const bar = () => container.firstElementChild as HTMLElement;
    expect(bar().style.background).toBe(asRgba(HUD_COLORS.crit, 0.35));
    // Only at crit: one step down the bar is still the ordinary black scrim,
    // which is what makes the darkening read as an escalation at all.
    rerender(<WarningBar level="danger" trigger="stalled" />);
    expect(bar().style.background).not.toContain(channels(HUD_COLORS.crit));
  });
  // TEMPO IS THE THIRD AXIS. All three levels ran the same 600 ms steps(2)
  // blink, so the two loudest states moved exactly as fast as the quietest
  // (report E, E-8).
  it('escalates in tempo as well as in hue and in shape', () => {
    const motion = (level: 'warning' | 'danger' | 'crit') => {
      cleanup();
      const { container } = render(<WarningBar level={level} trigger="reorg-2" />);
      return (container.firstElementChild as HTMLElement).style.animation;
    };
    // A reorg two blocks deep is news; the band's presence says it.
    expect(motion('warning')).toBe('');
    // Ongoing and wrong — the HUD's one breathe, the DATA FROZEN band's own.
    expect(motion('danger')).toContain('cknerv-hud-breathe');
    expect(motion('danger')).toContain(`${HUD_MOTION.grow}ms`);
    expect(motion('danger')).toContain(HUD_MOTION.loopEase);
    // The reserved two-state flash, and nothing else in the app wears it.
    expect(motion('crit')).toContain('cknerv-hud-flash');
    expect(motion('crit')).toContain(`${HUD_MOTION.linger}ms`);
    expect(motion('crit')).toContain(HUD_MOTION.alarmEase);
  });
  it('stops every tempo for a visitor who asked for none', () => {
    for (const level of ['warning', 'danger', 'crit'] as const) {
      cleanup();
      const { container } = render(
        <WarningBar level={level} trigger="reorg-2" reducedMotion />,
      );
      expect((container.firstElementChild as HTMLElement).style.animation).toBe('');
    }
  });
  it('keeps the hazard bands under reduced motion, where the flash stops', () => {
    const { container } = render(
      <WarningBar level="crit" trigger="reorg-7" reducedMotion />,
    );
    expect((container.firstElementChild as HTMLElement).style.animation).toBe('');
    expect(container.querySelectorAll('[data-hazard-band]').length).toBe(2);
  });
});
