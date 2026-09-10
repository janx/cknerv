import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  getQualityRuntimeSnapshot,
  setAdaptiveQuality,
  setAdaptiveQualityLocked,
  setQualityMode,
} from '../../../src/tweaks/qualityPresets';
import {
  CELL_DISPLAY_MAX,
  getCellDisplayRuntimeSnapshot,
  setCellDisplayLimit,
  setCellDisplayMode,
} from '../../../src/tweaks/cellDisplay';

const levaMocks = vi.hoisted(() => ({
  setQuality: vi.fn(),
}));

vi.mock('leva', () => ({
  useControls: () => [{ quality: 'auto' }, levaMocks.setQuality],
}));

import StatusStrip from '../../../src/components/hud/StatusStrip';
import {
  getStageCellsDisclosed,
  setStageCellsDisclosed,
} from '../../../src/components/hud/stageCellsDisclosure';
import { HUD_COLORS } from '../../../src/components/hud/hudTheme';

/** jsdom hands inline colours back as `rgb()`. */
function rgbOf(hex: string): string {
  const h = hex.replace('#', '');
  const channel = (at: number) => parseInt(h.slice(at, at + 2), 16);
  return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
}

/** Four panels sitting exactly where they ship — the out-of-the-box state, and
 *  the one the control has to read as "nothing has been changed". */
const panelControls = [
  { id: 'chain', code: 'CKB·01', label: 'COMMON KNOWLEDGE BASE', visible: true, defaultVisible: true },
  { id: 'pulse', code: 'ECG·04', label: 'PULSE', visible: true, defaultVisible: true },
  { id: 'cells', code: 'CELL·03', label: 'CELL MESH', visible: true, defaultVisible: true },
  { id: 'peers', code: 'PEER·02', label: 'PEER MESH', visible: true, defaultVisible: true },
];

/** …and the roster the HUD actually ships: two dev instruments OFF by default,
 *  so the honest reading of a fresh load is 5 of 7 and NOT diverged. */
const shippedPanelControls = [
  ...panelControls,
  { id: 'dao', code: 'DAO·05', label: 'NERVOS DAO', visible: true, defaultVisible: true },
  { id: 'stage', code: 'STAGE·07', label: 'STAGE SAMPLE', visible: false, defaultVisible: false },
  { id: 'render', code: 'GL·08', label: 'RENDER STATS', visible: false, defaultVisible: false },
];

beforeEach(() => {
  setQualityMode('auto');
  setAdaptiveQuality('high');
  setCellDisplayLimit(CELL_DISPLAY_MAX);
  setCellDisplayMode('auto');
  // The bar boots WITHOUT the cap control and the quality rail is the door to
  // it (`stageCellsDisclosure.ts`). Everything below this line is about the
  // row's content rather than about that door, so these tests are handed the
  // row a reader has opened; the door itself is the block at the bottom of
  // this file.
  setStageCellsDisclosed(true);
  levaMocks.setQuality.mockClear();
});

afterEach(() => {
  cleanup();
  setQualityMode('auto');
  setAdaptiveQuality('high');
  setCellDisplayLimit(CELL_DISPLAY_MAX);
  setCellDisplayMode('auto');
  setStageCellsDisclosed(false);
});

