import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import WarningBar from '../../../src/components/hud/WarningBar';
import { HUD_COLORS } from '../../../src/components/hud/hudTheme';

afterEach(cleanup);

function asRgb(hex: string): string {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
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
  it('keeps the hazard bands under reduced motion, where the flash stops', () => {
    const { container } = render(
      <WarningBar level="crit" trigger="reorg-7" reducedMotion />,
    );
    expect((container.firstElementChild as HTMLElement).style.animation).toBe('');
    expect(container.querySelectorAll('[data-hazard-band]').length).toBe(2);
  });
});
