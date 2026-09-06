import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import RenderStatsPanel from '../../../src/components/hud/RenderStatsPanel';
import { HUD_COLORS, HUD_TYPE } from '../../../src/components/hud/hudTheme';
import { setGpuSampleCount } from '../../../src/tweaks/performanceProbeStore';

// The device fact is a module-level singleton (it is published once from the
// Canvas `onCreated`), so the panel is driven by setting it and every test
// puts it back — a leaked `4` would make the absent cases below vacuous.
afterEach(() => {
  setGpuSampleCount(null);
  cleanup();
});

function notice(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-render-stats-msaa]');
}

describe('GL·08 under a multisampled context', () => {
  it('states the sample count and what it costs the two GPU figures', () => {
    setGpuSampleCount(4);
    const { container } = render(<RenderStatsPanel />);
    const row = notice(container);
    expect(row, 'the multisample notice is missing at samples 4').not.toBeNull();
    expect(row?.textContent).toBe('MSAA ×4 · SCOPES SPLIT THE PASS · READ FPS');
    // …and it says WHY on hover, because the row itself has no room to.
    expect(row?.getAttribute('title')).toBe(
      'On a multisampled context every per-draw timer query ends the render'
      + ' pass; GPU and OTHER overstate, FPS is the honest number.',
    );
  });

  it('reads the count off the context rather than assuming four', () => {
    setGpuSampleCount(2);
    const { container } = render(<RenderStatsPanel />);
    expect(notice(container)?.textContent).toBe('MSAA ×2 · SCOPES SPLIT THE PASS · READ FPS');
  });

  it('is a reading, not an alarm: caution ink at the floor rung, never a fill', () => {
    setGpuSampleCount(4);
    const { container } = render(<RenderStatsPanel />);
    const row = notice(container) as HTMLElement;
    expect(row.style.color).toBe(asRgb(HUD_COLORS.caution));
    expect(row.style.fontSize).toBe(`${HUD_TYPE.micro}px`);
    // A filled severity block is the HUD's "something is wrong"; a footnote on
    // a panel you had to summon does not get to wear it.
    expect(row.style.background).toBe('');
  });

  it('says nothing on a context that resolved without multisampling', () => {
    setGpuSampleCount(0);
    const { container } = render(<RenderStatsPanel />);
    expect(notice(container)).toBeNull();
  });

  it('says nothing before a context has answered at all', () => {
    setGpuSampleCount(null);
    const { container } = render(<RenderStatsPanel />);
    expect(notice(container)).toBeNull();
    // The panel is still the panel: the notice is the only thing gated on the
    // sample count, and its absence takes no row with it.
    expect(container.textContent).toContain('RENDER STATS');
    expect(container.textContent).toContain('OTHER');
  });
});

function asRgb(hex: string): string {
  const h = hex.replace('#', '');
  return `rgb(${[0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
}
