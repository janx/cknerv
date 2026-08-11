import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  getQualityRuntimeSnapshot,
  setAdaptiveQuality,
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

const panelControls = [
  { id: 'chain', code: 'CKB·01', label: 'COMMON KNOWLEDGE BASE', visible: true },
  { id: 'pulse', code: 'ECG·04', label: 'PULSE', visible: true },
  { id: 'cells', code: 'MESH·03', label: 'CELL MESH', visible: true },
  { id: 'peers', code: 'MESH·02', label: 'PEER MESH', visible: true },
];

beforeEach(() => {
  setQualityMode('auto');
  setAdaptiveQuality('high');
  setCellDisplayLimit(CELL_DISPLAY_MAX);
  setCellDisplayMode('auto');
  levaMocks.setQuality.mockClear();
});

afterEach(() => {
  cleanup();
  setQualityMode('auto');
  setAdaptiveQuality('high');
  setCellDisplayLimit(CELL_DISPLAY_MAX);
  setCellDisplayMode('auto');
});

describe('StatusStrip', () => {
  it('shows the wordmark and a nominal indicator', () => {
    const { container } = render(<StatusStrip level="nominal" uptimeMs={0} />);
    const root = container.firstElementChild as HTMLElement;
    expect(container.textContent).toContain('CKNERV');
    expect(container.textContent).toContain('NOMINAL');
    expect(container.textContent).toContain('状态');
    expect(root.dataset.statusLayout).toBe('wide');
    expect(root.style.height).toBe('36px');
    expect(container.querySelector('[data-status-health]')).not.toBeNull();
    expect(container.querySelector('[data-status-accent-rail]')).not.toBeNull();
  });
  it('tags the indicator dot with the alert level', () => {
    const { container } = render(<StatusStrip level="danger" uptimeMs={0} />);
    const dot = container.querySelector('[data-dot]') as HTMLElement;
    expect(dot.getAttribute('data-level')).toBe('danger');
    expect(container.textContent).toContain('DANGER');
  });
  it('renders the build version as a commit link before the status chip', () => {
    render(
      <StatusStrip
        level="nominal"
        uptimeMs={0}
        build={{ version: '61922ba@20260630', href: 'https://github.com/janx/cknerv/commit/61922ba' }}
      />,
    );
    const link = screen.getByRole('link', { name: '61922ba@20260630' });
    expect(link.getAttribute('href')).toBe('https://github.com/janx/cknerv/commit/61922ba');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
    expect(link.textContent).toBe('BUILD61922ba');
  });

  it('omits the build link when no build prop is given', () => {
    const { queryByRole } = render(<StatusStrip level="nominal" uptimeMs={0} />);
    expect(queryByRole('link')).toBeNull();
  });

  it('places the panel menu after the build and controls panels independently', () => {
    const onPanelVisibilityChange = vi.fn();
    const { container } = render(
      <StatusStrip
        level="nominal"
        uptimeMs={0}
        build={{ version: '61922ba@20260630', href: 'https://github.com/janx/cknerv/commit/61922ba' }}
        panelControls={panelControls}
        onPanelVisibilityChange={onPanelVisibilityChange}
      />,
    );
    const primary = container.querySelector('[data-status-primary]') as HTMLElement;
    const build = screen.getByRole('link', { name: '61922ba@20260630' });
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

  it('uses a prioritized two-row layout when horizontal space is constrained', () => {
    const { container } = render(
      <StatusStrip
        level="nominal"
        uptimeMs={3_000}
        build={{ version: '61922ba@20260630', href: 'https://github.com/janx/cknerv/commit/61922ba' }}
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
    expect(container.querySelector('[data-status-summary]')?.textContent).toContain('NOMINAL');
    expect(screen.getByRole('link', { name: '61922ba@20260630' }).textContent).toBe('BUILD61922ba');
    expect(screen.getByRole('button', {
      name: 'Configure HUD panels, 4 of 4 visible',
    })).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Cell display count' })).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Render quality' })).not.toBeNull();
    expect(container.textContent).not.toContain('UP 00:00:03');
  });

  it('keeps primary controls visible in a dedicated mobile layout', () => {
    const { container } = render(
      <StatusStrip
        level="nominal"
        uptimeMs={3_000}
        build={{ version: '61922ba@20260630', href: 'https://github.com/janx/cknerv/commit/61922ba' }}
        panelControls={panelControls}
        onPanelVisibilityChange={() => {}}
        cellCount={5_000}
        enrichmentSource={{
          source: 'ckbadger',
          status: 'connecting',
          capabilities: [],
        }}
        stream={{
          phase: 'connecting',
          affectedChannels: ['cells'],
          lastMessageAgeMs: 3_000,
          attempt: 1,
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
    expect(performance.style.overflow).toBe('hidden');
    expect(performance.querySelector('[data-cell-display-control]')).not.toBeNull();
    expect(performance.querySelector('[data-render-quality-control]')).not.toBeNull();
    expect(context.style.overflowX).toBe('auto');
    expect(context.textContent).toContain('CKBADGERCONNECTING');
    expect(context.textContent).toContain('DATACONNECTING');
  });

  it('shows transport freshness independently from the chain alert level', () => {
    const { container } = render(
      <StatusStrip
        level="nominal"
        uptimeMs={0}
        stream={{
          phase: 'stale',
          affectedChannels: ['cells'],
          lastMessageAgeMs: 17_000,
          attempt: 2,
        }}
      />,
    );
    const chip = container.querySelector('[data-stream-chip]') as HTMLElement;
    expect(chip.dataset.streamPhase).toBe('stale');
    expect(chip.getAttribute('aria-label')).toBe('Data stale, 17s');
    expect(chip.textContent).toContain('DATASTALE');
    expect(chip.textContent).toContain('17s');
    expect(container.textContent).toContain('NOMINAL');
  });

  it('removes the redundant DATA LIVE chip while keeping live transport implicit', () => {
    const { container } = render(
      <StatusStrip
        level="nominal"
        uptimeMs={0}
        stream={{
          phase: 'live',
          affectedChannels: [],
          lastMessageAgeMs: 2_000,
          attempt: 0,
        }}
      />,
    );

    expect(container.querySelector('[data-stream-chip]')).toBeNull();
    expect(container.textContent).not.toContain('DATA LIVE');
  });

  it('shows optional indexed-context freshness without changing chain status', () => {
    const { container } = render(
      <StatusStrip
        level="nominal"
        uptimeMs={0}
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
    expect(chip.getAttribute('aria-label')).toBe('ckbadger stale 18↓');
    expect(chip.textContent).toContain('CKBADGERSTALE 18↓');
    expect(container.textContent).toContain('NOMINAL');
  });

  it('renders product-owned actions without coupling them to status semantics', () => {
    const { container } = render(
      <StatusStrip
        level="nominal"
        uptimeMs={0}
        actions={<button type="button">JUKEBOX</button>}
      />,
    );

    const actions = container.querySelector('[data-status-actions]');
    expect(actions).not.toBeNull();
    expect(within(actions as HTMLElement).getByRole('button', {
      name: 'JUKEBOX',
    })).not.toBeNull();
    expect(container.textContent).toContain('NOMINAL');
  });

  it('offers a tiered AUTO Cell cap with an immediate manual slider override', () => {
    const { container } = render(
      <StatusStrip level="nominal" uptimeMs={0} cellCount={5_000} />,
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

  it('keeps a 50K manual range while AUTO respects a smaller server cap', () => {
    render(
      <StatusStrip
        level="nominal"
        uptimeMs={0}
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
      <StatusStrip level="nominal" uptimeMs={0} cellCount={2_700} />,
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
    render(<StatusStrip level="nominal" uptimeMs={0} />);
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
    render(<StatusStrip level="nominal" uptimeMs={0} />);
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
});