describe('StatusStrip', () => {
  it('is memoized with the default prop comparison', () => {
    const exported = StatusStrip as unknown as { $$typeof?: symbol; compare?: unknown };
    expect(exported.$$typeof).toBe(Symbol.for('react.memo'));
    expect(exported.compare == null).toBe(true);
  });

  it('shows the wordmark', () => {
    const { container } = render(<StatusStrip />);
    const root = container.firstElementChild as HTMLElement;
    expect(container.textContent).toContain('CKNERV');
    expect(container.querySelector('[data-cknerv-brand-mark]')).not.toBeNull();
    expect((container.querySelector('[data-status-brand]') as HTMLElement).style.fontWeight).toBe('500');
    expect((container.querySelector('[data-status-brand]') as HTMLElement).style.letterSpacing).toBe('4.2px');
    expect(root.dataset.statusLayout).toBe('wide');
    expect(root.style.height).toBe('36px');
    expect(container.querySelector('[data-status-uptime]')).toBeNull();
    expect(container.querySelector('[data-status-accent-rail]')).not.toBeNull();
  });
  it('includes the compact mark in the hidden measurement probe', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(<StatusStrip probe probeRef={ref} />);
    expect(container.querySelector('[data-status-probe="true"] [data-cknerv-brand-mark]')).not.toBeNull();
    expect(container.textContent).toContain('CKNERV');
  });
  it.each([
    { layout: 'wide', compact: false, mobile: false },
    { layout: 'compact', compact: true, mobile: false },
    { layout: 'mobile', compact: true, mobile: true },
  ])('omits the overall status indicator and session uptime in the $layout layout', ({ compact, mobile }) => {
    const { container } = render(<StatusStrip compact={compact} mobile={mobile} />);
    expect(container.textContent).not.toContain('状态');
    expect(container.textContent).not.toContain('NOMINAL');
    expect(container.querySelector('[data-status-indicator]')).toBeNull();
    expect(container.querySelector('[data-status-level-chip]')).toBeNull();
    expect(container.querySelector('[data-status-summary]')).toBeNull();
    expect(container.querySelector('[data-dot]')).toBeNull();
    expect(container.querySelector('[data-status-uptime]')).toBeNull();
    expect(container.textContent).not.toMatch(/UP \d+:\d{2}:\d{2}/);
  });
  it('renders the build version as a commit link beside the wordmark', () => {
    render(
      <StatusStrip
        build={{ version: '1.0.1@61922ba', href: 'https://github.com/janx/cknerv/commit/61922ba' }}
      />,
    );
    const link = screen.getByRole('link', { name: '1.0.1@61922ba' });
    expect(link.getAttribute('href')).toBe('https://github.com/janx/cknerv/commit/61922ba');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
    expect(link.textContent).toBe('BUILD1.0.1@61922ba');
  });

  it('omits the build link when no build prop is given', () => {
    const { queryByRole } = render(<StatusStrip />);
    expect(queryByRole('link')).toBeNull();
  });

  it('places the panel menu after the build and controls panels independently', () => {
    const onPanelVisibilityChange = vi.fn();
    const { container } = render(
      <StatusStrip
        build={{ version: '1.0.1@61922ba', href: 'https://github.com/janx/cknerv/commit/61922ba' }}
        panelControls={panelControls}
        onPanelVisibilityChange={onPanelVisibilityChange}
      />,
    );
    const primary = container.querySelector('[data-status-primary]') as HTMLElement;
    const build = screen.getByRole('link', { name: '1.0.1@61922ba' });
    const control = container.querySelector('[data-panel-visibility-control]') as HTMLElement;
    const toggle = screen.getByRole('button', {
      name: 'Configure HUD panels, 4 of 4 visible',
    });

    expect(build.nextElementSibling).toBe(control);
    expect(primary.contains(toggle)).toBe(true);
    expect(control.style.display).toBe('flex');
    expect(control.style.alignItems).toBe('center');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'HUD panels' })).not.toBeNull();

    const chainToggle = screen.getByRole('menuitemcheckbox', {
      name: 'COMMON KNOWLEDGE BASE panel',
    });
    expect(chainToggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(chainToggle);
    expect(onPanelVisibilityChange).toHaveBeenCalledWith('chain', false);
  });

  it('reads the shipped roster as the default, not as a divergence', () => {
    // `5/7` IS the out-of-the-box state — two dev instruments ship hidden — and
    // the control painted it chrome orange, "you diverged", on every fresh
    // load, beside a BUILD chip whose rail is also orange (report A, A-2).
    const { container, rerender } = render(
      <StatusStrip
        panelControls={shippedPanelControls}
        onPanelVisibilityChange={() => {}}
      />,
    );
    const toggle = () => container.querySelector('[data-panel-visibility-toggle]') as HTMLElement;
    expect(toggle().textContent).toContain('5/7');
    expect(toggle().style.color).toBe(rgbOf(HUD_COLORS.cyanWire));

    // Hiding a panel that ships shown IS a divergence…
    rerender(
      <StatusStrip
        panelControls={shippedPanelControls.map((panel) => (
          panel.id === 'cells' ? { ...panel, visible: false } : panel
        ))}
        onPanelVisibilityChange={() => {}}
      />,
    );
    expect(toggle().style.color).toBe(rgbOf(HUD_COLORS.orange));

    // …and so is showing one that ships hidden, which a count of visible
    // panels reads as MORE default rather than less.
    rerender(
      <StatusStrip
        panelControls={shippedPanelControls.map((panel) => (
          panel.id === 'render' ? { ...panel, visible: true } : panel
        ))}
        onPanelVisibilityChange={() => {}}
      />,
    );
    expect(toggle().textContent).toContain('6/7');
    expect(toggle().style.color).toBe(rgbOf(HUD_COLORS.orange));
  });

  it('uses a prioritized two-row layout when horizontal space is constrained', () => {
    const { container } = render(
      <StatusStrip
        build={{ version: '1.0.1@61922ba', href: 'https://github.com/janx/cknerv/commit/61922ba' }}
        panelControls={panelControls}
        onPanelVisibilityChange={() => {}}
        compact
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    const controls = container.querySelector('[data-status-controls]') as HTMLElement;

    expect(root.dataset.statusLayout).toBe('compact');
    expect(root.style.display).toBe('grid');
    expect(root.style.height).toBe('64px');
    expect(controls.style.overflowX).toBe('auto');
    expect(screen.getByRole('link', { name: '1.0.1@61922ba' }).textContent).toBe('BUILD1.0.1@61922ba');
    expect(screen.getByRole('button', {
      name: 'Configure HUD panels, 4 of 4 visible',
    })).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Cell display count' })).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Render quality' })).not.toBeNull();
  });

  it('keeps primary controls visible in a dedicated mobile layout', () => {
    const { container } = render(
      <StatusStrip
        build={{ version: '1.0.1@61922ba', href: 'https://github.com/janx/cknerv/commit/61922ba' }}
        panelControls={panelControls}
        onPanelVisibilityChange={() => {}}
        cellCount={5_000}
        enrichmentSource={{
          source: 'ckbadger',
          status: 'connecting',
          capabilities: [],
        }}
        compact
        mobile
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    const performance = container.querySelector('[data-status-performance]') as HTMLElement;
    const context = container.querySelector('[data-status-context]') as HTMLElement;

    expect(root.dataset.statusLayout).toBe('mobile');
    expect(root.style.height).toBe('88px');
    // The priority row reaches what it holds. It was `overflow: hidden` while
    // `STAGE CELLS` stood first in it and pushed the quality rail's `L` off a
    // 390 px phone; the rail is first now, at the row's own origin, and the
    // chip a reader disclosed can be scrolled to rather than cut.
    expect(performance.style.overflowX).toBe('auto');
    expect(performance.style.overflowY).toBe('hidden');
    expect(performance.querySelector('[data-cell-display-control]')).not.toBeNull();
    expect(performance.querySelector('[data-render-quality-control]')).not.toBeNull();
    expect(context.style.overflowX).toBe('auto');
    expect(context.textContent).toContain('CKBADGERCONNECTING');
    expect(within(context).getByRole('link', { name: 'CKBADGER' }).getAttribute('href'))
      .toBe('https://ckbadger.web5.info/');
  });

  it('shows optional indexed-context freshness', () => {
    const { container } = render(
      <StatusStrip
        enrichmentSource={{
          source: 'ckbadger',
          status: 'stale',
          capabilities: ['cell_detail'],
          lag_blocks: 18,
          message: 'index is behind',
        }}
      />,
    );

    const chip = container.querySelector('[data-enrichment-chip]') as HTMLElement;
    expect(chip.dataset.enrichmentStatus).toBe('stale');
    // `18↓` read as "eighteen, down": an arrow is a DIRECTION mark in this HUD
    // and it was standing in for a noun (report A, A-13).
    expect(chip.getAttribute('aria-label')).toBe('ckbadger stale · LAG 18');
    expect(chip.textContent).toContain('CKBADGERSTALE · LAG 18');
    expect(chip.textContent).not.toContain('↓');
    const sourceLink = within(chip).getByRole('link', { name: 'CKBADGER' });
    expect(sourceLink.getAttribute('href')).toBe('https://ckbadger.web5.info/');
    expect(sourceLink.getAttribute('target')).toBe('_blank');
    expect(sourceLink.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('keeps source navigation out of canvas pointer and click handlers', () => {
    const onPointerDown = vi.fn();
    const onClick = vi.fn();
    render(
      <div onPointerDown={onPointerDown} onClick={onClick}>
        <StatusStrip
          enrichmentSource={{ source: 'ckbadger', status: 'ready', capabilities: [] }}
          compact
        />
      </div>,
    );
    const link = screen.getByRole('link', { name: 'CKBADGER' });
    fireEvent.pointerDown(link);
    fireEvent.click(link);
    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it.each([
    { layout: 'wide', compact: false, mobile: false },
    { layout: 'compact', compact: true, mobile: false },
    { layout: 'mobile', compact: true, mobile: true },
  ])('places product-owned actions after source status in the $layout layout', ({ compact, mobile }) => {
    const { container } = render(
      <StatusStrip
        enrichmentSource={{ source: 'ckbadger', status: 'ready', capabilities: [] }}
        actions={<a href="https://web5.info/">WEB5.INFO</a>}
        compact={compact}
        mobile={mobile}
      />,
    );

    const source = container.querySelector('[data-enrichment-chip]') as HTMLElement;
    const actions = container.querySelector('[data-status-actions]') as HTMLElement;
    expect(source.nextElementSibling).toBe(actions);
    expect(within(actions).getByRole('link', { name: 'WEB5.INFO' })).not.toBeNull();
  });

  it('names the tier AUTO chose without lending it to the button beside it', () => {
    // The rail reads `AUTO(H) H M L`. It used to read `AUTO·H  H  M  L`, and
    // the suffix looked like the H button had escaped its own rail — `·` is
    // this HUD's separator between two peers, and the effective tier is not a
    // peer of the tier buttons, it is what AUTO chose (report A, A-13).
    setQualityMode('auto');
    setAdaptiveQuality('high');
    const { container } = render(<StatusStrip />);
    const auto = container.querySelector('[data-quality-option="auto"]') as HTMLElement;

    expect(auto.textContent).toBe('AUTO(H)');
    expect(auto.textContent).not.toContain('·');
  });

  it('offers a tiered AUTO Cell cap with an immediate manual slider override', () => {
    const { container } = render(
      <StatusStrip cellCount={5_000} />,
    );
    const control = screen.getByRole('group', { name: 'Cell display count' });
    const automatic = within(control).getByRole(
      'button',
      { name: 'Automatic cell count' },
    );
    const slider = within(control).getByRole(
      'slider',
      { name: 'Displayed cell limit' },
    ) as HTMLInputElement;

    expect(automatic.getAttribute('aria-pressed')).toBe('true');
    // AUTO is the fixed 12K structural budget (quality-independent);
    // the manual rail still spans the full 50K.
    expect(slider.value).toBe('77');
    expect(slider.max).toBe('229');
    expect(slider.getAttribute('aria-valuetext')).toContain('12,000 Cells');
    expect(control.getAttribute('data-cell-display-capacity')).toBe('50000');
    expect(control.getAttribute('data-cell-display-count')).toBe('5000');
    expect(control.getAttribute('data-cell-display-available')).toBe('5000');
    expect(control.querySelector('[data-cell-display-track]')).not.toBeNull();
    expect(
      control.querySelector('[data-cell-display-shown]')?.textContent,
    ).toContain('5K');
    expect(
      control.querySelector('[data-cell-display-shown]')?.textContent,
    ).not.toContain('SHOWN');
    expect(
      control.querySelector('[data-cell-display-cap]')?.textContent,
    ).toContain('/12K');
    expect(automatic.textContent).toContain('AUTO');

    fireEvent.change(slider, { target: { value: '29' } });

    expect(getCellDisplayRuntimeSnapshot()).toEqual({
      mode: 'manual',
      manualLimit: 3_000,
    });
    expect(control.getAttribute('data-cell-display-mode')).toBe('manual');
    expect(control.getAttribute('data-cell-display-count')).toBe('3000');
    expect(
      control.querySelector('[data-cell-display-shown]')?.textContent,
    ).toContain('3K');
    expect(
      control.querySelector('[data-cell-display-cap]')?.textContent,
    ).toContain('/3K');
    expect(automatic.textContent).toContain('MAN');

    fireEvent.click(automatic);
    expect(getCellDisplayRuntimeSnapshot().mode).toBe('auto');
    expect(automatic.getAttribute('aria-pressed')).toBe('true');
    expect(automatic.textContent).toContain('AUTO');
  });

  it('says when the automatic tier has stopped being a live reading', () => {
    const { rerender } = render(
      <StatusStrip cellCount={5_000} />,
    );
    const control = screen.getByRole('group', { name: 'Cell display count' });
    const automatic = within(control).getByRole(
      'button',
      { name: 'Automatic cell count' },
    );

    expect(control.getAttribute('title')).toContain('adaptive HIGH cap');
    expect(automatic.getAttribute('title')).toContain('active · HIGH =');

    setAdaptiveQualityLocked(true);
    rerender(<StatusStrip cellCount={5_000} />);

    expect(control.getAttribute('title')).toContain('adaptive HIGH (locked) cap');
    expect(automatic.getAttribute('title')).toContain('active · HIGH (locked) =');
  });

  it('keeps a 50K manual range while AUTO respects a smaller server cap', () => {
    render(
      <StatusStrip
        cellCount={2_000}
        cellCapacity={2_000}
      />,
    );
    const control = screen.getByRole('group', { name: 'Cell display count' });
    const slider = within(control).getByRole(
      'slider',
      { name: 'Displayed cell limit' },
    ) as HTMLInputElement;

    expect(slider.max).toBe('229');
    expect(slider.value).toBe('19');
    expect(slider.getAttribute('aria-valuetext')).toContain('2,000 Cells');
    expect(control.getAttribute('data-cell-display-capacity')).toBe('50000');
    expect(control.getAttribute('data-cell-display-source-capacity')).toBe('2000');

    fireEvent.change(slider, { target: { value: '229' } });

    expect(getCellDisplayRuntimeSnapshot()).toEqual({
      mode: 'manual',
      manualLimit: 50_000,
    });
    expect(control.getAttribute('data-cell-display-limit')).toBe('50000');
    expect(control.getAttribute('data-cell-display-count')).toBe('2000');
    expect(
      control.querySelector('[data-cell-display-shown]')?.textContent,
    ).toContain('2K');
    expect(
      control.querySelector('[data-cell-display-cap]')?.textContent,
    ).toContain('/50K');
    expect(control.getAttribute('title')).toContain(
      'server currently retains 2,000',
    );
  });

  it('separates the shown count from the cap while exposing unused headroom', () => {
    render(
      <StatusStrip cellCount={2_700} />,
    );
    const control = screen.getByRole('group', { name: 'Cell display count' });
    const automatic = within(control).getByRole(
      'button',
      { name: 'Automatic cell count' },
    );
    const slider = within(control).getByRole(
      'slider',
      { name: 'Displayed cell limit' },
    ) as HTMLInputElement;

    fireEvent.change(slider, { target: { value: '59' } });

    expect(getCellDisplayRuntimeSnapshot()).toEqual({
      mode: 'manual',
      manualLimit: 7_500,
    });
    expect(control.getAttribute('data-cell-display-count')).toBe('2700');
    expect(control.getAttribute('data-cell-display-available')).toBe('2700');
    expect(
      control.querySelector('[data-cell-display-shown]')?.textContent,
    ).toContain('2.7K');
    expect(
      control.querySelector('[data-cell-display-cap]')?.textContent,
    ).toContain('/7.5K');
    expect(control.querySelector('[data-cell-display-headroom]')).not.toBeNull();
    expect(control.querySelector('[data-cell-display-shown-marker]')).not.toBeNull();
    expect(control.querySelector('[data-cell-display-cap-marker]')).not.toBeNull();
    expect(automatic.textContent).toContain('MAN');
    expect(slider.getAttribute('aria-valuetext')).toContain(
      '2,700 shown of 2,700 available',
    );

    fireEvent.change(slider, { target: { value: '53' } });

    expect(control.getAttribute('data-cell-display-count')).toBe('2700');
    expect(
      control.querySelector('[data-cell-display-cap]')?.textContent,
    ).toContain('/6K');

    fireEvent.change(slider, { target: { value: '19' } });

    expect(control.getAttribute('data-cell-display-count')).toBe('2000');
    expect(
      control.querySelector('[data-cell-display-shown]')?.textContent,
    ).toContain('2K');
    expect(
      control.querySelector('[data-cell-display-cap]')?.textContent,
    ).toContain('/2K');
    expect(control.querySelector('[data-cell-display-headroom]')).toBeNull();
    expect(control.querySelector('[data-cell-display-shown-marker]')).toBeNull();
  });

  it('offers an always-visible auto/high/med/low render-quality control', () => {
    render(<StatusStrip />);
    const control = screen.getByRole('group', { name: 'Render quality' });
    const scoped = within(control);

    expect(control.querySelector('[data-quality-rail]')).not.toBeNull();
    expect(scoped.getAllByRole('button')).toHaveLength(4);
    expect(
      scoped.getByRole('button', { name: 'Auto render quality' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(scoped.getByRole('button', { name: 'High render quality' })).not.toBeNull();
    expect(scoped.getByRole('button', { name: 'Med render quality' })).not.toBeNull();
    expect(scoped.getByRole('button', { name: 'Low render quality' })).not.toBeNull();
    expect(scoped.getByRole('button', { name: 'High render quality' }).textContent).toBe('H');
    expect(scoped.getByRole('button', { name: 'Med render quality' }).textContent).toBe('M');
    expect(scoped.getByRole('button', { name: 'Low render quality' }).textContent).toBe('L');
    expect(control.getAttribute('data-quality-effective')).toBe('high');
  });

  it('applies a manual quality mode and synchronizes the developer control', () => {
    render(<StatusStrip />);
    const low = screen.getByRole('button', { name: 'Low render quality' });

    fireEvent.click(low);

    expect(levaMocks.setQuality).toHaveBeenCalledWith({ quality: 'low' });
    expect(getQualityRuntimeSnapshot()).toMatchObject({
      mode: 'low',
      effective: 'low',
      source: 'manual',
    });
    expect(low.getAttribute('aria-pressed')).toBe('true');
  });

  it('draws the panels control\'s two marks instead of typing them', () => {
    // `▦` and `▲`/`▼` — a menu icon and a disclosure caret, neither of them a
    // word, all three of them characters no face in `src/fonts` carries. The
    // button already states everything they mean: it carries its own
    // `aria-label` and an `aria-expanded`, so both marks are decoration and
    // both stay hidden.
    render(
      <StatusStrip
        panelControls={panelControls}
        onPanelVisibilityChange={() => {}}
      />,
    );
    const toggle = screen.getByRole('button', { name: /Configure HUD panels/ });

    expect(toggle.textContent).not.toMatch(/[\u25A6\u25B2\u25BC]/);
    expect(toggle.querySelector('[data-panel-grid-mark][aria-hidden="true"]')).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.querySelector('[data-direction-mark]')?.getAttribute('data-direction-mark'))
      .toBe('down');

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.querySelector('[data-direction-mark]')?.getAttribute('data-direction-mark'))
      .toBe('up');
  });
});

// ——— As a probe ————————————————————————————————————————————————————————
//
// The overlay no longer folds the bar at a screen width; it measures. What it
// measures is this same component rendered a second time, wide and hidden, at
// its natural width — the only thing that knows how much room one row wants is
// the row (`useStatusStripFold.ts`). These pins are the difference between a
// measurement and a second status bar: the probe must carry the row's content
// and none of its presence.
describe('StatusStrip as a probe', () => {
  const probeProps = {
    build: { version: '1.0.1@61922ba', href: 'https://github.com/janx/cknerv/commit/61922ba' },
    panelControls,
    onPanelVisibilityChange: () => {},
    cellCount: 5_000,
    enrichmentSource: {
      source: 'ckbadger',
      status: 'ready',
      capabilities: [] as string[],
      lag_blocks: 2,
    },
  } as const;

  it('measures the one row and is otherwise not there', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <StatusStrip {...probeProps} compact mobile probe probeRef={ref} />,
    );
    const root = container.firstElementChild as HTMLElement;

    // Handed to the overlay, which has nothing else to measure.
    expect(ref.current).toBe(root);
    // A probe measures the ONE ROW by definition: `compact` and `mobile` are
    // what the fold would DO, and a probe that folded with the strip could
    // never say there was room to unfold again.
    expect(root.dataset.statusLayout).toBe('wide');
    expect(root.style.height).toBe('36px');
    expect(root.dataset.statusProbe).toBe('true');
    // Its own class: every selector in this HUD, in its tests and in the live
    // drivers takes `.cknerv-status-strip` and must keep finding the strip a
    // reader can see.
    expect(root.className).toBe('cknerv-status-strip-probe');
    expect(root.getAttribute('role')).toBeNull();
    expect(root.getAttribute('aria-label')).toBeNull();
    expect(root.getAttribute('aria-hidden')).toBe('true');
    // `visibility: hidden` is the guard that does the work — not hit-tested,
    // not focusable, out of the accessibility tree — and it INHERITS, so the
    // controls' own `pointerEvents: 'auto'` cannot reach back through it.
    expect(root.style.visibility).toBe('hidden');
    expect(root.style.pointerEvents).toBe('none');
    // Natural width, not the page's: `right: 0` would stretch it to the
    // viewport and every measurement would come back as the viewport.
    expect(root.style.width).toBe('max-content');
    expect(root.style.right).toBe('auto');
    // The rail is the strip's edge against the stage. A hidden copy has no
    // edge to draw.
    expect(container.querySelector('[data-status-accent-rail]')).toBeNull();
  });

  it('carries the row\'s content without lending it to the reader', () => {
    const { container } = render(<StatusStrip {...probeProps} probe />);

    // Everything that makes the row as wide as it is, present and measurable…
    expect(container.querySelector('[data-cell-display-control]')).not.toBeNull();
    expect(container.querySelector('[data-render-quality-control]')).not.toBeNull();
    expect(container.querySelector('[data-panel-visibility-control]')).not.toBeNull();
    expect(container.querySelector('[data-enrichment-chip]')?.textContent)
      .toContain('CKBADGERREADY · LAG 2');
    expect(container.querySelector('[data-status-uptime]')).toBeNull();

    // …and none of it reachable: `aria-hidden` takes the whole subtree out of
    // the accessible tree, so a screen reader is told about ONE bar and a
    // keyboard has one set of controls to walk.
    expect(screen.queryByRole('group', { name: 'Cell display count' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Render quality' })).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('leaves the strip a reader sees exactly as it was', () => {
    const { container } = render(<StatusStrip {...probeProps} />);
    const root = container.querySelector('.cknerv-status-strip') as HTMLElement;

    expect(root.getAttribute('role')).toBe('navigation');
    expect(root.getAttribute('aria-label')).toBe('Dashboard controls');
    expect(root.dataset.statusProbe).toBeUndefined();
    expect(root.getAttribute('aria-hidden')).toBeNull();
    expect(root.style.visibility).toBe('');
    expect(root.style.width).toBe('');
    expect(root.style.right).toBe('0px');
    expect(container.querySelector('[data-status-accent-rail]')).not.toBeNull();
    expect(screen.getByRole('navigation', { name: 'Dashboard controls' })).toBe(root);
  });
});
describe('the quality rail is the door to the stage-cells cap', () => {
  // `STAGE CELLS` is 279 px of a 1,079 px row and it is a control, not a
  // reading — a refinement of the tier chosen one module to its right, since
  // AUTO's cap IS that tier's. So the bar boots without it (user ruling,
  // 2026-09-10) and this block is the whole of how it comes and goes.
  const chip = (container: HTMLElement) => container
    .querySelector('[data-cell-display-control]');

  beforeEach(() => {
    setStageCellsDisclosed(false);
  });

  it('boots without the cap control and no reader has to dismiss it', () => {
    const { container } = render(<StatusStrip cellCount={5_000} />);

    expect(chip(container)).toBeNull();
    expect(container.textContent).not.toContain('STAGE CELLS');
    // …and the rail that opens it is exactly where it was.
    expect(screen.getByRole('group', { name: 'Render quality' })).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Auto render quality' })
        .getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('brings it up on any tier, the one already chosen included', () => {
    const { container } = render(<StatusStrip cellCount={5_000} />);

    // AUTO is the tier under the diamond on a fresh page, and pressing it used
    // to be the one click in this rail that did nothing at all.
    fireEvent.click(screen.getByRole('button', { name: 'Auto render quality' }));
    expect(chip(container)).not.toBeNull();
    expect(getStageCellsDisclosed()).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Low render quality' })
        .getAttribute('aria-expanded'),
    ).toBe('true');

    // A tier that is not the one standing only ever opens it — a reader
    // walking H → M → L is choosing, not toggling a panel.
    fireEvent.click(screen.getByRole('button', { name: 'Low render quality' }));
    expect(chip(container)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Med render quality' }));
    expect(chip(container)).not.toBeNull();
  });

  it('puts it away on the tier that is already standing', () => {
    const { container } = render(<StatusStrip cellCount={5_000} />);

    fireEvent.click(screen.getByRole('button', { name: 'Low render quality' }));
    expect(chip(container)).not.toBeNull();
    // Pressed again, and this time it IS the standing tier: the quality
    // setting does not move and the control retires.
    fireEvent.click(screen.getByRole('button', { name: 'Low render quality' }));
    expect(chip(container)).toBeNull();
    expect(getQualityRuntimeSnapshot().mode).toBe('low');
  });

  it('says what the next press does, and never promises a tidy-up it cannot make', () => {
    render(<StatusStrip cellCount={5_000} />);
    const auto = () => screen.getByRole('button', { name: 'Auto render quality' });

    expect(auto().getAttribute('title'))
      .toBe('Adaptive render quality — currently HIGH · and brings up STAGE CELLS');
    fireEvent.click(auto());
    expect(auto().getAttribute('title'))
      .toBe('Adaptive render quality — currently HIGH · press again to put STAGE CELLS away');

    // A manual cap pins the control in the bar, so the offer changes to the
    // reason it will not go.
    act(() => { setCellDisplayLimit(3_000); });
    expect(auto().getAttribute('title'))
      .toBe('Adaptive render quality — currently HIGH · STAGE CELLS stands while its cap is manual');
  });

  it('never lets a manual cap clamp the stage with nothing on screen saying so', () => {
    const { container } = render(<StatusStrip cellCount={5_000} />);

    fireEvent.click(screen.getByRole('button', { name: 'Auto render quality' }));
    act(() => { setCellDisplayLimit(3_000); });
    // The reader asks for the bar back. The cap is not the automatic one any
    // more, so the control that set it stays — hiding it would leave the stage
    // drawing 3,000 of 5,000 Cells with no admission anywhere in the bar.
    fireEvent.click(screen.getByRole('button', { name: 'Auto render quality' }));
    expect(getStageCellsDisclosed()).toBe(false);
    expect(chip(container)).not.toBeNull();
    expect(chip(container)?.getAttribute('data-cell-display-mode')).toBe('manual');

    // …and the way out is the control's own AUTO: the cap goes back to the
    // number the tier beside it already names, and then it can retire.
    fireEvent.click(screen.getByRole('button', { name: 'Automatic cell count' }));
    expect(chip(container)).toBeNull();
  });

  it('is one answer for the strip and the probe, or the fold measures a fiction', () => {
    // The overlay renders the bar twice and folds on the hidden copy's width
    // (`useStatusStripFold.ts`). A disclosure only one of them could see would
    // have the probe measuring a row nobody is looking at.
    const closed = render(<StatusStrip probe cellCount={5_000} />);
    expect(closed.container.querySelector('[data-cell-display-control]')).toBeNull();
    cleanup();

    setStageCellsDisclosed(true);
    const open = render(<StatusStrip probe cellCount={5_000} />);
    expect(open.container.querySelector('[data-cell-display-control]')).not.toBeNull();
  });

  it('takes the room the row has left, so nothing already on screen moves', () => {
    // Wide: the cluster is right-aligned behind a `flex: 1` spacer, so the
    // chip grows LEFTWARD into the spacer and the tier button under the
    // reader's finger does not move.
    setStageCellsDisclosed(true);
    const wide = render(<StatusStrip cellCount={5_000} />);
    const wideCells = wide.container.querySelector('[data-cell-display-control]')!;
    const wideQuality = wide.container.querySelector('[data-render-quality-control]')!;
    expect(wideCells.compareDocumentPosition(wideQuality))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    cleanup();

    // Phone: the performance row packs from the left and does NOT scroll, so
    // the same insertion ahead of QUALITY would push the rail off the screen.
    // The slack is on the right, and the chip takes that instead.
    const mobile = render(<StatusStrip cellCount={5_000} compact mobile />);
    const row = mobile.container.querySelector('[data-status-performance]')!;
    const mobileCells = row.querySelector('[data-cell-display-control]')!;
    const mobileQuality = row.querySelector('[data-render-quality-control]')!;
    expect(mobileQuality.compareDocumentPosition(mobileCells))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
